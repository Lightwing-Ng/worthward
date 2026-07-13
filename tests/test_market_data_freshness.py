"""
Tests for daily market data freshness safeguards.

Code version: v0.4.0
"""

from __future__ import annotations

import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.infrastructure.broker_market_data import (
    _is_market_data_fresh,
    classify_daily_store_status,
    classify_one_minute_store_status,
)
from app.infrastructure.storage import history_store_path_for, intraday_history_store_path_for
from app.services.market_data import (
    _download_daily_history_with_fallback,
    classify_hk_equity_session,
    classify_kr_equity_session,
    classify_us_equity_session,
    download_full_history,
    ensure_fresh_history_store,
    infer_ticker_market,
    refresh_history_store,
)
from app.models.schemas import QuoteProfile
from tests.factories.market import market_frame


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


class MarketSessionClassificationTests(unittest.TestCase):
    def test_infer_ticker_market_detects_hong_kong_symbols(self) -> None:
        self.assertEqual(infer_ticker_market("2800.HK"), "HK")
        self.assertEqual(infer_ticker_market("000660.KS"), "KR")
        self.assertEqual(infer_ticker_market("DRAM"), "US")

    def test_classify_hk_equity_session_maps_regular_hours(self) -> None:
        self.assertEqual(classify_hk_equity_session("2026-06-25 10:15"), "intraday")
        self.assertEqual(classify_hk_equity_session("2026-06-25 14:30"), "intraday")
        self.assertEqual(classify_hk_equity_session("2026-06-25 12:30"), "off")
        self.assertEqual(classify_hk_equity_session("2026-06-25 08:30"), "off")

    def test_classify_kr_equity_session_maps_regular_hours(self) -> None:
        self.assertEqual(classify_kr_equity_session("2026-06-25 09:00"), "intraday")
        self.assertEqual(classify_kr_equity_session("2026-06-25 15:29"), "intraday")
        self.assertEqual(classify_kr_equity_session("2026-06-25 15:30"), "off")
        self.assertEqual(classify_kr_equity_session("2026-06-25 08:59"), "off")


class UsEquitySessionClassificationTests(unittest.TestCase):
    def test_classify_us_equity_session_maps_extended_hours(self) -> None:
        self.assertEqual(classify_us_equity_session("2026-06-25 08:15"), "pre")
        self.assertEqual(classify_us_equity_session("2026-06-25 10:00"), "intraday")
        self.assertEqual(classify_us_equity_session("2026-06-25 17:30"), "post")
        self.assertEqual(classify_us_equity_session("2026-06-25 03:30"), "off")
        self.assertEqual(classify_us_equity_session("2026-06-25 20:15"), "off")


