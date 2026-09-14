"""Domain-focused investment-import regression mixin.

Code version: v0.1.0
"""

from __future__ import annotations

from tests.investment_import_test_support import (
    BrokerSettings,
    Decimal,
    Event,
    LONGBRIDGE_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES,
    MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES,
    Path,
    TemporaryDirectory,
    Thread,
    _normalize_source_artifacts,
    _parse_ibkr_statement_period,
    base64,
    build_investment_payload_from_ibkr_csvs,
    build_investment_payload_from_longbridge,
    clear_investment_store,
    contextmanager,
    date,
    deepcopy,
    hashlib,
    investment_evidence_dir_for,
    investment_source_artifact_storage_keys,
    load_investment_store_payload,
    materialize_investment_source_artifacts,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    patch,
    plan_missing_investment_evidence_recovery,
    restore_missing_investment_evidence,
    save_investment_store_payload,
    storage,
    update_investment_store_payload,
    verify_investment_source_artifacts,
    verify_persisted_investment_source_artifacts,
)


class LongbridgeEvidenceImportTestsMixin:
    def test_longbridge_import_fetches_large_ranges_in_windows(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        cli_calls: list[list[str]] = []

        def fake_cli_json(
            _settings: BrokerSettings,
            arguments: list[str],
            *,
            timeout_seconds: int = 30,
        ):
            cli_calls.append(arguments)
            if arguments[:2] == ["auth", "status"]:
                return {"account": {"member_id": "member-demo"}}
            if arguments[:2] == ["order", "--history"]:
                return {"orders": []}
            if arguments[:1] == ["cash-flow"]:
                return {"list": []}
            return None

        with (
            patch(
                "app.services.investment_import.run_longbridge_cli_json",
                side_effect=fake_cli_json,
            ),
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

        order_calls = [
            arguments
            for arguments in cli_calls
            if arguments[:2] == ["order", "--history"]
        ]
        cash_flow_calls = [
            arguments for arguments in cli_calls if arguments[:1] == ["cash-flow"]
        ]
        self.assertGreater(len(order_calls), 1)
        self.assertGreater(len(order_calls), len(cash_flow_calls))
        self.assertEqual(
            order_calls[0][order_calls[0].index("--start") + 1], "2022-12-02"
        )
        self.assertEqual(
            order_calls[0][order_calls[0].index("--end") + 1], "2023-01-30"
        )
        self.assertEqual(
            order_calls[-1][order_calls[-1].index("--end") + 1], "2026-06-15"
        )
        for arguments in order_calls + cash_flow_calls:
            start = arguments[arguments.index("--start") + 1]
            end = arguments[arguments.index("--end") + 1]
            self.assertLessEqual(
                (date.fromisoformat(end) - date.fromisoformat(start)).days + 1,
                LONGBRIDGE_IMPORT_WINDOW_DAYS
                if arguments[:1] == ["cash-flow"]
                else LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
            )
        self.assertEqual(
            payload["generator"]["history_order_window_count"], len(order_calls)
        )
        self.assertEqual(
            payload["generator"]["cash_flow_window_count"], len(cash_flow_calls)
        )

    def test_longbridge_import_keeps_order_gross_when_cash_flow_contract_amount_does_not_match(
        self,
    ) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )

        def fake_cli_json(
            _settings: BrokerSettings,
            arguments: list[str],
            *,
            timeout_seconds: int = 30,
        ):
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
            patch(
                "app.services.investment_import.run_longbridge_cli_json",
                side_effect=fake_cli_json,
            ),
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

        trade = next(
            transaction
            for transaction in payload["transactions"]
            if transaction["type"] == "buy"
        )
        self.assertEqual(trade["gross_amount_raw"], "-1088.00")
        self.assertEqual(trade["commission_raw"], "0")
        self.assertEqual(trade["net_amount_raw"], "-1088.00")
        self.assertFalse(trade["normalized"]["is_cash_flow"])
        self.assertIn("accounting_adjustment_amount", trade["normalized"])
        self.assertGreater(payload["summary"]["warning_count"], 0)

    def test_longbridge_import_retries_timeout_windows_with_smaller_ranges(
        self,
    ) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )
        order_windows: list[tuple[str, str]] = []

        def fake_cli_json(
            _settings: BrokerSettings,
            arguments: list[str],
            *,
            timeout_seconds: int = 30,
        ):
            if arguments[:2] == ["auth", "status"]:
                return {"account": {"member_id": "member-demo"}}
            if arguments[:2] == ["order", "--history"]:
                start = arguments[arguments.index("--start") + 1]
                end = arguments[arguments.index("--end") + 1]
                order_windows.append((start, end))
                if start == "2022-12-02" and end == "2023-01-30":
                    raise RuntimeError(
                        "API error (code 408): Request Timeout trace_id: demo"
                    )
                return {"orders": []}
            if arguments[:1] == ["cash-flow"]:
                return {"list": []}
            return None

        with (
            patch(
                "app.services.investment_import.run_longbridge_cli_json",
                side_effect=fake_cli_json,
            ),
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

    def test_import_accepts_official_realized_summary_without_open_positions(
        self,
    ) -> None:
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    'Statement,Data,Period,"July 3, 2023 - July 1, 2024"',
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Base Currency,USD",
                    "Summary,Data,Starting Cash,0.0",
                    "Summary,Data,Ending Cash,0.82051546680825",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2024-02-28,U***00001,Net Amount in Base from Forex Trade: 0.8205 USD.HKD,Forex Trade Component,USD.HKD,0.8205,7.82435,HKD,3.6043539374996936E-4,-,3.6043539374996936E-4",
                    "Transaction History,Data,2024-02-25,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,0.8205402,-,0.8205402",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,BrokerName,Interactive Brokers LLC",
                    "Statement,Data,Title,Realized Summary",
                    'Statement,Data,Period,"July 3, 2023 - July 1, 2024"',
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Account Information,Data,Base Currency,USD",
                    "Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change",
                    "Net Asset Value,Data,Cash ,0,0.820515467,0,0.820515467,0.820515467",
                    "Net Asset Value,Data,Total,0,0.820515467,0,0.820515467,0.820515467",
                    "Change in NAV,Header,Field Name,Field Value",
                    "Change in NAV,Data,Ending Value,0.820515467",
                    "Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm in USD,,,Code",
                    'Trades,Data,Order,Forex,HKD,USD.HKD,"2024-02-27, 21:34:19",0.8205,7.82435,-6.419879175,0,,,',
                    "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
                    "Deposits & Withdrawals,Data,HKD,2024-02-25,Electronic Fund Transfer,6.42",
                ]
            )
            + "\n"
        )

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
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    'Statement,Data,Period,"January 1, 2026 - June 30, 2026"',
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Base Currency,USD",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,4,000",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-06-18,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,1105.575,-,1105.575",
                    "Transaction History,Data,2026-06-18,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,1105.575,-,1105.575",
                    "Transaction History,Data,2026-06-19,U***00001,Electronic Fund Transfer,Deposit,-,-,-,-,2948.2,-,2948.2",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,BrokerName,Interactive Brokers LLC",
                    "Statement,Data,Title,Realized Summary",
                    'Statement,Data,Period,"January 1, 2026 - June 30, 2026"',
                    "Account Information,Header,Field Name,Field Value",
                    "Account Information,Data,Account,U00000001",
                    "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
                    "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,7500",
                    "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,7500",
                    "Deposits & Withdrawals,Data,CNH,2026-06-19,Electronic Fund Transfer,20000",
                    "Deposits & Withdrawals,Data,CNH,2026-06-01,Electronic Fund Transfer,5000",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Total,,Stocks,USD,,,,,,0,,0,0,",
                ]
            )
            + "\n"
        )

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
        self.assertTrue(
            all(
                record["source"]["file_kind"] == "ibkr_realized_summary_cash"
                for record in cash_records
            )
        )
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

    def test_merge_removes_stale_ibkr_base_cash_after_native_summary_import(
        self,
    ) -> None:
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
            if record.get("broker") == "ibkr" and record.get("type") == "deposit"
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
        period_two_transactions = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0.82051547405775",
                    "Summary,Data,Ending Cash,0.018767169049200002",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2024-11-28,U***00001,Example,Deposit,-,-,-,-,1,-,1",
                ]
            )
            + "\n"
        )
        period_two_positions = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Data,Summary,Stocks,USD,IBKR,-,0.0008,1,48.91,0.039128,56.32,0.05,0.010872,",
                    "Open Positions,Data,Lot,Stocks,USD,IBKR,2024-11-28 (Vesting: 2025-11-28),0.0008,,48.91,0.039128,56.32,0.05,0.010872,Un;ST",
                ]
            )
            + "\n"
        )
        period_three_transactions = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0.018767169049200002",
                    "Summary,Data,Ending Cash,20.1543564743363",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-01-29,U***00001,INTERACTIVE BROKERS GRO-CL A,Buy,IBKR,1.0,75.5,USD,-75.5,-0.34915725,-84.25",
                ]
            )
            + "\n"
        )
        period_three_positions = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Data,Summary,Stocks,USD,IBKR,-,4.25,1,64.25,272.5,94.7,400.0,127.5,",
                    'Open Positions,Data,Lot,Stocks,USD,IBKR,"2026-01-29, 19:23:43 (Vesting: 2026-09-11)",4.25,,64.25,272.5,94.7,400.0,127.5,Un;ST',
                ]
            )
            + "\n"
        )

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
        transactions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Transaction History",
                    "Summary,Header,Field Name,Field Value",
                    "Summary,Data,Starting Cash,0",
                    "Summary,Data,Ending Cash,100",
                    "Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount",
                    "Transaction History,Data,2026-04-01,U***TEST,Example Buy,Buy,QQQ,1,100,USD,-100,-1,-101",
                ]
            )
            + "\n"
        )
        positions_csv = (
            "\n".join(
                [
                    "Statement,Header,Field Name,Field Value",
                    "Statement,Data,Title,Realized Summary",
                    "Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Open,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code",
                    "Open Positions,Data,Summary,Stocks,USD,QQQ,-,1,1,100,100,105,105,5,",
                ]
            )
            + "\n"
        )

        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv.encode("utf-8"),
            positions_csv.encode("utf-8"),
        )

        self.assertTrue(payload["summary"]["position_snapshot_authoritative"])
        self.assertEqual(
            payload["summary"]["position_snapshot_source"],
            "ibkr_csv_open_positions",
        )

    def test_ibkr_same_day_position_snapshot_prefers_later_observed_capture(
        self,
    ) -> None:
        payload = normalize_investment_payload_tickers(
            {
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
            }
        )

        snapshot = payload["broker_snapshots"]["ibkr:U00000001"]
        self.assertEqual(snapshot["position_snapshot"]["DRAM"]["quantity"], "75")
        self.assertEqual(snapshot["position_snapshot_as_of"], "2026-08-14")

    def test_ibkr_broker_summary_mirrors_cumulative_csv_performance_snapshot(
        self,
    ) -> None:
        payload = normalize_investment_payload_tickers(
            {
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
                        "evidence": [
                            {
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
                            }
                        ],
                    },
                },
            }
        )

        summary = payload["broker_summaries"]["ibkr"]
        self.assertEqual(
            summary["performance_snapshot"]["META"]["realized_total"],
            "1006.83260375",
        )
        self.assertEqual(
            summary["performance_snapshot_source"],
            "ibkr_csv_realized_summary",
        )

    def test_ibkr_csv_persists_exact_source_evidence_and_per_account_snapshot(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv,
            positions_csv,
            transaction_filename="transactions-mtd.csv",
            positions_filename="realized-summary-mtd.csv",
        )
        self.assertEqual(len(payload["source_artifacts"]), 2)
        self.assertTrue(
            all(
                "content_base64" in artifact for artifact in payload["source_artifacts"]
            )
        )

        mixed_payload = merge_investment_payloads(
            payload,
            {
                "schema_version": "3.0.0",
                "broker": "hsbc",
                "account": "000-999999-999",
                "transactions": [],
            },
        )
        ibkr_snapshot = mixed_payload["broker_snapshots"]["ibkr:U00000001"]
        self.assertEqual(ibkr_snapshot["position_snapshot"]["QQQ"]["quantity"], "1")
        self.assertEqual(ibkr_snapshot["performance_snapshot"]["QQQ"]["total"], "10")
        self.assertEqual(
            ibkr_snapshot["position_snapshot_source"], "ibkr_csv_open_positions"
        )

        expected_bytes_by_source_kind = {
            "ibkr_transaction_history_csv": transactions_csv,
            "ibkr_realized_summary_csv": positions_csv,
        }
        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(
                mixed_payload, ledger_path
            )
            verify_investment_source_artifacts(materialized, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            reloaded = load_investment_store_payload(ledger_path)
            verify_investment_source_artifacts(reloaded, ledger_path)
            self.assertEqual(
                reloaded["broker_snapshots"], materialized["broker_snapshots"]
            )
            self.assertTrue(
                all(
                    "content_base64" not in artifact
                    for artifact in reloaded["source_artifacts"]
                )
            )
            evidence_directory = investment_evidence_dir_for(ledger_path)
            for artifact in reloaded["source_artifacts"]:
                self.assertEqual(
                    (evidence_directory / f"{artifact['sha256']}.bin").read_bytes(),
                    expected_bytes_by_source_kind[artifact["source_kind"]],
                )
            self.assertTrue(clear_investment_store(ledger_path))
            self.assertFalse(evidence_directory.exists())

    def test_persisted_investment_evidence_scan_detects_a_missing_source_file(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv, positions_csv
        )

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)

            self.assertEqual(
                verify_persisted_investment_source_artifacts(ledger_path),
                len(materialized["source_artifacts"]),
            )
            missing_artifact = materialized["source_artifacts"][0]
            (
                investment_evidence_dir_for(ledger_path)
                / f"{missing_artifact['sha256']}.bin"
            ).unlink()
            with self.assertRaisesRegex(RuntimeError, "file is missing"):
                verify_persisted_investment_source_artifacts(ledger_path)

    def test_incremental_import_can_preserve_known_historical_evidence_gaps(
        self,
    ) -> None:
        source_bytes = b"historical,source\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [
                {
                    "sha256": source_sha256,
                    "byte_count": len(source_bytes),
                    "content_encoding": "base64",
                    "content_base64": base64.b64encode(source_bytes).decode("ascii"),
                }
            ],
        }

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            evidence_path = (
                investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"
            )
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

    def test_corrupt_legacy_investment_json_fails_closed_without_creating_parquet(
        self,
    ) -> None:
        with TemporaryDirectory() as temporary_directory:
            legacy_path = Path(temporary_directory) / "investment.json"
            corrupt_bytes = b'{"transactions": ['
            legacy_path.write_bytes(corrupt_bytes)
            parquet_path = legacy_path.with_suffix(".parquet")

            with self.assertRaisesRegex(
                RuntimeError, "legacy investment ledger could not be read safely"
            ):
                load_investment_store_payload(legacy_path)
            self.assertEqual(legacy_path.read_bytes(), corrupt_bytes)
            self.assertFalse(parquet_path.exists())

            with self.assertRaisesRegex(
                RuntimeError, "legacy investment ledger could not be read safely"
            ):
                update_investment_store_payload(
                    lambda current: ({"broker": "ibkr"}, None),
                    legacy_path,
                )
            self.assertEqual(legacy_path.read_bytes(), corrupt_bytes)
            self.assertFalse(parquet_path.exists())

    def test_source_evidence_preserves_crlf_bytes_and_reports_the_changed_file(
        self,
    ) -> None:
        source_bytes = b"header,amount\r\nQQQ,100\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [
                {
                    "source_kind": "unit_test_csv",
                    "sha256": source_sha256,
                    "byte_count": len(source_bytes),
                    "content_encoding": "base64",
                    "content_base64": base64.b64encode(source_bytes).decode("ascii"),
                }
            ],
        }

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialized = materialize_investment_source_artifacts(payload, ledger_path)
            save_investment_store_payload(materialized, ledger_path)
            evidence_path = (
                investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"
            )

            self.assertEqual(evidence_path.read_bytes(), source_bytes)
            self.assertEqual(
                verify_persisted_investment_source_artifacts(ledger_path), 1
            )

            evidence_path.write_bytes(source_bytes.replace(b"\r\n", b"\n"))
            with self.assertRaisesRegex(RuntimeError, "file has changed") as raised:
                verify_persisted_investment_source_artifacts(ledger_path)

        self.assertIn(str(evidence_path), str(raised.exception))
        self.assertIn("do not normalize line endings", str(raised.exception))

    def test_missing_source_evidence_can_be_restored_from_exact_original_bytes(
        self,
    ) -> None:
        source_bytes = b"header,amount\r\nQQQ,100\r\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "source_artifacts": [
                {
                    "source_kind": "unit_test_csv",
                    "sha256": source_sha256,
                    "byte_count": len(source_bytes),
                    "content_encoding": "base64",
                    "content_base64": base64.b64encode(source_bytes).decode("ascii"),
                }
            ],
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
            evidence_path = (
                investment_evidence_dir_for(ledger_path) / f"{source_sha256}.bin"
            )
            evidence_path.unlink()

            restored_count = restore_missing_investment_evidence(
                ledger_path, source_dir
            )

            self.assertEqual(restored_count, 1)
            self.assertEqual(evidence_path.read_bytes(), source_bytes)
            self.assertEqual(
                verify_persisted_investment_source_artifacts(ledger_path), 1
            )

    def test_missing_source_evidence_can_restore_only_exact_archive_matches(
        self,
    ) -> None:
        matched_bytes = b"header,amount\r\nQQQ,100\r\n"
        unmatched_bytes = b"header,amount\r\nDRAM,200\r\n"
        artifacts = []
        for source_bytes in (matched_bytes, unmatched_bytes):
            source_sha256 = hashlib.sha256(source_bytes).hexdigest()
            artifacts.append(
                {
                    "source_kind": "unit_test_csv",
                    "sha256": source_sha256,
                    "byte_count": len(source_bytes),
                    "content_encoding": "base64",
                    "content_base64": base64.b64encode(source_bytes).decode("ascii"),
                }
            )

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            ledger_path = root / "store" / "investment.parquet"
            source_dir = root / "originals"
            ledger_path.parent.mkdir()
            source_dir.mkdir()
            materialized = materialize_investment_source_artifacts(
                {"source_artifacts": artifacts},
                ledger_path,
            )
            save_investment_store_payload(materialized, ledger_path)
            evidence_dir = investment_evidence_dir_for(ledger_path)
            for artifact in artifacts:
                (evidence_dir / f"{artifact['sha256']}.bin").unlink()
            (source_dir / "broker-export.csv").write_bytes(matched_bytes)

            self.assertEqual(
                plan_missing_investment_evidence_recovery(ledger_path, source_dir),
                (2, 1, 1),
            )
            with self.assertRaisesRegex(RuntimeError, "does not contain exact bytes"):
                restore_missing_investment_evidence(ledger_path, source_dir)
            self.assertTrue(
                all(
                    not (evidence_dir / f"{artifact['sha256']}.bin").exists()
                    for artifact in artifacts
                )
            )

            restored_count = restore_missing_investment_evidence(
                ledger_path,
                source_dir,
                require_complete=False,
            )

            self.assertEqual(restored_count, 1)
            matched_sha256 = hashlib.sha256(matched_bytes).hexdigest()
            unmatched_sha256 = hashlib.sha256(unmatched_bytes).hexdigest()
            self.assertEqual(
                (evidence_dir / f"{matched_sha256}.bin").read_bytes(),
                matched_bytes,
            )
            self.assertFalse((evidence_dir / f"{unmatched_sha256}.bin").exists())
            with self.assertRaisesRegex(RuntimeError, "file is missing"):
                verify_persisted_investment_source_artifacts(ledger_path)

    def test_source_artifact_normalization_rejects_forged_storage_key_and_byte_count(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv, positions_csv
        )

        forged_storage_key_payload = deepcopy(payload)
        forged_storage_key_payload["source_artifacts"][0]["storage_key"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "storage key does not match"):
            normalize_investment_payload_tickers(forged_storage_key_payload)

        malformed_byte_count_payload = deepcopy(payload)
        malformed_byte_count_payload["source_artifacts"][0]["byte_count"] = (
            "not-a-byte-count"
        )
        with self.assertRaisesRegex(ValueError, "invalid byte count"):
            normalize_investment_payload_tickers(malformed_byte_count_payload)

    def test_source_artifact_normalization_never_silently_skips_malformed_entries(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "manifest is malformed"):
            _normalize_source_artifacts([None])

    def test_materialized_evidence_rejects_raw_bytes_and_enforces_storage_limits(
        self,
    ) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv, positions_csv
        )
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
                patch.object(
                    storage, "MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES", max(source_sizes)
                ),
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
            with self.assertRaisesRegex(
                RuntimeError, "must not retain raw source evidence bytes"
            ):
                verify_investment_source_artifacts(leaked_payload, ledger_path)

        self.assertGreater(MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES, max(source_sizes))
        self.assertGreater(MAX_INVESTMENT_SOURCE_EVIDENCE_BYTES, sum(source_sizes))

    def test_materialization_waits_for_the_same_ledger_lock_used_by_clear(self) -> None:
        transactions_csv, positions_csv = self._ibkr_csv_evidence_pair()
        payload = build_investment_payload_from_ibkr_csvs(
            transactions_csv, positions_csv
        )

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
                    raise RuntimeError(
                        "Timed out while coordinating the investment-store clear test."
                    )
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
                patch.object(
                    storage,
                    "_write_immutable_evidence_bytes",
                    side_effect=track_materialization,
                ),
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

    def test_clear_investment_store_keeps_the_ledger_lock_while_removing_evidence(
        self,
    ) -> None:
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
                patch.object(
                    storage.shutil, "rmtree", side_effect=remove_evidence_directory
                ),
            ):
                self.assertTrue(clear_investment_store(ledger_path))

            self.assertFalse(ledger_path.exists())
            self.assertFalse(evidence_directory.exists())

    def test_ibkr_statement_period_parser_accepts_standard_csv_metadata(self) -> None:
        self.assertEqual(
            _parse_ibkr_statement_period("July 1, 2026 - July 31, 2026"),
            ("2026-07-01", "2026-07-31"),
        )
