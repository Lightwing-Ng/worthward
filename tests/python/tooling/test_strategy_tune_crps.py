"""Backtest CRPS skill objective for every Price Field strategy. Code version: v1.0.0."""

from __future__ import annotations

from copy import deepcopy
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import pandas as pd
import pytest

from app.core.config import MARKET_STORE_DIR
from app.services.market.market_data import history_store_path_for_interval
from app.services.research import price_field_market_factors
from app.services.research.strategy_tuning import (
    BACKTEST_HISTORY_BASIS,
    SESSION_HISTORY_BASIS,
    ResearchRequest,
    ResearchSession,
)
from scripts import strategy_tune
from strategies.backtest import complete_distribution_skill, run_single_ticker_backtest
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.price_field.pipeline import bundle_to_price_field_ohlcv
from tests.factories.market import (
    oscillating_ohlc_frame_for_dates,
    price_field_bundle_for_frame,
)
from tests.python.tooling.test_strategy_tune_cli import _bounded_parameters


# Registry-driven, so a newly discovered Price Field strategy is covered.
PRICE_FIELD = [
    entry
    for entry in list_enabled_strategies()
    if entry.get("presentation_renderer") == "probability-grid-v1"
]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATES = pd.bdate_range("2024-01-02", periods=300)
# 160 requested sessions after 140 real warmup bars: folds of 24, 24, and 32.
FIRST = 140
WINDOWS = ((80, 103), (104, 127), (128, 159), (0, 159))
# Long enough that every search warmup below starts inside the factory history.
LONG_DATES = pd.bdate_range("2019-01-02", periods=2000)
# One search per provider loader family. Each searched dimension sizes the
# provider warmup, and trial 1 (the projected startup default) stays below the
# upper bound that sizes the search session's frozen inputs.
WARMUP_SEARCHES = {
    "bayesian-price-field": {"use_momentum_60d": [False, True]},
    "nhits-price-field": {"use_momentum_60d": [False, True]},
    "har-range-price-field": {"drift_window": [1200, 1300]},
    "rough-volatility-price-field": {"drift_window": [1200, 1300]},
    "score-driven-price-field": {"drift_window": [1200, 1300]},
    "crps-learning-price-field": {"drift_window": [1200, 1300]},
}


def _bundle(dates=DATES):
    frame = oscillating_ohlc_frame_for_dates(
        "NVDA", dates.strftime("%Y-%m-%d").tolist()
    )
    return price_field_bundle_for_frame("NVDA", frame)


def _install_provider(monkeypatch, strategy, bundle, loads):
    """Mirror a Price Field provider: keep the warmup bundle, return its bars."""

    def load_provider(self, requested, *, interval, start, end, params):
        loads.append((tuple(requested), interval, start, end))
        self._warmup_bundle = deepcopy(bundle)
        return [bundle_to_price_field_ohlcv(self._warmup_bundle)]

    monkeypatch.setattr(type(strategy), "load_market_datasets", load_provider)


def _date(offset):
    return str(DATES[FIRST + offset].date())


