"""Registry-wide research and shared parameter-group contracts. Code version: v1.1.0."""

from dataclasses import replace
import json

import numpy as np
import pandas as pd
import pytest

from app.services.strategy_tuning import (
    ResearchRequest,
    ResearchSession,
    load_research_history,
)
from app.web.strategy_forms import (
    build_strategy_form_fields,
    build_strategy_form_sections,
)
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.tuning import RegressionForest, optimize, search_space
from tests.factories.market import ohlc_frame_for_dates


CATALOG = list_enabled_strategies()


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry["id"])
def test_every_dropdown_strategy_has_one_search_and_group_contract(entry):
    strategy = instantiate_strategy(entry["id"])
    fields = build_strategy_form_fields(
        entry["id"], None, strategy_factory=instantiate_strategy
    )
    sections = build_strategy_form_sections(
        entry["id"], fields, strategy_factory=instantiate_strategy
    )
    keys = [field["key"] for section in sections for field in section["fields"]]
    assert sorted(keys) == sorted(field["key"] for field in fields)
    assert len(keys) == len(set(keys))
    dimensions = search_space(strategy)
    assert bool(dimensions) == (entry["id"] != "buy-and-hold")
    assert "compute_backend" not in {dimension.key for dimension in dimensions}
    assert "cell_display_threshold" not in {dimension.key for dimension in dimensions}


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry["id"])
def test_every_strategy_uses_real_execution_engines_on_isolated_factory_data(
    entry, monkeypatch
):
    strategy = instantiate_strategy(entry["id"])
    tickers = ("NVDA", "QQQ")[: strategy.get_required_ticker_count()]
    frames = [
        ohlc_frame_for_dates(
            ticker,
            pd.bdate_range("2025-01-02", periods=160).strftime("%Y-%m-%d").tolist(),
        )
        for ticker in tickers
    ]
    for frame in frames:
        frame.attrs["market_data_source"] = strategy.strategy_market_data_source
    if strategy.strategy_market_data_source != "default":
        monkeypatch.setattr(
            type(strategy), "load_market_datasets", lambda *_args, **_kwargs: frames
        )
    params = strategy.get_startup_params()
    if strategy.strategy_market_data_source != "default":
        params.update(
            {
                definition.key: False
                for definition in strategy.get_parameter_definitions()
                if definition.group == "factors"
            }
        )
        params.update({"training_window": 30, "compute_backend": "CPU"})
    session = ResearchSession(
        ResearchRequest(
            entry["id"], tickers, "2025-01-02", "2026-01-02", params=params
        ),
        history_loader=lambda ticker, interval: frames[tickers.index(ticker)],
    )
    metrics = session.validate(params)
    assert np.isfinite(metrics["score"])
    assert len(metrics["validation"]) == 2
    assert all(
        pd.Timestamp(fold["to"]) < session.holdout_window[0]
        for fold in metrics["validation"]
    )
    assert session.holdout(params)["from"] == str(
        pd.Timestamp(session.holdout_window[0]).date()
    )


@pytest.mark.parametrize("method", ["genetic", "random-forest"])
def test_optimizers_are_seeded_bounded_and_rank_validation_only(method):
    strategy = instantiate_strategy("macd")
    calls = []

    def evaluate(params):
        calls.append(params.copy())
        return {"score": -abs(params["fast_span"] - 6)}

    options = dict(method=method, trials=10, seed=19, bounds={"fast_span": [2, 16]})
    result = optimize(strategy, evaluate, **options)
    repeated = optimize(strategy, evaluate, **options)
    assert result["best"] == repeated["best"]
    assert result["trials"] == repeated["trials"]
    assert all(2 <= row["params"]["fast_span"] <= 16 for row in result["trials"])
    assert result["best"]["score"] == max(row["score"] for row in result["trials"])
    assert all("holdout" not in row for row in calls)


def test_forest_learns_parameter_response_instead_of_returning_random_scores():
    x = np.arange(40, dtype=float).reshape(-1, 1)
    forest = RegressionForest(np.random.default_rng(12))
    forest.fit(x, x[:, 0] ** 2)
    mean, uncertainty = forest.predict(np.array([[3.0], [35.0]]))
    assert mean[1] > mean[0] + 500
    assert np.all(uncertainty >= 0)


