"""Verify observed native reader entrypoints and explicit trace limitations.

Code version: v1.0.0
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.dataset as dataset
import pyarrow.fs as arrow_fs
import pyarrow.parquet as parquet
import pytest

from scripts.audit_investment_storage_ablation import install_native_read_tracing


@pytest.fixture
def parquet_case(tmp_path):
    case = tmp_path / "case"
    protected = tmp_path / "protected"
    case.mkdir()
    protected.mkdir()
    table = pa.table({"value": [1, 2]})
    parquet.write_table(table, case / "input.parquet")
    parquet.write_table(table, protected / "input.parquet")
    return case, protected


def install_guard(case, protected, monkeypatch):
    reads, attempts = Counter(), Counter()

    def classify(value):
        path = Path(value).resolve()
        if path.is_relative_to(protected):
            raise PermissionError("A native test reader crossed its protected root.")
        return str(path.relative_to(case)) if path.is_relative_to(case) else None

    trace = install_native_read_tracing(classify, reads, attempts, patcher=monkeypatch.setattr)
    return trace, reads, attempts


@pytest.mark.parametrize("reader", ["pandas", "arrow_table", "arrow_pandas", "arrow_dataset"])
def test_successful_native_path_reads_are_observed(parquet_case, monkeypatch, reader):
    case, protected = parquet_case
    trace, reads, attempts = install_guard(case, protected, monkeypatch)
    path = case / "input.parquet"
    if reader == "pandas":
        # This explicit Arrow filesystem bypasses pandas' normal Python get_handle path.
        result = pd.read_parquet(path=path, filesystem=arrow_fs.LocalFileSystem())
        assert result["value"].tolist() == [1, 2]
        entrypoint = "pandas.read_parquet"
    elif reader == "arrow_table":
        assert parquet.read_table(source=path).column("value").to_pylist() == [1, 2]
        entrypoint = "pyarrow.parquet.read_table"
    elif reader == "arrow_pandas":
        assert parquet.read_pandas(source=path).column("value").to_pylist() == [1, 2]
        entrypoint = "pyarrow.parquet.read_pandas"
    else:
        assert dataset.dataset(source=[str(path)], format="parquet").to_table().num_rows == 2
        entrypoint = "pyarrow.dataset.dataset"
    assert reads["input.parquet"] >= 1 and attempts["input.parquet"] >= 1
    assert trace["successful_entrypoint_calls"][entrypoint] >= 1


@pytest.mark.parametrize(
    "reader", ["pandas", "arrow_table", "arrow_pandas", "arrow_dataset", "memory_map", "input_stream"],
)
def test_protected_source_is_blocked_before_native_consumption(parquet_case, monkeypatch, reader):
    case, protected = parquet_case
    _trace, reads, _attempts = install_guard(case, protected, monkeypatch)
    path = protected / "input.parquet"
    with pytest.raises(PermissionError, match="protected root"):
        if reader == "pandas":
            pd.read_parquet(path=path, filesystem=arrow_fs.LocalFileSystem())
        elif reader == "arrow_table":
            parquet.read_table(source=path)
        elif reader == "arrow_pandas":
            parquet.read_pandas(source=path)
        elif reader == "arrow_dataset":
            dataset.dataset(source=[str(path)], format="parquet")
        elif reader == "memory_map":
            pa.memory_map(path=str(path), mode="r")
        else:
            pa.input_stream(source=str(path))
    assert not reads


def test_unresolved_filesystem_context_cannot_rebase_an_allowed_path(parquet_case, monkeypatch):
    case, protected = parquet_case
    trace, reads, _attempts = install_guard(case, protected, monkeypatch)
    rebased = arrow_fs.SubTreeFileSystem(str(protected), arrow_fs.LocalFileSystem())
    with pytest.raises(PermissionError, match="filesystem context"):
        parquet.read_table("input.parquet", filesystem=rebased)
    assert trace["unsupported_filesystem_calls"] == 1 and not reads


def test_direct_native_classes_are_preserved_and_reported_as_uncovered(parquet_case, monkeypatch):
    case, protected = parquet_case
    native_file_class = pa.OSFile
    native_filesystem_class = arrow_fs.LocalFileSystem
    trace, _reads, _attempts = install_guard(case, protected, monkeypatch)
    assert pa.OSFile is native_file_class
    assert arrow_fs.LocalFileSystem is native_filesystem_class
    assert any("Direct pyarrow.OSFile" in value for value in trace["remaining_blind_spots"])
    assert any("Arbitrary C/OS" in value for value in trace["remaining_blind_spots"])


def test_nonlocal_native_uri_is_rejected(parquet_case, monkeypatch):
    case, protected = parquet_case
    _trace, reads, _attempts = install_guard(case, protected, monkeypatch)
    with pytest.raises(PermissionError, match="nonlocal source URI"):
        parquet.read_table(source="s3://unreachable-ablation-test/input.parquet")
    assert not reads


def test_paused_verification_counts_keep_source_guards_active(parquet_case, monkeypatch):
    case, protected = parquet_case
    reads, attempts = Counter(), Counter()
    enabled = [False]

    def classify(value):
        path = Path(value).resolve()
        if path.is_relative_to(protected):
            raise PermissionError("protected root")
        return path.name if path.is_relative_to(case) else None

    trace = install_native_read_tracing(
        classify, reads, attempts, patcher=monkeypatch.setattr,
        is_recording=lambda: enabled[0],
    )
    assert parquet.read_table(case / "input.parquet").num_rows == 2
    assert not reads and not attempts and not trace["successful_entrypoint_calls"]
    with pytest.raises(PermissionError, match="protected root"):
        parquet.read_table(protected / "input.parquet")
    enabled[0] = True
    assert parquet.read_table(case / "input.parquet").num_rows == 2
    assert reads["input.parquet"] >= 1 and attempts["input.parquet"] >= 1
