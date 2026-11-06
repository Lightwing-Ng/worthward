"""Protect exact frame data, column projection, and transactional SQLite writes.

Code version: v1.0.1
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import stat

import numpy as np
import pandas as pd
from pandas.testing import assert_frame_equal
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.infrastructure import frame_sqlite
from tests.factories.market import market_frame


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _complex_frame() -> pd.DataFrame:
    frame = market_frame()
    frame["nullable_integer"] = pd.Series([9_007_199_254_740_993, None], dtype="Int64")
    frame["nullable_bool"] = pd.Series([True, None], dtype="boolean")
    frame["nullable_text"] = pd.Series(["中文 · café\n\n", None], dtype="string")
    frame["category"] = pd.Categorical(["b", "a"], categories=["a", "b", "unused"], ordered=True)
    frame["zoned"] = pd.date_range("2026-01-01", periods=2, tz="America/New_York")
    frame["float"] = [float("nan"), -0.0]
    frame["object"] = [None, ""]
    frame.attrs = {"market_data_source": "exact-source", "nested": {"flag": False, "empty": []}}
    return frame


def _blocks(path: Path) -> dict[tuple[int, int], str]:
    with closing(sqlite3.connect(path)) as connection:
        return {
            (column, block): digest
            for column, block, digest in connection.execute(
                "SELECT column_ordinal,block_ordinal,sha256 FROM frame_blocks"
            )
        }


@pytest.mark.parametrize("index_kind", ["range", "named", "multi"])
def test_round_trip_preserves_all_frame_values_types_indexes_and_attrs(tmp_path, index_kind):
    frame = _complex_frame()
    if index_kind == "range":
        frame.index = pd.RangeIndex(8, 12, 2, name="row")
    elif index_kind == "named":
        frame.index = pd.Index(["duplicate", "duplicate"], name="identity")
    else:
        frame.index = pd.MultiIndex.from_tuples([("a", 1), ("a", 1)], names=["group", "ordinal"])
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_frame(path, frame, index=None)
    restored = frame_sqlite.read_frame(path)
    assert_frame_equal(restored, frame, check_exact=True, check_categorical=True)
    assert restored.attrs == frame.attrs
    assert np.signbit(restored["float"].iloc[1])
    receipt = frame_sqlite.verify_database(path)
    assert receipt["integrity_check"] == "ok"
    assert receipt["row_count"] == len(frame)


def test_default_write_index_matches_existing_index_false_contract(tmp_path):
    frame = _complex_frame()
    frame.index = pd.Index(["a", "b"], name="discarded_by_explicit_index_false")
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_frame(path, frame)
    actual = frame_sqlite.read_frame(path)
    assert_frame_equal(actual, frame.reset_index(drop=True), check_exact=True)
    assert actual.attrs == frame.attrs


def test_empty_ordered_categories_and_categorical_index_round_trip(tmp_path):
    frame = pd.DataFrame({
        "category": pd.Categorical([], categories=["used", "unused"], ordered=True),
        "number": pd.Series([], dtype="Int64"),
    })
    frame.index = pd.CategoricalIndex(
        [], categories=["first", "never_used"], ordered=True, name="identity",
    )
    frame.attrs = {"source": "empty category fixture", "unknown": None}
    path = tmp_path / "empty-categories.sqlite3"
    frame_sqlite.write_frame(path, frame, index=True)
    assert_frame_equal(frame_sqlite.read_frame(path), frame, check_exact=True)
    assert frame_sqlite.read_frame(path).attrs == frame.attrs
    assert sorted(_blocks(path)) == [(0, 0), (2, 0)]
    assert frame_sqlite.verify_database(path)["row_count"] == 0
    before = _digest(path)
    frame_sqlite.write_frame(path, frame, index=True)
    assert _digest(path) == before


@pytest.mark.parametrize("tail", [0, 1, 4])
def test_tail_preserves_ordered_unused_categories_and_physical_index(tmp_path, tail):
    count = frame_sqlite.ROWS_PER_BLOCK + 3
    frame = pd.DataFrame({
        "category": pd.Categorical(
            ["a", "b"] * (count // 2) + ["a"] * (count % 2),
            categories=["unused_before", "a", "b", "unused_after"], ordered=True,
        ),
        "number": np.arange(count),
    })
    frame.index = pd.CategoricalIndex(
        ["duplicate"] * count, categories=["duplicate", "unused_index"],
        ordered=True, name="identity",
    )
    path = tmp_path / "tail-categories.sqlite3"
    frame_sqlite.write_frame(path, frame, index=True)
    assert_frame_equal(
        frame_sqlite.read_frame(path, columns=["category"], tail=tail),
        frame[["category"]].tail(tail), check_exact=True,
    )
    assert_frame_equal(
        frame_sqlite.read_frame(path, columns=[], tail=tail),
        frame[[]].tail(tail), check_exact=True,
    )


@pytest.mark.parametrize("empty", [False, True])
def test_chunked_dictionary_vocabularies_survive_empty_chunks_and_tail(tmp_path, empty):
    def chunk(indices, categories):
        return pa.DictionaryArray.from_arrays(
            pa.array(indices, type=pa.int8()), pa.array(categories), ordered=True,
        )

    count = frame_sqlite.ROWS_PER_BLOCK
    chunks = [
        chunk([], ["leading_unused"]),
        chunk([] if empty else [0] * count, ["first", "first_unused"]),
        chunk([], ["boundary_unused"]),
        chunk([] if empty else [0, 0, 0], ["last", "last_unused"]),
        chunk([], ["trailing_unused"]),
    ]
    table = pa.Table.from_arrays([pa.chunked_array(chunks)], names=["category"])
    expected = table.to_pandas()
    path = tmp_path / "chunked-categories.sqlite3"
    frame_sqlite.write_table(path, table)
    restored = frame_sqlite.read_table(path)
    assert restored.schema.equals(table.schema, check_metadata=True)
    assert frame_sqlite.table_digest(restored) == frame_sqlite.table_digest(table)
    assert_frame_equal(frame_sqlite.read_frame(path), expected, check_exact=True)
    for tail in (0, 1):
        assert_frame_equal(
            frame_sqlite.read_frame(path, tail=tail), expected.tail(tail).reset_index(drop=True),
            check_exact=True,
        )


def test_empty_nested_dictionary_retains_its_unused_values(tmp_path):
    dictionary = pa.DictionaryArray.from_arrays(
        pa.array([], type=pa.int8()), pa.array(["nested", "unused"]),
    )
    nested = pa.StructArray.from_arrays([dictionary], names=["value"])
    table = pa.Table.from_arrays([nested], names=["nested"])
    path = tmp_path / "nested-categories.sqlite3"
    frame_sqlite.write_table(path, table)
    actual = frame_sqlite.read_table(path)
    assert actual.schema.equals(table.schema, check_metadata=True)
    assert actual.column(0).chunk(0).field("value").dictionary.equals(dictionary.dictionary)
    assert frame_sqlite.table_digest(actual) == frame_sqlite.table_digest(table)


def test_original_version_one_empty_dictionary_store_stays_read_only(tmp_path):
    table = pa.Table.from_arrays([
        pa.DictionaryArray.from_arrays(pa.array([], type=pa.int8()), pa.array([], type=pa.string())),
    ], names=["category"])
    path = tmp_path / "original-empty.sqlite3"
    frame_sqlite.write_table(path, table)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute("DELETE FROM frame_blocks")
        connection.execute(
            "UPDATE frame_state SET manifest_sha256=?",
            (frame_sqlite._manifest(table.schema.serialize().to_pybytes(), 0, []),),
        )
    before = _digest(path)
    assert_frame_equal(frame_sqlite.read_frame(path), table.to_pandas(), check_exact=True)
    assert frame_sqlite.verify_database(path)["row_count"] == 0
    assert _digest(path) == before


def test_empty_dictionary_block_corruption_is_not_treated_as_legacy_empty(tmp_path):
    frame = pd.DataFrame({"category": pd.Categorical([], categories=["retain", "unused"])})
    path = tmp_path / "damaged-empty.sqlite3"
    frame_sqlite.write_frame(path, frame)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute("UPDATE frame_blocks SET payload=?", (b"damaged dictionary",))
    before = _digest(path)
    with pytest.raises(RuntimeError, match="read safely"):
        frame_sqlite.read_frame(path)
    with pytest.raises(RuntimeError, match="read safely"):
        frame_sqlite.verify_database(path)
    assert _digest(path) == before


def test_arrow_migration_preserves_exact_schema_metadata_and_parquet_read_semantics(tmp_path):
    frame = _complex_frame()
    frame.index = pd.Index(["z", "z"], name="source_index")
    buffer = io.BytesIO()
    frame.to_parquet(buffer)
    buffer.seek(0)
    table = pq.read_table(buffer)
    metadata = dict(table.schema.metadata)
    metadata[b"unrecognized_binary_metadata"] = b"\x00\xffsource\n"
    table = table.replace_schema_metadata(metadata)
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_table(path, table)
    actual = frame_sqlite.read_table(path)
    assert actual.schema.equals(table.schema, check_metadata=True)
    assert frame_sqlite.table_digest(actual) == frame_sqlite.table_digest(table)
    info = frame_sqlite.frame_info(path)
    assert info["schema"].equals(table.schema, check_metadata=True)
    assert info["rows"] == info["row_count"] == len(frame)
    assert info["table_sha256"] == frame_sqlite.table_digest(table)
    assert_frame_equal(frame_sqlite.read_frame(path), frame, check_exact=True)
    assert frame_sqlite.read_frame(path).attrs == frame.attrs


def test_arrow_numeric_bits_preserve_nan_payloads_negative_zero_and_large_integers(tmp_path):
    bits = np.array([0x7FF8000000000001, 0x7FF8000000000002, 0x8000000000000000, 0x7FF0000000000000], dtype=np.uint64)
    values = bits.view(np.float64)
    schema = pa.schema([
        pa.field("exact_float", pa.float64(), metadata={b"unit": b"USD"}),
        pa.field("integer", pa.uint64()),
    ], metadata={b"owner": b"source"})
    table = pa.Table.from_arrays([
        pa.array(values, from_pandas=False),
        pa.array([0, 9_007_199_254_740_993, 2**63, 2**64 - 1], type=pa.uint64()),
    ], schema=schema)
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_table(path, table)
    actual = frame_sqlite.read_table(path)
    assert actual.schema.equals(table.schema, check_metadata=True)
    np.testing.assert_array_equal(actual["exact_float"].to_numpy().view(np.uint64), bits)
    assert actual["integer"].to_pylist() == table["integer"].to_pylist()
    assert frame_sqlite.table_digest(actual) == frame_sqlite.table_digest(table)


def test_arrow_chunk_boundaries_and_dictionary_replacements_remain_lossless(tmp_path):
    first = pa.array(["a", "b"] * 5_000).dictionary_encode()
    second = pa.array(["b", "c"] * 5_000).dictionary_encode()
    dictionary = pa.chunked_array([first, second])
    values = pa.chunked_array([pa.array(range(3_000)), pa.array(range(3_000, 20_000))])
    schema = pa.schema([pa.field("category", dictionary.type), pa.field("value", pa.int64())], metadata={b"source": b"chunk boundaries differ by column"})
    table = pa.Table.from_arrays([dictionary, values], schema=schema)
    path = tmp_path / "chunked.sqlite3"
    frame_sqlite.write_table(path, table)
    actual = frame_sqlite.read_table(path)
    assert actual.schema.equals(table.schema, check_metadata=True)
    assert_frame_equal(actual.to_pandas(), table.to_pandas(), check_exact=True)
    assert frame_sqlite.table_digest(actual) == frame_sqlite.table_digest(table)


@pytest.mark.parametrize("rows,columns", [(0, 0), (3, 0), (0, 2)])
def test_empty_axes_retain_schema_row_count_and_index(tmp_path, rows, columns):
    frame = pd.DataFrame(
        {f"column_{index}": pd.Series(dtype="Int64") for index in range(columns)},
        index=pd.RangeIndex(5, 5 + rows * 2, 2, name="row"),
    )
    frame.attrs = {"source": "empty axes are meaningful"}
    path = tmp_path / "empty.sqlite3"
    frame_sqlite.write_frame(path, frame, index=None)
    assert_frame_equal(frame_sqlite.read_frame(path), frame, check_exact=True)
    assert frame_sqlite.frame_info(path)["row_count"] == rows
    assert frame_sqlite.read_frame(path).attrs == frame.attrs
    frame_sqlite.verify_database(path)


@pytest.mark.parametrize("tail", [None, 0, 3, 8_193, 99_999])
def test_projection_and_tail_match_pandas_with_named_range_index(tmp_path, tail):
    frame = pd.DataFrame({"Date": pd.date_range("2026-01-01", periods=20_000, freq="min"), "Close": np.arange(20_000, dtype=float)})
    frame.index = pd.RangeIndex(10, 40_010, 2, name="row")
    frame.attrs = {"source": "projection test"}
    path = tmp_path / "large.sqlite3"
    frame_sqlite.write_frame(path, frame, index=None)
    expected = frame[["Date"]] if tail is None else frame[["Date"]].tail(tail)
    actual = frame_sqlite.read_frame(path, columns=["Date"], tail=tail)
    assert_frame_equal(actual, expected, check_exact=True)
    assert actual.attrs == expected.attrs


def test_projection_retains_physical_index_columns(tmp_path):
    frame = _complex_frame()
    frame.index = pd.Index(["z", "z"], name="original_index")
    path = tmp_path / "projected.sqlite3"
    frame_sqlite.write_frame(path, frame, index=None)
    assert_frame_equal(frame_sqlite.read_frame(path, columns=["Date"]), frame[["Date"]], check_exact=True)
    assert_frame_equal(frame_sqlite.read_frame(path, columns=[], tail=1), frame[[]].tail(1), check_exact=True)


def test_projected_tail_only_decodes_requested_column_and_tail_block(tmp_path, monkeypatch):
    frame = pd.DataFrame({"Date": pd.date_range("2026-01-01", periods=20_000, freq="min"), "Close": np.arange(20_000, dtype=float)})
    path = tmp_path / "projection.sqlite3"
    frame_sqlite.write_frame(path, frame)
    seen = []
    original_decode = frame_sqlite._decode_block

    def capture_decode(schema, header, payload):
        seen.append(header[:2])
        return original_decode(schema, header, payload)

    monkeypatch.setattr(frame_sqlite, "_decode_block", capture_decode)
    actual = frame_sqlite.read_frame(path, columns=["Date"], tail=2)
    assert seen == [(0, 2)]
    assert_frame_equal(actual, frame[["Date"]].tail(2).reset_index(drop=True), check_exact=True)


def test_invalid_projection_and_tail_remain_explicit_errors(tmp_path):
    path = tmp_path / "frame.sqlite3"
    frame_sqlite.write_frame(path, market_frame())
    with pytest.raises(KeyError, match="no unambiguous column"):
        frame_sqlite.read_frame(path, columns=["not_a_column"])
    with pytest.raises(ValueError, match="nonnegative integer"):
        frame_sqlite.read_frame(path, tail=-1)


def test_single_value_update_rewrites_only_one_column_block_and_removes_stale_blocks(tmp_path):
    frame = pd.DataFrame({"x": np.arange(20_000), "y": np.arange(20_000, dtype=float)})
    path = tmp_path / "incremental.sqlite3"
    frame_sqlite.write_frame(path, frame)
    before = _blocks(path)
    frame.loc[9_000, "y"] = -1.5
    frame_sqlite.write_frame(path, frame)
    after = _blocks(path)
    assert [key for key in before if before[key] != after[key]] == [(1, 1)]
    assert_frame_equal(frame_sqlite.read_frame(path), frame, check_exact=True)
    reduced = frame.iloc[:8_000, :1].copy()
    frame_sqlite.write_frame(path, reduced)
    assert len(_blocks(path)) == 1
    assert_frame_equal(frame_sqlite.read_frame(path), reduced.reset_index(drop=True), check_exact=True)


def test_noop_snapshot_does_not_change_database_bytes(tmp_path):
    path = tmp_path / "noop.sqlite3"
    frame = market_frame()
    frame_sqlite.write_frame(path, frame)
    before = _digest(path)
    frame_sqlite.write_frame(path, frame)
    assert _digest(path) == before


@pytest.mark.parametrize("corruption", ["payload", "header", "manifest", "future_version"])
def test_corrupt_store_fails_closed_and_cannot_be_overwritten(tmp_path, corruption):
    path = tmp_path / "corrupt.sqlite3"
    frame = market_frame()
    frame_sqlite.write_frame(path, frame)
    with sqlite3.connect(path) as connection:
        if corruption == "payload":
            connection.execute("UPDATE frame_blocks SET payload=? WHERE column_ordinal=0", (b"damaged IPC bytes",))
        elif corruption == "header":
            connection.execute("UPDATE frame_blocks SET row_start=1 WHERE column_ordinal=0")
        elif corruption == "manifest":
            connection.execute("UPDATE frame_state SET manifest_sha256='damaged'")
        else:
            connection.execute(f"PRAGMA user_version={frame_sqlite.SCHEMA_VERSION + 1}")
    before = path.read_bytes()
    with pytest.raises(RuntimeError):
        frame_sqlite.read_frame(path)
    with pytest.raises(RuntimeError):
        frame_sqlite.verify_database(path)
    with pytest.raises(RuntimeError):
        frame_sqlite.write_frame(path, frame)
    assert path.read_bytes() == before


@pytest.mark.parametrize("content", [b"", b"not a SQLite frame"])
def test_invalid_existing_file_is_not_recreated(tmp_path, content):
    path = tmp_path / "invalid.sqlite3"
    path.write_bytes(content)
    with pytest.raises(RuntimeError):
        frame_sqlite.write_frame(path, market_frame())
    assert path.read_bytes() == content


def test_unrelated_wal_database_is_neither_changed_nor_reconfigured(tmp_path):
    path = tmp_path / "unrelated.sqlite3"
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE source(value INTEGER)")
        connection.execute("INSERT INTO source VALUES(7)")
        connection.commit()
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        before = path.read_bytes()
        with pytest.raises(RuntimeError, match="rollback-journal mode"):
            frame_sqlite.write_frame(path, market_frame())
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert path.read_bytes() == before


def test_failed_transaction_rolls_back_and_releases_writer(tmp_path):
    path = tmp_path / "rollback.sqlite3"
    frame = market_frame()
    frame_sqlite.write_frame(path, frame)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TRIGGER reject_frame_update BEFORE UPDATE ON frame_blocks "
            "BEGIN SELECT RAISE(ABORT,'isolated failure'); END"
        )
    changed = frame.copy()
    changed.loc[0, "Close"] = -123
    with pytest.raises(RuntimeError):
        frame_sqlite.write_frame(path, changed)
    assert_frame_equal(frame_sqlite.read_frame(path), frame, check_exact=True)
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TRIGGER reject_frame_update")
    frame_sqlite.write_frame(path, changed)
    assert_frame_equal(frame_sqlite.read_frame(path), changed, check_exact=True)


def test_failed_initial_verification_does_not_publish_or_leave_candidate(tmp_path, monkeypatch):
    path = tmp_path / "not-published.sqlite3"

    def reject(_path):
        raise RuntimeError("isolated verification failure")

    monkeypatch.setattr(frame_sqlite, "verify_database", reject)
    with pytest.raises(RuntimeError, match="isolated verification failure"):
        frame_sqlite.write_frame(path, market_frame())
    assert not path.exists()
    assert list(tmp_path.iterdir()) == []


def test_read_missing_store_does_not_create_database(tmp_path):
    path = tmp_path / "absent.sqlite3"
    with pytest.raises(RuntimeError):
        frame_sqlite.read_frame(path)
    assert not path.exists()


@pytest.mark.skipif(os.name != "posix", reason="POSIX file permissions")
def test_new_store_is_private(tmp_path):
    path = tmp_path / "private.sqlite3"
    frame_sqlite.write_frame(path, market_frame())
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_attributes_use_existing_pandas_metadata_convention(tmp_path):
    frame = market_frame()
    frame.attrs = {"source": "test", "unknown": {"value": None}}
    path = tmp_path / "attrs.sqlite3"
    frame_sqlite.write_frame(path, frame)
    metadata = frame_sqlite.read_table(path).schema.metadata
    assert json.loads(metadata[b"PANDAS_ATTRS"]) == frame.attrs
