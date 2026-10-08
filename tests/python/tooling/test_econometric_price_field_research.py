"""Econometric Price Field provenance CLI contracts. Code version: v1.0.0."""

from __future__ import annotations

import hashlib
import json
import math
import os

import numpy as np
import pandas as pd
import pytest

from app.core.config import BASE_DIR, MARKET_STORE_DIR, SETTINGS_STORE_DIR
from scripts import econometric_price_field_research as research
from strategies.loader import instantiate_strategy
from strategies.price_field.econometric import rough, score_driven
from strategies.price_field.econometric.forecasts import PriceArrays, har_range_forecast
from strategies.price_field.econometric.location import DRIFT_DEFAULTS
from strategies.price_field.neural.scoring import score_neural_price_field
from tests.factories.market import clustered_ohlc_random_walk

PROTOCOL_PANEL = ["NVDA", "QQQ", "SMH", "SPY", "AAPL", "MSFT", "MU", "AVGO", "TSM", "ORCL",
                  "QCOM", "GOOGL", "JPM", "IBM", "VZ", "C"]
OHLC = ["Open", "High", "Low", "Close"]


def _frames(tickers, *, count, start):
    """Deterministic GARCH random walks, one seed and price level per ticker."""
    return {
        ticker: clustered_ohlc_random_walk(count, seed=101 + index, start=start, base_price=40.0 + 30.0 * index)
        for index, ticker in enumerate(tickers)
    }


def _write_store(directory, frames):
    directory.mkdir(parents=True)
    for ticker, frame in frames.items():
        frame.to_parquet(directory / f"{ticker}.parquet", index=False)


def _install_loader(monkeypatch, directory, calls=None):
    def load(ticker, interval):
        if calls is not None:
            calls.append((ticker, interval, os.environ.get("WORTHWARD_REMOTE_MARKET_ACCESS")))
        path = directory / f"{ticker}.parquet"
        if not path.is_file():
            raise ValueError(f"No local {interval} history for {ticker}; refresh it in Settings first.")
        frame = pd.read_parquet(path)
        frame.attrs["research_source"] = str(path)
        return frame

    monkeypatch.setattr(research, "load_research_history", load)


