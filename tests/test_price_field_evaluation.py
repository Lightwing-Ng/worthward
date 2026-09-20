"""Shared model-neutral Price Field evaluation orchestration.

The reference implementation in this module is the exact sequence that was
previously inlined in both Price Field strategies. It exists so the extraction
stays behavior preserving and so the boundary between model-neutral
orchestration and model-specific inference remains executable.

Code version: v1.0.0
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from strategies.algorithms import strategy_bayesian_price_field as bayesian_module
from strategies.algorithms import strategy_lstm_price_field as lstm_module
from strategies.price_field_pipeline import (
    price_field_probabilistic_diagnostics,
    probability_threshold_signals,
)
from strategies.price_field_scoring import (
    PriceFieldEvaluation,
    PriceFieldPredictionColumns,
    evaluate_gaussian_price_field,
    score_price_field_grid,
    visible_scoring_bounds,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COLUMNS = PriceFieldPredictionColumns(
    predictive_mean="sample_predictive_mean",
    predictive_scale="sample_predictive_std",
    probability_up="sample_probability_up",
    return_autoregression="sample_return_autoregression",
    return_long_run_mean="sample_return_long_run_mean",
    return_innovation_scale="sample_return_innovation_std",
)


def _frame(row_count: int) -> pd.DataFrame:
    generator = np.random.default_rng(4242)
    close = 100.0 * np.exp(np.cumsum(generator.normal(0.0004, 0.01, row_count)))
    return pd.DataFrame(
        {
            "Date": pd.date_range("2025-01-02", periods=row_count, freq="D"),
            "Open": close * 0.999,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": np.full(row_count, 1_000_000.0),
        }
    )


def _predictions(row_count: int) -> dict[str, np.ndarray]:
    generator = np.random.default_rng(99)
    mean = generator.normal(0.0005, 0.002, row_count)
    scale = np.abs(generator.normal(0.01, 0.002, row_count)) + 1e-4
    # A leading warm-up origin without a usable posterior stays missing.
    mean[0] = np.nan
    scale[0] = np.nan
    probability = np.where(
        np.isfinite(mean) & np.isfinite(scale),
        0.5 + (mean / (scale + 1e-9)) * 0.05,
        np.nan,
    )
    return {
        "predictive_mean": mean,
        "predictive_scale": scale,
        "probability_up": probability,
        "return_autoregression": generator.normal(0.0, 0.1, row_count),
        "return_long_run_mean": generator.normal(0.0, 0.001, row_count),
        "return_innovation_scale": np.abs(generator.normal(0.01, 0.001, row_count)),
    }


def _reference_evaluation(
        full_frame: pd.DataFrame,
        visible_frame: pd.DataFrame,
        predictions: dict[str, np.ndarray],
        entry_probability_pct: float,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Reproduce the previously duplicated inline orchestration exactly."""
    mean_column = COLUMNS.predictive_mean
    scale_column = COLUMNS.predictive_scale
    probability_column = COLUMNS.probability_up
    autoregression_column = COLUMNS.return_autoregression
    long_run_mean_column = COLUMNS.return_long_run_mean
    innovation_column = COLUMNS.return_innovation_scale

    prediction_frame = pd.DataFrame(
        {
            "Date": full_frame["Date"],
            mean_column: predictions["predictive_mean"],
            scale_column: predictions["predictive_scale"],
            probability_column: predictions["probability_up"],
            autoregression_column: predictions["return_autoregression"],
            long_run_mean_column: predictions["return_long_run_mean"],
            innovation_column: predictions["return_innovation_scale"],
        }
    )
    output = visible_frame.merge(
        prediction_frame,
        on="Date",
        how="left",
        validate="one_to_one",
    )
    diagnostics = price_field_probabilistic_diagnostics(
        output["Open"].to_numpy(dtype=np.float64),
        output[mean_column].to_numpy(dtype=np.float64),
        output[scale_column].to_numpy(dtype=np.float64),
        output[probability_column].to_numpy(dtype=np.float64),
    )
    grid_scoring_frame = full_frame.assign(
        **{
            mean_column: predictions["predictive_mean"],
            scale_column: predictions["predictive_scale"],
            autoregression_column: predictions["return_autoregression"],
            long_run_mean_column: predictions["return_long_run_mean"],
            innovation_column: predictions["return_innovation_scale"],
        }
    )
    grid_score_start, grid_score_end = visible_scoring_bounds(
        grid_scoring_frame["Date"],
        visible_frame["Date"],
    )
    diagnostics["grid"] = score_price_field_grid(
        grid_scoring_frame,
        grid_score_start,
        grid_score_end,
        predictive_mean_column=mean_column,
        predictive_scale_column=scale_column,
        return_autoregression_column=autoregression_column,
        return_long_run_mean_column=long_run_mean_column,
        return_innovation_scale_column=innovation_column,
    )
    diagnostics["distribution_metric_kind"] = (
        "close-anchored-standardized-1-20d-crps-skill"
    )
    diagnostics["distribution_evaluation_scope"] = (
        "visible-backtest-range-with-causal-prior-history"
    )
    diagnostics["distribution_warmup_history_points"] = grid_score_start
    diagnostics["distribution_visible_origin_points"] = (
        grid_score_end - grid_score_start
    )
    entry_probability = float(entry_probability_pct) / 100.0
    buy_signals, sell_signals = probability_threshold_signals(
        pd.to_numeric(output[probability_column], errors="coerce"),
        entry_probability,
    )
    output["buy_signal"] = pd.Series(buy_signals, index=output.index, dtype="bool")
    output["sell_signal"] = pd.Series(sell_signals, index=output.index, dtype="bool")
    return output, diagnostics


