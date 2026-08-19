"""Runtime client-error redaction regression tests.

Code version: v1.0.0
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import create_app
from app.web import runtime
from tests.factories.market import quote_profile_stub


class RuntimeClientErrorRedactionTests(unittest.TestCase):
    def test_unexpected_live_order_error_hides_sensitive_details_and_logs_them(self) -> None:
        configured_token = "runtime-error-redaction-token-32chars"
        diagnostic = "/Users/example/private/order-token=secret-value"
        client = create_app().test_client()

        with (
            patch.dict(
                os.environ,
                {"ANTIGRAVITY_LIVE_TRADING_TOKEN": configured_token},
                clear=False,
            ),
            patch(
                "app.web.runtime.submit_longbridge_limit_order",
                side_effect=RuntimeError(diagnostic),
            ),
            self.assertLogs("app.web.runtime", level="ERROR") as logged,
        ):
            response = client.post(
                "/api/live-trading/orders",
                headers={"X-Antigravity-Live-Trading-Token": configured_token},
                json={
                    "ticker": "TSLA.US",
                    "side": "buy",
                    "price": "250.00",
                    "quantity": "1",
                },
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            payload,
            {
                "success": False,
                "error": "The live order could not be submitted. Try again later.",
            },
        )
        self.assertNotIn(diagnostic, response.get_data(as_text=True))
        self.assertNotIn("secret-value", response.get_data(as_text=True))
        self.assertTrue(any(diagnostic in entry for entry in logged.output))

    def test_price_history_failure_hides_raw_local_store_diagnostic(self) -> None:
        diagnostic = "/Users/example/private/prices.parquet token=secret-value"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            investment_store_path = root / "investment.json"
            investment_store_path.write_text(
                json.dumps(
                    {
                        "transactions": [
                            {
                                "date": "2026-06-01",
                                "ticker": "AAPL",
                                "type": "buy",
                                "quantity": 1,
                                "price": 200,
                                "amount": -200,
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            price_history_path = root / "prices-token=secret-value.parquet"
            price_history_path.write_bytes(b"not-a-parquet-file")

            with (
                patch.object(runtime, "INVESTMENT_STORE_PATH", investment_store_path),
                patch.object(
                    runtime,
                    "history_store_path_for",
                    return_value=price_history_path,
                ),
                patch.object(runtime.pd, "read_parquet", side_effect=RuntimeError(diagnostic)),
                patch.object(runtime, "ensure_latest_investment_daily_caches", return_value=[]),
                patch.object(runtime, "fetch_quote_profile", quote_profile_stub),
                patch.object(runtime, "load_profile_record", return_value=None),
                patch.object(runtime, "has_logo_asset", return_value=False),
                patch.object(runtime, "fetch_longbridge_realtime_quotes", return_value=[]),
                patch.object(runtime, "fetch_yfinance_realtime_quotes", return_value=[]),
                self.assertLogs("app.web.runtime", level="ERROR") as logged,
            ):
                response = create_app().test_client().get("/api/investment/transactions")

        payload = response.get_json()
        failure = next(
            item
            for item in payload["price_history_failures"]
            if item["ticker"] == "AAPL"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(failure["reason"], "read_failed")
        self.assertEqual(
            failure["message"],
            "Could not read local market history for AAPL.",
        )
        self.assertNotIn(diagnostic, response.get_data(as_text=True))
        self.assertNotIn("secret-value", response.get_data(as_text=True))
        self.assertTrue(any(diagnostic in entry for entry in logged.output))


if __name__ == "__main__":
    unittest.main()
