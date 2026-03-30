"""
Tests for strategy form schema helpers.

Code version: v0.3.0
"""

from __future__ import annotations

import unittest

from strategies.loader import instantiate_strategy


class StrategyFormSchemaTests(unittest.TestCase):
    def test_macd_normalize_params_accepts_string_inputs(self) -> None:
        strategy = instantiate_strategy("macd")
        normalized = strategy.normalize_params(
            {
                "fast_span": "15",
                "slow_span": "30",
                "signal_span": "7",
            }
        )
        self.assertEqual(normalized["fast_span"], 15)
        self.assertEqual(normalized["slow_span"], 30)
        self.assertEqual(normalized["signal_span"], 7)

    def test_supertrend_choice_falls_back_to_default(self) -> None:
        strategy = instantiate_strategy("supertrend-ai")
        normalized = strategy.normalize_params({"from_cluster": "Invalid"})
        self.assertEqual(normalized["from_cluster"], "Best")


if __name__ == "__main__":
    unittest.main()
