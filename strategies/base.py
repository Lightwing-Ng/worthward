"""
Base strategy interfaces.

Code version: v1.0.0
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(slots=True)
class StrategySignalResult:
    frame: pd.DataFrame
    buy_signal_column: str
    sell_signal_column: str


class BaseStrategy:
    strategy_id: str = ""
    strategy_name: str = ""

    def compute_signals(
        self,
        dataset: pd.DataFrame,
        params: dict | None = None,
    ) -> StrategySignalResult:
        raise NotImplementedError
