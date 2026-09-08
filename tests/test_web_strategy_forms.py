"""
Tests for pure strategy form and catalog presentation builders.

Code version: v0.3.0
"""

from __future__ import annotations

import unittest

from app.web.strategy_forms import (
    build_strategy_form_field,
    build_strategy_form_fields,
    build_strategy_option_groups,
    build_strategy_settings_groups,
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

    def test_option_groups_follow_authoritative_catalog_categories(self) -> None:
        baseline = {"id": "buy-and-hold", "name": "Buy and hold", "category": "baseline"}
        zeta = {"id": "zeta", "name": "Zulu", "category": "price-field"}
        alpha = {"id": "alpha", "name": "Alpha", "category": "technical-analysis"}

        groups = build_strategy_option_groups(
            [zeta, baseline, alpha],
            ["buy-and-hold", "zeta", "missing"],
        )

        self.assertEqual(
            [group["key"] for group in groups],
            ["baseline", "technical-analysis", "price-field"],
        )
        self.assertEqual(groups[0]["items"], [baseline])
        self.assertEqual(groups[1]["items"], [alpha])
        self.assertEqual(groups[2]["items"], [zeta])
        self.assertEqual(groups[2]["label"], "Price Field Models")

    def test_option_groups_emit_each_strategy_id_once_for_a_single_selected_option(self) -> None:
        baseline = {"id": "buy-and-hold", "name": "Buy and hold", "category": "baseline"}
        alpha = {"id": "alpha", "name": "Alpha", "category": "technical-analysis"}
        alpha_duplicate = {"id": "alpha", "name": "Alpha duplicate", "category": "price-field"}
        zeta = {"id": "zeta", "name": "Zulu", "category": "technical-analysis"}

        groups = build_strategy_option_groups(
            [baseline, alpha, alpha_duplicate, zeta],
            ["zeta", "zeta", "alpha", "buy-and-hold"],
        )
        rendered_ids = [
            str(item["id"])
            for group in groups
            for item in group["items"]
        ]

        self.assertEqual(rendered_ids, ["buy-and-hold", "alpha", "zeta"])
        self.assertEqual(len(rendered_ids), len(set(rendered_ids)))
        self.assertEqual(rendered_ids.count("zeta"), 1)

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

    def test_choice_fields_separate_submitted_values_from_visible_labels(self) -> None:
        definition = StrategyParameterDefinition(
            key="weekday",
            label="Weekly day",
            kind="choice",
            default="0",
            options=("0", "1"),
            option_labels=("Monday", "Tuesday"),
            visible_when=("frequency", "weekly"),
            content_sized=True,
        )

        field = build_strategy_form_field(definition, "1")

        self.assertEqual(
            field["option_items"],
            [
                {"value": "0", "label": "Monday"},
                {"value": "1", "label": "Tuesday"},
            ],
        )
        self.assertEqual(field["selected_label"], "Tuesday")
        self.assertEqual(field["visible_when_key"], "frequency")
        self.assertEqual(field["visible_when_value"], "weekly")
        self.assertTrue(field["content_sized"])
        self.assertEqual(definition.display_default(), "Monday")

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

    def test_settings_groups_keep_each_strategy_once_under_its_catalog_category(self) -> None:
        rows = build_strategy_settings_rows(
            [
                {
                    "id": "supertrend-ai",
                    "name": "Supertrend AI",
                    "category": "technical-analysis",
                    "description": "Trend strategy.",
                    "supports": {"single_ticker": True},
                }
            ],
            strategy_factory=lambda strategy_id: StubStrategy(),
        )

        groups = build_strategy_settings_groups(
            [
                {
                    "id": "supertrend-ai",
                    "name": "SuperTrend AI",
                    "category": "technical-analysis",
                    "description": "Trend strategy.",
                    "supports": {"single_ticker": True},
                }
            ],
            strategy_factory=lambda strategy_id: StubStrategy(),
        )

        self.assertEqual([row["id"] for row in rows], ["supertrend-ai"])
        self.assertEqual(rows[0]["category"], "Technical Analysis")
        self.assertEqual([group["key"] for group in groups], ["technical-analysis"])
        self.assertEqual(groups[0]["count"], 1)
        self.assertEqual([row["id"] for row in groups[0]["items"]], ["supertrend-ai"])


if __name__ == "__main__":
    unittest.main()
