"""Neutral indicator and validation primitives for neighbor strategies.

kNN Machine Learning and Lorentzian Classification both need the same observed
bar validation, explicit numeric parameter checking, and Wilder-smoothed
indicators. This module owns those primitives so neither strategy imports the
other's private helpers.

Every helper is causal: it reads only already observed bars, keeps an unknown
warmup as a missing value, and never invents a price. Strategy-specific
feature pairs, neighbor voting, filters, and execution semantics stay with the
owning strategy.

Code version: v1.0.0
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy


def normalize_neighbor_params(strategy: BaseStrategy, params: dict | None) -> dict:
    """Validate explicit numeric input before the shared default/bound handling."""
    checked = dict(params or {})
    for definition in strategy.get_parameter_definitions():
        raw = checked.get(definition.key)
        if raw is None or definition.kind not in {"integer", "number"}:
            continue
        try:
            numeric = float(raw)
            valid = math.isfinite(numeric) and (definition.kind != "integer" or numeric.is_integer())
        except (TypeError, ValueError, OverflowError):
            valid = False
        if not valid:
            raise ValueError(f"{definition.label} must be a finite {definition.kind} value.")
        checked[definition.key] = int(numeric) if definition.kind == "integer" else numeric
    return strategy.normalize_params(checked)


def ensure_neighbor_ohlcv_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Validate observed execution bars without inventing missing prices."""
    normalized = frame.copy()
    if normalized.empty:
        return normalized
    if "Date" in normalized:
        dates = pd.to_datetime(normalized["Date"], errors="coerce")
        if dates.isna().any() or not dates.is_monotonic_increasing or dates.duplicated().any():
            raise ValueError("Neighbor strategies require unique, chronological observed dates.")
    for column in ("Open", "High", "Low", "Close"):
        if column not in normalized:
            raise ValueError(f"Neighbor strategies require observed {column} prices.")
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
        values = normalized[column].to_numpy(dtype=np.float64)
        if not (np.isfinite(values) & (values > 0)).all():
            raise ValueError(f"Neighbor strategies require finite positive {column} prices.")
    if (
        (normalized["High"] < normalized[["Open", "Close", "Low"]].max(axis=1)).any()
        or (normalized["Low"] > normalized[["Open", "Close", "High"]].min(axis=1)).any()
    ):
        raise ValueError("Neighbor strategies require coherent OHLC price bounds.")
    if "Volume" in normalized:
        normalized["Volume"] = pd.to_numeric(normalized["Volume"], errors="coerce")
    return normalized


def wilder_average(series: pd.Series, length: int) -> pd.Series:
    """Seed Wilder smoothing from a complete observed arithmetic mean."""
    window = max(int(length), 1)
    result = np.full(len(series), np.nan, dtype=np.float64)
    total = 0.0
    count = 0
    average = np.nan
    for index, value in enumerate(series.to_numpy(dtype=np.float64)):
        if not np.isfinite(value):
            total, count, average = 0.0, 0, np.nan
            continue
        if count < window:
            total += value
            count += 1
            if count == window:
                average = total / window
        else:
            average += (value - average) / window
        result[index] = average
    return pd.Series(result, index=series.index, dtype="float64")


def wilder_rsi(series: pd.Series, length: int) -> pd.Series:
    delta = series.diff()
    gains = delta.clip(lower=0.0)
    losses = (-delta).clip(lower=0.0)
    average_gain = wilder_average(gains, length)
    average_loss = wilder_average(losses, length)
    relative_strength = average_gain / average_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + relative_strength))
    rsi = rsi.mask(average_loss.eq(0) & average_gain.gt(0), 100.0)
    return rsi.mask(average_loss.eq(0) & average_gain.eq(0), 50.0)


def true_range(frame: pd.DataFrame) -> pd.Series:
    previous_close = frame["Close"].shift(1)
    ranges = pd.concat(
        [
            frame["High"] - frame["Low"],
            (frame["High"] - previous_close).abs(),
            (frame["Low"] - previous_close).abs(),
        ],
        axis=1,
    )
    return ranges.max(axis=1)


def average_true_range(frame: pd.DataFrame, length: int) -> pd.Series:
    return wilder_average(true_range(frame), length)
