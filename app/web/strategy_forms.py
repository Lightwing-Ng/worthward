"""
Pure presentation builders for strategy selectors, forms, and settings rows.

Code version: v0.8.1
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from strategies.base import BaseStrategy, StrategyParameterDefinition


STRATEGY_CATEGORY_DEFINITIONS = (
    {
        "key": "baseline",
        "label": "Baseline",
        "description": "Reference strategies used to compare every active approach.",
    },
    {
        "key": "investment-automation",
        "label": "Investment Automation",
        "description": "Schedule- and holding-based rules that mirror configurable investment workflows.",
    },
    {
        "key": "technical-analysis",
        "label": "Technical Analysis",
        "description": "Indicator and TradingView-derived signal strategies.",
    },
    {
        "key": "machine-learning",
        "label": "Machine Learning",
        "description": "Learned signal strategies that do not use the Price Field probability grid.",
    },
    {
        "key": "portfolio-rotation",
        "label": "Portfolio Rotation",
        "description": "Rules that rotate capital across multiple related securities.",
    },
    {
        "key": "price-field",
        "label": "Price Field Models",
        "description": "Probabilistic forecasting strategies that share the causal Price Field grid.",
    },
)
STRATEGY_CATEGORY_BY_KEY = {
    str(definition["key"]): definition
    for definition in STRATEGY_CATEGORY_DEFINITIONS
}
STRATEGY_CATEGORY_KEYS = tuple(STRATEGY_CATEGORY_BY_KEY)
StrategyFactory = Callable[[str], BaseStrategy]


def format_strategy_category_label(category: str) -> str:
    """Return the user-facing label for a strategy category key."""
    normalized = (category or "general").strip().lower()
    normalized = normalized.replace("_", "-")
    definition = STRATEGY_CATEGORY_BY_KEY.get(normalized)
    return str(definition["label"]) if definition else normalized.replace("-", " ").title()


def build_strategy_category_groups(
    items: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Group unique catalog items by their strategy-owned category metadata."""
    unique_by_id: dict[str, dict[str, object]] = {}
    for item in items:
        strategy_id = str(item.get("id", "")).strip()
        if strategy_id and strategy_id not in unique_by_id:
            unique_by_id[strategy_id] = item

    items_by_category: dict[str, list[dict[str, object]]] = {}
    for item in unique_by_id.values():
        category = str(item.get("category_key", item.get("category", "general")))
        category = category.strip().lower().replace("_", "-") or "general"
        items_by_category.setdefault(category, []).append(item)

    ordered_categories = [
        str(definition["key"])
        for definition in STRATEGY_CATEGORY_DEFINITIONS
        if definition["key"] in items_by_category
    ]
    ordered_categories.extend(sorted(
        category
        for category in items_by_category
        if category not in STRATEGY_CATEGORY_BY_KEY
    ))

    groups: list[dict[str, object]] = []
    for category in ordered_categories:
        definition = STRATEGY_CATEGORY_BY_KEY.get(category, {})
        category_items = sorted(
            items_by_category[category],
            key=lambda item: (
                int(
                    item.get("display_order", item.get("ui", {}).get("display_order", 9999))
                    if isinstance(item.get("ui", {}), dict)
                    else item.get("display_order", 9999)
                ),
                str(item.get("name", "")).casefold(),
            ),
        )
        groups.append({
            "key": category,
            "label": definition.get("label", format_strategy_category_label(category)),
            "description": definition.get("description", "Additional registered strategies."),
            "items": category_items,
            "count": len(category_items),
        })
    return groups


