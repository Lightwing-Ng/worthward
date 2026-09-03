"""
Remote connectivity helpers.

Code version: v0.8.0
- Added: parallel, transport-aware dependency self-checks for Settings.
- Removed: The retired TradingView analysis and unused legacy connectivity
  cache accessors.
- Added: bounded diagnostics for proxy, TLS, authentication, and configuration failures.
"""

from __future__ import annotations

import contextlib
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)
from http.client import RemoteDisconnected
import io
import json
import logging
import os
import re
import smtplib
import socket
import ssl
from time import monotonic, time
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request

import yfinance as yf

from app.core.branding import read_compatible_environment
from app.infrastructure.runtime_network import (
    get_yfinance_session,
    open_scoped_network_url as urlopen,
)

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d"
PRIMARY_LOGO_PING_URL = "https://eodhd.com/img/logos/US/TQQQ.png"
FALLBACK_LOGO_PING_URLS = (
    "https://www.google.com/s2/favicons?domain_url=apple.com&sz=32",
    "https://icon.horse/icon/apple.com",
    "https://companieslogo.com/img/orig/AVGO-77e10dd3.svg?t=1722952492&download=true",
)
GOOGLE_HK_PING_URLS = (
    "https://www.google.com.hk/",
    "https://www.google.com/",
)
SEC_PING_URL = "https://data.sec.gov/submissions/CIK0000320193.json"
SEC_FACTS_PING_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
SEC_WEB_PING_URL = "https://www.sec.gov/robots.txt"
SEC_USER_AGENT = "Worthward local portfolio application contact@example.invalid"
LONGBRIDGE_OPENAPI_PING_URL = "https://openapi.longbridge.com/"
NETWORK_HTTP_TIMEOUT_SECONDS = 4.0
NETWORK_SMTP_TIMEOUT_SECONDS = 4.0
REMOTE_MARKET_SUCCESS_TTL_SECONDS = 900
REMOTE_MARKET_FAILURE_TTL_SECONDS = 45
REMOTE_MARKET_STALE_GRACE_SECONDS = 3600
REMOTE_MARKET_ACCESS_ENV = "WORTHWARD_REMOTE_MARKET_ACCESS"
LEGACY_REMOTE_MARKET_ACCESS_ENV = "ANTIGRAVITY_REMOTE_MARKET_ACCESS"
REMOTE_LOGO_SUCCESS_TTL_SECONDS = 900
REMOTE_LOGO_FAILURE_TTL_SECONDS = 120
_remote_market_access_cache: tuple[float, float, bool] | None = None
_remote_logo_access_cache: tuple[float, float, bool] | None = None

_NETWORK_URL_USERINFO_PATTERN = re.compile(r"(?i)(https?://)[^/@\s]+@")
_NETWORK_SECRET_QUERY_PATTERN = re.compile(
    r"(?i)([?&](?:crumb|token|key|secret|password)=)[^&\s]+"
)


def _scrub_network_diagnostic(value: object) -> str:
    """Return a short diagnostic without proxy credentials or URL secrets."""
    diagnostic = " ".join(str(value or "").split())
    diagnostic = _NETWORK_URL_USERINFO_PATTERN.sub(r"\1REDACTED@", diagnostic)
    diagnostic = _NETWORK_SECRET_QUERY_PATTERN.sub(r"\1REDACTED", diagnostic)
    return diagnostic[:240]


def _exception_diagnostic(error: BaseException) -> str:
    if isinstance(error, HTTPError):
        return f"HTTP {error.code}"
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "Timed out"
    if isinstance(error, ssl.SSLError):
        return f"TLS error: {_scrub_network_diagnostic(error)}"
    if isinstance(error, URLError):
        reason = getattr(error, "reason", error)
        if isinstance(reason, ssl.SSLError):
            return f"TLS error: {_scrub_network_diagnostic(reason)}"
        return _scrub_network_diagnostic(reason) or "Network error"
    if isinstance(error, RemoteDisconnected):
        return "The remote host closed the connection"
    return _scrub_network_diagnostic(error) or type(error).__name__


