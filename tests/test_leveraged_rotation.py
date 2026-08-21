"""Tests for the two-ticker leveraged rotation strategy. Code version: v1.0.0."""

from __future__ import annotations

import pandas as pd

from strategies.algorithms.strategy_leveraged_rotation import LeveragedRotationStrategy
from strategies.backtest import combine_backtest_datasets, run_single_ticker_backtest


def _asset_frame(closes: list[float]) -> pd.DataFrame:
    dates = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    return pd.DataFrame({
        "Date": dates,
        "Open": closes,
        "High": closes,
        "Low": closes,
        "Close": closes,
        "Dividends": [0.0] * len(closes),
    })


def test_leveraged_rotation_declares_two_defaults_and_signals_drawdown_recovery() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 115.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])

    result = strategy.compute_signals(frame, {"drawdown_pct": 10.0})

    assert strategy.get_default_tickers() == ("QQQ", "TQQQ")
    assert strategy.get_required_ticker_count() == 2
    assert bool(result.frame.loc[2, "rotation_enter_signal"])
    assert bool(result.frame.loc[4, "rotation_exit_signal"])
    assert result.execution_profile == "leveraged_rotation"


def test_leveraged_rotation_backtest_switches_assets_and_marks_primary_equity() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 115.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])
    signal_result = strategy.compute_signals(frame, {"drawdown_pct": 10.0})
    signal_result.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(signal_result, 10_000.0)
    trades = result["trades"]

    assert result["multi_asset"] is True
    assert [trade["ticker"] for trade in trades] == ["QQQ", "QQQ", "TQQQ", "TQQQ", "QQQ"]
    assert [trade["side"] for trade in trades] == ["Buy", "Sell", "Buy", "Sell", "Buy"]
    assert trades[1]["shares"] == 100.0
    assert trades[2]["shares"] > 0
    assert result["summary"]["rotation_count"] == 1
    assert len(result["chart"]["equity"]) == len(frame)
