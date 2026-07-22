"""
Tests for daily market data freshness safeguards.

Code version: v0.18.1
"""

from __future__ import annotations

import logging
import threading
import time
import unittest
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from app import create_app
from app.core.broker_settings import BrokerSettings
from app.core.config import BASE_DIR, resolve_store_directory
from app.infrastructure.broker_market_data import (
    _is_market_data_fresh,
    classify_daily_store_status,
    classify_one_minute_store_status,
)
from app.infrastructure.connectivity import has_remote_market_access
from app.services.date_constraints import nyse_market_session_state
from app.services.market_data import (
    YfinanceDownloadError,
    _activate_yfinance_rate_limit_cooldown,
    _download_daily_history_with_yfinance,
    _download_daily_history_with_fallback,
    _reset_yfinance_rate_limit_backoff,
    classify_hk_equity_session,
    classify_kr_equity_session,
    classify_us_equity_session,
    download_full_history,
    fetch_compare_one_day_extended_history,
    ensure_fresh_history_store,
    fetch_compare_one_day_overnight_history,
    fetch_history,
    fetch_longbridge_realtime_quotes,
    fetch_yfinance_realtime_quotes,
    has_compare_overnight_market_data_source,
    infer_ticker_market,
    refresh_history_store,
    refresh_one_minute_store,
    resolve_compare_overnight_tickers,
    yfinance_lookup_symbol,
)
from tests.factories.market import close_frame_for_ticker, market_frame, ohlc_frame_for_dates, quote_profile_stub


class TickerSymbolBoundaryTests(unittest.TestCase):
    def test_yfinance_uses_provider_suffixes_only_for_its_outbound_lookup(self) -> None:
        self.assertEqual(yfinance_lookup_symbol("META.US"), "META")
        self.assertEqual(yfinance_lookup_symbol("600519.SH"), "600519.SS")
        self.assertEqual(yfinance_lookup_symbol("700.HK"), "0700.HK")
        self.assertEqual(yfinance_lookup_symbol("000001.SZ"), "000001.SZ")


