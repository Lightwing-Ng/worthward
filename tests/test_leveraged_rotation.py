"""Tests for the two-ticker leveraged rotation strategy. Code version: v1.1.0."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from strategies.algorithms.strategy_leveraged_rotation import LeveragedRotationStrategy
from strategies.backtest import combine_backtest_datasets, run_single_ticker_backtest
from tests.factories.market import ohlc_frame_for_dates


def _asset_frame(closes: list[float]) -> pd.DataFrame:
    dates = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    frame = ohlc_frame_for_dates("QQQ", dates.strftime("%Y-%m-%d").tolist())
    for column in ("Open", "High", "Low", "Close"):
        frame[column] = closes
    frame["Dividends"] = 0.0
    return frame


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
    assert result.required_execution_mode == "next_open"
    assert result.frame["rotation_target_asset"].tolist() == [1, 1, 2, 2, 1, 1]


def test_leveraged_rotation_backtest_switches_assets_and_marks_primary_equity() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 115.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])
    frame.loc[3, ["Open", "High", "Open_2", "Low_2"]] = [96.0, 96.0, 49.0, 49.0]
    frame.loc[5, ["Open", "Low", "Open_2", "Low_2"]] = [114.0, 114.0, 64.0, 64.0]
    signal_result = strategy.compute_signals(frame, {"drawdown_pct": 10.0})
    signal_result.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(signal_result, 10_000.0, execution_mode="signal_close")
    trades = result["trades"]

    assert result["multi_asset"] is True
    assert [trade["ticker"] for trade in trades] == ["QQQ", "QQQ", "TQQQ", "TQQQ", "QQQ"]
    assert [trade["side"] for trade in trades] == ["Buy", "Sell", "Buy", "Sell", "Buy"]
    assert trades[1]["shares"] == 100.0
    assert trades[2]["shares"] > 0
    assert result["execution_mode"] == "next_open"
    assert [trade["date"] for trade in trades] == [
        "2026/01/01", "2026/01/04", "2026/01/04", "2026/01/06", "2026/01/06",
    ]
    assert [trade["price"] for trade in trades] == [100.0, 96.0, 49.0, 64.0, 114.0]
    assert result["summary"]["rotation_count"] == 1
    assert len(result["chart"]["equity"]) == len(frame)


def test_leveraged_rotation_respects_shared_stop_loss_switch() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 96.0, 97.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])
    signal_result = strategy.compute_signals(frame, {"drawdown_pct": 10.0})
    signal_result.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(
        signal_result,
        10_000.0,
        stop_loss_enabled=False,
    )

    assert [trade["ticker"] for trade in result["trades"]] == ["QQQ"]
    assert result["summary"]["rotation_count"] == 0


def test_rotation_retries_entry_and_recovery_after_blocked_open_exits() -> None:
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 130.0, 90.0, 95.0, 105.0, 132.0, 131.0, 130.0]),
        _asset_frame([50.0, 70.0, 40.0, 42.0, 44.0, 41.0, 43.0, 47.0]),
    ])
    signals = LeveragedRotationStrategy().compute_signals(frame)
    signals.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(signals, 10_000.0, stop_loss_enabled=False)

    assert [trade["date"] for trade in result["trades"]] == [
        "2026/01/01", "2026/01/05", "2026/01/05", "2026/01/08", "2026/01/08",
    ]
    assert [trade["price"] for trade in result["trades"]] == [100.0, 105.0, 44.0, 47.0, 130.0]
    assert result["summary"]["active_ticker"] == "QQQ"
    assert result["summary"]["rotation_count"] == 1


def test_rotation_recovery_intent_survives_same_day_successful_pending_entry() -> None:
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 109.0, 108.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 61.0, 62.0]),
    ])
    signals = LeveragedRotationStrategy().compute_signals(frame)
    signals.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(signals, 10_000.0, stop_loss_enabled=False)

    # A gap-up permits the previously blocked entry on day 5. The protected
    # executor skips that day's close decision; the retained recovery retries.
    assert [trade["date"] for trade in result["trades"]] == [
        "2026/01/01", "2026/01/05", "2026/01/05", "2026/01/07", "2026/01/07",
    ]
    assert result["summary"]["active_ticker"] == "QQQ"


def test_rotation_is_prefix_causal_and_does_not_mutate_input() -> None:
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 109.0, 108.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 61.0, 62.0]),
    ])
    original = frame.copy(deep=True)
    strategy = LeveragedRotationStrategy()
    full = strategy.compute_signals(frame).frame
    for length in range(1, len(frame)):
        prefix = strategy.compute_signals(frame.iloc[:length]).frame
        pd.testing.assert_frame_equal(prefix, full.iloc[:length])
    pd.testing.assert_frame_equal(frame, original)


@pytest.mark.parametrize("column", ["Date", "Open", "Open_2", "Close_2", "High", "Low_2"])
def test_rotation_requires_explicit_aligned_market_columns(column: str) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    with pytest.raises(ValueError, match="requires Date and aligned"):
        LeveragedRotationStrategy().compute_signals(frame.drop(columns=column))


@pytest.mark.parametrize("value", [np.nan, np.inf, -np.inf, 0.0, -1.0, "bad"])
@pytest.mark.parametrize("column", ["Open", "Close", "Close_2", "Open_2"])
def test_rotation_rejects_invalid_prices_without_dropping_history(column: str, value: object) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 130.0, 95.0]), _asset_frame([50.0, 70.0, 45.0])])
    frame[column] = frame[column].astype(object)
    frame.loc[1, column] = value
    with pytest.raises(ValueError, match="finite, positive OHLC"):
        LeveragedRotationStrategy().compute_signals(frame)


@pytest.mark.parametrize("column,value", [("High", 99.0), ("Low", 101.0), ("High_2", 49.0), ("Low_2", 51.0)])
def test_rotation_rejects_incoherent_price_bounds(column: str, value: float) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    frame.loc[0, column] = value
    with pytest.raises(ValueError, match="coherent OHLC"):
        LeveragedRotationStrategy().compute_signals(frame)


@pytest.mark.parametrize("dates", [["bad", "2026-01-02"], ["2026-01-01", "2026-01-01"], ["2026-01-02", "2026-01-01"], [1, 2], [1, "2026-01-02"]])
def test_rotation_requires_unambiguous_chronology(dates: list[object]) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    frame["Date"] = dates
    with pytest.raises(ValueError, match="ordered, unique dates"):
        LeveragedRotationStrategy().compute_signals(frame)


@pytest.mark.parametrize("trigger", [np.nan, np.inf, -np.inf, "bad", None])
def test_rotation_rejects_nonfinite_trigger_locally(trigger: object) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    with pytest.raises(ValueError, match="finite number"):
        LeveragedRotationStrategy().compute_signals(frame, {"drawdown_pct": trigger})


@pytest.mark.parametrize("column", ["Dividends", "Dividends_2"])
@pytest.mark.parametrize("value", [np.nan, np.inf, -1.0, "bad"])
def test_rotation_rejects_invalid_optional_dividends(column: str, value: object) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    frame[column] = frame[column].astype(object)
    frame.loc[1, column] = value
    with pytest.raises(ValueError, match="finite, nonnegative dividends"):
        LeveragedRotationStrategy().compute_signals(frame)
