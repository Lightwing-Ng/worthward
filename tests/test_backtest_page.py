"""
Tests for backtest page defaults and rendering.

Code version: v0.3.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.models.schemas import QuoteProfile


class _FakeStrategy:
    def compute_signals(self, dataset: pd.DataFrame, params: dict[str, object]) -> pd.DataFrame:
        del params
        return dataset

    def get_parameter_definitions(self) -> list[object]:
        return []

    def normalize_params(self, values: dict[str, object]) -> dict[str, object]:
        return values


def _fake_backtest_dataset() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Date": pd.to_datetime(["2026-03-26", "2026-03-27"]),
            "Close": [100.0, 101.0],
            "Open": [99.5, 100.5],
            "High": [100.5, 101.5],
            "Low": [99.0, 100.0],
        }
    )


def _fake_quote_profile(ticker: str, force_refresh: bool, namespace: str = "primary") -> QuoteProfile:
    del force_refresh, namespace
    return QuoteProfile(
        ticker=ticker,
        company_name=ticker,
        logo_url=f"/api/market-store/logos/{ticker}.png",
    )


def _fake_backtest_result() -> dict[str, object]:
    return {
        "summary": {
            "initial_capital": 10000.0,
            "final_equity": 10100.0,
            "net_return_pct": 1.0,
            "total_trades": 1,
            "win_rate_pct": 100.0,
            "beat_bh_pct": 100.0,
            "benchmark_alpha": 10.0,
            "long_gain": 10.0,
            "short_gain": 0.0,
            "long_loss": 0.0,
        },
        "chart": {
            "dates": ["2026-03-26", "2026-03-27"],
            "raw_dates": ["2026-03-26", "2026-03-27"],
            "close": [100.0, 101.0],
            "open": [99.5, 100.5],
            "high": [100.5, 101.5],
            "low": [99.0, 100.0],
            "equity": [10000.0, 10100.0],
        },
        "trades": [],
        "interval": "1d",
    }


class BacktestPageTests(unittest.TestCase):
    def test_backtest_page_uses_default_ticker_when_query_is_missing(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=_fake_backtest_dataset()),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.instantiate_strategy", return_value=_FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=_fake_backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/backtest")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("No ticker selected for backtest.", html)
        self.assertIn('value="QQQ"', html)
        self.assertIn("/api/market-store/logos/QQQ.png", html)

    def test_backtest_page_serializes_logo_profile_for_selected_ticker(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=_fake_backtest_dataset()),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.instantiate_strategy", return_value=_FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=_fake_backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/backtest?ticker=TQQQ&strategy=buy-and-hold&period=1y&capital=10000")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('value="TQQQ"', html)
        self.assertIn("/api/market-store/logos/TQQQ.png", html)


if __name__ == "__main__":
    unittest.main()
