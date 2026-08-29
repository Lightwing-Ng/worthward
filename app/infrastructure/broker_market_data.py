"""
Broker-backed market data services.

Code version: v0.15.1
- Fixed: Canonical US share-class tickers such as BRK-B map back to the
  dot-delimited Longbridge symbol form at the provider boundary.
"""

from __future__ import annotations

import base64
from dataclasses import replace
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from importlib import import_module
from importlib.metadata import PackageNotFoundError, version as package_version
import json
from threading import Event, Lock, Thread
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.core.broker_settings import (
    BrokerSettings,
    has_longbridge_market_data_source,
    has_longbridge_credentials,
    load_broker_settings,
    normalize_longbridge_access_token,
    uses_longbridge_cli_oauth,
)
from app.core.debug_reporting import load_optional_debug_endpoint, post_debug_event
from app.core.market_calendar import latest_completed_nyse_trading_day
from app.infrastructure.longbridge_cli import run_longbridge_cli_json, test_longbridge_cli_connection
from app.infrastructure.storage import (
    ensure_market_store_dir,
    history_store_path_for,
    intraday_history_store_path_for,
    market_store_file_lock,
    normalize_ticker,
    write_parquet_atomic,
)


LOGGER = logging.getLogger(__name__)

ONE_MINUTE_LOOKBACK_MONTHS = 6
ONE_MINUTE_CHUNK_SIZE = 500
DAILY_CHUNK_SIZE = 500
ONE_MINUTE_MIN_SPAN_DAYS = 150
DAILY_MIN_SPAN_DAYS = 330
NEW_LISTING_MAX_AGE_MONTHS = 1
HONG_KONG_TIMEZONE = "Asia/Hong_Kong"
NEW_YORK_TIMEZONE = "America/New_York"
UTC_TIMEZONE = "UTC"
NEW_YORK_ZONE = ZoneInfo(NEW_YORK_TIMEZONE)
LONGBRIDGE_KEEPALIVE_INTERVAL_SECONDS = 240
LONGBRIDGE_KEEPALIVE_SYMBOL = "AAPL.US"
LONGBRIDGE_CONTEXT_LOCK = Lock()
_LONGBRIDGE_CONTEXT_SIGNATURE: tuple[str, str, str] | None = None
_LONGBRIDGE_QUOTE_CONTEXT: Any | None = None
_LONGBRIDGE_KEEPALIVE_SIGNATURE: tuple[str, str, str] | None = None
_LONGBRIDGE_KEEPALIVE_THREAD: Thread | None = None
_LONGBRIDGE_KEEPALIVE_STOP_EVENT: Event | None = None


class OneMinuteStoreReadError(ValueError):
    """Raised when an existing one-minute cache cannot be read safely."""


# #region debug-point shared:reporter
LONGBRIDGE_DEBUG_CONFIG = load_optional_debug_endpoint(
    "longbridge-token-invalid.env",
    "longbridge-token-invalid",
)


def _report_longbridge_debug_event(
        hypothesis_id: str,
        location: str,
        message: str,
        data: dict[str, Any],
        run_id: str = "pre-fix",
) -> None:
    post_debug_event(
        LONGBRIDGE_DEBUG_CONFIG,
        hypothesis_id=hypothesis_id,
        location=location,
        msg=message,
        data={
            **data,
            "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
        },
        run_id=run_id,
        timeout_seconds=1.5,
    )


def _safe_longbridge_token_snapshot(value: str) -> dict[str, Any]:
    stripped = str(value or "")
    normalized = normalize_longbridge_access_token(stripped)
    return {
        "raw_length": len(stripped),
        "normalized_length": len(normalized),
        "has_leading_or_trailing_whitespace": stripped != stripped.strip(),
        "had_bearer_prefix": stripped.strip().lower().startswith("bearer "),
        "wrapped_in_quotes": stripped.strip()[:1] in {"'", '"'} and stripped.strip()[-1:] == stripped.strip()[:1],
        "segment_count": normalized.count(".") + 1 if normalized else 0,
        "looks_like_jwt": normalized.count(".") == 2,
        "starts_with_m_": normalized.startswith("m_"),
        "starts_with_ey": normalized.startswith("ey"),
    }


def _decode_longbridge_token_metadata(value: str) -> dict[str, Any]:
    normalized = normalize_longbridge_access_token(value)
    token_body = normalized[2:] if normalized.startswith("m_") else normalized
    parts = token_body.split(".")
    if len(parts) != 3:
        return {"parseable": False, "reason": "non-jwt-shape"}

    def _decode_part(part: str) -> dict[str, Any] | None:
        padding = "=" * ((4 - len(part) % 4) % 4)
        try:
            return json.loads(base64.urlsafe_b64decode(f"{part}{padding}").decode("utf-8"))
        except Exception:
            return None

    header = _decode_part(parts[0]) or {}
    payload = _decode_part(parts[1]) or {}
    return {
        "parseable": bool(header or payload),
        "header_alg": header.get("alg"),
        "header_kid": header.get("kid"),
        "payload_exp": payload.get("exp"),
        "payload_iat": payload.get("iat"),
        "payload_token_type": payload.get("token_type"),
        "payload_iss": payload.get("iss"),
    }
# #endregion


def one_minute_lookback_start(reference: datetime | pd.Timestamp | None = None) -> pd.Timestamp:
    anchor = pd.Timestamp.now(tz="UTC") if reference is None else pd.Timestamp(reference)
    if anchor.tzinfo is None:
        anchor = anchor.tz_localize("UTC")
    else:
        anchor = anchor.tz_convert("UTC")
    return anchor - pd.DateOffset(months=ONE_MINUTE_LOOKBACK_MONTHS)


