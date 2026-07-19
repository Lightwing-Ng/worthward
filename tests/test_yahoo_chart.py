"""
Tests for the direct Yahoo Chart daily-history transport.

Code version: v0.3.0
"""

from __future__ import annotations

import io
import json
import unittest
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import pandas as pd

from app.infrastructure.yahoo_chart import (
    YahooChartError,
    download_yahoo_chart_daily_history,
    download_yahoo_chart_history,
)


class YahooChartTests(unittest.TestCase):
    def test_download_daily_history_preserves_ohlc_adjustments_and_dividends(self) -> None:
        payload = {
            "chart": {
                "error": None,
                "result": [{
                    "meta": {"exchangeTimezoneName": "America/New_York"},
                    "timestamp": [1775482200, 1775568600],
                    "indicators": {
                        "quote": [{
                            "open": [25.0, 26.0],
                            "high": [26.0, 27.0],
                            "low": [24.0, 25.0],
                            "close": [25.5, 26.5],
                        }],
                        "adjclose": [{"adjclose": [25.25, 26.5]}],
                    },
                    "events": {
                        "dividends": {
                            "1775568600": {
                                "date": 1775568600,
                                "amount": 0.25,
                            },
                        },
                        "splits": {
                            "1775482200": {
                                "date": 1775482200,
                                "numerator": 10.0,
                                "denominator": 1.0,
                                "splitRatio": "10:1",
                            },
                        },
                    },
                }],
            },
        }

        with patch(
            "app.infrastructure.yahoo_chart.urlopen",
            return_value=io.BytesIO(json.dumps(payload).encode("utf-8")),
        ) as urlopen_mock:
            frame = download_yahoo_chart_daily_history("QQQI", period="max")

        self.assertEqual(
            frame.index.tolist(),
            [pd.Timestamp("2026-04-06"), pd.Timestamp("2026-04-07")],
        )
        self.assertEqual(
            frame.columns.tolist(),
            ["Open", "High", "Low", "Close", "Adj Close", "Dividends", "Stock Splits"],
        )
        self.assertEqual(frame["Dividends"].tolist(), [0.0, 0.25])
        self.assertEqual(frame["Stock Splits"].tolist(), [10.0, 0.0])
        request_url = urlopen_mock.call_args.args[0].full_url
        query = parse_qs(urlparse(request_url).query)
        self.assertEqual(query["period1"], ["0"])
        self.assertEqual(query["interval"], ["1d"])
        self.assertNotIn("range", query)

    def test_download_daily_history_reports_yahoo_error_payload(self) -> None:
        payload = {
            "chart": {
                "error": {
                    "code": "Not Found",
                    "description": "No data found, symbol may be delisted",
                },
                "result": None,
            },
        }

        with patch(
            "app.infrastructure.yahoo_chart.urlopen",
            return_value=io.BytesIO(json.dumps(payload).encode("utf-8")),
        ):
            with self.assertRaises(YahooChartError) as raised:
                download_yahoo_chart_daily_history("UNKNOWN", period="5d")

        self.assertIn("Not Found", str(raised.exception))
        self.assertIn("symbol may be delisted", str(raised.exception))

    def test_download_intraday_history_keeps_utc_timestamps_and_volume(self) -> None:
        payload = {
            "chart": {
                "error": None,
                "result": [{
                    "meta": {"exchangeTimezoneName": "America/New_York"},
                    "timestamp": [1783603800],
                    "indicators": {
                        "quote": [{
                            "open": [100.0],
                            "high": [101.0],
                            "low": [99.0],
                            "close": [100.5],
                            "volume": [1234],
                        }],
                    },
                }],
            },
        }

        with patch(
            "app.infrastructure.yahoo_chart.urlopen",
            return_value=io.BytesIO(json.dumps(payload).encode("utf-8")),
        ):
            frame = download_yahoo_chart_history(
                "TQQQ",
                start="2026-07-08T13:30:00Z",
                end="2026-07-08T13:31:00Z",
            )

        self.assertEqual(frame.index[0], pd.Timestamp(1783603800, unit="s", tz="UTC"))
        self.assertEqual(frame.iloc[0]["Volume"], 1234)
