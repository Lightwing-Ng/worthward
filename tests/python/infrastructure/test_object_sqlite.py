"""Protect structured SQLite documents and ordered events on isolated stores.

Code version: v1.0.0
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
import json
import os
import sqlite3

import pytest

from app.core.preferences import store as settings_store
from app.core import object_sqlite as store
from app.infrastructure import compute_jobs
from app.services import credit_card_ledger
from tests.factories.hsbc_credit_card import hsbc_credit_card_text


@pytest.mark.parametrize("payload", [None, False, "", 1, -0.0, [], {}, [1, 1, None], {
    "unknown": {"amount": "0001.230000", "blank": "\n  \t\r\n", "unicode": "中文 · café"},
    "large_integer": 9_007_199_254_740_993, "negative_zero": -0.0,
}])
def test_documents_preserve_every_json_value_and_numeric_type(tmp_path, payload):
    path = tmp_path / "document.sqlite3"
    store.write_object(path, payload)
    actual = store.read_object(path)
    assert type(actual) is type(payload)
    assert store.payload_sha256(actual) == store.payload_sha256(payload)
    assert store.verify_database(path) == {
        "integrity_check": "ok", "kind": "object", "records": 1,
        "payload_sha256": store.payload_sha256(payload),
    }
    if os.name == "posix":
        assert path.stat().st_mode & 0o777 == 0o600


def test_read_does_not_create_a_missing_database(tmp_path):
    path = tmp_path / "absent.sqlite3"
    with pytest.raises(FileNotFoundError):
        store.read_object(path)
    assert not path.exists()


def test_exclusive_worker_claim_never_replaces_an_existing_owner(tmp_path):
    path = tmp_path / "worker.sqlite3"
    store.create_object(path, {"pid": 123})
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        store.create_object(path, {"pid": 456})
    assert path.read_bytes() == before
    assert store.read_object(path) == {"pid": 123}


def test_nonfinite_write_keeps_original_bytes(tmp_path):
    path = tmp_path / "document.sqlite3"
    store.write_object(path, {"retained": True})
    before = path.read_bytes()
    with pytest.raises(ValueError):
        store.write_object(path, {"invalid": float("nan")})
    assert path.read_bytes() == before


@pytest.mark.parametrize("payload", [{1: "numeric key"}, {"tuple": (1, 2)}])
def test_unsupported_python_types_are_rejected_instead_of_converted(tmp_path, payload):
    path = tmp_path / "document.sqlite3"
    with pytest.raises(ValueError, match="JSON types"):
        store.write_object(path, payload)
    assert not path.exists()


def test_damaged_database_and_payload_are_not_overwritten(tmp_path):
    path = tmp_path / "document.sqlite3"
    store.write_object(path, {"retained": [1, 2, 3]})
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE object_records SET payload=?", (b"broken",))
    damaged = path.read_bytes()
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        store.read_object(path)
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        store.write_object(path, {"replacement": True})
    assert path.read_bytes() == damaged


def test_transaction_failure_rolls_back_document_and_manifest(tmp_path):
    path = tmp_path / "document.sqlite3"
    original = {"retained": "value"}
    store.write_object(path, original)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TRIGGER reject_manifest BEFORE UPDATE ON object_state "
            "BEGIN SELECT RAISE(ABORT, 'isolated manifest failure'); END"
        )
    with pytest.raises(sqlite3.DatabaseError, match="manifest failure"):
        store.write_object(path, {"changed": True})
    assert store.read_object(path) == original
    assert store.verify_database(path)["payload_sha256"] == store.payload_sha256(original)


def test_unrelated_wal_database_is_not_modified(tmp_path):
    path = tmp_path / "unrelated.sqlite3"
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE unrelated(value)")
        connection.commit()
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        before = path.read_bytes()
        with pytest.raises(ValueError, match="rollback-journal"):
            store.write_object(path, {})
        assert connection.execute("PRAGMA journal_mode").fetchone() == ("wal",)
        assert path.read_bytes() == before


def test_ordered_stream_retains_duplicates_and_appends_without_rewriting(tmp_path):
    path = tmp_path / "evaluations.sqlite3"
    first = [{"score": "1.000", "unknown": None}, {"score": "1.000", "unknown": None}]
    store.append_jsonl(path, first)
    with sqlite3.connect(path) as connection:
        previous = connection.execute("SELECT * FROM object_records ORDER BY ordinal").fetchall()
    store.append_jsonl(path, [{"score": "2.000"}])
    assert store.read_jsonl(path) == first + [{"score": "2.000"}]
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT * FROM object_records ORDER BY ordinal LIMIT 2").fetchall() == previous
    assert store.verify_database(path)["kind"] == "jsonl"
    with pytest.raises(ValueError, match="document kind"):
        store.read_object(path)


def test_concurrent_event_appends_preserve_every_occurrence(tmp_path):
    path = tmp_path / "events.sqlite3"
    with ThreadPoolExecutor(max_workers=6) as workers:
        list(workers.map(lambda index: store.append_jsonl(path, [{"index": index}]), range(24)))
    assert sorted(row["index"] for row in store.read_jsonl(path)) == list(range(24))
    assert store.verify_database(path)["records"] == 24


def test_failed_event_batch_preserves_the_entire_prior_stream(tmp_path):
    path = tmp_path / "events.sqlite3"
    original = [{"index": 0}, {"index": 1}]
    store.append_jsonl(path, original)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TRIGGER reject_second_event BEFORE INSERT ON object_records "
            "WHEN NEW.ordinal=3 BEGIN SELECT RAISE(ABORT, 'isolated event failure'); END"
        )
    with pytest.raises(sqlite3.DatabaseError, match="event failure"):
        store.append_jsonl(path, [{"index": 2}, {"index": 3}])
    assert store.read_jsonl(path) == original
    assert store.verify_database(path)["payload_sha256"] == store.payload_sha256(original)


def test_explicit_legacy_dispatch_retains_plain_json_and_jsonl(tmp_path):
    document = tmp_path / "document.json"
    events = tmp_path / "events.jsonl"
    store.write_structured_object(document, {"text": "kept"})
    store.append_structured_jsonl(events, [{"index": 1}, {"index": 1}])
    assert json.loads(document.read_text()) == store.read_structured_object(document)
    assert store.read_structured_jsonl(events) == [{"index": 1}, {"index": 1}]


def test_settings_dispatch_serializes_sqlite_section_updates(tmp_path, monkeypatch):
    path = tmp_path / "settings.sqlite3"
    monkeypatch.setattr(settings_store, "SETTINGS_STORE_DIR", tmp_path)
    monkeypatch.setattr(settings_store, "GENERAL_SETTINGS_PATH", path)
    monkeypatch.setattr(settings_store, "LEGACY_SECTION_PATHS", {})
    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(lambda index: settings_store.save_setting_value(str(index), index), range(16)))
    assert settings_store.load_all_settings() == {str(index): index for index in range(16)}
    assert not path.with_suffix(".json").exists()


def test_credit_card_sqlite_retains_same_validated_ledger_as_json(tmp_path):
    capture = hsbc_credit_card_text()
    sqlite_path = tmp_path / "credit_cards.sqlite3"
    legacy_path = tmp_path / "credit_cards.json"
    for path in (sqlite_path, legacy_path):
        first = credit_card_ledger.commit_hsbc_credit_card_import(capture, path)
        assert first["committed"]
        credit_card_ledger.commit_hsbc_credit_card_import(capture, path)
    a = credit_card_ledger.load_credit_card_ledger(sqlite_path)
    b = credit_card_ledger.load_credit_card_ledger(legacy_path)
    # Capture times are generated independently; compare every retained source and economic field.
    def without_capture_times(value):
        if isinstance(value, dict):
            return {key: without_capture_times(item) for key, item in value.items() if key != "captured_at"}
        if isinstance(value, list):
            return [without_capture_times(item) for item in value]
        return value
    assert without_capture_times(a) == without_capture_times(b)


def test_compute_helpers_dispatch_sqlite_without_other_store_initialization(tmp_path):
    path = tmp_path / "status.sqlite3"
    payload = {"status": "running", "generation": 3, "unknown": {"nested": []}}
    compute_jobs.write_json_atomic(path, payload, compact=True)
    assert compute_jobs.read_json_object(path) == deepcopy(payload)
    assert set(p.name for p in tmp_path.iterdir()) == {"status.sqlite3"}
