"""
Tests for backtest page defaults and rendering.

Code version: v0.5.12
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.core.config import COMPARE_PERIODS_1D
from strategies.loader import list_enabled_strategies
from tests.factories.market import (
    FakeStrategy,
    backtest_result,
    fetch_history_stub,
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
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()) as run_backtest,
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
            '<article class="report-card workspace-content-card trade-performance-card investment-report-card backtest-trade-performance-card">',
            html,
        )
        self.assertIn('data-share-drawer="backtest"', html)
        self.assertIn('id="export_transactions_button"', html)
        self.assertIn('aria-label="Export Transactions"', html)
        self.assertIn('id="backtest_section_resizer"', html)
        self.assertLess(html.index('id="backtest_section_resizer"'), html.index('id="backtest_history_surface"'))
        self.assertIn('id="backtest_history_view_segmented"', html)
        self.assertNotIn('id="backtest_view_segmented"', html)
        self.assertNotIn('<p class="chart-heading">Transaction details</p>', html)
        self.assertIn('id="stop_loss" name="stop_loss" type="checkbox" value="1"', html)
        self.assertIn('id="stop_loss" name="stop_loss" type="checkbox" value="1" checked', html)
        self.assertTrue(run_backtest.call_args.kwargs["stop_loss_enabled"])

    def test_backtest_history_xpath_target_owns_scrollable_table_shell(self) -> None:
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
        shell_start = html.index('<div id="backtest_history_table_wrap"')
        shell_end = html.index(">", shell_start)
        shell_tag = html[shell_start:shell_end]
        self.assertIn("investment-stock-details-table-host", shell_tag)
        self.assertIn("scrollable-data-table-shell", shell_tag)
        self.assertIn("local-store-pagination-host", shell_tag)
        self.assertIn("backtest-history-table-shell", shell_tag)
        self.assertEqual(html.count('id="backtest_history_table_wrap"'), 1)

    def test_backtest_transaction_table_uses_the_shared_ten_column_contract(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ", intraday=True)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result(intraday=True)),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?ticker=QQQ&interval=1m")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        for label in [
            "No.",
            "Date time",
            "Side",
            "Price",
            "Quantity",
            "Realized P&amp;L",
            "Unrealized P&amp;L",
            "Cash",
            "Market value",
            "Equity",
        ]:
            self.assertIn(f'data-markdown-export-label="{label}">{label}</th>', html)

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

    def test_backtest_cache_distinguishes_legacy_tickers_values(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()) as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            first_response = client.get(
                "/workspaces/backtest?tickers=QQQ&strategy=buy-and-hold&period=1y"
            )
            second_response = client.get(
                "/workspaces/backtest?tickers=AAPL&strategy=buy-and-hold&period=1y"
            )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(run_backtest.call_count, 2)

    def test_backtest_cache_normalizes_ticker_and_legacy_tickers_aliases(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()) as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            first_response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y"
            )
            second_response = client.get(
                "/workspaces/backtest?tickers=QQQ.US&strategy=buy-and-hold&period=1y"
            )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(run_backtest.call_count, 1)

    def test_backtest_cache_includes_execution_mode(self) -> None:
        execution_mode = ["signal_close"]
        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()) as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
            patch("app.web.runtime.load_backtest_execution_mode", side_effect=lambda: execution_mode[0]),
        ):
            client = create_app().test_client()
            first_response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y"
            )
            execution_mode[0] = "next_open"
            second_response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y"
            )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(run_backtest.call_count, 2)

    def test_backtest_page_passes_disabled_stop_loss_to_every_strategy_run(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()) as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?stop_loss=0")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(run_backtest.call_args.kwargs["stop_loss_enabled"])
        self.assertNotIn(
            'id="stop_loss" name="stop_loss" type="checkbox" value="1"\n                       checked',
            html,
        )

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

    def test_backtest_page_uses_shared_comparison_period_options_for_daily_interval(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&interval=1d")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        period_options = html.split('id="period"', 1)[1].split("</select>", 1)[0]
        self.assertEqual(
            [
                period
                for period in COMPARE_PERIODS_1D
                if f'value="{period}"' in period_options
            ],
            list(COMPARE_PERIODS_1D),
        )

    def test_market_store_presence_uses_shared_daily_period_options(self) -> None:
        with (
            patch("app.web.runtime.build_supported_periods_for_history_store", return_value=["6mo", "1y", "max"]),
            patch("app.web.runtime.has_recent_one_minute_store", return_value=False),
        ):
            client = create_app().test_client()
            response = client.get("/api/market-store/presence?ticker=QQQ")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["periodOptions"]["QQQ"]["1d"],
            list(COMPARE_PERIODS_1D),
        )

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
        self.assertIn('data-markdown-export-label="Ticker">Ticker</th>', html)
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

    def test_every_enabled_strategy_starts_with_its_default_parameters(self) -> None:
        client = create_app().test_client()
        for strategy in list_enabled_strategies():
            strategy_id = str(strategy["id"])
            if strategy_id == "dca":
                continue
            with (
                self.subTest(strategy=strategy_id),
                patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
                patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
                patch("app.web.runtime.record_strategy_usage"),
            ):
                response = client.get(
                    f"/workspaces/backtest?period=6mo&strategy={strategy_id}"
                )

            html = response.get_data(as_text=True)
            self.assertEqual(response.status_code, 200)
            self.assertIn('id="backtest_view_surface"', html)
            self.assertIn('id="backtest_history_table_wrap"', html)

    def test_dca_is_rendered_as_a_backtest_strategy(self) -> None:
        dates = pd.date_range("2025-01-01", periods=420, freq="B")
        dca_history = pd.DataFrame({
            "Date": dates,
            "Close": [100.0 + (index * 0.1) for index in range(len(dates))],
        })
        with (
            patch("app.web.runtime.fetch_history", return_value=dca_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.ensure_latest_daily_caches", return_value=[]),
            patch("app.web.runtime.list_available_market_intervals", return_value=["1d"]),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=dca&period=1y"
                "&amount=500&frequency=monthly&month_day=15&stop_loss=0"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('id="backtest_view_surface"', html)
        self.assertIn('<option value="dca"', html)
        self.assertIn('aria-label="Tune strategy parameters"', html)
        self.assertNotIn('is-dca-inline', html)
        self.assertIn('name="amount"', html)
        self.assertIn('name="frequency"', html)
        self.assertIn('dca-transactions-shell', html)
        self.assertIn('Amount per period', html)
        self.assertIn('id="stop_loss" name="stop_loss" type="checkbox" value="1"', html)
        self.assertNotIn(
            'id="stop_loss" name="stop_loss" type="checkbox" value="1" checked',
            html,
        )

    def test_legacy_dca_route_redirects_to_backtest_strategy(self) -> None:
        client = create_app().test_client()
        response = client.get(
            "/workspaces/dca?ticker=QQQ&range=3y&amount=500"
            "&frequency=weekly&weekday=4&month_day=15"
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response.headers["Location"],
            "/workspaces/backtest?ticker=QQQ&range=3y&amount=500"
            "&frequency=weekly&weekday=4&month_day=15&strategy=dca",
        )

    def test_dca_strategy_fields_api_uses_registry_parameters(self) -> None:
        client = create_app().test_client()
        response = client.get("/api/trade-strategy-fields?strategy=dca")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["is_tunable"])
        self.assertEqual(payload["required_tickers"], 1)
        self.assertIn('name="amount"', payload["html"])
        self.assertIn('name="frequency"', payload["html"])

    def test_dca_export_uses_recurring_investment_columns(self) -> None:
        dates = pd.date_range("2025-01-01", periods=420, freq="B")
        dca_history = pd.DataFrame({
            "Date": dates,
            "Close": [100.0 + (index * 0.1) for index in range(len(dates))],
        })
        with (
            patch("app.web.runtime.fetch_history", return_value=dca_history),
            patch("app.web.runtime.ensure_latest_daily_caches", return_value=[]),
        ):
            client = create_app().test_client()
            response = client.get(
                "/api/export-transactions?strategy=dca&ticker=QQQ&period=1y"
                "&amount=500&frequency=monthly&month_day=15"
            )

        report = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("## DCA Backtest Report: QQQ", report)
        self.assertIn(
            "| No. | Date time | Side | Price | Quantity | Realized P&L | Unrealized P&L | Cash | Market value | Equity |",
            report,
        )
        self.assertIn("- **Amount per period**: $500.00", report)

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
        self.assertIn(
            "| No. | Date time | Ticker | Side | Price | Quantity | Realized P&L | Unrealized P&L | Cash | Market value | Equity |",
            report,
        )
        self.assertIn("| QQQ |", report)
        self.assertIn("| TQQQ |", report)


if __name__ == "__main__":
    unittest.main()
