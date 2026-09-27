"""Authoritative HSBC settlement repair regression tests.

Code version: v0.1.0
- Added: Cover fee topology, settled economics, configured import identity,
  continuity diagnostics, repair skip reasons, and per-order evidence fallback.
"""

from __future__ import annotations

import base64
from copy import deepcopy
from decimal import Decimal
import hashlib
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.investment.importing.brokers.hsbc import reconciliation
from app.services.investment.importing.brokers.hsbc import cash, core


ACCOUNT = "000-999999-999"
HEADER = "Date,Description,Billing amount,Billing currency,Balance,Balance currency"


def settlement_order(principal: str = "1000.00") -> dict:
    return {
        "broker": "hsbc",
        "account": ACCOUNT,
        "date": "2026-07-14",
        "type": "sell",
        "ticker": "TEST",
        "currency": "USD",
        "quantity_abs": "10",
        "quantity_raw": "-10",
        "price_raw": str(Decimal(principal) / Decimal("10")),
        "gross_amount_raw": principal,
        "commission_raw": "0",
        "net_amount_raw": principal,
        "normalized": {"commission": "0", "net_amount": principal},
        "source": {"order_id": "S-100001", "statement_order_id": "S-100001"},
    }


def csv_artifact(amounts: list[str], *, account: str = ACCOUNT) -> dict:
    balance = Decimal("1000.00")
    rows = []
    for amount_text in amounts:
        amount = Decimal(amount_text)
        balance += amount
        rows.append(
            f"15/07/2026,REF S100001001 SEC,{amount:.2f},USD,{balance:.2f},USD"
        )
    csv_bytes = "\n".join([HEADER, *reversed(rows)]).encode()
    digest = hashlib.sha256(csv_bytes).hexdigest()
    return {
        "broker": "hsbc",
        "bundle_role": "transaction_history",
        "source_kind": "hsbc_usd_savings_transaction_history_csv",
        "account": account,
        "sha256": digest,
        "byte_count": len(csv_bytes),
        "content_encoding": "base64",
        "content_base64": base64.b64encode(csv_bytes).decode(),
        "statement_period_end": "2026-07-15",
    }


@pytest.mark.parametrize("fees", [["-5.56"], [], ["-3.00", "-2.56"]])
def test_authoritative_sell_accepts_identity_matched_zero_or_multiple_fees(fees):
    order = settlement_order("200000.00")
    updated = reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], [csv_artifact(["200000.00", *fees])]
    )
    assert updated == 1
    postings = order["source"]["cash_settlement_postings"]
    assert len(postings) == 1 + len(fees)
    assert Decimal(order["commission_raw"]) == sum(map(Decimal, fees), Decimal("0"))
    assert Decimal(order["source"]["cash_settlement_balance_after_raw"]) == (
        Decimal("201000.00") + sum(map(Decimal, fees), Decimal("0"))
    )


def test_authoritative_sell_derives_the_same_final_economics_as_settlement():
    order = settlement_order()
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], [csv_artifact(["1000.00", "-0.03"])]
    ) == 1
    assert order["source"]["execution_price_status"] == "final_settled"
    assert Decimal(order["gross_amount_raw"]) == Decimal("1000.03")
    assert Decimal(order["price_raw"]) == Decimal("100.003")
    assert Decimal(order["gross_amount_raw"]) + Decimal(order["commission_raw"]) == (
        Decimal(order["net_amount_raw"])
    )
    assert order["source"]["settlement_component_total_raw"] == "1000"
    assert "settlement_adjustment_raw" not in order


def test_authoritative_settlement_repair_is_idempotent():
    order = settlement_order()
    artifacts = [csv_artifact(["1000.00", "-0.03"])]
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], artifacts
    ) == 1
    settled_order = deepcopy(order)
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], artifacts
    ) == 0
    assert order == settled_order


