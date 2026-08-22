"""
Dollar-cost averaging strategy metadata and parameter contract.

Code version: v0.1.1
"""

from __future__ import annotations

import pandas as pd

from ..base import (
    BaseStrategy,
    StrategyParameterDefinition,
    StrategySignalResult,
    StrategySupportMatrix,
)


class DcaStrategy(BaseStrategy):
    """Expose the recurring-investment simulator through the strategy registry."""

    strategy_id = "dca"
    strategy_name = "Dollar-cost averaging"
    strategy_description = "Invests a fixed amount on a weekly or monthly schedule and compares the result with an all-in purchase."
    strategy_category = "baseline"
    strategy_display_order = 60
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="amount",
                label="Amount per period",
                kind="number",
                default=1000.0,
                minimum=1.0,
                step=10.0,
                help_text="The amount invested at each scheduled contribution date.",
            ),
            StrategyParameterDefinition(
                key="frequency",
                label="Frequency",
                kind="choice",
                default="monthly",
                options=("weekly", "monthly"),
                help_text="Choose a weekly or monthly contribution schedule.",
            ),
            StrategyParameterDefinition(
                key="weekday",
                label="Weekly day",
                kind="integer",
                default=0,
                minimum=0,
                maximum=4,
                help_text="The weekday used when Frequency is weekly: 0 is Monday and 4 is Friday.",
            ),
            StrategyParameterDefinition(
                key="month_day",
                label="Monthly calendar day",
                kind="integer",
                default=15,
                minimum=1,
                maximum=28,
                help_text="The calendar day used when Frequency is monthly.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        """Fail loudly if a signal-backtest caller tries to execute DCA directly."""
        del dataset, params
        raise NotImplementedError("DCA uses the recurring-investment simulator, not signal execution.")
