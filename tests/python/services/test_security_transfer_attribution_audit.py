"""Keep transfer attestations durable and source evidence exclusive.

Code version: v1.0.0
"""

from __future__ import annotations

from copy import deepcopy

import pytest

from app.services.investment_import import (
    build_investment_internal_transfer_binding_index,
    build_investment_internal_transfer_binding_key,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    refresh_investment_security_transfer_reconciliation,
    validate_investment_security_transfer_attribution,
)


def _records():
    def record(kind, broker, row, quantity):
        return {
            "date": "2026-08-01" if kind == "buy" else "2026-09-01",
            "type": kind,
            "broker": broker,
            "account": "U***00001" if broker == "ibkr" else "Individual ...001",
            "ticker": "QQQI",
            "currency": "USD",
            "quantity_raw": quantity,
            "quantity_abs": quantity,
            "price_raw": "20" if kind == "buy" else None,
            "net_amount_raw": "-4000" if kind == "buy" else "0",
            "gross_amount_raw": "-4000" if kind == "buy" else "0",
            "description": f"QQQI {kind} {row}",
            "source": {"file_kind": "test_import", "row_number": row},
        }

    return [
        record("buy", "ibkr", 1, "200"),
        record("transfer_in", "schwab", 2, "100"),
        record("transfer_in", "schwab", 3, "100"),
        record("transfer_out", "ibkr", 4, "100"),
    ]


def _keys(records):
    index = build_investment_internal_transfer_binding_index(records)
    return {
        id(record): key
        for key, matches in index.items()
        for record in matches
        if len(matches) == 1
    }


def _attribution():
    return {
        "source_broker": "ibkr",
        "source_account": "U***00001",
        "attested_at": "2026-09-02 10:00:00",
    }


def test_second_attribution_cannot_reuse_an_imported_source_leg():
    records = _records()
    keys = _keys(records)
    first_key, second_key = keys[id(records[1])], keys[id(records[2])]
    assert (
        validate_investment_security_transfer_attribution(
            records, first_key, "ibkr", "U***00001"
        )
        is records[1]
    )
    assert (
        validate_investment_security_transfer_attribution(
            records,
            first_key,
            "ibkr",
            "U***00001",
            existing_attributions={first_key: _attribution()},
        )
        is records[1]
    )
    with pytest.raises(ValueError, match="already|another|reserved"):
        validate_investment_security_transfer_attribution(
            records,
            second_key,
            "ibkr",
            "U***00001",
            existing_attributions={first_key: _attribution()},
        )


@pytest.mark.parametrize("reverse", [False, True])
def test_persisted_competing_attributions_never_become_double_evidence(reverse):
    records = _records()
    keys = _keys(records)
    receipts = [records[1], records[2]]
    if reverse:
        receipts.reverse()
    payload = {
        "transactions": records,
        "summary": {},
        "manual_security_transfer_attributions": {
            keys[id(row)]: _attribution() for row in receipts
        },
    }
    refresh_investment_security_transfer_reconciliation(payload)
    result = payload["summary"]["security_transfer_reconciliation"]
    assert result["attribution_evidence_match_count"] == 0
    assert result["aggregate_holdings_available"] is False
    assert result["unreconciled_inbound_count"] == 2
    assert len(payload["manual_security_transfer_attributions"]) == 2


def test_manual_binding_reserves_source_against_another_attribution():
    records = _records()
    keys = _keys(records)
    bindings = {keys[id(records[3])]: keys[id(records[1])]}
    second_key = keys[id(records[2])]
    with pytest.raises(ValueError, match="already|another|reserved"):
        validate_investment_security_transfer_attribution(
            records,
            second_key,
            "ibkr",
            "U***00001",
            manual_bindings=bindings,
        )
    payload = {
        "transactions": records,
        "summary": {},
        "manual_internal_transfer_bindings": bindings,
        "manual_security_transfer_attributions": {second_key: _attribution()},
    }
    refresh_investment_security_transfer_reconciliation(payload)
    result = payload["summary"]["security_transfer_reconciliation"]
    assert result["manual_match_count"] == 1
    assert result["attribution_evidence_match_count"] == 0
    assert result["aggregate_overlay"]["active_receipt_keys"] == []
    assert result["aggregate_holdings_available"] is False


def test_ambiguous_receipt_preserves_inactive_attestation_until_cleared():
    buy, first, second, _out = _records()
    key = build_investment_internal_transfer_binding_key(first)
    payload = normalize_investment_payload_tickers(
        {
            "broker": "multiple",
            "account": "multiple",
            "transactions": [buy, first],
            "manual_security_transfer_attributions": {key: _attribution()},
        }
    )
    original = deepcopy(payload["manual_security_transfer_attributions"][key])
    merged = merge_investment_payloads(
        payload,
        {
            "broker": "schwab",
            "account": "Individual ...001",
            "summary": {},
            "transactions": [first, second],
        },
    )
    retained = merged["manual_security_transfer_attributions"][key]
    assert all(retained[field] == value for field, value in original.items())
    assert retained["status"] == "receipt_identity_ambiguous"
    reconciliation = merged["summary"]["security_transfer_reconciliation"]
    assert reconciliation["aggregate_holdings_available"] is False
    assert reconciliation["aggregate_overlay"]["active_receipt_keys"] == []
    assert reconciliation["aggregate_overlay"]["invalid_receipt_keys"] == [key]
    assert any(
        item["receipt_key"] == key and item["status"] == "receipt_identity_ambiguous"
        for item in reconciliation["aggregate_overlay"]["attribution_statuses"]
    )
    resolved = deepcopy(merged)
    resolved["transactions"] = [buy, first]
    refresh_investment_security_transfer_reconciliation(resolved)
    assert "status" not in resolved["manual_security_transfer_attributions"][key]
    assert resolved["summary"]["security_transfer_reconciliation"]["aggregate_overlay"][
        "active_receipt_keys"
    ] == [key]
    merged["manual_security_transfer_attributions"].pop(key)
    refresh_investment_security_transfer_reconciliation(merged)
    assert merged["manual_security_transfer_attributions"] == {}


def test_missing_receipt_attestation_survives_normalization_without_an_overlay():
    buy, first, _second, _out = _records()
    key = build_investment_internal_transfer_binding_key(first)
    payload = {
        "transactions": [buy],
        "summary": {},
        "manual_security_transfer_attributions": {key: _attribution()},
    }
    refresh_investment_security_transfer_reconciliation(payload)
    assert (
        payload["manual_security_transfer_attributions"][key]["status"]
        == "receipt_identity_unresolved"
    )
    assert (
        payload["summary"]["security_transfer_reconciliation"][
            "aggregate_holdings_available"
        ]
        is False
    )


def test_distinct_source_legs_can_supersede_distinct_attributions():
    records = _records()
    records[2].update(quantity_raw="50", quantity_abs="50")
    other_out = deepcopy(records[3])
    other_out.update(quantity_raw="50", quantity_abs="50")
    other_out["source"]["row_number"] = 5
    records.append(other_out)
    keys = _keys(records)
    payload = {
        "transactions": records,
        "summary": {},
        "manual_security_transfer_attributions": {
            keys[id(records[1])]: _attribution(),
            keys[id(records[2])]: _attribution(),
        },
    }
    refresh_investment_security_transfer_reconciliation(payload)
    result = payload["summary"]["security_transfer_reconciliation"]
    assert result["attribution_evidence_match_count"] == 2
    assert result["aggregate_holdings_available"] is True