def build_strategy_option_groups(
    strategy_options: list[dict[str, object]],
    recent_strategy_ids: Sequence[str] = (),
) -> list[dict[str, object]]:
    """Build the selector from the same authoritative categories as Settings."""
    _ = recent_strategy_ids
    return build_strategy_category_groups(strategy_options)


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

    option_items = [
        {
            "value": option,
            "label": (
                definition.option_labels[index]
                if len(definition.option_labels) == len(definition.options)
                else str(option)
            ),
        }
        for index, option in enumerate(definition.options)
    ]
    selected_option = next(
        (item for item in option_items if item["value"] == resolved_value),
        None,
    )
    visible_when_key = definition.visible_when[0] if definition.visible_when else ""
    visible_when_value = definition.visible_when[1] if definition.visible_when else ""

    return {
        "key": definition.key,
        "group": definition.group,
        "subgroup": definition.subgroup,
        "ui_role": definition.ui_role,
        "ui_apply_mode": definition.ui_apply_mode,
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
        "option_items": option_items,
        "selected_label": (
            selected_option["label"]
            if selected_option is not None
            else str(resolved_value)
        ),
        "editable": definition.editable,
        "help_text": definition.help_text,
        "unit_hint": definition.unit_hint,
        "placeholder": definition.placeholder,
        "switch_checked": switch_checked,
        "switch_on_value": switch_on_value,
        "switch_off_value": switch_off_value,
        "visible_when_key": visible_when_key,
        "visible_when_value": visible_when_value,
        "is_visible": True,
        "content_sized": definition.content_sized,
    }


def build_strategy_form_fields(
    strategy_id: str,
    values: dict[str, Any] | None,
    *,
    strategy_factory: StrategyFactory,
) -> list[dict[str, object]]:
    """Build every template field for one strategy using an injected factory."""
    strategy = strategy_factory(strategy_id)
    get_startup_params = getattr(strategy, "get_startup_params", None)
    normalized_values = (
        get_startup_params()
        if callable(get_startup_params)
        else strategy.normalize_params({})
    )
    if values:
        normalized_values = strategy.normalize_params(values)
    fields = [
        build_strategy_form_field(
            definition,
            normalized_values.get(definition.key),
        )
        for definition in strategy.get_parameter_definitions()
    ]
    for field in fields:
        visible_when_key = str(field["visible_when_key"] or "")
        if visible_when_key:
            field["is_visible"] = (
                str(normalized_values.get(visible_when_key, ""))
                == str(field["visible_when_value"])
            )
    return fields


def build_strategy_form_sections(
    strategy_id: str,
    fields: list[dict[str, object]],
    *,
    strategy_factory: StrategyFactory,
) -> list[dict[str, object]]:
    """Group fields once and expose only strategy-declared action slots."""
    strategy = strategy_factory(strategy_id)
    sections = []
    for section in strategy.get_parameter_sections():
        members = [field for field in fields if field.get("group", "parameters") == section["key"]]
        if members or section["kind"] == "action":
            groups: dict[str, list[dict[str, object]]] = {}
            for member in members:
                groups.setdefault(str(member.get("subgroup", "")), []).append(member)
            sections.append({
                **section, "fields": members,
                "subgroups": [{"title": title, "fields": items} for title, items in groups.items()],
            })
    return sections


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
                "category_key": str(item.get("category", "general")),
                "category": format_strategy_category_label(
                    str(item.get("category", "general"))
                ),
                "display_order": (
                    item.get("ui", {}).get("display_order", 9999)
                    if isinstance(item.get("ui", {}), dict)
                    else 9999
                ),
                "description": item.get("description", ""),
                "supports": item.get("supports", {}),
                "presentation_renderer": item.get("presentation_renderer", ""),
                "parameters": [
                    {
                        "label": definition.label,
                        "default_display": (
                            "Close price"
                            if definition.key == "source" and definition.display_default() == "Close"
                            else definition.display_default()
                        ),
                        "meaning": definition.help_text,
                    }
                    for definition in strategy.get_parameter_definitions()
                ],
            }
        )
    return rows


def build_strategy_settings_groups(
    strategy_options: list[dict[str, object]],
    *,
    strategy_factory: StrategyFactory,
) -> list[dict[str, object]]:
    """Build categorized Settings rows from the shared strategy catalog."""
    return build_strategy_category_groups(build_strategy_settings_rows(
        strategy_options,
        strategy_factory=strategy_factory,
    ))
