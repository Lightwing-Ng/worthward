"""
Cash equivalent tickers persistence for donut visualization.

Code version: v0.3.0
- Added: Saved empty ticker lists are preserved so defaults only apply before configuration exists.
"""

from __future__ import annotations

from typing import List

from app.core.config import SETTINGS_STORE_DIR
from app.core.settings_store import LEGACY_SECTION_PATHS, load_all_settings, save_settings_section

CASH_EQUIVALENTS_PATH = LEGACY_SECTION_PATHS["cash_equivalents"]
DEFAULT_CASH_EQUIVALENTS: List[str] = ["BOXX", "SGOV"]


def _normalize_ticker_list(raw: object) -> List[str]:
    if not isinstance(raw, (list, tuple)):
        return []
    result: List[str] = []
    seen: set[str] = set()
    for item in raw:
        ticker = str(item or "").strip().upper()
        if ticker and ticker not in seen:
            seen.add(ticker)
            result.append(ticker)
    return result


def load_cash_equivalent_tickers() -> List[str]:
    try:
        settings_payload = load_all_settings()
        if "cash_equivalents" in settings_payload:
            payload = settings_payload.get("cash_equivalents", {})
            raw_tickers = payload.get("tickers") if isinstance(payload, dict) else None
            if isinstance(raw_tickers, (list, tuple)):
                return _normalize_ticker_list(raw_tickers)
            return []
    except (OSError, TypeError):
        pass
    return list(DEFAULT_CASH_EQUIVALENTS)


def save_cash_equivalent_tickers(tickers: List[str] | tuple[str, ...] | set[str]) -> List[str]:
    normalized = _normalize_ticker_list(tickers)
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    save_settings_section("cash_equivalents", {"tickers": normalized})
    return normalized
