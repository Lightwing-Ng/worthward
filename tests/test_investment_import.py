"""
Tests for IBKR investment import normalization.

Code version: v0.34.1
- Added: HSBC equal-dated incoming cash captures cannot be rolled back by an
  older current-cash scope attestation when the position snapshot winner is
  retained.
- Added: Schwab paired Journal cleanup coverage now derives from matching
  Security Transfer evidence, including the later 13 Aug 2026 DRAM and QQQI
  rows, and repairs stale cleanup rows during incremental merge.
- Added: HSBC settlement balances use the final chronological posting and
  official USD Savings CSV evidence overrides conflicting page order.
- Added: Same-day IBKR position snapshots prefer precise observation time
  and keep the broker summary synchronized with the cumulative CSV snapshot.
- Added: HSBC authoritative base-currency cash and unapplied pending fee
  evidence are preserved separately from raw order proceeds.
- Added: IBKR adjacent CSV performance periods preserve the complete current
  aggregate and merge it with the historical cumulative period exactly once.
- Added: IBKR mixed current-day and historical Trade Notifications paste
  coverage, including the user-selected page date and current cash/position
  boundary.
- Added: IBKR compact Orders aggregates supersede only exact full-page
  split-fill duplicates, including repair coverage for an existing ledger.
- Added: authoritative GKX split fills replace a matching provisional compact
  IBKR web aggregate even when GKX commission precision changes net cash.
- Added: IBKR current-moment web captures retain user-confirmed positions,
  cash, and same-minute split fills as one idempotent import.
- Added: IBKR stale GainsKeeper baselines and supplemental Trade
  Notifications merge identically in either import order, retain the
  user-verified post-fill cash boundary, and remain idempotent.
- Added: HSBC snapshot merges retain newer verification boundaries across
  repeated, older, and mixed-ledger imports.
- Added: GainsKeeper cash snapshots retain the latest intraday fill boundary,
  including the final trade's post-fill cash.
- Added: GainsKeeper OTHER security transactions retain FITIDs, precise source
  timestamps, and exact cash values; legacy shifted rows are normalized and
  deduplicated during merge.
- Added: Cross-broker incremental merges preserve the user-confirmed current
  cash scope and HSBC effective cash boundary.
- Added: HSBC incremental Order Status imports advance verified tax-lot
  boundaries only when the covered position closes exactly.
- Added: HSBC paired statements reconcile non-zero opening holdings, retain
  cross-page charges, publish complete cash/date metadata, and advance an older
  live snapshot only when the statement position date is later.
- Added: HSBC statement balance continuity, explicit zero-balance retention,
  transaction coverage dates, and incremental metadata union regressions.
- Added: Complete IBKR GainsKeeper windows extend verified position cost basis
  through exact commission-inclusive buys while incomplete windows fail closed.
- Added: HSBC attributed corporate-event dividends retain their classification
  and deduplicate across paste and USD Savings CSV source formats.
- Added: Additive source-evidence enrichment migrates disambiguated manual
  transfer keys without collapsing genuine same-value rows.
- Added: HSBC statement PDF immutable-artifact and settled-order residual
  provenance coverage.
- Added: HSBC execution-notification timestamp reconciliation coverage.
- Added: HSBC date-only Order Status execution-order regression coverage.
- Added: large-ledger candidate-index and transfer-binding index-reuse
  regression coverage.
- Added: HSBC matched SEC principal and fee legs retain their source ordering
  for non-transaction settlement-boundary replay.
- Added: HSBC same-day Portfolio evidence uses the explicit market-data update time.
- Added: newer GainsKeeper quantities do not inherit stale CSV cost basis.
- Added: identical HSBC cash source rows merge while retaining statement enrichment.
- Added: IBKR GainsKeeper in-kind security transfers upgrade matching legacy transfer rows without changing cash replay.
- Added: newer IBKR GainsKeeper position marks preserve cost basis from the existing IBKR open-positions CSV.
- Added: IBKR Realized Summary native-currency cash rows replace their base-currency Transaction History equivalents while unmatched rows remain available for manual transfer binding.
- Added: IBKR base-currency-equivalent funding rows can be manually bound to CNH bank withdrawals.
- Fixed: Schwab transfer receipts remain visible and paired with IBKR source
  legs while evidence-backed Journal cleanup rows stay suppressed.
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
from scripts.verify_investment_evidence import restore_missing_investment_evidence


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


class InvestmentImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.private_evidence_patcher = patch.object(
            investment_import_service,
            "_load_local_private_investment_evidence",
            return_value=SYNTHETIC_PRIVATE_INVESTMENT_EVIDENCE,
        )
        self.private_evidence_patcher.start()
        self.addCleanup(self.private_evidence_patcher.stop)

    def test_pdf_text_extraction_does_not_expose_pdftotext_diagnostics(self) -> None:
        internal_detail = "/Users/example/private.pdf token=secret-value"
        failed_process = SimpleNamespace(
            returncode=1,
            stderr=internal_detail,
            stdout="",
        )

        with patch(
            "app.services.investment_import.subprocess.run",
            return_value=failed_process,
        ):
            with self.assertRaises(ValueError) as futu_error:
                _extract_futuhk_pdf_text(b"not-a-real-pdf")
            with self.assertRaises(ValueError) as statement_error:
                _extract_statement_pdf_text(b"not-a-real-pdf", "Tiger Trade")

        for error in (futu_error.exception, statement_error.exception):
            message = str(error)
            self.assertIn("Could not extract text", message)
            self.assertNotIn("/Users/example", message)
            self.assertNotIn("secret-value", message)

    @staticmethod
    def _ibkr_csv_evidence_pair() -> tuple[bytes, bytes]:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,July 1, 2026 - July 3, 2026",
            "Statement,Data,WhenGenerated,2026-07-04 00:01:00 EDT",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,100",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-07-03,U***00001,Example Buy,Buy,QQQ,1,100,USD,-100,-0.01,-100.01",
        ]) + "\n"
        positions_csv = "\n".join([
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
        ]) + "\n"
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
<SECLIST><OTHERINFO><SECINFO><SECID><UNIQUEID>OTHER-ID</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><SECNAME>Franklin U.S. Dollar Short-Term Money Market Fund</SECNAME><TICKER>005276756</TICKER><FIID>303141751</FIID></SECINFO></OTHERINFO></SECLIST>
</OFX>"""

    @staticmethod
    def _ibkr_gainskeeper_transfer_evidence_file() -> bytes:
        return b"""<OFX>
<SIGNONMSGSRSV1><SONRS><DTSERVER>20260805045340</DTSERVER></SONRS></SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS>
<CURDEF>USD</CURDEF><INVACCTFROM><ACCTID>U00000001</ACCTID></INVACCTFROM>
<INVTRANLIST><DTSTART>20260701000000</DTSTART><DTEND>20260804202000</DTEND>
<TRANSFER><INVTRAN><FITID>021223301</FITID><DTTRADE>20260731202000.000[-4:EDT]</DTTRADE>
<MEMO>FOP Transfer Out To Account 00000002</MEMO></INVTRAN>
<SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SUBACCTSEC>CASH</SUBACCTSEC><UNITS>-5.0</UNITS><TFERACTION>OUT</TFERACTION>
<POSTYPE>LONG</POSTYPE><UNITPRICE>52.68</UNITPRICE></TRANSFER>
<TRANSFER><INVTRAN><FITID>021223301</FITID><DTTRADE>20260803202000.000[-4:EDT]</DTTRADE>
<MEMO>FOP Transfer Out To Account 00000002</MEMO></INVTRAN>
<SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SUBACCTSEC>CASH</SUBACCTSEC><UNITS>-10.0</UNITS><TFERACTION>OUT</TFERACTION>
<POSTYPE>LONG</POSTYPE><UNITPRICE>53.04</UNITPRICE></TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>78433H675</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID>
<SECNAME>QQQI NEOS NASDAQ-100 HIGH INC ETF</SECNAME><TICKER>QQQI</TICKER><FIID>021223301</FIID></SECINFO></STOCKINFO></SECLIST>
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
        portfolio_text = "\n".join([
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
        ])
        order_status_text = "\n".join([
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
        ])
        cash_account_text = "\n".join([
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
        ])
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
            sections.extend([
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
            ])
        if include_hkd_savings:
            sections.extend([
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
            ])
        if include_cnh_savings:
            sections.extend([
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
            ])
        return "\n".join(sections)

    @staticmethod
    def _synthetic_hsbc_hkd_cash_page(
        *,
        balance: str,
        post_date: str,
        description: str = "HKD INTEREST",
    ) -> str:
        return "\n".join([
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
        ])

    @staticmethod
    def _synthetic_hsbc_statement_texts() -> tuple[str, str]:
        composite_text = "\n".join([
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
        ])
        investment_text = "\n".join([
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
        ])
        return composite_text, investment_text

    @staticmethod
    def _synthetic_hsbc_full_monthly_statement_text() -> str:
        def statement_header() -> str:
            return f"{'Date':<12}{'Transaction Details':<76}{'Deposit':<12}{'Withdrawal':<12}Balance"

        def statement_row(
            date_text: str,
            description: str,
            *,
            deposit: str = '',
            withdrawal: str = '',
            balance: str = '',
        ) -> str:
            return (
                f"{date_text:<12}{description:<76}"
                f"{deposit:>12}{withdrawal:>12}{balance:>12}"
            )

        return "\n".join([
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
            statement_row("15 Jun", "DEPOSIT", deposit="1,000.00", balance="1,010.00"),
            "CNY Savings",
            statement_header(),
            statement_row("CNY 01 Jun", "B/F BALANCE", balance="10.00"),
            statement_row("15 Jun", "DEPOSIT", deposit="2.00", balance="12.00"),
            "Total Relationship Balance",
        ])

    def test_hsbc_statement_pair_import_reconciles_trade_dividend_cash_and_holdings(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch("app.services.investment_import._extract_statement_pdf_text", side_effect=extract_text):
            payload = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )

        self.assertEqual(payload["ending_cash"], "921.29")
        self.assertEqual(payload["position_snapshot"]["SGOV"]["quantity"], "5")
        self.assertEqual(
            payload["position_snapshot"]["SGOV"]["statement_opening_quantity"],
            "4",
        )
        self.assertEqual(
            payload["starting_cash_by_currency"],
            {"USD": "0.00"},
        )
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"USD": "921.29"},
        )
        self.assertEqual(payload["summary"]["transaction_date_min"], "2026-06-16")
        self.assertEqual(payload["summary"]["transaction_date_max"], "2026-07-10")
        self.assertEqual(payload["summary"]["statement_pair_count"], 1)
        dividend = next(record for record in payload["transactions"] if record["type"] == "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(dividend["net_amount_raw"], "21.29")
        self.assertEqual(dividend["source"]["corporate_action_reference"], "CORTMP890672010")
        trade = next(record for record in payload["transactions"] if record["type"] == "buy")
        self.assertEqual(trade["source"]["statement_order_id"], "P-900")
        self.assertEqual(trade["source"]["cash_settlement_date"], "2026-06-17")

    def test_hsbc_statement_pair_retains_sale_charge_across_page_header(self) -> None:
        def statement_header() -> str:
            return (
                f"{'Date':<12}{'Transaction Details':<76}"
                f"{'Deposit':<28}{'Withdrawal':<27}Balance"
            )

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
                f"{deposit:<28}{withdrawal:<27}{balance}"
            )

        composite_text = "\n".join([
            "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
            "HSBC One Portfolio",
            "Page 1 of 4",
            "10 July 2026",
            "Foreign Currency Savings",
            statement_header(),
            statement_row("USD 10 Jun", "B/F BALANCE", balance="0.00"),
            statement_row(
                "17 Jun",
                "SEC SALE PROCEEDS",
                deposit="100.00",
                balance="100.00",
            ),
            statement_row(
                "17 Jun",
                "XACT CHARGE",
                withdrawal="0.01",
                balance="99.99",
            ),
            "Total Relationship Balance",
        ])
        investment_text = "\n".join([
            "Date : 10JUL2026",
            "A/C name : DEMO ACCOUNT HOLDER",
            "A/C no : 000-999999-998",
            "Period : From 11JUN2026 to 10JUL2026",
            "Portfolio details",
            "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
            "Risk Lvl NA 2 1 USD 100.00000 USD 100.00",
            "Transaction summary",
            "SGOV                     ISHARES 0-3 MONTH TRS BD (SHS)",
            "16JUN2026 17JUN2026 USD 100.00000 1- USD 100.00",
            "Reference: SALTMP900002001 Type: SAL",
            "Charges and income summary",
            "16JUN2026 SALE SGOV",
            "ISHARES 0-3 MONTH TRS BD (SHS)",
            "OUR REFERENCE:SALTMP900002001",
            "Page 4 of 4",
            "HSBC Investment Services Composite Statement",
            "Date : 10JUL2026",
            "Charges and income summary",
            "XACT CHARGE USD 0.01",
        ])

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )

        sale = next(record for record in payload["transactions"] if record["type"] == "sell")
        self.assertEqual(sale["source"]["statement_order_id"], "S-900002")
        self.assertEqual(sale["commission_raw"], "-0.01")
        self.assertFalse(
            any(
                record["type"] == "withdrawal"
                and record["net_amount_raw"] == "-0.01"
                for record in payload["transactions"]
            )
        )

    def test_hsbc_full_monthly_statement_import_preserves_hkd_and_cnh(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text()
        statement_bytes = b"full-monthly"

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_bundle([
                (statement_bytes, "HSBC-2026-07.pdf"),
            ])

        self.assertEqual(payload["summary"]["statement_periods"], ["2026-07"])
        self.assertEqual(
            payload["starting_cash_by_currency"],
            {"USD": "10.00", "HKD": "40.00", "CNH": "10.00"},
        )
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "46.10", "USD": "1010.00", "CNH": "12.00"},
        )
        self.assertEqual(payload["ending_cash"], "1010.00")
        self.assertEqual(payload["summary"]["cash_snapshot_source"], "hsbc_statement_cash_balances")
        self.assertEqual(payload["summary"]["transaction_date_min"], "2026-06-15")
        self.assertEqual(payload["summary"]["transaction_date_max"], "2026-06-15")
        self.assertEqual(
            {transaction["currency"] for transaction in payload["transactions"]},
            {"USD", "HKD", "CNH"},
        )
        self.assertNotIn("CNY", {transaction["currency"] for transaction in payload["transactions"]})
        cnh_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "CNH"
        )
        hkd_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "HKD"
        )
        self.assertEqual(hkd_record["date"], "2026-06-15")
        self.assertEqual(hkd_record["datetime"], "2026-06-15 20:00:00")
        self.assertEqual(payload["datetime_policy"]["timezone"], "America/New_York")
        self.assertEqual(payload["datetime_policy"]["source_date_timezone"], "Asia/Hong_Kong")
        self.assertFalse(payload["datetime_policy"]["source_has_intraday_timestamp"])
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")
        self.assertEqual(cnh_record["source"]["file_kind"], "hsbc_statement_cash")
        self.assertEqual(cnh_record["source"]["statement_currency_to_base_rate_raw"], "7.189449541284403669724770642")
        statement_sha256 = hashlib.sha256(statement_bytes).hexdigest()
        self.assertEqual(len(payload["source_artifacts"]), 1)
        self.assertEqual(payload["source_artifacts"][0]["sha256"], statement_sha256)
        self.assertEqual(
            payload["source_artifacts"][0]["source_kind"],
            "hsbc_composite_statement_pdf",
        )
        self.assertTrue(
            all(
                transaction["source"]["source_file_sha256"] == statement_sha256
                for transaction in payload["transactions"]
            )
        )
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(
                payload,
                ledger_path,
            )
            verify_investment_source_artifacts(materialized, ledger_path)
            self.assertEqual(
                materialized["source_artifacts"][0]["storage_key"],
                statement_sha256,
            )

    def test_hsbc_statement_balance_continuity_rejects_unreconciled_rows(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text().replace(
            "1,010.00",
            "1,011.00",
        )

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            with self.assertRaisesRegex(ValueError, "balance continuity"):
                build_investment_payload_from_hsbc_statement_pdfs([
                    (b"unreconciled", "HSBC-2026-07.pdf"),
                ])

    def test_hsbc_statement_preserves_explicit_zero_currency_balances(self) -> None:
        statement_text = self._synthetic_hsbc_full_monthly_statement_text()
        for raw_value in (
            "1,010.00",
            "1,000.00",
            "46.10",
            "40.00",
            "2.00",
            "12.00",
            "10.00",
            "6.10",
        ):
            statement_text = statement_text.replace(raw_value, "0.00")

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pdfs([
                (b"zero-balance", "HSBC-2026-07.pdf"),
            ])

        expected_balances = {"HKD": "0.00", "USD": "0.00", "CNH": "0.00"}
        self.assertEqual(payload["ending_cash_by_currency"], expected_balances)
        self.assertEqual(
            payload["broker_summaries"]["hsbc"]["ending_cash_by_currency"],
            expected_balances,
        )

    def test_hsbc_statement_metadata_survives_incremental_merge(self) -> None:
        base_text = self._synthetic_hsbc_full_monthly_statement_text()
        june_text = base_text.replace("10 July 2026", "30 June 2026")
        july_text = (
            base_text
            .replace("10 July 2026", "31 July 2026")
            .replace("01 Jun", "01 Jul")
            .replace("15 Jun", "15 Jul")
        )
        june_bytes = b"june-statement"
        july_bytes = b"july-statement"

        june = build_investment_payload_from_hsbc_statement_pdfs(
            [(june_bytes, "HSBC-2026-06.pdf")],
            _extracted_text_by_payload_id={id(june_bytes): june_text},
        )
        july = build_investment_payload_from_hsbc_statement_pdfs(
            [(july_bytes, "HSBC-2026-07.pdf")],
            _extracted_text_by_payload_id={id(july_bytes): july_text},
        )

        merged = merge_investment_payloads(june, july)

        self.assertEqual(merged["summary"]["statement_count"], 2)
        self.assertEqual(
            merged["summary"]["statement_periods"],
            ["2026-06", "2026-07"],
        )
        self.assertEqual(merged["summary"]["statement_date_min"], "2026-06-30")
        self.assertEqual(merged["summary"]["statement_date_max"], "2026-07-31")
        self.assertEqual(merged["summary"]["transaction_date_min"], "2026-06-15")
        self.assertEqual(merged["summary"]["transaction_date_max"], "2026-07-15")
        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["statement_count"], 2)
        self.assertEqual(hsbc_summary["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(hsbc_summary["transaction_date_min"], "2026-06-15")
        self.assertEqual(hsbc_summary["transaction_date_max"], "2026-07-15")

    def test_hsbc_statement_deposit_boundary_preserves_interest_and_correction(self) -> None:
        statement_text = "\n".join([
            "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
            "HSBC One Portfolio",
            "Page 3 of 4",
            "10 July 2026",
            "HSBC One Account Transaction History",
            "Foreign Currency Savings",
            "CCY   Date        Transaction Details                                     Deposit       Withdrawal     Balance",
            "CNY 10 Jun       B/F BALANCE                                                                           0.00",
            "      27 Jun     CREDIT INTEREST                                                 0.01                      0.01",
            "      3 Jul      WITHDRAWAL",
            "                 HC000001 03JUL                                                        0.01                      0.00",
            "                 WITHDRAWAL CORRECTION",
            "                 HC000002 03JUL                                          0.01                      0.01",
            "Total Relationship Balance",
        ])

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_pdfs([
                (b"cny-boundary", "eStatementFile_106353.pdf"),
            ])

        cnh_records = [
            record
            for record in payload["transactions"]
            if record["currency"] == "CNH"
        ]
        self.assertEqual(
            [
                (record["description"], record["type"], record["net_amount_raw"])
                for record in cnh_records
            ],
            [
                ("CREDIT INTEREST", "credit_interest", "0.01"),
                ("WITHDRAWAL HC000001 03JUL", "withdrawal", "-0.01"),
                ("WITHDRAWAL CORRECTION HC000002 03JUL", "deposit", "0.01"),
            ],
        )
        self.assertEqual(payload["ending_cash_by_currency"], {"CNH": "0.01"})

    def test_hsbc_usd_savings_csv_calibration_validates_history_and_latest_balance(self) -> None:
        csv_text = "\n".join([
            "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
            "02/01/2026,REF P900020001 SEC,-10.00,USD,90.00,USD",
            "01/01/2026,9285883 R00460,100.00,USD,100.00,USD",
        ])

        payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        self.assertEqual(payload["ending_cash"], "90.00")
        self.assertEqual(payload["starting_cash"], "0.00")
        self.assertEqual(payload["summary"]["statement_date_min"], "2026-01-01")
        self.assertEqual(payload["summary"]["statement_date_max"], "2026-01-02")
        self.assertEqual(payload["summary"]["hsbc_ending_cash_components"], {"USD:SAVINGS": "90.00"})
        self.assertEqual(len(payload["transactions"]), 1)
        self.assertEqual(payload["generator"]["cash_row_count"], 2)
        self.assertEqual(payload["source_artifacts"][0]["source_kind"], "hsbc_usd_savings_transaction_history_csv")

    def test_hsbc_usd_savings_csv_replays_same_day_rows_in_bank_chronology(self) -> None:
        csv_text = "\n".join([
            "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
            "24/06/2026,HK112763BUG20IGW,2948.41,USD,17229.65,USD",
            "24/06/2026,HK634259JOG5BW18 823,2200.88,USD,14281.24,USD",
            "23/06/2026,HK725644FAFX2BPF 546,100.00,USD,12080.36,USD",
        ])

        payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        self.assertEqual(
            [record["description"] for record in payload["transactions"]],
            [
                "HK725644FAFX2BPF 546",
                "HK634259JOG5BW18 823",
                "HK112763BUG20IGW",
            ],
        )

    def test_hsbc_mixed_broker_summary_uses_each_cash_subaccount_not_last_global_row(self) -> None:
        def cash_record(
            *,
            date_text: str,
            currency: str,
            account_type: str,
            amount: str,
            balance: str,
        ) -> dict[str, object]:
            return {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": "deposit" if Decimal(amount) > 0 else "withdrawal",
                "ticker": "",
                "currency": currency,
                "description": f"{currency} cash",
                "gross_amount_raw": amount,
                "commission_raw": "0",
                "net_amount_raw": amount,
                "source": {
                    "file_kind": "hsbc_multi_currency_cash_account_text",
                    "account": "000-999999-999",
                    "account_number": "000-999999-999",
                    "account_type": account_type,
                    "balance_after_raw": balance,
                    "cash_balance_scope": "account",
                    "row_number": 1,
                },
                "broker": "hsbc",
                "account": "000-999999-999",
            }

        hsbc_payload = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                cash_record(
                    date_text="2026-08-01",
                    currency="USD",
                    account_type="USD Savings",
                    amount="90.00",
                    balance="90.00",
                ),
                cash_record(
                    date_text="2026-08-02",
                    currency="HKD",
                    account_type="HKD Savings",
                    amount="46.10",
                    balance="46.10",
                ),
                cash_record(
                    date_text="2026-08-03",
                    currency="HKD",
                    account_type="HKD Current",
                    amount="-46.10",
                    balance="0.00",
                ),
            ],
        }
        other_broker_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "transactions": [],
        }

        merged = merge_investment_payloads(other_broker_payload, hsbc_payload)

        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["ending_cash"], "90.00")
        self.assertEqual(
            hsbc_summary["ending_cash_by_currency"],
            {"USD": "90.00", "HKD": "46.10"},
        )
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"],
            {"USD:SAVINGS": "90.00", "HKD:SAVINGS": "46.10", "HKD:CURRENT": "0.00"},
        )

    def test_hsbc_non_usd_clip_preserves_newer_usd_calibration_in_mixed_store(self) -> None:
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "multiple",
            "account": "multiple",
            "summary": {},
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "ending_cash": "20444.97",
                    "ending_cash_raw": "20444.97",
                    "calibration_source": "hsbc_usd_savings_transaction_history_csv",
                    "hsbc_ending_cash_components": {
                        "USD:SAVINGS": "20444.97",
                    },
                    "hsbc_cash_component_post_dates": {
                        "USD:SAVINGS": "2026-08-04",
                    },
                },
            },
            "transactions": [
                {
                    "date": "2026-08-04",
                    "type": "deposit",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "IBKR cash",
                    "net_amount_raw": "1.00",
                },
            ],
        }
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        merged = merge_investment_payloads(existing_payload, cash_only_payload)

        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(
            hsbc_summary["ending_cash_by_currency"],
            {"USD": "20444.97", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(hsbc_summary["ending_cash"], "20444.97")
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"]["USD:SAVINGS"],
            "20444.97",
        )
        self.assertNotIn("ending_cash_by_currency", merged["summary"])

    def test_hsbc_older_usd_history_cannot_replace_newer_app_cash_calibration(self) -> None:
        def cash_payload(
            *,
            date_text: str,
            balance: str,
            source: str,
        ) -> dict[str, object]:
            transaction = {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": "deposit",
                "ticker": "",
                "currency": "USD",
                "description": "USD cash calibration",
                "gross_amount_raw": "1.00",
                "commission_raw": "0",
                "net_amount_raw": "1.00",
                "source": {
                    "file_kind": "hsbc_usd_savings_csv",
                    "account_type": "USD Savings",
                    "account_number": "000-999999-999",
                    "balance_after_raw": balance,
                    "row_number": 1,
                    "ledger_sequence": 1,
                },
                "broker": "hsbc",
                "account": "000-999999-999",
            }
            components = {"USD:SAVINGS": balance}
            dates = {"USD:SAVINGS": date_text}
            return {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {
                    "cash_snapshot_source": source,
                    "hsbc_ending_cash_components": components,
                    "hsbc_cash_component_post_dates": dates,
                },
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": balance,
                        "ending_cash_raw": balance,
                        "ending_cash_base_currency": balance,
                        "ending_cash_by_currency": {"USD": balance},
                        "calibration_source": source,
                        "cash_snapshot_source": source,
                        "hsbc_ending_cash_components": components,
                        "hsbc_cash_component_post_dates": dates,
                    },
                },
                "transactions": [transaction],
            }

        existing = cash_payload(
            date_text="2026-08-04",
            balance="20444.97",
            source="hsbc_app_manual_calibration",
        )
        older_csv = cash_payload(
            date_text="2026-07-10",
            balance="27357.71",
            source="hsbc_usd_savings_transaction_history_csv",
        )

        merged = merge_investment_payloads(existing, older_csv)
        hsbc_summary = merged["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["ending_cash"], "20444.97")
        self.assertEqual(hsbc_summary["ending_cash_base_currency"], "20444.97")
        self.assertEqual(hsbc_summary["hsbc_ending_cash_components"]["USD:SAVINGS"], "20444.97")
        self.assertEqual(hsbc_summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"], "2026-08-04")
        self.assertEqual(hsbc_summary["calibration_source"], "hsbc_app_manual_calibration")
        self.assertEqual(hsbc_summary["cash_snapshot_source"], "hsbc_app_manual_calibration")

        newer_statement = cash_payload(
            date_text="2026-08-31",
            balance="19000.00",
            source="hsbc_statement_cash_balances",
        )
        replaced = merge_investment_payloads(existing, newer_statement)
        replaced_summary = replaced["broker_summaries"]["hsbc"]
        self.assertEqual(replaced_summary["ending_cash"], "19000.00")
        self.assertEqual(
            replaced_summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"],
            "2026-08-31",
        )
        self.assertEqual(
            replaced_summary["calibration_source"],
            "hsbc_statement_cash_balances",
        )

    def test_hsbc_full_monthly_statement_marks_explicit_forex_components_without_inferring_pairs(self) -> None:
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

        statement_text = "\n".join([
            "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
            "HSBC One Portfolio",
            "Page 1 of 2",
            "10 July 2026",
            "Portfolio Summary",
            "USD 7.8365 1,010.00",
            "HSBC One Account Transaction History",
            "HKD Current",
            statement_header(),
            statement_row("HKD 01 Jun", "B/F BALANCE", balance="10,000.00"),
            statement_row(
                "15 Jun",
                "N000001 - FOREIGN EXCHANGE DEBIT",
                withdrawal="7,800.00",
                balance="2,200.00",
            ),
            "USD Savings",
            statement_header(),
            statement_row("USD 01 Jun", "B/F BALANCE", balance="0.00"),
            statement_row(
                "15 Jun",
                "N000001 - FOREIGN EXCHANGE CREDIT",
                deposit="1,000.00",
                balance="1,000.00",
            ),
            "Total Relationship Balance",
        ])

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            return_value=statement_text,
        ):
            payload = build_investment_payload_from_hsbc_statement_bundle([
                (b"full-monthly-forex", "HSBC-2026-07.pdf"),
            ])

        forex_records = [
            transaction
            for transaction in payload["transactions"]
            if transaction["type"] == "forex_trade_component"
        ]
        self.assertEqual(len(forex_records), 2)
        self.assertEqual({transaction["currency"] for transaction in forex_records}, {"HKD", "USD"})
        self.assertEqual(
            {transaction["source"].get("forex_pair_reference_id") for transaction in forex_records},
            {"N000001"},
        )
        self.assertEqual(
            {transaction["source"].get("forex_pair_component") for transaction in forex_records},
            {"sold", "acquired"},
        )

    def test_hsbc_summary_only_statement_does_not_reset_latest_cash(self) -> None:
        summary_only_text = "\n".join([
            "DEMO ACCOUNT HOLDER                                      Number : 000-999999-999",
            "HSBC One Portfolio",
            "Page 1 of 1",
            "10 August 2026",
            "Total Relationship Balance",
            "Important Notice",
        ])
        full_statement_text = self._synthetic_hsbc_full_monthly_statement_text()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return full_statement_text if pdf_bytes == b"full-monthly" else summary_only_text

        with patch("app.services.investment_import._extract_statement_pdf_text", side_effect=extract_text):
            payload = build_investment_payload_from_hsbc_statement_bundle([
                (b"full-monthly", "HSBC-2026-07.pdf"),
                (b"summary-only", "HSBC-2026-08.pdf"),
            ])

        self.assertEqual(payload["summary"]["statement_periods"], ["2026-07", "2026-08"])
        self.assertEqual(payload["ending_cash"], "1010.00")
        self.assertEqual(payload["ending_cash_by_currency"]["HKD"], "46.10")
        self.assertEqual(payload["summary"]["statement_date_max"], "2026-08-10")

    def test_hsbc_statement_cash_deduplicates_legacy_cash_event(self) -> None:
        legacy_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "HK711493P6025013",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "account_type": "USD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        statement_cash = {
            **legacy_cash,
            "description": "WITHDRAWAL",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_647003.pdf",
                "account_type": "Foreign Currency Savings USD",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
        }

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [legacy_cash],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_cash],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["summary"]["incremental_import"]["added_record_count"], 0)
        self.assertEqual(merged["summary"]["incremental_import"]["duplicate_record_count"], 1)
        self.assertEqual(merged["transactions"][0]["description"], "HK711493P6025013")

    def test_hsbc_cash_cross_source_merge_retains_same_source_candidate_alias(self) -> None:
        statement_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "WITHDRAWAL",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_647003.pdf",
                "account_type": "Foreign Currency Savings USD",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        legacy_cash = {
            "date": "2026-05-29",
            "datetime": "2026-05-29 12:00:00",
            "type": "withdrawal",
            "ticker": "",
            "currency": "USD",
            "description": "HK711493P6025013",
            "net_amount_raw": "-400.00",
            "gross_amount_raw": "-400.00",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "source_filename": "cash.txt",
                "account_type": "USD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "0.00",
                "row_number": 1,
                "ledger_sequence": 1,
                "reference_id": "HK711493P6025013",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_cash],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [legacy_cash, deepcopy(legacy_cash)],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["summary"]["incremental_import"]["added_record_count"], 0)
        self.assertEqual(merged["summary"]["incremental_import"]["duplicate_record_count"], 2)
        self.assertEqual(
            merged["transactions"][0]["source"]["file_kind"],
            "hsbc_usd_account_text",
        )

    def test_hsbc_cash_same_source_row_deduplicates_statement_enrichment(self) -> None:
        source_record = {
            "date": "2026-06-01",
            "datetime": "2026-06-01 20:00:00",
            "type": "deposit",
            "ticker": "",
            "currency": "CNH",
            "description": "REF00000000000000 31MAY (31MAY26)",
            "net_amount_raw": "10000.02",
            "gross_amount_raw": "10000.02",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "RMB Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "10000.02",
                "row_number": 13,
                "ledger_sequence": 13,
                "reference_id": "REF00000000000000 31MAY (31MAY26)",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        statement_enriched_record = deepcopy(source_record)
        statement_enriched_record["source"].update({
            "statement_date": "2026-06-10",
            "statement_pdf_balance_after_raw": "5000.00",
            "statement_pdf_source_filename": "eStatementFile_647003.pdf",
            "statement_pdf_statement_period": "2026-06",
        })

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [source_record],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [statement_enriched_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["summary"]["incremental_import"]["added_record_count"], 0)
        self.assertEqual(merged["summary"]["incremental_import"]["duplicate_record_count"], 1)
        self.assertEqual(
            merged["transactions"][0]["source"]["statement_pdf_source_filename"],
            "eStatementFile_647003.pdf",
        )

    def test_hsbc_historical_statement_does_not_replace_current_cash_snapshot(self) -> None:
        statement_cash = {
            "date": "2026-06-05",
            "datetime": "2026-06-05 12:00:00",
            "type": "deposit",
            "ticker": "",
            "currency": "HKD",
            "description": "DEMO ACCOUNT HOLDER REF00000000000000 05JUN",
            "net_amount_raw": "115.53",
            "gross_amount_raw": "115.53",
            "commission_raw": "0",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_647003.pdf",
                "account_type": "HKD Savings",
                "account_number": "000-999999-999",
                "balance_after_raw": "124.10",
                "statement_date": "2026-06-10",
            },
            "broker": "hsbc",
            "account": "000-999999-999",
        }
        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "multiple",
                "account": "multiple",
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": "20616.39",
                        "ending_cash_raw": "20616.39",
                        "calibration_source": "hsbc_usd_savings_available_balance",
                    },
                },
                "transactions": [],
            },
            {
                "schema_version": 3,
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {
                    "historical_statement_backfill": True,
                    "ending_cash_by_currency": {"HKD": "46.10"},
                    "ending_cash_base_currency": "5.88",
                },
                "broker_summaries": {
                    "hsbc": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "ending_cash": "0.00",
                        "ending_cash_by_currency": {"HKD": "46.10"},
                        "ending_cash_base_currency": "5.88",
                    },
                },
                "transactions": [statement_cash],
            },
        )

        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "20616.39")
        self.assertNotIn("ending_cash_by_currency", merged["summary"])

    def test_hsbc_pasted_snapshot_records_one_bundle_fingerprint_and_boundary(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot()

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        snapshot = payload["summary"]["hsbc_snapshot"]
        self.assertEqual(snapshot["status"], "validated")
        self.assertEqual(snapshot["cash_latest_post_date"], "2026-07-15")
        self.assertEqual(snapshot["latest_fully_executed_order_date"], "2026-07-14")
        self.assertEqual(snapshot["order_status_windows"][0]["end_date"], "2026-07-15")
        self.assertRegex(snapshot["fingerprint"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            payload["generator"]["hsbc_snapshot_fingerprint"],
            snapshot["fingerprint"],
        )
        ram_performance = payload["broker_summaries"]["hsbc"]["performance_snapshot"]["RAM"]
        self.assertEqual(ram_performance["realized_total"], "3.21")
        self.assertTrue(ram_performance["realized_total_includes_nonperformance"])
        hsbc_summary = payload["broker_summaries"]["hsbc"]
        self.assertTrue(hsbc_summary["position_snapshot_authoritative"])
        self.assertEqual(hsbc_summary["position_snapshot_source"], "hsbc_portfolio_text")
        self.assertEqual(hsbc_summary["position_snapshot"]["DRAM"]["quantity"], "1")
        self.assertEqual(hsbc_summary["holdings_validation"]["matched"], False)

    def test_hsbc_incremental_order_status_advances_verified_tax_lot_boundary(self) -> None:
        def order_record(*, transaction_type: str, date_text: str, quantity: str, price: str, order_id: str) -> dict[str, object]:
            signed_amount = (
                f"-{Decimal(quantity) * Decimal(price)}"
                if transaction_type == "buy"
                else f"{Decimal(quantity) * Decimal(price)}"
            )
            return {
                "date": date_text,
                "datetime": f"{date_text} 20:00:00",
                "type": transaction_type,
                "ticker": "DRAM",
                "currency": "USD",
                "broker": "hsbc",
                "account": "000-999999-999",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "price_raw": price,
                "net_amount_raw": signed_amount,
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "order_id": order_id,
                    "statement_order_id": order_id,
                    "account_number": "000-999999-999",
                },
            }

        def snapshot(*, as_of: str, coverage_end: str) -> dict[str, object]:
            coverage = {
                "mode": "explicit_date_ranges",
                "windows": [{"start_date": "2026-08-01", "end_date": coverage_end}],
            }
            return {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "hsbc_portfolio_text",
                "position_snapshot_as_of": as_of,
                "position_snapshot": {
                    "DRAM": {
                        "currency": "USD",
                        "quantity": "5",
                        "cost_price": "50",
                        "market_value": "10800",
                        "last_price": "54",
                    },
                },
                "hsbc_snapshot": {
                    "status": "validated",
                    "portfolio_market_data_updated_at": {"date": as_of},
                    "order_status_coverage": coverage,
                },
                "order_history_scope": coverage,
            }

        existing = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": snapshot(as_of="2026-08-07", coverage_end="2026-08-07"),
            "position_snapshot": snapshot(
                as_of="2026-08-07",
                coverage_end="2026-08-07",
            )["position_snapshot"],
            "transactions": [
                order_record(
                    transaction_type="buy",
                    date_text="2026-08-06",
                    quantity="5",
                    price="50",
                    order_id="P-OLD-DRAM",
                ),
            ],
        }
        incoming = {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": snapshot(as_of="2026-08-12", coverage_end="2026-08-13"),
            "position_snapshot": snapshot(
                as_of="2026-08-12",
                coverage_end="2026-08-13",
            )["position_snapshot"],
            "transactions": [
                order_record(
                    transaction_type="buy",
                    date_text="2026-08-12",
                    quantity="5",
                    price="10",
                    order_id="P-NEW-DRAM",
                ),
                order_record(
                    transaction_type="sell",
                    date_text="2026-08-12",
                    quantity="5",
                    price="12",
                    order_id="S-NEW-DRAM",
                ),
            ],
        }

        merged = merge_investment_payloads(existing, incoming)
        verification = merged["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]

        self.assertEqual(verification["verified_through"], "2026-08-12")
        self.assertEqual(verification["expected_shares"], "5")
        self.assertEqual(verification["buy_count"], 4)
        self.assertEqual(verification["sell_count"], 2)
        self.assertEqual(verification["buy_quantity"], "11")
        self.assertEqual(verification["sell_quantity"], "6")
        self.assertEqual(
            verification["verification_source"],
            "authoritative_position_snapshot_and_incremental_replay",
        )

        reimported = merge_investment_payloads(merged, deepcopy(incoming))
        reimported_verification = reimported["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(len(reimported["transactions"]), len(merged["transactions"]))
        self.assertEqual(reimported_verification, verification)

        older_snapshot = deepcopy(existing)
        older_snapshot["summary"]["position_snapshot"]["DRAM"]["quantity"] = "200"
        older_snapshot["summary"]["position_snapshot_as_of"] = "2026-08-07"
        older_snapshot["summary"]["hsbc_snapshot"]["portfolio_market_data_updated_at"] = {
            "date": "2026-08-07",
        }
        older_snapshot["summary"]["order_history_scope"]["windows"] = [{
            "start_date": "2026-08-01",
            "end_date": "2026-08-07",
        }]
        older_snapshot["summary"]["hsbc_snapshot"]["order_status_coverage"]["windows"] = [{
            "start_date": "2026-08-01",
            "end_date": "2026-08-07",
        }]
        rolled_back = merge_investment_payloads(reimported, older_snapshot)
        rolled_back_verification = rolled_back["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(
            rolled_back["broker_summaries"]["hsbc"]["position_snapshot_as_of"],
            "2026-08-12",
        )
        self.assertEqual(rolled_back_verification, verification)

        mixed_ledger = deepcopy(reimported)
        mixed_ledger["broker"] = "multiple"
        mixed_ledger["account"] = "multiple"
        mixed_ledger["summary"]["cash_flow_transaction_source"] = "boc_hk_statement_pdf"
        mixed_ledger["broker_summaries"]["boc_hk"] = {
            "broker": "boc_hk",
            "cash_flow_transaction_source": "boc_hk_statement_pdf",
            "statement_periods": ["2026-08"],
        }
        mixed_reimported = merge_investment_payloads(
            mixed_ledger,
            deepcopy(mixed_ledger),
        )
        mixed_verification = mixed_reimported["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(mixed_verification, verification)

        incomplete_coverage = deepcopy(incoming)
        incomplete_coverage["summary"]["order_history_scope"]["windows"] = [{
            "start_date": "2026-08-10",
            "end_date": "2026-08-13",
        }]
        incomplete_coverage["summary"]["hsbc_snapshot"]["order_status_coverage"]["windows"] = [{
            "start_date": "2026-08-10",
            "end_date": "2026-08-13",
        }]
        incomplete = merge_investment_payloads(existing, incomplete_coverage)
        incomplete_verification = incomplete["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(incomplete_verification["verified_through"], "2026-08-07")
        self.assertEqual(incomplete_verification["buy_count"], 3)
        self.assertEqual(incomplete_verification["sell_count"], 1)

        statement_only = deepcopy(incoming)
        statement_only["transactions"] = [
            order_record(
                transaction_type="buy",
                date_text="2026-08-12",
                quantity="5",
                price="10",
                order_id="S-STATEMENT-DRAM",
            ),
            order_record(
                transaction_type="sell",
                date_text="2026-08-12",
                quantity="5",
                price="12",
                order_id="S-STATEMENT-DRAM-SELL",
            ),
        ]
        for transaction in statement_only["transactions"]:
            transaction["source"]["file_kind"] = "hsbc_statement_cash"
        statement_only_result = merge_investment_payloads(existing, statement_only)
        statement_only_verification = statement_only_result["broker_summaries"]["hsbc"][
            "tax_lot_history_verifications"
        ]["DRAM"]
        self.assertEqual(statement_only_verification["verified_through"], "2026-08-07")
        self.assertEqual(statement_only_verification["buy_count"], 3)
        self.assertEqual(statement_only_verification["sell_count"], 1)

    def test_hsbc_pasted_snapshot_import_preserves_hkd_and_cnh(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot()
        supplementary_cash_text = "\n".join([
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
        ])
        cash_account_text = (
            f"{cash_account_text}\n===== HSBC PASTE CHUNK =====\n{supplementary_cash_text}"
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "46.10", "CNH": "12.00"},
        )
        self.assertEqual(
            payload["summary"]["cash_flow_transaction_source"],
            "hsbc_multi_currency_cash_account_text",
        )
        self.assertEqual(
            {transaction["currency"] for transaction in payload["transactions"]},
            {"USD", "HKD", "CNH"},
        )
        self.assertNotIn("CNY", {transaction["currency"] for transaction in payload["transactions"]})
        cnh_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "CNH"
        )
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")
        self.assertEqual(cnh_record["source"]["file_kind"], "hsbc_multi_currency_cash_account_text")

    def test_hsbc_non_usd_cash_only_paste_can_sync_without_usd_pages(self) -> None:
        cash_account_text = self._synthetic_hsbc_non_usd_cash_paste()

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=cash_account_text,
        )

        self.assertIsNone(payload["ending_cash"])
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(
            payload["summary"]["hsbc_ending_cash_components"],
            {
                "HKD:CURRENT": "1000.00",
                "HKD:SAVINGS": "46.10",
                "CNH:SAVINGS": "12.00",
            },
        )
        self.assertEqual(payload["summary"]["hsbc_paste_import_scope"], "cash_only_non_usd")
        self.assertEqual(payload["position_snapshot"], {})
        self.assertEqual(
            {transaction["currency"] for transaction in payload["transactions"]},
            {"HKD", "CNH"},
        )
        cnh_record = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["currency"] == "CNH"
        )
        self.assertEqual(cnh_record["source"]["statement_currency_raw"], "CNY")

    def test_hsbc_cash_only_paste_merges_hkd_current_and_savings_balances(self) -> None:
        current_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(
                include_hkd_savings=False,
                include_cnh_savings=False,
            ),
        )
        savings_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(
                include_hkd_current=False,
                include_cnh_savings=False,
            ),
        )

        merged = merge_investment_payloads(current_payload, savings_payload)

        self.assertEqual(merged["ending_cash_by_currency"], {"HKD": "1046.10"})
        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {"HKD:CURRENT": "1000.00", "HKD:SAVINGS": "46.10"},
        )

    def test_hsbc_cash_only_paste_rejects_a_malformed_subaccount_section(self) -> None:
        cash_account_text = "\n".join([
            self._synthetic_hsbc_non_usd_cash_paste(
                include_hkd_savings=False,
                include_cnh_savings=False,
            ),
            "HKD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "46.10 HKD",
            "Post date Description Amount in Amount out Balance Additional options",
            "15 Jul 2026",
            "HKD INTEREST",
            "46.10",
            "46.10",
            "Download",
        ])

        with self.assertRaisesRegex(ValueError, r"HKD Savings section"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=cash_account_text,
            )

    def test_hsbc_cash_only_paste_keeps_newest_balance_for_duplicate_subaccount_clips(self) -> None:
        newer_clip = self._synthetic_hsbc_hkd_cash_page(
            balance="46.10",
            post_date="15 Jul 2026",
        )
        older_clip = self._synthetic_hsbc_hkd_cash_page(
            balance="40.00",
            post_date="15 Jun 2026",
        )
        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text="\n===== HSBC PASTE CHUNK =====\n".join([
                newer_clip,
                older_clip,
            ]),
        )

        self.assertEqual(payload["ending_cash_by_currency"], {"HKD": "46.10"})
        self.assertEqual(
            payload["summary"]["hsbc_ending_cash_components"],
            {"HKD:SAVINGS": "46.10"},
        )
        self.assertEqual(
            payload["summary"]["hsbc_cash_component_post_dates"],
            {"HKD:SAVINGS": "2026-07-15"},
        )

        merged = merge_investment_payloads(
            payload,
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=older_clip,
            ),
        )
        self.assertEqual(merged["ending_cash_by_currency"], {"HKD": "46.10"})
        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {"HKD:SAVINGS": "46.10"},
        )

    def test_hsbc_cash_only_paste_preserves_usd_snapshot_and_hkd_cnh_balances(self) -> None:
        portfolio_text, order_status_text, usd_cash_account_text = self._synthetic_hsbc_paste_snapshot()
        usd_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=usd_cash_account_text,
        )
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        merged = merge_investment_payloads(usd_payload, cash_only_payload)

        self.assertEqual(merged["ending_cash"], usd_payload["ending_cash"])
        self.assertEqual(merged["position_snapshot"], usd_payload["position_snapshot"])
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "60.99")
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )
        self.assertEqual(merged["summary"]["hsbc_paste_import_scope"], "usd_composite")

        legacy_usd_payload = deepcopy(usd_payload)
        legacy_usd_payload["summary"].pop("hsbc_paste_import_scope", None)
        legacy_merged = merge_investment_payloads(legacy_usd_payload, cash_only_payload)
        refreshed_usd_snapshot = merge_investment_payloads(legacy_merged, usd_payload)

        self.assertEqual(legacy_merged["summary"]["hsbc_paste_import_scope"], "usd_composite")
        self.assertEqual(
            refreshed_usd_snapshot["ending_cash_by_currency"],
            {"USD": "60.99", "HKD": "1046.10", "CNH": "12.00"},
        )

    def test_hsbc_statement_legacy_currency_totals_do_not_double_count_pasted_subaccounts(self) -> None:
        pasted_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )
        historical_payload = deepcopy(pasted_payload)
        historical_payload["summary"].pop("hsbc_paste_import_scope", None)
        historical_payload["summary"].pop("hsbc_ending_cash_components", None)
        historical_payload["summary"].pop("hsbc_cash_component_post_dates", None)
        historical_payload["summary"]["historical_statement_backfill"] = True
        historical_payload["summary"]["ending_cash_by_currency"] = {
            "USD": "100.00",
            "HKD": "1046.10",
            "CNH": "12.00",
        }
        historical_payload["ending_cash_by_currency"] = {
            "USD": "100.00",
            "HKD": "1046.10",
            "CNH": "12.00",
        }

        merged = merge_investment_payloads(pasted_payload, historical_payload)

        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"],
            {
                "HKD:CURRENT": "1000.00",
                "HKD:SAVINGS": "46.10",
                "CNH:SAVINGS": "12.00",
                "USD:LEGACY": "100.00",
            },
        )
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"HKD": "1046.10", "CNH": "12.00", "USD": "100.00"},
        )

    def test_hsbc_cash_only_paste_rejects_an_invalid_supplementary_clip(self) -> None:
        cash_account_text = "\n===== HSBC PASTE CHUNK =====\n".join([
            self._synthetic_hsbc_non_usd_cash_paste(),
            "This is not an HSBC cash-account page.",
        ])

        with self.assertRaisesRegex(ValueError, r"HSBC cash chunk 2"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=cash_account_text,
            )

    def test_validate_hsbc_pasted_text_requires_the_usd_composite_but_accepts_cash_only(self) -> None:
        _, _, usd_cash_account_text = self._synthetic_hsbc_paste_snapshot()

        awaiting_usd_pages = validate_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=usd_cash_account_text,
        )
        cash_only = validate_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text=self._synthetic_hsbc_non_usd_cash_paste(),
        )

        self.assertFalse(awaiting_usd_pages["ready"])
        self.assertEqual(awaiting_usd_pages["mode"], "usd_composite")
        self.assertEqual(awaiting_usd_pages["field_status"], {
            "cash": True,
            "portfolio": False,
            "order_status": False,
        })
        self.assertEqual(awaiting_usd_pages["required_fields"], ["portfolio", "order_status"])
        self.assertTrue(cash_only["ready"])
        self.assertEqual(cash_only["mode"], "cash_only_non_usd")
        self.assertEqual(cash_only["cash_currencies"], ["CNH", "HKD"])

    def test_hsbc_pasted_snapshot_rejects_portfolio_older_than_executed_order(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot(
            portfolio_updated_date="13 Jul 2026",
        )

        with self.assertRaisesRegex(ValueError, "Portfolio market-data timestamp"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text=portfolio_text,
                order_status_text=order_status_text,
                cash_account_text=cash_account_text,
            )

    def test_hsbc_pasted_snapshot_rejects_cash_newer_than_order_status_range(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot(
            order_status_end_date="2026-07-14",
        )

        with self.assertRaisesRegex(ValueError, "USD Savings has postings through"):
            build_investment_payload_from_hsbc_pasted_text(
                portfolio_text=portfolio_text,
                order_status_text=order_status_text,
                cash_account_text=cash_account_text,
            )

    def test_hsbc_pasted_snapshot_marks_missing_boundaries_for_review(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot()
        portfolio_text = portfolio_text.replace(
            "Updated 17:15:00 on 14 Jul 2026 U.S. ET\n",
            "",
        )
        order_status_text = order_status_text.replace(
            "2026-04-01\n01 Apr 2026\n2026-07-15\n15 Jul 2026\n",
            "",
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        self.assertEqual(payload["summary"]["hsbc_snapshot"]["status"], "review")
        self.assertTrue(
            any(
                "could not be fully bounded" in warning
                for warning in payload["summary"]["warnings"]
            )
        )

    def test_hsbc_rolling_snapshot_accepts_pending_cash_and_calibrates_portfolio_price(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot(
            portfolio_updated_date="23 Jul 2026",
            order_status_end_date="2026-07-23",
        )
        portfolio_text = (
            portfolio_text
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("PortfolioMarket valueUSD 61.000", "PortfolioMarket valueUSD 317.690")
            .replace("61.000\n+0.000", "317.690\n+0.000")
            .replace("USD 61.000", "USD 318.920")
        )
        order_status_text = (
            order_status_text
            .replace(
                "2026-04-01\n01 Apr 2026\n2026-07-23\n15 Jul 2026\norder status",
                "You may check the status of orders within the last 17 calendar days.\norder status",
            )
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("14 Jul 2026 U.S. ET", "23 Jul 2026 U.S. ET")
            .replace("Sell", "Buy")
            .replace("61.000USD1", "319.000USD1")
            .replace("S-1", "P-900009")
        )
        cash_account_text = cash_account_text.replace("15 Jul 2026", "21 Jul 2026")

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        order = next(record for record in payload["transactions"] if record["ticker"] == "GOOGL")
        snapshot = payload["summary"]["hsbc_snapshot"]
        self.assertEqual(snapshot["status"], "validated")
        self.assertEqual(snapshot["order_status_coverage"]["mode"], "rolling_recent_window")
        self.assertEqual(snapshot["cash_posting_status"], "awaiting_settlement")
        self.assertEqual(snapshot["cash_posting_lag"]["pending_order_ids"], ["P-900009"])
        self.assertEqual(
            snapshot["execution_price_reconciliation"]["status"],
            "provisional_pending_settlement",
        )
        hsbc_summary = payload["broker_summaries"]["hsbc"]
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_order_count"], 1)
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_cash"], "-318.920")
        self.assertEqual(hsbc_summary["hsbc_broker_cash_estimate"], "-257.930")
        self.assertEqual(hsbc_summary["holdings_validation"]["matched"], True)
        self.assertEqual(order["price_raw"], "318.920")
        self.assertEqual(order["gross_amount_raw"], "-318.920")
        self.assertEqual(order["source"]["order_status_limit_price_raw"], "319.000")
        self.assertEqual(
            order["source"]["execution_price_source"],
            "hsbc_portfolio_average_purchase_price",
        )
        self.assertEqual(payload["summary"]["warnings"], [])

    def test_hsbc_pending_cash_summary_uses_signed_visible_order_amounts(self) -> None:
        pending_transactions = [
            {
                "broker": "hsbc",
                "net_amount_raw": "1431.250",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "net_amount_raw": "278.500",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "net_amount_raw": "-133.000",
                "source": {"cash_replay_pending_settlement": True},
            },
        ]

        summary = _summarize_hsbc_pending_settlement_cash(
            pending_transactions,
            Decimal("21109.06"),
        )

        self.assertEqual(summary["hsbc_pending_settlement_cash"], "1576.750")
        self.assertEqual(summary["hsbc_broker_cash_estimate"], "22685.810")

    def test_hsbc_pending_cash_summary_keeps_unposted_fee_unapplied(self) -> None:
        pending_transactions = [
            {
                "broker": "hsbc",
                "type": "sell",
                "net_amount_raw": "1431.250",
                "source": {
                    "cash_replay_pending_settlement": True,
                    "cash_replay_pending_settlement_fee_amount_raw": "0.020",
                },
            },
            {
                "broker": "hsbc",
                "type": "sell",
                "net_amount_raw": "278.500",
                "source": {"cash_replay_pending_settlement": True},
            },
            {
                "broker": "hsbc",
                "type": "buy",
                "net_amount_raw": "-133.000",
                "source": {"cash_replay_pending_settlement": True},
            },
        ]

        summary = _summarize_hsbc_pending_settlement_cash(
            pending_transactions,
            Decimal("21108.38"),
            broker_cash_balance=Decimal("21109.06"),
        )

        self.assertEqual(summary["hsbc_bank_available_cash"], "21108.38")
        self.assertEqual(summary["hsbc_pending_settlement_cash_raw"], "1576.750")
        self.assertEqual(summary["hsbc_pending_settlement_fee_adjustment"], "0.000")
        self.assertEqual(summary["hsbc_pending_settlement_fee_unapplied"], "0.020")
        self.assertEqual(
            summary["hsbc_pending_settlement_fee_policy"],
            "exclude_unposted_until_settled_cash_posting",
        )
        self.assertEqual(summary["hsbc_pending_settlement_cash"], "1576.750")
        self.assertEqual(summary["hsbc_broker_cash_estimate"], "22685.810")

    def test_hsbc_settled_cash_reconciles_provisional_execution_price(self) -> None:
        portfolio_text, order_status_text, cash_account_text = self._synthetic_hsbc_paste_snapshot(
            portfolio_updated_date="23 Jul 2026",
            order_status_end_date="2026-07-23",
        )
        portfolio_text = (
            portfolio_text
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("PortfolioMarket valueUSD 61.000", "PortfolioMarket valueUSD 317.690")
            .replace("61.000\n+0.000", "317.690\n+0.000")
            .replace("USD 61.000", "USD 318.920")
        )
        order_status_text = (
            order_status_text
            .replace(
                "2026-04-01\n01 Apr 2026\n2026-07-23\n15 Jul 2026\norder status",
                "You may check the status of orders within the last 17 calendar days.\norder status",
            )
            .replace("DRAM", "GOOGL")
            .replace("ROUNDHILL MEMORY", "ALPHABET INC-CL A")
            .replace("14 Jul 2026 U.S. ET", "23 Jul 2026 U.S. ET")
            .replace("Sell", "Buy")
            .replace("61.000USD1", "319.000USD1")
            .replace("S-1", "P-900009")
        )
        cash_account_text = cash_account_text.replace(
            "15 Jul 2026\nREF S900001001 SEC\n60.99\n60.99",
            "23 Jul 2026\nREF P900009001 SEC\n318.91\n60.99",
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        order = next(record for record in payload["transactions"] if record["ticker"] == "GOOGL")
        source = order["source"]
        self.assertEqual(order["price_raw"], "318.910")
        self.assertEqual(order["gross_amount_raw"], "-318.910")
        self.assertEqual(order["net_amount_raw"], "-318.91")
        self.assertEqual(source["execution_price_status"], "final_settled")
        self.assertEqual(source["execution_price_source"], "hsbc_cash_settlement_amount")
        self.assertEqual(source["execution_price_provisional_raw"], "318.920")
        self.assertEqual(source["execution_price_final_raw"], "318.910")
        self.assertEqual(source["execution_price_settlement_amount_raw"], "-318.91")
        self.assertEqual(source["execution_price_settlement_date"], "2026-07-23")
        self.assertEqual(
            payload["summary"]["hsbc_snapshot"]["execution_price_reconciliation"]["status"],
            "settled",
        )
        self.assertEqual(payload["summary"]["hsbc_final_settled_execution_count"], 1)
        self.assertEqual(payload["summary"]["warnings"], [])

    def test_hsbc_incremental_merge_preserves_dividend_ticker_and_repairs_status(self) -> None:
        existing_record = {
            "date": "2026-07-10",
            "datetime": "2026-07-10 20:00:00",
            "type": "dividend",
            "ticker": "SGOV",
            "currency": "USD",
            "description": "CORP EVT PAYMENT SEC",
            "broker": "hsbc",
            "account": "000-999999-999",
            "net_amount_raw": "21.29",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "balance_after_raw": "27357.71",
                "dividend_attribution_status": "unavailable_from_hsbc_cash_text",
                "dividend_attribution_method": "eligible_shares_and_local_dividend_action",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "deposit"
        incoming_record["ticker"] = ""
        incoming_record["source"] = {
            "file_kind": "hsbc_usd_account_text",
            "balance_after_raw": "27357.71",
            "dividend_attribution_status": "unavailable_from_hsbc_cash_text",
        }

        merged = merge_investment_payloads(
            {"broker": "hsbc", "account": "000-999999-999", "transactions": [existing_record]},
            {"broker": "hsbc", "account": "000-999999-999", "transactions": [incoming_record]},
        )
        dividend = merged["transactions"][0]
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(
            dividend["source"]["dividend_attribution_status"],
            "preserved_existing_ledger_attribution",
        )
        self.assertTrue(dividend["source"]["dividend_attribution_preserved_on_incremental_import"])
        self.assertTrue(
            dividend["source"]["dividend_classification_preserved_on_incremental_import"]
        )

    def test_hsbc_cross_source_merge_repairs_legacy_attributed_dividend_deposit(self) -> None:
        existing_record = {
            "date": "2026-07-10",
            "datetime": "2026-07-10 20:00:00",
            "type": "deposit",
            "ticker": "SGOV",
            "currency": "USD",
            "description": "CORP EVT PAYMENT SEC",
            "broker": "hsbc",
            "account": "000-999999-999",
            "gross_amount_raw": "21.29",
            "commission_raw": "0",
            "net_amount_raw": "21.29",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "balance_after_raw": "27357.71",
                "dividend_attribution_status": "preserved_existing_ledger_attribution",
                "dividend_attribution_method": "eligible_shares_and_local_dividend_action",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "dividend"
        incoming_record["ticker"] = ""
        incoming_record["source"] = {
            "file_kind": "hsbc_usd_savings_csv",
            "row_number": 43,
            "account_number": "000-999999-999",
            "balance_after_raw": "27357.71",
        }

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [existing_record],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [incoming_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        dividend = merged["transactions"][0]
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertTrue(
            dividend["source"]["dividend_classification_repaired_after_import"]
        )

    def test_hsbc_statement_bundle_identifies_each_pdf_once_and_pairs_automatically(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ) as mocked_extract:
            payload = build_investment_payload_from_hsbc_statement_bundle([
                (b"investment", "opaque-2.pdf"),
                (b"composite", "opaque-1.pdf"),
            ])

        self.assertEqual(mocked_extract.call_count, 2)
        self.assertEqual(payload["summary"]["statement_pair_count"], 1)
        self.assertEqual(payload["summary"]["composite_statement_count"], 1)
        self.assertEqual(payload["summary"]["investment_statement_count"], 1)
        self.assertEqual(len(payload["source_artifacts"]), 2)
        artifacts_by_role = {
            artifact["bundle_role"]: artifact
            for artifact in payload["source_artifacts"]
        }
        self.assertEqual(
            artifacts_by_role["composite_statement"]["sha256"],
            hashlib.sha256(b"composite").hexdigest(),
        )
        self.assertEqual(
            artifacts_by_role["investment_statement"]["sha256"],
            hashlib.sha256(b"investment").hexdigest(),
        )
        self.assertEqual(
            artifacts_by_role["composite_statement"]["related_sha256"],
            artifacts_by_role["investment_statement"]["sha256"],
        )
        dividend = next(record for record in payload["transactions"] if record["type"] == "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(
            dividend["source"]["source_file_sha256"],
            artifacts_by_role["investment_statement"]["sha256"],
        )

    def test_hsbc_statement_reimport_preserves_richer_same_source_classification(self) -> None:
        existing_record = {
            "date": "2024-07-26",
            "datetime": "2024-07-26 20:00:00",
            "type": "kol_reward",
            "ticker": "",
            "currency": "HKD",
            "description": "KOL Rewards · WISE PAYMENTS LTD REF00000000000000 26JUL · Longbridge",
            "gross_amount_raw": "3100.00",
            "commission_raw": "0",
            "net_amount_raw": "3100.00",
            "broker": "hsbc",
            "account": "000-999999-999",
            "source": {
                "file_kind": "hsbc_statement_cash",
                "source_format": "statement_pdf",
                "source_filename": "eStatementFile_428100.pdf",
                "row_number": 3,
                "ledger_sequence": 3,
                "account_number": "000-999999-999",
                "balance_after_raw": "3100.00",
                "reference_id": "WISE PAYMENTS LTD REF00000000000000 26JUL",
                "account_type": "HKD Savings",
                "statement_period": "2024-08",
            },
        }
        incoming_record = deepcopy(existing_record)
        incoming_record["type"] = "deposit"
        incoming_record["description"] = "WISE PAYMENTS LTD REF00000000000000 26JUL"
        incoming_record["source"]["source_file_sha256"] = "a" * 64

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [existing_record],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [incoming_record],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        self.assertEqual(merged["transactions"][0]["type"], "kol_reward")
        self.assertEqual(
            merged["transactions"][0]["source"]["source_file_sha256"],
            "a" * 64,
        )

    def test_hsbc_statement_settlement_rows_enrich_order_without_duplicate_cash(self) -> None:
        order = {
            "date": "2026-06-17",
            "datetime": "2026-06-17 20:00:00",
            "type": "sell",
            "ticker": "BOXX",
            "currency": "USD",
            "description": "Alpha Architect 1-3 Month Box ETF",
            "quantity_raw": "2",
            "quantity_abs": "2",
            "price_raw": "58.510",
            "gross_amount_raw": "117.020",
            "commission_raw": "-0.01",
            "net_amount_raw": "117.01",
            "broker": "hsbc",
            "account": "000-999999-999",
            "source": {
                "file_kind": "hsbc_order_status_text",
                "statement_order_id": "S-900005",
                "order_id": "S-900005",
                "cash_settlement_date": "2026-06-18",
                "cash_settlement_amount_raw": "117.01",
                "cash_settlement_balance_after_raw": "4360.53",
                "cash_settlement_source_row_number": 10,
                "cash_flow_fee_amount_raw": "0.01",
                "cash_flow_fee_row_numbers": [11],
            },
        }

        def statement_cash(
            amount: str,
            balance: str,
            row_number: int,
            transaction_type: str,
        ) -> dict[str, object]:
            return {
                "date": "2026-06-18",
                "datetime": "2026-06-18 20:00:00",
                "type": transaction_type,
                "ticker": "",
                "currency": "USD",
                "description": transaction_type.upper(),
                "gross_amount_raw": amount,
                "commission_raw": "0",
                "net_amount_raw": amount,
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_format": "statement_pdf",
                    "source_filename": "eStatementFile_106353.pdf",
                    "source_file_sha256": "b" * 64,
                    "row_number": row_number,
                    "ledger_sequence": row_number,
                    "account_number": "000-999999-999",
                    "balance_after_raw": balance,
                    "reference_id": transaction_type.upper(),
                    "account_type": "USD Savings",
                    "statement_period": "2026-07",
                },
            }

        merged = merge_investment_payloads(
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {},
                "transactions": [order],
            },
            {
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {"historical_statement_backfill": True},
                "transactions": [
                    statement_cash("117.01", "4360.54", 20, "deposit"),
                    statement_cash("-0.01", "4360.53", 21, "withdrawal"),
                ],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        postings = merged["transactions"][0]["source"]["cash_settlement_postings"]
        self.assertEqual([posting["role"] for posting in postings], ["principal", "fee"])
        self.assertTrue(
            all(posting["statement_pdf_source_sha256"] == "b" * 64 for posting in postings)
        )
        incremental = merged["summary"]["incremental_import"]
        self.assertEqual(
            incremental["enriched_hsbc_statement_settlement_posting_count"],
            2,
        )
        self.assertEqual(incremental["added_record_count"], 0)

    def test_hsbc_order_settlement_balance_uses_last_chronological_posting(self) -> None:
        payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [{
                "date": "2026-07-16",
                "datetime": "2026-07-16 20:00:00",
                "type": "sell",
                "ticker": "EUV",
                "currency": "USD",
                "description": "EUV",
                "quantity_raw": "5",
                "quantity_abs": "5",
                "price_raw": "54.00",
                "gross_amount_raw": "270.00",
                "commission_raw": "-0.01",
                "net_amount_raw": "269.99",
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": "S-645804",
                    "cash_settlement_amount_raw": "269.99",
                    "cash_settlement_balance_after_raw": "25236.79",
                    "cash_settlement_postings": [
                        {
                            "date": "2026-07-16",
                            "amount_raw": "-0.01",
                            "balance_after_raw": "25236.79",
                            "row_number": 40,
                            "ledger_sequence": 40,
                            "role": "fee",
                        },
                        {
                            "date": "2026-07-16",
                            "amount_raw": "269.99",
                            "balance_after_raw": "25506.78",
                            "row_number": 41,
                            "ledger_sequence": 41,
                            "role": "principal",
                        },
                    ],
                },
            }],
        }

        repaired, updated_count = repair_hsbc_order_settlement_reconciliation(payload)
        order = repaired["transactions"][0]

        self.assertEqual(updated_count, 1)
        self.assertEqual(
            order["source"]["cash_settlement_balance_after_raw"],
            "25506.78",
        )
        self.assertEqual(
            order["source"]["cash_settlement_source_row_number"],
            41,
        )

    def test_hsbc_repair_preserves_verified_current_cash_boundary_separately(self) -> None:
        payload = {
            "broker": "multiple",
            "account": "multiple",
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
                "hsbc_ending_cash_components": {
                    "USD:SAVINGS": "21108.38",
                    "HKD:SAVINGS": "89.24",
                },
                "hsbc_cash_component_post_dates": {
                    "USD:SAVINGS": "2026-08-07",
                },
            },
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "ending_cash": "21108.38",
                    "ending_cash_base_currency": "21109.06",
                    "ending_cash_base_currency_status": "authoritative_effective_boundary",
                    "hsbc_snapshot": {
                        "cash_latest_post_date": "2026-08-13",
                    },
                },
            },
            "transactions": [],
        }

        repaired, _updated_count = repair_hsbc_order_settlement_reconciliation(payload)
        summary = repaired["summary"]
        hsbc_summary = repaired["broker_summaries"]["hsbc"]

        self.assertEqual(summary["hsbc_ending_cash_components"]["USD:SAVINGS"], "21109.06")
        self.assertEqual(summary["hsbc_cash_component_post_dates"]["USD:SAVINGS"], "2026-08-13")
        self.assertEqual(summary["hsbc_bank_available_cash"], "21109.06")
        self.assertEqual(hsbc_summary["ending_cash"], "21109.06")
        self.assertEqual(hsbc_summary["ending_cash_by_currency"]["HKD"], "89.24")

    def test_hsbc_official_usd_csv_repairs_conflicting_page_balance(self) -> None:
        order_payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [{
                "date": "2026-08-04",
                "datetime": "2026-08-04 20:00:00",
                "type": "buy",
                "ticker": "EUV",
                "currency": "USD",
                "description": "EUV",
                "quantity_raw": "1",
                "quantity_abs": "1",
                "price_raw": "22.50",
                "gross_amount_raw": "-22.50",
                "commission_raw": "0",
                "net_amount_raw": "-22.50",
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": "P-024880",
                    "cash_settlement_amount_raw": "-22.50",
                    "cash_settlement_balance_after_raw": "20444.97",
                    "cash_settlement_postings": [{
                        "date": "2026-08-04",
                        "amount_raw": "-22.50",
                        "balance_after_raw": "20444.97",
                        "row_number": 35,
                        "ledger_sequence": 35,
                        "role": "principal",
                    }],
                },
            }],
        }
        csv_text = "\n".join([
            "Date,Description,Billing amount,Billing currency,Balance,Balance currency",
            "04/08/2026,REF P922735121 SEC,-22.50,USD,20545.39,USD",
            "03/08/2026,9285883 R00460,100.00,USD,20567.89,USD",
        ])
        csv_payload = build_investment_payload_from_hsbc_usd_savings_csv(
            csv_text.encode("utf-8"),
            filename="TransactionHistoryUSDSavings.csv",
        )

        merged = merge_investment_payloads(order_payload, csv_payload)
        order = next(
            transaction
            for transaction in merged["transactions"]
            if transaction.get("source", {}).get("statement_order_id") == "P-024880"
        )

        self.assertEqual(
            order["source"]["cash_settlement_balance_after_raw"],
            "20545.39",
        )
        self.assertEqual(
            order["source"]["cash_settlement_authoritative_source"],
            "hsbc_usd_savings_transaction_history_csv",
        )
        self.assertEqual(
            order["source"]["cash_settlement_postings"][0]["source_file_kind"],
            "hsbc_usd_savings_csv",
        )

    def test_hsbc_settlement_reconciliation_uses_mill_price_precision(self) -> None:
        payload = {
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [{
                "date": "2026-06-25",
                "datetime": "2026-06-25 20:00:00",
                "type": "sell",
                "ticker": "RAM",
                "currency": "USD",
                "quantity_raw": "3",
                "quantity_abs": "3",
                "price_raw": "45",
                "gross_amount_raw": "135",
                "commission_raw": "-0.01",
                "net_amount_raw": "135.89",
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "statement_order_id": "S-900006",
                    "cash_settlement_date": "2026-06-26",
                    "cash_settlement_amount_raw": "135.89",
                },
            }],
        }

        normalize_investment_payload_tickers(payload)
        order = payload["transactions"][0]

        self.assertEqual(order["price_raw"], "45.300")
        self.assertEqual(order["gross_amount_raw"], "135.900")
        self.assertNotIn("settlement_adjustment_raw", order)

    def test_hsbc_statement_batches_reject_unmatched_periods(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()
        august_investment_text = investment_text.replace("10JUL2026", "10AUG2026").replace(
            "11JUN2026", "11JUL2026"
        )

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            if pdf_bytes == b"composite":
                return composite_text
            if pdf_bytes == b"investment-july":
                return investment_text
            return august_investment_text

        with patch("app.services.investment_import._extract_statement_pdf_text", side_effect=extract_text):
            with self.assertRaisesRegex(ValueError, "missing composite statement for 2026-08-10"):
                build_investment_payload_from_hsbc_statement_pairs(
                    composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                    investment_statement_payloads=[
                        (b"investment-july", "investment-july.pdf"),
                        (b"investment-august", "investment-august.pdf"),
                    ],
                )

    def test_hsbc_live_paste_snapshot_wins_over_historical_statement_backfill(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch("app.services.investment_import._extract_statement_pdf_text", side_effect=extract_text):
            historical = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )
        live = deepcopy(historical)
        live["summary"].pop("historical_statement_backfill", None)
        live["position_snapshot"]["SGOV"]["as_of"] = "2026-07-11"
        live["ending_cash"] = "900.00"
        live["summary"]["ending_cash_raw"] = "900.00"
        live["position_snapshot"]["SGOV"]["quantity"] = "2"
        live["broker_summaries"]["hsbc"]["position_snapshot_as_of"] = "2026-07-11"
        live["broker_summaries"]["hsbc"]["ending_cash"] = "900.00"
        live["broker_summaries"]["hsbc"]["ending_cash_raw"] = "900.00"
        live_dividend = next(record for record in live["transactions"] if record["type"] == "dividend")
        live_dividend["description"] = "CORP EVT PAYMENT SEC"
        live_dividend["source"].pop("corporate_action_reference", None)
        live_dividend["source"]["dividend_attribution_status"] = "matched_local_market_action"

        merged = merge_investment_payloads(live, historical)

        dividends = [record for record in merged["transactions"] if record["type"] == "dividend"]
        self.assertEqual(len(dividends), 1)
        self.assertEqual(dividends[0]["source"]["corporate_action_reference"], "CORTMP890672010")
        self.assertEqual(merged["ending_cash"], "900.00")
        self.assertEqual(merged["position_snapshot"]["SGOV"]["quantity"], "2")

    def test_hsbc_later_statement_snapshot_advances_older_live_snapshot(self) -> None:
        composite_text, investment_text = self._synthetic_hsbc_statement_texts()

        def extract_text(pdf_bytes: bytes, _broker_label: str) -> str:
            return composite_text if pdf_bytes == b"composite" else investment_text

        with patch(
            "app.services.investment_import._extract_statement_pdf_text",
            side_effect=extract_text,
        ):
            historical = build_investment_payload_from_hsbc_statement_pairs(
                composite_statement_payloads=[(b"composite", "composite-july.pdf")],
                investment_statement_payloads=[(b"investment", "investment-july.pdf")],
            )

        live = deepcopy(historical)
        live["summary"].pop("historical_statement_backfill", None)
        live["broker_summaries"]["hsbc"].pop(
            "historical_statement_backfill",
            None,
        )
        live["source_artifacts"] = []
        live["broker_snapshots"] = {}
        live["position_snapshot"]["SGOV"]["as_of"] = "2026-07-09"
        live["position_snapshot"]["SGOV"]["quantity"] = "2"
        live["ending_cash"] = "900.00"
        live["summary"]["ending_cash_raw"] = "900.00"
        live["broker_summaries"]["hsbc"]["position_snapshot_as_of"] = "2026-07-09"
        live["broker_summaries"]["hsbc"]["ending_cash"] = "900.00"
        live["broker_summaries"]["hsbc"]["ending_cash_raw"] = "900.00"
        for summary in (live["summary"], live["broker_summaries"]["hsbc"]):
            summary["hsbc_ending_cash_components"] = {
                "USD:FOREIGN CURRENCY SAVINGS USD": "0.00",
                "USD:SAVINGS": "900.00",
            }
            summary["hsbc_cash_component_post_dates"] = {
                "USD:FOREIGN CURRENCY SAVINGS USD": "2023-03-07",
                "USD:SAVINGS": "2026-07-09",
            }

        merged = merge_investment_payloads(live, historical)

        self.assertEqual(merged["ending_cash"], "921.29")
        self.assertEqual(merged["position_snapshot"]["SGOV"]["quantity"], "5")
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["ending_cash_by_currency"]["USD"],
            "921.29",
        )

    def test_hsbc_corporate_event_payment_is_attributed_to_unique_sgov_dividend(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 8,040.000",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "SGOV",
            "ISHARES 0-3 MONTH TRS BD",
            "100.500",
            "+0.020",
            "+0.02%80USD 8,040.000",
            "-6.360",
            "Unrealised gain / loss-6.360",
            "-0.08%",
            "USD 100.5795",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "SGOV",
            "ISHARES 0-3 MONTH TRS BD",
            "30 Jun 2026 U.S. ET",
            "Fully Executed",
            "Buy",
            "Limit Price Order",
            "100.680USD80",
            "Quantity",
            "Executed quantity80 share(s)",
            "Outstanding quantity0 share(s)",
            "P-900007",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "1,021.29",
            "USD",
            "Available balance:",
            "1,021.29 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "10 Jul 2026",
            "CORP EVT PAYMENT SEC",
            "21.29",
            "1,021.29",
            "09 Jul 2026",
            "USD CLEARING CHEQUE",
            "1,000.00",
            "1,000.00",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
            dividend_action_loader=lambda tickers: {
                "SGOV": [{
                    "date": "2026-07-01",
                    "dividend_per_share": "0.295765",
                }]
            },
        )

        dividend = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        )
        self.assertEqual(dividend["type"], "dividend")
        self.assertEqual(dividend["ticker"], "SGOV")
        self.assertEqual(dividend["net_amount_raw"], "21.29")
        self.assertEqual(
            dividend["source"]["dividend_attribution_status"],
            "matched_local_market_action",
        )
        self.assertEqual(dividend["source"]["dividend_eligible_quantity_raw"], "80")
        self.assertEqual(dividend["source"]["dividend_inferred_net_retention_rate"], "0.90")
        sgov_buy = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["type"] == "buy" and transaction["ticker"] == "SGOV"
        )
        self.assertFalse(sgov_buy["source"].get("cash_replay_pending_settlement", False))
        self.assertEqual(
            sgov_buy["source"]["cash_settlement_match_status"],
            "outside_visible_cash_window",
        )

        legacy_payload = deepcopy(payload)
        legacy_dividend = next(
            transaction
            for transaction in legacy_payload["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        )
        legacy_dividend["type"] = "deposit"
        legacy_dividend["ticker"] = ""
        legacy_dividend["source"] = {
            key: value
            for key, value in legacy_dividend["source"].items()
            if not key.startswith("dividend_")
        }
        merged = merge_investment_payloads(legacy_payload, payload)
        merged_corporate_events = [
            transaction
            for transaction in merged["transactions"]
            if transaction["description"] == "CORP EVT PAYMENT SEC"
        ]
        self.assertEqual(len(merged_corporate_events), 1)
        self.assertEqual(merged_corporate_events[0]["type"], "dividend")
        self.assertEqual(merged_corporate_events[0]["ticker"], "SGOV")

    def test_hsbc_unmatched_corporate_event_remains_unattributed_dividend(self) -> None:
        warnings: list[str] = []
        _, _, _, records = _build_hsbc_cash_account_records_from_text(
            "\n".join([
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "21.29",
                "USD",
                "Available balance:",
                "21.29 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "10 Jul 2026",
                "CORP EVT PAYMENT SEC",
                "21.29",
                "21.29",
                "Download",
            ]),
            warnings=warnings,
        )

        self.assertEqual(records[0]["type"], "dividend")
        self.assertEqual(records[0]["ticker"], "")

    def test_tigertrade_funds_in_transit_preserve_equity(self) -> None:
        records = _tigertrade_simple_cash_rows(
            "\n".join([
                "2025-01-07  Fund Subscription  -1,500.00  USD",
                "2025-01-08  Fund Subscription Returned  1,500.00  USD",
            ]),
            account="4556114",
            source_filename="statement.pdf",
            transaction_type_for_description={
                "Fund Subscription": "adjustment",
                "Fund Subscription Returned": "adjustment",
            },
            source_section="Funds in Transit",
        )

        self.assertEqual(len(records), 2)
        self.assertEqual(
            [record["normalized"]["net_amount"] for record in records],
            ["0", "0"],
        )
        self.assertTrue(all(
            record["normalized"]["cash_equivalent_transfer"]
            for record in records
        ))
        self.assertTrue(all(
            record["source"]["cash_equivalent_transfer"]
            for record in records
        ))

    def test_import_canonicalizes_share_class_ticker_to_hyphen(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,478.50",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-04-01,U***TEST,BERKSHIRE HATHAWAY INC-CL B,Buy,BRK B,1,478.50,USD,-478.50,-0.35,-478.85",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Stocks,BRK B,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Data,Summary,Stocks,USD,BRK B,,1,1,478.50,478.50,478.50,478.50,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["ticker"], "BRK-B")
        self.assertIn("BRK-B", payload["position_snapshot"])
        self.assertIn("BRK-B", payload["performance_snapshot"])

    def test_ibkr_closed_dram_trades_preserve_exact_broker_realized_pnl(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,January 1, 2026 - July 29, 2026",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,0",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-06-11,U***00001,DRAM sell,Sell,DRAM,-15,61,USD,915,-0.35107625,914.64892375",
            "Transaction History,Data,2026-07-21,U***00001,DRAM sell,Sell,DRAM,-15,57,USD,855,-0.34984025,854.65015975",
            "Transaction History,Data,2026-07-23,U***00001,DRAM sell,Sell,DRAM,-5,59.25,USD,296.25,-0.35035,295.89965",
            "Transaction History,Data,2026-07-23,U***00001,DRAM sell,Sell,DRAM,-5,59,USD,295,-0.35032425,294.64967575",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,January 1, 2026 - July 29, 2026",
            "Account Information,Header,Field Name,Field Value",
            "Account Information,Data,Account,U00000001",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Stocks,DRAM,0,408.95204025,0,0,0,408.95204025,0,0,0,0,0,408.95204025,",
            "Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code",
            'Trades,Data,Order,Stocks,USD,DRAM,"2026-06-11, 12:00:00",-15,61,915,-0.35107625,-689.948866,224.700059,C',
            'Trades,Data,Order,Stocks,USD,DRAM,"2026-07-21, 12:00:00",-15,57,855,-0.34984025,-770.58521675,84.064943,C',
            'Trades,Data,Order,Stocks,USD,DRAM,"2026-07-23, 12:00:00",-5,59.25,296.25,-0.35035,-245.181143,50.718507,C',
            'Trades,Data,Order,Stocks,USD,DRAM,"2026-07-23, 12:01:00",-5,59,295,-0.35032425,-245.181143,49.468532,C',
            "Trades,SubTotal,,Stocks,USD,DRAM,,295,,-16159.125,-30.838397728,16598.915438978,408.952041,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(
            payload["performance_snapshot"]["DRAM"]["realized_total"],
            "408.952041",
        )
        self.assertEqual(
            payload["performance_snapshot"]["DRAM"]["realized_total_source"],
            "ibkr_closed_trades",
        )
        dram_sells = [
            record for record in payload["transactions"]
            if record.get("ticker") == "DRAM" and record.get("type") == "sell"
        ]
        self.assertEqual(
            sorted(record["broker_realized_pnl_raw"] for record in dram_sells),
            sorted(["224.700059", "84.064943", "50.718507", "49.468532"]),
        )
        self.assertEqual(
            sum(Decimal(record["broker_realized_pnl_raw"]) for record in dram_sells),
            Decimal("408.952041"),
        )
        self.assertEqual(
            len({record["source"]["closed_lot_id"] for record in dram_sells}),
            4,
        )

    def test_same_dram_trade_shape_at_two_brokers_is_not_deduplicated(self) -> None:
        def payload_for(broker: str, account: str) -> dict[str, object]:
            return {
                "schema_version": "3.0.0",
                "broker": broker,
                "account": account,
                "summary": {},
                "transactions": [{
                    "broker": broker,
                    "account": account,
                    "date": "2026-07-21",
                    "datetime": "2026-07-21 12:00:00",
                    "type": "sell",
                    "ticker": "DRAM",
                    "currency": "USD",
                    "quantity_raw": "-15",
                    "quantity_abs": "15",
                    "price_raw": "57",
                    "gross_amount_raw": "855",
                    "commission_raw": "-0.35",
                    "net_amount_raw": "854.65",
                    "source": {"broker": broker, "account": account},
                }],
            }

        merged = merge_investment_payloads(
            payload_for("ibkr", "U00000001"),
            payload_for("hsbc", "000-999999-999"),
        )
        dram_sells = [
            record for record in merged["transactions"]
            if record.get("ticker") == "DRAM" and record.get("type") == "sell"
        ]
        self.assertEqual(len(dram_sells), 2)
        self.assertEqual({record["broker"] for record in dram_sells}, {"ibkr", "hsbc"})

    def test_ibkr_realized_summary_security_transfer_creates_a_non_cash_outflow(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,July 1, 2026 - July 31, 2026",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,0",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-07-30,U***00001,FX Translations P&L,Adjustment,-,-,-,-,0,-,0",
        ]) + "\n"
        realized_summary_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,July 1, 2026 - July 31, 2026",
            "Account Information,Header,Field Name,Field Value",
            "Account Information,Data,Account,U00000001",
            "Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code",
            "Transfers,Data,Stocks,USD,QQQI,2026-07-31,FOP,Out,--,00000002,-5,--,-263.40,0.00,0.00,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            realized_summary_csv.encode("utf-8"),
            transaction_filename="U00000001.TRANSACTIONS.YTD.csv",
            positions_filename="U00000001_20260101_20260731.csv",
        )

        transfer = next(record for record in payload["transactions"] if record["type"] == "transfer_out")
        self.assertEqual(transfer["type"], "transfer_out")
        self.assertEqual(transfer["ticker"], "QQQI")
        self.assertEqual(transfer["quantity_raw"], "5")
        self.assertEqual(transfer["net_amount_raw"], "0")
        self.assertFalse(transfer["normalized"]["is_cash_flow"])
        self.assertEqual(transfer["source"]["transfer_direction"], "out")
        self.assertEqual(
            {artifact["bundle_role"] for artifact in payload["source_artifacts"]},
            {"transaction_history", "realized_summary"},
        )

    def test_ibkr_security_transfer_with_cash_consideration_fails_closed(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,July 1, 2026 - July 31, 2026",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,0",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-07-30,U***00001,FX Translations P&L,Adjustment,-,-,-,-,0,-,0",
        ]) + "\n"
        realized_summary_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,July 1, 2026 - July 31, 2026",
            "Account Information,Header,Field Name,Field Value",
            "Account Information,Data,Account,U00000001",
            "Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code",
            "Transfers,Data,Stocks,USD,QQQI,2026-07-31,FOP,Out,--,00000002,-5,--,-263.40,0.00,0.01,",
        ]) + "\n"

        with self.assertRaisesRegex(ValueError, "non-zero cash consideration"):
            build_investment_payload_from_ibkr_csvs(
                transactions_csv.encode("utf-8"),
                realized_summary_csv.encode("utf-8"),
            )

    def test_schwab_transfer_bundle_parses_in_kind_receipt_and_positions_snapshot(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"07/31/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
            '"07/31/2026 as of 07/30/2026","MoneyLink Transfer","","Tfr COLUMN NATIONAL AS","","","","$0.41"',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...001 as of 12:11 AM ET, 2026/08/01"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
            '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","53.04","0.36","0.68%","$265.20","$1.80","0.68%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
            '"Positions Total","--","--","--","--","--","$265.61","$0.00","0%","$0.00","--","--","--","--","",',
        ]) + "\n"

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260801-001049.csv",
            positions_filename="Individual-Positions-2438-56-45-021633.csv",
        )

        transfer = next(record for record in payload["transactions"] if record["type"] == "transfer_in")
        self.assertEqual(transfer["ticker"], "QQQI")
        self.assertEqual(transfer["quantity_raw"], "5")
        self.assertEqual(transfer["net_amount_raw"], "0")
        self.assertFalse(transfer["normalized"]["is_cash_flow"])
        self.assertEqual(payload["account"], "Individual ...001")
        self.assertEqual(payload["ending_cash"], "0.41")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "5")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["value"], "265.20")
        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])
        self.assertEqual(
            {artifact["bundle_role"] for artifact in payload["source_artifacts"]},
            {"transactions", "positions"},
        )

    def test_schwab_known_internal_transfer_cleanup_rows_are_not_imported(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"08/02/2026","Security Transfer","QQQI","Prior QQQI receipt","5","","",""',
            '"08/03/2026","Security Transfer","DRAM","DRAM receipt","195","","",""',
            '"08/03/2026","Security Transfer","QQQI","QQQI receipt","10","","",""',
            '"08/03/2026","Journal","QQQI","Visible QQQI journal","-5","","",""',
            '"08/03/2026","Journal","QQQI","Visible QQQI journal","5","","",""',
            '"08/04/2026","Journal","DRAM","DRAM cleanup","-195","","",""',
            '"08/04/2026","Journal","DRAM","DRAM cleanup","195","","",""',
            '"08/04/2026","Journal","QQQI","QQQI cleanup","-10","","",""',
            '"08/04/2026","Journal","QQQI","QQQI cleanup","10","","",""',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...001 as of 05:15 AM ET, 2026/08/04"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
            '"DRAM","DRAM ETF","195","51.75","$10,091.25","Incomplete","ETFs & Closed End Funds",',
            '"QQQI","QQQI ETF","15","54.06","$810.90","Incomplete","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
            '"Positions Total","--","--","--","$10,902.56","--","",',
        ]) + "\n"

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260804.csv",
            positions_filename="Individual-Positions-2026-08-04.csv",
        )

        self.assertEqual(payload["summary"]["schwab_suppressed_internal_transfer_count"], 6)
        self.assertEqual(len(payload["summary"]["schwab_suppressed_internal_transfer_rows"]), 6)
        self.assertEqual(
            [
                (record["date"], record["type"], record.get("ticker"), record.get("quantity_raw"))
                for record in payload["transactions"]
            ],
            [
                ("2026-08-02", "transfer_in", "QQQI", "5"),
                ("2026-08-03", "transfer_in", "DRAM", "195"),
                ("2026-08-03", "transfer_in", "QQQI", "10"),
            ],
        )
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])

    def test_schwab_later_paired_journal_cleanup_rows_are_not_imported(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","-5","","",""',
            '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
            '"08/13/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","-35","","",""',
            '"08/13/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","35","","",""',
            '"08/12/2026","Security Transfer","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
            '"08/12/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","35","","",""',
            '"08/04/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","-195","","",""',
            '"08/04/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","195","","",""',
            '"08/04/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","-10","","",""',
            '"08/04/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","10","","",""',
            '"08/03/2026","Security Transfer","DRAM","ROUNDHILL MEMORY ETF","195","","",""',
            '"08/03/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","10","","",""',
            '"08/03/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","-5","","",""',
            '"08/03/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
            '"07/31/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
            '"07/31/2026 as of 07/30/2026","MoneyLink Transfer","","Tfr COLUMN NATIONAL AS","","","","$0.41"',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...103 as of 07:32 AM ET, 2026/08/15"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
            '"DRAM","ROUNDHILL MEMORY ETF","200","57.32","$11,464.00","$11,846.07","ETFs & Closed End Funds",',
            '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","50","55.79","$2,789.50","$2,862.89","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
            '"Positions Total","--","--","--","$14,253.91","$14,708.96","",',
        ]) + "\n"

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX471_Transactions_00994307-711224.csv",
            positions_filename="Individual-Positions-0914-95-53-412323.csv",
        )

        self.assertEqual(payload["account"], "Individual ...103")
        self.assertEqual(payload["summary"]["schwab_suppressed_internal_transfer_count"], 10)
        self.assertEqual(len(payload["summary"]["schwab_suppressed_internal_transfer_rows"]), 10)
        self.assertEqual(len(payload["transactions"]), 6)
        self.assertEqual(
            {record["type"] for record in payload["transactions"]},
            {"deposit", "transfer_in"},
        )
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "200")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "50")

    def test_schwab_reimport_removes_stale_paired_journal_rows(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","-5","","",""',
            '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
            '"08/12/2026","Security Transfer","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...103 as of 07:32 AM ET, 2026/08/15"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
            '"DRAM","ROUNDHILL MEMORY ETF","5","57.32","$286.60","$296.15","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
            '"Positions Total","--","--","--","$287.01","$296.15","",',
        ]) + "\n"
        incoming = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX471_Transactions_00994307-711224.csv",
            positions_filename="Individual-Positions-0914-95-53-412323.csv",
        )
        stale_rows = []
        for row in incoming["summary"]["schwab_suppressed_internal_transfer_rows"]:
            stale_rows.append({
                "broker": "schwab",
                "account": "Individual ...103",
                "date": row["date"],
                "datetime": f'{row["date"]} 23:00:00',
                "type": "adjustment",
                "ticker": row["ticker"],
                "currency": "USD",
                "quantity_raw": row["quantity"],
                "quantity_abs": row["quantity"].lstrip("-"),
                "source": {
                    "broker": "schwab",
                    "account": "Individual ...103",
                    "action_raw": row["action"],
                },
            })
        existing = deepcopy(incoming)
        existing["transactions"] = [*incoming["transactions"], *stale_rows]
        existing["summary"]["schwab_suppressed_internal_transfer_rows"] = (
            incoming["summary"]["schwab_suppressed_internal_transfer_rows"][:2]
        )
        merged = merge_investment_payloads(existing, incoming)

        self.assertFalse(
            any(
                record.get("broker") == "schwab"
                and record.get("type") == "adjustment"
                for record in merged["transactions"]
            )
        )
        self.assertEqual(
            merged["summary"]["schwab_suppressed_internal_transfer_count"],
            2,
        )

    def test_schwab_multi_lot_positions_reconcile_to_total_without_losing_lots(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"07/31/2026","Security Transfer","QQQI","QQQI transfer receipt","5","","",""',
            '"08/03/2026","Security Transfer","DRAM","DRAM transfer receipt","195","","",""',
            '"08/03/2026","Security Transfer","QQQI","QQQI transfer receipt","10","","",""',
            '"08/03/2026","Journal","QQQI","Internal journal","-5","","",""',
            '"08/03/2026","Journal","QQQI","Internal journal","5","","",""',
            '"08/03/2026 as of 07/30/2026","MoneyLink Transfer","","Cash transfer","","","","$0.41"',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...002 as of 09:17 PM ET, 2026/08/03"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
            '"DRAM","DRAM ETF","195","51.9993","0","0%","$10,139.86","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
            '"QQQI","QQQI ETF","10","53.89","0","0%","$538.90","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
            '"QQQI","QQQI ETF","5","53.89","0","0%","$269.45","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
            '"Positions Total","--","--","--","--","--","$10,948.62","$0.00","0%","$0.00","--","--","--","--","",',
        ]) + "\n"

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX002_Transactions_20260803-211710.csv",
            positions_filename="Individual-Positions-4089-06-00-151201.csv",
        )

        self.assertEqual(
            {record["type"] for record in payload["transactions"]},
            {"deposit", "transfer_in"},
        )
        self.assertEqual(payload["summary"]["schwab_suppressed_internal_transfer_count"], 2)
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "195")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "15")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["value"], "808.35")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["source_lot_count"], "2")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["cost_basis"], "")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["cost_basis_status"], "unknown")
        self.assertEqual(payload["ending_cash"], "0.41")
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])
        self.assertEqual(
            payload["summary"]["schwab_positions_validation"]["status"],
            "matched",
        )
        self.assertEqual(
            payload["summary"]["schwab_positions_validation"]["reported_total"],
            "10948.62",
        )
        self.assertEqual(
            payload["summary"]["schwab_positions_validation"]["lot_counts"],
            {"DRAM": 1, "QQQI": 2},
        )

        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U***001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "source_artifacts": [],
            "transactions": [{
                "date": "2026-07-31",
                "datetime": "2026-07-31 23:00:00",
                "type": "transfer_out",
                "ticker": "QQQI",
                "currency": "USD",
                "quantity_raw": "5",
                "quantity_abs": "5",
                "gross_amount_raw": "0",
                "net_amount_raw": "0",
                "description": "QQQI transfer out",
                "broker": "ibkr",
                "account": "U***001",
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
            }],
        }
        merged = merge_investment_payloads(existing_payload, payload)
        reconciliation = merged["summary"]["security_transfer_reconciliation"]
        self.assertEqual(reconciliation["matched_count"], 0)
        self.assertEqual(reconciliation["automatic_match_count"], 0)
        self.assertEqual(reconciliation["unreconciled_inbound_count"], 3)
        self.assertFalse(reconciliation["aggregate_history_complete"])
        self.assertFalse(reconciliation["aggregate_holdings_available"])
        self.assertEqual(
            {
                (item["ticker"], item["quantity"], item["status"])
                for item in reconciliation["unreconciled_inbounds"]
            },
            {
                ("QQQI", "5", "source_record_missing"),
                ("DRAM", "195", "source_record_missing"),
                ("QQQI", "10", "source_record_missing"),
            },
        )
        self.assertEqual(
            sum(record["type"] == "transfer_out" for record in merged["transactions"]),
            1,
        )
        binding_index = build_investment_internal_transfer_binding_index(
            merged["transactions"]
        )
        source_key = next(
            key
            for key, records in binding_index.items()
            if records == [
                next(
                    record
                    for record in merged["transactions"]
                    if record["type"] == "transfer_out"
                )
            ]
        )
        qqqi_five_receipt_key = next(
            key
            for key, records in binding_index.items()
            if records == [
                next(
                    record
                    for record in merged["transactions"]
                    if (
                        record["type"] == "transfer_in"
                        and record["ticker"] == "QQQI"
                        and record["quantity_raw"] == "5"
                    )
                )
            ]
        )
        merged["manual_internal_transfer_bindings"] = {
            source_key: qqqi_five_receipt_key,
        }
        refresh_investment_security_transfer_reconciliation(merged)
        confirmed_reconciliation = merged["summary"]["security_transfer_reconciliation"]
        self.assertEqual(confirmed_reconciliation["manual_match_count"], 1)
        self.assertEqual(confirmed_reconciliation["automatic_match_count"], 0)
        self.assertEqual(confirmed_reconciliation["unreconciled_inbound_count"], 2)
        self.assertFalse(confirmed_reconciliation["aggregate_holdings_available"])

    def test_schwab_current_export_bundle_accepts_incomplete_cost_basis(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"08/04/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","-195","","",""',
            '"08/04/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","195","","",""',
            '"08/04/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","-10","","",""',
            '"08/04/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","10","","",""',
            '"08/03/2026","Security Transfer","DRAM","ROUNDHILL MEMORY ETF","195","","",""',
            '"08/03/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","10","","",""',
            '"08/03/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","-5","","",""',
            '"08/03/2026","Journal","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
            '"07/31/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
            '"07/31/2026 as of 07/30/2026","MoneyLink Transfer","","Tfr SYNTHETIC BANK TRANSFER","","","","$0.41"',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...001 as of 05:15 AM ET, 2026/08/04"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
            '"DRAM","ROUNDHILL MEMORY ETF","195","51.75","0.62","1.21%","$10,091.25","$120.90","1.21%","Incomplete","N/A","N/A","No","N/A","ETFs & Closed End Funds",',
            '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","15","54.06","0.22","0.41%","$810.90","$3.30","0.41%","Incomplete","N/A","N/A","No","N/A","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
            '"Positions Total","","--","--","--","--","$10,902.56","$124.20","1.14%","$0.00","$0.00","0%","--","--","--",',
        ]) + "\n"

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260804-051528.csv",
            positions_filename="Individual-Positions-5024-93-07-989933.csv",
        )

        self.assertEqual(payload["account"], "Individual ...001")
        self.assertEqual(len(payload["transactions"]), 4)
        self.assertEqual(payload["summary"]["schwab_suppressed_internal_transfer_count"], 6)
        self.assertEqual(payload["ending_cash"], "0.41")
        self.assertEqual(payload["summary"]["warnings"], [])
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "195")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "15")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["cost_basis_status"], "unknown")
        self.assertEqual(
            payload["summary"]["schwab_positions_validation"]["reported_total"],
            "10902.56",
        )

    def test_schwab_transfer_receipts_remain_visible_and_bind_to_source_legs(self) -> None:
        def transfer_record(
            broker: str,
            account: str,
            transaction_type: str,
            ticker: str,
            quantity: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": "2026-08-03",
                "datetime": "2026-08-03 20:00:00",
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": ticker,
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "gross_amount_raw": "0",
                "net_amount_raw": "0",
                "description": f"{ticker} {transaction_type}",
                "source": {
                    "file_kind": "test_import",
                    "row_number": row_number,
                    "broker": broker,
                    "account": account,
                },
                "normalized": {
                    "position_quantity": quantity,
                    "display_quantity": quantity,
                    "is_cash_flow": False,
                },
            }

        source_records = [
            transfer_record("ibkr", "U00000001", "transfer_out", "DRAM", "195", 1),
            transfer_record("ibkr", "U00000001", "transfer_out", "QQQI", "10", 2),
        ]
        receipt_records = [
            transfer_record("schwab", "Individual ...001", "transfer_in", "DRAM", "195", 3),
            transfer_record("schwab", "Individual ...001", "transfer_in", "QQQI", "10", 4),
        ]
        transactions = source_records + receipt_records
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        bindings = {}
        for source in source_records:
            source_key = next(key for key, rows in binding_index.items() if rows == [source])
            receipt = next(
                receipt
                for receipt in receipt_records
                if receipt["ticker"] == source["ticker"]
            )
            receipt_key = next(key for key, rows in binding_index.items() if rows == [receipt])
            bindings[source_key] = receipt_key

        payload: dict[str, object] = {
            "transactions": transactions,
            "summary": {},
            "manual_internal_transfer_bindings": bindings,
            "manual_security_transfer_attributions": {},
        }

        refresh_investment_security_transfer_reconciliation(payload)
        reconciliation = payload["summary"]["security_transfer_reconciliation"]

        self.assertTrue(reconciliation["aggregate_holdings_available"])
        self.assertEqual(reconciliation["manual_match_count"], 2)
        self.assertEqual(reconciliation["unreconciled_inbound_count"], 0)
        self.assertEqual(reconciliation["unreconciled_outbound_count"], 0)
        self.assertEqual(
            [record["type"] for record in payload["transactions"]],
            ["transfer_out", "transfer_out", "transfer_in", "transfer_in"],
        )

    def test_schwab_security_binding_requires_same_day_and_remains_fail_closed(self) -> None:
        def record(
            *,
            broker: str,
            account: str,
            transaction_type: str,
            transaction_date: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": transaction_date,
                "datetime": f"{transaction_date} 12:00:00",
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": "QQQI",
                "currency": "USD",
                "quantity_raw": "5",
                "quantity_abs": "5",
                "gross_amount_raw": "0",
                "net_amount_raw": "0",
                "description": f"QQQI {transaction_type}",
                "source": {
                    "file_kind": "test_import",
                    "row_number": row_number,
                    "broker": broker,
                    "account": account,
                },
                "normalized": {
                    "position_quantity": "5",
                    "display_quantity": "5",
                    "is_cash_flow": False,
                },
            }

        source = record(
            broker="ibkr",
            account="U***001",
            transaction_type="transfer_out",
            transaction_date="2026-07-30",
            row_number=1,
        )
        schwab_receipt = record(
            broker="schwab",
            account="Individual ...001",
            transaction_type="transfer_in",
            transaction_date="2026-07-31",
            row_number=2,
        )
        transactions = [source, schwab_receipt]
        source_key = build_investment_internal_transfer_binding_key(source)
        receipt_key = build_investment_internal_transfer_binding_key(schwab_receipt)

        self.assertEqual(
            get_investment_internal_transfer_link_window_days(source, schwab_receipt),
            0,
        )
        with self.assertRaisesRegex(ValueError, "same calendar date"):
            validate_investment_internal_transfer_binding(
                transactions,
                source_key,
                receipt_key,
            )

        payload: dict[str, object] = {
            "transactions": transactions,
            "summary": {},
            "manual_internal_transfer_bindings": {source_key: receipt_key},
            "manual_security_transfer_attributions": {},
        }
        refresh_investment_security_transfer_reconciliation(payload)
        reconciliation = payload["summary"]["security_transfer_reconciliation"]
        self.assertEqual(reconciliation["manual_match_count"], 0)
        self.assertFalse(reconciliation["aggregate_holdings_available"])
        self.assertEqual(
            reconciliation["aggregate_overlay"]["source_attribution_required_receipt_keys"],
            [receipt_key],
        )

    def test_security_transfer_fifo_fallback_reconstructs_basis_with_source_fees(self) -> None:
        def record(
            *,
            broker: str,
            account: str,
            transaction_type: str,
            transaction_date: str,
            quantity: str,
            amount: str,
            price: str = "",
            row_number: int,
        ) -> dict[str, object]:
            normalized: dict[str, object] = {
                "position_quantity": quantity,
                "display_quantity": quantity,
                "net_amount": amount,
                "is_cash_flow": transaction_type in {"buy", "transfer_out", "transfer_in"},
            }
            if price:
                normalized["unit_price"] = price
            return {
                "date": transaction_date,
                "datetime": f"{transaction_date} 12:00:00",
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": "QQQI",
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "gross_amount_raw": amount,
                "net_amount_raw": amount,
                "price_raw": price,
                "description": f"QQQI {transaction_type}",
                "source": {
                    "file_kind": "test_import",
                    "row_number": row_number,
                    "broker": broker,
                    "account": account,
                },
                "normalized": normalized,
            }

        first_buy = record(
            broker="ibkr",
            account="U***001",
            transaction_type="buy",
            transaction_date="2026-07-01",
            quantity="3",
            amount="-30.09",
            price="10",
            row_number=1,
        )
        second_buy = record(
            broker="ibkr",
            account="U***001",
            transaction_type="buy",
            transaction_date="2026-07-10",
            quantity="4",
            amount="-80.12",
            price="20",
            row_number=2,
        )
        source_transfer_out = record(
            broker="ibkr",
            account="U***001",
            transaction_type="transfer_out",
            transaction_date="2026-07-31",
            quantity="5",
            amount="0",
            row_number=3,
        )
        schwab_receipt = record(
            broker="schwab",
            account="Individual ...001",
            transaction_type="transfer_in",
            transaction_date="2026-07-31",
            quantity="5",
            amount="0",
            row_number=4,
        )
        transactions = [first_buy, second_buy, source_transfer_out, schwab_receipt]
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        source_key = next(key for key, records in binding_index.items() if records == [source_transfer_out])
        receipt_key = next(key for key, records in binding_index.items() if records == [schwab_receipt])
        payload: dict[str, object] = {
            "transactions": transactions,
            "summary": {},
            "manual_internal_transfer_bindings": {source_key: receipt_key},
            "manual_security_transfer_attributions": {},
        }

        refresh_investment_security_transfer_reconciliation(payload)
        reconciliation = payload["summary"]["security_transfer_reconciliation"]
        basis = reconciliation["transfer_basis"]

        self.assertEqual(reconciliation["manual_match_count"], 1)
        self.assertEqual(reconciliation["pnl_unavailable_tickers"], [])
        self.assertEqual(len(basis), 1)
        self.assertEqual(basis[0]["method"], "fifo_reconstructed")
        self.assertEqual(basis[0]["method_label"], "FIFO reconstructed")
        self.assertEqual(basis[0]["status"], "known")
        self.assertEqual(basis[0]["carried_cost_basis"], "70.15")
        self.assertEqual(source_transfer_out["transfer_out_cost_basis_raw"], "70.15")
        self.assertEqual(schwab_receipt["carried_cost_basis_raw"], "70.15")
        self.assertEqual(schwab_receipt["carried_cost_basis_method_label"], "FIFO reconstructed")

    def test_schwab_security_transfer_attribution_is_explicit_and_evidence_supersedes(self) -> None:
        def record(
            *,
            broker: str,
            account: str,
            transaction_type: str,
            ticker: str,
            quantity: str,
            transaction_date: str,
            amount: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": transaction_date,
                "datetime": f"{transaction_date} 12:00:00",
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": ticker,
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "gross_amount_raw": amount,
                "net_amount_raw": amount,
                "description": f"{ticker} {transaction_type}",
                "source": {
                    "file_kind": "test_import",
                    "row_number": row_number,
                    "broker": broker,
                    "account": account,
                },
                "normalized": {
                    "position_quantity": quantity,
                    "display_quantity": quantity,
                    "is_cash_flow": False,
                },
            }

        source_buy = record(
            broker="ibkr",
            account="U***001",
            transaction_type="buy",
            ticker="QQQI",
            quantity="5",
            transaction_date="2026-07-01",
            amount="-250",
            row_number=1,
        )
        schwab_receipt = record(
            broker="schwab",
            account="Individual ...001",
            transaction_type="transfer_in",
            ticker="QQQI",
            quantity="5",
            transaction_date="2026-07-31",
            amount="0",
            row_number=2,
        )
        payload: dict[str, object] = {
            "transactions": [source_buy, schwab_receipt],
            "summary": {},
            "manual_internal_transfer_bindings": {},
            "manual_security_transfer_attributions": {},
        }
        receipt_key = next(
            key
            for key, records in build_investment_internal_transfer_binding_index(
                payload["transactions"]
            ).items()
            if records == [schwab_receipt]
        )

        validated = validate_investment_security_transfer_attribution(
            payload["transactions"],
            receipt_key,
            "ibkr",
            "U***001",
        )
        self.assertIs(validated, schwab_receipt)
        payload["manual_security_transfer_attributions"] = {
            receipt_key: {
                "schema_version": "1",
                "source_broker": "ibkr",
                "source_account": "U***001",
                "attested_at": "2026-08-04 10:00:00",
            }
        }
        refresh_investment_security_transfer_reconciliation(payload)
        reconciliation = payload["summary"]["security_transfer_reconciliation"]
        self.assertTrue(reconciliation["aggregate_holdings_available"])
        self.assertEqual(
            reconciliation["aggregate_overlay"]["active_receipt_keys"],
            [receipt_key],
        )
        self.assertEqual(reconciliation["pnl_unavailable_tickers"], ["QQQI"])
        self.assertEqual(
            [item["type"] for item in payload["transactions"]],
            ["buy", "transfer_in"],
        )

        source_out = record(
            broker="ibkr",
            account="U***001",
            transaction_type="transfer_out",
            ticker="QQQI",
            quantity="5",
            transaction_date="2026-07-31",
            amount="0",
            row_number=3,
        )
        payload["transactions"].append(source_out)
        refresh_investment_security_transfer_reconciliation(payload)
        reconciliation = payload["summary"]["security_transfer_reconciliation"]
        self.assertTrue(reconciliation["aggregate_holdings_available"])
        self.assertEqual(reconciliation["aggregate_overlay"]["active_receipt_keys"], [])
        self.assertEqual(
            reconciliation["aggregate_overlay"]["superseded_receipt_keys"],
            [receipt_key],
        )
        self.assertEqual(reconciliation["attribution_evidence_match_count"], 1)
        self.assertEqual(
            [item["type"] for item in payload["transactions"]],
            ["buy", "transfer_in", "transfer_out"],
        )

    def test_schwab_security_transfer_attribution_cannot_reuse_source_inventory(self) -> None:
        def record(
            *,
            broker: str,
            account: str,
            transaction_type: str,
            ticker: str,
            quantity: str,
            transaction_date: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": transaction_date,
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": ticker,
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "gross_amount_raw": "0" if transaction_type != "buy" else "-100",
                "net_amount_raw": "0" if transaction_type != "buy" else "-100",
                "description": f"{ticker} {transaction_type}",
                "source": {"file_kind": "test_import", "row_number": row_number},
            }

        source_buy = record(
            broker="ibkr",
            account="U***001",
            transaction_type="buy",
            ticker="QQQI",
            quantity="10",
            transaction_date="2026-07-01",
            row_number=1,
        )
        first_receipt = record(
            broker="schwab",
            account="Individual ...001",
            transaction_type="transfer_in",
            ticker="QQQI",
            quantity="5",
            transaction_date="2026-07-31",
            row_number=2,
        )
        second_receipt = record(
            broker="schwab",
            account="Individual ...001",
            transaction_type="transfer_in",
            ticker="QQQI",
            quantity="10",
            transaction_date="2026-08-03",
            row_number=3,
        )
        transactions = [source_buy, first_receipt, second_receipt]
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        first_key = next(key for key, records in binding_index.items() if records == [first_receipt])
        second_key = next(key for key, records in binding_index.items() if records == [second_receipt])
        attributions = {
            first_key: {
                "source_broker": "ibkr",
                "source_account": "U***001",
            }
        }

        with self.assertRaisesRegex(ValueError, "lacks enough prior imported shares"):
            validate_investment_security_transfer_attribution(
                transactions,
                second_key,
                "ibkr",
                "U***001",
                existing_attributions=attributions,
            )

    def test_schwab_positions_total_and_visible_bundle_account_mismatch_fail_closed(self) -> None:
        transactions_csv = "\n".join([
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
            '"08/03/2026","Security Transfer","QQQI","QQQI transfer receipt","5","","",""',
        ]) + "\n"
        positions_csv = "\n".join([
            '"Positions for account Individual ...001 as of 09:17 PM ET, 2026/08/03"',
            "",
            '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
            '"QQQI","QQQI ETF","5","53.89","$269.45","N/A","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
            '"Positions Total","--","--","--","$200.00","--","",',
        ]) + "\n"

        with self.assertRaisesRegex(ValueError, "Positions Total does not reconcile"):
            build_investment_payload_from_schwab_csv(
                transactions_csv.encode("utf-8"),
                positions_csv.encode("utf-8"),
                transaction_filename="Individual_XXX001_Transactions_20260803.csv",
                positions_filename="Individual-Positions-2026-08-03.csv",
            )
        with self.assertRaisesRegex(ValueError, "different visible account suffixes"):
            build_investment_payload_from_schwab_csv(
                transactions_csv.encode("utf-8"),
                positions_csv.replace("$200.00", "$269.86").encode("utf-8"),
                transaction_filename="Individual_XXX002_Transactions_20260803.csv",
                positions_filename="Individual-Positions-2026-08-03.csv",
            )

    def test_import_preserves_unknown_deposit_currency_and_forex_component_currency(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,312.14",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2025-10-31,U***87176,Electronic Fund Transfer,Deposit,-,-,-,-,314.18505289999996,-,314.18505289999996",
            "Transaction History,Data,2025-10-31,U***87176,Net Amount in Base from Forex Trade: 314.09 USD.HKD,Forex Trade Component,USD.HKD,314.09,7.77165,HKD,-2.041974516,-2,-2.041974516",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Forex,USD.HKD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        deposit, forex_component = payload["transactions"]
        self.assertIsNone(deposit["currency"])
        self.assertEqual(deposit["type"], "deposit")
        # Forex Trade Component amounts (gross/net) are the base currency impact
        # ("Net Amount in Base"), not the price currency of the pair.
        self.assertEqual(forex_component["currency"], "USD")
        self.assertEqual(forex_component["type"], "forex_trade_component")
        self.assertEqual(forex_component["ticker"], "USD.HKD")
        self.assertEqual(forex_component["price_raw"], "7.77165")
        self.assertEqual(forex_component["quantity_raw"], "314.09")

    def test_import_detects_usd_credit_interest_currency_from_description(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,0.68",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2025-10-03,U***TEST,USD Credit Interest for Sep-2025,Credit Interest,-,-,-,-,0.68,-,0.68",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "credit_interest")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_detects_dividend_currency_from_description(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,33.67",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2025-10-08,U***TEST,L9025R513(LU0052767562) Cash Dividend USD 0.033 per Share (Ordinary Dividend),Dividend,-,-,-,-,33.67,-,33.67",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "dividend")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_detects_foreign_tax_withholding_currency_from_description(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,-0.42",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2025-12-23,U***TEST,META(US30303M1027) Cash Dividend USD 0.525 per Share - US Tax,Foreign Tax Withholding,-,-,-,-,-0.42,-,-0.42",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "foreign_tax_withholding")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_normalizes_ibkr_distribution_description(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,-0.42",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2025-12-23,U***TEST,Qqqi(Us78433H6751) Cash Dividend USD 0.6346 Per Share - Us Tax,Foreign Tax Withholding,-,-,-,-,-0.42,-,-0.42",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(
            payload["transactions"][0]["description"],
            "QQQI (US78433H6751) Cash dividend USD 0.6346 per share · US tax",
        )

    def test_payload_description_separators_use_middle_dot_without_touching_identifiers(self) -> None:
        payload = {
            "broker": "ibkr",
            "transactions": [
                {"description": "EUV @ 23.80 × 5 - P-900005"},
                {"description": "WISE PAYMENTS LTD | Longbridge KOL reward"},
                {"description": "Rev – Cash Withdrawal"},
                {"description": "Fee — USD 0.02"},
                {"description": "A •  B"},
                {"description": "BRK-B"},
                {"description": "REF00000000000 - GOLD/EXCHANGE CREDIT"},
            ],
        }

        normalize_investment_payload_tickers(payload)

        self.assertEqual(
            [transaction["description"] for transaction in payload["transactions"]],
            [
                "EUV @ 23.80 × 5 · P-900005",
                "KOL Rewards · WISE PAYMENTS LTD · Longbridge",
                "Rev · Cash Withdrawal",
                "Fee · USD 0.02",
                "A · B",
                "BRK-B",
                "REF00000000000 · GOLD/EXCHANGE CREDIT",
            ],
        )

    def test_standard_transaction_description_wording_retains_kol_details(self) -> None:
        payload = {
            "broker": "longbridge_sg",
            "transactions": [
                {
                    "type": "kol_reward",
                    "description": "Longbridge KOL reward | Reward ID 123",
                },
                {
                    "type": "deposit",
                    "description": "EDDA Cash Deposit",
                },
                {
                    "type": "dividend",
                    "ticker": "TQQQ.US",
                    "description": "TQQQ.US Cash dividend: 0.275411 USD per share , Held:1",
                },
            ],
        }

        normalize_investment_payload_tickers(payload)

        self.assertEqual(
            [transaction["description"] for transaction in payload["transactions"]],
            [
                "KOL Rewards · Longbridge · Reward ID 123",
                "eDDA Cash Deposit",
                "TQQQ Cash dividend: 0.275411 USD per share, Held: 1",
            ],
        )

    def test_hsbc_pasted_import_hides_mirrored_trade_settlement_cash_rows(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 117.020",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "BOXX",
            "ALP ARCH 1-3 MONTH BOX",
            "117.020",
            "+0.030",
            "+0.03%1USD 117.020",
            "+0.010",
            "Unrealised gain / loss0.010",
            "+0.01%",
            "USD 117.020",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "BOXX",
            "ALP ARCH 1-3 MONTH BOX",
            "17 Jun 2026 U.S. ET",
            "Fully Executed",
            "Buy",
            "Limit Price Order",
            "117.020USD1",
            "Quantity",
            "Executed quantity1 share(s)",
            "Outstanding quantity0 share(s)",
            "P-900010",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "1,475.55",
            "USD",
            "Available balance:",
            "1,475.55 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "16 Jun 2026",
            "HK752751CVFAK8AO 955",
            "1,475.55",
            "1,475.55",
            "29 May 2026",
            "HK711493P6025013",
            "400.00",
            "0.00",
            "29 May 2026",
            "HK594421HJDNP81I 557",
            "400.00",
            "400.00",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        transactions = payload["transactions"]
        standalone_deposit = next(
            txn
            for txn in transactions
            if txn["description"] == "HK752751CVFAK8AO 955"
        )
        mirrored_deposit = next(
            txn
            for txn in transactions
            if txn["description"] == "HK594421HJDNP81I 557"
        )
        mirrored_withdrawal = next(
            txn
            for txn in transactions
            if txn["description"] == "HK711493P6025013"
        )

        self.assertEqual(standalone_deposit["type"], "deposit")
        self.assertFalse(standalone_deposit.get("presentation_hidden", False))
        self.assertEqual(mirrored_deposit["type"], "deposit")
        self.assertTrue(mirrored_deposit.get("presentation_hidden", False))
        self.assertEqual(
            mirrored_deposit.get("presentation_hidden_reason"),
            "hsbc_trade_settlement_pair",
        )
        self.assertEqual(mirrored_withdrawal["type"], "withdrawal")
        self.assertTrue(mirrored_withdrawal.get("presentation_hidden", False))

    def test_hsbc_pasted_import_uses_hidden_ref_rows_for_order_cash_calibration(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 68.000",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "DRAM",
            "ROUNDHILL MEMORY",
            "68.000",
            "-2.950",
            "-4.15%1USD 68.000",
            "-11.480",
            "Unrealised gain / loss-11.480",
            "-2.73%",
            "USD 68.000",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "DRAM",
            "ROUNDHILL MEMORY",
            "16 Jun 2026 U.S. ET",
            "Fully Executed",
            "Buy",
            "Limit Price Order",
            "68.000USD1",
            "Quantity",
            "Executed quantity1 share(s)",
            "Outstanding quantity0 share(s)",
            "P-900011",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "617.19",
            "USD",
            "Available balance:",
            "617.19 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "17 Jun 2026",
            "REF P900011001 SEC",
            "68.00",
            "617.19",
            "16 Jun 2026",
            "HK752751CVFAK8AO 955",
            "685.19",
            "685.19",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        transactions = payload["transactions"]
        self.assertEqual(len(transactions), 2)
        self.assertEqual(payload["ending_cash"], "617.19")

        self.assertTrue(
            any(
                txn["description"] == "HK752751CVFAK8AO 955"
                for txn in transactions
            )
        )
        self.assertTrue(
            any(
                txn["ticker"] == "DRAM" and txn["type"] == "buy"
                for txn in transactions
            )
        )


class InvestmentImportIntegrationTests(unittest.TestCase):
    def test_hsbc_pasted_import_annotates_unsettled_orders_from_available_cash(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 80.500",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "DRAM",
            "ROUNDHILL MEMORY",
            "80.500",
            "+0.000",
            "+0.00%1USD 80.500",
            "0.000",
            "Unrealised gain / loss0.000",
            "0.00%",
            "USD 80.500",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "DRAM",
            "ROUNDHILL MEMORY",
            "22 Jun 2026 U.S. ET",
            "Fully Executed",
            "Buy",
            "Limit Price Order",
            "80.500USD1",
            "Quantity",
            "Executed quantity1 share(s)",
            "Outstanding quantity0 share(s)",
            "P-900002",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "1,000.00",
            "USD",
            "Available balance:",
            "919.50 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "21 Jun 2026",
            "HK024945J1FUKAYO",
            "1,000.00",
            "1,000.00",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        deposit = next(
            txn
            for txn in payload["transactions"]
            if txn["description"] == "HK024945J1FUKAYO"
        )
        buy_order = next(
            txn
            for txn in payload["transactions"]
            if txn["ticker"] == "DRAM" and txn["type"] == "buy"
        )

        self.assertEqual(payload["ending_cash"], "919.50")
        self.assertEqual(payload["summary"]["cash_ledger_balance"], "1000.00")
        self.assertIn("available_cash_after_raw", deposit["source"])
        self.assertNotIn("available_cash_after_raw", buy_order["source"])
        self.assertNotIn("available_cash_calibration_source", buy_order["source"])
        self.assertEqual(buy_order["source"]["order_status_source_row_number"], 1)
        self.assertEqual(buy_order["source"]["order_status_page_order"], "newest_first")

    def test_hsbc_merge_prunes_stale_available_cash_before_settlement_window(self) -> None:
        existing_payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2025-06-02",
                    "type": "withdrawal",
                    "description": "USD CLEARING CHEQUE",
                    "currency": "USD",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "ticker": "",
                    "net_amount_raw": "-3310.36",
                    "source": {
                        "broker": "hsbc",
                        "account": "000-999999-999",
                        "file_kind": "hsbc_usd_account_text",
                        "balance_after_raw": "89.64",
                        "available_cash_after_raw": "-88.250",
                        "available_cash_calibration_source": "hsbc_usd_savings_available_balance",
                    },
                }
            ],
        }
        incoming_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Portfolio",
                "PortfolioMarket valueUSD 197.52",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "DRAM",
                "ROUNDHILL MEMORY",
                "80.500",
                "+0.000",
                "+0.00%1USD 80.500",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 80.500",
                "BOXX",
                "ALP ARCH 1-3 MONTH BOX",
                "117.02",
                "+0.00",
                "+0.00%1USD 117.02",
                "0.00",
                "Unrealised gain / loss0.00",
                "0.00%",
                "USD 117.02",
                "information",
            ]),
            order_status_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "DRAM",
                "ROUNDHILL MEMORY",
                "22 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "80.500USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900002",
                "BOXX",
                "ALP ARCH 1-3 MONTH BOX",
                "20 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "117.020USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900010",
            ]),
            cash_account_text="\n".join([
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "919.50",
                "USD",
                "Available balance:",
                "919.50 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "21 Jun 2026",
                "REF P900010001 SEC",
                "117.02",
                "1,000.00",
                "21 Jun 2026",
                "HK024945J1FUKAYO",
                "1,000.00",
                "1,000.00",
                "Download",
            ]),
        )

        merged = merge_investment_payloads(existing_payload, incoming_payload)

        stale_cash_row = next(
            txn
            for txn in merged["transactions"]
            if txn["description"] == "USD CLEARING CHEQUE"
        )
        buy_order = next(
            txn
            for txn in merged["transactions"]
            if txn["ticker"] == "DRAM" and txn["type"] == "buy"
        )

        self.assertNotIn("available_cash_after_raw", stale_cash_row["source"])
        self.assertEqual(stale_cash_row["source"]["balance_after_raw"], "89.64")
        self.assertNotIn("available_cash_after_raw", buy_order["source"])

    def test_hsbc_pasted_import_parses_sell_order_references_with_s_prefix(self) -> None:
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "BOXX",
            "ALP ARCH 1-3 MONTH BOX",
            "17 Jun 2026 U.S. ET",
            "Fully Executed",
            "Sell",
            "Limit Price Order",
            "117.020USD1",
            "Quantity",
            "Executed quantity1 share(s)",
            "Outstanding quantity0 share(s)",
            "S-900005",
        ])
        account_number, rows = _parse_hsbc_order_status_plain_text(order_status_text)
        self.assertEqual(account_number, "000-999999-999")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["order_reference"], "S-900005")
        self.assertEqual(rows[0]["transaction_type"], "Sell")

    def test_hsbc_pasted_import_attaches_split_sell_sec_fee_to_order(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 0.000",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "EUV",
            "CORGI LITHOGRAPHY",
            "29.925",
            "+1.045",
            "+3.62%10USD 299.250",
            "+1.760",
            "Unrealised gain / loss1.760",
            "+0.59%",
            "USD 29.749",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "BOXX",
            "ALP ARCH 1-3 MONTH BOX",
            "17 Jun 2026 U.S. ET",
            "Fully Executed",
            "Sell",
            "Limit Price Order",
            "117.020USD1",
            "Quantity",
            "Executed quantity1 share(s)",
            "Outstanding quantity0 share(s)",
            "S-900005",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "4,360.53",
            "USD",
            "Available balance:",
            "4,360.53 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "18 Jun 2026",
            "REF S900005001 SEC",
            "0.01",
            "4,360.53",
            "18 Jun 2026",
            "REF S900005001 SEC",
            "117.01",
            "4,360.54",
            "18 Jun 2026",
            "HK507133JOFHL19I 815",
            "2,200.00",
            "4,243.53",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        sell_order = next(
            txn
            for txn in payload["transactions"]
            if txn["type"] == "sell" and txn["ticker"] == "BOXX"
        )

        self.assertEqual(payload["ending_cash"], "4360.53")
        self.assertEqual(payload["summary"]["cash_ledger_balance"], "4360.53")
        self.assertEqual(sell_order["gross_amount_raw"], "117.020")
        self.assertEqual(sell_order["net_amount_raw"], "117.01")
        self.assertEqual(sell_order["commission_raw"], "-0.01")
        self.assertEqual(sell_order["normalized"]["commission_display"], "0.01")
        self.assertEqual(
            sell_order["source"]["cash_settlement_balance_after_raw"],
            "4360.53",
        )
        self.assertEqual(
            sell_order["source"]["cash_flow_fee_row_numbers"],
            [3],
        )
        self.assertEqual(
            [
                (
                    posting["amount_raw"],
                    posting["balance_after_raw"],
                    posting["ledger_sequence"],
                    posting["role"],
                )
                for posting in sell_order["source"]["cash_settlement_postings"]
            ],
            [
                ("117.01", "4360.54", 2, "principal"),
                ("-0.01", "4360.53", 3, "fee"),
            ],
        )

    def test_hsbc_pasted_import_attaches_dated_sell_sec_fee_to_order(self) -> None:
        portfolio_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Portfolio",
            "PortfolioMarket valueUSD 0.000",
            "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
            "EUV",
            "CORGI LITHOGRAPHY",
            "31.020",
            "+0.010",
            "+0.03%25USD 775.500",
            "+0.000",
            "Unrealised gain / loss0.000",
            "+0.00%",
            "USD 31.020",
            "information",
        ])
        order_status_text = "\n".join([
            "HSBCPersonal Internet BankingProxy voting",
            "PortfolioOrder StatusWatchlistMarketExpress View",
            "Open list of dropdownAccount",
            "HSBC One Investment Services",
            "000-999999-999",
            "Order Status",
            "EUV",
            "CORGI LITHOGRAPHY",
            "30 Jun 2026 U.S. ET",
            "Fully Executed",
            "Sell",
            "Limit Price Order",
            "31.020USD25",
            "Quantity",
            "Executed quantity25 share(s)",
            "Outstanding quantity0 share(s)",
            "S-900001",
        ])
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "18,124.43",
            "USD",
            "Available balance:",
            "18,124.43 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "02 Jul 2026",
            "REF S900001001 SEC (01JUL26)",
            "0.01",
            "18,124.43",
            "02 Jul 2026",
            "REF S900001001 SEC (01JUL26)",
            "775.48",
            "18,124.44",
            "Download",
        ])

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        sell_order = next(
            txn
            for txn in payload["transactions"]
            if txn["type"] == "sell" and txn["ticker"] == "EUV"
        )

        self.assertEqual(sell_order["gross_amount_raw"], "775.500")
        self.assertEqual(sell_order["net_amount_raw"], "775.48")
        self.assertEqual(sell_order["commission_raw"], "-0.01")
        self.assertEqual(sell_order["normalized"]["commission_display"], "0.01")
        self.assertEqual(
            sell_order["source"]["cash_settlement_reference"],
            "REF S900001001 SEC (01JUL26)",
        )
        self.assertEqual(
            sell_order["source"]["cash_flow_fee_row_numbers"],
            [2],
        )
        self.assertEqual(sell_order["settlement_adjustment_raw"], "-0.01")
        self.assertEqual(
            sell_order["source"]["settlement_component_total_raw"],
            "775.49",
        )
        self.assertEqual(
            sell_order["source"]["settlement_adjustment_classification"],
            "unclassified_broker_settlement_difference",
        )
        self.assertEqual(
            sell_order["normalized"]["settlement_adjustment"],
            "-0.01",
        )
        self.assertEqual(
            [
                (
                    posting["amount_raw"],
                    posting["balance_after_raw"],
                    posting["ledger_sequence"],
                    posting["role"],
                )
                for posting in sell_order["source"]["cash_settlement_postings"]
            ],
            [
                ("775.48", "18124.44", 1, "principal"),
                ("-0.01", "18124.43", 2, "fee"),
            ],
        )

    def test_hsbc_merge_removes_stale_visible_dated_order_cash_rows(self) -> None:
        existing_payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-07-02",
                    "datetime": "2026-07-02 20:00:00",
                    "type": "withdrawal",
                    "ticker": "",
                    "currency": "USD",
                    "description": "REF P900007001 SEC (01JUL26)",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "quantity_raw": "",
                    "quantity_abs": "",
                    "price_raw": "",
                    "gross_amount_raw": "-3020.40",
                    "commission_raw": "0",
                    "net_amount_raw": "-3020.40",
                    "source": {
                        "file_kind": "hsbc_usd_account_text",
                        "row_number": 98,
                        "ledger_sequence": 98,
                        "account_number": "000-999999-999",
                        "balance_after_raw": "17348.96",
                        "reference_id": "REF P900007001 SEC (01JUL26)",
                        "account_type": "USD Savings",
                        "broker": "hsbc",
                        "account": "000-999999-999",
                    },
                },
            ],
        }
        incoming_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Portfolio",
                "PortfolioMarket valueUSD 3020.400",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "100.680",
                "+0.000",
                "+0.00%30USD 3020.400",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 100.680",
                "information",
            ]),
            order_status_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "30 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "100.680USD30",
                "Quantity",
                "Executed quantity30 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900007",
            ]),
            cash_account_text="\n".join([
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "17,348.96",
                "USD",
                "Available balance:",
                "17,348.96 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "02 Jul 2026",
                "REF P900007001 SEC (01JUL26)",
                "3,020.40",
                "17,348.96",
                "Download",
            ]),
        )

        merged = merge_investment_payloads(existing_payload, incoming_payload)

        self.assertEqual(len(merged["transactions"]), 1)
        buy_order = merged["transactions"][0]
        self.assertEqual(buy_order["type"], "buy")
        self.assertEqual(buy_order["ticker"], "SGOV")
        self.assertEqual(buy_order["net_amount_raw"], "-3020.40")
        self.assertEqual(
            buy_order["source"]["cash_settlement_reference"],
            "REF P900007001 SEC (01JUL26)",
        )

    def test_hsbc_unsettled_orders_do_not_receive_synthetic_available_cash(self) -> None:
        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Portfolio",
                "PortfolioMarket valueUSD 3152.400",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "100.680",
                "+0.000",
                "+0.00%30USD 3020.400",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 100.680",
                "information",
                "DRAM",
                "ROUNDHILL MEMORY",
                "66.000",
                "+0.000",
                "+0.00%2USD 132.000",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 66.000",
                "information",
            ]),
            order_status_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "SGOV",
                "ISHARES 0-3 MONTH TRS BD",
                "30 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "100.680USD30",
                "Quantity",
                "Executed quantity30 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900007",
                "DRAM",
                "ROUNDHILL MEMORY",
                "01 Jul 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "66.000USD2",
                "Quantity",
                "Executed quantity2 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900008",
            ]),
            cash_account_text="\n".join([
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "18,124.43",
                "USD",
                "Available balance:",
                "18,124.43 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "02 Jul 2026",
                "REF P900007001 SEC (01JUL26)",
                "3,020.40",
                "17,348.96",
                "Download",
            ]),
        )

        unsettled_order = next(
            txn
            for txn in payload["transactions"]
            if txn["type"] == "buy" and txn["ticker"] == "DRAM"
        )

        self.assertTrue(unsettled_order["source"]["cash_replay_pending_settlement"])
        self.assertNotIn("available_cash_after_raw", unsettled_order["source"])
        self.assertEqual(payload["ending_cash"], "18124.43")

    def test_hsbc_cash_account_keeps_ref_rows_hidden_and_csv_calibrated_deposits_positive(self) -> None:
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "100.00",
            "USD",
            "Available balance:",
            "100.00 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "18 Jun 2026",
            "REF S900005001 SEC",
            "117.02",
            "100.00",
            "17 Jun 2026",
            "REF P900010001 SEC",
            "117.02",
            "0.00",
            "02 Jun 2025",
            "USD CLEARING CHEQUE",
            "89.64",
            "89.64",
            "Download",
        ])

        _, _, _, cash_records = _build_hsbc_cash_account_records_from_text(
            cash_account_text,
            warnings=[],
        )

        self.assertEqual(len(cash_records), 3)
        visible_records = [
            record for record in cash_records if not record.get("exclude_from_holdings_replay")
        ]
        self.assertEqual(len(visible_records), 1)
        self.assertEqual(visible_records[0]["description"], "USD CLEARING CHEQUE")
        self.assertEqual(visible_records[0]["type"], "deposit")
        self.assertEqual(visible_records[0]["net_amount_raw"], "89.64")
        hidden_ref_records = [
            record for record in cash_records if record.get("exclude_from_holdings_replay")
        ]
        self.assertEqual(len(hidden_ref_records), 2)
        self.assertTrue(all(record.get("presentation_hidden", False) for record in hidden_ref_records))

    def test_hsbc_cash_account_uses_adjacent_balance_for_pending_broker_deposit(self) -> None:
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999",
            "Ledger balance:",
            "25,857.41",
            "USD",
            "Available balance:",
            "21,834.41 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "22 Jun 2026",
            "HK024945J1FUKAYO",
            "21,496.88",
            "25,857.41",
            "18 Jun 2026",
            "REF S900005001 SEC",
            "0.01",
            "4,360.53",
            "18 Jun 2026",
            "REF S900005001 SEC",
            "117.01",
            "4,360.54",
            "18 Jun 2026",
            "HK507133JOFHL19I 815",
            "2,200.00",
            "4,243.53",
            "Download",
        ])

        _, available_balance, ledger_balance, cash_records = (
            _build_hsbc_cash_account_records_from_text(
                cash_account_text,
                warnings=[],
            )
        )

        pending_broker_deposit = next(
            record
            for record in cash_records
            if record["description"] == "HK024945J1FUKAYO"
        )
        self.assertEqual(available_balance, Decimal("21834.41"))
        self.assertEqual(ledger_balance, Decimal("25857.41"))
        self.assertEqual(pending_broker_deposit["type"], "deposit")
        self.assertEqual(pending_broker_deposit["net_amount_raw"], "21496.88")
        self.assertFalse(pending_broker_deposit.get("presentation_hidden", False))
        self.assertFalse(pending_broker_deposit.get("exclude_from_holdings_replay", False))

    def test_hsbc_cash_account_sort_keeps_same_day_ledger_sequence(self) -> None:
        cash_account_text = "\n".join([
            "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
            "USD Savings",
            "Account number:",
            "000-999999-999000-999999-999",
            "Ledger balance:",
            "19,676.30",
            "USD",
            "Available balance:",
            "19,676.30 USD",
            "Post date Description Amount in Amount out Balance Additional options",
            "26 Jun 2026",
            "HK308302G5G8NWOW",
            "2,946.63",
            "19,676.30",
            "26 Jun 2026",
            "HK316488P1417473",
            "100.88",
            "16,729.67",
            "26 Jun 2026",
            "HK336887DVG2ZN9S",
            "78.00",
            "16,830.55",
            "25 Jun 2026",
            "REF P900040001 SEC",
            "115.00",
            "16,752.55",
            "Download",
        ])

        _, _, _, cash_records = _build_hsbc_cash_account_records_from_text(
            cash_account_text,
            warnings=[],
        )
        _sort_transactions(cash_records)

        self.assertEqual(
            [record["net_amount_raw"] for record in cash_records if record["date"] == "2026-06-26"],
            ["78.00", "-100.88", "2946.63"],
        )

    def test_hsbc_order_status_sort_preserves_page_sequence_after_settlement_enrichment(self) -> None:
        def order_record(
            order_id: str,
            side: str,
            source_rank: int,
            *,
            cash_settlement_source_row_number: int | None = None,
        ) -> dict[str, object]:
            source: dict[str, object] = {
                "file_kind": "hsbc_order_status_text",
                "row_number": source_rank,
                "order_status_source_row_number": source_rank,
                "order_status_page_order": "newest_first",
                "order_id": order_id,
                "statement_order_id": order_id,
                "broker": "hsbc",
                "account": "000-999999-999",
            }
            if cash_settlement_source_row_number is not None:
                source["cash_settlement_source_row_number"] = (
                    cash_settlement_source_row_number
                )
            return {
                "date": "2026-08-07",
                "datetime": "2026-08-07 20:00:00",
                "type": side,
                "ticker": "DRAM",
                "currency": "USD",
                "quantity_raw": "2",
                "quantity_abs": "2",
                "price_raw": "50.00",
                "gross_amount_raw": "-100.00" if side == "buy" else "100.00",
                "net_amount_raw": "-100.00" if side == "buy" else "100.00",
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": source,
            }

        existing_payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                order_record("S-900004", "sell", 1),
                order_record("P-900006", "buy", 3),
            ],
        }
        incoming_payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                order_record(
                    "P-900006",
                    "buy",
                    1,
                    cash_settlement_source_row_number=50,
                ),
            ],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        orders = [
            transaction
            for transaction in merged["transactions"]
            if transaction["source"].get("file_kind") == "hsbc_order_status_text"
        ]

        self.assertEqual(
            [transaction["source"]["order_id"] for transaction in orders],
            ["P-900006", "S-900004"],
        )
        purchase = orders[0]
        self.assertEqual(
            purchase["source"]["order_status_source_row_number"],
            3,
        )
        self.assertEqual(
            purchase["source"]["cash_settlement_source_row_number"],
            50,
        )

    def test_hsbc_execution_notification_timestamp_replaces_only_date_fallback(self) -> None:
        def order_record(order_id: str, side: str, source_rank: int) -> dict[str, object]:
            return {
                "date": "2026-08-07",
                "datetime": "2026-08-07 20:00:00",
                "type": side,
                "ticker": "DRAM",
                "currency": "USD",
                "quantity_raw": "2",
                "quantity_abs": "2",
                "price_raw": "49.00" if side == "buy" else "50.50",
                "gross_amount_raw": "-98.00" if side == "buy" else "101.00",
                "net_amount_raw": "-98.00" if side == "buy" else "101.00",
                "broker": "hsbc",
                "account": "000-999999-999",
                "source": {
                    "file_kind": "hsbc_order_status_text",
                    "row_number": source_rank,
                    "order_status_source_row_number": source_rank,
                    "order_status_page_order": "newest_first",
                    "order_id": order_id,
                    "statement_order_id": order_id,
                },
            }

        payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                order_record("S-900004", "sell", 1),
                order_record("P-900006", "buy", 3),
            ],
        }
        applied = apply_hsbc_order_execution_notification_timestamps(
            payload,
            [
                {
                    "order_id": "P-900006",
                    "notification_datetime": "2026-08-07 10:43:40",
                    "notification_timezone": "America/New_York",
                    "side": "buy",
                    "ticker": "DRAM",
                    "quantity": "2",
                    "price": "49.00",
                    "sender": "notifications@example.invalid",
                    "gmail_message_id": "gmail-p596756",
                },
                {
                    "order_id": "S-900004",
                    "notification_datetime": "2026-08-07 15:07:08",
                    "notification_timezone": "America/New_York",
                    "side": "sell",
                    "ticker": "DRAM",
                    "quantity": "2",
                    "sender": "notifications@example.invalid",
                    "gmail_message_id": "gmail-s444967",
                },
            ],
        )

        self.assertEqual(
            applied,
            [
                {
                    "order_id": "P-900006",
                    "datetime": "2026-08-07 10:43:40",
                    "timezone": "America/New_York",
                },
                {
                    "order_id": "S-900004",
                    "datetime": "2026-08-07 15:07:08",
                    "timezone": "America/New_York",
                },
            ],
        )
        self.assertEqual(
            [transaction["source"]["order_id"] for transaction in payload["transactions"]],
            ["P-900006", "S-900004"],
        )
        purchase = payload["transactions"][0]
        self.assertEqual(purchase["datetime"], "2026-08-07 10:43:40")
        self.assertEqual(
            purchase["source"]["datetime_source_field"],
            "hsbc_order_execution_notification_sent_at",
        )
        self.assertTrue(
            purchase["source"]["datetime_is_execution_notification_proxy"]
        )

        merged = merge_investment_payloads(
            payload,
            {
                "schema_version": 1,
                "broker": "hsbc",
                "account": "000-999999-999",
                "summary": {},
                "transactions": [order_record("P-900006", "buy", 1)],
            },
        )
        preserved_purchase = next(
            transaction
            for transaction in merged["transactions"]
            if transaction["source"].get("order_id") == "P-900006"
        )
        self.assertEqual(preserved_purchase["datetime"], "2026-08-07 10:43:40")
        self.assertEqual(
            preserved_purchase["source"]["hsbc_order_execution_notification_gmail_message_id"],
            "gmail-p596756",
        )

    def test_hsbc_execution_notification_timestamp_refreshes_legacy_email_proxy(self) -> None:
        payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-06-16",
                    "datetime": "2026-06-16 21:30:06",
                    "type": "buy",
                    "ticker": "BOXX",
                    "currency": "USD",
                    "quantity_raw": "1",
                    "quantity_abs": "1",
                    "price_raw": "117.020",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "order_id": "P-900007",
                        "statement_order_id": "P-900007",
                        "datetime_authority": "hsbc_notification_email_received_at",
                        "datetime_local_timezone": "Asia/Shanghai",
                        "datetime_source_field": "source_notification_email_received_at_local",
                        "source_notification_email_message_id": "legacy-email",
                    },
                },
            ],
        }

        applied = apply_hsbc_order_execution_notification_timestamps(
            payload,
            [
                {
                    "order_id": "P-900007",
                    "notification_datetime": "2026-06-16 09:30:06",
                    "notification_timezone": "America/New_York",
                    "side": "buy",
                    "ticker": "BOXX",
                    "quantity": "1",
                    "price": "117.020",
                    "sender": "notifications@example.invalid",
                    "gmail_message_id": "current-email",
                },
            ],
        )

        self.assertEqual(
            applied,
            [
                {
                    "order_id": "P-900007",
                    "datetime": "2026-06-16 09:30:06",
                    "timezone": "America/New_York",
                },
            ],
        )
        self.assertEqual(payload["transactions"][0]["datetime"], "2026-06-16 09:30:06")
        self.assertEqual(
            payload["transactions"][0]["source"][
                "hsbc_order_execution_notification_gmail_message_id"
            ],
            "current-email",
        )

    def test_hsbc_merge_reuses_statement_order_id_when_settlement_adjusts_amounts(self) -> None:
        existing_payload = {
            "schema_version": 1,
            "broker": "hsbc",
            "account": "000-999999-999",
            "summary": {},
            "transactions": [
                {
                    "date": "2026-06-22",
                    "type": "buy",
                    "ticker": "BOXX",
                    "currency": "USD",
                    "description": "ALP ARCH 1-3 MONTH BOX",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "quantity_raw": "100",
                    "price_raw": "117.080",
                    "gross_amount_raw": "-11708.000",
                    "commission_raw": "0",
                    "net_amount_raw": "-11708.000",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "P-900004",
                        "order_id": "P-900004",
                        "broker": "hsbc",
                        "account": "000-999999-999",
                    },
                },
                {
                    "date": "2026-06-22",
                    "type": "buy",
                    "ticker": "GOOGL",
                    "currency": "USD",
                    "description": "ALPHABET INC-CL A",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "quantity_raw": "1",
                    "price_raw": "348.500",
                    "gross_amount_raw": "-348.500",
                    "commission_raw": "0",
                    "net_amount_raw": "-348.500",
                    "source": {
                        "file_kind": "hsbc_order_status_text",
                        "statement_order_id": "P-900003",
                        "order_id": "P-900003",
                        "broker": "hsbc",
                        "account": "000-999999-999",
                    },
                },
            ],
        }
        incoming_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Portfolio",
                "PortfolioMarket valueUSD 11708.00",
                "Price (%)QuantityTradable quantityMarket valueUnrealised gain/lossAverage purchase price1 Month",
                "BOXX",
                "ALP ARCH 1-3 MONTH BOX",
                "117.080",
                "+0.000",
                "+0.00%100USD 11708.000",
                "0.000",
                "Unrealised gain / loss0.000",
                "0.00%",
                "USD 117.080",
                "information",
            ]),
            order_status_text="\n".join([
                "HSBCPersonal Internet BankingProxy voting",
                "PortfolioOrder StatusWatchlistMarketExpress View",
                "Open list of dropdownAccount",
                "HSBC One Investment Services",
                "000-999999-999",
                "Order Status",
                "BOXX",
                "ALP ARCH 1-3 MONTH BOX",
                "22 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "117.080USD100",
                "Quantity",
                "Executed quantity100 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900004",
                "GOOGL",
                "ALPHABET INC-CL A",
                "22 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "348.500USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900003",
            ]),
            cash_account_text="\n".join([
                "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                "USD Savings",
                "Account number:",
                "000-999999-999",
                "Ledger balance:",
                "26806.56",
                "USD",
                "Available balance:",
                "26806.56 USD",
                "Post date Description Amount in Amount out Balance Additional options",
                "23 Jun 2026",
                "REF P900003001 SEC",
                "348.44",
                "26806.56",
                "23 Jun 2026",
                "REF P900004001 SEC",
                "11708.00",
                "27155.00",
                "Download",
            ]),
        )

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        merge_details = merged["summary"]["incremental_import"]

        self.assertEqual(len(merged["transactions"]), 2)
        self.assertEqual(merge_details["added_record_count"], 0)
        self.assertEqual(merge_details["duplicate_record_count"], 2)
        self.assertFalse(
            any(txn["description"].startswith("REF P") for txn in merged["transactions"])
        )

        boxx_order = next(
            txn
            for txn in merged["transactions"]
            if txn["source"]["statement_order_id"] == "P-900004"
        )
        googl_order = next(
            txn
            for txn in merged["transactions"]
            if txn["source"]["statement_order_id"] == "P-900003"
        )
        self.assertEqual(boxx_order["net_amount_raw"], "-11708.00")
        self.assertEqual(
            boxx_order["source"]["cash_settlement_reference"],
            "REF P900004001 SEC",
        )
        self.assertEqual(googl_order["net_amount_raw"], "-348.44")
        self.assertEqual(
            googl_order["source"]["cash_settlement_reference"],
            "REF P900003001 SEC",
        )

    def test_longbridge_import_fetches_large_ranges_in_windows(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        cli_calls: list[list[str]] = []

        def fake_cli_json(_settings: BrokerSettings, arguments: list[str], *, timeout_seconds: int = 30):
            cli_calls.append(arguments)
            if arguments[:2] == ["auth", "status"]:
                return {"account": {"member_id": "member-demo"}}
            if arguments[:2] == ["order", "--history"]:
                return {"orders": []}
            if arguments[:1] == ["cash-flow"]:
                return {"list": []}
            return None

        with (
            patch("app.services.investment_import.run_longbridge_cli_json", side_effect=fake_cli_json),
            patch(
                "app.services.investment_import.get_longbridge_cli_auth_status",
                return_value={"account": {"member_id": "member-demo"}},
            ),
        ):
            payload = build_investment_payload_from_longbridge(
                settings,
                start_date="2023-01-01",
                end_date="2026-06-15",
            )

        order_calls = [arguments for arguments in cli_calls if arguments[:2] == ["order", "--history"]]
        cash_flow_calls = [arguments for arguments in cli_calls if arguments[:1] == ["cash-flow"]]
        self.assertGreater(len(order_calls), 1)
        self.assertGreater(len(order_calls), len(cash_flow_calls))
        self.assertEqual(order_calls[0][order_calls[0].index("--start") + 1], "2022-12-02")
        self.assertEqual(order_calls[0][order_calls[0].index("--end") + 1], "2023-01-30")
        self.assertEqual(order_calls[-1][order_calls[-1].index("--end") + 1], "2026-06-15")
        for arguments in order_calls + cash_flow_calls:
            start = arguments[arguments.index("--start") + 1]
            end = arguments[arguments.index("--end") + 1]
            self.assertLessEqual(
                (date.fromisoformat(end) - date.fromisoformat(start)).days + 1,
                LONGBRIDGE_IMPORT_WINDOW_DAYS if arguments[:1] == ["cash-flow"] else LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
            )
        self.assertEqual(payload["generator"]["history_order_window_count"], len(order_calls))
        self.assertEqual(payload["generator"]["cash_flow_window_count"], len(cash_flow_calls))

    def test_longbridge_import_keeps_order_gross_when_cash_flow_contract_amount_does_not_match(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )

        def fake_cli_json(_settings: BrokerSettings, arguments: list[str], *, timeout_seconds: int = 30):
            if arguments[:2] == ["auth", "status"]:
                return {"account": {"member_id": "member-demo"}}
            if arguments[:2] == ["order", "--history"]:
                return {
                    "orders": [
                        {
                            "status": "Filled",
                            "side": "Buy",
                            "symbol": "JEPQ.US",
                            "executed_quantity": "20",
                            "executed_price": "54.40",
                            "created_at": "2025-06-30T12:40:46Z",
                            "order_id": "demo-order",
                            "currency": "USD",
                        },
                    ],
                }
            if arguments[:1] == ["cash-flow"]:
                return {
                    "list": [
                        {
                            "flow_name": "Buy Contract-Stocks",
                            "symbol": "JEPQ.US",
                            "balance": "-552.80",
                            "currency": "USD",
                            "time": "2025-06-30T12:40:46Z",
                        },
                        {
                            "flow_name": "Stock Trade Fee",
                            "symbol": "JEPQ.US",
                            "balance": "-0.43",
                            "currency": "USD",
                            "time": "2025-06-30T12:40:47Z",
                        },
                    ],
                }
            return None

        with (
            patch("app.services.investment_import.run_longbridge_cli_json", side_effect=fake_cli_json),
            patch(
                "app.services.investment_import.get_longbridge_cli_auth_status",
                return_value={"account": {"member_id": "member-demo"}},
            ),
        ):
            payload = build_investment_payload_from_longbridge(
                settings,
                start_date="2025-06-30",
                end_date="2025-06-30",
            )

        trade = next(transaction for transaction in payload["transactions"] if transaction["type"] == "buy")
        self.assertEqual(trade["gross_amount_raw"], "-1088.00")
        self.assertEqual(trade["commission_raw"], "0")
        self.assertEqual(trade["net_amount_raw"], "-1088.00")
        self.assertFalse(trade["normalized"]["is_cash_flow"])
        self.assertIn("accounting_adjustment_amount", trade["normalized"])
        self.assertGreater(payload["summary"]["warning_count"], 0)

    def test_longbridge_import_retries_timeout_windows_with_smaller_ranges(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        order_windows: list[tuple[str, str]] = []

        def fake_cli_json(_settings: BrokerSettings, arguments: list[str], *, timeout_seconds: int = 30):
            if arguments[:2] == ["auth", "status"]:
                return {"account": {"member_id": "member-demo"}}
            if arguments[:2] == ["order", "--history"]:
                start = arguments[arguments.index("--start") + 1]
                end = arguments[arguments.index("--end") + 1]
                order_windows.append((start, end))
                if start == "2022-12-02" and end == "2023-01-30":
                    raise RuntimeError("API error (code 408): Request Timeout trace_id: demo")
                return {"orders": []}
            if arguments[:1] == ["cash-flow"]:
                return {"list": []}
            return None

        with (
            patch("app.services.investment_import.run_longbridge_cli_json", side_effect=fake_cli_json),
            patch(
                "app.services.investment_import.get_longbridge_cli_auth_status",
                return_value={"account": {"member_id": "member-demo"}},
            ),
        ):
            build_investment_payload_from_longbridge(
                settings,
                start_date="2023-01-01",
                end_date="2023-04-30",
            )

        self.assertIn(("2022-12-02", "2023-01-30"), order_windows)
        self.assertIn(("2022-12-02", "2022-12-31"), order_windows)
        self.assertIn(("2023-01-01", "2023-01-30"), order_windows)

    def test_import_accepts_official_realized_summary_without_open_positions(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,\"July 3, 2023 - July 1, 2024\"",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Base Currency,USD",
            "Summary,Data,Starting Cash,0.0",
            "Summary,Data,Ending Cash,0.82051546680825",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2024-02-28,U***00001,Net Amount in Base from Forex Trade: 0.8205 USD.HKD,Forex Trade Component,USD.HKD,0.8205,7.82435,HKD,3.6043539374996936E-4,-,3.6043539374996936E-4",
            "Transaction History,Data,2024-02-25,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,0.8205402,-,0.8205402",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,BrokerName,Interactive Brokers LLC",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,\"July 3, 2023 - July 1, 2024\"",
            "Account Information,Header,Field Name,Field Value",
            "Account Information,Data,Account,U00000001",
            "Account Information,Data,Base Currency,USD",
            "Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change",
            "Net Asset Value,Data,Cash ,0,0.820515467,0,0.820515467,0.820515467",
            "Net Asset Value,Data,Total,0,0.820515467,0,0.820515467,0.820515467",
            "Change in NAV,Header,Field Name,Field Value",
            "Change in NAV,Data,Ending Value,0.820515467",
            "Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm in USD,,,Code",
            "Trades,Data,Order,Forex,HKD,USD.HKD,\"2024-02-27, 21:34:19\",0.8205,7.82435,-6.419879175,0,,,",
            "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
            "Deposits & Withdrawals,Data,HKD,2024-02-25,Electronic Fund Transfer,6.42",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["account"], "U00000001")
        self.assertEqual(payload["ending_cash"], "0.82051546680825")
        self.assertEqual(payload["position_snapshot"], {})
        self.assertEqual(payload["summary"]["holdings_validation"]["matched"], True)
        deposit, forex_component = payload["transactions"]
        self.assertEqual(deposit["type"], "deposit")
        self.assertEqual(forex_component["type"], "forex_trade_component")
        self.assertEqual(deposit["currency"], "HKD")
        self.assertEqual(deposit["net_amount_raw"], "6.42")
        self.assertEqual(
            deposit["source"]["file_kind"],
            "ibkr_realized_summary_cash",
        )

    def test_ibkr_realized_summary_native_cash_replaces_base_equivalents(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,\"January 1, 2026 - June 30, 2026\"",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Base Currency,USD",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,4,000",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-06-18,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,1105.575,-,1105.575",
            "Transaction History,Data,2026-06-18,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,1105.575,-,1105.575",
            "Transaction History,Data,2026-06-19,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,2948.2,-,2948.2",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,BrokerName,Interactive Brokers LLC",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,\"January 1, 2026 - June 30, 2026\"",
            "Account Information,Header,Field Name,Field Value",
            "Account Information,Data,Account,U00000001",
            "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
            "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,7500",
            "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,7500",
            "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,20000",
            "Deposits & Withdrawals,Data,CNH,2026-06-01,Electronic Fund Transfer,5000",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            positions_filename="U00000001_20260101_20260630.csv",
        )

        cash_records = [
            record
            for record in payload["transactions"]
            if record.get("type") == "deposit"
            and record.get("description") == "Electronic Fund Transfer"
        ]
        cash_summary = sorted(
            [
                (record["date"], record["currency"], record["net_amount_raw"])
                for record in cash_records
            ],
            key=lambda item: (item[0], Decimal(item[2])),
        )
        self.assertEqual(
            cash_summary,
            [
                ("2026-06-01", "CNH", "5000"),
                ("2026-06-19", "CNH", "7500"),
                ("2026-06-19", "CNH", "7500"),
                ("2026-06-19", "CNH", "20000"),
            ],
        )
        self.assertTrue(all(
            record["source"]["file_kind"] == "ibkr_realized_summary_cash"
            for record in cash_records
        ))
        self.assertEqual(
            payload["summary"]["ibkr_realized_summary_native_cash_record_count"],
            4,
        )
        self.assertEqual(
            payload["summary"]["ibkr_realized_summary_native_cash_replacement_count"],
            3,
        )
        self.assertEqual(
            payload["summary"]["ibkr_realized_summary_native_cash_unmatched_count"],
            1,
        )

    def test_merge_removes_stale_ibkr_base_cash_after_native_summary_import(self) -> None:
        base_record = {
            "date": "2026-06-18",
            "datetime": "2026-06-18 20:00:00",
            "type": "deposit",
            "currency": None,
            "description": "Electronic Fund Transfer",
            "net_amount_raw": "1105.575",
            "gross_amount_raw": "1105.575",
            "broker": "ibkr",
            "account": "U00000001",
            "source": {
                "file_kind": "transactions",
                "row_number": 133,
                "account": "U00000001",
            },
        }
        native_record = {
            "date": "2026-06-19",
            "datetime": "2026-06-19 20:00:00",
            "type": "deposit",
            "currency": "CNH",
            "description": "Electronic Fund Transfer",
            "net_amount_raw": "7500",
            "gross_amount_raw": "7500",
            "broker": "ibkr",
            "account": "U00000001",
            "source": {
                "file_kind": "ibkr_realized_summary_cash",
                "row_number": 371,
                "account": "U00000001",
            },
        }
        merged = merge_investment_payloads(
            {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "transactions": [base_record],
                "summary": {},
            },
            {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "transactions": [native_record],
                "summary": {},
            },
        )

        ibkr_cash = [
            record
            for record in merged["transactions"]
            if record.get("broker") == "ibkr"
            and record.get("type") == "deposit"
        ]
        self.assertEqual(len(ibkr_cash), 1)
        self.assertEqual(ibkr_cash[0]["currency"], "CNH")
        self.assertEqual(
            merged["summary"]["incremental_import"][
                "superseded_ibkr_realized_summary_cash_count"
            ],
            1,
        )

    def test_ibkr_three_period_merge_keeps_single_ibkr_grant_and_holdings(self) -> None:
        period_two_transactions = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0.82051547405775",
            "Summary,Data,Ending Cash,0.018767169049200002",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2024-11-28,U***00001,Example,Deposit,-,-,-,-,1,-,1",
        ]) + "\n"
        period_two_positions = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Data,Summary,Stocks,USD,IBKR,-,0.0008,1,48.91,0.039128,56.32,0.05,0.010872,",
            "Open Positions,Data,Lot,Stocks,USD,IBKR,2024-11-28 (Vesting: 2025-11-28),0.0008,,48.91,0.039128,56.32,0.05,0.010872,Un;ST",
        ]) + "\n"
        period_three_transactions = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0.018767169049200002",
            "Summary,Data,Ending Cash,20.1543564743363",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-01-29,U***00001,INTERACTIVE BROKERS GRO-CL A,Buy,IBKR,1.0,75.5,USD,-75.5,-0.34915725,-84.25",
        ]) + "\n"
        period_three_positions = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Data,Summary,Stocks,USD,IBKR,-,4.25,1,64.25,272.5,94.7,400.0,127.5,",
            "Open Positions,Data,Lot,Stocks,USD,IBKR,\"2026-01-29, 19:23:43 (Vesting: 2026-09-11)\",4.25,,64.25,272.5,94.7,400.0,127.5,Un;ST",
        ]) + "\n"

        period_two_payload = build_investment_payload_from_ibkr_csvs(
            period_two_transactions.encode("utf-8"),
            period_two_positions.encode("utf-8"),
        )
        period_three_payload = build_investment_payload_from_ibkr_csvs(
            period_three_transactions.encode("utf-8"),
            period_three_positions.encode("utf-8"),
        )
        merged = merge_investment_payloads(
            merge_investment_payloads(None, period_two_payload),
            period_three_payload,
        )

        ibkr_grants = [
            record
            for record in merged["transactions"]
            if record.get("type") == "grant" and record.get("ticker") == "IBKR"
        ]
        self.assertEqual(len(ibkr_grants), 1)
        self.assertEqual(ibkr_grants[0]["quantity_raw"], "3.25")
        self.assertEqual(merged["position_snapshot"]["IBKR"]["quantity"], "4.25")
        self.assertTrue(merged["summary"]["holdings_validation"]["matched"])

    def test_ibkr_grant_merge_dedupes_conflicting_quantities_for_same_lot(self) -> None:
        stale_grant = {
            "date": "2026-01-29",
            "datetime": "2026-01-29 20:00:00",
            "type": "grant",
            "currency": "USD",
            "description": "Unvested shares from stock grant: IBKR",
            "ticker": "IBKR",
            "quantity_raw": "4.25",
            "quantity_abs": "4.25",
            "price_raw": "64.25",
            "gross_amount_raw": "0",
            "net_amount_raw": "0",
            "vesting_date": "2026-09-11 20:00:00",
            "broker": "ibkr",
            "account": "U00000001",
            "source": {
                "file_kind": "positions",
                "row_number": 48,
                "transaction_type_raw": "Stock Grant",
                "broker": "ibkr",
                "account": "U00000001",
            },
        }
        corrected_grant = dict(stale_grant)
        corrected_grant["quantity_raw"] = "3.25"
        corrected_grant["quantity_abs"] = "3.25"

        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [stale_grant],
            "position_snapshot": {"IBKR": {"quantity": "4.25"}},
            "summary": {"ending_cash_raw": "20.1543564743363"},
            "ending_cash": "20.1543564743363",
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [corrected_grant],
            "position_snapshot": {"IBKR": {"quantity": "4.25"}},
            "summary": {"ending_cash_raw": "20.1543564743363"},
            "ending_cash": "20.1543564743363",
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        ibkr_grants = [
            record
            for record in merged["transactions"]
            if record.get("type") == "grant" and record.get("ticker") == "IBKR"
        ]
        self.assertEqual(len(ibkr_grants), 1)
        self.assertEqual(ibkr_grants[0]["quantity_raw"], "4.25")

    def test_ibkr_csv_import_marks_position_snapshot_authoritative(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,100",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-04-01,U***TEST,Example Buy,Buy,QQQ,1,100,USD,-100,-1,-101",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Data,Summary,Stocks,USD,QQQ,-,1,1,100,100,105,105,5,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])
        self.assertEqual(
            payload["summary"]["position_snapshot_source"],
            "ibkr_csv_open_positions",
        )

    def test_ibkr_same_day_position_snapshot_prefers_later_observed_capture(self) -> None:
        payload = normalize_investment_payload_tickers({
            "schema_version": "3.0.0",
            "broker": "multiple",
            "account": "multiple",
            "transactions": [],
            "broker_snapshots": {
                "ibkr:U00000001": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "evidence": [
                        {
                            "broker": "ibkr",
                            "account": "U00000001",
                            "snapshot_as_of": "2026-08-14",
                            "position_snapshot_authoritative": True,
                            "position_snapshot_source": "ibkr_user_verified_app_positions",
                            "position_snapshot": {
                                "DRAM": {
                                    "quantity": "70",
                                    "as_of": "2026-08-14 11:14:00",
                                },
                                "QQQI": {"quantity": "280"},
                                "IBKR": {"quantity": "3.9179"},
                            },
                        },
                        {
                            "broker": "ibkr",
                            "account": "U00000001",
                            "snapshot_as_of": "2026-08-14",
                            "position_snapshot_authoritative": True,
                            "position_snapshot_source": "ibkr_user_verified_app_positions",
                            "position_snapshot": {
                                "DRAM": {
                                    "quantity": "75",
                                    "as_of": "2026-08-14 13:24:00",
                                },
                                "QQQI": {"quantity": "280"},
                            },
                        },
                    ],
                },
            },
        })

        snapshot = payload["broker_snapshots"]["ibkr:U00000001"]
        self.assertEqual(snapshot["position_snapshot"]["DRAM"]["quantity"], "75")
        self.assertEqual(snapshot["position_snapshot_as_of"], "2026-08-14")

    def test_ibkr_broker_summary_mirrors_cumulative_csv_performance_snapshot(self) -> None:
        payload = normalize_investment_payload_tickers({
            "schema_version": "3.0.0",
            "broker": "multiple",
            "account": "multiple",
            "transactions": [],
            "broker_summaries": {
                "ibkr": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot_source": "ibkr_closed_trades",
                    "performance_snapshot": {
                        "META": {"realized_total": "2013.66520575"},
                    },
                },
            },
            "broker_snapshots": {
                "ibkr:U00000001": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "evidence": [{
                        "broker": "ibkr",
                        "account": "U00000001",
                        "snapshot_as_of": "2026-08-14",
                        "performance_snapshot_authoritative": True,
                        "performance_snapshot_source": "ibkr_csv_realized_summary",
                        "performance_snapshot": {
                            "META": {
                                "realized_total": "1006.83260375",
                                "currency": "USD",
                                "realized_total_source": (
                                    "ibkr_csv_cumulative_non_overlapping_periods"
                                ),
                            },
                        },
                    }],
                },
            },
        })

        summary = payload["broker_summaries"]["ibkr"]
        self.assertEqual(
            summary["performance_snapshot"]["META"]["realized_total"],
            "1006.83260375",
        )
        self.assertEqual(
            summary["performance_snapshot_source"],
            "ibkr_csv_realized_summary",
        )

    def test_ibkr_csv_persists_exact_source_evidence_and_per_account_snapshot(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        self.assertEqual(len(payload["source_artifacts"]), 2)
        self.assertTrue(all("content_base64" in artifact for artifact in payload["source_artifacts"]))

        mixed_payload = merge_investment_payloads(payload, {
            "schema_version": "3.0.0",
            "broker": "hsbc",
            "account": "000-999999-999",
            "transactions": [],
        })
        ibkr_snapshot = mixed_payload["broker_snapshots"]["ibkr:U00000001"]
        self.assertEqual(ibkr_snapshot["position_snapshot"]["QQQ"]["quantity"], "1")
        self.assertEqual(ibkr_snapshot["performance_snapshot"]["QQQ"]["total"], "10")
        self.assertEqual(ibkr_snapshot["position_snapshot_source"], "ibkr_csv_open_positions")

        expected_bytes_by_source_kind = {
            "ibkr_transaction_history_csv": transactions_csv,
            "ibkr_realized_summary_csv": positions_csv,
        }
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(mixed_payload, ledger_path)
            verify_investment_source_artifacts(materialized, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            reloaded = load_investment_store_payload(ledger_path)
            verify_investment_source_artifacts(reloaded, ledger_path)
            self.assertEqual(reloaded["broker_snapshots"], materialized["broker_snapshots"])
            self.assertTrue(all(
                "content_base64" not in artifact
                for artifact in reloaded["source_artifacts"]
            ))
            evidence_directory = investment_evidence_dir_for(ledger_path)
            for artifact in reloaded["source_artifacts"]:
                self.assertEqual(
                    (evidence_directory / f"{artifact['sha256']}.bin").read_bytes(),
                    expected_bytes_by_source_kind[artifact["source_kind"]],
                )
            self.assertTrue(clear_investment_store(ledger_path))
            self.assertFalse(evidence_directory.exists())

    def test_persisted_investment_evidence_scan_detects_a_missing_source_file(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(transactions_csv, positions_csv)

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)

            self.assertEqual(
                verify_persisted_investment_source_artifacts(ledger_path),
                len(materialized["source_artifacts"]),
            )
            missing_artifact = materialized["source_artifacts"][0]
            (investment_evidence_dir_for(ledger_path) / f"{missing_artifact['sha256']}.bin").unlink()
            with self.assertRaisesRegex(RuntimeError, "file is missing"):
                verify_persisted_investment_source_artifacts(ledger_path)

    def test_incremental_import_can_preserve_known_historical_evidence_gaps(self) -> None:
        source_bytes = b"historical,source\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [{
                "sha256": source_sha256,
                "byte_count": len(source_bytes),
                "content_encoding": "base64",
                "content_base64": base64.b64encode(source_bytes).decode("ascii"),
            }],
        }

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            evidence_path = investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"
            evidence_path.unlink()

            existing_keys = investment_source_artifact_storage_keys(materialized)
            preserved = materialize_investment_source_artifacts(
                materialized,
                ledger_path,
                allow_missing_storage_keys=existing_keys,
            )
            verify_investment_source_artifacts(
                preserved,
                ledger_path,
                allow_missing_storage_keys=existing_keys,
            )

            with self.assertRaisesRegex(RuntimeError, "file is missing"):
                verify_investment_source_artifacts(preserved, ledger_path)

    def test_corrupt_investment_parquet_fails_closed_without_overwrite(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            corrupt_bytes = b"not a parquet ledger"
            ledger_path.write_bytes(corrupt_bytes)

            with self.assertRaisesRegex(RuntimeError, "could not be read safely"):
                load_investment_store_payload(ledger_path)
            self.assertEqual(ledger_path.read_bytes(), corrupt_bytes)

            with self.assertRaisesRegex(RuntimeError, "could not be read safely"):
                update_investment_store_payload(
                    lambda current: ({"broker": "ibkr"}, None),
                    ledger_path,
                )
            self.assertEqual(ledger_path.read_bytes(), corrupt_bytes)

    def test_corrupt_legacy_investment_json_fails_closed_without_creating_parquet(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            legacy_path = Path(temporary_directory) / "investment.json"
            corrupt_bytes = b'{"transactions": ['
            legacy_path.write_bytes(corrupt_bytes)
            parquet_path = legacy_path.with_suffix(".parquet")

            with self.assertRaisesRegex(RuntimeError, "legacy investment ledger could not be read safely"):
                load_investment_store_payload(legacy_path)
            self.assertEqual(legacy_path.read_bytes(), corrupt_bytes)
            self.assertFalse(parquet_path.exists())

            with self.assertRaisesRegex(RuntimeError, "legacy investment ledger could not be read safely"):
                update_investment_store_payload(
                    lambda current: ({"broker": "ibkr"}, None),
                    legacy_path,
                )
            self.assertEqual(legacy_path.read_bytes(), corrupt_bytes)
            self.assertFalse(parquet_path.exists())

    def test_source_evidence_preserves_crlf_bytes_and_reports_the_changed_file(self) -> None:
        source_bytes = b"header,amount\r\nQQQ,100\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [{
                "source_kind": "unit_test_csv",
                "sha256": source_sha256,
                "byte_count": len(source_bytes),
                "content_encoding": "base64",
                "content_base64": base64.b64encode(source_bytes).decode("ascii"),
            }],
        }

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            evidence_path = investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"

            self.assertEqual(evidence_path.read_bytes(), source_bytes)
            self.assertEqual(verify_persisted_investment_source_artifacts(ledger_path), 1)

            evidence_path.write_bytes(source_bytes.replace(b"\r\n", b"\n"))
            with self.assertRaisesRegex(RuntimeError, "file has changed") as raised:
                verify_persisted_investment_source_artifacts(ledger_path)

        self.assertIn(str(evidence_path), str(raised.exception))
        self.assertIn("do not normalize line endings", str(raised.exception))

    def test_missing_source_evidence_can_be_restored_from_exact_original_bytes(self) -> None:
        source_bytes = b"header,amount\r\nQQQ,100\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [{
                "source_kind": "unit_test_csv",
                "sha256": source_sha256,
                "byte_count": len(source_bytes),
                "content_encoding": "base64",
                "content_base64": base64.b64encode(source_bytes).decode("ascii"),
            }],
        }

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            ledger_path = root / "store" / "investment.parquet"
            source_dir = root / "originals"
            ledger_path.parent.mkdir()
            source_dir.mkdir()
            original_path = source_dir / "broker-export.csv"
            original_path.write_bytes(source_bytes)
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            evidence_path = investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"
            evidence_path.unlink()

            restored_count = restore_missing_investment_evidence(ledger_path, source_dir)

            self.assertEqual(restored_count, 1)
            self.assertEqual(evidence_path.read_bytes(), source_bytes)
            self.assertEqual(verify_persisted_investment_source_artifacts(ledger_path), 1)

    def test_source_artifact_normalization_rejects_forged_storage_key_and_byte_count(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(transactions_csv, positions_csv)

        forged_storage_key_payload = deepcopy(payload)
        forged_storage_key_payload["source_artifacts"][0]["storage_key"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "storage key does not match"):
            normalize_investment_payload_tickers(forged_storage_key_payload)

        malformed_byte_count_payload = deepcopy(payload)
        malformed_byte_count_payload["source_artifacts"][0]["byte_count"] = "not-a-byte-count"
        with self.assertRaisesRegex(ValueError, "invalid byte count"):
            normalize_investment_payload_tickers(malformed_byte_count_payload)

    def test_source_artifact_normalization_never_silently_skips_malformed_entries(self) -> None:
        with self.assertRaisesRegex(ValueError, "manifest is malformed"):
            _normalize_source_artifacts([None])

    def test_materialized_evidence_rejects_raw_bytes_and_enforces_storage_limits(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(transactions_csv, positions_csv)
        source_sizes = [len(transactions_csv), len(positions_csv)]

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            with patch.object(
                storage,
                "MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES",
                min(source_sizes) - 1,
            ):
                with self.assertRaisesRegex(ValueError, "per-file storage limit"):
                    materialize_investment_source_artifacts(payload, ledger_path)

            with (
                patch.object(storage, "MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES", max(source_sizes)),
                patch.object(
                    storage,
                    "MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES",
                    sum(source_sizes) - 1,
                ),
            ):
                with self.assertRaisesRegex(ValueError, "local storage limit"):
                    materialize_investment_source_artifacts(payload, ledger_path)

            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            leaked_payload = deepcopy(materialized)
            leaked_payload["source_artifacts"][0]["content_encoding"] = "base64"
            leaked_payload["source_artifacts"][0]["content_base64"] = base64.b64encode(
                transactions_csv
            ).decode("ascii")
            with self.assertRaisesRegex(RuntimeError, "must not retain raw source evidence bytes"):
                verify_investment_source_artifacts(leaked_payload, ledger_path)

        self.assertGreater(MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES, max(source_sizes))
        self.assertGreater(MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES, sum(source_sizes))

    def test_materialization_waits_for_the_same_ledger_lock_used_by_clear(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(transactions_csv, positions_csv)

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            save_investment_store_payload({"transactions": []}, ledger_path)
            evidence_directory = investment_evidence_dir_for(ledger_path)
            evidence_directory.mkdir()
            (evidence_directory / "prior.bin").write_bytes(b"prior evidence")

            clear_started = Event()
            allow_clear = Event()
            materialization_started = Event()
            failures: list[BaseException] = []
            original_rmtree = storage.shutil.rmtree
            original_write = storage._write_immutable_evidence_bytes

            def pause_clear(target: Path) -> None:
                self.assertEqual(target, evidence_directory)
                clear_started.set()
                if not allow_clear.wait(timeout=5):
                    raise RuntimeError("Timed out while coordinating the investment-store clear test.")
                original_rmtree(target)

            def track_materialization(*args, **kwargs) -> None:
                materialization_started.set()
                original_write(*args, **kwargs)

            def run_clear() -> None:
                try:
                    clear_investment_store(ledger_path)
                except BaseException as exc:  # pragma: no cover - assertion is below
                    failures.append(exc)

            def run_materialization() -> None:
                try:
                    materialize_investment_source_artifacts(payload, ledger_path)
                except BaseException as exc:  # pragma: no cover - assertion is below
                    failures.append(exc)

            with (
                patch.object(storage.shutil, "rmtree", side_effect=pause_clear),
                patch.object(storage, "_write_immutable_evidence_bytes", side_effect=track_materialization),
            ):
                clear_thread = Thread(target=run_clear)
                materialize_thread = Thread(target=run_materialization)
                try:
                    clear_thread.start()
                    self.assertTrue(clear_started.wait(timeout=5))
                    materialize_thread.start()
                    self.assertFalse(materialization_started.wait(timeout=0.2))
                finally:
                    allow_clear.set()
                    clear_thread.join(timeout=5)
                    materialize_thread.join(timeout=5)

            self.assertFalse(clear_thread.is_alive())
            self.assertFalse(materialize_thread.is_alive())
            self.assertFalse(failures)
            self.assertTrue(materialization_started.is_set())

    def test_clear_investment_store_keeps_the_ledger_lock_while_removing_evidence(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            save_investment_store_payload({"transactions": []}, ledger_path)
            evidence_directory = investment_evidence_dir_for(ledger_path)
            evidence_directory.mkdir()
            (evidence_directory / "source.bin").write_bytes(b"immutable evidence")

            held_lock_paths: list[Path] = []
            original_rmtree = storage.shutil.rmtree

            @contextmanager
            def tracking_lock(lock_path: Path):
                held_lock_paths.append(lock_path)
                try:
                    yield
                finally:
                    held_lock_paths.pop()

            def remove_evidence_directory(target: Path) -> None:
                self.assertEqual(target, evidence_directory)
                self.assertIn(ledger_path, held_lock_paths)
                original_rmtree(target)

            with (
                patch.object(storage, "market_store_file_lock", tracking_lock),
                patch.object(storage.shutil, "rmtree", side_effect=remove_evidence_directory),
            ):
                self.assertTrue(clear_investment_store(ledger_path))

            self.assertFalse(ledger_path.exists())
            self.assertFalse(evidence_directory.exists())

    def test_ibkr_statement_period_parser_accepts_standard_csv_metadata(self) -> None:
        self.assertEqual(
            _parse_ibkr_statement_period("July 1, 2026 - July 31, 2026"),
            ("2026-07-01", "2026-07-31"),
        )

    def test_ibkr_web_paste_converts_beijing_times_and_captures_current_gap(self) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=InvestmentImportTests._ibkr_web_trade_notifications_text(),
        )

        self.assertEqual(payload["account"], "U00000001")
        self.assertEqual(len(payload["transactions"]), 6)
        current_gap = [
            record
            for record in payload["transactions"]
            if record["datetime"] >= "2026-07-28 22:00:00"
        ]
        dram_quantity = sum(
            Decimal(record["quantity_raw"])
            for record in current_gap
            if record["ticker"] == "DRAM"
        )
        googl_quantity = sum(
            Decimal(record["quantity_raw"])
            for record in current_gap
            if record["ticker"] == "GOOGL"
        )
        self.assertEqual(dram_quantity, Decimal("15"))
        self.assertEqual(googl_quantity, Decimal("-1"))
        latest = payload["transactions"][-1]
        self.assertEqual(latest["datetime"], "2026-07-29 00:17:00")
        self.assertEqual(latest["commission_raw"], "-0.35")
        self.assertTrue(latest["source"]["provisional_until_file_import"])
        self.assertEqual(
            payload["source_artifacts"][0]["source_kind"],
            "ibkr_web_trade_notifications_text",
        )
        self.assertTrue(payload["source_artifacts"][0]["content_base64"])
        self.assertFalse(payload["summary"]["position_snapshot_authoritative"])

    def test_ibkr_current_web_paste_preserves_split_fills_and_position_calibration(self) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                InvestmentImportTests._ibkr_current_web_trade_notifications_text()
            ),
            ending_cash="123.45",
            position_snapshot_text="BETA 27\nALFA 9\nGAMMA 4.25",
        )

        self.assertEqual(len(payload["transactions"]), 5)
        split_sales = [
            record
            for record in payload["transactions"]
            if record.get("ticker") == "ALFA" and record.get("type") == "sell"
        ]
        self.assertEqual(len(split_sales), 2)
        self.assertEqual(
            sorted(record["commission_raw"] for record in split_sales),
            ["-0.35", "0.0"],
        )
        self.assertEqual(
            sum(
                Decimal(record["net_amount_raw"])
                for record in payload["transactions"]
            ),
            Decimal("-21.18"),
        )
        self.assertEqual(
            {
                ticker: snapshot["quantity"]
                for ticker, snapshot in payload["position_snapshot"].items()
            },
                {"BETA": "27", "ALFA": "9", "GAMMA": "4.25"},
        )
        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])
        self.assertEqual(
            payload["summary"]["position_snapshot_source"],
            "ibkr_user_verified_app_positions",
        )
        self.assertEqual(
            payload["summary"]["position_snapshot_as_of"],
            "2025-08-03 08:18:00",
        )
        self.assertEqual(payload["summary"]["ending_cash_raw"], "123.45")
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["position_snapshot"],
            payload["position_snapshot"],
        )

        reimported = merge_investment_payloads(payload, payload)
        self.assertEqual(len(reimported["transactions"]), 5)
        self.assertEqual(
            reimported["position_snapshot"],
            payload["position_snapshot"],
        )
        self.assertEqual(
            reimported["broker_summaries"]["ibkr"]["ending_cash"],
            "123.45",
        )

    def test_ibkr_mixed_current_and_historical_web_paste_uses_page_date_only_for_current_rows(
        self,
    ) -> None:
        text = """Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
