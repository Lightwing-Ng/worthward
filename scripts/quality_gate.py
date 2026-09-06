#!/usr/bin/env python3
"""Serialize quality runs before they can overwrite shared reports.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile


def run(root: Path, command: list[str]) -> int:
    """Hold a repository-scoped advisory lock until the child exits."""
    key = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:24]
    lock_path = Path(tempfile.gettempdir()) / f"worthward-quality-{key}.lock"
    with lock_path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(
                "Quality gate already running for this checkout; reports preserved.",
                file=sys.stderr,
            )
            return 73
        try:
            return subprocess.run(
                command, cwd=root, check=False, pass_fds=(handle.fileno(),)
            ).returncode
        except KeyboardInterrupt:
            return 130


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    if sys.version_info[:2] < (3, 13):
        parser.error("Python 3.13 or newer is required.")
    missing = [
        name
        for name in ("ruff", "pytest", "pytest_cov")
        if importlib.util.find_spec(name) is None
    ]
    if missing:
        print(
            f"Missing quality dependencies in {sys.executable}: {', '.join(missing)}. "
            "Run ./scripts/setup_python.sh with the same WORTHWARD_PYTHON, "
            "or select an already prepared interpreter.",
            file=sys.stderr,
        )
        return 1
    return run(args.root, [str(args.root / "scripts/check_steps.sh")])


if __name__ == "__main__":
    raise SystemExit(main())