def test_broker_connection(settings: BrokerSettings) -> tuple[bool, str]:
    if settings.selected_broker == "longbridge":
        if uses_longbridge_cli_oauth(settings):
            return test_longbridge_cli_connection(settings)
        if not has_longbridge_credentials(settings):
            return False, "Longbridge credentials (App Key, App Secret, Access Token) are required."
        try:
            # #region debug-point A:input-shape
            _report_longbridge_debug_event(
                "A",
                "broker_market_data.py:test_broker_connection:entry",
                "Inspecting normalized Longbridge credential shapes before SDK call.",
                {
                    "selected_broker": settings.selected_broker,
                    "app_key_length": len(settings.longbridge_app_key),
                    "app_secret_length": len(settings.longbridge_app_secret),
                    "token_shape": _safe_longbridge_token_snapshot(settings.longbridge_access_token),
                    "token_meta": _decode_longbridge_token_metadata(settings.longbridge_access_token),
                },
            )
            # #endregion
            context = get_longbridge_quote_context(settings)
            # #region debug-point D:context-created
            _report_longbridge_debug_event(
                "D",
                "broker_market_data.py:test_broker_connection:context",
                "Longbridge quote context was created successfully.",
                {"context_type": type(context).__name__},
            )
            # #endregion
            # Try to fetch a single quote for a common symbol to test connection
            quote = context.quote(["AAPL.US"])
            if quote:
                return True, "Successfully connected to Longbridge."
            return False, "Connected but no data returned. Check your permissions."
        except Exception as e:
            message = str(e)
            LOGGER.exception("Longbridge connectivity test failed.")
            # #region debug-point D:sdk-error
            _report_longbridge_debug_event(
                "D",
                "broker_market_data.py:test_broker_connection:exception",
                "Longbridge SDK raised an exception during connectivity test.",
                {
                    "exception_type": type(e).__name__,
                    "message_length": len(message),
                    "is_timeout": "timeout" in message.lower(),
                },
            )
            # #endregion
            if "timeout" in message.lower():
                return False, "Connection timeout. Please check your network or try again."
            if "401004" in message or "token invalid" in message.lower():
                return (
                    False,
                    "Connection failed: Longbridge rejected the Access Token. "
                    "Paste only the raw token without the `Bearer ` prefix, "
                    "then regenerate the token in Longbridge Developers if it still fails.",
                )
            return False, "Connection failed. Check Longbridge settings and network connectivity."

    if settings.selected_broker == "ibkr":
        return False, (
            "IBKR direct connectivity is unavailable. Use Longbridge for quotes, or import "
            "official IBKR CSV or GainsKeeper files in Trade > Investment."
        )

    return False, f"Unsupported broker: {settings.selected_broker}"


def _load_longbridge_openapi() -> tuple[Any, Any, Any, Any]:
    for module_name in ("longbridge.openapi", "longport.openapi"):
        try:
            module = import_module(module_name)
            # #region debug-point C:sdk-module
            package_name = module_name.split(".", 1)[0]
            try:
                sdk_version = package_version(package_name)
            except PackageNotFoundError:
                sdk_version = "unknown"
            _report_longbridge_debug_event(
                "C",
                "broker_market_data.py:_load_longbridge_openapi",
                "Resolved Longbridge SDK module for broker connectivity test.",
                {"module_name": module_name, "package_name": package_name, "package_version": sdk_version},
            )
            # #endregion
            return module.Config, module.QuoteContext, module.Period, module.AdjustType
        except ImportError:
            continue
    raise RuntimeError(
        "Longbridge OpenAPI is not installed. Add the official Python package before fetching 1-minute history."
    )


def _load_longbridge_trade_session_enum() -> Any:
    for module_name in ("longbridge.openapi", "longport.openapi"):
        try:
            module = import_module(module_name)
        except ImportError:
            continue
        trade_session_enum = getattr(module, "TradeSession", None)
        if trade_session_enum is not None:
            return trade_session_enum
    raise RuntimeError(
        "The installed Longbridge OpenAPI package does not expose trade-session selection."
    )


def _resolve_longbridge_adjust_type(adjust_type_enum: Any) -> Any:
    """
    Prefer split-adjusted bars so reverse splits and ordinary splits do not
    distort return calculations when Longbridge becomes the active data source.
    """
    return getattr(adjust_type_enum, "ForwardAdjust", adjust_type_enum.NoAdjust)


def _resolve_longbridge_daily_adjust_type(adjust_type_enum: Any) -> Any:
    """
    Preserve raw daily closes for historical position valuation.

    The canonical history normalizer applies a split-only basis afterwards.
    Total-return forward adjustment would also move prices for dividends, while
    the cash ledger already records those distributions separately.
    """
    raw_adjustment = getattr(adjust_type_enum, "NoAdjust", None)
    if raw_adjustment is not None:
        return raw_adjustment
    return _resolve_longbridge_adjust_type(adjust_type_enum)


def _build_longbridge_config(config_cls: Any, settings: BrokerSettings) -> Any:
    app_key = settings.longbridge_app_key.strip()
    app_secret = settings.longbridge_app_secret.strip()
    access_token = normalize_longbridge_access_token(settings.longbridge_access_token)
    factory = getattr(config_cls, "from_apikey", None)
    if callable(factory):
        return factory(app_key, app_secret, access_token)
    return config_cls(app_key, app_secret, access_token)


def _longbridge_settings_signature(settings: BrokerSettings) -> tuple[str, str, str]:
    return (
        settings.longbridge_app_key.strip(),
        settings.longbridge_app_secret.strip(),
        normalize_longbridge_access_token(settings.longbridge_access_token),
    )


def _close_longbridge_context_if_possible(context: Any) -> None:
    close_handler = getattr(context, "close", None)
    if callable(close_handler):
        try:
            close_handler()
        except Exception:
            pass


def _run_longbridge_keepalive(
        signature: tuple[str, str, str],
        stop_event: Event,
) -> None:
    while not stop_event.wait(LONGBRIDGE_KEEPALIVE_INTERVAL_SECONDS):
        with LONGBRIDGE_CONTEXT_LOCK:
            if _LONGBRIDGE_CONTEXT_SIGNATURE != signature or _LONGBRIDGE_QUOTE_CONTEXT is None:
                return
            context = _LONGBRIDGE_QUOTE_CONTEXT
        try:
            # Keep the broker session warm without rebuilding the context.
            context.quote([LONGBRIDGE_KEEPALIVE_SYMBOL])
        except Exception:
            # Avoid churn on transient broker/network errors. The active context
            # remains owned by the serving process and will be reused on demand.
            continue


def _ensure_longbridge_keepalive_unlocked(signature: tuple[str, str, str]) -> None:
    global _LONGBRIDGE_KEEPALIVE_SIGNATURE, _LONGBRIDGE_KEEPALIVE_THREAD, _LONGBRIDGE_KEEPALIVE_STOP_EVENT
    if (
            _LONGBRIDGE_KEEPALIVE_THREAD is not None
            and _LONGBRIDGE_KEEPALIVE_THREAD.is_alive()
            and _LONGBRIDGE_KEEPALIVE_SIGNATURE == signature
    ):
        return

    if _LONGBRIDGE_KEEPALIVE_STOP_EVENT is not None:
        _LONGBRIDGE_KEEPALIVE_STOP_EVENT.set()

    stop_event = Event()
    keepalive_thread = Thread(
        target=_run_longbridge_keepalive,
        args=(signature, stop_event),
        name="longbridge-quote-keepalive",
        daemon=True,
    )
    _LONGBRIDGE_KEEPALIVE_SIGNATURE = signature
    _LONGBRIDGE_KEEPALIVE_STOP_EVENT = stop_event
    _LONGBRIDGE_KEEPALIVE_THREAD = keepalive_thread
    keepalive_thread.start()


