"""Read-only local market-history helpers used by the web runtime.

Code version: v0.3.0
"""

from __future__ import annotations

import pandas as pd

from app.core.config import PERIOD_OFFSETS
from app.infrastructure.storage import (
    history_store_path_for,
    intraday_history_store_path_for,
    market_ticker_store_aliases,
)
from app.services.comparisons import market_trading_date_for_timestamp
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


def market_trading_dates_for_history(
        dataset: pd.DataFrame,
        ticker: str,
) -> pd.Series:
    """Return exchange trading dates aligned to one intraday history frame."""
    if "Date" not in dataset.columns:
        raise ValueError("Intraday market history is missing Date.")
    timestamps = pd.to_datetime(dataset["Date"], errors="coerce")
    if timestamps.isna().any():
        raise ValueError("Intraday market history contains an invalid timestamp.")
    return timestamps.map(
        lambda value: pd.Timestamp(
            market_trading_date_for_timestamp(value, ticker)
        )
    )


def slice_intraday_history_for_period(
        dataset: pd.DataFrame,
        ticker: str,
        period: str,
) -> pd.DataFrame:
    """Slice intraday history by exchange trading dates instead of New York dates."""
    if dataset.empty:
        return dataset.copy()
    trading_dates = market_trading_dates_for_history(dataset, ticker)
    unique_dates = sorted(trading_dates.drop_duplicates().tolist())
    if not unique_dates:
        return dataset.iloc[0:0].copy()
    if period == "max":
        return dataset.copy()
    if period == "1d":
        return dataset.loc[trading_dates == unique_dates[-1]].copy()
    if period == "3d":
        return dataset.loc[trading_dates.isin(unique_dates[-3:])].copy()
    if period not in PERIOD_OFFSETS:
        raise ValueError(f"Unsupported intraday period: {period}.")
    period_start = (pd.Timestamp(unique_dates[-1]) - PERIOD_OFFSETS[period]).normalize()
    return dataset.loc[trading_dates >= period_start].copy()


def slice_intraday_history_for_exact_range(
        dataset: pd.DataFrame,
        ticker: str,
        start: object,
        end: object,
) -> pd.DataFrame:
    """Slice an exact intraday range by inclusive exchange trading dates."""
    parsed_start = pd.to_datetime(start, errors="coerce")
    parsed_end = pd.to_datetime(end, errors="coerce")
    if pd.isna(parsed_start) or pd.isna(parsed_end):
        raise ValueError("The exact intraday range is invalid.")
    start_date = pd.Timestamp(parsed_start).normalize()
    end_date = pd.Timestamp(parsed_end).normalize()
    if start_date > end_date:
        raise ValueError("The exact intraday range start must not follow its end.")
    trading_dates = market_trading_dates_for_history(dataset, ticker)
    return dataset.loc[trading_dates.between(start_date, end_date)].copy()


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
    date_values = (
        market_trading_dates_for_history(dataset, ticker)
        if interval == "1m"
        else dataset["Date"]
    )
    return build_supported_periods_from_dates(date_values, interval=interval)
