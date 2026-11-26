"""Bounded PDF parser execution, income, and batch identity regressions.

Code version: v0.1.1
"""

from copy import deepcopy
from unittest.mock import patch

import pytest

from app.services.investment.importing.bindings import normalize_investment_payload_tickers
from app.services.investment.importing.brokers import futuhk
from app.services.investment.importing.brokers.usmart_tiger import (
    _tigertrade_forex_records,
    _tigertrade_stock_records,
)


@pytest.mark.parametrize(
    ("ticker", "quantity"), [("BRK.B", "2"), ("BF.B", "0.5"), ("AAPL", "1.25")]
)
def test_futu_share_class_and_fractional_execution_are_exact(ticker, quantity):
    rows = futuhk._parse_futuhk_trade_records(
        [
            f"{ticker}(Company",
            f"買入 訂單合計 123456 2023/02/16 {quantity} 100.00 200.00 -201.00",
        ],
        source_filename="statement.pdf",
        warnings=[],
    )
    (row,) = rows
    assert row["ticker"] == ticker
    assert row["quantity_raw"] == quantity


@pytest.mark.parametrize(
    ("remark", "kind"),
    [
        ("SPLG 9.00000000 SHARES DIVIDENDS", "dividend"),
        ("BRK.B 2 SHARES WITHHOLDING TAX", "foreign_tax_withholding"),
    ],
)
def test_futu_income_uses_explicit_symbol_in_source_remark(remark, kind):
    (row,) = futuhk._parse_futuhk_flow_records(
        [f"In 2023/02/10 1.49 2023/02/10 55555 {remark}"],
        source_filename="statement.pdf",
        warnings=[],
    )
    assert row["type"] == kind
    assert row["ticker"] == remark.split()[0]


@pytest.mark.parametrize(
    ("file_kind", "kind", "remark", "amount", "expected_ticker"),
    [
        (
            "futuhk_statement_pdf",
            "dividend",
            "SPLG 4.50000000 SHARES DIVIDENDS 0.34 USD PER SHARE",
            "1.53",
            "SPLG",
        ),
        (
            "futuhk_statement_pdf",
            "foreign_tax_withholding",
            "SPLG 4.50000000 SHARES WITHHOLDING TAX -0.034 USD PER SHARE- TAX",
            "-0.15",
            "SPLG",
        ),
        (
            "futuhk_email_notification",
            "dividend",
            "TSM 2.00000000 SHARES DIVIDENDS 0.51 USD PER SHARE",
            "1.02",
            "TSM",
        ),
        (
            "futuhk_email_notification",
            "foreign_tax_withholding",
            "TSM 2.00000000 SHARES WITHHOLDING TAX -0.102 USD PER SHARE- TAX",
            "-0.20",
            "TSM",
        ),
    ],
)
def test_futu_legacy_income_links_preserve_cash_and_source_evidence(
    file_kind, kind, remark, amount, expected_ticker,
):
    unbound = {
        "broker": "futuhk",
        "account": "FUTU-TEST",
        "date": "2023-05-05",
        "ticker": None,
        "type": kind,
        "currency": "USD",
        "description": remark,
        "gross_amount_raw": amount,
        "net_amount_raw": amount,
        "normalized": {"net_amount": amount, "cash_delta": amount},
        "source": {"file_kind": file_kind, "source_record_id": "test-source-1"},
    }
    payload = normalize_investment_payload_tickers({"transactions": [deepcopy(unbound)]})

    assert payload["transactions"] == [{**unbound, "ticker": expected_ticker}]
    assert normalize_investment_payload_tickers(deepcopy(payload)) == payload


@pytest.mark.parametrize(
    ("broker", "file_kind", "kind", "remark", "ticker"),
    [
        (
            "futuhk", "futuhk_statement_pdf", "dividend",
            "Account note: SPLG 3 SHARES DIVIDENDS", None,
        ),
        (
            "futuhk", "futuhk_email_notification", "dividend",
            "DIVIDENDS for 3 shares of SPLG", None,
        ),
        (
            "ibkr", "futuhk_statement_pdf", "dividend",
            "SPLG 3 SHARES DIVIDENDS", None,
        ),
        (
            "futuhk", "manual_investment_xlsx", "dividend",
            "SPLG 3 SHARES DIVIDENDS", None,
        ),
        (
            "futuhk", "futuhk_statement_pdf", "adjustment",
            "SPLG 3 SHARES DIVIDENDS", None,
        ),
        (
            "futuhk", "futuhk_statement_pdf", "dividend",
            "SPLG 3 SHARES DIVIDENDS", "AAPL",
        ),
    ],
)
def test_futu_legacy_income_link_requires_evidence_and_preserves_existing_ticker(
    broker, file_kind, kind, remark, ticker,
):
    record = {
        "broker": broker,
        "account": "BROKER-TEST",
        "date": "2023-05-05",
        "ticker": ticker,
        "type": kind,
        "currency": "USD",
        "description": remark,
        "net_amount_raw": "0.61",
        "source": {"file_kind": file_kind},
    }
    result = normalize_investment_payload_tickers({"transactions": [deepcopy(record)]})

    assert result["transactions"] == [record]


def test_futu_repeated_pdf_does_not_double_count_its_rows():
    text = "\n".join(
        [
            "賬戶號碼： 9999999999",
            "月結單（2023年02月）",
            "MSFT(Microsoft",
            "買入 訂單合計 98765 2023/02/16 4 265.50 1062.00 -1063.00",
            "In 2023/02/10 2000.00 2023/02/10 55555 Deposit",
        ]
    )
    with patch.object(futuhk, "_extract_futuhk_pdf_text", return_value=text):
        a = futuhk.build_investment_payload_from_futuhk_statement_pdf(
            b"isolated pdf", source_filename="a.pdf"
        )
        b = futuhk.build_investment_payload_from_futuhk_statement_pdf(
            b"isolated pdf", source_filename="copy.pdf"
        )
    result = futuhk._merge_futuhk_statement_payloads([a, b])
    assert len(result["transactions"]) == 2
    assert result["summary"]["statement_count"] == 1


def test_futu_same_file_legitimate_occurrences_are_preserved():
    text = "\n".join(
        [
            "賬戶號碼： 9999999999",
            "月結單（2023年02月）",
            "In 2023/02/10 10.00 2023/02/10 55555 Deposit",
            "In 2023/02/10 10.00 2023/02/10 55556 Deposit",
        ]
    )
    with patch.object(futuhk, "_extract_futuhk_pdf_text", return_value=text):
        p = futuhk.build_investment_payload_from_futuhk_statement_pdf(
            b"isolated pdf", source_filename="a.pdf"
        )
    assert len(futuhk._merge_futuhk_statement_payloads([p, p])["transactions"]) == 2


def test_tiger_inline_execution_date_precedes_settlement_date():
    rows = _tigertrade_forex_records(
        [
            "USD.HKD Buy 1,000.00 7.7800 -7,780.00 0.00 2024-12-02 10:15:30 2024-12-04 HKD"
        ],
        account="TEST",
        source_filename="statement.pdf",
    )
    assert len(rows) == 2
    assert {row["date"] for row in rows} == {"2024-12-02"}
    assert {row["source"]["statement_settlement_date"] for row in rows} == {
        "2024-12-04"
    }
    (row,) = _tigertrade_stock_records(
        [
            "Apple Inc (AAPL)",
            "US NASDAQ Open 2 224.00 -448.00 -0.98 0.00 2025-01-24 10:00:01 2025-01-27 USD",
        ],
        account="TEST",
        source_filename="statement.pdf",
        warnings=[],
    )
    assert row["date"] == "2025-01-24"
