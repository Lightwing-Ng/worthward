"""
Historical market-cap derivation from authoritative prices and reported shares.

Code version: v0.6.1
"""

from __future__ import annotations

import logging
import json
import math
from pathlib import Path
import time
from typing import Any
from xml.etree import ElementTree

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
from app.infrastructure.yahoo_chart import download_yahoo_chart_daily_history
from app.models.schemas import SeriesPayload
from app.services.presentation import format_display_date, format_display_datetime

LOGGER = logging.getLogger(__name__)
SHARES_STORE_DIR = MARKET_STORE_DIR / "fundamentals" / "shares"
SPLITS_STORE_DIR = MARKET_STORE_DIR / "fundamentals" / "splits"
SHARES_CACHE_TTL_SECONDS = 24 * 60 * 60
SPLITS_CACHE_TTL_SECONDS = 24 * 60 * 60
REPORTED_SHARES_SOURCE_ATTR = "reported_shares_source"
CACHED_REPORTED_SHARES_SOURCE = "cached_reported_shares"
REPORTED_SHARES_SOURCE_TOKENS = (
    "cached",
    "yfinance",
    "sec",
)
LONGBRIDGE_SNAPSHOT_CACHE_TTL_SECONDS = 5 * 60
LONGBRIDGE_CROSS_CHECK_MAX_AGE_DAYS = 7
LONGBRIDGE_MATCH_TOLERANCE_PERCENT = 2.0
LONGBRIDGE_REVIEW_TOLERANCE_PERCENT = 10.0
_LONGBRIDGE_SNAPSHOT_CACHE: dict[str, tuple[float, dict[str, Any] | None]] = {}
_SEC_TICKER_INDEX: dict[str, int] | None = None
SEC_USER_AGENT = "Antigravity local portfolio application contact@example.invalid"
COMMON_SHARE_SPLIT_FACTORS = (2.0, 3.0, 4.0, 5.0, 8.0, 10.0, 20.0, 25.0, 40.0, 50.0)
SHARE_SPLIT_FACTOR_CANDIDATES = tuple(sorted({
    *COMMON_SHARE_SPLIT_FACTORS,
    *(1.0 / factor for factor in COMMON_SHARE_SPLIT_FACTORS),
}))
SHARE_SPLIT_MATCH_TOLERANCE = math.log(1.03)


def to_naive_timestamp(value: object) -> pd.Timestamp:
    timestamp = pd.to_datetime(value, errors="coerce")
    if pd.isna(timestamp):
        return pd.NaT
    return timestamp.tz_localize(None) if timestamp.tzinfo is not None else timestamp


def shares_store_path_for(ticker: str) -> Path:
    return SHARES_STORE_DIR / f"{normalize_ticker(ticker)}.parquet"


def splits_store_path_for(ticker: str) -> Path:
    return SPLITS_STORE_DIR / f"{normalize_ticker(ticker)}.parquet"


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
    attrs = values.attrs.copy() if isinstance(values, pd.DataFrame) else {}
    if isinstance(values, pd.DataFrame):
        if "Date" not in values.columns or "Shares" not in values.columns:
            return pd.DataFrame(columns=["Date", "Shares"])
        frame = values[["Date", "Shares"]].copy()
    else:
        frame = values.rename("Shares").rename_axis("Date").reset_index()
    frame["Date"] = frame["Date"].map(to_naive_timestamp)
    frame["Date"] = frame["Date"].astype("datetime64[ns]")
    frame["Shares"] = pd.to_numeric(frame["Shares"], errors="coerce").astype("float64")
    normalized = (
        frame.dropna(subset=["Date", "Shares"])
        .loc[lambda item: item["Shares"] > 0]
        .drop_duplicates(subset=["Date"], keep="last")
        .sort_values("Date")
        .reset_index(drop=True)
    )
    normalized.attrs.update(attrs)
    return normalized


