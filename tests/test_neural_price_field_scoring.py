"""Direct distribution scoring invariants. Code version: v1.2.0."""

import math

import numpy as np
import pandas as pd
import pytest

from strategies.neural_price_field_scoring import normal_crps, score_neural_price_field
from strategies.price_field_scoring import score_price_field_grid
from tests.factories.market import close_frame_for_dates


def _predictions(count=100):
    dates = pd.bdate_range("2025-01-02", periods=count).strftime("%Y-%m-%d").tolist()
    closes = (100 * np.exp(np.sin(np.arange(count) / 6) * 0.03)).tolist()
    frame = close_frame_for_dates(dates, closes)
    for horizon in range(1, 21):
        frame[f"pf_mean_h{horizon:02d}"] = 0.0
        frame[f"pf_std_h{horizon:02d}"] = 0.01 * math.sqrt(horizon)
    return frame


def test_neutral_binary_probability_is_seventy_five_and_zero_skill():
    result = score_neural_price_field(_predictions(), 25, 80)
    assert result["next_day"]["probability_score_pct"] == 75.0
    assert result["next_day"]["brier_skill_vs_neutral"] == 0.0
    assert result["next_day"]["count"] == 54
    assert result["next_day"]["direction_hit_rate_pct"] is None
    assert result["next_day"]["direction_count"] == 0
    assert result["horizon_count"] == 20


def test_direct_gaussians_match_existing_independent_increment_grid():
    frame = _predictions()
    frame["lstm_predictive_mean"] = 0.0
    frame["lstm_predictive_std"] = 0.01
    frame["lstm_return_autoregression"] = 0.0
    frame["lstm_return_long_run_mean"] = 0.0
    frame["lstm_return_innovation_std"] = 0.01
    direct = score_neural_price_field(frame, 25, 80)
    legacy = score_price_field_grid(frame, 25, 80)
    assert direct["eligible_pairs"] == legacy["eligible_pairs"]
    assert direct["probability_score_pct"] == pytest.approx(legacy["probability_score_pct"])
    assert direct["reference_brier_loss"] == legacy["reference_brier_loss"]
    assert direct["crps"] == pytest.approx(legacy["crps"])
    assert direct["reference_crps"] == pytest.approx(legacy["reference_crps"])
    assert direct["crps_skill_score"] == pytest.approx(
        legacy["crps_skill_score"]
    )
    for level in ("50", "80", "95"):
        direct_interval = direct["central_intervals"][level]
        legacy_interval = legacy["central_intervals"][level]
        assert direct_interval["hits"] == legacy_interval["hits"]
        assert direct_interval["valid_pairs"] == legacy_interval["valid_pairs"]
        assert direct_interval["coverage_pct"] == pytest.approx(
            legacy_interval["coverage_pct"]
        )
        assert direct_interval["mean_log_return_width"] == pytest.approx(
            legacy_interval["mean_log_return_width"]
        )
        assert direct_interval["mean_price_span_pct"] == pytest.approx(
            legacy_interval["mean_price_span_pct"]
        )
    for horizon in direct["horizons"]:
        direct_horizon = direct["horizons"][horizon]
        legacy_horizon = legacy["horizons"][horizon]
        assert direct_horizon["crps"] == pytest.approx(
            legacy_horizon["crps"]
        )
        assert direct_horizon["reference_crps"] == pytest.approx(
            legacy_horizon["reference_crps"]
        )
        for level in ("50", "80", "95"):
            direct_interval = direct_horizon["central_intervals"][level]
            legacy_interval = legacy_horizon["central_intervals"][level]
            assert direct_interval["hits"] == legacy_interval["hits"]
            assert direct_interval["coverage_pct"] == pytest.approx(
                legacy_interval["coverage_pct"]
            )
            assert direct_interval["mean_log_return_width"] == pytest.approx(
                legacy_interval["mean_log_return_width"]
            )
            assert direct_interval["mean_price_span_pct"] == pytest.approx(
                legacy_interval["mean_price_span_pct"]
            )


def test_missing_predictions_keep_denominator_and_receive_maximum_loss():
    frame = _predictions()
    complete = score_neural_price_field(frame, 25, 80)
    frame.loc[:, "pf_std_h20"] = np.nan
    incomplete = score_neural_price_field(frame, 25, 80)
    assert incomplete["eligible_pairs"] == complete["eligible_pairs"]
    assert incomplete["horizons"]["20"]["brier_loss"] == 1.0
    assert incomplete["horizons"]["20"]["valid_pairs"] == 0
    assert incomplete["probability_score_pct"] < complete["probability_score_pct"]
    assert incomplete["crps_skill_valid_horizon_count"] == 19
    assert incomplete["crps_skill_required_horizon_count"] == 20
    assert incomplete["crps_skill_has_complete_pair_coverage"] is False
    assert incomplete["crps_skill_score"] is None


