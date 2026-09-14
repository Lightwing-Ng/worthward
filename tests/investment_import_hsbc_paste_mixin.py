"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    Decimal,
    _build_hsbc_cash_account_records_from_text,
    _summarize_hsbc_pending_settlement_cash,
    base64,
    build_investment_payload_from_hsbc_pasted_text,
    build_investment_payload_from_hsbc_statement_bundle,
    build_investment_payload_from_hsbc_statement_pairs,
    build_investment_payload_from_hsbc_usd_savings_csv,
    deepcopy,
    hashlib,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    patch,
    repair_hsbc_order_settlement_reconciliation,
    validate_hsbc_pasted_text,
)


class HsbcPasteImportTestsMixin:
    def test_hsbc_pasted_snapshot_records_one_bundle_fingerprint_and_boundary(
        self,
    ) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot()
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        snapshot = payload["summary"]["hsbc_snapshot"]
        self.assertEqual(snapshot["status"], "validated")
        self.assertEqual(snapshot["cash_latest_post_date"], "2026-07-15")
        self.assertEqual(snapshot["latest_fully_executed_order_date"], "2026-07-14")
        self.assertEqual(snapshot["order_status_windows"][0]["end_date"], "2026-07-15")
        self.assertRegex(snapshot["fingerprint"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            payload["generator"]["hsbc_snapshot_fingerprint"],
            snapshot["fingerprint"],
        )
        ram_performance = payload["broker_summaries"]["hsbc"]["performance_snapshot"][
            "RAM"
        ]
        self.assertEqual(ram_performance["realized_total"], "3.21")
        self.assertTrue(ram_performance["realized_total_includes_nonperformance"])
        hsbc_summary = payload["broker_summaries"]["hsbc"]
        self.assertTrue(hsbc_summary["position_snapshot_authoritative"])
        self.assertEqual(
            hsbc_summary["position_snapshot_source"], "hsbc_portfolio_text"
        )
        self.assertEqual(hsbc_summary["position_snapshot"]["DRAM"]["quantity"], "1")
        self.assertEqual(hsbc_summary["holdings_validation"]["matched"], False)
        self.assertEqual(
            hsbc_summary["holdings_validation"]["status"],
            "snapshot_authoritative_partial_history",
        )
        self.assertEqual(
            hsbc_summary["holdings_validation"]["comparison_scope"],
            "visible_explicit_order_status_date_ranges",
        )
        self.assertFalse(hsbc_summary["holdings_validation"]["history_complete"])
        self.assertEqual(len(payload["source_artifacts"]), 3)
        artifacts_by_role = {
            artifact["bundle_role"]: artifact
            for artifact in payload["source_artifacts"]
        }
        self.assertEqual(
            set(artifacts_by_role), {"cash_account", "portfolio", "order_status"}
        )
        self.assertEqual(
            base64.b64decode(artifacts_by_role["portfolio"]["content_base64"]),
            portfolio_text.encode("utf-8"),
        )
        self.assertEqual(
            {artifact["bundle_id"] for artifact in payload["source_artifacts"]},
            {snapshot["fingerprint"]},
        )

    def test_hsbc_pasted_snapshot_uses_exact_quantity_times_last_price_market_value(
        self,
    ) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot()
        )
        portfolio_text = portfolio_text.replace(
            "0.00%1USD 61.000",
            "0.00%1USD 60.00",
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        position = payload["position_snapshot"]["DRAM"]
        self.assertEqual(position["market_value"], "61.000")
        self.assertEqual(position["reported_market_value"], "60.00")
        self.assertEqual(position["market_value_source"], "quantity_times_last_price")
        self.assertEqual(payload["summary"]["position_snapshot_market_value"], "61.000")
        self.assertEqual(
            payload["summary"]["hsbc_portfolio_reported_market_value"], "61.000"
        )
        self.assertTrue(
            payload["summary"]["hsbc_position_market_value_reconciliation"]["matched"]
        )

    def test_hsbc_incremental_order_status_advances_verified_tax_lot_boundary(
        self,
    ) -> None:
        def order_record(
            *,
            transaction_type: str,
            date_text: str,
            quantity: str,
            price: str,
            order_id: str,
        ) -> dict[str, object]:
            signed_amount = (
                f"-{Decimal(quantity) * Decimal(price)}"
                if transaction_type == "buy"
                else f"{Decimal(quantity) * Decimal(price)}"
            )
            return {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": transaction_type,
                "ticker": "DRAM",
                "currency": "USD",
                "broker": "hsbc",
                "account": "000-999999-999",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "price_raw": price,
                "net_amount_raw": signed_amount,
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "order_id": order_id,
                    "statement_order_id": order_id,
                    "account_number": "000-999999-999",
                },
            }

        def snapshot(*, as_of: str, coverage_end: str) -> dict[str, object]:
            coverage = {
                "mode": "explicit_date_ranges",
                "windows": [{"start_date": "2026-08-01", "end_date": coverage_end}],
            }
            return {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "hsbc_portfolio_text",
                "position_snapshot_as_of": as_of,
                "position_snapshot": {
                    "DRAM": {
                        "currency": "USD",
                        "quantity": "5",
                        "cost_price": "50",
                        "market_value": "10800",
                        "last_price": "54",
                    },
                },
                "hsbc_snapshot": {
                    "status": "validated",
                    "portfolio_market_data_updated_at": {"date": as_of},
                    "order_status_coverage": coverage,
                },
                "order_history_scope": coverage,
            }

        existing = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": snapshot(as_of="2026-08-07", coverage_end="2026-08-07"),
            "position_snapshot": snapshot(
                as_of="2026-08-07",
                coverage_end="2026-08-07",
            )["position_snapshot"],
            "transactions": [
                order_record(
                    transaction_type="buy",
                    date_text="2026-08-06",
                    quantity="5",
                    price="50",
                    order_id="P-OLD-DRAM",
                ),
            ],
        }
        incoming = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": snapshot(as_of="2026-08-12", coverage_end="2026-08-13"),
            "position_snapshot": snapshot(
                as_of="2026-08-12",
                coverage_end="2026-08-13",
            )["position_snapshot"],
            "transactions": [
                order_record(
                    transaction_type="buy",
                    date_text="2026-08-12",
                    quantity="5",
                    price="10",
                    order_id="P-NEW-DRAM",
                ),
                order_record(
                    transaction_type="sell",
                    date_text="2026-08-12",
                    quantity="5",
                    price="12",
                    order_id="S-NEW-DRAM",
                ),
            ],
        }

        merged = merge_investment_payloads(existing, incoming)
        verification = merged["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]

        self.assertEqual(verification["verified_through"], "2026-08-12")
        self.assertEqual(verification["expected_shares"], "5")
        self.assertEqual(verification["buy_count"], 4)
        self.assertEqual(verification["sell_count"], 2)
        self.assertEqual(verification["buy_quantity"], "11")
        self.assertEqual(verification["sell_quantity"], "6")
        self.assertEqual(
            verification["verification_source"],
            "authoritative_position_snapshot_and_incremental_replay",
        )

        reimported = merge_investment_payloads(merged, deepcopy(incoming))
        reimported_verification = reimported["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(len(reimported["transactions"]), len(merged["transactions"]))
        self.assertEqual(reimported_verification, verification)

        older_snapshot = deepcopy(existing)
        older_snapshot["summary"]["position_snapshot"]["DRAM"]["quantity"] = "200"
        older_snapshot["summary"]["position_snapshot_as_of"] = "2026-08-07"
        older_snapshot["summary"]["hsbc_snapshot"][
            "portfolio_market_data_updated_at"
        ] = {
            "date": "2026-08-07",
        }
        older_snapshot["summary"]["order_history_scope"]["windows"] = [
            {
                "start_date": "2026-08-01",
                "end_date": "2026-08-07",
            }
        ]
        older_snapshot["summary"]["hsbc_snapshot"]["order_status_coverage"][
            "windows"
        ] = [
            {
                "start_date": "2026-08-01",
                "end_date": "2026-08-07",
            }
        ]
        rolled_back = merge_investment_payloads(reimported, older_snapshot)
        rolled_back_verification = rolled_back["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(
            rolled_back["broker_summaries"]["hsbc"]["position_snapshot_as_of"],
            "2026-08-12",
        )
        self.assertEqual(rolled_back_verification, verification)

        mixed_ledger = deepcopy(reimported)
        mixed_ledger["broker"] = "multiple"
        mixed_ledger["account"] = "multiple"
        mixed_ledger["summary"]["cash_flow_transaction_source"] = "boc_hk_statement_pdf"
        mixed_ledger["broker_summaries"]["boc_hk"] = {
            "broker": "boc_hk",
            "cash_flow_transaction_source": "boc_hk_statement_pdf",
            "statement_periods": ["2026-08"],
        }
        mixed_reimported = merge_investment_payloads(
            mixed_ledger,
            deepcopy(mixed_ledger),
        )
        mixed_verification = mixed_reimported["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(mixed_verification, verification)

        incomplete_coverage = deepcopy(incoming)
        incomplete_coverage["summary"]["order_history_scope"]["windows"] = [
            {
                "start_date": "2026-08-10",
                "end_date": "2026-08-13",
            }
        ]
        incomplete_coverage["summary"]["hsbc_snapshot"]["order_status_coverage"][
            "windows"
        ] = [
            {
                "start_date": "2026-08-10",
                "end_date": "2026-08-13",
            }
        ]
        incomplete = merge_investment_payloads(existing, incomplete_coverage)
        incomplete_verification = incomplete["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(incomplete_verification["verified_through"], "2026-08-07")
        self.assertEqual(incomplete_verification["buy_count"], 3)
        self.assertEqual(incomplete_verification["sell_count"], 1)

        statement_only = deepcopy(incoming)
        statement_only["transactions"] = [
            order_record(
                transaction_type="buy",
                date_text="2026-08-12",
                quantity="5",
                price="10",
                order_id="S-STATEMENT-DRAM",
            ),
            order_record(
                transaction_type="sell",
                date_text="2026-08-12",
                quantity="5",
                price="12",
                order_id="S-STATEMENT-DRAM-SELL",
            ),
        ]
        for transaction in statement_only["transactions"]:
            transaction["source"]["file_kind"] = "hsbc_statement_cash"
        statement_only_result = merge_investment_payloads(existing, statement_only)
        statement_only_verification = statement_only_result["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(statement_only_verification["verified_through"], "2026-08-07")
        self.assertEqual(statement_only_verification["buy_count"], 3)
        self.assertEqual(statement_only_verification["sell_count"], 1)

    def test_hsbc_pasted_snapshot_import_preserves_hkd_and_cnh(self) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot()
        )
        supplementary_cash_text = "\n".join(
            [
                "HKD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "46.10 HKD",
                "Available balance:",
                "46.10 HKD",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "HKD INTEREST",
                "46.10",
                "46.10",
                "Download",
                "CNY Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "12.00 CNY",
                "Available balance:",
                "12.00 CNY",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "CNY INTEREST",
                "12.00",
                "12.00",
                "Download",
            ]
        )
        cash_account_text = f"{cash_account_text}\n===== HSBC PASTE CHUNK =====\n{supplementary_cash_text}"

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "46.10", "CNH": "12.00"},
        )
        self.assertEqual(
            payload["summary"]["cash_flow_transaction_source"],
            "hsbc_multi_currency_cash_account_text",
        )
        self.assertEqual(
            {transaction["currency"] for transaction in payload["transactions"]},
            {"USD", "HKD", "CNH"},
        )
        self.assertNotIn(
            "CNY", {transaction["currency"] for transaction in payload["transactions"]}
        )
        cnh_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "CNH"
        )
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")
        self.assertEqual(
            cnh_record["source"]["file_kind"], "hsbc_multi_currency_cash_account_text"
        )

    def test_hsbc_non_usd_cash_only_paste_can_sync_without_usd_pages(self) -> None:
        cash_account_text = self._synthetic_hsbc_non_usd_cash_paste()

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_account_text,
        )

        self.assertIsNone(payload["ending_cash"])
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(
            payload["summary"]["hsbc_ending_cash_components"],
            {
                "HKD:CURRENT": "1000.00",
                "HKD:SAVINGS": "46.10",
                "CNH:SAVINGS": "12.00",
            },
        )
        self.assertEqual(
            payload["summary"]["hsbc_paste_import_scope"], "cash_only_non_usd"
        )
        self.assertEqual(payload["position_snapshot"], {})
        self.assertEqual(len(payload["source_artifacts"]), 1)
        self.assertEqual(payload["source_artifacts"][0]["bundle_role"], "cash_account")
        self.assertEqual(
            base64.b64decode(payload["source_artifacts"][0]["content_base64"]),
            cash_account_text.encode("utf-8"),
        )
        self.assertEqual(
            {transaction["currency"] for transaction in payload["transactions"]},
            {"HKD", "CNH"},
        )
        cnh_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "CNH"
        )
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")

    def test_hsbc_cash_only_paste_merges_hkd_current_and_savings_balances(self) -> None:
        current_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(
                include_hkd_savings=False,
                include_cnh_savings=False,
            ),
        )
        savings_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(
                include_hkd_current=False,
                include_cnh_savings=False,
            ),
        )

        merged = merge_investment_payloads(current_payload, savings_payload)

        self.assertEqual(merged["ending_cash_by_currency"], {"HKD": "1046.10"})
        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {"HKD:CURRENT": "1000.00", "HKD:SAVINGS": "46.10"},
        )

    def test_hsbc_cash_only_paste_rejects_a_malformed_subaccount_section(self) -> None:
        cash_account_text = "\n".join(
            [
                self._synthetic_hsbc_non_usd_cash_paste(
                    include_hkd_savings=False,
                    include_cnh_savings=False,
                ),
                "HKD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "46.10 HKD",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "HKD INTEREST",
                "46.10",
                "46.10",
                "Download",
            ]
        )

        with self.assertRaisesRegex(ValueError, r"HKD Savings section"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=cash_account_text,
            )

    def test_hsbc_cash_only_paste_keeps_newest_balance_for_duplicate_subaccount_clips(
        self,
    ) -> None:
        newer_clip = self._synthetic_hsbc_hkd_cash_page(
            balance="46.10",
            post_date="15 Jul 2026",
        )
        older_clip = self._synthetic_hsbc_hkd_cash_page(
            balance="40.00",
            post_date="15 Jun 2026",
        )
        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text="\n===== HSBC PASTE CHUNK =====\n".join(
                [
                    newer_clip,
                    older_clip,
                ]
            ),
        )

        self.assertEqual(payload["ending_cash_by_currency"], {"HKD": "46.10"})
        self.assertEqual(
            payload["summary"]["hsbc_ending_cash_components"],
            {"HKD:SAVINGS": "46.10"},
        )
        self.assertEqual(
            payload["summary"]["hsbc_cash_component_post_dates"],
            {"HKD:SAVINGS": "2026-07-15"},
        )

        merged = merge_investment_payloads(
            payload,
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=older_clip,
            ),
        )
        self.assertEqual(merged["ending_cash_by_currency"], {"HKD": "46.10"})
        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {"HKD:SAVINGS": "46.10"},
        )

    def test_hsbc_cash_only_paste_preserves_usd_snapshot_and_hkd_cnh_balances(
        self,
    ) -> None:
        portfolio_text, order_status_text, usd_cash_account_text = (
            self._synthetic_hsbc_paste_snapshot()
        )
        usd_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=usd_cash_account_text,
        )
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        merged = merge_investment_payloads(usd_payload, cash_only_payload)

        self.assertEqual(merged["ending_cash"], usd_payload["ending_cash"])
        self.assertEqual(merged["position_snapshot"], usd_payload["position_snapshot"])
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "60.99")
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(merged["summary"]["hsbc_paste_import_scope"], "usd_composite")
        self.assertTrue(merged["summary"]["cash_snapshot_authoritative"])
        self.assertEqual(merged["summary"]["cash_snapshot_status"], "current")
        self.assertTrue(
            merged["broker_summaries"]["hsbc"]["cash_snapshot_authoritative"]
        )
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["cash_snapshot_status"],
            "current",
        )

        legacy_usd_payload = deepcopy(usd_payload)
        legacy_usd_payload["summary"].pop("hsbc_paste_import_scope", None)
        legacy_merged = merge_investment_payloads(legacy_usd_payload, cash_only_payload)
        refreshed_usd_snapshot = merge_investment_payloads(legacy_merged, usd_payload)

        self.assertEqual(
            legacy_merged["summary"]["hsbc_paste_import_scope"], "usd_composite"
        )
        self.assertEqual(
            refreshed_usd_snapshot["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )

    def test_hsbc_usd_cash_only_settlement_refresh_clears_existing_pending_buy(
        self,
    ) -> None:
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {
                "hsbc_paste_import_scope": "usd_composite",
                "cash_snapshot_source": "hsbc_usd_savings_available_balance",
                "cash_snapshot_status": "awaiting_settlement",
                "ending_cash_by_currency": {"USD": "121.00"},
                "ending_cash_base_currency": "121.00",
                "hsbc_ending_cash_components": {"USD:SAVINGS": "121.00"},
                "hsbc_cash_component_post_dates": {"USD:SAVINGS": "2026-07-14"},
                "position_snapshot_authoritative": True,
                "position_snapshot_as_of": "2026-07-14",
            },
            "ending_cash": "121.00",
            "ending_cash_by_currency": {"USD": "121.00"},
            "ending_cash_base_currency": "121.00",
            "position_snapshot": {
                "DRAM": {
                    "ticker": "DRAM",
                    "quantity": "1",
                    "currency": "USD",
                    "cost_price": "61.000",
                    "market_value": "61.000",
                    "as_of": "2026-07-14",
                },
            },
            "transactions": [
                {
                    "date": "2026-07-14",
                    "datetime": "2026-07-14 20:00:00",
                    "type": "buy",
                    "ticker": "DRAM",
                    "currency": "USD",
                    "description": "ROUNDHILL MEMORY",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "quantity_raw": "1",
                    "quantity_abs": "1",
                    "price_raw": "61.000",
                    "gross_amount_raw": "-61.000",
                    "commission_raw": "0",
                    "net_amount_raw": "-61.000",
                    "normalized": {
                        "position_quantity": "1",
                        "display_quantity": "1",
                        "unit_price": "61.000",
                        "gross_amount": "-61.000",
                        "commission": "0",
                        "net_amount": "-61.000",
                    },
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "P-900001",
                        "order_id": "P-900001",
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "cash_replay_pending_settlement": True,
                    },
                }
            ],
        }
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text="\n".join(
                [
                    "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                    "USD Savings",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "60.00",
                    "USD",
                    "Available balance:",
                    "60.00 USD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "15 Jul 2026",
                    "REF P900001001 SEC",
                    "61.00",
                    "60.00",
                    "Download",
                ]
            ),
        )

        merged = merge_investment_payloads(existing_payload, cash_only_payload)
        order = next(
            transaction
            for transaction in merged["transactions"]
            if transaction.get("source", {}).get("statement_order_id") == "P-900001"
        )
        hsbc_summary = merged["broker_summaries"]["hsbc"]

        self.assertEqual(merged["position_snapshot"]["DRAM"]["quantity"], "1")
        self.assertEqual(hsbc_summary["ending_cash"], "60.00")
        self.assertEqual(hsbc_summary["ending_cash_base_currency_as_of"], "2026-07-15")
        self.assertEqual(hsbc_summary["ending_cash_by_currency"], {"USD": "60.00"})
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_cash"], "0.000000")
        self.assertNotIn("cash_replay_pending_settlement", order["source"])
        self.assertEqual(order["source"]["cash_settlement_amount_raw"], "-61.00")
        self.assertEqual(order["source"]["cash_settlement_balance_after_raw"], "60.00")

    def test_hsbc_statement_legacy_currency_totals_do_not_double_count_pasted_subaccounts(
        self,
    ) -> None:
        pasted_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )
        historical_payload = deepcopy(pasted_payload)
        historical_payload["summary"].pop("hsbc_paste_import_scope", None)
        historical_payload["summary"].pop("hsbc_ending_cash_components", None)
        historical_payload["summary"].pop("hsbc_cash_component_post_dates", None)
        historical_payload["summary"]["historical_statement_backfill"] = True
        historical_payload["summary"]["ending_cash_by_currency"] = {
            "USD": "100.00",
            "HKD": "1046.10",
            "CNH": "12.00",
        }
        historical_payload["ending_cash_by_currency"] = {
            "USD": "100.00",
            "HKD": "1046.10",
            "CNH": "12.00",
        }

        merged = merge_investment_payloads(pasted_payload, historical_payload)

        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {
                "HKD:CURRENT": "1000.00",
                "HKD:SAVINGS": "46.10",
                "CNH:SAVINGS": "12.00",
                "USD:LEGACY": "100.00",
            },
        )
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"HKD": "1046.10", "CNH": "12.00", "USD": "100.00"},
        )

    def test_hsbc_cash_only_paste_rejects_an_invalid_supplementary_clip(self) -> None:
        cash_account_text = "\n===== HSBC PASTE CHUNK =====\n".join(
            [
                self._synthetic_hsbc_non_usd_cash_paste(),
                "This is not an HSBC cash-account page.",
            ]
        )

        with self.assertRaisesRegex(ValueError, r"HSBC cash chunk 2"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=cash_account_text,
            )

    def test_validate_hsbc_pasted_text_accepts_usd_settlement_refresh_and_cash_only(
        self,
    ) -> None:
        _, _, usd_cash_account_text = self._synthetic_hsbc_paste_snapshot()

        awaiting_usd_pages = validate_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=usd_cash_account_text,
        )
        cash_only = validate_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        self.assertTrue(awaiting_usd_pages["ready"])
        self.assertEqual(awaiting_usd_pages["mode"], "cash_only_usd")
        self.assertEqual(
            awaiting_usd_pages["field_status"],
            {
                "cash": True,
                "portfolio": False,
                "order_status": False,
            },
        )
        self.assertNotIn("required_fields", awaiting_usd_pages)
        self.assertTrue(cash_only["ready"])
        self.assertEqual(cash_only["mode"], "cash_only_non_usd")
        self.assertEqual(cash_only["cash_currencies"], ["CNH", "HKD"])

    def test_hsbc_pasted_snapshot_rejects_portfolio_older_than_executed_order(
        self,
    ) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot(
                portfolio_updated_date="13 Jul 2026",
            )
        )

        with self.assertRaisesRegex(ValueError, "Portfolio market-data timestamp"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text=portfolio_text,
                order_status_text=order_status_text,
                cash_account_text=cash_account_text,
            )

    def test_hsbc_pasted_snapshot_rejects_cash_newer_than_order_status_range(
        self,
    ) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot(
                order_status_end_date="2026-07-14",
            )
        )

        with self.assertRaisesRegex(ValueError, "USD Savings has postings through"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text=portfolio_text,
                order_status_text=order_status_text,
                cash_account_text=cash_account_text,
            )

    def test_hsbc_pasted_snapshot_marks_missing_boundaries_for_review(self) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot()
        )
        portfolio_text = portfolio_text.replace(
            "Updated 17:15:00 on 14 Jul 2026 U.S. ET\n",
            "",
        )
        order_status_text = order_status_text.replace(
            "2026-04-01\n01 Apr 2026\n2026-07-15\n15 Jul 2026\n",
            "",
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        self.assertEqual(payload["summary"]["hsbc_snapshot"]["status"], "review")
        self.assertTrue(
            any(
                "could not be fully bounded" in warning
                for warning in payload["summary"]["warnings"]
            )
        )

    def test_hsbc_rolling_snapshot_accepts_pending_cash_and_calibrates_portfolio_price(
        self,
    ) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot(
                portfolio_updated_date="23 Jul 2026",
                order_status_end_date="2026-07-23",
            )
        )
        portfolio_text = (
            portfolio_text.replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace(
                "PortfolioMarket valueUSD 61.000", "PortfolioMarket valueUSD 317.690"
            )
            .replace("61.000\n+0.000", "317.690\n+0.000")
            .replace("USD 61.000", "USD 318.920")
        )
        order_status_text = (
            order_status_text.replace(
                "2026-04-01\n01 Apr 2026\n2026-07-23\n15 Jul 2026\norder status",
                "You may check the status of orders within the last 17 calendar days.\norder status",
            )
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("14 Jul 2026 U.S. ET", "23 Jul 2026 U.S. ET")
            .replace("Sell", "Buy")
            .replace("61.000USD1", "319.000USD1")
            .replace("S-1", "P-900009")
        )
        cash_account_text = cash_account_text.replace("15 Jul 2026", "21 Jul 2026")

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        order = next(
            record for record in payload["transactions"] if record["ticker"] == "GOOGL"
        )
        snapshot = payload["summary"]["hsbc_snapshot"]
        self.assertEqual(snapshot["status"], "validated")
        self.assertEqual(
            snapshot["order_status_coverage"]["mode"], "rolling_recent_window"
        )
        self.assertEqual(snapshot["cash_posting_status"], "awaiting_settlement")
        self.assertEqual(
            snapshot["cash_posting_lag"]["pending_order_ids"], ["P-900009"]
        )
        self.assertEqual(
            snapshot["execution_price_reconciliation"]["status"],
            "provisional_pending_settlement",
        )
        hsbc_summary = payload["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_order_count"], 1)
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_cash"], "-318.920")
        self.assertEqual(hsbc_summary["hsbc_broker_cash_estimate"], "-257.930")
        self.assertEqual(hsbc_summary["holdings_validation"]["matched"], True)
        self.assertEqual(order["price_raw"], "318.920")
        self.assertEqual(order["gross_amount_raw"], "-318.920")
        self.assertEqual(order["source"]["order_status_limit_price_raw"], "319.000")
        self.assertEqual(
            order["source"]["execution_price_source"],
            "hsbc_portfolio_average_purchase_price",
        )
        self.assertEqual(payload["summary"]["warnings"], [])

    def test_hsbc_pending_cash_summary_uses_signed_visible_order_amounts(self) -> None:
        pending_transactions = [
            {
                "broker": "hsbc",
                "net_amount_raw": "1431.250",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "net_amount_raw": "278.500",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "net_amount_raw": "-133.000",
                "source": {"cash_replay_pending_settlement": True},
            },
        ]

        summary = _summarize_hsbc_pending_settlement_cash(
            pending_transactions,
            Decimal("21109.06"),
        )

        self.assertEqual(summary["hsbc_pending_settlement_cash"], "1576.750")
        self.assertEqual(summary["hsbc_broker_cash_estimate"], "22685.810")

    def test_hsbc_pending_cash_summary_keeps_unposted_fee_unapplied(self) -> None:
        pending_transactions = [
            {
                "broker": "hsbc",
                "type": "sell",
                "net_amount_raw": "1431.250",
                "source": {
                    "cash_replay_pending_settlement": True,
                    "cash_replay_pending_settlement_fee_amount_raw": "0.020",
                },
            },
            {
                "broker": "hsbc",
                "type": "sell",
                "net_amount_raw": "278.500",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "type": "buy",
                "net_amount_raw": "-133.000",
                "source": {"cash_replay_pending_settlement": True},
            },
        ]

        summary = _summarize_hsbc_pending_settlement_cash(
            pending_transactions,
            Decimal("21108.38"),
            broker_cash_balance=Decimal("21109.06"),
        )

        self.assertEqual(summary["hsbc_bank_available_cash"], "21108.38")
        self.assertEqual(summary["hsbc_pending_settlement_cash_raw"], "1576.750")
        self.assertEqual(summary["hsbc_pending_settlement_fee_adjustment"], "0.000")
        self.assertEqual(summary["hsbc_pending_settlement_fee_unapplied"], "0.020")
        self.assertEqual(
            summary["hsbc_pending_settlement_fee_policy"],
            "exclude_unposted_until_settled_cash_posting",
        )
        self.assertEqual(summary["hsbc_pending_settlement_cash"], "1576.750")
        self.assertEqual(summary["hsbc_broker_cash_estimate"], "22685.810")

    def test_hsbc_settled_cash_reconciles_provisional_execution_price(self) -> None:
        portfolio_text, order_status_text, cash_account_text = (
            self._synthetic_hsbc_paste_snapshot(
                portfolio_updated_date="23 Jul 2026",
                order_status_end_date="2026-07-23",
            )
        )
        portfolio_text = (
            portfolio_text.replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace(
                "PortfolioMarket valueUSD 61.000", "PortfolioMarket valueUSD 317.690"
            )
            .replace("61.000\n+0.000", "317.690\n+0.000")
            .replace("USD 61.000", "USD 318.920")
        )
        order_status_text = (
            order_status_text.replace(
                "2026-04-01\n01 Apr 2026\n2026-07-23\n15 Jul 2026\norder status",
                "You may check the status of orders within the last 17 calendar days.\norder status",
            )
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("14 Jul 2026 U.S. ET", "23 Jul 2026 U.S. ET")
            .replace("Sell", "Buy")
            .replace("61.000USD1", "319.000USD1")
            .replace("S-1", "P-900009")
        )
        cash_account_text = cash_account_text.replace(
            "15 Jul 2026\nREF S900001001 SEC\n60.99\n60.99",
            "23 Jul 2026\nREF P900009001 SEC\n318.91\n60.99",
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        order = next(
            record for record in payload["transactions"] if record["ticker"] == "GOOGL"
        )
        source = order["source"]
        self.assertEqual(order["price_raw"], "318.910")
        self.assertEqual(order["gross_amount_raw"], "-318.910")
        self.assertEqual(order["net_amount_raw"], "-318.91")
        self.assertEqual(source["execution_price_status"], "final_settled")
        self.assertEqual(
            source["execution_price_source"], "hsbc_cash_settlement_amount"
        )
        self.assertEqual(source["execution_price_provisional_raw"], "318.920")
        self.assertEqual(source["execution_price_final_raw"], "318.910")
        self.assertEqual(source["execution_price_settlement_amount_raw"], "-318.91")
        self.assertEqual(source["execution_price_settlement_date"], "2026-07-23")
        self.assertEqual(
            payload["summary"]["hsbc_snapshot"]["execution_price_reconciliation"][
                "status"
            ],
            "settled",
        )
        self.assertEqual(payload["summary"]["hsbc_final_settled_execution_count"], 1)
        self.assertEqual(payload["summary"]["warnings"], [])

    def test_hsbc_incremental_merge_preserves_dividend_ticker_and_repairs_status(
        self,
    ) -> None:
        existing_record = {
            "date": "2026-07-10",
            "datetime": "2026-07-10 20:00:00",
            "type": "dividend",
            "ticker": "SGOV",
            "currency": "USD",
            "description": "CORP EVT PAYMENT SEC",
            "broker": "hsbc",
            "account": "000-999999-999",
            "net_amount_raw": "21.29",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "balance_after_raw": "27357.71",
                "dividend_attribution_status": "unavailable_from_hsbc_cash_text",
                "dividend_attribution_method": "eligible_shares_and_local_dividend_action",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "deposit"
        incoming_record["ticker"] = ""
        incoming_record["source"] = {
            "file_kind": "hsbc_usd_account_text",
            "balance_after_raw": "27357.71",
            "dividend_attribution_status": "unavailable_from_hsbc_cash_text",
        }

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [existing_record],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [incoming_record],
            },
        )
        dividend = merged["transactions"][0]
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(
            dividend["source"]["dividend_attribution_status"],
            "preserved_existing_ledger_attribution",
        )
        self.assertTrue(
            dividend["source"]["dividend_attribution_preserved_on_incremental_import"]
        )
        self.assertTrue(
            dividend["source"][
                "dividend_classification_preserved_on_incremental_import"
            ]
        )

    def test_hsbc_cross_source_merge_repairs_legacy_attributed_dividend_deposit(
        self,
    ) -> None:
        existing_record = {
            "date": "2026-07-10",
            "datetime": "2026-07-10 20:00:00",
            "type": "deposit",
            "ticker": "SGOV",
            "currency": "USD",
            "description": "CORP EVT PAYMENT SEC",
            "broker": "hsbc",
            "account": "000-999999-999",
            "gross_amount_raw": "21.29",
            "commission_raw": "0",
            "net_amount_raw": "21.29",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "balance_after_raw": "27357.71",
                "dividend_attribution_status": "preserved_existing_ledger_attribution",
                "dividend_attribution_method": "eligible_shares_and_local_dividend_action",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "dividend"
        incoming_record["ticker"] = ""
        incoming_record["source"] = {
            "file_kind": "hsbc_usd_savings_csv",
            "row_number": 43,
            "account_number": "000-999999-999",
            "balance_after_raw": "27357.71",
        }

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [existing_record],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [incoming_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        dividend = merged["transactions"][0]
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertTrue(
            dividend["source"]["dividend_classification_repaired_after_import"]
        )

    def test_hsbc_statement_bundle_identifies_each_pdf_once_and_pairs_automatically(
        self,
    ) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ) as mocked_extract:
            payload = build_investment_payload_from_hsbc_statement_bundle(
                [
                    (b"investment", "opaque-2.pdf"),
                    (b"composite", "opaque-1.pdf"),
                ]
            )

        self.assertEqual(mocked_extract.call_count, 2)
        self.assertEqual(payload["summary"]["statement_pair_count"], 1)
        self.assertEqual(payload["summary"]["composite_statement_count"], 1)
        self.assertEqual(payload["summary"]["investment_statement_count"], 1)
        self.assertEqual(len(payload["source_artifacts"]), 2)
        artifacts_by_role = {
            artifact["bundle_role"]: artifact
            for artifact in payload["source_artifacts"]
        }
        self.assertEqual(
            artifacts_by_role["composite_statement"]["sha256"],
            hashlib.sha256(b"composite").hexdigest(),
        )
        self.assertEqual(
            artifacts_by_role["investment_statement"]["sha256"],
            hashlib.sha256(b"investment").hexdigest(),
        )
        self.assertEqual(
            artifacts_by_role["composite_statement"]["related_sha256"],
            artifacts_by_role["investment_statement"]["sha256"],
        )
        dividend = next(
            record for record in payload["transactions"] if record["type"] == "dividend"
        )
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(
            dividend["source"]["source_file_sha256"],
            artifacts_by_role["investment_statement"]["sha256"],
        )

    def test_hsbc_statement_reimport_preserves_richer_same_source_classification(
        self,
    ) -> None:
        existing_record = {
            "date": "2024-07-26",
            "datetime": "2024-07-26 20:00:00",
            "type": "kol_reward",
            "ticker": "",
            "currency": "HKD",
            "description": "KOL Rewards · WISE PAYMENTS LTD REF00000000000000 26JUL · Longbridge",
            "gross_amount_raw": "3100.00",
            "commission_raw": "0",
            "net_amount_raw": "3100.00",
            "broker": "hsbc",
            "account": "000-999999-999",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_054050.pdf",
                "row_number": 3,
                "ledger_sequence": 3,
                "account_number": "000-999999-999",
                "balance_after_raw": "3100.00",
                "reference_id": "WISE PAYMENTS LTD REF00000000000000 26JUL",
                "account_type": "HKD Savings",
                "statement_period": "2024-08",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "deposit"
        incoming_record["description"] = "WISE PAYMENTS LTD REF00000000000000 26JUL"
        incoming_record["source"]["source_file_sha256"] = "a" * 64

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [existing_record],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [incoming_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["transactions"][0]["type"], "kol_reward")
        self.assertEqual(
            merged["transactions"][0]["source"]["source_file_sha256"],
            "a" * 64,
        )

    def test_hsbc_statement_settlement_rows_enrich_order_without_duplicate_cash(
        self,
    ) -> None:
        order = {
            "date": "2026-06-17",
            "datetime": "2026-06-17 20:00:00",
            "type": "sell",
            "ticker": "BOXX",
            "currency": "USD",
            "description": "Alpha Architect 1-3 Month Box ETF",
            "quantity_raw": "2",
            "quantity_abs": "2",
            "price_raw": "58.510",
            "gross_amount_raw": "117.020",
            "commission_raw": "-0.01",
            "net_amount_raw": "117.01",
            "broker": "hsbc",
            "account": "000-999999-999",
            "source": {
                "file_kind": "hsbc_order_status_text",
                "statement_order_id": "S-900005",
                "order_id": "S-900005",
                "cash_settlement_date": "2026-06-18",
                "cash_settlement_amount_raw": "117.01",
                "cash_settlement_balance_after_raw": "4360.53",
                "cash_settlement_source_row_number": 10,
                "cash_flow_fee_amount_raw": "0.01",
                "cash_flow_fee_row_numbers": [11],
            },
        }

        def statement_cash(
            amount: str,
            balance: str,
            row_number: int,
            transaction_type: str,
        ) -> dict[str, object]:
            return {
                "date": "2026-06-18",
                "datetime": "2026-06-18 20:00:00",
                "type": transaction_type,
                "ticker": "",
                "currency": "USD",
                "description": transaction_type.upper(),
                "gross_amount_raw": amount,
                "commission_raw": "0",
                "net_amount_raw": amount,
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_format": "statement_pdf",
                    "source_filename": "eStatementFile_432244.pdf",
                    "source_file_sha256": "b" * 64,
                    "row_number": row_number,
                    "ledger_sequence": row_number,
                    "account_number": "000-999999-999",
                    "balance_after_raw": balance,
                    "reference_id": transaction_type.upper(),
                    "account_type": "USD Savings",
                    "statement_period": "2026-07",
                },
            }

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {},
                "transactions": [order],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [
                    statement_cash("117.01", "4360.54", 20, "deposit"),
                    statement_cash("-0.01", "4360.53", 21, "withdrawal"),
                ],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        postings = merged["transactions"][0]["source"]["cash_settlement_postings"]
        self.assertEqual(
            [posting["role"] for posting in postings], ["principal", "fee"]
        )
        self.assertTrue(
            all(
                posting["statement_pdf_source_sha256"] == "b" * 64
                for posting in postings
            )
        )
        incremental = merged["summary"]["incremental_import"]
        self.assertEqual(
            incremental["enriched_hsbc_statement_settlement_posting_count"],
            2,
        )
        self.assertEqual(incremental["added_record_count"], 0)

    def test_hsbc_order_settlement_balance_uses_last_chronological_posting(
        self,
    ) -> None:
        payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-07-16",
                    "datetime": "2026-07-16 20:00:00",
                    "type": "sell",
                    "ticker": "EUV",
                    "currency": "USD",
                    "description": "EUV",
                    "quantity_raw": "5",
                    "quantity_abs": "5",
                    "price_raw": "54.00",
                    "gross_amount_raw": "270.00",
                    "commission_raw": "-0.01",
                    "net_amount_raw": "269.99",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "S-223761",
                        "cash_settlement_amount_raw": "269.99",
                        "cash_settlement_balance_after_raw": "25236.79",
                        "cash_settlement_postings": [
                            {
                                "date": "2026-07-16",
                                "amount_raw": "-0.01",
                                "balance_after_raw": "25236.79",
                                "row_number": 40,
                                "ledger_sequence": 40,
                                "role": "fee",
                            },
                            {
                                "date": "2026-07-16",
                                "amount_raw": "269.99",
                                "balance_after_raw": "25506.78",
                                "row_number": 41,
                                "ledger_sequence": 41,
                                "role": "principal",
                            },
                        ],
                    },
                }
            ],
        }

        repaired, updated_count = repair_hsbc_order_settlement_reconciliation(payload)
        order = repaired["transactions"][0]

        self.assertEqual(updated_count, 1)
        self.assertEqual(
            order["source"]["cash_settlement_balance_after_raw"],
            "25506.78",
        )
        self.assertEqual(
            order["source"]["cash_settlement_source_row_number"],
            41,
        )

    def test_hsbc_repair_preserves_verified_current_cash_boundary_separately(
        self,
    ) -> None:
        payload = {
            "broker": "multiple",
            "account": "multiple",
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
                "hsbc_ending_cash_components": {
                    "USD:SAVINGS": "21108.38",
                    "HKD:SAVINGS": "89.24",
                },
                "hsbc_cash_component_post_dates": {
                    "USD:SAVINGS": "2026-08-07",
                },
            },
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "ending_cash": "21108.38",
                    "ending_cash_base_currency": "21109.06",
                    "ending_cash_base_currency_status": "authoritative_effective_boundary",
                    "hsbc_snapshot": {
                        "cash_latest_post_date": "2026-08-13",
                    },
                },
            },
            "transactions": [],
        }

        repaired, _updated_count = repair_hsbc_order_settlement_reconciliation(payload)
        summary = repaired["summary"]
        hsbc_summary = repaired["broker_summaries"]["hsbc"]

        self.assertEqual(
            summary["hsbc_ending_cash_components"]["USD:SAVINGS"], "21109.06"
        )
        self.assertEqual(
            summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"], "2026-08-13"
        )
        self.assertEqual(summary["hsbc_bank_available_cash"], "21109.06")
        self.assertEqual(hsbc_summary["ending_cash"], "21109.06")
        self.assertEqual(hsbc_summary["ending_cash_by_currency"]["HKD"], "89.24")

    def test_hsbc_official_usd_csv_repairs_conflicting_page_balance(self) -> None:
        order_payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-08-04",
                    "datetime": "2026-08-04 20:00:00",
                    "type": "buy",
                    "ticker": "EUV",
                    "currency": "USD",
                    "description": "EUV",
                    "quantity_raw": "1",
                    "quantity_abs": "1",
                    "price_raw": "22.50",
                    "gross_amount_raw": "-22.50",
                    "commission_raw": "0",
                    "net_amount_raw": "-22.50",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "P-900001",
                        "cash_settlement_amount_raw": "-22.50",
                        "cash_settlement_balance_after_raw": "20444.97",
                        "cash_settlement_postings": [
                            {
                                "date": "2026-08-04",
                                "amount_raw": "-22.50",
                                "balance_after_raw": "20444.97",
                                "row_number": 35,
                                "ledger_sequence": 35,
                                "role": "principal",
                            }
                        ],
                    },
                }
            ],
        }
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "04/08/2026,REF P900001001 SEC,-22.50,USD,20545.39,USD",
                "03/08/2026,5475364 R45475,100.00,USD,20567.89,USD",
            ]
        )
        csv_payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        merged = merge_investment_payloads(order_payload, csv_payload)
        order = next(
            transaction
            for transaction in merged["transactions"]
            if transaction.get("source", {}).get("statement_order_id") == "P-900001"
        )

        self.assertEqual(
            order["source"]["cash_settlement_balance_after_raw"],
            "20545.39",
        )
        self.assertEqual(
            order["source"]["cash_settlement_authoritative_source"],
            "hsbc_usd_savings_transaction_history_csv",
        )
        self.assertEqual(
            order["source"]["cash_settlement_postings"][0]["source_file_kind"],
            "hsbc_usd_savings_csv",
        )

    def test_hsbc_settlement_reconciliation_uses_mill_price_precision(self) -> None:
        payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-06-25",
                    "datetime": "2026-06-25 20:00:00",
                    "type": "sell",
                    "ticker": "RAM",
                    "currency": "USD",
                    "quantity_raw": "3",
                    "quantity_abs": "3",
                    "price_raw": "45",
                    "gross_amount_raw": "135",
                    "commission_raw": "-0.01",
                    "net_amount_raw": "135.89",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "S-900006",
                        "cash_settlement_date": "2026-06-26",
                        "cash_settlement_amount_raw": "135.89",
                    },
                }
            ],
        }

        normalize_investment_payload_tickers(payload)
        order = payload["transactions"][0]

        self.assertEqual(order["price_raw"], "45.300")
        self.assertEqual(order["gross_amount_raw"], "135.900")
        self.assertNotIn("settlement_adjustment_raw", order)

    def test_hsbc_statement_batches_reject_unmatched_periods(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()
        august_investment_text = investment_text.replace(
            "10JUL2026", "10AUG2026"
        ).replace("11JUN2026", "11JUL2026")

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            if pdf_bytes == b"composite":
                return composite_text
            if pdf_bytes == b"investment-july":
                return investment_text
            return august_investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            with self.assertRaisesRegex(
                ValueError, "missing composite statement for 2026-08-10"
            ):
                build_investment_payload_from_hsbc_statement_pairs(
                    composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                    investment_statement_payloads=[
                        (b"investment-july", "investment-july.pdf"),
                        (b"investment-august", "investment-august.pdf"),
                    ],
                )

    def test_hsbc_live_paste_snapshot_wins_over_historical_statement_backfill(
        self,
    ) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            historical = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )
        live = deepcopy(historical)
        live["summary"].pop("historical_statement_backfill", None)
        live["position_snapshot"]["SGOV"]["as_of"] = "2026-07-11"
        live["ending_cash"] = "900.00"
        live["summary"]["ending_cash_raw"] = "900.00"
        live["position_snapshot"]["SGOV"]["quantity"] = "2"
        live["broker_summaries"]["hsbc"]["position_snapshot_as_of"] = "2026-07-11"
        live["broker_summaries"]["hsbc"]["ending_cash"] = "900.00"
        live["broker_summaries"]["hsbc"]["ending_cash_raw"] = "900.00"
        live_dividend = next(
            record for record in live["transactions"] if record["type"] == "dividend"
        )
        live_dividend["description"] = "CORP EVT PAYMENT SEC"
        live_dividend["source"].pop("corporate_action_reference", None)
        live_dividend["source"]["dividend_attribution_status"] = (
            "matched_local_market_action"
        )

        merged = merge_investment_payloads(live, historical)

        dividends = [
            record for record in merged["transactions"] if record["type"] == "dividend"
        ]
        self.assertEqual(len(dividends), 1)
        self.assertEqual(
            dividends[0]["source"]["corporate_action_reference"], "CORTMP890672010"
        )
        self.assertEqual(merged["ending_cash"], "900.00")
        self.assertEqual(merged["position_snapshot"]["SGOV"]["quantity"], "2")

    def test_hsbc_later_statement_snapshot_advances_older_live_snapshot(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            historical = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )

        live = deepcopy(historical)
        live["summary"].pop("historical_statement_backfill", None)
        live["broker_summaries"]["hsbc"].pop(
            "historical_statement_backfill",
            None,
        )
        live["source_artifacts"] = []
        live["broker_snapshots"] = {}
        live["position_snapshot"]["SGOV"]["as_of"] = "2026-07-09"
        live["position_snapshot"]["SGOV"]["quantity"] = "2"
        live["ending_cash"] = "900.00"
        live["summary"]["ending_cash_raw"] = "900.00"
        live["broker_summaries"]["hsbc"]["position_snapshot_as_of"] = "2026-07-09"
        live["broker_summaries"]["hsbc"]["ending_cash"] = "900.00"
        live["broker_summaries"]["hsbc"]["ending_cash_raw"] = "900.00"
        for summary in (live["summary"], live["broker_summaries"]["hsbc"]):
            summary["hsbc_ending_cash_components"] = {
                "USD:FOREIGN CURRENCY SAVINGS USD": "0.00",
                "USD:SAVINGS": "900.00",
            }
            summary["hsbc_cash_component_post_dates"] = {
                "USD:FOREIGN CURRENCY SAVINGS USD": "2023-03-07",
                "USD:SAVINGS": "2026-07-09",
            }

        merged = merge_investment_payloads(live, historical)

        self.assertEqual(merged["ending_cash"], "921.29")
        self.assertEqual(merged["position_snapshot"]["SGOV"]["quantity"], "5")
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["ending_cash_by_currency"]["USD"],
            "921.29",
        )

    def test_hsbc_corporate_event_payment_is_attributed_to_unique_sgov_dividend(
        self,
    ) -> None:
        portfolio_text = "\n".join(
            [
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Portfolio",
                "PortfolioMarket valueUSD 8,040.000",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "100.500",
                "+0.020",
                "+0.02%80USD 8,040.000",
                "-6.360",
                "Unrealised gain / loss-6.360",
                "-0.08%",
                "USD 100.5795",
                "information",
            ]
        )
        order_status_text = "\n".join(
            [
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "30 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "100.680USD80",
                "Quantity",
                "Executed quantity80 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900007",
            ]
        )
        cash_account_text = "\n".join(
            [
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "1,021.29",
                "USD",
                "Available balance:",
                "1,021.29 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "10 Jul 2026",
                "CORP EVT PAYMENT SEC",
                "21.29",
                "1,021.29",
                "09 Jul 2026",
                "USD CLEARING CHEQUE",
                "1,000.00",
                "1,000.00",
                "Download",
            ]
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
            dividend_action_loader=lambda tickers: {
                "SGOV": [
                    {
                        "date": "2026-07-01",
                        "dividend_per_share": "0.295765",
                    }
                ]
            },
        )

        dividend = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        )
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(dividend["net_amount_raw"], "21.29")
        self.assertEqual(
            dividend["source"]["dividend_attribution_status"],
            "matched_local_market_action",
        )
        self.assertEqual(dividend["source"]["dividend_eligible_quantity_raw"], "80")
        self.assertEqual(
            dividend["source"]["dividend_inferred_net_retention_rate"], "0.90"
        )
        sgov_buy = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["type"] == "buy" and transaction["ticker"] == "SGOV"
        )
        self.assertFalse(
            sgov_buy["source"].get("cash_replay_pending_settlement", False)
        )
        self.assertEqual(
            sgov_buy["source"]["cash_settlement_match_status"],
            "outside_visible_cash_window",
        )

        legacy_payload = deepcopy(payload)
        legacy_dividend = next(
            transaction
            for transaction in legacy_payload["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        )
        legacy_dividend["type"] = "deposit"
        legacy_dividend["ticker"] = ""
        legacy_dividend["source"] = {
            key: value
            for key, value in legacy_dividend["source"].items()
            if not key.startswith("dividend_")
        }
        merged = merge_investment_payloads(legacy_payload, payload)
        merged_corporate_events = [
            transaction
            for transaction in merged["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        ]
        self.assertEqual(len(merged_corporate_events), 1)
        self.assertEqual(merged_corporate_events[0]["type"], "dividend")
        self.assertEqual(merged_corporate_events[0]["ticker"], "SGOV")

    def test_hsbc_unmatched_corporate_event_remains_unattributed_dividend(self) -> None:
        warnings: list[str] = []
        _, _, _, records = _build_hsbc_cash_account_records_from_text(
            "\n".join(
                [
                    "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                    "USD Savings",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "21.29",
                    "USD",
                    "Available balance:",
                    "21.29 USD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "10 Jul 2026",
                    "CORP EVT PAYMENT SEC",
                    "21.29",
                    "21.29",
                    "Download",
                ]
            ),
            warnings=warnings,
        )

        self.assertEqual(records[0]["type"], "dividend")
        self.assertEqual(records[0]["ticker"], "")
