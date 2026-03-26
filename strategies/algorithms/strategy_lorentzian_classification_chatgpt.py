from __future__ import annotations

import numpy as np
import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix

LONG = 1
SHORT = -1
NEUTRAL = 0


def _ensure_ohlcv_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    close = pd.to_numeric(normalized["Close"], errors="coerce")

    for column in ("Open", "High", "Low"):
        if column not in normalized.columns:
            normalized[column] = close
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").fillna(close)

    if "Volume" not in normalized.columns:
        normalized["Volume"] = pd.Series(0.0, index=normalized.index, dtype="float64")
    else:
        normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce").fillna(0.0)

    normalized["Close"] = close
    return normalized


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
    window = max(length, 1)
    moving_average = series.rolling(window=window, min_periods=window).mean()

    def mean_deviation(values: np.ndarray) -> float:
        center = float(values.mean())
        return float(np.abs(values - center).mean())

    mean_dev = series.rolling(window=window, min_periods=window).apply(mean_deviation, raw=True)
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
    plus_di = (
            100.0
            * plus_dm.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean()
            / atr.replace(0.0, np.nan)
    )
    minus_di = (
            100.0
            * minus_dm.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=1).mean()
            / atr.replace(0.0, np.nan)
    )
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


def _rational_quadratic_kernel(
        series: pd.Series,
        lookback: int,
        relative_weight: float,
        regression_level: int,
) -> pd.Series:
    values = series.to_numpy(dtype=np.float64)
    result = np.full(len(values), np.nan, dtype=np.float64)
    effective_window = max(lookback, regression_level, 1)
    alpha = max(relative_weight, 1e-6)

    for index in range(len(values)):
        start = max(0, index - effective_window + 1)
        window = values[start: index + 1]
        distances = np.arange(len(window) - 1, -1, -1, dtype=np.float64)
        weights = np.power(
            1.0 + (np.square(distances) / (2.0 * alpha * max(lookback, 1) ** 2)),
            -alpha,
        )
        result[index] = float(np.dot(window, weights) / weights.sum())

    return pd.Series(result, index=series.index, dtype="float64")


def _gaussian_kernel(series: pd.Series, lookback: int, regression_level: int) -> pd.Series:
    values = series.to_numpy(dtype=np.float64)
    result = np.full(len(values), np.nan, dtype=np.float64)
    effective_window = max(lookback, regression_level, 1)
    sigma = max(lookback, 1) / 2.0

    for index in range(len(values)):
        start = max(0, index - effective_window + 1)
        window = values[start: index + 1]
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


def _bars_held_from_signal(signal_series: pd.Series) -> pd.Series:
    values = signal_series.to_numpy(dtype=np.int64)
    bars_held = np.zeros(len(values), dtype=np.int64)

    for index in range(1, len(values)):
        if values[index] != values[index - 1]:
            bars_held[index] = 0
        else:
            bars_held[index] = bars_held[index - 1] + 1

    return pd.Series(bars_held, index=signal_series.index, dtype="int64")


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

    for current_index in range(1, n_rows):
        if not finite_rows[current_index]:
            continue

        matured_end = current_index - label_horizon
        if matured_end < 0:
            continue

        history_start = max(0, matured_end - max_bars_back)
        sampled_idx = np.arange(history_start, matured_end + 1, sample_step, dtype=np.int64)
        if sampled_idx.size == 0:
            continue

        valid_idx = sampled_idx[finite_rows[sampled_idx] & label_available[sampled_idx]]
        if valid_idx.size == 0:
            continue

        hist_features = features[valid_idx]
        distances = np.log1p(np.abs(hist_features - features[current_index])).sum(axis=1)

        k = min(neighbors_count, distances.size)
        if k <= 0:
            continue

        if k < distances.size:
            near_idx = np.argpartition(distances, k - 1)[:k]
        else:
            near_idx = np.arange(distances.size)

        near_distances = distances[near_idx]
        near_labels = training_labels[valid_idx[near_idx]].astype(np.float64)
        weights = 1.0 / np.maximum(near_distances, 1e-9)

        predictions[current_index] = float(np.dot(near_labels, weights) / weights.sum())

    return predictions


