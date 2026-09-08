"""Causal labels, observed bars, and long-only neighbor strategy regressions.

Code version: v1.0.0
"""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from strategies.algorithms import strategy_knn_machine_learning as knn
from strategies.algorithms import strategy_knn_machine_learning_gemini as knn_gemini
from strategies.algorithms import strategy_lorentzian_classification as lorentzian
from strategies.algorithms import strategy_lorentzian_classification_chatgpt as lorentzian_chatgpt
from strategies.algorithms import strategy_lorentzian_classification_gemini as lorentzian_gemini
from tests.factories.market import ohlc_frame_for_dates


KNN_MODULES = (knn, knn_gemini)
LORENTZIAN_MODULES = (lorentzian, lorentzian_gemini, lorentzian_chatgpt)
MODULES = KNN_MODULES + LORENTZIAN_MODULES
STRATEGIES = tuple(
    module.KnnMachineLearningStrategy if module in KNN_MODULES
    else module.LorentzianClassificationStrategy
    for module in MODULES
)


@pytest.fixture(autouse=True)
def serial_neighbor_batches():
    """Keep these small regressions independent of the running research pool."""
    def serial(function, indices, *, static_args=(), **_kwargs):
        return function(tuple(indices), *static_args), None

    with ExitStack() as stack:
        for module in (knn,) + LORENTZIAN_MODULES:
            stack.enter_context(patch.object(module, "map_ordered_batches", side_effect=serial))
        yield


@pytest.fixture
def observed_bars():
    dates = pd.date_range("2025-01-01", periods=100, freq="D").strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("NVDA", dates)
    close = 100.0 + np.arange(100) * 0.1 + np.sin(np.arange(100) / 3) * 4
    frame["Open"] = close - 0.2
    frame["High"] = close + 0.7
    frame["Low"] = close - 0.8
    frame["Close"] = close
    frame["Volume"] = 1_000_000.0 + np.arange(100) * 123.0
    frame.index = pd.Index(np.arange(100) * 3 + 7, name="observation")
    return frame


@pytest.mark.parametrize("module", MODULES)
@pytest.mark.parametrize("prices,expected", [
    ([1, 2, 3, 4, 5], 100.0),
    ([5, 4, 3, 2, 1], 0.0),
    ([3, 3, 3, 3, 3], 50.0),
])
def test_rsi_extremes_preserve_unknown_warmup(module, prices, expected):
    result = module._rsi(pd.Series(prices, dtype="float64"), 3)
    assert result.iloc[:3].isna().all()
    np.testing.assert_allclose(result.iloc[3:], expected)


def test_wilder_rsi_uses_observed_arithmetic_seed_and_recursive_update():
    result = knn._rsi(pd.Series([100.0, 102.0, 101.0, 104.0, 103.0]), 3)
    assert result.iloc[3] == pytest.approx(100 * 5 / 6)
    assert result.iloc[4] == pytest.approx(100 * 2 / 3)


@pytest.mark.parametrize("module", KNN_MODULES)
def test_knn_keeps_flat_neighbors_and_rejects_unobserved_labels(module):
    features = np.array([0.0, 3.0, 0.0])
    labels = np.array([0.0, 1.0, np.nan])
    assert module._knn_prediction_at_index(2, features, features, labels, 1) == 0
    labels[0] = np.nan
    assert module._knn_prediction_at_index(2, features, features, labels, 2) == 1
    assert module._knn_prediction_at_index(2, features, features, labels, 0) == 0


@pytest.mark.parametrize("module", KNN_MODULES)
def test_knn_equal_distance_boundary_prefers_recent_mature_label(module):
    features = np.zeros(4)
    labels = np.array([-1.0, -1.0, 1.0, -1.0])
    assert module._knn_prediction_at_index(3, features, features, labels, 1) == 1
    labels[3] = 1
    assert module._knn_prediction_at_index(3, features, features, labels, 1) == 1


def _lorentzian_vote(module, index, features, labels, *, k=1, history=100):
    if module is lorentzian:
        return module._lorentzian_prediction_at_index(index, features, labels, k, history)
    return module._lorentzian_prediction_at_index(
        index, features, labels, np.ones(len(labels), dtype=bool), k, history, 4, 4,
    )


@pytest.mark.parametrize("module", LORENTZIAN_MODULES)
def test_lorentzian_forward_labels_mature_at_fourth_close(module):
    features = np.zeros((12, 2))
    labels = -np.ones(12)
    labels[3] = 1.0
    assert _lorentzian_vote(module, 3, features, labels) == 0
    assert _lorentzian_vote(module, 7, features, labels) == 1
    labels[4:] *= -1
    assert _lorentzian_vote(module, 7, features, labels) == 1
    labels[3] = np.nan
    assert _lorentzian_vote(module, 7, features, labels) == 0


