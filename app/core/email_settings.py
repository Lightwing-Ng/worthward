"""
SMTP settings persistence and Outlook OAuth checks.

Code version: v0.3.2
"""

from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass
import json
import smtplib
import socket
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import BASE_DIR

SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
SMTP_SETTINGS_PATH = SETTINGS_STORE_DIR / "smtp.json"
OUTLOOK_SMTP_HOST = "smtp-mail.outlook.com"
OUTLOOK_SMTP_PORT = 587
OUTLOOK_SMTP_SCOPE = "offline_access https://outlook.office.com/SMTP.Send"
DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
OUTLOOK_PERSONAL_TENANT = "consumers"
OUTLOOK_WORKFORCE_TENANT = "organizations"
SUPPORTED_MICROSOFT_TENANTS = {"common", OUTLOOK_PERSONAL_TENANT, OUTLOOK_WORKFORCE_TENANT}
OUTLOOK_PERSONAL_DOMAINS = {
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
}


@dataclass
class SmtpSettings:
    host: str = OUTLOOK_SMTP_HOST
    port: int = OUTLOOK_SMTP_PORT
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


def ensure_settings_store_dir() -> None:
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)


def load_smtp_settings() -> SmtpSettings:
    ensure_settings_store_dir()
    if not SMTP_SETTINGS_PATH.exists():
        return SmtpSettings()
    payload = json.loads(SMTP_SETTINGS_PATH.read_text())
    return SmtpSettings(
        host=str(payload.get("host", OUTLOOK_SMTP_HOST)).strip() or OUTLOOK_SMTP_HOST,
        port=int(payload.get("port", OUTLOOK_SMTP_PORT)),
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
    SMTP_SETTINGS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def smtp_mailbox(settings: SmtpSettings) -> str:
    return settings.from_email.strip() or settings.username.strip()


def has_saved_oauth_authorization(settings: SmtpSettings) -> bool:
    return bool(settings.oauth_client_id.strip() and settings.oauth_refresh_token.strip())


def has_pending_oauth_device_flow(settings: SmtpSettings) -> bool:
    return bool(settings.oauth_client_id.strip() and settings.oauth_device_code.strip() and settings.oauth_device_expires_at > time.time())


def sanitize_smtp_settings_for_view(settings: SmtpSettings) -> dict[str, object]:
    mailbox = smtp_mailbox(settings)
    effective_tenant = oauth_tenant_for(settings)
    mailbox_domain = mailbox.partition("@")[2].strip().lower()
    is_personal_mailbox = mailbox_domain in OUTLOOK_PERSONAL_DOMAINS
    return {
        "host": settings.host,
        "port": settings.port,
        "username": settings.username,
        "from_email": mailbox,
        "use_starttls": settings.use_starttls,
        "has_password": bool(settings.password),
        "oauth_client_id": settings.oauth_client_id,
        "oauth_tenant": settings.oauth_tenant,
        "oauth_effective_tenant": effective_tenant,
        "oauth_mailbox_kind": "personal" if is_personal_mailbox else "workforce",
        "oauth_authorized": has_saved_oauth_authorization(settings),
        "oauth_pending": has_pending_oauth_device_flow(settings),
        "oauth_user_code": settings.oauth_user_code,
        "oauth_verification_uri": settings.oauth_verification_uri,
        "oauth_verification_uri_complete": settings.oauth_verification_uri_complete,
    }


def normalize_oauth_tenant(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    lowered = normalized.lower()
    if lowered in SUPPORTED_MICROSOFT_TENANTS:
        return lowered
    return normalized


def oauth_tenant_for(settings: SmtpSettings) -> str:
    explicit_tenant = normalize_oauth_tenant(settings.oauth_tenant)
    if explicit_tenant:
        return explicit_tenant
    mailbox = smtp_mailbox(settings)
    mailbox_domain = mailbox.partition("@")[2].strip().lower()
    if mailbox_domain in OUTLOOK_PERSONAL_DOMAINS:
        return OUTLOOK_PERSONAL_TENANT
    return OUTLOOK_WORKFORCE_TENANT


def oauth_device_code_endpoint(settings: SmtpSettings) -> str:
    return f"https://login.microsoftonline.com/{oauth_tenant_for(settings)}/oauth2/v2.0/devicecode"


def oauth_token_endpoint(settings: SmtpSettings) -> str:
    return f"https://login.microsoftonline.com/{oauth_tenant_for(settings)}/oauth2/v2.0/token"


def post_oauth_form(url: str, payload: dict[str, str], timeout_seconds: float = 20.0) -> dict[str, Any]:
    request_obj = Request(
        url,
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request_obj, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            raw_payload = exc.read().decode("utf-8")
            if raw_payload:
                return json.loads(raw_payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        raise
    except URLError:
        raise


def reset_oauth_device_flow(settings: SmtpSettings) -> SmtpSettings:
    settings.oauth_device_code = ""
    settings.oauth_user_code = ""
    settings.oauth_verification_uri = ""
    settings.oauth_verification_uri_complete = ""
    settings.oauth_device_expires_at = 0.0
    settings.oauth_device_interval_seconds = 5.0
    return settings


def build_oauth_settings_message(settings: SmtpSettings) -> str:
    if has_saved_oauth_authorization(settings):
        return "Outlook OAuth is connected."
    if has_pending_oauth_device_flow(settings):
        return (
            f"Use code {settings.oauth_user_code} at {settings.oauth_verification_uri} "
            f"to finish Outlook sign-in for tenant {oauth_tenant_for(settings)}."
        )
    return "Outlook OAuth is not connected yet."


def start_outlook_oauth_device_flow(settings: SmtpSettings, timeout_seconds: float = 20.0) -> tuple[SmtpSettings, bool, str]:
    mailbox = smtp_mailbox(settings)
    if not mailbox:
        return settings, False, "Outlook email is required before starting OAuth."
    if not settings.oauth_client_id.strip():
        return settings, False, "Outlook OAuth client ID is required."

    payload = post_oauth_form(
        oauth_device_code_endpoint(settings),
        {
            "client_id": settings.oauth_client_id.strip(),
            "scope": OUTLOOK_SMTP_SCOPE,
        },
        timeout_seconds=timeout_seconds,
    )
    if "device_code" not in payload:
        message = str(payload.get("error_description") or payload.get("error") or "Unable to start Outlook OAuth.")
        return settings, False, message

    settings.oauth_device_code = str(payload.get("device_code", ""))
    settings.oauth_user_code = str(payload.get("user_code", ""))
    settings.oauth_verification_uri = str(payload.get("verification_uri", ""))
    settings.oauth_verification_uri_complete = str(payload.get("verification_uri_complete", ""))
    expires_in_seconds = int(payload.get("expires_in", 900) or 900)
    settings.oauth_device_expires_at = time.time() + expires_in_seconds
    settings.oauth_device_interval_seconds = float(payload.get("interval", 5) or 5)
    settings.oauth_access_token = ""
    settings.oauth_token_expires_at = 0.0
    message = (
        f"Open {settings.oauth_verification_uri} and enter code {settings.oauth_user_code}. "
        f"Then return here and click Finish Outlook OAuth. Tenant: {oauth_tenant_for(settings)}."
    )
    return settings, True, message


def apply_oauth_token_payload(settings: SmtpSettings, payload: dict[str, Any]) -> SmtpSettings:
    settings.oauth_access_token = str(payload.get("access_token", ""))
    refresh_token = str(payload.get("refresh_token", "")).strip()
    if refresh_token:
        settings.oauth_refresh_token = refresh_token
    expires_in_seconds = int(payload.get("expires_in", 0) or 0)
    settings.oauth_token_expires_at = time.time() + max(expires_in_seconds - 60, 0)
    reset_oauth_device_flow(settings)
    return settings


def finish_outlook_oauth_device_flow(settings: SmtpSettings, timeout_seconds: float = 20.0) -> tuple[SmtpSettings, bool, str]:
    if not settings.oauth_client_id.strip():
        return settings, False, "Outlook OAuth client ID is required."
    if not settings.oauth_device_code.strip():
        return settings, False, "Start Outlook OAuth before trying to finish it."
    if settings.oauth_device_expires_at <= time.time():
        reset_oauth_device_flow(settings)
        return settings, False, "The Outlook OAuth code expired. Start Outlook OAuth again."

    deadline = time.time() + timeout_seconds
    interval_seconds = max(settings.oauth_device_interval_seconds, 1.0)
    while time.time() <= deadline:
        payload = post_oauth_form(
            oauth_token_endpoint(settings),
            {
                "grant_type": DEVICE_CODE_GRANT_TYPE,
                "client_id": settings.oauth_client_id.strip(),
                "device_code": settings.oauth_device_code,
            },
            timeout_seconds=timeout_seconds,
        )
        if "access_token" in payload:
            apply_oauth_token_payload(settings, payload)
            return settings, True, "Outlook OAuth authorization succeeded."
        error_code = str(payload.get("error", ""))
        if error_code == "authorization_pending":
            time.sleep(interval_seconds)
            continue
        if error_code == "slow_down":
            interval_seconds += 2.0
            time.sleep(interval_seconds)
            continue
        if error_code == "expired_token":
            reset_oauth_device_flow(settings)
            return settings, False, "The Outlook OAuth code expired. Start Outlook OAuth again."
        message = str(payload.get("error_description") or error_code or "Outlook OAuth failed.")
        return settings, False, message
    return settings, False, "Outlook OAuth is still waiting for approval. Finish the browser sign-in, then try again."


def refresh_outlook_oauth_access_token(settings: SmtpSettings, timeout_seconds: float = 20.0) -> tuple[SmtpSettings, bool, str]:
    if not settings.oauth_client_id.strip():
        return settings, False, "Outlook OAuth client ID is required."
    if not settings.oauth_refresh_token.strip():
        return settings, False, "Outlook OAuth is not connected yet."
    payload = post_oauth_form(
        oauth_token_endpoint(settings),
        {
            "client_id": settings.oauth_client_id.strip(),
            "grant_type": "refresh_token",
            "refresh_token": settings.oauth_refresh_token,
            "scope": OUTLOOK_SMTP_SCOPE,
        },
        timeout_seconds=timeout_seconds,
    )
    if "access_token" not in payload:
        message = str(payload.get("error_description") or payload.get("error") or "Unable to refresh Outlook OAuth.")
        return settings, False, message
    apply_oauth_token_payload(settings, payload)
    return settings, True, "Outlook OAuth token refreshed."


def ensure_outlook_oauth_access_token(settings: SmtpSettings, timeout_seconds: float = 20.0) -> tuple[SmtpSettings, bool, str]:
    if settings.oauth_access_token and settings.oauth_token_expires_at > time.time():
        return settings, True, "Outlook OAuth token is ready."
    return refresh_outlook_oauth_access_token(settings, timeout_seconds=timeout_seconds)


def build_smtp_oauth_string(mailbox: str, access_token: str) -> str:
    raw_value = f"user={mailbox}\x01auth=Bearer {access_token}\x01\x01"
    return b64encode(raw_value.encode("utf-8")).decode("ascii")


def test_smtp_connection(settings: SmtpSettings, timeout_seconds: float = 12.0) -> tuple[bool, str, SmtpSettings]:
    mailbox = smtp_mailbox(settings)
    if not settings.host.strip():
        return False, "SMTP host is required.", settings
    if not settings.port:
        return False, "SMTP port is required.", settings
    if not mailbox:
        return False, "Outlook email is required.", settings

    access_token = ""
    if settings.oauth_client_id.strip():
        settings, oauth_ready, oauth_message = ensure_outlook_oauth_access_token(settings, timeout_seconds=timeout_seconds)
        if not oauth_ready:
            return False, oauth_message, settings
        access_token = settings.oauth_access_token
    elif not settings.password:
        return False, "Outlook OAuth client ID is required.", settings

    try:
        with smtplib.SMTP(settings.host, settings.port, timeout=timeout_seconds) as client:
            client.ehlo()
            if settings.use_starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if access_token:
                auth_string = build_smtp_oauth_string(mailbox, access_token)
                auth_code, auth_message = client.docmd("AUTH", f"XOAUTH2 {auth_string}")
                if auth_code != 235:
                    decoded_message = auth_message.decode("utf-8", errors="ignore") if isinstance(auth_message, bytes) else str(auth_message)
                    return False, f"SMTP OAuth failed: {decoded_message or auth_code}", settings
            else:
                client.login(mailbox, settings.password)
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP authentication failed. Check the Outlook address, password, and whether SMTP AUTH is enabled.", settings
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, socket.timeout, TimeoutError):
        return False, "SMTP connection timed out or was closed by the server.", settings
    except ssl.SSLError:
        return False, "SMTP TLS negotiation failed.", settings
    except smtplib.SMTPException as exc:
        return False, f"SMTP error: {exc}", settings
    except OSError as exc:
        return False, f"SMTP network error: {exc}", settings

    return True, "SMTP connection and Outlook OAuth login succeeded.", settings
