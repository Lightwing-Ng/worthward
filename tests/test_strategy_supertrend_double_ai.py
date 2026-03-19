"""
Tests for the SuperTrend Double AI strategy.

Code version: v1.1.0
"""

from __future__ import annotations

import math
import unittest

import pandas as pd

from strategies.loader import instantiate_strategy, list_enabled_strategies


class SupertrendDoubleAiStrategyTests(unittest.TestCase):
    def test_strategy_is_registered_for_trade_messages(self) -> None:
        strategy_ids = [item["id"] for item in list_enabled_strategies()]
        self.assertIn("supertrend-double-ai", strategy_ids)

    def test_strategy_generates_expected_signal_columns(self) -> None:
        strategy = instantiate_strategy("supertrend-double-ai")
        n_points = 100
        dataset = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=n_points, freq="D"),
                "Open": [100 + 5 * (i % 5) + 2 * (i % 3) for i in range(n_points)],
                "High": [105 + 5 * (i % 5) + 2 * (i % 3) for i in range(n_points)],
                "Low": [95 + 5 * (i % 5) + 2 * (i % 3) for i in range(n_points)],
                "Close": [100 + 5 * (i % 5) + 2 * (i % 3) + (i % 2) for i in range(n_points)],
            }
        )

        result = strategy.compute_signals(
            dataset,
            params={"n1": 4, "n2": 6, "len1": 5, "len2": 3}
        )

        self.assertEqual(result.buy_signal_column, "buy_signal")
        self.assertEqual(result.sell_signal_column, "sell_signal")
        self.assertIn("supertrend1", result.frame.columns)
        self.assertIn("supertrend2", result.frame.columns)
        self.assertIn("direction1", result.frame.columns)

    def test_strategy_accepts_close_only_trade_dataset(self) -> None:
        strategy = instantiate_strategy("supertrend-double-ai")
        dataset = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=8, freq="D"),
                "Close": [100, 101, 103, 102, 99, 97, 100, 104],
            }
        )

        result = strategy.compute_signals(dataset)

        self.assertIn("High", result.frame.columns)
        self.assertIn("Low", result.frame.columns)
        self.assertIn("Open", result.frame.columns)

    def test_strategy_emits_real_trades_on_trending_wave_dataset(self) -> None:
        strategy = instantiate_strategy("supertrend-double-ai")
        n_points = 320
        dataset = pd.DataFrame(
            {
                "Date": pd.date_range("2024-01-01", periods=n_points, freq="D"),
                "Open": [100 + 0.14 * i + 9 * math.sin(i / 8) for i in range(n_points)],
                "High": [102 + 0.14 * i + 9 * math.sin(i / 8) for i in range(n_points)],
                "Low": [98 + 0.14 * i + 9 * math.sin(i / 8) for i in range(n_points)],
                "Close": [100 + 0.14 * i + 9 * math.sin(i / 8) + 0.6 * math.cos(i / 5) for i in range(n_points)],
                "Volume": [1_000_000 + int(20_000 * math.sin(i / 6)) for i in range(n_points)],
            }
        )

        result = strategy.compute_signals(dataset)

        self.assertGreater(int(result.frame["buy_signal"].sum()), 0)
        self.assertGreater(int(result.frame["sell_signal"].sum()), 0)


if __name__ == "__main__":
    unittest.main()
