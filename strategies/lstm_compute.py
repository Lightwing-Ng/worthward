"""
Causal LSTM backends for the LSTM Price Field strategy.

The guaranteed path is a small NumPy LSTM. Torch MPS/CUDA, MLX, and Core ML /
Neural Engine are optional and are selected only after a real probe succeeds.
Missing optional packages never fail module import.

Code version: v1.3.0
"""

from __future__ import annotations

from dataclasses import dataclass, field
import importlib
import math
import platform
import time
from typing import Any, Callable

import numpy as np


_EPSILON = 1e-12
_MIN_NOISE_VARIANCE = 1e-8
_MIN_TRAINING_SEQUENCES = 16
_LOG_STD_MIN = -8.0
_LOG_STD_MAX = 2.0
_GRADIENT_CLIP = 1.0
_ADAM_BETA1 = 0.9
_ADAM_BETA2 = 0.999
_ADAM_EPS = 1e-8
_WEIGHT_DECAY = 1e-4
LAG_RETURN_FEATURE = "lstm_lagged_close_return"

_BACKEND_CHOICES = ("Auto", "CPU", "GPU", "Neural Engine")


def _load_optional_module(name: str) -> Any | None:
    try:
        return importlib.import_module(name)
    except Exception:
        return None


def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}


def _finite_readback(value: object) -> float | None:
    try:
        numeric = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def probe_torch_device(device: str) -> dict[str, Any]:
    """Execute a tiny tensor op on ``device`` and read the result back."""
    torch_module = _load_optional_module("torch")
    if torch_module is None:
        return {
            "available": False,
            "confirmed": False,
            "reason": "torch is not installed",
        }
    try:
        if device == "mps":
            mps_backend = getattr(getattr(torch_module, "backends", None), "mps", None)
            if mps_backend is None or not bool(mps_backend.is_available()):
                return {
                    "available": False,
                    "confirmed": False,
                    "reason": "torch.backends.mps.is_available() is false",
                }
        elif device == "cuda":
            cuda = getattr(torch_module, "cuda", None)
            if cuda is None or not bool(cuda.is_available()):
                return {
                    "available": False,
                    "confirmed": False,
                    "reason": "torch.cuda.is_available() is false",
                }
        else:
            return {
                "available": False,
                "confirmed": False,
                "reason": f"unsupported torch device {device}",
            }
        ones = torch_module.ones((1,), device=device)
        result = _finite_readback((ones + ones).sum().detach().cpu().item())
        if result != 2.0:
            return {
                "available": True,
                "confirmed": False,
                "reason": f"unexpected {device} readback {result}",
            }
        return {
            "available": True,
            "confirmed": True,
            "reason": None,
            "readback": result,
        }
    except Exception as exc:
        return {
            "available": False,
            "confirmed": False,
            "reason": f"{type(exc).__name__}: {str(exc) or 'torch device probe failed'}",
        }


def probe_mlx() -> dict[str, Any]:
    """Execute a tiny MLX array op and read the result back."""
    mlx_core = _load_optional_module("mlx.core")
    if mlx_core is None:
        return {
            "available": False,
            "confirmed": False,
            "reason": "mlx is not installed",
        }
    try:
        result = _finite_readback((mlx_core.array([1.0, 1.0]) + 1.0).sum().item())
        if result != 4.0:
            return {
                "available": True,
                "confirmed": False,
                "reason": f"unexpected mlx readback {result}",
            }
        return {
            "available": True,
            "confirmed": True,
            "reason": None,
            "readback": result,
        }
    except Exception as exc:
        return {
            "available": False,
            "confirmed": False,
            "reason": f"{type(exc).__name__}: {str(exc) or 'mlx probe failed'}",
        }


