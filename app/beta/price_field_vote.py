"""Pure Price Field evidence adapter for the Beta committee. Code version: v1.0.0.

This adapter consumes an already computed forecast. It never loads market data,
starts training, persists results, or changes the Backtest signal contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
import math
from numbers import Real
from typing import Any

import pandas as pd

from strategies.price_field.contract import PROBABILITY_GRID_RENDERER
from strategies.price_field.direct_horizon import MAX_HORIZON
from strategies.price_field.pipeline import (
    multi_step_price_field_normal_parameters,
    normal_probability_above_zero,
)

_SERIES_FIELDS = (
    "predictive_mean", "predictive_scale", "probability_up",
    "return_autoregression", "return_long_run_mean", "return_innovation_scale",
)
_AUTOREGRESSIVE_KINDS = frozenset({"dynamic-normal-log-return", "lstm-gaussian-log-return"})


def _timestamp(value: object) -> pd.Timestamp:
    """Parse one explicit date without silently repairing its time component."""
    if not isinstance(value, (str, date, datetime, pd.Timestamp)):
        raise ValueError("A valid forecast origin date is required.")
    try:
        result = pd.Timestamp(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("A valid forecast origin date is required.") from exc
    if pd.isna(result):
        raise ValueError("A valid forecast origin date is required.")
    return result.tz_convert("UTC").tz_localize(None) if result.tzinfo is not None else result


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    try:
        result = float(value)
    except (OverflowError, ValueError):
        return None
    return result if math.isfinite(result) else None


def extract_price_field_vote(
        presentation: object, *, origin: object, model_id: str,
        threshold_pct: float = 60.0, horizon: int = 1,
) -> dict[str, Any]:
    """Return one vote from the exact latest origin of an existing Price Field.

    Bayesian, LSTM, and Cycle retain their executable open-to-open semantics.
    Direct models retain their close-to-future-close semantics and learned
    horizons. Missing or malformed evidence abstains; invalid requested
    configuration raises ``ValueError``.
    """
    requested_origin = _timestamp(origin)
    threshold = _number(threshold_pct)
    if threshold is None or not 50.0 < threshold <= 100.0:
        raise ValueError("The approval probability must be greater than 50% and at most 100%.")
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"The forecast horizon must be an integer from 1 through {MAX_HORIZON}.")
    if not isinstance(model_id, str) or not model_id.strip():
        raise ValueError("A Price Field model ID is required.")
    payload = presentation if isinstance(presentation, Mapping) else {}
    result: dict[str, Any] = {
        "member": "price-field", "name": "Price Field", "vote": "abstain",
        "probability_up": None, "reason": "No Price Field forecast is available.",
        "origin": requested_origin.isoformat(), "horizon": horizon,
        "target_interval": payload.get("target_interval") if isinstance(payload.get("target_interval"), str) else None,
        "model_id": model_id,
        "model_version": payload.get("model_version") if isinstance(payload.get("model_version"), str) else None,
        "fingerprint": payload.get("fingerprint") if isinstance(payload.get("fingerprint"), str) else None,
    }

    def abstain(reason: str) -> dict[str, Any]:
        result["reason"] = reason
        return result

    if payload.get("renderer") != PROBABILITY_GRID_RENDERER:
        return abstain("The selected result does not contain a supported Price Field forecast.")
    keys = payload.get("data_keys")
    if not isinstance(keys, (list, tuple)) or not keys:
        return abstain("Forecast origin dates are unavailable.")
    try:
        dates = [_timestamp(value) for value in keys]
    except ValueError:
        return abstain("Forecast origin dates are invalid.")
    if any(right <= left for left, right in zip(dates, dates[1:])):
        return abstain("Forecast origin dates must be unique and in ascending order.")
    if dates[-1] != requested_origin:
        return abstain("The forecast does not match the requested latest origin; older forecasts are not reused.")
    count = len(dates)
    for field in _SERIES_FIELDS:
        values = payload.get(field)
        if not isinstance(values, (list, tuple)) or len(values) != count:
            return abstain("Forecast series do not align with their origin dates.")
        if any(value is not None and _number(value) is None for value in values):
            return abstain("Forecast series contain invalid values.")
    if any(value is not None and not 0.0 <= float(value) <= 1.0 for value in payload["probability_up"]):
        return abstain("Forecast rise probabilities are invalid.")

    kind = payload.get("distribution_kind")
    if not isinstance(kind, str):
        return abstain("The selected Price Field distribution is unsupported.")
    if kind in _AUTOREGRESSIVE_KINDS:
        if payload.get("target_interval") != "next-open-to-following-open":
            return abstain("The autoregressive forecast target interval is unsupported.")
        values = [_number(payload[field][-1]) for field in (
            "predictive_mean", "predictive_scale", "return_autoregression",
            "return_long_run_mean", "return_innovation_scale",
        )]
        if any(value is None for value in values):
            return abstain("No valid model forecast is available at the requested latest origin.")
        mean, scale, autoregression, equilibrium, innovation = values
        if scale <= 0 or innovation <= 0 or abs(autoregression) > 0.95:
            return abstain("The latest forecast has an invalid scale or return state.")
        try:
            mean, scale = multi_step_price_field_normal_parameters(
                mean, scale, horizon, autoregression, equilibrium, innovation,
            )
        except (ArithmeticError, ValueError, TypeError):
            return abstain("The selected forecast horizon cannot be evaluated.")
    elif kind == "direct-normal-horizon":
        if payload.get("target_interval") != "signal-close-to-future-close":
            return abstain("The direct forecast target interval is unsupported.")
        if type(payload.get("max_horizon")) is not int or payload["max_horizon"] != MAX_HORIZON:
            return abstain("The direct forecast horizon contract is unsupported.")
        heads = [payload.get(field) for field in ("horizon_predictive_mean", "horizon_predictive_std")]
        if any(not isinstance(series, (list, tuple)) or len(series) != count for series in heads):
            return abstain("Direct forecast series do not align with their origin dates.")
        if any(not isinstance(row, (list, tuple)) or len(row) != MAX_HORIZON
               for series in heads for row in series):
            return abstain("Direct forecast heads do not contain the complete supported horizons.")
        if any(value is not None and _number(value) is None
               for series in heads for row in series for value in row):
            return abstain("Direct forecast heads contain invalid values.")
        mean, scale = (_number(series[-1][horizon - 1]) for series in heads)
    else:
        return abstain("The selected Price Field distribution is unsupported.")
    if mean is None or scale is None or not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0:
        return abstain("No valid model forecast is available at the requested latest origin.")
    probability = normal_probability_above_zero(mean, scale)
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        return abstain("The selected forecast does not produce a valid probability.")
    result["probability_up"] = probability
    if probability >= threshold / 100.0:
        result["vote"] = "approve"
        result["reason"] = "The forecast rise probability reaches the approval threshold."
    elif probability <= 1.0 - threshold / 100.0:
        result["vote"] = "oppose"
        result["reason"] = "The forecast rise probability reaches the opposition threshold."
    else:
        result["vote"] = "neutral"
        result["reason"] = "The forecast rise probability is between the voting thresholds."
    return result
