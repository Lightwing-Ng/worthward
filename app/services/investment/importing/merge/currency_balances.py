"""Normalize imported currency balance maps without changing source meaning.

Code version: v1.0.0
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    Decimal,
    HSBC_CURRENCY_ALIASES,
    ZERO,
    _decimal_to_str,
    _normalize_text,
)

import app.services.investment.importing.brokers.bochk as _ii_bochk
import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash


def _normalize_hsbc_currency_code(value: Any) -> str:
    return HSBC_CURRENCY_ALIASES.get(_normalize_text(value).upper(), "")


def _normalize_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _normalize_text(raw_currency).upper()
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: "0" if amount == ZERO else _decimal_to_str(amount)
        for currency, amount in normalized.items()
    }


def _normalize_hsbc_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _normalize_hsbc_currency_code(raw_currency)
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in normalized.items()
    }


def _normalize_bochk_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _ii_bochk._normalize_bochk_currency_code(raw_currency)
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: "0" if amount == ZERO else _decimal_to_str(amount)
        for currency, amount in normalized.items()
    }


def _normalize_bochk_subaccount_balance_map(value: Any) -> dict[str, dict[str, Any]]:
    """Normalize BOCHK subaccount balances while retaining printed currency labels."""
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for raw_key, raw_balance in value.items():
        if not isinstance(raw_balance, dict):
            continue
        account_number = _normalize_text(raw_balance.get("account_number"))
        raw_key_text = _normalize_text(raw_key)
        raw_key_currency = (
            raw_key_text.rsplit(":", 1)[-1] if ":" in raw_key_text else ""
        )
        raw_currency = _normalize_text(
            raw_balance.get("currency_raw")
            or raw_balance.get("currency")
            or raw_key_currency
        ).upper()
        currency = _ii_bochk._normalize_bochk_currency_code(raw_currency)
        if not currency:
            currency = _normalize_text(raw_balance.get("currency")).upper()
        if not currency:
            continue
        balance = dict(raw_balance)
        if account_number:
            balance["account_number"] = account_number
        balance["currency"] = currency
        if raw_currency:
            balance["currency_raw"] = raw_currency
        normalized_key = (
            f"{account_number}:{currency}" if account_number else raw_key_text
        )
        if not normalized_key:
            continue
        existing = normalized.get(normalized_key)
        if existing is None:
            normalized[normalized_key] = balance
        else:
            normalized[normalized_key] = {**existing, **balance}
    return normalized
