"""Exercise whole-store migration on independent market and compute fixtures.

Code version: v1.0.1
"""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.core import object_sqlite
from app.infrastructure import frame_sqlite
from scripts.migrate_local_sqlite import discover, migrate_one
from tests.factories.market import ohlc_frame_for_dates


def test_market_migration_preserves_schema_attributes_order_and_source_bytes(tmp_path):
    source = tmp_path / "market/historical/EXACT.parquet"
    source.parent.mkdir(parents=True)
    original = ohlc_frame_for_dates("EXACT", pd.date_range("2026-01-01", periods=3))
    original = original.iloc[[2, 0, 0, 1]].copy()
    original.attrs = {"source": "Exact original source", "unknown": [None, "000.0100"]}
    original.to_parquet(source, index=True)
    before = source.read_bytes()
    target = source.with_suffix(".sqlite3")
    receipt = migrate_one(source, target, "frame", apply=True, scratch=tmp_path)
    assert receipt["source_unchanged"]
    assert receipt["validation"]["rows"] == 4
    assert source.read_bytes() == before
    assert target.stat().st_mtime_ns == source.stat().st_mtime_ns
    expected = pq.read_table(source)
    actual = frame_sqlite.read_table(target)
    assert expected.schema.equals(actual.schema, check_metadata=True)
    assert frame_sqlite.table_digest(expected) == frame_sqlite.table_digest(actual)
    pd.testing.assert_frame_equal(pd.read_parquet(source), frame_sqlite.read_frame(target), check_exact=True)
    assert frame_sqlite.read_frame(target).attrs == original.attrs
    assert migrate_one(source, target, "frame", apply=True, scratch=tmp_path)["already_exists"]


@pytest.mark.parametrize("empty", [False, True])
def test_categorical_migration_preserves_source_domains_and_empty_tail(tmp_path, empty):
    source = tmp_path / "categories.parquet"
    frame = ohlc_frame_for_dates("EXACT", pd.date_range("2026-01-01", periods=3))
    frame["category"] = pd.Categorical(
        ["first", "last", "first"], categories=["unused", "first", "last"], ordered=True,
    )
    frame.index = pd.CategoricalIndex(
        ["duplicate"] * 3, categories=["duplicate", "unused_identity"],
        ordered=True, name="identity",
    )
    if empty:
        frame = frame.iloc[:0]
    frame.to_parquet(source, index=True)
    before = source.read_bytes()
    expected = pd.read_parquet(source)
    target = source.with_suffix(".sqlite3")
    migrate_one(source, target, "frame", apply=True, scratch=tmp_path)
    pd.testing.assert_frame_equal(frame_sqlite.read_frame(target), expected, check_exact=True)
    pd.testing.assert_frame_equal(
        frame_sqlite.read_frame(target, columns=["category"], tail=0),
        expected[["category"]].tail(0), check_exact=True,
    )
    assert source.read_bytes() == before
    assert migrate_one(source, target, "frame", apply=True, scratch=tmp_path)["already_exists"]


@pytest.mark.parametrize("kind", ["object", "events"])
def test_document_migration_preserves_unknown_values_and_duplicate_event_occurrences(tmp_path, kind):
    source = tmp_path / ("document.json" if kind == "object" else "events.jsonl")
    item = {"amount": "000001.230000", "unknown": None, "empty": [], "text": "\n原文\r\n", "large": 9_007_199_254_740_993}
    value = item if kind == "object" else [item, item, {"last": False}]
    source.write_text(json.dumps(value) if kind == "object" else "\n".join(json.dumps(row) for row in value) + "\n")
    before = source.read_bytes()
    target = source.with_suffix(".sqlite3")
    receipt = migrate_one(source, target, kind, apply=True, scratch=tmp_path)
    actual = object_sqlite.read_object(target) if kind == "object" else object_sqlite.read_jsonl(target)
    assert actual == value
    assert receipt["source_unchanged"]
    assert source.read_bytes() == before


def test_preview_never_publishes_and_conflicting_target_is_never_replaced(tmp_path):
    source = tmp_path / "settings.json"
    source.write_text('{"keep": "source"}')
    target = source.with_suffix(".sqlite3")
    migrate_one(source, target, "object", apply=False, scratch=tmp_path)
    assert not target.exists()
    object_sqlite.write_object(target, {"keep": "newer canonical record"})
    before = target.read_bytes()
    with pytest.raises(RuntimeError, match="differ"):
        migrate_one(source, target, "object", apply=True, scratch=tmp_path)
    assert target.read_bytes() == before


def test_source_drift_prevents_publication(tmp_path, monkeypatch):
    source = tmp_path / "history.parquet"
    pq.write_table(pa.table({"Date": ["2026-01-01"], "Close": [1.0]}), source)
    target = source.with_suffix(".sqlite3")
    original_verify = frame_sqlite.verify_database
    changed = False

    def verify_then_change(path):
        nonlocal changed
        receipt = original_verify(path)
        if not changed:
            changed = True
            pq.write_table(pa.table({"Date": ["2026-01-01"], "Close": [2.0]}), source)
        return receipt

    monkeypatch.setattr(frame_sqlite, "verify_database", verify_then_change)
    with pytest.raises(RuntimeError, match="source changed"):
        migrate_one(source, target, "frame", apply=True, scratch=tmp_path)
    assert not target.exists()


def test_discovery_stays_within_selected_roots_and_refuses_target_collisions(tmp_path):
    market, settings, compute = (tmp_path / name for name in ("market", "settings", "compute"))
    for root in (market, settings, compute):
        root.mkdir()
    (settings / "archives").mkdir()
    (settings / "archives/immutable.json").write_text("{}")
    (settings / "active.json").write_text("{}")
    (compute / "events.jsonl").write_text('{}\n{}\n')
    with TemporaryDirectory(prefix="worthward-unselected-compute-") as unrelated:
        unrelated_source = Path(unrelated) / "private.json"
        unrelated_source.write_text('{"outside": true}')
        (compute / "unrelated.json").symlink_to(unrelated_source)
        entries = discover(market, settings, compute)
        assert {(source.name, kind) for source, _target, kind in entries} == {("active.json", "object"), ("events.jsonl", "events")}
    (compute / "events.json").write_text("{}")
    with pytest.raises(ValueError, match="same SQLite target"):
        discover(market, settings, compute)
