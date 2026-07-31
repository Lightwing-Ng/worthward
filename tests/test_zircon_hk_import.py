"""Tests for the generic typed manual-workbook import.

Code version: v0.5.0
"""

from __future__ import annotations

import base64
from datetime import datetime
from io import BytesIO
import unittest
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import load_workbook

from app.services.investment_import import (
    merge_investment_payloads,
    parse_investment_payload,
)
from app.services.zircon_hk_import import (
    ZIRCON_HK_BROKER_ENTRIES,
    ZIRCON_HK_HEADERS,
    ZIRCON_HK_TEMPLATE_INPUT_ROWS,
    ZIRCON_HK_TYPE_LABELS,
    build_investment_payload_from_zircon_hk_manual_xlsx,
    build_standard_investment_xlsx,
    build_zircon_hk_template_xlsx,
)


class ZirconHkImportTests(unittest.TestCase):
    def _completed_workbook(
        self,
        *,
        overrides: dict[str, object] | None = None,
    ) -> bytes:
        workbook = load_workbook(BytesIO(build_zircon_hk_template_xlsx()))
        sheet = workbook["Transactions"]
        values: dict[str, object] = {
            "A2": "Zircon HK",
            "B2": "Zircon practice account",
            "C2": datetime(2026, 7, 30, 21, 15),
            "D2": "Buy",
            "E2": "HKD",
            "F2": "700.HK",
            "G2": 100,
            "H2": 20,
            "I2": None,
            "J2": 5,
            "K2": "Manual activity entry",
            "L2": "zircon-reference-1",
        }
        values.update(overrides or {})
        for coordinate, value in values.items():
            sheet[coordinate] = value
        buffer = BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    def _forex_workbook(
        self,
        *,
        acquired_amount: float = 83.22,
        acquired_datetime: datetime | None = None,
        reference_id: str = "fx-20260730-01",
    ) -> bytes:
        transaction_datetime = datetime(2026, 7, 30, 21, 15)
        return self._completed_workbook(
            overrides={
                "C2": transaction_datetime,
                "D2": "Forex trade component",
                "E2": "HKD",
                "F2": None,
                "G2": None,
                "H2": None,
                "I2": -650,
                "J2": None,
                "K2": "HKD to USD",
                "L2": reference_id,
                "A3": "Zircon HK",
                "B3": "Zircon practice account",
                "C3": acquired_datetime or transaction_datetime,
                "D3": "Forex trade component",
                "E3": "USD",
                "I3": acquired_amount,
                "K3": "HKD to USD",
                "L3": reference_id,
            }
        )

    def test_template_contains_dropdowns_typed_validation_and_no_sample_records(
        self,
    ) -> None:
        workbook_bytes = build_zircon_hk_template_xlsx()
        workbook = load_workbook(BytesIO(workbook_bytes))
        self.assertEqual(
            workbook.sheetnames,
            ["Transactions", "Lists"],
        )
        self.assertEqual(workbook["Lists"].sheet_state, "hidden")
        sheet = workbook["Transactions"]
        self.assertEqual(
            tuple(cell.value for cell in sheet[1]),
            ZIRCON_HK_HEADERS,
        )
        self.assertEqual(sheet.freeze_panes, "A2")
        self.assertFalse(sheet.tables)
        self.assertEqual(len(sheet.conditional_formatting), 0)
        self.assertTrue(
            all(
                sheet.cell(row=row, column=column).value is None
                for row in range(2, ZIRCON_HK_TEMPLATE_INPUT_ROWS + 2)
                for column in range(1, len(ZIRCON_HK_HEADERS) + 1)
            )
        )
        validation_types = {
            validation.type for validation in sheet.data_validations.dataValidation
        }
        self.assertEqual(validation_types, {"list", "date", "decimal"})
        self.assertEqual(
            [
                workbook["Lists"].cell(row=row, column=1).value
                for row in range(2, len(ZIRCON_HK_TYPE_LABELS) + 2)
            ],
            list(ZIRCON_HK_TYPE_LABELS),
        )
        with ZipFile(BytesIO(workbook_bytes)) as archive:
            transactions_xml = archive.read("xl/worksheets/sheet1.xml")
            archive_members = set(archive.namelist())
        self.assertNotIn(b"<conditionalFormatting", transactions_xml)
        self.assertNotIn(b"<tableParts", transactions_xml)
        self.assertFalse(any(name.startswith("xl/tables/") for name in archive_members))
        for name in (b"ZirconBrokers", b"ZirconTypes", b"ZirconCurrencies"):
            self.assertIn(b"<formula1>" + name + b"</formula1>", transactions_xml)
            self.assertNotIn(b"<formula1>=" + name + b"</formula1>", transactions_xml)
        self.assertEqual(
            [
                workbook["Lists"].cell(row=row, column=3).value
                for row in range(2, len(ZIRCON_HK_BROKER_ENTRIES) + 2)
            ],
            [entry.label for entry in ZIRCON_HK_BROKER_ENTRIES],
        )

    def test_parser_normalizes_typed_trade_and_retains_exact_workbook_evidence(
        self,
    ) -> None:
        workbook_bytes = self._completed_workbook()

        payload = parse_investment_payload(
            "zircon_hk",
            "manual_xlsx",
            xlsx_bytes=workbook_bytes,
            filename="zircon-activity.xlsx",
        )

        self.assertEqual(payload["broker"], "zircon_hk")
        self.assertEqual(payload["summary"]["transaction_count"], 1)
        transaction = payload["transactions"][0]
        self.assertEqual(transaction["datetime"], "2026-07-30 09:15:00")
        self.assertEqual(transaction["ticker"], "700.HK")
        self.assertEqual(transaction["quantity_raw"], "100")
        self.assertEqual(transaction["price_raw"], "20")
        self.assertEqual(transaction["gross_amount_raw"], "-2000")
        self.assertEqual(transaction["commission_raw"], "-5")
        self.assertEqual(transaction["net_amount_raw"], "-2005")
        self.assertEqual(transaction["source"]["source_row"], 2)
        self.assertEqual(transaction["source"]["source_timezone"], "Asia/Hong_Kong")
        artifact = payload["source_artifacts"][0]
        self.assertEqual(
            base64.b64decode(artifact["content_base64"]),
            workbook_bytes,
        )

    def test_standard_export_round_trips_selected_ledger_rows(self) -> None:
        workbook_bytes = build_standard_investment_xlsx([
            {
                "ledger_no": 42,
                "broker": "ibkr",
                "account": "U1234567",
                "datetime": "2026-07-30 09:15:00",
                "type": "buy",
                "currency": "USD",
                "ticker": "AAPL",
                "quantity_raw": "2",
                "price_raw": "210.25",
                "commission_raw": "-1.25",
                "description": "Authoritative AAPL purchase",
                "source": {},
            },
        ])

        workbook = load_workbook(BytesIO(workbook_bytes))
        values = tuple(
            workbook["Transactions"].cell(row=2, column=column).value
            for column in range(1, len(ZIRCON_HK_HEADERS) + 1)
        )
        self.assertEqual(values[0], "IBKR")
        self.assertEqual(values[3], "Buy")
        self.assertEqual(values[5], "AAPL")
        self.assertEqual(values[11], "antigravity-ledger-42")

        payload = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=workbook_bytes,
            filename="AAPL_standard_investment_export.xlsx",
        )
        transaction = payload["transactions"][0]
        self.assertEqual(transaction["broker"], "ibkr")
        self.assertEqual(transaction["account"], "U1234567")
        self.assertEqual(transaction["datetime"], "2026-07-30 09:15:00")
        self.assertEqual(transaction["quantity_raw"], "2")
        self.assertEqual(transaction["price_raw"], "210.25")
        self.assertEqual(transaction["commission_raw"], "-1.25")

    def test_parser_rejects_text_dates_numbers_formulas_and_wrong_cash_signs(
        self,
    ) -> None:
        invalid_cases = (
            ({"C2": "30 Jul 2026 21:15"}, r"Transactions!C2.*typed Excel date or date-time"),
            ({"G2": "one hundred"}, r"Transactions!G2.*numeric Excel cell"),
            ({"K2": "=WEBSERVICE(\"https://example.invalid\")"}, r"Transactions!K2.*formula"),
            ({"D2": "Sell", "I2": -1995}, r"Transactions!I2.*blank for trades"),
        )
        for overrides, message in invalid_cases:
            with self.subTest(overrides=overrides):
                with self.assertRaisesRegex(ValueError, message):
                    build_investment_payload_from_zircon_hk_manual_xlsx(
                        xlsx_bytes=self._completed_workbook(overrides=overrides),
                        filename="zircon-activity.xlsx",
                    )

    def test_parser_reports_each_invalid_cell_before_any_payload_is_returned(
        self,
    ) -> None:
        workbook_bytes = self._completed_workbook(
            overrides={
                "C2": "not a date",
                "A3": "Wrong broker",
                "C3": datetime(2026, 7, 30, 22, 0),
                "D3": "Deposit",
                "E3": "USD",
                "I3": 100,
            }
        )

        with self.assertRaises(ValueError) as raised:
            build_investment_payload_from_zircon_hk_manual_xlsx(
                xlsx_bytes=workbook_bytes,
                filename="zircon-activity.xlsx",
            )

        message = str(raised.exception)
        self.assertIn("Transactions!C2", message)
        self.assertIn("Transactions!A3", message)
        self.assertIn("Fix these 2 cells", message)

    def test_parser_ignores_rows_with_only_prefilled_broker_and_account(self) -> None:
        payload = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._completed_workbook(
                overrides={
                    "A3": "Zircon HK",
                    "B3": "Zircon practice account",
                    "B4": "Zircon practice account",
                }
            ),
            filename="manual-prefilled-rows.xlsx",
        )

        self.assertEqual(len(payload["transactions"]), 1)

    def test_parser_rejects_active_content_before_openpyxl_parsing(self) -> None:
        archive_buffer = BytesIO(build_zircon_hk_template_xlsx())
        with ZipFile(archive_buffer, mode="a", compression=ZIP_DEFLATED) as archive:
            archive.writestr("xl/vbaProject.bin", b"unsafe active content")

        with self.assertRaisesRegex(
            ValueError,
            "must not contain macros, embedded objects",
        ):
            build_investment_payload_from_zircon_hk_manual_xlsx(
                xlsx_bytes=archive_buffer.getvalue(),
                filename="zircon-active-content.xlsx",
            )

    def test_stable_reference_updates_a_corrected_manual_entry(self) -> None:
        initial = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._completed_workbook(),
            filename="zircon-initial.xlsx",
        )
        corrected = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._completed_workbook(
                overrides={"H2": 21}
            ),
            filename="zircon-corrected.xlsx",
        )

        merged = merge_investment_payloads(initial, corrected)

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["transactions"][0]["price_raw"], "21")
        self.assertEqual(merged["transactions"][0]["net_amount_raw"], "-2105")

    def test_date_only_defaults_to_2300_hong_kong_and_allows_other_brokers(
        self,
    ) -> None:
        payload = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._completed_workbook(
                overrides={
                    "A2": "HSBC",
                    "C2": datetime(2026, 7, 30),
                }
            ),
            filename="manual-investment.xlsx",
        )

        transaction = payload["transactions"][0]
        self.assertEqual(transaction["broker"], "hsbc")
        self.assertEqual(transaction["datetime"], "2026-07-30 11:00:00")
        self.assertTrue(
            transaction["source"]["source_time_defaulted_to_2300"]
        )
        self.assertEqual(payload["broker"], "hsbc")
        self.assertEqual(
            payload["source_artifacts"][0]["source_kind"],
            "manual_investment_xlsx",
        )

    def test_forex_conversion_requires_and_enriches_two_signed_currency_legs(
        self,
    ) -> None:
        payload = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._forex_workbook(),
            filename="manual-forex.xlsx",
        )

        self.assertEqual(len(payload["transactions"]), 2)
        transactions = {
            transaction["currency"]: transaction
            for transaction in payload["transactions"]
        }
        self.assertEqual(transactions["HKD"]["net_amount_raw"], "-650")
        self.assertEqual(transactions["USD"]["net_amount_raw"], "83.22")
        self.assertEqual(
            transactions["HKD"]["source"]["forex_pair_reference_id"],
            "fx-20260730-01",
        )
        self.assertEqual(transactions["HKD"]["source"]["forex_leg"], "sold")
        self.assertEqual(transactions["USD"]["source"]["forex_leg"], "acquired")
        self.assertEqual(transactions["USD"]["source"]["forex_pair"], "USD.HKD")
        self.assertEqual(
            transactions["USD"]["source"]["exchange_rate_convention"],
            "HKD per USD",
        )

    def test_forex_pair_uses_currency_scoped_stable_correction_identity(
        self,
    ) -> None:
        initial = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._forex_workbook(),
            filename="manual-forex-initial.xlsx",
        )
        corrected = build_investment_payload_from_zircon_hk_manual_xlsx(
            xlsx_bytes=self._forex_workbook(acquired_amount=83.25),
            filename="manual-forex-corrected.xlsx",
        )

        merged = merge_investment_payloads(initial, corrected)

        self.assertEqual(len(merged["transactions"]), 2)
        amounts = {
            transaction["currency"]: transaction["net_amount_raw"]
            for transaction in merged["transactions"]
        }
        self.assertEqual(amounts, {"HKD": "-650", "USD": "83.25"})

    def test_forex_pair_rejects_missing_or_mismatched_second_leg(self) -> None:
        invalid_workbooks = (
            (
                self._completed_workbook(
                    overrides={
                        "D2": "Forex trade component",
                        "E2": "HKD",
                        "F2": None,
                        "G2": None,
                        "H2": None,
                        "I2": -650,
                        "J2": None,
                        "L2": "fx-20260730-01",
                    }
                ),
                r"Transactions!L2.*requires exactly two",
            ),
            (
                self._forex_workbook(
                    acquired_datetime=datetime(2026, 7, 30, 21, 16)
                ),
                r"Transactions!L3.*same transaction date and time",
            ),
            (
                self._forex_workbook(acquired_amount=-83.22),
                r"Transactions!L3.*one negative sold-currency Amount",
            ),
        )
        for workbook_bytes, message in invalid_workbooks:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    build_investment_payload_from_zircon_hk_manual_xlsx(
                        xlsx_bytes=workbook_bytes,
                        filename="manual-forex-invalid.xlsx",
                    )

    def test_duplicate_reference_id_in_one_account_is_rejected(self) -> None:
        workbook_bytes = self._completed_workbook(
            overrides={
                "A3": "Zircon HK",
                "B3": "Zircon practice account",
                "C3": datetime(2026, 7, 30, 22, 0),
                "D3": "Deposit",
                "E3": "HKD",
                "I3": 100,
                "L3": "zircon-reference-1",
            }
        )

        with self.assertRaisesRegex(
            ValueError,
            r"Transactions!L3.*Reference ID must be unique",
        ):
            build_investment_payload_from_zircon_hk_manual_xlsx(
                xlsx_bytes=workbook_bytes,
                filename="zircon-duplicate-reference.xlsx",
            )


if __name__ == "__main__":
    unittest.main()
