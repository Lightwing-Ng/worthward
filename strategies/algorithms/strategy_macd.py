"""
MACD crossover strategy.

Code version: v1.0.1
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategySignalResult


class MacdStrategy(BaseStrategy):
    strategy_id = "macd"
    strategy_name = "MACD"

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        fast_span = 12
        slow_span = 26
        signal_span = 9

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
