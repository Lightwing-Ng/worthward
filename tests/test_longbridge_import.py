"""
Regression tests for Longbridge cash-flow matching.

Code version: v0.9.0
- Added: HSBC open-position tax-lot attestations retain exact DRAM and EUV
  trade counts, quantities, and expected ending shares.
- Added: paired-file reconciliation zero is not treated as an authoritative
  cash snapshot.
"""

from __future__ import annotations

import hashlib
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import unittest
from unittest.mock import patch

import app.services.investment_import as investment_import_service
from app.infrastructure.storage import (
    materialize_investment_source_artifacts,
    verify_investment_source_artifacts,
)
from app.services.investment_import import (
    _apply_longbridge_stock_cash_flows_to_order_records,
    _build_broker_reported_performance_calibrations,
    _build_longbridge_paired_file_source_artifacts,
    _build_verified_tax_lot_history,
    _normalize_broker_snapshots,
    _normalize_broker_summaries,
    _parse_longbridge_sg_fund_details_entries,
    build_investment_payload_from_longbridge_hk_files,
    merge_investment_payloads,
)


LONGBRIDGE_HK_SOURCE_DIR = Path("/Users/example/Desktop/IBKR/Longbridge HK")
LONGBRIDGE_HK_FUND_DETAILS_PATH = LONGBRIDGE_HK_SOURCE_DIR / "H99999999 Fund Details.txt"
LONGBRIDGE_HK_HISTORY_ORDERS_PATH = LONGBRIDGE_HK_SOURCE_DIR / "H99999999 Historyorders.xlsx"
LONGBRIDGE_HK_EXPECTED_REALIZED_PNL = {
    "AAPL": "1.23",
    "NVDA": "-4.56",
    "TQQQ": "7.89",
}
SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE = {
    "longbridge_hk_performance_calibrations": {
        "H99999999": LONGBRIDGE_HK_EXPECTED_REALIZED_PNL,
    },
    "longbridge_sg_performance_calibrations": {
        "SG99999999": {"NVDA": "2.34", "TQQQ": "-1.11"},
    },
    "hsbc_performance_calibrations": {
        "000-999999-999": {"RAM": "3.21"},
    },
    "verified_tax_lot_history": {
        "hsbc": {
            "000-999999-999": {
                "DRAM": {
                    "currency": "USD",
                    "verified_through": "2025-01-02",
                    "expected_shares": "5",
                    "buy_count": 3,
                    "sell_count": 1,
                    "buy_quantity": "6",
                    "sell_quantity": "1",
                    "calculation_method": "synthetic_test_fixture",
                    "verification_source": "synthetic_test_fixture",
                },
                "EUV": {
                    "currency": "USD",
                    "verified_through": "2025-01-02",
                    "expected_shares": "2",
                    "buy_count": 2,
                    "sell_count": 1,
                    "buy_quantity": "3",
                    "sell_quantity": "1",
                    "calculation_method": "synthetic_test_fixture",
                    "verification_source": "synthetic_test_fixture",
                },
                "GOOGL": {
                    "currency": "USD",
                    "verified_through": "2025-01-02",
                    "expected_shares": "0",
                    "buy_count": 2,
                    "sell_count": 2,
                    "buy_quantity": "4",
                    "sell_quantity": "4",
                    "calculation_method": "synthetic_test_fixture",
                    "verification_source": "synthetic_test_fixture",
                },
            },
        },
    },
}


def _build_order_record(
    *,
    order_id: str,
    ticker: str,
    side: str,
    currency: str,
    event_time: str,
    quantity: str,
    price: str,
    gross_amount: str,
) -> dict[str, object]:
    return {
        "ticker": ticker,
        "type": side,
        "currency": currency,
        "datetime": event_time,
        "quantity_raw": quantity,
        "price_raw": price,
        "gross_amount_raw": gross_amount,
        "commission_raw": "0",
        "net_amount_raw": gross_amount,
        "source": {
            "order_id": order_id,
        },
    }


class LongbridgeCashFlowMatchingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.private_evidence_patcher = patch.object(
            investment_import_service,
            "_load_local_private_investment_evidence",
            return_value=SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE,
        )
        self.private_evidence_patcher.start()
        self.addCleanup(self.private_evidence_patcher.stop)

    def test_account_calibrations_preserve_authoritative_profit_analysis_signs(self) -> None:
        calibrations = _build_broker_reported_performance_calibrations(
            "longbridge_hk",
            "H99999999",
        )
        self.assertEqual(
            {ticker: entry["realized_total"] for ticker, entry in calibrations.items()},
            LONGBRIDGE_HK_EXPECTED_REALIZED_PNL,
        )
        self.assertTrue(all(
            entry["calibration_source"]
            == "user_confirmed_broker_performance_calibration"
            for entry in calibrations.values()
        ))
        self.assertEqual(
            sum(Decimal(entry["realized_total"]) for entry in calibrations.values()),
            Decimal("4.56"),
        )
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "longbridge_hk": {
                    "account": "H99999999",
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot": {
                        "SQQQ": {
                            "realized_total": "2.22",
                            "calibration_source": "broker_reported_pnl",
                        },
                    },
                },
            },
        })
        self.assertEqual(
            normalized["longbridge_hk"]["performance_snapshot"]["SQQQ"]["realized_total"],
            "2.22",
        )

    def test_paired_file_zero_cash_is_reconciliation_only_not_a_cash_snapshot(self) -> None:
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "longbridge_hk": {
                    "ending_cash": "0",
                    "calibration_source": "longbridge_hk_files",
                },
            },
        })

        self.assertFalse(normalized["longbridge_hk"]["cash_snapshot_authoritative"])

    def test_paired_file_evidence_preserves_each_exact_longbridge_upload(self) -> None:
        fund_details_bytes = b"Account H99999999\nFund Details\n"
        history_orders_bytes = b"PK\x03\x04history-orders"
        artifacts = _build_longbridge_paired_file_source_artifacts(
            broker="longbridge_hk",
            account="H99999999",
            fund_details_bytes=fund_details_bytes,
            history_orders_xlsx_bytes=history_orders_bytes,
            fund_details_filename="H99999999 Fund Details.txt",
            history_orders_filename="H99999999 Historyorders.xlsx",
            statement_period_start="2023-01-01",
            statement_period_end="2026-06-29",
        )

        self.assertEqual(len(artifacts), 2)
        by_role = {artifact["bundle_role"]: artifact for artifact in artifacts}
        self.assertEqual(set(by_role), {"fund_details", "history_orders"})
        self.assertEqual(
            by_role["fund_details"]["sha256"],
            hashlib.sha256(fund_details_bytes).hexdigest(),
        )
        self.assertEqual(
            by_role["history_orders"]["sha256"],
            hashlib.sha256(history_orders_bytes).hexdigest(),
        )
        self.assertEqual(
            by_role["fund_details"]["related_sha256"],
            by_role["history_orders"]["sha256"],
        )
        self.assertEqual(
            by_role["history_orders"]["related_sha256"],
            by_role["fund_details"]["sha256"],
        )
        self.assertEqual(
            by_role["fund_details"]["bundle_id"],
            by_role["history_orders"]["bundle_id"],
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(
                {"source_artifacts": artifacts},
                ledger_path,
            )
            verify_investment_source_artifacts(materialized, ledger_path)
        self.assertTrue(all(
            "content_base64" not in artifact and "storage_key" in artifact
            for artifact in materialized["source_artifacts"]
        ))

    def test_user_confirmed_performance_has_no_invented_as_of_or_artifact(self) -> None:
        artifacts = _build_longbridge_paired_file_source_artifacts(
            broker="longbridge_hk",
            account="H99999999",
            fund_details_bytes=b"Fund Details",
            history_orders_xlsx_bytes=b"PK\x03\x04History Orders",
            fund_details_filename="H99999999 Fund Details.txt",
            history_orders_filename="H99999999 Historyorders.xlsx",
            statement_period_start="2023-01-01",
            statement_period_end="2026-06-29",
        )
        snapshots = _normalize_broker_snapshots({
            "broker": "longbridge_hk",
            "account": "H99999999",
            "summary": {
                "position_snapshot_authoritative": False,
                "position_snapshot_source": "longbridge_hk_replayed_holdings",
                "performance_snapshot_authoritative": True,
                "performance_snapshot_source": (
                    "user_confirmed_broker_performance_calibration"
                ),
            },
            "source_artifacts": artifacts,
            "position_snapshot": {"TQQQ": {"quantity": "1"}},
            "performance_snapshot": {"TQQQ": {"realized_total": "7.89"}},
            "transactions": [{"date": "2026-06-29"}],
        })

        snapshot = snapshots["longbridge_hk:H99999999"]
        self.assertEqual(snapshot["position_snapshot_as_of"], "2026-06-29")
        self.assertEqual(snapshot["performance_snapshot_as_of"], "")
        performance_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["performance_snapshot"]
        )
        position_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["position_snapshot"]
        )
        self.assertEqual(performance_evidence["source_artifact_sha256"], [])
        self.assertEqual(
            position_evidence["source_artifact_sha256"],
            sorted(artifact["sha256"] for artifact in artifacts),
        )

    def test_broker_native_performance_snapshot_is_not_replaced_by_fallback(self) -> None:
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "longbridge_hk": {
                    "account": "H99999999",
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot": {
                        "TQQQ": {
                            "realized_total": "1400.01",
                            "calibration_source": "longbridge_performance_report",
                        },
                    },
                },
            },
        })

        snapshot = normalized["longbridge_hk"]["performance_snapshot"]
        self.assertEqual(snapshot["TQQQ"]["realized_total"], "1400.01")
        self.assertNotIn("HK0000720752", snapshot)
        self.assertEqual(
            snapshot["TQQQ"]["calibration_source"],
            "longbridge_performance_report",
        )

    def test_hk_and_sg_calibrations_remain_independent_for_shared_tickers(self) -> None:
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "longbridge_hk": {"account": "H99999999"},
                "longbridge_sg": {"account": "SG99999999"},
            },
        })

        self.assertEqual(
            normalized["longbridge_hk"]["performance_snapshot"]["TQQQ"]["realized_total"],
            "7.89",
        )
        self.assertEqual(
            normalized["longbridge_sg"]["performance_snapshot"]["TQQQ"]["realized_total"],
            "-1.11",
        )
        self.assertEqual(
            normalized["longbridge_hk"]["performance_snapshot"]["NVDA"]["realized_total"],
            "-4.56",
        )
        self.assertEqual(
            normalized["longbridge_sg"]["performance_snapshot"]["NVDA"]["realized_total"],
            "2.34",
        )

    def test_hsbc_googl_uses_verified_history_metadata_not_a_hardcoded_pnl(self) -> None:
        performance = _build_broker_reported_performance_calibrations(
            "hsbc",
            "000-999999-999",
        )
        verification = _build_verified_tax_lot_history(
            "hsbc",
            "000-999999-999",
        )
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "hsbc": {"account": "000-999999-999"},
            },
        })

        self.assertNotIn("GOOGL", performance)
        self.assertEqual(performance["RAM"]["realized_total"], "3.21")
        self.assertEqual(verification["GOOGL"]["buy_count"], 2)
        self.assertEqual(verification["GOOGL"]["sell_count"], 2)
        self.assertEqual(verification["GOOGL"]["buy_quantity"], "4")
        self.assertEqual(verification["GOOGL"]["sell_quantity"], "4")
        self.assertEqual(
            normalized["hsbc"]["tax_lot_history_verifications"]["GOOGL"],
            verification["GOOGL"],
        )

    def test_hsbc_open_positions_include_verified_dram_and_euv_history(self) -> None:
        verification = _build_verified_tax_lot_history(
            "hsbc",
            "000-999999-999",
        )
        normalized = _normalize_broker_summaries({
            "broker_summaries": {
                "hsbc": {"account": "000-999999-999"},
            },
        })

        self.assertEqual(
            verification["DRAM"],
            {
                "currency": "USD",
                "verified_through": "2025-01-02",
                "expected_shares": "5",
                "buy_count": 3,
                "sell_count": 1,
                "buy_quantity": "6",
                "sell_quantity": "1",
                "calculation_method": "synthetic_test_fixture",
                "verification_source": "synthetic_test_fixture",
            },
        )
        self.assertEqual(verification["EUV"]["expected_shares"], "2")
        self.assertEqual(verification["EUV"]["buy_count"], 2)
        self.assertEqual(verification["EUV"]["sell_count"], 1)
        self.assertEqual(verification["EUV"]["buy_quantity"], "3")
        self.assertEqual(verification["EUV"]["sell_quantity"], "1")
        self.assertEqual(
            normalized["hsbc"]["tax_lot_history_verifications"]["DRAM"],
            verification["DRAM"],
        )
        self.assertEqual(
            normalized["hsbc"]["tax_lot_history_verifications"]["EUV"],
            verification["EUV"],
        )

    def test_matches_multiple_contract_rows_to_one_order(self) -> None:
        order_record = _build_order_record(
            order_id="ORDER000001",
            ticker="JEPQ.US",
            side="sell",
            currency="USD",
            event_time="2025-08-18 04:14:24",
            quantity="60",
            price="55.834",
            gross_amount="3350.040",
        )
        contract_rows = [
            {
                "row_number": 2,
                "symbol": "JEPQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 18, 4, 35, 18, tzinfo=timezone.utc),
                "gross_amount": Decimal("2400.26"),
            },
            {
                "row_number": 3,
                "symbol": "JEPQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 18, 4, 30, 35, tzinfo=timezone.utc),
                "gross_amount": Decimal("55.86"),
            },
            {
                "row_number": 4,
                "symbol": "JEPQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 18, 4, 28, 29, tzinfo=timezone.utc),
                "gross_amount": Decimal("446.96"),
            },
            {
                "row_number": 5,
                "symbol": "JEPQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 18, 4, 28, 29, tzinfo=timezone.utc),
                "gross_amount": Decimal("446.96"),
            },
        ]
        fee_rows = [
            {
                "row_number": 10,
                "symbol": "JEPQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 19, 14, 0, 3, tzinfo=timezone.utc),
                "amount": Decimal("-1.20"),
                "flow_name": "Stock Sell Commission",
            }
        ]
        warnings: list[str] = []

        matched_row_numbers = _apply_longbridge_stock_cash_flows_to_order_records(
            [order_record],
            contract_rows,
            fee_rows,
            warnings,
        )

        self.assertEqual(matched_row_numbers, {2, 3, 4, 5, 10})
        self.assertEqual(order_record["gross_amount_raw"], "3350.04")
        self.assertEqual(order_record["commission_raw"], "-1.20")
        self.assertEqual(order_record["net_amount_raw"], "3348.84")
        self.assertEqual(
            order_record["source"]["cash_flow_contract_row_numbers"],  # type: ignore[index]
            [2, 3, 4, 5],
        )
        self.assertEqual(
            order_record["source"]["cash_flow_fee_row_numbers"],  # type: ignore[index]
            [10],
        )
        self.assertEqual(warnings, [])


class LongbridgeHkImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if (
            not LONGBRIDGE_HK_FUND_DETAILS_PATH.exists()
            or not LONGBRIDGE_HK_HISTORY_ORDERS_PATH.exists()
        ):
            raise unittest.SkipTest("Longbridge HK source fixtures are unavailable on this machine.")
        cls.fund_details_text = LONGBRIDGE_HK_FUND_DETAILS_PATH.read_text(encoding="utf-8")
        with patch.object(
            investment_import_service,
            "_load_local_private_investment_evidence",
            return_value=SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE,
        ):
            cls.payload = build_investment_payload_from_longbridge_hk_files(
                fund_details_text=cls.fund_details_text,
                history_orders_xlsx_bytes=LONGBRIDGE_HK_HISTORY_ORDERS_PATH.read_bytes(),
                fund_details_filename=LONGBRIDGE_HK_FUND_DETAILS_PATH.name,
                history_orders_filename=LONGBRIDGE_HK_HISTORY_ORDERS_PATH.name,
            )

    def test_applies_only_explicit_broker_performance_calibrations(self) -> None:
        snapshot = self.payload["performance_snapshot"]
        self.assertEqual(
            {ticker: entry["realized_total"] for ticker, entry in snapshot.items()},
            LONGBRIDGE_HK_EXPECTED_REALIZED_PNL,
        )
        self.assertTrue(all(
            entry["realized_total_includes_nonperformance"] is True
            for entry in snapshot.values()
        ))
        self.assertTrue(self.payload["summary"]["performance_snapshot_authoritative"])
        self.assertEqual(
            self.payload["summary"]["performance_snapshot_source"],
            "user_confirmed_broker_performance_calibration",
        )
        self.assertEqual(
            {artifact["bundle_role"] for artifact in self.payload["source_artifacts"]},
            {"fund_details", "history_orders"},
        )
        merged = merge_investment_payloads({}, self.payload)
        self.assertEqual(merged["performance_snapshot"], snapshot)
        self.assertTrue(merged["summary"]["performance_snapshot_authoritative"])

    def test_preserves_every_fund_details_entry_and_source_rounding_residual(self) -> None:
        generator = self.payload["generator"]
        self.assertEqual(generator["unaccounted_fund_details_entry_count"], 0)
        reconciliation = self.payload["summary"]["cash_reconciliation"]
        self.assertEqual(Decimal(reconciliation["HKD"]["difference"]), Decimal("0.00"))
        self.assertEqual(Decimal(reconciliation["USD"]["difference"]), Decimal("0.03"))
        self.assertTrue(self.payload["summary"]["cash_reconciliation_matched"])
        self.assertFalse(any(
            "reconciliation" in str((transaction.get("source") or {}).get("file_kind") or "")
            for transaction in self.payload["transactions"]
        ))

    def test_contract_ledger_dates_remain_on_fund_details_booking_dates(self) -> None:
        booking_dates = {
            int(entry["row_number"]): entry["time"]
            for entry in _parse_longbridge_sg_fund_details_entries(self.fund_details_text)
        }
        contract_transactions = [
            transaction
            for transaction in self.payload["transactions"]
            if (transaction.get("source") or {}).get("file_kind")
            == "longbridge_fund_details_contract"
        ]
        self.assertGreater(len(contract_transactions), 3_000)
        for transaction in contract_transactions:
            source = transaction["source"]
            self.assertEqual(
                transaction["date"],
                booking_dates[int(source["row_number"])],
            )
            if source.get("history_order_matched"):
                self.assertIn("history_order_datetime", source)


