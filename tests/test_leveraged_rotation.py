"""Tests for the two-ticker leveraged rotation strategy. Code version: v2.4.0."""

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


def test_leveraged_rotation_declares_allocation_controls_and_return_window_signals() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 115.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])

    result = strategy.compute_signals(frame, {
        "buy_leveraged_drop_pct": 10.0,
        "sell_leveraged_rise_pct": 15.0,
    })

    assert strategy.get_default_tickers() == ("QQQ", "TQQQ")
    assert strategy.get_required_ticker_count() == 2
    assert strategy.get_model_interval("1m") == "1d"
    assert strategy.get_signal_bridge("1m") == "daily-close-to-next-session-open"
    assert bool(result.frame.loc[2, "rotation_enter_signal"])
    assert bool(result.frame.loc[4, "rotation_exit_signal"])
    assert result.execution_profile == "leveraged_rotation"
    assert result.required_execution_mode == "next_open"
    assert result.frame["rotation_target_regime"].tolist() == [
        "initial", "initial", "leveraged", "leveraged", "primary", "primary",
    ]
    assert result.metadata["rotation_parameters"]["initial_primary_pct"] == 70.0
    assert result.metadata["rotation_parameters"]["initial_leveraged_pct"] == 25.0
    assert result.metadata["rotation_window"] == "1d"
    assert result.metadata["rotation_window_sessions"] == 1


def test_leveraged_rotation_percentage_controls_use_dynamic_roles_and_hundredth_steps() -> None:
    definitions = {
        definition.key: definition
        for definition in LeveragedRotationStrategy().get_parameter_definitions()
    }
    percentage_keys = {
        "initial_primary_pct",
        "initial_leveraged_pct",
        "primary_min_pct",
        "primary_max_pct",
        "leveraged_min_pct",
        "leveraged_max_pct",
        "buy_leveraged_drop_pct",
        "sell_leveraged_rise_pct",
    }
    assert all(definitions[key].step == 0.01 for key in percentage_keys)
    assert definitions["rotation_window"].options == ("1d", "1w", "1m", "3m")
    assert definitions["rotation_window"].option_labels == (
        "Single day",
        "1 week",
        "1 month",
        "3 months",
    )
    assert definitions["primary_min_pct"].label == "Primary minimum"
    assert definitions["primary_min_pct"].ui_role == "ticker-label:0:minimum"
    assert definitions["leveraged_min_pct"].label == "Leveraged minimum"
    assert definitions["leveraged_min_pct"].ui_role == "ticker-label:1:minimum"
    assert definitions["buy_leveraged_drop_pct"].label == "Buy leveraged: primary decline"
    assert definitions["buy_leveraged_drop_pct"].ui_role == "rotation-trigger:buy-leveraged"
    assert definitions["sell_leveraged_rise_pct"].label == "Buy primary: leveraged rise"
    assert definitions["sell_leveraged_rise_pct"].ui_role == "rotation-trigger:buy-primary"


def test_leveraged_rotation_uses_the_selected_trading_session_window() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 99.0, 98.0, 97.0, 96.0, 95.0, 95.0, 95.0, 95.0, 95.0, 95.0]),
        _asset_frame([50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 51.0, 52.0, 53.0, 54.0, 55.0]),
    ])

    daily = strategy.compute_signals(frame, {
        "rotation_window": "1d",
        "buy_leveraged_drop_pct": 4.0,
        "sell_leveraged_rise_pct": 9.5,
    })
    weekly = strategy.compute_signals(frame, {
        "rotation_window": "1w",
        "buy_leveraged_drop_pct": 4.0,
        "sell_leveraged_rise_pct": 9.5,
    })

    assert not daily.frame["rotation_enter_signal"].any()
    assert bool(weekly.frame.loc[5, "rotation_enter_signal"])
    assert bool(weekly.frame.loc[10, "rotation_exit_signal"])
    assert weekly.frame["rotation_target_regime"].tolist()[5:10] == ["leveraged"] * 5
    assert weekly.metadata["rotation_window"] == "1w"
    assert weekly.metadata["rotation_window_sessions"] == 5
    assert weekly.frame.loc[5, "rotation_primary_window_pct"] == pytest.approx(-5.0)
    assert weekly.frame.loc[10, "rotation_leveraged_window_pct"] == pytest.approx(10.0)


def test_leveraged_rotation_backtest_switches_assets_and_marks_primary_equity() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 110.0, 115.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])
    frame.loc[3, ["Open", "High", "Open_2", "Low_2"]] = [96.0, 96.0, 49.0, 49.0]
    frame.loc[5, ["Open", "Low", "Open_2", "Low_2"]] = [114.0, 114.0, 64.0, 64.0]
    signal_result = strategy.compute_signals(frame, {
        "buy_leveraged_drop_pct": 10.0,
        "sell_leveraged_rise_pct": 15.0,
    })
    signal_result.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(signal_result, 10_000.0, execution_mode="signal_close")
    trades = result["trades"]

    assert result["multi_asset"] is True
    assert [trade["ticker"] for trade in trades] == ["QQQ", "TQQQ", "QQQ", "TQQQ", "TQQQ", "QQQ"]
    assert [trade["side"] for trade in trades] == ["Buy", "Buy", "Sell", "Buy", "Sell", "Buy"]
    assert [trade["shares"] for trade in trades[:2]] == [70, 50]
    assert all(float(trade["shares"]).is_integer() for trade in trades)
    assert result["execution_mode"] == "next_open"
    assert [trade["date"] for trade in trades] == [
        "2026/01/01", "2026/01/01", "2026/01/04", "2026/01/04", "2026/01/06", "2026/01/06",
    ]
    assert [trade["price"] for trade in trades] == [100.0, 50.0, 96.0, 49.0, 64.0, 114.0]
    assert result["initial_allocation"] == {
        "primary_shares": 70,
        "leveraged_shares": 50,
        "primary_open": 100.0,
        "leveraged_open": 50.0,
        "cash": 500.0,
    }
    assert result["summary"]["rotation_count"] == 1
    assert len(result["chart"]["equity"]) == len(frame)
    assert result["chart"]["all_in_equity"] == [
        10_000.0, 10_500.0, 9_400.0, 9_500.0, 11_000.0, 11_500.0,
    ]
    assert result["chart"]["all_in_primary_equity"] == result["chart"]["all_in_equity"]
    assert result["chart"]["all_in_leveraged_equity"] == [
        10_000.0, 11_000.0, 9_000.0, 10_000.0, 12_000.0, 13_000.0,
    ]


