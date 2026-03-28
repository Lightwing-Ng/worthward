"""
Tests for exact-range date alignment.

Code version: v2.1.0
"""

from __future__ import annotations

import unittest

import pandas as pd

from app.services.date_constraints import (
    align_requested_exact_dates,
    build_date_constraint_payload,
)


class DateConstraintServiceTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
