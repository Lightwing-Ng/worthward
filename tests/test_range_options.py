"""
Tests for shared workspace range-option policy.

Code version: v0.1.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app.services.range_options import (
    build_supported_compare_periods,
    build_supported_periods_from_dates,
    resolve_requested_period_from_supported,
)


class RangeOptionTests(unittest.TestCase):
    def test_daily_history_exposes_every_supported_horizon_through_max(self) -> None:
        dates = pd.Series(pd.to_datetime(["2014-03-27", "2026-03-27"]))

        periods = build_supported_periods_from_dates(dates)

        self.assertEqual(periods, ["6mo", "1y", "2y", "3y", "5y", "10y", "max"])

    def test_comparison_uses_union_history_without_shortening_for_new_listing(self) -> None:
        union_dates = pd.Series(pd.to_datetime(["2014-03-27", "2024-08-01", "2026-03-27"]))
        intraday_sets = [{"1d", "3d", "1w"}, {"1d"}]

        periods = build_supported_compare_periods(union_dates, intraday_sets)

        self.assertEqual(periods, ["1d", "3d", "1w", "6mo", "1y", "2y", "3y", "5y", "10y", "max"])

    def test_unsupported_requested_period_falls_back_to_rendered_max_option(self) -> None:
        with patch("app.services.range_options.format_display_date", return_value="1 Jan 2018"):
            period, notice = resolve_requested_period_from_supported(
                "10y",
                ["1d", "3d", "1w", "6mo", "1y", "2y", "3y", "5y", "max"],
                pd.Timestamp("2018-01-01"),
            )

        self.assertEqual(period, "max")
        self.assertEqual(
            notice,
            "Requested period 10 years exceeds the available trading history. "
            "Automatically switched to Max. Earliest available data starts on 1 Jan 2018.",
        )


if __name__ == "__main__":
    unittest.main()
