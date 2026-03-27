"""
Backtest execution preference persistence.

Code version: v1.0.0
"""

from __future__ import annotations

import json
from typing import Literal

from .config import MARKET_STORE_DIR

BacktestExecutionMode = Literal["signal_close", "next_open"]
BACKTEST_SETTINGS_PATH = MARKET_STORE_DIR / "backtest_settings.json"
DEFAULT_BACKTEST_EXECUTION_MODE: BacktestExecutionMode = "next_open"


def load_backtest_execution_mode() -> BacktestExecutionMode:
    try:
        payload = json.loads(BACKTEST_SETTINGS_PATH.read_text()) if BACKTEST_SETTINGS_PATH.exists() else {}
    except (json.JSONDecodeError, OSError):
        return DEFAULT_BACKTEST_EXECUTION_MODE
    mode = str(payload.get("execution_mode", DEFAULT_BACKTEST_EXECUTION_MODE)).strip().lower()
    return mode if mode in {"signal_close", "next_open"} else DEFAULT_BACKTEST_EXECUTION_MODE


def save_backtest_execution_mode(mode: str) -> BacktestExecutionMode:
    normalized: BacktestExecutionMode = "next_open" if str(mode).strip().lower() == "next_open" else "signal_close"
    MARKET_STORE_DIR.mkdir(parents=True, exist_ok=True)
    BACKTEST_SETTINGS_PATH.write_text(json.dumps({"execution_mode": normalized}, ensure_ascii=False, indent=2))
    return normalized
