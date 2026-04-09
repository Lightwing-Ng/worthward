"""
Project entrypoint.

Code version: v0.3.3
"""

import os
import socket
import ssl
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

CORPORATE_PROXY = "http://proxyjp.huawei.com:8080"
CORPORATE_PROXY_HOST = "proxyjp.huawei.com"
CORPORATE_PROXY_PORT = 8080
CORPORATE_PROXY_TIMEOUT = 0.5
CORPORATE_PROXY_VALIDATION_TIMEOUT = 4
PROXY_VALIDATION_URL = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d"
TRUTHY_VALUES = {"1", "true", "yes", "on"}


def _is_truthy(value):
    return str(value).strip().lower() in TRUTHY_VALUES


def _can_reach_corporate_proxy():
    try:
        with socket.create_connection(
                (CORPORATE_PROXY_HOST, CORPORATE_PROXY_PORT),
                timeout=CORPORATE_PROXY_TIMEOUT,
        ):
            return True
    except OSError:
        return False


def _has_explicit_proxy_environment():
    return any(
        str(os.environ.get(key, "")).strip()
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
    )


def _corporate_proxy_supports_market_requests():
    opener = build_opener(
        ProxyHandler({"http": CORPORATE_PROXY, "https": CORPORATE_PROXY}),
        HTTPSHandler(context=ssl._create_unverified_context()),
    )
    request = Request(
        PROXY_VALIDATION_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with opener.open(request, timeout=CORPORATE_PROXY_VALIDATION_TIMEOUT) as response:
            return response.status < 500
    except Exception:
        return False


def _apply_corporate_proxy():
    os.environ.setdefault("HTTP_PROXY", CORPORATE_PROXY)
    os.environ.setdefault("HTTPS_PROXY", CORPORATE_PROXY)
    os.environ.setdefault("http_proxy", CORPORATE_PROXY)
    os.environ.setdefault("https_proxy", CORPORATE_PROXY)
    ssl._create_default_https_context = ssl._create_unverified_context


def _bootstrap_runtime_network():
    if _is_truthy(os.environ.get("ANTIGRAVITY_DISABLE_PROXY")):
        return

    if _has_explicit_proxy_environment():
        return

    if _is_truthy(os.environ.get("ANTIGRAVITY_FORCE_PROXY")):
        _apply_corporate_proxy()
        return

    if not _can_reach_corporate_proxy():
        return

    if not _corporate_proxy_supports_market_requests():
        return

    _apply_corporate_proxy()


_bootstrap_runtime_network()

from app import create_app
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context
from app.core.settings import get_settings

try:
    prewarmed, prewarm_message = prewarm_longbridge_quote_context()
    if prewarmed:
        print(f"[antigravity] {prewarm_message}")
    else:
        print(f"[antigravity] {prewarm_message}")
except Exception as exc:
    print(f"[antigravity] Longbridge prewarm failed: {exc}")

app = create_app()
settings = get_settings()

if __name__ == "__main__":
    app.run(
        debug=settings["app"].get("debug", True),
        host=settings["server"].get("host", "127.0.0.1"),
        port=settings["server"].get("port", 8688),
    )
