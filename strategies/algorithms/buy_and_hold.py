"""
Buy-and-hold baseline strategy.

Code version: v1.0.2
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategySignalResult


class BuyAndHoldStrategy(BaseStrategy):
    strategy_id = "buy-and-hold"
    strategy_name = "Buy and hold"

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        frame["buy_signal"] = False
        frame["sell_signal"] = False
        if not frame.empty:
            frame.loc[frame.index[0], "buy_signal"] = True
            frame.loc[frame.index[-1], "sell_signal"] = True
        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
