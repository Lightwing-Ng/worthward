"""Contract tests for alternative strategy implementations.

Code version: v1.0.0
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from strategies.algorithms.strategy_knn_machine_learning import (
    KnnMachineLearningStrategy as KnnStrategy,
)
from strategies.algorithms.strategy_knn_machine_learning_gemini import (
    KnnMachineLearningStrategy as KnnGeminiStrategy,
)
from strategies.algorithms.strategy_lorentzian_classification import (
    LorentzianClassificationStrategy as LorentzianStrategy,
)
from strategies.algorithms.strategy_lorentzian_classification_chatgpt import (
    LorentzianClassificationStrategy as LorentzianChatgptStrategy,
)
from strategies.algorithms.strategy_lorentzian_classification_gemini import (
    LorentzianClassificationStrategy as LorentzianGeminiStrategy,
)
from strategies.algorithms.strategy_supertrend_ai_gemini import (
    SupertrendAiStrategy as SupertrendGeminiStrategy,
)


def build_strategy_frame(periods: int = 160) -> pd.DataFrame:
    index = np.arange(periods, dtype="float64")
    close = 100.0 + (index * 0.08) + (np.sin(index / 4.0) * 6.0)
    return pd.DataFrame({
        "Date": pd.date_range("2025-01-01", periods=periods, freq="D"),
        "Open": close - 0.4,
        "High": close + 1.2,
        "Low": close - 1.3,
        "Close": close,
        "Volume": 1_000_000 + (index * 1_000),
    })


class StrategyVariantContractTests(unittest.TestCase):
    strategy_classes = (
        LorentzianStrategy,
        LorentzianChatgptStrategy,
        LorentzianGeminiStrategy,
        KnnStrategy,
        KnnGeminiStrategy,
        SupertrendGeminiStrategy,
    )

    def test_parameter_schemas_have_unique_keys_and_normalizable_defaults(self) -> None:
        for strategy_class in self.strategy_classes:
            with self.subTest(strategy=strategy_class.__module__):
                strategy = strategy_class()
                definitions = strategy.get_parameter_definitions()
                keys = [definition.key for definition in definitions]
                self.assertEqual(len(keys), len(set(keys)))
                self.assertEqual(set(strategy.normalize_params()), set(keys))

    def test_variants_preserve_the_signal_result_contract(self) -> None:
        source = build_strategy_frame()
        original = source.copy(deep=True)
        for strategy_class in self.strategy_classes:
            with self.subTest(strategy=strategy_class.__module__):
                result = strategy_class().compute_signals(source)
                self.assertEqual(len(result.frame), len(source))
                self.assertEqual(result.buy_signal_column, "buy_signal")
                self.assertEqual(result.sell_signal_column, "sell_signal")
                self.assertEqual(str(result.frame["buy_signal"].dtype), "bool")
                self.assertEqual(str(result.frame["sell_signal"].dtype), "bool")
        pd.testing.assert_frame_equal(source, original)

    def test_variants_return_empty_boolean_signal_frames(self) -> None:
        empty = build_strategy_frame(0)
        for strategy_class in self.strategy_classes:
            with self.subTest(strategy=strategy_class.__module__):
                result = strategy_class().compute_signals(empty)
                self.assertTrue(result.frame.empty)
                self.assertIn("buy_signal", result.frame)
                self.assertIn("sell_signal", result.frame)


if __name__ == "__main__":
    unittest.main()
