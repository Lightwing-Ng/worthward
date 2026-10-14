"""Preserve explicitly exported midnight execution timestamps.

Code version: v0.1.0
"""

from app.services.investment.importing.brokers.zircon_hk import (
    build_standard_investment_xlsx,
    build_investment_payload_from_zircon_hk_manual_xlsx,
)


def test_new_york_noon_roundtrip_preserves_next_day_hong_kong_midnight():
    rows = [
        {
            "broker": "ibkr",
            "account": "TEST",
            "type": kind,
            "currency": "USD",
            "ticker": "AAPL",
            "date": "2024-07-01",
            "datetime": f"2024-07-01 {hour}:00:00",
            "quantity_raw": "10",
            "price_raw": "200",
            "gross_amount_raw": amount,
            "net_amount_raw": amount,
            "source": {"reference_id": reference},
        }
        for kind, hour, amount, reference in [
            ("buy", "12", "-2000", "T-1"),
            ("sell", "15", "2000", "T-2"),
        ]
    ]
    payload = build_investment_payload_from_zircon_hk_manual_xlsx(
        xlsx_bytes=build_standard_investment_xlsx(rows),
        filename="export.xlsx",
    )
    assert [(row["type"], row["datetime"]) for row in payload["transactions"]] == [
        ("buy", "2024-07-01 12:00:00"),
        ("sell", "2024-07-01 15:00:00"),
    ]
    assert all(
        row["source"]["source_time_defaulted_to_2300"] is False
        for row in payload["transactions"]
    )
