"""Behavior tests for recurring investment schedules and simulations.

Code version: v1.1.2
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from app.services.dca import (
    _normalize_frequency,
    _normalize_month_day,
    _normalize_weekday,
    build_recurring_schedule_dates,
    simulate_recurring_investment,
)
from tests.factories.market import close_frame_for_dates


class RecurringScheduleTests(unittest.TestCase):
    def test_empty_trading_dates_return_no_schedule(self) -> None:
        result = build_recurring_schedule_dates(
            pd.Series([], dtype="datetime64[ns]"),
            pd.Timestamp("2026-01-01"),
            pd.Timestamp("2026-01-31"),
            frequency="monthly",
            weekday=0,
            month_day=15,
        )

        self.assertEqual(result, [])

    def test_weekly_schedule_moves_weekend_to_next_trading_day(self) -> None:
        trading_dates = pd.Series(pd.to_datetime([
            "2026-01-02",
            "2026-01-05",
            "2026-01-09",
            "2026-01-12",
        ]))

        result = build_recurring_schedule_dates(
            trading_dates,
            pd.Timestamp("2026-01-02"),
            pd.Timestamp("2026-01-12"),
            frequency="weekly",
            weekday=4,
            month_day=15,
        )

        self.assertEqual(result, [pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-09")])

    def test_monthly_schedule_crosses_year_and_aligns_to_market_dates(self) -> None:
        trading_dates = pd.Series(pd.to_datetime([
            "2025-12-01",
            "2025-12-29",
            "2026-01-28",
            "2026-02-02",
        ]))

        result = build_recurring_schedule_dates(
            trading_dates,
            pd.Timestamp("2025-12-20"),
            pd.Timestamp("2026-02-02"),
            frequency="monthly",
            weekday=0,
            month_day=28,
        )

        self.assertEqual(result, [pd.Timestamp("2025-12-29"), pd.Timestamp("2026-01-28")])

    def test_schedule_does_not_emit_alignment_beyond_selected_range(self) -> None:
        result = build_recurring_schedule_dates(
            pd.Series(pd.to_datetime(["2026-01-05", "2026-02-02"])),
            pd.Timestamp("2026-01-01"),
            pd.Timestamp("2026-01-31"),
            frequency="monthly",
            weekday=0,
            month_day=31,
        )

        self.assertEqual(result, [])

    def test_input_normalizers_enforce_supported_values(self) -> None:
        self.assertEqual(_normalize_frequency(" WEEKLY "), "weekly")
        self.assertEqual(_normalize_frequency("daily"), "monthly")
        self.assertEqual(_normalize_weekday("4"), 4)
        self.assertEqual(_normalize_weekday("Sunday", fallback=2), 2)
        self.assertEqual(_normalize_weekday(7, fallback=3), 3)
        self.assertEqual(_normalize_month_day("0"), 1)
        self.assertEqual(_normalize_month_day(31), 28)
        self.assertEqual(_normalize_month_day(None, fallback=12), 12)


class RecurringInvestmentSimulationTests(unittest.TestCase):
    def setUp(self) -> None:
        date_label_patch = patch(
            "app.services.dca.format_display_date",
            side_effect=lambda value: pd.Timestamp(value).strftime("%Y-%m-%d"),
        )
        short_label_patch = patch(
            "app.services.dca.format_short_display_date",
            side_effect=lambda value: pd.Timestamp(value).strftime("%Y/%m/%d"),
        )
        self.addCleanup(date_label_patch.stop)
        self.addCleanup(short_label_patch.stop)
        date_label_patch.start()
        short_label_patch.start()

    def test_empty_market_data_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "No market data available for QQQ"):
            simulate_recurring_investment(
                "QQQ",
                pd.DataFrame(),
                amount_per_period=100.0,
                frequency="monthly",
                weekday=0,
                month_day=15,
            )

    def test_range_without_a_contribution_date_is_rejected(self) -> None:
        frame = close_frame_for_dates(["2026-01-02", "2026-01-05"], [100.0, 101.0])

        with self.assertRaisesRegex(ValueError, "No recurring contribution dates"):
            simulate_recurring_investment(
                "QQQ",
                frame,
                amount_per_period=100.0,
                frequency="monthly",
                weekday=0,
                month_day=15,
            )

    def test_monthly_contributions_preserve_capital_and_share_invariants(self) -> None:
        frame = close_frame_for_dates(
            ["2026-01-15", "2026-02-16", "2026-03-16"],
            [100.0, 120.0, 125.0],
        )

        result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=1_000.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
        )

        summary = result["summary"]
        trades = result["trades"]
        self.assertEqual(summary["planned_capital"], 3_000.0)
        self.assertEqual(summary["total_invested"], 3_000.0)
        self.assertEqual(summary["contribution_count"], 3)
        self.assertEqual(summary["investment_days"], 3)
        self.assertEqual([trade["raw_date"] for trade in trades], [
            "2026-01-15",
            "2026-02-16",
            "2026-03-16",
        ])
        self.assertAlmostEqual(
            summary["average_cost"],
            summary["total_invested"] / summary["total_shares"],
            places=3,
        )
        self.assertEqual(result["chart"]["contribution_markers"], [True, True, True])
        self.assertEqual(result["chart"]["raw_dates"][0], "2026-01-15")
        first_trade = trades[0]
        self.assertEqual(first_trade["side"], "Buy")
        self.assertEqual(first_trade["quantity"], first_trade["shares"])
        self.assertEqual(first_trade["realized_pnl"], 0.0)
        self.assertAlmostEqual(first_trade["market_value"], first_trade["equity"] - first_trade["cash"])
        self.assertAlmostEqual(
            first_trade["unrealized_pnl"],
            first_trade["market_value"] - first_trade["invested"],
        )

    def test_shared_stop_loss_flag_is_preserved_without_changing_buy_only_dca(self) -> None:
        frame = close_frame_for_dates(
            ["2026-01-15", "2026-02-16", "2026-03-16"],
            [100.0, 120.0, 125.0],
        )

        result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=1_000.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
            stop_loss_enabled=False,
        )

        self.assertFalse(result["summary"]["stop_loss_enabled"])
        self.assertEqual(result["summary"]["contribution_count"], 3)
        self.assertEqual(result["summary"]["total_invested"], 3_000.0)

    def test_sparse_market_dates_combine_multiple_scheduled_events(self) -> None:
        frame = close_frame_for_dates(["2026-01-01", "2026-01-20"], [100.0, 200.0])

        result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=100.0,
            frequency="weekly",
            weekday=3,
            month_day=15,
        )

        self.assertEqual(result["summary"]["contribution_count"], 3)
        self.assertEqual(result["summary"]["investment_days"], 2)
        self.assertEqual(result["trades"][1]["events"], 2)
        self.assertEqual(result["trades"][1]["amount"], 200.0)
        self.assertEqual(result["summary"]["total_invested"], 300.0)

    def test_cash_dividend_and_reinvestment_follow_distinct_accounting_paths(self) -> None:
        frame = close_frame_for_dates(
            ["2026-01-15", "2026-01-16", "2026-02-16"],
            [100.0, 100.0, 100.0],
            dividends=[0.0, 10.0, 0.0],
        )

        cash_result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=1_000.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
            reinvest_cash_dividends=False,
        )
        reinvested_result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=1_000.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
            reinvest_cash_dividends=True,
        )
        excluded_result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=1_000.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
            include_cash_dividends=False,
        )

        self.assertEqual(cash_result["summary"]["final_equity"], 2_100.0)
        self.assertEqual(reinvested_result["summary"]["final_equity"], 2_100.0)
        self.assertEqual(reinvested_result["summary"]["total_shares"], 21.0)
        self.assertEqual(cash_result["summary"]["total_shares"], 20.0)
        self.assertEqual(excluded_result["summary"]["final_equity"], 2_000.0)

    def test_invalid_options_normalize_and_minimum_amount_is_one_dollar(self) -> None:
        frame = close_frame_for_dates(["2026-01-15", "2026-01-28"], [10.0, 11.0])

        result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=-50.0,
            frequency="daily",
            weekday=9,
            month_day=99,
        )

        self.assertEqual(result["summary"]["amount_per_period"], 1.0)
        self.assertEqual(result["summary"]["frequency"], "monthly")
        self.assertEqual(result["summary"]["weekday"], 0)
        self.assertEqual(result["summary"]["month_day"], 28)
        self.assertEqual(result["summary"]["schedule_label"], "Calendar day 28 of each month")

    def test_zero_price_contribution_retains_uninvested_cash(self) -> None:
        frame = close_frame_for_dates(["2026-01-15", "2026-01-16"], [0.0, 10.0])

        result = simulate_recurring_investment(
            "QQQ",
            frame,
            amount_per_period=100.0,
            frequency="monthly",
            weekday=0,
            month_day=15,
        )

        self.assertEqual(result["trades"], [])
        self.assertEqual(result["summary"]["total_invested"], 0.0)
        self.assertEqual(result["summary"]["final_equity"], 100.0)
        self.assertEqual(result["summary"]["all_in_equity"], 0.0)
        self.assertEqual(result["summary"]["net_return_pct"], 0.0)


if __name__ == "__main__":
    unittest.main()
