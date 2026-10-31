#!/usr/bin/env python3
"""Plan composable checks without importing their optional dependencies.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import shlex
import sys
from typing import Mapping, Sequence


GROUP_ORDER = ("python-lint", "js-syntax", "python", "js", "e2e")
DEFAULT_GROUPS = GROUP_ORDER[:-1]
TEST_ROOTS = {"python": "tests/python", "js": "tests/js", "e2e": "tests/e2e"}
TEST_PATTERNS = {"python": "test_*.py", "js": "test_*.mjs", "e2e": "*.spec.mjs"}


@dataclass(frozen=True)
class Check:
    group: str
    label: str
    commands: tuple[tuple[str, ...], ...]
    python_modules: tuple[str, ...] = ()
    executables: tuple[str, ...] = ()


@dataclass(frozen=True)
class QualityPlan:
    root: Path
    checks: tuple[Check, ...]
    ml: str
    full: bool
    list_only: bool

    @property
    def groups(self) -> tuple[str, ...]:
        return tuple(check.group for check in self.checks)


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--group", action="append", default=[], metavar="GROUP",
        help="Select a group; repeat or use commas: " + ", ".join(GROUP_ORDER),
    )
    for language in TEST_ROOTS:
        parser.add_argument(
            f"--{language}-test", action="append", default=[], metavar="PATH",
            help=f"Select a {language} test file or directory; repeat to combine.",
        )
    parser.add_argument("--python-k", help="Filter selected Python tests with pytest -k.")
    parser.add_argument("--e2e-grep", help="Filter selected browser tests with Playwright --grep.")
    parser.add_argument(
        "--ml", choices=("exclude", "include", "only"), default=None,
        help="Filter tagged local forecasting-model integration tests (ml/@ml); default: exclude.",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Run every group, all forecasting-model integration tests, and suite-wide coverage checks.",
    )
    parser.add_argument(
        "--list", "--dry-run", dest="list_only", action="store_true",
        help="Print the selected scope and commands without running checks.",
    )
    return parser


def _selected_groups(options: argparse.Namespace) -> tuple[str, ...]:
    explicit: set[str] = set()
    for raw in options.group:
        for value in raw.split(","):
            group = value.strip()
            if group not in GROUP_ORDER:
                raise ValueError(f"Unknown or empty check group: {group!r}.")
            explicit.add(group)
    implied = {
        language for language in TEST_ROOTS if getattr(options, f"{language}_test")
    }
    if options.python_k is not None:
        implied.add("python")
    if options.e2e_grep is not None:
        implied.add("e2e")
    if explicit and not implied.issubset(explicit):
        missing = ", ".join(sorted(implied - explicit))
        raise ValueError(f"Test selectors require their explicitly selected group: {missing}.")
    selected = (
        set(GROUP_ORDER) if options.full else explicit or implied or set(DEFAULT_GROUPS)
    )
    return tuple(group for group in GROUP_ORDER if group in selected)


def _test_paths(root: Path, language: str, selectors: Sequence[str]) -> tuple[str, ...]:
    base = (root / TEST_ROOTS[language]).resolve()
    pattern = TEST_PATTERNS[language]
    selected: set[Path] = set()
    for raw in selectors or [str(base)]:
        path = Path(raw)
        path = (root / path).resolve() if not path.is_absolute() else path.resolve()
        if not path.is_relative_to(base):
            raise ValueError(f"{language} test path must be inside {TEST_ROOTS[language]}: {raw}")
        if path.is_dir():
            matches = sorted(path.rglob(pattern))
        elif path.is_file() and path.match(pattern):
            matches = [path]
        else:
            raise ValueError(f"No matching {language} test file or directory: {raw}")
        matches = [match for match in matches if match.is_file()]
        if not matches:
            raise ValueError(f"No {language} tests matched: {raw}")
        if any(not match.resolve().is_relative_to(base) for match in matches):
            raise ValueError(
                f"{language} test selector contains a path outside its test root: {raw}"
            )
        if language == "js":
            selected.update(match.resolve() for match in matches)
        else:
            selected.add(path)
    normalized: list[Path] = []
    for path in sorted(selected):
        if language != "js" and any(
            parent.is_dir() and path.is_relative_to(parent) for parent in normalized
        ):
            continue
        normalized.append(path)
    return tuple(path.relative_to(root).as_posix() for path in normalized)


def _javascript_sources(root: Path) -> tuple[str, ...]:
    sources = {
        path.relative_to(root).as_posix()
        for directory in (root / "app/web/static/assets/js", root / "tests")
        for path in directory.rglob("*")
        if path.is_file() and path.suffix in {".js", ".mjs"}
        and "vendor" not in path.relative_to(root).parts
    }
    if not sources:
        raise ValueError("No first-party JavaScript files were found for syntax checks.")
    return tuple(sorted(sources))


def build_plan(
    options: argparse.Namespace,
    *,
    python: str = sys.executable,
    environment: Mapping[str, str] | None = None,
) -> QualityPlan:
    root = options.root.resolve()
    if not root.is_dir():
        raise ValueError(f"Repository root is not a directory: {root}")
    has_selectors = any(getattr(options, f"{language}_test") for language in TEST_ROOTS)
    if options.full and (
        options.group or has_selectors or options.ml is not None
        or options.python_k is not None or options.e2e_grep is not None
    ):
        raise ValueError("--full cannot be combined with groups, test selectors, or filters.")
    for name in ("python_k", "e2e_grep"):
        value = getattr(options, name)
        if value is not None and not value.strip():
            raise ValueError(f"--{name.replace('_', '-')} cannot be empty.")
    groups = _selected_groups(options)
    ml = "include" if options.full else options.ml or "exclude"
    if ml == "only" and ("js" in groups or not {"python", "e2e"}.intersection(groups)):
        raise ValueError(
            "--ml only requires Python and/or browser test groups; "
            "JavaScript unit tests have no ML classification."
        )
    checks: list[Check] = []
    if "python-lint" in groups:
        checks.append(Check(
            "python-lint", "Python static checks",
            ((python, "-m", "ruff", "check", "main.py", "app", "strategies", "tests", "scripts"),),
            python_modules=("ruff",),
        ))
    if "js-syntax" in groups:
        checks.append(Check(
            "js-syntax", "JavaScript syntax checks",
            tuple(("node", "--check", path) for path in _javascript_sources(root)),
            executables=("node",),
        ))
    if "python" in groups:
        paths = _test_paths(root, "python", options.python_test)
        command = [python, "-m", "pytest", "-q"]
        modules = ("pytest",)
        if options.full:
            env = os.environ if environment is None else environment
            minimum = (
                env.get("WORTHWARD_COVERAGE_MINIMUM")
                or env.get("ANTIGRAVITY_COVERAGE_MINIMUM")
                or "50"
            )
            if re.fullmatch(r"[0-9]+", minimum) is None or not 0 <= int(minimum) <= 100:
                raise ValueError("WORTHWARD_COVERAGE_MINIMUM must be an integer from 0 to 100.")
            command.extend((
                "--cov=app", "--cov=strategies", "--cov-report=term-missing",
                "--cov-report=json:coverage.json", f"--cov-fail-under={minimum}",
            ))
            modules = ("pytest", "pytest_cov")
        else:
            command.extend(paths)
            if ml != "include":
                command.extend(("-m", "ml" if ml == "only" else "not ml"))
            if options.python_k:
                command.extend(("-k", options.python_k))
        checks.append(Check("python", "Python tests", (tuple(command),), python_modules=modules))
    if "js" in groups:
        paths = _test_paths(root, "js", options.js_test)
        if options.full:
            command = (str(root / "scripts/test_js.sh"),)
        else:
            command = ("node", "--test", *paths)
        checks.append(Check("js", "JavaScript unit tests", (command,), executables=("node",)))
    if "e2e" in groups:
        paths = _test_paths(root, "e2e", options.e2e_test)
        command = [str(root / "scripts/test_e2e.sh")]
        if options.e2e_test:
            command.extend(paths)
        if ml == "exclude":
            command.extend(("--grep-invert", r"@ml\b"))
        if options.e2e_grep and ml == "only":
            command.extend(("--grep", rf"^(?=.*@ml\b)(?=.*(?:{options.e2e_grep})).*$"))
        elif options.e2e_grep:
            command.extend(("--grep", options.e2e_grep))
        elif ml == "only":
            command.extend(("--grep", r"@ml\b"))
        checks.append(Check(
            "e2e", "Browser end-to-end tests", (tuple(command),),
            executables=("node", "npx"),
        ))
    return QualityPlan(root, tuple(checks), ml, options.full, options.list_only)


def parse_plan(
    argv: Sequence[str] | None = None,
    *,
    python: str = sys.executable,
    environment: Mapping[str, str] | None = None,
) -> QualityPlan:
    parser = argument_parser()
    options = parser.parse_args(argv)
    try:
        return build_plan(options, python=python, environment=environment)
    except ValueError as exc:
        parser.error(str(exc))


def describe_plan(plan: QualityPlan, *, include_commands: bool = True) -> str:
    scope = "full quality gate" if plan.full else "selected checks"
    lines = [
        f"Scope: {scope}",
        f"Groups: {', '.join(plan.groups)}",
        f"Tagged forecasting-model integration: {plan.ml}",
        "Suite-wide coverage: " + ("enabled" if plan.full else "disabled; existing reports preserved"),
    ]
    for check in plan.checks:
        lines.append(f"[{check.group}] {check.label}")
        if include_commands:
            lines.extend("  " + shlex.join(command) for command in check.commands)
    return "\n".join(lines)
