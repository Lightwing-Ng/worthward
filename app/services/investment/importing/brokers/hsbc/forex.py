"""Reconcile HSBC cash-account legs that share a verified conversion reference.

Code version: v1.0.0
"""

from collections import defaultdict
from decimal import Decimal
import re
from typing import Any

from app.services.investment.importing.basics import _normalize_hsbc_account_number
from app.services.investment.importing.bindings import (
    build_investment_internal_transfer_binding_index,
    normalize_investment_internal_transfer_bindings,
)
from app.services.investment.importing.brokers.hsbc.cash import (
    _parse_hsbc_money_or_none,
    _parse_hsbc_positive_sequence_number,
)
from app.services.investment.importing.merge.identity import (
    _is_hsbc_cash_account_record,
    _normalize_hsbc_cash_account_type,
    _normalize_hsbc_currency_code,
)
from app.services.investment.importing.support import (
    _hsbc_net_cash_reference,
    _normalize_text,
    _normalize_whitespace,
)


_PAIR_SOURCE = "hsbc_net_cash_account_reference"


def hsbc_net_cash_group_key(record: dict[str, Any]) -> tuple[str, str, str] | None:
    if not _is_hsbc_cash_account_record(record):
        return None
    source = record["source"]
    account = _normalize_hsbc_account_number(record.get("account"))
    post_date = _normalize_text(record.get("date"))
    reference = _hsbc_net_cash_reference(record)
    if (
        not account
        or not post_date
        or not reference
        or any(
            _normalize_hsbc_account_number(value) != account
            for value in (source.get("account"), source.get("account_number"))
            if value
        )
    ):
        return None
    return account, post_date, reference


def _cash_leg(record: dict[str, Any]) -> tuple[str, Decimal] | None:
    source = record["source"]
    currency = _normalize_hsbc_currency_code(record.get("currency"))
    amount = _parse_hsbc_money_or_none(record.get("net_amount_raw"))
    kind = record.get("type")
    row_number = _parse_hsbc_positive_sequence_number(source.get("row_number"))
    ledger_sequence = _parse_hsbc_positive_sequence_number(
        source.get("ledger_sequence")
    )
    authoritative = source.get("file_kind") in {
        "hsbc_usd_account_text",
        "hsbc_usd_savings_csv",
    }
    if (
        currency not in {"USD", "HKD", "CNH"}
        or _normalize_hsbc_cash_account_type(currency, source.get("account_type"))
        not in {"SAVINGS", "CURRENT"}
        or source.get("cash_balance_scope") != "account"
        or source.get("cash_balance_authoritative") is not authoritative
        or not source.get("account_number")
        or row_number is None
        or ledger_sequence is None
        or not re.fullmatch(
            r"[0-9a-f]{64}", str(source.get("source_sequence_sha256") or "")
        )
        or _normalize_whitespace(source.get("reference_id")).upper()
        != _normalize_whitespace(record.get("description")).upper()
        or _parse_hsbc_money_or_none(source.get("balance_after_raw")) is None
        or amount is None
        or amount == 0
        or record.get("exclude_from_holdings_replay")
        or (kind == "deposit" and amount < 0)
        or (kind == "withdrawal" and amount > 0)
        or (
            kind == "forex_trade_component"
            and source.get("forex_pair_reference_source") != _PAIR_SOURCE
        )
    ):
        return None
    return currency, amount


def reconcile_hsbc_net_cash_forex(
    transactions: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
    manual_transfer_bindings: Any,
) -> None:
    """Reclassify a unique pair once both posted legs exist in the merged ledger."""
    affected_groups = {
        key for record in incoming if (key := hsbc_net_cash_group_key(record))
    }
    if not affected_groups:
        return
    groups = defaultdict(list)
    for record in transactions:
        key = hsbc_net_cash_group_key(record)
        if key in affected_groups:
            groups[key].append(record)

    bindings = normalize_investment_internal_transfer_bindings(
        manual_transfer_bindings,
        transactions=transactions,
    )
    protected_ids: set[int] = set()
    if bindings:
        index = build_investment_internal_transfer_binding_index(transactions)
        for key in set(bindings) | set(bindings.values()):
            protected_ids.update(id(record) for record in index.get(key, []))

    for (_, _, reference), records in groups.items():
        if len(records) == 2 and not any(
            id(record) in protected_ids for record in records
        ):
            first, second = map(_cash_leg, records)
            if first and second and first[0] != second[0] and first[1] * second[1] < 0:
                for record, (_, amount) in zip(records, (first, second), strict=True):
                    record["type"] = "forex_trade_component"
                    record["source"] = {
                        **record["source"],
                        "forex_pair_reference_id": reference,
                        "forex_pair_reference_source": _PAIR_SOURCE,
                        "forex_pair_component": "acquired" if amount > 0 else "sold",
                    }
                continue

        # An additional cash row can invalidate a previously unique reference.
        for record in records:
            if record["source"].get("forex_pair_reference_source") != _PAIR_SOURCE:
                continue
            source = dict(record["source"])
            amount = _parse_hsbc_money_or_none(record.get("net_amount_raw"))
            if amount:
                record["type"] = "deposit" if amount > 0 else "withdrawal"
            for field in (
                "forex_pair_reference_id",
                "forex_pair_reference_source",
                "forex_pair_component",
            ):
                source.pop(field, None)
            record["source"] = source
