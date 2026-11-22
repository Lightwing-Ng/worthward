"""Regression coverage for HSBC USD cash-only refreshes.

Code version: v1.0.0
"""

from copy import deepcopy
from decimal import Decimal
import unittest
from unittest.mock import patch

from app.services.investment_import import (
    build_investment_payload_from_hsbc_pasted_text,
    merge_investment_payloads,
)
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin,
)


class HSBCUSDCashRefreshTests(InvestmentImportFixtureMixin, unittest.TestCase):
    @patch(
        "app.services.investment.importing.brokers.hsbc.core.HSBC_EXPECTED_ACCOUNT_NUMBER",
        "000-999999-999",
    )
    @patch(
        "app.services.investment.importing.brokers.hsbc.reconciliation.HSBC_EXPECTED_ACCOUNT_NUMBER",
        "000-999999-999",
    )
    def test_hsbc_usd_cash_only_keeps_available_balance_with_pending_orders(
        self,
    ) -> None:
        portfolio, order_status, _ = self._synthetic_hsbc_paste_snapshot(
            portfolio_updated_date="10 Jul 2026",
            order_status_end_date="2026-07-11",
        )
        order_status = order_status.replace("14 Jul 2026", "10 Jul 2026").replace(
            "S-1", "S-900001"
        )
        order_rows = order_status.split("All Order Status\n", 1)[1]
        order_status += "\n" + order_rows.replace("Sell", "Buy").replace(
            "S-900001", "P-900002"
        )

        def cash_page(ledger: str, available: str, *new_rows: str) -> str:
            return "\n".join(
                (
                    "USD Savings",
                    "Account number:",
                    "000-999999-999000-999999-999",
                    "Ledger balance:",
                    f"{ledger} USD",
                    "Available balance:",
                    f"{available} USD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    *new_rows,
                    "10 Jul 2026\nDEPOSIT\n1,000.00\n1,000.00",
                    "Download",
                )
            )

        older_cash = cash_page("1,000.00", "480.00")
        hkd_cash = self._synthetic_hsbc_hkd_cash_page(
            balance="20.00", post_date="09 Jul 2026"
        ).replace("Available balance:\n20.00", "Available balance:\n10.00")
        existing = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio,
            order_status_text=order_status,
            cash_account_text=f"{older_cash}\n{hkd_cash}",
        )
        self.assertEqual(existing["summary"]["hsbc_pending_settlement_order_count"], 2)
        incoming = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_page(
                "1,136.00",
                "530.00",
                "11 Jul 2026\nNET- NB9000000001\n75.00\n1,136.00",
                "10 Jul 2026\nREF S900001001 SEC\n61.00\n1,061.00",
            ),
        )
        stale = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=older_cash,
        )

        merged = merge_investment_payloads(deepcopy(existing), deepcopy(incoming))
        for payload in (
            merged,
            merge_investment_payloads(deepcopy(merged), deepcopy(incoming)),
            merge_investment_payloads(deepcopy(merged), stale),
        ):
            summary = payload["broker_summaries"]["hsbc"]
            self.assertEqual(payload["position_snapshot"], existing["position_snapshot"])
            self.assertEqual(summary["cash_ledger_balance"], "1136.00")
            self.assertEqual(summary["cash_ledger_balance_as_of"], "2026-07-11")
            self.assertEqual(summary["cash_snapshot_as_of"], "2026-07-11")
            self.assertEqual(summary["hsbc_bank_available_cash"], "530.00")
            self.assertEqual(
                summary["hsbc_available_cash_by_currency"],
                {"USD": "530.00", "HKD": "10.00"},
            )
            self.assertEqual(
                summary["hsbc_available_cash_components"],
                {"USD:SAVINGS": "530.00", "HKD:SAVINGS": "10.00"},
            )
            self.assertEqual(
                summary["ending_cash_by_currency"],
                {"USD": "1136.00", "HKD": "20.00"},
            )
            self.assertEqual(summary["hsbc_pending_settlement_order_count"], 1)
            self.assertEqual(
                Decimal(summary["hsbc_pending_settlement_cash"]), Decimal("-61.00")
            )
            self.assertEqual(
                Decimal(summary["hsbc_broker_cash_estimate"]), Decimal("1075.00")
            )

            orders = {
                row["type"]: row["source"]
                for row in payload["transactions"]
                if row["type"] in {"buy", "sell"}
            }
            self.assertTrue(orders["buy"]["cash_replay_pending_settlement"])
            self.assertNotIn("cash_replay_pending_settlement", orders["sell"])
            self.assertEqual(
                Decimal(orders["sell"]["cash_settlement_amount_raw"]),
                Decimal("61.00"),
            )
            credits = [
                row["net_amount_raw"]
                for row in payload["transactions"]
                if row["description"] == "NET- NB9000000001"
            ]
            self.assertEqual(credits, ["75.00"])
