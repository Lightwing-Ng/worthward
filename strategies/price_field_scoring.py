"""Score the complete close-anchored Price Field. Code version: v1.2.0.

Research bins are fixed from causal price history, independently of candidate
parameters and browser geometry. Every horizon includes both outside tails.
"""

from __future__ import annotations

import math
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

from strategies.price_field_pipeline import multi_step_price_field_normal_parameters

GRID_SCORING_VERSION = "close-price-grid/v1.1.3"
GRID_HORIZONS = tuple(range(1, 21))
GRID_ROWS = 20
_CENTRAL_INTERVAL_LEVELS = (0.50, 0.80, 0.95)


def causal_grid_edges(closes: np.ndarray, origin: int) -> np.ndarray | None:
    """Freeze 20 equal price bands using at most 60 already observed returns."""
    history = np.asarray(closes[max(0, origin - 60):origin + 1], dtype=float)
    if len(history) < 16 or not np.all(np.isfinite(history) & (history > 0)):
        return None
    volatility = max(0.005, float(np.std(np.diff(np.log(history)), ddof=1)))
    half_width = min(0.90, 4.0 * volatility * math.sqrt(max(GRID_HORIZONS)))
    return np.log(np.linspace(1.0 - half_width, 1.0 + half_width, GRID_ROWS + 1))


def grid_masses(edges: np.ndarray, mean: float, scale: float) -> np.ndarray:
    """Return all 20 cells and two tails without thresholding or renormalizing."""
    if not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0:
        raise ValueError("Grid masses require a finite mean and positive scale.")
    cdf = np.array([
        0.5 * math.erfc(-(float(edge) - mean) / (scale * math.sqrt(2.0)))
        for edge in edges
    ])
    masses = np.diff(np.concatenate(([0.0], cdf, [1.0])))
    if (
            not np.all(np.isfinite(masses))
            or np.any(masses < 0)
            or not math.isclose(float(np.sum(masses)), 1.0, abs_tol=1e-12)
    ):
        raise ValueError("Grid masses must form one finite probability vector.")
    return masses


def normal_crps(observed: float, mean: float, scale: float) -> float:
    """Return the Gaussian CRPS in the observed target's units."""
    if (
            not all(math.isfinite(value) for value in (observed, mean, scale))
            or scale <= 0
    ):
        raise ValueError("CRPS requires finite observations and a positive scale.")
    z_score = (observed - mean) / scale
    cdf = 0.5 * math.erfc(-z_score / math.sqrt(2.0))
    density = math.exp(-0.5 * z_score * z_score) / math.sqrt(2.0 * math.pi)
    result = scale * (
        z_score * (2.0 * cdf - 1.0)
        + 2.0 * density
        - 1.0 / math.sqrt(math.pi)
    )
    if not math.isfinite(result):
        raise ValueError("CRPS must be finite.")
    return result


def central_price_span_pct(radius: float) -> float | None:
    """Return a finite multiplicative price span or omit an unrenderable one."""
    if not math.isfinite(radius) or radius < 0:
        return None
    try:
        span = 200.0 * math.sinh(radius)
    except OverflowError:
        return None
    return span if math.isfinite(span) else None


def _mean(values: list[float]) -> float | None:
    return float(np.mean(values)) if values else None


def visible_scoring_bounds(
        full_dates: pd.Series,
        visible_dates: pd.Series,
) -> tuple[int, int]:
    """Map one contiguous visible date range into its warmup-inclusive frame."""
    visible_index = pd.Index(visible_dates)
    if visible_index.empty:
        return 0, 0
    full_index = pd.Index(full_dates)
    positions = full_index.get_indexer(visible_index)
    if np.any(positions < 0):
        raise ValueError("Every visible scoring date must exist in the full frame.")
    expected = np.arange(int(positions[0]), int(positions[0]) + len(positions))
    if not np.array_equal(positions, expected):
        raise ValueError("Visible scoring dates must form one contiguous full-frame range.")
    return int(positions[0]), int(positions[-1]) + 1


