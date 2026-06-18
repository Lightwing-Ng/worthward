"""
Market data retrieval services.

Code version: v0.4.0
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import io
import logging
import math
import contextlib
from time import sleep
from pathlib import Path
from threading import Lock

import pandas as pd
import yfinance as yf

from app.core.broker_settings import has_longbridge_market_data_source, load_broker_settings
from app.infrastructure.broker_market_data import (
    NEW_YORK_TIMEZONE,
    fetch_longbridge_daily_history,
    fetch_longbridge_one_minute_history,
    has_recent_one_minute_store,
    is_daily_store_fresh,
    normalize_one_minute_store_frame,
    one_minute_lookback_start,
    refresh_longbridge_one_minute_store,
)
from app.infrastructure.storage import (
    ensure_market_store_dir,
    history_store_path_for,
    intraday_history_store_path_for,
    market_store_file_lock,
    normalize_ticker,
    write_parquet_atomic,
)

DOWNLOAD_RETRY_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS_SECONDS = (0.0, 0.35, 0.8)
YFINANCE_DOWNLOAD_LOCK = Lock()
INTRADAY_INTERVALS = {"1m"}
YFINANCE_INTRADAY_FALLBACK_DAYS = 30
YFINANCE_INTRADAY_FALLBACK_WINDOW_DAYS = 7
YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS = 7
COMMON_SPLIT_FACTORS = (2.0, 3.0, 4.0, 5.0, 8.0, 10.0, 20.0, 25.0, 40.0, 50.0)
SPLIT_FACTOR_CANDIDATES = tuple(
    sorted({*COMMON_SPLIT_FACTORS, *(1.0 / factor for factor in COMMON_SPLIT_FACTORS)})
)
SPLIT_MATCH_TOLERANCE = math.log(1.12)
SPLIT_MIN_EVENT_DISTANCE = math.log(1.5)
SPLIT_MIN_IMPROVEMENT = 0.08
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class OneMinuteRefreshResult:
    path: Path
    source: str
    fetched_days: int


def normalize_market_interval(interval: str | None) -> str:
    normalized_interval = str(interval or "1d").strip().lower()
    return normalized_interval or "1d"


def is_intraday_market_interval(interval: str | None) -> bool:
    return normalize_market_interval(interval) in INTRADAY_INTERVALS


def history_store_path_for_interval(ticker: str, interval: str = "1d") -> Path:
    normalized_ticker = normalize_ticker(ticker)
    normalized_interval = normalize_market_interval(interval)
    if is_intraday_market_interval(normalized_interval):
        return intraday_history_store_path_for(normalized_ticker, normalized_interval)
    return history_store_path_for(normalized_ticker)


def list_available_market_intervals(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    supported_intervals = ["1d"]
    if has_recent_one_minute_store(normalized_ticker):
        supported_intervals.append("1m")
    return supported_intervals


def _download_daily_history_with_yfinance(
        ticker: str,
        *,
        start: str | datetime | None = None,
        end: str | datetime | None = None,
        period: str | None = None,
        interval: str = "1d",
) -> pd.DataFrame:
    """
    Serialize yfinance downloads because yfinance 1.2.0 mutates module-level
    shared state during each request and is not safe under concurrent calls.

    yfinance may also emit noisy diagnostics directly to stderr when it cannot
    resolve symbols like `MSFT.US`. We silence that low-level output here and
    let the caller decide whether to fall back to Longbridge.
    """
    with YFINANCE_DOWNLOAD_LOCK:
        stderr_buffer = io.StringIO()
        stdout_buffer = io.StringIO()
        with contextlib.redirect_stderr(stderr_buffer), contextlib.redirect_stdout(stdout_buffer):
            return yf.download(
                tickers=ticker,
                start=start,
                end=end,
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
    if not has_longbridge_market_data_source(settings):
        return None
    return settings


def _download_one_minute_history_with_longbridge(
        ticker: str,
) -> pd.DataFrame:
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-minute market data for {ticker}. "
            "Configure Longbridge CLI OAuth or Longbridge legacy credentials in Settings > Broker Access first."
        )
    return fetch_longbridge_one_minute_history(ticker, settings, since=None)


def _download_one_minute_history_with_yfinance_window(
        ticker: str,
        *,
        start: pd.Timestamp,
        end: pd.Timestamp,
) -> pd.DataFrame:
    history = _download_daily_history_with_yfinance(
        ticker,
        start=start.to_pydatetime(),
        end=(end + pd.Timedelta(minutes=1)).to_pydatetime(),
        interval="1m",
    )
    if history.empty:
        return history
    normalized = normalize_history_frame(history, ticker, interval="1m")
    return normalized.loc[
        (normalized["Date"] >= start.tz_convert(None))
        & (normalized["Date"] <= end.tz_convert(None))
    ].copy()


def _download_recent_one_minute_history_with_yfinance(
        ticker: str,
        *,
        days: int = YFINANCE_INTRADAY_FALLBACK_DAYS,
) -> pd.DataFrame:
    window_days = max(1, YFINANCE_INTRADAY_FALLBACK_WINDOW_DAYS)
    now_utc = pd.Timestamp.now(tz="UTC").floor("min")
    start_utc = now_utc - pd.Timedelta(days=max(1, days)) + pd.Timedelta(minutes=1)
    cursor = start_utc
    frames: list[pd.DataFrame] = []

    while cursor < now_utc:
        window_end = min(cursor + pd.Timedelta(days=window_days), now_utc)
        try:
            frame = _download_one_minute_history_with_yfinance_window(
                ticker,
                start=cursor,
                end=window_end,
            )
        except Exception as exc:
            LOGGER.warning(
                "Unable to download 1-minute yfinance window for %s between %s and %s: %s",
                ticker,
                cursor,
                window_end,
                exc,
            )
            frame = pd.DataFrame()
        if not frame.empty:
            frames.append(frame)
        if window_end >= now_utc:
            break
        cursor = window_end - pd.Timedelta(minutes=1)

    if not frames:
        raise ValueError(f"No recent 1-minute market data returned for {ticker} via yfinance.")

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
    if combined.empty:
        raise ValueError(f"No recent 1-minute market data returned for {ticker} via yfinance.")
    return combined.reset_index(drop=True)


def _upsert_one_minute_store(ticker: str, dataset: pd.DataFrame) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    path = intraday_history_store_path_for(normalized_ticker, "1m")
    normalized_dataset = normalize_one_minute_store_frame(dataset)
    if normalized_dataset.empty:
        raise ValueError(f"No 1-minute market data returned for {normalized_ticker}.")

    with market_store_file_lock(path):
        if path.exists():
            try:
                existing_df = normalize_one_minute_store_frame(pd.read_parquet(path))
            except (ImportError, OSError, ValueError, KeyError) as exc:
                LOGGER.warning("Unable to read existing 1-minute store for %s from %s: %s", normalized_ticker, path, exc)
                existing_df = pd.DataFrame()
            if not existing_df.empty:
                normalized_dataset = pd.concat([existing_df, normalized_dataset], ignore_index=True)
                normalized_dataset = normalized_dataset.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")

        cut_off = one_minute_lookback_start().tz_convert("America/New_York").tz_localize(None)
        normalized_dataset = normalized_dataset.loc[normalized_dataset["Date"] >= cut_off].copy()
        write_parquet_atomic(path, normalized_dataset, index=False)
    return path


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
    try:
        dataset = _download_daily_history_with_yfinance(
            ticker,
            start=start,
            period=period,
            interval="1d",
        )
        if dataset is None or dataset.empty:
            raise ValueError(f"No 1-day market data returned for {ticker} via yfinance.")
        return dataset
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


def _infer_split_factor(previous_close: float, current_prices: list[float]) -> float | None:
    valid_prices = [float(value) for value in current_prices if pd.notna(value) and float(value) > 0]
    if not math.isfinite(previous_close) or previous_close <= 0 or not valid_prices:
        return None

    observed_ratios = [previous_close / value for value in valid_prices if value > 0]
    if not observed_ratios:
        return None

    observed_ratio = math.exp(sum(math.log(ratio) for ratio in observed_ratios) / len(observed_ratios))
    raw_distance = abs(math.log(observed_ratio))
    if raw_distance < SPLIT_MIN_EVENT_DISTANCE:
        return None

    best_factor = 1.0
    best_distance = math.inf
    for candidate in SPLIT_FACTOR_CANDIDATES:
        distance = abs(math.log(observed_ratio / candidate))
        if distance < best_distance:
            best_distance = distance
            best_factor = candidate

    materially_different = abs(math.log(best_factor)) >= SPLIT_MIN_EVENT_DISTANCE
    confidently_matched = best_distance <= SPLIT_MATCH_TOLERANCE
    meaningfully_improved = best_distance + SPLIT_MIN_IMPROVEMENT < raw_distance
    if not materially_different or not confidently_matched or not meaningfully_improved:
        return None
    return best_factor


def _apply_inferred_split_adjustments(dataset: pd.DataFrame) -> pd.DataFrame:
    """
    Standardize raw broker bars onto a split-adjusted share basis when the
    source does not provide an adjusted close column.
    """
    if dataset.empty or "Adj Close" in dataset.columns or "Close" not in dataset.columns or len(dataset) < 2:
        return dataset

    event_factors = [1.0] * len(dataset)
    for index in range(1, len(dataset)):
        previous_close = dataset.iloc[index - 1].get("Close")
        current_open = dataset.iloc[index].get("Open")
        current_close = dataset.iloc[index].get("Close")
        factor = _infer_split_factor(float(previous_close), [current_open, current_close])
        if factor is not None:
            event_factors[index] = factor

    if all(abs(factor - 1.0) < 1e-9 for factor in event_factors):
        return dataset

    adjusted = dataset.copy()
    suffix_products = pd.Series(event_factors, dtype="float64").iloc[::-1].cumprod().iloc[::-1].tolist()
    divisors = pd.Series([*suffix_products[1:], 1.0], index=adjusted.index, dtype="float64")
    for column in ("Open", "High", "Low", "Close"):
        if column in adjusted.columns:
            adjusted[column] = pd.to_numeric(adjusted[column], errors="coerce") / divisors
    return adjusted


def normalize_history_frame(history: pd.DataFrame, ticker: str, interval: str = "1d") -> pd.DataFrame:
    interval = normalize_market_interval(interval)
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
    if is_intraday_market_interval(interval):
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
    dataset = dataset.dropna(subset=subset_for_drop).sort_values("Date").reset_index(drop=True)
    return _apply_inferred_split_adjustments(dataset)


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
    normalized_interval = normalize_market_interval(interval)
    if is_intraday_market_interval(normalized_interval):
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
    normalized_interval = normalize_market_interval(interval)
    ensure_market_store_dir()
    path = history_store_path_for_interval(normalized_ticker, normalized_interval)
    if path.exists():
        with market_store_file_lock(path):
            dataset = pd.read_parquet(path)
            if is_intraday_market_interval(normalized_interval):
                normalized_intraday = normalize_one_minute_store_frame(dataset)
                if not normalized_intraday.equals(dataset):
                    write_parquet_atomic(path, normalized_intraday, index=False)
                dataset = normalized_intraday
            else:
                dataset = normalize_history_frame(dataset, normalized_ticker, interval=normalized_interval)
        return select_price_series(dataset, include_dividends)

    if is_intraday_market_interval(normalized_interval) and _load_longbridge_market_settings() is None:
        raise ValueError(
            f"Local 1-minute market data for {normalized_ticker} is unavailable. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )

    history = download_full_history(normalized_ticker, interval=normalized_interval)
    normalized_dataset = normalize_history_frame(history, normalized_ticker, interval=normalized_interval)
    with market_store_file_lock(path):
        write_parquet_atomic(path, normalized_dataset, index=False)
    return select_price_series(normalized_dataset, include_dividends)


def refresh_history_store(ticker: str) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()

    path = history_store_path_for(normalized_ticker)

    start_date = None
    existing_df = None
    with market_store_file_lock(path):
        if path.exists():
            try:
                existing_df = normalize_history_frame(pd.read_parquet(path), normalized_ticker)
                if not existing_df.empty:
                    # Get the max date and go back 1 day to ensure overlap and consistency
                    max_date = pd.to_datetime(existing_df["Date"].max())
                    start_date = (max_date - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning("Unable to inspect existing daily history store for %s at %s: %s", normalized_ticker, path, exc)
                existing_df = None

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
                    with market_store_file_lock(path):
                        try:
                            latest_existing = normalize_history_frame(pd.read_parquet(path), normalized_ticker) if path.exists() else existing_df
                        except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                            LOGGER.warning("Unable to re-read daily history store for %s at %s: %s", normalized_ticker, path, exc)
                            latest_existing = existing_df

                        existing_normalized = latest_existing.reset_index(drop=True)
                        existing_max_date = pd.to_datetime(existing_normalized["Date"].max(), errors="coerce")
                        new_max_date = pd.to_datetime(new_df["Date"].max(), errors="coerce")
                        if pd.notna(existing_max_date) and pd.notna(new_max_date) and new_max_date <= existing_max_date:
                            return path

                        # Merge and drop duplicates, keeping newer data for the overlap
                        combined = pd.concat([existing_normalized, new_df])
                        combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
                        if not combined.reset_index(drop=True).equals(existing_normalized):
                            write_parquet_atomic(path, combined, index=False)
                    return path
        except Exception as exc:
            # Fallback to full download if incremental fails
            LOGGER.warning("Incremental daily history refresh failed for %s; falling back to full download: %s", normalized_ticker, exc)

    # Fallback / Initial download
    history = download_full_history(normalized_ticker)
    normalized_dataset = normalize_history_frame(history, normalized_ticker)
    with market_store_file_lock(path):
        write_parquet_atomic(path, normalized_dataset, index=False)
    return path


def refresh_one_minute_store(ticker: str) -> OneMinuteRefreshResult:
    normalized_ticker = normalize_ticker(ticker)
    settings = _load_longbridge_market_settings()
    longbridge_error: Exception | None = None

    if settings is not None:
        try:
            refresh_longbridge_one_minute_store(normalized_ticker, settings)
            return OneMinuteRefreshResult(
                path=intraday_history_store_path_for(normalized_ticker, "1m"),
                source="longbridge",
                fetched_days=180,
            )
        except Exception as exc:
            longbridge_error = exc

    try:
        fallback_dataset = _download_recent_one_minute_history_with_yfinance(
            normalized_ticker,
            days=YFINANCE_INTRADAY_FALLBACK_DAYS,
        )
        fallback_path = _upsert_one_minute_store(normalized_ticker, fallback_dataset)
        return OneMinuteRefreshResult(
            path=fallback_path,
            source="yfinance_30d",
            fetched_days=YFINANCE_INTRADAY_FALLBACK_DAYS,
        )
    except Exception as thirty_day_error:
        try:
            fallback_dataset = _download_recent_one_minute_history_with_yfinance(
                normalized_ticker,
                days=YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
            )
            fallback_path = _upsert_one_minute_store(normalized_ticker, fallback_dataset)
            return OneMinuteRefreshResult(
                path=fallback_path,
                source="yfinance_7d",
                fetched_days=YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
            )
        except Exception as seven_day_error:
            if longbridge_error is not None:
                raise ValueError(
                    f"Unable to refresh 1-minute market data for {normalized_ticker}. "
                    f"Longbridge failed: {longbridge_error}. "
                    f"yfinance 30-day fallback failed: {thirty_day_error}. "
                    f"yfinance 7-day fallback failed: {seven_day_error}."
                ) from seven_day_error
            raise ValueError(
                f"Unable to refresh 1-minute market data for {normalized_ticker}. "
                f"yfinance 30-day fallback failed: {thirty_day_error}. "
                f"yfinance 7-day fallback failed: {seven_day_error}."
            ) from seven_day_error


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
