"""Korean listed-equity market-cap comparison coverage.

Code version: v0.2.0
"""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

from app.services.market_cap import build_market_cap_series_payload


class KoreanMarketCapTests(unittest.TestCase):
    def test_korean_market_caps_use_total_reported_shares_and_daily_krw_usd_closes(self) -> None:
        prices = pd.DataFrame({
            "Date": pd.to_datetime(["2026-07-13 04:00", "2026-07-14 04:00"], utc=True),
            "Close": [100_000.0, 120_000.0],
        })
        reported_shares = pd.DataFrame({
            "Date": pd.to_datetime(["2026-01-01"]),
            "Shares": [10_000_000.0],
        })
        krw_usd_history = pd.DataFrame(
            {"Close": [1_000.0, 1_200.0]},
            index=pd.to_datetime(["2026-07-13", "2026-07-14"]),
        )

        for ticker in ("005930.KS", "000660.KS"):
            with self.subTest(ticker=ticker), tempfile.TemporaryDirectory() as tempdir:
                fx_path = Path(tempdir) / "fx" / "KRW.parquet"
                with (
                    patch("app.services.market_cap.fetch_reported_shares", return_value=reported_shares),
                    patch("app.services.market_cap._is_recent_market_cap_window", return_value=False),
                    patch("app.services.market_cap.fx_store_path_for", return_value=fx_path),
                    patch(
                        "app.services.market_cap.download_yahoo_chart_daily_history",
                        return_value=krw_usd_history,
                    ) as fx_download,
                ):
                    payload = build_market_cap_series_payload(ticker, prices)

            self.assertEqual(payload.market_caps, [1_000_000_000.0, 1_000_000_000.0])
            self.assertEqual(payload.market_cap_currency, "USD")
            self.assertEqual(payload.market_cap_source, "cached_reported_shares_converted_to_usd")
            self.assertEqual(fx_download.call_args.args[0], "KRW=X")
