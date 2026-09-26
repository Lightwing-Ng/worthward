"""HSBC evidence-boundary and attribution regression mixin.

Code version: v0.3.2
- Added: Official CSV settlement evidence fails closed on missing or mismatched
  broker, bundle-role, and account metadata.
- Added: Storage-backed paste evidence repairs legacy HSBC settlement postings
  fail-closed without changing their economic values.
- Added: Full-ledger settlement replay covers fees on either side of principal
  while restricting stock-order cash evidence to USD Savings.
- Added: Non-CSV settlement producers reject CSV sequence markers and divergent
  physical-row and ledger-sequence identities.
- Added: USD-only settlement source kinds reject foreign-currency, non-Savings,
  and incomplete official-CSV sequence metadata.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.support.investment_import.investment_import_test_support import (
    _normalize_source_artifacts,
    _attribute_hsbc_corporate_event_dividends,
    _enrich_hsbc_orders_with_statement_cash_evidence,
    _finalize_hsbc_order_settlement_balance,
    _hsbc_usd_savings_csv_settlement_evidence,
    _hsbc_settlement_postings_have_valid_sequence_order,
    _mark_hsbc_trade_settlement_history_hidden,
    _match_hsbc_orders_to_cash_settlements,
    _match_hsbc_statement_cash_record,
    _parse_hsbc_usd_savings_csv_rows,
    _repair_hsbc_pasted_cash_settlement_posting_provenance,
    _reconcile_hsbc_orders_with_authoritative_cash_evidence,
    base64,
    build_investment_payload_from_hsbc_pasted_text,
    build_investment_payload_from_hsbc_statement_pairs,
    build_investment_payload_from_hsbc_usd_savings_csv,
    deepcopy,
    hashlib,
    merge_investment_payloads,
    patch,
    repair_hsbc_order_settlement_reconciliation,
)


class HsbcEvidenceBoundaryImportTestsMixin:
    def test_hsbc_statement_fee_match_stays_in_principal_cash_scope(self) -> None:
        def cash_record(
            amount: str,
            account_type: str,
            row_number: int,
        ) -> dict:
            return {
                "date": "2026-09-18",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "net_amount_raw": amount,
                "source": {
                    "account_number": "ACCOUNT-A",
                    "account_type": account_type,
                    "balance_after_raw": "1,000.00",
                    "source_sequence_sha256": "a" * 64,
                    "row_number": row_number,
                },
            }

        principal = cash_record("100.00", "USD Savings", 10)
        foreign_fee = cash_record("-0.01", "USD Current", 20)
        used_record_ids: set[int] = set()

        matched_principal = _match_hsbc_statement_cash_record(
            [principal, foreign_fee],
            used_record_ids,
            transaction_date="2026-09-18",
            signed_amount=Decimal("100.00"),
        )
        matched_fee = _match_hsbc_statement_cash_record(
            [principal, foreign_fee],
            used_record_ids,
            transaction_date="2026-09-18",
            signed_amount=Decimal("-0.01"),
            expected_account="ACCOUNT-A",
            expected_account_type="USD Savings",
            expected_source_sequence_sha256="a" * 64,
        )

        self.assertIs(matched_principal, principal)
        self.assertIsNone(matched_fee)
        self.assertEqual(used_record_ids, {id(principal)})

    def test_hsbc_statement_pair_rejects_ambiguous_cash_subaccounts(self) -> None:
        def cash_record(account_type: str, balance: str, row_number: int) -> dict:
            return {
                "date": "2026-09-18",
                "currency": "USD",
                "net_amount_raw": "100.00",
                "source": {
                    "account_type": account_type,
                    "balance_after_raw": balance,
                    "source_sequence_sha256": "a" * 64,
                    "row_number": row_number,
                },
            }

        used_record_ids: set[int] = set()
        matched = _match_hsbc_statement_cash_record(
            [
                cash_record("USD Savings", "1,000.00", 10),
                cash_record("USD Current", "5,000.00", 20),
            ],
            used_record_ids,
            transaction_date="2026-09-18",
            signed_amount=Decimal("100.00"),
        )

        self.assertIsNone(matched)
        self.assertEqual(used_record_ids, set())

    def test_hsbc_pasted_cash_match_rejects_a_pretrade_posting(self) -> None:
        order = {
            "date": "2026-09-17",
            "type": "sell",
            "currency": "USD",
            "net_amount_raw": "200.00",
            "source": {
                "statement_order_id": "S-900001",
                "account_number": "ACCOUNT-A",
            },
        }
        cash = {
            "date": "2026-09-16",
            "type": "deposit",
            "currency": "USD",
            "description": "REF S900001001 SEC",
            "net_amount_raw": "200.00",
            "account": "ACCOUNT-A",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "account_number": "ACCOUNT-A",
                "account_type": "USD Savings",
                "balance_after_raw": "1,200.00",
                "ledger_sequence": 40,
                "row_number": 40,
                "source_sequence_sha256": "a" * 64,
            },
        }

        _match_hsbc_orders_to_cash_settlements([order], [cash], [])

        self.assertNotIn("cash_settlement_date", order["source"])
        self.assertNotIn("cash_settlement_postings", order["source"])
        self.assertNotIn("presentation_hidden", cash)

    def test_hsbc_pasted_cash_match_requires_complete_principal_identity(self) -> None:
        def cash_record(*, row_number: int, balance: str) -> dict:
            return {
                "date": "2026-09-18",
                "type": "deposit",
                "currency": "USD",
                "description": "REF S900001001 SEC",
                "net_amount_raw": "200.00",
                "account": "ACCOUNT-A",
                "source": {
                    "file_kind": "hsbc_usd_account_text",
                    "account_number": "ACCOUNT-A",
                    "account_type": "USD Savings",
                    "balance_after_raw": balance,
                    "ledger_sequence": row_number,
                    "row_number": row_number,
                    "source_sequence_sha256": "a" * 64,
                },
            }

        for label, cash in (
            ("missing sequence", cash_record(row_number=0, balance="1,200.00")),
            ("missing balance", cash_record(row_number=40, balance="")),
        ):
            with self.subTest(label=label):
                order = {
                    "date": "2026-09-17",
                    "type": "sell",
                    "currency": "USD",
                    "net_amount_raw": "200.00",
                    "source": {
                        "statement_order_id": "S-900001",
                        "account_number": "ACCOUNT-A",
                    },
                }
                _match_hsbc_orders_to_cash_settlements([order], [cash], [])
                self.assertNotIn("cash_settlement_date", order["source"])
                self.assertNotIn("presentation_hidden", cash)

    def test_hsbc_trade_settlement_pair_never_crosses_cash_scope(self) -> None:
        def cash_record(
            transaction_type: str,
            amount: str,
            account_type: str,
            description: str,
        ) -> dict:
            return {
                "date": "2026-09-18",
                "type": transaction_type,
                "currency": "USD",
                "description": description,
                "net_amount_raw": amount,
                "account": "ACCOUNT-A",
                "source": {
                    "file_kind": "hsbc_multi_currency_cash_account_text",
                    "account_number": "ACCOUNT-A",
                    "account_type": account_type,
                    "balance_after_raw": "0.00",
                    "source_sequence_sha256": "a" * 64,
                },
            }

        deposit = cash_record(
            "deposit",
            "100.00",
            "USD Savings",
            "HK123456ABCDEF",
        )
        withdrawal = cash_record(
            "withdrawal",
            "-100.00",
            "USD Current",
            "HK654321UVWXYZ",
        )

        _mark_hsbc_trade_settlement_history_hidden([deposit, withdrawal])

        self.assertNotIn("presentation_hidden", deposit)
        self.assertNotIn("presentation_hidden", withdrawal)

    def test_hsbc_cross_source_cash_merge_requires_known_canonical_scope(self) -> None:
        def cash_record(file_kind: str, account_type: str) -> dict:
            return {
                "date": "2026-09-18",
                "type": "deposit",
                "currency": "USD",
                "description": "CASH RECEIPT",
                "net_amount_raw": "100.00",
                "broker": "hsbc",
                "account": "ACCOUNT-A",
                "source": {
                    "file_kind": file_kind,
                    "account_number": "ACCOUNT-A",
                    "account_type": account_type,
                    "balance_after_raw": "1,000.00",
                    "source_sequence_sha256": (
                        "a" * 64 if file_kind == "hsbc_usd_account_text" else "b" * 64
                    ),
                    "row_number": 10,
                    "ledger_sequence": 10,
                },
            }

        cases = (
            ("different subaccounts", "USD Savings", "USD Current", 2),
            ("both unknown", "", "", 2),
            (
                "canonical savings aliases",
                "USD Savings",
                "Foreign Currency Savings USD",
                1,
            ),
        )
        for label, existing_type, incoming_type, expected_count in cases:
            with self.subTest(label=label):
                merged = merge_investment_payloads(
                    {
                        "broker": "hsbc",
                        "account": "ACCOUNT-A",
                        "transactions": [
                            cash_record("hsbc_usd_account_text", existing_type)
                        ],
                    },
                    {
                        "broker": "hsbc",
                        "account": "ACCOUNT-A",
                        "transactions": [
                            cash_record(
                                "hsbc_multi_currency_cash_account_text",
                                incoming_type,
                            )
                        ],
                    },
                )
                self.assertEqual(len(merged["transactions"]), expected_count)

    def test_hsbc_core_dividend_attribution_requires_usd_evidence(self) -> None:
        def order(currency: str) -> dict:
            return {
                "date": "2026-06-30",
                "type": "buy",
                "ticker": "QQQI",
                "currency": currency,
                "quantity_abs": "10",
            }

        def event(currency: str) -> dict:
            return {
                "date": "2026-07-10",
                "type": "dividend",
                "ticker": "",
                "currency": currency,
                "description": "CORP EVT PAYMENT SEC",
                "net_amount_raw": "9.00",
                "source": {},
            }

        loader_calls: list[set[str]] = []

        def load_actions(tickers: set[str]) -> dict[str, list[dict[str, str]]]:
            loader_calls.append(set(tickers))
            return {"QQQI": [{"date": "2026-07-01", "dividend_per_share": "1"}]}

        hkd_event = event("HKD")
        _attribute_hsbc_corporate_event_dividends(
            [hkd_event],
            [order("USD")],
            {"QQQI": {"currency": "USD", "quantity": "10"}},
            [],
            load_actions,
        )
        self.assertEqual(hkd_event["ticker"], "")
        self.assertEqual(loader_calls, [])

        usd_event = event("USD")
        _attribute_hsbc_corporate_event_dividends(
            [usd_event],
            [order("HKD")],
            {"QQQI": {"currency": "HKD", "quantity": "10"}},
            [],
            load_actions,
        )
        self.assertEqual(usd_event["ticker"], "")
        self.assertEqual(loader_calls, [])

    def test_hsbc_official_csv_rejects_conflicting_equal_principal_evidence(
        self,
    ) -> None:
        def artifact(balance: str, opening_balance: str) -> dict[str, object]:
            csv_text = "\n".join(
                [
                    "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                    f"04/08/2026,REF P900001001 SEC,-22.50,USD,{balance},USD",
                    f"03/08/2026,OPENING,100.00,USD,{opening_balance},USD",
                ]
            )
            payload = build_investment_payload_from_hsbc_usd_savings_csv(
                csv_text.encode("utf-8"),
                filename="TransactionHistoryUSDSavings.csv",
            )
            result = deepcopy(payload["source_artifacts"][0])
            result["account"] = "ACCOUNT-A"
            return result

        order = {
            "date": "2026-08-04",
            "type": "buy",
            "ticker": "EUV",
            "currency": "USD",
            "account": "ACCOUNT-A",
            "net_amount_raw": "-22.50",
            "broker": "hsbc",
            "source": {
                "file_kind": "hsbc_order_status_text",
                "statement_order_id": "P-900001",
            },
        }
        payload = {
            "broker": "hsbc",
            "account": "ACCOUNT-A",
            "summary": {},
            "transactions": [order],
            "source_artifacts": [
                artifact("77.50", "100.00"),
                artifact("177.50", "200.00"),
            ],
        }

        repaired, updated_count = repair_hsbc_order_settlement_reconciliation(payload)

        self.assertEqual(updated_count, 0)
        self.assertNotIn(
            "cash_settlement_balance_after_raw",
            repaired["transactions"][0]["source"],
        )

    def test_hsbc_official_csv_rejects_a_pretrade_posting(self) -> None:
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "03/08/2026,REF P900001001 SEC,-22.50,USD,77.50,USD",
                "02/08/2026,OPENING,100.00,USD,100.00,USD",
            ]
        )
        csv_payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )
        csv_payload["source_artifacts"][0]["account"] = "ACCOUNT-A"
        payload = {
            "broker": "hsbc",
            "account": "ACCOUNT-A",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-08-04",
                    "type": "buy",
                    "ticker": "EUV",
                    "currency": "USD",
                    "account": "ACCOUNT-A",
                    "net_amount_raw": "-22.50",
                    "broker": "hsbc",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "P-900001",
                    },
                }
            ],
            "source_artifacts": deepcopy(csv_payload["source_artifacts"]),
        }

        repaired, updated_count = repair_hsbc_order_settlement_reconciliation(payload)

        self.assertEqual(updated_count, 0)
        self.assertNotIn(
            "cash_settlement_date",
            repaired["transactions"][0]["source"],
        )

    def test_hsbc_statement_cash_enrichment_keeps_cash_subaccounts_separate(
        self,
    ) -> None:
        order = {
            "date": "2026-09-17",
            "type": "sell",
            "ticker": "QQQI",
            "currency": "USD",
            "account": "ACCOUNT-A",
            "net_amount_raw": "100.00",
            "broker": "hsbc",
            "source": {
                "file_kind": "hsbc_order_status_text",
                "statement_order_id": "S-900001",
                "cash_settlement_postings": [
                    {
                        "date": "2026-09-18",
                        "amount_raw": "100.00",
                        "balance_after_raw": "1,000.00",
                        "account_number": "ACCOUNT-A",
                        "account_type": "USD Savings",
                        "currency": "USD",
                        "source_file_kind": "hsbc_usd_account_text",
                        "source_sequence_sha256": "a" * 64,
                        "ledger_sequence": 40,
                        "row_number": 40,
                        "role": "principal",
                    }
                ],
            },
        }
        statement_cash = {
            "date": "2026-09-18",
            "type": "deposit",
            "currency": "USD",
            "description": "STATEMENT CASH",
            "account": "ACCOUNT-A",
            "net_amount_raw": "100.00",
            "broker": "hsbc",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "account_number": "ACCOUNT-A",
                "account_type": "USD Current",
                "balance_after_raw": "5,000.00",
                "source_file_sha256": "b" * 64,
                "source_sequence_sha256": "b" * 64,
                "ledger_sequence": 20,
                "row_number": 20,
            },
        }

        merged = merge_investment_payloads(
            {"broker": "hsbc", "transactions": [order], "summary": {}},
            {
                "broker": "hsbc",
                "transactions": [statement_cash],
                "summary": {"historical_statement_backfill": True},
            },
        )

        self.assertEqual(len(merged["transactions"]), 2)
        retained_order = next(
            transaction
            for transaction in merged["transactions"]
            if transaction.get("type") == "sell"
        )
        retained_posting = retained_order["source"]["cash_settlement_postings"][0]
        self.assertEqual(retained_posting["account_type"], "USD Savings")
        self.assertEqual(retained_posting["balance_after_raw"], "1,000.00")

    def test_hsbc_official_csv_settlement_evidence_is_not_reused_across_accounts(
        self,
    ) -> None:
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "04/08/2026,REF P900001001 SEC,-22.50,USD,20545.39,USD",
                "03/08/2026,OPENING,100.00,USD,20567.89,USD",
            ]
        )
        csv_payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )
        csv_payload["source_artifacts"][0]["account"] = "000-999999-999"

        def order(account: str) -> dict[str, object]:
            return {
                "date": "2026-08-04",
                "type": "buy",
                "ticker": "EUV",
                "currency": "USD",
                "account": account,
                "quantity_raw": "1",
                "quantity_abs": "1",
                "price_raw": "22.50",
                "gross_amount_raw": "-22.50",
                "commission_raw": "0",
                "net_amount_raw": "-22.50",
                "broker": "hsbc",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": "P-900001",
                },
            }

        payload = {
            "broker": "multiple",
            "account": "multiple",
            "summary": {},
            "transactions": [
                order("000-999999-999"),
                order("111-222222-333"),
            ],
            "source_artifacts": deepcopy(csv_payload["source_artifacts"]),
        }

        with patch(
            "app.services.investment.importing.brokers.hsbc.reconciliation."
            "HSBC_EXPECTED_ACCOUNT_NUMBER",
            "000-999999-999",
        ):
            repaired, updated_count = repair_hsbc_order_settlement_reconciliation(
                deepcopy(payload)
            )
        repaired_by_account = {
            record["account"]: record for record in repaired["transactions"]
        }

        self.assertEqual(updated_count, 1)
        self.assertEqual(
            repaired_by_account["000-999999-999"]["source"][
                "cash_settlement_balance_after_raw"
            ],
            "20545.39",
        )
        self.assertNotIn(
            "cash_settlement_balance_after_raw",
            repaired_by_account["111-222222-333"]["source"],
        )

        legacy_payload = deepcopy(payload)
        legacy_payload["source_artifacts"][0]["account"] = ""
        with patch(
            "app.services.investment.importing.brokers.hsbc.reconciliation."
            "HSBC_EXPECTED_ACCOUNT_NUMBER",
            "",
        ):
            ambiguous, ambiguous_updated_count = (
                repair_hsbc_order_settlement_reconciliation(legacy_payload)
            )
        self.assertEqual(ambiguous_updated_count, 0)
        self.assertTrue(
            all(
                "cash_settlement_balance_after_raw" not in record["source"]
                for record in ambiguous["transactions"]
            )
        )

    def test_hsbc_official_csv_keeps_artifact_account_across_config_drift(
        self,
    ) -> None:
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "04/08/2026,REF P900001001 SEC,-22.50,USD,20545.39,USD",
                "03/08/2026,OPENING,100.00,USD,20567.89,USD",
            ]
        )
        csv_payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )
        csv_payload["source_artifacts"][0]["account"] = "ACCOUNT-A"

        def payload_for(account: str) -> dict[str, object]:
            return {
                "broker": "hsbc",
                "account": account,
                "summary": {},
                "transactions": [
                    {
                        "date": "2026-08-04",
                        "type": "buy",
                        "ticker": "EUV",
                        "currency": "USD",
                        "account": account,
                        "quantity_raw": "1",
                        "price_raw": "22.50",
                        "net_amount_raw": "-22.50",
                        "broker": "hsbc",
                        "source": {
                            "file_kind": "hsbc_order_status_text",
                            "statement_order_id": "P-900001",
                        },
                    }
                ],
                "source_artifacts": deepcopy(csv_payload["source_artifacts"]),
            }

        repaired_a, updated_a = repair_hsbc_order_settlement_reconciliation(
            payload_for("ACCOUNT-A")
        )
        self.assertEqual(updated_a, 1)
        self.assertIn(
            "cash_settlement_balance_after_raw",
            repaired_a["transactions"][0]["source"],
        )

        with patch(
            "app.services.investment.importing.brokers.hsbc.reconciliation."
            "HSBC_EXPECTED_ACCOUNT_NUMBER",
            "ACCOUNT-B",
        ):
            repaired_b, updated_b = repair_hsbc_order_settlement_reconciliation(
                payload_for("ACCOUNT-B")
            )
        self.assertEqual(updated_b, 0)
        self.assertNotIn(
            "cash_settlement_balance_after_raw",
            repaired_b["transactions"][0]["source"],
        )

    def test_hsbc_cash_only_artifact_records_visible_post_date_range(self) -> None:
        cash_account_text = "\n".join(
            [
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "12.00",
                "USD",
                "Available balance:",
                "12.00 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "21 Sep 2026",
                "INTEREST",
                "2.00",
                "12.00",
                "21 Aug 2026",
                "NET ZERO TEST",
                "1.00",
                "1.00",
                "10.00",
                "Download",
            ]
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_account_text,
        )

        snapshot = payload["summary"]["hsbc_snapshot"]
        self.assertEqual(snapshot["cash_earliest_post_date"], "2026-08-21")
        self.assertEqual(snapshot["cash_latest_post_date"], "2026-09-21")
        artifact = payload["source_artifacts"][0]
        self.assertEqual(artifact["statement_period_start"], "2026-08-21")
        self.assertEqual(artifact["statement_period_end"], "2026-09-21")
        self.assertEqual(artifact["statement_period"], "2026-08-21/2026-09-21")
        self.assertEqual(artifact["cash_earliest_post_date"], "2026-08-21")
        self.assertEqual(artifact["cash_latest_post_date"], "2026-09-21")
        self.assertTrue(payload["transactions"])
        self.assertTrue(
            all(
                transaction["source"]["source_sequence_sha256"] == artifact["sha256"]
                for transaction in payload["transactions"]
            )
        )

        legacy_payload = deepcopy(payload)
        legacy_artifact = legacy_payload["source_artifacts"][0]
        legacy_artifact["statement_period_start"] = "2026-09-21"
        legacy_artifact["statement_period_end"] = "2026-09-21"
        legacy_artifact["statement_period"] = "2026-09-21/2026-09-21"
        legacy_artifact.pop("cash_earliest_post_date")
        legacy_artifact.pop("cash_latest_post_date")
        reimported = merge_investment_payloads(legacy_payload, payload)
        self.assertEqual(len(reimported["source_artifacts"]), 1)
        self.assertEqual(
            reimported["source_artifacts"][0]["sha256"], artifact["sha256"]
        )
        self.assertEqual(len(reimported["transactions"]), len(payload["transactions"]))
        reimported_artifact = reimported["source_artifacts"][0]
        self.assertEqual(reimported_artifact["statement_period_start"], "2026-08-21")
        self.assertEqual(reimported_artifact["statement_period_end"], "2026-09-21")
        self.assertEqual(
            reimported_artifact["statement_period"], "2026-08-21/2026-09-21"
        )
        self.assertEqual(
            merge_investment_payloads(reimported, payload)["source_artifacts"][0],
            reimported_artifact,
        )

    def test_hsbc_cash_only_visible_period_repair_is_source_scoped(self) -> None:
        source_bytes = b"same cash capture"
        digest = hashlib.sha256(source_bytes).hexdigest()
        current = {
            "evidence_schema_version": "1.0",
            "sha256": digest,
            "byte_count": len(source_bytes),
            "broker": "hsbc",
            "account": "000-999999-999",
            "source_kind": "hsbc_cash_account_pasted_text",
            "bundle_role": "cash_account",
            "statement_period_start": "2026-09-21",
            "statement_period_end": "2026-09-21",
            "statement_period": "2026-09-21/2026-09-21",
            "content_encoding": "base64",
            "content_base64": base64.b64encode(source_bytes).decode("ascii"),
        }
        incoming = {
            **current,
            "statement_period_start": "2026-08-21",
            "statement_period_end": "2026-09-21",
            "statement_period": "2026-08-21/2026-09-21",
            "cash_earliest_post_date": "2026-08-21",
            "cash_latest_post_date": "2026-09-21",
        }
        cases: dict[str, tuple[dict[str, object], dict[str, object]]] = {
            "different source kind": (
                current,
                {**incoming, "source_kind": "hsbc_portfolio_pasted_text"},
            ),
            "different role": (
                current,
                {**incoming, "bundle_role": "portfolio"},
            ),
            "different account": (
                current,
                {**incoming, "account": "000-999999-998"},
            ),
            "missing visible start": (
                current,
                {
                    key: value
                    for key, value in incoming.items()
                    if key != "cash_earliest_post_date"
                },
            ),
            "invalid visible start": (
                current,
                {**incoming, "cash_earliest_post_date": "not-a-date"},
            ),
            "current period outside visible range": (
                {
                    **current,
                    "statement_period_start": "2026-08-01",
                    "statement_period": "2026-08-01/2026-09-21",
                },
                incoming,
            ),
        }

        for label, (case_current, case_incoming) in cases.items():
            with self.subTest(label=label):
                merged = _normalize_source_artifacts([case_current, case_incoming])[0]
                self.assertEqual(
                    merged["statement_period"],
                    case_current["statement_period"],
                )

    def test_hsbc_statement_pair_retains_consumed_principal_and_fee_postings(
        self,
    ) -> None:
        def statement_header() -> str:
            return (
                f"{'Date':<12}{'Transaction Details':<76}"
                f"{'Deposit':<28}{'Withdrawal':<27}Balance"
            )

        def statement_row(
            date_text: str,
            description: str,
            *,
            deposit: str = "",
            withdrawal: str = "",
            balance: str = "",
        ) -> str:
            return (
                f"{date_text:<12}{description:<76}"
                f"{deposit:<28}{withdrawal:<27}{balance}"
            )

        composite_text = "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 1 of 4",
                "10 July 2026",
                "Foreign Currency Savings",
                statement_header(),
                statement_row("USD 10 Jun", "B/F BALANCE", balance="0.00"),
                statement_row(
                    "17 Jun",
                    "SEC SALE PROCEEDS",
                    deposit="100.00",
                    balance="100.00",
                ),
                statement_row(
                    "17 Jun",
                    "XACT CHARGE",
                    withdrawal="0.01",
                    balance="99.99",
                ),
                "Total Relationship Balance",
            ]
        )
        investment_text = "\n".join(
            [
                "Date : 10JUL2026",
                "A/C name : DEMO ACCOUNT HOLDER",
                "A/C no : 000-999999-998",
                "Period : From 11JUN2026 to 10JUL2026",
                "Portfolio details",
                "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
                "Risk Lvl NA 2 1 USD 100.00000 USD 100.00",
                "Transaction summary",
                "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
                "16JUN2026 17JUN2026 USD 100.00000 1- USD 100.00",
                "Reference: SALTMP900002001 Type: SAL",
                "Charges and income summary",
                "16JUN2026 SALE SGOV",
                "ISHARES 0-3 MONTH TRS BD (SHS)",
                "OUR REFERENCE:SALTMP900002001",
                "Page 4 of 4",
                "HSBC Investment Services Composite Statement",
                "Date : 10JUL2026",
                "Charges and income summary",
                "XACT CHARGE USD 0.01",
            ]
        )

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )

        sale = next(
            record for record in payload["transactions"] if record["type"] == "sell"
        )
        postings = sale["source"]["cash_settlement_postings"]
        composite_sha256 = hashlib.sha256(b"composite").hexdigest()
        self.assertEqual(
            [(posting["role"], posting["amount_raw"]) for posting in postings],
            [("principal", "100.00"), ("fee", "-0.01")],
        )
        self.assertTrue(
            all(
                posting["source_sequence_sha256"] == composite_sha256
                and posting["account_number"] == "000-999999-999"
                and posting["account_type"] == "Foreign Currency Savings USD"
                and posting["currency"] == "USD"
                for posting in postings
            )
        )
        economic_before = {
            field_name: deepcopy(sale.get(field_name))
            for field_name in (
                "gross_amount_raw",
                "commission_raw",
                "net_amount_raw",
                "normalized",
            )
        }

        reimported = merge_investment_payloads(payload, payload)
        reimported_sales = [
            record
            for record in reimported["transactions"]
            if record.get("source", {}).get("statement_order_id") == "S-900002"
        ]
        self.assertEqual(len(reimported_sales), 1)
        self.assertEqual(
            reimported_sales[0]["source"]["cash_settlement_postings"], postings
        )
        self.assertEqual(
            {
                field_name: reimported_sales[0].get(field_name)
                for field_name in economic_before
            },
            economic_before,
        )

    def test_hsbc_settlement_finalizer_rejects_incomplete_or_cross_domain_evidence(
        self,
    ) -> None:
        def order() -> dict:
            return {
                "date": "2026-07-16",
                "type": "sell",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "broker": "hsbc",
                "net_amount_raw": "100.00",
                "source": {
                    "statement_order_id": "S-100001",
                    "cash_settlement_date": "2026-07-17",
                    "cash_settlement_amount_raw": "100.00",
                    "cash_settlement_balance_after_raw": "OLD",
                    "cash_settlement_source_row_number": 9,
                    "cash_settlement_postings": [
                        {
                            "date": "2026-07-17",
                            "amount_raw": "100.00",
                            "balance_after_raw": "1100.00",
                            "reference": "STATEMENT PRINCIPAL",
                            "row_number": 40,
                            "ledger_sequence": 40,
                            "source_file_kind": "hsbc_statement_cash",
                            "source_sequence_sha256": "a" * 64,
                            "statement_pdf_source_sha256": "a" * 64,
                            "account_number": "ACCOUNT-A",
                            "account_type": "USD Savings",
                            "currency": "USD",
                            "role": "principal",
                        },
                        {
                            "date": "2026-07-17",
                            "amount_raw": "-0.01",
                            "balance_after_raw": "1099.99",
                            "reference": "STATEMENT FEE",
                            "row_number": 41,
                            "ledger_sequence": 41,
                            "source_file_kind": "hsbc_statement_cash",
                            "source_sequence_sha256": "a" * 64,
                            "statement_pdf_source_sha256": "a" * 64,
                            "account_number": "ACCOUNT-A",
                            "account_type": "USD Savings",
                            "currency": "USD",
                            "role": "fee",
                        },
                    ],
                },
            }

        def structured_order(
            source_file_kind: str,
            *,
            ledger_sequence_order: str = "",
        ) -> dict:
            candidate = order()
            for posting in candidate["source"]["cash_settlement_postings"]:
                posting["source_file_kind"] = source_file_kind
                posting["reference"] = "REF S100001001 SEC"
                posting.pop("statement_pdf_source_sha256", None)
                if ledger_sequence_order:
                    posting["ledger_sequence_order"] = ledger_sequence_order
            return candidate

        valid = order()
        self.assertTrue(
            _finalize_hsbc_order_settlement_balance(
                valid["source"],
                order_record=valid,
            )
        )
        self.assertEqual(
            valid["source"]["cash_settlement_balance_after_raw"],
            "1099.99",
        )
        self.assertEqual(valid["source"]["cash_settlement_source_row_number"], 41)

        valid_csv = structured_order(
            "hsbc_usd_savings_csv",
            ledger_sequence_order="chronological",
        )
        for sequence, posting in enumerate(
            valid_csv["source"]["cash_settlement_postings"],
            start=1,
        ):
            posting["ledger_sequence"] = sequence

        for label, compatible in (
            (
                "USD account text",
                structured_order("hsbc_usd_account_text"),
            ),
            (
                "multi-currency cash text",
                structured_order("hsbc_multi_currency_cash_account_text"),
            ),
            ("official USD Savings CSV", valid_csv),
        ):
            with self.subTest(valid_source_format=label):
                self.assertTrue(
                    _finalize_hsbc_order_settlement_balance(
                        compatible["source"],
                        order_record=compatible,
                    )
                )

        invalid_cases: dict[str, dict] = {}
        missing_currency = order()
        missing_currency.pop("currency")
        invalid_cases["missing owner currency"] = missing_currency
        blank_final_balance = order()
        blank_final_balance["source"]["cash_settlement_postings"][1][
            "balance_after_raw"
        ] = ""
        invalid_cases["blank final balance"] = blank_final_balance
        blank_principal_balance = order()
        blank_principal_balance["source"]["cash_settlement_postings"][0][
            "balance_after_raw"
        ] = ""
        invalid_cases["blank principal balance"] = blank_principal_balance
        missing_reference = order()
        missing_reference["source"].pop("statement_order_id")
        invalid_cases["missing owner reference"] = missing_reference
        pretrade = order()
        pretrade["date"] = "2026-07-18"
        invalid_cases["pretrade settlement"] = pretrade
        wrong_sign = order()
        wrong_sign["source"]["cash_settlement_amount_raw"] = "-100.00"
        wrong_sign["source"]["cash_settlement_postings"][0]["amount_raw"] = "-100.00"
        invalid_cases["sell principal has buy sign"] = wrong_sign
        wrong_amount = order()
        wrong_amount["source"]["cash_settlement_postings"][0]["amount_raw"] = "200.00"
        invalid_cases["principal amount mismatch"] = wrong_amount
        wrong_owner_net = order()
        wrong_owner_net["net_amount_raw"] = "90.00"
        invalid_cases["owner net amount mismatch"] = wrong_owner_net
        cross_account = order()
        cross_account["source"]["cash_settlement_postings"][1][
            "account_number"
        ] = "ACCOUNT-B"
        invalid_cases["cross-account posting"] = cross_account
        cross_account_type = order()
        cross_account_type["source"]["cash_settlement_postings"][1][
            "account_type"
        ] = "USD Current"
        invalid_cases["cross-account-type posting"] = cross_account_type
        cross_currency = order()
        cross_currency["source"]["cash_settlement_postings"][1]["currency"] = "HKD"
        invalid_cases["cross-currency posting"] = cross_currency
        cross_date = order()
        cross_date["source"]["cash_settlement_postings"][1]["date"] = "2026-07-18"
        invalid_cases["cross-date posting"] = cross_date
        invalid_file_kind = order()
        for posting in invalid_file_kind["source"]["cash_settlement_postings"]:
            posting["source_file_kind"] = "hsbc_unknown_cash"
        invalid_cases["invalid file kind"] = invalid_file_kind
        malformed_sha = order()
        for posting in malformed_sha["source"]["cash_settlement_postings"]:
            posting["source_sequence_sha256"] = "not-a-sha"
            posting["statement_pdf_source_sha256"] = "not-a-sha"
        invalid_cases["malformed source digest"] = malformed_sha
        conflicting_sha_alias = order()
        conflicting_sha_alias["source"]["cash_settlement_postings"][1][
            "statement_pdf_source_sha256"
        ] = "b" * 64
        invalid_cases["conflicting source digest alias"] = conflicting_sha_alias
        wrong_reference = order()
        for posting in wrong_reference["source"]["cash_settlement_postings"]:
            posting["source_file_kind"] = "hsbc_usd_account_text"
            posting["reference"] = "REF S100001001 SEC"
        wrong_reference["source"]["cash_settlement_postings"][1][
            "reference"
        ] = "REF S999999001 SEC"
        invalid_cases["wrong non-statement reference"] = wrong_reference
        scalar_postings = order()
        scalar_postings["source"]["cash_settlement_postings"] = "not-a-list"
        invalid_cases["scalar posting container"] = scalar_postings
        non_dict_posting = order()
        non_dict_posting["source"]["cash_settlement_postings"][1] = "not-a-posting"
        invalid_cases["non-dict posting"] = non_dict_posting
        reused_row = order()
        reused_row["source"]["cash_settlement_postings"][1]["row_number"] = 40
        invalid_cases["physical row reused"] = reused_row
        wrong_statement_row_alias = order()
        wrong_statement_row_alias["source"]["cash_settlement_postings"][1][
            "statement_pdf_source_row_number"
        ] = 99
        invalid_cases["statement row alias mismatch"] = wrong_statement_row_alias
        for source_file_kind in (
            "hsbc_usd_account_text",
            "hsbc_usd_savings_csv",
        ):
            sequence_order = (
                "chronological"
                if source_file_kind == "hsbc_usd_savings_csv"
                else ""
            )
            foreign_currency = structured_order(
                source_file_kind,
                ledger_sequence_order=sequence_order,
            )
            foreign_currency["currency"] = "HKD"
            for posting in foreign_currency["source"]["cash_settlement_postings"]:
                posting["currency"] = "HKD"
                posting["account_type"] = "HKD Savings"
            invalid_cases[f"{source_file_kind} with HKD Savings"] = foreign_currency

            current_account = structured_order(
                source_file_kind,
                ledger_sequence_order=sequence_order,
            )
            for posting in current_account["source"]["cash_settlement_postings"]:
                posting["account_type"] = "USD Current"
            invalid_cases[f"{source_file_kind} with USD Current"] = current_account
        multi_currency_current = structured_order(
            "hsbc_multi_currency_cash_account_text"
        )
        for posting in multi_currency_current["source"][
            "cash_settlement_postings"
        ]:
            posting["account_type"] = "USD Current"
        invalid_cases[
            "multi-currency cash text with USD Current"
        ] = multi_currency_current

        csv_missing_sequence = structured_order(
            "hsbc_usd_savings_csv",
            ledger_sequence_order="chronological",
        )
        csv_missing_sequence["source"]["cash_settlement_postings"][0].pop(
            "ledger_sequence"
        )
        invalid_cases["CSV posting missing ledger sequence"] = csv_missing_sequence
        invalid_cases["CSV posting missing chronological marker"] = structured_order(
            "hsbc_usd_savings_csv"
        )
        invalid_cases["CSV posting has invalid sequence marker"] = structured_order(
            "hsbc_usd_savings_csv",
            ledger_sequence_order="newest_first",
        )
        for source_file_kind in (
            "hsbc_usd_account_text",
            "hsbc_multi_currency_cash_account_text",
            "hsbc_statement_cash",
        ):
            csv_marker = structured_order(
                source_file_kind,
                ledger_sequence_order="chronological",
            )
            invalid_cases[f"{source_file_kind} with CSV marker"] = csv_marker

            mismatched_sequence = structured_order(source_file_kind)
            mismatched_sequence["source"]["cash_settlement_postings"][0][
                "ledger_sequence"
            ] = 39
            invalid_cases[
                f"{source_file_kind} with divergent row and ledger sequence"
            ] = mismatched_sequence
        for label, field_name, value in (
            ("fractional row", "row_number", 40.5),
            ("boolean row", "row_number", True),
            ("infinite row", "row_number", float("inf")),
            ("fractional sequence", "ledger_sequence", 40.5),
            ("boolean sequence", "ledger_sequence", True),
            ("infinite sequence", "ledger_sequence", float("inf")),
        ):
            invalid = order()
            invalid["source"]["cash_settlement_postings"][0][field_name] = value
            invalid_cases[label] = invalid

        for label, invalid in invalid_cases.items():
            with self.subTest(label=label):
                self.assertFalse(
                    _finalize_hsbc_order_settlement_balance(
                        invalid["source"],
                        order_record=invalid,
                    )
                )
                self.assertEqual(
                    invalid["source"]["cash_settlement_balance_after_raw"],
                    "OLD",
                )
                self.assertEqual(
                    invalid["source"]["cash_settlement_source_row_number"],
                    9,
                )

    def test_hsbc_statement_enrichment_rejects_malformed_posting_containers(
        self,
    ) -> None:
        def order(raw_postings: object) -> dict:
            return {
                "date": "2026-07-16",
                "type": "sell",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "broker": "hsbc",
                "net_amount_raw": "100.00",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": "S-100001",
                    "cash_settlement_date": "2026-07-17",
                    "cash_settlement_amount_raw": "100.00",
                    "cash_settlement_account_type": "USD Savings",
                    "cash_settlement_source_row_number": 40,
                    "cash_settlement_postings": raw_postings,
                },
            }

        statement_cash = {
            "date": "2026-07-17",
            "type": "deposit",
            "currency": "USD",
            "account": "ACCOUNT-A",
            "broker": "hsbc",
            "description": "STATEMENT PRINCIPAL",
            "net_amount_raw": "100.00",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_file_sha256": "b" * 64,
                "source_sequence_sha256": "b" * 64,
                "account_number": "ACCOUNT-A",
                "account_type": "USD Savings",
                "balance_after_raw": "1,100.00",
                "row_number": 50,
                "ledger_sequence": 50,
            },
        }
        valid_posting = {
            "date": "2026-07-17",
            "amount_raw": "100.00",
            "balance_after_raw": "1100.00",
            "reference": "REF S100001001 SEC",
            "row_number": 40,
            "ledger_sequence": 40,
            "source_file_kind": "hsbc_usd_account_text",
            "source_sequence_sha256": "a" * 64,
            "account_number": "ACCOUNT-A",
            "account_type": "USD Savings",
            "currency": "USD",
            "role": "principal",
        }
        malformed_cases = {
            "scalar": "not-a-list",
            "non-dict member": [valid_posting, "not-a-posting"],
            "fractional sequence": [{**valid_posting, "ledger_sequence": 40.5}],
            "boolean sequence": [{**valid_posting, "ledger_sequence": True}],
            "infinite sequence": [{**valid_posting, "ledger_sequence": float("inf")}],
        }
        for label, raw_postings in malformed_cases.items():
            with self.subTest(label=label):
                existing = order(raw_postings)
                enriched, retained, counts = (
                    _enrich_hsbc_orders_with_statement_cash_evidence(
                        [existing],
                        [deepcopy(statement_cash)],
                    )
                )
                self.assertEqual(enriched, [existing])
                self.assertEqual(len(retained), 1)
                self.assertEqual(counts, {"total": 0, "principal": 0, "fee": 0})

    def test_hsbc_fee_provenance_repair_requires_closed_fee_row_evidence(
        self,
    ) -> None:
        principal = {
            "date": "2026-07-17",
            "amount_raw": "100.00",
            "balance_after_raw": "1100.00",
            "reference": "REF S100001001 SEC",
            "row_number": 40,
            "ledger_sequence": 40,
            "source_file_kind": "hsbc_usd_account_text",
            "source_sequence_sha256": "a" * 64,
            "account_number": "ACCOUNT-A",
            "account_type": "USD Savings",
            "currency": "USD",
            "role": "principal",
        }
        legacy_fee = {
            "date": "2026-07-17",
            "amount_raw": "-0.01",
            "balance_after_raw": "1099.99",
            "reference": "REF S100001001 SEC",
            "row_number": 41,
            "ledger_sequence": 41,
            "source_file_kind": "hsbc_usd_account_text",
            "currency": "USD",
            "role": "fee",
        }
        cash_record = {
            "date": "2026-07-17",
            "type": "withdrawal",
            "currency": "USD",
            "account": "ACCOUNT-A",
            "description": "REF S100001001 SEC",
            "net_amount_raw": "-0.01",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "reference_id": "REF S100001001 SEC",
                "balance_after_raw": "1099.99",
                "row_number": 41,
                "ledger_sequence": 41,
                "source_sequence_sha256": "a" * 64,
                "account_number": "ACCOUNT-A",
                "account_type": "USD Savings",
            },
        }

        def order(fee_rows: object) -> dict:
            return {
                "date": "2026-07-16",
                "type": "sell",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "net_amount_raw": "100.00",
                "source": {
                    "statement_order_id": "S-100001",
                    "cash_settlement_date": "2026-07-17",
                    "cash_settlement_amount_raw": "100.00",
                    "cash_flow_fee_row_numbers": fee_rows,
                    "cash_settlement_postings": [
                        deepcopy(principal),
                        deepcopy(legacy_fee),
                    ],
                },
            }

        for label, fee_rows in {
            "missing": None,
            "scalar": 41,
            "partly invalid": [41, "not-a-row"],
            "boolean": [True],
            "fractional": [41.5],
        }.items():
            with self.subTest(label=label):
                candidate = order(fee_rows)
                repaired = _repair_hsbc_pasted_cash_settlement_posting_provenance(
                    [candidate],
                    [deepcopy(cash_record)],
                )
                self.assertEqual(repaired, 0)
                self.assertEqual(
                    candidate["source"]["cash_settlement_postings"][1],
                    legacy_fee,
                )

        valid = order([41])
        self.assertEqual(
            _repair_hsbc_pasted_cash_settlement_posting_provenance(
                [valid],
                [deepcopy(cash_record)],
            ),
            1,
        )
        repaired_fee = valid["source"]["cash_settlement_postings"][1]
        self.assertEqual(repaired_fee["source_sequence_sha256"], "a" * 64)
        self.assertEqual(repaired_fee["account_number"], "ACCOUNT-A")
        self.assertEqual(repaired_fee["account_type"], "USD Savings")

        for label, field_name, value in (
            ("cross account type", "account_type", "USD Current"),
            ("cross source digest", "source_sequence_sha256", "b" * 64),
        ):
            with self.subTest(label=label):
                mismatched_cash = deepcopy(cash_record)
                mismatched_cash["source"][field_name] = value
                rejected = order([41])
                before = deepcopy(rejected)
                self.assertEqual(
                    _repair_hsbc_pasted_cash_settlement_posting_provenance(
                        [rejected],
                        [mismatched_cash],
                    ),
                    0,
                )
                self.assertEqual(rejected, before)

    def test_hsbc_csv_settlement_evidence_skips_malformed_byte_counts(self) -> None:
        csv_bytes = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "21/09/2026,REF S100001001 SEC,100.00,USD,1100.00,USD",
            ]
        ).encode("utf-8")
        digest = hashlib.sha256(csv_bytes).hexdigest()

        def artifact(byte_count: object) -> dict:
            return {
                "broker": "hsbc",
                "bundle_role": "transaction_history",
                "source_kind": "hsbc_usd_savings_transaction_history_csv",
                "sha256": digest,
                "byte_count": byte_count,
                "content_base64": base64.b64encode(csv_bytes).decode("ascii"),
                "account": "ACCOUNT-A",
            }

        self.assertIn(
            "S-100001",
            _hsbc_usd_savings_csv_settlement_evidence([artifact(len(csv_bytes))]),
        )
        for malformed in ("abc", float("inf"), {"bad": 1}, True, None, -1):
            with self.subTest(byte_count=malformed):
                self.assertEqual(
                    _hsbc_usd_savings_csv_settlement_evidence(
                        [artifact(malformed)]
                    ),
                    {},
                )

        valid_artifact = artifact(len(csv_bytes))
        for label, field_name, value in (
            ("missing broker", "broker", ""),
            ("wrong broker", "broker", "ibkr"),
            ("missing bundle role", "bundle_role", ""),
            ("wrong bundle role", "bundle_role", "cash_account"),
            ("missing account", "account", ""),
        ):
            with self.subTest(label=label):
                malformed_artifact = deepcopy(valid_artifact)
                malformed_artifact[field_name] = value
                self.assertEqual(
                    _hsbc_usd_savings_csv_settlement_evidence(
                        [malformed_artifact]
                    ),
                    {},
                )

    def test_hsbc_official_csv_resolves_same_day_order_or_rejects_ambiguity(
        self,
    ) -> None:
        header = (
            "Date,Description,Billing amount,Billing currency,Balance,Balance currency"
        )
        chronological = "\n".join(
            [
                header,
                "21/09/2026,PRINCIPAL,100.00,USD,100.00,USD",
                "21/09/2026,FEE,-0.01,USD,99.99,USD",
            ]
        )
        newest_first = "\n".join(
            [
                header,
                "21/09/2026,FEE,-0.01,USD,99.99,USD",
                "21/09/2026,PRINCIPAL,100.00,USD,100.00,USD",
            ]
        )
        expected = ["FEE", "PRINCIPAL"]
        self.assertEqual(
            [
                row["description"]
                for row in _parse_hsbc_usd_savings_csv_rows(
                    chronological.encode("utf-8")
                )
            ],
            expected,
        )
        self.assertEqual(
            [
                row["description"]
                for row in _parse_hsbc_usd_savings_csv_rows(
                    newest_first.encode("utf-8")
                )
            ],
            expected,
        )

        ambiguous = "\n".join(
            [
                header,
                "21/09/2026,CREDIT,0.01,USD,100.00,USD",
                "21/09/2026,DEBIT,-0.01,USD,99.99,USD",
            ]
        )
        with self.assertRaisesRegex(ValueError, "same-day row order is ambiguous"):
            _parse_hsbc_usd_savings_csv_rows(ambiguous.encode("utf-8"))

        for invalid_value in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(invalid_value=invalid_value):
                invalid = "\n".join(
                    [
                        header,
                        f"21/09/2026,BAD,{invalid_value},USD,100.00,USD",
                    ]
                )
                with self.assertRaisesRegex(ValueError, "invalid Billing amount"):
                    _parse_hsbc_usd_savings_csv_rows(invalid.encode("utf-8"))

    def test_hsbc_cash_only_dividend_attribution_ignores_non_usd_candidates(
        self,
    ) -> None:
        account = "000-999999-999"

        def order(
            ticker: str, currency: str | None, order_id: str
        ) -> dict[str, object]:
            record: dict[str, object] = {
                "date": "2026-06-30",
                "datetime": "2026-06-30 20:00:00",
                "type": "buy",
                "ticker": ticker,
                "description": f"{ticker} synthetic order",
                "broker": "hsbc",
                "account": account,
                "quantity_raw": "10",
                "quantity_abs": "10",
                "price_raw": "1",
                "gross_amount_raw": "-10",
                "commission_raw": "0",
                "net_amount_raw": "-10",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": order_id,
                    "order_id": order_id,
                    "broker": "hsbc",
                    "account": account,
                },
            }
            if currency is not None:
                record["currency"] = currency
            return record

        existing = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": account,
            "summary": {},
            "position_snapshot": {},
            "broker_snapshots": {
                f"hsbc:{account}": {
                    "broker": "hsbc",
                    "account": account,
                    "position_snapshot": {
                        "QQQI": {"currency": "USD", "quantity": "10"},
                        "HKMISSING": {"currency": "HKD", "quantity": "10"},
                        "UNKNOWN": {"quantity": "10"},
                    },
                }
            },
            "transactions": [
                order("QQQI", "USD", "P-100001"),
                order("HKONLY", "HKD", "P-200001"),
                order("NOCURRENCY", None, "P-300001"),
            ],
        }
        cash_account_text = "\n".join(
            [
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                account,
                "Ledger balance:",
                "9.00",
                "USD",
                "Available balance:",
                "9.00 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "10 Jul 2026",
                "CORP EVT PAYMENT SEC",
                "9.00",
                "9.00",
                "Download",
            ]
        )
        incoming = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_account_text,
        )
        loaded_ticker_sets: list[set[str]] = []

        def load_actions(tickers: set[str]) -> dict[str, list[dict[str, str]]]:
            loaded_ticker_sets.append(set(tickers))
            return {
                ticker: [{"date": "2026-07-01", "dividend_per_share": "1"}]
                for ticker in tickers
            }

        merged = merge_investment_payloads(
            existing,
            incoming,
            hsbc_dividend_action_loader=load_actions,
        )

        self.assertEqual(loaded_ticker_sets, [{"QQQI"}])
        event = next(
            record
            for record in merged["transactions"]
            if record.get("description") == "CORP EVT PAYMENT SEC"
        )
        self.assertEqual(event["ticker"], "QQQI")
        self.assertEqual(
            event["source"]["dividend_attribution_status"],
            "matched_local_market_action",
        )
        self.assertEqual(
            merged["summary"]["incremental_import"][
                "attributed_hsbc_cash_only_dividend_count"
            ],
            1,
        )

    def test_hsbc_persisted_paste_evidence_repairs_legacy_postings_atomically(
        self,
    ) -> None:
        account = "000-999999-999"
        cash_text = "\n".join(
            [
                "HSBC",
                "USD Savings",
                "Account number:",
                account,
                "Ledger balance:",
                "1,099.99",
                "USD",
                "Available balance:",
                "1,099.99 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "REF S100001001 SEC",
                "0.00",
                "0.01",
                "1,099.99",
                "15 Jul 2026",
                "REF S100001001 SEC",
                "100.00",
                "0.00",
                "1,100.00",
                "Download",
            ]
        )
        parsed = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_text,
        )
        artifact = deepcopy(parsed["source_artifacts"][0])
        artifact_bytes = base64.b64decode(artifact.pop("content_base64"))
        artifact.pop("content_encoding")
        artifact["storage_key"] = artifact["sha256"]
        cash_rows = parsed["hsbc_cash_settlement_evidence"]

        def legacy_posting(amount: str, role: str) -> dict:
            cash_row = next(
                record for record in cash_rows if record["net_amount_raw"] == amount
            )
            source = cash_row["source"]
            return {
                "date": cash_row["date"],
                "amount_raw": amount,
                "balance_after_raw": source["balance_after_raw"],
                "reference": cash_row["description"],
                "row_number": source["row_number"],
                "ledger_sequence": source["ledger_sequence"],
                "source_file_kind": source["file_kind"],
                "currency": "USD",
                "role": role,
            }

        order = {
            "date": "2026-07-14",
            "type": "sell",
            "broker": "hsbc",
            "account": account,
            "currency": "USD",
            "ticker": "DRAM",
            "quantity_raw": "-1",
            "quantity_abs": "1",
            "price_raw": "100.010",
            "gross_amount_raw": "100.010",
            "commission_raw": "-0.01",
            "net_amount_raw": "100.00",
            "normalized": {
                "position_quantity": "-1",
                "unit_price": "100.010",
                "gross_amount": "100.010",
                "commission": "-0.01",
                "commission_display": "0.01",
                "net_amount": "100.00",
                "accounting_adjustment_amount": "100.00",
            },
            "source": {
                "file_kind": "hsbc_order_status_text",
                "statement_order_id": "S-100001",
                "order_id": "S-100001",
                "cash_settlement_date": "2026-07-15",
                "cash_settlement_amount_raw": "100.00",
                "cash_settlement_reference": "REF S100001001 SEC",
                "cash_settlement_balance_after_raw": "1,099.99",
                "cash_settlement_source_row_number": 2,
                "cash_flow_fee_amount_raw": "0.01",
                "cash_flow_fee_row_numbers": [2],
                "cash_settlement_postings": [
                    legacy_posting("100.00", "principal"),
                    legacy_posting("-0.01", "fee"),
                ],
            },
        }
        economic_fields = (
            "quantity_raw",
            "price_raw",
            "gross_amount_raw",
            "commission_raw",
            "net_amount_raw",
            "normalized",
        )
        existing = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": account,
            "summary": {},
            "position_snapshot": {},
            "transactions": [order],
            "source_artifacts": [artifact],
        }
        incoming = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": account,
            "summary": {},
            "position_snapshot": {},
            "transactions": [],
            "source_artifacts": [],
        }

        with TemporaryDirectory() as temp_dir:
            evidence_dir = Path(temp_dir)
            with patch(
                "app.services.investment.importing.brokers.hsbc.reconciliation.investment_evidence_dir_for",
                return_value=evidence_dir,
            ):
                control = merge_investment_payloads(existing, incoming)
                (evidence_dir / f"{artifact['sha256']}.bin").write_bytes(
                    artifact_bytes
                )
                repaired = merge_investment_payloads(existing, incoming)
                repaired_again = merge_investment_payloads(repaired, incoming)

        repaired_order = repaired["transactions"][0]
        repaired_postings = repaired_order["source"]["cash_settlement_postings"]
        self.assertEqual(
            {
                field_name: repaired_order[field_name]
                for field_name in economic_fields
            },
            {
                field_name: control["transactions"][0][field_name]
                for field_name in economic_fields
            },
        )
        self.assertTrue(
            _hsbc_settlement_postings_have_valid_sequence_order(
                repaired_postings,
                order_source=repaired_order["source"],
                order_record=repaired_order,
                order_account=account,
                order_currency="USD",
            )
        )
        self.assertTrue(
            all(
                posting["source_sequence_sha256"] == artifact["sha256"]
                and posting["source_file_sha256"] == artifact["sha256"]
                and posting["account_number"] == account
                and posting["account_type"] == "USD Savings"
                for posting in repaired_postings
            )
        )
        self.assertEqual(
            repaired_order["source"]["cash_settlement_authoritative_source"],
            "hsbc_cash_account_pasted_text",
        )
        self.assertEqual(
            repaired_again["transactions"][0]["source"]["cash_settlement_postings"],
            repaired_postings,
        )

    def test_hsbc_persisted_paste_evidence_fails_closed(self) -> None:
        account = "000-999999-999"

        def cash_text(balance: str = "1099.99") -> str:
            final_balance = Decimal(balance)
            principal_balance = final_balance + Decimal("0.01")
            return "\n".join(
                [
                    "HSBC",
                    "USD Savings",
                    "Account number:",
                    account,
                    "Ledger balance:",
                    f"{final_balance:.2f}",
                    "USD",
                    "Available balance:",
                    f"{final_balance:.2f} USD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "15 Jul 2026",
                    "REF S100001001 SEC",
                    "0.00",
                    "0.01",
                    f"{final_balance:.2f}",
                    "15 Jul 2026",
                    "REF S100001001 SEC",
                    "100.00",
                    "0.00",
                    f"{principal_balance:.2f}",
                    "Download",
                ]
            )

        def externalized_artifact(raw_text: str) -> tuple[dict, bytes]:
            payload = build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=raw_text,
            )
            artifact = deepcopy(payload["source_artifacts"][0])
            artifact_bytes = base64.b64decode(artifact.pop("content_base64"))
            artifact.pop("content_encoding")
            artifact["storage_key"] = artifact["sha256"]
            return artifact, artifact_bytes

        def order() -> dict:
            return {
                "date": "2026-07-14",
                "type": "sell",
                "broker": "hsbc",
                "account": account,
                "currency": "USD",
                "net_amount_raw": "100.00",
                "normalized": {"net_amount": "100.00"},
                "source": {
                    "statement_order_id": "S-100001",
                    "order_id": "S-100001",
                },
            }

        valid_artifact, valid_bytes = externalized_artifact(cash_text())
        invalid_cases: dict[str, tuple[dict, bytes | None]] = {}
        missing_file = deepcopy(valid_artifact)
        invalid_cases["missing file"] = (missing_file, None)
        wrong_size = deepcopy(valid_artifact)
        wrong_size["byte_count"] += 1
        invalid_cases["wrong byte count"] = (wrong_size, valid_bytes)
        invalid_cases["wrong SHA-256"] = (
            deepcopy(valid_artifact),
            b"X" + valid_bytes[1:],
        )
        wrong_storage_key = deepcopy(valid_artifact)
        wrong_storage_key["storage_key"] = "f" * 64
        invalid_cases["wrong storage key"] = (wrong_storage_key, valid_bytes)
        wrong_kind = deepcopy(valid_artifact)
        wrong_kind["source_kind"] = "hsbc_portfolio_pasted_text"
        invalid_cases["wrong source kind"] = (wrong_kind, valid_bytes)
        wrong_role = deepcopy(valid_artifact)
        wrong_role["bundle_role"] = "portfolio"
        invalid_cases["wrong bundle role"] = (wrong_role, valid_bytes)
        wrong_account = deepcopy(valid_artifact)
        wrong_account["account"] = "000-999999-998"
        invalid_cases["wrong account"] = (wrong_account, valid_bytes)
        malformed_bytes = b"not an HSBC cash page"
        malformed_digest = hashlib.sha256(malformed_bytes).hexdigest()
        malformed_artifact = {
            **deepcopy(valid_artifact),
            "sha256": malformed_digest,
            "storage_key": malformed_digest,
            "byte_count": len(malformed_bytes),
        }
        invalid_cases["unparseable bytes"] = (
            malformed_artifact,
            malformed_bytes,
        )

        for label, (artifact, artifact_bytes) in invalid_cases.items():
            with self.subTest(label=label), TemporaryDirectory() as temp_dir:
                evidence_dir = Path(temp_dir)
                if artifact_bytes is not None:
                    (evidence_dir / f"{artifact['storage_key']}.bin").write_bytes(
                        artifact_bytes
                    )
                candidate_order = order()
                before = deepcopy(candidate_order)
                with patch(
                    "app.services.investment.importing.brokers.hsbc.reconciliation.investment_evidence_dir_for",
                    return_value=evidence_dir,
                ):
                    updated = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
                        [candidate_order],
                        [artifact],
                    )
                self.assertEqual(updated, 0)
                self.assertEqual(candidate_order, before)

        conflicting_artifact, conflicting_bytes = externalized_artifact(
            cash_text("1199.99")
        )
        with TemporaryDirectory() as temp_dir:
            evidence_dir = Path(temp_dir)
            for artifact, artifact_bytes in (
                (valid_artifact, valid_bytes),
                (conflicting_artifact, conflicting_bytes),
            ):
                (evidence_dir / f"{artifact['storage_key']}.bin").write_bytes(
                    artifact_bytes
                )
            candidate_order = order()
            before = deepcopy(candidate_order)
            with patch(
                "app.services.investment.importing.brokers.hsbc.reconciliation.investment_evidence_dir_for",
                return_value=evidence_dir,
            ):
                updated = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
                    [candidate_order],
                    [valid_artifact, conflicting_artifact],
                )
        self.assertEqual(updated, 0)
        self.assertEqual(candidate_order, before)

        principal_only_text = "\n".join(
            [
                "HSBC",
                "USD Savings",
                "Account number:",
                account,
                "Ledger balance:",
                "1100.00",
                "USD",
                "Available balance:",
                "1100.00 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "REF S100001001 SEC",
                "100.00",
                "0.00",
                "1100.00",
                "Download",
            ]
        )
        principal_only_artifact, principal_only_bytes = externalized_artifact(
            principal_only_text
        )
        incomplete_order = order()
        incomplete_order["commission_raw"] = "-0.01"
        incomplete_order["normalized"]["commission"] = "-0.01"
        incomplete_order["source"].update(
            {
                "cash_settlement_date": "2026-07-15",
                "cash_settlement_amount_raw": "100.00",
                "cash_flow_fee_amount_raw": "0.01",
                "cash_flow_fee_row_numbers": [2],
                "cash_settlement_postings": [
                    {
                        "date": "2026-07-15",
                        "amount_raw": "100.00",
                        "balance_after_raw": "1100.00",
                        "reference": "REF S100001001 SEC",
                        "row_number": 1,
                        "ledger_sequence": 1,
                        "source_file_kind": "hsbc_usd_account_text",
                        "currency": "USD",
                        "role": "principal",
                    },
                    {
                        "date": "2026-07-15",
                        "amount_raw": "-0.01",
                        "balance_after_raw": "1099.99",
                        "reference": "REF S100001001 SEC",
                        "row_number": 2,
                        "ledger_sequence": 2,
                        "source_file_kind": "hsbc_usd_account_text",
                        "currency": "USD",
                        "role": "fee",
                    },
                ],
            }
        )
        incomplete_before = deepcopy(incomplete_order)
        with TemporaryDirectory() as temp_dir:
            evidence_dir = Path(temp_dir)
            (
                evidence_dir / f"{principal_only_artifact['storage_key']}.bin"
            ).write_bytes(principal_only_bytes)
            with patch(
                "app.services.investment.importing.brokers.hsbc.reconciliation.investment_evidence_dir_for",
                return_value=evidence_dir,
            ):
                updated = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
                    [incomplete_order],
                    [principal_only_artifact],
                )
        self.assertEqual(updated, 0)
        self.assertEqual(incomplete_order, incomplete_before)

        mismatched_fee_order = order()
        mismatched_fee_order["commission_raw"] = "-0.02"
        mismatched_fee_order["normalized"]["commission"] = "-0.02"
        mismatched_fee_order["source"]["cash_flow_fee_amount_raw"] = "0.02"
        mismatched_fee_before = deepcopy(mismatched_fee_order)
        with TemporaryDirectory() as temp_dir:
            evidence_dir = Path(temp_dir)
            (evidence_dir / f"{valid_artifact['storage_key']}.bin").write_bytes(
                valid_bytes
            )
            with patch(
                "app.services.investment.importing.brokers.hsbc.reconciliation.investment_evidence_dir_for",
                return_value=evidence_dir,
            ):
                updated = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
                    [mismatched_fee_order],
                    [valid_artifact],
                )
        self.assertEqual(updated, 0)
        self.assertEqual(mismatched_fee_order, mismatched_fee_before)

    def test_hsbc_full_cash_replay_accepts_fee_on_either_side_of_principal(
        self,
    ) -> None:
        account = "000-999999-999"
        principal_amounts = [Decimal("1000.00")] * 28 + [Decimal("7396.53")]
        fee_amounts = [Decimal("-0.01")] * 27 + [
            Decimal("-0.02"),
            Decimal("-0.02"),
        ]
        fee_before_indexes = {3, 8, 13, 18}
        balance = Decimal("10000.00")
        chronological_rows: list[tuple[date, str, Decimal, Decimal]] = []
        orders = []
        first_settlement_date = date(2026, 6, 2)
        for index, (principal, fee) in enumerate(
            zip(principal_amounts, fee_amounts, strict=True)
        ):
            settlement_date = first_settlement_date + timedelta(days=index)
            reference_number = 100001 + index
            description = f"REF S{reference_number}001 SEC"
            ordered_amounts = (
                (fee, principal)
                if index in fee_before_indexes
                else (principal, fee)
            )
            for amount in ordered_amounts:
                balance += amount
                chronological_rows.append(
                    (settlement_date, description, amount, balance)
                )
            principal_text = f"{principal:.2f}"
            orders.append(
                {
                    "date": (settlement_date - timedelta(days=1)).isoformat(),
                    "type": "sell",
                    "broker": "hsbc",
                    "account": account,
                    "currency": "USD",
                    "net_amount_raw": principal_text,
                    "commission_raw": "0",
                    "normalized": {
                        "net_amount": principal_text,
                        "commission": "0",
                    },
                    "source": {
                        "statement_order_id": f"S-{reference_number}",
                        "order_id": f"S-{reference_number}",
                    },
                }
            )
        csv_lines = [
            "Date,Description,Billing amount,Billing currency,Balance,Balance currency"
        ]
        csv_lines.extend(
            ",".join(
                [
                    settlement_date.strftime("%d/%m/%Y"),
                    description,
                    f"{amount:.2f}",
                    "USD",
                    f"{row_balance:.2f}",
                    "USD",
                ]
            )
            for settlement_date, description, amount, row_balance in reversed(
                chronological_rows
            )
        )
        csv_bytes = "\n".join(csv_lines).encode("utf-8")
        digest = hashlib.sha256(csv_bytes).hexdigest()
        artifact = {
            "broker": "hsbc",
            "bundle_role": "transaction_history",
            "source_kind": "hsbc_usd_savings_transaction_history_csv",
            "sha256": digest,
            "byte_count": len(csv_bytes),
            "content_encoding": "base64",
            "content_base64": base64.b64encode(csv_bytes).decode("ascii"),
            "account": account,
            "statement_period_end": chronological_rows[-1][0].isoformat(),
        }

        updated = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
            orders,
            [artifact],
        )

        self.assertEqual(updated, 29)
        self.assertTrue(
            all(
                _hsbc_settlement_postings_have_valid_sequence_order(
                    order["source"]["cash_settlement_postings"],
                    order_source=order["source"],
                    order_record=order,
                    order_account=account,
                    order_currency="USD",
                )
                for order in orders
            )
        )
        self.assertEqual(
            sum(
                order["source"]["cash_settlement_amount_raw"] != ""
                for order in orders
            ),
            29,
        )
        self.assertEqual(
            sum(Decimal(order["source"]["cash_settlement_amount_raw"]) for order in orders),
            Decimal("35396.53"),
        )
        self.assertEqual(
            sum(Decimal(order["commission_raw"]) for order in orders),
            Decimal("-0.31"),
        )
        self.assertEqual(
            sum(
                Decimal(order["source"]["cash_settlement_amount_raw"])
                + Decimal(order["commission_raw"])
                for order in orders
            ),
            Decimal("35396.22"),
        )
        self.assertEqual(
            sum(
                next(
                    posting["ledger_sequence"]
                    for posting in order["source"]["cash_settlement_postings"]
                    if posting["role"] == "fee"
                )
                < next(
                    posting["ledger_sequence"]
                    for posting in order["source"]["cash_settlement_postings"]
                    if posting["role"] == "principal"
                )
                for order in orders
            ),
            4,
        )
        self.assertTrue(
            all(
                order["source"]["cash_settlement_balance_after_raw"]
                == order["source"]["cash_settlement_postings"][-1][
                    "balance_after_raw"
                ]
                for order in orders
            )
        )
