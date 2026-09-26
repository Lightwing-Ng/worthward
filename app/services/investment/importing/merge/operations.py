"""Investment import domain: merge.

Code version: v0.3.2
- Changed: HSBC posting-balance and current-cash boundary helpers resolve from
  their dedicated cash-boundary module.
- Fixed: Re-imported HSBC pasted cash can restore missing immutable posting
  provenance without changing existing settlement economics.
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    BOCHK_STATEMENT_IMPORTER_VERSION,
    DEFAULT_CONVENTION_TIME,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    Callable,
    HSBC_PARTIAL_ORDER_STATUS_WARNING,
    MIXED_BROKER_SNAPSHOT_WARNING,
    SCHEMA_VERSION,
    _decimal_to_str,
    _normalize_text,
    deepcopy,
    json,
    sort_broker_codes,
)

import app.services.investment.importing.artifacts as _ii_artifacts

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.bindings as _ii_bindings

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.brokers.hsbc.core as _ii_hsbc_core

import app.services.investment.importing.brokers.hsbc.cash_boundary as _ii_hsbc_cash_boundary

import app.services.investment.importing.brokers.hsbc.reconciliation as _ii_hsbc_reconciliation

import app.services.investment.importing.merge.identity as _ii_merge_identity

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries

import app.services.investment.importing.records as _ii_records

import app.services.investment.importing.brokers.schwab as _ii_schwab


def merge_investment_payloads(
    existing_payload: dict[str, Any] | None,
    incoming_payload: dict[str, Any],
    *,
    hsbc_dividend_action_loader: Callable[[set[str]], dict[str, list[dict[str, str]]]]
    | None = None,
) -> dict[str, Any]:
    normalized_incoming = _ii_bindings.normalize_investment_payload_tickers(
        incoming_payload
    )
    _ii_merge_identity._normalize_ibkr_gainskeeper_transaction_datetimes(
        normalized_incoming
    )
    if not existing_payload:
        summary = (
            normalized_incoming.get("summary")
            if isinstance(normalized_incoming.get("summary"), dict)
            else {}
        )
        normalized_incoming["summary"] = summary
        _ii_bindings.refresh_investment_security_transfer_reconciliation(
            normalized_incoming
        )
        normalized_incoming["summary"]["json_size_bytes"] = len(
            json.dumps(
                normalized_incoming,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        )
        return normalized_incoming
    if (
        not _ii_merge_reconciliation._payload_transactions(existing_payload)
        and not _normalize_text(existing_payload.get("broker"))
        and not _normalize_text(existing_payload.get("account"))
        and not existing_payload.get("source_artifacts")
        and not existing_payload.get("broker_snapshots")
        and not existing_payload.get("broker_summaries")
        and not existing_payload.get("position_snapshot")
        and not existing_payload.get("performance_snapshot")
    ):
        incoming_transactions = _ii_merge_reconciliation._payload_transactions(
            normalized_incoming
        )
        incoming_broker = _ii_basics._normalize_broker_code(
            normalized_incoming.get("broker")
        )
        incoming_account = _normalize_text(normalized_incoming.get("account"))
        transaction_brokers = sort_broker_codes(
            {
                _ii_basics._normalize_broker_code(transaction.get("broker"))
                for transaction in incoming_transactions
                if _ii_basics._normalize_broker_code(transaction.get("broker"))
            }
        )
        if not transaction_brokers and incoming_broker:
            transaction_brokers = [incoming_broker]
        transaction_accounts = sorted(
            {
                _normalize_text(transaction.get("account"))
                for transaction in incoming_transactions
                if _normalize_text(transaction.get("account"))
            }
        )
        if not transaction_accounts and incoming_account:
            transaction_accounts = [incoming_account]
        summary = (
            normalized_incoming.get("summary")
            if isinstance(normalized_incoming.get("summary"), dict)
            else {}
        )
        summary["incremental_import"] = {
            "mode": "incremental_union",
            "existing_record_count": 0,
            "imported_record_count": len(incoming_transactions),
            "added_record_count": len(incoming_transactions),
            "duplicate_record_count": 0,
            "superseded_fx_translation_pnl_count": 0,
            "superseded_ibkr_web_compact_split_fill_count": 0,
            "superseded_ibkr_web_compact_aggregate_count": 0,
            "superseded_ibkr_csv_gainskeeper_stock_trade_count": 0,
            "superseded_incoming_ibkr_csv_gainskeeper_stock_trade_count": 0,
            "mixed_brokers_or_accounts": False,
            "brokers": transaction_brokers,
            "accounts": transaction_accounts,
            "snapshot_source": "incoming",
            "account_verified": True,
        }
        normalized_incoming["summary"] = summary
        _ii_bindings.refresh_investment_security_transfer_reconciliation(
            normalized_incoming
        )
        normalized_incoming["summary"]["json_size_bytes"] = len(
            json.dumps(
                normalized_incoming,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        )
        return normalized_incoming

    normalized_existing = _ii_bindings.normalize_investment_payload_tickers(
        existing_payload
    )
    _ii_merge_identity._normalize_ibkr_gainskeeper_transaction_datetimes(
        normalized_existing
    )
    existing_broker = _ii_basics._normalize_broker_code(
        normalized_existing.get("broker")
    )
    incoming_broker = _ii_basics._normalize_broker_code(
        normalized_incoming.get("broker")
    )

    existing_account = _normalize_text(normalized_existing.get("account"))
    incoming_account = _normalize_text(normalized_incoming.get("account"))
    if existing_broker == incoming_broker and not _ii_basics._accounts_are_compatible(
        existing_broker,
        existing_account,
        incoming_account,
    ):
        raise ValueError(
            "The uploaded CSV files belong to a different IBKR account than the current local investment store."
        )

    prefer_longbridge_orders = (
        existing_broker == incoming_broker
        and existing_broker in {"longbridge_hk", "longbridge_sg"}
        and (
            _ii_merge_reconciliation._is_longbridge_order_payload(normalized_existing)
            or _ii_merge_reconciliation._is_longbridge_order_payload(
                normalized_incoming
            )
        )
    )
    existing_is_ibkr_web_paste = (
        _ii_merge_identity._is_ibkr_web_trade_notification_payload(normalized_existing)
    )
    incoming_is_ibkr_web_paste = (
        _ii_merge_identity._is_ibkr_web_trade_notification_payload(normalized_incoming)
    )
    existing_is_hsbc_usd_savings_csv = (
        _ii_merge_reconciliation._is_hsbc_usd_savings_csv_payload(normalized_existing)
    )
    incoming_is_hsbc_usd_savings_csv = (
        _ii_merge_reconciliation._is_hsbc_usd_savings_csv_payload(normalized_incoming)
    )
    existing_is_hsbc_statement = (
        _ii_merge_reconciliation._is_hsbc_historical_statement_payload(
            normalized_existing
        )
        and not existing_is_hsbc_usd_savings_csv
    )
    incoming_is_hsbc_statement = (
        _ii_merge_reconciliation._is_hsbc_historical_statement_payload(
            normalized_incoming
        )
        and not incoming_is_hsbc_usd_savings_csv
    )
    existing_is_hsbc_cash_only = (
        _ii_merge_reconciliation._is_hsbc_cash_only_paste_payload(normalized_existing)
    )
    incoming_is_hsbc_cash_only = (
        _ii_merge_reconciliation._is_hsbc_cash_only_paste_payload(normalized_incoming)
    )
    attributed_hsbc_cash_only_dividend_count = 0
    if incoming_is_hsbc_cash_only:
        attributed_hsbc_cash_only_dividend_count = _ii_hsbc_reconciliation._attribute_hsbc_cash_only_dividends_from_existing_ledger(
            normalized_existing,
            normalized_incoming,
            hsbc_dividend_action_loader,
        )
    incoming_hsbc_cash_settlement_evidence = (
        _ii_payload_summaries._payload_hsbc_cash_settlement_evidence(
            normalized_incoming
        )
    )
    hsbc_cash_settlement_evidence = (
        _ii_payload_summaries._merge_hsbc_cash_settlement_evidence(
            normalized_existing,
            normalized_incoming,
        )
    )
    incoming_hsbc_cash_only_usd = (
        incoming_is_hsbc_cash_only
        and "USD"
        in _ii_payload_summaries._payload_cash_balance_map(
            normalized_incoming,
            "ending_cash_by_currency",
        )
    )
    existing_is_hsbc_live_paste = _ii_merge_reconciliation._is_hsbc_live_paste_payload(
        normalized_existing
    )
    incoming_is_hsbc_live_paste = _ii_merge_reconciliation._is_hsbc_live_paste_payload(
        normalized_incoming
    )
    is_hsbc_cash_only_merge = existing_broker == incoming_broker == "hsbc" and (
        existing_is_hsbc_cash_only or incoming_is_hsbc_cash_only
    )
    is_hsbc_live_paste_merge = (
        existing_broker == incoming_broker == "hsbc"
        and existing_is_hsbc_live_paste
        and incoming_is_hsbc_live_paste
    )
    is_hsbc_cash_balance_component_merge = (
        is_hsbc_cash_only_merge or is_hsbc_live_paste_merge
    )
    if (
        existing_broker == incoming_broker == "ibkr"
        and existing_is_ibkr_web_paste != incoming_is_ibkr_web_paste
    ):
        latest_payload = (
            normalized_incoming
            if not incoming_is_ibkr_web_paste
            else normalized_existing
        )
    elif (
        is_hsbc_cash_only_merge
        and incoming_is_hsbc_cash_only != existing_is_hsbc_cash_only
    ):
        latest_payload = (
            normalized_existing if incoming_is_hsbc_cash_only else normalized_incoming
        )
    elif (
        existing_broker == incoming_broker == "hsbc"
        and existing_is_hsbc_statement != incoming_is_hsbc_statement
    ):
        latest_payload = _ii_payload_summaries._pick_latest_hsbc_snapshot_payload(
            normalized_existing,
            normalized_incoming,
        )
    elif (
        prefer_longbridge_orders
        and _ii_merge_reconciliation._is_longbridge_order_payload(normalized_incoming)
    ):
        latest_payload = normalized_incoming
    elif (
        prefer_longbridge_orders
        and _ii_merge_reconciliation._is_longbridge_order_payload(normalized_existing)
    ):
        latest_payload = normalized_existing
    else:
        latest_payload = _ii_payload_summaries._pick_latest_payload(
            normalized_existing, normalized_incoming
        )
    earliest_payload = _ii_payload_summaries._pick_earliest_payload(
        normalized_existing, normalized_incoming
    )
    existing_transactions_for_merge = _ii_merge_reconciliation._transactions_for_merge(
        normalized_existing,
        prefer_longbridge_orders=prefer_longbridge_orders,
    )
    incoming_transactions_for_merge = _ii_merge_reconciliation._transactions_for_merge(
        normalized_incoming,
        prefer_longbridge_orders=prefer_longbridge_orders,
    )
    schwab_cleanup_signatures: set[tuple[str, str, str, str, str, str]] = set()
    if incoming_broker == "schwab":
        # The parser removes these rows from incoming transactions, so retain
        # their identities in the summary and use them to repair stale rows
        # already persisted by an earlier, narrower cleanup rule.
        schwab_cleanup_signatures.update(
            _ii_schwab._schwab_internal_transfer_cleanup_signatures(
                incoming_transactions_for_merge
            )
        )
        schwab_cleanup_signatures.update(
            _ii_schwab._schwab_cleanup_signatures_from_summary(normalized_incoming)
        )
        if schwab_cleanup_signatures:
            existing_transactions_for_merge = [
                transaction
                for transaction in existing_transactions_for_merge
                if _ii_schwab._schwab_cleanup_record_signature(transaction)
                not in schwab_cleanup_signatures
            ]
            incoming_transactions_for_merge = [
                transaction
                for transaction in incoming_transactions_for_merge
                if _ii_schwab._schwab_cleanup_record_signature(transaction)
                not in schwab_cleanup_signatures
            ]
    hsbc_statement_settlement_enrichment = {
        "total": 0,
        "principal": 0,
        "fee": 0,
    }
    if incoming_broker == "hsbc" and incoming_is_hsbc_statement:
        (
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
            hsbc_statement_settlement_enrichment,
        ) = _ii_merge_reconciliation._enrich_hsbc_orders_with_statement_cash_evidence(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    superseded_ibkr_realized_summary_cash_count = 0
    if incoming_broker == "ibkr" or existing_broker == "ibkr":
        (
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
            superseded_ibkr_realized_summary_cash_count,
        ) = _ii_records._remove_ibkr_base_cash_records_superseded_by_native_summary(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    if incoming_broker == "hsbc":
        existing_transactions_for_merge = _ii_merge_reconciliation._remove_hsbc_cash_rows_superseded_by_matched_orders(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    superseded_ibkr_csv_gainskeeper_stock_trade_count = 0
    if _ii_merge_identity._is_ibkr_gainskeeper_payload(normalized_incoming):
        (
            existing_transactions_for_merge,
            superseded_ibkr_csv_gainskeeper_stock_trade_count,
        ) = _ii_merge_identity._remove_ibkr_csv_stock_trades_superseded_by_gainskeeper(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    superseded_incoming_ibkr_csv_gainskeeper_stock_trade_count = 0
    if (
        incoming_broker == "ibkr"
        and not _ii_merge_identity._is_ibkr_gainskeeper_payload(normalized_incoming)
    ):
        (
            incoming_transactions_for_merge,
            superseded_incoming_ibkr_csv_gainskeeper_stock_trade_count,
        ) = _ii_merge_identity._remove_incoming_ibkr_csv_stock_trades_already_covered_by_gainskeeper(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    (
        existing_transactions_for_merge,
        incoming_transactions_for_merge,
        superseded_existing_ibkr_web_compact_split_fill_count,
        superseded_incoming_ibkr_web_compact_split_fill_count,
    ) = _ii_merge_identity._reconcile_ibkr_web_compact_split_fills(
        existing_transactions_for_merge,
        incoming_transactions_for_merge,
    )
    superseded_ibkr_web_compact_split_fill_count = (
        superseded_existing_ibkr_web_compact_split_fill_count
        + superseded_incoming_ibkr_web_compact_split_fill_count
    )
    (
        existing_transactions_for_merge,
        incoming_transactions_for_merge,
        superseded_existing_ibkr_web_compact_aggregate_count,
        superseded_incoming_ibkr_web_compact_aggregate_count,
    ) = _ii_merge_identity._reconcile_ibkr_web_compact_aggregates_with_gainskeeper_split_fills(
        existing_transactions_for_merge,
        incoming_transactions_for_merge,
    )
    superseded_ibkr_web_compact_aggregate_count = (
        superseded_existing_ibkr_web_compact_aggregate_count
        + superseded_incoming_ibkr_web_compact_aggregate_count
    )
    merged_non_grant_transactions, duplicate_count, superseded_fx_translation_count = (
        _ii_merge_reconciliation._merge_non_grant_transactions(
            existing_transactions_for_merge,
            incoming_transactions_for_merge,
        )
    )
    duplicate_count += (
        superseded_ibkr_web_compact_split_fill_count
        + superseded_ibkr_web_compact_aggregate_count
    )

    mixed_brokers_or_accounts = bool(
        existing_broker
        and incoming_broker
        and (
            existing_broker != incoming_broker
            or not _ii_basics._accounts_are_compatible(
                existing_broker,
                existing_account,
                incoming_account,
            )
            or existing_account == "multiple"
            or incoming_account == "multiple"
        )
    )

    open_position_snapshots = (
        {}
        if mixed_brokers_or_accounts
        else _ii_artifacts._normalize_snapshot_keys(
            latest_payload.get("position_snapshot")
        )
    )
    performance_snapshots = (
        {}
        if mixed_brokers_or_accounts
        else _ii_artifacts._normalize_snapshot_keys(
            latest_payload.get("performance_snapshot")
        )
    )
    incoming_transactions_for_grant_merge = (
        _ii_merge_identity._transactions_for_grant_merge(
            incoming_transactions_for_merge,
            latest_position_snapshot=open_position_snapshots,
            incoming_payload=normalized_incoming,
            latest_payload=latest_payload,
        )
    )
    incoming_position_snapshot = _ii_artifacts._normalize_snapshot_keys(
        normalized_incoming.get("position_snapshot")
    )
    superseded_grant_tickers: set[str] = set()
    if incoming_position_snapshot:
        superseded_grant_tickers = (
            _ii_merge_identity._incoming_grant_superseded_tickers(
                incoming_transactions_for_grant_merge,
                incoming_position_snapshot,
            )
        )
    merged_grant_transactions, grant_duplicate_count = (
        _ii_merge_reconciliation._merge_grant_transactions(
            existing_transactions_for_merge,
            incoming_transactions_for_grant_merge,
            superseded_tickers=superseded_grant_tickers,
        )
    )
    duplicate_count += grant_duplicate_count
    merged_transactions = merged_non_grant_transactions + merged_grant_transactions
    grant_reconciliation_warnings: list[str] = []
    if incoming_position_snapshot:
        merged_transactions = _ii_records._reconcile_positions_grants_to_snapshot(
            merged_transactions,
            incoming_position_snapshot,
            grant_reconciliation_warnings,
        )
    _ii_records._sort_transactions(merged_transactions)
    merged_ibkr_closed_trade_details = (
        _ii_records._extract_ibkr_closed_trade_details_from_transactions(
            merged_transactions
        )
    )
    if not mixed_brokers_or_accounts:
        _ii_records._prefer_ibkr_closed_trade_realized_totals(
            performance_snapshots,
            merged_ibkr_closed_trade_details,
            transactions=merged_transactions,
        )
    _ii_hsbc_cash._prune_stale_hsbc_available_cash_annotations(merged_transactions)
    holdings_mismatches = (
        []
        if mixed_brokers_or_accounts or not open_position_snapshots
        else _ii_records._validate_holdings(
            merged_transactions, open_position_snapshots
        )
    )

    existing_summary = (
        normalized_existing.get("summary")
        if isinstance(normalized_existing.get("summary"), dict)
        else {}
    )
    incoming_summary = (
        normalized_incoming.get("summary")
        if isinstance(normalized_incoming.get("summary"), dict)
        else {}
    )
    if prefer_longbridge_orders:
        latest_summary = (
            latest_payload.get("summary")
            if isinstance(latest_payload.get("summary"), dict)
            else {}
        )
        warnings = _ii_payload_summaries._unique_preserving_order(
            _ii_payload_summaries._summary_list(latest_summary, "warnings")
        )
        unknown_types = _ii_payload_summaries._unique_preserving_order(
            _ii_payload_summaries._summary_list(
                latest_summary, "unknown_transaction_types"
            )
        )
    else:
        warnings = _ii_payload_summaries._unique_preserving_order(
            _ii_payload_summaries._summary_list(existing_summary, "warnings")
            + _ii_payload_summaries._summary_list(incoming_summary, "warnings")
        )
        unknown_types = _ii_payload_summaries._unique_preserving_order(
            _ii_payload_summaries._summary_list(
                existing_summary, "unknown_transaction_types"
            )
            + _ii_payload_summaries._summary_list(
                incoming_summary, "unknown_transaction_types"
            )
        )
    if grant_reconciliation_warnings:
        warnings = _ii_payload_summaries._unique_preserving_order(
            warnings + grant_reconciliation_warnings
        )
    warnings = _ii_merge_reconciliation._suppress_resolved_hsbc_dividend_warnings(
        warnings,
        merged_transactions,
    )
    warnings = _ii_merge_reconciliation._suppress_obsolete_hsbc_snapshot_warnings(
        warnings,
        incoming_summary,
    )
    warnings = _ii_merge_reconciliation._suppress_obsolete_ibkr_total_currency_warnings(
        warnings
    )
    hsbc_cash_settlement_merge_warnings: list[str] = []
    if incoming_broker == "hsbc" and incoming_hsbc_cash_settlement_evidence:
        all_merged_hsbc_order_records = [
            record
            for record in merged_transactions
            if (
                _ii_basics._normalize_broker_code(record.get("broker")) == "hsbc"
                and _normalize_text(record.get("type")).lower() in {"buy", "sell"}
                and _ii_basics._is_hsbc_order_status_record(record)
            )
        ]
        _ii_hsbc_cash._repair_hsbc_pasted_cash_settlement_posting_provenance(
            all_merged_hsbc_order_records,
            incoming_hsbc_cash_settlement_evidence,
        )
        merged_hsbc_order_records = [
            record
            for record in all_merged_hsbc_order_records
            if (
                not (
                    _normalize_text(
                        (record.get("source") or {}).get("cash_settlement_amount_raw")
                    )
                    or (record.get("source") or {}).get("cash_settlement_postings")
                )
            )
        ]
        _ii_hsbc_cash._match_hsbc_orders_to_cash_settlements(
            merged_hsbc_order_records,
            incoming_hsbc_cash_settlement_evidence,
            hsbc_cash_settlement_merge_warnings,
        )
        for order_record in merged_hsbc_order_records:
            source = (
                order_record.get("source")
                if isinstance(order_record.get("source"), dict)
                else {}
            )
            if _normalize_text(source.get("cash_settlement_amount_raw")) or source.get(
                "cash_settlement_postings"
            ):
                source.pop("cash_replay_pending_settlement", None)
                source.pop("cash_settlement_match_status", None)
                order_record["source"] = source
        warnings = _ii_payload_summaries._unique_preserving_order(
            warnings + hsbc_cash_settlement_merge_warnings
        )
    if incoming_broker == "hsbc" and incoming_position_snapshot:
        merged_hsbc_transactions = [
            record
            for record in merged_transactions
            if _ii_basics._normalize_broker_code(record.get("broker")) == "hsbc"
        ]
        if not _ii_records._validate_holdings(
            merged_hsbc_transactions, incoming_position_snapshot
        ):
            warnings = [
                warning
                for warning in warnings
                if warning != HSBC_PARTIAL_ORDER_STATUS_WARNING
            ]
    ending_cash_components: dict[str, Decimal] = {}
    if mixed_brokers_or_accounts:
        warnings = _ii_payload_summaries._unique_preserving_order(
            warnings + [MIXED_BROKER_SNAPSHOT_WARNING]
        )

    if mixed_brokers_or_accounts:
        starting_cash = None
        ending_cash = None
        starting_cash_by_currency: dict[str, str] = {}
        ending_cash_by_currency: dict[str, str] = {}
        starting_cash_base_currency = None
        ending_cash_base_currency = None
    else:
        starting_cash = (
            _ii_payload_summaries._summary_text(
                earliest_payload.get("summary"), "starting_cash_raw"
            )
            or _normalize_text(earliest_payload.get("starting_cash"))
            or None
        )
        ending_cash = (
            _ii_payload_summaries._summary_text(
                latest_payload.get("summary"), "ending_cash_raw"
            )
            or _normalize_text(latest_payload.get("ending_cash"))
            or None
        )
        starting_cash_by_currency = _ii_payload_summaries._payload_cash_balance_map(
            earliest_payload,
            "starting_cash_by_currency",
        )
        ending_cash_by_currency = _ii_payload_summaries._payload_cash_balance_map(
            latest_payload,
            "ending_cash_by_currency",
        )
        starting_cash_base_currency = (
            _normalize_text(earliest_payload.get("starting_cash_base_currency"))
            or _ii_payload_summaries._summary_text(
                earliest_payload.get("summary"), "starting_cash_base_currency"
            )
            or None
        )
        ending_cash_base_currency = (
            _normalize_text(latest_payload.get("ending_cash_base_currency"))
            or _ii_payload_summaries._summary_text(
                latest_payload.get("summary"), "ending_cash_base_currency"
            )
            or None
        )
        if is_hsbc_cash_balance_component_merge:
            ending_cash_components = (
                _ii_payload_summaries._payload_hsbc_ending_cash_components(
                    normalized_existing
                )
            )
            ending_cash_component_post_dates = (
                _ii_payload_summaries._payload_hsbc_cash_component_post_dates(
                    normalized_existing
                )
            )
            _ii_hsbc_core._merge_hsbc_cash_component_values(
                ending_cash_components,
                ending_cash_component_post_dates,
                _ii_payload_summaries._payload_hsbc_ending_cash_components(
                    normalized_incoming
                ),
                _ii_payload_summaries._payload_hsbc_cash_component_post_dates(
                    normalized_incoming
                ),
            )
            ending_cash_by_currency = {
                currency: _decimal_to_str(amount) or "0"
                for currency, amount in _ii_hsbc_core._sum_hsbc_cash_balance_components(
                    ending_cash_components
                ).items()
            }
        incoming_usd_cash_balance = _ii_payload_summaries._payload_cash_balance_map(
            normalized_incoming,
            "ending_cash_by_currency",
        ).get("USD")
        if incoming_hsbc_cash_only_usd and incoming_usd_cash_balance is not None:
            ending_cash = incoming_usd_cash_balance
            ending_cash_base_currency = incoming_usd_cash_balance
    merged_source_artifacts = _ii_artifacts._merge_source_artifacts(
        normalized_existing,
        normalized_incoming,
    )
    hsbc_authoritative_settlement_update_count = 0
    if existing_broker == "hsbc" or incoming_broker == "hsbc":
        hsbc_authoritative_settlement_update_count = _ii_hsbc_reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
            merged_transactions,
            merged_source_artifacts,
        )
        _ii_hsbc_cash_boundary._reconcile_hsbc_order_settlement_balances_from_postings(
            merged_transactions
        )
        _ii_records._sort_transactions(merged_transactions)
    added_record_count = max(
        len(merged_transactions) - len(existing_transactions_for_merge), 0
    )
    transaction_brokers = sort_broker_codes(
        {
            _ii_basics._normalize_broker_code(txn.get("broker"))
            for txn in merged_transactions
            if _ii_basics._normalize_broker_code(txn.get("broker"))
        }
    )
    transaction_accounts = sorted(
        {
            _normalize_text(txn.get("account"))
            for txn in merged_transactions
            if _normalize_text(txn.get("account"))
        }
    )
    merge_details = {
        "mode": "incremental_union",
        "existing_record_count": len(existing_transactions_for_merge),
        "imported_record_count": len(incoming_transactions_for_merge),
        "added_record_count": added_record_count,
        "duplicate_record_count": duplicate_count,
        "superseded_fx_translation_pnl_count": superseded_fx_translation_count,
        "superseded_ibkr_web_compact_split_fill_count": (
            superseded_ibkr_web_compact_split_fill_count
        ),
        "superseded_ibkr_web_compact_aggregate_count": (
            superseded_ibkr_web_compact_aggregate_count
        ),
        "superseded_ibkr_csv_gainskeeper_stock_trade_count": superseded_ibkr_csv_gainskeeper_stock_trade_count,
        "superseded_incoming_ibkr_csv_gainskeeper_stock_trade_count": superseded_incoming_ibkr_csv_gainskeeper_stock_trade_count,
        "enriched_hsbc_statement_settlement_posting_count": (
            hsbc_statement_settlement_enrichment["total"]
        ),
        "enriched_hsbc_statement_settlement_principal_count": (
            hsbc_statement_settlement_enrichment["principal"]
        ),
        "enriched_hsbc_statement_settlement_fee_count": (
            hsbc_statement_settlement_enrichment["fee"]
        ),
        "authoritative_hsbc_settlement_update_count": (
            hsbc_authoritative_settlement_update_count
        ),
        "attributed_hsbc_cash_only_dividend_count": (
            attributed_hsbc_cash_only_dividend_count
        ),
        "superseded_ibkr_realized_summary_cash_count": (
            superseded_ibkr_realized_summary_cash_count
        ),
        "mixed_brokers_or_accounts": mixed_brokers_or_accounts,
        "brokers": transaction_brokers,
        "accounts": transaction_accounts,
        "snapshot_source": (
            "incoming" if latest_payload is normalized_incoming else "existing"
        ),
        "account_verified": not (
            existing_broker == incoming_broker
            and not _ii_basics._accounts_are_compatible(
                existing_broker,
                existing_account,
                incoming_account,
            )
        ),
    }
    merged_internal_transfer_bindings = {
        **_ii_bindings.normalize_investment_internal_transfer_bindings(
            normalized_existing.get("manual_internal_transfer_bindings")
        ),
        **_ii_bindings.normalize_investment_internal_transfer_bindings(
            normalized_incoming.get("manual_internal_transfer_bindings")
        ),
    }
    merged_internal_transfer_ignored_source_keys = (
        _ii_bindings.normalize_investment_internal_transfer_ignored_source_keys(
            [
                *(
                    normalized_existing.get(
                        "manual_internal_transfer_ignored_source_keys"
                    )
                    or []
                ),
                *(
                    normalized_incoming.get(
                        "manual_internal_transfer_ignored_source_keys"
                    )
                    or []
                ),
            ]
        )
    )
    merged_security_transfer_attributions = {
        **_ii_bindings.normalize_investment_security_transfer_attributions(
            normalized_existing.get("manual_security_transfer_attributions")
        ),
        **_ii_bindings.normalize_investment_security_transfer_attributions(
            normalized_incoming.get("manual_security_transfer_attributions")
        ),
    }
    merged_schwab_suppressed_internal_transfer_rows = (
        _ii_schwab._merge_schwab_suppressed_internal_transfer_rows(
            normalized_existing,
            normalized_incoming,
        )
    )

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "ibkr_csv_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
        },
        "broker": (
            incoming_broker if incoming_broker == existing_broker else "multiple"
        ),
        "account": (
            incoming_account or existing_account or None
            if not mixed_brokers_or_accounts
            else "multiple"
        ),
        "brokers": transaction_brokers,
        "accounts": transaction_accounts,
        "datetime_policy": (
            normalized_incoming.get("datetime_policy")
            or normalized_existing.get("datetime_policy")
            or {
                "date_field_meaning": "Original trading date from CSV",
                "datetime_field_meaning": (
                    "Business-convention datetime derived from date "
                    f"with default time {DEFAULT_CONVENTION_TIME}"
                ),
                "timezone": DEFAULT_CONVENTION_TIMEZONE,
                "source_has_intraday_timestamp": False,
            }
        ),
        "summary": _ii_payload_summaries._build_summary(
            transactions=merged_transactions,
            warnings=warnings,
            unknown_types=unknown_types,
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots=open_position_snapshots,
            performance_snapshots=performance_snapshots,
            starting_cash=starting_cash,
            ending_cash=ending_cash,
            merge_details=merge_details,
        ),
        "starting_cash": starting_cash,
        "ending_cash": ending_cash,
        "position_snapshot": open_position_snapshots,
        "performance_snapshot": performance_snapshots,
        "source_artifacts": merged_source_artifacts,
        "broker_snapshots": _ii_artifacts._merge_broker_snapshots(
            normalized_existing,
            normalized_incoming,
            merged_transactions=merged_transactions,
        ),
        "manual_internal_transfer_bindings": merged_internal_transfer_bindings,
        "manual_internal_transfer_ignored_source_keys": (
            merged_internal_transfer_ignored_source_keys
        ),
        "manual_security_transfer_attributions": merged_security_transfer_attributions,
        "transactions": merged_transactions,
    }
    if hsbc_cash_settlement_evidence:
        payload["hsbc_cash_settlement_evidence"] = hsbc_cash_settlement_evidence
    if merged_schwab_suppressed_internal_transfer_rows:
        payload["summary"]["schwab_suppressed_internal_transfer_count"] = len(
            merged_schwab_suppressed_internal_transfer_rows
        )
        payload["summary"]["schwab_suppressed_internal_transfer_rows"] = (
            merged_schwab_suppressed_internal_transfer_rows
        )
    _ii_bindings.refresh_investment_security_transfer_reconciliation(payload)
    if starting_cash_by_currency:
        payload["starting_cash_by_currency"] = starting_cash_by_currency
        payload["summary"]["starting_cash_by_currency"] = starting_cash_by_currency
    if ending_cash_by_currency:
        payload["ending_cash_by_currency"] = ending_cash_by_currency
        payload["summary"]["ending_cash_by_currency"] = ending_cash_by_currency
    if ending_cash_components:
        payload["summary"]["hsbc_ending_cash_components"] = (
            _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                ending_cash_components
            )
        )
        payload["summary"]["hsbc_cash_component_post_dates"] = (
            _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
                ending_cash_component_post_dates
            )
        )
    if starting_cash_base_currency:
        payload["starting_cash_base_currency"] = starting_cash_base_currency
        payload["summary"]["starting_cash_base_currency"] = starting_cash_base_currency
    if ending_cash_base_currency:
        payload["ending_cash_base_currency"] = ending_cash_base_currency
        payload["summary"]["ending_cash_base_currency"] = ending_cash_base_currency
    if incoming_broker == "hsbc":
        preserve_existing_hsbc_current_snapshot = (
            incoming_is_hsbc_statement
            and not existing_is_hsbc_statement
            and latest_payload is normalized_existing
        )
        preserve_existing_hsbc_snapshot_for_cash_only = (
            incoming_is_hsbc_cash_only and not existing_is_hsbc_cash_only
        )
        for field_name in (
            "hsbc_snapshot",
            "hsbc_paste_import_scope",
            "cash_snapshot_source",
            "cash_flow_transaction_source",
            "cash_snapshot_status",
            "current_moment_source",
            "order_history_scope",
            "hsbc_portfolio_calibrated_order_count",
            "hsbc_final_settled_execution_count",
            "hsbc_final_settled_execution_order_ids",
            "hsbc_pending_settlement_cash_raw",
            "hsbc_pending_settlement_fee_adjustment",
            "hsbc_pending_settlement_cash",
            "hsbc_pending_settlement_order_count",
            "hsbc_broker_cash_estimate",
            "hsbc_cash_display_convention",
            "cash_ledger_balance",
            "starting_cash_by_currency",
            "ending_cash_by_currency",
            "hsbc_ending_cash_components",
            "hsbc_cash_component_post_dates",
            "starting_cash_base_currency",
            "ending_cash_base_currency",
        ):
            hsbc_summary_source = incoming_summary
            if _ii_payload_summaries._hsbc_summary_snapshot_sort_key(
                existing_summary
            ) > _ii_payload_summaries._hsbc_summary_snapshot_sort_key(incoming_summary):
                hsbc_summary_source = existing_summary
            if field_name in hsbc_summary_source and not (
                preserve_existing_hsbc_snapshot_for_cash_only
                or (
                    is_hsbc_cash_balance_component_merge
                    and field_name
                    in {
                        "ending_cash_by_currency",
                        "hsbc_ending_cash_components",
                        "hsbc_cash_component_post_dates",
                    }
                )
                or (
                    preserve_existing_hsbc_current_snapshot
                    and field_name
                    in {
                        "cash_ledger_balance",
                        "cash_ledger_balance_as_of",
                        "cash_ledger_balance_source",
                        "hsbc_bank_available_cash",
                        "hsbc_available_cash_by_currency",
                        "hsbc_available_cash_components",
                        "starting_cash_by_currency",
                        "ending_cash_by_currency",
                        "starting_cash_base_currency",
                        "ending_cash_base_currency",
                    }
                )
                or (
                    mixed_brokers_or_accounts
                    and field_name
                    in {
                        "starting_cash_by_currency",
                        "ending_cash_by_currency",
                        "starting_cash_base_currency",
                        "ending_cash_base_currency",
                    }
                )
            ):
                payload["summary"][field_name] = hsbc_summary_source[field_name]
        if incoming_hsbc_cash_only_usd and not mixed_brokers_or_accounts:
            incoming_cash_snapshot_as_of = _normalize_text(
                incoming_summary.get("cash_snapshot_as_of")
            )
            incoming_cash_snapshot_source = (
                _normalize_text(incoming_summary.get("cash_snapshot_source"))
                or "hsbc_usd_savings_ledger_balance"
            )
            payload["summary"]["cash_snapshot_source"] = incoming_cash_snapshot_source
            payload["summary"]["cash_snapshot_authoritative"] = True
            payload["summary"]["cash_snapshot_status"] = "current"
            payload["summary"]["cash_ledger_balance"] = incoming_summary.get(
                "cash_ledger_balance"
            )
            for field_name in (
                "cash_ledger_balance_as_of",
                "cash_ledger_balance_source",
                "hsbc_bank_available_cash",
                "hsbc_available_cash_by_currency",
                "hsbc_available_cash_components",
            ):
                if field_name in incoming_summary:
                    payload["summary"][field_name] = incoming_summary[field_name]
            if incoming_cash_snapshot_as_of:
                payload["summary"]["cash_snapshot_as_of"] = incoming_cash_snapshot_as_of
                payload["summary"]["ending_cash_base_currency_as_of"] = (
                    incoming_cash_snapshot_as_of
                )
                payload["summary"]["ending_cash_base_currency_source"] = (
                    incoming_cash_snapshot_source
                )
                payload["summary"]["ending_cash_base_currency_status"] = (
                    "authoritative_current_cash_boundary"
                )
                snapshot = payload["summary"].get("hsbc_snapshot")
                snapshot = deepcopy(snapshot) if isinstance(snapshot, dict) else {}
                snapshot["cash_latest_post_date"] = incoming_cash_snapshot_as_of
                snapshot["cash_posting_status"] = "current"
                snapshot["cash_posting_lag"] = {
                    "status": "none",
                    "latest_cash_post_date": incoming_cash_snapshot_as_of,
                    "latest_fully_executed_order_date": _normalize_text(
                        snapshot.get("latest_fully_executed_order_date")
                    ),
                    "explanation": (
                        "The standalone USD Savings capture is the latest posted cash boundary."
                    ),
                }
                payload["summary"]["hsbc_snapshot"] = snapshot
    latest_summary = (
        latest_payload.get("summary")
        if isinstance(latest_payload.get("summary"), dict)
        else {}
    )
    if is_hsbc_cash_only_merge and latest_payload is normalized_existing:
        for field_name in (
            "hsbc_snapshot",
            "hsbc_paste_import_scope",
            "cash_snapshot_source",
            "cash_flow_transaction_source",
            "cash_snapshot_status",
            "current_moment_source",
            "order_history_scope",
            "hsbc_portfolio_calibrated_order_count",
            "hsbc_final_settled_execution_count",
            "hsbc_final_settled_execution_order_ids",
            "hsbc_pending_settlement_cash_raw",
            "hsbc_pending_settlement_fee_adjustment",
            "hsbc_pending_settlement_cash",
            "hsbc_pending_settlement_order_count",
            "hsbc_broker_cash_estimate",
            "hsbc_cash_display_convention",
            "cash_ledger_balance",
            "cash_ledger_balance_as_of",
            "cash_ledger_balance_source",
            "hsbc_bank_available_cash",
            "hsbc_available_cash_by_currency",
            "hsbc_available_cash_components",
        ):
            if field_name in latest_summary:
                payload["summary"][field_name] = latest_summary[field_name]
        latest_paste_scope = _ii_merge_reconciliation._hsbc_paste_import_scope(
            latest_payload
        )
        if latest_paste_scope:
            payload["summary"]["hsbc_paste_import_scope"] = latest_paste_scope
    if "position_snapshot_authoritative" in latest_summary:
        payload["summary"]["position_snapshot_authoritative"] = bool(
            latest_summary.get("position_snapshot_authoritative")
        )
    elif not mixed_brokers_or_accounts and open_position_snapshots:
        payload["summary"]["position_snapshot_authoritative"] = True
    if mixed_brokers_or_accounts:
        payload["summary"]["position_snapshot_authoritative"] = False
    if "performance_snapshot_authoritative" in latest_summary:
        payload["summary"]["performance_snapshot_authoritative"] = bool(
            latest_summary.get("performance_snapshot_authoritative")
        )
    elif not mixed_brokers_or_accounts and performance_snapshots:
        payload["summary"]["performance_snapshot_authoritative"] = True
    if mixed_brokers_or_accounts:
        payload["summary"]["performance_snapshot_authoritative"] = False
    position_snapshot_source = _ii_payload_summaries._summary_text(
        latest_summary, "position_snapshot_source"
    )
    if position_snapshot_source and not mixed_brokers_or_accounts:
        payload["summary"]["position_snapshot_source"] = position_snapshot_source
    existing_has_bochk_statement = (
        _ii_merge_reconciliation._payload_contains_bochk_statement_component(
            normalized_existing
        )
    )
    incoming_has_bochk_statement = (
        _ii_merge_reconciliation._payload_contains_bochk_statement_component(
            normalized_incoming
        )
    )
    is_bochk_statement_merge = (
        existing_has_bochk_statement
        and incoming_has_bochk_statement
        and not (
            existing_broker == incoming_broker == "multiple"
            and existing_account == incoming_account == "multiple"
        )
    )
    bochk_broker_summary_override: dict[str, Any] | None = None
    if is_bochk_statement_merge:
        bochk_payloads = [
            candidate
            for candidate in (normalized_existing, normalized_incoming)
            if _ii_merge_reconciliation._payload_contains_bochk_statement_component(
                candidate
            )
        ]
        bochk_metadata_pairs = [
            (
                candidate,
                _ii_merge_reconciliation._bochk_statement_metadata_from_payload(
                    candidate
                ),
            )
            for candidate in bochk_payloads
        ]
        bochk_periods = sorted(
            {
                period
                for _candidate, metadata in bochk_metadata_pairs
                for period in metadata.get("statement_periods", [])
                if _normalize_text(period)
            }
        )
        bochk_artifacts = [
            artifact
            for artifact in merged_source_artifacts
            if _normalize_text(artifact.get("source_kind")) == "boc_hk_statement_pdf"
        ]
        bochk_artifact_digests = {
            _normalize_text(artifact.get("sha256"))
            for artifact in bochk_artifacts
            if _normalize_text(artifact.get("sha256"))
        }
        for artifact in bochk_artifacts:
            period = _normalize_text(artifact.get("statement_period"))
            period_end = _normalize_text(artifact.get("statement_period_end"))
            if period:
                bochk_periods.append(period)
            elif len(period_end) >= 7:
                bochk_periods.append(period_end[:7])
        bochk_periods = sorted(set(bochk_periods))
        statement_count = len(bochk_artifact_digests)
        if not statement_count:
            statement_count = sum(
                int(str(metadata.get("statement_count")))
                for _candidate, metadata in bochk_metadata_pairs
                if str(metadata.get("statement_count", "")).isdigit()
            )
        statement_date_values = [
            _normalize_text(artifact.get("statement_period_end"))
            for artifact in bochk_artifacts
            if _normalize_text(artifact.get("statement_period_end"))
        ]
        for _candidate, metadata in bochk_metadata_pairs:
            for field_name in ("statement_date_min", "statement_date_max"):
                value = _normalize_text(metadata.get(field_name))
                if value:
                    statement_date_values.append(value)

        def bochk_latest_key(
            pair: tuple[dict[str, Any], dict[str, Any]],
        ) -> tuple[str, str]:
            candidate, metadata = pair
            artifacts = _ii_merge_reconciliation._bochk_statement_artifacts(candidate)
            return (
                _normalize_text(metadata.get("statement_date_max"))
                or max(
                    (
                        _normalize_text(artifact.get("statement_period_end"))
                        for artifact in artifacts
                    ),
                    default="",
                ),
                _normalize_text((candidate.get("generator") or {}).get("generated_at"))
                if isinstance(candidate.get("generator"), dict)
                else "",
            )

        earliest_bochk_payload, earliest_bochk_metadata = min(
            bochk_metadata_pairs,
            key=lambda pair: (
                _normalize_text(pair[1].get("statement_date_min"))
                or min(
                    (
                        _normalize_text(artifact.get("statement_period_end"))
                        for artifact in _ii_merge_reconciliation._bochk_statement_artifacts(
                            pair[0]
                        )
                    ),
                    default="9999-12-31",
                )
            ),
        )
        latest_bochk_payload, latest_bochk_metadata = max(
            bochk_metadata_pairs,
            key=bochk_latest_key,
        )
        starting_bochk_map = _ii_payload_summaries._payload_cash_balance_map(
            earliest_bochk_payload,
            "starting_cash_by_currency",
        ) or _ii_merge_identity._normalize_bochk_currency_balance_map(
            earliest_bochk_metadata.get("starting_cash_by_currency")
        )
        ending_bochk_map = _ii_payload_summaries._payload_cash_balance_map(
            latest_bochk_payload,
            "ending_cash_by_currency",
        ) or _ii_merge_identity._normalize_bochk_currency_balance_map(
            latest_bochk_metadata.get("ending_cash_by_currency")
        )
        if not mixed_brokers_or_accounts:
            payload["starting_cash_by_currency"] = starting_bochk_map
            payload["ending_cash_by_currency"] = ending_bochk_map
        payload["summary"].update(
            {
                "statement_count": statement_count,
                "statement_periods": bochk_periods,
                "historical_statement_backfill": True,
                "duplicate_statement_row_count": sum(
                    int(str(metadata.get("duplicate_statement_row_count")))
                    for _candidate, metadata in bochk_metadata_pairs
                    if str(metadata.get("duplicate_statement_row_count", "")).isdigit()
                ),
                "bochk_subaccount_balances": latest_bochk_metadata.get(
                    "bochk_subaccount_balances", {}
                ),
                "position_snapshot_authoritative": False,
            }
        )
        if not mixed_brokers_or_accounts:
            payload["summary"].update(
                {
                    "cash_flow_transaction_source": "boc_hk_statement_pdf",
                    "cash_snapshot_source": "boc_hk_statement_balances",
                    "starting_cash_by_currency": starting_bochk_map,
                    "ending_cash_by_currency": ending_bochk_map,
                }
            )
        if statement_date_values:
            payload["summary"]["statement_date_min"] = min(statement_date_values)
            payload["summary"]["statement_date_max"] = max(statement_date_values)
        payload["bochk_subaccount_balances"] = payload["summary"][
            "bochk_subaccount_balances"
        ]
        latest_raw_broker_summaries = latest_bochk_payload.get("broker_summaries")
        latest_raw_bochk_summary = (
            latest_raw_broker_summaries.get("boc_hk")
            if isinstance(latest_raw_broker_summaries, dict)
            and isinstance(latest_raw_broker_summaries.get("boc_hk"), dict)
            else {}
        )
        bochk_broker_summary_override = {
            **latest_raw_bochk_summary,
            "broker": "boc_hk",
            "statement_count": statement_count,
            "statement_periods": bochk_periods,
            "duplicate_statement_row_count": payload["summary"][
                "duplicate_statement_row_count"
            ],
            "cash_flow_transaction_source": "boc_hk_statement_pdf",
            "cash_snapshot_source": "boc_hk_statement_balances",
            "historical_statement_backfill": True,
            "bochk_subaccount_balances": payload["summary"][
                "bochk_subaccount_balances"
            ],
        }
        if starting_bochk_map:
            bochk_broker_summary_override["starting_cash_by_currency"] = (
                starting_bochk_map
            )
        if ending_bochk_map:
            bochk_broker_summary_override["ending_cash_by_currency"] = ending_bochk_map
        if statement_date_values:
            bochk_broker_summary_override["statement_date_min"] = min(
                statement_date_values
            )
            bochk_broker_summary_override["statement_date_max"] = max(
                statement_date_values
            )
        if not mixed_brokers_or_accounts:
            payload["generator"] = {
                "name": "boc_hk_statement_pdf_to_investment_json",
                "version": BOCHK_STATEMENT_IMPORTER_VERSION,
                "generated_at": _ii_basics._now_iso(),
                "source_filename": ", ".join(
                    sorted(
                        {
                            filename
                            for artifact in bochk_artifacts
                            for filename in artifact.get("filenames", [])
                            if _normalize_text(filename)
                        }
                    )
                ),
                "statement_period": ", ".join(bochk_periods),
                "statement_count": statement_count,
                "transaction_row_count": len(merged_transactions),
            }
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    payload["broker_summaries"] = (
        _ii_payload_summaries._normalize_broker_summaries(payload)
        if is_hsbc_cash_balance_component_merge or is_bochk_statement_merge
        else _ii_payload_summaries._merge_broker_summaries(
            normalized_existing,
            normalized_incoming,
        )
    )
    if bochk_broker_summary_override is not None:
        payload["broker_summaries"]["boc_hk"] = bochk_broker_summary_override
    hsbc_broker_summary = payload["broker_summaries"].get("hsbc")
    if incoming_broker == "hsbc" and isinstance(hsbc_broker_summary, dict):
        for field_name in (
            "hsbc_ending_cash_components",
            "hsbc_cash_component_post_dates",
        ):
            if field_name in hsbc_broker_summary:
                payload["summary"][field_name] = hsbc_broker_summary[field_name]
        incoming_hsbc_components = (
            _ii_payload_summaries._payload_hsbc_ending_cash_components(
                normalized_incoming
            )
        )
        incoming_hsbc_has_usd = any(
            _ii_merge_identity._normalize_hsbc_currency_code(
                component_key.partition(":")[0]
            )
            == "USD"
            for component_key in incoming_hsbc_components
        )
        if not incoming_hsbc_has_usd and _normalize_text(
            existing_summary.get("cash_snapshot_source")
        ):
            payload["summary"]["cash_snapshot_source"] = existing_summary[
                "cash_snapshot_source"
            ]
        for field_name in (
            "cash_snapshot_source",
            "cash_snapshot_status",
            "current_moment_source",
        ):
            if field_name in hsbc_broker_summary:
                payload["summary"][field_name] = hsbc_broker_summary[field_name]
        if incoming_hsbc_cash_only_usd:
            incoming_cash_snapshot_as_of = _normalize_text(
                incoming_summary.get("cash_snapshot_as_of")
            )
            incoming_cash_snapshot_source = (
                _normalize_text(incoming_summary.get("cash_snapshot_source"))
                or "hsbc_usd_savings_available_balance"
            )
            hsbc_broker_summary.update(
                {
                    "cash_snapshot_authoritative": True,
                    "cash_snapshot_source": incoming_cash_snapshot_source,
                    "cash_snapshot_status": "current",
                    "ending_cash_base_currency_source": incoming_cash_snapshot_source,
                    "ending_cash_base_currency_status": (
                        "authoritative_current_cash_boundary"
                    ),
                }
            )
            if incoming_cash_snapshot_as_of:
                hsbc_broker_summary["cash_snapshot_as_of"] = (
                    incoming_cash_snapshot_as_of
                )
                hsbc_broker_summary["ending_cash_base_currency_as_of"] = (
                    incoming_cash_snapshot_as_of
                )
                snapshot = hsbc_broker_summary.get("hsbc_snapshot")
                snapshot = deepcopy(snapshot) if isinstance(snapshot, dict) else {}
                snapshot["cash_latest_post_date"] = incoming_cash_snapshot_as_of
                snapshot["cash_posting_status"] = "current"
                hsbc_broker_summary["hsbc_snapshot"] = snapshot
    if (
        existing_broker == incoming_broker
        and latest_payload is normalized_existing
        and not is_hsbc_cash_balance_component_merge
        and not is_bochk_statement_merge
    ):
        existing_broker_summaries = _ii_payload_summaries._normalize_broker_summaries(
            normalized_existing
        )
        if existing_broker in existing_broker_summaries:
            if existing_broker == "hsbc":
                incoming_broker_summaries = (
                    _ii_payload_summaries._normalize_broker_summaries(
                        normalized_incoming
                    )
                )
                existing_hsbc_summary = existing_broker_summaries[existing_broker]
                incoming_hsbc_summary = incoming_broker_summaries.get(existing_broker)
                payload["broker_summaries"][existing_broker] = (
                    _ii_payload_summaries._merge_hsbc_broker_summaries(
                        existing_hsbc_summary,
                        incoming_hsbc_summary,
                    )
                    if isinstance(incoming_hsbc_summary, dict)
                    else existing_hsbc_summary
                )
            else:
                payload["broker_summaries"][existing_broker] = (
                    existing_broker_summaries[existing_broker]
                )
    _ii_payload_summaries._merge_ibkr_web_capture_metadata(
        payload,
        normalized_existing,
        normalized_incoming,
    )
    # Cash evidence is independent of the position/performance snapshot winner.
    # Apply both sides so an older file chosen for snapshot fields cannot hide
    # a user-verified boundary carried by an existing web-paste supplement.
    _ii_payload_summaries._apply_ibkr_user_verified_cash_snapshot(
        payload, normalized_existing
    )
    _ii_payload_summaries._apply_ibkr_user_verified_cash_snapshot(
        payload, normalized_incoming
    )
    if (
        latest_summary.get("historical_statement_backfill") is True
        and not is_bochk_statement_merge
    ):
        payload["summary"]["historical_statement_backfill"] = True
        for field_name in (
            "statement_pair_count",
            "statement_count",
            "composite_statement_count",
            "investment_statement_count",
            "statement_date_min",
            "statement_date_max",
        ):
            if field_name in latest_summary:
                payload["summary"][field_name] = latest_summary[field_name]
    hsbc_statement_metadata = _ii_payload_summaries._merge_hsbc_statement_metadata(
        normalized_existing,
        normalized_incoming,
        merged_transactions,
    )
    if hsbc_statement_metadata:
        payload["summary"].update(hsbc_statement_metadata)
        hsbc_broker_summary = payload["broker_summaries"].get("hsbc")
        if isinstance(hsbc_broker_summary, dict):
            hsbc_broker_summary.update(hsbc_statement_metadata)
    ibkr_broker_summary = payload["broker_summaries"].get("ibkr")
    if isinstance(ibkr_broker_summary, dict) and merged_ibkr_closed_trade_details:
        ibkr_performance_snapshot = _ii_artifacts._normalize_snapshot_keys(
            ibkr_broker_summary.get("performance_snapshot")
        )
        _ii_records._prefer_ibkr_closed_trade_realized_totals(
            ibkr_performance_snapshot,
            merged_ibkr_closed_trade_details,
            transactions=merged_transactions,
        )
        ibkr_broker_summary["performance_snapshot"] = ibkr_performance_snapshot
        ibkr_broker_summary["performance_snapshot_authoritative"] = True
        ibkr_broker_summary["performance_snapshot_source"] = "ibkr_closed_trades"
    _ii_hsbc_cash_boundary._preserve_authoritative_current_cash_scope(
        payload,
        normalized_existing,
        normalized_incoming,
    )
    _ii_hsbc_cash_boundary._synchronize_hsbc_authoritative_current_cash_boundary(
        payload
    )
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def repair_ibkr_web_compact_split_fill_duplicates(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """Repair a stored ledger that retained both an IBKR aggregate and its fills."""
    normalized_payload = _ii_bindings.normalize_investment_payload_tickers(payload)
    transactions = _ii_merge_reconciliation._payload_transactions(normalized_payload)
    retained_transactions, _unused_incoming, removed_record_count, _unused_count = (
        _ii_merge_identity._reconcile_ibkr_web_compact_split_fills(transactions, [])
    )
    if not removed_record_count:
        return normalized_payload, 0

    _ii_records._sort_transactions(retained_transactions)
    previous_summary = (
        normalized_payload.get("summary")
        if isinstance(normalized_payload.get("summary"), dict)
        else {}
    )
    broker = _ii_basics._normalize_broker_code(normalized_payload.get("broker"))
    account = _normalize_text(normalized_payload.get("account"))
    mixed_brokers_or_accounts = broker == "multiple" or account == "multiple"
    open_position_snapshots = _ii_artifacts._normalize_snapshot_keys(
        normalized_payload.get("position_snapshot")
    )
    performance_snapshots = _ii_artifacts._normalize_snapshot_keys(
        normalized_payload.get("performance_snapshot")
    )
    holdings_mismatches = (
        []
        if mixed_brokers_or_accounts or not open_position_snapshots
        else _ii_records._validate_holdings(
            retained_transactions, open_position_snapshots
        )
    )
    rebuilt_summary = _ii_payload_summaries._build_summary(
        transactions=retained_transactions,
        warnings=_ii_payload_summaries._summary_list(previous_summary, "warnings"),
        unknown_types=_ii_payload_summaries._summary_list(
            previous_summary, "unknown_transaction_types"
        ),
        holdings_mismatches=holdings_mismatches,
        open_position_snapshots=open_position_snapshots,
        performance_snapshots=performance_snapshots,
        starting_cash=(
            _normalize_text(normalized_payload.get("starting_cash"))
            or _ii_payload_summaries._summary_text(
                previous_summary, "starting_cash_raw"
            )
        ),
        ending_cash=(
            _normalize_text(normalized_payload.get("ending_cash"))
            or _ii_payload_summaries._summary_text(previous_summary, "ending_cash_raw")
        ),
        merge_details=(
            previous_summary.get("incremental_import")
            if isinstance(previous_summary.get("incremental_import"), dict)
            else None
        ),
    )
    summary = {
        **previous_summary,
        **rebuilt_summary,
        "ledger_repair": {
            "kind": "ibkr_web_compact_split_fill_reconciliation",
            "removed_duplicate_record_count": removed_record_count,
        },
    }
    normalized_payload["transactions"] = retained_transactions
    normalized_payload["summary"] = summary
    _ii_payload_summaries._attach_broker_summaries(normalized_payload)
    _ii_bindings.refresh_investment_security_transfer_reconciliation(normalized_payload)
    normalized_payload["summary"]["json_size_bytes"] = len(
        json.dumps(
            normalized_payload, ensure_ascii=False, separators=(",", ":")
        ).encode()
    )
    return normalized_payload, removed_record_count
