"""
Tests for backtest execution mode persistence.

Code version: v0.1.0
"""

from __future__ import annotations

import json
from tempfile import TemporaryDirectory
from pathlib import Path
import unittest
from unittest.mock import patch

from app.core import backtest_settings
from app.core import settings_store


class BacktestSettingsTests(unittest.TestCase):
    def test_load_backtest_execution_mode_reads_unified_settings(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_path = root / "settings.json"
            settings_path.write_text(
                json.dumps({"execution_mode": "signal_close"}),
                encoding="utf-8",
            )

            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", settings_path),
                patch.object(backtest_settings, "BACKTEST_SETTINGS_PATH", root / "legacy.json"),
            ):
                self.assertEqual(
                    backtest_settings.load_backtest_execution_mode(),
                    "signal_close",
                )

    def test_save_backtest_execution_mode_writes_unified_settings_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_path = root / "settings.json"
            legacy_path = root / "legacy.json"

            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", settings_path),
                patch.object(backtest_settings, "BACKTEST_SETTINGS_PATH", legacy_path),
            ):
                self.assertEqual(
                    backtest_settings.save_backtest_execution_mode("next_open"),
                    "next_open",
                )

            payload = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["execution_mode"], "next_open")
            self.assertFalse(legacy_path.exists())

    def test_load_backtest_execution_mode_migrates_legacy_settings(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_path = root / "settings.json"
            legacy_path = root / "legacy.json"
            legacy_path.write_text(
                json.dumps({"execution_mode": "signal_close"}),
                encoding="utf-8",
            )

            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", settings_path),
                patch.object(backtest_settings, "BACKTEST_SETTINGS_PATH", legacy_path),
            ):
                self.assertEqual(
                    backtest_settings.load_backtest_execution_mode(),
                    "signal_close",
                )

            payload = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["execution_mode"], "signal_close")


if __name__ == "__main__":
    unittest.main()
