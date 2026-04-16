"""
Logo and quote profile services.

Code version: v0.3.2
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from curl_cffi.curl import CurlError
from curl_cffi.requests.exceptions import RequestException
import yfinance as yf
from flask import url_for

from app.infrastructure.connectivity import has_remote_logo_access, has_remote_market_access
from app.models.schemas import QuoteProfile
from app.infrastructure.storage import (
    PROFILE_SCOPE_LOCAL,
    PROFILE_SCOPE_SEARCH,
    ensure_market_store_dir,
    has_logo_asset,
    has_profile_record,
    history_store_path_for,
    list_local_tickers,
    load_profile_record,
    load_search_cache_items,
    logo_store_path_for,
    normalize_ticker,
    store_search_cache_items,
    top_used_tickers,
    upsert_profile_record,
)

TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
VALID_QUOTE_TYPES = {"EQUITY", "ETF"}
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "CXI"}
LOGGER = logging.getLogger(__name__)

TICKER_WEBSITE_OVERRIDES = {
    "QQQ": "https://www.invesco.com",
    "JEPQ": "https://www.jpmorganchase.com",
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


def build_market_store_logo_url(filename: str, modified_at_ns: int | None = None) -> str:
    if modified_at_ns is None:
        logo_path = logo_store_path_for(filename.removesuffix(".png"))
        if logo_path.exists():
            modified_at_ns = logo_path.stat().st_mtime_ns
    if modified_at_ns is None:
        return url_for("market_store_logo", filename=filename)
    return url_for("market_store_logo", filename=filename, v=modified_at_ns)


def resolve_stored_logo_url(ticker: str) -> str:
    normalized_ticker = normalize_ticker_input(ticker)
    logo_path = logo_store_path_for(normalized_ticker)
    if not logo_path.exists():
        return ""
    return build_market_store_logo_url(logo_path.name, logo_path.stat().st_mtime_ns)


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
        results = yf.Search(
            normalized_ticker,
            max_results=20,
            news_count=0,
            lists_count=0,
            recommended=0,
            raise_errors=False,
        ).quotes
        for item in results:
            symbol = str(item.get("symbol", "")).upper()
            quote_type = str(item.get("quoteType", "")).upper()
            if symbol == normalized_ticker and quote_type in VALID_QUOTE_TYPES:
                return True
    except (RequestException, CurlError, TimeoutError, ConnectionError) as exc:
        LOGGER.warning("Ticker search validation failed for %s: %s", normalized_ticker, exc)

    try:
        info = yf.Ticker(normalized_ticker).info
    except Exception as exc:
        LOGGER.warning("Ticker info validation failed for %s: %s", normalized_ticker, exc)
        return False

    quote_type = str(info.get("quoteType", "")).upper()
    if quote_type in VALID_QUOTE_TYPES:
        return True
    return bool(info.get("longName") or info.get("shortName") or info.get("symbol"))


def normalize_search_text(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def search_text_matches(query: str, symbol: str, company_name: str) -> bool:
    normalized_query = normalize_search_text(query)
    normalized_symbol = normalize_search_text(symbol)
    normalized_name = normalize_search_text(company_name)
    if not normalized_query:
        return True
    if normalized_symbol.startswith(normalized_query):
        return True
    if len(normalized_query) <= 1:
        return False
    if normalized_query in normalized_name:
        return True
    return False


def is_supported_search_result(item: dict[str, object], query: str) -> bool:
    symbol = str(item.get("symbol", "")).upper()
    quote_type = str(item.get("quoteType", "")).upper()
    exchange = str(item.get("exchange", "")).upper()
    company_name = str(item.get("longname") or item.get("shortname") or symbol)

    if not search_text_matches(query, symbol, company_name):
        return False
    if quote_type not in VALID_QUOTE_TYPES:
        return False
    if exchange not in US_EXCHANGES:
        return False
    if "=" in symbol:
        return False
    if len(symbol) > 5 and symbol[-15:].isdigit():
        return False
    if "." in symbol:
        head, tail = symbol.split(".", 1)
        if not head or tail not in {"A", "B", "C"}:
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
        if not head or tail not in {"A", "B", "C"}:
            return False
    plain_length = len(normalized_symbol.replace(".", ""))
    return plain_length <= 5


def search_result_sort_key(item: dict[str, str], query: str) -> tuple[int, int, int, int, str]:
    symbol = item["symbol"]
    company_name = item.get("name", symbol)
    normalized_query = normalize_search_text(query)
    normalized_symbol = normalize_search_text(symbol)
    normalized_name = normalize_search_text(company_name)
    is_symbol_exact = 0 if normalized_symbol == normalized_query else 1
    is_symbol_prefix = 0 if normalized_symbol.startswith(normalized_query) else 1
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


def build_quote_profile_payload(ticker: str) -> dict[str, str | None]:
    try:
        info = yf.Ticker(ticker).info
    except Exception as exc:
        LOGGER.warning("Quote profile remote lookup failed for %s: %s", ticker, exc)
        info = {}
    company_name = info.get("longName") or info.get("shortName") or ticker.upper()
    website = resolve_website(ticker, company_name, info.get("website"))
    return {
        "ticker": ticker.upper(),
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


def refresh_logo_store(
        ticker: str,
        website: str | None,
        force_refresh: bool = False,
) -> None:
    ensure_market_store_dir()
    path = logo_store_path_for(ticker)
    if path.exists() and not force_refresh:
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
    path = logo_store_path_for(ticker)
    refresh_logo_store(ticker, website, force_refresh=force_refresh)
    if not path.exists():
        return None
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

    if record and (_record_is_fresh(record.get("updated_at")) or not has_remote_market_access() or not force_refresh):
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
    return {
        "symbol": symbol,
        "name": profile.company_name or symbol,
        "logo_url": profile.logo_url or "",
        "source": "recent",
    }


def build_local_search_items(query: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for symbol in list_local_tickers():
        if symbol in seen or not history_store_path_for(symbol).exists():
            continue
        profile_record = load_profile_record(symbol)
        company_name = (
                str((profile_record or {}).get("company_name") or "").strip()
                or symbol
        )
        if not is_supported_local_symbol(symbol, query, company_name):
            continue
        seen.add(symbol)
        logo_url = resolve_stored_logo_url(symbol) if has_logo_asset(symbol) else ""
        items.append(
            {
                "symbol": symbol,
                "name": company_name,
                "logo_url": logo_url,
                "source": "local",
            }
        )
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
            if symbol in seen:
                continue
            seen.add(symbol)
            combined.append(search_item)
            if len(combined) >= limit:
                return combined
    return combined


def search_tickers(query: str, limit: int = 5) -> list[dict[str, str]]:
    ensure_market_store_dir()
    normalized_query = normalize_ticker_input(query)
    recent_symbols = top_used_tickers(normalized_query, limit=limit)
    recent_items = [_build_recent_suggestion(symbol) for symbol in recent_symbols]
    local_items = build_local_search_items(normalized_query) if normalized_query else []

    if len(normalized_query) < 1:
        return combine_unique_search_items(recent_items, local_items, limit=limit)

    if len(normalized_query) == 1 and local_items:
        return combine_unique_search_items(recent_items, local_items, limit=limit)

    if any(
            str(item.get("symbol") or "").upper() == normalized_query
            for item in local_items
    ):
        prioritized_local_items = sorted(
            local_items,
            key=lambda local_item: 0 if str(local_item.get("symbol") or "").upper() == normalized_query else 1,
        )
        return combine_unique_search_items(prioritized_local_items, recent_items, limit=limit)

    cached_items = load_search_cache_items(normalized_query)
    if len(local_items) >= limit:
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
            search = yf.Search(
                normalized_query,
                max_results=20,
                news_count=0,
                lists_count=0,
                recommended=0,
                raise_errors=False,
            )
            results = search.quotes
        except (RequestException, CurlError, TimeoutError, ConnectionError) as exc:
            LOGGER.warning("Ticker search remote lookup failed for %s: %s", normalized_query, exc)
            results = []

        filtered: list[dict[str, str]] = []
        for item in results:
            symbol = str(item.get("symbol", "")).upper()
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

    return combine_unique_search_items(recent_items, local_items, remote_items, limit=limit)
