"""Shared fixtures for split investment-import regression suites.

Code version: v0.1.0
"""

from __future__ import annotations

import base64
import hashlib
import json
from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
from datetime import date
from tempfile import TemporaryDirectory
from threading import Event, Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.core.broker_settings import BrokerSettings
from pathlib import Path
from app.infrastructure import storage
from app.infrastructure.storage import (
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES,
    MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES,
    clear_investment_store,
    investment_evidence_dir_for,
    investment_source_artifact_storage_keys,
    load_investment_store_payload,
    materialize_investment_source_artifacts,
    save_investment_store_payload,
    update_investment_store_payload,
    verify_investment_source_artifacts,
    verify_persisted_investment_source_artifacts,
)

import app.services.investment_import as investment_import_service
from app.services.investment_import import (
    LONGBRIDGE_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
    _build_hsbc_cash_account_records_from_text,
    _extract_futuhk_pdf_text,
    _extract_statement_pdf_text,
    _parse_ibkr_statement_period,
    _parse_hsbc_order_status_plain_text,
    _summarize_hsbc_pending_settlement_cash,
    _replay_holdings,
    _sort_transactions,
    _tigertrade_simple_cash_rows,
    _normalize_source_artifacts,
    _validate_holdings,
    build_investment_payload_from_bochk_statement_pdfs,
    build_investment_payload_from_futuhk_statement_pdfs,
    build_investment_payload_from_ibkr_csvs,
    build_investment_payload_from_ibkr_gainskeeper_files,
    build_investment_payload_from_ibkr_web_pasted_text,
    build_investment_payload_from_hsbc_pasted_text,
    build_investment_payload_from_hsbc_usd_savings_csv,
    build_investment_payload_from_hsbc_statement_bundle,
    build_investment_payload_from_hsbc_statement_pairs,
    build_investment_payload_from_hsbc_statement_pdfs,
    build_investment_payload_from_longbridge,
    build_investment_payload_from_schwab_csv,
    build_investment_internal_transfer_binding_index,
    build_investment_internal_transfer_binding_key,
    apply_hsbc_order_execution_notification_timestamps,
    get_investment_internal_transfer_link_window_days,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    _preserve_authoritative_current_cash_scope,
    repair_hsbc_order_settlement_reconciliation,
    repair_ibkr_web_compact_split_fill_duplicates,
    refresh_investment_security_transfer_reconciliation,
    validate_hsbc_pasted_text,
    validate_investment_internal_transfer_binding,
    validate_investment_security_transfer_attribution,
)
from scripts.verify_investment_evidence import (
    plan_missing_investment_evidence_recovery,
    restore_missing_investment_evidence,
)

SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE = {
    "hsbc_performance_calibrations": {
        "000-999999-999": {"RAM": "3.21"},
    },
    "verified_tax_lot_history": {
        "hsbc": {
            "000-999999-999": {
                "DRAM": {
                    "currency": "USD",
                    "verified_through": "2026-08-07",
                    "expected_shares": "5",
                    "buy_count": 3,
                    "sell_count": 1,
                    "buy_quantity": "6",
                    "sell_quantity": "1",
                    "calculation_method": "synthetic_test_fixture",
                    "verification_source": "synthetic_test_fixture",
                },
            },
        },
    },
}


