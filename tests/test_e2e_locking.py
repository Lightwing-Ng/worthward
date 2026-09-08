"""Regression coverage for exclusive Playwright runtime ownership."""

# Code version: v1.1.0

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

from scripts.e2e_lock import E2E_PORT, e2e_lock_path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _wait_for(path: Path, *, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        time.sleep(0.02)
    raise AssertionError(f"Timed out waiting for {path}")


def _copy_e2e_launchers(tmp_path: Path, directory_name: str) -> Path:
    sandbox_root = tmp_path / directory_name
    scripts_root = sandbox_root / "scripts"
    scripts_root.mkdir(parents=True)
    for relative_path in (
        "scripts/e2e_lock.py",
        "scripts/resolve_python.sh",
        "scripts/run_e2e_app.sh",
        "scripts/test_e2e.sh",
    ):
        source = PROJECT_ROOT / relative_path
        destination = sandbox_root / relative_path
        shutil.copy2(source, destination)
        destination.chmod(0o755)
    return sandbox_root


def _fake_npx(fake_bin: Path) -> None:
    fake_bin.mkdir()
    executable = fake_bin / "npx"
    executable.write_text(
        """#!/usr/bin/env bash
printf '%s\\n' "$$" >> "$FAKE_NPX_CALLS"
: > "$FAKE_NPX_STARTED"
while [[ ! -e "$FAKE_NPX_RELEASE" ]]; do
\tsleep 0.02
done
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)


def test_concurrent_e2e_launchers_cannot_clean_the_active_runtime(tmp_path: Path) -> None:
    sandbox_root = _copy_e2e_launchers(tmp_path, "repository-one")
    other_root = _copy_e2e_launchers(tmp_path, "repository-two")
    runtime_root = sandbox_root / "test-results" / "runtime-store"
    runtime_root.mkdir(parents=True)
    active_marker = runtime_root / "active-owner"
    active_marker.write_text("owned", encoding="utf-8")
    other_runtime_root = other_root / "test-results" / "runtime-store"
    other_runtime_root.mkdir(parents=True)
    other_marker = other_runtime_root / "other-owner"
    other_marker.write_text("preserved", encoding="utf-8")

    fake_bin = tmp_path / "bin"
    _fake_npx(fake_bin)
    started = tmp_path / "npx-started"
    release = tmp_path / "npx-release"
    calls = tmp_path / "npx-calls"
    environment = os.environ.copy()
    environment.update(
        {
            "WORTHWARD_PYTHON": sys.executable,
            "FAKE_NPX_CALLS": str(calls),
            "FAKE_NPX_RELEASE": str(release),
            "FAKE_NPX_STARTED": str(started),
            "PATH": f"{fake_bin}{os.pathsep}{environment['PATH']}",
            "WORTHWARD_E2E_LOCK_FILE_OVERRIDE": str(tmp_path / "host.lock"),
        }
    )

    first = subprocess.Popen(
        [str(sandbox_root / "scripts/test_e2e.sh")],
        cwd=sandbox_root,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        _wait_for(started)

        second = subprocess.run(
            [str(other_root / "scripts/test_e2e.sh")],
            cwd=other_root,
            env=environment,
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
        direct_server = subprocess.run(
            [str(other_root / "scripts/run_e2e_app.sh")],
            cwd=other_root,
            env=environment,
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )

        assert second.returncode == 73
        assert direct_server.returncode == 73
        assert "E2E suite is already running" in second.stderr
        assert "No E2E files were changed" in second.stderr
        assert active_marker.read_text(encoding="utf-8") == "owned"
        assert other_marker.read_text(encoding="utf-8") == "preserved"
        assert len(calls.read_text(encoding="utf-8").splitlines()) == 1
    finally:
        release.touch()
        stdout, stderr = first.communicate(timeout=15)
        assert first.returncode == 0, f"stdout={stdout}\nstderr={stderr}"

    assert not runtime_root.exists()

    third = subprocess.run(
        [str(other_root / "scripts/test_e2e.sh")],
        cwd=other_root,
        env=environment,
        capture_output=True,
        check=False,
        text=True,
        timeout=15,
    )
    assert third.returncode == 0
    assert len(calls.read_text(encoding="utf-8").splitlines()) == 2
    assert not other_runtime_root.exists()


@pytest.mark.parametrize("inherited_compute_root", [False, True])
def test_app_launcher_isolates_training_state_and_cleans_only_its_runtime(
    tmp_path: Path,
    inherited_compute_root: bool,
) -> None:
    sandbox_root = _copy_e2e_launchers(tmp_path, "repository")
    runtime_root = sandbox_root / "test-results/runtime-store"
    protected_root = tmp_path / "user-compute-jobs"
    protected_root.mkdir()
    protected_marker = protected_root / "preserved"
    protected_marker.write_bytes(b"existing user research must remain unchanged")
    observed = tmp_path / "observed.jsonl"
    logo = sandbox_root / "market_store/logos/TEST.svg"
    logo.parent.mkdir(parents=True)
    logo.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
    for command in (["git", "init", "-q"], ["git", "add", "market_store/logos/TEST.svg"]):
        subprocess.run(command, cwd=sandbox_root, check=True, capture_output=True, timeout=10)

    probe = '''import json, os
from pathlib import Path
names = ("WORTHWARD_MARKET_STORE_DIR", "WORTHWARD_SETTINGS_STORE_DIR", "WORTHWARD_COMPUTE_ROOT")
state = {name: os.environ.get(name) for name in names}
state["program"] = Path(__file__).name
state["remote_access"] = os.environ.get("WORTHWARD_REMOTE_MARKET_ACCESS")
state["port"] = os.environ.get("WORTHWARD_PORT")
with Path(os.environ["E2E_TEST_OBSERVED"]).open("a") as stream:
    stream.write(json.dumps(state) + "\\n")
root = Path(os.environ["WORTHWARD_COMPUTE_ROOT"])
root.mkdir(parents=True, exist_ok=True)
(root / "isolated-training-record").write_text("test-owned")
'''
    (sandbox_root / "main.py").write_text(probe, encoding="utf-8")
    (sandbox_root / "scripts/seed_e2e_market_store.py").write_text(probe, encoding="utf-8")
    environment = {
        **os.environ,
        "WORTHWARD_PYTHON": sys.executable,
        "WORTHWARD_E2E_LOCK_FILE_OVERRIDE": str(tmp_path / "host.lock"),
        "E2E_TEST_OBSERVED": str(observed),
    }
    for name in ("WORTHWARD_E2E_LOCK_TOKEN", "ANTIGRAVITY_E2E_LOCK_TOKEN", "WORTHWARD_COMPUTE_ROOT"):
        environment.pop(name, None)
    if inherited_compute_root:
        environment["WORTHWARD_COMPUTE_ROOT"] = str(protected_root)
    completed = subprocess.run(
        [str(sandbox_root / "scripts/run_e2e_app.sh")],
        cwd=sandbox_root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    records = [json.loads(line) for line in observed.read_text(encoding="utf-8").splitlines()]
    assert [record["program"] for record in records] == ["seed_e2e_market_store.py", "main.py"]
    for record in records:
        assert record["WORTHWARD_COMPUTE_ROOT"] == str(runtime_root / "compute-jobs")
        assert record["WORTHWARD_MARKET_STORE_DIR"] == str(runtime_root / "market_store")
        assert record["WORTHWARD_SETTINGS_STORE_DIR"] == str(runtime_root / "settings_store")
        assert record["remote_access"] == "disabled"
        assert record["port"] == "8699"
    assert not runtime_root.exists()
    assert list(protected_root.iterdir()) == [protected_marker]
    assert protected_marker.read_bytes() == b"existing user research must remain unchanged"


def test_default_lock_is_shared_across_repository_roots(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.delenv("WORTHWARD_E2E_LOCK_FILE_OVERRIDE", raising=False)

    first_path = e2e_lock_path(tmp_path / "repository-one")
    second_path = e2e_lock_path(tmp_path / "repository-two")

    assert first_path == second_path
    assert first_path.name.endswith(f"port-{E2E_PORT}.lock")


def test_playwright_config_requires_the_exclusive_launcher() -> None:
    source = (PROJECT_ROOT / "playwright.config.mjs").read_text(encoding="utf-8")

    assert "requireE2ELock();" in source
    assert "reuseExistingServer: false" in source

    environment = os.environ.copy()
    for variable in (
        "WORTHWARD_E2E_LOCK_FILE",
        "WORTHWARD_E2E_LOCK_ROOT",
        "WORTHWARD_E2E_LOCK_TOKEN",
    ):
        environment.pop(variable, None)
    imported = subprocess.run(
        ["node", "-e", "import('./playwright.config.mjs')"],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        check=False,
        text=True,
        timeout=5,
    )

    assert imported.returncode != 0
    assert "Playwright must run through ./scripts/test_e2e.sh" in imported.stderr
