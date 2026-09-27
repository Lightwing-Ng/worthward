"""HSBC-scoped current cash boundary regression tests.

Code version: v0.1.0
- Added: Mixed-payload scope and finite-only cash boundary regressions.
"""

from copy import deepcopy

import pytest

from app.services.investment.importing.brokers.hsbc.cash_boundary import (
    _synchronize_hsbc_authoritative_current_cash_boundary,
)


def _current_cash_payload(*, broker: str = "multiple") -> dict:
    payload = {
        "broker": broker,
        "account": "multiple" if broker == "multiple" else "test-account",
        "summary": {
            "cash_snapshot_status": "stale",
            "cash_snapshot_authoritative": False,
            "cash_ledger_balance": "777.00",
            "cash_ledger_balance_as_of": "2026-09-25",
            "cash_ledger_balance_source": "aggregate_ledger",
            "ending_cash_base_currency": "777.00",
            "ending_cash_base_currency_as_of": "2026-09-25",
            "ending_cash_by_currency": {"USD": "777.00", "CNH": "10.00"},
        },
        "broker_summaries": {
            "hsbc": {
                "broker": "hsbc",
                "account": "test-account",
                "cash_ledger_balance": "50.00",
                "cash_ledger_balance_as_of": "2026-09-24",
                "cash_ledger_balance_source": "hsbc_usd_savings_ledger_balance",
                "hsbc_ending_cash_components": {
                    "USD:SAVINGS": "50.00",
                    "HKD:SAVINGS": "5.00",
                },
                "hsbc_cash_component_post_dates": {
                    "USD:SAVINGS": "2026-09-24",
                    "HKD:SAVINGS": "2026-09-23",
                },
            },
        },
        "transactions": [],
    }
    if broker == "hsbc":
        hsbc = payload["broker_summaries"]["hsbc"]
        for field in ("hsbc_ending_cash_components", "hsbc_cash_component_post_dates"):
            payload["summary"][field] = deepcopy(hsbc[field])
    return payload


@pytest.mark.parametrize("broker", ["multiple", "ibkr"])
def test_hsbc_cash_sync_keeps_mixed_portfolio_fields_scoped(broker: str) -> None:
    payload = _current_cash_payload(broker=broker)
    original_summary = deepcopy(payload["summary"])

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    for key, value in original_summary.items():
        assert payload["summary"][key] == value
    hsbc = payload["broker_summaries"]["hsbc"]
    assert hsbc["cash_snapshot_status"] == "current"
    assert hsbc["cash_snapshot_authoritative"] is True
    assert hsbc["ending_cash_by_currency"] == {"USD": "50.00", "HKD": "5.00"}
    assert payload["summary"]["hsbc_ending_cash_components"] == {
        "USD:SAVINGS": "50.00",
        "HKD:SAVINGS": "5.00",
    }


def test_hsbc_cash_sync_does_not_replace_scoped_component_with_portfolio_cash() -> None:
    payload = _current_cash_payload()
    hsbc = payload["broker_summaries"]["hsbc"]
    del hsbc["cash_ledger_balance"]
    del hsbc["cash_ledger_balance_as_of"]
    hsbc["hsbc_snapshot"] = {"cash_latest_post_date": "2026-09-24"}

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert hsbc["cash_ledger_balance"] == "50.00"
    assert hsbc["cash_ledger_balance_as_of"] == "2026-09-24"
    assert hsbc["hsbc_ending_cash_components"]["USD:SAVINGS"] == "50.00"
    assert payload["summary"]["cash_ledger_balance"] == "777.00"


def test_hsbc_cash_sync_keeps_multiple_accounts_out_of_top_level_snapshot() -> None:
    payload = _current_cash_payload(broker="hsbc")
    payload["account"] = "multiple"

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["summary"]["cash_snapshot_status"] == "stale"
    assert payload["summary"]["cash_snapshot_authoritative"] is False
    assert payload["summary"]["cash_ledger_balance"] == "777.00"


def test_hsbc_cash_sync_preserves_a_numeric_zero_scoped_balance() -> None:
    payload = _current_cash_payload(broker="hsbc")
    payload["broker_summaries"]["hsbc"]["cash_ledger_balance"] = 0

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["broker_summaries"]["hsbc"]["cash_ledger_balance"] == "0"
    assert payload["summary"]["cash_ledger_balance"] == "0"


