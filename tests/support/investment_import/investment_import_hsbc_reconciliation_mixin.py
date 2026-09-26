"""Domain-focused investment-import regression mixin.

Code version: v0.3.1
- Changed: A sell cash match commits only with its complete same-scope fee row.
"""

from __future__ import annotations

from tests.support.investment_import.investment_import_test_support import (
    Decimal,
    _build_hsbc_cash_account_records_from_text,
    _parse_hsbc_order_status_plain_text,
    _sort_transactions,
    apply_hsbc_order_execution_notification_timestamps,
    build_investment_payload_from_hsbc_pasted_text,
    deepcopy,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
)

from app.services.investment.importing.brokers.hsbc.cash import (
    _match_hsbc_orders_to_cash_settlements,
)


class HsbcReconciliationImportTestsMixin:
    def test_hsbc_cash_matcher_rejects_fee_from_another_cash_scope(self) -> None:
        order = {
            "date": "2026-09-17",
            "type": "sell",
            "ticker": "QQQI",
            "currency": "USD",
            "account": "ACCOUNT-A",
            "net_amount_raw": "59.99",
            "normalized": {"net_amount": "59.99"},
            "source": {"order_id": "S-900001"},
        }

        def cash_record(
            *,
            amount: str,
            account: str,
            account_type: str,
            currency: str,
            row_number: int,
        ) -> dict[str, object]:
            return {
                "date": "2026-09-18",
                "type": "deposit" if Decimal(amount) > 0 else "fee",
                "currency": currency,
                "account": account,
                "description": "REF S900001001 SEC",
                "net_amount_raw": amount,
                "source": {
                    "file_kind": "hsbc_usd_account_text",
                    "source_sequence_sha256": "a" * 64,
                    "row_number": row_number,
                    "ledger_sequence": row_number,
                    "account_number": account,
                    "account_type": account_type,
                    "balance_after_raw": "1200.00" if amount == "59.99" else "",
                },
            }

        principal = cash_record(
            amount="59.99",
            account="ACCOUNT-A",
            account_type="USD Savings",
            currency="USD",
            row_number=44,
        )
        foreign_fee = cash_record(
            amount="-0.01",
            account="ACCOUNT-B",
            account_type="HKD Savings",
            currency="HKD",
            row_number=45,
        )

        _match_hsbc_orders_to_cash_settlements(
            [order],
            [principal, foreign_fee],
            [],
        )

        self.assertNotIn("cash_settlement_postings", order["source"])
        self.assertEqual(order["net_amount_raw"], "59.99")
        self.assertNotIn("cash_flow_fee_amount_raw", order["source"])
        self.assertNotIn("presentation_hidden", principal)
        self.assertNotIn("presentation_hidden", foreign_fee)

    def test_hsbc_cash_matcher_rejects_ambiguous_principal_domains(self) -> None:
        def order() -> dict[str, object]:
            return {
                "date": "2026-09-17",
                "type": "sell",
                "ticker": "QQQI",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "net_amount_raw": "59.99",
                "normalized": {"net_amount": "59.99"},
                "source": {"order_id": "S-900001"},
            }

        def principal(account_type: str, digest: str) -> dict[str, object]:
            return {
                "date": "2026-09-18",
                "type": "deposit",
                "currency": "USD",
                "account": "ACCOUNT-A",
                "description": "REF S900001001 SEC",
                "net_amount_raw": "59.99",
                "source": {
                    "file_kind": "hsbc_usd_account_text",
                    "source_sequence_sha256": digest,
                    "row_number": 44,
                    "ledger_sequence": 44,
                    "account_number": "ACCOUNT-A",
                    "account_type": account_type,
                    "balance_after_raw": "1200.00",
                },
            }

        usd_savings = principal("USD Savings", "a" * 64)
        foreign_currency_savings = principal(
            "Foreign Currency Savings USD",
            "b" * 64,
        )
        for candidates in (
            [usd_savings, foreign_currency_savings],
            [foreign_currency_savings, usd_savings],
        ):
            candidate_order = order()
            _match_hsbc_orders_to_cash_settlements(
                [candidate_order],
                deepcopy(candidates),
                [],
            )
            self.assertNotIn(
                "cash_settlement_postings",
                candidate_order["source"],
            )

    def test_hsbc_pasted_import_annotates_unsettled_orders_from_available_cash(
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
                "22 Jun 2026 U.S. ET",
                "Fully Executed",
                "Buy",
                "Limit Price Order",
                "80.500USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "P-900002",
            ]
        )
        cash_account_text = "\n".join(
            [
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
                "HK154805J2FUKAYO",
                "1,000.00",
                "1,000.00",
                "Download",
            ]
        )

        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
        )

        deposit = next(
            txn
            for txn in payload["transactions"]
            if txn["description"] == "HK154805J2FUKAYO"
        )
        buy_order = next(
            txn
            for txn in payload["transactions"]
            if txn["ticker"] == "DRAM" and txn["type"] == "buy"
        )

        self.assertEqual(payload["ending_cash"], "1000.00")
        self.assertEqual(payload["summary"]["cash_ledger_balance"], "1000.00")
        self.assertEqual(payload["summary"]["hsbc_bank_available_cash"], "919.50")
        self.assertEqual(
            payload["summary"]["hsbc_pending_settlement_cash"],
            "-80.500",
        )
        self.assertEqual(payload["summary"]["hsbc_broker_cash_estimate"], "919.500")
        self.assertEqual(
            payload["broker_summaries"]["hsbc"]["ending_cash_by_currency"],
            {"USD": "1000.00"},
        )
        self.assertIn("available_cash_after_raw", deposit["source"])
        self.assertNotIn("available_cash_after_raw", buy_order["source"])
        self.assertNotIn("available_cash_calibration_source", buy_order["source"])
        self.assertEqual(buy_order["source"]["order_status_source_row_number"], 1)
        self.assertEqual(buy_order["source"]["order_status_page_order"], "newest_first")

    def test_hsbc_legacy_summary_recovers_current_ledger_from_latest_posting(
        self,
    ) -> None:
        payload = {
            "schema_version": 1,
            "broker": "multiple",
            "account": "multiple",
            "summary": {
                "authoritative_current_cash_brokers": ["hsbc"],
                "hsbc_bank_available_cash": "23388.54",
                "hsbc_ending_cash_components": {
                    "USD:SAVINGS": "23388.54",
                    "HKD:SAVINGS": "89.24",
                },
                "hsbc_cash_component_post_dates": {
                    "USD:SAVINGS": "2026-08-19",
                    "HKD:SAVINGS": "2026-08-06",
                },
            },
            "broker_summaries": {
                "hsbc": {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "cash_snapshot_authoritative": True,
                    "ending_cash": "23388.54",
                    "ending_cash_base_currency": "23388.54",
                    "ending_cash_base_currency_as_of": "2026-08-19",
                    "ending_cash_by_currency": {
                        "USD": "23388.54",
                        "HKD": "89.24",
                    },
                    "hsbc_bank_available_cash": "23388.54",
                },
            },
            "transactions": [
                {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "date": "2026-08-18",
                    "type": "buy",
                    "currency": "USD",
                    "net_amount_raw": "-275.70",
                    "source": {
                        "cash_settlement_date": "2026-08-19",
                        "cash_settlement_balance_after_raw": "23688.24",
                        "cash_settlement_source_row_number": 49,
                        "cash_settlement_postings": [
                            {
                                "date": "2026-08-19",
                                "currency": "USD",
                                "ledger_sequence": 49,
                                "row_number": 49,
                                "balance_after_raw": "23688.24",
                            }
                        ],
                    },
                },
                {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "date": "2026-08-18",
                    "type": "buy",
                    "currency": "USD",
                    "net_amount_raw": "-275.70",
                    "source": {
                        "cash_settlement_date": "2026-08-19",
                        "cash_settlement_balance_after_raw": "23412.54",
                        "cash_settlement_source_row_number": 50,
                        "cash_settlement_postings": [
                            {
                                "date": "2026-08-19",
                                "currency": "USD",
                                "ledger_sequence": 50,
                                "row_number": 50,
                                "balance_after_raw": "23412.54",
                            }
                        ],
                    },
                },
                {
                    "broker": "hsbc",
                    "account": "000-999999-999",
                    "date": "2026-08-19",
                    "type": "buy",
                    "currency": "USD",
                    "net_amount_raw": "-24.600",
                    "source": {
                        "cash_replay_pending_settlement": True,
                        "statement_order_id": "P-740362",
                    },
                },
            ],
        }

        normalized = normalize_investment_payload_tickers(deepcopy(payload))
        normalized_again = normalize_investment_payload_tickers(deepcopy(normalized))
        hsbc_summary = normalized["broker_summaries"]["hsbc"]

        self.assertEqual(hsbc_summary["cash_ledger_balance"], "23412.54")
        self.assertEqual(hsbc_summary["hsbc_bank_available_cash"], "23388.54")
        self.assertEqual(hsbc_summary["hsbc_pending_settlement_cash"], "-24.600")
        self.assertEqual(hsbc_summary["hsbc_broker_cash_estimate"], "23387.940")
        self.assertEqual(
            hsbc_summary["ending_cash_by_currency"],
            {"USD": "23412.54", "HKD": "89.24"},
        )
        self.assertEqual(
            normalized_again["broker_summaries"]["hsbc"],
            hsbc_summary,
        )

    def test_hsbc_merge_prunes_stale_available_cash_before_settlement_window(
        self,
    ) -> None:
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
            portfolio_text="\n".join(
                [
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
                ]
            ),
            order_status_text="\n".join(
                [
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
                ]
            ),
            cash_account_text="\n".join(
                [
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
                    "HK154805J2FUKAYO",
                    "1,000.00",
                    "1,000.00",
                    "Download",
                ]
            ),
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

    def test_hsbc_pasted_import_parses_sell_order_references_with_s_prefix(
        self,
    ) -> None:
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
                "Sell",
                "Limit Price Order",
                "117.020USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "S-900005",
            ]
        )
        account_number, rows = _parse_hsbc_order_status_plain_text(order_status_text)
        self.assertEqual(account_number, "000-999999-999")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["order_reference"], "S-900005")
        self.assertEqual(rows[0]["transaction_type"], "Sell")

    def test_hsbc_pasted_import_attaches_split_sell_sec_fee_to_order(self) -> None:
        portfolio_text = "\n".join(
            [
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
                "Sell",
                "Limit Price Order",
                "117.020USD1",
                "Quantity",
                "Executed quantity1 share(s)",
                "Outstanding quantity0 share(s)",
                "S-900005",
            ]
        )
        cash_account_text = "\n".join(
            [
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
                "HK292344JOFHL25I 292",
                "2,200.00",
                "4,243.53",
                "Download",
            ]
        )

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
        portfolio_text = "\n".join(
            [
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
            ]
        )
        cash_account_text = "\n".join(
            [
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
            ]
        )

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
            portfolio_text="\n".join(
                [
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
                ]
            ),
            order_status_text="\n".join(
                [
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
                ]
            ),
            cash_account_text="\n".join(
                [
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
                ]
            ),
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

    def test_hsbc_unsettled_orders_do_not_receive_synthetic_available_cash(
        self,
    ) -> None:
        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="\n".join(
                [
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
                ]
            ),
            order_status_text="\n".join(
                [
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
                ]
            ),
            cash_account_text="\n".join(
                [
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
                ]
            ),
        )

        unsettled_order = next(
            txn
            for txn in payload["transactions"]
            if txn["type"] == "buy" and txn["ticker"] == "DRAM"
        )

        self.assertTrue(unsettled_order["source"]["cash_replay_pending_settlement"])
        self.assertNotIn("available_cash_after_raw", unsettled_order["source"])
        self.assertEqual(payload["ending_cash"], "18124.43")

    def test_hsbc_cash_account_keeps_ref_rows_hidden_and_csv_calibrated_deposits_positive(
        self,
    ) -> None:
        cash_account_text = "\n".join(
            [
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
            ]
        )

        _, _, _, cash_records = _build_hsbc_cash_account_records_from_text(
            cash_account_text,
            warnings=[],
        )

        self.assertEqual(len(cash_records), 3)
        visible_records = [
            record
            for record in cash_records
            if not record.get("exclude_from_holdings_replay")
        ]
        self.assertEqual(len(visible_records), 1)
        self.assertEqual(visible_records[0]["description"], "USD CLEARING CHEQUE")
        self.assertEqual(visible_records[0]["type"], "deposit")
        self.assertEqual(visible_records[0]["net_amount_raw"], "89.64")
        hidden_ref_records = [
            record
            for record in cash_records
            if record.get("exclude_from_holdings_replay")
        ]
        self.assertEqual(len(hidden_ref_records), 2)
        self.assertTrue(
            all(
                record.get("presentation_hidden", False)
                for record in hidden_ref_records
            )
        )

    def test_hsbc_cash_account_uses_adjacent_balance_for_pending_broker_deposit(
        self,
    ) -> None:
        cash_account_text = "\n".join(
            [
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
                "HK154805J2FUKAYO",
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
                "HK292344JOFHL25I 292",
                "2,200.00",
                "4,243.53",
                "Download",
            ]
        )

        _, available_balance, ledger_balance, cash_records = (
            _build_hsbc_cash_account_records_from_text(
                cash_account_text,
                warnings=[],
            )
        )

        pending_broker_deposit = next(
            record
            for record in cash_records
            if record["description"] == "HK154805J2FUKAYO"
        )
        self.assertEqual(available_balance, Decimal("21834.41"))
        self.assertEqual(ledger_balance, Decimal("25857.41"))
        self.assertEqual(pending_broker_deposit["type"], "deposit")
        self.assertEqual(pending_broker_deposit["net_amount_raw"], "21496.88")
        self.assertFalse(pending_broker_deposit.get("presentation_hidden", False))
        self.assertFalse(
            pending_broker_deposit.get("exclude_from_holdings_replay", False)
        )

    def test_hsbc_terminal_mobile_withdrawal_uses_description_direction(self) -> None:
        cash_only_payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text="",
            order_status_text="",
            cash_account_text="\n".join(
                [
                    "Skip to the main content for this pageHSBC Logo-this will redirect to My accounts",
                    "HKD Savings",
                    "Account number:",
                    "000-999999-999",
                    "Ledger balance:",
                    "17.45",
                    "HKD",
                    "Available balance:",
                    "17.45 HKD",
                    "Post date Description Amount in Amount out Balance Additional options",
                    "23 Mar 2026",
                    "MOBILE WITHDRAWAL (22MAR26)",
                    "100.00",
                    "17.45",
                    "Download",
                ]
            ),
        )

        self.assertEqual(len(cash_only_payload["transactions"]), 1)
        withdrawal = cash_only_payload["transactions"][0]
        self.assertEqual(withdrawal["type"], "withdrawal")
        self.assertEqual(withdrawal["net_amount_raw"], "-100.00")

        repeated = merge_investment_payloads(
            deepcopy(cash_only_payload),
            deepcopy(cash_only_payload),
        )
        self.assertEqual(len(repeated["transactions"]), 1)
        self.assertEqual(
            repeated["summary"]["incremental_import"]["added_record_count"],
            0,
        )
        self.assertEqual(
            repeated["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_hsbc_cash_account_sort_keeps_same_day_ledger_sequence(self) -> None:
        cash_account_text = "\n".join(
            [
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
                "HK605822G6G9NWOW",
                "2,946.63",
                "19,676.30",
                "26 Jun 2026",
                "HK041439P4004143",
                "100.88",
                "16,729.67",
                "26 Jun 2026",
                "HK417567DVG9ZN5S",
                "78.00",
                "16,830.55",
                "25 Jun 2026",
                "REF P900040001 SEC",
                "115.00",
                "16,752.55",
                "Download",
            ]
        )

        _, _, _, cash_records = _build_hsbc_cash_account_records_from_text(
            cash_account_text,
            warnings=[],
        )
        _sort_transactions(cash_records)

        self.assertEqual(
            [
                record["net_amount_raw"]
                for record in cash_records
                if record["date"] == "2026-06-26"
            ],
            ["78.00", "-100.88", "2946.63"],
        )

    def test_hsbc_order_status_sort_preserves_page_sequence_after_settlement_enrichment(
        self,
    ) -> None:
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

    def test_hsbc_execution_notification_timestamp_replaces_only_date_fallback(
        self,
    ) -> None:
        def order_record(
            order_id: str, side: str, source_rank: int
        ) -> dict[str, object]:
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
                    "sender": "notifications@hsbc.com.hk",
                    "gmail_message_id": "gmail-p596756",
                },
                {
                    "order_id": "S-900004",
                    "notification_datetime": "2026-08-07 15:07:08",
                    "notification_timezone": "America/New_York",
                    "side": "sell",
                    "ticker": "DRAM",
                    "quantity": "2",
                    "sender": "notifications@hsbc.com.hk",
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
            [
                transaction["source"]["order_id"]
                for transaction in payload["transactions"]
            ],
            ["P-900006", "S-900004"],
        )
        purchase = payload["transactions"][0]
        self.assertEqual(purchase["datetime"], "2026-08-07 10:43:40")
        self.assertEqual(
            purchase["source"]["datetime_source_field"],
            "hsbc_order_execution_notification_sent_at",
        )
        self.assertTrue(purchase["source"]["datetime_is_execution_notification_proxy"])

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
            preserved_purchase["source"][
                "hsbc_order_execution_notification_gmail_message_id"
            ],
            "gmail-p596756",
        )

    def test_hsbc_execution_notification_timestamp_refreshes_legacy_email_proxy(
        self,
    ) -> None:
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
                    "sender": "notifications@hsbc.com.hk",
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

    def test_hsbc_merge_reuses_statement_order_id_when_settlement_adjusts_amounts(
        self,
    ) -> None:
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
            portfolio_text="\n".join(
                [
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
                ]
            ),
            order_status_text="\n".join(
                [
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
                ]
            ),
            cash_account_text="\n".join(
                [
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
                ]
            ),
        )

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        merge_details = merged["summary"]["incremental_import"]

        self.assertEqual(len(merged["transactions"]), 2)
        self.assertEqual(merge_details["added_record_count"], 0)
        self.assertEqual(merge_details["duplicate_record_count"], 2)
        self.assertFalse(
            any(
                txn["description"].startswith("REF P") for txn in merged["transactions"]
            )
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
