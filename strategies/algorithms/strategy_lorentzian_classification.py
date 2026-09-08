"""
Lorentzian Classification strategy.

Adapted from the original TradingView PineScript by jdehorty.
This port keeps the Lorentzian-distance nearest-neighbour classifier,
feature engineering controls, and the main trend filters, while mapping
short-side transitions to exits for the app's current long-only backtest.

Code version: v0.6.0
- Changed: Catalog this TradingView-derived strategy with the technical-analysis
  strategies used by Backtest and Settings.
- Fixed: Train on mature forward labels, preserve indicator warmup, and track
  actual long-entry intents for next-open execution and bounded holding exits.
"""

from __future__ import annotations


import numpy as np
import pandas as pd

from app.infrastructure.parallel import map_ordered_batches

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix
from .strategy_knn_machine_learning import (
    _atr as _atr,
    _ensure_ohlcv_columns as _ensure_ohlcv_columns,
    _normalize_neighbor_params as _normalize_neighbor_params,
    _rsi as _rsi,
    _true_range as _true_range,
    _wilder_average,
)

LONG = 1
SHORT = -1
NEUTRAL = 0

_PREDICTION_PARALLEL_MIN_ROWS = 64
_PREDICTION_PARALLEL_MAX_WORKERS = 8


def _ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=max(length, 1), adjust=False, min_periods=max(length, 1)).mean()


def _sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(window=max(length, 1), min_periods=max(length, 1)).mean()


def _cci_from_series(series: pd.Series, length: int) -> pd.Series:
    moving_average = series.rolling(window=max(length, 1), min_periods=length).mean()

    def mean_deviation(window: pd.Series) -> float:
        center = float(window.mean())
        return float(np.mean(np.abs(window - center)))

    mean_dev = series.rolling(window=max(length, 1), min_periods=length).apply(mean_deviation, raw=False)
    denominator = (0.015 * mean_dev).replace(0.0, np.nan)
    return ((series - moving_average) / denominator).mask(mean_dev.eq(0), 0.0)


def _adx(frame: pd.DataFrame, length: int) -> pd.Series:
    high = frame["High"]
    low = frame["Low"]
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0),
        index=frame.index,
        dtype="float64",
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
        index=frame.index,
        dtype="float64",
    )
    observed_moves = up_move.notna() & down_move.notna()
    plus_average = _wilder_average(plus_dm.where(observed_moves), length)
    minus_average = _wilder_average(minus_dm.where(observed_moves), length)
    total = plus_average + minus_average
    dx = (100.0 * (plus_average - minus_average).abs() / total.replace(0.0, np.nan)).mask(total.eq(0), 0.0)
    return _wilder_average(dx, length)


def _wave_trend(hlc3: pd.Series, channel_length: int, average_length: int) -> pd.Series:
    esa = _ema(hlc3, channel_length)
    deviation = _ema((hlc3 - esa).abs(), channel_length)
    channel_index = (hlc3 - esa) / (0.015 * deviation.replace(0.0, np.nan))
    wt1 = _ema(channel_index.mask(deviation.eq(0), 0.0), average_length)
    wt2 = _sma(wt1, 4)
    return wt1 - wt2


def _feature_series(
        feature_name: str,
        frame: pd.DataFrame,
        source: pd.Series,
        hlc3: pd.Series,
        param_a: int,
        param_b: int,
) -> pd.Series:
    if feature_name == "RSI":
        return _ema(_rsi(source, param_a), max(param_b, 1))
    if feature_name == "WT":
        return _wave_trend(hlc3, param_a, max(param_b, 1))
    if feature_name == "CCI":
        return _ema(_cci_from_series(source, param_a), max(param_b, 1))
    if feature_name == "ADX":
        return _adx(frame, param_a)
    raise ValueError(f"Unsupported feature: {feature_name}.")


def _rational_quadratic_kernel(series: pd.Series, lookback: int, relative_weight: float, regression_level: int) -> pd.Series:
    values = series.to_numpy(dtype=np.float64)
    result = np.full(len(values), np.nan, dtype=np.float64)
    effective_window = max(lookback, regression_level, 1)
    alpha = max(relative_weight, 1e-6)

    for index in range(len(values)):
        start = max(0, index - effective_window + 1)
        window = values[start:index + 1]
        distances = np.arange(len(window) - 1, -1, -1, dtype=np.float64)
        weights = np.power(1.0 + (np.square(distances) / (2.0 * alpha * max(lookback, 1) ** 2)), -alpha)
        result[index] = float(np.dot(window, weights) / weights.sum())

    return pd.Series(result, index=series.index, dtype="float64")