BETA
Bot 10 @ 55.70 on NASDAQ
U00000001 Bought 10
Filled
11:14 PM
55.70
557
Fees: 0.34
ALFA
Sold 25 @ 57.7512 on DARK
U00000001 Sold 25
Filled
11:05 PM
57.7512
1443.78
Fees: 0.39
BETA
Bot 5 @ 55.35 on NASDAQ
U00000001 Bought 5
Filled
8/13/2026, 8:13 PM
55.35
276.75
Fees: 0.34
ALFA
Sold 5 @ 55.65 on OVERNIGHT
U00000001 Sold 5
Filled
8/13/2026, 9:56 AM
55.65
278.25
Fees: 0.35"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=text,
            trade_date="2026-08-14",
            ending_cash="987.65",
            position_snapshot_text="BETA 28\nALFA 7\nGAMMA 3.25",
        )

        self.assertEqual(len(payload["transactions"]), 4)
        current_buy = next(
            record
            for record in payload["transactions"]
            if record["ticker"] == "BETA" and record["quantity_raw"] == "10"
        )
        current_sell = next(
            record
            for record in payload["transactions"]
            if record["ticker"] == "ALFA" and record["quantity_raw"] == "-25"
        )
        historical_buy = next(
            record
            for record in payload["transactions"]
            if record["ticker"] == "BETA" and record["quantity_raw"] == "5"
        )
        self.assertEqual(current_buy["datetime"], "2026-08-14 11:14:00")
        self.assertEqual(current_sell["datetime"], "2026-08-14 11:05:00")
        self.assertEqual(
            current_buy["source"]["source_datetime_raw"],
            "2026-08-14, 11:14 PM",
        )
        self.assertEqual(historical_buy["datetime"], "2026-08-13 08:13:00")
        self.assertEqual(payload["ending_cash"], "987.65")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of_datetime"],
            "2026-08-14 11:14:00",
        )
        self.assertEqual(
            {
                ticker: snapshot["quantity"]
                for ticker, snapshot in payload["position_snapshot"].items()
            },
            {"BETA": "28", "ALFA": "7", "GAMMA": "3.25"},
        )
        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])

        reimported = merge_investment_payloads(payload, payload)
        self.assertEqual(len(reimported["transactions"]), 4)
        self.assertEqual(reimported["ending_cash"], "987.65")
        self.assertEqual(reimported["position_snapshot"], payload["position_snapshot"])

    def test_ibkr_current_day_web_paste_requires_page_date_when_the_display_omits_it(self) -> None:
        text = """Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
BETA
Bot 1 @ 10.00 on ARCA
U00000001 Bought 1
Filled
11:14 PM
10
Fees: 0.10"""

        with self.assertRaisesRegex(ValueError, "Provide the Hong Kong page date"):
            build_investment_payload_from_ibkr_web_pasted_text(
                trade_notifications_text=text,
            )

    def test_ibkr_current_position_calibration_requires_matching_cash_boundary(self) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                InvestmentImportTests._ibkr_current_web_trade_notifications_text()
            ),
            ending_cash="123.46",
        )

        self.assertEqual(payload["position_snapshot"], {})
        self.assertFalse(payload["summary"]["position_snapshot_authoritative"])
        self.assertNotIn("position_snapshot_source", payload["summary"])
        self.assertEqual(payload["ending_cash"], "123.46")

    def test_ibkr_current_web_paste_preserves_multi_currency_cash_boundary(self) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                InvestmentImportTests._ibkr_current_web_trade_notifications_text()
            ),
            ending_cash_by_currency={"USD": "123.46", "CNH": "88.80"},
            position_snapshot_text="NVDA 2\nQQQI 1.25",
        )

        self.assertEqual(payload["ending_cash"], "123.46")
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"USD": "123.46", "CNH": "88.80"},
        )
        self.assertEqual(
            payload["summary"]["ending_cash_by_currency"],
            {"USD": "123.46", "CNH": "88.80"},
        )
        self.assertEqual(
            {
                ticker: snapshot["quantity"]
                for ticker, snapshot in payload["position_snapshot"].items()
            },
            {"NVDA": "2", "QQQI": "1.25"},
        )
        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])

    def test_ibkr_compact_orders_paste_imports_only_filled_trade_without_fabricating_fee(self) -> None:
        text = """Search
⌘ + K
Orders & Trades
Trade Notifications
Orders Action Filled/Remain Status Price Account Order id
QQQI @OvernightUS Overnight Trading
Buy 5 QQQI Limit 15.35, OVT
Buy 0/5
Cancelled
9:59 AM
— U00000001 900003
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Profit Taker
Buy 10 DRAM Limit 54.63, OVT
Buy 0/10
Cancelled
9:57 AM
— U00000001 900002
Order Details
Your order has been filled
Sold 10 DRAM Limit 15.65, OVT
Account U00000001
Order Type Limit
Limit Price 15.65
Time-In-Force OVT
Filled/Remain 10
Status Filled
Order ID 900001"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=text,
            trade_date="2026-08-13",
        )

        self.assertEqual(payload["account"], "U00000001")
        self.assertEqual(len(payload["transactions"]), 1)
        transaction = payload["transactions"][0]
        self.assertEqual(transaction["ticker"], "DRAM")
        self.assertEqual(transaction["type"], "sell")
        self.assertEqual(transaction["quantity_raw"], "-10")
        self.assertEqual(transaction["price_raw"], "15.65")
        self.assertEqual(transaction["gross_amount_raw"], "156.50")
        self.assertEqual(transaction["datetime"], "2026-08-12 21:56:00")
        self.assertEqual(transaction["source"]["order_id"], "900001")
        self.assertTrue(transaction["source"]["fee_missing_from_capture"])
        self.assertNotIn("commission_raw", transaction)
        self.assertNotIn("net_amount_raw", transaction)

    def test_ibkr_compact_orders_reconciles_same_page_split_trade_fees(self) -> None:
        text = """Search
