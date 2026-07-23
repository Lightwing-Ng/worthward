"""Tests for optional local debug event reporting.

Code version: v1.0.0
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.core import debug_reporting


class DebugReportingTests(unittest.TestCase):
    def setUp(self) -> None:
        debug_reporting.load_optional_debug_endpoint.cache_clear()

    def tearDown(self) -> None:
        debug_reporting.load_optional_debug_endpoint.cache_clear()

    def test_missing_optional_config_disables_debug_reporting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(debug_reporting, "DEBUG_CONFIG_DIR", Path(directory)):
                config = debug_reporting.load_optional_debug_endpoint(
                    "missing.env",
                    "test-session",
                )

        self.assertIsNone(config)

    def test_loopback_http_or_https_config_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "debug.env"
            config_path.write_text(
                "DEBUG_SERVER_URL=https://localhost:8877/event\n"
                "DEBUG_SESSION_ID=local-test-session\n",
                encoding="utf-8",
            )
            with patch.object(debug_reporting, "DEBUG_CONFIG_DIR", Path(directory)):
                config = debug_reporting.load_optional_debug_endpoint(
                    "debug.env",
                    "fallback-session",
                )

        self.assertEqual(
            config,
            {
                "url": "https://localhost:8877/event",
                "sessionId": "local-test-session",
            },
        )

    def test_non_loopback_or_invalid_debug_urls_disable_reporting(self) -> None:
        invalid_urls = (
            "ftp://127.0.0.1:7777/event",
            "http://debug.example.test/event",
            "http://operator:secret@127.0.0.1:7777/event",
            "http://127.0.0.1:0/event",
            "http://127.0.0.1:70000/event",
            "http://127.0.0.1:not-a-port/event",
            "http://127.0.0.1../event",
        )

        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "debug.env"
            with patch.object(debug_reporting, "DEBUG_CONFIG_DIR", Path(directory)):
                for url in invalid_urls:
                    with self.subTest(url=url):
                        config_path.write_text(
                            f"DEBUG_SERVER_URL={url}\n",
                            encoding="utf-8",
                        )
                        debug_reporting.load_optional_debug_endpoint.cache_clear()

                        config = debug_reporting.load_optional_debug_endpoint(
                            "debug.env",
                            "test-session",
                        )

                        self.assertIsNone(config)

    def test_post_redacts_nested_sensitive_data_and_auth_text(self) -> None:
        bearer_token = "opaque-debug-token"
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZWJ1ZyJ9.signature"
        debug_config = {
            "url": "http://127.0.0.1:7777/event",
            "sessionId": "local-test-session",
        }

        with patch(
                "app.core.debug_reporting.urlopen",
                return_value=io.BytesIO(b"ok"),
        ) as urlopen_mock:
            debug_reporting.post_debug_event(
                debug_config,
                hypothesis_id="A",
                location="tests:test_post_redacts_nested_sensitive_data_and_auth_text",
                msg=(
                    f"Authorization: Bearer {bearer_token}; "
                    f"jwt={jwt}; token={bearer_token}"
                ),
                data={
                    "access_token": bearer_token,
                    "nested": {
                        "password": "do-not-send",
                        "note": f"Bearer {bearer_token} and {jwt}",
                    },
                    "items": [
                        {"client_secret": "also-do-not-send"},
                        "cookie=session-cookie-value",
                    ],
                    "safe": "visible",
                },
                run_id="test-run",
            )

        request = urlopen_mock.call_args.args[0]
        serialized_payload = request.data.decode("utf-8")
        payload = json.loads(serialized_payload)
        self.assertNotIn(bearer_token, serialized_payload)
        self.assertNotIn(jwt, serialized_payload)
        self.assertNotIn("do-not-send", serialized_payload)
        self.assertNotIn("also-do-not-send", serialized_payload)
        self.assertEqual(payload["data"]["access_token"], "[REDACTED]")
        self.assertEqual(payload["data"]["nested"]["password"], "[REDACTED]")
        self.assertEqual(payload["data"]["items"][0]["client_secret"], "[REDACTED]")
        self.assertEqual(payload["data"]["safe"], "visible")
        self.assertIn("Authorization: [REDACTED]", payload["msg"])
        self.assertIn("jwt=[REDACTED]", payload["msg"])
        self.assertIn("cookie=[REDACTED]", payload["data"]["items"][1])

    def test_post_refuses_a_manually_supplied_non_loopback_url(self) -> None:
        with patch("app.core.debug_reporting.urlopen") as urlopen_mock:
            debug_reporting.post_debug_event(
                {
                    "url": "http://debug.example.test/event",
                    "sessionId": "local-test-session",
                },
                hypothesis_id="A",
                location="tests:test_post_refuses_a_manually_supplied_non_loopback_url",
                msg="This event must stay local.",
                run_id="test-run",
            )

        urlopen_mock.assert_not_called()

    def test_text_sanitization_preserves_an_existing_redaction_marker(self) -> None:
        self.assertEqual(
            debug_reporting._redact_debug_text("token=[REDACTED]"),
            "token=[REDACTED]",
        )

    def test_post_failures_remain_silent(self) -> None:
        with patch(
                "app.core.debug_reporting.urlopen",
                side_effect=OSError("debug server unavailable"),
        ):
            debug_reporting.post_debug_event(
                {
                    "url": "http://127.0.0.1:7777/event",
                    "sessionId": "local-test-session",
                },
                hypothesis_id="A",
                location="tests:test_post_failures_remain_silent",
                msg="Transient local failure is intentionally non-fatal.",
                run_id="test-run",
            )


if __name__ == "__main__":
    unittest.main()
