"""Score the complete close-anchored Price Field. Code version: v1.0.0.

Research bins are fixed from causal price history, independently of candidate
parameters and browser geometry. Every horizon includes both outside tails.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from strategies.price_field_pipeline import multi_step_price_field_normal_parameters

GRID_SCORING_VERSION = "close-price-grid/v1.0.0"
GRID_HORIZONS = tuple(range(1, 21))
GRID_ROWS = 20


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
    cdf = np.array([
        0.5 * math.erfc(-(float(edge) - mean) / (scale * math.sqrt(2.0)))
        for edge in edges
    ])
    return np.diff(np.concatenate(([0.0], cdf, [1.0])))


def score_price_field_grid(frame: pd.DataFrame, start: int, end: int) -> dict[str, Any]:
    """Score Close[t+h]/Close[t], with both origin and outcome inside the fold.

    The UI applies executable-return forecasts to a close anchor. This metric
    tests that displayed projection directly; it is not a new trading target.
    Half the multiclass Brier sum ranges from zero to one. Missing forecasts
    receive its maximum loss on a candidate-independent eligible denominator.
    """
    closes = frame["Close"].to_numpy(dtype=float)
    columns = [
        "lstm_predictive_mean", "lstm_predictive_std",
        "lstm_return_autoregression", "lstm_return_long_run_mean",
        "lstm_return_innovation_std",
    ]
    predictions = frame[columns].to_numpy(dtype=float)
    edges_by_origin = {
        origin: causal_grid_edges(closes, origin)
        for origin in range(max(0, start), min(end, len(frame)))
    }
    horizons: dict[str, Any] = {}
    for horizon in GRID_HORIZONS:
        losses, reference_losses, hit_masses, log_losses = [], [], [], []
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
            mean, scale = multi_step_price_field_normal_parameters(
                mean, scale, horizon, phi, equilibrium, innovation,
            )
            masses = grid_masses(edges, mean, scale)
            losses.append(float((masses @ masses + 1 - 2 * masses[category]) / 2))
            hit_masses.append(float(masses[category]))
            log_losses.append(-math.log(max(1e-15, float(masses[category]))))
            valid += 1
            top_hits += int(int(np.argmax(masses)) == category)
            outside += int(category in {0, GRID_ROWS + 1})
        eligible = len(losses)
        horizons[str(horizon)] = {
            "eligible_pairs": eligible,
            "valid_pairs": valid,
            "coverage_pct": 100 * valid / eligible if eligible else 0.0,
            "brier_loss": float(np.mean(losses)) if eligible else None,
            "reference_brier_loss": float(np.mean(reference_losses)) if eligible else None,
            "mean_realized_cell_probability": float(np.mean(hit_masses)) if valid else None,
            "negative_log_score": float(np.mean(log_losses)) if valid else None,
            "top_cell_hit_rate_pct": 100 * top_hits / valid if valid else None,
            "outside_grid_pct": 100 * outside / valid if valid else None,
        }
    eligible = sum(item["eligible_pairs"] for item in horizons.values())
    valid = sum(item["valid_pairs"] for item in horizons.values())
    available = [item for item in horizons.values() if item["eligible_pairs"]]
    loss = float(np.mean([item["brier_loss"] for item in available])) if available else None
    reference = float(np.mean([item["reference_brier_loss"] for item in available])) if available else None
    return {
        "schema": GRID_SCORING_VERSION,
        "target": "close[t+h]/close[t]",
        "grid_rows": GRID_ROWS,
        "tail_categories": 2,
        "horizon_count": len(available),
        "eligible_pairs": eligible,
        "valid_pairs": valid,
        "coverage_pct": 100 * valid / eligible if eligible else 0.0,
        "brier_loss": loss,
        "probability_score_pct": 100 * (1 - loss) if loss is not None else None,
        "reference_brier_loss": reference,
        "brier_skill_score": 1 - loss / reference if reference and loss is not None else None,
        "horizons": horizons,
    }
