"""
Shared probability-grid contract for Price Field strategies.

Bayesian Price Field and LSTM Price Field both emit this geometry and
renderer payload. Shared browser geometry, distribution adapters, and the chart
controller own layout, probability math, interaction, and lifecycle.

Code version: v1.1.0
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence
import re


PROBABILITY_GRID_RENDERER = "probability-grid-v1"
PROBABILITY_GRID_SCHEMA = "probability-grid/v1"
BAYESIAN_PRICE_FIELD_SCHEMA = "bayesian-price-field/v1"
LSTM_PRICE_FIELD_SCHEMA = "lstm-price-field/v1"
PRICE_FIELD_SCHEMAS = frozenset(
    {
        BAYESIAN_PRICE_FIELD_SCHEMA,
        LSTM_PRICE_FIELD_SCHEMA,
    }
)
BAYESIAN_PRICE_FIELD_STRATEGY_ID = "bayesian-price-field"
LSTM_PRICE_FIELD_STRATEGY_ID = "lstm-price-field"
PRICE_FIELD_STRATEGY_IDS = frozenset(
    {
        BAYESIAN_PRICE_FIELD_STRATEGY_ID,
        LSTM_PRICE_FIELD_STRATEGY_ID,
    }
)

PROBABILITY_FIELD_ROWS_ABOVE = 10
PROBABILITY_FIELD_ROWS_BELOW = 10
PROBABILITY_FIELD_COLUMNS = 20
PROBABILITY_FIELD_WIDTH_FRACTION = 0.25
PROBABILITY_FIELD_GAP_PX = 2
PROBABILITY_FIELD_PADDING_PX = 8
PROBABILITY_FIELD_MIN_CELL_PX = 4
CELL_OPACITY_MAPPING = "instant-contrast-power-v1"
CELL_OPACITY_EXPONENT = 1.6
CELL_OPACITY_TAIL_RATIO = 0.02
TARGET_INTERVAL = "next-open-to-following-open"
PRICE_ANCHOR_KIND = "signal-close-display-anchor"
MULTI_STEP_KIND = "causal-ar1-return-state"
TIME_QUANTIZATION = "integer-trading-days"
STEP_UNIT = "trading-day"


def is_price_field_strategy(strategy_id: object) -> bool:
    """Return True when the Backtest strategy owns the shared Price Field UI."""
    from .loader import get_strategy_definition
    try:
        return get_strategy_definition(str(strategy_id or "")).get("presentation_renderer") == PROBABILITY_GRID_RENDERER
    except ValueError:
        return False


def probability_grid_geometry_fields() -> dict[str, Any]:
    """Return the product-owned lattice fields shared by every Price Field model."""
    return {
        "renderer": PROBABILITY_GRID_RENDERER,
        "renderer_schema": PROBABILITY_GRID_SCHEMA,
        "rows_above": PROBABILITY_FIELD_ROWS_ABOVE,
        "rows_below": PROBABILITY_FIELD_ROWS_BELOW,
        "columns": PROBABILITY_FIELD_COLUMNS,
        "width_fraction": PROBABILITY_FIELD_WIDTH_FRACTION,
        "gap_px": PROBABILITY_FIELD_GAP_PX,
        "padding_px": PROBABILITY_FIELD_PADDING_PX,
        "min_cell_px": PROBABILITY_FIELD_MIN_CELL_PX,
        "cell_opacity_mapping": CELL_OPACITY_MAPPING,
        "cell_opacity_exponent": CELL_OPACITY_EXPONENT,
        "cell_opacity_tail_ratio": CELL_OPACITY_TAIL_RATIO,
        "time_quantization": TIME_QUANTIZATION,
        "target_interval": TARGET_INTERVAL,
        "price_anchor_kind": PRICE_ANCHOR_KIND,
        "multi_step_kind": MULTI_STEP_KIND,
        "step_unit": STEP_UNIT,
        "metric_geometry": {
            "diagnostic_outcome": {
                "horizon": 1,
                "horizon_unit": "executed-open-to-open-session",
                "proper_probability_rule": "one-minus-brier-score",
            },
            "render_lattice": {
                "columns": PROBABILITY_FIELD_COLUMNS,
                "rows_above": PROBABILITY_FIELD_ROWS_ABOVE,
                "rows_below": PROBABILITY_FIELD_ROWS_BELOW,
                "horizon_unit": "integer-trading-days-per-viewport-column",
                "horizon_mapping": "viewport-quantized",
            },
        },
    }


def build_probability_grid_presentation(
        *,
        schema: str,
        model_version: str,
        cell_display_threshold_pct: float,
        distribution_kind: str,
        predictive_mean: Sequence[float | None],
        predictive_scale: Sequence[float | None],
        probability_up: Sequence[float | None],
        return_autoregression: Sequence[float | None],
        return_long_run_mean: Sequence[float | None],
        return_innovation_scale: Sequence[float | None],
        data_keys: Sequence[str],
        diagnostics: Mapping[str, Any],
        factors: Sequence[Mapping[str, Any]],
        factor_selection: Mapping[str, Any],
        device: Mapping[str, Any],
        source: Mapping[str, Any],
        fingerprint: str,
        extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble one JSON-safe probability-grid payload for the shared renderer."""
    if not re.fullmatch(r"[a-z][a-z0-9-]*/v[1-9][0-9]*", schema):
        raise ValueError(f"Unsupported probability-grid schema: {schema}.")
    presentation: dict[str, Any] = {
        "schema": schema,
        "model_version": model_version,
        **probability_grid_geometry_fields(),
        "cell_display_threshold_pct": float(cell_display_threshold_pct),
        "distribution_kind": distribution_kind,
        "predictive_mean": list(predictive_mean),
        "predictive_scale": list(predictive_scale),
        "probability_up": list(probability_up),
        "return_autoregression": list(return_autoregression),
        "return_long_run_mean": list(return_long_run_mean),
        "return_innovation_scale": list(return_innovation_scale),
        "diagnostics": dict(diagnostics),
        "hit_rate": dict(diagnostics),
        "data_keys": list(data_keys),
        "factors": [dict(factor) for factor in factors],
        "factor_selection": dict(factor_selection),
        "device": dict(device),
        "source": dict(source),
        "fingerprint": str(fingerprint),
    }
    if extra:
        for key, value in extra.items():
            if key in presentation:
                raise ValueError(f"Refusing to overwrite probability-grid field {key}.")
            presentation[key] = value
    return presentation
