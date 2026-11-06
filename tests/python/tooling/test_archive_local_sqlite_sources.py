"""Keep rollback originals recoverable and refuse ambiguous archive operations.

Code version: v1.0.1
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core import object_sqlite
from scripts import archive_local_sqlite_sources as archiver
from scripts.migrate_local_sqlite import migrate_one


@pytest.fixture
def archive_entry(tmp_path, monkeypatch):
    source = tmp_path / "settings/unknown.json"
    source.parent.mkdir()
    source.write_text('{"unknown":[null,"0001.2300",false]}\n')
    entry = migrate_one(source, source.with_suffix(".sqlite3"), "object", apply=True, scratch=tmp_path)
    monkeypatch.setattr(archiver.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stdout=""))
    return entry, source, tmp_path / "archive-receipt.json"


def test_archive_keeps_exact_source_bytes_and_active_sqlite_unchanged(archive_entry):
    entry, source, receipt_path = archive_entry
    original = source.read_bytes()
    target = Path(entry["target"])
    sqlite_bytes = target.read_bytes()
    receipt = archiver.archive_sources([entry], [source.parent], receipt_path, apply=True)
    assert receipt["complete"] and receipt["applied"]
    assert not source.exists()
    assert Path(receipt["files"][0]["archive"]).read_bytes() == original
    assert target.read_bytes() == sqlite_bytes
    assert object_sqlite.read_object(target) == {"unknown": [None, "0001.2300", False]}
    assert json.loads(receipt_path.read_text()) == receipt


def test_archive_preview_leaves_original_and_target_in_place(archive_entry):
    entry, source, receipt_path = archive_entry
    original = source.read_bytes()
    receipt = archiver.archive_sources([entry], [source.parent], receipt_path, apply=False)
    assert receipt["complete"] and not receipt["applied"]
    assert source.read_bytes() == original
    assert not Path(receipt["files"][0]["archive"]).exists()


def test_recovery_receipt_directory_must_sync_before_source_moves(archive_entry, monkeypatch):
    entry, source, receipt_path = archive_entry
    original = source.read_bytes()
    target = Path(entry["target"])
    sqlite_bytes = target.read_bytes()

    def fail_receipt_directory_sync(path):
        assert path == receipt_path.parent
        assert receipt_path.is_file()
        assert source.read_bytes() == original
        raise OSError("Recovery receipt directory could not be synchronized")

    monkeypatch.setattr(object_sqlite, "_fsync_directory", fail_receipt_directory_sync)
    with pytest.raises(OSError, match="Recovery receipt directory"):
        archiver.archive_sources([entry], [source.parent], receipt_path, apply=True)

    assert source.read_bytes() == original
    assert target.read_bytes() == sqlite_bytes
    assert not Path(json.loads(receipt_path.read_text())["files"][0]["archive"]).exists()


@pytest.mark.parametrize("changed", ["source", "target"])
def test_changed_source_or_newer_target_blocks_all_archive_moves(archive_entry, changed):
    entry, source, receipt_path = archive_entry
    if changed == "source":
        source.write_text('{"changed":"retain this independent source"}')
    else:
        object_sqlite.write_object(Path(entry["target"]), {"changed": "newer SQLite state"})
    with pytest.raises(RuntimeError, match="changed"):
        archiver.archive_sources([entry], [source.parent], receipt_path, apply=True)
    assert source.exists()
    assert not receipt_path.exists()


def test_active_owner_blocks_archiving_without_terminating_it(archive_entry, monkeypatch):
    entry, source, receipt_path = archive_entry
    monkeypatch.setattr(archiver.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout="12345\n"))
    with pytest.raises(RuntimeError, match="active process"):
        archiver.archive_sources([entry], [source.parent], receipt_path, apply=True)
    assert source.exists()


def test_archive_refuses_existing_receipt_and_outside_or_symlinked_sources(archive_entry, tmp_path):
    entry, source, receipt_path = archive_entry
    receipt_path.write_text("Retain previous evidence.")
    with pytest.raises(FileExistsError):
        archiver.archive_sources([entry], [source.parent], receipt_path, apply=True)
    with pytest.raises(ValueError, match="outside"):
        archiver.archive_sources([entry], [tmp_path / "unrelated"], tmp_path / "outside.json", apply=True)
    alias = source.with_name("alias.json")
    alias.symlink_to(source)
    with pytest.raises(ValueError, match="ordinary"):
        archiver.archive_sources([{**entry, "source": str(alias)}], [source.parent], tmp_path / "symlink.json", apply=True)
    assert source.exists()
