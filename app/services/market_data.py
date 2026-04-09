"""
Market data retrieval services.

Code version: v0.3.6
"""

from __future__ import annotations

from time import sleep
from pathlib import Path
from threading import Lock

import pandas as pd
import yfinance as yf

from app.core.broker_settings import has_longbridge_credentials, load_broker_settings
from app.infrastructure.broker_market_data import (
    fetch_longbridge_daily_history,
    fetch_longbridge_one_minute_history,
    is_daily_store_fresh,
    normalize_one_minute_store_frame,
    refresh_longbridge_one_minute_store,
)
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


def _load_longbridge_market_settings():
    settings = load_broker_settings()
    if not has_longbridge_credentials(settings):
        return None
    return settings


def _download_one_minute_history_with_longbridge(
        ticker: str,
) -> pd.DataFrame:
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-minute market data for {ticker}. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )
    return fetch_longbridge_one_minute_history(ticker, settings, since=None)


def _download_daily_history_with_longbridge(
        ticker: str,
        *,
        start: str | None = None,
) -> pd.DataFrame:
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker}. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )
    since = pd.to_datetime(start, errors="coerce") if start else None
    if since is not None and pd.isna(since):
        since = None
    since_dt = since.to_pydatetime() if since is not None else None
    return fetch_longbridge_daily_history(ticker, settings, since=since_dt)


def _download_daily_history_with_fallback(
        ticker: str,
        *,
        start: str | None = None,
        period: str | None = None,
) -> pd.DataFrame:
    yfinance_error: Exception | None = None
    try:
        return _download_daily_history_with_yfinance(
            ticker,
            start=start,
            period=period,
            interval="1d",
        )
    except Exception as exc:
        yfinance_error = exc

    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker} via yfinance. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access to enable automatic fallback."
        ) from yfinance_error

    try:
        return _download_daily_history_with_longbridge(ticker, start=start)
    except Exception as exc:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker}. yfinance failed and Longbridge fallback also failed: {exc}"
        ) from exc


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


def download_full_history(ticker: str, interval: str = "1d") -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    if interval == "1m":
        last_error: Exception | None = None
        for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
            delay = DOWNLOAD_RETRY_DELAYS_SECONDS[attempt] if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS) else DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
            if delay > 0:
                sleep(delay)
            try:
                return _download_one_minute_history_with_longbridge(normalized_ticker)
            except Exception as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise ValueError(f"Unable to download market data for {ticker}.")
    return _download_daily_history_with_fallback(
        normalized_ticker,
        period="max",
    )


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

    if interval == "1m" and _load_longbridge_market_settings() is None:
        raise ValueError(
            f"Local 1-minute market data for {normalized_ticker} is unavailable. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )

    history = download_full_history(normalized_ticker, interval=interval)
    normalized_dataset = normalize_history_frame(history, normalized_ticker, interval=interval)
    normalized_dataset.to_parquet(path, index=False)
    return select_price_series(normalized_dataset, include_dividends)


def refresh_history_store(ticker: str) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()

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
            new_history = _download_daily_history_with_fallback(
                normalized_ticker,
                start=start_date,
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


def refresh_one_minute_store(ticker: str) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to refresh 1-minute market data for {normalized_ticker}. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )
    refresh_longbridge_one_minute_store(normalized_ticker, settings)
    return intraday_history_store_path_for(normalized_ticker, "1m")


def ensure_fresh_history_store(ticker: str) -> bool:
    """
    Ensures the local daily cache includes the latest completed trading day.

    Returns True when a refresh was performed, otherwise False.
    """
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    if is_daily_store_fresh(normalized_ticker):
        return False
    refresh_history_store(normalized_ticker)
    return True
