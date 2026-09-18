"""Investment import domain: IBKR statement interest-accrual evidence.

Code version: v1.0.0

IBKR reports accrued interest as a separate Net Asset Value component. It is
neither cash nor security market value, so it is retained as its own dated
snapshot instead of being folded into a cash balance.
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Decimal,
    InvalidOperation,
    _decimal_to_str,
    _normalize_text,
    _parse_decimal,
    date,
)

IBKR_INTEREST_ACCRUAL_SOURCE = "ibkr_csv_realized_summary_interest_accruals"
IBKR_INTEREST_ACCRUAL_SCHEMA_VERSION = "v1"
IBKR_INTEREST_ACCRUAL_REPORTED = "reported"
IBKR_INTEREST_ACCRUAL_CONFLICT = "conflict"
IBKR_INTEREST_ACCRUAL_UNDATED = "undated"
IBKR_INTEREST_ACCRUAL_INCOMPLETE = "incomplete"
_IBKR_INTEREST_ACCRUAL_STATUSES = {
    IBKR_INTEREST_ACCRUAL_REPORTED,
    IBKR_INTEREST_ACCRUAL_CONFLICT,
    IBKR_INTEREST_ACCRUAL_UNDATED,
    IBKR_INTEREST_ACCRUAL_INCOMPLETE,
}
_NAV_SECTION = "Net Asset Value"
_ACCRUAL_SECTION = "Interest Accruals"
_BASE_SUMMARY_LABEL = "Base Currency Summary"
_ENDING_BALANCE_FIELD = "Ending Accrual Balance"
_ENDING_BALANCE_IN_BASE_SUFFIX = "Ending Accrual Balance in "


def _extract_ibkr_base_currency(rows: list[list[str]]) -> str:
    for row in rows:
        if (
            len(row) >= 4
            and row[0] == "Account Information"
            and row[1] == "Data"
            and _normalize_text(row[2]) == "Base Currency"
        ):
            return _normalize_text(row[3]).upper()
    return ""


def _extract_nav_interest_accruals(
    rows: list[list[str]],
    warnings: list[str],
) -> Decimal | None:
    """Return the NAV table's current Interest Accruals total, if reported."""
    column_index: int | None = None
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 3 or row[0] != _NAV_SECTION:
            continue
        if row[1] == "Header":
            headers = [_normalize_text(value) for value in row]
            column_index = (
                headers.index("Current Total")
                if len(headers) > 2 and headers[2] == "Asset Class"
                and "Current Total" in headers
                else None
            )
            continue
        if (
            row[1] == "Data"
            and column_index is not None
            and _normalize_text(row[2]) == _ACCRUAL_SECTION
            and len(row) > column_index
        ):
            return _parse_decimal(
                row[column_index], "NAV Interest Accruals", row_number, warnings
            )
    return None


def _extract_accrual_section(
    rows: list[list[str]],
    warnings: list[str],
) -> dict[str, dict[str, Decimal]]:
    fields_by_currency: dict[str, dict[str, Decimal]] = {}
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 5 or row[0] != _ACCRUAL_SECTION or row[1] != "Data":
            continue
        currency_label = _normalize_text(row[2])
        field_name = _normalize_text(row[3])
        if not currency_label or not field_name:
            continue
        value = _parse_decimal(
            row[4], f"Interest Accruals {field_name}", row_number, warnings
        )
        if value is None:
            continue
        fields_by_currency.setdefault(currency_label, {})[field_name] = value
    return fields_by_currency


def extract_ibkr_interest_accrual_snapshot(
    rows: list[list[str]],
    warnings: list[str],
    *,
    as_of: str,
) -> dict[str, Any] | None:
    """Build a dated accrued-interest snapshot from IBKR statement evidence.

    ``None`` means the statement carries no interest-accrual evidence; callers
    must keep that unknown state rather than inventing a zero accrual.
    """
    nav_value = _extract_nav_interest_accruals(rows, warnings)
    section = _extract_accrual_section(rows, warnings)
    if nav_value is None and not section:
        return None

    base_summary = section.get(_BASE_SUMMARY_LABEL, {})
    ending_balance = base_summary.get(_ENDING_BALANCE_FIELD)
    by_currency: dict[str, dict[str, str]] = {}
    for currency_label, fields in sorted(section.items()):
        if currency_label == _BASE_SUMMARY_LABEL:
            continue
        currency_entry: dict[str, str] = {}
        if _ENDING_BALANCE_FIELD in fields:
            currency_entry["ending_accrual_balance"] = _decimal_to_str(
                fields[_ENDING_BALANCE_FIELD]
            )
        for field_name, value in fields.items():
            if field_name.startswith(_ENDING_BALANCE_IN_BASE_SUFFIX):
                currency_entry["ending_accrual_balance_in_base"] = _decimal_to_str(
                    value
                )
        if currency_entry:
            by_currency[currency_label.upper()] = currency_entry

    normalized_as_of = _normalize_text(as_of)
    status = IBKR_INTEREST_ACCRUAL_REPORTED
    amount: Decimal | None = nav_value if nav_value is not None else ending_balance
    if (
        nav_value is not None
        and ending_balance is not None
        and nav_value != ending_balance
    ):
        warnings.append(
            "IBKR Net Asset Value Interest Accruals did not match the Interest "
            "Accruals Ending Accrual Balance; the accrual was withheld."
        )
        status = IBKR_INTEREST_ACCRUAL_CONFLICT
        amount = None
    elif amount is None:
        status = IBKR_INTEREST_ACCRUAL_INCOMPLETE
    elif not normalized_as_of:
        status = IBKR_INTEREST_ACCRUAL_UNDATED
        amount = None

    return normalize_ibkr_interest_accrual_snapshot(
        {
            "schema_version": IBKR_INTEREST_ACCRUAL_SCHEMA_VERSION,
            "source": IBKR_INTEREST_ACCRUAL_SOURCE,
            "status": status,
            "as_of": normalized_as_of,
            "currency": _extract_ibkr_base_currency(rows),
            "amount": _decimal_to_str(amount) if amount is not None else "",
            "nav_interest_accruals": (
                _decimal_to_str(nav_value) if nav_value is not None else ""
            ),
            "ending_accrual_balance": (
                _decimal_to_str(ending_balance) if ending_balance is not None else ""
            ),
            "by_currency": by_currency,
        }
    )