def _gaussian_kernel(series: pd.Series, lookback: int, regression_level: int) -> pd.Series:
    values = series.to_numpy(dtype=np.float64)
    result = np.full(len(values), np.nan, dtype=np.float64)
    effective_window = max(lookback, regression_level, 1)
    sigma = max(lookback, 1) / 2.0

    for index in range(len(values)):
        start = max(0, index - effective_window + 1)
        window = values[start:index + 1]
        distances = np.arange(len(window) - 1, -1, -1, dtype=np.float64)
        weights = np.exp(-0.5 * np.square(distances / max(sigma, 1e-6)))
        result[index] = float(np.dot(window, weights) / weights.sum())

    return pd.Series(result, index=series.index, dtype="float64")


def _bars_since(condition: pd.Series) -> pd.Series:
    count_since = np.full(len(condition), np.inf, dtype=np.float64)
    last_true = -1
    for index, value in enumerate(condition.astype(bool).to_numpy()):
        if value:
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


def _lorentzian_prediction_at_index(
        index: int,
        features: np.ndarray,
        training_labels: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
) -> float:
    """Compute one causal neighbor vote from matured historical labels."""
    candidates, _ = _mature_lorentzian_neighbors(
        index, features, training_labels, np.isfinite(training_labels),
        neighbors_count, max_bars_back, 4, 4,
    )
    if candidates.size == 0:
        return 0.0
    return float(np.sum(training_labels[candidates]))


