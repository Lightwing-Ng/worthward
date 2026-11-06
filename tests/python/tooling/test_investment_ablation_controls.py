"""Protect scoped, reversible private-evidence ablation controls.

Code version: v1.0.0
"""

from __future__ import annotations

from copy import deepcopy
import json

import pytest

from scripts.investment_ablation_controls import (
    strip_explicit_user_calibration_markers,
    strip_materialized_private_evidence,
)

PRIVATE_SOURCE = "user_confirmed_broker_performance_calibration"
ACCOUNT = "ABLATION-TEST-ACCOUNT"


@pytest.fixture
def private_evidence():
    return {
        "longbridge_hk_performance_calibrations": {ACCOUNT: {"TEST": "12.3400"}},
        "hsbc_performance_calibrations": {ACCOUNT: {"TEST": "12.3400"}},
        "verified_tax_lot_history": {
            "longbridge_hk": {ACCOUNT: {"TEST": {"currency": "USD", "verified": True}}},
        },
    }


def calibration(*, broker="longbridge_hk", amount="12.3400"):
    return {
        "asset_category": "Stocks", "currency": "USD", "realized_total": amount,
        "unrealized_total": "0", "total": amount,
        "calibration_source": "broker_reported_pnl" if broker == "hsbc" else PRIVATE_SOURCE,
        "realized_total_includes_nonperformance": True,
    }


def summary(*, broker="longbridge_hk", account=ACCOUNT):
    return {
        "broker": broker, "account": account,
        "performance_snapshot": {"TEST": calibration(broker=broker)},
        "performance_snapshot_authoritative": True,
        "performance_snapshot_source": PRIVATE_SOURCE,
    }


def test_private_control_preserves_all_financial_occurrences_and_source_artifacts(private_evidence):
    payload = {
        "transactions": [{"broker": "longbridge_hk", "net_amount_raw": "-0.00"}] * 2,
        "source_artifacts": [{"sha256": "e" * 64, "storage_key": "e" * 64}],
        "broker_summaries": {"longbridge_hk": summary()},
        "manual_internal_transfer_bindings": [{"source": "confirmed", "target": "confirmed"}],
        "future_metadata": {"unknown": [None, "", 10**30]},
    }
    original = deepcopy(payload)
    original_evidence = deepcopy(private_evidence)
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert payload == original and private_evidence == original_evidence
    assert result["transactions"] == original["transactions"]
    assert len(result["transactions"]) == 2
    assert result["source_artifacts"] == original["source_artifacts"]
    assert result["manual_internal_transfer_bindings"] == original["manual_internal_transfer_bindings"]
    assert result["future_metadata"] == original["future_metadata"]
    assert "performance_snapshot" not in result["broker_summaries"]["longbridge_hk"]
    assert audit["performance_entries_removed"] == 1 and audit["status"] == "supported"
    assert ACCOUNT not in json.dumps(audit) and "12.3400" not in json.dumps(audit)


def test_native_performance_in_a_matching_private_scope_is_preserved(private_evidence):
    row = summary()
    row["performance_snapshot_source"] = "longbridge_native_statement"
    row["performance_snapshot"]["TEST"]["calibration_source"] = "broker_native_realized_report"
    payload = {"broker_summaries": {"longbridge_hk": row}}
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert result == payload
    assert audit["performance_entries_removed"] == 0


@pytest.mark.parametrize(
    "change", ["wrong_amount", "extra_provenance", "conflicting_source", "wrong_account", "missing_account"],
)
def test_ambiguous_private_materializations_are_reported_without_deletion(private_evidence, change):
    row = summary()
    if change == "wrong_amount":
        row["performance_snapshot"]["TEST"]["realized_total"] = "99.00"
    elif change == "extra_provenance":
        row["performance_snapshot"]["TEST"]["statement_sha256"] = "f" * 64
    elif change == "conflicting_source":
        row["performance_snapshot_source"] = "broker_native_report"
    elif change == "wrong_account":
        row["account"] = "ANOTHER-TEST-ACCOUNT"
    else:
        del row["account"]
    payload = {"broker_summaries": {"longbridge_hk": row}}
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert result == payload
    assert audit["status"] == "unsupported" and audit["unsupported_count"] > 0


def test_generic_broker_reported_pnl_requires_private_container_provenance(private_evidence):
    row = summary(broker="hsbc")
    del row["performance_snapshot_source"]
    payload = {"broker_summaries": {"hsbc": row}}
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert result == payload
    assert audit["unsupported_reasons"]["ambiguous_broker_reported_pnl"] == 1
    row["performance_snapshot_source"] = PRIVATE_SOURCE
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert "performance_snapshot" not in result["broker_summaries"]["hsbc"]
    assert audit["performance_entries_removed"] == 1


