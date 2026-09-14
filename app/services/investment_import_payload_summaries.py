"""Investment import domain: payload summaries.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Decimal,
    IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE,
    IBKR_WEB_CAPTURE_METADATA_FIELDS,
    LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    date,
    datetime,
    deepcopy,
    re,
    sort_broker_codes,
)

import app.services.investment_import_artifacts as _ii_artifacts

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_hsbc_core as _ii_hsbc_core

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_records as _ii_records


def _payload_transaction_dates(payload: dict[str, Any]) -> list[str]:
    return [
        _normalize_text(txn.get("date"))
        for txn in _ii_merge_reconciliation._payload_transactions(payload)
        if _normalize_text(txn.get("date"))
    ]


def _payload_sort_key(payload: dict[str, Any]) -> tuple[str, int, int, int, str]:
    transaction_dates = _payload_transaction_dates(payload)
    if _ii_basics._normalize_broker_code(payload.get("broker")) == "boc_hk":
        summary = (
            payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        )
        statement_date_max = _normalize_text(summary.get("statement_date_max"))
        if statement_date_max:
            transaction_dates = [*transaction_dates, statement_date_max]
    position_snapshot = payload.get("position_snapshot")
    performance_snapshot = payload.get("performance_snapshot")
    generator = payload.get("generator")
    return (
        max(transaction_dates) if transaction_dates else "",
        len(position_snapshot) if isinstance(position_snapshot, dict) else 0,
        len(performance_snapshot) if isinstance(performance_snapshot, dict) else 0,
        len(_ii_merge_reconciliation._payload_transactions(payload)),
        _normalize_text(generator.get("generated_at"))
        if isinstance(generator, dict)
        else "",
    )


def _payload_earliest_sort_key(payload: dict[str, Any]) -> tuple[str, int, str]:
    transaction_dates = _payload_transaction_dates(payload)
    if _ii_basics._normalize_broker_code(payload.get("broker")) == "boc_hk":
        summary = (
            payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        )
        statement_date_min = _normalize_text(summary.get("statement_date_min"))
        if statement_date_min:
            transaction_dates = [*transaction_dates, statement_date_min]
    generator = payload.get("generator")
    return (
        min(transaction_dates) if transaction_dates else "9999-12-31",
        -len(_ii_merge_reconciliation._payload_transactions(payload)),
        _normalize_text(generator.get("generated_at"))
        if isinstance(generator, dict)
        else "",
    )


def _pick_latest_payload(
    existing_payload: dict[str, Any], incoming_payload: dict[str, Any]
) -> dict[str, Any]:
    return (
        incoming_payload
        if _payload_sort_key(incoming_payload) >= _payload_sort_key(existing_payload)
        else existing_payload
    )


def _hsbc_position_snapshot_as_of(payload: dict[str, Any]) -> str:
    """Return the best explicit date for an HSBC position snapshot."""
    broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    raw_broker_summaries = payload.get("broker_summaries")
    broker_summary = (
        raw_broker_summaries.get("hsbc")
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get("hsbc"), dict)
        else {}
    )
    top_summary = (
        payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    )
    summaries = [broker_summary]
    if broker == "hsbc":
        summaries.append(top_summary)

    position_snapshot = (
        broker_summary.get("position_snapshot")
        if isinstance(broker_summary.get("position_snapshot"), dict)
        else payload.get("position_snapshot")
        if broker == "hsbc" and isinstance(payload.get("position_snapshot"), dict)
        else {}
    )
    if not position_snapshot:
        return ""

    candidates: list[str] = []

    def append_date(raw_value: Any) -> None:
        value = _normalize_text(raw_value)[:10]
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", value):
            candidates.append(value)

    for summary in summaries:
        append_date(summary.get("position_snapshot_as_of"))
        hsbc_snapshot = summary.get("hsbc_snapshot")
        if not isinstance(hsbc_snapshot, dict):
            continue
        market_data_updated_at = hsbc_snapshot.get("portfolio_market_data_updated_at")
        if isinstance(market_data_updated_at, dict):
            append_date(market_data_updated_at.get("date"))

    for item in position_snapshot.values():
        if isinstance(item, dict):
            append_date(item.get("as_of"))

    raw_broker_snapshots = payload.get("broker_snapshots")
    if isinstance(raw_broker_snapshots, dict):
        for snapshot in raw_broker_snapshots.values():
            if not isinstance(snapshot, dict):
                continue
            if _ii_basics._normalize_broker_code(snapshot.get("broker")) != "hsbc":
                continue
            append_date(snapshot.get("position_snapshot_as_of"))
            append_date(snapshot.get("snapshot_as_of"))

    raw_artifacts = payload.get("source_artifacts")
    if isinstance(raw_artifacts, list):
        for artifact in raw_artifacts:
            if not isinstance(artifact, dict):
                continue
            if (
                _normalize_text(artifact.get("source_kind"))
                != "hsbc_investment_statement_pdf"
            ):
                continue
            append_date(artifact.get("statement_period_end"))

    if not candidates:
        for record in _ii_merge_reconciliation._payload_transactions(payload):
            if (
                _ii_basics._normalize_broker_code(record.get("broker") or broker)
                == "hsbc"
            ):
                append_date(record.get("date"))
    return max(candidates, default="")


def _pick_latest_hsbc_snapshot_payload(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
) -> dict[str, Any]:
    """Select dated HSBC position evidence without favoring a source label."""
    existing_is_statement = (
        _ii_merge_reconciliation._is_hsbc_historical_statement_payload(existing_payload)
    )
    incoming_is_statement = (
        _ii_merge_reconciliation._is_hsbc_historical_statement_payload(incoming_payload)
    )
    if existing_is_statement == incoming_is_statement:
        return _pick_latest_payload(existing_payload, incoming_payload)

    statement_payload = existing_payload if existing_is_statement else incoming_payload
    live_payload = incoming_payload if existing_is_statement else existing_payload
    statement_snapshot = _ii_artifacts._normalize_snapshot_keys(
        statement_payload.get("position_snapshot")
    )
    live_snapshot = _ii_artifacts._normalize_snapshot_keys(
        live_payload.get("position_snapshot")
    )
    if not statement_snapshot:
        return live_payload
    if not live_snapshot:
        return statement_payload

    statement_as_of = _hsbc_position_snapshot_as_of(statement_payload)
    live_as_of = _hsbc_position_snapshot_as_of(live_payload)
    if statement_as_of and live_as_of and statement_as_of > live_as_of:
        return statement_payload
    return live_payload


def _pick_earliest_payload(
    existing_payload: dict[str, Any], incoming_payload: dict[str, Any]
) -> dict[str, Any]:
    return (
        incoming_payload
        if _payload_earliest_sort_key(incoming_payload)
        < _payload_earliest_sort_key(existing_payload)
        else existing_payload
    )


def _summary_list(summary: dict[str, Any] | None, key: str) -> list[str]:
    if not isinstance(summary, dict):
        return []
    raw_value = summary.get(key)
    if not isinstance(raw_value, list):
        return []
    return [str(item) for item in raw_value if str(item).strip()]


def _summary_text(summary: dict[str, Any] | None, key: str) -> str | None:
    if not isinstance(summary, dict):
        return None
    value = summary.get(key)
    text = _normalize_text(value)
    return text or None


def _unique_preserving_order(values: list[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized_value = _normalize_text(value)
        if not normalized_value or normalized_value in seen:
            continue
        seen.add(normalized_value)
        ordered.append(normalized_value)
    return ordered


def _build_summary(
    *,
    transactions: list[dict[str, Any]],
    warnings: list[str],
    unknown_types: list[str],
    holdings_mismatches: list[dict[str, str]],
    open_position_snapshots: dict[str, dict[str, str]],
    performance_snapshots: dict[str, dict[str, str]],
    starting_cash: str | None,
    ending_cash: str | None,
    merge_details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    grant_count = sum(
        1
        for record in transactions
        if _normalize_text(record.get("type")).lower() == "grant"
    )
    summary: dict[str, Any] = {
        "starting_cash_raw": starting_cash,
        "ending_cash_raw": ending_cash,
        "transaction_count": len(transactions) - grant_count,
        "grant_count": grant_count,
        "total_record_count": len(transactions),
        "unknown_transaction_type_count": len(unknown_types),
        "unknown_transaction_types": sorted(unknown_types),
        "warning_count": len(warnings),
        "warnings": warnings,
        "holdings_validation": {
            "matched": not holdings_mismatches,
            "mismatch_count": len(holdings_mismatches),
            "mismatches": holdings_mismatches,
        },
        "open_position_count": len(open_position_snapshots),
        "performance_symbol_count": len(performance_snapshots),
    }
    if merge_details:
        summary["incremental_import"] = merge_details
    return summary


def _default_broker_calibration_source(broker: str) -> str | None:
    if broker == "ibkr":
        return "ibkr_csv_summary"
    if broker == "hsbc":
        return "hsbc_usd_savings_available_balance"
    if broker == "longbridge_hk":
        return "longbridge_cli_snapshot"
    return None


def _build_broker_summary_from_payload(
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    if broker in {"", "multiple"}:
        return None

    account = _normalize_text(payload.get("account_id") or payload.get("account"))
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    ending_cash = _normalize_text(payload.get("ending_cash")) or _summary_text(
        summary, "ending_cash_raw"
    )
    starting_cash = _normalize_text(payload.get("starting_cash")) or _summary_text(
        summary, "starting_cash_raw"
    )
    normalize_balance_map = (
        _ii_merge_identity._normalize_hsbc_currency_balance_map
        if broker == "hsbc"
        else _ii_merge_identity._normalize_bochk_currency_balance_map
        if broker == "boc_hk"
        else _ii_merge_identity._normalize_currency_balance_map
    )
    ending_cash_by_currency = normalize_balance_map(
        payload.get("ending_cash_by_currency") or summary.get("ending_cash_by_currency")
    )
    starting_cash_by_currency = normalize_balance_map(
        payload.get("starting_cash_by_currency")
        or summary.get("starting_cash_by_currency")
    )
    ending_cash_base_currency = _normalize_text(
        payload.get("ending_cash_base_currency")
    ) or _summary_text(summary, "ending_cash_base_currency")
    starting_cash_base_currency = _normalize_text(
        payload.get("starting_cash_base_currency")
    ) or _summary_text(summary, "starting_cash_base_currency")
    performance_snapshot = _ii_artifacts._normalize_snapshot_keys(
        payload.get("performance_snapshot")
    )
    performance_snapshot_authoritative = bool(
        summary.get("performance_snapshot_authoritative") and performance_snapshot
    )
    if (
        not ending_cash
        and not starting_cash
        and not ending_cash_by_currency
        and not starting_cash_by_currency
        and not performance_snapshot_authoritative
        and not account
    ):
        return None

    raw_broker_summaries = payload.get("broker_summaries")
    raw_broker_summary = (
        raw_broker_summaries.get(broker)
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get(broker), dict)
        else {}
    )
    calibration_source = (
        _normalize_text(raw_broker_summary.get("calibration_source"))
        or (
            "longbridge_hk_files"
            if _normalize_text((payload.get("generator") or {}).get("name"))
            == "longbridge_hk_files_to_investment_json"
            else ""
        )
        or _summary_text(summary, "cash_snapshot_source")
        or _default_broker_calibration_source(broker)
    )
    generator = (
        payload.get("generator") if isinstance(payload.get("generator"), dict) else {}
    )
    broker_summary: dict[str, Any] = {
        "broker": broker,
    }
    if ending_cash:
        broker_summary["ending_cash_raw"] = ending_cash
        broker_summary["ending_cash"] = ending_cash
    if starting_cash:
        broker_summary["starting_cash_raw"] = starting_cash
        broker_summary["starting_cash"] = starting_cash
    if ending_cash_by_currency:
        broker_summary["ending_cash_by_currency"] = ending_cash_by_currency
    if starting_cash_by_currency:
        broker_summary["starting_cash_by_currency"] = starting_cash_by_currency
    if ending_cash_base_currency:
        broker_summary["ending_cash_base_currency"] = ending_cash_base_currency
    if starting_cash_base_currency:
        broker_summary["starting_cash_base_currency"] = starting_cash_base_currency
    if performance_snapshot_authoritative:
        broker_summary["performance_snapshot"] = performance_snapshot
        broker_summary["performance_snapshot_authoritative"] = True
        performance_snapshot_source = _summary_text(
            summary,
            "performance_snapshot_source",
        )
        if performance_snapshot_source:
            broker_summary["performance_snapshot_source"] = performance_snapshot_source
    if account:
        broker_summary["account"] = account
    if broker == "ibkr":
        for field_name in (
            "cash_snapshot_source",
            "cash_snapshot_authoritative",
            "starting_cash_as_of",
            "ending_cash_as_of",
            "ending_cash_replay_as_of",
            "ending_cash_as_of_datetime",
            "ending_cash_replay_as_of_datetime",
            "cash_snapshot_verification",
            "current_moment_source",
            *IBKR_WEB_CAPTURE_METADATA_FIELDS,
        ):
            if field_name in summary:
                broker_summary[field_name] = summary[field_name]
    if broker == "hsbc":
        for field_name in (
            "hsbc_snapshot",
            "cash_snapshot_authoritative",
            "cash_snapshot_as_of",
            "cash_snapshot_source",
            "cash_flow_transaction_source",
            "cash_snapshot_status",
            "ending_cash_base_currency_as_of",
            "ending_cash_base_currency_source",
            "ending_cash_base_currency_status",
            "current_moment_source",
            "order_history_scope",
            "hsbc_pending_settlement_cash_raw",
            "hsbc_pending_settlement_fee_adjustment",
            "hsbc_pending_settlement_cash",
            "hsbc_pending_settlement_order_count",
            "hsbc_broker_cash_estimate",
            "hsbc_cash_display_convention",
            "cash_ledger_balance",
            "cash_ledger_balance_as_of",
            "cash_ledger_balance_source",
            "hsbc_bank_available_cash",
            "hsbc_available_cash_by_currency",
            "hsbc_available_cash_components",
            "statement_periods",
            "statement_count",
            "statement_pair_count",
            "composite_statement_count",
            "investment_statement_count",
            "statement_date_min",
            "statement_date_max",
            "transaction_date_min",
            "transaction_date_max",
            "duplicate_statement_row_count",
            "historical_statement_backfill",
        ):
            if field_name in summary:
                broker_summary[field_name] = summary[field_name]
    if calibration_source:
        broker_summary["calibration_source"] = calibration_source
    generated_at = _normalize_text(generator.get("generated_at"))
    if generated_at:
        broker_summary["snapshot_generated_at"] = generated_at
    if (
        broker == "boc_hk"
        and _ii_merge_reconciliation._payload_contains_bochk_statement_component(
            payload
        )
    ):
        bochk_metadata = (
            _ii_merge_reconciliation._bochk_statement_metadata_from_payload(payload)
        )
        for field_name in (
            "statement_periods",
            "statement_count",
            "statement_date_min",
            "statement_date_max",
            "duplicate_statement_row_count",
            "cash_flow_transaction_source",
            "cash_snapshot_source",
            "historical_statement_backfill",
            "bochk_subaccount_balances",
        ):
            if field_name in bochk_metadata:
                broker_summary[field_name] = bochk_metadata[field_name]
    return broker_summary


def _normalize_ibkr_cash_snapshot_datetime(value: Any) -> str:
    """Normalize a naive New York ledger datetime used as a cash boundary."""
    raw_value = _normalize_text(value).replace("T", " ")
    if raw_value.endswith("Z"):
        raw_value = raw_value[:-1].rstrip()
    if not raw_value:
        return ""
    try:
        parsed = datetime.fromisoformat(raw_value)
    except ValueError:
        return ""
    return parsed.replace(tzinfo=None, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def _ibkr_cash_snapshot_datetime_from_summary(summary: dict[str, Any]) -> str:
    for field_name in (
        "ending_cash_replay_as_of_datetime",
        "ending_cash_as_of_datetime",
    ):
        normalized = _normalize_ibkr_cash_snapshot_datetime(summary.get(field_name))
        if normalized:
            return normalized
    for field_name in (
        "ending_cash_replay_as_of",
        "ending_cash_as_of",
        "cash_snapshot_as_of",
    ):
        raw_date = _normalize_text(summary.get(field_name))[:10]
        try:
            date.fromisoformat(raw_date)
        except ValueError:
            continue
        return f"{raw_date} 00:00:00"
    return ""


def _ibkr_user_verified_cash_summary_can_replace(
    existing_summary: dict[str, Any],
    incoming_summary: dict[str, Any],
) -> bool:
    """Apply a user cash capture only when it is not an older conflicting boundary."""
    existing_source = _normalize_text(existing_summary.get("cash_snapshot_source"))
    existing_datetime = _ibkr_cash_snapshot_datetime_from_summary(existing_summary)
    incoming_datetime = _ibkr_cash_snapshot_datetime_from_summary(incoming_summary)
    if not existing_summary or not existing_datetime:
        return True
    if existing_source == IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE:
        if not incoming_datetime:
            return False
        if incoming_datetime > existing_datetime:
            return True
        if incoming_datetime < existing_datetime:
            return False
        return _normalize_text(existing_summary.get("ending_cash")) == _normalize_text(
            incoming_summary.get("ending_cash")
        )
    if not incoming_datetime:
        return False
    if any(
        _normalize_ibkr_cash_snapshot_datetime(existing_summary.get(field_name))
        for field_name in (
            "ending_cash_replay_as_of_datetime",
            "ending_cash_as_of_datetime",
        )
    ):
        # Reapplying an older capture after a file merge must not roll back
        # a later same-day file boundary.
        return incoming_datetime > existing_datetime or (
            incoming_datetime == existing_datetime
            and _ii_hsbc_cash._parse_decimal_text_or_none(
                existing_summary.get("ending_cash")
            )
            == _ii_hsbc_cash._parse_decimal_text_or_none(
                incoming_summary.get("ending_cash")
            )
        )
    # A user capture with the same calendar date as an older date-only file
    # snapshot is allowed to refine that snapshot with its exact fill time.
    return incoming_datetime[:10] >= existing_datetime[:10]


def _merge_ibkr_cash_snapshot_fields(
    existing_summary: dict[str, Any],
    incoming_summary: dict[str, Any],
) -> dict[str, Any]:
    """Merge IBKR cash fields without letting an older file roll back app evidence."""
    existing_source = _normalize_text(existing_summary.get("cash_snapshot_source"))
    incoming_source = _normalize_text(incoming_summary.get("cash_snapshot_source"))
    existing_is_user_verified = (
        existing_source == IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE
    )
    incoming_is_user_verified = (
        incoming_source == IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE
    )
    cash_snapshot_fields = (
        "ending_cash_by_currency",
        "ending_cash_base_currency",
        "ending_cash",
        "ending_cash_raw",
        "cash_snapshot_source",
        "cash_snapshot_authoritative",
        "calibration_source",
        "cash_snapshot_verification",
        "current_moment_source",
        "ending_cash_as_of",
        "ending_cash_replay_as_of",
        "ending_cash_as_of_datetime",
        "ending_cash_replay_as_of_datetime",
    )
    if not existing_is_user_verified and not incoming_is_user_verified:
        merged = {**existing_summary, **incoming_summary}
        existing_boundary = _ibkr_cash_snapshot_datetime_from_summary(existing_summary)
        incoming_boundary = _ibkr_cash_snapshot_datetime_from_summary(incoming_summary)
        preferred = incoming_summary
        if existing_boundary and (
            not incoming_boundary or existing_boundary > incoming_boundary
        ):
            preferred = existing_summary
        for field_name in cash_snapshot_fields:
            if field_name in preferred:
                merged[field_name] = preferred[field_name]
            else:
                merged.pop(field_name, None)
        return merged
    if incoming_is_user_verified:
        return {**existing_summary, **incoming_summary}

    existing_datetime = _ibkr_cash_snapshot_datetime_from_summary(existing_summary)
    incoming_datetime = _ibkr_cash_snapshot_datetime_from_summary(incoming_summary)
    incoming_is_newer = bool(
        incoming_datetime
        and existing_datetime
        and incoming_datetime > existing_datetime
    )
    if incoming_is_newer:
        merged = {**existing_summary, **incoming_summary}
        for field_name in (
            "ending_cash_by_currency",
            "ending_cash_base_currency",
            "ending_cash_as_of_datetime",
            "ending_cash_replay_as_of_datetime",
            "cash_snapshot_verification",
            "current_moment_source",
        ):
            if field_name not in incoming_summary:
                merged.pop(field_name, None)
        return merged

    merged = {**existing_summary, **incoming_summary}
    for field_name in cash_snapshot_fields:
        if field_name in existing_summary:
            merged[field_name] = existing_summary[field_name]
    return merged


def _apply_ibkr_user_verified_cash_snapshot(
    payload: dict[str, Any],
    incoming_payload: dict[str, Any],
) -> None:
    """Persist the newest explicit IBKR app cash boundary after normal merging."""
    incoming_summary = _normalize_broker_summaries(incoming_payload).get("ibkr")
    if not isinstance(incoming_summary, dict):
        return
    if (
        _normalize_text(incoming_summary.get("cash_snapshot_source"))
        != IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE
    ):
        return

    broker_summaries = payload.get("broker_summaries")
    if not isinstance(broker_summaries, dict):
        broker_summaries = {}
        payload["broker_summaries"] = broker_summaries
    existing_summary = broker_summaries.get("ibkr")
    if not isinstance(existing_summary, dict):
        existing_summary = {}
    if not _ibkr_user_verified_cash_summary_can_replace(
        existing_summary,
        incoming_summary,
    ):
        return

    merged_summary = {**existing_summary, **incoming_summary}
    broker_summaries["ibkr"] = merged_summary
    if _ii_basics._normalize_broker_code(payload.get("broker")) != "ibkr":
        return

    for field_name in (
        "ending_cash",
        "ending_cash_raw",
        "cash_snapshot_source",
        "cash_snapshot_authoritative",
        "calibration_source",
        "current_moment_source",
        "ending_cash_as_of",
        "ending_cash_replay_as_of",
        "ending_cash_as_of_datetime",
        "ending_cash_replay_as_of_datetime",
        "cash_snapshot_verification",
    ):
        if field_name in incoming_summary:
            payload[field_name] = incoming_summary[field_name]
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        summary = {}
        payload["summary"] = summary
    for field_name in (
        "ending_cash_raw",
        "cash_snapshot_source",
        "cash_snapshot_authoritative",
        "calibration_source",
        "current_moment_source",
        "ending_cash_as_of",
        "ending_cash_replay_as_of",
        "ending_cash_as_of_datetime",
        "ending_cash_replay_as_of_datetime",
        "cash_snapshot_verification",
    ):
        if field_name in incoming_payload.get("summary", {}):
            summary[field_name] = incoming_payload["summary"][field_name]


def _merge_ibkr_web_capture_metadata(
    payload: dict[str, Any],
    *candidate_payloads: dict[str, Any],
) -> None:
    """Retain the supplemental role of any IBKR web-paste evidence."""
    web_summaries = [
        candidate.get("summary")
        for candidate in candidate_payloads
        if _ii_merge_identity._is_ibkr_web_trade_notification_payload(candidate)
        and isinstance(candidate.get("summary"), dict)
    ]
    if not web_summaries:
        return

    summary = payload.get("summary")
    if not isinstance(summary, dict):
        summary = {}
        payload["summary"] = summary
    broker_summaries = payload.get("broker_summaries")
    if not isinstance(broker_summaries, dict):
        broker_summaries = {}
        payload["broker_summaries"] = broker_summaries
    ibkr_summary = broker_summaries.get("ibkr")
    if not isinstance(ibkr_summary, dict):
        ibkr_summary = {"broker": "ibkr"}
        broker_summaries["ibkr"] = ibkr_summary

    for web_summary in web_summaries:
        for field_name in IBKR_WEB_CAPTURE_METADATA_FIELDS:
            if field_name not in web_summary:
                continue
            summary[field_name] = web_summary[field_name]
            ibkr_summary[field_name] = web_summary[field_name]


def _payload_cash_balance_map(
    payload: dict[str, Any], field_name: str
) -> dict[str, str]:
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    raw_value = payload.get(field_name)
    if not isinstance(raw_value, dict):
        raw_value = summary.get(field_name)
    broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    if broker == "hsbc":
        return _ii_merge_identity._normalize_hsbc_currency_balance_map(raw_value)
    if broker == "boc_hk":
        return _ii_merge_identity._normalize_bochk_currency_balance_map(raw_value)
    return _ii_merge_identity._normalize_currency_balance_map(raw_value)


def _normalize_hsbc_ending_cash_components(raw_value: Any) -> dict[str, Decimal]:
    """Normalize persisted HSBC per-account-kind balance components."""
    if not isinstance(raw_value, dict):
        return {}
    components: dict[str, Decimal] = {}
    for raw_key, raw_amount in raw_value.items():
        component_key = _normalize_text(raw_key)
        raw_currency, separator, raw_account_type = component_key.partition(":")
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        normalized_key = _ii_hsbc_core._hsbc_cash_balance_component_key(
            raw_currency,
            raw_account_type,
        )
        if not separator or not normalized_key.partition(":")[0] or amount is None:
            continue
        components[normalized_key] = amount
    return components


def _payload_hsbc_ending_cash_components(payload: dict[str, Any]) -> dict[str, Decimal]:
    """Read current HSBC cash components, falling back to legacy currency totals."""
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    components = _normalize_hsbc_ending_cash_components(
        summary.get("hsbc_ending_cash_components")
    )
    if components:
        return components
    legacy_components: dict[str, Decimal] = {}
    for currency, raw_amount in _payload_cash_balance_map(
        payload,
        "ending_cash_by_currency",
    ).items():
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if amount is None:
            continue
        legacy_components[f"{currency}:LEGACY"] = amount
    return legacy_components


def _payload_hsbc_cash_component_post_dates(payload: dict[str, Any]) -> dict[str, str]:
    """Read or derive the latest visible post date for each HSBC cash component."""
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    raw_dates = summary.get("hsbc_cash_component_post_dates")
    if isinstance(raw_dates, dict):
        normalized_dates = _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
            {
                _normalize_text(raw_key): _normalize_text(raw_value)
                for raw_key, raw_value in raw_dates.items()
            }
        )
        if normalized_dates:
            return normalized_dates
    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        return {}
    return _ii_hsbc_core._hsbc_cash_component_post_dates_from_records(
        [
            record
            for record in transactions
            if isinstance(record, dict)
            and _ii_merge_identity._is_hsbc_cash_account_record(record)
        ]
    )


def _payload_hsbc_cash_settlement_evidence(
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    """Read hidden HSBC cash legs retained for later order reconciliation."""
    raw_evidence = payload.get("hsbc_cash_settlement_evidence")
    if not isinstance(raw_evidence, list):
        return []
    return [deepcopy(record) for record in raw_evidence if isinstance(record, dict)]


def _merge_hsbc_cash_settlement_evidence(
    *payloads: dict[str, Any],
) -> list[dict[str, Any]]:
    """Union hidden cash legs without duplicating a repeated paste chunk."""
    merged: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, ...]] = set()
    for payload in payloads:
        for record in _payload_hsbc_cash_settlement_evidence(payload):
            identity_key = _ii_hsbc_cash._hsbc_cash_record_identity_key(record)
            if identity_key in seen_keys:
                continue
            seen_keys.add(identity_key)
            merged.append(record)
    return merged


def _infer_hsbc_cash_components_from_transactions(
    transactions: list[dict[str, Any]],
) -> tuple[dict[str, Decimal], dict[str, str]]:
    """Infer one latest balance per HSBC cash subaccount from cash rows only."""
    latest_by_component: dict[str, tuple[tuple[str, int, str], Decimal]] = {}
    for record in transactions:
        if not isinstance(
            record, dict
        ) or not _ii_merge_identity._is_hsbc_cash_account_record(record):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        balance = _ii_hsbc_cash._parse_decimal_text_or_none(
            source.get("balance_after_raw")
            or source.get("available_cash_after_raw")
            or source.get("cash_settlement_balance_after_raw")
        )
        post_date = _normalize_text(record.get("date"))
        if balance is None or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", post_date):
            continue
        component_key = _ii_hsbc_core._hsbc_cash_record_component_key(record)
        if not component_key:
            continue
        sequence_value = source.get("ledger_sequence") or source.get("row_number")
        try:
            sequence = int(str(sequence_value).strip())
        except (TypeError, ValueError):
            sequence = 0
        candidate_key = (
            post_date,
            sequence,
            _normalize_text(record.get("datetime")),
        )
        existing = latest_by_component.get(component_key)
        if existing is None or candidate_key >= existing[0]:
            latest_by_component[component_key] = (candidate_key, balance)

    values = {
        component_key: entry[1] for component_key, entry in latest_by_component.items()
    }
    post_dates = {
        component_key: entry[0][0]
        for component_key, entry in latest_by_component.items()
    }
    return values, post_dates


def _infer_hsbc_settled_usd_cash_boundary(
    transactions: list[dict[str, Any]],
    *,
    account: str = "",
    expected_as_of: str = "",
) -> tuple[Decimal, str] | None:
    """Recover a missing current USD ledger balance from matched settlements."""
    normalized_account = _normalize_text(account)
    normalized_as_of = _normalize_text(expected_as_of)[:10]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", normalized_as_of):
        return None

    def parse_sequence(value: Any) -> int:
        try:
            return max(int(str(value or "0").strip()), 0)
        except (TypeError, ValueError):
            return 0

    candidates: list[tuple[tuple[str, int, int], Decimal]] = []
    for record in transactions:
        if not isinstance(record, dict):
            continue
        if _ii_basics._normalize_broker_code(record.get("broker")) != "hsbc":
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        record_account = _normalize_text(
            record.get("account")
            or source.get("account")
            or source.get("account_number")
        )
        if (
            normalized_account
            and record_account
            and record_account != normalized_account
        ):
            continue

        raw_postings = source.get("cash_settlement_postings")
        if isinstance(raw_postings, list):
            for posting in raw_postings:
                if not isinstance(posting, dict):
                    continue
                currency = _ii_merge_identity._normalize_hsbc_currency_code(
                    posting.get("currency") or record.get("currency")
                )
                posting_date = _normalize_text(
                    posting.get("date") or source.get("cash_settlement_date")
                )[:10]
                balance = _ii_hsbc_cash._parse_decimal_text_or_none(
                    posting.get("balance_after_raw")
                )
                if (
                    currency != "USD"
                    or posting_date != normalized_as_of
                    or balance is None
                ):
                    continue
                sequence = parse_sequence(
                    posting.get("ledger_sequence") or posting.get("row_number")
                )
                row_number = parse_sequence(posting.get("row_number"))
                candidates.append(((posting_date, sequence, row_number), balance))

        settlement_date = _normalize_text(source.get("cash_settlement_date"))[:10]
        settlement_balance = _ii_hsbc_cash._parse_decimal_text_or_none(
            source.get("cash_settlement_balance_after_raw")
        )
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(record.get("currency"))
            == "USD"
            and settlement_date == normalized_as_of
            and settlement_balance is not None
        ):
            source_row = parse_sequence(source.get("cash_settlement_source_row_number"))
            candidates.append(
                ((settlement_date, source_row, source_row), settlement_balance)
            )

    if not candidates:
        return None
    latest_key, latest_balance = max(candidates, key=lambda candidate: candidate[0])
    return latest_balance, latest_key[0]


def _resolve_hsbc_declared_current_cash_boundary(
    summary: dict[str, Any],
    payload_summary: dict[str, Any] | None,
    *,
    has_current_cash_scope: bool = False,
) -> tuple[Decimal, str, str] | None:
    """Return a declared HSBC boundary unless it is only bank-available cash."""
    payload_summary = payload_summary or {}
    status = _normalize_text(
        summary.get("ending_cash_base_currency_status")
        or payload_summary.get("ending_cash_base_currency_status")
    )
    scope_source = _normalize_text(
        payload_summary.get("authoritative_current_cash_scope_source")
    )
    is_authoritative = status in {
        "authoritative_current_cash_boundary",
        "authoritative_effective_boundary",
    } or (has_current_cash_scope and bool(scope_source))
    if not is_authoritative:
        return None

    source = _normalize_text(
        summary.get("ending_cash_base_currency_source")
        or payload_summary.get("ending_cash_base_currency_source")
        or summary.get("cash_snapshot_source")
        or payload_summary.get("cash_snapshot_source")
        or summary.get("calibration_source")
    )
    if source in {
        "hsbc_usd_savings_available_balance",
        "hsbc_multi_currency_available_balance",
    }:
        return None

    amount = _ii_hsbc_cash._parse_decimal_text_or_none(
        summary.get("ending_cash_base_currency")
        or payload_summary.get("ending_cash_base_currency")
    )
    if amount is None:
        return None
    as_of = _normalize_text(
        summary.get("ending_cash_base_currency_as_of")
        or payload_summary.get("ending_cash_base_currency_as_of")
        or summary.get("cash_snapshot_as_of")
        or payload_summary.get("cash_snapshot_as_of")
    )[:10]
    return amount, as_of, source or "hsbc_verified_effective_cash_boundary"


def _infer_broker_summary_from_transactions(
    broker: str,
    transactions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if broker != "hsbc":
        return None

    ending_cash: str | None = None
    account: str | None = None
    for txn in reversed(transactions):
        if not isinstance(txn, dict):
            continue
        if _ii_basics._normalize_broker_code(txn.get("broker")) != broker:
            continue
        source = txn.get("source") if isinstance(txn.get("source"), dict) else {}
        available_cash = _normalize_text(source.get("available_cash_after_raw"))
        settlement_cash = _normalize_text(
            source.get("cash_settlement_balance_after_raw")
        )
        balance_after = _normalize_text(source.get("balance_after_raw"))
        candidate = available_cash or settlement_cash or balance_after
        if candidate:
            ending_cash = candidate
            account = _normalize_text(
                txn.get("account")
                or source.get("account")
                or source.get("account_number")
            )
            break
    if not ending_cash:
        return None
    return {
        "broker": broker,
        "account": account,
        "ending_cash": ending_cash,
        "ending_cash_raw": ending_cash,
        "calibration_source": "hsbc_transaction_balance_inference",
    }


def _normalize_broker_summaries(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    raw_summaries = payload.get("broker_summaries")
    if isinstance(raw_summaries, dict):
        for raw_broker, raw_summary in raw_summaries.items():
            broker = _ii_basics._normalize_broker_code(str(raw_broker))
            if not broker or not isinstance(raw_summary, dict):
                continue
            summaries[broker] = {
                **raw_summary,
                "broker": broker,
            }

    derived_summary = _build_broker_summary_from_payload(payload)
    if derived_summary:
        broker = derived_summary["broker"]
        summaries[broker] = {**summaries.get(broker, {}), **derived_summary}

    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        transactions = []
    transaction_brokers = sort_broker_codes(
        {
            _ii_basics._normalize_broker_code(txn.get("broker"))
            for txn in transactions
            if isinstance(txn, dict)
            and _ii_basics._normalize_broker_code(txn.get("broker"))
        }
    )
    for broker in transaction_brokers:
        if broker == "hsbc":
            if broker in summaries and _normalize_text(
                summaries[broker].get("ending_cash")
            ):
                continue
            inferred = _infer_broker_summary_from_transactions(broker, transactions)
            if inferred:
                summaries[broker] = {**summaries.get(broker, {}), **inferred}
            continue
        if broker in summaries and _normalize_text(
            summaries[broker].get("ending_cash")
        ):
            continue
        inferred = _infer_broker_summary_from_transactions(broker, transactions)
        if inferred:
            summaries[broker] = {**summaries.get(broker, {}), **inferred}

    for broker, summary in summaries.items():
        if (
            broker == "longbridge_hk"
            and _normalize_text(summary.get("calibration_source"))
            == "longbridge_hk_files"
        ):
            summary["cash_snapshot_authoritative"] = False
        if broker == "hsbc":
            payload_summary = (
                payload.get("summary")
                if isinstance(payload.get("summary"), dict)
                else None
            )
            original_components = _payload_hsbc_ending_cash_components(payload)
            available_balance = _ii_hsbc_cash._parse_decimal_text_or_none(
                summary.get("hsbc_bank_available_cash")
                or (
                    payload_summary.get("hsbc_bank_available_cash")
                    if payload_summary is not None
                    else None
                )
            )
            raw_available_components = summary.get(
                "hsbc_available_cash_components"
            ) or (
                payload_summary.get("hsbc_available_cash_components")
                if payload_summary is not None
                else None
            )
            available_components = _normalize_hsbc_ending_cash_components(
                raw_available_components
            )

            inferred_components, inferred_component_dates = (
                _infer_hsbc_cash_components_from_transactions(transactions)
            )
            component_values = dict(original_components)
            component_dates = _payload_hsbc_cash_component_post_dates(payload)
            _ii_hsbc_core._merge_hsbc_cash_component_values(
                component_values,
                component_dates,
                inferred_components,
                inferred_component_dates,
            )

            hsbc_snapshot = (
                summary.get("hsbc_snapshot")
                if isinstance(summary.get("hsbc_snapshot"), dict)
                else payload_summary.get("hsbc_snapshot")
                if payload_summary is not None
                and isinstance(payload_summary.get("hsbc_snapshot"), dict)
                else {}
            )
            snapshot_cash_as_of = _normalize_text(
                hsbc_snapshot.get("cash_latest_post_date")
            )
            if not snapshot_cash_as_of:
                cash_posting_lag = hsbc_snapshot.get("cash_posting_lag")
                if isinstance(cash_posting_lag, dict):
                    snapshot_cash_as_of = _normalize_text(
                        cash_posting_lag.get("latest_cash_post_date")
                    )
            expected_cash_as_of = _normalize_text(
                summary.get("cash_ledger_balance_as_of")
                or summary.get("ending_cash_base_currency_as_of")
                or summary.get("cash_snapshot_as_of")
                or (
                    payload_summary.get("cash_ledger_balance_as_of")
                    or payload_summary.get("ending_cash_base_currency_as_of")
                    or payload_summary.get("cash_snapshot_as_of")
                    if payload_summary is not None
                    else ""
                )
                or snapshot_cash_as_of
                or component_dates.get("USD:SAVINGS")
            )[:10]
            ledger_balance = _ii_hsbc_cash._parse_decimal_text_or_none(
                summary.get("cash_ledger_balance")
                or (
                    payload_summary.get("cash_ledger_balance")
                    if payload_summary is not None
                    else None
                )
            )
            ledger_balance_as_of = _normalize_text(
                summary.get("cash_ledger_balance_as_of")
                or (
                    payload_summary.get("cash_ledger_balance_as_of")
                    if payload_summary is not None
                    else ""
                )
                or expected_cash_as_of
            )[:10]
            ledger_balance_source = _normalize_text(
                summary.get("cash_ledger_balance_source")
                or (
                    payload_summary.get("cash_ledger_balance_source")
                    if payload_summary is not None
                    else ""
                )
            )
            if (
                ledger_balance is not None
                and expected_cash_as_of
                and ledger_balance_as_of != expected_cash_as_of
            ):
                ledger_balance = None
            if ledger_balance is None:
                inferred_boundary = _infer_hsbc_settled_usd_cash_boundary(
                    transactions,
                    account=_normalize_text(
                        summary.get("account_id") or summary.get("account")
                    ),
                    expected_as_of=expected_cash_as_of,
                )
                if inferred_boundary is not None:
                    ledger_balance, ledger_balance_as_of = inferred_boundary
                    ledger_balance_source = (
                        "hsbc_settlement_posting_balance_reconstruction"
                    )
            if ledger_balance is None:
                raw_current_cash_brokers = (
                    payload_summary.get("authoritative_current_cash_brokers")
                    if payload_summary is not None
                    else None
                )
                has_current_cash_scope = isinstance(
                    raw_current_cash_brokers, list
                ) and "hsbc" in {
                    _ii_basics._normalize_broker_code(value)
                    for value in raw_current_cash_brokers
                }
                declared_boundary = _resolve_hsbc_declared_current_cash_boundary(
                    summary,
                    payload_summary,
                    has_current_cash_scope=has_current_cash_scope,
                )
                if declared_boundary is not None:
                    (
                        ledger_balance,
                        declared_balance_as_of,
                        ledger_balance_source,
                    ) = declared_boundary
                    ledger_balance_as_of = declared_balance_as_of or expected_cash_as_of
            if ledger_balance is not None:
                for component_key in list(component_values):
                    currency, _, account_type = component_key.partition(":")
                    if (
                        _ii_merge_identity._normalize_hsbc_currency_code(currency)
                        == "USD"
                        and _normalize_whitespace(account_type).upper() == "LEGACY"
                    ):
                        component_values.pop(component_key, None)
                        component_dates.pop(component_key, None)
                component_values["USD:SAVINGS"] = ledger_balance
                if ledger_balance_as_of:
                    component_dates["USD:SAVINGS"] = ledger_balance_as_of

            if component_values:
                ending_balances = _ii_hsbc_core._sum_hsbc_cash_balance_components(
                    component_values
                )
                serialized_components = (
                    _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                        component_values
                    )
                )
                serialized_component_dates = (
                    _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
                        component_dates
                    )
                )
                serialized_ending_balances = {
                    currency: _decimal_to_str(amount) or "0"
                    for currency, amount in ending_balances.items()
                }
                if payload_summary is not None:
                    payload_summary["hsbc_ending_cash_components"] = (
                        serialized_components
                    )
                    payload_summary["hsbc_cash_component_post_dates"] = (
                        serialized_component_dates
                    )
                    if (
                        _ii_basics._normalize_broker_code(payload.get("broker"))
                        == "hsbc"
                    ):
                        payload_summary["ending_cash_by_currency"] = (
                            serialized_ending_balances
                        )
                summary["ending_cash_by_currency"] = serialized_ending_balances
                summary["hsbc_ending_cash_components"] = serialized_components
                summary["hsbc_cash_component_post_dates"] = serialized_component_dates
                usd_balance = ending_balances.get("USD")
                if usd_balance is not None:
                    usd_balance_text = _decimal_to_str(usd_balance) or "0"
                    summary["ending_cash"] = usd_balance_text
                    summary["ending_cash_raw"] = usd_balance_text
                    summary["ending_cash_base_currency"] = usd_balance_text
                    if (
                        payload_summary is not None
                        and _ii_basics._normalize_broker_code(payload.get("broker"))
                        == "hsbc"
                    ):
                        payload_summary["ending_cash_base_currency"] = usd_balance_text
                payload_snapshot_source = _summary_text(
                    payload_summary,
                    "cash_snapshot_source",
                )
                if payload_snapshot_source:
                    summary["calibration_source"] = payload_snapshot_source
                elif inferred_components and not _normalize_text(
                    summary.get("calibration_source")
                ):
                    summary["calibration_source"] = (
                        "hsbc_multi_currency_cash_component_inference"
                    )
            broker_cash_balance = ledger_balance
            if broker_cash_balance is None:
                broker_cash_balance = _ii_hsbc_cash._parse_decimal_text_or_none(
                    summary.get("ending_cash_base_currency")
                )
            if available_balance is None:
                available_balance = broker_cash_balance
            if not available_components:
                available_components = dict(original_components)
                if available_balance is not None and ledger_balance is not None:
                    for component_key in list(available_components):
                        currency, _, account_type = component_key.partition(":")
                        if (
                            _ii_merge_identity._normalize_hsbc_currency_code(currency)
                            == "USD"
                            and _normalize_whitespace(account_type).upper() == "LEGACY"
                        ):
                            available_components.pop(component_key, None)
                    available_components["USD:SAVINGS"] = available_balance
            available_by_currency = {
                currency: _decimal_to_str(amount) or "0"
                for currency, amount in _ii_hsbc_core._sum_hsbc_cash_balance_components(
                    available_components
                ).items()
            }
            if available_balance is not None and broker_cash_balance is not None:
                pending_summary = _ii_hsbc_cash._summarize_hsbc_pending_settlement_cash(
                    transactions,
                    available_balance,
                    broker_cash_balance=broker_cash_balance,
                )
                summary.update(pending_summary)
                summary["hsbc_available_cash_by_currency"] = available_by_currency
                summary["hsbc_available_cash_components"] = (
                    _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                        available_components
                    )
                )
                if ledger_balance is not None:
                    ledger_balance_text = _decimal_to_str(ledger_balance) or "0"
                    summary["cash_ledger_balance"] = ledger_balance_text
                    summary["cash_ledger_balance_as_of"] = ledger_balance_as_of
                    summary["cash_ledger_balance_source"] = (
                        ledger_balance_source or "hsbc_usd_savings_ledger_balance"
                    )
                    summary["ending_cash_base_currency_source"] = summary[
                        "cash_ledger_balance_source"
                    ]
                if payload_summary is not None:
                    payload_summary.update(pending_summary)
                    payload_summary["hsbc_available_cash_by_currency"] = (
                        available_by_currency
                    )
                    payload_summary["hsbc_available_cash_components"] = (
                        _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                            available_components
                        )
                    )
                    if ledger_balance is not None:
                        payload_summary["cash_ledger_balance"] = ledger_balance_text
                        payload_summary["cash_ledger_balance_as_of"] = (
                            ledger_balance_as_of
                        )
                        payload_summary["cash_ledger_balance_source"] = summary[
                            "cash_ledger_balance_source"
                        ]
                        payload_summary["ending_cash_base_currency_source"] = summary[
                            "ending_cash_base_currency_source"
                        ]

        account = _normalize_text(summary.get("account_id") or summary.get("account"))
        calibrations = _ii_basics._build_broker_reported_performance_calibrations(
            broker,
            account,
        )
        if calibrations:
            performance_snapshot = _ii_artifacts._normalize_snapshot_keys(
                summary.get("performance_snapshot")
            )
            performance_snapshot_source = _normalize_text(
                summary.get("performance_snapshot_source")
            )
            fallback_performance_sources = {
                "",
                "broker_reported_pnl",
                LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE,
            }
            has_broker_native_snapshot_entry = any(
                isinstance(entry, dict)
                and _normalize_text(entry.get("calibration_source"))
                not in fallback_performance_sources
                for entry in performance_snapshot.values()
            )
            preserves_broker_native_snapshot = (
                bool(
                    performance_snapshot_source
                    and performance_snapshot_source
                    != LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
                )
                or has_broker_native_snapshot_entry
            )
            if not preserves_broker_native_snapshot:
                for ticker, calibration in calibrations.items():
                    existing = performance_snapshot.get(ticker)
                    if (
                        isinstance(existing, dict)
                        and _normalize_text(existing.get("calibration_source"))
                        not in fallback_performance_sources
                    ):
                        continue
                    performance_snapshot[ticker] = calibration
            summary["performance_snapshot"] = performance_snapshot
            summary["performance_snapshot_authoritative"] = bool(performance_snapshot)
            if not preserves_broker_native_snapshot:
                summary["performance_snapshot_source"] = (
                    LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
                )

        tax_lot_verifications = _ii_basics._build_verified_tax_lot_history(
            broker, account
        )
        if tax_lot_verifications:
            summary["tax_lot_history_verifications"] = tax_lot_verifications

    closed_trade_details = (
        _ii_records._extract_ibkr_closed_trade_details_from_transactions(transactions)
    )
    broker_snapshots = _ii_artifacts._normalize_broker_snapshots(payload)
    for snapshot in broker_snapshots.values():
        if not isinstance(snapshot, dict):
            continue
        broker = _ii_basics._normalize_broker_code(snapshot.get("broker"))
        if not broker:
            continue
        summary = summaries.setdefault(
            broker,
            {
                "broker": broker,
                "account": _normalize_text(snapshot.get("account")),
            },
        )
        summary_account = _normalize_text(summary.get("account"))
        snapshot_account = _normalize_text(snapshot.get("account"))
        if summary_account and snapshot_account and summary_account != snapshot_account:
            continue
        summary_performance_snapshot = _ii_artifacts._normalize_snapshot_keys(
            summary.get("performance_snapshot")
        )
        preserves_closed_trade_performance = bool(
            broker == "ibkr"
            and closed_trade_details
            and any(
                isinstance(entry, dict)
                and _normalize_text(entry.get("realized_total_source"))
                == "ibkr_closed_trades"
                for entry in summary_performance_snapshot.values()
            )
            and not (
                snapshot.get("performance_snapshot_authoritative") is True
                and _normalize_text(snapshot.get("performance_snapshot_source"))
                == "ibkr_csv_realized_summary"
                and any(
                    isinstance(entry, dict)
                    and _normalize_text(entry.get("realized_total_source"))
                    == "ibkr_csv_cumulative_non_overlapping_periods"
                    for entry in snapshot.get("performance_snapshot", {}).values()
                )
            )
        )
        performance_fields = {
            "performance_snapshot",
            "performance_snapshot_authoritative",
            "performance_snapshot_source",
            "performance_snapshot_as_of",
            "performance_snapshot_evidence_id",
            "performance_snapshot_realized_evidence_ids",
            "realized_pnl_reconciliation",
        }
        for field_name in (
            "position_snapshot",
            "position_snapshot_authoritative",
            "position_snapshot_source",
            "position_snapshot_as_of",
            "position_snapshot_evidence_id",
            "performance_snapshot",
            "performance_snapshot_authoritative",
            "performance_snapshot_source",
            "performance_snapshot_as_of",
            "performance_snapshot_evidence_id",
            "performance_snapshot_realized_evidence_ids",
            "holdings_validation",
            "realized_pnl_reconciliation",
        ):
            if preserves_closed_trade_performance and field_name in performance_fields:
                continue
            if field_name in snapshot:
                summary[field_name] = snapshot[field_name]
        if (
            broker == "ibkr"
            and not preserves_closed_trade_performance
            and snapshot.get("performance_snapshot_authoritative") is True
            and _normalize_text(snapshot.get("performance_snapshot_source"))
            == "ibkr_csv_realized_summary"
            and isinstance(snapshot.get("performance_snapshot"), dict)
            and snapshot["performance_snapshot"]
            and any(
                isinstance(entry, dict)
                and _normalize_text(entry.get("realized_total_source"))
                == "ibkr_csv_cumulative_non_overlapping_periods"
                for entry in snapshot["performance_snapshot"].values()
            )
        ):
            # Keep the compatibility summary aligned with the account-scoped
            # cumulative snapshot. The browser prefers broker_snapshots, but
            # stale summaries must not expose a second realized-P&L answer to
            # fallback consumers or future merges.
            summary.update(
                {
                    "performance_snapshot": deepcopy(snapshot["performance_snapshot"]),
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot_source": snapshot[
                        "performance_snapshot_source"
                    ],
                    "performance_snapshot_as_of": snapshot.get(
                        "performance_snapshot_as_of", ""
                    ),
                    "performance_snapshot_evidence_id": snapshot.get(
                        "performance_snapshot_evidence_id",
                        "",
                    ),
                    "performance_snapshot_realized_evidence_ids": snapshot.get(
                        "performance_snapshot_realized_evidence_ids",
                        [],
                    ),
                }
            )

    for broker, summary in summaries.items():
        if broker == "hsbc":
            _ii_basics._refresh_hsbc_verified_tax_lot_history(summary, transactions)

    return summaries


def _hsbc_summary_components(
    summary: dict[str, Any],
) -> tuple[dict[str, Decimal], dict[str, str]]:
    """Read HSBC component balances and their latest visible dates from a summary."""
    components = _normalize_hsbc_ending_cash_components(
        summary.get("hsbc_ending_cash_components")
    )
    if not components:
        for (
            currency,
            raw_amount,
        ) in _ii_merge_identity._normalize_hsbc_currency_balance_map(
            summary.get("ending_cash_by_currency")
        ).items():
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
            if amount is not None:
                components[f"{currency}:LEGACY"] = amount
    dates = _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
        {
            _normalize_text(raw_key): _normalize_text(raw_value)
            for raw_key, raw_value in (
                summary.get("hsbc_cash_component_post_dates")
                if isinstance(summary.get("hsbc_cash_component_post_dates"), dict)
                else {}
            ).items()
        }
    )
    return components, dates


def _hsbc_summary_snapshot_sort_key(summary: dict[str, Any]) -> tuple[str, str]:
    """Sort HSBC summaries by the newest authoritative Portfolio timestamp."""
    candidates: list[tuple[str, str]] = []

    def append_candidate(raw_date: Any, raw_time: Any = "") -> None:
        date_text = _normalize_text(raw_date)[:10]
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", date_text):
            return
        time_text = _normalize_text(raw_time)[:8]
        if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", time_text):
            time_text = "00:00:00"
        candidates.append((date_text, time_text))

    append_candidate(summary.get("position_snapshot_as_of"))
    updated_at = summary.get("snapshot_updated_at")
    if isinstance(updated_at, str):
        append_candidate(updated_at[:10], updated_at[11:])
    hsbc_snapshot = summary.get("hsbc_snapshot")
    if isinstance(hsbc_snapshot, dict):
        market_data_updated_at = hsbc_snapshot.get("portfolio_market_data_updated_at")
        if isinstance(market_data_updated_at, dict):
            append_candidate(
                market_data_updated_at.get("date"),
                market_data_updated_at.get("time"),
            )
    position_snapshot = summary.get("position_snapshot")
    if isinstance(position_snapshot, dict):
        for entry in position_snapshot.values():
            if isinstance(entry, dict):
                append_candidate(entry.get("as_of"))
    return max(candidates, default=("", ""))


def _merge_hsbc_broker_summaries(
    existing_summary: dict[str, Any],
    incoming_summary: dict[str, Any],
) -> dict[str, Any]:
    """Merge HSBC summaries by cash subaccount instead of replacing the broker snapshot."""
    existing_components, existing_dates = _hsbc_summary_components(existing_summary)
    incoming_components, incoming_dates = _hsbc_summary_components(incoming_summary)
    merged_components = dict(existing_components)
    merged_dates = dict(existing_dates)
    _ii_hsbc_core._merge_hsbc_cash_component_values(
        merged_components,
        merged_dates,
        incoming_components,
        incoming_dates,
    )

    merged = {**existing_summary, **incoming_summary}
    snapshot_source = (
        incoming_summary
        if _hsbc_summary_snapshot_sort_key(incoming_summary)
        >= _hsbc_summary_snapshot_sort_key(existing_summary)
        else existing_summary
    )
    for field_name in (
        "hsbc_snapshot",
        "order_history_scope",
        "position_snapshot",
        "position_snapshot_authoritative",
        "position_snapshot_source",
        "position_snapshot_as_of",
        "position_snapshot_evidence_id",
        "holdings_validation",
    ):
        if field_name in snapshot_source:
            merged[field_name] = snapshot_source[field_name]
    if not merged_components:
        return merged

    ending_balances = _ii_hsbc_core._sum_hsbc_cash_balance_components(merged_components)
    merged["ending_cash_by_currency"] = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in ending_balances.items()
    }
    merged["hsbc_ending_cash_components"] = (
        _ii_hsbc_core._serialize_hsbc_cash_balance_components(merged_components)
    )
    merged["hsbc_cash_component_post_dates"] = (
        _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(merged_dates)
    )

    def incoming_component_wins(component_key: str) -> bool:
        """Return whether this incoming component actually replaced the existing one."""
        incoming_amount = incoming_components.get(component_key)
        if incoming_amount is None:
            return False
        incoming_currency, _, incoming_account_type = component_key.partition(":")
        normalized_currency = _ii_merge_identity._normalize_hsbc_currency_code(
            incoming_currency
        )
        if not normalized_currency:
            return False
        if _normalize_whitespace(incoming_account_type).upper() == "LEGACY" and any(
            _ii_merge_identity._normalize_hsbc_currency_code(
                existing_key.partition(":")[0]
            )
            == normalized_currency
            and _normalize_whitespace(existing_key.partition(":")[2]).upper()
            != "LEGACY"
            for existing_key in merged_components
        ):
            return False
        if component_key not in existing_components:
            return True
        incoming_date = _normalize_text(incoming_dates.get(component_key))
        existing_date = _normalize_text(existing_dates.get(component_key))
        if incoming_date and existing_date:
            return incoming_date >= existing_date
        if incoming_date and not existing_date:
            return True
        if not incoming_date and not existing_date:
            return True
        return False

    usd_balance = ending_balances.get("USD")
    if usd_balance is not None:
        usd_balance_text = _decimal_to_str(usd_balance) or "0"
        merged["ending_cash"] = usd_balance_text
        merged["ending_cash_raw"] = usd_balance_text
    elif _normalize_text(existing_summary.get("ending_cash")):
        for field_name in (
            "ending_cash",
            "ending_cash_raw",
            "ending_cash_base_currency",
        ):
            if field_name in existing_summary:
                merged[field_name] = existing_summary[field_name]

    incoming_usd_component_won = any(
        _ii_merge_identity._normalize_hsbc_currency_code(
            component_key.partition(":")[0]
        )
        == "USD"
        and incoming_component_wins(component_key)
        for component_key in incoming_components
    )
    if incoming_usd_component_won:
        if _normalize_text(incoming_summary.get("calibration_source")):
            merged["calibration_source"] = incoming_summary["calibration_source"]
        for field_name in (
            "cash_snapshot_source",
            "cash_snapshot_status",
            "current_moment_source",
            "ending_cash_base_currency",
            "starting_cash_base_currency",
            "cash_ledger_balance",
            "cash_ledger_balance_as_of",
            "cash_ledger_balance_source",
            "hsbc_bank_available_cash",
            "hsbc_available_cash_by_currency",
            "hsbc_available_cash_components",
        ):
            if field_name in incoming_summary:
                merged[field_name] = incoming_summary[field_name]
    else:
        for field_name in (
            "calibration_source",
            "cash_snapshot_source",
            "cash_snapshot_status",
            "current_moment_source",
            "ending_cash_base_currency",
            "starting_cash_base_currency",
            "cash_ledger_balance",
            "cash_ledger_balance_as_of",
            "cash_ledger_balance_source",
            "hsbc_bank_available_cash",
            "hsbc_available_cash_by_currency",
            "hsbc_available_cash_components",
        ):
            if field_name in existing_summary:
                merged[field_name] = existing_summary[field_name]

    return merged


def _has_same_hsbc_cash_source_row(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    """Return whether two HSBC cash rows identify the same source event."""
    if not (
        _ii_merge_identity._is_hsbc_cash_account_record(current)
        and _ii_merge_identity._is_hsbc_cash_account_record(incoming)
    ):
        return False

    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_file_kind = _normalize_text(current_source.get("file_kind"))
    incoming_file_kind = _normalize_text(incoming_source.get("file_kind"))
    if not current_file_kind or current_file_kind != incoming_file_kind:
        return False

    current_row = _normalize_text(
        current_source.get("row_number") or current_source.get("ledger_sequence")
    )
    incoming_row = _normalize_text(
        incoming_source.get("row_number") or incoming_source.get("ledger_sequence")
    )
    if not current_row or current_row != incoming_row:
        return False

    current_source_hash = _normalize_text(
        current_source.get("source_file_sha256")
    ).lower()
    incoming_source_hash = _normalize_text(
        incoming_source.get("source_file_sha256")
    ).lower()
    if (
        current_source_hash
        and incoming_source_hash
        and current_source_hash != incoming_source_hash
    ):
        return False
    current_filename = _normalize_text(current_source.get("source_filename"))
    incoming_filename = _normalize_text(incoming_source.get("source_filename"))
    if current_filename and incoming_filename and current_filename != incoming_filename:
        return False

    current_reference = _normalize_whitespace(
        current_source.get("reference_id") or current.get("description")
    ).casefold()
    incoming_reference = _normalize_whitespace(
        incoming_source.get("reference_id") or incoming.get("description")
    ).casefold()
    if not current_reference or current_reference != incoming_reference:
        return False

    current_event_key = _ii_merge_identity._hsbc_statement_cash_enrichment_key(current)
    incoming_event_key = _ii_merge_identity._hsbc_statement_cash_enrichment_key(
        incoming
    )
    return bool(current_event_key and current_event_key == incoming_event_key)


def _merge_hsbc_statement_metadata(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
    merged_transactions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Union HSBC statement metadata while leaving latest cash snapshot selection intact."""
    del merged_transactions
    metadata_pairs = [
        (
            candidate,
            _ii_merge_reconciliation._hsbc_statement_metadata_from_payload(candidate),
        )
        for candidate in (existing_payload, incoming_payload)
        if _ii_merge_reconciliation._payload_contains_hsbc_statement_component(
            candidate
        )
    ]
    if not metadata_pairs:
        return {}

    standalone_periods: set[str] = set()
    paired_periods: set[str] = set()
    fallback_statement_count = 0
    fallback_pair_count = 0
    has_pair_metadata = False
    statement_date_values: list[str] = []
    transaction_date_values: list[str] = []
    duplicate_row_count = 0

    def metadata_count(metadata: dict[str, Any], key: str) -> int:
        value = metadata.get(key)
        if isinstance(value, bool) or value is None:
            return 0
        try:
            normalized_value = int(str(value).strip())
        except (TypeError, ValueError):
            return 0
        return max(normalized_value, 0)

    for candidate, metadata in metadata_pairs:
        raw_periods = metadata.get("statement_periods")
        periods = {
            _normalize_text(period)
            for period in (raw_periods if isinstance(raw_periods, list) else [])
            if re.fullmatch(r"20\d{2}-\d{2}", _normalize_text(period))
        }
        pair_count = metadata_count(metadata, "statement_pair_count")
        composite_count = metadata_count(metadata, "composite_statement_count")
        investment_count = metadata_count(metadata, "investment_statement_count")
        is_paired = bool(pair_count or composite_count or investment_count)
        if is_paired:
            has_pair_metadata = True
            if periods:
                paired_periods.update(periods)
            else:
                fallback_pair_count += pair_count or max(
                    composite_count, investment_count, 1
                )
        elif periods:
            standalone_periods.update(periods)
        else:
            fallback_statement_count += metadata_count(metadata, "statement_count")

        for field_name in ("statement_date_min", "statement_date_max"):
            value = _normalize_text(metadata.get(field_name))
            if value:
                statement_date_values.append(value)
        for field_name in ("transaction_date_min", "transaction_date_max"):
            value = _normalize_text(metadata.get(field_name))
            if value:
                transaction_date_values.append(value)
        duplicate_row_count += metadata_count(metadata, "duplicate_statement_row_count")

        for record in _ii_merge_reconciliation._payload_transactions(candidate):
            source = (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            )
            if _normalize_text(source.get("file_kind")) != "hsbc_statement_cash":
                continue
            raw_date = _normalize_text(record.get("date"))[:10]
            try:
                transaction_date_values.append(date.fromisoformat(raw_date).isoformat())
            except ValueError:
                continue

    metadata_result: dict[str, Any] = {
        "historical_statement_backfill": True,
    }
    all_periods = sorted(standalone_periods | paired_periods)
    if all_periods:
        metadata_result["statement_periods"] = all_periods
        metadata_result["statement_count"] = (
            len(standalone_periods) + len(paired_periods) * 2
        )
    else:
        fallback_count = fallback_statement_count + fallback_pair_count * 2
        if fallback_count:
            metadata_result["statement_count"] = fallback_count
    if has_pair_metadata:
        metadata_result["statement_pair_count"] = (
            len(paired_periods) + fallback_pair_count
        )
        metadata_result["composite_statement_count"] = (
            len(paired_periods) + fallback_pair_count
        )
        metadata_result["investment_statement_count"] = (
            len(paired_periods) + fallback_pair_count
        )
    if statement_date_values:
        metadata_result["statement_date_min"] = min(statement_date_values)
        metadata_result["statement_date_max"] = max(statement_date_values)
    if duplicate_row_count:
        metadata_result["duplicate_statement_row_count"] = duplicate_row_count

    if transaction_date_values:
        metadata_result["transaction_date_min"] = min(transaction_date_values)
        metadata_result["transaction_date_max"] = max(transaction_date_values)
    return metadata_result


