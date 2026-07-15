"""Security boundary regression tests.

Code version: v1.4.0
"""

from __future__ import annotations

import os
from pathlib import Path
import ssl
import tempfile
import tomllib
import unittest
from unittest.mock import Mock, patch
from urllib.request import ProxyHandler, Request

import certifi

from app.infrastructure import connectivity, runtime_network, yahoo_chart
from app.infrastructure.ibkr_flex import IbkrFlexError, send_flex_request
from app.infrastructure.runtime_network import (
    YAHOO_CA_PEM_ENV,
    YahooTLSConfigurationError,
    add_yahoo_tls_configuration_hint,
    bootstrap_runtime_network_for_yfinance,
    build_yahoo_ca_bundle,
    get_yfinance_session,
    open_scoped_network_url,
    resolve_yahoo_enterprise_ca_path,
)
from app.services import logos


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
                    YAHOO_CA_PEM_ENV: "",
                },
                clear=False,
        ):
            session = bootstrap_runtime_network_for_yfinance()

        self.assertIs(ssl._create_default_https_context, original_default_context)
        self.assertIs(session.verify, True)

    def test_macos_proxy_session_uses_combined_ca_without_replacing_proxy_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            enterprise_ca = Path(directory) / "corporate.pem"
            enterprise_ca.write_bytes(Path(certifi.where()).read_bytes())
            proxy_environment = {
                "HTTP_PROXY": "http://127.0.0.1:8888",
                "HTTPS_PROXY": "http://127.0.0.1:8888",
                YAHOO_CA_PEM_ENV: str(enterprise_ca),
            }

            with patch.dict(os.environ, proxy_environment, clear=True):
                session = bootstrap_runtime_network_for_yfinance()

                self.assertEqual(os.environ["HTTP_PROXY"], proxy_environment["HTTP_PROXY"])
                self.assertEqual(os.environ["HTTPS_PROXY"], proxy_environment["HTTPS_PROXY"])
                bundle_bytes = Path(session.verify).read_bytes()
                opener = runtime_network._SCOPED_NETWORK_OPENER
                assert opener is not None
                proxy_handler = next(
                    handler for handler in opener.handlers
                    if isinstance(handler, ProxyHandler)
                )

            self.assertIn(Path(certifi.where()).read_bytes(), bundle_bytes)
            self.assertIn(enterprise_ca.read_bytes(), bundle_bytes)
            self.assertEqual(proxy_handler.proxies["http"], proxy_environment["HTTP_PROXY"])
            self.assertEqual(proxy_handler.proxies["https"], proxy_environment["HTTPS_PROXY"])

    def test_scoped_network_opener_reuses_verified_proxy_aware_client(self) -> None:
        opener = Mock()
        response = object()
        opener.open.return_value = response
        request_obj = Request("https://query1.finance.yahoo.com/")

        with patch("app.infrastructure.runtime_network._SCOPED_NETWORK_OPENER", opener):
            opened = open_scoped_network_url(request_obj, timeout=4)

        self.assertIs(opened, response)
        opener.open.assert_called_once_with(request_obj, timeout=4)

    def test_authorized_network_consumers_share_only_the_scoped_opener(self) -> None:
        self.assertIs(yahoo_chart.urlopen, open_scoped_network_url)
        self.assertIs(connectivity.urlopen, open_scoped_network_url)
        self.assertIs(logos.urlopen, open_scoped_network_url)

    def test_direct_session_needs_neither_proxy_nor_enterprise_ca(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            session = bootstrap_runtime_network_for_yfinance()

            self.assertNotIn("HTTP_PROXY", os.environ)
            self.assertNotIn("HTTPS_PROXY", os.environ)
            self.assertIs(session.verify, True)

    def test_environment_ca_path_takes_precedence_over_configured_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment_ca = Path(directory) / "environment.pem"
            configured_ca = Path(directory) / "configured.pem"
            environment_ca.write_text(
                "-----BEGIN CERTIFICATE-----\nenvironment-ca\n-----END CERTIFICATE-----\n",
                encoding="ascii",
            )
            configured_ca.write_text(
                "-----BEGIN CERTIFICATE-----\nconfigured-ca\n-----END CERTIFICATE-----\n",
                encoding="ascii",
            )

            resolved = resolve_yahoo_enterprise_ca_path(
                configured_ca,
                environ={YAHOO_CA_PEM_ENV: str(environment_ca)},
            )

        self.assertEqual(resolved, environment_ca.resolve())

    def test_missing_enterprise_ca_path_fails_with_actionable_variable_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing_ca = Path(directory) / "missing.pem"

            with self.assertRaisesRegex(YahooTLSConfigurationError, YAHOO_CA_PEM_ENV):
                resolve_yahoo_enterprise_ca_path(missing_ca, environ={})

    def test_non_pem_enterprise_ca_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            invalid_ca = Path(directory) / "invalid.pem"
            invalid_ca.write_text("not a certificate", encoding="ascii")

            with self.assertRaisesRegex(
                    YahooTLSConfigurationError,
                    "not a PEM certificate bundle",
            ):
                build_yahoo_ca_bundle(invalid_ca)

    def test_yfinance_session_is_reused_after_bootstrap(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            bootstrapped_session = bootstrap_runtime_network_for_yfinance()

            self.assertIs(get_yfinance_session(), bootstrapped_session)

    def test_enterprise_ca_bundle_keeps_certifi_public_roots(self) -> None:
        with self.subTest("configured path wins when environment is empty"):
            with patch.dict(os.environ, {YAHOO_CA_PEM_ENV: ""}):
                with tempfile.TemporaryDirectory() as directory:
                    enterprise_ca = Path(directory) / "corporate.pem"
                    enterprise_ca.write_text(
                        "-----BEGIN CERTIFICATE-----\ncorporate-ca\n-----END CERTIFICATE-----\n",
                        encoding="ascii",
                    )
                    resolved = resolve_yahoo_enterprise_ca_path(str(enterprise_ca))
                    bundle = build_yahoo_ca_bundle(resolved)

                    bundle_bytes = bundle.read_bytes()
                    self.assertIn(Path(certifi.where()).read_bytes(), bundle_bytes)
                    self.assertIn(enterprise_ca.read_bytes(), bundle_bytes)

    def test_unconfigured_certificate_failure_names_ca_variable(self) -> None:
        with patch("app.infrastructure.runtime_network._YFINANCE_ENTERPRISE_CA_PATH", None):
            message = add_yahoo_tls_configuration_hint(
                "CertificateVerifyError: curl (60) SSL certificate problem"
            )

        self.assertIn(YAHOO_CA_PEM_ENV, message)
        self.assertIn("[network].yahoo_ca_pem", message)
        self.assertIn("TLS verification remains required", message)


class DefaultServerSecurityTests(unittest.TestCase):
    def test_versioned_config_disables_debug_and_binds_loopback(self) -> None:
        config_path = Path(__file__).resolve().parents[1] / "config.toml"
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)

        self.assertIs(config["app"]["debug"], False)
        self.assertEqual(config["server"]["host"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
