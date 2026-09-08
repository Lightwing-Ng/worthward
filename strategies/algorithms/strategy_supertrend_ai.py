"""SuperTrend AI with causal trailing factor-performance clustering.

Code version: v0.6.0
"""

from __future__ import annotations

from collections import deque
import math

import numpy as np
import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


def _true_range(frame: pd.DataFrame) -> pd.Series:
    previous_close = frame["Close"].shift(1)
    return pd.concat([
        frame["High"] - frame["Low"],
        (frame["High"] - previous_close).abs(),
        (frame["Low"] - previous_close).abs(),
    ], axis=1).max(axis=1)


def _atr(frame: pd.DataFrame, length: int) -> pd.Series:
    """Seed Wilder smoothing with the first complete true-range average."""
    true_range = _true_range(frame)
    values = np.full(len(frame), np.nan)
    if len(frame) >= length:
        values[length - 1] = true_range.iloc[:length].mean()
        for index in range(length, len(frame)):
            values[index] = ((length - 1) * values[index - 1] + true_range.iloc[index]) / length
    return pd.Series(values, index=frame.index, dtype="float64")


def _ensure_ohlc_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Reject unavailable price evidence instead of inventing OHLC from Close."""
    normalized = frame.copy()
    if normalized.empty:
        return normalized
    required = ("Open", "High", "Low", "Close")
    if any(column not in normalized for column in required):
        raise ValueError("SuperTrend requires observed Open, High, Low, and Close prices.")
    for column in required:
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    values = normalized[list(required)].to_numpy(dtype="float64")
    if not np.isfinite(values).all() or np.any(values <= 0):
        raise ValueError("SuperTrend requires finite positive OHLC prices.")
    if ((normalized["High"] < normalized[["Open", "Close", "Low"]].max(axis=1))
            | (normalized["Low"] > normalized[["Open", "Close", "High"]].min(axis=1))).any():
        raise ValueError("SuperTrend requires High and Low to enclose the observed bar.")
    return normalized


def _factor_values(minimum: float, maximum: float, step: float) -> np.ndarray:
    if minimum > maximum:
        raise ValueError("Minimum factor cannot be greater than maximum factor.")
    steps = (maximum - minimum) / step
    if not math.isfinite(steps) or steps >= 512:
        raise ValueError("The factor range and step may produce at most 512 candidates.")
    count = math.floor(steps + 1e-9) + 1
    return minimum + np.arange(count, dtype="float64") * step


def _cluster_factor_and_score(
        perf_values: list[float], factor_values: list[float],
        cluster_name: str, max_iter: int,
) -> tuple[float | None, float | None]:
    """Select by occupied-cluster performance, including tied/empty clusters."""
    if not perf_values or not factor_values:
        return None, None
    if len(perf_values) != len(factor_values):
        raise ValueError("Performance values and factor values must have the same length.")
    scores, factors = np.asarray(perf_values), np.asarray(factor_values)
    centroids = np.percentile(scores, [25, 50, 75])
    clusters = np.zeros(len(scores), dtype=int)
    for _ in range(max(1, max_iter)):
        clusters = np.argmin(np.abs(scores[:, None] - centroids), axis=1)
        updated = np.array([scores[clusters == index].mean() if np.any(clusters == index)
                            else centroids[index] for index in range(3)])
        updated.sort()
        if np.allclose(centroids, updated, rtol=1e-12, atol=1e-12):
            break
        centroids = updated
    # Reassign to the final ordered centroids even when the iteration limit ends.
    clusters = np.argmin(np.abs(scores[:, None] - centroids), axis=1)
    occupied = [(float(scores[clusters == index].mean()), index) for index in range(3)
                if np.any(clusters == index)]
    occupied.sort()
    if cluster_name == "Worst":
        chosen = occupied[0][1]
    elif cluster_name == "Average":
        chosen = min(occupied, key=lambda item: abs(item[0] - float(np.median(scores))))[1]
    else:
        chosen = occupied[-1][1]
    selected = clusters == chosen
    return float(factors[selected].mean()), float(scores[selected].mean())


class SupertrendAiStrategy(BaseStrategy):
    strategy_id = "supertrend-ai"
    strategy_name = "SuperTrend AI"
    strategy_description = "Adaptive multi-factor SuperTrend strategy with three-cluster factor selection inspired by the LuxAlgo PineScript."
    strategy_category = "technical-analysis"
    strategy_display_order = 30
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
                group="factors",
                label="ATR Length",
                kind="integer",
                default=10,
                minimum=1,
                help_text="Sets how many bars are used to measure recent price movement. Higher values make the stop line steadier.",
            ),
            StrategyParameterDefinition(
                key="min_factor",
                group="factors",
                label="Minimum Factor",
                kind="integer",
                default=1,
                minimum=0,
                help_text="Sets the lowest SuperTrend multiplier to test. Smaller values keep the stop line closer to price.",
            ),
            StrategyParameterDefinition(
                key="max_factor",
                group="factors",
                label="Maximum Factor",
                kind="integer",
                default=5,
                minimum=0,
                help_text="Sets the highest SuperTrend multiplier to test. Larger values keep the stop line further away from price.",
            ),
            StrategyParameterDefinition(
                key="factor_step",
                group="factors",
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
                default=1_000,
                minimum=1,
                maximum=1_000,
                unit_hint="iters",
                help_text="Sets the maximum number of clustering passes on each run. Higher values give the clusters more chances to settle.",
            ),
            StrategyParameterDefinition(
                key="historical_bars_calculation",
                label="Historical Bars Calculation",
                kind="integer",
                default=10_000,
                minimum=1,
                help_text="Limits factor-performance scoring to this many trailing bars at each historical origin.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        checked_params = dict(params or {})
        for definition in self.get_parameter_definitions():
            raw = checked_params.get(definition.key)
            if raw is None or definition.kind not in {"integer", "number"}:
                continue
            try:
                numeric = float(raw)
                valid = math.isfinite(numeric) and (definition.kind != "integer" or numeric.is_integer())
            except (TypeError, ValueError, OverflowError):
                valid = False
            if not valid:
                raise ValueError(f"{definition.label} must be a finite {definition.kind} value.")
            checked_params[definition.key] = int(numeric) if definition.kind == "integer" else numeric
        normalized = self.normalize_params(checked_params)
        factors = _factor_values(float(normalized["min_factor"]), float(normalized["max_factor"]),
                                 float(normalized["factor_step"]))
        frame = _ensure_ohlc_columns(dataset).reset_index(drop=True)
        if frame.empty:
            frame["buy_signal"], frame["sell_signal"] = False, False
            return StrategySignalResult(frame, "buy_signal", "sell_signal", required_execution_mode="next_open")

        length = int(normalized["atr_length"])
        history = int(normalized["historical_bars_calculation"])
        weight = 2.0 / (float(normalized["performance_memory"]) + 1.0)
        decay = 1.0 - weight
        expired_weight = weight * decay ** history
        close = frame["Close"].to_numpy(dtype="float64")
        midpoint = ((frame["High"] + frame["Low"]) / 2.0).to_numpy()
        atr = _atr(frame, length).to_numpy()
        size = len(frame)
        target_factors = np.full(size, np.nan)
        perf_indexes = np.zeros(size)
        trends = np.zeros(size, dtype=int)
        stops, adaptive_stops = np.full(size, np.nan), np.full(size, np.nan)
        upper, lower, output = (np.full(len(factors), np.nan) for _ in range(3))
        factor_trends = np.zeros(len(factors), dtype=int)
        performance = np.zeros(len(factors))
        contributions = deque()
        denominator, active_changes = 0.0, 0
        active_upper = active_lower = adaptive_stop = math.nan
        active_trend = 0

        for index in range(length - 1, size):
            price, mid, volatility = close[index], midpoint[index], atr[index]
            previous_close = close[index - 1] if index >= length else price
            delta = price - previous_close
            up, down = mid + volatility * factors, mid - volatility * factors
            if index == length - 1:
                upper, lower = up.copy(), down.copy()
            factor_trends = np.where(price > upper, 1, np.where(price < lower, 0, factor_trends))
            upper = np.where(previous_close < upper, np.minimum(up, upper), up)
            lower = np.where(previous_close > lower, np.maximum(down, lower), down)
            direction = np.where(np.isfinite(output), np.sign(previous_close - output), 0.0)
            contribution = delta * direction
            performance = decay * performance + weight * contribution
            denominator = decay * denominator + weight * abs(delta)
            contributions.append((contribution, abs(delta)))
            active_changes += delta != 0
            if len(contributions) > history:
                expired, expired_change = contributions.popleft()
                performance -= expired_weight * expired
                denominator -= expired_weight * expired_change
                active_changes -= expired_change != 0
            if not active_changes:
                performance.fill(0.0)
                denominator = 0.0
            output = np.where(factor_trends == 1, lower, upper)
            factor, score = _cluster_factor_and_score(
                performance.tolist(), factors.tolist(), str(normalized["from_cluster"]),
                int(normalized["max_iteration_steps"]),
            )
            target_factors[index] = factor
            perf_index = float(np.clip(score / denominator, 0.0, 1.0)) if denominator > 0 else 0.0
            perf_indexes[index] = perf_index

            up, down = mid + volatility * factor, mid - volatility * factor
            if index == length - 1:
                active_upper, active_lower = up, down
            active_upper = min(up, active_upper) if previous_close < active_upper else up
            active_lower = max(down, active_lower) if previous_close > active_lower else down
            if price > active_upper:
                active_trend = 1
            elif price < active_lower:
                active_trend = 0
            stop = active_lower if active_trend == 1 else active_upper
            adaptive_stop = stop if math.isnan(adaptive_stop) else adaptive_stop + perf_index * (stop - adaptive_stop)
            trends[index], stops[index], adaptive_stops[index] = active_trend, stop, adaptive_stop

        frame["target_factor"] = target_factors
        frame["performance_index"] = perf_indexes
        frame["supertrend_trend"] = trends
        frame["trailing_stop"], frame["trailing_stop_ama"] = stops, adaptive_stops
        ready = pd.Series(np.isfinite(atr), index=frame.index)
        comparable = ready & ready.shift(1, fill_value=False)
        previous_trend = frame["supertrend_trend"].shift(1)
        frame["buy_signal"] = comparable & (frame["supertrend_trend"] > previous_trend)
        frame["sell_signal"] = comparable & (frame["supertrend_trend"] < previous_trend)
        return StrategySignalResult(frame, "buy_signal", "sell_signal", required_execution_mode="next_open")