def _network_result(
        key: str,
        state: str,
        note: str,
        started_at: float,
        *,
        is_available: bool = False,
        endpoint: str = "",
) -> dict[str, object]:
    """Build a JSON-safe self-check result with bounded timing metadata."""
    return {
        "key": key,
        "state": state,
        "is_available": bool(is_available),
        "note": note,
        "checked_at": time(),
        "latency_ms": max(0, round((monotonic() - started_at) * 1000)),
        "endpoint": endpoint,
    }


def _unexpected_network_result(key: str, error: BaseException, started_at: float) -> dict[str, object]:
    return _network_result(
        key,
        "unavailable",
        f"The self-check failed safely: {_exception_diagnostic(error)}.",
        started_at,
    )


def _http_probe(
        remote_url: str,
        *,
        headers: Mapping[str, str] | None = None,
        data: bytes | None = None,
        method: str | None = None,
        validator: Callable[[bytes], bool] | None = None,
        timeout: float = NETWORK_HTTP_TIMEOUT_SECONDS,
) -> dict[str, object]:
    """Probe an HTTP(S) endpoint through the scoped proxy-aware TLS client."""
    started_at = monotonic()
    request_obj = Request(
        remote_url,
        headers=dict(headers or {}),
        data=data,
        method=method,
    )
    try:
        with urlopen(request_obj, timeout=timeout) as response:
            status_value = getattr(response, "status", None)
            if status_value is None:
                status_value = response.getcode()
            status = int(status_value)
            body = response.read() if validator is not None else response.read(1)
            is_usable = status < 400
            if validator is not None and is_usable:
                is_usable = bool(validator(body))
            return {
                "reachable": status < 500,
                "usable": is_usable,
                "status": status,
                "detail": f"HTTP {status}",
                "latency_ms": max(0, round((monotonic() - started_at) * 1000)),
            }
    except HTTPError as exc:
        return {
            "reachable": exc.code < 500,
            "usable": False,
            "status": int(exc.code),
            "detail": _exception_diagnostic(exc),
            "latency_ms": max(0, round((monotonic() - started_at) * 1000)),
        }
    except (OSError, URLError, TimeoutError, ValueError, RemoteDisconnected) as exc:
        return {
            "reachable": False,
            "usable": False,
            "status": None,
            "detail": _exception_diagnostic(exc),
            "latency_ms": max(0, round((monotonic() - started_at) * 1000)),
        }


def _response_detail(outcome: Mapping[str, object]) -> str:
    detail = str(outcome.get("detail") or "Network response")
    latency = outcome.get("latency_ms")
    return f"{detail} in {latency} ms" if latency is not None else detail


def _valid_yahoo_chart_payload(body: bytes) -> bool:
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return False
    result = ((payload.get("chart") or {}).get("result") or []) if isinstance(payload, dict) else []
    if not result or not isinstance(result[0], dict):
        return False
    meta = result[0].get("meta") or {}
    timestamp = result[0].get("timestamp") or []
    return bool(meta.get("symbol") == "AAPL" and timestamp)


def _valid_sec_payload(body: bytes) -> bool:
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return False
    return isinstance(payload, dict) and isinstance(payload.get("filings"), dict)


def _valid_sec_facts_payload(body: bytes) -> bool:
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return False
    return isinstance(payload, dict) and isinstance(payload.get("facts"), dict)


