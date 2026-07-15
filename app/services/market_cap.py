"""
Historical market-cap derivation from authoritative prices and reported shares.

Code version: v0.2.0
"""

from __future__ import annotations

import logging
from pathlib import Path
import time
from typing import Any

import pandas as pd
import yfinance as yf

from app.core.broker_settings import load_broker_settings
from app.core.config import MARKET_STORE_DIR
from app.infrastructure.broker_market_data import (
    fetch_longbridge_market_cap_snapshot as fetch_longbridge_market_cap_snapshot_from_provider,
    normalize_longbridge_symbol,
)
from app.infrastructure.runtime_network import get_yfinance_session
from app.infrastructure.storage import market_store_file_lock, normalize_ticker, write_parquet_atomic
from app.models.schemas import SeriesPayload
from app.services.presentation import format_display_date, format_display_datetime

LOGGER = logging.getLogger(__name__)
SHARES_STORE_DIR = MARKET_STORE_DIR / "fundamentals" / "shares"
SHARES_CACHE_TTL_SECONDS = 24 * 60 * 60
LONGBRIDGE_SNAPSHOT_CACHE_TTL_SECONDS = 5 * 60
LONGBRIDGE_CROSS_CHECK_MAX_AGE_DAYS = 7
LONGBRIDGE_MATCH_TOLERANCE_PERCENT = 2.0
LONGBRIDGE_REVIEW_TOLERANCE_PERCENT = 10.0
_LONGBRIDGE_SNAPSHOT_CACHE: dict[str, tuple[float, dict[str, Any] | None]] = {}


def to_naive_timestamp(value: object) -> pd.Timestamp:
    timestamp = pd.to_datetime(value, errors="coerce")
    if pd.isna(timestamp):
        return pd.NaT
    return timestamp.tz_localize(None) if timestamp.tzinfo is not None else timestamp


def shares_store_path_for(ticker: str) -> Path:
    return SHARES_STORE_DIR / f"{normalize_ticker(ticker)}.parquet"


def yahoo_quote_symbol(ticker: str) -> str:
    normalized = normalize_ticker(ticker)
    if normalized.endswith(".SH"):
        return f"{normalized[:-3]}.SS"
    if normalized.endswith(".US"):
        return normalized[:-3]
    return normalized


def _positive_number(value: object) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    return float(parsed) if pd.notna(parsed) and float(parsed) > 0 else None


def fetch_longbridge_market_cap_snapshot(ticker: str) -> dict[str, Any] | None:
    """Return Longbridge's current market cap and its same-timestamp implied shares."""
    symbol = normalize_longbridge_symbol(ticker)
    cached = _LONGBRIDGE_SNAPSHOT_CACHE.get(symbol)
    if cached and time.time() - cached[0] <= LONGBRIDGE_SNAPSHOT_CACHE_TTL_SECONDS:
        return cached[1]

    try:
        snapshot = fetch_longbridge_market_cap_snapshot_from_provider(ticker, load_broker_settings())
    except Exception as exc:  # noqa: BLE001
        LOGGER.info("Longbridge market-cap cross-check is unavailable for %s: %s", ticker, exc)
        snapshot = None
    _LONGBRIDGE_SNAPSHOT_CACHE[symbol] = (time.time(), snapshot)
    return snapshot


def _is_recent_market_cap_window(latest_date: pd.Timestamp) -> bool:
    latest = pd.Timestamp(latest_date).tz_localize(None).normalize()
    today = pd.Timestamp.now(tz="America/New_York").tz_localize(None).normalize()
    return today - pd.Timedelta(days=LONGBRIDGE_CROSS_CHECK_MAX_AGE_DAYS) <= latest <= today + pd.Timedelta(days=1)


def _cross_check_status(delta_percent: float) -> str:
    absolute_delta = abs(delta_percent)
    if absolute_delta <= LONGBRIDGE_MATCH_TOLERANCE_PERCENT:
        return "matched"
    if absolute_delta <= LONGBRIDGE_REVIEW_TOLERANCE_PERCENT:
        return "review"
    return "diverged"


def normalize_reported_shares(values: pd.Series | pd.DataFrame | None) -> pd.DataFrame:
    if values is None:
        return pd.DataFrame(columns=["Date", "Shares"])
    if isinstance(values, pd.DataFrame):
        if "Date" not in values.columns or "Shares" not in values.columns:
            return pd.DataFrame(columns=["Date", "Shares"])
        frame = values[["Date", "Shares"]].copy()
    else:
        frame = values.rename("Shares").rename_axis("Date").reset_index()
    frame["Date"] = frame["Date"].map(to_naive_timestamp)
    frame["Shares"] = pd.to_numeric(frame["Shares"], errors="coerce")
    return (
        frame.dropna(subset=["Date", "Shares"])
        .loc[lambda item: item["Shares"] > 0]
        .drop_duplicates(subset=["Date"], keep="last")
        .sort_values("Date")
        .reset_index(drop=True)
    )


def load_reported_shares(ticker: str) -> pd.DataFrame:
    path = shares_store_path_for(ticker)
    if not path.exists() or path.stat().st_size == 0:
        return normalize_reported_shares(None)
    try:
        return normalize_reported_shares(pd.read_parquet(path))
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        return normalize_reported_shares(None)


