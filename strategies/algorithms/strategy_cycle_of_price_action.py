"""
Oliver Kell's Cycle of Price Action, confirmed by the Bayesian Price Field.

Kell won the 2020 U.S. Investing Championship with a 941% return using a
10/20-day EMA stage model. This strategy detects that model's causal daily
stages (Reversal Extension, Wedge Pop, EMA Crossback, Base n Break,
Exhaustion Extension, and Wedge Drop) and uses the unchanged Bayesian Price
Field posterior and probability grid as an entry confirmation and an optional
probabilistic exit.

Code version: v1.0.0
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import numpy as np
import pandas as pd

from strategies.price_field_pipeline import (
    bundle_to_price_field_ohlcv as _bundle_ohlcv_frame,
    normalize_price_field_ohlcv as _normalize_ohlcv_frame,
)

from ..base import StrategyParameterDefinition, StrategySignalResult
from .strategy_bayesian_price_field import (
    _PROBABILITY_COLUMN,
    BayesianPriceFieldStrategy,
)


CYCLE_OF_PRICE_ACTION_SCHEMA = "cycle-of-price-action/v1"
CYCLE_MODEL_VERSION = "cycle-of-price-action-model/v1.0.0"
_ATR_SPAN = 14
_CYCLE_STAGE_COLUMN = "cycle_stage"
_CYCLE_STATE_COLUMN = "cycle_state"
_BUY_STAGES = ("wedge_pop", "ema_crossback", "base_n_break")
_SELL_STAGES = ("wedge_drop", "exhaustion_extension")
_CYCLE_STAGES = ("reversal_extension", *_BUY_STAGES, *_SELL_STAGES)
_CYCLE_PARAMETER_KEYS = (
    "fast_ema",
    "slow_ema",
    "reversal_extension_atr",
    "exhaustion_extension_atr",
    "wedge_width_atr",
    "crossback_tolerance_atr",
    "base_length",
    "base_range_atr",
    "setup_lookback",
    "require_reversal_extension",
    "exit_on_exhaustion",
    "field_confirmation",
    "field_exit_probability",
)


def _wilder_atr(frame: pd.DataFrame, span: int = _ATR_SPAN) -> pd.Series:
    """Return Wilder's causal average true range."""
    high = pd.to_numeric(frame["High"], errors="coerce")
    low = pd.to_numeric(frame["Low"], errors="coerce")
    previous_close = pd.to_numeric(frame["Close"], errors="coerce").shift(1)
    true_range = pd.concat(
        [high - low, (high - previous_close).abs(), (low - previous_close).abs()],
        axis=1,
    ).max(axis=1, skipna=True)
    return true_range.ewm(alpha=1.0 / span, adjust=False, min_periods=span).mean()


