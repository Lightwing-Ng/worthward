"""
Backtest execution preference persistence.

Code version: v0.5.0
"""

from __future__ import annotations

from typing import Literal

from app.core.config import MARKET_STORE_DIR
from app.core.preferences.store import load_all_settings, save_setting_value
from app.core.object_sqlite import read_structured_object

BacktestExecutionMode = Literal["signal_close", "next_open"]
BACKTEST_SETTINGS_PATH = MARKET_STORE_DIR / "backtest_settings.sqlite3"
DEFAULT_BACKTEST_EXECUTION_MODE: BacktestExecutionMode = "next_open"


def _normalize_execution_mode(mode: object) -> BacktestExecutionMode | None:
    normalized = str(mode).strip().lower()
    if normalized == "signal_close":
        return "signal_close"
    if normalized == "next_open":
        return "next_open"
    return None


def _load_legacy_execution_mode() -> BacktestExecutionMode | None:
    try:
        payload = (
            read_structured_object(BACKTEST_SETTINGS_PATH)
            if BACKTEST_SETTINGS_PATH.exists()
            else {}
        )
    except (ValueError, OSError):
        return None
    if not isinstance(payload, dict):
        return None
    return _normalize_execution_mode(payload.get("execution_mode"))


def load_backtest_execution_mode() -> BacktestExecutionMode:
    mode = _normalize_execution_mode(load_all_settings().get("execution_mode"))
    if mode == "signal_close":
        return "signal_close"
    if mode == "next_open":
        return "next_open"

    legacy_mode = _load_legacy_execution_mode()
    if legacy_mode is not None:
        save_setting_value("execution_mode", legacy_mode)
        return legacy_mode

    return DEFAULT_BACKTEST_EXECUTION_MODE


def save_backtest_execution_mode(mode: str) -> BacktestExecutionMode:
    normalized: BacktestExecutionMode = (
        "next_open" if str(mode).strip().lower() == "next_open" else "signal_close"
    )
    save_setting_value("execution_mode", normalized)
    return normalized