def test_usd_savings_csv_requires_a_configured_account_before_parsing():
    csv_bytes = base64.b64decode(csv_artifact(["1000.00"])["content_base64"])
    with patch.object(reconciliation, "HSBC_EXPECTED_ACCOUNT_NUMBER", ""):
        with pytest.raises(ValueError, match="WORTHWARD_HSBC_ACCOUNT_NUMBER"):
            reconciliation.build_investment_payload_from_hsbc_usd_savings_csv(csv_bytes)


def test_usd_savings_csv_continuity_reports_the_actual_failing_pair():
    csv_bytes = "\n".join(
        [
            HEADER,
            "18/07/2026,TRANSFER,10.00,USD,1030.00,USD",
            "17/07/2026,TRANSFER,10.00,USD,1020.00,USD",
            "16/07/2026,TRANSFER,10.00,USD,1000.00,USD",
            "15/07/2026,TRANSFER,10.00,USD,990.00,USD",
        ]
    ).encode()
    with pytest.raises(ValueError, match="between rows 3 and 4"):
        reconciliation._parse_hsbc_usd_savings_csv_rows(csv_bytes)


def test_authoritative_repair_returns_reason_coded_amount_mismatch():
    order = settlement_order("999.00")
    before = deepcopy(order)
    diagnostics = []
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], [csv_artifact(["1000.00", "-0.03"])], diagnostics=diagnostics
    ) == 0
    assert order == before
    assert diagnostics == [
        {"order_reference": "S-100001", "account": ACCOUNT, "reason": "amount_mismatch"}
    ]
    assert "diagnostics" not in order


@pytest.mark.parametrize(
    ("amounts", "declared_commission", "expected_reason"),
    [
        (["1000.00", "1000.00", "-0.03"], "0", "ambiguous_principal"),
        (["1000.00", "-11.00"], "0", "fee_out_of_bounds"),
        (["1000.00", "-6.00", "-6.00"], "0", "fee_out_of_bounds"),
        (["1000.00"], "-0.03", "declared_fee_mismatch"),
        (["1000.00", "-0.03"], "-0.04", "declared_fee_mismatch"),
    ],
)
def test_authoritative_repair_reports_unsafe_evidence_without_mutation(
    amounts, declared_commission, expected_reason
):
    order = settlement_order()
    order["commission_raw"] = declared_commission
    order["normalized"]["commission"] = declared_commission
    before = deepcopy(order)
    diagnostics = []
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], [csv_artifact(amounts)], diagnostics=diagnostics
    ) == 0
    assert order == before
    assert diagnostics[0]["reason"] == expected_reason


def test_authoritative_repair_logs_skips_without_a_diagnostics_collector(caplog):
    order = settlement_order("999.00")
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [order], [csv_artifact(["1000.00", "-0.03"])]
    ) == 0
    assert "HSBC settlement repair skipped order S-100001: amount_mismatch" in caplog.text


def settlement_pasted_cash_text() -> str:
    return "\n".join(
        [
            "HSBC", "USD Savings", "Account number:", ACCOUNT,
            "Ledger balance:", "1999.97", "USD", "Available balance:",
            "1999.97 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "15 Jul 2026", "REF S100001001 SEC", "0.00", "0.03", "1999.97",
            "15 Jul 2026", "REF S100001001 SEC", "1000.00", "0.00", "2000.00",
            "Download",
        ]
    )


def write_pasted_artifact(evidence_dir: Path) -> dict:
    payload = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="",
        cash_account_text=settlement_pasted_cash_text()
    )
    artifact = deepcopy(payload["source_artifacts"][0])
    content = base64.b64decode(artifact.pop("content_base64"))
    artifact.pop("content_encoding")
    artifact["storage_key"] = artifact["sha256"]
    (evidence_dir / f"{artifact['storage_key']}.bin").write_bytes(content)
    return artifact


