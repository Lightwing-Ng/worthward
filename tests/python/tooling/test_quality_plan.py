"""Behavioral checks for composable, scoped verification plans.

Code version: v1.0.0
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace

import pytest

from scripts import quality_checks, quality_gate
from scripts.quality_plan import (
    DEFAULT_GROUPS,
    GROUP_ORDER,
    Check,
    QualityPlan,
    argument_parser,
    build_plan,
)


@pytest.fixture
def quality_root(tmp_path: Path) -> Path:
    for relative in (
        "tests/python/services/test_first.py",
        "tests/python/services/test_second.py",
        "tests/js/shared/test_first.mjs",
        "tests/js/shared/test_second.mjs",
        "tests/e2e/investment/first.spec.mjs",
        "tests/e2e/investment/second.spec.mjs",
        "app/web/static/assets/js/app.js",
        "app/web/static/assets/js/vendor/ignored.js",
    ):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
    return tmp_path


def make_plan(root: Path, *arguments: str, environment=None) -> QualityPlan:
    options = argument_parser().parse_args(["--root", str(root), *arguments])
    return build_plan(options, python=sys.executable, environment=environment)


def command_for(plan: QualityPlan, group: str) -> tuple[str, ...]:
    return next(check for check in plan.checks if check.group == group).commands[0]


def test_default_plan_excludes_browsers_ml_and_global_coverage(quality_root: Path) -> None:
    plan = make_plan(quality_root)

    assert plan.groups == DEFAULT_GROUPS
    assert plan.ml == "exclude"
    assert plan.full is False
    assert "-m" in command_for(plan, "python")
    assert command_for(plan, "python")[-2:] == ("-m", "not ml")
    assert command_for(plan, "js")[:2] == ("node", "--test")
    assert all(
        "--cov" not in argument and "coverage.json" not in argument
        for check in plan.checks for command in check.commands for argument in command
    )
    assert "pytest_cov" not in {
        name for check in plan.checks for name in check.python_modules
    }


def test_groups_are_composed_deduplicated_and_ordered(quality_root: Path) -> None:
    plan = make_plan(
        quality_root, "--group", "e2e,python", "--group", "python-lint,python"
    )

    assert plan.groups == ("python-lint", "python", "e2e")
    assert "--grep-invert" in command_for(plan, "e2e")
    assert command_for(plan, "e2e")[-1] == r"@ml\b"


def test_full_plan_retains_complete_coverage_and_includes_ml(quality_root: Path) -> None:
    plan = make_plan(
        quality_root, "--full", environment={"WORTHWARD_COVERAGE_MINIMUM": "61"}
    )

    assert plan.groups == GROUP_ORDER
    assert plan.ml == "include"
    assert plan.full is True
    python_command = command_for(plan, "python")
    assert "--cov=app" in python_command
    assert "--cov=strategies" in python_command
    assert "--cov-report=json:coverage.json" in python_command
    assert "--cov-fail-under=61" in python_command
    assert command_for(plan, "js") == (str(quality_root / "scripts/test_js.sh"),)
    assert command_for(plan, "e2e") == (str(quality_root / "scripts/test_e2e.sh"),)
    assert "pytest_cov" in next(
        check for check in plan.checks if check.group == "python"
    ).python_modules


@pytest.mark.parametrize("minimum", ["-1", "101", "1.5", "invalid"])
def test_coverage_floor_is_validated_only_for_full_runs(
    quality_root: Path, minimum: str
) -> None:
    environment = {"WORTHWARD_COVERAGE_MINIMUM": minimum}
    make_plan(quality_root, "--group", "python", environment=environment)
    with pytest.raises(ValueError, match="integer from 0 to 100"):
        make_plan(quality_root, "--full", environment=environment)


@pytest.mark.parametrize("argument", [
    ("--group", "python"),
    ("--python-test", "tests/python/services/test_first.py"),
    ("--js-test", "tests/js/shared"),
    ("--e2e-test", "tests/e2e/investment"),
    ("--python-k", "freshness"),
    ("--e2e-grep", "Holdings"),
    ("--ml", "include"),
])
def test_full_run_rejects_partial_scope(quality_root: Path, argument: tuple[str, str]) -> None:
    with pytest.raises(ValueError, match="--full cannot"):
        make_plan(quality_root, "--full", *argument)


def test_selectors_imply_groups_and_preserve_native_filters(quality_root: Path) -> None:
    plan = make_plan(
        quality_root,
        "--python-test", "tests/python/services/test_first.py",
        "--python-test", "tests/python/services/test_second.py",
        "--python-k", "freshness and not transport",
        "--e2e-test", "tests/e2e/investment/first.spec.mjs",
        "--e2e-grep", "Holdings|Metrics",
    )

    assert plan.groups == ("python", "e2e")
    assert command_for(plan, "python")[4:6] == (
        "tests/python/services/test_first.py", "tests/python/services/test_second.py",
    )
    assert command_for(plan, "python")[-2:] == ("-k", "freshness and not transport")
    assert command_for(plan, "e2e")[1] == "tests/e2e/investment/first.spec.mjs"
    assert command_for(plan, "e2e")[-2:] == ("--grep", "Holdings|Metrics")


def test_js_directory_selectors_discover_only_unit_tests_without_duplicates(quality_root: Path) -> None:
    helper = quality_root / "tests/js/shared/helper.mjs"
    helper.write_text("", encoding="utf-8")
    plan = make_plan(
        quality_root, "--js-test", "tests/js/shared",
        "--js-test", "tests/js/shared/test_first.mjs",
    )

    assert plan.groups == ("js",)
    assert command_for(plan, "js") == (
        "node", "--test", "tests/js/shared/test_first.mjs", "tests/js/shared/test_second.mjs",
    )


@pytest.mark.parametrize("language, directory, child", [
    ("python", "tests/python/services", "tests/python/services/test_first.py"),
    ("e2e", "tests/e2e/investment", "tests/e2e/investment/first.spec.mjs"),
])
@pytest.mark.parametrize("parent_first", [False, True])
def test_overlapping_selectors_run_each_test_once_regardless_of_input_order(
    quality_root: Path, language: str, directory: str, child: str,
    parent_first: bool,
) -> None:
    paths = [directory, child] if parent_first else [child, directory]
    arguments = [argument for path in paths for argument in (f"--{language}-test", path)]
    plan = make_plan(quality_root, *arguments)
    command = command_for(plan, language)

    assert command.count(directory) == 1
    assert child not in command


@pytest.mark.parametrize("language, directory", [
    ("python", "tests/python/services"),
    ("e2e", "tests/e2e/investment"),
])
def test_parent_directory_covers_selected_nested_directories(
    quality_root: Path, language: str, directory: str,
) -> None:
    base = f"tests/{'python' if language == 'python' else 'e2e'}"
    plan = make_plan(
        quality_root, f"--{language}-test", directory,
        f"--{language}-test", base,
    )

    assert base in command_for(plan, language)
    assert directory not in command_for(plan, language)


@pytest.mark.parametrize("arguments, message", [
    (("--group", ""), "Unknown or empty"),
    (("--group", "python,,js"), "Unknown or empty"),
    (("--group", "unknown"), "Unknown or empty"),
    (("--group", "js", "--python-test", "tests/python/services"), "explicitly selected"),
    (("--python-test", "missing.py"), "inside tests/python"),
    (("--python-test", "tests/python/missing.py"), "No matching"),
    (("--python-test", "tests/js/shared/test_first.mjs"), "inside tests/python"),
    (("--e2e-test", "tests/e2e/investment/helper.mjs"), "No matching"),
    (("--python-k", ""), "cannot be empty"),
    (("--e2e-grep", " "), "cannot be empty"),
    (("--group", "js", "--ml", "only"), "no ML classification"),
    (("--group", "python-lint", "--ml", "only"), "requires Python"),
])
def test_invalid_or_contradictory_selection_fails_explicitly(
    quality_root: Path, arguments: tuple[str, ...], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        make_plan(quality_root, *arguments)


def test_empty_test_directory_does_not_fall_back_to_the_full_suite(quality_root: Path) -> None:
    empty = quality_root / "tests/python/empty"
    empty.mkdir()
    with pytest.raises(ValueError, match="No python tests matched"):
        make_plan(quality_root, "--python-test", "tests/python/empty")


def test_selector_cannot_escape_its_test_root_through_symlink(quality_root: Path) -> None:
    outside = quality_root / "test_outside.py"
    outside.write_text("", encoding="utf-8")
    link = quality_root / "tests/python/test_link.py"
    link.symlink_to(outside)
    with pytest.raises(ValueError, match="inside tests/python"):
        make_plan(quality_root, "--python-test", "tests/python/test_link.py")


def test_ml_only_combines_with_python_and_browser_name_filters(quality_root: Path) -> None:
    plan = make_plan(
        quality_root, "--group", "python,e2e", "--ml", "only",
        "--python-k", "model", "--e2e-grep", "model|training",
    )

    assert command_for(plan, "python")[-4:] == ("-m", "ml", "-k", "model")
    pattern = command_for(plan, "e2e")[-1]
    assert re.search(pattern, "chromium model renders @ml")
    assert re.search(pattern, "chromium training @ml")
    assert re.search(pattern, "chromium model renders") is None
    assert re.search(pattern, "chromium metrics @ml") is None


def test_ml_include_has_no_exclusion_filters(quality_root: Path) -> None:
    plan = make_plan(quality_root, "--group", "python,e2e", "--ml", "include")

    assert command_for(plan, "python") == (
        sys.executable, "-m", "pytest", "-q", "tests/python",
    )
    assert command_for(plan, "e2e") == (str(quality_root / "scripts/test_e2e.sh"),)


def test_syntax_plan_excludes_vendor_files(quality_root: Path) -> None:
    plan = make_plan(quality_root, "--group", "js-syntax")

    commands = plan.checks[0].commands
    assert commands
    assert all(command[:2] == ("node", "--check") for command in commands)
    assert all("vendor" not in command[-1] for command in commands)


def test_python_only_checks_never_probe_unselected_dependencies(
    quality_root: Path, monkeypatch
) -> None:
    plan = make_plan(quality_root, "--group", "python")
    probed = []

    def find_spec(name):
        probed.append(name)
        assert name == "pytest"
        return object()

    monkeypatch.setattr(quality_checks.importlib.util, "find_spec", find_spec)
    monkeypatch.setattr(
        quality_checks.shutil, "which",
        lambda name: pytest.fail(f"Unselected executable dependency checked: {name}"),
    )
    monkeypatch.setattr(
        quality_checks.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=0),
    )

    assert quality_checks.execute_plan(plan) == 0
    assert probed == ["pytest"]


def test_list_plan_never_locks_checks_dependencies_or_executes(
    quality_root: Path, monkeypatch, capsys
) -> None:
    monkeypatch.setattr(quality_gate, "run", lambda *args: pytest.fail("List acquired a lock"))
    monkeypatch.setattr(
        quality_checks, "missing_dependencies", lambda *args: pytest.fail("List checked dependencies"),
    )
    monkeypatch.setattr(
        quality_checks.subprocess, "run", lambda *args, **kwargs: pytest.fail("List ran a process"),
    )
    arguments = ["--root", str(quality_root), "--group", "python", "--dry-run"]

    assert quality_gate.main(arguments) == 0
    assert quality_checks.execute_plan(make_plan(quality_root, "--group", "python", "--list")) == 0
    output = capsys.readouterr().out
    assert "Groups: python" in output
    assert "pytest -q tests/python -m 'not ml'" in output
    assert "Suite-wide coverage: disabled; existing reports preserved" in output


def test_missing_selected_dependency_fails_before_execution(
    quality_root: Path, monkeypatch, capsys
) -> None:
    plan = make_plan(quality_root, "--group", "python")
    monkeypatch.setattr(quality_checks.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(
        quality_checks.subprocess, "run", lambda *args, **kwargs: pytest.fail("Missing dependency ran"),
    )

    assert quality_checks.execute_plan(plan) == 1
    assert "Python module pytest" in capsys.readouterr().err


@pytest.mark.parametrize("returncode", [7, 73])
def test_execution_stops_after_failure_and_preserves_global_report(
    quality_root: Path, monkeypatch, returncode: int
) -> None:
    report = quality_root / "coverage.json"
    report.write_bytes(b"previous complete coverage report")
    first = (sys.executable, "-c", f"raise SystemExit({returncode})")
    later = (sys.executable, "-c", "from pathlib import Path; Path('coverage.json').write_text('overwritten')")
    plan = QualityPlan(
        quality_root,
        (Check("python", "Failure probe", (first,)), Check("js", "Must not run", (later,))),
        "exclude", False, False,
    )
    monkeypatch.setattr(quality_checks, "missing_dependencies", lambda plan: [])

    assert quality_checks.execute_plan(plan) == returncode
    assert report.read_bytes() == b"previous complete coverage report"


def test_gate_forwards_exact_selection_and_child_status(quality_root: Path, monkeypatch) -> None:
    observed = []

    def run(root, command):
        observed.append((root, command))
        return 73

    monkeypatch.setattr(quality_gate, "run", run)
    arguments = ["--root", str(quality_root), "--python-test", "tests/python/services"]

    assert quality_gate.main(arguments) == 73
    assert observed == [(
        quality_root, [sys.executable, "-m", "scripts.quality_checks", *arguments],
    )]


def test_completion_text_distinguishes_selected_checks_from_full_gate(
    quality_root: Path, monkeypatch, capsys
) -> None:
    monkeypatch.setattr(quality_checks, "missing_dependencies", lambda plan: [])
    monkeypatch.setattr(
        quality_checks.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=0),
    )
    selected = make_plan(quality_root, "--group", "python")

    assert quality_checks.execute_plan(selected) == 0
    output = capsys.readouterr().out
    assert "Selected checks passed" in output
    assert "Full quality gate passed" not in output
    assert "pytest -q" not in output
    assert quality_checks.execute_plan(replace(selected, full=True, ml="include")) == 0
    assert "Full quality gate passed" in capsys.readouterr().out


def test_shell_launcher_forwards_selection_without_running_other_groups() -> None:
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [str(root / "scripts/check.sh"), "--group", "python", "--list"],
        cwd=root, capture_output=True, text=True, check=False, timeout=15,
    )

    assert result.returncode == 0, result.stderr
    assert "Groups: python" in result.stdout
    assert "Browser end-to-end tests" not in result.stdout
    assert "--cov=" not in result.stdout