@pytest.mark.parametrize("module", LORENTZIAN_MODULES)
def test_lorentzian_history_bound_is_relative_to_prediction_origin(module):
    features = np.zeros((12, 2))
    labels = np.ones(12)
    labels[4] = -1
    assert _lorentzian_vote(module, 8, features, labels, k=8, history=4) == -1
    features[4] = np.nan
    assert _lorentzian_vote(module, 8, features, labels, k=8, history=4) == 0


@pytest.mark.parametrize("module", (lorentzian_gemini, lorentzian_chatgpt))
def test_weighted_lorentzian_exact_neutral_matches_do_not_invent_direction(module):
    features = np.ones((13, 2))
    features[[4, 8, 12]] = 0
    labels = np.ones(13)
    labels[[4, 8]] = 0
    assert _lorentzian_vote(module, 12, features, labels, k=3) == 0


@pytest.mark.parametrize("strategy_class", STRATEGIES)
def test_prefix_replay_preserves_signals_index_and_next_open_contract(strategy_class, observed_bars):
    original = observed_bars.copy(deep=True)
    complete = strategy_class().compute_signals(observed_bars)
    assert complete.required_execution_mode == "next_open"
    pd.testing.assert_index_equal(complete.frame.index, observed_bars.index)
    for length in (1, 18, 43, 71):
        prefix = strategy_class().compute_signals(observed_bars.iloc[:length])
        for column in ("buy_signal", "sell_signal", "knn_prediction", "lorentzian_prediction"):
            if column in complete.frame:
                pd.testing.assert_series_equal(prefix.frame[column], complete.frame[column].iloc[:length])
    pd.testing.assert_frame_equal(observed_bars, original)
    empty = strategy_class().compute_signals(observed_bars.iloc[:0])
    assert empty.required_execution_mode == "next_open"
    assert empty.frame["buy_signal"].dtype == bool
    assert empty.frame["sell_signal"].dtype == bool


@pytest.mark.parametrize("strategy_class", STRATEGIES)
@pytest.mark.parametrize("defect", ("missing_open", "infinite_close", "negative_price", "incoherent_range"))
def test_invalid_execution_bars_fail_without_fabrication(strategy_class, observed_bars, defect):
    invalid = observed_bars.iloc[:10].copy()
    if defect == "missing_open":
        invalid = invalid.drop(columns="Open")
    elif defect == "infinite_close":
        invalid.iloc[2, invalid.columns.get_loc("Close")] = np.inf
    elif defect == "negative_price":
        invalid.iloc[2, invalid.columns.get_loc("Open")] = -1.0
    else:
        invalid["High"] = invalid["Low"] - 1
    with pytest.raises(ValueError, match="observed|positive|coherent"):
        strategy_class().compute_signals(invalid)


@pytest.mark.parametrize("strategy_class", STRATEGIES)
def test_neighbor_history_requires_chronological_observations(strategy_class, observed_bars):
    with pytest.raises(ValueError, match="chronological"):
        strategy_class().compute_signals(observed_bars.iloc[::-1])
    duplicate = observed_bars.copy()
    duplicate.iloc[1, duplicate.columns.get_loc("Date")] = duplicate.iloc[0]["Date"]
    with pytest.raises(ValueError, match="unique"):
        strategy_class().compute_signals(duplicate)


@pytest.mark.parametrize("strategy_class", STRATEGIES)
@pytest.mark.parametrize("value", (float("nan"), "inf", 2.5))
def test_numeric_parameters_reject_nonfinite_and_fractional_integers(strategy_class, observed_bars, value):
    key = "short_window" if strategy_class in STRATEGIES[:2] else "f1_param_a"
    with pytest.raises(ValueError, match="finite integer"):
        strategy_class().compute_signals(observed_bars, {key: value})


@pytest.mark.parametrize("module", LORENTZIAN_MODULES)
@pytest.mark.parametrize("value", (float("nan"), float("inf"), "-inf"))
def test_kernel_numeric_parameters_cannot_silently_clamp_nonfinite_values(module, observed_bars, value):
    with pytest.raises(ValueError, match="finite number"):
        module.LorentzianClassificationStrategy().compute_signals(
            observed_bars, {"kernel_relative_weighting": value},
        )


@pytest.mark.parametrize("strategy_class", STRATEGIES)
def test_integer_form_strings_use_requested_value_and_retain_lower_bound(strategy_class, observed_bars):
    key = "short_window" if strategy_class in STRATEGIES[:2] else "f1_param_a"
    strategy = strategy_class()
    expected = strategy.compute_signals(observed_bars, {key: 2}).frame
    actual = strategy.compute_signals(observed_bars, {key: "2.0"}).frame
    pd.testing.assert_frame_equal(actual, expected)
    clamped = strategy.compute_signals(observed_bars, {key: -2}).frame
    minimum = strategy.compute_signals(observed_bars, {key: 1}).frame
    pd.testing.assert_frame_equal(clamped, minimum)


