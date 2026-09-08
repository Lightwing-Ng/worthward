"""Bounded, store-free inference in an installed PyTorch runtime.

Code version: v1.0.0
"""

from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from typing import Any

import numpy as np


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_RUNTIME_TIMEOUT_SECONDS = 900.0


@lru_cache(maxsize=6)
def _supported_python(backend: str, configured_python: str) -> str:
    from scripts.price_field_runtime import select_price_field_python

    del configured_python  # Include the explicit environment choice in the cache identity.
    return select_price_field_python(backend, _PROJECT_ROOT)


def _json_numbers(values: np.ndarray) -> list[Any]:
    return np.where(np.isfinite(values), values, None).tolist()


def forecast_payload(result: Any) -> dict[str, Any]:
    return {
        "means": _json_numbers(result.means), "stds": _json_numbers(result.stds),
        "device": result.device, "selected_features": list(result.selected_features),
        "origin_training_end": result.origin_training_end.tolist(),
        "origin_feature_names": result.origin_feature_names,
        "training_diagnostics": result.training_diagnostics,
    }


def _stop_owned_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.communicate(timeout=3)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if process.poll() is None:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.communicate(timeout=3)


def infer_in_supported_runtime(features, closes, *, architecture, params,
                               feature_names, progress, min_training_seconds, cancel):
    """Send one JSON request over pipes and reap only this request's process."""
    from strategies.neural_price_field_compute import NeuralForecast, NeuralTrainingCancelled

    selected = _supported_python(str(params["compute_backend"]), os.environ.get("WORTHWARD_TRAINING_PYTHON", ""))
    if Path(selected).resolve() == Path(sys.executable).resolve():
        raise RuntimeError("The selected neural runtime cannot import PyTorch.")
    payload = json.dumps({
        "features": _json_numbers(features), "closes": _json_numbers(closes),
        "architecture": architecture, "params": dict(params), "feature_names": list(feature_names),
        "min_training_seconds": min_training_seconds,
    }, allow_nan=False)
    environment = dict(os.environ, WORTHWARD_NEURAL_INFERENCE_WORKER="1", PYTHONDONTWRITEBYTECODE="1",
                       PYTORCH_ENABLE_MPS_FALLBACK="0")
    command = [selected, "-B", str(_PROJECT_ROOT / "scripts/neural_price_field_infer.py")]
    process = subprocess.Popen(command, cwd=_PROJECT_ROOT, env=environment, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               start_new_session=os.name == "posix")
    deadline = time.monotonic() + max(_RUNTIME_TIMEOUT_SECONDS, min_training_seconds + 300.0)
    delivered = 0

    def consume_progress(output):
        nonlocal delivered
        text = output.decode() if isinstance(output, bytes) else output or ""
        lines = text.splitlines(keepends=True)
        for line in lines[delivered:]:
            if not line.endswith("\n"):
                break
            message = json.loads(line)
            if message.get("event") == "progress" and progress is not None:
                progress(int(message["current"]), int(message["total"]))
            delivered += 1

    try:
        first = True
        while True:
            if cancel is not None and cancel():
                raise NeuralTrainingCancelled("Neural Price Field runtime was canceled.")
            if time.monotonic() >= deadline:
                raise TimeoutError("Neural Price Field runtime exceeded its bounded inference deadline.")
            try:
                output, error = process.communicate(input=payload if first else None, timeout=0.25)
                consume_progress(output)
                break
            except subprocess.TimeoutExpired as exc:
                first = False
                consume_progress(exc.output)
        if process.returncode != 0:
            raise RuntimeError(f"Neural inference runtime exited {process.returncode}: {error[-2000:].strip()}")
        messages = [json.loads(line) for line in output.splitlines() if line.strip()]
        message = next((item for item in reversed(messages) if item.get("event") == "result"), None)
        if message is None:
            raise RuntimeError("Neural inference runtime did not return a complete result.")
        value = message["forecast"]
        means, stds = np.asarray(value["means"], dtype=float), np.asarray(value["stds"], dtype=float)
        if means.shape != (len(closes), 20) or stds.shape != means.shape:
            raise RuntimeError("Neural inference runtime returned an invalid forecast shape.")
        device = dict(value["device"], runtime_python=selected, runtime_bridge=True)
        return NeuralForecast(
            means, stds, device, tuple(value["selected_features"]),
            np.asarray(value["origin_training_end"], dtype=int),
            {int(key): tuple(names) for key, names in value["origin_feature_names"].items()},
            value["training_diagnostics"],
        )
    except BaseException:
        _stop_owned_process(process)
        raise
