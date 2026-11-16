"""Exercise the HSBC cash paste preview against an isolated investment ledger.

Code version: v1.0.0
"""

from unittest.mock import patch

import pytest

from app import create_app
from app.infrastructure.storage import investment_evidence_dir_for
from app.services import investment_import
from app.web import runtime
from app.web.request_security import INVESTMENT_CSRF_HEADER, INVESTMENT_CSRF_SESSION_KEY


_PREVIEW_ROUTE = "/api/investment/imports/hsbc-paste/validate"
_TRANSACTION_ROUTE = "/api/investment/transactions"


@pytest.fixture
def cash_client(tmp_path, monkeypatch):
    ledger = tmp_path / "investment.sqlite3"
    cache = tmp_path / "investment_cache" / "transactions_payload.json"
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", ledger)
    monkeypatch.setattr(runtime, "INVESTMENT_TRANSACTIONS_CACHE_PATH", cache)
    monkeypatch.setattr(
        investment_import, "_load_local_private_investment_evidence", lambda: {}
    )
    client = create_app().test_client()
    token = "isolated-hsbc-cash-preview-" + "x" * 32
    with client.session_transaction() as browser_session:
        browser_session[INVESTMENT_CSRF_SESSION_KEY] = token
    headers = {"Origin": "http://localhost", INVESTMENT_CSRF_HEADER: token}
    return client, headers, ledger, cache


def _cash_page(account_type, date, description, amount, currency):
    return "\n".join(
        [
            account_type,
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            f"{amount} {currency}",
            "Available balance:",
            f"{amount} {currency}",
            "Post date Description Amount in Amount out Balance Additional options",
            date,
            description,
            amount,
            "0.00",
            amount,
            "Download",
        ]
    )


def test_cash_preview_lists_new_account_rows_without_writing(cash_client):
    client, headers, ledger, cache = cash_client
    current = _cash_page(
        "HKD Current", "15 Jul 2026", "LONGBRIDGE KOL REWARD", "1,000.00", "HKD"
    )
    savings = _cash_page("CNY Savings", "15 Jul 2026", "CNY INTEREST", "12.00", "CNY")

    response = client.post(
        _PREVIEW_ROUTE,
        headers=headers,
        json={"cash_account_text": current + "\n" + savings},
    )

    assert response.status_code == 200
    validation = response.get_json()
    assert validation["ready"] and validation["mode"] == "cash_only_non_usd"
    preview = validation["preview"]
    assert {row["description"] for row in preview["transactions"]} == {
        "KOL Rewards · LONGBRIDGE",
        "CNY INTEREST",
    }
    assert {row["change"] for row in preview["transactions"]} == {"added"}
    assert {
        (row["currency"], row["account_type"], row["amount"])
        for row in preview["balances"]
    } == {("HKD", "CURRENT", "1000.00"), ("CNH", "SAVINGS", "12.00")}
    assert not preview["positions"]
    assert not ledger.exists()
    assert not cache.exists()
    assert not investment_evidence_dir_for(ledger).exists()


def test_cash_preview_omits_saved_rows_and_preserves_cash_account_scope(cash_client):
    client, headers, ledger, _ = cash_client
    current = _cash_page(
        "HKD Current", "15 Jul 2026", "LONGBRIDGE KOL REWARD", "1,000.00", "HKD"
    )
    savings = _cash_page(
        "HKD Savings", "16 Jul 2026", "CREDIT INTEREST", "16.00", "HKD"
    )
    with patch("app.web.runtime.threading.Thread"):
        saved = client.post(
            _TRANSACTION_ROUTE,
            headers=headers,
            data={
                "broker": "hsbc",
                "hsbc_import_mode": "paste",
                "hsbc_cash_account_text": current,
            },
            content_type="multipart/form-data",
        )
    assert saved.status_code == 200
    assert saved.get_json()["success"]
    saved_bytes = ledger.read_bytes()

    for capture, expected_descriptions in (
        (current, []),
        (current + "\n" + savings, ["CREDIT INTEREST"]),
    ):
        response = client.post(
            _PREVIEW_ROUTE, headers=headers, json={"cash_account_text": capture}
        )
        assert response.status_code == 200
        preview = response.get_json()["preview"]
        assert [row["description"] for row in preview["transactions"]] == expected_descriptions
        assert [(row["currency"], row["account_type"]) for row in preview["balances"]] == (
            [("HKD", "SAVINGS")] if expected_descriptions else []
        )
        assert ledger.read_bytes() == saved_bytes
