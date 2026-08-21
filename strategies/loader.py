"""
Strategy registry and dynamic loader.

Code version: v0.4.1
"""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
from pkgutil import iter_modules
from typing import Any

from .base import BaseStrategy

ALGORITHMS_PACKAGE = "strategies.algorithms"
ALGORITHMS_PATH = Path(__file__).resolve().parent / "algorithms"


def _iter_strategy_classes() -> list[type[BaseStrategy]]:
    discovered: list[type[BaseStrategy]] = []
    for module_info in iter_modules([str(ALGORITHMS_PATH)]):
        if module_info.name.startswith("_"):
            continue
        module = import_module(f"{ALGORITHMS_PACKAGE}.{module_info.name}")
        for attribute in vars(module).values():
            if not isinstance(attribute, type):
                continue
            if attribute is BaseStrategy or not issubclass(attribute, BaseStrategy):
                continue
            if attribute.__module__ != module.__name__:
                continue
            metadata = attribute.get_metadata()
            if not metadata.strategy_id or not metadata.name:
                continue
            discovered.append(attribute)
    return discovered


def _build_strategy_catalog() -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for strategy_class in _iter_strategy_classes():
        strategy = strategy_class()
        metadata = strategy_class.get_metadata()
        catalog.append(
            metadata.to_catalog_entry(
                module=strategy_class.__module__,
                class_name=strategy_class.__name__,
                default_params=strategy.get_startup_params(),
                default_tickers=strategy.get_default_tickers(),
            )
        )
    return sorted(catalog, key=lambda item: (item.get("ui", {}).get("display_order", 9999), item.get("name", "")))


def load_strategy_registry() -> dict[str, Any]:
    return {
        "version": "v2.1.0",
        "strategies": _build_strategy_catalog(),
    }


def list_enabled_strategies() -> list[dict[str, Any]]:
    payload = load_strategy_registry()
    return [item for item in payload.get("strategies", []) if item.get("enabled")]


def get_strategy_definition(strategy_id: str) -> dict[str, Any]:
    for item in list_enabled_strategies():
        if item.get("id") == strategy_id:
            return item
    raise ValueError(f"Unknown strategy: {strategy_id}.")


def instantiate_strategy(strategy_id: str) -> BaseStrategy:
    definition = get_strategy_definition(strategy_id)
    module = import_module(definition["module"])
    strategy_class = getattr(module, definition["class_name"])
    strategy = strategy_class()
    if not isinstance(strategy, BaseStrategy):
        raise TypeError(f"Strategy {strategy_id} does not inherit from BaseStrategy.")
    return strategy
