"""
Shared local settings persistence.

Code version: v0.3.0
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from app.core.config import SETTINGS_STORE_DIR
from app.core.file_lock import local_file_lock

GENERAL_SETTINGS_PATH = SETTINGS_STORE_DIR / "settings.json"
LEGACY_SECTION_PATHS: dict[str, Path] = {
    "brokers": SETTINGS_STORE_DIR / "brokers.json",
    "cash_equivalents": SETTINGS_STORE_DIR / "cash_equivalents.json",
    "date_display": SETTINGS_STORE_DIR / "date_display.json",
    "smtp": SETTINGS_STORE_DIR / "smtp.json",
}


def ensure_settings_store_dir() -> None:
    SETTINGS_STORE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_settings(payload: dict[str, Any]) -> None:
    ensure_settings_store_dir()
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    temporary_path = None
    try:
        with NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=GENERAL_SETTINGS_PATH.parent,
            prefix=".settings-", suffix=".tmp", delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(serialized)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, GENERAL_SETTINGS_PATH)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def load_all_settings() -> dict[str, Any]:
    ensure_settings_store_dir()
    with local_file_lock(GENERAL_SETTINGS_PATH.with_suffix(".lock")):
        return _load_all_settings_unlocked()


def _load_all_settings_unlocked() -> dict[str, Any]:
    # Never replace damaged or unreadable settings with an empty configuration.
    try:
        payload = json.loads(GENERAL_SETTINGS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        payload = {}
    if not isinstance(payload, dict):
        raise ValueError("The settings file must contain a JSON object.")
    changed = False
    for section, legacy_path in LEGACY_SECTION_PATHS.items():
        if section not in payload and legacy_path.exists():
            legacy_payload = _read_json_object(legacy_path)
            if legacy_payload:
                payload[section] = legacy_payload
                changed = True
    if changed:
        _write_settings(payload)
    return payload


def load_settings_section(section: str) -> dict[str, Any]:
    payload = load_all_settings().get(section, {})
    return payload if isinstance(payload, dict) else {}


def save_settings_section(section: str, section_payload: dict[str, Any]) -> None:
    save_setting_value(section, section_payload)


def save_setting_value(key: str, value: Any) -> None:
    ensure_settings_store_dir()
    with local_file_lock(GENERAL_SETTINGS_PATH.with_suffix(".lock")):
        payload = _load_all_settings_unlocked()
        payload[key] = value
        _write_settings(payload)
