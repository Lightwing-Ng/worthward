"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    Decimal,
    Path,
    build_investment_payload_from_ibkr_csvs,
    build_investment_payload_from_ibkr_gainskeeper_files,
    build_investment_payload_from_ibkr_web_pasted_text,
    deepcopy,
    json,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
)


class IbkrMergeImportTestsMixin:
    def test_ibkr_gainskeeper_reimport_replaces_all_matching_web_rows(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=self._ibkr_web_trade_notifications_text(),
        )
        gainskeeper_transactions = []
        for index, web_record in enumerate(web_payload["transactions"], start=1):
            gainskeeper_record = deepcopy(web_record)
            source_datetime_raw = (
                gainskeeper_record["datetime"]
                .replace("-", "")
                .replace(" ", "")
                .replace(":", "")
            )
            gainskeeper_record["source"] = {
                "file_kind": "gainskeeper",
                "source_format": "ofx_gkx",
                "fitid": f"REIMPORT-FITID-{index}",
                "account": "U00000001",
                "source_datetime_raw": source_datetime_raw,
                "has_intraday_timestamp": True,
                "gkx_transaction_tag": (
                    "SELLSTOCK" if gainskeeper_record["type"] == "sell" else "BUYSTOCK"
                ),
            }
            gainskeeper_transactions.append(gainskeeper_record)
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "generator": {
                "name": "ibkr_gainskeeper_ofx_to_investment_json",
                "generated_at": "2026-07-30T00:00:00Z",
            },
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "transactions": gainskeeper_transactions,
        }

        first_merge = merge_investment_payloads(web_payload, gainskeeper_payload)
        second_merge = merge_investment_payloads(
            first_merge,
            deepcopy(gainskeeper_payload),
        )
        authoritative_rows = [
            record
            for record in first_merge["transactions"]
            if record.get("type") in {"buy", "sell"}
        ]

        self.assertEqual(len(authoritative_rows), len(web_payload["transactions"]))
        self.assertEqual(
            {record["source"]["file_kind"] for record in authoritative_rows},
            {"gainskeeper"},
        )
        self.assertEqual(
            {record["source"]["fitid"] for record in authoritative_rows},
            {f"REIMPORT-FITID-{index}" for index in range(1, 7)},
        )
        self.assertEqual(
            first_merge["summary"]["incremental_import"]["added_record_count"],
            0,
        )
        self.assertEqual(
            second_merge["summary"]["incremental_import"]["added_record_count"],
            0,
        )
        self.assertEqual(
            second_merge["summary"]["incremental_import"]["duplicate_record_count"],
            len(gainskeeper_transactions),
        )
        self.assertEqual(first_merge["transactions"], second_merge["transactions"])

    def test_ibkr_gainskeeper_artifact_captures_ofx_period_and_generation_time(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (self._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
            ]
        )

        artifact = payload["source_artifacts"][0]
        self.assertEqual(artifact["statement_period_start"], "2026-07-01")
        self.assertEqual(artifact["statement_period_end"], "2026-07-03")
        self.assertEqual(artifact["statement_generated_at"], "20260704000100")

    def test_ibkr_gainskeeper_transfer_preserves_zero_cash_and_precision(self) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (
                    self._ibkr_gainskeeper_transfer_evidence_file(),
                    "U00000001_20260101_20260804.gkx",
                ),
            ]
        )

        self.assertEqual(len(payload["transactions"]), 2)
        transfer = next(
            record
            for record in payload["transactions"]
            if record["quantity_raw"] == "5.0"
        )
        self.assertEqual(transfer["type"], "transfer_out")
        self.assertEqual(transfer["ticker"], "QQQI")
        self.assertEqual(transfer["quantity_raw"], "5.0")
        self.assertEqual(transfer["price_raw"], "52.68")
        self.assertEqual(transfer["net_amount_raw"], "0")
        self.assertFalse(transfer["normalized"]["is_cash_flow"])
        self.assertEqual(transfer["source"]["fitid"], "235985042")
        self.assertEqual(transfer["source"]["transfer_direction"], "out")
        self.assertEqual(transfer["source"]["transfer_account"], "00000002")

    def test_ibkr_gainskeeper_transfer_upgrades_legacy_transfer_without_duplication(
        self,
    ) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (
                    self._ibkr_gainskeeper_transfer_evidence_file(),
                    "U00000001_20260101_20260804.gkx",
                ),
            ]
        )
        existing = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "source_artifacts": [],
            "transactions": [
                {
                    "date": "2026-07-31",
                    "datetime": "2026-07-31 20:00:00",
                    "type": "transfer_out",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "5",
                    "quantity_abs": "5",
                    "gross_amount_raw": "0",
                    "commission_raw": "0",
                    "net_amount_raw": "0",
                    "description": "FOP transfer out: QQQI",
                    "source": {
                        "file_kind": "ibkr_transfers",
                        "broker": "ibkr",
                        "account": "U00000001",
                        "row_number": 363,
                        "transfer_direction": "out",
                        "transfer_account": "00000002",
                        "market_value_raw": "-263.40",
                    },
                    "normalized": {
                        "position_quantity": "5",
                        "display_quantity": "5",
                        "is_cash_flow": False,
                    },
                }
            ],
        }

        merged = merge_investment_payloads(existing, incoming)
        transfers = [
            record
            for record in merged["transactions"]
            if record.get("type") == "transfer_out"
        ]
        self.assertEqual(len(transfers), 2)
        matched = next(
            record for record in transfers if record["quantity_raw"] in {"5", "5.0"}
        )
        self.assertEqual(matched["price_raw"], "52.68")
        self.assertEqual(matched["source"]["fitid"], "235985042")
        self.assertEqual(matched["source"]["source_format"], "ofx_gkx")
        self.assertEqual(matched["source"]["market_value_raw"], "-263.40")
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_ibkr_csv_replaces_matching_web_paste_rounded_fee(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=self._ibkr_web_trade_notifications_text(),
        )
        csv_record = {
            "date": "2026-07-29",
            "datetime": "2026-07-29 20:00:00",
            "type": "buy",
            "broker": "ibkr",
            "account": "U***00001",
            "currency": "USD",
            "ticker": "DRAM",
            "quantity_raw": "2",
            "quantity_abs": "2",
            "price_raw": "45.5",
            "gross_amount_raw": "-91",
            "commission_raw": "-0.34746325",
            "commission_abs": "0.34746325",
            "net_amount_raw": "-91.34746325",
            "source": {
                "file_kind": "transactions",
                "account": "U***00001",
                "row_number": 42,
                "has_intraday_timestamp": False,
            },
        }
        csv_payload = {
            "schema_version": "3.0.0",
            "generator": {
                "name": "ibkr_csv_to_investment_json",
                "generated_at": "2026-07-30T12:00:00+00:00",
            },
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "transactions": [csv_record],
        }

        merged = merge_investment_payloads(web_payload, csv_payload)
        overlap = [
            record
            for record in merged["transactions"]
            if record.get("ticker") == "DRAM"
            and record.get("quantity_raw") == "2"
            and record.get("price_raw") == "45.5"
        ]

        self.assertEqual(len(overlap), 1)
        self.assertEqual(overlap[0]["source"]["file_kind"], "transactions")
        self.assertEqual(overlap[0]["commission_raw"], "-0.34746325")
        self.assertEqual(overlap[0]["net_amount_raw"], "-91.34746325")
        self.assertNotIn(
            "provisional_until_file_import",
            overlap[0]["source"],
        )
        self.assertNotIn("execution_key", overlap[0]["source"])
        self.assertNotIn("source_timezone", overlap[0]["source"])
        self.assertNotIn("venue", overlap[0]["source"])
        self.assertEqual(len(merged["transactions"]), 6)

    def test_ibkr_csv_pair_rejects_observable_statement_period_contradiction(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        mismatched_positions_csv = positions_csv.replace(
            b"July 1, 2026 - July 3, 2026",
            b"July 1, 2026 - July 4, 2026",
            1,
        )
        with self.assertRaisesRegex(ValueError, "different statement periods"):
            build_investment_payload_from_ibkr_csvs(
                transactions_csv,
                mismatched_positions_csv,
            )

    def test_ibkr_csv_and_gainskeeper_merge_is_order_independent_and_precision_first(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (self._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
            ]
        )

        csv_then_gainskeeper = merge_investment_payloads(
            merge_investment_payloads(None, csv_payload),
            gainskeeper_payload,
        )
        gainskeeper_then_csv = merge_investment_payloads(
            merge_investment_payloads(None, gainskeeper_payload),
            csv_payload,
        )

        for merged in (csv_then_gainskeeper, gainskeeper_then_csv):
            trades = [
                record
                for record in merged["transactions"]
                if record.get("type") == "buy" and record.get("ticker") == "QQQ"
            ]
            self.assertEqual(len(trades), 1)
            self.assertEqual(trades[0]["source"]["file_kind"], "gainskeeper")
            self.assertEqual(trades[0]["datetime"], "2026-07-02 22:33:38")
            self.assertEqual(len(merged["source_artifacts"]), 3)
            ibkr_snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
            self.assertEqual(
                ibkr_snapshot["position_snapshot_source"], "ibkr_csv_open_positions"
            )
            self.assertEqual(
                ibkr_snapshot["position_snapshot"]["QQQ"]["cost_basis"], "100"
            )
            self.assertEqual(
                ibkr_snapshot["performance_snapshot"]["QQQ"]["total"], "10"
            )
            self.assertEqual(len(ibkr_snapshot["evidence"]), 2)

        self.assertEqual(
            csv_then_gainskeeper["transactions"],
            gainskeeper_then_csv["transactions"],
        )
        self.assertEqual(
            csv_then_gainskeeper["broker_snapshots"],
            gainskeeper_then_csv["broker_snapshots"],
        )

    def test_ibkr_merge_rebuilds_realized_summary_from_retained_closed_trades(
        self,
    ) -> None:
        def closed_trade(realized_pnl: str) -> dict[str, object]:
            return {
                "date": "2026-07-21",
                "datetime": "2026-07-21 12:00:00",
                "type": "sell",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "ticker": "DRAM",
                "quantity_raw": "-15",
                "price_raw": "57",
                "broker_realized_pnl_raw": realized_pnl,
                "normalized": {"broker_realized_pnl": realized_pnl},
            }

        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {"performance_snapshot_authoritative": True},
            "performance_snapshot": {},
            "broker_summaries": {
                "ibkr": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "performance_snapshot": {
                        "DRAM": {"realized_total": "408.952041"},
                    },
                    "performance_snapshot_authoritative": True,
                },
            },
            "transactions": [
                closed_trade("224.700059"),
                closed_trade("84.064943"),
                closed_trade("50.718507"),
                closed_trade("49.468532"),
            ],
        }
        latest_csv_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {
                "performance_snapshot_authoritative": True,
                "performance_snapshot_source": "ibkr_csv_realized_summary",
            },
            "performance_snapshot": {
                "DRAM": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "74.064517",
                    "total": "74.064517",
                },
            },
            "broker_summaries": {
                "ibkr": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "performance_snapshot": {
                        "DRAM": {
                            "asset_category": "Stocks",
                            "realized_total": "0",
                            "unrealized_total": "74.064517",
                            "total": "74.064517",
                        },
                    },
                    "performance_snapshot_authoritative": True,
                },
            },
            "transactions": [],
        }

        for existing, incoming in (
            (existing_payload, latest_csv_payload),
            (latest_csv_payload, existing_payload),
        ):
            merged = merge_investment_payloads(existing, incoming)
            ibkr_snapshot = merged["broker_summaries"]["ibkr"]["performance_snapshot"][
                "DRAM"
            ]
            self.assertEqual(ibkr_snapshot["realized_total"], "408.952041")
            self.assertEqual(
                ibkr_snapshot["realized_total_source"], "ibkr_closed_trades"
            )

    def test_ibkr_csv_performance_merges_adjacent_periods_without_overwriting_complete_summary(
        self,
    ) -> None:
        def payload(
            *,
            realized_total: str,
            artifact_sha256: str,
            period_start: str,
            period_end: str,
            transactions: list[dict[str, object]] | None = None,
        ) -> dict[str, object]:
            return {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "summary": {
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot_source": "ibkr_csv_realized_summary",
                },
                "performance_snapshot": {
                    "DRAM": {
                        "asset_category": "Stocks",
                        "realized_total": realized_total,
                        "unrealized_total": "555.781507",
                        "total": "741.30159523",
                    },
                },
                "source_artifacts": [
                    {
                        "sha256": artifact_sha256,
                        "byte_count": 1,
                        "storage_key": artifact_sha256,
                        "filenames": [f"{period_start}_{period_end}.csv"],
                        "source_kind": "ibkr_realized_summary_csv",
                        "statement_period_start": period_start,
                        "statement_period_end": period_end,
                    }
                ],
                "transactions": transactions or [],
            }

        historical = payload(
            realized_total="408.95204025",
            artifact_sha256="a" * 64,
            period_start="2026-01-01",
            period_end="2026-07-31",
        )
        current = payload(
            realized_total="185.52008823",
            artifact_sha256="b" * 64,
            period_start="2026-08-03",
            period_end="2026-08-14",
            transactions=[
                {
                    "date": "2026-08-12",
                    "datetime": "2026-08-12 21:56:59",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-10",
                    "price_raw": "55.65",
                },
                {
                    "date": "2026-08-14",
                    "datetime": "2026-08-14 11:05:45",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-25",
                    "price_raw": "57.7512",
                    "broker_realized_pnl_raw": "159.716076",
                    "normalized": {"broker_realized_pnl": "159.716076"},
                },
            ],
        )

        merged = merge_investment_payloads(historical, current)
        dram = merged["broker_snapshots"]["ibkr:U00000001"]["performance_snapshot"][
            "DRAM"
        ]

        self.assertEqual(dram["realized_total"], "594.47212848")
        self.assertEqual(
            dram["realized_total_source"],
            "ibkr_csv_cumulative_non_overlapping_periods",
        )
        stale_summary = merged["broker_summaries"]["ibkr"]
        stale_summary["performance_snapshot"] = {
            "DRAM": {
                "realized_total": "159.716076",
                "realized_total_source": "ibkr_closed_trades",
            },
        }
        stale_summary["performance_snapshot_as_of"] = "2026-07-31"
        refreshed = normalize_investment_payload_tickers(merged)
        refreshed_summary = refreshed["broker_summaries"]["ibkr"]
        self.assertEqual(refreshed_summary["performance_snapshot"]["DRAM"], dram)
        self.assertEqual(refreshed_summary["performance_snapshot_as_of"], "2026-08-14")

    def test_ibkr_csv_performance_adds_only_verified_tail_of_overlapping_period(
        self,
    ) -> None:
        def payload(
            *,
            artifact_sha256: str,
            period_start: str,
            period_end: str,
            performance_snapshot: dict[str, dict[str, str]],
            transactions: list[dict[str, object]] | None = None,
        ) -> dict[str, object]:
            return {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "summary": {
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot_source": "ibkr_csv_realized_summary",
                },
                "performance_snapshot": performance_snapshot,
                "source_artifacts": [
                    {
                        "sha256": artifact_sha256,
                        "byte_count": 1,
                        "storage_key": artifact_sha256,
                        "filenames": [f"{period_start}_{period_end}.csv"],
                        "source_kind": "ibkr_realized_summary_csv",
                        "statement_period_start": period_start,
                        "statement_period_end": period_end,
                    }
                ],
                "transactions": transactions or [],
            }

        historical = payload(
            artifact_sha256="c" * 64,
            period_start="2026-01-01",
            period_end="2026-08-04",
            performance_snapshot={
                "DRAM": {
                    "asset_category": "Stocks",
                    "realized_total": "100",
                    "unrealized_total": "10",
                    "total": "110",
                },
                "IBKR": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "2",
                    "total": "2",
                },
                "QQQI": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "-1",
                    "total": "-1",
                },
                "CNH": {
                    "asset_category": "Forex",
                    "realized_total": "-5",
                    "unrealized_total": "0",
                    "total": "-5",
                },
                "CLOSED": {
                    "asset_category": "Stocks",
                    "realized_total": "3",
                    "unrealized_total": "4",
                    "total": "7",
                },
            },
        )
        current = payload(
            artifact_sha256="d" * 64,
            period_start="2026-08-01",
            period_end="2026-08-08",
            performance_snapshot={
                "DRAM": {
                    "asset_category": "Stocks",
                    "currency": "USD",
                    "realized_total": "-2",
                    "unrealized_total": "20",
                    "total": "18",
                    "realized_total_source": "ibkr_closed_trades",
                },
                "IBKR": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "1.5",
                    "total": "1.5",
                },
                "QQQI": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "-3",
                    "total": "-3",
                },
                "CNH": {
                    "asset_category": "Forex",
                    "realized_total": "-0.5",
                    "unrealized_total": "0",
                    "total": "-0.5",
                },
            },
            transactions=[
                {
                    "date": "2026-08-04",
                    "datetime": "2026-08-04 12:00:00",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-1",
                    "price_raw": "10",
                    "broker_realized_pnl_raw": "-2",
                    "normalized": {"broker_realized_pnl": "-2"},
                    "source": {
                        "closed_lot_trade_datetime": "2026-08-04, 12:00:00",
                    },
                },
                {
                    "date": "2026-08-08",
                    "datetime": "2026-08-08 23:00:00",
                    "type": "forex_trade_component",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "USD.CNH",
                    "quantity_raw": "10",
                    "price_raw": "7",
                    "broker_realized_pnl_raw": "-0.5",
                    "normalized": {"broker_realized_pnl": "-0.5"},
                    "source": {
                        "broker_realized_pnl_ticker": "CNH",
                        "broker_realized_pnl_currency": "USD",
                        "broker_realized_pnl_date": "2026-08-07",
                    },
                },
            ],
        )

        historical_template = deepcopy(historical)
        current_template = deepcopy(current)
        results = []
        for first, second in (
            (historical_template, current_template),
            (current_template, historical_template),
        ):
            merged = merge_investment_payloads(deepcopy(first), deepcopy(second))
            repeated = merge_investment_payloads(
                deepcopy(merged),
                deepcopy(current_template),
            )
            self.assertEqual(
                merged["broker_snapshots"],
                repeated["broker_snapshots"],
            )
            results.append(merged)

        self.assertEqual(results[0]["broker_snapshots"], results[1]["broker_snapshots"])
        snapshot = results[0]["broker_snapshots"]["ibkr:U00000001"]
        performance = snapshot["performance_snapshot"]
        self.assertEqual(snapshot["performance_snapshot_as_of"], "2026-08-08")
        self.assertEqual(performance["DRAM"]["realized_total"], "100")
        self.assertEqual(performance["DRAM"]["unrealized_total"], "20")
        self.assertEqual(performance["DRAM"]["total"], "120")
        self.assertEqual(performance["CNH"]["realized_total"], "-5.5")
        self.assertEqual(performance["CNH"]["total"], "-5.5")
        self.assertEqual(performance["IBKR"]["total"], "1.5")
        self.assertEqual(performance["QQQI"]["total"], "-3")
        self.assertEqual(performance["CLOSED"]["unrealized_total"], "0")
        self.assertEqual(performance["CLOSED"]["total"], "3")
        self.assertEqual(
            snapshot["performance_snapshot_evidence_id"],
            next(
                evidence["evidence_id"]
                for evidence in snapshot["evidence"]
                if evidence["performance_snapshot_as_of"] == "2026-08-08"
            ),
        )
        self.assertEqual(
            len(snapshot["performance_snapshot_realized_evidence_ids"]),
            2,
        )
        self.assertEqual(
            results[0]["broker_summaries"]["ibkr"]["performance_snapshot"],
            performance,
        )
        for ticker in ("DRAM", "IBKR", "QQQI", "CNH"):
            reconciliation = snapshot["realized_pnl_reconciliation"][ticker]
            self.assertEqual(reconciliation["coverage_status"], "complete")
            self.assertFalse(reconciliation["replay"]["required"])

        incomplete_current = deepcopy(current_template)
        incomplete_current["transactions"][1].pop("broker_realized_pnl_raw")
        incomplete_current["transactions"][1]["normalized"].pop("broker_realized_pnl")
        fail_closed = merge_investment_payloads(historical, incomplete_current)
        fail_closed_snapshot = fail_closed["broker_snapshots"]["ibkr:U00000001"]
        self.assertEqual(
            fail_closed_snapshot["performance_snapshot_as_of"],
            "2026-08-04",
        )
        self.assertEqual(
            fail_closed_snapshot["performance_snapshot"]["CNH"]["realized_total"],
            "-5",
        )

    def test_newer_ibkr_gainskeeper_marks_preserve_existing_csv_cost_basis(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (self._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
            ]
        )
        gainskeeper_payload["position_snapshot"]["QQQ"]["as_of"] = "2026-07-04 20:00:00"
        gainskeeper_payload["source_artifacts"][0]["statement_period_end"] = (
            "2026-07-04"
        )
        gainskeeper_payload.pop("broker_snapshots", None)
        gainskeeper_payload.pop("broker_summaries", None)

        merged = merge_investment_payloads(csv_payload, gainskeeper_payload)
        snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
        qqq_snapshot = snapshot["position_snapshot"]["QQQ"]

        self.assertEqual(
            snapshot["position_snapshot_source"], "ibkr_gainskeeper_positions"
        )
        self.assertEqual(qqq_snapshot["market_value"], "110")
        self.assertEqual(qqq_snapshot["last_price"], "110")
        self.assertEqual(qqq_snapshot["cost_price"], "100")
        self.assertEqual(qqq_snapshot["cost_basis"], "100")
        self.assertEqual(qqq_snapshot["cost_basis_source"], "ibkr_csv_open_positions")
        gainskeeper_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["position_snapshot_source"] == "ibkr_gainskeeper_positions"
        )
        self.assertNotIn("cost_price", gainskeeper_evidence["position_snapshot"]["QQQ"])

    def test_newer_ibkr_gainskeeper_buys_extend_verified_cost_basis(self) -> None:
        baseline_sha256 = "a" * 64
        gainskeeper_sha256 = "b" * 64
        existing = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "source_artifacts": [
                {
                    "sha256": baseline_sha256,
                    "storage_key": baseline_sha256,
                    "byte_count": 1,
                    "filename": "U00000001_20260101_20260803.csv",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "source_kind": "ibkr_realized_summary_csv",
                    "statement_period_start": "2026-01-01",
                    "statement_period_end": "2026-08-03",
                }
            ],
            "summary": {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_csv_open_positions",
            },
            "position_snapshot": {
                "DRAM": {
                    "quantity": "100",
                    "cost_price": "50.20691954",
                    "cost_basis": "5020.691954",
                    "cost_basis_status": "known",
                    "cost_basis_source": "ibkr_csv_open_positions",
                },
            },
            "performance_snapshot": {},
            "transactions": [],
        }

        def gainskeeper_buy(
            *,
            day: str,
            timestamp: str,
            quantity: str,
            price: str,
            net_amount: str,
            commission: str,
            fitid: str,
        ) -> dict[str, object]:
            return {
                "date": day,
                "datetime": timestamp,
                "type": "buy",
                "broker": "ibkr",
                "account": "U00000001",
                "ticker": "DRAM",
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "price_raw": price,
                "commission_raw": commission,
                "net_amount_raw": net_amount,
                "source": {
                    "file_kind": "gainskeeper",
                    "source_format": "ofx_gkx",
                    "fitid": fitid,
                    "broker": "ibkr",
                    "account": "U00000001",
                },
            }

        incoming = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "source_artifacts": [
                {
                    "sha256": gainskeeper_sha256,
                    "storage_key": gainskeeper_sha256,
                    "byte_count": 1,
                    "filename": "U00000001_20260803_20260810.gkx",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "source_kind": "ibkr_gainskeeper_ofx_gkx",
                    "statement_period_start": "2026-07-31",
                    "statement_period_end": "2026-08-10",
                }
            ],
            "summary": {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_gainskeeper_positions",
            },
            "position_snapshot": {
                "DRAM": {
                    "quantity": "105",
                    "market_value": "5208",
                    "last_price": "49.6",
                    "as_of": "2026-08-10 20:20:00",
                },
            },
            "performance_snapshot": {},
            "transactions": [
                gainskeeper_buy(
                    day="2026-08-07",
                    timestamp="2026-08-07 10:43:39",
                    quantity="2",
                    price="49",
                    commission="-0.34446325",
                    net_amount="-98.34446325",
                    fitid="TEST-FITID-20260807-1",
                ),
                gainskeeper_buy(
                    day="2026-08-10",
                    timestamp="2026-08-10 00:57:47",
                    quantity="3",
                    price="50",
                    commission="-0.34906625",
                    net_amount="-150.34906625",
                    fitid="TEST-FITID-20260810-1",
                ),
            ],
        }

        merged = merge_investment_payloads(existing, incoming)
        dram = merged["broker_snapshots"]["ibkr:U00000001"]["position_snapshot"]["DRAM"]
        self.assertEqual(dram["quantity"], "105")
        self.assertEqual(dram["cost_basis"], "5269.38548350")
        self.assertEqual(dram["cost_basis_status"], "known")
        self.assertEqual(
            dram["cost_basis_source"],
            "ibkr_verified_snapshot_plus_gainskeeper_buys",
        )
        self.assertEqual(
            Decimal(dram["cost_price"]),
            Decimal("5269.38548350") / Decimal("105"),
        )
        repair = dram["cost_basis_repair"]
        self.assertEqual(repair["baseline_snapshot_as_of"], "2026-08-03")
        self.assertEqual(repair["source_window_start"], "2026-07-31")
        self.assertEqual(repair["source_window_end"], "2026-08-10")
        self.assertEqual(repair["source_artifact_sha256"], gainskeeper_sha256)
        self.assertEqual(repair["applied_quantity_raw"], "5")
        self.assertEqual(repair["applied_net_cost_raw"], "248.69352950")
        self.assertEqual(
            repair["applied_transaction_fitids"],
            [
                "TEST-FITID-20260807-1",
                "TEST-FITID-20260810-1",
            ],
        )

        incomplete_window = deepcopy(incoming)
        incomplete_window["source_artifacts"][0]["statement_period_start"] = (
            "2026-08-08"
        )
        incomplete_merged = merge_investment_payloads(existing, incomplete_window)
        incomplete_dram = incomplete_merged["broker_snapshots"]["ibkr:U00000001"][
            "position_snapshot"
        ]["DRAM"]
        self.assertNotIn("cost_basis", incomplete_dram)
        self.assertNotIn("cost_price", incomplete_dram)

    def test_newer_ibkr_gainskeeper_quantity_change_does_not_inherit_csv_cost_basis(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (self._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
            ]
        )
        gainskeeper_payload["position_snapshot"]["QQQ"]["as_of"] = "2026-07-04 20:00:00"
        gainskeeper_payload["source_artifacts"][0]["statement_period_end"] = (
            "2026-07-04"
        )
        gainskeeper_payload["position_snapshot"]["QQQ"]["quantity"] = "2"
        gainskeeper_payload["position_snapshot"]["QQQ"]["market_value"] = "220"
        gainskeeper_payload.pop("broker_snapshots", None)
        gainskeeper_payload.pop("broker_summaries", None)

        merged = merge_investment_payloads(csv_payload, gainskeeper_payload)
        snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
        qqq_snapshot = snapshot["position_snapshot"]["QQQ"]

        self.assertEqual(
            snapshot["position_snapshot_source"], "ibkr_gainskeeper_positions"
        )
        self.assertEqual(qqq_snapshot["quantity"], "2")
        self.assertNotIn("cost_price", qqq_snapshot)
        self.assertNotIn("cost_basis", qqq_snapshot)

    def test_hsbc_same_day_portfolio_snapshot_uses_explicit_market_data_update_time(
        self,
    ) -> None:
        def hsbc_payload(*, market_time: str, last_price: str) -> dict[str, object]:
            position = {
                "DRAM": {
                    "asset_category": "Stock",
                    "currency": "USD",
                    "quantity": "200",
                    "cost_price": "60.715",
                    "cost_basis": "12143.000",
                    "market_value": "10120.00",
                    "market": "US",
                    "full_name": "ROUNDHILL MEMORY",
                    "last_price": last_price,
                    "tradable_quantity": "200",
                    "account_number": "000-999999-999",
                }
            }
            return {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [],
                "position_snapshot": position,
                "summary": {
                    "position_snapshot_authoritative": True,
                    "position_snapshot_source": "hsbc_portfolio_text",
                    "hsbc_snapshot": {
                        "portfolio_market_data_updated_at": {
                            "date": "2026-08-07",
                            "time": market_time,
                        }
                    },
                },
                "generator": {"generated_at": f"2026-08-08 {market_time}"},
            }

        existing = hsbc_payload(market_time="16:50:00", last_price="51.440")
        incoming = hsbc_payload(market_time="17:15:00", last_price="50.600")
        merged = merge_investment_payloads(existing, incoming)

        snapshot = merged["broker_snapshots"]["hsbc:000-999999-999"]
        self.assertEqual(snapshot["position_snapshot"]["DRAM"]["last_price"], "50.600")
        selected_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["position_snapshot"]["DRAM"]["last_price"] == "50.600"
        )
        self.assertEqual(
            selected_evidence["snapshot_updated_at"], "2026-08-07 17:15:00"
        )

    def test_merge_dedupes_ibkr_csv_gainskeeper_stock_trades_with_precision_drift(
        self,
    ) -> None:
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-05-31",
                    "datetime": "2026-05-31 22:33:38",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "84",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-4817.4",
                    "commission_raw": "-0.05771889",
                    "net_amount_raw": "-4817.45771889",
                    "source": {
                        "file_kind": "gainskeeper",
                        "fitid": "TEST-FITID-20260601-1",
                        "account": "U00000001",
                    },
                },
                {
                    "date": "2026-05-31",
                    "datetime": "2026-05-31 22:37:04",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "10",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-573.5",
                    "commission_raw": "-0.03105572",
                    "net_amount_raw": "-573.53105572",
                    "source": {
                        "file_kind": "gainskeeper",
                        "fitid": "TEST-FITID-20260601-2",
                        "account": "U00000001",
                    },
                },
            ],
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-01",
                    "datetime": "2026-06-01 20:00:00",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "84.0",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-4817.4",
                    "commission_raw": "-0.057718885",
                    "net_amount_raw": "-4817.457718885",
                    "source": {
                        "file_kind": "transactions",
                        "row_number": 120,
                        "account": "U00000001",
                    },
                },
                {
                    "date": "2026-06-01",
                    "datetime": "2026-06-01 20:00:00",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "10.0",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-573.5",
                    "commission_raw": "-0.031055725",
                    "net_amount_raw": "-573.531055725",
                    "source": {
                        "file_kind": "transactions",
                        "row_number": 111,
                        "account": "U00000001",
                    },
                },
            ],
            "position_snapshot": {
                "QQQI": {
                    "quantity": "250",
                },
            },
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        qqqi_rows = [
            record
            for record in merged["transactions"]
            if record.get("ticker") == "QQQI" and record.get("type") == "buy"
        ]

        self.assertEqual(len(qqqi_rows), 2)
        self.assertEqual(
            sum(Decimal(str(row["quantity_raw"])) for row in qqqi_rows),
            Decimal("94"),
        )
        self.assertTrue(
            all(row["source"]["file_kind"] == "gainskeeper" for row in qqqi_rows)
        )

    def test_ibkr_closed_trade_metadata_survives_csv_gainskeeper_deduplication(
        self,
    ) -> None:
        def stock_trade(file_kind: str, with_closed_trade: bool) -> dict[str, object]:
            record: dict[str, object] = {
                "date": "2026-06-11",
                "datetime": "2026-06-11 12:01:17",
                "type": "sell",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "ticker": "DRAM",
                "quantity_raw": "-15",
                "price_raw": "61",
                "gross_amount_raw": "915",
                "commission_raw": "-0.35107625",
                "net_amount_raw": "914.64892375",
                "normalized": {
                    "position_quantity": "-15",
                    "unit_price": "61",
                    "net_amount": "914.64892375",
                },
                "source": {
                    "file_kind": file_kind,
                    "account": "U00000001",
                },
            }
            if with_closed_trade:
                record.update(
                    {
                        "broker_proceeds_raw": "915",
                        "broker_commission_or_fee_raw": "-0.35107625",
                        "broker_cost_basis_raw": "-689.948866",
                        "broker_realized_pnl_raw": "224.700059",
                    }
                )
                record["normalized"] = {
                    **record["normalized"],
                    "broker_proceeds": "915",
                    "broker_commission_or_fee": "-0.35107625",
                    "broker_cost_basis": "-689.948866",
                    "broker_realized_pnl": "224.700059",
                }
                record["source"] = {
                    **record["source"],
                    "closed_lot_id": "ibkr-realized-summary-row-274",
                }
            return record

        csv_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [stock_trade("transactions", True)],
        }
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "generator": {"name": "ibkr_gainskeeper_ofx_to_investment_json"},
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [stock_trade("gainskeeper", False)],
        }

        for existing_payload, incoming_payload in (
            (gainskeeper_payload, csv_payload),
            (csv_payload, gainskeeper_payload),
        ):
            merged = merge_investment_payloads(existing_payload, incoming_payload)
            dram_sell = next(
                record
                for record in merged["transactions"]
                if record.get("ticker") == "DRAM" and record.get("type") == "sell"
            )
            self.assertEqual(dram_sell["source"]["file_kind"], "gainskeeper")
            self.assertEqual(dram_sell["broker_realized_pnl_raw"], "224.700059")
            self.assertEqual(
                dram_sell["normalized"]["broker_realized_pnl"],
                "224.700059",
            )
            self.assertEqual(
                dram_sell["source"]["closed_lot_id"],
                "ibkr-realized-summary-row-274",
            )

    def test_ibkr_import_attaches_broker_summary_with_ending_cash(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,20.16",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-06-23,U***00001,FX Translations P&L,Adjustment,-,-,-,-,-3.763192093151087,-,-3.763192093151087",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["ending_cash"], "20.16")
        self.assertEqual(payload["broker_summaries"]["ibkr"]["ending_cash"], "20.16")
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["calibration_source"],
            "ibkr_csv_summary",
        )

    def test_ibkr_csv_cash_snapshot_exposes_reported_and_replay_boundaries(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Statement,Data,Period,August 3, 2026 - August 11, 2026",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,456.789012",
                    "Summary,Data,Ending Cash,123.456789",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-08-10,U***00001,ROUNDHILL MEMORY ETF,Buy,DRAM,3,50,USD,-150,-0.34906625,-150.34906625",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Statement,Data,Period,August 3, 2026 - August 11, 2026",
                    "Trades,Header,Asset Category,Symbol",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["summary"]["starting_cash_as_of"], "2026-08-03")
        self.assertEqual(payload["summary"]["ending_cash_as_of"], "2026-08-11")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of"],
            "2026-08-10",
        )
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["ending_cash_replay_as_of"],
            "2026-08-10",
        )

    def test_live_api_payload_fixture_exposes_realized_pnl_reconciliation_contract(
        self,
    ) -> None:
        fixture_path = (
            Path(__file__).parent
            / "fixtures"
            / ("investment_api_payload_reconciliation.json")
        )
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        expected = fixture["expected"]
        normalized = normalize_investment_payload_tickers(deepcopy(fixture))

        ibkr_snapshot = normalized["broker_snapshots"]["ibkr:U00000001"]
        ibkr_reconciliation = normalized["realized_pnl_reconciliation"][
            "ibkr:U00000001"
        ]["tickers"]["DRAM"]
        self.assertEqual(
            ibkr_snapshot["position_snapshot_as_of"],
            expected["position_snapshot_as_of"],
        )
        self.assertEqual(
            ibkr_snapshot["performance_snapshot_as_of"],
            expected["performance_snapshot_as_of"],
        )
        self.assertEqual(ibkr_reconciliation["coverage_status"], "partial")
        self.assertEqual(
            ibkr_reconciliation["as_of"],
            {
                "performance_snapshot": expected["performance_snapshot_as_of"],
                "position_snapshot": expected["position_snapshot_as_of"],
                "transaction_history": expected["transaction_history_through"],
            },
        )
        self.assertEqual(
            ibkr_reconciliation["replay"],
            {
                "status": "required_partial_boundary_reconstructable",
                "required": True,
                "reason": "partial_position_snapshot_requires_history_boundary",
                "post_performance_transaction_count": expected[
                    "ibkr_post_performance_transaction_count"
                ],
                "post_performance_sell_count": expected[
                    "ibkr_post_performance_sell_count"
                ],
            },
        )
        self.assertEqual(
            ibkr_reconciliation["baseline"]["realized_pnl"],
            expected["ibkr_snapshot_baseline_realized_pnl"],
        )
        self.assertEqual(
            normalized["broker_summaries"]["ibkr"]["realized_pnl_reconciliation"][
                "DRAM"
            ],
            ibkr_reconciliation,
        )
        reconciliation_scopes = normalized["realized_pnl_reconciliation"]
        self.assertEqual(
            set(reconciliation_scopes),
            {
                "ibkr:U00000001",
                "hsbc:000-000000-000",
                "schwab:Individual ...000",
            },
        )
        for scope_key, scope in reconciliation_scopes.items():
            self.assertEqual(scope["broker"], scope_key.split(":", 1)[0])
            self.assertTrue(scope["account"])
            self.assertTrue(scope["tickers"])
            for ticker, reconciliation in scope["tickers"].items():
                self.assertEqual(reconciliation["broker"], scope["broker"])
                self.assertEqual(reconciliation["account"], scope["account"])
                self.assertEqual(reconciliation["ticker"], ticker)
                self.assertIn("coverage_status", reconciliation)
                self.assertIn("as_of", reconciliation)
                self.assertIn("replay", reconciliation)
                self.assertIn("status", reconciliation["replay"])

    def test_live_api_payload_fixture_marks_missing_replay_boundary_unavailable(
        self,
    ) -> None:
        fixture_path = (
            Path(__file__).parent
            / "fixtures"
            / ("investment_api_payload_reconciliation.json")
        )
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        payload["broker_summaries"] = {}
        ibkr_snapshot = payload["broker_snapshots"]["ibkr:U00000001"]
        ibkr_snapshot["position_snapshot"] = {}
        ibkr_snapshot["position_snapshot_authoritative"] = False
        ibkr_snapshot["holdings_validation"] = {
            "matched": False,
            "history_complete": False,
        }

        normalized = normalize_investment_payload_tickers(payload)
        reconciliation = normalized["realized_pnl_reconciliation"]["ibkr:U00000001"][
            "tickers"
        ]["DRAM"]
        self.assertEqual(reconciliation["coverage_status"], "unavailable")
        self.assertEqual(
            reconciliation["replay"]["status"], "required_boundary_unavailable"
        )
        self.assertTrue(reconciliation["replay"]["required"])

    def test_merge_preserves_per_broker_ending_cash_when_mixed(self) -> None:
        ibkr_transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,20.16",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-06-23,U***00001,FX Translations P&L,Adjustment,-,-,-,-,-3.763192093151087,-,-3.763192093151087",
                ]
            )
            + "\n"
        )
        ibkr_positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )
        ibkr_payload = build_investment_payload_from_ibkr_csvs(
            ibkr_transactions_csv.encode("utf-8"),
            ibkr_positions_csv.encode("utf-8"),
        )
        hsbc_payload = {
            "schema_version": 3,
            "broker": "hsbc",
            "account": "000-999999-999",
            "ending_cash": "12437.24",
            "summary": {
                "ending_cash_raw": "12437.24",
                "cash_snapshot_source": "hsbc_usd_savings_available_balance",
            },
            "transactions": [
                {
                    "date": "2026-06-24",
                    "type": "deposit",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "currency": "USD",
                    "net_amount_raw": "2200.88",
                    "source": {
                        "broker": "hsbc",
                        "available_cash_after_raw": "12437.24",
                    },
                },
            ],
        }

        merged = merge_investment_payloads(ibkr_payload, hsbc_payload)

        self.assertIsNone(merged.get("ending_cash"))
        self.assertEqual(merged["broker_summaries"]["ibkr"]["ending_cash"], "20.16")
        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "12437.24")
        self.assertTrue(
            merged["summary"]["incremental_import"]["mixed_brokers_or_accounts"]
        )
