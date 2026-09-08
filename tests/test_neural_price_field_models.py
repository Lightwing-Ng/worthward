"""Real extended-core learning, structure, and causal batch regressions.

Code version: v1.0.0
"""

from __future__ import annotations

import subprocess
import sys
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from strategies.neural_price_field_compute import _make_model, walk_forward_neural_predictions
from strategies.neural_price_field_models import make_extended_model
from tests.factories.market import ohlc_frame_for_dates


ARCHITECTURES = ("itransformer", "tide", "moderntcn")
LEGACY_ARCHITECTURES = ("patchtst", "tsmixer", "nhits", "timexer")


@pytest.fixture
def torch_cpu():
    torch = pytest.importorskip("torch")
    previous_threads = torch.get_num_threads()
    previous_state = torch.random.get_rng_state()
    torch.set_num_threads(1)
    torch.manual_seed(413)
    try:
        yield torch
    finally:
        torch.random.set_rng_state(previous_state)
        torch.set_num_threads(previous_threads)


@pytest.fixture
def direct_inputs():
    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-02", periods=85).astype(str).tolist())
    frame["Close"] *= np.exp(np.sin(np.arange(85) * 0.31) * 0.02)
    closes = frame["Close"].to_numpy()
    features = np.column_stack((
        np.r_[np.nan, np.diff(np.log(closes))], np.cos(np.arange(85) * 0.2), np.full(85, np.nan),
    ))
    return features, closes


def test_extended_core_imports_do_not_initialize_torch_or_web_application():
    result = subprocess.run([
        sys.executable, "-B", "-c",
        "import sys; import strategies.neural_price_field_models; "
        "assert 'torch' not in sys.modules; assert 'app' not in sys.modules",
    ], capture_output=True, text=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("architecture", ARCHITECTURES)
@pytest.mark.parametrize("variables", (1, 3))
def test_each_core_has_real_cpu_gaussian_gradients_and_updates(torch_cpu, architecture, variables):
    torch = torch_cpu
    model = _make_model(torch, architecture, 12, variables * 2, 8, 0.0, 4)
    observed = torch.ones(5, 12, variables)
    observed[0, 2:4, -1] = 0
    values = torch.cat((torch.randn(5, 12, variables) * observed, observed), dim=-1)
    targets = torch.randn(5, 20)
    before = {name: value.detach().clone() for name, value in model.named_parameters()}
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001)
    model.train()
    raw = model(values)
    assert raw.shape == (5, 20, 2)
    mean, log_std = raw[..., 0], raw[..., 1].clamp(-3, 3)
    loss = (log_std + 0.5 * ((targets - mean) * (-log_std).exp()).square()).mean()
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    gradients = [value.grad for value in model.parameters() if value.grad is not None]
    assert gradients and all(torch.isfinite(value).all() for value in gradients)
    assert any(torch.count_nonzero(value) for value in gradients)
    optimizer.step()
    assert any(not torch.equal(before[name], value) for name, value in model.named_parameters())
    assert torch.isfinite(model(values)).all()


@pytest.mark.parametrize("architecture", ARCHITECTURES)
def test_later_batched_origins_never_change_an_earlier_prediction(torch_cpu, architecture):
    torch = torch_cpu
    model = _make_model(torch, architecture, 12, 6, 8, 0.2, 4).eval()
    history = torch.cat((torch.randn(4, 12, 3), torch.ones(4, 12, 3)), dim=-1)
    with torch.no_grad():
        expected = model(history[:1])
        changed = history.clone()
        changed[1:, :, :3] *= 50
        batched = model(changed)[:1]
    torch.testing.assert_close(batched, expected, rtol=1e-5, atol=1e-6)


def test_itransformer_attention_tokens_are_variables_with_paired_masks(torch_cpu):
    torch = torch_cpu
    model = _make_model(torch, "itransformer", 12, 6, 8, 0.0, 4).eval()
    shapes = []
    handle = model.variable_encoder.register_forward_pre_hook(lambda _module, inputs: shapes.append(inputs[0].shape))
    values = torch.cat((torch.randn(2, 12, 3), torch.ones(2, 12, 3)), dim=-1).requires_grad_()
    try:
        model(values).square().sum().backward()
    finally:
        handle.remove()
    assert shapes == [torch.Size([2, 3, 8])]
    assert torch.count_nonzero(values.grad[:, :, 1:3]) > 0
    assert torch.count_nonzero(values.grad[:, :, 3:]) > 0