class InvestmentImportFixtureMixin:
    def setUp(self) -> None:
        self.private_evidence_patcher = patch.object(
            investment_import_service,
            "_load_local_private_investment_evidence",
            return_value=SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE,
        )
        self.private_evidence_patcher.start()
        self.addCleanup(self.private_evidence_patcher.stop)

    @staticmethod
    def _ibkr_csv_evidence_pair() -> tuple[bytes, bytes]:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Statement,Data,Period,July 1, 2026 - July 3, 2026",
                    "Statement,Data,WhenGenerated,2026-07-04 00:01:00 EDT",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,100",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-07-03,U***00001,Example Buy,Buy,QQQ,1,100,USD,-100,-0.01,-100.01",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Statement,Data,Period,July 1, 2026 - July 3, 2026",
                    "Statement,Data,WhenGenerated,2026-07-04 00:00:00 EDT",
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Stocks,QQQ,0,0,0,0,0,0,0,0,0,0,10,10,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Data,Summary,Stocks,USD,QQQ,-,1,1,100,100,110,110,10,",
                ]
            )
            + "\n"
        )
        return transactions_csv.encode("utf-8"), positions_csv.encode("utf-8")

    @staticmethod
    def _ibkr_gainskeeper_evidence_file() -> bytes:
        return b"""<OFX>
<SIGNONMSGSRSV1><SONRS><DTSERVER>20260704000100</DTSERVER></SONRS></SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS>
<INVACCTFROM><ACCTID>U00000001</ACCTID></INVACCTFROM>
<INVTRANLIST><DTSTART>20260701000000</DTSTART><DTEND>20260703235959</DTEND>
<BUYSTOCK><INVBUY><INVTRAN><FITID>QQQ-20260702-223338</FITID><DTTRADE>20260702223338</DTTRADE></INVTRAN><SECID><UNIQUEID>QQQ-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>1</UNITS><UNITPRICE>100</UNITPRICE><TOTAL>-100.01</TOTAL><COMMISSION>0.01</COMMISSION><TAXES>0</TAXES><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></INVBUY></BUYSTOCK>
</INVTRANLIST>
<INVPOSLIST><POSSTOCK><INVPOS><SECID><UNIQUEID>QQQ-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><HELDINACCT>CASH</HELDINACCT><POSTYPE>LONG</POSTYPE><UNITS>1</UNITS><UNITPRICE>110</UNITPRICE><MKTVAL>110</MKTVAL><DTPRICEASOF>20260703200000</DTPRICEASOF><MEMO>QQQ</MEMO></INVPOS><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></POSSTOCK></INVPOSLIST>
</INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>QQQ-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><SECNAME>Invesco QQQ Trust</SECNAME><TICKER>QQQ</TICKER></SECINFO></STOCKINFO></SECLIST>
</OFX>"""

    @staticmethod
    def _ibkr_gainskeeper_other_evidence_file() -> bytes:
        return b"""<OFX>
<SIGNONMSGSRSV1><SONRS><DTSERVER>20260815000100</DTSERVER></SONRS></SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS>
<CURDEF>USD</CURDEF><INVACCTFROM><ACCTID>U00000001</ACCTID></INVACCTFROM>
<INVTRANLIST><DTSTART>20250901000000</DTSTART><DTEND>20260814235959</DTEND>
<BUYOTHER><INVBUY><INVTRAN><FITID>OTHER-BUY-1</FITID><DTTRADE>20250908081418.000[-4:EDT]</DTTRADE></INVTRAN><SECID><UNIQUEID>OTHER-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>1020.408</UNITS><UNITPRICE>9.80000157</UNITPRICE><TOTAL>-10000.00000204</TOTAL><COMMISSION>0</COMMISSION><TAXES>0</TAXES><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></INVBUY></BUYOTHER>
<BUYOTHER><INVBUY><INVTRAN><FITID>OTHER-BUY-2</FITID><DTTRADE>20251008202000.000[-4:EDT]</DTTRADE></INVTRAN><SECID><UNIQUEID>OTHER-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>3.43</UNITS><UNITPRICE>9.79883382</UNITPRICE><TOTAL>-33.61</TOTAL><COMMISSION>0</COMMISSION><TAXES>0</TAXES><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></INVBUY></BUYOTHER>
<SELLOTHER><INVSELL><INVTRAN><FITID>OTHER-SELL-1</FITID><DTTRADE>20251013202912.000[-4:EDT]</DTTRADE></INVTRAN><SECID><UNIQUEID>OTHER-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>-100</UNITS><UNITPRICE>9.81</UNITPRICE><TOTAL>981</TOTAL><COMMISSION>0</COMMISSION><TAXES>0</TAXES><CURRENCY><CURSYM>USD</CURSYM></CURRENCY></INVSELL></SELLOTHER>
</INVTRANLIST><INVBAL><BALLIST><BAL><NAME>Cash</NAME><VALUE>879.44224649</VALUE></BAL></BALLIST></INVBAL>
</INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLIST><OTHERINFO><SECINFO><SECID><UNIQUEID>OTHER-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><SECNAME>Franklin U.S. Dollar Short-Term Money Market Fund</SECNAME><TICKER>005276756</TICKER><FIID>431251014</FIID></SECINFO></OTHERINFO></SECLIST>
</OFX>"""

    @staticmethod
    def _ibkr_gainskeeper_transfer_evidence_file() -> bytes:
        return b"""<OFX>
<SIGNONMSGSRSV1><SONRS><DTSERVER>20260805045340</DTSERVER></SONRS></SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS>
<CURDEF>USD</CURDEF><INVACCTFROM><ACCTID>U00000001</ACCTID></INVACCTFROM>
<INVTRANLIST><DTSTART>20260701000000</DTSTART><DTEND>20260804202000</DTEND>
<TRANSFER><INVTRAN><FITID>235985042</FITID><DTTRADE>20260731202000.000[-4:EDT]</DTTRADE>
<MEMO>FOP Transfer Out To Account 00000002</MEMO></INVTRAN>
<SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SUBACCTSEC>CASH</SUBACCTSEC><UNITS>-5.0</UNITS><TFERACTION>OUT</TFERACTION>
<POSTYPE>LONG</POSTYPE><UNITPRICE>52.68</UNITPRICE></TRANSFER>
<TRANSFER><INVTRAN><FITID>235985042</FITID><DTTRADE>20260803202000.000[-4:EDT]</DTTRADE>
<MEMO>FOP Transfer Out To Account 00000002</MEMO></INVTRAN>
<SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SUBACCTSEC>CASH</SUBACCTSEC><UNITS>-10.0</UNITS><TFERACTION>OUT</TFERACTION>
<POSTYPE>LONG</POSTYPE><UNITPRICE>53.04</UNITPRICE></TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SECNAME>QQQI NEOS NASDAQ-100 HIGH INC ETF</SECNAME><TICKER>QQQI</TICKER><FIID>235985042</FIID></SECINFO></STOCKINFO></SECLIST>
</OFX>"""

    @staticmethod
    def _ibkr_web_trade_notifications_text() -> str:
        return """Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
DRAM
Bot 5 @ 43.00 on OVERNIGHT
U00000001 Bought 5
Filled
7/29/2026, 12:17 PM
43.00
215
Fees: 0.35
DRAM
Bot 5 @ 44.00 on OVERNIGHT
U00000001 Bought 5
Filled
7/29/2026, 12:04 PM
44.00
220
Fees: 0.35
GOOGL
Sold 1 @ 331.35 on OVERNIGHT
U00000001 Sold 1
Filled
7/29/2026, 12:00 PM
331.35
331.35
Fees: 0.36
DRAM
Bot 3 @ 45.00 on OVERNIGHT
U00000001 Bought 3
Filled
7/29/2026, 11:03 AM
45.00
135
Fees: 0.35
DRAM
Bot 2 @ 45.50 on OVERNIGHT
U00000001 Bought 2
Filled
7/29/2026, 10:00 AM
45.50
91
Fees: 0.35
DRAM
Bot 5 @ 46.00 on ARCA
U00000001 Bought 5
Filled
7/29/2026, 6:49 AM
46.00
230
Fees: 0.34
"""

    @staticmethod
    def _ibkr_current_web_trade_notifications_text() -> str:
        return """Search
⌘ + K
Orders & Trades
Trade Notifications
Trades  Account Action   Quantity   Status   Price   Amount
ALFA
Bot 5 @ 14.00 on ARCA
U00000001   Bought  5
Filled
8/3/2025, 8:18 PM
14.00
70
Fees: 0.12
BETA
Bot 5 @ 15.35 on NASDAQ
U00000001   Bought  5
Filled
8/3/2025, 8:13 PM
15.35
76.75
Fees: 0.34
ALFA
Sold 5 @ 15.65 on OVERNIGHT
U00000001   Sold 5
Filled
8/3/2025, 9:56 AM
15.65
78.25
Fees: 0.35
ALFA
Sold 5 @ 15.65 on OVERNIGHT
U00000001   Sold 5
Filled
8/3/2025, 9:56 AM
15.65
78.25
Fees: 0.0
ALFA
Bot 3 @ 10.00 on OVERNIGHT
U00000001   Bought 3
Filled
8/1/2025, 12:57 PM
10.00
30
Fees: 0.12
"""

    @staticmethod
    def _synthetic_hsbc_paste_snapshot(
        *,
        portfolio_updated_date: str = "14 Jul 2026",
        order_status_end_date: str = "2026-07-15",
    ) -> tuple[str, str, str]:
        portfolio_text = "\n".join(
            [
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                f"Updated 17:15:00 on {portfolio_updated_date} U.S. ET",
                "PortfolioMarket valueUSD 61.000",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "DRAM",
                "ROUNDHILL MEMORY",
                "61.000",
                "+0.000",
                "0.00%1USD 61.000",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 61.000",
                "information",
            ]
        )
        order_status_text = "\n".join(
            [
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "2026-04-01",
                "01 Apr 2026",
                order_status_end_date,
                "15 Jul 2026",
                "order status",
                "All Order Status",
                "DRAM",
                "ROUNDHILL MEMORY",
                "14 Jul 2026 U.S. ET",
                "Fully Executed",
                "Sell",
                "Limit Price Order",
                "61.000USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "S-1",
            ]
        )
        cash_account_text = "\n".join(
            [
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "60.99",
                "USD",
                "Available balance:",
                "60.99 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "15 Jul 2026",
                "REF S900001001 SEC",
                "60.99",
                "60.99",
                "Download",
            ]
        )
        return portfolio_text, order_status_text, cash_account_text

    @staticmethod
    def _synthetic_hsbc_non_usd_cash_paste(
        *,
        include_hkd_current: bool = True,
        include_hkd_savings: bool = True,
        include_cnh_savings: bool = True,
    ) -> str:
        sections: list[str] = []
        if include_hkd_current:
            sections.extend(
                [
                    "HKD Current",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "1,000.00 HKD",
                    "Available balance:",
                    "1,000.00 HKD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "15 Jul 2026",
                    "LONGBRIDGE KOL REWARD",
                    "1,000.00",
                    "1,000.00",
                    "Download",
                ]
            )
        if include_hkd_savings:
            sections.extend(
                [
                    "HKD Savings",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "46.10 HKD",
                    "Available balance:",
                    "46.10 HKD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "15 Jul 2026",
                    "HKD INTEREST",
                    "46.10",
                    "46.10",
                    "Download",
                ]
            )
        if include_cnh_savings:
            sections.extend(
                [
                    "CNY Savings",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "12.00 CNY",
                    "Available balance:",
                    "12.00 CNY",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "15 Jul 2026",
                    "CNY INTEREST",
                    "12.00",
                    "12.00",
                    "Download",
                ]
            )
        return "\n".join(sections)

    @staticmethod
    def _synthetic_hsbc_hkd_cash_page(
        *,
        balance: str,
        post_date: str,
        description: str = "HKD INTEREST",
    ) -> str:
        return "\n".join(
            [
                "HKD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                f"{balance} HKD",
                "Available balance:",
                f"{balance} HKD",
                "Post date Description Amount in Amount out Balance Additional options",
                post_date,
                description,
                balance,
                balance,
                "Download",
            ]
        )

    @staticmethod
    def _synthetic_hsbc_statement_texts() -> tuple[str, str]:
        composite_text = "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 1 of 4",
                "10 July 2026",
                "Foreign Currency Savings",
                "CCY      Date         Transaction Details                                 Deposit       Withdrawal     Balance",
                "USD 10 Jun           B/F BALANCE                                                                       0.00",
                "    16 Jun           DEPOSIT                                              1,000.00                   1,000.00",
                "    17 Jun           WITHDRAWAL                                                            100.00      900.00",
                "    10 Jul           DEPOSIT                                                 21.29                     921.29",
                "Total Relationship Balance",
            ]
        )
        investment_text = "\n".join(
            [
                "Date : 10JUL2026",
                "A/C name : DEMO ACCOUNT HOLDER",
                "A/C no : 000-999999-998",
                "Period : From 11JUN2026 to 10JUL2026",
                "Portfolio details",
                "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
                "Risk Lvl NA 4 5 USD 100.48000 USD 502.40",
                "Transaction summary",
                "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
                "16JUN2026 17JUN2026 USD 100.00000 1 USD 100.00",
                "Reference: PURTMP900001 Type: PUR",
                "Charges and income summary",
                "10JUL2026 CASH DIVIDEND SGOV",
                "ISHARES 0-3 MONTH TRS BD (SHS)",
                "OUR REFERENCE:CORTMP890672010",
                "PAID BENEFITS USD 21.29",
            ]
        )
        return composite_text, investment_text

    @staticmethod
    def _synthetic_hsbc_full_monthly_statement_text() -> str:
        def statement_header() -> str:
            return f"{'Date':<12}{'Transaction Details':<76}{'Deposit':<12}{'Withdrawal':<12}Balance"

        def statement_row(
            date_text: str,
            description: str,
            *,
            deposit: str = "",
            withdrawal: str = "",
            balance: str = "",
        ) -> str:
            return (
                f"{date_text:<12}{description:<76}"
                f"{deposit:>12}{withdrawal:>12}{balance:>12}"
            )

        return "\n".join(
            [
                "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
                "HSBC One Portfolio",
                "Page 1 of 4",
                "10 July 2026",
                "Portfolio Summary",
                "USD 7.8365 1,010.00",
                "CNY 1.090 12.00",
                "HSBC One Account Transaction History",
                "HKD Savings",
                statement_header(),
                statement_row("HKD 01 Jun", "B/F BALANCE", balance="40.00"),
                statement_row("15 Jun", "DEPOSIT", deposit="6.10", balance="46.10"),
                "USD Savings",
                statement_header(),
                statement_row("USD 01 Jun", "B/F BALANCE", balance="10.00"),
                statement_row(
                    "15 Jun", "DEPOSIT", deposit="1,000.00", balance="1,010.00"
                ),
                "CNY Savings",
                statement_header(),
                statement_row("CNY 01 Jun", "B/F BALANCE", balance="10.00"),
                statement_row("15 Jun", "DEPOSIT", deposit="2.00", balance="12.00"),
                "Total Relationship Balance",
            ]
        )