def _probe_yahoo_service() -> dict[str, object]:
    started_at = monotonic()
    if is_remote_market_access_disabled():
        return _network_result(
            "market",
            "disabled",
            f"Remote market access is disabled by {REMOTE_MARKET_ACCESS_ENV}; local market data remains available.",
            started_at,
            endpoint=YAHOO_CHART_URL,
        )

    request_outcome = _http_probe(
        YAHOO_CHART_URL,
        headers={"User-Agent": "Mozilla/5.0"},
        validator=_valid_yahoo_chart_payload,
    )
    if bool(request_outcome.get("usable")):
        return _network_result(
            "market",
            "available",
            f"Yahoo Finance Chart is reachable through the verified HTTP(S) transport ({_response_detail(request_outcome)}).",
            started_at,
            is_available=True,
            endpoint=YAHOO_CHART_URL,
        )

    # yfinance uses curl_cffi, so test its transport separately when urllib fails.
    try:
        response = get_yfinance_session().get(
            YAHOO_CHART_URL,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=NETWORK_HTTP_TIMEOUT_SECONDS,
        )
        status = int(response.status_code)
        payload_is_valid = status < 400 and _valid_yahoo_chart_payload(response.content)
        curl_outcome = {
            "usable": payload_is_valid,
            "detail": f"HTTP {status} via yfinance transport",
            "latency_ms": max(0, round((monotonic() - started_at) * 1000)),
        }
        if payload_is_valid:
            return _network_result(
                "market",
                "available",
                f"Yahoo Finance Chart is reachable through the yfinance transport ({_response_detail(curl_outcome)}).",
                started_at,
                is_available=True,
                endpoint=YAHOO_CHART_URL,
            )
    except Exception as exc:  # noqa: BLE001
        curl_outcome = {"detail": _exception_diagnostic(exc)}

    return _network_result(
        "market",
        "unavailable",
        "Yahoo Finance could not return a valid Chart response. "
        f"Verified HTTP(S): {_response_detail(request_outcome)}; "
        f"yfinance transport: {curl_outcome.get('detail', 'not available')}.",
        started_at,
        endpoint=YAHOO_CHART_URL,
    )


def _probe_fallback_http_service(
        key: str,
        label: str,
        remote_urls: tuple[str, ...],
        *,
        headers: Mapping[str, str] | None = None,
) -> dict[str, object]:
    started_at = monotonic()
    with ThreadPoolExecutor(max_workers=len(remote_urls)) as executor:
        futures = [
            executor.submit(_http_probe, remote_url, headers=headers)
            for remote_url in remote_urls
        ]
        outcomes = [future.result() for future in futures]
    usable_urls = [
        remote_url
        for remote_url, outcome in zip(remote_urls, outcomes, strict=True)
        if bool(outcome.get("usable"))
    ]
    reachable = any(bool(outcome.get("reachable")) for outcome in outcomes)
    if usable_urls:
        hosts = [remote_url.split("/", maxsplit=3)[2] for remote_url in usable_urls]
        provider_summary = ", ".join(dict.fromkeys(hosts))
        return _network_result(
            key,
            "available",
            f"{label}: {len(usable_urls)}/{len(remote_urls)} provider endpoints returned usable responses "
            f"({provider_summary}).",
            started_at,
            is_available=True,
            endpoint=usable_urls[0],
        )
    last_detail = _response_detail(outcomes[-1]) if outcomes else "No response"
    return _network_result(
        key,
        "unavailable",
        f"{label} did not return a usable response. "
        f"The last provider result was {last_detail}; "
        f"transport reachable: {'yes' if reachable else 'no'}.",
        started_at,
        endpoint=remote_urls[0] if remote_urls else "",
    )


def _probe_sec_service() -> dict[str, object]:
    started_at = monotonic()
    endpoint_definitions = (
        ("submissions", SEC_PING_URL, _valid_sec_payload),
        ("company facts", SEC_FACTS_PING_URL, _valid_sec_facts_payload),
        ("www.sec.gov", SEC_WEB_PING_URL, None),
    )
    outcomes: dict[str, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=len(endpoint_definitions)) as executor:
        futures = {
            executor.submit(
                _http_probe,
                remote_url,
                headers={"User-Agent": SEC_USER_AGENT, "Accept": "application/json"},
                validator=validator,
            ): label
            for label, remote_url, validator in endpoint_definitions
        }
        for future in as_completed(futures):
            label = futures[future]
            try:
                outcomes[label] = future.result()
            except Exception as exc:  # noqa: BLE001
                outcomes[label] = {
                    "reachable": False,
                    "usable": False,
                    "detail": _exception_diagnostic(exc),
                }

    submissions_outcome = outcomes.get("submissions", {})
    facts_outcome = outcomes.get("company facts", {})
    web_outcome = outcomes.get("www.sec.gov", {})
    if (
        bool(submissions_outcome.get("usable"))
        and bool(facts_outcome.get("usable"))
        and bool(web_outcome.get("reachable"))
    ):
        endpoint_details = "; ".join(
            (
                f"{label}: {_response_detail(outcomes.get(label, {}))}"
                if label != "www.sec.gov"
                else f"{label} transport: {_response_detail(outcomes.get(label, {}))}"
            )
            for label, _, _ in endpoint_definitions
        )
        return _network_result(
            "sec",
            "available",
            f"SEC EDGAR submissions, company facts, and archive-host transport are usable ({endpoint_details}).",
            started_at,
            is_available=True,
            endpoint=SEC_PING_URL,
        )
    endpoint_details = "; ".join(
        f"{label}: {_response_detail(outcomes.get(label, {}))}"
        for label, _, _ in endpoint_definitions
    )
    return _network_result(
        "sec",
        "unavailable",
        f"SEC EDGAR did not pass all required endpoint checks ({endpoint_details}). "
        "A compliant SEC User-Agent is sent; check regional restrictions, proxy rules, or TLS trust.",
        started_at,
        endpoint=SEC_PING_URL,
    )


