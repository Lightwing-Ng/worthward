"""Verify the credit-card HTTP boundary with independent temporary ledgers.

Code version: v1.0.2
- Added: Committed card rewards are read back for immediate Metrics refresh.
- Fixed: Legacy mode rejection directs users to the unified account-page field.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from flask import Flask
import pytest

from app.web.runtime_domains.investment import credit_cards
from app.web.request_security import INVESTMENT_CSRF_SESSION_KEY
from tests.factories.hsbc_credit_card import hsbc_credit_card_text


@pytest.fixture
def card_client(tmp_path):
    production = (
        Path(__file__).resolve().parents[3] / "settings_store/investment.parquet"
    )
    before = (
        hashlib.sha256(production.read_bytes()).digest()
        if production.exists()
        else None
    )
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="isolated-card-route-test")
    ledger = tmp_path / "cards" / "credit_cards.json"
    context = credit_cards.build_credit_card_context({"CREDIT_CARD_STORE_PATH": ledger})
    app.post("/api/credit-cards/hsbc/preview")(context["credit_card_preview"])
    app.post("/api/credit-cards/hsbc/import")(context["credit_card_import"])
    app.get("/api/credit-cards/hsbc")(context["credit_card_read"])
    client = app.test_client()
    token = "card-test-session-" + "x" * 32
    with client.session_transaction() as session:
        session[INVESTMENT_CSRF_SESSION_KEY] = token
    headers = {"Origin": "http://localhost", "X-CSRF-Token": token}
    yield client, headers, ledger
    after = (
        hashlib.sha256(production.read_bytes()).digest()
        if production.exists()
        else None
    )
    assert after == before


def test_credit_card_preview_is_read_only_and_classifies_without_exposing_source(
    card_client,
):
    client, headers, ledger = card_client
    text = hsbc_credit_card_text()
    response = client.post(
        "/api/credit-cards/hsbc/preview", json={"text": text}, headers=headers
    )
    assert response.status_code == 200
    result = response.get_json()
    assert result["success"] and result["ready"] and not result["committed"]
    assert result["source_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert len(result["transactions"]) == 11
    assert result["summary"]["posted_purchase_total"] == "4218.50"
    assert result["summary"]["repayment_total"] == "4730.00"
    assert result["summary"]["rewardcash_total"] == "40.00"
    assert result["summary"]["pending_total"] == "2450.00"
    assert result["snapshot"]["current_amount_due"] == "0.00"
    assert "4111-1111-1111-1111" not in response.text
    assert "SAMPLE CARDHOLDER" not in response.text
    assert '"source"' not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert not ledger.parent.exists()


def test_credit_card_import_round_trip_and_repeat_keep_investment_separate(card_client):
    client, headers, ledger = card_client
    text = hsbc_credit_card_text()
    request = {"text": text, "source_sha256": hashlib.sha256(text.encode()).hexdigest()}
    first = client.post("/api/credit-cards/hsbc/import", json=request, headers=headers)
    assert first.status_code == 200
    assert first.get_json()["committed"]
    rewards = first.get_json()["credit_card_rewards"]
    assert rewards["status"] == "complete"
    assert sorted(row["amount"] for row in rewards["transactions"]) == ["15.00", "25.00"]
    assert all(set(row) == {"id", "date", "amount", "currency"} for row in rewards["transactions"])
    before = ledger.read_bytes()
    replay = client.post("/api/credit-cards/hsbc/import", json=request, headers=headers)
    assert replay.status_code == 200
    assert replay.get_json()["summary"]["added_count"] == 0
    assert replay.get_json()["summary"]["promoted_count"] == 0
    assert ledger.read_bytes() == before
    saved = client.get("/api/credit-cards/hsbc")
    assert saved.status_code == 200
    assert len(saved.get_json()["transactions"]) == 11
    assert "4111111111111111" not in saved.text
    assert "SAMPLE CARDHOLDER" not in saved.text
    assert "source_text" not in saved.text
    assert not (ledger.parent / "investment.parquet").exists()


@pytest.mark.parametrize("endpoint", ["preview", "import"])
@pytest.mark.parametrize("security", ["absent", "wrong_token", "cross_origin"])
def test_credit_card_routes_require_the_existing_browser_security_boundary(
    card_client, endpoint, security
):
    client, headers, ledger = card_client
    headers = dict(headers)
    if security == "absent":
        headers = {}
    elif security == "wrong_token":
        headers["X-CSRF-Token"] = "wrong-" + "x" * 32
    else:
        headers["Origin"] = "https://untrusted.example"
    response = client.post(
        f"/api/credit-cards/hsbc/{endpoint}",
        json={"text": hsbc_credit_card_text()},
        headers=headers,
    )
    assert response.status_code == 403
    assert not ledger.parent.exists()


@pytest.mark.parametrize(
    "payload", [None, [], {}, {"text": []}, {"text": 123}, {"text": "not a card page"}]
)
def test_credit_card_routes_reject_invalid_input_without_creating_a_store(
    card_client, payload
):
    client, headers, ledger = card_client
    response = client.post(
        "/api/credit-cards/hsbc/preview", json=payload, headers=headers
    )
    assert response.status_code == 400
    assert not response.get_json()["success"]
    assert not ledger.parent.exists()


def test_credit_card_import_rejects_edited_preview_text(card_client):
    client, headers, ledger = card_client
    response = client.post(
        "/api/credit-cards/hsbc/import",
        json={"text": hsbc_credit_card_text(), "source_sha256": "0" * 64},
        headers=headers,
    )
    assert response.status_code == 400
    assert "Preview it again" in response.get_json()["error"]
    assert not ledger.parent.exists()


def test_credit_card_route_limits_source_size_and_handles_store_failure(
    card_client, monkeypatch
):
    client, headers, ledger = card_client
    monkeypatch.setattr(credit_cards, "MAX_CREDIT_CARD_TEXT_BYTES", 10)
    response = client.post(
        "/api/credit-cards/hsbc/preview",
        json={"text": hsbc_credit_card_text()},
        headers=headers,
    )
    assert response.status_code == 413
    assert not ledger.parent.exists()
    ledger.parent.mkdir()
    ledger.write_text("corrupted ledger")
    response = client.get("/api/credit-cards/hsbc")
    assert response.status_code == 500
    assert ledger.read_text() == "corrupted ledger"


def test_empty_saved_card_read_has_no_side_effects(card_client):
    client, _, ledger = card_client
    response = client.get("/api/credit-cards/hsbc")
    assert response.status_code == 200
    assert response.get_json()["transactions"] == []
    assert response.get_json()["accounts"] == []
    assert not ledger.parent.exists()


def test_credit_card_endpoints_are_registered_in_the_real_application(app):
    routes = {rule.rule for rule in app.url_map.iter_rules()}
    assert {
        "/api/credit-cards/hsbc",
        "/api/credit-cards/hsbc/preview",
        "/api/credit-cards/hsbc/import",
    } <= routes


def test_credit_card_mode_cannot_reach_the_investment_commit_path(app):
    client = app.test_client()
    token = "separate-card-route-" + "x" * 32
    with client.session_transaction() as session:
        session[INVESTMENT_CSRF_SESSION_KEY] = token
    response = client.post(
        "/api/investment/transactions",
        data={"broker": "hsbc", "hsbc_import_mode": "credit_card"},
        headers={"Origin": "http://localhost", "X-CSRF-Token": token},
    )
    assert response.status_code == 400
    error = response.get_json()["error"]
    assert "select HSBC, then Copy/paste" in error
    assert "first account-page field and select Preview" in error
    assert "separate captures" in error
    assert "dedicated HSBC Credit card importer" not in error


def test_cross_date_pending_match_requires_review_and_cannot_commit(card_client):
    client, headers, ledger = card_client

    def text(day, pending):
        rows = (
            f"{day} Oct 2026\nCard ending in 1111\nAPPLEPAY SAMPLE CAFE HK\n42.50 HKD"
        )
        if pending:
            rows += "\nPending"
        return hsbc_credit_card_text(transactions=rows)

    assert (
        client.post(
            "/api/credit-cards/hsbc/import",
            json={"text": text(10, True)},
            headers=headers,
        ).status_code
        == 200
    )
    before = ledger.read_bytes()
    preview = client.post(
        "/api/credit-cards/hsbc/preview",
        json={"text": text(12, False)},
        headers=headers,
    )
    assert preview.status_code == 200
    assert preview.get_json()["success"] and not preview.get_json()["ready"]
    assert preview.get_json()["review_required"]
    response = client.post(
        "/api/credit-cards/hsbc/import", json={"text": text(12, False)}, headers=headers
    )
    assert response.status_code == 400
    assert not response.get_json()["success"]
    assert ledger.read_bytes() == before
