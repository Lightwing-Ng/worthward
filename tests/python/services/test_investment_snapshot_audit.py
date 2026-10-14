"""Protect dated cash, per-account snapshots, and import summary evidence.

Code version: v1.0.1
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
from unittest.mock import patch

import pytest

from app.services import investment_import as service
from app.services.investment.importing import payload_summaries
from app.services.investment.importing.brokers.hsbc import statements
from app.services.investment.importing.merge import identity
from tests.python.services.test_hsbc_capture_evidence import _statement_text
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin as Fixtures,
)


@pytest.mark.parametrize("include_usd", [False, True])
@pytest.mark.parametrize("legacy_inference", [False, True])
def test_foreign_only_hsbc_statement_cannot_infer_a_usd_tail_balance(
    include_usd, legacy_inference
):
    raw = b"isolated native-currency statement"
    payload = statements.build_investment_payload_from_hsbc_statement_pdfs(
        [(raw, "statement.pdf")],
        _extracted_text_by_payload_id={id(raw): _statement_text(include_usd)},
    )
    if legacy_inference:
        payload["broker_summaries"]["hsbc"].update(
            ending_cash="7190.00",
            ending_cash_raw="7190.00",
            calibration_source="hsbc_transaction_balance_inference",
        )
    for _ in range(2):
        payload = service.normalize_investment_payload_tickers(payload)
        summary = payload["broker_summaries"]["hsbc"]
        assert summary.get("ending_cash") == ("1010.00" if include_usd else None)
        assert summary.get("ending_cash_base_currency") == (
            "1010.00" if include_usd else None
        )
        assert summary["ending_cash_by_currency"]["CNH"] == "7190.00"
        assert summary["ending_cash_by_currency"]["HKD"] == "7836.10"
        assert ("USD" in summary["ending_cash_by_currency"]) is include_usd


def test_reimport_retains_current_schwab_validation_feedback():
    incoming = buy_csv_payload()
    merged = service.merge_investment_payloads(deepcopy(incoming), deepcopy(incoming))
    assert (
        merged["summary"]["schwab_positions_validation"]
        == incoming["summary"]["schwab_positions_validation"]
    )
    assert merged["generator"]["name"] != "ibkr_csv_to_investment_json"


@pytest.mark.parametrize("broker", ["ibkr", "schwab", "bochk"])
def test_explicit_zero_native_cash_survives_summary_normalization(broker):
    summary = payload_summaries._build_broker_summary_from_payload(
        {
            "broker": broker,
            "account": "TEST-ACCOUNT",
            "summary": {},
            "ending_cash_by_currency": {"USD": "100", "CNH": "0.00"},
        }
    )
    assert summary["ending_cash_by_currency"] == {"USD": "100", "CNH": "0"}
    assert identity._normalize_bochk_currency_balance_map({"USD": "0.00"}) == {
        "USD": "0"
    }


@pytest.mark.parametrize("reverse", [False, True])
def test_later_gainskeeper_positions_outrank_same_day_manual_capture(reverse):
    official = service.build_investment_payload_from_ibkr_gainskeeper_files(
        [
            (Fixtures._ibkr_gainskeeper_evidence_file(), "positions.gkx"),
        ]
    )
    manual = service.build_investment_payload_from_ibkr_web_pasted_text(
        trade_notifications_text="\n".join(
            [
                "Orders & Trades",
                "Trade Notifications",
                "Trades Account Action Quantity Status Price Amount",
                "QQQ",
                "Bot 1 @ 100.00 on ARCA",
                "U00000001 Bought 1",
                "Filled",
                "10:30 PM",
                "100.00",
                "100",
                "Fees: 0.01",
            ]
        ),
        trade_date="2026-07-03",
        ending_cash="500",
        position_snapshot_text="QQQ 2",
    )
    first, second = (official, manual) if reverse else (manual, official)
    merged = service.merge_investment_payloads(first, second)
    for snapshot in (
        merged["broker_snapshots"]["ibkr:U00000001"],
        merged["broker_summaries"]["ibkr"],
    ):
        assert snapshot["position_snapshot_source"] == "ibkr_gainskeeper_positions"
        assert snapshot["position_snapshot"]["QQQ"]["quantity"] == "1"


def _performance_windows(first_end, second_start, transaction_date=None):
    artifacts, evidence = [], []
    for start, end, realized in (
        ("2026-01-01", first_end, "100"),
        (second_start, "2026-06-30", "200"),
    ):
        sha = hashlib.sha256(f"{start}:{end}".encode()).hexdigest()
        artifacts.append(
            {
                "sha256": sha,
                "byte_count": 1,
                "storage_key": sha,
                "broker": "ibkr",
                "account": "U00000001",
                "source_kind": "ibkr_realized_summary_csv",
                "statement_period_start": start,
                "statement_period_end": end,
            }
        )
        evidence.append(
            {
                "broker": "ibkr",
                "account": "U00000001",
                "snapshot_as_of": end,
                "performance_snapshot_as_of": end,
                "performance_snapshot_authoritative": True,
                "performance_snapshot_source": "ibkr_csv_realized_summary",
                "performance_snapshot": {
                    "QQQ": {
                        "realized_total": realized,
                        "currency": "USD",
                        "unrealized_total": "0",
                    }
                },
                "source_artifact_sha256": [sha],
            }
        )
    transactions = (
        []
        if transaction_date is None
        else [
            {
                "date": transaction_date,
                "type": "sell",
                "broker": "ibkr",
                "account": "U00000001",
                "ticker": "QQQ",
                "currency": "USD",
                "quantity_raw": "-10",
                "net_amount_raw": "5000",
                "broker_realized_pnl_raw": "500",
            }
        ]
    )
    return service.normalize_investment_payload_tickers(
        {
            "broker": "multiple",
            "account": "multiple",
            "transactions": transactions,
            "source_artifacts": artifacts,
            "broker_snapshots": {
                "ibkr:U00000001": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "evidence": evidence,
                }
            },
        }
    )["broker_snapshots"]["ibkr:U00000001"]


@pytest.mark.parametrize("transaction_date", [None, "2026-03-03"])
def test_performance_union_does_not_claim_uncovered_weekdays(transaction_date):
    snapshot = _performance_windows("2026-03-02", "2026-03-05", transaction_date)
    assert snapshot["performance_snapshot_as_of"] == "2026-03-02"
    assert snapshot["performance_snapshot"]["QQQ"]["realized_total"] == "100"
    if transaction_date:
        assert (
            snapshot["realized_pnl_reconciliation"]["QQQ"]["replay"]["required"] is True
        )


@pytest.mark.parametrize(
    "first_end,second_start",
    [("2026-03-02", "2026-03-03"), ("2026-03-06", "2026-03-09")],
)
def test_performance_union_preserves_adjacent_and_weekend_windows(
    first_end, second_start
):
    snapshot = _performance_windows(first_end, second_start)
    assert snapshot["performance_snapshot"]["QQQ"]["realized_total"] == "300"
    assert snapshot["performance_snapshot_as_of"] == "2026-06-30"


def _later_hsbc_statement():
    def row(day, description, deposit="", balance=""):
        return f"{day:<12}{description:<76}{deposit:>12}{'':>12}{balance:>12}"

    text = "\n".join(
        [
            "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
            "HSBC One Portfolio",
            "Page 1 of 4",
            "10 September 2026",
            "Portfolio Summary",
            "USD 7.8365 1,060.99",
            "HSBC One Account Transaction History",
            "USD Savings",
            f"{'Date':<12}{'Transaction Details':<76}{'Deposit':<12}{'Withdrawal':<12}Balance",
            row("USD 01 Aug", "B/F BALANCE", balance="60.99"),
            row("20 Aug", "DEPOSIT", deposit="1,000.00", balance="1,060.99"),
            "Total Relationship Balance",
        ]
    )
    with patch(
        "app.services.investment_import._extract_statement_pdf_text", return_value=text
    ):
        return service.build_investment_payload_from_hsbc_statement_bundle(
            [(b"isolated August statement", "august.pdf")]
        )


@pytest.mark.parametrize("reverse", [False, True])
def test_later_usd_statement_cannot_reuse_stale_paste_cash_boundary(reverse):
    portfolio, orders, cash = Fixtures._synthetic_hsbc_paste_snapshot()
    paste = service.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text=portfolio,
        order_status_text=orders,
        cash_account_text=cash,
    )
    statement = _later_hsbc_statement()
    first, second = (statement, paste) if reverse else (paste, statement)
    merged = service.merge_investment_payloads(first, second)
    summary = merged["broker_summaries"]["hsbc"]
    assert summary["ending_cash_by_currency"]["USD"] == "1060.99"
    assert summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"] == "2026-08-20"
    from app.services.investment.importing.brokers.hsbc.cash_boundary import (
        _synchronize_hsbc_authoritative_current_cash_boundary,
    )

    _synchronize_hsbc_authoritative_current_cash_boundary(merged)
    assert (
        merged["broker_summaries"]["hsbc"]["ending_cash_by_currency"]["USD"]
        == "1060.99"
    )


def test_normalization_retains_both_accounts_authoritative_snapshots():
    snapshots = {}
    for account, quantity in (("TEST-ONE", "10"), ("TEST-TWO", "7")):
        snapshots[f"ibkr:{account}"] = {
            "broker": "ibkr",
            "account": account,
            "evidence": [
                {
                    "broker": "ibkr",
                    "account": account,
                    "snapshot_as_of": "2026-08-14",
                    "position_snapshot_as_of": "2026-08-14",
                    "position_snapshot_authoritative": True,
                    "position_snapshot_source": "ibkr_csv_open_positions",
                    "position_snapshot": {
                        "QQQ": {"quantity": quantity, "as_of": "2026-08-14"}
                    },
                }
            ],
        }
    normalized = service.normalize_investment_payload_tickers(
        {
            "broker": "multiple",
            "account": "multiple",
            "transactions": [],
            "broker_snapshots": snapshots,
        }
    )
    assert {
        key: value["position_snapshot"]["QQQ"]["quantity"]
        for key, value in normalized["broker_snapshots"].items()
    } == {
        "ibkr:TEST-ONE": "10",
        "ibkr:TEST-TWO": "7",
    }


@pytest.mark.parametrize("reverse", [False, True])
def test_later_csv_cash_keeps_its_own_date_and_removes_older_exact_time(reverse):
    raw_gkx = (
        Fixtures._ibkr_gainskeeper_evidence_file()
        .replace(
            b"<DTTRADE>20260702223338</DTTRADE>",
            b"<DTTRADE>20260703133526.000[-4:EDT]</DTTRADE>",
        )
        .replace(
            b"</INVSTMTRS>",
            b"<INVBAL><BALLIST><BAL><NAME>Cash</NAME><VALUE>250</VALUE></BAL></BALLIST></INVBAL></INVSTMTRS>",
        )
    )
    earlier = service.build_investment_payload_from_ibkr_gainskeeper_files(
        [(raw_gkx, "earlier.gkx")]
    )
    transaction_csv, position_csv = Fixtures._ibkr_csv_evidence_pair()
    later = service.build_investment_payload_from_ibkr_csvs(
        transaction_csv.replace(b"July 3, 2026", b"July 8, 2026"),
        position_csv.replace(b"July 3, 2026", b"July 8, 2026"),
    )
    assert earlier["ending_cash"] == "250"
    assert later["ending_cash"] == "100"
    first, second = (later, earlier) if reverse else (earlier, later)
    merged = service.merge_investment_payloads(first, second)
    summary = merged["broker_summaries"]["ibkr"]
    assert summary["ending_cash"] == "100"
    assert summary["cash_snapshot_source"] == "ibkr_csv_summary"
    assert summary["ending_cash_as_of"] == "2026-07-08"
    assert summary["ending_cash_replay_as_of"] == "2026-07-03"
    assert not summary.get("ending_cash_as_of_datetime")
    assert not summary.get("ending_cash_replay_as_of_datetime")
