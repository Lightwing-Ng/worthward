"""Read-only local market-history helpers used by the web runtime.

Code version: v0.1.0
"""

from __future__ import annotations

import pandas as pd

from app.infrastructure.storage import (
    history_store_path_for,
    intraday_history_store_path_for,
    market_ticker_store_aliases,
)
from app.services.range_options import build_supported_periods_from_dates


def align_datasets_on_common_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
    """Return close-price datasets restricted to dates shared by every ticker."""
    merged = datasets[0][["Date", "Close"]].rename(columns={"Close": "Close_0"}).copy()
    for index, dataset in enumerate(datasets[1:], start=1):
        merged = pd.merge(
            merged,
            dataset[["Date", "Close"]].rename(columns={"Close": f"Close_{index}"}),
            on="Date",
            how="inner",
        ).sort_values("Date")
    if merged.empty:
        raise ValueError("The selected tickers do not share any common trading dates.")
    return [
        merged[["Date", f"Close_{index}"]].rename(columns={f"Close_{index}": "Close"}).copy()
        for index in range(len(datasets))
    ]


def extract_shared_dates(datasets: list[pd.DataFrame]) -> pd.Series:
    """Return the sorted intersection of available dataset dates."""
    if not datasets:
        return pd.Series(dtype="datetime64[ns]")
    merged = datasets[0][["Date"]].drop_duplicates().sort_values("Date")
    for dataset in datasets[1:]:
        merged = pd.merge(
            merged,
            dataset[["Date"]].drop_duplicates(),
            on="Date",
            how="inner",
        ).sort_values("Date")
        if merged.empty:
            return pd.Series(dtype="datetime64[ns]")
    return merged["Date"].reset_index(drop=True)


def extract_union_dates(datasets: list[pd.DataFrame]) -> pd.Series:
    """Return the sorted union of available dataset dates."""
    if not datasets:
        return pd.Series(dtype="datetime64[ns]")
    return pd.concat(
        [dataset["Date"] for dataset in datasets if "Date" in dataset.columns],
        ignore_index=True,
    ).drop_duplicates().sort_values().reset_index(drop=True)


def build_supported_periods_for_history_store(ticker: str, interval: str = "1d") -> list[str]:
    """Read local history metadata and return only periods supported by the cache."""
    default_periods = ["1d"] if interval == "1m" else ["max"]
    path = next(
        (
            candidate_path
            for candidate in market_ticker_store_aliases(ticker)
            if (
                candidate_path := intraday_history_store_path_for(candidate, interval)
                if interval == "1m"
                else history_store_path_for(candidate)
            ).exists()
            and candidate_path.stat().st_size > 0
        ),
        intraday_history_store_path_for(ticker, interval)
        if interval == "1m"
        else history_store_path_for(ticker),
    )
    if not path.exists() or path.stat().st_size == 0:
        return default_periods
    try:
        dataset = pd.read_parquet(path, columns=["Date"])
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        return default_periods
    if dataset.empty:
        return default_periods
    return build_supported_periods_from_dates(dataset["Date"], interval=interval)
