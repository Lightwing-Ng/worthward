"""
Project entrypoint.

Code version: v0.3.1
"""

import os
import socket
import ssl

CORPORATE_PROXY = "http://proxyjp.huawei.com:8080"
CORPORATE_PROXY_HOST = "proxyjp.huawei.com"
CORPORATE_PROXY_PORT = 8080
CORPORATE_PROXY_TIMEOUT = 0.5
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


def _bootstrap_runtime_network():
    if _is_truthy(os.environ.get("ANTIGRAVITY_DISABLE_PROXY")):
        return

    if not (
            _is_truthy(os.environ.get("ANTIGRAVITY_FORCE_PROXY"))
            or _can_reach_corporate_proxy()
    ):
        return

    os.environ.setdefault("HTTP_PROXY", CORPORATE_PROXY)
    os.environ.setdefault("HTTPS_PROXY", CORPORATE_PROXY)
    os.environ.setdefault("http_proxy", CORPORATE_PROXY)
    os.environ.setdefault("https_proxy", CORPORATE_PROXY)
    ssl._create_default_https_context = ssl._create_unverified_context


_bootstrap_runtime_network()

from app import create_app
from app.core.settings import get_settings

app = create_app()
settings = get_settings()

if __name__ == "__main__":
    app.run(
        debug=settings["app"].get("debug", True),
        host=settings["server"].get("host", "127.0.0.1"),
        port=settings["server"].get("port", 8688),
    )
