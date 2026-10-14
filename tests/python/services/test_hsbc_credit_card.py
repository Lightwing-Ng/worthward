"""HSBC credit-card parser evidence and direction boundaries. Code version: v0.1.0."""

from collections import Counter
from decimal import Decimal
import hashlib
import json

import pytest

from app.services.hsbc_credit_card import parse_hsbc_credit_card_text
from tests.factories.hsbc_credit_card import hsbc_credit_card_text


def _row(description="APPLEPAY SAMPLE SHOP HK", amount="42.50 HKD", *, pending=False):
    return (
        "12 Oct 2026\nSAMPLE CARDHOLDER\nCard ending in 1111\n"
        f"{description}\n{amount}" + ("\nPending" if pending else "")
    )


def test_browser_copy_classifies_every_row_and_preserves_source_evidence():
    text = hsbc_credit_card_text()
    result = parse_hsbc_credit_card_text(text)
    assert result["schema_version"] == 1
    assert result["account_id"] == hashlib.sha256(b"4111111111111111").hexdigest()
    assert result["account_last4"] == "1111"
    assert result["account_name"] == "HSBC Red Credit Card"
    assert result["source"] == {
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "text": text,
    }
    assert result["snapshot"] == {
        "account_balance": "4850.50",
        "current_amount_due": "0.00",
        "minimum_payment": "0.00",
        "payment_due_date": "2026-11-06",
        "rewardcash_balance": "0.00",
    }
    rows = result["transactions"]
    assert len(rows) == 11
    assert Counter((row["kind"], row["status"]) for row in rows) == {
        ("repayment", "posted"): 6,
        ("purchase", "posted"): 2,
        ("purchase", "pending"): 1,
        ("rewardcash", "posted"): 2,
    }
    assert rows[1]["amount"] == "2450.00"
    assert rows[1]["liability_delta"] is None
    assert sum(
        Decimal(row["liability_delta"]) for row in rows if row["status"] == "posted"
    ) == Decimal("4218.50") - Decimal("4730.00") - Decimal("40.00")
    for row in rows:
        assert row["direction_source"] == "description"
        if row["status"] == "posted":
            assert (Decimal(row["liability_delta"]) > 0) == (row["kind"] == "purchase")
    safe = {key: value for key, value in result.items() if key != "source"}
    assert "SAMPLE CARDHOLDER" not in json.dumps(safe)
    assert "4111-1111" not in json.dumps(safe)


def test_duplicate_account_rendering_and_whitespace_do_not_change_identity():
    text = hsbc_credit_card_text()
    single = text.replace(
        "4111-1111-1111-11114111-1111-1111-1111", "4111 1111 1111 1111"
    )
    assert (
        parse_hsbc_credit_card_text(text)["account_id"]
        == parse_hsbc_credit_card_text(single)["account_id"]
    )


def test_pending_to_posted_preserves_same_day_transaction_identity():
    pending = parse_hsbc_credit_card_text(
        hsbc_credit_card_text(transactions=_row(pending=True))
    )
    posted = parse_hsbc_credit_card_text(hsbc_credit_card_text(transactions=_row()))
    assert pending["transactions"][0]["id"] == posted["transactions"][0]["id"]
    assert posted["transactions"][0]["liability_delta"] == "42.50"
    assert pending["transactions"][0]["liability_delta"] is None


def test_same_amount_identical_rows_retain_multiplicity():
    result = parse_hsbc_credit_card_text(
        hsbc_credit_card_text(transactions="\n".join([_row(), _row()]))
    )
    assert [row["occurrence"] for row in result["transactions"]] == [1, 2]
    assert len({row["id"] for row in result["transactions"]}) == 2


def test_matching_pending_and_posted_rows_in_one_capture_are_ambiguous():
    text = hsbc_credit_card_text(transactions=_row(pending=True) + "\n" + _row())
    with pytest.raises(ValueError, match="ambiguous matching pending and posted"):
        parse_hsbc_credit_card_text(text)


