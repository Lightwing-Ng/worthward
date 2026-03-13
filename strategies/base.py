"""
Base strategy interfaces.

Code version: v1.1.0
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd


@dataclass(slots=True)
class StrategySignalResult:
    frame: pd.DataFrame
    buy_signal_column: str
    sell_signal_column: str


@dataclass(slots=True, frozen=True)
class StrategyParameterDefinition:
    key: str
    label: str
    kind: Literal["integer", "number", "choice", "string"] = "integer"
    default: Any = None
    minimum: int | float | None = None
    maximum: int | float | None = None
    step: int | float | None = None
    options: tuple[Any, ...] = field(default_factory=tuple)
    editable: bool = True
    help_text: str = ""

    def display_default(self) -> str:
        if self.default is None:
            return "None"
        return str(self.default)


class BaseStrategy:
    strategy_id: str = ""
    strategy_name: str = ""

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return ()

    def get_default_params(self) -> dict[str, Any]:
        return {
            definition.key: definition.default
            for definition in self.get_parameter_definitions()
        }

    def normalize_params(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        merged: dict[str, Any] = {
            **self.get_default_params(),
            **(params or {}),
        }
        normalized: dict[str, Any] = {}
        for definition in self.get_parameter_definitions():
            raw_value = merged.get(definition.key, definition.default)
            value = raw_value if raw_value is not None else definition.default
            if definition.kind == "integer":
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    value = int(definition.default or 0)
            elif definition.kind == "number":
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    value = float(definition.default or 0.0)
            elif definition.kind == "choice":
                if definition.options and value not in definition.options:
                    value = definition.default
            else:
                value = str(value) if value is not None else str(definition.default or "")

            if definition.minimum is not None and isinstance(value, (int, float)):
                value = max(definition.minimum, value)
            if definition.maximum is not None and isinstance(value, (int, float)):
                value = min(definition.maximum, value)
            normalized[definition.key] = value

        for key, value in merged.items():
            normalized.setdefault(key, value)
        return normalized

    def compute_signals(
        self,
        dataset: pd.DataFrame,
        params: dict | None = None,
    ) -> StrategySignalResult:
        raise NotImplementedError
