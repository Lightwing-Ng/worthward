"""
MACD crossover strategy.

Code version: v0.4.0
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


class MacdStrategy(BaseStrategy):
    strategy_id = "macd"
    strategy_name = "MACD"
    strategy_description = "MACD crossover strategy using default daily 12, 26, and 9 settings."
    strategy_category = "momentum"
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
        normalized_params = self.normalize_params(params)
        fast_span = int(normalized_params["fast_span"])
        slow_span = int(normalized_params["slow_span"])
        signal_span = int(normalized_params["signal_span"])

        ema_fast = frame["Close"].ewm(span=fast_span, adjust=False).mean()
        ema_slow = frame["Close"].ewm(span=slow_span, adjust=False).mean()
        frame["macd_line"] = ema_fast - ema_slow
        frame["signal_line"] = frame["macd_line"].ewm(span=signal_span, adjust=False).mean()

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
        )