def test_distinct_accounts_with_same_last_four_never_share_identity():
    first = parse_hsbc_credit_card_text(hsbc_credit_card_text())
    second = parse_hsbc_credit_card_text(
        hsbc_credit_card_text(account_number="5222-2222-2222-1111")
    )
    assert first["account_last4"] == second["account_last4"]
    assert first["account_id"] != second["account_id"]
    assert {row["id"] for row in first["transactions"]}.isdisjoint(
        row["id"] for row in second["transactions"]
    )


@pytest.mark.parametrize(
    ("description", "column", "kind"),
    [
        ("APPLEPAY SAMPLE SHOP HK", "out", "purchase"),
        ("PAYMENT - THANK YOU", "in", "repayment"),
        ("PAY w/RC SAMPLE SHOP HK", "in", "rewardcash"),
    ],
)
def test_explicit_amount_columns_are_retained_and_checked(description, column, kind):
    row = parse_hsbc_credit_card_text(
        hsbc_credit_card_text(
            transactions=_row(description, f"Amount {column}: 42.50 HKD")
        )
    )["transactions"][0]
    assert row["kind"] == kind
    assert row["amount_direction"] == column
    assert row["direction_source"] == "amount_column"


@pytest.mark.parametrize(
    "transactions",
    [
        _row("UNKNOWN TRANSFER"),
        _row("APPLEPAY REFUND SAMPLE HK"),
        _row("PAY w/RC REVERSED SAMPLE HK"),
        _row(amount="42.50 USD"),
        _row(amount="-42.50 HKD"),
        _row(amount="0.00 HKD"),
        _row(amount="4,2.50 HKD"),
        _row(amount="42.500 HKD"),
        _row(amount="99999999999999999999999999999999999999.00 HKD"),
        _row(amount="Amount in: 42.50 HKD"),
        _row().replace("Card ending in 1111", "Card ending in 2222"),
        _row() + "\n12 Oct 2026",
        _row() + "\n42.50 HKD",
        _row() + "\nPending\nPending",
        _row() + "\nUNRECOGNIZED TRANSACTION ROW",
        _row().replace("12 Oct", "32 Oct"),
        _row().replace("42.50 HKD", ""),
        _row().replace("42.50 HKD", "") + "\n" + _row().replace("12 Oct 2026\n", ""),
        "",
    ],
)
def test_unknown_incomplete_or_ambiguous_rows_fail_closed(transactions):
    with pytest.raises(ValueError):
        parse_hsbc_credit_card_text(hsbc_credit_card_text(transactions=transactions))


@pytest.mark.parametrize(
    ("old", "new"),
    [
        (
            "4111-1111-1111-11114111-1111-1111-1111",
            "4111-1111-1111-11115222-2222-2222-1111",
        ),
        ("Account number:", "Account identifier:"),
        ("Account balance:", "Available balance:"),
        ("0.00 HKD", "0.00 USD"),
        ("06 Nov 2026", "31 Nov 2026"),
        ("HSBC Red Credit Card", "HSBC HKD Savings"),
        ("Amount in Amount out", "Amount"),
    ],
)
def test_unsupported_or_ambiguous_snapshot_fails_closed(old, new):
    with pytest.raises(ValueError):
        parse_hsbc_credit_card_text(hsbc_credit_card_text().replace(old, new))


def test_amount_currency_and_table_headers_can_be_wrapped():
    text = hsbc_credit_card_text(transactions=_row(amount="42.50\nHKD"))
    text = text.replace(
        "Transaction date  Card  Description Amount in Amount out  Additional options",
        "Transaction date\nCard\nDescription\nAmount in\nAmount out\nAdditional options",
    )
    assert parse_hsbc_credit_card_text(text)["transactions"][0]["amount"] == "42.50"


def test_description_case_and_whitespace_normalize_for_identity():
    first = parse_hsbc_credit_card_text(hsbc_credit_card_text(transactions=_row()))
    second = parse_hsbc_credit_card_text(
        hsbc_credit_card_text(transactions=_row("ApplePay   Sample Shop HK"))
    )
    assert first["transactions"][0]["id"] == second["transactions"][0]["id"]


def test_signed_account_credit_balance_is_preserved():
    text = hsbc_credit_card_text().replace("4,850.50", "-4,850.50")
    assert (
        parse_hsbc_credit_card_text(text)["snapshot"]["account_balance"] == "-4850.50"
    )
