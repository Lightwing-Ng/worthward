"""HSBC capture direction, freshness, immutable identity, and native balances.

Code version: v0.1.0
"""

import hashlib
import base64

import pytest

from app.services.investment.importing.brokers.hsbc import (
    core,
    reconciliation,
    statements,
)
import app.services.investment_import as investment_import
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin,
)


TEST_ACCOUNT = "000-999999-999"
CHUNK = "\n\n===== HSBC PASTE CHUNK =====\n\n"


def _cash(rows, *, currency="USD", balance="1300.00"):
    lines = [
        f"{currency} Savings",
        "Account number:",
        TEST_ACCOUNT,
        "Ledger balance:",
        f"{balance} {currency}",
        "Available balance:",
        f"{balance} {currency}",
        "Post date Description Amount in Amount out Balance Additional options",
    ]
    for date, description, amount, ending in rows:
        lines.extend([date, description, amount, ending])
    return "\n".join(lines + ["Download"])


def _portfolio(time, holdings):
    lines = [
        "HSBCPersonal Internet BankingProxy voting",
        "PortfolioOrder StatusWatchlistMarketExpress View",
        "Open list of dropdownAccount",
        "HSBC One Investment Services",
        TEST_ACCOUNT,
        f"Updated {time} on 14 Jul 2026 U.S. ET",
        "PortfolioMarket valueUSD 1.000",
        "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
    ]
    for ticker in holdings:
        lines.extend(
            [
                ticker,
                "Fund",
                "61.000",
                "+0.000",
                "0.00%1USD 61.000",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 61.000",
            ]
        )
    return "\n".join(lines + ["information"])


def _order(status, quantity):
    return "\n".join(
        [
            "HSBC One Investment Services",
            TEST_ACCOUNT,
            "Order Status",
            "2026-07-01",
            "01 Jul 2026",
            "2026-07-15",
            "15 Jul 2026",
            "order status",
            "All Order Status",
            "DRAM",
            "Fund",
            "14 Jul 2026 U.S. ET",
            status,
            "Buy",
            "Limit Price Order",
            "61.000USD10",
            "Quantity",
            f"Executed quantity{quantity} share(s)",
            f"Outstanding quantity{10 - quantity} share(s)",
            "P-5",
        ]
    )


def test_ambiguous_oldest_pasted_cash_does_not_invent_direction():
    warnings = []
    text = _cash(
        [
            ("16 Jul 2026", "CREDIT INTEREST", "300.00", "1300.00"),
            ("15 Jul 2026", "FPS TRANSFER TEST", "500.00", "1000.00"),
        ]
    )
    capture = core._build_hsbc_cash_account_capture_from_text(text, warnings=warnings)
    assert not any(
        row["description"] == "FPS TRANSFER TEST" for row in capture["records"]
    )
    assert any(
        "direction" in warning.lower() and "ambiguous" in warning.lower()
        for warning in warnings
    )
    wider = text.replace(
        "Download", "14 Jul 2026\nCREDIT INTEREST\n1500.00\n1500.00\nDownload"
    )
    (row,) = [
        r
        for r in core._build_hsbc_cash_account_capture_from_text(wider, warnings=[])[
            "records"
        ]
        if r["description"] == "FPS TRANSFER TEST"
    ]
    assert row["net_amount_raw"] == "-500.00"


@pytest.mark.parametrize("reverse", [False, True])
def test_portfolio_freshness_does_not_depend_on_number_of_holdings(reverse):
    clips = [_portfolio("10:00:00", ["DRAM", "SGOV"]), _portfolio("16:00:00", ["SGOV"])]
    _, capture = core._parse_hsbc_portfolio_plain_text(
        CHUNK.join(clips[::-1] if reverse else clips)
    )
    assert [holding["symbol"] for holding in capture["holdings"]] == ["SGOV"]


@pytest.mark.parametrize("reverse", [False, True])
def test_cumulative_filled_order_wins_over_stale_partial_capture(reverse):
    clips = [_order("Partially Executed", 4), _order("Fully Executed", 10)]
    _, rows = core._parse_hsbc_order_status_plain_text(
        CHUNK.join(clips[::-1] if reverse else clips)
    )
    assert rows[0]["status"] == "Fully Executed"
    assert rows[0]["executed_quantity"] == "10"


@pytest.mark.parametrize("crlf", [False, True])
def test_multiclip_sequence_identity_addresses_exact_immutable_artifact(crlf):
    a = _cash(
        [("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00")], balance="1000.00"
    )
    b = _cash(
        [
            ("15 Jul 2026", "CREDIT INTEREST", "60.99", "1060.99"),
            ("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00"),
        ],
        balance="1060.99",
    )
    text = CHUNK.join([a, b])
    if crlf:
        text = text.replace("\n", "\r\n")
    p = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=text
    )
    digest = hashlib.sha256(text.encode()).hexdigest()
    assert digest in {a["sha256"] for a in p["source_artifacts"]}
    assert {r["source"]["source_sequence_sha256"] for r in p["transactions"]} == {
        digest
    }
    assert len({r["source"]["row_number"] for r in p["transactions"]}) == len(
        p["transactions"]
    )


