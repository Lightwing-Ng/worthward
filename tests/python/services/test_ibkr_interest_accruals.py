"""IBKR statement Interest Accruals evidence regression tests.

Code version: v1.0.1

All account identifiers are synthetic. Accrued interest is a separate Net
Asset Value component: it must never be merged into cash, and a dated
statement boundary must never be carried forward to another date.
"""

from __future__ import annotations

import csv
import io
import unittest
from decimal import Decimal

from app.services.investment_import import build_investment_payload_from_ibkr_csvs
from app.services.investment.importing.artifacts import (
    _merge_broker_snapshots,
    _normalize_broker_snapshot_evidence,
    _normalize_broker_snapshots,
)
from app.services.investment.importing.brokers.ibkr.accruals import (
    extract_ibkr_interest_accrual_snapshot,
)

SYNTHETIC_ACCOUNT = "U00000001"


def _transaction_history_csv(period: str, ending_cash: str) -> bytes:
    return (
        "\n".join(
            [
                "Statement,Header,Field Name,Field Value",
                "Statement,Data,Title,Transaction History",
                f'Statement,Data,Period,"{period}"',
                "Summary,Header,Field Name,Field Value",
                "Summary,Data,Base Currency,USD",
                "Summary,Data,Starting Cash,0",
                f"Summary,Data,Ending Cash,{ending_cash}",
                "Transaction History,Header,Date,Account,Description,Transaction Type,"
                "Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                "Transaction History,Data,2026-06-01,U***00001,Electronic Fund Transfer,"
                f"Deposit,-,-,-,-,{ending_cash},-,{ending_cash}",
            ]
        )
        + "\n"
    ).encode("utf-8")


def _realized_summary_csv(period: str, statement_rows: list[str]) -> bytes:
    return (
        "\n".join(
            [
                "Statement,Header,Field Name,Field Value",
                "Statement,Data,BrokerName,Interactive Brokers LLC",
                "Statement,Data,Title,Realized Summary",
                f'Statement,Data,Period,"{period}"',
                "Account Information,Header,Field Name,Field Value",
                f"Account Information,Data,Account,{SYNTHETIC_ACCOUNT}",
                "Account Information,Data,Base Currency,USD",
                *statement_rows,
            ]
        )
        + "\n"
    ).encode("utf-8")


NAV_HEADER = (
    "Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,"
    "Current Total,Change"
)
ACCRUAL_HEADER = "Interest Accruals,Header,Currency,Field Name,Field Value"

# Reproduces the historical defect: Cash + Stock alone overstates NAV by the
# negative accrual.
NEGATIVE_ACCRUAL_ROWS = [
    NAV_HEADER,
    "Net Asset Value,Data,Cash ,0,33.125945525,0,33.125945525,33.125945525",
    "Net Asset Value,Data,Stock,0,35578.79,0,35578.79,35578.79",
    "Net Asset Value,Data,Interest Accruals,0,0,-6.5,-6.5,-6.5",
    "Net Asset Value,Data,Total,0,35611.915945525,-6.5,35605.415945525,35605.415945525",
    ACCRUAL_HEADER,
    "Interest Accruals,Data,Base Currency Summary,Starting Accrual Balance,0",
    "Interest Accruals,Data,Base Currency Summary,Interest Accrued,-6.03",
    "Interest Accruals,Data,Base Currency Summary,Accrual Reversal,-0.47",
    "Interest Accruals,Data,Base Currency Summary,Ending Accrual Balance,-6.5",
]

ZERO_ACCRUAL_ROWS = [
    NAV_HEADER,
    "Net Asset Value,Data,Cash ,10,0.003719548,0,0.003719548,-9.996280452",
    "Net Asset Value,Data,Total,10,0.003719548,0,0.003719548,-9.996280452",
    ACCRUAL_HEADER,
    "Interest Accruals,Data,Base Currency Summary,Starting Accrual Balance,0",
    "Interest Accruals,Data,Base Currency Summary,Ending Accrual Balance,0",
    "Interest Accruals,Data,CNH,Ending Accrual Balance,0",
    "Interest Accruals,Data,CNH,Ending Accrual Balance in USD,0",
    "Interest Accruals,Data,USD,Ending Accrual Balance,0",
]


def _rows(csv_bytes: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(csv_bytes.decode("utf-8"))))