def aggregate_complete_horizon_crps_skill(
        horizons: dict[str, Any],
) -> tuple[float | None, int]:
    """Average CRPS skills only when every standard horizon is scoreable."""
    skills: list[float] = []
    for horizon in GRID_HORIZONS:
        item = horizons.get(str(horizon))
        value = item.get("crps_skill_score") if isinstance(item, dict) else None
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            skills.append(float(value))
    if len(skills) != len(GRID_HORIZONS):
        return None, len(skills)
    return _mean(skills), len(skills)


def aggregate_central_intervals(
        horizons: dict[str, Any],
) -> dict[str, dict[str, float | int | None]]:
    aggregates: dict[str, dict[str, float | int | None]] = {}
    for level in _CENTRAL_INTERVAL_LEVELS:
        key = str(int(level * 100))
        intervals = [
            item["central_intervals"][key]
            for item in horizons.values()
            if item.get("valid_pairs", 0) > 0
        ]
        valid_pairs = sum(int(item["valid_pairs"]) for item in horizons.values())
        hits = sum(int(item.get("hits", 0)) for item in intervals)
        weighted_width = sum(
            float(item["mean_log_return_width"]) * int(horizon["valid_pairs"])
            for horizon in horizons.values()
            if horizon.get("valid_pairs", 0) > 0
            for item in (horizon["central_intervals"][key],)
            if item.get("mean_log_return_width") is not None
        )
        price_spans_complete = all(
            horizon.get("valid_pairs", 0) <= 0
            or horizon["central_intervals"][key].get(
                "mean_price_span_pct"
            ) is not None
            for horizon in horizons.values()
        )
        weighted_price_span = sum(
            float(item["mean_price_span_pct"]) * int(horizon["valid_pairs"])
            for horizon in horizons.values()
            if horizon.get("valid_pairs", 0) > 0
            for item in (horizon["central_intervals"][key],)
            if item.get("mean_price_span_pct") is not None
        )
        mean_width = weighted_width / valid_pairs if valid_pairs else None
        aggregates[key] = {
            "hits": hits,
            "valid_pairs": valid_pairs,
            "coverage_pct": 100.0 * hits / valid_pairs if valid_pairs else None,
            "mean_log_return_width": mean_width,
            "mean_price_span_pct": (
                weighted_price_span / valid_pairs
                if valid_pairs and price_spans_complete
                else None
            ),
        }
    return aggregates


