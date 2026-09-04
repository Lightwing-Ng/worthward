"""
Browser write-request security helpers.

Code version: v0.1.1
"""

from __future__ import annotations

import hmac
import ipaddress
import re
import secrets
from urllib.parse import urlsplit

from flask import Request, session


INVESTMENT_CSRF_SESSION_KEY = "_investment_csrf_token"
INVESTMENT_CSRF_HEADER = "X-CSRF-Token"
_CSRF_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def get_or_create_investment_csrf_token() -> str:
    """Return the session-bound token used by browser investment writes."""
    current = str(session.get(INVESTMENT_CSRF_SESSION_KEY) or "")
    if _CSRF_TOKEN_PATTERN.fullmatch(current):
        return current
    token = secrets.token_urlsafe(32)
    session[INVESTMENT_CSRF_SESSION_KEY] = token
    return token


def _canonical_origin(value: str) -> tuple[str, str, int] | None:
    raw = str(value or "").strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError:
        return None
    scheme = parsed.scheme.lower()
    hostname = str(parsed.hostname or "").lower()
    if (
        scheme not in {"http", "https"}
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        return None
    if port is None:
        port = 443 if scheme == "https" else 80
    return scheme, hostname, port


def _is_local_application_hostname(hostname: str) -> bool:
    normalized = str(hostname or "").strip().lower().rstrip(".")
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


def validate_local_browser_write_request(
    browser_request: Request,
    *,
    action_label: str = "Local changes",
) -> str | None:
    """Return a rejection unless origin and session CSRF proof are valid."""
    origin = _canonical_origin(browser_request.headers.get("Origin", ""))
    expected_origin = _canonical_origin(browser_request.host_url)
    if origin is None or expected_origin is None:
        return f"{action_label} require a valid same-origin browser request."
    if origin != expected_origin or not _is_local_application_hostname(origin[1]):
        return f"{action_label} reject cross-origin or non-local browser requests."

    fetch_site = str(browser_request.headers.get("Sec-Fetch-Site") or "").strip().lower()
    if fetch_site and fetch_site != "same-origin":
        return f"{action_label} reject cross-site browser requests."

    expected_token = str(session.get(INVESTMENT_CSRF_SESSION_KEY) or "")
    supplied_token = str(browser_request.headers.get(INVESTMENT_CSRF_HEADER) or "")
    if (
        not _CSRF_TOKEN_PATTERN.fullmatch(expected_token)
        or not _CSRF_TOKEN_PATTERN.fullmatch(supplied_token)
        or not hmac.compare_digest(expected_token, supplied_token)
    ):
        return f"{action_label} require a valid session security token."
    return None


def validate_investment_browser_write_request(
    browser_request: Request,
) -> str | None:
    """Return a rejection message unless origin and session CSRF proof are valid."""
    return validate_local_browser_write_request(
        browser_request,
        action_label="Investment changes",
    )
