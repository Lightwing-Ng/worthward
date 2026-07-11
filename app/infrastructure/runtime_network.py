"""
Runtime network bootstrap helpers.

Code version: v0.3.0
"""

from __future__ import annotations

def bootstrap_runtime_network() -> None:
    """Keep the process-wide TLS trust configuration unchanged.

    urllib and curl_cffi already honor standard proxy environment variables.
    A proxy that intercepts TLS must provide a trusted CA bundle instead of
    disabling certificate verification for the entire process.
    """


def configure_yfinance_for_proxy() -> None:
    """Rely on curl_cffi's verified, standard proxy handling."""


def bootstrap_runtime_network_for_yfinance() -> None:
    bootstrap_runtime_network()
    configure_yfinance_for_proxy()
