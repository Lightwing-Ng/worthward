"""Regression tests for uSMART (HK) statement descriptions.

Code version: v0.2.1
"""

from __future__ import annotations

from app.services.investment_import import (
    _usmart_hk_cash_records,
    normalize_investment_payload_tickers,
)


def test_fractional_share_descriptions_disclose_missing_statement_symbols() -> None:
    records = _usmart_hk_cash_records(
        "\n".join([
            "資⾦出⼊",
            "買碎股  USD  -100.00  2026-08-01",
            "卖碎股  USD  101.00  2026-08-02",
        ]),
        account="07723146",
        source_filename="20260831-07723146.pdf",
    )

    assert [record["description"] for record in records] == [
        "Fractional Shares Purchase (symbol unavailable in statement)",
        "Fractional Shares Sale (symbol unavailable in statement)",
    ]


def test_fractional_share_evidence_annotation_survives_payload_normalization() -> None:
    payload = {
        "broker": "usmart_hk",
        "transactions": [
            {
                "broker": "usmart_hk",
                "type": "buy",
                "description": "Fractional Shares Purchase (symbol unavailable in statement)",
                "source": {"file_kind": "usmart_hk_statement_pdf"},
            },
            {
                "broker": "usmart_hk",
                "type": "sell",
                "description": "Fractional Shares Sale (symbol unavailable in statement)",
                "source": {"file_kind": "usmart_hk_statement_pdf"},
            },
        ],
    }

    normalize_investment_payload_tickers(payload)

    assert [record["description"] for record in payload["transactions"]] == [
        "Fractional Shares Purchase (symbol unavailable in statement)",
        "Fractional Shares Sale (symbol unavailable in statement)",
    ]
