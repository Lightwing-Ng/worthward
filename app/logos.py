"""
Logo and quote profile services.

Code version: v2.8.0
"""

from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import yfinance as yf
from flask import url_for

from .connectivity import has_remote_market_access
from .storage import history_store_path_for, is_store_entry_fresh, ensure_market_store_dir, list_local_tickers, logo_store_path_for, profile_store_path_for, top_used_tickers
from .schemas import QuoteProfile


TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
VALID_QUOTE_TYPES = {"EQUITY", "ETF"}
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS", "CXI"}


TICKER_WEBSITE_OVERRIDES = {
    "QQQ": "https://www.invesco.com",
    "JEPQ": "https://www.jpmorganchase.com",
}


ISSUER_WEBSITE_HINTS = {
    "INVESCO": "https://www.invesco.com",
    "JPMORGAN": "https://www.jpmorganchase.com",
    "JP MORGAN": "https://www.jpmorganchase.com",
    "ISHARES": "https://www.ishares.com",
    "VANGUARD": "https://investor.vanguard.com",
    "SCHWAB": "https://www.schwabassetmanagement.com",
    "SPDR": "https://www.ssga.com",
}


def build_market_store_logo_url(filename: str, modified_at_ns: int | None = None) -> str:
    if modified_at_ns is None:
        for namespace in ("primary", "search"):
            logo_path = logo_store_path_for(filename.removesuffix(".png"), namespace=namespace)
            if logo_path.exists():
                modified_at_ns = logo_path.stat().st_mtime_ns
                break
    if modified_at_ns is None:
        return url_for("market_store_logo", filename=filename)
    return url_for("market_store_logo", filename=filename, v=modified_at_ns)


def normalize_ticker_input(raw_ticker: str) -> str:
    return raw_ticker.strip().upper()


def has_valid_ticker_format(ticker: str) -> bool:
    return bool(TICKER_PATTERN.fullmatch(ticker))


def is_known_ticker(ticker: str) -> bool:
    normalized_ticker = normalize_ticker_input(ticker)
    if not has_valid_ticker_format(normalized_ticker):
        return False
    if history_store_path_for(normalized_ticker).exists() or profile_store_path_for(normalized_ticker).exists():
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
    except Exception:
        pass

    try:
        info = yf.Ticker(normalized_ticker).info
    except Exception:
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
    return (is_symbol_exact, is_symbol_prefix, is_name_match, is_etf, symbol)


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
    info = yf.Ticker(ticker).info
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


