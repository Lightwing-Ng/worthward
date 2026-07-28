"""Runtime network certificate discovery tests.

Code version: v1.0.0
"""

from __future__ import annotations

import logging
from pathlib import Path
import subprocess
from unittest.mock import call, Mock

from app.infrastructure import runtime_network


def _reset_macos_ca_detection(monkeypatch, bundle_directory: Path) -> None:
    monkeypatch.setattr(runtime_network, "_CA_BUNDLE_DIRECTORY", bundle_directory)
    monkeypatch.setattr(
        runtime_network,
        "_MACOS_SYSTEM_CA_DETECTION_ATTEMPTED",
        False,
    )
    monkeypatch.setattr(runtime_network, "_MACOS_SYSTEM_CA_PEM", None)


def test_detects_and_resolves_macos_system_ca(
        monkeypatch,
        tmp_path: Path,
        caplog,
) -> None:
    root_pem = (
        b"-----BEGIN CERTIFICATE-----\nroot-ca\n"
        b"-----END CERTIFICATE-----\n"
    )
    system_pem = (
        b"-----BEGIN CERTIFICATE-----\nsystem-ca\n"
        b"-----END CERTIFICATE-----\n"
    )
    security_run = Mock(
        side_effect=(
            subprocess.CompletedProcess([], 0, stdout=root_pem, stderr=b""),
            subprocess.CompletedProcess([], 0, stdout=system_pem, stderr=b""),
        )
    )
    _reset_macos_ca_detection(monkeypatch, tmp_path)
    monkeypatch.setattr(runtime_network.sys, "platform", "darwin")
    monkeypatch.setattr(runtime_network.subprocess, "run", security_run)

    with caplog.at_level(logging.INFO):
        detected_path = runtime_network.detect_macos_system_ca_pem()

    assert detected_path is not None
    assert detected_path.parent == tmp_path
    assert detected_path.read_bytes() == root_pem + system_pem
    assert "Auto-detected 2 certificates" in caplog.text
    assert security_run.call_args_list == [
        call(
            [
                "security",
                "find-certificate",
                "-a",
                "-p",
                "/System/Library/Keychains/SystemRootCertificates.keychain",
            ],
            check=True,
            capture_output=True,
        ),
        call(
            [
                "security",
                "find-certificate",
                "-a",
                "-p",
                "/Library/Keychains/System.keychain",
            ],
            check=True,
            capture_output=True,
        ),
    ]

    resolved_path = runtime_network.resolve_yahoo_enterprise_ca_path(
        configured_path="",
        environ={},
    )

    assert resolved_path == detected_path
    assert security_run.call_count == 2


def test_macos_system_ca_detection_returns_none_off_macos(
        monkeypatch,
        tmp_path: Path,
) -> None:
    security_run = Mock()
    _reset_macos_ca_detection(monkeypatch, tmp_path)
    monkeypatch.setattr(runtime_network.sys, "platform", "linux")
    monkeypatch.setattr(runtime_network.subprocess, "run", security_run)

    assert runtime_network.detect_macos_system_ca_pem() is None
    security_run.assert_not_called()


def test_macos_system_ca_subprocess_failure_warns_and_returns_none(
        monkeypatch,
        tmp_path: Path,
        caplog,
) -> None:
    security_run = Mock(side_effect=subprocess.CalledProcessError(1, ["security"]))
    _reset_macos_ca_detection(monkeypatch, tmp_path)
    monkeypatch.setattr(runtime_network.sys, "platform", "darwin")
    monkeypatch.setattr(runtime_network.subprocess, "run", security_run)

    with caplog.at_level(logging.WARNING):
        assert runtime_network.detect_macos_system_ca_pem() is None
        assert runtime_network.detect_macos_system_ca_pem() is None

    assert security_run.call_count == 1
    assert "Unable to auto-detect macOS system CA certificates" in caplog.text


def test_macos_tls_hint_mentions_user_keychain_fallback(monkeypatch) -> None:
    monkeypatch.setattr(runtime_network.sys, "platform", "darwin")
    monkeypatch.setattr(runtime_network, "_YFINANCE_ENTERPRISE_CA_PATH", None)

    hint = runtime_network.add_yahoo_tls_configuration_hint(
        "CertificateVerifyError: certificate verify failed"
    )

    assert "the system keychain was checked automatically" in hint
    assert "corporate CA is in a user keychain" in hint
    assert runtime_network.YAHOO_CA_PEM_ENV in hint
