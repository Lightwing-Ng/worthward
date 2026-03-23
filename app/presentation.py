"""
Formatting helpers for display labels.

Code version: v3.2.0
"""

from __future__ import annotations

import pandas as pd


def format_period_label(period: str) -> str:
    labels = {
        "1d": "1 day",
        "3d": "3 days",
        "1w": "1 week",
        "2w": "2 weeks",
        "1mo": "1 month",
        "3mo": "3 months",
        "6mo": "6 months",
        "1y": "1 year",
        "2y": "2 years",
        "3y": "3 years",
        "5y": "5 years",
        "10y": "10 years",
        "max": "Max",
    }
    return labels.get(period, period)


def format_display_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    return f"{timestamp.day} {timestamp.strftime('%b %Y')}"


def build_series_colors(count: int, start_hex: str = "#0055cc", end_hex: str = "#ff2f92") -> list[str]:
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
        color = tuple(
            round(start_rgb[channel] + (end_rgb[channel] - start_rgb[channel]) * ratio)
            for channel in range(3)
        )
        colors.append(rgb_to_hex(color))
    return colors


def hex_to_rgba(value: str, alpha: float) -> str:
    raw = value.lstrip("#")
    red = int(raw[0:2], 16)
    green = int(raw[2:4], 16)
    blue = int(raw[4:6], 16)
    return f"rgba({red}, {green}, {blue}, {alpha})"
