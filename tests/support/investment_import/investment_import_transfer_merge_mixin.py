"""Domain-focused investment-import regression mixin.

Code version: v0.1.1
"""

from __future__ import annotations

from tests.support.investment_import.investment_import_test_support import (
    Decimal,
    _replay_holdings,
    _validate_holdings,
    build_investment_internal_transfer_binding_index,
    build_investment_internal_transfer_binding_key,
    deepcopy,
    get_investment_internal_transfer_link_window_days,
    json,
    merge_investment_payloads,
    normalize_investment_payload_tickers,
    patch,
    refresh_investment_security_transfer_reconciliation,
    validate_investment_internal_transfer_binding,
)


class TransferMergeImportTestsMixin:
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
            if txn.get("broker") == "ibkr"
            and txn.get("type") == "grant"
            and txn.get("ticker") == "IBKR"
        ]

        self.assertEqual(len(ibkr_grants), 1)
        self.assertEqual(ibkr_grants[0]["quantity_raw"], "4.25")
        self.assertTrue(
            merged["summary"]["incremental_import"]["mixed_brokers_or_accounts"]
        )

    def test_merge_keeps_latest_account_fx_translation_pnl_from_overlapping_imports(
        self,
    ) -> None:
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
            merged["summary"]["incremental_import"][
                "superseded_fx_translation_pnl_count"
            ],
            3,
        )

    def test_merge_collapses_duplicate_fx_translation_pnl_slots_from_prior_imports(
        self,
    ) -> None:
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
            if txn.get("type") == "fx_translation_pnl"
            and txn.get("date") == "2026-06-23"
        ]

        self.assertEqual(len(fx_rows), 1)
        self.assertEqual(fx_rows[0]["net_amount_raw"], "-4.500000000000000")
        self.assertEqual(
            merged["summary"]["incremental_import"][
                "superseded_fx_translation_pnl_count"
            ],
            2,
        )

    def test_ibkr_overlapping_import_dedupes_forex_trade_component_despite_legacy_currency(
        self,
    ) -> None:
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
            "transactions": [
                {
                    **forex_row,
                    "currency": "USD",
                    "source": {**forex_row["source"], "row_number": 115},
                }
            ],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)
        forex_rows = [
            txn
            for txn in merged["transactions"]
            if txn.get("type") == "forex_trade_component"
            and txn.get("date") == "2026-06-01"
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
            "account": "3361 3734 3361 3734",
        }
        existing_payload = {
            "schema_version": "3.0.0",
            "broker": "cmb_cn",
            "account": "3361 3734 3361 3734",
            "transactions": [
                {
                    "date": "2024-04-01",
                    "datetime": "2024-04-01 11:00:00",
                    "type": "virtual_balance_reset",
                    "broker": "cmb_cn",
                    "account": "3361 3734 3361 3734",
                    "currency": "CNY",
                    "gross_amount_raw": "-21511.9",
                    "net_amount_raw": "-21511.9",
                    "description": "Manual virtual balance reset to CNY 0.00",
                    "source": {
                        **source,
                        "virtual_balance_reset_not_real_world_transaction": True,
                    },
                }
            ],
        }
        incoming_payload = {
            "schema_version": "3.0.0",
            "broker": "cmb_cn",
            "account": "3361 3734 3361 3734",
            "transactions": [
                {
                    "date": "2024-04-01",
                    "datetime": "2024-04-01 11:00:00",
                    "type": "withdrawal",
                    "broker": "cmb_cn",
                    "account": "3361 3734 3361 3734",
                    "currency": "CNY",
                    "gross_amount_raw": "-21511.9",
                    "net_amount_raw": "-21511.9",
                    "description": "",
                    "source": source,
                }
            ],
        }

        merged = merge_investment_payloads(existing_payload, incoming_payload)

        self.assertEqual(len(merged["transactions"]), 1)
        record = merged["transactions"][0]
        self.assertEqual(record["type"], "virtual_balance_reset")
        self.assertEqual(
            record["description"], "Manual virtual balance reset to CNY 0.00"
        )
        self.assertTrue(
            record["source"]["virtual_balance_reset_not_real_world_transaction"]
        )
        self.assertEqual(
            merged["summary"]["incremental_import"]["duplicate_record_count"],
            1,
        )

    def test_manual_transfer_identity_survives_import_presentation_changes(
        self,
    ) -> None:
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

    def test_manual_transfer_binding_migrates_and_survives_incremental_merge(
        self,
    ) -> None:
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
            "description": "HK433320P5343332",
            "source": {
                "file_kind": "hsbc_usd_account_text",
                "reference_id": "HK433320P5343332",
            },
        }
        legacy_source_key = (
            "ibkr|U00000001|2026-05-29|deposit|USD|400|"
            "Electronic Fund Transfer|gainskeeper|279"
        )
        legacy_target_key = (
            "hsbc|000-999999-999|2026-05-29|withdrawal|USD|-400.00|"
            "HK433320P5343332|hsbc_usd_account_text|HK433320P5343332"
        )
        existing_payload = normalize_investment_payload_tickers(
            {
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
            }
        )
        stable_binding = {
            build_investment_internal_transfer_binding_key(
                source_record
            ): build_investment_internal_transfer_binding_key(target_record),
        }

        self.assertEqual(
            existing_payload["manual_internal_transfer_bindings"],
            stable_binding,
        )
        self.assertEqual(
            existing_payload["manual_internal_transfer_ignored_source_keys"],
            [build_investment_internal_transfer_binding_key(source_record)],
        )

        merged = merge_investment_payloads(
            existing_payload,
            {
                "schema_version": 3,
                "broker": "ibkr",
                "account": "U*****00001",
                "transactions": [
                    {
                        **source_record,
                        "account": "U*****00001",
                        "currency": "",
                        "net_amount_raw": "400.00",
                        "description": "Cash deposit",
                        "source": {
                            "file_kind": "ibkr_legacy_report",
                            "row_number": 14,
                        },
                    }
                ],
            },
        )

        self.assertEqual(
            merged["manual_internal_transfer_bindings"],
            stable_binding,
        )
        self.assertEqual(
            merged["manual_internal_transfer_ignored_source_keys"],
            [build_investment_internal_transfer_binding_key(source_record)],
        )

    def test_duplicate_manual_transfer_rows_use_row_identity_and_fail_closed_for_old_key(
        self,
    ) -> None:
        source_record = {
            "date": "2023-02-20",
            "type": "deposit",
            "broker": "usmart_hk",
            "account": "07723146",
            "currency": "HKD",
            "net_amount_raw": "100.00",
            "description": "eDDA Cash Deposit",
            "source": {
                "file_kind": "usmart_hk_statement_pdf",
                "source_filename": "20230301-07723146.pdf",
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
                "description": "TO USMART T548125QU155(48FEB12)",
                "source": {
                    "file_kind": "hsbc_statement_cash",
                    "source_filename": "eStatementFile_649434.pdf",
                    "row_number": 31,
                    "reference_id": "TO USMART T548125QU155(48FEB12)",
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
                    "source_filename": "eStatementFile_649434.pdf",
                    "row_number": 33,
                    "reference_id": "DEMO ACCOUNT HOLDER REF00000000000000 18FEB",
                },
            },
        ]
        transactions = [source_record, *target_records]
        source_key = build_investment_internal_transfer_binding_key(source_record)
        old_target_key = build_investment_internal_transfer_binding_key(
            target_records[0]
        )
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
            normalize_investment_payload_tickers(
                {
                    "transactions": transactions,
                    "manual_internal_transfer_bindings": {source_key: old_target_key},
                }
            )["manual_internal_transfer_bindings"],
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
        self.assertEqual(target["description"], "TO USMART T548125QU155(48FEB12)")

    def test_manual_transfer_v3_keys_survive_additive_statement_hash_enrichment(
        self,
    ) -> None:
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
                    "source_filename": "eStatementFile_649434.pdf",
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
                    "source_filename": "Mar 3331.pdf",
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

        normalized = normalize_investment_payload_tickers(
            {
                "transactions": transactions,
                "manual_internal_transfer_bindings": {
                    historical_source_key(source_records[0]): target_keys[
                        "Clearing Cheque 0000001"
                    ],
                    historical_source_key(source_records[1]): target_keys[
                        "Transfer E-BANKING TRANSFER"
                    ],
                },
            }
        )

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

    def test_longbridge_hk_cash_transfer_window_excludes_late_same_amount_withdrawal(
        self,
    ) -> None:
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
        same_day_target_key = build_investment_internal_transfer_binding_key(
            same_day_target
        )
        late_target_key = build_investment_internal_transfer_binding_key(late_target)

        self.assertEqual(
            get_investment_internal_transfer_link_window_days(
                source_record, same_day_target
            ),
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
        with self.assertRaisesRegex(
            ValueError, "later than the permitted deposit posting window"
        ):
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

    def test_february_longbridge_hk_cash_transfer_can_use_bochk_as_the_bank_leg(
        self,
    ) -> None:
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

    def test_cmbwl_bank_deposit_can_use_futuhk_withdrawal_as_cash_counterpart(
        self,
    ) -> None:
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
                "statement_order_id": "83211864",
            },
        }
        source, target = validate_investment_internal_transfer_binding(
            [source_record, target_record],
            build_investment_internal_transfer_binding_key(source_record),
            build_investment_internal_transfer_binding_key(target_record),
        )

        self.assertEqual(source["broker"], "cmbwl")
        self.assertEqual(target["broker"], "futuhk")

    def test_negative_longbridge_cash_reversal_is_not_an_internal_transfer_source(
        self,
    ) -> None:
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

        with self.assertRaisesRegex(
            ValueError, "not a supported internal-transfer source"
        ):
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

    def test_ibkr_equivalent_usd_fx_bank_leg_allows_explicit_one_day_settlement(
        self,
    ) -> None:
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
        with self.assertRaisesRegex(
            ValueError, "later than the permitted deposit posting window"
        ):
            validate_investment_internal_transfer_binding(
                [source_record, two_days_late_target],
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(two_days_late_target),
            )

    def test_cash_transfer_validation_rejects_future_bank_outflow_within_default_window(
        self,
    ) -> None:
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
        with self.assertRaisesRegex(
            ValueError, "later than the permitted deposit posting window"
        ):
            validate_investment_internal_transfer_binding(
                transactions,
                build_investment_internal_transfer_binding_key(source_record),
                build_investment_internal_transfer_binding_key(future_target),
            )

    def test_incremental_merge_large_ledger_uses_candidate_index_without_full_scan(
        self,
    ) -> None:
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

        existing_transactions = [
            cash_record(row_number) for row_number in range(1, 2_049)
        ]
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

    def test_refresh_reconciliation_reuses_binding_index_for_two_manual_pairs(
        self,
    ) -> None:
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
        self.assertEqual(
            mismatches,
            [
                {
                    "ticker": "IBKR",
                    "replayed_quantity": "5.25",
                    "open_positions_quantity": "4.25",
                }
            ],
        )