def _reported_shares_source_tokens(source: object) -> set[str]:
    """Return known provider tokens from a persisted shares-provenance label."""
    if source is None:
        return set()
    label = str(source or "").strip()
    if not label:
        return {"cached"}
    if label == CACHED_REPORTED_SHARES_SOURCE:
        return {"cached"}
    if label == "yfinance_reported_shares":
        return {"yfinance"}
    if label == "sec_reported_shares":
        return {"sec"}
    if label.startswith("merged_") and label.endswith("_reported_shares"):
        merged_tokens = label.removeprefix("merged_").removesuffix("_reported_shares").split("_and_")
        return set(merged_tokens).intersection(REPORTED_SHARES_SOURCE_TOKENS)
    return {"cached"}


def _reported_shares_source_for(*sources: object) -> str:
    """Describe the providers represented in a normalized shares-history cache."""
    tokens = set().union(*(_reported_shares_source_tokens(source) for source in sources))
    ordered_tokens = [token for token in REPORTED_SHARES_SOURCE_TOKENS if token in tokens]
    if not ordered_tokens:
        return CACHED_REPORTED_SHARES_SOURCE
    if len(ordered_tokens) == 1:
        return f"{ordered_tokens[0]}_reported_shares"
    return f"merged_{'_and_'.join(ordered_tokens)}_reported_shares"


def normalize_stock_split_events(values: pd.Series | pd.DataFrame | None) -> pd.DataFrame:
    """Normalize corporate actions into dated split factors."""
    if values is None:
        return pd.DataFrame(columns=["Date", "Factor"])
    if isinstance(values, pd.Series):
        events = pd.DataFrame({"Date": values.index, "Factor": values.to_numpy()})
    else:
        events = values.copy()
        if "Date" not in events.columns:
            events = events.reset_index()
            if "Date" not in events.columns and len(events.columns) > 0:
                events = events.rename(columns={events.columns[0]: "Date"})
        if "Factor" not in events.columns and "Stock Splits" in events.columns:
            events = events.rename(columns={"Stock Splits": "Factor"})
        if "Date" not in events.columns or "Factor" not in events.columns:
            return pd.DataFrame(columns=["Date", "Factor"])
        events = events[["Date", "Factor"]]
    events["Date"] = events["Date"].map(to_naive_timestamp).astype("datetime64[ns]")
    events["Factor"] = pd.to_numeric(events["Factor"], errors="coerce").astype("float64")
    return (
        events.dropna(subset=["Date", "Factor"])
        .loc[lambda item: (item["Factor"] > 0) & (item["Factor"] != 1.0)]
        .drop_duplicates(subset=["Date"], keep="last")
        .sort_values("Date")
        .reset_index(drop=True)
    )


def extract_stock_split_events(prices: pd.DataFrame) -> pd.DataFrame:
    """Return dated split factors preserved by the authoritative price source."""
    if prices.empty or "Stock Splits" not in prices.columns:
        return normalize_stock_split_events(None)
    return normalize_stock_split_events(prices)


def load_stock_split_events(ticker: str) -> pd.DataFrame:
    path = splits_store_path_for(ticker)
    if not path.exists() or path.stat().st_size == 0:
        return normalize_stock_split_events(None)
    try:
        return normalize_stock_split_events(pd.read_parquet(path))
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        return normalize_stock_split_events(None)


def _merge_stock_split_events(*frames: pd.DataFrame) -> pd.DataFrame:
    available = [frame for frame in frames if frame is not None and not frame.empty]
    if not available:
        return normalize_stock_split_events(None)
    return normalize_stock_split_events(pd.concat(available, ignore_index=True))


