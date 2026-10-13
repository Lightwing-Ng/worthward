"""Permit reviewed replacement of an unresolved historical transfer owner.

Code version: v0.1.0
"""

import json

from app import create_app
from app.infrastructure.storage import load_investment_store_payload
from app.services import investment_import as service
from app.web import runtime
from tests.python.services.test_investment_transfer_identity_audit import (
    deposit,
    withdrawal,
)


def test_unresolved_historical_binding_does_not_block_reviewed_current_pair(
    tmp_path, monkeypatch
):
    old = deposit(12, "may.csv", "a" * 64, "Old description")
    old_duplicate = deposit(13, "may.csv", "a" * 64, "Other old description")
    bank = withdrawal()
    old_index = service.build_investment_internal_transfer_binding_index(
        [old, old_duplicate, bank]
    )
    old_key = next(key for key, rows in old_index.items() if rows[0] is old)
    target_key = service.build_investment_internal_transfer_binding_key(bank)
    current = deposit(40, "oct.csv", "b" * 64, "Current reviewed transfer")
    source_key = service.build_investment_internal_transfer_binding_key(current)
    store = tmp_path / "investment.json"
    store.write_text(
        json.dumps(
            {
                "transactions": [current, bank],
                "manual_internal_transfer_bindings": {old_key: target_key},
            }
        )
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", store)
    monkeypatch.setattr(
        runtime, "INVESTMENT_TRANSACTIONS_CACHE_PATH", tmp_path / "cache.json"
    )
    app = create_app()
    client = app.test_client()
    token = "b" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = token
    result = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": target_key},
        headers={
            "Origin": "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            "X-CSRF-Token": token,
        },
    )
    assert result.status_code == 200
    saved = load_investment_store_payload(store)
    assert saved["manual_internal_transfer_bindings"].get(source_key) == target_key
