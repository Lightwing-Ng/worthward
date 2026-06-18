"""
Optional debug event reporting helpers.

Code version: v0.1.0
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

DEFAULT_DEBUG_SERVER_URL = "http://127.0.0.1:7777/event"
DEBUG_CONFIG_DIR = Path(".dbg")


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

    payload = json.dumps(
        {
            "sessionId": debug_config["sessionId"],
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "msg": f"[DEBUG] {msg}",
            "data": data or {},
        }
    ).encode("utf-8")
    try:
        urlopen(
            Request(
                debug_config["url"],
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=timeout_seconds,
        ).read()
    except Exception:
        pass
