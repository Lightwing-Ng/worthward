"""
Tests for authoritative historical market-cap derivation.

Code version: v0.9.1
"""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from app.services import market_cap
from app.services.market_cap import (
    build_market_cap_history,
    build_market_cap_series_payload,
    fetch_reported_shares,
    resolve_stock_split_events,
)


class _TickerWithShares:
    def get_shares_full(self, start=None, end=None):
        del start, end
        return pd.Series(
            [10.0, 20.0],
            index=pd.to_datetime(["2026-01-01", "2026-01-03"], utc=True),
        )


class _TickerWithSplits:
    def __init__(self, values: pd.Series):
        self.values = values

    def get_splits(self, period="max"):
        if period != "max":
            raise AssertionError(f"Unexpected split period: {period}")
        return self.values


class _TickerWithoutShares:
    def get_shares_full(self, start=None, end=None):
        del start, end
        return pd.Series(dtype="float64")


class MarketCapTests(unittest.TestCase):
    def test_non_us_market_cap_is_converted_with_each_day_usd_fx_close(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-07-13 04:00", "2026-07-14 04:00"], utc=True),
            "Close": [100.0, 120.0],
        })
        shares = pd.DataFrame({
            "Date": pd.to_datetime(["2026-01-01"]),
            "Shares": [10.0],
        })
        fx_history = pd.DataFrame(
            {"Close": [8.0, 7.5]},
            index=pd.to_datetime(["2026-07-13", "2026-07-14"]),
        )
        with tempfile.TemporaryDirectory() as tempdir:
            fx_path = Path(tempdir) / "fx" / "HKD.parquet"
            with (
                patch("app.services.market_cap.fetch_reported_shares", return_value=shares),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
                patch("app.services.market_cap.fx_store_path_for", return_value=fx_path),
                patch(
                    "app.services.market_cap.download_yahoo_chart_daily_history",
                    return_value=fx_history,
                ) as fx_download,
            ):
                payload = build_market_cap_series_payload("0700.HK", prices)

        self.assertEqual(payload.market_caps, [125.0, 160.0])
        self.assertEqual(payload.raw_dates, ["2026-07-13 00:00", "2026-07-14 00:00"])
        self.assertEqual(payload.market_cap_currency, "USD")
        self.assertEqual(payload.market_cap_source, "cached_reported_shares_converted_to_usd")
        self.assertEqual(fx_download.call_args.args[0], "HKD=X")
        self.assertEqual(market_cap.market_currency_for_ticker("NESN.SW"), "CHF")
        self.assertEqual(market_cap.market_currency_for_ticker("NOVO-B.CO"), "DKK")
        self.assertEqual(market_cap.market_currency_for_ticker("EQNR.OL"), "NOK")
        self.assertEqual(market_cap.market_currency_for_ticker("VOLV-B.ST"), "SEK")
        self.assertEqual(market_cap.market_currency_for_ticker("GARAN.IS"), "TRY")
        self.assertEqual(market_cap.market_currency_for_ticker("CDR.WA"), "PLN")

    def test_reported_shares_cache_hit_restores_persisted_yfinance_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            with patch(
                "app.services.market_cap.shares_store_path_for",
                return_value=isolated_path,
            ):
                with patch(
                    "app.services.market_cap.yf.Ticker",
                    return_value=_TickerWithShares(),
                ) as ticker_factory:
                    refreshed = fetch_reported_shares(
                        "AAPL",
                        pd.Timestamp("2026-01-01"),
                        pd.Timestamp("2026-01-03"),
                    )

                persisted = pd.read_parquet(isolated_path)
                with patch(
                    "app.services.market_cap.yf.Ticker",
                    side_effect=AssertionError("A fresh cache hit must not fetch remote shares"),
                ):
                    cached = fetch_reported_shares(
                        "AAPL",
                        pd.Timestamp("2026-01-01"),
                        pd.Timestamp("2026-01-03"),
                    )
                    payload = build_market_cap_series_payload(
                        "AAPL",
                        pd.DataFrame({
                            "Date": pd.to_datetime(["2026-01-01", "2026-01-03"]),
                            "Close": [100.0, 120.0],
                        }),
                    )

        self.assertEqual(ticker_factory.call_count, 1)
        self.assertEqual(refreshed.attrs["reported_shares_source"], "yfinance_reported_shares")
        self.assertEqual(persisted.attrs["reported_shares_source"], "yfinance_reported_shares")
        self.assertEqual(cached.attrs["reported_shares_source"], "yfinance_reported_shares")
        self.assertEqual(payload.market_cap_source, "yfinance_reported_shares")

    def test_reported_shares_merges_cached_and_sec_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            with patch(
                "app.services.market_cap.shares_store_path_for",
                return_value=isolated_path,
            ):
                with patch(
                    "app.services.market_cap.yf.Ticker",
                    return_value=_TickerWithShares(),
                ):
                    fetch_reported_shares(
                        "AAPL",
                        pd.Timestamp("2026-01-01"),
                        pd.Timestamp("2026-01-03"),
                    )

                os.utime(isolated_path, (0, 0))
                sec_shares = pd.DataFrame({
                    "Date": pd.to_datetime(["2026-01-05"]),
                    "Shares": [30.0],
                })
                with (
                    patch(
                        "app.services.market_cap.yf.Ticker",
                        return_value=_TickerWithoutShares(),
                    ),
                    patch(
                        "app.services.market_cap.fetch_sec_reported_shares",
                        return_value=sec_shares,
                    ),
                ):
                    merged = fetch_reported_shares(
                        "AAPL",
                        pd.Timestamp("2026-01-01"),
                        pd.Timestamp("2026-01-05"),
                    )

                persisted = pd.read_parquet(isolated_path)

        self.assertEqual(merged.attrs["reported_shares_source"], "merged_yfinance_and_sec_reported_shares")
        self.assertEqual(persisted.attrs["reported_shares_source"], "merged_yfinance_and_sec_reported_shares")

    def test_legacy_reported_shares_cache_uses_explicit_cached_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            isolated_path.parent.mkdir(parents=True)
            pd.DataFrame({
                "Date": pd.to_datetime(["2026-01-01"]),
                "Shares": [10.0],
            }).to_parquet(isolated_path, index=False)
            with (
                patch("app.services.market_cap.shares_store_path_for", return_value=isolated_path),
                patch(
                    "app.services.market_cap.yf.Ticker",
                    side_effect=AssertionError("A fresh cache hit must not fetch remote shares"),
                ),
            ):
                cached = fetch_reported_shares(
                    "AAPL",
                    pd.Timestamp("2026-01-01"),
                    pd.Timestamp("2026-01-01"),
                )

        self.assertEqual(cached.attrs["reported_shares_source"], "cached_reported_shares")

    def test_yfinance_history_remains_complete_without_longbridge(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-01-02", "2026-01-03"]),
            "Close": [100.0, 120.0],
        })
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            with (
                patch("app.services.market_cap.shares_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.yf.Ticker", return_value=_TickerWithShares()),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=True),
                patch("app.services.market_cap.fetch_longbridge_market_cap_snapshot", return_value=None),
            ):
                result = build_market_cap_history("AAPL", prices)

        self.assertEqual(result["MarketCap"].tolist(), [1_000.0, 2_400.0])
        self.assertEqual(result.attrs["market_cap_source"], "yfinance_reported_shares")
        self.assertIsNone(result.attrs["market_cap_cross_check"])

    def test_longbridge_provider_exception_preserves_yfinance_history(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-01-02", "2026-01-03"]),
            "Close": [100.0, 120.0],
        })
        market_cap._LONGBRIDGE_SNAPSHOT_CACHE.clear()
        self.addCleanup(market_cap._LONGBRIDGE_SNAPSHOT_CACHE.clear)
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            with (
                patch("app.services.market_cap.shares_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.yf.Ticker", return_value=_TickerWithShares()),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=True),
                patch("app.services.market_cap.load_broker_settings", return_value=object()),
                patch(
                    "app.services.market_cap.fetch_longbridge_market_cap_snapshot_from_provider",
                    side_effect=RuntimeError("Longbridge unavailable"),
                ) as provider,
            ):
                result = build_market_cap_history("AAPL", prices)

        self.assertEqual(provider.call_count, 1)
        self.assertEqual(result["MarketCap"].tolist(), [1_000.0, 2_400.0])
        self.assertEqual(result.attrs["market_cap_source"], "yfinance_reported_shares")
        self.assertIsNone(result.attrs["market_cap_cross_check"])

    def test_market_cap_resolves_missing_split_events_from_yfinance(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2024-07-17", "2024-08-29"]),
            "Close": [117.99, 117.59],
        })
        reported_shares = pd.DataFrame({
            "Date": pd.to_datetime(["2024-05-29", "2024-08-28"]),
            "Shares": [2_460_000_000.0, 24_530_000_000.0],
        })
        yfinance_splits = pd.Series(
            [10.0],
            index=pd.to_datetime(["2024-06-10"], utc=True),
        )
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "splits" / "NVDA.parquet"
            with (
                patch("app.services.market_cap.splits_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.fetch_reported_shares", return_value=reported_shares),
                patch("app.services.market_cap.yf.Ticker", return_value=_TickerWithSplits(yfinance_splits)),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
            ):
                result = build_market_cap_history(
                    "NVDA",
                    prices,
                    resolve_missing_split_events=True,
                )
                cached = pd.read_parquet(isolated_path)

        self.assertEqual(cached["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2024-06-10"])
        self.assertEqual(cached["Factor"].tolist(), [10.0])
        self.assertEqual(result["MarketCap"].tolist(), [
            2_902_554_000_000.0,
            2_884_482_700_000.0,
        ])

    def test_split_events_fall_back_to_yahoo_chart_when_yfinance_is_empty(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2024-07-17"]),
            "Close": [117.99],
        })
        yahoo_history = pd.DataFrame(
            {
                "Close": [120.0, 117.99],
                "Stock Splits": [10.0, 0.0],
            },
            index=pd.to_datetime(["2024-06-10", "2024-07-17"]),
        )
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "splits" / "NVDA.parquet"
            with (
                patch("app.services.market_cap.splits_store_path_for", return_value=isolated_path),
                patch(
                    "app.services.market_cap.yf.Ticker",
                    return_value=_TickerWithSplits(pd.Series(dtype="float64")),
                ),
                patch(
                    "app.services.market_cap.download_yahoo_chart_daily_history",
                    return_value=yahoo_history,
                ),
            ):
                result = resolve_stock_split_events("NVDA", prices)

        self.assertEqual(result["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2024-06-10"])
        self.assertEqual(result["Factor"].tolist(), [10.0])
        self.assertEqual(result.attrs["stock_split_source"], "yahoo_chart_corporate_actions")

    def test_authoritative_empty_split_actions_do_not_trigger_remote_fallback(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2024-07-17"]),
            "Close": [100.0],
            "Stock Splits": [0.0],
        })
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "splits" / "QQQ.parquet"
            with (
                patch("app.services.market_cap.splits_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.yf.Ticker", side_effect=AssertionError("unexpected yfinance request")),
                patch(
                    "app.services.market_cap.download_yahoo_chart_daily_history",
                    side_effect=AssertionError("unexpected Yahoo Chart request"),
                ),
            ):
                result = resolve_stock_split_events(
                    "QQQ",
                    prices,
                    embedded_events_are_authoritative=True,
                )

        self.assertTrue(result.empty)
        self.assertEqual(result.attrs["stock_split_source"], "price_history")

    def test_market_cap_aligns_pre_split_reports_with_split_adjusted_prices(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2024-07-17", "2024-08-29"]),
            "Close": [117.99, 117.59],
        })
        reported_shares = pd.DataFrame({
            "Date": pd.to_datetime(["2024-05-29", "2024-08-28"]),
            "Shares": [2_460_000_000.0, 24_530_000_000.0],
        })
        split_events = pd.DataFrame({
            "Date": pd.to_datetime(["2024-06-10"]),
            "Factor": [10.0],
        })
        with (
            patch("app.services.market_cap.fetch_reported_shares", return_value=reported_shares),
            patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
        ):
            result = build_market_cap_history("NVDA", prices, split_events)

        self.assertEqual(result["MarketCap"].tolist(), [
            2_902_554_000_000.0,
            2_884_482_700_000.0,
        ])

    def test_market_cap_does_not_treat_ordinary_share_changes_as_splits(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2025-01-02", "2025-04-02"]),
            "Close": [100.0, 110.0],
        })
        reported_shares = pd.DataFrame({
            "Date": pd.to_datetime(["2025-01-01", "2025-04-01"]),
            "Shares": [15_800_000_000.0, 15_500_000_000.0],
        })
        with (
            patch("app.services.market_cap.fetch_reported_shares", return_value=reported_shares),
            patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
        ):
            result = build_market_cap_history("AAPL", prices)

        self.assertEqual(result["MarketCap"].tolist(), [
            1_580_000_000_000.0,
            1_705_000_000_000.0,
        ])

    def test_market_cap_uses_latest_reported_shares_without_backfilling_unknown_history(self) -> None:
        prices = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-12-31", "2026-01-02", "2026-01-03"]),
                "Close": [90.0, 100.0, 120.0],
            }
        )
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "QQQ.parquet"
            with (
                patch("app.services.market_cap.shares_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.yf.Ticker", return_value=_TickerWithShares()),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
            ):
                result = build_market_cap_history("QQQ", prices)

        self.assertTrue(pd.isna(result.loc[0, "MarketCap"]))
        self.assertEqual(result.loc[1:, "MarketCap"].tolist(), [1_000.0, 2_400.0])

    def test_longbridge_cross_checks_and_owns_only_the_latest_market_cap_point(self) -> None:
        prices = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-10", "2026-07-13", "2026-07-14"]),
                "Close": [100.0, 110.0, 120.0],
            }
        )
        with tempfile.TemporaryDirectory() as tempdir:
            isolated_path = Path(tempdir) / "shares" / "AAPL.parquet"
            with (
                patch("app.services.market_cap.shares_store_path_for", return_value=isolated_path),
                patch("app.services.market_cap.yf.Ticker", return_value=_TickerWithShares()),
                patch("app.services.market_cap._is_recent_market_cap_window", return_value=True),
                patch(
                    "app.services.market_cap.fetch_longbridge_market_cap_snapshot",
                    return_value={
                        "symbol": "AAPL.US",
                        "last_done": 125.0,
                        "market_cap": 2_525.0,
                        "implied_shares": 20.2,
                    },
                ),
            ):
                payload = build_market_cap_series_payload("AAPL", prices)

        self.assertEqual(payload.market_caps, [2_000.0, 2_200.0, 2_424.0])
        self.assertEqual(payload.market_cap_source, "longbridge_current_with_yfinance_reported_shares_history")
        self.assertEqual(payload.market_cap_cross_check["status"], "matched")
        self.assertAlmostEqual(payload.market_cap_cross_check["delta_percent"], -0.9901, places=4)

    def test_longbridge_current_point_survives_when_yfinance_shares_are_unavailable(self) -> None:
        prices = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-13", "2026-07-14"]),
                "Close": [110.0, 120.0],
            }
        )
        with (
            patch("app.services.market_cap.fetch_reported_shares", return_value=pd.DataFrame()),
            patch("app.services.market_cap.fetch_sec_fund_net_assets", return_value=pd.DataFrame()),
            patch("app.services.market_cap._is_recent_market_cap_window", return_value=True),
            patch(
                "app.services.market_cap.fetch_longbridge_market_cap_snapshot",
                return_value={
                    "symbol": "AAPL.US",
                    "last_done": 125.0,
                    "market_cap": 2_500.0,
                    "implied_shares": 20.0,
                },
            ),
        ):
            result = build_market_cap_history("AAPL", prices)

        self.assertTrue(pd.isna(result.loc[0, "MarketCap"]))
        self.assertEqual(result.loc[1, "MarketCap"], 2_400.0)
        self.assertEqual(result.attrs["market_cap_source"], "longbridge_current")
        self.assertIsNone(result.attrs["market_cap_cross_check"])

    def test_longbridge_fractional_implied_shares_replace_integer_history(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-07-13", "2026-07-14"]),
            "Close": [100.0, 120.0],
        })
        shares = pd.DataFrame({
            "Date": pd.Series(
                pd.to_datetime(["2026-01-01", "2026-04-01"]).values.astype("datetime64[ns]")
            ),
            "Shares": pd.Series([7_500_000_000, 7_400_000_000], dtype="int64"),
        })
        implied_shares = 7_428_434_703.999999
        with (
            patch("app.services.market_cap.fetch_reported_shares", return_value=shares),
            patch("app.services.market_cap._is_recent_market_cap_window", return_value=True),
            patch(
                "app.services.market_cap.fetch_longbridge_market_cap_snapshot",
                return_value={
                    "symbol": "AAPL.US",
                    "last_done": 120.0,
                    "market_cap": 120.0 * implied_shares,
                    "implied_shares": implied_shares,
                },
            ),
        ):
            result = build_market_cap_history("AAPL", prices)

        self.assertEqual(result.loc[0, "MarketCap"], 740_000_000_000.0)
        self.assertEqual(result.loc[1, "MarketCap"], 120.0 * implied_shares)

    def test_sec_fund_net_assets_supply_a_disclosed_etf_history(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-01-01", "2026-02-01", "2026-03-01"]),
            "Close": [100.0, 110.0, 120.0],
        })
        sec_history = pd.DataFrame({
            "Date": pd.Series(
                pd.to_datetime(["2026-01-15", "2026-02-15"]).values.astype("datetime64[us]")
            ),
            "MarketCap": [400_000_000_000.0, 410_000_000_000.0],
        })
        with (
            patch("app.services.market_cap.fetch_reported_shares", return_value=pd.DataFrame()),
            patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
            patch("app.services.market_cap.fetch_sec_fund_net_assets", return_value=sec_history),
        ):
            result = build_market_cap_history("QQQ", prices)

        self.assertTrue(pd.isna(result.loc[0, "MarketCap"]))
        self.assertEqual(result.loc[1:, "MarketCap"].tolist(), [400_000_000_000.0, 410_000_000_000.0])
        self.assertEqual(result.attrs["market_cap_source"], "sec_nport_net_assets")


if __name__ == "__main__":
    unittest.main()
