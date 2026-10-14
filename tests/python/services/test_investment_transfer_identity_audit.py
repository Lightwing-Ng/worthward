"""Durable transfer choices across reexported evidence.

Code version: v0.1.0
"""

from copy import deepcopy

import pytest

from app.services import investment_import as service


def deposit(row, filename, digest, description):
    return {
        "date": "2026-05-29",
        "datetime": "2026-05-29 20:20:00",
        "type": "deposit",
        "broker": "ibkr",
        "account": "U00000001",
        "currency": None,
        "net_amount_raw": "1000",
        "description": description,
        "source": {
            "file_kind": "transactions",
            "source_filename": filename,
            "source_file_sha256": digest,
            "row_number": row,
            "transaction_type_raw": "Deposit",
        },
    }


def withdrawal(currency="USD", amount="-1000"):
    return {
        "date": "2026-05-29",
        "datetime": "2026-05-29 10:00:00",
        "type": "withdrawal",
        "broker": "hsbc",
        "account": "TEST-BANK",
        "currency": currency,
        "net_amount_raw": amount,
        "description": "HK111",
        "source": {"file_kind": "hsbc_usd_account_text", "reference_id": "HK111"},
    }


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("ignored", [False, True])
def test_binding_and_ignore_survive_reexported_row_identity(reverse, ignored):
    first = deposit(12, "may.csv", "a" * 64, "Electronic Fund Transfer")
    second = deposit(13, "may.csv", "a" * 64, "Cash Transfer")
    bank = withdrawal()
    rows = [first, second, bank]
    index = service.build_investment_internal_transfer_binding_index(rows)

    def key(row):
        return next(key for key, matches in index.items() if matches[0] is row)

    old_key = key(first)
    payload = {"broker": "multiple", "account": "multiple", "transactions": rows}
    if ignored:
        payload["manual_internal_transfer_ignored_source_keys"] = [old_key]
    else:
        payload["manual_internal_transfer_bindings"] = {old_key: key(bank)}
    incoming_rows = [
        deposit(40, "oct.csv", "b" * 64, "Electronic Fund Transfer"),
        deposit(41, "oct.csv", "b" * 64, "Cash Transfer"),
    ]
    if reverse:
        incoming_rows.reverse()
    incoming = {"broker": "ibkr", "account": "U00000001", "transactions": incoming_rows}
    merged = service.merge_investment_payloads(deepcopy(payload), incoming)
    new_index = service.build_investment_internal_transfer_binding_index(
        merged["transactions"]
    )
    new_key = next(
        key
        for key, matches in new_index.items()
        if matches[0]["description"] == first["description"]
    )
    assert len(merged["transactions"]) == 3
    if ignored:
        assert merged["manual_internal_transfer_ignored_source_keys"] == [new_key]
    else:
        assert merged["manual_internal_transfer_bindings"] == {new_key: key(bank)}
        service.validate_investment_internal_transfer_binding(
            merged["transactions"], new_key, key(bank)
        )


@pytest.mark.parametrize(
    "currency,amount", [("HKD", "-1"), ("HKD", "-1000"), ("EUR", "-1000")]
)
def test_base_usd_funding_does_not_accept_unsupported_native_currency(currency, amount):
    source, target = (
        deposit(1, "funds.csv", "a" * 64, "Funding"),
        withdrawal(currency, amount),
    )
    with pytest.raises(ValueError, match="currencies|tolerance"):
        service.validate_investment_internal_transfer_binding(
            [source, target],
            service.build_investment_internal_transfer_binding_key(source),
            service.build_investment_internal_transfer_binding_key(target),
        )


@pytest.mark.parametrize(
    "currency,amount", [("CNH", "-6800"), ("CNY", "-6800"), ("USD", "-1000")]
)
def test_documented_manual_funding_currency_scope_remains_supported(currency, amount):
    source, target = (
        deposit(1, "funds.csv", "a" * 64, "Funding"),
        withdrawal(currency, amount),
    )
    service.validate_investment_internal_transfer_binding(
        [source, target],
        service.build_investment_internal_transfer_binding_key(source),
        service.build_investment_internal_transfer_binding_key(target),
    )
