"""
Formatting helpers for display labels.

Code version: v0.4.0
"""

from __future__ import annotations

import pandas as pd

from app.core.config import PERIOD_LABELS
from app.core.date_display_settings import (
    format_full_date_parts,
    format_short_date_parts,
    load_date_display_settings,
)
from app.core.settings import get_settings


def format_period_label(period: str) -> str:
    return PERIOD_LABELS.get(period, period)


def format_display_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    date_settings = load_date_display_settings()
    return format_full_date_parts(
        timestamp.year,
        timestamp.month,
        timestamp.day,
        date_settings.full_date_format,
    )


def format_short_display_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    date_settings = load_date_display_settings()
    return format_short_date_parts(
        timestamp.year,
        timestamp.month,
        timestamp.day,
        date_settings.short_date_format,
    )


def format_display_datetime(
    value: pd.Timestamp | str,
    *,
    use_short_date: bool = False,
    include_seconds: bool = False,
    timezone_suffix: str = "",
) -> str:
    timestamp = pd.Timestamp(value)
    date_text = format_short_display_date(timestamp) if use_short_date else format_display_date(timestamp)
    time_format = "%H:%M:%S" if include_seconds else "%H:%M"
    time_text = timestamp.strftime(time_format)
    suffix = f" {timezone_suffix.strip()}" if timezone_suffix.strip() else ""
    return f"{date_text} {time_text}{suffix}"


def build_series_colors(count: int, start_hex: str | None = None, end_hex: str | None = None) -> list[str]:
    theme_light = get_settings().get("ui", {}).get("theme", {}).get("light", {})
    start_hex = start_hex or str(theme_light.get("accent_primary", ""))
    end_hex = end_hex or str(theme_light.get("accent_secondary", ""))
    if count <= 1:
        return [start_hex]

    def hex_to_rgb(value: str) -> tuple[int, int, int]:
        raw = value.lstrip("#")
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)

    def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
        return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"

    start_rgb = hex_to_rgb(start_hex)
    end_rgb = hex_to_rgb(end_hex)
    colors: list[str] = []
    for index in range(count):
        ratio = index / (count - 1)
        color: tuple[int, int, int] = (
            round(start_rgb[0] + (end_rgb[0] - start_rgb[0]) * ratio),
            round(start_rgb[1] + (end_rgb[1] - start_rgb[1]) * ratio),
            round(start_rgb[2] + (end_rgb[2] - start_rgb[2]) * ratio),
        )
        colors.append(rgb_to_hex(color))
    return colors


def hex_to_rgba(value: str, alpha: float) -> str:
    raw = value.lstrip("#")
    red = int(raw[0:2], 16)
    green = int(raw[2:4], 16)
    blue = int(raw[4:6], 16)
    return f"rgba({red}, {green}, {blue}, {alpha})"
