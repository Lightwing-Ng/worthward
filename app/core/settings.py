"""
Application settings loader.

Code version: v0.3.0
"""

from __future__ import annotations

from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.11+ uses tomllib.
    import tomli as tomllib

from app.core.config import BASE_DIR

CONFIG_PATH = BASE_DIR / "config.toml"


def _normalize_theme_settings(settings: dict[str, Any]) -> dict[str, Any]:
    ui_settings = settings.setdefault("ui", {})
    raw_theme = ui_settings.get("theme", {})
    if not isinstance(raw_theme, dict):
        return settings

    light_theme = raw_theme.get("light")
    dark_theme = raw_theme.get("dark")

    if isinstance(light_theme, dict) and isinstance(dark_theme, dict):
        shared_keys = {
            "color_scheme": raw_theme.get("color_scheme", "light dark"),
            "shadow": raw_theme.get("shadow", "0 24px 80px rgba(17, 24, 39, 0.10)"),
            "radius_shell": raw_theme.get("radius_shell", "10px"),
            "radius_panel": raw_theme.get("radius_panel", "10px"),
            "radius_control": raw_theme.get("radius_control", "10px"),
            "trade_capital_slider_radius": raw_theme.get("trade_capital_slider_radius", "10px"),
            "timing_list_panel_radius": raw_theme.get("timing_list_panel_radius", "10px"),
            "timing_list_item_inline_pad": raw_theme.get("timing_list_item_inline_pad", "10px"),
        }
        ui_settings["theme"] = {
            **shared_keys,
            "light": {**shared_keys, **light_theme},
            "dark": {**shared_keys, **dark_theme},
        }
        return settings

    if isinstance(raw_theme, dict):
        merged_theme = dict(raw_theme)
        merged_theme.setdefault("color_scheme", "light dark")
        ui_settings["theme"] = {
            **merged_theme,
            "light": dict(merged_theme),
            "dark": dict(merged_theme),
        }
    return settings


def get_settings() -> dict[str, Any]:
    with CONFIG_PATH.open("rb") as config_file:
        settings = tomllib.load(config_file)
    return _normalize_theme_settings(settings)