class MarketSessionClassificationTests(unittest.TestCase):
    def test_infer_ticker_market_detects_hong_kong_symbols(self) -> None:
        self.assertEqual(infer_ticker_market("2800.HK"), "HK")
        self.assertEqual(infer_ticker_market("000660.KS"), "KR")
        self.assertEqual(infer_ticker_market("DRAM"), "US")

    def test_nyse_post_market_session_allows_realtime_quotes(self) -> None:
        session_state = nyse_market_session_state("2026-07-20T21:30:00Z")

        self.assertEqual(session_state["session"], "post")
        self.assertTrue(session_state["is_realtime_allowed"])

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
        self.assertEqual(classify_us_equity_session("2026-06-25 03:30"), "overnight")
        self.assertEqual(classify_us_equity_session("2026-06-25 20:15"), "overnight")
        self.assertEqual(classify_us_equity_session("2026-06-27 20:15"), "off")

    def test_resolve_compare_overnight_tickers_hides_temporary_skhynix_symbol(self) -> None:
        self.assertEqual(
            resolve_compare_overnight_tickers(["000660.KS", "7709.HK", "SKHYV"]),
            ["000660.KS", "7709.HK", "SKHY"],
        )

    def test_compare_overnight_switch_requires_true_overnight_provider(self) -> None:
        with (
            patch("app.services.market_data._load_compare_overnight_market_settings", return_value=None),
            patch("app.services.market_data.yf.download", create=True),
        ):
            self.assertFalse(has_compare_overnight_market_data_source())

    def test_compare_overnight_yfinance_fallback_hides_temporary_provider_symbol(self) -> None:
        provider_calls: list[str] = []
        raw_history = market_frame("SKHYV", intraday=True).set_index("Date")
        raw_history.index.name = "Datetime"

        def download_history(ticker: str, **_kwargs: object) -> pd.DataFrame:
            provider_calls.append(ticker)
            if ticker == "SKHY":
                raise ValueError("Permanent symbol is not live yet.")
            return raw_history

        with (
            patch("app.services.market_data._load_compare_overnight_market_settings", return_value=None),
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=download_history,
            ),
        ):
            result = fetch_compare_one_day_overnight_history("SKHYV")

        self.assertEqual(provider_calls, ["SKHY", "SKHYV"])
        self.assertEqual(result.attrs["market_data_source"], "yfinance_extended")
        self.assertEqual(result.attrs["provider_ticker"], "SKHYV")
        self.assertEqual(list(result.columns), ["Date", "Open", "High", "Low", "Close"])

    def test_compare_overnight_falls_back_to_yfinance_after_longbridge_failure(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        fallback = market_frame("SKHY", intraday=True)
        fallback.attrs["market_data_source"] = "yfinance_extended"
        fallback.attrs["provider_ticker"] = "SKHY"

        with (
            patch("app.services.market_data._load_compare_overnight_market_settings", return_value=settings),
            patch(
                "app.services.market_data.fetch_longbridge_compare_one_day_history",
                side_effect=ConnectionError("Longbridge is unavailable."),
            ),
            patch(
                "app.services.market_data._fetch_yfinance_compare_one_day_extended_history",
                return_value=fallback,
            ) as fallback_mock,
        ):
            result = fetch_compare_one_day_overnight_history("SKHY")

        fallback_mock.assert_called_once_with("SKHY", trading_date=None)
        self.assertEqual(result.attrs["market_data_source"], "yfinance_extended")

    def test_compare_extended_hours_fall_back_to_longbridge_without_overnight(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        full_session = ohlc_frame_for_dates(
            "DRAM",
            [
                "2026-07-13 03:55",
                "2026-07-13 04:00",
                "2026-07-13 09:30",
                "2026-07-13 16:00",
                "2026-07-13 19:55",
                "2026-07-13 20:00",
            ],
        )
        full_session["Session"] = ["overnight", "pre", "intraday", "post", "post", "overnight"]

        with (
            patch("app.services.market_data._load_compare_overnight_market_settings", return_value=settings),
            patch(
                "app.services.market_data._fetch_yfinance_compare_one_day_extended_history",
                side_effect=ValueError("Yahoo unavailable."),
            ),
            patch(
                "app.services.market_data.fetch_longbridge_compare_one_day_history",
                return_value=full_session,
            ) as longbridge_mock,
        ):
            result = fetch_compare_one_day_extended_history(
                "DRAM",
                trading_date="2026-07-13",
            )

        self.assertEqual(
            result["Date"].tolist(),
            [
                pd.Timestamp("2026-07-13 04:00"),
                pd.Timestamp("2026-07-13 09:30"),
                pd.Timestamp("2026-07-13 16:00"),
                pd.Timestamp("2026-07-13 19:55"),
            ],
        )
        self.assertEqual(result.attrs["market_data_source"], "longbridge_extended_fallback")
        longbridge_mock.assert_called_once_with(
            "DRAM",
            settings,
            trading_date="2026-07-13",
        )

    def test_compare_overnight_keeps_premarket_continuation_by_default(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        full_session = ohlc_frame_for_dates(
            "SKHY",
            ["2026-07-14 03:59", "2026-07-14 04:00", "2026-07-14 04:40"],
        )
        full_session["Session"] = ["overnight", "pre", "pre"]
        extended_session = full_session.iloc[1:].copy()
        extended_session.attrs["market_data_source"] = "yfinance_extended"

        with (
            patch("app.services.market_data._load_compare_overnight_market_settings", return_value=settings),
            patch(
                "app.services.market_data.fetch_longbridge_compare_one_day_history",
                return_value=full_session,
            ),
            patch(
                "app.services.market_data._fetch_yfinance_compare_one_day_extended_history",
                return_value=extended_session,
            ) as extended_mock,
        ):
            result = fetch_compare_one_day_overnight_history("SKHY")

        self.assertEqual(result["Date"].max(), pd.Timestamp("2026-07-14 04:40"))
        self.assertEqual(result.attrs["market_data_source"], "longbridge_overnight")
        self.assertEqual(result["Date"].min(), pd.Timestamp("2026-07-14 03:59"))
        extended_mock.assert_called_once_with("SKHY", trading_date=None)


class MarketDataFreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_yfinance_rate_limit_backoff()

    def tearDown(self) -> None:
        _reset_yfinance_rate_limit_backoff()

    def test_store_directory_override_is_explicit_and_process_local(self) -> None:
        fallback = BASE_DIR / "market_store"
        with TemporaryDirectory() as temp_dir:
            with patch.dict("os.environ", {"ANTIGRAVITY_TEST_STORE": temp_dir}):
                resolved = resolve_store_directory("ANTIGRAVITY_TEST_STORE", fallback)

        self.assertEqual(resolved, Path(temp_dir).resolve())

    def test_remote_market_access_environment_override_skips_probes(self) -> None:
        with (
            patch.dict("os.environ", {"ANTIGRAVITY_REMOTE_MARKET_ACCESS": "disabled"}),
            patch("app.infrastructure.connectivity._probe_yahoo_chart_endpoint") as chart_probe,
            patch("app.infrastructure.connectivity._probe_yfinance_history") as yfinance_probe,
        ):
            available = has_remote_market_access()

        self.assertFalse(available)
        chart_probe.assert_not_called()
        yfinance_probe.assert_not_called()

    def test_remote_market_access_environment_override_blocks_minute_refresh(self) -> None:
        with (
            patch.dict("os.environ", {"ANTIGRAVITY_REMOTE_MARKET_ACCESS": "disabled"}),
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance"
            ) as yfinance_download,
            patch("app.services.market_data._load_longbridge_market_settings") as longbridge_settings,
            patch("app.services.market_data.yf.download") as yfinance_transport,
        ):
            with self.assertRaisesRegex(YfinanceDownloadError, "Remote market access is disabled"):
                refresh_one_minute_store("DRAM")
            with self.assertRaisesRegex(YfinanceDownloadError, "Remote market access is disabled"):
                _download_daily_history_with_yfinance("DRAM", period="5d", interval="1m")

        yfinance_download.assert_not_called()
        longbridge_settings.assert_not_called()
        yfinance_transport.assert_not_called()

    def _with_isolated_store(
        self,
        dataset: pd.DataFrame,
        callback: Callable[[Path], None],
        *,
        interval: str,
    ) -> None:
        if interval not in {"1d", "1m"}:
            raise ValueError(f"Unsupported isolated market interval: {interval}")

        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / f"DRAM_{interval}.parquet"
            for production_root in (BASE_DIR / "market_store", BASE_DIR / "settings_store"):
                self.assertFalse(path.resolve().is_relative_to(production_root.resolve()))
            path.parent.mkdir(parents=True, exist_ok=True)
            path_function = (
                "app.infrastructure.broker_market_data.intraday_history_store_path_for"
                if interval == "1m"
                else "app.infrastructure.broker_market_data.history_store_path_for"
            )
            with patch(path_function, return_value=path):
                dataset.to_parquet(path, index=False)
                callback(path)

    def test_isolated_store_cleanup_survives_callback_failure(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-30"]),
                "Close": [26.0],
            }
        )
        observed_path: Path | None = None

        def fail_after_observing_store(path: Path) -> None:
            nonlocal observed_path
            observed_path = path
            self.assertTrue(path.exists())
            raise RuntimeError("Deliberate isolated-store callback failure.")

        with self.assertRaisesRegex(RuntimeError, "Deliberate isolated-store callback failure"):
            self._with_isolated_store(
                dataset,
                fail_after_observing_store,
                interval="1d",
            )

        self.assertIsNotNone(observed_path)
        self.assertFalse(observed_path.exists())

    def test_market_data_freshness_accepts_last_preholiday_trading_day(self) -> None:
        is_fresh = _is_market_data_fresh(
            pd.Timestamp("2026-04-02 16:00:00"),
            now=pd.Timestamp("2026-04-04 20:00:00+08:00"),
        )

        self.assertTrue(is_fresh)

    def test_classify_daily_store_status_marks_new_listing_short_history_as_short_history(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-15", "2026-06-30"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status(_path: Path) -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_daily_store_status("DRAM")

            self.assertEqual(status, "short_history")

        self._with_isolated_store(dataset, assert_status, interval="1d")

    def test_classify_daily_store_status_does_not_mark_older_incomplete_history_as_new(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-02", "2026-06-30"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status(_path: Path) -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_daily_store_status("DRAM")

            self.assertEqual(status, "missing")

        self._with_isolated_store(dataset, assert_status, interval="1d")

    def test_classify_one_minute_store_status_marks_new_listing_short_history_as_short_history(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-15 09:30", "2026-06-30 16:00"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status(_path: Path) -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_one_minute_store_status("DRAM")

            self.assertEqual(status, "short_history")

        self._with_isolated_store(dataset, assert_status, interval="1m")

    def test_classify_one_minute_store_status_does_not_mark_older_incomplete_history_as_new(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-04-02 09:30", "2026-06-30 16:00"]),
                "Close": [25.0, 26.0],
            }
        )

        def assert_status(_path: Path) -> None:
            with patch(
                "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                return_value=pd.Timestamp("2026-06-30"),
            ):
                status = classify_one_minute_store_status("DRAM")

            self.assertEqual(status, "missing")

        self._with_isolated_store(dataset, assert_status, interval="1m")

    def test_classify_daily_store_status_marks_complete_history_as_fresh(self) -> None:
        with patch("app.infrastructure.broker_market_data.is_daily_store_complete", return_value=True):
            status = classify_daily_store_status("DRAM")

        self.assertEqual(status, "fresh")

    def test_classify_one_minute_store_status_marks_complete_history_as_fresh(self) -> None:
        with patch("app.infrastructure.broker_market_data.is_one_minute_store_complete", return_value=True):
            status = classify_one_minute_store_status("DRAM")

        self.assertEqual(status, "fresh")

    def test_refresh_history_store_skips_write_when_remote_has_no_newer_trading_day(self) -> None:
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

        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ.parquet"
            path.parent.mkdir(parents=True, exist_ok=True)
            existing_dataset.to_parquet(path, index=False)
            before_bytes = path.read_bytes()

            with (
                patch(
                    "app.services.market_data.history_store_path_for",
                    return_value=path,
                ),
                patch(
                    "app.services.market_data.has_remote_market_access",
                    return_value=True,
                ),
                patch(
                    "app.services.market_data._download_daily_history_with_yfinance",
                    return_value=overlapping_remote,
                ),
            ):
                refreshed_path = refresh_history_store("QQQ")

            self.assertEqual(refreshed_path, path)
            self.assertEqual(path.read_bytes(), before_bytes)
            stored = pd.read_parquet(path).sort_values("Date").reset_index(drop=True)
            pd.testing.assert_frame_equal(stored, existing_dataset)

    def test_fetch_history_repairs_missing_dividend_actions_from_adjustment_steps(self) -> None:
        broken_dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime([
                    "2025-08-20",
                    "2025-08-21",
                    "2025-11-19",
                    "2025-11-20",
                    "2026-07-13",
                ]),
                "Close": [504.0, 504.24, 478.0, 478.43, 390.99],
                "Adj Close": [500.0, 501.07, 473.0, 476.31, 390.99],
                "Dividends": [0.0, 0.0, 0.0, 0.0, 0.0],
            }
        )
        repaired_dataset = broken_dataset.copy()
        broken_dataset["Stock Splits"] = 0.0
        repaired_dataset["Stock Splits"] = 0.0
        repaired_dataset.loc[
            repaired_dataset["Date"].isin(pd.to_datetime(["2025-08-21", "2025-11-20"])),
            "Dividends",
        ] = [0.83, 0.91]

        with TemporaryDirectory() as tempdir:
            history_path = Path(tempdir) / "MSFT.parquet"
            broken_dataset.to_parquet(history_path, index=False)

            def repair_store(ticker: str, *, force_full: bool = False) -> Path:
                self.assertEqual(ticker, "MSFT")
                self.assertTrue(force_full)
                repaired_dataset.to_parquet(history_path, index=False)
                return history_path

            with (
                patch("app.services.market_data.market_ticker_store_aliases", return_value=["MSFT"]),
                patch("app.services.market_data.history_store_path_for_interval", return_value=history_path),
                patch("app.services.market_data.refresh_history_store", side_effect=repair_store) as refresh_mock,
            ):
                result = fetch_history("MSFT", False, dividend_mode="price")

        refresh_mock.assert_called_once_with("MSFT", force_full=True)
        self.assertAlmostEqual(float(result["Dividends"].sum()), 1.74)

    def test_fetch_history_repairs_legacy_cache_missing_split_actions(self) -> None:
        legacy_dataset = pd.DataFrame({
            "Date": pd.to_datetime(["2024-06-07", "2024-06-10"]),
            "Close": [120.89, 121.79],
            "Adj Close": [120.84, 121.74],
            "Dividends": [0.0, 0.0],
        })
        repaired_dataset = legacy_dataset.copy()
        repaired_dataset["Stock Splits"] = [0.0, 10.0]

        with TemporaryDirectory() as tempdir:
            history_path = Path(tempdir) / "NVDA.parquet"
            legacy_dataset.to_parquet(history_path, index=False)

            def repair_store(ticker: str, *, force_full: bool = False) -> Path:
                self.assertEqual(ticker, "NVDA")
                self.assertTrue(force_full)
                repaired_dataset.to_parquet(history_path, index=False)
                return history_path

            with (
                patch("app.services.market_data.market_ticker_store_aliases", return_value=["NVDA"]),
                patch("app.services.market_data.history_store_path_for_interval", return_value=history_path),
                patch("app.services.market_data.refresh_history_store", side_effect=repair_store) as refresh_mock,
            ):
                result = fetch_history("NVDA", False, dividend_mode="price")

        refresh_mock.assert_called_once_with("NVDA", force_full=True)
        self.assertEqual(result["Stock Splits"].tolist(), [0.0, 10.0])
        self.assertTrue(result.attrs["stock_split_actions_authoritative"])

    def test_fetch_history_marks_legacy_split_actions_unverified_after_refresh_failure(self) -> None:
        legacy_dataset = pd.DataFrame({
            "Date": pd.to_datetime(["2024-06-07", "2024-06-10"]),
            "Close": [120.89, 121.79],
            "Adj Close": [120.84, 121.74],
            "Dividends": [0.0, 0.0],
        })
        with TemporaryDirectory() as tempdir:
            history_path = Path(tempdir) / "NVDA.parquet"
            legacy_dataset.to_parquet(history_path, index=False)
            with (
                patch("app.services.market_data.market_ticker_store_aliases", return_value=["NVDA"]),
                patch("app.services.market_data.history_store_path_for_interval", return_value=history_path),
                patch(
                    "app.services.market_data.refresh_history_store",
                    side_effect=ValueError("rate limited"),
                ),
            ):
                result = fetch_history("NVDA", False, dividend_mode="price")

        self.assertEqual(result["Stock Splits"].tolist(), [0.0, 0.0])
        self.assertFalse(result.attrs["stock_split_actions_authoritative"])

    def test_fetch_history_keeps_zero_dividend_cache_when_adjustment_ratio_is_stable(self) -> None:
        non_dividend_dataset = market_frame("ADBE")
        non_dividend_dataset["Adj Close"] = non_dividend_dataset["Close"]
        non_dividend_dataset["Dividends"] = 0.0
        non_dividend_dataset["Stock Splits"] = 0.0

        with TemporaryDirectory() as tempdir:
            history_path = Path(tempdir) / "ADBE.parquet"
            non_dividend_dataset.to_parquet(history_path, index=False)
            with (
                patch("app.services.market_data.market_ticker_store_aliases", return_value=["ADBE"]),
                patch("app.services.market_data.history_store_path_for_interval", return_value=history_path),
                patch("app.services.market_data.refresh_history_store") as refresh_mock,
            ):
                result = fetch_history("ADBE", False, dividend_mode="price")

        refresh_mock.assert_not_called()
        self.assertEqual(float(result["Dividends"].sum()), 0.0)

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

    def test_yfinance_empty_download_preserves_sanitized_transport_diagnostic(self) -> None:
        def fake_download(**kwargs) -> pd.DataFrame:
            del kwargs
            logging.getLogger("yfinance").error(
                "curl failed via https://user:contact@example.invalid/?crumb=secret-value"
            )
            return pd.DataFrame()

        with patch("app.services.market_data.yf.download", side_effect=fake_download):
            with self.assertRaises(YfinanceDownloadError) as raised:
                _download_daily_history_with_yfinance("DRAM", period="5d")

        message = str(raised.exception)
        self.assertIn("curl failed", message)
        self.assertIn("https://redacted@example.invalid/", message)
        self.assertIn("crumb=REDACTED", message)
        self.assertNotIn("user:password", message)
        self.assertNotIn("secret-value", message)

    def test_yfinance_fallback_download_receives_shared_verified_session(self) -> None:
        fake_history = market_frame("QQQ").set_index("Date")
        shared_session = object()

        with (
            patch(
                "app.services.market_data.get_yfinance_session",
                return_value=shared_session,
            ),
            patch(
                "app.services.market_data.yf.download",
                return_value=fake_history,
            ) as download_mock,
        ):
            result = _download_daily_history_with_yfinance("QQQ", period="5d")

        self.assertFalse(result.empty)
        self.assertIs(download_mock.call_args.kwargs["session"], shared_session)

    def test_daily_history_uses_direct_yahoo_chart_before_optional_longbridge(self) -> None:
        chart_history = market_frame("DRAM").set_index("Date")

        with (
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=ConnectionError("curl transport unavailable"),
            ),
            patch(
                "app.services.market_data.download_yahoo_chart_daily_history",
                return_value=chart_history,
            ) as chart_mock,
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
            patch("app.services.market_data._download_daily_history_with_longbridge") as longbridge_mock,
        ):
            result = _download_daily_history_with_fallback("DRAM", start="2026-07-10")

        pd.testing.assert_frame_equal(result, chart_history)
        chart_mock.assert_called_once_with(
            "DRAM",
            start="2026-07-10",
            period=None,
        )
        longbridge_mock.assert_not_called()

    def test_daily_history_failure_reports_both_yahoo_transports_without_requiring_longbridge(self) -> None:
        with (
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=ConnectionError("curl TLS failure"),
            ),
            patch(
                "app.services.market_data.download_yahoo_chart_daily_history",
                side_effect=ConnectionError("urllib TLS failure"),
            ),
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
        ):
            with self.assertRaises(ValueError) as raised:
                _download_daily_history_with_fallback("QQQI", start="2026-07-10")

        message = str(raised.exception)
        self.assertIn("curl TLS failure", message)
        self.assertIn("urllib TLS failure", message)
        self.assertIn("Optional Longbridge fallback is not configured", message)
        self.assertNotIn("Configure Longbridge", message)

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

    def test_download_full_intraday_history_uses_yfinance_before_configured_longbridge(self) -> None:
        yfinance_history = market_frame("AAPL", intraday=True)

        with (
            patch("app.services.market_data._load_longbridge_market_settings", return_value=object()),
            patch("app.services.market_data._download_one_minute_history_with_longbridge") as longbridge_mock,
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                return_value=yfinance_history,
            ) as yfinance_mock,
        ):
            result = download_full_history("AAPL", interval="1m")

        pd.testing.assert_frame_equal(result, yfinance_history)
        longbridge_mock.assert_not_called()
        yfinance_mock.assert_called_once_with("AAPL", days=30)

    def test_download_full_intraday_history_uses_longbridge_only_after_yfinance_fails(self) -> None:
        longbridge_history = market_frame("AAPL", intraday=True)

        with (
            patch("app.services.market_data._load_longbridge_market_settings", return_value=object()),
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                side_effect=ConnectionError("Yahoo unavailable"),
            ) as yfinance_mock,
            patch(
                "app.services.market_data._download_one_minute_history_with_longbridge",
                return_value=longbridge_history,
            ) as longbridge_mock,
        ):
            result = download_full_history("AAPL", interval="1m")

        pd.testing.assert_frame_equal(result, longbridge_history)
        self.assertEqual(yfinance_mock.call_count, 2)
        longbridge_mock.assert_called_once_with("AAPL")

    def test_refresh_one_minute_store_uses_yfinance_before_configured_longbridge(self) -> None:
        yfinance_history = market_frame("QQQ", intraday=True)
        expected_path = Path("isolated-market-store/QQQ-1m.parquet")

        with (
            patch("app.services.market_data.has_recent_one_minute_store", return_value=False),
            patch("app.services.market_data._load_longbridge_market_settings", return_value=object()),
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                return_value=yfinance_history,
            ) as yfinance_mock,
            patch("app.services.market_data._upsert_one_minute_store", return_value=expected_path),
            patch("app.services.market_data.refresh_longbridge_one_minute_store") as longbridge_mock,
        ):
            result = refresh_one_minute_store("QQQ")

        self.assertEqual(result.path, expected_path)
        self.assertEqual(result.source, "yfinance_30d")
        yfinance_mock.assert_called_once_with("QQQ", days=30)
        longbridge_mock.assert_not_called()

    def test_refresh_one_minute_store_uses_one_recent_window_for_existing_cache(self) -> None:
        yfinance_history = market_frame("QQQ", intraday=True)
        expected_path = Path("isolated-market-store/QQQ-1m.parquet")

        with (
            patch("app.services.market_data.has_recent_one_minute_store", return_value=True),
            patch(
                "app.services.market_data._download_recent_one_minute_history_with_yfinance",
                return_value=yfinance_history,
            ) as yfinance_mock,
            patch("app.services.market_data._upsert_one_minute_store", return_value=expected_path),
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
        ):
            result = refresh_one_minute_store("QQQ")

        self.assertEqual(result.path, expected_path)
        self.assertEqual(result.source, "yfinance_7d")
        yfinance_mock.assert_called_once_with("QQQ", days=7)

    def test_realtime_quote_batch_rotates_one_individual_recovery_after_batch_failure(self) -> None:
        def fake_download(tickers, **kwargs):
            del kwargs
            if isinstance(tickers, list):
                raise ConnectionError("Batch response unavailable")
            return market_frame(str(tickers), intraday=True)

        with (
            patch("app.services.market_data._yfinance_realtime_recovery_cursor", 0),
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=fake_download,
            ) as download_mock,
            patch("app.services.market_data.LOGGER.warning") as warning_mock,
        ):
            first_quotes = fetch_yfinance_realtime_quotes(["QQQ", "AAPL"])
            second_quotes = fetch_yfinance_realtime_quotes(["QQQ", "AAPL"])

        self.assertEqual([quote["ticker"] for quote in first_quotes], ["QQQ"])
        self.assertEqual([quote["ticker"] for quote in second_quotes], ["AAPL"])
        self.assertEqual(download_mock.call_count, 4)
        self.assertEqual(
            [call.args[0] for call in download_mock.call_args_list],
            [["QQQ", "AAPL"], "QQQ", ["QQQ", "AAPL"], "AAPL"],
        )
        warning_mock.assert_not_called()

    def test_realtime_quote_batch_rate_limit_skips_individual_retries_and_cools_down(self) -> None:
        rate_limit_error = YfinanceDownloadError(
            "8 Failed downloads: YFRateLimitError('Too Many Requests. Rate limited. Try after a while.')"
        )

        with (
            patch("app.services.market_data._yfinance_rate_limit_until", 0.0),
            patch("app.services.market_data._yfinance_rate_limit_failures", 0),
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=rate_limit_error,
            ) as download_mock,
            patch("app.services.market_data.LOGGER.warning") as warning_mock,
        ):
            first_quotes = fetch_yfinance_realtime_quotes(["QQQ", "AAPL"])
            second_quotes = fetch_yfinance_realtime_quotes(["QQQ", "AAPL"])

        self.assertEqual(first_quotes, [])
        self.assertEqual(second_quotes, [])
        download_mock.assert_called_once()
        warning_mock.assert_not_called()

    def test_yfinance_rate_limit_backoff_doubles_and_is_bounded(self) -> None:
        with (
            patch("app.services.market_data._yfinance_rate_limit_until", 0.0),
            patch("app.services.market_data._yfinance_rate_limit_failures", 0),
            patch("app.services.market_data.monotonic", side_effect=[100.0, 400.0, 1_000.0, 2_200.0]),
        ):
            first_cooldown = _activate_yfinance_rate_limit_cooldown()
            second_cooldown = _activate_yfinance_rate_limit_cooldown()
            third_cooldown = _activate_yfinance_rate_limit_cooldown()
            fourth_cooldown = _activate_yfinance_rate_limit_cooldown()

        self.assertEqual(first_cooldown, 300.0)
        self.assertEqual(second_cooldown, 600.0)
        self.assertEqual(third_cooldown, 1_200.0)
        self.assertEqual(fourth_cooldown, 1_800.0)

    def test_yfinance_rate_limit_cooldown_blocks_the_transport_before_another_request(self) -> None:
        with (
            patch("app.services.market_data._yfinance_rate_limit_until", 160.0),
            patch("app.services.market_data.monotonic", return_value=100.0),
            patch("app.services.market_data.yf.download") as download_mock,
        ):
            with self.assertRaisesRegex(YfinanceDownloadError, "temporarily paused"):
                _download_daily_history_with_yfinance("QQQ", period="1d")

        download_mock.assert_not_called()

    def test_daily_rate_limit_skips_all_yahoo_fallback_transport_retries(self) -> None:
        rate_limit_error = YfinanceDownloadError("Too Many Requests. Rate limited.")

        with (
            patch(
                "app.services.market_data._download_daily_history_with_yfinance",
                side_effect=rate_limit_error,
            ) as yfinance_mock,
            patch("app.services.market_data.download_yahoo_chart_daily_history") as chart_mock,
            patch("app.services.market_data._load_longbridge_market_settings", return_value=None),
        ):
            with self.assertRaisesRegex(ValueError, "requests are paused"):
                _download_daily_history_with_fallback("QQQ", period="max")

        yfinance_mock.assert_called_once()
        chart_mock.assert_not_called()

    def test_longbridge_realtime_quotes_select_pre_market_price(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "pre", "session_date": "2026-07-20"},
            ),
            patch(
                "app.services.market_data.run_longbridge_cli_json",
                return_value=[{
                    "symbol": "DRAM.US",
                    "last": "52.72",
                    "pre_market": {"last": "54.39", "timestamp": "2026-07-20T12:29:47Z"},
                }],
            ) as cli_json,
        ):
            quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        self.assertEqual(
            quotes,
            [{
                "ticker": "DRAM",
                "price": 54.39,
                "timestamp": "2026-07-20 08:29",
                "session": "pre",
                "session_date": "2026-07-20",
                "market": "US",
                "source": "longbridge",
            }],
        )
        self.assertEqual(
            cli_json.call_args.args[1],
            ["quote", "DRAM.US", "--format", "json"],
        )

    def test_longbridge_realtime_quotes_keep_regular_price_without_provider_timestamp(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "intraday", "session_date": "2026-07-20"},
            ),
            patch(
                "app.services.market_data.run_longbridge_cli_json",
                return_value=[{"symbol": "DRAM.US", "last": "55.12"}],
            ),
        ):
            quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        self.assertEqual(
            quotes,
            [{
                "ticker": "DRAM",
                "price": 55.12,
                "timestamp": "",
                "session": "intraday",
                "session_date": "2026-07-20",
                "market": "US",
                "source": "longbridge",
            }],
        )

    def test_longbridge_realtime_quotes_select_post_market_price(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "post", "session_date": "2026-07-20"},
            ),
            patch(
                "app.services.market_data.run_longbridge_cli_json",
                return_value=[{
                    "symbol": "DRAM.US",
                    "last": "55.12",
                    "post_market": {"last": "54.88", "timestamp": "2026-07-20T21:30:47Z"},
                }],
            ),
        ):
            quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        self.assertEqual(quotes[0]["price"], 54.88)
        self.assertEqual(quotes[0]["timestamp"], "2026-07-20 17:30")
        self.assertEqual(quotes[0]["session"], "post")

    def test_longbridge_realtime_quotes_fail_closed_for_transport_errors(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "intraday", "session_date": "2026-07-20"},
            ),
            patch(
                "app.services.market_data.run_longbridge_cli_json",
                side_effect=RuntimeError("offline"),
            ),
        ):
            quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        self.assertEqual(quotes, [])

    def test_longbridge_realtime_quotes_skip_transport_outside_supported_scope(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "off", "session_date": "2026-07-20"},
            ),
            patch("app.services.market_data.run_longbridge_cli_json") as cli_json,
        ):
            off_session_quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "intraday", "session_date": "2026-07-20"},
            ),
            patch("app.services.market_data.run_longbridge_cli_json") as non_us_cli_json,
        ):
            non_us_quotes = fetch_longbridge_realtime_quotes(["2800.HK"])

        self.assertEqual(off_session_quotes, [])
        self.assertEqual(non_us_quotes, [])
        cli_json.assert_not_called()
        non_us_cli_json.assert_not_called()

    def test_longbridge_realtime_quotes_support_legacy_api_key_configuration(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="legacy_apikey",
            longbridge_app_key="key",
            longbridge_app_secret="secret",
            longbridge_access_token="token",
        )
        quote_context = SimpleNamespace(
            quote=lambda symbols: [SimpleNamespace(
                symbol="DRAM.US",
                pre_market_quote=SimpleNamespace(
                    last_done="54.39",
                    timestamp="2026-07-20T12:29:47Z",
                ),
            )]
        )
        with (
            patch("app.services.market_data.load_broker_settings", return_value=settings),
            patch(
                "app.services.market_data.nyse_market_session_state",
                return_value={"session": "pre", "session_date": "2026-07-20"},
            ),
            patch(
                "app.services.market_data.get_longbridge_quote_context",
                return_value=quote_context,
            ) as context_mock,
        ):
            quotes = fetch_longbridge_realtime_quotes(["DRAM"])

        self.assertEqual(quotes[0]["price"], 54.39)
        self.assertEqual(quotes[0]["source"], "longbridge")
        context_mock.assert_called_once_with(settings)

    def test_realtime_quote_endpoint_does_not_cache_partial_batches(self) -> None:
        qqq_quote = {"ticker": "QQQ", "price": 100.0, "source": "yfinance"}
        aapl_quote = {"ticker": "AAPL", "price": 200.0, "source": "yfinance"}

        with (
            patch("app.web.runtime.fetch_longbridge_realtime_quotes", return_value=[]),
            patch(
                "app.web.runtime.fetch_yfinance_realtime_quotes",
                side_effect=[[qqq_quote], [qqq_quote, aapl_quote]],
            ) as quote_mock,
        ):
            client = create_app().test_client()
            first = client.get("/api/investment/realtime-quotes?ticker=QQQ&ticker=AAPL")
            second = client.get("/api/investment/realtime-quotes?ticker=QQQ&ticker=AAPL")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(quote_mock.call_count, 2)
        self.assertEqual(second.get_json()["count"], 2)

    def test_realtime_quote_endpoint_reuses_a_complete_batch_for_one_minute(self) -> None:
        qqq_quote = {"ticker": "QQQ", "price": 100.0, "source": "yfinance"}
        aapl_quote = {"ticker": "AAPL", "price": 200.0, "source": "yfinance"}

        with (
            patch("app.web.runtime.fetch_longbridge_realtime_quotes", return_value=[]) as longbridge_mock,
            patch(
                "app.web.runtime.fetch_yfinance_realtime_quotes",
                return_value=[qqq_quote, aapl_quote],
            ) as yfinance_mock,
        ):
            client = create_app().test_client()
            first = client.get("/api/investment/realtime-quotes?ticker=QQQ&ticker=AAPL")
            second = client.get("/api/investment/realtime-quotes?ticker=QQQ&ticker=AAPL")

        self.assertEqual(first.get_json()["quotes"], [qqq_quote, aapl_quote])
        self.assertEqual(second.get_json()["quotes"], [qqq_quote, aapl_quote])
        longbridge_mock.assert_called_once()
        yfinance_mock.assert_called_once_with(["QQQ", "AAPL"])

    def test_realtime_quote_endpoint_prefers_longbridge_then_falls_back_per_ticker(self) -> None:
        longbridge_quote = {"ticker": "QQQ", "price": 100.0, "source": "longbridge"}
        yfinance_quote = {"ticker": "AAPL", "price": 200.0, "source": "yfinance"}

        with (
            patch(
                "app.web.runtime.fetch_longbridge_realtime_quotes",
                return_value=[longbridge_quote],
            ) as longbridge_mock,
            patch(
                "app.web.runtime.fetch_yfinance_realtime_quotes",
                return_value=[yfinance_quote],
            ) as yfinance_mock,
        ):
            response = create_app().test_client().get(
                "/api/investment/realtime-quotes?ticker=QQQ&ticker=AAPL"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(longbridge_mock.call_args.args[0], ["QQQ", "AAPL"])
        self.assertEqual(yfinance_mock.call_args.args[0], ["AAPL"])
        payload = response.get_json()
        self.assertEqual(payload["source"], "mixed")
        self.assertEqual(payload["quotes"], [longbridge_quote, yfinance_quote])

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
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d', **kwargs: close_frame_for_ticker(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/compare?ticker=QQQ&ticker=AAPL&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_requests, [["QQQ", "AAPL"]])

    def test_intraday_price_page_does_not_block_on_daily_cache_refresh(self) -> None:
        with (
            patch("app.web.runtime.ensure_latest_daily_caches") as refresh_mock,
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval="1d", **kwargs: close_frame_for_ticker(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
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
            patch("app.web.runtime.fetch_history", side_effect=lambda ticker, include_dividends, interval='1d', **kwargs: close_frame_for_ticker(ticker)),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
        ):
            client = create_app().test_client()
            response = client.get("/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=3y&dividends=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(refresh_requests, [["QQQ", "AAPL"]])


if __name__ == "__main__":
    unittest.main()
