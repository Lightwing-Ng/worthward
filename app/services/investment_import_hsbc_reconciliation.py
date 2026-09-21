"""Investment import domain: hsbc reconciliation.

Code version: v0.2.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    BytesIO,
    Callable,
    DEFAULT_CONVENTION_TIME,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    HSBC_CORPORATE_EVENT_PAYMENT_PREFIX,
    HSBC_EXPECTED_ACCOUNT_NUMBER,
    HSBC_PARTIAL_ORDER_STATUS_WARNING,
    SCHEMA_VERSION,
    TextIOWrapper,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    base64,
    csv,
    datetime,
    deepcopy,
    hashlib,
    investment_evidence_dir_for,
    json,
    normalize_ticker,
)

import app.services.investment_import_artifacts as _ii_artifacts

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_hsbc_core as _ii_hsbc_core

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records


def _hsbc_record_account_identity(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    return _ii_basics._account_identity_token("hsbc", account) if account else ""


def _attribute_hsbc_cash_only_dividends_from_existing_ledger(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
    dividend_action_loader: Callable[[set[str]], dict[str, list[dict[str, str]]]]
    | None,
) -> int:
    """Attribute only new HSBC cash-only dividend rows from same-account history."""
    if dividend_action_loader is None:
        return 0
    incoming_summary = (
        incoming_payload.get("summary")
        if isinstance(incoming_payload.get("summary"), dict)
        else {}
    )
    if (
        _ii_basics._normalize_broker_code(incoming_payload.get("broker")) != "hsbc"
        or _normalize_text(incoming_summary.get("hsbc_paste_import_scope"))
        != "cash_only_usd"
    ):
        return 0

    existing_transactions = _ii_merge_reconciliation._payload_transactions(
        existing_payload
    )
    incoming_transactions = _ii_merge_reconciliation._payload_transactions(
        incoming_payload
    )
    events_by_account: dict[str, list[dict[str, Any]]] = {}
    for record in incoming_transactions:
        if (
            _ii_basics._normalize_broker_code(record.get("broker")) != "hsbc"
            or _normalize_text(record.get("type")).lower() != "dividend"
            or _normalize_text(record.get("currency")).upper() != "USD"
            or normalize_ticker(_normalize_text(record.get("ticker")))
            or not _normalize_whitespace(record.get("description"))
            .upper()
            .startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX)
        ):
            continue
        account_identity = _hsbc_record_account_identity(record)
        if not account_identity:
            continue
        if any(
            _ii_merge_identity._has_same_hsbc_corporate_event_cash_record(
                existing_record,
                record,
            )
            and _hsbc_record_account_identity(existing_record) == account_identity
            and normalize_ticker(_normalize_text(existing_record.get("ticker")))
            for existing_record in existing_transactions
        ):
            # Preserve an existing manual or statement-backed attribution verbatim.
            continue
        events_by_account.setdefault(account_identity, []).append(record)
    if not events_by_account:
        return 0

    position_snapshots_by_account: dict[str, dict[str, dict[str, str]]] = {}
    raw_broker_snapshots = existing_payload.get("broker_snapshots")
    if isinstance(raw_broker_snapshots, dict):
        for raw_snapshot in raw_broker_snapshots.values():
            if (
                not isinstance(raw_snapshot, dict)
                or _ii_basics._normalize_broker_code(raw_snapshot.get("broker"))
                != "hsbc"
            ):
                continue
            snapshot_account = _normalize_text(raw_snapshot.get("account"))
            account_identity = (
                _ii_basics._account_identity_token("hsbc", snapshot_account)
                if snapshot_account
                else ""
            )
            if not account_identity or account_identity not in events_by_account:
                continue
            position_snapshots_by_account[account_identity] = (
                _ii_artifacts._normalize_snapshot_keys(
                    raw_snapshot.get("position_snapshot")
                )
            )

    attribution_warnings: list[str] = []
    attributed_count = 0
    for account_identity, event_records in events_by_account.items():
        order_records = [
            record
            for record in existing_transactions
            if (
                _ii_basics._normalize_broker_code(record.get("broker")) == "hsbc"
                and _hsbc_record_account_identity(record) == account_identity
                and _normalize_text(record.get("type")).lower() in {"buy", "sell"}
                and _ii_basics._is_hsbc_order_status_record(record)
            )
        ]
        before_tickers = [
            normalize_ticker(_normalize_text(record.get("ticker")))
            for record in event_records
        ]
        _ii_hsbc_core._attribute_hsbc_corporate_event_dividends(
            event_records,
            order_records,
            position_snapshots_by_account.get(account_identity, {}),
            attribution_warnings,
            dividend_action_loader,
        )
        for before_ticker, record in zip(
            before_tickers,
            event_records,
            strict=True,
        ):
            if before_ticker or not normalize_ticker(
                _normalize_text(record.get("ticker"))
            ):
                continue
            source = (
                dict(record.get("source"))
                if isinstance(record.get("source"), dict)
                else {}
            )
            source["dividend_attribution_context"] = "existing_hsbc_ledger"
            record["source"] = source
            attributed_count += 1

    if attribution_warnings:
        incoming_summary["warnings"] = _ii_payload_summaries._unique_preserving_order(
            _ii_payload_summaries._summary_list(incoming_summary, "warnings")
            + attribution_warnings
        )
        incoming_payload["summary"] = incoming_summary
    return attributed_count


def _build_hsbc_pasted_snapshot_report(
    *,
    account_number: str,
    portfolio_capture: dict[str, Any],
    parsed_order_rows: list[dict[str, str]],
    cash_records: list[dict[str, Any]],
    portfolio_text: str,
    order_status_text: str,
    cash_account_text: str,
    warnings: list[str],
) -> dict[str, Any]:
    snapshot_metadata = (
        portfolio_capture.get("snapshot_metadata")
        if isinstance(portfolio_capture.get("snapshot_metadata"), dict)
        else {}
    )
    market_data_updated_at = (
        snapshot_metadata.get("market_data_updated_at")
        if isinstance(snapshot_metadata.get("market_data_updated_at"), dict)
        else {}
    )
    portfolio_updated_date = _normalize_text(market_data_updated_at.get("date"))
    order_status_windows = _ii_hsbc_core._extract_hsbc_order_status_windows(
        order_status_text
    )
    order_status_coverage = _ii_hsbc_core._extract_hsbc_order_status_coverage(
        order_status_text
    )
    order_window_end = max(
        (
            _normalize_text(window.get("end_date"))
            for window in order_status_windows
            if _normalize_text(window.get("end_date"))
        ),
        default="",
    )
    executed_order_dates = [
        _normalize_text(row.get("order_date"))
        for row in parsed_order_rows
        if _normalize_text(row.get("status")).lower() == "fully executed"
        and _normalize_text(row.get("order_date"))
    ]
    latest_executed_order_date = max(executed_order_dates, default="")
    cash_post_dates = [
        _normalize_text(record.get("date"))
        for record in cash_records
        if isinstance(record, dict) and _normalize_text(record.get("date"))
    ]
    latest_cash_post_date = max(cash_post_dates, default="")
    cash_posting_lag = bool(
        latest_executed_order_date
        and latest_cash_post_date
        and latest_executed_order_date > latest_cash_post_date
    )

    if (
        portfolio_updated_date
        and latest_executed_order_date
        and latest_executed_order_date > portfolio_updated_date
    ):
        raise ValueError(
            "HSBC snapshot rejected: the Portfolio market-data timestamp "
            f"({portfolio_updated_date}) is older than the latest fully executed order "
            f"({latest_executed_order_date}). Recapture all three HSBC pages together."
        )
    if (
        order_window_end
        and latest_cash_post_date
        and latest_cash_post_date > order_window_end
    ):
        raise ValueError(
            "HSBC snapshot rejected: USD Savings has postings through "
            f"{latest_cash_post_date}, but Order Status ends at {order_window_end}. "
            "Use the same end boundary for all three HSBC pages."
        )
    if (
        order_window_end
        and portfolio_updated_date
        and order_window_end < portfolio_updated_date
    ):
        raise ValueError(
            "HSBC snapshot rejected: the Order Status range ends at "
            f"{order_window_end}, before the Portfolio page's latest market-data date "
            f"{portfolio_updated_date}. Recapture all three HSBC pages together."
        )

    review_reasons: list[str] = []
    if not market_data_updated_at:
        review_reasons.append(
            "Portfolio has no recognizable market-data update timestamp"
        )
    if order_status_coverage.get("mode") == "unknown":
        review_reasons.append("Order Status has no recognizable selected date range")
    status = "validated" if not review_reasons else "review"
    if review_reasons:
        warnings.append(
            "HSBC pasted snapshot requires review because the three pages could not be "
            "fully bounded to one observable moment: " + "; ".join(review_reasons) + "."
        )

    return {
        "status": status,
        "fingerprint": _ii_hsbc_core._build_hsbc_pasted_snapshot_fingerprint(
            cash_account_text=cash_account_text,
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
        ),
        "account_number": account_number,
        "portfolio_market_data_updated_at": market_data_updated_at,
        "order_status_windows": order_status_windows,
        "order_status_coverage": order_status_coverage,
        "cash_latest_post_date": latest_cash_post_date,
        "latest_fully_executed_order_date": latest_executed_order_date,
        "cash_posting_status": "awaiting_settlement" if cash_posting_lag else "current",
        "cash_posting_lag": {
            "status": "awaiting_settlement" if cash_posting_lag else "none",
            "latest_cash_post_date": latest_cash_post_date,
            "latest_fully_executed_order_date": latest_executed_order_date,
            "explanation": (
                "USD Savings postings may remain behind a fully executed order until HSBC "
                "settles the order. The current available balance remains the cash authority."
                if cash_posting_lag
                else "The visible USD Savings postings are not behind the latest fully executed order."
            ),
        },
        "checks": {
            "account_match": True,
            "portfolio_not_older_than_latest_fully_executed_order": True,
            "order_status_coverage_observable": order_status_coverage.get("mode")
            != "unknown",
            "cash_postings_may_lag_fully_executed_orders": cash_posting_lag,
            "cash_not_newer_than_order_status_end": bool(
                not order_window_end
                or not latest_cash_post_date
                or latest_cash_post_date <= order_window_end
            ),
            "order_status_covers_portfolio_market_data_date": bool(
                not order_window_end
                or not portfolio_updated_date
                or order_window_end >= portfolio_updated_date
            ),
        },
        "review_reasons": review_reasons,
    }


def _build_hsbc_cash_only_pasted_payload(
    *,
    cash_capture: dict[str, Any],
    cash_account_text: str,
    warnings: list[str],
) -> dict[str, Any]:
    """Build an HSBC cash-only payload without asserting a stock snapshot."""
    account = (
        _normalize_text(cash_capture.get("account_number"))
        or HSBC_EXPECTED_ACCOUNT_NUMBER
    )
    available_by_currency = cash_capture.get("available_by_currency")
    if not isinstance(available_by_currency, dict):
        raise ValueError(
            "No supported HSBC cash-account balances were parsed from the pasted text."
        )
    available_balance_components = cash_capture.get("available_balance_components")
    if not isinstance(available_balance_components, dict):
        available_balance_components = {}
    ending_balance_components, ending_component_post_dates = (
        _ii_hsbc_cash._resolve_hsbc_cash_capture_ending_components(cash_capture)
    )
    resolved_by_currency = _ii_hsbc_core._sum_hsbc_cash_balance_components(
        ending_balance_components
    )
    ending_cash_by_currency = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in resolved_by_currency.items()
        if currency in {"USD", "HKD", "CNH"}
    }
    if not ending_cash_by_currency:
        raise ValueError(
            "The pasted HSBC cash-account text must include a supported USD, HKD, or CNH available balance."
        )

    cash_records = cash_capture.get("records")
    if not isinstance(cash_records, list):
        cash_records = []
    transactions = [
        record
        for record in cash_records
        if isinstance(record, dict) and not record.get("exclude_from_holdings_replay")
    ]
    cash_settlement_evidence = [
        deepcopy(record)
        for record in cash_records
        if isinstance(record, dict) and record.get("exclude_from_holdings_replay")
    ]
    _ii_records._sort_transactions(transactions)
    cash_post_dates = [
        _normalize_text(record.get("date"))
        for record in cash_records
        if _normalize_text(record.get("date"))
    ]
    snapshot_fingerprint = _ii_hsbc_core._build_hsbc_pasted_snapshot_fingerprint(
        cash_account_text=cash_account_text,
        portfolio_text="",
        order_status_text="",
    )
    cash_currencies = sorted(ending_cash_by_currency)
    has_usd = "USD" in ending_cash_by_currency
    usd_available = available_by_currency.get("USD")
    usd_ledger = cash_capture.get("ledger_by_currency", {}).get("USD")
    usd_ending = resolved_by_currency.get("USD")
    ending_cash = _decimal_to_str(usd_ending) if usd_ending is not None else None
    latest_cash_post_date = max(cash_post_dates, default="")
    cash_snapshot_source = (
        "hsbc_usd_savings_ledger_balance"
        if has_usd and usd_ledger is not None
        else "hsbc_usd_savings_available_balance"
        if has_usd
        else "hsbc_multi_currency_available_balance"
    )
    cash_flow_source = (
        "hsbc_multi_currency_cash_account_text"
        if len(cash_currencies) > 1
        else "hsbc_usd_account_text"
        if has_usd
        else "hsbc_multi_currency_cash_account_text"
    )
    paste_scope = "cash_only_usd" if has_usd else "cash_only_non_usd"
    cash_only_snapshot_report = {
        "status": "cash_only",
        "fingerprint": snapshot_fingerprint,
        "account_number": account,
        "cash_currencies": cash_currencies,
        "cash_latest_post_date": latest_cash_post_date,
        "order_status_coverage": {
            "mode": "not_provided",
            "reason": "No HSBC Portfolio or Order Status page was supplied for this cash-only sync.",
        },
        "checks": {
            "account_match": True,
            "cash_only_non_usd": not has_usd,
        },
    }
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "hsbc_cash_account_pasted_text_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "portfolio_source": "",
            "order_source": "",
            "cash_flow_source": cash_flow_source,
            "cash_row_count": len(cash_records),
            "transaction_row_count": len(transactions),
            "hsbc_snapshot_fingerprint": snapshot_fingerprint,
        },
        "broker": "hsbc",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Date parsed from pasted HSBC cash-account page text.",
            "datetime_field_meaning": (
                "Business-convention datetime derived from the pasted HSBC date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots={},
            performance_snapshots={},
            starting_cash=None,
            ending_cash=ending_cash,
        ),
        "starting_cash": None,
        "ending_cash": ending_cash,
        "ending_cash_by_currency": ending_cash_by_currency,
        "ending_cash_base_currency": ending_cash,
        "position_snapshot": {},
        "performance_snapshot": {},
        "transactions": transactions,
        "source_artifacts": _ii_hsbc_core._build_hsbc_pasted_text_source_artifacts(
            cash_account_text=cash_account_text,
            portfolio_text="",
            order_status_text="",
            account=account,
            snapshot_report=cash_only_snapshot_report,
        ),
        "hsbc_cash_settlement_evidence": cash_settlement_evidence,
    }
    payload["summary"].update(
        {
            "position_snapshot_authoritative": False,
            "cash_snapshot_source": cash_snapshot_source,
            "cash_snapshot_authoritative": has_usd,
            "cash_flow_transaction_source": cash_flow_source,
            "ending_cash_by_currency": ending_cash_by_currency,
            "hsbc_ending_cash_components": _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                ending_balance_components
            ),
            "hsbc_cash_component_post_dates": _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
                ending_component_post_dates
            ),
            "hsbc_available_cash_by_currency": {
                currency: _decimal_to_str(amount) or "0"
                for currency, amount in available_by_currency.items()
            },
            "hsbc_available_cash_components": _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                available_balance_components
            ),
            "hsbc_bank_available_cash": (
                _decimal_to_str(usd_available) if usd_available is not None else None
            ),
            "cash_snapshot_status": "cash_only",
            "cash_snapshot_as_of": latest_cash_post_date,
            "cash_ledger_balance": (_decimal_to_str(usd_ledger) if has_usd else None),
            "cash_ledger_balance_as_of": latest_cash_post_date
            if usd_ledger is not None
            else "",
            "cash_ledger_balance_source": (
                "hsbc_usd_savings_ledger_balance" if usd_ledger is not None else ""
            ),
            "ending_cash_base_currency": ending_cash,
            "ending_cash_base_currency_as_of": latest_cash_post_date if has_usd else "",
            "ending_cash_base_currency_source": cash_snapshot_source if has_usd else "",
            "ending_cash_base_currency_status": (
                "authoritative_current_cash_boundary" if has_usd else ""
            ),
            "current_moment_source": "hsbc_cash_accounts_only",
            "order_history_scope": {
                "mode": "not_provided",
                "reason": "No HSBC Portfolio or Order Status page was supplied for this cash-only sync.",
            },
            "hsbc_paste_import_scope": paste_scope,
            "account_expected": HSBC_EXPECTED_ACCOUNT_NUMBER,
            "hsbc_snapshot": cash_only_snapshot_report,
        }
    )
    for transaction in payload["transactions"]:
        transaction["broker"] = "hsbc"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "hsbc"
            source["account"] = account
        transaction["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def build_investment_payload_from_hsbc_pasted_text(
    *,
    portfolio_text: str,
    order_status_text: str,
    cash_account_text: str,
    dividend_action_loader: Callable[[set[str]], dict[str, list[dict[str, str]]]]
    | None = None,
) -> dict[str, Any]:
    warnings: list[str] = []
    portfolio_text = str(portfolio_text or "").strip()
    order_status_text = str(order_status_text or "").strip()
    cash_account_text = str(cash_account_text or "").strip()
    cash_capture = _ii_hsbc_core._build_hsbc_cash_account_capture_from_text(
        cash_account_text,
        warnings=warnings,
    )
    available_by_currency = cash_capture["available_by_currency"]
    if "USD" not in available_by_currency:
        if portfolio_text or order_status_text:
            raise ValueError(
                "HKD/CNH cash-only HSBC sync requires Portfolio and Order Status to be empty. "
                "Use HSBC statements for non-USD investment activity."
            )
        return _build_hsbc_cash_only_pasted_payload(
            cash_capture=cash_capture,
            cash_account_text=cash_account_text,
            warnings=warnings,
        )
    if not portfolio_text and not order_status_text:
        return _build_hsbc_cash_only_pasted_payload(
            cash_capture=cash_capture,
            cash_account_text=cash_account_text,
            warnings=warnings,
        )
    if not portfolio_text or not order_status_text:
        raise ValueError(
            "USD Savings requires the matching HSBC Portfolio and Order Status pages before syncing."
        )
    portfolio_account_number, portfolio_capture = (
        _ii_hsbc_core._parse_hsbc_portfolio_plain_text(portfolio_text)
    )
    position_snapshot, portfolio_snapshot_account = (
        _ii_hsbc_core._build_hsbc_position_snapshot(
            portfolio_capture,
            warnings,
        )
    )
    order_account_number, parsed_order_rows = (
        _ii_hsbc_core._parse_hsbc_order_status_plain_text(order_status_text)
    )
    cash_account_number = cash_capture["account_number"]
    ledger_by_currency = cash_capture["ledger_by_currency"]
    available_balance = available_by_currency.get("USD")
    ledger_balance = ledger_by_currency.get("USD")
    cash_records = cash_capture["records"]
    if available_balance is None:
        raise ValueError(
            "The pasted HSBC cash-account text must include the USD Savings balance for U.S. equity reconciliation."
        )
    if (
        portfolio_account_number != order_account_number
        or portfolio_account_number != cash_account_number
        or (
            portfolio_snapshot_account
            and portfolio_snapshot_account != portfolio_account_number
        )
    ):
        raise ValueError(
            "The pasted HSBC cash-account, Portfolio, and Order Status text belong to different accounts."
        )

    snapshot_report = _build_hsbc_pasted_snapshot_report(
        account_number=portfolio_account_number,
        portfolio_capture=portfolio_capture,
        parsed_order_rows=parsed_order_rows,
        cash_records=cash_records,
        portfolio_text=portfolio_text,
        order_status_text=order_status_text,
        cash_account_text=cash_account_text,
        warnings=warnings,
    )

    order_records: list[dict[str, Any]] = []
    seen_order_refs: set[str] = set()
    for row_number, row in enumerate(parsed_order_rows, start=1):
        order_reference = _normalize_text(row.get("order_reference"))
        if not order_reference or order_reference in seen_order_refs:
            continue
        seen_order_refs.add(order_reference)
        status = _normalize_text(row.get("status"))
        if status.lower() != "fully executed":
            continue
        side_raw = _normalize_text(row.get("transaction_type"))
        side = side_raw.lower()
        if side not in {"buy", "sell"}:
            warnings.append(
                f"HSBC pasted order row {row_number}: unsupported transaction type {side_raw!r}."
            )
            continue
        order_day = _ii_hsbc_core._parse_hsbc_iso_date(
            row.get("order_date"),
            f"HSBC pasted order row {row_number} order date",
        )
        quantity_dec = _ii_hsbc_core._parse_hsbc_decimal(
            row.get("executed_quantity") or row.get("quantity"),
            "executed quantity",
            warnings,
            row_number=row_number,
            required=True,
        )
        price_dec = _ii_hsbc_core._parse_hsbc_decimal(
            row.get("price"),
            "price",
            warnings,
            row_number=row_number,
            required=True,
        )
        if (
            quantity_dec is None
            or quantity_dec <= ZERO
            or price_dec is None
            or price_dec <= ZERO
        ):
            continue
        gross_amount_dec = abs(quantity_dec * price_dec)
        signed_amount_dec = -gross_amount_dec if side == "buy" else gross_amount_dec
        symbol = normalize_ticker(_normalize_text(row.get("symbol")))
        description = _normalize_text(row.get("full_name")) or symbol or order_reference
        record: dict[str, Any] = {
            "date": order_day.isoformat(),
            "datetime": f"{order_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": side,
            "ticker": symbol,
            "currency": "USD",
            "description": description,
            "source": {
                "file_kind": "hsbc_order_status_text",
                "row_number": row_number,
                "order_status_source_row_number": row_number,
                "order_status_page_order": "newest_first",
                "transaction_type_raw": side_raw or status or "HSBCOrder",
                "order_id": order_reference,
                "statement_order_id": order_reference,
                "order_status": status,
                "order_type": _normalize_text(row.get("order_type")),
                "account_number": order_account_number,
                "captured_order_date_display": _normalize_text(
                    row.get("order_date_display")
                ),
            },
            "quantity_raw": _decimal_to_str(quantity_dec) or "",
            "quantity_abs": _decimal_to_str(abs(quantity_dec)) or "",
            "price_raw": _decimal_to_str(price_dec) or "",
            "gross_amount_raw": _decimal_to_str(signed_amount_dec),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(signed_amount_dec),
        }
        record["normalized"] = _build_normalized_view(
            side,
            abs(quantity_dec),
            price_dec,
            signed_amount_dec,
            ZERO,
            signed_amount_dec,
        )
        order_records.append(record)

    calibrated_order_count = _ii_hsbc_cash._calibrate_hsbc_order_prices_from_portfolio(
        order_records,
        position_snapshot,
    )
    _ii_hsbc_cash._match_hsbc_orders_to_cash_settlements(
        order_records, cash_records, warnings
    )
    _ii_hsbc_cash._mark_unsettled_hsbc_order_cash_replay_pending(
        order_records, cash_records
    )
    pending_order_ids = [
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("statement_order_id")
        )
        for record in order_records
        if isinstance(record.get("source"), dict)
        and record["source"].get("cash_replay_pending_settlement") is True
    ]
    settled_execution_order_ids = [
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("statement_order_id")
        )
        for record in order_records
        if isinstance(record.get("source"), dict)
        and record["source"].get("execution_price_status") == "final_settled"
    ]
    settled_execution_order_ids = [
        order_id for order_id in settled_execution_order_ids if order_id
    ]
    snapshot_report["execution_price_reconciliation"] = {
        "status": (
            "partially_settled"
            if settled_execution_order_ids and pending_order_ids
            else "settled"
            if settled_execution_order_ids
            else "provisional_pending_settlement"
            if pending_order_ids
            else "not_available"
        ),
        "settled_order_ids": settled_execution_order_ids,
        "pending_order_ids": pending_order_ids,
        "explanation": (
            "Settled USD Savings cash flows supersede provisional Portfolio pricing; "
            "orders without visible settlement retain their current-moment Portfolio "
            "calibration until the next import."
        ),
    }
    if pending_order_ids:
        snapshot_report["cash_posting_lag"]["pending_order_ids"] = pending_order_ids
    _ii_hsbc_core._attribute_hsbc_corporate_event_dividends(
        cash_records,
        order_records,
        position_snapshot,
        warnings,
        dividend_action_loader,
    )
    holdings_mismatches = _ii_records._validate_holdings(
        order_records, position_snapshot
    )
    if holdings_mismatches:
        coverage_mode = snapshot_report["order_status_coverage"].get("mode")
        comparison_scope = (
            "visible_rolling_order_status_window"
            if coverage_mode == "rolling_recent_window"
            else "visible_explicit_order_status_date_ranges"
            if coverage_mode == "explicit_date_ranges"
            else "visible_order_status_window"
        )
        snapshot_report["position_reconciliation"] = {
            "status": "not_expected_to_match",
            "scope": comparison_scope,
            "history_complete": False,
            "mismatches": holdings_mismatches,
            "explanation": (
                "The HSBC Portfolio is the authoritative current position snapshot; "
                "the visible Order Status rows are a partial-history supplement and "
                "cannot independently reconstruct older holdings."
            ),
        }
        if coverage_mode != "rolling_recent_window":
            warnings.append(HSBC_PARTIAL_ORDER_STATUS_WARNING)
    visible_cash_records = [
        record
        for record in cash_records
        if not record.get("exclude_from_holdings_replay")
    ]
    transactions = visible_cash_records + order_records
    _ii_records._sort_transactions(transactions)
    account = (
        portfolio_account_number or order_account_number or HSBC_EXPECTED_ACCOUNT_NUMBER
    )
    available_balance_components = cash_capture.get("available_balance_components")
    if not isinstance(available_balance_components, dict):
        available_balance_components = {}
    ending_balance_components, ending_component_post_dates = (
        _ii_hsbc_cash._resolve_hsbc_cash_capture_ending_components(cash_capture)
    )
    resolved_by_currency = _ii_hsbc_core._sum_hsbc_cash_balance_components(
        ending_balance_components
    )
    resolved_usd_candidate = resolved_by_currency.get("USD")
    resolved_usd_balance = (
        resolved_usd_candidate
        if resolved_usd_candidate is not None
        else available_balance
    )
    ending_cash_by_currency = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in resolved_by_currency.items()
    }
    has_non_usd_cash = any(currency != "USD" for currency in available_by_currency)
    cash_flow_source = (
        "hsbc_multi_currency_cash_account_text"
        if has_non_usd_cash
        else "hsbc_usd_account_text"
    )
    cash_snapshot_source = (
        "hsbc_multi_currency_ledger_balance"
        if has_non_usd_cash and ledger_balance is not None
        else "hsbc_usd_savings_ledger_balance"
        if ledger_balance is not None
        else "hsbc_multi_currency_available_balance"
        if has_non_usd_cash
        else "hsbc_usd_savings_available_balance"
    )
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "hsbc_pasted_text_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "portfolio_source": "hsbc_portfolio_text",
            "order_source": "hsbc_order_status_text",
            "cash_flow_source": cash_flow_source,
            "portfolio_row_count": len(position_snapshot),
            "order_row_count": len(order_records),
            "cash_row_count": len(cash_records),
            "transaction_row_count": len(transactions),
            "portfolio_calibrated_order_count": calibrated_order_count,
            "hsbc_snapshot_fingerprint": snapshot_report["fingerprint"],
        },
        "broker": "hsbc",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Date parsed from pasted HSBC page text.",
            "datetime_field_meaning": (
                "Business-convention datetime derived from the pasted HSBC date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots=position_snapshot,
            performance_snapshots={},
            starting_cash=None,
            ending_cash=_decimal_to_str(resolved_usd_balance),
        ),
        "starting_cash": None,
        "ending_cash": _decimal_to_str(resolved_usd_balance),
        "ending_cash_by_currency": ending_cash_by_currency,
        "ending_cash_base_currency": _decimal_to_str(resolved_usd_balance),
        "position_snapshot": position_snapshot,
        "performance_snapshot": {},
        "source_artifacts": _ii_hsbc_core._build_hsbc_pasted_text_source_artifacts(
            cash_account_text=cash_account_text,
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            account=account,
            snapshot_report=snapshot_report,
        ),
        "transactions": transactions,
    }
    payload["summary"]["position_snapshot_authoritative"] = True
    payload["summary"]["position_snapshot_source"] = "hsbc_portfolio_text"
    payload["summary"]["cash_snapshot_source"] = cash_snapshot_source
    payload["summary"]["cash_flow_transaction_source"] = cash_flow_source
    payload["summary"]["ending_cash_by_currency"] = ending_cash_by_currency
    payload["summary"]["hsbc_ending_cash_components"] = (
        _ii_hsbc_core._serialize_hsbc_cash_balance_components(ending_balance_components)
    )
    payload["summary"]["hsbc_cash_component_post_dates"] = (
        _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
            ending_component_post_dates
        )
    )
    payload["summary"]["hsbc_available_cash_by_currency"] = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in available_by_currency.items()
    }
    payload["summary"]["hsbc_available_cash_components"] = (
        _ii_hsbc_core._serialize_hsbc_cash_balance_components(
            available_balance_components
        )
    )
    payload["summary"]["hsbc_bank_available_cash"] = (
        _decimal_to_str(available_balance) or "0"
    )
    payload["summary"]["ending_cash_base_currency"] = _decimal_to_str(
        resolved_usd_balance
    )
    payload["summary"]["cash_snapshot_status"] = snapshot_report["cash_posting_status"]
    payload["summary"]["current_moment_source"] = "hsbc_portfolio_and_order_status"
    payload["summary"]["hsbc_paste_import_scope"] = "usd_composite"
    payload["summary"]["order_history_scope"] = snapshot_report["order_status_coverage"]
    payload["summary"]["hsbc_portfolio_calibrated_order_count"] = calibrated_order_count
    payload["summary"]["hsbc_final_settled_execution_count"] = len(
        settled_execution_order_ids
    )
    payload["summary"]["hsbc_final_settled_execution_order_ids"] = (
        settled_execution_order_ids
    )
    payload["summary"]["account_expected"] = HSBC_EXPECTED_ACCOUNT_NUMBER
    payload["summary"]["hsbc_snapshot"] = snapshot_report
    if holdings_mismatches:
        position_reconciliation = snapshot_report["position_reconciliation"]
        payload["summary"]["holdings_validation"].update(
            {
                "status": "snapshot_authoritative_partial_history",
                "comparison_scope": position_reconciliation["scope"],
                "history_complete": False,
                "position_snapshot_authoritative": True,
                "interpretation": position_reconciliation["explanation"],
            }
        )
    position_market_value = sum(
        _ii_hsbc_cash._parse_decimal_text_or_none(position.get("market_value")) or ZERO
        for position in position_snapshot.values()
        if isinstance(position, dict)
    )
    reported_total_market_value = _ii_hsbc_cash._parse_decimal_text_or_none(
        portfolio_capture.get("reported_total_market_value")
    )
    payload["summary"]["position_snapshot_market_value"] = (
        _decimal_to_str(position_market_value) or "0"
    )
    if reported_total_market_value is not None:
        market_value_difference = position_market_value - reported_total_market_value
        payload["summary"]["hsbc_portfolio_reported_market_value"] = (
            _decimal_to_str(reported_total_market_value) or "0"
        )
        payload["summary"]["hsbc_position_market_value_reconciliation"] = {
            "matched": abs(market_value_difference) <= Decimal("0.02"),
            "calculated_market_value": _decimal_to_str(position_market_value) or "0",
            "reported_market_value": _decimal_to_str(reported_total_market_value)
            or "0",
            "difference": _decimal_to_str(market_value_difference) or "0",
            "calculation": "sum(quantity * last_price)",
        }
    payload["summary"].update(
        _ii_hsbc_cash._summarize_hsbc_pending_settlement_cash(
            payload["transactions"],
            available_balance,
            broker_cash_balance=resolved_usd_balance,
        )
    )
    if ledger_balance is not None:
        payload["summary"]["cash_ledger_balance"] = _decimal_to_str(ledger_balance)
        payload["summary"]["cash_ledger_balance_as_of"] = _normalize_text(
            snapshot_report.get("cash_latest_post_date")
        )
        payload["summary"]["cash_ledger_balance_source"] = (
            "hsbc_usd_savings_ledger_balance"
        )
        payload["summary"]["ending_cash_base_currency_source"] = (
            "hsbc_usd_savings_ledger_balance"
        )
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "hsbc"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "hsbc"
            source["account"] = account
        transaction["account"] = account
    _ii_hsbc_cash._annotate_hsbc_available_cash_after(
        payload["transactions"], available_balance
    )
    _ii_hsbc_cash._prune_stale_hsbc_available_cash_annotations(payload["transactions"])
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _build_hsbc_usd_savings_csv_source_artifact(
    *,
    csv_bytes: bytes,
    filename: str,
    account: str,
    date_min: str,
    date_max: str,
) -> dict[str, Any]:
    digest = hashlib.sha256(csv_bytes).hexdigest()
    normalized_filename = (
        _normalize_text(filename) or "hsbc-usd-savings-transaction-history.csv"
    )
    return {
        "evidence_schema_version": "1.0",
        "sha256": digest,
        "byte_count": len(csv_bytes),
        "filename": normalized_filename,
        "filenames": [normalized_filename],
        "broker": "hsbc",
        "account": account,
        "source_kind": "hsbc_usd_savings_transaction_history_csv",
        "bundle_id": digest,
        "bundle_ids": [digest],
        "bundle_role": "transaction_history",
        "statement_title": "HSBC USD Savings Transaction History",
        "statement_period": f"{date_min}/{date_max}",
        "statement_period_start": date_min,
        "statement_period_end": date_max,
        "statement_generated_at": "",
        "content_encoding": "base64",
        "content_base64": base64.b64encode(csv_bytes).decode("ascii"),
    }


def _parse_hsbc_usd_savings_csv_rows(
    csv_bytes: bytes,
) -> list[dict[str, Any]]:
    """Parse and validate HSBC USD Savings rows in newest-first order."""
    expected_headers = (
        "Date",
        "Description",
        "Billing amount",
        "Billing currency",
        "Balance",
        "Balance currency",
    )
    try:
        text_stream = TextIOWrapper(
            BytesIO(csv_bytes), encoding="utf-8-sig", newline=""
        )
        reader = csv.DictReader(text_stream)
        raw_headers = reader.fieldnames or []
        headers = tuple(_normalize_text(header) for header in raw_headers)
        if headers != expected_headers:
            raise ValueError(
                "The HSBC USD Savings CSV must contain the columns: "
                + ", ".join(expected_headers)
                + "."
            )

        parsed_rows: list[dict[str, Any]] = []
        for row_number, raw_row in enumerate(reader, start=2):
            row = {
                _normalize_text(key): _normalize_text(value)
                for key, value in raw_row.items()
                if key is not None
            }
            if not any(row.values()):
                continue
            raw_date = row.get("Date", "")
            try:
                transaction_day = datetime.strptime(raw_date, "%d/%m/%Y").date()
            except ValueError as exc:
                raise ValueError(
                    f"HSBC USD Savings CSV row {row_number} has an invalid Date; expected DD/MM/YYYY."
                ) from exc
            billing_currency = row.get("Billing currency", "").upper()
            balance_currency = row.get("Balance currency", "").upper()
            if billing_currency != "USD" or balance_currency != "USD":
                raise ValueError(
                    f"HSBC USD Savings CSV row {row_number} must use USD for both currencies."
                )
            description = _normalize_whitespace(row.get("Description"))
            if not description:
                raise ValueError(
                    f"HSBC USD Savings CSV row {row_number} is missing a Description."
                )
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                row.get("Billing amount")
            )
            balance = _ii_hsbc_cash._parse_decimal_text_or_none(row.get("Balance"))
            if amount is None or balance is None or amount == ZERO:
                raise ValueError(
                    f"HSBC USD Savings CSV row {row_number} has an invalid Billing amount or Balance."
                )
            parsed_rows.append(
                {
                    "row_number": row_number,
                    "date": transaction_day,
                    "description": description,
                    "amount": amount,
                    "balance": balance,
                }
            )
    finally:
        text_stream.close()

    if not parsed_rows:
        raise ValueError(
            "The HSBC USD Savings Transaction History CSV contains no transactions."
        )

    dates = [row["date"] for row in parsed_rows]
    is_descending = all(left >= right for left, right in zip(dates, dates[1:]))
    is_ascending = all(left <= right for left, right in zip(dates, dates[1:]))
    if not is_descending and not is_ascending:
        raise ValueError(
            "The HSBC USD Savings CSV dates must be in chronological order."
        )
    rows_descending = parsed_rows if is_descending else list(reversed(parsed_rows))
    for index in range(len(rows_descending) - 1):
        newer = rows_descending[index]
        older = rows_descending[index + 1]
        expected_newer_balance = older["balance"] + newer["amount"]
        if newer["balance"] != expected_newer_balance:
            raise ValueError(
                "HSBC USD Savings CSV balance continuity failed between rows "
                f"{newer['row_number']} and {older['row_number']}."
            )
    return rows_descending


def build_investment_payload_from_hsbc_usd_savings_csv(
    csv_bytes: bytes,
    *,
    filename: str = "",
) -> dict[str, Any]:
    """Build an authoritative HSBC USD Savings cash calibration from one CSV."""
    if not csv_bytes:
        raise ValueError("The HSBC USD Savings Transaction History CSV is empty.")

    rows_descending = _parse_hsbc_usd_savings_csv_rows(csv_bytes)
    parsed_rows = rows_descending

    account = HSBC_EXPECTED_ACCOUNT_NUMBER
    latest_row = rows_descending[0]
    earliest_row = rows_descending[-1]
    starting_balance = earliest_row["balance"] - earliest_row["amount"]
    warnings: list[str] = []
    all_records: list[dict[str, Any]] = []
    for row in reversed(rows_descending):
        amount = row["amount"]
        mapped_type = _ii_hsbc_core._classify_hsbc_cash_account_transaction(
            row["description"],
            amount,
        )
        source: dict[str, Any] = {
            "file_kind": "hsbc_usd_savings_csv",
            "row_number": row["row_number"],
            "ledger_sequence": row["row_number"],
            "account_number": account,
            "account_type": "USD Savings",
            "balance_after_raw": _decimal_to_str(row["balance"]),
            "reference_id": _normalize_whitespace(row["description"]),
            "cash_balance_scope": "account",
            "cash_balance_authoritative": True,
        }
        record: dict[str, Any] = {
            "date": row["date"].isoformat(),
            "datetime": f"{row['date'].isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": mapped_type,
            "ticker": "",
            "currency": "USD",
            "description": row["description"],
            "source": source,
            "quantity_raw": "",
            "quantity_abs": "",
            "price_raw": "",
            "gross_amount_raw": _decimal_to_str(amount),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(amount),
        }
        record["normalized"] = _build_normalized_view(
            mapped_type,
            None,
            None,
            amount,
            ZERO,
            amount,
            is_cash_flow_override=True,
        )
        if _ii_hsbc_core._should_ignore_hsbc_cash_account_row(row["description"]):
            record["presentation_hidden"] = True
            record["presentation_hidden_reason"] = "hsbc_order_cash_settlement"
            record["exclude_from_holdings_replay"] = True
        all_records.append(record)

    visible_records = [
        record
        for record in all_records
        if not record.get("exclude_from_holdings_replay")
    ]
    _ii_records._sort_transactions(visible_records)
    date_min = min(row["date"] for row in parsed_rows).isoformat()
    date_max = max(row["date"] for row in parsed_rows).isoformat()
    latest_balance = _decimal_to_str(latest_row["balance"]) or "0"
    starting_balance_text = _decimal_to_str(starting_balance) or "0"
    ending_cash_by_currency = {"USD": latest_balance}
    component_key = _ii_hsbc_core._hsbc_cash_balance_component_key("USD", "USD Savings")
    component_dates = {component_key: date_max}
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "hsbc_usd_savings_csv_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "source_filename": _normalize_text(filename),
            "cash_row_count": len(all_records),
            "transaction_row_count": len(visible_records),
        },
        "broker": "hsbc",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Date parsed from the HSBC USD Savings Transaction History CSV.",
            "datetime_field_meaning": (
                "Business-convention datetime derived from the HSBC transaction date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=visible_records,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots={},
            performance_snapshots={},
            starting_cash=starting_balance_text,
            ending_cash=latest_balance,
        ),
        "starting_cash": starting_balance_text,
        "ending_cash": latest_balance,
        "starting_cash_by_currency": {"USD": starting_balance_text},
        "ending_cash_by_currency": ending_cash_by_currency,
        "starting_cash_base_currency": starting_balance_text,
        "ending_cash_base_currency": latest_balance,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": [
            _build_hsbc_usd_savings_csv_source_artifact(
                csv_bytes=csv_bytes,
                filename=filename,
                account=account,
                date_min=date_min,
                date_max=date_max,
            )
        ],
        "transactions": visible_records,
    }
    payload["summary"].update(
        {
            "cash_snapshot_source": "hsbc_usd_savings_transaction_history_csv",
            "cash_flow_transaction_source": "hsbc_usd_savings_transaction_history_csv",
            "cash_snapshot_status": "authoritative",
            "current_moment_source": "hsbc_usd_savings_transaction_history_csv",
            "historical_statement_backfill": True,
            "statement_date_min": date_min,
            "statement_date_max": date_max,
            "starting_cash_by_currency": {"USD": starting_balance_text},
            "ending_cash_by_currency": ending_cash_by_currency,
            "starting_cash_base_currency": starting_balance_text,
            "ending_cash_base_currency": latest_balance,
            "hsbc_ending_cash_components": {
                component_key: latest_balance,
            },
            "hsbc_cash_component_post_dates": component_dates,
            "account_expected": account,
        }
    )
    for record in payload["transactions"]:
        record["broker"] = "hsbc"
        record["account"] = account
        source = record.get("source")
        if isinstance(source, dict):
            source["broker"] = "hsbc"
            source["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _hsbc_usd_savings_csv_settlement_evidence(
    source_artifacts: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Extract immutable, reference-addressable settlement evidence from CSV artifacts."""
    artifacts_by_reference: dict[str, list[dict[str, Any]]] = {}
    seen_digests: set[str] = set()
    for artifact in source_artifacts:
        if (
            _normalize_text(artifact.get("source_kind"))
            != "hsbc_usd_savings_transaction_history_csv"
        ):
            continue
        digest = _normalize_text(artifact.get("sha256")).lower()
        if not digest or digest in seen_digests:
            continue
        encoded = artifact.get("content_base64")
        if isinstance(encoded, str) and encoded:
            try:
                csv_bytes = base64.b64decode(encoded, validate=True)
            except (TypeError, ValueError):
                continue
        else:
            storage_key = _normalize_text(artifact.get("storage_key")).lower()
            if storage_key != digest:
                continue
            evidence_path = investment_evidence_dir_for() / f"{storage_key}.bin"
            try:
                csv_bytes = evidence_path.read_bytes()
            except OSError:
                continue
        if (
            len(csv_bytes) != int(artifact.get("byte_count", -1) or -1)
            or hashlib.sha256(csv_bytes).hexdigest() != digest
        ):
            continue
        try:
            rows_descending = _parse_hsbc_usd_savings_csv_rows(csv_bytes)
        except ValueError:
            continue
        seen_digests.add(digest)
        for chronological_sequence, row in enumerate(
            reversed(rows_descending),
            start=1,
        ):
            order_reference = (
                _ii_hsbc_cash._extract_hsbc_order_reference_from_cash_description(
                    row["description"]
                )
            )
            if not order_reference:
                continue
            artifacts_by_reference.setdefault(order_reference, []).append(
                {
                    "date": row["date"].isoformat(),
                    "amount_raw": _decimal_to_str(row["amount"]) or "0",
                    "balance_after_raw": _decimal_to_str(row["balance"]) or "",
                    "reference": row["description"],
                    "row_number": int(row["row_number"]),
                    "ledger_sequence": chronological_sequence,
                    "source_file_kind": "hsbc_usd_savings_csv",
                    "source_file_sha256": digest,
                    "statement_period_end": _normalize_text(
                        artifact.get("statement_period_end")
                    ),
                    "currency": "USD",
                }
            )

    selected: dict[str, list[dict[str, Any]]] = {}
    for order_reference, candidates in artifacts_by_reference.items():
        latest_period_end = max(
            _normalize_text(candidate.get("statement_period_end"))
            for candidate in candidates
        )
        selected[order_reference] = sorted(
            [
                candidate
                for candidate in candidates
                if _normalize_text(candidate.get("statement_period_end"))
                == latest_period_end
            ],
            key=_ii_hsbc_cash._hsbc_settlement_posting_sort_key,
        )
    return selected


