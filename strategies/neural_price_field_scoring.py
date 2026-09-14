"""Evaluate direct multi-horizon return distributions. Code version: v1.2.0.

The fixed causal grid is shared with the existing Price Field scorer. Display
thresholds never change its denominator, cells, or outside-tail probabilities.
"""

from __future__ import annotations

import math
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

from strategies.price_field_scoring import (
    GRID_HORIZONS,
    GRID_ROWS,
    aggregate_complete_horizon_crps_skill,
    aggregate_central_intervals,
    causal_grid_edges,
    central_price_span_pct,
    grid_masses,
    normal_crps,
)

NEURAL_SCORING_VERSION = "direct-close-price-grid/v1.1.3"
_INTERVALS = (0.50, 0.80, 0.95)


def _mean(values: list[float]) -> float | None:
    return float(np.mean(values)) if values else None


def score_neural_price_field(frame: pd.DataFrame, start: int, end: int) -> dict[str, Any]:
    """Score realized log(Close[t+h]/Close[t]) wholly inside [start, end).

    Missing forecasts receive maximum grid loss on the same eligible slots.
    Continuous diagnostics report their valid-only denominator explicitly;
    coverage gates must accompany their interpretation and model selection.
    """
    closes = pd.to_numeric(frame["Close"], errors="coerce").to_numpy(dtype=float)
    start, end = max(0, int(start)), min(len(frame), int(end))
    if end < start:
        raise ValueError("The scoring interval must have end >= start.")
    edges_by_origin = {origin: causal_grid_edges(closes, origin) for origin in range(start, end)}
    scales_by_origin = {
        origin: max(0.005, float(np.std(np.diff(np.log(closes[max(0, origin - 60):origin + 1])), ddof=1)))
        for origin, edges in edges_by_origin.items() if edges is not None
    }
    horizons: dict[str, Any] = {}
    binary_losses: list[float] = []
    binary_valid = 0
    binary_hits = 0
    direction_count = 0
    for horizon in GRID_HORIZONS:
        means = pd.to_numeric(frame.get(f"pf_mean_h{horizon:02d}", pd.Series(np.nan, index=frame.index)), errors="coerce").to_numpy(dtype=float)
        scales = pd.to_numeric(frame.get(f"pf_std_h{horizon:02d}", pd.Series(np.nan, index=frame.index)), errors="coerce").to_numpy(dtype=float)
        losses, references, crps_values, reference_crps, nlpds, pits = [], [], [], [], [], []
        hit_masses, cell_logs = [], []
        intervals: dict[str, Any] = {
            str(int(level * 100)): {
                "hits": 0,
                "widths": [],
                "price_spans": [],
            }
            for level in _INTERVALS
        }
        top_hits, outside = 0, 0
        for origin, edges in edges_by_origin.items():
            target = origin + horizon
            if target >= end or edges is None:
                continue
            path = closes[origin:target + 1]
            if not np.all(np.isfinite(path) & (path > 0)):
                continue
            observed = math.log(float(closes[target] / closes[origin]))
            category = int(np.searchsorted(edges, observed, side="right"))
            reference_scale = scales_by_origin[origin] * math.sqrt(horizon)
            reference = grid_masses(edges, 0.0, reference_scale)
            references.append(float((reference @ reference + 1 - 2 * reference[category]) / 2))
            mean, scale = float(means[origin]), float(scales[origin])
            if not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0:
                losses.append(1.0)
                if horizon == 1:
                    binary_losses.append(1.0)
                continue
            try:
                masses = grid_masses(edges, mean, scale)
                loss = float(
                    (masses @ masses + 1 - 2 * masses[category]) / 2
                )
                hit_mass = float(masses[category])
                cell_log = -math.log(max(1e-15, hit_mass))
                z_score = (observed - mean) / scale
                pit = 0.5 * math.erfc(-z_score / math.sqrt(2.0))
                crps_value = normal_crps(observed, mean, scale)
                reference_crps_value = normal_crps(
                    observed,
                    0.0,
                    reference_scale,
                )
                nlpd = (
                    0.5 * math.log(2 * math.pi)
                    + math.log(scale)
                    + 0.5 * z_score * z_score
                )
                radii = {
                    level: NormalDist().inv_cdf((1 + level) / 2) * scale
                    for level in _INTERVALS
                }
                probability = (
                    0.5 * math.erfc(-mean / (scale * math.sqrt(2.0)))
                    if horizon == 1
                    else None
                )
            except (ArithmeticError, ValueError):
                losses.append(1.0)
                if horizon == 1:
                    binary_losses.append(1.0)
                continue
            candidate_values = (
                loss,
                hit_mass,
                cell_log,
                z_score,
                pit,
                crps_value,
                reference_crps_value,
                nlpd,
                *(value for radius in radii.values() for value in (radius, 2.0 * radius)),
            )
            if not all(math.isfinite(value) for value in candidate_values):
                losses.append(1.0)
                if horizon == 1:
                    binary_losses.append(1.0)
                continue
            losses.append(loss)
            hit_masses.append(hit_mass)
            cell_logs.append(cell_log)
            top_hits += int(int(np.argmax(masses)) == category)
            outside += int(category in {0, GRID_ROWS + 1})
            pits.append(pit)
            crps_values.append(crps_value)
            reference_crps.append(reference_crps_value)
            nlpds.append(nlpd)
            for level, radius in radii.items():
                item = intervals[str(int(level * 100))]
                item["hits"] += int(abs(observed - mean) <= radius)
                item["widths"].append(2 * radius)
                item["price_spans"].append(central_price_span_pct(radius))
            if probability is not None:
                binary_losses.append(
                    (probability - float(observed > 0)) ** 2
                )
                binary_valid += 1
                if probability != 0.5 and observed != 0:
                    direction_count += 1
                    binary_hits += int(
                        (probability > 0.5) == (observed > 0)
                    )
        eligible, valid = len(losses), len(crps_values)
        crps, ref_crps = _mean(crps_values), _mean(reference_crps)
        for item in intervals.values():
            item["coverage_pct"] = 100 * item["hits"] / valid if valid else None
            item["mean_log_return_width"] = _mean(item.pop("widths"))
            price_spans = item.pop("price_spans")
            finite_price_spans = [
                span for span in price_spans if span is not None
            ]
            item["mean_price_span_pct"] = (
                _mean(finite_price_spans)
                if len(finite_price_spans) == len(price_spans)
                else None
            )
        horizons[str(horizon)] = {
            "eligible_pairs": eligible, "valid_pairs": valid,
            "coverage_pct": 100 * valid / eligible if eligible else None,
            "brier_loss": _mean(losses), "reference_brier_loss": _mean(references),
            "mean_realized_cell_probability": _mean(hit_masses),
            "negative_log_score": _mean(cell_logs),
            "top_cell_hit_rate_pct": 100 * top_hits / valid if valid else None,
            "outside_grid_pct": 100 * outside / valid if valid else None,
            "crps": crps, "reference_crps": ref_crps,
            "crps_skill_score": 1 - crps / ref_crps if ref_crps and crps is not None else None,
            "negative_log_predictive_density": _mean(nlpds),
            "pit_histogram": np.histogram(pits, bins=np.linspace(0, 1, 11))[0].tolist(),
            "central_intervals": intervals,
        }
    eligible = sum(item["eligible_pairs"] for item in horizons.values())
    valid = sum(item["valid_pairs"] for item in horizons.values())
    available = [item for item in horizons.values() if item["eligible_pairs"]]
    loss = _mean([item["brier_loss"] for item in available])
    reference = _mean([item["reference_brier_loss"] for item in available])
    probability_score = 100 * (1 - loss) if loss is not None else None
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
    binary = _mean(binary_losses)
    return {
        "schema": NEURAL_SCORING_VERSION, "target": "log(close[t+h]/close[t])",
        "origin_start": start, "origin_end": end,
        "grid_rows": GRID_ROWS, "tail_categories": 2, "horizon_count": len(available),
        "eligible_pairs": eligible, "valid_pairs": valid,
        "coverage_pct": 100 * valid / eligible if eligible else None,
        "brier_loss": loss, "reference_brier_loss": reference,
        "brier_skill_score": 1 - loss / reference if reference and loss is not None else None,
        "probability_score_pct": probability_score,
        "crps": crps,
        "reference_crps": reference_crps,
        "crps_skill_score": crps_skill_score,
        "crps_skill_aggregation": "equal-mean-of-all-20-horizon-skills",
        "crps_skill_valid_horizon_count": crps_skill_valid_horizon_count,
        "crps_skill_required_horizon_count": len(GRID_HORIZONS),
        "crps_skill_requires_complete_pair_coverage": True,
        "crps_skill_has_complete_pair_coverage": complete_pair_coverage,
        "central_intervals": aggregate_central_intervals(horizons),
        "continuous_diagnostics_denominator": "valid forecasts only; inspect coverage",
        "next_day": {
            "probability_score_pct": 100 * (1 - binary) if binary is not None else None,
            "brier": binary,
            "brier_skill_vs_neutral": 1 - binary / 0.25 if binary is not None else None,
            "neutral_probability_score_pct": 75.0,
            "count": len(binary_losses), "valid_count": binary_valid,
            "direction_hit_rate_pct": 100 * binary_hits / direction_count if direction_count else None,
            "direction_count": direction_count, "direction_hits": binary_hits,
        },
        "horizons": horizons,
    }


def neural_probability_diagnostics(frame: pd.DataFrame, start: int, end: int) -> dict[str, Any]:
    """Return complete grid and continuous diagnostics under the same boundary."""
    return score_neural_price_field(frame, start, end)
