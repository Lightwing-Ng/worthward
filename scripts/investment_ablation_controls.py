"""Conservative, in-memory controls for private-evidence ablation experiments.

Code version: v1.0.0
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import json
from typing import Any

_PRIVATE_SOURCE = "user_confirmed_broker_performance_calibration"
_CALIBRATION_KEYS = {
    "longbridge_hk": "longbridge_hk_performance_calibrations",
    "longbridge_sg": "longbridge_sg_performance_calibrations",
    "hsbc": "hsbc_performance_calibrations",
}
_GENERATED_ENTRY_KEYS = frozenset({
    "asset_category", "currency", "realized_total", "unrealized_total", "total",
    "calibration_source", "realized_total_includes_nonperformance",
})
_PERFORMANCE_FIELDS = (
    "performance_snapshot", "performance_snapshot_authoritative",
    "performance_snapshot_source", "performance_snapshot_as_of",
    "performance_snapshot_evidence_id", "performance_snapshot_realized_evidence_ids",
)


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _broker(value: Any) -> str:
    raw = _text(value).lower()
    return "longbridge_hk" if raw == "longbridge" else raw


def _ticker(value: Any) -> str:
    # Restrict equivalence to the established U.S. transport suffix. Other
    # uncertain aliases remain unmatched instead of broadening private scope.
    raw = _text(value).upper()
    return raw[:-3] if raw.endswith(".US") else raw


def _scope(container: dict[str, Any], broker_hint: str = "") -> tuple[str, str] | None:
    broker = _broker(container.get("broker") or broker_hint)
    if broker_hint and broker != _broker(broker_hint):
        return None
    account, account_id = _text(container.get("account")), _text(container.get("account_id"))
    if account and account_id and account != account_id:
        return None
    selected_account = account_id or account
    if broker in {"", "multiple", "unknown"} or selected_account.lower() in {"", "multiple", "unknown"}:
        return None
    return broker, selected_account


def _money_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return False
    try:
        lhs = Decimal(_text(left).replace(",", ""))
        rhs = Decimal(_text(right).replace(",", ""))
        return lhs.is_finite() and rhs.is_finite() and lhs == rhs
    except (InvalidOperation, ValueError):
        return False


def _json_equal(left: Any, right: Any) -> bool:
    try:
        options = {"sort_keys": True, "ensure_ascii": False, "allow_nan": False}
        return json.dumps(left, **options) == json.dumps(right, **options)
    except (TypeError, ValueError):
        return False


def _private_scopes(evidence: dict[str, Any]) -> tuple[dict[tuple, Any], dict[tuple, Any]]:
    calibrations: dict[tuple, Any] = {}
    tax_lots: dict[tuple, Any] = {}
    for broker, key in _CALIBRATION_KEYS.items():
        accounts = evidence.get(key)
        if not isinstance(accounts, dict):
            continue
        for account, entries in accounts.items():
            if not _text(account) or not isinstance(entries, dict):
                continue
            for ticker, value in entries.items():
                normalized = _ticker(ticker)
                if normalized:
                    calibrations[(broker, _text(account), normalized)] = value
    raw_lots = evidence.get("verified_tax_lot_history")
    if isinstance(raw_lots, dict):
        for broker, accounts in raw_lots.items():
            if not isinstance(accounts, dict):
                continue
            for account, entries in accounts.items():
                if not _text(account) or not isinstance(entries, dict):
                    continue
                for ticker, value in entries.items():
                    normalized = _ticker(ticker)
                    if normalized and isinstance(value, dict):
                        tax_lots[(_broker(broker), _text(account), normalized)] = value
    return calibrations, tax_lots


def _payload_containers(payload: dict[str, Any]) -> list[tuple[dict[str, Any], tuple[str, str] | None]]:
    root_scope = _scope(payload)
    containers = [(payload, root_scope)]
    summary = payload.get("summary")
    if isinstance(summary, dict):
        summary_scope = _scope(summary)
        if summary_scope is None and not any(
            name in summary for name in ("broker", "account", "account_id")
        ):
            summary_scope = root_scope
        containers.append((summary, summary_scope))
    summaries = payload.get("broker_summaries")
    if isinstance(summaries, dict):
        for broker, summary in summaries.items():
            if isinstance(summary, dict):
                containers.append((summary, _scope(summary, _text(broker))))
    snapshots = payload.get("broker_snapshots")
    if isinstance(snapshots, dict):
        for snapshot in snapshots.values():
            if not isinstance(snapshot, dict):
                continue
            containers.append((snapshot, _scope(snapshot)))
            raw_evidence = snapshot.get("evidence")
            if isinstance(raw_evidence, list):
                containers.extend(
                    (record, _scope(record)) for record in raw_evidence
                    if isinstance(record, dict)
                )
    return containers


def strip_materialized_private_evidence(
    payload: dict[str, Any], evidence: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Remove only provable private materializations from a disposable payload copy.

    This function performs no I/O and never edits the supplied arguments. It
    leaves ambiguous or enriched records intact and reports an unsupported
    reason. Callers must normalize the result with their selected external
    evidence control before comparing accounting outputs. Transactions, source
    artifacts, cash, positions, and manual user choices are never edited.
    """
    if not isinstance(payload, dict) or not isinstance(evidence, dict):
        raise TypeError("Ablation controls require payload and evidence objects.")
    copied = deepcopy(payload)
    calibrations, tax_lots = _private_scopes(evidence)
    counts: Counter[str] = Counter()
    unsupported: Counter[str] = Counter()
    removed_scopes: set[tuple[str, str, str]] = set()

    def process(container: dict[str, Any], scope: tuple[str, str] | None) -> None:
        snapshots = container.get("performance_snapshot")
        if isinstance(snapshots, dict):
            removed_here = 0
            for ticker, entry in list(snapshots.items()):
                if not isinstance(entry, dict):
                    continue
                source = _text(entry.get("calibration_source"))
                if source not in {_PRIVATE_SOURCE, "broker_reported_pnl"}:
                    continue
                if scope is None:
                    if source == _PRIVATE_SOURCE:
                        unsupported["missing_or_conflicting_scope"] += 1
                    continue
                key = (*scope, _ticker(ticker))
                if key not in calibrations:
                    if source == _PRIVATE_SOURCE:
                        unsupported["private_marker_outside_evidence_scope"] += 1
                    continue
                container_source = _text(container.get("performance_snapshot_source"))
                if container_source not in {"", _PRIVATE_SOURCE}:
                    unsupported["native_or_conflicting_container_source"] += 1
                    continue
                if source == "broker_reported_pnl" and (
                    scope[0] != "hsbc" or container_source != _PRIVATE_SOURCE
                ):
                    unsupported["ambiguous_broker_reported_pnl"] += 1
                    continue
                expected_source = "broker_reported_pnl" if scope[0] == "hsbc" else _PRIVATE_SOURCE
                if (
                    source != expected_source or frozenset(entry) != _GENERATED_ENTRY_KEYS
                    or entry.get("asset_category") != "Stocks"
                    or _text(entry.get("currency")).upper() != "USD"
                    or entry.get("realized_total_includes_nonperformance") is not True
                    or not _money_equal(entry.get("realized_total"), calibrations[key])
                    or not _money_equal(entry.get("total"), calibrations[key])
                    or not _money_equal(entry.get("unrealized_total"), "0")
                ):
                    unsupported["calibration_value_or_provenance_differs"] += 1
                    continue
                del snapshots[ticker]
                removed_here += 1
                removed_scopes.add(key)
                counts["performance_entries_removed"] += 1
            if not snapshots and removed_here:
                for field in _PERFORMANCE_FIELDS:
                    if field in container:
                        del container[field]
                        counts["performance_fields_removed"] += 1
            elif snapshots and container.get("performance_snapshot_source") == _PRIVATE_SOURCE:
                # A shared container source cannot be reassigned to retained native facts.
                if removed_here:
                    unsupported["mixed_performance_container_requires_review"] += 1

        verifications = container.get("tax_lot_history_verifications")
        if isinstance(verifications, dict) and scope is not None:
            removed = 0
            for ticker, verification in list(verifications.items()):
                key = (*scope, _ticker(ticker))
                if key not in tax_lots:
                    continue
                if not _json_equal(verification, tax_lots[key]):
                    unsupported["tax_lot_verification_has_independent_changes"] += 1
                    continue
                del verifications[ticker]
                removed += 1
                counts["tax_lot_verifications_removed"] += 1
            if not verifications and removed:
                del container["tax_lot_history_verifications"]

    containers = _payload_containers(copied)
    for container, scope in containers:
        process(container, scope)

    def strip_reconciliation(records: dict[str, Any], scope: tuple[str, str] | None) -> None:
        if scope is None:
            return
        for ticker, record in list(records.items()):
            if not isinstance(record, dict):
                continue
            key = (*scope, _ticker(ticker))
            if key not in removed_scopes:
                continue
            source = _text(record.get("source"))
            if source not in {_PRIVATE_SOURCE, "broker_reported_pnl"}:
                continue
            if _scope(record) != scope or source != _PRIVATE_SOURCE:
                unsupported["reconciliation_not_provably_private"] += 1
                continue
            baseline = record.get("baseline")
            if not isinstance(baseline, dict) or not _money_equal(
                baseline.get("realized_pnl"), calibrations[key],
            ):
                unsupported["reconciliation_baseline_differs"] += 1
                continue
            del records[ticker]
            counts["reconciliation_entries_removed"] += 1

    for container, scope in containers:
        records = container.get("realized_pnl_reconciliation")
        if isinstance(records, dict):
            strip_reconciliation(records, scope)
    root_reconciliations = copied.get("realized_pnl_reconciliation")
    if isinstance(root_reconciliations, dict):
        for record in root_reconciliations.values():
            if isinstance(record, dict) and isinstance(record.get("tickers"), dict):
                strip_reconciliation(record["tickers"], _scope(record))

    audit: dict[str, Any] = {
        name: counts[name] for name in (
            "performance_entries_removed", "performance_fields_removed",
            "tax_lot_verifications_removed", "reconciliation_entries_removed",
        )
    }
    audit["unsupported_count"] = sum(unsupported.values())
    audit["unsupported_reasons"] = dict(sorted(unsupported.items()))
    audit["status"] = "unsupported" if unsupported else "supported"
    audit["normalization_required"] = bool(sum(counts.values()))
    return copied, audit


