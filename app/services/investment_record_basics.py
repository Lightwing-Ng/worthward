"""Shared pure helpers for investment import text, decimals, and normalized views.

Code version: v1.0.0
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def normalize_import_text(value: str | None) -> str:
    """Strip surrounding whitespace from a broker field."""
    return str(value or "").strip()


def normalize_import_whitespace(value: str | None) -> str:
    """Collapse internal whitespace while stripping ends."""
    return " ".join(normalize_import_text(value).split())


def decimal_to_str(value: Decimal | None) -> str | None:
    """Serialize a Decimal without scientific notation."""
    if value is None:
        return None
    return format(value, "f")


def parse_decimal_text(
    value: str | None,
    field_name: str,
    row_number: int,
    warnings: list[str],
) -> Decimal | None:
    """Parse a broker decimal field, recording a warning and returning None on failure."""
    raw = normalize_import_text(value)
    if raw in {"", "-"}:
        return None
    try:
        return Decimal(raw.replace(",", ""))
    except (InvalidOperation, ValueError, TypeError):
        warnings.append(
            f"Row {row_number}: invalid decimal in field '{field_name}': {value!r}"
        )
        return None


def build_normalized_transaction_view(
    mapped_type: str,
    quantity_dec: Decimal | None,
    price_dec: Decimal | None,
    gross_amount_dec: Decimal | None,
    commission_dec: Decimal | None,
    net_amount_dec: Decimal | None,
    *,
    is_cash_flow_override: bool | None = None,
    side_override: str | None = None,
) -> dict[str, Any]:
    """Build the shared normalized accounting view attached to import records."""
    normalized: dict[str, Any] = {}

    side = side_override
    if side is None:
        if mapped_type in {"buy", "grant"}:
            side = "buy"
        elif mapped_type == "sell":
            side = "sell"
    if side:
        normalized["side"] = side

    if quantity_dec is not None:
        normalized["position_quantity"] = decimal_to_str(quantity_dec)
        normalized["display_quantity"] = decimal_to_str(abs(quantity_dec))

    if price_dec is not None:
        normalized["unit_price"] = decimal_to_str(price_dec)

    if gross_amount_dec is not None:
        normalized["gross_amount"] = decimal_to_str(gross_amount_dec)
        if mapped_type in {"buy", "sell", "grant"}:
            normalized["display_amount"] = decimal_to_str(abs(gross_amount_dec))
        else:
            normalized["display_amount"] = decimal_to_str(gross_amount_dec)

    if commission_dec is not None:
        normalized["commission"] = decimal_to_str(commission_dec)
        normalized["commission_display"] = decimal_to_str(abs(commission_dec))

    if net_amount_dec is not None:
        normalized["net_amount"] = decimal_to_str(net_amount_dec)

    is_cash_flow = (
        is_cash_flow_override
        if is_cash_flow_override is not None
        else mapped_type not in {"buy", "sell", "fx_translation_pnl", "grant"}
    )
    normalized["is_cash_flow"] = is_cash_flow

    if net_amount_dec is not None:
        amount_key = "cash_flow_amount" if is_cash_flow else "accounting_adjustment_amount"
        normalized[amount_key] = decimal_to_str(net_amount_dec)

    return normalized
