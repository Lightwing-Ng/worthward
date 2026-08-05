"""
Tests for the network dependency self-checks.

Code version: v0.3.0
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from urllib.error import HTTPError

import app.infrastructure.connectivity as connectivity


def _result(key: str, *, state: str = "available", is_available: bool = True) -> dict[str, object]:
    return {
        "key": key,
        "state": state,
        "is_available": is_available,
        "note": f"{key} checked",
        "checked_at": 1_756_000_000.0,
        "latency_ms": 12,
        "endpoint": "https://example.test/",
    }


def test_http_probe_distinguishes_reachable_auth_failure(monkeypatch) -> None:
    def raise_unauthorized(_request, *, timeout):
        raise HTTPError(
            "https://example.test/",
            401,
            "Unauthorized",
            {},
            None,
        )

    monkeypatch.setattr(connectivity, "urlopen", raise_unauthorized)

    outcome = connectivity._http_probe("https://example.test/")

    assert outcome["reachable"] is True
    assert outcome["usable"] is False
    assert outcome["detail"] == "HTTP 401"


def test_network_self_check_covers_all_fixed_external_dependencies(monkeypatch) -> None:
    probe_keys = (
        "market",
        "sec",
        "longbridge",
        "logo",
        "google-hk",
        "smtp",
    )
    monkeypatch.setattr(connectivity, "_probe_yahoo_service", lambda: _result("market"))
    monkeypatch.setattr(connectivity, "_probe_sec_service", lambda: _result("sec"))
    monkeypatch.setattr(
        connectivity,
        "_probe_longbridge_service",
        lambda _settings: _result("longbridge"),
    )
    monkeypatch.setattr(
        connectivity,
        "_probe_fallback_http_service",
        lambda key, _label, _urls, headers=None: _result(key),
    )
    monkeypatch.setattr(
        connectivity,
        "_probe_smtp_service",
        lambda _settings: _result("smtp"),
    )
    payload = connectivity.run_network_self_check(
        smtp_settings=SimpleNamespace(),
        broker_settings=SimpleNamespace(selected_broker="longbridge"),
    )

    assert [row["key"] for row in payload["rows"]] == list(probe_keys)
    assert payload["transport_note"].startswith("Checks run from the application host.")


def test_disabled_market_access_is_visible_as_configuration_state(monkeypatch) -> None:
    monkeypatch.setenv(connectivity.REMOTE_MARKET_ACCESS_ENV, "disabled")

    result = connectivity._probe_yahoo_service()

    assert result["state"] == "disabled"
    assert result["is_available"] is False
    assert connectivity.REMOTE_MARKET_ACCESS_ENV in str(result["note"])


def test_yfinance_probe_suppresses_provider_diagnostics(monkeypatch, caplog) -> None:
    class FakeFrame:
        empty = False
        columns = ["Close"]

    def fake_download(*_args, **_kwargs):
        logging.getLogger("yfinance").error("AAPL: possibly delisted")
        return FakeFrame()

    monkeypatch.setattr(connectivity.yf, "download", fake_download)

    with caplog.at_level(logging.ERROR, logger="yfinance"):
        assert connectivity._probe_yfinance_history() is True

    assert not [record for record in caplog.records if record.name == "yfinance"]


def test_sec_self_check_covers_data_and_archive_endpoints(monkeypatch) -> None:
    probed_urls: list[str] = []

    def fake_http_probe(remote_url: str, **_kwargs):
        probed_urls.append(remote_url)
        return {
            "reachable": True,
            "usable": remote_url != connectivity.SEC_WEB_PING_URL,
            "detail": "HTTP 200",
            "latency_ms": 8,
        }

    monkeypatch.setattr(connectivity, "_http_probe", fake_http_probe)

    result = connectivity._probe_sec_service()

    assert result["state"] == "available"
    assert result["is_available"] is True
    assert set(probed_urls) == {
        connectivity.SEC_PING_URL,
        connectivity.SEC_FACTS_PING_URL,
        connectivity.SEC_WEB_PING_URL,
    }
