"""
Tests for strategy loader catalog discovery.

Code version: v1.2.2
"""

from __future__ import annotations

import unittest
import sys

from strategies import loader
from strategies.loader import instantiate_strategy, list_enabled_strategies, load_strategy_registry


class StrategyLoaderTests(unittest.TestCase):
    def test_registry_is_built_from_strategy_classes(self) -> None:
        registry = load_strategy_registry()
        self.assertEqual(registry["version"], "v4.0.0")
        strategies = registry["strategies"]
        self.assertGreaterEqual(len(strategies), 3)

        macd = next(item for item in strategies if item["id"] == "macd")
        self.assertEqual(macd["name"], "MACD")
        self.assertEqual(macd["category"], "technical-analysis")
        self.assertEqual(macd["ui"]["display_order"], 20)
        self.assertEqual(macd["default_params"]["fast_span"], 12)
        self.assertTrue(macd["supports"]["single_ticker"])
        self.assertFalse(macd["supports"]["multi_ticker"])
        self.assertEqual(macd["supports"]["execution_intervals"], ["1d", "1m"])

        dca = next(item for item in strategies if item["id"] == "dca")
        self.assertEqual(dca["supports"]["execution_intervals"], ["1d"])

        strategy = instantiate_strategy("macd")
        definitions = {item.key: item for item in strategy.get_parameter_definitions()}
        self.assertEqual(definitions["fast_span"].unit_hint, "bars")

    def test_enabled_strategy_list_is_sorted_by_display_order(self) -> None:
        strategy_ids = [item["id"] for item in list_enabled_strategies()]
        self.assertEqual(
            strategy_ids[:3],
            ["buy-and-hold", "macd", "supertrend-ai"],
        )
        self.assertNotIn("supertrend-double-ai", strategy_ids)

    def test_retired_duplicate_strategy_ids_are_not_discoverable(self) -> None:
        strategy_ids = {item["id"] for item in list_enabled_strategies()}
        self.assertTrue({
            "lorentzian-classification-chatgpt",
            "lorentzian-classification-gemini",
            "macd-gemini",
            "knn-machine-learning-gemini",
            "supertrend_ai_gemini",
        }.isdisjoint(strategy_ids))

    def test_enabled_strategy_list_exposes_categories_for_grouped_ui(self) -> None:
        categories = {item["id"]: item["category"] for item in list_enabled_strategies()}
        self.assertEqual(categories["buy-and-hold"], "baseline")
        self.assertEqual(categories["dca"], "investment-automation")
        self.assertEqual(categories["grid-trading"], "investment-automation")
        self.assertEqual(categories["macd"], "technical-analysis")
        self.assertEqual(categories["supertrend-ai"], "technical-analysis")
        self.assertEqual(categories["lorentzian-classification"], "technical-analysis")
        self.assertEqual(categories["knn-machine-learning"], "machine-learning")
        self.assertEqual(categories["leveraged-rotation"], "portfolio-rotation")
        self.assertEqual(categories["lstm-price-field"], "price-field")
        self.assertEqual(categories["bayesian-price-field"], "price-field")

        for item in list_enabled_strategies():
            if item.get("presentation_renderer") == "probability-grid-v1":
                self.assertEqual(item["category"], "price-field")

    def test_catalog_class_resolution_matches_instantiation(self) -> None:
        catalog_item = next(item for item in list_enabled_strategies() if item["id"] == "supertrend-ai")
        strategy = instantiate_strategy(catalog_item["id"])
        self.assertEqual(strategy.__class__.__name__, catalog_item["class_name"])
        self.assertEqual(strategy.__class__.__module__, catalog_item["module"])

    def test_every_enabled_strategy_exposes_valid_startup_params(self) -> None:
        for catalog_item in list_enabled_strategies():
            with self.subTest(strategy=catalog_item["id"]):
                strategy = instantiate_strategy(catalog_item["id"])
                startup_params = strategy.get_startup_params()
                self.assertEqual(
                    catalog_item["default_params"],
                    startup_params,
                )
                self.assertEqual(
                    set(startup_params),
                    {definition.key for definition in strategy.get_parameter_definitions()},
                )


def test_discovery_ignores_numbered_copies_and_keeps_valid_plugins(tmp_path, monkeypatch):
    package_name = "worthward_strategy_discovery_probe"
    package_root = tmp_path / package_name
    package_root.mkdir()
    (package_root / "__init__.py").write_text("", encoding="utf-8")
    (package_root / "active_plugin.py").write_text(
        "from strategies.algorithms.strategy_buy_and_hold import BuyAndHoldStrategy\n"
        "class DiscoveryProbe(BuyAndHoldStrategy):\n"
        "    strategy_id = 'local-discovery-probe'\n"
        "    strategy_name = 'Local discovery probe'\n",
        encoding="utf-8",
    )
    for filename in ("active_plugin 2.py", "_private_plugin.py", "invalid-name.py"):
        (package_root / filename).write_text(
            "raise AssertionError('Non-plugin source must never be imported.')\n",
            encoding="utf-8",
        )
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setattr(loader, "ALGORITHMS_PACKAGE", package_name)
    monkeypatch.setattr(loader, "ALGORITHMS_PATH", package_root)

    try:
        discovered = loader._iter_strategy_classes()

        assert [strategy.strategy_id for strategy in discovered] == [
            "local-discovery-probe",
        ]
        assert discovered[0].__module__ == f"{package_name}.active_plugin"
    finally:
        for module_name in tuple(sys.modules):
            if module_name == package_name or module_name.startswith(f"{package_name}."):
                sys.modules.pop(module_name, None)


if __name__ == "__main__":
    unittest.main()
