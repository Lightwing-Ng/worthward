"""
Broker connection preferences for local integrations.

Code version: v0.11.0
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


@dataclass
class BrokerSettings:
    selected_broker: str = "longbridge"
    longbridge_auth_mode: str = ""
    longbridge_cli_path: str = ""
    longbridge_cli_home: str = ""
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""
    ibkr_account_id: str = ""

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
    # Retired IBKR integration keys are intentionally ignored during loading.
    return BrokerSettings(
        selected_broker=_normalize_selected_broker(payload.get("selected_broker")),
        longbridge_auth_mode=str(payload.get("longbridge_auth_mode", "")).strip(),
        longbridge_cli_path=str(payload.get("longbridge_cli_path", "")).strip(),
        longbridge_cli_home=str(payload.get("longbridge_cli_home", "")).strip(),
        longbridge_app_key=str(payload.get("longbridge_app_key", "")).strip(),
        longbridge_app_secret=str(payload.get("longbridge_app_secret", "")).strip(),
        longbridge_access_token=str(payload.get("longbridge_access_token", "")).strip(),
        ibkr_account_id=str(payload.get("ibkr_account_id", "")).strip(),
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


def sanitize_broker_settings_for_view(settings: BrokerSettings) -> dict[str, object]:
    return {
        "selected_broker": _normalize_selected_broker(settings.selected_broker),
        "longbridge_auth_mode": settings.longbridge_auth_mode,
        "longbridge_cli_path": settings.longbridge_cli_path,
        "longbridge_cli_home": resolve_longbridge_cli_home(settings),
        "longbridge_has_app_key": bool(settings.longbridge_app_key.strip()),
        "longbridge_has_app_secret": bool(settings.longbridge_app_secret.strip()),
        "longbridge_has_access_token": bool(settings.longbridge_access_token.strip()),
        "ibkr_account_id": settings.ibkr_account_id,
    }
