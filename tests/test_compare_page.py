"""
Tests for compare page ticker control rendering.

Code version: v0.3.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.models.schemas import QuoteProfile


def _fake_compare_dataset(ticker: str) -> pd.DataFrame:
    base = 100.0 if ticker == "QQQ" else 200.0
    return pd.DataFrame(
        {
            "Date": pd.to_datetime(["2026-03-26", "2026-03-27"]),
            "Close": [base, base + 1.0],
        }
    )


def _fake_quote_profile(ticker: str, force_refresh: bool, namespace: str = "primary") -> QuoteProfile:
    del force_refresh, namespace
    return QuoteProfile(
        ticker=ticker,
        company_name=f"{ticker} Holdings",
        logo_url=f"/api/market-store/logos/{ticker}.png",
    )


class ComparePageTests(unittest.TestCase):
    def test_compare_page_renders_logo_markup_for_selected_tickers(self) -> None:
        with (
            patch("app.web.runtime.ensure_fresh_history_store", return_value=False),
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval="1d": _fake_compare_dataset(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/compare?ticker=QQQ&ticker=AAPL&period=1y&dividends=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('data-symbol="QQQ"', html)
        self.assertIn('data-logo-url="/api/market-store/logos/QQQ.png"', html)
        self.assertIn('data-company-name="QQQ Holdings"', html)
        self.assertIn('<img class="ticker-input-logo" alt="QQQ logo" src="/api/market-store/logos/QQQ.png">', html)
        self.assertIn('data-symbol="AAPL"', html)
        self.assertIn('data-logo-url="/api/market-store/logos/AAPL.png"', html)
        self.assertIn('<img class="ticker-input-logo" alt="AAPL logo" src="/api/market-store/logos/AAPL.png">', html)


if __name__ == "__main__":
    unittest.main()