class LorentzianClassificationStrategy(BaseStrategy):
    strategy_id = "lorentzian-classification-chatgpt"
    strategy_name = "Lorentzian Classification (ChatGPT)"
    strategy_description = (
        "Lorentzian-distance approximate nearest-neighbour classifier adapted from "
        "jdehorty's PineScript, with configurable feature engineering, filters, "
        "and kernel-based exit logic."
    )
    strategy_category = "machine_learning"
    strategy_display_order = 52
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
                label="Use Volatility Filter",
                kind="choice",
                default="On",
                options=("Off", "On"),
                help_text="Only allows trades when the short-term volatility check says the market is active enough.",
            ),
            StrategyParameterDefinition(
                key="use_regime_filter",
                label="Use Regime Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades when the regime test says price action is trending rather than drifting sideways.",
            ),
            StrategyParameterDefinition(
                key="use_adx_filter",
                label="Use ADX Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades when ADX is strong enough to suggest a trend is present.",
            ),
            StrategyParameterDefinition(
                key="regime_threshold",
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
                label="ADX Threshold",
                kind="integer",
                default=20,
                minimum=0,
                maximum=100,
                help_text="Sets the minimum ADX score needed when the ADX filter is on. Higher values require a stronger trend.",
            ),
            StrategyParameterDefinition(
                key="f1_string",
                label="Feature 1",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="Chooses the first feature fed into the model. Each feature captures a different kind of market behaviour.",
            ),
            StrategyParameterDefinition(
                key="f1_param_a",
                label="Feature 1 Param A",
                kind="integer",
                default=14,
                minimum=1,
                help_text="Sets the main lookback period for Feature 1.",
            ),
            StrategyParameterDefinition(
                key="f1_param_b",
                label="Feature 1 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 1 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f2_string",
                label="Feature 2",
                kind="choice",
                default="WT",
                options=feature_options,
                help_text="Chooses the second feature fed into the model so it can compare more than one market signal at once.",
            ),
            StrategyParameterDefinition(
                key="f2_param_a",
                label="Feature 2 Param A",
                kind="integer",
                default=10,
                minimum=1,
                help_text="Sets the main lookback period for Feature 2.",
            ),
            StrategyParameterDefinition(
                key="f2_param_b",
                label="Feature 2 Param B",
                kind="integer",
                default=11,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 2 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f3_string",
                label="Feature 3",
                kind="choice",
                default="CCI",
                options=feature_options,
                help_text="Chooses the third feature used by the classifier.",
            ),
            StrategyParameterDefinition(
                key="f3_param_a",
                label="Feature 3 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Sets the main lookback period for Feature 3.",
            ),
            StrategyParameterDefinition(
                key="f3_param_b",
                label="Feature 3 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 3 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f4_string",
                label="Feature 4",
                kind="choice",
                default="ADX",
                options=feature_options,
                help_text="Chooses the fourth feature used by the classifier.",
            ),
            StrategyParameterDefinition(
                key="f4_param_a",
                label="Feature 4 Param A",
                kind="integer",
                default=20,
                minimum=1,
                help_text="Sets the main lookback period for Feature 4.",
            ),
            StrategyParameterDefinition(
                key="f4_param_b",
                label="Feature 4 Param B",
                kind="integer",
                default=2,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 4 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="f5_string",
                label="Feature 5",
                kind="choice",
                default="RSI",
                options=feature_options,
                help_text="Chooses the optional fifth feature used when Feature Count is set to 5.",
            ),
            StrategyParameterDefinition(
                key="f5_param_a",
                label="Feature 5 Param A",
                kind="integer",
                default=9,
                minimum=1,
                help_text="Sets the main lookback period for Feature 5.",
            ),
            StrategyParameterDefinition(
                key="f5_param_b",
                label="Feature 5 Param B",
                kind="integer",
                default=1,
                minimum=1,
                help_text="Sets the secondary tuning value for Feature 5 when that indicator uses one.",
            ),
            StrategyParameterDefinition(
                key="use_ema_filter",
                label="Use EMA Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows long trades above the EMA and short signals below it when switched on.",
            ),
            StrategyParameterDefinition(
                key="ema_period",
                label="EMA Period",
                kind="integer",
                default=200,
                minimum=1,
                help_text="Sets the EMA lookback used by the EMA trend filter.",
            ),
            StrategyParameterDefinition(
                key="use_sma_filter",
                label="Use SMA Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Only allows trades that agree with the SMA trend check when switched on.",
            ),
            StrategyParameterDefinition(
                key="sma_period",
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
        """
        Code version: v1.2.0
        Changes:
        - Use forward labels for a true 4-bar-ahead classification target.
        - Exclude non-matured samples from the k-NN history window.
        - Use distance-weighted Lorentzian voting instead of raw vote sum.
        - Add two-bar confirmation before signal flips to reduce whipsaw.
        - Preserve the original dataset index.
        """
        frame = _ensure_ohlcv_columns(dataset.copy())
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool", index=frame.index)
            frame["sell_signal"] = pd.Series(dtype="bool", index=frame.index)
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
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
        training_label_series = np.sign(source.shift(-label_horizon) - source).fillna(0.0)
        training_labels = training_label_series.to_numpy(dtype=np.int64)
        label_available = source.shift(-label_horizon).notna().to_numpy(dtype=bool)

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
        ).fillna(0.0)

        ema_line = _ema(close, ema_period)
        sma_line = _sma(close, sma_period)

        is_ema_uptrend = (
            pd.Series(True, index=index, dtype="bool")
            if not use_ema_filter
            else (close > ema_line).fillna(False)
        )
        is_ema_downtrend = (
            pd.Series(True, index=index, dtype="bool")
            if not use_ema_filter
            else (close < ema_line).fillna(False)
        )
        is_sma_uptrend = (
            pd.Series(True, index=index, dtype="bool")
            if not use_sma_filter
            else (close > sma_line).fillna(False)
        )
        is_sma_downtrend = (
            pd.Series(True, index=index, dtype="bool")
            if not use_sma_filter
            else (close < sma_line).fillna(False)
        )

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
        was_bearish_rate = (yhat1.shift(2) > yhat1.shift(1)).fillna(False)
        was_bullish_rate = (yhat1.shift(2) < yhat1.shift(1)).fillna(False)

        is_bearish_change = (is_bearish_rate & was_bullish_rate).fillna(False)
        is_bullish_change = (is_bullish_rate & was_bearish_rate).fillna(False)

        is_bullish_cross_alert = ((yhat2 > yhat1) & (yhat2.shift(1) <= yhat1.shift(1))).fillna(False)
        is_bearish_cross_alert = ((yhat2 < yhat1) & (yhat2.shift(1) >= yhat1.shift(1))).fillna(False)

        is_bullish_smooth = (yhat2 >= yhat1).fillna(False)
        is_bearish_smooth = (yhat2 <= yhat1).fillna(False)

        alert_bullish = is_bullish_cross_alert if use_kernel_smoothing else is_bullish_change
        alert_bearish = is_bearish_cross_alert if use_kernel_smoothing else is_bearish_change

        is_bullish = (
            is_bullish_smooth if use_kernel_smoothing else is_bullish_rate
        ) if use_kernel_filter else pd.Series(True, index=index, dtype="bool")
        is_bearish = (
            is_bearish_smooth if use_kernel_smoothing else is_bearish_rate
        ) if use_kernel_filter else pd.Series(True, index=index, dtype="bool")

        volatility_ok = (
            (atr_fast > atr_slow).fillna(False)
            if use_volatility_filter
            else pd.Series(True, index=index, dtype="bool")
        )
        regime_ok = (
            (regime_series > regime_threshold).fillna(False)
            if use_regime_filter
            else pd.Series(True, index=index, dtype="bool")
        )
        adx_ok = (
            (adx_series > adx_threshold).fillna(False)
            if use_adx_filter
            else pd.Series(True, index=index, dtype="bool")
        )
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
        signal_changed = signal_series.ne(_shift_int(signal_series, 1, fill_value=NEUTRAL))

        bars_held_series = _bars_held_from_signal(signal_series)
        is_held_four_bars = bars_held_series.eq(4)
        is_held_less_than_four_bars = bars_held_series.gt(0) & bars_held_series.lt(4)

        is_buy_signal = signal_series.eq(LONG) & is_ema_uptrend & is_sma_uptrend
        is_sell_signal = signal_series.eq(SHORT) & is_ema_downtrend & is_sma_downtrend

        is_new_buy_signal = is_buy_signal & signal_changed
        is_new_sell_signal = is_sell_signal & signal_changed
        is_last_signal_buy = _shift_int(signal_series, 4, fill_value=NEUTRAL).eq(LONG)

        start_long_trade = is_new_buy_signal & is_bullish & is_ema_uptrend & is_sma_uptrend
        start_short_trade = is_new_sell_signal & is_bearish & is_ema_downtrend & is_sma_downtrend

        bars_since_long_entry = _bars_since(start_long_trade)
        bars_since_bearish_exit = _bars_since(alert_bearish)
        is_valid_long_exit = (bars_since_bearish_exit > bars_since_long_entry).fillna(False)
        end_long_trade_dynamic = is_bearish_change & _shift_bool(is_valid_long_exit, 1)

        end_long_trade_strict = (
                (
                        (is_held_four_bars & is_last_signal_buy)
                        | (is_held_less_than_four_bars & is_new_sell_signal)
                )
                & _shift_bool(start_long_trade.rolling(window=100, min_periods=1).max().astype(bool), 1)
        )

        is_dynamic_exit_valid = (
                (not use_ema_filter)
                and (not use_sma_filter)
                and (not use_kernel_smoothing)
        )
        end_long = (
            end_long_trade_dynamic
            if (use_dynamic_exits and is_dynamic_exit_valid)
            else end_long_trade_strict
        )

        frame["lorentzian_prediction"] = prediction_values
        frame["lorentzian_signal"] = signal_series
        frame["buy_signal"] = start_long_trade.fillna(False).astype(bool)
        frame["sell_signal"] = (start_short_trade | end_long).fillna(False).astype(bool)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
