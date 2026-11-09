"""Protect ledger reads, migrations, and derived-cache boundaries.

Code version: v1.1.1
"""

from __future__ import annotations

import base64
import hashlib
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
        CREDIT_CARD_STORE_PATH=context["INVESTMENT_STORE_PATH"].parent / "credit_cards.sqlite3",
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
            commit(
                buy_csv_payload(
                    buys=(
                        ("10/13/2026", "52.15", "0"),
                        ("10/13/2026", "51.50", "0"),
                    ),
                    positions_time="09:01 AM",
                )
            )
        return []

    context["ensure_latest_investment_daily_caches"] = concurrent_commit
    first = _get(context)
    assert first["investment_store_version"] == old_version
    second = _get(context)
    assert len(second["transactions"]) == 3
    assert second["investment_store_version"] == str(ledger.stat().st_mtime_ns)
    assert _get(context)["investment_cache"]["status"] == "hit"


@pytest.mark.parametrize(
    "failure_kind,currency", [("fx", "HKD"), ("fx", "SGD"), ("price", "USD")]
)
def test_transient_history_failure_is_retried_before_caching(
    commit_runtime, failure_kind, currency
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
        payload["transactions"][0]["currency"] = currency
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
        assert recovered["fx_rate_history_by_currency"][currency]["values"]
    assert _get(context)["investment_cache"]["status"] == "hit"


def test_investment_fx_payload_uses_supported_currencies_and_canonical_rmb_aliases(
    commit_runtime,
):
    context, _ledger, _cache = commit_runtime
    requested = []

    def fx(currency, _start, _end):
        requested.append(currency)
        return pd.DataFrame({
            "Date": [pd.Timestamp("2026-01-02")], "UsdPerUnit": [0.75],
        })

    context["fetch_usd_exchange_rate_history"] = fx
    _get_context(context)
    rows = [
        {"type": "kol_reward", "date": "2026-01-02", "currency": currency}
        for currency in ["USD", "HKD", "CNY", "CNH", "RMB", "SGD", "KRW", "ZZZ"]
    ]
    histories = context["build_investment_fx_rate_history_payload"](rows)
    assert requested == ["CNY", "HKD", "KRW", "SGD"]
    assert histories["SGD"]["values"] == {"2026-01-02": pytest.approx(1 / 0.75)}
    assert histories["CNH"] == histories["CNY"]
    assert "USD" not in histories
    assert "ZZZ" not in histories


@pytest.mark.parametrize("cached_history", ["missing", "empty", "malformed"])
def test_incomplete_cached_sgd_reward_fx_is_rebuilt_without_changing_ledgers(
    commit_runtime, cached_history
):
    context, ledger, cache = commit_runtime
    production_root = Path(__file__).resolve().parents[3] / "settings_store"
    production_paths = [
        production_root / "investment.sqlite3", production_root / "credit_cards.sqlite3",
    ]
    production_digests = {
        path: hashlib.sha256(path.read_bytes()).digest() if path.exists() else None
        for path in production_paths
    }
    calls = []

    def fx(currency, _start, _end):
        calls.append(currency)
        return pd.DataFrame({
            "Date": [pd.Timestamp("2026-01-02")], "UsdPerUnit": [0.75],
        })

    context["fetch_usd_exchange_rate_history"] = fx
    _get_context(context)
    storage.save_investment_store_payload({"transactions": [{
        "id": "synthetic-sgd-reward",
        "broker": "longbridge_sg", "account": "SYNTHETIC-SG", "ticker": "",
        "type": "kol_reward", "currency": "SGD", "date": "2026-01-02",
        "normalized": {"net_amount": "25", "cash_flow_amount": "25", "is_cash_flow": True},
    }]}, ledger)
    ledger_before = ledger.read_bytes()
    assert _get(context)["investment_cache"]["status"] == "miss"
    assert _get(context)["investment_cache"]["status"] == "hit"
    cached = json.loads(cache.read_text())
    histories = cached["payload"]["fx_rate_history_by_currency"]
    if cached_history == "missing":
        del histories["SGD"]
    elif cached_history == "empty":
        histories["SGD"] = {"dates": [], "values": {}}
    else:
        histories["SGD"] = "unavailable"
    context["write_json_atomic"](cache, cached)

    repaired = _get(context)
    assert repaired["investment_cache"]["status"] == "miss"
    assert repaired["fx_rate_history_by_currency"]["SGD"]["values"] == {
        "2026-01-02": pytest.approx(1 / 0.75),
    }
    assert calls == ["SGD", "SGD"]
    assert _get(context)["investment_cache"]["status"] == "hit"
    assert ledger.read_bytes() == ledger_before
    for path, digest in production_digests.items():
        assert (hashlib.sha256(path.read_bytes()).digest() if path.exists() else None) == digest


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