def detect_price_action_cycle(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Label each bar with its causal Cycle of Price Action stage.

    Every decision at bar ``t`` uses only bars ``<= t``. The returned frame has
    one ``cycle_stage`` label (an empty string when no event fired) and one
    ``cycle_state`` label (``neutral``, ``bull``, or ``bear``) per input row.
    """
    fast_span = int(params["fast_ema"])
    slow_span = int(params["slow_ema"])
    if fast_span >= slow_span:
        raise ValueError("Fast EMA must be shorter than Slow EMA.")
    close = pd.to_numeric(frame["Close"], errors="coerce")
    high = pd.to_numeric(frame["High"], errors="coerce")
    low = pd.to_numeric(frame["Low"], errors="coerce")
    fast = close.ewm(span=fast_span, adjust=False, min_periods=fast_span).mean()
    slow = close.ewm(span=slow_span, adjust=False, min_periods=slow_span).mean()
    atr = _wilder_atr(frame)

    close_values = close.to_numpy(dtype=np.float64)
    high_values = high.to_numpy(dtype=np.float64)
    low_values = low.to_numpy(dtype=np.float64)
    fast_values = fast.to_numpy(dtype=np.float64)
    slow_values = slow.to_numpy(dtype=np.float64)
    atr_values = atr.to_numpy(dtype=np.float64)

    reversal_atr = float(params["reversal_extension_atr"])
    exhaustion_atr = float(params["exhaustion_extension_atr"])
    wedge_width_atr = float(params["wedge_width_atr"])
    crossback_tolerance_atr = float(params["crossback_tolerance_atr"])
    base_length = int(params["base_length"])
    base_range_atr = float(params["base_range_atr"])
    setup_lookback = int(params["setup_lookback"])
    require_reversal = bool(params["require_reversal_extension"])

    row_count = len(frame)
    stages = [""] * row_count
    states = ["neutral"] * row_count
    state = "neutral"
    last_reversal_index: int | None = None
    crossback_taken = False
    for index in range(row_count):
        values = (
            close_values[index],
            high_values[index],
            low_values[index],
            fast_values[index],
            slow_values[index],
            atr_values[index],
        )
        if index == 0 or not np.all(np.isfinite(values)) or atr_values[index] <= 0:
            states[index] = state
            continue
        close_now, _, low_now, fast_now, slow_now, atr_now = values
        previous = index - 1
        previous_upper = max(fast_values[previous], slow_values[previous])
        previous_lower = min(fast_values[previous], slow_values[previous])
        upper = max(fast_now, slow_now)
        lower = min(fast_now, slow_now)
        extension = (close_now - fast_now) / atr_now
        stage = ""

        if extension <= -reversal_atr:
            stage = "reversal_extension"
            last_reversal_index = index
        reversal_is_recent = (
            last_reversal_index is not None
            and index - last_reversal_index <= setup_lookback
        )
        crossed_up = (
            np.isfinite(previous_upper)
            and close_values[previous] <= previous_upper
            and close_now > upper
        )
        crossed_down = (
            np.isfinite(previous_lower)
            and close_values[previous] >= previous_lower
            and close_now < lower
        )
        wedged = abs(fast_now - slow_now) / atr_now <= wedge_width_atr

        if state != "bull" and crossed_up and wedged and (reversal_is_recent or not require_reversal):
            stage = "wedge_pop"
            state = "bull"
            crossback_taken = False
        elif state != "bear" and crossed_down:
            stage = "wedge_drop"
            state = "bear"
        elif state == "bull" and extension >= exhaustion_atr:
            stage = "exhaustion_extension"
        elif (
                state == "bull"
                and not crossback_taken
                and fast_now > slow_now
                and low_now <= fast_now + crossback_tolerance_atr * atr_now
                and close_now >= fast_now
        ):
            stage = "ema_crossback"
            crossback_taken = True
        elif state == "bull" and crossback_taken and index > base_length:
            window = slice(index - base_length, index)
            base_high = np.nanmax(high_values[window])
            base_low = np.nanmin(low_values[window])
            base_floor = np.nanmin(slow_values[window] - crossback_tolerance_atr * atr_values[window])
            if (
                    np.isfinite(base_high)
                    and close_now > base_high
                    and base_low >= base_floor
                    and (base_high - base_low) / atr_now <= base_range_atr
            ):
                stage = "base_n_break"
        stages[index] = stage
        states[index] = state

    return pd.DataFrame(
        {
            "Date": frame["Date"].to_numpy(),
            _CYCLE_STAGE_COLUMN: stages,
            _CYCLE_STATE_COLUMN: states,
            "cycle_fast_ema": fast_values,
            "cycle_slow_ema": slow_values,
        }
    )


class CycleOfPriceActionStrategy(BayesianPriceFieldStrategy):
    strategy_id = "cycle-of-price-action"
    strategy_name = "Cycle of Price Action"
    strategy_description = (
        "Oliver Kell's 10/20 EMA Cycle of Price Action (2020 U.S. Investing "
        "Championship winner) with Wedge Pop, EMA Crossback, and Base n Break "
        "entries confirmed by the Bayesian Price Field probability grid."
    )
    strategy_category = "price-field"
    strategy_display_order = 45
    strategy_interval_notices = {
        "1m": "Daily cycle stages and Bayesian model; the probability field is available at 1d.",
    }
    strategy_parameter_title = "Cycle parameters"

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        cycle_definitions = (
            StrategyParameterDefinition(
                key="fast_ema",
                label="Fast EMA",
                kind="integer",
                default=10,
                minimum=2,
                maximum=100,
                unit_hint="bars",
                help_text="Kell's short trend average. The cycle measures extensions from this line.",
            ),
            StrategyParameterDefinition(
                key="slow_ema",
                label="Slow EMA",
                kind="integer",
                default=20,
                minimum=3,
                maximum=200,
                unit_hint="bars",
                help_text="Kell's trend-support average. A Wedge Drop closes below both averages.",
            ),
            StrategyParameterDefinition(
                key="reversal_extension_atr",
                label="Reversal Extension",
                kind="number",
                default=2.0,
                minimum=0.5,
                maximum=6.0,
                step=0.1,
                unit_hint="ATR below fast EMA",
                help_text="Marks a Reversal Extension when the close is at least this many ATRs below the fast EMA.",
            ),
            StrategyParameterDefinition(
                key="exhaustion_extension_atr",
                label="Exhaustion Extension",
                kind="number",
                default=3.0,
                minimum=0.5,
                maximum=8.0,
                step=0.1,
                unit_hint="ATR above fast EMA",
                help_text="Marks an Exhaustion Extension when an uptrend closes at least this many ATRs above the fast EMA.",
            ),
            StrategyParameterDefinition(
                key="wedge_width_atr",
                label="Wedge Width",
                kind="number",
                default=1.5,
                minimum=0.1,
                maximum=6.0,
                step=0.1,
                unit_hint="ATR",
                help_text="A Wedge Pop requires the two averages to be converged within this ATR distance.",
            ),
            StrategyParameterDefinition(
                key="crossback_tolerance_atr",
                label="Crossback Tolerance",
                kind="number",
                default=0.25,
                minimum=0.0,
                maximum=2.0,
                step=0.05,
                unit_hint="ATR",
                help_text="How close the low must come to the fast EMA to count as an EMA Crossback test.",
            ),
            StrategyParameterDefinition(
                key="base_length",
                label="Base Length",
                kind="integer",
                default=5,
                minimum=2,
                maximum=60,
                unit_hint="bars",
                help_text="A Base n Break closes above the highest high of this many prior bars.",
            ),
            StrategyParameterDefinition(
                key="base_range_atr",
                label="Base Range",
                kind="number",
                default=3.0,
                minimum=0.5,
                maximum=10.0,
                step=0.1,
                unit_hint="ATR",
                help_text="The base must stay above the slow EMA and span no more than this many ATRs.",
            ),
            StrategyParameterDefinition(
                key="setup_lookback",
                label="Setup Lookback",
                kind="integer",
                default=20,
                minimum=1,
                maximum=120,
                unit_hint="bars",
                help_text="How recent a Reversal Extension must be when it is required before a Wedge Pop.",
            ),
            StrategyParameterDefinition(
                key="require_reversal_extension",
                label="Require Reversal Extension",
                kind="boolean",
                default=False,
                help_text="Only accept a Wedge Pop that follows a recent Reversal Extension.",
            ),
            StrategyParameterDefinition(
                key="exit_on_exhaustion",
                label="Exit on Exhaustion Extension",
                kind="boolean",
                default=True,
                help_text="Take profit at an Exhaustion Extension, then wait for the next EMA Crossback or Base n Break.",
            ),
            StrategyParameterDefinition(
                key="field_confirmation",
                label="Field Confirmation",
                kind="number",
                default=55.0,
                minimum=0.0,
                maximum=95.0,
                step=0.1,
                unit_hint="%",
                help_text="A cycle entry fires only when the Price Field rise probability reaches this level. 0% disables the gate.",
            ),
            StrategyParameterDefinition(
                key="field_exit_probability",
                label="Field Exit Probability",
                kind="number",
                default=35.0,
                minimum=0.0,
                maximum=50.0,
                step=0.1,
                unit_hint="%",
                help_text="Also exits when the Price Field rise probability falls to this level. 0% disables the probabilistic exit.",
            ),
        )
        bayesian_definitions = tuple(
            definition
            for definition in super().get_parameter_definitions()
            if definition.key != "entry_probability"
        )
        return cycle_definitions + bayesian_definitions

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        normalized_params = self.normalize_params(params)
        if int(normalized_params["fast_ema"]) >= int(normalized_params["slow_ema"]):
            raise ValueError("Fast EMA must be shorter than Slow EMA.")
        # The Bayesian threshold intent is replaced below; pin its unused
        # threshold so it cannot perturb the Bayesian model fingerprint.
        field_result = super().compute_signals(
            dataset,
            {**normalized_params, "entry_probability": 60.0},
        )
        output = field_result.frame.copy()

        history = (
            _bundle_ohlcv_frame(self._warmup_bundle)
            if self._warmup_bundle is not None
            else _normalize_ohlcv_frame(dataset)
        )
        cycle = detect_price_action_cycle(history, normalized_params)
        output = output.drop(
            columns=[column for column in cycle.columns if column != "Date" and column in output],
        ).merge(cycle, on="Date", how="left", validate="one_to_one")
        output[_CYCLE_STAGE_COLUMN] = output[_CYCLE_STAGE_COLUMN].fillna("")
        output[_CYCLE_STATE_COLUMN] = output[_CYCLE_STATE_COLUMN].fillna("neutral")

        probability = pd.to_numeric(output[_PROBABILITY_COLUMN], errors="coerce").to_numpy(dtype=np.float64)
        finite_probability = np.isfinite(probability)
        confirmation = float(normalized_params["field_confirmation"]) / 100.0
        exit_probability = float(normalized_params["field_exit_probability"]) / 100.0
        stage = output[_CYCLE_STAGE_COLUMN].to_numpy(dtype=object)
        stage_buy = np.isin(stage, _BUY_STAGES)
        sell_stages = _SELL_STAGES if bool(normalized_params["exit_on_exhaustion"]) else ("wedge_drop",)
        stage_sell = np.isin(stage, sell_stages)
        field_confirms = (
            np.ones(len(output), dtype=bool)
            if confirmation <= 0.0
            else finite_probability & (probability >= confirmation)
        )
        field_exit = (
            np.zeros(len(output), dtype=bool)
            if exit_probability <= 0.0
            else finite_probability & (probability <= exit_probability)
        )
        sell_signal = stage_sell | field_exit
        output["buy_signal"] = pd.Series(stage_buy & field_confirms & ~sell_signal, index=output.index, dtype="bool")
        output["sell_signal"] = pd.Series(sell_signal, index=output.index, dtype="bool")

        cycle_params = {key: normalized_params[key] for key in _CYCLE_PARAMETER_KEYS}
        field_fingerprint = str(field_result.presentation.get("fingerprint", ""))
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "field": field_fingerprint,
                    "cycle_model_version": CYCLE_MODEL_VERSION,
                    "cycle_params": cycle_params,
                },
                sort_keys=True,
                default=str,
            ).encode("utf-8")
        ).hexdigest()
        stage_counts = {
            name: int(np.count_nonzero(stage == name))
            for name in _CYCLE_STAGES
        }
        presentation = {
            **field_result.presentation,
            "schema": CYCLE_OF_PRICE_ACTION_SCHEMA,
            "fingerprint": fingerprint,
            "price_action_cycle": {
                "model_version": CYCLE_MODEL_VERSION,
                "field_model_version": field_result.presentation.get("model_version"),
                "stages": [str(value) for value in stage],
                "states": [str(value) for value in output[_CYCLE_STATE_COLUMN]],
                "stage_counts": stage_counts,
                "params": cycle_params,
            },
        }
        return StrategySignalResult(
            frame=output,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
            metadata={
                **field_result.metadata,
                "fingerprint": fingerprint,
                "cycle_stage_counts": stage_counts,
                "cycle_latest_state": str(output[_CYCLE_STATE_COLUMN].iloc[-1]) if len(output) else "neutral",
            },
            presentation=presentation,
        )
