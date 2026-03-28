"""
Market data retrieval services.

Code version: v3.7.0
"""

from __future__ import annotations

from time import sleep
from pathlib import Path

import pandas as pd
import yfinance as yf

from app.core.config import DEFAULT_INTERVAL
from app.infrastructure.broker_market_data import is_daily_store_fresh
from app.infrastructure.connectivity import has_remote_market_access
from app.infrastructure.storage import ensure_market_store_dir, history_store_path_for, intraday_history_store_path_for

DOWNLOAD_RETRY_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS_SECONDS = (0.0, 0.35, 0.8)


def drop_duplicate_columns(frame: pd.DataFrame) -> pd.DataFrame:
    if not frame.columns.has_duplicates:
        return frame
    return frame.loc[:, ~frame.columns.duplicated()].copy()


def normalize_history_frame(history: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if history.empty:
        raise ValueError(f"No market data returned for {ticker}.")
    if isinstance(history.columns, pd.MultiIndex):
        history.columns = history.columns.get_level_values(0)

    history = history.reset_index()
    history = drop_duplicate_columns(history)
    if "Date" not in history.columns and "Datetime" in history.columns:
        history = history.rename(columns={"Datetime": "Date"})

    required_columns = ["Date", "Close"]
    ohlc_columns = ["Open", "High", "Low", "Adj Close"]
    missing_required = [column for column in required_columns if column not in history.columns]
    if missing_required:
        raise ValueError(f"Missing required columns for {ticker}: {', '.join(missing_required)}.")

    all_to_keep = required_columns + [col for col in ohlc_columns if col in history.columns]
    dataset = drop_duplicate_columns(history[all_to_keep].copy())
    dataset["Date"] = pd.to_datetime(dataset["Date"], utc=True).dt.tz_convert(None)
    for col in (ohlc_columns + ["Close"]):
        if col in dataset.columns:
            dataset[col] = pd.to_numeric(dataset[col], errors="coerce")

    subset_for_drop = ["Date", "Close"]
    if "Adj Close" in dataset.columns:
        subset_for_drop.append("Adj Close")
    return dataset.dropna(subset=subset_for_drop).sort_values("Date")


def select_price_series(dataset: pd.DataFrame, include_dividends: bool) -> pd.DataFrame:
    price_column = "Adj Close" if include_dividends and "Adj Close" in dataset.columns else "Close"
    cols = ["Date", "Open", "High", "Low", price_column]
    available_cols = [c for c in cols if c in dataset.columns]
    result = dataset[available_cols].copy()
    if price_column != "Close":
        result = result.rename(columns={price_column: "Close"})
    return result


def download_full_history(ticker: str, interval: str = "1d") -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
        if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS):
            delay = DOWNLOAD_RETRY_DELAYS_SECONDS[attempt]
        else:
            delay = DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
        if delay > 0:
            sleep(delay)
        try:
            return yf.download(
                tickers=ticker,
                period="7d" if interval == "1m" else "max",
                interval=interval,
                auto_adjust=False,
                progress=False,
                multi_level_index=False,
                threads=False,
                timeout=12,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error is not None:
        raise last_error
    raise ValueError(f"Unable to download market data for {ticker}.")


def fetch_history(
        ticker: str,
        include_dividends: bool,
        interval: str = "1d",
) -> pd.DataFrame:
    ensure_market_store_dir()
    path = intraday_history_store_path_for(ticker) if interval == "1m" else history_store_path_for(ticker)
    if path.exists():
        return select_price_series(pd.read_parquet(path), include_dividends)

    if not has_remote_market_access():
        raise ValueError(
            f"Local market data for {ticker} is unavailable and remote access is blocked. "
            "Sync the latest market_store/ directory from a connected machine first."
        )

    history = download_full_history(ticker, interval=interval)
    normalized_dataset = normalize_history_frame(history, ticker)
    normalized_dataset.to_parquet(path, index=False)
    return select_price_series(normalized_dataset, include_dividends)


def refresh_history_store(ticker: str) -> Path:
    ensure_market_store_dir()
    if not has_remote_market_access():
        raise ValueError("Remote market access is unavailable.")

    path = history_store_path_for(ticker)

    start_date = None
    existing_df = None
    if path.exists():
        try:
            existing_df = pd.read_parquet(path)
            if not existing_df.empty:
                # Get the max date and go back 1 day to ensure overlap and consistency
                max_date = pd.to_datetime(existing_df["Date"].max())
                start_date = (max_date - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        except:
            pass

    if start_date:
        # Incremental download logic
        try:
            new_history = yf.download(
                tickers=ticker,
                start=start_date,
                interval="1d",
                auto_adjust=False,
                progress=False,
                multi_level_index=False,
                threads=False,
                timeout=12,
            )
            if not new_history.empty:
                new_df = normalize_history_frame(new_history, ticker)
                if existing_df is not None:
                    # Merge and drop duplicates, keeping newer data for the overlap
                    combined = pd.concat([existing_df, new_df])
                    combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
                    combined.to_parquet(path, index=False)
                    return path
        except:
            # Fallback to full download if incremental fails
            pass

    # Fallback / Initial download
    history = download_full_history(ticker)
    normalized_dataset = normalize_history_frame(history, ticker)
    normalized_dataset.to_parquet(path, index=False)
    return path


def ensure_fresh_history_store(ticker: str) -> bool:
    """
    Ensures the local daily cache includes the latest completed trading day.

    Returns True when a refresh was performed, otherwise False.
    """
    ensure_market_store_dir()
    if is_daily_store_fresh(ticker):
        return False
    if not has_remote_market_access():
        return False
    refresh_history_store(ticker)
    return True
