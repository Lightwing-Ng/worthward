"""Live trading access-token validation.

Code version: v1.0.0
"""

from __future__ import annotations

import os
import secrets

LIVE_TRADING_TOKEN_ENV = "ANTIGRAVITY_LIVE_TRADING_TOKEN"
LIVE_TRADING_TOKEN_HEADER = "X-Antigravity-Live-Trading-Token"
MIN_LIVE_TRADING_TOKEN_LENGTH = 32


def load_live_trading_access_token() -> str:
    return str(os.environ.get(LIVE_TRADING_TOKEN_ENV, "")).strip()


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
