"""
Logo and quote profile services.

Code version: v0.6.0
"""

from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import io
import logging
import re
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from curl_cffi.curl import CurlError
from curl_cffi.requests.exceptions import RequestException
import yfinance as yf
from flask import url_for

from app.infrastructure.connectivity import has_remote_logo_access, has_remote_market_access
from app.infrastructure.runtime_network import (
    add_yahoo_tls_configuration_hint,
    get_yfinance_session,
)
from app.models.schemas import QuoteProfile
from app.infrastructure.storage import (
    PROFILE_SCOPE_LOCAL,
    PROFILE_SCOPE_SEARCH,
    ensure_market_store_dir,
    has_logo_asset,
    has_profile_record,
    history_store_path_for,
    investment_ticker_store_aliases,
    is_ticker_fallback_company_name,
    is_pinned_logo_ticker,
    list_local_tickers,
    resolve_known_ticker_company_name,
    load_profile_record,
    load_search_cache_items,
    LOGOS_STORE_DIR,
    logo_store_path_for,
    normalize_ticker,
    resolve_logo_store_path,
    store_search_cache_items,
    top_used_tickers,
    upsert_profile_record,
)

TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
VALID_QUOTE_TYPES = {"EQUITY", "ETF"}
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "CXI"}
SUPPORTED_MARKET_SUFFIXES = {
    "AS", "AX", "BA", "BE", "BK", "BO", "BR", "CA", "CN", "CO", "DE", "DU", "F", "HA",
    "HE", "HK", "HM", "IR", "IS", "JK", "JP", "KL", "KQ", "KS", "L", "MC", "MI",
    "MX", "NE", "NS", "NZ", "OL", "PA", "QA", "SA", "SE", "SG", "SH", "SI", "SR",
    "SS", "ST", "SW", "SZ", "TA", "T", "TO", "TWO", "TW", "V", "VI",
}
SUPPORTED_MARKET_EXCHANGES = US_EXCHANGES | {"HKG", "LSE"}
LOGGER = logging.getLogger(__name__)
YFINANCE_LOOKUP_LOCK = Lock()
NETWORK_URL_USERINFO_PATTERN = re.compile(r"(?i)(https?://)[^/@\s]+@")
NETWORK_SECRET_QUERY_PATTERN = re.compile(
    r"(?i)([?&](?:crumb|token|key|secret|password)=)[^&\s]+"
)

TICKER_WEBSITE_OVERRIDES = {
    "QQQ": "https://www.invesco.com",
    "JEPQ": "https://www.jpmorganchase.com",
    "DRAM": "https://www.roundhillinvestments.com/etf/dram/",
    "RAM": "https://www.roundhillinvestments.com/etf/ram/",
    "SKHY": "https://www.skhynix.com",
    "SKHYV": "https://www.skhynix.com",
}

CURATED_LOGO_SVG_URLS = {
    "AVGO": "https://companieslogo.com/img/orig/AVGO-77e10dd3.svg?t=1722952492&download=true",
    "JPM": "https://companieslogo.com/img/orig/JPM-4f761fcf.svg?t=1720244492&download=true",
    "MS": "https://companieslogo.com/img/orig/MS-0e9b40c7.svg?t=1720244493&download=true",
    "MU": "https://companieslogo.com/img/orig/MU-2e3ad6fe.svg?t=1740419775&download=true",
    "QQQ": "https://companieslogo.com/img/orig/invesco-qqq-82548dba.svg?t=1720244494&download=true",
}

ISSUER_WEBSITE_HINTS = {
    "INVESCO": "https://www.invesco.com",
    "JPMORGAN": "https://www.jpmorganchase.com",
    "JP MORGAN": "https://www.jpmorganchase.com",
    "ISHARES": "https://www.ishares.com",
    "ROUNDHILL": "https://www.roundhillinvestments.com",
    "VANGUARD": "https://investor.vanguard.com",
    "SCHWAB": "https://www.schwabassetmanagement.com",
    "SPDR": "https://www.ssga.com",
}

STORED_LOGO_ALIASES = {
    "SKHY": ("000660.KS",),
    "SKHYV": ("000660.KS",),
}


def _run_yfinance_silently(callback):
    stderr_buffer = io.StringIO()
    stdout_buffer = io.StringIO()
    with YFINANCE_LOOKUP_LOCK:
        with contextlib.redirect_stderr(stderr_buffer), contextlib.redirect_stdout(stdout_buffer):
            return callback()


