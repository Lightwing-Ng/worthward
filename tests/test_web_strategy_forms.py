"""
Tests for pure strategy form and catalog presentation builders.

Code version: v0.1.0
"""

from __future__ import annotations

import unittest

from app.web.strategy_forms import (
    build_strategy_form_field,
    build_strategy_form_fields,
    build_strategy_option_groups,
    build_strategy_settings_rows,
    format_strategy_category_label,
)
from strategies.base import BaseStrategy, StrategyParameterDefinition


class StubStrategy(BaseStrategy):
    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="window",
                label="Window",
                kind="integer",
                default=5,
                help_text="Rolling window.",
            ),
            StrategyParameterDefinition(
                key="ratio",
                label="Ratio",
                kind="number",
                default=1.25,
                minimum=0,
                step=0.05,
            ),
            StrategyParameterDefinition(
                key="enabled",
                label="Enabled",
                kind="boolean",
                default=False,
            ),
        )


class WebStrategyFormTests(unittest.TestCase):
    def test_category_labels_normalize_known_and_custom_keys(self) -> None:
        self.assertEqual(format_strategy_category_label(" BASELINE "), "Baseline")
        self.assertEqual(format_strategy_category_label("machine-learning"), "Machine Learning")
        self.assertEqual(format_strategy_category_label(""), "General")

    def test_option_groups_keep_baseline_recent_and_alphabetical_contracts(self) -> None:
        baseline = {"id": "buy-and-hold", "name": "Buy and hold"}
        zeta = {"id": "zeta", "name": "Zulu"}
        alpha = {"id": "alpha", "name": "Alpha"}

        groups = build_strategy_option_groups(
            [zeta, baseline, alpha],
            ["buy-and-hold", "zeta", "missing"],
        )

        self.assertEqual([group["key"] for group in groups], ["baseline", "recent", "all"])
        self.assertEqual(groups[0]["items"], [baseline])
        self.assertEqual(groups[1]["items"], [zeta])
        self.assertEqual(groups[2]["items"], [alpha, zeta])

    def test_numeric_fields_preserve_slider_and_decimal_display_contracts(self) -> None:
        integer_field = build_strategy_form_field(
            StrategyParameterDefinition(
                key="window",
                label="Window",
                kind="integer",
                default=5,
            ),
            3,
        )
        number_field = build_strategy_form_field(
            StrategyParameterDefinition(
                key="ratio",
                label="Ratio",
                kind="number",
                default=1.25,
                minimum=0,
                step=0.05,
            ),
            1.2,
        )

        self.assertEqual(integer_field["field_type"], "number")
        self.assertEqual(integer_field["input_mode"], "numeric")
        self.assertEqual(integer_field["slider_min"], 0)
        self.assertEqual(integer_field["slider_max"], 20)
        self.assertEqual(integer_field["slider_step"], 1)
        self.assertEqual(number_field["input_mode"], "decimal")
        self.assertEqual(number_field["value"], "1.20")
        self.assertEqual(number_field["slider_max"], 5.0)

    def test_boolean_and_off_on_choice_fields_use_switch_contract(self) -> None:
        boolean_field = build_strategy_form_field(
            StrategyParameterDefinition(
                key="enabled",
                label="Enabled",
                kind="boolean",
                default=False,
            ),
            True,
        )
        choice_field = build_strategy_form_field(
            StrategyParameterDefinition(
                key="filter",
                label="Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
            ),
            "On",
        )

        self.assertEqual(boolean_field["field_type"], "switch")
        self.assertTrue(boolean_field["switch_checked"])
        self.assertEqual(boolean_field["switch_on_value"], 1)
        self.assertEqual(choice_field["field_type"], "switch")
        self.assertTrue(choice_field["switch_checked"])
        self.assertEqual(choice_field["switch_on_value"], "On")
        self.assertEqual(choice_field["switch_off_value"], "Off")

    def test_form_fields_use_injected_factory_and_normalized_values(self) -> None:
        requested_strategy_ids: list[str] = []

        def strategy_factory(strategy_id: str) -> BaseStrategy:
            requested_strategy_ids.append(strategy_id)
            return StubStrategy()

        fields = build_strategy_form_fields(
            "stub",
            {"window": "7", "ratio": "invalid", "enabled": "yes"},
            strategy_factory=strategy_factory,
        )

        self.assertEqual(requested_strategy_ids, ["stub"])
        self.assertEqual([field["key"] for field in fields], ["window", "ratio", "enabled"])
        self.assertEqual(fields[0]["value"], 7)
        self.assertEqual(fields[1]["value"], "1.25")
        self.assertTrue(fields[2]["switch_checked"])

    def test_settings_rows_preserve_supertrend_copy_and_parameter_isolation(self) -> None:
        rows = build_strategy_settings_rows(
            [
                {
                    "id": "supertrend-ai",
                    "name": "Supertrend AI",
                    "category": "machine-learning",
                    "description": "Trend strategy.",
                    "supports": {"single_ticker": True},
                }
            ],
            strategy_factory=lambda strategy_id: StubStrategy(),
        )

        self.assertEqual([row["id"] for row in rows], ["supertrend-ai", "supertrend-ai"])
        self.assertEqual(rows[0]["category"], "Machine Learning")
        self.assertEqual(rows[0]["parameters"], rows[1]["parameters"])
        self.assertIsNot(rows[0]["parameters"], rows[1]["parameters"])
        self.assertIsNot(rows[0]["parameters"][0], rows[1]["parameters"][0])


if __name__ == "__main__":
    unittest.main()
