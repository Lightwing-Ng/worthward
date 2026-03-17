"""
Remote connectivity helpers.

Code version: v1.3.0
"""

from __future__ import annotations

import json
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yfinance as yf


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d"
LOGO_PING_URL = "https://www.google.com/s2/favicons?domain_url=apple.com&sz=32"
REMOTE_MARKET_SUCCESS_TTL_SECONDS = 900
REMOTE_MARKET_FAILURE_TTL_SECONDS = 45
REMOTE_MARKET_STALE_GRACE_SECONDS = 3600
REMOTE_LOGO_SUCCESS_TTL_SECONDS = 900
REMOTE_LOGO_FAILURE_TTL_SECONDS = 120
_remote_market_access_cache: tuple[float, bool] | None = None
_remote_logo_access_cache: tuple[float, bool] | None = None


def _cached_connectivity_value(
    cache_entry: tuple[float, bool] | None,
    *,
    success_ttl: int,
    failure_ttl: int,
) -> bool | None:
    if cache_entry is None:
        return None
    cached_at, cached_value = cache_entry
    ttl = success_ttl if cached_value else failure_ttl
    if monotonic() - cached_at < ttl:
        return cached_value
    return None


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
    probe = yf.download("AAPL", period="5d", interval="1d", progress=False, threads=False, timeout=6)
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
                _remote_market_access_cache = (monotonic(), True)
                return True
        except Exception:
            continue

    if _remote_market_access_cache is not None:
        cached_at, cached_value = _remote_market_access_cache
        if cached_value and monotonic() - cached_at < REMOTE_MARKET_STALE_GRACE_SECONDS:
            return True

    _remote_market_access_cache = (monotonic(), False)
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

    request_obj = Request(
        LOGO_PING_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urlopen(request_obj, timeout=2) as response:
            is_available = response.status < 500
            _remote_logo_access_cache = (monotonic(), is_available)
            return is_available
    except (HTTPError, URLError, TimeoutError, ValueError):
        _remote_logo_access_cache = (monotonic(), False)
        return False


def reset_connectivity_caches() -> None:
    global _remote_market_access_cache, _remote_logo_access_cache
    _remote_market_access_cache = None
    _remote_logo_access_cache = None
