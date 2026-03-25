"""
Buy-and-hold baseline strategy.

Code version: v1.0.2
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategySignalResult, StrategySupportMatrix


class BuyAndHoldStrategy(BaseStrategy):
    strategy_id = "buy-and-hold"
    strategy_name = "Buy and hold"
    strategy_description = "Baseline strategy that buys at the first available bar and exits at the last available bar."
    strategy_category = "baseline"
    strategy_display_order = 10
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        frame["buy_signal"] = False
        frame["sell_signal"] = False
        if not frame.empty:
            frame.loc[frame.index[0], "buy_signal"] = True
            # Do NOT generate sell signal on last bar - we hold forever
            # Closing for win rate calculation will happen automatically if needed
        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
