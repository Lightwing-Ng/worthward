"""
SMTP settings persistence and connection checks.

Code version: v1.1.0
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
import smtplib
import socket
import ssl

from .config import BASE_DIR


SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
SMTP_SETTINGS_PATH = SETTINGS_STORE_DIR / "smtp.json"
OUTLOOK_SMTP_HOST = "smtp.office365.com"
OUTLOOK_SMTP_PORT = 587


@dataclass(slots=True)
class SmtpSettings:
    host: str = OUTLOOK_SMTP_HOST
    port: int = OUTLOOK_SMTP_PORT
    username: str = ""
    password: str = ""
    from_email: str = ""
    use_starttls: bool = True


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
    )


def save_smtp_settings(settings: SmtpSettings) -> None:
    ensure_settings_store_dir()
    SMTP_SETTINGS_PATH.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2))


def sanitize_smtp_settings_for_view(settings: SmtpSettings) -> dict[str, object]:
    mailbox = settings.from_email or settings.username
    return {
        "host": settings.host,
        "port": settings.port,
        "username": settings.username,
        "from_email": mailbox,
        "use_starttls": settings.use_starttls,
        "has_password": bool(settings.password),
    }


def test_smtp_connection(settings: SmtpSettings, timeout_seconds: float = 12.0) -> tuple[bool, str]:
    mailbox = settings.from_email.strip() or settings.username.strip()
    if not settings.host.strip():
        return False, "SMTP host is required."
    if not settings.port:
        return False, "SMTP port is required."
    if not mailbox:
        return False, "Outlook email is required."
    if not settings.password:
        return False, "SMTP password is required."

    try:
        with smtplib.SMTP(settings.host, settings.port, timeout=timeout_seconds) as client:
            client.ehlo()
            if settings.use_starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            client.login(mailbox, settings.password)
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP authentication failed. Check the Outlook address, password, and whether SMTP AUTH is enabled."
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, socket.timeout, TimeoutError):
        return False, "SMTP connection timed out or was closed by the server."
    except ssl.SSLError:
        return False, "SMTP TLS negotiation failed."
    except OSError as exc:
        return False, f"SMTP network error: {exc}"
    except smtplib.SMTPException as exc:
        return False, f"SMTP error: {exc}"

    return True, "SMTP connection and login succeeded."