def fetch_reported_shares(ticker: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Refresh and merge Yahoo's reported shares without inventing missing observations."""
    cached = load_reported_shares(ticker)
    cache_path = shares_store_path_for(ticker)
    if (
            not cached.empty
            and cache_path.exists()
            and time.time() - cache_path.stat().st_mtime <= SHARES_CACHE_TTL_SECONDS
    ):
        return cached
    request_start = pd.Timestamp(start).tz_localize(None).normalize() - pd.DateOffset(years=2)
    request_end = pd.Timestamp(end).tz_localize(None).normalize() + pd.Timedelta(days=2)
    try:
        remote = yf.Ticker(yahoo_quote_symbol(ticker), session=get_yfinance_session()).get_shares_full(
            start=request_start,
            end=request_end,
        )
        refreshed = normalize_reported_shares(remote)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Unable to refresh reported shares for %s: %s", ticker, exc)
        refreshed = normalize_reported_shares(None)

    available_frames = [frame for frame in (cached, refreshed) if not frame.empty]
    merged = normalize_reported_shares(
        pd.concat(available_frames, ignore_index=True) if available_frames else None
    )
    if not refreshed.empty:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with market_store_file_lock(cache_path):
            write_parquet_atomic(cache_path, merged)
    return merged


def build_market_cap_history(ticker: str, prices: pd.DataFrame) -> pd.DataFrame:
    """Multiply each price by the latest shares report known on that timestamp."""
    if prices.empty or "Date" not in prices.columns or "Close" not in prices.columns:
        raise ValueError(f"No price history is available for {ticker}.")
    price_frame = prices[["Date", "Close"]].copy()
    price_frame["Date"] = price_frame["Date"].map(to_naive_timestamp)
    price_frame["Close"] = pd.to_numeric(price_frame["Close"], errors="coerce")
    price_frame = price_frame.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    shares = fetch_reported_shares(ticker, price_frame["Date"].min(), price_frame["Date"].max())
    latest_price_date = price_frame["Date"].max()
    longbridge_snapshot = (
        fetch_longbridge_market_cap_snapshot(ticker)
        if _is_recent_market_cap_window(latest_price_date)
        else None
    )
    had_yfinance_shares = not shares.empty
    if not had_yfinance_shares and longbridge_snapshot is None:
        raise ValueError(f"No authoritative shares-outstanding history is available for {ticker}.")
    if not had_yfinance_shares:
        shares = pd.DataFrame(
            [{"Date": latest_price_date, "Shares": longbridge_snapshot["implied_shares"]}]
        )
    merged = pd.merge_asof(price_frame, shares, on="Date", direction="backward")
    merged["MarketCap"] = merged["Close"] * merged["Shares"]
    cross_check = None
    source = "yfinance_reported_shares"
    if longbridge_snapshot is not None:
        latest_index = merged.index[-1]
        yfinance_market_cap = _positive_number(merged.at[latest_index, "MarketCap"])
        normalized_longbridge_market_cap = (
            float(merged.at[latest_index, "Close"]) * longbridge_snapshot["implied_shares"]
        )
        if had_yfinance_shares and yfinance_market_cap is not None:
            delta_percent = ((yfinance_market_cap / normalized_longbridge_market_cap) - 1.0) * 100.0
            cross_check = {
                "status": _cross_check_status(delta_percent),
                "delta_percent": round(delta_percent, 4),
                "yfinance_market_cap": round(yfinance_market_cap, 2),
                "longbridge_market_cap": round(normalized_longbridge_market_cap, 2),
            }
        latest_day_mask = merged["Date"].dt.normalize() == pd.Timestamp(latest_price_date).normalize()
        merged.loc[latest_day_mask, "Shares"] = longbridge_snapshot["implied_shares"]
        merged.loc[latest_day_mask, "MarketCap"] = (
            merged.loc[latest_day_mask, "Close"] * longbridge_snapshot["implied_shares"]
        )
        source = "longbridge_current_with_yfinance_history" if had_yfinance_shares else "longbridge_current"
    if not pd.to_numeric(merged["MarketCap"], errors="coerce").notna().any():
        raise ValueError(f"No market-cap observations are available for {ticker} in the selected range.")
    result = merged[["Date", "MarketCap"]]
    result.attrs["market_cap_source"] = source
    result.attrs["market_cap_cross_check"] = cross_check
    return result


def build_market_cap_series_payload(
        ticker: str,
        prices: pd.DataFrame,
        color: str | None = None,
) -> SeriesPayload:
    history = build_market_cap_history(ticker, prices)
    has_intraday_timestamps = history["Date"].map(
        lambda value: pd.Timestamp(value).hour != 0 or pd.Timestamp(value).minute != 0
    ).any()
    market_caps = pd.to_numeric(history["MarketCap"], errors="coerce")
    return SeriesPayload(
        ticker=ticker.upper(),
        dates=history["Date"].map(
            lambda value: format_display_datetime(value) if has_intraday_timestamps else format_display_date(value)
        ).tolist(),
        raw_dates=history["Date"].map(lambda value: pd.Timestamp(value).strftime("%Y-%m-%d %H:%M")).tolist(),
        normalized_returns=[None for _ in range(len(history))],
        color=color,
        market_caps=[round(float(value), 2) if pd.notna(value) else None for value in market_caps],
        market_cap_source=history.attrs.get("market_cap_source"),
        market_cap_cross_check=history.attrs.get("market_cap_cross_check"),
    )
