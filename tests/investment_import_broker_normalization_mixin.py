"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    Decimal,
    _sort_transactions,
    _tigertrade_simple_cash_rows,
    build_investment_internal_transfer_binding_index,
    build_investment_internal_transfer_binding_key,
    build_investment_payload_from_hsbc_pasted_text,
    build_investment_payload_from_ibkr_csvs,
    build_investment_payload_from_schwab_csv,
    deepcopy,
    get_investment_internal_transfer_link_window_days,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    refresh_investment_security_transfer_reconciliation,
    validate_investment_internal_transfer_binding,
    validate_investment_security_transfer_attribution,
)


class BrokerNormalizationImportTestsMixin:
    def test_tigertrade_funds_in_transit_preserve_equity(self) -> None:
        records = _tigertrade_simple_cash_rows(
            "\n".join(
                [
                    "2025-01-07  Fund Subscription  -1,500.00  USD",
                    "2025-01-08  Fund Subscription Returned  1,500.00  USD",
                ]
            ),
            account="1544722",
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
        self.assertTrue(
            all(record["normalized"]["cash_equivalent_transfer"] for record in records)
        )
        self.assertTrue(
            all(record["source"]["cash_equivalent_transfer"] for record in records)
        )

    def test_import_canonicalizes_share_class_ticker_to_hyphen(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,478.50",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-04-01,U***TEST,BERKSHIRE HATHAWAY INC-CL B,Buy,BRK B,1,478.50,USD,-478.50,-0.35,-478.85",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Stocks,BRK B,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Data,Summary,Stocks,USD,BRK B,,1,1,478.50,478.50,478.50,478.50,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["ticker"], "BRK-B")
        self.assertIn("BRK-B", payload["position_snapshot"])
        self.assertIn("BRK-B", payload["performance_snapshot"])

    def test_ibkr_closed_dram_trades_preserve_exact_broker_realized_pnl(self) -> None:
        transactions_csv = (
            "\n".join(
                [
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
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
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
                ]
            )
            + "\n"
        )

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
            record
            for record in payload["transactions"]
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

    def test_ibkr_forex_pnl_details_attach_exact_realized_component(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    'Statement,Data,Period,"August 1, 2026 - August 8, 2026"',
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,8",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-08-08,U***00001,Net Amount in Base from Forex Trade: 10 USD.CNH,Forex Trade Component,USD.CNH,10,7,CNH,-70,-2,-0.5",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    'Statement,Data,Period,"August 1, 2026 - August 8, 2026"',
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
                    "Deposits & Withdrawals,Data,Total in USD,,,8",
                    "Forex P/L Details,Header,Asset Category,Currency,Description,Date/Time,FX Currency,Quantity,Proceeds in USD,Basis in USD,Realized P/L in USD,Code",
                    'Forex P/L Details,Data,Forex,USD,Forex 10 USD.CNH,"2026-08-07, 22:36:27",CNH,-70,8,-8.5,-0.5,C',
                    "Forex P/L Details,Data,Total,,,,,,8,-8.5,-0.5,",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Forex,CNH,0,0,-0.5,0,0,-0.5,0,0,0,0,0,-0.5,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        forex = next(
            record
            for record in payload["transactions"]
            if record.get("type") == "forex_trade_component"
        )
        self.assertEqual(forex["broker_realized_pnl_raw"], "-0.5")
        self.assertEqual(forex["normalized"]["broker_realized_pnl"], "-0.5")
        self.assertEqual(forex["source"]["broker_realized_pnl_ticker"], "CNH")
        self.assertEqual(forex["source"]["broker_realized_pnl_currency"], "USD")
        self.assertEqual(forex["source"]["broker_realized_pnl_date"], "2026-08-07")
        self.assertFalse(
            any(
                "unsupported IBKR cash currency" in warning
                or "incomplete IBKR Forex P/L detail" in warning
                for warning in payload["summary"]["warnings"]
            )
        )

        legacy_total_warning = (
            "Row 99: unsupported IBKR cash currency 'TOTAL IN USD' was skipped."
        )
        retained_warning = "Retain this unrelated historical warning."
        merged = merge_investment_payloads(
            {
                "schema_version": "3.0.0",
                "broker": "ibkr",
                "account": "U00000001",
                "summary": {
                    "warnings": [legacy_total_warning, retained_warning],
                    "unknown_transaction_types": [],
                },
                "transactions": [],
            },
            deepcopy(payload),
        )
        self.assertNotIn(legacy_total_warning, merged["summary"]["warnings"])
        self.assertIn(retained_warning, merged["summary"]["warnings"])

    def test_same_dram_trade_shape_at_two_brokers_is_not_deduplicated(self) -> None:
        def payload_for(broker: str, account: str) -> dict[str, object]:
            return {
                "schema_version": "3.0.0",
                "broker": broker,
                "account": account,
                "summary": {},
                "transactions": [
                    {
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
                    }
                ],
            }

        merged = merge_investment_payloads(
            payload_for("ibkr", "U00000001"),
            payload_for("hsbc", "000-999999-999"),
        )
        dram_sells = [
            record
            for record in merged["transactions"]
            if record.get("ticker") == "DRAM" and record.get("type") == "sell"
        ]
        self.assertEqual(len(dram_sells), 2)
        self.assertEqual({record["broker"] for record in dram_sells}, {"ibkr", "hsbc"})

    def test_ibkr_realized_summary_security_transfer_creates_a_non_cash_outflow(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Statement,Data,Period,July 1, 2026 - July 31, 2026",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,0",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-07-30,U***00001,FX Translations P&L,Adjustment,-,-,-,-,0,-,0",
                ]
            )
            + "\n"
        )
        realized_summary_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Statement,Data,Period,July 1, 2026 - July 31, 2026",
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code",
                    "Transfers,Data,Stocks,USD,QQQI,2026-07-31,FOP,Out,--,00000002,-5,--,-263.40,0.00,0.00,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            realized_summary_csv.encode("utf-8"),
            transaction_filename="U00000001.TRANSACTIONS.YTD.csv",
            positions_filename="U00000001_20260101_20260731.csv",
        )

        transfer = next(
            record
            for record in payload["transactions"]
            if record["type"] == "transfer_out"
        )
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
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Statement,Data,Period,July 1, 2026 - July 31, 2026",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,0",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-07-30,U***00001,FX Translations P&L,Adjustment,-,-,-,-,0,-,0",
                ]
            )
            + "\n"
        )
        realized_summary_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Statement,Data,Period,July 1, 2026 - July 31, 2026",
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code",
                    "Transfers,Data,Stocks,USD,QQQI,2026-07-31,FOP,Out,--,00000002,-5,--,-263.40,0.00,0.01,",
                ]
            )
            + "\n"
        )

        with self.assertRaisesRegex(ValueError, "non-zero cash consideration"):
            build_investment_payload_from_ibkr_csvs(
                transactions_csv.encode("utf-8"),
                realized_summary_csv.encode("utf-8"),
            )

    def test_schwab_transfer_bundle_parses_in_kind_receipt_and_positions_snapshot(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"07/31/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
                    '"07/31/2026 as of 07/30/2026","MoneyLink Transfer","","Tfr COLUMN NATIONAL AS","","","","$0.41"',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 12:11 AM ET, 2026/08/01"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
                    '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","53.04","0.36","0.68%","$265.20","$1.80","0.68%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","--","--","$265.61","$0.00","0%","$0.00","--","--","--","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260801-001049.csv",
            positions_filename="Individual-Positions-0919-37-54-091937.csv",
        )

        transfer = next(
            record
            for record in payload["transactions"]
            if record["type"] == "transfer_in"
        )
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

    def test_schwab_dividend_and_nra_tax_adjustment_are_classified(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/03/2026","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
                    '"08/21/2026","NRA Tax Adj","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","","","","-$3.26"',
                    '"08/21/2026","Non-Qualified Div","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","","","","$32.59"',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...900 as of 02:07 AM ET, 2026/08/22"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","54.24","$271.20","$286.29","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$29.74","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$300.94","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX900_Transactions_20260822.csv",
            positions_filename="Individual-Positions-2026-08-22.csv",
        )

        by_type = {record["type"]: record for record in payload["transactions"]}
        self.assertEqual(by_type["dividend"]["net_amount_raw"], "32.59")
        self.assertEqual(
            by_type["foreign_tax_withholding"]["net_amount_raw"],
            "-3.26",
        )
        self.assertTrue(
            by_type["foreign_tax_withholding"]["normalized"]["is_cash_flow"]
        )
        self.assertEqual(payload["summary"]["unknown_transaction_types"], [])
        self.assertEqual(payload["ending_cash"], "29.74")
        self.assertFalse(payload["datetime_policy"]["source_has_intraday_timestamp"])
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])

    def test_schwab_dividend_reinvestment_without_basis_warns_and_stays_unknown(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/05/2026","Dividend Reinvestment","DRAM","ROUNDHILL MEMORY ETF","2","","",""',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 09:00 PM ET, 2026/08/05"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"DRAM","ROUNDHILL MEMORY ETF","2","50.00","$100.00","N/A","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$0.00","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$100.00","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260805.csv",
            positions_filename="Individual-Positions-2026-08-05.csv",
        )

        reinvestment = payload["transactions"][0]
        self.assertEqual(reinvestment["type"], "dividend_reinvestment")
        self.assertEqual(
            reinvestment["source"]["reinvestment_cost_basis_status"],
            "unknown",
        )
        self.assertIn(
            "Row 2: Schwab dividend reinvestment has no positive "
            "quantity-and-value cost-basis evidence; P&L remains unavailable.",
            payload["summary"]["warnings"],
        )
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])

    def test_schwab_reimport_deduplicates_legacy_nra_tax_adjustment_type(self) -> None:
        legacy_tax = {
            "date": "2026-08-21",
            "datetime": "2026-08-21 20:00:00",
            "type": "nra_tax_adj",
            "currency": "USD",
            "ticker": "QQQI",
            "description": "NEOS NASDAQ-100(R) HIGH INCOME ETF",
            "gross_amount_raw": "-3.26",
            "commission_raw": "0",
            "net_amount_raw": "-3.26",
            "broker": "schwab",
            "account": "Individual ...900",
            "source": {
                "file_kind": "schwab_csv",
                "action_raw": "NRA Tax Adj",
                "broker": "schwab",
                "account": "Individual ...900",
                "row_number": 2,
            },
        }
        incoming_tax = {
            **legacy_tax,
            "type": "foreign_tax_withholding",
            "source": {
                **legacy_tax["source"],
                "row_number": 3,
            },
        }

        merged = merge_investment_payloads(
            {
                "schema_version": 3,
                "broker": "schwab",
                "account": "Individual ...900",
                "transactions": [legacy_tax],
            },
            {
                "schema_version": 3,
                "broker": "schwab",
                "account": "Individual ...900",
                "transactions": [incoming_tax],
            },
        )

        self.assertEqual(len(merged["transactions"]), 1)
        transaction = merged["transactions"][0]
        self.assertEqual(transaction["type"], "foreign_tax_withholding")
        self.assertEqual(transaction["source"]["action_raw"], "NRA Tax Adj")
        self.assertEqual(transaction["source"]["legacy_type_raw"], "nra_tax_adj")
        self.assertEqual(
            merged["summary"]["incremental_import"]["added_record_count"],
            0,
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_schwab_date_only_same_day_trade_order_uses_newest_first_source_rows(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/24/2026","Sell","EUV","CORGI LITHOGRAPHY & SEMICONDUCTOR PHOTONICS ETF","1","$23.755","","$23.76"',
                    '"08/24/2026","Buy","EUV","CORGI LITHOGRAPHY & SEMICONDUCTOR PHOTONICS ETF","1","$23.45","","-$23.45"',
                    '"08/23/2026","Non-Qualified Div","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","","","","$1.00"',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 09:00 PM ET, 2026/08/24"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"Cash & Cash Investments","--","--","--","$0.00","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$0.00","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260824.csv",
            positions_filename="Individual-Positions-2026-08-24.csv",
        )

        trades = [
            transaction
            for transaction in payload["transactions"]
            if transaction.get("ticker") == "EUV"
        ]
        self.assertEqual(
            [transaction["type"] for transaction in trades], ["buy", "sell"]
        )
        self.assertEqual(
            trades[0]["source"]["source_row_order"],
            "newest_first",
        )

    def test_schwab_user_confirmed_same_day_sequence_overrides_source_rows(
        self,
    ) -> None:
        sell = {
            "date": "2026-08-24",
            "datetime": "2026-08-24 20:00:00",
            "type": "sell",
            "broker": "schwab",
            "account": "Individual ...001",
            "ticker": "EUV",
            "quantity_raw": "1",
            "net_amount_raw": "23.755",
            "source": {
                "file_kind": "schwab_csv",
                "row_number": 2,
                "source_row_order": "newest_first",
                "same_day_execution_sequence": 2,
            },
        }
        buy = {
            **sell,
            "type": "buy",
            "net_amount_raw": "-23.45",
            "source": {
                **sell["source"],
                "row_number": 3,
                "same_day_execution_sequence": 1,
            },
        }
        transactions = [sell, buy]

        _sort_transactions(transactions)

        self.assertEqual(
            [transaction["type"] for transaction in transactions], ["buy", "sell"]
        )

    def test_schwab_explicit_datetime_column_is_preferred_over_date_column(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Time and Date (ET)","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/03/2026","","Security Transfer","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","","",""',
                    '"08/21/2026","08/21/2026 03:14:15 PM ET","Non-Qualified Div","QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","","","","$1.50"',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...900 as of 02:07 AM ET, 2026/08/22"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","5","54.24","$271.20","$286.29","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$1.50","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$272.70","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX900_Transactions_20260822.csv",
            positions_filename="Individual-Positions-2026-08-22.csv",
        )

        dividend = next(
            record for record in payload["transactions"] if record["type"] == "dividend"
        )
        self.assertEqual(dividend["datetime"], "2026-08-21 15:14:15")
        self.assertEqual(dividend["source"]["datetime_source_field"], "datetime")
        self.assertEqual(dividend["source"]["datetime_precision"], "second")
        self.assertTrue(dividend["source"]["source_has_intraday_timestamp"])
        self.assertTrue(payload["datetime_policy"]["source_has_intraday_timestamp"])

    def test_schwab_known_internal_transfer_cleanup_rows_are_not_imported(self) -> None:
        transactions_csv = (
            "\n".join(
                [
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
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 05:15 AM ET, 2026/08/04"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"DRAM","DRAM ETF","195","51.75","$10,091.25","Incomplete","ETFs & Closed End Funds",',
                    '"QQQI","QQQI ETF","15","54.06","$810.90","Incomplete","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$10,902.56","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260804.csv",
            positions_filename="Individual-Positions-2026-08-04.csv",
        )

        self.assertEqual(
            payload["summary"]["schwab_suppressed_internal_transfer_count"], 6
        )
        self.assertEqual(
            len(payload["summary"]["schwab_suppressed_internal_transfer_rows"]), 6
        )
        self.assertEqual(
            [
                (
                    record["date"],
                    record["type"],
                    record.get("ticker"),
                    record.get("quantity_raw"),
                )
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
        transactions_csv = (
            "\n".join(
                [
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
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...900 as of 07:32 AM ET, 2026/08/15"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"DRAM","ROUNDHILL MEMORY ETF","200","57.32","$11,464.00","$11,846.07","ETFs & Closed End Funds",',
                    '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","50","55.79","$2,789.50","$2,862.89","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$14,253.91","$14,708.96","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX900_Transactions_20260815.csv",
            positions_filename="Individual-Positions-2026-08-15.csv",
        )

        self.assertEqual(payload["account"], "Individual ...900")
        self.assertEqual(
            payload["summary"]["schwab_suppressed_internal_transfer_count"], 10
        )
        self.assertEqual(
            len(payload["summary"]["schwab_suppressed_internal_transfer_rows"]), 10
        )
        self.assertEqual(len(payload["transactions"]), 6)
        self.assertEqual(
            {record["type"] for record in payload["transactions"]},
            {"deposit", "transfer_in"},
        )
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "200")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "50")

    def test_schwab_reimport_removes_stale_paired_journal_rows(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","-5","","",""',
                    '"08/13/2026","Journal","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
                    '"08/12/2026","Security Transfer","DRAM","ROUNDHILL MEMORY ETF","5","","",""',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...900 as of 07:32 AM ET, 2026/08/15"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"DRAM","ROUNDHILL MEMORY ETF","5","57.32","$286.60","$296.15","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$287.01","$296.15","",',
                ]
            )
            + "\n"
        )
        incoming = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX900_Transactions_20260815.csv",
            positions_filename="Individual-Positions-2026-08-15.csv",
        )
        stale_rows = []
        for row in incoming["summary"]["schwab_suppressed_internal_transfer_rows"]:
            stale_rows.append(
                {
                    "broker": "schwab",
                    "account": "Individual ...900",
                    "date": row["date"],
                    "datetime": f"{row['date']} 23:00:00",
                    "type": "adjustment",
                    "ticker": row["ticker"],
                    "currency": "USD",
                    "quantity_raw": row["quantity"],
                    "quantity_abs": row["quantity"].lstrip("-"),
                    "source": {
                        "broker": "schwab",
                        "account": "Individual ...900",
                        "action_raw": row["action"],
                    },
                }
            )
        existing = deepcopy(incoming)
        existing["transactions"] = [*incoming["transactions"], *stale_rows]
        existing["summary"]["schwab_suppressed_internal_transfer_rows"] = incoming[
            "summary"
        ]["schwab_suppressed_internal_transfer_rows"][:2]
        merged = merge_investment_payloads(existing, incoming)

        self.assertFalse(
            any(
                record.get("broker") == "schwab" and record.get("type") == "adjustment"
                for record in merged["transactions"]
            )
        )
        self.assertEqual(
            merged["summary"]["schwab_suppressed_internal_transfer_count"],
            2,
        )

    def test_schwab_multi_lot_positions_reconcile_to_total_without_losing_lots(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"07/31/2026","Security Transfer","QQQI","QQQI transfer receipt","5","","",""',
                    '"08/03/2026","Security Transfer","DRAM","DRAM transfer receipt","195","","",""',
                    '"08/03/2026","Security Transfer","QQQI","QQQI transfer receipt","10","","",""',
                    '"08/03/2026","Journal","QQQI","Internal journal","-5","","",""',
                    '"08/03/2026","Journal","QQQI","Internal journal","5","","",""',
                    '"08/03/2026 as of 07/30/2026","MoneyLink Transfer","","Cash transfer","","","","$0.41"',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...002 as of 09:17 PM ET, 2026/08/03"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
                    '"DRAM","DRAM ETF","195","51.9993","0","0%","$10,139.86","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"QQQI","QQQI ETF","10","53.89","0","0%","$538.90","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"QQQI","QQQI ETF","5","53.89","0","0%","$269.45","$0","0%","N/A","-","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","--","--","$10,948.62","$0.00","0%","$0.00","--","--","--","--","",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX002_Transactions_20260803-211710.csv",
            positions_filename="Individual-Positions-2533-38-21-253338.csv",
        )

        self.assertEqual(
            {record["type"] for record in payload["transactions"]},
            {"deposit", "transfer_in"},
        )
        self.assertEqual(
            payload["summary"]["schwab_suppressed_internal_transfer_count"], 2
        )
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "195")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "15")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["value"], "808.35")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["source_lot_count"], "2")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["cost_basis"], "")
        self.assertEqual(
            payload["position_snapshot"]["QQQI"]["cost_basis_status"], "unknown"
        )
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
            "transactions": [
                {
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
                }
            ],
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
            if records
            == [
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
            if records
            == [
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
        transactions_csv = (
            "\n".join(
                [
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
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 05:15 AM ET, 2026/08/04"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Reinvest?","Reinvest Capital Gains?","Asset Type",',
                    '"DRAM","ROUNDHILL MEMORY ETF","195","51.75","0.62","1.21%","$10,091.25","$120.90","1.21%","Incomplete","N/A","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"QQQI","NEOS NASDAQ-100(R) HIGH INCOME ETF","15","54.06","0.22","0.41%","$810.90","$3.30","0.41%","Incomplete","N/A","N/A","No","N/A","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","--","--","$0.41","$0.00","0%","--","--","--","--","--","Cash and Money Market",',
                    '"Positions Total","","--","--","--","--","$10,902.56","$124.20","1.14%","$0.00","$0.00","0%","--","--","--",',
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_schwab_csv(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
            transaction_filename="Individual_XXX001_Transactions_20260804-051528.csv",
            positions_filename="Individual-Positions-3595-90-00-359590.csv",
        )

        self.assertEqual(payload["account"], "Individual ...001")
        self.assertEqual(len(payload["transactions"]), 4)
        self.assertEqual(
            payload["summary"]["schwab_suppressed_internal_transfer_count"], 6
        )
        self.assertEqual(payload["ending_cash"], "0.41")
        self.assertEqual(payload["summary"]["warnings"], [])
        self.assertTrue(payload["summary"]["holdings_validation"]["matched"])
        self.assertEqual(payload["position_snapshot"]["DRAM"]["quantity"], "195")
        self.assertEqual(payload["position_snapshot"]["QQQI"]["quantity"], "15")
        self.assertEqual(
            payload["position_snapshot"]["QQQI"]["cost_basis_status"], "unknown"
        )
        self.assertEqual(
            payload["summary"]["schwab_positions_validation"]["reported_total"],
            "10902.56",
        )

    def test_schwab_transfer_receipts_remain_visible_and_bind_to_source_legs(
        self,
    ) -> None:
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
            transfer_record(
                "schwab", "Individual ...001", "transfer_in", "DRAM", "195", 3
            ),
            transfer_record(
                "schwab", "Individual ...001", "transfer_in", "QQQI", "10", 4
            ),
        ]
        transactions = source_records + receipt_records
        binding_index = build_investment_internal_transfer_binding_index(transactions)
        bindings = {}
        for source in source_records:
            source_key = next(
                key for key, rows in binding_index.items() if rows == [source]
            )
            receipt = next(
                receipt
                for receipt in receipt_records
                if receipt["ticker"] == source["ticker"]
            )
            receipt_key = next(
                key for key, rows in binding_index.items() if rows == [receipt]
            )
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

    def test_schwab_security_binding_requires_same_day_and_remains_fail_closed(
        self,
    ) -> None:
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
            reconciliation["aggregate_overlay"][
                "source_attribution_required_receipt_keys"
            ],
            [receipt_key],
        )

    def test_security_transfer_fifo_fallback_reconstructs_basis_with_source_fees(
        self,
    ) -> None:
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
                "is_cash_flow": transaction_type
                in {"buy", "transfer_out", "transfer_in"},
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
        source_key = next(
            key
            for key, records in binding_index.items()
            if records == [source_transfer_out]
        )
        receipt_key = next(
            key for key, records in binding_index.items() if records == [schwab_receipt]
        )
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
        self.assertEqual(
            schwab_receipt["carried_cost_basis_method_label"], "FIFO reconstructed"
        )

    def test_schwab_security_transfer_attribution_is_explicit_and_evidence_supersedes(
        self,
    ) -> None:
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

    def test_schwab_security_transfer_attribution_cannot_reuse_source_inventory(
        self,
    ) -> None:
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
        first_key = next(
            key for key, records in binding_index.items() if records == [first_receipt]
        )
        second_key = next(
            key for key, records in binding_index.items() if records == [second_receipt]
        )
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

    def test_schwab_positions_total_and_visible_bundle_account_mismatch_fail_closed(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
                    '"08/03/2026","Security Transfer","QQQI","QQQI transfer receipt","5","","",""',
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    '"Positions for account Individual ...001 as of 09:17 PM ET, 2026/08/03"',
                    "",
                    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis","Asset Type",',
                    '"QQQI","QQQI ETF","5","53.89","$269.45","N/A","ETFs & Closed End Funds",',
                    '"Cash & Cash Investments","--","--","--","$0.41","--","Cash and Money Market",',
                    '"Positions Total","--","--","--","$200.00","--","",',
                ]
            )
            + "\n"
        )

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

    def test_import_preserves_unknown_deposit_currency_and_forex_component_currency(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,312.14",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2025-10-31,U***87176,Electronic Fund Transfer,Deposit,-,-,-,-,314.18505289999996,-,314.18505289999996",
                    "Transaction History,Data,2025-10-31,U***87176,Net Amount in Base from Forex Trade: 314.09 USD.HKD,Forex Trade Component,USD.HKD,314.09,7.77165,HKD,-2.041974516,-2,-2.041974516",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Forex,USD.HKD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

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
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,0.68",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2025-10-03,U***TEST,USD Credit Interest for Sep-2025,Credit Interest,-,-,-,-,0.68,-,0.68",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "credit_interest")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_detects_dividend_currency_from_description(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,33.67",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2025-10-08,U***TEST,L9025R513(LU0052767562) Cash Dividend USD 0.033 per Share (Ordinary Dividend),Dividend,-,-,-,-,33.67,-,33.67",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "dividend")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_detects_foreign_tax_withholding_currency_from_description(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,-0.42",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2025-12-23,U***TEST,META(US30303M1027) Cash Dividend USD 0.525 per Share - US Tax,Foreign Tax Withholding,-,-,-,-,-0.42,-,-0.42",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(payload["transactions"][0]["type"], "foreign_tax_withholding")
        self.assertEqual(payload["transactions"][0]["currency"], "USD")

    def test_import_normalizes_ibkr_distribution_description(self) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,-0.42",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2025-12-23,U***TEST,Qqqi(Us78433H6751) Cash Dividend USD 0.6346 Per Share - Us Tax,Foreign Tax Withholding,-,-,-,-,-0.42,-,-0.42",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Realized & Unrealized Performance Summary,Header,Asset Category,Symbol,Cost Adj.,Realized S/T Profit,Realized S/T Loss,Realized L/T Profit,Realized L/T Loss,Realized Total,Unrealized S/T Profit,Unrealized S/T Loss,Unrealized L/T Profit,Unrealized L/T Loss,Unrealized Total,Total,Code",
                    "Realized & Unrealized Performance Summary,Data,Cash,USD,0,0,0,0,0,0,0,0,0,0,0,0,",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertEqual(
            payload["transactions"][0]["description"],
            "QQQI (US78433H6751) Cash dividend USD 0.6346 per share · US tax",
        )

    def test_payload_description_separators_use_middle_dot_without_touching_identifiers(
        self,
    ) -> None:
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
        portfolio_text = "\n".join(
            [
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
            ]
        )
        cash_account_text = "\n".join(
            [
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
                "HK149972CVFAK7AO 414",
                "1,475.55",
                "1,475.55",
                "29 May 2026",
                "HK433320P5343332",
                "400.00",
                "0.00",
                "29 May 2026",
                "HK812548HJDNP12I 812",
                "400.00",
                "400.00",
                "Download",
            ]
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        transactions = payload["transactions"]
        standalone_deposit = next(
            txn for txn in transactions if txn["description"] == "HK149972CVFAK7AO 414"
        )
        mirrored_deposit = next(
            txn for txn in transactions if txn["description"] == "HK812548HJDNP12I 812"
        )
        mirrored_withdrawal = next(
            txn for txn in transactions if txn["description"] == "HK433320P5343332"
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

    def test_hsbc_pasted_import_uses_hidden_ref_rows_for_order_cash_calibration(
        self,
    ) -> None:
        portfolio_text = "\n".join(
            [
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
            ]
        )
        cash_account_text = "\n".join(
            [
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
                "HK149972CVFAK7AO 414",
                "685.19",
                "685.19",
                "Download",
            ]
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        transactions = payload["transactions"]
        self.assertEqual(len(transactions), 2)
        self.assertEqual(payload["ending_cash"], "617.19")

        self.assertTrue(
            any(txn["description"] == "HK149972CVFAK7AO 414" for txn in transactions)
        )
        self.assertTrue(
            any(
                txn["ticker"] == "DRAM" and txn["type"] == "buy" for txn in transactions
            )
        )
