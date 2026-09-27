"""Investment import domain: hsbc current cash boundary.

Code version: v0.2.0
- Fixed: Keep current cash boundaries scoped to HSBC and reject invalid money.
- Added: HSBC posting-balance repair and authoritative current-cash boundary
  synchronization moved out of the hsbc reconciliation module to keep each
  first-party module within the repository size contract.
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    deepcopy,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.brokers.hsbc.core as _ii_hsbc_core

import app.services.investment.importing.merge.identity as _ii_merge_identity

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries


def _hsbc_cash_boundary_money_text(value: Any) -> str | None:
    """Validate raw money before a legacy helper can discard its formatting."""
    amount = _ii_hsbc_cash._parse_hsbc_money_or_none(value)
    return _decimal_to_str(amount) if amount is not None else None


def _hsbc_cash_boundary_inference_records(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep invalid raw balances out of legacy current-cash inference."""
    candidates = deepcopy(transactions)
    for record in candidates:
        source = record.get("source")
        if not isinstance(source, dict):
            continue
        if "cash_settlement_balance_after_raw" in source:
            source["cash_settlement_balance_after_raw"] = (
                _hsbc_cash_boundary_money_text(
                    source["cash_settlement_balance_after_raw"]
                )
            )
        postings = source.get("cash_settlement_postings")
        if not isinstance(postings, list):
            continue
        for posting in postings:
            if isinstance(posting, dict) and "balance_after_raw" in posting:
                posting["balance_after_raw"] = _hsbc_cash_boundary_money_text(
                    posting["balance_after_raw"]
                )
    return candidates


def _reconcile_hsbc_order_settlement_balances_from_postings(
    transactions: list[dict[str, Any]],
) -> int:
    updated_count = 0
    for record in transactions:
        if not isinstance(record, dict):
            continue
        if _ii_basics._normalize_broker_code(record.get("broker")) != "hsbc":
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _ii_hsbc_cash._finalize_hsbc_order_settlement_balance(
            source,
            order_record=record,
        ):
            updated_count += 1
        record["source"] = source
    return updated_count