@pytest.mark.parametrize("warmup_rows", (0, 40))
@pytest.mark.parametrize("entry_probability_pct", (50.0, 55.0, 72.0))
def test_shared_orchestration_matches_the_previous_inline_sequence(
        warmup_rows: int,
        entry_probability_pct: float,
) -> None:
    full_frame = _frame(150)
    visible_frame = full_frame.iloc[warmup_rows:].reset_index(drop=True)
    predictions = _predictions(len(full_frame))

    expected_output, expected_diagnostics = _reference_evaluation(
        full_frame,
        visible_frame,
        predictions,
        entry_probability_pct,
    )
    evaluation = evaluate_gaussian_price_field(
        full_frame=full_frame,
        visible_frame=visible_frame,
        columns=COLUMNS,
        entry_probability_pct=entry_probability_pct,
        **predictions,
    )

    assert isinstance(evaluation, PriceFieldEvaluation)
    pd.testing.assert_frame_equal(evaluation.output, expected_output)
    assert evaluation.diagnostics == expected_diagnostics
    assert evaluation.grid_score_start == warmup_rows
    assert evaluation.grid_score_end == len(full_frame)


def test_hidden_warmup_stays_outside_the_visible_evaluation_denominator() -> None:
    full_frame = _frame(150)
    visible_frame = full_frame.iloc[40:].reset_index(drop=True)
    predictions = _predictions(len(full_frame))

    evaluation = evaluate_gaussian_price_field(
        full_frame=full_frame,
        visible_frame=visible_frame,
        columns=COLUMNS,
        entry_probability_pct=55.0,
        **predictions,
    )

    assert len(evaluation.output) == len(visible_frame)
    assert evaluation.diagnostics["distribution_warmup_history_points"] == 40
    assert evaluation.diagnostics["distribution_visible_origin_points"] == 110
    assert evaluation.grid_score_end - evaluation.grid_score_start == 110


def test_missing_predictions_stay_missing_and_emit_no_signal() -> None:
    full_frame = _frame(150)
    predictions = _predictions(len(full_frame))

    evaluation = evaluate_gaussian_price_field(
        full_frame=full_frame,
        visible_frame=full_frame,
        columns=COLUMNS,
        entry_probability_pct=50.0,
        **predictions,
    )
    first_row = evaluation.output.iloc[0]

    assert pd.isna(first_row[COLUMNS.predictive_mean])
    assert pd.isna(first_row[COLUMNS.probability_up])
    assert not bool(first_row["buy_signal"])
    assert not bool(first_row["sell_signal"])


def test_declared_distribution_metadata_is_caller_owned() -> None:
    full_frame = _frame(120)
    predictions = _predictions(len(full_frame))

    evaluation = evaluate_gaussian_price_field(
        full_frame=full_frame,
        visible_frame=full_frame,
        columns=COLUMNS,
        entry_probability_pct=50.0,
        distribution_metric_kind="declared-metric",
        distribution_evaluation_scope="declared-scope",
        **predictions,
    )

    assert evaluation.diagnostics["distribution_metric_kind"] == "declared-metric"
    assert evaluation.diagnostics["distribution_evaluation_scope"] == "declared-scope"


@pytest.mark.parametrize("module", (bayesian_module, lstm_module))
def test_both_price_field_strategies_call_the_one_shared_orchestrator(module) -> None:
    source = Path(module.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert "evaluate_gaussian_price_field" in called
    assert "score_price_field_grid" not in called
    assert "visible_scoring_bounds" not in called
    assert module._PREDICTION_COLUMNS.as_tuple() == (
        module._PREDICTION_MEAN_COLUMN,
        module._PREDICTION_STD_COLUMN,
        module._PROBABILITY_COLUMN,
        module._AUTOREGRESSION_COLUMN,
        module._LONG_RUN_MEAN_COLUMN,
        module._INNOVATION_STD_COLUMN,
    )


def test_model_specific_inference_stays_outside_the_shared_layer() -> None:
    shared_source = (PROJECT_ROOT / "strategies/price_field_scoring.py").read_text(
        encoding="utf-8"
    )
    tree = ast.parse(shared_source)
    imported_roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_roots.add(node.module.split(".")[0])

    # Bayesian inference and LSTM training stay model specific. The shared
    # layer never reaches into a model backend or a strategy adapter.
    assert "torch" not in imported_roots
    assert not any(root.startswith("strategies.algorithms") for root in imported_roots)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            assert not node.module.startswith("strategies.algorithms")
            assert "neural_price_field" not in node.module