def probe_neural_engine() -> dict[str, Any]:
    """Probe Core ML and, when possible, confirm Neural Engine compute units.

    A successful ``coremltools`` import is not evidence that the Neural Engine
    ran. Confirmation requires a real predict plus compute-unit readback.
    """
    if not _apple_silicon():
        return {
            "available": False,
            "confirmed": False,
            "reason": "Neural Engine requires Apple Silicon macOS",
        }
    coremltools = _load_optional_module("coremltools")
    if coremltools is None:
        return {
            "available": False,
            "confirmed": False,
            "reason": "coremltools is not installed",
        }
    try:
        models = getattr(coremltools, "models", None)
        ml_model_class = getattr(models, "MLModel", None) if models is not None else None
        compute_plan = getattr(models, "compute_plan", None) if models is not None else None
        del ml_model_class, compute_plan
        # Training a walk-forward LSTM still happens on CPU or GPU. Core ML is
        # an inference compiler; converting every origin would dominate the
        # tiny-network cost. Report availability without claiming ANE use.
        return {
            "available": True,
            "confirmed": False,
            "reason": (
                "coremltools imported, but Neural Engine execution was not "
                "confirmed by a compute-unit readback on a converted LSTM"
            ),
            "coremltools_version": str(getattr(coremltools, "__version__", "") or ""),
        }
    except Exception as exc:
        return {
            "available": False,
            "confirmed": False,
            "reason": f"{type(exc).__name__}: {str(exc) or 'coremltools probe failed'}",
        }


def detect_lstm_capabilities() -> dict[str, Any]:
    """Return a JSON-safe snapshot of optional accelerators. Never raises."""
    torch_module = _load_optional_module("torch")
    mps_probe = probe_torch_device("mps") if torch_module is not None else {
        "available": False,
        "confirmed": False,
        "reason": "torch is not installed",
    }
    cuda_probe = probe_torch_device("cuda") if torch_module is not None else {
        "available": False,
        "confirmed": False,
        "reason": "torch is not installed",
    }
    mlx_probe = probe_mlx()
    neural_probe = probe_neural_engine()
    return {
        "platform": platform.system(),
        "machine": platform.machine(),
        "apple_silicon": _apple_silicon(),
        "numpy": True,
        "torch_installed": torch_module is not None,
        "torch_version": (
            str(getattr(torch_module, "__version__", "") or "")
            if torch_module is not None
            else None
        ),
        "mps": mps_probe,
        "cuda": cuda_probe,
        "mlx": mlx_probe,
        "neural_engine": neural_probe,
    }


@dataclass
class LstmBackend:
    requested: str
    resolved: str = "cpu"
    engine: str = "numpy"
    torch_module: Any | None = None
    numeric_precision: str = "float64"
    fallback_reason: str | None = None
    runtime_fallback: bool = False
    capabilities: dict[str, Any] = field(default_factory=dict)
    train_ms: float | None = None
    infer_ms: float | None = None
    origins_trained: int = 0
    origins_failed_closed: int = 0
    feature_names: tuple[str, ...] = ()
    minimum_training_seconds: float = 0.0
    training_compute_seconds: float = 0.0
    optimizer_steps: int = 0
    require_accelerator: bool = False
    origin_feature_names: dict[int, tuple[str, ...]] = field(default_factory=dict)

    def fall_back_to_cpu(self, reason: str) -> None:
        self.resolved = "cpu"
        self.engine = "numpy-fallback"
        self.torch_module = None
        self.numeric_precision = "float64"
        self.fallback_reason = reason
        self.runtime_fallback = True


@dataclass
class TrainingWork:
    """Count completed optimizer work, excluding loading and progress callbacks."""

    minimum_seconds: float
    tick: Callable[[], None] | None = None
    compute_seconds: float = 0.0
    optimizer_steps: int = 0

    def record(self, started: float) -> None:
        self.compute_seconds += time.perf_counter() - started
        self.optimizer_steps += 1
        if self.tick is not None:
            self.tick()


