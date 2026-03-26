"""
Tests for backtest metrics.

Code version: v1.4.1
"""

from __future__ import annotations

import unittest

import pandas as pd

from strategies.backtest import run_single_ticker_backtest
from strategies.base import StrategySignalResult


class BacktestMetricTests(unittest.TestCase):
    def test_win_rate_counts_buy_then_higher_sell_as_win(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=4, freq="D"),
                "Close": [100.0, 110.0, 105.0, 115.0],
                "buy_signal": [True, False, True, False],
                "sell_signal": [False, True, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["summary"]["trade_count"], 2)
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)

    def test_win_rate_counts_sell_then_lower_rebuy_as_win(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=4, freq="D"),
                "Close": [100.0, 120.0, 90.0, 95.0],
                "buy_signal": [True, False, True, False],
                "sell_signal": [False, True, False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["summary"]["trade_count"], 1)
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)

    def test_win_rate_uses_pair_direction_not_just_realized_pnl(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 95.0, 105.0, 110.0, 108.0],
                "buy_signal": [True, False, True, False, False],
                "sell_signal": [False, True, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["summary"]["trade_count"], 2)
        self.assertAlmostEqual(result["summary"]["win_rate_pct"], 33.33, places=2)

    def test_win_rate_counts_open_buy_as_win_when_last_price_is_higher(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 110.0, 90.0, 95.0, 120.0],
                "buy_signal": [True, False, True, False, False],
                "sell_signal": [False, True, False, False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["summary"]["trade_count"], 1)
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)

    def test_chart_markers_only_reflect_executed_trades_not_raw_signals(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 105.0, 110.0, 115.0, 120.0],
                "buy_signal": [True, True, True, False, False],
                "sell_signal": [False, False, False, True, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["chart"]["buy_markers"], [True, False, False, False, False])
        self.assertEqual(result["chart"]["sell_markers"], [False, False, False, True, False])

    def test_chart_raw_dates_and_trade_dates_stay_aligned(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21"]),
                "Close": [100.0, 110.0, 108.0],
                "buy_signal": [False, True, False],
                "sell_signal": [False, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20")
        self.assertEqual(result["chart"]["raw_dates"][1], "2026-02-20")
        self.assertTrue(result["chart"]["buy_markers"][1])
        self.assertEqual(result["chart"]["dates"][1], "20 Feb 2026")

    def test_intraday_chart_labels_preserve_time_component(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-20 09:30", "2026-02-20 09:31", "2026-02-20 09:32"]),
                "Open": [100.0, 101.0, 102.0],
                "High": [101.0, 102.0, 103.0],
                "Low": [99.5, 100.5, 101.5],
                "Close": [100.5, 101.5, 102.5],
                "buy_signal": [False, True, False],
                "sell_signal": [False, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            interval="1m",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20 09:31")
        self.assertEqual(result["chart"]["raw_dates"][1], "2026-02-20T09:31:00")
        self.assertEqual(result["chart"]["dates"][1], "20 Feb 2026 09:31")

    def test_realized_long_and_short_metrics_only_accumulate_positive_pairs(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    [
                        "2026-02-20 09:30",
                        "2026-02-20 09:31",
                        "2026-02-20 09:32",
                        "2026-02-20 09:33",
                        "2026-02-20 09:34",
                        "2026-02-20 09:35",
                        "2026-02-20 09:36",
                    ]
                ),
                "Open": [10.0, 10.0, 12.0, 12.0, 11.0, 10.0, 10.0],
                "Close": [10.0, 10.5, 12.0, 11.5, 11.0, 10.0, 10.0],
                "buy_signal": [True, False, False, False, True, False, False],
                "sell_signal": [False, False, True, False, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=100.0,
            interval="1m",
        )

        self.assertEqual(result["summary"]["long_gain"], 20.0)
        self.assertEqual(result["summary"]["short_gain"], 10.0)

    def test_next_open_execution_uses_following_session_open_price(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21", "2026-02-24"]),
                "Open": [100.0, 101.0, 112.0, 118.0],
                "Close": [100.0, 110.0, 115.0, 120.0],
                "buy_signal": [False, True, False, False],
                "sell_signal": [False, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            execution_mode="next_open",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/21")
        self.assertEqual(result["trades"][0]["price"], 112.0)
        self.assertEqual(result["trades"][1]["date"], "2026/02/24")
        self.assertEqual(result["trades"][1]["price"], 118.0)


if __name__ == "__main__":
    unittest.main()
