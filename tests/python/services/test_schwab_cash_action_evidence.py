"""Schwab cash, reinvestment, and displayed-price evidence regressions.

Code version: v0.1.0
"""

from decimal import Decimal

import pytest

from app.services.investment.importing.brokers.schwab import (
    _build_schwab_transaction_record,
)


def _record(action, amount, *, quantity="", price="", fee="", description="Fund"):
    return _build_schwab_transaction_record(
        {
            "Date": "08/20/2026",
            "Action": action,
            "Amount": amount,
            "Symbol": "TEST",
            "Description": description,
            "Quantity": quantity,
            "Price": price,
            "Fees & Comm": fee,
        },
        2,
        None,
        [],
        set(),
    )


@pytest.mark.parametrize(
    "action",
    ["MoneyLink Transfer", "Deposit", "Withdrawal", "Wire Received", "Wire Sent"],
)
@pytest.mark.parametrize(
    ("amount", "expected"), [("5000.00", "deposit"), ("-5000.00", "withdrawal")]
)
def test_external_cash_direction_comes_from_stated_amount(action, amount, expected):
    record = _record(action, amount)
    assert record["type"] == expected
    assert Decimal(record["net_amount_raw"]) == Decimal(amount)
    assert record["source"]["action_raw"] == action


@pytest.mark.parametrize(
    "action", ["Reinvest Dividend", "Qual Div Reinvest", "Pr Yr Div Reinvest"]
)
def test_reinvestment_income_remains_positive_dividend(action):
    record = _record(action, "12.34", description="US DIVIDEND EQUITY ETF")
    assert record["type"] == "dividend"
    assert record["net_amount_raw"] == "12.34"


def test_reinvest_shares_retains_acquired_shares_and_cash_cost():
    record = _record(
        "Reinvest Shares",
        "-12.34",
        quantity="0.4512",
        price="27.35",
        description="US DIVIDEND EQUITY ETF",
    )
    assert record["type"] == "dividend_reinvestment"
    assert record["quantity_abs"] == "0.4512"
    assert Decimal(record["net_amount_raw"]) == Decimal("-12.34")
    assert record["source"]["reinvestment_cost_basis_status"] == "known"


def test_bank_interest_is_income():
    assert _record("Bank Interest", "1.25")["type"] == "credit_interest"


@pytest.mark.parametrize(
    ("action", "quantity", "price", "fee", "amount"),
    [
        ("Buy", "1000", "12.3457", "", "-12345.68"),
        ("Buy", "0.4512", "27.35", "", "-12.34"),
        ("Sell", "3.3333", "33.3333", "0.01", "111.10"),
    ],
)
def test_rounded_display_price_does_not_replace_stated_net_cash(
    action, quantity, price, fee, amount
):
    record = _record(action, amount, quantity=quantity, price=price, fee=fee)
    assert Decimal(record["net_amount_raw"]) == Decimal(amount)
    assert Decimal(record["gross_amount_raw"]) == Decimal(amount) + Decimal(fee or "0")


@pytest.mark.parametrize("amount", ["-12346.00", "12345.68"])
def test_material_or_directional_amount_mismatch_still_fails_closed(amount):
    with pytest.raises(ValueError, match="does not reconcile"):
        _record("Buy", amount, quantity="1000", price="12.3457")