def resolve_stock_split_events(
        ticker: str,
        prices: pd.DataFrame,
        embedded_events: pd.DataFrame | None = None,
        embedded_events_are_authoritative: bool = False,
) -> pd.DataFrame:
    """Resolve split dates independently when a legacy price store lacks actions."""
    embedded = _merge_stock_split_events(
        extract_stock_split_events(prices),
        normalize_stock_split_events(embedded_events),
    )
    cached = load_stock_split_events(ticker)
    cache_path = splits_store_path_for(ticker)
    if not embedded.empty or embedded_events_are_authoritative:
        resolved = _merge_stock_split_events(cached, embedded)
        resolved.attrs["stock_split_source"] = "price_history"
        return resolved
    if (
            cache_path.exists()
            and time.time() - cache_path.stat().st_mtime <= SPLITS_CACHE_TTL_SECONDS
    ):
        cached.attrs["stock_split_source"] = "cached_corporate_actions"
        return cached

    remote = normalize_stock_split_events(None)
    remote_succeeded = False
    try:
        remote = normalize_stock_split_events(
            yf.Ticker(yahoo_quote_symbol(ticker), session=get_yfinance_session()).get_splits(
                period="max"
            )
        )
        remote_succeeded = True
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Unable to refresh yfinance split actions for %s: %s", ticker, exc)

    source = "yfinance_corporate_actions"
    if remote.empty:
        try:
            yahoo_history = download_yahoo_chart_daily_history(
                yahoo_quote_symbol(ticker),
                period="max",
            )
            remote = extract_stock_split_events(yahoo_history)
            remote_succeeded = True
            source = "yahoo_chart_corporate_actions"
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Unable to refresh Yahoo Chart split actions for %s: %s", ticker, exc)

    resolved = _merge_stock_split_events(cached, remote)
    if remote_succeeded:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with market_store_file_lock(cache_path):
            write_parquet_atomic(cache_path, resolved)
    resolved.attrs["stock_split_source"] = source if remote_succeeded else "unavailable"
    return resolved


