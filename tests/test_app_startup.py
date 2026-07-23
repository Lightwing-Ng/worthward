"""Tests for application-startup integrity checks.

Code version: v1.0.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app import create_app


class AppStartupTests(unittest.TestCase):
    def test_app_factory_runs_the_persisted_investment_evidence_scan(self) -> None:
        with patch("app.verify_persisted_investment_source_artifacts", return_value=2) as verifier:
            application = create_app()

        self.assertEqual(application.name, "app")
        verifier.assert_called_once_with()

    def test_app_factory_fails_closed_when_persisted_evidence_is_invalid(self) -> None:
        with patch(
            "app.verify_persisted_investment_source_artifacts",
            side_effect=RuntimeError("Investment source evidence file is missing or has changed."),
        ):
            with self.assertRaisesRegex(RuntimeError, "integrity check failed at startup"):
                create_app()


if __name__ == "__main__":
    unittest.main()
