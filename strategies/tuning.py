"""Registry-driven parameter search with validation-only ranking. Code version: v1.0.0."""

from __future__ import annotations

from dataclasses import dataclass
import math
import time
from typing import Any, Callable

import numpy as np

from .base import BaseStrategy


@dataclass(frozen=True)
class Dimension:
    key: str
    kind: str
    low: float = 0
    high: float = 1
    step: float = 1
    options: tuple[Any, ...] = ()

    def project(self, value: Any) -> Any:
        if self.options:
            return value if value in self.options else self.options[0]
        if value is None:
            value = self.low
        value = self.low + round((float(value) - self.low) / self.step) * self.step
        value = min(self.high, max(self.low, value))
        return int(value) if self.kind == "integer" else round(value, 10)

    def sample(self, rng: np.random.Generator) -> Any:
        if self.options:
            return self.options[int(rng.integers(len(self.options)))]
        return self.project(rng.uniform(self.low, self.high))

    def encode(self, value: Any) -> list[float]:
        if self.options:
            return [float(value == option) for option in self.options]
        return [(float(value) - self.low) / max(self.high - self.low, self.step)]


def search_space(
    strategy: BaseStrategy, bounds: dict | None = None, fixed: dict | None = None
) -> list[Dimension]:
    """Use declared domains; finite exploratory bounds mirror the form slider policy."""
    definitions = {item.key: item for item in strategy.get_parameter_definitions()}
    fixed = fixed or {}
    unknown = (set(bounds or {}) | set(fixed)) - definitions.keys()
    if unknown:
        raise ValueError(f"Unknown parameters: {', '.join(sorted(unknown))}.")
    if set(bounds or {}) & set(fixed):
        raise ValueError("A parameter cannot be both fixed and searched.")
    for key, value in fixed.items():
        definition = definitions[key]
        if value is None and definition.default is None:
            continue
        if definition.kind in {"integer", "number"}:
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise ValueError(f"A finite numeric value is required for {key}.")
            if definition.kind == "integer" and not float(value).is_integer():
                raise ValueError(f"An integer value is required for {key}.")
            if (definition.minimum is not None and value < definition.minimum) or (
                definition.maximum is not None and value > definition.maximum
            ):
                raise ValueError(f"Fixed value is outside {key}'s declared domain.")
        elif definition.kind == "boolean" and not isinstance(value, bool):
            raise ValueError(f"A JSON boolean is required for {key}.")
        elif definition.kind == "choice" and value not in definition.options:
            raise ValueError(f"Invalid choice for {key}.")
        elif definition.kind == "string" and not isinstance(value, str):
            raise ValueError(f"A string is required for {key}.")
    for key in bounds or {}:
        if not definitions[key].editable or not definitions[key].optimizable:
            raise ValueError(
                f"{key} is not a search dimension; use --params to fix it."
            )
    dimensions = []
    for key, definition in definitions.items():
        if key in fixed or not definition.editable or not definition.optimizable:
            continue
        if bounds is not None and key not in bounds:
            continue
        if definition.kind in {"boolean", "choice"}:
            options = (
                (False, True) if definition.kind == "boolean" else definition.options
            )
            selected = tuple(bounds[key]) if bounds is not None else tuple(options)
            if (
                not selected
                or any(value not in options for value in selected)
                or (
                    definition.kind == "boolean"
                    and any(not isinstance(value, bool) for value in selected)
                )
            ):
                raise ValueError(f"Invalid choices for {key}.")
            dimensions.append(Dimension(key, definition.kind, options=selected))
        elif definition.kind in {"integer", "number"}:
            if definition.default is None and bounds is None:
                continue  # Nullable automatic price limits need explicit research bounds.
            default = float(definition.default or 0)
            low = (
                definition.minimum
                if definition.minimum is not None
                else min(0, default)
            )
            high = (
                definition.maximum
                if definition.maximum is not None
                else max(1, abs(default)) * 4
            )
            if bounds is not None:
                low, high = bounds[key]
            low, high = float(low), float(high)
            if not math.isfinite(low + high) or low > high:
                raise ValueError(f"Invalid bounds for {key}.")
            if definition.minimum is not None and low < definition.minimum:
                raise ValueError(f"Lower bound is outside {key}'s declared domain.")
            if definition.maximum is not None and high > definition.maximum:
                raise ValueError(f"Upper bound is outside {key}'s declared domain.")
            if definition.kind == "integer" and (
                not low.is_integer() or not high.is_integer()
            ):
                raise ValueError(f"Integer bounds required for {key}.")
            dimensions.append(
                Dimension(key, definition.kind, low, high, float(definition.step or 1))
            )
    return dimensions


