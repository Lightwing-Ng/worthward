"""Complete probability-grid scoring regressions. Code version: v1.0.0."""

from concurrent.futures import Future
import math
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

from scripts import lstm_ga_tune as ga
from strategies.price_field_scoring import causal_grid_edges, grid_masses, score_price_field_grid
from tests.factories.market import ohlc_frame_for_dates


@pytest.fixture
def forecast_frame():
    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-01", periods=110).strftime("%Y-%m-%d").tolist())
    frame["Close"] = 100 * np.exp(np.arange(110) * 0.01)
    frame["lstm_predictive_mean"] = 0.01
    frame["lstm_predictive_std"] = 0.001
    frame["lstm_return_autoregression"] = 0.0
    frame["lstm_return_long_run_mean"] = 0.01
    frame["lstm_return_innovation_std"] = 0.001
    return frame


def test_all_horizons_cells_and_tails_have_probability_mass():
    edges = np.linspace(-0.2, 0.2, 21)
    masses = grid_masses(edges, 0, 0.1)
    assert len(masses) == 22
    assert np.sum(masses) == pytest.approx(1)
    assert masses[0] > 0 and masses[-1] > 0
    assert np.all(masses >= 0)


def test_grid_edges_are_causal_and_candidate_independent(forecast_frame):
    closes = forecast_frame.Close.to_numpy().copy()
    before = causal_grid_edges(closes, 30)
    closes[31:] *= 10
    np.testing.assert_array_equal(before, causal_grid_edges(closes, 30))


def test_matching_curve_beats_wrong_drift_and_missing_predictions(forecast_frame):
    good = score_price_field_grid(forecast_frame, 25, 55)
    forecast_frame["lstm_predictive_mean"] = -0.01
    forecast_frame["lstm_return_long_run_mean"] = -0.01
    bad = score_price_field_grid(forecast_frame, 25, 55)
    forecast_frame["lstm_predictive_mean"] = np.nan
    missing = score_price_field_grid(forecast_frame, 25, 55)
    assert good["horizon_count"] == 20
    assert good["eligible_pairs"] == sum(30 - h for h in range(1, 21))
    assert good["probability_score_pct"] > bad["probability_score_pct"]
    assert missing["probability_score_pct"] == 0
    assert missing["coverage_pct"] == 0
    assert missing["eligible_pairs"] == good["eligible_pairs"]


def test_fold_does_not_read_outcomes_past_its_boundary(forecast_frame):
    before = score_price_field_grid(forecast_frame, 25, 55)
    forecast_frame.loc[55:, "Close"] *= 10
    assert score_price_field_grid(forecast_frame, 25, 55) == before
    assert before["horizons"]["20"]["eligible_pairs"] == 10


def test_outside_tail_is_scored_instead_of_dropped(forecast_frame):
    forecast_frame.loc[45:, "Close"] *= 3
    scored = score_price_field_grid(forecast_frame, 25, 46)
    assert scored["horizons"]["20"]["outside_grid_pct"] == 100
    assert scored["horizons"]["20"]["eligible_pairs"] == 1


def test_grid_ranking_ignores_holdout_and_requires_every_seed(forecast_frame):
    score = score_price_field_grid(forecast_frame, 25, 55)
    result = {"objective": "grid", "grid": {"validation_folds": {str(i): score for i in range(3)}}}
    fitness = ga._fitness_fields(result)
    assert fitness["feasible"]
    result["holdout"] = {"direction_hit_rate_pct": 100}
    assert ga._fitness_fields(result) == fitness
    groups = [
        {**result, **fitness, "status": "ok", "model_key": "a", "params": {"lstm_seed": seed}}
        for seed in ga.ROBUST_SEEDS
    ]
    assert ga._aggregate_robust(groups)[0]["feasible"]
    assert not ga._aggregate_robust(groups[:-1])[0]["feasible"]
    assert ga._ranking_key({**result, **fitness}) == (1.0, fitness["fitness"])


def test_deadline_returns_even_when_worker_never_finishes():
    future = Future()
    future.set_running_or_notify_cancel()
    executor = Mock()
    executor.submit.return_value = future
    assert ga._evaluate_batch(executor, [{"params": {}}], -math.inf) == []


def test_grid_search_removes_holdout_from_model_input(forecast_frame):
    bundle = {"ohlcv": [{"observed_at": str(day), "close": 100} for day in forecast_frame.Date]}
    context = ga.EvaluationContext(forecast_frame, bundle, (), {}, (), 88, "test", objective="grid")
    visible, trimmed = ga._evaluation_inputs({"origin": "random"}, context)
    assert len(visible) == 88
    assert len(trimmed["ohlcv"]) == 88
    assert len(bundle["ohlcv"]) == 110
    full, original = ga._evaluation_inputs({"origin": "holdout-report"}, context)
    assert len(full) == 110 and original is bundle


def test_legacy_direction_robust_ranking_no_longer_selects_on_holdout():
    results = [
        {"model_key": key, "objective": "direction", "status": "ok", "feasible": True,
         "fitness": fitness, "params": {"lstm_seed": seed},
         "holdout": {"direction_hit_rate_pct": holdout}}
        for key, fitness, holdout in [("validation-winner", 65, 0), ("holdout-winner", 55, 100)]
        for seed in ga.ROBUST_SEEDS
    ]
    assert ga._aggregate_robust(results)[0]["model_key"] == "validation-winner"
