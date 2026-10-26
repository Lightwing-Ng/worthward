"""User-confirmed identity for otherwise unidentified HSBC cash dividends.

Code version: v1.0.0
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Any

from app.infrastructure.storage import (
    canonicalize_investment_ticker,
    has_valid_ticker_format,
    normalize_ticker,
)


_DERIVED_FIELDS = ("dividend_attribution_key", "dividend_attribution_candidates")
_SECURITY_TRANSACTION_TYPES = frozenset({
    "buy", "sell", "transfer_in", "transfer_out", "grant", "stock_grant",
    "dividend", "foreign_tax_withholding", "payment_in_lieu", "stock_split",
    "bonus_shares", "reinvestment",
})


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _source(record: dict[str, Any]) -> dict[str, Any]:
    return record.get("source") if isinstance(record.get("source"), dict) else {}


def preserve_hsbc_dividend_attribution_on_cash_merge(
    merged: dict[str, Any], current: dict[str, Any], incoming: dict[str, Any]
) -> dict[str, Any]:
    """Retain explicit user identity when later cash evidence enriches a row."""
    description = " ".join(_text(current.get("description")).split()).upper()
    if not description.startswith("CORP EVT PAYMENT"):
        return merged
    current_ticker = normalize_ticker(_text(current.get("ticker")))
    incoming_ticker = normalize_ticker(_text(incoming.get("ticker")))
    current_source = _source(current)
    source = _source(merged)
    if (
        current_source.get("dividend_attribution_status") == "user_confirmed"
        or current_source.get("dividend_attribution_user_override") is True
    ):
        source.update({
            key: value for key, value in current_source.items()
            if key.startswith("dividend_attribution_")
        })
        merged["ticker"] = current_ticker
        merged["type"] = "dividend"
        merged["source"] = source
        return merged
    if not current_ticker or incoming_ticker:
        return merged
    if _text(merged.get("type")).lower() != "dividend":
        merged["type"] = "dividend"
        source["dividend_classification_preserved_on_incremental_import"] = True
    if _text(source.get("dividend_attribution_status")) == "unavailable_from_hsbc_cash_text":
        source["dividend_attribution_status"] = "preserved_existing_ledger_attribution"
        source["dividend_attribution_method"] = (
            _text(source.get("dividend_attribution_method"))
            or "existing_hsbc_ledger_identity"
        )
        source["dividend_attribution_preserved_on_incremental_import"] = True
    merged["ticker"] = current_ticker
    merged["source"] = source
    return merged


def _scope(record: dict[str, Any]) -> tuple[str, str, str]:
    source = _source(record)
    broker = _text(record.get("broker") or source.get("broker")).lower()
    account = _text(record.get("account") or source.get("account"))
    source_account = _text(source.get("account"))
    if account and source_account and account != source_account:
        return "", "", ""
    currency = _text(record.get("currency")).upper()
    return broker, account, {"CNY": "CNH", "RMB": "CNH"}.get(currency, currency)


def _decimal_token(value: Any) -> str:
    try:
        amount = Decimal(_text(value))
    except InvalidOperation:
        return ""
    if not amount.is_finite():
        return ""
    return format(amount.normalize(), "f")


def _is_editable(record: dict[str, Any]) -> bool:
    broker, account, currency = _scope(record)
    source = _source(record)
    amount = _decimal_token(record.get("net_amount_raw"))
    return bool(
        broker == "hsbc"
        and account
        and currency
        and _text(record.get("date"))
        and _text(record.get("type")).lower() == "dividend"
        and " ".join(_text(record.get("description")).upper().split()).startswith(
            "CORP EVT PAYMENT"
        )
        and amount
        and Decimal(amount) > 0
        and (
            not _text(record.get("ticker"))
            or source.get("dividend_attribution_status") == "user_confirmed"
        )
    )


def dividend_attribution_record_key(record: dict[str, Any]) -> str:
    """Bind an edit to cash evidence, independently of display order or ticker."""
    if not _is_editable(record):
        return ""
    source = _source(record)
    balance = _decimal_token(source.get("balance_after_raw"))
    identity = [
        *_scope(record),
        _text(record.get("date")),
        " ".join(_text(record.get("description")).split()),
        _decimal_token(record.get("net_amount_raw")),
        _text(source.get("account_type")).upper(),
        balance,
    ]
    if not balance:
        identity.extend([
            _text(source.get("source_sequence_sha256") or source.get("source_file_sha256")),
            _text(source.get("source_sequence_row_number") or source.get("row_number")),
        ])
    digest = hashlib.sha256(
        json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"hsbc-dividend-v1:{digest}"


def _candidate_tickers(payload: dict[str, Any], record: dict[str, Any]) -> list[str]:
    scope = _scope(record)
    candidates: set[str] = set()
    transactions = payload.get("transactions")
    for item in transactions if isinstance(transactions, list) else []:
        if not isinstance(item, dict) or _scope(item) != scope:
            continue
        if _text(item.get("type")).lower() not in _SECURITY_TRANSACTION_TYPES:
            continue
        ticker = canonicalize_investment_ticker(_text(item.get("ticker")))
        if ticker and has_valid_ticker_format(ticker):
            candidates.add(ticker)

    snapshots = payload.get("broker_snapshots")
    snapshot_rows = list(snapshots.values()) if isinstance(snapshots, dict) else []
    snapshot_rows.append(payload)
    for snapshot in snapshot_rows:
        if not isinstance(snapshot, dict):
            continue
        if (
            _text(snapshot.get("broker")).lower() != scope[0]
            or _text(snapshot.get("account") or snapshot.get("account_id")) != scope[1]
        ):
            continue
        positions = snapshot.get("position_snapshot")
        for raw_ticker, position in positions.items() if isinstance(positions, dict) else []:
            if not isinstance(position, dict):
                continue
            if _text(position.get("currency")).upper() != scope[2]:
                continue
            ticker = canonicalize_investment_ticker(_text(raw_ticker))
            if ticker and has_valid_ticker_format(ticker):
                candidates.add(ticker)
    return sorted(candidates)


def annotate_dividend_attribution_choices(payload: dict[str, Any]) -> dict[str, Any]:
    """Expose choices only for an unambiguous editable transaction."""
    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        return payload
    records = [record for record in transactions if isinstance(record, dict)]
    keys = Counter(dividend_attribution_record_key(record) for record in records)
    for record in records:
        for field in _DERIVED_FIELDS:
            record.pop(field, None)
        key = dividend_attribution_record_key(record)
        if key and keys[key] == 1:
            record["dividend_attribution_key"] = key
            record["dividend_attribution_candidates"] = _candidate_tickers(payload, record)
    return payload


def update_dividend_attribution(
    payload: dict[str, Any], record_key: str, ticker: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Update only the chosen ticker and its user attestation under the store lock."""
    if not isinstance(record_key, str) or not record_key:
        raise ValueError("A dividend record key is required.")
    if not isinstance(ticker, str):
        raise ValueError("Select a valid dividend ticker.")
    next_payload = deepcopy(payload)
    transactions = next_payload.get("transactions")
    matches = [
        record for record in transactions if isinstance(record, dict)
        and dividend_attribution_record_key(record) == record_key
    ] if isinstance(transactions, list) else []
    if len(matches) != 1:
        raise ValueError("The dividend is unavailable or ambiguous. Reload transaction history.")
    record = matches[0]
    selected_ticker = canonicalize_investment_ticker(ticker.strip())
    if ticker.strip() and (
        not has_valid_ticker_format(selected_ticker)
        or selected_ticker not in _candidate_tickers(next_payload, record)
    ):
        raise ValueError("Select a ticker from this HSBC account and currency.")
    source = dict(_source(record))
    history = source.get("dividend_attribution_user_history")
    history = list(history) if isinstance(history, list) else []
    confirmed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    history.append({
        "previous_ticker": _text(record.get("ticker")),
        "ticker": selected_ticker,
        "confirmed_at": confirmed_at,
    })
    source.update({
        "dividend_attribution_status": (
            "user_confirmed" if selected_ticker else "unavailable_from_hsbc_cash_text"
        ),
        "dividend_attribution_method": "user_selection" if selected_ticker else "user_cleared",
        "dividend_attribution_user_override": True,
        "dividend_attribution_confirmed_at": confirmed_at,
        "dividend_attribution_user_history": history,
    })
    record["ticker"] = selected_ticker
    record["source"] = source
    for field in _DERIVED_FIELDS:
        record.pop(field, None)
    return next_payload, {"record_key": record_key, "ticker": selected_ticker}
