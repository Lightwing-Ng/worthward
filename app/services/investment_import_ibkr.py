"""Investment import domain: ibkr.

Code version: v0.2.0
- Added: IBKR CSV statement pairs retain a dated Interest Accruals NAV
  snapshot separately from cash and market value.
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    DEFAULT_CONVENTION_TIME,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    ET,
    GKX_SUPPORTED_INVTRANLIST_TAGS,
    IBKR_GAINSKEEPER_CASH_SNAPSHOT_SOURCE,
    IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE,
    IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE,
    IBKR_WEB_CAPTURE_ROLE,
    IBKR_WEB_CAPTURE_SCOPE,
    IBKR_WEB_COMPACT_TIME_PATTERN,
    IBKR_WEB_COMPACT_TRADE_PATTERN,
    IBKR_WEB_DISPLAY_TIMEZONE,
    IBKR_WEB_LEDGER_TIMEZONE,
    IBKR_WEB_SNAPSHOT_RELATIONSHIP,
    IBKR_WEB_TRADE_DATETIME_PATTERN,
    IBKR_WEB_TRADE_FEE_PATTERN,
    IBKR_WEB_TRADE_SUMMARY_PATTERN,
    ROUND_HALF_UP,
    SCHEMA_VERSION,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    base64,
    date,
    datetime,
    hashlib,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_ibkr_accruals as _ii_ibkr_accruals

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records


def _extract_ibkr_statement_field(rows: list[list[str]], field_name: str) -> str | None:
    normalized_field_name = _normalize_text(field_name)
    for row in rows:
        if (
            len(row) >= 4
            and row[0] == "Statement"
            and row[1] == "Data"
            and _normalize_text(row[2]) == normalized_field_name
        ):
            return _normalize_text(row[3]) or None
    return None


def _has_ibkr_section(rows: list[list[str]], section_name: str) -> bool:
    return any(len(row) >= 2 and row[0] == section_name for row in rows)


def _is_ibkr_transaction_history_export(rows: list[list[str]]) -> bool:
    has_transaction_history = any(
        len(row) >= 2 and row[0] == "Transaction History" and row[1] == "Data"
        for row in rows
    )
    has_summary_cash = any(
        len(row) >= 4
        and row[0] == "Summary"
        and row[1] == "Data"
        and row[2] in {"Starting Cash", "Ending Cash"}
        for row in rows
    )
    return has_transaction_history and has_summary_cash


def _is_ibkr_realized_summary_export(rows: list[list[str]]) -> bool:
    realized_summary_sections = (
        "Net Asset Value",
        "Change in NAV",
        "Trades",
        "Account Information",
        "Deposits & Withdrawals",
        "Forex P/L Details",
        "Realized & Unrealized Performance Summary",
        "Open Positions",
    )
    has_realized_summary_section = any(
        _has_ibkr_section(rows, section_name)
        for section_name in realized_summary_sections
    )
    if not has_realized_summary_section:
        return False

    title = _extract_ibkr_statement_field(rows, "Title")
    if title and title.lower() == "realized summary":
        return True

    has_performance_summary = any(
        len(row) >= 2
        and row[0] == "Realized & Unrealized Performance Summary"
        and row[1] == "Data"
        for row in rows
    )
    has_open_positions = any(
        len(row) >= 2 and row[0] == "Open Positions" and row[1] in {"Data", "Total"}
        for row in rows
    )
    return has_performance_summary and has_open_positions


def _extract_account_information(rows: list[list[str]]) -> str | None:
    for row in rows:
        if (
            len(row) >= 4
            and row[0] == "Account Information"
            and row[1] == "Data"
            and _normalize_text(row[2]) == "Account"
        ):
            return _normalize_text(row[3]) or None
    return None


def _ensure_expected_sections(
    transaction_rows: list[list[str]],
    positions_rows: list[list[str]],
) -> None:
    if not _is_ibkr_transaction_history_export(transaction_rows):
        raise ValueError(
            "The first CSV does not look like the IBKR Transaction History export."
        )
    if not _is_ibkr_realized_summary_export(positions_rows):
        raise ValueError(
            "The second CSV does not look like the IBKR Realized Summary statement export."
        )


def build_investment_payload_from_ibkr_csvs(
    transaction_csv_bytes: bytes,
    positions_csv_bytes: bytes,
    *,
    transaction_filename: str = "",
    positions_filename: str = "",
) -> dict[str, Any]:
    """Build the investment payload entirely in memory."""
    transaction_rows = _ii_basics._iter_csv_rows(transaction_csv_bytes)
    positions_rows = _ii_basics._iter_csv_rows(positions_csv_bytes)
    _ensure_expected_sections(transaction_rows, positions_rows)
    pair_metadata = _ii_basics._validate_ibkr_csv_pair_metadata(
        transaction_rows, positions_rows
    )

    warnings: list[str] = []
    unknown_types: set[str] = set()
    summary_fields, account = _ii_records._extract_summary_fields(
        transaction_rows, warnings
    )
    account_from_positions = _extract_account_information(positions_rows)
    if account_from_positions:
        account = account_from_positions
    transaction_sha256 = hashlib.sha256(transaction_csv_bytes).hexdigest()
    positions_sha256 = hashlib.sha256(positions_csv_bytes).hexdigest()
    bundle_id = hashlib.sha256(
        "|".join(sorted((transaction_sha256, positions_sha256))).encode("ascii")
    ).hexdigest()
    source_artifacts = [
        _ii_basics._build_ibkr_source_artifact(
            payload=transaction_csv_bytes,
            filename=transaction_filename,
            source_kind="ibkr_transaction_history_csv",
            account=account,
            statement_title=pair_metadata["transaction_title"],
            statement_period=pair_metadata["transaction_period"],
            statement_generated_at=pair_metadata["transaction_generated_at"],
            bundle_id=bundle_id,
            bundle_role="transaction_history",
            related_sha256=positions_sha256,
        ),
        _ii_basics._build_ibkr_source_artifact(
            payload=positions_csv_bytes,
            filename=positions_filename,
            source_kind="ibkr_realized_summary_csv",
            account=account,
            statement_title=pair_metadata["positions_title"],
            statement_period=pair_metadata["positions_period"],
            statement_generated_at=pair_metadata["positions_generated_at"],
            bundle_id=bundle_id,
            bundle_role="realized_summary",
            related_sha256=transaction_sha256,
        ),
    ]

    transactions = [
        record
        for row_number, row in enumerate(transaction_rows, start=1)
        for record in [
            _ii_records._build_transaction_record(
                row, row_number, warnings, unknown_types
            )
        ]
        if record is not None
    ]
    native_cash_records = [
        record
        for row_number, row in enumerate(positions_rows, start=1)
        for record in [
            _ii_records._build_ibkr_realized_summary_cash_record(
                row,
                row_number,
                warnings,
                account=account,
                source_filename=positions_filename,
                source_sha256=positions_sha256,
            )
        ]
        if record is not None
    ]
    (
        transactions,
        native_cash_replacement_count,
        native_cash_unmatched_count,
        native_cash_ambiguous_count,
    ) = _ii_records._replace_ibkr_transaction_history_cash_with_native_summary(
        transactions,
        native_cash_records,
    )
    if native_cash_ambiguous_count:
        warnings.append(
            "Some IBKR Realized Summary foreign-currency cash rows had ambiguous "
            "base-currency equivalents and were withheld from the ledger."
        )
    transactions.extend(
        record
        for row_number, row in enumerate(positions_rows, start=1)
        for record in [
            _ii_records._build_ibkr_transfer_record(row, row_number, warnings)
        ]
        if record is not None
    )
    grant_candidates = [
        record
        for row_number, row in enumerate(positions_rows, start=1)
        for record in [_ii_records._build_grant_candidate(row, row_number, warnings)]
        if record is not None
    ]

    open_position_snapshots = _ii_records._extract_open_position_summaries(
        positions_rows, warnings
    )
    performance_snapshots = _ii_records._extract_performance_summaries(
        positions_rows, warnings
    )
    interest_accrual_snapshot = (
        _ii_ibkr_accruals.extract_ibkr_interest_accrual_snapshot(
            positions_rows,
            warnings,
            as_of=pair_metadata["period_end"],
        )
    )
    closed_trade_details = _ii_records._extract_ibkr_closed_trade_details(
        positions_rows, warnings
    )
    forex_pnl_details = _ii_records._extract_ibkr_forex_pnl_details(
        positions_rows, warnings
    )
    _ii_records._attach_ibkr_closed_trade_details(transactions, closed_trade_details)
    _ii_records._attach_ibkr_forex_pnl_details(
        transactions, forex_pnl_details, warnings
    )
    _ii_records._prefer_ibkr_closed_trade_realized_totals(
        performance_snapshots,
        closed_trade_details,
        transactions=transactions,
    )
    grants = _ii_records._synthesize_grant_records(
        grant_candidates,
        transactions,
        open_position_snapshots,
        warnings,
    )
    transactions.extend(grants)
    transactions = _ii_records._reconcile_positions_grants_to_snapshot(
        transactions,
        open_position_snapshots,
        warnings,
    )
    _ii_records._sort_transactions(transactions)

    holdings_mismatches = _ii_records._validate_holdings(
        transactions, open_position_snapshots
    )
    cash_snapshot_dates = _ii_records._ibkr_cash_snapshot_dates(
        transactions,
        period_start=pair_metadata["period_start"],
        period_end=pair_metadata["period_end"],
    )
    summary = _ii_payload_summaries._build_summary(
        transactions=transactions,
        warnings=warnings,
        unknown_types=sorted(unknown_types),
        holdings_mismatches=holdings_mismatches,
        open_position_snapshots=open_position_snapshots,
        performance_snapshots=performance_snapshots,
        starting_cash=_decimal_to_str(summary_fields["starting_cash"]),
        ending_cash=_decimal_to_str(summary_fields["ending_cash"]),
    )
    if summary_fields["ending_cash"] is not None:
        summary["cash_snapshot_source"] = "ibkr_csv_summary"
        summary["cash_snapshot_authoritative"] = True
        summary.update(cash_snapshot_dates)

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "ibkr_csv_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
        },
        "broker": "ibkr",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Original trading date from CSV",
            "datetime_field_meaning": (
                "Business-convention datetime derived from date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": summary,
        "starting_cash": _decimal_to_str(summary_fields["starting_cash"]),
        "ending_cash": _decimal_to_str(summary_fields["ending_cash"]),
        "position_snapshot": open_position_snapshots,
        "performance_snapshot": performance_snapshots,
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "ibkr"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "ibkr"
            source["account"] = account
        transaction["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    payload["summary"]["position_snapshot_authoritative"] = bool(
        open_position_snapshots
    )
    if open_position_snapshots:
        payload["summary"]["position_snapshot_source"] = "ibkr_csv_open_positions"
    payload["summary"]["performance_snapshot_authoritative"] = bool(
        performance_snapshots
    )
    if performance_snapshots:
        payload["summary"]["performance_snapshot_source"] = "ibkr_csv_realized_summary"
    if interest_accrual_snapshot is not None:
        # Accrued interest is a separate NAV component, never cash.
        payload["interest_accrual_snapshot"] = interest_accrual_snapshot
        payload["summary"]["interest_accrual_snapshot_status"] = (
            interest_accrual_snapshot["status"]
        )
    payload["summary"]["ibkr_realized_summary_native_cash_record_count"] = len(
        native_cash_records
    )
    payload["summary"]["ibkr_realized_summary_native_cash_replacement_count"] = (
        native_cash_replacement_count
    )
    payload["summary"]["ibkr_realized_summary_native_cash_unmatched_count"] = (
        native_cash_unmatched_count
    )
    payload["summary"]["ibkr_realized_summary_native_cash_ambiguous_count"] = (
        native_cash_ambiguous_count
    )
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _parse_ibkr_web_trade_datetime(raw_value: str) -> datetime:
    try:
        displayed = datetime.strptime(
            _normalize_whitespace(raw_value),
            "%m/%d/%Y, %I:%M %p",
        ).replace(tzinfo=IBKR_WEB_DISPLAY_TIMEZONE)
    except ValueError as exc:
        raise ValueError(
            f"IBKR web trade notification has an invalid displayed time: {raw_value!r}."
        ) from exc
    return displayed.astimezone(IBKR_WEB_LEDGER_TIMEZONE)


def _parse_ibkr_web_trade_date(raw_value: str) -> date:
    normalized = _normalize_whitespace(raw_value)
    for format_string in (
        "%Y-%m-%d",
        "%d %b %Y",
        "%d %B %Y",
        "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(normalized, format_string).date()
        except ValueError:
            continue
    raise ValueError(
        "IBKR compact Trade Notifications require a page date such as 2026-08-13."
    )


def _parse_ibkr_web_compact_time(raw_value: str, trade_date: date) -> datetime:
    try:
        displayed = datetime.strptime(
            f"{trade_date.isoformat()}, {_normalize_whitespace(raw_value)}",
            "%Y-%m-%d, %I:%M %p",
        ).replace(tzinfo=IBKR_WEB_DISPLAY_TIMEZONE)
    except ValueError as exc:
        raise ValueError(
            f"IBKR compact Trade Notifications has an invalid displayed time: {raw_value!r}."
        ) from exc
    return displayed.astimezone(IBKR_WEB_LEDGER_TIMEZONE)


def _ibkr_web_trade_fill_detail_key(
    *,
    account: str,
    trade_datetime: datetime,
    side: str,
    ticker: str,
    price: Decimal,
    venue: str,
) -> tuple[str, ...]:
    venue_token = re.sub(r"[^A-Z0-9]+", "", str(venue or "").upper())
    canonical_venue = {
        "OVT": "OVERNIGHT",
        "OVERNIGHTUS": "OVERNIGHT",
    }.get(venue_token, str(venue or "").upper())
    return (
        account,
        trade_datetime.strftime("%Y-%m-%d %H:%M"),
        side,
        ticker,
        _decimal_to_str(price) or "",
        canonical_venue,
    )


def _parse_ibkr_web_trade_fill_details(
    raw_text: str,
    *,
    trade_date: str | None,
) -> list[dict[str, Any]]:
    """Read fee-bearing Trades rows that accompany compact Orders cards."""
    lines = [
        _normalize_whitespace(line)
        for line in str(raw_text or "")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .split("\n")
    ]
    summary_rows = [
        (index, match)
        for index, line in enumerate(lines)
        for match in [IBKR_WEB_TRADE_SUMMARY_PATTERN.fullmatch(line)]
        if match is not None
    ]
    if not summary_rows:
        return []

    parsed_trade_date = (
        _parse_ibkr_web_trade_date(trade_date) if _normalize_text(trade_date) else None
    )
    details: list[dict[str, Any]] = []
    for row_number, (summary_index, summary_match) in enumerate(summary_rows, start=1):
        ticker = normalize_ticker(lines[summary_index - 1] if summary_index else "")
        if not ticker:
            continue
        next_summary_index = (
            summary_rows[row_number][0]
            if row_number < len(summary_rows)
            else len(lines)
        )
        block_end = (
            max(summary_index + 1, next_summary_index - 1)
            if row_number < len(summary_rows)
            else len(lines)
        )
        block_lines = lines[summary_index + 1 : block_end]
        if not any(line.casefold() == "filled" for line in block_lines):
            continue
        account_match = re.search(
            r"\bU\d{6,12}\b", "\n".join(block_lines), re.IGNORECASE
        )
        row_account = account_match.group(0).upper() if account_match else ""
        if not row_account:
            continue
        displayed_datetime = next(
            (
                line
                for line in block_lines
                if IBKR_WEB_TRADE_DATETIME_PATTERN.fullmatch(line)
            ),
            "",
        )
        if displayed_datetime:
            ledger_datetime = _parse_ibkr_web_trade_datetime(displayed_datetime)
        else:
            displayed_time = next(
                (
                    line
                    for line in block_lines
                    if IBKR_WEB_COMPACT_TIME_PATTERN.fullmatch(line)
                ),
                "",
            )
            if not displayed_time or parsed_trade_date is None:
                continue
            ledger_datetime = _parse_ibkr_web_compact_time(
                displayed_time,
                parsed_trade_date,
            )
        fee_match = next(
            (
                match
                for line in block_lines
                for match in [IBKR_WEB_TRADE_FEE_PATTERN.fullmatch(line)]
                if match is not None
            ),
            None,
        )
        if fee_match is None:
            continue
        action = summary_match.group("action").lower()
        side = "sell" if action == "sold" else "buy"
        quantity = Decimal(summary_match.group("quantity").replace(",", ""))
        price = Decimal(summary_match.group("price").replace(",", ""))
        fee = Decimal(fee_match.group("fee").replace(",", ""))
        if quantity <= ZERO or price <= ZERO or fee < ZERO:
            continue
        details.append(
            {
                "account": row_account,
                "datetime": ledger_datetime,
                "side": side,
                "ticker": ticker,
                "price": price,
                "venue": summary_match.group("venue").upper(),
                "quantity": quantity,
                "fee": fee,
            }
        )
    return details


def _ibkr_web_execution_key(
    *,
    account: str,
    trade_datetime: datetime,
    side: str,
    ticker: str,
    quantity: Decimal,
    price: Decimal,
    venue: str,
) -> str:
    identity = "|".join(
        (
            account,
            trade_datetime.strftime("%Y-%m-%d %H:%M"),
            side,
            ticker,
            _decimal_to_str(quantity) or "",
            _decimal_to_str(price) or "",
            venue,
        )
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _ibkr_web_forex_pair_currencies(ticker: str) -> tuple[str, str] | None:
    normalized_ticker = normalize_ticker(ticker)
    match = re.fullmatch(r"([A-Z]{3})\.([A-Z]{3})", normalized_ticker)
    if match is None:
        return None
    return match.group(1), match.group(2)


def _convert_ibkr_web_record_to_forex_component(
    record: dict[str, Any],
    *,
    side: str,
    quantity: Decimal,
    price: Decimal,
    fee: Decimal | None,
) -> dict[str, Any]:
    """Convert an IBKR web FX fill without inventing its later CSV cash delta."""
    pair = _ibkr_web_forex_pair_currencies(_normalize_text(record.get("ticker")))
    if pair is None:
        return record
    base_currency, quote_currency = pair
    signed_quantity = -quantity if side == "sell" else quantity
    quote_amount = quantity * price
    quote_cash_delta = quote_amount if side == "sell" else -quote_amount
    commission_base: Decimal | None = None
    commission_conversion = "unavailable_without_account_base_cross_rate"
    if fee is not None:
        if quote_currency == "USD":
            commission_base = -fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            commission_conversion = "quote_currency_is_account_base"
        elif base_currency == "USD":
            commission_base = -(fee / price).quantize(
                Decimal("0.01"),
                rounding=ROUND_HALF_UP,
            )
            commission_conversion = "quote_fee_divided_by_fill_rate_to_usd_cent"

    record["type"] = "forex_trade_component"
    record["currency"] = base_currency
    record["description"] = _normalize_text(record.get("ticker"))
    record["quantity_raw"] = _decimal_to_str(signed_quantity)
    record["quantity_abs"] = _decimal_to_str(quantity)
    record["price_raw"] = _decimal_to_str(price)
    record.pop("gross_amount_raw", None)
    record.pop("net_amount_raw", None)
    if commission_base is None:
        record.pop("commission_raw", None)
        record.pop("commission_abs", None)
    else:
        record["commission_raw"] = _decimal_to_str(commission_base)
        record["commission_abs"] = _decimal_to_str(abs(commission_base))

    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    source.update(
        {
            "transaction_type_raw": "Forex Trade Component",
            "forex_pair": _normalize_text(record.get("ticker")),
            "forex_action": f"{side}_base",
            "base_currency": base_currency,
            "quote_currency": quote_currency,
            "base_quantity_raw": _decimal_to_str(quantity),
            "quote_amount_raw": _decimal_to_str(quote_amount),
            "quote_cash_delta_raw": _decimal_to_str(quote_cash_delta),
            "fee_amount_raw": _decimal_to_str(fee),
            "fee_currency": quote_currency if fee is not None else "",
            "fee_base_conversion": commission_conversion,
            "cash_delta_status": "awaiting_authoritative_transaction_history",
        }
    )
    record["source"] = source
    record["normalized"] = _build_normalized_view(
        "forex_trade_component",
        signed_quantity,
        price,
        None,
        commission_base,
        None,
        side_override=side,
    )
    return record


def _build_ibkr_user_verified_position_snapshot(
    *,
    transactions: list[dict[str, Any]],
    ending_cash: str | None,
    ending_cash_by_currency: dict[str, str] | None,
    ending_cash_as_of_datetime: str | None,
    position_snapshot_text: str | None,
) -> dict[str, dict[str, str]]:
    """Build a position boundary from the user's current, optional text input."""
    raw_text = _normalize_text(position_snapshot_text)
    if not raw_text:
        return {}

    captured_datetime = _ii_payload_summaries._normalize_ibkr_cash_snapshot_datetime(
        ending_cash_as_of_datetime
    )
    if not captured_datetime:
        captured_datetime = max(
            (
                _ii_payload_summaries._normalize_ibkr_cash_snapshot_datetime(
                    record.get("datetime")
                )
                for record in transactions
            ),
            default="",
        )
    if not captured_datetime:
        return {}

    captured_cash = _ii_hsbc_cash._parse_decimal_text_or_none(ending_cash)
    if captured_cash is None and not ending_cash_by_currency:
        return {}

    snapshot: dict[str, dict[str, str]] = {}
    position_pattern = re.compile(
        r"^\s*([A-Za-z][A-Za-z0-9._-]*)\s*(?:[,\t:=]|\s+)\s*"
        r"([+-]?[\d,]+(?:\.\d+)?)\s*$"
    )
    for line_number, line in enumerate(raw_text.splitlines(), start=1):
        normalized_line = _normalize_text(line)
        if not normalized_line:
            continue
        match = position_pattern.fullmatch(normalized_line)
        if match is None:
            raise ValueError(
                "The optional IBKR position snapshot must contain one ticker and "
                f"quantity per line (invalid line {line_number})."
            )
        ticker = normalize_ticker(match.group(1))
        quantity = _ii_hsbc_cash._parse_decimal_text_or_none(match.group(2))
        if not ticker or quantity is None or quantity < ZERO:
            raise ValueError(
                "The optional IBKR position snapshot contains an invalid ticker "
                f"or quantity on line {line_number}."
            )
        if ticker in snapshot:
            raise ValueError(
                "The optional IBKR position snapshot cannot repeat a ticker."
            )
        snapshot[ticker] = {
            "asset_category": "Stocks",
            "currency": "USD",
            "quantity": _decimal_to_str(quantity) or "0",
            "as_of": captured_datetime,
            "cost_basis_status": "unknown",
        }
    if not snapshot:
        raise ValueError(
            "The optional IBKR position snapshot must contain at least one position."
        )
    return snapshot


