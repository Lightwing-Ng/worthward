"""Lossless SQLite persistence for structured documents and ordered event streams.

Code version: v1.0.0
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile
from typing import Any, Iterable
from uuid import uuid4

import pyarrow as pa

SCHEMA_VERSION = 1
APPLICATION_ID = 0x57574F42
MAX_RECORD_BYTES = 512 * 1024 * 1024
_CODEC = pa.Codec("zstd", compression_level=6)


def _validate_json_value(value: Any) -> None:
    if value is None or type(value) in {bool, int, float, str}:
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item)
        return
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        for item in value.values():
            _validate_json_value(item)
        return
    raise ValueError("Structured SQLite values must use JSON types and string object keys.")


def _json_bytes(value: Any) -> bytes:
    _validate_json_value(value)
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def payload_sha256(value: Any) -> str:
    return hashlib.sha256(_json_bytes(value)).hexdigest()


def _connect(path: Path, *, writable: bool = False) -> sqlite3.Connection:
    if path.is_symlink():
        raise ValueError("A structured SQLite store cannot be a symbolic link.")
    mode = "rw" if writable else "ro"
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode={mode}", uri=True, timeout=30)
    connection.execute("PRAGMA trusted_schema=OFF")
    if writable:
        if connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete":
            connection.close()
            raise ValueError("A structured SQLite store requires rollback-journal mode.")
        connection.execute("PRAGMA synchronous=FULL")
    return connection


def _initialize(connection: sqlite3.Connection) -> None:
    connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
    connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    connection.execute(
        "CREATE TABLE object_state (id INTEGER PRIMARY KEY CHECK(id=1), "
        "kind TEXT NOT NULL CHECK(kind IN ('object','jsonl')), "
        "record_count INTEGER NOT NULL, root_sha256 TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE TABLE object_records (ordinal INTEGER PRIMARY KEY, "
        "raw_size INTEGER NOT NULL, sha256 TEXT NOT NULL, payload BLOB NOT NULL)"
    )


def _root(kind: str, records: list[tuple]) -> str:
    return hashlib.sha256(_json_bytes([kind, [list(row[:3]) for row in records]])).hexdigest()


def _read(connection: sqlite3.Connection, expected_kind: str | None = None) -> tuple[str, Any, list[tuple]]:
    if (
        connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID
        or connection.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION
    ):
        raise ValueError("The structured SQLite store has an incompatible schema.")
    states = connection.execute("SELECT id,kind,record_count,root_sha256 FROM object_state").fetchall()
    if len(states) != 1 or states[0][0] != 1:
        raise ValueError("The structured SQLite store has an invalid state record.")
    _, kind, count, root_digest = states[0]
    if kind not in {"object", "jsonl"} or (expected_kind is not None and expected_kind != kind):
        raise ValueError("The structured SQLite store has an incompatible document kind.")
    records = connection.execute(
        "SELECT ordinal,raw_size,sha256,payload FROM object_records ORDER BY ordinal"
    ).fetchall()
    if len(records) != count or _root(kind, records) != root_digest or (kind == "object" and count != 1):
        raise ValueError("The structured SQLite store manifest does not match its records.")
    values = []
    for expected, (ordinal, raw_size, digest, compressed) in enumerate(records):
        if ordinal != expected or not isinstance(raw_size, int) or not 0 <= raw_size <= MAX_RECORD_BYTES:
            raise ValueError("The structured SQLite store has invalid record ordering or size.")
        try:
            raw = _CODEC.decompress(compressed, raw_size, asbytes=True)
        except (OSError, pa.ArrowException) as exc:
            raise ValueError("A structured SQLite record could not be decompressed safely.") from exc
        if len(raw) != raw_size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("A structured SQLite record failed its checksum.")
        values.append(json.loads(raw))
    return kind, values[0] if kind == "object" else values, records


def _load(path: Path, kind: str) -> Any:
    if not path.exists():
        raise FileNotFoundError(path)
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            return _read(connection, kind)[1]
    except (sqlite3.Error, OSError, TypeError, pa.ArrowException) as exc:
        raise ValueError("The structured SQLite store could not be read safely.") from exc


def read_object(path: Path) -> Any:
    """Read one complete JSON-compatible value from an existing SQLite document."""
    return _load(Path(path), "object")


def read_jsonl(path: Path) -> list[Any]:
    """Read every ordered event, preserving duplicate occurrences."""
    return _load(Path(path), "jsonl")


def _encode(ordinal: int, value: Any) -> tuple:
    raw = _json_bytes(value)
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("A structured SQLite record exceeds its safe size limit.")
    return ordinal, len(raw), hashlib.sha256(raw).hexdigest(), _CODEC.compress(raw, asbytes=True)


def _write(path: Path, kind: str, values: list[Any], *, create: bool = False) -> None:
    with closing(_connect(path, writable=True)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = []
            if create:
                _initialize(connection)
            else:
                _, _, previous = _read(connection, kind)
            if kind == "object":
                record = _encode(0, values[0])
                if not previous or record[2] != previous[0][2]:
                    connection.execute(
                        "INSERT INTO object_records VALUES (?,?,?,?) "
                        "ON CONFLICT(ordinal) DO UPDATE SET raw_size=excluded.raw_size, "
                        "sha256=excluded.sha256,payload=excluded.payload", record,
                    )
                records = [record]
            else:
                new_records = [_encode(len(previous) + index, value) for index, value in enumerate(values)]
                connection.executemany("INSERT INTO object_records VALUES (?,?,?,?)", new_records)
                records = previous + new_records
            digest = _root(kind, records)
            connection.execute(
                "INSERT INTO object_state VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "kind=excluded.kind,record_count=excluded.record_count,root_sha256=excluded.root_sha256 "
                "WHERE kind<>excluded.kind OR record_count<>excluded.record_count OR root_sha256<>excluded.root_sha256",
                (kind, len(records), digest),
            )


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _save(path: Path, kind: str, values: list[Any], *, exclusive: bool = False) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if exclusive:
            raise FileExistsError(path)
        _write(path, kind, values)
        return
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        _write(temporary, kind, values, create=True)
        verify_database(temporary)
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if exclusive:
                raise
            _write(path, kind, values)
        else:
            _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def write_object(path: Path, payload: Any) -> None:
    """Replace a document transactionally; damaged existing stores are rejected."""
    _save(Path(path), "object", [payload])


def create_object(path: Path, payload: Any) -> None:
    """Atomically claim a new document path without replacing an existing owner."""
    _save(Path(path), "object", [payload], exclusive=True)


def append_jsonl(path: Path, records: Iterable[Any]) -> None:
    """Atomically append events without rewriting or deduplicating earlier events."""
    _save(Path(path), "jsonl", list(records))


def verify_database(path: Path) -> dict[str, Any]:
    with closing(_connect(Path(path))) as connection:
        connection.execute("BEGIN")
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("The structured SQLite store failed its integrity check.")
        kind, value, records = _read(connection)
        return {
            "integrity_check": "ok", "kind": kind, "records": len(records),
            "payload_sha256": payload_sha256(value),
        }


def read_structured_object(path: Path) -> Any:
    """Dispatch an explicit SQLite document or a retained legacy JSON file."""
    path = Path(path)
    return read_object(path) if path.suffix.lower() == ".sqlite3" else json.loads(path.read_text(encoding="utf-8"))


def write_structured_object(path: Path, payload: Any, *, compact: bool = False) -> None:
    """Write SQLite by suffix while retaining explicit legacy-file compatibility."""
    path = Path(path)
    if path.suffix.lower() == ".sqlite3":
        write_object(path, payload)
        return
    options = {"ensure_ascii": False, "sort_keys": True, "allow_nan": False}
    if compact:
        options["separators"] = (",", ":")
    else:
        options["indent"] = 2
    serialized = json.dumps(payload, **options)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_structured_jsonl(path: Path) -> list[Any]:
    path = Path(path)
    if path.suffix.lower() == ".sqlite3":
        return read_jsonl(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_structured_jsonl(path: Path, records: Iterable[Any]) -> None:
    path = Path(path)
    records = list(records)
    if path.suffix.lower() == ".sqlite3":
        append_jsonl(path, records)
        return
    serialized = [_json_bytes(record).decode("utf-8") for record in records]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for line in serialized:
            handle.write(line + "\n")
        handle.flush()
