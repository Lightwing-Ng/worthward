"""
Broker connection preferences for local integrations.

Code version: v0.10.0
"""

from __future__ import annotations

from dataclasses import dataclass
import os

from app.core.config import BASE_DIR
from app.core.settings_store import (
    LEGACY_SECTION_PATHS,
    ensure_settings_store_dir,
    load_settings_section,
    save_settings_section,
)

SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
BROKER_SETTINGS_PATH = LEGACY_SECTION_PATHS["brokers"]
# Longbridge CLI owns OAuth tokens in the signed-in user's CLI profile. Keeping
# this outside the application workspace lets an existing terminal session work
# immediately and prevents the web app from retaining OAuth credentials.
DEFAULT_LONGBRIDGE_CLI_HOME = os.path.expanduser("~")

SUPPORTED_BROKERS = ("longbridge", "ibkr")
SUPPORTED_LONGBRIDGE_AUTH_MODES = ("cli_oauth", "legacy_apikey")

# IBKR Flex Web Service v3 (reporting-only). Never persist tokens.
DEFAULT_IBKR_FLEX_SEND_REQUEST_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest"
DEFAULT_IBKR_FLEX_LOOKBACK_DAYS = 30


@dataclass
class BrokerSettings:
    selected_broker: str = "longbridge"
    longbridge_auth_mode: str = ""
    longbridge_cli_path: str = ""
    longbridge_cli_home: str = ""
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""
    # IBKR Flex Web Service configuration (reporting-only; tokens live only in env)
    ibkr_account_id: str = ""
    # Legacy Gateway fields kept for module compatibility in market data fallbacks (no longer functional)
    # Flex secrets are stored directly here (like Longbridge tokens), configured via web UI.
    # No need for terminal export of secrets. The *_env fields below are for backward compat / env fallback only.
    ibkr_flex_token: str = ""
    ibkr_flex_activity_query_id: str = ""
    ibkr_flex_trade_confirm_query_id: str = ""
    ibkr_flex_token_env: str = "IBKR_FLEX_TOKEN"
    ibkr_flex_activity_query_id_env: str = "IBKR_FLEX_ACTIVITY_QUERY_ID"
    ibkr_flex_trade_confirm_query_id_env: str = "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID"
    ibkr_flex_send_request_url: str = DEFAULT_IBKR_FLEX_SEND_REQUEST_URL
    ibkr_flex_lookback_days: int = DEFAULT_IBKR_FLEX_LOOKBACK_DAYS

    def __post_init__(self) -> None:
        self.selected_broker = _normalize_selected_broker(self.selected_broker)
        self.longbridge_auth_mode = _normalize_longbridge_auth_mode(
            self.longbridge_auth_mode,
            has_legacy_credentials=bool(
                str(self.longbridge_app_key or "").strip()
                and str(self.longbridge_app_secret or "").strip()
                and str(self.longbridge_access_token or "").strip()
            ),
        )
        self.longbridge_cli_path = str(self.longbridge_cli_path or "").strip()
        self.longbridge_cli_home = str(self.longbridge_cli_home or "").strip()
        self.longbridge_app_key = str(self.longbridge_app_key or "").strip()
        self.longbridge_app_secret = str(self.longbridge_app_secret or "").strip()
        self.longbridge_access_token = normalize_longbridge_access_token(self.longbridge_access_token)
        self.ibkr_account_id = str(self.ibkr_account_id or "").strip()
        self.ibkr_flex_token = str(self.ibkr_flex_token or "").strip()
        self.ibkr_flex_activity_query_id = str(self.ibkr_flex_activity_query_id or "").strip()
        self.ibkr_flex_trade_confirm_query_id = str(self.ibkr_flex_trade_confirm_query_id or "").strip()
        self.ibkr_flex_token_env = str(self.ibkr_flex_token_env or "IBKR_FLEX_TOKEN").strip() or "IBKR_FLEX_TOKEN"
        self.ibkr_flex_activity_query_id_env = (
            str(self.ibkr_flex_activity_query_id_env or "IBKR_FLEX_ACTIVITY_QUERY_ID").strip()
            or "IBKR_FLEX_ACTIVITY_QUERY_ID"
        )
        self.ibkr_flex_trade_confirm_query_id_env = (
            str(self.ibkr_flex_trade_confirm_query_id_env or "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID").strip()
            or "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID"
        )
        self.ibkr_flex_send_request_url = (
            str(self.ibkr_flex_send_request_url or DEFAULT_IBKR_FLEX_SEND_REQUEST_URL).strip()
            or DEFAULT_IBKR_FLEX_SEND_REQUEST_URL
        )
        try:
            lb = int(self.ibkr_flex_lookback_days)
        except (TypeError, ValueError):
            lb = DEFAULT_IBKR_FLEX_LOOKBACK_DAYS
        self.ibkr_flex_lookback_days = max(1, min(365, lb))