def _normalize_decimal_text(value: Any) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    try:
        parsed = Decimal(text)
    except (InvalidOperation, ValueError):
        return ""
    return _decimal_to_str(parsed) if parsed.is_finite() else ""


def normalize_ibkr_interest_accrual_snapshot(raw: Any) -> dict[str, Any] | None:
    """Return a canonical snapshot, or ``None`` for unusable input.

    A snapshot is usable as a valuation boundary only when its status is
    ``reported`` and it has an ISO as-of date, a currency, and an amount.
    Every other shape is retained as audit evidence with no amount.
    """
    if not isinstance(raw, dict):
        return None
    status = _normalize_text(raw.get("status"))
    if status not in _IBKR_INTEREST_ACCRUAL_STATUSES:
        return None
    as_of = _normalize_text(raw.get("as_of"))[:10]
    try:
        date.fromisoformat(as_of)
    except ValueError:
        as_of = ""
    currency = _normalize_text(raw.get("currency")).upper()
    amount = _normalize_decimal_text(raw.get("amount"))
    if status == IBKR_INTEREST_ACCRUAL_REPORTED and not (as_of and currency and amount):
        status = IBKR_INTEREST_ACCRUAL_INCOMPLETE
    if status != IBKR_INTEREST_ACCRUAL_REPORTED:
        amount = ""
    by_currency: dict[str, dict[str, str]] = {}
    raw_by_currency = raw.get("by_currency")
    if isinstance(raw_by_currency, dict):
        for raw_currency, raw_fields in sorted(raw_by_currency.items()):
            normalized_currency = _normalize_text(raw_currency).upper()
            if not normalized_currency or not isinstance(raw_fields, dict):
                continue
            fields = {
                field_name: _normalize_decimal_text(raw_fields.get(field_name))
                for field_name in (
                    "ending_accrual_balance",
                    "ending_accrual_balance_in_base",
                )
                if _normalize_decimal_text(raw_fields.get(field_name))
            }
            if fields:
                by_currency[normalized_currency] = fields
    return {
        "schema_version": IBKR_INTEREST_ACCRUAL_SCHEMA_VERSION,
        "source": _normalize_text(raw.get("source")) or IBKR_INTEREST_ACCRUAL_SOURCE,
        "status": status,
        "as_of": as_of,
        "currency": currency,
        "amount": amount,
        "nav_interest_accruals": _normalize_decimal_text(
            raw.get("nav_interest_accruals")
        ),
        "ending_accrual_balance": _normalize_decimal_text(
            raw.get("ending_accrual_balance")
        ),
        "by_currency": by_currency,
    }


def build_interest_accrual_boundaries(
    evidence_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Collapse per-statement evidence into one dated boundary per as-of date.

    Statements that end on the same date must agree. A disagreement, or any
    non-reported snapshot for that date, withholds the boundary amount.
    """
    snapshots_by_as_of: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for evidence in evidence_records:
        snapshot = normalize_ibkr_interest_accrual_snapshot(
            evidence.get("interest_accrual_snapshot")
        )
        if snapshot is None or not snapshot["as_of"]:
            continue
        snapshots_by_as_of.setdefault(snapshot["as_of"], []).append(
            (_normalize_text(evidence.get("evidence_id")), snapshot)
        )

    boundaries: list[dict[str, Any]] = []
    for as_of in sorted(snapshots_by_as_of):
        entries = snapshots_by_as_of[as_of]
        reported = {
            (snapshot["currency"], snapshot["amount"])
            for _evidence_id, snapshot in entries
            if snapshot["status"] == IBKR_INTEREST_ACCRUAL_REPORTED
        }
        is_consistent = len(reported) == 1 and all(
            snapshot["status"] == IBKR_INTEREST_ACCRUAL_REPORTED
            for _evidence_id, snapshot in entries
        )
        currency, amount = next(iter(reported)) if is_consistent else ("", "")
        if is_consistent:
            status = IBKR_INTEREST_ACCRUAL_REPORTED
        elif reported:
            status = IBKR_INTEREST_ACCRUAL_CONFLICT
        else:
            status = entries[0][1]["status"]
        boundaries.append(
            {
                "as_of": as_of,
                "status": status,
                "currency": currency,
                "amount": amount,
                "source": IBKR_INTEREST_ACCRUAL_SOURCE,
                "evidence_ids": sorted(
                    {evidence_id for evidence_id, _snapshot in entries if evidence_id}
                ),
            }
        )
    return boundaries
