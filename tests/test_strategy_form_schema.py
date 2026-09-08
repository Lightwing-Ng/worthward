"""
Tests for strategy form schema helpers.

Code version: v0.5.0
"""

from __future__ import annotations

import unittest

from strategies.loader import instantiate_strategy, list_enabled_strategies
from app.web.strategy_forms import build_strategy_form_fields, build_strategy_form_sections


class StrategyFormSchemaTests(unittest.TestCase):
    def test_lstm_training_section_owns_backend_and_staged_factors(self) -> None:
        strategy_id = "lstm-price-field"
        fields = build_strategy_form_fields(strategy_id, None, strategy_factory=instantiate_strategy)
        sections = build_strategy_form_sections(strategy_id, fields, strategy_factory=instantiate_strategy)
        parameters = next(section for section in sections if section["key"] == "parameters")
        training = next(section for section in sections if section["key"] == "training")
        factors = next(section for section in sections if section["key"] == "factors")

        self.assertNotIn("compute_backend", [field["key"] for field in parameters["fields"]])
        self.assertEqual([field["key"] for field in training["fields"]], ["compute_backend"])
        self.assertEqual(training["fields"][0]["ui_apply_mode"], "training")
        self.assertTrue(factors["fields"])
        self.assertTrue(all(field["ui_apply_mode"] == "training" for field in factors["fields"]))

    def test_market_factor_sections_preserve_every_real_parameter_once(self) -> None:
        excluded = {"buy-and-hold", "dca", "grid-trading", "leveraged-rotation"}
        for entry in list_enabled_strategies():
            strategy_id = entry["id"]
            with self.subTest(strategy=strategy_id):
                strategy = instantiate_strategy(strategy_id)
                fields = build_strategy_form_fields(strategy_id, None, strategy_factory=instantiate_strategy)
                sections = build_strategy_form_sections(strategy_id, fields, strategy_factory=instantiate_strategy)
                keys = [field["key"] for section in sections for field in section["fields"]]
                self.assertCountEqual(keys, [definition.key for definition in strategy.get_parameter_definitions()])
                factors = [section for section in sections if section["key"] == "factors"]
                self.assertEqual(bool(factors), strategy_id not in excluded)
                if factors:
                    self.assertEqual(factors[0]["title"], "Market factors")
                    self.assertTrue(factors[0]["fields"])
                    if entry.get("presentation_renderer") != "probability-grid-v1":
                        self.assertNotIn("use_pe_ratio", keys)
                        self.assertNotIn("use_option_call_volume", keys)

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