@pytest.mark.parametrize("entry", PRICE_FIELD, ids=lambda entry: entry["id"])
def test_crps_skill_objective_reproduces_the_exact_range_backtest_headline(
    entry, tmp_path, monkeypatch, capsys
):
    strategy = instantiate_strategy(entry["id"])
    bundle = _bundle()
    loads = []
    _install_provider(monkeypatch, strategy, bundle, loads)
    fixed = _bounded_parameters(strategy)
    output = tmp_path / "research"

    assert strategy_tune.main([
        "--strategy", entry["id"],
        "--ticker", "NVDA",
        "--from", _date(0),
        "--to", str(DATES[-1].date()),
        "--objective", "crps-skill",
        "--params", json.dumps(fixed),
        "--bounds", "{}",
        "--trials", "1",
        "--output", str(output),
    ]) == 0, capsys.readouterr().err

    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    assert result["status"] == "completed"
    assert result["request"]["objective"] == "crps_skill"
    assert result["objective"] == strategy_tune.OBJECTIVES["crps-skill"][1]
    # The search session, then the full window's exact-range reload.
    assert loads == [(("NVDA",), "1d", DATES[FIRST], DATES[-1])] * 2
    best = result["best"]
    windows = [*best["validation"], result["holdout"], result["full_window"]]
    for fold, (first, last) in zip(windows, WINDOWS, strict=True):
        assert (fold["from"], fold["to"]) == (_date(first), _date(last))
        assert math.isfinite(fold["crps_skill_pct"])
        assert fold["score"] == fold["crps_skill_pct"]
        assert fold["coverage_pct"] == 100.0
        # Every in-window (origin, horizon) pair is scored for all 20 horizons.
        sessions = last - first + 1
        assert fold["valid_pairs"] == fold["eligible_pairs"] == 20 * sessions - 210
        assert set(fold["horizon_profile"]) == {"1", "5", "10", "20"}
        assert math.isfinite(fold["interval_80_coverage_pct"])
        assert fold["model_evidence"]["fingerprint"]
    assert best["score"] == pytest.approx(
        sum(fold["score"] for fold in best["validation"]) / 2
    )
    # Selection windows share the frozen session inputs and claim no parity.
    for fold in windows[:-1]:
        assert fold["history_basis"] == SESSION_HISTORY_BASIS
        assert "backtest_headline_pct" not in fold
    full_window = result["full_window"]
    assert full_window["history_basis"] == BACKTEST_HISTORY_BASIS
    assert full_window["backtest_headline_pct"] == round(
        full_window["crps_skill_pct"], 2
    )
    assert full_window["reporting_only"] is True
    assert full_window["overlaps_selection_windows"] is True
    assert result["holdout_used_for_selection"] is False

    # An independent exact-range Backtest: load, slice the visible rows, run.
    reference = instantiate_strategy(entry["id"])
    params = reference.normalize_params(fixed)
    full = reference.load_market_datasets(
        ("NVDA",), interval="1d", start=DATES[FIRST], end=DATES[-1], params=params
    )[0]
    visible = full.loc[full["Date"].between(DATES[FIRST], DATES[-1])].copy()
    backtest = run_single_ticker_backtest(
        reference.compute_signals(visible, params),
        10000.0,
        execution_mode="next_open",
        interval="1d",
    )
    headline = backtest["summary"]["probability_field_distribution_skill_pct"]
    assert headline is not None
    assert result["full_window"]["backtest_headline_pct"] == headline

    # Clipping: later bars cannot reach a fold, even when they are corrupted.
    cutoff = DATES[FIRST + WINDOWS[0][1]]
    mutated = _bundle()
    for row in mutated["ohlcv"]:
        if pd.Timestamp(row["observed_at"]) > cutoff:
            for key in ("open", "high", "low", "close"):
                row[key] *= 1.5
            row["volume"] *= 3
    _install_provider(monkeypatch, strategy, mutated, [])
    session = ResearchSession(ResearchRequest(
        entry["id"], ("NVDA",), _date(0), str(DATES[-1].date()),
        params=fixed, objective="crps_skill",
    ))
    compute = session.strategy.compute_signals
    bundle_ends = []

    def inspect(data, params):
        bundle_ends.append(max(
            pd.Timestamp(row["observed_at"])
            for row in session.strategy._warmup_bundle["ohlcv"]
        ))
        return compute(data, params)

    session.strategy.compute_signals = inspect
    first_fold = session.evaluate_window(best["params"], session.validation_windows[0])
    assert first_fold["score"] == best["validation"][0]["score"]
    second_fold = session.evaluate_window(best["params"], session.validation_windows[1])
    assert second_fold["score"] != best["validation"][1]["score"]
    assert bundle_ends == [cutoff, DATES[FIRST + WINDOWS[1][1]]]