def test_only_exact_private_tax_lot_materializations_are_removed(private_evidence):
    row = {"broker": "longbridge_hk", "account": ACCOUNT}
    row["tax_lot_history_verifications"] = deepcopy(
        private_evidence["verified_tax_lot_history"]["longbridge_hk"][ACCOUNT],
    )
    payload = {"broker_summaries": {"longbridge_hk": row}}
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert "tax_lot_history_verifications" not in result["broker_summaries"]["longbridge_hk"]
    assert audit["tax_lot_verifications_removed"] == 1
    row["tax_lot_history_verifications"]["TEST"]["independently_verified"] = True
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert result == payload
    assert audit["unsupported_reasons"]["tax_lot_verification_has_independent_changes"] == 1


def test_tax_lot_controls_preserve_distinct_json_boolean_and_number_types(private_evidence):
    row = {"broker": "longbridge_hk", "account": ACCOUNT}
    row["tax_lot_history_verifications"] = deepcopy(
        private_evidence["verified_tax_lot_history"]["longbridge_hk"][ACCOUNT],
    )
    row["tax_lot_history_verifications"]["TEST"]["verified"] = 1
    payload = {"broker_summaries": {"longbridge_hk": row}}
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    assert result == payload
    assert audit["tax_lot_verifications_removed"] == 0 and audit["status"] == "unsupported"


def test_snapshot_selected_values_and_history_are_controlled_without_touching_positions(private_evidence):
    native_position = {"TEST": {"quantity": "3", "currency": "USD"}}
    evidence_record = {**summary(), "position_snapshot": native_position, "position_snapshot_authoritative": True}
    snapshot = {**deepcopy(evidence_record), "evidence": [evidence_record]}
    reconciliation = {
        "broker": "longbridge_hk", "account": ACCOUNT, "ticker": "TEST",
        "source": PRIVATE_SOURCE, "baseline": {"currency": "USD", "realized_pnl": "12.34"},
    }
    snapshot["realized_pnl_reconciliation"] = {"TEST": reconciliation}
    payload = {
        "broker_snapshots": {"synthetic-snapshot": snapshot},
        "realized_pnl_reconciliation": {"synthetic-snapshot": {
            "broker": "longbridge_hk", "account": ACCOUNT, "tickers": {"TEST": deepcopy(reconciliation)},
        }},
    }
    result, audit = strip_materialized_private_evidence(payload, private_evidence)
    controlled = result["broker_snapshots"]["synthetic-snapshot"]
    assert controlled["position_snapshot"] == native_position
    assert controlled["evidence"][0]["position_snapshot"] == native_position
    assert "performance_snapshot" not in controlled and "performance_snapshot" not in controlled["evidence"][0]
    assert controlled["realized_pnl_reconciliation"] == {}
    assert result["realized_pnl_reconciliation"]["synthetic-snapshot"]["tickers"] == {}
    assert audit["performance_entries_removed"] == 2
    assert audit["reconciliation_entries_removed"] == 2
    assert audit["status"] == "supported"


def test_retained_native_entries_make_a_mixed_source_control_explicitly_unsupported(private_evidence):
    row = summary()
    native = {"calibration_source": "broker_native_report", "realized_total": "7", "currency": "USD"}
    row["performance_snapshot"]["NATIVE"] = deepcopy(native)
    result, audit = strip_materialized_private_evidence({"broker_summaries": {"longbridge_hk": row}}, private_evidence)
    assert result["broker_summaries"]["longbridge_hk"]["performance_snapshot"]["NATIVE"] == native
    assert audit["status"] == "unsupported"
    assert audit["unsupported_reasons"]["mixed_performance_container_requires_review"] == 1


def test_native_reconciliation_for_the_same_scope_remains_authoritative(private_evidence):
    row = summary()
    native = {
        "broker": "longbridge_hk", "account": ACCOUNT, "ticker": "TEST",
        "source": "broker_native_report", "baseline": {"currency": "USD", "realized_pnl": "12.34"},
    }
    row["realized_pnl_reconciliation"] = {"TEST": native}
    result, audit = strip_materialized_private_evidence({"broker_summaries": {"longbridge_hk": row}}, private_evidence)
    assert result["broker_summaries"]["longbridge_hk"]["realized_pnl_reconciliation"]["TEST"] == native
    assert audit["reconciliation_entries_removed"] == 0 and audit["status"] == "supported"


