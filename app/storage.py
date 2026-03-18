"""
Filesystem helpers for market store persistence.

Code version: v3.5.0
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from .config import MARKET_STORE_DIR


HISTORICAL_STORE_DIR = MARKET_STORE_DIR / "historical"
PROFILES_STORE_DIR = MARKET_STORE_DIR / "profiles"
PRIMARY_PROFILES_STORE_DIR = PROFILES_STORE_DIR / "primary"
SEARCH_PROFILES_STORE_DIR = PROFILES_STORE_DIR / "search"
LOGOS_STORE_DIR = MARKET_STORE_DIR / "logos"
PRIMARY_LOGOS_STORE_DIR = LOGOS_STORE_DIR / "primary"
SEARCH_LOGOS_STORE_DIR = LOGOS_STORE_DIR / "search"
SEARCH_STORE_DIR = MARKET_STORE_DIR / "search"
TICKER_USAGE_STORE_PATH = SEARCH_STORE_DIR / "ticker_usage.json"


def ensure_market_store_dir() -> None:
    for path in (
        MARKET_STORE_DIR,
        HISTORICAL_STORE_DIR,
        PROFILES_STORE_DIR,
        PRIMARY_PROFILES_STORE_DIR,
        SEARCH_PROFILES_STORE_DIR,
        LOGOS_STORE_DIR,
        PRIMARY_LOGOS_STORE_DIR,
        SEARCH_LOGOS_STORE_DIR,
        SEARCH_STORE_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def normalize_ticker(ticker: str) -> str:
    return ticker.upper().replace("/", "_")


def history_store_path_for(ticker: str) -> Path:
    return HISTORICAL_STORE_DIR / f"{normalize_ticker(ticker)}.parquet"


def profile_store_path_for(ticker: str, namespace: str = "primary") -> Path:
    base_dir = PRIMARY_PROFILES_STORE_DIR if namespace == "primary" else SEARCH_PROFILES_STORE_DIR
    return base_dir / f"{normalize_ticker(ticker)}.json"


def logo_store_path_for(ticker: str, namespace: str = "primary") -> Path:
    base_dir = PRIMARY_LOGOS_STORE_DIR if namespace == "primary" else SEARCH_LOGOS_STORE_DIR
    return base_dir / f"{normalize_ticker(ticker)}.png"


def search_store_path_for(query: str) -> Path:
    return SEARCH_STORE_DIR / f"{query.upper().replace('/', '_')}.json"


def ticker_from_store_path(path: Path) -> str:
    return path.stem.replace("_", "/").upper()


def list_local_tickers() -> list[str]:
    ensure_market_store_dir()
    tickers = {
        ticker_from_store_path(path)
        for directory in (HISTORICAL_STORE_DIR, PRIMARY_PROFILES_STORE_DIR, SEARCH_PROFILES_STORE_DIR)
        for path in directory.glob("*")
        if path.is_file()
    }
    return sorted(tickers)


def is_store_entry_fresh(path: Path) -> bool:
    if not path.exists():
        return False

    modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date()
    return modified_at >= datetime.now(timezone.utc).date()


def load_ticker_usage_store() -> dict[str, dict[str, int | str]]:
    ensure_market_store_dir()
    if not TICKER_USAGE_STORE_PATH.exists():
        return {}
    return json.loads(TICKER_USAGE_STORE_PATH.read_text())


def record_ticker_usage(tickers: list[str]) -> None:
    ensure_market_store_dir()
    payload = load_ticker_usage_store()
    now = datetime.now(timezone.utc).isoformat()
    for ticker in tickers:
        normalized = normalize_ticker(ticker)
        current = payload.get(normalized, {"count": 0, "last_used_at": now})
        payload[normalized] = {
            "count": int(current.get("count", 0)) + 1,
            "last_used_at": now,
        }
    TICKER_USAGE_STORE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def top_used_tickers(query: str = "", limit: int = 5) -> list[str]:
    payload = load_ticker_usage_store()
    normalized_query = normalize_ticker(query)
    ranked: list[tuple[str, int, str]] = []
    for ticker, meta in payload.items():
        if normalized_query and not ticker.startswith(normalized_query):
            continue
        ranked.append(
            (
                ticker,
                int(meta.get("count", 0)),
                str(meta.get("last_used_at", "")),
            )
        )
    ranked.sort(key=lambda item: (-item[1], -datetime.fromisoformat(item[2]).timestamp() if item[2] else 0.0, item[0]))
    return [ticker for ticker, _, _ in ranked[:limit]]


def clear_nonhistorical_market_cache() -> None:
    ensure_market_store_dir()
    for directory in (
        PRIMARY_PROFILES_STORE_DIR,
        SEARCH_PROFILES_STORE_DIR,
        PRIMARY_LOGOS_STORE_DIR,
        SEARCH_LOGOS_STORE_DIR,
        SEARCH_STORE_DIR,
    ):
        for path in directory.glob("*"):
            if path.is_file():
                path.unlink()


def delete_ticker_data(ticker: str) -> None:
    ensure_market_store_dir()
    paths = [
        history_store_path_for(ticker),
        profile_store_path_for(ticker, namespace="primary"),
        profile_store_path_for(ticker, namespace="search"),
        logo_store_path_for(ticker, namespace="primary"),
        logo_store_path_for(ticker, namespace="search"),
    ]
    for path in paths:
        if path.exists():
            path.unlink()
