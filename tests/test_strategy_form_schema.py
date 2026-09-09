"""
Tests for strategy form schema helpers.

Code version: v0.8.1
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

    def test_dca_schedule_fields_are_declarative_and_frequency_scoped(self) -> None:
        monthly_fields = {
            field["key"]: field
            for field in build_strategy_form_fields(
                "dca",
                {"frequency": "monthly"},
                strategy_factory=instantiate_strategy,
            )
        }
        weekly_fields = {
            field["key"]: field
            for field in build_strategy_form_fields(
                "dca",
                {"frequency": "weekly"},
                strategy_factory=instantiate_strategy,
            )
        }

        self.assertTrue(monthly_fields["frequency"]["content_sized"])
        self.assertFalse(monthly_fields["weekday"]["is_visible"])
        self.assertTrue(monthly_fields["month_day"]["is_visible"])
        self.assertTrue(weekly_fields["weekday"]["is_visible"])
        self.assertFalse(weekly_fields["month_day"]["is_visible"])
        self.assertEqual(
            [item["label"] for item in weekly_fields["weekday"]["option_items"]],
            [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
            ],
        )

    def test_leveraged_rotation_declares_two_decimal_dynamic_ticker_fields(self) -> None:
        fields = {
            field["key"]: field
            for field in build_strategy_form_fields(
                "leveraged-rotation",
                {"initial_primary_pct": 44.2, "initial_leveraged_pct": 36.3},
                strategy_factory=instantiate_strategy,
            )
        }
        percentage_keys = {
            "initial_primary_pct",
            "initial_leveraged_pct",
            "primary_min_pct",
            "primary_max_pct",
            "leveraged_min_pct",
            "leveraged_max_pct",
            "buy_leveraged_drop_pct",
            "sell_leveraged_rise_pct",
        }

        self.assertTrue(all(fields[key]["step"] == 0.01 for key in percentage_keys))
        self.assertTrue(all(str(fields[key]["value"]).endswith((".00", ".20", ".30")) for key in percentage_keys))
        self.assertEqual(fields["primary_min_pct"]["ui_role"], "ticker-label:0:minimum")
        self.assertEqual(fields["leveraged_max_pct"]["ui_role"], "ticker-label:1:maximum")
        self.assertEqual(fields["rotation_window"]["value"], "1d")
        self.assertEqual(
            [item["label"] for item in fields["rotation_window"]["option_items"]],
            ["Single day", "1 week", "1 month", "3 months"],
        )
        self.assertEqual(fields["buy_leveraged_drop_pct"]["ui_role"], "ticker-label:0:drop-trigger")
        self.assertEqual(fields["sell_leveraged_rise_pct"]["ui_role"], "ticker-label:1:rise-trigger")
        self.assertEqual(
            fields["primary_min_pct"]["subgroup"],
            "Allocation limits (%, equity)",
        )
        self.assertEqual(
            fields["buy_leveraged_drop_pct"]["subgroup"],
            "Rotation triggers (%, change)",
        )


if __name__ == "__main__":
    unittest.main()
