"""Regression coverage for Schwab CSV reconciliation of provisional TOS trades.

Code version: v0.1.0
"""

from __future__ import annotations

import base64
import hashlib
import unittest
from copy import deepcopy
from decimal import Decimal

from app.services.investment.investment_record_basics import (
    build_normalized_transaction_view,
)
from app.services.investment.importing.merge.schwab_provisional import (
    reconcile_schwab_provisional_sales,
)
from app.services.investment_import import (
    build_investment_payload_from_schwab_csv,
    merge_investment_payloads,
)


ACCOUNT = "Individual ...001"
REFERENCE = "TOS-PAGE-20260929-081152-GOOGL-SELL-1"


def paired_csv_payload(
    *,
    include_sale: bool,
    sale_quantity: str = "1",
    sale_price: str = "51.00",
    sale_fee: str = "0.01",
    duplicate_sale: bool = False,
    unrelated_sale: bool = False,
    sale_date: str = "09/29/2026",
    positions_day: str | None = None,
    positions_time: str = "09:00 AM",
    sale_amount: str | None = None,
) -> dict:
    transactions = [
        '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
        '"09/01/2026","Security Transfer","QQQI","QQQI receipt","1","","",""',
        '"09/28/2026","Buy","GOOGL","GOOGL buy","1","$50.00","","-$50.00"',
    ]
    if include_sale:
        net = Decimal(sale_quantity) * Decimal(sale_price) - Decimal(sale_fee)
        amount = sale_amount or f"{net:.2f}"
        sale_row = (
            f'"{sale_date}","Sell","GOOGL","GOOGL sell","{sale_quantity}",'
            f'"${sale_price}","${sale_fee}","${amount}"'
        )
        transactions.append(sale_row)
        if duplicate_sale:
            transactions.append(sale_row)
        if unrelated_sale:
            transactions.append(
                '"09/29/2026","Sell","GOOGL","Another GOOGL sale","2",'
                '"$57.00","$0.01","$113.99"'
            )
    positions_day = positions_day or ("29" if include_sale else "28")
    positions = [
        f'"Positions for account {ACCOUNT} as of {positions_time} ET, 2026/09/{positions_day}"',
        "",
        '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
        '"QQQI","QQQI ETF","1","20.00","$20.00","$20.00","ETFs & Closed End Funds",',
    ]
    if not include_sale:
        positions.append(
            '"GOOGL","GOOGL","1","50.00","$50.00","$50.00","Stocks",'
        )
    cash = "150.99" if include_sale else "100.00"
    total = "170.99" if include_sale else "170.00"
    positions.extend(
        [
            f'"Cash & Cash Investments","--","--","--","${cash}","--","Cash and Money Market",',
            f'"Positions Total","--","--","--","${total}","--","",',
        ]
    )
    return build_investment_payload_from_schwab_csv(
        ("\n".join(transactions) + "\n").encode(),
        ("\n".join(positions) + "\n").encode(),
        transaction_filename="download.csv",
        positions_filename="Individual-Positions-2026-09-29.csv",
    )


