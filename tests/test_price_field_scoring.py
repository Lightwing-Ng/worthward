"""Complete probability-grid scoring regressions. Code version: v1.3.0."""

from concurrent.futures import Future
import math
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

from scripts import lstm_ga_tune as ga
from strategies.price_field_scoring import (
    causal_grid_edges,
    grid_masses,
    score_price_field_grid,
    visible_scoring_bounds,
)
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


def test_distribution_skill_and_interval_evidence_use_the_complete_grid(
        forecast_frame,
):
    scored = score_price_field_grid(forecast_frame, 25, 80)

    assert scored["crps_skill_score"] > 0
    assert scored["crps_skill_score"] == pytest.approx(np.mean([
        item["crps_skill_score"]
        for item in scored["horizons"].values()
    ]))
    assert (
        scored["crps_skill_aggregation"]
        == "equal-mean-of-all-20-horizon-skills"
    )
    assert scored["crps_skill_valid_horizon_count"] == 20
    assert scored["crps_skill_required_horizon_count"] == 20
    assert scored["crps_skill_requires_complete_pair_coverage"] is True
    assert scored["crps_skill_has_complete_pair_coverage"] is True
    assert scored["crps"] < scored["reference_crps"]
    assert scored["valid_pairs"] == scored["eligible_pairs"]
    interval_80 = scored["central_intervals"]["80"]
    assert interval_80["valid_pairs"] == scored["valid_pairs"]
    assert 0 <= interval_80["coverage_pct"] <= 100
    expected_price_span = sum(
        item["central_intervals"]["80"]["mean_price_span_pct"]
        * item["valid_pairs"]
        for item in scored["horizons"].values()
    ) / scored["valid_pairs"]
    assert interval_80["mean_price_span_pct"] == pytest.approx(
        expected_price_span
    )
    for horizon in ("1", "5", "10", "20"):
        item = scored["horizons"][horizon]
        assert item["crps_skill_score"] is not None
        assert item["central_intervals"]["80"]["hits"] <= item["valid_pairs"]
        assert item["central_intervals"]["80"]["mean_price_span_pct"] > 0


def test_crps_headline_requires_all_horizons_and_every_eligible_pair(
        forecast_frame,
):
    short = score_price_field_grid(forecast_frame, 25, 44)

    assert short["horizon_count"] == 18
    assert short["crps_skill_valid_horizon_count"] == 18
    assert short["crps_skill_required_horizon_count"] == 20
    assert short["crps_skill_has_complete_pair_coverage"] is True
    assert short["crps_skill_score"] is None

    incomplete_frame = forecast_frame.copy()
    incomplete_frame.loc[30, "lstm_predictive_mean"] = np.nan
    incomplete = score_price_field_grid(incomplete_frame, 25, 80)

    assert incomplete["horizon_count"] == 20
    assert incomplete["crps_skill_valid_horizon_count"] == 20
    assert incomplete["valid_pairs"] < incomplete["eligible_pairs"]
    assert incomplete["crps_skill_has_complete_pair_coverage"] is False
    assert incomplete["crps_skill_score"] is None


def test_candidate_equal_to_causal_reference_has_zero_crps_skill(
        forecast_frame,
):
    reference = forecast_frame.copy()
    closes = reference["Close"].to_numpy(dtype=float)
    scales = np.full(len(reference), 0.005, dtype=float)
    for origin in range(15, len(reference)):
        history = closes[max(0, origin - 60):origin + 1]
        scales[origin] = max(
            0.005,
            float(np.std(np.diff(np.log(history)), ddof=1)),
        )
    reference["lstm_predictive_mean"] = 0.0
    reference["lstm_predictive_std"] = scales
    reference["lstm_return_autoregression"] = 0.0
    reference["lstm_return_long_run_mean"] = 0.0
    reference["lstm_return_innovation_std"] = scales

    scored = score_price_field_grid(reference, 25, 80)

    assert scored["crps_skill_score"] == pytest.approx(0.0, abs=1e-12)
    for item in scored["horizons"].values():
        assert item["crps_skill_score"] == pytest.approx(0.0, abs=1e-12)


def test_visible_bounds_keep_causal_warmup_outside_the_scoring_denominator(
        forecast_frame,
):
    visible = forecast_frame.iloc[25:80].copy()
    start, end = visible_scoring_bounds(forecast_frame["Date"], visible["Date"])

    assert (start, end) == (25, 80)
    with_warmup = score_price_field_grid(forecast_frame, start, end)
    without_warmup = score_price_field_grid(visible, 0, len(visible))
    assert with_warmup["origin_start"] == 25
    assert with_warmup["origin_end"] == 80
    assert with_warmup["eligible_pairs"] == sum(
        len(visible) - horizon
        for horizon in range(1, 21)
    )
    assert without_warmup["eligible_pairs"] < with_warmup["eligible_pairs"]