def _forbid_loader(monkeypatch):
    def unexpected(*_args, **_kwargs):
        pytest.fail("This path must not load market data.")

    monkeypatch.setattr(research, "load_research_history", unexpected)


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_describe_loads_no_prices_and_matches_module_constants(monkeypatch, capsys):
    _forbid_loader(monkeypatch)
    monkeypatch.setenv("WORTHWARD_REMOTE_MARKET_ACCESS", "enabled")
    assert research.main(["--describe"]) == 0
    manifest = json.loads(capsys.readouterr().out)
    assert os.environ["WORTHWARD_REMOTE_MARKET_ACCESS"] == "disabled"
    assert manifest["schema"] == research.DESCRIBE_SCHEMA
    assert manifest["cli_version"] == research.CODE_VERSION
    protocol = manifest["protocol"]
    assert protocol["panel_tickers"] == PROTOCOL_PANEL
    assert protocol["prior_cutoff"] == "2016-10-01"
    assert protocol["selection_window"] == {"start": "2016-10-01", "end": "2023-09-30"}
    assert protocol["kpi_window"]["start"] == "2023-10-01"
    evidence = protocol["selection_evidence"]
    assert evidence["status"] == "reported-historical-protocol"
    assert evidence["kpi_is_pristine_holdout"] is False
    assert evidence["candidate_generation_independence"] == "unverified"
    assert "historical candidate grids" in evidence["not_reproduced_by_this_cli"]
    assert "historical selection decisions" in evidence["not_reproduced_by_this_cli"]
    exception = protocol["selection_exception"]
    assert exception["strategy"] == "crps-learning-price-field"
    assert exception["parameter"] == "loc_alpha"
    assert exception["strict_argmax"] == 0.0
    assert exception["selected"] == research.COMBINER_DEFAULTS["loc_alpha"] == 0.1
    assert list(manifest["strategies"]) == list(research.STRATEGY_IDS)
    expected_defaults = {"har-range-price-field": (2000, 0.94), "score-driven-price-field": (1000, 0.96),
                         "rough-volatility-price-field": (2000, 0.94), "crps-learning-price-field": (2000, 1.0)}
    for strategy_id, entry in manifest["strategies"].items():
        strategy = instantiate_strategy(strategy_id)
        assert entry["default_params"] == json.loads(json.dumps(strategy.get_startup_params()))
        assert (entry["settings"]["fit_window"], entry["settings"]["scale_multiplier"]) == expected_defaults[strategy_id]
        assert entry["settings"]["refit_interval"] == 20
    priors = manifest["priors"]
    assert set(priors["rough_volatility"]["proxies"]) == {"yz", "r2"}
    for proxy, stored in rough.PRIORS.items():
        described = priors["rough_volatility"]["proxies"][proxy]
        assert [described[key] for key in ("a", "b", "H", "lam")] == [stored[key] for key in ("a", "b", "H", "lam")]
        assert described["rho"] == np.asarray(stored["rho"]).tolist()
    for name, center, spread in (("range", score_driven.RANGE_PRIOR_CENTER, score_driven.RANGE_PRIOR_SD),
                                 ("close_only", score_driven.BETAT_PRIOR_CENTER, score_driven.BETAT_PRIOR_SD)):
        described = priors["score_driven"][name]
        assert list(described["center"].values()) == center.tolist()
        assert list(described["sd"].values()) == [float(value) if math.isfinite(value) else None for value in spread]
    assert priors["drift"] == DRIFT_DEFAULTS
    code = manifest["code"]
    assert code["scripts.econometric_price_field_research"]["code_version"] == research.CODE_VERSION
    rough_version = research.CODE_VERSION_PATTERN.search(open(rough.__file__, "rb").read()).group(1).decode()
    assert code["strategies.price_field.econometric.rough"]["code_version"] == rough_version
    assert all(len(item["sha256"]) == 64 for item in code.values())


@pytest.mark.parametrize("arguments", [
    ["--describe", "panel"],
    ["panel"],
    [],
    ["priors", "--strategy", "har-range-price-field", "--output", "unused"],
    ["priors", "--workers", "2", "--output", "unused"],
    ["panel", "--strategy", "missing-strategy", "--output", "unused"],
])
def test_usage_errors_exit_two_before_data_access(arguments, tmp_path, monkeypatch):
    _forbid_loader(monkeypatch)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit) as stopped:
        research.main(arguments)
    assert stopped.value.code == 2
    assert not (tmp_path / "unused").exists()


@pytest.mark.parametrize("root", [MARKET_STORE_DIR, SETTINGS_STORE_DIR, BASE_DIR / "market_store",
                                  BASE_DIR / "settings_store"])
@pytest.mark.parametrize("mode", ["priors", "panel"])
def test_store_outputs_are_refused_before_data_access(root, mode, monkeypatch, capsys):
    _forbid_loader(monkeypatch)
    output = root / "econometric-research-guard-probe"
    with pytest.raises(SystemExit) as stopped:
        research.main([mode, "--output", str(output)])
    assert stopped.value.code == 2
    assert "cannot be inside production market or settings stores" in capsys.readouterr().err
    assert not output.exists()


def test_case_variant_output_cannot_reach_a_protected_store(tmp_path, monkeypatch, capsys):
    store = tmp_path / "store"
    store.mkdir()
    variant = tmp_path / "STORE"
    if not variant.exists():
        pytest.skip("Case-variant spellings name a different directory on this filesystem.")
    monkeypatch.setattr("app.core.config.MARKET_STORE_DIR", store)
    _forbid_loader(monkeypatch)
    with pytest.raises(SystemExit) as stopped:
        research.main(["priors", "--output", str(variant / "case-probe")])
    assert stopped.value.code == 2
    assert "cannot be inside production market or settings stores" in capsys.readouterr().err
    assert list(store.iterdir()) == []