def _probe_longbridge_service(broker_settings: object) -> dict[str, object]:
    started_at = monotonic()
    selected_broker = str(getattr(broker_settings, "selected_broker", "longbridge") or "").strip().lower()
    if selected_broker != "longbridge":
        return _network_result(
            "longbridge",
            "not_applicable",
            "Longbridge is not selected. IBKR is file-import-only in this application, so no broker network session is opened here.",
            started_at,
            endpoint=LONGBRIDGE_OPENAPI_PING_URL,
        )

    outcome = _http_probe(
        LONGBRIDGE_OPENAPI_PING_URL,
        headers={"User-Agent": "worthward/1.0", "Accept": "application/json"},
    )
    if bool(outcome.get("reachable")):
        return _network_result(
            "longbridge",
            "available",
            "Longbridge OpenAPI transport is reachable "
            f"({_response_detail(outcome)}). Account authentication and quote permissions are not submitted by this page; use Broker access to test those.",
            started_at,
            is_available=True,
            endpoint=LONGBRIDGE_OPENAPI_PING_URL,
        )
    return _network_result(
        "longbridge",
        "unavailable",
        f"Longbridge OpenAPI transport is not reachable ({_response_detail(outcome)}). "
        "The page did not send credentials or an order request.",
        started_at,
        endpoint=LONGBRIDGE_OPENAPI_PING_URL,
    )


def _probe_smtp_service(smtp_settings: object) -> dict[str, object]:
    started_at = monotonic()
    host = str(getattr(smtp_settings, "host", "") or "").strip()
    try:
        port = int(getattr(smtp_settings, "port", 0) or 0)
    except (TypeError, ValueError):
        port = 0
    mailbox = str(
        getattr(smtp_settings, "from_email", "")
        or getattr(smtp_settings, "username", "")
        or ""
    ).strip()
    has_password = bool(str(getattr(smtp_settings, "password", "") or ""))
    if not host or not port:
        return _network_result(
            "smtp",
            "not_configured",
            "SMTP host and port are not configured. No mailbox credentials were used.",
            started_at,
        )

    try:
        with smtplib.SMTP(host, port, timeout=NETWORK_SMTP_TIMEOUT_SECONDS) as client:
            client.ehlo()
            if bool(getattr(smtp_settings, "use_starttls", True)):
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
    except (OSError, smtplib.SMTPException, ssl.SSLError, TimeoutError) as exc:
        return _network_result(
            "smtp",
            "unavailable",
            f"SMTP transport {host}:{port} did not complete its TLS handshake ({_exception_diagnostic(exc)}). "
            "HTTP proxy settings do not tunnel SMTP; use a reachable SMTP relay when direct TCP egress is restricted.",
            started_at,
            endpoint=f"{host}:{port}",
        )

    if not mailbox or not has_password:
        return _network_result(
            "smtp",
            "not_configured",
            f"SMTP transport {host}:{port} is reachable, but a Yahoo mailbox and app password are not configured. "
            "Credentials are never submitted by the network self-check.",
            started_at,
            endpoint=f"{host}:{port}",
        )
    return _network_result(
        "smtp",
        "available",
        f"SMTP transport {host}:{port} completed its TLS handshake. The saved mailbox and app password were not submitted.",
        started_at,
        is_available=True,
        endpoint=f"{host}:{port}",
    )