def provisional_payload(*, reference: str = REFERENCE) -> dict:
    workbook_bytes = b"isolated provisional workbook fixture"
    workbook_sha = hashlib.sha256(workbook_bytes).hexdigest()
    transaction = {
        "date": "2026-09-28",
        "datetime": "2026-09-28 20:11:52",
        "type": "sell",
        "broker": "schwab",
        "account": ACCOUNT,
        "ticker": "GOOGL",
        "currency": "USD",
        "description": "Temporary TOS execution",
        "quantity_raw": "-1",
        "quantity_abs": "1",
        "price_raw": "51.00",
        "gross_amount_raw": "51.00",
        "net_amount_raw": "51.00",
        "normalized": build_normalized_transaction_view(
            "sell",
            Decimal("-1"),
            Decimal("51.00"),
            Decimal("51.00"),
            None,
            Decimal("51.00"),
            is_cash_flow_override=False,
            side_override="sell",
        ),
        "source": {
            "file_kind": "manual_investment_xlsx",
            "source_file_sha256": workbook_sha,
            "source_sheet": "Transactions",
            "source_row": 2,
            "source_datetime_raw": "2026-09-29 08:11:52",
            "source_timezone": "Asia/Hong_Kong",
            "broker": "schwab",
            "account": ACCOUNT,
            "reference_id": reference,
        },
    }
    artifact = {
        "evidence_schema_version": "1.0",
        "sha256": workbook_sha,
        "byte_count": len(workbook_bytes),
        "filename": "provisional.xlsx",
        "filenames": ["provisional.xlsx"],
        "broker": "schwab",
        "account": ACCOUNT,
        "source_kind": "manual_investment_xlsx",
        "bundle_id": workbook_sha,
        "bundle_role": "manual_transactions",
        "related_sha256": "",
        "statement_period": "",
        "statement_period_start": "2026-09-28",
        "statement_period_end": "2026-09-28",
        "content_encoding": "base64",
        "content_base64": base64.b64encode(workbook_bytes).decode(),
    }
    return {
        "schema_version": "3.0.0",
        "generator": {"name": "manual_xlsx_to_investment_json"},
        "broker": "schwab",
        "account": ACCOUNT,
        "summary": {"transaction_count": 1},
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": [artifact],
        "transactions": [transaction],
    }


def other_broker_payload() -> dict:
    return {
        "schema_version": "3.0.0",
        "broker": "ibkr",
        "account": "U***00001",
        "summary": {"transaction_count": 1},
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": [],
        "transactions": [
            {
                "date": "2026-09-01",
                "datetime": "2026-09-01 12:00:00",
                "broker": "ibkr",
                "account": "U***00001",
                "type": "deposit",
                "currency": "USD",
                "description": "Isolated test deposit",
                "net_amount_raw": "5.00",
                "source": {"file_kind": "transactions"},
            }
        ],
    }