def _normalize_selected_broker(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in SUPPORTED_BROKERS:
        return normalized
    return "longbridge"


def _normalize_longbridge_auth_mode(value: str | None, *, has_legacy_credentials: bool = False) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in SUPPORTED_LONGBRIDGE_AUTH_MODES:
        return normalized
    if has_legacy_credentials:
        return "legacy_apikey"
    return "cli_oauth"


def _strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1].strip()
    return value


def normalize_longbridge_access_token(value: str | None) -> str:
    normalized = _strip_matching_quotes(str(value or "").strip())
    if normalized.lower().startswith("bearer "):
        normalized = _strip_matching_quotes(normalized[7:].strip())
    return normalized


def load_broker_settings() -> BrokerSettings:
    ensure_settings_store_dir()
    payload = load_settings_section("brokers")
    if not payload:
        return BrokerSettings()
    # New Flex fields use environment variables for secrets.
    return BrokerSettings(
        selected_broker=_normalize_selected_broker(payload.get("selected_broker")),
        longbridge_auth_mode=str(payload.get("longbridge_auth_mode", "")).strip(),
        longbridge_cli_path=str(payload.get("longbridge_cli_path", "")).strip(),
        longbridge_cli_home=str(payload.get("longbridge_cli_home", "")).strip(),
        longbridge_app_key=str(payload.get("longbridge_app_key", "")).strip(),
        longbridge_app_secret=str(payload.get("longbridge_app_secret", "")).strip(),
        longbridge_access_token=str(payload.get("longbridge_access_token", "")).strip(),
        ibkr_account_id=str(payload.get("ibkr_account_id", "")).strip(),
        ibkr_flex_token=str(payload.get("ibkr_flex_token", "")).strip(),
        ibkr_flex_activity_query_id=str(payload.get("ibkr_flex_activity_query_id", "")).strip(),
        ibkr_flex_trade_confirm_query_id=str(payload.get("ibkr_flex_trade_confirm_query_id", "")).strip(),
        ibkr_flex_token_env=str(payload.get("ibkr_flex_token_env", "IBKR_FLEX_TOKEN")).strip() or "IBKR_FLEX_TOKEN",
        ibkr_flex_activity_query_id_env=str(
            payload.get("ibkr_flex_activity_query_id_env", "IBKR_FLEX_ACTIVITY_QUERY_ID")
        ).strip() or "IBKR_FLEX_ACTIVITY_QUERY_ID",
        ibkr_flex_trade_confirm_query_id_env=str(
            payload.get("ibkr_flex_trade_confirm_query_id_env", "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID")
        ).strip() or "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID",
        ibkr_flex_send_request_url=str(
            payload.get("ibkr_flex_send_request_url", DEFAULT_IBKR_FLEX_SEND_REQUEST_URL)
        ).strip() or DEFAULT_IBKR_FLEX_SEND_REQUEST_URL,
        ibkr_flex_lookback_days=payload.get("ibkr_flex_lookback_days", DEFAULT_IBKR_FLEX_LOOKBACK_DAYS),
    )


def save_broker_settings(settings: BrokerSettings) -> None:
    ensure_settings_store_dir()
    # OAuth tokens are never handled here; Longbridge CLI owns its token cache.
    payload = {
        "selected_broker": settings.selected_broker,
        "longbridge_auth_mode": settings.longbridge_auth_mode,
        "longbridge_cli_path": settings.longbridge_cli_path,
        "longbridge_cli_home": settings.longbridge_cli_home,
        "longbridge_app_key": settings.longbridge_app_key,
        "longbridge_app_secret": settings.longbridge_app_secret,
        "longbridge_access_token": settings.longbridge_access_token,
        "ibkr_account_id": settings.ibkr_account_id,
        "ibkr_flex_token": settings.ibkr_flex_token,
        "ibkr_flex_activity_query_id": settings.ibkr_flex_activity_query_id,
        "ibkr_flex_trade_confirm_query_id": settings.ibkr_flex_trade_confirm_query_id,
        "ibkr_flex_token_env": settings.ibkr_flex_token_env,
        "ibkr_flex_activity_query_id_env": settings.ibkr_flex_activity_query_id_env,
        "ibkr_flex_trade_confirm_query_id_env": settings.ibkr_flex_trade_confirm_query_id_env,
        "ibkr_flex_send_request_url": settings.ibkr_flex_send_request_url,
        "ibkr_flex_lookback_days": settings.ibkr_flex_lookback_days,
    }
    save_settings_section("brokers", payload)


