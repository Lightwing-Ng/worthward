from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


LONG = 1
SHORT = -1
NEUTRAL = 0


def _ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=max(length, 1), adjust=False, min_periods=1).mean()


def _sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(window=max(length, 1), min_periods=1).mean()


def _rsi(series: pd.Series, length: int) -> pd.Series:
    delta = series.diff()
    gains = delta.clip(lower=0.0)
    losses = (-delta).clip(lower=0.0)
    average_gain = gains.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=length).mean()
    average_loss = losses.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=length).mean()
    relative_strength = average_gain / average_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + relative_strength))
    return rsi.fillna(50.0)


def _cci_from_series(series: pd.Series, length: int) -> pd.Series:
    moving_average = series.rolling(window=max(length, 1), min_periods=length).mean()

    def mean_deviation(window: pd.Series) -> float:
        center = float(window.mean())
        return float(np.mean(np.abs(window - center)))

    mean_dev = series.rolling(window=max(length, 1), min_periods=length).apply(mean_deviation, raw=False)
    denominator = (0.015 * mean_dev).replace(0.0, np.nan)
    return ((series - moving_average) / denominator).fillna(0.0)


def _true_range(frame: pd.DataFrame) -> pd.Series:
    previous_close = frame["Close"].shift(1)
    ranges = pd.concat(
        [
            frame["High"] - frame["Low"],
            (frame["High"] - previous_close).abs(),
            (frame["Low"] - previous_close).abs(),
        ],
        axis=1,
    )
    return ranges.max(axis=1)


def _atr(frame: pd.DataFrame, length: int) -> pd.Series:
    return _true_range(frame).ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean()


def _adx(frame: pd.DataFrame, length: int) -> pd.Series:
    high = frame["High"]
    low = frame["Low"]
    close = frame["Close"]

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

    atr = _true_range(frame).ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean()
    plus_di = 100.0 * plus_dm.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean() / atr.replace(0.0, np.nan)
    minus_di = 100.0 * minus_dm.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean() / atr.replace(0.0, np.nan)
    dx = (100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)).fillna(0.0)
    return dx.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean().fillna(0.0)


def _wave_trend(hlc3: pd.Series, channel_length: int, average_length: int) -> pd.Series:
    esa = _ema(hlc3, channel_length)
    deviation = _ema((hlc3 - esa).abs(), channel_length)
    channel_index = (hlc3 - esa) / (0.015 * deviation.replace(0.0, np.nan))
    wt1 = _ema(channel_index.fillna(0.0), average_length)
    wt2 = _sma(wt1, 4)
    return (wt1 - wt2).fillna(0.0)


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
        window = values[start : index + 1]
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
        window = values[start : index + 1]
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


