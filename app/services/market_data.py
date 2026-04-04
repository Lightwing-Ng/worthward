"""
Market data retrieval services.

Code version: v0.3.3
"""

from __future__ import annotations

from time import sleep
from pathlib import Path
from threading import Lock

import pandas as pd
import yfinance as yf

from app.core.config import DEFAULT_INTERVAL
from app.infrastructure.broker_market_data import is_daily_store_fresh, normalize_one_minute_store_frame
from app.infrastructure.connectivity import has_remote_market_access
from app.infrastructure.storage import (
    ensure_market_store_dir,
    history_store_path_for,
    intraday_history_store_path_for,
    normalize_ticker,
)

DOWNLOAD_RETRY_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS_SECONDS = (0.0, 0.35, 0.8)
YFINANCE_DOWNLOAD_LOCK = Lock()


def _download_daily_history_with_yfinance(
        ticker: str,
        *,
        start: str | None = None,
        period: str | None = None,
        interval: str = "1d",
) -> pd.DataFrame:
    """
    Serialize yfinance downloads because yfinance 1.2.0 mutates module-level
    shared state during each request and is not safe under concurrent calls.
    """
    with YFINANCE_DOWNLOAD_LOCK:
        return yf.download(
            tickers=ticker,
            start=start,
            period=period,
            interval=interval,
            auto_adjust=False,
            progress=False,
            multi_level_index=False,
            threads=False,
            timeout=12,
        )


def drop_duplicate_columns(frame: pd.DataFrame) -> pd.DataFrame:
    if not frame.columns.has_duplicates:
        return frame
    return frame.loc[:, ~frame.columns.duplicated()].copy()


def _normalize_store_frame_for_compare(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = drop_duplicate_columns(frame.copy())
    if "Date" in normalized.columns:
        normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized = normalized.sort_values("Date").reset_index(drop=True)
    return normalized


def normalize_history_frame(history: pd.DataFrame, ticker: str, interval: str = "1d") -> pd.DataFrame:
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
    if interval == "1m":
        try:
            from app.infrastructure.broker_market_data import NEW_YORK_TIMEZONE
        except ImportError:
            import pytz
            NEW_YORK_TIMEZONE = pytz.timezone("America/New_York")
        dates = pd.to_datetime(dataset["Date"], utc=True)
        dataset["Date"] = dates.dt.tz_convert(NEW_YORK_TIMEZONE).dt.tz_localize(None)
    else:
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


def _download_yfinance_1m_rolling(ticker: str) -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    from datetime import datetime, timedelta, timezone
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=29)

    dfs = []
    current_end = end_date
    while current_end > start_date:
        current_start = max(current_end - timedelta(days=7), start_date)
        try:
            with YFINANCE_DOWNLOAD_LOCK:
                df = yf.download(
                    tickers=normalized_ticker,
                    start=current_start,
                    end=current_end,
                    interval="1m",
                    auto_adjust=False,
                    progress=False,
                    multi_level_index=False,
                    threads=False,
                    timeout=12,
                )
            if not df.empty:
                dfs.append(df)
        except Exception:
            pass
        current_end = current_start

    if not dfs:
        raise ValueError(f"Unable to download 1m market data for {normalized_ticker}.")

    combined = pd.concat(dfs)
    if not combined.empty:
        # Keep 'last' duplicate to handle boundary overlaps safely
        combined = combined[~combined.index.duplicated(keep="last")]
        combined = combined.sort_index()
    return combined

def download_full_history(ticker: str, interval: str = "1d") -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    if interval == "1m":
        last_error: Exception | None = None
        for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
            delay = DOWNLOAD_RETRY_DELAYS_SECONDS[attempt] if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS) else DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
            if delay > 0:
                sleep(delay)
            try:
                return _download_yfinance_1m_rolling(normalized_ticker)
            except Exception as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise ValueError(f"Unable to download market data for {ticker}.")

    last_error: Exception | None = None
    for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
        delay = DOWNLOAD_RETRY_DELAYS_SECONDS[attempt] if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS) else DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
        if delay > 0:
            sleep(delay)
        try:
            return _download_daily_history_with_yfinance(
                normalized_ticker,
                period="max",
                interval=interval,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error is not None:
        raise last_error
    raise ValueError(f"Unable to download market data for {normalized_ticker}.")


def fetch_history(
        ticker: str,
        include_dividends: bool,
        interval: str = "1d",
) -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    path = (
        intraday_history_store_path_for(normalized_ticker)
        if interval == "1m"
        else history_store_path_for(normalized_ticker)
    )
    if path.exists():
        dataset = pd.read_parquet(path)
        if interval == "1m":
            normalized_intraday = normalize_one_minute_store_frame(dataset)
            if not normalized_intraday.equals(dataset):
                normalized_intraday.to_parquet(path, index=False)
            dataset = normalized_intraday
        return select_price_series(dataset, include_dividends)

    if not has_remote_market_access():
        raise ValueError(
            f"Local market data for {normalized_ticker} is unavailable and remote access is blocked. "
            "Sync the latest market_store/ directory from a connected machine first."
        )

    history = download_full_history(normalized_ticker, interval=interval)
    normalized_dataset = normalize_history_frame(history, normalized_ticker, interval=interval)
    normalized_dataset.to_parquet(path, index=False)
    return select_price_series(normalized_dataset, include_dividends)


def refresh_history_store(ticker: str) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    if not has_remote_market_access():
        raise ValueError("Remote market access is unavailable.")

    path = history_store_path_for(normalized_ticker)

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
            new_history = _download_daily_history_with_yfinance(
                normalized_ticker,
                start=start_date,
                interval="1d",
            )
            if not new_history.empty:
                new_df = normalize_history_frame(new_history, normalized_ticker)
                if existing_df is not None:
                    existing_normalized = _normalize_store_frame_for_compare(existing_df)
                    existing_max_date = pd.to_datetime(existing_normalized["Date"].max(), errors="coerce")
                    new_max_date = pd.to_datetime(new_df["Date"].max(), errors="coerce")
                    if pd.notna(existing_max_date) and pd.notna(new_max_date) and new_max_date <= existing_max_date:
                        return path

                    # Merge and drop duplicates, keeping newer data for the overlap
                    combined = pd.concat([existing_normalized, new_df])
                    combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
                    if not combined.reset_index(drop=True).equals(existing_normalized):
                        combined.to_parquet(path, index=False)
                    return path
        except:
            # Fallback to full download if incremental fails
            pass

    # Fallback / Initial download
    history = download_full_history(normalized_ticker)
    normalized_dataset = normalize_history_frame(history, normalized_ticker)
    normalized_dataset.to_parquet(path, index=False)
    return path


def ensure_fresh_history_store(ticker: str) -> bool:
    """
    Ensures the local daily cache includes the latest completed trading day.

    Returns True when a refresh was performed, otherwise False.
    """
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    if is_daily_store_fresh(normalized_ticker):
        return False
    if not has_remote_market_access():
        return False
    refresh_history_store(normalized_ticker)
    return True
