"""
Remote connectivity helpers.

Code version: v0.4.0
"""

from __future__ import annotations

import contextlib
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from http.client import RemoteDisconnected
import io
import json
from time import monotonic, time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yfinance as yf

from app.infrastructure.runtime_network import get_yfinance_session

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d"
PRIMARY_LOGO_PING_URL = "https://eodhd.com/img/logos/US/TQQQ.png"
FALLBACK_LOGO_PING_URLS = (
    "https://www.google.com/s2/favicons?domain_url=apple.com&sz=32",
    "https://icon.horse/icon/apple.com",
)
GOOGLE_HK_PING_URLS = (
    "https://www.google.com.hk/",
    "https://www.google.com/",
)
CHATGPT_PING_URLS = (
    "https://chatgpt.com/",
    "https://chat.openai.com/",
)
REMOTE_MARKET_SUCCESS_TTL_SECONDS = 900
REMOTE_MARKET_FAILURE_TTL_SECONDS = 45
REMOTE_MARKET_STALE_GRACE_SECONDS = 3600
REMOTE_LOGO_SUCCESS_TTL_SECONDS = 900
REMOTE_LOGO_FAILURE_TTL_SECONDS = 120
GENERIC_CONNECTIVITY_SUCCESS_TTL_SECONDS = 300
GENERIC_CONNECTIVITY_FAILURE_TTL_SECONDS = 60
_remote_market_access_cache: tuple[float, float, bool] | None = None
_remote_logo_access_cache: tuple[float, float, bool] | None = None
_google_hk_access_cache: tuple[float, float, bool] | None = None
_chatgpt_access_cache: tuple[float, float, bool] | None = None


def _cached_connectivity_value(
        cache_entry: tuple[float, float, bool] | None,
        *,
        success_ttl: int,
        failure_ttl: int,
) -> bool | None:
    if cache_entry is None:
        return None
    cached_at, _, cached_value = cache_entry
    ttl = success_ttl if cached_value else failure_ttl
    if monotonic() - cached_at < ttl:
        return cached_value
    return None


def _cache_checked_at(cache_entry: tuple[float, float, bool] | None) -> float | None:
    if cache_entry is None:
        return None
    _, checked_at, _ = cache_entry
    return checked_at


def _cache_result(value: bool) -> tuple[float, float, bool]:
    return monotonic(), time(), value


def _probe_yahoo_chart_endpoint() -> bool:
    request_obj = Request(
        YAHOO_CHART_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request_obj, timeout=4) as response:
        if response.status >= 500:
            return False
        payload = json.loads(response.read())
    chart = payload.get("chart", {})
    result = chart.get("result") or []
    if not result:
        return False
    meta = result[0].get("meta") or {}
    timestamp = result[0].get("timestamp") or []
    return bool(meta.get("symbol") == "AAPL" and timestamp)


def _probe_yfinance_history() -> bool:
    stderr_buffer = io.StringIO()
    stdout_buffer = io.StringIO()
    with contextlib.redirect_stderr(stderr_buffer), contextlib.redirect_stdout(stdout_buffer):
        probe = yf.download(
            "AAPL",
            period="5d",
            interval="1d",
            progress=False,
            threads=False,
            timeout=6,
            session=get_yfinance_session(),
        )
    return not probe.empty and "Close" in probe.columns


def has_remote_market_access() -> bool:
    global _remote_market_access_cache

    cached_value = _cached_connectivity_value(
        _remote_market_access_cache,
        success_ttl=REMOTE_MARKET_SUCCESS_TTL_SECONDS,
        failure_ttl=REMOTE_MARKET_FAILURE_TTL_SECONDS,
    )
    if cached_value is not None:
        return cached_value

    for probe in (_probe_yahoo_chart_endpoint, _probe_yfinance_history):
        try:
            if probe():
                _remote_market_access_cache = _cache_result(True)
                return True
        except Exception:
            continue

    if _remote_market_access_cache is not None:
        cached_at, _, cached_value = _remote_market_access_cache
        if cached_value and monotonic() - cached_at < REMOTE_MARKET_STALE_GRACE_SECONDS:
            return True

    _remote_market_access_cache = _cache_result(False)
    return False


