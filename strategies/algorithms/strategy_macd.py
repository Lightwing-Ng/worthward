"""
MACD crossover strategy.

Code version: v0.6.0
"""

from __future__ import annotations

import math

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


class MacdStrategy(BaseStrategy):
    strategy_id = "macd"
    strategy_name = "MACD"
    strategy_description = "MACD crossover strategy using default daily 12, 26, and 9 settings."
    strategy_category = "technical-analysis"
    strategy_display_order = 20
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="fast_span",
                group="factors",
                label="Fast EMA",
                kind="integer",
                default=12,
                minimum=1,
                unit_hint="bars",
                help_text="Sets the number of bars used for the fast moving average. Lower values react faster and create more signals.",
            ),
            StrategyParameterDefinition(
                key="slow_span",
                group="factors",
                label="Slow EMA",
                kind="integer",
                default=26,
                minimum=2,
                help_text="Sets the number of bars used for the slow moving average. Higher values smooth more of the day-to-day noise.",
            ),
            StrategyParameterDefinition(
                key="signal_span",
                group="factors",
                label="Signal EMA",
                kind="integer",
                default=9,
                minimum=1,
                help_text="Sets the smoothing period for the signal line. This controls how quickly MACD crossovers are confirmed.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        checked_params = dict(params or {})
        for key in ("fast_span", "slow_span", "signal_span"):
            raw = checked_params.get(key)
            if raw is not None:
                try:
                    numeric = float(raw)
                    finite = math.isfinite(numeric) and numeric.is_integer()
                except (TypeError, ValueError, OverflowError):
                    finite = False
                if not finite:
                    raise ValueError(f"{key} must be a finite integer.")
                checked_params[key] = int(numeric)
        normalized_params = self.normalize_params(checked_params)
        fast_span = int(normalized_params["fast_span"])
        slow_span = int(normalized_params["slow_span"])
        signal_span = int(normalized_params["signal_span"])
        if fast_span >= slow_span:
            raise ValueError("Fast EMA must be shorter than Slow EMA.")
        if "Close" not in frame:
            raise ValueError("MACD requires observed Close prices.")
        close = pd.to_numeric(frame["Close"], errors="coerce")
        if close.isna().any() or not close.map(lambda value: math.isfinite(value) and value > 0).all():
            raise ValueError("MACD requires finite positive Close prices.")

        ema_fast = close.ewm(span=fast_span, adjust=False, min_periods=fast_span).mean()
        ema_slow = close.ewm(span=slow_span, adjust=False, min_periods=slow_span).mean()
        frame["macd_line"] = ema_fast - ema_slow
        frame["signal_line"] = frame["macd_line"].ewm(
            span=signal_span, adjust=False, min_periods=signal_span,
        ).mean()

        previous_macd = frame["macd_line"].shift(1)
        previous_signal = frame["signal_line"].shift(1)
        frame["buy_signal"] = (
                (frame["macd_line"] > frame["signal_line"])
                & (previous_macd <= previous_signal)
        ).fillna(False)
        frame["sell_signal"] = (
                (frame["macd_line"] < frame["signal_line"])
                & (previous_macd >= previous_signal)
        ).fillna(False)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
        )
