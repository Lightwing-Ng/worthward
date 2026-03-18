"""
Tests for the SuperTrend Double AI strategy.

Code version: v1.0.0
"""

from __future__ import annotations

import unittest

import pandas as pd

from strategies.loader import instantiate_strategy, list_enabled_strategies


class SupertrendDoubleAiStrategyTests(unittest.TestCase):
    def test_strategy_is_registered_for_trade_messages(self) -> None:
        strategy_ids = [item["id"] for item in list_enabled_strategies()]
        self.assertIn("supertrend-double-ai", strategy_ids)

    def test_strategy_generates_expected_signal_columns(self) -> None:
        strategy = instantiate_strategy("supertrend-double-ai")
        dataset = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=16, freq="D"),
                "Open": [100, 101, 102, 104, 106, 109, 112, 110, 108, 105, 103, 100, 98, 101, 105, 109],
                "High": [101, 102, 103, 105, 107, 110, 113, 111, 109, 106, 104, 101, 99, 102, 106, 110],
                "Low": [99, 100, 101, 103, 105, 108, 110, 108, 106, 103, 101, 98, 96, 99, 103, 107],
                "Close": [100, 101, 102, 104, 106, 109, 111, 109, 107, 104, 102, 99, 97, 100, 104, 108],
            }
        )

        result = strategy.compute_signals(dataset)

        self.assertEqual(result.buy_signal_column, "buy_signal")
        self.assertEqual(result.sell_signal_column, "sell_signal")
        self.assertIn("target_factor", result.frame.columns)
        self.assertIn("performance_index", result.frame.columns)
        self.assertIn("trailing_stop", result.frame.columns)
        self.assertIn("trailing_stop_ama", result.frame.columns)
        self.assertGreaterEqual(int(result.frame["buy_signal"].sum() + result.frame["sell_signal"].sum()), 1)

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


if __name__ == "__main__":
    unittest.main()