def test_post_fold_prices_and_predictions_cannot_change_score():
    frame = _predictions()
    before = score_neural_price_field(frame, 25, 80)
    frame.loc[80:, "Close"] = 1e8
    frame.loc[80:, "pf_mean_h01"] = -900
    assert score_neural_price_field(frame, 25, 80) == before


def test_gaussian_crps_center_and_continuous_diagnostic_denominators():
    assert normal_crps(0.0, 0.0, 2.0) == pytest.approx(2 * (math.sqrt(2) - 1) / math.sqrt(math.pi))
    result = score_neural_price_field(_predictions(), 25, 80)
    assert result["crps_skill_score"] is not None
    assert result["crps_skill_score"] == pytest.approx(np.mean([
        item["crps_skill_score"]
        for item in result["horizons"].values()
    ]))
    assert result["crps_skill_aggregation"] == (
        "equal-mean-of-all-20-horizon-skills"
    )
    assert result["crps_skill_valid_horizon_count"] == 20
    assert result["crps_skill_required_horizon_count"] == 20
    assert result["crps_skill_has_complete_pair_coverage"] is True
    assert result["central_intervals"]["80"]["valid_pairs"] == result["valid_pairs"]
    for item in result["horizons"].values():
        assert sum(item["pit_histogram"]) == item["valid_pairs"]
        assert item["central_intervals"]["95"]["mean_log_return_width"] > item["central_intervals"]["50"]["mean_log_return_width"]
        assert item["crps"] >= 0


def test_direct_candidate_equal_to_reference_has_zero_crps_skill():
    frame = _predictions()
    closes = frame["Close"].to_numpy(dtype=float)
    base_scales = np.full(len(frame), 0.005, dtype=float)
    for origin in range(15, len(frame)):
        history = closes[max(0, origin - 60):origin + 1]
        base_scales[origin] = max(
            0.005,
            float(np.std(np.diff(np.log(history)), ddof=1)),
        )
    for horizon in range(1, 21):
        frame[f"pf_mean_h{horizon:02d}"] = 0.0
        frame[f"pf_std_h{horizon:02d}"] = base_scales * math.sqrt(horizon)

    result = score_neural_price_field(frame, 25, 80)

    assert result["crps_skill_score"] == pytest.approx(0.0, abs=1e-12)
    for item in result["horizons"].values():
        assert item["crps_skill_score"] == pytest.approx(0.0, abs=1e-12)


def test_short_window_with_missing_standard_horizon_has_no_headline_skill():
    result = score_neural_price_field(_predictions(), 25, 44)

    assert result["horizon_count"] == 18
    assert result["crps_skill_valid_horizon_count"] == 18
    assert result["crps_skill_required_horizon_count"] == 20
    assert result["crps_skill_has_complete_pair_coverage"] is True
    assert result["crps_skill_score"] is None


def test_missing_real_price_never_creates_a_bridged_target():
    frame = _predictions()
    frame.loc[40, "Close"] = np.nan
    result = score_neural_price_field(frame, 35, 45)
    assert result["horizons"]["5"]["eligible_pairs"] == 0
    assert result["horizons"]["1"]["eligible_pairs"] == 4


def test_invalid_scale_and_empty_window_are_explicit():
    with pytest.raises(ValueError, match="positive scale"):
        normal_crps(0, 0, 0)
    frame = _predictions()
    empty = score_neural_price_field(frame, 40, 40)
    assert empty["probability_score_pct"] is None
    assert empty["coverage_pct"] is None
    with pytest.raises(ValueError, match="end >= start"):
        score_neural_price_field(frame, 50, 40)


def test_extreme_finite_scale_omits_unrenderable_price_span():
    frame = _predictions()
    for horizon in range(1, 21):
        frame[f"pf_std_h{horizon:02d}"] = 1_000.0

    scored = score_neural_price_field(frame, 25, 80)

    assert math.isfinite(scored["crps"])
    assert scored["central_intervals"]["80"]["mean_price_span_pct"] is None


def test_extreme_finite_direct_forecast_is_counted_as_missing():
    frame = _predictions()
    complete = score_neural_price_field(frame, 25, 80)
    for horizon in range(1, 21):
        frame[f"pf_mean_h{horizon:02d}"] = 1e308

    scored = score_neural_price_field(frame, 25, 80)

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