class LorentzianClassificationGrokStrategy(BaseStrategy):
    strategy_id = "lorentzian-classification-grok"
    strategy_name = "Lorentzian Classification (Grok)"
    strategy_description = (
        "Lorentzian-distance approximate nearest-neighbour classifier v2 (fixed signal generation, "
        "corrected bullish_change logic, robust confirmation & ATR stop)"
    )
    strategy_category = "machine_learning"
    strategy_display_order = 55
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
                label="Source",
                kind="choice",
                default="Close",
                options=("Close", "HLC3", "OHLC4"),
                help_text="Price series used by the model",
            ),
            StrategyParameterDefinition(
                key="neighbors_count",
                label="Neighbors Count",
                kind="integer",
                default=8,
                minimum=1,
                maximum=100,
                help_text="Number of nearest historical matches",
            ),
            StrategyParameterDefinition(
                key="max_bars_back",
                label="Max Bars Back",
                kind="integer",
                default=2000,
                minimum=100,
                help_text="Maximum history to search",
            ),
            StrategyParameterDefinition(
                key="feature_count",
                label="Feature Count",
                kind="integer",
                default=4,
                minimum=2,
                maximum=5,
                help_text="Number of engineered features",
            ),
            StrategyParameterDefinition(
                key="use_dynamic_exits",
                label="Use Dynamic Exits",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Enable dynamic kernel-based exits",
            ),
            StrategyParameterDefinition(
                key="use_volatility_filter",
                label="Use Volatility Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Require sufficient short-term volatility",
            ),
            StrategyParameterDefinition(
                key="use_regime_filter",
                label="Use Regime Filter",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Require trending regime",
            ),
            StrategyParameterDefinition(
                key="use_adx_filter",
                label="Use ADX Filter",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Require strong ADX trend",
            ),
            StrategyParameterDefinition(
                key="regime_threshold",
                label="Regime Threshold",
                kind="number",
                default=0.0,
                minimum=-10.0,
                maximum=10.0,
                step=0.1,
                help_text="Minimum regime strength",
            ),
            StrategyParameterDefinition(
                key="adx_threshold",
                label="ADX Threshold",
                kind="integer",
                default=25,
                minimum=0,
                maximum=100,
                help_text="Minimum ADX value",
            ),
            StrategyParameterDefinition(
                key="f1_string",
                label="Feature 1",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="First feature",
            ),
            StrategyParameterDefinition(
                key="f1_param_a",
                label="Feature 1 Param A",
                kind="integer",
                default=14,
                minimum=1,
                help_text="Primary lookback",
            ),
            StrategyParameterDefinition(
                key="f1_param_b",
                label="Feature 1 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Secondary parameter",
            ),
            StrategyParameterDefinition(
                key="f2_string",
                label="Feature 2",
                kind="choice",
                default="WT",
                options=feature_options,
                help_text="Second feature",
            ),
            StrategyParameterDefinition(
                key="f2_param_a",
                label="Feature 2 Param A",
                kind="integer",
                default=10,
                minimum=1,
                help_text="Primary lookback",
            ),
            StrategyParameterDefinition(
                key="f2_param_b",
                label="Feature 2 Param B",
                kind="integer",
                default=11,
                minimum=1,
                help_text="Secondary parameter",
            ),
            StrategyParameterDefinition(
                key="f3_string",
                label="Feature 3",
                kind="choice",
                default="CCI",
                options=feature_options,
                help_text="Third feature",
            ),
            StrategyParameterDefinition(
                key="f3_param_a",
                label="Feature 3 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Primary lookback",
            ),
            StrategyParameterDefinition(
                key="f3_param_b",
                label="Feature 3 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Secondary parameter",
            ),
            StrategyParameterDefinition(
                key="f4_string",
                label="Feature 4",
                kind="choice",
                default="ADX",
                options=feature_options,
                help_text="Fourth feature",
            ),
            StrategyParameterDefinition(
                key="f4_param_a",
                label="Feature 4 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Primary lookback",
            ),
            StrategyParameterDefinition(
                key="f4_param_b",
                label="Feature 4 Param B",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Secondary parameter",
            ),
            StrategyParameterDefinition(
                key="f5_string",
                label="Feature 5",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="Fifth feature (when Feature Count = 5)",
            ),
            StrategyParameterDefinition(
                key="f5_param_a",
                label="Feature 5 Param A",
                kind="integer",
                default=9,
                minimum=1,
                help_text="Primary lookback",
            ),
            StrategyParameterDefinition(
                key="f5_param_b",
                label="Feature 5 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Secondary parameter",
            ),
            StrategyParameterDefinition(
                key="use_ema_filter",
                label="Use EMA Filter",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Require price above EMA",
            ),
            StrategyParameterDefinition(
                key="ema_period",
                label="EMA Period",
                kind="integer",
                default=200,
                minimum=1,
                help_text="EMA length",
            ),
            StrategyParameterDefinition(
                key="use_sma_filter",
                label="Use SMA Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Require price above SMA",
            ),
            StrategyParameterDefinition(
                key="sma_period",
                label="SMA Period",
                kind="integer",
                default=200,
                minimum=1,
                help_text="SMA length",
            ),
            StrategyParameterDefinition(
                key="use_kernel_filter",
                label="Trade with Kernel",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Require kernel trend agreement",
            ),
            StrategyParameterDefinition(
                key="use_kernel_smoothing",
                label="Enhance Kernel Smoothing",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Use smoothed kernel crossover",
            ),
            StrategyParameterDefinition(
                key="kernel_lookback",
                label="Kernel Lookback Window",
                kind="integer",
                default=5,
                minimum=3,
                help_text="Kernel window size",
            ),
            StrategyParameterDefinition(
                key="kernel_relative_weighting",
                label="Kernel Relative Weighting",
                kind="number",
                default=8.0,
                minimum=0.25,
                maximum=25.0,
                step=0.25,
                help_text="Kernel weighting strength",
            ),
            StrategyParameterDefinition(
                key="kernel_regression_level",
                label="Kernel Regression Level",
                kind="integer",
                default=8,
                minimum=2,
                help_text="Kernel smoothing tightness",
            ),
            StrategyParameterDefinition(
                key="kernel_lag",
                label="Kernel Lag",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Kernel lag for smoothing",
            ),
            # v2 enhancements
            StrategyParameterDefinition(
                key="prediction_horizon",
                label="Prediction / Hold Horizon (bars)",
                kind="integer",
                default=8,
                minimum=4,
                help_text="Bars for label calculation and default hold period",
                unit_hint="bars",
            ),
            StrategyParameterDefinition(
                key="signal_confirmation_bars",
                label="Signal Confirmation Bars",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Consecutive bars required for confirmation",
                unit_hint="bars",
            ),
            StrategyParameterDefinition(
                key="use_atr_stop",
                label="Use ATR Stop Loss",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Enable ATR-based stop loss",
            ),
            StrategyParameterDefinition(
                key="atr_stop_multiplier",
                label="ATR Stop Multiplier",
                kind="number",
                default=2.0,
                minimum=0.5,
                maximum=5.0,
                step=0.1,
                help_text="ATR multiplier for stop distance",
            ),
        )

    def compute_signals(
        self,
        dataset: pd.DataFrame,
        params: dict | None = None,
    ) -> StrategySignalResult:
        frame = dataset.copy()
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool")
            frame["sell_signal"] = pd.Series(dtype="bool")
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
        close = frame["Close"]
        hlc3 = (frame["High"] + frame["Low"] + frame["Close"]) / 3.0
        ohlc4 = (frame["Open"] + frame["High"] + frame["Low"] + frame["Close"]) / 4.0
        source_name = str(normalized_params["source"])
        source = {"Close": close, "HLC3": hlc3, "OHLC4": ohlc4}.get(source_name, close)

        neighbors_count = int(normalized_params["neighbors_count"])
        max_bars_back = int(normalized_params["max_bars_back"])
        feature_count = int(normalized_params["feature_count"])
        horizon = int(normalized_params.get("prediction_horizon", 8))
        confirmation_bars = int(normalized_params.get("signal_confirmation_bars", 2))
        use_atr_stop = str(normalized_params.get("use_atr_stop", "On")) == "On"
        atr_stop_mult = float(normalized_params.get("atr_stop_multiplier", 2.0))

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

        training_labels = np.sign(source - source.shift(horizon)).fillna(0.0).astype(int).to_numpy(dtype=np.int64)

        prediction_values = np.zeros(len(frame), dtype=np.float64)
        signal_values = np.zeros(len(frame), dtype=np.int64)

        atr_fast = _atr(frame, 1)
        atr_slow = _atr(frame, 10)
        adx_series = _adx(frame, 14)
        regime_basis = _ema(ohlc4, 20)
        regime_series = (
            regime_basis.diff(5)
            / regime_basis.abs().rolling(window=20, min_periods=1).mean().replace(0.0, np.nan)
        ).fillna(0.0)

        ema_line = _ema(close, ema_period)
        sma_line = _sma(close, sma_period)
        is_ema_uptrend = pd.Series(True, index=frame.index) if not use_ema_filter else (close > ema_line)
        is_sma_uptrend = pd.Series(True, index=frame.index) if not use_sma_filter else (close > sma_line)

        yhat1 = _rational_quadratic_kernel(source, kernel_lookback, kernel_relative_weighting, kernel_regression_level)
        yhat2 = _gaussian_kernel(source, max(kernel_lookback - kernel_lag, 1), kernel_regression_level)

        is_bearish_rate = yhat1.shift(1) > yhat1
        is_bullish_rate = yhat1.shift(1) < yhat1
        was_bearish_rate = yhat1.shift(2) > yhat1.shift(1)
        was_bullish_rate = yhat1.shift(2) < yhat1.shift(1)
        is_bearish_change = (is_bearish_rate & was_bullish_rate).fillna(False)
        is_bullish_change = (is_bullish_rate & was_bearish_rate).fillna(False)  # FIXED: was_bearish_rate
        is_bullish_cross_alert = ((yhat2 > yhat1) & (yhat2.shift(1) <= yhat1.shift(1))).fillna(False)
        is_bearish_cross_alert = ((yhat2 < yhat1) & (yhat2.shift(1) >= yhat1.shift(1))).fillna(False)
        is_bullish_smooth = (yhat2 >= yhat1).fillna(False)
        is_bearish_smooth = (yhat2 <= yhat1).fillna(False)
        alert_bullish = is_bullish_cross_alert if use_kernel_smoothing else is_bullish_change
        alert_bearish = is_bearish_cross_alert if use_kernel_smoothing else is_bearish_change
        is_bullish = (
            is_bullish_smooth if use_kernel_smoothing else is_bullish_rate.fillna(False)
        ) if use_kernel_filter else pd.Series(True, index=frame.index)

        atr14 = _atr(frame, 14)
        entry_price = np.full(len(frame), np.nan, dtype=np.float64)
        current_entry = np.nan

        for index in range(len(frame)):
            # Lorentzian prediction
            start = max(0, index - max_bars_back)
            last_distance = -1.0
            distances: list[float] = []
            predictions: list[int] = []

            current_features = [series[index] for series in feature_matrix]
            if all(np.isfinite(value) for value in current_features) and index > 0:
                for history_index in range(start, index):
                    if history_index % 4 == 0:
                        distance = 0.0
                        valid_history = True
                        for feature_values, current_value in zip(feature_matrix, current_features, strict=True):
                            historical_value = feature_values[history_index]
                            if not np.isfinite(historical_value):
                                valid_history = False
                                break
                            distance += math.log1p(abs(current_value - historical_value))

                        if valid_history and distance >= last_distance:
                            last_distance = distance
                            distances.append(distance)
                            predictions.append(int(training_labels[history_index]))
                            if len(predictions) > neighbors_count:
                                quartile_index = min(
                                    len(distances) - 1,
                                    int(round(neighbors_count * 3 / 4)),
                                )
                                last_distance = distances[quartile_index]
                                distances.pop(0)
                                predictions.pop(0)

            prediction = float(sum(predictions))
            prediction_values[index] = prediction

            # Filters
            volatility_ok = (atr_fast.iloc[index] > atr_slow.iloc[index]) if use_volatility_filter else True
            regime_ok = (regime_series.iloc[index] > regime_threshold) if use_regime_filter else True
            adx_ok = (adx_series.iloc[index] > adx_threshold) if use_adx_filter else True
            filter_all = bool(volatility_ok and regime_ok and adx_ok)

            raw_signal = LONG if prediction > 0 and filter_all else (SHORT if prediction < 0 and filter_all else NEUTRAL)

            # Signal confirmation (fixed: use raw_signal and update signal_values)
            final_signal = NEUTRAL
            if index >= confirmation_bars - 1:
                recent_signals = signal_values[index - confirmation_bars + 1 : index + 1]
                if np.all(recent_signals == LONG) or (raw_signal == LONG and confirmation_bars == 1):
                    final_signal = LONG
                    if np.isnan(current_entry):
                        current_entry = float(close.iloc[index])
                        entry_price[index] = current_entry
                elif np.all(recent_signals == SHORT) or (raw_signal == SHORT and confirmation_bars == 1):
                    final_signal = SHORT
            else:
                final_signal = raw_signal

            signal_values[index] = final_signal

            # ATR stop (only on long, fixed: update signal_values)
            if use_atr_stop and not np.isnan(current_entry) and final_signal == LONG:
                stop_price = current_entry - atr14.iloc[index] * atr_stop_mult
                if close.iloc[index] < stop_price:
                    final_signal = NEUTRAL
                    current_entry = np.nan
                    signal_values[index] = NEUTRAL

        signal_series = pd.Series(signal_values, index=frame.index, dtype="int64")
        signal_changed = signal_series.ne(_shift_int(signal_series, 1, fill_value=NEUTRAL))

        bars_held = np.zeros(len(frame), dtype=np.int64)
        for index in range(len(frame)):
            if index == 0 or signal_changed.iloc[index]:
                bars_held[index] = 0
            else:
                bars_held[index] = bars_held[index - 1] + 1
        bars_held_series = pd.Series(bars_held, index=frame.index, dtype="int64")

        is_held_horizon = bars_held_series.eq(horizon)
        is_held_less_than_horizon = bars_held_series.gt(0) & bars_held_series.lt(horizon)
        is_buy_signal = signal_series.eq(LONG) & is_ema_uptrend & is_sma_uptrend
        is_last_signal_buy = (
            _shift_int(signal_series, horizon, fill_value=NEUTRAL).eq(LONG)
            & _shift_bool(is_ema_uptrend, horizon)
        )

        # Fix: Original logic required signal_changed (only triggers on first bar)
        # But with confirmation_bars >= 1, signal_changed is already false when condition is met
        # Fix: Track position state and generate buy when entering a new long position
        in_position = [False] * len(frame)
        start_long_trade = [False] * len(frame)
        end_long_trade_strict = [False] * len(frame)

        for i in range(len(frame)):
            if i == 0:
                prev_in_position = False
            else:
                prev_in_position = in_position[i - 1]

            current_is_long = is_buy_signal.iloc[i] and is_bullish.iloc[i]
            if not prev_in_position and current_is_long:
                # Entering long position
                in_position[i] = True
                start_long_trade[i] = True
            elif prev_in_position:
                in_position[i] = True
                # Check if we need to exit (strict horizon-based exit)
                # exit condition will be checked after start_long_trade is defined
            else:
                in_position[i] = False
                start_long_trade[i] = False

        # Now that start_long_trade is defined, compute strict exits
        start_long_trade = pd.Series(start_long_trade, index=frame.index, dtype=bool)
        in_position = pd.Series(in_position, index=frame.index, dtype=bool)
        bars_held = np.zeros(len(frame), dtype=np.int64)
        for index in range(len(frame)):
            if index == 0 or start_long_trade.iloc[index]:
                bars_held[index] = 0
            elif in_position.iloc[index]:
                bars_held[index] = bars_held[index - 1] + 1
            else:
                bars_held[index] = 0
        bars_held_series = pd.Series(bars_held, index=frame.index, dtype=np.int64)

        is_held_horizon = bars_held_series.eq(horizon)
        is_held_less_than_horizon = bars_held_series.gt(0) & bars_held_series.lt(horizon)

        for index in range(len(frame)):
            if not in_position.iloc[index]:
                continue
            if (is_held_horizon.iloc[index] and is_last_signal_buy.iloc[index]) or (
                is_held_less_than_horizon.iloc[index] and signal_series.iloc[index] != LONG
            ):
                if index + horizon < len(frame):
                    end_long_trade_strict[index + horizon] = True
                else:
                    end_long_trade_strict[index] = True

        end_long_trade_strict = pd.Series(end_long_trade_strict, index=frame.index, dtype=bool)

        bars_since_long_entry = _bars_since(start_long_trade)
        bars_since_bearish_exit = _bars_since(alert_bearish)
        is_valid_long_exit = bars_since_bearish_exit > bars_since_long_entry
        end_long_trade_dynamic = is_bearish_change & _shift_bool(is_valid_long_exit, 1) & in_position

        end_long_trade = end_long_trade_dynamic if use_dynamic_exits else end_long_trade_strict

        frame["lorentzian_prediction"] = prediction_values
        frame["lorentzian_signal"] = signal_series
        frame["buy_signal"] = start_long_trade.fillna(False).astype(bool)
        frame["sell_signal"] = end_long_trade.fillna(False).astype(bool)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )