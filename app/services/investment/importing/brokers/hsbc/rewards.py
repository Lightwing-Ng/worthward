"""Recognize evidenced HSBC bank-cash cashback without inferring other refunds.

Code version: v1.0.0
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any

from app.services.investment.importing.support import (
    HSBC_CASH_ACCOUNT_FILE_KINDS,
    HSBC_CURRENCY_ALIASES,
    _normalize_whitespace,
)


_REWARD_TYPES = frozenset(
    {"cash_reward", "credit_interest", "debit_interest", "deposit", "withdrawal"}
)
_DESCRIPTIONS = {
    "CASH REBATE 0055": 1,
    "CASH REBATE REV 0055": -1,
    "REFUND P HSBCPCLOTRANSIT": 1,
    "REFUND P MEITUAN REBATE": 1,
}
_DESCRIPTION = re.compile(
    r"(?P<base>CASH REBATE(?: REV)? 0055|REFUND P HSBCPCLOTRANSIT|REFUND P MEITUAN REBATE)"
    r"(?: \(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}\))?"
    r"(?: (?P<posting>CREDIT AS ADVISED|DEBIT AS ADVISED|DEP[A-Z0-9]+-\d+))?"
)


def _description_parts(description: Any) -> tuple[str, str]:
    match = _DESCRIPTION.fullmatch(_normalize_whitespace(description).upper())
    if not match:
        return "", ""
    base, posting = match["base"], match["posting"] or ""
    if posting == "DEBIT AS ADVISED" and base != "CASH REBATE REV 0055":
        return "", ""
    if posting == "CREDIT AS ADVISED" and base == "CASH REBATE REV 0055":
        return "", ""
    if posting.startswith("DEP") and base != "CASH REBATE 0055":
        return "", ""
    return base, posting


def hsbc_cash_reward_description(description: Any) -> str:
    """Return a known reward description after its supported bank-only suffixes."""
    return _description_parts(description)[0]


def hsbc_cash_reward_identity_description(description: Any) -> str:
    """Preserve a bank posting reference while ignoring display-only suffixes."""
    base, posting = _description_parts(description)
    return f"{base} {posting}" if posting.startswith("DEP") else base


def hsbc_cash_reward_direction(description: Any) -> int:
    """Identify signed reward direction only for explicitly evidenced descriptions."""
    return _DESCRIPTIONS.get(hsbc_cash_reward_description(description), 0)


def _account_type(value: Any, currency: str) -> str:
    normalized = _normalize_whitespace(value).upper()
    leading = re.match(r"^(USD|HKD|CNH|CNY|RMB)\s+", normalized)
    if leading:
        if HSBC_CURRENCY_ALIASES[leading[1]] != currency:
            return ""
        normalized = normalized[leading.end() :]
    foreign_savings = re.fullmatch(
        r"FOREIGN CURRENCY SAVINGS(?:\s+(USD|HKD|CNH|CNY|RMB))?", normalized
    )
    if foreign_savings:
        if foreign_savings[1] and HSBC_CURRENCY_ALIASES[foreign_savings[1]] != currency:
            return ""
        normalized = "SAVINGS"
    return normalized if normalized in {"SAVINGS", "CURRENT"} else ""


def is_hsbc_cash_reward_record(record: dict[str, Any], *, broker: str = "") -> bool:
    """Require HSBC cash provenance, supported scope, description, and signed amount."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_whitespace(source.get("transaction_type_raw")).upper() == "KOL":
        return False
    effective_broker = (
        str(record.get("broker") or source.get("broker") or broker).strip().lower()
    )
    source_broker = str(source.get("broker") or "").strip().lower()
    file_kind = str(source.get("file_kind") or "").strip().lower()
    if (
        effective_broker != "hsbc"
        or (source_broker and source_broker != effective_broker)
        or file_kind not in HSBC_CASH_ACCOUNT_FILE_KINDS
    ):
        return False
    if str(record.get("type") or "").lower() not in _REWARD_TYPES or record.get(
        "ticker"
    ):
        return False
    normalized = (
        record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
    )
    currencies = [
        HSBC_CURRENCY_ALIASES.get(str(value).strip().upper())
        for value in (
            record.get("currency"),
            normalized.get("currency"),
            source.get("currency"),
            source.get("statement_currency_raw"),
        )
        if str(value or "").strip()
    ]
    if (
        not currencies
        or not currencies[0]
        or any(value != currencies[0] for value in currencies)
    ):
        return False
    currency = currencies[0]
    account_types = [
        _account_type(value, currency)
        for value in (record.get("account_type"), source.get("account_type"))
        if str(value or "").strip()
    ]
    if (
        not account_types
        or not account_types[0]
        or any(value != account_types[0] for value in account_types)
    ):
        return False
    if file_kind in {"hsbc_usd_account_text", "hsbc_usd_savings_csv"} and (
        currency != "USD" or account_types[0] != "SAVINGS"
    ):
        return False
    direction = hsbc_cash_reward_direction(record.get("description"))
    if not direction:
        return False
    values = [
        value
        for value in (
            normalized.get("net_amount"),
            record.get("amount"),
            record.get("cash"),
            record.get("net_amount_raw"),
        )
        if value is not None and str(value).strip()
    ]
    if not values or any(
        type(value) not in {str, int, float}
        or re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", str(value).strip()) is None
        for value in values
    ):
        return False
    try:
        amounts = [Decimal(str(value).strip()) for value in values]
    except (InvalidOperation, TypeError, ValueError):
        return False
    return (
        all(value.is_finite() for value in amounts)
        and all(abs(value - amounts[0]) <= Decimal("0.000000001") for value in amounts)
        and amounts[0] * direction > 0
    )


def canonicalize_hsbc_cash_reward_record(
    record: dict[str, Any], *, broker: str = ""
) -> bool:
    """Normalize verified legacy cash classifications without changing money or scope."""
    if not is_hsbc_cash_reward_record(record, broker=broker):
        return False
    record["type"] = "cash_reward"
    return True