def test_unknown_bounds_and_nonfinite_scores_fail_closed():
    strategy = instantiate_strategy("macd")
    with pytest.raises(ValueError, match="Unknown parameters"):
        search_space(strategy, {"dummy": [1, 2]})
    with pytest.raises(ValueError, match="outside"):
        search_space(strategy, {"fast_span": [-1, 2]})
    result = optimize(strategy, lambda _params: {"score": float("nan")}, trials=1)
    assert result["status"] == "failed_closed"
    assert result["best"] is None


@pytest.mark.parametrize(
    "fixed",
    [
        {"fast_span": 0},
        {"fast_span": 2.5},
        {"fast_span": "6"},
        {"fast_span": float("inf")},
    ],
)
def test_fixed_parameters_are_validated_instead_of_silently_replaced(fixed):
    with pytest.raises(ValueError):
        search_space(instantiate_strategy("macd"), fixed=fixed)


def test_non_model_controls_and_overlapping_domains_cannot_be_searched():
    strategy = instantiate_strategy("lstm-price-field")
    with pytest.raises(ValueError, match="not a search dimension"):
        search_space(strategy, {"cell_display_threshold": [1, 10]})
    with pytest.raises(ValueError, match="JSON boolean"):
        search_space(strategy, fixed={"use_volume": "yes"})
    with pytest.raises(ValueError, match="both fixed and searched"):
        search_space(strategy, {"lstm_epochs": [2, 20]}, {"lstm_epochs": 6})
    with pytest.raises(ValueError, match="Invalid choices"):
        search_space(strategy, {"use_volume": [0, 1]})


@pytest.mark.parametrize("domain", ["12", [True, 10], ["2", "16"], None, 12, [1, 2, 3]])
def test_numeric_search_domains_reject_malformed_json(domain):
    with pytest.raises(ValueError, match="numeric bounds"):
        search_space(instantiate_strategy("macd"), {"fast_span": domain})


def test_research_retains_prior_history_without_exposing_future_rows():
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=160).strftime("%Y-%m-%d").tolist()
    )
    session = ResearchSession(
        ResearchRequest(
            "macd", ("NVDA",), str(frame.Date.iloc[80].date()), "2026-01-02"
        ),
        history_loader=lambda *_args: frame,
    )
    compute = session.strategy.compute_signals
    windows = []

    def inspect_history(data, params):
        windows.append((data.Date.min(), data.Date.max()))
        return compute(data, params)

    session.strategy.compute_signals = inspect_history
    metrics = session.validate(session.strategy.get_startup_params())
    assert windows == [
        (frame.Date.iloc[0], last) for _first, last in session.validation_windows
    ]
    assert [fold["from"] for fold in metrics["validation"]] == [
        str(pd.Timestamp(first).date()) for first, _last in session.validation_windows
    ]


def test_predictions_only_in_warmup_cannot_make_a_scored_window_eligible():
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=100).strftime("%Y-%m-%d").tolist()
    )
    session = ResearchSession(
        ResearchRequest("macd", ("NVDA",), "2025-01-02", "2026-01-02"),
        history_loader=lambda *_args: frame,
    )
    compute = session.strategy.compute_signals
    first = session.validation_windows[0][0]

    def only_warmup_predictions(data, params):
        result = compute(data, params)
        result.presentation = {
            "predictive_mean": [1.0 if date < first else None for date in data.Date]
        }
        return result

    session.strategy.compute_signals = only_warmup_predictions
    with pytest.raises(ValueError, match="scored window"):
        session.validate(session.strategy.get_startup_params())


