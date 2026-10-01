"""Shared plumbing for direct-horizon Price Field strategies. Code version: v1.0.0.

A direct-horizon strategy forecasts Gaussian marginals of
``log(Close[t+h] / Close[t])`` for h = 1..20 at every origin. This module owns
the prediction columns, the next-session probability signals, the visible-window
scoring, the geometry metadata and the probability-grid presentation so the
neural and econometric adapters emit one browser contract.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from strategies.price_field.contract import (
    build_probability_grid_presentation,
    probability_grid_render_shape_fields,
)
from strategies.price_field.neural.scoring import score_neural_price_field
from strategies.price_field.pipeline import (
    json_number_list,
    normal_probability_above_zero,
    probability_threshold_signals,
)
from strategies.price_field.scoring import visible_scoring_bounds

MAX_HORIZON = 20
DIRECT_HORIZONS = tuple(range(1, MAX_HORIZON + 1))
MEAN_COLUMNS = tuple(f"pf_mean_h{horizon:02d}" for horizon in DIRECT_HORIZONS)
STD_COLUMNS = tuple(f"pf_std_h{horizon:02d}" for horizon in DIRECT_HORIZONS)
DIRECT_DISTRIBUTION_KIND = "direct-normal-horizon"
LEARNED_HORIZON_MAPPING = "direct-learned-1-through-20"


def direct_prediction_columns(dates: pd.Series, means: np.ndarray, stds: np.ndarray) -> dict[str, Any]:
    """Return ``Date`` plus interleaved ``pf_mean_hNN`` / ``pf_std_hNN`` columns."""
    predictions: dict[str, Any] = {"Date": dates}
    for horizon in range(MAX_HORIZON):
        predictions[MEAN_COLUMNS[horizon]] = means[:, horizon]
        predictions[STD_COLUMNS[horizon]] = stds[:, horizon]
    return predictions


def attach_direct_signals(
        visible: pd.DataFrame, prediction_frame: pd.DataFrame, entry_probability_pct: float,
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, np.ndarray]:
    """Join forecasts onto the visible rows and emit next-session P(up) threshold intents.

    Returns ``(output, means, stds, probabilities)`` where the arrays follow the
    visible rows and the probability comes from the horizon-1 forecast.
    """
    output = visible.merge(
        prediction_frame,
        on="Date",
        how="left",
        validate="one_to_one",
    )
    means = output[list(MEAN_COLUMNS)].to_numpy(dtype=float)
    stds = output[list(STD_COLUMNS)].to_numpy(dtype=float)
    probabilities = np.asarray([normal_probability_above_zero(mean, std) if np.isfinite(mean) and np.isfinite(std)
                                and std > 0 else np.nan for mean, std in zip(means[:, 0], stds[:, 0])])
    output["pf_probability_up"] = probabilities
    buy, sell = probability_threshold_signals(pd.Series(probabilities), entry_probability_pct / 100)
    output["buy_signal"] = np.asarray(buy, dtype=bool)
    output["sell_signal"] = np.asarray(sell, dtype=bool)
    return output, means, stds, probabilities


def score_direct_forecasts(scoring_frame: pd.DataFrame, visible_dates: pd.Series) -> dict[str, Any]:
    """Score the visible origins of a warmup-inclusive frame with ``pf_*`` columns."""
    score_start, score_end = visible_scoring_bounds(
        scoring_frame["Date"],
        visible_dates,
    )
    diagnostics = score_neural_price_field(
        scoring_frame,
        score_start,
        score_end,
    )
    next_day = diagnostics.get("next_day") or {}
    diagnostics.update(
        direction_hit_rate_pct=next_day.get("direction_hit_rate_pct"),
        scored_points=diagnostics.get("valid_pairs", 0),
        metric_kind="direct-close-standardized-1-20d-brier",
        distribution_metric_kind=(
            "close-anchored-standardized-1-20d-crps-skill"
        ),
        target_interval="signal-close-to-future-close",
        proper_probability_rule="one-minus-half-multiclass-brier", causal=True,
        warmup_excluded_points=score_start,
        warmup_history_points=score_start,
        distribution_warmup_history_points=score_start,
        distribution_visible_origin_points=score_end - score_start,
        evaluation_scope="visible-backtest-range-with-causal-prior-history",
    )
    return diagnostics


def direct_geometry_metadata(horizon_mapping: str = LEARNED_HORIZON_MAPPING) -> dict[str, Any]:
    """Forecast semantics of a close-anchored direct 1..20-session distribution."""
    return {"target_interval": "signal-close-to-future-close", "price_anchor_kind": "signal-close",
            "multi_step_kind": "direct-horizon", "metric_geometry": {
                "diagnostic_outcome": {
                    "horizons": list(DIRECT_HORIZONS), "horizon_unit": "close-to-future-close-session",
                    "proper_probability_rule": "one-minus-half-multiclass-brier",
                    "bands": 20, "tail_bins": 2, "horizon_weighting": "equal",
                },
                "distribution_diagnostic": {
                    "target": "log(close[t+h]/close[t])",
                    "horizons": list(DIRECT_HORIZONS),
                    "horizon_unit": "close-to-future-close-session",
                    "proper_probability_rule": "crps-skill-vs-causal-baseline",
                    "reference": "zero-drift-causal-volatility",
                    "horizon_weighting": "equal",
                    "skill_aggregation": "equal-mean-of-all-20-horizon-skills",
                    "skill_requires_complete_horizon_set": True,
                    "skill_requires_complete_pair_coverage": True,
                    "interval_aggregation": "valid-pair-weighted",
                    "continuous_denominator": "valid-forecast-pairs",
                    "coverage_companion": "eligible-pair-coverage",
                    "pair_independence": "overlapping-origins-and-horizons",
                },
                "render_lattice": {
                    **probability_grid_render_shape_fields(),
                    "horizon_unit": "close-to-future-close-session",
                    "horizon_mapping": horizon_mapping,
                    "spatial_mapping": "viewport-quantized-display-only", "max_horizon": MAX_HORIZON,
                    "detail_horizons": list(DIRECT_HORIZONS), "beyond_max_horizon": "unavailable",
                },
            }}


def direct_horizon_series(means: np.ndarray, stds: np.ndarray) -> dict[str, Any]:
    """Browser fields carrying every per-origin horizon distribution."""
    return {"max_horizon": MAX_HORIZON, "horizon_predictive_mean": [json_number_list(row) for row in means],
            "horizon_predictive_std": [json_number_list(row) for row in stds]}


def build_direct_presentation(
        *,
        schema: str,
        model_version: str,
        cell_display_threshold_pct: float,
        dates: pd.Series,
        means: np.ndarray,
        stds: np.ndarray,
        probabilities: np.ndarray,
        diagnostics: Mapping[str, Any],
        factors: Sequence[Mapping[str, Any]],
        factor_selection: Mapping[str, Any],
        device: Mapping[str, Any],
        source: Mapping[str, Any],
        fingerprint: str,
        extra: Mapping[str, Any],
        horizon_mapping: str = LEARNED_HORIZON_MAPPING,
) -> dict[str, Any]:
    """Assemble the probability-grid payload of a direct 1..20-session Gaussian strategy.

    The horizon-1 marginal is the predictive series; the dynamic return state is neutral
    (zero autoregression and long-run mean, horizon-1 innovation scale).
    """
    return build_probability_grid_presentation(
        schema=schema, model_version=model_version,
        cell_display_threshold_pct=cell_display_threshold_pct, distribution_kind=DIRECT_DISTRIBUTION_KIND,
        predictive_mean=json_number_list(means[:, 0]), predictive_scale=json_number_list(stds[:, 0]),
        probability_up=json_number_list(probabilities), return_autoregression=[0.0] * len(dates),
        return_long_run_mean=[0.0] * len(dates), return_innovation_scale=json_number_list(stds[:, 0]),
        data_keys=[pd.Timestamp(value).isoformat() for value in dates], diagnostics=diagnostics,
        factors=factors, factor_selection=factor_selection, device=device, source=source,
        fingerprint=fingerprint, geometry_metadata=direct_geometry_metadata(horizon_mapping), extra=extra,
    )