@pytest.mark.parametrize("mode", ["priors", "panel"])
def test_existing_output_and_invalid_tickers_fail_before_data_access(mode, tmp_path, monkeypatch, capsys):
    _forbid_loader(monkeypatch)
    sentinel = tmp_path / "manifest.json"
    sentinel.write_text("prior evidence", encoding="utf-8")
    assert research.main([mode, "--output", str(tmp_path)]) == 1
    assert "econometric_price_field_research failed: The output directory must be new." in capsys.readouterr().err
    assert sentinel.read_text(encoding="utf-8") == "prior evidence"
    output = tmp_path / "run"
    assert research.main([mode, "--ticker", "nvda", "--ticker", " NVDA ", "--output", str(output)]) == 1
    assert "Tickers must be unique." in capsys.readouterr().err
    assert not output.exists()


def test_missing_history_fails_offline_without_creating_output(tmp_path, monkeypatch, capsys):
    calls = []
    _install_loader(monkeypatch, tmp_path / "empty-store", calls)
    monkeypatch.setenv("WORTHWARD_REMOTE_MARKET_ACCESS", "enabled")
    output = tmp_path / "run"
    assert research.main(["panel", "--ticker", "ZZZZ", "--output", str(output)]) == 1
    assert "econometric_price_field_research failed: No local 1d history for ZZZZ" in capsys.readouterr().err
    assert calls == [("ZZZZ", "1d", "disabled")]
    assert not output.exists()


def test_priors_use_only_pre_cutoff_bars_and_are_deterministic(tmp_path, monkeypatch, capsys):
    tickers = ("AAA", "BBB", "CCC")
    frames = _frames(tickers, count=760, start="2014-03-03")
    cutoff = pd.Timestamp(research.PRIOR_CUTOFF)
    assert all(frame["Date"].iloc[0] < cutoff < frame["Date"].iloc[-1] for frame in frames.values())
    original, mutated = tmp_path / "original", tmp_path / "mutated"
    _write_store(original, frames)
    changed = {}
    for ticker, frame in frames.items():
        frame = frame.copy()
        later = frame["Date"] >= cutoff
        frame.loc[later, OHLC] = frame.loc[later, OHLC].to_numpy()[:, [0, 2, 1, 3]] * 37.0
        frame.loc[frame.index[-3], "Close"] = np.nan
        changed[ticker] = frame
    _write_store(mutated, changed)
    arguments = [item for ticker in tickers for item in ("--ticker", ticker)]
    results = []
    for store, name in ((original, "first"), (mutated, "second")):
        calls = []
        _install_loader(monkeypatch, store, calls)
        output = tmp_path / name
        assert research.main(["priors", *arguments, "--output", str(output)]) == 3
        assert capsys.readouterr().out.strip() == str(output / "priors.json")
        assert [path.name for path in output.iterdir()] == ["priors.json"]
        assert calls == [(ticker, "1d", "disabled") for ticker in tickers]
        results.append(_read(output / "priors.json"))
    first, second = results
    assert first["schema"] == research.PRIORS_SCHEMA and first["status"] == "not_reproduced"
    assert first["protocol"]["panel_is_protocol_panel"] is False
    assert first["summary"]["quantities"] == 2 * (4 + 20) + 2 * 5 + 2 * 4
    for ticker in tickers:
        record = first["inputs"][ticker]
        assert record["last_date_before_cutoff"] < research.PRIOR_CUTOFF
        assert record["rows_before_cutoff"] == int((frames[ticker]["Date"] < cutoff).sum())
        assert record["source_sha256"] == hashlib.sha256((original / f"{ticker}.parquet").read_bytes()).hexdigest()
        assert record["pre_cutoff_data_sha256"] == second["inputs"][ticker]["pre_cutoff_data_sha256"]
        assert record["data_sha256"] != second["inputs"][ticker]["data_sha256"]
    assert second["inputs"]["AAA"]["rows_dropped_invalid_ohlc"] == 1
    # Post-cutoff bars cannot move any estimate, and identical inputs give identical output.
    assert first["rough_volatility"] == second["rough_volatility"]
    assert first["score_driven"] == second["score_driven"]
    for proxy in ("yz", "r2"):
        result = first["rough_volatility"]["proxies"][proxy]
        assert result["variogram"]["H"]["estimate"] in rough.GRID_H
        assert result["variogram"]["lam"]["estimate"] in rough.GRID_LAM
        assert result["variogram"]["a"]["stored"] == rough.PRIORS[proxy]["a"]
        assert len(result["rho"]) == 20 and all(math.isfinite(item["estimate"]) for item in result["rho"])
    for name, spec in research.SCORE_DRIVEN_PRIOR_SPECS.items():
        result = first["score_driven"]["specs"][name]
        assert result["kept_fits"] == sum(item["kept"] for item in result["tickers"].values()) > 0
        assert result["parameters"]["omega"]["prior"] is False
        assert all(math.isfinite(item["center"]["estimate"]) and item["sd"]["estimate"] >= 0
                   for item in result["parameters"].values() if item["prior"])
    assert first["score_driven"]["specs"]["close_only"]["parameters"]["delta"]["fixed"] is True
    sensitivity = first["score_driven"]["specs"]["range"]["product_proxy_sensitivity"]
    assert sensitivity["max_abs_center_difference"] >= 0.0
    assert first["run"]["argv"] == ["priors", *arguments, "--output", str(tmp_path / "first")]