@pytest.mark.parametrize(
    ("strategy_id", "bounds"), WARMUP_SEARCHES.items(), ids=list(WARMUP_SEARCHES)
)
def test_search_full_window_reproduces_the_backtest_for_the_best_params(
    strategy_id, bounds, tmp_path, monkeypatch, capsys
):
    history = _bundle(LONG_DATES)
    starts = []

    def local_bundle(_symbol, start, end):
        """Honor the loader's params-dependent warmup start, like the local store."""
        first, last = pd.Timestamp(start).date(), pd.Timestamp(end).date()
        starts.append(first)
        bundle = deepcopy(history)
        bundle["ohlcv"] = [
            row for row in bundle["ohlcv"]
            if first <= pd.Timestamp(row["observed_at"]).date() <= last
        ]
        return bundle

    monkeypatch.setattr(
        price_field_market_factors, "build_local_price_field_factor_bundle", local_bundle
    )
    strategy = instantiate_strategy(strategy_id)
    fixed = {
        key: value
        for key, value in _bounded_parameters(strategy).items()
        if key not in bounds
    }
    start, end = LONG_DATES[-160], LONG_DATES[-1]
    output = tmp_path / "research"

    assert strategy_tune.main([
        "--strategy", strategy_id,
        "--ticker", "NVDA",
        "--from", str(start.date()),
        "--to", str(end.date()),
        "--objective", "crps-skill",
        "--params", json.dumps(fixed),
        "--bounds", json.dumps(bounds),
        "--trials", "1",
        "--output", str(output),
    ]) == 0, capsys.readouterr().err

    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    assert result["status"] == "completed"
    assert result["baseline_only"] is False
    best = result["best"]["params"]
    full_window = result["full_window"]
    # The session loads the upper bound's longer warmup; the full window
    # reloads only the history the best params need.
    session_start, reload_start = starts
    assert session_start < reload_start
    assert full_window["sources"][0]["rows"] < result["sources"][0]["rows"]
    assert full_window["history_basis"] == BACKTEST_HISTORY_BASIS
    for fold in [*result["best"]["validation"], result["holdout"]]:
        assert fold["history_basis"] == SESSION_HISTORY_BASIS
        assert "backtest_headline_pct" not in fold

    # An independent exact-range Backtest of the best params.
    reference = instantiate_strategy(strategy_id)
    params = reference.normalize_params(best)
    frame = reference.load_market_datasets(
        ("NVDA",), interval="1d", start=start, end=end, params=params
    )[0]
    assert starts[-1] == reload_start
    visible = frame.loc[frame["Date"].between(start, end)].copy()
    backtest = run_single_ticker_backtest(
        reference.compute_signals(visible, params),
        10000.0,
        execution_mode="next_open",
        interval="1d",
    )
    skill = complete_distribution_skill(
        backtest["strategy_presentation"]["diagnostics"]
    )
    assert full_window["crps_skill_pct"] == 100.0 * skill
    assert (
        full_window["backtest_headline_pct"]
        == backtest["summary"]["probability_field_distribution_skill_pct"]
    )


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (OSError, "The provider is offline."),
        (ValueError, "The exact-range reload returned different trading dates"),
    ],
    ids=["reload-error", "reload-dates-changed"],
)
def test_failed_full_window_fails_the_run_closed(
    failure, message, tmp_path, monkeypatch, capsys
):
    entry_id = "bayesian-price-field"
    strategy = instantiate_strategy(entry_id)
    bundle = _bundle()
    loads = []

    def load_provider(self, _requested, *, interval, start, end, params):
        loads.append(start)
        reloaded = deepcopy(bundle)
        if len(loads) > 1:  # Only the full window's exact-range reload fails.
            if failure is OSError:
                raise OSError("The provider is offline.")
            reloaded["ohlcv"] = reloaded["ohlcv"][:-1]
        self._warmup_bundle = reloaded
        return [bundle_to_price_field_ohlcv(reloaded)]

    monkeypatch.setattr(type(strategy), "load_market_datasets", load_provider)
    output = tmp_path / "research"

    assert strategy_tune.main([
        "--strategy", entry_id,
        "--ticker", "NVDA",
        "--from", _date(0),
        "--to", str(DATES[-1].date()),
        "--objective", "crps-skill",
        "--params", json.dumps(_bounded_parameters(strategy)),
        "--bounds", "{}",
        "--trials", "1",
        "--output", str(output),
    ]) == 1
    assert capsys.readouterr().out.strip() == str(output / "result.json")
    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    assert result["status"] == "failed_closed"
    assert result["full_window"].pop("error").startswith(message)
    assert result["full_window"] == {
        "status": "failed_closed",
        "reporting_only": True,
        "overlaps_selection_windows": True,
    }
    # Selection evidence and the holdout survive the failed KPI.
    assert result["best"]["status"] == "ok"
    assert len(result["best"]["validation"]) == 2
    assert math.isfinite(result["holdout"]["crps_skill_pct"])
    assert len(loads) == 2