def score_price_field_grid(
        frame: pd.DataFrame,
        start: int,
        end: int,
        *,
        predictive_mean_column: str = "lstm_predictive_mean",
        predictive_scale_column: str = "lstm_predictive_std",
        return_autoregression_column: str = "lstm_return_autoregression",
        return_long_run_mean_column: str = "lstm_return_long_run_mean",
        return_innovation_scale_column: str = "lstm_return_innovation_std",
) -> dict[str, Any]:
    """Score log(Close[t+h]/Close[t]) inside one causal evaluation fold.

    The UI applies executable-return forecasts to a close anchor. This metric
    tests that displayed projection directly; it is not a new trading target.
    Half the multiclass Brier sum ranges from zero to one. Missing forecasts
    receive its maximum loss on a candidate-independent eligible denominator.
    """
    closes = pd.to_numeric(frame["Close"], errors="coerce").to_numpy(dtype=float)
    start, end = max(0, int(start)), min(len(frame), int(end))
    if end < start:
        raise ValueError("The scoring interval must have end >= start.")
    columns = [
        predictive_mean_column,
        predictive_scale_column,
        return_autoregression_column,
        return_long_run_mean_column,
        return_innovation_scale_column,
    ]
    predictions = frame[columns].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    edges_by_origin = {
        origin: causal_grid_edges(closes, origin)
        for origin in range(max(0, start), min(end, len(frame)))
    }
    horizons: dict[str, Any] = {}
    for horizon in GRID_HORIZONS:
        losses, reference_losses, hit_masses, log_losses = [], [], [], []
        crps_values: list[float] = []
        reference_crps_values: list[float] = []
        negative_log_predictive_densities: list[float] = []
        probability_integral_transforms: list[float] = []
        intervals: dict[str, dict[str, Any]] = {
            str(int(level * 100)): {
                "hits": 0,
                "widths": [],
                "price_spans": [],
            }
            for level in _CENTRAL_INTERVAL_LEVELS
        }
        valid, top_hits, outside = 0, 0, 0
        for origin, edges in edges_by_origin.items():
            target = origin + horizon
            if target >= min(end, len(frame)) or edges is None:
                continue
            # Never bridge a missing real daily observation inside the path.
            path = closes[origin:target + 1]
            if not np.all(np.isfinite(path) & (path > 0)):
                continue
            observed = math.log(float(closes[target] / closes[origin]))
            category = int(np.searchsorted(edges, observed, side="right"))
            history = closes[max(0, origin - 60):origin + 1]
            reference_scale = max(0.005, float(np.std(np.diff(np.log(history)), ddof=1)))
            reference = grid_masses(edges, 0.0, reference_scale * math.sqrt(horizon))
            reference_losses.append(float((reference @ reference + 1 - 2 * reference[category]) / 2))
            mean, scale, phi, equilibrium, innovation = predictions[origin]
            if not np.all(np.isfinite(predictions[origin])) or scale <= 0 or innovation <= 0:
                losses.append(1.0)
                continue
            try:
                mean, scale = multi_step_price_field_normal_parameters(
                    mean, scale, horizon, phi, equilibrium, innovation,
                )
                if not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0:
                    raise ValueError("Evolved forecast moments must be finite.")
                reference_horizon_scale = reference_scale * math.sqrt(horizon)
                masses = grid_masses(edges, mean, scale)
                loss = float(
                    (masses @ masses + 1 - 2 * masses[category]) / 2
                )
                hit_mass = float(masses[category])
                log_loss = -math.log(max(1e-15, hit_mass))
                crps_value = normal_crps(observed, mean, scale)
                reference_crps_value = normal_crps(
                    observed,
                    0.0,
                    reference_horizon_scale,
                )
                z_score = (observed - mean) / scale
                probability_integral_transform = 0.5 * math.erfc(
                    -z_score / math.sqrt(2.0)
                )
                negative_log_predictive_density = (
                    0.5 * math.log(2.0 * math.pi)
                    + math.log(scale)
                    + 0.5 * z_score * z_score
                )
                radii = {
                    level: NormalDist().inv_cdf((1.0 + level) / 2.0) * scale
                    for level in _CENTRAL_INTERVAL_LEVELS
                }
            except (ArithmeticError, ValueError):
                losses.append(1.0)
                continue
            candidate_values = (
                loss,
                hit_mass,
                log_loss,
                crps_value,
                reference_crps_value,
                z_score,
                probability_integral_transform,
                negative_log_predictive_density,
                *(value for radius in radii.values() for value in (radius, 2.0 * radius)),
            )
            if not all(math.isfinite(value) for value in candidate_values):
                losses.append(1.0)
                continue
            losses.append(loss)
            hit_masses.append(hit_mass)
            log_losses.append(log_loss)
            crps_values.append(crps_value)
            reference_crps_values.append(reference_crps_value)
            probability_integral_transforms.append(
                probability_integral_transform
            )
            negative_log_predictive_densities.append(
                negative_log_predictive_density
            )
            for level, radius in radii.items():
                interval = intervals[str(int(level * 100))]
                interval["hits"] += int(abs(observed - mean) <= radius)
                interval["widths"].append(2.0 * radius)
                interval["price_spans"].append(central_price_span_pct(radius))
            valid += 1
            top_hits += int(int(np.argmax(masses)) == category)
            outside += int(category in {0, GRID_ROWS + 1})
        eligible = len(losses)
        for interval in intervals.values():
            widths = interval.pop("widths")
            price_spans = interval.pop("price_spans")
            interval["coverage_pct"] = (
                100.0 * int(interval["hits"]) / valid if valid else None
            )
            interval["mean_log_return_width"] = _mean(widths)
            finite_price_spans = [
                span for span in price_spans if span is not None
            ]
            interval["mean_price_span_pct"] = (
                _mean(finite_price_spans)
                if len(finite_price_spans) == len(price_spans)
                else None
            )
        crps = _mean(crps_values)
        reference_crps = _mean(reference_crps_values)
        horizons[str(horizon)] = {
            "eligible_pairs": eligible,
            "valid_pairs": valid,
            "coverage_pct": 100 * valid / eligible if eligible else None,
            "brier_loss": float(np.mean(losses)) if eligible else None,
            "reference_brier_loss": float(np.mean(reference_losses)) if eligible else None,
            "mean_realized_cell_probability": float(np.mean(hit_masses)) if valid else None,
            "negative_log_score": float(np.mean(log_losses)) if valid else None,
            "top_cell_hit_rate_pct": 100 * top_hits / valid if valid else None,
            "outside_grid_pct": 100 * outside / valid if valid else None,
            "crps": crps,
            "reference_crps": reference_crps,
            "crps_skill_score": (
                1.0 - crps / reference_crps
                if reference_crps and crps is not None
                else None
            ),
            "negative_log_predictive_density": _mean(
                negative_log_predictive_densities
            ),
            "pit_histogram": np.histogram(
                probability_integral_transforms,
                bins=np.linspace(0.0, 1.0, 11),
            )[0].tolist(),
            "central_intervals": intervals,
        }
    eligible = sum(item["eligible_pairs"] for item in horizons.values())
    valid = sum(item["valid_pairs"] for item in horizons.values())
    available = [item for item in horizons.values() if item["eligible_pairs"]]
    loss = float(np.mean([item["brier_loss"] for item in available])) if available else None
    reference = float(np.mean([item["reference_brier_loss"] for item in available])) if available else None
    continuous = [item for item in available if item.get("crps") is not None]
    crps = _mean([float(item["crps"]) for item in continuous])
    reference_crps = _mean(
        [float(item["reference_crps"]) for item in continuous]
    )
    crps_skill_score, crps_skill_valid_horizon_count = (
        aggregate_complete_horizon_crps_skill(horizons)
    )
    complete_pair_coverage = eligible > 0 and valid == eligible
    if not complete_pair_coverage:
        crps_skill_score = None
    return {
        "schema": GRID_SCORING_VERSION,
        "target": "log(close[t+h]/close[t])",
        "origin_start": start,
        "origin_end": end,
        "grid_rows": GRID_ROWS,
        "tail_categories": 2,
        "horizon_count": len(available),
        "eligible_pairs": eligible,
        "valid_pairs": valid,
        "coverage_pct": 100 * valid / eligible if eligible else None,
        "brier_loss": loss,
        "probability_score_pct": 100 * (1 - loss) if loss is not None else None,
        "reference_brier_loss": reference,
        "brier_skill_score": 1 - loss / reference if reference and loss is not None else None,
        "crps": crps,
        "reference_crps": reference_crps,
        "crps_skill_score": crps_skill_score,
        "crps_skill_aggregation": "equal-mean-of-all-20-horizon-skills",
        "crps_skill_valid_horizon_count": crps_skill_valid_horizon_count,
        "crps_skill_required_horizon_count": len(GRID_HORIZONS),
        "crps_skill_requires_complete_pair_coverage": True,
        "crps_skill_has_complete_pair_coverage": complete_pair_coverage,
        "central_intervals": aggregate_central_intervals(horizons),
        "continuous_diagnostics_denominator": (
            "valid forecasts only; inspect coverage"
        ),
        "horizons": horizons,
    }