def strip_explicit_user_calibration_markers(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Explore the influence of explicitly manual performance entries in a copy.

    This candidate-class ablation does not validate an account alias, financial
    correctness, obsolescence, or permission to clean anything. It recognizes
    only the exact user-confirmed entry marker and a container's explicit
    broker/account scope. Generic broker-reported P&L, native reports, tax-lot
    verifications, source artifacts, transactions, positions, and cash survive.
    """
    if not isinstance(payload, dict):
        raise TypeError("Ablation controls require a payload object.")
    copied = deepcopy(payload)
    containers = _payload_containers(copied)
    counts: Counter[str] = Counter()
    unsupported: Counter[str] = Counter()
    removed_scopes: set[tuple[str, str, str]] = set()
    emptied: list[tuple[dict[str, Any], tuple[str, str]]] = []
    for container, scope in containers:
        snapshot = container.get("performance_snapshot")
        if not isinstance(snapshot, dict):
            continue
        removed_here = 0
        for ticker, entry in list(snapshot.items()):
            if not isinstance(entry, dict) or entry.get("calibration_source") != _PRIVATE_SOURCE:
                continue
            if scope is None:
                unsupported["missing_or_conflicting_scope"] += 1
                continue
            del snapshot[ticker]
            removed_scopes.add((*scope, _ticker(ticker)))
            removed_here += 1
            counts["performance_entries_removed"] += 1
        if removed_here and not snapshot:
            emptied.append((container, scope))
        elif removed_here:
            counts["mixed_containers_retaining_other_performance"] += 1

    for container, _scope_value in emptied:
        for field in _PERFORMANCE_FIELDS:
            if field in container:
                del container[field]
                counts["performance_fields_removed"] += 1

    def strip_reconciliation(records: dict[str, Any], scope: tuple[str, str] | None) -> None:
        if scope is None:
            return
        for ticker, record in list(records.items()):
            if (
                isinstance(record, dict) and (*scope, _ticker(ticker)) in removed_scopes
                and _scope(record) == scope and record.get("source") == _PRIVATE_SOURCE
            ):
                del records[ticker]
                counts["reconciliation_entries_removed"] += 1

    for container, scope in containers:
        records = container.get("realized_pnl_reconciliation")
        if isinstance(records, dict):
            strip_reconciliation(records, scope)
    root_reconciliations = copied.get("realized_pnl_reconciliation")
    if isinstance(root_reconciliations, dict):
        for record in root_reconciliations.values():
            if isinstance(record, dict) and isinstance(record.get("tickers"), dict):
                strip_reconciliation(record["tickers"], _scope(record))
    audit: dict[str, Any] = {
        name: counts[name] for name in (
            "performance_entries_removed", "performance_fields_removed",
            "reconciliation_entries_removed", "mixed_containers_retaining_other_performance",
        )
    }
    audit.update({
        "status": "candidate_class_ablation_unvalidated",
        "accounting_validated": False,
        "mechanism_complete": not unsupported,
        "unsupported_count": sum(unsupported.values()),
        "unsupported_reasons": dict(sorted(unsupported.items())),
        "normalization_required": bool(sum(counts.values())),
    })
    return copied, audit