def _synchronize_hsbc_authoritative_current_cash_boundary(
    payload: dict[str, Any],
) -> bool:
    """Align verified HSBC cash without attesting a merged portfolio snapshot."""
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    is_single_hsbc_account = (
        _ii_basics._normalize_broker_code(payload.get("broker")) == "hsbc"
        and _normalize_text(payload.get("account")) != "multiple"
    )
    # Generic merged balances describe the whole portfolio. Only explicitly
    # HSBC-scoped compatibility fields may supplement its broker summary.
    fallback_summary = (
        summary
        if is_single_hsbc_account
        else {
            key: value
            for key, value in summary.items()
            if key.startswith("hsbc_")
        }
    )
    broker_summaries = payload.get("broker_summaries")
    hsbc_summary = (
        broker_summaries.get("hsbc")
        if isinstance(broker_summaries, dict)
        and isinstance(broker_summaries.get("hsbc"), dict)
        else {}
    )
    snapshot = (
        hsbc_summary.get("hsbc_snapshot")
        if isinstance(hsbc_summary.get("hsbc_snapshot"), dict)
        else fallback_summary.get("hsbc_snapshot")
        if isinstance(fallback_summary.get("hsbc_snapshot"), dict)
        else {}
    )
    scoped_summary = {**fallback_summary, **hsbc_summary}
    raw_components = scoped_summary.get("hsbc_ending_cash_components")
    if isinstance(raw_components, dict):
        scoped_summary["hsbc_ending_cash_components"] = {
            key: amount
            for key, raw_amount in raw_components.items()
            if (amount := _ii_hsbc_cash._parse_hsbc_money_or_none(raw_amount))
            is not None
        }
    raw_ending_balances = (
        hsbc_summary.get("ending_cash_by_currency")
        or (payload.get("ending_cash_by_currency") if is_single_hsbc_account else None)
        or scoped_summary.get("ending_cash_by_currency")
    )
    ending_balances = (
        {
            currency: amount
            for currency, raw_amount in raw_ending_balances.items()
            if (amount := _ii_hsbc_cash._parse_hsbc_money_or_none(raw_amount))
            is not None
        }
        if isinstance(raw_ending_balances, dict)
        else {}
    )
    hsbc_transactions = [
        record
        for record in _ii_merge_reconciliation._payload_transactions(payload)
        if _ii_basics._normalize_broker_code(record.get("broker")) == "hsbc"
    ]
    scoped_payload = {
        "summary": scoped_summary,
        "ending_cash_by_currency": ending_balances,
        "transactions": hsbc_transactions,
    }
    components = _ii_payload_summaries._payload_hsbc_ending_cash_components(
        scoped_payload
    )
    component_dates = _ii_payload_summaries._payload_hsbc_cash_component_post_dates(
        scoped_payload
    )
    cash_post_date = _normalize_text(snapshot.get("cash_latest_post_date"))
    if not cash_post_date:
        cash_posting_lag = snapshot.get("cash_posting_lag")
        if isinstance(cash_posting_lag, dict):
            cash_post_date = _normalize_text(
                cash_posting_lag.get("latest_cash_post_date")
            )
    cash_post_date = _normalize_text(
        cash_post_date
        or hsbc_summary.get("cash_ledger_balance_as_of")
        or fallback_summary.get("cash_ledger_balance_as_of")
        or hsbc_summary.get("ending_cash_base_currency_as_of")
        or fallback_summary.get("ending_cash_base_currency_as_of")
        or hsbc_summary.get("cash_snapshot_as_of")
        or fallback_summary.get("cash_snapshot_as_of")
    )[:10]
    current_cash_status = _normalize_text(
        hsbc_summary.get("ending_cash_base_currency_status")
        or fallback_summary.get("ending_cash_base_currency_status")
    )
    current_cash_brokers = summary.get("authoritative_current_cash_brokers")
    has_current_cash_scope = isinstance(current_cash_brokers, list) and "hsbc" in {
        _ii_basics._normalize_broker_code(value) for value in current_cash_brokers
    }
    if (
        not cash_post_date
        and current_cash_status
        not in {
            "authoritative_current_cash_boundary",
            "authoritative_effective_boundary",
        }
        and not has_current_cash_scope
    ):
        return False

    raw_current_cash = hsbc_summary.get("cash_ledger_balance")
    if raw_current_cash is None or raw_current_cash == "":
        raw_current_cash = fallback_summary.get("cash_ledger_balance")
    current_cash = _ii_hsbc_cash._parse_hsbc_money_or_none(raw_current_cash)
    current_cash_source = _normalize_text(
        hsbc_summary.get("cash_ledger_balance_source")
        or fallback_summary.get("cash_ledger_balance_source")
    )
    if current_cash is not None:
        cash_post_date = _normalize_text(
            hsbc_summary.get("cash_ledger_balance_as_of")
            or fallback_summary.get("cash_ledger_balance_as_of")
            or cash_post_date
        )[:10]
    if current_cash is None:
        inferred_boundary = _ii_payload_summaries._infer_hsbc_settled_usd_cash_boundary(
            _hsbc_cash_boundary_inference_records(hsbc_transactions),
            account=_normalize_text(
                hsbc_summary.get("account") or fallback_summary.get("account")
            ),
            expected_as_of=cash_post_date,
        )
        if inferred_boundary is not None:
            inferred_cash, inferred_date = inferred_boundary
            current_cash = _ii_hsbc_cash._parse_hsbc_money_or_none(inferred_cash)
            if current_cash is not None:
                cash_post_date = inferred_date
            current_cash_source = "hsbc_settlement_posting_balance_reconstruction"
    if current_cash is None:
        declared_boundary = (
            _ii_payload_summaries._resolve_hsbc_declared_current_cash_boundary(
                {
                    **hsbc_summary,
                    "ending_cash_base_currency": _hsbc_cash_boundary_money_text(
                        hsbc_summary.get("ending_cash_base_currency")
                    ),
                },
                {
                    **fallback_summary,
                    "ending_cash_base_currency": _hsbc_cash_boundary_money_text(
                        fallback_summary.get("ending_cash_base_currency")
                    ),
                },
                has_current_cash_scope=has_current_cash_scope,
            )
        )
        if declared_boundary is not None:
            declared_cash, declared_as_of, declared_source = declared_boundary
            current_cash = _ii_hsbc_cash._parse_hsbc_money_or_none(declared_cash)
            if current_cash is not None:
                cash_post_date = declared_as_of or cash_post_date
                current_cash_source = declared_source
    if current_cash is None and not is_single_hsbc_account:
        current_cash = components.get("USD:SAVINGS")
        if current_cash is not None:
            cash_post_date = component_dates.get("USD:SAVINGS") or cash_post_date
    if current_cash is None:
        return False
    current_cash_text = _decimal_to_str(current_cash) or "0"
    current_cash_source = current_cash_source or "hsbc_usd_savings_ledger_balance"
    raw_available_cash = hsbc_summary.get("hsbc_bank_available_cash")
    if raw_available_cash is None or raw_available_cash == "":
        raw_available_cash = fallback_summary.get("hsbc_bank_available_cash")
    available_cash = _ii_hsbc_cash._parse_hsbc_money_or_none(raw_available_cash)
    if available_cash is None:
        available_cash = current_cash

    for component_key in list(components):
        currency, _, account_type = component_key.partition(":")
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(currency) == "USD"
            and _normalize_whitespace(account_type).upper() == "LEGACY"
        ):
            components.pop(component_key, None)
            component_dates.pop(component_key, None)
    components["USD:SAVINGS"] = current_cash
    if cash_post_date:
        component_dates["USD:SAVINGS"] = cash_post_date
    serialized_components = _ii_hsbc_core._serialize_hsbc_cash_balance_components(
        components
    )
    serialized_dates = _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
        component_dates
    )
    ending_by_currency = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in _ii_hsbc_core._sum_hsbc_cash_balance_components(
            components
        ).items()
    }
    pending_summary = _ii_hsbc_cash._summarize_hsbc_pending_settlement_cash(
        hsbc_transactions,
        available_cash,
        broker_cash_balance=current_cash,
    )
    cash_snapshot_updates = {
        "cash_snapshot_authoritative": True,
        "cash_snapshot_status": "current",
    }
    summary_updates = {
        "hsbc_ending_cash_components": serialized_components,
        "hsbc_cash_component_post_dates": serialized_dates,
        "cash_ledger_balance": current_cash_text,
        "cash_ledger_balance_as_of": cash_post_date,
        "cash_ledger_balance_source": current_cash_source,
        **cash_snapshot_updates,
        **pending_summary,
    }
    if is_single_hsbc_account:
        summary_updates.update(
            {
                "ending_cash_base_currency": current_cash_text,
                "ending_cash_base_currency_as_of": cash_post_date,
                "ending_cash_base_currency_source": current_cash_source,
                "ending_cash_by_currency": ending_by_currency,
            }
        )
    summary.update(
        summary_updates
        if is_single_hsbc_account
        else {
            key: value
            for key, value in summary_updates.items()
            if key.startswith("hsbc_")
        }
    )
    if not isinstance(broker_summaries, dict):
        broker_summaries = {}
        payload["broker_summaries"] = broker_summaries
    broker_summaries["hsbc"] = hsbc_summary
    if isinstance(hsbc_summary, dict):
        hsbc_summary.update(
            {
                "ending_cash": current_cash_text,
                "ending_cash_raw": current_cash_text,
                "ending_cash_base_currency": current_cash_text,
                "ending_cash_base_currency_as_of": cash_post_date,
                "ending_cash_base_currency_source": current_cash_source,
                "ending_cash_by_currency": ending_by_currency,
                "hsbc_ending_cash_components": serialized_components,
                "hsbc_cash_component_post_dates": serialized_dates,
                "cash_ledger_balance": current_cash_text,
                "cash_ledger_balance_as_of": cash_post_date,
                "cash_ledger_balance_source": current_cash_source,
                **cash_snapshot_updates,
                **pending_summary,
            }
        )
        hsbc_summary["ending_cash_base_currency_status"] = (
            "authoritative_current_cash_boundary"
        )
    if is_single_hsbc_account:
        payload["ending_cash"] = current_cash_text
        payload["ending_cash_base_currency"] = current_cash_text
        payload["ending_cash_by_currency"] = ending_by_currency
    return True


