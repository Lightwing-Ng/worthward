"""
Tests for comparison logic.

Code version: v0.5.2
"""

from __future__ import annotations

import unittest

import pandas as pd

from app.services.comparisons import (
    align_datasets_on_common_dates,
    build_series_payload,
    latest_common_start,
    resolve_effective_period_for_datasets,
    slice_dataset_for_period,
    slice_datasets_for_compare_period,
    slice_intraday_datasets_for_compare_period,
)


class ComparisonServiceTests(unittest.TestCase):
    def _ny_naive_from_local(self, value: str, timezone: str) -> pd.Timestamp:
        return pd.Timestamp(value).tz_localize(timezone).tz_convert("America/New_York").tz_localize(None)

    def test_align_datasets_uses_shared_dates_only(self) -> None:
        dataset_a = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-02", "2026-01-03", "2026-01-06"]),
                "Close": [100.0, 101.0, 103.0],
            }
        )
        dataset_b = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-03", "2026-01-06", "2026-01-07"]),
                "Close": [200.0, 202.0, 204.0],
            }
        )

        aligned_a, aligned_b = align_datasets_on_common_dates(dataset_a, dataset_b)

        self.assertEqual(aligned_a["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2026-01-03", "2026-01-06"])
        self.assertEqual(aligned_b["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2026-01-03", "2026-01-06"])

    def test_build_series_payload_uses_first_shared_row_as_baseline(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-03", "2026-01-06"]),
                "Close": [100.0, 110.0],
            }
        )

        payload = build_series_payload("AAPL", dataset)

        self.assertEqual(payload.normalized_returns, [0.0, 10.0])

    def test_build_series_payload_keeps_intraday_timestamps(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-03 09:30", "2026-01-03 16:00"]),
                "Close": [100.0, 110.0],
            }
        )

        payload = build_series_payload("AAPL", dataset)

        self.assertEqual(payload.raw_dates, ["2026-01-03 09:30", "2026-01-03 16:00"])
        self.assertTrue(payload.dates[0].endswith("09:30"))

    def test_build_series_payload_adds_normalized_intraday_candles(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-03 09:30", "2026-01-03 09:31"]),
                "Open": [100.0, 102.0],
                "High": [103.0, 104.0],
                "Low": [99.0, 101.0],
                "Close": [102.0, 103.0],
            }
        )

        payload = build_series_payload("AAPL", dataset)

        self.assertEqual(payload.normalized_returns, [2.0, 3.0])
        self.assertEqual(
            payload.candlestick_returns,
            [
                {"x": 0, "o": 0.0, "h": 3.0, "l": -1.0, "c": 2.0},
                {"x": 1, "o": 2.0, "h": 4.0, "l": 1.0, "c": 3.0},
            ],
        )

    def test_latest_common_start_uses_most_recent_listing_date(self) -> None:
        datasets = [
            pd.DataFrame({"Date": pd.to_datetime(["2023-05-01", "2026-01-01"]), "Close": [100.0, 110.0]}),
            pd.DataFrame({"Date": pd.to_datetime(["2022-02-01", "2026-01-01"]), "Close": [200.0, 220.0]}),
            pd.DataFrame({"Date": pd.to_datetime(["2024-09-01", "2026-01-01"]), "Close": [300.0, 330.0]}),
        ]

        self.assertEqual(latest_common_start(datasets), pd.Timestamp("2024-09-01"))

    def test_slice_datasets_for_compare_period_max_starts_at_latest_listing(self) -> None:
        datasets = [
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2023-05-01", "2024-09-01", "2026-01-01"]),
                    "Close": [100.0, 105.0, 110.0],
                }
            ),
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2022-02-01", "2024-09-01", "2026-01-01"]),
                    "Close": [200.0, 210.0, 220.0],
                }
            ),
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2024-09-01", "2026-01-01"]),
                    "Close": [300.0, 330.0],
                }
            ),
        ]

        aligned = slice_datasets_for_compare_period(datasets, "max", pd.Timestamp("2026-01-01"))

        self.assertEqual(len(aligned), 3)
        self.assertEqual(aligned[0]["Date"].min(), pd.Timestamp("2024-09-01"))
        self.assertEqual(aligned[2]["Date"].min(), pd.Timestamp("2024-09-01"))

    def test_resolve_effective_period_for_datasets_reports_compare_start_for_max(self) -> None:
        datasets = [
            pd.DataFrame({"Date": pd.to_datetime(["2023-05-01", "2026-01-01"]), "Close": [100.0, 110.0]}),
            pd.DataFrame({"Date": pd.to_datetime(["2024-09-01", "2026-01-01"]), "Close": [300.0, 330.0]}),
        ]

        period, notice = resolve_effective_period_for_datasets("max", datasets)

        self.assertEqual(period, "max")
        self.assertEqual(notice, "Comparison starts from 1 Sep 2024.")

    def test_resolve_effective_period_for_datasets_falls_back_with_banner(self) -> None:
        datasets = [
            pd.DataFrame({"Date": pd.to_datetime(["2024-08-01", "2026-03-27"]), "Close": [50.0, 55.0]}),
            pd.DataFrame({"Date": pd.to_datetime(["2020-03-27", "2026-03-27"]), "Close": [100.0, 120.0]}),
        ]

        period, notice = resolve_effective_period_for_datasets("5y", datasets)

        self.assertEqual(period, "5y")
        self.assertIn("Requested period 5 years exceeds the shared trading history.", notice or "")
        self.assertIn("Using the latest available start date among the selected tickers: 1 Aug 2024.", notice or "")

    def test_slice_dataset_for_period_uses_reference_end_date(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-31", "2025-02-28", "2025-03-31"]),
                "Close": [100.0, 105.0, 110.0],
            }
        )

        sliced = slice_dataset_for_period(dataset, "1mo", pd.Timestamp("2025-03-31"))

        self.assertEqual(sliced["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2025-02-28", "2025-03-31"])

    def test_slice_intraday_datasets_for_compare_period_keeps_current_day_extended_hours(self) -> None:
        datasets = [
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"]),
                    "Open": [99.0, 100.0, 101.0, 102.0],
                    "High": [101.0, 102.0, 103.0, 104.0],
                    "Low": [98.0, 99.0, 100.0, 101.0],
                    "Close": [100.0, 101.0, 102.0, 103.0],
                }
            ),
            pd.DataFrame(
                {
                    "Date": pd.to_datetime(["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"]),
                    "Open": [199.0, 200.0, 201.0, 202.0],
                    "High": [201.0, 202.0, 203.0, 204.0],
                    "Low": [198.0, 199.0, 200.0, 201.0],
                    "Close": [200.0, 201.0, 202.0, 203.0],
                }
            ),
        ]

        aligned = slice_intraday_datasets_for_compare_period(datasets, "1d", pd.Timestamp("2026-03-27 16:30"))

        self.assertEqual(
            aligned[0]["Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(),
            ["2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 15:59", "2026-03-27 16:30"],
        )
        self.assertEqual(aligned[0]["Open"].tolist(), [99.0, 100.0, 101.0, 102.0])
        self.assertEqual(aligned[1]["High"].tolist(), [201.0, 202.0, 203.0, 204.0])

    def test_slice_intraday_datasets_for_compare_period_falls_back_to_previous_complete_day(self) -> None:
        datasets = [
            pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-26 08:00",
                        "2026-03-26 09:30",
                        "2026-03-26 15:59",
                        "2026-03-26 16:30",
                        "2026-03-27 08:00",
                        "2026-03-27 09:30",
                    ]),
                    "Open": [99.0, 100.0, 101.0, 102.0, 103.0, 104.0],
                    "High": [101.0, 102.0, 103.0, 104.0, 105.0, 106.0],
                    "Low": [98.0, 99.0, 100.0, 101.0, 102.0, 103.0],
                    "Close": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0],
                }
            ),
            pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-26 08:00",
                        "2026-03-26 09:30",
                        "2026-03-26 15:59",
                        "2026-03-26 16:30",
                        "2026-03-27 08:00",
                        "2026-03-27 09:30",
                    ]),
                    "Open": [199.0, 200.0, 201.0, 202.0, 203.0, 204.0],
                    "High": [201.0, 202.0, 203.0, 204.0, 205.0, 206.0],
                    "Low": [198.0, 199.0, 200.0, 201.0, 202.0, 203.0],
                    "Close": [200.0, 201.0, 202.0, 203.0, 204.0, 205.0],
                }
            ),
        ]

        aligned = slice_intraday_datasets_for_compare_period(datasets, "1d", pd.Timestamp("2026-03-27 09:30"))

        self.assertEqual(
            aligned[0]["Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(),
            ["2026-03-26 08:00", "2026-03-26 09:30", "2026-03-26 15:59", "2026-03-26 16:30"],
        )

    def test_slice_intraday_datasets_for_compare_period_uses_regular_session_for_multi_day_ranges(self) -> None:
        datasets = [
            pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-25 08:00", "2026-03-25 09:30", "2026-03-25 16:30",
                        "2026-03-26 08:00", "2026-03-26 09:30", "2026-03-26 16:30",
                        "2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 16:30",
                    ]),
                    "Close": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0],
                }
            ),
            pd.DataFrame(
                {
                    "Date": pd.to_datetime([
                        "2026-03-25 08:00", "2026-03-25 09:30", "2026-03-25 16:30",
                        "2026-03-26 08:00", "2026-03-26 09:30", "2026-03-26 16:30",
                        "2026-03-27 08:00", "2026-03-27 09:30", "2026-03-27 16:30",
                    ]),
                    "Close": [200.0, 201.0, 202.0, 203.0, 204.0, 205.0, 206.0, 207.0, 208.0],
                }
            ),
        ]

        aligned = slice_intraday_datasets_for_compare_period(datasets, "3d", pd.Timestamp("2026-03-27 16:30"))

        self.assertEqual(
            aligned[0]["Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(),
            ["2026-03-25 09:30", "2026-03-26 09:30", "2026-03-27 09:30"],
        )

    def test_slice_intraday_datasets_for_compare_period_aligns_krx_and_hk_one_day(self) -> None:
        krx_dataset = pd.DataFrame(
            {
                "Date": [
                    self._ny_naive_from_local("2026-07-03 09:00", "Asia/Seoul"),
                    self._ny_naive_from_local("2026-07-03 10:30", "Asia/Seoul"),
                    self._ny_naive_from_local("2026-07-03 14:00", "Asia/Seoul"),
                    self._ny_naive_from_local("2026-07-03 15:29", "Asia/Seoul"),
                    self._ny_naive_from_local("2026-07-03 15:30", "Asia/Seoul"),
                ],
                "Open": [100.0, 101.0, 102.0, 103.0, 104.0],
                "High": [101.0, 102.0, 103.0, 104.0, 105.0],
                "Low": [99.0, 100.0, 101.0, 102.0, 103.0],
                "Close": [100.5, 101.5, 102.5, 103.5, 104.5],
            }
        )
        hk_dataset = pd.DataFrame(
            {
                "Date": [
                    self._ny_naive_from_local("2026-07-03 09:30", "Asia/Hong_Kong"),
                    self._ny_naive_from_local("2026-07-03 12:30", "Asia/Hong_Kong"),
                    self._ny_naive_from_local("2026-07-03 13:00", "Asia/Hong_Kong"),
                    self._ny_naive_from_local("2026-07-03 14:29", "Asia/Hong_Kong"),
                    self._ny_naive_from_local("2026-07-03 15:59", "Asia/Hong_Kong"),
                ],
                "Open": [200.0, 201.0, 202.0, 203.0, 204.0],
                "High": [201.0, 202.0, 203.0, 204.0, 205.0],
                "Low": [199.0, 200.0, 201.0, 202.0, 203.0],
                "Close": [200.5, 201.5, 202.5, 203.5, 204.5],
            }
        )

        aligned = slice_intraday_datasets_for_compare_period(
            [krx_dataset, hk_dataset],
            "1d",
            pd.Timestamp("2026-07-03 04:00"),
            ["000660.KS", "7709.HK"],
        )

        # Cross-market 1d uses union of (NY-label) timestamps from both; each series keeps its values, NaN where the other has exclusive slots.
        expected_dates = ["2026-07-02 20:00", "2026-07-02 21:30", "2026-07-03 01:00", "2026-07-03 02:29", "2026-07-03 02:30", "2026-07-03 03:59"]
        self.assertEqual(aligned[0]["Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(), expected_dates)
        self.assertEqual(aligned[1]["Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(), expected_dates)
        # KR (index 0) values at its original slots, NaN at HK-only end
        self.assertTrue(pd.isna(aligned[0]["Open"].iloc[-1]))
        self.assertEqual(aligned[0]["Open"].iloc[0], 100.0)
        # HK (index 1) has NaN at KR early exclusive, values at its slots
        self.assertTrue(pd.isna(aligned[1]["Open"].iloc[0]))
        self.assertEqual(aligned[1]["Open"].iloc[-1], 204.0)


if __name__ == "__main__":
    unittest.main()