class IbkrInterestAccrualParserTests(unittest.TestCase):
    def test_negative_accrual_is_a_separate_nav_component(self) -> None:
        payload = build_investment_payload_from_ibkr_csvs(
            _transaction_history_csv(
                "July 1, 2025 - June 26, 2026", "33.125945525"
            ),
            _realized_summary_csv(
                "July 1, 2025 - June 26, 2026", NEGATIVE_ACCRUAL_ROWS
            ),
        )

        snapshot = payload["interest_accrual_snapshot"]
        self.assertEqual(snapshot["status"], "reported")
        self.assertEqual(snapshot["as_of"], "2026-06-26")
        self.assertEqual(snapshot["currency"], "USD")
        self.assertEqual(Decimal(snapshot["amount"]), Decimal("-6.5"))
        self.assertEqual(Decimal(snapshot["nav_interest_accruals"]), Decimal("-6.5"))
        self.assertEqual(Decimal(snapshot["ending_accrual_balance"]), Decimal("-6.5"))
        # The accrual is not cash: the broker cash boundary is unchanged and no
        # synthetic cash transaction is created.
        self.assertEqual(Decimal(payload["ending_cash"]), Decimal("33.125945525"))
        self.assertFalse(
            any("accru" in str(txn.get("description", "")).lower() for txn in payload["transactions"])
        )
        # The statement's own NAV identity holds only with the accrual.
        cash = Decimal(payload["ending_cash"])
        stock = Decimal("35578.79")
        self.assertEqual(cash + stock, Decimal("35611.915945525"))
        self.assertEqual(
            cash + stock + Decimal(snapshot["amount"]),
            Decimal("35605.415945525"),
        )

        boundaries = next(iter(payload["broker_snapshots"].values()))[
            "interest_accrual_snapshots"
        ]
        self.assertEqual(
            [(item["as_of"], item["status"], item["amount"]) for item in boundaries],
            [("2026-06-26", "reported", "-6.5")],
        )

    def test_positive_accrual_is_retained_with_its_sign(self) -> None:
        rows = _rows(
            _realized_summary_csv(
                "January 1, 2026 - March 31, 2026",
                [
                    NAV_HEADER,
                    "Net Asset Value,Data,Interest Accruals,0,2.25,0,2.25,2.25",
                    ACCRUAL_HEADER,
                    "Interest Accruals,Data,Base Currency Summary,Ending Accrual Balance,2.25",
                ],
            )
        )
        snapshot = extract_ibkr_interest_accrual_snapshot(rows, [], as_of="2026-03-31")
        self.assertEqual(snapshot["status"], "reported")
        self.assertEqual(Decimal(snapshot["amount"]), Decimal("2.25"))

    def test_zero_ending_balance_is_reported_and_preserves_native_currencies(self) -> None:
        rows = _rows(_realized_summary_csv("September 17, 2025 - September 17, 2026", ZERO_ACCRUAL_ROWS))
        snapshot = extract_ibkr_interest_accrual_snapshot(rows, [], as_of="2026-09-17")
        self.assertEqual(snapshot["status"], "reported")
        self.assertEqual(Decimal(snapshot["amount"]), Decimal("0"))
        self.assertEqual(snapshot["nav_interest_accruals"], "")
        self.assertEqual(
            snapshot["by_currency"],
            {
                "CNH": {"ending_accrual_balance": "0", "ending_accrual_balance_in_base": "0"},
                "USD": {"ending_accrual_balance": "0"},
            },
        )

    def test_missing_accrual_evidence_stays_unknown(self) -> None:
        payload = build_investment_payload_from_ibkr_csvs(
            _transaction_history_csv("July 1, 2024 - July 1, 2025", "0.05"),
            _realized_summary_csv(
                "July 1, 2024 - July 1, 2025",
                [
                    NAV_HEADER,
                    "Net Asset Value,Data,Cash ,0,0.05,0,0.05,0.05",
                    "Net Asset Value,Data,Total,0,0.05,0,0.05,0.05",
                ],
            ),
        )
        self.assertNotIn("interest_accrual_snapshot", payload)
        self.assertNotIn("interest_accrual_snapshot_status", payload["summary"])
        for snapshot in payload.get("broker_snapshots", {}).values():
            self.assertNotIn("interest_accrual_snapshots", snapshot)

    def test_conflicting_nav_and_section_values_are_withheld(self) -> None:
        warnings: list[str] = []
        rows = _rows(
            _realized_summary_csv(
                "January 1, 2026 - March 31, 2026",
                [
                    NAV_HEADER,
                    "Net Asset Value,Data,Interest Accruals,0,0,-6.5,-6.5,-6.5",
                    ACCRUAL_HEADER,
                    "Interest Accruals,Data,Base Currency Summary,Ending Accrual Balance,-6.4",
                ],
            )
        )
        snapshot = extract_ibkr_interest_accrual_snapshot(rows, warnings, as_of="2026-03-31")
        self.assertEqual(snapshot["status"], "conflict")
        self.assertEqual(snapshot["amount"], "")
        self.assertTrue(warnings)

    def test_undated_statement_cannot_become_a_boundary(self) -> None:
        rows = _rows(_realized_summary_csv("", NEGATIVE_ACCRUAL_ROWS))
        snapshot = extract_ibkr_interest_accrual_snapshot(rows, [], as_of="")
        self.assertEqual(snapshot["status"], "undated")
        self.assertEqual(snapshot["amount"], "")


