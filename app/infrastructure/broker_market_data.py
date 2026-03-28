"""
Broker-backed intraday market data services.

    Code version: v1.3.0
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib import import_module
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.core.broker_settings import BrokerSettings, has_longbridge_credentials
from app.infrastructure.storage import ensure_market_store_dir, intraday_history_store_path_for, history_store_path_for

ONE_MINUTE_LOOKBACK_MONTHS = 6
ONE_MINUTE_CHUNK_SIZE = 500
ONE_MINUTE_MIN_SPAN_DAYS = 150
DAILY_MIN_SPAN_DAYS = 330
NEW_YORK_TIMEZONE = "America/New_York"
UTC_TIMEZONE = "UTC"
NEW_YORK_ZONE = ZoneInfo(NEW_YORK_TIMEZONE)


def one_minute_lookback_start(reference: datetime | pd.Timestamp | None = None) -> pd.Timestamp:
    anchor = pd.Timestamp.now(tz="UTC") if reference is None else pd.Timestamp(reference)
    if anchor.tzinfo is None:
        anchor = anchor.tz_localize("UTC")
    else:
        anchor = anchor.tz_convert("UTC")
    return anchor - pd.DateOffset(months=ONE_MINUTE_LOOKBACK_MONTHS)


def test_broker_connection(settings: BrokerSettings) -> tuple[bool, str]:
    if settings.selected_broker == "longbridge":
        if not has_longbridge_credentials(settings):
            return False, "Longbridge credentials (App Key, App Secret, Access Token) are required."
        try:
            Config, QuoteContext, _, _ = _load_longbridge_openapi()
            config = _build_longbridge_config(Config, settings)
            context = QuoteContext(config)
            # Try to fetch a single quote for a common symbol to test connection
            quote = context.quote(["AAPL.US"])
            if quote:
                return True, "Successfully connected to Longbridge."
            return False, "Connected but no data returned. Check your permissions."
        except Exception as e:
            message = str(e)
            if "timeout" in message.lower():
                return False, "Connection timeout. Please check your network or try again."
            return False, f"Connection failed: {message}"

    if settings.selected_broker == "ibkr":
        return False, "IBKR integration is currently in development."

    return False, f"Unsupported broker: {settings.selected_broker}"


def _load_longbridge_openapi() -> tuple[Any, Any, Any, Any]:
    for module_name in ("longbridge.openapi", "longport.openapi"):
        try:
            module = import_module(module_name)
            return module.Config, module.QuoteContext, module.Period, module.AdjustType
        except ImportError:
            continue
    raise RuntimeError(
        "Longbridge OpenAPI is not installed. Add the official Python package before fetching 1-minute history."
    )


def _build_longbridge_config(Config: Any, settings: BrokerSettings) -> Any:
    app_key = settings.longbridge_app_key.strip()
    app_secret = settings.longbridge_app_secret.strip()
    access_token = settings.longbridge_access_token.strip()
    factory = getattr(Config, "from_apikey", None)
    if callable(factory):
        return factory(app_key, app_secret, access_token)
    return Config(app_key, app_secret, access_token)


def _normalize_longbridge_symbol(ticker: str) -> str:
    normalized_ticker = str(ticker or "").strip().upper()
    if not normalized_ticker:
        raise ValueError("Ticker is required.")
    if "." in normalized_ticker:
        return normalized_ticker
    return f"{normalized_ticker}.US"


def _normalize_to_new_york_naive(value: datetime | pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp
    return timestamp.tz_convert(NEW_YORK_TIMEZONE).tz_localize(None)


def _localize_new_york(value: datetime | pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize(NEW_YORK_TIMEZONE)
    return timestamp.tz_convert(NEW_YORK_TIMEZONE)


def _coerce_to_new_york(value: datetime | pd.Timestamp) -> pd.Timestamp:
    """
    Converts any supported timestamp input into an aware New York timestamp.

    Naive values are treated as system-local wall time first, then converted to
    New York. This avoids relying on fixed manual offsets between time zones.
    """
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        local_datetime = timestamp.to_pydatetime().astimezone()
        return pd.Timestamp(local_datetime.astimezone(NEW_YORK_ZONE))
    return timestamp.tz_convert(NEW_YORK_TIMEZONE)


def _read_store_dates_as_new_york_naive(values: pd.Series) -> pd.Series:
    date_values = pd.to_datetime(values, errors="coerce")
    if getattr(date_values.dt, "tz", None) is not None:
        return date_values.dt.tz_convert(NEW_YORK_TIMEZONE).dt.tz_localize(None)
    return date_values


def _parse_longbridge_timestamp(raw_timestamp: object) -> pd.Timestamp:
    if isinstance(raw_timestamp, pd.Timestamp):
        timestamp = raw_timestamp
    elif isinstance(raw_timestamp, datetime):
        timestamp = pd.Timestamp(raw_timestamp)
    else:
        timestamp = pd.Timestamp(raw_timestamp, unit="s", tz=UTC_TIMEZONE)

    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(UTC_TIMEZONE)
    else:
        timestamp = timestamp.tz_convert(UTC_TIMEZONE)
    return timestamp


def _candlestick_rows_to_frame(candlesticks: list[Any]) -> pd.DataFrame:
    """
    Robustly converts Longbridge candlesticks to a DataFrame stored in NYT.

    Longbridge candlestick timestamps are absolute instants and must be parsed
    as UTC-compatible epoch values before conversion.
    According to the user's unified decision, we store 1m data in local Parquet
    strictly using America/New_York (NYT).

    This handles Summer/Winter time transitions (Daylight Saving Time) correctly
    via standard IANA zone names.
    """
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = getattr(candle, "timestamp")

        # Parse the absolute timestamp first, then convert to New York wall time.
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)

        rows.append(
            {
                "Date": ts_nyt.tz_localize(None),
                "Open": float(getattr(candle, "open")),
                "High": float(getattr(candle, "high")),
                "Low": float(getattr(candle, "low")),
                "Close": float(getattr(candle, "close")),
                "Volume": float(getattr(candle, "volume")),
                "Turnover": float(getattr(candle, "turnover")),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume", "Turnover"])
    return pd.DataFrame(rows)


def fetch_longbridge_one_minute_history(
        ticker: str,
        settings: BrokerSettings,
        since: datetime | None = None
) -> pd.DataFrame:
    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    Config, QuoteContext, Period, AdjustType = _load_longbridge_openapi()
    config = _build_longbridge_config(Config, settings)
    quote_context = QuoteContext(config)
    symbol = _normalize_longbridge_symbol(ticker)

    # We fetch backwards from current time
    end_at = datetime.now(timezone.utc)
    # The absolute lookback limit (6 months)
    global_start_at = one_minute_lookback_start(end_at)
    global_start_nyt = _normalize_to_new_york_naive(global_start_at)

    # The incremental lookback limit (if provided)
    # We add 2 hours overlap to ensure no gaps or partial bars at the boundary
    effective_start_nyt = global_start_nyt
    if since is not None:
        effective_start_nyt = max(global_start_nyt, _normalize_to_new_york_naive(since) - timedelta(hours=2))

    frames: list[pd.DataFrame] = []
    cursor: datetime | None = None
    previous_oldest: datetime | None = None

    import time
    for _ in range(500):
        try:
            if cursor is None:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    Period.Min_1,
                    AdjustType.NoAdjust,
                    False,
                    ONE_MINUTE_CHUNK_SIZE,
                )
            else:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    Period.Min_1,
                    AdjustType.NoAdjust,
                    False,
                    ONE_MINUTE_CHUNK_SIZE,
                    cursor,
                )
        except Exception as e:
            if "timeout" in str(e).lower() and frames:
                break
            raise e

        if not batch:
            break

        frame = _candlestick_rows_to_frame(list(batch))
        if frame.empty:
            break
        frames.append(frame)

        # check oldest record in current batch
        batch_min_date = pd.Timestamp(frame["Date"].min())
        oldest_ts_naive = _normalize_to_new_york_naive(batch_min_date)

        if oldest_ts_naive <= effective_start_nyt:
            break

        next_cursor_utc = (_localize_new_york(batch_min_date).tz_convert(UTC_TIMEZONE) - pd.Timedelta(seconds=1)).to_pydatetime()
        if previous_oldest is not None and next_cursor_utc >= previous_oldest:
            break
        previous_oldest = next_cursor_utc
        cursor = next_cursor_utc
        time.sleep(0.04)

    if not frames:
        raise ValueError(f"No 1-minute market data returned for {ticker}.")

    dataset = pd.concat(frames, ignore_index=True)
    dataset = dataset.drop_duplicates(subset=["Date"], keep="first").sort_values("Date")

    # Filter by the global 6-month limit
    dataset = dataset.loc[dataset["Date"] >= global_start_nyt].copy()

    if dataset.empty:
        raise ValueError(f"No 1-minute market data returned for {ticker}.")
    return dataset.reset_index(drop=True)


def refresh_longbridge_one_minute_store(ticker: str, settings: BrokerSettings) -> pd.DataFrame:
    ensure_market_store_dir()
    path = intraday_history_store_path_for(ticker, "1m")

    since: datetime | None = None
    existing_df: pd.DataFrame | None = None
    if path.exists():
        try:
            existing_df = pd.read_parquet(path)
            if not existing_df.empty:
                since = pd.to_datetime(existing_df["Date"].max()).to_pydatetime()
        except:
            pass

    new_dataset = fetch_longbridge_one_minute_history(ticker, settings, since=since)

    if existing_df is not None:
        # Merge new and old
        combined = pd.concat([existing_df, new_dataset])
        # Keep the latest record for any duplicate timestamps
        combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")

        # Enforce the 6-month limit on the combined store
        cut_off = one_minute_lookback_start().tz_convert(NEW_YORK_TIMEZONE).tz_localize(None)
        combined = combined.loc[combined["Date"] >= cut_off].copy()

        combined.to_parquet(path, index=False)
        return combined
    else:
        new_dataset.to_parquet(path, index=False)
        return new_dataset


def has_recent_one_minute_store(ticker: str) -> bool:
    path = intraday_history_store_path_for(ticker, "1m")
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        dataset = pd.read_parquet(path, columns=["Date"])
    except Exception:
        return False
    if dataset.empty:
        return False
    date_values = _read_store_dates_as_new_york_naive(dataset["Date"]).dropna()
    return not date_values.empty


def _is_market_data_fresh(max_date: datetime, now: datetime | pd.Timestamp | None = None) -> bool:
    """
    Checks if market data is fresh up to the most recent completed New York trading day.
    """
    max_date_nyt = _normalize_to_new_york_naive(max_date)
    current_source = pd.Timestamp.now(tz=timezone.utc) if now is None else now
    current_ny = _coerce_to_new_york(current_source)
    now_ny = current_ny.tz_localize(None)

    target_date = now_ny.date()
    if now_ny.hour < 16:
        target_date -= timedelta(days=1)

    while target_date.weekday() >= 5:  # Sat=5, Sun=6
        target_date -= timedelta(days=1)

    return max_date_nyt.date() >= target_date


def is_one_minute_store_complete(ticker: str) -> bool:
    path = intraday_history_store_path_for(ticker, "1m")
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        dataset = pd.read_parquet(path, columns=["Date"])
    except Exception:
        return False
    if dataset.empty:
        return False

    date_values = _read_store_dates_as_new_york_naive(dataset["Date"])
    if date_values.empty:
        return False

    min_date = date_values.min()
    max_date = date_values.max()

    # Check span context
    span_days = (max_date - min_date).days
    if span_days < ONE_MINUTE_MIN_SPAN_DAYS:
        return False

    # Check freshness against last trading day
    return _is_market_data_fresh(max_date)


def is_daily_store_complete(ticker: str) -> bool:
    path = history_store_path_for(ticker)
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        dataset = pd.read_parquet(path, columns=["Date"])
    except Exception:
        return False
    if dataset.empty:
        return False

    date_values = _read_store_dates_as_new_york_naive(dataset["Date"])
    if date_values.empty:
        return False

    min_date = date_values.min()
    max_date = date_values.max()

    # Check span context
    span_days = (max_date - min_date).days
    if span_days < DAILY_MIN_SPAN_DAYS:
        return False

    # Check freshness against last trading day
    return _is_market_data_fresh(max_date)


def is_daily_store_fresh(ticker: str) -> bool:
    path = history_store_path_for(ticker)
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        dataset = pd.read_parquet(path, columns=["Date"])
    except Exception:
        return False
    if dataset.empty:
        return False

    date_values = _read_store_dates_as_new_york_naive(dataset["Date"]).dropna()
    if date_values.empty:
        return False

    return _is_market_data_fresh(date_values.max())
