"""
Tests for backtest page defaults and rendering.

Code version: v0.5.1
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from tests.factories.market import (
    FakeStrategy,
    backtest_result,
    market_frame,
    quote_profile_stub,
)


class BacktestPageTests(unittest.TestCase):
    @staticmethod
    def _leveraged_rotation_history(ticker: str) -> pd.DataFrame:
        closes_by_ticker = {
            "QQQ": [100.0, 105.0, 94.0, 95.0, 110.0, 115.0],
            "TQQQ": [50.0, 55.0, 45.0, 50.0, 60.0, 65.0],
        }
        closes = closes_by_ticker[ticker]
        return pd.DataFrame({
            "Date": pd.date_range("2026-01-01", periods=len(closes), freq="D"),
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Dividends": [0.0] * len(closes),
        })

    def test_backtest_page_uses_default_ticker_when_query_is_missing(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("No ticker selected for backtest.", html)
        self.assertIn('value="QQQ"', html)
        self.assertIn("/api/market-store/logos/QQQ.png", html)
        self.assertIn(
            'class="report-card workspace-article-card workspace-summary-card"',
            html,
        )
        self.assertIn(
            '<article class="report-card workspace-content-card trade-performance-card backtest-trade-performance-card">',
            html,
        )
        self.assertIn('data-share-drawer="backtest"', html)
        self.assertIn('id="export_transactions_button"', html)
        self.assertIn('aria-label="Export Transactions"', html)

    def test_backtest_page_serializes_logo_profile_for_selected_ticker(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?ticker=TQQQ&strategy=buy-and-hold&period=1y&capital=10000")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('value="TQQQ"', html)
        self.assertIn("/api/market-store/logos/TQQQ.png", html)

    def test_backtest_page_limits_intraday_period_options_to_available_history(self) -> None:
        def _fetch_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            **_kwargs: object,
        ) -> pd.DataFrame:
            del ticker, include_dividends
            return market_frame("DRAM", intraday=True) if interval == "1m" else market_frame("QQQ").tail(1)

        with (
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result(intraday=True)),
            patch("app.web.runtime.record_strategy_usage"),
            patch(
                "app.web.runtime.list_available_market_intervals",
                return_value=["1d", "1m"],
            ),
            patch(
                "app.web.runtime.build_supported_periods_for_history_store",
                return_value=["1d"],
            ),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?ticker=DRAM&strategy=buy-and-hold&period=1w&interval=1m&capital=10000")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('<option value="1d" selected>', html)
        self.assertNotIn('<option value="1w"', html)
        self.assertIn('"backtestPeriodOptions"', html)
        self.assertIn('"1m": ["1d"]', html)

    def test_leveraged_rotation_uses_two_strategy_defaults_and_renders_asset_trades(self) -> None:
        def fetch_rotation_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            **_kwargs: object,
        ) -> pd.DataFrame:
            del include_dividends, interval
            return self._leveraged_rotation_history(ticker)

        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_rotation_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
            patch("app.web.runtime.build_supported_periods_for_history_store", return_value=["1y"]),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?strategy=leveraged-rotation&drawdown_pct=10"
                "&period=1y&capital=10000"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('data-strategy-required-tickers="2"', html)
        self.assertIn('id="ticker_1" name="ticker"', html)
        self.assertIn('id="ticker_2" name="ticker"', html)
        self.assertIn('value="QQQ"', html)
        self.assertIn('value="TQQQ"', html)
        self.assertIn('name="drawdown_pct"', html)
        self.assertIn('<th>Ticker</th>', html)
        self.assertIn('"multi_asset": true', html)

    def test_leveraged_rotation_strategy_fields_api_exposes_ticker_contract(self) -> None:
        client = create_app().test_client()
        response = client.get("/api/trade-strategy-fields?strategy=leveraged-rotation")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["required_tickers"], 2)
        self.assertEqual(payload["default_tickers"], ["QQQ", "TQQQ"])
        self.assertTrue(payload["supports"]["multi_ticker"])
        self.assertIn('name="drawdown_pct"', payload["html"])

    def test_leveraged_rotation_export_identifies_each_trade_ticker(self) -> None:
        def fetch_rotation_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            **_kwargs: object,
        ) -> pd.DataFrame:
            del include_dividends, interval
            return self._leveraged_rotation_history(ticker)

        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_rotation_history),
            patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
        ):
            client = create_app().test_client()
            response = client.get(
                "/api/export-transactions?strategy=leveraged-rotation&drawdown_pct=10"
                "&period=1y&capital=10000"
            )

        report = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("## Backtest Report: QQQ / TQQQ", report)
        self.assertIn("| No. | Date | Ticker | Side | Price | Shares | P&L | Cash | Equity |", report)
        self.assertIn("| QQQ |", report)
        self.assertIn("| TQQQ |", report)


if __name__ == "__main__":
    unittest.main()