⌘ + K
Orders & Trades
Trade Notifications
Orders Action Filled/Remain Status Price Account Order id
QQQI @OvernightUS Overnight Trading
Buy 5 QQQI Limit 15.35, OVT
Buy 0/5
Cancelled
9:59 AM
— U00000001 900003
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Profit Taker
Buy 10 DRAM Limit 54.63, OVT
Buy 0/10
Cancelled
9:57 AM
— U00000001 900002
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0
DRAM
Bot 2 @ 49.00 on TXSE
U00000001 Bought 2
Filled
8/7/2026, 10:43 PM
49.00
98
Fees: 0.34"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=text,
            trade_date="2026-08-13",
        )

        self.assertEqual(len(payload["transactions"]), 1)
        transaction = payload["transactions"][0]
        self.assertEqual(transaction["ticker"], "DRAM")
        self.assertEqual(transaction["quantity_raw"], "-10")
        self.assertEqual(transaction["commission_raw"], "-0.35")
        self.assertEqual(transaction["commission_abs"], "0.35")
        self.assertEqual(transaction["net_amount_raw"], "156.15")
        self.assertEqual(transaction["source"]["fee_source"], "same_page_trade_fill_details")
        self.assertEqual(transaction["source"]["fill_detail_count"], 2)
        self.assertNotIn("fee_missing_from_capture", transaction["source"])

    def test_ibkr_web_paste_retains_user_verified_cash_at_last_fill_datetime(self) -> None:
        text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=text,
            trade_date="2026-08-13",
            ending_cash="845.67",
        )

        self.assertEqual(payload["ending_cash"], "845.67")
        self.assertEqual(payload["summary"]["cash_snapshot_source"], "ibkr_user_verified_app_cash")
        self.assertTrue(payload["summary"]["cash_snapshot_authoritative"])
        self.assertEqual(payload["summary"]["ending_cash_as_of"], "2026-08-12")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of_datetime"],
            "2026-08-12 21:56:00",
        )
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["ending_cash"],
            "845.67",
        )

    def test_ibkr_user_verified_cash_survives_older_file_snapshot_merge(self) -> None:
        text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""
        user_cash_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=text,
            trade_date="2026-08-13",
            ending_cash="845.67",
        )
        older_file_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "ending_cash": "312.45",
            "summary": {
                "ending_cash_raw": "312.45",
                "cash_snapshot_source": "ibkr_csv_summary",
                "ending_cash_as_of": "2026-08-12",
                "ending_cash_replay_as_of": "2026-08-12",
            },
            "transactions": user_cash_payload["transactions"],
        }

        merged = merge_investment_payloads(user_cash_payload, older_file_payload)

        self.assertEqual(merged["broker_summaries"]["ibkr"]["ending_cash"], "845.67")
        self.assertEqual(
            merged["broker_summaries"]["ibkr"]["cash_snapshot_source"],
            "ibkr_user_verified_app_cash",
        )
        self.assertEqual(len(merged["transactions"]), 1)

    def test_newer_ibkr_gainskeeper_cash_snapshot_replaces_older_user_capture(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text="""Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0""",
            trade_date="2026-08-13",
            ending_cash="845.67",
        )
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "ending_cash": "312.45",
            "summary": {
                "ending_cash_raw": "312.45",
                "cash_snapshot_source": "ibkr_gainskeeper_balances",
                "cash_snapshot_authoritative": True,
                "ending_cash_as_of": "2026-08-13",
                "ending_cash_replay_as_of": "2026-08-13",
            },
            "transactions": [],
        }

        merged = merge_investment_payloads(web_payload, gainskeeper_payload)

        self.assertEqual(merged["broker_summaries"]["ibkr"]["ending_cash"], "312.45")
        self.assertEqual(
            merged["broker_summaries"]["ibkr"]["cash_snapshot_source"],
            "ibkr_gainskeeper_balances",
        )

    def test_ibkr_gainskeeper_cash_snapshot_uses_latest_fill_datetime(self) -> None:
        evidence = InvestmentImportTests._ibkr_gainskeeper_evidence_file().replace(
            b"</INVSTMTRS>",
            b"<INVBAL><BALLIST><BAL><NAME>Cash</NAME><VALUE>312.45</VALUE>"
            b"</BAL></BALLIST></INVBAL></INVSTMTRS>",
        )

        payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (evidence, "cash-boundary.gkx"),
        ])

        self.assertEqual(payload["ending_cash"], "312.45")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of_datetime"],
            "2026-07-02 22:33:38",
        )
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["ending_cash_replay_as_of_datetime"],
            "2026-07-02 22:33:38",
        )

    def test_ibkr_gainskeeper_other_transactions_preserve_source_identity(self) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (
                InvestmentImportTests._ibkr_gainskeeper_other_evidence_file(),
                "other-transactions.gkx",
            ),
        ])

        self.assertEqual(len(payload["transactions"]), 3)
        self.assertEqual(payload["ending_cash"], "879.44224649")
        records_by_fitid = {
            transaction["source"]["fitid"]: transaction
            for transaction in payload["transactions"]
        }
        self.assertEqual(
            records_by_fitid["OTHER-BUY-1"]["datetime"],
            "2025-09-08 08:14:18",
        )
        self.assertEqual(
            records_by_fitid["OTHER-BUY-1"]["net_amount_raw"],
            "-10000.00000204",
        )
        self.assertEqual(
            records_by_fitid["OTHER-BUY-1"]["source"]["gkx_transaction_tag"],
            "BUYOTHER",
        )
        self.assertEqual(
            records_by_fitid["OTHER-SELL-1"]["source"]["gkx_transaction_tag"],
            "SELLOTHER",
        )

    def test_ibkr_gainskeeper_merge_repairs_legacy_time_and_unidentified_rows(self) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files([
            (
                InvestmentImportTests._ibkr_gainskeeper_other_evidence_file(),
                "other-transactions.gkx",
            ),
        ])
        legacy = deepcopy(incoming)
        legacy["transactions"][0]["datetime"] = "2025-09-08 20:14:18"
        legacy["transactions"][0]["source"].update({
            "datetime_local_timezone": "Asia/Shanghai",
            "datetime_localized_from": "source_datetime_raw_explicit_offset",
            "datetime_localized_to": "Asia/Shanghai",
        })
        legacy["transactions"][0]["source"].update({
            "file_kind": "transactions",
            "fitid": "",
        })
        legacy["transactions"][1]["type"] = "dividend_reinvestment"
        legacy["transactions"][1]["source"].update({
            "file_kind": "transactions",
            "fitid": "",
        })

        merged = merge_investment_payloads(legacy, incoming)

        self.assertEqual(len(merged["transactions"]), 3)
        self.assertEqual(
            sorted(
                transaction["source"]["fitid"]
                for transaction in merged["transactions"]
            ),
            ["OTHER-BUY-1", "OTHER-BUY-2", "OTHER-SELL-1"],
        )
        buy = next(
            transaction
            for transaction in merged["transactions"]
            if transaction["source"]["fitid"] == "OTHER-BUY-1"
        )
        self.assertEqual(buy["datetime"], "2025-09-08 08:14:18")
        self.assertNotIn("datetime_localized_to", buy["source"])
        self.assertEqual(
            buy["source"]["datetime_timezone"],
            "America/New_York",
        )

    def test_cross_broker_merge_preserves_current_cash_scope_and_hsbc_boundary(self) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files([
            (
                InvestmentImportTests._ibkr_gainskeeper_evidence_file(),
                "baseline.gkx",
            ),
        ])
        existing = {
            "broker": "multiple",
            "account": "multiple",
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc", "ibkr", "schwab"],
                "authoritative_current_cash_scope_confirmed_on": "2026-08-15",
                "authoritative_current_cash_scope_source": (
                    "user_confirmed_current_cash_balances"
                ),
                "hsbc_ending_cash_components": {
                    "USD:SAVINGS": "21109.06",
                    "HKD:SAVINGS": "89.24",
                },
                "hsbc_cash_component_post_dates": {
                    "USD:SAVINGS": "2026-08-13",
                    "HKD:SAVINGS": "2026-08-06",
                },
            },
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "ending_cash": "21109.06",
                    "ending_cash_raw": "21109.06",
                    "ending_cash_base_currency": "21109.06",
                    "cash_snapshot_authoritative": True,
                },
            },
            "transactions": [],
        }

        merged = merge_investment_payloads(existing, incoming)

        self.assertEqual(
            merged["summary"]["authoritative_current_cash_brokers"],
            ["hsbc", "ibkr", "schwab"],
        )
        self.assertEqual(
            merged["summary"]["authoritative_current_cash_scope_confirmed_on"],
            "2026-08-15",
        )
        self.assertEqual(
            merged["summary"]["hsbc_ending_cash_components"]["USD:SAVINGS"],
            "21109.06",
        )
        self.assertEqual(
            merged["broker_summaries"]["hsbc"]["ending_cash"],
            "21109.06",
        )

    def test_hsbc_equal_dated_cash_capture_survives_snapshot_winner(self) -> None:
        payload = {
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
            },
            "broker_summaries": {
                "hsbc": {
                    "ending_cash": "22685.75",
                    "ending_cash_base_currency": "21109.06",
                    "ending_cash_base_currency_as_of": "2026-08-17",
                    "hsbc_ending_cash_components": {
                        "USD:SAVINGS": "22685.75",
                    },
                },
            },
        }
        older_scope_payload = {
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
            },
            "broker_summaries": {
                "hsbc": {
                    "ending_cash": "21109.06",
                    "ending_cash_base_currency": "21109.06",
                    "ending_cash_base_currency_as_of": "2026-08-17",
                },
            },
        }

        _preserve_authoritative_current_cash_scope(payload, older_scope_payload)
        hsbc_summary = payload["broker_summaries"]["hsbc"]

        self.assertEqual(hsbc_summary["ending_cash"], "22685.75")
        self.assertEqual(hsbc_summary["ending_cash_base_currency"], "22685.75")
        self.assertEqual(
            hsbc_summary["hsbc_ending_cash_components"]["USD:SAVINGS"],
            "22685.75",
        )

    def test_ibkr_web_paste_is_supplemental_after_gainskeeper_cutoff_in_either_order(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text="""Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0""",
            trade_date="2026-08-13",
            ending_cash="845.67",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (InvestmentImportTests._ibkr_gainskeeper_evidence_file(), "baseline.gkx"),
        ])
        gainskeeper_payload["ending_cash"] = "312.45"
        gainskeeper_payload["summary"].update({
            "ending_cash_raw": "312.45",
            "cash_snapshot_source": "ibkr_csv_summary",
            "ending_cash_as_of": "2026-08-12",
            "ending_cash_replay_as_of": "2026-08-12",
        })
        gainskeeper_payload["broker_summaries"]["ibkr"].update({
            "ending_cash": "312.45",
            "ending_cash_raw": "312.45",
            "cash_snapshot_source": "ibkr_csv_summary",
            "ending_cash_as_of": "2026-08-12",
            "ending_cash_replay_as_of": "2026-08-12",
        })

        self.assertEqual(web_payload["summary"]["capture_scope"], "supplemental")
        self.assertEqual(
            web_payload["summary"]["capture_role"],
            "trade_records_after_file_cutoff",
        )
        self.assertEqual(
            web_payload["source_artifacts"][0]["snapshot_relationship"],
            "supplements_file_snapshots_when_present",
        )

        merged_variants = [
            merge_investment_payloads(gainskeeper_payload, web_payload),
            merge_investment_payloads(web_payload, gainskeeper_payload),
        ]
        for merged in merged_variants:
            self.assertEqual(len(merged["transactions"]), 2)
            dram_sale = next(
                record
                for record in merged["transactions"]
                if record.get("ticker") == "DRAM"
            )
            self.assertEqual(dram_sale["datetime"], "2026-08-12 21:56:00")
            self.assertEqual(dram_sale["net_amount_raw"], "156.15")
            self.assertEqual(
                dram_sale["source"]["capture_role"],
                "trade_records_after_file_cutoff",
            )
            self.assertEqual(
                merged["summary"]["capture_scope"],
                "supplemental",
            )
            self.assertEqual(
                merged["broker_summaries"]["ibkr"]["ending_cash"],
                "845.67",
            )
            self.assertEqual(
                merged["broker_summaries"]["ibkr"]["cash_snapshot_source"],
                "ibkr_user_verified_app_cash",
            )
            self.assertEqual(
                merged["broker_summaries"]["ibkr"]["capture_role"],
                "trade_records_after_file_cutoff",
            )

            remerged = merge_investment_payloads(merged, web_payload)
            self.assertEqual(len(remerged["transactions"]), 2)
            self.assertEqual(
                remerged["broker_summaries"]["ibkr"]["ending_cash"],
                "845.67",
            )

    def test_ibkr_web_paste_refines_existing_compact_fee_without_duplicate(self) -> None:
        compact_text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001"""
        enriched_text = compact_text + """
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""

        compact_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=compact_text,
            trade_date="2026-08-13",
        )
        enriched_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=enriched_text,
            trade_date="2026-08-13",
        )
        merged = merge_investment_payloads(compact_payload, enriched_payload)

        matching = [
            record
            for record in merged["transactions"]
            if record.get("source", {}).get("order_id") == "900001"
        ]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["commission_raw"], "-0.35")
        self.assertEqual(matching[0]["source"]["fill_detail_count"], 2)
        self.assertNotIn("fee_missing_from_capture", matching[0]["source"])

    def test_ibkr_compact_aggregate_supersedes_exact_full_page_split_fill_payload(self) -> None:
        compact_text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""
        full_page_text = """Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
8/13/2026, 9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
8/13/2026, 9:56 AM
15.65
78.25
Fees: 0.0"""
        compact_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=compact_text,
            trade_date="2026-08-13",
        )
        full_page_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=full_page_text,
        )

        for existing, incoming in (
            (compact_payload, full_page_payload),
            (full_page_payload, compact_payload),
        ):
            merged = merge_investment_payloads(deepcopy(existing), deepcopy(incoming))
            sales = [
                record
                for record in merged["transactions"]
                if record.get("ticker") == "DRAM" and record.get("type") == "sell"
            ]
            self.assertEqual(len(sales), 1)
            self.assertEqual(sales[0]["quantity_raw"], "-10")
            self.assertEqual(sales[0]["commission_raw"], "-0.35")
            self.assertEqual(
                sales[0]["source"]["source_format"],
                "pasted_text_compact_orders",
            )
            self.assertEqual(
                merged["summary"]["incremental_import"][
                    "superseded_ibkr_web_compact_split_fill_count"
                ],
                2,
            )

    def test_repair_ibkr_compact_split_fill_duplicates_rebuilds_summary_counts(self) -> None:
        compact_text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""
        full_page_text = """Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
8/13/2026, 9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
8/13/2026, 9:56 AM
15.65
78.25
Fees: 0.0"""
        compact_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=compact_text,
            trade_date="2026-08-13",
        )
        full_page_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=full_page_text,
        )
        legacy_payload = deepcopy(compact_payload)
        legacy_payload["transactions"] = [
            *compact_payload["transactions"],
            *full_page_payload["transactions"],
        ]
        legacy_payload["summary"]["transaction_count"] = 3
        legacy_payload["summary"]["total_record_count"] = 3

        repaired, removed_record_count = repair_ibkr_web_compact_split_fill_duplicates(
            legacy_payload
        )

        self.assertEqual(removed_record_count, 2)
        self.assertEqual(len(repaired["transactions"]), 1)
        self.assertEqual(repaired["summary"]["transaction_count"], 1)
        self.assertEqual(repaired["summary"]["total_record_count"], 1)
        self.assertEqual(
            repaired["summary"]["ledger_repair"]["removed_duplicate_record_count"],
            2,
        )

    def test_ibkr_gainskeeper_split_fills_replace_matching_web_compact_aggregate(self) -> None:
        compact_text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001
