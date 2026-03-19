"""
SuperTrend Double AI strategy implementation.

Refactored from Original TradingView PineScript by PresentTrading.
Refactor Code version: v2.1.0
"""

from __future__ import annotations

from dataclasses import dataclass
import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


def _ensure_ohlcv_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Ensure all required OHLCV columns exist and are properly typed."""
    normalized = frame.copy()
    
    # Map lowercase to capitalized if needed
    mapping = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume"
    }
    for old, new in mapping.items():
        if old in normalized.columns and new not in normalized.columns:
            normalized[new] = normalized[old]

    if "Close" not in normalized.columns:
        # Fallback if no Close column at all
        return normalized

    close = pd.to_numeric(normalized["Close"], errors="coerce")
    
    for column in ("Open", "High", "Low"):
        if column not in normalized.columns:
            normalized[column] = close
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").fillna(close)
            
    if "Volume" not in normalized.columns:
        # Default volume to 1.0 if missing to allow volume-weighted MAs to function as unweighted
        normalized["Volume"] = pd.Series(1.0, index=normalized.index)
    else:
        normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce").fillna(0.0)
        
    normalized["Close"] = close
    return normalized


@dataclass(slots=True)
class SupertrendDoubleAiParameters:
    # Trading direction
    trade_direction: str = "Both"  # Long / Short / Both

    # AI Settings Primary
    k1: int = 3
    n1: int = 12

    # AI Settings Secondary
    k2: int = 5
    n2: int = 20

    # AI Trend parameters
    knn_price_len1: int = 20
    knn_st_len1: int = 80
    knn_price_len2: int = 40
    knn_st_len2: int = 80

    # SuperTrend settings
    ma_mode: str = "WMA"  # SMA / EMA / WMA / RMA / VWMA
    len1: int = 10
    factor1: float = 4.0
    len2: int = 5
    factor2: float = 3.0


def _wma(values: np.ndarray, length: int) -> np.ndarray:
    """Return a weighted moving average with TradingView-like linear weights."""
    if length <= 0:
        return np.full(len(values), np.nan, dtype=np.float64)

    weights = np.arange(1, length + 1, dtype=np.float64)
    denominator = float(weights.sum())
    series = pd.Series(values, dtype="float64")
    return series.rolling(window=length).apply(
        lambda window: float(np.dot(window, weights) / denominator),
        raw=True,
    ).to_numpy(dtype=np.float64)


def weighted_ma(ma_type: str, close: np.ndarray, volume: np.ndarray, length: int) -> np.ndarray:
    """Calculate volume-weighted or selected moving average type."""
    if length <= 0:
        return np.full(len(close), np.nan, dtype=np.float64)

    result = np.full(len(close), np.nan, dtype=np.float64)
    if ma_type == "SMA":
        num = pd.Series(close * volume).rolling(window=length).mean().values
        den = pd.Series(volume).rolling(window=length).mean().values
        result = np.where(den == 0, np.nan, num / den)
    elif ma_type == "EMA":
        num = pd.Series(close * volume).ewm(span=length, adjust=False).mean().values
        den = pd.Series(volume).ewm(span=length, adjust=False).mean().values
        result = np.where(den == 0, np.nan, num / den)
    elif ma_type == "WMA":
        num = _wma(close * volume, length)
        den = _wma(volume, length)
        result = np.where(den == 0, np.nan, num / den)
    elif ma_type == "RMA":
        alpha = 1.0 / length
        num = pd.Series(close * volume).ewm(alpha=alpha, adjust=False).mean().values
        den = pd.Series(volume).ewm(alpha=alpha, adjust=False).mean().values
        result = np.where(den == 0, np.nan, num / den)
    elif ma_type == "VWMA":
        num = pd.Series(close * volume).rolling(window=length).mean().values
        den = pd.Series(volume).rolling(window=length).mean().values
        result = np.where(den == 0, np.nan, num / den)
    return result


def supertrend_from_base(base: np.ndarray, atr_len: int, factor: float, close: np.ndarray, high: np.ndarray, low: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Calculate SuperTrend from the supplied base series."""

    previous_close = pd.Series(close).shift(1).to_numpy(dtype=np.float64)
    true_range = np.nanmax(
        np.column_stack(
            [
                high - low,
                np.abs(high - previous_close),
                np.abs(low - previous_close),
            ]
        ),
        axis=1,
    )
    atr = pd.Series(true_range).ewm(
        alpha=1.0 / max(atr_len, 1),
        adjust=False,
        min_periods=1,
    ).mean().to_numpy(dtype=np.float64)

    raw_upper = base + factor * atr
    raw_lower = base - factor * atr
    upper = raw_upper.copy()
    lower = raw_lower.copy()
    direction = np.full(len(close), 1, dtype=int)
    st = np.full(len(close), np.nan, dtype=np.float64)

    for index in range(len(close)):
        if index > 0:
            prev_lower = lower[index - 1]
            prev_upper = upper[index - 1]
            prev_close_value = close[index - 1]
            if not np.isnan(prev_lower):
                if not (raw_lower[index] > prev_lower or prev_close_value < prev_lower):
                    lower[index] = prev_lower
            if not np.isnan(prev_upper):
                if not (raw_upper[index] < prev_upper or prev_close_value > prev_upper):
                    upper[index] = prev_upper

        if index == 0 or np.isnan(atr[index - 1]):
            direction[index] = 1
        else:
            prev_st = st[index - 1]
            prev_upper = upper[index - 1]
            if np.isclose(prev_st, prev_upper, equal_nan=False):
                direction[index] = -1 if close[index] > upper[index] else 1
            else:
                direction[index] = 1 if close[index] < lower[index] else -1

        st[index] = lower[index] if direction[index] == -1 else upper[index]

    return st, direction, lower, upper, atr


