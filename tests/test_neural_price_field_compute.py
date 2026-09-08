"""Direct neural distribution causality and backend contracts. Code version: v1.0.0."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from strategies import neural_price_field_compute as compute
from tests.factories.market import ohlc_frame_for_dates


def _inputs(count=85):
    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2024-01-02", periods=count).astype(str).tolist())
    frame["Close"] *= np.exp(np.sin(np.arange(count) * 0.31) * 0.02)
    closes = frame["Close"].to_numpy()
    returns = np.r_[np.nan, np.diff(np.log(closes))]
    features = np.column_stack((returns, np.cos(np.arange(count) * 0.2), np.full(count, np.nan)))
    return features, closes


def _params(**overrides):
    return {
        "compute_backend": "CPU", "training_window": 40, "lookback": 8,
        "hidden_size": 8, "epochs": 1, "learning_rate": 0.001,
        "retrain_interval": 20, "seed": 17, "dropout": 0.0,
        "patch_length": 4, **overrides,
    }


@pytest.fixture
def single_thread_torch():
    torch = pytest.importorskip("torch")
    previous = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        yield torch
    finally:
        torch.set_num_threads(previous)


def test_targets_are_direct_close_returns_and_preserve_unavailable_tails():
    closes = np.exp(np.arange(25) * 0.01)
    targets = compute.direct_close_return_targets(closes)
    np.testing.assert_allclose(targets[0], np.arange(1, 21) * 0.01)
    assert np.isnan(targets[-1]).all()
    assert np.isclose(targets[-2, 0], 0.01)
    assert np.isnan(targets[-2, 1:]).all()
    closes[4] = 0.0
    assert np.isnan(compute.direct_close_return_targets(closes)[3, 0])


def test_training_prefix_has_exact_label_purge_and_causal_feature_eligibility():
    features, closes = _inputs(110)
    features[86:, 2] = np.arange(24)
    targets = compute.direct_close_return_targets(closes)
    batch = compute._training_batch(features, targets, 80, 40, 8)
    assert batch.indices[-1] == 60
    assert batch.indices[-1] + compute.NEURAL_HORIZONS == 80
    np.testing.assert_array_equal(batch.columns, [0, 1])
    altered_features = features.copy()
    altered_features[81:] = 999.0
    altered_closes = closes.copy()
    altered_closes[81:] *= 10
    changed = compute._training_batch(altered_features, compute.direct_close_return_targets(altered_closes), 80, 40, 8)
    np.testing.assert_array_equal(batch.sequences, changed.sequences)
    np.testing.assert_array_equal(batch.targets, changed.targets)
    np.testing.assert_array_equal(batch.feature_center, changed.feature_center)
    np.testing.assert_array_equal(batch.target_center, changed.target_center)


def test_missing_inputs_have_explicit_masks_and_training_only_imputation():
    features, closes = _inputs()
    features[30:35, 1] = np.nan
    batch = compute._training_batch(features, compute.direct_close_return_targets(closes), 80, 40, 8)
    assert np.isfinite(batch.sequences).all()
    assert (batch.sequences[:, :, 3] == 0).any()
    missing = batch.sequences[:, :, 3] == 0
    np.testing.assert_array_equal(batch.sequences[:, :, 1][missing], 0.0)
    outside = features[73:81].copy()
    outside[-1, 1] = np.nan
    current = batch.transform(outside[None])
    assert current[0, -1, 1] == 0.0 and current[0, -1, 3] == 0.0


def test_training_statistics_do_not_depend_on_inference_observations():
    features, closes = _inputs()
    targets = compute.direct_close_return_targets(closes)
    batch = compute._training_batch(features, targets, 80, 40, 8)
    # Inputs after the last eligible training sample are observable, but they
    # still must not alter a fitted model's normalizer or feature eligibility.
    features[61:81, 1] = 1e10
    changed = compute._training_batch(features, targets, 80, 40, 8)
    np.testing.assert_array_equal(batch.feature_center, changed.feature_center)
    np.testing.assert_array_equal(batch.feature_scale, changed.feature_scale)


def test_overlapping_windows_do_not_inflate_sparse_factor_eligibility():
    features, closes = _inputs()
    features[50:61, 2] = np.arange(11)
    batch = compute._training_batch(features, compute.direct_close_return_targets(closes), 80, 40, 8)
    np.testing.assert_array_equal(batch.columns, [0, 1])


def test_gpu_request_fails_closed_and_auto_reports_real_cpu_reason():
    torch = pytest.importorskip("torch")
    with patch.object(compute, "_load_torch", return_value=torch), patch.object(compute, "_probe_device", return_value=(False, "no accelerator")):
        with pytest.raises(RuntimeError, match="verified MPS or CUDA"):
            compute.resolve_neural_backend("GPU")
        backend = compute.resolve_neural_backend("Auto")
    assert backend.resolved == "cpu"
    assert "no accelerator" in backend.fallback_reason
    assert not backend.presentation()["accelerator_confirmed"]


def test_auto_selects_the_confirmed_accelerator():
    torch = pytest.importorskip("torch")
    with patch.object(compute, "_load_torch", return_value=torch), patch.object(compute, "_probe_device", side_effect=[(True, None)]) as probe:
        backend = compute.resolve_neural_backend("Auto")
    assert backend.resolved == "mps"
    assert backend.presentation()["accelerator_confirmed"]
    probe.assert_called_once_with(torch, "mps")


def test_mps_cpu_fallback_cannot_be_reported_as_verified_accelerator_use():
    with patch.dict("os.environ", {"PYTORCH_ENABLE_MPS_FALLBACK": "1"}):
        confirmed, reason = compute._probe_device(None, "mps")
    assert confirmed is False
    assert "fallback is enabled" in reason


@pytest.mark.parametrize("architecture", compute.NEURAL_ARCHITECTURES)
def test_each_architecture_trains_real_cpu_direct_distributions(architecture, single_thread_torch):
    features, closes = _inputs(64)
    result = compute.walk_forward_neural_predictions(
        features, closes, architecture=architecture, params=_params(),
        feature_names=("lagged_return", "exogenous", "unavailable"),
    )
    assert result.means.shape == result.stds.shape == (64, 20)
    assert np.isnan(result.means[:58]).all()
    assert np.isfinite(result.means[58:]).all()
    assert (result.stds[58:] > 0).all()
    assert result.selected_features == ("lagged_return", "exogenous")
    assert result.device["resolved"] == "cpu" and result.device["engine"] == "torch"
    assert result.device["optimizer_steps"] > 0 and result.device["refits"] == 1
    assert result.training_diagnostics["target"] == "log(close[t+h]/close[t])"
    assert result.training_diagnostics["joint_path_distribution"] is False
    refit = result.training_diagnostics["refits"][0]
    assert refit["latest_training_outcome"] <= refit["origin"]


@pytest.mark.parametrize("architecture", compute.NEURAL_ARCHITECTURES)
def test_future_changes_leave_all_earlier_forecasts_unchanged(single_thread_torch, architecture):
    features, closes = _inputs()
    first = compute.walk_forward_neural_predictions(features, closes, architecture=architecture, params=_params())
    features[72:] *= 100
    closes[72:] *= 2
    second = compute.walk_forward_neural_predictions(features, closes, architecture=architecture, params=_params())
    np.testing.assert_allclose(first.means[:72], second.means[:72], equal_nan=True, atol=0, rtol=0)
    np.testing.assert_allclose(first.stds[:72], second.stds[:72], equal_nan=True, atol=0, rtol=0)
    np.testing.assert_array_equal(first.origin_training_end[58:78], 58)
    np.testing.assert_array_equal(first.origin_training_end[78:], 78)


def test_training_preserves_the_callers_torch_random_stream(single_thread_torch):
    torch = single_thread_torch
    features, closes = _inputs(64)
    state = torch.random.get_rng_state().clone()
    compute.walk_forward_neural_predictions(features, closes, architecture="tsmixer", params=_params())
    assert torch.equal(state, torch.random.get_rng_state())


def test_runtime_failure_does_not_switch_backend_or_return_partial_success():
    pytest.importorskip("torch")
    features, closes = _inputs(64)
    with patch.object(compute, "_train_model", side_effect=RuntimeError("device lost")):
        with pytest.raises(RuntimeError, match="training failed on cpu: device lost"):
            compute.walk_forward_neural_predictions(features, closes, architecture="nhits", params=_params())


def test_cancellation_is_checked_before_loading_or_training_torch():
    features, closes = _inputs()
    with patch.object(compute, "_load_torch") as loader:
        with pytest.raises(compute.NeuralTrainingCancelled):
            compute.walk_forward_neural_predictions(features, closes, architecture="timexer", params=_params(), cancel=lambda: True)
    loader.assert_not_called()


@pytest.mark.parametrize("change", [{"epochs": 0}, {"training_window": 31}, {"dropout": 1.0}, {"learning_rate": float("nan")}, {"seed": -1}])
def test_invalid_training_parameters_fail_before_compute(change):
    features, closes = _inputs()
    with pytest.raises(ValueError):
        compute.walk_forward_neural_predictions(features, closes, architecture="patchtst", params=_params(**change))


def test_insufficient_or_constant_endogenous_history_is_explicitly_unavailable():
    pytest.importorskip("torch")
    features, closes = _inputs(55)
    short = compute.walk_forward_neural_predictions(features, closes, architecture="tsmixer", params=_params())
    assert np.isnan(short.means).all() and short.device["optimizer_steps"] == 0
    features, closes = _inputs(64)
    features[:, 0] = 1.0
    constant = compute.walk_forward_neural_predictions(features, closes, architecture="tsmixer", params=_params())
    assert np.isnan(constant.means).all() and constant.selected_features == ()


def test_missing_torch_dispatches_to_supported_runtime_without_recursive_fallback():
    features, closes = _inputs(64)
    with patch.object(compute, "_load_torch", side_effect=RuntimeError("missing torch")), patch.dict("os.environ", {"WORTHWARD_NEURAL_INFERENCE_WORKER": "0"}), patch("strategies.neural_price_field_runtime.infer_in_supported_runtime", return_value="bridged") as bridge:
        result = compute.walk_forward_neural_predictions(features, closes, architecture="tsmixer", params=_params())
    assert result == "bridged"
    np.testing.assert_array_equal(bridge.call_args.args[0], features)
    with patch.object(compute, "_load_torch", side_effect=RuntimeError("missing torch")), patch.dict("os.environ", {"WORTHWARD_NEURAL_INFERENCE_WORKER": "1"}):
        with pytest.raises(RuntimeError, match="missing torch"):
            compute.walk_forward_neural_predictions(features, closes, architecture="tsmixer", params=_params())
