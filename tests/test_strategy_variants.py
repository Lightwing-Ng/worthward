"""Contract tests for alternative strategy implementations.

Code version: v1.0.1
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from strategies.algorithms.strategy_knn_machine_learning import (
    _knn_prediction_at_index,
    _knn_prediction_batch,
    KnnMachineLearningStrategy as KnnStrategy,
)
from strategies.algorithms.strategy_knn_machine_learning_gemini import (
    KnnMachineLearningStrategy as KnnGeminiStrategy,
)
from strategies.algorithms.strategy_lorentzian_classification import (
    LorentzianClassificationStrategy as LorentzianStrategy,
)
from strategies.algorithms.strategy_lorentzian_classification_chatgpt import (
    _lorentzian_knn_predictions,
    _lorentzian_prediction_at_index,
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

    def test_cpu_prediction_batches_match_serial_causal_values(self) -> None:
        frame = build_strategy_frame(96)
        feature1 = np.sin(np.arange(len(frame), dtype="float64") / 5.0)
        feature2 = np.cos(np.arange(len(frame), dtype="float64") / 7.0)
        directions = np.sign(np.roll(frame["Close"].to_numpy(), -1) - frame["Close"].to_numpy()).astype("int64")
        with patch("app.infrastructure.parallel.os.cpu_count", return_value=4):
            from app.infrastructure.parallel import map_ordered_batches

            parallel_values, stats = map_ordered_batches(
                _knn_prediction_batch,
                range(len(frame)),
                mode="cpu",
                static_args=(feature1, feature2, directions, 5),
                min_items=1,
                max_workers=2,
            )
        serial_values = [
            _knn_prediction_at_index(index, feature1, feature2, directions, 5)
            for index in range(len(frame))
        ]
        self.assertEqual(stats.executor, "process")
        np.testing.assert_allclose(parallel_values, serial_values, rtol=0.0, atol=0.0)

        features = np.column_stack([feature1, feature2])
        labels = directions.copy()
        label_available = np.ones(len(frame), dtype=bool)
        serial_lorentzian = np.zeros(len(frame), dtype="float64")
        for index in range(1, len(frame)):
            serial_lorentzian[index] = _lorentzian_prediction_at_index(
                index,
                features,
                labels,
                label_available,
                5,
                40,
                4,
                4,
            )
        parallel_lorentzian = _lorentzian_knn_predictions(
            features,
            labels,
            label_available,
            5,
            40,
            sample_step=4,
            label_horizon=4,
        )
        np.testing.assert_allclose(parallel_lorentzian, serial_lorentzian, rtol=0.0, atol=0.0)

    def test_parallel_prediction_paths_remain_causal_under_future_perturbation(self) -> None:
        original = build_strategy_frame(160)
        changed = original.copy(deep=True)
        future_start = 120
        changed.loc[future_start:, "Close"] *= np.linspace(
            1.5,
            2.0,
            len(changed) - future_start,
        )
        changed.loc[future_start:, "High"] = changed.loc[future_start:, "Close"] * 1.02
        changed.loc[future_start:, "Low"] = changed.loc[future_start:, "Close"] * 0.98
        changed.loc[future_start:, "Volume"] *= 5.0

        for strategy_class in self.strategy_classes:
            with self.subTest(strategy=strategy_class.__module__):
                first = strategy_class().compute_signals(original).frame
                second = strategy_class().compute_signals(changed).frame
                for column in (
                    "knn_prediction",
                    "lorentzian_prediction",
                    "supertrend_trend",
                    "trailing_stop",
                    "buy_signal",
                    "sell_signal",
                ):
                    if column not in first or column not in second:
                        continue
                    if first[column].dtype == bool:
                        np.testing.assert_array_equal(
                            first[column].to_numpy()[:future_start],
                            second[column].to_numpy()[:future_start],
                        )
                    else:
                        np.testing.assert_allclose(
                            first[column].to_numpy()[:future_start],
                            second[column].to_numpy()[:future_start],
                            rtol=0.0,
                            atol=0.0,
                            equal_nan=True,
                        )


if __name__ == "__main__":
    unittest.main()