def _yfinance_failure_diagnostic(value: object) -> str:
    diagnostic = " ".join(str(value or "").split())
    diagnostic = NETWORK_URL_USERINFO_PATTERN.sub(r"\1REDACTED@", diagnostic)
    diagnostic = NETWORK_SECRET_QUERY_PATTERN.sub(r"\1REDACTED", diagnostic)
    return add_yahoo_tls_configuration_hint(diagnostic)


def _search_yfinance_quotes(query: str) -> list[dict[str, object]]:
    search = _run_yfinance_silently(lambda: yf.Search(
        query,
        max_results=20,
        news_count=0,
        lists_count=0,
        recommended=0,
        raise_errors=False,
        session=get_yfinance_session(),
    ))
    quotes = getattr(search, "quotes", [])
    return quotes if isinstance(quotes, list) else []


def _load_yfinance_ticker_info(ticker: str) -> dict[str, object]:
    info = _run_yfinance_silently(
        lambda: yf.Ticker(ticker, session=get_yfinance_session()).info
    )
    return info if isinstance(info, dict) else {}


def build_market_store_logo_url(filename: str, modified_at_ns: int | None = None) -> str:
    if modified_at_ns is None:
        for stem in (
            filename.removesuffix(".png"),
            filename.removesuffix(".svg"),
            filename,
        ):
            logo_path = resolve_logo_store_path(stem)
            if logo_path is not None:
                modified_at_ns = logo_path.stat().st_mtime_ns
                filename = logo_path.name
                break
    if modified_at_ns is None:
        return url_for("market_store_logo", filename=filename)
    return url_for("market_store_logo", filename=filename, v=modified_at_ns)


def resolve_stored_logo_url(ticker: str) -> str:
    normalized_ticker = normalize_ticker(ticker)
    candidates = [
        *investment_ticker_store_aliases(normalized_ticker),
        *STORED_LOGO_ALIASES.get(normalized_ticker, ()),
    ]
    for candidate in dict.fromkeys(candidates):
        logo_path = resolve_logo_store_path(candidate)
        if logo_path is not None:
            return build_market_store_logo_url(logo_path.name, logo_path.stat().st_mtime_ns)
    return ""


def normalize_ticker_input(raw_ticker: str) -> str:
    return normalize_ticker(raw_ticker)


def has_valid_ticker_format(ticker: str) -> bool:
    return bool(TICKER_PATTERN.fullmatch(ticker))


def _record_is_fresh(updated_at: str | None) -> bool:
    if not updated_at:
        return False
    try:
        timestamp = datetime.fromisoformat(updated_at)
    except ValueError:
        return False
    return timestamp.astimezone(timezone.utc).date() >= datetime.now(timezone.utc).date()


def is_known_ticker(ticker: str) -> bool:
    normalized_ticker = normalize_ticker_input(ticker)
    if not has_valid_ticker_format(normalized_ticker):
        return False
    if history_store_path_for(normalized_ticker).exists() or has_profile_record(normalized_ticker):
        return True
    if not has_remote_market_access():
        return False

    try:
        results = _search_yfinance_quotes(normalized_ticker)
        for item in results:
            symbol = str(item.get("symbol", "")).upper()
            quote_type = str(item.get("quoteType", "")).upper()
            if symbol == normalized_ticker and quote_type in VALID_QUOTE_TYPES:
                return True
    except (RequestException, CurlError, TimeoutError, ConnectionError) as exc:
        LOGGER.warning(
            "Ticker search validation failed for %s: %s",
            normalized_ticker,
            _yfinance_failure_diagnostic(exc),
        )

    try:
        info = _load_yfinance_ticker_info(normalized_ticker)
    except Exception as exc:
        LOGGER.warning(
            "Ticker info validation failed for %s: %s",
            normalized_ticker,
            _yfinance_failure_diagnostic(exc),
        )
        return False

    quote_type = str(info.get("quoteType", "")).upper()
    if quote_type in VALID_QUOTE_TYPES:
        return True
    return bool(info.get("longName") or info.get("shortName") or info.get("symbol"))