__all__ = (
    "BrokerSettings",
    "Decimal",
    "Event",
    "InvestmentImportFixtureMixin",
    "LONGBRIDGE_IMPORT_WINDOW_DAYS",
    "LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS",
    "MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES",
    "MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES",
    "Path",
    "SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE",
    "SimpleNamespace",
    "TemporaryDirectory",
    "Thread",
    "_build_hsbc_cash_account_records_from_text",
    "_extract_futuhk_pdf_text",
    "_extract_statement_pdf_text",
    "_normalize_source_artifacts",
    "_parse_hsbc_order_status_plain_text",
    "_parse_ibkr_statement_period",
    "_preserve_authoritative_current_cash_scope",
    "_replay_holdings",
    "_sort_transactions",
    "_summarize_hsbc_pending_settlement_cash",
    "_tigertrade_simple_cash_rows",
    "_validate_holdings",
    "annotations",
    "apply_hsbc_order_execution_notification_timestamps",
    "base64",
    "build_investment_internal_transfer_binding_index",
    "build_investment_internal_transfer_binding_key",
    "build_investment_payload_from_bochk_statement_pdfs",
    "build_investment_payload_from_futuhk_statement_pdfs",
    "build_investment_payload_from_hsbc_pasted_text",
    "build_investment_payload_from_hsbc_statement_bundle",
    "build_investment_payload_from_hsbc_statement_pairs",
    "build_investment_payload_from_hsbc_statement_pdfs",
    "build_investment_payload_from_hsbc_usd_savings_csv",
    "build_investment_payload_from_ibkr_csvs",
    "build_investment_payload_from_ibkr_gainskeeper_files",
    "build_investment_payload_from_ibkr_web_pasted_text",
    "build_investment_payload_from_longbridge",
    "build_investment_payload_from_schwab_csv",
    "clear_investment_store",
    "contextmanager",
    "date",
    "deepcopy",
    "get_investment_internal_transfer_link_window_days",
    "hashlib",
    "investment_evidence_dir_for",
    "investment_import_service",
    "investment_source_artifact_storage_keys",
    "json",
    "load_investment_store_payload",
    "materialize_investment_source_artifacts",
    "merge_investment_payloads",
    "normalize_investment_payload_tickers",
    "patch",
    "plan_missing_investment_evidence_recovery",
    "refresh_investment_security_transfer_reconciliation",
    "repair_hsbc_order_settlement_reconciliation",
    "repair_ibkr_web_compact_split_fill_duplicates",
    "restore_missing_investment_evidence",
    "save_investment_store_payload",
    "storage",
    "unittest",
    "update_investment_store_payload",
    "validate_hsbc_pasted_text",
    "validate_investment_internal_transfer_binding",
    "validate_investment_security_transfer_attribution",
    "verify_investment_source_artifacts",
    "verify_persisted_investment_source_artifacts",
)
