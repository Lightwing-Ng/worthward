"""Regression coverage for evidence-backed CMB Wing Lung email trades.

Code version: v0.1.0
"""

from __future__ import annotations

from email.message import EmailMessage

import pytest

from app.services.investment_import import (
    _synthesize_cmbwl_bonus_share_grants,
    parse_investment_payload,
)


def _order_email(
    order_id: str,
    *,
    action: str = "Sold",
    status: str = "was completed",
    quantity: str = "5",
    explicit_execution: bool = True,
    price: str = "10.00",
    include_executed_quantity: bool = True,
    include_executed_price: bool = True,
    day: str = "13",
) -> bytes:
    message = EmailMessage()
    weekday = "Mon" if day == "12" else "Tue"
    message["Date"] = f"{weekday}, {day} Oct 2026 10:30:00 +0800"
    message["Subject"] = "Securities order notification"
    fields = [
        f"Your securities order for account XXXX999 {status}.",
        "Test stock (TEST)",
        f"Action: {action}",
        "Qty: 10",
        "Price: USD 12.00",
        f"Order No.: {order_id}",
    ]
    if explicit_execution:
        if include_executed_quantity:
            fields.append(f"Executed Qty: {quantity}")
        if include_executed_price:
            fields.append(f"Executed Price: USD{price}")
    message.set_content("\n".join(fields))
    return message.as_bytes()


def _parse(*emails: bytes) -> dict:
    return parse_investment_payload(
        "cmbwl",
        "securities_order_emls",
        eml_payloads=[(email, f"order-{index}.eml") for index, email in enumerate(emails)],
    )


@pytest.mark.parametrize("action", ["Bought", "Sold"])
def test_cancelled_unmatched_order_does_not_create_a_trade(action: str) -> None:
    payload = _parse(
        _order_email("1", action="Bought", day="12"),
        _order_email(
            "2", action=action, status="unmatched and cancelled", explicit_execution=False,
        ),
    )
    assert [(row["type"], row["quantity_abs"]) for row in payload["transactions"]] == [("buy", "5")]


@pytest.mark.parametrize("action", ["Bought", "Sold"])
def test_cancelled_order_retains_only_explicitly_executed_part(action: str) -> None:
    payload = _parse(_order_email(
        "1", action=action, status="unmatched and cancelled", quantity="3",
    ))
    row, = payload["transactions"]
    assert row["type"] == ("buy" if action == "Bought" else "sell")
    assert row["quantity_abs"] == "3"
    assert row["price_raw"] == "10.00"
    assert row["net_amount_raw"] == ("-30.00" if action == "Bought" else "30.00")


def test_completed_sell_without_purchase_history_never_invents_bonus_shares() -> None:
    payload = _parse(_order_email("1"))
    row, = payload["transactions"]
    assert row["type"] == "sell"
    assert row["quantity_abs"] == "5"
    assert payload["generator"]["bonus_share_grant_count"] == 0
    assert any("incomplete trade history" in warning for warning in payload["summary"]["warnings"])


def test_legacy_grant_inference_callable_cannot_turn_missing_history_into_a_grant() -> None:
    transaction = {
        "broker": "cmbwl", "account": "XXXX999", "ticker": "TEST", "currency": "USD",
        "date": "2026-10-13", "datetime": "2026-10-13 20:00:00", "type": "sell",
        "quantity_raw": "5", "quantity_abs": "5", "source": {"order_id": "1"},
    }
    warnings: list[str] = []
    assert _synthesize_cmbwl_bonus_share_grants(
        [transaction], account="XXXX999", warnings=warnings,
    ) == []
    assert any("incomplete trade history" in warning for warning in warnings)


def test_partial_history_does_not_synthesize_a_cost_basis_for_the_sale_gap() -> None:
    payload = _parse(
        _order_email("1", action="Bought", quantity="2", day="12"),
        _order_email("2", quantity="5"),
    )
    assert [row["type"] for row in payload["transactions"]] == ["buy", "sell"]
    assert any("incomplete trade history" in warning for warning in payload["summary"]["warnings"])


def test_complete_round_trip_keeps_real_execution_values_without_gap_warnings() -> None:
    payload = _parse(
        _order_email("1", action="Bought", day="12"), _order_email("2"),
    )
    assert [row["net_amount_raw"] for row in payload["transactions"]] == ["-50.00", "50.00"]
    assert not any("incomplete trade history" in warning for warning in payload["summary"]["warnings"])


@pytest.mark.parametrize("status", ["was completed", "unmatched and cancelled", "is working"])
def test_limit_quantity_and_price_alone_are_not_execution_evidence(status: str) -> None:
    with pytest.raises(ValueError, match="No completed"):
        _parse(_order_email("1", status=status, explicit_execution=False))


@pytest.mark.parametrize("status", ["was completed", "unmatched and cancelled"])
@pytest.mark.parametrize(("quantity", "price"), [
    ("0", "10.00"), ("-1", "10.00"), ("invalid", "10.00"),
    ("5", "0"), ("5", "-1"), ("5", "invalid"),
])
def test_zero_or_malformed_execution_fields_do_not_use_limit_order_values(
    status: str, quantity: str, price: str,
) -> None:
    with pytest.raises(ValueError, match="No completed"):
        _parse(_order_email("1", status=status, quantity=quantity, price=price))


@pytest.mark.parametrize(("has_quantity", "has_price"), [(True, False), (False, True)])
def test_partial_execution_fields_cannot_borrow_missing_limit_order_values(
    has_quantity: bool, has_price: bool,
) -> None:
    with pytest.raises(ValueError, match="No completed"):
        _parse(_order_email(
            "1", status="unmatched and cancelled",
            include_executed_quantity=has_quantity,
            include_executed_price=has_price,
        ))


def test_identical_order_notifications_retain_one_execution() -> None:
    email = _order_email("1", action="Bought")
    payload = _parse(email, email)
    assert len(payload["transactions"]) == 1
    assert payload["transactions"][0]["net_amount_raw"] == "-50.00"


def test_cancelled_unmatched_notification_cannot_hide_a_later_completed_order() -> None:
    payload = _parse(
        _order_email("1", status="unmatched and cancelled", explicit_execution=False),
        _order_email("1", action="Bought"),
    )
    assert len(payload["transactions"]) == 1
    assert payload["transactions"][0]["type"] == "buy"
