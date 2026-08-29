"""
Base strategy interfaces.

Code version: v0.6.0
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import math
from typing import Any, Literal, Sequence

import pandas as pd


@dataclass
class StrategySignalResult:
    frame: pd.DataFrame
    buy_signal_column: str
    sell_signal_column: str
    execution_profile: str = "single_ticker"
    metadata: dict[str, Any] = field(default_factory=dict)
    presentation: dict[str, Any] = field(default_factory=dict)
    required_execution_mode: Literal["signal_close", "next_open"] | None = None


def normalize_strategy_presentation(value: object) -> dict[str, Any]:
    """Return a JSON-safe declarative strategy presentation payload."""

    def normalize(node: object, path: str) -> Any:
        if node is None or isinstance(node, (str, bool, int)):
            return node
        if isinstance(node, float):
            if not math.isfinite(node):
                raise ValueError(f"Strategy presentation contains a non-finite number at {path}.")
            return node
        if isinstance(node, dict):
            normalized: dict[str, Any] = {}
            for key, item in node.items():
                if not isinstance(key, str) or not key:
                    raise ValueError(f"Strategy presentation contains an invalid key at {path}.")
                normalized[key] = normalize(item, f"{path}.{key}")
            return normalized
        if isinstance(node, (list, tuple)):
            return [normalize(item, f"{path}[{index}]") for index, item in enumerate(node)]
        raise ValueError(
            f"Strategy presentation contains unsupported data at {path}: {type(node).__name__}."
        )

    if value in (None, {}):
        return {}
    normalized_value = normalize(value, "presentation")
    if not isinstance(normalized_value, dict):
        raise ValueError("Strategy presentation must be a dictionary.")
    return normalized_value


@dataclass(frozen=True)
class StrategyParameterDefinition:
    key: str
    label: str
    kind: Literal["integer", "number", "choice", "string", "boolean"] = "integer"
    default: Any = None
    minimum: int | float | None = None
    maximum: int | float | None = None
    step: int | float | None = None
    options: tuple[Any, ...] = field(default_factory=tuple)
    editable: bool = True
    help_text: str = ""
    unit_hint: str = ""
    placeholder: str = ""

    def display_default(self) -> str:
        if self.default is None:
            return "None"
        if self.kind == "boolean":
            return "On" if bool(self.default) else "Off"
        if self.kind == "integer":
            try:
                return str(int(self.default))
            except (TypeError, ValueError):
                return str(self.default)
        if self.kind == "number":
            try:
                numeric_value = float(self.default)
            except (TypeError, ValueError):
                return str(self.default)
            step_text = "" if self.step is None else str(self.step)
            decimals = len(step_text.split(".", 1)[1]) if "." in step_text else 1
            return f"{numeric_value:.{decimals}f}"
        return str(self.default)


@dataclass(frozen=True)
class StrategySupportMatrix:
    single_ticker: bool = True
    multi_ticker: bool = False
    long_only: bool = True
    short: bool = False
    required_tickers: int = 1


@dataclass(frozen=True)
class StrategyMetadata:
    strategy_id: str
    name: str
    description: str = ""
    category: str = "general"
    enabled: bool = True
    display_order: int = 9999
    supports: StrategySupportMatrix = field(default_factory=StrategySupportMatrix)

    def to_catalog_entry(
            self,
            module: str,
            class_name: str,
            default_params: dict[str, Any],
            default_tickers: Sequence[str] = (),
    ) -> dict[str, Any]:
        return {
            "id": self.strategy_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "enabled": self.enabled,
            "supports": asdict(self.supports),
            "default_params": default_params,
            "default_tickers": list(default_tickers),
            "module": module,
            "class_name": class_name,
            "ui": {
                "display_order": self.display_order,
            },
        }


class BaseStrategy:
    strategy_id: str = ""
    strategy_name: str = ""
    strategy_description: str = ""
    strategy_category: str = "general"
    strategy_enabled: bool = True
    strategy_display_order: int = 9999
    strategy_supports: StrategySupportMatrix = StrategySupportMatrix()
    strategy_supported_intervals: tuple[str, ...] = ("1d", "1m")
    strategy_market_data_source: str = "default"
    backtest_cacheable: bool = True

    @classmethod
    def get_metadata(cls) -> StrategyMetadata:
        return StrategyMetadata(
            strategy_id=cls.strategy_id,
            name=cls.strategy_name,
            description=cls.strategy_description,
            category=cls.strategy_category,
            enabled=cls.strategy_enabled,
            display_order=cls.strategy_display_order,
            supports=cls.strategy_supports,
        )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return ()

    def get_default_params(self) -> dict[str, Any]:
        return {
            definition.key: definition.default
            for definition in self.get_parameter_definitions()
        }

    def get_startup_params(self) -> dict[str, Any]:
        """Return validated, normalized parameters for the first calculation."""
        normalized = self.normalize_params(self.get_default_params())
        for definition in self.get_parameter_definitions():
            value = normalized.get(definition.key)
            if definition.kind in {"integer", "number"}:
                if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                    raise ValueError(
                        f"{self.strategy_id} has an invalid default for {definition.key}."
                    )
                if definition.minimum is not None and value < definition.minimum:
                    raise ValueError(
                        f"{self.strategy_id} has a default below the minimum for {definition.key}."
                    )
                if definition.maximum is not None and value > definition.maximum:
                    raise ValueError(
                        f"{self.strategy_id} has a default above the maximum for {definition.key}."
                    )
            elif definition.kind == "choice" and definition.options and value not in definition.options:
                raise ValueError(
                    f"{self.strategy_id} has a default outside the options for {definition.key}."
                )
        return normalized

    def get_default_tickers(self) -> tuple[str, ...]:
        """Return strategy-owned ticker defaults for multi-asset strategies."""
        return ()

    def get_required_ticker_count(self) -> int:
        """Return the number of ordered ticker inputs required by the strategy."""
        supports = self.get_metadata().supports
        return max(1, int(supports.required_tickers or (2 if supports.multi_ticker else 1)))

    def get_supported_intervals(self) -> tuple[str, ...]:
        """Return the market-data intervals this strategy can calculate."""
        supported = tuple(
            interval
            for interval in self.strategy_supported_intervals
            if interval in {"1d", "1m"}
        )
        return supported or ("1d",)

    def load_market_datasets(
            self,
            tickers: Sequence[str],
            *,
            interval: str,
            start: Any,
            end: Any,
            params: dict[str, Any] | None = None,
    ) -> list[pd.DataFrame] | None:
        """Optionally supply strategy-owned market data before range slicing."""
        del tickers, interval, start, end, params
        return None

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
            elif definition.kind == "boolean":
                if isinstance(value, str):
                    normalized_bool = value.strip().lower()
                    value = normalized_bool in {"1", "true", "yes", "on"}
                else:
                    value = bool(value)
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
