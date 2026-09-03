"""
Longbridge CLI adapter for local OAuth-based market data access.

Code version: v0.6.0
- Removed: The retired raw authorization-code login path. Browser OAuth is the
  only application-owned authentication entrypoint.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
from threading import Lock
from typing import Any

from app.core.broker_settings import BrokerSettings, resolve_longbridge_cli_home

LOGGER = logging.getLogger(__name__)
DEFAULT_LONGBRIDGE_CLI_CANDIDATES = (
    "longbridge",
    "~/.local/bin/longbridge",
    "/opt/homebrew/bin/longbridge",
    "/usr/local/bin/longbridge",
)
_BROWSER_OAUTH_LOCK = Lock()
_BROWSER_OAUTH_PROCESS: subprocess.Popen[str] | None = None


@dataclass(frozen=True)
class LongbridgeCliResult:
    stdout: str
    stderr: str
    exit_code: int


def _normalize_longbridge_cli_path(candidate: str | None) -> str | None:
    """Return a safe canonical CLI executable path, or ``None`` when invalid."""
    candidate_text = str(candidate or "").strip()
    if not candidate_text or "\x00" in candidate_text:
        return None

    expanded_candidate = os.path.expanduser(candidate_text)
    if not os.path.isabs(expanded_candidate):
        return None

    try:
        resolved_candidate = Path(expanded_candidate).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None

    try:
        if (
            resolved_candidate.name != "longbridge"
            or not resolved_candidate.is_file()
            or not os.access(resolved_candidate, os.X_OK)
        ):
            return None
    except OSError:
        return None

    return str(resolved_candidate)


def resolve_longbridge_cli_path(settings: BrokerSettings) -> str:
    explicit_path = settings.longbridge_cli_path.strip()
    if explicit_path:
        normalized_explicit_path = _normalize_longbridge_cli_path(explicit_path)
        if normalized_explicit_path:
            return normalized_explicit_path
        display_path = explicit_path.replace("\x00", r"\0")
        raise FileNotFoundError(
            f"Longbridge CLI was not found at {display_path}. Update the CLI path in Settings > Broker Access."
        )

    discovered_path = _normalize_longbridge_cli_path(shutil.which("longbridge"))
    if discovered_path:
        return discovered_path

    for candidate in DEFAULT_LONGBRIDGE_CLI_CANDIDATES[1:]:
        candidate_path = _normalize_longbridge_cli_path(candidate)
        if candidate_path:
            return candidate_path

    raise FileNotFoundError(
        "Longbridge CLI is not installed. Install it first, or set the CLI path in Settings > Broker Access."
    )


def _build_longbridge_cli_env(
        settings: BrokerSettings,
        *,
        enable_overnight: bool = False,
) -> dict[str, str]:
    env = os.environ.copy()
    cli_home = resolve_longbridge_cli_home(settings)
    Path(cli_home).mkdir(parents=True, exist_ok=True)
    env["HOME"] = cli_home
    if enable_overnight:
        env["LONGBRIDGE_ENABLE_OVERNIGHT"] = "true"
    return env


def run_longbridge_cli(
        settings: BrokerSettings,
        arguments: list[str],
        *,
        timeout_seconds: int = 30,
        enable_overnight: bool = False,
) -> LongbridgeCliResult:
    cli_path = resolve_longbridge_cli_path(settings)
    completed = subprocess.run(
        [cli_path, *arguments],
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        env=_build_longbridge_cli_env(settings, enable_overnight=enable_overnight),
    )
    return LongbridgeCliResult(
        stdout=completed.stdout.strip(),
        stderr=completed.stderr.strip(),
        exit_code=int(completed.returncode),
    )


def run_longbridge_cli_json(
        settings: BrokerSettings,
        arguments: list[str],
        *,
        timeout_seconds: int = 30,
        enable_overnight: bool = False,
) -> Any:
    result = run_longbridge_cli(
        settings,
        arguments,
        timeout_seconds=timeout_seconds,
        enable_overnight=enable_overnight,
    )
    if result.exit_code != 0:
        stderr = result.stderr or result.stdout or "Longbridge CLI command failed."
        raise RuntimeError(stderr)
    payload = result.stdout.strip()
    if not payload:
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Longbridge CLI returned invalid JSON.") from exc


def get_longbridge_cli_auth_status(settings: BrokerSettings) -> dict[str, Any]:
    payload = run_longbridge_cli_json(
        settings,
        ["auth", "status", "--format", "json"],
        timeout_seconds=20,
    )
    return payload if isinstance(payload, dict) else {}


def start_longbridge_cli_browser_oauth(settings: BrokerSettings) -> tuple[bool, str]:
    """Start the CLI's local browser OAuth flow without receiving any credential."""
    global _BROWSER_OAUTH_PROCESS

    with _BROWSER_OAUTH_LOCK:
        if _BROWSER_OAUTH_PROCESS is not None and _BROWSER_OAUTH_PROCESS.poll() is None:
            return False, "Longbridge browser authorization is already open. Complete it in the browser window."

        try:
            cli_path = resolve_longbridge_cli_path(settings)
            _BROWSER_OAUTH_PROCESS = subprocess.Popen(
                [cli_path, "auth", "login", "--auth-code", "--client-name", "worthward"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                env=_build_longbridge_cli_env(settings),
                start_new_session=True,
            )
        except Exception:
            LOGGER.exception("Could not start Longbridge browser authorization.")
            return False, "Could not start Longbridge browser authorization. Check the CLI path and try again."

    return (
        True,
        "Longbridge authorization opened in your browser. Complete it there, then return here and test the connection.",
    )


def test_longbridge_cli_connection(settings: BrokerSettings) -> tuple[bool, str]:
    try:
        auth_status = get_longbridge_cli_auth_status(settings)
    except Exception:
        LOGGER.exception("Longbridge CLI auth status check failed.")
        return False, "Longbridge CLI auth status failed. Check the CLI path and OAuth session, then try again."

    token_status = str(((auth_status.get("token") or {}).get("status") or "")).strip().lower()
    if token_status != "valid":
        return (
            False,
            "Longbridge CLI is installed, but no valid OAuth session was found. "
            "Start browser authorization from Settings > Broker access, then try again.",
        )

    try:
        quote_payload = run_longbridge_cli_json(
            settings,
            ["quote", "AAPL.US", "--format", "json"],
            timeout_seconds=20,
        )
    except Exception:
        LOGGER.exception("Longbridge CLI quote test failed.")
        return False, "Longbridge CLI quote test failed. Check the CLI path and OAuth session, then try again."

    if isinstance(quote_payload, list) and quote_payload:
        return True, "Successfully connected to Longbridge via CLI OAuth."
    return False, "Longbridge CLI OAuth is authenticated, but the quote command returned no data."
