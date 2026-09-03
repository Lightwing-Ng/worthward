"""
Investment page regression tests.

Code version: v1.8.1
- Added: Investment transaction payloads repair an existing daily history
  cache that starts after the earliest ledger valuation date.
- Added: Investment API cache reads reapply HSBC current-cash boundary
  normalization after a non-USD cash-only refresh.
- Added: IBKR CNH deposits can be validated against BOCHK CNH withdrawals through the browser binding endpoint.
- Added: IBKR equivalent-USD funding rows can be validated against CNH BOCHK withdrawals through the browser binding endpoint.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from app import create_app
from app.infrastructure.storage import load_investment_store_payload, save_investment_store_payload
from app.services.investment_import import (
    build_investment_internal_transfer_binding_index,
    build_investment_internal_transfer_binding_key,
)
from app.web import runtime
from tests.factories.market import quote_profile_stub


def _write_price_history(path: Path, rows: list[tuple[str, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        {
            "Date": pd.to_datetime([date for date, _ in rows]),
            "Close": [close for _, close in rows],
        }
    ).to_parquet(path, index=False)


def test_investment_transactions_response_exposes_price_histories_and_failures(tmp_path, monkeypatch) -> None:
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        """
        {
          "starting_cash": "1,000.00",
          "transactions": [
            {
              "date": "2025-09-03",
              "ticker": "AAPL",
              "type": "buy",
              "quantity": 2,
              "price": 200,
              "amount": -400
            },
            {
              "date": "2025-09-04",
              "ticker": "MSFT",
              "type": "buy",
              "quantity": 1,
              "price": 300,
              "amount": -300
            }
          ]
        }
        """.strip(),
        encoding="utf-8",
    )

    _write_price_history(
        tmp_path / "historical" / "AAPL.parquet",
        [("2025-09-03", 201.25), ("2025-09-04", 202.50)],
    )

    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "history_store_path_for", lambda ticker: tmp_path / "historical" / f"{ticker}.parquet")
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])
    monkeypatch.setattr(runtime, "fetch_quote_profile", quote_profile_stub)
    monkeypatch.setattr(runtime, "load_profile_record", lambda ticker: None)
    monkeypatch.setattr(runtime, "has_logo_asset", lambda ticker: False)
    monkeypatch.setattr(runtime, "load_investment_cost_basis_method", lambda: "fifo")

    app = create_app()
    client = app.test_client()

    response = client.get("/api/investment/transactions")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["investment_cost_basis_method"] == "fifo"
    assert "AAPL" in payload["price_history_by_ticker"]
    assert payload["price_history_by_ticker"]["AAPL"][0]["date"] == "2025-09-03"
    assert payload["price_history_by_ticker"]["AAPL"][0]["close"] == 201.25
    assert any(item["ticker"] == "MSFT" for item in payload["price_history_failures"])


def test_investment_transactions_repair_history_before_earliest_ledger_date(
    tmp_path, monkeypatch
) -> None:
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        """
        {
          "transactions": [
            {
              "date": "2025-09-02",
              "ticker": "AAPL",
              "type": "buy",
              "quantity": 2,
              "price": 200,
              "amount": -400
            }
          ]
        }
        """.strip(),
        encoding="utf-8",
    )
    history_path = tmp_path / "historical" / "AAPL.parquet"
    _write_price_history(history_path, [("2025-09-03", 202.50)])

    refresh_calls: list[tuple[str, bool]] = []

    def _repair_history(ticker: str, *, force_full: bool = False):
        refresh_calls.append((ticker, force_full))
        _write_price_history(
            history_path,
            [("2025-09-01", 199.00), ("2025-09-02", 201.25), ("2025-09-03", 202.50)],
        )
        return history_path

    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(
        runtime,
        "INVESTMENT_TRANSACTIONS_CACHE_PATH",
        tmp_path / "investment_cache" / "transactions_payload.json",
    )
    monkeypatch.setattr(
        runtime,
        "history_store_path_for",
        lambda ticker: tmp_path / "historical" / f"{ticker}.parquet",
    )
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])
    monkeypatch.setattr(runtime, "refresh_history_store", _repair_history)
    monkeypatch.setattr(runtime, "fetch_quote_profile", quote_profile_stub)
    monkeypatch.setattr(runtime, "load_profile_record", lambda ticker: None)
    monkeypatch.setattr(runtime, "has_logo_asset", lambda ticker: False)

    app = create_app()
    client = app.test_client()

    response = client.get("/api/investment/transactions")
    payload = response.get_json()

    assert response.status_code == 200
    assert refresh_calls == [("AAPL", True)]
    assert payload["price_history_by_ticker"]["AAPL"][0] == {
        "date": "2025-09-01",
        "close": 199.00,
    }
    assert not any(
        item["ticker"] == "AAPL" and item["reason"] == "incomplete_coverage"
        for item in payload["price_history_failures"]
    )


def test_investment_transactions_read_repairs_hsbc_current_cash_boundary(
    tmp_path, monkeypatch
) -> None:
    investment_store_path = tmp_path / "investment.json"
    save_investment_store_payload(
        {
            "schema_version": "3.0.0",
            "broker": "multiple",
            "account": "multiple",
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
                "cash_ledger_balance": "100.00",
                "cash_ledger_balance_as_of": "2026-08-26",
                "cash_ledger_balance_source": "hsbc_usd_savings_ledger_balance",
                "cash_snapshot_authoritative": False,
                "hsbc_ending_cash_components": {"HKD:SAVINGS": "10.00"},
                "hsbc_cash_component_post_dates": {
                    "HKD:SAVINGS": "2026-08-31"
                },
            },
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "cash_ledger_balance": "100.00",
                    "cash_ledger_balance_as_of": "2026-08-26",
                    "cash_ledger_balance_source": "hsbc_usd_savings_ledger_balance",
                    "cash_snapshot_authoritative": False,
                    "ending_cash_base_currency_status": (
                        "authoritative_current_cash_boundary"
                    ),
                    "ending_cash_by_currency": {"HKD": "10.00"},
                    "hsbc_ending_cash_components": {"HKD:SAVINGS": "10.00"},
                    "hsbc_cash_component_post_dates": {
                        "HKD:SAVINGS": "2026-08-31"
                    },
                }
            },
            "transactions": [],
        },
        investment_store_path,
    )

    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(
        runtime,
        "INVESTMENT_TRANSACTIONS_CACHE_PATH",
        tmp_path / "investment-cache.json",
    )
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])
    monkeypatch.setattr(runtime, "load_investment_cost_basis_method", lambda: "fifo")

    response = create_app().test_client().get("/api/investment/transactions")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["summary"]["cash_snapshot_authoritative"] is True
    assert payload["broker_summaries"]["hsbc"]["cash_snapshot_authoritative"] is True
    assert payload["broker_summaries"]["hsbc"]["ending_cash"] == "100.00"

    cached_payload = json.loads(
        (tmp_path / "investment-cache.json").read_text(encoding="utf-8")
    )
    cached_payload["payload"]["summary"]["cash_snapshot_authoritative"] = False
    cached_payload["payload"]["broker_summaries"]["hsbc"][
        "cash_snapshot_authoritative"
    ] = False
    (tmp_path / "investment-cache.json").write_text(
        json.dumps(cached_payload),
        encoding="utf-8",
    )

    cached_response = create_app().test_client().get("/api/investment/transactions")
    cached_result = cached_response.get_json()

    assert cached_response.status_code == 200
    assert cached_result["investment_cache"]["status"] == "hit"
    assert cached_result["summary"]["cash_snapshot_authoritative"] is True
    assert cached_result["broker_summaries"]["hsbc"]["cash_snapshot_authoritative"] is True


def test_investment_transactions_skips_live_refresh_for_closed_tickers(tmp_path, monkeypatch) -> None:
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        """
        {
          "transactions": [
            {
              "date": "2023-02-16",
              "ticker": "SPLG.US",
              "type": "buy",
              "quantity_raw": "9",
              "price_raw": "48.5",
              "normalized": {
                "display_quantity": "9",
                "unit_price": "48.5",
                "net_amount": "-438.52"
              }
            },
            {
              "date": "2023-03-20",
              "ticker": "SPLG.US",
              "type": "sell",
              "quantity_raw": "9",
              "price_raw": "46.12",
              "normalized": {
                "display_quantity": "9",
                "unit_price": "46.12",
                "net_amount": "413.04"
              }
            }
          ]
        }
        """.strip(),
        encoding="utf-8",
    )

    refresh_calls: list[str] = []

    def _fake_refresh_history_store(ticker: str):
        refresh_calls.append(ticker)
        raise AssertionError("Closed tickers should not trigger live refresh on page load.")

    def _unexpected_profile_refresh(*_args, **_kwargs):
        raise AssertionError("Closed tickers should not trigger profile refresh on page load.")

    _write_price_history(
        tmp_path / "historical" / "SPLG.parquet",
        [("2023-03-20", 46.12)],
    )

    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "history_store_path_for", lambda ticker: tmp_path / "historical" / f"{ticker}.parquet")
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])
    monkeypatch.setattr(runtime, "refresh_history_store", _fake_refresh_history_store)
    monkeypatch.setattr(runtime, "fetch_quote_profile", _unexpected_profile_refresh)
    monkeypatch.setattr(runtime, "load_profile_record", lambda ticker: None)
    monkeypatch.setattr(runtime, "has_logo_asset", lambda ticker: False)

    app = create_app()
    client = app.test_client()

    response = client.get("/api/investment/transactions")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["success"] is True
    assert refresh_calls == []
    assert payload["section_freshness"]["open_tickers"] == []
    assert payload["price_history_by_ticker"]["SPLG"][0]["close"] == 46.12


def test_investment_transactions_skip_spy_proxy_for_splg_price_history(tmp_path, monkeypatch) -> None:
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        """
        {
          "transactions": [
            {
              "date": "2023-01-27",
              "ticker": "SPLG.US",
              "type": "grant",
              "quantity_raw": "1",
              "price_raw": "0",
              "normalized": {
                "position_quantity": "1",
                "display_quantity": "1",
                "unit_price": "0",
                "net_amount": "0"
              }
            },
            {
              "date": "2023-01-27",
              "ticker": "SPLG.US",
              "type": "buy",
              "quantity_raw": "24",
              "price_raw": "47.4600",
              "normalized": {
                "position_quantity": "24",
                "display_quantity": "24",
                "unit_price": "47.4600",
                "net_amount": "-1139.0400"
              }
            },
            {
              "date": "2023-02-16",
              "ticker": "SPLG.US",
              "type": "sell",
              "quantity_raw": "25",
              "price_raw": "48.2500",
              "normalized": {
                "position_quantity": "25",
                "display_quantity": "25",
                "unit_price": "48.2500",
                "net_amount": "1206.2500"
              }
            }
          ]
        }
        """.strip(),
        encoding="utf-8",
    )

    _write_price_history(
        tmp_path / "historical" / "SPY.parquet",
        [("2023-01-27", 405.68), ("2023-02-16", 408.28)],
    )

    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "history_store_path_for", lambda ticker: tmp_path / "historical" / f"{ticker}.parquet")
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])
    monkeypatch.setattr(runtime, "fetch_quote_profile", quote_profile_stub)
    monkeypatch.setattr(runtime, "load_profile_record", lambda ticker: None)
    monkeypatch.setattr(runtime, "has_logo_asset", lambda ticker: False)

    app = create_app()
    client = app.test_client()

    response = client.get("/api/investment/transactions")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["success"] is True
    assert "SPLG.US" not in payload["price_history_by_ticker"]
    assert any(item["ticker"] == "SPLG" for item in payload["price_history_failures"])


def test_investment_page_uses_context_page_title(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", tmp_path / "missing.json")
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    app = create_app()
    client = app.test_client()

    response = client.get("/trade/investment")
    html = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "<title>Investment</title>" in html


def test_internal_transfer_endpoint_rejects_ambiguous_old_key_and_accepts_row_key(tmp_path, monkeypatch) -> None:
    source_record = {
        "date": "2023-02-20",
        "type": "deposit",
        "broker": "usmart_hk",
        "account": "94412536",
        "currency": "HKD",
        "net_amount_raw": "100.00",
        "description": "eDDA Cash Deposit",
        "source": {"file_kind": "usmart_hk_statement_pdf", "row_number": 29},
    }
    target_records = [
        {
            "date": "2023-02-20",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "HKD",
            "net_amount_raw": "-100.00",
            "description": "TO USMART T453910QU272(09FEB02)",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 31},
        },
        {
            "date": "2023-02-20",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "HKD",
            "net_amount_raw": "-100.00",
            "description": "DEMO ACCOUNT HOLDER REF00000000000000 18FEB",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 33},
        },
    ]
    transactions = [source_record, *target_records]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    binding_index = build_investment_internal_transfer_binding_index(transactions)
    source_key = build_investment_internal_transfer_binding_key(source_record)
    old_target_key = build_investment_internal_transfer_binding_key(target_records[0])
    correct_target_key = next(
        key
        for key, records in binding_index.items()
        if records and records[0].get("description", "").startswith("TO USMART")
    )
    app = create_app()
    client = app.test_client()
    csrf_token = "a" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    rejected = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": old_target_key},
        headers=headers,
    )
    assert rejected.status_code == 400
    assert "ambiguous" in rejected.get_json()["error"]
    assert load_investment_store_payload(investment_store_path).get(
        "manual_internal_transfer_bindings"
    ) == {}

    accepted = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": correct_target_key},
        headers=headers,
    )
    assert accepted.status_code == 200
    assert accepted.get_json()["success"] is True
    saved = load_investment_store_payload(investment_store_path)
    assert saved["manual_internal_transfer_bindings"] == {
        source_key: correct_target_key,
    }

    second_source_record = {
        "date": "2023-02-20",
        "type": "deposit",
        "broker": "tigertrade",
        "account": "T***002",
        "currency": "HKD",
        "net_amount_raw": "100.00",
        "description": "Cash Deposit",
        "source": {"file_kind": "tigertrade_statement", "row_number": 34},
    }
    saved["transactions"].append(second_source_record)
    save_investment_store_payload(saved, investment_store_path)
    second_source_key = build_investment_internal_transfer_binding_key(second_source_record)
    reuse_rejected = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": second_source_key, "target_key": correct_target_key},
        headers=headers,
    )
    assert reuse_rejected.status_code == 400
    assert "already bound" in reuse_rejected.get_json()["error"]
    assert load_investment_store_payload(investment_store_path)[
        "manual_internal_transfer_bindings"
    ] == {source_key: correct_target_key}


def test_internal_transfer_endpoint_accepts_july_2025_bochk_bridge_for_longbridge_usd_deposit(
    tmp_path, monkeypatch
) -> None:
    hsbc_withdrawal = {
        "date": "2025-07-14",
        "type": "withdrawal",
        "broker": "hsbc",
        "account": "000-999999-999",
        "currency": "USD",
        "net_amount_raw": "-4.93",
        "description": "HK526893PI145183",
        "source": {"file_kind": "hsbc_usd_savings_csv", "row_number": 147},
    }
    bochk_deposit = {
        "date": "2025-07-14",
        "type": "deposit",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "USD",
        "net_amount_raw": "4.93",
        "description": "Transfer CHATS73609393BKRB5019",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 7},
    }
    bochk_withdrawal = {
        "date": "2025-07-14",
        "type": "withdrawal",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "USD",
        "net_amount_raw": "-4.94",
        "description": "Transfer E-BANKING TRANSFER",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 8},
    }
    longbridge_deposit = {
        "date": "2025-07-14",
        "type": "deposit",
        "broker": "longbridge_hk",
        "account": "H99999999",
        "currency": "USD",
        "net_amount_raw": "4.94",
        "description": "Deposit Cash",
        "source": {"file_kind": "longbridge_cash_flow", "row_number": 46},
    }
    transactions = [hsbc_withdrawal, bochk_deposit, bochk_withdrawal, longbridge_deposit]
    investment_store_path = tmp_path / "investment.json"
    existing_bindings = {
        build_investment_internal_transfer_binding_key(bochk_deposit): (
            build_investment_internal_transfer_binding_key(hsbc_withdrawal)
        ),
    }
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": existing_bindings,
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    binding_index = build_investment_internal_transfer_binding_index(transactions)
    source_key = next(
        key for key, records in binding_index.items() if records == [longbridge_deposit]
    )
    target_key = next(
        key for key, records in binding_index.items() if records == [bochk_withdrawal]
    )
    app = create_app()
    client = app.test_client()
    csrf_token = "d" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    response = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": target_key},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert load_investment_store_payload(investment_store_path)[
        "manual_internal_transfer_bindings"
    ] == {**existing_bindings, source_key: target_key}


def test_internal_transfer_endpoint_accepts_march_2023_bochk_fee_bridge_for_longbridge_usd_deposit(
    tmp_path, monkeypatch
) -> None:
    bochk_deposit = {
        "date": "2023-03-29",
        "type": "deposit",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "USD",
        "net_amount_raw": "1633.44",
        "description": "Clearing Cheque I-BANK-TEST-CHEQUE-001",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 7},
    }
    bochk_withdrawal = {
        "date": "2023-03-30",
        "type": "withdrawal",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "USD",
        "net_amount_raw": "-1633.44",
        "description": "Transfer EXPRESS TRF.(RTGS/CHATS)",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 8},
    }
    longbridge_deposit = {
        "date": "2023-03-31",
        "type": "deposit",
        "broker": "longbridge_hk",
        "account": "H99999999",
        "currency": "USD",
        "net_amount_raw": "1632.14",
        "description": "Deposit Cash",
        "source": {"file_kind": "longbridge_cash_flow", "row_number": 437},
    }
    transactions = [bochk_deposit, bochk_withdrawal, longbridge_deposit]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    binding_index = build_investment_internal_transfer_binding_index(transactions)
    source_key = next(
        key for key, records in binding_index.items() if records == [longbridge_deposit]
    )
    target_key = next(
        key for key, records in binding_index.items() if records == [bochk_withdrawal]
    )
    app = create_app()
    client = app.test_client()
    csrf_token = "e" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    response = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": target_key},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert load_investment_store_payload(investment_store_path)[
        "manual_internal_transfer_bindings"
    ] == {source_key: target_key}


def test_internal_transfer_endpoint_accepts_ibkr_cnh_deposit_from_bochk(
    tmp_path, monkeypatch
) -> None:
    bochk_withdrawal = {
        "date": "2026-06-19",
        "type": "withdrawal",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "CNH",
        "net_amount_raw": "-7500",
        "description": "Transfer FPS/Interactive Brokers LLC",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 112},
    }
    ibkr_deposit = {
        "date": "2026-06-19",
        "type": "deposit",
        "broker": "ibkr",
        "account": "U00000001",
        "currency": "CNH",
        "net_amount_raw": "7500",
        "description": "Electronic Fund Transfer",
        "source": {
            "file_kind": "ibkr_realized_summary_cash",
            "row_number": 371,
        },
    }
    transactions = [bochk_withdrawal, ibkr_deposit]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    binding_index = build_investment_internal_transfer_binding_index(transactions)
    source_key = next(
        key for key, records in binding_index.items() if records == [ibkr_deposit]
    )
    target_key = next(
        key for key, records in binding_index.items() if records == [bochk_withdrawal]
    )
    app = create_app()
    client = app.test_client()
    csrf_token = "f" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    response = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": target_key},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert load_investment_store_payload(investment_store_path)[
        "manual_internal_transfer_bindings"
    ] == {source_key: target_key}


def test_internal_transfer_endpoint_accepts_ibkr_equivalent_usd_deposit_from_bochk_cnh(
    tmp_path, monkeypatch
) -> None:
    bochk_withdrawal = {
        "date": "2026-06-19",
        "type": "withdrawal",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "CNH",
        "net_amount_raw": "-20000",
        "description": "Transfer FPS/Interactive Brokers LLC",
        "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 23},
    }
    ibkr_equivalent_deposit = {
        "date": "2026-06-19",
        "type": "deposit",
        "broker": "ibkr",
        "account": "U00000001",
        "currency": None,
        "net_amount_raw": "2948.20",
        "description": "Electronic Fund Transfer",
        "source": {"file_kind": "transactions", "row_number": 130},
    }
    transactions = [bochk_withdrawal, ibkr_equivalent_deposit]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    binding_index = build_investment_internal_transfer_binding_index(transactions)
    source_key = next(
        key
        for key, records in binding_index.items()
        if records == [ibkr_equivalent_deposit]
    )
    target_key = next(
        key for key, records in binding_index.items() if records == [bochk_withdrawal]
    )
    app = create_app()
    client = app.test_client()
    csrf_token = "g" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    response = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": target_key},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert load_investment_store_payload(investment_store_path)[
        "manual_internal_transfer_bindings"
    ] == {source_key: target_key}


def test_internal_transfer_endpoint_can_ignore_and_restore_false_positive_source(tmp_path, monkeypatch) -> None:
    source_record = {
        "date": "2025-03-24",
        "type": "deposit",
        "broker": "hsbc",
        "account": "000-999999-999",
        "currency": "HKD",
        "net_amount_raw": "2500.00",
        "description": "AIRWALLEX (HONG KONG) duplicate deposit",
        "source": {
            "file_kind": "hsbc_multi_currency_cash_account_text",
            "row_number": 2,
        },
    }
    target_record = {
        "date": "2025-03-25",
        "type": "withdrawal",
        "broker": "boc_hk",
        "account": "65640001",
        "currency": "HKD",
        "net_amount_raw": "-2500.00",
        "description": "BOCHK transfer outflow",
        "source": {
            "file_kind": "boc_hk_statement_pdf",
            "row_number": 3,
        },
    }
    transactions = [source_record, target_record]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
            "summary": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    source_key = build_investment_internal_transfer_binding_key(source_record)
    app = create_app()
    client = app.test_client()
    csrf_token = "c" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }

    ignored = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": "", "action": "ignore"},
        headers=headers,
    )

    assert ignored.status_code == 200
    ignored_payload = ignored.get_json()
    assert ignored_payload["manual_internal_transfer_bindings"] == {}
    assert ignored_payload["manual_internal_transfer_ignored_source_keys"] == [source_key]
    saved_after_ignore = load_investment_store_payload(investment_store_path)
    assert saved_after_ignore["transactions"] == transactions
    assert saved_after_ignore["manual_internal_transfer_bindings"] == {}
    assert saved_after_ignore["manual_internal_transfer_ignored_source_keys"] == [source_key]

    restored = client.post(
        "/api/investment/internal-transfer-binding",
        json={"source_key": source_key, "target_key": "", "action": "restore"},
        headers=headers,
    )

    assert restored.status_code == 200
    restored_payload = restored.get_json()
    assert restored_payload["manual_internal_transfer_bindings"] == {}
    assert restored_payload["manual_internal_transfer_ignored_source_keys"] == []
    saved_after_restore = load_investment_store_payload(investment_store_path)
    assert saved_after_restore["transactions"] == transactions
    assert saved_after_restore["manual_internal_transfer_bindings"] == {}
    assert saved_after_restore["manual_internal_transfer_ignored_source_keys"] == []


def test_internal_transfer_endpoint_rejects_cross_broker_security_date_gap(tmp_path, monkeypatch) -> None:
    source_record = {
        "date": "2026-07-30",
        "datetime": "2026-07-30 12:00:00",
        "type": "transfer_out",
        "broker": "ibkr",
        "account": "U***001",
        "ticker": "QQQI",
        "currency": "USD",
        "quantity_raw": "5",
        "quantity_abs": "5",
        "gross_amount_raw": "0",
        "net_amount_raw": "0",
        "description": "QQQI transfer out",
        "source": {
            "file_kind": "ibkr_csv",
            "row_number": 1,
            "broker": "ibkr",
            "account": "U***001",
        },
        "normalized": {
            "position_quantity": "5",
            "display_quantity": "5",
            "is_cash_flow": False,
        },
    }
    schwab_receipt = {
        "date": "2026-07-31",
        "datetime": "2026-07-31 12:00:00",
        "type": "transfer_in",
        "broker": "schwab",
        "account": "Individual ...001",
        "ticker": "QQQI",
        "currency": "USD",
        "quantity_raw": "5",
        "quantity_abs": "5",
        "gross_amount_raw": "0",
        "net_amount_raw": "0",
        "description": "QQQI transfer receipt",
        "source": {
            "file_kind": "schwab_transactions_csv",
            "row_number": 2,
            "broker": "schwab",
            "account": "Individual ...001",
        },
        "normalized": {
            "position_quantity": "5",
            "display_quantity": "5",
            "is_cash_flow": False,
        },
    }
    transactions = [source_record, schwab_receipt]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {},
            "manual_security_transfer_attributions": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    app = create_app()
    client = app.test_client()
    csrf_token = "b" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    response = client.post(
        "/api/investment/internal-transfer-binding",
        json={
            "source_key": build_investment_internal_transfer_binding_key(source_record),
            "target_key": build_investment_internal_transfer_binding_key(schwab_receipt),
        },
        headers={
            "Origin": "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            "X-CSRF-Token": csrf_token,
        },
    )

    assert response.status_code == 400
    assert "same calendar date" in response.get_json()["error"]
    assert load_investment_store_payload(investment_store_path).get(
        "manual_internal_transfer_bindings"
    ) == {}


def test_schwab_security_transfer_attribution_endpoint_is_csrf_protected_and_metadata_only(tmp_path, monkeypatch) -> None:
    source_buy = {
        "date": "2026-07-01",
        "datetime": "2026-07-01 12:00:00",
        "type": "buy",
        "broker": "ibkr",
        "account": "U***001",
        "ticker": "QQQI",
        "currency": "USD",
        "quantity_raw": "5",
        "quantity_abs": "5",
        "gross_amount_raw": "-250",
        "net_amount_raw": "-250",
        "description": "QQQI purchase",
        "source": {
            "file_kind": "ibkr_csv",
            "row_number": 1,
            "broker": "ibkr",
            "account": "U***001",
        },
    }
    schwab_receipt = {
        "date": "2026-07-31",
        "datetime": "2026-07-31 12:00:00",
        "type": "transfer_in",
        "broker": "schwab",
        "account": "Individual ...001",
        "ticker": "QQQI",
        "currency": "USD",
        "quantity_raw": "5",
        "quantity_abs": "5",
        "gross_amount_raw": "0",
        "net_amount_raw": "0",
        "description": "QQQI security transfer receipt",
        "source": {
            "file_kind": "schwab_transactions_csv",
            "row_number": 2,
            "broker": "schwab",
            "account": "Individual ...001",
        },
    }
    transactions = [source_buy, schwab_receipt]
    investment_store_path = tmp_path / "investment.json"
    investment_store_path.write_text(
        json.dumps({
            "transactions": transactions,
            "summary": {},
            "manual_internal_transfer_bindings": {},
            "manual_security_transfer_attributions": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime, "INVESTMENT_STORE_PATH", investment_store_path)
    monkeypatch.setattr(runtime, "ensure_latest_investment_daily_caches", lambda tickers: [])

    receipt_key = next(
        key
        for key, records in build_investment_internal_transfer_binding_index(transactions).items()
        if records == [schwab_receipt]
    )
    app = create_app()
    client = app.test_client()

    rejected = client.post(
        "/api/investment/security-transfer-attribution",
        json={
            "receipt_key": receipt_key,
            "source_broker": "ibkr",
            "source_account": "U***001",
        },
    )
    assert rejected.status_code == 403
    assert load_investment_store_payload(investment_store_path).get(
        "manual_security_transfer_attributions"
    ) == {}

    csrf_token = "b" * 32
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = csrf_token
    headers = {
        "Origin": "http://localhost",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf_token,
    }
    accepted = client.post(
        "/api/investment/security-transfer-attribution",
        json={
            "receipt_key": receipt_key,
            "source_broker": "ibkr",
            "source_account": "U***001",
        },
        headers=headers,
    )
    assert accepted.status_code == 200
    accepted_payload = accepted.get_json()
    assert accepted_payload["success"] is True
    assert accepted_payload["summary"]["security_transfer_reconciliation"][
        "aggregate_holdings_available"
    ] is True
    assert accepted_payload["summary"]["security_transfer_reconciliation"][
        "aggregate_overlay"
    ]["active_receipt_keys"] == [receipt_key]

    saved = load_investment_store_payload(investment_store_path)
    assert saved["manual_security_transfer_attributions"][receipt_key]["source_broker"] == "ibkr"
    assert saved["manual_security_transfer_attributions"][receipt_key]["source_account"] == "U***001"
    assert [record["type"] for record in saved["transactions"]] == ["buy", "transfer_in"]


def test_investment_market_session_honors_requested_trading_day_count(monkeypatch) -> None:
    requested_day_counts: list[int] = []

    monkeypatch.setattr(
        runtime,
        "nyse_market_session_state",
        lambda reference, **_kwargs: {
            "market": "us_equity",
            "session": "off",
            "session_date": "2026-07-17",
        },
    )

    def _recent_trading_days(reference, *, day_count: int = 5):
        requested_day_counts.append(day_count)
        return [f"2026-07-{day:02d}" for day in range(1, day_count + 1)]

    monkeypatch.setattr(runtime, "nyse_recent_trading_days", _recent_trading_days)

    response = create_app().test_client().get("/api/market-session/us-equity?day_count=23")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["success"] is True
    assert requested_day_counts == [23]
    assert len(payload["trading_days"]) == 23
