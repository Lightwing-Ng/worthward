"""
Pure presentation builders for strategy selectors, forms, and settings rows.

Code version: v0.1.0
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from strategies.base import BaseStrategy, StrategyParameterDefinition


STRATEGY_CATEGORY_LABELS = {
    "baseline": "Baseline",
    "recent": "Recent",
    "all": "All",
}
StrategyFactory = Callable[[str], BaseStrategy]


def format_strategy_category_label(category: str) -> str:
    """Return the user-facing label for a strategy category key."""
    normalized = (category or "general").strip().lower()
    return STRATEGY_CATEGORY_LABELS.get(
        normalized,
        normalized.replace("-", " ").title(),
    )


def build_strategy_option_groups(
    strategy_options: list[dict[str, object]],
    recent_strategy_ids: Sequence[str],
) -> list[dict[str, object]]:
    """Build baseline, recent, and alphabetical selector groups."""
    baseline_items = [
        item
        for item in strategy_options
        if item.get("id") == "buy-and-hold"
    ]

    recent_items = []
    for strategy_id in recent_strategy_ids:
        if strategy_id == "buy-and-hold":
            continue
        matching = [
            item
            for item in strategy_options
            if item.get("id") == strategy_id
        ]
        if matching:
            recent_items.append(matching[0])

    all_other_items = sorted(
        [
            item
            for item in strategy_options
            if item.get("id") != "buy-and-hold"
        ],
        key=lambda item: str(item.get("name", "")).lower(),
    )

    groups: list[dict[str, object]] = []
    if baseline_items:
        groups.append(
            {
                "key": "baseline",
                "label": STRATEGY_CATEGORY_LABELS["baseline"],
                "items": baseline_items,
            }
        )
    if recent_items:
        groups.append(
            {
                "key": "recent",
                "label": STRATEGY_CATEGORY_LABELS["recent"],
                "items": recent_items,
            }
        )
    if all_other_items:
        groups.append(
            {
                "key": "all",
                "label": STRATEGY_CATEGORY_LABELS["all"],
                "items": all_other_items,
            }
        )
    return groups


def build_strategy_form_field(
    definition: StrategyParameterDefinition,
    value: Any,
) -> dict[str, object]:
    """Translate one strategy parameter definition into template field data."""

    def format_numeric_value(raw_value: Any, *, kind: str, step: Any) -> Any:
        if kind != "number":
            return raw_value
        try:
            numeric_value = float(raw_value)
        except (TypeError, ValueError):
            return raw_value
        step_text = "" if step is None else str(step)
        decimals = len(step_text.split(".", 1)[1]) if "." in step_text else 1
        return f"{numeric_value:.{decimals}f}"

    resolved_value = definition.default if value is None else value
    input_mode = "text"
    slider_min: int | float | None = None
    slider_max: int | float | None = None
    slider_step: int | float | None = None
    switch_checked = False
    switch_on_value: str | int = 1
    switch_off_value: str | int = 0

    if definition.kind in {"integer", "number"}:
        field_type = "number"
        input_mode = "decimal" if definition.kind == "number" else "numeric"
        base_value = (
            resolved_value
            if isinstance(resolved_value, (int, float))
            else definition.default
        )
        if not isinstance(base_value, (int, float)):
            base_value = 0
        slider_step = (
            definition.step
            if definition.step is not None
            else (0.1 if definition.kind == "number" else 1)
        )
        slider_min = (
            definition.minimum
            if definition.minimum is not None
            else min(0, base_value)
        )
        if definition.maximum is not None:
            slider_max = definition.maximum
        else:
            scale = max(
                abs(float(base_value or 0)),
                abs(float(definition.default or 0)),
                1.0,
            )
            slider_max = scale * 4
            if definition.kind == "integer":
                slider_max = max(
                    int(slider_min) + 1,
                    int(round(slider_max)),
                )
            else:
                slider_max = max(
                    float(slider_min) + float(slider_step),
                    round(float(slider_max), 4),
                )
    elif definition.kind == "string":
        field_type = "text"
    elif definition.kind == "boolean":
        field_type = "switch"
        switch_checked = bool(resolved_value)
    else:
        field_type = "select"
        options = tuple(str(option) for option in definition.options)
        if options in {("Off", "On"), ("On", "Off")}:
            field_type = "switch"
            switch_on_value = "On"
            switch_off_value = "Off"
            switch_checked = str(resolved_value) == "On"

    return {
        "key": definition.key,
        "label": definition.label,
        "kind": definition.kind,
        "field_type": field_type,
        "input_mode": input_mode,
        "value": format_numeric_value(
            resolved_value,
            kind=definition.kind,
            step=definition.step,
        ),
        "default": definition.default,
        "minimum": definition.minimum,
        "maximum": definition.maximum,
        "step": definition.step,
        "slider_min": slider_min,
        "slider_max": slider_max,
        "slider_step": slider_step,
        "options": list(definition.options),
        "editable": definition.editable,
        "help_text": definition.help_text,
        "unit_hint": definition.unit_hint,
        "placeholder": definition.placeholder,
        "switch_checked": switch_checked,
        "switch_on_value": switch_on_value,
        "switch_off_value": switch_off_value,
    }


def build_strategy_form_fields(
    strategy_id: str,
    values: dict[str, Any] | None,
    *,
    strategy_factory: StrategyFactory,
) -> list[dict[str, object]]:
    """Build every template field for one strategy using an injected factory."""
    strategy = strategy_factory(strategy_id)
    normalized_values = strategy.normalize_params(values or {})
    return [
        build_strategy_form_field(
            definition,
            normalized_values.get(definition.key),
        )
        for definition in strategy.get_parameter_definitions()
    ]


def build_strategy_settings_rows(
    strategy_options: list[dict[str, object]],
    *,
    strategy_factory: StrategyFactory,
) -> list[dict[str, object]]:
    """Build the read-only strategy catalog rows rendered in Settings."""
    rows: list[dict[str, object]] = []
    for item in strategy_options:
        strategy = strategy_factory(str(item["id"]))
        rows.append(
            {
                "id": item["id"],
                "name": item["name"],
                "category": format_strategy_category_label(
                    str(item.get("category", "general"))
                ),
                "description": item.get("description", ""),
                "supports": item.get("supports", {}),
                "parameters": [
                    {
                        "label": definition.label,
                        "default_display": definition.display_default(),
                        "meaning": definition.help_text,
                    }
                    for definition in strategy.get_parameter_definitions()
                ],
            }
        )

    supertrend_ai_row = next(
        (row for row in rows if row.get("id") == "supertrend-ai"),
        None,
    )
    if supertrend_ai_row is not None:
        raw_parameters = supertrend_ai_row.get("parameters", [])
        copied_parameters = (
            [
                dict(parameter)
                for parameter in raw_parameters
                if isinstance(parameter, dict)
            ]
            if isinstance(raw_parameters, list)
            else []
        )
        rows.append(
            {
                **supertrend_ai_row,
                "parameters": copied_parameters,
            }
        )
    return rows