def test_tide_retains_an_exact_target_history_residual_and_separate_scale_head(torch_cpu):
    torch = torch_cpu
    model = make_extended_model(torch, "tide", 8, 2, 8, 0.0, 4, horizons=3).eval()
    with torch.no_grad():
        for value in model.parameters():
            value.zero_()
        model.residual_head.weight[:, -1] = torch.tensor([1.0, 2.0, 3.0])
    values = torch.zeros(2, 8, 2)
    values[:, :, 1] = 1
    values[:, -1, 0] = torch.tensor([0.5, -0.25])
    raw = model(values)
    torch.testing.assert_close(raw[:, :, 0], torch.tensor([[0.5, 1, 1.5], [-0.25, -0.5, -0.75]]))
    assert torch.count_nonzero(raw[:, :, 1]) == 0


def test_moderntcn_contains_temporal_depthwise_and_both_grouped_mixing_stages(torch_cpu):
    torch = torch_cpu
    model = _make_model(torch, "moderntcn", 16, 6, 8, 0.0, 4)
    assert model.block.large_depthwise.groups == 3 * 8
    assert model.block.large_depthwise.kernel_size[0] > model.block.small_depthwise.kernel_size[0]
    assert model.block.channel_mixing[0].groups == 3
    assert model.block.variable_mixing[0].groups == 8
    values = torch.cat((torch.randn(3, 16, 3), torch.ones(3, 16, 3)), dim=-1)
    model(values).square().mean().backward()
    for layer in (model.block.large_depthwise, model.block.channel_mixing[0], model.block.variable_mixing[0]):
        assert torch.isfinite(layer.weight.grad).all()
        assert torch.count_nonzero(layer.weight.grad) > 0


@pytest.mark.parametrize("lookback", (9, 33))
def test_moderntcn_nondivisible_patch_stride_retains_latest_observation(torch_cpu, lookback):
    torch = torch_cpu
    model = _make_model(torch, "moderntcn", lookback, 2, 8, 0.0, 8).eval()
    values = torch.stack((torch.arange(lookback) / 10, torch.ones(lookback)), dim=-1).unsqueeze(0)
    values.requires_grad_()
    embedded_patches = []
    handle = model.patch_embedding.register_forward_pre_hook(
        lambda _module, inputs: embedded_patches.append(inputs[0].detach().clone()),
    )
    try:
        model(values).square().sum().backward()
    finally:
        handle.remove()
    final_observed_patch = embedded_patches[0][0, 0, -1, :8]
    torch.testing.assert_close(final_observed_patch, values.detach()[0, -8:, 0])
    assert torch.isfinite(values.grad[0, -1, 0])
    assert values.grad[0, -1, 0].abs() > 0


@pytest.mark.parametrize("architecture", ARCHITECTURES)
def test_end_to_end_walk_forward_reuses_mature_labels_and_ignores_future(torch_cpu, architecture, direct_inputs):
    features, closes = direct_inputs
    params = {
        "compute_backend": "CPU", "lookback": 8, "hidden_size": 8, "epochs": 1,
        "training_window": 40, "retrain_interval": 20, "seed": 17, "dropout": 0.0,
    }
    first = walk_forward_neural_predictions(features, closes, architecture=architecture, params=params)
    altered = features.copy()
    altered[70:] *= 30
    altered_closes = closes.copy()
    altered_closes[70:] *= 5
    second = walk_forward_neural_predictions(altered, altered_closes, architecture=architecture, params=params)
    assert first.device["optimizer_steps"] > 0 and first.device["resolved"] == "cpu"
    assert np.isfinite(first.means[58:]).all() and np.all(first.stds[58:] > 0)
    np.testing.assert_allclose(first.means[:70], second.means[:70], rtol=0, atol=0, equal_nan=True)
    np.testing.assert_allclose(first.stds[:70], second.stds[:70], rtol=0, atol=0, equal_nan=True)
    for record in first.training_diagnostics["refits"]:
        assert record["latest_training_origin"] + 20 <= record["origin"]
    assert first.training_diagnostics["joint_path_distribution"] is False


@pytest.mark.parametrize("architecture", LEGACY_ARCHITECTURES)
def test_original_four_construction_never_delegates_to_extended_factory(torch_cpu, architecture):
    with patch("strategies.neural_price_field_models.make_extended_model", side_effect=AssertionError("legacy dispatch changed")):
        model = _make_model(torch_cpu, architecture, 8, 4, 8, 0.0, 4)
    assert model is not None


@pytest.mark.parametrize("changes", ({"channels": 3}, {"lookback": 0}, {"hidden": 2.5}, {"dropout": float("nan")}))
def test_extended_factory_rejects_invalid_shape_and_numeric_contracts(changes):
    arguments = dict(architecture="tide", lookback=8, channels=4, hidden=8, dropout=0.0, patch_length=4)
    arguments.update(changes)
    with pytest.raises(ValueError):
        make_extended_model(None, **arguments)
