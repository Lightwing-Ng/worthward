"""Typed, compressed, column-projected DataFrames in transactional SQLite stores.

Code version: v1.0.2
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
from uuid import uuid4

import pandas as pd
import pyarrow as pa

SCHEMA_VERSION = 1
APPLICATION_ID = 0x57574652
ROWS_PER_BLOCK = 8_192
MAX_BLOCK_BYTES = 512 * 1024 * 1024
_CODEC = pa.Codec("zstd", compression_level=6)
_READ_ERROR = "The SQLite frame store could not be read safely."


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _manifest(schema_bytes: bytes, rows: int, headers: list[tuple], *, compressed: bool = True) -> str:
    width = 7 if compressed else 6
    return _sha256(_encoded([_sha256(schema_bytes), rows, [list(row[:width]) for row in headers]]))


def _materialize_dataless_file(path: Path) -> None:
    dataless_flag = getattr(stat, "SF_DATALESS", 0)
    if not dataless_flag:
        return
    file_stat = path.stat()
    if not getattr(file_stat, "st_flags", 0) & dataless_flag:
        return
    # A normal buffered read asks File Provider to make cloud-backed bytes local.
    byte_count = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            byte_count += len(chunk)
    if byte_count != file_stat.st_size:
        raise OSError("The SQLite frame store file is not fully available locally.")


def _connect(path: Path, *, writable: bool = False) -> sqlite3.Connection:
    _materialize_dataless_file(path)
    mode = "rw" if writable else "ro"
    connection = sqlite3.connect(path.resolve().as_uri() + f"?mode={mode}", uri=True, timeout=30)
    connection.execute("PRAGMA trusted_schema=OFF")
    if writable:
        if connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete":
            connection.close()
            raise RuntimeError("The SQLite frame store requires rollback-journal mode.")
        connection.execute("PRAGMA synchronous=FULL")
    return connection


def _initialize(connection: sqlite3.Connection) -> None:
    connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
    connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    connection.execute(
        "CREATE TABLE frame_state (id INTEGER PRIMARY KEY CHECK(id=1), "
        "arrow_schema BLOB NOT NULL, row_count INTEGER NOT NULL CHECK(row_count>=0), "
        "manifest_sha256 TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE TABLE frame_blocks (column_ordinal INTEGER NOT NULL, block_ordinal INTEGER NOT NULL, "
        "row_start INTEGER NOT NULL, row_count INTEGER NOT NULL, raw_size INTEGER NOT NULL, "
        "sha256 TEXT NOT NULL, compressed_sha256 TEXT NOT NULL, payload BLOB NOT NULL, "
        "PRIMARY KEY(column_ordinal,block_ordinal)) WITHOUT ROWID"
    )


def _contains_dictionary(data_type: pa.DataType) -> bool:
    if pa.types.is_dictionary(data_type):
        return True
    if isinstance(data_type, pa.BaseExtensionType):
        return _contains_dictionary(data_type.storage_type)
    return any(
        _contains_dictionary(data_type.field(index).type)
        for index in range(data_type.num_fields)
    )


def _state(connection: sqlite3.Connection) -> tuple[pa.Schema, bytes, int, list[tuple]]:
    if (
        connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID
        or connection.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION
    ):
        raise RuntimeError("The SQLite frame store has an incompatible schema.")
    state = connection.execute("SELECT id,arrow_schema,row_count,manifest_sha256 FROM frame_state").fetchall()
    if len(state) != 1 or state[0][0] != 1:
        raise RuntimeError(_READ_ERROR)
    _, schema_bytes, rows, digest = state[0]
    if not isinstance(schema_bytes, bytes) or not isinstance(rows, int) or rows < 0:
        raise RuntimeError(_READ_ERROR)
    schema = pa.ipc.read_schema(pa.BufferReader(schema_bytes))
    headers = connection.execute(
        "SELECT column_ordinal,block_ordinal,row_start,row_count,raw_size,sha256,compressed_sha256 "
        "FROM frame_blocks ORDER BY column_ordinal,block_ordinal"
    ).fetchall()
    if _manifest(schema_bytes, rows, headers) != digest:
        raise RuntimeError(_READ_ERROR)
    if rows == 0:
        # Version 1 originally omitted all empty blocks. Keep those stores
        # readable; new empty dictionary blocks retain their otherwise absent vocabularies.
        dictionary_columns = [
            index for index, field in enumerate(schema)
            if _contains_dictionary(field.type)
        ]
        if headers and (
            len(headers) != len(dictionary_columns)
            or any(
                header[:4] != (column, 0, 0, 0)
                or not isinstance(header[4], int)
                or not 0 <= header[4] <= MAX_BLOCK_BYTES
                for column, header in zip(dictionary_columns, headers)
            )
        ):
            raise RuntimeError(_READ_ERROR)
        return schema, schema_bytes, rows, headers
    expected_count = ((rows + ROWS_PER_BLOCK - 1) // ROWS_PER_BLOCK) * len(schema)
    if len(headers) != expected_count:
        raise RuntimeError(_READ_ERROR)
    position = 0
    for column in range(len(schema)):
        for block, start in enumerate(range(0, rows, ROWS_PER_BLOCK)):
            header = headers[position]
            if (
                header[:4] != (column, block, start, min(ROWS_PER_BLOCK, rows - start))
                or not isinstance(header[4], int) or not 0 <= header[4] <= MAX_BLOCK_BYTES
            ):
                raise RuntimeError(_READ_ERROR)
            position += 1
    return schema, schema_bytes, rows, headers


def _column_block(table: pa.Table, column: int, start: int, count: int) -> bytes:
    selected = table.select([column])
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, selected.schema) as writer:
        if _contains_dictionary(selected.schema.field(0).type):
            position = 0
            for chunk in selected.column(0).chunks:
                end = position + len(chunk)
                if len(chunk) == 0:
                    # Assign boundary-only vocabularies to exactly one block.
                    include = count == 0 or start < position <= start + count or start == position == 0
                    if include:
                        writer.write_batch(pa.record_batch([chunk], schema=selected.schema))
                else:
                    offset = max(start, position) - position
                    length = min(start + count, end) - max(start, position)
                    if length > 0:
                        writer.write_batch(pa.record_batch([chunk.slice(offset, length)], schema=selected.schema))
                position = end
        else:
            writer.write_table(selected.slice(start, count))
    raw = sink.getvalue().to_pybytes()
    if len(raw) > MAX_BLOCK_BYTES:
        raise ValueError("A SQLite frame block exceeds its safe size limit.")
    return raw


def _records(table: pa.Table):
    for column in range(table.num_columns):
        if table.num_rows == 0 and _contains_dictionary(table.schema.field(column).type):
            raw = _column_block(table, column, 0, 0)
            payload = _CODEC.compress(raw, asbytes=True)
            yield (column, 0, 0, 0, len(raw), _sha256(raw), _sha256(payload), payload)
        for block, start in enumerate(range(0, table.num_rows, ROWS_PER_BLOCK)):
            count = min(ROWS_PER_BLOCK, table.num_rows - start)
            raw = _column_block(table, column, start, count)
            payload = _CODEC.compress(raw, asbytes=True)
            yield (column, block, start, count, len(raw), _sha256(raw), _sha256(payload), payload)


def table_digest(table: pa.Table) -> str:
    """Fingerprint exact schema and stable column blocks without Python scalar conversion."""
    headers = [record[:6] for record in _records(table)]
    return _manifest(table.schema.serialize().to_pybytes(), table.num_rows, headers, compressed=False)


def _decode_block(schema: pa.Schema, header: tuple, payload: bytes) -> pa.Table:
    column, _block, _start, count, raw_size, digest, compressed_digest = header
    if _sha256(payload) != compressed_digest:
        raise RuntimeError(_READ_ERROR)
    raw = _CODEC.decompress(payload, raw_size, asbytes=True)
    if len(raw) != raw_size or _sha256(raw) != digest:
        raise RuntimeError(_READ_ERROR)
    with pa.ipc.open_stream(pa.BufferReader(raw)) as stream:
        table = stream.read_all()
    expected_schema = pa.schema([schema.field(column)], metadata=schema.metadata)
    if table.num_rows != count or not table.schema.equals(expected_schema, check_metadata=True):
        raise RuntimeError(_READ_ERROR)
    return table


def _projected_columns(schema: pa.Schema, columns) -> list[int]:
    if columns is None:
        return list(range(len(schema)))
    selected = []
    for name in columns:
        index = schema.get_field_index(name)
        if index < 0:
            raise KeyError(f"The SQLite frame store has no unambiguous column: {name}")
        selected.append(index)
    pandas_metadata = (schema.metadata or {}).get(b"pandas")
    if pandas_metadata:
        for index_column in json.loads(pandas_metadata).get("index_columns", []):
            if not isinstance(index_column, str):
                continue
            index = schema.get_field_index(index_column)
            if index < 0:
                raise RuntimeError(_READ_ERROR)
            if index not in selected:
                selected.append(index)
    return selected


def _slice_schema(schema: pa.Schema, start: int, count: int) -> pa.Schema:
    metadata = dict(schema.metadata or {})
    pandas_metadata = metadata.get(b"pandas")
    if pandas_metadata:
        value = json.loads(pandas_metadata)
        for index in value.get("index_columns", []):
            if isinstance(index, dict) and index.get("kind") == "range":
                index["start"] += start * index["step"]
                index["stop"] = index["start"] + count * index["step"]
        metadata[b"pandas"] = json.dumps(value).encode("utf-8")
    return schema.with_metadata(metadata)


def _read(connection: sqlite3.Connection, *, columns=None, tail: int | None = None) -> pa.Table:
    schema, _schema_bytes, total_rows, headers = _state(connection)
    if tail is not None and (isinstance(tail, bool) or not isinstance(tail, int) or tail < 0):
        raise ValueError("The SQLite frame tail length must be a nonnegative integer.")
    start = 0 if tail is None else max(0, total_rows - tail)
    count = total_rows - start
    selected = _projected_columns(schema, columns)
    projected_schema = pa.schema([schema.field(index) for index in selected], metadata=schema.metadata)
    if tail is not None and start:
        projected_schema = _slice_schema(projected_schema, start, count)
    by_column = {index: [] for index in selected}
    dictionary_columns = {
        index for index in selected if _contains_dictionary(schema.field(index).type)
    }
    for header in headers:
        column, block, row_start, rows = header[:4]
        if column not in by_column or (
            column not in dictionary_columns and row_start + rows <= start
        ):
            continue
        payload_row = connection.execute(
            "SELECT payload FROM frame_blocks WHERE column_ordinal=? AND block_ordinal=?", (column, block)
        ).fetchone()
        if payload_row is None:
            raise RuntimeError(_READ_ERROR)
        decoded = _decode_block(schema, header, payload_row[0])
        if column in dictionary_columns:
            position = row_start
            for chunk in decoded.column(0).chunks:
                offset = max(0, start - position)
                by_column[column].append(chunk.slice(min(offset, len(chunk))))
                position += len(chunk)
        else:
            offset = max(0, start - row_start)
            by_column[column].extend(decoded.column(0).slice(offset).chunks)
    arrays = [pa.chunked_array(by_column[index], type=schema.field(index).type) for index in selected]
    if not arrays:
        # Selecting no columns must preserve row count, including metadata-only indexes.
        batch = pa.record_batch([pa.nulls(count)], names=["__row_count__"]).select([])
        return pa.Table.from_batches([batch], schema=projected_schema)
    return pa.Table.from_arrays(arrays, schema=projected_schema)


def read_table(path: Path, columns=None, tail: int | None = None) -> pa.Table:
    """Read exact Arrow data while touching only projected columns and needed tail blocks."""
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            return _read(connection, columns=columns, tail=tail)
    except (sqlite3.Error, OSError, pa.ArrowException) as exc:
        raise RuntimeError(_READ_ERROR) from exc


def read_frame(path: Path, columns=None, tail: int | None = None) -> pd.DataFrame:
    """Restore pandas indexes, extension dtypes, categories, and frame attributes."""
    table = read_table(path, columns=columns, tail=tail)
    frame = table.to_pandas()
    attrs = (table.schema.metadata or {}).get(b"PANDAS_ATTRS")
    if attrs:
        frame.attrs = json.loads(attrs)
    return frame


def frame_info(path: Path) -> dict[str, object]:
    """Read verified schema and row counts without reading data BLOBs."""
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            schema, schema_bytes, rows, headers = _state(connection)
            return {
                "row_count": rows, "rows": rows, "columns": schema.names,
                "schema": schema, "schema_sha256": _sha256(schema_bytes),
                "table_sha256": _manifest(schema_bytes, rows, headers, compressed=False),
                "blocks": len(headers),
            }
    except (sqlite3.Error, OSError, pa.ArrowException) as exc:
        raise RuntimeError(_READ_ERROR) from exc


def _validate_payloads(connection: sqlite3.Connection, headers: list[tuple], *, decode: pa.Schema | None = None):
    for header in headers:
        payload = connection.execute(
            "SELECT payload FROM frame_blocks WHERE column_ordinal=? AND block_ordinal=?", header[:2]
        ).fetchone()[0]
        if _sha256(payload) != header[6]:
            raise RuntimeError(_READ_ERROR)
        if decode is not None:
            _decode_block(decode, header, payload)


def _write(path: Path, table: pa.Table, *, create: bool) -> None:
    schema_bytes = table.schema.serialize().to_pybytes()
    with closing(_connect(path, writable=True)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            if create:
                _initialize(connection)
                previous = {}
            else:
                _old_schema, _old_schema_bytes, _rows, headers = _state(connection)
                _validate_payloads(connection, headers)
                previous = {header[:2]: header[5:7] for header in headers}
            headers = []
            retained_keys = set()
            for record in _records(table):
                headers.append(record[:7])
                key = record[:2]
                retained_keys.add(key)
                if previous.get(key) == record[5:7]:
                    continue
                connection.execute(
                    "INSERT INTO frame_blocks VALUES (?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(column_ordinal,block_ordinal) DO UPDATE SET "
                    "row_start=excluded.row_start,row_count=excluded.row_count,raw_size=excluded.raw_size,"
                    "sha256=excluded.sha256,compressed_sha256=excluded.compressed_sha256,payload=excluded.payload",
                    record,
                )
            connection.executemany(
                "DELETE FROM frame_blocks WHERE column_ordinal=? AND block_ordinal=?",
                previous.keys() - retained_keys,
            )
            digest = _manifest(schema_bytes, table.num_rows, headers)
            connection.execute(
                "INSERT INTO frame_state VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "arrow_schema=excluded.arrow_schema,row_count=excluded.row_count,manifest_sha256=excluded.manifest_sha256 "
                "WHERE arrow_schema<>excluded.arrow_schema OR row_count<>excluded.row_count "
                "OR manifest_sha256<>excluded.manifest_sha256",
                (schema_bytes, table.num_rows, digest),
            )


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_table(path: Path, table: pa.Table) -> None:
    """Commit a typed snapshot, preserving exact schema metadata and row occurrences."""
    if not isinstance(table, pa.Table):
        raise TypeError("A SQLite frame snapshot must be a pyarrow.Table.")
    table.validate(full=True)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            _write(path, table, create=False)
        except (sqlite3.Error, OSError, pa.ArrowException) as exc:
            raise RuntimeError("The SQLite frame store could not be saved safely.") from exc
        return
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        _write(temporary, table, create=True)
        verify_database(temporary)
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def write_frame(path: Path, frame: pd.DataFrame, index: bool | None = False) -> None:
    """Match the existing pandas Parquet index and JSON-serializable attrs contract."""
    table = pa.Table.from_pandas(frame, preserve_index=index)
    if frame.attrs:
        metadata = dict(table.schema.metadata or {})
        metadata[b"PANDAS_ATTRS"] = json.dumps(frame.attrs).encode("utf-8")
        schema = table.schema.with_metadata(metadata)
        if table.num_columns:
            # Empty tables have no record batches; their column dictionaries
            # still carry categorical domains that must survive metadata updates.
            table = pa.Table.from_arrays(table.columns, schema=schema)
        else:
            # Table.replace_schema_metadata drops row counts on zero-column tables.
            table = pa.Table.from_batches(table.to_batches(), schema=schema)
    write_table(path, table)


def verify_database(path: Path) -> dict[str, object]:
    """Verify SQLite pages, every compressed column block, and exact Arrow schemas."""
    try:
        with closing(_connect(Path(path))) as connection:
            connection.execute("BEGIN")
            if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("The SQLite frame store failed its integrity check.")
            schema, schema_bytes, rows, headers = _state(connection)
            _validate_payloads(connection, headers, decode=schema)
            return {
                "integrity_check": "ok", "row_count": rows, "rows": rows,
                "columns": schema.names, "blocks": len(headers),
                "schema_sha256": _sha256(schema_bytes),
                "table_sha256": _manifest(schema_bytes, rows, headers, compressed=False),
            }
    except (sqlite3.Error, OSError, pa.ArrowException) as exc:
        raise RuntimeError(_READ_ERROR) from exc
