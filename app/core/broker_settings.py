"""
Broker credential persistence for local integrations.

Code version: v0.3.0
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json

from app.core.config import BASE_DIR

SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
BROKER_SETTINGS_PATH = SETTINGS_STORE_DIR / "brokers.json"

SUPPORTED_BROKERS = ("longbridge", "ibkr")


@dataclass
class BrokerSettings:
    selected_broker: str = "longbridge"
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""


def ensure_settings_store_dir() -> None:
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_selected_broker(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in SUPPORTED_BROKERS:
        return normalized
    return "longbridge"


def load_broker_settings() -> BrokerSettings:
    ensure_settings_store_dir()
    if not BROKER_SETTINGS_PATH.exists():
        return BrokerSettings()
    payload = json.loads(BROKER_SETTINGS_PATH.read_text())
    return BrokerSettings(
        selected_broker=_normalize_selected_broker(payload.get("selected_broker")),
        longbridge_app_key=str(payload.get("longbridge_app_key", "")).strip(),
        longbridge_app_secret=str(payload.get("longbridge_app_secret", "")).strip(),
        longbridge_access_token=str(payload.get("longbridge_access_token", "")).strip(),
    )


def save_broker_settings(settings: BrokerSettings) -> None:
    ensure_settings_store_dir()
    BROKER_SETTINGS_PATH.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2))


def has_longbridge_credentials(settings: BrokerSettings) -> bool:
    return bool(
        settings.longbridge_app_key.strip()
        and settings.longbridge_app_secret.strip()
        and settings.longbridge_access_token.strip()
    )


def sanitize_broker_settings_for_view(settings: BrokerSettings) -> dict[str, object]:
    return {
        "selected_broker": _normalize_selected_broker(settings.selected_broker),
        "longbridge_has_app_key": bool(settings.longbridge_app_key.strip()),
        "longbridge_has_app_secret": bool(settings.longbridge_app_secret.strip()),
        "longbridge_has_access_token": bool(settings.longbridge_access_token.strip()),
    }
