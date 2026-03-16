"""
SuperTrend AI strategy with factor clustering.

Code version: v1.0.1
"""

from __future__ import annotations

from dataclasses import dataclass
import math

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult


@dataclass(slots=True)
class _SupertrendState:
    upper: float
    lower: float
    output: float
    perf: float
    factor: float
    trend: int


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
    true_range = _true_range(frame)
    return true_range.ewm(alpha=1 / length, adjust=False, min_periods=1).mean()


def _ensure_ohlc_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    close = pd.to_numeric(normalized["Close"], errors="coerce")
    for column in ("Open", "High", "Low"):
        if column not in normalized.columns:
            normalized[column] = close
        else:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce").fillna(close)
    normalized["Close"] = close
    return normalized


def _percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    return float(pd.Series(values, dtype="float64").quantile(quantile, interpolation="linear"))


def _mean_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _cluster_factor_and_score(
	perf_values: list[float],
	factor_values: list[float],
	cluster_name: str,
	max_iter: int,
) -> tuple[float | None, float | None]:
    if not perf_values or not factor_values:
        return None, None

    centroids = [
        _percentile(perf_values, 0.25),
        _percentile(perf_values, 0.50),
        _percentile(perf_values, 0.75),
    ]

    target_index = {
        "Worst": 0,
        "Average": 1,
        "Best": 2,
    }.get(cluster_name, 2)

    factor_clusters: list[list[float]] = [[], [], []]
    perf_clusters: list[list[float]] = [[], [], []]

    for _ in range(max_iter + 1):
        factor_clusters = [[], [], []]
        perf_clusters = [[], [], []]

        for factor, perf in zip(factor_values, perf_values, strict=True):
            distances = [abs(perf - centroid) for centroid in centroids]
            cluster_index = distances.index(min(distances))
            factor_clusters[cluster_index].append(factor)
            perf_clusters[cluster_index].append(perf)

        new_centroids = []
        for index, cluster in enumerate(perf_clusters):
            cluster_mean = _mean_or_none(cluster)
            new_centroids.append(centroids[index] if cluster_mean is None else cluster_mean)

        if all(
            math.isclose(old, new, rel_tol=1e-12, abs_tol=1e-12)
            for old, new in zip(centroids, new_centroids, strict=True)
        ):
            break
        centroids = new_centroids

    target_factor = _mean_or_none(factor_clusters[target_index])
    target_perf = _mean_or_none(perf_clusters[target_index])
    return target_factor, target_perf


