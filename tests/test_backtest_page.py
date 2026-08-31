"""
Tests for backtest page defaults and rendering.

Code version: v0.8.0
"""

from __future__ import annotations

from html.parser import HTMLParser
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from app import create_app
from app.core.config import COMPARE_PERIODS_1D
from app.core.language_settings import LanguageSettings, translate_labels
from app.web.runtime import (
    _load_strategy_market_datasets,
    _resolve_strategy_provider_end,
)
from strategies.algorithms.strategy_bayesian_price_field import BayesianPriceFieldStrategy
from strategies.base import StrategySignalResult
from strategies.loader import list_enabled_strategies
from tests.factories.market import (
    FakeStrategy,
    backtest_result,
    fetch_history_stub,
    market_frame,
    ohlc_frame_for_dates,
    quote_profile_stub,
)


class _InputAttributesParser(HTMLParser):
    """Capture one input element by its exact id."""

    def __init__(self, element_id: str) -> None:
        super().__init__()
        self.element_id = element_id
        self.attributes: dict[str, str | None] | None = None

    def handle_starttag(
            self,
            tag: str,
            attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag != "input" or self.attributes is not None:
            return
        attributes = dict(attrs)
        if attributes.get("id") == self.element_id:
            self.attributes = attributes


def _input_attributes_by_id(html: str, element_id: str) -> dict[str, str | None]:
    parser = _InputAttributesParser(element_id)
    parser.feed(html)
    if parser.attributes is None:
        raise AssertionError(f"Input #{element_id} was not rendered.")
    return parser.attributes


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
            '<article class="report-card workspace-content-card trade-performance-card investment-report-card backtest-trade-performance-card" data-layout-role="result-container">',
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
        self.assertIn("Allow algorithmic stop-loss exits", html)
        self.assertIn('id="show_trade_details" name="show_trade_details" type="checkbox" value="1" checked', html)
        self.assertIn("Show trade details", html)
        self.assertLess(html.index('data-backtest-trade-details-field'), html.index('data-trade-strategy-field'))
        self.assertIn('data-trade-details-visible="true"', html)
        self.assertNotIn('id="backtest_history_transactions" name="backtest_history_view_tab" type="radio" value="transactions" data-backtest-history-transactions disabled', html)
        self.assertIn(
            'title="Allow strategy sell or cover signals to close a position when the exit price '
            'represents a loss relative to the entry price. This price-only check excludes dividends '
            'and total return. '
            'This setting does not add a separate fixed-price stop."',
            html,
        )
        self.assertTrue(run_backtest.call_args.kwargs["stop_loss_enabled"])

    def test_backtest_trade_details_switch_can_hide_equity_and_transactions(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold"
                "&show_trade_details=0"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("checked", _input_attributes_by_id(html, "show_trade_details"))
        self.assertIn('data-trade-details-visible="false"', html)
        self.assertIn('class="trade-chart-stack is-trade-details-hidden"', html)
        self.assertIn('data-backtest-equity-panel', html)
        self.assertIn('hidden aria-hidden="true"', html)
        self.assertIn('id="backtest_history_metrics" name="backtest_history_view_tab" type="radio" value="metrics" checked', html)
        transactions_attributes = _input_attributes_by_id(html, "backtest_history_transactions")
        self.assertIn("disabled", transactions_attributes)
        self.assertIn("data-backtest-history-transactions", transactions_attributes)
        self.assertIn('data-backtest-history-transactions-option aria-disabled="true"', html)
        self.assertLess(html.index('data-backtest-trade-details-field'), html.index('data-trade-strategy-field'))

    def test_bayesian_realized_cell_score_is_rendered_as_a_percentage_metric(self) -> None:
        result = backtest_result()
        result["summary"]["probability_field_hit_rate_pct"] = 42.5
        with (
            patch("app.web.runtime.fetch_history", return_value=market_frame("QQQ")),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=result),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("Bayesian realized-cell score", html)
        self.assertIn('data-backtest-metric="probability-field-realized-cell-score"', html)
        self.assertIn(">42.50%</span>", html)

    def test_backtest_stop_loss_copy_has_default_chinese_translations(self) -> None:
        labels = {
            "backtest_stop_loss": "Allow algorithmic stop-loss exits",
            "backtest_stop_loss_help": (
                "Allow strategy sell or cover signals to close a position when the exit price "
                "represents a loss relative to the entry price. This price-only check excludes "
                "dividends and total return. "
                "This setting does not add a separate fixed-price stop."
            ),
            "backtest_show_trade_details": "Show trade details",
        }

        traditional = translate_labels(
            labels,
            LanguageSettings(language="zh_hant_hk"),
        )
        simplified = translate_labels(
            labels,
            LanguageSettings(language="zh_hans_cn"),
        )

        self.assertEqual(traditional["backtest_stop_loss"], "允許演算法止損")
        self.assertEqual(simplified["backtest_stop_loss"], "允许算法止损")
        self.assertEqual(traditional["backtest_show_trade_details"], "顯示交易詳情")
        self.assertEqual(simplified["backtest_show_trade_details"], "显示交易详情")
        self.assertEqual(
            traditional["backtest_stop_loss_help"],
            "允許策略的賣出或回補訊號在出場價格相對入場價格構成價格虧損時平倉。"
            "此判斷僅比較價格，不包含股息或總回報。此設定不會新增獨立的固定價格止損。",
        )
        self.assertEqual(
            simplified["backtest_stop_loss_help"],
            "允许策略的卖出或回补信号在退出价格相对入场价格构成价格亏损时平仓。"
            "此判断仅比较价格，不包含股息或总回报。此设置不会添加单独的固定价格止损。",
        )

    def test_strategy_owned_loader_none_fails_closed_without_generic_fallback(self) -> None:
        strategy = FakeStrategy()
        strategy.strategy_market_data_source = "longbridge-cli"
        strategy.load_market_datasets = Mock(return_value=None)
        with (
            patch("app.web.runtime.fetch_history") as generic_fetch,
            patch("app.web.runtime.instantiate_strategy", return_value=strategy),
            patch("app.web.runtime.run_single_ticker_backtest") as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y"
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "Unable to load this workspace. Check your local data and try again.",
            response.get_data(as_text=True),
        )
        strategy.load_market_datasets.assert_called_once()
        generic_fetch.assert_not_called()
        run_backtest.assert_not_called()

    def test_relative_strategy_provider_end_uses_the_ticker_market_date(self) -> None:
        hong_kong_morning = pd.Timestamp("2026-08-28 09:30:00", tz="Asia/Hong_Kong")

        resolved = _resolve_strategy_provider_end("700.HK", hong_kong_morning)

        self.assertEqual(resolved, pd.Timestamp("2026-08-28"))
        self.assertEqual(
            hong_kong_morning.tz_convert("America/New_York").date().isoformat(),
            "2026-08-27",
        )

    def test_strategy_owned_loader_source_mismatch_fails_closed(self) -> None:
        strategy = FakeStrategy()
        strategy.strategy_market_data_source = "longbridge-cli"
        mismatched_dataset = market_frame("QQQ")
        mismatched_dataset.attrs["market_data_source"] = "yfinance"
        strategy.load_market_datasets = Mock(return_value=[mismatched_dataset])
        with (
            patch("app.web.runtime.fetch_history") as generic_fetch,
            patch("app.web.runtime.instantiate_strategy", return_value=strategy),
            patch("app.web.runtime.run_single_ticker_backtest") as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y"
            )

        self.assertEqual(response.status_code, 200)
        strategy.load_market_datasets.assert_called_once()
        generic_fetch.assert_not_called()
        run_backtest.assert_not_called()

    def test_strategy_owned_loader_rejects_empty_or_incomplete_datasets(self) -> None:
        provider_start = pd.Timestamp("2026-01-01")
        provider_end = pd.Timestamp("2026-08-29")
        invalid_datasets = (
            (pd.DataFrame(columns=["Date", "Close"]), "non-empty DataFrame"),
            (
                pd.DataFrame({"Date": pd.to_datetime(["2026-08-28"])}),
                "missing Close",
            ),
        )
        for dataset, expected_error in invalid_datasets:
            dataset.attrs["market_data_source"] = "longbridge-cli"
            strategy = FakeStrategy()
            strategy.strategy_market_data_source = "longbridge-cli"
            strategy.load_market_datasets = Mock(return_value=[dataset])
            with (
                self.subTest(expected_error=expected_error),
                self.assertRaisesRegex(ValueError, expected_error),
            ):
                _load_strategy_market_datasets(
                    strategy,
                    ["QQQ"],
                    interval="1d",
                    start=provider_start,
                    end=provider_end,
                    params={},
                )

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
        self.assertIn('<input type="hidden" name="stop_loss" value="0">', html)
        self.assertIn("Allow algorithmic stop-loss exits", html)
        stop_loss_attributes = _input_attributes_by_id(html, "stop_loss")
        self.assertEqual(stop_loss_attributes.get("type"), "checkbox")
        self.assertEqual(stop_loss_attributes.get("name"), "stop_loss")
        self.assertEqual(stop_loss_attributes.get("value"), "1")
        self.assertNotIn("checked", stop_loss_attributes)

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

    def test_bayesian_one_minute_execution_keeps_daily_model_and_uses_smart_max_period(self) -> None:
        strategy = BayesianPriceFieldStrategy()
        daily_dataset = ohlc_frame_for_dates(
            "NVDA",
            ["2026-08-28", "2026-08-31", "2026-09-01"],
        )
        daily_dataset.attrs["market_data_source"] = "longbridge-cli"
        daily_signals = daily_dataset.copy()
        daily_signals["buy_signal"] = [True, False, False]
        daily_signals["sell_signal"] = [False, False, False]
        strategy.load_market_datasets = Mock(return_value=[daily_dataset])
        strategy.compute_signals = Mock(return_value=StrategySignalResult(
            frame=daily_signals,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
            presentation={"schema": "bayesian-price-field/v1"},
        ))
        intraday_dataset = ohlc_frame_for_dates(
            "NVDA",
            [
                "2026-08-28 15:58",
                "2026-08-28 15:59",
                "2026-08-31 15:58",
                "2026-08-31 15:59",
                "2026-09-01 15:58",
                "2026-09-01 15:59",
            ],
        )

        with (
            patch(
                "app.web.runtime.load_local_one_minute_history",
                return_value=intraday_dataset,
            ) as load_local_history,
            patch("app.web.runtime.fetch_history") as fetch_history,
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.instantiate_strategy", return_value=strategy),
            patch(
                "app.web.runtime.ensure_latest_backtest_intraday_cache",
                return_value={
                    "ticker": "NVDA",
                    "intraday_refreshed": False,
                    "intraday_error": "rate limited",
                },
            ) as refresh_intraday,
            patch(
                "app.web.runtime.list_available_market_intervals",
                return_value=["1d", "1m"],
            ),
            patch(
                "app.web.runtime.build_supported_periods_for_history_store",
                return_value=["1d", "3d", "1w", "1mo", "3mo", "max"],
            ),
            patch(
                "app.web.runtime.run_single_ticker_backtest",
                return_value=backtest_result(intraday=True),
            ) as run_backtest,
            patch("app.web.runtime.record_strategy_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/backtest?ticker=NVDA&strategy=bayesian-price-field"
                "&period=1y&interval=1m&capital=10000"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('<option value="max" selected>', html)
        self.assertIn('id="backtest_interval_1m"', html)
        self.assertIn('id="backtest_interval_1m" name="interval" type="radio" value="1m" checked', html)
        self.assertIn(
            "Daily Bayesian model; the probability field is available at 1d.",
            html,
        )
        self.assertIn(
            "Could not refresh the latest 1m cache automatically, so the "
            "backtest reused the newest local intraday data when available.",
            html,
        )
        strategy.load_market_datasets.assert_called_once()
        self.assertEqual(
            strategy.load_market_datasets.call_args.kwargs["interval"],
            "1d",
        )
        strategy.compute_signals.assert_called_once()
        model_input, model_params = strategy.compute_signals.call_args.args
        pd.testing.assert_frame_equal(
            model_input.reset_index(drop=True),
            daily_dataset.reset_index(drop=True),
        )
        self.assertTrue(
            model_input["Date"].eq(model_input["Date"].dt.normalize()).all()
        )
        self.assertEqual(model_params, strategy.normalize_params({}))
        refresh_intraday.assert_called_once_with("NVDA")
        load_local_history.assert_called_once_with("NVDA")
        fetch_history.assert_not_called()
        bridged_result = run_backtest.call_args.args[0]
        self.assertEqual(bridged_result.presentation, {})
        self.assertEqual(bridged_result.metadata["model_interval"], "1d")
        self.assertEqual(bridged_result.metadata["execution_interval"], "1m")
        self.assertEqual(
            bridged_result.frame.loc[
                bridged_result.frame["buy_signal"],
                "Date",
            ].tolist(),
            [pd.Timestamp("2026-08-28 15:59")],
        )

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
        self.assertEqual(payload["supports"]["execution_intervals"], ["1d", "1m"])
        self.assertIn('name="drawdown_pct"', payload["html"])

    def test_every_enabled_strategy_starts_with_its_default_parameters(self) -> None:
        client = create_app().test_client()
        bayesian_dataset = fetch_history_stub("AAPL", False)
        bayesian_dataset.attrs["market_data_source"] = "longbridge-cli"
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
                patch(
                    "strategies.algorithms.strategy_bayesian_price_field."
                    "BayesianPriceFieldStrategy.load_market_datasets",
                    return_value=[bayesian_dataset],
                ),
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
        self.assertEqual(payload["supports"]["execution_intervals"], ["1d"])
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
