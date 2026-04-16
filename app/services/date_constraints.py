"""
Exact-range date constraint logic.

Code version: v0.4.0
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import pandas as pd

from app.models.schemas import DateConstraintPayload

_NYSE_SPECIAL_CLOSURES: dict[int, frozenset[date]] = {
    2018: frozenset({date(2018, 12, 5)}),
    2025: frozenset({date(2025, 1, 9)}),
}


def _nth_weekday_of_month(year: int, month: int, weekday: int, occurrence: int) -> date:
    current = date(year, month, 1)
    while current.weekday() != weekday:
        current += timedelta(days=1)
    current += timedelta(weeks=occurrence - 1)
    return current


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    if month == 12:
        current = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        current = date(year, month + 1, 1) - timedelta(days=1)
    while current.weekday() != weekday:
        current -= timedelta(days=1)
    return current


def _calculate_easter_sunday(year: int) -> date:
    """
    Calculate Gregorian Easter Sunday with the Meeus/Jones/Butcher algorithm.
    """
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed_fixed_holiday(year: int, month: int, day: int) -> date:
    observed = date(year, month, day)
    if observed.weekday() == 5:
        return observed - timedelta(days=1)
    if observed.weekday() == 6:
        return observed + timedelta(days=1)
    return observed


@lru_cache(maxsize=32)
def nyse_holidays(year: int) -> frozenset[date]:
    holidays = {
        _observed_fixed_holiday(year, 1, 1),
        _nth_weekday_of_month(year, 1, 0, 3),
        _nth_weekday_of_month(year, 2, 0, 3),
        _calculate_easter_sunday(year) - timedelta(days=2),
        _last_weekday_of_month(year, 5, 0),
        _observed_fixed_holiday(year, 7, 4),
        _nth_weekday_of_month(year, 9, 0, 1),
        _nth_weekday_of_month(year, 11, 3, 4),
        _observed_fixed_holiday(year, 12, 25),
    }
    if year >= 2022:
        holidays.add(_observed_fixed_holiday(year, 6, 19))
    holidays.update(_NYSE_SPECIAL_CLOSURES.get(year, frozenset()))
    return frozenset(holidays)


def is_nyse_trading_day(value: date | pd.Timestamp | str) -> bool:
    current = pd.Timestamp(value).date()
    return current.weekday() < 5 and current not in nyse_holidays(current.year)


def latest_completed_nyse_trading_day(
        reference: pd.Timestamp | str | None = None,
        *,
        market_close_hour: int = 16,
) -> pd.Timestamp:
    anchor = pd.Timestamp.now(tz="UTC") if reference is None else pd.Timestamp(reference)
    if anchor.tzinfo is None:
        anchor = anchor.tz_localize("UTC")
    else:
        anchor = anchor.tz_convert("UTC")

    reference_new_york = anchor.tz_convert("America/New_York")
    candidate = reference_new_york.date()
    if reference_new_york.hour < market_close_hour:
        candidate -= timedelta(days=1)

    while not is_nyse_trading_day(candidate):
        candidate -= timedelta(days=1)

    return pd.Timestamp(candidate)


def align_requested_exact_dates(
        available_dates: pd.Series,
        requested_start: str | None,
        requested_end: str | None,
) -> tuple[pd.Timestamp, pd.Timestamp, str | None]:
    if available_dates.empty:
        raise ValueError("No shared trading dates are available for the selected tickers.")

    available = pd.Index(pd.to_datetime(available_dates).sort_values().unique())
    min_date = available[0]
    max_date = available[-1]
    start = pd.to_datetime(requested_start).normalize() if requested_start else min_date
    end = pd.to_datetime(requested_end).replace(hour=23, minute=59, second=59) if requested_end else max_date

    adjusted = False
    if start < min_date:
        start = min_date
        adjusted = True
    if end > max_date:
        end = max_date
        adjusted = True
    if start > end:
        start = min_date
        end = max_date
        adjusted = True

    start_idx = min(int(available.searchsorted(start, side="left")), len(available) - 1)
    end_idx = max(int(available.searchsorted(end, side="right")) - 1, 0)
    aligned_start = available[start_idx]
    aligned_end = available[end_idx]

    if aligned_start > aligned_end:
        aligned_start = available[0]
        aligned_end = available[-1]
        adjusted = True
    if aligned_start != start or aligned_end != end:
        adjusted = True

    message = None
    if adjusted:
        message = (
            "Date range was automatically adjusted to the nearest shared trading days "
            "available for the selected tickers."
        )
    return aligned_start, aligned_end, message


def build_date_constraint_payload(
        *datasets: pd.DataFrame,
        requested_start: str | None = None,
        requested_end: str | None = None,
) -> DateConstraintPayload:
    if not datasets:
        return DateConstraintPayload(min_date=None, max_date=None, trading_dates=[])

    merged = datasets[0][["Date"]].drop_duplicates().sort_values("Date")
    for dataset in datasets[1:]:
        merged = pd.merge(merged, dataset[["Date"]].drop_duplicates(), on="Date", how="inner").sort_values("Date")
        if merged.empty:
            return DateConstraintPayload(min_date=None, max_date=None, trading_dates=[])

    trading_dates = merged["Date"].dt.strftime("%Y-%m-%d").tolist()
    aligned_start, aligned_end, message = align_requested_exact_dates(
        merged["Date"],
        requested_start,
        requested_end,
    )
    return DateConstraintPayload(
        min_date=trading_dates[0],
        max_date=trading_dates[-1],
        trading_dates=trading_dates,
        adjusted_start=aligned_start.strftime("%Y-%m-%d"),
        adjusted_end=aligned_end.strftime("%Y-%m-%d"),
        message=message,
    )
