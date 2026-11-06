"""Lossless, compressed investment snapshots with transactional block updates.

Code version: v1.0.0
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

import pyarrow as pa

SCHEMA_VERSION = 1
APPLICATION_ID = 0x57574C47
TRANSACTIONS_PER_BLOCK = 256
MAX_BLOCK_BYTES = 512 * 1024 * 1024
_CODEC = pa.Codec("zstd", compression_level=6)
_READ_ERROR = "The SQLite investment ledger could not be read safely."


def fsync_directory(path: Path) -> None:
    """Persist a published directory entry on systems with directory fsync."""
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def payload_sha256(payload: dict[str, object]) -> str:
    """Fingerprint every nested value without changing financial strings or order."""
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        .encode("utf-8")
    ).hexdigest()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _records(payload: dict[str, object]) -> list[tuple]:
    if not isinstance(payload, dict) or any(not isinstance(k, str) for k in payload):
        raise ValueError("The investment payload must have string section names.")
    records = []
    for section, value in payload.items():
        if section == "transactions":
            if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
                raise ValueError("Investment transactions must be a list of objects.")
            blocks = [
                (start // TRANSACTIONS_PER_BLOCK, value[start:start + TRANSACTIONS_PER_BLOCK])
                for start in range(0, len(value), TRANSACTIONS_PER_BLOCK)
            ]
        else:
            blocks = [(-1, value)]
        for ordinal, block in blocks:
            raw = _json_bytes(block)
            if len(raw) > MAX_BLOCK_BYTES:
                raise ValueError("An investment storage block exceeds its safe size limit.")
            count = len(block) if section == "transactions" else 1
            records.append((section, ordinal, count, len(raw), hashlib.sha256(raw).hexdigest(), raw))
    return sorted(records, key=lambda row: (row[0], row[1]))


def _manifest_sha256(has_transactions: int, records: list[tuple]) -> str:
    return hashlib.sha256(_json_bytes([has_transactions, [list(row[:5]) for row in records]])).hexdigest()


def _connect(path: Path, *, writable: bool = False) -> sqlite3.Connection:
    mode = "rw" if writable else "ro"
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode={mode}", uri=True, timeout=30)
    connection.execute("PRAGMA trusted_schema=OFF")
    if writable:
        if connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete":
            connection.close()
            raise RuntimeError("The investment ledger requires rollback-journal mode.")
        connection.execute("PRAGMA synchronous=FULL")
    return connection


def _initialize(connection: sqlite3.Connection) -> None:
    connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
    connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    connection.execute(
        "CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK (id=1), "
        "has_transactions INTEGER NOT NULL CHECK (has_transactions IN (0,1)), "
        "manifest_sha256 TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE TABLE ledger_records (section TEXT NOT NULL, ordinal INTEGER NOT NULL, "
        "row_count INTEGER NOT NULL, raw_size INTEGER NOT NULL, sha256 TEXT NOT NULL, "
        "payload BLOB NOT NULL, PRIMARY KEY (section,ordinal)) WITHOUT ROWID"
    )


def _load(connection: sqlite3.Connection) -> dict[str, object]:
    if (
        connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID
        or connection.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION
    ):
        raise RuntimeError("The SQLite investment ledger has an incompatible schema.")
    states = connection.execute("SELECT id,has_transactions,manifest_sha256 FROM ledger_state").fetchall()
    if len(states) != 1 or states[0][0] != 1 or states[0][1] not in (0, 1):
        raise RuntimeError(_READ_ERROR)
    _, has_transactions, digest = states[0]
    records = connection.execute(
        "SELECT section,ordinal,row_count,raw_size,sha256,payload "
        "FROM ledger_records ORDER BY section,ordinal"
    ).fetchall()
    if _manifest_sha256(has_transactions, records) != digest:
        raise RuntimeError(_READ_ERROR)
    payload: dict[str, object] = {"transactions": []} if has_transactions else {}
    transactions = []
    expected_ordinal = 0
    for section, ordinal, count, raw_size, sha256, compressed in records:
        if not isinstance(raw_size, int) or not 0 <= raw_size <= MAX_BLOCK_BYTES:
            raise RuntimeError(_READ_ERROR)
        raw = _CODEC.decompress(compressed, raw_size, asbytes=True)
        if len(raw) != raw_size or hashlib.sha256(raw).hexdigest() != sha256:
            raise RuntimeError(_READ_ERROR)
        value = json.loads(raw)
        if section == "transactions":
            if (
                not has_transactions or ordinal != expected_ordinal
                or not isinstance(value, list) or len(value) != count
                or not 1 <= count <= TRANSACTIONS_PER_BLOCK
                or any(not isinstance(row, dict) for row in value)
            ):
                raise RuntimeError(_READ_ERROR)
            transactions.extend(value)
            expected_ordinal += 1
        else:
            if ordinal != -1 or count != 1:
                raise RuntimeError(_READ_ERROR)
            payload[section] = value
    if has_transactions:
        payload["transactions"] = transactions
    return payload


def load_payload(path: Path) -> dict[str, object]:
    """Read one consistent snapshot; an existing damaged database never falls back."""
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            return _load(connection)
    except (sqlite3.Error, ValueError, TypeError, OSError, pa.ArrowException) as exc:
        raise RuntimeError(_READ_ERROR) from exc


def _write(path: Path, payload: dict[str, object], *, create: bool = False) -> None:
    records = _records(payload)
    has_transactions = int("transactions" in payload)
    digest = _manifest_sha256(has_transactions, records)
    with closing(_connect(path, writable=True)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            if create:
                _initialize(connection)
            else:
                _load(connection)
            previous = {
                (row[0], row[1]): row[2]
                for row in connection.execute("SELECT section,ordinal,sha256 FROM ledger_records")
            }
            keys = set()
            for section, ordinal, count, raw_size, sha256, raw in records:
                key = (section, ordinal)
                keys.add(key)
                if previous.get(key) == sha256:
                    continue
                connection.execute(
                    "INSERT INTO ledger_records VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(section,ordinal) DO UPDATE SET "
                    "row_count=excluded.row_count,raw_size=excluded.raw_size,"
                    "sha256=excluded.sha256,payload=excluded.payload",
                    (section, ordinal, count, raw_size, sha256, _CODEC.compress(raw, asbytes=True)),
                )
            connection.executemany(
                "DELETE FROM ledger_records WHERE section=? AND ordinal=?",
                previous.keys() - keys,
            )
            connection.execute(
                "INSERT INTO ledger_state VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET "
                "has_transactions=excluded.has_transactions,manifest_sha256=excluded.manifest_sha256 "
                "WHERE has_transactions<>excluded.has_transactions "
                "OR manifest_sha256<>excluded.manifest_sha256",
                (has_transactions, digest),
            )


def save_payload(path: Path, payload: dict[str, object]) -> None:
    """Commit changed blocks, or atomically publish a verified new database."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            _write(path, payload)
        except (sqlite3.Error, ValueError, TypeError, OSError, pa.ArrowException) as exc:
            raise RuntimeError("The SQLite investment ledger could not be saved safely.") from exc
        return
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        _write(temporary, payload, create=True)
        verify_database(temporary)
        if payload_sha256(load_payload(temporary)) != payload_sha256(payload):
            raise RuntimeError("SQLite investment ledger readback does not match its source.")
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def verify_database(path: Path) -> dict[str, object]:
    """Verify SQLite pages, compressed bytes, manifests, and the full payload."""
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("The SQLite investment ledger failed its integrity check.")
            payload = _load(connection)
            return {
                "integrity_check": "ok",
                "payload_sha256": payload_sha256(payload),
                "transactions": len(payload.get("transactions", [])),
                "sections": len(payload),
                "blocks": connection.execute("SELECT count(*) FROM ledger_records").fetchone()[0],
            }
    except (sqlite3.Error, ValueError, TypeError, OSError, pa.ArrowException) as exc:
        raise RuntimeError(_READ_ERROR) from exc
