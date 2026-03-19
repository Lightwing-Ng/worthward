"""
MACD crossover strategy.

Code version: v1.2.0
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
                label="Fast EMA",
                kind="integer",
                default=12,
                minimum=1,
                unit_hint="bars",
            ),
            StrategyParameterDefinition(
                key="slow_span",
                label="Slow EMA",
                kind="integer",
                default=26,
                minimum=2,
            ),
            StrategyParameterDefinition(
                key="signal_span",
                label="Signal EMA",
                kind="integer",
                default=9,
                minimum=1,
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
