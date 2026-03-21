"""
kNN-based machine learning strategy.

Adapted from the original TradingView PineScript by capissimo.
This port keeps the indicator pair selection and kNN vote logic,
while mapping bearish or clear states to exits for the app's
current long-only backtest engine.

Code version: v1.0.0
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix

BUY = 1
SELL = -1
CLEAR = 0


def _ensure_ohlcv_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    close = pd.to_numeric(normalized["Close"], errors="coerce")

    for column in ("Open", "High", "Low"):
        if column not in normalized.columns:
            normalized[column] = close
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").fillna(close)

    if "Volume" not in normalized.columns:
        normalized["Volume"] = pd.Series(0.0, index=normalized.index)
    else:
        normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce").fillna(0.0)

    normalized["Close"] = close
    return normalized


def _rsi(series: pd.Series, length: int) -> pd.Series:
    delta = series.diff()
    gains = delta.clip(lower=0.0)
    losses = (-delta).clip(lower=0.0)
    average_gain = gains.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=length).mean()
    average_loss = losses.ewm(alpha=1 / max(length, 1), adjust=False, min_periods=length).mean()
    relative_strength = average_gain / average_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + relative_strength))
    return rsi.fillna(50.0)


def _cci(frame: pd.DataFrame, length: int) -> pd.Series:
    typical_price = (frame["High"] + frame["Low"] + frame["Close"]) / 3.0
    moving_average = typical_price.rolling(window=length, min_periods=length).mean()

    def mean_deviation(window: pd.Series) -> float:
        center = float(window.mean())
        return float(np.mean(np.abs(window - center)))

    mean_dev = typical_price.rolling(window=length, min_periods=length).apply(mean_deviation, raw=False)
    denominator = (0.015 * mean_dev).replace(0.0, np.nan)
    cci = (typical_price - moving_average) / denominator
    return cci.fillna(0.0)


def _roc(series: pd.Series, length: int) -> pd.Series:
    return (series.pct_change(periods=length) * 100.0).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def _minimax(series: pd.Series, period: int, min_value: float, max_value: float) -> pd.Series:
    highest = series.rolling(window=period, min_periods=1).max()
    lowest = series.rolling(window=period, min_periods=1).min()
    scale = (highest - lowest).replace(0.0, np.nan)
    normalized = (max_value - min_value) * (series - lowest) / scale + min_value
    return normalized.fillna(min_value)


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


def _select_feature_pair(
        indicator_name: str,
        rs: pd.Series,
        rf: pd.Series,
        cs: pd.Series,
        cf: pd.Series,
        os: pd.Series,
        of: pd.Series,
        vs: pd.Series,
        vf: pd.Series,
) -> tuple[pd.Series, pd.Series]:
    if indicator_name == "RSI":
        return rs, rf
    if indicator_name == "CCI":
        return cs, cf
    if indicator_name == "ROC":
        return os, of
    if indicator_name == "Volume":
        return vs, vf
    return (
        pd.concat([rs, cs, os, vs], axis=1).mean(axis=1),
        pd.concat([rf, cf, of, vf], axis=1).mean(axis=1),
    )


class KnnMachineLearningStrategy(BaseStrategy):
    strategy_id = "knn-machine-learning"
    strategy_name = "kNN Machine Learning"
    strategy_description = (
        "k-nearest neighbours regime classifier adapted from capissimo's PineScript. "
        "It supports RSI, ROC, CCI, volume, or blended feature pairs and treats "
        "bearish and clear states as exits in this app."
    )
    strategy_category = "trend"
    strategy_display_order = 40
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="indicator",
                label="Indicator",
                kind="choice",
                default="All",
                options=("RSI", "ROC", "CCI", "Volume", "All"),
                help_text="Chooses which feature pair the kNN model compares. 'All' blends every supported feature into one average view.",
            ),
            StrategyParameterDefinition(
                key="short_window",
                label="Short Period",
                kind="integer",
                default=14,
                minimum=1,
                unit_hint="bars",
                help_text="Sets the fast lookback window for the selected feature. Smaller values react more quickly to new price moves.",
            ),
            StrategyParameterDefinition(
                key="long_window",
                label="Long Period",
                kind="integer",
                default=28,
                minimum=2,
                unit_hint="bars",
                help_text="Sets the slow lookback window for the selected feature. Larger values smooth more short-term noise.",
            ),
            StrategyParameterDefinition(
                key="base_k",
                label="Base Neighbours",
                kind="integer",
                default=252,
                minimum=5,
                help_text="Sets the base neighbour pool used before the square-root rule picks the final k. Larger values make the classifier look further back.",
            ),
            StrategyParameterDefinition(
                key="volatility_filter",
                label="Volatility Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Turns the ATR filter on or off. When on, the strategy only trades when short-term volatility is stronger than the slower baseline.",
            ),
            StrategyParameterDefinition(
                key="bar_threshold",
                label="Bar Threshold",
                kind="integer",
                default=300,
                minimum=2,
                maximum=5_000,
                unit_hint="bars",
                help_text="Sets the maximum holding length in bars before the strategy clears the position.",
            ),
        )

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        frame = _ensure_ohlcv_columns(dataset).reset_index(drop=True)
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool")
            frame["sell_signal"] = pd.Series(dtype="bool")
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
        indicator_name = str(normalized_params["indicator"])
        short_window = int(normalized_params["short_window"])
        long_window = int(normalized_params["long_window"])
        base_k = int(normalized_params["base_k"])
        use_volatility_filter = str(normalized_params["volatility_filter"]) == "On"
        bar_threshold = int(normalized_params["bar_threshold"])

        if short_window >= long_window:
            short_window = max(1, long_window - 1)

        rs = _rsi(frame["Close"], long_window)
        rf = _rsi(frame["Close"], short_window)
        cs = _cci(frame, long_window)
        cf = _cci(frame, short_window)
        os = _roc(frame["Close"], long_window)
        of = _roc(frame["Close"], short_window)
        vs = _minimax(frame["Volume"], long_window, 0.0, 99.0)
        vf = _minimax(frame["Volume"], short_window, 0.0, 99.0)
        feature1, feature2 = _select_feature_pair(indicator_name, rs, rf, cs, cf, os, of, vs, vf)

        directions = np.sign(frame["Close"].shift(-1) - frame["Close"]).fillna(0.0).astype(int)
        prediction_scores = np.zeros(len(frame), dtype=np.float64)
        raw_signal = np.zeros(len(frame), dtype=int)

        k_value = max(1, int(math.floor(math.sqrt(max(base_k, 1)))))
        atr_fast = _atr(frame, 10)
        atr_slow = _atr(frame, 40)

        current_signal = CLEAR
        active_bars = 0

        feature1_values = feature1.to_numpy(dtype=np.float64)
        feature2_values = feature2.to_numpy(dtype=np.float64)
        direction_values = directions.to_numpy(dtype=np.int64)

        for index in range(len(frame)):
            current_f1 = feature1_values[index]
            current_f2 = feature2_values[index]
            prediction = 0.0

            if index > 0 and np.isfinite(current_f1) and np.isfinite(current_f2):
                history_f1 = feature1_values[:index]
                history_f2 = feature2_values[:index]
                history_directions = direction_values[:index]
                valid_mask = (
                        np.isfinite(history_f1)
                        & np.isfinite(history_f2)
                        & (history_directions != 0)
                )
                if np.any(valid_mask):
                    distances = np.sqrt(
                        np.square(current_f1 - history_f1[valid_mask])
                        + np.square(current_f2 - history_f2[valid_mask])
                    )
                    nearest_count = min(k_value, len(distances))
                    nearest_indices = np.argpartition(distances, nearest_count - 1)[:nearest_count]
                    prediction = float(history_directions[valid_mask][nearest_indices].sum())

            prediction_scores[index] = prediction

            filter_passes = True
            if use_volatility_filter:
                filter_passes = bool(atr_fast.iloc[index] > atr_slow.iloc[index])

            desired_signal = CLEAR
            if prediction > 0 and filter_passes:
                desired_signal = BUY
            elif prediction < 0 and filter_passes:
                desired_signal = SELL

            if desired_signal == CLEAR:
                current_signal = CLEAR
                active_bars = 0
            elif desired_signal != current_signal:
                current_signal = desired_signal
                active_bars = 1
            else:
                active_bars += 1
                if active_bars >= bar_threshold:
                    current_signal = CLEAR
                    active_bars = 0

            raw_signal[index] = current_signal

        signal_series = pd.Series(raw_signal, index=frame.index, dtype="int64")
        previous_signal = signal_series.shift(1).fillna(CLEAR).astype(int)

        frame["knn_prediction"] = prediction_scores
        frame["knn_signal"] = signal_series
        frame["buy_signal"] = (signal_series == BUY) & (previous_signal != BUY)
        frame["sell_signal"] = (previous_signal == BUY) & (signal_series != BUY)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
