"""
Filesystem helpers for market store persistence.

Code version: v0.7.0
"""

from __future__ import annotations

import json
import re
import shutil
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import threading
from typing import Any, Callable
from uuid import uuid4

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

import pandas as pd

from app.core.config import MARKET_STORE_DIR, SETTINGS_STORE_DIR
from app.core.settings import get_settings

LEGACY_INVESTMENT_STORE_PATH = SETTINGS_STORE_DIR / "investment.json"
INVESTMENT_STORE_PATH = SETTINGS_STORE_DIR / "investment.parquet"
HISTORICAL_STORE_DIR = MARKET_STORE_DIR / "historical"
PROFILES_STORE_DIR = MARKET_STORE_DIR / "profiles"
PROFILES_PARQUET_PATH = PROFILES_STORE_DIR / "profiles.parquet"
LOGOS_STORE_DIR = MARKET_STORE_DIR / "logos"
LEGACY_SEARCH_STORE_DIR = MARKET_STORE_DIR / "search"
SEARCH_STORE_DIR = SETTINGS_STORE_DIR / "search"
SEARCH_CACHE_PARQUET_PATH = SEARCH_STORE_DIR / "search_cache.parquet"
TICKER_USAGE_STORE_PATH = SEARCH_STORE_DIR / "ticker_usage.json"

PROFILE_SCOPE_LOCAL = "local_store"
PROFILE_SCOPE_SEARCH = "search_cache"

_PROFILE_COLUMNS = [
    "ticker",
    "company_name",
    "website",
    "storage_scope",
    "tradingview_screener",
    "tradingview_exchange",
    "updated_at",
]
_SEARCH_CACHE_COLUMNS = ["query", "symbol", "name", "asset_type", "logo_url", "source", "updated_at"]
_INVESTMENT_STORE_COLUMNS = ["section", "row_index", "value_json", "updated_at"]
_SHARE_CLASS_TICKER_PATTERN = re.compile(r"^([A-Z0-9]{1,4})[.\-\s]+([ABC])$")
_INTRADAY_STORE_SUFFIX_PATTERN = re.compile(r"_[0-9]+[a-z]+$")

_MIGRATION_COMPLETED = False
_MIGRATION_RUNNING = False
_MIGRATION_LOCK = threading.RLock()
_TABLE_THREAD_LOCKS: dict[str, threading.RLock] = {}
_TABLE_THREAD_LOCKS_GUARD = threading.Lock()


def ensure_market_store_dir() -> None:
    _ensure_market_store_directories()


def _ensure_market_store_directories() -> None:
    for path in (
            MARKET_STORE_DIR,
            SETTINGS_STORE_DIR,
            HISTORICAL_STORE_DIR,
            PROFILES_STORE_DIR,
            LOGOS_STORE_DIR,
            SEARCH_STORE_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_search_store()
    _migrate_legacy_store_filenames()


def _canonicalize_ticker_token(value: str) -> str:
    raw_value = str(value or "").strip().upper()
    share_class_match = _SHARE_CLASS_TICKER_PATTERN.fullmatch(raw_value)
    if share_class_match is not None:
        return f"{share_class_match.group(1)}-{share_class_match.group(2)}"
    normalized = re.sub(r"\s+", "-", raw_value)
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def _migrate_store_filenames(directory: Path, pattern: str) -> None:
    for path in directory.glob(pattern):
        if not path.is_file():
            continue
        normalized_name = re.sub(r"\s+", "-", path.name)
        if normalized_name == path.name:
            continue
        target = path.with_name(normalized_name)
        if target.exists():
            path.unlink()
            continue
        path.rename(target)


def _migrate_legacy_store_filenames() -> None:
    global _MIGRATION_COMPLETED, _MIGRATION_RUNNING
    if _MIGRATION_COMPLETED:
        return
    with _MIGRATION_LOCK:
        if _MIGRATION_COMPLETED or _MIGRATION_RUNNING:
            return
        _MIGRATION_RUNNING = True
        try:
            _migrate_store_filenames(HISTORICAL_STORE_DIR, "*.parquet")
            _migrate_store_filenames(LOGOS_STORE_DIR, "*.png")
            _MIGRATION_COMPLETED = True
        finally:
            _MIGRATION_RUNNING = False


def _migrate_legacy_search_store() -> None:
    if not LEGACY_SEARCH_STORE_DIR.exists() or LEGACY_SEARCH_STORE_DIR == SEARCH_STORE_DIR:
        return
    SEARCH_STORE_DIR.mkdir(parents=True, exist_ok=True)
    for path in LEGACY_SEARCH_STORE_DIR.iterdir():
        target = SEARCH_STORE_DIR / path.name
        if target.exists():
            continue
        shutil.move(str(path), str(target))
    try:
        LEGACY_SEARCH_STORE_DIR.rmdir()
    except OSError:
        return


def normalize_ticker(ticker: str) -> str:
    normalized = _canonicalize_ticker_token(ticker)
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip(" ._")
    if normalized.endswith(".HK"):
        symbol, suffix = normalized.rsplit(".", 1)
        hk_variants = _hk_ticker_code_variants(symbol)
        if hk_variants:
            normalized = f"{hk_variants[-1]}.{suffix}"
    # The project defaults to bare symbols for US stocks (e.g. "BAC", "AAPL").
    # Do not pollute canonical storage or listings with ".US" suffix from Longbridge
    # or other sources. ".US" is only used internally when talking to Longbridge APIs.
    if normalized.endswith(".US"):
        normalized = normalized[:-3].rstrip(".")
    return normalized


def canonicalize_investment_ticker(ticker: str) -> str:
    normalized_ticker = normalize_ticker(ticker)
    # US stocks are canonically stored bare (no .US suffix). HK gets special code normalization.
    if not normalized_ticker.endswith(".HK"):
        return normalized_ticker
    symbol, suffix = normalized_ticker.rsplit(".", 1)
    hk_variants = _hk_ticker_code_variants(symbol)
    canonical_symbol = hk_variants[-1] if hk_variants else symbol
    return f"{canonical_symbol}.{suffix}"


# Ordered market-data lineage for legacy tickers. Ledger transactions keep the
# original symbol (for example SPLG.US); lineage is only used for quotes,
# cache refresh, and chart replay. SPLG was succeeded by SPYM on 2025-10-31,
# so the current successor is preferred over stale legacy stores.
# SPY remains a last-resort broad S&P 500 proxy.
INVESTMENT_TICKER_LINEAGE: dict[str, tuple[str, ...]] = {
    "SPLG.US": ("SPYM", "SPYM.US", "SPLG", "SPY", "SPY.US"),
    "SPLG": ("SPYM", "SPYM.US", "SPY", "SPY.US"),
}

LINEAGE_IDENTITY_PROXY_TICKERS = frozenset({"SPY", "SPY.US"})

# Ordered quote-symbol transitions for the same listed security. The requested
# symbol remains first so SKHY automatically takes precedence once its stores
# become available, while SKHYV remains usable during the temporary-symbol era.
MARKET_TICKER_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "SKHY": ("SKHY", "SKHYV"),
    "SKHYV": ("SKHYV", "SKHY"),
}


