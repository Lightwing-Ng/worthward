"""
Reusable market freshness helpers.

Code version: v0.3.1
"""

from __future__ import annotations

from typing import Any

from app.infrastructure.broker_market_data import is_one_minute_store_fresh
from app.infrastructure.storage import investment_ticker_store_aliases, normalize_ticker
from app.services.market_data import ensure_fresh_history_store, refresh_one_minute_store

_NON_MARKET_TICKER_TYPES = {"forex_trade", "forex_trade_component", "fx_translation_pnl"}


def ensure_latest_daily_caches(tickers: list[str]) -> list[str]:
    """
    Refresh stale daily caches for the provided tickers.

    Returns the tickers that could not be refreshed.
    """
    failed_tickers: list[str] = []
    for ticker in tickers:
        try:
            ensure_fresh_history_store(ticker)
        except (ImportError, OSError, ValueError, KeyError, TypeError):
            failed_tickers.append(ticker)
    return failed_tickers


def ensure_latest_investment_daily_caches(tickers: list[str]) -> list[str]:
    """
    Refresh stale daily caches for investment tickers.

    Legacy ticker aliases are treated as an ordered fallback chain. Once one
    candidate is fresh or refreshes successfully, the rest of the chain is not
    touched.
    """
    failed_tickers: list[str] = []
    for ticker in tickers:
        normalized_ticker = normalize_ticker(ticker)
        if not normalized_ticker:
            continue

        refreshed = False
        for candidate in investment_ticker_store_aliases(normalized_ticker):
            try:
                ensure_fresh_history_store(candidate)
                refreshed = True
                break
            except (ImportError, OSError, ValueError, KeyError, TypeError):
                continue
        if not refreshed:
            failed_tickers.append(normalized_ticker)
    return failed_tickers


def ensure_latest_backtest_caches(ticker: str) -> dict[str, str | bool | None]:
    """
    Refresh backtest caches for both daily and 1-minute market data when stale.

    The 1-minute branch focuses on freshness rather than six-month completeness,
    so a fresh cached dataset fetched via fallback providers can still be reused
    without triggering a redundant refresh on every page load.
    """
    normalized_ticker = normalize_ticker(ticker)
    result: dict[str, str | bool | None] = {
        "ticker": normalized_ticker,
        "daily_refreshed": False,
        "daily_error": None,
        "intraday_refreshed": False,
        "intraday_error": None,
    }

    try:
        result["daily_refreshed"] = ensure_fresh_history_store(normalized_ticker)
    except Exception as exc:
        result["daily_error"] = str(exc)

    try:
        if not is_one_minute_store_fresh(normalized_ticker):
            refresh_one_minute_store(normalized_ticker)
            result["intraday_refreshed"] = True
    except Exception as exc:
        result["intraday_error"] = str(exc)

    return result


def extract_open_investment_tickers(investment_payload: dict[str, Any]) -> list[str]:
    """
    Extract currently open tickers from the investment payload.

    Prefer the explicit position snapshot when present because it already
    represents the latest open holdings. Fall back to replaying transaction
    quantities for compatibility with older payloads.
    """
    position_snapshot = investment_payload.get("position_snapshot")
    if isinstance(position_snapshot, dict) and position_snapshot:
        return sorted(
            normalize_ticker(ticker)
            for ticker, snapshot in position_snapshot.items()
            if ticker and str((snapshot or {}).get("quantity") or "0").strip() not in {"", "0", "0.0"}
        )

    holdings: dict[str, float] = {}
    for txn in investment_payload.get("transactions", []):
        ticker = normalize_ticker(str(txn.get("ticker") or ""))
        if not ticker:
            continue
        normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
        quantity_raw = (
            txn.get("quantity_raw")
            or txn.get("quantity_abs")
            or (txn.get("normalized") or {}).get("display_quantity")
        )
        try:
            quantity = float(quantity_raw)
        except (TypeError, ValueError):
            continue
        holdings.setdefault(ticker, 0.0)
        if normalized_type in {"buy", "dividend_reinvestment", "grant"}:
            holdings[ticker] += quantity
        elif normalized_type == "sell":
            holdings[ticker] -= abs(quantity)
        if abs(holdings[ticker]) < 1e-12:
            holdings.pop(ticker, None)

    return sorted(holdings.keys())


def extract_all_investment_tickers(investment_payload: dict[str, Any]) -> list[str]:
    """
    Extract every ticker referenced by the investment payload.

    This is broader than the open-holdings helper and is intended for
    import-time prewarming so newly imported closed positions can still reuse
    the shared market-data cache path later.
    """
    collected: set[str] = set()

    position_snapshot = investment_payload.get("position_snapshot")
    if isinstance(position_snapshot, dict):
        collected.update(
            normalize_ticker(ticker)
            for ticker in position_snapshot
            if str(ticker or "").strip()
        )

    for txn in investment_payload.get("transactions", []):
        ticker = normalize_ticker(str(txn.get("ticker") or ""))
        if not ticker:
            continue
        normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
        if normalized_type in _NON_MARKET_TICKER_TYPES:
            continue
        collected.add(ticker)

    return sorted(collected)
