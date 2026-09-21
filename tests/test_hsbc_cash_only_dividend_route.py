"""HSBC cash-only dividend route integration coverage.

Code version: v0.1.0
"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.infrastructure.storage import (
    INVESTMENT_STORE_PATH as REAL_INVESTMENT_STORE_PATH,
    investment_evidence_dir_for,
    load_investment_store_payload,
    save_investment_store_payload,
)
import app.services.investment_import as investment_import_service
from app.web.request_security import (
    INVESTMENT_CSRF_HEADER,
    INVESTMENT_CSRF_SESSION_KEY,
)


class HsbcCashOnlyDividendRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._investment_temp_dir = TemporaryDirectory()
        temp_root = Path(self._investment_temp_dir.name)
        self.investment_store_path = temp_root / "investment.parquet"
        self.investment_cache_path = (
            temp_root / "investment_cache" / "transactions_payload.json"
        )
        self._investment_store_patch = patch(
            "app.web.runtime.INVESTMENT_STORE_PATH",
            self.investment_store_path,
        )
        self._investment_cache_patch = patch(
            "app.web.runtime.INVESTMENT_TRANSACTIONS_CACHE_PATH",
            self.investment_cache_path,
        )
        self._private_evidence_patch = patch.object(
            investment_import_service,
            "_load_local_private_investment_evidence",
            return_value={},
        )
        self._investment_store_patch.start()
        self._investment_cache_patch.start()
        self._private_evidence_patch.start()
        self.addCleanup(self._private_evidence_patch.stop)
        self.addCleanup(self._investment_cache_patch.stop)
        self.addCleanup(self._investment_store_patch.stop)
        self.addCleanup(self._investment_temp_dir.cleanup)

    @staticmethod
    def _cash_page() -> str:
        return "\n".join(
            [
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "9.00 USD",
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

    @staticmethod
    def _post_import(client, cash_page: str):
        origin = "http://localhost"
        client.get("/trade/investment", base_url=origin)
        with client.session_transaction() as browser_session:
            csrf_token = browser_session[INVESTMENT_CSRF_SESSION_KEY]
        return client.post(
            "/api/investment/transactions",
            base_url=origin,
            headers={
                "Origin": origin,
                "Sec-Fetch-Site": "same-origin",
                INVESTMENT_CSRF_HEADER: csrf_token,
            },
            data={
                "broker": "hsbc",
                "hsbc_import_mode": "paste",
                "hsbc_cash_account_text": cash_page,
                "hsbc_portfolio_text": "",
                "hsbc_order_status_text": "",
            },
            content_type="multipart/form-data",
        )

    def test_cash_only_dividend_is_attributed_and_reimported_idempotently(
        self,
    ) -> None:
        account = "000-999999-999"
        save_investment_store_payload(
            {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": account,
                "summary": {},
                "position_snapshot": {},
                "transactions": [
                    {
                        "date": "2026-06-30",
                        "datetime": "2026-06-30 20:00:00",
                        "type": "buy",
                        "ticker": "QQQI",
                        "currency": "USD",
                        "description": "QQQI synthetic order",
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
                            "statement_order_id": "P-100001",
                            "order_id": "P-100001",
                            "broker": "hsbc",
                            "account": account,
                        },
                    }
                ],
            },
            self.investment_store_path,
        )
        real_store_before = (
            REAL_INVESTMENT_STORE_PATH.read_bytes()
            if REAL_INVESTMENT_STORE_PATH.exists()
            else None
        )
        client = create_app().test_client()
        with TemporaryDirectory() as market_temp_dir:
            history_path = Path(market_temp_dir) / "QQQI.parquet"
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-07-01"]),
                    "Dividends": [1.0],
                }
            ).to_parquet(history_path, index=False)
            with (
                patch(
                    "app.web.runtime.history_store_path_for",
                    return_value=history_path,
                ),
                patch("app.web.runtime.threading.Thread"),
            ):
                responses = [
                    self._post_import(client, self._cash_page()) for _ in range(2)
                ]

        self.assertEqual([response.status_code for response in responses], [200, 200])
        persisted = load_investment_store_payload(self.investment_store_path)
        dividends = [
            record
            for record in persisted["transactions"]
            if record.get("description") == "CORP EVT PAYMENT SEC"
        ]
        self.assertEqual(len(dividends), 1)
        self.assertEqual(dividends[0]["ticker"], "QQQI")
        self.assertEqual(
            dividends[0]["source"]["dividend_attribution_context"],
            "existing_hsbc_ledger",
        )
        self.assertEqual(
            persisted["summary"]["incremental_import"]["added_record_count"],
            0,
        )
        self.assertEqual(
            persisted["summary"]["incremental_import"][
                "attributed_hsbc_cash_only_dividend_count"
            ],
            0,
        )
        self.assertEqual(len(persisted["source_artifacts"]), 1)
        artifact = persisted["source_artifacts"][0]
        self.assertNotIn("content_base64", artifact)
        evidence_path = (
            investment_evidence_dir_for(self.investment_store_path)
            / f"{artifact['storage_key']}.bin"
        )
        self.assertTrue(evidence_path.exists())
        self.assertEqual(
            REAL_INVESTMENT_STORE_PATH.read_bytes()
            if REAL_INVESTMENT_STORE_PATH.exists()
            else None,
            real_store_before,
        )


if __name__ == "__main__":
    unittest.main()
