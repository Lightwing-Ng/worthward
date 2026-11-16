"""Read-only change projection for HSBC paste imports.

Code version: v1.0.0
"""

from collections import Counter, defaultdict
from decimal import Decimal

from app.services.investment.importing.basics import _normalize_hsbc_account_number
from app.services.investment.importing.brokers.hsbc.cash import (
    _extract_hsbc_order_reference_from_cash_description,
    _hsbc_cash_record_identity_key,
    _parse_hsbc_money_or_none as _money,
)
from app.services.investment.importing.merge.identity import (
    _transaction_identity_key,
)
from app.services.investment.importing.merge.reconciliation import _transactions_for_merge
from app.services.investment.importing.payload_summaries import _hsbc_summary_components


def _source(row: dict) -> dict:
    value = row.get("source")
    return value if isinstance(value, dict) else {}


def _order_reference(row: dict) -> str:
    if row.get("type") not in {"buy", "sell"}:
        return ""
    source = _source(row)
    return str(source.get("statement_order_id") or source.get("order_id") or "").upper()


def _amount_text(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _cash_posting_key(date, currency, reference, amount, balance) -> tuple:
    return (date, currency, reference, _money(amount), _money(balance))


def _postings(row: dict) -> Counter:
    """Compare dated financial postings without source files or display order."""
    postings = _source(row).get("cash_settlement_postings")
    if not isinstance(postings, list):
        return Counter()
    return Counter(
        _cash_posting_key(
            item.get("date"), item.get("currency"), item.get("reference"),
            item.get("amount_raw"), item.get("balance_after_raw"),
        )
        for item in postings
        if isinstance(item, dict)
    )


def _economics(row: dict) -> tuple:
    return (
        row.get("date"),
        row.get("type"),
        row.get("ticker") or "",
        row.get("currency"),
        *(
            _money(row.get(key))
            for key in ("net_amount_raw", "quantity_abs", "price_raw", "commission_raw")
        ),
        _postings(row),
    )


def _transaction(row: dict, change: str, *, type_override: str = "") -> dict:
    postings = _postings(row)
    posting_amounts = [key[3] for key in postings.elements() if key[3] is not None]
    return {
        "date": row.get("date"),
        "description": row.get("description"),
        "type": type_override or row.get("type"),
        "ticker": row.get("ticker"),
        "currency": row.get("currency"),
        "amount": _amount_text(_money(row.get("net_amount_raw"))),
        "quantity": _amount_text(_money(row.get("quantity_abs"))),
        "change": change,
        **(
            {
                "settlement_date": _source(row).get("cash_settlement_date"),
                "settlement_amount": _amount_text(sum(posting_amounts, Decimal("0"))),
            }
            if posting_amounts
            else {}
        ),
    }


def _scoped_transactions(payload: dict, account: str) -> list[dict]:
    return [
        row
        for row in _transactions_for_merge(payload, prefer_longbridge_orders=False)
        if row.get("broker") == "hsbc"
        and _normalize_hsbc_account_number(
            row.get("account")
            or _source(row).get("account")
            or _source(row).get("account_number")
        ) == account
    ]


def _transaction_changes(before: dict, after: dict, incoming: dict, account: str) -> list:
    cash_evidence = incoming.get("hsbc_cash_settlement_evidence", [])
    incoming_rows = incoming.get("transactions", [])
    order_refs = {
        reference
        for row in incoming_rows
        if (reference := _order_reference(row))
    } | {
        reference
        for row in cash_evidence
        if (reference := _extract_hsbc_order_reference_from_cash_description(row["description"]))
    }
    affected_keys = {
        _order_reference(row) or _transaction_identity_key(row)
        for row in incoming_rows
    } | order_refs
    previous_by_identity = defaultdict(list)
    for row in _scoped_transactions(before, account):
        identity = _order_reference(row) or _transaction_identity_key(row)
        if identity in affected_keys:
            previous_by_identity[identity].append(_economics(row))

    changes = []
    unmatched_rows = []
    linked_postings = set()
    for row in _scoped_transactions(after, account):
        order_ref = _order_reference(row)
        if order_ref in order_refs:
            linked_postings.update(_postings(row))
        identity = order_ref or _transaction_identity_key(row)
        if identity not in affected_keys:
            continue
        previous_economics = previous_by_identity[identity]
        economics = _economics(row)
        if economics in previous_economics:
            previous_economics.remove(economics)
        else:
            unmatched_rows.append((identity, row))
    for identity, row in unmatched_rows:
        remaining = previous_by_identity[identity]
        change = "updated" if remaining else "added"
        if remaining:
            remaining.pop()
        changes.append(_transaction(row, change))

    saved_cash_evidence = {
        _hsbc_cash_record_identity_key(row)
        for row in before.get("hsbc_cash_settlement_evidence", [])
    }
    for row in cash_evidence:
        key = _hsbc_cash_record_identity_key(row)
        posting = _cash_posting_key(
            row.get("date"), row.get("currency"), row.get("description"),
            row.get("net_amount_raw"), _source(row).get("balance_after_raw"),
        )
        if key not in saved_cash_evidence and posting not in linked_postings:
            changes.append(_transaction(row, "added", type_override="settlement"))
            saved_cash_evidence.add(key)
    return sorted(changes, key=lambda row: row["date"] or "", reverse=True)


def _broker_summary(payload: dict) -> dict:
    summary = payload.get("broker_summaries", {}).get("hsbc")
    if summary is None and payload.get("broker") == "hsbc":
        summary = {**payload, **payload.get("summary", {})}
    return summary or {}


def _balance_changes(before: dict, after: dict, incoming: dict) -> list:
    old_amounts, _ = _hsbc_summary_components(before)
    amounts, dates = _hsbc_summary_components(after)
    incoming_amounts, _ = _hsbc_summary_components(incoming)
    changes = []
    for component in sorted(incoming_amounts.keys() & amounts.keys()):
        if old_amounts.get(component) == amounts[component]:
            continue
        currency, _, account_type = component.partition(":")
        changes.append(
            {
                "account_type": account_type,
                "currency": currency,
                "previous_amount": _amount_text(old_amounts.get(component)),
                "amount": _amount_text(amounts[component]),
                "date": dates.get(component),
            }
        )
    return changes


def _positions(payload: dict, account: str, summary: dict) -> dict:
    snapshot = payload.get("broker_snapshots", {}).get(f"hsbc:{account}", {})
    return snapshot.get("position_snapshot") or summary.get("position_snapshot") or {}


def _position_values(row: dict) -> dict:
    return {
        key: _amount_text(_money(row.get(key)))
        for key in ("quantity", "cost_price", "last_price", "market_value")
    }


def _position_changes(before: dict, after: dict) -> list:
    changes = []
    for ticker in sorted(before.keys() | after.keys()):
        old = before.get(ticker, {})
        new = after.get(ticker, {})
        old_values = _position_values(old)
        values = _position_values(new)
        if (
            {key: _money(value) for key, value in old_values.items()}
            == {key: _money(value) for key, value in values.items()}
            and old.get("currency") == new.get("currency")
        ):
            continue
        changes.append(
            {
                "ticker": ticker,
                "currency": new.get("currency") or old.get("currency"),
                **{f"previous_{key}": value for key, value in old_values.items()},
                **values,
            }
        )
    return changes


def build_hsbc_paste_preview(before: dict, after: dict, incoming: dict) -> dict:
    """Report economic changes made by one pasted capture within its HSBC account."""
    account = _normalize_hsbc_account_number(incoming["account"])
    old_summary = _broker_summary(before)
    new_summary = _broker_summary(after)
    incoming_summary = _broker_summary(incoming)
    past_warnings = set(before.get("summary", {}).get("warnings", []))
    warnings = dict.fromkeys(incoming.get("summary", {}).get("warnings", []))
    warnings.update(dict.fromkeys(
        warning
        for warning in after.get("summary", {}).get("warnings", [])
        if warning not in past_warnings
    ))
    summary_account = _normalize_hsbc_account_number(old_summary.get("account"))
    if summary_account and summary_account != account:
        old_summary = {}
        new_summary = {}
        warnings["Balance changes are unavailable for this preview because the ledger contains a different HSBC account."] = None
    return {
        "transactions": _transaction_changes(before, after, incoming, account),
        "balances": _balance_changes(old_summary, new_summary, incoming_summary),
        "positions": (
            _position_changes(
                _positions(before, account, old_summary),
                _positions(after, account, new_summary),
            )
            if incoming.get("position_snapshot")
            else []
        ),
        "warnings": list(warnings),
    }
