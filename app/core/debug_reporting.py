"""
Optional debug event reporting helpers.

Code version: v0.2.0
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import lru_cache
import ipaddress
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

DEFAULT_DEBUG_SERVER_URL = "http://127.0.0.1:7777/event"
DEBUG_CONFIG_DIR = Path(".dbg")
REDACTED_DEBUG_VALUE = "[REDACTED]"
_SENSITIVE_DEBUG_KEY_NAMES = frozenset({
    "accesskey",
    "accesstoken",
    "apikey",
    "auth",
    "authorization",
    "authtoken",
    "bearer",
    "bearertoken",
    "clientsecret",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "idtoken",
    "jwt",
    "password",
    "passwd",
    "privatekey",
    "refreshtoken",
    "secret",
    "secretkey",
    "session",
    "sessionid",
    "setcookie",
    "token",
})
_BEARER_TOKEN_PATTERN = re.compile(
    r"\bBearer\s+[A-Za-z0-9._~+/=-]+",
    re.IGNORECASE,
)
_JWT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_-])(?:m_)?eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])"
)
_SENSITIVE_TEXT_ASSIGNMENT_PATTERN = re.compile(
    r"""
    (?P<prefix>
        (?<![A-Za-z0-9_-])
        (?:[\"'])?
        (?:
            api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|
            auth(?:orization)?|bearer(?:[_-]?token)?|password|passwd|secret|
            client[_-]?secret|private[_-]?key|credential(?:s)?|cookie|
            set[_-]?cookie|session(?:[_-]?id)?|jwt|token
        )
        (?:[\"'])?
        (?![A-Za-z0-9_-])
        \s*[:=]\s*
    )
    (?:(?:Bearer|Basic|Token)\s+)?
    (?:\[REDACTED\]|\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;}\]]+)
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _is_loopback_debug_url(url: str) -> bool:
    """Return whether a debug endpoint uses HTTP(S) on a loopback host."""
    if not url or any(character.isspace() for character in url):
        return False

    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        return False

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or "@" in parsed.netloc:
        return False
    if port is not None and not 1 <= port <= 65535:
        return False

    host_port = parsed.netloc.rsplit("@", maxsplit=1)[-1]
    if host_port.endswith(":"):
        return False

    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "localhost."}:
        return True

    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def _is_sensitive_debug_key(key: object) -> bool:
    normalized_key = re.sub(r"[^a-z0-9]", "", str(key).lower())
    if normalized_key in _SENSITIVE_DEBUG_KEY_NAMES:
        return True
    return normalized_key.endswith((
        "token",
        "password",
        "passwd",
        "secret",
        "credential",
        "cookie",
    ))


def _redact_debug_text(value: str) -> str:
    """Redact recognizable authentication material from free-form debug text."""
    redacted = _SENSITIVE_TEXT_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group('prefix')}{REDACTED_DEBUG_VALUE}",
        value,
    )
    redacted = _BEARER_TOKEN_PATTERN.sub(f"Bearer {REDACTED_DEBUG_VALUE}", redacted)
    return _JWT_PATTERN.sub(REDACTED_DEBUG_VALUE, redacted)


def _sanitize_debug_payload(value: Any, *, key: object | None = None) -> Any:
    """Return a recursively redacted copy suitable for optional debug reporting."""
    if key is not None and _is_sensitive_debug_key(key):
        return REDACTED_DEBUG_VALUE
    if isinstance(value, str):
        return _redact_debug_text(value)
    if isinstance(value, Mapping):
        return {
            item_key: _sanitize_debug_payload(item_value, key=item_key)
            for item_key, item_value in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_debug_payload(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_debug_payload(item) for item in value)
    return value


@lru_cache(maxsize=None)
def load_optional_debug_endpoint(env_file_name: str, default_session_id: str) -> dict[str, str] | None:
    env_path = DEBUG_CONFIG_DIR / env_file_name
    if not env_path.exists():
        return None

    url = DEFAULT_DEBUG_SERVER_URL
    session_id = default_session_id
    try:
        with env_path.open(encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                cleaned_value = value.strip()
                if key == "DEBUG_SERVER_URL" and cleaned_value:
                    url = cleaned_value
                elif key == "DEBUG_SESSION_ID" and cleaned_value:
                    session_id = cleaned_value
    except OSError:
        return None

    if not _is_loopback_debug_url(url):
        return None

    return {
        "url": url,
        "sessionId": session_id,
    }


def post_debug_event(
    debug_config: dict[str, str] | None,
    *,
    hypothesis_id: str,
    location: str,
    msg: str,
    data: dict[str, Any] | None = None,
    run_id: str,
    timeout_seconds: float = 0.5,
) -> None:
    if not debug_config:
        return

    try:
        url = debug_config["url"]
        if not _is_loopback_debug_url(url):
            return
        payload = json.dumps(
            {
                "sessionId": debug_config["sessionId"],
                "runId": run_id,
                "hypothesisId": hypothesis_id,
                "location": location,
                "msg": f"[DEBUG] {_redact_debug_text(msg)}",
                "data": _sanitize_debug_payload(data or {}),
            }
        ).encode("utf-8")
        urlopen(
            Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=timeout_seconds,
        ).read()
    except Exception:
        pass
