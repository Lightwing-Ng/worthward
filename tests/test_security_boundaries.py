"""Security boundary regression tests.

Code version: v1.0.0
"""

from __future__ import annotations

import os
from pathlib import Path
import ssl
import tomllib
import unittest
from unittest.mock import patch

from app.infrastructure.ibkr_flex import IbkrFlexError, send_flex_request
from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance


class IbkrFlexSecurityTests(unittest.TestCase):
    def test_send_request_rejects_non_https_url_before_sending_token(self) -> None:
        with patch("app.infrastructure.ibkr_flex.urlopen") as mocked_urlopen:
            with self.assertRaisesRegex(IbkrFlexError, "Flex SendRequest URL must use HTTPS"):
                send_flex_request(
                    token="audit-token",
                    query_id="audit-query",
                    send_request_url="http://127.0.0.1:7777/collect",
                )

        mocked_urlopen.assert_not_called()

    def test_send_request_rejects_unapproved_https_host_before_sending_token(self) -> None:
        with patch("app.infrastructure.ibkr_flex.urlopen") as mocked_urlopen:
            with self.assertRaisesRegex(IbkrFlexError, "Flex SendRequest URL uses unapproved host"):
                send_flex_request(
                    token="audit-token",
                    query_id="audit-query",
                    send_request_url="https://example.test/collect",
                )

        mocked_urlopen.assert_not_called()


class RuntimeNetworkSecurityTests(unittest.TestCase):
    def test_proxy_bootstrap_does_not_disable_process_wide_tls_verification(self) -> None:
        original_default_context = ssl._create_default_https_context

        with patch.dict(
                os.environ,
                {
                    "HTTP_PROXY": "http://127.0.0.1:8888",
                    "HTTPS_PROXY": "http://127.0.0.1:8888",
                },
                clear=False,
        ):
            bootstrap_runtime_network_for_yfinance()

        self.assertIs(ssl._create_default_https_context, original_default_context)


class DefaultServerSecurityTests(unittest.TestCase):
    def test_versioned_config_disables_debug_and_binds_loopback(self) -> None:
        config_path = Path(__file__).resolve().parents[1] / "config.toml"
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)

        self.assertIs(config["app"]["debug"], False)
        self.assertEqual(config["server"]["host"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
