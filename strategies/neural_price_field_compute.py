"""Causal direct-horizon neural probability forecasts.

The compact, randomly initialized architectures adapt published forecasting
cores to Gaussian marginal distributions of close-to-close cumulative returns.
They are research implementations, not pretrained models or reproduced published
financial results. Each horizon is fitted directly; there is no AR projection.

Code version: v1.1.0
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
import importlib
import math
import os
import threading
import time
from typing import Any, Callable, Mapping, Sequence

import numpy as np

from strategies.neural_price_field_registry import NEURAL_ARCHITECTURES

NEURAL_HORIZONS = 20
MIN_TRAINING_SEQUENCES = 32
_TORCH_LOCK = threading.RLock()
_TARGET_SCALE_FLOOR = 1e-4


class NeuralTrainingCancelled(RuntimeError):
    """A caller canceled training before a complete forecast was available."""


@dataclass
class NeuralForecast:
    means: np.ndarray
    stds: np.ndarray
    device: dict[str, Any]
    selected_features: tuple[str, ...] = ()
    origin_training_end: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=int))
    origin_feature_names: dict[int, tuple[str, ...]] = field(default_factory=dict)
    training_diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass
class NeuralBackend:
    requested: str
    resolved: str
    torch: Any = field(repr=False)
    fallback_reason: str | None = None

    def presentation(self) -> dict[str, Any]:
        return {
            "requested": self.requested,
            "resolved": self.resolved,
            "engine": "torch",
            "numeric_precision": "float32",
            "fallback_reason": self.fallback_reason,
            "runtime_fallback": False,
            "accelerator_confirmed": self.resolved in {"mps", "cuda"},
            "torch_version": str(self.torch.__version__),
        }


def _load_torch() -> Any:
    try:
        return importlib.import_module("torch")
    except (ImportError, OSError) as exc:
        raise RuntimeError(
            "Neural Price Field requires PyTorch in a Python 3.13+ runtime."
        ) from exc


def _probe_device(torch: Any, device: str) -> tuple[bool, str | None]:
    if device == "mps" and os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
        return False, "MPS CPU fallback is enabled; verified accelerator execution requires it disabled"
    try:
        available = (
            torch.backends.mps.is_available() if device == "mps"
            else torch.cuda.is_available()
        )
        if not available:
            return False, f"{device} is unavailable"
        value = torch.ones((2,), device=device, requires_grad=True)
        loss = (value * value).sum()
        loss.backward()
        if float(loss.detach().cpu()) != 2.0 or float(value.grad.sum().cpu()) != 4.0:
            return False, f"{device} forward/backward readback failed"
        return True, None
    except Exception as exc:
        return False, f"{device}: {type(exc).__name__}: {exc}"


def resolve_neural_backend(requested: str = "Auto") -> NeuralBackend:
    """Probe actual accelerator training; explicit GPU never falls back."""
    if requested not in {"Auto", "CPU", "GPU"}:
        raise ValueError("Neural compute backend must be Auto, CPU, or GPU.")
    torch = _load_torch()
    if requested == "CPU":
        return NeuralBackend(requested, "cpu", torch)
    reasons = []
    for device in ("mps", "cuda"):
        available, reason = _probe_device(torch, device)
        if available:
            return NeuralBackend(requested, device, torch)
        reasons.append(reason)
    reason = "; ".join(str(item) for item in reasons)
    if requested == "GPU":
        raise RuntimeError(f"GPU training requires a verified MPS or CUDA device: {reason}")
    return NeuralBackend(requested, "cpu", torch, reason)


def direct_close_return_targets(closes: np.ndarray) -> np.ndarray:
    """Return y[s,h-1] = log(close[s+h]/close[s]), including unavailable tails."""
    values = np.asarray(closes, dtype=np.float64)
    if values.ndim != 1:
        raise ValueError("Close prices must be one-dimensional.")
    logs = np.full(len(values), np.nan)
    valid = np.isfinite(values) & (values > 0)
    logs[valid] = np.log(values[valid])
    targets = np.full((len(values), NEURAL_HORIZONS), np.nan)
    for horizon in range(1, min(NEURAL_HORIZONS, len(values) - 1) + 1):
        targets[:-horizon, horizon - 1] = logs[horizon:] - logs[:-horizon]
    return targets


@dataclass
class _TrainingBatch:
    sequences: np.ndarray
    targets: np.ndarray
    indices: np.ndarray
    columns: np.ndarray
    feature_center: np.ndarray
    feature_scale: np.ndarray
    target_center: np.ndarray
    target_scale: np.ndarray

    def transform(self, sequences: np.ndarray) -> np.ndarray:
        selected = np.asarray(sequences[..., self.columns], dtype=np.float64)
        observed = np.isfinite(selected)
        normalized = np.where(observed, (selected - self.feature_center) / self.feature_scale, 0.0)
        return np.concatenate((np.clip(normalized, -12.0, 12.0), observed.astype(float)), axis=-1).astype(np.float32)


def _training_batch(
    features: np.ndarray,
    targets: np.ndarray,
    origin: int,
    training_window: int,
    lookback: int,
) -> _TrainingBatch | None:
    """Use only labels whose complete twenty-session outcome is already known."""
    last = origin - NEURAL_HORIZONS
    first = max(lookback - 1, last - training_window + 1)
    indices = np.arange(first, last + 1, dtype=int)
    if len(indices) < MIN_TRAINING_SEQUENCES:
        return None
    indices = indices[np.all(np.isfinite(targets[indices]), axis=1)]
    if len(indices) < MIN_TRAINING_SEQUENCES:
        return None
    windows = np.lib.stride_tricks.sliding_window_view(features, lookback, axis=0).transpose(0, 2, 1)
    sequences = windows[indices - lookback + 1]
    # Count distinct observed rows; overlapping sequences must not inflate
    # a sparse factor's eligibility or overweight central normalization rows.
    training_rows = np.unique((indices[:, None] - np.arange(lookback)[None, :]).ravel())
    flat = features[training_rows]
    counts = np.isfinite(flat).sum(axis=0)
    centers = np.divide(np.nansum(np.where(np.isfinite(flat), flat, np.nan), axis=0), counts,
                        out=np.zeros(features.shape[1]), where=counts > 0)
    deviations = np.where(np.isfinite(flat), flat - centers, 0.0)
    scales = np.sqrt(np.divide((deviations ** 2).sum(axis=0), counts,
                               out=np.zeros(features.shape[1]), where=counts > 0))
    # Eligibility belongs to this training prefix. Never inspect future coverage.
    columns = np.flatnonzero((counts >= MIN_TRAINING_SEQUENCES) & (scales > 1e-12))
    if not len(columns) or columns[0] != 0:
        return None
    labels = targets[indices]
    target_center = labels.mean(axis=0)
    target_scale = np.maximum(labels.std(axis=0, ddof=1), _TARGET_SCALE_FLOOR)
    batch = _TrainingBatch(
        sequences, labels, indices, columns, centers[columns], scales[columns],
        target_center, target_scale,
    )
    batch.sequences = batch.transform(sequences)
    batch.targets = ((labels - target_center) / target_scale).astype(np.float32)
    return batch


def _attention_heads(hidden: int) -> int:
    return next(value for value in (4, 2, 1) if hidden % value == 0)


def _make_model(torch: Any, architecture: str, lookback: int, channels: int,
                hidden: int, dropout: float, patch_length: int) -> Any:
    """Construct small forecasting cores with a common Gaussian marginal head."""
    nn = torch.nn
    functional = nn.functional
    patch_length = min(lookback, patch_length)
    stride = max(1, patch_length // 2)
    patches = 1 + (lookback - patch_length) // stride

    class PatchTST(nn.Module):
        def __init__(self):
            super().__init__()
            self.embedding = nn.Linear(patch_length, hidden)
            self.position = nn.Parameter(torch.zeros(1, patches, hidden))
            layer = nn.TransformerEncoderLayer(hidden, _attention_heads(hidden), hidden * 2,
                                               dropout, batch_first=True, activation="gelu")
            self.encoder = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
            self.head = nn.Linear(channels * hidden, NEURAL_HORIZONS * 2)

        def forward(self, values):
            batch = values.shape[0]
            tokens = values.transpose(1, 2).unfold(-1, patch_length, stride)
            tokens = tokens.reshape(batch * channels, patches, patch_length)
            tokens = self.encoder(self.embedding(tokens) + self.position)
            return self.head(tokens.mean(dim=1).reshape(batch, channels * hidden)).reshape(batch, NEURAL_HORIZONS, 2)

    class MixerBlock(nn.Module):
        def __init__(self):
            super().__init__()
            self.time_norm = nn.LayerNorm(channels)
            self.time_mlp = nn.Sequential(nn.Linear(lookback, hidden), nn.GELU(),
                                          nn.Dropout(dropout), nn.Linear(hidden, lookback), nn.Dropout(dropout))
            self.feature_norm = nn.LayerNorm(channels)
            self.feature_mlp = nn.Sequential(nn.Linear(channels, hidden), nn.GELU(),
                                             nn.Dropout(dropout), nn.Linear(hidden, channels), nn.Dropout(dropout))

        def forward(self, values):
            values = values + self.time_mlp(self.time_norm(values).transpose(1, 2)).transpose(1, 2)
            return values + self.feature_mlp(self.feature_norm(values))

    class TSMixer(nn.Module):
        def __init__(self):
            super().__init__()
            self.mixers = nn.Sequential(MixerBlock(), MixerBlock())
            self.time_projection = nn.Linear(lookback, NEURAL_HORIZONS)
            self.head = nn.Linear(channels, 2)

        def forward(self, values):
            mixed = self.mixers(values)
            return self.head(self.time_projection(mixed.transpose(1, 2)).transpose(1, 2))

    class NHitsBlock(nn.Module):
        def __init__(self, rate):
            super().__init__()
            self.rate = min(rate, lookback)
            self.knots = max(2, math.ceil(NEURAL_HORIZONS / rate))
            pooled = math.ceil(lookback / self.rate)
            self.network = nn.Sequential(
                nn.Linear(pooled * channels, hidden * 2), nn.ReLU(), nn.Dropout(dropout),
                nn.Linear(hidden * 2, hidden * 2), nn.ReLU(), nn.Dropout(dropout),
            )
            self.head = nn.Linear(hidden * 2, lookback + self.knots * 2)

        def forward(self, values):
            pooled = functional.max_pool1d(values.transpose(1, 2), self.rate, ceil_mode=True)
            raw = self.head(self.network(pooled.flatten(1)))
            forecast = raw[:, lookback:].reshape(-1, 2, self.knots)
            forecast = functional.interpolate(forecast, size=NEURAL_HORIZONS, mode="linear", align_corners=False)
            return raw[:, :lookback], forecast.transpose(1, 2)

    class NHits(nn.Module):
        def __init__(self):
            super().__init__()
            self.blocks = nn.ModuleList(NHitsBlock(rate) for rate in (4, 2, 1))

        def forward(self, values):
            residual = values
            forecast = values.new_zeros((len(values), NEURAL_HORIZONS, 2))
            for block in self.blocks:
                backcast, update = block(residual)
                residual = torch.cat((residual[:, :, :1] - backcast.unsqueeze(-1), residual[:, :, 1:]), dim=-1)
                forecast = forecast + update
            return forecast

    class TimeXerBlock(nn.Module):
        def __init__(self):
            super().__init__()
            heads = _attention_heads(hidden)
            self.self_attention = nn.MultiheadAttention(hidden, heads, dropout=dropout, batch_first=True)
            self.cross_attention = nn.MultiheadAttention(hidden, heads, dropout=dropout, batch_first=True)
            self.norm1, self.norm2, self.norm3 = (nn.LayerNorm(hidden) for _ in range(3))
            self.dropout = nn.Dropout(dropout)
            self.feedforward = nn.Sequential(nn.Linear(hidden, hidden * 2), nn.GELU(),
                                             nn.Dropout(dropout), nn.Linear(hidden * 2, hidden))

        def forward(self, tokens, exogenous):
            attended = self.self_attention(tokens, tokens, tokens, need_weights=False)[0]
            tokens = self.norm1(tokens + self.dropout(attended))
            global_token = tokens[:, -1:]
            if exogenous.shape[1]:
                cross = self.cross_attention(global_token, exogenous, exogenous, need_weights=False)[0]
                global_token = self.norm2(global_token + self.dropout(cross))
            tokens = torch.cat((tokens[:, :-1], global_token), dim=1)
            return self.norm3(tokens + self.dropout(self.feedforward(tokens)))

    class TimeXer(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = channels // 2
            self.endogenous_embedding = nn.Linear(patch_length * 2, hidden)
            self.exogenous_embedding = nn.Linear(lookback * 2, hidden)
            self.global_token = nn.Parameter(torch.zeros(1, 1, hidden))
            self.position = nn.Parameter(torch.zeros(1, patches + 1, hidden))
            self.blocks = nn.ModuleList(TimeXerBlock() for _ in range(2))
            self.head = nn.Linear((patches + 1) * hidden, NEURAL_HORIZONS * 2)

        def forward(self, values):
            batch = len(values)
            endo = values[:, :, [0, self.features]].transpose(1, 2).unfold(-1, patch_length, stride)
            endo = endo.transpose(1, 2).reshape(batch, patches, patch_length * 2)
            tokens = torch.cat((self.endogenous_embedding(endo), self.global_token.expand(batch, -1, -1)), dim=1)
            tokens = tokens + self.position
            exo = torch.cat((values[:, :, 1:self.features], values[:, :, self.features + 1:]), dim=1).transpose(1, 2)
            exo = self.exogenous_embedding(exo)
            for block in self.blocks:
                tokens = block(tokens, exo)
            return self.head(tokens.flatten(1)).reshape(batch, NEURAL_HORIZONS, 2)

    constructors = {"patchtst": PatchTST, "tsmixer": TSMixer, "nhits": NHits, "timexer": TimeXer}
    if architecture in constructors:
        model = constructors[architecture]()
    else:
        from strategies.neural_price_field_models import make_extended_model

        model = make_extended_model(torch, architecture, lookback, channels, hidden,
                                    dropout, patch_length, NEURAL_HORIZONS)
    # A restrained initial head starts near the causal empirical distribution.
    for name, layer in model.named_modules():
        if name.endswith("head") and isinstance(layer, nn.Linear):
            nn.init.normal_(layer.weight, std=0.01)
            nn.init.zeros_(layer.bias)
    return model


def _check_cancel(cancel: Callable[[], bool] | None) -> None:
    if cancel is not None and cancel():
        raise NeuralTrainingCancelled("Neural Price Field training was canceled.")


@contextmanager
def _isolated_random_state(backend: NeuralBackend):
    """Preserve caller RNG streams while seeding an isolated fitted model."""
    torch = backend.torch
    cpu_state = torch.random.get_rng_state()
    accelerator = getattr(torch, backend.resolved) if backend.resolved != "cpu" else None
    device_state = accelerator.get_rng_state() if accelerator is not None else None
    try:
        yield
    finally:
        torch.random.set_rng_state(cpu_state)
        if accelerator is not None:
            accelerator.set_rng_state(device_state)


def _train_model(backend: NeuralBackend, architecture: str, batch: _TrainingBatch,
                 params: Mapping[str, Any], seed: int, minimum_seconds: float,
                 cancel: Callable[[], bool] | None) -> tuple[Any, dict[str, Any]]:
    torch = backend.torch
    torch.default_generator.manual_seed(seed)
    if backend.resolved != "cpu":
        getattr(torch, backend.resolved).manual_seed(seed)
    model = _make_model(torch, architecture, batch.sequences.shape[1], batch.sequences.shape[2],
                        int(params["hidden_size"]), float(params["dropout"]), int(params["patch_length"]))
    model = model.to(backend.resolved)
    features = torch.as_tensor(batch.sequences, device=backend.resolved)
    labels = torch.as_tensor(batch.targets, device=backend.resolved)
    optimizer = torch.optim.AdamW(model.parameters(), lr=float(params["learning_rate"]),
                                   weight_decay=float(params["weight_decay"]))
    generator = torch.Generator(device="cpu").manual_seed(seed)
    start = time.perf_counter()
    epoch = steps = 0
    last_loss = None
    model.train()
    while epoch < int(params["epochs"]) or time.perf_counter() - start < minimum_seconds:
        order = torch.randperm(len(features), generator=generator).to(backend.resolved)
        for offset in range(0, len(features), int(params["batch_size"])):
            _check_cancel(cancel)
            selected = order[offset:offset + int(params["batch_size"])]
            raw = model(features[selected])
            mean, log_std = raw[:, :, 0], raw[:, :, 1].clamp(-3.0, 3.0)
            # Each direct horizon contributes equally in its training-only units.
            loss = (log_std + 0.5 * ((labels[selected] - mean) * (-log_std).exp()).square()).mean()
            if not bool(torch.isfinite(loss).detach().cpu()):
                raise RuntimeError("Neural Gaussian training loss is non-finite.")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
            last_loss = float(loss.detach().cpu())
            steps += 1
        epoch += 1
    model.eval()
    return model, {
        "epochs": epoch, "optimizer_steps": steps, "final_training_nll_standardized": last_loss,
        "train_seconds": time.perf_counter() - start,
        "parameter_count": sum(value.numel() for value in model.parameters()),
    }


def _parameters(values: Mapping[str, Any]) -> dict[str, Any]:
    defaults = {
        "training_window": 252, "lookback": 32, "hidden_size": 32, "epochs": 8,
        "learning_rate": 0.001, "retrain_interval": 20, "weight_decay": 0.001,
        "seed": 42, "compute_backend": "Auto", "batch_size": 256, "dropout": 0.1,
        "patch_length": 8,
    }
    options = {key: values.get(key, value) for key, value in defaults.items()}
    for key in ("training_window", "lookback", "hidden_size", "epochs", "retrain_interval", "batch_size", "patch_length"):
        options[key] = int(options[key])
        if options[key] < 1:
            raise ValueError(f"{key} must be a positive integer.")
    if options["training_window"] < MIN_TRAINING_SEQUENCES:
        raise ValueError(f"training_window must be at least {MIN_TRAINING_SEQUENCES}.")
    for key in ("learning_rate", "weight_decay", "dropout"):
        options[key] = float(options[key])
        if not math.isfinite(options[key]):
            raise ValueError(f"{key} must be finite.")
    if options["learning_rate"] <= 0 or options["weight_decay"] < 0 or not 0 <= options["dropout"] < 1:
        raise ValueError("Invalid neural learning rate, weight decay, or dropout.")
    options["seed"] = int(options["seed"])
    if not 0 <= options["seed"] < 2 ** 32:
        raise ValueError("seed must be an unsigned 32-bit integer.")
    return options


def _predict_block(backend, model, batch, values, closes, start, stop, lookback):
    """Batch independent origins under one frozen model and normalization.

    No layer normalizes or attends across the batch axis. A later origin's
    observed features therefore cannot affect an earlier origin's forecast.
    """
    means = np.full((stop - start, NEURAL_HORIZONS), np.nan)
    stds = means.copy()
    origins = np.arange(start, stop)
    valid = np.isfinite(values[origins, 0]) & np.isfinite(closes[origins]) & (closes[origins] > 0)
    origins = origins[valid]
    if not len(origins):
        return means, stds
    windows = np.lib.stride_tricks.sliding_window_view(values, lookback, axis=0).transpose(0, 2, 1)
    sequences = windows[origins - lookback + 1]
    tensor = backend.torch.as_tensor(batch.transform(sequences), device=backend.resolved)
    with backend.torch.no_grad():
        raw = model(tensor).detach().cpu().numpy().astype(np.float64)
    predicted_means = batch.target_center + batch.target_scale * raw[:, :, 0]
    predicted_stds = batch.target_scale * np.exp(np.clip(raw[:, :, 1], -3.0, 3.0))
    if not np.all(np.isfinite(predicted_means)) or not np.all(np.isfinite(predicted_stds) & (predicted_stds > 0)):
        raise ValueError("Neural distribution parameters are non-finite or nonpositive.")
    means[origins - start], stds[origins - start] = predicted_means, predicted_stds
    return means, stds


def walk_forward_neural_predictions(
    features: np.ndarray,
    closes: np.ndarray,
    *,
    architecture: str,
    params: Mapping[str, Any],
    feature_names: Sequence[str] = (),
    progress: Callable[[int, int], None] | None = None,
    min_training_seconds: float = 0.0,
    cancel: Callable[[], bool] | None = None,
) -> NeuralForecast:
    """Fit causal blocks and predict twenty direct Gaussian return marginals.

    At origin o, training sample s is eligible only when s + 20 <= o.
    Features at o are completed-bar observations. A fitted model and its
    training-only transforms remain frozen until the next scheduled refit.
    The first feature is the endogenous lagged close return; its availability
    is required. Caller-supplied exogenous features must already obey their
    publication-time contract. Models never infer missing market observations.
    """
    if architecture not in NEURAL_ARCHITECTURES:
        raise ValueError(f"Unknown neural architecture: {architecture}")
    options = _parameters(params)
    values = np.asarray(features, dtype=np.float64)
    closes = np.asarray(closes, dtype=np.float64)
    if values.ndim != 2 or not values.shape[1] or closes.ndim != 1 or len(values) != len(closes):
        raise ValueError("features must be N by F and closes must contain N prices.")
    if feature_names and len(feature_names) != values.shape[1]:
        raise ValueError("feature_names must match the feature columns.")
    if not math.isfinite(min_training_seconds) or min_training_seconds < 0:
        raise ValueError("min_training_seconds must be finite and nonnegative.")
    _check_cancel(cancel)
    try:
        _load_torch()
    except RuntimeError:
        if os.environ.get("WORTHWARD_NEURAL_INFERENCE_WORKER") == "1":
            raise
        from strategies.neural_price_field_runtime import infer_in_supported_runtime

        return infer_in_supported_runtime(
            values, closes, architecture=architecture, params=options,
            feature_names=feature_names, progress=progress,
            min_training_seconds=min_training_seconds, cancel=cancel,
        )
    names = tuple(feature_names) or tuple(f"feature_{index}" for index in range(values.shape[1]))
    count, lookback = len(values), options["lookback"]
    result = NeuralForecast(np.full((count, NEURAL_HORIZONS), np.nan),
                            np.full((count, NEURAL_HORIZONS), np.nan), {},
                            origin_training_end=np.full(count, -1, dtype=int))
    targets = direct_close_return_targets(closes)
    first_origin = lookback - 1 + MIN_TRAINING_SEQUENCES - 1 + NEURAL_HORIZONS
    expected_refits = max(1, math.ceil(max(0, count - first_origin) / options["retrain_interval"]))
    records: list[dict[str, Any]] = []
    # Torch seeding and model initialization are process-global. A serial lock
    # keeps concurrent requests reproducible; the durable scheduler owns workers.
    with _TORCH_LOCK:
        _check_cancel(cancel)
        backend = resolve_neural_backend(str(options["compute_backend"]))
        with _isolated_random_state(backend):
            return _walk_forward_on_backend(
                values, closes, architecture, options, names, result, targets,
                first_origin, expected_refits, records, backend, min_training_seconds,
                progress, cancel,
            )


def _walk_forward_on_backend(values, closes, architecture, options, names, result,
                             targets, first_origin, expected_refits, records, backend,
                             min_training_seconds, progress, cancel):
    count, lookback = len(values), options["lookback"]
    model = batch = None
    fit_origin = -1
    train_seconds = infer_seconds = 0.0
    block_means = block_stds = None
    for origin in range(first_origin, count):
        _check_cancel(cancel)
        if model is None or origin - fit_origin >= options["retrain_interval"]:
            candidate = _training_batch(values, targets, origin, options["training_window"], lookback)
            if candidate is None:
                continue
            batch = candidate
            try:
                model, work = _train_model(backend, architecture, batch, options,
                                          (options["seed"] + origin) % (2 ** 32),
                                          min_training_seconds / expected_refits, cancel)
            except NeuralTrainingCancelled:
                raise
            except Exception as exc:
                raise RuntimeError(f"Neural {architecture} training failed on {backend.resolved}: {exc}") from exc
            fit_origin = origin
            train_seconds += work["train_seconds"]
            result.selected_features = tuple(names[index] for index in batch.columns)
            records.append({
                "origin": origin, "latest_training_origin": int(batch.indices[-1]),
                "latest_training_outcome": int(batch.indices[-1] + NEURAL_HORIZONS),
                "training_sequences": len(batch.indices), "features": list(result.selected_features), **work,
            })
            if progress is not None:
                progress(origin, count)
            _check_cancel(cancel)
            started = time.perf_counter()
            try:
                block_means, block_stds = _predict_block(
                    backend, model, batch, values, closes, origin,
                    min(count, origin + options["retrain_interval"]), lookback,
                )
            except Exception as exc:
                raise RuntimeError(f"Neural {architecture} inference failed on {backend.resolved}: {exc}") from exc
            infer_seconds += time.perf_counter() - started
        if not np.isfinite(block_means[origin - fit_origin]).all():
            continue
        result.means[origin], result.stds[origin] = block_means[origin - fit_origin], block_stds[origin - fit_origin]
        result.origin_training_end[origin] = fit_origin
        result.origin_feature_names[origin] = result.selected_features
    result.device = backend.presentation()
    result.device.update({
        "train_ms": train_seconds * 1000, "infer_ms": infer_seconds * 1000,
        "origins_trained": len(result.origin_feature_names), "refits": len(records),
        "optimizer_steps": sum(record["optimizer_steps"] for record in records),
        "feature_names": list(result.selected_features),
    })
    result.training_diagnostics = {
        "architecture": architecture, "distribution": "direct-gaussian-marginals",
        "target": "log(close[t+h]/close[t])", "horizons": NEURAL_HORIZONS,
        "target_purge_sessions": NEURAL_HORIZONS, "minimum_training_sequences": MIN_TRAINING_SEQUENCES,
        "retrain_interval": options["retrain_interval"], "refits": records,
        "joint_path_distribution": False, "pretrained_weights": False,
        "missing_data": "training-only-standardization-with-observation-mask",
        "inference_batching": "independent-origins-within-frozen-refit-block",
    }
    if progress is not None:
        progress(count, count)
    return result
