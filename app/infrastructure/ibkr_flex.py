"""
IBKR Flex Web Service v3 client (reporting-only).

Code version: v1.0.2

This module implements read-only import via IBKR Flex Web Service version 3.
It provides no trading, order placement, market data, realtime positions,
or authenticated brokerage session functionality.

Security model:
- Tokens and query IDs are resolved only from environment variables at call time.
- Tokens are never logged, never written to any settings file or ledger JSON.
- All token-bearing URLs are redacted before any exception, log, or debug output.
- Response URLs are strictly validated to prevent SSRF (only *.interactivebrokers.com over HTTPS).
- XML is parsed without external entity resolution.
- Response size is bounded.
- Only synthetic/scrubbed test fixtures contain no real credentials.

Protocol references (official):
- https://www.ibkrguides.com/brokerportal/performanceandstatements/flex3.htm
- https://www.ibkrguides.com/clientportal/performanceandstatements/flex.htm
- https://www.ibkrguides.com/complianceportal/complianceportal/version3errorcodes.htm

SendRequest (default):
    https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest
    ?t=<token>&q=<queryId>&v=3[&fd=YYYYMMDD][&td=YYYYMMDD]

The response provides a ReferenceCode and a response Url.
GetStatement re-uses the returned Url (or equivalent host) passing t + q=ReferenceCode + v=3.

Error handling:
- Documented Flex v3 codes are classified explicitly.
- 1019 (statement generation in progress) is treated as normal transient polling condition.
- Only documented transient conditions trigger retry with bounded exponential backoff + jitter.
- Permanent errors (auth, config, validation) fail fast without retry.
- Original IBKR error code and a sanitized message are preserved.
"""

from __future__ import annotations

import random
import re
import time
from typing import Any
import os
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

DEFAULT_FLEX_SEND_REQUEST_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest"
FLEX_VERSION = "3"
FLEX_USER_AGENT = "antigravity-ibkr-flex/2 (+https://github.com/Lightwing-Ng/compareStocks)"
MAX_FLEX_STATEMENT_BYTES = 64 * 1024 * 1024  # 64 MiB safety bound

# Polling limits (bounded)
POLL_MAX_ATTEMPTS = 45
POLL_INITIAL_DELAY_SECONDS = 1.0
POLL_MAX_DELAY_SECONDS = 20.0
POLL_TOTAL_TIMEOUT_SECONDS = 300.0

# Documented Flex v3 error codes (from official IBKR references)
# See https://www.ibkrguides.com/complianceportal/complianceportal/version3errorcodes.htm
FLEX_ERROR_MESSAGES: dict[str, str] = {
    "1003": "Statement is not available. This usually means there is no data for the requested date range, the Flex Query is not enabled for Web Service, or the query must be run manually in Client Portal at least once before using via API.",
    "1012": "Flex token expired. Generate a new token under Performance & Reports > Flex Queries > Flex Web Service Configuration.",
    "1013": "IP address restriction. Update the allowed IPs for the Flex token in Client Portal.",
    "1014": "Flex query is invalid or no longer exists. Verify the Query ID in Client Portal.",
    "1015": "Flex token is invalid. Confirm the token value and that Web Service access is enabled.",
    "1016": "Account is invalid for this token or query. Check the account filter or query configuration.",
    "1017": "Reference code is invalid or expired. Retry the request to obtain a fresh reference.",
    "1018": "Too many requests. Slow down and retry after a short delay.",
    "1019": "Statement generation in progress.",
    "1020": "Invalid request or request validation failure. Check parameters and query configuration.",
    "1021": "Statement could not be retrieved. The reference may have expired; retry the SendRequest.",
    "1025": "Too many failed attempts. Please wait (e.g. 30-60 minutes), review your Flex token, query configuration, date range (max 365 days), and try again. This is a temporary lockout from repeated invalid requests.",
}

RETRYABLE_FLEX_CODES: frozenset[str] = frozenset({"1018", "1019"})
"""Transient conditions that warrant retry with backoff (rate limit and in-progress)."""

PERMANENT_FLEX_CODES: frozenset[str] = frozenset({
    "1003", "1012", "1013", "1014", "1015", "1016", "1017", "1020", "1021", "1025",
})
"""Authentication, configuration, and validation errors that must fail fast."""


