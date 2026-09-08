"""
Leveraged rotation strategy.

Code version: v1.1.0
"""

from __future__ import annotations

from math import isfinite
from numbers import Number

import numpy as np
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
        "then returns to the primary ticker at a new observed closing high. "
        "Close-derived rotation decisions use subsequent opening prices."
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
                    "Rotates into Ticker 2 when Ticker 1 closes this percentage below its prior "
                    "highest close in the supplied history."
                ),
            ),
        )

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        frame = dataset.copy()
        price_columns = [f"{field}{suffix}" for suffix in ("", "_2") for field in ("Open", "High", "Low", "Close")]
        if "Date" not in frame or any(column not in frame for column in price_columns):
            raise ValueError(
                "Leveraged Rotation requires Date and aligned Open, High, Low, Close columns for both tickers."
            )
        if frame.empty:
            raise ValueError("Leveraged Rotation requires overlapping market history for both tickers.")

        if any(isinstance(value, Number) for value in frame["Date"]):
            raise ValueError("Leveraged Rotation requires valid ordered, unique dates.")
        dates = pd.to_datetime(frame["Date"], errors="coerce", utc=True, format="mixed")
        if dates.isna().any() or dates.duplicated().any() or not dates.is_monotonic_increasing:
            raise ValueError("Leveraged Rotation requires valid ordered, unique dates.")
        frame["Date"] = dates.dt.tz_localize(None)
        prices = frame[price_columns].apply(pd.to_numeric, errors="coerce")
        if not np.isfinite(prices.to_numpy(dtype=float)).all() or (prices <= 0).any().any():
            raise ValueError("Leveraged Rotation requires finite, positive OHLC prices for both tickers.")
        for suffix in ("", "_2"):
            high, low = prices[f"High{suffix}"], prices[f"Low{suffix}"]
            endpoints = prices[[f"Open{suffix}", f"Close{suffix}"]]
            if (high < endpoints.max(axis=1)).any() or (low > endpoints.min(axis=1)).any():
                raise ValueError("Leveraged Rotation requires coherent OHLC bounds for both tickers.")
        frame[price_columns] = prices
        for column in ("Dividends", "Dividends_2"):
            if column in frame:
                dividends = pd.to_numeric(frame[column], errors="coerce")
                if not np.isfinite(dividends.to_numpy(dtype=float)).all() or (dividends < 0).any():
                    raise ValueError("Leveraged Rotation requires finite, nonnegative dividends when supplied.")
                frame[column] = dividends

        raw_trigger = (params or {}).get("drawdown_pct", 10.0)
        try:
            finite_trigger = isfinite(float(raw_trigger))
        except (TypeError, ValueError, OverflowError):
            finite_trigger = False
        if not finite_trigger:
            raise ValueError("Primary drawdown trigger must be a finite number.")
        normalized_params = self.normalize_params(params)
        primary_close = frame["Close"]
        drawdown_trigger = -float(normalized_params["drawdown_pct"])
        prior_high = primary_close.cummax().shift(1)
        reference_high = prior_high.fillna(primary_close.iloc[0])
        drawdown_pct = ((primary_close / reference_high) - 1.0) * 100.0

        # These are persistent allocation intents, not assumed fills. The executor
        # may block a losing exit; repeat the current intent until the regime changes.
        targets: list[int] = []
        exit_intents: list[bool] = []
        target_asset = 1
        has_drawdown = False
        new_highs = primary_close > reference_high
        for below_trigger, new_high in zip(drawdown_pct <= drawdown_trigger, new_highs, strict=True):
            if below_trigger:
                target_asset = 2
                has_drawdown = True
            elif new_high:
                target_asset = 1
            targets.append(target_asset)
            exit_intents.append(has_drawdown and target_asset == 1)

        frame["rotation_primary_high"] = reference_high.to_numpy()
        frame["rotation_drawdown_pct"] = drawdown_pct.to_numpy()
        frame["rotation_target_asset"] = targets
        frame["rotation_enter_signal"] = frame["rotation_target_asset"] == 2
        frame["rotation_exit_signal"] = exit_intents

        return StrategySignalResult(
            frame=frame,
            buy_signal_column="rotation_enter_signal",
            sell_signal_column="rotation_exit_signal",
            execution_profile="leveraged_rotation",
            required_execution_mode="next_open",
            metadata={
                "primary_close_column": "Close",
                "secondary_close_column": "Close_2",
            },
        )
