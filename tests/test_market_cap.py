"""
Tests for authoritative historical market-cap derivation.

Code version: v0.2.0
"""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from app.services.market_cap import build_market_cap_history, build_market_cap_series_payload


class _TickerWithShares:
    def get_shares_full(self, start=None, end=None):
        del start, end
        return pd.Series(
            [10.0, 20.0],
            index=pd.to_datetime(["2026-01-01", "2026-01-03"], utc=True),
        )


class MarketCapTests(unittest.TestCase):
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
        self.assertEqual(payload.market_cap_source, "longbridge_current_with_yfinance_history")
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


if __name__ == "__main__":
    unittest.main()
