"""Verify lossless investment SQLite persistence on isolated ledgers.

Code version: v1.1.0
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import threading

import pytest

from app.infrastructure import investment_sqlite, storage
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload


def _production_digests() -> dict[str, str | None]:
    settings = Path(__file__).resolve().parents[3] / "settings_store"
    return {
        name: hashlib.sha256((settings / name).read_bytes()).hexdigest()
        if (settings / name).exists()
        else None
        for name in ("investment.parquet", "investment.sqlite3")
    }


@pytest.fixture(autouse=True)
def protected_store_guard():
    """Every writable fixture must leave both real ledger formats unchanged."""
    before = _production_digests()
    yield
    assert _production_digests() == before


def _payload() -> dict:
    payload = buy_csv_payload()
    payload["unknown_future_metadata"] = {
        "unicode": "中文 · café · 𝄞",
        "text": "\n  exact spacing\n\n• literal bullet\t\r\n",
        "null": None,
        "empty_string": "",
        "empty_list": [],
        "empty_dict": {},
        "false": False,
        "zero": 0,
        "negative_zero": -0.0,
        "large_integer": 9_007_199_254_740_993,
        "nested": [{"amount": "0001.230000", "pending_currency": "CNY"}],
    }
    payload["manual_internal_transfer_bindings"] = {"source:key": "target:key"}
    payload["dividend_attribution_choices"] = {"choice:key": {"enabled": False}}
    return payload


def _json(payload: dict) -> str:
    """Retain numeric types, negative zero, and whitespace inside strings."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _application_tables(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def _quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


@pytest.mark.parametrize("payload", [{}, {"transactions": []}, {"transactions": [], "x": None}])
def test_empty_and_metadata_only_payloads_round_trip_exactly(tmp_path, payload):
    path = tmp_path / "investment.sqlite3"
    investment_sqlite.save_payload(path, payload)
    assert _json(investment_sqlite.load_payload(path)) == _json(payload)
    assert isinstance(investment_sqlite.verify_database(path), dict)


def test_round_trip_preserves_duplicate_records_and_unknown_metadata(tmp_path):
    path = tmp_path / "investment.sqlite3"
    payload = _payload()
    original_transactions = deepcopy(payload["transactions"])
    payload["transactions"] = [
        deepcopy(original_transactions[index % len(original_transactions)])
        for index in range(777)
    ]
    original = _json(payload)
    investment_sqlite.save_payload(path, payload)
    assert _json(payload) == original
    assert _json(investment_sqlite.load_payload(path)) == original
    assert len(investment_sqlite.load_payload(path)["transactions"]) == 777
    assert isinstance(investment_sqlite.verify_database(path), dict)

    changed = deepcopy(payload)
    changed["transactions"][300]["description"] = "Changed one retained occurrence"
    changed["unknown_future_metadata"]["nested"].append({"amount": None})
    investment_sqlite.save_payload(path, changed)
    assert _json(investment_sqlite.load_payload(path)) == _json(changed)
    assert investment_sqlite.load_payload(path)["transactions"][299] == payload["transactions"][299]


def test_transaction_failure_keeps_previous_payload_and_releases_writer(tmp_path):
    path = tmp_path / "investment.sqlite3"
    original = _payload()
    investment_sqlite.save_payload(path, original)
    trigger_names = []
    with sqlite3.connect(path) as connection:
        for index, table in enumerate(_application_tables(connection)):
            for operation in ("INSERT", "UPDATE", "DELETE"):
                name = f"reject_{index}_{operation.lower()}"
                trigger_names.append(name)
                connection.execute(
                    f"CREATE TRIGGER {_quoted(name)} BEFORE {operation} ON {_quoted(table)} "
                    "BEGIN SELECT RAISE(ABORT, 'isolated transaction failure'); END"
                )
    assert trigger_names
    changed = deepcopy(original)
    changed["transactions"][0]["description"] = "A failed isolated update"
    with pytest.raises((sqlite3.DatabaseError, RuntimeError)):
        investment_sqlite.save_payload(path, changed)
    assert _json(investment_sqlite.load_payload(path)) == _json(original)
    with sqlite3.connect(path) as connection:
        for name in trigger_names:
            connection.execute(f"DROP TRIGGER {_quoted(name)}")
    investment_sqlite.save_payload(path, changed)
    assert _json(investment_sqlite.load_payload(path)) == _json(changed)
    investment_sqlite.verify_database(path)


