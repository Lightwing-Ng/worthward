"""
Date display preference persistence and formatting helpers.
Code version: v0.1.0
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Literal

from app.core.config import SETTINGS_STORE_DIR

FullDateDisplayFormat = Literal[
    "d_mmm_yyyy",
    "dd_mmm_yyyy",
    "yyyy_mmm_d",
    "yyyy_mmm_dd",
]
ShortDateDisplayFormat = Literal[
    "yyyy_mm_dd",
    "dd_mm_yyyy",
]

DATE_DISPLAY_SETTINGS_PATH = SETTINGS_STORE_DIR / "date_display.json"
DEFAULT_FULL_DATE_DISPLAY_FORMAT: FullDateDisplayFormat = "d_mmm_yyyy"
DEFAULT_SHORT_DATE_DISPLAY_FORMAT: ShortDateDisplayFormat = "yyyy_mm_dd"
MONTH_ABBREVIATIONS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass(frozen=True)
class DateDisplaySettings:
    full_date_format: FullDateDisplayFormat = DEFAULT_FULL_DATE_DISPLAY_FORMAT
    short_date_format: ShortDateDisplayFormat = DEFAULT_SHORT_DATE_DISPLAY_FORMAT


def _normalize_full_date_format(value: str | None) -> FullDateDisplayFormat:
    normalized = str(value or "").strip().lower()
    if normalized == "dd_mmm_yyyy":
        return "dd_mmm_yyyy"
    if normalized == "yyyy_mmm_d":
        return "yyyy_mmm_d"
    if normalized == "yyyy_mmm_dd":
        return "yyyy_mmm_dd"
    return DEFAULT_FULL_DATE_DISPLAY_FORMAT


def _normalize_short_date_format(value: str | None) -> ShortDateDisplayFormat:
    normalized = str(value or "").strip().lower()
    if normalized == "dd_mm_yyyy":
        return "dd_mm_yyyy"
    return DEFAULT_SHORT_DATE_DISPLAY_FORMAT


def load_date_display_settings() -> DateDisplaySettings:
    try:
        payload = json.loads(DATE_DISPLAY_SETTINGS_PATH.read_text()) if DATE_DISPLAY_SETTINGS_PATH.exists() else {}
    except (json.JSONDecodeError, OSError):
        return DateDisplaySettings()
    return DateDisplaySettings(
        full_date_format=_normalize_full_date_format(payload.get("full_date_format")),
        short_date_format=_normalize_short_date_format(payload.get("short_date_format")),
    )


def save_date_display_settings(
    *,
    full_date_format: str | None = None,
    short_date_format: str | None = None,
) -> DateDisplaySettings:
    current = load_date_display_settings()
    next_settings = DateDisplaySettings(
        full_date_format=_normalize_full_date_format(full_date_format or current.full_date_format),
        short_date_format=_normalize_short_date_format(short_date_format or current.short_date_format),
    )
    SETTINGS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    DATE_DISPLAY_SETTINGS_PATH.write_text(
        json.dumps(
            {
                "full_date_format": next_settings.full_date_format,
                "short_date_format": next_settings.short_date_format,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return next_settings


def save_full_date_display_format(value: str) -> FullDateDisplayFormat:
    return save_date_display_settings(full_date_format=value).full_date_format


def save_short_date_display_format(value: str) -> ShortDateDisplayFormat:
    return save_date_display_settings(short_date_format=value).short_date_format


def format_full_date_parts(year: int, month: int, day: int, date_format: FullDateDisplayFormat) -> str:
    month_label = MONTH_ABBREVIATIONS[max(0, min(11, month - 1))]
    if date_format == "dd_mmm_yyyy":
        return f"{day:02d} {month_label} {year}"
    if date_format == "yyyy_mmm_d":
        return f"{year} {month_label} {day}"
    if date_format == "yyyy_mmm_dd":
        return f"{year} {month_label} {day:02d}"
    return f"{day} {month_label} {year}"


def format_short_date_parts(year: int, month: int, day: int, date_format: ShortDateDisplayFormat) -> str:
    if date_format == "dd_mm_yyyy":
        return f"{day:02d}/{month:02d}/{year}"
    return f"{year}/{month:02d}/{day:02d}"
