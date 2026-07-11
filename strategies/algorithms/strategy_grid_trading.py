"""
Grid trading strategy.

Code version: v1.1.0
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


class GridTradingStrategy(BaseStrategy):
    strategy_id = "grid-trading"
    strategy_name = "Grid Trading"
    strategy_description = "Trades mean-reverting moves around a rolling center line using a configurable grid spacing."
    strategy_category = "mean-reversion"
    strategy_display_order = 31
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="center_mode",
                label="Center line type",
                kind="choice",
                default="SMA",
                options=("SMA", "EMA"),
                help_text="Selects a simple or exponential moving center for the grid.",
            ),
            StrategyParameterDefinition(
                key="center_window",
                label="Center line window",
                kind="integer",
                default=20,
                minimum=2,
                maximum=250,
                unit_hint="bars",
                help_text="Sets the rolling average used as the center of the grid.",
            ),
            StrategyParameterDefinition(
                key="grid_spacing_pct",
                label="Grid spacing",
                kind="number",
                default=2.0,
                minimum=0.1,
                maximum=25.0,
                step=0.1,
                unit_hint="%",
                help_text="Buys below the lower grid line and sells above the upper grid line.",
            ),
            StrategyParameterDefinition(
                key="entry_level",
                label="Buy grid level",
                kind="integer",
                default=1,
                minimum=1,
                maximum=10,
                unit_hint="levels",
                help_text="Sets how many grid intervals below the center trigger an entry.",
            ),
            StrategyParameterDefinition(
                key="exit_level",
                label="Sell grid level",
                kind="integer",
                default=1,
                minimum=1,
                maximum=10,
                unit_hint="levels",
                help_text="Sets how many grid intervals above the center trigger an exit.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        normalized_params = self.normalize_params(params)
        center_window = int(normalized_params["center_window"])
        grid_spacing = float(normalized_params["grid_spacing_pct"]) / 100.0
        entry_level = int(normalized_params["entry_level"])
        exit_level = int(normalized_params["exit_level"])

        if normalized_params["center_mode"] == "EMA":
            frame["grid_center"] = frame["Close"].ewm(span=center_window, adjust=False).mean()
        else:
            frame["grid_center"] = frame["Close"].rolling(
                window=center_window,
                min_periods=1,
            ).mean()
        frame["grid_lower"] = frame["grid_center"] * (1.0 - (grid_spacing * entry_level))
        frame["grid_upper"] = frame["grid_center"] * (1.0 + (grid_spacing * exit_level))

        previous_close = frame["Close"].shift(1)
        previous_lower = frame["grid_lower"].shift(1)
        previous_upper = frame["grid_upper"].shift(1)
        frame["buy_signal"] = (
            (frame["Close"] <= frame["grid_lower"])
            & (previous_close > previous_lower)
        ).fillna(False)
        frame["sell_signal"] = (
            (frame["Close"] >= frame["grid_upper"])
            & (previous_close < previous_upper)
        ).fillna(False)

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
