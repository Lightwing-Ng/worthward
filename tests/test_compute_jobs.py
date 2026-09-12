"""Tests for side-effect-isolated compute-job primitives.

Code version: v1.1.0
"""

from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from app.infrastructure.compute_jobs import (
    _prepare_windows_lock_byte,
    assign_daily_run_identifiers,
    compute_workspace_lock,
    matching_run_directories,
    project_compute_workspace_root,
    read_json_object,
    write_json_atomic,
)


def test_project_workspace_root_is_stable_and_scoped(tmp_path: Path) -> None:
    state_root = tmp_path / "compute"
    project_root = tmp_path / "project"
    project_root.mkdir()

    first = project_compute_workspace_root(state_root, project_root, "price-field")
    second = project_compute_workspace_root(state_root, project_root / ".", "price-field")

    assert first == second
    assert first.parent.parent == state_root
    assert first.name == "price-field"


def test_atomic_json_write_rejects_non_finite_values_without_replacing_state(
        tmp_path: Path,
) -> None:
    path = tmp_path / "status.json"
    write_json_atomic(path, {"status": "running", "generation": 3})
    original = path.read_bytes()

    with pytest.raises(ValueError):
        write_json_atomic(path, {"score": float("nan")})

    assert path.read_bytes() == original
    assert read_json_object(path) == {"generation": 3, "status": "running"}
    assert list(tmp_path.glob(".*.tmp")) == []


def test_windows_lock_sentinel_initialization_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "workspace.lock"

    for _ in range(2):
        with path.open("a+b") as handle:
            _prepare_windows_lock_byte(handle)

    assert path.read_bytes() == b"\0"


def test_compute_workspace_lock_rejects_a_symlink(tmp_path: Path) -> None:
    target = tmp_path / "target.lock"
    target.touch()
    link = tmp_path / "workspace.lock"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("This platform cannot create test symlinks.")

    with pytest.raises(ValueError, match="Invalid compute workspace lock path"):
        with compute_workspace_lock(link):
            pass


def test_json_reader_fails_closed_for_non_objects_and_symlinks(tmp_path: Path) -> None:
    malformed = tmp_path / "malformed.json"
    malformed.write_text("{", encoding="utf-8")
    sequence = tmp_path / "sequence.json"
    sequence.write_text(json.dumps([1, 2]), encoding="utf-8")
    target = tmp_path / "target.json"
    target.write_text('{"status": "completed"}', encoding="utf-8")
    link = tmp_path / "linked.json"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("This platform cannot create test symlinks.")

    assert read_json_object(malformed) == {}
    assert read_json_object(sequence) == {}
    assert read_json_object(link) == {}


def test_run_directory_listing_and_daily_identifiers_share_one_contract(
        tmp_path: Path,
) -> None:
    pattern = re.compile(r"^run-[a-f0-9]{4}$")
    current_path = tmp_path / "run-ab12"
    current_path.mkdir()
    (tmp_path / "unrelated").mkdir()
    (tmp_path / "run-file").write_text("not a directory", encoding="utf-8")

    assert matching_run_directories(tmp_path, pattern) == [current_path]

    archived = [{"id": "old", "ticker": "NVDA", "started_at": "2026-09-04T00:00:00Z"}]
    current = [{"id": "new", "ticker": "NVDA", "started_at": "2026-09-04T01:00:00Z"}]
    assign_daily_run_identifiers(current, archived, group_fields=("ticker",))

    assert archived[0]["identifier"] == "260904(01)"
    assert current[0]["identifier"] == "260904(02)"