def normalize_search_text(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _numeric_symbol_head(value: str) -> str:
    normalized_value = str(value or "").strip().upper()
    symbol_head = normalized_value.split(".", 1)[0]
    if not symbol_head.isdigit():
        return ""
    return symbol_head.lstrip("0") or "0"


def display_search_symbol(symbol: str) -> str:
    normalized_symbol = normalize_ticker_input(symbol)
    if "." not in normalized_symbol:
        return normalized_symbol
    symbol_head, suffix = normalized_symbol.rsplit(".", 1)
    if suffix == "HK" and symbol_head.isdigit() and len(symbol_head) <= 4:
        return f"{symbol_head.zfill(4)}.{suffix}"
    if suffix == "KS" and symbol_head.isdigit() and len(symbol_head) <= 6:
        return f"{symbol_head.zfill(6)}.{suffix}"
    return normalized_symbol


def ticker_search_aliases(query: str) -> list[str]:
    normalized_query = normalize_ticker_input(query)
    if not normalized_query:
        return []

    aliases: list[str] = []

    def add_alias(value: str) -> None:
        alias = display_search_symbol(value)
        if alias and alias not in aliases:
            aliases.append(alias)

    add_alias(normalized_query)

    if "." in normalized_query:
        symbol_head, suffix = normalized_query.rsplit(".", 1)
        if symbol_head.isdigit() and suffix == "HK" and len(symbol_head) <= 4:
            add_alias(f"{symbol_head.zfill(4)}.HK")
        if symbol_head.isdigit() and suffix == "KS" and len(symbol_head) <= 6:
            add_alias(f"{symbol_head.zfill(6)}.KS")
        return aliases

    if normalized_query.isdigit():
        stripped_query = normalized_query.lstrip("0") or "0"
        if len(stripped_query) <= 4:
            add_alias(f"{stripped_query.zfill(4)}.HK")
        if len(stripped_query) <= 6:
            add_alias(f"{stripped_query.zfill(6)}.KS")
    return aliases


def search_text_matches(query: str, symbol: str, company_name: str) -> bool:
    normalized_query = normalize_search_text(query)
    normalized_symbol = normalize_search_text(symbol)
    normalized_name = normalize_search_text(company_name)
    if not normalized_query:
        return True
    numeric_query = _numeric_symbol_head(query)
    numeric_symbol = _numeric_symbol_head(symbol)
    if numeric_query and numeric_symbol.startswith(numeric_query):
        return True
    if normalized_symbol.startswith(normalized_query):
        return True
    if len(normalized_query) <= 1:
        return False
    if normalized_query in normalized_name:
        return True
    return False


def remote_search_query(raw_query: str, normalized_query: str) -> str:
    raw_symbol = str(raw_query or "").strip().upper()
    if raw_symbol.endswith(".US"):
        return normalized_query
    if "." in raw_symbol:
        return raw_symbol
    return normalized_query


def _supported_symbol_suffix(symbol: str) -> str:
    normalized_symbol = normalize_ticker_input(symbol)
    if "." not in normalized_symbol:
        return ""
    head, tail = normalized_symbol.rsplit(".", 1)
    if not head:
        return ""
    if tail in {"A", "B", "C"}:
        return tail
    return tail if tail in SUPPORTED_MARKET_SUFFIXES else ""


def is_supported_search_result(item: dict[str, object], query: str) -> bool:
    symbol = normalize_ticker_input(str(item.get("symbol", "")).upper())
    quote_type = str(item.get("quoteType", "")).upper()
    exchange = str(item.get("exchange", "")).upper()
    company_name = str(item.get("longname") or item.get("shortname") or symbol)
    suffix = _supported_symbol_suffix(symbol)
    is_market_suffix = suffix in SUPPORTED_MARKET_SUFFIXES
    is_us_share_class = suffix in {"A", "B", "C"}

    if not search_text_matches(query, symbol, company_name):
        return False
    if quote_type not in VALID_QUOTE_TYPES:
        return False
    if exchange not in SUPPORTED_MARKET_EXCHANGES and not is_market_suffix:
        return False
    if is_us_share_class and exchange not in US_EXCHANGES:
        return False
    if "=" in symbol:
        return False
    if len(symbol) > 5 and symbol[-15:].isdigit():
        return False
    if "." in symbol:
        head, tail = symbol.split(".", 1)
        if not head or tail not in ({"A", "B", "C"} | SUPPORTED_MARKET_SUFFIXES):
            return False
    return True


def is_supported_local_symbol(symbol: str, query: str, company_name: str | None = None) -> bool:
    normalized_symbol = normalize_ticker_input(symbol)
    display_name = company_name or normalized_symbol
    if not search_text_matches(query, normalized_symbol, display_name):
        return False
    if "=" in normalized_symbol:
        return False
    if "." in normalized_symbol:
        head, tail = normalized_symbol.split(".", 1)
        if not head or tail not in ({"A", "B", "C"} | SUPPORTED_MARKET_SUFFIXES):
            return False
        if tail == "HK" and re.fullmatch(r"\d{1,5}", head):
            return True
        if tail == "KS" and re.fullmatch(r"\d{1,6}", head):
            return True
        return len(head) <= 8
    plain_length = len(normalized_symbol.replace(".", ""))
    return plain_length <= 5


def search_result_sort_key(item: dict[str, str], query: str) -> tuple[int, int, int, int, str]:
    symbol = item["symbol"]
    company_name = item.get("name", symbol)
    normalized_query = normalize_search_text(query)
    normalized_symbol = normalize_search_text(symbol)
    normalized_name = normalize_search_text(company_name)
    numeric_query = _numeric_symbol_head(query)
    numeric_symbol = _numeric_symbol_head(symbol)
    is_numeric_exact = bool(numeric_query and numeric_symbol == numeric_query)
    is_symbol_exact = 0 if normalized_symbol == normalized_query or is_numeric_exact else 1
    is_symbol_prefix = 0 if normalized_symbol.startswith(normalized_query) else 1
    if numeric_query and numeric_symbol.startswith(numeric_query):
        is_symbol_prefix = 0
    is_name_match = 0 if normalized_query and normalized_query in normalized_name else 1
    is_etf = 1 if item.get("asset_type") == "ETF" else 0
    return is_symbol_exact, is_symbol_prefix, is_name_match, is_etf, symbol


def should_cache_search_results(query: str, items: list[dict[str, str]]) -> bool:
    normalized_query = normalize_ticker_input(query)
    if not has_valid_ticker_format(normalized_query):
        return False
    if not any(item.get("symbol", "").upper() == normalized_query for item in items):
        return False
    return is_known_ticker(normalized_query)


def resolve_website(ticker: str, company_name: str, website: str | None) -> str | None:
    if website:
        return website
    if ticker.upper() in TICKER_WEBSITE_OVERRIDES:
        return TICKER_WEBSITE_OVERRIDES[ticker.upper()]
    company_name_upper = company_name.upper()
    for issuer_hint, issuer_website in ISSUER_WEBSITE_HINTS.items():
        if issuer_hint in company_name_upper:
            return issuer_website
    return None


def quote_lookup_symbol(ticker: str) -> str:
    normalized_ticker = normalize_ticker_input(ticker)
    if normalized_ticker.endswith(".SH"):
        symbol, _ = normalized_ticker.rsplit(".", 1)
        return f"{symbol}.SS"
    if normalized_ticker.endswith(".US"):
        bare_ticker = normalized_ticker[:-3].strip()
        return bare_ticker or normalized_ticker
    return normalized_ticker


def build_quote_profile_payload(ticker: str) -> dict[str, str | None]:
    normalized_ticker = normalize_ticker_input(ticker)
    lookup_symbol = quote_lookup_symbol(normalized_ticker)
    try:
        info = _load_yfinance_ticker_info(lookup_symbol)
    except Exception as exc:
        LOGGER.warning(
            "Quote profile remote lookup failed for %s: %s",
            lookup_symbol,
            _yfinance_failure_diagnostic(exc),
        )
        info = {}
    company_name = (
            info.get("longName")
            or info.get("shortName")
            or resolve_known_ticker_company_name(normalized_ticker)
            or normalized_ticker
    )
    website = resolve_website(normalized_ticker, company_name, info.get("website"))
    return {
        "ticker": normalized_ticker,
        "company_name": company_name,
        "website": website,
    }


def extract_domain(website: str | None) -> str | None:
    if not website:
        return None
    parsed = urlparse(website if "://" in website else f"https://{website}")
    domain = parsed.netloc.lower().removeprefix("www.")
    return domain or None


def build_logo_provider_ticker_candidates(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker_input(ticker)
    if not normalized_ticker:
        return []

    candidates: list[str] = []

    def add_candidate(value: str) -> None:
        candidate = str(value or "").strip().upper()
        if not candidate or candidate in candidates:
            return
        candidates.append(candidate)

    add_candidate(normalized_ticker)
    compacted = re.sub(r"\s+", " ", normalized_ticker)
    add_candidate(compacted.replace("-", "."))
    add_candidate(compacted.replace("-", " "))
    add_candidate(compacted.replace(" ", "-"))
    add_candidate(compacted.replace(" ", "."))
    add_candidate(compacted.replace("/", "-"))
    add_candidate(compacted.replace("/", "."))
    add_candidate(compacted.replace("/", " "))
    return candidates


def fetch_remote_logo_bytes(ticker: str, domain: str | None = None) -> bytes | None:
    providers = [
        f"https://eodhd.com/img/logos/US/{provider_ticker}.png"
        for provider_ticker in build_logo_provider_ticker_candidates(ticker)
    ]
    if domain:
        providers.extend([
            f"https://www.google.com/s2/favicons?{urlencode({'sz': 128, 'domain_url': domain})}",
            f"https://icon.horse/icon/{domain}",
        ])
    for remote_url in providers:
        request_obj = Request(remote_url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urlopen(request_obj, timeout=20) as response:
                content_type = response.headers.get_content_type()
                if content_type not in {"image/png", "image/x-icon", "image/vnd.microsoft.icon"}:
                    continue
                return response.read()
        except (HTTPError, URLError, TimeoutError, ValueError, Exception):
            continue
    return None


def fetch_curated_logo_svg_bytes(ticker: str) -> bytes | None:
    source_url = CURATED_LOGO_SVG_URLS.get(normalize_ticker_input(ticker))
    if not source_url:
        return None
    request_obj = Request(source_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request_obj, timeout=20) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"image/svg+xml", "application/octet-stream", "text/plain"}:
                return None
            payload = response.read()
    except (HTTPError, URLError, TimeoutError, ValueError, Exception):
        return None
    return payload if b"<svg" in payload[:512] else None


def refresh_logo_store(
        ticker: str,
        website: str | None,
        force_refresh: bool = False,
) -> None:
    ensure_market_store_dir()
    path = logo_store_path_for(ticker)
    if is_pinned_logo_ticker(ticker) and path.exists():
        return
    if path.exists() and not force_refresh:
        return
    curated_logo_bytes = fetch_curated_logo_svg_bytes(ticker)
    if curated_logo_bytes is not None:
        curated_path = LOGOS_STORE_DIR / f"{normalize_ticker_input(ticker)}.svg"
        curated_path.write_bytes(curated_logo_bytes)
        return

    if not has_remote_market_access() and not has_remote_logo_access():
        return

    domain = extract_domain(website)
    logo_bytes = fetch_remote_logo_bytes(ticker, domain)
    if logo_bytes is not None:
        path.write_bytes(logo_bytes)


def fetch_and_store_logo(
        ticker: str,
        website: str | None,
        force_refresh: bool = False,
) -> str | None:
    ensure_market_store_dir()
    existing_logo = resolve_stored_logo_url(ticker)
    if existing_logo and not force_refresh:
        return existing_logo
    refresh_logo_store(ticker, website, force_refresh=force_refresh)
    return resolve_stored_logo_url(ticker) or None


def resolve_logo_url_with_fallback(
        ticker: str,
        website: str | None,
        force_refresh: bool = False,
) -> str | None:
    return fetch_and_store_logo(ticker, website, force_refresh=force_refresh)


def _fetch_quote_profile_for_scope(
        ticker: str,
        force_refresh: bool = False,
        *,
        scope: str = PROFILE_SCOPE_LOCAL,
) -> QuoteProfile:
    ensure_market_store_dir()
    normalized_ticker = normalize_ticker_input(ticker)
    record = load_profile_record(normalized_ticker)
    known_company_name = resolve_known_ticker_company_name(normalized_ticker)

    record_company_name = str((record or {}).get("company_name") or "").strip()
    ticker_name_fallback = record_company_name.upper() == normalized_ticker if record_company_name else False

    if not force_refresh and known_company_name and (not record or ticker_name_fallback):
        website = resolve_website(
            normalized_ticker,
            known_company_name,
            (record or {}).get("website"),
        )
        return QuoteProfile(
            ticker=normalized_ticker,
            company_name=known_company_name,
            website=website,
            logo_url=resolve_logo_url_with_fallback(
                normalized_ticker,
                website,
                force_refresh=False,
            ),
        )

    if record and (
            (not force_refresh and _record_is_fresh(record.get("updated_at")))
            or (not force_refresh and not ticker_name_fallback)
            or not has_remote_market_access()
    ):
        return QuoteProfile(
            ticker=record["ticker"],
            company_name=record.get("company_name") or normalized_ticker,
            website=record.get("website"),
            logo_url=resolve_logo_url_with_fallback(
                record["ticker"],
                record.get("website"),
                force_refresh=False,
            ),
        )

    if not has_remote_market_access():
        existing_logo = resolve_logo_url_with_fallback(normalized_ticker, record.get("website") if record else None)
        return QuoteProfile(
            ticker=normalized_ticker,
            company_name=(record or {}).get("company_name") or normalized_ticker,
            website=(record or {}).get("website"),
            logo_url=existing_logo,
        )

    payload = build_quote_profile_payload(normalized_ticker)
    stored = upsert_profile_record(
        payload["ticker"],
        str(payload.get("company_name") or payload["ticker"]),
        payload.get("website"),
        scope=scope,
    )
    return QuoteProfile(
        ticker=stored["ticker"],
        company_name=stored.get("company_name") or stored["ticker"],
        website=stored.get("website"),
        logo_url=resolve_logo_url_with_fallback(
            stored["ticker"],
            stored.get("website"),
            force_refresh=force_refresh,
        ),
    )


def fetch_quote_profile(
        ticker: str,
        force_refresh: bool = False,
) -> QuoteProfile:
    return _fetch_quote_profile_for_scope(ticker, force_refresh, scope=PROFILE_SCOPE_LOCAL)


def refresh_quote_profile_cache(
        ticker: str,
        force_refresh: bool = False,
) -> bool:
    ensure_market_store_dir()
    if not has_remote_market_access():
        return False

    try:
        payload = build_quote_profile_payload(ticker)
        upsert_profile_record(
            payload["ticker"],
            str(payload.get("company_name") or payload["ticker"]),
            payload.get("website"),
            scope=PROFILE_SCOPE_LOCAL,
        )
        refresh_logo_store(
            payload["ticker"],
            payload.get("website"),
            force_refresh=force_refresh,
        )
    except Exception as exc:
        LOGGER.warning("Quote profile cache refresh failed for %s: %s", ticker, exc)
        return False
    return True


def _build_recent_suggestion(symbol: str) -> dict[str, str]:
    profile = fetch_quote_profile(symbol, force_refresh=False)
    display_symbol = display_search_symbol(symbol)
    return {
        "symbol": display_symbol,
        "name": profile.company_name or display_symbol,
        "logo_url": profile.logo_url or "",
        "source": "recent",
    }


def _build_local_suggestion(symbol: str, *, query: str, seen: set[str]) -> dict[str, str] | None:
    normalized_symbol = normalize_ticker_input(symbol)
    if not normalized_symbol:
        return None
    canonical_symbol = normalize_ticker_input(normalized_symbol)
    if canonical_symbol in seen:
        return None
    if not (
            history_store_path_for(normalized_symbol).exists()
            or has_profile_record(normalized_symbol)
            or has_logo_asset(normalized_symbol)
    ):
        return None
    profile_record = load_profile_record(normalized_symbol)
    display_symbol = display_search_symbol(normalized_symbol)
    record_company_name = str((profile_record or {}).get("company_name") or "").strip()
    known_company_name = resolve_known_ticker_company_name(normalized_symbol)
    company_name = (
            known_company_name
            if is_ticker_fallback_company_name(record_company_name, normalized_symbol)
            else record_company_name
    ) or (
            known_company_name
            or display_symbol
    )
    if not is_supported_local_symbol(normalized_symbol, query, company_name):
        return None
    seen.add(canonical_symbol)
    logo_url = resolve_stored_logo_url(normalized_symbol) if has_logo_asset(normalized_symbol) else ""
    return {
        "symbol": display_symbol,
        "name": company_name,
        "logo_url": logo_url,
        "source": "local",
    }


def build_local_alias_search_items(query: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for symbol in ticker_search_aliases(query):
        item = _build_local_suggestion(symbol, query=query, seen=seen)
        if item is not None:
            items.append(item)
    return sorted(items, key=lambda search_item: search_result_sort_key(search_item, query))


def build_local_search_items(query: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for symbol in list_local_tickers():
        if normalize_ticker_input(symbol) in seen or not history_store_path_for(symbol).exists():
            continue
        item = _build_local_suggestion(symbol, query=query, seen=seen)
        if item is None:
            continue
        items.append(item)
    return sorted(items, key=lambda search_item: search_result_sort_key(search_item, query))


def combine_unique_search_items(
        *item_groups: list[dict[str, str]],
        limit: int,
) -> list[dict[str, str]]:
    combined: list[dict[str, str]] = []
    seen: set[str] = set()
    for item_group in item_groups:
        for search_item in item_group:
            symbol = search_item["symbol"]
            unique_symbol = normalize_ticker_input(symbol)
            if unique_symbol in seen:
                continue
            seen.add(unique_symbol)
            combined.append(search_item)
            if len(combined) >= limit:
                return combined
    return combined


def search_tickers(query: str, limit: int = 5) -> list[dict[str, str]]:
    ensure_market_store_dir()
    normalized_query = normalize_ticker_input(query)
    recent_symbols = top_used_tickers(normalized_query, limit=limit)
    recent_items = [_build_recent_suggestion(symbol) for symbol in recent_symbols]
    alias_items = build_local_alias_search_items(normalized_query) if normalized_query else []
    local_items = build_local_search_items(normalized_query) if normalized_query else []

    if len(normalized_query) < 1:
        return combine_unique_search_items(recent_items, local_items, limit=limit)

    if len(normalized_query) == 1 and (alias_items or local_items):
        return combine_unique_search_items(alias_items, recent_items, local_items, limit=limit)

    if any(
            normalize_ticker_input(str(item.get("symbol") or "")) == normalize_ticker_input(alias)
            for item in alias_items + local_items
            for alias in ticker_search_aliases(normalized_query)
    ):
        prioritized_local_items = sorted(
            alias_items + local_items,
            key=lambda local_item: search_result_sort_key(local_item, normalized_query),
        )
        return combine_unique_search_items(prioritized_local_items, recent_items, limit=limit)

    cached_items = load_search_cache_items(normalized_query)
    local_search_items = combine_unique_search_items(alias_items, local_items, limit=limit)
    if len(local_search_items) >= limit:
        remote_items = []
    elif cached_items and all("logo_url" in item for item in cached_items):
        remote_items = [
            item for item in cached_items
            if is_supported_local_symbol(item.get("symbol", ""), normalized_query)
        ]
    elif not has_remote_market_access():
        remote_items = []
    else:
        try:
            results = _search_yfinance_quotes(remote_search_query(query, normalized_query))
        except (RequestException, CurlError, TimeoutError, ConnectionError) as exc:
            LOGGER.warning(
                "Ticker search remote lookup failed for %s: %s",
                normalized_query,
                _yfinance_failure_diagnostic(exc),
            )
            results = []

        filtered: list[dict[str, str]] = []
        for item in results:
            symbol = normalize_ticker_input(str(item.get("symbol", "")).upper())
            quote_type = str(item.get("quoteType", "")).upper()
            if not is_supported_search_result(item, normalized_query):
                continue
            website = item.get("website") or item.get("webSite")
            logo_url = fetch_and_store_logo(symbol, website)
            if not logo_url:
                profile = _fetch_quote_profile_for_scope(symbol, force_refresh=False, scope=PROFILE_SCOPE_SEARCH)
                logo_url = profile.logo_url
            filtered.append(
                {
                    "symbol": symbol,
                    "name": item.get("longname") or item.get("shortname") or symbol,
                    "asset_type": quote_type,
                    "logo_url": logo_url or "",
                    "source": "remote",
                }
            )

        deduplicated_remote = {item["symbol"]: item for item in filtered}
        remote_items = sorted(
            deduplicated_remote.values(),
            key=lambda remote_item: search_result_sort_key(remote_item, normalized_query),
        )
        if should_cache_search_results(normalized_query, remote_items):
            store_search_cache_items(normalized_query, remote_items)

    if not remote_items and not has_remote_market_access():
        remote_items = []

    return combine_unique_search_items(alias_items, recent_items, local_items, remote_items, limit=limit)