def get_longbridge_quote_context(settings: BrokerSettings) -> Any:
    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    global _LONGBRIDGE_CONTEXT_SIGNATURE, _LONGBRIDGE_QUOTE_CONTEXT
    signature = _longbridge_settings_signature(settings)

    with LONGBRIDGE_CONTEXT_LOCK:
        if _LONGBRIDGE_QUOTE_CONTEXT is not None and _LONGBRIDGE_CONTEXT_SIGNATURE == signature:
            _ensure_longbridge_keepalive_unlocked(signature)
            return _LONGBRIDGE_QUOTE_CONTEXT

        config_cls, quote_context_cls, _, _ = _load_longbridge_openapi()
        config = _build_longbridge_config(config_cls, settings)
        context = quote_context_cls(config)

        previous = _LONGBRIDGE_QUOTE_CONTEXT
        _LONGBRIDGE_QUOTE_CONTEXT = context
        _LONGBRIDGE_CONTEXT_SIGNATURE = signature
        _ensure_longbridge_keepalive_unlocked(signature)
        if previous is not None and previous is not context:
            _close_longbridge_context_if_possible(previous)

        return context


def prewarm_longbridge_quote_context() -> tuple[bool, str]:
    settings = load_broker_settings()
    if settings.selected_broker != "longbridge":
        return False, "Skipped Longbridge prewarm because selected broker is not longbridge."
    if uses_longbridge_cli_oauth(settings):
        return False, "Skipped Longbridge prewarm because CLI OAuth does not use a long-lived SDK quote context."
    if not has_longbridge_credentials(settings):
        return False, "Skipped Longbridge prewarm because credentials are missing."
    context = get_longbridge_quote_context(settings)
    context.quote(["AAPL.US"])
    return True, "Longbridge quote context is warmed up and ready."


def normalize_longbridge_symbol(ticker: str) -> str:
    normalized_ticker = str(ticker or "").strip().upper()
    if not normalized_ticker:
        raise ValueError("Ticker is required.")
    if normalized_ticker in {"SKHY", "SKHYV", "SKHY.US", "SKHYV.US"}:
        return "SKHY.US"
    if normalized_ticker.endswith(".SS"):
        symbol, _ = normalized_ticker.rsplit(".", 1)
        return f"{symbol}.SH"
    dot_share_class_parts = normalized_ticker.rsplit(".", 1)
    if (
            len(dot_share_class_parts) == 2
            and dot_share_class_parts[0].isalnum()
            and 1 <= len(dot_share_class_parts[0]) <= 4
            and dot_share_class_parts[1] in {"A", "B", "C"}
    ):
        return f"{normalized_ticker}.US"
    share_class_parts = normalized_ticker.rsplit("-", 1)
    if (
            len(share_class_parts) == 2
            and share_class_parts[0].isalnum()
            and 1 <= len(share_class_parts[0]) <= 4
            and share_class_parts[1] in {"A", "B", "C"}
    ):
        return f"{share_class_parts[0]}.{share_class_parts[1]}.US"
    if "." in normalized_ticker:
        return normalized_ticker
    return f"{normalized_ticker}.US"


def _normalize_longbridge_market_cap_row(row: object, symbol: str) -> dict[str, Any] | None:
    if isinstance(row, dict):
        last_done = row.get("last_done")
        market_cap = row.get("mktcap") or row.get("total_market_value")
    else:
        last_done = getattr(row, "last_done", None)
        market_cap = getattr(row, "total_market_value", None)
    try:
        normalized_last_done = float(last_done)
        normalized_market_cap = float(market_cap)
    except (TypeError, ValueError):
        return None
    if normalized_last_done <= 0 or normalized_market_cap <= 0:
        return None
    return {
        "symbol": symbol,
        "last_done": normalized_last_done,
        "market_cap": normalized_market_cap,
        "implied_shares": normalized_market_cap / normalized_last_done,
    }


def _fetch_longbridge_cli_market_cap_snapshot(
    symbol: str,
    settings: BrokerSettings,
) -> dict[str, Any] | None:
    payload = run_longbridge_cli_json(
        settings,
        ["calc-index", symbol, "--fields", "last_done,mktcap", "--format", "json"],
        timeout_seconds=12,
    )
    row = next(
        (
            item for item in payload
            if isinstance(item, dict) and str(item.get("symbol") or "").upper() == symbol
        ),
        None,
    ) if isinstance(payload, list) else None
    return _normalize_longbridge_market_cap_row(row, symbol)


def fetch_longbridge_market_cap_snapshot(ticker: str, settings: BrokerSettings) -> dict[str, Any] | None:
    """Fetch Longbridge's current market cap through the configured authentication mode."""
    symbol = normalize_longbridge_symbol(ticker)
    if uses_longbridge_cli_oauth(settings):
        return _fetch_longbridge_cli_market_cap_snapshot(symbol, settings)

    global_cli_settings = replace(
        settings,
        selected_broker="longbridge",
        longbridge_auth_mode="cli_oauth",
        longbridge_cli_home=os.path.expanduser("~"),
    )
    try:
        cli_snapshot = _fetch_longbridge_cli_market_cap_snapshot(symbol, global_cli_settings)
        if cli_snapshot is not None:
            return cli_snapshot
    except Exception:  # noqa: BLE001
        pass

    if not has_longbridge_credentials(settings):
        return None
    quote_context = get_longbridge_quote_context(settings)
    calc_index_enum = None
    for module_name in ("longbridge.openapi", "longport.openapi"):
        try:
            calc_index_enum = getattr(import_module(module_name), "CalcIndex", None)
        except ImportError:
            continue
        if calc_index_enum is not None:
            break
    if calc_index_enum is None:
        raise RuntimeError("Longbridge OpenAPI does not expose calculated market-cap indexes.")
    rows = quote_context.calc_indexes(
        [symbol],
        [calc_index_enum.LastDone, calc_index_enum.TotalMarketValue],
    )
    return _normalize_longbridge_market_cap_row(rows[0] if rows else None, symbol)


def _normalize_longbridge_static_row(row: object, symbol: str) -> dict[str, Any] | None:
    """Normalize Longbridge static share metadata for the optional chip-survival model."""
    if isinstance(row, dict):
        circulating_shares = row.get("circ._shares")
        if circulating_shares is None:
            circulating_shares = row.get("circulating_shares", row.get("circulatingShares"))
        total_shares = row.get("total_shares", row.get("totalShares"))
    else:
        circulating_shares = getattr(row, "circ._shares", None)
        if circulating_shares is None:
            circulating_shares = getattr(row, "circulating_shares", getattr(row, "circulatingShares", None))
        total_shares = getattr(row, "total_shares", getattr(row, "totalShares", None))
    normalized_circulating_shares = _finite_trade_stats_number(circulating_shares, minimum=0)
    if normalized_circulating_shares is None or normalized_circulating_shares <= 0:
        return None
    normalized_total_shares = _finite_trade_stats_number(total_shares, minimum=0)
    return {
        "symbol": symbol,
        "circulating_shares": normalized_circulating_shares,
        "total_shares": normalized_total_shares,
    }


