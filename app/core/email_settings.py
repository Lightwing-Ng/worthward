"""
SMTP settings persistence and Yahoo Mail SMTP checks.

Code version: v0.5.0
"""

from __future__ import annotations

from dataclasses import dataclass
import smtplib
import socket
import ssl

from app.core.config import BASE_DIR
from app.core.settings_store import (
    LEGACY_SECTION_PATHS,
    ensure_settings_store_dir,
    load_settings_section,
    save_settings_section,
)

SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
SMTP_SETTINGS_PATH = LEGACY_SECTION_PATHS["smtp"]
YAHOO_SMTP_HOST = "smtp.mail.yahoo.com"
YAHOO_SMTP_PORT = 587


@dataclass
class SmtpSettings:
    host: str = YAHOO_SMTP_HOST
    port: int = YAHOO_SMTP_PORT
    username: str = ""
    password: str = ""
    from_email: str = ""
    use_starttls: bool = True
    oauth_client_id: str = ""
    oauth_tenant: str = ""
    oauth_access_token: str = ""
    oauth_refresh_token: str = ""
    oauth_token_expires_at: float = 0.0
    oauth_device_code: str = ""
    oauth_user_code: str = ""
    oauth_verification_uri: str = ""
    oauth_verification_uri_complete: str = ""
    oauth_device_expires_at: float = 0.0
    oauth_device_interval_seconds: float = 5.0


def load_smtp_settings() -> SmtpSettings:
    ensure_settings_store_dir()
    payload = load_settings_section("smtp")
    if not payload:
        return SmtpSettings()
    return SmtpSettings(
        host=str(payload.get("host", YAHOO_SMTP_HOST)).strip() or YAHOO_SMTP_HOST,
        port=int(payload.get("port", YAHOO_SMTP_PORT)),
        username=str(payload.get("username", "")).strip(),
        password=str(payload.get("password", "")),
        from_email=str(payload.get("from_email", "")).strip(),
        use_starttls=bool(payload.get("use_starttls", True)),
        oauth_client_id=str(payload.get("oauth_client_id", "")).strip(),
        oauth_tenant=normalize_oauth_tenant(str(payload.get("oauth_tenant", "")).strip()),
        oauth_access_token=str(payload.get("oauth_access_token", "")),
        oauth_refresh_token=str(payload.get("oauth_refresh_token", "")),
        oauth_token_expires_at=float(payload.get("oauth_token_expires_at", 0.0) or 0.0),
        oauth_device_code=str(payload.get("oauth_device_code", "")),
        oauth_user_code=str(payload.get("oauth_user_code", "")),
        oauth_verification_uri=str(payload.get("oauth_verification_uri", "")),
        oauth_verification_uri_complete=str(payload.get("oauth_verification_uri_complete", "")),
        oauth_device_expires_at=float(payload.get("oauth_device_expires_at", 0.0) or 0.0),
        oauth_device_interval_seconds=float(payload.get("oauth_device_interval_seconds", 5.0) or 5.0),
    )


def save_smtp_settings(settings: SmtpSettings) -> None:
    ensure_settings_store_dir()
    payload = {
        "host": settings.host,
        "port": settings.port,
        "username": settings.username,
        "password": settings.password,
        "from_email": settings.from_email,
        "use_starttls": settings.use_starttls,
        "oauth_client_id": settings.oauth_client_id,
        "oauth_tenant": settings.oauth_tenant,
        "oauth_access_token": settings.oauth_access_token,
        "oauth_refresh_token": settings.oauth_refresh_token,
        "oauth_token_expires_at": settings.oauth_token_expires_at,
        "oauth_device_code": settings.oauth_device_code,
        "oauth_user_code": settings.oauth_user_code,
        "oauth_verification_uri": settings.oauth_verification_uri,
        "oauth_verification_uri_complete": settings.oauth_verification_uri_complete,
        "oauth_device_expires_at": settings.oauth_device_expires_at,
        "oauth_device_interval_seconds": settings.oauth_device_interval_seconds,
    }
    save_settings_section("smtp", payload)


def smtp_mailbox(settings: SmtpSettings) -> str:
    return settings.from_email.strip() or settings.username.strip()


def sanitize_smtp_settings_for_view(settings: SmtpSettings) -> dict[str, object]:
    mailbox = smtp_mailbox(settings)
    return {
        "host": settings.host,
        "port": settings.port,
        "username": settings.username,
        "from_email": mailbox,
        "use_starttls": settings.use_starttls,
        "has_password": bool(settings.password),
    }


def normalize_oauth_tenant(value: str) -> str:
    return str(value or "").strip()


def reset_oauth_device_flow(settings: SmtpSettings) -> SmtpSettings:
    settings.oauth_device_code = ""
    settings.oauth_user_code = ""
    settings.oauth_verification_uri = ""
    settings.oauth_verification_uri_complete = ""
    settings.oauth_device_expires_at = 0.0
    settings.oauth_device_interval_seconds = 5.0
    return settings


def clear_oauth_settings(settings: SmtpSettings) -> SmtpSettings:
    settings.oauth_client_id = ""
    settings.oauth_tenant = ""
    settings.oauth_access_token = ""
    settings.oauth_refresh_token = ""
    settings.oauth_token_expires_at = 0.0
    reset_oauth_device_flow(settings)
    return settings


def test_smtp_connection(settings: SmtpSettings, timeout_seconds: float = 12.0) -> tuple[bool, str, SmtpSettings]:
    mailbox = smtp_mailbox(settings)
    if not settings.host.strip():
        return False, "SMTP host is required.", settings
    if not settings.port:
        return False, "SMTP port is required.", settings
    if not mailbox:
        return False, "Yahoo email is required.", settings

    if not settings.password:
        return False, "Yahoo app password is required.", settings

    try:
        with smtplib.SMTP(settings.host, settings.port, timeout=timeout_seconds) as client:
            client.ehlo()
            if settings.use_starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            client.login(mailbox, settings.password)
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP authentication failed. Check the Yahoo address and app password.", settings
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, socket.timeout, TimeoutError):
        return False, "SMTP connection timed out or was closed by the server.", settings
    except ssl.SSLError:
        return False, "SMTP TLS negotiation failed.", settings
    except smtplib.SMTPException as exc:
        return False, f"SMTP error: {exc}", settings
    except OSError as exc:
        return False, f"SMTP network error: {exc}", settings

    return True, "SMTP connection and Yahoo app password login succeeded.", settings
