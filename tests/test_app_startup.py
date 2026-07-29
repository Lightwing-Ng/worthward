"""Tests for portable application startup.

Code version: v1.1.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app import create_app


class AppStartupTests(unittest.TestCase):
    def test_app_factory_does_not_require_device_local_investment_evidence(self) -> None:
        with patch(
            "app.infrastructure.storage.verify_persisted_investment_source_artifacts",
            side_effect=RuntimeError("Device-local evidence is unavailable."),
        ) as verifier:
            application = create_app()

        self.assertEqual(application.name, "app")
        verifier.assert_not_called()


if __name__ == "__main__":
    unittest.main()
