"""Investment import domain: hsbc reconciliation.

Code version: v0.5.2
- Changed: Posting-balance repair and authoritative current-cash boundary
  synchronization moved to investment_import_hsbc_cash_boundary to keep this
  module within the first-party code size contract.
- Fixed: Official USD Savings CSV evidence now requires its immutable HSBC,
  transaction-history, and account metadata before settlement reconciliation.
- Added: Verified, storage-backed HSBC cash-account paste artifacts can repair
  legacy settlement provenance during any later HSBC merge.
- Fixed: HSBC stock-order settlement evidence is limited to USD Savings, while
  real bank chronology may place a fee before or after its principal.
- Fixed: Authoritative order repair validates a complete principal/fee pair on
  a copy before committing, and records the actual CSV or pasted-text source.
- Fixed: Official USD CSV evidence rejects malformed byte counts, non-finite
  rows, and same-day orders that balance continuity cannot disambiguate.
- Fixed: Official USD CSV settlement rows cannot be reused across HSBC
  accounts or attached to more than one order reference owner.
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

from app.services.investment_import_hsbc_cash_boundary import (
    _reconcile_hsbc_order_settlement_balances_from_postings,
    _synchronize_hsbc_authoritative_current_cash_boundary,
)


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
            normalized_snapshot = _ii_artifacts._normalize_snapshot_keys(
                raw_snapshot.get("position_snapshot")
            )
            position_snapshots_by_account[account_identity] = {
                ticker: position
                for ticker, position in normalized_snapshot.items()
                if isinstance(position, dict)
                and _normalize_text(position.get("currency")).upper() == "USD"
            }

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
                and _normalize_text(record.get("currency")).upper() == "USD"
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
    cash_visible_post_dates: list[str],
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
        _normalize_text(value)
        for value in cash_visible_post_dates
        if _normalize_text(value)
    ]
    earliest_cash_post_date = min(cash_post_dates, default="")
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
        "cash_earliest_post_date": earliest_cash_post_date,
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
        _normalize_text(value)
        for value in cash_capture.get("visible_post_dates", [])
        if _normalize_text(value)
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
    earliest_cash_post_date = min(cash_post_dates, default="")
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
        "cash_earliest_post_date": earliest_cash_post_date,
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
        cash_visible_post_dates=cash_capture.get("visible_post_dates", []),
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
            if (
                amount is None
                or balance is None
                or not amount.is_finite()
                or not balance.is_finite()
                or amount == ZERO
            ):
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

    def has_balance_continuity(rows: list[dict[str, Any]]) -> bool:
        return all(
            newer["balance"] == older["balance"] + newer["amount"]
            for newer, older in zip(rows, rows[1:])
        )

    if is_descending and is_ascending and len(parsed_rows) > 1:
        input_is_descending = has_balance_continuity(parsed_rows)
        reversed_rows = list(reversed(parsed_rows))
        input_is_ascending = has_balance_continuity(reversed_rows)
        if input_is_descending == input_is_ascending:
            raise ValueError(
                "The HSBC USD Savings CSV same-day row order is ambiguous."
            )
        rows_descending = parsed_rows if input_is_descending else reversed_rows
    else:
        rows_descending = parsed_rows if is_descending else list(reversed(parsed_rows))
    if not has_balance_continuity(rows_descending):
        raise ValueError(
            "HSBC USD Savings CSV balance continuity failed between rows "
            f"{rows_descending[0]['row_number']} and "
            f"{rows_descending[1]['row_number']}."
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
    sequence_domain_sha256 = hashlib.sha256(csv_bytes).hexdigest()
    parsed_rows = rows_descending

    account = HSBC_EXPECTED_ACCOUNT_NUMBER
    latest_row = rows_descending[0]
    earliest_row = rows_descending[-1]
    starting_balance = earliest_row["balance"] - earliest_row["amount"]
    warnings: list[str] = []
    all_records: list[dict[str, Any]] = []
    for ledger_sequence, row in enumerate(reversed(rows_descending), start=1):
        amount = row["amount"]
        mapped_type = _ii_hsbc_core._classify_hsbc_cash_account_transaction(
            row["description"],
            amount,
        )
        source: dict[str, Any] = {
            "file_kind": "hsbc_usd_savings_csv",
            "row_number": row["row_number"],
            "ledger_sequence": ledger_sequence,
            "ledger_sequence_order": "chronological",
            "account_number": account,
            "account_type": "USD Savings",
            "balance_after_raw": _decimal_to_str(row["balance"]),
            "reference_id": _normalize_whitespace(row["description"]),
            "cash_balance_scope": "account",
            "cash_balance_authoritative": True,
            "source_sequence_sha256": sequence_domain_sha256,
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
        if not isinstance(artifact, dict):
            continue
        if (
            _ii_basics._normalize_broker_code(artifact.get("broker")) != "hsbc"
            or _normalize_text(artifact.get("bundle_role")).lower()
            != "transaction_history"
            or not _normalize_text(artifact.get("account"))
            or _normalize_text(artifact.get("source_kind"))
            != "hsbc_usd_savings_transaction_history_csv"
        ):
            continue
        digest = _normalize_text(artifact.get("sha256")).lower()
        if (
            digest in seen_digests
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
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
            if evidence_path.is_symlink():
                continue
            try:
                csv_bytes = evidence_path.read_bytes()
            except OSError:
                continue
        raw_byte_count = artifact.get("byte_count")
        if isinstance(raw_byte_count, bool):
            continue
        if isinstance(raw_byte_count, int):
            byte_count = raw_byte_count
        elif isinstance(raw_byte_count, str):
            byte_count_text = raw_byte_count.strip()
            if not byte_count_text or any(
                character not in "0123456789" for character in byte_count_text
            ):
                continue
            byte_count = int(byte_count_text)
        else:
            continue
        if byte_count <= 0:
            continue
        if (
            len(csv_bytes) != byte_count
            or hashlib.sha256(csv_bytes).hexdigest() != digest
        ):
            continue
        try:
            rows_descending = _parse_hsbc_usd_savings_csv_rows(csv_bytes)
        except ValueError:
            continue
        artifact_account = _normalize_text(artifact.get("account")).upper()
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
                    "ledger_sequence_order": "chronological",
                    "source_file_kind": "hsbc_usd_savings_csv",
                    "source_file_sha256": digest,
                    "source_sequence_sha256": digest,
                    # Preserve the account identity captured with this immutable
                    # artifact.  The current configured account may change after
                    # the CSV was imported and must not relabel historical cash.
                    "account_number": artifact_account,
                    "account_type": "USD Savings",
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


def _hsbc_persisted_pasted_cash_settlement_evidence(
    source_artifacts: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Rebuild settlement rows from verified, storage-backed paste evidence."""
    candidates_by_reference: dict[str, list[dict[str, Any]]] = {}
    seen_digests: set[str] = set()
    for artifact in source_artifacts:
        if not isinstance(artifact, dict):
            continue
        if (
            _ii_basics._normalize_broker_code(artifact.get("broker")) != "hsbc"
            or _normalize_text(artifact.get("source_kind"))
            != "hsbc_cash_account_pasted_text"
            or _normalize_text(artifact.get("bundle_role")).lower()
            != "cash_account"
        ):
            continue
        digest = _normalize_text(artifact.get("sha256")).lower()
        storage_key = _normalize_text(artifact.get("storage_key")).lower()
        artifact_account = _normalize_text(artifact.get("account")).upper()
        if (
            not artifact_account
            or digest in seen_digests
            or storage_key != digest
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            continue
        raw_byte_count = artifact.get("byte_count")
        if isinstance(raw_byte_count, bool):
            continue
        if isinstance(raw_byte_count, int):
            byte_count = raw_byte_count
        elif isinstance(raw_byte_count, str):
            byte_count_text = raw_byte_count.strip()
            if not byte_count_text or any(
                character not in "0123456789" for character in byte_count_text
            ):
                continue
            byte_count = int(byte_count_text)
        else:
            continue
        if byte_count <= 0:
            continue
        evidence_path = investment_evidence_dir_for() / f"{storage_key}.bin"
        if evidence_path.is_symlink():
            continue
        try:
            source_bytes = evidence_path.read_bytes()
        except OSError:
            continue
        if (
            len(source_bytes) != byte_count
            or hashlib.sha256(source_bytes).hexdigest() != digest
        ):
            continue
        try:
            raw_text = source_bytes.decode("utf-8")
            capture = _ii_hsbc_core._build_hsbc_cash_account_capture_from_text(
                raw_text,
                warnings=[],
            )
        except (UnicodeDecodeError, ValueError):
            continue
        capture_account = _normalize_text(capture.get("account_number")).upper()
        if capture_account != artifact_account:
            continue
        seen_digests.add(digest)
        records = capture.get("records")
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            source = record.get("source")
            if not isinstance(source, dict):
                continue
            record_account = _normalize_text(
                source.get("account_number") or record.get("account")
            ).upper()
            currency = _ii_merge_identity._normalize_hsbc_currency_code(
                record.get("currency")
            )
            account_type = _ii_merge_identity._normalize_hsbc_cash_account_type(
                currency,
                source.get("account_type"),
            )
            source_file_kind = _normalize_text(source.get("file_kind")).lower()
            reference = _normalize_whitespace(record.get("description"))
            if (
                record_account != artifact_account
                or currency != "USD"
                or account_type != "SAVINGS"
                or source_file_kind
                not in {
                    "hsbc_usd_account_text",
                    "hsbc_multi_currency_cash_account_text",
                }
                or _normalize_whitespace(source.get("reference_id")) != reference
            ):
                continue
            order_reference = (
                _ii_hsbc_cash._extract_hsbc_order_reference_from_cash_description(
                    reference
                )
            )
            row_number = _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                source.get("row_number")
            )
            ledger_sequence = _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                source.get("ledger_sequence")
            )
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                record.get("net_amount_raw")
            )
            balance_after = _ii_hsbc_cash._parse_decimal_text_or_none(
                source.get("balance_after_raw")
            )
            if (
                not order_reference
                or row_number is None
                or ledger_sequence != row_number
                or amount is None
                or not amount.is_finite()
                or amount == ZERO
                or balance_after is None
                or not balance_after.is_finite()
            ):
                continue
            candidate = _ii_hsbc_cash._build_hsbc_cash_settlement_posting(
                record,
                role="principal",
            )
            if candidate is None:
                continue
            candidate.pop("role", None)
            candidate["source_sequence_sha256"] = digest
            candidate["source_file_sha256"] = digest
            candidates_by_reference.setdefault(order_reference, []).append(candidate)

    selected: dict[str, list[dict[str, Any]]] = {}
    for order_reference, candidates in candidates_by_reference.items():
        semantic_values: dict[tuple[Any, ...], set[tuple[Any, ...]]] = {}
        physical_values: dict[tuple[str, int], set[tuple[Any, ...]]] = {}
        for candidate in candidates:
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                candidate.get("amount_raw")
            )
            balance = _ii_hsbc_cash._parse_decimal_text_or_none(
                candidate.get("balance_after_raw")
            )
            semantic_key = (
                _normalize_text(candidate.get("account_number")).upper(),
                _normalize_text(candidate.get("date")),
                amount,
                _normalize_whitespace(candidate.get("reference")).upper(),
                _ii_merge_identity._normalize_hsbc_currency_code(
                    candidate.get("currency")
                ),
            )
            semantic_values.setdefault(semantic_key, set()).add(
                (
                    balance,
                    _ii_merge_identity._normalize_hsbc_cash_account_type(
                        candidate.get("currency"),
                        candidate.get("account_type"),
                    ),
                    _normalize_text(candidate.get("source_file_kind")).lower(),
                )
            )
            physical_key = (
                _normalize_text(candidate.get("source_sequence_sha256")).lower(),
                int(candidate.get("row_number", 0) or 0),
            )
            physical_values.setdefault(physical_key, set()).add(
                (
                    semantic_key,
                    balance,
                    int(candidate.get("ledger_sequence", 0) or 0),
                )
            )
        conflicting_semantics = {
            key for key, values in semantic_values.items() if len(values) != 1
        }
        conflicting_physical_rows = {
            key for key, values in physical_values.items() if len(values) != 1
        }
        accepted = [
            candidate
            for candidate in candidates
            if (
                (
                    _normalize_text(candidate.get("account_number")).upper(),
                    _normalize_text(candidate.get("date")),
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    ),
                    _normalize_whitespace(candidate.get("reference")).upper(),
                    _ii_merge_identity._normalize_hsbc_currency_code(
                        candidate.get("currency")
                    ),
                )
                not in conflicting_semantics
                and (
                    _normalize_text(
                        candidate.get("source_sequence_sha256")
                    ).lower(),
                    int(candidate.get("row_number", 0) or 0),
                )
                not in conflicting_physical_rows
            )
        ]
        if accepted:
            selected[order_reference] = sorted(
                accepted,
                key=_ii_hsbc_cash._hsbc_settlement_posting_sort_key,
            )
    return selected


