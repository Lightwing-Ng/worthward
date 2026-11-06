"""Keep manual-calibration linkage audits separate from broker proof.

Code version: v1.1.0
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys

import pytest

from scripts.audit_manual_calibration_evidence import audit_calibrations
from scripts import audit_manual_calibration_evidence as audit_module

MANUAL = "user_confirmed_broker_performance_calibration"


@pytest.fixture
def inputs():
    entry = {"calibration_source": MANUAL, "realized_total": "12.3400", "currency": "USD"}
    payload = {
        "transactions": [], "source_artifacts": [],
        "broker_summaries": {"longbridge_hk": {
            "broker": "longbridge_hk", "account": "ANONYMOUS-LEDGER-SCOPE",
            "performance_snapshot": {"TEST": entry},
        }},
    }
    private = {
        "longbridge_hk_performance_calibrations": {"ANONYMOUS-PRIVATE-SCOPE": {"TEST.US": "12.34"}},
    }
    return payload, private


def test_matching_private_values_do_not_prove_account_identity_or_broker_pnl(inputs):
    payload, private = inputs
    originals = deepcopy(inputs)
    report = audit_calibrations(payload, private)
    item = report["items"][0]
    assert item["verdict"] == "insufficient"
    assert item["private_mapping_candidates"][0]["same_value_decimal"] is True
    assert item["private_mapping_candidates"][0]["same_account_literal"] is False
    assert report["summary"]["verdicts"] == {"source_backed": 0, "conflict": 0, "insufficient": 1}
    assert inputs == originals


def test_even_exact_private_scope_remains_one_provenance_chain(inputs):
    payload, private = inputs
    payload["broker_summaries"]["longbridge_hk"]["account"] = "ANONYMOUS-PRIVATE-SCOPE"
    report = audit_calibrations(payload, private)
    assert report["summary"]["exact_private_account_matches"] == 1
    assert report["items"][0]["verdict"] == "insufficient"


def test_trade_source_digest_and_occurrence_are_preserved_without_promoting_them_to_performance_proof(inputs):
    payload, private = inputs
    source_digest = "a" * 64
    payload["transactions"] = [{
        "id": "anonymous-occurrence", "broker": "longbridge_hk", "account": "ANONYMOUS-LEDGER-SCOPE",
        "ticker": "TEST.US", "currency": "USD", "source": {
            "file_kind": "longbridge_fund_details_contract", "row_number": 7,
            "source_sha256": source_digest,
        },
    }] * 2
    payload["source_artifacts"] = [{
        "sha256": source_digest, "storage_key": source_digest, "byte_count": 25,
        "broker": "longbridge_hk", "account": "ANONYMOUS-LEDGER-SCOPE",
        "source_kind": "longbridge_hk_fund_details_text",
    }]
    report = audit_calibrations(payload, private)
    item = report["items"][0]
    assert item["exact_scope_ledger_transaction_count"] == 2
    assert [row["ledger_transaction_ordinal"] for row in item["exact_scope_ledger_source_occurrences"]] == [0, 1]
    assert item["canonical_source_artifact_candidates"][0]["transaction_digest_reference"] is True
    assert report["referenced_raw_source_sha256"] == [source_digest]
    assert item["verdict"] == "insufficient"


def test_different_account_occurrences_and_other_broker_artifacts_do_not_match(inputs):
    payload, private = inputs
    payload["transactions"] = [{
        "broker": "longbridge_hk", "account": "ANONYMOUS-OTHER-SCOPE", "ticker": "TEST",
        "source": {"source_sha256": "b" * 64, "row_number": 7},
    }]
    payload["source_artifacts"] = [{"broker": "unrelated_broker", "account": "ANONYMOUS-LEDGER-SCOPE"}]
    report = audit_calibrations(payload, private)
    item = report["items"][0]
    assert item["exact_scope_ledger_transaction_count"] == 0
    assert item["same_broker_ticker_other_account_occurrences"] == {"ANONYMOUS-OTHER-SCOPE": 1}
    assert item["canonical_source_artifact_candidates"] == []
    assert report["referenced_raw_source_sha256"] == []


def test_native_entries_are_not_included_as_manual_audit_targets(inputs):
    payload, private = inputs
    snapshot = payload["broker_summaries"]["longbridge_hk"]["performance_snapshot"]
    snapshot["TEST"]["calibration_source"] = "broker_native_report"
    assert audit_calibrations(payload, private)["summary"]["target_count"] == 0


def test_cli_writes_private_report_and_preserves_exact_input_bytes(tmp_path, inputs):
    from app.core.object_sqlite import write_object
    from app.infrastructure.investment_sqlite import save_payload

    source = tmp_path / "inputs"
    source.mkdir()
    ledger, evidence = source / "investment.sqlite3", source / "private.sqlite3"
    save_payload(ledger, inputs[0])
    write_object(evidence, inputs[1])
    before = {path: hashlib.sha256(path.read_bytes()).digest() for path in (ledger, evidence)}
    report_path = tmp_path / "audit.json"
    script = Path(__file__).resolve().parents[3] / "scripts/audit_manual_calibration_evidence.py"
    command = [
        sys.executable, str(script), "--ledger", str(ledger), "--private-evidence", str(evidence),
        "--report", str(report_path),
    ]
    completed = subprocess.run(command, text=True, capture_output=True, check=False, timeout=30)
    assert completed.returncode == 0, completed.stderr
    report = json.loads(report_path.read_text())
    assert report["input_files_unchanged"] is True
    assert {path: hashlib.sha256(path.read_bytes()).digest() for path in (ledger, evidence)} == before
    assert stat.S_IMODE(report_path.stat().st_mode) == 0o600
    again = subprocess.run(command, text=True, capture_output=True, check=False, timeout=30)
    assert again.returncode != 0
    assert json.loads(report_path.read_text()) == report


def test_case_alias_report_parent_is_rejected_before_input_reads(tmp_path, monkeypatch):
    source = tmp_path / "inputs"
    source.mkdir()
    ledger, evidence = source / "investment.sqlite3", source / "private.sqlite3"
    ledger.write_bytes(b"unchanged ledger bytes")
    evidence.write_bytes(b"unchanged evidence bytes")
    before = ledger.read_bytes(), evidence.read_bytes()
    report = source.with_name("INPUTS") / "forbidden-report.json"
    monkeypatch.setattr(sys, "argv", [
        "audit_manual_calibration_evidence", "--ledger", str(ledger),
        "--private-evidence", str(evidence), "--report", str(report),
    ])

    def reject_source_reads(_path):
        pytest.fail("The output guard must reject a case alias before reading input bytes.")

    monkeypatch.setattr(audit_module, "sha256_file", reject_source_reads)
    with pytest.raises(SystemExit) as stopped:
        audit_module.main()
    assert stopped.value.code == 2 and not report.exists()
    assert (ledger.read_bytes(), evidence.read_bytes()) == before


def test_native_fund_extraction_preserves_occurrences_lines_and_cash_precision(tmp_path):
    source = tmp_path / "fund.txt"
    source.write_text(
        "All Months\nBuy Contract-Stocks\n-100.0000 USD\n2024.11.15\nTEST.US\n"
        "Sell Contract-Stocks\n112.3400 USD\n2024.11.16\nTEST.US\n"
        "Stock Trade Fee\n-0.0000 USD\n2024.11.16\n",
    )
    before = source.read_bytes()
    records, metadata = audit_module._native_fund_records(source)
    assert len(records) == 3
    assert records[0]["line_start"] == 2 and records[0]["amount_line"] == 3
    assert records[0]["amount_raw"] == "-100.0000" and records[0]["explicit_symbols"] == ["TEST"]
    assert records[2]["explicit_symbols"] == []
    assert metadata["observed_export_window"] == {"first": "2024-11-15", "last": "2024-11-16"}
    assert not metadata["explicit_opening_position_snapshot"]
    assert source.read_bytes() == before


def test_native_order_rows_use_exact_worksheet_coordinates_without_pnl_substitution(tmp_path):
    from tests.python.services.test_longbridge_sg_import import _build_history_orders_workbook_bytes

    source = tmp_path / "orders.xlsx"
    source.write_bytes(_build_history_orders_workbook_bytes())
    before = source.read_bytes()
    rows, metadata = audit_module._native_order_rows(source)
    assert rows[0]["row"] == 2 and rows[0]["sheet"] == "Orders"
    assert rows[0]["cells"]["Symbol"] == "C2" and rows[0]["cells"]["Executed Qty"] == "M2"
    assert rows[0]["symbol"] == "TQQQ" and rows[0]["executed_quantity"] == "1"
    assert metadata["direct_realized_pnl_field"] is False
    assert [row["name"] for row in metadata["sheets"]] == ["Orders", "Trade Log"]
    assert source.read_bytes() == before


def test_native_cash_agreement_without_inventory_bounds_is_not_certified_realized_pnl(tmp_path, inputs):
    payload, private = inputs
    source_root = tmp_path / "Brokers"
    hk, sg = source_root / "Longbridge HK", source_root / "Longbridge SG"
    hk.mkdir(parents=True)
    sg.mkdir()
    source = hk / "H99999999 Fund Details.txt"
    source.write_text(
        "Buy Contract-Stocks\n-100.00 USD\n2024.11.15\nTEST.US\n"
        "Sell Contract-Stocks\n112.34 USD\n2024.11.16\nTEST.US\n",
    )
    payload["broker_summaries"]["longbridge_hk"]["account"] = "H99999999"
    report = audit_calibrations(payload, private)
    paths = audit_module.review_native_originals(report, source_root)
    item = report["items"][0]
    dimensions = item["evidence_dimensions"]
    assert dimensions["explicit_tagged_cash_net"]["equal_to_manual_value"] is True
    assert dimensions["explicit_tagged_cash_net"]["difference_from_manual_value"] == "0.0000"
    assert dimensions["filename_declared_account_matches_ledger_scope"] is True
    assert dimensions["account_identity_declared_in_body"] is False
    assert dimensions["zero_opening_inventory_proven"] is False
    assert item["verdict"] == "insufficient" and paths == [source]
    assert report["native_original_review_summary"]["executed_quantity_comparison"] == {"missing": 1}


def test_missing_native_cash_occurrences_are_not_reported_as_real_zero(tmp_path, inputs):
    source_root = tmp_path / "Brokers"
    hk, sg = source_root / "Longbridge HK", source_root / "Longbridge SG"
    hk.mkdir(parents=True)
    sg.mkdir()
    (hk / "H99999999 Fund Details.txt").write_text("Cash Deposit\n0.00 USD\n2024.11.15\n")
    report = audit_calibrations(*inputs)
    audit_module.review_native_originals(report, source_root)
    diagnostic = report["items"][0]["evidence_dimensions"]["explicit_tagged_cash_net"]
    assert diagnostic["occurrences"] == 0 and diagnostic["sum"] is None
    assert diagnostic["equal_to_manual_value"] is None


def test_cash_measure_disagreement_is_not_a_pnl_conflict_without_coverage_proof(tmp_path, inputs):
    source_root = tmp_path / "Brokers"
    hk, sg = source_root / "Longbridge HK", source_root / "Longbridge SG"
    hk.mkdir(parents=True)
    sg.mkdir()
    (hk / "H99999999 Fund Details.txt").write_text(
        "Buy Contract-Stocks\n-100.00 USD\n2024.11.15\nTEST.US\n"
        "Sell Contract-Stocks\n112.33 USD\n2024.11.16\nTEST.US\n",
    )
    report = audit_calibrations(*inputs)
    audit_module.review_native_originals(report, source_root)
    item = report["items"][0]
    diagnostic = item["evidence_dimensions"]["explicit_tagged_cash_net"]
    assert diagnostic["difference_from_manual_value"] == "-0.0100"
    assert diagnostic["equal_to_manual_value"] is False
    assert item["verdict"] == "insufficient" and report["summary"]["verdicts"]["conflict"] == 0


def test_native_unit_trust_is_located_by_explicit_isin_without_a_stock_ticker_alias(tmp_path, inputs):
    source_root = tmp_path / "Brokers"
    hk, sg = source_root / "Longbridge HK", source_root / "Longbridge SG"
    hk.mkdir(parents=True)
    sg.mkdir()
    identifier = "HK0000000000"
    (hk / "H99999999 Fund Details.txt").write_text(
        f"Buy Contract - Unit Trust\n-100.00 USD\n2024.11.15\n{identifier}\n"
        f"Sell Contract - Unit Trust\n112.34 USD\n2024.11.16\n{identifier}\n",
    )
    payload, private = inputs
    snapshot = payload["broker_summaries"]["longbridge_hk"]["performance_snapshot"]
    snapshot[identifier] = snapshot.pop("TEST")
    report = audit_calibrations(payload, private)
    audit_module.review_native_originals(report, source_root)
    dimensions = report["items"][0]["evidence_dimensions"]
    assert dimensions["identifier_form"] == "ISIN" and dimensions["raw_ticker_occurrences_exist"] is True
    assert dimensions["unit_trust_contracts_in_native_fund_details"] is True
    assert dimensions["explicit_tagged_cash_net"]["equal_to_manual_value"] is True
    assert report["items"][0]["verdict"] == "insufficient"
