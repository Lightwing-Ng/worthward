"""Worthward branding migration compatibility tests.

Code version: v0.1.0
"""

from __future__ import annotations

from pathlib import Path

from app.core.branding import read_compatible_environment
from app.core.config import resolve_store_directory
from app.core.live_trading_security import (
    LEGACY_LIVE_TRADING_PIN_ENV,
    LEGACY_LIVE_TRADING_TOKEN_ENV,
    load_live_trading_access_token,
    resolve_live_trading_pin,
)
from app.infrastructure import connectivity, runtime_network


def test_worthward_environment_wins_over_legacy_alias(monkeypatch) -> None:
    monkeypatch.setenv("WORTHWARD_TEST_VALUE", "current")
    monkeypatch.setenv("ANTIGRAVITY_TEST_VALUE", "legacy")

    assert read_compatible_environment(
        "WORTHWARD_TEST_VALUE",
        "ANTIGRAVITY_TEST_VALUE",
    ) == "current"


def test_legacy_store_override_remains_readable(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("WORTHWARD_TEST_STORE", raising=False)
    monkeypatch.setenv("ANTIGRAVITY_TEST_STORE", str(tmp_path))

    assert resolve_store_directory(
        "WORTHWARD_TEST_STORE",
        tmp_path / "fallback",
    ) == tmp_path.resolve()


def test_legacy_live_trading_credentials_remain_readable(monkeypatch) -> None:
    legacy_token = "legacy-token-with-at-least-32-characters-123"
    monkeypatch.delenv("WORTHWARD_LIVE_TRADING_TOKEN", raising=False)
    monkeypatch.setenv(LEGACY_LIVE_TRADING_TOKEN_ENV, legacy_token)
    monkeypatch.delenv("WORTHWARD_LIVE_TRADING_PIN", raising=False)
    monkeypatch.setenv(LEGACY_LIVE_TRADING_PIN_ENV, "123456")

    assert load_live_trading_access_token() == legacy_token
    assert resolve_live_trading_pin("") == "123456"


def test_legacy_network_configuration_remains_readable(tmp_path: Path) -> None:
    ca_path = tmp_path / "legacy-ca.pem"
    ca_path.write_text("legacy ca", encoding="ascii")

    assert runtime_network.resolve_yahoo_enterprise_ca_path(
        configured_path="",
        environ={"ANTIGRAVITY_YAHOO_CA_PEM": str(ca_path)},
    ) == ca_path.resolve()
    assert connectivity.is_remote_market_access_disabled(
        {"ANTIGRAVITY_REMOTE_MARKET_ACCESS": "disabled"},
    )