@pytest.mark.parametrize("scored_sessions", [10, 20, 21])
def test_panel_requires_all_20_horizons_even_with_complete_pair_coverage(
    scored_sessions, tmp_path, monkeypatch, capsys
):
    frames = _frames(("NVDA",), count=400, start="2015-06-01")
    dates = frames["NVDA"]["Date"]
    monkeypatch.setattr(research, "SELECTION_START", str(dates.iloc[200].date()))
    monkeypatch.setattr(research, "SELECTION_END", str(dates.iloc[-scored_sessions - 1].date()))
    monkeypatch.setattr(research, "KPI_START", str(dates.iloc[-scored_sessions].date()))
    store = tmp_path / "store"
    _write_store(store, frames)
    _install_loader(monkeypatch, store)
    output = tmp_path / "panel"
    complete = scored_sessions >= 21

    status = research.main([
        "panel", "--ticker", "NVDA", "--strategy", "har-range-price-field",
        "--workers", "1", "--output", str(output),
    ])

    assert status == (0 if complete else 3), capsys.readouterr().err
    manifest = _read(output / "manifest.json")
    assert manifest["status"] == ("completed" if complete else "incomplete")
    score = manifest["tickers"]["NVDA"]["results"]["har-range-price-field"]["windows"]["kpi"]
    # All available pairs can be scored even when horizon 20 has no outcome.
    assert score["valid_pairs"] == score["eligible_pairs"] > 0
    assert score["complete"] is complete
    assert (score["crps_skill_pct"] is not None) is complete
    summary = manifest["panel"]["har-range-price-field"]["kpi"]
    assert summary["complete_tickers"] == int(complete)
    assert (summary["mean_pct"] is not None) is complete


