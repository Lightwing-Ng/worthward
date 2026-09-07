"""GPU worker interpreter routing tests. Code version: v1.0.0."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import lstm_runtime as runtime


def test_cpu_and_auto_keep_the_service_interpreter(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime.subprocess, "run", lambda *a, **k: pytest.fail("No GPU probe needed"))
    assert runtime.select_training_python("CPU", tmp_path) == runtime.sys.executable
    assert runtime.select_training_python("Auto", tmp_path) == runtime.sys.executable


def test_gpu_uses_only_a_probed_compatible_interpreter(monkeypatch, tmp_path):
    candidates = [tmp_path / "missing-torch", tmp_path / "working-mps"]
    for path in candidates:
        path.write_text("")
        path.chmod(0o700)
    monkeypatch.setattr(runtime, "_candidates", lambda root: iter(candidates))
    monkeypatch.setattr(runtime.subprocess, "run", lambda argv, **kw: SimpleNamespace(
        returncode=0, stdout=json.dumps({"available": argv[0] == str(candidates[1])})
    ))
    assert runtime.select_training_python("GPU", tmp_path) == str(candidates[1])


def test_gpu_never_silently_downgrades_when_no_runtime_is_usable(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "_candidates", lambda root: iter([]))
    with pytest.raises(RuntimeError, match="No compatible installed runtime"):
        runtime.select_training_python("GPU", tmp_path)


def test_runtime_replacement_preserves_worker_arguments(monkeypatch, tmp_path):
    selected = str(tmp_path / "python")
    monkeypatch.setattr(runtime, "select_training_python", lambda *args: selected)
    calls = []
    monkeypatch.setattr(runtime.os, "execv", lambda *args: calls.append(args))
    runtime.ensure_training_runtime("GPU", tmp_path, ["--ga-seed", "42", "--selected-params", '{"compute_backend":"GPU"}'])
    assert calls == [(selected, [selected, str(tmp_path / "scripts/lstm_ga_tune.py"),
                                "--ga-seed", "42", "--selected-params", '{"compute_backend":"GPU"}'])]


def test_configured_training_runtime_is_authoritative(monkeypatch, tmp_path):
    configured = tmp_path / "chosen-python"
    monkeypatch.setenv("WORTHWARD_TRAINING_PYTHON", str(configured))
    assert list(runtime._candidates(Path(tmp_path))) == [configured]