def test_external_and_materialized_controls_are_both_needed_across_real_normalization(monkeypatch, private_evidence):
    from app.services import investment_import

    payload = {
        "broker": "longbridge_hk", "account": ACCOUNT, "transactions": [],
        "broker_summaries": {"longbridge_hk": {"broker": "longbridge_hk", "account": ACCOUNT}},
    }
    monkeypatch.setattr(
        investment_import, "_load_local_private_investment_evidence", lambda: deepcopy(private_evidence),
    )
    materialized = investment_import.normalize_investment_payload_tickers(deepcopy(payload))
    materialized_snapshot = materialized["broker_summaries"]["longbridge_hk"]["performance_snapshot"]
    assert materialized_snapshot["TEST"]["calibration_source"] == PRIVATE_SOURCE
    controlled, audit = strip_materialized_private_evidence(materialized, private_evidence)
    assert audit["status"] == "supported"
    reinjected = investment_import.normalize_investment_payload_tickers(deepcopy(controlled))
    reinjected_snapshot = reinjected["broker_summaries"]["longbridge_hk"]["performance_snapshot"]
    assert reinjected_snapshot["TEST"]["calibration_source"] == PRIVATE_SOURCE

    monkeypatch.setattr(investment_import, "_load_local_private_investment_evidence", lambda: {})
    external_only = investment_import.normalize_investment_payload_tickers(deepcopy(materialized))
    retained_snapshot = external_only["broker_summaries"]["longbridge_hk"]["performance_snapshot"]
    assert retained_snapshot["TEST"]["calibration_source"] == PRIVATE_SOURCE
    complete = investment_import.normalize_investment_payload_tickers(deepcopy(controlled))
    complete = investment_import.normalize_investment_payload_tickers(deepcopy(complete))
    assert PRIVATE_SOURCE not in json.dumps(complete)
    assert not complete["broker_summaries"]["longbridge_hk"].get("tax_lot_history_verifications")
    assert complete["transactions"] == []


def test_non_object_inputs_are_rejected():
    with pytest.raises(TypeError):
        strip_materialized_private_evidence([], {})


def test_candidate_class_ablation_needs_no_external_account_mapping():
    row = summary(account="EXPLICIT-UNMAPPED-TEST-ACCOUNT")
    payload = {
        "broker_summaries": {"longbridge_hk": row},
        "transactions": [{"source": {"calibration_source": PRIVATE_SOURCE}}] * 2,
        "source_artifacts": [{"metadata": {"calibration_source": PRIVATE_SOURCE}}],
        "manual_internal_transfer_bindings": [{"confirmed": True}],
    }
    original = deepcopy(payload)
    controlled, audit = strip_explicit_user_calibration_markers(payload)
    assert payload == original
    assert controlled["transactions"] == original["transactions"]
    assert controlled["source_artifacts"] == original["source_artifacts"]
    assert controlled["manual_internal_transfer_bindings"] == original["manual_internal_transfer_bindings"]
    assert "performance_snapshot" not in controlled["broker_summaries"]["longbridge_hk"]
    assert audit["performance_entries_removed"] == 1
    assert audit["status"] == "candidate_class_ablation_unvalidated"
    assert audit["accounting_validated"] is False and audit["mechanism_complete"] is True


def test_candidate_class_ablation_preserves_native_and_generic_broker_reported_facts():
    row = summary()
    native = {"calibration_source": "broker_native_report", "realized_total": "9.00", "currency": "USD"}
    generic = calibration(broker="hsbc")
    row["performance_snapshot"].update({"NATIVE": native, "GENERIC": generic})
    payload = {"broker_summaries": {"longbridge_hk": row}}
    controlled, audit = strip_explicit_user_calibration_markers(payload)
    remaining = controlled["broker_summaries"]["longbridge_hk"]
    assert remaining["performance_snapshot"] == {"NATIVE": native, "GENERIC": generic}
    assert remaining["performance_snapshot_source"] == PRIVATE_SOURCE
    assert remaining["performance_snapshot_authoritative"] is True
    assert audit["performance_entries_removed"] == 1
    assert audit["mixed_containers_retaining_other_performance"] == 1


@pytest.mark.parametrize("missing", ["broker", "account", "conflicting_account_id"])
def test_candidate_class_ablation_retains_unknown_or_conflicting_scope(missing):
    row = summary()
    if missing == "conflicting_account_id":
        row["account_id"] = "A-DIFFERENT-TEST-ACCOUNT"
    else:
        del row[missing]
    payload = {"broker_snapshots": {"anonymous-snapshot": row}}
    controlled, audit = strip_explicit_user_calibration_markers(payload)
    assert controlled == payload
    assert audit["performance_entries_removed"] == 0
    assert audit["mechanism_complete"] is False and audit["unsupported_count"] == 1


def test_candidate_class_ablation_removes_only_related_manual_reconciliation():
    manual_record = {
        "broker": "longbridge_hk", "account": ACCOUNT, "source": PRIVATE_SOURCE,
        "baseline": {"currency": "USD", "realized_pnl": "12.34"},
    }
    native_record = {**manual_record, "source": "broker_native_report"}
    row = summary()
    row["position_snapshot"] = {"TEST": {"quantity": "3.00"}}
    row["realized_pnl_reconciliation"] = {"TEST": manual_record, "OTHER": native_record}
    payload = {"broker_snapshots": {"anonymous-snapshot": row}}
    controlled, audit = strip_explicit_user_calibration_markers(payload)
    remaining = controlled["broker_snapshots"]["anonymous-snapshot"]
    assert remaining["realized_pnl_reconciliation"] == {"OTHER": native_record}
    assert remaining["position_snapshot"] == row["position_snapshot"]
    assert audit["performance_entries_removed"] == 1 and audit["reconciliation_entries_removed"] == 1
    again, repeated = strip_explicit_user_calibration_markers(controlled)
    assert again == controlled and repeated["performance_entries_removed"] == 0
