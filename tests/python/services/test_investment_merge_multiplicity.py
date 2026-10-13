"""Preserve transaction multiplicity across evidence sources.

Code version: v0.1.0
"""

from copy import deepcopy
from decimal import Decimal
import xml.etree.ElementTree as ET

import pytest

from app.services import investment_import as service
from app.services.investment.importing import basics
from app.services.investment.importing.brokers import longbridge_files
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin as Fixtures,
)


def gainskeeper_payload(count=2):
    root = ET.fromstring(Fixtures._ibkr_gainskeeper_evidence_file())
    trades = root.find(".//INVTRANLIST")
    original = trades.find("BUYSTOCK")
    trades.remove(original)
    for index in range(count):
        trade = deepcopy(original)
        trade.find(".//FITID").text = f"QQQ-{index}"
        trade.find(".//DTTRADE").text = f"20260702{10 + index:02}0000"
        trades.append(trade)
    return service.build_investment_payload_from_ibkr_gainskeeper_files(
        [
            (ET.tostring(root), "fills.gkx"),
        ]
    )


def web_payload():
    text = Fixtures._ibkr_web_trade_notifications_text().split("DRAM", 2)[0]
    text += "\n".join(
        [
            "QQQ",
            "Bot 1 @ 100.00 on ARCA",
            "U00000001 Bought 1",
            "Filled",
            "7/2/2026, 10:00 PM",
            "100.00",
            "100",
            "Fees: 0.01",
        ]
    )
    return service.build_investment_payload_from_ibkr_web_pasted_text(
        trade_notifications_text=text,
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_web_refinement_preserves_distinct_authoritative_fills(reverse):
    web, official = web_payload(), gainskeeper_payload()
    first, second = (official, web) if reverse else (web, official)
    merged = service.merge_investment_payloads(first, second)
    for incoming in (None, official, web):
        if incoming is not None:
            merged = service.merge_investment_payloads(merged, deepcopy(incoming))
        rows = [row for row in merged["transactions"] if row["type"] == "buy"]
        assert len(rows) == 2
        assert sum(Decimal(row["net_amount_raw"]) for row in rows) == Decimal("-200.02")
        assert {row["source"]["fitid"] for row in rows} == {"QQQ-0", "QQQ-1"}


def cash_payload(rows, broker="longbridge_sg"):
    return {
        "schema_version": "3.0.0",
        "broker": broker,
        "account": "TEST00001",
        "summary": {},
        "transactions": rows,
    }


@pytest.mark.parametrize("repeat", [False, True])
def test_identical_currency_conversions_retain_both_pairs(repeat):
    rows = []
    for time in ("09:30:00", "14:05:00"):
        for currency, amount in (("HKD", "-10000"), ("USD", "1282")):
            rows.append(
                {
                    "date": "2024-09-04",
                    "datetime": f"2024-09-04 {time}",
                    "type": "forex_trade_component",
                    "currency": currency,
                    "description": "FX FROM HKD TO USD @ 0.1282",
                    "gross_amount_raw": amount,
                    "net_amount_raw": amount,
                    "broker": "longbridge_sg",
                    "account": "TEST00001",
                    "source": {
                        "file_kind": "longbridge_cash_flow",
                        "row_number": len(rows) + 1,
                    },
                }
            )
    initial = cash_payload(rows)
    incoming = (
        initial
        if repeat
        else cash_payload(
            [
                {
                    **rows[0],
                    "date": "2024-09-10",
                    "type": "deposit",
                    "currency": "USD",
                    "gross_amount_raw": "100",
                    "net_amount_raw": "100",
                }
            ]
        )
    )
    merged = service.merge_investment_payloads(deepcopy(initial), deepcopy(incoming))
    forex = [
        row for row in merged["transactions"] if row["type"] == "forex_trade_component"
    ]
    assert len(forex) == 4
    assert (
        sum(Decimal(row["net_amount_raw"]) for row in forex if row["currency"] == "HKD")
        == -20000
    )
    assert (
        sum(Decimal(row["net_amount_raw"]) for row in forex if row["currency"] == "USD")
        == 2564
    )


def money_market_payload(entries):
    enriched = longbridge_files._enrich_longbridge_hk_fund_entries(
        [
            {
                "row_number": index,
                "flow_name": flow,
                "balance": Decimal(amount),
                "currency": "HKD",
                "time": day,
                "symbol": "",
                "shares": None,
                "description": "Gaoteng HKD Money Market Fund"
                if flow == "Placement"
                else "Deposit",
            }
            for index, (flow, amount, day) in enumerate(entries, 1)
        ]
    )
    records = []
    for index, entry in enumerate(enriched, 1):
        row = longbridge_files._longbridge_hk_fund_entry_to_cash_flow_row(entry)
        record = basics._build_longbridge_cash_flow_record(row, index, [])
        if record:
            records.append(
                {**record, "broker": "longbridge_hk", "account": "TEST00001"}
            )
    return cash_payload(records, "longbridge_hk")


@pytest.mark.parametrize("reverse", [False, True])
def test_money_market_identity_survives_newest_first_row_renumbering(reverse):
    entries = [
        ("Placement", "-1000", "2025-02-01"),
        ("Deposit", "5000", "2025-01-15"),
        ("Placement", "-500", "2025-01-10"),
        ("Deposit", "2000", "2025-01-05"),
    ]
    old = money_market_payload(entries)
    new = money_market_payload(
        [
            ("Deposit", "300", "2025-03-05"),
            ("Placement", "-700", "2025-03-01"),
            *entries,
        ]
    )
    first, second = (new, old) if reverse else (old, new)
    merged = service.merge_investment_payloads(first, second)
    for incoming in (None, new, old):
        if incoming is not None:
            merged = service.merge_investment_payloads(merged, deepcopy(incoming))
        transfers = [
            row
            for row in merged["transactions"]
            if row["source"].get("cash_equivalent_transfer")
        ]
        assert len(transfers) == 3
        assert sum(Decimal(row["gross_amount_raw"]) for row in transfers) == -2200


def test_csv_surplus_fill_is_not_claimed_twice_by_one_gainskeeper_trade():
    transactions, positions = Fixtures._ibkr_csv_evidence_pair()
    transactions = transactions.replace(b"2026-07-03,U", b"2026-07-02,U")
    row = transactions.splitlines()[-1]
    transactions += row + b"\n"
    csv = service.build_investment_payload_from_ibkr_csvs(transactions, positions)
    official = gainskeeper_payload(1)
    merged = service.merge_investment_payloads(official, csv)
    for incoming in (None, csv, official):
        if incoming is not None:
            merged = service.merge_investment_payloads(merged, deepcopy(incoming))
        rows = [row for row in merged["transactions"] if row["type"] == "buy"]
        assert len(rows) == 2
        assert sum(Decimal(row["quantity_raw"]) for row in rows) == 2


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("ambiguous", [False, True])
@pytest.mark.parametrize("subset", [False, True])
@pytest.mark.parametrize("split_import", [False, True])
def test_closed_lot_metadata_is_one_to_one_and_matches_execution_time(
    reverse, ambiguous, subset, split_import
):
    transactions, positions = Fixtures._ibkr_csv_evidence_pair()
    positions = positions.replace(
        b",QQQ,0,0,0,0,0,0,0,0,0,0,10,10,",
        b",QQQ,0,80,0,0,0,80,0,0,0,0,10,90,",
    )
    transactions = transactions[: transactions.rindex(b"Transaction History,Data")]
    transactions += (
        2
        * b"Transaction History,Data,2026-07-02,U***00001,QQQ sell,Sell,QQQ,-1,100,USD,100,-0.01,99.99\n"
    )
    positions += b"Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code\n"
    for time, pnl, basis in [
        ("10:00:00", "50", "-49.99"),
        ("11:00:00", "30", "-69.99"),
    ]:
        if subset and time == "10:00:00":
            continue
        positions += f'Trades,Data,Order,Stocks,USD,QQQ,"2026-07-02, {time}",-1,100,100,-0.01,{basis},{pnl},C\n'.encode()
    csv = service.build_investment_payload_from_ibkr_csvs(transactions, positions)
    if ambiguous:
        for row in csv["transactions"]:
            row["source"].pop("closed_lot_trade_datetime", None)
    root = ET.fromstring(Fixtures._ibkr_gainskeeper_evidence_file())
    trades = root.find(".//INVTRANLIST")
    original = trades.find("BUYSTOCK")
    trades.remove(original)
    for index in (1, 0):
        trade = deepcopy(original)
        trade.tag = "SELLSTOCK"
        trade.find("INVBUY").tag = "INVSELL"
        trade.find(".//FITID").text = f"SELL-{index}"
        trade.find(".//DTTRADE").text = f"20260702{10 + index:02}0000"
        trade.find(".//UNITS").text = "-1"
        trade.find(".//TOTAL").text = "99.99"
        trades.append(trade)
    official = service.build_investment_payload_from_ibkr_gainskeeper_files(
        [(ET.tostring(root), "sales.gkx")]
    )
    first, second = (official, csv) if reverse else (csv, official)
    if split_import:
        parts = []
        for index in range(2):
            part = deepcopy(root)
            part_trades = part.find(".//INVTRANLIST")
            part_trades.remove(part_trades.findall("SELLSTOCK")[index])
            parts.append(
                service.build_investment_payload_from_ibkr_gainskeeper_files(
                    [(ET.tostring(part), f"sales-part-{index}.gkx")]
                )
            )
        merged = (
            service.merge_investment_payloads(
                service.merge_investment_payloads(parts[0], csv), parts[1]
            )
            if reverse
            else service.merge_investment_payloads(
                service.merge_investment_payloads(csv, parts[0]), parts[1]
            )
        )
    else:
        merged = service.merge_investment_payloads(first, second)
    for incoming in (None, csv, official):
        if incoming is not None:
            merged = service.merge_investment_payloads(merged, deepcopy(incoming))
        sales = [row for row in merged["transactions"] if row["type"] == "sell"]
        assert len(sales) == 2
        assert sum(Decimal(row["quantity_raw"]) for row in sales) == -2
        if ambiguous:
            assert all("broker_realized_pnl_raw" not in row for row in sales)
        else:
            assert {
                row["source"]["fitid"]: row["broker_realized_pnl_raw"]
                for row in sales
                if "broker_realized_pnl_raw" in row
            } == ({"SELL-1": "30"} if subset else {"SELL-0": "50", "SELL-1": "30"})
        assert merged["performance_snapshot"]["QQQ"]["realized_total"] == "80"


def test_exact_gainskeeper_identity_precedes_ambiguous_leftover_csv_evidence():
    transactions, positions = Fixtures._ibkr_csv_evidence_pair()
    transactions = transactions[: transactions.rindex(b"Transaction History,Data")]
    transactions += (
        2
        * b"Transaction History,Data,2026-07-02,U***00001,QQQ sell,Sell,QQQ,-1,100,USD,100,-0.01,99.99\n"
    )
    positions += b"Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code\n"
    for pnl, basis in [("50", "-49.99"), ("30", "-69.99")]:
        positions += f'Trades,Data,Order,Stocks,USD,QQQ,"2026-07-02, 10:00:00",-1,100,100,-0.01,{basis},{pnl},C\n'.encode()
    csv = service.build_investment_payload_from_ibkr_csvs(transactions, positions)
    root = ET.fromstring(Fixtures._ibkr_gainskeeper_evidence_file())
    trade = root.find(".//BUYSTOCK")
    trade.tag = "SELLSTOCK"
    trade.find("INVBUY").tag = "INVSELL"
    trade.find(".//FITID").text = "SELL-0"
    trade.find(".//DTTRADE").text = "20260702100000"
    trade.find(".//UNITS").text = "-1"
    trade.find(".//TOTAL").text = "99.99"
    official = service.build_investment_payload_from_ibkr_gainskeeper_files(
        [(ET.tostring(root), "partial-sales.gkx")]
    )
    merged = service.merge_investment_payloads(csv, official)
    for incoming in (None, official, official, csv, official):
        if incoming is not None:
            merged = service.merge_investment_payloads(merged, deepcopy(incoming))
        sales = [row for row in merged["transactions"] if row["type"] == "sell"]
        assert len(sales) == 2
        assert sum(Decimal(row["quantity_raw"]) for row in sales) == -2
        linked = [row for row in sales if row["source"].get("fitid") == "SELL-0"]
        assert len(linked) == 1
        assert "broker_realized_pnl_raw" not in linked[0]


def test_disjoint_gainskeeper_periods_do_not_delete_csv_trade_in_gap():
    transactions, positions = Fixtures._ibkr_csv_evidence_pair()
    transactions = transactions.replace(b"2026-07-03,U", b"2026-02-10,U")
    csv = service.build_investment_payload_from_ibkr_csvs(transactions, positions)
    files = []
    for month, last_day, quantity in [("01", "31", "2"), ("03", "31", "3")]:
        root = ET.fromstring(Fixtures._ibkr_gainskeeper_evidence_file())
        root.find(".//DTSTART").text = f"2026{month}01000000"
        root.find(".//DTEND").text = f"2026{month}{last_day}235959"
        root.find(".//FITID").text = f"QQQ-{month}"
        root.find(".//DTTRADE").text = f"2026{month}05100000"
        root.find(".//INVBUY/UNITS").text = quantity
        root.find(".//INVBUY/TOTAL").text = str(
            -100 * Decimal(quantity) - Decimal(".01")
        )
        files.append((ET.tostring(root), f"{month}.gkx"))
    official = service.build_investment_payload_from_ibkr_gainskeeper_files(files)
    merged = service.merge_investment_payloads(csv, official)
    assert {row["date"] for row in merged["transactions"] if row["type"] == "buy"} == {
        "2026-01-05",
        "2026-02-10",
        "2026-03-05",
    }


@pytest.mark.parametrize("other_type,quantity", [("buy", "3"), ("grant", "5")])
@pytest.mark.parametrize("other_broker", ["longbridge_hk", "ibkr"])
def test_position_grants_are_reconciled_only_with_the_same_account(
    other_type, quantity, other_broker
):
    transactions, positions = Fixtures._ibkr_csv_evidence_pair()
    transactions = transactions[: transactions.rindex(b"Transaction History,Data")]
    transactions += b"Transaction History,Data,2026-07-03,U***00001,Deposit,Deposit,-,-,-,-,100,-,100\n"
    positions = positions.replace(
        b",QQQ,-,1,1,100,100,110,110,10,", b",QQQ,-,10,1,100,1000,110,1100,100,"
    )
    positions += b'Open Positions,Data,Lot,Stocks,USD,QQQ,"2026-01-15, 09:00:00 (Vesting: 2027-01-15)",10,,100,1000,110,1100,100,Un;ST\n'
    official = service.build_investment_payload_from_ibkr_csvs(transactions, positions)
    other = cash_payload(
        [
            {
                "broker": other_broker,
                "account": "OTHER00002",
                "ticker": "QQQ",
                "type": other_type,
                "date": "2026-01-20",
                "datetime": "2026-01-20 10:00:00",
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "price_raw": "100",
                "net_amount_raw": "0",
                "gross_amount_raw": "0",
                "source": {
                    "file_kind": "manual_investment_xlsx",
                    "reference_id": "OTHER-GRANT-1",
                },
            }
        ],
        other_broker,
    )
    other["account"] = "OTHER00002"
    if other_broker == "ibkr":
        # A preexisting multi-account ledger is valid; a direct incompatible
        # single-account import is separately rejected by the public API.
        merged = {
            **deepcopy(official),
            "broker": "multiple",
            "account": "multiple",
            "transactions": official["transactions"] + other["transactions"],
        }
    else:
        merged = service.merge_investment_payloads(official, other)
    merged = service.merge_investment_payloads(merged, deepcopy(official))
    assert [
        (row["account"], row["quantity_raw"])
        for row in merged["transactions"]
        if row["type"] == "grant" and row["account"] == "U00000001"
    ] == [("U00000001", "10")]
    assert (
        len(
            [
                row
                for row in merged["transactions"]
                if row["account"] == "OTHER00002" and row["quantity_raw"] == quantity
            ]
        )
        == 1
    )