def has_longbridge_credentials(settings: BrokerSettings) -> bool:
    return bool(
        settings.longbridge_app_key.strip()
        and settings.longbridge_app_secret.strip()
        and settings.longbridge_access_token.strip()
    )


def uses_longbridge_cli_oauth(settings: BrokerSettings) -> bool:
    return settings.selected_broker == "longbridge" and settings.longbridge_auth_mode == "cli_oauth"


def resolve_longbridge_cli_home(settings: BrokerSettings) -> str:
    return settings.longbridge_cli_home.strip() or DEFAULT_LONGBRIDGE_CLI_HOME


def has_longbridge_market_data_source(settings: BrokerSettings) -> bool:
    if settings.selected_broker != "longbridge":
        return False
    if uses_longbridge_cli_oauth(settings):
        return True
    return has_longbridge_credentials(settings)


def has_ibkr_flex_token(settings: BrokerSettings) -> bool:
    """Return whether a Flex token is configured (either directly or via env)."""
    if settings.ibkr_flex_token.strip():
        return True
    name = (settings.ibkr_flex_token_env or "IBKR_FLEX_TOKEN").strip() or "IBKR_FLEX_TOKEN"
    return bool(os.environ.get(name, "").strip())


def has_ibkr_flex_activity_query_id(settings: BrokerSettings) -> bool:
    if settings.ibkr_flex_activity_query_id.strip():
        return True
    name = (settings.ibkr_flex_activity_query_id_env or "IBKR_FLEX_ACTIVITY_QUERY_ID").strip() or "IBKR_FLEX_ACTIVITY_QUERY_ID"
    return bool(os.environ.get(name, "").strip())


def resolve_ibkr_flex_lookback_days(settings: BrokerSettings) -> int:
    try:
        val = int(settings.ibkr_flex_lookback_days)
    except (TypeError, ValueError):
        val = DEFAULT_IBKR_FLEX_LOOKBACK_DAYS
    return max(1, min(365, val))


def sanitize_broker_settings_for_view(settings: BrokerSettings) -> dict[str, object]:
    token_env = settings.ibkr_flex_token_env or "IBKR_FLEX_TOKEN"
    activity_env = settings.ibkr_flex_activity_query_id_env or "IBKR_FLEX_ACTIVITY_QUERY_ID"
    trade_env = settings.ibkr_flex_trade_confirm_query_id_env or "IBKR_FLEX_TRADE_CONFIRM_QUERY_ID"
    return {
        "selected_broker": _normalize_selected_broker(settings.selected_broker),
        "longbridge_auth_mode": settings.longbridge_auth_mode,
        "longbridge_cli_path": settings.longbridge_cli_path,
        "longbridge_cli_home": resolve_longbridge_cli_home(settings),
        "longbridge_has_app_key": bool(settings.longbridge_app_key.strip()),
        "longbridge_has_app_secret": bool(settings.longbridge_app_secret.strip()),
        "longbridge_has_access_token": bool(settings.longbridge_access_token.strip()),
        # Flex (reporting-only) - store actual secrets (like Longbridge), but never expose values in UI
        "ibkr_account_id": settings.ibkr_account_id,
        "ibkr_flex_token_present": bool(settings.ibkr_flex_token.strip() or os.environ.get(token_env, "").strip()),
        "ibkr_flex_activity_query_id_present": bool(settings.ibkr_flex_activity_query_id.strip() or os.environ.get(activity_env, "").strip()),
        "ibkr_flex_trade_confirm_query_id_present": bool(settings.ibkr_flex_trade_confirm_query_id.strip() or os.environ.get(trade_env, "").strip()),
        # Non-secret query IDs can be shown for convenience
        "ibkr_flex_activity_query_id": settings.ibkr_flex_activity_query_id,
        "ibkr_flex_trade_confirm_query_id": settings.ibkr_flex_trade_confirm_query_id,
        "ibkr_flex_token_env": token_env,
        "ibkr_flex_activity_query_id_env": activity_env,
        "ibkr_flex_trade_confirm_query_id_env": trade_env,
        "ibkr_flex_send_request_url": settings.ibkr_flex_send_request_url,
        "ibkr_flex_lookback_days": settings.ibkr_flex_lookback_days,
    }
