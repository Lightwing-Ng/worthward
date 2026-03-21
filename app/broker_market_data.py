"""
Broker-backed intraday market data services.

Code version: v1.0.0
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib import import_module
from typing import Any

import pandas as pd

from .broker_settings import BrokerSettings, has_longbridge_credentials
from .storage import ensure_market_store_dir, intraday_history_store_path_for


ONE_MINUTE_LOOKBACK_DAYS = 366
ONE_MINUTE_CHUNK_SIZE = 1_000
ONE_MINUTE_FRESHNESS_DAYS = 7
ONE_MINUTE_MIN_SPAN_DAYS = 330


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


def _normalize_longbridge_symbol(ticker: str) -> str:
    normalized_ticker = str(ticker or "").strip().upper()
    if not normalized_ticker:
        raise ValueError("Ticker is required.")
    if "." in normalized_ticker:
        return normalized_ticker
    return f"US.{normalized_ticker}"


def _candlestick_rows_to_frame(candlesticks: list[Any]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        timestamp = pd.Timestamp(getattr(candle, "timestamp"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize("UTC")
        else:
            timestamp = timestamp.tz_convert("UTC")
        rows.append(
            {
                "Date": timestamp.tz_convert(None),
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


def fetch_longbridge_one_minute_history(ticker: str, settings: BrokerSettings) -> pd.DataFrame:
    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    Config, QuoteContext, Period, AdjustType = _load_longbridge_openapi()
    config = Config(
        settings.longbridge_app_key.strip(),
        settings.longbridge_app_secret.strip(),
        settings.longbridge_access_token.strip(),
    )
    quote_context = QuoteContext(config)
    symbol = _normalize_longbridge_symbol(ticker)
    end_at = datetime.now(timezone.utc)
    start_at = end_at - timedelta(days=ONE_MINUTE_LOOKBACK_DAYS)

    frames: list[pd.DataFrame] = []
    cursor: datetime | None = None
    previous_oldest: datetime | None = None

    for _ in range(500):
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
        if not batch:
            break

        frame = _candlestick_rows_to_frame(list(batch))
        if frame.empty:
            break
        frames.append(frame)

        oldest_timestamp = pd.Timestamp(frame["Date"].min()).tz_localize("UTC")
        if oldest_timestamp.to_pydatetime() <= start_at:
            break

        next_cursor = (oldest_timestamp - pd.Timedelta(minutes=1)).to_pydatetime()
        if previous_oldest is not None and next_cursor >= previous_oldest:
            break
        previous_oldest = oldest_timestamp.to_pydatetime()
        cursor = next_cursor

    if not frames:
        raise ValueError(f"No 1-minute market data returned for {ticker}.")

    dataset = pd.concat(frames, ignore_index=True)
    dataset = dataset.drop_duplicates(subset=["Date"], keep="first").sort_values("Date")
    dataset = dataset.loc[dataset["Date"] >= pd.Timestamp(start_at).tz_convert(None)].copy()
    if dataset.empty:
        raise ValueError(f"No 1-minute market data returned for {ticker}.")
    return dataset.reset_index(drop=True)


def refresh_longbridge_one_minute_store(ticker: str, settings: BrokerSettings) -> pd.DataFrame:
    ensure_market_store_dir()
    dataset = fetch_longbridge_one_minute_history(ticker, settings)
    path = intraday_history_store_path_for(ticker, "1m")
    dataset.to_parquet(path, index=False)
    return dataset


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
    date_values = pd.to_datetime(dataset["Date"], utc=True, errors="coerce").dropna()
    if date_values.empty:
        return False
    latest = date_values.max()
    earliest = date_values.min()
    now_utc = pd.Timestamp(datetime.now(timezone.utc))
    return bool(
        latest >= now_utc - pd.Timedelta(days=ONE_MINUTE_FRESHNESS_DAYS)
        and earliest <= now_utc - pd.Timedelta(days=ONE_MINUTE_MIN_SPAN_DAYS)
    )