def test_save_rejects_unrelated_wal_database_without_changing_bytes_or_mode(tmp_path):
    path = tmp_path / "unrelated.sqlite3"
    with closing(sqlite3.connect(path)) as connection:
        assert connection.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
        connection.execute("CREATE TABLE unrelated (value TEXT NOT NULL)")
        connection.execute("INSERT INTO unrelated VALUES ('Retain this application record')")
        connection.commit()
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        original_bytes = path.read_bytes()
        with pytest.raises(RuntimeError, match="rollback-journal mode"):
            investment_sqlite.save_payload(path, _payload())
        assert path.read_bytes() == original_bytes
        assert connection.execute("PRAGMA journal_mode").fetchone() == ("wal",)
        assert connection.execute("SELECT value FROM unrelated").fetchall() == [
            ("Retain this application record",)
        ]


def test_damaged_payload_bytes_fail_read_and_verification_without_overwrite(tmp_path):
    path = tmp_path / "investment.sqlite3"
    investment_sqlite.save_payload(path, _payload())
    damaged = False
    with sqlite3.connect(path) as connection:
        for table in _application_tables(connection):
            for column in connection.execute(f"PRAGMA table_info({_quoted(table)})"):
                if str(column[2]).upper() != "BLOB":
                    continue
                name = _quoted(column[1])
                record = connection.execute(
                    f"SELECT {name} FROM {_quoted(table)} WHERE {name} IS NOT NULL LIMIT 1"
                ).fetchone()
                if record is None:
                    continue
                connection.execute(
                    f"UPDATE {_quoted(table)} SET {name} = ? WHERE {name} = ?",
                    (b"damaged compressed investment payload", record[0]),
                )
                damaged = True
                break
            if damaged:
                break
    assert damaged, "The SQLite ledger must persist at least one compressed payload block."
    original_bytes = path.read_bytes()
    with pytest.raises((RuntimeError, ValueError, sqlite3.DatabaseError)):
        investment_sqlite.load_payload(path)
    with pytest.raises((RuntimeError, ValueError, sqlite3.DatabaseError)):
        investment_sqlite.verify_database(path)
    assert path.read_bytes() == original_bytes


