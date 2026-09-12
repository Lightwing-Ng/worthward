"""Atomic settings persistence regressions. Code version: v1.0.0."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
import sys
from unittest.mock import patch

import pytest

from app.core import settings_store


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings_store, "SETTINGS_STORE_DIR", tmp_path)
    monkeypatch.setattr(settings_store, "GENERAL_SETTINGS_PATH", tmp_path / "settings.json")
    monkeypatch.setattr(settings_store, "LEGACY_SECTION_PATHS", {})
    return tmp_path / "settings.json"


def test_concurrent_updates_preserve_every_section(store):
    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(lambda index: settings_store.save_setting_value(str(index), index), range(40)))
    assert json.loads(store.read_text()) == {str(index): index for index in range(40)}
    if os.name != "nt":
        assert store.stat().st_mode & 0o777 == 0o600


def test_failed_replace_preserves_original_bytes_and_removes_temporary(store):
    settings_store.save_setting_value("existing", "preserved")
    original = store.read_bytes()
    with patch.object(settings_store.os, "replace", side_effect=OSError("interrupted")):
        with pytest.raises(OSError):
            settings_store.save_setting_value("new", True)
    assert store.read_bytes() == original
    assert not list(store.parent.glob(".settings-*.tmp"))


def test_process_updates_preserve_every_key(store):
    environment = {**os.environ, "WORTHWARD_SETTINGS_STORE_DIR": str(store.parent)}
    def write_group(group):
        subprocess.run([
            sys.executable, "-c",
            "from app.core.settings_store import save_setting_value; "
            f"[save_setting_value('{group}-' + str(i), i) for i in range(10)]",
        ], env=environment, check=True, capture_output=True, timeout=30)
    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(write_group, range(4)))
    assert json.loads(store.read_text()) == {f"{group}-{i}": i for group in range(4) for i in range(10)}


@pytest.mark.parametrize("content", ['{"broken":', '[]'])
def test_corrupt_settings_are_not_overwritten(store, content):
    store.write_text(content)
    with pytest.raises(ValueError):
        settings_store.save_setting_value("new", True)
    assert store.read_text() == content
