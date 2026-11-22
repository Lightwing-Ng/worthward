"""Verify that paired HSBC cash postings do not count as new funding.

Code version: v1.0.0
"""

from copy import deepcopy

import pytest

from app.services.investment.importing.bindings import (
    build_investment_internal_transfer_binding_key,
)
from app.services.investment.importing.brokers.hsbc.preview import (
    build_hsbc_paste_preview,
)
from app.services.investment.importing.brokers.hsbc.reconciliation import (
    build_investment_payload_from_hsbc_pasted_text,
)
from app.services.investment.importing.merge.operations import merge_investment_payloads


def _cash_page(
    currency: str, *, received: str, sent: str, balance: str, **options: str
) -> str:
    account = options.get("account", "999-001234-999")
    day = options.get("day", "15 Aug 2026")
    reference = options.get("reference", "NB0000000042")
    return f"""{currency} Savings
Account number:
{account}
Ledger balance: {balance} {currency}
Available balance: {balance} {currency}
Post date Description Amount in Amount out Balance Additional options
{day}
NET- {reference}
{received}
{sent}
{balance}
Download
"""


@pytest.fixture(autouse=True)
def _configure_hsbc_test_account(monkeypatch):
    monkeypatch.setattr(
        "app.services.investment.importing.brokers.hsbc.core.HSBC_EXPECTED_ACCOUNT_NUMBER",
        "999-001234-999",
    )


def _capture(cash_text: str) -> dict:
    return build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="",
        order_status_text="",
        cash_account_text=cash_text,
    )


def test_hsbc_net_cash_paste_pairs_existing_counterleg_and_reimport_is_idempotent():
    usd = _capture(_cash_page("USD", received="125.00", sent="0.00", balance="225.00"))
    cnh = _capture(_cash_page("CNH", received="0.00", sent="850.00", balance="150.00"))
    before = merge_investment_payloads({}, deepcopy(usd))
    assert before["transactions"][0]["type"] == "deposit"

    after = merge_investment_payloads(deepcopy(before), deepcopy(cnh))
    legs = {row["currency"]: row for row in after["transactions"]}
    assert len(after["transactions"]) == 2
    assert set(legs) == {"USD", "CNH"}
    assert {row["type"] for row in legs.values()} == {"forex_trade_component"}
    assert legs["USD"]["source"]["forex_pair_component"] == "acquired"
    assert legs["CNH"]["source"]["forex_pair_component"] == "sold"
    assert legs["USD"]["source"]["forex_pair_reference_id"] == "NB0000000042"
    assert legs["CNH"]["source"]["forex_pair_reference_id"] == "NB0000000042"
    assert legs["USD"]["net_amount_raw"] == "125.00"
    assert legs["CNH"]["net_amount_raw"] == "-850.00"
    assert after["broker_summaries"]["hsbc"]["ending_cash_by_currency"] == {
        "USD": "225.00",
        "CNH": "150.00",
    }
    preview = build_hsbc_paste_preview(before, after, cnh)
    assert {(row["currency"], row["change"]) for row in preview["transactions"]} == {
        ("USD", "updated"),
        ("CNH", "added"),
    }

    repeated = merge_investment_payloads(deepcopy(after), deepcopy(usd))
    assert len(repeated["transactions"]) == 2
    assert {row["type"] for row in repeated["transactions"]} == {
        "forex_trade_component"
    }
    assert build_hsbc_paste_preview(after, repeated, usd)["transactions"] == []


def test_hsbc_net_cash_pair_on_first_import():
    usd = _cash_page("USD", received="125.00", sent="0.00", balance="225.00")
    cnh = _cash_page("CNH", received="0.00", sent="850.00", balance="150.00")
    merged = merge_investment_payloads({}, _capture(usd + "\n" + cnh))

    assert len(merged["transactions"]) == 2
    assert {row["type"] for row in merged["transactions"]} == {"forex_trade_component"}


@pytest.mark.parametrize(
    "options", [{"day": "14 Aug 2026"}, {"reference": "NB0000000043"}]
)
def test_hsbc_net_cash_different_date_or_reference_stays_unpaired(options):
    usd = _capture(_cash_page("USD", received="125.00", sent="0.00", balance="225.00"))
    cnh = _capture(
        _cash_page("CNH", received="0.00", sent="850.00", balance="150.00", **options)
    )
    merged = merge_investment_payloads(usd, cnh)

    assert {row["type"] for row in merged["transactions"]} == {"deposit", "withdrawal"}


def test_hsbc_net_cash_ambiguity_does_not_keep_a_derived_fx_pair():
    usd = _capture(_cash_page("USD", received="125.00", sent="0.00", balance="225.00"))
    cnh = _capture(_cash_page("CNH", received="0.00", sent="850.00", balance="150.00"))
    hkd = _capture(_cash_page("HKD", received="0.00", sent="980.00", balance="500.00"))
    paired = merge_investment_payloads(usd, cnh)
    merged = merge_investment_payloads(paired, hkd)

    assert len(merged["transactions"]) == 3
    assert {row["type"] for row in merged["transactions"]} == {"deposit", "withdrawal"}
    assert all(
        "forex_pair_reference_id" not in row["source"] for row in merged["transactions"]
    )


def test_hsbc_net_cash_pair_respects_manual_transfer_bindings():
    usd = _capture(_cash_page("USD", received="125.00", sent="0.00", balance="225.00"))
    cnh = _capture(_cash_page("CNH", received="0.00", sent="850.00", balance="150.00"))
    withdrawal = {
        "broker": "ibkr",
        "account": "U00002",
        "date": "2026-08-15",
        "type": "withdrawal",
        "currency": "USD",
        "net_amount_raw": "-125.00",
    }
    source_key = build_investment_internal_transfer_binding_key(withdrawal)
    target_key = build_investment_internal_transfer_binding_key(usd["transactions"][0])
    before = {
        **usd,
        "broker": "multiple",
        "account": "multiple",
        "transactions": [withdrawal, *usd["transactions"]],
        "manual_internal_transfer_bindings": {source_key: target_key},
    }
    merged = merge_investment_payloads(before, cnh)

    assert {row["type"] for row in merged["transactions"]} == {"deposit", "withdrawal"}
    assert merged["manual_internal_transfer_bindings"] == {source_key: target_key}