def test_hsbc_cash_sync_preserves_single_account_top_level_behavior() -> None:
    payload = _current_cash_payload(broker="hsbc")

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["summary"]["cash_snapshot_status"] == "current"
    assert payload["summary"]["cash_snapshot_authoritative"] is True
    assert payload["summary"]["cash_ledger_balance"] == "50.00"
    assert payload["ending_cash"] == "50.00"
    assert payload["ending_cash_by_currency"] == {"USD": "50.00", "HKD": "5.00"}


def test_hsbc_component_date_alone_does_not_override_a_live_snapshot() -> None:
    payload = _current_cash_payload(broker="hsbc")
    payload["ending_cash"] = "900.00"
    payload["summary"] = {"ending_cash_raw": "900.00"}
    hsbc = payload["broker_summaries"]["hsbc"]
    for key in ("cash_ledger_balance", "cash_ledger_balance_as_of"):
        del hsbc[key]
    before = deepcopy(payload)

    assert not _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload == before


def test_hsbc_cash_sync_creates_broker_scope_for_legacy_prefixed_cash() -> None:
    payload = _current_cash_payload()
    hsbc = payload["broker_summaries"].pop("hsbc")
    payload["summary"]["hsbc_snapshot"] = {
        "cash_latest_post_date": "2026-09-24",
    }
    payload["summary"]["hsbc_ending_cash_components"] = hsbc[
        "hsbc_ending_cash_components"
    ]
    payload["summary"]["hsbc_cash_component_post_dates"] = hsbc[
        "hsbc_cash_component_post_dates"
    ]

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["broker_summaries"]["hsbc"]["cash_ledger_balance"] == "50.00"
    assert payload["summary"]["cash_ledger_balance"] == "777.00"


@pytest.mark.parametrize("source", ["declared", "posting", "owner_balance"])
def test_hsbc_cash_sync_rejects_malformed_grouping_before_inference(
    source: str,
) -> None:
    payload = _current_cash_payload()
    hsbc = payload["broker_summaries"]["hsbc"]
    hsbc.pop("cash_ledger_balance")
    hsbc["hsbc_ending_cash_components"] = {}
    if source == "declared":
        hsbc["ending_cash_base_currency_status"] = (
            "authoritative_current_cash_boundary"
        )
        hsbc["ending_cash_base_currency"] = "1,2,3"
    else:
        source_fields = {"cash_settlement_date": "2026-09-24"}
        if source == "posting":
            source_fields["cash_settlement_postings"] = [
                {
                    "date": "2026-09-24",
                    "currency": "USD",
                    "ledger_sequence": 1,
                    "row_number": 1,
                    "balance_after_raw": "1,2,3",
                }
            ]
        else:
            source_fields["cash_settlement_balance_after_raw"] = "1,2,3"
        payload["transactions"] = [
            {
                "broker": "hsbc",
                "account": "test-account",
                "currency": "USD",
                "date": "2026-09-23",
                "source": source_fields,
            }
        ]
    before = deepcopy(payload)

    assert not _synchronize_hsbc_authoritative_current_cash_boundary(payload)
    assert payload == before


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "-Infinity", "1,2,3"])
def test_hsbc_cash_sync_rejects_invalid_current_money_without_mutation(
    amount: str,
) -> None:
    payload = _current_cash_payload(broker="hsbc")
    payload["summary"] = {}
    hsbc = payload["broker_summaries"]["hsbc"]
    hsbc["cash_ledger_balance"] = amount
    hsbc["hsbc_ending_cash_components"] = {}
    before = deepcopy(payload)

    assert not _synchronize_hsbc_authoritative_current_cash_boundary(payload)
    assert payload == before


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "-Infinity", "1,2,3"])
def test_hsbc_cash_sync_ignores_invalid_available_cash(amount: str) -> None:
    payload = _current_cash_payload(broker="hsbc")
    payload["broker_summaries"]["hsbc"]["hsbc_bank_available_cash"] = amount

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["broker_summaries"]["hsbc"]["hsbc_bank_available_cash"] == "50.00"


def test_hsbc_cash_sync_ignores_nonfinite_other_currency_components() -> None:
    payload = _current_cash_payload()
    components = payload["broker_summaries"]["hsbc"]["hsbc_ending_cash_components"]
    components["HKD:SAVINGS"] = "NaN"
    payload["summary"]["hsbc_ending_cash_components"] = deepcopy(components)

    assert _synchronize_hsbc_authoritative_current_cash_boundary(payload)

    assert payload["broker_summaries"]["hsbc"]["ending_cash_by_currency"] == {
        "USD": "50.00",
    }
