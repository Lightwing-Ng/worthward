"""
Runtime network bootstrap helpers.

Code version: v0.2.0
"""

from __future__ import annotations

import os
import ssl
import warnings

TRUTHY_VALUES = {"1", "true", "yes", "on"}
_SESSION_PATCH_FLAG = "_antigravity_proxy_patched"
_SESSION_PATCHED = False


def _is_truthy(value: object) -> bool:
    return str(value).strip().lower() in TRUTHY_VALUES


def _has_explicit_proxy_environment() -> bool:
    return any(
        str(os.environ.get(key, "")).strip()
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
    )


def bootstrap_runtime_network() -> None:
    if _is_truthy(os.environ.get("ANTIGRAVITY_DISABLE_PROXY")):
        return

    if _has_explicit_proxy_environment():
        ssl._create_default_https_context = ssl._create_unverified_context


def configure_yfinance_for_proxy() -> None:
    global _SESSION_PATCHED
    if _SESSION_PATCHED:
        return

    proxy_url = str(
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
        or ""
    ).strip()
    if not proxy_url:
        return

    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except ImportError:
        pass

    warnings.filterwarnings("ignore")

    try:
        import curl_cffi.requests
    except ImportError:
        return

    session_cls = curl_cffi.requests.Session
    if getattr(session_cls, _SESSION_PATCH_FLAG, False):
        _SESSION_PATCHED = True
        return

    original_session_request = session_cls.request
    original_get = session_cls.get

    def patched_request(self, method, url, **kwargs):
        kwargs.setdefault("verify", False)
        kwargs.setdefault("timeout", 30)
        kwargs.setdefault("proxies", {
            "http": proxy_url,
            "https": proxy_url,
        })
        return original_session_request(self, method, url, **kwargs)

    def patched_get(self, url, **kwargs):
        return patched_request(self, "GET", url, **kwargs)

    session_cls.request = patched_request
    session_cls.get = patched_get
    setattr(session_cls, _SESSION_PATCH_FLAG, True)
    _SESSION_PATCHED = True


def bootstrap_runtime_network_for_yfinance() -> None:
    bootstrap_runtime_network()
    configure_yfinance_for_proxy()