def _fetch_longbridge_cli_circulating_shares(
        symbols: list[str],
        settings: BrokerSettings,
) -> dict[str, dict[str, Any]]:
    payload = run_longbridge_cli_json(
        settings,
        ["static", *symbols, "--format", "json"],
        timeout_seconds=20,
    )
    rows = payload if isinstance(payload, list) else []
    normalized: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        if symbol not in symbols:
            continue
        item = _normalize_longbridge_static_row(row, symbol)
        if item is not None:
            normalized[symbol] = item
    return normalized


def fetch_longbridge_circulating_shares(
        tickers: list[str],
        settings: BrokerSettings,
) -> dict[str, float]:
    """Fetch current circulating shares without making chip loading depend on the metadata call."""
    if not has_longbridge_market_data_source(settings):
        raise ValueError(
            "Configure Longbridge CLI OAuth or save your Longbridge App Key, App Secret, and Access Token first."
        )
    ticker_symbols = {
        normalize_ticker(ticker): normalize_longbridge_symbol(ticker)
        for ticker in tickers
        if str(ticker or "").strip()
    }
    if not ticker_symbols:
        return {}
    cli_settings = settings
    if not uses_longbridge_cli_oauth(settings):
        cli_settings = replace(
            settings,
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
            longbridge_cli_home=os.path.expanduser("~"),
        )
    static_rows = _fetch_longbridge_cli_circulating_shares(
        list(dict.fromkeys(ticker_symbols.values())),
        cli_settings,
    )
    return {
        ticker: static_rows[symbol]["circulating_shares"]
        for ticker, symbol in ticker_symbols.items()
        if symbol in static_rows
    }


def _finite_trade_stats_number(value: object, *, minimum: float | None = None) -> float | None:
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(normalized):
        return None
    if minimum is not None and normalized < minimum:
        return None
    return normalized


