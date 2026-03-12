"""
Tests for comparison logic.

Code version: v2.1.0
"""

from __future__ import annotations

import unittest

import pandas as pd

from app.comparisons import (
    align_datasets_on_common_dates,
    build_series_payload,
    slice_dataset_for_period,
)


class ComparisonServiceTests(unittest.TestCase):
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

    def test_slice_dataset_for_period_uses_reference_end_date(self) -> None:
        dataset = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2025-01-31", "2025-02-28", "2025-03-31"]),
                "Close": [100.0, 105.0, 110.0],
            }
        )

        sliced = slice_dataset_for_period(dataset, "1mo", pd.Timestamp("2025-03-31"))

        self.assertEqual(sliced["Date"].dt.strftime("%Y-%m-%d").tolist(), ["2025-02-28", "2025-03-31"])


if __name__ == "__main__":
    unittest.main()
