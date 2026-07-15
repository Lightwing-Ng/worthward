"""Tests for browser-based Longbridge OAuth initiation.

Code version: v1.0.0
"""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from app import create_app
from app.core import broker_settings, settings_store
from app.core.broker_settings import BrokerSettings, load_broker_settings
from app.infrastructure import longbridge_cli


class LongbridgeBrowserOAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        longbridge_cli._BROWSER_OAUTH_PROCESS = None

    def tearDown(self) -> None:
        longbridge_cli._BROWSER_OAUTH_PROCESS = None

    def test_browser_oauth_starts_cli_without_receiving_a_credential(self) -> None:
        process = MagicMock()
        process.poll.return_value = None
        with (
            patch.object(longbridge_cli, "resolve_longbridge_cli_path", return_value="/tmp/longbridge"),
            patch.object(longbridge_cli, "_build_longbridge_cli_env", return_value={"HOME": "/tmp/profile"}),
            patch.object(longbridge_cli.subprocess, "Popen", return_value=process) as popen,
        ):
            success, message = longbridge_cli.start_longbridge_cli_browser_oauth(BrokerSettings())

        self.assertTrue(success)
        self.assertIn("browser", message.lower())
        self.assertEqual(
            popen.call_args.args[0],
            ["/tmp/longbridge", "auth", "login", "--auth-code", "--client-name", "antigravity"],
        )
        self.assertEqual(popen.call_args.kwargs["env"], {"HOME": "/tmp/profile"})
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_browser_oauth_does_not_launch_a_second_authorization_process(self) -> None:
        process = MagicMock()
        process.poll.return_value = None
        longbridge_cli._BROWSER_OAUTH_PROCESS = process

        with patch.object(longbridge_cli.subprocess, "Popen") as popen:
            success, message = longbridge_cli.start_longbridge_cli_browser_oauth(BrokerSettings())

        self.assertFalse(success)
        self.assertIn("already open", message)
        popen.assert_not_called()

    def test_broker_access_authorize_action_never_accepts_posted_longbridge_secret(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_path = root / "settings.json"
            broker_legacy_path = root / "brokers.json"
            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", settings_path),
                patch.dict(settings_store.LEGACY_SECTION_PATHS, {"brokers": broker_legacy_path}),
                patch.object(broker_settings, "SETTINGS_STORE_DIR", root),
                patch.object(broker_settings, "BROKER_SETTINGS_PATH", broker_legacy_path),
                patch("app.web.runtime.start_longbridge_cli_browser_oauth", return_value=(True, "Browser opened.")) as authorize,
            ):
                client = create_app().test_client()
                response = client.post(
                    "/settings/broker-access/action",
                    data={
                        "selected_broker": "longbridge",
                        "action": "authorize",
                        "longbridge_access_token": "must-not-be-saved",
                    },
                )
                persisted = load_broker_settings()

            self.assertEqual(response.status_code, 303)
            authorize.assert_called_once()
            self.assertEqual(persisted.selected_broker, "longbridge")
            self.assertEqual(persisted.longbridge_auth_mode, "cli_oauth")
            self.assertFalse(persisted.longbridge_access_token)
            payload = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertNotIn("must-not-be-saved", json.dumps(payload))

    def test_broker_access_renders_browser_oauth_without_credential_inputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with (
                patch.object(settings_store, "SETTINGS_STORE_DIR", root),
                patch.object(settings_store, "GENERAL_SETTINGS_PATH", root / "settings.json"),
                patch.dict(settings_store.LEGACY_SECTION_PATHS, {"brokers": root / "brokers.json"}),
                patch.object(broker_settings, "SETTINGS_STORE_DIR", root),
                patch.object(broker_settings, "BROKER_SETTINGS_PATH", root / "brokers.json"),
            ):
                response = create_app().test_client().get("/settings/broker-access")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('value="ibkr"', html)
        self.assertIn('value="longbridge"', html)
        self.assertIn("Authorize in browser", html)
        self.assertNotIn("longbridge_auth_code", html)
        self.assertNotIn('name="longbridge_access_token"', html)


if __name__ == "__main__":
    unittest.main()
