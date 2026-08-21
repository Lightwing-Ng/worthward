"""
Grid trading strategy.

Code version: v1.3.0
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


class GridTradingStrategy(BaseStrategy):
    strategy_id = "grid-trading"
    strategy_name = "Grid Trading"
    strategy_description = "Trades price moves from the last execution with configurable trigger bounds and asymmetric rise/fall percentages."
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
                key="price_floor",
                label="Trigger price min",
                kind="number",
                default=1.0,
                step=0.01,
                help_text="Keeps grid signals active only when the closing price is at or above this lower bound.",
            ),
            StrategyParameterDefinition(
                key="price_ceiling",
                label="Trigger price max",
                kind="number",
                default=1000.0,
                step=0.01,
                help_text="Keeps grid signals active only when the closing price is at or below this upper bound.",
            ),
            StrategyParameterDefinition(
                key="rise",
                label="Rise %",
                kind="number",
                default=2.0,
                minimum=0.5,
                maximum=5.0,
                step=0.01,
                unit_hint="%",
                help_text="Sets the percentage rise from the last execution that triggers a sell signal.",
            ),
            StrategyParameterDefinition(
                key="fall",
                label="Fall %",
                kind="number",
                default=0.5,
                minimum=0.5,
                maximum=5.0,
                step=0.01,
                unit_hint="%",
                help_text="Sets the percentage fall from the last execution that triggers a buy signal.",
            ),
        )

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        normalized_params = self.normalize_params(params)
        price_floor = float(normalized_params["price_floor"])
        price_ceiling = float(normalized_params["price_ceiling"])
        rise = float(normalized_params["rise"]) / 100.0
        fall = float(normalized_params["fall"]) / 100.0

        frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
        open_prices = pd.to_numeric(frame.get("Open", frame["Close"]), errors="coerce")
        high_prices = pd.to_numeric(frame.get("High", frame["Close"]), errors="coerce")
        low_prices = pd.to_numeric(frame.get("Low", frame["Close"]), errors="coerce")
        initial_price = (
            next(
                (
                    float(value)
                    for value in [open_prices.iloc[0], frame["Close"].iloc[0]]
                    if pd.notna(value) and float(value) > 0
                ),
                0.0,
            )
            if not frame.empty
            else 0.0
        )

        reference_prices: list[float] = []
        buy_prices: list[float] = []
        sell_prices: list[float] = []
        buy_signals: list[bool] = []
        sell_signals: list[bool] = []
        reference_price = initial_price
        for row_index in frame.index:
            close_price = frame.at[row_index, "Close"]
            high_price = high_prices.loc[row_index]
            low_price = low_prices.loc[row_index]
            buy_price = reference_price * (1.0 - fall)
            sell_price = reference_price * (1.0 + rise)
            in_trigger_range = (
                pd.notna(close_price)
                and price_floor <= float(close_price) <= price_ceiling
            )
            sell_signal = bool(
                in_trigger_range
                and pd.notna(high_price)
                and float(high_price) >= sell_price
            )
            buy_signal = bool(
                in_trigger_range
                and not sell_signal
                and pd.notna(low_price)
                and float(low_price) <= buy_price
            )

            reference_prices.append(reference_price)
            buy_prices.append(buy_price)
            sell_prices.append(sell_price)
            buy_signals.append(buy_signal)
            sell_signals.append(sell_signal)
            if (buy_signal or sell_signal) and pd.notna(close_price) and float(close_price) > 0:
                reference_price = float(close_price)

        frame["grid_reference_price"] = reference_prices
        frame["grid_lower"] = buy_prices
        frame["grid_upper"] = sell_prices
        frame["buy_signal"] = buy_signals
        frame["sell_signal"] = sell_signals

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
        )