class IbkrFlexError(ValueError):
    """Raised for Flex Web Service failures. Contains sanitized message and optional IBKR code."""

    def __init__(self, message: str, *, code: str | None = None, redacted_url: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.redacted_url = redacted_url

    def __str__(self) -> str:  # pragma: no cover - simple
        if self.code:
            return f"IBKR Flex error {self.code}: {super().__str__()}"
        return super().__str__()


_TOKEN_RE = re.compile(r"([?&]t=)[^&]+", re.IGNORECASE)


def redact_flex_token_from_url(url: str | None) -> str:
    """Redact the t= token parameter from any URL for safe logging or error messages."""
    if not url:
        return ""
    return _TOKEN_RE.sub(r"\1REDACTED", url)


def _validate_https_ibkr_host(url: str) -> None:
    """Enforce HTTPS and approved IBKR host only. Raises on SSRF risk."""
    if not isinstance(url, str) or not url:
        raise IbkrFlexError("Flex response URL is empty.")
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise IbkrFlexError("Flex response URL must use HTTPS.")
    if parsed.username or parsed.password:
        raise IbkrFlexError("Flex response URL must not embed credentials.")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not (host == "interactivebrokers.com" or host.endswith(".interactivebrokers.com")):
        raise IbkrFlexError(f"Flex response URL uses unapproved host: {host}")
    # Path must look like a statement endpoint (heuristic, do not hard-require specific path)
    if parsed.path and "getstatement" not in parsed.path.lower() and "flex" not in parsed.path.lower():
        # Still allow; IBKR may use opaque paths. We already validated host+scheme.
        pass


def _build_get_statement_url(response_url: str, token: str, reference_code: str) -> str:
    """Construct the GetStatement URL using the response Url returned by SendRequest."""
    _validate_https_ibkr_host(response_url)
    parsed = urlparse(response_url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    # Replace or set the required params per contract (token is always the real one here)
    query["t"] = [token]
    query["q"] = [reference_code]
    query["v"] = [FLEX_VERSION]
    # Remove any stale token-bearing value if present
    new_query = urlencode(query, doseq=True)
    rebuilt = urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path or "/",
        parsed.params,
        new_query,
        parsed.fragment,
    ))
    _validate_https_ibkr_host(rebuilt)
    return rebuilt


def _safe_xml_from_bytes(data: bytes) -> ET.Element:
    """Parse XML without external entity resolution and with size guard."""
    if len(data) > MAX_FLEX_STATEMENT_BYTES:
        raise IbkrFlexError("Flex statement response exceeded size limit.")
    # stdlib ET.XMLParser does not resolve external entities over network by default.
    # We avoid feeding untrusted DTDs and do not use xml.sax with external.
    try:
        parser = ET.XMLParser()
        return ET.fromstring(data, parser=parser)
    except ET.ParseError as exc:
        raise IbkrFlexError("Malformed XML in Flex response.") from exc


def _extract_text(el: ET.Element | None, tag: str) -> str | None:
    if el is None:
        return None
    node = el.find(tag)
    if node is not None and node.text:
        return node.text.strip()
    # namespace tolerant fallback
    for child in list(el):
        if child.tag.endswith("}" + tag) or child.tag == tag:
            return (child.text or "").strip() or None
    return None


def _find_status_and_error(root: ET.Element) -> tuple[str | None, str | None, str | None]:
    """Return (status, error_code, error_message) tolerating namespaces."""
    status = _extract_text(root, "Status")
    code = _extract_text(root, "ErrorCode")
    msg = _extract_text(root, "ErrorMessage")
    if not code:
        # Some responses embed under different containers
        for tag in ("ErrorCode", "code"):
            c = _extract_text(root, tag)
            if c:
                code = c
                break
    if not msg and code and code in FLEX_ERROR_MESSAGES:
        msg = FLEX_ERROR_MESSAGES[code]
    return status, code, msg


