"""
Shared local settings persistence.

Code version: v0.1.0
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import SETTINGS_STORE_DIR

GENERAL_SETTINGS_PATH = SETTINGS_STORE_DIR / "settings.json"
LEGACY_SECTION_PATHS: dict[str, Path] = {
    "brokers": SETTINGS_STORE_DIR / "brokers.json",
    "cash_equivalents": SETTINGS_STORE_DIR / "cash_equivalents.json",
    "date_display": SETTINGS_STORE_DIR / "date_display.json",
    "smtp": SETTINGS_STORE_DIR / "smtp.json",
}


def ensure_settings_store_dir() -> None:
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_settings(payload: dict[str, Any]) -> None:
    ensure_settings_store_dir()
    GENERAL_SETTINGS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_all_settings() -> dict[str, Any]:
    ensure_settings_store_dir()
    payload = _read_json_object(GENERAL_SETTINGS_PATH) if GENERAL_SETTINGS_PATH.exists() else {}
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
    payload = load_all_settings()
    payload[section] = section_payload
    _write_settings(payload)