def test_offline_subprocess_reports_the_kpi_without_writing_stores(tmp_path):
    market_root = tmp_path / "market"
    settings_root = tmp_path / "settings"
    compute_root = tmp_path / "compute"
    local_history = market_root / history_store_path_for_interval(
        "NVDA", "1d"
    ).relative_to(MARKET_STORE_DIR)
    local_history.parent.mkdir(parents=True)
    frame = oscillating_ohlc_frame_for_dates(
        "NVDA", DATES.strftime("%Y-%m-%d").tolist()
    )
    # Complete corporate-action columns keep the local reader from refreshing.
    frame["Adj Close"] = frame["Close"]
    frame["Dividends"] = 0.0
    frame["Stock Splits"] = 0.0
    frame.to_parquet(local_history, index=False)
    original = local_history.read_bytes()
    output = tmp_path / "research"
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"WORTHWARD_REMOTE_MARKET_ACCESS", "ANTIGRAVITY_REMOTE_MARKET_ACCESS"}
    }
    # Only --offline disables remote access; the CLI transport is also blocked.
    environment.update(
        WORTHWARD_MARKET_STORE_DIR=str(market_root),
        WORTHWARD_SETTINGS_STORE_DIR=str(settings_root),
        WORTHWARD_COMPUTE_ROOT=str(compute_root),
        WORTHWARD_LONGBRIDGE_CLI_ACCESS="disabled",
        PYTHONDONTWRITEBYTECODE="1",
    )
    strategy = instantiate_strategy("bayesian-price-field")

    completed = subprocess.run(
        [
            sys.executable, "-B", str(PROJECT_ROOT / "scripts/strategy_tune.py"),
            "--offline",
            "--strategy", "bayesian-price-field",
            "--ticker", "NVDA",
            "--from", _date(0),
            "--to", str(DATES[-1].date()),
            "--objective", "crps-skill",
            "--params", json.dumps(_bounded_parameters(strategy)),
            "--bounds", "{}",
            "--trials", "1",
            "--output", str(output),
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == str(output / "result.json")
    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    assert result["status"] == "completed"
    assert result["sources"][0]["source"] == "longbridge-cli"
    full_window = result["full_window"]
    assert (full_window["from"], full_window["to"]) == (_date(0), _date(159))
    assert math.isfinite(full_window["crps_skill_pct"])
    assert full_window["valid_pairs"] == full_window["eligible_pairs"] == 20 * 160 - 210
    assert local_history.read_bytes() == original
    lock = local_history.with_name(local_history.name + ".lock")
    written = [path for path in tmp_path.rglob("*") if path.is_file()]
    # The market reader's advisory lock file is the only non-output artifact.
    assert all(
        path in {local_history, lock} or output in path.parents for path in written
    )
    assert not any(path.is_file() for path in settings_root.rglob("*"))
    assert not any(path.is_file() for path in compute_root.rglob("*"))
