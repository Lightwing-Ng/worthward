"""
Leveraged rotation strategy.

Code version: v1.0.0
"""

from __future__ import annotations

import pandas as pd

from ..base import (
    BaseStrategy,
    StrategyParameterDefinition,
    StrategySignalResult,
    StrategySupportMatrix,
)


class LeveragedRotationStrategy(BaseStrategy):
    strategy_id = "leveraged-rotation"
    strategy_name = "Leveraged Rotation"
    strategy_description = (
        "Rotates from the primary ticker into its leveraged companion after a configured drawdown, "
        "then returns to the primary ticker at a new all-time closing high."
    )
    strategy_category = "rotation"
    strategy_display_order = 40
    strategy_supports = StrategySupportMatrix(
        single_ticker=False,
        multi_ticker=True,
        long_only=True,
        short=False,
        required_tickers=2,
    )

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("QQQ", "TQQQ")

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="drawdown_pct",
                label="Primary drawdown trigger",
                kind="number",
                default=10.0,
                minimum=0.1,
                maximum=90.0,
                step=0.1,
                unit_hint="%",
                help_text=(
                    "Rotates into Ticker 2 when Ticker 1 closes this percentage below its prior all-time closing high."
                ),
            ),
        )

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        frame = dataset.copy()
        normalized_params = self.normalize_params(params)
        primary_close = frame.get("Close")
        secondary_close = frame.get("Close_2")
        if primary_close is None or secondary_close is None:
            raise ValueError(
                "Leveraged Rotation requires Date, Close, and Close_2 columns for two ordered tickers."
            )

        primary_close = pd.to_numeric(primary_close, errors="coerce")
        secondary_close = pd.to_numeric(secondary_close, errors="coerce")
        valid_rows = primary_close.notna() & secondary_close.notna()
        frame = frame.loc[valid_rows].copy()
        if frame.empty:
            raise ValueError("Leveraged Rotation requires overlapping market history for both tickers.")

        primary_close = primary_close.loc[valid_rows]
        secondary_close = secondary_close.loc[valid_rows]
        drawdown_trigger = -float(normalized_params["drawdown_pct"])
        prior_high = primary_close.cummax().shift(1)
        reference_high = prior_high.fillna(primary_close.iloc[0])
        drawdown_pct = ((primary_close / reference_high) - 1.0) * 100.0
        prior_drawdown_pct = drawdown_pct.shift(1).fillna(0.0)

        frame["rotation_primary_high"] = reference_high.to_numpy()
        frame["rotation_drawdown_pct"] = drawdown_pct.to_numpy()
        frame["rotation_enter_signal"] = (
            (drawdown_pct <= drawdown_trigger)
            & (prior_drawdown_pct > drawdown_trigger)
            & (secondary_close > 0)
        ).fillna(False)
        frame["rotation_exit_signal"] = (
            primary_close > prior_high.fillna(primary_close)
        ).fillna(False)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="rotation_enter_signal",
            sell_signal_column="rotation_exit_signal",
            execution_profile="leveraged_rotation",
            metadata={
                "primary_close_column": "Close",
                "secondary_close_column": "Close_2",
            },
        )