def _reconcile_hsbc_orders_with_authoritative_cash_evidence(
    transactions: list[dict[str, Any]],
    source_artifacts: list[dict[str, Any]],
) -> int:
    """Use official USD CSV rows to repair matched order settlement metadata."""
    evidence_by_reference = _hsbc_usd_savings_csv_settlement_evidence(source_artifacts)
    updated_count = 0
    for order_record in transactions:
        if not isinstance(order_record, dict):
            continue
        if _ii_basics._normalize_broker_code(order_record.get("broker")) != "hsbc":
            continue
        if _normalize_text(order_record.get("type")).lower() not in {"buy", "sell"}:
            continue
        order_source = (
            order_record.get("source")
            if isinstance(order_record.get("source"), dict)
            else {}
        )
        order_reference = _normalize_text(
            order_source.get("statement_order_id") or order_source.get("order_id")
        )
        candidates = evidence_by_reference.get(order_reference, [])
        if not candidates:
            continue
        expected_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
            order_source.get("cash_settlement_amount_raw")
            or order_record.get("net_amount_raw")
        )
        expected_sign = (
            -1 if _normalize_text(order_record.get("type")).lower() == "buy" else 1
        )
        principal_candidates = [
            candidate
            for candidate in candidates
            if (
                (
                    candidate_amount := _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                )
                is not None
                and (
                    (expected_sign < 0 and candidate_amount < ZERO)
                    or (expected_sign > 0 and candidate_amount > ZERO)
                )
            )
        ]
        if not principal_candidates:
            continue
        principal = min(
            principal_candidates,
            key=lambda candidate: abs(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                    or ZERO
                )
                - (expected_amount or ZERO)
            ),
        )
        principal_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
            principal.get("amount_raw")
        )
        if principal_amount is None:
            continue
        if expected_amount is not None and abs(
            principal_amount - expected_amount
        ) > Decimal("0.01"):
            continue
        fee_candidates = [
            candidate
            for candidate in candidates
            if candidate is not principal
            and expected_sign > 0
            and (
                (
                    candidate_amount := _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                )
                is not None
                and ZERO > candidate_amount >= Decimal("-1.00")
            )
        ]
        postings = [
            {
                **principal,
                "role": "principal",
            },
            *[
                {
                    **fee_candidate,
                    "role": "fee",
                }
                for fee_candidate in fee_candidates
            ],
        ]
        postings.sort(key=_ii_hsbc_cash._hsbc_settlement_posting_sort_key)
        previous_signature = (
            _normalize_text(order_source.get("cash_settlement_balance_after_raw")),
            json.dumps(
                order_source.get("cash_settlement_postings", []),
                ensure_ascii=False,
                sort_keys=True,
            ),
            _normalize_text(order_source.get("cash_settlement_source_file_sha256")),
        )
        order_source["cash_settlement_postings"] = postings
        order_source["cash_settlement_amount_raw"] = (
            _decimal_to_str(principal_amount) or "0"
        )
        order_source["cash_settlement_date"] = _normalize_text(principal.get("date"))
        order_source["cash_settlement_reference"] = _normalize_whitespace(
            principal.get("reference")
        )
        order_source["cash_settlement_authoritative_source"] = (
            "hsbc_usd_savings_transaction_history_csv"
        )
        order_source["cash_settlement_source_file_sha256"] = _normalize_text(
            principal.get("source_file_sha256")
        )
        _ii_hsbc_cash._finalize_hsbc_order_settlement_balance(order_source)
        if fee_candidates:
            fee_total = sum(
                abs(
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                    or ZERO
                )
                for candidate in fee_candidates
            )
            order_source["cash_flow_fee_amount_raw"] = _decimal_to_str(fee_total) or "0"
            order_source["cash_flow_fee_row_numbers"] = [
                int(candidate.get("row_number", 0) or 0) for candidate in fee_candidates
            ]
            commission_text = _decimal_to_str(-fee_total) or "0"
            order_record["commission_raw"] = commission_text
            normalized = (
                order_record.get("normalized")
                if isinstance(order_record.get("normalized"), dict)
                else {}
            )
            normalized["commission"] = commission_text
            normalized["commission_display"] = _decimal_to_str(fee_total) or "0"
            order_record["normalized"] = normalized
        order_record["net_amount_raw"] = _decimal_to_str(principal_amount) or "0"
        normalized = (
            order_record.get("normalized")
            if isinstance(order_record.get("normalized"), dict)
            else {}
        )
        normalized["net_amount"] = order_record["net_amount_raw"]
        normalized["accounting_adjustment_amount"] = order_record["net_amount_raw"]
        order_record["normalized"] = normalized
        order_record["source"] = order_source
        next_signature = (
            _normalize_text(order_source.get("cash_settlement_balance_after_raw")),
            json.dumps(
                order_source.get("cash_settlement_postings", []),
                ensure_ascii=False,
                sort_keys=True,
            ),
            _normalize_text(order_source.get("cash_settlement_source_file_sha256")),
        )
        if previous_signature != next_signature:
            updated_count += 1
    return updated_count


