"""Causal MACD/SuperTrend signal and execution regressions. Code version: v1.0.0."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from strategies.algorithms.strategy_macd import MacdStrategy
from strategies.algorithms.strategy_macd_gemini import MacdStrategy as MacdGemini
from strategies.algorithms.strategy_supertrend_ai import SupertrendAiStrategy, _atr, _cluster_factor_and_score
from strategies.algorithms.strategy_supertrend_ai_gemini import SupertrendAiStrategy as SupertrendGemini
from strategies.backtest import run_single_ticker_backtest
from tests.factories.market import close_frame_for_dates, ohlc_frame_for_dates

MACD = (MacdStrategy, MacdGemini)
SUPERTREND = (SupertrendAiStrategy, SupertrendGemini)
ALL = (*MACD, *SUPERTREND)


@pytest.fixture
def market_data():
    dates = pd.date_range("2025-01-01", periods=100).strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("QQQ", dates)
    close = 100 + np.arange(100) * 0.03 + 8 * np.sin(np.arange(100) / 3)
    for column, offset in (("Close", 0), ("Open", -0.2), ("High", 1), ("Low", -1)):
        frame[column] = close + offset
    return frame


@pytest.mark.parametrize("strategy_class", MACD)
def test_macd_requires_complete_slow_and_signal_warmup(strategy_class, market_data):
    frame = strategy_class().compute_signals(market_data).frame
    assert frame["macd_line"].iloc[:25].isna().all()
    assert frame["signal_line"].iloc[:33].isna().all()
    assert np.isfinite(frame["signal_line"].iloc[33])
    assert not frame[["buy_signal", "sell_signal"]].iloc[:34].any().any()


@pytest.mark.parametrize("strategy_class", MACD)
def test_macd_recursive_formula_and_neutral_signal(strategy_class):
    dates = pd.date_range("2025-01-01", periods=8).strftime("%Y-%m-%d").tolist()
    source = close_frame_for_dates(dates, [10, 11, 12, 11, 9, 10, 12, 10])
    result = strategy_class().compute_signals(source, {"fast_span": 2, "slow_span": 3, "signal_span": 2}).frame
    assert result.loc[2, "macd_line"] == pytest.approx(11 / 36)
    assert result.loc[3, "macd_line"] == pytest.approx(13 / 216)
    assert result.loc[3, "signal_line"] == pytest.approx(23 / 162)
    neutral = strategy_class().compute_signals(source, {"fast_span": 2, "slow_span": 3, "signal_span": 1}).frame
    assert not neutral[["buy_signal", "sell_signal"]].any().any()


@pytest.mark.parametrize("strategy_class", MACD)
@pytest.mark.parametrize("params", [{"fast_span": 26}, {"fast_span": 30}, {"signal_span": 2.5}])
def test_macd_rejects_invalid_span_domains(strategy_class, params, market_data):
    with pytest.raises(ValueError):
        strategy_class().compute_signals(market_data, params)


@pytest.mark.parametrize("strategy_class", ALL)
@pytest.mark.parametrize("value", [float("nan"), float("inf"), "-inf"])
def test_nonfinite_parameters_fail_locally(strategy_class, value, market_data):
    key = "fast_span" if strategy_class in MACD else "atr_length"
    with pytest.raises(ValueError, match="finite"):
        strategy_class().compute_signals(market_data, {key: value})


@pytest.mark.parametrize("strategy_class", SUPERTREND)
def test_supertrend_history_cap_is_causal_under_appended_future(strategy_class, market_data):
    params = {"historical_bars_calculation": 20, "max_iteration_steps": 20}
    full = strategy_class().compute_signals(market_data, params).frame
    prefix = strategy_class().compute_signals(market_data.iloc[:80], params).frame
    pd.testing.assert_frame_equal(full.iloc[:80], prefix)


@pytest.mark.parametrize("strategy_class", ALL)
def test_future_price_perturbations_and_source_mutation_are_absent(strategy_class, market_data):
    original = market_data.copy(deep=True)
    changed = market_data.copy(deep=True)
    changed.loc[80:, ["Open", "High", "Low", "Close"]] *= 3
    first = strategy_class().compute_signals(market_data).frame
    second = strategy_class().compute_signals(changed).frame
    pd.testing.assert_frame_equal(first.iloc[:80], second.iloc[:80])
    pd.testing.assert_frame_equal(market_data, original)


def test_wilder_atr_uses_complete_sma_seed():
    frame = ohlc_frame_for_dates("QQQ", ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"])
    frame["Open"] = frame["Close"] = 10.0
    frame["High"], frame["Low"] = [11, 12, 13, 14], [9, 8, 7, 6]
    result = _atr(frame, 3)
    assert result.iloc[:2].isna().all()
    assert result.iloc[2] == 4
    assert result.iloc[3] == pytest.approx(16 / 3)


@pytest.mark.parametrize("strategy_class", SUPERTREND)
def test_supertrend_waits_for_atr_warmup(strategy_class, market_data):
    frame = strategy_class().compute_signals(market_data, {"atr_length": 10}).frame
    assert frame["trailing_stop"].iloc[:9].isna().all()
    assert not frame[["buy_signal", "sell_signal"]].iloc[:10].any().any()
    assert np.isfinite(frame["trailing_stop"].iloc[9:]).all()


def test_cluster_selection_handles_duplicate_centroids_and_all_equal_scores():
    assert _cluster_factor_and_score([0, 0, 0, 0, 1], [1, 2, 3, 4, 5], "Best", 100) == (5, 1)
    assert _cluster_factor_and_score([0, 0, 0, 0, 1], [1, 2, 3, 4, 5], "Worst", 100) == (2.5, 0)
    for name in ("Best", "Average", "Worst"):
        assert _cluster_factor_and_score([0, 0, 0], [1, 3, 5], name, 100) == (3, 0)


@pytest.mark.parametrize("strategy_class", SUPERTREND)
def test_fractional_performance_memory_keeps_ama_convex(strategy_class, market_data):
    frame = strategy_class().compute_signals(market_data, {"performance_memory": 2.5}).frame
    assert frame["performance_index"].between(0, 1).all()
    for index in range(10, len(frame)):
        endpoints = [frame.loc[index - 1, "trailing_stop_ama"], frame.loc[index, "trailing_stop"]]
        assert min(endpoints) - 1e-12 <= frame.loc[index, "trailing_stop_ama"] <= max(endpoints) + 1e-12


@pytest.mark.parametrize("strategy_class", SUPERTREND)
def test_history_cap_forgets_expired_performance(strategy_class):
    dates = pd.date_range("2025-01-01", periods=8).strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("QQQ", dates)
    closes = np.array([10, 14, 18, 22, 22, 22, 22, 22], dtype=float)
    frame["Close"] = frame["Open"] = closes
    frame["High"], frame["Low"] = closes + 1, closes - 1
    params = {"atr_length": 1, "min_factor": 1, "max_factor": 1, "performance_memory": 2.5}
    short = strategy_class().compute_signals(frame, {**params, "historical_bars_calculation": 2}).frame
    long = strategy_class().compute_signals(frame, {**params, "historical_bars_calculation": 100}).frame
    assert short["performance_index"].iloc[-1] == 0
    assert long["performance_index"].iloc[-1] > 0


@pytest.mark.parametrize("strategy_class", SUPERTREND)
def test_factor_grid_size_is_bounded_before_allocation(strategy_class, market_data):
    with pytest.raises(ValueError, match="512"):
        strategy_class().compute_signals(market_data, {"max_factor": 100, "factor_step": 0.1})


@pytest.mark.parametrize("strategy_class", SUPERTREND)
@pytest.mark.parametrize("column", ["Open", "High", "Low", "Close"])
def test_supertrend_never_fabricates_missing_price_evidence(strategy_class, column, market_data):
    source = market_data.copy()
    source.loc[20, column] = np.nan
    with pytest.raises(ValueError, match="finite positive"):
        strategy_class().compute_signals(source)
    with pytest.raises(ValueError, match="observed"):
        strategy_class().compute_signals(market_data.drop(columns=column))


@pytest.mark.parametrize("strategy_class", ALL)
def test_execution_mode_is_next_open_on_empty_and_populated_paths(strategy_class, market_data):
    for frame in (market_data, market_data.iloc[:0]):
        assert strategy_class().compute_signals(frame).required_execution_mode == "next_open"


@pytest.mark.parametrize("strategy_class", ALL)
def test_close_derived_entries_fill_only_at_following_observed_open(strategy_class, market_data):
    result = strategy_class().compute_signals(market_data)
    first_signal = np.flatnonzero(result.frame["buy_signal"])[0]
    backtest = run_single_ticker_backtest(result, 10_000, stop_loss_enabled=True)
    entry = backtest["trades"][0]
    assert entry["date"] == market_data.loc[first_signal + 1, "Date"].strftime("%Y/%m/%d")
    assert entry["price"] == pytest.approx(round(market_data.loc[first_signal + 1, "Open"], 4))
    truncated = strategy_class().compute_signals(market_data.iloc[:first_signal + 1])
    assert not run_single_ticker_backtest(truncated, 10_000, stop_loss_enabled=True)["trades"]


def test_catalog_variants_share_the_same_corrected_formulas(market_data):
    for first, second in ((MacdStrategy, MacdGemini), (SupertrendAiStrategy, SupertrendGemini)):
        pd.testing.assert_frame_equal(first().compute_signals(market_data).frame,
                                      second().compute_signals(market_data).frame)


@pytest.mark.parametrize("strategy_class", ALL)
def test_integer_valued_form_strings_are_not_replaced_with_defaults(strategy_class, market_data):
    key = "fast_span" if strategy_class in MACD else "atr_length"
    expected = strategy_class().compute_signals(market_data, {key: 2}).frame
    actual = strategy_class().compute_signals(market_data, {key: "2.0"}).frame
    pd.testing.assert_frame_equal(expected, actual)