def test_panel_scores_frozen_forecasts_with_the_official_scorer(tmp_path, monkeypatch, capsys):
    # Short windows keep the official scorer fast; the frozen dates are covered by --describe.
    monkeypatch.setattr(research, "SELECTION_START", "2016-06-01")
    monkeypatch.setattr(research, "SELECTION_END", "2016-09-30")
    monkeypatch.setattr(research, "KPI_START", "2016-10-01")
    tickers = ("NVDA", "QQQ")
    frames = _frames(tickers, count=400, start="2015-06-01")
    store = tmp_path / "store"
    _write_store(store, frames)
    _install_loader(monkeypatch, store)
    output = tmp_path / "panel"
    arguments = ["panel", "--ticker", "NVDA", "--ticker", "QQQ", "--workers", "1", "--output", str(output)]
    assert research.main(arguments) == 0, capsys.readouterr().err
    manifest = _read(output / "manifest.json")
    assert manifest["schema"] == research.PANEL_SCHEMA and manifest["status"] == "completed"
    assert manifest["evaluation"]["refit_schedule"] == "session-date-blocks"
    assert list(manifest["strategies"]) == list(research.STRATEGY_IDS)
    assert set(manifest["code"]) >= set(research.CODE_MODULES)
    assert manifest["run"]["argv"] == arguments and manifest["run"]["workers"] == 1
    assert manifest["run"]["command"].endswith("scripts/econometric_price_field_research.py " + " ".join(arguments))
    for ticker in tickers:
        record = manifest["tickers"][ticker]
        assert record["source_sha256"] == hashlib.sha256((store / f"{ticker}.parquet").read_bytes()).hexdigest()
        assert record["rows"] == 400 and record["first_date"] == "2015-06-01"
        assert record["windows"]["pre"]["first_origin"] == "2016-06-01"
        assert record["windows"]["pre"]["last_session"] == "2016-09-30"
        assert record["windows"]["kpi"]["first_origin"] == "2016-10-03"
        assert record["windows"]["kpi"]["end_index"] == 400
        for strategy_id in research.STRATEGY_IDS:
            for window in record["results"][strategy_id]["windows"].values():
                assert window["complete"] and window["valid_pairs"] == window["eligible_pairs"] > 0
                assert math.isfinite(window["crps_skill_pct"])
    for strategy_id, summary in manifest["panel"].items():
        for window in ("pre", "kpi"):
            values = [manifest["tickers"][ticker]["results"][strategy_id]["windows"][window]["crps_skill_pct"]
                      for ticker in tickers]
            assert summary[window]["mean_pct"] == pytest.approx(float(np.mean(values)), rel=1e-12)
        assert summary["kpi_ticker"]["kpi_pct"] == values[0]

    # Independent recomputation of one cell through the repository forecast and scorer.
    frame = frames["NVDA"]
    dates = frame["Date"].to_numpy(dtype="datetime64[ns]")
    strategy = instantiate_strategy("har-range-price-field")
    forecast = har_range_forecast(
        PriceArrays(*(frame[column].to_numpy(dtype=float) for column in OHLC), dates=dates),
        strategy.settings_from_params(strategy.get_startup_params()))
    window = manifest["tickers"]["NVDA"]["windows"]["pre"]
    end = window["end_index"]
    scoring = pd.DataFrame({"Date": dates[:end], "Close": frame["Close"].to_numpy()[:end],
                            **{f"pf_mean_h{h:02d}": forecast.means[:end, h - 1] for h in range(1, 21)},
                            **{f"pf_std_h{h:02d}": forecast.stds[:end, h - 1] for h in range(1, 21)}})
    expected = 100.0 * score_neural_price_field(scoring, window["start_index"], end)["crps_skill_score"]
    assert manifest["tickers"]["NVDA"]["results"]["har-range-price-field"]["windows"]["pre"]["crps_skill_pct"] == expected

    # Worker processes reproduce the in-process scores exactly.
    parallel = tmp_path / "parallel"
    assert research.main(["panel", "--ticker", "NVDA", "--ticker", "QQQ", "--strategy", "har-range-price-field",
                          "--workers", "2", "--output", str(parallel)]) == 0
    repeated = _read(parallel / "manifest.json")
    assert list(repeated["strategies"]) == ["har-range-price-field"]
    for ticker in tickers:
        assert (repeated["tickers"][ticker]["results"]["har-range-price-field"]["windows"]
                == manifest["tickers"][ticker]["results"]["har-range-price-field"]["windows"])
