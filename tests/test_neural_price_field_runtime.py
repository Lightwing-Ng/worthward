"""Neural inference pipe progress and process ownership. Code version: v1.0.0."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from strategies.neural_price_field_compute import NeuralForecast, NeuralTrainingCancelled
from strategies import neural_price_field_runtime as runtime


def _request(**options):
    return runtime.infer_in_supported_runtime(
        np.array([[0.01], [np.nan]]), np.array([10.0, 10.1]),
        architecture="tsmixer", params={"compute_backend": "CPU"},
        feature_names=("return",), min_training_seconds=0, progress=options.get("progress"),
        cancel=options.get("cancel"),
    )


def test_pipe_round_trip_forwards_progress_once_and_preserves_missing_predictions():
    forecast = NeuralForecast(np.full((2, 20), np.nan), np.full((2, 20), np.nan),
                              {"resolved": "cpu", "engine": "torch"},
                              origin_training_end=np.array([-1, -1]))
    output = json.dumps({"event": "progress", "current": 1, "total": 2}) + "\n"
    final = output + json.dumps({"event": "result", "forecast": runtime.forecast_payload(forecast)}, allow_nan=False) + "\n"
    process = MagicMock(returncode=0)
    process.communicate.side_effect = [subprocess.TimeoutExpired("worker", 0.25, output=output.encode()), (final, "")]
    events = []
    with patch.object(runtime, "_supported_python", return_value="/installed/torch/python"), patch.object(runtime.subprocess, "Popen", return_value=process) as launch:
        result = _request(progress=lambda current, total: events.append((current, total)))
    assert events == [(1, 2)]
    assert np.isnan(result.means).all()
    assert result.device["runtime_bridge"] is True
    assert launch.call_args.kwargs["start_new_session"] == (os.name == "posix")
    request = json.loads(process.communicate.call_args_list[0].kwargs["input"])
    assert request["features"][1][0] is None
    assert process.communicate.call_args_list[1].kwargs["input"] is None


def test_runtime_cancellation_reaps_the_owned_process():
    process = MagicMock(returncode=None)
    with patch.object(runtime, "_supported_python", return_value="/installed/torch/python"), patch.object(runtime.subprocess, "Popen", return_value=process), patch.object(runtime, "_stop_owned_process") as stop:
        with pytest.raises(NeuralTrainingCancelled):
            _request(cancel=lambda: True)
    stop.assert_called_once_with(process)


def test_worker_failure_never_returns_a_completed_forecast():
    process = MagicMock(returncode=1)
    process.communicate.return_value = ("", "RuntimeError: MPS device lost")
    with patch.object(runtime, "_supported_python", return_value="/installed/torch/python"), patch.object(runtime.subprocess, "Popen", return_value=process), patch.object(runtime, "_stop_owned_process"):
        with pytest.raises(RuntimeError, match="MPS device lost"):
            _request()


def test_owned_process_group_is_actually_terminated_and_reaped():
    process = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(60)"],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=os.name == "posix")
    try:
        runtime._stop_owned_process(process)
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
