"""
Tests for broker-backed market data normalization.

Code version: v0.12.1
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd

import app.infrastructure.broker_market_data as broker_market_data
from app.core.broker_settings import BrokerSettings
from app.core.config import BASE_DIR
from app.infrastructure.broker_market_data import (
    _cli_candlestick_rows_to_frame,
    _cli_daily_candlestick_rows_to_frame,
    _cli_extended_candlestick_rows_to_frame,
    _candlestick_rows_to_frame,
    _daily_candlestick_rows_to_frame,
    _normalize_longbridge_market_cap_row,
    _normalize_longbridge_static_row,
    _normalize_longbridge_trade_stats_payload,
    _normalize_longbridge_trade_session,
    _parse_longbridge_timestamp,
    _resolve_longbridge_daily_adjust_type,
    classify_one_minute_store_status,
    fetch_longbridge_market_cap_snapshot,
    fetch_longbridge_circulating_shares,
    fetch_longbridge_trade_stats,
    fetch_longbridge_compare_one_day_history,
    fetch_longbridge_daily_history,
    fetch_longbridge_one_minute_history,
    has_recent_one_minute_store,
    is_one_minute_store_complete,
    is_one_minute_store_fresh,
    normalize_longbridge_symbol,
    normalize_one_minute_store_frame,
    OneMinuteStoreReadError,
    refresh_longbridge_one_minute_store,
)
from tests.factories.market import longbridge_candlestick_rows, market_frame


def _ny_naive_from_local(value: str, timezone: str) -> pd.Timestamp:
    return pd.Timestamp(value).tz_localize(timezone).tz_convert("America/New_York").tz_localize(None)


class BrokerMarketDataTests(unittest.TestCase):
    def test_ibkr_has_no_direct_connectivity_or_credential_fields(self) -> None:
        gateway_symbols = {
            "_build_ibkr_url",
            "_request_ibkr_json",
            "_fetch_ibkr_auth_status",
            "_probe_ibkr_plain_http_server",
            "test_ibkr_client_portal_connection",
        }

        self.assertTrue(all(not hasattr(broker_market_data, name) for name in gateway_symbols))
        self.assertNotIn("ibkr_base_url", BrokerSettings.__dataclass_fields__)
        self.assertNotIn("ibkr_verify_ssl", BrokerSettings.__dataclass_fields__)
        ibkr_fields = {
            name for name in BrokerSettings.__dataclass_fields__ if name.startswith("ibkr_")
        }
        self.assertEqual(ibkr_fields, {"ibkr_account_id"})
        success, message = broker_market_data.test_broker_connection(
            BrokerSettings(selected_broker="ibkr")
        )
        self.assertFalse(success)
        self.assertIn("IBKR direct connectivity is unavailable", message)

    def test_broker_connection_does_not_return_sdk_exception_details(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="legacy_apikey",
            longbridge_app_key="app-key",
            longbridge_app_secret="app-secret",
            longbridge_access_token="access-token",
        )
        internal_message = "/Users/example/.longbridge/config token=secret-value"

        with (
            patch(
                "app.infrastructure.broker_market_data.get_longbridge_quote_context",
                side_effect=RuntimeError(internal_message),
            ),
            patch("app.infrastructure.broker_market_data._report_longbridge_debug_event"),
        ):
            success, message = broker_market_data.test_broker_connection(settings)

        self.assertFalse(success)
        self.assertEqual(
            message,
            "Connection failed. Check Longbridge settings and network connectivity.",
        )
        self.assertNotIn("/Users/example", message)
        self.assertNotIn("secret-value", message)

    def test_longbridge_uses_us_suffix_only_at_its_adapter_boundary(self) -> None:
        self.assertEqual(normalize_longbridge_symbol("META"), "META.US")
        self.assertEqual(normalize_longbridge_symbol("META.US"), "META.US")
        self.assertEqual(normalize_longbridge_symbol("700.HK"), "700.HK")
        self.assertEqual(normalize_longbridge_symbol("600519.SH"), "600519.SH")
        self.assertEqual(normalize_longbridge_symbol("000001.SZ"), "000001.SZ")
        self.assertEqual(normalize_longbridge_symbol("BRK.B"), "BRK.B.US")
        self.assertEqual(normalize_longbridge_symbol("BRK-B"), "BRK.B.US")
        self.assertEqual(normalize_longbridge_symbol("BF-B"), "BF.B.US")

    def test_longbridge_normalization_fails_closed_for_invalid_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "Ticker is required"):
            normalize_longbridge_symbol("")

        self.assertIsNone(_normalize_longbridge_market_cap_row({}, "AAPL.US"))
        self.assertIsNone(
            _normalize_longbridge_market_cap_row(
                {"last_done": "0", "mktcap": "100"},
                "AAPL.US",
            )
        )
        self.assertEqual(_normalize_longbridge_trade_session("TradeSession.Normal"), "intraday")
        self.assertEqual(_normalize_longbridge_trade_session("Overnight"), "overnight")
        self.assertEqual(_normalize_longbridge_trade_session(None), "")

    def test_longbridge_trade_stats_normalization_preserves_price_volume_buckets(self) -> None:
        payload = {
            "statistics": {
                "avgprice": "311.80",
                "preclose": "309.350",
                "buy": "2922660",
                "neutral": "8842674",
                "sell": "3130996",
                "total_amount": "14896330",
                "trades_count": "658071",
                "trade_date": ["1787544000"],
            },
            "trades": [
                {
                    "price": "313.350",
                    "buy_amount": "434",
                    "neutral_amount": "113",
                    "sell_amount": "356",
                },
                {"price": "bad", "buy_amount": "1", "neutral_amount": "1", "sell_amount": "1"},
            ],
        }

        normalized = _normalize_longbridge_trade_stats_payload(payload, "AAPL.US")

        self.assertIsNotNone(normalized)
        assert normalized is not None
        self.assertEqual(normalized["symbol"], "AAPL.US")
        self.assertEqual(normalized["statistics"]["average_price"], 311.8)
        self.assertEqual(normalized["trades"], [{
            "price": 313.35,
            "buy": 434.0,
            "neutral": 113.0,
            "sell": 356.0,
        }])

    def test_fetch_longbridge_trade_stats_uses_cli_trade_stats_command(self) -> None:
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value={
                "statistics": {"avgprice": "100", "trade_date": []},
                "trades": [{
                    "price": "100",
                    "buy_amount": "1",
                    "neutral_amount": "2",
                    "sell_amount": "3",
                }],
            },
        ) as cli_mock:
            result = fetch_longbridge_trade_stats("AAPL", self._longbridge_settings())

        self.assertEqual(result["symbol"], "AAPL.US")
        self.assertEqual(result["trades"][0]["sell"], 3.0)
        cli_mock.assert_called_once_with(
            self._longbridge_settings(),
            ["trade-stats", "AAPL.US", "--format", "json"],
            timeout_seconds=20,
        )

    def test_longbridge_static_normalization_reads_circulating_shares(self) -> None:
        normalized = _normalize_longbridge_static_row(
            {
                "symbol": "AAPL.US",
                "circ._shares": "14569173520",
                "total_shares": "14594180000",
            },
            "AAPL.US",
        )

        self.assertEqual(normalized["symbol"], "AAPL.US")
        self.assertEqual(normalized["circulating_shares"], 14_569_173_520.0)
        self.assertEqual(normalized["total_shares"], 14_594_180_000.0)

    def test_fetch_longbridge_circulating_shares_uses_cli_static_command(self) -> None:
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=[
                {"symbol": "AAPL.US", "circ._shares": "14569173520"},
                {"symbol": "000660.KS", "circ._shares": "728000000"},
            ],
        ) as cli_mock:
            result = fetch_longbridge_circulating_shares(
                ["AAPL", "000660.KS"],
                self._longbridge_settings(),
            )

        self.assertEqual(result, {
            "AAPL": 14_569_173_520.0,
            "000660.KS": 728_000_000.0,
        })
        cli_mock.assert_called_once_with(
            self._longbridge_settings(),
            ["static", "AAPL.US", "000660.KS", "--format", "json"],
            timeout_seconds=20,
        )

    def _assert_isolated_store_path(self, path: Path) -> None:
        for production_root in (BASE_DIR / "market_store", BASE_DIR / "settings_store"):
            self.assertFalse(path.resolve().is_relative_to(production_root.resolve()))

    def _longbridge_settings(self) -> BrokerSettings:
        return BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )

    def test_refresh_one_minute_store_refuses_to_overwrite_an_unreadable_cache(self) -> None:
        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ_1m.parquet"
            self._assert_isolated_store_path(path)
            path.parent.mkdir(parents=True)
            path.write_bytes(b"unreadable parquet cache")
            before_bytes = path.read_bytes()

            with (
                patch(
                    "app.infrastructure.broker_market_data.intraday_history_store_path_for",
                    return_value=path,
                ),
                patch("app.infrastructure.broker_market_data.ensure_market_store_dir"),
                patch("app.infrastructure.broker_market_data.fetch_longbridge_one_minute_history") as fetch_mock,
                patch("app.infrastructure.broker_market_data.write_parquet_atomic") as write_mock,
            ):
                with self.assertRaisesRegex(OneMinuteStoreReadError, "refusing to overwrite"):
                    refresh_longbridge_one_minute_store("QQQ", self._longbridge_settings())

            fetch_mock.assert_not_called()
            write_mock.assert_not_called()
            self.assertEqual(path.read_bytes(), before_bytes)

    def test_refresh_one_minute_store_refuses_to_overwrite_a_cache_changed_during_refresh(self) -> None:
        existing_dataset = market_frame("QQQ", intraday=True)
        refreshed_dataset = market_frame("QQQ", intraday=True).assign(Close=lambda frame: frame["Close"] + 1.0)

        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ_1m.parquet"
            self._assert_isolated_store_path(path)
            path.parent.mkdir(parents=True)
            existing_dataset.to_parquet(path, index=False)
            before_bytes = path.read_bytes()

            with (
                patch(
                    "app.infrastructure.broker_market_data.intraday_history_store_path_for",
                    return_value=path,
                ),
                patch("app.infrastructure.broker_market_data.ensure_market_store_dir"),
                patch(
                    "app.infrastructure.broker_market_data.pd.read_parquet",
                    side_effect=[existing_dataset.copy(), OSError("concurrent cache corruption")],
                ),
                patch(
                    "app.infrastructure.broker_market_data.fetch_longbridge_one_minute_history",
                    return_value=refreshed_dataset,
                ) as fetch_mock,
                patch("app.infrastructure.broker_market_data.write_parquet_atomic") as write_mock,
            ):
                with self.assertRaisesRegex(OneMinuteStoreReadError, "refusing to overwrite"):
                    refresh_longbridge_one_minute_store("QQQ", self._longbridge_settings())

            fetch_mock.assert_called_once()
            write_mock.assert_not_called()
            self.assertEqual(path.read_bytes(), before_bytes)
            pd.testing.assert_frame_equal(pd.read_parquet(path), existing_dataset)

    def test_refresh_one_minute_store_writes_only_to_an_isolated_cache(self) -> None:
        dataset = market_frame("QQQ", intraday=True).assign(
            Volume=1_000.0,
            Turnover=100_000.0,
        )

        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ_1m.parquet"
            self._assert_isolated_store_path(path)
            path.parent.mkdir(parents=True)
            with (
                patch(
                    "app.infrastructure.broker_market_data.intraday_history_store_path_for",
                    return_value=path,
                ),
                patch("app.infrastructure.broker_market_data.ensure_market_store_dir"),
                patch(
                    "app.infrastructure.broker_market_data.fetch_longbridge_one_minute_history",
                    return_value=dataset,
                ) as fetch_mock,
            ):
                refreshed = refresh_longbridge_one_minute_store(
                    "QQQ",
                    self._longbridge_settings(),
                )

            fetch_mock.assert_called_once()
            self.assertTrue(path.exists())
            pd.testing.assert_frame_equal(pd.read_parquet(path), refreshed)

    def test_one_minute_store_status_is_fail_closed_and_handles_short_history(self) -> None:
        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "historical" / "QQQ_1m.parquet"
            self._assert_isolated_store_path(path)
            path.parent.mkdir(parents=True)
            with (
                patch(
                    "app.infrastructure.broker_market_data.intraday_history_store_path_for",
                    return_value=path,
                ),
                patch(
                    "app.infrastructure.broker_market_data.latest_completed_nyse_trading_day",
                    return_value=pd.Timestamp("2026-07-23"),
                ),
            ):
                self.assertFalse(has_recent_one_minute_store("QQQ"))
                self.assertFalse(is_one_minute_store_complete("QQQ"))
                self.assertFalse(is_one_minute_store_fresh("QQQ"))
                self.assertEqual(classify_one_minute_store_status("QQQ"), "missing")

                short_history = pd.DataFrame({
                    "Date": pd.to_datetime(["2026-07-01", "2026-07-23"]),
                })
                short_history.to_parquet(path, index=False)
                self.assertTrue(has_recent_one_minute_store("QQQ"))
                self.assertTrue(is_one_minute_store_fresh("QQQ"))
                self.assertFalse(is_one_minute_store_complete("QQQ"))
                self.assertEqual(classify_one_minute_store_status("QQQ"), "short_history")

                path.write_bytes(b"not parquet")
                self.assertFalse(has_recent_one_minute_store("QQQ"))
                self.assertFalse(is_one_minute_store_fresh("QQQ"))
                self.assertEqual(classify_one_minute_store_status("QQQ"), "missing")

    def test_market_cap_snapshot_uses_cli_calc_index_fields(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=[{"symbol": "AAPL.US", "last_done": "125", "mktcap": "2525"}],
        ) as cli_json:
            snapshot = fetch_longbridge_market_cap_snapshot("AAPL", settings)

        self.assertEqual(snapshot["implied_shares"], 20.2)
        self.assertEqual(
            cli_json.call_args.args[1],
            ["calc-index", "AAPL.US", "--fields", "last_done,mktcap", "--format", "json"],
        )

    def test_market_cap_snapshot_reuses_legacy_sdk_credentials_when_ibkr_is_selected(self) -> None:
        settings = BrokerSettings(
            selected_broker="ibkr",
            longbridge_auth_mode="legacy_apikey",
            longbridge_app_key="key",
            longbridge_app_secret="secret",
            longbridge_access_token="token",
        )
        calc_index = SimpleNamespace(LastDone="last", TotalMarketValue="market-cap")
        quote_context = SimpleNamespace(
            calc_indexes=lambda symbols, fields: [
                SimpleNamespace(last_done="125", total_market_value="2525")
            ]
        )
        with (
            patch(
                "app.infrastructure.broker_market_data.run_longbridge_cli_json",
                side_effect=RuntimeError("CLI session unavailable"),
            ),
            patch("app.infrastructure.broker_market_data.get_longbridge_quote_context", return_value=quote_context),
            patch(
                "app.infrastructure.broker_market_data.import_module",
                return_value=SimpleNamespace(CalcIndex=calc_index),
            ),
        ):
            snapshot = fetch_longbridge_market_cap_snapshot("AAPL", settings)

        self.assertEqual(snapshot["symbol"], "AAPL.US")
        self.assertEqual(snapshot["market_cap"], 2_525.0)
        self.assertEqual(snapshot["implied_shares"], 20.2)

    def test_cli_and_sdk_candlestick_adapters_normalize_market_times(self) -> None:
        cli_candle = {
            "time": "2026-07-14T13:30:00Z",
            "open": "100",
            "high": "101",
            "low": "99",
            "close": "100.5",
            "volume": "1000",
            "turnover": "100500",
            "session": "Normal",
        }
        cli_frame = _cli_candlestick_rows_to_frame(
            [cli_candle, {"open": "missing-time"}],
            "AAPL",
        )
        self.assertEqual(cli_frame["Date"].tolist(), [pd.Timestamp("2026-07-14 09:30")])
        self.assertEqual(cli_frame.iloc[0]["Close"], 100.5)

        cli_daily_frame = _cli_daily_candlestick_rows_to_frame([cli_candle])
        self.assertEqual(cli_daily_frame["Date"].tolist(), [pd.Timestamp("2026-07-14")])

        cli_extended_frame = _cli_extended_candlestick_rows_to_frame([longbridge_candlestick_rows()[0]])
        self.assertEqual(cli_extended_frame["Session"].tolist(), ["overnight"])

        sdk_candle = SimpleNamespace(
            timestamp="2026-07-14T13:30:00Z",
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.5,
            volume=1_000,
            turnover=100_500,
        )
        sdk_daily_frame = _daily_candlestick_rows_to_frame([sdk_candle])
        self.assertEqual(sdk_daily_frame["Date"].tolist(), [pd.Timestamp("2026-07-14")])

    def test_cli_one_minute_history_is_offline_and_uses_normalized_arguments(self) -> None:
        settings = self._longbridge_settings()
        payload = [{
            "time": "2026-07-14T13:30:00Z",
            "open": "100",
            "high": "101",
            "low": "99",
            "close": "100.5",
            "volume": "1000",
            "turnover": "100500",
        }]
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=payload,
        ) as cli_json:
            frame = fetch_longbridge_one_minute_history("AAPL", settings)

        arguments = cli_json.call_args.args[1]
        self.assertEqual(arguments[:5], ["kline", "history", "AAPL.US", "--period", "1m"])
        self.assertEqual(frame["Date"].tolist(), [pd.Timestamp("2026-07-14 09:30")])

    def test_cli_daily_history_applies_since_filter_without_network(self) -> None:
        settings = self._longbridge_settings()
        payload = [{
            "time": "2026-07-14T13:30:00Z",
            "open": "100",
            "high": "101",
            "low": "99",
            "close": "100.5",
            "volume": "1000",
            "turnover": "100500",
        }]
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=payload,
        ) as cli_json:
            frame = fetch_longbridge_daily_history(
                "AAPL",
                settings,
                since=datetime(2026, 7, 13),
            )

        arguments = cli_json.call_args.args[1]
        self.assertEqual(arguments[:5], ["kline", "history", "AAPL.US", "--period", "day"])
        self.assertEqual(arguments[arguments.index("--adjust") + 1], "none")
        self.assertEqual(frame["Date"].tolist(), [pd.Timestamp("2026-07-14")])

    def test_daily_history_uses_raw_longbridge_adjustment(self) -> None:
        adjustment = SimpleNamespace(NoAdjust="none", ForwardAdjust="forward")

        self.assertEqual(_resolve_longbridge_daily_adjust_type(adjustment), "none")

    def test_cli_overnight_history_canonicalizes_skhynix_symbol(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=longbridge_candlestick_rows(),
        ) as cli_json:
            frame = fetch_longbridge_compare_one_day_history("SKHYV", settings)

        arguments = cli_json.call_args.args[1]
        self.assertEqual(arguments[:2], ["kline", "SKHY.US"])
        self.assertIn("all", arguments)
        self.assertTrue(cli_json.call_args.kwargs["enable_overnight"])
        self.assertEqual(
            frame["Date"].tolist(),
            [pd.Timestamp("2026-07-13 20:00"), pd.Timestamp("2026-07-14 01:00")],
        )
        self.assertEqual(frame["Session"].tolist(), ["overnight", "overnight"])

    def test_cli_historical_overnight_uses_bounded_five_minute_window(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        with patch(
            "app.infrastructure.broker_market_data.run_longbridge_cli_json",
            return_value=longbridge_candlestick_rows(),
        ) as cli_json:
            fetch_longbridge_compare_one_day_history(
                "SKHY",
                settings,
                trading_date="2026-07-13",
            )

        arguments = cli_json.call_args.args[1]
        self.assertEqual(arguments[:3], ["kline", "history", "SKHY.US"])
        self.assertEqual(arguments[arguments.index("--period") + 1], "5m")
        self.assertEqual(arguments[arguments.index("--start") + 1], "2026-07-12")
        self.assertEqual(arguments[arguments.index("--end") + 1], "2026-07-13")
        self.assertEqual(arguments[arguments.index("--session") + 1], "all")
        self.assertTrue(cli_json.call_args.kwargs["enable_overnight"])

    def test_parse_longbridge_naive_timestamp_as_hong_kong_time(self) -> None:
        parsed = _parse_longbridge_timestamp("2026-03-27 21:30:00")

        self.assertEqual(str(parsed.tzinfo), "Asia/Hong_Kong")
        self.assertEqual(parsed.strftime("%Y-%m-%d %H:%M"), "2026-03-27 21:30")

    def test_candlestick_rows_convert_hkt_regular_session_to_new_york_dst(self) -> None:
        frame = _candlestick_rows_to_frame(
            [
                SimpleNamespace(
                    timestamp="2026-03-27 21:30:00",
                    open=100.0,
                    high=101.0,
                    low=99.0,
                    close=100.5,
                    volume=1_000,
                    turnover=100_500,
                ),
                SimpleNamespace(
                    timestamp="2026-03-28 04:00:00",
                    open=101.0,
                    high=102.0,
                    low=100.0,
                    close=101.5,
                    volume=900,
                    turnover=91_350,
                ),
            ]
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(frame.iloc[0]["Date"], pd.Timestamp("2026-03-27 09:30:00"))

    def test_candlestick_rows_convert_hkt_regular_session_to_new_york_standard_time(self) -> None:
        frame = _candlestick_rows_to_frame(
            [
                SimpleNamespace(
                    timestamp="2026-11-20 22:30:00",
                    open=100.0,
                    high=101.0,
                    low=99.0,
                    close=100.5,
                    volume=1_000,
                    turnover=100_500,
                )
            ]
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(frame.iloc[0]["Date"], pd.Timestamp("2026-11-20 09:30:00"))

    def test_normalize_one_minute_store_frame_migrates_hkt_wall_time_cache(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-03-27 21:30:00", "2026-03-27 21:31:00", "2026-03-28 04:00:00"]),
                "Open": [100.0, 101.0, 102.0],
                "High": [101.0, 102.0, 103.0],
                "Low": [99.0, 100.0, 101.0],
                "Close": [100.5, 101.5, 102.5],
                "Volume": [1_000, 1_100, 1_200],
                "Turnover": [100_500, 111_650, 123_000],
                "Dividends": [float("nan"), None, 0.25],
            }
        )

        normalized = normalize_one_minute_store_frame(dataset)

        self.assertEqual(normalized["Date"].tolist(), [pd.Timestamp("2026-03-27 09:30:00"), pd.Timestamp("2026-03-27 09:31:00")])
        self.assertEqual(normalized["Dividends"].tolist(), [0.0, 0.0])

    def test_normalize_one_minute_store_frame_keeps_hk_regular_session(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": [
                    _ny_naive_from_local("2026-07-03 09:30", "Asia/Hong_Kong"),
                    _ny_naive_from_local("2026-07-03 12:30", "Asia/Hong_Kong"),
                    _ny_naive_from_local("2026-07-03 13:00", "Asia/Hong_Kong"),
                    _ny_naive_from_local("2026-07-03 15:59", "Asia/Hong_Kong"),
                ],
                "Open": [100.0, 101.0, 102.0, 103.0],
                "High": [101.0, 102.0, 103.0, 104.0],
                "Low": [99.0, 100.0, 101.0, 102.0],
                "Close": [100.5, 101.5, 102.5, 103.5],
            }
        )

        normalized = normalize_one_minute_store_frame(dataset, "7709.HK")

        self.assertEqual(
            normalized["Date"].tolist(),
            [
                _ny_naive_from_local("2026-07-03 09:30", "Asia/Hong_Kong"),
                _ny_naive_from_local("2026-07-03 13:00", "Asia/Hong_Kong"),
                _ny_naive_from_local("2026-07-03 15:59", "Asia/Hong_Kong"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