def _reconcile_hsbc_orders_with_authoritative_cash_evidence(
    transactions: list[dict[str, Any]],
    source_artifacts: list[dict[str, Any]],
) -> int:
    """Use verified cash rows to repair matched order settlement metadata."""
    evidence_by_reference = _hsbc_usd_savings_csv_settlement_evidence(source_artifacts)
    for order_reference, pasted_candidates in (
        _hsbc_persisted_pasted_cash_settlement_evidence(source_artifacts).items()
    ):
        evidence_by_reference.setdefault(order_reference, pasted_candidates)
    used_evidence_ids: set[int] = set()
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
        order_account = _normalize_text(
            order_record.get("account")
            or order_source.get("account")
            or order_source.get("account_number")
        ).upper()
        order_currency = _ii_merge_identity._normalize_hsbc_currency_code(
            order_record.get("currency")
        )
        order_date = _normalize_text(order_record.get("date"))
        if not order_account or order_currency != "USD" or not order_date:
            continue

        def candidate_matches_order(candidate: dict[str, Any]) -> bool:
            if id(candidate) in used_evidence_ids:
                return False
            evidence_account = _normalize_text(candidate.get("account_number")).upper()
            evidence_account_type = (
                _ii_merge_identity._normalize_hsbc_cash_account_type(
                    candidate.get("currency"),
                    candidate.get("account_type"),
                )
            )
            if evidence_account != order_account:
                return False
            return (
                _ii_merge_identity._normalize_hsbc_currency_code(
                    candidate.get("currency")
                )
                == "USD"
                and evidence_account_type == "SAVINGS"
                and _normalize_text(candidate.get("date")) >= order_date
            )

        candidates = [
            candidate
            for candidate in evidence_by_reference.get(order_reference, [])
            if candidate_matches_order(candidate)
        ]
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
        candidate_diffs = {
            id(candidate): abs(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                    or ZERO
                )
                - (expected_amount or ZERO)
            )
            for candidate in principal_candidates
        }
        best_diff = min(candidate_diffs.values())
        best_principal_candidates = [
            candidate
            for candidate in principal_candidates
            if candidate_diffs[id(candidate)] == best_diff
        ]

        def principal_semantic_signature(
            candidate: dict[str, Any],
        ) -> tuple[str, str, str, str, str, str, str]:
            return (
                _normalize_text(candidate.get("date")),
                _decimal_to_str(
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("amount_raw")
                    )
                )
                or "",
                _decimal_to_str(
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        candidate.get("balance_after_raw")
                    )
                )
                or "",
                _normalize_whitespace(candidate.get("reference")).upper(),
                _normalize_text(candidate.get("account_number")).upper(),
                _normalize_whitespace(candidate.get("account_type")).upper(),
                _ii_merge_identity._normalize_hsbc_currency_code(
                    candidate.get("currency")
                ),
            )

        if (
            len(
                {
                    principal_semantic_signature(candidate)
                    for candidate in best_principal_candidates
                }
            )
            != 1
        ):
            continue
        principal = min(
            best_principal_candidates,
            key=lambda candidate: (
                _normalize_text(
                    candidate.get("source_sequence_sha256")
                    or candidate.get("source_file_sha256")
                ).lower(),
                int(candidate.get("row_number", 0) or 0),
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
        principal_identity = (
            _normalize_text(principal.get("account_number")).upper(),
            _normalize_whitespace(principal.get("account_type")).upper(),
            _ii_merge_identity._normalize_hsbc_currency_code(principal.get("currency")),
            _normalize_text(principal.get("date")),
            _normalize_text(principal.get("source_file_kind")).lower(),
            _normalize_text(
                principal.get("source_sequence_sha256")
                or principal.get("source_file_sha256")
            ).lower(),
        )
        if not all(principal_identity[1:]):
            continue
        try:
            principal_sequence = int(principal.get("ledger_sequence", 0) or 0)
        except (TypeError, ValueError):
            continue
        if principal_sequence <= 0:
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
            and (
                _normalize_text(candidate.get("account_number")).upper(),
                _normalize_whitespace(candidate.get("account_type")).upper(),
                _ii_merge_identity._normalize_hsbc_currency_code(
                    candidate.get("currency")
                ),
                _normalize_text(candidate.get("date")),
                _normalize_text(candidate.get("source_file_kind")).lower(),
                _normalize_text(
                    candidate.get("source_sequence_sha256")
                    or candidate.get("source_file_sha256")
                ).lower(),
            )
            == principal_identity
            and int(candidate.get("ledger_sequence", 0) or 0) != principal_sequence
        ]
        fee_sequences = [
            int(candidate.get("ledger_sequence", 0) or 0)
            for candidate in fee_candidates
        ]
        if (
            len(set(fee_sequences)) != len(fee_sequences)
            or (expected_sign > 0 and len(fee_candidates) != 1)
        ):
            continue
        fee_total = sum(
            abs(
                _ii_hsbc_cash._parse_decimal_text_or_none(
                    candidate.get("amount_raw")
                )
                or ZERO
            )
            for candidate in fee_candidates
        )
        if expected_sign > 0:
            normalized_order = (
                order_record.get("normalized")
                if isinstance(order_record.get("normalized"), dict)
                else {}
            )
            declared_fee_amounts = [
                abs(parsed_fee)
                for raw_fee in (
                    order_source.get("cash_flow_fee_amount_raw"),
                    order_record.get("commission_raw"),
                    normalized_order.get("commission"),
                )
                if (
                    (parsed_fee := _ii_hsbc_cash._parse_decimal_text_or_none(raw_fee))
                    is not None
                    and parsed_fee != ZERO
                )
            ]
            if any(declared_fee != fee_total for declared_fee in declared_fee_amounts):
                continue
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
        next_order_record = deepcopy(order_record)
        next_order_source = deepcopy(order_source)
        next_order_source["cash_settlement_postings"] = postings
        next_order_source["cash_settlement_amount_raw"] = (
            _decimal_to_str(principal_amount) or "0"
        )
        next_order_source["cash_settlement_date"] = _normalize_text(
            principal.get("date")
        )
        next_order_source["cash_settlement_reference"] = _normalize_whitespace(
            principal.get("reference")
        )
        principal_source_kind = _normalize_text(
            principal.get("source_file_kind")
        ).lower()
        next_order_source["cash_settlement_authoritative_source"] = (
            "hsbc_usd_savings_transaction_history_csv"
            if principal_source_kind == "hsbc_usd_savings_csv"
            else "hsbc_cash_account_pasted_text"
        )
        next_order_source["cash_settlement_source_file_sha256"] = _normalize_text(
            principal.get("source_file_sha256")
        )
        if fee_candidates:
            next_order_source["cash_flow_fee_amount_raw"] = (
                _decimal_to_str(fee_total) or "0"
            )
            next_order_source["cash_flow_fee_row_numbers"] = [
                int(candidate.get("row_number", 0) or 0) for candidate in fee_candidates
            ]
            commission_text = _decimal_to_str(-fee_total) or "0"
            next_order_record["commission_raw"] = commission_text
            normalized = (
                next_order_record.get("normalized")
                if isinstance(next_order_record.get("normalized"), dict)
                else {}
            )
            normalized["commission"] = commission_text
            normalized["commission_display"] = _decimal_to_str(fee_total) or "0"
            next_order_record["normalized"] = normalized
        next_order_record["net_amount_raw"] = _decimal_to_str(principal_amount) or "0"
        normalized = (
            next_order_record.get("normalized")
            if isinstance(next_order_record.get("normalized"), dict)
            else {}
        )
        normalized["net_amount"] = next_order_record["net_amount_raw"]
        normalized["accounting_adjustment_amount"] = next_order_record[
            "net_amount_raw"
        ]
        next_order_record["normalized"] = normalized
        next_order_record["source"] = next_order_source
        if not _ii_hsbc_cash._hsbc_settlement_postings_have_valid_sequence_order(
            postings,
            order_source=next_order_source,
            order_record=next_order_record,
            order_account=order_account,
            order_currency=order_currency,
        ):
            continue
        _ii_hsbc_cash._finalize_hsbc_order_settlement_balance(
            next_order_source,
            order_record=next_order_record,
        )
        used_evidence_ids.update(
            id(posting) for posting in [principal, *fee_candidates]
        )
        order_record.clear()
        order_record.update(next_order_record)
        next_signature = (
            _normalize_text(
                next_order_source.get("cash_settlement_balance_after_raw")
            ),
            json.dumps(
                next_order_source.get("cash_settlement_postings", []),
                ensure_ascii=False,
                sort_keys=True,
            ),
            _normalize_text(
                next_order_source.get("cash_settlement_source_file_sha256")
            ),
        )
        if previous_signature != next_signature:
            updated_count += 1
    return updated_count


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
