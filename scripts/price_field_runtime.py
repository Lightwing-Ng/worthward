"""Resolve a verified PyTorch runtime for neural Price Fields. Code version: v1.0.0."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

from scripts.lstm_runtime import _candidates


def select_price_field_python(backend: str, project_root: Path) -> str:
    """Prefer working MPS/CUDA for Auto; CPU still requires installed PyTorch."""
    if backend not in {"Auto", "CPU", "GPU"}:
        raise ValueError("Unknown neural compute backend.")
    probe = """
import json, sys
if sys.version_info < (3, 13):
    raise SystemExit(2)
import torch
device = 'cpu'
if sys.argv[1] != 'CPU':
    if torch.backends.mps.is_available():
        device = 'mps'
    elif torch.cuda.is_available():
        device = 'cuda'
try:
    value = torch.ones((2, 2), device=device)
    (value @ value).sum().item()
except Exception:
    device = 'cpu'
    (torch.ones((2, 2)) @ torch.ones((2, 2))).sum().item()
print(json.dumps({'device': device}))
"""
    seen = set()
    cpu = None
    for candidate in _candidates(project_root):
        candidate = candidate.resolve()
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        try:
            result = subprocess.run([str(candidate), "-B", "-c", probe, backend],
                                    capture_output=True, text=True, cwd=project_root, timeout=20, check=False)
            if result.returncode != 0:
                continue
            device = json.loads(result.stdout.strip().splitlines()[-1])["device"]
            if backend == "CPU" or device in {"mps", "cuda"}:
                return str(candidate)
            cpu = cpu or str(candidate)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
            continue
    if backend == "Auto" and cpu:
        return cpu
    raise RuntimeError("Neural Price Field training requires Python 3.13+ with working PyTorch"
                       + (" MPS or CUDA." if backend == "GPU" else ".")
                       + " Set WORTHWARD_TRAINING_PYTHON to a compatible environment.")


def ensure_price_field_runtime(backend: str, script: Path, argv: list[str]) -> None:
    import os

    selected = select_price_field_python(backend, script.resolve().parents[1])
    if Path(selected).resolve() != Path(sys.executable).resolve():
        os.execv(selected, [selected, "-B", str(script), *argv])