@pytest.mark.parametrize(
    ("csv_account", "csv_principal"),
    [("ACCOUNT-B", "1000.00"), (ACCOUNT, "999.00")],
)
def test_authoritative_repair_falls_back_to_valid_paste_after_unusable_csv(
    tmp_path, csv_account, csv_principal
):
    order = settlement_order()
    pasted_artifact = write_pasted_artifact(tmp_path)
    with patch.object(reconciliation, "investment_evidence_dir_for", return_value=tmp_path):
        assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
            [order],
            [
                csv_artifact([csv_principal, "-0.03"], account=csv_account),
                pasted_artifact,
            ],
        ) == 1
    assert order["source"]["cash_settlement_authoritative_source"] == (
        "hsbc_cash_account_pasted_text"
    )


def test_authoritative_repair_prefers_csv_when_both_evidence_sources_match(tmp_path):
    order = settlement_order()
    pasted_artifact = write_pasted_artifact(tmp_path)
    with patch.object(reconciliation, "investment_evidence_dir_for", return_value=tmp_path):
        assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
            [order], [pasted_artifact, csv_artifact(["1000.00", "-0.03"])],
        ) == 1
    assert order["source"]["cash_settlement_authoritative_source"] == (
        "hsbc_usd_savings_transaction_history_csv"
    )


def test_paste_and_authoritative_repair_apply_identical_settlement_economics():
    pasted_order = settlement_order()
    repaired_order = settlement_order()
    cash_records = core._build_hsbc_cash_account_capture_from_text(
        settlement_pasted_cash_text(), warnings=[]
    )["records"]
    cash._match_hsbc_orders_to_cash_settlements([pasted_order], cash_records, [])
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [repaired_order], [csv_artifact(["1000.00", "-0.03"])]
    ) == 1
    for field in (
        "price_raw", "gross_amount_raw", "commission_raw", "net_amount_raw", "normalized",
    ):
        assert pasted_order[field] == repaired_order[field]
    for field in (
        "execution_price_status", "execution_price_final_raw",
        "settlement_component_total_raw", "settlement_adjustment_calculation",
        "cash_settlement_balance_after_raw",
    ):
        assert pasted_order["source"][field] == repaired_order["source"][field]


def test_authoritative_repair_does_not_reuse_cash_across_csv_and_paste_owners(tmp_path):
    first_order = settlement_order()
    duplicate_owner = settlement_order()
    duplicate_owner["ticker"] = "OTHER"
    before_duplicate = deepcopy(duplicate_owner)
    pasted_artifact = write_pasted_artifact(tmp_path)
    diagnostics = []
    with patch.object(reconciliation, "investment_evidence_dir_for", return_value=tmp_path):
        assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
            [first_order, duplicate_owner],
            [csv_artifact(["1000.00", "-0.03"]), pasted_artifact],
            diagnostics=diagnostics,
        ) == 1
    assert duplicate_owner == before_duplicate
    assert first_order["source"]["cash_settlement_authoritative_source"] == (
        "hsbc_usd_savings_transaction_history_csv"
    )
    assert diagnostics[0]["reason"] == "ambiguous_order_owner"


@pytest.mark.parametrize("include_fee", [False, True])
def test_paste_and_authoritative_repair_reject_declared_fee_disagreement(include_fee):
    pasted_order = settlement_order()
    pasted_order["commission_raw"] = "-0.04"
    pasted_order["normalized"]["commission"] = "-0.04"
    pasted_order["source"]["cash_flow_fee_amount_raw"] = "0.04"
    before_order = deepcopy(pasted_order)
    repaired_order = deepcopy(pasted_order)
    cash_records = core._build_hsbc_cash_account_capture_from_text(
        settlement_pasted_cash_text(), warnings=[]
    )["records"]
    if not include_fee:
        cash_records = [
            record for record in cash_records if Decimal(record["net_amount_raw"]) > 0
        ]
    before_cash_records = deepcopy(cash_records)
    cash._match_hsbc_orders_to_cash_settlements([pasted_order], cash_records, [])
    assert reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [repaired_order],
        [csv_artifact(["1000.00", *(["-0.03"] if include_fee else [])])],
    ) == 0
    assert repaired_order == before_order
    assert pasted_order == before_order
    assert cash_records == before_cash_records
