"""
Grid trading strategy.

Code version: v1.4.0
"""

from __future__ import annotations

import pandas as pd

from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix


class GridTradingStrategy(BaseStrategy):
    strategy_id = "grid-trading"
    strategy_name = "Grid Trading"
    strategy_description = (
        "Trades price moves from the last execution while keeping the position "
        "within configurable holding limits."
    )
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
                key="initial_holding",
                label="Current holding",
                kind="integer",
                default=0,
                minimum=0,
                maximum=1_000_000,
                step=1,
                unit_hint="shares",
                help_text="Sets the shares already held when the backtest starts.",
            ),
            StrategyParameterDefinition(
                key="holding_min",
                label="Minimum holding",
                kind="integer",
                default=0,
                minimum=0,
                maximum=1_000_000,
                step=1,
                unit_hint="shares",
                help_text="Keeps sell orders from reducing the position below this number of shares.",
            ),
            StrategyParameterDefinition(
                key="holding_max",
                label="Maximum holding",
                kind="integer",
                default=1_000_000,
                minimum=0,
                maximum=1_000_000,
                step=1,
                unit_hint="shares",
                help_text="Keeps buy orders from increasing the position above this number of shares.",
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

    def normalize_params(self, params: dict | None = None) -> dict:
        """Normalize holding bounds into one internally consistent range."""
        normalized = super().normalize_params(params)
        holding_min = int(normalized["holding_min"])
        holding_max = max(holding_min, int(normalized["holding_max"]))
        initial_holding = min(
            max(int(normalized["initial_holding"]), holding_min),
            holding_max,
        )
        normalized.update({
            "initial_holding": initial_holding,
            "holding_min": holding_min,
            "holding_max": holding_max,
        })
        return normalized

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        frame = dataset.copy()
        normalized_params = self.normalize_params(params)
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
        # The execution engine owns reference updates because only it sees fills.
        reference_price = initial_price
        for row_index in frame.index:
            close_price = frame.at[row_index, "Close"]
            high_price = high_prices.loc[row_index]
            low_price = low_prices.loc[row_index]
            buy_price = reference_price * (1.0 - fall)
            sell_price = reference_price * (1.0 + rise)
            sell_signal = bool(
                pd.notna(close_price)
                and pd.notna(high_price)
                and float(high_price) >= sell_price
            )
            buy_signal = bool(
                pd.notna(close_price)
                and not sell_signal
                and pd.notna(low_price)
                and float(low_price) <= buy_price
            )

            reference_prices.append(reference_price)
            buy_prices.append(buy_price)
            sell_prices.append(sell_price)
            buy_signals.append(buy_signal)
            sell_signals.append(sell_signal)

        frame["grid_reference_price"] = reference_prices
        frame["grid_lower"] = buy_prices
        frame["grid_upper"] = sell_prices
        frame["buy_signal"] = buy_signals
        frame["sell_signal"] = sell_signals

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            execution_profile="grid_trading",
            metadata={
                "grid_parameters": {
                    "initial_holding": int(normalized_params["initial_holding"]),
                    "holding_min": int(normalized_params["holding_min"]),
                    "holding_max": int(normalized_params["holding_max"]),
                    "rise": rise,
                    "fall": fall,
                },
            },
        )