def _reconcile_hsbc_order_settlement_balances_from_postings(
    transactions: list[dict[str, Any]],
) -> int:
    updated_count = 0
    for record in transactions:
        if not isinstance(record, dict):
            continue
        if _ii_basics._normalize_broker_code(record.get("broker")) != "hsbc":
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _ii_hsbc_cash._finalize_hsbc_order_settlement_balance(source):
            updated_count += 1
        record["source"] = source
    return updated_count


def _synchronize_hsbc_authoritative_current_cash_boundary(
    payload: dict[str, Any],
) -> bool:
    """Keep the HSBC USD component aligned with the verified current cash boundary."""
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    broker_summaries = payload.get("broker_summaries")
    hsbc_summary = (
        broker_summaries.get("hsbc")
        if isinstance(broker_summaries, dict)
        and isinstance(broker_summaries.get("hsbc"), dict)
        else {}
    )
    snapshot = (
        hsbc_summary.get("hsbc_snapshot")
        if isinstance(hsbc_summary.get("hsbc_snapshot"), dict)
        else summary.get("hsbc_snapshot")
        if isinstance(summary.get("hsbc_snapshot"), dict)
        else {}
    )
    cash_post_date = _normalize_text(snapshot.get("cash_latest_post_date"))
    if not cash_post_date:
        cash_posting_lag = snapshot.get("cash_posting_lag")
        if isinstance(cash_posting_lag, dict):
            cash_post_date = _normalize_text(
                cash_posting_lag.get("latest_cash_post_date")
            )
    cash_post_date = _normalize_text(
        cash_post_date
        or hsbc_summary.get("cash_ledger_balance_as_of")
        or summary.get("cash_ledger_balance_as_of")
        or hsbc_summary.get("ending_cash_base_currency_as_of")
        or summary.get("ending_cash_base_currency_as_of")
        or hsbc_summary.get("cash_snapshot_as_of")
        or summary.get("cash_snapshot_as_of")
    )[:10]
    current_cash_status = _normalize_text(
        hsbc_summary.get("ending_cash_base_currency_status")
        or summary.get("ending_cash_base_currency_status")
    )
    current_cash_brokers = summary.get("authoritative_current_cash_brokers")
    has_current_cash_scope = isinstance(current_cash_brokers, list) and "hsbc" in {
        _ii_basics._normalize_broker_code(value) for value in current_cash_brokers
    }
    if (
        not cash_post_date
        and current_cash_status
        not in {
            "authoritative_current_cash_boundary",
            "authoritative_effective_boundary",
        }
        and not has_current_cash_scope
    ):
        return False

    current_cash = _ii_hsbc_cash._parse_decimal_text_or_none(
        hsbc_summary.get("cash_ledger_balance") or summary.get("cash_ledger_balance")
    )
    current_cash_source = _normalize_text(
        hsbc_summary.get("cash_ledger_balance_source")
        or summary.get("cash_ledger_balance_source")
    )
    if current_cash is not None:
        cash_post_date = _normalize_text(
            hsbc_summary.get("cash_ledger_balance_as_of")
            or summary.get("cash_ledger_balance_as_of")
            or cash_post_date
        )[:10]
    if current_cash is None:
        inferred_boundary = _ii_payload_summaries._infer_hsbc_settled_usd_cash_boundary(
            _ii_merge_reconciliation._payload_transactions(payload),
            account=_normalize_text(
                hsbc_summary.get("account") or summary.get("account")
            ),
            expected_as_of=cash_post_date,
        )
        if inferred_boundary is not None:
            current_cash, cash_post_date = inferred_boundary
            current_cash_source = "hsbc_settlement_posting_balance_reconstruction"
    if current_cash is None:
        declared_boundary = (
            _ii_payload_summaries._resolve_hsbc_declared_current_cash_boundary(
                hsbc_summary,
                summary,
                has_current_cash_scope=has_current_cash_scope,
            )
        )
        if declared_boundary is not None:
            declared_cash, declared_as_of, declared_source = declared_boundary
            current_cash = declared_cash
            cash_post_date = declared_as_of or cash_post_date
            current_cash_source = declared_source
    if current_cash is None:
        return False
    current_cash_text = _decimal_to_str(current_cash) or "0"
    current_cash_source = current_cash_source or "hsbc_usd_savings_ledger_balance"
    available_cash = _ii_hsbc_cash._parse_decimal_text_or_none(
        hsbc_summary.get("hsbc_bank_available_cash")
        or summary.get("hsbc_bank_available_cash")
    )
    if available_cash is None:
        available_cash = current_cash

    components = _ii_payload_summaries._payload_hsbc_ending_cash_components(payload)
    component_dates = _ii_payload_summaries._payload_hsbc_cash_component_post_dates(
        payload
    )
    for component_key in list(components):
        currency, _, account_type = component_key.partition(":")
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(currency) == "USD"
            and _normalize_whitespace(account_type).upper() == "LEGACY"
        ):
            components.pop(component_key, None)
            component_dates.pop(component_key, None)
    components["USD:SAVINGS"] = current_cash
    if cash_post_date:
        component_dates["USD:SAVINGS"] = cash_post_date
    serialized_components = _ii_hsbc_core._serialize_hsbc_cash_balance_components(
        components
    )
    serialized_dates = _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
        component_dates
    )
    ending_by_currency = {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in _ii_hsbc_core._sum_hsbc_cash_balance_components(
            components
        ).items()
    }
    pending_summary = _ii_hsbc_cash._summarize_hsbc_pending_settlement_cash(
        _ii_merge_reconciliation._payload_transactions(payload),
        available_cash,
        broker_cash_balance=current_cash,
    )
    cash_snapshot_updates = {
        "cash_snapshot_authoritative": True,
        "cash_snapshot_status": "current",
    }
    summary_updates = {
        "hsbc_ending_cash_components": serialized_components,
        "hsbc_cash_component_post_dates": serialized_dates,
        "cash_ledger_balance": current_cash_text,
        "cash_ledger_balance_as_of": cash_post_date,
        "cash_ledger_balance_source": current_cash_source,
        **cash_snapshot_updates,
        **pending_summary,
    }
    if _ii_basics._normalize_broker_code(payload.get("broker")) == "hsbc":
        summary_updates.update(
            {
                "ending_cash_base_currency": current_cash_text,
                "ending_cash_base_currency_as_of": cash_post_date,
                "ending_cash_base_currency_source": current_cash_source,
                "ending_cash_by_currency": ending_by_currency,
            }
        )
    summary.update(summary_updates)
    if isinstance(broker_summaries, dict) and isinstance(hsbc_summary, dict):
        hsbc_summary.update(
            {
                "ending_cash": current_cash_text,
                "ending_cash_raw": current_cash_text,
                "ending_cash_base_currency": current_cash_text,
                "ending_cash_base_currency_as_of": cash_post_date,
                "ending_cash_base_currency_source": current_cash_source,
                "ending_cash_by_currency": ending_by_currency,
                "hsbc_ending_cash_components": serialized_components,
                "hsbc_cash_component_post_dates": serialized_dates,
                "cash_ledger_balance": current_cash_text,
                "cash_ledger_balance_as_of": cash_post_date,
                "cash_ledger_balance_source": current_cash_source,
                **cash_snapshot_updates,
                **pending_summary,
            }
        )
        hsbc_summary["ending_cash_base_currency_status"] = (
            "authoritative_current_cash_boundary"
        )
    if _ii_basics._normalize_broker_code(payload.get("broker")) == "hsbc":
        payload["ending_cash"] = current_cash_text
        payload["ending_cash_base_currency"] = current_cash_text
        payload["ending_cash_by_currency"] = ending_by_currency
    return True


