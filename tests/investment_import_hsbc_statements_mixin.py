"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    Decimal,
    Path,
    SimpleNamespace,
    TemporaryDirectory,
    _extract_futuhk_pdf_text,
    _extract_statement_pdf_text,
    build_investment_payload_from_hsbc_pasted_text,
    build_investment_payload_from_hsbc_statement_bundle,
    build_investment_payload_from_hsbc_statement_pairs,
    build_investment_payload_from_hsbc_statement_pdfs,
    build_investment_payload_from_hsbc_usd_savings_csv,
    deepcopy,
    hashlib,
    materialize_investment_source_artifacts,
    merge_investment_payloads,
    patch,
    verify_investment_source_artifacts,
)


class HsbcStatementImportTestsMixin:
    def test_pdf_text_extraction_does_not_expose_pdftotext_diagnostics(self) -> None:
        internal_detail = "/Users/example/private.pdf token=secret-value"
        failed_process = SimpleNamespace(
            returncode=1,
            stderr=internal_detail,
            stdout="",
        )

        with patch(
            "app.services.investment_import.subprocess.run",
            return_value=failed_process,
        ):
            with self.assertRaises(ValueError) as futu_error:
                _extract_futuhk_pdf_text(b"not-a-real-pdf")
            with self.assertRaises(ValueError) as statement_error:
                _extract_statement_pdf_text(b"not-a-real-pdf", "Tiger Trade")

        for error in (futu_error.exception, statement_error.exception):
            message = str(error)
            self.assertIn("Could not extract text", message)
            self.assertNotIn("/Users/example", message)
            self.assertNotIn("secret-value", message)

    def test_hsbc_statement_pair_import_reconciles_trade_dividend_cash_and_holdings(
        self,
    ) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

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

        self.assertEqual(payload["ending_cash"], "921.29")
        self.assertEqual(payload["position_snapshot"]["SGOV"]["quantity"], "5")
        self.assertEqual(
            payload["position_snapshot"]["SGOV"]["statement_opening_quantity"],
            "4",
        )
        self.assertEqual(
            payload["starting_cash_by_currency"],
            {"USD": "0.00"},
        )
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"USD": "921.29"},
        )
        self.assertEqual(payload["summary"]["transaction_date_min"], "2026-06-16")
        self.assertEqual(payload["summary"]["transaction_date_max"], "2026-07-10")
        self.assertEqual(payload["summary"]["statement_pair_count"], 1)
        dividend = next(
            record for record in payload["transactions"] if record["type"] == "dividend"
        )
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(dividend["net_amount_raw"], "21.29")
        self.assertEqual(
            dividend["source"]["corporate_action_reference"], "CORTMP890672010"
        )
        trade = next(
            record for record in payload["transactions"] if record["type"] == "buy"
        )
        self.assertEqual(trade["source"]["statement_order_id"], "P-900")
        self.assertEqual(trade["source"]["cash_settlement_date"], "2026-06-17")

    def test_hsbc_statement_pair_retains_sale_charge_across_page_header(self) -> None:
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
        self.assertEqual(sale["source"]["statement_order_id"], "S-900002")
        self.assertEqual(sale["commission_raw"], "-0.01")
        self.assertFalse(
            any(
                record["type"] == "withdrawal" and record["net_amount_raw"] == "-0.01"
                for record in payload["transactions"]
            )
        )

    def test_hsbc_full_monthly_statement_import_preserves_hkd_and_cnh(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text()
        statement_bytes = b"full-monthly"

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_bundle(
                [
                    (statement_bytes, "HSBC-2026-07.pdf"),
                ]
            )

        self.assertEqual(payload["summary"]["statement_periods"], ["2026-07"])
        self.assertEqual(
            payload["starting_cash_by_currency"],
            {"USD": "10.00", "HKD": "40.00", "CNH": "10.00"},
        )
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "46.10", "USD": "1010.00", "CNH": "12.00"},
        )
        self.assertEqual(payload["ending_cash"], "1010.00")
        self.assertEqual(
            payload["summary"]["cash_snapshot_source"], "hsbc_statement_cash_balances"
        )
        self.assertEqual(payload["summary"]["transaction_date_min"], "2026-06-15")
        self.assertEqual(payload["summary"]["transaction_date_max"], "2026-06-15")
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
        hkd_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "HKD"
        )
        self.assertEqual(hkd_record["date"], "2026-06-15")
        self.assertEqual(hkd_record["datetime"], "2026-06-15 20:00:00")
        self.assertEqual(payload["datetime_policy"]["timezone"], "America/New_York")
        self.assertEqual(
            payload["datetime_policy"]["source_date_timezone"], "Asia/Hong_Kong"
        )
        self.assertFalse(payload["datetime_policy"]["source_has_intraday_timestamp"])
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")
        self.assertEqual(cnh_record["source"]["file_kind"], "hsbc_statement_cash")
        self.assertEqual(
            cnh_record["source"]["statement_currency_to_base_rate_raw"],
            "7.189449541284403669724770642",
        )
        statement_sha256 = hashlib.sha256(statement_bytes).hexdigest()
        self.assertEqual(len(payload["source_artifacts"]), 1)
        self.assertEqual(payload["source_artifacts"][0]["sha256"], statement_sha256)
        self.assertEqual(
            payload["source_artifacts"][0]["source_kind"],
            "hsbc_composite_statement_pdf",
        )
        self.assertTrue(
            all(
                transaction["source"]["source_file_sha256"] == statement_sha256
                for transaction in payload["transactions"]
            )
        )
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(
                payload,
                ledger_path,
            )
            verify_investment_source_artifacts(materialized, ledger_path)
            self.assertEqual(
                materialized["source_artifacts"][0]["storage_key"],
                statement_sha256,
            )

    def test_hsbc_statement_balance_continuity_rejects_unreconciled_rows(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text().replace(
            "1,010.00",
            "1,011.00",
        )

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            with self.assertRaisesRegex(ValueError, "balance continuity"):
                build_investment_payload_from_hsbc_statement_pdfs(
                    [
                        (b"unreconciled", "HSBC-2026-07.pdf"),
                    ]
                )

    def test_hsbc_statement_preserves_explicit_zero_currency_balances(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text()
        for raw_value in (
            "1,010.00",
            "1,000.00",
            "46.10",
            "40.00",
            "2.00",
            "12.00",
            "10.00",
            "6.10",
        ):
            statement_text = statement_text.replace(raw_value, "0.00")

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pdfs(
                [
                    (b"zero-balance", "HSBC-2026-07.pdf"),
                ]
            )

        expected_balances = {"HKD": "0.00", "USD": "0.00", "CNH": "0.00"}
        self.assertEqual(payload["ending_cash_by_currency"], expected_balances)
        self.assertEqual(
            payload["broker_summaries"]["hsbc"]["ending_cash_by_currency"],
            expected_balances,
        )

    def test_hsbc_statement_metadata_survives_incremental_merge(self) -> None:
        base_text = self._synthetic_hsbc_full_monthly_statement_text()
        june_text = base_text.replace("10 July 2026", "30 June 2026")
        july_text = (
            base_text.replace("10 July 2026", "31 July 2026")
            .replace("01 Jun", "01 Jul")
            .replace("15 Jun", "15 Jul")
        )
        june_bytes = b"june-statement"
        july_bytes = b"july-statement"

        june = build_investment_payload_from_hsbc_statement_pdfs(
            [(june_bytes, "HSBC-2026-06.pdf")],
            _extracted_text_by_payload_id={id(june_bytes): june_text},
        )
        july = build_investment_payload_from_hsbc_statement_pdfs(
            [(july_bytes, "HSBC-2026-07.pdf")],
            _extracted_text_by_payload_id={id(july_bytes): july_text},
        )

        merged = merge_investment_payloads(june, july)

        self.assertEqual(merged["summary"]["statement_count"], 2)
        self.assertEqual(
            merged["summary"]["statement_periods"],
            ["2026-06", "2026-07"],
        )
        self.assertEqual(merged["summary"]["statement_date_min"], "2026-06-30")
        self.assertEqual(merged["summary"]["statement_date_max"], "2026-07-31")
        self.assertEqual(merged["summary"]["transaction_date_min"], "2026-06-15")
        self.assertEqual(merged["summary"]["transaction_date_max"], "2026-07-15")
        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["statement_count"], 2)
        self.assertEqual(hsbc_summary["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(hsbc_summary["transaction_date_min"], "2026-06-15")
        self.assertEqual(hsbc_summary["transaction_date_max"], "2026-07-15")

    def test_hsbc_statement_deposit_boundary_preserves_interest_and_correction(
        self,
    ) -> None:
        statement_text = "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 3 of 4",
                "10 July 2026",
                "HSBC One Account Transaction History",
                "Foreign Currency Savings",
                "CCY   Date        Transaction Details                                     Deposit       Withdrawal     Balance",
                "CNY 10 Jun       B/F BALANCE                                                                           0.00",
                "      27 Jun     CREDIT INTEREST                                                 0.01                      0.01",
                "      3 Jul      WITHDRAWAL",
                "                 HC000001 03JUL                                                        0.01                      0.00",
                "                 WITHDRAWAL CORRECTION",
                "                 HC000002 03JUL                                          0.01                      0.01",
                "Total Relationship Balance",
            ]
        )

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pdfs(
                [
                    (b"cny-boundary", "eStatementFile_432244.pdf"),
                ]
            )

        cnh_records = [
            record for record in payload["transactions"] if record["currency"] == "CNH"
        ]
        self.assertEqual(
            [
                (record["description"], record["type"], record["net_amount_raw"])
                for record in cnh_records
            ],
            [
                ("CREDIT INTEREST", "credit_interest", "0.01"),
                ("WITHDRAWAL HC000001 03JUL", "withdrawal", "-0.01"),
                ("WITHDRAWAL CORRECTION HC000002 03JUL", "deposit", "0.01"),
            ],
        )
        self.assertEqual(payload["ending_cash_by_currency"], {"CNH": "0.01"})

    def test_hsbc_usd_savings_csv_calibration_validates_history_and_latest_balance(
        self,
    ) -> None:
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "02/01/2026,REF P900020001 SEC,-10.00,USD,90.00,USD",
                "01/01/2026,5475364 R45475,100.00,USD,100.00,USD",
            ]
        )

        payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        self.assertEqual(payload["ending_cash"], "90.00")
        self.assertEqual(payload["starting_cash"], "0.00")
        self.assertEqual(payload["summary"]["statement_date_min"], "2026-01-01")
        self.assertEqual(payload["summary"]["statement_date_max"], "2026-01-02")
        self.assertEqual(
            payload["summary"]["hsbc_ending_cash_components"], {"USD:SAVINGS": "90.00"}
        )
        self.assertEqual(len(payload["transactions"]), 1)
        self.assertEqual(payload["generator"]["cash_row_count"], 2)
        self.assertEqual(
            payload["source_artifacts"][0]["source_kind"],
            "hsbc_usd_savings_transaction_history_csv",
        )

    def test_hsbc_usd_savings_csv_replays_same_day_rows_in_bank_chronology(
        self,
    ) -> None:
        csv_text = "\n".join(
            [
                "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
                "24/06/2026,HK432801BUG62IGW,2948.41,USD,17229.65,USD",
                "24/06/2026,HK213745JOG1BW02 137,2200.88,USD,14281.24,USD",
                "23/06/2026,HK235349FAFX1BPF 123,100.00,USD,12080.36,USD",
            ]
        )

        payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        self.assertEqual(
            [record["description"] for record in payload["transactions"]],
            [
                "HK235349FAFX1BPF 123",
                "HK213745JOG1BW02 137",
                "HK432801BUG62IGW",
            ],
        )

    def test_hsbc_mixed_broker_summary_uses_each_cash_subaccount_not_last_global_row(
        self,
    ) -> None:
        def cash_record(
            *,
            date_text: str,
            currency: str,
            account_type: str,
            amount: str,
            balance: str,
        ) -> dict[str, object]:
            return {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": "deposit" if Decimal(amount) > 0 else "withdrawal",
                "ticker": "",
                "currency": currency,
                "description": f"{currency} cash",
                "gross_amount_raw": amount,
                "commission_raw": "0",
                "net_amount_raw": amount,
                "source": {
                    "file_kind": "hsbc_multi_currency_cash_account_text",
                    "account": "000-999999-999",
                    "account_number": "000-999999-999",
                    "account_type": account_type,
                    "balance_after_raw": balance,
                    "cash_balance_scope": "account",
                    "row_number": 1,
                },
                "broker": "hsbc",
                "account": "000-999999-999",
            }

        hsbc_payload = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                cash_record(
                    date_text="2026-08-01",
                    currency="USD",
                    account_type="USD Savings",
                    amount="90.00",
                    balance="90.00",
                ),
                cash_record(
                    date_text="2026-08-02",
                    currency="HKD",
                    account_type="HKD Savings",
                    amount="46.10",
                    balance="46.10",
                ),
                cash_record(
                    date_text="2026-08-03",
                    currency="HKD",
                    account_type="HKD Current",
                    amount="-46.10",
                    balance="0.00",
                ),
            ],
        }
        other_broker_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "transactions": [],
        }

        merged = merge_investment_payloads(other_broker_payload, hsbc_payload)

        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["ending_cash"], "90.00")
        self.assertEqual(
            hsbc_summary["ending_cash_by_currency"],
            {"USD": "90.00", "HKD": "46.10"},
        )
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"],
            {"USD:SAVINGS": "90.00", "HKD:SAVINGS": "46.10", "HKD:CURRENT": "0.00"},
        )

    def test_hsbc_non_usd_clip_preserves_newer_usd_calibration_in_mixed_store(
        self,
    ) -> None:
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "multiple",
            "account": "multiple",
            "summary": {},
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "ending_cash": "20444.97",
                    "ending_cash_raw": "20444.97",
                    "calibration_source": "hsbc_usd_savings_transaction_history_csv",
                    "hsbc_ending_cash_components": {
                        "USD:SAVINGS": "20444.97",
                    },
                    "hsbc_cash_component_post_dates": {
                        "USD:SAVINGS": "2026-08-04",
                    },
                },
            },
            "transactions": [
                {
                    "date": "2026-08-04",
                    "type": "deposit",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "IBKR cash",
                    "net_amount_raw": "1.00",
                },
            ],
        }
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        merged = merge_investment_payloads(existing_payload, cash_only_payload)

        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(
            hsbc_summary["ending_cash_by_currency"],
            {"USD": "20444.97", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(hsbc_summary["ending_cash"], "20444.97")
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"]["USD:SAVINGS"],
            "20444.97",
        )
        self.assertNotIn("ending_cash_by_currency", merged["summary"])

    def test_hsbc_older_usd_history_cannot_replace_newer_app_cash_calibration(
        self,
    ) -> None:
        def cash_payload(
            *,
            date_text: str,
            balance: str,
            source: str,
        ) -> dict[str, object]:
            transaction = {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": "deposit",
                "ticker": "",
                "currency": "USD",
                "description": "USD cash calibration",
                "gross_amount_raw": "1.00",
                "commission_raw": "0",
                "net_amount_raw": "1.00",
                "source": {
                    "file_kind": "hsbc_usd_savings_csv",
                    "account_type": "USD Savings",
                    "account_number": "000-999999-999",
                    "balance_after_raw": balance,
                    "row_number": 1,
                    "ledger_sequence": 1,
                },
                "broker": "hsbc",
                "account": "000-999999-999",
            }
            components = {"USD:SAVINGS": balance}
            dates = {"USD:SAVINGS": date_text}
            return {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {
                    "cash_snapshot_source": source,
                    "hsbc_ending_cash_components": components,
                    "hsbc_cash_component_post_dates": dates,
                },
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": balance,
                        "ending_cash_raw": balance,
                        "ending_cash_base_currency": balance,
                        "ending_cash_by_currency": {"USD": balance},
                        "calibration_source": source,
                        "cash_snapshot_source": source,
                        "hsbc_ending_cash_components": components,
                        "hsbc_cash_component_post_dates": dates,
                    },
                },
                "transactions": [transaction],
            }

        existing = cash_payload(
            date_text="2026-08-04",
            balance="20444.97",
            source="hsbc_app_manual_calibration",
        )
        older_csv = cash_payload(
            date_text="2026-07-10",
            balance="27357.71",
            source="hsbc_usd_savings_transaction_history_csv",
        )

        merged = merge_investment_payloads(existing, older_csv)
        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["ending_cash"], "20444.97")
        self.assertEqual(hsbc_summary["ending_cash_base_currency"], "20444.97")
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"]["USD:SAVINGS"], "20444.97"
        )
        self.assertEqual(
            hsbc_summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"], "2026-08-04"
        )
        self.assertEqual(
            hsbc_summary["calibration_source"], "hsbc_app_manual_calibration"
        )
        self.assertEqual(
            hsbc_summary["cash_snapshot_source"], "hsbc_app_manual_calibration"
        )

        newer_statement = cash_payload(
            date_text="2026-08-31",
            balance="19000.00",
            source="hsbc_statement_cash_balances",
        )
        replaced = merge_investment_payloads(existing, newer_statement)
        replaced_summary = replaced["broker_summaries"]["hsbc"]
        self.assertEqual(replaced_summary["ending_cash"], "19000.00")
        self.assertEqual(
            replaced_summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"],
            "2026-08-31",
        )
        self.assertEqual(
            replaced_summary["calibration_source"],
            "hsbc_statement_cash_balances",
        )

    def test_hsbc_full_monthly_statement_marks_explicit_forex_components_without_inferring_pairs(
        self,
    ) -> None:
        def statement_header() -> str:
            return f"{'Date':<12}{'Transaction Details':<76}{'Deposit':<12}{'Withdrawal':<12}Balance"

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
                f"{deposit:>12}{withdrawal:>12}{balance:>12}"
            )

        statement_text = "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 1 of 2",
                "10 July 2026",
                "Portfolio Summary",
                "USD 7.8365 1,010.00",
                "HSBC One Account Transaction History",
                "HKD Current",
                statement_header(),
                statement_row("HKD 01 Jun", "B/F BALANCE", balance="10,000.00"),
                statement_row(
                    "15 Jun",
                    "N000001 - FOREIGN EXCHANGE DEBIT",
                    withdrawal="7,800.00",
                    balance="2,200.00",
                ),
                "USD Savings",
                statement_header(),
                statement_row("USD 01 Jun", "B/F BALANCE", balance="0.00"),
                statement_row(
                    "15 Jun",
                    "N000001 - FOREIGN EXCHANGE CREDIT",
                    deposit="1,000.00",
                    balance="1,000.00",
                ),
                "Total Relationship Balance",
            ]
        )

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_bundle(
                [
                    (b"full-monthly-forex", "HSBC-2026-07.pdf"),
                ]
            )

        forex_records = [
            transaction
            for transaction in payload["transactions"]
            if transaction["type"] == "forex_trade_component"
        ]
        self.assertEqual(len(forex_records), 2)
        self.assertEqual(
            {transaction["currency"] for transaction in forex_records}, {"HKD", "USD"}
        )
        self.assertEqual(
            {
                transaction["source"].get("forex_pair_reference_id")
                for transaction in forex_records
            },
            {"N000001"},
        )
        self.assertEqual(
            {
                transaction["source"].get("forex_pair_component")
                for transaction in forex_records
            },
            {"sold", "acquired"},
        )

    def test_hsbc_summary_only_statement_does_not_reset_latest_cash(self) -> None:
        summary_only_text = "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 1 of 1",
                "10 August 2026",
                "Total Relationship Balance",
                "Important Notice",
            ]
        )
        full_statement_text = self._synthetic_hsbc_full_monthly_statement_text()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return (
                full_statement_text
                if pdf_bytes == b"full-monthly"
                else summary_only_text
            )

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_bundle(
                [
                    (b"full-monthly", "HSBC-2026-07.pdf"),
                    (b"summary-only", "HSBC-2026-08.pdf"),
                ]
            )

        self.assertEqual(
            payload["summary"]["statement_periods"], ["2026-07", "2026-08"]
        )
        self.assertEqual(payload["ending_cash"], "1010.00")
        self.assertEqual(payload["ending_cash_by_currency"]["HKD"], "46.10")
        self.assertEqual(payload["summary"]["statement_date_max"], "2026-08-10")

    def test_hsbc_statement_cash_deduplicates_legacy_cash_event(self) -> None:
        legacy_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "HK433320P5343332",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "account_type": "USD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        statement_cash = {
            **legacy_cash,
            "description": "WITHDRAWAL",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_004244.pdf",
                "account_type": "Foreign Currency Savings USD",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
        }

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [legacy_cash],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_cash],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(
            merged["summary"]["incremental_import"]["added_record_count"], 0
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"], 1
        )
        self.assertEqual(merged["transactions"][0]["description"], "HK433320P5343332")

    def test_hsbc_cash_cross_source_merge_retains_same_source_candidate_alias(
        self,
    ) -> None:
        statement_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "WITHDRAWAL",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_004244.pdf",
                "account_type": "Foreign Currency Savings USD",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        legacy_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "HK433320P5343332",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "source_filename": "cash.txt",
                "account_type": "USD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
                "row_number": 1,
                "ledger_sequence": 1,
                "reference_id": "HK433320P5343332",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_cash],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [legacy_cash, deepcopy(legacy_cash)],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(
            merged["summary"]["incremental_import"]["added_record_count"], 0
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"], 2
        )
        self.assertEqual(
            merged["transactions"][0]["source"]["file_kind"],
            "hsbc_usd_account_text",
        )

    def test_hsbc_cash_same_source_row_deduplicates_statement_enrichment(self) -> None:
        source_record = {
            "date": "2026-06-01",
            "datetime": "2026-06-01 20:00:00",
            "type": "deposit",
            "ticker": "",
            "currency": "CNH",
            "description": "REF00000000000000 31MAY (31MAY26)",
            "net_amount_raw": "10000.02",
            "gross_amount_raw": "10000.02",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "RMB Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "10000.02",
                "row_number": 13,
                "ledger_sequence": 13,
                "reference_id": "REF00000000000000 31MAY (31MAY26)",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        statement_enriched_record = deepcopy(source_record)
        statement_enriched_record["source"].update(
            {
                "statement_date": "2026-06-10",
                "statement_pdf_balance_after_raw": "5000.00",
                "statement_pdf_source_filename": "eStatementFile_004244.pdf",
                "statement_pdf_statement_period": "2026-06",
            }
        )

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [source_record],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_enriched_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(
            merged["summary"]["incremental_import"]["added_record_count"], 0
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"], 1
        )
        self.assertEqual(
            merged["transactions"][0]["source"]["statement_pdf_source_filename"],
            "eStatementFile_004244.pdf",
        )

    def test_hsbc_historical_statement_does_not_replace_current_cash_snapshot(
        self,
    ) -> None:
        statement_cash = {
            "date": "2026-06-05",
            "datetime": "2026-06-05 12:00:00",
            "type": "deposit",
            "ticker": "",
            "currency": "HKD",
            "description": "DEMO ACCOUNT HOLDER REF00000000000000 05JUN",
            "net_amount_raw": "115.53",
            "gross_amount_raw": "115.53",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_004244.pdf",
                "account_type": "HKD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "124.10",
                "statement_date": "2026-06-10",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "multiple",
                "account": "multiple",
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": "20616.39",
                        "ending_cash_raw": "20616.39",
                        "calibration_source": "hsbc_usd_savings_available_balance",
                    },
                },
                "transactions": [],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {
                    "historical_statement_backfill": True,
                    "ending_cash_by_currency": {"HKD": "46.10"},
                    "ending_cash_base_currency": "5.88",
                },
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": "0.00",
                        "ending_cash_by_currency": {"HKD": "46.10"},
                        "ending_cash_base_currency": "5.88",
                    },
                },
                "transactions": [statement_cash],
            },
        )

        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "20616.39")
        self.assertNotIn("ending_cash_by_currency", merged["summary"])