class LongbridgeFeeMatchingTest(unittest.TestCase):
    def test_matches_nearest_fee_per_order(self) -> None:
        first_order = _build_order_record(
            order_id="ORDER000002",
            ticker="TQQQ.US",
            side="sell",
            currency="USD",
            event_time="2025-08-04 09:50:12",
            quantity="35",
            price="85.000",
            gross_amount="2975.00",
        )
        second_order = _build_order_record(
            order_id="ORDER000003",
            ticker="TQQQ.US",
            side="sell",
            currency="USD",
            event_time="2025-08-04 14:03:54",
            quantity="10",
            price="87.000",
            gross_amount="870.00",
        )
        contract_rows = [
            {
                "row_number": 16,
                "symbol": "TQQQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 4, 9, 50, 30, tzinfo=timezone.utc),
                "gross_amount": Decimal("2975.00"),
            },
            {
                "row_number": 15,
                "symbol": "TQQQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 4, 14, 4, 10, tzinfo=timezone.utc),
                "gross_amount": Decimal("870.00"),
            },
        ]
        fee_rows = [
            {
                "row_number": 11,
                "symbol": "TQQQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 5, 13, 59, 0, tzinfo=timezone.utc),
                "amount": Decimal("-1.04"),
                "flow_name": "Stock Sell Commission",
            },
            {
                "row_number": 10,
                "symbol": "TQQQ.US",
                "side": "sell",
                "currency": "USD",
                "time": datetime(2025, 8, 5, 14, 7, 0, tzinfo=timezone.utc),
                "amount": Decimal("-1.12"),
                "flow_name": "Stock Sell Commission",
            },
        ]
        warnings: list[str] = []

        _apply_longbridge_stock_cash_flows_to_order_records(
            [first_order, second_order],
            contract_rows,
            fee_rows,
            warnings,
        )

        self.assertEqual(first_order["commission_raw"], "-1.04")
        self.assertEqual(second_order["commission_raw"], "-1.12")
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
