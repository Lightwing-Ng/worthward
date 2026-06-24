"""
Broker credential persistence for local integrations.

Code version: v0.6.1
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from urllib.parse import urlparse

from app.core.config import BASE_DIR

SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
BROKER_SETTINGS_PATH = SETTINGS_STORE_DIR / "brokers.json"
DEFAULT_LONGBRIDGE_CLI_HOME = str(BASE_DIR / ".lb-home")

SUPPORTED_BROKERS = ("longbridge", "ibkr")
SUPPORTED_LONGBRIDGE_AUTH_MODES = ("cli_oauth", "legacy_apikey")
DEFAULT_IBKR_CLIENT_PORTAL_BASE_URL = "https://127.0.0.1:8689/v1/api"
DEFAULT_IBKR_CLIENT_PORTAL_PORT = 8689


@dataclass
class BrokerSettings:
    selected_broker: str = "longbridge"
    longbridge_auth_mode: str = ""
    longbridge_cli_path: str = ""
    longbridge_cli_home: str = ""
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""
    ibkr_base_url: str = DEFAULT_IBKR_CLIENT_PORTAL_BASE_URL
    ibkr_account_id: str = ""
    ibkr_verify_ssl: bool = False

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
        self.ibkr_base_url = normalize_ibkr_base_url(self.ibkr_base_url)
        self.ibkr_account_id = str(self.ibkr_account_id or "").strip()
        self.ibkr_verify_ssl = normalize_ibkr_verify_ssl_for_url(self.ibkr_verify_ssl, self.ibkr_base_url)


def ensure_settings_store_dir() -> None:
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)


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


def normalize_ibkr_base_url(value: str | None) -> str:
    normalized = str(value or "").strip().rstrip("/")
    if not normalized:
        return DEFAULT_IBKR_CLIENT_PORTAL_BASE_URL
    if normalized.endswith("/v1/api"):
        return normalized
    if normalized.endswith("/v1/api/"):
        return normalized.rstrip("/")
    return normalized


def normalize_ibkr_port(value: str | int | None) -> int:
    try:
        port = int(str(value or "").strip())
    except (TypeError, ValueError):
        return DEFAULT_IBKR_CLIENT_PORTAL_PORT
    if 1 <= port <= 65535:
        return port
    return DEFAULT_IBKR_CLIENT_PORTAL_PORT


def build_ibkr_base_url_from_port(value: str | int | None) -> str:
    return f"https://127.0.0.1:{normalize_ibkr_port(value)}/v1/api"


def is_local_ibkr_gateway_url(value: str | None) -> bool:
    parsed = urlparse(normalize_ibkr_base_url(value))
    host = (parsed.hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost"}


def normalize_ibkr_verify_ssl_for_url(verify_ssl: bool, base_url: str | None) -> bool:
    if is_local_ibkr_gateway_url(base_url):
        return False
    return bool(verify_ssl)


def extract_ibkr_port_from_base_url(value: str | None) -> int:
    normalized = normalize_ibkr_base_url(value)
    try:
        from urllib.parse import urlparse

        parsed = urlparse(normalized)
        return normalize_ibkr_port(parsed.port)
    except Exception:
        return DEFAULT_IBKR_CLIENT_PORTAL_PORT


def load_broker_settings() -> BrokerSettings:
    ensure_settings_store_dir()
    if not BROKER_SETTINGS_PATH.exists():
        return BrokerSettings()
    payload = json.loads(BROKER_SETTINGS_PATH.read_text())
    return BrokerSettings(
        selected_broker=_normalize_selected_broker(payload.get("selected_broker")),
        longbridge_auth_mode=str(payload.get("longbridge_auth_mode", "")).strip(),
        longbridge_cli_path=str(payload.get("longbridge_cli_path", "")).strip(),
        longbridge_cli_home=str(payload.get("longbridge_cli_home", "")).strip(),
        longbridge_app_key=str(payload.get("longbridge_app_key", "")).strip(),
        longbridge_app_secret=str(payload.get("longbridge_app_secret", "")).strip(),
        longbridge_access_token=str(payload.get("longbridge_access_token", "")).strip(),
        ibkr_base_url=str(
            payload.get("ibkr_base_url", DEFAULT_IBKR_CLIENT_PORTAL_BASE_URL)
        ).strip(),
        ibkr_account_id=str(payload.get("ibkr_account_id", "")).strip(),
        ibkr_verify_ssl=bool(payload.get("ibkr_verify_ssl", False)),
    )


def save_broker_settings(settings: BrokerSettings) -> None:
    ensure_settings_store_dir()
    payload = {
        "selected_broker": settings.selected_broker,
        "longbridge_auth_mode": settings.longbridge_auth_mode,
        "longbridge_cli_path": settings.longbridge_cli_path,
        "longbridge_cli_home": settings.longbridge_cli_home,
        "longbridge_app_key": settings.longbridge_app_key,
        "longbridge_app_secret": settings.longbridge_app_secret,
        "longbridge_access_token": settings.longbridge_access_token,
        "ibkr_base_url": settings.ibkr_base_url,
        "ibkr_port": extract_ibkr_port_from_base_url(settings.ibkr_base_url),
        "ibkr_account_id": settings.ibkr_account_id,
        "ibkr_verify_ssl": settings.ibkr_verify_ssl,
    }
    BROKER_SETTINGS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


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
        "ibkr_base_url": settings.ibkr_base_url,
        "ibkr_port": extract_ibkr_port_from_base_url(settings.ibkr_base_url),
        "ibkr_account_id": settings.ibkr_account_id,
        "ibkr_verify_ssl": settings.ibkr_verify_ssl,
    }
