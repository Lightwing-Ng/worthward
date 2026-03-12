"""
Remote connectivity helpers.

Code version: v1.1.0
"""

from __future__ import annotations

from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


YAHOO_PING_URL = "https://finance.yahoo.com"
LOGO_PING_URL = "https://www.google.com/s2/favicons?domain_url=apple.com&sz=32"


@lru_cache(maxsize=1)
def has_remote_market_access() -> bool:
    request_obj = Request(
        YAHOO_PING_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urlopen(request_obj, timeout=2) as response:
            return response.status < 500
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False


@lru_cache(maxsize=1)
def has_remote_logo_access() -> bool:
    request_obj = Request(
        LOGO_PING_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urlopen(request_obj, timeout=2) as response:
            return response.status < 500
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False