def _normalize_longbridge_trade_stats_payload(
        payload: object,
        symbol: str,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    statistics = payload.get("statistics")
    trades = payload.get("trades")
    if not isinstance(statistics, dict) or not isinstance(trades, list):
        return None

    normalized_trades: list[dict[str, float]] = []
    for row in trades:
        if not isinstance(row, dict):
            continue
        price = _finite_trade_stats_number(row.get("price"), minimum=0)
        buy = _finite_trade_stats_number(row.get("buy_amount"), minimum=0)
        neutral = _finite_trade_stats_number(row.get("neutral_amount"), minimum=0)
        sell = _finite_trade_stats_number(row.get("sell_amount"), minimum=0)
        if None in {price, buy, neutral, sell}:
            continue
        normalized_trades.append({
            "price": price,
            "buy": buy,
            "neutral": neutral,
            "sell": sell,
        })
    if not normalized_trades:
        return None

    def statistic(name: str, *, minimum: float | None = None) -> float | None:
        return _finite_trade_stats_number(statistics.get(name), minimum=minimum)

    return {
        "symbol": symbol,
        "statistics": {
            "average_price": statistic("avgprice", minimum=0),
            "preclose": statistic("preclose", minimum=0),
            "buy": statistic("buy", minimum=0),
            "neutral": statistic("neutral", minimum=0),
            "sell": statistic("sell", minimum=0),
            "total_volume": statistic("total_amount", minimum=0),
            "trades_count": statistic("trades_count", minimum=0),
            "trade_dates": [
                str(value).strip()
                for value in statistics.get("trade_date", [])
                if str(value).strip()
            ],
        },
        "trades": normalized_trades,
    }


def _fetch_longbridge_cli_trade_stats(
        symbol: str,
        settings: BrokerSettings,
) -> dict[str, Any] | None:
    payload = run_longbridge_cli_json(
        settings,
        ["trade-stats", symbol, "--format", "json"],
        timeout_seconds=20,
    )
    return _normalize_longbridge_trade_stats_payload(payload, symbol)


def fetch_longbridge_trade_stats(ticker: str, settings: BrokerSettings) -> dict[str, Any]:
    """Fetch and normalize Longbridge price-volume distribution data."""
    if not has_longbridge_market_data_source(settings):
        raise ValueError(
            "Configure Longbridge CLI OAuth or save your Longbridge App Key, App Secret, and Access Token first."
        )

    symbol = normalize_longbridge_symbol(ticker)
    cli_settings = settings
    if not uses_longbridge_cli_oauth(settings):
        cli_settings = replace(
            settings,
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
            longbridge_cli_home=os.path.expanduser("~"),
        )
    normalized = _fetch_longbridge_cli_trade_stats(symbol, cli_settings)
    if normalized is None:
        raise ValueError(f"No trade statistics returned for {ticker} via Longbridge.")
    return normalized


def _resolve_daily_period(period_enum: Any) -> Any:
    for candidate in ("Day", "D1", "Day_1"):
        value = getattr(period_enum, candidate, None)
        if value is not None:
            return value
    raise RuntimeError("Longbridge OpenAPI does not expose a daily candlestick period enum.")


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
    elif isinstance(raw_timestamp, (int, float)):
        return pd.Timestamp(raw_timestamp, unit="s", tz=UTC_TIMEZONE)
    else:
        timestamp = pd.Timestamp(raw_timestamp)

    if timestamp.tzinfo is None:
        return timestamp.tz_localize(HONG_KONG_TIMEZONE)
    return timestamp


def _is_regular_new_york_session(timestamp: pd.Timestamp) -> bool:
    localized = timestamp.tz_convert(NEW_YORK_TIMEZONE)
    if localized.weekday() >= 5:
        return False
    session_open = localized.replace(hour=9, minute=30, second=0, microsecond=0)
    session_close = localized.replace(hour=16, minute=0, second=0, microsecond=0)
    return session_open <= localized < session_close


def _infer_market_from_ticker(ticker: str | None) -> str:
    normalized = normalize_ticker(str(ticker or ""))
    if normalized.endswith(".HK"):
        return "HK"
    if normalized.endswith((".KS", ".KQ")):
        return "KR"
    if normalized.endswith((".T", ".JP")):
        return "JP"
    if normalized.endswith((".SH", ".SS", ".SZ")):
        return "CN"
    if normalized.endswith((".SG", ".SI")):
        return "SG"
    if normalized.endswith(".L"):
        return "UK"
    if normalized.endswith(".AX"):
        return "AU"
    if normalized.endswith((".TO", ".V", ".NE", ".CN", ".CA")):
        return "CA"
    if normalized.endswith((".PA", ".AS", ".BR", ".MI", ".MC", ".DE", ".F", ".HM", ".BE", ".DU", ".MU", ".HA", ".SW", ".VI", ".ST", ".CO", ".OL", ".IR", ".IS")):
        return "EU"
    if normalized.endswith(".HE"):
        return "FI"
    if normalized.endswith((".NS", ".BO")):
        return "IN"
    if normalized.endswith((".TW", ".TWO")):
        return "TW"
    if normalized.endswith(".KL"):
        return "MY"
    if normalized.endswith(".BK"):
        return "TH"
    if normalized.endswith(".JK"):
        return "ID"
    if normalized.endswith(".NZ"):
        return "NZ"
    if normalized.endswith(".SA"):
        return "BR"
    if normalized.endswith((".BA", ".MX")):
        return "LATAM"
    if normalized.endswith(".TA"):
        return "IL"
    if normalized.endswith((".SR", ".SE")):
        return "SA"
    if normalized.endswith(".JO"):
        return "ZA"
    if normalized.endswith(".QA"):
        return "QA"
    return "US"


def _is_regular_market_session(timestamp: pd.Timestamp, ticker: str | None = None) -> bool:
    market = _infer_market_from_ticker(ticker)
    if market == "HK":
        localized = timestamp.tz_convert(HONG_KONG_TIMEZONE)
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return ((9 * 60) + 30 <= total_minutes < 12 * 60) or (13 * 60 <= total_minutes < 16 * 60)
    if market == "KR":
        localized = timestamp.tz_convert("Asia/Seoul")
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return 9 * 60 <= total_minutes <= (15 * 60) + 30
    if market == "JP":
        localized = timestamp.tz_convert("Asia/Tokyo")
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return (9 * 60 <= total_minutes < (11 * 60) + 30) or ((12 * 60) + 30 <= total_minutes <= (15 * 60) + 30)
    if market == "CN":
        localized = timestamp.tz_convert("Asia/Shanghai")
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return ((9 * 60) + 30 <= total_minutes < (11 * 60) + 30) or (13 * 60 <= total_minutes < 15 * 60)
    if market == "UK":
        localized = timestamp.tz_convert("Europe/London")
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return 8 * 60 <= total_minutes < (16 * 60) + 30
    if market == "SG":
        localized = timestamp.tz_convert("Asia/Singapore")
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        return (9 * 60 <= total_minutes < 12 * 60) or (13 * 60 <= total_minutes < 17 * 60)
    market_timezones = {
        "AU": "Australia/Sydney",
        "CA": "America/Toronto",
        "EU": "Europe/Paris",
        "FI": "Europe/Helsinki",
        "IN": "Asia/Kolkata",
        "TW": "Asia/Taipei",
        "MY": "Asia/Kuala_Lumpur",
        "TH": "Asia/Bangkok",
        "ID": "Asia/Jakarta",
        "NZ": "Pacific/Auckland",
        "BR": "America/Sao_Paulo",
        "LATAM": "America/Mexico_City",
        "IL": "Asia/Jerusalem",
        "SA": "Asia/Riyadh",
        "ZA": "Africa/Johannesburg",
        "QA": "Asia/Qatar",
    }
    market_sessions = {
        "AU": (10 * 60, 16 * 60),
        "CA": ((9 * 60) + 30, 16 * 60),
        "EU": (9 * 60, (17 * 60) + 30),
        "FI": (9 * 60, (17 * 60) + 30),
        "IN": ((9 * 60) + 15, (15 * 60) + 30),
        "TW": (9 * 60, (13 * 60) + 30),
        "MY": (9 * 60, 17 * 60),
        "TH": (10 * 60, (16 * 60) + 30),
        "ID": (9 * 60, 16 * 60),
        "NZ": (10 * 60, (16 * 60) + 45),
        "BR": (10 * 60, 17 * 60),
        "LATAM": ((8 * 60) + 30, 15 * 60),
        "IL": ((9 * 60) + 30, (17 * 60) + 30),
        "SA": (10 * 60, 15 * 60),
        "ZA": (9 * 60, 17 * 60),
        "QA": ((9 * 60) + 30, (13 * 60) + 10),
    }
    if market in market_timezones and market in market_sessions:
        localized = timestamp.tz_convert(market_timezones[market])
        if localized.weekday() >= 5:
            return False
        total_minutes = (int(localized.hour) * 60) + int(localized.minute)
        start_minute, end_minute = market_sessions[market]
        return start_minute <= total_minutes < end_minute
    return _is_regular_new_york_session(timestamp)


def _count_regular_session_rows(values: pd.Series, ticker: str | None = None) -> int:
    return int(_regular_market_session_mask(values, ticker).sum())


def _regular_market_session_mask(values: pd.Series, ticker: str | None = None) -> pd.Series:
    timestamps = pd.to_datetime(values, errors="coerce")
    if getattr(timestamps.dt, "tz", None) is None:
        timestamps = timestamps.dt.tz_localize(
            NEW_YORK_TIMEZONE,
            ambiguous="NaT",
            nonexistent="NaT",
        )
    else:
        timestamps = timestamps.dt.tz_convert(NEW_YORK_TIMEZONE)

    market = _infer_market_from_ticker(ticker)
    market_timezones = {
        "US": NEW_YORK_TIMEZONE,
        "HK": HONG_KONG_TIMEZONE,
        "KR": "Asia/Seoul",
        "JP": "Asia/Tokyo",
        "CN": "Asia/Shanghai",
        "UK": "Europe/London",
        "SG": "Asia/Singapore",
        "AU": "Australia/Sydney",
        "CA": "America/Toronto",
        "EU": "Europe/Paris",
        "FI": "Europe/Helsinki",
        "IN": "Asia/Kolkata",
        "TW": "Asia/Taipei",
        "MY": "Asia/Kuala_Lumpur",
        "TH": "Asia/Bangkok",
        "ID": "Asia/Jakarta",
        "NZ": "Pacific/Auckland",
        "BR": "America/Sao_Paulo",
        "LATAM": "America/Mexico_City",
        "IL": "Asia/Jerusalem",
        "SA": "Asia/Riyadh",
        "ZA": "Africa/Johannesburg",
        "QA": "Asia/Qatar",
    }
    localized = timestamps.dt.tz_convert(market_timezones.get(market, NEW_YORK_TIMEZONE))
    total_minutes = (localized.dt.hour * 60) + localized.dt.minute
    weekday_mask = localized.notna() & (localized.dt.dayofweek < 5)

    if market == "HK":
        session_mask = total_minutes.between((9 * 60) + 30, (12 * 60) - 1) | total_minutes.between(13 * 60, (16 * 60) - 1)
    elif market == "KR":
        session_mask = total_minutes.between(9 * 60, (15 * 60) + 30)
    elif market == "JP":
        session_mask = total_minutes.between(9 * 60, (11 * 60) + 29) | total_minutes.between((12 * 60) + 30, (15 * 60) + 30)
    elif market == "CN":
        session_mask = total_minutes.between((9 * 60) + 30, (11 * 60) + 29) | total_minutes.between(13 * 60, (15 * 60) - 1)
    elif market == "SG":
        session_mask = total_minutes.between(9 * 60, (12 * 60) - 1) | total_minutes.between(13 * 60, (17 * 60) - 1)
    else:
        market_sessions = {
            "US": ((9 * 60) + 30, 16 * 60),
            "UK": (8 * 60, (16 * 60) + 30),
            "AU": (10 * 60, 16 * 60),
            "CA": ((9 * 60) + 30, 16 * 60),
            "EU": (9 * 60, (17 * 60) + 30),
            "FI": (9 * 60, (17 * 60) + 30),
            "IN": ((9 * 60) + 15, (15 * 60) + 30),
            "TW": (9 * 60, (13 * 60) + 30),
            "MY": (9 * 60, 17 * 60),
            "TH": (10 * 60, (16 * 60) + 30),
            "ID": (9 * 60, 16 * 60),
            "NZ": (10 * 60, (16 * 60) + 45),
            "BR": (10 * 60, 17 * 60),
            "LATAM": ((8 * 60) + 30, 15 * 60),
            "IL": ((9 * 60) + 30, (17 * 60) + 30),
            "SA": (10 * 60, 15 * 60),
            "ZA": (9 * 60, 17 * 60),
            "QA": ((9 * 60) + 30, (13 * 60) + 10),
        }
        session_open, session_close = market_sessions.get(market, market_sessions["US"])
        session_mask = (total_minutes >= session_open) & (total_minutes < session_close)
    return (weekday_mask & session_mask).fillna(False)


def _series_to_new_york_naive(values: pd.Series) -> pd.Series:
    timestamps = pd.to_datetime(values, errors="coerce")
    if getattr(timestamps.dt, "tz", None) is not None:
        return timestamps.dt.tz_convert(NEW_YORK_TIMEZONE).dt.tz_localize(None)
    return timestamps


def _series_hkt_wall_time_to_new_york_naive(values: pd.Series) -> pd.Series:
    timestamps = pd.to_datetime(values, errors="coerce")
    if getattr(timestamps.dt, "tz", None) is not None:
        timestamps = timestamps.dt.tz_convert(HONG_KONG_TIMEZONE).dt.tz_localize(None)
    return timestamps.dt.tz_localize(HONG_KONG_TIMEZONE).dt.tz_convert(NEW_YORK_TIMEZONE).dt.tz_localize(None)


def normalize_one_minute_store_frame(dataset: pd.DataFrame, ticker: str | None = None) -> pd.DataFrame:
    if dataset.empty or "Date" not in dataset.columns:
        return dataset

    normalized = dataset.copy()
    raw_dates = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized = normalized.loc[raw_dates.notna()].copy()
    if normalized.empty:
        return normalized.reset_index(drop=True)

    current_dates = raw_dates.loc[raw_dates.notna()]
    current_score = _count_regular_session_rows(current_dates, ticker)

    hkt_converted = _series_hkt_wall_time_to_new_york_naive(current_dates)
    candidate_score = _count_regular_session_rows(hkt_converted, ticker)

    if candidate_score > current_score:
        normalized["Date"] = hkt_converted.to_numpy()
    else:
        normalized["Date"] = _series_to_new_york_naive(current_dates).to_numpy()

    session_mask = _regular_market_session_mask(normalized["Date"], ticker)
    normalized = normalized.loc[session_mask].copy()
    if normalized.empty:
        return normalized.reset_index(drop=True)

    if "Dividends" in normalized.columns:
        normalized["Dividends"] = pd.to_numeric(
            normalized["Dividends"], errors="coerce"
        ).fillna(0.0)

    normalized = normalized.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
    return normalized.reset_index(drop=True)


def _candlestick_rows_to_frame(candlesticks: list[Any], ticker: str | None = None) -> pd.DataFrame:
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

        # Longbridge US 1m bars arrive in HKT wall time. We localize naive values
        # to Hong Kong first, then convert to New York and keep only regular hours.
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        if not _is_regular_market_session(ts_nyt, ticker):
            continue

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


def _daily_candlestick_rows_to_frame(candlesticks: list[Any]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = getattr(candle, "timestamp")
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        rows.append(
            {
                "Date": pd.Timestamp(ts_nyt.date()),
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


def _cli_candlestick_rows_to_frame(candlesticks: list[dict[str, Any]], ticker: str | None = None) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = candle.get("time")
        if raw_ts is None:
            continue
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        if not _is_regular_market_session(ts_nyt, ticker):
            continue
        rows.append(
            {
                "Date": ts_nyt.tz_localize(None),
                "Open": float(candle.get("open", 0)),
                "High": float(candle.get("high", 0)),
                "Low": float(candle.get("low", 0)),
                "Close": float(candle.get("close", 0)),
                "Volume": float(candle.get("volume", 0)),
                "Turnover": float(candle.get("turnover", 0)),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume", "Turnover"])
    return pd.DataFrame(rows)


def _normalize_longbridge_trade_session(value: object) -> str:
    normalized = str(value or "").strip().rsplit(".", 1)[-1].lower()
    if normalized == "normal":
        return "intraday"
    return normalized


def _extended_candlestick_rows_to_frame(candlesticks: list[Any]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = getattr(candle, "timestamp", None)
        if raw_ts is None:
            continue
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        session = _normalize_longbridge_trade_session(
            getattr(candle, "trade_session", getattr(candle, "session", ""))
        )
        rows.append(
            {
                "Date": ts_nyt.tz_localize(None),
                "Open": float(getattr(candle, "open")),
                "High": float(getattr(candle, "high")),
                "Low": float(getattr(candle, "low")),
                "Close": float(getattr(candle, "close")),
                "Volume": float(getattr(candle, "volume")),
                "Turnover": float(getattr(candle, "turnover")),
                "Session": session,
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=["Date", "Open", "High", "Low", "Close", "Volume", "Turnover", "Session"]
        )
    return pd.DataFrame(rows)


def _cli_extended_candlestick_rows_to_frame(candlesticks: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = candle.get("time")
        if raw_ts is None:
            continue
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        rows.append(
            {
                "Date": ts_nyt.tz_localize(None),
                "Open": float(candle.get("open", 0)),
                "High": float(candle.get("high", 0)),
                "Low": float(candle.get("low", 0)),
                "Close": float(candle.get("close", 0)),
                "Volume": float(candle.get("volume", 0)),
                "Turnover": float(candle.get("turnover", 0)),
                "Session": _normalize_longbridge_trade_session(candle.get("session")),
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=["Date", "Open", "High", "Low", "Close", "Volume", "Turnover", "Session"]
        )
    return pd.DataFrame(rows)


def _cli_daily_candlestick_rows_to_frame(candlesticks: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for candle in candlesticks:
        raw_ts = candle.get("time")
        if raw_ts is None:
            continue
        ts_nyt = _parse_longbridge_timestamp(raw_ts).tz_convert(NEW_YORK_TIMEZONE)
        rows.append(
            {
                "Date": pd.Timestamp(ts_nyt.date()),
                "Open": float(candle.get("open", 0)),
                "High": float(candle.get("high", 0)),
                "Low": float(candle.get("low", 0)),
                "Close": float(candle.get("close", 0)),
                "Volume": float(candle.get("volume", 0)),
                "Turnover": float(candle.get("turnover", 0)),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume", "Turnover"])
    return pd.DataFrame(rows)


def fetch_longbridge_compare_one_day_history(
        ticker: str,
        settings: BrokerSettings,
        *,
        trading_date: object | None = None,
) -> pd.DataFrame:
    """Fetch a full US session, including overnight, without persisting it."""
    if not has_longbridge_market_data_source(settings):
        raise ValueError(
            "Configure Longbridge CLI OAuth or save your Longbridge App Key, App Secret, and Access Token first."
        )

    symbol = normalize_longbridge_symbol(ticker)
    if not symbol.endswith(".US"):
        raise ValueError("Longbridge overnight candlesticks are currently available for US securities only.")

    parsed_trading_date = pd.to_datetime(trading_date, errors="coerce") if trading_date is not None else None
    if trading_date is not None and pd.isna(parsed_trading_date):
        raise ValueError(f"Invalid Longbridge comparison trading date: {trading_date}.")

    if uses_longbridge_cli_oauth(settings):
        if parsed_trading_date is not None:
            target_date = parsed_trading_date.date()
            start_date = target_date - timedelta(days=1)
            arguments = [
                "kline",
                "history",
                symbol,
                "--period",
                "5m",
                "--start",
                start_date.isoformat(),
                "--end",
                target_date.isoformat(),
                "--session",
                "all",
                "--format",
                "json",
            ]
        else:
            arguments = [
                "kline",
                symbol,
                "--period",
                "1m",
                "--count",
                "1000",
                "--session",
                "all",
                "--format",
                "json",
            ]
        payload = run_longbridge_cli_json(
            settings,
            arguments,
            timeout_seconds=45,
            enable_overnight=True,
        )
        frame = _cli_extended_candlestick_rows_to_frame(payload if isinstance(payload, list) else [])
    else:
        _, _, period_enum, adjust_type_enum = _load_longbridge_openapi()
        trade_session_enum = _load_longbridge_trade_session_enum()
        trade_sessions = [
            session
            for name in ("Intraday", "Normal", "Pre", "Post", "Overnight")
            if (session := getattr(trade_session_enum, name, None)) is not None
        ]
        if not trade_sessions or getattr(trade_session_enum, "Overnight", None) is None:
            raise RuntimeError(
                "Upgrade the Longbridge OpenAPI package to a version that supports overnight candlesticks."
            )
        quote_context = get_longbridge_quote_context(settings)
        try:
            candlesticks = quote_context.candlesticks(
                symbol,
                period_enum.Min_1,
                1000,
                adjust_type_enum.NoAdjust,
                trade_sessions,
            )
        except TypeError as exc:
            raise RuntimeError(
                "Upgrade the Longbridge OpenAPI package to a version that accepts trade-session selection."
            ) from exc
        frame = _extended_candlestick_rows_to_frame(list(candlesticks or []))

    if frame.empty:
        raise ValueError(f"No full-session 1-minute market data returned for {ticker} via Longbridge.")
    return (
        frame.drop_duplicates(subset=["Date"], keep="last")
        .sort_values("Date")
        .reset_index(drop=True)
    )


def fetch_longbridge_one_minute_history(
        ticker: str,
        settings: BrokerSettings,
        since: datetime | None = None
) -> pd.DataFrame:
    if not has_longbridge_market_data_source(settings):
        raise ValueError(
            "Configure Longbridge CLI OAuth or save your Longbridge App Key, App Secret, and Access Token first."
        )

    symbol = normalize_longbridge_symbol(ticker)
    end_at = datetime.now(timezone.utc)
    global_start_at = one_minute_lookback_start(end_at)
    global_start_nyt = _normalize_to_new_york_naive(global_start_at)
    effective_start_nyt = global_start_nyt
    if since is not None:
        effective_start_nyt = max(global_start_nyt, _normalize_to_new_york_naive(since) - timedelta(hours=2))

    if uses_longbridge_cli_oauth(settings):
        payload = run_longbridge_cli_json(
            settings,
            [
                "kline",
                "history",
                symbol,
                "--period",
                "1m",
                "--adjust",
                "forward",
                "--start",
                effective_start_nyt.date().isoformat(),
                "--end",
                _coerce_to_new_york(end_at).date().isoformat(),
                "--format",
                "json",
            ],
            timeout_seconds=90,
        )
        frame = _cli_candlestick_rows_to_frame(payload if isinstance(payload, list) else [], ticker)
        if frame.empty:
            raise ValueError(f"No 1-minute market data returned for {ticker}.")
        dataset = frame.drop_duplicates(subset=["Date"], keep="first").sort_values("Date")
        dataset = dataset.loc[dataset["Date"] >= global_start_nyt].copy()
        if dataset.empty:
            raise ValueError(f"No 1-minute market data returned for {ticker}.")
        return dataset.reset_index(drop=True)

    _, _, period_enum, adjust_type_enum = _load_longbridge_openapi()
    adjust_type = _resolve_longbridge_adjust_type(adjust_type_enum)
    quote_context = get_longbridge_quote_context(settings)

    frames: list[pd.DataFrame] = []
    cursor: datetime | None = None
    previous_oldest: datetime | None = None

    import time
    for _ in range(500):
        try:
            if cursor is None:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    period_enum.Min_1,
                    adjust_type,
                    False,
                    ONE_MINUTE_CHUNK_SIZE,
                )
            else:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    period_enum.Min_1,
                    adjust_type,
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

        frame = _candlestick_rows_to_frame(list(batch), ticker)
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


def fetch_longbridge_daily_history(
        ticker: str,
        settings: BrokerSettings,
        since: datetime | None = None,
) -> pd.DataFrame:
    if not has_longbridge_market_data_source(settings):
        raise ValueError(
            "Configure Longbridge CLI OAuth or save your Longbridge App Key, App Secret, and Access Token first."
        )

    symbol = normalize_longbridge_symbol(ticker)
    effective_start_nyt: pd.Timestamp | None = None
    if since is not None:
        effective_start_nyt = _normalize_to_new_york_naive(since) - timedelta(days=2)

    if uses_longbridge_cli_oauth(settings):
        now_nyt = pd.Timestamp.now(tz=UTC_TIMEZONE).tz_convert(NEW_YORK_TIMEZONE)
        start_date = (
            effective_start_nyt.date().isoformat()
            if effective_start_nyt is not None
            else (now_nyt - timedelta(days=400)).date().isoformat()
        )
        payload = run_longbridge_cli_json(
            settings,
            [
                "kline",
                "history",
                symbol,
                "--period",
                "day",
                "--adjust",
                "none",
                "--start",
                start_date,
                "--end",
                now_nyt.date().isoformat(),
                "--format",
                "json",
            ],
            timeout_seconds=60,
        )
        frame = _cli_daily_candlestick_rows_to_frame(payload if isinstance(payload, list) else [])
        if frame.empty:
            raise ValueError(f"No daily market data returned for {ticker}.")
        dataset = frame.drop_duplicates(subset=["Date"], keep="first").sort_values("Date")
        if effective_start_nyt is not None:
            start_filter = pd.Timestamp(effective_start_nyt.date())
            dataset = dataset.loc[dataset["Date"] >= start_filter].copy()
        if dataset.empty:
            raise ValueError(f"No daily market data returned for {ticker}.")
        return dataset.reset_index(drop=True)

    _, _, period_enum, adjust_type_enum = _load_longbridge_openapi()
    adjust_type = _resolve_longbridge_daily_adjust_type(adjust_type_enum)
    period_day = _resolve_daily_period(period_enum)
    quote_context = get_longbridge_quote_context(settings)

    frames: list[pd.DataFrame] = []
    cursor: datetime | None = None
    previous_oldest: datetime | None = None

    import time
    for _ in range(500):
        try:
            if cursor is None:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    period_day,
                    adjust_type,
                    False,
                    DAILY_CHUNK_SIZE,
                )
            else:
                batch = quote_context.history_candlesticks_by_offset(
                    symbol,
                    period_day,
                    adjust_type,
                    False,
                    DAILY_CHUNK_SIZE,
                    cursor,
                )
        except Exception as e:
            if "timeout" in str(e).lower() and frames:
                break
            raise e

        if not batch:
            break

        frame = _daily_candlestick_rows_to_frame(list(batch))
        if frame.empty:
            break
        frames.append(frame)

        batch_min_date = pd.Timestamp(frame["Date"].min())
        oldest_ts_naive = _normalize_to_new_york_naive(batch_min_date)
        if effective_start_nyt is not None and oldest_ts_naive <= effective_start_nyt:
            break

        next_cursor_utc = (_localize_new_york(batch_min_date).tz_convert(UTC_TIMEZONE) - pd.Timedelta(seconds=1)).to_pydatetime()
        if previous_oldest is not None and next_cursor_utc >= previous_oldest:
            break
        previous_oldest = next_cursor_utc
        cursor = next_cursor_utc
        time.sleep(0.04)

    if not frames:
        raise ValueError(f"No daily market data returned for {ticker}.")

    dataset = pd.concat(frames, ignore_index=True)
    dataset = dataset.drop_duplicates(subset=["Date"], keep="first").sort_values("Date")
    if effective_start_nyt is not None:
        start_date = pd.Timestamp(effective_start_nyt.date())
        dataset = dataset.loc[dataset["Date"] >= start_date].copy()

    if dataset.empty:
        raise ValueError(f"No daily market data returned for {ticker}.")
    return dataset.reset_index(drop=True)


def _read_existing_one_minute_store_for_refresh(path, ticker: str) -> pd.DataFrame:
    """Read an existing cache or fail closed before any replacement can occur."""
    try:
        return normalize_one_minute_store_frame(pd.read_parquet(path), ticker)
    except Exception as exc:
        raise OneMinuteStoreReadError(
            f"Unable to read the existing 1-minute market store for {ticker}; "
            "refusing to overwrite the cache."
        ) from exc


def refresh_longbridge_one_minute_store(ticker: str, settings: BrokerSettings) -> pd.DataFrame:
    ensure_market_store_dir()
    path = intraday_history_store_path_for(ticker, "1m")

    since: datetime | None = None
    existing_df: pd.DataFrame | None = None
    if path.exists():
        existing_df = _read_existing_one_minute_store_for_refresh(path, ticker)
        if not existing_df.empty:
            since = pd.to_datetime(existing_df["Date"].max()).to_pydatetime()

    new_dataset = fetch_longbridge_one_minute_history(ticker, settings, since=since)

    with market_store_file_lock(path):
        latest_existing_df: pd.DataFrame | None = existing_df
        if path.exists():
            latest_existing_df = _read_existing_one_minute_store_for_refresh(path, ticker)

        if latest_existing_df is not None and not latest_existing_df.empty:
            # Merge new and old
            combined = pd.concat([latest_existing_df, new_dataset])
            # Keep the latest record for any duplicate timestamps
            combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")

            # Enforce the 6-month limit on the combined store
            cut_off = one_minute_lookback_start().tz_convert(NEW_YORK_TIMEZONE).tz_localize(None)
            combined = combined.loc[combined["Date"] >= cut_off].copy()

            write_parquet_atomic(path, combined, index=False)
            return combined

        write_parquet_atomic(path, new_dataset, index=False)
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
    target_date = latest_completed_nyse_trading_day(
        pd.Timestamp.now(tz=timezone.utc) if now is None else now
    )
    return max_date_nyt.date() >= target_date.date()


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


def is_one_minute_store_fresh(ticker: str) -> bool:
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
    if date_values.empty:
        return False

    return _is_market_data_fresh(date_values.max())


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


def _has_new_listing_short_history(ticker: str, *, interval: str) -> bool:
    path = intraday_history_store_path_for(ticker, "1m") if interval == "1m" else history_store_path_for(ticker)
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

    first_trading_day = date_values.min()
    latest_trading_day = date_values.max()
    target_trading_day = latest_completed_nyse_trading_day(pd.Timestamp.now(tz=timezone.utc))
    new_listing_cutoff = pd.Timestamp(target_trading_day) - pd.DateOffset(months=NEW_LISTING_MAX_AGE_MONTHS)
    return first_trading_day >= new_listing_cutoff and _is_market_data_fresh(latest_trading_day)


def classify_one_minute_store_status(ticker: str) -> str:
    if is_one_minute_store_complete(ticker):
        return "fresh"
    if _has_new_listing_short_history(ticker, interval="1m"):
        return "short_history"
    return "missing"


def classify_daily_store_status(ticker: str) -> str:
    if is_daily_store_complete(ticker):
        return "fresh"
    if _has_new_listing_short_history(ticker, interval="1d"):
        return "short_history"
    return "missing"