def market_ticker_store_aliases(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return []
    return list(dict.fromkeys(
        normalize_ticker(candidate)
        for candidate in MARKET_TICKER_TRANSITIONS.get(normalized_ticker, (normalized_ticker,))
        if normalize_ticker(candidate)
    ))

# Canonical issuer names for tickers that are not yet populated by yfinance or
# other remote profile providers. Keep ledger symbols unchanged; this only
# affects display labels and profile refresh fallbacks.
KNOWN_TICKER_COMPANY_NAMES: dict[str, str] = {
    "AMD": "Advanced Micro Devices, Inc.",
    "DRAM": "Roundhill Memory ETF",
    "EUV": "Corgi Lithography & Semiconductor Photonics ETF",
    "GOOG": "Alphabet Inc.",
    "GOOGL": "Alphabet Inc.",
    "IBKR": "Interactive Brokers Group, Inc.",
    "JEPQ": "JPMorgan Nasdaq Equity Premium Income ETF",
    "META": "Meta Platforms, Inc.",
    "QQQI": "NEOS Nasdaq-100(R) High Income ETF",
    "RAM": "Roundhill T-REX 2X Long DRAM Daily Target ETF",
    "SGOV": "iShares 0-3 Month Treasury Bond ETF",
    "SKHY": "SK hynix Inc.",
    "SKHYV": "SK hynix Inc.",
}

ROUNDHILL_PRODUCT_LOGO_TICKERS = frozenset({
    "DRAM",
    "RAM",
})

PINNED_LOGO_TICKERS = frozenset({
    "AMD",
    "AVGO",
    "COST",
    "GOOG",
    "GOOGL",
    "GS",
    "IBKR",
    "JPM",
    "KO",
    "LITE",
    "MS",
    "MSFT",
    "MU",
    "ORCL",
    "QQQ",
    "SPCX",
    "SPY",
    "TSM",
}) | ROUNDHILL_PRODUCT_LOGO_TICKERS


def is_pinned_logo_ticker(ticker: str) -> bool:
    return normalize_ticker(ticker) in PINNED_LOGO_TICKERS


def resolve_known_ticker_company_name(ticker: str) -> str | None:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return None
    for candidate in investment_ticker_store_aliases(ticker):
        known_name = KNOWN_TICKER_COMPANY_NAMES.get(normalize_ticker(candidate))
        if known_name:
            return known_name
    return KNOWN_TICKER_COMPANY_NAMES.get(normalized_ticker)


def known_ticker_company_names_payload() -> dict[str, str]:
    payload = dict(KNOWN_TICKER_COMPANY_NAMES)
    for ticker, company_name in KNOWN_TICKER_COMPANY_NAMES.items():
        if not ticker.endswith(".US"):
            payload.setdefault(f"{ticker}.US", company_name)
    return payload


def investment_ticker_lineage_payload() -> dict[str, list[str]]:
    return {
        legacy_ticker: list(candidates)
        for legacy_ticker, candidates in INVESTMENT_TICKER_LINEAGE.items()
    }


def investment_ticker_lineage_identity_successors(legacy_ticker: str) -> tuple[str, ...]:
    successors = INVESTMENT_TICKER_LINEAGE.get(normalize_ticker(legacy_ticker), ())
    return tuple(
        normalize_ticker(candidate)
        for candidate in successors
        if normalize_ticker(candidate) not in LINEAGE_IDENTITY_PROXY_TICKERS
    )


def investment_ticker_lineage_legacy_tickers(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return []
    legacy_tickers: list[str] = []
    for legacy_ticker in INVESTMENT_TICKER_LINEAGE:
        identity_successors = investment_ticker_lineage_identity_successors(legacy_ticker)
        if normalized_ticker in identity_successors:
            # Report the legacy key in its original form (may contain .US) for
            # compatibility; primary canonical form is bare.
            if legacy_ticker and legacy_ticker not in legacy_tickers:
                legacy_tickers.append(legacy_ticker)
    return legacy_tickers


def is_ticker_fallback_company_name(company_name: str, ticker: str) -> bool:
    normalized_ticker = normalize_ticker(ticker)
    normalized_name = str(company_name or "").strip().upper()
    if not normalized_name or not normalized_ticker:
        return True
    fallback_names = {normalized_ticker}
    if normalized_ticker.endswith(".US"):
        fallback_names.add(normalized_ticker[:-3])
    elif "." not in normalized_ticker:
        fallback_names.add(f"{normalized_ticker}.US")
    return normalized_name in fallback_names


def propagate_investment_lineage_identity_profiles(
        ticker_profiles: dict[str, dict[str, str]],
) -> None:
    for legacy_ticker, entry in list(ticker_profiles.items()):
        for successor in investment_ticker_lineage_identity_successors(legacy_ticker):
            existing = ticker_profiles.get(successor)
            if existing is None or is_ticker_fallback_company_name(
                    str(existing.get("company_name") or ""),
                    successor,
            ):
                ticker_profiles[successor] = {
                    **entry,
                    "ticker": successor,
                }


def investment_ticker_identity_store_aliases(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return []

    aliases: list[str] = []

    def add_alias(value: str) -> None:
        # Keep original suffixed forms (e.g. "SPYM.US") in alias lists for lookup
        # compat and tests, while primary canonical (normalize_ticker) is bare for US.
        if value and value not in aliases:
            aliases.append(value)
        n = normalize_ticker(value)
        if n and n not in aliases:
            aliases.append(n)

    for candidate in INVESTMENT_TICKER_LINEAGE.get(normalized_ticker, ()):
        if normalize_ticker(candidate) in LINEAGE_IDENTITY_PROXY_TICKERS:
            continue
        add_alias(candidate)

    if normalized_ticker.endswith(".US"):
        add_alias(normalized_ticker[:-3].strip())

    if normalized_ticker.endswith(".HK"):
        symbol, suffix = normalized_ticker.rsplit(".", 1)
        for code in _hk_ticker_code_variants(symbol):
            add_alias(f"{code}.{suffix}")

    add_alias(normalized_ticker)

    if (
            not normalized_ticker.endswith((".US", ".HK"))
            and re.fullmatch(r"[A-Z0-9]+", normalized_ticker)
    ):
        # Include suffixed form in alias list for lookup/backcompat (even though
        # canonical storage + display uses bare for US stocks per project default).
        suffixed = f"{normalized_ticker}.US"
        if suffixed not in aliases:
            aliases.append(suffixed)
        add_alias(normalized_ticker)

    return aliases


def investment_ticker_store_aliases(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return []

    aliases: list[str] = []

    def add_alias(value: str) -> None:
        # Keep original suffixed forms (e.g. "SPYM.US") in alias lists for lookup
        # compat and tests, while primary canonical (normalize_ticker) is bare for US.
        if value and value not in aliases:
            aliases.append(value)
        n = normalize_ticker(value)
        if n and n not in aliases:
            aliases.append(n)

    for candidate in INVESTMENT_TICKER_LINEAGE.get(normalized_ticker, ()):
        add_alias(candidate)

    if normalized_ticker.endswith(".US"):
        add_alias(normalized_ticker[:-3].strip())

    if normalized_ticker.endswith(".HK"):
        symbol, suffix = normalized_ticker.rsplit(".", 1)
        for code in _hk_ticker_code_variants(symbol):
            add_alias(f"{code}.{suffix}")

    add_alias(normalized_ticker)

    if (
            not normalized_ticker.endswith((".US", ".HK"))
            and re.fullmatch(r"[A-Z0-9]+", normalized_ticker)
    ):
        # Include suffixed form in alias list for lookup/backcompat (even though
        # canonical storage + display uses bare for US stocks per project default).
        suffixed = f"{normalized_ticker}.US"
        if suffixed not in aliases:
            aliases.append(suffixed)
        add_alias(normalized_ticker)

    return aliases


def expand_tickers_with_store_lineage(tickers: list[str] | set[str] | tuple[str, ...]) -> list[str]:
    expanded: list[str] = []
    seen: set[str] = set()
    for ticker in tickers:
        for candidate in investment_ticker_store_aliases(ticker):
            if candidate in seen:
                continue
            seen.add(candidate)
            expanded.append(candidate)
    return expanded


def history_store_path_for(ticker: str) -> Path:
    return HISTORICAL_STORE_DIR / f"{normalize_ticker(ticker)}.parquet"


def intraday_history_store_path_for(ticker: str, interval: str = "1m") -> Path:
    normalized_interval = str(interval).strip().lower() or "1m"
    return HISTORICAL_STORE_DIR / f"{normalize_ticker(ticker)}_{normalized_interval}.parquet"


def _hk_ticker_code_variants(symbol: str) -> list[str]:
    normalized_symbol = str(symbol or "").strip().upper()
    if not re.fullmatch(r"\d{4,5}", normalized_symbol):
        return [normalized_symbol] if normalized_symbol else []
    stripped = normalized_symbol.lstrip("0") or normalized_symbol
    variants: list[str] = []
    for candidate in (normalized_symbol, stripped):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def logo_store_filenames_for(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    if not normalized_ticker:
        return []

    filenames: list[str] = []

    def add_filename(value: str) -> None:
        normalized_value = str(value or "").strip()
        if not normalized_value or normalized_value in filenames:
            return
        filenames.append(normalized_value)

    if "." in normalized_ticker:
        symbol, suffix = normalized_ticker.rsplit(".", 1)
        if suffix == "HK":
            for code in _hk_ticker_code_variants(symbol):
                for extension in ("svg", "png"):
                    add_filename(f"{code}.{suffix}.{extension}")
        for extension in ("svg", "png"):
            add_filename(f"{normalized_ticker}.{extension}")
    else:
        for extension in ("svg", "png"):
            add_filename(f"{normalized_ticker}.{extension}")

    return filenames


def resolve_logo_store_path(ticker: str) -> Path | None:
    for filename in logo_store_filenames_for(ticker):
        candidate = LOGOS_STORE_DIR / filename
        if candidate.exists() and candidate.stat().st_size > 0 and _logo_content_matches_extension(candidate):
            return candidate
    return None


def _logo_content_matches_extension(path: Path) -> bool:
    try:
        prefix = path.read_bytes()[:512]
    except OSError:
        return False
    if path.suffix.lower() == ".png":
        return prefix.startswith(b"\x89PNG\r\n\x1a\n")
    if path.suffix.lower() == ".svg":
        return b"<svg" in prefix.lower()
    return False


def logo_store_path_for(ticker: str) -> Path:
    resolved = resolve_logo_store_path(ticker)
    if resolved is not None:
        return resolved
    return LOGOS_STORE_DIR / f"{normalize_ticker(ticker)}.png"


def ticker_from_store_path(path: Path) -> str:
    return normalize_ticker(path.stem.replace("_", "/"))


def _empty_frame(columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame({column: pd.Series(dtype="object") for column in columns})


def _read_parquet_table(path: Path, columns: list[str]) -> pd.DataFrame:
    ensure_market_store_dir()
    if not path.exists() or path.stat().st_size == 0:
        return _empty_frame(columns)

    try:
        table = pd.read_parquet(path)
    except Exception:
        return _empty_frame(columns)

    if table.empty:
        return _empty_frame(columns)

    for column in columns:
        if column not in table.columns:
            table[column] = ""

    return table[columns].copy()


def _write_parquet_table(path: Path, table: pd.DataFrame, columns: list[str]) -> None:
    ensure_market_store_dir()
    normalized = table.copy()
    for column in columns:
        if column not in normalized.columns:
            normalized[column] = ""
    normalized = normalized[columns].fillna("")
    tmp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp{path.suffix}")
    normalized.to_parquet(tmp_path, index=False)
    tmp_path.replace(path)


def write_parquet_atomic(path: Path, table: pd.DataFrame, *, index: bool = False) -> None:
    ensure_market_store_dir()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp{path.suffix}")
    try:
        table.to_parquet(tmp_path, index=index)
        tmp_path.replace(path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def write_json_atomic(path: Path, payload: object) -> None:
    ensure_market_store_dir()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp{path.suffix}")
    try:
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp_path.replace(path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def _investment_parquet_path_for(path: Path = INVESTMENT_STORE_PATH) -> Path:
    return path if path.suffix.lower() == ".parquet" else path.with_suffix(".parquet")


def _investment_legacy_json_path_for(path: Path = INVESTMENT_STORE_PATH) -> Path:
    if path.suffix.lower() == ".json":
        return path
    return path.with_suffix(".json")


def _investment_payload_to_table(payload: dict[str, object]) -> pd.DataFrame:
    now = _utc_iso_timestamp()
    rows: list[dict[str, object]] = []
    transactions = payload.get("transactions", [])
    if isinstance(transactions, list):
        for row_index, transaction in enumerate(transactions):
            rows.append({
                "section": "transactions",
                "row_index": row_index,
                "value_json": json.dumps(transaction, ensure_ascii=False, separators=(",", ":")),
                "updated_at": now,
            })

    for key, value in payload.items():
        if key == "transactions":
            continue
        rows.append({
            "section": str(key),
            "row_index": -1,
            "value_json": json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            "updated_at": now,
        })

    return pd.DataFrame(rows, columns=_INVESTMENT_STORE_COLUMNS)


def _investment_table_to_payload(table: pd.DataFrame) -> dict[str, object]:
    payload: dict[str, object] = {}
    transactions: list[object] = []
    if table.empty:
        return payload

    normalized = table.copy()
    for column in _INVESTMENT_STORE_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = "" if column != "row_index" else -1

    transaction_rows = normalized.loc[normalized["section"] == "transactions"].copy()
    if not transaction_rows.empty:
        transaction_rows["row_index"] = pd.to_numeric(transaction_rows["row_index"], errors="coerce").fillna(0)
        transaction_rows = transaction_rows.sort_values("row_index", ascending=True)
        for _, row in transaction_rows.iterrows():
            try:
                value = json.loads(str(row.get("value_json") or "{}"))
            except (json.JSONDecodeError, TypeError):
                value = {}
            if isinstance(value, dict):
                transactions.append(value)
        payload["transactions"] = transactions

    metadata_rows = normalized.loc[normalized["section"] != "transactions"].copy()
    if not metadata_rows.empty:
        metadata_rows["row_index"] = pd.to_numeric(metadata_rows["row_index"], errors="coerce").fillna(-1)
        metadata_rows = metadata_rows.sort_values(["section", "row_index"], ascending=[True, False])
        for _, row in metadata_rows.drop_duplicates(subset=["section"], keep="first").iterrows():
            section = str(row.get("section") or "").strip()
            if not section:
                continue
            try:
                payload[section] = json.loads(str(row.get("value_json") or "null"))
            except (json.JSONDecodeError, TypeError):
                payload[section] = None

    return payload


def investment_store_path_for(path: Path = INVESTMENT_STORE_PATH) -> Path:
    parquet_path = _investment_parquet_path_for(path)
    if parquet_path.exists() and parquet_path.stat().st_size > 0:
        return parquet_path
    legacy_path = _investment_legacy_json_path_for(path)
    if legacy_path.exists() and legacy_path.stat().st_size > 0:
        return legacy_path
    return parquet_path


def investment_store_exists(path: Path = INVESTMENT_STORE_PATH) -> bool:
    return investment_store_path_for(path).exists()


def load_investment_store_payload(path: Path = INVESTMENT_STORE_PATH) -> dict[str, object]:
    ensure_market_store_dir()
    parquet_path = _investment_parquet_path_for(path)
    legacy_path = _investment_legacy_json_path_for(path)
    with market_store_file_lock(parquet_path):
        if parquet_path.exists() and parquet_path.stat().st_size > 0:
            return _investment_table_to_payload(_read_parquet_table(parquet_path, _INVESTMENT_STORE_COLUMNS))
    if not legacy_path.exists() or legacy_path.stat().st_size == 0:
        return {}
    with market_store_file_lock(legacy_path):
        if not legacy_path.exists() or legacy_path.stat().st_size == 0:
            return {}
        try:
            payload = json.loads(legacy_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, TypeError):
            return {}
        if not isinstance(payload, dict):
            return {}
    save_investment_store_payload(payload, path)
    return payload


def save_investment_store_payload(payload: dict[str, object], path: Path = INVESTMENT_STORE_PATH) -> None:
    parquet_path = _investment_parquet_path_for(path)
    with market_store_file_lock(parquet_path):
        _write_parquet_table(parquet_path, _investment_payload_to_table(payload), _INVESTMENT_STORE_COLUMNS)


def update_investment_store_payload(
        updater: Callable[[dict[str, object]], tuple[dict[str, object], Any]],
        path: Path = INVESTMENT_STORE_PATH,
) -> Any:
    ensure_market_store_dir()
    parquet_path = _investment_parquet_path_for(path)
    legacy_path = _investment_legacy_json_path_for(path)
    with market_store_file_lock(parquet_path):
        if parquet_path.exists() and parquet_path.stat().st_size > 0:
            current_payload = _investment_table_to_payload(
                _read_parquet_table(parquet_path, _INVESTMENT_STORE_COLUMNS)
            )
        elif legacy_path.exists() and legacy_path.stat().st_size > 0:
            try:
                legacy_payload = json.loads(legacy_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError, TypeError):
                legacy_payload = {}
            current_payload = legacy_payload if isinstance(legacy_payload, dict) else {}
        else:
            current_payload = {}

        next_payload, result = updater(current_payload)
        _write_parquet_table(parquet_path, _investment_payload_to_table(next_payload), _INVESTMENT_STORE_COLUMNS)
        return result


def clear_investment_store(path: Path = INVESTMENT_STORE_PATH) -> bool:
    removed = False
    for candidate in (
            _investment_parquet_path_for(path),
            _investment_legacy_json_path_for(path),
    ):
        with market_store_file_lock(candidate):
            if candidate.exists():
                candidate.unlink()
                removed = True
    return removed


def _table_lock_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.lock")


def _table_thread_lock(path: Path) -> threading.RLock:
    lock_key = str(path.resolve())
    with _TABLE_THREAD_LOCKS_GUARD:
        lock = _TABLE_THREAD_LOCKS.get(lock_key)
        if lock is None:
            lock = threading.RLock()
            _TABLE_THREAD_LOCKS[lock_key] = lock
        return lock


@contextmanager
def _parquet_table_lock(path: Path):
    ensure_market_store_dir()
    thread_lock = _table_thread_lock(path)
    with thread_lock:
        lock_path = _table_lock_path(path)
        with lock_path.open("a+b") as handle:
            if fcntl:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            elif msvcrt:
                try:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                    yield
                finally:
                    try:
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
            else:
                yield


@contextmanager
def market_store_file_lock(path: Path):
    with _parquet_table_lock(path):
        yield


def _utc_iso_timestamp(path: Path | None = None) -> str:
    if path is None:
        return datetime.now(timezone.utc).isoformat()
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _normalize_profile_scope(scope: str | None) -> str:
    return PROFILE_SCOPE_LOCAL if scope == PROFILE_SCOPE_LOCAL else PROFILE_SCOPE_SEARCH


def _normalize_tradingview_screener(value: str | None) -> str:
    return str(value or "").strip().lower()


def _normalize_tradingview_exchange(value: str | None) -> str:
    return str(value or "").strip().upper()


def _merge_profile_rows(current: dict[str, str], incoming: dict[str, str]) -> dict[str, str]:
    current_scope = _normalize_profile_scope(current.get("storage_scope"))
    incoming_scope = _normalize_profile_scope(incoming.get("storage_scope"))
    merged_scope = PROFILE_SCOPE_LOCAL if PROFILE_SCOPE_LOCAL in {current_scope, incoming_scope} else PROFILE_SCOPE_SEARCH
    ticker = str(current.get("ticker") or incoming.get("ticker") or "").strip().upper()

    current_company = str(current.get("company_name") or "").strip()
    incoming_company = str(incoming.get("company_name") or "").strip()
    company_name = current_company
    current_is_ticker_fallback = bool(current_company) and current_company.upper() == ticker
    incoming_is_better_name = bool(incoming_company) and incoming_company.upper() != ticker
    if incoming_scope == PROFILE_SCOPE_LOCAL and incoming_company:
        company_name = incoming_company
    elif current_is_ticker_fallback and incoming_is_better_name:
        company_name = incoming_company
    elif not company_name or current_is_ticker_fallback:
        company_name = incoming_company or company_name

    current_website = str(current.get("website") or "").strip()
    incoming_website = str(incoming.get("website") or "").strip()
    website = incoming_website or current_website

    current_updated = str(current.get("updated_at") or "")
    incoming_updated = str(incoming.get("updated_at") or "")
    updated_at = max(current_updated, incoming_updated)

    current_screener = _normalize_tradingview_screener(current.get("tradingview_screener"))
    incoming_screener = _normalize_tradingview_screener(incoming.get("tradingview_screener"))
    current_exchange = _normalize_tradingview_exchange(current.get("tradingview_exchange"))
    incoming_exchange = _normalize_tradingview_exchange(incoming.get("tradingview_exchange"))

    return {
        "ticker": ticker,
        "company_name": company_name,
        "website": website,
        "storage_scope": merged_scope,
        "tradingview_screener": incoming_screener or current_screener,
        "tradingview_exchange": incoming_exchange or current_exchange,
        "updated_at": updated_at,
    }


def _load_profiles_table() -> pd.DataFrame:
    return _read_parquet_table(PROFILES_PARQUET_PATH, _PROFILE_COLUMNS)


def _save_profiles_table(table: pd.DataFrame) -> None:
    normalized = table.copy()
    if not normalized.empty:
        normalized["ticker"] = normalized["ticker"].map(normalize_ticker)
        normalized["storage_scope"] = normalized["storage_scope"].map(_normalize_profile_scope)
        normalized["tradingview_screener"] = normalized["tradingview_screener"].map(_normalize_tradingview_screener)
        normalized["tradingview_exchange"] = normalized["tradingview_exchange"].map(_normalize_tradingview_exchange)
        normalized = normalized.sort_values(["ticker", "updated_at"], ascending=[True, False])
        normalized = normalized.drop_duplicates(subset=["ticker"], keep="first")
    _write_parquet_table(PROFILES_PARQUET_PATH, normalized, _PROFILE_COLUMNS)


def load_profile_record(ticker: str) -> dict[str, str] | None:
    normalized_ticker = normalize_ticker(ticker)
    table = _load_profiles_table()
    if table.empty:
        return None
    matches = table.loc[table["ticker"] == normalized_ticker]
    if matches.empty:
        return None
    row = matches.iloc[0]
    return {
        "ticker": str(row.get("ticker") or normalized_ticker),
        "company_name": str(row.get("company_name") or "").strip(),
        "website": str(row.get("website") or "").strip() or None,
        "storage_scope": _normalize_profile_scope(str(row.get("storage_scope") or PROFILE_SCOPE_SEARCH)),
        "tradingview_screener": _normalize_tradingview_screener(str(row.get("tradingview_screener") or "")) or None,
        "tradingview_exchange": _normalize_tradingview_exchange(str(row.get("tradingview_exchange") or "")) or None,
        "updated_at": str(row.get("updated_at") or ""),
    }


def has_profile_record(ticker: str) -> bool:
    return load_profile_record(ticker) is not None


def upsert_profile_record(
        ticker: str,
        company_name: str,
        website: str | None,
        *,
        scope: str,
        tradingview_screener: str | None = None,
        tradingview_exchange: str | None = None,
        updated_at: str | None = None,
) -> dict[str, str]:
    normalized_ticker = normalize_ticker(ticker)
    incoming = {
        "ticker": normalized_ticker,
        "company_name": (company_name or normalized_ticker).strip(),
        "website": (website or "").strip(),
        "storage_scope": _normalize_profile_scope(scope),
        "tradingview_screener": _normalize_tradingview_screener(tradingview_screener),
        "tradingview_exchange": _normalize_tradingview_exchange(tradingview_exchange),
        "updated_at": updated_at or _utc_iso_timestamp(),
    }
    with _parquet_table_lock(PROFILES_PARQUET_PATH):
        table = _load_profiles_table()
        current = None
        if not table.empty:
            matches = table.loc[table["ticker"] == normalized_ticker]
            if not matches.empty:
                row = matches.iloc[0]
                current = {
                    "ticker": str(row.get("ticker") or normalized_ticker),
                    "company_name": str(row.get("company_name") or "").strip(),
                    "website": str(row.get("website") or "").strip() or None,
                    "storage_scope": _normalize_profile_scope(str(row.get("storage_scope") or PROFILE_SCOPE_SEARCH)),
                    "tradingview_screener": _normalize_tradingview_screener(str(row.get("tradingview_screener") or "")) or None,
                    "tradingview_exchange": _normalize_tradingview_exchange(str(row.get("tradingview_exchange") or "")) or None,
                    "updated_at": str(row.get("updated_at") or ""),
                }
        merged = incoming if current is None else _merge_profile_rows(current, incoming)
        filtered = table.loc[table["ticker"] != normalized_ticker].copy() if not table.empty else _empty_frame(_PROFILE_COLUMNS)
        filtered = pd.concat([filtered, pd.DataFrame([merged])], ignore_index=True)
        _save_profiles_table(filtered)
        return merged


def delete_profile_record(ticker: str) -> None:
    normalized_ticker = normalize_ticker(ticker)
    with _parquet_table_lock(PROFILES_PARQUET_PATH):
        table = _load_profiles_table()
        if table.empty:
            return
        filtered = table.loc[table["ticker"] != normalized_ticker].copy()
        _save_profiles_table(filtered)


def list_profile_tickers(scope: str | None = None) -> list[str]:
    table = _load_profiles_table()
    if table.empty:
        return []
    filtered = table
    if scope is not None:
        filtered = filtered.loc[filtered["storage_scope"] == _normalize_profile_scope(scope)]
    if filtered.empty:
        return []
    return sorted(str(value).upper() for value in filtered["ticker"].dropna().astype(str).tolist())


def _load_search_cache_table() -> pd.DataFrame:
    return _read_parquet_table(SEARCH_CACHE_PARQUET_PATH, _SEARCH_CACHE_COLUMNS)


def _save_search_cache_table(table: pd.DataFrame) -> None:
    normalized = table.copy()
    if not normalized.empty:
        normalized["query"] = normalized["query"].map(normalize_ticker)
        normalized["symbol"] = normalized["symbol"].map(normalize_ticker)
        normalized = normalized.sort_values(["query", "symbol", "updated_at"], ascending=[True, True, False])
        normalized = normalized.drop_duplicates(subset=["query", "symbol"], keep="first")
    _write_parquet_table(SEARCH_CACHE_PARQUET_PATH, normalized, _SEARCH_CACHE_COLUMNS)


def load_search_cache_items(query: str) -> list[dict[str, str]]:
    normalized_query = normalize_ticker(query)
    table = _load_search_cache_table()
    if table.empty:
        return []
    matches = table.loc[table["query"] == normalized_query].copy()
    if matches.empty:
        return []
    matches = matches.sort_values(["updated_at", "symbol"], ascending=[False, True])
    return [
        {
            "symbol": str(row.get("symbol") or "").upper(),
            "name": str(row.get("name") or "").strip(),
            "asset_type": str(row.get("asset_type") or "").strip(),
            "logo_url": str(row.get("logo_url") or "").strip(),
            "source": str(row.get("source") or "remote").strip() or "remote",
        }
        for _, row in matches.iterrows()
        if str(row.get("symbol") or "").strip()
    ]


def load_latest_search_cache_item_for_symbol(symbol: str) -> dict[str, str] | None:
    normalized_symbol = normalize_ticker(symbol)
    table = _load_search_cache_table()
    if table.empty:
        return None
    matches = table.loc[table["symbol"] == normalized_symbol].copy()
    if matches.empty:
        return None
    row = matches.sort_values("updated_at", ascending=False).iloc[0]
    return {
        "symbol": str(row.get("symbol") or "").upper(),
        "name": str(row.get("name") or "").strip(),
        "asset_type": str(row.get("asset_type") or "").strip(),
        "logo_url": str(row.get("logo_url") or "").strip(),
        "source": str(row.get("source") or "remote").strip() or "remote",
    }


def store_search_cache_items(query: str, items: list[dict[str, str]]) -> None:
    normalized_query = normalize_ticker(query)
    with _parquet_table_lock(SEARCH_CACHE_PARQUET_PATH):
        table = _load_search_cache_table()
        filtered = table.loc[table["query"] != normalized_query].copy() if not table.empty else _empty_frame(_SEARCH_CACHE_COLUMNS)
        rows: list[dict[str, str]] = []
        now = _utc_iso_timestamp()
        for item in items:
            symbol = normalize_ticker(str(item.get("symbol") or ""))
            if not symbol:
                continue
            rows.append(
                {
                    "query": normalized_query,
                    "symbol": symbol,
                    "name": str(item.get("name") or symbol).strip(),
                    "asset_type": str(item.get("asset_type") or "").strip(),
                    "logo_url": str(item.get("logo_url") or "").strip(),
                    "source": str(item.get("source") or "remote").strip() or "remote",
                    "updated_at": now,
                }
            )
        if rows:
            filtered = pd.concat([filtered, pd.DataFrame(rows)], ignore_index=True)
        _save_search_cache_table(filtered)


def remove_search_cache_entries_for_ticker(ticker: str) -> None:
    normalized_ticker = normalize_ticker(ticker)
    with _parquet_table_lock(SEARCH_CACHE_PARQUET_PATH):
        table = _load_search_cache_table()
        if table.empty:
            return
        filtered = table.loc[(table["symbol"] != normalized_ticker) & (table["query"] != normalized_ticker)].copy()
        _save_search_cache_table(filtered)


def list_local_tickers() -> list[str]:
    ensure_market_store_dir()
    tickers = set(list_historical_tickers())
    tickers.update(list_profile_tickers())
    return sorted(tickers)


def list_historical_tickers() -> list[str]:
    ensure_market_store_dir()
    # Best-effort cleanup of Longbridge-polluted "BAC.US.parquet" etc. to bare "BAC.parquet"
    # so the local market store page and canonical storage use the project default (no .US for US).
    for p in list(HISTORICAL_STORE_DIR.glob("*.US.parquet")):
        if p.is_file():
            bare = p.stem[:-3].rstrip(".") if p.stem.upper().endswith(".US") else p.stem
            target = HISTORICAL_STORE_DIR / f"{bare}.parquet"
            if not target.exists():
                try:
                    p.rename(target)
                except Exception:
                    pass
            else:
                try:
                    p.unlink()
                except Exception:
                    pass
    return sorted(
        ticker_from_store_path(path)
        for path in HISTORICAL_STORE_DIR.glob("*.parquet")
        if path.is_file()
        and path.stat().st_size > 0
        and _INTRADAY_STORE_SUFFIX_PATTERN.search(path.stem) is None
    )


def has_logo_asset(ticker: str) -> bool:
    return resolve_logo_store_path(ticker) is not None


def is_store_entry_fresh(path: Path) -> bool:
    if not path.exists():
        return False

    modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date()
    return modified_at >= datetime.now(timezone.utc).date()


STRATEGY_USAGE_STORE_PATH = SEARCH_STORE_DIR / "strategy_usage.json"


def load_ticker_usage_store() -> dict[str, dict[str, int | str]]:
    ensure_market_store_dir()
    if not TICKER_USAGE_STORE_PATH.exists():
        return {}
    try:
        return json.loads(TICKER_USAGE_STORE_PATH.read_text())
    except Exception:
        return {}


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


def load_strategy_usage_store() -> dict[str, dict[str, int | str]]:
    ensure_market_store_dir()
    if not STRATEGY_USAGE_STORE_PATH.exists():
        return {}
    try:
        return json.loads(STRATEGY_USAGE_STORE_PATH.read_text())
    except Exception:
        return {}


def record_strategy_usage(strategy_id: str) -> None:
    ensure_market_store_dir()
    payload = load_strategy_usage_store()
    now = datetime.now(timezone.utc).isoformat()
    current = payload.get(strategy_id, {"count": 0, "last_used_at": now})
    payload[strategy_id] = {
        "count": int(current.get("count", 0)) + 1,
        "last_used_at": now,
    }
    STRATEGY_USAGE_STORE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def top_used_strategies(limit: int = 3) -> list[str]:
    payload = load_strategy_usage_store()
    ranked: list[tuple[str, int, str]] = []
    for strategy_id, meta in payload.items():
        if strategy_id == "buy-and-hold":
            continue
        ranked.append(
            (
                strategy_id,
                int(meta.get("count", 0)),
                str(meta.get("last_used_at", "")),
            )
        )
    # Sort by last_used_at timestamp DESC, then by count DESC
    ranked.sort(
        key=lambda item: (
            -datetime.fromisoformat(item[2]).timestamp() if item[2] else 0.0,
            -item[1],
            item[0],
        )
    )
    return [strategy_id for strategy_id, _, _ in ranked[:limit]]


def clear_non_historical_market_cache() -> dict[str, int]:
    ensure_market_store_dir()
    protected_tickers = {normalize_ticker(ticker) for ticker in list_historical_tickers()}
    investment_settings = get_settings().get("investment", {})
    money_market_settings = (
        investment_settings.get("money_market_funds", {})
        if isinstance(investment_settings, dict) and isinstance(investment_settings.get("money_market_funds"), dict)
        else {}
    )
    protected_tickers.update(
        normalize_ticker(str(ticker))
        for ticker in money_market_settings.get("tickers", [])
        if str(ticker).strip()
    )
    protected_tickers.update(PINNED_LOGO_TICKERS)
    with _parquet_table_lock(PROFILES_PARQUET_PATH), _parquet_table_lock(SEARCH_CACHE_PARQUET_PATH):
        search_cache_table = _load_search_cache_table()
        kept_queries: set[str] = set()
        removed_search_queries = 0
        protected_search_queries = 0
        if not search_cache_table.empty:
            for query, group in search_cache_table.groupby("query", sort=True):
                normalized_query = normalize_ticker(str(query or ""))
                symbols = {normalize_ticker(symbol) for symbol in group["symbol"].dropna().astype(str).tolist()}
                if normalized_query in protected_tickers or bool(symbols & protected_tickers):
                    kept_queries.add(normalized_query)
                    protected_search_queries += 1
                else:
                    removed_search_queries += 1
            if kept_queries:
                filtered_search_cache = search_cache_table.loc[search_cache_table["query"].isin(kept_queries)].copy()
            else:
                filtered_search_cache = _empty_frame(_SEARCH_CACHE_COLUMNS)
        else:
            filtered_search_cache = search_cache_table
        _save_search_cache_table(filtered_search_cache)

        profiles_table = _load_profiles_table()
        removed_profiles = 0
        if not profiles_table.empty:
            keep_mask: pd.Series = (
                    (profiles_table["storage_scope"] == PROFILE_SCOPE_LOCAL)
                    | profiles_table["ticker"].isin(protected_tickers)
            )
            removed_profiles = int(len(profiles_table.index) - int(keep_mask.sum()))
            profiles_table = profiles_table.loc[keep_mask].copy()
            _save_profiles_table(profiles_table)

    retained_tickers = protected_tickers
    removed_logos = 0
    for path in LOGOS_STORE_DIR.glob("*.png"):
        if not path.is_file() or normalize_ticker(path.stem) in retained_tickers:
            continue
        path.unlink()
        removed_logos += 1

    return {
        "removed_search_queries": removed_search_queries,
        "removed_profiles": removed_profiles,
        "removed_logos": removed_logos,
        "protected_search_queries": protected_search_queries,
        "protected_tickers": len(protected_tickers),
    }


def delete_ticker_data(ticker: str) -> None:
    ensure_market_store_dir()
    normalized_ticker = normalize_ticker(ticker)
    history_path = history_store_path_for(normalized_ticker)
    with market_store_file_lock(history_path):
        if history_path.exists():
            history_path.unlink()

    intraday_history_path = intraday_history_store_path_for(normalized_ticker, "1m")
    with market_store_file_lock(intraday_history_path):
        if intraday_history_path.exists():
            intraday_history_path.unlink()

    delete_profile_record(normalized_ticker)
    remove_search_cache_entries_for_ticker(normalized_ticker)

    logo_path = logo_store_path_for(normalized_ticker)
    if logo_path.exists() and not is_pinned_logo_ticker(normalized_ticker):
        logo_path.unlink()

    legacy_search_json = SEARCH_STORE_DIR / f"{normalized_ticker}.json"
    if legacy_search_json.exists():
        legacy_search_json.unlink()
