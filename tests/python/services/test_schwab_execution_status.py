"""Regression coverage for Schwab CSV execution-status boundaries.

Code version: v0.1.0
"""

from __future__ import annotations

import csv
from io import StringIO

import pytest

from app.services.investment_import import build_investment_payload_from_schwab_csv


def _csv_bytes(rows: list[list[str]]) -> bytes:
    stream = StringIO(newline="")
    csv.writer(stream).writerows(rows)
    return stream.getvalue().encode()


def _paired_payload(
    status: str,
    *,
    action: str = "Buy",
    quantity: str = "5",
    amount: str = "-50.00",
    filled_quantity_header: str = "",
    filled_quantity: str = "",
) -> dict:
    headers = [
        "Date", "Action", "Symbol", "Description", "Quantity", "Price",
        "Fees & Comm", "Amount", "Status",
    ]
    row = [
        "10/13/2026", action, "TEST", "Execution status regression", quantity,
        "$10.00", "", amount, status,
    ]
    if filled_quantity_header:
        headers.append(filled_quantity_header)
        row.append(filled_quantity)
    positions = [
        ["Positions for account Individual ...999 as of 09:00 AM ET, 2026/10/13"],
        [],
        [
            "Symbol", "Description", "Qty (Quantity)", "Price",
            "Mkt Val (Market Value)", "Cost Basis", "Asset Type",
        ],
        ["OTHER", "Existing stock", "1", "10", "$10.00", "$10.00", "Equity"],
        ["Cash & Cash Investments", "--", "--", "--", "$100.00", "--", "Cash and Money Market"],
        ["Positions Total", "", "--", "--", "$110.00", "--", "--"],
    ]
    return build_investment_payload_from_schwab_csv(
        _csv_bytes([headers, row]),
        _csv_bytes(positions),
        transaction_filename="Individual_XXX999_Transactions_20261013.csv",
        positions_filename="Individual-Positions-2026-10-13.csv",
    )


@pytest.mark.parametrize("status", [
    "Canceled", "Cancelled", "Working", "Unfilled", "Open", "Rejected",
    "Expired", "Pending", "Not Filled", "Unknown State",
])
@pytest.mark.parametrize(("action", "amount"), [("Buy", "-50.00"), ("Sell", "50.00")])
def test_nonexecution_status_cannot_create_a_trade(
    status: str, action: str, amount: str
) -> None:
    payload = _paired_payload(status, action=action, amount=amount)
    assert payload["transactions"] == []
    assert payload["ending_cash"] == "100.00"
    assert list(payload["position_snapshot"]) == ["OTHER"]


@pytest.mark.parametrize("status", [
    "Filled", "Executed", "Complete", "Done", "Partially Filled", "", " FILLED ",
])
def test_completed_or_posted_transactions_keep_their_executed_quantity(status: str) -> None:
    trade, = _paired_payload(status)["transactions"]
    assert trade["type"] == "buy"
    assert trade["quantity_abs"] == "5"
    assert trade["net_amount_raw"] == "-50.00"


@pytest.mark.parametrize("filled_quantity_header", ["Filled Quantity", "Filled Qty"])
def test_partial_fill_uses_filled_quantity_instead_of_order_quantity(
    filled_quantity_header: str,
) -> None:
    trade, = _paired_payload(
        "Partially Filled",
        quantity="10",
        amount="-30.00",
        filled_quantity_header=filled_quantity_header,
        filled_quantity="3",
    )["transactions"]
    assert trade["quantity_abs"] == "3"
    assert trade["gross_amount_raw"] == "-30.00"
    assert trade["net_amount_raw"] == "-30.00"
    assert trade["source"]["quantity_source_field"] == "filledquantity"
    assert trade["source"]["reported_quantity_raw"] == "10"


@pytest.mark.parametrize("filled_quantity", ["0", "", "--"])
def test_missing_or_zero_filled_quantity_cannot_fall_back_to_order_quantity(
    filled_quantity: str,
) -> None:
    payload = _paired_payload(
        "Partially Filled",
        quantity="10",
        amount="-100.00",
        filled_quantity_header="Filled Quantity",
        filled_quantity=filled_quantity,
    )
    assert payload["transactions"] == []


@pytest.mark.parametrize("status", ["Canceled", "Cancelled", "Working"])
def test_partial_execution_survives_later_order_state(status: str) -> None:
    trade, = _paired_payload(
        status,
        quantity="10",
        amount="-30.00",
        filled_quantity_header="Filled Quantity",
        filled_quantity="3",
    )["transactions"]
    assert trade["quantity_abs"] == "3"
    assert trade["net_amount_raw"] == "-30.00"
    assert trade["source"]["status_raw"] == status.lower()


@pytest.mark.parametrize("status", ["Canceled", "Working"])
@pytest.mark.parametrize("filled_quantity", ["0", "", "--"])
def test_nonfinal_order_requires_positive_filled_quantity(
    status: str, filled_quantity: str,
) -> None:
    assert _paired_payload(
        status,
        filled_quantity_header="Filled Quantity",
        filled_quantity=filled_quantity,
    )["transactions"] == []


@pytest.mark.parametrize("status", ["Unknown State", "Unfilled", "Not Filled"])
def test_positive_quantity_cannot_override_an_unknown_or_contradictory_status(status: str) -> None:
    assert _paired_payload(
        status,
        quantity="10",
        amount="-30.00",
        filled_quantity_header="Filled Quantity",
        filled_quantity="3",
    )["transactions"] == []


def test_canceled_partial_execution_requires_stated_reconciled_cash() -> None:
    assert _paired_payload(
        "Canceled",
        quantity="10",
        amount="",
        filled_quantity_header="Filled Quantity",
        filled_quantity="3",
    )["transactions"] == []
    with pytest.raises(ValueError, match="Amount does not reconcile"):
        _paired_payload(
            "Canceled",
            quantity="10",
            amount="-29.00",
            filled_quantity_header="Filled Quantity",
            filled_quantity="3",
        )


def test_posted_cash_status_is_preserved() -> None:
    row, = _paired_payload("Posted", action="Cash Dividend", amount="50.00")["transactions"]
    assert row["type"] == "dividend"
    assert row["net_amount_raw"] == "50.00"


def test_execution_status_never_bypasses_stated_amount_reconciliation() -> None:
    with pytest.raises(ValueError, match="Amount does not reconcile"):
        _paired_payload("Partially Filled", amount="-49.00")