def distance(x1: float, x2: float) -> float:
    """Simple absolute distance for KNN"""
    return abs(x1 - x2)


def update_dataset(
    close: np.ndarray,
    st_series: np.ndarray,
    price_len: int,
    st_len: int,
    n: int,
    bar_idx: int,
) -> tuple[list[float], list[int]]:
    """Build the rolling KNN dataset for the current bar."""
    price_smoothed = _wma(close, price_len)
    st_smoothed = _wma(st_series, st_len)
    data: list[float] = []
    labels: list[int] = []

    for offset in range(n):
        sample_idx = bar_idx - offset
        if sample_idx < 0:
            break
        st_value = st_series[sample_idx]
        price_value = price_smoothed[sample_idx]
        smoothed_st_value = st_smoothed[sample_idx]
        if np.isnan(st_value) or np.isnan(price_value) or np.isnan(smoothed_st_value):
            continue
        data.append(float(st_value))
        labels.append(1 if price_value > smoothed_st_value else 0)

    return data, labels


def knn_weighted(data: list[float], labels: list[int], k: int, x: float) -> float | None:
    """Weighted KNN classification: returns probability of bullish (1)"""
    n = len(data)
    if n == 0:
        return None
    k_eff = min(k, n)

    # compute distances and keep indices
    distances = [distance(x, data[i]) for i in range(n)]
    indices = list(range(n))

    # partial selection sort: only get top k smallest distances
    for i in range(k_eff):
        min_idx = i
        for j in range(i+1, n):
            if distances[j] < distances[min_idx]:
                min_idx = j
        if min_idx != i:
            distances[i], distances[min_idx] = distances[min_idx], distances[i]
            indices[i], indices[min_idx] = indices[min_idx], indices[i]

    weighted_sum = 0.0
    total_weight = 0.0
    eps = 1e-6

    for i in range(k_eff):
        idx = indices[i]
        lbl = labels[idx]
        w = 1.0 / (distances[i] + eps)
        weighted_sum += w * lbl
        total_weight += w

    if total_weight == 0.0:
        return None
    return weighted_sum / total_weight


def class_from_prob(prob: float | None) -> int:
    """
    Convert probability to 3-state class:
    1 = bullish (prob == 1 exactly)
    0 = bearish (prob == 0 exactly)
    -1 = neutral (any other value, including NaN)
    """
    if prob is None or np.isnan(prob):
        return -1
    if prob == 1.0:
        return 1
    if prob == 0.0:
        return 0
    return -1


