"""
Tests for strategy loader catalog discovery.

Code version: v1.1.0
"""

from __future__ import annotations

import unittest

from strategies.loader import instantiate_strategy, list_enabled_strategies, load_strategy_registry


class StrategyLoaderTests(unittest.TestCase):
    def test_registry_is_built_from_strategy_classes(self) -> None:
        registry = load_strategy_registry()
        self.assertEqual(registry["version"], "v2.0.0")
        strategies = registry["strategies"]
        self.assertGreaterEqual(len(strategies), 3)

        macd = next(item for item in strategies if item["id"] == "macd")
        self.assertEqual(macd["name"], "MACD")
        self.assertEqual(macd["category"], "momentum")
        self.assertEqual(macd["ui"]["display_order"], 20)
        self.assertEqual(macd["default_params"]["fast_span"], 12)
        self.assertTrue(macd["supports"]["single_ticker"])
        self.assertFalse(macd["supports"]["multi_ticker"])

        strategy = instantiate_strategy("macd")
        definitions = {item.key: item for item in strategy.get_parameter_definitions()}
        self.assertEqual(definitions["fast_span"].unit_hint, "bars")

    def test_enabled_strategy_list_is_sorted_by_display_order(self) -> None:
        strategy_ids = [item["id"] for item in list_enabled_strategies()]
        # With multiple MACD strategies, we have macd followed by macd-gemini at 21
        self.assertEqual(
            strategy_ids[:3],
            ["buy-and-hold", "macd", "macd-gemini"],
        )
        # supertrend-ai comes next at 30
        self.assertEqual(strategy_ids[3], "supertrend-ai")
        self.assertNotIn("supertrend-double-ai", strategy_ids)

    def test_enabled_strategy_list_exposes_categories_for_grouped_ui(self) -> None:
        categories = {item["id"]: item["category"] for item in list_enabled_strategies()}
        self.assertEqual(categories["buy-and-hold"], "baseline")
        self.assertEqual(categories["macd"], "momentum")
        self.assertEqual(categories["supertrend-ai"], "trend")

    def test_catalog_class_resolution_matches_instantiation(self) -> None:
        catalog_item = next(item for item in list_enabled_strategies() if item["id"] == "supertrend-ai")
        strategy = instantiate_strategy(catalog_item["id"])
        self.assertEqual(strategy.__class__.__name__, catalog_item["class_name"])
        self.assertEqual(strategy.__class__.__module__, catalog_item["module"])


if __name__ == "__main__":
    unittest.main()
