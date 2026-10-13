"""Protect ledger reads, migrations, and derived-cache boundaries.

Code version: v1.0.0
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import threading

import pandas as pd
import pytest
from flask import Flask

from app.infrastructure import storage
from app.services.investment_import import build_investment_payload_from_schwab_csv
from app.web import runtime
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload
from tests.python.web import test_investment_commit_concurrency as commit_support

commit_runtime = commit_support.commit_runtime


def _get_context(context):
    context.update(runtime.build_foundation_context(context))
    context.update(
        ensure_latest_investment_daily_caches=lambda tickers: [],
        load_investment_price_histories=lambda txns, open_tickers=None: ({}, []),
        build_investment_ticker_profiles=lambda txns, open_tickers: {},
        load_investment_realtime_quotes=lambda tickers: [],
    )
    return context


def _get(context):
    handler = runtime.build_investment_import_context(context)[
        "investment_get_transactions"
    ]
    with Flask(__name__).test_request_context("/api/investment/transactions"):
        response = handler()
        assert response.status_code == 200
        return response.get_json()


def test_get_never_labels_old_payload_with_new_ledger_version(commit_runtime):
    context, ledger, _cache = commit_runtime
    _get_context(context)
    commit = context["merge_and_write_investment_payload"]
    commit(buy_csv_payload())
    old_version = str(ledger.stat().st_mtime_ns)
    calls = []

    def concurrent_commit(_tickers):
        if not calls:
            calls.append(True)
            commit(buy_csv_payload(buys=(("10/13/2026", "51.50", "0"),)))
        return []

    context["ensure_latest_investment_daily_caches"] = concurrent_commit
    first = _get(context)
    assert first["investment_store_version"] == old_version
    second = _get(context)
    assert len(second["transactions"]) == 3
    assert second["investment_store_version"] == str(ledger.stat().st_mtime_ns)
    assert _get(context)["investment_cache"]["status"] == "hit"


@pytest.mark.parametrize("failure_kind", ["fx", "price"])
def test_transient_history_failure_is_retried_before_caching(
    commit_runtime, failure_kind
):
    context, ledger, _cache = commit_runtime
    calls = []

    def fx(_currency, start, end):
        calls.append(True)
        if len(calls) == 1:
            raise ValueError("Temporary FX outage")
        return pd.DataFrame({"Date": pd.date_range(start, end), "UsdPerUnit": 1 / 7.8})

    context["fetch_usd_exchange_rate_history"] = fx
    _get_context(context)
    payload = buy_csv_payload()
    if failure_kind == "fx":
        payload["transactions"][0]["currency"] = "HKD"
    else:

        def prices(_txns, open_tickers=None):
            calls.append(True)
            return {}, (
                [{"ticker": "DRAM", "reason": "incomplete_coverage"}]
                if len(calls) == 1
                else []
            )

        context["load_investment_price_histories"] = prices
    storage.save_investment_store_payload(payload, ledger)
    assert _get(context)["investment_cache"]["status"] == "miss"
    recovered = _get(context)
    assert recovered["investment_cache"]["status"] == "miss"
    assert len(calls) == 2
    if failure_kind == "fx":
        assert recovered["fx_rate_history_by_currency"]["HKD"]["values"]
    assert _get(context)["investment_cache"]["status"] == "hit"


def test_empty_activity_import_commits_and_reimports_snapshot_evidence(commit_runtime):
    context, ledger, _cache = commit_runtime
    original = buy_csv_payload()
    position_artifact = next(
        a
        for a in original["source_artifacts"]
        if a["source_kind"] == "schwab_positions_csv"
    )
    payload = build_investment_payload_from_schwab_csv(
        b"Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount\n",
        base64.b64decode(position_artifact["content_base64"]),
        transaction_filename="transactions.csv",
        positions_filename="positions.csv",
    )
    assert payload["transactions"] == []
    commit = runtime.build_foundation_context(context)[
        "merge_and_write_investment_payload"
    ]
    for _ in range(2):
        result = commit(payload)
        assert result["transactions"] == []
        assert result["broker_snapshots"]
        assert len(result["source_artifacts"]) == 2
        storage.verify_investment_source_artifacts(result, ledger)


@pytest.mark.parametrize(
    "section,value",
    [("transactions", "{"), ("transactions", "[]"), ("source_artifacts", "{")],
)
def test_corrupt_json_cells_abort_before_next_import(commit_runtime, section, value):
    context, ledger, _cache = commit_runtime
    commit = runtime.build_foundation_context(context)[
        "merge_and_write_investment_payload"
    ]
    commit(buy_csv_payload())
    table = pd.read_parquet(ledger)
    table.loc[table.index[table["section"] == section][0], "value_json"] = value
    table.to_parquet(ledger, index=False)
    original = ledger.read_bytes()
    with pytest.raises(RuntimeError, match="read safely"):
        storage.load_investment_store_payload(ledger)
    with pytest.raises(RuntimeError, match="read safely"):
        commit(buy_csv_payload(buys=(("10/13/2026", "51.50", "0"),)))
    assert ledger.read_bytes() == original


def test_legacy_migration_cannot_overwrite_concurrent_parquet_write(
    commit_runtime, monkeypatch
):
    _context, ledger, _cache = commit_runtime
    legacy = ledger.with_suffix(".json")
    legacy.write_text(json.dumps({"transactions": [], "marker": "legacy"}))
    read_started = threading.Event()
    write_started = threading.Event()
    write_done = threading.Event()
    original_read = Path.read_text
    outcomes = []

    def read_with_interleaving(path, *args, **kwargs):
        text = original_read(path, *args, **kwargs)
        if path == legacy:
            read_started.set()
            assert write_started.wait(5)
            write_done.wait(0.2)
        return text

    def writer():
        assert read_started.wait(5)
        write_started.set()
        storage.save_investment_store_payload(
            {"transactions": [], "marker": "new"}, ledger
        )
        write_done.set()

    monkeypatch.setattr(Path, "read_text", read_with_interleaving)
    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    outcomes.append(storage.load_investment_store_payload(ledger))
    thread.join(5)
    assert not thread.is_alive()
    assert outcomes[0]["marker"] == "legacy"
    assert storage.load_investment_store_payload(ledger)["marker"] == "new"