def test_sqlite_storage_requires_explicit_migration_instead_of_parquet_fallback(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    payload = _payload()
    storage.save_investment_store_payload(payload, parquet)
    original_bytes = parquet.read_bytes()
    assert not storage.investment_store_exists(path)
    assert storage.investment_store_path_for(path) == path
    with pytest.raises(RuntimeError, match="Explicitly migrate"):
        storage.load_investment_store_payload(path)
    assert not path.exists()
    assert parquet.read_bytes() == original_bytes


def test_explicit_migration_preserves_source_bytes_and_complete_payload(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    payload = _payload()
    storage.save_investment_store_payload(payload, parquet)
    original_bytes = parquet.read_bytes()
    receipt = storage.migrate_investment_store_to_sqlite(path)
    assert isinstance(receipt, dict)
    assert path.is_file()
    assert storage.investment_store_path_for(path) == path
    assert _json(storage.load_investment_store_payload(path)) == _json(payload)
    assert parquet.read_bytes() == original_bytes
    investment_sqlite.verify_database(path)


def test_concurrent_migrations_publish_one_identical_database(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    payload = _payload()
    storage.save_investment_store_payload(payload, parquet)
    original_bytes = parquet.read_bytes()
    start = threading.Barrier(2)

    def migrate(_index):
        start.wait(timeout=5)
        return storage.migrate_investment_store_to_sqlite(path)

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(executor.map(migrate, range(2)))
    assert sorted(receipt["already_exists"] for receipt in receipts) == [False, True]
    assert receipts[0]["payload_sha256"] == receipts[1]["payload_sha256"]
    assert _json(storage.load_investment_store_payload(path)) == _json(payload)
    assert parquet.read_bytes() == original_bytes


def test_source_change_during_verification_aborts_migration_publication(tmp_path, monkeypatch):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    payload = _payload()
    storage.save_investment_store_payload(payload, parquet)
    changed = deepcopy(payload)
    changed["unknown_future_metadata"]["unicode"] = "Concurrent legacy writer"
    original_verify = investment_sqlite.verify_database
    source_changed = False

    def verify_then_change_source(candidate):
        nonlocal source_changed
        receipt = original_verify(candidate)
        if str(candidate).endswith(".migration.sqlite3") and not source_changed:
            source_changed = True
            storage.save_investment_store_payload(changed, parquet)
        return receipt

    monkeypatch.setattr(investment_sqlite, "verify_database", verify_then_change_source)
    with pytest.raises(RuntimeError, match="source changed"):
        storage.migrate_investment_store_to_sqlite(path)
    assert source_changed
    assert not path.exists()
    assert _json(storage.load_investment_store_payload(parquet)) == _json(changed)
    assert not list(tmp_path.glob(".*.migration.sqlite3"))


def test_legacy_json_requires_explicit_migration_without_runtime_fallback(tmp_path):
    path = tmp_path / "investment.sqlite3"
    legacy = path.with_suffix(".json")
    payload = _payload()
    original_bytes = (_json(payload) + "\n").encode("utf-8")
    legacy.write_bytes(original_bytes)
    with pytest.raises(RuntimeError, match="Explicitly migrate"):
        storage.load_investment_store_payload(path)
    assert not path.exists()
    assert not path.with_suffix(".parquet").exists()
    receipt = storage.migrate_investment_store_to_sqlite(path, source=legacy)
    assert isinstance(receipt, dict)
    assert _json(storage.load_investment_store_payload(path)) == _json(payload)
    assert legacy.read_bytes() == original_bytes


def test_incompatible_sqlite_schema_fails_closed_with_legacy_present(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    storage.save_investment_store_payload(_payload(), path)
    storage.save_investment_store_payload(_payload(), parquet)
    with sqlite3.connect(path) as connection:
        connection.execute(f"PRAGMA user_version={investment_sqlite.SCHEMA_VERSION + 1}")
    original_bytes = path.read_bytes()
    with pytest.raises(RuntimeError, match="incompatible schema"):
        storage.load_investment_store_payload(path)
    with pytest.raises(RuntimeError, match="incompatible schema"):
        storage.update_investment_store_payload(lambda current: (current, None), path)
    assert path.read_bytes() == original_bytes


def test_existing_sqlite_is_authoritative_and_never_overwritten_by_legacy_source(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    old = _payload()
    current = deepcopy(old)
    current["unknown_future_metadata"]["unicode"] = "Current canonical SQLite record"
    storage.save_investment_store_payload(old, parquet)
    storage.save_investment_store_payload(current, path)
    prior_bytes = path.read_bytes()
    try:
        storage.migrate_investment_store_to_sqlite(path)
    except (FileExistsError, RuntimeError, ValueError):
        pass
    assert path.read_bytes() == prior_bytes
    assert _json(storage.load_investment_store_payload(path)) == _json(current)


@pytest.mark.parametrize("corrupt_bytes", [b"", b"not a SQLite ledger"])
def test_corrupt_sqlite_never_falls_back_or_overwrites_legacy(tmp_path, corrupt_bytes):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    storage.save_investment_store_payload(_payload(), parquet)
    parquet_bytes = parquet.read_bytes()
    path.write_bytes(corrupt_bytes)
    with pytest.raises((RuntimeError, ValueError, sqlite3.DatabaseError)):
        storage.load_investment_store_payload(path)
    with pytest.raises((RuntimeError, ValueError, sqlite3.DatabaseError)):
        storage.update_investment_store_payload(lambda current: ({"transactions": []}, None), path)
    assert path.read_bytes() == corrupt_bytes
    assert parquet.read_bytes() == parquet_bytes


def test_clear_removes_all_ledger_formats_without_reviving_legacy_data(tmp_path):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    legacy = path.with_suffix(".json")
    payload = _payload()
    storage.save_investment_store_payload(payload, parquet)
    storage.save_investment_store_payload(payload, path)
    legacy.write_text(_json(payload), encoding="utf-8")
    evidence = storage.investment_evidence_dir_for(path)
    assert evidence == storage.investment_evidence_dir_for(parquet)
    evidence.mkdir(exist_ok=True)
    (evidence / "retained.bin").write_bytes(b"isolated retained evidence")
    assert storage.clear_investment_store(path)
    assert not any(candidate.exists() for candidate in (path, parquet, legacy, evidence))
    assert not storage.investment_store_exists(path)
    assert storage.load_investment_store_payload(path) == {}
    assert not storage.clear_investment_store(path)


def test_sqlite_clear_waits_for_legacy_writer_before_removing_fallback(tmp_path, monkeypatch):
    path = tmp_path / "investment.sqlite3"
    parquet = path.with_suffix(".parquet")
    payload = _payload()
    storage.save_investment_store_payload(payload, path)
    storage.save_investment_store_payload(payload, parquet)
    writer_locked = threading.Event()
    release_writer = threading.Event()
    clear_waiting = threading.Event()
    clear_done = threading.Event()
    clear_lock_paths = []
    failures = []
    original_lock = storage.market_store_file_lock

    @contextmanager
    def observe_clear_lock(candidate):
        if threading.current_thread().name == "sqlite-clear":
            clear_lock_paths.append(candidate)
            if candidate == parquet:
                clear_waiting.set()
        with original_lock(candidate):
            yield

    def writer():
        try:
            with original_lock(parquet):
                writer_locked.set()
                assert release_writer.wait(timeout=5)
                updated = deepcopy(payload)
                updated["legacy_writer_marker"] = "Committed before clear acquired the source lock"
                storage.save_investment_store_payload(updated, parquet)
        except BaseException as exc:
            failures.append(exc)

    def clear():
        try:
            assert storage.clear_investment_store(path)
        except BaseException as exc:
            failures.append(exc)
        finally:
            clear_done.set()

    monkeypatch.setattr(storage, "market_store_file_lock", observe_clear_lock)
    writer_thread = threading.Thread(target=writer, name="legacy-writer", daemon=True)
    clear_thread = threading.Thread(target=clear, name="sqlite-clear", daemon=True)
    writer_thread.start()
    try:
        assert writer_locked.wait(timeout=5)
        clear_thread.start()
        assert clear_waiting.wait(timeout=5)
        assert not clear_done.wait(timeout=0.1), "Clear bypassed the active legacy writer lock."
    finally:
        release_writer.set()
        writer_thread.join(timeout=5)
        if clear_thread.ident is not None:
            clear_thread.join(timeout=5)
    assert not writer_thread.is_alive()
    assert not clear_thread.is_alive()
    assert not failures
    assert clear_lock_paths[:2] == [path, parquet]
    assert not path.exists()
    assert not parquet.exists()
    assert storage.load_investment_store_payload(path) == {}


def test_concurrent_sqlite_updates_serialize_read_modify_write(tmp_path):
    path = tmp_path / "investment.sqlite3"
    storage.save_investment_store_payload({"transactions": [], "counter": 0}, path)

    def increment(_index):
        def updater(current):
            next_payload = deepcopy(current)
            next_payload["counter"] += 1
            return next_payload, next_payload["counter"]

        return storage.update_investment_store_payload(updater, path)

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(increment, range(24)))
    assert sorted(results) == list(range(1, 25))
    assert storage.load_investment_store_payload(path) == {"transactions": [], "counter": 24}
    investment_sqlite.verify_database(path)
