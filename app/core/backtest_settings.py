"""
Backtest execution preference persistence.

Code version: v0.4.0
"""

from __future__ import annotations

import json
from typing import Literal

from app.core.config import MARKET_STORE_DIR
from app.core.settings_store import load_all_settings, save_setting_value

BacktestExecutionMode = Literal["signal_close", "next_open"]
BACKTEST_SETTINGS_PATH = MARKET_STORE_DIR / "backtest_settings.json"
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
            json.loads(BACKTEST_SETTINGS_PATH.read_text(encoding="utf-8"))
            if BACKTEST_SETTINGS_PATH.exists()
            else {}
        )
    except (json.JSONDecodeError, OSError):
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
