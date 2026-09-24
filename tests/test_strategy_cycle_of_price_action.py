"""Tests for the Cycle of Price Action strategy. Code version: v1.0.0."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from strategies.algorithms.strategy_cycle_of_price_action import (
    CYCLE_OF_PRICE_ACTION_SCHEMA,
    CycleOfPriceActionStrategy,
    detect_price_action_cycle,
)
from strategies.base import normalize_strategy_presentation
from strategies.loader import list_enabled_strategies


def _frame_from_close(close: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Date": pd.date_range("2025-01-02", periods=len(close), freq="D"),
            "Open": close * 0.999,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": np.full(len(close), 1_000_000.0),
        }
    )


def _cycle_frame() -> pd.DataFrame:
    """Flat base, capitulation, recovery, trend, blow-off, then breakdown."""
    close = np.concatenate(
        [
            np.full(40, 100.0),
            np.linspace(100.0, 80.0, 12),
            np.linspace(80.0, 101.0, 15),
            np.linspace(101.0, 125.0, 40),
            np.linspace(125.0, 150.0, 5),
            np.linspace(150.0, 110.0, 12),
        ]
    )
    return _frame_from_close(close)


def _params(**overrides: object) -> dict[str, object]:
    strategy = CycleOfPriceActionStrategy()
    return {**strategy.normalize_params({}), **overrides}


class CycleOfPriceActionTest(unittest.TestCase):
    def test_catalog_registers_a_price_field_strategy(self) -> None:
        item = next(entry for entry in list_enabled_strategies() if entry["id"] == "cycle-of-price-action")
        self.assertEqual(item["category"], "price-field")
        self.assertEqual(item["presentation_renderer"], "probability-grid-v1")
        keys = {definition.key for definition in CycleOfPriceActionStrategy().get_parameter_definitions()}
        self.assertIn("fast_ema", keys)
        self.assertIn("training_window", keys)
        self.assertNotIn("entry_probability", keys)

    def test_detects_the_full_cycle_in_order(self) -> None:
        cycle = detect_price_action_cycle(_cycle_frame(), _params())
        stages = [stage for stage in cycle["cycle_stage"] if stage]
        for expected in ("reversal_extension", "wedge_pop", "exhaustion_extension", "wedge_drop"):
            self.assertIn(expected, stages)
        self.assertLess(stages.index("reversal_extension"), stages.index("wedge_pop"))
        self.assertLess(stages.index("wedge_pop"), stages.index("exhaustion_extension"))
        # The initial capitulation also produces a bearish Wedge Drop; the
        # cycle must end with a Wedge Drop after the blow-off exhaustion.
        self.assertEqual(stages[0], "wedge_drop")
        last_drop = len(stages) - 1 - stages[::-1].index("wedge_drop")
        self.assertLess(stages.index("exhaustion_extension"), last_drop)
        self.assertEqual(cycle["cycle_state"].iloc[-1], "bear")

    def test_stage_detection_is_causal(self) -> None:
        frame = _cycle_frame()
        params = _params()
        full = detect_price_action_cycle(frame, params)
        for cut in (60, 80, 100, len(frame) - 5):
            prefix = detect_price_action_cycle(frame.iloc[:cut].reset_index(drop=True), params)
            self.assertEqual(
                prefix["cycle_stage"].tolist(),
                full["cycle_stage"].iloc[:cut].tolist(),
            )

    def test_rejects_inverted_averages(self) -> None:
        with self.assertRaises(ValueError):
            detect_price_action_cycle(_cycle_frame(), _params(fast_ema=20, slow_ema=10))

    def test_signals_follow_stages_and_probability_gate(self) -> None:
        strategy = CycleOfPriceActionStrategy()
        frame = _cycle_frame()
        base = {"training_window": 30, "chip_window": 20}
        ungated = strategy.compute_signals(
            frame, {**base, "field_confirmation": 0.0, "field_exit_probability": 0.0}
        )
        output = ungated.frame
        buy_stages = output.loc[output["buy_signal"], "cycle_stage"]
        self.assertTrue(len(buy_stages) > 0)
        self.assertTrue(set(buy_stages) <= {"wedge_pop", "ema_crossback", "base_n_break"})
        sell_stages = output.loc[output["sell_signal"], "cycle_stage"]
        self.assertTrue(set(sell_stages) <= {"wedge_drop", "exhaustion_extension"})

        gated = strategy.compute_signals(frame, {**base, "field_confirmation": 95.0})
        probability = gated.frame["bayesian_probability_up"]
        self.assertTrue((probability[gated.frame["buy_signal"]] >= 0.95).all())
        self.assertLessEqual(int(gated.frame["buy_signal"].sum()), int(output["buy_signal"].sum()))

    def test_presentation_reuses_the_probability_grid(self) -> None:
        result = CycleOfPriceActionStrategy().compute_signals(
            _cycle_frame(), {"training_window": 30, "chip_window": 20}
        )
        presentation = normalize_strategy_presentation(result.presentation)
        self.assertEqual(presentation["schema"], CYCLE_OF_PRICE_ACTION_SCHEMA)
        self.assertEqual(presentation["renderer"], "probability-grid-v1")
        self.assertEqual(presentation["renderer_schema"], "probability-grid/v1")
        cycle = presentation["price_action_cycle"]
        self.assertEqual(len(cycle["stages"]), len(presentation["data_keys"]))
        self.assertEqual(len(presentation["probability_up"]), len(presentation["data_keys"]))

    def test_cycle_parameters_change_the_fingerprint(self) -> None:
        strategy = CycleOfPriceActionStrategy()
        base = {"training_window": 30, "chip_window": 20}
        first = strategy.compute_signals(_cycle_frame(), base)
        second = strategy.compute_signals(_cycle_frame(), {**base, "base_length": 8})
        self.assertNotEqual(first.presentation["fingerprint"], second.presentation["fingerprint"])


if __name__ == "__main__":
    unittest.main()
