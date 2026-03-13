"""
Strategy registry and dynamic loader.

Code version: v1.0.0
"""

from __future__ import annotations

from importlib import import_module
import json
from pathlib import Path
from typing import Any

from .base import BaseStrategy


REGISTRY_PATH = Path(__file__).resolve().parent / "registry.json"


def load_strategy_registry() -> dict[str, Any]:
    return json.loads(REGISTRY_PATH.read_text())


def list_enabled_strategies() -> list[dict[str, Any]]:
    payload = load_strategy_registry()
    strategies = [item for item in payload.get("strategies", []) if item.get("enabled")]
    return sorted(strategies, key=lambda item: (item.get("ui", {}).get("display_order", 9999), item.get("name", "")))


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