def test_mixed_frequency_research_keeps_warmup_and_prediction_evidence(monkeypatch):
    strategy = instantiate_strategy("bayesian-price-field")
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=120).strftime("%Y-%m-%d").tolist()
    )
    frame.attrs["market_data_source"] = strategy.strategy_market_data_source
    intraday = ohlc_frame_for_dates(
        "NVDA",
        [
            f"{date:%Y-%m-%d} {time}"
            for date in frame.Date.iloc[60:]
            for time in ("09:30", "15:59")
        ],
    )
    monkeypatch.setattr(
        type(strategy), "load_market_datasets", lambda *_args, **_kwargs: [frame]
    )
    params = {
        **strategy.get_startup_params(),
        **{
            item.key: False
            for item in strategy.get_parameter_definitions()
            if item.group == "factors"
        },
        "training_window": 30,
        "compute_backend": "CPU",
    }
    session = ResearchSession(
        ResearchRequest(
            "bayesian-price-field",
            ("NVDA",),
            str(frame.Date.iloc[60].date()),
            "2026-01-02",
            interval="1m",
            params=params,
        ),
        history_loader=lambda *_args: intraday,
    )
    compute = session.strategy.compute_signals
    windows = []

    def inspect_history(data, selected):
        windows.append((data.Date.min(), data.Date.max()))
        return compute(data, selected)

    session.strategy.compute_signals = inspect_history
    metrics = session.validate(params)
    assert windows == [
        (frame.Date.iloc[0], last) for _first, last in session.validation_windows
    ]
    assert all(fold["model_evidence"]["device"] for fold in metrics["validation"])


def test_holdout_price_changes_do_not_change_validation_scores():
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=100).strftime("%Y-%m-%d").tolist()
    )
    request = ResearchRequest("macd", ("NVDA",), "2025-01-02", "2026-01-02")
    session = ResearchSession(request, history_loader=lambda *_args: frame)
    before = session.validate(session.strategy.get_startup_params())
    frame.loc[80:, ["Open", "High", "Low", "Close"]] *= 3
    changed = ResearchSession(request, history_loader=lambda *_args: frame)
    assert changed.validate(changed.strategy.get_startup_params()) == before
    assert changed.data_fingerprint != session.data_fingerprint
    with pytest.raises(ValueError, match="distinct ticker"):
        ResearchSession(
            replace(request, tickers=("NVDA", "NVDA")),
            history_loader=lambda *_args: frame,
        )


def test_cli_reads_market_files_without_mutating_them(tmp_path, monkeypatch):
    from app.services import strategy_tuning

    frame = ohlc_frame_for_dates("NVDA", ["2026-01-02", "2026-01-05"])
    path = tmp_path / "NVDA.parquet"
    frame.to_parquet(path)
    original = path.read_bytes()
    monkeypatch.setattr(
        strategy_tuning, "history_store_path_for_interval", lambda *_args: path
    )
    result = load_research_history("NVDA", "1d")
    assert len(result) == 2
    assert path.read_bytes() == original
    frame["Synthetic"] = True
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="Synthetic"):
        load_research_history("NVDA", "1d")


def test_cli_catalog_covers_the_same_dropdown_registry(capsys):
    from scripts.strategy_tune import main

    assert main(["--catalog"]) == 0
    rows = json.loads(capsys.readouterr().out)
    assert [row["id"] for row in rows] == [row["id"] for row in CATALOG]


def test_cli_keeps_validation_evidence_when_holdout_fails(tmp_path, monkeypatch):
    from scripts import strategy_tune

    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=100).strftime("%Y-%m-%d").tolist()
    )
    real_session = ResearchSession
    monkeypatch.setattr(
        strategy_tune,
        "ResearchSession",
        lambda request, **kwargs: real_session(
            request,
            history_loader=lambda *_args: frame,
            **kwargs,
        ),
    )

    def fail_holdout(_self, _params):
        raise ValueError("No eligible holdout observations.")

    monkeypatch.setattr(real_session, "holdout", fail_holdout)
    output = tmp_path / "run"
    assert (
        strategy_tune.main(
            [
                "--strategy",
                "macd",
                "--ticker",
                "NVDA",
                "--from",
                "2025-01-02",
                "--to",
                "2026-01-02",
                "--trials",
                "1",
                "--output",
                str(output),
            ]
        )
        == 1
    )
    result = json.loads((output / "result.json").read_text())
    assert result["status"] == result["holdout"]["status"] == "failed_closed"
    assert result["best"]["status"] == "ok"
    assert result["holdout_used_for_selection"] is False