def has_remote_logo_access() -> bool:
    global _remote_logo_access_cache

    cached_value = _cached_connectivity_value(
        _remote_logo_access_cache,
        success_ttl=REMOTE_LOGO_SUCCESS_TTL_SECONDS,
        failure_ttl=REMOTE_LOGO_FAILURE_TTL_SECONDS,
    )
    if cached_value is not None:
        return cached_value

    for remote_url in (PRIMARY_LOGO_PING_URL, *FALLBACK_LOGO_PING_URLS):
        request_obj = Request(
            remote_url,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        try:
            with urlopen(request_obj, timeout=4) as response:
                is_available = response.status < 500
                if is_available:
                    _remote_logo_access_cache = _cache_result(True)
                    return True
        except (HTTPError, URLError, TimeoutError, ValueError, RemoteDisconnected):
            continue

    _remote_logo_access_cache = _cache_result(False)
    return False


def _probe_http_endpoints(remote_urls: tuple[str, ...]) -> bool:
    for remote_url in remote_urls:
        request_obj = Request(
            remote_url,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        try:
            with urlopen(request_obj, timeout=4) as response:
                if response.status < 500:
                    return True
        except (HTTPError, URLError, TimeoutError, ValueError, RemoteDisconnected):
            continue
    return False


def has_google_hk_access() -> bool:
    global _google_hk_access_cache

    cached_value = _cached_connectivity_value(
        _google_hk_access_cache,
        success_ttl=GENERIC_CONNECTIVITY_SUCCESS_TTL_SECONDS,
        failure_ttl=GENERIC_CONNECTIVITY_FAILURE_TTL_SECONDS,
    )
    if cached_value is not None:
        return cached_value

    is_available = _probe_http_endpoints(GOOGLE_HK_PING_URLS)
    _google_hk_access_cache = _cache_result(is_available)
    return is_available


def has_chatgpt_access() -> bool:
    global _chatgpt_access_cache

    cached_value = _cached_connectivity_value(
        _chatgpt_access_cache,
        success_ttl=GENERIC_CONNECTIVITY_SUCCESS_TTL_SECONDS,
        failure_ttl=GENERIC_CONNECTIVITY_FAILURE_TTL_SECONDS,
    )
    if cached_value is not None:
        return cached_value

    is_available = _probe_http_endpoints(CHATGPT_PING_URLS)
    _chatgpt_access_cache = _cache_result(is_available)
    return is_available


def _normalize_tradingview_section(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {str(key): section_value for key, section_value in value.items()}


def fetch_tradingview_metrics(
        symbol: str,
        *,
        screener: str = "america",
        exchange: str = "NASDAQ",
        timeout_seconds: float = 3.0,
) -> dict[str, object]:
    """Fetch a broad set of TradingView TA metrics for a ticker."""
    from tradingview_ta import Interval, TA_Handler

    handler = TA_Handler(
        symbol=symbol,
        screener=screener,
        exchange=exchange,
        interval=Interval.INTERVAL_1_DAY,
    )
    if timeout_seconds <= 0:
        analysis = handler.get_analysis()
    else:
        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(handler.get_analysis)
        try:
            analysis = future.result(timeout=timeout_seconds)
        except FuturesTimeoutError as exc:
            future.cancel()
            raise TimeoutError(
                f"TradingView metrics request timed out after {timeout_seconds:.1f} seconds."
            ) from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    summary = _normalize_tradingview_section(analysis.summary)
    oscillators = _normalize_tradingview_section(analysis.oscillators)
    moving_averages = _normalize_tradingview_section(analysis.moving_averages)
    indicators = _normalize_tradingview_section(analysis.indicators)

    payload: dict[str, object] = {
        "symbol": symbol,
        "screener": screener,
        "exchange": exchange,
        "summary": summary,
        "oscillators": oscillators,
        "moving_averages": moving_averages,
        "indicators": indicators,
    }
    return payload


def reset_connectivity_caches() -> None:
    global _remote_market_access_cache, _remote_logo_access_cache
    global _google_hk_access_cache, _chatgpt_access_cache
    _remote_market_access_cache = None
    _remote_logo_access_cache = None
    _google_hk_access_cache = None
    _chatgpt_access_cache = None


def last_remote_market_check_at() -> float | None:
    return _cache_checked_at(_remote_market_access_cache)


def last_remote_logo_check_at() -> float | None:
    return _cache_checked_at(_remote_logo_access_cache)


def last_google_hk_check_at() -> float | None:
    return _cache_checked_at(_google_hk_access_cache)
