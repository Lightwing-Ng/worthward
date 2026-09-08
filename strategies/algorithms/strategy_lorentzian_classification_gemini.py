"""Gemini variant of the Lorentzian Classification strategy.

Code version: v0.3.0
- Fixed: Reuse causal indicators and mature neighbor selection, honor neutral
  exact matches, and replay observed long-entry intents with next-open fills.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.infrastructure.parallel import map_ordered_batches

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix
from .strategy_lorentzian_classification import (
    _adx as _adx,
    _atr as _atr,
    _cci_from_series as _cci_from_series,
    _ema as _ema,
    _ensure_ohlcv_columns as _ensure_ohlcv_columns,
    _feature_series as _feature_series,
    _gaussian_kernel as _gaussian_kernel,
    _long_only_signals,
    _mature_lorentzian_neighbors,
    _normalize_neighbor_params,
    _rational_quadratic_kernel as _rational_quadratic_kernel,
    _rsi as _rsi,
    _sma as _sma,
    _true_range as _true_range,
    _wave_trend as _wave_trend,
)

LONG = 1
SHORT = -1
NEUTRAL = 0

_PREDICTION_PARALLEL_MIN_ROWS = 64
_PREDICTION_PARALLEL_MAX_WORKERS = 8


def _bars_since(condition: pd.Series) -> pd.Series:
    arr = condition.to_numpy(dtype=bool)
    count_since = np.full(len(arr), np.inf, dtype=np.float64)
    last_true = -1

    for index in range(len(arr)):
        if arr[index]:
            last_true = index
            count_since[index] = 0.0
        elif last_true >= 0:
            count_since[index] = float(index - last_true)

    return pd.Series(count_since, index=condition.index, dtype="float64")


def _shift_bool(series: pd.Series, periods: int) -> pd.Series:
    shifted = series.astype(bool).shift(periods)
    return shifted.where(~shifted.isna(), False).astype(bool)


def _shift_int(series: pd.Series, periods: int, fill_value: int = 0) -> pd.Series:
    return series.shift(periods).fillna(fill_value).astype(int)


def _bars_held_from_signal(signal_series: pd.Series) -> pd.Series:
    # 1.1 Vectorization: Replacing explicit loop with vectorized group counts
    changed = signal_series.diff().ne(0)
    groups = changed.cumsum()
    bars_held = signal_series.groupby(groups).cumcount()
    return pd.Series(bars_held.to_numpy(), index=signal_series.index, dtype="int64")


def _lorentzian_prediction_at_index(
        current_index: int,
        features: np.ndarray,
        training_labels: np.ndarray,
        label_available: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
        sample_step: int,
        label_horizon: int,
        finite_rows: np.ndarray | None = None,
) -> float:
    candidates, distances = _mature_lorentzian_neighbors(
        current_index, features, training_labels, label_available,
        neighbors_count, max_bars_back, sample_step, label_horizon, finite_rows,
    )
    if candidates.size == 0:
        return 0.0
    labels = training_labels[candidates].astype(np.float64)
    exact_matches = distances == 0
    if exact_matches.any():
        return float(labels[exact_matches].mean())
    weights = distances.min() / distances
    vote = float(np.dot(labels, weights) / weights.sum())
    return 0.0 if abs(vote) < 1e-12 else vote


def _lorentzian_prediction_batch(
        indices: tuple[int, ...],
        features: np.ndarray,
        training_labels: np.ndarray,
        label_available: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
        sample_step: int,
        label_horizon: int,
        finite_rows: np.ndarray,
) -> list[float]:
    return [
        _lorentzian_prediction_at_index(
            int(current_index),
            features,
            training_labels,
            label_available,
            neighbors_count,
            max_bars_back,
            sample_step,
            label_horizon,
            finite_rows,
        )
        for current_index in indices
    ]


def _lorentzian_knn_predictions(
        features: np.ndarray,
        training_labels: np.ndarray,
        label_available: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
        *,
        sample_step: int = 4,
        label_horizon: int = 4,
) -> np.ndarray:
    n_rows = features.shape[0]
    predictions = np.zeros(n_rows, dtype=np.float64)
    if n_rows == 0:
        return predictions

    finite_rows = np.isfinite(features).all(axis=1)
    prediction_values, _ = map_ordered_batches(
        _lorentzian_prediction_batch,
        range(1, n_rows),
        mode="cpu",
        static_args=(
            features,
            training_labels,
            label_available,
            neighbors_count,
            max_bars_back,
            sample_step,
            label_horizon,
            finite_rows,
        ),
        min_items=_PREDICTION_PARALLEL_MIN_ROWS,
        max_workers=_PREDICTION_PARALLEL_MAX_WORKERS,
    )
    if prediction_values:
        predictions[1:] = np.asarray(prediction_values, dtype=np.float64)

    return predictions


class LorentzianClassificationStrategy(BaseStrategy):
    strategy_id = "lorentzian-classification-gemini"
    strategy_name = "Lorentzian Classification (Gemini)"
    strategy_description = (
        "Lorentzian-distance approximate nearest-neighbour classifier adapted from "
        "jdehorty's PineScript, with configurable feature engineering, filters, "
        "and kernel-based exit logic."
    )
    strategy_category = "machine_learning"
    strategy_display_order = 51
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        feature_options = ("RSI", "WT", "CCI", "ADX")
        return (
            StrategyParameterDefinition(
                key="source",
                group="factors",
                label="Source",
                kind="choice",
                default="Close",
                options=("Close", "HLC3", "OHLC4"),
                help_text="Chooses which price series the model studies. Close is the simplest option, while HLC3 and OHLC4 smooth price using more of each bar.",
            ),
            StrategyParameterDefinition(
                key="neighbors_count",
                label="Neighbors Count",
                kind="integer",
                default=8,
                minimum=1,
                maximum=100,
                help_text="Sets how many nearby historical matches vote on the next move. Lower values react faster but can be noisier.",
            ),
            StrategyParameterDefinition(
                key="max_bars_back",
                label="Max Bars Back",
                kind="integer",
                default=2_000,
                minimum=100,
                help_text="Sets how much history the model is allowed to search. More bars give broader context but cost more time to process.",
            ),
            StrategyParameterDefinition(
                key="feature_count",
                group="factors",
                label="Feature Count",
                kind="integer",
                default=4,
                minimum=2,
                maximum=5,
                help_text="Sets how many engineered features are fed into the Lorentzian distance model. More features add context but can make the model slower and more selective.",
            ),
            StrategyParameterDefinition(
                key="use_dynamic_exits",
                label="Use Dynamic Exits",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Lets the strategy close trades early when the trend estimate weakens, instead of always waiting for the fixed holding rule.",
            ),
            StrategyParameterDefinition(
                key="use_volatility_filter",
                group="factors",
                label="Use Volatility Filter",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Only allows trades when the short-term volatility check says the market is active enough.",
            ),
            StrategyParameterDefinition(
                key="use_regime_filter",
                group="factors",
                label="Use Regime Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades when the regime test says price action is trending rather than drifting sideways.",
            ),
            StrategyParameterDefinition(
                key="use_adx_filter",
                group="factors",
                label="Use ADX Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades when ADX is strong enough to suggest a trend is present.",
            ),
            StrategyParameterDefinition(
                key="regime_threshold",
                group="factors",
                label="Regime Threshold",
                kind="number",
                default=-0.1,
                minimum=-10.0,
                maximum=10.0,
                step=0.1,
                help_text="Sets how strict the regime filter is. Higher values demand clearer trend conditions before the model can trade.",
            ),
            StrategyParameterDefinition(
                key="adx_threshold",
                group="factors",
                label="ADX Threshold",
                kind="integer",
                default=20,
                minimum=0,
                maximum=100,
                help_text="Sets the minimum ADX score needed when the ADX filter is on. Higher values require a stronger trend.",
            ),
            StrategyParameterDefinition(
                key="f1_string",
                group="factors",
                label="Feature 1",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="Chooses the first feature fed into the model. Each feature captures a different kind of market behaviour.",
            ),
            StrategyParameterDefinition(
                key="f1_param_a",
                group="factors",
                label="Feature 1 Param A",
                kind="integer",
                default=14,
                minimum=1,
                help_text="Sets the main lookback period for Feature 1.",
            ),
            StrategyParameterDefinition(
                key="f1_param_b",
                group="factors",
                label="Feature 1 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 1 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f2_string",
                group="factors",
                label="Feature 2",
                kind="choice",
                default="WT",
                options=feature_options,
                help_text="Chooses the second feature fed into the model so it can compare more than one market signal at once.",
            ),
            StrategyParameterDefinition(
                key="f2_param_a",
                group="factors",
                label="Feature 2 Param A",
                kind="integer",
                default=10,
                minimum=1,
                help_text="Sets the main lookback period for Feature 2.",
            ),
            StrategyParameterDefinition(
                key="f2_param_b",
                group="factors",
                label="Feature 2 Param B",
                kind="integer",
                default=11,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 2 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f3_string",
                group="factors",
                label="Feature 3",
                kind="choice",
                default="CCI",
                options=feature_options,
                help_text="Chooses the third feature used by the classifier.",
            ),
            StrategyParameterDefinition(
                key="f3_param_a",
                group="factors",
                label="Feature 3 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Sets the main lookback period for Feature 3.",
            ),
            StrategyParameterDefinition(
                key="f3_param_b",
                group="factors",
                label="Feature 3 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 3 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f4_string",
                group="factors",
                label="Feature 4",
                kind="choice",
                default="ADX",
                options=feature_options,
                help_text="Chooses the fourth feature used by the classifier.",
            ),
            StrategyParameterDefinition(
                key="f4_param_a",
                group="factors",
                label="Feature 4 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Sets the main lookback period for Feature 4.",
            ),
            StrategyParameterDefinition(
                key="f4_param_b",
                group="factors",
                label="Feature 4 Param B",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 4 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f5_string",
                group="factors",
                label="Feature 5",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="Chooses the optional fifth feature used when Feature Count is set to 5.",
            ),
            StrategyParameterDefinition(
                key="f5_param_a",
                group="factors",
                label="Feature 5 Param A",
                kind="integer",
                default=9,
                minimum=1,
                help_text="Sets the main lookback period for Feature 5.",
            ),
            StrategyParameterDefinition(
                key="f5_param_b",
                group="factors",
                label="Feature 5 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 5 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="use_ema_filter",
                group="factors",
                label="Use EMA Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows long trades above the EMA and short signals below it when switched on.",
            ),
            StrategyParameterDefinition(
                key="ema_period",
                group="factors",
                label="EMA Period",
                kind="integer",
                default=200,
                minimum=1,
                help_text="Sets the EMA lookback used by the EMA trend filter.",
            ),
            StrategyParameterDefinition(
                key="use_sma_filter",
                group="factors",
                label="Use SMA Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades that agree with the SMA trend check when switched on.",
            ),
            StrategyParameterDefinition(
                key="sma_period",
                group="factors",
                label="SMA Period",
                kind="integer",
                default=200,
                minimum=1,
                help_text="Sets the SMA lookback used by the SMA trend filter.",
            ),
            StrategyParameterDefinition(
                key="use_kernel_filter",
                label="Trade with Kernel",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Requires the kernel trend estimate to agree with the machine learning signal before the strategy trades.",
            ),
            StrategyParameterDefinition(
                key="use_kernel_smoothing",
                label="Enhance Kernel Smoothing",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Uses the smoother crossover version of the kernel signal. This usually cuts down the number of colour changes and trade flips.",
            ),
            StrategyParameterDefinition(
                key="kernel_lookback",
                label="Kernel Lookback Window",
                kind="integer",
                default=5,
                minimum=3,
                help_text="Sets how many recent bars the kernel estimate studies at one time.",
            ),
            StrategyParameterDefinition(
                key="kernel_relative_weighting",
                label="Kernel Relative Weighting",
                kind="number",
                default=8.0,
                minimum=0.25,
                maximum=25.0,
                step=0.25,
                help_text="Sets how strongly the kernel favours nearby bars over older ones. Lower values lean more on longer-term structure.",
            ),
            StrategyParameterDefinition(
                key="kernel_regression_level",
                label="Kernel Regression Level",
                kind="integer",
                default=8,
                minimum=2,
                help_text="Sets how tightly the kernel line follows price. Lower values hug price more closely.",
            ),
            StrategyParameterDefinition(
                key="kernel_lag",
                label="Kernel Lag",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Sets the lag used when the smoothed kernel crossover is checked. Lower values react earlier.",
            ),
        )

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        """Compute mature forward-label votes and next-open long-only intents."""
        frame = _ensure_ohlcv_columns(dataset.copy())
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool", index=frame.index)
            frame["sell_signal"] = pd.Series(dtype="bool", index=frame.index)
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
                required_execution_mode="next_open",
            )

        normalized_params = _normalize_neighbor_params(self, params)
        index = frame.index

        close = frame["Close"]
        hlc3 = (frame["High"] + frame["Low"] + frame["Close"]) / 3.0
        ohlc4 = (frame["Open"] + frame["High"] + frame["Low"] + frame["Close"]) / 4.0

        source_name = str(normalized_params["source"])
        source = {
            "Close": close,
            "HLC3": hlc3,
            "OHLC4": ohlc4,
        }.get(source_name, close)

        neighbors_count = int(normalized_params["neighbors_count"])
        max_bars_back = int(normalized_params["max_bars_back"])
        feature_count = int(normalized_params["feature_count"])

        use_dynamic_exits = str(normalized_params["use_dynamic_exits"]) == "On"
        use_volatility_filter = str(normalized_params["use_volatility_filter"]) == "On"
        use_regime_filter = str(normalized_params["use_regime_filter"]) == "On"
        use_adx_filter = str(normalized_params["use_adx_filter"]) == "On"

        regime_threshold = float(normalized_params["regime_threshold"])
        adx_threshold = int(normalized_params["adx_threshold"])

        use_ema_filter = str(normalized_params["use_ema_filter"]) == "On"
        ema_period = int(normalized_params["ema_period"])
        use_sma_filter = str(normalized_params["use_sma_filter"]) == "On"
        sma_period = int(normalized_params["sma_period"])

        use_kernel_filter = str(normalized_params["use_kernel_filter"]) == "On"
        use_kernel_smoothing = str(normalized_params["use_kernel_smoothing"]) == "On"
        kernel_lookback = int(normalized_params["kernel_lookback"])
        kernel_relative_weighting = float(normalized_params["kernel_relative_weighting"])
        kernel_regression_level = int(normalized_params["kernel_regression_level"])
        kernel_lag = int(normalized_params["kernel_lag"])

        feature_keys = (
            ("f1_string", "f1_param_a", "f1_param_b"),
            ("f2_string", "f2_param_a", "f2_param_b"),
            ("f3_string", "f3_param_a", "f3_param_b"),
            ("f4_string", "f4_param_a", "f4_param_b"),
            ("f5_string", "f5_param_a", "f5_param_b"),
        )

        feature_cache: dict[tuple[str, int, int], pd.Series] = {}

        def get_feature(name_key: str, param_a_key: str, param_b_key: str) -> pd.Series:
            feature_name = str(normalized_params[name_key])
            param_a = int(normalized_params[param_a_key])
            param_b = int(normalized_params[param_b_key])
            cache_key = (feature_name, param_a, param_b)

            if cache_key not in feature_cache:
                feature_cache[cache_key] = _feature_series(
                    feature_name,
                    frame,
                    source,
                    hlc3,
                    param_a,
                    param_b,
                )
            return feature_cache[cache_key]

        feature_arrays: list[np.ndarray] = []
        for name_key, param_a_key, param_b_key in feature_keys[:feature_count]:
            feature_arrays.append(get_feature(name_key, param_a_key, param_b_key).to_numpy(dtype=np.float64))

        features = np.column_stack(feature_arrays)

        label_horizon = 4
        training_label_series = np.sign(source.shift(-label_horizon) - source)
        training_labels = training_label_series.to_numpy(dtype=np.float64)
        label_available = (source.notna() & source.shift(-label_horizon).notna()).to_numpy(dtype=bool)

        prediction_values = _lorentzian_knn_predictions(
            features,
            training_labels,
            label_available,
            neighbors_count,
            max_bars_back,
            sample_step=4,
            label_horizon=label_horizon,
        )

        atr_fast = _atr(frame, 1)
        atr_slow = _atr(frame, 10)
        adx_series = _adx(frame, 14)

        regime_basis = _ema(ohlc4, 20)
        regime_series = (
                regime_basis.diff(5)
                / regime_basis.abs().rolling(window=20, min_periods=1).mean().replace(0.0, np.nan)
        )

        ema_line = _ema(close, ema_period)
        sma_line = _sma(close, sma_period)

        # 1.2 Feature Engineering: Safely casting boolean indices without warnings
        is_ema_uptrend = pd.Series(True, index=index, dtype=bool) if not use_ema_filter else (close > ema_line).fillna(False)

        is_sma_uptrend = pd.Series(True, index=index, dtype=bool) if not use_sma_filter else (close > sma_line).fillna(False)


        yhat1 = _rational_quadratic_kernel(
            source,
            kernel_lookback,
            kernel_relative_weighting,
            kernel_regression_level,
        )
        yhat2 = _gaussian_kernel(
            source,
            max(kernel_lookback - kernel_lag, 1),
            kernel_regression_level,
        )

        is_bearish_rate = (yhat1.shift(1) > yhat1).fillna(False)
        is_bullish_rate = (yhat1.shift(1) < yhat1).fillna(False)
        was_bullish_rate = (yhat1.shift(2) < yhat1.shift(1)).fillna(False)

        is_bearish_change = (is_bearish_rate & was_bullish_rate).fillna(False)
        is_bearish_cross_alert = ((yhat2 < yhat1) & (yhat2.shift(1) >= yhat1.shift(1))).fillna(False)

        is_bullish_smooth = (yhat2 >= yhat1).fillna(False)

        alert_bearish = is_bearish_cross_alert if use_kernel_smoothing else is_bearish_change

        is_bullish = (
            is_bullish_smooth if use_kernel_smoothing else is_bullish_rate
        ) if use_kernel_filter else pd.Series(True, index=index, dtype=bool)

        volatility_ok = (atr_fast > atr_slow).fillna(False) if use_volatility_filter else pd.Series(True, index=index, dtype=bool)
        regime_ok = (regime_series > regime_threshold).fillna(False) if use_regime_filter else pd.Series(True, index=index, dtype=bool)
        adx_ok = (adx_series > adx_threshold).fillna(False) if use_adx_filter else pd.Series(True, index=index, dtype=bool)

        filter_all = (volatility_ok & regime_ok & adx_ok).fillna(False)

        prediction_direction = pd.Series(
            np.sign(prediction_values).astype(np.int64),
            index=index,
            dtype="int64",
        )
        previous_direction = _shift_int(prediction_direction, 1, fill_value=NEUTRAL)

        confirmed_long = prediction_direction.eq(LONG) & previous_direction.eq(LONG)
        confirmed_short = prediction_direction.eq(SHORT) & previous_direction.eq(SHORT)

        signal_values = np.zeros(len(frame), dtype=np.int64)
        current_signal = NEUTRAL

        for i in range(len(frame)):
            if not bool(filter_all.iloc[i]):
                signal_values[i] = current_signal
                continue

            if bool(confirmed_long.iloc[i]):
                current_signal = LONG
            elif bool(confirmed_short.iloc[i]):
                current_signal = SHORT

            signal_values[i] = current_signal

        signal_series = pd.Series(signal_values, index=index, dtype="int64")
        buy_signal, sell_signal = _long_only_signals(
            signal_series,
            confirmed_long & filter_all & is_bullish & is_ema_uptrend & is_sma_uptrend,
            alert_bearish,
            dynamic_exits=use_dynamic_exits,
        )

        frame["lorentzian_prediction"] = prediction_values
        frame["lorentzian_signal"] = signal_series
        frame["buy_signal"] = buy_signal
        frame["sell_signal"] = sell_signal

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
        )