Trades Account Action Quantity Status Price Amount
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.35
DRAM
Sold 5 @ 15.65 on OVERNIGHT
U00000001 Sold 5
Filled
9:56 AM
15.65
78.25
Fees: 0.0"""
        compact_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=compact_text,
            trade_date="2026-08-13",
        )
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "generator": {
                "name": "ibkr_gainskeeper_ofx_to_investment_json",
                "generated_at": "2026-08-14T12:00:00+00:00",
            },
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "transactions": [
                {
                    "date": "2026-08-12",
                    "datetime": "2026-08-12 21:56:01",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-5",
                    "quantity_abs": "5",
                    "price_raw": "15.65",
                    "gross_amount_raw": "78.25",
                    "commission_raw": "-0.36",
                    "commission_abs": "0.36",
                    "net_amount_raw": "77.89",
                    "source": {
                        "file_kind": "gainskeeper",
                        "account": "U00000001",
                        "fitid": "GKX-SELL-ONE",
                        "source_datetime_raw": "20260812215601",
                        "has_intraday_timestamp": True,
                    },
                },
                {
                    "date": "2026-08-12",
                    "datetime": "2026-08-12 21:56:02",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-5",
                    "quantity_abs": "5",
                    "price_raw": "15.65",
                    "gross_amount_raw": "78.25",
                    "commission_raw": "-0.01",
                    "commission_abs": "0.01",
                    "net_amount_raw": "78.24",
                    "source": {
                        "file_kind": "gainskeeper",
                        "account": "U00000001",
                        "fitid": "GKX-SELL-TWO",
                        "source_datetime_raw": "20260812215602",
                        "has_intraday_timestamp": True,
                    },
                },
            ],
        }

        for existing, incoming in (
            (compact_payload, gainskeeper_payload),
            (gainskeeper_payload, compact_payload),
        ):
            merged = merge_investment_payloads(deepcopy(existing), deepcopy(incoming))
            sales = [
                record
                for record in merged["transactions"]
                if record.get("ticker") == "DRAM" and record.get("type") == "sell"
            ]
            self.assertEqual(len(sales), 2)
            self.assertEqual(
                {record["source"]["file_kind"] for record in sales},
                {"gainskeeper"},
            )
            self.assertEqual(
                {record["commission_raw"] for record in sales},
                {"-0.36", "-0.01"},
            )
            self.assertEqual(
                merged["summary"]["incremental_import"][
                    "superseded_ibkr_web_compact_aggregate_count"
                ],
                1,
            )

    def test_ibkr_gainskeeper_replaces_matching_web_paste_precision(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=InvestmentImportTests._ibkr_web_trade_notifications_text(),
        )
        gainskeeper_record = {
            "date": "2026-07-28",
            "datetime": "2026-07-28 18:49:19",
            "type": "buy",
            "broker": "ibkr",
            "account": "U00000001",
            "currency": "USD",
            "ticker": "DRAM",
            "quantity_raw": "5",
            "quantity_abs": "5",
            "price_raw": "46",
            "gross_amount_raw": "-230",
            "commission_raw": "-0.34327225",
            "commission_abs": "0.34327225",
            "net_amount_raw": "-230.34327225",
            "source": {
                "file_kind": "gainskeeper",
                "account": "U00000001",
                "fitid": "TEST-FITID-20260728-1",
                "source_datetime_raw": "20260728184919",
                "has_intraday_timestamp": True,
            },
        }
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "generator": {
                "name": "ibkr_gainskeeper_ofx_to_investment_json",
                "generated_at": "2026-07-30T12:00:00+00:00",
            },
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_gainskeeper_positions",
            },
            "position_snapshot": {"DRAM": {"quantity": "40"}},
            "performance_snapshot": {},
            "transactions": [gainskeeper_record],
        }

        for merged in (
            merge_investment_payloads(web_payload, deepcopy(gainskeeper_payload)),
            merge_investment_payloads(deepcopy(gainskeeper_payload), web_payload),
        ):
            overlap = [
                record
                for record in merged["transactions"]
                if record.get("ticker") == "DRAM"
                and record.get("price_raw") == "46"
            ]
            self.assertEqual(len(overlap), 1)
            self.assertEqual(overlap[0]["source"]["file_kind"], "gainskeeper")
            self.assertEqual(overlap[0]["datetime"], "2026-07-28 18:49:19")
            self.assertEqual(overlap[0]["commission_raw"], "-0.34327225")
            self.assertNotIn(
                "provisional_until_file_import",
                overlap[0]["source"],
            )
            self.assertNotIn("execution_key", overlap[0]["source"])
            self.assertNotIn("source_timezone", overlap[0]["source"])
            self.assertNotIn("venue", overlap[0]["source"])
            self.assertEqual(len(merged["transactions"]), 6)
            self.assertEqual(
                merged["position_snapshot"],
                {"DRAM": {"quantity": "40"}},
            )
            self.assertTrue(
                merged["summary"]["position_snapshot_authoritative"]
            )

    def test_ibkr_gainskeeper_artifact_captures_ofx_period_and_generation_time(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (InvestmentImportTests._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
        ])

        artifact = payload["source_artifacts"][0]
        self.assertEqual(artifact["statement_period_start"], "2026-07-01")
        self.assertEqual(artifact["statement_period_end"], "2026-07-03")
        self.assertEqual(artifact["statement_generated_at"], "20260704000100")

    def test_ibkr_gainskeeper_transfer_preserves_zero_cash_and_precision(self) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (
                InvestmentImportTests._ibkr_gainskeeper_transfer_evidence_file(),
                "U00000001_20260101_20260804.gkx",
            ),
        ])

        self.assertEqual(len(payload["transactions"]), 2)
        transfer = next(
            record for record in payload["transactions"]
            if record["quantity_raw"] == "5.0"
        )
        self.assertEqual(transfer["type"], "transfer_out")
        self.assertEqual(transfer["ticker"], "QQQI")
        self.assertEqual(transfer["quantity_raw"], "5.0")
        self.assertEqual(transfer["price_raw"], "52.68")
        self.assertEqual(transfer["net_amount_raw"], "0")
        self.assertFalse(transfer["normalized"]["is_cash_flow"])
        self.assertEqual(transfer["source"]["fitid"], "021223301")
        self.assertEqual(transfer["source"]["transfer_direction"], "out")
        self.assertEqual(transfer["source"]["transfer_account"], "00000002")

    def test_ibkr_gainskeeper_transfer_upgrades_legacy_transfer_without_duplication(
        self,
    ) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files([
            (
                InvestmentImportTests._ibkr_gainskeeper_transfer_evidence_file(),
                "U00000001_20260101_20260804.gkx",
            ),
        ])
        existing = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "source_artifacts": [],
            "transactions": [{
                "date": "2026-07-31",
                "datetime": "2026-07-31 20:00:00",
                "type": "transfer_out",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "ticker": "QQQI",
                "quantity_raw": "5",
                "quantity_abs": "5",
                "gross_amount_raw": "0",
                "commission_raw": "0",
                "net_amount_raw": "0",
                "description": "FOP transfer out: QQQI",
                "source": {
                    "file_kind": "ibkr_transfers",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "row_number": 363,
                    "transfer_direction": "out",
                    "transfer_account": "00000002",
                    "market_value_raw": "-263.40",
                },
                "normalized": {
                    "position_quantity": "5",
                    "display_quantity": "5",
                    "is_cash_flow": False,
                },
            }],
        }

        merged = merge_investment_payloads(existing, incoming)
        transfers = [
            record
            for record in merged["transactions"]
            if record.get("type") == "transfer_out"
        ]
        self.assertEqual(len(transfers), 2)
        matched = next(
            record
            for record in transfers
            if record["quantity_raw"] in {"5", "5.0"}
        )
        self.assertEqual(matched["price_raw"], "52.68")
        self.assertEqual(matched["source"]["fitid"], "021223301")
        self.assertEqual(matched["source"]["source_format"], "ofx_gkx")
        self.assertEqual(matched["source"]["market_value_raw"], "-263.40")
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_ibkr_csv_replaces_matching_web_paste_rounded_fee(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=InvestmentImportTests._ibkr_web_trade_notifications_text(),
        )
        csv_record = {
            "date": "2026-07-29",
            "datetime": "2026-07-29 20:00:00",
            "type": "buy",
            "broker": "ibkr",
            "account": "U***00001",
            "currency": "USD",
            "ticker": "DRAM",
            "quantity_raw": "2",
            "quantity_abs": "2",
            "price_raw": "45.5",
            "gross_amount_raw": "-91",
            "commission_raw": "-0.34746325",
            "commission_abs": "0.34746325",
            "net_amount_raw": "-91.34746325",
            "source": {
                "file_kind": "transactions",
                "account": "U***00001",
                "row_number": 42,
                "has_intraday_timestamp": False,
            },
        }
        csv_payload = {
            "schema_version": "3.0.0",
            "generator": {
                "name": "ibkr_csv_to_investment_json",
                "generated_at": "2026-07-30T12:00:00+00:00",
            },
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {},
            "position_snapshot": {},
            "performance_snapshot": {},
            "transactions": [csv_record],
        }

        merged = merge_investment_payloads(web_payload, csv_payload)
        overlap = [
            record
            for record in merged["transactions"]
            if record.get("ticker") == "DRAM"
            and record.get("quantity_raw") == "2"
            and record.get("price_raw") == "45.5"
        ]

        self.assertEqual(len(overlap), 1)
        self.assertEqual(overlap[0]["source"]["file_kind"], "transactions")
        self.assertEqual(overlap[0]["commission_raw"], "-0.34746325")
        self.assertEqual(overlap[0]["net_amount_raw"], "-91.34746325")
        self.assertNotIn(
            "provisional_until_file_import",
            overlap[0]["source"],
        )
        self.assertNotIn("execution_key", overlap[0]["source"])
        self.assertNotIn("source_timezone", overlap[0]["source"])
        self.assertNotIn("venue", overlap[0]["source"])
        self.assertEqual(len(merged["transactions"]), 6)

    def test_ibkr_csv_pair_rejects_observable_statement_period_contradiction(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        mismatched_positions_csv = positions_csv.replace(
            b"July 1, 2026 - July 3, 2026",
            b"July 1, 2026 - July 4, 2026",
            1,
        )
        with self.assertRaisesRegex(ValueError, "different statement periods"):
            build_investment_payload_from_ibkr_csvs(
                transactions_csv,
                mismatched_positions_csv,
            )

    def test_ibkr_csv_and_gainskeeper_merge_is_order_independent_and_precision_first(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (InvestmentImportTests._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
        ])

        csv_then_gainskeeper = merge_investment_payloads(
            merge_investment_payloads(None, csv_payload),
            gainskeeper_payload,
        )
        gainskeeper_then_csv = merge_investment_payloads(
            merge_investment_payloads(None, gainskeeper_payload),
            csv_payload,
        )

        for merged in (csv_then_gainskeeper, gainskeeper_then_csv):
            trades = [
                record for record in merged["transactions"]
                if record.get("type") == "buy" and record.get("ticker") == "QQQ"
            ]
            self.assertEqual(len(trades), 1)
            self.assertEqual(trades[0]["source"]["file_kind"], "gainskeeper")
            self.assertEqual(trades[0]["datetime"], "2026-07-02 22:33:38")
            self.assertEqual(len(merged["source_artifacts"]), 3)
            ibkr_snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
            self.assertEqual(ibkr_snapshot["position_snapshot_source"], "ibkr_csv_open_positions")
            self.assertEqual(ibkr_snapshot["position_snapshot"]["QQQ"]["cost_basis"], "100")
            self.assertEqual(ibkr_snapshot["performance_snapshot"]["QQQ"]["total"], "10")
            self.assertEqual(len(ibkr_snapshot["evidence"]), 2)

        self.assertEqual(
            csv_then_gainskeeper["transactions"],
            gainskeeper_then_csv["transactions"],
        )
        self.assertEqual(
            csv_then_gainskeeper["broker_snapshots"],
            gainskeeper_then_csv["broker_snapshots"],
        )

    def test_ibkr_merge_rebuilds_realized_summary_from_retained_closed_trades(self) -> None:
        def closed_trade(realized_pnl: str) -> dict[str, object]:
            return {
                "date": "2026-07-21",
                "datetime": "2026-07-21 12:00:00",
                "type": "sell",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "ticker": "DRAM",
                "quantity_raw": "-15",
                "price_raw": "57",
                "broker_realized_pnl_raw": realized_pnl,
                "normalized": {"broker_realized_pnl": realized_pnl},
            }

        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {"performance_snapshot_authoritative": True},
            "performance_snapshot": {},
            "broker_summaries": {
                "ibkr": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "performance_snapshot": {
                        "DRAM": {"realized_total": "408.952041"},
                    },
                    "performance_snapshot_authoritative": True,
                },
            },
            "transactions": [
                closed_trade("224.700059"),
                closed_trade("84.064943"),
                closed_trade("50.718507"),
                closed_trade("49.468532"),
            ],
        }
        latest_csv_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "summary": {
                "performance_snapshot_authoritative": True,
                "performance_snapshot_source": "ibkr_csv_realized_summary",
            },
            "performance_snapshot": {
                "DRAM": {
                    "asset_category": "Stocks",
                    "realized_total": "0",
                    "unrealized_total": "74.064517",
                    "total": "74.064517",
                },
            },
            "broker_summaries": {
                "ibkr": {
                    "broker": "ibkr",
                    "account": "U00000001",
                    "performance_snapshot": {
                        "DRAM": {
                            "asset_category": "Stocks",
                            "realized_total": "0",
                            "unrealized_total": "74.064517",
                            "total": "74.064517",
                        },
                    },
                    "performance_snapshot_authoritative": True,
                },
            },
            "transactions": [],
        }

        for existing, incoming in (
            (existing_payload, latest_csv_payload),
            (latest_csv_payload, existing_payload),
        ):
            merged = merge_investment_payloads(existing, incoming)
            ibkr_snapshot = merged["broker_summaries"]["ibkr"]["performance_snapshot"]["DRAM"]
            self.assertEqual(ibkr_snapshot["realized_total"], "408.952041")
            self.assertEqual(ibkr_snapshot["realized_total_source"], "ibkr_closed_trades")

    def test_ibkr_csv_performance_merges_adjacent_periods_without_overwriting_complete_summary(self) -> None:
        def payload(
            *,
            realized_total: str,
            artifact_sha256: str,
            period_start: str,
            period_end: str,
            transactions: list[dict[str, object]] | None = None,
        ) -> dict[str, object]:
            return {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "summary": {
                    "performance_snapshot_authoritative": True,
                    "performance_snapshot_source": "ibkr_csv_realized_summary",
                },
                "performance_snapshot": {
                    "DRAM": {
                        "asset_category": "Stocks",
                        "realized_total": realized_total,
                        "unrealized_total": "555.781507",
                        "total": "741.30159523",
                    },
                },
                "source_artifacts": [{
                    "sha256": artifact_sha256,
                    "byte_count": 1,
                    "storage_key": artifact_sha256,
                    "filenames": [f"{period_start}_{period_end}.csv"],
                    "source_kind": "ibkr_realized_summary_csv",
                    "statement_period_start": period_start,
                    "statement_period_end": period_end,
                }],
                "transactions": transactions or [],
            }

        historical = payload(
            realized_total="408.95204025",
            artifact_sha256="a" * 64,
            period_start="2026-01-01",
            period_end="2026-07-31",
        )
        current = payload(
            realized_total="185.52008823",
            artifact_sha256="b" * 64,
            period_start="2026-08-03",
            period_end="2026-08-14",
            transactions=[
                {
                    "date": "2026-08-12",
                    "datetime": "2026-08-12 21:56:59",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-10",
                    "price_raw": "55.65",
                },
                {
                    "date": "2026-08-14",
                    "datetime": "2026-08-14 11:05:45",
                    "type": "sell",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "DRAM",
                    "quantity_raw": "-25",
                    "price_raw": "57.7512",
                    "broker_realized_pnl_raw": "159.716076",
                    "normalized": {"broker_realized_pnl": "159.716076"},
                },
            ],
        )

        merged = merge_investment_payloads(historical, current)
        dram = merged["broker_snapshots"]["ibkr:U00000001"]["performance_snapshot"]["DRAM"]

        self.assertEqual(dram["realized_total"], "594.47212848")
        self.assertEqual(
            dram["realized_total_source"],
            "ibkr_csv_cumulative_non_overlapping_periods",
        )

    def test_newer_ibkr_gainskeeper_marks_preserve_existing_csv_cost_basis(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (InvestmentImportTests._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
        ])
        gainskeeper_payload["position_snapshot"]["QQQ"]["as_of"] = "2026-07-04 20:00:00"
        gainskeeper_payload["source_artifacts"][0]["statement_period_end"] = "2026-07-04"
        gainskeeper_payload.pop("broker_snapshots", None)
        gainskeeper_payload.pop("broker_summaries", None)

        merged = merge_investment_payloads(csv_payload, gainskeeper_payload)
        snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
        qqq_snapshot = snapshot["position_snapshot"]["QQQ"]

        self.assertEqual(snapshot["position_snapshot_source"], "ibkr_gainskeeper_positions")
        self.assertEqual(qqq_snapshot["market_value"], "110")
        self.assertEqual(qqq_snapshot["last_price"], "110")
        self.assertEqual(qqq_snapshot["cost_price"], "100")
        self.assertEqual(qqq_snapshot["cost_basis"], "100")
        self.assertEqual(qqq_snapshot["cost_basis_source"], "ibkr_csv_open_positions")
        gainskeeper_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["position_snapshot_source"] == "ibkr_gainskeeper_positions"
        )
        self.assertNotIn("cost_price", gainskeeper_evidence["position_snapshot"]["QQQ"])

    def test_newer_ibkr_gainskeeper_buys_extend_verified_cost_basis(self) -> None:
        baseline_sha256 = "a" * 64
        gainskeeper_sha256 = "b" * 64
        existing = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "source_artifacts": [{
                "sha256": baseline_sha256,
                "storage_key": baseline_sha256,
                "byte_count": 1,
                "filename": "U00000001_20260101_20260803.csv",
                "broker": "ibkr",
                "account": "U00000001",
                "source_kind": "ibkr_realized_summary_csv",
                "statement_period_start": "2026-01-01",
                "statement_period_end": "2026-08-03",
            }],
            "summary": {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_csv_open_positions",
            },
            "position_snapshot": {
                "DRAM": {
                    "quantity": "100",
                    "cost_price": "50.20691954",
                    "cost_basis": "5020.691954",
                    "cost_basis_status": "known",
                    "cost_basis_source": "ibkr_csv_open_positions",
                },
            },
            "performance_snapshot": {},
            "transactions": [],
        }

        def gainskeeper_buy(
            *,
            day: str,
            timestamp: str,
            quantity: str,
            price: str,
            net_amount: str,
            commission: str,
            fitid: str,
        ) -> dict[str, object]:
            return {
                "date": day,
                "datetime": timestamp,
                "type": "buy",
                "broker": "ibkr",
                "account": "U00000001",
                "ticker": "DRAM",
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "price_raw": price,
                "commission_raw": commission,
                "net_amount_raw": net_amount,
                "source": {
                    "file_kind": "gainskeeper",
                    "source_format": "ofx_gkx",
                    "fitid": fitid,
                    "broker": "ibkr",
                    "account": "U00000001",
                },
            }

        incoming = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "source_artifacts": [{
                "sha256": gainskeeper_sha256,
                "storage_key": gainskeeper_sha256,
                "byte_count": 1,
                "filename": "U00000001_20260803_20260810.gkx",
                "broker": "ibkr",
                "account": "U00000001",
                "source_kind": "ibkr_gainskeeper_ofx_gkx",
                "statement_period_start": "2026-07-31",
                "statement_period_end": "2026-08-10",
            }],
            "summary": {
                "position_snapshot_authoritative": True,
                "position_snapshot_source": "ibkr_gainskeeper_positions",
            },
            "position_snapshot": {
                "DRAM": {
                    "quantity": "105",
                    "market_value": "5208",
                    "last_price": "49.6",
                    "as_of": "2026-08-10 20:20:00",
                },
            },
            "performance_snapshot": {},
            "transactions": [
                gainskeeper_buy(
                    day="2026-08-07",
                    timestamp="2026-08-07 10:43:39",
                    quantity="2",
                    price="49",
                    commission="-0.34446325",
                    net_amount="-98.34446325",
                    fitid="TEST-FITID-20260807-1",
                ),
                gainskeeper_buy(
                    day="2026-08-10",
                    timestamp="2026-08-10 00:57:47",
                    quantity="3",
                    price="50",
                    commission="-0.34906625",
                    net_amount="-150.34906625",
                    fitid="TEST-FITID-20260810-1",
                ),
            ],
        }

        merged = merge_investment_payloads(existing, incoming)
        dram = merged["broker_snapshots"]["ibkr:U00000001"][
            "position_snapshot"
        ]["DRAM"]
        self.assertEqual(dram["quantity"], "105")
        self.assertEqual(dram["cost_basis"], "5269.38548350")
        self.assertEqual(dram["cost_basis_status"], "known")
        self.assertEqual(
            dram["cost_basis_source"],
            "ibkr_verified_snapshot_plus_gainskeeper_buys",
        )
        self.assertEqual(
            Decimal(dram["cost_price"]),
            Decimal("5269.38548350") / Decimal("105"),
        )
        repair = dram["cost_basis_repair"]
        self.assertEqual(repair["baseline_snapshot_as_of"], "2026-08-03")
        self.assertEqual(repair["source_window_start"], "2026-07-31")
        self.assertEqual(repair["source_window_end"], "2026-08-10")
        self.assertEqual(repair["source_artifact_sha256"], gainskeeper_sha256)
        self.assertEqual(repair["applied_quantity_raw"], "5")
        self.assertEqual(repair["applied_net_cost_raw"], "248.69352950")
        self.assertEqual(
            repair["applied_transaction_fitids"],
            [
                "TEST-FITID-20260807-1",
                "TEST-FITID-20260810-1",
            ],
        )

        incomplete_window = deepcopy(incoming)
        incomplete_window["source_artifacts"][0][
            "statement_period_start"
        ] = "2026-08-08"
        incomplete_merged = merge_investment_payloads(existing, incomplete_window)
        incomplete_dram = incomplete_merged["broker_snapshots"][
            "ibkr:U00000001"
        ]["position_snapshot"]["DRAM"]
        self.assertNotIn("cost_basis", incomplete_dram)
        self.assertNotIn("cost_price", incomplete_dram)

    def test_newer_ibkr_gainskeeper_quantity_change_does_not_inherit_csv_cost_basis(self) -> None:
        transactions_csv, positions_csv = InvestmentImportTests._ibkr_csv_evidence_pair()
        csv_payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files([
            (InvestmentImportTests._ibkr_gainskeeper_evidence_file(), "mtd.gkx"),
        ])
        gainskeeper_payload["position_snapshot"]["QQQ"]["as_of"] = "2026-07-04 20:00:00"
        gainskeeper_payload["source_artifacts"][0]["statement_period_end"] = "2026-07-04"
        gainskeeper_payload["position_snapshot"]["QQQ"]["quantity"] = "2"
        gainskeeper_payload["position_snapshot"]["QQQ"]["market_value"] = "220"
        gainskeeper_payload.pop("broker_snapshots", None)
        gainskeeper_payload.pop("broker_summaries", None)

        merged = merge_investment_payloads(csv_payload, gainskeeper_payload)
        snapshot = merged["broker_snapshots"]["ibkr:U00000001"]
        qqq_snapshot = snapshot["position_snapshot"]["QQQ"]

        self.assertEqual(snapshot["position_snapshot_source"], "ibkr_gainskeeper_positions")
        self.assertEqual(qqq_snapshot["quantity"], "2")
        self.assertNotIn("cost_price", qqq_snapshot)
        self.assertNotIn("cost_basis", qqq_snapshot)

    def test_hsbc_same_day_portfolio_snapshot_uses_explicit_market_data_update_time(self) -> None:
        def hsbc_payload(*, market_time: str, last_price: str) -> dict[str, object]:
            position = {
                "DRAM": {
                    "asset_category": "Stock",
                    "currency": "USD",
                    "quantity": "200",
                    "cost_price": "60.715",
                    "cost_basis": "12143.000",
                    "market_value": "10120.00",
                    "market": "US",
                    "full_name": "ROUNDHILL MEMORY",
                    "last_price": last_price,
                    "tradable_quantity": "200",
                    "account_number": "000-999999-999",
                }
            }
            return {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [],
                "position_snapshot": position,
                "summary": {
                    "position_snapshot_authoritative": True,
                    "position_snapshot_source": "hsbc_portfolio_text",
                    "hsbc_snapshot": {
                        "portfolio_market_data_updated_at": {
                            "date": "2026-08-07",
                            "time": market_time,
                        }
                    },
                },
                "generator": {"generated_at": f"2026-08-08 {market_time}"},
            }

        existing = hsbc_payload(market_time="16:50:00", last_price="51.440")
        incoming = hsbc_payload(market_time="17:15:00", last_price="50.600")
        merged = merge_investment_payloads(existing, incoming)

        snapshot = merged["broker_snapshots"]["hsbc:000-999999-999"]
        self.assertEqual(snapshot["position_snapshot"]["DRAM"]["last_price"], "50.600")
        selected_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["position_snapshot"]["DRAM"]["last_price"] == "50.600"
        )
        self.assertEqual(selected_evidence["snapshot_updated_at"], "2026-08-07 17:15:00")

    def test_merge_dedupes_ibkr_csv_gainskeeper_stock_trades_with_precision_drift(self) -> None:
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-05-31",
                    "datetime": "2026-05-31 22:33:38",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "84",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-4817.4",
                    "commission_raw": "-0.05771889",
                    "net_amount_raw": "-4817.45771889",
                    "source": {
                        "file_kind": "gainskeeper",
                        "fitid": "TEST-FITID-20260601-1",
                        "account": "U00000001",
                    },
                },
                {
                    "date": "2026-05-31",
                    "datetime": "2026-05-31 22:37:04",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "10",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-573.5",
                    "commission_raw": "-0.03105572",
                    "net_amount_raw": "-573.53105572",
                    "source": {
                        "file_kind": "gainskeeper",
                        "fitid": "TEST-FITID-20260601-2",
                        "account": "U00000001",
                    },
                },
            ],
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-01",
                    "datetime": "2026-06-01 20:00:00",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "84.0",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-4817.4",
                    "commission_raw": "-0.057718885",
                    "net_amount_raw": "-4817.457718885",
                    "source": {
                        "file_kind": "transactions",
                        "row_number": 120,
                        "account": "U00000001",
                    },
                },
                {
                    "date": "2026-06-01",
                    "datetime": "2026-06-01 20:00:00",
                    "type": "buy",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "ticker": "QQQI",
                    "quantity_raw": "10.0",
                    "price_raw": "57.35",
                    "gross_amount_raw": "-573.5",
                    "commission_raw": "-0.031055725",
                    "net_amount_raw": "-573.531055725",
                    "source": {
                        "file_kind": "transactions",
                        "row_number": 111,
                        "account": "U00000001",
                    },
                },
            ],
            "position_snapshot": {
                "QQQI": {
                    "quantity": "250",
                },
            },
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        qqqi_rows = [
            record
            for record in merged["transactions"]
            if record.get("ticker") == "QQQI" and record.get("type") == "buy"
        ]

        self.assertEqual(len(qqqi_rows), 2)
        self.assertEqual(
            sum(Decimal(str(row["quantity_raw"])) for row in qqqi_rows),
            Decimal("94"),
        )
        self.assertTrue(all(row["source"]["file_kind"] == "gainskeeper" for row in qqqi_rows))

    def test_ibkr_closed_trade_metadata_survives_csv_gainskeeper_deduplication(self) -> None:
        def stock_trade(file_kind: str, with_closed_trade: bool) -> dict[str, object]:
            record: dict[str, object] = {
                "date": "2026-06-11",
                "datetime": "2026-06-11 12:01:17",
                "type": "sell",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "ticker": "DRAM",
                "quantity_raw": "-15",
                "price_raw": "61",
                "gross_amount_raw": "915",
                "commission_raw": "-0.35107625",
                "net_amount_raw": "914.64892375",
                "normalized": {
                    "position_quantity": "-15",
                    "unit_price": "61",
                    "net_amount": "914.64892375",
                },
                "source": {
                    "file_kind": file_kind,
                    "account": "U00000001",
                },
            }
            if with_closed_trade:
                record.update({
                    "broker_proceeds_raw": "915",
                    "broker_commission_or_fee_raw": "-0.35107625",
                    "broker_cost_basis_raw": "-689.948866",
                    "broker_realized_pnl_raw": "224.700059",
                })
                record["normalized"] = {
                    **record["normalized"],
                    "broker_proceeds": "915",
                    "broker_commission_or_fee": "-0.35107625",
                    "broker_cost_basis": "-689.948866",
                    "broker_realized_pnl": "224.700059",
                }
                record["source"] = {
                    **record["source"],
                    "closed_lot_id": "ibkr-realized-summary-row-335",
                }
            return record

        csv_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [stock_trade("transactions", True)],
        }
        gainskeeper_payload = {
            "schema_version": "3.0.0",
            "generator": {"name": "ibkr_gainskeeper_ofx_to_investment_json"},
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [stock_trade("gainskeeper", False)],
        }

        for existing_payload, incoming_payload in (
            (gainskeeper_payload, csv_payload),
            (csv_payload, gainskeeper_payload),
        ):
            merged = merge_investment_payloads(existing_payload, incoming_payload)
            dram_sell = next(
                record for record in merged["transactions"]
                if record.get("ticker") == "DRAM" and record.get("type") == "sell"
            )
            self.assertEqual(dram_sell["source"]["file_kind"], "gainskeeper")
            self.assertEqual(dram_sell["broker_realized_pnl_raw"], "224.700059")
            self.assertEqual(
                dram_sell["normalized"]["broker_realized_pnl"],
                "224.700059",
            )
            self.assertEqual(
                dram_sell["source"]["closed_lot_id"],
                "ibkr-realized-summary-row-335",
            )

    def test_ibkr_import_attaches_broker_summary_with_ending_cash(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,20.16",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-06-23,U***00001,FX Translations P&L,Adjustment,-,-,-,-,-3.763192093151087,-,-3.763192093151087",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["ending_cash"], "20.16")
        self.assertEqual(payload["broker_summaries"]["ibkr"]["ending_cash"], "20.16")
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["calibration_source"],
            "ibkr_csv_summary",
        )

    def test_ibkr_csv_cash_snapshot_exposes_reported_and_replay_boundaries(self) -> None:
        transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Statement,Data,Period,August 3, 2026 - August 11, 2026",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,456.789012",
            "Summary,Data,Ending Cash,123.456789",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-08-10,U***00001,ROUNDHILL MEMORY ETF,Buy,DRAM,3,50,USD,-150,-0.34906625,-150.34906625",
        ]) + "\n"
        positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Statement,Data,Period,August 3, 2026 - August 11, 2026",
            "Trades,Header,Asset Category,Symbol",
        ]) + "\n"

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["summary"]["starting_cash_as_of"], "2026-08-03")
        self.assertEqual(payload["summary"]["ending_cash_as_of"], "2026-08-11")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of"],
            "2026-08-10",
        )
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["ending_cash_replay_as_of"],
            "2026-08-10",
        )

    def test_merge_preserves_per_broker_ending_cash_when_mixed(self) -> None:
        ibkr_transactions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Transaction History",
            "Summary,Header,Field Name,Field Value",
            "Summary,Data,Starting Cash,0",
            "Summary,Data,Ending Cash,20.16",
            "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
            "Transaction History,Data,2026-06-23,U***00001,FX Translations P&L,Adjustment,-,-,-,-,-3.763192093151087,-,-3.763192093151087",
        ]) + "\n"
        ibkr_positions_csv = "\n".join([
            "Statement,Header,Field Name,Field Value",
            "Statement,Data,Title,Realized Summary",
            "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
            "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
            "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
            "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
        ]) + "\n"
        ibkr_payload = build_investment_payload_from_ibkr_csvs(
            ibkr_transactions_csv.encode("utf-8"),
            ibkr_positions_csv.encode("utf-8"),
        )
        hsbc_payload = {
            "schema_version": 3,
            "broker": "hsbc",
            "account": "000-999999-999",
            "ending_cash": "12437.24",
            "summary": {
                "ending_cash_raw": "12437.24",
                "cash_snapshot_source": "hsbc_usd_savings_available_balance",
            },
            "transactions": [
                {
                    "date": "2026-06-24",
                    "type": "deposit",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "currency": "USD",
                    "net_amount_raw": "2200.88",
                    "source": {
                        "broker": "hsbc",
                        "available_cash_after_raw": "12437.24",
                    },
                },
            ],
        }

        merged = merge_investment_payloads(ibkr_payload, hsbc_payload)

        self.assertIsNone(merged.get("ending_cash"))
        self.assertEqual(merged["broker_summaries"]["ibkr"]["ending_cash"], "20.16")
        self.assertEqual(merged["broker_summaries"]["hsbc"]["ending_cash"], "12437.24")
        self.assertTrue(merged["summary"]["incremental_import"]["mixed_brokers_or_accounts"])

    def test_futuhk_statement_pdf_import_parses_trades_and_cash_flows(self) -> None:
        feb_pdf = Path("/Users/example/Desktop/IBKR/FUTU-TEST-ACCOUNT-2-202302-1782351318670.pdf")
        mar_pdf = Path("/Users/example/Desktop/IBKR/FUTU-TEST-ACCOUNT-2-202303-1782351300183.pdf")
        if not feb_pdf.exists() or not mar_pdf.exists():
            self.skipTest("Local Futu (HK) statement PDF fixtures are unavailable.")

        payload = build_investment_payload_from_futuhk_statement_pdfs(
            [
                (feb_pdf.read_bytes(), feb_pdf.name),
                (mar_pdf.read_bytes(), mar_pdf.name),
            ]
        )

        self.assertEqual(payload["broker"], "futuhk")
        self.assertEqual(payload["account"], "FUTU-TEST-ACCOUNT")
        self.assertEqual(payload["summary"]["statement_count"], 2)

        trade_types = {
            (txn.get("ticker"), txn.get("type"))
            for txn in payload["transactions"]
            if txn.get("type") in {"buy", "sell"}
        }
        self.assertIn(("MSFT.US", "buy"), trade_types)
        self.assertIn(("SPLG.US", "buy"), trade_types)
        self.assertIn(("TSM.US", "buy"), trade_types)
        self.assertIn(("MSFT.US", "sell"), trade_types)
        self.assertIn(("SPLG.US", "sell"), trade_types)

        transfer_rows = [
            txn
            for txn in payload["transactions"]
            if "TRANSFER FROM HK STOCKS ACCOUNT" in str(txn.get("description", "")).upper()
        ]
        self.assertGreaterEqual(len(transfer_rows), 1)

        dividend_rows = [
            txn
            for txn in payload["transactions"]
            if txn.get("type") == "dividend"
        ]
        self.assertGreaterEqual(len(dividend_rows), 1)

    def test_futuhk_hk_stocks_account_transfers_are_marked_as_internal(self) -> None:
        internal_transfer = {
            "date": "2023-02-16",
            "type": "deposit",
            "broker": "futuhk",
            "account": "FUTU-TEST-ACCOUNT",
            "currency": "USD",
            "description": "TRANSFER FROM HK STOCKS ACCOUNT (HKD -> USD 7.86473)",
            "net_amount_raw": "1271.50",
            "normalized": {"net_amount": "1271.50"},
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "statement_order_id": "48132654",
            },
        }
        ordinary_futu_deposit = {
            **internal_transfer,
            "description": "Deposit from an external bank",
            "source": {"file_kind": "futuhk_statement_pdf", "statement_order_id": "26037902"},
        }
        non_futu_transfer = {
            **internal_transfer,
            "broker": "hsbc",
            "source": {"file_kind": "hsbc_statement_cash", "statement_order_id": "26037903"},
        }

        payload = normalize_investment_payload_tickers({
            "broker": "multiple",
            "account": "multiple",
            "transactions": [internal_transfer, ordinary_futu_deposit, non_futu_transfer],
        })

        normalized_internal = payload["transactions"][0]
        self.assertEqual(
            normalized_internal["internal_transfer_scope"],
            "futuhk_hk_stocks_account",
        )
        self.assertTrue(normalized_internal["internal_transfer_external_flow_excluded"])
        self.assertEqual(
            normalized_internal["source"]["internal_transfer_scope"],
            "futuhk_hk_stocks_account",
        )
        self.assertNotIn("internal_transfer_scope", payload["transactions"][1])
        self.assertNotIn("internal_transfer_scope", payload["transactions"][2])

    @staticmethod
    def _synthetic_bochk_statement_text(
        *,
        statement_date: str,
        transaction_date: str,
        hkd_ending: str = "0.00",
        hkd_current_ending: str | None = None,
        cny_ending: str = "100.00",
        usd_ending: str = "12.34",
    ) -> str:
        hkd_withdrawal = f"{Decimal('100.00') - Decimal(hkd_ending):.2f}"
        hkd_current_section = ""
        if hkd_current_ending is not None:
            hkd_current_section = f"""

