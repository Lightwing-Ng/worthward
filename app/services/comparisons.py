"""
Comparison and return-series logic.

Code version: v3.3.0
"""

from __future__ import annotations

import pandas as pd

from app.core.config import PERIOD_OFFSETS, SUPPORTED_PERIODS_1D as SUPPORTED_PERIODS
from app.services.presentation import format_display_date
from app.models.schemas import SeriesPayload


def resolve_effective_period(
        requested_period: str,
        dataset_a: pd.DataFrame,
        dataset_b: pd.DataFrame,
) -> tuple[str, str | None]:
    if requested_period == "max":
        return "max", None

    common_start = max(dataset_a["Date"].min(), dataset_b["Date"].min())
    common_end = min(dataset_a["Date"].max(), dataset_b["Date"].max())
    available_days = (common_end - common_start).days
    requested_start = (common_end - PERIOD_OFFSETS[requested_period]).normalize()
    if requested_start >= common_start:
        return requested_period, None

    fallback_period = "max"
    for candidate in SUPPORTED_PERIODS:
        if candidate == "max":
            break
        candidate_start = (common_end - PERIOD_OFFSETS[candidate]).normalize()
        if candidate_start >= common_start:
            fallback_period = candidate

    if available_days <= 0:
        raise ValueError("The selected tickers do not have overlapping trading history.")

    notice = (
        f"Requested period {requested_period} exceeds the shared trading history. "
        f"Automatically switched to {fallback_period} based on the latest common start date "
        f"({format_display_date(common_start)})."
    )
    return fallback_period, notice


def slice_dataset_for_period(dataset: pd.DataFrame, period: str, reference_end_date: pd.Timestamp) -> pd.DataFrame:
    bounded_dataset = dataset[dataset["Date"] <= reference_end_date].copy()
    if bounded_dataset.empty:
        return dataset.tail(1).copy()
    if period == "max":
        return bounded_dataset

    if period == "1d":
        last_date = bounded_dataset["Date"].dt.date.max()
        return bounded_dataset[bounded_dataset["Date"].dt.date == last_date].copy()
    if period == "3d":
        unique_dates = sorted(bounded_dataset["Date"].dt.date.unique(), reverse=True)
        target_dates = unique_dates[:3]
        return bounded_dataset[bounded_dataset["Date"].dt.date.isin(target_dates)].copy()

    start_date = (reference_end_date - PERIOD_OFFSETS[period]).normalize()
    sliced = bounded_dataset[bounded_dataset["Date"] >= start_date].copy()
    return sliced if not sliced.empty else bounded_dataset.tail(1).copy()


def align_datasets_on_common_dates(dataset_a: pd.DataFrame, dataset_b: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    merged = pd.merge(
        dataset_a[["Date", "Close"]],
        dataset_b[["Date", "Close"]],
        on="Date",
        how="inner",
        suffixes=("_a", "_b"),
    ).sort_values("Date")
    if merged.empty:
        raise ValueError("The selected tickers do not share any common trading dates.")
    return (
        merged[["Date", "Close_a"]].rename(columns={"Close_a": "Close"}).copy(),
        merged[["Date", "Close_b"]].rename(columns={"Close_b": "Close"}).copy(),
    )


def build_series_payload(
        ticker: str,
        dataset: pd.DataFrame,
        color: str | None = None,
        *,
        glow: bool = True,
) -> SeriesPayload:
    first_close = float(dataset["Close"].iloc[0])
    normalized_returns = ((dataset["Close"] / first_close) - 1.0) * 100.0
    return SeriesPayload(
        ticker=ticker.upper(),
        dates=dataset["Date"].map(format_display_date).tolist(),
        raw_dates=dataset["Date"].map(lambda value: pd.Timestamp(value).strftime("%Y-%m-%d")).tolist(),
        normalized_returns=[round(value, 4) for value in normalized_returns.tolist()],
        color=color,
        glow=glow,
    )
