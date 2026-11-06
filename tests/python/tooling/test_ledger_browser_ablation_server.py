"""Reject production aliases and shared files before browser-server app imports.

Code version: v1.0.0
"""

import os

import pytest

from scripts.ledger_browser_ablation_server import validate_roots


def test_browser_server_accepts_only_isolated_source_siblings(tmp_path):
    source = tmp_path / "source/settings_store"
    case = tmp_path / "case/settings_store"
    assert validate_roots([case], [source.resolve()]) == [case.resolve()]
    for unsafe in (source, source / "nested", source.parent, source.with_name("SETTINGS_STORE")):
        with pytest.raises(ValueError, match="separate"):
            validate_roots([unsafe], [source.resolve()])


def test_browser_server_rejects_symlinks_before_loading_the_app(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    case = tmp_path / "case"
    case.mkdir()
    (case / "shared-source").symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic"):
        validate_roots([case], [source])


def test_browser_server_rejects_hardlinked_source_files(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    original = source / "investment.sqlite3"
    original.write_bytes(b"An isolated source identity guard, not a ledger fixture")
    case = tmp_path / "case"
    case.mkdir()
    os.link(original, case / original.name)
    with pytest.raises(ValueError, match="hard-linked"):
        validate_roots([case], [source])
    assert original.read_bytes() == b"An isolated source identity guard, not a ledger fixture"