class RegressionForest:
    """Small bootstrap CART ensemble used only as a search surrogate, not a price model."""

    def __init__(self, rng: np.random.Generator, trees: int = 32):
        self.rng = rng
        self.tree_count = trees
        self.trees: list[Any] = []

    def fit(self, x: np.ndarray, y: np.ndarray) -> None:
        def build(rows, depth=0):
            values = y[rows]
            if depth >= 6 or len(rows) < 4 or np.ptp(values) < 1e-10:
                return float(values.mean())
            best = None
            features = self.rng.choice(
                x.shape[1], max(1, int(math.sqrt(x.shape[1]))), replace=False
            )
            for feature in features:
                unique = np.unique(x[rows, feature])
                for threshold in (unique[1:] + unique[:-1]) / 2:
                    mask = x[rows, feature] <= threshold
                    left, right = rows[mask], rows[~mask]
                    if min(len(left), len(right)) < 2:
                        continue
                    loss = float(
                        np.var(y[left]) * len(left) + np.var(y[right]) * len(right)
                    )
                    if best is None or loss < best[0]:
                        best = (loss, int(feature), float(threshold), left, right)
            if best is None:
                return float(values.mean())
            return (
                best[1],
                best[2],
                build(best[3], depth + 1),
                build(best[4], depth + 1),
            )

        self.trees = [
            build(self.rng.integers(len(y), size=len(y)))
            for _ in range(self.tree_count)
        ]

    def predict(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        def walk(tree, row):
            while isinstance(tree, tuple):
                feature, threshold, left, right = tree
                tree = left if row[feature] <= threshold else right
            return tree

        predictions = np.array([[walk(tree, row) for row in x] for tree in self.trees])
        return predictions.mean(axis=0), predictions.std(axis=0)


def optimize(
    strategy: BaseStrategy,
    evaluate: Callable[[dict], dict],
    *,
    method: str = "genetic",
    trials: int = 16,
    seed: int = 42,
    time_budget: float = 600,
    bounds: dict | None = None,
    fixed: dict | None = None,
    on_result: Callable[[dict], None] | None = None,
) -> dict:
    """Rank only validation scores. The caller evaluates the winner's holdout once."""
    if (
        method not in {"genetic", "random-forest"}
        or not 1 <= trials <= 1000
        or not math.isfinite(time_budget)
        or time_budget <= 0
    ):
        raise ValueError("Invalid search method, trial count, or time budget.")
    dimensions = search_space(strategy, bounds, fixed)
    base = strategy.normalize_params({**strategy.get_startup_params(), **(fixed or {})})
    for dimension in dimensions:
        base[dimension.key] = dimension.project(base[dimension.key])
    rng = np.random.default_rng(seed)
    records, successful, seen = [], [], set()
    started = time.monotonic()

    def random_candidate():
        return {
            **base,
            **{dimension.key: dimension.sample(rng) for dimension in dimensions},
        }

    def encode(params):
        return [
            value
            for dimension in dimensions
            for value in dimension.encode(params[dimension.key])
        ]

    for index in range(trials if dimensions else 1):
        if index and time.monotonic() - started >= time_budget:
            break  # Cooperative bound: an in-flight strategy evaluation finishes normally.
        candidate = base if index == 0 else random_candidate()
        if index and method == "genetic" and successful:
            elite = sorted(successful, key=lambda item: item["score"], reverse=True)[
                : max(2, len(successful) // 3)
            ]
            parents = [elite[int(rng.integers(len(elite)))]["params"] for _ in range(2)]
            candidate = {
                **base,
                **{
                    dimension.key: (
                        dimension.sample(rng)
                        if rng.random() < 0.3
                        else parents[int(rng.integers(2))][dimension.key]
                    )
                    for dimension in dimensions
                },
            }
        elif index and method == "random-forest" and len(successful) >= 4:
            forest = RegressionForest(rng)
            forest.fit(
                np.array([encode(item["params"]) for item in successful]),
                np.array([item["score"] for item in successful]),
            )
            pool = [random_candidate() for _ in range(128)]
            mean, uncertainty = forest.predict(
                np.array([encode(item) for item in pool])
            )
            candidate = pool[int(np.argmax(mean + uncertainty))]
        for _ in range(128):
            candidate = strategy.normalize_params(candidate)
            key = repr(sorted(candidate.items()))
            if key not in seen:
                break
            candidate = random_candidate()
        else:
            break
        seen.add(key)
        try:
            metrics = evaluate(candidate)
            score = float(metrics["score"])
            if not math.isfinite(score):
                raise ValueError("Validation score is not finite.")
            record = {
                "trial": index + 1,
                "params": candidate,
                "status": "ok",
                **metrics,
            }
            successful.append(record)
        except (ValueError, RuntimeError, ArithmeticError) as exc:
            record = {
                "trial": index + 1,
                "params": candidate,
                "status": "failed_closed",
                "error": str(exc),
            }
        records.append(record)
        if on_result:
            on_result(record)
    return {
        "method": method,
        "status": "completed" if successful else "failed_closed",
        "search_seed": seed,
        "trials": records,
        "best": max(successful, key=lambda item: item["score"]) if successful else None,
        "search_space": [dimension.__dict__ for dimension in dimensions],
        "baseline_only": not dimensions,
        "elapsed_seconds": round(time.monotonic() - started, 3),
    }
