"""
Exact-range date constraint logic.

Code version: v0.8.0
"""

from __future__ import annotations

import pandas as pd

from app.core.market_calendar import (
    is_nyse_early_close as is_nyse_early_close,
    is_nyse_trading_day as is_nyse_trading_day,
    latest_completed_nyse_trading_day as latest_completed_nyse_trading_day,
    nyse_holidays as nyse_holidays,
    nyse_market_session_state as nyse_market_session_state,
    nyse_recent_trading_days as nyse_recent_trading_days,
)
from app.models.schemas import DateConstraintPayload



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


def build_date_constraint_availability(
        payload: DateConstraintPayload,
        tickers: list[str],
        datasets: list[pd.DataFrame],
) -> dict[str, object]:
    """Describe the selected symbols that constrain the shared date range."""
    if not payload.min_date or not payload.max_date:
        return {}

    observed_bounds: list[tuple[str, pd.Timestamp, pd.Timestamp]] = []
    for ticker, dataset in zip(tickers, datasets):
        if dataset.empty or "Date" not in dataset.columns:
            continue
        dates = pd.to_datetime(dataset["Date"], errors="coerce").dropna().dt.normalize()
        if dates.empty:
            continue
        observed_bounds.append((ticker, dates.min(), dates.max()))
    if not observed_bounds:
        return {}

    latest_start = max(item[1] for item in observed_bounds)
    earliest_end = min(item[2] for item in observed_bounds)
    start_limiters = [ticker for ticker, first_date, _last_date in observed_bounds if first_date == latest_start]
    end_limiters = [ticker for ticker, _first_date, last_date in observed_bounds if last_date == earliest_end]
    shared_start = pd.Timestamp(payload.min_date)
    shared_end = pd.Timestamp(payload.max_date)

    def ticker_phrase(symbols: list[str]) -> str:
        return ", ".join(symbols)

    start_message = (
        f"{ticker_phrase(start_limiters)} has no comparable history before "
        f"{latest_start.strftime('%d %b %Y')}."
    )
    if shared_start != latest_start:
        start_message = f"{start_message} Shared trading dates begin on {shared_start.strftime('%d %b %Y')}."
    end_message = (
        f"{ticker_phrase(end_limiters)} has no comparable history after "
        f"{earliest_end.strftime('%d %b %Y')}."
    )
    if shared_end != earliest_end:
        end_message = f"{end_message} Shared trading dates end on {shared_end.strftime('%d %b %Y')}."
    return {
        "earliest": {
            "date": payload.min_date,
            "limiting_tickers": start_limiters,
            "message": start_message,
        },
        "latest": {
            "date": payload.max_date,
            "limiting_tickers": end_limiters,
            "message": end_message,
        },
    }
