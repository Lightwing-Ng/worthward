"""
Runtime network bootstrap helpers.

Code version: v0.4.0
"""

from __future__ import annotations

import atexit
import os
from pathlib import Path
import shutil
import tempfile
from threading import RLock
from typing import Mapping

import certifi
from curl_cffi import requests as curl_requests

YAHOO_CA_PEM_ENV = "ANTIGRAVITY_YAHOO_CA_PEM"
_TLS_ERROR_MARKERS = (
    "certificateverifyerror",
    "certificate verify failed",
    "curl (60)",
    "ssl certificate problem",
)
_SESSION_LOCK = RLock()
_YFINANCE_SESSION: curl_requests.Session | None = None
_YFINANCE_ENTERPRISE_CA_PATH: Path | None = None
_CA_BUNDLE_DIRECTORY: Path | None = None


class YahooTLSConfigurationError(ValueError):
    """Raised when the configured Yahoo enterprise CA cannot be used safely."""


def resolve_yahoo_enterprise_ca_path(
        configured_path: str | os.PathLike[str] | None = None,
        *,
        environ: Mapping[str, str] | None = None,
) -> Path | None:
    """Resolve the environment override before the versioned configuration value."""
    environment = os.environ if environ is None else environ
    raw_path = str(environment.get(YAHOO_CA_PEM_ENV, "") or configured_path or "").strip()
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    if not path.is_file():
        raise YahooTLSConfigurationError(
            f"Yahoo enterprise CA PEM does not exist or is not a file: {path}. "
            f"Set {YAHOO_CA_PEM_ENV} to a readable PEM file."
        )
    return path.resolve()


def build_yahoo_ca_bundle(enterprise_ca_path: Path) -> Path:
    """Combine certifi's public roots with the configured enterprise CA PEM."""
    global _CA_BUNDLE_DIRECTORY

    try:
        enterprise_ca = enterprise_ca_path.read_bytes()
    except OSError as exc:
        raise YahooTLSConfigurationError(
            f"Unable to read Yahoo enterprise CA PEM at {enterprise_ca_path}: {exc}."
        ) from exc
    if b"-----BEGIN CERTIFICATE-----" not in enterprise_ca:
        raise YahooTLSConfigurationError(
            f"Yahoo enterprise CA file is not a PEM certificate bundle: {enterprise_ca_path}."
        )

    certifi_bundle = Path(certifi.where())
    try:
        public_ca = certifi_bundle.read_bytes()
    except OSError as exc:
        raise YahooTLSConfigurationError(
            f"Unable to read certifi CA bundle at {certifi_bundle}: {exc}."
        ) from exc

    if _CA_BUNDLE_DIRECTORY is None:
        _CA_BUNDLE_DIRECTORY = Path(tempfile.mkdtemp(prefix="antigravity-yahoo-ca-"))
    combined_bundle = _CA_BUNDLE_DIRECTORY / "certifi-plus-enterprise.pem"
    separator = b"" if public_ca.endswith(b"\n") else b"\n"
    combined_bundle.write_bytes(public_ca + separator + enterprise_ca.lstrip())
    return combined_bundle


def _remove_ca_bundle_directory() -> None:
    global _CA_BUNDLE_DIRECTORY
    if _CA_BUNDLE_DIRECTORY is not None:
        shutil.rmtree(_CA_BUNDLE_DIRECTORY, ignore_errors=True)
        _CA_BUNDLE_DIRECTORY = None


atexit.register(_remove_ca_bundle_directory)


def bootstrap_runtime_network() -> None:
    """Keep the process-wide TLS trust configuration unchanged.

    urllib and curl_cffi honor standard proxy environment variables. Yahoo's
    curl_cffi transport receives its own verified session so no global TLS
    behavior is changed.
    """


def configure_yfinance_for_proxy(
        configured_ca_pem: str | os.PathLike[str] | None = None,
) -> curl_requests.Session:
    """Create one verified curl_cffi session for all yfinance requests."""
    global _YFINANCE_ENTERPRISE_CA_PATH, _YFINANCE_SESSION

    enterprise_ca_path = resolve_yahoo_enterprise_ca_path(configured_ca_pem)
    verify: bool | str = True
    if enterprise_ca_path is not None:
        verify = str(build_yahoo_ca_bundle(enterprise_ca_path))

    with _SESSION_LOCK:
        previous_session = _YFINANCE_SESSION
        _YFINANCE_SESSION = curl_requests.Session(verify=verify)
        _YFINANCE_ENTERPRISE_CA_PATH = enterprise_ca_path
        if previous_session is not None:
            previous_session.close()
        return _YFINANCE_SESSION


def get_yfinance_session() -> curl_requests.Session:
    """Return the process-wide verified yfinance transport session."""
    with _SESSION_LOCK:
        if _YFINANCE_SESSION is None:
            return configure_yfinance_for_proxy()
        return _YFINANCE_SESSION


def add_yahoo_tls_configuration_hint(diagnostic: str) -> str:
    """Add an actionable enterprise-CA hint only to certificate failures."""
    normalized = diagnostic.lower()
    if _YFINANCE_ENTERPRISE_CA_PATH is not None:
        return diagnostic
    if not any(marker in normalized for marker in _TLS_ERROR_MARKERS):
        return diagnostic
    return (
        f"{diagnostic} Configure the corporate CA PEM with {YAHOO_CA_PEM_ENV} "
        "or config.toml [network].yahoo_ca_pem; TLS verification remains required."
    )


def bootstrap_runtime_network_for_yfinance(
        configured_ca_pem: str | os.PathLike[str] | None = None,
) -> curl_requests.Session:
    bootstrap_runtime_network()
    return configure_yfinance_for_proxy(configured_ca_pem)