def _preserve_authoritative_current_cash_scope(
    payload: dict[str, Any],
    *source_payloads: dict[str, Any],
) -> None:
    """Carry a verified cross-broker current-cash scope through a merge."""
    candidates: list[tuple[str, int, dict[str, Any], dict[str, Any]]] = []
    for source_index, source_payload in enumerate(source_payloads):
        source_summary = (
            source_payload.get("summary")
            if isinstance(source_payload.get("summary"), dict)
            else {}
        )
        raw_brokers = source_summary.get("authoritative_current_cash_brokers")
        if not isinstance(raw_brokers, list):
            continue
        brokers = [
            _ii_basics._normalize_broker_code(value)
            for value in raw_brokers
            if _ii_basics._normalize_broker_code(value)
        ]
        if not brokers:
            continue
        confirmed_on = _normalize_text(
            source_summary.get("authoritative_current_cash_scope_confirmed_on")
        )
        candidates.append((confirmed_on, source_index, source_payload, source_summary))
    if not candidates:
        return

    _confirmed_on, _source_index, source_payload, source_summary = max(candidates)
    target_summary = payload.get("summary")
    if not isinstance(target_summary, dict):
        target_summary = {}
        payload["summary"] = target_summary
    for field_name in (
        "authoritative_current_cash_brokers",
        "authoritative_current_cash_scope_confirmed_on",
        "authoritative_current_cash_scope_source",
    ):
        if field_name in source_summary:
            target_summary[field_name] = deepcopy(source_summary[field_name])

    # Keep the exact HSBC effective-cash field available to the final boundary
    # synchronizer even when transaction-derived component inference ran first.
    if "hsbc" not in {
        _ii_basics._normalize_broker_code(value)
        for value in target_summary.get("authoritative_current_cash_brokers", [])
    }:
        return
    source_broker_summaries = source_payload.get("broker_summaries")
    if not isinstance(source_broker_summaries, dict):
        return
    source_hsbc_summary = source_broker_summaries.get("hsbc")
    if not isinstance(source_hsbc_summary, dict):
        return
    target_broker_summaries = payload.get("broker_summaries")
    if not isinstance(target_broker_summaries, dict):
        target_broker_summaries = {}
        payload["broker_summaries"] = target_broker_summaries
    target_hsbc_summary = target_broker_summaries.get("hsbc")
    if not isinstance(target_hsbc_summary, dict):
        target_hsbc_summary = {}
        target_broker_summaries["hsbc"] = target_hsbc_summary
    source_cash_as_of = _normalize_text(
        source_hsbc_summary.get("ending_cash_base_currency_as_of")
        or source_hsbc_summary.get("cash_snapshot_as_of")
    )[:10]
    target_cash_as_of = _normalize_text(
        target_hsbc_summary.get("ending_cash_base_currency_as_of")
        or target_hsbc_summary.get("cash_snapshot_as_of")
    )[:10]
    target_components = _ii_payload_summaries._normalize_hsbc_ending_cash_components(
        target_hsbc_summary.get("hsbc_ending_cash_components")
    )
    target_usd_component = target_components.get("USD:SAVINGS")
    if (
        source_cash_as_of
        and target_cash_as_of
        and source_cash_as_of == target_cash_as_of
        and target_usd_component is not None
    ):
        # The merged component map is the more precise current-cash evidence
        # when an incoming capture shares the scope attestation's date.
        target_hsbc_summary["ending_cash_base_currency"] = (
            _decimal_to_str(target_usd_component) or "0"
        )
    for field_name in (
        "ending_cash_base_currency",
        "ending_cash_base_currency_as_of",
        "ending_cash_base_currency_source",
        "ending_cash_base_currency_status",
    ):
        should_copy = (
            field_name in source_hsbc_summary and field_name not in target_hsbc_summary
        )
        if (
            field_name in source_hsbc_summary
            and field_name in target_hsbc_summary
            and source_cash_as_of
            and target_cash_as_of
        ):
            # An equally dated incoming HSBC cash capture is newer evidence
            # than the scope attestation that selected the older snapshot.
            # Keep the incoming value instead of rolling it back silently.
            should_copy = target_cash_as_of < source_cash_as_of
        if should_copy:
            target_hsbc_summary[field_name] = deepcopy(source_hsbc_summary[field_name])


