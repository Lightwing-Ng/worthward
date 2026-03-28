"""
Tests for daily market data freshness safeguards.

Code version: v1.1.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.services.market_data import ensure_fresh_history_store
from app.models.schemas import QuoteProfile


def _fake_dataset_for(ticker: str) -> pd.DataFrame:
    base = 100.0 if ticker == "QQQ" else 200.0 if ticker == "AAPL" else 300.0
    return pd.DataFrame(
        {
            "Date": pd.to_datetime(["2026-03-26", "2026-03-27"]),
            "Close": [base, base + 1.0],
        }
    )


def _fake_quote_profile(ticker: str, force_refresh: bool, namespace: str = "primary") -> QuoteProfile:
    del force_refresh, namespace
    return QuoteProfile(ticker=ticker, company_name=ticker, logo_url="")


class MarketDataFreshnessTests(unittest.TestCase):
    def test_ensure_fresh_history_store_refreshes_stale_daily_cache(self) -> None:
        with (
            patch("app.services.market_data.is_daily_store_fresh", return_value=False),
            patch("app.services.market_data.has_remote_market_access", return_value=True),
            patch("app.services.market_data.refresh_history_store") as refresh_mock,
        ):
            refreshed = ensure_fresh_history_store("QQQ")

        self.assertTrue(refreshed)
        refresh_mock.assert_called_once_with("QQQ")

    def test_compare_page_checks_each_selected_ticker_for_fresh_daily_cache(self) -> None:
        refresh_checks: list[str] = []

        def fake_ensure_fresh_history_store(ticker: str) -> bool:
            refresh_checks.append(ticker)
            return False

        with (
            patch("app.web.runtime.ensure_fresh_history_store", side_effect=fake_ensure_fresh_history_store),
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d': _fake_dataset_for(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/compare?ticker=QQQ&ticker=AAPL&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_checks, ["QQQ", "AAPL"])

    def test_portfolio_page_uses_the_same_freshness_checks(self) -> None:
        refresh_checks: list[str] = []

        def fake_ensure_fresh_history_store(ticker: str) -> bool:
            refresh_checks.append(ticker)
            return False

        with (
            patch("app.web.runtime.ensure_fresh_history_store", side_effect=fake_ensure_fresh_history_store),
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d': _fake_dataset_for(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_checks, ["QQQ", "AAPL"])


if __name__ == "__main__":
    unittest.main()
