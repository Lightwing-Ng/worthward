"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    Decimal,
    _preserve_authoritative_current_cash_scope,
    base64,
    build_investment_payload_from_ibkr_gainskeeper_files,
    build_investment_payload_from_ibkr_web_pasted_text,
    deepcopy,
    merge_investment_payloads,
    repair_ibkr_web_compact_split_fill_duplicates,
)


class IbkrWebImportTestsMixin:
    def test_ibkr_web_paste_converts_beijing_times_and_captures_current_gap(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=self._ibkr_web_trade_notifications_text(),
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

    def test_ibkr_current_web_paste_preserves_split_fills_and_position_calibration(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                self._ibkr_current_web_trade_notifications_text()
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
                Decimal(record["net_amount_raw"]) for record in payload["transactions"]
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

    def test_ibkr_current_day_web_paste_requires_page_date_when_the_display_omits_it(
        self,
    ) -> None:
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

    def test_ibkr_current_position_calibration_requires_matching_cash_boundary(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                self._ibkr_current_web_trade_notifications_text()
            ),
            ending_cash="123.46",
        )

        self.assertEqual(payload["position_snapshot"], {})
        self.assertFalse(payload["summary"]["position_snapshot_authoritative"])
        self.assertNotIn("position_snapshot_source", payload["summary"])
        self.assertEqual(payload["ending_cash"], "123.46")

    def test_ibkr_current_web_paste_preserves_multi_currency_cash_boundary(
        self,
    ) -> None:
        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                self._ibkr_current_web_trade_notifications_text()
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

    def test_ibkr_web_paste_parses_and_retains_your_holdings_capture(self) -> None:
        holdings_text = """Search
Account
U00000001
USD
1,234.56
Settled Cash
456.78
Your Holdings
Instrument Position Last Change % Cost Basis Market Value Avg Price Daily P&L Unrealized P&L
ALFA
ALFA EXAMPLE FUND
27 15.00 +0.10% 390 USD 405.00 USD 14.44 USD +1.00 USD +15.00 USD
BETA
BETA EXAMPLE COMPANY
3.9179 96.55 0.00% 263.37 USD 378.08 USD 67.22 USD -0.20 USD +115.00 USD
Cash Holdings
USD (base currency) 456.78
Total Cash (in USD) 456.78
Data powered by"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=(
                self._ibkr_current_web_trade_notifications_text()
            ),
            holdings_text=holdings_text,
        )

        self.assertEqual(payload["ending_cash"], "456.78")
        self.assertEqual(payload["ending_cash_by_currency"], {"USD": "456.78"})
        self.assertEqual(
            {
                ticker: snapshot["quantity"]
                for ticker, snapshot in payload["position_snapshot"].items()
            },
            {"ALFA": "27", "BETA": "3.9179"},
        )
        self.assertEqual(len(payload["source_artifacts"]), 2)
        holdings_artifact = payload["source_artifacts"][1]
        self.assertEqual(holdings_artifact["source_kind"], "ibkr_web_holdings_text")
        self.assertEqual(holdings_artifact["bundle_role"], "holdings_snapshot")
        self.assertEqual(
            base64.b64decode(holdings_artifact["content_base64"]).decode("utf-8"),
            holdings_text,
        )
        self.assertEqual(
            payload["summary"]["calibration_evidence_source"],
            "ibkr_web_holdings_text",
        )
        self.assertEqual(
            payload["datetime_policy"]["source_timezone"],
            "Asia/Hong_Kong",
        )

    def test_ibkr_web_paste_preserves_fx_fill_and_all_native_cash_balances(
        self,
    ) -> None:
        trade_notifications_text = """Search
⌘ + K
Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
USD.CNH
Bot 299.58 @ 6.70920 on IDEALPRO
U00000001 Bought 299.58
Filled
10:36 AM
6.70920
2009.942136
Fees: 13.42
DRAM
Sold 5 @ 58.95 on ARCA
U00000001 Sold 5
Filled
9/5/2026, 1:35 AM
58.95
294.75
Fees: 0.35"""
        holdings_text = """Search
Account
U00000001
USD
21,413.23
Settled Cash
1,789.86
Your Holdings
Instrument Position Last Change % Cost Basis Market Value Avg Price Daily P&L Unrealized P&L
QQQI
NEOS NASDAQ-100 HIGH INC ETF
310 54.98 +0.42% 17,523 USD 17,043.80 USD 56.53 USD +71.30 USD -480.00 USD
DRAM
ROUNDHILL MEMORY ETF
40 62.43 +4.59% 2,227.15 USD 2,497.20 USD 55.68 USD +110.00 USD +270.00 USD
IBKR
INTERACTIVE BROKERS GROUP-CL A
3.0524 92.62 0.00% 205.19 USD 282.71 USD 67.22 USD 0.00 USD +77.50 USD
Cash Holdings
CNH 0.06
USD (base currency) 1,789.85
Total Cash (in USD) 1,789.86"""

        payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text=trade_notifications_text,
            trade_date="8 Sep 2026",
            holdings_text=holdings_text,
        )

        forex = next(
            record
            for record in payload["transactions"]
            if record.get("ticker") == "USD.CNH"
        )
        self.assertEqual(forex["date"], "2026-09-07")
        self.assertEqual(forex["datetime"], "2026-09-07 22:36:00")
        self.assertEqual(forex["type"], "forex_trade_component")
        self.assertEqual(forex["currency"], "USD")
        self.assertEqual(forex["quantity_raw"], "299.58")
        self.assertEqual(forex["price_raw"], "6.70920")
        self.assertEqual(forex["commission_raw"], "-2.00")
        self.assertNotIn("gross_amount_raw", forex)
        self.assertNotIn("net_amount_raw", forex)
        self.assertNotIn("cash_flow_amount", forex["normalized"])
        self.assertEqual(forex["source"]["fee_amount_raw"], "13.42")
        self.assertEqual(forex["source"]["fee_currency"], "CNH")
        self.assertEqual(forex["source"]["forex_pair"], "USD.CNH")
        self.assertEqual(forex["source"]["forex_action"], "buy_base")
        self.assertEqual(forex["source"]["quote_amount_raw"], "2009.9421360")
        self.assertEqual(
            payload["ending_cash_by_currency"],
            {"CNH": "0.06", "USD": "1789.85"},
        )
        self.assertEqual(
            {
                ticker: snapshot["quantity"]
                for ticker, snapshot in payload["position_snapshot"].items()
            },
            {"QQQI": "310", "DRAM": "40", "IBKR": "3.0524"},
        )
        self.assertNotIn("USD.CNH", payload["position_snapshot"])

    def test_ibkr_official_csv_fx_row_supersedes_matching_web_fx_fill(self) -> None:
        web_payload = build_investment_payload_from_ibkr_web_pasted_text(
            trade_notifications_text="""Orders & Trades
Trade Notifications
Trades Account Action Quantity Status Price Amount
USD.CNH
Bot 299.58 @ 6.70920 on IDEALPRO
U00000001 Bought 299.58
Filled
10:36 AM
6.70920
2009.942136
Fees: 13.42""",
            trade_date="8 Sep 2026",
        )
        official_record = {
            "date": "2026-09-08",
            "datetime": "2026-09-08 20:00:00",
            "type": "forex_trade_component",
            "currency": "USD",
            "description": "Net Amount in Base from Forex Trade: 299.58 USD.CNH",
            "ticker": "USD.CNH",
            "quantity_raw": "299.58",
            "quantity_abs": "299.58",
            "price_raw": "6.70920",
            "gross_amount_raw": "-0.00862548",
            "commission_raw": "-2.0",
            "commission_abs": "2.0",
            "net_amount_raw": "-0.00862548",
            "normalized": {
                "position_quantity": "299.58",
                "display_quantity": "299.58",
                "unit_price": "6.70920",
                "gross_amount": "-0.00862548",
                "display_amount": "-0.00862548",
                "commission": "-2.0",
                "commission_display": "2.0",
                "net_amount": "-0.00862548",
                "is_cash_flow": True,
                "cash_flow_amount": "-0.00862548",
            },
            "source": {
                "file_kind": "transactions",
                "row_number": 2,
                "transaction_type_raw": "Forex Trade Component",
                "account": "U***00001",
            },
            "broker": "ibkr",
            "account": "U***00001",
        }
        official_payload = {
            "schema_version": "3.0.0",
            "broker": "ibkr",
            "account": "U***00001",
            "summary": {},
            "transactions": [official_record],
        }

        for merged in (
            merge_investment_payloads(web_payload, official_payload),
            merge_investment_payloads(official_payload, web_payload),
        ):
            pair_rows = [
                record
                for record in merged["transactions"]
                if record.get("ticker") == "USD.CNH"
            ]
            forex_rows = [
                record
                for record in pair_rows
                if record.get("type") == "forex_trade_component"
            ]
            self.assertEqual(len(pair_rows), 1)
            self.assertEqual(len(forex_rows), 1)
            self.assertEqual(forex_rows[0]["source"]["file_kind"], "transactions")
            self.assertEqual(forex_rows[0]["commission_raw"], "-2.0")
            self.assertEqual(forex_rows[0]["net_amount_raw"], "-0.00862548")
            self.assertNotIn(
                "provisional_until_file_import",
                forex_rows[0]["source"],
            )
            self.assertNotIn("cash_delta_status", forex_rows[0]["source"])

    def test_existing_forex_component_reimport_remains_idempotent(self) -> None:
        record = {
            "date": "2026-09-08",
            "datetime": "2026-09-08 16:00:00",
            "type": "forex_trade_component",
            "currency": "USD",
            "description": "FX FROM CNH TO USD @ 0.149049",
            "quantity_raw": "297.58",
            "price_raw": "0.149049",
            "net_amount_raw": "297.58",
            "broker": "longbridge_sg",
            "account": "SG00000001",
            "source": {
                "file_kind": "longbridge_cash_flow",
                "row_number": 2,
            },
        }
        payload = {
            "schema_version": "3.0.0",
            "broker": "longbridge_sg",
            "account": "SG00000001",
            "summary": {},
            "transactions": [record],
        }

        first = merge_investment_payloads({}, payload)
        second = merge_investment_payloads(first, payload)

        self.assertEqual(len(first["transactions"]), 1)
        self.assertEqual(len(second["transactions"]), 1)

    def test_ibkr_web_paste_rejects_holdings_from_another_account(self) -> None:
        holdings_text = """Account
U00000002
Your Holdings
Instrument Position Last
ALFA
ALFA EXAMPLE FUND
1 10.00 0.00%
Cash Holdings
USD (base currency) 10.00"""

        with self.assertRaisesRegex(ValueError, "different accounts"):
            build_investment_payload_from_ibkr_web_pasted_text(
                trade_notifications_text=(
                    self._ibkr_current_web_trade_notifications_text()
                ),
                holdings_text=holdings_text,
            )

    def test_ibkr_compact_orders_paste_imports_only_filled_trade_without_fabricating_fee(
        self,
    ) -> None:
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
        self.assertEqual(
            transaction["source"]["fee_source"], "same_page_trade_fill_details"
        )
        self.assertEqual(transaction["source"]["fill_detail_count"], 2)
        self.assertNotIn("fee_missing_from_capture", transaction["source"])

    def test_ibkr_web_paste_retains_user_verified_cash_at_last_fill_datetime(
        self,
    ) -> None:
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
        self.assertEqual(
            payload["summary"]["cash_snapshot_source"], "ibkr_user_verified_app_cash"
        )
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

    def test_newer_ibkr_gainskeeper_cash_snapshot_replaces_older_user_capture(
        self,
    ) -> None:
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
        evidence = self._ibkr_gainskeeper_evidence_file().replace(
            b"</INVSTMTRS>",
            b"<INVBAL><BALLIST><BAL><NAME>Cash</NAME><VALUE>312.45</VALUE>"
            b"</BAL></BALLIST></INVBAL></INVSTMTRS>",
        )

        payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (evidence, "cash-boundary.gkx"),
            ]
        )

        self.assertEqual(payload["ending_cash"], "312.45")
        self.assertEqual(
            payload["summary"]["ending_cash_replay_as_of_datetime"],
            "2026-07-02 22:33:38",
        )
        self.assertEqual(
            payload["broker_summaries"]["ibkr"]["ending_cash_replay_as_of_datetime"],
            "2026-07-02 22:33:38",
        )

    def test_ibkr_same_day_file_cash_replaces_older_web_boundary_in_both_orders(
        self,
    ) -> None:
        web = {
            "broker": "ibkr",
            "account": "U00000001",
            "ending_cash": "100",
            "ending_cash_by_currency": {"USD": "100"},
            "summary": {
                "cash_snapshot_authoritative": True,
                "cash_snapshot_source": "ibkr_user_verified_app_cash",
                "ending_cash_as_of": "2026-07-02",
                "ending_cash_replay_as_of": "2026-07-02",
                "ending_cash_as_of_datetime": "2026-07-02 09:00:00",
                "ending_cash_replay_as_of_datetime": "2026-07-02 09:00:00",
            },
            "transactions": [],
        }
        evidence = self._ibkr_gainskeeper_evidence_file().replace(
            b"</INVSTMTRS>",
            b"<INVBAL><BALLIST><BAL><NAME>Cash</NAME><VALUE>312.45</VALUE>"
            b"</BAL></BALLIST></INVBAL></INVSTMTRS>",
        )
        file_payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (evidence, "cash-boundary.gkx"),
            ]
        )
        for first, second in ((web, file_payload), (file_payload, web)):
            with self.subTest(first=first["summary"]["cash_snapshot_source"]):
                merged = merge_investment_payloads(deepcopy(first), deepcopy(second))
                summary = merged["broker_summaries"]["ibkr"]
                self.assertEqual(summary["ending_cash"], "312.45")
                self.assertEqual(
                    summary["cash_snapshot_source"], "ibkr_gainskeeper_balances"
                )
                self.assertEqual(
                    summary["ending_cash_as_of_datetime"], "2026-07-02 22:33:38"
                )
                self.assertNotEqual(
                    summary.get("ending_cash_by_currency"), {"USD": "100"}
                )
                repeated = merge_investment_payloads(merged, deepcopy(web))
                self.assertEqual(
                    repeated["broker_summaries"]["ibkr"]["ending_cash"], "312.45"
                )

    def test_newer_ibkr_date_only_cash_clears_stale_file_datetime(self) -> None:
        older = {
            "schema_version": "3.0.0",
            "generator": {"generated_at": "2026-08-04T13:35:26"},
            "broker": "ibkr",
            "account": "U00000001",
            "ending_cash": "100",
            "ending_cash_by_currency": {"USD": "100"},
            "summary": {
                "ending_cash_raw": "100",
                "ending_cash_by_currency": {"USD": "100"},
                "cash_snapshot_source": "ibkr_gainskeeper_balances",
                "cash_snapshot_authoritative": True,
                "ending_cash_as_of": "2026-08-04",
                "ending_cash_replay_as_of": "2026-08-04",
                "ending_cash_as_of_datetime": "2026-08-04 13:35:26",
                "ending_cash_replay_as_of_datetime": "2026-08-04 13:35:26",
            },
            "transactions": [],
        }
        newer = {
            "schema_version": "3.0.0",
            "generator": {"generated_at": "2026-08-08T23:59:59"},
            "broker": "ibkr",
            "account": "U00000001",
            "ending_cash": "200",
            "ending_cash_by_currency": {"USD": "200"},
            "summary": {
                "ending_cash_raw": "200",
                "ending_cash_by_currency": {"USD": "200"},
                "cash_snapshot_source": "ibkr_csv_summary",
                "cash_snapshot_authoritative": True,
                "ending_cash_as_of": "2026-08-08",
                "ending_cash_replay_as_of": "2026-08-08",
            },
            "transactions": [],
        }

        for first, second in ((older, newer), (newer, older)):
            with self.subTest(first=first["summary"]["cash_snapshot_source"]):
                merged = merge_investment_payloads(
                    deepcopy(first),
                    deepcopy(second),
                )
                summary = merged["broker_summaries"]["ibkr"]
                self.assertEqual(summary["ending_cash"], "200")
                self.assertEqual(summary["ending_cash_by_currency"], {"USD": "200"})
                self.assertEqual(summary["ending_cash_as_of"], "2026-08-08")
                self.assertEqual(summary["ending_cash_replay_as_of"], "2026-08-08")
                self.assertNotIn("ending_cash_as_of_datetime", summary)
                self.assertNotIn("ending_cash_replay_as_of_datetime", summary)

    def test_ibkr_gainskeeper_other_transactions_preserve_source_identity(self) -> None:
        payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (
                    self._ibkr_gainskeeper_other_evidence_file(),
                    "other-transactions.gkx",
                ),
            ]
        )

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

    def test_ibkr_gainskeeper_merge_repairs_legacy_time_and_unidentified_rows(
        self,
    ) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (
                    self._ibkr_gainskeeper_other_evidence_file(),
                    "other-transactions.gkx",
                ),
            ]
        )
        legacy = deepcopy(incoming)
        legacy["transactions"][0]["datetime"] = "2025-09-08 20:14:18"
        legacy["transactions"][0]["source"].update(
            {
                "datetime_local_timezone": "Asia/Shanghai",
                "datetime_localized_from": "source_datetime_raw_explicit_offset",
                "datetime_localized_to": "Asia/Shanghai",
            }
        )
        legacy["transactions"][0]["source"].update(
            {
                "file_kind": "transactions",
                "fitid": "",
            }
        )
        legacy["transactions"][1]["type"] = "dividend_reinvestment"
        legacy["transactions"][1]["source"].update(
            {
                "file_kind": "transactions",
                "fitid": "",
            }
        )

        merged = merge_investment_payloads(legacy, incoming)

        self.assertEqual(len(merged["transactions"]), 3)
        self.assertEqual(
            sorted(
                transaction["source"]["fitid"] for transaction in merged["transactions"]
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

    def test_cross_broker_merge_preserves_current_cash_scope_and_hsbc_boundary(
        self,
    ) -> None:
        incoming = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (
                    self._ibkr_gainskeeper_evidence_file(),
                    "baseline.gkx",
                ),
            ]
        )
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

    def test_ibkr_web_paste_is_supplemental_after_gainskeeper_cutoff_in_either_order(
        self,
    ) -> None:
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
        gainskeeper_payload = build_investment_payload_from_ibkr_gainskeeper_files(
            [
                (self._ibkr_gainskeeper_evidence_file(), "baseline.gkx"),
            ]
        )
        gainskeeper_payload["ending_cash"] = "312.45"
        gainskeeper_payload["summary"].update(
            {
                "ending_cash_raw": "312.45",
                "cash_snapshot_source": "ibkr_csv_summary",
                "ending_cash_as_of": "2026-08-12",
                "ending_cash_replay_as_of": "2026-08-12",
            }
        )
        gainskeeper_payload["broker_summaries"]["ibkr"].update(
            {
                "ending_cash": "312.45",
                "ending_cash_raw": "312.45",
                "cash_snapshot_source": "ibkr_csv_summary",
                "ending_cash_as_of": "2026-08-12",
                "ending_cash_replay_as_of": "2026-08-12",
            }
        )

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

    def test_ibkr_web_paste_refines_existing_compact_fee_without_duplicate(
        self,
    ) -> None:
        compact_text = """Orders & Trades
Trade Notifications
DRAM @OvernightUS Overnight Trading
Sold 10 DRAM Limit 15.65, OVT
Sell 10
Filled
9:56 AM
15.65 U00000001 900001"""
        enriched_text = (
            compact_text
            + """
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
        )

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

    def test_ibkr_compact_aggregate_supersedes_exact_full_page_split_fill_payload(
        self,
    ) -> None:
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

    def test_repair_ibkr_compact_split_fill_duplicates_rebuilds_summary_counts(
        self,
    ) -> None:
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

    def test_ibkr_gainskeeper_split_fills_replace_matching_web_compact_aggregate(
        self,
    ) -> None:
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
            trade_notifications_text=self._ibkr_web_trade_notifications_text(),
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
                if record.get("ticker") == "DRAM" and record.get("price_raw") == "46"
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
            self.assertTrue(merged["summary"]["position_snapshot_authoritative"])