class SchwabProvisionalReconciliationTests(unittest.TestCase):
    def test_paired_csv_replaces_provisional_sale_and_preserves_snapshots(self) -> None:
        old_csv = paired_csv_payload(include_sale=False)
        manual = provisional_payload()
        with_manual = merge_investment_payloads(old_csv, manual)
        self.assertEqual(with_manual["broker_summaries"]["schwab"]["ending_cash"], "100.00")

        official = paired_csv_payload(include_sale=True)
        merged = merge_investment_payloads(with_manual, official)
        sales = [row for row in merged["transactions"] if row["type"] == "sell"]

        self.assertEqual(len(sales), 1)
        self.assertEqual(sales[0]["source"]["file_kind"], "schwab_csv")
        self.assertEqual(sales[0]["commission_raw"], "-0.01")
        self.assertEqual(sales[0]["net_amount_raw"], "50.99")
        self.assertEqual(
            merged["summary"]["incremental_import"]["superseded_schwab_provisional_trade_count"],
            1,
        )
        self.assertEqual(
            sales[0]["source"]["superseded_manual_reference_id"], REFERENCE
        )
        self.assertEqual(merged["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        snapshot = merged["broker_snapshots"][f"schwab:{ACCOUNT}"]
        self.assertNotIn("GOOGL", snapshot["position_snapshot"])
        self.assertEqual(snapshot["position_snapshot"]["QQQI"]["quantity"], "1")
        self.assertIn(
            manual["source_artifacts"][0]["sha256"],
            {item["sha256"] for item in merged["source_artifacts"]},
        )

        replayed = merge_investment_payloads(merged, official)
        shifted_csv = deepcopy(official)
        next(row for row in shifted_csv["transactions"] if row["type"] == "sell")[
            "source"
        ]["row_number"] = 99
        replayed = merge_investment_payloads(replayed, shifted_csv)
        replayed = merge_investment_payloads(replayed, manual)
        self.assertEqual(
            len([row for row in replayed["transactions"] if row["type"] == "sell"]),
            1,
        )
        self.assertEqual(replayed["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        self.assertEqual(
            replayed["broker_snapshots"][f"schwab:{ACCOUNT}"]["position_snapshot"],
            snapshot["position_snapshot"],
        )
        replayed = merge_investment_payloads(replayed, old_csv)
        self.assertEqual(replayed["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        self.assertNotIn(
            "GOOGL",
            replayed["broker_snapshots"][f"schwab:{ACCOUNT}"]["position_snapshot"],
        )

    def test_reverse_order_and_missing_csv_sale(self) -> None:
        official = paired_csv_payload(include_sale=True)
        manual = provisional_payload()
        merged = merge_investment_payloads(official, manual)
        self.assertEqual(
            len([row for row in merged["transactions"] if row["type"] == "sell"]),
            1,
        )
        self.assertEqual(merged["broker_summaries"]["schwab"]["ending_cash"], "150.99")

        old_csv = paired_csv_payload(include_sale=False)
        pending = merge_investment_payloads(old_csv, manual)
        self.assertEqual(
            len([row for row in pending["transactions"] if row["type"] == "sell"]),
            1,
        )
        self.assertEqual(pending["transactions"][-1]["source"]["file_kind"], "manual_investment_xlsx")

    def test_newer_same_day_positions_replace_older_snapshot(self) -> None:
        old_csv = paired_csv_payload(include_sale=False)
        manual = provisional_payload()
        pending = merge_investment_payloads(old_csv, manual)
        official = paired_csv_payload(
            include_sale=True,
            sale_date="09/28/2026",
            positions_day="28",
            positions_time="11:00 PM",
        )
        calibrated = merge_investment_payloads(pending, official)
        self.assertEqual(calibrated["ending_cash"], "150.99")
        self.assertNotIn("GOOGL", calibrated["position_snapshot"])
        self.assertEqual(calibrated["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        older_replay = merge_investment_payloads(calibrated, old_csv)
        self.assertEqual(older_replay["ending_cash"], "150.99")
        self.assertNotIn("GOOGL", older_replay["position_snapshot"])

    def test_mixed_broker_ledger_keeps_schwab_cash_through_replay(self) -> None:
        old_csv = paired_csv_payload(include_sale=False)
        mixed = merge_investment_payloads(old_csv, other_broker_payload())
        self.assertEqual(mixed["broker"], "multiple")

        manual = provisional_payload()
        with_manual = merge_investment_payloads(mixed, manual)
        self.assertEqual(with_manual["broker_summaries"]["schwab"]["ending_cash"], "100.00")

        official = paired_csv_payload(include_sale=True)
        calibrated = merge_investment_payloads(with_manual, official)
        self.assertEqual(calibrated["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        replayed = merge_investment_payloads(calibrated, manual)
        replayed = merge_investment_payloads(replayed, old_csv)
        self.assertEqual(replayed["broker_summaries"]["schwab"]["ending_cash"], "150.99")
        self.assertEqual(
            len([row for row in replayed["transactions"] if row["type"] == "sell"]),
            1,
        )

    def test_ambiguous_or_economically_conflicting_sale_fails_closed(self) -> None:
        manual = provisional_payload()
        ambiguous = paired_csv_payload(include_sale=True, duplicate_sale=True)
        with self.assertRaisesRegex(ValueError, "provisional.*Schwab"):
            merge_investment_payloads(manual, ambiguous)

        conflicting = paired_csv_payload(include_sale=True, sale_price="57.00")
        with self.assertRaisesRegex(ValueError, "provisional.*Schwab"):
            merge_investment_payloads(manual, conflicting)

    def test_unrelated_manual_reference_is_not_superseded(self) -> None:
        unrelated = provisional_payload(reference="manual-sale-1")
        official = paired_csv_payload(include_sale=True)
        merged = merge_investment_payloads(unrelated, official)
        sales = [row for row in merged["transactions"] if row["type"] == "sell"]
        self.assertEqual(len(sales), 2)

    def test_conflicting_broker_amount_cannot_calibrate_sale(self) -> None:
        with self.assertRaisesRegex(ValueError, "Schwab.*Amount.*reconcile"):
            paired_csv_payload(include_sale=True, sale_amount="50.98")

    def test_distinct_same_day_sale_does_not_block_unique_match(self) -> None:
        manual = provisional_payload()
        official = paired_csv_payload(include_sale=True, unrelated_sale=True)
        merged = merge_investment_payloads(manual, official)
        sales = [row for row in merged["transactions"] if row["type"] == "sell"]
        self.assertEqual(len(sales), 2)
        self.assertEqual(
            len(
                [
                    row
                    for row in sales
                    if row["source"].get("superseded_manual_reference_id") == REFERENCE
                ]
            ),
            1,
        )
        replayed = merge_investment_payloads(merged, official)
        self.assertEqual(
            len([row for row in replayed["transactions"] if row["type"] == "sell"]),
            2,
        )

        original_csv = paired_csv_payload(include_sale=True)
        originally_calibrated = merge_investment_payloads(manual, original_csv)
        later_added_sale = merge_investment_payloads(originally_calibrated, official)
        self.assertEqual(
            len([row for row in later_added_sale["transactions"] if row["type"] == "sell"]),
            2,
        )

    def test_precise_broker_time_must_match_page_or_ledger_time(self) -> None:
        manual = provisional_payload()
        official = paired_csv_payload(include_sale=True)
        sale = next(row for row in official["transactions"] if row["type"] == "sell")
        sale["source"]["source_has_intraday_timestamp"] = True
        sale["source"]["datetime_precision"] = "second"
        sale["datetime"] = "2026-09-29 09:00:00"
        with self.assertRaisesRegex(ValueError, "provisional.*Schwab"):
            merge_investment_payloads(manual, official)

        sale["datetime"] = "2026-09-29 08:11:52"
        merged = merge_investment_payloads(manual, official)
        self.assertEqual(
            len([row for row in merged["transactions"] if row["type"] == "sell"]),
            1,
        )

    def test_prior_reference_cannot_cross_accounts_or_replace_original_digest(self) -> None:
        official = paired_csv_payload(include_sale=True)
        sale = next(row for row in official["transactions"] if row["type"] == "sell")
        sale["source"]["superseded_manual_reference_id"] = REFERENCE
        sale["source"]["superseded_manual_source_sha256"] = "a" * 64
        wrong_account = provisional_payload()
        wrong_account_sale = wrong_account["transactions"][0]
        wrong_account_sale["account"] = "Individual ...999"
        wrong_account_sale["source"]["account"] = "Individual ...999"
        with self.assertRaisesRegex(ValueError, "provisional.*Schwab"):
            reconcile_schwab_provisional_sales(
                [sale], wrong_account["transactions"]
            )

        manual = provisional_payload()["transactions"][0]
        existing, incoming, removed = reconcile_schwab_provisional_sales(
            [sale], [manual]
        )
        self.assertEqual(removed, 1)
        self.assertEqual(incoming, [])
        self.assertEqual(
            existing[0]["source"]["superseded_manual_source_sha256"], "a" * 64
        )

    def test_later_csv_fee_revision_cannot_duplicate_linked_sale(self) -> None:
        manual = provisional_payload()
        official = paired_csv_payload(include_sale=True)
        calibrated = merge_investment_payloads(manual, official)
        revised = paired_csv_payload(include_sale=True, sale_fee="0.02")
        with self.assertRaisesRegex(ValueError, "Schwab.*CSV row.*conflicting"):
            merge_investment_payloads(calibrated, revised)

    def test_later_csv_trade_revision_cannot_duplicate_linked_sale(self) -> None:
        manual = provisional_payload()
        official = paired_csv_payload(include_sale=True)
        calibrated = merge_investment_payloads(manual, official)
        revisions = (
            ("quantity", {"sale_quantity": "2"}),
            ("price", {"sale_price": "51.01"}),
            ("date", {"sale_date": "09/28/2026"}),
        )
        for revision_name, options in revisions:
            with self.subTest(revision=revision_name):
                revised = paired_csv_payload(include_sale=True, **options)
                with self.assertRaisesRegex(ValueError, "Schwab.*CSV row.*conflicting"):
                    merge_investment_payloads(calibrated, revised)


if __name__ == "__main__":
    unittest.main()
