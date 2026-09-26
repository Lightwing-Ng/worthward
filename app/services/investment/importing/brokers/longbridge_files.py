"""Investment import domain: longbridge files.

Code version: v0.1.1
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    BadZipFile,
    BrokerSettings,
    BytesIO,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    InvalidOperation,
    LONGBRIDGE_HK_DIVIDEND_WITHHOLDING_FLOW_NAMES,
    LONGBRIDGE_HK_EMBEDDED_MARKET_SYMBOL_PATTERN,
    LONGBRIDGE_HK_FEE_FLOW_NAMES,
    LONGBRIDGE_HK_IMPORTER_VERSION,
    LONGBRIDGE_HK_ISIN_DESCRIPTION_SYMBOL_PATTERN,
    LONGBRIDGE_HK_MMF_SHARES_PATTERN,
    LONGBRIDGE_HK_WITHHOLDING_SYMBOL_PATTERN,
    LONGBRIDGE_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_MARKET_TIMEZONES,
    LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_SG_EASTERN_TIME_SUFFIX_PATTERN,
    LONGBRIDGE_SG_FLAT_HOLDING_TICKERS,
    LONGBRIDGE_SG_FUND_AMOUNT_PATTERN,
    LONGBRIDGE_SG_FUND_DATE_PATTERN,
    LONGBRIDGE_SG_FUND_SHARES_PATTERN,
    LONGBRIDGE_SG_FUND_SKIP_LINES,
    LONGBRIDGE_SG_FUND_TICKER_PATTERN,
    LONGBRIDGE_SG_IMPORTER_VERSION,
    LONGBRIDGE_SG_MONTH_HEADER_PATTERN,
    LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE,
    LONGBRIDGE_US_MARKET_TIMEZONE,
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES,
    ROUND_HALF_UP,
    SCHEMA_VERSION,
    ZERO,
    ZipFile,
    ZoneInfo,
    _LONGBRIDGE_HISTORY_LOG_REQUIRED_COLUMNS,
    _LONGBRIDGE_HISTORY_ORDERS_REQUIRED_COLUMNS,
    _LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_NAMES,
    _LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_PREFIXES,
    _LONGBRIDGE_HISTORY_XLSX_MAX_ARCHIVE_ENTRIES,
    _LONGBRIDGE_HISTORY_XLSX_MAX_UNCOMPRESSED_BYTES,
    _LONGBRIDGE_HISTORY_XLSX_REQUIRED_MEMBERS,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    base64,
    canonicalize_investment_ticker,
    date,
    datetime,
    hashlib,
    json,
    normalize_ticker,
    re,
    timedelta,
    timezone,
    uses_longbridge_cli_oauth,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.bindings as _ii_bindings

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries

import app.services.investment.importing.records as _ii_records

from app.services.investment.importing import compat as _investment_import_compat


def build_investment_payload_from_longbridge(
    settings: BrokerSettings,
    *,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    if not uses_longbridge_cli_oauth(settings):
        raise ValueError(
            "Longbridge investment import currently uses the configured CLI OAuth session. "
            "Switch Broker Access to CLI OAuth first."
        )

    start_day = _ii_basics._parse_longbridge_date(start_date, "Longbridge start date")
    end_day = _ii_basics._parse_longbridge_date(end_date, "Longbridge end date")
    if start_day > end_day:
        raise ValueError("Longbridge start date must be on or before the end date.")
    if (end_day - start_day) > timedelta(days=3660):
        raise ValueError(
            "Longbridge import range is too large. Keep the date span within 3,660 days."
        )

    unknown_types: set[str] = set()
    cli_warnings: list[str] = []
    history_order_rows, history_order_window_count = (
        _ii_basics._fetch_longbridge_history_order_rows(
            settings,
            start_day,
            end_day,
        )
    )
    order_metadata_by_id = _ii_basics._build_longbridge_order_metadata_map(
        history_order_rows
    )
    execution_start_day = start_day - timedelta(days=1)
    execution_end_day = end_day + timedelta(days=1)
    execution_rows, execution_window_count = (
        _ii_basics._fetch_longbridge_cli_rows_windowed(
            settings,
            ["order", "executions", "--history"],
            ("executions", "list"),
            execution_start_day,
            execution_end_day,
            timeout_seconds=45,
            window_days=LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
        )
    )
    execution_records = _ii_basics._build_longbridge_execution_records(
        execution_rows if isinstance(execution_rows, list) else [],
        order_metadata_by_id,
        cli_warnings,
        unknown_types,
    )
    order_records = _ii_basics._build_longbridge_order_records(
        history_order_rows,
        execution_rows,
        cli_warnings,
        start_day=start_day,
        end_day=end_day,
    )

    cash_flow_start_day = start_day - timedelta(days=1)
    cash_flow_end_day = end_day + timedelta(days=1)
    cash_flow_rows, cash_flow_window_count = (
        _ii_basics._fetch_longbridge_cli_rows_windowed(
            settings,
            ["cash-flow"],
            ("list",),
            cash_flow_start_day,
            cash_flow_end_day,
            timeout_seconds=45,
        )
    )

    auth_status = _investment_import_compat.get_longbridge_cli_auth_status(settings)
    account_payload = (
        auth_status.get("account") if isinstance(auth_status, dict) else {}
    )
    member_id = (
        _normalize_text(account_payload.get("member_id"))
        if isinstance(account_payload, dict)
        else ""
    )
    account_channel = (
        _normalize_text(account_payload.get("account_channel"))
        if isinstance(account_payload, dict)
        else ""
    )
    account = member_id or account_channel or "longbridge-cli-oauth"
    snapshot_warnings: list[str] = []
    position_snapshot, position_snapshot_authoritative = (
        _ii_basics._build_longbridge_position_snapshot(
            settings,
            snapshot_warnings,
        )
    )
    transactions, holdings_mismatches, matched_cash_flow_row_count = (
        _ii_basics._build_longbridge_transactions_from_order_records(
            order_records,
            cash_flow_rows,
            position_snapshot,
            cli_warnings,
        )
    )
    warnings = cli_warnings
    warnings.extend(snapshot_warnings)

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "longbridge_cli_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "import_window_days": LONGBRIDGE_IMPORT_WINDOW_DAYS,
            "order_import_window_days": LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
            "history_order_window_count": history_order_window_count,
            "execution_window_count": execution_window_count,
            "cash_flow_window_count": cash_flow_window_count,
            "order_source": "longbridge_history_orders",
            "matched_cash_flow_row_count": matched_cash_flow_row_count,
            "order_record_count": len(order_records),
            "execution_record_count": len(execution_records),
            "order_metadata_count": len(order_metadata_by_id),
        },
        "broker": "longbridge_hk",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": (
                "Trading date derived from Longbridge execution timestamps in exchange-local time when available; "
                "cash-flow date derived from Longbridge CLI cash-flow timestamps"
            ),
            "datetime_field_meaning": "UTC datetime parsed from Longbridge CLI execution, order, and cash-flow records",
            "timezone": "UTC; US order dates use America/New_York",
            "source_has_intraday_timestamp": True,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=sorted(unknown_types),
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots=position_snapshot,
            performance_snapshots={},
            starting_cash=None,
            ending_cash=None,
        ),
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": position_snapshot,
        "performance_snapshot": {},
        "transactions": transactions,
    }
    payload["summary"]["position_snapshot_authoritative"] = (
        position_snapshot_authoritative
    )
    if position_snapshot_authoritative:
        payload["summary"]["position_snapshot_source"] = "longbridge_positions_cli"
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "longbridge_hk"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "longbridge_hk"
            source["account"] = account
        transaction["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _infer_longbridge_sg_market_from_symbol(symbol: str, *, currency: str = "") -> str:
    normalized_symbol = normalize_ticker(_normalize_text(symbol))
    if "." in normalized_symbol:
        return normalized_symbol.rsplit(".", 1)[-1].upper()
    normalized_currency = _normalize_text(currency).upper()
    if normalized_currency == "HKD":
        return "HK"
    if normalized_currency == "SGD":
        return "SG"
    return "US"


def _longbridge_sg_market_timezone(market: str) -> ZoneInfo:
    return LONGBRIDGE_MARKET_TIMEZONES.get(
        _normalize_text(market).upper(),
        LONGBRIDGE_US_MARKET_TIMEZONE,
    )


def _parse_longbridge_sg_eastern_datetime(
    value: object,
    *,
    market: str = "US",
) -> datetime | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    normalized = LONGBRIDGE_SG_EASTERN_TIME_SUFFIX_PATTERN.sub("", normalized).strip()
    if not normalized:
        return None

    market_timezone = _longbridge_sg_market_timezone(market)
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            parsed_naive = datetime.strptime(normalized, pattern)
            localized = parsed_naive.replace(tzinfo=market_timezone)
            return localized.astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _longbridge_sg_booking_datetime_to_utc_string(
    booking_date: str,
    *,
    market: str = "US",
) -> str:
    normalized_date = _normalize_text(booking_date)
    if not normalized_date:
        return ""
    market_timezone = _longbridge_sg_market_timezone(market)
    localized = datetime.strptime(
        f"{normalized_date} {DEFAULT_CONVENTION_TIME}",
        "%Y-%m-%d %H:%M:%S",
    ).replace(tzinfo=market_timezone)
    return localized.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _build_replayed_open_position_snapshot(
    transactions: list[dict[str, Any]],
) -> dict[str, dict[str, str]]:
    snapshots: dict[str, dict[str, str]] = {}
    for symbol, quantity_dec in _ii_records._replay_holdings(transactions).items():
        if quantity_dec == ZERO:
            continue
        snapshots[symbol] = {
            "asset_category": "Stock",
            "currency": _ii_basics._infer_longbridge_order_currency({}, symbol) or "",
            "quantity": _decimal_to_str(quantity_dec) or "0",
            "cost_price": "0",
            "cost_basis": "0",
        }
    return snapshots


def _collect_longbridge_sg_replayed_holding_warnings(
    transactions: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Decimal]:
    replayed = _ii_records._replay_holdings(transactions)
    flat_set = {normalize_ticker(s) for s in LONGBRIDGE_SG_FLAT_HOLDING_TICKERS}
    for symbol in flat_set:
        quantity_dec = replayed.get(symbol, ZERO)
        if quantity_dec != ZERO:
            warnings.append(
                "Longbridge (SG) replayed holdings for "
                f"{symbol} are {_decimal_to_str(quantity_dec)}; expected 0."
            )
    for symbol, quantity_dec in sorted(replayed.items()):
        if normalize_ticker(symbol) in flat_set:
            continue
        warnings.append(
            "Longbridge (SG) replayed holdings for "
            f"{symbol} are {_decimal_to_str(quantity_dec)}."
        )
    return replayed


def _infer_longbridge_sg_account_id(
    fund_details_text: str,
    *,
    fund_details_filename: str = "",
    history_orders_filename: str = "",
) -> str:
    for candidate in (fund_details_filename, history_orders_filename):
        match = re.search(r"(SG\d{6,})", _normalize_text(candidate), re.IGNORECASE)
        if match is not None:
            return match.group(1).upper()
    match = re.search(r"(SG\d{6,})", fund_details_text, re.IGNORECASE)
    if match is not None:
        return match.group(1).upper()
    return "longbridge-sg"


def _parse_longbridge_sg_fund_details_entries(
    fund_details_text: str,
) -> list[dict[str, Any]]:
    lines = [_normalize_text(line) for line in fund_details_text.splitlines()]
    entries: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if (
            not line
            or line in LONGBRIDGE_SG_FUND_SKIP_LINES
            or LONGBRIDGE_SG_MONTH_HEADER_PATTERN.fullmatch(line)
        ):
            index += 1
            continue
        if index + 2 >= len(lines):
            index += 1
            continue

        flow_name = line
        amount_match = LONGBRIDGE_SG_FUND_AMOUNT_PATTERN.fullmatch(lines[index + 1])
        date_line = lines[index + 2]
        if amount_match is None or not LONGBRIDGE_SG_FUND_DATE_PATTERN.fullmatch(
            date_line
        ):
            index += 1
            continue

        amount_dec = _parse_decimal(
            amount_match.group(1), "fund_details.amount", index + 2, []
        )
        if amount_dec is None:
            index += 1
            continue
        currency = amount_match.group(2).upper()
        date_text = datetime.strptime(date_line, "%Y.%m.%d").date().isoformat()

        extras: list[str] = []
        cursor = index + 3
        while cursor < len(lines):
            extra = lines[cursor]
            if not extra:
                cursor += 1
                continue
            if LONGBRIDGE_SG_MONTH_HEADER_PATTERN.fullmatch(extra):
                break
            if (
                cursor + 2 < len(lines)
                and LONGBRIDGE_SG_FUND_AMOUNT_PATTERN.fullmatch(lines[cursor + 1])
                and LONGBRIDGE_SG_FUND_DATE_PATTERN.fullmatch(lines[cursor + 2])
            ):
                break
            extras.append(extra)
            cursor += 1

        symbol = ""
        description_parts: list[str] = []
        shares_dec = None
        for extra in extras:
            if LONGBRIDGE_SG_FUND_TICKER_PATTERN.fullmatch(extra):
                symbol = normalize_ticker(extra.upper())
            elif LONGBRIDGE_SG_FUND_SHARES_PATTERN.fullmatch(extra):
                description_parts.append(extra)
                m = re.search(r"(-?\d+)", extra)
                if m:
                    try:
                        shares_dec = Decimal(m.group(1))
                    except (InvalidOperation, ValueError):
                        pass
            else:
                description_parts.append(extra)

        description = _normalize_whitespace(" ".join(description_parts)) or flow_name
        entries.append(
            {
                "flow_name": flow_name,
                "description": description,
                "balance": amount_dec,
                "currency": currency,
                "time": date_text,
                "symbol": symbol,
                "shares": _decimal_to_str(shares_dec)
                if shares_dec is not None
                else None,
                "row_number": len(entries) + 1,
            }
        )
        index = cursor
    return entries


def _longbridge_sg_fund_entry_to_cash_flow_row(entry: dict[str, Any]) -> dict[str, Any]:
    booking_date = _normalize_text(entry.get("time"))
    description = _normalize_text(entry.get("description"))
    symbol = normalize_ticker(_normalize_text(entry.get("symbol")))
    source_symbol_raw = _normalize_text(entry.get("symbol"))
    if not symbol:
        symbol, source_symbol_raw = _extract_longbridge_symbol_from_description(
            description
        )
    market = _infer_longbridge_sg_market_from_symbol(
        symbol,
        currency=_normalize_text(entry.get("currency")),
    )
    booking_datetime = _longbridge_sg_booking_datetime_to_utc_string(
        booking_date,
        market=market,
    )
    row = {
        "flow_name": entry.get("flow_name"),
        "description": description,
        "balance": entry.get("balance"),
        "currency": entry.get("currency"),
        "time": booking_datetime,
        "symbol": symbol,
        "shares": entry.get("shares"),
        "business_time": booking_datetime,
        "booking_date": booking_date,
        "authoritative_booking_date": True,
        "fund_details_entry_number": entry.get("row_number"),
        "source_symbol_raw": source_symbol_raw,
    }
    if symbol and not _normalize_text(entry.get("symbol")):
        row["symbol_inference"] = "fund details description"
    if _is_longbridge_broker_pnl_excluded_flow(
        entry.get("flow_name"),
        description,
    ):
        row["excluded_from_broker_pnl"] = True
    return row


def _normalize_spreadsheet_column_name(value: Any) -> str:
    return " ".join(str(value or "").replace("\ufeff", "").split()).casefold()


def _validate_longbridge_history_orders_archive(xlsx_bytes: bytes) -> None:
    if len(xlsx_bytes) > MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES:
        raise ValueError(
            "The Longbridge History Orders XLSX exceeds the 64 MiB per-file limit."
        )
    try:
        with ZipFile(BytesIO(xlsx_bytes)) as archive:
            members = archive.infolist()
            names = {member.filename for member in members}
            if not _LONGBRIDGE_HISTORY_XLSX_REQUIRED_MEMBERS.issubset(names):
                raise ValueError(
                    "The Longbridge History Orders file is missing required XLSX components."
                )
            if len(members) > _LONGBRIDGE_HISTORY_XLSX_MAX_ARCHIVE_ENTRIES:
                raise ValueError(
                    "The Longbridge History Orders XLSX contains too many archive entries."
                )
            uncompressed_total = 0
            for member in members:
                normalized_name = member.filename.replace("\\", "/")
                if (
                    normalized_name.startswith("/")
                    or ".." in normalized_name.split("/")
                    or member.flag_bits & 0x1
                ):
                    raise ValueError(
                        "The Longbridge History Orders XLSX contains an unsafe archive entry."
                    )
                if (
                    normalized_name in _LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_NAMES
                    or normalized_name.startswith(
                        _LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_PREFIXES
                    )
                ):
                    raise ValueError(
                        "The Longbridge History Orders XLSX must not contain macros, "
                        "embedded objects, data connections, or external workbook links."
                    )
                uncompressed_total += member.file_size
                if uncompressed_total > _LONGBRIDGE_HISTORY_XLSX_MAX_UNCOMPRESSED_BYTES:
                    raise ValueError(
                        "The Longbridge History Orders XLSX expands beyond the safe parsing limit."
                    )
                if (
                    member.file_size > 1024 * 1024
                    and member.file_size / max(member.compress_size, 1) > 200
                ):
                    raise ValueError(
                        "The Longbridge History Orders XLSX contains a suspiciously compressed archive entry."
                    )
    except BadZipFile as exc:
        raise ValueError(
            "The Longbridge History Orders file is not a readable XLSX file."
        ) from exc


def _validate_longbridge_history_sheet_columns(
    frame: Any,
    *,
    sheet_name: str,
    required_columns: frozenset[str],
) -> None:
    available_columns = {
        _normalize_spreadsheet_column_name(column)
        for column in getattr(frame, "columns", [])
    }
    missing_columns = sorted(required_columns.difference(available_columns))
    if missing_columns:
        raise ValueError(
            f'Longbridge History Orders sheet "{sheet_name}" is missing required '
            "columns: "
            + ", ".join(missing_columns)
            + ". Download a fresh History Orders export."
        )


def _record_longbridge_history_order_skip(
    workbook_metadata: dict[str, int] | None,
    reason: str,
) -> None:
    if workbook_metadata is None:
        return
    metadata_key = f"skipped_orders_{reason}_count"
    workbook_metadata[metadata_key] = workbook_metadata.get(metadata_key, 0) + 1


def _append_longbridge_history_order_warnings(
    workbook_metadata: dict[str, int],
    warnings: list[str],
    *,
    broker_label: str,
) -> None:
    for reason, label in (
        ("missing_symbol", "missing Symbol"),
        ("missing_time", "missing executable time"),
    ):
        count = workbook_metadata.get(f"skipped_orders_{reason}_count", 0)
        if count:
            warnings.append(
                f"{broker_label} History Orders skipped {count} filled row(s) with {label}."
            )


def _parse_longbridge_sg_history_orders_xlsx(
    history_orders_bytes: bytes,
    *,
    accepted_order_statuses: frozenset[str] = frozenset({"filled"}),
    accepted_log_statuses: frozenset[str] = frozenset({"filled"}),
    workbook_metadata: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError(
            "pandas is required to parse Longbridge (SG) history order spreadsheets."
        ) from exc

    if not history_orders_bytes:
        raise ValueError("Longbridge History Orders spreadsheet is empty.")
    _validate_longbridge_history_orders_archive(history_orders_bytes)
    workbook = pd.read_excel(BytesIO(history_orders_bytes), sheet_name=None)
    orders_frame = workbook.get("Orders")
    if orders_frame is None:
        raise ValueError(
            'Longbridge (SG) history orders spreadsheet is missing the required "Orders" sheet.'
        )
    _validate_longbridge_history_sheet_columns(
        orders_frame,
        sheet_name="Orders",
        required_columns=_LONGBRIDGE_HISTORY_ORDERS_REQUIRED_COLUMNS,
    )

    trade_log_frame = workbook.get("Trade Log")
    if trade_log_frame is None:
        trade_log_frame = workbook.get("Logs")
    if trade_log_frame is not None:
        log_sheet_name = "Trade Log" if "Trade Log" in workbook else "Logs"
        _validate_longbridge_history_sheet_columns(
            trade_log_frame,
            sheet_name=log_sheet_name,
            required_columns=_LONGBRIDGE_HISTORY_LOG_REQUIRED_COLUMNS,
        )
    if workbook_metadata is not None:
        workbook_metadata["orders_sheet_row_count"] = len(orders_frame)
        workbook_metadata["logs_sheet_row_count"] = (
            len(trade_log_frame) if trade_log_frame is not None else 0
        )
    filled_times_by_order_id: dict[str, datetime] = {}
    if trade_log_frame is not None:
        for _, trade_row in trade_log_frame.iterrows():
            status = _normalize_text(trade_row.get("Order Status")).lower()
            if status not in accepted_log_statuses:
                continue
            order_id = _normalize_text(trade_row.get("Order No."))
            if not order_id:
                continue
            market = _normalize_text(trade_row.get("Market")).upper() or "US"
            parsed_time = _parse_longbridge_sg_eastern_datetime(
                trade_row.get("Time"),
                market=market,
            )
            if parsed_time is None:
                continue
            existing_time = filled_times_by_order_id.get(order_id)
            if existing_time is None or parsed_time > existing_time:
                filled_times_by_order_id[order_id] = parsed_time

    rows: list[dict[str, Any]] = []
    for row_number, order_row in enumerate(
        orders_frame.to_dict(orient="records"), start=1
    ):
        status = _normalize_text(order_row.get("Order Status"))
        if status.lower() not in accepted_order_statuses:
            continue
        market = _normalize_text(order_row.get("Market")).upper() or "US"
        symbol = _normalize_text(order_row.get("Symbol")).upper()
        if not symbol:
            _record_longbridge_history_order_skip(workbook_metadata, "missing_symbol")
            continue
        full_symbol = f"{symbol}.{market}" if market else symbol
        order_id = _normalize_text(order_row.get("Order No."))
        filled_time = filled_times_by_order_id.get(order_id)
        if filled_time is None:
            filled_time = _parse_longbridge_sg_eastern_datetime(
                order_row.get("Order Time"),
                market=market,
            )
        utc_time_text = (
            filled_time.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            if isinstance(filled_time, datetime)
            else ""
        )
        if not utc_time_text:
            _record_longbridge_history_order_skip(workbook_metadata, "missing_time")
            continue
        rows.append(
            {
                "_row_number": row_number,
                "status": status,
                "side": _normalize_text(order_row.get("Direction")),
                "order_id": order_id,
                "executed_quantity": order_row.get("Executed Qty"),
                "executed_price": order_row.get("Avg Price"),
                "price": order_row.get("Avg Price"),
                "quantity": order_row.get("Executed Qty"),
                "symbol": full_symbol,
                "stock_name": order_row.get("Stock Name"),
                "currency": order_row.get("Currency"),
                "time": utc_time_text,
                "_parsed_time_utc": filled_time,
            }
        )
    return rows


def _build_longbridge_sg_order_records(
    history_order_rows: list[dict[str, Any]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    order_records: list[dict[str, Any]] = []
    for row in history_order_rows:
        if not isinstance(row, dict):
            continue
        row_number = int(row.get("_row_number") or 0)
        record = _ii_basics._build_longbridge_history_order_record(
            row, row_number, warnings
        )
        if record is None:
            continue
        source = record.get("source")
        if isinstance(source, dict):
            source["file_kind"] = "longbridge_sg_history_orders_xlsx"
        order_records.append(record)
    return order_records


def _build_longbridge_paired_file_source_artifacts(
    *,
    broker: str,
    account: str,
    fund_details_bytes: bytes,
    history_orders_xlsx_bytes: bytes,
    fund_details_filename: str,
    history_orders_filename: str,
    statement_period_start: str,
    statement_period_end: str,
) -> list[dict[str, Any]]:
    """Build immutable evidence manifests for one Longbridge paired-file import."""
    normalized_broker = _ii_basics._normalize_broker_code(broker)
    if normalized_broker not in {"longbridge_hk", "longbridge_sg"}:
        raise ValueError(
            "Longbridge paired-file evidence requires a Longbridge account."
        )
    if len(fund_details_bytes) > MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES:
        raise ValueError(
            "The Longbridge Fund Details text file exceeds the 64 MiB per-file limit."
        )
    if len(history_orders_xlsx_bytes) > MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES:
        raise ValueError(
            "The Longbridge History Orders XLSX exceeds the 64 MiB per-file limit."
        )

    fund_details_sha256 = hashlib.sha256(fund_details_bytes).hexdigest()
    history_orders_sha256 = hashlib.sha256(history_orders_xlsx_bytes).hexdigest()
    bundle_id = hashlib.sha256(
        "|".join(sorted((fund_details_sha256, history_orders_sha256))).encode("ascii")
    ).hexdigest()
    broker_label = (
        "Longbridge (HK)" if normalized_broker == "longbridge_hk" else "Longbridge (SG)"
    )
    normalized_fund_details_filename = (
        _normalize_text(fund_details_filename)
        or f"{normalized_broker}-fund-details.txt"
    )
    normalized_history_orders_filename = (
        _normalize_text(history_orders_filename)
        or f"{normalized_broker}-history-orders.xlsx"
    )
    period_start = _normalize_text(statement_period_start)
    period_end = _normalize_text(statement_period_end)
    statement_period = (
        f"{period_start}/{period_end}"
        if period_start and period_end
        else period_start or period_end
    )
    common = {
        "evidence_schema_version": "1.0",
        "broker": normalized_broker,
        "account": _normalize_text(account),
        "bundle_id": bundle_id,
        "bundle_ids": [bundle_id],
        "statement_period": statement_period,
        "statement_period_start": period_start,
        "statement_period_end": period_end,
        "statement_generated_at": "",
        "content_encoding": "base64",
    }
    return [
        {
            **common,
            "sha256": fund_details_sha256,
            "byte_count": len(fund_details_bytes),
            "filename": normalized_fund_details_filename,
            "filenames": [normalized_fund_details_filename],
            "source_kind": f"{normalized_broker}_fund_details_text",
            "bundle_role": "fund_details",
            "related_sha256": history_orders_sha256,
            "statement_title": f"{broker_label} Fund Details",
            "content_base64": base64.b64encode(fund_details_bytes).decode("ascii"),
        },
        {
            **common,
            "sha256": history_orders_sha256,
            "byte_count": len(history_orders_xlsx_bytes),
            "filename": normalized_history_orders_filename,
            "filenames": [normalized_history_orders_filename],
            "source_kind": f"{normalized_broker}_history_orders_xlsx",
            "bundle_role": "history_orders",
            "related_sha256": fund_details_sha256,
            "statement_title": f"{broker_label} History Orders",
            "content_base64": base64.b64encode(history_orders_xlsx_bytes).decode(
                "ascii"
            ),
        },
    ]


def build_investment_payload_from_longbridge_sg_files(
    *,
    fund_details_text: str,
    history_orders_xlsx_bytes: bytes,
    fund_details_filename: str = "",
    history_orders_filename: str = "",
    fund_details_bytes: bytes | None = None,
) -> dict[str, Any]:
    raw_fund_details_text = str(fund_details_text or "")
    raw_fund_details_bytes = (
        bytes(fund_details_bytes)
        if isinstance(fund_details_bytes, (bytes, bytearray))
        else raw_fund_details_text.encode("utf-8")
    )
    fund_details_text = raw_fund_details_text.strip()
    if not fund_details_text:
        raise ValueError("Longbridge (SG) Fund Details text is required.")
    if not history_orders_xlsx_bytes:
        raise ValueError("Longbridge (SG) History Orders spreadsheet is required.")

    warnings: list[str] = []
    unknown_types: set[str] = set()
    account = _infer_longbridge_sg_account_id(
        fund_details_text,
        fund_details_filename=fund_details_filename,
        history_orders_filename=history_orders_filename,
    )

    fund_entries = _parse_longbridge_sg_fund_details_entries(fund_details_text)
    if not fund_entries:
        raise ValueError(
            "Longbridge (SG) Fund Details text did not contain any recognizable cash-flow entries."
        )

    cash_flow_rows = [
        _longbridge_sg_fund_entry_to_cash_flow_row(entry) for entry in fund_entries
    ]
    workbook_metadata: dict[str, int] = {}
    history_order_rows = _parse_longbridge_sg_history_orders_xlsx(
        history_orders_xlsx_bytes,
        workbook_metadata=workbook_metadata,
    )
    if not history_order_rows:
        raise ValueError(
            'Longbridge (SG) History Orders spreadsheet did not contain any filled "Orders" rows.'
        )
    _append_longbridge_history_order_warnings(
        workbook_metadata,
        warnings,
        broker_label="Longbridge (SG)",
    )

    order_records = _build_longbridge_sg_order_records(history_order_rows, warnings)
    transactions, holdings_mismatches, matched_cash_flow_row_count = (
        _ii_basics._build_longbridge_transactions_from_order_records(
            order_records,
            cash_flow_rows,
            {},
            warnings,
        )
    )
    booking_date_applied_order_count = (
        _ii_basics._apply_longbridge_fund_details_booking_dates(
            transactions,
            cash_flow_rows,
            warnings,
        )
    )
    _ii_records._sort_transactions(transactions)
    replayed_holdings = _collect_longbridge_sg_replayed_holding_warnings(
        transactions, warnings
    )
    position_snapshot = _build_replayed_open_position_snapshot(transactions)
    if not holdings_mismatches:
        holdings_mismatches = _ii_records._validate_holdings(
            transactions, position_snapshot
        )
    cash_reconciliation = _summarize_longbridge_cash_reconciliation(transactions)
    accounted_fund_entry_numbers = _collect_longbridge_accounted_fund_entry_numbers(
        transactions
    )
    unaccounted_fund_entry_count = max(
        0,
        len(fund_entries) - len(accounted_fund_entry_numbers),
    )
    performance_calibrations = (
        _ii_basics._build_broker_reported_performance_calibrations(
            "longbridge_sg",
            account,
        )
    )
    source_artifacts = _build_longbridge_paired_file_source_artifacts(
        broker="longbridge_sg",
        account=account,
        fund_details_bytes=raw_fund_details_bytes,
        history_orders_xlsx_bytes=history_orders_xlsx_bytes,
        fund_details_filename=fund_details_filename,
        history_orders_filename=history_orders_filename,
        statement_period_start=min(
            (_normalize_text(entry.get("time")) for entry in fund_entries),
            default="",
        ),
        statement_period_end=max(
            (_normalize_text(entry.get("time")) for entry in fund_entries),
            default="",
        ),
    )
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "longbridge_sg_files_to_investment_json",
            "version": LONGBRIDGE_SG_IMPORTER_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "order_source": "longbridge_sg_history_orders_xlsx",
            "fund_details_entry_count": len(fund_entries),
            "accounted_fund_details_entry_count": len(accounted_fund_entry_numbers),
            "unaccounted_fund_details_entry_count": unaccounted_fund_entry_count,
            "history_order_row_count": len(history_order_rows),
            "order_record_count": len(order_records),
            "matched_cash_flow_row_count": matched_cash_flow_row_count,
            "history_orders_skipped_missing_symbol_count": workbook_metadata.get(
                "skipped_orders_missing_symbol_count", 0
            ),
            "history_orders_skipped_missing_time_count": workbook_metadata.get(
                "skipped_orders_missing_time_count", 0
            ),
            "booking_date_applied_order_count": booking_date_applied_order_count,
            "replayed_holdings": {
                symbol: _decimal_to_str(quantity_dec) or "0"
                for symbol, quantity_dec in sorted(replayed_holdings.items())
            },
        },
        "broker": "longbridge_sg",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": (
                "Fund Details booking date for authoritative contract and cash-flow records"
            ),
            "datetime_field_meaning": (
                "Fund Details booking date at the conventional exchange close; History Orders execution "
                "timestamps remain available in transaction source metadata"
            ),
            "timezone": "Fund Details booking date; History Orders metadata uses UTC",
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=sorted(unknown_types),
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots={},
            performance_snapshots=performance_calibrations,
            starting_cash=None,
            ending_cash=None,
        ),
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": position_snapshot,
        "performance_snapshot": performance_calibrations,
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    payload["summary"]["cash_reconciliation"] = cash_reconciliation
    payload["summary"]["cash_reconciliation_matched"] = all(
        currency_summary.get("status") == "within_source_rounding_tolerance"
        for currency_summary in cash_reconciliation.values()
    )
    payload["summary"]["position_snapshot_authoritative"] = False
    payload["summary"]["cash_snapshot_authoritative"] = False
    payload["summary"]["performance_snapshot_authoritative"] = bool(
        payload["performance_snapshot"]
    )
    if payload["performance_snapshot"]:
        payload["summary"]["performance_snapshot_source"] = (
            LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
        )
    if position_snapshot:
        payload["summary"]["position_snapshot_source"] = (
            "longbridge_sg_replayed_holdings"
        )
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "longbridge_sg"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "longbridge_sg"
            source["account"] = account
        transaction["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _infer_longbridge_hk_account_id(
    fund_details_text: str,
    *,
    fund_details_filename: str = "",
    history_orders_filename: str = "",
) -> str:
    for candidate in (fund_details_filename, history_orders_filename):
        match = re.search(r"(H\d{6,})", _normalize_text(candidate), re.IGNORECASE)
        if match is not None:
            return match.group(1).upper()
    match = re.search(r"(H\d{6,})", fund_details_text, re.IGNORECASE)
    if match is not None:
        return match.group(1).upper()
    return "longbridge-hk"


def _extract_longbridge_symbol_from_description(description: str) -> tuple[str, str]:
    normalized_description = _normalize_whitespace(description).upper()
    if not normalized_description:
        return "", ""

    market_match = LONGBRIDGE_HK_EMBEDDED_MARKET_SYMBOL_PATTERN.search(
        normalized_description
    )
    if market_match is not None:
        raw_symbol = f"{market_match.group('symbol')}.{market_match.group('market')}"
        return canonicalize_investment_ticker(raw_symbol), raw_symbol

    isin_match = LONGBRIDGE_HK_ISIN_DESCRIPTION_SYMBOL_PATTERN.search(
        normalized_description
    )
    if isin_match is not None:
        raw_symbol = isin_match.group("symbol")
        return canonicalize_investment_ticker(raw_symbol), raw_symbol

    withholding_match = LONGBRIDGE_HK_WITHHOLDING_SYMBOL_PATTERN.search(
        normalized_description
    )
    if withholding_match is not None:
        raw_symbol = withholding_match.group("symbol")
        return canonicalize_investment_ticker(raw_symbol), raw_symbol

    return "", ""


def _is_longbridge_broker_pnl_excluded_flow(
    flow_name: object,
    description: object,
) -> bool:
    normalized_flow_name = _normalize_whitespace(flow_name).lower()
    normalized_description = _normalize_whitespace(description).lower()
    if normalized_flow_name == "cash dividend" and "held" not in normalized_description:
        return True
    if any(
        marker in normalized_description
        for marker in ("reversal", "rev ", "reverse ", "cancel")
    ) and any(
        marker in normalized_description
        for marker in ("withholding", "tax", "dividend")
    ):
        return True
    if "withholding tax" in normalized_description and re.search(
        r"20\d{6}", normalized_description
    ):
        return True
    return normalized_flow_name == "others" and "withholding" in normalized_description


def _longbridge_hk_cash_equivalent_fund_id(description: str, currency: str) -> str:
    normalized_description = _normalize_whitespace(description).upper()
    normalized_currency = _normalize_text(currency).upper() or "USD"
    if "PING AN" in normalized_description or "PINGAN" in normalized_description:
        return f"ping_an_money_market_{normalized_currency.lower()}"
    if any(
        marker in normalized_description for marker in ("GAOTENG", "WEVALUE", "GTMMF")
    ):
        return f"gaoteng_money_market_{normalized_currency.lower()}"
    return f"longbridge_money_market_{normalized_currency.lower()}"


def _annotate_longbridge_hk_cash_equivalent_entries(
    fund_entries: list[dict[str, Any]],
) -> None:
    money = Decimal("0.01")
    fund_states: dict[str, dict[str, Decimal]] = {}
    chronological_indexes = sorted(
        range(len(fund_entries)),
        key=lambda index: (
            _normalize_text(fund_entries[index].get("time")),
            -int(fund_entries[index].get("row_number") or 0),
        ),
    )
    for index in chronological_indexes:
        entry = fund_entries[index]
        flow_name = _normalize_whitespace(entry.get("flow_name"))
        description = _normalize_whitespace(entry.get("description"))
        if not _ii_basics._is_longbridge_mmf_sweep(flow_name, description):
            continue

        currency = _normalize_text(entry.get("currency")).upper() or "USD"
        fund_id = _longbridge_hk_cash_equivalent_fund_id(description, currency)
        state = fund_states.setdefault(
            fund_id,
            {
                "units": ZERO,
                "cost_basis": ZERO,
            },
        )
        amount_dec = abs(Decimal(str(entry.get("balance") or ZERO)))
        shares_match = LONGBRIDGE_HK_MMF_SHARES_PATTERN.search(description)
        units_dec = (
            abs(Decimal(shares_match.group("shares")))
            if shares_match is not None
            else None
        )
        normalized_flow = flow_name.lower()
        is_placement = normalized_flow == "placement" or normalized_flow.startswith(
            "buy contract"
        )

        if is_placement:
            principal_dec = amount_dec
            interest_dec = ZERO
            state["cost_basis"] += principal_dec
            if units_dec is not None:
                state["units"] += units_dec
            action = "placement"
        else:
            if state["cost_basis"] <= ZERO:
                principal_dec = amount_dec
            elif units_dec is not None and state["units"] > ZERO:
                if units_dec >= state["units"] - Decimal("0.000001"):
                    principal_dec = state["cost_basis"]
                else:
                    principal_dec = (
                        state["cost_basis"] * units_dec / state["units"]
                    ).quantize(money, rounding=ROUND_HALF_UP)
            else:
                principal_dec = min(amount_dec, state["cost_basis"])

            if state["cost_basis"] > ZERO:
                principal_dec = min(principal_dec, state["cost_basis"])
                state["cost_basis"] -= principal_dec
            interest_dec = amount_dec - principal_dec
            if units_dec is not None:
                state["units"] = max(ZERO, state["units"] - units_dec)
            action = "redemption"

        entry["cash_equivalent_action"] = action
        entry["cash_equivalent_fund_id"] = fund_id
        entry["cash_equivalent_principal_raw"] = _decimal_to_str(principal_dec)
        entry["cash_equivalent_interest_raw"] = _decimal_to_str(interest_dec)
        entry["cash_equivalent_equity_delta_raw"] = (
            _decimal_to_str(interest_dec) if action == "redemption" else "0"
        )
        entry["cash_equivalent_cost_basis_after_raw"] = _decimal_to_str(
            state["cost_basis"]
        )
        if units_dec is not None:
            entry["cash_equivalent_units_raw"] = _decimal_to_str(units_dec)


def _enrich_longbridge_hk_fund_entries(
    fund_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched_entries: list[dict[str, Any]] = []
    for entry in fund_entries:
        enriched = dict(entry)
        raw_symbol = _normalize_text(enriched.get("symbol"))
        symbol = canonicalize_investment_ticker(raw_symbol) if raw_symbol else ""
        if not symbol:
            symbol, raw_symbol = _extract_longbridge_symbol_from_description(
                _normalize_text(enriched.get("description"))
            )
        enriched["symbol"] = symbol
        if raw_symbol:
            enriched["source_symbol_raw"] = raw_symbol
        enriched_entries.append(enriched)

    grouped_indexes: dict[tuple[str, str], list[int]] = {}
    for index, entry in enumerate(enriched_entries):
        key = (
            _normalize_text(entry.get("time")),
            _normalize_text(entry.get("currency")).upper(),
        )
        grouped_indexes.setdefault(key, []).append(index)

    for indexes in grouped_indexes.values():
        unassigned_fee_indexes = [
            index
            for index in indexes
            if not _normalize_text(enriched_entries[index].get("symbol"))
            and _normalize_whitespace(enriched_entries[index].get("flow_name")).lower()
            in LONGBRIDGE_HK_DIVIDEND_WITHHOLDING_FLOW_NAMES
            and "withholding"
            in _normalize_whitespace(enriched_entries[index].get("description")).lower()
        ]
        dividend_indexes = [
            index
            for index in indexes
            if _normalize_whitespace(enriched_entries[index].get("flow_name")).lower()
            == "cash dividend"
            and _normalize_text(enriched_entries[index].get("symbol"))
        ]
        for fee_index, dividend_index in zip(unassigned_fee_indexes, dividend_indexes):
            dividend_symbol = _normalize_text(
                enriched_entries[dividend_index].get("symbol")
            )
            enriched_entries[fee_index]["symbol"] = dividend_symbol
            enriched_entries[fee_index]["symbol_inference"] = (
                "same-day dividend sequence"
            )

    _annotate_longbridge_hk_cash_equivalent_entries(enriched_entries)
    return enriched_entries


def _longbridge_hk_fund_entry_to_cash_flow_row(entry: dict[str, Any]) -> dict[str, Any]:
    booking_date = _normalize_text(entry.get("time"))
    symbol = _normalize_text(entry.get("symbol"))
    currency = _normalize_text(entry.get("currency"))
    market = _infer_longbridge_sg_market_from_symbol(symbol, currency=currency)
    booking_datetime = _longbridge_sg_booking_datetime_to_utc_string(
        booking_date,
        market=market,
    )
    flow_name = _normalize_text(entry.get("flow_name"))
    description = _normalize_text(entry.get("description"))
    normalized_flow_name = _normalize_whitespace(flow_name).lower()
    cash_equivalent_transfer = _ii_basics._is_longbridge_mmf_sweep(
        flow_name, description
    )
    row = {
        "flow_name": entry.get("flow_name"),
        "description": description,
        "balance": entry.get("balance"),
        "currency": currency,
        "time": booking_datetime,
        "symbol": symbol,
        "shares": entry.get("shares"),
        "business_time": booking_datetime,
        "booking_date": booking_date,
        "authoritative_booking_date": True,
        "fund_details_entry_number": entry.get("row_number"),
        "source_symbol_raw": entry.get("source_symbol_raw"),
        "symbol_inference": entry.get("symbol_inference"),
        "cash_equivalent_transfer": cash_equivalent_transfer,
        "cash_equivalent_action": entry.get("cash_equivalent_action"),
        "cash_equivalent_fund_id": entry.get("cash_equivalent_fund_id"),
        "cash_equivalent_principal_raw": entry.get("cash_equivalent_principal_raw"),
        "cash_equivalent_interest_raw": entry.get("cash_equivalent_interest_raw"),
        "cash_equivalent_equity_delta_raw": entry.get(
            "cash_equivalent_equity_delta_raw"
        ),
        "cash_equivalent_cost_basis_after_raw": entry.get(
            "cash_equivalent_cost_basis_after_raw"
        ),
        "cash_equivalent_units_raw": entry.get("cash_equivalent_units_raw"),
    }

    # Preserve correction cash in the ledger while keeping it outside broker-reported
    # per-symbol performance. The frontend honors this source flag for Holdings P&L.
    if _is_longbridge_broker_pnl_excluded_flow(flow_name, description):
        row["excluded_from_broker_pnl"] = True
    if normalized_flow_name in {
        "option purchase transaction",
        "option sell transaction",
    }:
        row["mapped_type_override"] = "adjustment"
        row["force_cash_flow_record"] = True
    if cash_equivalent_transfer or normalized_flow_name in LONGBRIDGE_HK_FEE_FLOW_NAMES:
        row["mapped_type_override"] = "adjustment"
    if normalized_flow_name == "short selling interest":
        row["mapped_type_override"] = "debit_interest"
        row["force_cash_flow_record"] = True
    if normalized_flow_name in LONGBRIDGE_HK_FEE_FLOW_NAMES:
        row["fee_category"] = normalized_flow_name.replace(" ", "_")
    return row


def _build_longbridge_hk_order_records(
    history_order_rows: list[dict[str, Any]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    order_records: list[dict[str, Any]] = []
    for row in history_order_rows:
        if not isinstance(row, dict):
            continue
        row_number = int(row.get("_row_number") or 0)
        record = _ii_basics._build_longbridge_history_order_record(
            row, row_number, warnings
        )
        if record is None:
            continue
        source = record.get("source")
        if isinstance(source, dict):
            source["file_kind"] = "longbridge_hk_history_orders_xlsx"
        order_records.append(record)
    return order_records


def _enrich_longbridge_hk_contract_records_with_orders(
    contract_records: list[dict[str, Any]],
    history_order_rows: list[dict[str, Any]],
    warnings: list[str],
) -> tuple[int, int]:
    history_order_records = _build_longbridge_hk_order_records(
        history_order_rows, warnings
    )
    used_order_indexes: set[int] = set()
    matched_count = 0

    for contract_record in contract_records:
        ticker = canonicalize_investment_ticker(
            _normalize_text(contract_record.get("ticker"))
        )
        side = _normalize_text(contract_record.get("type")).lower()
        currency = _normalize_text(contract_record.get("currency")).upper()
        quantity_dec = _parse_decimal(
            contract_record.get("quantity_raw"),
            "quantity_raw",
            0,
            [],
        )
        gross_dec = _parse_decimal(
            contract_record.get("gross_amount_raw"),
            "gross_amount_raw",
            0,
            [],
        )
        contract_date = _normalize_text(contract_record.get("date"))
        if (
            not ticker
            or side not in {"buy", "sell"}
            or quantity_dec is None
            or gross_dec is None
        ):
            continue

        candidates: list[tuple[Decimal, int, int, dict[str, Any]]] = []
        for index, order_record in enumerate(history_order_records):
            if index in used_order_indexes:
                continue
            if (
                canonicalize_investment_ticker(
                    _normalize_text(order_record.get("ticker"))
                )
                != ticker
            ):
                continue
            if _normalize_text(order_record.get("type")).lower() != side:
                continue
            if _normalize_text(order_record.get("currency")).upper() != currency:
                continue

            order_quantity_dec = _parse_decimal(
                order_record.get("quantity_raw"),
                "quantity_raw",
                0,
                [],
            )
            order_gross_dec = _parse_decimal(
                order_record.get("gross_amount_raw"),
                "gross_amount_raw",
                0,
                [],
            )
            if order_quantity_dec is None or order_gross_dec is None:
                continue
            if abs(order_quantity_dec - quantity_dec) > Decimal("0.0000001"):
                continue

            try:
                day_distance = abs(
                    (
                        date.fromisoformat(_normalize_text(order_record.get("date")))
                        - date.fromisoformat(contract_date)
                    ).days
                )
            except ValueError:
                continue
            if day_distance > 4:
                continue

            amount_difference = abs(abs(order_gross_dec) - abs(gross_dec))
            amount_tolerance = max(Decimal("0.05"), abs(gross_dec) * Decimal("0.0001"))
            if amount_difference > amount_tolerance:
                continue
            candidates.append((amount_difference, day_distance, index, order_record))

        if not candidates:
            continue

        _, _, matched_index, matched_order = min(
            candidates,
            key=lambda item: (item[0], item[1], item[2]),
        )
        used_order_indexes.add(matched_index)
        matched_count += 1

        if _normalize_text(matched_order.get("description")):
            contract_record["description"] = matched_order["description"]
        source = contract_record.get("source")
        matched_source = matched_order.get("source")
        if isinstance(source, dict) and isinstance(matched_source, dict):
            source["history_order_row_number"] = matched_source.get("row_number")
            source["history_order_id"] = matched_source.get("order_id")
            source["history_order_status"] = matched_source.get("transaction_type_raw")
            source["history_order_date"] = matched_order.get("date")
            source["history_order_datetime"] = matched_order.get("datetime")
            source["history_order_datetime_source_field"] = matched_source.get(
                "datetime_source_field"
            )
            source["history_order_matched"] = True

    return matched_count, len(history_order_records) - len(used_order_indexes)


def _summarize_longbridge_cash_reconciliation(
    transactions: list[dict[str, Any]],
) -> dict[str, dict[str, str]]:
    balances: dict[str, Decimal] = {}
    for transaction in transactions:
        currency = _normalize_text(transaction.get("currency")).upper() or "USD"
        amount_dec = _parse_decimal(
            transaction.get("net_amount_raw"),
            "net_amount_raw",
            0,
            [],
        )
        if amount_dec is None:
            continue
        balances[currency] = balances.get(currency, ZERO) + amount_dec

    summary: dict[str, dict[str, str]] = {}
    source_rounding_tolerance = Decimal("0.05")
    for currency, difference in sorted(balances.items()):
        summary[currency] = {
            "starting_cash": "0",
            "transaction_net_change": _decimal_to_str(difference) or "0",
            "authoritative_ending_cash": "0",
            "difference": _decimal_to_str(difference) or "0",
            "source_rounding_tolerance": _decimal_to_str(source_rounding_tolerance)
            or "0.05",
            "status": (
                "within_source_rounding_tolerance"
                if abs(difference) <= source_rounding_tolerance
                else "mismatch"
            ),
        }
    return summary


def _collect_longbridge_accounted_fund_entry_numbers(
    transactions: list[dict[str, Any]],
) -> set[int]:
    accounted: set[int] = set()
    for transaction in transactions:
        source = transaction.get("source")
        if not isinstance(source, dict):
            continue
        file_kind = _normalize_text(source.get("file_kind"))
        if file_kind == "longbridge_cash_flow":
            row_number = source.get("row_number")
            if row_number is not None:
                accounted.add(int(row_number))
            continue
        contract_row_numbers = source.get("cash_flow_contract_row_numbers")
        if not isinstance(contract_row_numbers, list):
            contract_row_numbers = [
                source.get("cash_flow_contract_row_number")
                or (
                    source.get("row_number")
                    if file_kind == "longbridge_fund_details_contract"
                    else None
                )
            ]
        fee_row_numbers = source.get("cash_flow_fee_row_numbers")
        if not isinstance(fee_row_numbers, list):
            fee_row_numbers = []
        for row_number in [*contract_row_numbers, *fee_row_numbers]:
            if row_number is not None:
                accounted.add(int(row_number))
    return accounted


def build_investment_payload_from_longbridge_hk_files(
    *,
    fund_details_text: str,
    history_orders_xlsx_bytes: bytes,
    fund_details_filename: str = "",
    history_orders_filename: str = "",
    fund_details_bytes: bytes | None = None,
) -> dict[str, Any]:
    raw_fund_details_text = str(fund_details_text or "")
    raw_fund_details_bytes = (
        bytes(fund_details_bytes)
        if isinstance(fund_details_bytes, (bytes, bytearray))
        else raw_fund_details_text.encode("utf-8")
    )
    fund_details_text = raw_fund_details_text.strip()
    if not fund_details_text:
        raise ValueError("Longbridge (HK) Fund Details text is required.")
    if not history_orders_xlsx_bytes:
        raise ValueError("Longbridge (HK) History Orders spreadsheet is required.")

    warnings: list[str] = []
    unknown_types: set[str] = set()
    account = _infer_longbridge_hk_account_id(
        fund_details_text,
        fund_details_filename=fund_details_filename,
        history_orders_filename=history_orders_filename,
    )

    fund_entries = _enrich_longbridge_hk_fund_entries(
        _parse_longbridge_sg_fund_details_entries(fund_details_text)
    )
    if not fund_entries:
        raise ValueError(
            "Longbridge (HK) Fund Details text did not contain any recognizable cash-flow entries."
        )

    cash_flow_rows = [
        _longbridge_hk_fund_entry_to_cash_flow_row(entry) for entry in fund_entries
    ]

    workbook_metadata: dict[str, int] = {}
    history_order_rows = _parse_longbridge_sg_history_orders_xlsx(
        history_orders_xlsx_bytes,
        accepted_order_statuses=frozenset({"filled", "partially cancelled"}),
        accepted_log_statuses=frozenset({"filled", "partially filled"}),
        workbook_metadata=workbook_metadata,
    )
    _append_longbridge_history_order_warnings(
        workbook_metadata,
        warnings,
        broker_label="Longbridge (HK)",
    )

    # Fund Details contract movements remain authoritative for cash and position replay.
    # History Orders only enrich exact one-to-one matches with order identity and timestamps.
    stock_contracts, _ = _ii_basics._build_longbridge_stock_cash_flow_rows(
        cash_flow_rows, warnings
    )
    order_records = []
    for c in stock_contracts:
        rec = _ii_basics._build_synthetic_contract_trade_record(c, warnings)
        if rec is not None:
            order_records.append(rec)
    if not order_records:
        order_records = _build_longbridge_hk_order_records(history_order_rows, warnings)
    transactions, holdings_mismatches, matched_cash_flow_row_count = (
        _ii_basics._build_longbridge_transactions_from_order_records(
            order_records,
            cash_flow_rows,
            {},
            warnings,
        )
    )
    authoritative_contract_records = [
        transaction
        for transaction in transactions
        if _normalize_text(transaction.get("type")).lower() in {"buy", "sell"}
        and _normalize_text(transaction.get("source", {}).get("file_kind"))
        == "longbridge_fund_details_contract"
    ]
    enriched_contract_count, unmatched_history_order_count = (
        _enrich_longbridge_hk_contract_records_with_orders(
            authoritative_contract_records,
            history_order_rows,
            warnings,
        )
    )
    _ii_basics._apply_longbridge_fund_details_booking_dates(
        transactions,
        cash_flow_rows,
        warnings,
    )
    _ii_records._sort_transactions(transactions)
    # Use generic replay collection without SG flat-ticker expectations
    replayed = _ii_records._replay_holdings(transactions)
    for symbol, quantity_dec in sorted(replayed.items()):
        warnings.append(
            "Longbridge (HK) replayed holdings for "
            f"{symbol} are {_decimal_to_str(quantity_dec)}."
        )
    position_snapshot = _build_replayed_open_position_snapshot(transactions)
    if not holdings_mismatches:
        holdings_mismatches = _ii_records._validate_holdings(
            transactions, position_snapshot
        )

    cash_reconciliation = _summarize_longbridge_cash_reconciliation(transactions)
    accounted_fund_entry_numbers = _collect_longbridge_accounted_fund_entry_numbers(
        transactions
    )
    unaccounted_fund_entry_count = max(
        0,
        len(fund_entries) - len(accounted_fund_entry_numbers),
    )
    performance_calibrations = (
        _ii_basics._build_broker_reported_performance_calibrations(
            "longbridge_hk",
            account,
        )
    )
    source_artifacts = _build_longbridge_paired_file_source_artifacts(
        broker="longbridge_hk",
        account=account,
        fund_details_bytes=raw_fund_details_bytes,
        history_orders_xlsx_bytes=history_orders_xlsx_bytes,
        fund_details_filename=fund_details_filename,
        history_orders_filename=history_orders_filename,
        statement_period_start=min(
            (_normalize_text(entry.get("time")) for entry in fund_entries),
            default="",
        ),
        statement_period_end=max(
            (_normalize_text(entry.get("time")) for entry in fund_entries),
            default="",
        ),
    )

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "longbridge_hk_files_to_investment_json",
            "version": LONGBRIDGE_HK_IMPORTER_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "order_source": "longbridge_hk_fund_details_contracts",
            "fund_details_entry_count": len(fund_entries),
            "accounted_fund_details_entry_count": len(accounted_fund_entry_numbers),
            "unaccounted_fund_details_entry_count": unaccounted_fund_entry_count,
            "history_order_row_count": workbook_metadata.get(
                "orders_sheet_row_count", 0
            ),
            "history_log_row_count": workbook_metadata.get("logs_sheet_row_count", 0),
            "executed_history_order_count": len(history_order_rows),
            "history_orders_skipped_missing_symbol_count": workbook_metadata.get(
                "skipped_orders_missing_symbol_count", 0
            ),
            "history_orders_skipped_missing_time_count": workbook_metadata.get(
                "skipped_orders_missing_time_count", 0
            ),
            "fund_details_contract_count": len(stock_contracts),
            "order_record_count": len(order_records),
            "history_order_enriched_contract_count": enriched_contract_count,
            "unmatched_history_order_count": unmatched_history_order_count,
            "matched_cash_flow_row_count": matched_cash_flow_row_count,
            "replayed_holdings": {
                symbol: _decimal_to_str(quantity_dec) or "0"
                for symbol, quantity_dec in sorted(replayed.items())
            },
        },
        "broker": "longbridge_hk",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": (
                "Fund Details booking date for authoritative contract and cash-flow records"
            ),
            "datetime_field_meaning": (
                "Fund Details booking date at the conventional exchange close; matched History Orders "
                "execution timestamps remain available in transaction source metadata"
            ),
            "timezone": "Fund Details booking date; History Orders metadata uses UTC",
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=sorted(unknown_types),
            holdings_mismatches=holdings_mismatches,
            open_position_snapshots={},
            performance_snapshots=performance_calibrations,
            starting_cash="0",
            ending_cash="0",
        ),
        "starting_cash": "0",
        "ending_cash": "0",
        "position_snapshot": position_snapshot,
        "performance_snapshot": performance_calibrations,
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    payload["summary"]["cash_reconciliation"] = cash_reconciliation
    payload["summary"]["cash_reconciliation_matched"] = all(
        currency_summary.get("status") == "within_source_rounding_tolerance"
        for currency_summary in cash_reconciliation.values()
    )
    payload["summary"]["position_snapshot_authoritative"] = False
    payload["summary"]["performance_snapshot_authoritative"] = bool(
        payload["performance_snapshot"]
    )
    if payload["performance_snapshot"]:
        payload["summary"]["performance_snapshot_source"] = (
            LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
        )
    if position_snapshot:
        payload["summary"]["position_snapshot_source"] = (
            "longbridge_hk_replayed_holdings"
        )
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "longbridge_hk"
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "longbridge_hk"
            source["account"] = account
        transaction["account"] = account

    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    broker_summary = payload.get("broker_summaries", {}).get("longbridge_hk")
    if isinstance(broker_summary, dict):
        broker_summary["calibration_source"] = "longbridge_hk_files"
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload
