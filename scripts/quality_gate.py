#!/usr/bin/env python3
"""Serialize composable quality checks and complete coverage runs.

Code version: v1.1.0
"""

from __future__ import annotations

import fcntl
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Sequence

from scripts.quality_plan import describe_plan, parse_plan


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


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if sys.version_info[:2] < (3, 13):
        print("Python 3.13 or newer is required.", file=sys.stderr)
        return 1
    plan = parse_plan(arguments)
    if plan.list_only:
        print(describe_plan(plan))
        return 0
    return run(plan.root, [sys.executable, "-m", "scripts.quality_checks", *arguments])


if __name__ == "__main__":
    raise SystemExit(main())
