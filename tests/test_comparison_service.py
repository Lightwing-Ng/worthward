"""
Tests for comparison logic.

Code version: v0.8.3
"""

from __future__ import annotations

import unittest
import warnings

import pandas as pd

from app.services.comparisons import (
    _pad_dataset_to_market_session_close,
    align_intraday_datasets_for_compare,
    align_datasets_on_common_dates,
    build_series_payload,
    latest_common_start,
    market_trading_date_for_timestamp,
    resolve_effective_period_for_datasets,
    shift_intraday_compare_axis_to_trading_date,
    slice_dataset_for_period,
    slice_datasets_for_compare_period,
    slice_intraday_datasets_for_compare_period,
)
from tests.factories.market import ohlc_frame_for_dates


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

    def test_shift_intraday_compare_axis_preserves_geometry_on_live_trading_date(self) -> None:
        reference = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-12 20:00", "2026-07-13 03:59"]),
                "Close": [100.0, 101.0],
            }
        )

        shifted = shift_intraday_compare_axis_to_trading_date(
            reference,
            source_trading_date="2026-07-13",
            target_trading_date="2026-07-14",
        )

        self.assertEqual(
            shifted["Date"].tolist(),
            [pd.Timestamp("2026-07-13 20:00"), pd.Timestamp("2026-07-14 03:59")],
        )
        self.assertEqual(shifted["Close"].tolist(), [100.0, 101.0])
        self.assertEqual(
            shifted["Date"].iloc[-1] - shifted["Date"].iloc[0],
            reference["Date"].iloc[-1] - reference["Date"].iloc[0],
        )

    def test_market_session_close_padding_avoids_all_na_concat_inference(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-03 02:27"]),
                "Close": [100.0],
                "Turnover": pd.Series([pd.NA], dtype="Float64"),
            }
        )

        with warnings.catch_warnings():
            warnings.simplefilter("error", FutureWarning)
            padded = _pad_dataset_to_market_session_close(dataset, "000660.KS")

        self.assertEqual(
            padded["Date"].tolist(),
            pd.to_datetime([
                "2026-07-03 02:27",
                "2026-07-03 02:28",
                "2026-07-03 02:29",
                "2026-07-03 02:30",
            ]).tolist(),
        )
        self.assertEqual(padded["Close"].iloc[0], 100.0)
        self.assertTrue(pd.isna(padded["Close"].iloc[1]))
        self.assertEqual(str(padded["Turnover"].dtype), "Float64")

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
        self.assertEqual(
            payload.candlestick_prices,
            [
                {"x": 0, "o": 100.0, "h": 103.0, "l": 99.0, "c": 102.0},
                {"x": 1, "o": 102.0, "h": 104.0, "l": 101.0, "c": 103.0},
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

    def test_resolve_effective_period_allows_partial_new_listing_history(self) -> None:
        datasets = [
            pd.DataFrame({"Date": pd.to_datetime(["2024-08-01", "2026-03-27"]), "Close": [50.0, 55.0]}),
            pd.DataFrame({"Date": pd.to_datetime(["2020-03-27", "2026-03-27"]), "Close": [100.0, 120.0]}),
        ]

        period, notice = resolve_effective_period_for_datasets("5y", datasets)

        self.assertEqual(period, "5y")
        self.assertIsNone(notice)

    def test_six_month_daily_compare_preserves_history_before_new_listing(self) -> None:
        established = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-01-10", "2026-06-16", "2026-07-10"]),
                "Close": [100.0, 110.0, 105.0],
            }
        )
        newly_listed = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-06-16", "2026-07-10"]),
                "Close": [50.0, 48.0],
            }
        )

        aligned = slice_datasets_for_compare_period(
            [established, newly_listed],
            "6mo",
            pd.Timestamp("2026-07-10"),
        )

        self.assertEqual(aligned[0]["Date"].min(), pd.Timestamp("2026-01-10"))
        self.assertTrue(pd.isna(aligned[1].loc[aligned[1]["Date"] < pd.Timestamp("2026-06-16"), "Close"]).all())
        self.assertEqual(aligned[1].loc[aligned[1]["Date"] == pd.Timestamp("2026-06-16"), "Close"].tolist(), [50.0])

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

        self.assertEqual(len(aligned[0]), 3 * 390)
        self.assertEqual(
            aligned[0].groupby(aligned[0]["Date"].dt.strftime("%Y-%m-%d")).size().tolist(),
            [390, 390, 390],
        )
        self.assertEqual(
            aligned[0].loc[aligned[0]["Close"].notna(), "Date"].dt.strftime("%Y-%m-%d %H:%M").tolist(),
            ["2026-03-25 09:30", "2026-03-26 09:30", "2026-03-27 09:30"],
        )

    def test_multi_day_us_compare_uses_common_complete_trading_days(self) -> None:
        def _dataset(days: list[str], starting_price: float) -> pd.DataFrame:
            frames = []
            for offset, day in enumerate(days):
                dates = pd.date_range(
                    f"{day} 09:30",
                    f"{day} 15:59",
                    freq="min",
                )
                frames.append(pd.DataFrame({
                    "Date": dates,
                    "Close": starting_price + offset + (dates.minute / 1_000),
                }))
            return pd.concat(frames, ignore_index=True)

        first_ticker_days = [
            "2026-07-20",
            "2026-08-17",
            "2026-08-18",
            "2026-08-19",
            "2026-08-20",
            "2026-08-21",
        ]
        second_ticker_days = first_ticker_days[1:]

        aligned = slice_intraday_datasets_for_compare_period(
            [
                _dataset(first_ticker_days, 300.0),
                _dataset(second_ticker_days, 400.0),
            ],
            "1w",
            pd.Timestamp("2026-08-21 16:00"),
            ["AAPL", "MSFT"],
        )

        expected_days = second_ticker_days
        for dataset in aligned:
            self.assertEqual(len(dataset), 5 * 390)
            self.assertEqual(
                dataset["Date"].dt.strftime("%Y-%m-%d").drop_duplicates().tolist(),
                expected_days,
            )
            self.assertTrue(dataset["Close"].notna().all())

    def test_exact_four_day_intraday_alignment_keeps_equal_session_widths(self) -> None:
        complete = pd.DataFrame(
            {
                "Date": pd.to_datetime([
                    f"2026-07-{day:02d} {clock}"
                    for day in range(7, 11)
                    for clock in ("09:30", "15:59")
                ]),
                "Close": [float(value) for value in range(8)],
            }
        )
        partial = complete.loc[
            ~(
                (complete["Date"].dt.strftime("%Y-%m-%d") == "2026-07-09")
                & (complete["Date"].dt.strftime("%H:%M") == "15:59")
            )
        ].copy()

        aligned = align_intraday_datasets_for_compare(
            [complete, partial],
            ["DRAM", "WDC"],
        )

        self.assertEqual(len(aligned[0]), 4 * 390)
        self.assertEqual(
            aligned[1].groupby(aligned[1]["Date"].dt.strftime("%Y-%m-%d")).size().tolist(),
            [390, 390, 390, 390],
        )
        self.assertTrue(pd.isna(
            aligned[1].loc[aligned[1]["Date"] == pd.Timestamp("2026-07-09 15:59"), "Close"]
        ).all())

    def test_multi_day_compare_preserves_axis_before_new_adr_first_quote(self) -> None:
        established = pd.DataFrame(
            {
                "Date": pd.to_datetime([
                    "2026-07-08 09:30", "2026-07-08 15:59",
                    "2026-07-09 09:30", "2026-07-09 15:59",
                    "2026-07-10 09:30", "2026-07-10 11:34", "2026-07-10 15:59",
                ]),
                "Close": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0],
            }
        )
        new_adr = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-10 11:34", "2026-07-10 15:59"]),
                "Close": [171.71, 170.0],
            }
        )

        aligned = slice_intraday_datasets_for_compare_period(
            [established, new_adr],
            "3d",
            pd.Timestamp("2026-07-10 15:59"),
            ["DRAM", "SKHYV"],
        )

        self.assertEqual(aligned[0]["Date"].min(), pd.Timestamp("2026-07-08 09:30"))
        self.assertTrue(pd.isna(aligned[1].loc[aligned[1]["Date"] < pd.Timestamp("2026-07-10 11:34"), "Close"]).all())
        first_adr_quote = aligned[1].loc[aligned[1]["Date"] == pd.Timestamp("2026-07-10 11:34"), "Close"]
        self.assertEqual(first_adr_quote.tolist(), [171.71])

    def test_one_day_compare_accepts_partial_first_session_for_new_listing(self) -> None:
        established = pd.DataFrame(
            {
                "Date": pd.to_datetime([
                    "2026-07-10 09:30",
                    "2026-07-10 09:44",
                    "2026-07-10 15:59",
                ]),
                "Open": [100.0, 101.0, 102.0],
                "High": [101.0, 102.0, 103.0],
                "Low": [99.0, 100.0, 101.0],
                "Close": [100.5, 101.5, 102.5],
            }
        )
        debut = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-07-10 09:44", "2026-07-10 15:59"]),
                "Open": [170.0, 168.0],
                "High": [177.0, 169.0],
                "Low": [166.19, 167.0],
                "Close": [171.71, 168.01],
            }
        )

        aligned = slice_intraday_datasets_for_compare_period(
            [established, debut],
            "1d",
            pd.Timestamp("2026-07-10 15:59"),
            ["DRAM", "SKHYV"],
        )

        self.assertEqual(aligned[0]["Date"].min(), pd.Timestamp("2026-07-10 09:30"))
        self.assertTrue(pd.isna(aligned[1].loc[aligned[1]["Date"] == pd.Timestamp("2026-07-10 09:30"), "Close"]).all())
        self.assertEqual(
            aligned[1].loc[aligned[1]["Date"] == pd.Timestamp("2026-07-10 09:44"), "Close"].tolist(),
            [171.71],
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

        # Cross-market 1d preserves elapsed New York wall time and leaves closed-market minutes empty.
        self.assertEqual(aligned[0]["Date"].min(), pd.Timestamp("2026-07-02 20:00"))
        self.assertEqual(aligned[0]["Date"].max(), pd.Timestamp("2026-07-03 03:59"))
        self.assertEqual(len(aligned[0]), 480)
        self.assertTrue(pd.isna(aligned[0].loc[aligned[0]["Date"] == pd.Timestamp("2026-07-03 03:59"), "Close"]).all())
        self.assertEqual(aligned[1]["Date"].tolist(), aligned[0]["Date"].tolist())
        # KR (index 0) values at its original slots, NaN at HK-only end
        self.assertTrue(pd.isna(aligned[0]["Open"].iloc[-1]))
        self.assertEqual(aligned[0]["Open"].iloc[0], 100.0)
        # HK (index 1) has NaN at KR early exclusive, values at its slots
        self.assertTrue(pd.isna(aligned[1]["Open"].iloc[0]))
        self.assertEqual(aligned[1]["Open"].iloc[-1], 204.0)

    def test_cross_market_one_day_keeps_full_us_overnight_session(self) -> None:
        krx_dataset = ohlc_frame_for_dates(
            "000660.KS",
            ["2026-07-13 20:00", "2026-07-14 02:30"],
        )
        hk_dataset = ohlc_frame_for_dates(
            "7709.HK",
            ["2026-07-13 21:30", "2026-07-14 03:59"],
        )
        skhy_dataset = ohlc_frame_for_dates(
            "SKHY",
            ["2026-07-13 20:00", "2026-07-14 04:40"],
        )

        aligned = slice_intraday_datasets_for_compare_period(
            [krx_dataset, hk_dataset, skhy_dataset],
            "1d",
            pd.Timestamp("2026-07-14 04:40"),
            ["000660.KS", "7709.HK", "SKHY"],
        )

        self.assertEqual(
            market_trading_date_for_timestamp("2026-07-13 20:00", "SKHY"),
            pd.Timestamp("2026-07-14").date(),
        )
        self.assertEqual(aligned[2]["Date"].min(), pd.Timestamp("2026-07-13 20:00"))
        self.assertEqual(aligned[2]["Date"].max(), pd.Timestamp("2026-07-14 04:40"))
        self.assertEqual(aligned[2]["Open"].iloc[0], 149.5)
        self.assertEqual(aligned[2]["Open"].iloc[-1], 150.5)


if __name__ == "__main__":
    unittest.main()
