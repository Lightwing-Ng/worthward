"""Validate merged Schwab quantities against the paired native boundary.

Code version: v1.0.1
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

import app.services.investment.importing.basics as _ii_basics
import app.services.investment.importing.records as _ii_records
from app.services.investment.importing.support import (
    DEFAULT_CONVENTION_TIMEZONE,
    _normalize_text,
)


_LEDGER_TIMEZONE = ZoneInfo(DEFAULT_CONVENTION_TIMEZONE)
_POSITION_TYPES = {
    "buy",
    "sell",
    "grant",
    "dividend_reinvestment",
    "transfer_in",
    "transfer_out",
}
_UNSUPPORTED_SPLIT_TYPES = {"split", "stock_split", "reverse_split"}


def _source(record: dict[str, Any]) -> dict[str, Any]:
    source = record.get("source")
    return source if isinstance(source, dict) else {}


def _account(record: dict[str, Any]) -> str:
    return _normalize_text(record.get("account") or _source(record).get("account"))


def _ledger_datetime(value: Any) -> datetime | None:
    text = _normalize_text(value)
    if len(text) <= 10:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_LEDGER_TIMEZONE)
    return parsed.astimezone(_LEDGER_TIMEZONE)


def _snapshot_boundary(
    snapshot: dict[str, Any], summary: dict[str, Any]
) -> tuple[date, datetime | None, str] | None:
    values = {
        _normalize_text(entry.get("as_of_timestamp") or entry.get("as_of"))
        for entry in snapshot.values()
        if isinstance(entry, dict)
        and _normalize_text(entry.get("as_of_timestamp") or entry.get("as_of"))
    }
    if not values:
        fallback = _normalize_text(summary.get("position_snapshot_as_of"))
        if fallback:
            values.add(fallback)
    if len(values) != 1:
        return None
    value = next(iter(values))
    precise = _ledger_datetime(value)
    try:
        day = precise.date() if precise is not None else date.fromisoformat(value)
    except ValueError:
        return None
    return day, precise, value


def _has_intraday_evidence(record: dict[str, Any]) -> bool:
    source = _source(record)
    timestamp_flag = source.get("source_has_intraday_timestamp")
    if timestamp_flag is False or _normalize_text(timestamp_flag).lower() == "false":
        return False
    if timestamp_flag is True or _normalize_text(timestamp_flag).lower() == "true":
        return True
    precision = _normalize_text(
        source.get("datetime_precision") or source.get("execution_time_precision")
    ).lower()
    if precision == "day" or source.get("source_time_defaulted_to_2300") is True:
        return False
    return precision in {"second", "minute", "intraday"} or (
        source.get("file_kind") == "manual_investment_xlsx"
        and source.get("source_time_defaulted_to_2300") is False
    )


def _native_identity(record: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        _normalize_text(record.get(field))
        for field in (
            "date",
            "datetime",
            "type",
            "ticker",
            "quantity_raw",
            "price_raw",
            "commission_raw",
            "net_amount_raw",
        )
    )


def _has_paired_artifacts(payload: dict[str, Any], account: str) -> bool:
    bundles: dict[str, set[str]] = {}
    artifacts = payload.get("source_artifacts")
    if not isinstance(artifacts, list):
        return False
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        if _ii_basics._normalize_broker_code(artifact.get("broker")) != "schwab":
            continue
        artifact_account = _normalize_text(artifact.get("account"))
        if not artifact_account or not _ii_basics._accounts_are_compatible(
            "schwab", account, artifact_account
        ):
            continue
        kind = _normalize_text(artifact.get("source_kind"))
        if kind not in {"schwab_transactions_csv", "schwab_positions_csv"}:
            continue
        bundle = _normalize_text(artifact.get("bundle_id"))
        if bundle:
            bundles.setdefault(bundle, set()).add(kind)
    return any(
        kinds == {"schwab_transactions_csv", "schwab_positions_csv"}
        for kinds in bundles.values()
    )


def _scoped_rows_as_of(
    payload: dict[str, Any],
    account: str,
    boundary: tuple[date, datetime | None, str],
    native_identities: set[tuple[str, ...]],
) -> tuple[list[dict[str, Any]], int] | None:
    boundary_day, boundary_time, _as_of = boundary
    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        return None
    scoped: list[dict[str, Any]] = []
    excluded = 0
    for record in transactions:
        if not isinstance(record, dict):
            continue
        source = _source(record)
        broker = _ii_basics._normalize_broker_code(
            record.get("broker") or source.get("broker")
        )
        kind = _normalize_text(record.get("type")).lower()
        if broker != "schwab" or kind not in _POSITION_TYPES | _UNSUPPORTED_SPLIT_TYPES:
            continue
        record_account = _account(record)
        if not record_account:
            return None
        if not _ii_basics._accounts_are_compatible("schwab", account, record_account):
            continue
        try:
            booking_day = date.fromisoformat(_normalize_text(record.get("date")))
        except ValueError:
            return None
        if booking_day > boundary_day:
            excluded += 1
            continue
        if (
            booking_day == boundary_day
            and boundary_time
            and _has_intraday_evidence(record)
        ):
            executed = _ledger_datetime(record.get("datetime"))
            if executed is None:
                return None
            if executed > boundary_time:
                same_minute = executed.replace(
                    second=0, microsecond=0
                ) == boundary_time.replace(second=0, microsecond=0)
                if same_minute:
                    # The native Positions heading is precise only to a minute.
                    # Its own paired rows are covered; an unrelated same-minute
                    # execution cannot be placed on either side of that boundary.
                    if (
                        _source(record).get("file_kind") != "schwab_csv"
                        or _native_identity(record) not in native_identities
                    ):
                        return None
                else:
                    excluded += 1
                    continue
        if kind in _UNSUPPORTED_SPLIT_TYPES:
            return None
        scoped.append(record)
    return scoped, excluded


def _has_newer_selected_snapshot(
    payload: dict[str, Any],
    account: str,
    incoming_boundary: tuple[date, datetime | None, str],
) -> bool:
    summaries = payload.get("broker_summaries")
    selected = summaries.get("schwab") if isinstance(summaries, dict) else None
    if not isinstance(selected, dict):
        return False
    selected_account = _normalize_text(selected.get("account"))
    if (
        not selected_account
        or not _ii_basics._accounts_are_compatible("schwab", account, selected_account)
        or selected.get("position_snapshot_authoritative") is not True
        or selected.get("position_snapshot_source") != "schwab_positions_csv"
    ):
        return False
    snapshot = selected.get("position_snapshot")
    if not isinstance(snapshot, dict) or not snapshot:
        return False
    selected_boundary = _snapshot_boundary(snapshot, selected)
    if selected_boundary is None:
        return False
    selected_day, selected_time, _selected_as_of = selected_boundary
    incoming_day, incoming_time, _incoming_as_of = incoming_boundary
    if selected_day != incoming_day:
        return selected_day > incoming_day
    return bool(
        selected_time is not None
        and incoming_time is not None
        and selected_time > incoming_time
    )


def validate_merged_schwab_positions(
    merged_payload: dict[str, Any], incoming_payload: dict[str, Any]
) -> dict[str, Any] | None:
    """Reject unmatched merged shares without validating other scopes or dates.

    None means that native coverage or replay semantics do not support a new
    validation claim. Both native coverage and a successful merged result are
    replayed here, never copied from the incoming file's validation flags.
    """
    if _ii_basics._normalize_broker_code(incoming_payload.get("broker")) != "schwab":
        return None
    account = _normalize_text(incoming_payload.get("account"))
    if not account or account == "multiple":
        return None
    summary = incoming_payload.get("summary")
    summary = summary if isinstance(summary, dict) else {}
    snapshot = incoming_payload.get("position_snapshot")
    native_validation = summary.get("holdings_validation")
    if (
        not isinstance(snapshot, dict)
        or not snapshot
        or summary.get("position_snapshot_authoritative") is not True
        or summary.get("position_snapshot_source") != "schwab_positions_csv"
        or not isinstance(native_validation, dict)
        or native_validation.get("matched") is not True
        or native_validation.get("history_complete") is False
        or summary.get("unknown_transaction_type_count", 0)
        or not _has_paired_artifacts(incoming_payload, account)
    ):
        return None
    boundary = _snapshot_boundary(snapshot, summary)
    if boundary is None:
        return None
    if _has_newer_selected_snapshot(merged_payload, account, boundary):
        return None
    incoming_rows = incoming_payload.get("transactions")
    native_identities = (
        {
            _native_identity(record)
            for record in incoming_rows
            if isinstance(record, dict)
            and _source(record).get("file_kind") == "schwab_csv"
        }
        if isinstance(incoming_rows, list)
        else set()
    )
    native_scope = _scoped_rows_as_of(
        incoming_payload, account, boundary, native_identities
    )
    if native_scope is None:
        return None
    try:
        native_mismatches = _ii_records._validate_holdings(native_scope[0], snapshot)
    except (InvalidOperation, TypeError, ValueError, KeyError):
        return None
    if native_mismatches:
        return None
    merged_scope = _scoped_rows_as_of(
        merged_payload, account, boundary, native_identities
    )
    if merged_scope is None:
        return None
    scoped, excluded = merged_scope
    _boundary_day, _boundary_time, as_of = boundary
    try:
        mismatches = _ii_records._validate_holdings(scoped, snapshot)
    except (InvalidOperation, TypeError, ValueError, KeyError) as exc:
        raise ValueError(
            "Schwab merged holdings cannot be replayed safely; review the records before importing."
        ) from exc
    if mismatches:
        details = "; ".join(
            f"{item['ticker']}: replayed {item['replayed_quantity']}, Positions {item['open_positions_quantity']}"
            for item in mismatches
        )
        raise ValueError(
            f"Schwab merged holdings do not match the Positions snapshot as of {as_of}: {details}. Review unmatched or duplicate transactions before importing."
        )
    return {
        "broker": "schwab",
        "account": account,
        "as_of": as_of,
        "matched": True,
        "mismatch_count": 0,
        "mismatches": [],
        "source": "post_merge_scoped_transaction_replay",
        "excluded_post_snapshot_count": excluded,
    }
