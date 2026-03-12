"""
Exact-range date constraint logic.

Code version: v3.0.0
"""

from __future__ import annotations

import pandas as pd

from .schemas import DateConstraintPayload


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
    end = pd.to_datetime(requested_end).normalize() if requested_end else max_date

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

    start_idx = min(available.searchsorted(start, side="left"), len(available) - 1)
    end_idx = max(available.searchsorted(end, side="right") - 1, 0)
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
