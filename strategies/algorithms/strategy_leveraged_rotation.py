"""
Leveraged rotation strategy.

Code version: v2.6.0
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
from ..interval_bridge import DAILY_CLOSE_TO_NEXT_SESSION_OPEN


_ROTATION_WINDOW_SESSIONS = {
    "1d": 1,
    "1w": 5,
    "1m": 21,
    "3m": 63,
}


class LeveragedRotationStrategy(BaseStrategy):
    strategy_id = "leveraged-rotation"
    strategy_name = "Leveraged Rotation"
    strategy_description = (
        "Rebalances integer shares between a primary ticker and its leveraged companion after "
        "a configured primary return-window decline, then rotates back after the leveraged "
        "ticker gains from its actual entry open, within declared allocation bounds. "
        "Close-derived rotation decisions use subsequent opening prices."
    )
    strategy_category = "portfolio-rotation"
    strategy_display_order = 40
    strategy_supports = StrategySupportMatrix(
        single_ticker=False,
        multi_ticker=True,
        long_only=True,
        short=False,
        required_tickers=2,
    )
    strategy_supported_intervals = ("1d", "1m")
    strategy_model_interval_overrides = {"1m": "1d"}
    strategy_signal_bridges = {"1m": DAILY_CLOSE_TO_NEXT_SESSION_OPEN}
    strategy_interval_notices = {
        "1m": "Return-window signals use daily closes and execute at the next session open.",
    }

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("QQQ", "TQQQ")

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="initial_primary_pct",
                label="Initial primary allocation",
                kind="number",
                default=70.0,
                minimum=0.0,
                maximum=100.0,
                step=0.01,
                unit_hint="%",
                subgroup="Initial allocation",
                ui_role="allocation-primary",
                help_text="Initial market-value allocation to the primary ticker; shares are rounded down to integers.",
            ),
            StrategyParameterDefinition(
                key="initial_leveraged_pct",
                label="Initial leveraged allocation",
                kind="number",
                default=25.0,
                minimum=0.0,
                maximum=100.0,
                step=0.01,
                unit_hint="%",
                subgroup="Initial allocation",
                ui_role="allocation-leveraged",
                help_text="Initial market-value allocation to the leveraged ticker; unallocated and rounding residuals remain cash.",
            ),
            StrategyParameterDefinition(
                key="primary_min_pct", label="Primary minimum", kind="number",
                default=20.0, minimum=0.0, maximum=100.0, step=0.01, unit_hint="%",
                subgroup="Allocation limits (%, equity)",
                ui_role="ticker-label:0:minimum",
            ),
            StrategyParameterDefinition(
                key="primary_max_pct", label="Primary maximum", kind="number",
                default=95.0, minimum=0.0, maximum=100.0, step=0.01, unit_hint="%",
                subgroup="Allocation limits (%, equity)",
                ui_role="ticker-label:0:maximum",
            ),
            StrategyParameterDefinition(
                key="leveraged_min_pct", label="Leveraged minimum", kind="number",
                default=0.0, minimum=0.0, maximum=100.0, step=0.01, unit_hint="%",
                subgroup="Allocation limits (%, equity)",
                ui_role="ticker-label:1:minimum",
            ),
            StrategyParameterDefinition(
                key="leveraged_max_pct", label="Leveraged maximum", kind="number",
                default=75.0, minimum=0.0, maximum=100.0, step=0.01, unit_hint="%",
                subgroup="Allocation limits (%, equity)",
                ui_role="ticker-label:1:maximum",
            ),
            StrategyParameterDefinition(
                key="rotation_window",
                label="Return window",
                kind="choice",
                default="1d",
                options=tuple(_ROTATION_WINDOW_SESSIONS),
                option_labels=("Single day", "1 week", "1 month", "3 months"),
                subgroup="Rotation triggers (%, change)",
                content_sized=True,
                help_text="Measures the primary ticker's entry decline across 1, 5, 21, or 63 completed trading sessions.",
            ),
            StrategyParameterDefinition(
                key="buy_leveraged_drop_pct",
                label="Rotate to leveraged: primary window decline",
                kind="number", default=3.0, minimum=0.1, maximum=90.0, step=0.01,
                unit_hint="%", subgroup="Rotation triggers (%, change)",
                ui_role="rotation-trigger:buy-leveraged",
                help_text="After the primary ticker falls by this percentage across the selected Return window, the next open sells it toward its minimum and uses available cash to buy the leveraged ticker toward its maximum.",
            ),
            StrategyParameterDefinition(
                key="sell_leveraged_rise_pct",
                label="Rotate back to primary: leveraged gain since entry",
                kind="number", default=5.0, minimum=0.1, maximum=200.0, step=0.01,
                unit_hint="%", subgroup="Rotation triggers (%, change)",
                ui_role="rotation-trigger:buy-primary",
                help_text="After the leveraged ticker gains this percentage from the open where the last leveraged rotation executed, the next open sells it toward its minimum and buys the primary ticker toward its maximum.",
            ),
        )

    def normalize_params(self, params: dict | None = None) -> dict:
        normalized = super().normalize_params(params)
        primary_min = float(normalized["primary_min_pct"])
        leveraged_min = min(float(normalized["leveraged_min_pct"]), 100.0 - primary_min)
        primary_max = max(primary_min, float(normalized["primary_max_pct"]))
        leveraged_max = max(leveraged_min, float(normalized["leveraged_max_pct"]))
        primary_max = min(primary_max, 100.0 - leveraged_min)
        leveraged_max = min(leveraged_max, 100.0 - primary_min)
        primary_initial = min(max(float(normalized["initial_primary_pct"]), primary_min), primary_max)
        leveraged_initial = min(
            max(float(normalized["initial_leveraged_pct"]), leveraged_min),
            leveraged_max,
        )
        if primary_initial + leveraged_initial > 100.0:
            leveraged_initial = max(leveraged_min, 100.0 - primary_initial)
            if primary_initial + leveraged_initial > 100.0:
                primary_initial = 100.0 - leveraged_initial
        normalized.update({
            "primary_min_pct": primary_min,
            "primary_max_pct": primary_max,
            "leveraged_min_pct": leveraged_min,
            "leveraged_max_pct": leveraged_max,
            "initial_primary_pct": primary_initial,
            "initial_leveraged_pct": leveraged_initial,
        })
        return normalized

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        frame = dataset.copy()
        decision_start_raw = frame.attrs.get("research_decision_start")
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
        decision_start = None
        if decision_start_raw is not None:
            decision_start = pd.to_datetime(
                decision_start_raw,
                errors="coerce",
                utc=True,
            )
            if pd.isna(decision_start):
                raise ValueError("Leveraged Rotation requires a valid research decision start.")
            decision_start = decision_start.tz_localize(None)
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

        for definition in self.get_parameter_definitions():
            if definition.kind not in {"integer", "number"}:
                continue
            raw_value = (params or {}).get(definition.key, definition.default)
            try:
                finite_value = isfinite(float(raw_value))
            except (TypeError, ValueError, OverflowError):
                finite_value = False
            if not finite_value:
                raise ValueError(f"{definition.key} must be a finite number.")
        normalized_params = self.normalize_params(params)
        primary_close = frame["Close"]
        leveraged_close = frame["Close_2"]
        rotation_window = str(normalized_params["rotation_window"])
        window_sessions = _ROTATION_WINDOW_SESSIONS[rotation_window]
        primary_window_pct = primary_close.pct_change(
            periods=window_sessions,
            fill_method=None,
        ) * 100.0
        leveraged_window_pct = leveraged_close.pct_change(
            periods=window_sessions,
            fill_method=None,
        ) * 100.0
        target_regimes: list[str] = []
        enter_intents: list[bool] = []
        exit_intents: list[bool] = []
        leveraged_entry_prices: list[float] = []
        leveraged_since_entry_pct: list[float] = []
        regime = "initial"
        pending_entry_execution = False
        pending_exit_execution = False
        leveraged_entry_price: float | None = None
        for index, primary_move in enumerate(primary_window_pct):
            if pending_entry_execution:
                leveraged_entry_price = float(frame["Open_2"].iloc[index])
                regime = "leveraged"
                pending_entry_execution = False
            elif pending_exit_execution:
                leveraged_entry_price = None
                regime = "primary"
                pending_exit_execution = False

            leveraged_gain = (
                ((float(leveraged_close.iloc[index]) / leveraged_entry_price) - 1.0) * 100.0
                if regime == "leveraged" and leveraged_entry_price is not None
                else np.nan
            )
            decisions_enabled = (
                decision_start is None
                or frame["Date"].iloc[index] >= decision_start
            )
            enter = bool(
                decisions_enabled
                and
                regime in {"initial", "primary"}
                and pd.notna(primary_move)
                and primary_move <= -float(normalized_params["buy_leveraged_drop_pct"])
            )
            exit_ = bool(
                decisions_enabled
                and
                regime == "leveraged"
                and pd.notna(leveraged_gain)
                and leveraged_gain >= float(normalized_params["sell_leveraged_rise_pct"])
            )
            if enter:
                regime = "leveraged_pending"
                pending_entry_execution = True
            elif exit_:
                regime = "primary_pending"
                pending_exit_execution = True
            target_regimes.append(
                "leveraged" if regime == "leveraged_pending"
                else "primary" if regime == "primary_pending"
                else regime
            )
            enter_intents.append(enter)
            exit_intents.append(exit_)
            leveraged_entry_prices.append(
                leveraged_entry_price if leveraged_entry_price is not None else np.nan
            )
            leveraged_since_entry_pct.append(leveraged_gain)

        frame["rotation_primary_window_pct"] = primary_window_pct.to_numpy()
        frame["rotation_leveraged_window_pct"] = leveraged_window_pct.to_numpy()
        frame["rotation_leveraged_entry_price"] = leveraged_entry_prices
        frame["rotation_leveraged_since_entry_pct"] = leveraged_since_entry_pct
        frame["rotation_target_regime"] = target_regimes
        frame["rotation_enter_signal"] = enter_intents
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
                "rotation_parameters": normalized_params,
                "rotation_window": rotation_window,
                "rotation_window_sessions": window_sessions,
            },
        )