class SupertrendDoubleAiStrategy(BaseStrategy):
    strategy_id = "supertrend-double-ai"
    strategy_name = "SuperTrend Double AI"
    strategy_description = "Dual-layer KNN AI prediction with two layered SuperTrend trailing stops"
    strategy_category = "ai-trend"
    strategy_enabled: bool = True
    strategy_display_order: int = 40
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        long_only=False,
        short=True,
    )

    @classmethod
    def get_parameter_definitions(cls) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="trade_direction",
                label="Trading Direction",
                kind="choice",
                default="Both",
                options=("Long", "Short", "Both"),
            ),
            StrategyParameterDefinition(
                key="k1",
                label="Neighbors (AI 1)",
                kind="integer",
                default=3,
                minimum=1,
                maximum=100,
            ),
            StrategyParameterDefinition(
                key="n1",
                label="Data Points (AI 1)",
                kind="integer",
                default=12,
                minimum=1,
                maximum=100,
            ),
            StrategyParameterDefinition(
                key="k2",
                label="Neighbors (AI 2)",
                kind="integer",
                default=5,
                minimum=1,
                maximum=100,
            ),
            StrategyParameterDefinition(
                key="n2",
                label="Data Points (AI 2)",
                kind="integer",
                default=20,
                minimum=1,
                maximum=100,
            ),
            StrategyParameterDefinition(
                key="knn_price_len1",
                label="Price Trend (AI 1)",
                kind="integer",
                default=20,
                minimum=2,
                maximum=500,
                step=10,
            ),
            StrategyParameterDefinition(
                key="knn_st_len1",
                label="Prediction Trend (AI 1)",
                kind="integer",
                default=80,
                minimum=2,
                maximum=500,
                step=10,
            ),
            StrategyParameterDefinition(
                key="knn_price_len2",
                label="2nd Price Trend (AI 2)",
                kind="integer",
                default=40,
                minimum=2,
                maximum=500,
                step=10,
            ),
            StrategyParameterDefinition(
                key="knn_st_len2",
                label="2nd Prediction Trend (AI 2)",
                kind="integer",
                default=80,
                minimum=2,
                maximum=500,
                step=10,
            ),
            StrategyParameterDefinition(
                key="ma_mode",
                label="Moving Average Source",
                kind="choice",
                default="WMA",
                options=("SMA", "EMA", "WMA", "RMA", "VWMA"),
            ),
            StrategyParameterDefinition(
                key="len1",
                label="Length (ST 1)",
                kind="integer",
                default=10,
                minimum=1,
            ),
            StrategyParameterDefinition(
                key="factor1",
                label="Multiplier (ST 1)",
                kind="number",
                default=4.0,
                minimum=0.1,
                step=0.1,
            ),
            StrategyParameterDefinition(
                key="len2",
                label="2nd Length (ST 2)",
                kind="integer",
                default=5,
                minimum=1,
            ),
            StrategyParameterDefinition(
                key="factor2",
                label="2nd Multiplier (ST 2)",
                kind="number",
                default=3.0,
                minimum=0.1,
                step=0.1,
            ),
        )

    def compute_signals(
        self,
        dataset: pd.DataFrame,
        params: dict | None = None,
    ) -> StrategySignalResult:
        df = _ensure_ohlcv_columns(dataset).reset_index(drop=True)
        if df.empty or "Close" not in df.columns:
            df["buy_signal"] = pd.Series(dtype="bool")
            df["sell_signal"] = pd.Series(dtype="bool")
            return StrategySignalResult(
                frame=df,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
        trade_direction = str(normalized_params.get("trade_direction", "Both"))
        k1 = int(normalized_params.get("k1", 3))
        n1 = int(normalized_params.get("n1", 12))
        k2 = int(normalized_params.get("k2", 5))
        n2 = int(normalized_params.get("n2", 20))
        knn_price_len1 = int(normalized_params.get("knn_price_len1", 20))
        knn_st_len1 = int(normalized_params.get("knn_st_len1", 80))
        knn_price_len2 = int(normalized_params.get("knn_price_len2", 40))
        knn_st_len2 = int(normalized_params.get("knn_st_len2", 80))
        ma_mode = str(normalized_params.get("ma_mode", "WMA"))
        len1 = int(normalized_params.get("len1", 10))
        factor1 = float(normalized_params.get("factor1", 4.0))
        len2 = int(normalized_params.get("len2", 5))
        factor2 = float(normalized_params.get("factor2", 3.0))

        close = df["Close"].values
        volume = df["Volume"].values
        high = df["High"].values
        low = df["Low"].values

        base = weighted_ma(ma_mode, close, volume, len1)
        st1, dir1, lb1, ub1, atr1 = supertrend_from_base(base, len1, factor1, close, high, low)
        st2, dir2, lb2, ub2, atr2 = supertrend_from_base(base, len2, factor2, close, high, low)

        n_bars = len(close)
        cls1 = np.full(n_bars, -1, dtype=int)
        cls2 = np.full(n_bars, -1, dtype=int)

        for bar_idx in range(n_bars):
            data1, lab1 = update_dataset(close, st1, knn_price_len1, knn_st_len1, n1, bar_idx)
            data2, lab2 = update_dataset(close, st2, knn_price_len2, knn_st_len2, n2, bar_idx)
            if len(data1) >= k1 and not np.isnan(st1[bar_idx]):
                cls1[bar_idx] = class_from_prob(knn_weighted(data1, lab1, k1, float(st1[bar_idx])))
            if len(data2) >= k2 and not np.isnan(st2[bar_idx]):
                cls2[bar_idx] = class_from_prob(knn_weighted(data2, lab2, k2, float(st2[bar_idx])))

        df["supertrend1"] = st1
        df["supertrend2"] = st2
        df["direction1"] = dir1
        df["direction2"] = dir2
        df["knn_class1"] = cls1
        df["knn_class2"] = cls2

        long_condition = (
            (df["direction1"] == -1)
            & (df["knn_class1"] == 1)
            & (df["direction2"] == -1)
            & (df["knn_class2"] == 1)
        )
        short_condition = (
            (df["direction1"] == 1)
            & (df["knn_class1"] == 0)
            & (df["direction2"] == 1)
            & (df["knn_class2"] == 0)
        )

        previous_long_condition = long_condition.shift(1, fill_value=False).astype(bool)
        previous_short_condition = short_condition.shift(1, fill_value=False).astype(bool)

        buy_signal = long_condition & ~previous_long_condition
        sell_signal = (short_condition & ~previous_short_condition) | (~long_condition & previous_long_condition)

        if trade_direction == "Long":
            sell_signal = ~long_condition & previous_long_condition
        elif trade_direction == "Short":
            buy_signal = pd.Series(False, index=df.index)
            sell_signal = short_condition & ~previous_short_condition

        df["buy_signal"] = buy_signal.fillna(False)
        df["sell_signal"] = sell_signal.fillna(False)

        return StrategySignalResult(
            frame=df,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
