"""Live trading access-token validation.

Code version: v1.1.1
"""

from __future__ import annotations

import os
import secrets

LIVE_TRADING_TOKEN_ENV = "ANTIGRAVITY_LIVE_TRADING_TOKEN"
LIVE_TRADING_TOKEN_HEADER = "X-Antigravity-Live-Trading-Token"
MIN_LIVE_TRADING_TOKEN_LENGTH = 32
LIVE_TRADING_PIN_ENV = "ANTIGRAVITY_LIVE_TRADING_PIN"
LIVE_TRADING_PIN_LENGTH = 6


def load_live_trading_access_token() -> str:
    return str(os.environ.get(LIVE_TRADING_TOKEN_ENV, "")).strip()


def resolve_live_trading_pin(configured_pin: object) -> str:
    environment_pin = str(os.environ.get(LIVE_TRADING_PIN_ENV, "")).strip()
    if environment_pin:
        return environment_pin
    return str(configured_pin or "").strip()


def validate_live_trading_pin(
        presented_pin: str | None,
        configured_pin: object,
) -> tuple[bool, int, str]:
    resolved_pin = resolve_live_trading_pin(configured_pin)
    if len(resolved_pin) != LIVE_TRADING_PIN_LENGTH or not resolved_pin.isdigit():
        return (
            False,
            503,
            f"Live trading is locked. Configure a {LIVE_TRADING_PIN_LENGTH}-digit PIN.",
        )

    normalized_presented_pin = str(presented_pin or "").strip()
    if not secrets.compare_digest(normalized_presented_pin, resolved_pin):
        return False, 401, "The PIN is incorrect."

    return True, 200, ""


def validate_live_trading_access_token(presented_token: str | None) -> tuple[bool, int, str]:
    configured_token = load_live_trading_access_token()
    if len(configured_token) < MIN_LIVE_TRADING_TOKEN_LENGTH:
        return (
            False,
            503,
            f"Live trading is locked. Set {LIVE_TRADING_TOKEN_ENV} to a random token of at least "
            f"{MIN_LIVE_TRADING_TOKEN_LENGTH} characters before reading account data or submitting orders.",
        )

    normalized_presented_token = str(presented_token or "").strip()
    if not normalized_presented_token or not secrets.compare_digest(
            normalized_presented_token,
            configured_token,
    ):
        return False, 401, "Live trading access token is missing or invalid."

    return True, 200, ""


def authorize_live_trading_api_request(
    is_pin_session_unlocked: bool,
    presented_token: str | None,
) -> tuple[bool, int, str]:
    """Authorize a live account or order API request through either supported path."""
    if is_pin_session_unlocked:
        return True, 200, ""
    return validate_live_trading_access_token(presented_token)