def fetch_remote_logo_bytes(ticker: str, domain: str | None = None) -> bytes | None:
    providers = [
        f"https://eodhd.com/img/logos/US/{ticker.upper()}.png",
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
        except (HTTPError, URLError, TimeoutError, ValueError):
            continue
    return None


def refresh_logo_store(
    ticker: str,
    website: str | None,
    force_refresh: bool = False,
    namespace: str = "primary",
) -> None:
    ensure_market_store_dir()
    path = logo_store_path_for(ticker, namespace=namespace)
    if path.exists() and not force_refresh:
        return

    if not has_remote_market_access():
        return

    domain = extract_domain(website)
    logo_bytes = fetch_remote_logo_bytes(ticker, domain)
    if logo_bytes is not None:
        path.write_bytes(logo_bytes)


def fetch_and_store_logo(
    ticker: str,
    website: str | None,
    force_refresh: bool = False,
    namespace: str = "primary",
) -> str | None:
    ensure_market_store_dir()
    path = logo_store_path_for(ticker, namespace=namespace)
    refresh_logo_store(ticker, website, force_refresh=force_refresh, namespace=namespace)
    if not path.exists():
        return None

    return build_market_store_logo_url(path.name, path.stat().st_mtime_ns)


def resolve_logo_url_with_fallback(
    ticker: str,
    website: str | None,
    force_refresh: bool = False,
    namespace: str = "primary",
) -> str | None:
    logo_url = fetch_and_store_logo(ticker, website, force_refresh=force_refresh, namespace=namespace)
    if logo_url or namespace != "primary":
        return logo_url
    return fetch_and_store_logo(ticker, website, force_refresh=False, namespace="search")


def fetch_quote_profile(
    ticker: str,
    force_refresh: bool = False,
    namespace: str = "primary",
) -> QuoteProfile:
    ensure_market_store_dir()
    path = profile_store_path_for(ticker, namespace=namespace)

    if path.exists() and (is_store_entry_fresh(path) or not has_remote_market_access() or not force_refresh):
        payload = json.loads(path.read_text())
        return QuoteProfile(
            ticker=payload["ticker"],
            company_name=payload["company_name"],
            website=payload.get("website"),
            logo_url=resolve_logo_url_with_fallback(
                payload["ticker"],
                payload.get("website"),
                force_refresh=False,
                namespace=namespace,
            ),
        )

    if not has_remote_market_access():
        existing_logo = resolve_logo_url_with_fallback(ticker, None, force_refresh=False, namespace=namespace)
        return QuoteProfile(
            ticker=ticker.upper(),
            company_name=ticker.upper(),
            website=None,
            logo_url=existing_logo,
        )

    payload = build_quote_profile_payload(ticker)
    path.write_text(json.dumps(payload))
    return QuoteProfile(
        ticker=payload["ticker"],
        company_name=payload["company_name"],
        website=payload.get("website"),
        logo_url=resolve_logo_url_with_fallback(
            payload["ticker"],
            payload.get("website"),
            force_refresh=force_refresh,
            namespace=namespace,
        ),
    )


def refresh_quote_profile_cache(
    ticker: str,
    force_refresh: bool = False,
    namespace: str = "primary",
) -> bool:
    ensure_market_store_dir()
    if not has_remote_market_access():
        return False

    try:
        path = profile_store_path_for(ticker, namespace=namespace)
        payload = build_quote_profile_payload(ticker)
        path.write_text(json.dumps(payload))
        refresh_logo_store(
            payload["ticker"],
            payload.get("website"),
            force_refresh=force_refresh,
            namespace=namespace,
        )
    except Exception:
        return False
    return True


def _build_recent_suggestion(symbol: str) -> dict[str, str]:
    profile = fetch_quote_profile(symbol, force_refresh=False, namespace="primary")
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
        search_profile_path = profile_store_path_for(symbol, namespace="search")
        namespace = "search" if search_profile_path.exists() else "primary"
        profile = fetch_quote_profile(symbol, force_refresh=False, namespace=namespace)
        if not is_supported_local_symbol(symbol, query, profile.company_name):
            continue
        seen.add(symbol)
        items.append(
            {
                "symbol": symbol,
                "name": profile.company_name or symbol,
                "logo_url": profile.logo_url or "",
                "source": "remote",
            }
        )
    return items


def search_tickers(query: str, limit: int = 5) -> list[dict[str, str]]:
    ensure_market_store_dir()
    from .storage import search_store_path_for

    normalized_query = normalize_ticker_input(query)
    recent_symbols = top_used_tickers(normalized_query, limit=limit)
    recent_items = [_build_recent_suggestion(symbol) for symbol in recent_symbols]

    if len(normalized_query) < 1:
        return recent_items[:limit]

    path = search_store_path_for(normalized_query)
    cached_items: list[dict[str, str]] = []
    if path.exists():
        cached_items = json.loads(path.read_text())

    remote_items: list[dict[str, str]] = []
    if cached_items and all("logo_url" in item for item in cached_items):
        remote_items = [
            item for item in cached_items
            if is_supported_local_symbol(item.get("symbol", ""), normalized_query)
        ]
    elif not has_remote_market_access():
        remote_items = build_local_search_items(normalized_query)
    else:
        results = yf.Search(
            normalized_query,
            max_results=20,
            news_count=0,
            lists_count=0,
            recommended=0,
            raise_errors=False,
        ).quotes

        filtered: list[dict[str, str]] = []
        for item in results:
            symbol = str(item.get("symbol", "")).upper()
            quote_type = str(item.get("quoteType", "")).upper()
            if not is_supported_search_result(item, normalized_query):
                continue
            website = item.get("website") or item.get("webSite")
            logo_url = fetch_and_store_logo(symbol, website, namespace="search")
            if not logo_url:
                profile = fetch_quote_profile(symbol, force_refresh=False, namespace="search")
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

        deduped_remote = {item["symbol"]: item for item in filtered}
        remote_items = sorted(deduped_remote.values(), key=lambda item: search_result_sort_key(item, normalized_query))
        if should_cache_search_results(normalized_query, remote_items):
            path.write_text(json.dumps(remote_items))

    if not remote_items and not has_remote_market_access():
        remote_items = build_local_search_items(normalized_query)

    combined: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in recent_items + remote_items:
        symbol = item["symbol"]
        if symbol in seen:
            continue
        seen.add(symbol)
        combined.append(item)
        if len(combined) >= limit:
            break
    return combined