def resolve_lstm_backend(requested: str) -> LstmBackend:
    """Select a real backend. Auto never reports an accelerator without a probe."""
    normalized = requested if requested in _BACKEND_CHOICES else "Auto"
    if normalized == "CPU":
        return LstmBackend(
            requested=normalized,
            capabilities={
                "platform": platform.system(),
                "machine": platform.machine(),
                "apple_silicon": _apple_silicon(),
                "numpy": True,
                "torch_installed": None,
                "probe_skipped": "cpu-request",
            },
        )
    capabilities = detect_lstm_capabilities()
    backend = LstmBackend(requested=normalized, capabilities=capabilities)

    if normalized == "Neural Engine":
        neural = dict(capabilities.get("neural_engine") or {})
        if neural.get("confirmed"):
            backend.resolved = "neural-engine"
            backend.engine = "coreml"
            return backend
        backend.fall_back_to_cpu(
            str(neural.get("reason") or "Neural Engine is not confirmed")
        )
        backend.runtime_fallback = False
        return backend

    mps = dict(capabilities.get("mps") or {})
    cuda = dict(capabilities.get("cuda") or {})
    torch_module = _load_optional_module("torch")
    if normalized == "GPU":
        if mps.get("confirmed") and torch_module is not None:
            backend.resolved = "mps"
            backend.engine = "torch"
            backend.torch_module = torch_module
            backend.numeric_precision = "float32"
            return backend
        if cuda.get("confirmed") and torch_module is not None:
            backend.resolved = "cuda"
            backend.engine = "torch"
            backend.torch_module = torch_module
            backend.numeric_precision = "float64"
            return backend
        reason = str(
            mps.get("reason")
            or cuda.get("reason")
            or "no confirmed GPU device"
        )
        backend.fall_back_to_cpu(reason)
        backend.runtime_fallback = False
        return backend

    # Auto: origin-local tiny LSTM training is faster on CPU than GPU kernel
    # launch, so a confirmed accelerator is recorded rather than selected.
    notes: list[str] = []
    if mps.get("confirmed") or cuda.get("confirmed"):
        notes.append(
            "a confirmed GPU is available via the GPU backend; Auto keeps "
            "NumPy CPU for origin-local LSTM training"
        )
    mlx = dict(capabilities.get("mlx") or {})
    if mlx.get("confirmed"):
        notes.append(
            "MLX probe succeeded, but LSTM training uses NumPy because no "
            "MLX training kernel is implemented"
        )
    if notes:
        backend.fallback_reason = "; ".join(notes)
    return backend


def lagged_close_return(close_prices: np.ndarray) -> np.ndarray:
    """Causal close-to-close log return known at the close of each row."""
    close = np.asarray(close_prices, dtype=np.float64)
    lagged = np.full(len(close), np.nan, dtype=np.float64)
    if len(close) < 2:
        return lagged
    previous = close[:-1]
    current = close[1:]
    valid = (
        np.isfinite(previous)
        & np.isfinite(current)
        & (previous > 0.0)
        & (current > 0.0)
    )
    lagged[1:][valid] = np.log(current[valid] / previous[valid])
    return lagged


def _sigmoid(value: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(value, -40.0, 40.0)))