def network_transport_summary() -> dict[str, str]:
    """Describe safe, non-secret transport configuration for the Settings page."""
    proxy_detected = any(
        str(os.environ.get(name, "") or "").strip()
        for name in (
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
            "ALL_PROXY",
            "all_proxy",
        )
    )
    no_proxy_configured = any(
        str(os.environ.get(name, "") or "").strip()
        for name in ("NO_PROXY", "no_proxy")
    )
    custom_ca_configured = bool(read_compatible_environment(
        "WORTHWARD_YAHOO_CA_PEM",
        "ANTIGRAVITY_YAHOO_CA_PEM",
    ))
    return {
        "proxy": "configured" if proxy_detected else "not detected",
        "no_proxy": "configured" if no_proxy_configured else "not configured",
        "tls": "custom CA plus public roots" if custom_ca_configured else "verified public/system roots",
        "smtp": "direct TCP",
    }


def network_transport_note() -> str:
    transport = network_transport_summary()
    return (
        "Checks run from the application host. "
        f"HTTP(S) proxy: {transport['proxy']}; TLS trust: {transport['tls']}; "
        "SMTP: direct TCP; account credentials are not submitted by this page."
    )


def run_network_self_check(
        *,
        smtp_settings: object,
        broker_settings: object,
) -> dict[str, object]:
    """Run every fixed external dependency check concurrently and independently."""
    probe_functions: dict[str, Callable[[], dict[str, object]]] = {
        "market": _probe_yahoo_service,
        "sec": _probe_sec_service,
        "longbridge": lambda: _probe_longbridge_service(broker_settings),
        "logo": lambda: _probe_fallback_http_service(
            "logo",
            "Logo providers",
            (PRIMARY_LOGO_PING_URL, *FALLBACK_LOGO_PING_URLS),
            headers={"User-Agent": "Mozilla/5.0"},
        ),
        "google-hk": lambda: _probe_fallback_http_service(
            "google-hk",
            "Google (Hong Kong)",
            GOOGLE_HK_PING_URLS,
            headers={"User-Agent": "Mozilla/5.0"},
        ),
        "smtp": lambda: _probe_smtp_service(smtp_settings),
    }
    results: dict[str, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=len(probe_functions)) as executor:
        futures = {
            executor.submit(probe,): key
            for key, probe in probe_functions.items()
        }
        for future in as_completed(futures):
            key = futures[future]
            started_at = monotonic()
            try:
                results[key] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[key] = _unexpected_network_result(key, exc, started_at)

    ordered_rows = [results[key] for key in probe_functions]
    return {
        "rows": ordered_rows,
        "transport": network_transport_summary(),
        "transport_note": network_transport_note(),
    }


def is_remote_market_access_disabled(environ: Mapping[str, str] | None = None) -> bool:
    """Return whether this process explicitly disables remote market access."""
    environment = os.environ if environ is None else environ
    value = read_compatible_environment(
        REMOTE_MARKET_ACCESS_ENV,
        LEGACY_REMOTE_MARKET_ACCESS_ENV,
        environ=environment,
    ).lower()
    return value in {"0", "disabled", "false", "off"}


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
    log_buffer = io.StringIO()
    yfinance_logger = logging.getLogger("yfinance")
    diagnostic_handler = logging.StreamHandler(log_buffer)
    diagnostic_handler.setLevel(logging.ERROR)
    previous_propagate = yfinance_logger.propagate
    yfinance_logger.addHandler(diagnostic_handler)
    yfinance_logger.propagate = False
    try:
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
    finally:
        yfinance_logger.propagate = previous_propagate
        yfinance_logger.removeHandler(diagnostic_handler)
        diagnostic_handler.close()
    return not probe.empty and "Close" in probe.columns


def has_remote_market_access() -> bool:
    global _remote_market_access_cache

    if is_remote_market_access_disabled():
        return False

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


def reset_connectivity_caches() -> None:
    global _remote_market_access_cache, _remote_logo_access_cache
    _remote_market_access_cache = None
    _remote_logo_access_cache = None
