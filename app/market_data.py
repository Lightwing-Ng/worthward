"""
Market data retrieval services.

Code version: v3.3.1
"""

from __future__ import annotations

import pandas as pd
import yfinance as yf

from .connectivity import has_remote_market_access
from .storage import ensure_market_store_dir, history_store_path_for


def normalize_history_frame(history: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if history.empty:
        raise ValueError(f"No market data returned for {ticker}.")
    if isinstance(history.columns, pd.MultiIndex):
        history.columns = history.columns.get_level_values(0)

    history = history.reset_index()
    if "Date" not in history.columns and "Datetime" in history.columns:
        history = history.rename(columns={"Datetime": "Date"})

    required_columns = ["Date", "Close", "Adj Close"]
    missing_columns = [column for column in required_columns if column not in history.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns for {ticker}: {', '.join(missing_columns)}.")

    dataset = history[required_columns].copy()
    dataset["Date"] = pd.to_datetime(dataset["Date"], utc=True).dt.tz_convert(None)
    dataset["Close"] = pd.to_numeric(dataset["Close"], errors="coerce")
    dataset["Adj Close"] = pd.to_numeric(dataset["Adj Close"], errors="coerce")
    return dataset.dropna(subset=["Date", "Close", "Adj Close"]).sort_values("Date")


def select_price_series(dataset: pd.DataFrame, include_dividends: bool) -> pd.DataFrame:
    price_column = "Adj Close" if include_dividends else "Close"
    return dataset[["Date", price_column]].rename(columns={price_column: "Close"}).copy()


def fetch_history(
    ticker: str,
    interval: str,
    include_dividends: bool,
) -> pd.DataFrame:
    ensure_market_store_dir()
    path = history_store_path_for(ticker)
    if path.exists():
        return select_price_series(pd.read_parquet(path), include_dividends)

    if not has_remote_market_access():
        raise ValueError(
            f"Local market data for {ticker} is unavailable and remote access is blocked. "
            "Sync the latest market_store/ directory from a connected machine first."
        )

    history = yf.download(
        tickers=ticker,
        period="max",
        interval=interval,
        auto_adjust=False,
        progress=False,
        multi_level_index=False,
    )
    normalized_dataset = normalize_history_frame(history, ticker)
    normalized_dataset.to_parquet(path, index=False)
    return select_price_series(normalized_dataset, include_dividends)