def repair_hsbc_order_settlement_reconciliation(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """Repair stored HSBC order settlement balances using retained evidence."""
    normalized_payload = _ii_bindings.normalize_investment_payload_tickers(payload)
    transactions = _ii_merge_reconciliation._payload_transactions(normalized_payload)
    source_artifacts = _ii_artifacts._normalize_source_artifacts(
        normalized_payload.get("source_artifacts")
    )
    updated_count = _reconcile_hsbc_orders_with_authoritative_cash_evidence(
        transactions,
        source_artifacts,
    )
    updated_count += _reconcile_hsbc_order_settlement_balances_from_postings(
        transactions
    )
    _ii_records._sort_transactions(transactions)
    _ii_payload_summaries._attach_broker_summaries(normalized_payload)
    _synchronize_hsbc_authoritative_current_cash_boundary(normalized_payload)
    _ii_bindings.refresh_investment_security_transfer_reconciliation(normalized_payload)
    summary = normalized_payload.get("summary")
    if isinstance(summary, dict):
        summary["json_size_bytes"] = len(
            json.dumps(
                normalized_payload, ensure_ascii=False, separators=(",", ":")
            ).encode()
        )
    return normalized_payload, updated_count


def validate_hsbc_pasted_text(
    *,
    portfolio_text: str,
    order_status_text: str,
    cash_account_text: str,
    dividend_action_loader: Callable[[set[str]], dict[str, list[dict[str, str]]]]
    | None = None,
) -> dict[str, Any]:
    """Validate one HSBC paste capture without persisting ledger or evidence data."""
    portfolio_text = str(portfolio_text or "").strip()
    order_status_text = str(order_status_text or "").strip()
    cash_account_text = str(cash_account_text or "").strip()
    field_status = {
        "cash": False,
        "portfolio": False,
        "order_status": False,
    }
    account_numbers: set[str] = set()
    cash_capture: dict[str, Any] | None = None

    if cash_account_text:
        cash_capture = _ii_hsbc_core._build_hsbc_cash_account_capture_from_text(
            cash_account_text,
            warnings=[],
        )
        field_status["cash"] = True
        account_numbers.add(_normalize_text(cash_capture.get("account_number")))
    if portfolio_text:
        portfolio_account_number, _ = _ii_hsbc_core._parse_hsbc_portfolio_plain_text(
            portfolio_text
        )
        field_status["portfolio"] = True
        account_numbers.add(portfolio_account_number)
    if order_status_text:
        order_account_number, _ = _ii_hsbc_core._parse_hsbc_order_status_plain_text(
            order_status_text
        )
        field_status["order_status"] = True
        account_numbers.add(order_account_number)

    account_numbers.discard("")
    if len(account_numbers) > 1:
        raise ValueError(
            "The pasted HSBC cash-account, Portfolio, and Order Status text belong to different accounts."
        )
    if cash_capture is None:
        return {
            "ready": False,
            "mode": "awaiting_cash",
            "field_status": field_status,
            "cash_currencies": [],
            "required_fields": ["cash"],
        }

    available_by_currency = cash_capture.get("available_by_currency")
    if not isinstance(available_by_currency, dict):
        raise ValueError(
            "No supported HSBC cash-account balances were parsed from the pasted text."
        )
    cash_currencies = sorted(
        currency
        for currency in available_by_currency
        if currency in {"USD", "HKD", "CNH"}
    )
    if "USD" in cash_currencies:
        if not portfolio_text and not order_status_text:
            payload = build_investment_payload_from_hsbc_pasted_text(
                portfolio_text="",
                order_status_text="",
                cash_account_text=cash_account_text,
                dividend_action_loader=dividend_action_loader,
            )
            return {
                "ready": True,
                "mode": "cash_only_usd",
                "field_status": field_status,
                "cash_currencies": cash_currencies,
                "transaction_count": len(payload.get("transactions", [])),
                "message": (
                    "Validated the HSBC USD cash-only settlement refresh. "
                    "Existing Portfolio holdings will be preserved during merge."
                ),
            }
        required_fields = [
            field_name
            for field_name, raw_text in (
                ("portfolio", portfolio_text),
                ("order_status", order_status_text),
            )
            if not raw_text
        ]
        if required_fields:
            return {
                "ready": False,
                "mode": "usd_composite",
                "field_status": field_status,
                "cash_currencies": cash_currencies,
                "required_fields": required_fields,
            }
        payload = build_investment_payload_from_hsbc_pasted_text(
            portfolio_text=portfolio_text,
            order_status_text=order_status_text,
            cash_account_text=cash_account_text,
            dividend_action_loader=dividend_action_loader,
        )
        return {
            "ready": True,
            "mode": "usd_composite",
            "field_status": field_status,
            "cash_currencies": cash_currencies,
            "transaction_count": len(payload.get("transactions", [])),
            "message": "Validated the HSBC USD cash, Portfolio, and Order Status snapshot.",
        }

    if portfolio_text or order_status_text:
        raise ValueError(
            "HKD/CNH cash-only HSBC sync requires Portfolio and Order Status to be empty. "
            "Use HSBC statements for non-USD investment activity."
        )
    payload = build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="",
        order_status_text="",
        cash_account_text=cash_account_text,
        dividend_action_loader=dividend_action_loader,
    )
    return {
        "ready": True,
        "mode": "cash_only_non_usd",
        "field_status": field_status,
        "cash_currencies": cash_currencies,
        "transaction_count": len(payload.get("transactions", [])),
        "message": "Validated the HSBC HKD/CNH cash-account snapshot.",
    }
