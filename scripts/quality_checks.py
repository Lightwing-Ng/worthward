#!/usr/bin/env python3
"""Execute a selected quality plan under the parent quality lock.

Code version: v1.0.0
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from typing import Sequence

from scripts.quality_plan import QualityPlan, describe_plan, parse_plan


def missing_dependencies(plan: QualityPlan) -> list[str]:
    missing = []
    modules = {name for check in plan.checks for name in check.python_modules}
    executables = {name for check in plan.checks for name in check.executables}
    for name in sorted(modules):
        if importlib.util.find_spec(name) is None:
            missing.append(f"Python module {name} ({sys.executable})")
    for name in sorted(executables):
        if shutil.which(name) is None:
            missing.append(f"executable {name}")
    return missing


def execute_plan(plan: QualityPlan) -> int:
    print(describe_plan(plan, include_commands=plan.list_only), flush=True)
    if plan.list_only:
        return 0
    missing = missing_dependencies(plan)
    if missing:
        print("Missing dependencies for selected checks: " + ", ".join(missing), file=sys.stderr)
        return 1
    try:
        for index, check in enumerate(plan.checks, start=1):
            print(f"[{index}/{len(plan.checks)}] {check.label}", flush=True)
            for command in check.commands:
                completed = subprocess.run(command, cwd=plan.root, check=False)
                if completed.returncode:
                    return completed.returncode
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        print(f"Unable to run selected check: {exc}", file=sys.stderr)
        return 1
    if plan.full:
        print("Full quality gate passed (all tests, forecasting-model integration, and suite-wide coverage).")
    else:
        print(f"Selected checks passed: {', '.join(plan.groups)} (ML: {plan.ml}; no suite-wide coverage).")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    return execute_plan(parse_plan(argv))


if __name__ == "__main__":
    raise SystemExit(main())