HKD Current (453-565-1-629733-6)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
{transaction_date}   Transfer                                                  {hkd_current_ending}                                                  {hkd_current_ending}
             FPS/HSBC/REF-CURRENT
{statement_date}   Balance Carried Forward                                                                                                  {hkd_current_ending}
"""
        return f"""BOCHK Consolidated Statement
i-Free Banking Customer No           65640001
Statement Date                        {statement_date}
Account Transaction Details

Savings Account
HKD Savings (454-049-4-235541-0)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
{transaction_date}   ATM Cash                                                 100.00                                                  100.00
             ATM DEP
{transaction_date}   ATM Cash                                                                               {hkd_withdrawal}                        {hkd_ending}
             ATM
{statement_date}   Balance Carried Forward                                                                                                  {hkd_ending}
{hkd_current_section}

Foreign Currency Savings (255-449-9-034545-0)
Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency
             CNY
{transaction_date}   Transfer                                                  {cny_ending}                                                  {cny_ending}
             FPS/WU/REF-CNY
{statement_date}   Balance Carried Forward                                                                                                  {cny_ending}

Foreign Currency Savings (255-449-9-034545-0)
Date         Transaction Details                                                           Deposit                    Withdrawal Balance in Original Currency
             USD
{transaction_date}   Transfer                                                  {usd_ending}                                                  {usd_ending}
             REMIT IN/REF-USD
{statement_date}   Balance Carried Forward                                                                                                  {usd_ending}

