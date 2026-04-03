"""
Reusable market freshness helpers.

Code version: v0.2.0
"""

from __future__ import annotations

from typing import Any

from app.services.market_data import ensure_fresh_history_store

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
        except Exception:
            failed_tickers.append(ticker)
    return failed_tickers


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
            ticker.strip().upper()
            for ticker, snapshot in position_snapshot.items()
            if ticker and str((snapshot or {}).get("quantity") or "0").strip() not in {"", "0", "0.0"}
        )

    holdings: dict[str, float] = {}
    for txn in investment_payload.get("transactions", []):
        ticker = str(txn.get("ticker") or "").strip().upper()
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
            ticker.strip().upper()
            for ticker in position_snapshot
            if str(ticker or "").strip()
        )

    for txn in investment_payload.get("transactions", []):
        ticker = str(txn.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
        if normalized_type in _NON_MARKET_TICKER_TYPES:
            continue
        collected.add(ticker)

    return sorted(collected)
