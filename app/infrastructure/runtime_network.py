"""
Runtime network bootstrap helpers.

Code version: v0.6.0
"""

from __future__ import annotations

import atexit
import logging
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
from threading import RLock
from typing import Mapping
from urllib.request import HTTPSHandler, OpenerDirector, ProxyHandler, build_opener

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
_SCOPED_NETWORK_OPENER: OpenerDirector | None = None
_CA_BUNDLE_DIRECTORY: Path | None = None
_MACOS_SYSTEM_CA_LOCK = RLock()
_MACOS_SYSTEM_CA_DETECTION_ATTEMPTED = False
_MACOS_SYSTEM_CA_PEM: Path | None = None


class YahooTLSConfigurationError(ValueError):
    """Raised when the configured Yahoo enterprise CA cannot be used safely."""


def detect_macos_system_ca_pem() -> Path | None:
    """Export the macOS system keychains once for scoped Yahoo TLS trust."""
    global _CA_BUNDLE_DIRECTORY
    global _MACOS_SYSTEM_CA_DETECTION_ATTEMPTED, _MACOS_SYSTEM_CA_PEM

    if sys.platform != "darwin":
        return None

    with _MACOS_SYSTEM_CA_LOCK:
        if _MACOS_SYSTEM_CA_DETECTION_ATTEMPTED:
            return _MACOS_SYSTEM_CA_PEM
        _MACOS_SYSTEM_CA_DETECTION_ATTEMPTED = True

        keychains = (
            "/System/Library/Keychains/SystemRootCertificates.keychain",
            "/Library/Keychains/System.keychain",
        )
        try:
            pem_outputs = []
            for keychain in keychains:
                completed = subprocess.run(
                    ["security", "find-certificate", "-a", "-p", keychain],
                    check=True,
                    capture_output=True,
                )
                pem_outputs.append(completed.stdout)
            combined_pem = b"".join(
                output.rstrip(b"\n") + b"\n"
                for output in pem_outputs
            )
            if _CA_BUNDLE_DIRECTORY is None:
                _CA_BUNDLE_DIRECTORY = Path(
                    tempfile.mkdtemp(prefix="antigravity-yahoo-ca-")
                )
            detected_path = _CA_BUNDLE_DIRECTORY / "macos-system-keychains.pem"
            detected_path.write_bytes(combined_pem)
        except (OSError, subprocess.SubprocessError) as exc:
            logging.warning(
                "Unable to auto-detect macOS system CA certificates: %s",
                exc,
            )
            return None

        _MACOS_SYSTEM_CA_PEM = detected_path
        certificate_count = combined_pem.count(b"BEGIN CERTIFICATE")
        logging.info(
            "Auto-detected %d certificates from the macOS system keychains.",
            certificate_count,
        )
        return _MACOS_SYSTEM_CA_PEM


def resolve_yahoo_enterprise_ca_path(
        configured_path: str | os.PathLike[str] | None = None,
        *,
        environ: Mapping[str, str] | None = None,
) -> Path | None:
    """Resolve the environment override before the versioned configuration value."""
    environment = os.environ if environ is None else environ
    raw_path = str(environment.get(YAHOO_CA_PEM_ENV, "") or configured_path or "").strip()
    if not raw_path:
        return detect_macos_system_ca_pem()
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
    curl_cffi transport and the explicitly scoped urllib consumers receive
    their own verified clients so no global TLS behavior is changed.
    """


def _build_scoped_network_opener(verify: bool | str) -> OpenerDirector:
    """Build a proxy-aware opener without changing process-wide TLS defaults."""
    context = ssl.create_default_context(cafile=verify if isinstance(verify, str) else None)
    return build_opener(
        ProxyHandler(),
        HTTPSHandler(context=context),
    )


def configure_yfinance_for_proxy(
        configured_ca_pem: str | os.PathLike[str] | None = None,
) -> curl_requests.Session:
    """Create one verified curl_cffi session for all yfinance requests."""
    global _SCOPED_NETWORK_OPENER
    global _YFINANCE_ENTERPRISE_CA_PATH, _YFINANCE_SESSION

    enterprise_ca_path = resolve_yahoo_enterprise_ca_path(configured_ca_pem)
    verify: bool | str = True
    if enterprise_ca_path is not None:
        verify = str(build_yahoo_ca_bundle(enterprise_ca_path))

    with _SESSION_LOCK:
        previous_session = _YFINANCE_SESSION
        _YFINANCE_SESSION = curl_requests.Session(verify=verify)
        _SCOPED_NETWORK_OPENER = _build_scoped_network_opener(verify)
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


def open_scoped_network_url(request_obj, *, timeout: float):
    """Open Yahoo, logo, or self-check URLs through the verified scoped client."""
    with _SESSION_LOCK:
        if _SCOPED_NETWORK_OPENER is None:
            configure_yfinance_for_proxy()
        opener = _SCOPED_NETWORK_OPENER
    assert opener is not None
    return opener.open(request_obj, timeout=timeout)


def add_yahoo_tls_configuration_hint(diagnostic: str) -> str:
    """Add an actionable enterprise-CA hint only to certificate failures."""
    normalized = diagnostic.lower()
    if _YFINANCE_ENTERPRISE_CA_PATH is not None:
        return diagnostic
    if not any(marker in normalized for marker in _TLS_ERROR_MARKERS):
        return diagnostic
    hint = (
        f"{diagnostic} Configure the corporate CA PEM with {YAHOO_CA_PEM_ENV} "
        "or config.toml [network].yahoo_ca_pem; TLS verification remains required"
    )
    if sys.platform == "darwin":
        hint += (
            "; on macOS the system keychain was checked automatically — if the "
            "corporate CA is in a user keychain, export it and set "
            f"{YAHOO_CA_PEM_ENV} explicitly"
        )
    return f"{hint}."


def bootstrap_runtime_network_for_yfinance(
        configured_ca_pem: str | os.PathLike[str] | None = None,
) -> curl_requests.Session:
    bootstrap_runtime_network()
    return configure_yfinance_for_proxy(configured_ca_pem)