class IbkrInterestAccrualEvidenceTests(unittest.TestCase):
    def _payload(self, period: str, rows: list[str], ending_cash: str) -> dict:
        return build_investment_payload_from_ibkr_csvs(
            _transaction_history_csv(period, ending_cash),
            _realized_summary_csv(period, rows),
        )

    def test_later_zero_boundary_does_not_inherit_an_older_accrual(self) -> None:
        older = self._payload(
            "July 1, 2025 - June 26, 2026", NEGATIVE_ACCRUAL_ROWS, "33.125945525"
        )
        newer = self._payload(
            "September 17, 2025 - September 17, 2026", ZERO_ACCRUAL_ROWS, "0.003719548"
        )
        merged = _merge_broker_snapshots(older, newer, merged_transactions=[])
        (entry,) = merged.values()
        self.assertEqual(
            [
                (item["as_of"], item["status"], Decimal(item["amount"]))
                for item in entry["interest_accrual_snapshots"]
            ],
            [
                ("2026-06-26", "reported", Decimal("-6.5")),
                ("2026-09-17", "reported", Decimal("0")),
            ],
        )
        # Normalizing the persisted evidence again is stable.
        renormalized = _normalize_broker_snapshots({"broker_snapshots": merged})
        self.assertEqual(
            next(iter(renormalized.values()))["interest_accrual_snapshots"],
            entry["interest_accrual_snapshots"],
        )

    def test_same_date_disagreement_withholds_the_boundary(self) -> None:
        first = self._payload(
            "July 1, 2025 - June 26, 2026", NEGATIVE_ACCRUAL_ROWS, "33.125945525"
        )
        second_rows = [
            row.replace("-6.5", "-6.4") for row in NEGATIVE_ACCRUAL_ROWS
        ]
        second = self._payload(
            "January 1, 2026 - June 26, 2026", second_rows, "33.125945525"
        )
        merged = _merge_broker_snapshots(first, second, merged_transactions=[])
        (entry,) = merged.values()
        (boundary,) = entry["interest_accrual_snapshots"]
        self.assertEqual(boundary["status"], "conflict")
        self.assertEqual(boundary["amount"], "")
        self.assertEqual(len(boundary["evidence_ids"]), 2)

    def test_evidence_without_accrual_keeps_its_identity_shape(self) -> None:
        evidence = _normalize_broker_snapshot_evidence(
            {
                "broker": "ibkr",
                "account": SYNTHETIC_ACCOUNT,
                "snapshot_as_of": "2026-06-26",
                "position_snapshot": {"SYNTH": {"quantity": "1", "currency": "USD"}},
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_csv_open_positions",
            }
        )
        self.assertIsNotNone(evidence)
        self.assertNotIn("interest_accrual_snapshot", evidence)

    def test_non_ibkr_evidence_ignores_accrual_fields(self) -> None:
        evidence = _normalize_broker_snapshot_evidence(
            {
                "broker": "hsbc",
                "account": "000-000000-001",
                "position_snapshot": {"SYNTH": {"quantity": "1", "currency": "USD"}},
                "interest_accrual_snapshot": {
                    "status": "reported",
                    "as_of": "2026-06-26",
                    "currency": "USD",
                    "amount": "-6.5",
                },
            }
        )
        self.assertNotIn("interest_accrual_snapshot", evidence)


if __name__ == "__main__":
    unittest.main()