class _NumpyLSTM:
    """One-layer LSTM with a Gaussian mean/log-std head."""

    def __init__(
            self,
            input_size: int,
            hidden_size: int,
            rng: np.random.Generator,
    ) -> None:
        scale = 1.0 / math.sqrt(max(1, input_size + hidden_size))
        self.hidden_size = int(hidden_size)
        self.W = rng.normal(0.0, scale, size=(4 * hidden_size, input_size)).astype(np.float64)
        self.U = rng.normal(0.0, scale, size=(4 * hidden_size, hidden_size)).astype(np.float64)
        self.b = np.zeros(4 * hidden_size, dtype=np.float64)
        self.b[hidden_size:2 * hidden_size] = 1.0  # forget-gate bias
        self.W_out = rng.normal(0.0, scale, size=(2, hidden_size)).astype(np.float64)
        self.b_out = np.zeros(2, dtype=np.float64)

    def parameters(self) -> list[np.ndarray]:
        return [self.W, self.U, self.b, self.W_out, self.b_out]

    def _step(
            self,
            x_t: np.ndarray,
            hidden: np.ndarray,
            cell: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
        hidden_size = self.hidden_size
        gates = x_t @ self.W.T + hidden @ self.U.T + self.b
        input_gate = _sigmoid(gates[:, :hidden_size])
        forget_gate = _sigmoid(gates[:, hidden_size:2 * hidden_size])
        cell_candidate = np.tanh(gates[:, 2 * hidden_size:3 * hidden_size])
        output_gate = _sigmoid(gates[:, 3 * hidden_size:])
        next_cell = forget_gate * cell + input_gate * cell_candidate
        next_hidden = output_gate * np.tanh(next_cell)
        cache = {
            "x": x_t,
            "hidden": hidden,
            "cell": cell,
            "input_gate": input_gate,
            "forget_gate": forget_gate,
            "cell_candidate": cell_candidate,
            "output_gate": output_gate,
            "next_cell": next_cell,
            "next_hidden": next_hidden,
        }
        return next_hidden, next_cell, cache

    def forward(self, sequences: np.ndarray) -> tuple[np.ndarray, list[dict[str, np.ndarray]]]:
        batch, steps, _ = sequences.shape
        hidden = np.zeros((batch, self.hidden_size), dtype=np.float64)
        cell = np.zeros((batch, self.hidden_size), dtype=np.float64)
        caches: list[dict[str, np.ndarray]] = []
        for step in range(steps):
            hidden, cell, cache = self._step(sequences[:, step, :], hidden, cell)
            caches.append(cache)
        return hidden, caches

    def predict(self, sequences: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        hidden, _ = self.forward(sequences)
        raw = hidden @ self.W_out.T + self.b_out
        mean = raw[:, 0]
        log_std = np.clip(raw[:, 1], _LOG_STD_MIN, _LOG_STD_MAX)
        scale = np.exp(log_std)
        return mean, scale

    def _backward(
            self,
            caches: list[dict[str, np.ndarray]],
            hidden_grad: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        batch = hidden_grad.shape[0]
        dW = np.zeros_like(self.W)
        dU = np.zeros_like(self.U)
        db = np.zeros_like(self.b)
        d_hidden = hidden_grad
        d_cell = np.zeros((batch, self.hidden_size), dtype=np.float64)
        for cache in reversed(caches):
            tanh_cell = np.tanh(cache["next_cell"])
            d_output = d_hidden * tanh_cell
            d_tanh_cell = d_hidden * cache["output_gate"] * (1.0 - tanh_cell ** 2)
            d_cell_total = d_cell + d_tanh_cell
            d_forget = d_cell_total * cache["cell"]
            d_input = d_cell_total * cache["cell_candidate"]
            d_candidate = d_cell_total * cache["input_gate"]
            d_prev_cell = d_cell_total * cache["forget_gate"]
            d_gates = np.concatenate(
                [
                    d_input * cache["input_gate"] * (1.0 - cache["input_gate"]),
                    d_forget * cache["forget_gate"] * (1.0 - cache["forget_gate"]),
                    d_candidate * (1.0 - cache["cell_candidate"] ** 2),
                    d_output * cache["output_gate"] * (1.0 - cache["output_gate"]),
                ],
                axis=1,
            )
            dW += d_gates.T @ cache["x"]
            dU += d_gates.T @ cache["hidden"]
            db += d_gates.sum(axis=0)
            d_hidden = d_gates @ self.U
            d_cell = d_prev_cell
        return dW, dU, db

    def train(
            self,
            sequences: np.ndarray,
            targets: np.ndarray,
            *,
            epochs: int,
            learning_rate: float,
            work: TrainingWork | None = None,
    ) -> None:
        params = self.parameters()
        moments = [np.zeros_like(param) for param in params]
        velocities = [np.zeros_like(param) for param in params]
        epoch = 0
        while epoch < int(epochs) or (work is not None and work.compute_seconds < work.minimum_seconds):
            epoch += 1
            started = time.perf_counter()
            hidden, caches = self.forward(sequences)
            raw = hidden @ self.W_out.T + self.b_out
            mean = raw[:, 0]
            log_std = np.clip(raw[:, 1], _LOG_STD_MIN, _LOG_STD_MAX)
            clipped = (raw[:, 1] <= _LOG_STD_MIN) | (raw[:, 1] >= _LOG_STD_MAX)
            scale = np.exp(log_std)
            residual = targets - mean
            z_score = residual / np.maximum(scale, math.sqrt(_MIN_NOISE_VARIANCE))
            d_mean = -z_score / np.maximum(scale, math.sqrt(_MIN_NOISE_VARIANCE))
            d_log_std = (1.0 - z_score ** 2)
            d_log_std = np.where(clipped, 0.0, d_log_std)
            d_raw = np.column_stack((d_mean, d_log_std)) / max(1, len(targets))
            dW_out = d_raw.T @ hidden
            db_out = d_raw.sum(axis=0)
            d_hidden = d_raw @ self.W_out
            dW, dU, db = self._backward(caches, d_hidden)
            grads = [dW, dU, db, dW_out, db_out]
            for index, grad in enumerate(grads):
                grad += _WEIGHT_DECAY * params[index]
                grad_norm = float(np.linalg.norm(grad))
                if grad_norm > _GRADIENT_CLIP:
                    grad *= _GRADIENT_CLIP / grad_norm
                moments[index] = _ADAM_BETA1 * moments[index] + (1.0 - _ADAM_BETA1) * grad
                velocities[index] = (
                    _ADAM_BETA2 * velocities[index] + (1.0 - _ADAM_BETA2) * (grad ** 2)
                )
                moment_hat = moments[index] / (1.0 - _ADAM_BETA1 ** epoch)
                velocity_hat = velocities[index] / (1.0 - _ADAM_BETA2 ** epoch)
                params[index] -= learning_rate * moment_hat / (np.sqrt(velocity_hat) + _ADAM_EPS)
            if work is not None:
                work.record(started)


def _initialize_torch_lstm_biases(
        torch_module: Any,
        model: Any,
        hidden_size: int,
) -> None:
    """Match NumPy's input/forget/candidate/output bias initialization."""
    input_bias = getattr(model, "bias_ih_l0", None)
    recurrent_bias = getattr(model, "bias_hh_l0", None)
    if input_bias is None or recurrent_bias is None:
        raise RuntimeError("Torch LSTM does not expose its first-layer biases.")
    with torch_module.no_grad():
        input_bias.zero_()
        recurrent_bias.zero_()
        input_bias[hidden_size:2 * hidden_size].fill_(1.0)


def _torch_train_and_predict(
        backend: LstmBackend,
        train_sequences: np.ndarray,
        train_targets: np.ndarray,
        current_sequence: np.ndarray,
        hidden_size: int,
        epochs: int,
        learning_rate: float,
        seed: int,
        work: TrainingWork | None = None,
        timings: dict[str, float] | None = None,
) -> tuple[float, float]:
    training_started = time.perf_counter()
    torch_module = backend.torch_module
    if torch_module is None:
        raise RuntimeError("Torch is unavailable.")
    nn = torch_module.nn
    dtype = torch_module.float32 if backend.resolved == "mps" else torch_module.float64
    device = torch_module.device(backend.resolved)
    torch_module.manual_seed(int(seed))
    model = nn.LSTM(
        input_size=train_sequences.shape[-1],
        hidden_size=int(hidden_size),
        batch_first=True,
    ).to(device=device, dtype=dtype)
    _initialize_torch_lstm_biases(torch_module, model, int(hidden_size))
    head = nn.Linear(int(hidden_size), 2).to(device=device, dtype=dtype)
    optimizer = torch_module.optim.Adam(
        list(model.parameters()) + list(head.parameters()),
        lr=float(learning_rate),
        weight_decay=_WEIGHT_DECAY,
    )
    sequence_tensor = torch_module.as_tensor(train_sequences, dtype=dtype, device=device)
    target_tensor = torch_module.as_tensor(train_targets, dtype=dtype, device=device)
    model.train()
    head.train()
    epoch = 0
    if work is not None:
        getattr(torch_module, backend.resolved).synchronize()
    while epoch < int(epochs) or (work is not None and work.compute_seconds < work.minimum_seconds):
        epoch += 1
        started = time.perf_counter()
        optimizer.zero_grad(set_to_none=True)
        encoded, _ = model(sequence_tensor)
        raw = head(encoded[:, -1, :])
        mean = raw[:, 0]
        log_std = raw[:, 1].clamp(_LOG_STD_MIN, _LOG_STD_MAX)
        scale = log_std.exp()
        residual = target_tensor - mean
        loss = (log_std + 0.5 * (residual / scale).pow(2)).mean()
        loss.backward()
        torch_module.nn.utils.clip_grad_norm_(
            list(model.parameters()) + list(head.parameters()),
            _GRADIENT_CLIP,
        )
        optimizer.step()
        if work is not None:
            getattr(torch_module, backend.resolved).synchronize()
            work.record(started)
    if backend.resolved in {"mps", "cuda"}:
        getattr(torch_module, backend.resolved).synchronize()
    inference_started = time.perf_counter()
    if timings is not None:
        timings["train_ms"] = (inference_started - training_started) * 1000.0
    model.eval()
    head.eval()
    with torch_module.no_grad():
        current = torch_module.as_tensor(
            current_sequence[None, :, :],
            dtype=dtype,
            device=device,
        )
        encoded, _ = model(current)
        raw = head(encoded[:, -1, :])
        mean = float(raw[0, 0].detach().cpu().item())
        log_std = float(raw[0, 1].clamp(_LOG_STD_MIN, _LOG_STD_MAX).detach().cpu().item())
    if timings is not None:
        timings["infer_ms"] = (time.perf_counter() - inference_started) * 1000.0
    scale = math.exp(log_std)
    if not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0.0:
        raise ValueError("Torch LSTM prediction was non-finite.")
    del sequence_tensor, target_tensor, encoded, raw, current, model, head, optimizer
    return mean, scale


def _standardize_training(
        train_sequences: np.ndarray,
        current_sequence: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    feature_count = train_sequences.shape[-1]
    flat = train_sequences.reshape(-1, feature_count)
    center = np.nanmean(flat, axis=0)
    scale = np.nanstd(flat, axis=0)
    if np.any(~np.isfinite(center)):
        return None
    scale = np.where(np.isfinite(scale) & (scale > _EPSILON), scale, 1.0)
    train = (train_sequences - center) / scale
    current = (current_sequence - center) / scale
    if not np.all(np.isfinite(train)) or not np.all(np.isfinite(current)):
        return None
    return train, current


def _gather_origin_batch(
        features: np.ndarray,
        targets: np.ndarray,
        origin: int,
        training_window: int,
        lookback: int,
        used_columns: list[int] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Return causal train sequences/targets and the current sequence.

    A close-origin row ``origin`` may only train on targets through
    ``origin - 2`` because ``Open[origin + 1]`` is not observable yet.
    """
    if origin < lookback - 1:
        return None
    training_end = max(0, origin - 1)
    training_start = max(lookback - 1, training_end - int(training_window))
    sequences: list[np.ndarray] = []
    labels: list[float] = []
    lag_index = 0
    for index in range(training_start, training_end):
        target = float(targets[index])
        if not math.isfinite(target):
            continue
        start = index - lookback + 1
        sequence = features[start:index + 1]
        if sequence.shape[0] != lookback:
            continue
        if not np.all(np.isfinite(sequence[:, lag_index])):
            continue
        sequences.append(sequence)
        labels.append(target)
    if len(sequences) < _MIN_TRAINING_SEQUENCES:
        return None
    current = features[origin - lookback + 1:origin + 1]
    if current.shape[0] != lookback or not np.all(np.isfinite(current[:, lag_index])):
        return None
    train = np.stack(sequences, axis=0)
    current_values = np.asarray(current, dtype=np.float64)
    usable = np.all(np.isfinite(train), axis=(0, 1)) & np.all(
        np.isfinite(current_values),
        axis=0,
    )
    usable[lag_index] = True
    if not bool(np.any(usable)):
        return None
    if used_columns is not None:
        used_columns.extend(int(index) for index in np.flatnonzero(usable))
    train = train[:, :, usable]
    current_values = current_values[:, usable]
    if not np.all(np.isfinite(train)) or not np.all(np.isfinite(current_values)):
        return None
    return (
        train,
        np.asarray(labels, dtype=np.float64),
        current_values,
    )


def _numpy_origin_prediction(
        train_sequences: np.ndarray,
        train_targets: np.ndarray,
        current_sequence: np.ndarray,
        *,
        hidden_size: int,
        epochs: int,
        learning_rate: float,
        seed: int,
        work: TrainingWork | None = None,
        timings: dict[str, float] | None = None,
) -> tuple[float, float]:
    training_started = time.perf_counter()
    train, current = train_sequences, current_sequence
    rng = np.random.default_rng(int(seed))
    model = _NumpyLSTM(train.shape[-1], hidden_size, rng)
    residual_scale = float(np.std(train_targets, ddof=1)) if len(train_targets) > 1 else 0.02
    if not math.isfinite(residual_scale) or residual_scale <= 0.0:
        residual_scale = 0.02
    model.b_out[1] = math.log(residual_scale)
    model.train(train, train_targets, epochs=epochs, learning_rate=learning_rate, work=work)
    inference_started = time.perf_counter()
    mean, scale = model.predict(current[None, :, :])
    if timings is not None:
        timings["train_ms"] = (inference_started - training_started) * 1000.0
        timings["infer_ms"] = (time.perf_counter() - inference_started) * 1000.0
    predicted_mean = float(mean[0])
    predicted_scale = float(scale[0])
    if (
            not math.isfinite(predicted_mean)
            or not math.isfinite(predicted_scale)
            or predicted_scale <= 0.0
    ):
        raise ValueError("NumPy LSTM prediction was non-finite.")
    return predicted_mean, max(math.sqrt(_MIN_NOISE_VARIANCE), predicted_scale)


def walk_forward_lstm_predictions(
        features: np.ndarray,
        targets: np.ndarray,
        *,
        training_window: int,
        lookback: int,
        hidden_size: int,
        epochs: int,
        learning_rate: float,
        seed: int,
        backend: LstmBackend,
        progress: Callable[[int, int], None] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Fit one causal LSTM at every origin and fail closed on incomplete data."""
    feature_values = np.asarray(features, dtype=np.float64)
    target_values = np.asarray(targets, dtype=np.float64)
    row_count = min(len(feature_values), len(target_values))
    means = np.full(row_count, np.nan, dtype=np.float64)
    scales = np.full(row_count, np.nan, dtype=np.float64)
    train_ms = 0.0
    infer_ms = 0.0
    trained = 0
    failed = 0
    minimum = backend.minimum_training_seconds
    eligible_count = 0
    if minimum > 0:
        eligible_count = sum(
            _gather_origin_batch(feature_values, target_values, origin, training_window, lookback) is not None
            for origin in range(row_count)
        )
        if not eligible_count:
            raise ValueError("No causal training windows are available for this selection.")
    backend.training_compute_seconds = 0.0
    backend.optimizer_steps = 0
    backend.origin_feature_names = {}
    for origin in range(row_count):
        if progress is not None:
            progress(origin, row_count)
        used_columns: list[int] = []
        batch = _gather_origin_batch(
            feature_values,
            target_values,
            origin,
            training_window,
            lookback,
            used_columns,
        )
        if batch is None:
            failed += 1
            continue
        train_sequences, train_targets, current_sequence = batch
        origin_seed = int(seed) + int(origin)
        work = TrainingWork(
            minimum / eligible_count,
            (lambda: progress(origin, row_count)) if progress is not None else None,
        ) if minimum > 0 else None
        work_options = {"work": work} if work is not None else {}
        timings: dict[str, float] = {}
        work_options["timings"] = timings
        try:
            standardized = _standardize_training(train_sequences, current_sequence)
            if standardized is None:
                raise ValueError("LSTM feature standardization was non-finite.")
            train_sequences, current_sequence = standardized
            if backend.engine == "torch":
                mean, scale = _torch_train_and_predict(
                    backend,
                    train_sequences,
                    train_targets,
                    current_sequence,
                    hidden_size,
                    epochs,
                    learning_rate,
                    origin_seed,
                    **work_options,
                )
            elif backend.engine in {"numpy", "numpy-fallback"}:
                mean, scale = _numpy_origin_prediction(
                    train_sequences,
                    train_targets,
                    current_sequence,
                    hidden_size=hidden_size,
                    epochs=epochs,
                    learning_rate=learning_rate,
                    seed=origin_seed,
                    **work_options,
                )
            else:
                raise RuntimeError(f"Unsupported LSTM engine: {backend.engine}")
        except (RuntimeError, TypeError, ValueError) as exc:
            if minimum > 0 or backend.require_accelerator:
                raise RuntimeError(f"Training failed on {backend.resolved}: {exc}") from exc
            if backend.engine == "torch":
                backend.fall_back_to_cpu(
                    f"{type(exc).__name__}: {str(exc) or 'Torch LSTM failure'}"
                )
                return walk_forward_lstm_predictions(
                    feature_values,
                    target_values,
                    training_window=training_window,
                    lookback=lookback,
                    hidden_size=hidden_size,
                    epochs=epochs,
                    learning_rate=learning_rate,
                    seed=seed,
                    backend=backend,
                    progress=progress,
                )
            failed += 1
            continue
        train_ms += timings.get("train_ms", 0.0)
        infer_ms += timings.get("infer_ms", 0.0)
        backend.origin_feature_names[origin] = tuple(
            backend.feature_names[index] for index in used_columns
            if index < len(backend.feature_names)
        )
        means[origin] = mean
        scales[origin] = scale
        trained += 1
        if work is not None:
            backend.training_compute_seconds += work.compute_seconds
            backend.optimizer_steps += work.optimizer_steps
        del train_sequences, train_targets, current_sequence, batch
    backend.train_ms = round(train_ms, 3)
    backend.infer_ms = round(infer_ms, 3)
    backend.origins_trained = trained
    backend.origins_failed_closed = failed
    if minimum > 0 and backend.training_compute_seconds < minimum:
        raise RuntimeError("The minimum optimizer-work budget was not completed.")
    return means, scales


def backend_presentation(backend: LstmBackend) -> dict[str, Any]:
    """Report the backend that actually ran, not the requested label."""
    capabilities = dict(backend.capabilities or {})
    neural = dict(capabilities.get("neural_engine") or {})
    return {
        "requested": backend.requested,
        "resolved": backend.resolved,
        "engine": backend.engine,
        "numeric_precision": backend.numeric_precision,
        "fallback_reason": backend.fallback_reason,
        "runtime_fallback": backend.runtime_fallback,
        "parallel_workers": 1,
        "parallel_strategy": "serial-unified-memory",
        "apple_silicon": bool(capabilities.get("apple_silicon")),
        "torch_installed": bool(capabilities.get("torch_installed")),
        "mlx_available": bool((capabilities.get("mlx") or {}).get("confirmed")),
        "neural_engine_available": bool(neural.get("available")),
        "neural_engine_confirmed": bool(neural.get("confirmed")),
        "neural_engine_reason": neural.get("reason"),
        "train_ms": backend.train_ms,
        "minimum_training_seconds": backend.minimum_training_seconds,
        "training_compute_seconds": round(backend.training_compute_seconds, 6),
        "optimizer_steps": backend.optimizer_steps,
        "infer_ms": backend.infer_ms,
        "origins_trained": backend.origins_trained,
        "origins_failed_closed": backend.origins_failed_closed,
        "probe": {
            "mps": capabilities.get("mps"),
            "cuda": capabilities.get("cuda"),
            "mlx": capabilities.get("mlx"),
            "neural_engine": capabilities.get("neural_engine"),
        },
        "feature_names": list(backend.feature_names),
    }