def adjust_reported_shares_to_price_basis(
        values: pd.DataFrame,
        split_events: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Express historical reports on the latest split-adjusted price basis."""
    attrs = values.attrs.copy()
    adjusted = normalize_reported_shares(values)
    adjusted.attrs.update(attrs)
    events = split_events if split_events is not None else pd.DataFrame()
    if not events.empty and {"Date", "Factor"}.issubset(events.columns):
        events = events[["Date", "Factor"]].copy()
        events["Date"] = events["Date"].map(to_naive_timestamp).astype("datetime64[ns]")
        events["Factor"] = pd.to_numeric(events["Factor"], errors="coerce").astype("float64")
        events = events.dropna().loc[lambda item: item["Factor"] > 0].sort_values("Date")
        for index, report_date in adjusted["Date"].items():
            later_factors = events.loc[events["Date"] > report_date, "Factor"]
            if not later_factors.empty:
                adjusted.at[index, "Shares"] *= float(later_factors.prod())
                adjusted.attrs["split_basis_adjusted"] = True

    if len(adjusted) < 3:
        return adjusted

    observed_ratios = adjusted["Shares"] / adjusted["Shares"].shift(1)
    event_factors = pd.Series(1.0, index=adjusted.index, dtype="float64")
    for index, observed_ratio in observed_ratios.items():
        if pd.isna(observed_ratio) or float(observed_ratio) <= 0:
            continue
        candidate = min(
            SHARE_SPLIT_FACTOR_CANDIDATES,
            key=lambda factor: abs(math.log(float(observed_ratio) / factor)),
        )
        if abs(math.log(float(observed_ratio) / candidate)) <= SHARE_SPLIT_MATCH_TOLERANCE:
            event_factors.at[index] = candidate

    if (event_factors == 1.0).all():
        return adjusted

    suffix_products = event_factors.iloc[::-1].cumprod().iloc[::-1].tolist()
    basis_multipliers = pd.Series(
        [*suffix_products[1:], 1.0],
        index=adjusted.index,
        dtype="float64",
    )
    adjusted["Shares"] = adjusted["Shares"] * basis_multipliers
    adjusted.attrs["split_basis_adjusted"] = True
    return adjusted


def _sec_json(url: str) -> Any:
    response = get_yfinance_session().get(url, headers={"User-Agent": SEC_USER_AGENT}, timeout=12)
    response.raise_for_status()
    return json.loads(response.content)


def _sec_ticker_cik(ticker: str) -> int | None:
    global _SEC_TICKER_INDEX
    if _SEC_TICKER_INDEX is None:
        payload = _sec_json("https://www.sec.gov/files/company_tickers.json")
        _SEC_TICKER_INDEX = {
            str(item.get("ticker") or "").upper(): int(item["cik_str"])
            for item in payload.values()
            if isinstance(item, dict) and item.get("ticker") and item.get("cik_str")
        }
    return _SEC_TICKER_INDEX.get(normalize_ticker(ticker).removesuffix(".US"))


def fetch_sec_reported_shares(ticker: str) -> pd.DataFrame:
    """Return SEC-filed shares observations, dated when each filing became public."""
    cik = _sec_ticker_cik(ticker)
    if cik is None:
        return normalize_reported_shares(None)
    payload = _sec_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    observations = (
        payload.get("facts", {})
        .get("dei", {})
        .get("EntityCommonStockSharesOutstanding", {})
        .get("units", {})
        .get("shares", [])
    )
    return normalize_reported_shares(pd.DataFrame([
        {"Date": item.get("filed"), "Shares": item.get("val")}
        for item in observations
        if item.get("filed") and item.get("val")
    ]))


def fetch_sec_fund_net_assets(ticker: str) -> pd.DataFrame:
    """Return public Form N-PORT net assets for funds without company-facts shares."""
    cik = _sec_ticker_cik(ticker)
    if cik is None:
        return pd.DataFrame(columns=["Date", "MarketCap"])
    submissions = _sec_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    recent = submissions.get("filings", {}).get("recent", {})
    rows: list[dict[str, object]] = []
    for form, accession, document, filed in zip(
            recent.get("form", []), recent.get("accessionNumber", []),
            recent.get("primaryDocument", []), recent.get("filingDate", []), strict=False,
    ):
        if form != "NPORT-P":
            continue
        archive_accession = str(accession).replace("-", "")
        archive_document = str(document).rsplit("/", maxsplit=1)[-1]
        response = get_yfinance_session().get(
            f"https://www.sec.gov/Archives/edgar/data/{cik}/{archive_accession}/{archive_document}",
            headers={"User-Agent": SEC_USER_AGENT}, timeout=12,
        )
        response.raise_for_status()
        root = ElementTree.fromstring(response.content)
        net_assets = next(
            (element.text for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "netAssets"),
            None,
        )
        value = _positive_number(net_assets)
        if value is not None:
            rows.append({"Date": filed, "MarketCap": value})
    frame = pd.DataFrame(rows, columns=["Date", "MarketCap"])
    if frame.empty:
        return frame
    frame["Date"] = frame["Date"].map(to_naive_timestamp)
    frame["Date"] = frame["Date"].astype("datetime64[ns]")
    return frame.dropna().drop_duplicates("Date", keep="last").sort_values("Date").reset_index(drop=True)


def load_reported_shares(ticker: str) -> pd.DataFrame:
    path = shares_store_path_for(ticker)
    if not path.exists() or path.stat().st_size == 0:
        return normalize_reported_shares(None)
    try:
        cached = normalize_reported_shares(pd.read_parquet(path))
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        return normalize_reported_shares(None)
    cached.attrs[REPORTED_SHARES_SOURCE_ATTR] = _reported_shares_source_for(
        cached.attrs.get(REPORTED_SHARES_SOURCE_ATTR, CACHED_REPORTED_SHARES_SOURCE)
    )
    return cached


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
    refreshed_source = "yfinance_reported_shares"
    try:
        remote = yf.Ticker(yahoo_quote_symbol(ticker), session=get_yfinance_session()).get_shares_full(
            start=request_start,
            end=request_end,
        )
        refreshed = normalize_reported_shares(remote)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Unable to refresh reported shares for %s: %s", ticker, exc)
        refreshed = normalize_reported_shares(None)

    if refreshed.empty:
        try:
            refreshed = fetch_sec_reported_shares(ticker)
            refreshed_source = "sec_reported_shares"
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Unable to refresh SEC-reported shares for %s: %s", ticker, exc)

    available_frames = [frame for frame in (cached, refreshed) if not frame.empty]
    merged = normalize_reported_shares(
        pd.concat(available_frames, ignore_index=True) if available_frames else None
    )
    merged.attrs[REPORTED_SHARES_SOURCE_ATTR] = _reported_shares_source_for(
        cached.attrs.get(REPORTED_SHARES_SOURCE_ATTR, CACHED_REPORTED_SHARES_SOURCE)
        if not cached.empty else None,
        refreshed_source if not refreshed.empty else None,
    )
    if not refreshed.empty:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with market_store_file_lock(cache_path):
            write_parquet_atomic(cache_path, merged)
    return merged


def build_market_cap_history(
        ticker: str,
        prices: pd.DataFrame,
        split_events: pd.DataFrame | None = None,
        resolve_missing_split_events: bool = False,
        split_events_are_authoritative: bool = False,
) -> pd.DataFrame:
    """Multiply each price by the latest shares report known on that timestamp."""
    if prices.empty or "Date" not in prices.columns or "Close" not in prices.columns:
        raise ValueError(f"No price history is available for {ticker}.")
    price_frame = prices[["Date", "Close"]].copy()
    price_frame["Date"] = price_frame["Date"].map(to_naive_timestamp)
    price_frame["Date"] = price_frame["Date"].astype("datetime64[ns]")
    price_frame["Close"] = pd.to_numeric(price_frame["Close"], errors="coerce")
    price_frame = price_frame.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    if resolve_missing_split_events:
        split_events = resolve_stock_split_events(
            ticker,
            prices,
            split_events,
            embedded_events_are_authoritative=split_events_are_authoritative,
        )
    shares = fetch_reported_shares(ticker, price_frame["Date"].min(), price_frame["Date"].max())
    reported_shares_attrs = shares.attrs.copy()
    shares = adjust_reported_shares_to_price_basis(shares, split_events)
    shares.attrs.update(reported_shares_attrs)
    latest_price_date = price_frame["Date"].max()
    longbridge_snapshot = (
        fetch_longbridge_market_cap_snapshot(ticker)
        if _is_recent_market_cap_window(latest_price_date)
        else None
    )
    had_reported_shares = not shares.empty
    if not had_reported_shares:
        try:
            fund_history = fetch_sec_fund_net_assets(ticker)
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Unable to refresh SEC fund net assets for %s: %s", ticker, exc)
            fund_history = pd.DataFrame()
        if not fund_history.empty:
            fund_history = fund_history.copy()
            fund_history["Date"] = fund_history["Date"].map(to_naive_timestamp).astype("datetime64[ns]")
            result = pd.merge_asof(price_frame[["Date"]], fund_history, on="Date", direction="backward")
            if longbridge_snapshot is not None:
                latest_day_mask = result["Date"].dt.normalize() == latest_price_date.normalize()
                result.loc[latest_day_mask, "MarketCap"] = longbridge_snapshot["market_cap"]
            result.attrs["market_cap_source"] = (
                "longbridge_current_with_sec_nport_history"
                if longbridge_snapshot is not None else "sec_nport_net_assets"
            )
            result.attrs["market_cap_cross_check"] = None
            return result
    if not had_reported_shares and longbridge_snapshot is None:
        raise ValueError(f"No authoritative shares-outstanding history is available for {ticker}.")
    if not had_reported_shares:
        shares = pd.DataFrame(
            [{"Date": latest_price_date, "Shares": longbridge_snapshot["implied_shares"]}]
        )
    merged = pd.merge_asof(price_frame, shares, on="Date", direction="backward")
    merged["MarketCap"] = merged["Close"] * merged["Shares"]
    cross_check = None
    reported_shares_source = shares.attrs.get(
        REPORTED_SHARES_SOURCE_ATTR,
        CACHED_REPORTED_SHARES_SOURCE,
    )
    source = reported_shares_source
    if longbridge_snapshot is not None:
        latest_index = merged.index[-1]
        yfinance_market_cap = _positive_number(merged.at[latest_index, "MarketCap"])
        normalized_longbridge_market_cap = (
            float(merged.at[latest_index, "Close"]) * longbridge_snapshot["implied_shares"]
        )
        if had_reported_shares and yfinance_market_cap is not None:
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
        source = (
            f"longbridge_current_with_{reported_shares_source}_history"
            if had_reported_shares else "longbridge_current"
        )
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
        split_events: pd.DataFrame | None = None,
        resolve_missing_split_events: bool = False,
        split_events_are_authoritative: bool = False,
) -> SeriesPayload:
    history = build_market_cap_history(
        ticker,
        prices,
        split_events,
        resolve_missing_split_events=resolve_missing_split_events,
        split_events_are_authoritative=split_events_are_authoritative,
    )
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
