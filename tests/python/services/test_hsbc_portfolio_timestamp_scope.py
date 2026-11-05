"""Portfolio evidence cannot borrow a page-level market-index clock.

Code version: v1.0.0
"""

import pytest

from app.services.investment.importing.brokers.hsbc import core
from app.services.investment_import import (
    normalize_investment_payload_tickers,
    parse_investment_payload,
)
from tests.python.services.test_hsbc_capture_evidence import _cash, _order, _portfolio


@pytest.mark.parametrize("index_name", ["Dow Jones", "Nasdaq Composite", "Hang Seng Index"])
def test_market_index_update_does_not_date_the_portfolio(index_name):
    text = _portfolio("16:30:00", ["TEST"]).replace(
        "Updated 16:30:00", f"{index_name}\nUpdated 16:30:00"
    )

    assert core._extract_hsbc_portfolio_market_data_updated_at(text) == {}
    _, capture = core._parse_hsbc_portfolio_plain_text(text)
    assert "snapshot_metadata" not in capture


def test_independent_portfolio_update_retains_existing_timestamp_behavior():
    expected = {
        "raw": "Updated 16:30:00 on 14 Jul 2026 U.S. ET",
        "date": "2026-07-14",
        "time": "16:30:00",
    }
    assert core._extract_hsbc_portfolio_market_data_updated_at(
        _portfolio("16:30:00", ["TEST"])
    ) == expected


def test_explicit_portfolio_section_has_its_own_update_after_an_index_widget():
    text = _portfolio("18:30:00", ["TEST"]).replace(
        "Updated 18:30:00 on 14 Jul 2026 U.S. ET",
        "Dow Jones\nUpdated 18:30:00 on 14 Jul 2026 U.S. ET\n"
        "Portfolio\nUpdated 16:30:00 on 14 Jul 2026 U.S. ET",
    )

    assert core._extract_hsbc_portfolio_market_data_updated_at(text)["time"] == "16:30:00"


def test_index_only_timestamp_keeps_dated_positions_and_verified_cash_usable():
    portfolio = _portfolio("16:30:00", ["TEST"]).replace(
        "Updated 16:30:00 on 14 Jul 2026 U.S. ET",
        "Dow Jones\nUpdated 16:30:00 on 17 Jul 2026 U.S. ET",
    )
    cash = _cash(
        [("15 Jul 2026", "CREDIT INTEREST", "1.00", "1000.00")],
        balance="1000.00",
    )

    payload = parse_investment_payload(
        "hsbc",
        "pasted_text",
        portfolio_text=portfolio,
        order_status_text=_order("Fully Executed", 10),
        cash_account_text=cash,
    )
    payload = normalize_investment_payload_tickers(payload)

    summary = payload["summary"]
    snapshot = summary["hsbc_snapshot"]
    assert snapshot["portfolio_market_data_updated_at"] == {}
    assert snapshot["status"] == "review"
    assert snapshot["review_reasons"] == [
        "Portfolio has no recognizable market-data update timestamp"
    ]
    assert summary["position_snapshot_authoritative"] is True
    assert payload["position_snapshot"]["TEST"]["quantity"] == "1"
    registry = next(iter(payload["broker_snapshots"].values()))
    assert registry["position_snapshot_as_of"] == "2026-07-15"
    assert "snapshot_updated_at" not in registry["evidence"][0]
    assert snapshot["cash_posting_status"] == "current"
    assert summary["ending_cash_raw"] == "1000.00"