def _parse_ibkr_web_trade_notifications(
    raw_text: str,
    *,
    trade_date: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    lines = [
        _normalize_whitespace(line)
        for line in str(raw_text or "")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .split("\n")
    ]
    summary_rows = [
        (index, match)
        for index, line in enumerate(lines)
        for match in [IBKR_WEB_TRADE_SUMMARY_PATTERN.fullmatch(line)]
        if match is not None
    ]
    if not summary_rows:
        raise ValueError(
            "The pasted text does not contain recognizable IBKR filled trade notifications."
        )

    parsed_trade_date = (
        _parse_ibkr_web_trade_date(trade_date) if _normalize_text(trade_date) else None
    )
    account: str | None = None
    records: list[dict[str, Any]] = []
    execution_occurrence_counts: dict[str, int] = {}
    for row_number, (summary_index, summary_match) in enumerate(summary_rows, start=1):
        ticker = normalize_ticker(lines[summary_index - 1] if summary_index else "")
        if not ticker:
            raise ValueError(
                f"IBKR web trade notification {row_number} is missing its ticker."
            )
        has_next_summary = row_number < len(summary_rows)
        next_summary_index = (
            summary_rows[row_number][0] if has_next_summary else len(lines)
        )
        block_end = (
            max(summary_index + 1, next_summary_index - 1)
            if has_next_summary
            else len(lines)
        )
        block_lines = lines[summary_index + 1 : block_end]
        block_text = "\n".join(block_lines)
        account_match = re.search(r"\bU\d{6,12}\b", block_text, re.IGNORECASE)
        row_account = account_match.group(0).upper() if account_match else ""
        if not row_account:
            raise ValueError(
                f"IBKR web trade notification {row_number} is missing its account."
            )
        if account and not _ii_basics._accounts_are_compatible(
            "ibkr", account, row_account
        ):
            raise ValueError(
                "The pasted IBKR web trade notifications belong to different accounts."
            )
        account = account or row_account
        if not any(line.lower() == "filled" for line in block_lines):
            raise ValueError(
                f"IBKR web trade notification {row_number} is not marked Filled."
            )
        displayed_datetime = next(
            (
                line
                for line in block_lines
                if IBKR_WEB_TRADE_DATETIME_PATTERN.fullmatch(line)
            ),
            "",
        )
        if displayed_datetime:
            ledger_datetime = _parse_ibkr_web_trade_datetime(displayed_datetime)
            source_datetime_raw = displayed_datetime
        else:
            displayed_time = next(
                (
                    line
                    for line in block_lines
                    if IBKR_WEB_COMPACT_TIME_PATTERN.fullmatch(line)
                ),
                "",
            )
            if not displayed_time:
                raise ValueError(
                    f"IBKR web trade notification {row_number} is missing its displayed fill time."
                )
            if parsed_trade_date is None:
                raise ValueError(
                    "The IBKR Trade Notifications page omits the date for a current-day fill. "
                    "Provide the Hong Kong page date, for example 2026-08-13."
                )
            ledger_datetime = _parse_ibkr_web_compact_time(
                displayed_time,
                parsed_trade_date,
            )
            source_datetime_raw = f"{parsed_trade_date.isoformat()}, {displayed_time}"
        fee_match = next(
            (
                match
                for line in block_lines
                for match in [IBKR_WEB_TRADE_FEE_PATTERN.fullmatch(line)]
                if match is not None
            ),
            None,
        )
        if fee_match is None:
            raise ValueError(
                f"IBKR web trade notification {row_number} is missing its fee."
            )

        action = summary_match.group("action").lower()
        side = "sell" if action == "sold" else "buy"
        quantity = Decimal(summary_match.group("quantity").replace(",", ""))
        price = Decimal(summary_match.group("price").replace(",", ""))
        fee = Decimal(fee_match.group("fee").replace(",", ""))
        if quantity <= ZERO or price <= ZERO or fee < ZERO:
            raise ValueError(
                f"IBKR web trade notification {row_number} has an invalid quantity, price, or fee."
            )
        venue = summary_match.group("venue").upper()
        base_execution_key = _ibkr_web_execution_key(
            account=row_account,
            trade_datetime=ledger_datetime,
            side=side,
            ticker=ticker,
            quantity=quantity,
            price=price,
            venue=venue,
        )
        occurrence_index = execution_occurrence_counts.get(base_execution_key, 0)
        execution_occurrence_counts[base_execution_key] = occurrence_index + 1
        execution_key = (
            base_execution_key
            if occurrence_index == 0
            else f"{base_execution_key}:{occurrence_index + 1}"
        )

        signed_quantity = -quantity if side == "sell" else quantity
        gross_amount = quantity * price
        signed_gross_amount = -gross_amount if side == "buy" else gross_amount
        commission = -fee
        net_amount = signed_gross_amount + commission
        record = {
            "date": ledger_datetime.date().isoformat(),
            "datetime": ledger_datetime.strftime("%Y-%m-%d %H:%M:%S"),
            "type": side,
            "ticker": ticker,
            "currency": "USD",
            "description": ticker,
            "source": {
                "file_kind": "ibkr_web_trade_notification",
                "source_format": "pasted_text",
                "capture_scope": IBKR_WEB_CAPTURE_SCOPE,
                "capture_role": IBKR_WEB_CAPTURE_ROLE,
                "snapshot_relationship": IBKR_WEB_SNAPSHOT_RELATIONSHIP,
                "row_number": row_number,
                "transaction_type_raw": "Sold" if side == "sell" else "Bought",
                "account": row_account,
                "execution_key": execution_key,
                "execution_occurrence": occurrence_index + 1,
                "venue": venue,
                "source_datetime_raw": source_datetime_raw,
                "source_timezone": "Asia/Hong_Kong",
                "has_intraday_timestamp": True,
                "provisional_until_file_import": True,
            },
            "quantity_raw": _decimal_to_str(signed_quantity),
            "quantity_abs": _decimal_to_str(quantity),
            "price_raw": _decimal_to_str(price),
            "gross_amount_raw": _decimal_to_str(signed_gross_amount),
            "commission_raw": _decimal_to_str(commission),
            "commission_abs": _decimal_to_str(fee),
            "net_amount_raw": _decimal_to_str(net_amount),
            "normalized": _build_normalized_view(
                side,
                signed_quantity,
                price,
                signed_gross_amount,
                commission,
                net_amount,
            ),
        }
        record = _convert_ibkr_web_record_to_forex_component(
            record,
            side=side,
            quantity=quantity,
            price=price,
            fee=fee,
        )
        records.append(record)

    if not records or not account:
        raise ValueError(
            "The pasted text does not contain any unique IBKR filled trade notifications."
        )
    _ii_records._sort_transactions(records)
    return account, records


def _parse_ibkr_web_compact_trade_notifications(
    raw_text: str,
    *,
    trade_date: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    lines = [
        _normalize_whitespace(line)
        for line in str(raw_text or "")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .split("\n")
    ]
    action_rows = [
        (index, match)
        for index, line in enumerate(lines)
        for match in [IBKR_WEB_COMPACT_TRADE_PATTERN.fullmatch(line)]
        if match is not None
    ]
    if not action_rows:
        raise ValueError(
            "The pasted text does not contain recognizable IBKR filled trade notifications."
        )
    if not _normalize_text(trade_date):
        raise ValueError(
            "The compact IBKR Trade Notifications page does not show a date. "
            "Provide the Hong Kong page date, for example 2026-08-13."
        )
    parsed_trade_date = _parse_ibkr_web_trade_date(trade_date)

    fill_details_by_key: dict[tuple[str, ...], dict[str, Decimal | int]] = {}
    for detail in _parse_ibkr_web_trade_fill_details(
        raw_text,
        trade_date=trade_date,
    ):
        detail_key = _ibkr_web_trade_fill_detail_key(
            account=str(detail["account"]),
            trade_datetime=detail["datetime"],
            side=str(detail["side"]),
            ticker=str(detail["ticker"]),
            price=detail["price"],
            venue=str(detail["venue"]),
        )
        aggregate = fill_details_by_key.setdefault(
            detail_key,
            {"quantity": ZERO, "fee": ZERO, "count": 0},
        )
        aggregate["quantity"] = aggregate["quantity"] + detail["quantity"]
        aggregate["fee"] = aggregate["fee"] + detail["fee"]
        aggregate["count"] = aggregate["count"] + 1

    account: str | None = None
    records: list[dict[str, Any]] = []
    seen_execution_keys: set[str] = set()
    for row_number, (summary_index, summary_match) in enumerate(action_rows, start=1):
        next_summary_index = (
            action_rows[row_number][0] if row_number < len(action_rows) else len(lines)
        )
        block_lines = lines[summary_index + 1 : next_summary_index]
        order_account_line_index = next(
            (
                index
                for index, line in enumerate(block_lines)
                if re.search(r"\bU\d{6,12}\s+\d{6,12}\b", line, re.IGNORECASE)
            ),
            None,
        )
        if order_account_line_index is not None:
            block_lines = block_lines[: order_account_line_index + 1]
        if not any(line.casefold() == "filled" for line in block_lines):
            continue

        account_match = re.search(
            r"\bU\d{6,12}\b", "\n".join(block_lines), re.IGNORECASE
        )
        row_account = account_match.group(0).upper() if account_match else ""
        if not row_account:
            raise ValueError(
                f"IBKR compact Trade Notification {row_number} is missing its account."
            )
        if account and not _ii_basics._accounts_are_compatible(
            "ibkr", account, row_account
        ):
            raise ValueError(
                "The pasted IBKR compact Trade Notifications belong to different accounts."
            )
        account = account or row_account

        displayed_time = next(
            (
                line
                for line in block_lines
                if IBKR_WEB_COMPACT_TIME_PATTERN.fullmatch(line)
            ),
            "",
        )
        if not displayed_time:
            raise ValueError(
                f"IBKR compact Trade Notification {row_number} is missing its displayed fill time."
            )
        ledger_datetime = _parse_ibkr_web_compact_time(
            displayed_time, parsed_trade_date
        )
        action = summary_match.group("action").lower()
        side = "sell" if action == "sold" else "buy"
        ticker = normalize_ticker(summary_match.group("ticker"))
        quantity = Decimal(summary_match.group("quantity").replace(",", ""))
        price = Decimal(summary_match.group("price").replace(",", ""))
        venue = summary_match.group("venue").upper()
        if not ticker or quantity <= ZERO or price <= ZERO:
            raise ValueError(
                f"IBKR compact Trade Notification {row_number} has an invalid ticker, quantity, or price."
            )

        order_id = ""
        account_line = next(
            (line for line in block_lines if row_account.casefold() in line.casefold()),
            "",
        )
        if account_line:
            order_id_match = re.search(r"\b(\d{6,12})\b", account_line)
            order_id = order_id_match.group(1) if order_id_match else ""
        execution_key = _ibkr_web_execution_key(
            account=row_account,
            trade_datetime=ledger_datetime,
            side=side,
            ticker=ticker,
            quantity=quantity,
            price=price,
            venue=venue,
        )
        if execution_key in seen_execution_keys:
            continue
        seen_execution_keys.add(execution_key)

        signed_quantity = -quantity if side == "sell" else quantity
        gross_amount = quantity * price
        signed_gross_amount = -gross_amount if side == "buy" else gross_amount
        record = {
            "date": ledger_datetime.date().isoformat(),
            "datetime": ledger_datetime.strftime("%Y-%m-%d %H:%M:%S"),
            "type": side,
            "ticker": ticker,
            "currency": "USD",
            "description": ticker,
            "source": {
                "file_kind": "ibkr_web_trade_notification",
                "source_format": "pasted_text_compact_orders",
                "capture_scope": IBKR_WEB_CAPTURE_SCOPE,
                "capture_role": IBKR_WEB_CAPTURE_ROLE,
                "snapshot_relationship": IBKR_WEB_SNAPSHOT_RELATIONSHIP,
                "row_number": row_number,
                "transaction_type_raw": "Sold" if side == "sell" else "Bought",
                "account": row_account,
                "order_id": order_id,
                "execution_key": execution_key,
                "venue": venue,
                "source_datetime_raw": f"{parsed_trade_date.isoformat()}, {displayed_time}",
                "source_timezone": "Asia/Hong_Kong",
                "has_intraday_timestamp": True,
                "fee_missing_from_capture": True,
                "provisional_until_file_import": True,
            },
            "quantity_raw": _decimal_to_str(signed_quantity),
            "quantity_abs": _decimal_to_str(quantity),
            "price_raw": _decimal_to_str(price),
            "gross_amount_raw": _decimal_to_str(signed_gross_amount),
            "normalized": _build_normalized_view(
                side,
                signed_quantity,
                price,
                signed_gross_amount,
                None,
                None,
            ),
        }
        detail_key = _ibkr_web_trade_fill_detail_key(
            account=row_account,
            trade_datetime=ledger_datetime,
            side=side,
            ticker=ticker,
            price=price,
            venue=venue,
        )
        fill_detail = fill_details_by_key.get(detail_key)
        resolved_fee: Decimal | None = None
        if (
            fill_detail is not None
            and fill_detail["quantity"] == quantity
            and int(fill_detail["count"]) > 0
        ):
            fee = fill_detail["fee"]
            resolved_fee = fee
            commission = -fee
            net_amount = signed_gross_amount + commission
            source = record["source"]
            source.pop("fee_missing_from_capture", None)
            source["fee_source"] = "same_page_trade_fill_details"
            source["fill_detail_count"] = int(fill_detail["count"])
            record["commission_raw"] = _decimal_to_str(commission)
            record["commission_abs"] = _decimal_to_str(fee)
            record["net_amount_raw"] = _decimal_to_str(net_amount)
            record["normalized"] = _build_normalized_view(
                side,
                signed_quantity,
                price,
                signed_gross_amount,
                commission,
                net_amount,
            )
        record = _convert_ibkr_web_record_to_forex_component(
            record,
            side=side,
            quantity=quantity,
            price=price,
            fee=resolved_fee,
        )
        records.append(record)

    if not records or not account:
        raise ValueError(
            "The compact IBKR Trade Notifications text does not contain any unique Filled trade."
        )
    _ii_records._sort_transactions(records)
    return account, records


def _parse_ibkr_web_holdings_capture(
    raw_text: str,
) -> tuple[str, dict[str, str], str]:
    """Parse the account, native cash, and open positions from Your Holdings."""
    normalized_text = str(raw_text or "").strip()
    if not normalized_text:
        raise ValueError("Please paste the IBKR Your Holdings page text.")
    lines = [
        normalized
        for raw_line in normalized_text.replace("\r\n", "\n")
        .replace("\r", "\n")
        .split("\n")
        for normalized in [_normalize_whitespace(raw_line)]
        if normalized
    ]
    holdings_index = next(
        (
            index
            for index, line in enumerate(lines)
            if line.casefold() == "your holdings"
        ),
        -1,
    )
    cash_index = next(
        (
            index
            for index, line in enumerate(lines)
            if index > holdings_index and line.casefold() == "cash holdings"
        ),
        -1,
    )
    if holdings_index < 0 or cash_index <= holdings_index:
        raise ValueError(
            "The pasted IBKR holdings text must contain both Your Holdings and Cash Holdings."
        )

    accounts = {
        match.group(0).upper()
        for match in re.finditer(r"\bU\d{6,12}\b", normalized_text, re.IGNORECASE)
    }
    if len(accounts) != 1:
        raise ValueError(
            "The pasted IBKR holdings text must identify exactly one IBKR account."
        )
    account = next(iter(accounts))

    position_row_pattern = re.compile(r"^(?P<quantity>[+-]?[\d,]+(?:\.\d+)?)\s+[-+]?\d")
    positions: dict[str, str] = {}
    excluded_tickers = {"USD", "HKD", "CNH", "CNY", "RMB", "ME", "IBOT"}
    for index in range(holdings_index + 1, cash_index - 2):
        raw_ticker = lines[index].upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", raw_ticker):
            continue
        ticker = normalize_ticker(raw_ticker)
        if not ticker or ticker in excluded_tickers:
            continue
        description = lines[index + 1]
        position_match = position_row_pattern.match(lines[index + 2])
        if not re.search(r"[A-Za-z]", description) or position_match is None:
            continue
        quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            position_match.group("quantity")
        )
        if quantity is None or not quantity.is_finite() or quantity < ZERO:
            raise ValueError(
                f"The pasted IBKR holdings text contains an invalid {ticker} position."
            )
        if ticker in positions:
            raise ValueError(
                f"The pasted IBKR holdings text repeats the {ticker} position."
            )
        positions[ticker] = _decimal_to_str(quantity) or "0"
    if not positions:
        raise ValueError(
            "The pasted IBKR holdings text does not contain a recognizable Instrument and Position row."
        )

    cash_row_pattern = re.compile(
        r"^(?P<currency>[A-Z]{3,6})"
        r"(?P<base_marker>\s+\(base currency\))?\s+"
        r"(?P<amount>[+-]?[\d,]+(?:\.\d+)?)$",
        re.IGNORECASE,
    )
    cash_balances: dict[str, str] = {}
    base_cash_currencies: set[str] = set()
    for line in lines[cash_index + 1 :]:
        match = cash_row_pattern.fullmatch(line)
        if match is None:
            continue
        currency = match.group("currency").upper()
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(match.group("amount"))
        if amount is None or not amount.is_finite():
            raise ValueError(
                f"The pasted IBKR holdings text contains an invalid {currency} cash balance."
            )
        if currency in cash_balances:
            raise ValueError(
                f"The pasted IBKR holdings text repeats the {currency} cash balance."
            )
        cash_balances[currency] = _decimal_to_str(amount) or "0"
        if match.group("base_marker"):
            base_cash_currencies.add(currency)
    if len(base_cash_currencies) != 1:
        raise ValueError(
            "The pasted IBKR holdings text does not contain a base-currency Cash Holdings row."
        )

    position_snapshot_text = "\n".join(
        f"{ticker} {quantity}" for ticker, quantity in positions.items()
    )
    return account, cash_balances, position_snapshot_text


def build_investment_payload_from_ibkr_web_pasted_text(
    *,
    trade_notifications_text: str,
    trade_date: str | None = None,
    holdings_text: str | None = None,
    ending_cash: str | None = None,
    ending_cash_by_currency: dict[str, Any] | None = None,
    ending_cash_as_of_datetime: str | None = None,
    position_snapshot_text: str | None = None,
) -> dict[str, Any]:
    """Build a provisional IBKR trade payload from Client Portal clipboard text."""
    normalized_text = str(trade_notifications_text or "").strip()
    if not normalized_text:
        raise ValueError("Please paste the IBKR Trade Notifications page text.")
    if any(
        IBKR_WEB_COMPACT_TRADE_PATTERN.fullmatch(line)
        for line in normalized_text.splitlines()
    ):
        account, transactions = _parse_ibkr_web_compact_trade_notifications(
            normalized_text,
            trade_date=trade_date,
        )
    else:
        account, transactions = _parse_ibkr_web_trade_notifications(
            normalized_text,
            trade_date=trade_date,
        )
    normalized_holdings_text = str(holdings_text or "").strip()
    if normalized_holdings_text:
        if (
            _normalize_text(ending_cash)
            or _ii_merge_identity._normalize_currency_balance_map(
                ending_cash_by_currency
            )
            or _normalize_text(position_snapshot_text)
        ):
            raise ValueError(
                "Use either the IBKR Your Holdings page text or legacy manual cash and position values, not both."
            )
        holdings_account, parsed_cash_balances, parsed_positions = (
            _parse_ibkr_web_holdings_capture(normalized_holdings_text)
        )
        if not _ii_basics._accounts_are_compatible("ibkr", account, holdings_account):
            raise ValueError(
                "The IBKR Trade Notifications and Your Holdings captures belong to different accounts."
            )
        ending_cash_by_currency = parsed_cash_balances
        ending_cash = parsed_cash_balances.get("USD")
        position_snapshot_text = parsed_positions
    evidence_bytes = normalized_text.encode("utf-8")
    content_sha256 = hashlib.sha256(evidence_bytes).hexdigest()
    transaction_dates = [
        _normalize_text(record.get("date"))
        for record in transactions
        if _normalize_text(record.get("date"))
    ]
    source_artifact = {
        "evidence_schema_version": "1.0",
        "sha256": content_sha256,
        "byte_count": len(evidence_bytes),
        "filename": f"ibkr-web-trade-notifications-{content_sha256[:12]}.txt",
        "filenames": [f"ibkr-web-trade-notifications-{content_sha256[:12]}.txt"],
        "broker": "ibkr",
        "account": account,
        "source_kind": "ibkr_web_trade_notifications_text",
        "bundle_id": content_sha256,
        "bundle_ids": [content_sha256],
        "bundle_role": "trade_notifications",
        "capture_scope": IBKR_WEB_CAPTURE_SCOPE,
        "capture_role": IBKR_WEB_CAPTURE_ROLE,
        "snapshot_relationship": IBKR_WEB_SNAPSHOT_RELATIONSHIP,
        "related_sha256": "",
        "statement_title": "IBKR Trade Notifications",
        "statement_period": "",
        "statement_period_start": min(transaction_dates, default=""),
        "statement_period_end": max(transaction_dates, default=""),
        "statement_generated_at": "",
        "content_encoding": "base64",
        "content_base64": base64.b64encode(evidence_bytes).decode("ascii"),
    }
    source_artifacts = [source_artifact]
    if normalized_holdings_text:
        holdings_evidence_bytes = normalized_holdings_text.encode("utf-8")
        holdings_sha256 = hashlib.sha256(holdings_evidence_bytes).hexdigest()
        source_artifact["related_sha256"] = holdings_sha256
        source_artifacts.append(
            {
                "evidence_schema_version": "1.0",
                "sha256": holdings_sha256,
                "byte_count": len(holdings_evidence_bytes),
                "filename": f"ibkr-web-holdings-{holdings_sha256[:12]}.txt",
                "filenames": [f"ibkr-web-holdings-{holdings_sha256[:12]}.txt"],
                "broker": "ibkr",
                "account": account,
                "source_kind": "ibkr_web_holdings_text",
                "bundle_id": holdings_sha256,
                "bundle_ids": [holdings_sha256],
                "bundle_role": "holdings_snapshot",
                "capture_scope": "current_account_snapshot",
                "capture_role": "cash_and_positions_boundary",
                "snapshot_relationship": "calibrates_trade_notifications_capture",
                "related_sha256": content_sha256,
                "statement_title": "IBKR Your Holdings",
                "statement_period": "",
                "statement_period_start": "",
                "statement_period_end": "",
                "statement_generated_at": "",
                "content_encoding": "base64",
                "content_base64": base64.b64encode(holdings_evidence_bytes).decode(
                    "ascii"
                ),
            }
        )
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "ibkr_web_trade_notifications_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
        },
        "broker": "ibkr",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": (
                "America/New_York calendar date converted from the IBKR web display time."
            ),
            "datetime_field_meaning": (
                "Intraday fill time converted from Asia/Hong_Kong to America/New_York."
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_timezone": "Asia/Hong_Kong",
            "source_has_intraday_timestamp": True,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=[],
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots={},
            performance_snapshots={},
            starting_cash=None,
            ending_cash=None,
        ),
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    for transaction in payload["transactions"]:
        transaction["broker"] = "ibkr"
        transaction["account"] = account
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "ibkr"
            source["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    payload["summary"]["position_snapshot_authoritative"] = False
    payload["summary"]["performance_snapshot_authoritative"] = False
    payload["summary"]["current_moment_source"] = "ibkr_web_trade_notifications"
    payload["summary"]["capture_scope"] = IBKR_WEB_CAPTURE_SCOPE
    payload["summary"]["capture_role"] = IBKR_WEB_CAPTURE_ROLE
    payload["summary"]["snapshot_relationship"] = IBKR_WEB_SNAPSHOT_RELATIONSHIP
    payload["summary"]["provisional_trade_count"] = len(transactions)
    normalized_ending_cash = _normalize_text(ending_cash)
    normalized_cash_balances = _ii_merge_identity._normalize_currency_balance_map(
        ending_cash_by_currency
    )
    if normalized_ending_cash and "USD" not in normalized_cash_balances:
        normalized_cash_balances["USD"] = normalized_ending_cash
    if not normalized_ending_cash:
        normalized_ending_cash = normalized_cash_balances.get("USD", "")
    normalized_position_snapshot = _normalize_text(position_snapshot_text)
    if normalized_position_snapshot and not normalized_cash_balances:
        raise ValueError(
            "The optional IBKR position snapshot requires the optional cash boundary."
        )
    if normalized_cash_balances:
        ending_cash_decimal = _ii_hsbc_cash._parse_decimal_text_or_none(
            normalized_ending_cash
        )
        if normalized_ending_cash and (
            ending_cash_decimal is None or not ending_cash_decimal.is_finite()
        ):
            raise ValueError(
                "The optional IBKR post-fill cash value must be a finite decimal amount."
            )
        normalized_cash_datetime = (
            _ii_payload_summaries._normalize_ibkr_cash_snapshot_datetime(
                ending_cash_as_of_datetime
            )
        )
        if ending_cash_as_of_datetime and not normalized_cash_datetime:
            raise ValueError(
                "The optional IBKR cash boundary datetime must use YYYY-MM-DD HH:MM:SS."
            )
        if not normalized_cash_datetime:
            normalized_cash_datetime = max(
                (
                    _ii_payload_summaries._normalize_ibkr_cash_snapshot_datetime(
                        record.get("datetime")
                    )
                    for record in transactions
                ),
                default="",
            )
        if not normalized_cash_datetime:
            latest_transaction_date = max(
                (_normalize_text(record.get("date")) for record in transactions),
                default="",
            )
            normalized_cash_datetime = (
                f"{latest_transaction_date} 00:00:00" if latest_transaction_date else ""
            )
        if not normalized_cash_datetime:
            raise ValueError(
                "The optional IBKR post-fill cash value requires a dated filled trade."
            )
        normalized_cash = (
            _decimal_to_str(ending_cash_decimal)
            if ending_cash_decimal is not None
            else None
        )
        normalized_cash_date = normalized_cash_datetime[:10]
        cash_snapshot_fields = {
            "cash_snapshot_source": IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE,
            "cash_snapshot_authoritative": True,
            "calibration_source": IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE,
            "cash_snapshot_verification": "user_confirmed_from_ibkr_app",
            "current_moment_source": "ibkr_user_verified_app_cash_after_trade",
            "ending_cash_as_of": normalized_cash_date,
            "ending_cash_replay_as_of": normalized_cash_date,
            "ending_cash_as_of_datetime": normalized_cash_datetime,
            "ending_cash_replay_as_of_datetime": normalized_cash_datetime,
            "ending_cash_by_currency": normalized_cash_balances,
        }
        if normalized_cash is not None:
            cash_snapshot_fields["ending_cash_raw"] = normalized_cash
            payload["ending_cash"] = normalized_cash
        payload["ending_cash_by_currency"] = normalized_cash_balances
        payload["summary"].update(cash_snapshot_fields)
        user_verified_position_snapshot = _build_ibkr_user_verified_position_snapshot(
            transactions=transactions,
            ending_cash=normalized_cash,
            ending_cash_by_currency=normalized_cash_balances,
            ending_cash_as_of_datetime=normalized_cash_datetime,
            position_snapshot_text=position_snapshot_text,
        )
        if user_verified_position_snapshot:
            payload["position_snapshot"] = user_verified_position_snapshot
            payload["summary"].update(
                {
                    "open_position_count": len(user_verified_position_snapshot),
                    "position_snapshot_authoritative": True,
                    "position_snapshot_source": (
                        IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE
                    ),
                    "position_snapshot_as_of": normalized_cash_datetime,
                    "position_snapshot_calibration_scope": (
                        "account_cash_and_latest_fill_boundary"
                    ),
                }
            )
            holdings_validation = payload["summary"].get("holdings_validation")
            if isinstance(holdings_validation, dict):
                holdings_validation.update(
                    {
                        "status": "snapshot_authoritative_partial_history",
                        "comparison_scope": "user_confirmed_current_position_snapshot",
                        "history_complete": False,
                    }
                )
        if normalized_holdings_text:
            payload["summary"]["calibration_evidence_source"] = "ibkr_web_holdings_text"
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _parse_ibkr_gainskeeper_xml(payload: bytes, filename: str) -> ET.Element:
    text = payload.decode("utf-8-sig", errors="replace")
    start_index = text.find("<OFX>")
    if start_index < 0:
        raise ValueError(
            f"{filename or 'GainsKeeper file'} does not contain an OFX body."
        )
    try:
        return ET.fromstring(text[start_index:])
    except ET.ParseError as exc:
        raise ValueError(
            f"{filename or 'GainsKeeper file'} is not valid GainsKeeper OFX/XML."
        ) from exc


def _gkx_text(node: ET.Element | None, path: str) -> str:
    if node is not None and path.startswith("."):
        current = node.find(path)
        if current is None or current.text is None:
            return ""
        return _normalize_text(current.text)
    current = node
    for part in path.split("/"):
        current = current.find(part) if current is not None else None
    if current is None or current.text is None:
        return ""
    return _normalize_text(current.text)


def _parse_gkx_datetime(value: str) -> tuple[str, str]:
    raw = _normalize_text(value)
    if len(raw) < 8:
        return "", ""
    day = f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    if len(raw) >= 14:
        timestamp = f"{day} {raw[8:10]}:{raw[10:12]}:{raw[12:14]}"
    else:
        timestamp = _ii_basics._build_convention_datetime(day)
    return day, timestamp


def _build_gkx_security_map(root: ET.Element) -> dict[str, dict[str, str]]:
    securities: dict[str, dict[str, str]] = {}
    for container in list(root.findall(".//STOCKINFO")) + list(
        root.findall(".//OTHERINFO")
    ):
        sec_info = container.find("SECINFO")
        unique_id = _gkx_text(sec_info, "SECID/UNIQUEID")
        if not unique_id:
            continue
        ticker = normalize_ticker(_gkx_text(sec_info, "TICKER"))
        sec_name = _normalize_whitespace(_gkx_text(sec_info, "SECNAME"))
        display_name = sec_name
        if ticker and display_name.upper().startswith(f"{ticker.upper()} "):
            display_name = display_name[len(ticker) + 1 :].strip()
        securities[unique_id] = {
            "ticker": ticker,
            "name": display_name or sec_name or ticker,
            "sec_name": sec_name,
            "fiid": _gkx_text(sec_info, "FIID"),
        }
    return securities


def _build_gkx_stock_record(
    node: ET.Element,
    *,
    inner_tag: str,
    gkx_transaction_tag: str,
    mapped_type: str,
    file_index: int,
    filename: str,
    account: str | None,
    security_map: dict[str, dict[str, str]],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    body = node.find(inner_tag)
    if body is None:
        return None
    trade_day, trade_datetime = _parse_gkx_datetime(_gkx_text(body, "INVTRAN/DTTRADE"))
    unique_id = _gkx_text(body, "SECID/UNIQUEID")
    security = security_map.get(unique_id, {})
    ticker = normalize_ticker(security.get("ticker", ""))
    quantity_dec = _parse_decimal(
        _gkx_text(body, "UNITS"), "UNITS", row_number, warnings
    )
    price_dec = _parse_decimal(
        _gkx_text(body, "UNITPRICE"), "UNITPRICE", row_number, warnings
    )
    total_dec = _parse_decimal(_gkx_text(body, "TOTAL"), "TOTAL", row_number, warnings)
    commission_dec = (
        _parse_decimal(
            _gkx_text(body, "COMMISSION"), "COMMISSION", row_number, warnings
        )
        or ZERO
    )
    tax_dec = (
        _parse_decimal(_gkx_text(body, "TAXES"), "TAXES", row_number, warnings) or ZERO
    )
    if not trade_day or quantity_dec is None or price_dec is None or total_dec is None:
        warnings.append(
            f"{filename}: skipped GainsKeeper stock row {row_number} with incomplete trade fields."
        )
        return None
    commission_raw = -(abs(commission_dec) + abs(tax_dec))
    gross_dec = total_dec - commission_raw
    record = {
        "date": trade_day,
        "datetime": trade_datetime,
        "type": mapped_type,
        "currency": _gkx_text(body, "CURRENCY/CURSYM") or "USD",
        "description": security.get("name") or ticker or unique_id,
        "source": {
            "file_kind": "gainskeeper",
            "source_format": "ofx_gkx",
            "source_filename": filename,
            "file_index": file_index,
            "row_number": row_number,
            "transaction_type_raw": "Buy" if mapped_type == "buy" else "Sell",
            "account": account,
            "fitid": _gkx_text(body, "INVTRAN/FITID"),
            "secid": unique_id,
            "secid_type": _gkx_text(body, "SECID/UNIQUEIDTYPE"),
            "fiid": security.get("fiid"),
            "source_datetime_raw": _gkx_text(body, "INVTRAN/DTTRADE"),
            "has_intraday_timestamp": True,
            "gkx_transaction_tag": gkx_transaction_tag,
        },
        "ticker": ticker,
        "quantity_raw": _decimal_to_str(quantity_dec),
        "quantity_abs": _decimal_to_str(abs(quantity_dec)),
        "price_raw": _decimal_to_str(price_dec),
        "gross_amount_raw": _decimal_to_str(gross_dec),
        "commission_raw": _decimal_to_str(commission_raw),
        "commission_abs": _decimal_to_str(abs(commission_raw)),
        "net_amount_raw": _decimal_to_str(total_dec),
        "normalized": _build_normalized_view(
            mapped_type,
            quantity_dec,
            price_dec,
            gross_dec,
            commission_raw,
            total_dec,
        ),
    }
    return record


def _gkx_ticker_from_memo(memo: str, security_map: dict[str, dict[str, str]]) -> str:
    match = re.match(
        r"(?P<symbol>[A-Z0-9.]+)\((?P<identifier>[A-Z0-9]+)\)",
        memo.strip(),
        re.IGNORECASE,
    )
    if not match:
        return ""
    identifier = match.group("identifier")
    for unique_id, security in security_map.items():
        if identifier.startswith(unique_id):
            return normalize_ticker(security.get("ticker", ""))
    return normalize_ticker(match.group("symbol"))


def _build_gkx_income_record(
    node: ET.Element,
    *,
    file_index: int,
    filename: str,
    account: str | None,
    security_map: dict[str, dict[str, str]],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    trade_day, trade_datetime = _parse_gkx_datetime(_gkx_text(node, "INVTRAN/DTTRADE"))
    total_dec = _parse_decimal(_gkx_text(node, "TOTAL"), "TOTAL", row_number, warnings)
    if not trade_day or total_dec is None:
        return None
    unique_id = _gkx_text(node, "SECID/UNIQUEID")
    security = security_map.get(unique_id, {})
    ticker = normalize_ticker(security.get("ticker", ""))
    memo = _normalize_whitespace(_gkx_text(node, "INVTRAN/MEMO"))
    record = {
        "date": trade_day,
        "datetime": trade_datetime,
        "type": "dividend",
        "currency": _gkx_text(node, "CURRENCY/CURSYM") or "USD",
        "description": _ii_basics._normalize_ibkr_description(
            memo or security.get("name") or ticker or unique_id
        ),
        "source": {
            "file_kind": "gainskeeper",
            "source_format": "ofx_gkx",
            "source_filename": filename,
            "file_index": file_index,
            "row_number": row_number,
            "transaction_type_raw": "Dividend",
            "account": account,
            "fitid": _gkx_text(node, "INVTRAN/FITID"),
            "secid": unique_id,
            "secid_type": _gkx_text(node, "SECID/UNIQUEIDTYPE"),
            "fiid": security.get("fiid"),
            "income_type": _gkx_text(node, "INCOMETYPE"),
            "source_datetime_raw": _gkx_text(node, "INVTRAN/DTTRADE"),
        },
        "gross_amount_raw": _decimal_to_str(total_dec),
        "net_amount_raw": _decimal_to_str(total_dec),
        "normalized": _build_normalized_view(
            "dividend", None, None, total_dec, None, total_dec
        ),
    }
    if ticker:
        record["ticker"] = ticker
    return record


def _build_gkx_transfer_record(
    node: ET.Element,
    *,
    file_index: int,
    filename: str,
    account: str | None,
    report_currency: str,
    security_map: dict[str, dict[str, str]],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    """Normalize one GainsKeeper in-kind security transfer without adding cash."""
    trade_day, trade_datetime = _parse_gkx_datetime(_gkx_text(node, "INVTRAN/DTTRADE"))
    unique_id = _gkx_text(node, "SECID/UNIQUEID")
    security = security_map.get(unique_id, {})
    ticker = normalize_ticker(security.get("ticker", ""))
    direction = _normalize_text(_gkx_text(node, "TFERACTION")).lower()
    quantity_dec = _parse_decimal(
        _gkx_text(node, "UNITS"),
        "transfer_quantity",
        row_number,
        warnings,
    )
    transfer_price_dec = _parse_decimal(
        _gkx_text(node, "UNITPRICE"),
        "transfer_price",
        row_number,
        warnings,
    )
    if direction not in {"in", "out"}:
        warnings.append(
            f"{filename}: skipped GainsKeeper security transfer row {row_number} "
            f"with unsupported direction {direction or 'missing'!r}."
        )
        return None
    if not trade_day or not ticker or quantity_dec is None or quantity_dec == ZERO:
        warnings.append(
            f"{filename}: skipped GainsKeeper security transfer row {row_number} "
            "with incomplete transfer fields."
        )
        return None

    memo = _normalize_whitespace(_gkx_text(node, "INVTRAN/MEMO"))
    transfer_type_match = re.match(r"(?P<transfer_type>[A-Za-z]+)", memo)
    transfer_type = (
        transfer_type_match.group("transfer_type").upper()
        if transfer_type_match
        else "Security"
    )
    transfer_account_match = re.search(
        r"\bAccount\s+(?P<account>[A-Za-z0-9-]+)\b",
        memo,
        flags=re.IGNORECASE,
    )
    transfer_account = (
        transfer_account_match.group("account") if transfer_account_match else ""
    )
    mapped_type = "transfer_out" if direction == "out" else "transfer_in"
    quantity_abs = abs(quantity_dec)
    record: dict[str, Any] = {
        "date": trade_day,
        "datetime": trade_datetime,
        "type": mapped_type,
        "currency": _gkx_text(node, "CURRENCY/CURSYM") or report_currency or "USD",
        "description": f"{transfer_type} transfer {direction}: {ticker}",
        "ticker": ticker,
        "quantity_raw": _decimal_to_str(quantity_abs),
        "quantity_abs": _decimal_to_str(quantity_abs),
        "gross_amount_raw": "0",
        "commission_raw": "0",
        "commission_abs": "0",
        "net_amount_raw": "0",
        "source": {
            "file_kind": "ibkr_transfers",
            "source_format": "ofx_gkx",
            "source_filename": filename,
            "file_index": file_index,
            "row_number": row_number,
            "transaction_type_raw": transfer_type,
            "transfer_direction": direction,
            "transfer_account": transfer_account,
            "account": account,
            "fitid": _gkx_text(node, "INVTRAN/FITID"),
            "secid": unique_id,
            "secid_type": _gkx_text(node, "SECID/UNIQUEIDTYPE"),
            "fiid": security.get("fiid"),
            "source_datetime_raw": _gkx_text(node, "INVTRAN/DTTRADE"),
            "memo_raw": memo,
        },
        "normalized": _build_normalized_view(
            mapped_type,
            quantity_abs,
            transfer_price_dec,
            ZERO,
            ZERO,
            ZERO,
            is_cash_flow_override=False,
            side_override="sell" if mapped_type == "transfer_out" else "buy",
        ),
    }
    if transfer_price_dec is not None and transfer_price_dec > ZERO:
        record["price_raw"] = _decimal_to_str(transfer_price_dec)
    return record


def _build_gkx_expense_record(
    node: ET.Element,
    *,
    file_index: int,
    filename: str,
    account: str | None,
    security_map: dict[str, dict[str, str]],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    trade_day, trade_datetime = _parse_gkx_datetime(_gkx_text(node, "INVTRAN/DTTRADE"))
    total_dec = _parse_decimal(_gkx_text(node, "TOTAL"), "TOTAL", row_number, warnings)
    if not trade_day or total_dec is None:
        warnings.append(
            f"{filename}: skipped GainsKeeper investment expense row {row_number} with incomplete fields."
        )
        return None
    unique_id = _gkx_text(node, "SECID/UNIQUEID")
    security = security_map.get(unique_id, {})
    ticker = normalize_ticker(security.get("ticker", ""))
    memo = _normalize_whitespace(_gkx_text(node, "INVTRAN/MEMO"))
    memo_upper = memo.upper()
    mapped_type = "adjustment"
    transaction_type_raw = "Investment Expense"
    if "US TAX" in memo_upper:
        mapped_type = "foreign_tax_withholding"
        transaction_type_raw = "Foreign Tax Withholding"
    elif "PAYMENT IN LIEU" in memo_upper:
        mapped_type = "payment_in_lieu"
        transaction_type_raw = "Payment in Lieu"
    elif "DIVIDEND" in memo_upper:
        mapped_type = "dividend"
        transaction_type_raw = (
            "Dividend Reversal" if "REVERSAL" in memo_upper else "Dividend Expense"
        )
    elif "INTEREST" in memo_upper:
        mapped_type = "debit_interest" if total_dec < ZERO else "credit_interest"
        transaction_type_raw = (
            "Debit Interest" if total_dec < ZERO else "Credit Interest"
        )
    description = (
        (memo or security.get("name") or ticker or unique_id)
        .title()
        .replace("Ibkr", "IBKR")
        .replace("Usd", "USD")
        .replace("(Us", "(US")
        .replace(" Us ", " US ")
    )
    description = _ii_basics._normalize_ibkr_description(description)
    record = {
        "date": trade_day,
        "datetime": trade_datetime,
        "type": mapped_type,
        "currency": _gkx_text(node, "CURRENCY/CURSYM") or "USD",
        "description": description,
        "source": {
            "file_kind": "gainskeeper",
            "source_format": "ofx_gkx",
            "source_filename": filename,
            "file_index": file_index,
            "row_number": row_number,
            "transaction_type_raw": transaction_type_raw,
            "account": account,
            "fitid": _gkx_text(node, "INVTRAN/FITID"),
            "secid": unique_id,
            "secid_type": _gkx_text(node, "SECID/UNIQUEIDTYPE"),
            "fiid": security.get("fiid"),
            "source_datetime_raw": _gkx_text(node, "INVTRAN/DTTRADE"),
            "memo_raw": memo,
        },
        "gross_amount_raw": _decimal_to_str(total_dec),
        "net_amount_raw": _decimal_to_str(total_dec),
        "normalized": _build_normalized_view(
            mapped_type, None, None, total_dec, None, total_dec
        ),
    }
    if ticker:
        record["ticker"] = ticker
    return record


def _build_gkx_bank_record(
    node: ET.Element,
    *,
    file_index: int,
    filename: str,
    account: str | None,
    security_map: dict[str, dict[str, str]],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    stmt = node.find("STMTTRN")
    if stmt is None:
        return None
    memo = _normalize_whitespace(_gkx_text(stmt, "MEMO"))
    memo_upper = memo.upper()
    if memo_upper.startswith("CASH TRADE:"):
        warnings.append(
            f"{filename}: skipped GainsKeeper FX cash-trade row {row_number}; existing CSV FX rows remain authoritative."
        )
        return None
    posted_day, posted_datetime = _parse_gkx_datetime(_gkx_text(stmt, "DTPOSTED"))
    amount_dec = _parse_decimal(
        _gkx_text(stmt, "TRNAMT"), "TRNAMT", row_number, warnings
    )
    if not posted_day or amount_dec is None:
        return None
    raw_type = _gkx_text(stmt, "TRNTYPE").upper()
    currency = _gkx_text(stmt, "CURRENCY/CURSYM") or None
    if raw_type in {"DEP", "CASH"} and currency and currency != "USD":
        warnings.append(
            f"{filename}: skipped GainsKeeper non-USD cash row {row_number}; existing CSV base-currency cash rows remain authoritative."
        )
        return None
    mapped_type = "adjustment"
    transaction_type_raw = raw_type.title()
    ticker = _gkx_ticker_from_memo(memo, security_map)
    if raw_type == "DEP":
        mapped_type = "deposit"
        transaction_type_raw = "Deposit"
        description = (
            "Electronic Fund Transfer"
            if "ELECTRONIC FUND TRANSFERS" in memo_upper
            else memo
        )
    elif raw_type == "CASH":
        mapped_type = "withdrawal" if amount_dec < ZERO else "deposit"
        transaction_type_raw = "Withdrawal" if amount_dec < ZERO else "Deposit"
        description = (
            "Disbursement Initiated by Liying Wu"
            if "DISBURSEMENT" in memo_upper
            else memo
        )
    elif raw_type == "INT":
        mapped_type = "credit_interest" if amount_dec >= ZERO else "debit_interest"
        transaction_type_raw = (
            "Credit Interest" if amount_dec >= ZERO else "Debit Interest"
        )
        description = memo.title().replace("Usd", "USD")
    elif raw_type == "DIV" and "PAYMENT IN LIEU" in memo_upper:
        mapped_type = "payment_in_lieu"
        transaction_type_raw = "Payment in Lieu"
        description = memo.title().replace("Ibkr", "IBKR").replace("Us", "US")
    elif "US TAX" in memo_upper:
        mapped_type = "foreign_tax_withholding"
        transaction_type_raw = "Foreign Tax Withholding"
        description = memo.title().replace("Us Tax", "US Tax").replace("Usd", "USD")
    elif raw_type == "DIV":
        mapped_type = "dividend"
        transaction_type_raw = "Dividend"
        description = memo.title().replace("Usd", "USD")
    else:
        description = memo
    description = _ii_basics._normalize_ibkr_description(description)
    record = {
        "date": posted_day,
        "datetime": posted_datetime,
        "type": mapped_type,
        "currency": currency,
        "description": description,
        "source": {
            "file_kind": "gainskeeper",
            "source_format": "ofx_gkx",
            "source_filename": filename,
            "file_index": file_index,
            "row_number": row_number,
            "transaction_type_raw": transaction_type_raw,
            "account": account,
            "fitid": _gkx_text(stmt, "FITID"),
            "source_datetime_raw": _gkx_text(stmt, "DTPOSTED"),
            "ofx_trntype": raw_type,
            "memo_raw": memo,
        },
        "gross_amount_raw": _decimal_to_str(amount_dec),
        "net_amount_raw": _decimal_to_str(amount_dec),
        "normalized": _build_normalized_view(
            mapped_type, None, None, amount_dec, None, amount_dec
        ),
    }
    if ticker:
        record["ticker"] = ticker
    return record


def _extract_gkx_position_snapshot(
    root: ET.Element,
    security_map: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    aggregates: dict[str, dict[str, Decimal | str]] = {}
    for node in root.findall(".//POSSTOCK"):
        body = node.find("INVPOS")
        unique_id = _gkx_text(body, "SECID/UNIQUEID")
        ticker = normalize_ticker(security_map.get(unique_id, {}).get("ticker", ""))
        if not ticker:
            continue
        quantity_dec = (
            _ii_hsbc_cash._parse_decimal_text_or_none(_gkx_text(body, "UNITS")) or ZERO
        )
        market_value_dec = (
            _ii_hsbc_cash._parse_decimal_text_or_none(_gkx_text(body, "MKTVAL")) or ZERO
        )
        unit_price_dec = (
            _ii_hsbc_cash._parse_decimal_text_or_none(_gkx_text(body, "UNITPRICE"))
            or ZERO
        )
        entry = aggregates.setdefault(
            ticker,
            {
                "quantity": ZERO,
                "market_value": ZERO,
                "currency": _gkx_text(body, "CURRENCY/CURSYM") or "USD",
                "price": unit_price_dec,
                "as_of": _parse_gkx_datetime(_gkx_text(body, "DTPRICEASOF"))[1],
            },
        )
        entry["quantity"] = Decimal(str(entry["quantity"])) + quantity_dec
        entry["market_value"] = Decimal(str(entry["market_value"])) + market_value_dec
        if unit_price_dec:
            entry["price"] = unit_price_dec
    return {
        ticker: {
            "quantity": _decimal_to_str(Decimal(str(entry["quantity"]))),
            "market_value": _decimal_to_str(Decimal(str(entry["market_value"]))),
            "currency": str(entry.get("currency") or "USD"),
            "last_price": _decimal_to_str(Decimal(str(entry.get("price") or ZERO))),
            "as_of": str(entry.get("as_of") or ""),
        }
        for ticker, entry in aggregates.items()
    }


def _extract_gkx_balances(root: ET.Element) -> dict[str, str]:
    balances: dict[str, str] = {}
    for node in root.findall(".//INVBAL/BALLIST/BAL"):
        name = _normalize_text(_gkx_text(node, "NAME")).lower()
        value = _normalize_text(_gkx_text(node, "VALUE"))
        if name and value:
            balances[name] = value
    return balances


def _gkx_local_tag_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _unsupported_gkx_invtranlist_tags(root: ET.Element) -> dict[str, int]:
    counts: dict[str, int] = {}
    for container in root.findall(".//INVTRANLIST"):
        for child in list(container):
            tag = _gkx_local_tag_name(str(child.tag))
            if tag not in GKX_SUPPORTED_INVTRANLIST_TAGS:
                counts[tag] = counts.get(tag, 0) + 1
    return counts


def _build_ibkr_gainskeeper_source_artifact(
    *,
    payload: bytes,
    filename: str,
    account: str | None,
    root: ET.Element,
) -> dict[str, Any]:
    period_start, _period_start_datetime = _parse_gkx_datetime(
        _gkx_text(root, ".//INVTRANLIST/DTSTART")
    )
    period_end, _period_end_datetime = _parse_gkx_datetime(
        _gkx_text(root, ".//INVTRANLIST/DTEND")
    )
    content_sha256 = hashlib.sha256(payload).hexdigest()
    normalized_filename = (
        _normalize_text(filename) or f"ibkr-gainskeeper-{content_sha256[:12]}.gkx"
    )
    return {
        "evidence_schema_version": "1.0",
        "sha256": content_sha256,
        "byte_count": len(payload),
        "filename": normalized_filename,
        "filenames": [normalized_filename],
        "broker": "ibkr",
        "account": _normalize_text(account),
        "source_kind": "ibkr_gainskeeper_ofx_gkx",
        "bundle_id": content_sha256,
        "bundle_ids": [content_sha256],
        "bundle_role": "gainskeeper",
        "related_sha256": "",
        "statement_title": "GainsKeeper OFX/GKX",
        "statement_period": "",
        "statement_period_start": period_start,
        "statement_period_end": period_end,
        "statement_generated_at": _gkx_text(root, ".//SIGNONMSGSRSV1/SONRS/DTSERVER"),
        "content_encoding": "base64",
        "content_base64": base64.b64encode(payload).decode("ascii"),
    }


def build_investment_payload_from_ibkr_gainskeeper_files(
    files: list[tuple[bytes, str]],
) -> dict[str, Any]:
    if not files:
        raise ValueError("Please upload at least one IBKR GainsKeeper .gkx file.")
    warnings: list[str] = []
    transactions: list[dict[str, Any]] = []
    seen_fitids: set[str] = set()
    seen_transfer_keys: set[str] = set()
    position_snapshot: dict[str, dict[str, str]] = {}
    source_artifacts: list[dict[str, Any]] = []
    account: str | None = None
    ending_cash: str | None = None
    latest_position_as_of = ""
    for file_index, (payload, filename) in enumerate(files, start=1):
        if not payload:
            continue
        root = _parse_ibkr_gainskeeper_xml(payload, filename)
        unsupported_tags = _unsupported_gkx_invtranlist_tags(root)
        if unsupported_tags:
            details = ", ".join(
                f"{tag} x{count}" for tag, count in sorted(unsupported_tags.items())
            )
            raise ValueError(
                f"{filename or 'GainsKeeper file'} contains unsupported GainsKeeper OFX transaction tag(s): {details}. "
                "Import aborted to avoid silently dropping broker activity."
            )
        security_map = _build_gkx_security_map(root)
        file_account = _gkx_text(root, ".//ACCTID")
        if not file_account:
            account_node = root.find(".//INVACCTFROM")
            file_account = _gkx_text(account_node, "ACCTID")
        if (
            account
            and file_account
            and not _ii_basics._accounts_are_compatible("ibkr", account, file_account)
        ):
            raise ValueError(
                "The uploaded GainsKeeper files belong to different IBKR accounts."
            )
        account = file_account or account
        source_artifacts.append(
            _build_ibkr_gainskeeper_source_artifact(
                payload=payload,
                filename=filename,
                account=file_account or account,
                root=root,
            )
        )
        row_number = 0
        for transaction_tag in ("BUYSTOCK", "BUYOTHER"):
            inner_tag = "INVBUY"
            for node in root.findall(f".//{transaction_tag}"):
                row_number += 1
                record = _build_gkx_stock_record(
                    node,
                    inner_tag=inner_tag,
                    gkx_transaction_tag=transaction_tag,
                    mapped_type="buy",
                    file_index=file_index,
                    filename=filename,
                    account=file_account or account,
                    security_map=security_map,
                    row_number=row_number,
                    warnings=warnings,
                )
                if record is not None:
                    fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                    if fitid and fitid in seen_fitids:
                        warnings.append(
                            f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                        )
                        continue
                    if fitid:
                        seen_fitids.add(fitid)
                    transactions.append(record)
        for transaction_tag in ("SELLSTOCK", "SELLOTHER"):
            inner_tag = "INVSELL"
            for node in root.findall(f".//{transaction_tag}"):
                row_number += 1
                record = _build_gkx_stock_record(
                    node,
                    inner_tag=inner_tag,
                    gkx_transaction_tag=transaction_tag,
                    mapped_type="sell",
                    file_index=file_index,
                    filename=filename,
                    account=file_account or account,
                    security_map=security_map,
                    row_number=row_number,
                    warnings=warnings,
                )
                if record is not None:
                    fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                    if fitid and fitid in seen_fitids:
                        warnings.append(
                            f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                        )
                        continue
                    if fitid:
                        seen_fitids.add(fitid)
                    transactions.append(record)
        for node in root.findall(".//INCOME"):
            row_number += 1
            record = _build_gkx_income_record(
                node,
                file_index=file_index,
                filename=filename,
                account=file_account or account,
                security_map=security_map,
                row_number=row_number,
                warnings=warnings,
            )
            if record is not None:
                fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                if fitid and fitid in seen_fitids:
                    warnings.append(
                        f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                    )
                    continue
                if fitid:
                    seen_fitids.add(fitid)
                transactions.append(record)
        for node in root.findall(".//INVEXPENSE"):
            row_number += 1
            record = _build_gkx_expense_record(
                node,
                file_index=file_index,
                filename=filename,
                account=file_account or account,
                security_map=security_map,
                row_number=row_number,
                warnings=warnings,
            )
            if record is not None:
                fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                if fitid and fitid in seen_fitids:
                    warnings.append(
                        f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                    )
                    continue
                if fitid:
                    seen_fitids.add(fitid)
                transactions.append(record)
        for node in root.findall(".//INVBANKTRAN"):
            row_number += 1
            record = _build_gkx_bank_record(
                node,
                file_index=file_index,
                filename=filename,
                account=file_account or account,
                security_map=security_map,
                row_number=row_number,
                warnings=warnings,
            )
            if record is not None:
                fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                if fitid and fitid in seen_fitids:
                    warnings.append(
                        f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                    )
                    continue
                if fitid:
                    seen_fitids.add(fitid)
                transactions.append(record)
        report_currency = _gkx_text(root, ".//CURDEF") or "USD"
        for node in root.findall(".//TRANSFER"):
            row_number += 1
            record = _build_gkx_transfer_record(
                node,
                file_index=file_index,
                filename=filename,
                account=file_account or account,
                report_currency=report_currency,
                security_map=security_map,
                row_number=row_number,
                warnings=warnings,
            )
            if record is not None:
                fitid = _normalize_text((record.get("source") or {}).get("fitid"))
                transfer_dedupe_key = (
                    "|".join(
                        (
                            fitid,
                            _normalize_text(record.get("date")),
                            normalize_ticker(_normalize_text(record.get("ticker"))),
                            _normalize_text(record.get("quantity_raw")),
                            _normalize_text(record.get("type")),
                        )
                    )
                    if fitid
                    else ""
                )
                if transfer_dedupe_key and transfer_dedupe_key in seen_transfer_keys:
                    warnings.append(
                        f"{filename}: skipped duplicate GainsKeeper FITID {fitid} from overlapping files."
                    )
                    continue
                if transfer_dedupe_key:
                    seen_transfer_keys.add(transfer_dedupe_key)
                transactions.append(record)
        candidate_snapshot = _extract_gkx_position_snapshot(root, security_map)
        candidate_as_of = max(
            (str(item.get("as_of") or "") for item in candidate_snapshot.values()),
            default="",
        )
        if candidate_snapshot and candidate_as_of >= latest_position_as_of:
            latest_position_as_of = candidate_as_of
            position_snapshot = candidate_snapshot
        balances = _extract_gkx_balances(root)
        if balances.get("cash") is not None:
            ending_cash = balances.get("cash")
    _ii_records._sort_transactions(transactions)
    holdings_mismatches = _ii_records._validate_holdings(
        transactions, position_snapshot
    )
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "ibkr_gainskeeper_ofx_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
        },
        "broker": "ibkr",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Trade/post date from GainsKeeper OFX",
            "datetime_field_meaning": "Intraday DTTRADE when present; posted accounting time for cash rows",
            "timezone": "America/New_York",
            "source_has_intraday_timestamp": True,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots=position_snapshot,
            performance_snapshots={},
            starting_cash=None,
            ending_cash=ending_cash,
        ),
        "starting_cash": None,
        "ending_cash": ending_cash,
        "position_snapshot": position_snapshot,
        "performance_snapshot": {},
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    for transaction in payload["transactions"]:
        transaction["broker"] = "ibkr"
        transaction["account"] = account
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "ibkr"
            source["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    payload["summary"]["position_snapshot_authoritative"] = bool(position_snapshot)
    if position_snapshot:
        payload["summary"]["position_snapshot_source"] = "ibkr_gainskeeper_positions"
    if ending_cash is not None:
        period_starts = [
            _normalize_text(artifact.get("statement_period_start"))
            for artifact in source_artifacts
            if _normalize_text(artifact.get("statement_period_start"))
        ]
        period_ends = [
            _normalize_text(artifact.get("statement_period_end"))
            for artifact in source_artifacts
            if _normalize_text(artifact.get("statement_period_end"))
        ]
        cash_snapshot_dates = _ii_records._ibkr_cash_snapshot_dates(
            transactions,
            period_start=min(period_starts, default=""),
            period_end=max(period_ends, default=""),
        )
        latest_intraday_datetime = (
            _ii_records._ibkr_latest_intraday_transaction_datetime(
                transactions,
                as_of_date=max(period_ends, default=""),
            )
        )
        if latest_intraday_datetime:
            cash_snapshot_dates.update(
                {
                    "ending_cash_as_of_datetime": latest_intraday_datetime,
                    "ending_cash_replay_as_of_datetime": latest_intraday_datetime,
                }
            )
        payload["summary"].update(
            {
                "cash_snapshot_source": IBKR_GAINSKEEPER_CASH_SNAPSHOT_SOURCE,
                "cash_snapshot_authoritative": True,
                **cash_snapshot_dates,
            }
        )
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["gainskeeper_file_count"] = len(files)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload
