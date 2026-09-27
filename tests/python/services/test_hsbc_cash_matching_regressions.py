"""HSBC pasted settlement atomicity and fee-policy regressions.

Code version: v0.1.0
- Added: Cash matching and provenance fixtures stay isolated from production stores.
"""

from copy import deepcopy
from decimal import Decimal

import pytest

from app.services.investment.importing.brokers.hsbc import cash


def make_order(amount: str = "200000.00") -> dict:
    return {
        "broker": "hsbc",
        "account": "ACCOUNT-A",
        "currency": "USD",
        "date": "2026-09-20",
        "type": "sell",
        "quantity_abs": "100",
        "price_raw": str(Decimal(amount) / 100),
        "gross_amount_raw": amount,
        "net_amount_raw": amount,
        "commission_raw": "0",
        "source": {"order_id": "S-100001"},
    }


def make_cash(amount: str, sequence: int, balance: str = "300000.00") -> dict:
    return {
        "broker": "hsbc",
        "account": "ACCOUNT-A",
        "currency": "USD",
        "date": "2026-09-21",
        "type": "withdrawal" if amount.startswith("-") else "deposit",
        "description": "REF S100001001 SEC",
        "net_amount_raw": amount,
        "source": {
            "file_kind": "hsbc_usd_account_text",
            "account_number": "ACCOUNT-A",
            "account_type": "USD Savings",
            "row_number": sequence,
            "ledger_sequence": sequence,
            "balance_after_raw": balance,
            "source_sequence_sha256": "a" * 64,
            "reference_id": "REF S100001001 SEC",
        },
    }


@pytest.mark.parametrize("fees", [["-5.56"], [], ["-3.00", "-2.56"]])
def test_f2_paste_matches_zero_one_or_split_sell_fees(fees: list[str]) -> None:
    order = make_order()
    rows = [make_cash("200000.00", 44)]
    rows.extend(make_cash(amount, 45 + index) for index, amount in enumerate(fees))
    cash._match_hsbc_orders_to_cash_settlements([order], rows, [])
    postings = order["source"].get("cash_settlement_postings", [])
    assert len(postings) == 1 + len(fees)
    assert Decimal(order["commission_raw"]) == sum(map(Decimal, fees), Decimal(0))
    assert all(row.get("exclude_from_holdings_replay") is True for row in rows)


def test_f2_provenance_repair_accepts_large_identity_matched_fee() -> None:
    principal = make_cash("200000.00", 44)
    fee = make_cash("-5.56", 45, "299994.44")
    principal_posting = cash._build_hsbc_cash_settlement_posting(principal, role="principal")
    fee_posting = cash._build_hsbc_cash_settlement_posting(fee, role="fee")
    for field in ("account_number", "account_type", "source_sequence_sha256"):
        fee_posting.pop(field)
    order = make_order()
    order["source"].update({
        "cash_settlement_date": "2026-09-21",
        "cash_settlement_amount_raw": "200000.00",
        "cash_flow_fee_row_numbers": [45],
        "cash_settlement_postings": [principal_posting, fee_posting],
    })
    assert cash._repair_hsbc_pasted_cash_settlement_posting_provenance([order], [fee]) == 1
    assert order["source"]["cash_settlement_postings"][1]["account_number"] == "ACCOUNT-A"


@pytest.mark.parametrize("bad_field,bad_value", [
    ("source_file_sha256", "b" * 64),
    ("ledger_sequence_order", "chronological"),
])
def test_f4_invalid_posting_does_not_mutate_order_or_hide_cash(bad_field, bad_value) -> None:
    order = make_order("1000.00")
    rows = [make_cash("1000.00", 44), make_cash("-0.03", 45, "299999.97")]
    rows[1]["source"][bad_field] = bad_value
    original_order, original_rows = deepcopy(order), deepcopy(rows)
    cash._match_hsbc_orders_to_cash_settlements([order], rows, [])
    assert order == original_order
    assert rows == original_rows


def test_f4_paste_principal_difference_retains_documented_warning_policy() -> None:
    order = make_order("999.00")
    warnings = []
    rows = [make_cash("1000.00", 44), make_cash("-0.03", 45, "299999.97")]
    cash._match_hsbc_orders_to_cash_settlements([order], rows, warnings)
    assert order["net_amount_raw"] == "1000.00"
    assert len(warnings) == 1
    assert order["source"]["cash_settlement_balance_after_raw"] == "299999.97"


@pytest.mark.parametrize("invalid_field,invalid_value", [
    ("balance_after_raw", ""),
    ("ledger_sequence", 44),
])
def test_f2_invalid_same_domain_fee_cannot_be_treated_as_absent(invalid_field, invalid_value) -> None:
    order = make_order("1000.00")
    rows = [make_cash("1000.00", 44), make_cash("-0.03", 45)]
    rows[1]["source"][invalid_field] = invalid_value
    original_order, original_rows = deepcopy(order), deepcopy(rows)
    cash._match_hsbc_orders_to_cash_settlements([order], rows, [])
    assert order == original_order
    assert rows == original_rows


@pytest.mark.parametrize("fees", [["-11.00"], ["-6.00", "-6.00"]])
def test_f2_proportional_bound_rejects_individual_and_aggregate_anomalies(fees) -> None:
    order = make_order("1000.00")
    rows = [make_cash("1000.00", 44)]
    rows.extend(make_cash(amount, 45 + index) for index, amount in enumerate(fees))
    before = deepcopy(order), deepcopy(rows)
    cash._match_hsbc_orders_to_cash_settlements([order], rows, [])
    assert (order, rows) == before


@pytest.mark.parametrize("bad_amount", ["NaN", "Infinity", "1,2,3"])
def test_f7_malformed_money_does_not_hide_trade_settlement_rows(bad_amount: str) -> None:
    rows = [make_cash(bad_amount, 44), make_cash("-123", 45, "0")]
    for row in rows:
        row["description"] = "HK123456A"
    original = deepcopy(rows)
    cash._mark_hsbc_trade_settlement_history_hidden(rows)
    assert rows == original
