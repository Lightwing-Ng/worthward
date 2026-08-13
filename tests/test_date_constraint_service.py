"""
Tests for exact-range date alignment.

Code version: v0.5.1
"""

from __future__ import annotations

import unittest

import pandas as pd

from app.services.date_constraints import (
    align_requested_exact_dates,
    build_date_constraint_availability,
    build_date_constraint_payload,
    latest_completed_nyse_trading_day,
    nyse_recent_trading_days,
)


class DateConstraintServiceTests(unittest.TestCase):
    def test_latest_completed_nyse_trading_day_skips_good_friday(self) -> None:
        latest = latest_completed_nyse_trading_day("2026-04-04 20:00:00+08:00")

        self.assertEqual(latest.strftime("%Y-%m-%d"), "2026-04-02")

    def test_recent_nyse_days_keep_the_completed_day_during_overnight(self) -> None:
        self.assertEqual(
            nyse_recent_trading_days("2026-08-12T21:11:54-04:00", day_count=5),
            ["2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11", "2026-08-12"],
        )

    def test_align_requested_exact_dates_snaps_to_shared_trading_days(self) -> None:
        available_dates = pd.Series(pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-07"]))

        aligned_start, aligned_end, message = align_requested_exact_dates(
            available_dates,
            requested_start="2026-01-04",
            requested_end="2026-01-06",
        )

        self.assertEqual(aligned_start.strftime("%Y-%m-%d"), "2026-01-05")
        self.assertEqual(aligned_end.strftime("%Y-%m-%d"), "2026-01-05")
        self.assertIsNotNone(message)

    def test_build_date_constraint_payload_returns_shared_bounds(self) -> None:
        dataset_a = pd.DataFrame({"Date": pd.to_datetime(["2026-01-02", "2026-01-03", "2026-01-06"])})
        dataset_b = pd.DataFrame({"Date": pd.to_datetime(["2026-01-03", "2026-01-06", "2026-01-07"])})

        payload = build_date_constraint_payload(dataset_a, dataset_b)

        self.assertEqual(payload.min_date, "2026-01-03")
        self.assertEqual(payload.max_date, "2026-01-06")
        self.assertEqual(payload.trading_dates, ["2026-01-03", "2026-01-06"])

    def test_date_constraint_availability_names_the_later_listing_boundary(self) -> None:
        established = pd.DataFrame({"Date": pd.to_datetime(["2022-05-20", "2022-05-23", "2022-05-24"])})
        newer_listing = pd.DataFrame({"Date": pd.to_datetime(["2022-05-23", "2022-05-24"])})
        payload = build_date_constraint_payload(established, newer_listing)

        availability = build_date_constraint_availability(
            payload,
            ["QQQ", "JEPQ"],
            [established, newer_listing],
        )

        self.assertEqual(availability["earliest"]["limiting_tickers"], ["JEPQ"])
        self.assertIn("JEPQ has no comparable history before 23 May 2022.", availability["earliest"]["message"])


if __name__ == "__main__":
    unittest.main()
