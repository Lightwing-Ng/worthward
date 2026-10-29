"""Reconcile provisional thinkorswim workbook trades with Schwab CSV evidence.

Code version: v0.3.0
- Added: Exact-first reconciliation for evidenced limit-price improvements and
  user-confirmed date-only workbook trades, preserving their original evidence.
- Fixed: Original workbook reparses recover consumed references only from
  matching archived immutable row evidence and unchanged economics.
- Added: TOS page buys reconcile like sales, matched only against a Schwab CSV
  trade on the same side.
- Changed: A linked trade blocks only same-side, same-quantity, same-price
  ambiguity; distinct fills at other prices remain importable.
- Fixed: Linked date windows use the actual Hong Kong to New York conversion.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import re
from typing import Any
from zoneinfo import ZoneInfo

from app.services.investment.importing.support import (
    DEFAULT_CONVENTION_TIMEZONE,
    _normalize_text,
    normalize_ticker,
)

import app.services.investment.importing.basics as _ii_basics


_TOS_PAGE_TRADE_REFERENCE = re.compile(
    r"TOS-PAGE-(?P<date>\d{8})-(?P<time>\d{6})-"
    r"(?P<ticker>[A-Z0-9][A-Z0-9.-]*)-(?P<side>BUY|SELL)-\d+",
    re.IGNORECASE,
)
_TRADE_SIDES = {"buy", "sell"}
_TOS_PAGE_TIMEZONE = ZoneInfo("Asia/Hong_Kong")
_LEDGER_TIMEZONE = ZoneInfo(DEFAULT_CONVENTION_TIMEZONE)


def _record_source(record: dict[str, Any]) -> dict[str, Any]:
    source = record.get("source")
    return source if isinstance(source, dict) else {}


def _record_account(record: dict[str, Any]) -> str:
    return _normalize_text(
        record.get("account") or _record_source(record).get("account")
    )


def _trade_side(record: dict[str, Any]) -> str:
    side = _normalize_text(record.get("type")).lower()
    return side if side in _TRADE_SIDES else ""


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
        or not _trade_side(record)
        or _normalize_text(source.get("file_kind"))
        not in {"manual_investment_xlsx", "zircon_hk_manual_xlsx"}
        or _normalize_text(source.get("source_timezone")) != "Asia/Hong_Kong"
    ):
        return ""
    reference = _normalize_text(source.get("reference_id"))
    if (
        reference.upper().startswith("USER-REPORTED-")
        and source.get("source_has_intraday_timestamp") is False
        and _normalize_text(source.get("datetime_precision")) == "day"
        and _normalize_text(source.get("execution_evidence_source"))
        == "user_confirmed_trade_report"
        and source.get("requires_manual_official_reconciliation") is True
        and _record_account(record)
        and _positive_absolute_decimal(record.get("quantity_raw")) is not None
        and _positive_absolute_decimal(record.get("price_raw")) is not None
    ):
        return reference
    match = _TOS_PAGE_TRADE_REFERENCE.fullmatch(reference)
    if (
        match is None
        or match.group("side").lower() != _trade_side(record)
        or source.get("source_time_defaulted_to_2300") is True
        or source.get("source_has_intraday_timestamp") is False
    ):
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
        _trade_side(record),
        _normalize_text(record.get("date")),
        _normalize_text(source.get("source_datetime_raw"))[:10],
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("currency")).upper(),
        str(_positive_absolute_decimal(record.get("quantity_raw"))),
        str(_positive_absolute_decimal(record.get("price_raw"))),
    )


def _official_trade(record: dict[str, Any]) -> bool:
    source = _record_source(record)
    return (
        _ii_basics._normalize_broker_code(record.get("broker")) == "schwab"
        and bool(_trade_side(record))
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
        _trade_side(record),
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
    """Return the same-side trade scope followed by its exact fill economics."""
    return (
        _record_account(record),
        _trade_side(record),
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("currency")).upper(),
        _positive_absolute_decimal(record.get("quantity_raw")),
        _positive_absolute_decimal(record.get("price_raw")),
    )


def _linked_trade_dates(record: dict[str, Any]) -> set[str]:
    linked_date = _normalize_text(record.get("date"))
    reference = _normalize_text(
        _record_source(record).get("superseded_manual_reference_id")
    )
    match = _TOS_PAGE_TRADE_REFERENCE.fullmatch(reference)
    if match is None:
        archived = _record_source(record).get("superseded_manual_trade")
        if isinstance(archived, dict) and _provisional_reference(archived) == reference:
            return {linked_date, *_eligible_official_dates(archived)}
        return {linked_date}
    try:
        page_datetime = datetime.strptime(
            f"{match.group('date')}{match.group('time')}", "%Y%m%d%H%M%S"
        ).replace(tzinfo=_TOS_PAGE_TIMEZONE)
        ledger_date = page_datetime.astimezone(_LEDGER_TIMEZONE).date()
    except (ValueError, OverflowError):
        return {linked_date}
    # Rebuild the original candidate dates, including seasonal UTC offsets.
    # Same-day captures must not acquire an unrelated previous-day candidate.
    return {
        linked_date,
        page_datetime.date().isoformat(),
        ledger_date.isoformat(),
    }


def _reject_conflicting_linked_csv_trades(
    official_rows: list[tuple[int, int, dict[str, Any]]],
) -> None:
    # A distinct fill at another price is a separate trade. A second identity
    # at the linked quantity and price cannot be told apart from a revision.
    linked_scopes = {
        (_official_scope(row), frozenset(_linked_trade_dates(row)))
        for _, _, row in official_rows
        if _normalize_text(_record_source(row).get("superseded_manual_reference_id"))
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
                "A linked provisional Schwab trade has another CSV row with conflicting or ambiguous economics; review before importing."
            )
    for linked_side, _, linked_row in official_rows:
        if not _normalize_text(
            _record_source(linked_row).get("superseded_manual_reference_id")
        ):
            continue
        linked_scope = _official_scope(linked_row)
        eligible_dates = _linked_trade_dates(linked_row)
        other_side_rows = [
            row
            for side, _, row in official_rows
            if side != linked_side
            and _official_scope(row)[:4] == linked_scope[:4]
            and _normalize_text(row.get("date")) in eligible_dates
        ]
        if other_side_rows and not any(
            _official_identity(row) == _official_identity(linked_row)
            for row in other_side_rows
        ):
            raise ValueError(
                "A linked provisional Schwab trade has another CSV row with conflicting or ambiguous economics; review before importing."
            )


def _eligible_official_dates(record: dict[str, Any]) -> set[str]:
    source = _record_source(record)
    ledger_date = _normalize_text(record.get("date"))
    source_date = _normalize_text(source.get("source_datetime_raw"))[:10]
    try:
        if (
            abs(
                (date.fromisoformat(source_date) - date.fromisoformat(ledger_date)).days
            )
            > 1
        ):
            return {ledger_date}
    except ValueError:
        return {ledger_date}
    return {ledger_date, source_date}


def _official_execution_time_matches(
    manual: dict[str, Any], official: dict[str, Any]
) -> bool:
    if _record_source(manual).get("source_has_intraday_timestamp") is False:
        return True
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


def _has_evidenced_limit_price(record: dict[str, Any]) -> bool:
    source = _record_source(record)
    return (
        _normalize_text(source.get("order_type")).lower() == "limit"
        and _normalize_text(source.get("execution_status")).upper() == "FILLED"
        and _positive_absolute_decimal(source.get("limit_price_raw"))
        == _positive_absolute_decimal(record.get("price_raw"))
    )


def _candidate_identities(
    candidates: list[tuple[int, int, dict[str, Any]]],
) -> dict[tuple[str, ...], list[tuple[int, int, dict[str, Any]]]]:
    groups: dict[tuple[str, ...], list[tuple[int, int, dict[str, Any]]]] = defaultdict(
        list
    )
    for candidate in candidates:
        groups[_official_identity(candidate[2])].append(candidate)
    return groups


def _unique_candidate(
    candidates: list[tuple[int, int, dict[str, Any]]],
) -> tuple[tuple[str, ...], list[tuple[int, int, dict[str, Any]]]]:
    groups = _candidate_identities(candidates)
    count = sum(
        max(
            sum(side == 0 for side, _, _ in rows),
            sum(side == 1 for side, _, _ in rows),
        )
        for rows in groups.values()
    )
    if count != 1:
        raise ValueError(
            "A provisional Schwab trade has ambiguous broker CSV matches; review the trade before importing."
        )
    identity = next(iter(groups))
    return identity, groups[identity]


def _manual_workbook_identity(record: dict[str, Any]) -> tuple[str, str, int] | None:
    source = _record_source(record)
    if _normalize_text(source.get("file_kind")) not in {
        "manual_investment_xlsx",
        "zircon_hk_manual_xlsx",
    }:
        return None
    digest = _normalize_text(source.get("source_file_sha256")).lower()
    sheet = _normalize_text(source.get("source_sheet"))
    row_text = _normalize_text(source.get("source_row"))
    if (
        not re.fullmatch(r"[0-9a-f]{64}", digest)
        or not sheet
        or not re.fullmatch(r"[1-9][0-9]*", row_text)
    ):
        return None
    return digest, sheet, int(row_text)


def _finite_decimal(value: Any) -> Decimal | None:
    try:
        result = Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return result if result.is_finite() else None


def _manual_economics(record: dict[str, Any]) -> tuple[Any, ...] | None:
    normalized = record.get("normalized")
    normalized = normalized if isinstance(normalized, dict) else {}
    values = []
    for raw, field in (
        ("quantity_raw", "position_quantity"),
        ("price_raw", "unit_price"),
        ("gross_amount_raw", "gross_amount"),
        ("net_amount_raw", "net_amount"),
    ):
        value = _finite_decimal(record.get(raw, normalized.get(field)))
        if value is None:
            return None
        values.append(value)
    quantity, price, gross, net = values
    raw_fee = record.get("commission_raw")
    if raw_fee is None or _normalize_text(raw_fee) == "":
        magnitude = _finite_decimal(normalized.get("commission", "0"))
        fee = -abs(magnitude) if magnitude is not None else None
    else:
        fee = _finite_decimal(raw_fee)
    if fee is None:
        return None
    defaults = {
        "position_quantity": quantity,
        "display_quantity": abs(quantity),
        "unit_price": price,
        "gross_amount": gross,
        "display_amount": abs(gross),
        "net_amount": net,
        "accounting_adjustment_amount": net,
        "commission": abs(fee),
        "commission_display": abs(fee),
    }
    normalized_values = []
    for field, default in defaults.items():
        value = _finite_decimal(normalized.get(field, default))
        if value is None:
            return None
        normalized_values.append(value)
    return (
        *values,
        fee,
        *normalized_values,
        _normalize_text(normalized.get("side") or _trade_side(record)).lower(),
        normalized.get("is_cash_flow", False),
    )


def _verified_consumed_manual_replay(
    record: dict[str, Any],
    reference: str,
    linked_rows: list[tuple[int, int, dict[str, Any]]],
) -> dict[str, Any]:
    """Recover omitted parser enrichment, never a changed consumed workbook row."""
    _identity, candidates = _unique_candidate(linked_rows)
    archives = [
        _record_source(row).get("superseded_manual_trade") for _, _, row in candidates
    ]
    if (
        all(archive is None for archive in archives)
        and _TOS_PAGE_TRADE_REFERENCE.fullmatch(reference)
        and _provisional_reference(record) == reference
    ):
        # Older exact TOS links predate the full archive. Their recognized
        # replay still passes the existing strict execution/revision guards.
        return record
    identity = _manual_workbook_identity(record)
    economics = _manual_economics(record)
    source = _record_source(record)
    for (_, _, linked), archived in zip(candidates, archives, strict=True):
        archived_source = _record_source(archived) if isinstance(archived, dict) else {}
        valid = (
            isinstance(archived, dict)
            and _provisional_reference(archived) == reference
            and identity is not None
            and identity == _manual_workbook_identity(archived)
            and _normalize_text(
                _record_source(linked).get("superseded_manual_source_sha256")
            ).lower()
            == identity[0]
            and economics is not None
            and economics == _manual_economics(archived)
            and _provisional_signature(record) == _provisional_signature(archived)
            and _ii_basics._normalize_broker_code(record.get("broker"))
            == _ii_basics._normalize_broker_code(archived.get("broker"))
            and _normalize_text(record.get("datetime")).replace("T", " ")
            == _normalize_text(archived.get("datetime")).replace("T", " ")
            and _normalize_text(source.get("source_datetime_raw")).replace("T", " ")
            == _normalize_text(archived_source.get("source_datetime_raw")).replace(
                "T", " "
            )
            and _normalize_text(source.get("source_timezone"))
            == _normalize_text(archived_source.get("source_timezone"))
        )
        for field in (
            "source_has_intraday_timestamp",
            "datetime_precision",
            "execution_time_precision",
            "source_time_defaulted_to_2300",
            "execution_evidence_source",
            "requires_manual_official_reconciliation",
            "order_type",
            "limit_price_raw",
            "execution_status",
        ):
            if field in source and source[field] != archived_source.get(field):
                valid = False
        if not valid:
            raise ValueError(
                "A consumed provisional Schwab reference conflicts with its archived manual workbook identity or economics; review before importing."
            )
    return archives[0]


def _annotate_official_candidates(
    reference: str,
    manual: dict[str, Any],
    candidates: list[tuple[int, int, dict[str, Any]]],
    method: str,
    annotated: dict[tuple[int, int], dict[str, Any]],
) -> None:
    manual_source = _record_source(manual)
    for side, index, row in candidates:
        if not _official_execution_time_matches(manual, row):
            raise ValueError(
                "A provisional Schwab trade conflicts with the broker CSV execution time; review the trade before importing."
            )
        updated = dict(row)
        source = dict(_record_source(row))
        linked_reference = _normalize_text(source.get("superseded_manual_reference_id"))
        if linked_reference and linked_reference != reference:
            raise ValueError(
                "A provisional Schwab trade conflicts with an existing broker CSV reconciliation."
            )
        source["superseded_manual_reference_id"] = reference
        manual_sha = _normalize_text(manual_source.get("source_file_sha256"))
        if manual_sha:
            source.setdefault("superseded_manual_source_sha256", manual_sha)
        source.setdefault(
            "superseded_manual_source_datetime_raw",
            _normalize_text(manual_source.get("source_datetime_raw")),
        )
        source.setdefault(
            "superseded_manual_source_timezone",
            _normalize_text(manual_source.get("source_timezone")),
        )
        source.setdefault(
            "superseded_manual_datetime_precision",
            _normalize_text(manual_source.get("datetime_precision"))
            or _normalize_text(manual_source.get("execution_time_precision"))
            or "intraday",
        )
        source.setdefault(
            "superseded_manual_eligible_dates", sorted(_eligible_official_dates(manual))
        )
        source.setdefault("superseded_manual_trade", dict(manual))
        source.setdefault("schwab_provisional_match_method", method)
        updated["source"] = source
        annotated[(side, index)] = updated


def reconcile_schwab_provisional_trades(
    existing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Reserve exact fills before matching explicitly evidenced limit prices."""
    sides = (existing, incoming)
    provisional_groups: dict[str, list[tuple[int, int, dict[str, Any]]]] = defaultdict(
        list
    )
    official_rows: list[tuple[int, int, dict[str, Any]]] = []
    for side, records in enumerate(sides):
        for index, record in enumerate(records):
            if _official_trade(record):
                official_rows.append((side, index, record))
    _reject_conflicting_linked_csv_trades(official_rows)
    linked_by_reference: dict[str, list[tuple[int, int, dict[str, Any]]]] = defaultdict(
        list
    )
    for candidate in official_rows:
        linked = _normalize_text(
            _record_source(candidate[2]).get("superseded_manual_reference_id")
        )
        if linked:
            linked_by_reference[linked].append(candidate)
    consumed_workbook_rows: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    for reference, linked_rows in linked_by_reference.items():
        for _, _, linked in linked_rows:
            archived = _record_source(linked).get("superseded_manual_trade")
            if (
                not isinstance(archived, dict)
                or _provisional_reference(archived) != reference
            ):
                continue
            identity = _manual_workbook_identity(archived)
            if (
                identity is not None
                and _normalize_text(
                    _record_source(linked).get("superseded_manual_source_sha256")
                ).lower()
                == identity[0]
            ):
                consumed_workbook_rows[identity].add(reference)
    for side, records in enumerate(sides):
        for index, record in enumerate(records):
            reference = _provisional_reference(record)
            raw_reference = _normalize_text(_record_source(record).get("reference_id"))
            manual = record
            workbook_identity = _manual_workbook_identity(record)
            consumed_references = consumed_workbook_rows.get(workbook_identity, set())
            if consumed_references and consumed_references != {raw_reference}:
                raise ValueError(
                    "A consumed provisional Schwab reference conflicts with its archived manual workbook identity or economics; review before importing."
                )
            if (
                raw_reference in linked_by_reference
                and (
                    _ii_basics._normalize_broker_code(record.get("broker")) == "schwab"
                    or bool(consumed_references)
                )
                and not _official_trade(record)
            ):
                manual = _verified_consumed_manual_replay(
                    record, raw_reference, linked_by_reference[raw_reference]
                )
                reference = raw_reference
            if reference:
                provisional_groups[reference].append((side, index, manual))

    removed: set[tuple[int, int]] = set()
    claimed_official_ids: set[tuple[str, ...]] = set()
    annotated: dict[tuple[int, int], dict[str, Any]] = {}
    reserved_official_ids = {
        _official_identity(row): _normalize_text(
            _record_source(row).get("superseded_manual_reference_id")
        )
        for _, _, row in official_rows
        if _normalize_text(_record_source(row).get("superseded_manual_reference_id"))
    }
    pending = []
    for reference, manual_rows in provisional_groups.items():
        signatures = {_provisional_signature(row) for _, _, row in manual_rows}
        if len(signatures) != 1:
            raise ValueError(
                "A provisional Schwab trade has conflicting manual workbook rows; review the trade before importing."
            )
        manual = manual_rows[0][2]
        manual_side = _trade_side(manual)
        manual_account = _record_account(manual)
        manual_ticker = normalize_ticker(_normalize_text(manual.get("ticker")))
        manual_currency = _normalize_text(manual.get("currency")).upper()
        eligible_dates = _eligible_official_dates(manual)
        scoped_candidates = [
            (side, index, row)
            for side, index, row in official_rows
            if _record_account(row) == manual_account
            and _trade_side(row) == manual_side
            and normalize_ticker(_normalize_text(row.get("ticker"))) == manual_ticker
            and _normalize_text(row.get("currency")).upper() == manual_currency
            and _normalize_text(row.get("date")) in eligible_dates
        ]
        prior_links = [
            (side, index, row)
            for side, index, row in official_rows
            if _normalize_text(
                _record_source(row).get("superseded_manual_reference_id")
            )
            == reference
        ]
        scoped_indexes = {(side, index) for side, index, _ in scoped_candidates}
        if any((side, index) not in scoped_indexes for side, index, _ in prior_links):
            raise ValueError(
                "A provisional Schwab trade conflicts with an existing broker CSV reconciliation."
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
        if not candidates and prior_links:
            archived_manuals = [
                _record_source(row).get("superseded_manual_trade")
                for _, _, row in prior_links
            ]
            if all(
                isinstance(archived, dict)
                and _provisional_signature(archived) == _provisional_signature(manual)
                for archived in archived_manuals
            ):
                candidates = prior_links
        if not candidates:
            pending.append((reference, manual_rows, scoped_candidates))
            continue
        candidates = list(
            {
                (side, index): (side, index, row)
                for side, index, row in [*candidates, *prior_links]
            }.values()
        )
        official_id, candidates = _unique_candidate(candidates)
        reserved_reference = reserved_official_ids.get(official_id)
        if official_id in claimed_official_ids or (
            reserved_reference and reserved_reference != reference
        ):
            raise ValueError(
                "A provisional Schwab trade shares its broker CSV match with another manual trade."
            )
        claimed_official_ids.add(official_id)
        _annotate_official_candidates(reference, manual, candidates, "exact", annotated)
        removed.update((side, index) for side, index, _ in manual_rows)

    improvement_plans = []
    for reference, manual_rows, scoped_candidates in pending:
        manual = manual_rows[0][2]
        if not all(_has_evidenced_limit_price(row) for _, _, row in manual_rows):
            raise ValueError(
                "A provisional Schwab trade conflicts with the broker CSV quantity or price; review the trade before importing."
            )
        quantity = _positive_absolute_decimal(manual.get("quantity_raw"))
        limit_price = _positive_absolute_decimal(manual.get("price_raw"))
        candidates = []
        for side, index, row in scoped_candidates:
            identity = _official_identity(row)
            price = _positive_absolute_decimal(row.get("price_raw"))
            if (
                identity in claimed_official_ids
                or identity in reserved_official_ids
                or _positive_absolute_decimal(row.get("quantity_raw")) != quantity
                or price is None
                or limit_price is None
            ):
                continue
            improves = (
                price < limit_price
                if _trade_side(manual) == "buy"
                else price > limit_price
            )
            if improves:
                candidates.append((side, index, row))
        if not candidates:
            raise ValueError(
                "A provisional Schwab trade conflicts with the broker CSV quantity or price; review the trade before importing."
            )
        official_id, candidates = _unique_candidate(candidates)
        improvement_plans.append((reference, manual_rows, official_id, candidates))

    for reference, manual_rows, official_id, candidates in improvement_plans:
        if official_id in claimed_official_ids:
            raise ValueError(
                "A provisional Schwab trade shares its broker CSV match with another manual trade."
            )
        claimed_official_ids.add(official_id)
        _annotate_official_candidates(
            reference,
            manual_rows[0][2],
            candidates,
            "limit_price_improvement",
            annotated,
        )
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
