"""Native-currency import binding migration regression tests.

Code version: v1.0.0
"""
from copy import deepcopy

from app.services.investment_import import (
    build_investment_internal_transfer_binding_key,
    normalize_investment_internal_transfer_bindings,
)


def test_native_currency_replacement_migrates_only_unique_evidenced_binding():
    old = {"broker": "ibkr", "account": "U999999", "date": "2026-06-20",
           "type": "deposit", "currency": "USD", "net_amount_raw": "140",
           "description": "Electronic Fund Transfer"}
    native = {**old, "currency": "CNH", "net_amount_raw": "1000",
              "source": {"source_format": "ibkr_realized_summary_csv",
                         "replaced_base_amount_raw": "140",
                         "replaces_transaction_history_row_number": 7}}
    target = {"broker": "boc_hk", "account": "TEST", "date": "2026-06-20",
              "type": "withdrawal", "currency": "CNH", "net_amount_raw": "-1000"}
    old_key = build_investment_internal_transfer_binding_key(old)
    target_key = build_investment_internal_transfer_binding_key(target)
    bindings = {old_key: target_key}
    result = normalize_investment_internal_transfer_bindings(bindings, transactions=[native, target])
    assert result == {build_investment_internal_transfer_binding_key(native): target_key}
    assert normalize_investment_internal_transfer_bindings(result, transactions=[native, target]) == result
    ambiguous = {**deepcopy(native), "net_amount_raw": "1001"}
    assert normalize_investment_internal_transfer_bindings(
        bindings, transactions=[native, ambiguous, target]
    ) == bindings
    without_evidence = {**native, "source": {}}
    assert normalize_investment_internal_transfer_bindings(
        bindings, transactions=[without_evidence, target]
    ) == bindings
    dated = {**native, "date": "2026-06-21", "source": {
        **native["source"], "replaced_base_date": "2026-06-20"}}
    assert normalize_investment_internal_transfer_bindings(
        bindings, transactions=[dated, target]
    ) == {build_investment_internal_transfer_binding_key(dated): target_key}


def test_duplicate_base_amounts_require_preserved_source_identity():
    from app.services.investment_import import build_investment_internal_transfer_binding_index

    old_rows = [{"broker": "ibkr", "account": "U999999", "date": "2026-06-20",
                 "type": "deposit", "currency": "USD", "net_amount_raw": "140",
                 "description": "Electronic Fund Transfer",
                 "source": {"file_kind": "transactions", "row_number": row}}
                for row in [7, 8]]
    native_rows = [{**old, "date": "2026-06-21", "currency": "CNH", "net_amount_raw": "1000",
                    "source": {"file_kind": "ibkr_realized_summary_cash", "row_number": row + 20,
                               "source_format": "ibkr_realized_summary_csv",
                               "replaced_base_amount_raw": "140", "replaced_base_date": old["date"],
                               "replaced_base_source": old["source"],
                               "replaces_transaction_history_row_number": row}}
                   for old, row in zip(old_rows, [7, 8])]
    old_index = build_investment_internal_transfer_binding_index(old_rows)
    new_index = build_investment_internal_transfer_binding_index(native_rows)
    bindings = {key: f"target-{i}" for i, key in enumerate(old_index)}
    result = normalize_investment_internal_transfer_bindings(bindings, transactions=native_rows)
    assert list(result) == list(new_index)
    assert list(result.values()) == list(bindings.values())
