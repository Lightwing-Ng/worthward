"""Isolated regression coverage for manual HSBC dividend identity.

Code version: v1.0.0
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
from pathlib import Path

import pytest

from app import create_app
from app.infrastructure.storage import (
    load_investment_store_payload,
    save_investment_store_payload,
)
from app.services.investment.dividend_attribution import (
    annotate_dividend_attribution_choices,
    dividend_attribution_record_key,
    update_dividend_attribution,
)
from app.services.investment_import import (
    build_investment_payload_from_hsbc_pasted_text,
    merge_investment_payloads,
)
import app.web.runtime as runtime


def _cash_record():
    return {
        "broker": "hsbc", "account": "000-111111-111", "currency": "USD",
        "date": "2026-07-10", "datetime": "2026-07-10 12:00:00",
        "type": "dividend", "ticker": "", "description": "CORP EVT PAYMENT SEC",
        "quantity_raw": "0", "quantity_abs": "0", "price_raw": "0",
        "gross_amount_raw": "9", "commission_raw": "0", "net_amount_raw": "9",
        "source": {
            "broker": "hsbc", "account": "000-111111-111",
            "account_type": "SAVINGS", "file_kind": "hsbc_usd_account_text",
            "balance_after_raw": "109", "source_sequence_sha256": "a" * 64,
            "source_sequence_row_number": 1,
            "dividend_attribution_status": "unavailable_from_hsbc_cash_text",
        },
    }


def _payload():
    cash = _cash_record()
    buy = {
        **deepcopy(cash), "date": "2026-07-01", "type": "buy", "ticker": "QQQI",
        "description": "QQQI purchase", "quantity_raw": "10", "quantity_abs": "10",
        "price_raw": "10", "gross_amount_raw": "-100", "net_amount_raw": "-100",
        "source": {
            "file_kind": "hsbc_order_status_text", "broker": "hsbc",
            "account": cash["account"], "order_id": "P-100001",
            "statement_order_id": "P-100001",
        },
    }
    return {
        "schema_version": "3.0.0", "broker": "hsbc", "account": cash["account"],
        "summary": {}, "position_snapshot": {}, "transactions": [buy, cash],
    }


def test_choices_are_scoped_to_account_currency_and_include_disposed_and_snapshot_tickers():
    payload = _payload()
    base = payload["transactions"][0]
    payload["transactions"].extend([
        {**base, "ticker": "FOREIGN", "account": "000-222222-222", "source": {}},
        {**base, "ticker": "OTHERFX", "currency": "HKD"},
        {**base, "ticker": "OTHERBROKER", "broker": "schwab"},
        {**base, "ticker": "OLD", "type": "sell"},
        {**base, "ticker": "USD.HKD", "type": "forex_trade_component"},
        {**base, "ticker": "USD.CNH", "type": "forex_trade"},
        {**base, "ticker": "NOTSECURITY", "type": "deposit"},
    ])
    payload["broker_snapshots"] = {
        "hsbc": {
            "broker": "hsbc", "account": base["account"],
            "position_snapshot": {
                "SGOV": {"currency": "USD", "quantity": "5"},
                "HKSTOCK": {"currency": "HKD", "quantity": "5"},
            },
        },
    }
    annotate_dividend_attribution_choices(payload)
    cash = payload["transactions"][1]
    assert cash["dividend_attribution_candidates"] == ["OLD", "QQQI", "SGOV"]
    assert cash["dividend_attribution_key"] == dividend_attribution_record_key(cash)


def test_edit_preserves_financial_fields_and_supports_correction_and_clear():
    original = _payload()
    original["position_snapshot"] = {"SGOV": {"currency": "USD", "quantity": "1"}}
    original_cash = deepcopy(original["transactions"][1])
    key = dividend_attribution_record_key(original_cash)
    confirmed, result = update_dividend_attribution(original, key, "QQQI")
    assert result == {"record_key": key, "ticker": "QQQI"}
    updated_cash = confirmed["transactions"][1]
    assert dividend_attribution_record_key(updated_cash) == key
    assert {k: v for k, v in updated_cash.items() if k not in {"source", "ticker"}} == {
        k: v for k, v in original_cash.items() if k not in {"source", "ticker"}
    }
    for field, value in original_cash["source"].items():
        if not field.startswith("dividend_attribution_"):
            assert updated_cash["source"][field] == value
    assert original["transactions"][1] == original_cash
    corrected, _ = update_dividend_attribution(confirmed, key, "SGOV")
    cleared, _ = update_dividend_attribution(corrected, key, "")
    final = cleared["transactions"][1]
    assert final["ticker"] == ""
    assert final["source"]["dividend_attribution_status"] == "unavailable_from_hsbc_cash_text"
    assert final["source"]["dividend_attribution_method"] == "user_cleared"
    assert len(final["source"]["dividend_attribution_user_history"]) == 3
    assert dividend_attribution_record_key(final) == key


@pytest.mark.parametrize("ticker", ["FOREIGN", "<script>", None, ["QQQI"]])
def test_invalid_selection_is_rejected_without_mutating_payload(ticker):
    payload = _payload()
    before = deepcopy(payload)
    with pytest.raises(ValueError):
        update_dividend_attribution(payload, dividend_attribution_record_key(payload["transactions"][1]), ticker)
    assert payload == before


def test_ambiguous_changed_and_ineligible_rows_are_not_editable():
    payload = _payload()
    key = dividend_attribution_record_key(payload["transactions"][1])
    payload["transactions"].append(deepcopy(payload["transactions"][1]))
    annotate_dividend_attribution_choices(payload)
    assert all("dividend_attribution_key" not in record for record in payload["transactions"])
    with pytest.raises(ValueError, match="ambiguous"):
        update_dividend_attribution(payload, key, "QQQI")
    changed = _payload()
    changed["transactions"][1]["net_amount_raw"] = "10"
    with pytest.raises(ValueError, match="unavailable"):
        update_dividend_attribution(changed, key, "QQQI")
    for field, value in [("type", "deposit"), ("broker", "schwab"), ("net_amount_raw", "-9")]:
        record = _cash_record()
        record[field] = value
        assert dividend_attribution_record_key(record) == ""
    statement_record = _cash_record()
    statement_record["ticker"] = "QQQI"
    statement_record["source"]["dividend_attribution_status"] = "matched"
    assert dividend_attribution_record_key(statement_record) == ""


@pytest.mark.parametrize("clear", [False, True])
@pytest.mark.parametrize("incoming_ticker", ["", "QQQI", "SGOV"])
def test_user_choice_survives_reimport_without_duplicate_cash(clear, incoming_ticker):
    payload = _payload()
    key = dividend_attribution_record_key(payload["transactions"][1])
    confirmed, _ = update_dividend_attribution(payload, key, "QQQI")
    if clear:
        confirmed, _ = update_dividend_attribution(confirmed, key, "")
    incoming = _payload()
    incoming["transactions"] = [deepcopy(incoming["transactions"][1])]
    incoming_cash = incoming["transactions"][0]
    incoming_cash["ticker"] = incoming_ticker
    incoming_cash["source"]["source_sequence_sha256"] = "b" * 64
    if incoming_ticker:
        incoming_cash["source"]["dividend_attribution_status"] = "matched_local_market_action"
    merged = merge_investment_payloads(confirmed, incoming)
    repeated = merge_investment_payloads(merged, incoming)
    dividends = [record for record in repeated["transactions"] if record["type"] == "dividend"]
    assert len(dividends) == 1
    assert dividends[0]["ticker"] == ("" if clear else "QQQI")
    assert dividends[0]["source"]["dividend_attribution_user_override"] is True
    assert dividends[0]["source"]["dividend_attribution_method"] == ("user_cleared" if clear else "user_selection")
    assert dividends[0]["net_amount_raw"] == "9"


def test_cleared_choice_skips_cash_only_auto_inference_from_real_parser():
    cash_page = "\n".join([
        "USD Savings", "Account number:", "000-111111-111",
        "Ledger balance:", "109.00 USD", "Available balance:", "109.00 USD",
        "Post date Description Amount in Amount out Balance Additional options",
        "10 Jul 2026", "CORP EVT PAYMENT SEC", "9.00", "109.00", "Download",
    ])
    parsed = build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=cash_page,
    )
    cash = next(record for record in parsed["transactions"] if record["type"] == "dividend")
    assert cash["net_amount_raw"] == "9.00"
    assert cash["source"]["balance_after_raw"] == "109.00"
    assert dividend_attribution_record_key(cash)
    existing = merge_investment_payloads(_payload(), parsed)
    existing_cash = next(record for record in existing["transactions"] if record["type"] == "dividend")
    key = dividend_attribution_record_key(existing_cash)
    existing, _ = update_dividend_attribution(existing, key, "QQQI")
    existing, _ = update_dividend_attribution(existing, key, "")
    loader_calls = []

    def dividend_actions(tickers):
        loader_calls.append(tickers)
        return {"QQQI": [{"date": "2026-07-02", "dividend_per_share": "1"}]}

    merged = merge_investment_payloads(
        existing, deepcopy(parsed), hsbc_dividend_action_loader=dividend_actions,
    )
    assert loader_calls == []
    assert merged["summary"]["incremental_import"]["attributed_hsbc_cash_only_dividend_count"] == 0
    dividends = [record for record in merged["transactions"] if record["type"] == "dividend"]
    assert len(dividends) == 1
    assert dividends[0]["ticker"] == ""
    assert dividends[0]["source"]["dividend_attribution_method"] == "user_cleared"


def test_endpoint_is_csrf_protected_and_persists_only_attribution(tmp_path, monkeypatch):
    production_path = Path(__file__).resolve().parents[3] / "settings_store" / "investment.parquet"
    production_digest = hashlib.sha256(production_path.read_bytes()).hexdigest() if production_path.exists() else None
    payload = _payload()
    store = tmp_path / "investment.parquet"
    save_investment_store_payload(payload, store)
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", store)
    cache_path = tmp_path / "cache.json"
    cache_path.write_text("derived cache", encoding="utf-8")
    monkeypatch.setattr(runtime, "INVESTMENT_TRANSACTIONS_CACHE_PATH", cache_path)
    client = create_app().test_client()
    key = dividend_attribution_record_key(payload["transactions"][1])
    rejected = client.post("/api/investment/dividend-attribution", json={"record_key": key, "ticker": "QQQI"})
    assert rejected.status_code == 403
    assert load_investment_store_payload(store)["transactions"][1]["ticker"] == ""
    csrf = "b" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf
    headers = {"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin", "X-CSRF-Token": csrf}
    before = load_investment_store_payload(store)
    accepted = client.post("/api/investment/dividend-attribution", json={"record_key": key, "ticker": "QQQI"}, headers=headers)
    assert accepted.status_code == 200
    accepted_payload = accepted.get_json()
    assert accepted_payload["success"] is True
    assert accepted_payload["ticker"] == "QQQI"
    assert accepted_payload["record_key"] == key
    assert accepted_payload["investment_store_version"] == str(store.stat().st_mtime_ns)
    persisted = load_investment_store_payload(store)
    expected, _ = update_dividend_attribution(before, key, "QQQI")
    assert persisted["transactions"][0] == before["transactions"][0]
    assert persisted["transactions"][1]["description"] == before["transactions"][1]["description"]
    assert persisted["transactions"][1]["source"]["source_sequence_sha256"] == "a" * 64
    assert persisted["transactions"][1]["ticker"] == expected["transactions"][1]["ticker"]
    assert not cache_path.exists()
    unchanged = store.read_bytes()
    invalid = client.post("/api/investment/dividend-attribution", json={"record_key": key, "ticker": "FOREIGN"}, headers=headers)
    assert invalid.status_code == 400
    assert store.read_bytes() == unchanged
    assert (hashlib.sha256(production_path.read_bytes()).hexdigest() if production_path.exists() else None) == production_digest


def test_cached_transaction_response_exposes_fresh_choices_without_store_write(tmp_path, monkeypatch):
    payload = _payload()
    store = tmp_path / "investment.parquet"
    save_investment_store_payload(payload, store)
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", store)
    build_foundation = runtime.build_foundation_context

    def build_with_cached_transactions(context):
        foundation = build_foundation(context)
        foundation["read_investment_transactions_cache"] = lambda fingerprint: deepcopy(payload)
        foundation["load_investment_realtime_quotes"] = lambda tickers: []
        return foundation

    monkeypatch.setattr(runtime, "build_foundation_context", build_with_cached_transactions)
    before = store.read_bytes()
    response = create_app().test_client().get("/api/investment/transactions")
    assert response.status_code == 200
    cash = response.get_json()["transactions"][1]
    assert cash["dividend_attribution_key"] == dividend_attribution_record_key(payload["transactions"][1])
    assert cash["dividend_attribution_candidates"] == ["QQQI"]
    assert store.read_bytes() == before
