"""Keep investment reads bound to their canonical ledger and auxiliary evidence.

Code version: v1.0.0
"""

from __future__ import annotations

import json
import os

from flask import Flask
import pytest

from app.core.object_sqlite import read_structured_object, write_structured_object
from app.infrastructure import storage
from app.services.investment.importing import basics
from app.web import runtime
from tests.python.infrastructure import test_investment_sqlite as sqlite_support
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload
from tests.python.web import test_investment_commit_concurrency as commit_support

commit_runtime = commit_support.commit_runtime
protected_store_guard = sqlite_support.protected_store_guard


@pytest.fixture
def dependency_runtime(commit_runtime, monkeypatch):
    context, original_path, cache_path = commit_runtime
    ledger_path = original_path.with_suffix(".sqlite3")
    private_path = original_path.parent / "private_investment_evidence.sqlite3"
    context.update(
        INVESTMENT_STORE_PATH=ledger_path,
        PRIVATE_INVESTMENT_EVIDENCE_PATH=private_path,
    )
    monkeypatch.setattr(basics, "PRIVATE_INVESTMENT_EVIDENCE_PATH", private_path)
    context.update(runtime.build_foundation_context(context))
    context.update(
        ensure_latest_investment_daily_caches=lambda tickers: [],
        load_investment_price_histories=lambda txns, open_tickers=None: ({}, []),
        build_investment_ticker_profiles=lambda txns, open_tickers: {},
        load_investment_realtime_quotes=lambda tickers: [],
    )
    return context, ledger_path, cache_path, private_path


def _get(context):
    handler = runtime.build_investment_import_context(context)[
        "investment_get_transactions"
    ]
    with Flask(__name__).test_request_context("/api/investment/transactions"):
        response = handler()
        return response.status_code, response.get_json()


def _successful_get(context):
    status, data = _get(context)
    assert status == 200
    assert data["success"] is True
    return data


def _write_private(path, revision):
    before = path.stat().st_mtime_ns if path.exists() else 0
    write_structured_object(path, {"isolated_revision": revision})
    # Make revision changes deterministic even on filesystems with coarse clocks.
    modified = max(path.stat().st_mtime_ns, before + 1_000_000)
    os.utime(path, ns=(modified, modified))


def test_auxiliary_evidence_creation_change_and_removal_invalidate_warm_cache(
    dependency_runtime,
):
    context, ledger, cache, private = dependency_runtime
    storage.save_investment_store_payload(buy_csv_payload(), ledger)
    original_ledger = ledger.read_bytes()
    baseline = _successful_get(context)
    assert baseline["investment_cache"]["status"] == "miss"
    assert _successful_get(context)["investment_cache"]["status"] == "hit"

    for revision in ("A", "B", None):
        if revision is None:
            private.unlink()
        else:
            _write_private(private, revision)
        refreshed = _successful_get(context)
        assert refreshed["investment_cache"]["status"] == "miss"
        assert refreshed["transactions"] == baseline["transactions"]
        assert _successful_get(context)["investment_cache"]["status"] == "hit"
        persisted = read_structured_object(cache)
        assert persisted["private_investment_evidence"] == context[
            "build_private_investment_evidence_fingerprint"
        ]()
    assert ledger.read_bytes() == original_ledger


def test_cache_without_auxiliary_dependency_never_counts_as_a_hit(dependency_runtime):
    context, ledger, cache, _private = dependency_runtime
    storage.save_investment_store_payload(buy_csv_payload(), ledger)
    _successful_get(context)
    cached = read_structured_object(cache)
    cached.pop("private_investment_evidence")
    write_structured_object(cache, cached)
    assert _successful_get(context)["investment_cache"]["status"] == "miss"
    assert "private_investment_evidence" in read_structured_object(cache)
    assert _successful_get(context)["investment_cache"]["status"] == "hit"


def test_auxiliary_change_during_load_cannot_label_old_payload_with_new_revision(
    dependency_runtime,
):
    context, ledger, cache, private = dependency_runtime
    storage.save_investment_store_payload(buy_csv_payload(), ledger)
    _write_private(private, "Before")
    refresh_calls = []

    def concurrent_private_change(_tickers):
        refresh_calls.append(True)
        if len(refresh_calls) == 1:
            _write_private(private, "After")
        return []

    context["ensure_latest_investment_daily_caches"] = concurrent_private_change
    assert _successful_get(context)["investment_cache"]["status"] == "miss"
    assert not cache.exists()
    assert _successful_get(context)["investment_cache"]["status"] == "miss"
    assert _successful_get(context)["investment_cache"]["status"] == "hit"
    assert len(refresh_calls) == 2


@pytest.mark.parametrize("suffix", [".parquet", ".json"])
def test_legacy_only_store_returns_explicit_failure_without_loading_it(
    dependency_runtime, suffix
):
    context, ledger, _cache, _private = dependency_runtime
    legacy = ledger.with_suffix(suffix)
    payload = buy_csv_payload()
    if suffix == ".parquet":
        storage.save_investment_store_payload(payload, legacy)
    else:
        legacy.write_text(json.dumps(payload), encoding="utf-8")
    original = legacy.read_bytes()

    def forbidden_legacy_load():
        pytest.fail("A missing canonical ledger must not load a legacy shadow.")

    context["load_normalized_investment_payload"] = forbidden_legacy_load
    status, data = _get(context)
    assert status == 500
    assert data["success"] is False
    assert "Explicitly migrate" in data["error"]
    assert not ledger.exists()
    assert legacy.read_bytes() == original


def test_fresh_empty_store_ignores_backup_named_files(dependency_runtime):
    context, ledger, _cache, _private = dependency_runtime
    backup = ledger.with_name("investment.parquet.before-isolated-shadow-test.bak")
    backup.write_text(json.dumps(buy_csv_payload()), encoding="utf-8")
    original = backup.read_bytes()
    data = _successful_get(context)
    assert data["transactions"] == []
    assert not ledger.exists()
    assert backup.read_bytes() == original


def test_corrupt_canonical_does_not_fall_back_to_valid_legacy_files(dependency_runtime):
    context, ledger, _cache, _private = dependency_runtime
    payload = buy_csv_payload()
    parquet = ledger.with_suffix(".parquet")
    legacy_json = ledger.with_suffix(".json")
    storage.save_investment_store_payload(payload, parquet)
    legacy_json.write_text(json.dumps(payload), encoding="utf-8")
    ledger.write_bytes(b"Corrupted isolated canonical ledger")
    original = {path: path.read_bytes() for path in (ledger, parquet, legacy_json)}
    status, data = _get(context)
    assert status == 500
    assert data["success"] is False
    assert {path: path.read_bytes() for path in original} == original
