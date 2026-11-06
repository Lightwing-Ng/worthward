"""Keep lazy cloud materialization read-only and ahead of SQLite page reads.

Code version: v1.0.0
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
import sqlite3

from pandas.testing import assert_frame_equal
import pytest

from app.infrastructure import frame_sqlite
from tests.factories.market import market_frame


_SF_DATALESS = 0x40000000


@pytest.fixture
def frame_store(tmp_path):
    frame = market_frame()
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_frame(path, frame)
    return path, frame


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _cloud_flags(monkeypatch, path, flags):
    original_stat = Path.stat

    class CloudStat:
        def __init__(self, actual):
            self.actual = actual
            self.st_flags = flags["value"]

        def __getattr__(self, name):
            return getattr(self.actual, name)

    def provider_stat(self, *args, **kwargs):
        actual = original_stat(self, *args, **kwargs)
        return CloudStat(actual) if self == path else actual

    monkeypatch.setattr(frame_sqlite.stat, "SF_DATALESS", _SF_DATALESS, raising=False)
    monkeypatch.setattr(Path, "stat", provider_stat)


def test_lazy_provider_finishes_read_before_sqlite_connect(frame_store, monkeypatch):
    path, expected = frame_store
    database_bytes = path.read_bytes()
    expected_digest = _digest(path)
    path.write_bytes(bytes(len(database_bytes)))
    original_open, original_connect = Path.open, sqlite3.connect
    events = []
    flags = {"value": _SF_DATALESS}

    class ProviderReader:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def read(self, size):
            chunk = self.handle.read(size)
            events.append(("read", len(chunk)))
            if not chunk:
                flags["value"] = 0
                events.append(("eof", 0))
            return chunk

        def __exit__(self, *args):
            self.handle.close()
            events.append(("closed", 0))

    def provider_open(self, mode="r", *args, **kwargs):
        if self == path and mode == "rb":
            # The provider publishes original bytes when an ordinary read starts.
            with original_open(path, "wb") as handle:
                handle.write(database_bytes)
            return ProviderReader(original_open(path, "rb"))
        return original_open(self, mode, *args, **kwargs)

    def connect_after_provider(*args, **kwargs):
        assert flags["value"] == 0
        assert events[-1][0] == "closed"
        events.append(("connect", 0))
        return original_connect(*args, **kwargs)

    with monkeypatch.context() as patch:
        _cloud_flags(patch, path, flags)
        patch.setattr(Path, "open", provider_open)
        patch.setattr(frame_sqlite.sqlite3, "connect", connect_after_provider)
        actual = frame_sqlite.read_frame(path)

    assert_frame_equal(actual, expected, check_exact=True)
    assert sum(count for event, count in events if event == "read") == len(database_bytes)
    assert events.index(("eof", 0)) < events.index(("connect", 0))
    assert _digest(path) == expected_digest


def test_resident_database_has_no_ordinary_preread(frame_store, monkeypatch):
    path, expected = frame_store
    before = _digest(path)
    original_open = Path.open

    def reject_preread(self, *args, **kwargs):
        if self == path:
            pytest.fail("Resident SQLite files must not be opened for an ordinary preread.")
        return original_open(self, *args, **kwargs)

    with monkeypatch.context() as patch:
        _cloud_flags(patch, path, {"value": 0})
        patch.setattr(Path, "open", reject_preread)
        actual = frame_sqlite.read_frame(path)

    assert_frame_equal(actual, expected, check_exact=True)
    assert _digest(path) == before


def test_provider_read_failure_does_not_connect_or_change_source(frame_store, monkeypatch):
    path, _ = frame_store
    before = _digest(path)
    original_open = Path.open

    def unavailable_provider(self, mode="r", *args, **kwargs):
        if self == path and mode == "rb":
            raise PermissionError("The cloud provider cannot make this file available.")
        return original_open(self, mode, *args, **kwargs)

    def reject_connect(*args, **kwargs):
        pytest.fail("SQLite must not open after source materialization fails.")

    with monkeypatch.context() as patch:
        _cloud_flags(patch, path, {"value": _SF_DATALESS})
        patch.setattr(Path, "open", unavailable_provider)
        patch.setattr(frame_sqlite.sqlite3, "connect", reject_connect)
        with pytest.raises(RuntimeError, match="could not be read safely") as error:
            frame_sqlite.read_frame(path)
        assert isinstance(error.value.__cause__, PermissionError)

    assert _digest(path) == before


def test_provider_short_read_does_not_admit_an_unavailable_source(frame_store, monkeypatch):
    path, _ = frame_store
    before = _digest(path)
    original_open = Path.open

    def incomplete_provider(self, mode="r", *args, **kwargs):
        if self == path and mode == "rb":
            return io.BytesIO(b"")
        return original_open(self, mode, *args, **kwargs)

    def reject_connect(*args, **kwargs):
        pytest.fail("SQLite must not open after an incomplete provider read.")

    with monkeypatch.context() as patch:
        _cloud_flags(patch, path, {"value": _SF_DATALESS})
        patch.setattr(Path, "open", incomplete_provider)
        patch.setattr(frame_sqlite.sqlite3, "connect", reject_connect)
        with pytest.raises(RuntimeError, match="could not be read safely") as error:
            frame_sqlite.read_frame(path)
        assert isinstance(error.value.__cause__, OSError)
        assert "not fully available" in str(error.value.__cause__)

    assert _digest(path) == before


@pytest.mark.parametrize("dataless", [False, True])
def test_corrupt_database_still_fails_without_repair(frame_store, monkeypatch, dataless):
    path, _ = frame_store
    path.write_bytes(b"This is not a SQLite database.")
    before = _digest(path)
    with monkeypatch.context() as patch:
        _cloud_flags(patch, path, {"value": _SF_DATALESS if dataless else 0})
        with pytest.raises(RuntimeError, match="could not be read safely") as error:
            frame_sqlite.read_frame(path)
        assert isinstance(error.value.__cause__, sqlite3.DatabaseError)
    assert _digest(path) == before