def _merge_broker_summaries(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    merged = _normalize_broker_summaries(existing_payload)
    incoming_broker = _ii_basics._normalize_broker_code(incoming_payload.get("broker"))

    for broker, incoming_summary in _normalize_broker_summaries(
        incoming_payload
    ).items():
        if (
            broker in merged
            and _ii_merge_identity._is_ibkr_web_trade_notification_payload(
                incoming_payload
            )
        ):
            continue
        if broker == "ibkr" and broker in merged:
            merged_summary = _merge_ibkr_cash_snapshot_fields(
                merged[broker],
                incoming_summary,
            )
            incoming_performance_source = _normalize_text(
                incoming_summary.get("performance_snapshot_source")
            )
            incoming_has_realized_summary_artifact = any(
                _normalize_text(artifact.get("source_kind"))
                == "ibkr_realized_summary_csv"
                for artifact in _ii_artifacts._normalize_source_artifacts(
                    incoming_payload.get("source_artifacts")
                )
            )
            if (
                incoming_performance_source == "ibkr_csv_realized_summary"
                and not incoming_has_realized_summary_artifact
                and isinstance(merged[broker].get("performance_snapshot"), dict)
                and merged[broker]["performance_snapshot"]
            ):
                # A summary without its immutable CSV artifact is incomplete
                # evidence and must not replace an existing broker P&L view.
                for field_name in (
                    "performance_snapshot",
                    "performance_snapshot_authoritative",
                    "performance_snapshot_source",
                    "performance_snapshot_as_of",
                    "performance_snapshot_evidence_id",
                ):
                    if field_name in merged[broker]:
                        merged_summary[field_name] = merged[broker][field_name]
                    else:
                        merged_summary.pop(field_name, None)
            merged[broker] = merged_summary
            continue
        if broker == "hsbc" and broker in merged:
            merged[broker] = _merge_hsbc_broker_summaries(
                merged[broker],
                incoming_summary,
            )
            continue
        if incoming_broker == broker:
            merged[broker] = incoming_summary
        elif broker not in merged:
            merged[broker] = incoming_summary

    return merged


def _attach_broker_summaries(payload: dict[str, Any]) -> None:
    payload["broker_summaries"] = _normalize_broker_summaries(payload)
