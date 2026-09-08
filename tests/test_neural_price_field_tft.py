"""Real CPU TFT structure, causality, and distribution training regressions.

Code version: v1.0.0
"""

from __future__ import annotations

import pytest

from strategies.neural_price_field_tft import make_tft_model


@pytest.fixture
def torch_cpu():
    torch = pytest.importorskip("torch")
    previous_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(27)
            yield torch
    finally:
        torch.set_num_threads(previous_threads)


def _observations(torch, batch=5, lookback=8, features=3):
    observed = torch.randn(batch, lookback, features)
    return torch.cat((observed, torch.ones_like(observed)), dim=-1)


def test_tft_real_gaussian_nll_updates_all_core_components(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.0)
    values = _observations(torch)
    targets = values[:, -1, :1] * torch.linspace(0.05, 0.5, 20).unsqueeze(0)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001)
    before = model.head.weight.detach().clone()
    raw = model(values)
    assert raw.shape == (5, 20, 2)
    log_scale = raw[..., 1].clamp(-3.0, 3.0)
    loss = (log_scale + 0.5 * ((targets - raw[..., 0]) * (-log_scale).exp()).square()).mean()
    loss.backward()
    for component in (
        model.variable_selection.embeddings[0], model.variable_selection.weight_network,
        model.variable_selection.transforms[0], model.encoder, model.decoder,
        model.temporal_attention.query, model.temporal_attention.key,
        model.temporal_attention.value, model.position_network, model.head,
    ):
        gradients = [parameter.grad for parameter in component.parameters() if parameter.grad is not None]
        assert gradients and all(torch.isfinite(gradient).all() for gradient in gradients)
        assert sum(float(gradient.abs().sum()) for gradient in gradients) > 0.0
    assert model.neutral_context.grad is not None
    assert torch.isfinite(model.neutral_context.grad).all()
    optimizer.step()
    assert not torch.equal(model.head.weight, before)
    assert torch.isfinite(model(values)).all()


def test_tft_variable_selection_is_conditional_and_normalized(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.0).eval()
    captured = []
    hook = model.variable_selection.register_forward_hook(lambda _module, _inputs, output: captured.append(output[1]))
    with torch.no_grad():
        model(_observations(torch))
    hook.remove()
    weights = captured[0]
    assert weights.shape == (5, 8, 3)
    torch.testing.assert_close(weights.sum(dim=-1), torch.ones(5, 8))
    assert (weights > 0).all()
    assert not torch.allclose(weights[0], weights[1])


def test_tft_missing_values_cannot_influence_predictions_or_input_gradients(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.0).eval()
    values = _observations(torch)
    values[:, 2:6, 4] = 0.0
    changed = values.clone()
    changed[:, 2:6, 1] = 12345.0
    original = values.clone()
    torch.testing.assert_close(model(values), model(changed), atol=0.0, rtol=0.0)
    torch.testing.assert_close(values, original, atol=0.0, rtol=0.0)
    values.requires_grad_()
    model(values).sum().backward()
    assert torch.count_nonzero(values.grad[:, 2:6, 1]) == 0


def test_tft_inference_batch_never_changes_an_earlier_origin(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.2).eval()
    values = _observations(torch)
    with torch.no_grad():
        first = model(values[:1])
        batched = model(values)[:1]
        values[1:, :, :3] *= 1000
        changed = model(values)[:1]
    torch.testing.assert_close(first, batched, atol=2e-7, rtol=2e-6)
    torch.testing.assert_close(batched, changed, atol=0.0, rtol=0.0)


def test_tft_future_attention_is_causal_with_one_shared_value_projection(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.0).eval()
    sequence = torch.randn(2, 28, 8)
    first, weights = model.temporal_attention(sequence)
    sequence[:, 9:] += torch.randn(2, 19, 8) * 100
    second, _ = model.temporal_attention(sequence)
    torch.testing.assert_close(first[:, 0], second[:, 0], atol=0.0, rtol=0.0)
    assert torch.count_nonzero(weights.masked_select(model.temporal_attention.future_mask.unsqueeze(0))) == 0
    torch.testing.assert_close(weights.sum(dim=-1), torch.ones(2, 20))
    assert model.temporal_attention.value.out_features == 2
    assert not isinstance(model.temporal_attention.value, torch.nn.ModuleList)


def test_tft_horizon_decoder_does_not_feed_later_horizons_backwards(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 8, 6, 8, 0.0).eval()
    values = _observations(torch)
    with torch.no_grad():
        original = model(values)
        model.horizon_embedding.weight[-1].add_(torch.arange(8) * 100)
        changed = model(values)
    torch.testing.assert_close(original[:, :-1], changed[:, :-1], atol=0.0, rtol=0.0)
    assert not torch.allclose(original[:, -1], changed[:, -1])


def test_tft_single_observed_variable_and_state_reload_are_supported(torch_cpu):
    torch = torch_cpu
    model = make_tft_model(torch, 3, 2, 6, 0.0, horizons=4).eval()
    clone = make_tft_model(torch, 3, 2, 6, 0.0, horizons=4).eval()
    clone.load_state_dict(model.state_dict())
    values = _observations(torch, batch=1, lookback=3, features=1)
    assert model(values).shape == (1, 4, 2)
    torch.testing.assert_close(model(values), clone(values), atol=0.0, rtol=0.0)


@pytest.mark.parametrize("arguments", [
    {"lookback": 0}, {"channels": 3}, {"channels": 0}, {"hidden": 1},
    {"hidden": 8.5}, {"horizons": 0}, {"dropout": float("nan")},
    {"dropout": 1.0}, {"dropout": -0.1},
])
def test_tft_invalid_architecture_domains_fail_before_training(torch_cpu, arguments):
    config = {"lookback": 8, "channels": 6, "hidden": 8, "dropout": 0.0, **arguments}
    with pytest.raises(ValueError, match="TFT"):
        make_tft_model(torch_cpu, **config)


def test_tft_rejects_misaligned_sequences(torch_cpu):
    model = make_tft_model(torch_cpu, 8, 6, 8, 0.0)
    with pytest.raises(ValueError, match="TFT expects"):
        model(torch_cpu.zeros(2, 7, 6))
