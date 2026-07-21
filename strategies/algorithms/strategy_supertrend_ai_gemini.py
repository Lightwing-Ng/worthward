"""
Optimized SuperTrend AI strategy with vectorized factor clustering.

Code version: v0.3.1
"""

from __future__ import annotations


import numpy as np
import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, length: int) -> np.ndarray:
    """Calculates Average True Range using vectorized NumPy and Pandas."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]

    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)

    true_range = np.maximum(tr1, np.maximum(tr2, tr3))
    return pd.Series(true_range).ewm(alpha=1.0 / length, adjust=False, min_periods=1).mean().values


def _ensure_ohlc_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Normalizes DataFrame to ensure OHLC columns exist."""
    normalized = frame.copy()
    close_series = pd.to_numeric(normalized["Close"], errors="coerce")

    for column in ("Open", "High", "Low"):
        if column not in normalized.columns:
            normalized[column] = close_series
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").fillna(close_series)

    normalized["Close"] = close_series
    return normalized


class SupertrendAiStrategy(BaseStrategy):
    strategy_id = "supertrend_ai_gemini"
    strategy_name = "SuperTrend AI (Gemini)"
    strategy_description = "Optimized adaptive multi-factor SuperTrend strategy using NumPy array broadcasting for fast factor clustering."
    strategy_category = "trend"
    strategy_display_order = 31
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="atr_length",
                label="ATR Length",
                kind="integer",
                default=10,
                minimum=1,
                help_text="Sets how many bars are used to measure recent price movement. Higher values make the stop line steadier.",
            ),
            StrategyParameterDefinition(
                key="min_factor",
                label="Minimum Factor",
                kind="integer",
                default=1,
                minimum=0,
                help_text="Sets the lowest SuperTrend multiplier to test. Smaller values keep the stop line closer to price.",
            ),
            StrategyParameterDefinition(
                key="max_factor",
                label="Maximum Factor",
                kind="integer",
                default=5,
                minimum=0,
                help_text="Sets the highest SuperTrend multiplier to test. Larger values keep the stop line further away from price.",
            ),
            StrategyParameterDefinition(
                key="factor_step",
                label="Factor Step",
                kind="number",
                default=0.5,
                minimum=0.1,
                step=0.1,
                help_text="Sets the gap between tested factor values. Smaller steps check more candidates but take longer to evaluate.",
            ),
            StrategyParameterDefinition(
                key="performance_memory",
                label="Performance Memory",
                kind="number",
                default=10.0,
                minimum=2.0,
                help_text="Controls how quickly the performance score forgets older bars. Lower values react faster to recent changes.",
            ),
            StrategyParameterDefinition(
                key="from_cluster",
                label="From Cluster",
                kind="choice",
                default="Best",
                options=("Best", "Average", "Worst"),
                help_text="Chooses whether the final factor comes from the best, middle, or weakest performance cluster.",
            ),
            StrategyParameterDefinition(
                key="max_iteration_steps",
                label="Maximum Iteration Steps",
                kind="integer",
                default=1000,
                minimum=0,
                unit_hint="iters",
                help_text="Sets the maximum number of clustering passes on each run. Higher values give the clusters more chances to settle.",
            ),
            StrategyParameterDefinition(
                key="historical_bars_calculation",
                label="Historical Bars Calculation",
                kind="integer",
                default=10000,
                minimum=1,
                help_text="Sets how many recent bars the strategy can use while tuning the factor. Lower values reduce workload but use less history.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = _ensure_ohlc_columns(dataset).reset_index(drop=True)
        if frame.empty:
            frame["buy_signal"] = False
            frame["sell_signal"] = False
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
        atr_length = int(normalized_params["atr_length"])
        min_factor = float(normalized_params["min_factor"])
        max_factor = float(normalized_params["max_factor"])
        factor_step = float(normalized_params["factor_step"])
        perf_alpha = float(normalized_params["performance_memory"])
        from_cluster = str(normalized_params["from_cluster"])
        max_iter = int(normalized_params["max_iteration_steps"])
        max_data = int(normalized_params["historical_bars_calculation"])

        if min_factor > max_factor:
            raise ValueError("Minimum factor cannot be greater than maximum factor.")
        if factor_step <= 0:
            raise ValueError("Factor step must be greater than zero.")

        factors = np.arange(min_factor, max_factor + 1e-9, factor_step)
        if len(factors) == 0:
            factors = np.array([min_factor])
        num_factors = len(factors)

        close_arr = frame["Close"].values
        high_arr = frame["High"].values
        low_arr = frame["Low"].values

        hl2_arr = (high_arr + low_arr) / 2.0
        atr_arr = _atr(high_arr, low_arr, close_arr, atr_length)

        diff_abs = np.abs(np.diff(close_arr, prepend=close_arr[0]))
        denominator_arr = pd.Series(diff_abs).ewm(
            span=max(int(perf_alpha), 1), adjust=False, min_periods=1
        ).mean().values

        initial_mid = hl2_arr[0]

        upper_arr = np.full(num_factors, initial_mid)
        lower_arr = np.full(num_factors, initial_mid)
        output_arr = np.full(num_factors, np.nan)
        perf_arr = np.zeros(num_factors)
        trend_arr = np.zeros(num_factors, dtype=int)

        n_frames = len(frame)
        target_factors = np.empty(n_frames)
        perf_indexes = np.empty(n_frames)
        trends = np.empty(n_frames, dtype=int)
        trailing_stops = np.empty(n_frames)
        adaptive_trailing_stops = np.empty(n_frames)

        active_upper = initial_mid
        active_lower = initial_mid
        active_trend = 0
        perf_ama = np.nan
        lookback_start = max(n_frames - max_data, 0)
        perf_weight = 2.0 / (perf_alpha + 1.0)

        target_index_map = {"Worst": 0, "Average": 1, "Best": 2}
        cluster_target = target_index_map.get(from_cluster, 2)

        for i in range(n_frames):
            current_close = close_arr[i]
            current_hl2 = hl2_arr[i]
            current_atr = atr_arr[i]
            prev_close = close_arr[i - 1] if i > 0 else current_close

            up = current_hl2 + (current_atr * factors)
            down = current_hl2 - (current_atr * factors)

            trend_arr = np.where(
                current_close > upper_arr, 1,
                np.where(current_close < lower_arr, 0, trend_arr)
            )

            upper_arr = np.where(prev_close < upper_arr, np.minimum(up, upper_arr), up)
            lower_arr = np.where(prev_close > lower_arr, np.maximum(down, lower_arr), down)

            diff = np.zeros(num_factors)
            valid_out = ~np.isnan(output_arr) & (prev_close != output_arr)
            diff[valid_out] = np.copysign(1.0, prev_close - output_arr[valid_out])

            price_delta = current_close - prev_close if i > 0 else 0.0
            perf_arr += perf_weight * ((price_delta * diff) - perf_arr)
            output_arr = np.where(trend_arr == 1, lower_arr, upper_arr)

            target_factor = None
            target_perf = None

            if i >= lookback_start and num_factors > 0:
                centroids = np.percentile(perf_arr, [25, 50, 75])
                clusters = np.zeros(num_factors, dtype=int)

                for _ in range(max_iter + 1):
                    distances = np.abs(perf_arr[:, None] - centroids)
                    clusters = np.argmin(distances, axis=1)

                    new_centroids = np.zeros(3)
                    for c in range(3):
                        mask = clusters == c
                        new_centroids[c] = np.mean(perf_arr[mask]) if np.any(mask) else centroids[c]

                    if np.allclose(centroids, new_centroids, rtol=1e-12, atol=1e-12):
                        break
                    centroids = new_centroids

                target_mask = clusters == cluster_target
                if np.any(target_mask):
                    target_factor = np.mean(factors[target_mask])
                    target_perf = np.mean(perf_arr[target_mask])
                else:
                    target_factor = factors[0]
                    target_perf = perf_arr[0]

            if target_factor is None:
                target_factor = target_factors[i - 1] if i > 0 else factors[0]

            target_factors[i] = target_factor

            perf_den = denominator_arr[i] if not np.isnan(denominator_arr[i]) else 0.0
            if target_perf is None or perf_den <= 0:
                perf_index = 0.0
            else:
                perf_index = max(target_perf, 0.0) / perf_den
            perf_indexes[i] = perf_index

            active_up = current_hl2 + (current_atr * target_factor)
            active_down = current_hl2 - (current_atr * target_factor)

            active_upper = min(active_up, active_upper) if prev_close < active_upper else active_up
            active_lower = max(active_down, active_lower) if prev_close > active_lower else active_down

            if current_close > active_upper:
                active_trend = 1
            elif current_close < active_lower:
                active_trend = 0

            active_trailing_stop = active_lower if active_trend == 1 else active_upper

            if np.isnan(perf_ama):
                perf_ama = active_trailing_stop
            else:
                perf_ama += perf_index * (active_trailing_stop - perf_ama)

            trends[i] = active_trend
            trailing_stops[i] = active_trailing_stop
            adaptive_trailing_stops[i] = perf_ama

        frame["target_factor"] = target_factors
        frame["performance_index"] = perf_indexes
        frame["supertrend_trend"] = trends
        frame["trailing_stop"] = trailing_stops
        frame["trailing_stop_ama"] = adaptive_trailing_stops

        previous_trend = frame["supertrend_trend"].shift(1).fillna(frame["supertrend_trend"].iloc[0]).astype(int)
        frame["buy_signal"] = (frame["supertrend_trend"] > previous_trend).fillna(False)
        frame["sell_signal"] = (frame["supertrend_trend"] < previous_trend).fillna(False)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