def test_leveraged_all_in_reference_uses_its_own_dividend_column() -> None:
    primary = _asset_frame([100.0, 100.0, 100.0])
    leveraged = _asset_frame([50.0, 50.0, 50.0])
    leveraged.loc[1, "Dividends"] = 1.0
    frame = combine_backtest_datasets([primary, leveraged])
    signals = LeveragedRotationStrategy().compute_signals(frame)
    signals.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(
        signals,
        10_000.0,
        include_cash_dividends=True,
        reinvest_cash_dividends=False,
    )

    assert result["chart"]["all_in_primary_equity"] == [10_000.0] * 3
    assert result["chart"]["all_in_leveraged_equity"] == [
        10_000.0, 10_200.0, 10_200.0,
    ]


def test_leveraged_rotation_respects_shared_stop_loss_switch() -> None:
    strategy = LeveragedRotationStrategy()
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 105.0, 94.0, 95.0, 96.0, 97.0]),
        _asset_frame([50.0, 55.0, 45.0, 50.0, 60.0, 65.0]),
    ])
    signal_result = strategy.compute_signals(frame, {"buy_leveraged_drop_pct": 10.0})
    signal_result.metadata["tickers"] = ["QQQ", "TQQQ"]

    result = run_single_ticker_backtest(
        signal_result,
        10_000.0,
        stop_loss_enabled=False,
    )

    assert not any(
        trade["ticker"] == "QQQ" and trade["side"] == "Sell"
        for trade in result["trades"]
    )
    assert result["summary"]["rotation_count"] == 0


@pytest.mark.parametrize("maximum", [0.0, 100.0])
def test_all_cash_start_is_valid_and_can_enter_on_a_later_signal(maximum) -> None:
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 90.0, 90.0]),
        _asset_frame([50.0, 40.0, 40.0]),
    ])
    signals = LeveragedRotationStrategy().compute_signals(frame, {
        "initial_primary_pct": 0.0, "initial_leveraged_pct": 0.0,
        "primary_min_pct": 0.0, "primary_max_pct": maximum,
        "leveraged_min_pct": 0.0, "leveraged_max_pct": maximum,
    })
    result = run_single_ticker_backtest(signals, 10_000.0)
    assert result["initial_allocation"]["cash"] == 10_000.0
    assert result["initial_allocation"]["primary_shares"] == 0
    assert result["initial_allocation"]["leveraged_shares"] == 0
    if maximum == 0:
        assert result["trades"] == []
        assert result["chart"]["equity"] == [10_000.0] * 3
    else:
        assert len(result["trades"]) == 1
        assert result["trades"][0]["date"] == "2026/01/03"
        assert result["trades"][0]["side"] == "Buy"


def test_rotation_accepts_custom_primary_and_leveraged_ticker_pair() -> None:
    frame = combine_backtest_datasets([
        _asset_frame([100.0, 130.0, 90.0, 95.0, 105.0, 132.0, 131.0, 130.0]),
        _asset_frame([50.0, 70.0, 40.0, 42.0, 44.0, 41.0, 43.0, 47.0]),
    ])
    signals = LeveragedRotationStrategy().compute_signals(frame)
    signals.metadata["tickers"] = ["QQQ", "TQQQ"]

    signals.metadata["tickers"] = ["DRAM", "RAM"]
    result = run_single_ticker_backtest(signals, 10_000.0)
    assert result["tickers"] == ["DRAM", "RAM"]
    assert {trade["ticker"] for trade in result["trades"]} == {"DRAM", "RAM"}


def test_rotation_allocation_limits_and_initial_cash_are_normalized() -> None:
    params = LeveragedRotationStrategy().normalize_params({
        "primary_min_pct": 30.0,
        "primary_max_pct": 90.0,
        "leveraged_min_pct": 20.0,
        "leveraged_max_pct": 90.0,
        "initial_primary_pct": 90.0,
        "initial_leveraged_pct": 90.0,
    })
    assert params["primary_max_pct"] == 80.0
    assert params["leveraged_max_pct"] == 70.0
    assert params["initial_primary_pct"] == 80.0
    assert params["initial_leveraged_pct"] == 20.0


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
        LeveragedRotationStrategy().compute_signals(frame, {"buy_leveraged_drop_pct": trigger})


@pytest.mark.parametrize("column", ["Dividends", "Dividends_2"])
@pytest.mark.parametrize("value", [np.nan, np.inf, -1.0, "bad"])
def test_rotation_rejects_invalid_optional_dividends(column: str, value: object) -> None:
    frame = combine_backtest_datasets([_asset_frame([100.0, 90.0]), _asset_frame([50.0, 45.0])])
    frame[column] = frame[column].astype(object)
    frame.loc[1, column] = value
    with pytest.raises(ValueError, match="finite, nonnegative dividends"):
        LeveragedRotationStrategy().compute_signals(frame)