def _preserve_authoritative_current_cash_scope(
    payload: dict[str, Any],
    *source_payloads: dict[str, Any],
) -> None:
    """Carry a verified cross-broker current-cash scope through a merge."""
    candidates: list[tuple[str, int, dict[str, Any], dict[str, Any]]] = []
    for source_index, source_payload in enumerate(source_payloads):
        source_summary = (
            source_payload.get("summary")
            if isinstance(source_payload.get("summary"), dict)
            else {}
        )
        raw_brokers = source_summary.get("authoritative_current_cash_brokers")
        if not isinstance(raw_brokers, list):
            continue
        brokers = [
            _ii_basics._normalize_broker_code(value)
            for value in raw_brokers
            if _ii_basics._normalize_broker_code(value)
        ]
        if not brokers:
            continue
        confirmed_on = _normalize_text(
            source_summary.get("authoritative_current_cash_scope_confirmed_on")
        )
        candidates.append((confirmed_on, source_index, source_payload, source_summary))
    if not candidates:
        return

    _confirmed_on, _source_index, source_payload, source_summary = max(candidates)
    target_summary = payload.get("summary")
    if not isinstance(target_summary, dict):
        target_summary = {}
        payload["summary"] = target_summary
    for field_name in (
        "authoritative_current_cash_brokers",
        "authoritative_current_cash_scope_confirmed_on",
        "authoritative_current_cash_scope_source",
    ):
        if field_name in source_summary:
            target_summary[field_name] = deepcopy(source_summary[field_name])

    # Keep the exact HSBC effective-cash field available to the final boundary
    # synchronizer even when transaction-derived component inference ran first.
    if "hsbc" not in {
        _ii_basics._normalize_broker_code(value)
        for value in target_summary.get("authoritative_current_cash_brokers", [])
    }:
        return
    source_broker_summaries = source_payload.get("broker_summaries")
    if not isinstance(source_broker_summaries, dict):
        return
    source_hsbc_summary = source_broker_summaries.get("hsbc")
    if not isinstance(source_hsbc_summary, dict):
        return
    target_broker_summaries = payload.get("broker_summaries")
    if not isinstance(target_broker_summaries, dict):
        target_broker_summaries = {}
        payload["broker_summaries"] = target_broker_summaries
    target_hsbc_summary = target_broker_summaries.get("hsbc")
    if not isinstance(target_hsbc_summary, dict):
        target_hsbc_summary = {}
        target_broker_summaries["hsbc"] = target_hsbc_summary
    source_cash_as_of = _normalize_text(
        source_hsbc_summary.get("ending_cash_base_currency_as_of")
        or source_hsbc_summary.get("cash_snapshot_as_of")
    )[:10]
    target_cash_as_of = _normalize_text(
        target_hsbc_summary.get("ending_cash_base_currency_as_of")
        or target_hsbc_summary.get("cash_snapshot_as_of")
    )[:10]
    target_components = _ii_payload_summaries._normalize_hsbc_ending_cash_components(
        target_hsbc_summary.get("hsbc_ending_cash_components")
    )
    target_usd_component = target_components.get("USD:SAVINGS")
    if (
        source_cash_as_of
        and target_cash_as_of
        and source_cash_as_of == target_cash_as_of
        and target_usd_component is not None
    ):
        # The merged component map is the more precise current-cash evidence
        # when an incoming capture shares the scope attestation's date.
        target_hsbc_summary["ending_cash_base_currency"] = (
            _decimal_to_str(target_usd_component) or "0"
        )
    for field_name in (
        "ending_cash_base_currency",
        "ending_cash_base_currency_as_of",
        "ending_cash_base_currency_source",
        "ending_cash_base_currency_status",
    ):
        should_copy = (
            field_name in source_hsbc_summary and field_name not in target_hsbc_summary
        )
        if (
            field_name in source_hsbc_summary
            and field_name in target_hsbc_summary
            and source_cash_as_of
            and target_cash_as_of
        ):
            # An equally dated incoming HSBC cash capture is newer evidence
            # than the scope attestation that selected the older snapshot.
            # Keep the incoming value instead of rolling it back silently.
            should_copy = target_cash_as_of < source_cash_as_of
        if should_copy:
            target_hsbc_summary[field_name] = deepcopy(source_hsbc_summary[field_name])