def send_flex_request(
    *,
    token: str,
    query_id: str,
    send_request_url: str = DEFAULT_FLEX_SEND_REQUEST_URL,
    from_date: str | None = None,  # YYYYMMDD
    to_date: str | None = None,    # YYYYMMDD
    timeout_seconds: float = 30.0,
) -> tuple[str, str]:
    """
    Perform SendRequest. Returns (reference_code, response_url).

    Never logs or includes the raw token in exceptions.
    """
    if not token or not str(token).strip():
        raise IbkrFlexError("IBKR_FLEX_TOKEN is empty.")
    if not query_id or not str(query_id).strip():
        raise IbkrFlexError("Flex Activity Query ID is empty.")

    params: dict[str, str] = {
        "t": str(token).strip(),
        "q": str(query_id).strip(),
        "v": FLEX_VERSION,
    }
    if from_date:
        params["fd"] = str(from_date).strip()
    if to_date:
        params["td"] = str(to_date).strip()

    base = send_request_url.rstrip("?")
    sep = "&" if "?" in base else "?"
    # Build for request (we will redact in any error path)
    request_url = f"{base}{sep}{urlencode(params)}"

    req = Request(
        request_url,
        headers={
            "User-Agent": FLEX_USER_AGENT,
            "Accept": "application/xml, text/xml, */*",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=timeout_seconds) as resp:
            body = resp.read()
    except HTTPError as exc:
        body = b""
        try:
            body = exc.read() or b""
        except Exception:
            pass
        text = body.decode("utf-8", errors="replace").strip()
        redacted = redact_flex_token_from_url(str(exc) + " " + text)
        raise IbkrFlexError(f"SendRequest HTTP {exc.code}. {redacted}") from exc
    except URLError as exc:
        redacted = redact_flex_token_from_url(str(exc))
        raise IbkrFlexError(f"SendRequest network error: {redacted}") from exc
    except TimeoutError as exc:
        raise IbkrFlexError("SendRequest timed out.") from exc

    if not body:
        raise IbkrFlexError("SendRequest returned empty response.")

    root = _safe_xml_from_bytes(body)
    status, code, msg = _find_status_and_error(root)
    if status and status.lower() != "success":
        if code:
            human = FLEX_ERROR_MESSAGES.get(code, msg or "Unknown Flex error")
            redacted_any = redact_flex_token_from_url(request_url)
            raise IbkrFlexError(human, code=code, redacted_url=redacted_any)
        redacted_any = redact_flex_token_from_url(request_url)
        raise IbkrFlexError(f"SendRequest failed with status {status}.", redacted_url=redacted_any)

    ref_code = _extract_text(root, "ReferenceCode") or _extract_text(root, "referenceCode")
    resp_url = _extract_text(root, "Url") or _extract_text(root, "url")

    if not ref_code:
        raise IbkrFlexError("SendRequest response did not contain a ReferenceCode.")
    if not resp_url:
        # Some responses may embed differently; allow minimal fallback but validate later
        resp_url = ""

    redacted_resp = redact_flex_token_from_url(resp_url)
    if resp_url:
        _validate_https_ibkr_host(resp_url)
    return ref_code, resp_url


def _sleep_with_jitter(delay: float) -> None:
    jitter = random.uniform(0.0, min(1.0, delay * 0.3))
    time.sleep(delay + jitter)


def get_flex_statement(
    *,
    response_url: str,
    token: str,
    reference_code: str,
    timeout_seconds: float = 60.0,
) -> bytes:
    """
    Poll GetStatement until ready. Returns raw XML bytes of the statement when Status=Success.
    """
    if not response_url:
        raise IbkrFlexError("No response URL returned by SendRequest.")
    _validate_https_ibkr_host(response_url)

    start = time.monotonic()
    delay = POLL_INITIAL_DELAY_SECONDS

    for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
        elapsed = time.monotonic() - start
        if elapsed > POLL_TOTAL_TIMEOUT_SECONDS:
            raise IbkrFlexError("Flex statement was not ready within the allowed time.")

        get_url = _build_get_statement_url(response_url, token, reference_code)
        req = Request(
            get_url,
            headers={
                "User-Agent": FLEX_USER_AGENT,
                "Accept": "application/xml, text/xml, */*",
            },
            method="GET",
        )
        try:
            with urlopen(req, timeout=timeout_seconds) as resp:
                body = resp.read()
        except HTTPError as exc:
            body_text = ""
            try:
                body_text = (exc.read() or b"").decode("utf-8", errors="replace")
            except Exception:
                pass
            red = redact_flex_token_from_url(body_text or str(exc))
            # Treat 4xx/5xx during polling as possibly transient for 1019-like, but classify
            if exc.code in (429, 503):
                # transient rate-ish
                if attempt == POLL_MAX_ATTEMPTS:
                    raise IbkrFlexError(f"GetStatement HTTP {exc.code}. {red}") from exc
                _sleep_with_jitter(delay)
                delay = min(delay * 1.7, POLL_MAX_DELAY_SECONDS)
                continue
            raise IbkrFlexError(f"GetStatement HTTP {exc.code}. {red}") from exc
        except URLError as exc:
            if attempt == POLL_MAX_ATTEMPTS:
                raise IbkrFlexError(f"GetStatement network error: {redact_flex_token_from_url(str(exc))}") from exc
            _sleep_with_jitter(delay)
            delay = min(delay * 1.7, POLL_MAX_DELAY_SECONDS)
            continue
        except TimeoutError:
            if attempt == POLL_MAX_ATTEMPTS:
                raise IbkrFlexError("GetStatement timed out.")
            _sleep_with_jitter(delay)
            continue

        if not body:
            _sleep_with_jitter(delay)
            delay = min(delay * 1.7, POLL_MAX_DELAY_SECONDS)
            continue

        root = _safe_xml_from_bytes(body)
        status, code, msg = _find_status_and_error(root)

        if status and status.lower() == "success":
            # The body may be the wrapper or the full FlexQueryResponse.
            # Caller will inspect for usable content.
            return body

        if code:
            human = FLEX_ERROR_MESSAGES.get(code, msg or "Flex error during polling")
            if code in RETRYABLE_FLEX_CODES:
                # 1019 and 1018: keep polling
                if attempt == POLL_MAX_ATTEMPTS:
                    raise IbkrFlexError(human, code=code)
                _sleep_with_jitter(delay)
                delay = min(delay * 1.7, POLL_MAX_DELAY_SECONDS)
                continue
            # Permanent error
            red = redact_flex_token_from_url(get_url)
            raise IbkrFlexError(human, code=code, redacted_url=red)

        # No explicit code but not success: keep trying a few times
        if attempt >= 3:
            # If we see XML with FlexStatements already, return it (some responses omit top Status)
            if root.find(".//FlexStatement") is not None or root.find(".//Trades") is not None:
                return body

        _sleep_with_jitter(delay)
        delay = min(delay * 1.7, POLL_MAX_DELAY_SECONDS)

    raise IbkrFlexError("Flex statement polling exhausted without a usable Success response.")


def fetch_ibkr_flex_statement(
    *,
    token: str,
    query_id: str,
    send_request_url: str = DEFAULT_FLEX_SEND_REQUEST_URL,
    from_date: str | None = None,
    to_date: str | None = None,
) -> bytes:
    """
    High-level helper: SendRequest -> poll GetStatement -> return raw statement XML.
    """
    ref, resp_url = send_flex_request(
        token=token,
        query_id=query_id,
        send_request_url=send_request_url,
        from_date=from_date,
        to_date=to_date,
    )
    return get_flex_statement(
        response_url=resp_url or "",
        token=token,
        reference_code=ref,
    )


def is_flex_token_present(env_name: str) -> bool:
    """Check presence without reading value for display."""
    val = (env_name or "").strip()
    if not val:
        val = "IBKR_FLEX_TOKEN"
    return bool(os.environ.get(val, "").strip())


def is_flex_query_id_present(env_name: str) -> bool:
    val = (env_name or "").strip()
    if not val:
        val = "IBKR_FLEX_ACTIVITY_QUERY_ID"
    return bool(os.environ.get(val, "").strip())


__all__ = [
    "DEFAULT_FLEX_SEND_REQUEST_URL",
    "IbkrFlexError",
    "send_flex_request",
    "get_flex_statement",
    "fetch_ibkr_flex_statement",
    "redact_flex_token_from_url",
    "is_flex_token_present",
    "is_flex_query_id_present",
    "RETRYABLE_FLEX_CODES",
    "PERMANENT_FLEX_CODES",
    "FLEX_ERROR_MESSAGES",
]
