"""Reconcile provisional thinkorswim workbook sales with Schwab CSV evidence.

Code version: v0.1.0
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re
from typing import Any

from app.services.investment.importing.support import _normalize_text, normalize_ticker

import app.services.investment.importing.basics as _ii_basics


_TOS_PAGE_SALE_REFERENCE = re.compile(
    r"TOS-PAGE-(?P<date>\d{8})-(?P<time>\d{6})-"
    r"(?P<ticker>[A-Z0-9][A-Z0-9.-]*)-SELL-\d+",
    re.IGNORECASE,
)


def _record_source(record: dict[str, Any]) -> dict[str, Any]:
    source = record.get("source")
    return source if isinstance(source, dict) else {}


def _record_account(record: dict[str, Any]) -> str:
    return _normalize_text(record.get("account") or _record_source(record).get("account"))


def _positive_absolute_decimal(value: Any) -> Decimal | None:
    try:
        result = abs(Decimal(_normalize_text(value).replace(",", "")))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return result if result.is_finite() and result > 0 else None


def _provisional_reference(record: dict[str, Any]) -> str:
    source = _record_source(record)
    if (
        _ii_basics._normalize_broker_code(record.get("broker")) != "schwab"
        or _normalize_text(record.get("type")).lower() != "sell"
        or _normalize_text(source.get("file_kind")) != "manual_investment_xlsx"
        or _normalize_text(source.get("source_timezone")) != "Asia/Hong_Kong"
    ):
        return ""
    reference = _normalize_text(source.get("reference_id"))
    match = _TOS_PAGE_SALE_REFERENCE.fullmatch(reference)
    if match is None:
        return ""
    source_datetime = _normalize_text(source.get("source_datetime_raw"))
    if (
        source_datetime[:10].replace("-", "") != match.group("date")
        or source_datetime[11:19].replace(":", "") != match.group("time")
        or normalize_ticker(match.group("ticker"))
        != normalize_ticker(_normalize_text(record.get("ticker")))
        or not _record_account(record)
        or _positive_absolute_decimal(record.get("quantity_raw")) is None
        or _positive_absolute_decimal(record.get("price_raw")) is None
    ):
        return ""
    return reference


def _provisional_signature(record: dict[str, Any]) -> tuple[str, ...]:
    source = _record_source(record)
    return (
        _record_account(record),
        _normalize_text(record.get("date")),
        _normalize_text(source.get("source_datetime_raw"))[:10],
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("currency")).upper(),
        str(_positive_absolute_decimal(record.get("quantity_raw"))),
        str(_positive_absolute_decimal(record.get("price_raw"))),
    )


def _official_sale(record: dict[str, Any]) -> bool:
    source = _record_source(record)
    return (
        _ii_basics._normalize_broker_code(record.get("broker")) == "schwab"
        and _normalize_text(record.get("type")).lower() == "sell"
        and _normalize_text(source.get("file_kind")) == "schwab_csv"
        and bool(_record_account(record))
    )


def _official_identity(record: dict[str, Any]) -> tuple[str, ...]:
    source = _record_source(record)
    precise_datetime = (
        _normalize_text(record.get("datetime"))
        if source.get("source_has_intraday_timestamp") is True
        else ""
    )
    return (
        _record_account(record),
        _normalize_text(record.get("date")),
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("currency")).upper(),
        _normalize_text(record.get("description")),
        precise_datetime,
        *(
            _ii_basics._normalize_decimal_identity_token(record.get(field))
            for field in (
                "quantity_raw",
                "price_raw",
                "gross_amount_raw",
                "commission_raw",
                "net_amount_raw",
            )
        ),
    )


def _official_scope(record: dict[str, Any]) -> tuple[Any, ...]:
    return (
        _record_account(record),
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("currency")).upper(),
        _positive_absolute_decimal(record.get("quantity_raw")),
    )


def _linked_sale_dates(record: dict[str, Any]) -> set[str]:
    linked_date = _normalize_text(record.get("date"))
    reference = _normalize_text(
        _record_source(record).get("superseded_manual_reference_id")
    )
    match = _TOS_PAGE_SALE_REFERENCE.fullmatch(reference)
    if match is None:
        return {linked_date}
    raw_date = match.group("date")
    try:
        page_date = date.fromisoformat(
            f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
        )
    except ValueError:
        return {linked_date}
    return {
        linked_date,
        page_date.isoformat(),
        (page_date - timedelta(days=1)).isoformat(),
    }


def _reject_conflicting_linked_csv_sales(
    official_rows: list[tuple[int, int, dict[str, Any]]],
) -> None:
    linked_scopes = {
        (_official_scope(row), frozenset(_linked_sale_dates(row)))
        for _, _, row in official_rows
        if _normalize_text(
            _record_source(row).get("superseded_manual_reference_id")
        )
    }
    for scope, eligible_dates in linked_scopes:
        identities_by_side: dict[tuple[str, ...], dict[int, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        for side, _, row in official_rows:
            if (
                _official_scope(row) == scope
                and _normalize_text(row.get("date")) in eligible_dates
            ):
                identities_by_side[_official_identity(row)][side] += 1
        if sum(max(counts.values()) for counts in identities_by_side.values()) > 1:
            raise ValueError(
                "A linked provisional Schwab sale has another CSV row with conflicting or ambiguous economics; review before importing."
            )
    for linked_side, _, linked_row in official_rows:
        if not _normalize_text(
            _record_source(linked_row).get("superseded_manual_reference_id")
        ):
            continue
        linked_scope = _official_scope(linked_row)
        eligible_dates = _linked_sale_dates(linked_row)
        other_side_rows = [
            row
            for side, _, row in official_rows
            if side != linked_side
            and _official_scope(row)[:3] == linked_scope[:3]
            and _normalize_text(row.get("date")) in eligible_dates
        ]
        if other_side_rows and not any(
            _official_identity(row) == _official_identity(linked_row)
            for row in other_side_rows
        ):
            raise ValueError(
                "A linked provisional Schwab sale has another CSV row with conflicting or ambiguous economics; review before importing."
            )


def _eligible_official_dates(record: dict[str, Any]) -> set[str]:
    source = _record_source(record)
    ledger_date = _normalize_text(record.get("date"))
    source_date = _normalize_text(source.get("source_datetime_raw"))[:10]
    try:
        if abs((date.fromisoformat(source_date) - date.fromisoformat(ledger_date)).days) > 1:
            return {ledger_date}
    except ValueError:
        return {ledger_date}
    return {ledger_date, source_date}


def _official_execution_time_matches(
    manual: dict[str, Any], official: dict[str, Any]
) -> bool:
    source = _record_source(official)
    if source.get("source_has_intraday_timestamp") is not True:
        return True
    official_datetime = _normalize_text(official.get("datetime")).replace("T", " ")
    manual_datetimes = {
        _normalize_text(manual.get("datetime")).replace("T", " "),
        _normalize_text(_record_source(manual).get("source_datetime_raw")).replace(
            "T", " "
        ),
    }
    return bool(official_datetime and official_datetime in manual_datetimes)


def reconcile_schwab_provisional_sales(
    existing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Replace only a unique TOS page sale with its broker CSV transaction."""
    sides = (existing, incoming)
    provisional_groups: dict[str, list[tuple[int, int, dict[str, Any]]]] = defaultdict(list)
    official_rows: list[tuple[int, int, dict[str, Any]]] = []
    for side, records in enumerate(sides):
        for index, record in enumerate(records):
            reference = _provisional_reference(record)
            if reference:
                provisional_groups[reference].append((side, index, record))
            if _official_sale(record):
                official_rows.append((side, index, record))
    _reject_conflicting_linked_csv_sales(official_rows)

    removed: set[tuple[int, int]] = set()
    claimed_official_ids: set[tuple[str, ...]] = set()
    annotated: dict[tuple[int, int], dict[str, Any]] = {}
    for reference, manual_rows in provisional_groups.items():
        signatures = {_provisional_signature(row) for _, _, row in manual_rows}
        if len(signatures) != 1:
            raise ValueError(
                "A provisional Schwab sale has conflicting manual workbook rows; review the trade before importing."
            )
        manual = manual_rows[0][2]
        manual_account = _record_account(manual)
        manual_ticker = normalize_ticker(_normalize_text(manual.get("ticker")))
        manual_currency = _normalize_text(manual.get("currency")).upper()
        eligible_dates = _eligible_official_dates(manual)
        scoped_candidates = [
            (side, index, row)
            for side, index, row in official_rows
            if _record_account(row) == manual_account
            and normalize_ticker(_normalize_text(row.get("ticker"))) == manual_ticker
            and _normalize_text(row.get("currency")).upper() == manual_currency
            and _normalize_text(row.get("date")) in eligible_dates
        ]
        prior_links = [
            (side, index, row)
            for side, index, row in official_rows
            if _normalize_text(_record_source(row).get("superseded_manual_reference_id"))
            == reference
        ]
        scoped_indexes = {(side, index) for side, index, _ in scoped_candidates}
        if any(
            (side, index) not in scoped_indexes
            for side, index, _ in prior_links
        ):
            raise ValueError(
                "A provisional Schwab sale conflicts with an existing broker CSV reconciliation."
            )
        if not scoped_candidates:
            continue
        manual_quantity = _positive_absolute_decimal(manual.get("quantity_raw"))
        manual_price = _positive_absolute_decimal(manual.get("price_raw"))
        candidates = [
            (side, index, row)
            for side, index, row in scoped_candidates
            if _positive_absolute_decimal(row.get("quantity_raw")) == manual_quantity
            and _positive_absolute_decimal(row.get("price_raw")) == manual_price
        ]
        if not candidates:
            raise ValueError(
                "A provisional Schwab sale conflicts with the broker CSV quantity or price; review the trade before importing."
            )
        candidates = list(
            {
                (side, index): (side, index, row)
                for side, index, row in [*candidates, *prior_links]
            }.values()
        )
        candidates_by_identity: dict[
            tuple[str, ...], dict[int, list[tuple[int, int, dict[str, Any]]]]
        ] = defaultdict(lambda: defaultdict(list))
        for side, index, row in candidates:
            candidates_by_identity[_official_identity(row)][side].append(
                (side, index, row)
            )
        candidate_count = sum(
            max(len(by_side.get(0, [])), len(by_side.get(1, [])))
            for by_side in candidates_by_identity.values()
        )
        if candidate_count != 1:
            raise ValueError(
                "A provisional Schwab sale has ambiguous broker CSV matches; review the trade before importing."
            )
        official_id = next(iter(candidates_by_identity))
        if official_id in claimed_official_ids:
            raise ValueError(
                "A provisional Schwab sale shares its broker CSV match with another manual sale."
            )
        claimed_official_ids.add(official_id)
        if not all(
            _official_execution_time_matches(manual, row)
            for _, _, row in candidates
        ):
            raise ValueError(
                "A provisional Schwab sale conflicts with the broker CSV execution time; review the trade before importing."
            )
        manual_sha = _normalize_text(
            _record_source(manual).get("source_file_sha256")
        )
        for side, index, row in candidates:
            updated = dict(row)
            source = dict(_record_source(row))
            linked_reference = _normalize_text(
                source.get("superseded_manual_reference_id")
            )
            if linked_reference and linked_reference != reference:
                raise ValueError(
                    "A provisional Schwab sale conflicts with an existing broker CSV reconciliation."
                )
            source["superseded_manual_reference_id"] = reference
            if manual_sha:
                source.setdefault("superseded_manual_source_sha256", manual_sha)
            updated["source"] = source
            annotated[(side, index)] = updated
        removed.update((side, index) for side, index, _ in manual_rows)

    result = []
    for side, records in enumerate(sides):
        result.append(
            [
                annotated.get((side, index), record)
                for index, record in enumerate(records)
                if (side, index) not in removed
            ]
        )
    return result[0], result[1], len(removed)
