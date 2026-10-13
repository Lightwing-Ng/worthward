"""Exercise import commit isolation through the production runtime composition.

Code version: v1.0.0
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
from pathlib import Path
import threading

import pytest

from app.infrastructure import storage
from app.web import runtime
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload


@pytest.fixture
def commit_runtime(tmp_path):
    production_path = Path(__file__).resolve().parents[3] / "settings_store/investment.parquet"
    original_digest = (
        hashlib.sha256(production_path.read_bytes()).digest()
        if production_path.exists()
        else None
    )
    ledger_path = tmp_path / "investment.parquet"
    cache_path = tmp_path / "investment_cache/transactions_payload.json"
    assert ledger_path.resolve() != production_path.resolve()
    context = runtime._build_runtime_context()
    context.update(
        INVESTMENT_STORE_PATH=ledger_path,
        INVESTMENT_TRANSACTIONS_CACHE_PATH=cache_path,
    )
    yield context, ledger_path, cache_path
    assert (
        hashlib.sha256(production_path.read_bytes()).digest()
        if production_path.exists()
        else None
    ) == original_digest


def _compose_commit(context):
    return runtime.build_foundation_context(context)["merge_and_write_investment_payload"]


def test_concurrent_imports_verify_their_own_committed_snapshot(commit_runtime):
    context, ledger_path, cache_path = commit_runtime
    first_written = threading.Event()
    second_started = threading.Event()
    second_finished = threading.Event()
    outcomes = {}

    @contextmanager
    def pause_first_readback(path):
        if Path(path) == cache_path and threading.current_thread().name == "import-first":
            first_written.set()
            assert second_started.wait(5), "The second importer never started."
            # Allow a competing commit to finish if the ledger lock was released.
            # Correct serialization leaves it blocked until this readback completes.
            second_finished.wait(1)
        with storage.market_store_file_lock(path):
            yield

    context["market_store_file_lock"] = pause_first_readback
    commit = _compose_commit(context)
    payloads = {
        "first": buy_csv_payload(buys=(("10/13/2026", "52.15", "0"),)),
        "second": buy_csv_payload(buys=(("10/13/2026", "51.50", "0"),)),
    }

    def run_import(label):
        try:
            if label == "second":
                assert first_written.wait(5), "The first importer never persisted."
                second_started.set()
            outcomes[label] = commit(payloads[label])
        except Exception as exc:  # Preserve worker failures for the test thread.
            outcomes[label] = exc
        finally:
            if label == "second":
                second_finished.set()

    threads = [
        threading.Thread(target=run_import, args=(label,), name=f"import-{label}", daemon=True)
        for label in ("first", "second")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
        assert not thread.is_alive(), "The nested ledger lock deadlocked."

    assert not isinstance(outcomes["first"], Exception), str(outcomes["first"])
    assert not isinstance(outcomes["second"], Exception), str(outcomes["second"])
    assert len(outcomes["first"]["transactions"]) == 2
    assert len(outcomes["second"]["transactions"]) == 3
    persisted = storage.load_investment_store_payload(ledger_path)
    assert sorted(
        row["price_raw"] for row in persisted["transactions"] if row.get("type") == "buy"
    ) == ["51.50", "52.15"]
    assert len(persisted["source_artifacts"]) == 3
    storage.verify_investment_source_artifacts(persisted, ledger_path)
    assert commit(payloads["first"])["transactions"] == persisted["transactions"]


def test_commit_still_rejects_corrupted_readback(commit_runtime):
    context, ledger_path, _cache_path = commit_runtime
    load_count = 0

    def corrupted_readback(path):
        nonlocal load_count
        payload = storage.load_investment_store_payload(path)
        load_count += 1
        if load_count == 2:
            payload = deepcopy(payload)
            payload["transactions"] = []
        return payload

    context["load_investment_store_payload"] = corrupted_readback
    with pytest.raises(RuntimeError, match="readback did not match committed transactions"):
        _compose_commit(context)(buy_csv_payload())
    assert len(storage.load_investment_store_payload(ledger_path)["transactions"]) == 2
    storage.verify_persisted_investment_source_artifacts(ledger_path)


@pytest.mark.parametrize("failure", ["source_bytes", "ledger_write"])
def test_failed_import_preserves_prior_ledger_and_releases_lock(
    commit_runtime, monkeypatch, failure
):
    context, ledger_path, _cache_path = commit_runtime
    commit = _compose_commit(context)
    commit(buy_csv_payload())
    original_bytes = ledger_path.read_bytes()
    incoming = buy_csv_payload(buys=(("10/13/2026", "51.50", "0"),))
    if failure == "source_bytes":
        rejected = deepcopy(incoming)
        rejected["source_artifacts"][0]["content_base64"] = "bm90IHRoZSBzb3VyY2U="
        with pytest.raises(ValueError, match="SHA-256 does not match"):
            commit(rejected)
    else:
        original_writer = storage._write_parquet_table

        def failed_writer(path, *args, **kwargs):
            if Path(path) == ledger_path:
                raise OSError("Isolated disk write failure")
            return original_writer(path, *args, **kwargs)

        with monkeypatch.context() as patch:
            patch.setattr(storage, "_write_parquet_table", failed_writer)
            with pytest.raises(OSError, match="Isolated disk write failure"):
                commit(incoming)
    assert ledger_path.read_bytes() == original_bytes
    storage.verify_persisted_investment_source_artifacts(ledger_path)
    assert len(commit(incoming)["transactions"]) == 3
    storage.verify_persisted_investment_source_artifacts(ledger_path)
