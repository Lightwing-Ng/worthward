"""Tests for portable application startup.

Code version: v1.2.0
"""

from __future__ import annotations

import unittest
import runpy
from unittest.mock import patch

from app import create_app


class AppStartupTests(unittest.TestCase):
    def test_host_and_port_aliases_preserve_canonical_precedence(self) -> None:
        # The spawn import path deliberately skips Flask and network startup.
        options = runpy.run_path("main.py", run_name="__mp_main__")["_build_run_options"]
        config = {"app": {"debug": False}, "server": {}}
        with patch.dict("os.environ", {"ANTIGRAVITY_HOST": "127.0.0.2", "ANTIGRAVITY_PORT": "8765"}, clear=True):
            self.assertEqual(options(config)["host"], "127.0.0.2")
            self.assertEqual(options(config)["port"], 8765)
            with patch.dict("os.environ", {"WORTHWARD_HOST": "127.0.0.3", "WORTHWARD_PORT": "8766"}):
                self.assertEqual(options(config)["host"], "127.0.0.3")
                self.assertEqual(options(config)["port"], 8766)

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