def test_fold_does_not_read_outcomes_past_its_boundary(forecast_frame):
    before = score_price_field_grid(forecast_frame, 25, 55)
    forecast_frame.loc[55:, "Close"] *= 10
    assert score_price_field_grid(forecast_frame, 25, 55) == before
    assert before["horizons"]["20"]["eligible_pairs"] == 10


def test_empty_scoring_denominator_has_no_coverage_percentage(forecast_frame):
    scored = score_price_field_grid(forecast_frame, 40, 40)

    assert scored["eligible_pairs"] == 0
    assert scored["valid_pairs"] == 0
    assert scored["coverage_pct"] is None
    assert scored["crps_skill_score"] is None


def test_extreme_finite_scale_omits_unrenderable_price_span(forecast_frame):
    forecast_frame["lstm_predictive_std"] = 1_000.0
    forecast_frame["lstm_return_innovation_std"] = 1_000.0

    scored = score_price_field_grid(forecast_frame, 25, 80)

    assert math.isfinite(scored["crps"])
    assert scored["central_intervals"]["80"]["mean_price_span_pct"] is None


def test_extreme_finite_ar_forecast_is_counted_as_missing(forecast_frame):
    complete = score_price_field_grid(forecast_frame, 25, 80)
    for column in (
            "lstm_predictive_mean",
            "lstm_predictive_std",
            "lstm_return_autoregression",
            "lstm_return_long_run_mean",
            "lstm_return_innovation_std",
    ):
        forecast_frame[column] = 1e308

    scored = score_price_field_grid(forecast_frame, 25, 80)

    assert scored["eligible_pairs"] == complete["eligible_pairs"]
    assert scored["valid_pairs"] == 0
    assert scored["coverage_pct"] == 0
    assert scored["probability_score_pct"] == 0
    assert scored["crps"] is None
    assert scored["crps_skill_score"] is None
    assert all(
        item["brier_loss"] == 1.0
        for item in scored["horizons"].values()
    )


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


def test_crps_ranking_matches_complete_headline_and_fails_closed(forecast_frame):
    score = score_price_field_grid(forecast_frame, 25, 55)
    result = {
        "objective": "crps",
        "grid": {"validation_folds": {str(index): score for index in range(3)}},
        "holdout": {"direction_hit_rate_pct": 100},
        "backtest": {"net_return_pct": 100},
    }

    fitness = ga._fitness_fields(result)

    assert fitness["feasible"]
    assert fitness["fitness"] == pytest.approx(100 * score["crps_skill_score"])
    assert fitness["validation_mean_crps_skill_pct"] == pytest.approx(
        100 * score["crps_skill_score"],
        abs=0.0001,
    )
    assert ga._ranking_key({**result, **fitness}) == (1.0, fitness["fitness"])
    groups = [
        {
            **result,
            **fitness,
            "status": "ok",
            "model_key": "complete-crps",
            "params": {"lstm_seed": seed},
        }
        for seed in ga.ROBUST_SEEDS
    ]
    aggregate = ga._aggregate_robust(groups)[0]
    assert aggregate["feasible"]
    assert aggregate["validation_mean_crps_skill_pct"] == pytest.approx(
        fitness["fitness"]
    )
    assert aggregate["validation_crps_skill_std_pct"] == pytest.approx(0)

    incomplete = {
        **score,
        "valid_pairs": score["eligible_pairs"] - 1,
        "crps_skill_score": None,
        "crps_skill_has_complete_pair_coverage": False,
    }
    rejected = ga._fitness_fields({
        "objective": "crps",
        "grid": {"validation_folds": {str(index): incomplete for index in range(3)}},
    })
    assert not rejected["feasible"]
    assert rejected["fitness"] is None


def test_deadline_returns_even_when_worker_never_finishes():
    future = Future()
    future.set_running_or_notify_cancel()
    executor = Mock()
    executor.submit.return_value = future
    assert ga._evaluate_batch(executor, [{"params": {}}], -math.inf) == []


@pytest.mark.parametrize("objective", ["grid", "crps"])
def test_grid_search_removes_holdout_from_model_input(forecast_frame, objective):
    bundle = {"ohlcv": [{"observed_at": str(day), "close": 100} for day in forecast_frame.Date]}
    context = ga.EvaluationContext(forecast_frame, bundle, (), {}, (), 88, "test", objective=objective)
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
