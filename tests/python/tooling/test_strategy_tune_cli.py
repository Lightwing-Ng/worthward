"""Exercise the tuning CLI against every enabled engine. Code version: v1.0.1."""

from __future__ import annotations

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
from app.services.research.strategy_tuning import ResearchSession
from scripts import strategy_tune
from strategies.loader import instantiate_strategy, list_enabled_strategies
from tests.factories.market import ohlc_frame_for_dates


CATALOG = list_enabled_strategies()
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _bounded_parameters(strategy):
    """Keep genuine model training small without replacing the computation."""
    params = strategy.get_startup_params()
    minimum_keys = {
        "training_window", "chip_window", "lookback", "hidden_size", "epochs",
        "lstm_lookback", "lstm_hidden_size", "lstm_epochs",
    }
    for definition in strategy.get_parameter_definitions():
        if definition.group == "factors" and definition.kind == "boolean":
            params[definition.key] = False
        elif definition.key in minimum_keys:
            params[definition.key] = int(definition.minimum)
        elif definition.key == "retrain_interval":
            params[definition.key] = int(definition.maximum)
        elif definition.key == "compute_backend":
            params[definition.key] = "CPU"
    return params


def _read_artifacts(output):
    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    evaluations = [
        json.loads(line)
        for line in (output / "evaluations.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    return result, evaluations


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry["id"])
@pytest.mark.parametrize("method", ("genetic", "random-forest"))
def test_every_registry_strategy_runs_through_cli_with_real_execution(
    entry, method, tmp_path, monkeypatch, capsys
):
    strategy = instantiate_strategy(entry["id"])
    tickers = strategy.get_default_tickers() or ("NVDA", "QQQ")[
        : strategy.get_required_ticker_count()
    ]
    assert len(tickers) == strategy.get_required_ticker_count()
    dates = pd.bdate_range("2025-01-02", periods=160)
    frames = {}
    for ticker in tickers:
        frame = ohlc_frame_for_dates(ticker, dates.strftime("%Y-%m-%d").tolist())
        frame["Volume"] = 1_000_000.0
        frame.attrs["market_data_source"] = strategy.strategy_market_data_source
        frames[ticker] = frame

    loads = []

    def load_history(ticker, interval):
        loads.append((ticker, interval))
        return frames[ticker].copy()

    def load_provider(_self, requested, *, interval, start, end, params):
        assert tuple(requested) == tickers
        assert start == dates[0]
        assert end == dates[-1]
        assert params == strategy.normalize_params(fixed)
        return [load_history(ticker, interval) for ticker in requested]

    if strategy.strategy_market_data_source != "default":
        monkeypatch.setattr(type(strategy), "load_market_datasets", load_provider)
    monkeypatch.setattr(
        strategy_tune,
        "ResearchSession",
        lambda request, **kwargs: ResearchSession(
            request, history_loader=load_history, **kwargs
        ),
    )
    fixed = _bounded_parameters(strategy)
    output = tmp_path / "research"
    objective = "net-return" if method == "random-forest" else "risk-adjusted-return"
    arguments = [
        "--strategy", entry["id"],
        "--from", str(dates[0].date()),
        "--to", str(dates[-1].date()),
        "--method", method,
        "--objective", objective,
        "--params", json.dumps(fixed),
        "--bounds", "{}",
        "--trials", "1",
        "--seed", "19",
        "--output", str(output),
    ]
    for ticker in tickers:
        arguments.extend(("--ticker", f" {ticker.lower()} "))

    assert strategy_tune.main(arguments) == 0, capsys.readouterr().err
    result, evaluations = _read_artifacts(output)
    assert result["schema"] == "backtest-tuning/v1"
    assert result["status"] == "completed"
    assert result["method"] == method
    assert result["search_seed"] == 19
    assert result["baseline_only"] is True
    assert result["search_space"] == []
    assert result["request"]["strategy_id"] == entry["id"]
    assert result["request"]["tickers"] == list(tickers)
    assert result["request"]["params"] == fixed
    assert result["request"]["objective"] == (
        "net_return_pct" if objective == "net-return" else "risk_adjusted_return"
    )
    assert len(result["data_fingerprint"]) == 64
    assert loads == [(ticker, "1d") for ticker in tickers]
    assert result["sources"] == [
        {"source": strategy.strategy_market_data_source, "rows": len(dates)}
        for _ticker in tickers
    ]
    assert len(evaluations) == 1
    assert result["trials"] == evaluations
    best = result["best"]
    assert best == evaluations[0]
    assert best["status"] == "ok"
    assert best["params"] == strategy.normalize_params(fixed)
    assert math.isfinite(best["score"])
    assert "holdout" not in best
    assert result["holdout_used_for_selection"] is False
    assert len(best["validation"]) == 2
    assert best["score"] == pytest.approx(
        sum(fold["score"] for fold in best["validation"]) / 2
    )
    windows = [*best["validation"], result["holdout"]]
    assert [(fold["from"], fold["to"]) for fold in windows] == [
        (str(dates[first].date()), str(dates[last].date()))
        for first, last in ((80, 103), (104, 127), (128, 159))
    ]
    for fold in windows:
        assert all(
            math.isfinite(fold[key])
            for key in ("score", "net_return_pct", "max_drawdown_pct")
        )
        if objective == "net-return":
            assert fold["score"] == fold["net_return_pct"]
        else:
            assert fold["score"] == pytest.approx(
                fold["net_return_pct"] - 0.5 * fold["max_drawdown_pct"],
                abs=1e-6,
            )
    if "price-field" in entry["id"]:
        assert all(fold["model_evidence"]["fingerprint"] for fold in windows)
        if "compute_backend" in fixed:
            assert all(
                fold["model_evidence"]["device"]["resolved"].lower() == "cpu"
                for fold in windows
            )


@pytest.mark.parametrize("method", ("genetic", "random-forest"))
def test_subprocess_cli_reads_local_history_without_changing_input(
    method, tmp_path
):
    market_root = tmp_path / "market"
    settings_root = tmp_path / "settings"
    compute_root = tmp_path / "compute"
    local_history = market_root / history_store_path_for_interval(
        "NVDA", "1d"
    ).relative_to(MARKET_STORE_DIR)
    local_history.parent.mkdir(parents=True)
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=100).strftime("%Y-%m-%d").tolist()
    )
    frame.to_parquet(local_history, index=False)
    original = local_history.read_bytes()
    output = tmp_path / "research"
    environment = dict(
        os.environ,
        WORTHWARD_MARKET_STORE_DIR=str(market_root),
        WORTHWARD_SETTINGS_STORE_DIR=str(settings_root),
        WORTHWARD_COMPUTE_ROOT=str(compute_root),
        WORTHWARD_REMOTE_MARKET_ACCESS="disabled",
        WORTHWARD_LONGBRIDGE_CLI_ACCESS="disabled",
        PYTHONDONTWRITEBYTECODE="1",
    )

    completed = subprocess.run(
        [
            sys.executable, "-B", str(PROJECT_ROOT / "scripts/strategy_tune.py"),
            "--strategy", "macd",
            "--ticker", " nvda ",
            "--from", str(frame.Date.iloc[0].date()),
            "--to", str(frame.Date.iloc[-1].date()),
            "--method", method,
            "--params", '{"slow_span":26}',
            "--bounds", '{"fast_span":[2,16]}',
            "--trials", "6",
            "--seed", "19",
            "--output", str(output),
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == str(output / "result.json")
    result, evaluations = _read_artifacts(output)
    assert result["status"] == "completed"
    assert result["method"] == method
    assert result["baseline_only"] is False
    assert len(evaluations) == 6
    assert evaluations == result["trials"]
    assert all(item["status"] == "ok" for item in evaluations)
    assert all(item["params"]["slow_span"] == 26 for item in evaluations)
    assert all(2 <= item["params"]["fast_span"] <= 16 for item in evaluations)
    assert result["best"]["score"] == max(item["score"] for item in evaluations)
    assert result["holdout_used_for_selection"] is False
    assert all(
        fold["to"] < result["holdout"]["from"]
        for trial in evaluations
        for fold in trial["validation"]
    )
    assert result["sources"] == [{"source": str(local_history), "rows": 100}]
    assert local_history.read_bytes() == original
    assert list(market_root.rglob("*.parquet")) == [local_history]
    assert not settings_root.exists()
    assert not compute_root.exists()
