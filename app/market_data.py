"""
Market data retrieval services.

Code version: v3.5.0
"""

from __future__ import annotations

from time import sleep
from pathlib import Path

import pandas as pd
import yfinance as yf

from .config import DEFAULT_INTERVAL
from .connectivity import has_remote_market_access
from .storage import ensure_market_store_dir, history_store_path_for, intraday_history_store_path_for


DOWNLOAD_RETRY_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS_SECONDS = (0.0, 0.35, 0.8)


def normalize_history_frame(history: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if history.empty:
        raise ValueError(f"No market data returned for {ticker}.")
    if isinstance(history.columns, pd.MultiIndex):
        history.columns = history.columns.get_level_values(0)

    history = history.reset_index()
    if "Date" not in history.columns and "Datetime" in history.columns:
        history = history.rename(columns={"Datetime": "Date"})

    required_columns = ["Date", "Close"]
    ohlc_columns = ["Open", "High", "Low", "Adj Close"]
    missing_required = [column for column in required_columns if column not in history.columns]
    if missing_required:
        raise ValueError(f"Missing required columns for {ticker}: {', '.join(missing_required)}.")

    all_to_keep = required_columns + [col for col in ohlc_columns if col in history.columns]
    dataset = history[all_to_keep].copy()
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

    history = download_full_history(ticker)
    normalized_dataset = normalize_history_frame(history, ticker)
    path = history_store_path_for(ticker)
    normalized_dataset.to_parquet(path, index=False)
    return path