US Securities Account Withdrawals / Deposits of Cash Balance (012-687-63-34193-9)
Transaction Date              Summary                                                                      Deposit / (Withdrawal)                                Net Balance
 {transaction_date}                   B/F                                                        USD                                  0.0000   USD                            0.0000
 {statement_date}                   C/F                                                        USD                                  0.0000   USD                            0.0000
        Important Notes
"""

    def test_bochk_right_aligned_withdrawal_is_classified_by_flow_column(self) -> None:
        pdf_bytes = b"bochk-right-aligned-withdrawal"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        lines = text.splitlines()
        replacement = (
            "2026/07/01   ATM Cash"
            + " " * (106 - len("2026/07/01   ATM Cash"))
            + "100.00"
            + " " * (130 - 112)
            + "0.00"
        )
        replaced = False
        atm_cash_occurrences = 0
        for index, line in enumerate(lines):
            if line.startswith("2026/07/01   ATM Cash"):
                atm_cash_occurrences += 1
            if atm_cash_occurrences == 2 and not replaced:
                lines[index] = replacement
                replaced = True
        self.assertTrue(replaced)

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): "\n".join(lines)},
        )
        hkd_rows = [row for row in payload["transactions"] if row["currency"] == "HKD"]
        self.assertEqual(len(hkd_rows), 2)
        self.assertEqual(
            [row["type"] for row in hkd_rows],
            ["deposit", "withdrawal"],
        )
        self.assertEqual(hkd_rows[-1]["net_amount_raw"], "-100.00")

    def test_bochk_composite_page_headers_cannot_extend_transaction_descriptions(self) -> None:
        pdf_bytes = b"bochk-composite-header"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "             ATM DEP\n2026/07/01   ATM Cash",
            "             ATM DEP\n"
            "ACCOUNT HOLDER\n"
            "DEMO ACCOUNT HOLDER                                      Consolidated Statement\n"
            "Enrich Banking Customer No                       65640001\n"
            "Statement Date                                  2026/07/31\n"
            "Page                                            2/4\n"
            "Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency\n"
            "2026/07/01   ATM Cash",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        descriptions = " ".join(str(row["description"]) for row in payload["transactions"]).upper()
        for marker in (
            "ACCOUNT HOLDER",
            "CONSOLIDATED STATEMENT",
            "CUSTOMER NO",
            "STATEMENT DATE",
            "PAGE",
        ):
            self.assertNotIn(marker, descriptions)

    def test_bochk_page_opening_balance_does_not_replace_statement_opening(self) -> None:
        pdf_bytes = b"bochk-page-opening-balance"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "             ATM DEP\n2026/07/01   ATM Cash",
            "             ATM DEP\n"
            "Date         Transaction Details                                        Deposit                     Withdrawal Balance in Original Currency\n"
            "2026/07/01   Balance Brought Forward                                                                                                  100.00\n"
            "2026/07/01   ATM Cash",
            1,
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        hkd_balance = next(
            balance
            for balance in payload["bochk_subaccount_balances"].values()
            if balance["currency"] == "HKD"
        )
        self.assertEqual(hkd_balance["starting"], "0.00")
        self.assertEqual(hkd_balance["ending"], "0.00")

    def test_bochk_undated_amount_row_fails_closed(self) -> None:
        pdf_bytes = b"bochk-undated-amount-row"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        lines = text.splitlines()
        atm_cash_occurrences = 0
        replaced = False
        for index, line in enumerate(lines):
            if line.startswith("2026/07/01   ATM Cash"):
                atm_cash_occurrences += 1
            if atm_cash_occurrences == 2 and not replaced:
                lines[index] = " " * 10 + line[10:]
                replaced = True
        self.assertTrue(replaced)

        with self.assertRaisesRegex(ValueError, "undated amount row"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 6734.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): "\n".join(lines)},
            )

    def test_bochk_balance_continuity_rejects_unreconciled_rows(self) -> None:
        pdf_bytes = b"bochk-balance-continuity"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        ).replace(
            "2026/07/01   ATM Cash                                                 100.00                                                  100.00",
            "2026/07/01   ATM Cash                                                 100.00                                                  101.00",
            1,
        )
        with self.assertRaisesRegex(ValueError, "balance continuity"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 6734.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): text},
            )

    def test_bochk_statement_import_preserves_parent_and_subaccount_identity(self) -> None:
        first_bytes = b"bochk-june-statement"
        second_bytes = b"bochk-july-statement"
        first_text = self._synthetic_bochk_statement_text(
            statement_date="2026/06/30",
            transaction_date="2026/06/01",
        )
        second_text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [
                (first_bytes, "Jun 2637.pdf"),
                (second_bytes, "Jul 6734.pdf"),
            ],
            _extracted_text_by_payload_id={
                id(first_bytes): first_text,
                id(second_bytes): second_text,
            },
        )

        self.assertEqual(payload["broker"], "boc_hk")
        self.assertEqual(payload["account"], "65640001")
        self.assertEqual(payload["summary"]["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "25.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(len(payload["source_artifacts"]), 2)
        self.assertEqual(
            {row["source"]["account_number_short"] for row in payload["transactions"]},
            {"0066", "0079"},
        )
        self.assertEqual(
            {
                (row["source"]["account_number_short"], row["currency"])
                for row in payload["transactions"]
            },
            {("0066", "HKD"), ("0079", "CNH"), ("0079", "USD")},
        )
        self.assertTrue(all(row["account"] == "65640001" for row in payload["transactions"]))

    def test_bochk_statement_import_preserves_hkd_current_and_canonicalizes_cnh(self) -> None:
        pdf_bytes = b"bochk-current-account-statement"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            hkd_current_ending="30.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )

        current_rows = [
            row
            for row in payload["transactions"]
            if row["source"].get("account_type") == "HKD Current"
        ]
        self.assertEqual(len(current_rows), 1)
        self.assertEqual(current_rows[0]["currency"], "HKD")
        self.assertEqual(current_rows[0]["source"]["account_number_short"], "0451")
        self.assertEqual(current_rows[0]["source"]["statement_currency_raw"], "HKD")
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "55.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(
            {
                (value["account_number_short"], value["currency"])
                for value in payload["bochk_subaccount_balances"].values()
            },
            {
                ("0066", "HKD"),
                ("0451", "HKD"),
                ("0079", "CNH"),
                ("0079", "USD"),
            },
        )

    def test_bochk_cnh_binding_migrates_a_persisted_cny_key(self) -> None:
        bochk_source = {
            "date": "2026-07-01",
            "type": "deposit",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "CNY",
            "description": "BOCHK CNH funding",
            "net_amount_raw": "200.00",
            "source": {
                "broker": "boc_hk",
                "file_kind": "boc_hk_statement_pdf",
                "account_number": "255-449-9-034545-0",
                "account_number_short": "0079",
                "account_type": "Foreign Currency Savings",
                "statement_currency_raw": "CNY",
            },
        }
        hsbc_target = {
            "date": "2026-07-01",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "CNH",
            "description": "Transfer to BOCHK",
            "net_amount_raw": "-200.00",
            "source": {"broker": "hsbc", "file_kind": "hsbc_cash_statement"},
        }
        old_source_key = build_investment_internal_transfer_binding_key(bochk_source)
        target_key = build_investment_internal_transfer_binding_key(hsbc_target)

        payload = normalize_investment_payload_tickers({
            "schema_version": 3,
            "broker": "multiple",
            "account": "multiple",
            "transactions": [bochk_source, hsbc_target],
            "manual_internal_transfer_bindings": {old_source_key: target_key},
            "manual_internal_transfer_ignored_source_keys": [old_source_key],
        })

        normalized_source = payload["transactions"][0]
        canonical_source_key = build_investment_internal_transfer_binding_key(
            normalized_source
        )
        self.assertEqual(normalized_source["currency"], "CNH")
        self.assertEqual(
            normalized_source["source"]["statement_currency_raw"],
            "CNY",
        )
        self.assertEqual(
            payload["manual_internal_transfer_bindings"],
            {canonical_source_key: target_key},
        )
        self.assertEqual(
            payload["manual_internal_transfer_ignored_source_keys"],
            [canonical_source_key],
        )
        source, target = validate_investment_internal_transfer_binding(
            payload["transactions"],
            canonical_source_key,
            target_key,
        )
        self.assertEqual(source["currency"], "CNH")
        self.assertEqual(target["currency"], "CNH")

    def test_bochk_statement_batches_merge_without_losing_periods_or_balances(self) -> None:
        first_bytes = b"bochk-batch-one"
        second_bytes = b"bochk-batch-two"
        first_text = self._synthetic_bochk_statement_text(
            statement_date="2026/06/30",
            transaction_date="2026/06/01",
        )
        second_text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
            hkd_ending="25.00",
            cny_ending="200.00",
            usd_ending="20.00",
        )
        first = build_investment_payload_from_bochk_statement_pdfs(
            [(first_bytes, "Jun 2637.pdf")],
            _extracted_text_by_payload_id={id(first_bytes): first_text},
        )
        second = build_investment_payload_from_bochk_statement_pdfs(
            [(second_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={id(second_bytes): second_text},
        )

        merged = merge_investment_payloads(first, second)
        reimported = merge_investment_payloads(merged, second)

        self.assertEqual(merged["summary"]["statement_count"], 2)
        self.assertEqual(
            merged["summary"]["statement_periods"],
            ["2026-06", "2026-07"],
        )
        self.assertEqual(merged["summary"]["statement_date_min"], "2026-06-30")
        self.assertEqual(merged["summary"]["statement_date_max"], "2026-07-31")
        self.assertEqual(
            merged["ending_cash_by_currency"],
            {"HKD": "25.00", "CNH": "200.00", "USD": "20.00"},
        )
        self.assertEqual(len(merged["source_artifacts"]), 2)
        self.assertEqual(len(reimported["transactions"]), len(merged["transactions"]))
        self.assertEqual(len(reimported["source_artifacts"]), 2)
        self.assertEqual(reimported["summary"]["statement_count"], 2)

    def test_bochk_metadata_survives_a_mixed_ledger_merge(self) -> None:
        june_bytes = b"bochk-mixed-june"
        july_bytes = b"bochk-mixed-july"
        june = build_investment_payload_from_bochk_statement_pdfs(
            [(june_bytes, "Jun 2637.pdf")],
            _extracted_text_by_payload_id={
                id(june_bytes): self._synthetic_bochk_statement_text(
                    statement_date="2026/06/30",
                    transaction_date="2026/06/01",
                ),
            },
        )
        july = build_investment_payload_from_bochk_statement_pdfs(
            [(july_bytes, "Jul 6734.pdf")],
            _extracted_text_by_payload_id={
                id(july_bytes): self._synthetic_bochk_statement_text(
                    statement_date="2026/07/31",
                    transaction_date="2026/07/01",
                    hkd_ending="25.00",
                    cny_ending="200.00",
                    usd_ending="20.00",
                ),
            },
        )
        ibkr = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [{
                "date": "2026-05-01",
                "type": "deposit",
                "broker": "ibkr",
                "account": "U00000001",
                "currency": "USD",
                "gross_amount_raw": "1.00",
                "net_amount_raw": "1.00",
                "source": {"file_kind": "transactions"},
            }],
        }

        mixed = merge_investment_payloads(ibkr, june)
        mixed = merge_investment_payloads(mixed, july)

        self.assertEqual(mixed["broker"], "multiple")
        self.assertEqual(mixed["summary"]["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(mixed["summary"]["statement_count"], 2)
        self.assertTrue(mixed["bochk_subaccount_balances"])
        bochk_summary = mixed["broker_summaries"]["boc_hk"]
        self.assertEqual(bochk_summary["statement_periods"], ["2026-06", "2026-07"])
        self.assertEqual(bochk_summary["statement_count"], 2)
        self.assertTrue(bochk_summary["bochk_subaccount_balances"])

    def test_bochk_statement_import_preserves_repeated_same_shape_rows_and_deduplicates_reupload(self) -> None:
        pdf_bytes = b"bochk-feb-statement"
        text = self._synthetic_bochk_statement_text(
            statement_date="2023/02/28",
            transaction_date="2023/02/11",
            hkd_ending="0.00",
            cny_ending="0.00",
            usd_ending="0.00",
        )
        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Feb 6243.pdf"), (pdf_bytes, "Feb 6243.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): text},
        )
        hkd_rows = [
            row
            for row in payload["transactions"]
            if row["currency"] == "HKD" and row["source"]["account_number_short"] == "0066"
        ]

        self.assertEqual(len(hkd_rows), 2)
        self.assertEqual(payload["summary"]["duplicate_statement_row_count"], 4)
        self.assertEqual(
            hashlib.sha256(pdf_bytes).hexdigest(),
            payload["source_artifacts"][0]["sha256"],
        )

    def test_bochk_statement_import_rejects_nonzero_securities_cash_activity(self) -> None:
        pdf_bytes = b"bochk-securities-cash"
        text = self._synthetic_bochk_statement_text(
            statement_date="2026/07/31",
            transaction_date="2026/07/01",
        ).replace("USD                                  0.0000   USD                            0.0000", "USD                                100.0000   USD                          100.0000")

        with self.assertRaisesRegex(ValueError, "non-zero securities-account cash activity"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(pdf_bytes, "Jul 6734.pdf")],
                _extracted_text_by_payload_id={id(pdf_bytes): text},
            )

    def test_bochk_statement_parser_rejects_empty_or_unidentified_source_files(self) -> None:
        with self.assertRaisesRegex(ValueError, "is empty"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"", "Jul 6734.pdf")],
            )

        with self.assertRaisesRegex(ValueError, "non-empty filename"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"pdf", "")],
            )

        with self.assertRaisesRegex(ValueError, r"must use a \.pdf filename"):
            build_investment_payload_from_bochk_statement_pdfs(
                [(b"pdf", "Jul 2026.txt")],
            )

    def test_bochk_balance_only_statement_preserves_cash_balances(self) -> None:
        pdf_bytes = b"bochk-balance-only-statement"
        statement_date = "2026/07/31"
        transaction_date = "2026/07/01"
        statement_text = self._synthetic_bochk_statement_text(
            statement_date=statement_date,
            transaction_date=transaction_date,
            hkd_ending="50.00",
            cny_ending="100.00",
            usd_ending="12.34",
        )
        balance_only_text = "\n".join(
            line
            for line in statement_text.splitlines()
            if not line.lstrip().startswith(transaction_date)
        )

        payload = build_investment_payload_from_bochk_statement_pdfs(
            [(pdf_bytes, "Jul 2026 balance-only.pdf")],
            _extracted_text_by_payload_id={id(pdf_bytes): balance_only_text},
        )

        self.assertEqual(payload["transactions"], [])
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"HKD": "50.00", "CNH": "100.00", "USD": "12.34"},
        )
        self.assertEqual(
            {
                (value["account_number_short"], value["currency"])
                for value in payload["bochk_subaccount_balances"].values()
            },
            {("0066", "HKD"), ("0079", "CNH"), ("0079", "USD")},
        )
        self.assertTrue(
            any(
                "No BOCHK deposit-account transactions" in warning
                for warning in payload["summary"]["warnings"]
            )
        )

    def test_mixed_broker_merge_supersedes_stale_ibkr_grants(self) -> None:
        existing_payload = {
            "schema_version": 3,
            "broker": "hsbc",
            "account": "000-999999-999",
            "transactions": [
                {
                    "date": "2026-01-29",
                    "type": "grant",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "ticker": "IBKR",
                    "quantity_raw": "3.25",
                    "source": {"file_kind": "positions", "row_number": 48},
                },
                {
                    "date": "2026-06-24",
                    "type": "deposit",
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "currency": "USD",
                    "net_amount_raw": "100.00",
                    "source": {"file_kind": "hsbc_usd_account_text"},
                },
            ],
        }
        incoming_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-01-29",
                    "type": "grant",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "ticker": "IBKR",
                    "quantity_raw": "4.25",
                    "source": {"file_kind": "positions", "row_number": 43},
                }
            ],
            "position_snapshot": {
                "IBKR": {"quantity": "4.25"},
            },
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        ibkr_grants = [
            txn
            for txn in merged["transactions"]
            if txn.get("broker") == "ibkr" and txn.get("type") == "grant" and txn.get("ticker") == "IBKR"
        ]

        self.assertEqual(len(ibkr_grants), 1)
        self.assertEqual(ibkr_grants[0]["quantity_raw"], "4.25")
        self.assertTrue(merged["summary"]["incremental_import"]["mixed_brokers_or_accounts"])

    def test_merge_keeps_latest_account_fx_translation_pnl_from_overlapping_imports(self) -> None:
        existing_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-22",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "1.25",
                    "source": {"file_kind": "transactions", "row_number": 10},
                },
                {
                    "date": "2026-06-23",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "-3.763192093151087",
                    "source": {"file_kind": "transactions", "row_number": 11},
                },
            ],
        }
        incoming_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-23",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "-4.500000000000000",
                    "source": {"file_kind": "transactions", "row_number": 11},
                },
                {
                    "date": "2026-06-24",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "4.8999016067416505",
                    "source": {"file_kind": "transactions", "row_number": 15},
                },
            ],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        fx_rows = [
            txn
            for txn in merged["transactions"]
            if txn.get("type") == "fx_translation_pnl"
        ]

        self.assertEqual(
            {txn["date"]: txn["net_amount_raw"] for txn in fx_rows},
            {
                "2026-06-24": "4.8999016067416505",
            },
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["superseded_fx_translation_pnl_count"],
            3,
        )

    def test_merge_collapses_duplicate_fx_translation_pnl_slots_from_prior_imports(self) -> None:
        existing_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-23",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "-3.763192093151087",
                    "source": {"file_kind": "transactions", "row_number": 11},
                },
                {
                    "date": "2026-06-23",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "-4.000000000000000",
                    "source": {"file_kind": "transactions", "row_number": 99},
                },
            ],
        }
        incoming_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [
                {
                    "date": "2026-06-23",
                    "type": "fx_translation_pnl",
                    "broker": "ibkr",
                    "account": "U00000001",
                    "currency": "USD",
                    "description": "FX Translations P&L",
                    "net_amount_raw": "-4.500000000000000",
                    "source": {"file_kind": "transactions", "row_number": 11},
                },
            ],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        fx_rows = [
            txn
            for txn in merged["transactions"]
            if txn.get("type") == "fx_translation_pnl" and txn.get("date") == "2026-06-23"
        ]

        self.assertEqual(len(fx_rows), 1)
        self.assertEqual(fx_rows[0]["net_amount_raw"], "-4.500000000000000")
        self.assertEqual(
            merged["summary"]["incremental_import"]["superseded_fx_translation_pnl_count"],
            2,
        )

    def test_ibkr_overlapping_import_dedupes_forex_trade_component_despite_legacy_currency(self) -> None:
        forex_row = {
            "date": "2026-06-01",
            "type": "forex_trade_component",
            "broker": "ibkr",
            "account": "U00000001",
            "ticker": "USD.CNH",
            "description": "Net Amount in Base from Forex Trade: 2,955.21 USD.CNH",
            "quantity_raw": "2955.21",
            "price_raw": "6.7677",
            "gross_amount_raw": "-3.1862626669403653",
            "commission_raw": "-2.0",
            "net_amount_raw": "-3.1862626669403653",
            "source": {
                "file_kind": "transactions",
                "row_number": 114,
                "transaction_type_raw": "Forex Trade Component",
                "account": "U00000001",
            },
        }
        existing_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [{**forex_row, "currency": "CNH"}],
        }
        incoming_payload = {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U00000001",
            "transactions": [{**forex_row, "currency": "USD", "source": {**forex_row["source"], "row_number": 115}}],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        forex_rows = [
            txn
            for txn in merged["transactions"]
            if txn.get("type") == "forex_trade_component" and txn.get("date") == "2026-06-01"
        ]

        self.assertEqual(len(forex_rows), 1)
        self.assertEqual(forex_rows[0]["currency"], "USD")
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_manual_xlsx_source_row_dedupe_preserves_user_enrichment(self) -> None:
        source = {
            "file_kind": "manual_investment_xlsx",
            "source_file_sha256": "a" * 64,
            "source_sheet": "Transactions",
            "source_row": 9,
            "broker": "cmb_cn",
            "account": "3645 1536 0174 9792",
        }
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "cmb_cn",
            "account": "3645 1536 0174 9792",
            "transactions": [{
                "date": "2024-04-01",
                "datetime": "2024-04-01 11:00:00",
                "type": "virtual_balance_reset",
                "broker": "cmb_cn",
                "account": "3645 1536 0174 9792",
                "currency": "CNY",
                "gross_amount_raw": "-21511.9",
                "net_amount_raw": "-21511.9",
                "description": "Manual virtual balance reset to CNY 0.00",
                "source": {
                    **source,
                    "virtual_balance_reset_not_real_world_transaction": True,
                },
            }],
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "cmb_cn",
            "account": "3645 1536 0174 9792",
            "transactions": [{
                "date": "2024-04-01",
                "datetime": "2024-04-01 11:00:00",
                "type": "withdrawal",
                "broker": "cmb_cn",
                "account": "3645 1536 0174 9792",
                "currency": "CNY",
                "gross_amount_raw": "-21511.9",
                "net_amount_raw": "-21511.9",
                "description": "",
                "source": source,
            }],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)

        self.assertEqual(len(merged["transactions"]), 1)
        record = merged["transactions"][0]
        self.assertEqual(record["type"], "virtual_balance_reset")
        self.assertEqual(record["description"], "Manual virtual balance reset to CNY 0.00")
        self.assertTrue(record["source"]["virtual_balance_reset_not_real_world_transaction"])
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_manual_transfer_identity_survives_import_presentation_changes(self) -> None:
        gainskeeper_record = {
            "date": "2026-05-29",
            "type": "deposit",
            "broker": "ibkr",
            "account": "U00000001",
            "currency": "USD",
            "net_amount_raw": "400",
            "description": "Electronic Fund Transfer",
            "source": {
                "file_kind": "gainskeeper",
                "row_number": 279,
            },
        }
        legacy_import_record = {
            **gainskeeper_record,
            "account": "U*****00001",
            "currency": "",
            "net_amount_raw": "400.00",
            "description": "Cash deposit",
            "source": {
                "file_kind": "ibkr_legacy_report",
                "row_number": 14,
            },
        }

        self.assertEqual(
            build_investment_internal_transfer_binding_key(gainskeeper_record),
            build_investment_internal_transfer_binding_key(legacy_import_record),
        )

    def test_manual_transfer_binding_migrates_and_survives_incremental_merge(self) -> None:
        source_record = {
            "date": "2026-05-29",
            "type": "deposit",
            "broker": "ibkr",
            "account": "U00000001",
            "currency": "USD",
            "net_amount_raw": "400",
            "description": "Electronic Fund Transfer",
            "source": {
                "file_kind": "gainskeeper",
                "row_number": 279,
            },
        }
        target_record = {
            "date": "2026-05-29",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "USD",
            "net_amount_raw": "-400.00",
            "description": "HK711493P6025013",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "reference_id": "HK711493P6025013",
            },
        }
        legacy_source_key = (
            "ibkr|U00000001|2026-05-29|deposit|USD|400|"
            "Electronic Fund Transfer|gainskeeper|279"
        )
        legacy_target_key = (
            "hsbc|000-999999-999|2026-05-29|withdrawal|USD|-400.00|"
            "HK711493P6025013|hsbc_usd_account_text|HK711493P6025013"
        )
        existing_payload = normalize_investment_payload_tickers({
            "schema_version": 3,
            "broker": "multiple",
            "account": "multiple",
            "transactions": [source_record, target_record],
            "manual_internal_transfer_bindings": {
                legacy_source_key: legacy_target_key,
            },
            "manual_internal_transfer_ignored_source_keys": [
                build_investment_internal_transfer_binding_key(source_record),
            ],
        })
        stable_binding = {
            build_investment_internal_transfer_binding_key(source_record):
                build_investment_internal_transfer_binding_key(target_record),
        }

        self.assertEqual(
            existing_payload["manual_internal_transfer_bindings"],
            stable_binding,
        )
        self.assertEqual(
            existing_payload["manual_internal_transfer_ignored_source_keys"],
            [build_investment_internal_transfer_binding_key(source_record)],
        )

        merged = merge_investment_payloads(existing_payload, {
            "schema_version": 3,
            "broker": "ibkr",
            "account": "U*****00001",
            "transactions": [{
                **source_record,
                "account": "U*****00001",
                "currency": "",
                "net_amount_raw": "400.00",
                "description": "Cash deposit",
                "source": {
                    "file_kind": "ibkr_legacy_report",
                    "row_number": 14,
                },
            }],
        })

        self.assertEqual(
            merged["manual_internal_transfer_bindings"],
            stable_binding,
        )
        self.assertEqual(
            merged["manual_internal_transfer_ignored_source_keys"],
            [build_investment_internal_transfer_binding_key(source_record)],
        )

    def test_duplicate_manual_transfer_rows_use_row_identity_and_fail_closed_for_old_key(self) -> None:
        source_record = {
            "date": "2023-02-20",
            "type": "deposit",
            "broker": "usmart_hk",
            "account": "94412536",
            "currency": "HKD",
            "net_amount_raw": "100.00",
            "description": "eDDA Cash Deposit",
            "source": {
                "file_kind": "usmart_hk_statement_pdf",
                "source_filename": "20230301-94412536.pdf",
                "row_number": 29,
            },
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
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_filename": "eStatementFile_723330.pdf",
                    "row_number": 31,
                    "reference_id": "TO USMART T453910QU272(09FEB02)",
                },
            },
            {
                "date": "2023-02-20",
                "type": "withdrawal",
                "broker": "hsbc",
                "account": "000-999999-999",
                "currency": "HKD",
                "net_amount_raw": "-100.00",
                "description": "DEMO ACCOUNT HOLDER REF00000000000000 18FEB",
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_filename": "eStatementFile_723330.pdf",
                    "row_number": 33,
                    "reference_id": "DEMO ACCOUNT HOLDER REF00000000000000 18FEB",
                },
            },
        ]
        transactions = [source_record, *target_records]
        source_key = build_investment_internal_transfer_binding_key(source_record)
        old_target_key = build_investment_internal_transfer_binding_key(target_records[0])
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        target_keys = [
            key
            for key, records in binding_index.items()
            if records and records[0].get("broker") == "hsbc"
        ]

        self.assertEqual(len(target_keys), 2)
        self.assertTrue(all(key.startswith("v3:") for key in target_keys))
        self.assertNotEqual(target_keys[0], target_keys[1])
        self.assertEqual(
            normalize_investment_payload_tickers({
                "transactions": transactions,
                "manual_internal_transfer_bindings": {source_key: old_target_key},
            })["manual_internal_transfer_bindings"],
            {source_key: old_target_key},
        )
        with self.assertRaisesRegex(ValueError, "missing or ambiguous"):
            validate_investment_internal_transfer_binding(
                transactions,
                source_key,
                old_target_key,
            )

        correct_target_key = next(
            key
            for key, records in binding_index.items()
            if records and records[0].get("description", "").startswith("TO USMART")
        )
        source, target = validate_investment_internal_transfer_binding(
            transactions,
            source_key,
            correct_target_key,
        )
        self.assertEqual(source["broker"], "usmart_hk")
        self.assertEqual(target["description"], "TO USMART T453910QU272(09FEB02)")

    def test_manual_transfer_v3_keys_survive_additive_statement_hash_enrichment(self) -> None:
        source_records = [
            {
                "date": "2023-03-06",
                "type": "deposit",
                "broker": "hsbc",
                "account": "000-999999-999",
                "currency": "USD",
                "net_amount_raw": "1.00",
                "description": "DEPOSIT",
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_filename": "eStatementFile_723330.pdf",
                    "source_file_sha256": "statement-sha256",
                    "row_number": row_number,
                    "reference_id": "DEPOSIT",
                },
            }
            for row_number in (95, 96)
        ]
        target_records = [
            {
                "date": transaction_date,
                "type": "withdrawal",
                "broker": "boc_hk",
                "account": "65640001",
                "currency": "USD",
                "net_amount_raw": "-1.00",
                "description": description,
                "source": {
                    "file_kind": "boc_hk_statement_pdf",
                    "source_filename": "Mar 6300.pdf",
                    "row_number": row_number,
                    "reference_id": description,
                },
            }
            for transaction_date, row_number, description in (
                ("2023-03-06", 30, "Clearing Cheque 0000001"),
                ("2023-03-04", 18, "Transfer E-BANKING TRANSFER"),
            )
        ]
        transactions = [*source_records, *target_records]
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        effective_source_keys = {
            int(records[0]["source"]["row_number"]): key
            for key, records in binding_index.items()
            if len(records) == 1 and records[0] in source_records
        }
        target_keys = {
            records[0]["description"]: key
            for key, records in binding_index.items()
            if len(records) == 1 and records[0] in target_records
        }

        def historical_source_key(record: dict[str, object]) -> str:
            source = record["source"]
            self.assertIsInstance(source, dict)
            source_dict = source if isinstance(source, dict) else {}
            base_key = build_investment_internal_transfer_binding_key(record)
            historical_identity = [
                source_dict.get("file_kind", ""),
                source_dict.get("source_filename", ""),
                "",
                str(source_dict.get("row_number", "")),
                source_dict.get("reference_id", ""),
                record.get("description", ""),
            ]
            return "v3:" + json.dumps(
                [base_key, historical_identity],
                ensure_ascii=False,
                separators=(",", ":"),
            )

        normalized = normalize_investment_payload_tickers({
            "transactions": transactions,
            "manual_internal_transfer_bindings": {
                historical_source_key(source_records[0]): target_keys[
                    "Clearing Cheque 0000001"
                ],
                historical_source_key(source_records[1]): target_keys[
                    "Transfer E-BANKING TRANSFER"
                ],
            },
        })

        self.assertEqual(
            normalized["manual_internal_transfer_bindings"],
            {
                effective_source_keys[95]: target_keys["Clearing Cheque 0000001"],
                effective_source_keys[96]: target_keys["Transfer E-BANKING TRANSFER"],
            },
        )

    def test_manual_transfer_validation_rejects_semantically_invalid_pair(self) -> None:
        source_record = {
            "date": "2026-01-01",
            "type": "deposit",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "HKD",
            "net_amount_raw": "100.00",
            "source": {"file_kind": "longbridge_cash_flow", "row_number": 1},
        }
        target_record = {
            "date": "2026-01-20",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "USD",
            "net_amount_raw": "-100.00",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 2},
        }
        transactions = [source_record, target_record]
        with self.assertRaisesRegex(ValueError, "currencies must match"):
            validate_investment_internal_transfer_binding(
                transactions,
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(target_record),
            )

    def test_longbridge_hk_cash_transfer_window_excludes_late_same_amount_withdrawal(self) -> None:
        source_record = {
            "date": "2023-03-22",
            "type": "deposit",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "HKD",
            "net_amount_raw": "50.00",
            "description": "Deposit Cash",
            "source": {"file_kind": "longbridge_cash_flow", "row_number": 6752},
        }
        same_day_target = {
            "date": "2023-03-22",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "HKD",
            "net_amount_raw": "-50.00",
            "description": "LONG BRIDGE HK LTD H99999999 22MAR",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 12},
        }
        late_target = {
            **same_day_target,
            "date": "2023-03-27",
            "description": "CR TO 000-999999-997 REF00000000000(26MAR23)",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 20},
        }
        transactions = [source_record, same_day_target, late_target]
        source_key = build_investment_internal_transfer_binding_key(source_record)
        same_day_target_key = build_investment_internal_transfer_binding_key(same_day_target)
        late_target_key = build_investment_internal_transfer_binding_key(late_target)

        self.assertEqual(
            get_investment_internal_transfer_link_window_days(source_record, same_day_target),
            2,
        )
        source, target = validate_investment_internal_transfer_binding(
            transactions,
            source_key,
            same_day_target_key,
        )
        self.assertEqual(source["date"], "2023-03-22")
        self.assertEqual(target["description"], same_day_target["description"])
        delayed_posting_target = {
            **same_day_target,
            "date": "2023-03-23",
            "description": "LONG BRIDGE HK LTD H99999999 22MAR",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 13},
        }
        delayed_transactions = [source_record, delayed_posting_target]
        delayed_source, delayed_target = validate_investment_internal_transfer_binding(
            delayed_transactions,
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(delayed_posting_target),
        )
        self.assertEqual(delayed_source["date"], "2023-03-22")
        self.assertEqual(delayed_target["date"], "2023-03-23")
        with self.assertRaisesRegex(ValueError, "later than the permitted deposit posting window"):
            validate_investment_internal_transfer_binding(
                transactions,
                source_key,
                late_target_key,
            )

    def test_longbridge_hk_cash_transfer_can_use_bochk_as_the_bank_leg(self) -> None:
        source_record = {
            "date": "2025-05-15",
            "type": "deposit",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "HKD",
            "net_amount_raw": "12.97",
            "description": "Cash deposit from BOCHK",
            "source": {"file_kind": "longbridge_cash_flow", "row_number": 3},
        }
        target_record = {
            "date": "2025-05-15",
            "type": "withdrawal",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "HKD",
            "net_amount_raw": "-12.97",
            "description": "Transfer to Longbridge HK",
            "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 8},
        }
        source, target = validate_investment_internal_transfer_binding(
            [source_record, target_record],
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(target_record),
        )

        self.assertEqual(source["broker"], "longbridge_hk")
        self.assertEqual(target["broker"], "boc_hk")

    def test_february_longbridge_hk_cash_transfer_can_use_bochk_as_the_bank_leg(self) -> None:
        source_record = {
            "date": "2025-02-24",
            "type": "deposit",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "HKD",
            "net_amount_raw": "628.71",
            "description": "Deposit Cash",
            "source": {"file_kind": "longbridge_cash_flow", "row_number": 833},
        }
        target_record = {
            "date": "2025-02-24",
            "type": "withdrawal",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "HKD",
            "net_amount_raw": "-628.71",
            "description": "Transfer FPS DD/LONG BRIDGE HK LTD",
            "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 8},
        }
        source, target = validate_investment_internal_transfer_binding(
            [source_record, target_record],
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(target_record),
        )

        self.assertEqual(source["broker"], "longbridge_hk")
        self.assertEqual(target["broker"], "boc_hk")

    def test_cmbwl_bank_deposit_can_use_futuhk_withdrawal_as_cash_counterpart(self) -> None:
        source_record = {
            "date": "2023-03-27",
            "type": "deposit",
            "broker": "cmbwl",
            "account": "688-2-XXXX3-2",
            "currency": "USD",
            "net_amount_raw": "1620.45",
            "description": "Deposit from Futu Securities (HK)",
            "source": {
                "file_kind": "user_reconstructed_cash_flow",
                "cash_account_role": "external_bank",
                "row_number": 1,
            },
        }
        target_record = {
            "date": "2023-03-28",
            "type": "withdrawal",
            "broker": "futuhk",
            "account": "FUTU-TEST-ACCOUNT",
            "currency": "USD",
            "net_amount_raw": "-1620.45",
            "description": "Withdrawal · CMB Wing Lung Bank",
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "statement_order_id": "34558056",
            },
        }
        source, target = validate_investment_internal_transfer_binding(
            [source_record, target_record],
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(target_record),
        )

        self.assertEqual(source["broker"], "cmbwl")
        self.assertEqual(target["broker"], "futuhk")

    def test_negative_longbridge_cash_reversal_is_not_an_internal_transfer_source(self) -> None:
        source_record = {
            "date": "2024-04-17",
            "type": "deposit",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "USD",
            "net_amount_raw": "-43.87",
            "description": "RETURNED CHEQUE INT. DATE 2024/04/15",
            "source": {"file_kind": "longbridge_cash_flow", "row_number": 2},
        }
        target_record = {
            "date": "2024-04-16",
            "type": "withdrawal",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "USD",
            "net_amount_raw": "-43.87",
            "description": "Transfer Transaction AUTO-SWEEP",
            "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 3},
        }

        with self.assertRaisesRegex(ValueError, "not a supported internal-transfer source"):
            validate_investment_internal_transfer_binding(
                [source_record, target_record],
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(target_record),
            )

    def test_bochk_cash_transfer_can_use_longbridge_hk_as_the_counterpart(self) -> None:
        source_record = {
            "date": "2026-07-16",
            "type": "deposit",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "HKD",
            "net_amount_raw": "500.00",
            "description": "Transfer Transaction CBS TRANSFER",
            "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 4},
        }
        target_record = {
            "date": "2026-07-16",
            "type": "withdrawal",
            "broker": "longbridge_hk",
            "account": "H99999999",
            "currency": "HKD",
            "net_amount_raw": "-500.00",
            "description": "Cash Withdrawal",
            "source": {"file_kind": "longbridge_cash_flow"},
        }
        source, target = validate_investment_internal_transfer_binding(
            [source_record, target_record],
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(target_record),
        )

        self.assertEqual(source["broker"], "boc_hk")
        self.assertEqual(target["broker"], "longbridge_hk")

    def test_cash_transfer_validation_allows_one_day_undated_posting_lag(self) -> None:
        source_record = {
            "date": "2025-09-03",
            "type": "deposit",
            "broker": "ibkr",
            "account": "U12345",
            "currency": "USD",
            "net_amount_raw": "18500.00",
            "description": "Electronic Fund Transfer",
            "source": {"file_kind": "ibkr_ofx", "row_number": 282},
        }
        next_day_target = {
            "date": "2025-09-04",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-888888-888",
            "currency": "USD",
            "net_amount_raw": "-18500.00",
            "description": "BANK TRANSFER REFERENCE",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 10},
        }
        transactions = [source_record, next_day_target]

        source, target = validate_investment_internal_transfer_binding(
            transactions,
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(next_day_target),
        )

        self.assertEqual(source["date"], "2025-09-03")
        self.assertEqual(target["date"], "2025-09-04")

    def test_ibkr_equivalent_usd_fx_bank_leg_allows_explicit_one_day_settlement(self) -> None:
        source_record = {
            "date": "2026-05-31",
            "type": "deposit",
            "broker": "ibkr",
            "account": "U00000001",
            "currency": None,
            "net_amount_raw": "739.1",
            "description": "Electronic Fund Transfer",
            "source": {
                "file_kind": "transactions",
                "row_number": 219,
                "transaction_type_raw": "Deposit",
            },
        }
        next_day_target = {
            "date": "2026-06-01",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "CNH",
            "net_amount_raw": "-5000.02",
            "description": "REF00000000000000 01JUN",
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "row_number": 15,
            },
        }
        transactions = [source_record, next_day_target]

        source, target = validate_investment_internal_transfer_binding(
            transactions,
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(next_day_target),
        )

        self.assertEqual(source["net_amount_raw"], "739.1")
        self.assertEqual(target["net_amount_raw"], "-5000.02")

        two_days_late_target = {
            **next_day_target,
            "date": "2026-06-02",
            "description": "REF00000000000000 02JUN",
        }
        with self.assertRaisesRegex(ValueError, "later than the permitted deposit posting window"):
            validate_investment_internal_transfer_binding(
                [source_record, two_days_late_target],
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(two_days_late_target),
            )

    def test_cash_transfer_validation_rejects_future_bank_outflow_within_default_window(self) -> None:
        source_record = {
            "date": "2023-03-21",
            "type": "deposit",
            "broker": "boc_hk",
            "account": "65640001",
            "currency": "HKD",
            "net_amount_raw": "50.00",
            "description": "Transfer FPS/DEMO ACCOUNT HOLDER/FRN20230321PAYC0100977018560",
            "source": {"file_kind": "boc_hk_statement_pdf", "row_number": 12},
        }
        future_target = {
            "date": "2023-03-23",
            "type": "withdrawal",
            "broker": "hsbc",
            "account": "000-999999-999",
            "currency": "HKD",
            "net_amount_raw": "-50.00",
            "description": "RETURN CHEQUE CHARGES",
            "source": {"file_kind": "hsbc_statement_cash", "row_number": 20},
        }
        transactions = [source_record, future_target]
        with self.assertRaisesRegex(ValueError, "later than the permitted deposit posting window"):
            validate_investment_internal_transfer_binding(
                transactions,
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(future_target),
            )

    def test_incremental_merge_large_ledger_uses_candidate_index_without_full_scan(self) -> None:
        account = "U00000001"

        def cash_record(row_number: int) -> dict[str, object]:
            amount = str(row_number + 1)
            return {
                "date": "2026-01-02",
                "datetime": "2026-01-02 12:00:00",
                "type": "deposit",
                "broker": "ibkr",
                "account": account,
                "currency": "USD",
                "gross_amount_raw": amount,
                "net_amount_raw": amount,
                "description": f"Funding {row_number}",
                "source": {
                    "file_kind": "transactions",
                    "fitid": f"FITID-{row_number}",
                    "row_number": row_number,
                    "account": account,
                },
            }

        existing_transactions = [cash_record(row_number) for row_number in range(1, 2_049)]
        duplicate_transaction = deepcopy(existing_transactions[1_000])
        added_transaction = cash_record(99_999)
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": account,
            "summary": {},
            "transactions": existing_transactions,
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": account,
            "summary": {},
            "transactions": [duplicate_transaction, added_transaction],
        }

        # This predicate was previously reached for every historical pair. The
        # records below are deliberately non-HSBC, so replacing it cannot alter
        # the expected merge result while its call count verifies bucketed lookup.
        with patch(
            "app.services.investment_import._has_same_hsbc_cash_source_row",
            return_value=False,
        ) as cash_source_row_match:
            merged = merge_investment_payloads(existing_payload, incoming_payload)

        merge_details = merged["summary"]["incremental_import"]
        self.assertEqual(len(merged["transactions"]), len(existing_transactions) + 1)
        self.assertEqual(merge_details["added_record_count"], 1)
        self.assertEqual(merge_details["duplicate_record_count"], 1)
        self.assertLess(cash_source_row_match.call_count, 32)

    def test_refresh_reconciliation_reuses_binding_index_for_two_manual_pairs(self) -> None:
        def transfer_record(
            *,
            broker: str,
            account: str,
            transaction_type: str,
            ticker: str,
            quantity: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": "2026-08-03",
                "datetime": "2026-08-03 20:00:00",
                "type": transaction_type,
                "broker": broker,
                "account": account,
                "ticker": ticker,
                "currency": "USD",
                "quantity_raw": quantity,
                "quantity_abs": quantity,
                "gross_amount_raw": "0",
                "net_amount_raw": "0",
                "description": f"{ticker} {transaction_type}",
                "source": {
                    "file_kind": "test_import",
                    "row_number": row_number,
                    "broker": broker,
                    "account": account,
                },
                "normalized": {
                    "position_quantity": quantity,
                    "display_quantity": quantity,
                    "is_cash_flow": False,
                },
            }

        source_records = [
            transfer_record(
                broker="ibkr",
                account="U00000001",
                transaction_type="transfer_out",
                ticker="DRAM",
                quantity="195",
                row_number=1,
            ),
            transfer_record(
                broker="ibkr",
                account="U00000001",
                transaction_type="transfer_out",
                ticker="QQQI",
                quantity="10",
                row_number=2,
            ),
        ]
        receipt_records = [
            transfer_record(
                broker="schwab",
                account="Individual ...001",
                transaction_type="transfer_in",
                ticker="DRAM",
                quantity="195",
                row_number=3,
            ),
            transfer_record(
                broker="schwab",
                account="Individual ...001",
                transaction_type="transfer_in",
                ticker="QQQI",
                quantity="10",
                row_number=4,
            ),
        ]
        transactions = source_records + receipt_records
        initial_index = build_investment_internal_transfer_binding_index(transactions)

        def binding_key_for(record: dict[str, object]) -> str:
            return next(
                key
                for key, records in initial_index.items()
                if len(records) == 1 and records[0] is record
            )

        payload: dict[str, object] = {
            "transactions": transactions,
            "summary": {},
            "manual_internal_transfer_bindings": {
                binding_key_for(source_records[0]): binding_key_for(receipt_records[0]),
                binding_key_for(source_records[1]): binding_key_for(receipt_records[1]),
            },
            "manual_internal_transfer_ignored_source_keys": [],
            "manual_security_transfer_attributions": {},
        }

        with patch(
            "app.services.investment_import.build_investment_internal_transfer_binding_index",
            wraps=build_investment_internal_transfer_binding_index,
        ) as binding_index_builder:
            refresh_investment_security_transfer_reconciliation(payload)

        reconciliation = payload["summary"]["security_transfer_reconciliation"]
        self.assertEqual(binding_index_builder.call_count, 2)
        self.assertEqual(reconciliation["manual_match_count"], 2)
        self.assertEqual(reconciliation["unreconciled_inbound_count"], 0)
        self.assertEqual(reconciliation["unreconciled_outbound_count"], 0)

    def test_replay_holdings_reports_unreconciled_same_day_buy_and_grant(self) -> None:
        transactions = [
            {
                "date": "2026-01-29",
                "type": "buy",
                "broker": "ibkr",
                "ticker": "IBKR",
                "quantity_raw": "1.0",
            },
            {
                "date": "2026-01-29",
                "type": "grant",
                "broker": "ibkr",
                "ticker": "IBKR",
                "quantity_raw": "4.25",
                "source": {"file_kind": "positions", "row_number": 43},
            },
        ]

        replayed = _replay_holdings(transactions)
        mismatches = _validate_holdings(transactions, {"IBKR": {"quantity": "4.25"}})

        self.assertEqual(replayed["IBKR"], Decimal("5.25"))
        self.assertEqual(mismatches, [{
            "ticker": "IBKR",
            "replayed_quantity": "5.25",
            "open_positions_quantity": "4.25",
        }])


if __name__ == "__main__":
    unittest.main()
