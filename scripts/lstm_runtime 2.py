"""Select an installed GPU-capable training interpreter. Code version: v1.0.0."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

_PROBE = """
import sys
if sys.version_info < (3, 13):
    raise SystemExit(2)
import json
import scripts.lstm_ga_tune
from strategies.lstm_compute import resolve_lstm_backend
backend = resolve_lstm_backend('GPU')
print(json.dumps({'available': backend.engine == 'torch', 'device': backend.resolved}))
"""


def _candidates(project_root: Path):
    configured = os.environ.get("WORTHWARD_TRAINING_PYTHON", "").strip()
    if configured:
        yield Path(configured).expanduser()
        return
    yield Path(sys.executable)
    preferred = os.environ.get("WORTHWARD_PYTHON", "").strip()
    if preferred:
        yield Path(preferred).expanduser()
    yield project_root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    # Check every PATH directory, including later entries shadowed by Homebrew.
    for directory in os.get_exec_path():
        for name in ("python3", "python", "python.exe"):
            yield Path(directory) / name
    if sys.platform == "darwin":
        yield from Path("/Library/Frameworks/Python.framework/Versions").glob("*/bin/python3")


def select_training_python(backend: str, project_root: Path) -> str:
    """Preserve CPU/Auto; explicit GPU requires a verified compatible runtime."""
    if backend != "GPU":
        return sys.executable
    seen = set()
    for candidate in _candidates(project_root):
        candidate = candidate.resolve()
        if candidate in seen or not candidate.is_file() or not os.access(candidate, os.X_OK):
            continue
        seen.add(candidate)
        try:
            result = subprocess.run(
                [str(candidate), "-c", _PROBE], cwd=project_root,
                capture_output=True, text=True, timeout=20, check=False,
            )
            if result.returncode == 0 and json.loads(result.stdout.strip().splitlines()[-1]).get("available"):
                return str(candidate)
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            continue
    raise RuntimeError(
        "GPU training requires a Python 3.13+ environment with working PyTorch MPS or CUDA. "
        "No compatible installed runtime was found; set WORTHWARD_TRAINING_PYTHON to one."
    )


def ensure_training_runtime(backend: str, project_root: Path, argv: list[str]) -> None:
    selected = select_training_python(backend, project_root)
    if Path(selected).resolve() == Path(sys.executable).resolve():
        return
    print(f"Using GPU training runtime: {selected}", flush=True)
    # Replacing this process preserves the manager's PID, arguments, and stop ownership.
    os.execv(selected, [selected, str(project_root / "scripts/lstm_ga_tune.py"), *argv])
