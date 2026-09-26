"""Behavioral checks for hierarchical JavaScript test discovery.

Code version: v1.0.0
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_discovery(
    tmp_path: Path,
    filenames: tuple[str, ...],
) -> tuple[subprocess.CompletedProcess, Path]:
    """Run the real wrapper with a temporary test tree and recording Node double."""
    sandbox_root = tmp_path / "repository"
    scripts_root = sandbox_root / "scripts"
    scripts_root.mkdir(parents=True)
    shutil.copy2(PROJECT_ROOT / "scripts/test_js.sh", scripts_root / "test_js.sh")
    (sandbox_root / "tests/js").mkdir(parents=True)
    for filename in filenames:
        path = sandbox_root / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    node = fake_bin / "node"
    node.write_text(
        f"#!{sys.executable}\n"
        "import json, os, pathlib, sys\n"
        "if '--test' in sys.argv:\n"
        "    pathlib.Path(os.environ['DISCOVERY_ARGUMENTS']).write_text(json.dumps(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    node.chmod(0o755)
    recorded_arguments = tmp_path / "arguments.json"
    environment = os.environ.copy()
    environment.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{environment['PATH']}",
            "DISCOVERY_ARGUMENTS": str(recorded_arguments),
            "WORTHWARD_JS_COVERAGE_LINES_MINIMUM": "40",
            "WORTHWARD_JS_COVERAGE_BRANCHES_MINIMUM": "60",
            "WORTHWARD_JS_COVERAGE_FUNCTIONS_MINIMUM": "65",
        }
    )
    completed = subprocess.run(
        ["bash", str(scripts_root / "test_js.sh")],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    return completed, recorded_arguments


def test_javascript_runner_discovers_nested_tests_in_stable_order(tmp_path: Path) -> None:
    completed, recorded_arguments = _run_discovery(
        tmp_path,
        (
            "tests/js/zeta/deeper/test_second.mjs",
            "tests/js/alpha/test_first.mjs",
            "tests/js/alpha with spaces/test_middle.mjs",
            "tests/js/alpha/helper.mjs",
            "tests/js/alpha/test_python.py",
            "tests/e2e/test_browser.mjs",
            "tests/support/test_helper.mjs",
        ),
    )

    assert completed.returncode == 0, completed.stderr
    arguments = json.loads(recorded_arguments.read_text(encoding="utf-8"))
    assert [argument for argument in arguments if argument.startswith("tests/")] == [
        "tests/js/alpha with spaces/test_middle.mjs",
        "tests/js/alpha/test_first.mjs",
        "tests/js/zeta/deeper/test_second.mjs",
    ]
    assert "--test-coverage-lines=40" in arguments
    assert "--test-coverage-branches=60" in arguments
    assert "--test-coverage-functions=65" in arguments


def test_javascript_runner_rejects_an_empty_unit_test_tree(tmp_path: Path) -> None:
    completed, recorded_arguments = _run_discovery(
        tmp_path,
        ("tests/js/shared/helper.mjs", "tests/e2e/test_browser.mjs"),
    )

    assert completed.returncode == 1
    assert "No JavaScript unit test files were found under tests/js." in completed.stderr
    assert not recorded_arguments.exists()
