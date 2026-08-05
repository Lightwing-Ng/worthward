"""Tests for the persisted Investment accounting preference.

Code version: v0.1.0
"""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.core import investment_settings, settings_store


class InvestmentSettingsTests(unittest.TestCase):
    def test_missing_or_invalid_value_uses_lowest_cost_default(self) -> None:
        self.assertEqual(
            investment_settings.normalize_investment_cost_basis_method("unknown"),
            investment_settings.DEFAULT_INVESTMENT_COST_BASIS_METHOD,
        )

    def test_save_preserves_other_settings_in_the_unified_store(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_path = root / "settings.json"
            settings_path.write_text(
                json.dumps(
                    {
                        "theme": "dark",
                        "investment": {"other_preference": "preserve"},
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", settings_path),
            ):
                self.assertEqual(
                    investment_settings.load_investment_cost_basis_method(),
                    "lowest_cost_first",
                )
                self.assertEqual(
                    investment_settings.save_investment_cost_basis_method("FIFO"),
                    "fifo",
                )

            payload = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["theme"], "dark")
            self.assertEqual(payload["investment"]["other_preference"], "preserve")
            self.assertEqual(payload["investment"]["cost_basis_method"], "fifo")


if __name__ == "__main__":
    unittest.main()
