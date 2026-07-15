"""
Shared workspace range-option policy.

Code version: v0.1.0
"""

from __future__ import annotations

import pandas as pd

from app.core.config import (
    COMPARE_PERIODS_1D,
    PERIOD_OFFSETS,
    SUPPORTED_PERIODS_1D,
    SUPPORTED_PERIODS_1M,
)
from app.services.presentation import format_display_date, format_period_label

TRADING_DAY_REQUIREMENTS = {
    "1d": 1,
    "3d": 3,
}
COMPARE_INTRADAY_PERIODS = ("1d", "3d", "1w")


def build_supported_periods_from_dates(
        date_values: pd.Series,
        interval: str = "1d",
        *,
        candidate_periods: tuple[str, ...] | None = None,
) -> list[str]:
    """Return ordered relative ranges supported by one authoritative date series."""
    timestamps = pd.to_datetime(date_values, errors="coerce").dropna().sort_values().drop_duplicates()
    if timestamps.empty:
        return ["1d"] if interval == "1m" else ["max"]

    start = timestamps.iloc[0]
    end = timestamps.iloc[-1]
    trading_day_count = len(pd.Index(timestamps.dt.normalize()).unique())
    if candidate_periods is None:
        candidate_periods = SUPPORTED_PERIODS_1M if interval == "1m" else SUPPORTED_PERIODS_1D
    supported: list[str] = []

    for candidate in candidate_periods:
        if candidate == "max":
            continue
        if candidate in TRADING_DAY_REQUIREMENTS:
            if trading_day_count >= TRADING_DAY_REQUIREMENTS[candidate]:
                supported.append(candidate)
            continue
        if candidate in PERIOD_OFFSETS:
            candidate_start = (end - PERIOD_OFFSETS[candidate]).normalize()
            if candidate_start >= start.normalize():
                supported.append(candidate)

    if interval == "1m":
        if not supported:
            supported.append("1d")
        if len(supported) >= 2:
            supported.append("max")
        return supported

    supported.append("max")
    return supported


def build_supported_compare_periods(
        daily_date_values: pd.Series,
        intraday_period_sets: list[set[str]],
) -> list[str]:
    """Build one ordered range list for every multi-ticker comparison workspace."""
    intraday_supported: list[str] = []
    if intraday_period_sets and all(period_set for period_set in intraday_period_sets):
        intraday_supported = [
            candidate
            for candidate in COMPARE_INTRADAY_PERIODS
            if candidate == "1d" or any(candidate in period_set for period_set in intraday_period_sets)
        ]

    daily_supported = build_supported_periods_from_dates(
        daily_date_values,
        interval="1d",
        candidate_periods=COMPARE_PERIODS_1D,
    )
    return [
        *intraday_supported,
        *[candidate for candidate in daily_supported if candidate not in COMPARE_INTRADAY_PERIODS],
    ]


def resolve_requested_period_from_supported(
        requested_period: str,
        supported_periods: list[str],
        earliest_available: pd.Timestamp | None = None,
) -> tuple[str, str | None]:
    """Keep the selected range and rendered options in one valid state."""
    if requested_period in supported_periods:
        return requested_period, None

    fallback_period = supported_periods[-1] if supported_periods else "max"
    notice = (
        f"Requested period {format_period_label(requested_period)} exceeds the available trading history. "
        f"Automatically switched to {format_period_label(fallback_period)}."
    )
    if earliest_available is not None:
        notice = (
            f"{notice} Earliest available data starts on "
            f"{format_display_date(earliest_available)}."
        )
    return fallback_period, notice
