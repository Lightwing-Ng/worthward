"""Apply the production import and cache contracts to SQLite ledgers.

Code version: v1.0.0
"""

from __future__ import annotations

import pytest

from app.infrastructure import investment_sqlite, storage
from app.web import runtime
from tests.python.infrastructure import test_investment_sqlite as sqlite_support
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload
from tests.python.web import test_investment_commit_concurrency as commit_support
from tests.python.web import test_investment_persistence_audit as persistence_support

protected_store_guard = sqlite_support.protected_store_guard


@pytest.fixture
def sqlite_commit_runtime(tmp_path):
    context = runtime._build_runtime_context()
    ledger_path = tmp_path / "investment.sqlite3"
    cache_path = tmp_path / "investment_cache/transactions_payload.json"
    context.update(
        INVESTMENT_STORE_PATH=ledger_path,
        INVESTMENT_TRANSACTIONS_CACHE_PATH=cache_path,
    )
    return context, ledger_path, cache_path


def test_runtime_sqlite_import_verifies_evidence_and_idempotent_readback(sqlite_commit_runtime):
    context, ledger, _cache = sqlite_commit_runtime
    commit = runtime.build_foundation_context(context)["merge_and_write_investment_payload"]
    reference_context = runtime._build_runtime_context()
    reference_context.update(
        INVESTMENT_STORE_PATH=ledger.parent / "reference.parquet",
        INVESTMENT_TRANSACTIONS_CACHE_PATH=ledger.parent / "reference-cache.json",
    )
    reference_commit = runtime.build_foundation_context(reference_context)[
        "merge_and_write_investment_payload"
    ]
    payload = buy_csv_payload()
    first = commit(payload)
    reference_first = reference_commit(payload)
    assert first["transactions"]
    assert first["broker_snapshots"]
    assert len(first["source_artifacts"]) == len(payload["source_artifacts"])
    assert all("content_base64" not in artifact for artifact in first["source_artifacts"])
    second = commit(payload)
    reference_second = reference_commit(payload)
    # Reimports may retain additional source aliases under the existing merger.
    # Both backends must expose the same full records at each import boundary.
    for actual, reference in ((first, reference_first), (second, reference_second)):
        for section in ("transactions", "source_artifacts", "broker_snapshots"):
            assert actual[section] == reference[section]
    assert len(second["transactions"]) == len(first["transactions"])
    assert second["source_artifacts"] == first["source_artifacts"]
    assert second["broker_snapshots"] == first["broker_snapshots"]
    persisted = storage.load_investment_store_payload(ledger)
    assert persisted["transactions"] == second["transactions"]
    storage.verify_investment_source_artifacts(persisted, ledger)
    assert storage.verify_persisted_investment_source_artifacts(ledger) == len(first["source_artifacts"])
    assert isinstance(investment_sqlite.verify_database(ledger), dict)
    assert not ledger.with_suffix(".parquet").exists()


def test_runtime_concurrent_sqlite_imports_verify_their_own_snapshot(sqlite_commit_runtime):
    commit_support.test_concurrent_imports_verify_their_own_committed_snapshot(sqlite_commit_runtime)


def test_runtime_sqlite_import_rejects_corrupted_readback(sqlite_commit_runtime):
    commit_support.test_commit_still_rejects_corrupted_readback(sqlite_commit_runtime)


def test_runtime_failed_source_bytes_preserve_sqlite_ledger(sqlite_commit_runtime, monkeypatch):
    commit_support.test_failed_import_preserves_prior_ledger_and_releases_lock(
        sqlite_commit_runtime,
        monkeypatch,
        "source_bytes",
    )


def test_runtime_sqlite_payload_and_cache_version_share_one_snapshot(sqlite_commit_runtime):
    persistence_support.test_get_never_labels_old_payload_with_new_ledger_version(sqlite_commit_runtime)
