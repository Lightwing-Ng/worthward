"""GainsKeeper balance provenance and occurrence identity regressions.

Code version: v0.1.0
"""

import xml.etree.ElementTree as ET

import pytest

from app.services.investment.importing.brokers.ibkr.parsers import (
    build_investment_payload_from_ibkr_gainskeeper_files,
    _parse_ibkr_web_holdings_capture,
)
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin,
)


def _file(end, cash, *, income=False, bank_memo=""):
    root = ET.fromstring(InvestmentImportFixtureMixin._ibkr_gainskeeper_evidence_file())
    root.find(".//DTEND").text = end + "235959"
    root.find(".//DTTRADE").text = end[:6] + "02103000"
    statement = root.find(".//INVSTMTRS")
    if cash is not None:
        ET.SubElement(statement, "INVBAL").append(
            ET.fromstring(
                f"<BALLIST><BAL><NAME>Cash</NAME><VALUE>{cash}</VALUE></BAL></BALLIST>"
            )
        )
    if income:
        txns = root.find(".//INVTRANLIST")
        txns.clear()
        for date in ("20260721", "20260821"):
            txns.append(
                ET.fromstring(
                    f"<INCOME><INVTRAN><FITID>SAME-SECURITY</FITID><DTTRADE>{date}202000</DTTRADE></INVTRAN><SECID><UNIQUEID>QQQ-ID</UNIQUEID></SECID><INCOMETYPE>DIV</INCOMETYPE><TOTAL>30.00</TOTAL><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></INCOME>"
                )
            )
    if bank_memo:
        bank = ET.SubElement(root.find(".//INVTRANLIST"), "INVBANKTRAN")
        stmt = ET.SubElement(bank, "STMTTRN")
        for key, value in {
            "TRNTYPE": "CASH",
            "TRNAMT": "-100",
            "FITID": "DISBURSE-1",
            "DTPOSTED": "20260703200000",
            "MEMO": bank_memo,
        }.items():
            ET.SubElement(stmt, key).text = value
    return ET.tostring(root)


@pytest.mark.parametrize("reverse", [False, True])
def test_cash_and_date_come_from_newest_balanced_file(reverse):
    files = [
        (_file("20260630", "5000"), "old.gkx"),
        (_file("20260930", "4899.99"), "new.gkx"),
    ]
    result = build_investment_payload_from_ibkr_gainskeeper_files(
        files[::-1] if reverse else files
    )
    assert result["ending_cash"] == "4899.99"
    assert result["summary"]["ending_cash_as_of"] == "2026-09-30"
    assert result["summary"]["ending_cash_as_of_datetime"] == "2026-09-02 10:30:00"


def test_file_without_balance_cannot_redate_older_balance():
    result = build_investment_payload_from_ibkr_gainskeeper_files(
        [
            (_file("20260630", "5000"), "old.gkx"),
            (_file("20260930", None), "new.gkx"),
        ]
    )
    assert result["ending_cash"] == "5000"
    assert result["summary"]["ending_cash_as_of"] == "2026-06-30"


def test_conflicting_same_date_cash_fails_closed():
    with pytest.raises(ValueError, match="cash.*conflict|conflict.*cash"):
        build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (_file("20260930", "5000"), "a.gkx"),
                (_file("20260930", "5001"), "b.gkx"),
            ]
        )


def test_distinct_income_rows_reusing_fitid_survive_and_overlap_is_idempotent():
    evidence = _file("20260930", None, income=True)
    result = build_investment_payload_from_ibkr_gainskeeper_files(
        [(evidence, "a.gkx"), (evidence, "copy.gkx")]
    )
    assert [(r["date"], r["net_amount_raw"]) for r in result["transactions"]] == [
        ("2026-07-21", "30.00"),
        ("2026-08-21", "30.00"),
    ]


def test_disbursement_description_retains_source_initiator():
    result = build_investment_payload_from_ibkr_gainskeeper_files(
        [
            (
                _file(
                    "20260703", None, bank_memo="DISBURSEMENT INITIATED BY TEST OWNER"
                ),
                "a.gkx",
            )
        ]
    )
    (row,) = [r for r in result["transactions"] if r["type"] == "withdrawal"]
    assert "TEST OWNER" in row["description"].upper()


def test_gainskeeper_preserves_same_file_occurrences_while_deduping_overlap():
    root = ET.fromstring(_file("20260930", None, income=True))
    txns = root.find(".//INVTRANLIST")
    txns.append(ET.fromstring(ET.tostring(txns[0])))
    evidence = ET.tostring(root)
    p = build_investment_payload_from_ibkr_gainskeeper_files(
        [(evidence, "a.gkx"), (evidence, "copy.gkx")]
    )
    assert len(p["transactions"]) == 3


def test_web_holdings_parser_preserves_explicit_zero_native_currency():
    text = "Account\nU00000001\nYour Holdings\nInstrument Position Last Change % Cost Basis Market Value Avg Price Daily P&L Unrealized P&L\nDRAM\nFund\n5 43.00 0.00% 215 USD 215.00 USD 43.00 USD 0.00 USD 0.00 USD\nCash Holdings\nCNH 0.00\nUSD (base currency) 1000.00\nTotal Cash (in USD) 1000.00"
    _, cash, _ = _parse_ibkr_web_holdings_capture(text)
    assert cash == {"CNH": "0.00", "USD": "1000.00"}
