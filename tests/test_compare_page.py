"""
Tests for compare page ticker control rendering.

Code version: v0.10.3
"""

from __future__ import annotations

from html import unescape
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.models.schemas import SeriesPayload
from tests.factories.market import close_frame_for_ticker, ohlc_frame_for_dates, quote_profile_stub


def _write_intraday_stores(frames_by_ticker: dict[str, pd.DataFrame]) -> tempfile.TemporaryDirectory[str]:
    tempdir = tempfile.TemporaryDirectory()
    root = Path(tempdir.name)
    for ticker, frame in frames_by_ticker.items():
        frame.to_parquet(root / f"{ticker}.parquet", index=False)
    return tempdir


class ComparePageTests(unittest.TestCase):
    def test_price_page_overnight_adds_canonical_skhynix_companion(self) -> None:
        intraday_frames = {
            "000660.KS": ohlc_frame_for_dates(
                "000660.KS",
                ["2026-07-12 20:00", "2026-07-13 02:30"],
            ),
            "7709.HK": ohlc_frame_for_dates(
                "7709.HK",
                ["2026-07-12 21:30", "2026-07-13 03:59"],
            ),
            "SKHY": ohlc_frame_for_dates(
                "SKHY",
                ["2026-07-12 20:00", "2026-07-13 04:00", "2026-07-13 19:55"],
            ),
        }
        def fetch_history_for_test(ticker: str, *_args, interval: str = "1d", **_kwargs) -> pd.DataFrame:
            if interval == "1m":
                return intraday_frames[ticker]
            return close_frame_for_ticker(ticker)

        with _write_intraday_stores(intraday_frames) as tempdir:
            with (
                patch(
                    "app.web.runtime.intraday_history_store_path_for",
                    side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet",
                ),
                patch("app.web.runtime.has_compare_overnight_market_data_source", return_value=True),
                patch(
                    "app.web.runtime.fetch_compare_one_day_overnight_history",
                    return_value=intraday_frames["SKHY"],
                ) as broker_overnight_mock,
                patch("app.web.runtime.refresh_recent_one_minute_store_with_yfinance") as refresh_intraday_mock,
                patch("app.web.runtime.refresh_one_minute_store") as refresh_target_mock,
                patch("app.web.runtime.fetch_one_minute_history_for_trading_date") as exact_day_fetch_mock,
                patch("app.web.runtime.fetch_history", side_effect=fetch_history_for_test),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                response = create_app().test_client().get(
                    "/workspaces/prices?ticker=000660.KS&ticker=7709.HK&range=exact&period=1d"
                    "&trading_date=2026-07-13&overnight=1"
                )

        html = response.get_data(as_text=True)
        ticker_inputs = re.findall(r'<input[^>]+name="ticker"[^>]+value="([^"]*)"', html)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ticker_inputs, ["000660.KS", "7709.HK"])
        self.assertIn('id="include_overnight_hours" name="overnight" type="checkbox" value="1" checked', html)
        self.assertIn('data-overnight-source-policy="longbridge"', html)
        self.assertIn(">Overnight</span>", html)
        self.assertNotIn("US overnight companion", html)
        self.assertIn('data-ticker="SKHY"', html)
        self.assertNotIn("SKHYV", html)
        self.assertIn('"2026-07-12 20:00"', html)
        self.assertIn('"2026-07-13 04:00"', html)
        self.assertIn('"2026-07-13 19:55"', html)
        refresh_intraday_mock.assert_not_called()
        refresh_target_mock.assert_not_called()
        exact_day_fetch_mock.assert_not_called()
        broker_overnight_mock.assert_called_once_with(
            "SKHY",
            trading_date="2026-07-13",
        )

    def test_live_compare_api_reports_yfinance_overnight_fallback_source(self) -> None:
        intraday_frames = {
            "000660.KS": ohlc_frame_for_dates(
                "000660.KS",
                ["2026-07-13 20:00", "2026-07-14 02:30"],
            ),
            "7709.HK": ohlc_frame_for_dates(
                "7709.HK",
                ["2026-07-13 21:30", "2026-07-14 03:59"],
            ),
            "SKHY": ohlc_frame_for_dates(
                "SKHY",
                ["2026-07-13 20:00", "2026-07-14 04:40"],
            ),
        }
        intraday_frames["SKHY"].attrs["market_data_source"] = "yfinance_extended"
        intraday_frames["SKHY"].attrs["provider_ticker"] = "SKHYV"

        def fetch_history_for_test(ticker: str, *_args, interval: str = "1d", **_kwargs) -> pd.DataFrame:
            if interval == "1m":
                return intraday_frames[ticker]
            return close_frame_for_ticker(ticker)

        with _write_intraday_stores(intraday_frames) as tempdir:
            with (
                patch(
                    "app.web.runtime.intraday_history_store_path_for",
                    side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet",
                ),
                patch("app.web.runtime.has_compare_overnight_market_data_source", return_value=True),
                patch(
                    "app.web.runtime.fetch_compare_one_day_overnight_history",
                    return_value=intraday_frames["SKHY"],
                ),
                patch("app.web.runtime.fetch_history", side_effect=fetch_history_for_test),
                patch("app.web.runtime.refresh_one_minute_store"),
            ):
                response = create_app().test_client().get(
                    "/api/compare/live?ticker=000660.KS&ticker=7709.HK&period=1d"
                    "&axis_date=2026-07-14&live_date=2026-07-14&overnight=1&refresh=0"
                )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["sources"]["SKHY"], "yfinance_extended")
        self.assertNotIn("SKHYV", payload["sources"])
        skhy_series = next(item for item in payload["series"] if item["ticker"] == "SKHY")
        self.assertEqual(skhy_series["raw_dates"][-1], "2026-07-14 04:40")

    def test_live_compare_api_uses_exact_yahoo_fallback_for_missing_korean_current_day(self) -> None:
        reference_frames = {
            "000660.KS": ohlc_frame_for_dates(
                "000660.KS",
                ["2026-07-15 00:00", "2026-07-15 02:00"],
            ),
            "7709.HK": ohlc_frame_for_dates(
                "7709.HK",
                ["2026-07-15 00:00", "2026-07-15 02:00"],
            ),
        }
        live_frames = {
            "000660.KS": ohlc_frame_for_dates(
                "000660.KS",
                ["2026-07-23 00:00", "2026-07-23 02:00"],
            ),
            "7709.HK": ohlc_frame_for_dates(
                "7709.HK",
                ["2026-07-23 00:00", "2026-07-23 02:00"],
            ),
        }
        for frame in live_frames.values():
            frame.attrs["market_data_source"] = "yahoo_chart_exact"

        def fetch_history_for_test(ticker: str, *_args: object, **_kwargs: object) -> pd.DataFrame:
            return reference_frames[ticker]

        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_for_test),
            patch(
                "app.web.runtime.fetch_one_minute_history_for_trading_date",
                side_effect=lambda ticker, *_args, **_kwargs: live_frames[ticker],
            ) as exact_day_fetch_mock,
        ):
            response = create_app().test_client().get(
                "/api/compare/live?ticker=000660.KS&ticker=7709.HK&period=1d"
                "&axis_date=2026-07-15&live_date=2026-07-23&refresh=0"
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["sources"]["000660.KS"], "yahoo_chart_exact")
        exact_day_fetch_mock.assert_called_once()
        self.assertEqual(exact_day_fetch_mock.call_args.args[0], "000660.KS")
        korean_series = next(item for item in payload["series"] if item["ticker"] == "000660.KS")
        self.assertTrue(any(value is not None for value in korean_series["prices"]))

    def test_one_day_price_page_keeps_new_us_listing_pending_before_first_quote(self) -> None:
        def _fetch_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            dividend_mode: str = "reinvest",
        ) -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                raise AssertionError("Relative 1d should use the local 1m store.")
            return close_frame_for_ticker(ticker)

        current_us_day = pd.Timestamp.now(tz="America/New_York").strftime("%Y-%m-%d")
        established = pd.DataFrame(
            {
                "Date": pd.to_datetime([f"{current_us_day} 09:30", f"{current_us_day} 15:59"]),
                "Open": [100.0, 101.0],
                "High": [101.0, 102.0],
                "Low": [99.0, 100.0],
                "Close": [100.5, 101.5],
            }
        )
        with _write_intraday_stores({"QQQ": established}) as tempdir:
            with (
                patch(
                    "app.web.runtime.intraday_history_store_path_for",
                    side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet",
                ),
                patch("app.web.runtime.refresh_one_minute_store"),
                patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                response = create_app().test_client().get(
                    "/workspaces/prices?ticker=QQQ&ticker=SKHYV&period=1d"
                )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("do not share", html)
        self.assertIn('"ticker": "SKHYV"', html)
        self.assertIn('"prices": [null', html)
        self.assertIn('data-ticker="SKHYV"', html)

    def test_six_month_compare_keeps_established_history_before_new_listing(self) -> None:
        def _fetch_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            dividend_mode: str = "reinvest",
        ) -> pd.DataFrame:
            del include_dividends, interval, dividend_mode
            if ticker == "SNDK":
                return pd.DataFrame(
                    {
                        "Date": pd.to_datetime(["2026-06-16", "2026-07-10"]),
                        "Close": [50.0, 48.0],
                    }
                )
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-01-10", "2026-06-16", "2026-07-10"]),
                    "Close": [100.0, 110.0, 105.0],
                }
            )

        with (
            patch("app.web.runtime.ensure_latest_daily_caches", return_value=[]),
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            response = create_app().test_client().get(
                "/workspaces/compare?ticker=DRAM&ticker=MU&ticker=STX&ticker=SNDK&period=6mo"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("10 Jan 2026 - 10 Jul 2026", html)
        self.assertIn('value="6mo" selected', html)

    def test_compare_page_renders_logo_markup_for_selected_tickers(self) -> None:
        with (
            patch(
                "app.web.runtime.fetch_history",
                side_effect=lambda ticker, include_dividends, interval="1d", dividend_mode="reinvest": close_frame_for_ticker(ticker),
            ),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y&dividends=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('value="QQQ"', html)
        self.assertIn('value="AAPL"', html)
        self.assertIn("/api/market-store/logos/QQQ.png", html)
        self.assertIn("/api/market-store/logos/AAPL.png", html)
        self.assertIn("QQQ Holdings", html)
        self.assertIn("AAPL Holdings", html)
        self.assertIn('data-price-only-field', html)
        self.assertNotIn('data-price-only-field hidden', html)
        self.assertIn('id="price_only" name="price_only" type="checkbox" value="1" ', html)
        self.assertNotIn('id="price_only" name="price_only" type="checkbox" value="1"  disabled', html)
        self.assertIn('data-dividend-reinvest-field', html)
        self.assertNotIn('id="include_dividends" name="dividends" type="checkbox" value="1"  disabled', html)
        self.assertIn('id="compare_summary_date_range"', html)
        self.assertIn('class="compare-summary-date-range"', html)
        self.assertNotIn("TTM yield", html)
        self.assertIn('data-workspace-mask="compare-ttm-dividend-yield"', html)
        self.assertIn('id="workspace_share_drawer_tickers"', html)
        self.assertIn('data-share-drawer="tickers"', html)
        self.assertIn('id="share_capture_button"', html)
        self.assertIn('id="export_transactions_button"', html)
        self.assertIn('class="investment-share-actions"', html)
        self.assertIn('id="share_mask_button"', html)

    def test_compare_page_keeps_periods_available_before_newer_listing(self) -> None:
        def _fetch_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            dividend_mode: str = "reinvest",
        ) -> pd.DataFrame:
            del include_dividends, interval, dividend_mode
            if ticker == "JEPQ":
                return pd.DataFrame(
                    {
                        "Date": pd.to_datetime(["2024-08-01", "2026-03-27"]),
                        "Close": [50.0, 55.0],
                    }
                )
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2020-03-27", "2024-08-01", "2026-03-27"]),
                    "Close": [100.0, 110.0, 120.0],
                }
            )

        with (
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=5y&dividends=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('<option value="6mo"', html)
        self.assertIn('<option value="1y"', html)
        self.assertIn('<option value="2y"', html)
        self.assertIn('<option value="3y"', html)
        self.assertIn('<option value="5y" selected', html)
        self.assertIn('<option value="max"', html)
        self.assertNotIn('<option value="10y"', html)
        self.assertNotIn("Using the latest available start date among the selected tickers", html)

    def test_compare_page_includes_five_year_option_when_shared_history_allows(self) -> None:
        def _fetch_history(
            ticker: str,
            include_dividends: bool,
            interval: str = "1d",
            dividend_mode: str = "reinvest",
        ) -> pd.DataFrame:
            del include_dividends, interval, dividend_mode
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2018-01-01", "2026-03-27"]),
                    "Close": [100.0, 150.0],
                }
            )

        with (
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=SPY&period=max&dividends=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('<option value="5y"', html)
        self.assertIn('<option value="max"', html)
        self.assertNotIn('<option value="10y"', html)

    def test_compare_page_keeps_rendered_and_effective_period_in_sync(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2018-01-01", "2026-03-27"]),
                "Close": [100.0, 150.0],
            }
        )

        with (
            patch("app.web.runtime.fetch_history", return_value=dataset),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=SPY&period=10y&dividends=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('<option value="10y"', html)
        self.assertIn('<option value="max" selected', html)
        self.assertIn("Requested period 10 years exceeds the available trading history", html)

    def test_compare_page_defaults_one_day_compare_to_extended_hours(self) -> None:
        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                raise AssertionError("Relative 1d should use local 1m store.")
            return close_frame_for_ticker(ticker)

        def _intraday_frame(ticker: str) -> pd.DataFrame:
            base = 100.0 if ticker == "QQQ" else 200.0
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-27 08:00",
                        "2026-03-27 09:30",
                        "2026-03-27 15:59",
                        "2026-03-27 16:30",
                    ]),
                    "Close": [base, base + 1.0, base + 2.0, base + 3.0],
                }
            )

        with _write_intraday_stores({"QQQ": _intraday_frame("QQQ"), "TQQQ": _intraday_frame("TQQQ")}) as tempdir:
            with (
                patch("app.web.runtime.intraday_history_store_path_for", side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet"),
                patch("app.web.runtime.fetch_compare_one_day_extended_history", side_effect=AssertionError("Relative 1d should use local 1m store.")),
                patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                client = create_app().test_client()
                response = client.get("/workspaces/compare?ticker=QQQ&ticker=TQQQ&period=1d")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('"raw_dates": ["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"]', html)
        self.assertNotIn('id="include_extended_hours"', html)
        self.assertIn('data-price-only-field hidden', html)
        self.assertIn('id="price_only" name="price_only" type="checkbox" value="1"  disabled', html)
        self.assertIn('data-dividend-reinvest-field hidden', html)
        self.assertIn('id="include_dividends" name="dividends" type="checkbox" value="1"  disabled', html)

    def test_compare_page_legacy_extended_hours_query_keeps_automatic_behavior(self) -> None:
        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                raise AssertionError("Relative 1d should use local 1m store.")
            return close_frame_for_ticker(ticker)

        def _intraday_frame(ticker: str) -> pd.DataFrame:
            base = 100.0 if ticker == "QQQ" else 200.0
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-27 08:00",
                        "2026-03-27 09:30",
                        "2026-03-27 15:59",
                        "2026-03-27 16:30",
                    ]),
                    "Close": [base, base + 1.0, base + 2.0, base + 3.0],
                }
            )

        with _write_intraday_stores({"QQQ": _intraday_frame("QQQ"), "TQQQ": _intraday_frame("TQQQ")}) as tempdir:
            with (
                patch("app.web.runtime.intraday_history_store_path_for", side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet"),
                patch("app.web.runtime.fetch_compare_one_day_extended_history", side_effect=AssertionError("Relative 1d should use local 1m store.")),
                patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                client = create_app().test_client()
                response = client.get("/workspaces/compare?ticker=QQQ&ticker=TQQQ&period=1d&extended_hours=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('"raw_dates": ["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"]', html)
        self.assertNotIn('id="include_extended_hours"', html)

    def test_compare_page_one_day_uses_previous_complete_intraday_day(self) -> None:
        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                raise AssertionError("Relative 1d should use local 1m store.")
            return close_frame_for_ticker(ticker)

        def _intraday_frame(ticker: str) -> pd.DataFrame:
            base = 100.0 if ticker == "QQQ" else 200.0
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-26 08:00",
                        "2026-03-26 09:30",
                        "2026-03-26 15:59",
                        "2026-03-26 16:30",
                        "2026-03-27 08:00",
                        "2026-03-27 09:30",
                    ]),
                    "Close": [base, base + 1.0, base + 2.0, base + 3.0, base + 4.0, base + 5.0],
                }
            )

        with _write_intraday_stores({"QQQ": _intraday_frame("QQQ"), "TQQQ": _intraday_frame("TQQQ")}) as tempdir:
            with (
                patch("app.web.runtime.intraday_history_store_path_for", side_effect=lambda ticker, interval="1m": Path(tempdir) / f"{ticker}.parquet"),
                patch("app.web.runtime.fetch_compare_one_day_extended_history", side_effect=AssertionError("Relative 1d should use local 1m store.")),
                patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                client = create_app().test_client()
                response = client.get("/workspaces/compare?ticker=QQQ&ticker=TQQQ&period=1d&extended_hours=1")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('"raw_dates": ["2026-03-26 08:00", "2026-03-26 09:30", "2026-03-26 15:59", "2026-03-26 16:30"]', html)
        self.assertNotIn("2026-03-27 09:30", html)

    def test_compare_page_one_day_refreshes_missing_intraday_store(self) -> None:
        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                raise AssertionError("Relative 1d should read the refreshed local 1m store.")
            return close_frame_for_ticker(ticker)

        def _intraday_frame(ticker: str) -> pd.DataFrame:
            base = 100.0 if ticker == "QQQ" else 200.0
            return pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-27 09:30",
                        "2026-03-27 15:59",
                    ]),
                    "Close": [base, base + 2.0],
                }
            )

        with _write_intraday_stores({"QQQ": _intraday_frame("QQQ")}) as tempdir:
            temp_root = Path(tempdir)

            def _store_path(ticker: str, interval: str = "1m") -> Path:
                del interval
                return temp_root / f"{ticker}.parquet"

            def _refresh_missing_store(ticker: str):
                _intraday_frame(ticker).to_parquet(_store_path(ticker), index=False)
                return object()

            with (
                patch("app.web.runtime.intraday_history_store_path_for", side_effect=_store_path),
                patch("app.web.runtime.refresh_one_minute_store", side_effect=_refresh_missing_store) as refresh_mock,
                patch("app.web.runtime.fetch_compare_one_day_extended_history", side_effect=AssertionError("Relative 1d should use local 1m store.")),
                patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
                patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
                patch("app.web.runtime.record_ticker_usage"),
            ):
                client = create_app().test_client()
                response = client.get("/workspaces/compare?ticker=QQQ&ticker=TQQQ&period=1d")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_mock.call_count, 1)
        self.assertIn('"raw_dates": ["2026-03-27 09:30", "2026-03-27 15:59"]', html)

    def test_compare_page_exact_one_day_uses_single_trading_date_picker(self) -> None:
        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            if interval == "1m":
                base = 100.0 if ticker == "QQQ" else 200.0
                return pd.DataFrame(
                    {
                        "Date": pd.to_datetime([
                            "2026-03-27 08:00",
                            "2026-03-27 09:30",
                            "2026-03-27 15:59",
                            "2026-03-27 16:30",
                        ]),
                        "Close": [base, base + 1.0, base + 2.0, base + 3.0],
                    }
                )
            return close_frame_for_ticker(ticker)

        with (
            patch(
                "app.web.runtime.fetch_compare_one_day_extended_history",
                side_effect=lambda ticker, **_kwargs: _fetch_history(
                    ticker,
                    False,
                    interval="1m",
                    dividend_mode="price",
                ),
            ),
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=TQQQ&period=1d&range=exact&trading_date=2026-03-27")

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('data-exact-single-date-grid', html)
        self.assertIn('id="exact_trading_date" name="trading_date" type="hidden" value="2026-03-27"', html)
        self.assertIn('id="exact_start" name="from" type="hidden" value="2026-03-27" disabled', html)
        self.assertIn(
            '"raw_dates": ["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"]',
            html,
        )

    def test_compare_page_exact_short_range_uses_intraday_curve(self) -> None:
        daily_dates = pd.to_datetime(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"])

        def _fetch_history(ticker: str, include_dividends: bool, interval: str = "1d", dividend_mode: str = "reinvest") -> pd.DataFrame:
            del include_dividends, dividend_mode
            base = 100.0 if ticker == "QQQ" else 200.0
            if interval == "1m":
                intraday_dates = []
                intraday_closes = []
                for day_index, trading_day in enumerate(daily_dates):
                    for minute_index, clock in enumerate(("08:00", "09:30", "15:59", "16:30")):
                        intraday_dates.append(pd.Timestamp(f"{trading_day.strftime('%Y-%m-%d')} {clock}"))
                        intraday_closes.append(base + (day_index * 10.0) + minute_index)
                return pd.DataFrame({"Date": pd.to_datetime(intraday_dates), "Close": intraday_closes})
            return pd.DataFrame(
                {
                    "Date": daily_dates,
                    "Close": [base, base + 1.0, base + 2.0, base + 3.0],
                }
            )

        with (
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get(
                "/workspaces/compare?ticker=QQQ&ticker=TQQQ&range=exact&period=1w&from=2026-06-29&to=2026-07-02"
            )

        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        state_match = re.search(
            r'<script id="antigravity_state" type="application/json">(.*?)</script>',
            html,
            re.DOTALL,
        )
        self.assertIsNotNone(state_match)
        state = json.loads(unescape(state_match.group(1)))
        series = state["chart"]["series"]
        self.assertEqual(len(series), 2)
        for item in series:
            raw_dates = item["raw_dates"]
            self.assertEqual(len(raw_dates), 4 * 390)
            self.assertEqual(raw_dates[0], "2026-06-29 09:30")
            self.assertEqual(raw_dates[-1], "2026-07-02 15:59")
            for trading_day in ("2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"):
                self.assertEqual(
                    sum(value.startswith(trading_day) for value in raw_dates),
                    390,
                )

    def test_market_cap_exact_historical_short_range_uses_daily_history(self) -> None:
        daily_dates = pd.to_datetime([
            "2021-07-13",
            "2021-07-14",
            "2021-07-15",
            "2021-07-16",
            "2021-07-19",
        ])
        requested_intervals: list[str] = []

        def _fetch_history(
                ticker: str,
                include_dividends: bool,
                interval: str = "1d",
                dividend_mode: str = "reinvest",
        ) -> pd.DataFrame:
            del include_dividends, dividend_mode
            requested_intervals.append(interval)
            base = 100.0 if ticker == "AAPL" else 200.0
            if interval == "1m":
                return pd.DataFrame({
                    "Date": pd.Series(dtype="datetime64[ns]"),
                    "Close": pd.Series(dtype=float),
                })
            return pd.DataFrame({
                "Date": daily_dates,
                "Close": [base + offset for offset in range(len(daily_dates))],
            })

        def _build_market_cap_series(
                ticker: str,
                dataset: pd.DataFrame,
                *,
                color: str | None = None,
                **_kwargs,
        ) -> SeriesPayload:
            raw_dates = pd.to_datetime(dataset["Date"]).dt.strftime("%Y-%m-%d %H:%M").tolist()
            return SeriesPayload(
                ticker=ticker,
                dates=pd.to_datetime(dataset["Date"]).dt.strftime("%-d %b %Y").tolist(),
                raw_dates=raw_dates,
                normalized_returns=[0.0] * len(raw_dates),
                color=color,
                prices=dataset["Close"].astype(float).tolist(),
                market_caps=[float(value) * 1_000_000.0 for value in dataset["Close"]],
            )

        with (
            patch("app.web.runtime.ensure_latest_daily_caches", return_value=[]),
            patch("app.web.runtime.fetch_history", side_effect=_fetch_history),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
            patch("app.web.runtime.build_market_cap_series_payload", side_effect=_build_market_cap_series),
        ):
            response = create_app().test_client().get(
                "/workspaces/market-caps?ticker=AAPL&ticker=NVDA&ticker=MSFT"
                "&range=exact&period=5y&from=2021-07-13&to=2021-07-19"
            )

        html = response.get_data(as_text=True)
        state_match = re.search(
            r'<script id="antigravity_state" type="application/json">(.*?)</script>',
            html,
            re.DOTALL,
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("intraday comparison data", html)
        self.assertNotIn("1m", requested_intervals)
        self.assertIsNotNone(state_match)
        state = json.loads(unescape(state_match.group(1)))
        self.assertEqual(
            state["chart"]["series"][0]["raw_dates"],
            [
                "2021-07-13 00:00",
                "2021-07-14 00:00",
                "2021-07-15 00:00",
                "2021-07-16 00:00",
                "2021-07-19 00:00",
            ],
        )


if __name__ == "__main__":
    unittest.main()