def _mature_lorentzian_neighbors(
        current_index: int,
        features: np.ndarray,
        training_labels: np.ndarray,
        label_available: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
        sample_step: int,
        label_horizon: int,
        finite_rows: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Select finite forward labels observable at this close, with recent ties."""
    empty = (np.empty(0, dtype=np.int64), np.empty(0, dtype=np.float64))
    if min(neighbors_count, max_bars_back, sample_step, label_horizon) < 1:
        return empty
    if current_index < label_horizon or not np.isfinite(features[current_index]).all():
        return empty
    matured_end = current_index - label_horizon
    history_start = max(0, current_index - max_bars_back)
    sampled = np.arange(matured_end, history_start - 1, -sample_step, dtype=np.int64)
    if finite_rows is None:
        finite_rows = np.isfinite(features).all(axis=1)
    valid = sampled[
        finite_rows[sampled]
        & label_available[sampled]
        & np.isfinite(training_labels[sampled])
    ]
    if valid.size == 0:
        return empty
    distances = np.log1p(np.abs(features[valid] - features[current_index])).sum(axis=1)
    nearest = np.lexsort((-valid, distances))[:neighbors_count]
    return valid[nearest], distances[nearest]


def _long_only_signals(
        signal: pd.Series,
        entry_allowed: pd.Series,
        bearish_alert: pd.Series,
        *,
        dynamic_exits: bool,
        holding_bars: int = 4,
) -> tuple[pd.Series, pd.Series]:
    """Replay entry/exit intents; hold age belongs to the actual entry event."""
    buy = np.zeros(len(signal), dtype=bool)
    sell = np.zeros(len(signal), dtype=bool)
    entry_index: int | None = None
    previously_eligible = False
    for index, direction in enumerate(signal.to_numpy(dtype=np.int64)):
        eligible = direction == LONG and bool(entry_allowed.iloc[index])
        if entry_index is not None:
            timed_exit = not dynamic_exits and index - entry_index >= holding_bars
            kernel_exit = dynamic_exits and bool(bearish_alert.iloc[index])
            if direction == SHORT or timed_exit or kernel_exit:
                sell[index] = True
                entry_index = None
        elif eligible and not previously_eligible:
            buy[index] = True
            entry_index = index
        previously_eligible = eligible
    return (
        pd.Series(buy, index=signal.index, dtype="bool"),
        pd.Series(sell, index=signal.index, dtype="bool"),
    )


def _lorentzian_prediction_batch(
        indices: tuple[int, ...],
        features: np.ndarray,
        training_labels: np.ndarray,
        neighbors_count: int,
        max_bars_back: int,
) -> list[float]:
    return [
        _lorentzian_prediction_at_index(
            int(index),
            features,
            training_labels,
            neighbors_count,
            max_bars_back,
        )
        for index in indices
    ]


class LorentzianClassificationStrategy(BaseStrategy):
    strategy_id = "lorentzian-classification"
    strategy_name = "Lorentzian Classification"
    strategy_description = (
        "Lorentzian-distance approximate nearest-neighbour classifier adapted from "
        "jdehorty's PineScript, with configurable feature engineering, filters, "
        "and kernel-based exit logic."
    )
    strategy_category = "technical-analysis"
    strategy_display_order = 50
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
                default=5,
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
                default="Off",
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
                default="Off",
                options=("Off", "On"),
                help_text="Requires the kernel trend estimate to agree with the machine learning signal before the strategy trades.",
            ),
            StrategyParameterDefinition(
                key="use_kernel_smoothing",
                label="Enhance Kernel Smoothing",
                kind="choice",
                default="Off",
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
        frame = _ensure_ohlcv_columns(dataset)
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool")
            frame["sell_signal"] = pd.Series(dtype="bool")
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
                required_execution_mode="next_open",
            )

        normalized_params = _normalize_neighbor_params(self, params)
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
        feature_matrix: list[np.ndarray] = []
        for name_key, param_a_key, param_b_key in feature_keys[:feature_count]:
            feature_series = _feature_series(
                str(normalized_params[name_key]),
                frame,
                source,
                hlc3,
                int(normalized_params[param_a_key]),
                int(normalized_params[param_b_key]),
            )
            feature_matrix.append(feature_series.to_numpy(dtype=np.float64))

        training_labels = np.sign(source.shift(-4) - source).to_numpy(dtype=np.float64)
        prediction_values = np.zeros(len(frame), dtype=np.float64)
        signal_values = np.zeros(len(frame), dtype=np.int64)

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
        is_ema_uptrend = pd.Series(True, index=frame.index) if not use_ema_filter else (close > ema_line)
        is_sma_uptrend = pd.Series(True, index=frame.index) if not use_sma_filter else (close > sma_line)

        yhat1 = _rational_quadratic_kernel(source, kernel_lookback, kernel_relative_weighting, kernel_regression_level)
        yhat2 = _gaussian_kernel(source, max(kernel_lookback - kernel_lag, 1), kernel_regression_level)

        is_bearish_rate = yhat1.shift(1) > yhat1
        is_bullish_rate = yhat1.shift(1) < yhat1
        was_bullish_rate = yhat1.shift(2) < yhat1.shift(1)
        is_bearish_change = (is_bearish_rate & was_bullish_rate).fillna(False)
        is_bearish_cross_alert = ((yhat2 < yhat1) & (yhat2.shift(1) >= yhat1.shift(1))).fillna(False)
        is_bullish_smooth = (yhat2 >= yhat1).fillna(False)
        alert_bearish = is_bearish_cross_alert if use_kernel_smoothing else is_bearish_change
        is_bullish = (
            is_bullish_smooth if use_kernel_smoothing else is_bullish_rate.fillna(False)
        ) if use_kernel_filter else pd.Series(True, index=frame.index)

        # Optimization: Use numpy for k-NN search
        features = np.stack(feature_matrix, axis=1)  # (N, features)
        prediction_values_list, _ = map_ordered_batches(
            _lorentzian_prediction_batch,
            range(1, len(frame)),
            mode="cpu",
            static_args=(features, training_labels, neighbors_count, max_bars_back),
            min_items=_PREDICTION_PARALLEL_MIN_ROWS,
            max_workers=_PREDICTION_PARALLEL_MAX_WORKERS,
        )
        prediction_values = np.zeros(len(frame), dtype=np.float64)
        if prediction_values_list:
            prediction_values[1:] = np.asarray(prediction_values_list, dtype=np.float64)
        current_signal = NEUTRAL
        entry_allowed = pd.Series(False, index=frame.index, dtype="bool")

        for i in range(1, len(frame)):
            prediction = float(prediction_values[i])
            volatility_ok = (atr_fast.iloc[i] > atr_slow.iloc[i]) if use_volatility_filter else True
            regime_ok = (regime_series.iloc[i] > regime_threshold) if use_regime_filter else True
            adx_ok = (adx_series.iloc[i] > adx_threshold) if use_adx_filter else True
            filter_all = bool(volatility_ok and regime_ok and adx_ok)

            if prediction > 0 and filter_all:
                current_signal = LONG
            elif prediction < 0 and filter_all:
                current_signal = SHORT

            signal_values[i] = current_signal
            entry_allowed.iloc[i] = bool(prediction > 0 and filter_all)

        signal_series = pd.Series(signal_values, index=frame.index, dtype="int64")
        buy_signal, sell_signal = _long_only_signals(
            signal_series,
            entry_allowed & is_bullish & is_ema_uptrend & is_sma_uptrend,
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