class MarketDataFreshnessTests(unittest.TestCase):
    def _with_replaced_store(self, path: Path, dataset: pd.DataFrame, callback) -> None:
        original_exists = path.exists()
        original_bytes = path.read_bytes() if original_exists else None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            dataset.to_parquet(path, index=False)
            callback()
        finally:
            if original_exists and original_bytes is not None:
                path.write_bytes(original_bytes)
            elif path.exists():
                path.unlink()

    def test_market_data_freshness_accepts_last_preholiday_trading_day(self) -> None:
        is_fresh = _is_market_data_fresh(
            pd.Timestamp("2026-04-02 16:00:00"),
            now=pd.Timestamp("2026-04-04 20:00:00+08:00"),
        )

        self.assertTrue(is_fresh)

    def test_classify_daily_store_status_marks_new_listing_short_history_as_short_history(self) -> None:
        path = history_store_path_for("DRAM")
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-15", "2026-06-30"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status() -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_daily_store_status("DRAM")

            self.assertEqual(status, "short_history")

        self._with_replaced_store(path, dataset, assert_status)

    def test_classify_daily_store_status_does_not_mark_older_incomplete_history_as_new(self) -> None:
        path = history_store_path_for("DRAM")
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-02", "2026-06-30"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status() -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_daily_store_status("DRAM")

            self.assertEqual(status, "missing")

        self._with_replaced_store(path, dataset, assert_status)

    def test_classify_one_minute_store_status_marks_new_listing_short_history_as_short_history(self) -> None:
        path = intraday_history_store_path_for("DRAM", "1m")
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-15 09:30", "2026-06-30 16:00"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status() -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_one_minute_store_status("DRAM")

            self.assertEqual(status, "short_history")

        self._with_replaced_store(path, dataset, assert_status)

    def test_classify_one_minute_store_status_does_not_mark_older_incomplete_history_as_new(self) -> None:
        path = intraday_history_store_path_for("DRAM", "1m")
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-02 09:30", "2026-06-30 16:00"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status() -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_one_minute_store_status("DRAM")

            self.assertEqual(status, "missing")

        self._with_replaced_store(path, dataset, assert_status)

    def test_classify_daily_store_status_marks_complete_history_as_fresh(self) -> None:
        with patch("app.infrastructure.broker_market_data.is_daily_store_complete", return_value=True):
            status = classify_daily_store_status("DRAM")

        self.assertEqual(status, "fresh")

    def test_classify_one_minute_store_status_marks_complete_history_as_fresh(self) -> None:
        with patch("app.infrastructure.broker_market_data.is_one_minute_store_complete", return_value=True):
            status = classify_one_minute_store_status("DRAM")

        self.assertEqual(status, "fresh")

    def test_refresh_history_store_skips_write_when_remote_has_no_newer_trading_day(self) -> None:
        path = history_store_path_for("QQQ")
        original_exists = path.exists()
        original_bytes = path.read_bytes() if original_exists else None

        existing_dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-01", "2026-04-02"]),
                "Open": [490.0, 495.0],
                "High": [491.0, 496.0],
                "Low": [489.0, 494.0],
                "Close": [490.5, 495.5],
                "Adj Close": [490.5, 495.5],
            }
        )
        overlapping_remote = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-01", "2026-04-02"]),
                "Open": [490.1, 495.1],
                "High": [491.1, 496.1],
                "Low": [489.1, 494.1],
                "Close": [490.6, 495.6],
                "Adj Close": [490.6, 495.6],
            }
        ).set_index("Date")

        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            existing_dataset.to_parquet(path, index=False)
            before_bytes = path.read_bytes()

            with patch("app.services.market_data.has_remote_market_access", return_value=True), \
                    patch("app.services.market_data._download_daily_history_with_yfinance", return_value=overlapping_remote):
                refreshed_path = refresh_history_store("QQQ")

            self.assertEqual(refreshed_path, path)
            self.assertEqual(path.read_bytes(), before_bytes)
            stored = pd.read_parquet(path).sort_values("Date").reset_index(drop=True)
            pd.testing.assert_frame_equal(stored, existing_dataset)
        finally:
            if original_exists and original_bytes is not None:
                path.write_bytes(original_bytes)
            elif path.exists():
                path.unlink()

    def test_download_full_history_serializes_concurrent_yfinance_requests(self) -> None:
        fake_history = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-01"]),
                "Open": [100.0],
                "High": [101.0],
                "Low": [99.0],
                "Close": [100.5],
                "Adj Close": [100.5],
            }
        ).set_index("Date")

        state_lock = threading.Lock()
        active_calls = 0
        max_active_calls = 0
        requested_tickers: list[str] = []

        def fake_download(*, tickers: str, **kwargs) -> pd.DataFrame:
            del kwargs
            nonlocal active_calls, max_active_calls
            with state_lock:
                active_calls += 1
                max_active_calls = max(max_active_calls, active_calls)
                requested_tickers.append(tickers)
            time.sleep(0.05)
            with state_lock:
                active_calls -= 1
            return fake_history.copy()

        with patch("app.services.market_data.yf.download", side_effect=fake_download):
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [
                    executor.submit(download_full_history, "QQQ"),
                    executor.submit(download_full_history, "AAPL"),
                ]
                for future in futures:
                    result = future.result()
                    self.assertFalse(result.empty)

        self.assertEqual(max_active_calls, 1)
        self.assertCountEqual(requested_tickers, ["QQQ", "AAPL"])

    def test_download_daily_history_with_fallback_steps_down_from_max_for_newly_listed_tickers(self) -> None:
        short_history = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-24"]),
                "Open": [27.41],
                "High": [33.11],
                "Low": [21.81],
                "Close": [23.79],
                "Adj Close": [23.79],
            }
        ).set_index("Date")

        def fake_download(*, tickers: str, period: str | None = None, **kwargs) -> pd.DataFrame:
            del tickers, kwargs
            if period == "max":
                raise ValueError("Period 'max' is invalid, must be one of: 1d, 5d")
            if period == "5d":
                return short_history.copy()
            return pd.DataFrame()

        with (
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
            patch("app.services.market_data.yf.download", side_effect=fake_download) as download_mock,
        ):
            dataset = _download_daily_history_with_fallback("RAM", period="max")

        self.assertFalse(dataset.empty)
        attempted_periods = [call.kwargs["period"] for call in download_mock.call_args_list]
        self.assertEqual(attempted_periods[:2], ["max", "5y"])

    def test_download_full_history_canonicalizes_share_class_symbol_for_yfinance(self) -> None:
        fake_history = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-01"]),
                "Open": [478.98],
                "High": [481.10],
                "Low": [477.25],
                "Close": [478.50],
                "Adj Close": [478.50],
            }
        ).set_index("Date")

        with patch("app.services.market_data.yf.download", return_value=fake_history) as download_mock:
            result = download_full_history("BRK B")

        self.assertFalse(result.empty)
        self.assertEqual(download_mock.call_args.kwargs["tickers"], "BRK-B")

    def test_download_full_intraday_history_uses_yfinance_without_longbridge(self) -> None:
        yfinance_history = market_frame("QQQ", intraday=True)

        with (
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
            patch("app.services.market_data._download_one_minute_history_with_longbridge") as longbridge_mock,
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                return_value=yfinance_history,
            ) as yfinance_mock,
        ):
            result = download_full_history("QQQ", interval="1m")

        pd.testing.assert_frame_equal(result, yfinance_history)
        longbridge_mock.assert_not_called()
        yfinance_mock.assert_called_once_with("QQQ", days=30)

    def test_download_full_intraday_history_falls_back_when_longbridge_fails(self) -> None:
        yfinance_history = market_frame("AAPL", intraday=True)

        with (
            patch("app.services.market_data._load_longbridge_market_settings", return_value=object()),
            patch(
                "app.services.market_data._download_one_minute_history_with_longbridge",
                side_effect=ConnectionError("Longbridge unavailable"),
            ) as longbridge_mock,
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                return_value=yfinance_history,
            ) as yfinance_mock,
            patch("app.services.market_data.sleep"),
        ):
            result = download_full_history("AAPL", interval="1m")

        pd.testing.assert_frame_equal(result, yfinance_history)
        self.assertEqual(longbridge_mock.call_count, 3)
        yfinance_mock.assert_called_once_with("AAPL", days=30)

    def test_ensure_fresh_history_store_refreshes_stale_daily_cache(self) -> None:
        with (
            patch("app.services.market_data.is_daily_store_fresh", return_value=False),
            patch("app.services.market_data.has_remote_market_access", return_value=True),
            patch("app.services.market_data.refresh_history_store") as refresh_mock,
        ):
            refreshed = ensure_fresh_history_store("QQQ")

        self.assertTrue(refreshed)
        refresh_mock.assert_called_once_with("QQQ")

    def test_ensure_fresh_history_store_normalizes_share_class_symbol(self) -> None:
        with (
            patch("app.services.market_data.is_daily_store_fresh", return_value=False),
            patch("app.services.market_data.has_remote_market_access", return_value=True),
            patch("app.services.market_data.refresh_history_store") as refresh_mock,
        ):
            refreshed = ensure_fresh_history_store("BRK B")

        self.assertTrue(refreshed)
        refresh_mock.assert_called_once_with("BRK-B")

    def test_compare_page_checks_each_selected_ticker_for_fresh_daily_cache(self) -> None:
        refresh_requests: list[list[str]] = []

        def fake_ensure_latest_daily_caches(tickers: list[str]) -> list[str]:
            refresh_requests.append(list(tickers))
            return []

        with (
            patch("app.web.runtime.ensure_latest_daily_caches", side_effect=fake_ensure_latest_daily_caches),
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d', **kwargs: _fake_dataset_for(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=AAPL&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_requests, [["QQQ", "AAPL"]])

    def test_intraday_price_page_does_not_block_on_daily_cache_refresh(self) -> None:
        with (
            patch("app.web.runtime.ensure_latest_daily_caches") as refresh_mock,
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval="1d", **kwargs: _fake_dataset_for(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            response = create_app().test_client().get(
                "/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d"
            )

        self.assertEqual(response.status_code, 200)
        refresh_mock.assert_not_called()

    def test_portfolio_page_uses_the_same_freshness_checks(self) -> None:
        refresh_requests: list[list[str]] = []

        def fake_ensure_latest_daily_caches(tickers: list[str]) -> list[str]:
            refresh_requests.append(list(tickers))
            return []

        with (
            patch("app.web.runtime.ensure_latest_daily_caches", side_effect=fake_ensure_latest_daily_caches),
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d', **kwargs: _fake_dataset_for(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=_fake_quote_profile),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_requests, [["QQQ", "AAPL"]])


if __name__ == "__main__":
    unittest.main()
