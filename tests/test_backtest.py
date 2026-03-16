"""
Tests for backtest metrics.

Code version: v1.0.0
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


if __name__ == "__main__":
    unittest.main()