def test_original_lorentzian_pairs_features_with_forward_four_bar_target(observed_bars):
    captured = {}

    def record_training_labels(_function, indices, *, static_args, **_kwargs):
        captured["labels"] = static_args[1]
        return [0.0 for _ in indices], None

    with patch.object(lorentzian, "map_ordered_batches", side_effect=record_training_labels):
        lorentzian.LorentzianClassificationStrategy().compute_signals(observed_bars, {"source": "Close"})
    close = observed_bars["Close"].to_numpy()
    np.testing.assert_array_equal(captured["labels"][:-4], np.sign(close[4:] - close[:-4]))
    assert np.isnan(captured["labels"][-4:]).all()


@pytest.mark.parametrize("module", KNN_MODULES)
def test_knn_volume_is_required_only_for_selected_volume_features(module, observed_bars):
    frame = observed_bars.drop(columns="Volume")
    with pytest.raises(ValueError, match="Volume"):
        module.KnnMachineLearningStrategy().compute_signals(frame)
    result = module.KnnMachineLearningStrategy().compute_signals(frame, {"indicator": "RSI"})
    assert result.required_execution_mode == "next_open"


@pytest.mark.parametrize("strategy_class", STRATEGIES)
def test_short_history_and_flat_market_do_not_produce_trades(strategy_class, observed_bars):
    warmup = strategy_class().compute_signals(observed_bars.iloc[:14]).frame
    assert not warmup[["buy_signal", "sell_signal"]].to_numpy().any()
    flat = observed_bars.copy()
    flat[["Open", "High", "Low", "Close"]] = 100.0
    flat["Volume"] = 100.0
    result = strategy_class().compute_signals(flat).frame
    assert not result[["buy_signal", "sell_signal"]].to_numpy().any()


@pytest.mark.parametrize("module", KNN_MODULES)
def test_knn_holding_limit_counts_complete_bars_after_entry(module, observed_bars):
    votes = np.array([0.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    with patch.object(knn, "map_ordered_batches", return_value=(votes.tolist(), None)):
        result = module.KnnMachineLearningStrategy().compute_signals(
            observed_bars.iloc[:6], {"bar_threshold": 2},
        ).frame
    assert result["buy_signal"].to_numpy().nonzero()[0].tolist() == [1, 4]
    assert result["sell_signal"].to_numpy().nonzero()[0].tolist() == [3]


@pytest.mark.parametrize("module", LORENTZIAN_MODULES)
def test_opposite_classification_exits_without_short_entry_kernel_permission(module, observed_bars):
    votes = np.array([0.0, 1.0, 1.0, -1.0, -1.0, 0.0, 0.0])

    def predictions(_function, indices, **_kwargs):
        return [votes[index] for index in indices], None

    frame = observed_bars.iloc[:len(votes)].copy()
    kernel = pd.Series(np.arange(len(frame)), index=frame.index, dtype="float64")
    with (
        patch.object(module, "map_ordered_batches", side_effect=predictions),
        patch.object(module, "_rational_quadratic_kernel", return_value=kernel),
    ):
        result = module.LorentzianClassificationStrategy().compute_signals(frame, {
            "use_volatility_filter": "Off", "use_regime_filter": "Off", "use_adx_filter": "Off",
            "use_ema_filter": "Off", "use_sma_filter": "Off", "use_kernel_filter": "On",
        }).frame
    entry = 1 if module is lorentzian else 2
    exit_index = 3 if module is lorentzian else 4
    assert result["buy_signal"].to_numpy().nonzero()[0].tolist() == [entry]
    assert result["sell_signal"].to_numpy().nonzero()[0].tolist() == [exit_index]


def test_lorentzian_late_entry_has_own_hold_clock_and_no_orphan_exits():
    signal = pd.Series([0, -1, 1, 1, 1, 1, 1, 1, 1, -1])
    allowed = pd.Series([False, False, False, False, True, True, True, True, True, False])
    buy, sell = lorentzian._long_only_signals(
        signal, allowed, pd.Series(False, index=signal.index), dynamic_exits=False,
    )
    assert np.flatnonzero(buy).tolist() == [4]
    assert np.flatnonzero(sell).tolist() == [8]


def test_dynamic_kernel_exit_uses_selected_alert_and_only_live_long_intent():
    signal = pd.Series([-1, 1, 1, 1, 1, 1, 1])
    allowed = pd.Series([False, True, True, True, True, True, True])
    alert = pd.Series([True, False, False, False, False, False, True])
    buy, sell = lorentzian._long_only_signals(signal, allowed, alert, dynamic_exits=True)
    assert np.flatnonzero(buy).tolist() == [1]
    assert np.flatnonzero(sell).tolist() == [6]
