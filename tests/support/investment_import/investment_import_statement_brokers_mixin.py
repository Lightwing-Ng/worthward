"""Domain-focused investment-import regression mixin.

Code version: v0.1.1
"""

from __future__ import annotations

from tests.support.investment_import.investment_import_test_support import (
    Decimal,
    Path,
    build_investment_internal_transfer_binding_key,
    build_investment_payload_from_bochk_statement_pdfs,
    build_investment_payload_from_futuhk_statement_pdfs,
    hashlib,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    validate_investment_internal_transfer_binding,
)


class StatementBrokerImportTestsMixin:
    def test_futuhk_statement_pdf_import_parses_trades_and_cash_flows(self) -> None:
        feb_pdf = Path(
            "/Users/example/Desktop/IBKR/FUTU-TEST-ACCOUNT-2-202302-1782351318670.pdf"
        )
        mar_pdf = Path(
            "/Users/example/Desktop/IBKR/FUTU-TEST-ACCOUNT-2-202303-1782351300183.pdf"
        )
        if not feb_pdf.exists() or not mar_pdf.exists():
            self.skipTest("Local Futu (HK) statement PDF fixtures are unavailable.")

        payload = build_investment_payload_from_futuhk_statement_pdfs(
            [
                (feb_pdf.read_bytes(), feb_pdf.name),
                (mar_pdf.read_bytes(), mar_pdf.name),
            ]
        )

        self.assertEqual(payload["broker"], "futuhk")
        self.assertEqual(payload["account"], "FUTU-TEST-ACCOUNT")
        self.assertEqual(payload["summary"]["statement_count"], 2)

        trade_types = {
            (txn.get("ticker"), txn.get("type"))
            for txn in payload["transactions"]
            if txn.get("type") in {"buy", "sell"}
        }
        self.assertIn(("MSFT.US", "buy"), trade_types)
        self.assertIn(("SPLG.US", "buy"), trade_types)
        self.assertIn(("TSM.US", "buy"), trade_types)
        self.assertIn(("MSFT.US", "sell"), trade_types)
        self.assertIn(("SPLG.US", "sell"), trade_types)

        transfer_rows = [
            txn
            for txn in payload["transactions"]
            if "TRANSFER FROM HK STOCKS ACCOUNT"
            in str(txn.get("description", "")).upper()
        ]
        self.assertGreaterEqual(len(transfer_rows), 1)

        dividend_rows = [
            txn for txn in payload["transactions"] if txn.get("type") == "dividend"
        ]
        self.assertGreaterEqual(len(dividend_rows), 1)

    def test_futuhk_hk_stocks_account_transfers_are_marked_as_internal(self) -> None:
        internal_transfer = {
            "date": "2023-02-16",
            "type": "deposit",
            "broker": "futuhk",
            "account": "FUTU-TEST-ACCOUNT",
            "currency": "USD",
            "description": "TRANSFER FROM HK STOCKS ACCOUNT (HKD -> USD 7.86473)",
            "net_amount_raw": "1271.50",
            "normalized": {"net_amount": "1271.50"},
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "statement_order_id": "60839007",
            },
        }
        ordinary_futu_deposit = {
            **internal_transfer,
            "description": "Deposit from an external bank",
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "statement_order_id": "26037902",
            },
        }
        non_futu_transfer = {
            **internal_transfer,
            "broker": "hsbc",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "statement_order_id": "26037903",
            },
        }

        payload = normalize_investment_payload_tickers(
            {
                "broker": "multiple",
                "account": "multiple",
                "transactions": [
                    internal_transfer,
                    ordinary_futu_deposit,
                    non_futu_transfer,
                ],
            }
        )

        normalized_internal = payload["transactions"][0]
        self.assertEqual(
            normalized_internal["internal_transfer_scope"],
            "futuhk_hk_stocks_account",
        )
        self.assertTrue(normalized_internal["internal_transfer_external_flow_excluded"])
        self.assertEqual(
            normalized_internal["source"]["internal_transfer_scope"],
            "futuhk_hk_stocks_account",
        )
        self.assertNotIn("internal_transfer_scope", payload["transactions"][1])
        self.assertNotIn("internal_transfer_scope", payload["transactions"][2])

    @staticmethod
    def _synthetic_bochk_statement_text(
        *,
        statement_date: str,
        transaction_date: str,
        hkd_ending: str = "0.00",
        hkd_current_ending: str | None = None,
        cny_ending: str = "100.00",
        usd_ending: str = "12.34",
    ) -> str:
        hkd_withdrawal = f"{Decimal('100.00') - Decimal(hkd_ending):.2f}"
        hkd_current_section = ""
        if hkd_current_ending is not None:
            hkd_current_section = f"""

	HKD Current (900-000-1-000045-1)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
{transaction_date}   Transfer                                                  {hkd_current_ending}                                                  {hkd_current_ending}
             FPS/HSBC/REF-CURRENT
{statement_date}   Balance Carried Forward                                                                                                  {hkd_current_ending}
"""
        return f"""BOCHK Consolidated Statement
i-Free Banking Customer No           65640001
Statement Date                        {statement_date}
Account Transaction Details

Savings Account
	HKD Savings (900-000-1-000006-6)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
{transaction_date}   ATM Cash                                                 100.00                                                  100.00
             ATM DEP
{transaction_date}   ATM Cash                                                                               {hkd_withdrawal}                        {hkd_ending}
             ATM
{statement_date}   Balance Carried Forward                                                                                                  {hkd_ending}
{hkd_current_section}

	Foreign Currency Savings (900-000-1-000007-9)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
             CNY
{transaction_date}   Transfer                                                  {cny_ending}                                                  {cny_ending}
             FPS/WU/REF-CNY
{statement_date}   Balance Carried Forward                                                                                                  {cny_ending}

	Foreign Currency Savings (900-000-1-000007-9)
Date         Transaction Details                                                           Deposit                    Withdrawal Balance in Original Currency
             USD
{transaction_date}   Transfer                                                  {usd_ending}                                                  {usd_ending}
             REMIT IN/REF-USD
{statement_date}   Balance Carried Forward                                                                                                  {usd_ending}

US Securities Account Withdrawals / Deposits of Cash Balance (012-687-63-34193-9)
Transaction Date              Summary                                                                      Deposit / (Withdrawal)                                Net Balance
 {transaction_date}                   B/F                                                        USD                                  0.0000   USD                            0.0000
 {statement_date}                   C/F                                                        USD                                  0.0000   USD                            0.0000
        Important Notes
"""

    def test_bochk_right_aligned_withdrawal_is_classified_by_flow_column(self) -> None:
        pdf_bytes = b"bochk-right-aligned-withdrawal"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        lines = text.splitlines()
        replacement = (
            "2026/07/01   ATM Cash"
            + " " * (106 - len("2026/07/01   ATM Cash"))
            + "100.00"
            + " " * (130 - 112)
            + "0.00"
        )
        replaced = False
        atm_cash_occurrences = 0
        for index, line in enumerate(lines):
            if line.startswith("2026/07/01   ATM Cash"):
                atm_cash_occurrences += 1
            if atm_cash_occurrences == 2 and not replaced:
                lines[index] = replacement
                replaced = True
        self.assertTrue(replaced)

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): "\n".join(lines)},
        )
        hkd_rows = [row for row in payload["transactions"] if row["currency"] == "HKD"]
        self.assertEqual(len(hkd_rows), 2)
        self.assertEqual(
            [row["type"] for row in hkd_rows],
            ["deposit", "withdrawal"],
        )
        self.assertEqual(hkd_rows[-1]["net_amount_raw"], "-100.00")

    def test_bochk_composite_page_headers_cannot_extend_transaction_descriptions(
        self,
    ) -> None:
        pdf_bytes = b"bochk-composite-header"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "             ATM DEP\n2026/07/01   ATM Cash",
            "             ATM DEP\n"
            "ACCOUNT HOLDER\n"
            "DEMO ACCOUNT HOLDER                                      Consolidated Statement\n"
            "Enrich Banking Customer No                       65640001\n"
            "Statement Date                                  2026/07/31\n"
            "Page                                            2/4\n"
            "Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency\n"
            "2026/07/01   ATM Cash",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        descriptions = " ".join(
            str(row["description"]) for row in payload["transactions"]
        ).upper()
        for marker in (
            "ACCOUNT HOLDER",
            "CONSOLIDATED STATEMENT",
            "CUSTOMER NO",
            "STATEMENT DATE",
            "PAGE",
        ):
            self.assertNotIn(marker, descriptions)

    def test_bochk_page_opening_balance_does_not_replace_statement_opening(
        self,
    ) -> None:
        pdf_bytes = b"bochk-page-opening-balance"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "             ATM DEP\n2026/07/01   ATM Cash",
            "             ATM DEP\n"
            "Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency\n"
            "2026/07/01   Balance Brought Forward                                                                                                  100.00\n"
            "2026/07/01   ATM Cash",
            1,
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        hkd_balance = next(
            balance
            for balance in payload["bochk_subaccount_balances"].values()
            if balance["currency"] == "HKD"
        )
        self.assertEqual(hkd_balance["starting"], "0.00")
        self.assertEqual(hkd_balance["ending"], "0.00")

    def test_bochk_undated_amount_row_fails_closed(self) -> None:
        pdf_bytes = b"bochk-undated-amount-row"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        lines = text.splitlines()
        atm_cash_occurrences = 0
        replaced = False
        for index, line in enumerate(lines):
            if line.startswith("2026/07/01   ATM Cash"):
                atm_cash_occurrences += 1
            if atm_cash_occurrences == 2 and not replaced:
                lines[index] = " " * 10 + line[10:]
                replaced = True
        self.assertTrue(replaced)

        with self.assertRaisesRegex(ValueError, "undated amount row"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 2526.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): "\n".join(lines)},
            )

    def test_bochk_balance_continuity_rejects_unreconciled_rows(self) -> None:
        pdf_bytes = b"bochk-balance-continuity"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "2026/07/01   ATM Cash                                                 100.00                                                  100.00",
            "2026/07/01   ATM Cash                                                 100.00                                                  101.00",
            1,
        )
        with self.assertRaisesRegex(ValueError, "balance continuity"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 2526.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): text},
            )

    def test_bochk_statement_import_preserves_parent_and_subaccount_identity(
        self,
    ) -> None:
        first_bytes = b"bochk-june-statement"
        second_bytes = b"bochk-july-statement"
        first_text = self._synthetic_bochk_statement_text(
            statement_date="2026/06/30",
            transaction_date="2026/06/01",
        )
        second_text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [
                (first_bytes, "Jun 4005.pdf"),
                (second_bytes, "Jul 2526.pdf"),
            ],
            _extracted_text_by_payload_id={
                id(first_bytes): first_text,
                id(second_bytes): second_text,
            },
        )

        self.assertEqual(payload["broker"], "boc_hk")
        self.assertEqual(payload["account"], "65640001")
        self.assertEqual(
            payload["summary"]["statement_periods"], ["2026-06", "2026-07"]
        )
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "25.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(len(payload["source_artifacts"]), 2)
        self.assertEqual(
            {row["source"]["account_number_short"] for row in payload["transactions"]},
            {"0066", "0079"},
        )
        self.assertEqual(
            {
                (row["source"]["account_number_short"], row["currency"])
                for row in payload["transactions"]
            },
            {("0066", "HKD"), ("0079", "CNH"), ("0079", "USD")},
        )
        self.assertTrue(
            all(row["account"] == "65640001" for row in payload["transactions"])
        )

    def test_bochk_statement_import_preserves_hkd_current_and_canonicalizes_cnh(
        self,
    ) -> None:
        pdf_bytes = b"bochk-current-account-statement"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            hkd_current_ending="30.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )

        current_rows = [
            row
            for row in payload["transactions"]
            if row["source"].get("account_type") == "HKD Current"
        ]
        self.assertEqual(len(current_rows), 1)
        self.assertEqual(current_rows[0]["currency"], "HKD")
        self.assertEqual(current_rows[0]["source"]["account_number_short"], "0451")
        self.assertEqual(current_rows[0]["source"]["statement_currency_raw"], "HKD")
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "55.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(
            {
                (value["account_number_short"], value["currency"])
                for value in payload["bochk_subaccount_balances"].values()
            },
            {
                ("0066", "HKD"),
                ("0451", "HKD"),
                ("0079", "CNH"),
                ("0079", "USD"),
            },
        )

    def test_bochk_cnh_binding_migrates_a_persisted_cny_key(self) -> None:
        bochk_source = {
            "date": "2026-07-01",
            "type": "deposit",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "CNY",
            "description": "BOCHK CNH funding",
            "net_amount_raw": "200.00",
            "source": {
                "broker": "boc_hk",
                "file_kind": "boc_hk_statement_pdf",
                "account_number": "900-000-1-000007-9",
                "account_number_short": "0079",
                "account_type": "Foreign Currency Savings",
                "statement_currency_raw": "CNY",
            },
        }
        hsbc_target = {
            "date": "2026-07-01",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "CNH",
            "description": "Transfer to BOCHK",
            "net_amount_raw": "-200.00",
            "source": {"broker": "hsbc", "file_kind": "hsbc_cash_statement"},
        }
        old_source_key = build_investment_internal_transfer_binding_key(bochk_source)
        target_key = build_investment_internal_transfer_binding_key(hsbc_target)

        payload = normalize_investment_payload_tickers(
            {
                "schema_version": 3,
                "broker": "multiple",
                "account": "multiple",
                "transactions": [bochk_source, hsbc_target],
                "manual_internal_transfer_bindings": {old_source_key: target_key},
                "manual_internal_transfer_ignored_source_keys": [old_source_key],
            }
        )

        normalized_source = payload["transactions"][0]
        canonical_source_key = build_investment_internal_transfer_binding_key(
            normalized_source
        )
        self.assertEqual(normalized_source["currency"], "CNH")
        self.assertEqual(
            normalized_source["source"]["statement_currency_raw"],
            "CNY",
        )
        self.assertEqual(
            payload["manual_internal_transfer_bindings"],
            {canonical_source_key: target_key},
        )
        self.assertEqual(
            payload["manual_internal_transfer_ignored_source_keys"],
            [canonical_source_key],
        )
        source, target = validate_investment_internal_transfer_binding(
            payload["transactions"],
            canonical_source_key,
            target_key,
        )
        self.assertEqual(source["currency"], "CNH")
        self.assertEqual(target["currency"], "CNH")

    def test_bochk_statement_batches_merge_without_losing_periods_or_balances(
        self,
    ) -> None:
        first_bytes = b"bochk-batch-one"
        second_bytes = b"bochk-batch-two"
        first_text = self._synthetic_bochk_statement_text(
            statement_date="2026/06/30",
            transaction_date="2026/06/01",
        )
        second_text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )
        first = build_investment_payload_from_bochk_statement_pdfs(
            [(first_bytes, "Jun 4005.pdf")],
            _extracted_text_by_payload_id={id(first_bytes): first_text},
        )
        second = build_investment_payload_from_bochk_statement_pdfs(
            [(second_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={id(second_bytes): second_text},
        )

        merged = merge_investment_payloads(first, second)
        reimported = merge_investment_payloads(merged, second)

        self.assertEqual(merged["summary"]["statement_count"], 2)
        self.assertEqual(
            merged["summary"]["statement_periods"],
            ["2026-06", "2026-07"],
        )
        self.assertEqual(merged["summary"]["statement_date_min"], "2026-06-30")
        self.assertEqual(merged["summary"]["statement_date_max"], "2026-07-31")
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"HKD": "25.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(len(merged["source_artifacts"]), 2)
        self.assertEqual(len(reimported["transactions"]), len(merged["transactions"]))
        self.assertEqual(len(reimported["source_artifacts"]), 2)
        self.assertEqual(reimported["summary"]["statement_count"], 2)

    def test_bochk_metadata_survives_a_mixed_ledger_merge(self) -> None:
        june_bytes = b"bochk-mixed-june"
        july_bytes = b"bochk-mixed-july"
        june = build_investment_payload_from_bochk_statement_pdfs(
            [(june_bytes, "Jun 4005.pdf")],
            _extracted_text_by_payload_id={
                id(june_bytes): self._synthetic_bochk_statement_text(
                    statement_date="2026/06/30",
                    transaction_date="2026/06/01",
                ),
            },
        )
        july = build_investment_payload_from_bochk_statement_pdfs(
            [(july_bytes, "Jul 2526.pdf")],
            _extracted_text_by_payload_id={
                id(july_bytes): self._synthetic_bochk_statement_text(
                    statement_date="2026/07/31",
                    transaction_date="2026/07/01",
                    hkd_ending="25.00",
                    cny_ending="200.00",
                    usd_ending="20.00",
                ),
            },
        )
        ibkr = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-05-01",
                    "type": "deposit",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "gross_amount_raw": "1.00",
                    "net_amount_raw": "1.00",
                    "source": {"file_kind": "transactions"},
                }
            ],
        }

        mixed = merge_investment_payloads(ibkr, june)
        mixed = merge_investment_payloads(mixed, july)

        self.assertEqual(mixed["broker"], "multiple")
        self.assertEqual(mixed["summary"]["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(mixed["summary"]["statement_count"], 2)
        self.assertTrue(mixed["bochk_subaccount_balances"])
        bochk_summary = mixed["broker_summaries"]["boc_hk"]
        self.assertEqual(bochk_summary["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(bochk_summary["statement_count"], 2)
        self.assertTrue(bochk_summary["bochk_subaccount_balances"])

    def test_bochk_statement_import_preserves_repeated_same_shape_rows_and_deduplicates_reupload(
        self,
    ) -> None:
        pdf_bytes = b"bochk-feb-statement"
        text = self._synthetic_bochk_statement_text(
            statement_date="2023/02/28",
            transaction_date="2023/02/11",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Feb 9753.pdf"), (pdf_bytes, "Feb 9753.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        hkd_rows = [
            row
            for row in payload["transactions"]
            if row["currency"] == "HKD"
            and row["source"]["account_number_short"] == "0066"
        ]

        self.assertEqual(len(hkd_rows), 2)
        self.assertEqual(payload["summary"]["duplicate_statement_row_count"], 4)
        self.assertEqual(
            hashlib.sha256(pdf_bytes).hexdigest(),
            payload["source_artifacts"][0]["sha256"],
        )

    def test_bochk_statement_import_rejects_nonzero_securities_cash_activity(
        self,
    ) -> None:
        pdf_bytes = b"bochk-securities-cash"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
        ).replace(
            "USD                                  0.0000   USD                            0.0000",
            "USD                                100.0000   USD                          100.0000",
        )

        with self.assertRaisesRegex(
            ValueError, "non-zero securities-account cash activity"
        ):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 2526.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): text},
            )

    def test_bochk_statement_parser_rejects_empty_or_unidentified_source_files(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "is empty"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"", "Jul 2526.pdf")],
            )

        with self.assertRaisesRegex(ValueError, "non-empty filename"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"pdf", "")],
            )

        with self.assertRaisesRegex(ValueError, r"must use a \.pdf filename"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"pdf", "Jul 2026.txt")],
            )

    def test_bochk_balance_only_statement_preserves_cash_balances(self) -> None:
        pdf_bytes = b"bochk-balance-only-statement"
        statement_date = "2026/07/31"
        transaction_date = "2026/07/01"
        statement_text = self._synthetic_bochk_statement_text(
            statement_date=statement_date,
            transaction_date=transaction_date,
            hkd_ending="50.00",
            cny_ending="100.00",
            usd_ending="12.34",
        )
        balance_only_text = "\n".join(
            line
            for line in statement_text.splitlines()
            if not line.lstrip().startswith(transaction_date)
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2026 balance-only.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): balance_only_text},
        )

        self.assertEqual(payload["transactions"], [])
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "50.00", "CNH": "100.00", "USD": "12.34"},
        )
        self.assertEqual(
            {
                (value["account_number_short"], value["currency"])
                for value in payload["bochk_subaccount_balances"].values()
            },
            {("0066", "HKD"), ("0079", "CNH"), ("0079", "USD")},
        )
        self.assertTrue(
            any(
                "No BOCHK deposit-account transactions" in warning
                for warning in payload["summary"]["warnings"]
            )
        )
