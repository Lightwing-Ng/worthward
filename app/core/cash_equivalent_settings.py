"""
Cash equivalent tickers persistence for donut visualization.

Code version: v0.2.0
- Added: Saved empty ticker lists are preserved so defaults only apply before configuration exists.
"""

from __future__ import annotations

import json
from typing import List

from app.core.config import SETTINGS_STORE_DIR

CASH_EQUIVALENTS_PATH = SETTINGS_STORE_DIR / "cash_equivalents.json"
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
        if CASH_EQUIVALENTS_PATH.exists():
            payload = json.loads(CASH_EQUIVALENTS_PATH.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                raw_tickers = payload.get("tickers")
                if isinstance(raw_tickers, (list, tuple)):
                    return _normalize_ticker_list(raw_tickers)
    except (json.JSONDecodeError, OSError, TypeError):
        pass
    return list(DEFAULT_CASH_EQUIVALENTS)


def save_cash_equivalent_tickers(tickers: List[str] | tuple[str, ...] | set[str]) -> List[str]:
    normalized = _normalize_ticker_list(tickers)
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    CASH_EQUIVALENTS_PATH.write_text(
        json.dumps({"tickers": normalized}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return normalized