class SupertrendAiStrategy(BaseStrategy):
    strategy_id = "supertrend-ai"
    strategy_name = "SuperTrend AI"

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="interval",
                label="Interval",
                kind="choice",
                default="1d",
                options=("1d",),
                editable=False,
                help_text="SuperTrend AI backtests run on daily bars only.",
            ),
            StrategyParameterDefinition(
                key="atr_length",
                label="ATR Length",
                kind="integer",
                default=10,
                minimum=1,
            ),
            StrategyParameterDefinition(
                key="min_factor",
                label="Minimum Factor",
                kind="integer",
                default=1,
                minimum=0,
            ),
            StrategyParameterDefinition(
                key="max_factor",
                label="Maximum Factor",
                kind="integer",
                default=5,
                minimum=0,
            ),
            StrategyParameterDefinition(
                key="factor_step",
                label="Factor Step",
                kind="number",
                default=0.5,
                minimum=0.1,
                step=0.1,
            ),
            StrategyParameterDefinition(
                key="performance_memory",
                label="Performance Memory",
                kind="number",
                default=10.0,
                minimum=2.0,
            ),
            StrategyParameterDefinition(
                key="from_cluster",
                label="From Cluster",
                kind="choice",
                default="Best",
                options=("Best", "Average", "Worst"),
            ),
            StrategyParameterDefinition(
                key="max_iteration_steps",
                label="Maximum Iteration Steps",
                kind="integer",
                default=1_000,
                minimum=0,
            ),
            StrategyParameterDefinition(
                key="historical_bars_calculation",
                label="Historical Bars Calculation",
                kind="integer",
                default=10_000,
                minimum=1,
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = _ensure_ohlc_columns(dataset).reset_index(drop=True)
        if frame.empty:
            frame["buy_signal"] = pd.Series(dtype="bool")
            frame["sell_signal"] = pd.Series(dtype="bool")
            return StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            )

        normalized_params = self.normalize_params(params)
        atr_length = int(normalized_params["atr_length"])
        min_factor = int(normalized_params["min_factor"])
        max_factor = int(normalized_params["max_factor"])
        factor_step = float(normalized_params["factor_step"])
        perf_alpha = float(normalized_params["performance_memory"])
        from_cluster = str(normalized_params["from_cluster"])
        max_iter = int(normalized_params["max_iteration_steps"])
        max_data = int(normalized_params["historical_bars_calculation"])

        if min_factor > max_factor:
            raise ValueError("Minimum factor cannot be greater than maximum factor.")
        if factor_step <= 0:
            raise ValueError("Factor step must be greater than zero.")

        hl2 = (frame["High"] + frame["Low"]) / 2.0
        close = frame["Close"].astype("float64")
        atr = _atr(frame, atr_length)
        denominator = close.diff().abs().ewm(
            span=max(int(perf_alpha), 1),
            adjust=False,
            min_periods=1,
        ).mean()

        factors: list[float] = []
        next_factor = float(min_factor)
        max_factor_value = float(max_factor)
        while next_factor <= max_factor_value + 1e-9:
            factors.append(round(next_factor, 10))
            next_factor += factor_step
        if not factors:
            factors.append(float(min_factor))

        initial_mid = float(hl2.iloc[0])
        states = [
            _SupertrendState(
                upper=initial_mid,
                lower=initial_mid,
                output=math.nan,
                perf=0.0,
                factor=factor,
                trend=0,
            )
            for factor in factors
        ]

        target_factors: list[float] = []
        perf_indexes: list[float] = []
        trends: list[int] = []
        trailing_stops: list[float] = []
        adaptive_trailing_stops: list[float] = []

        active_upper = initial_mid
        active_lower = initial_mid
        active_trend = 0
        active_trailing_stop = initial_mid
        perf_ama = math.nan
        lookback_start = max(len(frame) - max_data, 0)
        perf_weight = 2.0 / (perf_alpha + 1.0)

        for index in range(len(frame)):
            current_close = float(close.iloc[index])
            current_hl2 = float(hl2.iloc[index])
            current_atr = float(atr.iloc[index])
            previous_close = float(close.iloc[index - 1]) if index > 0 else current_close

            for state in states:
                up = current_hl2 + (current_atr * state.factor)
                down = current_hl2 - (current_atr * state.factor)
                if current_close > state.upper:
                    state.trend = 1
                elif current_close < state.lower:
                    state.trend = 0

                state.upper = min(up, state.upper) if previous_close < state.upper else up
                state.lower = max(down, state.lower) if previous_close > state.lower else down

                if math.isnan(state.output):
                    diff = 0.0
                elif previous_close == state.output:
                    diff = 0.0
                else:
                    diff = math.copysign(1.0, previous_close - state.output)

                price_delta = current_close - previous_close if index > 0 else 0.0
                state.perf += perf_weight * ((price_delta * diff) - state.perf)
                state.output = state.lower if state.trend == 1 else state.upper

            if index >= lookback_start:
                perf_values = [state.perf for state in states]
                factor_values = [state.factor for state in states]
                target_factor, target_perf = _cluster_factor_and_score(
                    perf_values=perf_values,
                    factor_values=factor_values,
                    cluster_name=from_cluster,
                    max_iter=max_iter,
                )
            else:
                target_factor = None
                target_perf = None

            if target_factor is None:
                target_factor = target_factors[-1] if target_factors else factors[0]
            target_factors.append(target_factor)

            perf_denominator = float(denominator.iloc[index]) if not pd.isna(denominator.iloc[index]) else 0.0
            if target_perf is None or perf_denominator <= 0:
                perf_index = 0.0
            else:
                perf_index = max(target_perf, 0.0) / perf_denominator
            perf_indexes.append(perf_index)

            up = current_hl2 + (current_atr * target_factor)
            down = current_hl2 - (current_atr * target_factor)
            active_upper = min(up, active_upper) if previous_close < active_upper else up
            active_lower = max(down, active_lower) if previous_close > active_lower else down

            if current_close > active_upper:
                active_trend = 1
            elif current_close < active_lower:
                active_trend = 0

            active_trailing_stop = active_lower if active_trend == 1 else active_upper
            if math.isnan(perf_ama):
                perf_ama = active_trailing_stop
            else:
                perf_ama += perf_index * (active_trailing_stop - perf_ama)

            trends.append(active_trend)
            trailing_stops.append(active_trailing_stop)
            adaptive_trailing_stops.append(perf_ama)

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