def test_usd_snapshot_asof_does_not_borrow_later_hkd_posting():
    text = (
        _cash(
            [("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00")], balance="1000.00"
        )
        + "\n"
        + _cash(
            [("15 Jul 2026", "HKD INTEREST", "46.10", "46.10")],
            currency="HKD",
            balance="46.10",
        )
    )
    p = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=text
    )
    assert p["summary"]["cash_ledger_balance_as_of"] == "2026-07-13"
    assert (
        p["broker_summaries"]["hsbc"]["ending_cash_base_currency_as_of"] == "2026-07-13"
    )


def test_storage_backed_reparse_keeps_multiclip_physical_posting_identity(
    tmp_path, monkeypatch
):
    a = _cash(
        [("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00")], balance="1000.00"
    )
    b = _cash(
        [
            ("15 Jul 2026", "REF S1001 SEC", "60.99", "1060.99"),
            ("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00"),
        ],
        balance="1060.99",
    )
    p = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=CHUNK.join([a, b])
    )
    (artifact,) = p["source_artifacts"]
    raw = base64.b64decode(artifact.pop("content_base64"))
    artifact["storage_key"] = artifact["sha256"]
    (tmp_path / f"{artifact['sha256']}.bin").write_bytes(raw)
    monkeypatch.setattr(reconciliation, "investment_evidence_dir_for", lambda: tmp_path)
    monkeypatch.setattr(
        investment_import, "investment_evidence_dir_for", lambda: tmp_path
    )
    (incoming,) = p["hsbc_cash_settlement_evidence"]
    (rebuilt,) = reconciliation._hsbc_persisted_pasted_cash_settlement_evidence(
        [artifact]
    )["S-1"]
    for field in (
        "source_sequence_sha256",
        "source_file_sha256",
        "row_number",
        "ledger_sequence",
    ):
        assert rebuilt[field] == incoming["source"][field]


def test_zero_usd_posting_remains_dated_without_borrowing_hkd_boundary():
    text = (
        _cash(
            [
                ("14 Jul 2026", "VISIBLE ZERO", "0.00", "1000.00"),
                ("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00"),
            ],
            balance="1000.00",
        )
        + "\n"
        + _cash(
            [("15 Jul 2026", "HKD INTEREST", "46.10", "46.10")],
            currency="HKD",
            balance="46.10",
        )
    )
    p = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=text
    )
    assert p["summary"]["cash_ledger_balance_as_of"] == "2026-07-14"
    assert p["summary"]["hsbc_cash_component_post_dates"]["USD:SAVINGS"] == "2026-07-14"
    assert (
        p["broker_summaries"]["hsbc"]["ending_cash_base_currency_as_of"] == "2026-07-14"
    )


def test_composite_usd_coverage_is_not_rejected_by_later_hkd_posting():
    portfolio, orders, _ = InvestmentImportFixtureMixin._synthetic_hsbc_paste_snapshot()
    text = (
        _cash(
            [("13 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00")], balance="1000.00"
        )
        + "\n"
        + _cash(
            [("20 Jul 2026", "HKD INTEREST", "46.10", "46.10")],
            currency="HKD",
            balance="46.10",
        )
    )
    p = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text=portfolio, order_status_text=orders, cash_account_text=text
    )
    assert p["summary"]["cash_ledger_balance_as_of"] == "2026-07-13"
    assert p["summary"]["hsbc_snapshot"]["cash_latest_post_date"] == "2026-07-13"


def _statement_text(include_usd):
    def row(day, description, deposit="", balance=""):
        return f"{day:<12}{description:<76}{deposit:>12}{'':>12}{balance:>12}"

    header = f"{'Date':<12}{'Transaction Details':<76}{'Deposit':<12}{'Withdrawal':<12}Balance"
    lines = [
        f"TEST OWNER Number : {TEST_ACCOUNT}",
        "HSBC One Portfolio",
        "Page 1 of 4",
        "10 July 2026",
        "Portfolio Summary",
        "USD 7.8365 1010.00",
        "CNY 1.090 12.00",
        "HSBC One Account Transaction History",
        "HKD Savings",
        header,
        row("HKD 01 Jun", "B/F BALANCE", balance="40.00"),
        row("15 Jun", "DEPOSIT", "7796.10", "7836.10"),
    ]
    if include_usd:
        lines.extend(
            [
                "USD Savings",
                header,
                row("USD 01 Jun", "B/F BALANCE", balance="10.00"),
                row("15 Jun", "DEPOSIT", "1000.00", "1010.00"),
            ]
        )
    lines.extend(
        [
            "CNY Savings",
            header,
            row("CNY 01 Jun", "B/F BALANCE", balance="10.00"),
            row("15 Jun", "DEPOSIT", "7180.00", "7190.00"),
            "Total Relationship Balance",
        ]
    )
    return "\n".join(lines)


@pytest.mark.parametrize("include_usd", [False, True])
def test_statement_usd_scalar_excludes_foreign_native_balances(include_usd):
    raw = b"isolated statement fixture"
    p = statements.build_investment_payload_from_hsbc_statement_pdfs(
        [(raw, "statement.pdf")],
        _extracted_text_by_payload_id={id(raw): _statement_text(include_usd)},
    )
    assert p["ending_cash_base_currency"] == ("1010.00" if include_usd else None)
    assert p["ending_cash_by_currency"]["CNH"] == "7190.00"
    for row in p["transactions"]:
        if row["source"].get("statement_currency_to_base_rate_raw"):
            assert (
                row["source"]["statement_currency_to_base_rate_as_of"] == "2026-07-10"
            )
