"""Investment import domain: basics.

Code version: v0.1.1
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    BrokerSettings,
    BytesIO,
    CURRENCY_CODE_PATTERN,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    IBKR_SECURITY_IDENTIFIER_DESCRIPTION_PATTERN,
    InvalidOperation,
    LONGBRIDGE_BARE_SYMBOL_DESCRIPTION_PATTERN,
    LONGBRIDGE_CURRENCY_MARKET_SUFFIXES,
    LONGBRIDGE_EXECUTED_ORDER_STATUSES,
    LONGBRIDGE_IMPORT_MIN_RETRY_WINDOW_DAYS,
    LONGBRIDGE_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_MARKET_TIMEZONES,
    LONGBRIDGE_OPTION_DESCRIPTION_PATTERN,
    LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
    LONGBRIDGE_ORDER_METADATA_LOOKBACK_DAYS,
    LONGBRIDGE_ORDER_TIME_FIELDS,
    LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE,
    LONGBRIDGE_STOCK_CASH_FLOW_MATCH_HOURS,
    LONGBRIDGE_STOCK_CASH_FLOW_MATCH_MAX_CANDIDATES,
    LONGBRIDGE_STOCK_CONTRACT_FLOW_SIDES,
    LONGBRIDGE_STOCK_FEE_FLOW_SIDES,
    LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE,
    LONGBRIDGE_US_MARKET_TIMEZONE,
    LONGBRIDGE_US_OPTION_SYMBOL_PATTERN,
    PRIVATE_INVESTMENT_EVIDENCE_PATH,
    ROUND_HALF_UP,
    TRANSACTION_DESCRIPTION_SEPARATOR,
    TRANSACTION_DESCRIPTION_SEPARATOR_PATTERN,
    TYPE_MAPPING,
    TextIOWrapper,
    ZERO,
    ZoneInfo,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    base64,
    csv,
    date,
    datetime,
    hashlib,
    json,
    normalize_ticker,
    re,
    timedelta,
    timezone,
)

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.brokers.ibkr.parsers as _ii_ibkr

import app.services.investment.importing.records as _ii_records

from app.services.investment.importing import compat as _investment_import_compat


def _normalize_ibkr_description(value: str | None) -> str:
    """Normalize recurring IBKR security-distribution description variants."""
    description = _normalize_whitespace(value)
    if not description:
        return ""

    description = IBKR_SECURITY_IDENTIFIER_DESCRIPTION_PATTERN.sub(
        lambda match: (
            f"{match.group('ticker').upper()} ({match.group('identifier').upper()})"
        ),
        description,
    )
    for pattern, replacement in (
        (r"\bCash\s+Dividend\b", "Cash dividend"),
        (r"\bDividend\s+Tax\b", "Dividend tax"),
        (r"\bOrdinary\s+Dividend\b", "Ordinary dividend"),
        (r"\bPer\s+Share\b", "per share"),
        (r"\bUS\s+Tax\b", "US tax"),
    ):
        description = re.sub(pattern, replacement, description, flags=re.IGNORECASE)
    return description


def _normalize_transaction_description_separators(value: str | None) -> str:
    """Use one readable separator without changing identifiers or numeric signs."""
    description = _normalize_whitespace(value)
    if not description:
        return ""
    description = re.sub(r"\s*[·•]\s*", TRANSACTION_DESCRIPTION_SEPARATOR, description)
    return TRANSACTION_DESCRIPTION_SEPARATOR_PATTERN.sub(
        TRANSACTION_DESCRIPTION_SEPARATOR,
        description,
    )


def _normalize_standard_transaction_description(
    value: str | None,
    *,
    transaction_type: str | None = None,
    source: dict[str, Any] | None = None,
) -> str:
    """Apply display-only wording fixes without dropping imported description details."""
    description = _normalize_transaction_description_separators(value)
    description = re.sub(r"\bEDDA\b", "eDDA", description, flags=re.IGNORECASE)
    description = re.sub(
        r"^([A-Za-z][A-Za-z0-9]*)\.US(?=\s+Cash\s+dividend\b)",
        r"\1",
        description,
        flags=re.IGNORECASE,
    )
    description = re.sub(r"\s+,", ",", description)
    description = re.sub(
        r",\s*Held\s*:\s*", ", Held: ", description, flags=re.IGNORECASE
    )

    raw_flow = _normalize_text((source or {}).get("transaction_type_raw")).lower()
    is_kol_reward = (
        _normalize_text(transaction_type).lower() == "kol_reward"
        or raw_flow == "kol"
        or bool(re.search(r"\bKOL\s+Rewards?\b", description, flags=re.IGNORECASE))
    )
    if is_kol_reward:
        details = re.sub(r"\bKOL\s+Rewards?\b", "", description, flags=re.IGNORECASE)
        details = re.sub(
            r"^\s*(?:·|•|\||:|–|—|-)+\s*|\s*(?:·|•|\||:|–|—|-)+\s*$",
            "",
            details,
        )
        details = _normalize_whitespace(details)
        description = f"KOL Rewards · {details}" if details else "KOL Rewards"
    return description


def _load_local_private_investment_evidence() -> dict[str, Any]:
    """Load optional device-local broker evidence without a source-code fallback."""
    try:
        payload = json.loads(
            PRIVATE_INVESTMENT_EVIDENCE_PATH.read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _normalize_hsbc_account_number(value: str | None) -> str:
    translated = str(value or "").translate(
        str.maketrans(
            {
                "\u2010": "-",
                "\u2011": "-",
                "\u2012": "-",
                "\u2013": "-",
                "\u2014": "-",
                "\u2015": "-",
                "\u2212": "-",
                "\ufe58": "-",
                "\ufe63": "-",
                "\uff0d": "-",
            }
        )
    )
    return re.sub(r"\s+", "", translated).strip()


def _normalize_decimal_identity_token(value: Any) -> str:
    raw = _normalize_text(str(value) if value is not None else "")
    if not raw:
        return ""
    try:
        decimal_value = Decimal(raw.replace(",", "")).quantize(
            Decimal("0.00000001"),
            rounding=ROUND_HALF_UP,
        )
        if decimal_value == ZERO:
            return "0"
        return format(decimal_value.normalize(), "f")
    except (InvalidOperation, ValueError, TypeError):
        return raw


def _is_hsbc_order_status_record(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) not in {
        "hsbc_order_status_text",
        "hsbc_order_status_capture",
    }:
        return False
    return bool(
        _normalize_text(source.get("statement_order_id") or source.get("order_id"))
    )


def _normalize_broker_code(value: str | None) -> str:
    normalized = _normalize_text(value).lower() or "ibkr"
    if normalized == "longbridge":
        return "longbridge_hk"
    return normalized


def _build_broker_reported_performance_calibrations(
    broker: str | None,
    account: str | None,
) -> dict[str, dict[str, Any]]:
    normalized_broker = _normalize_broker_code(broker)
    normalized_account = _normalize_text(account)
    private_evidence = (
        _investment_import_compat.load_local_private_investment_evidence()
    )
    calibration_sources = {
        "longbridge_hk": private_evidence.get(
            "longbridge_hk_performance_calibrations", {}
        ),
        "longbridge_sg": private_evidence.get(
            "longbridge_sg_performance_calibrations", {}
        ),
        "hsbc": private_evidence.get("hsbc_performance_calibrations", {}),
    }
    broker_calibrations = calibration_sources.get(normalized_broker, {})
    if not isinstance(broker_calibrations, dict):
        broker_calibrations = {}
    realized_totals = broker_calibrations.get(
        normalized_account,
        {},
    )
    if not isinstance(realized_totals, dict):
        realized_totals = {}
    calibration_source = (
        LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
        if normalized_broker in {"longbridge_hk", "longbridge_sg"}
        else "broker_reported_pnl"
    )
    return {
        normalize_ticker(ticker): {
            "asset_category": "Stocks",
            "currency": "USD",
            "realized_total": realized_total,
            "unrealized_total": "0",
            "total": realized_total,
            "calibration_source": calibration_source,
            "realized_total_includes_nonperformance": True,
        }
        for ticker, realized_total in realized_totals.items()
        if normalize_ticker(ticker)
    }


def _build_verified_tax_lot_history(
    broker: str | None,
    account: str | None,
) -> dict[str, dict[str, Any]]:
    normalized_broker = _normalize_broker_code(broker)
    normalized_account = _normalize_text(account)
    private_evidence = (
        _investment_import_compat.load_local_private_investment_evidence()
    )
    tax_lot_history = private_evidence.get("verified_tax_lot_history", {})
    if not isinstance(tax_lot_history, dict):
        tax_lot_history = {}
    broker_history = tax_lot_history.get(normalized_broker, {})
    if not isinstance(broker_history, dict):
        broker_history = {}
    verifications = broker_history.get(normalized_account, {})
    if not isinstance(verifications, dict):
        verifications = {}
    return {
        normalize_ticker(ticker): dict(verification)
        for ticker, verification in verifications.items()
        if normalize_ticker(ticker) and isinstance(verification, dict)
    }


def _refresh_hsbc_verified_tax_lot_history(
    summary: dict[str, Any],
    transactions: list[dict[str, Any]],
) -> None:
    """Extend verified HSBC lot scopes only across a complete visible window."""
    if (
        not isinstance(summary, dict)
        or summary.get("position_snapshot_authoritative") is not True
        or not isinstance(summary.get("position_snapshot"), dict)
        or not isinstance(summary.get("tax_lot_history_verifications"), dict)
    ):
        return

    hsbc_snapshot = summary.get("hsbc_snapshot")
    if (
        not isinstance(hsbc_snapshot, dict)
        or hsbc_snapshot.get("status") != "validated"
    ):
        return

    coverage = summary.get("order_history_scope") or hsbc_snapshot.get(
        "order_status_coverage"
    )
    if not isinstance(coverage, dict) or coverage.get("mode") != "explicit_date_ranges":
        return
    raw_windows = coverage.get("windows")
    if not isinstance(raw_windows, list):
        return
    coverage_windows: list[tuple[date, date]] = []
    for raw_window in raw_windows:
        if not isinstance(raw_window, dict):
            continue
        try:
            start_date = date.fromisoformat(
                _normalize_text(raw_window.get("start_date"))[:10]
            )
            end_date = date.fromisoformat(
                _normalize_text(raw_window.get("end_date"))[:10]
            )
        except ValueError:
            continue
        if start_date <= end_date:
            coverage_windows.append((start_date, end_date))
    if not coverage_windows:
        return

    snapshot_as_of_text = _normalize_text(summary.get("position_snapshot_as_of"))[:10]
    if not snapshot_as_of_text:
        market_data_updated_at = hsbc_snapshot.get("portfolio_market_data_updated_at")
        if isinstance(market_data_updated_at, dict):
            snapshot_as_of_text = _normalize_text(market_data_updated_at.get("date"))[
                :10
            ]
    try:
        snapshot_as_of = date.fromisoformat(snapshot_as_of_text)
    except ValueError:
        return

    account = _normalize_text(summary.get("account_id") or summary.get("account"))
    if not account:
        return

    position_snapshot = summary["position_snapshot"]
    verifications = summary["tax_lot_history_verifications"]

    def parse_nonnegative_integer(value: Any) -> int | None:
        try:
            parsed = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return None
        if parsed < ZERO or parsed != parsed.to_integral_value():
            return None
        return int(parsed)

    def coverage_covers_incremental_window(
        verified_through: date,
    ) -> bool:
        cursor = verified_through + timedelta(days=1)
        for start_date, end_date in sorted(coverage_windows):
            if end_date < cursor:
                continue
            if start_date > cursor:
                return False
            cursor = max(cursor, end_date + timedelta(days=1))
            if cursor > snapshot_as_of:
                return True
        return cursor > snapshot_as_of

    for raw_ticker, raw_verification in list(verifications.items()):
        if not isinstance(raw_verification, dict):
            continue
        ticker = normalize_ticker(raw_ticker)
        currency = _normalize_text(raw_verification.get("currency")).upper()
        if not ticker or not currency:
            continue
        position_entry = next(
            (
                entry
                for snapshot_ticker, entry in position_snapshot.items()
                if normalize_ticker(snapshot_ticker) == ticker
                and isinstance(entry, dict)
            ),
            None,
        )
        if position_entry is None:
            continue
        snapshot_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            position_entry.get("quantity")
        )
        if snapshot_quantity is None or snapshot_quantity < ZERO:
            continue

        verified_through_text = _normalize_text(
            raw_verification.get("verified_through")
        )[:10]
        expected_shares = _ii_hsbc_cash._parse_decimal_text_or_none(
            raw_verification.get("expected_shares")
        )
        buy_count = parse_nonnegative_integer(raw_verification.get("buy_count"))
        sell_count = parse_nonnegative_integer(raw_verification.get("sell_count"))
        buy_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            raw_verification.get("buy_quantity")
        )
        sell_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            raw_verification.get("sell_quantity")
        )
        try:
            verified_through = date.fromisoformat(verified_through_text)
        except ValueError:
            continue
        if (
            expected_shares is None
            or buy_count is None
            or sell_count is None
            or buy_quantity is None
            or sell_quantity is None
            or snapshot_as_of <= verified_through
            or not coverage_covers_incremental_window(verified_through)
        ):
            continue

        additional_buy_count = 0
        additional_sell_count = 0
        additional_buy_quantity = ZERO
        additional_sell_quantity = ZERO
        for transaction in transactions:
            if not isinstance(transaction, dict):
                continue
            if transaction.get("exclude_from_holdings_replay") is True:
                continue
            if not _is_hsbc_order_status_record(transaction):
                continue
            source = (
                transaction.get("source")
                if isinstance(transaction.get("source"), dict)
                else {}
            )
            transaction_broker = _normalize_broker_code(
                transaction.get("broker") or source.get("broker")
            )
            transaction_account = _normalize_text(
                transaction.get("account")
                or transaction.get("account_id")
                or source.get("account")
                or source.get("account_number")
            )
            transaction_ticker = normalize_ticker(transaction.get("ticker"))
            transaction_currency = _normalize_text(
                transaction.get("currency") or source.get("currency")
            ).upper()
            transaction_date_text = _normalize_text(transaction.get("date"))[:10]
            try:
                transaction_date = date.fromisoformat(transaction_date_text)
            except ValueError:
                continue
            transaction_type = _normalize_text(transaction.get("type")).lower()
            quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                transaction.get("quantity_abs") or transaction.get("quantity_raw")
            )
            if (
                transaction_broker != "hsbc"
                or transaction_account != account
                or transaction_ticker != ticker
                or transaction_currency != currency
                or transaction_type not in {"buy", "sell"}
                or quantity is None
                or quantity <= ZERO
                or transaction_date <= verified_through
                or transaction_date > snapshot_as_of
            ):
                continue
            if transaction_type == "buy":
                additional_buy_count += 1
                additional_buy_quantity += quantity
            else:
                additional_sell_count += 1
                additional_sell_quantity += quantity

        if not additional_buy_count and not additional_sell_count:
            continue
        projected_quantity = (
            expected_shares + additional_buy_quantity - additional_sell_quantity
        )
        if projected_quantity != snapshot_quantity:
            continue

        updated_verification = dict(raw_verification)
        updated_verification.update(
            {
                "verified_through": snapshot_as_of.isoformat(),
                "expected_shares": _decimal_to_str(snapshot_quantity) or "0",
                "buy_count": buy_count + additional_buy_count,
                "sell_count": sell_count + additional_sell_count,
                "buy_quantity": _decimal_to_str(buy_quantity + additional_buy_quantity)
                or "0",
                "sell_quantity": _decimal_to_str(
                    sell_quantity + additional_sell_quantity
                )
                or "0",
                "verification_source": "authoritative_position_snapshot_and_incremental_replay",
            }
        )
        verifications[ticker] = updated_verification


def _ibkr_account_suffix(value: str | None) -> str:
    normalized = _normalize_text(value).upper()
    match = re.fullmatch(r"U(?:\*+|\d+)(\d{5})", normalized)
    return match.group(1) if match else ""


def _accounts_are_compatible(
    broker: str,
    left_account: str,
    right_account: str,
) -> bool:
    if not left_account or not right_account or left_account == right_account:
        return True
    if broker != "ibkr":
        return False
    left_suffix = _ibkr_account_suffix(left_account)
    right_suffix = _ibkr_account_suffix(right_account)
    return bool(left_suffix and right_suffix and left_suffix == right_suffix)


def _account_identity_token(broker: str, account: str) -> str:
    normalized_account = _normalize_text(account)
    if broker == "ibkr":
        suffix = _ibkr_account_suffix(normalized_account)
        if suffix:
            return f"ibkr:u-suffix:{suffix}"
    return normalized_account


def _build_convention_datetime(date_str: str) -> str:
    return f"{date_str} {DEFAULT_CONVENTION_TIME}"


def _classify_transaction_type(
    transaction_type: str,
    description: str,
    unknown_types: set[str],
) -> str:
    if "fx translations p&l" in description.lower():
        return "fx_translation_pnl"
    mapped = TYPE_MAPPING.get(transaction_type)
    if mapped is not None:
        return mapped
    normalized = transaction_type.strip().lower().replace(" ", "_")
    unknown_types.add(transaction_type)
    return normalized


def _detect_currency(
    transaction_type: str,
    price_currency: str,
    description: str,
    symbol: str,
) -> str | None:
    description_upper = description.upper()
    description_currency_match = CURRENCY_CODE_PATTERN.search(description_upper)
    description_currency = (
        description_currency_match.group(1) if description_currency_match else None
    )
    if description_currency == "TAX":
        description_currency = None
    if "fx translations p&l" in description.lower():
        return "USD"
    if transaction_type == "Forex Trade Component":
        # The Gross/Net amounts in "Forex Trade Component" rows represent the
        # cash impact in the account base currency ("Net Amount in Base").
        # Price Currency reflects the other leg of the pair (e.g. CNH for USD.CNH),
        # but must not be used for the amount's currency. Forcing base (USD)
        # prevents polluting cash tracking with phantom foreign-currency flows
        # for tiny FX fees/adjustments and auto-conversions.
        return "USD"
    if transaction_type == "Deposit":
        return None
    if transaction_type in {
        "Credit Interest",
        "Debit Interest",
        "Dividend",
        "Foreign Tax Withholding",
    }:
        if description_currency is not None:
            return description_currency
    normalized_price_currency = price_currency.strip()
    if normalized_price_currency and normalized_price_currency != "-":
        return normalized_price_currency
    if symbol.endswith(".HK"):
        return "HKD"
    if "us tax" in description.lower():
        return "USD"
    return None


def _iter_csv_rows(payload: bytes) -> list[list[str]]:
    with (
        BytesIO(payload) as buffer,
        TextIOWrapper(
            buffer,
            encoding="utf-8-sig",
            newline="",
        ) as text_stream,
    ):
        return list(csv.reader(text_stream))


def _ibkr_csv_statement_metadata(rows: list[list[str]]) -> dict[str, str]:
    """Extract only the statement facts needed to bind an import evidence pair."""
    metadata: dict[str, str] = {}
    for row in rows:
        if len(row) < 4 or row[0] != "Statement" or row[1] != "Data":
            continue
        field_name = _normalize_text(row[2])
        field_value = _normalize_text(",".join(row[3:]))
        if field_name and field_value:
            metadata[field_name] = field_value
    return metadata


def _parse_ibkr_statement_period(value: str) -> tuple[str, str] | None:
    raw_period = _normalize_text(value)
    if not raw_period or " - " not in raw_period:
        return None
    start_raw, end_raw = raw_period.split(" - ", maxsplit=1)
    for format_string in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return (
                datetime.strptime(start_raw, format_string).date().isoformat(),
                datetime.strptime(end_raw, format_string).date().isoformat(),
            )
        except ValueError:
            continue
    return None


def _validate_ibkr_csv_pair_metadata(
    transaction_rows: list[list[str]],
    positions_rows: list[list[str]],
) -> dict[str, str]:
    """Fail closed for observable account or period contradictions in an IBKR CSV pair."""
    transaction_metadata = _ibkr_csv_statement_metadata(transaction_rows)
    positions_metadata = _ibkr_csv_statement_metadata(positions_rows)
    transaction_period = _parse_ibkr_statement_period(
        transaction_metadata.get("Period", "")
    )
    positions_period = _parse_ibkr_statement_period(
        positions_metadata.get("Period", "")
    )
    if (
        transaction_period
        and positions_period
        and transaction_period != positions_period
    ):
        raise ValueError(
            "The IBKR Transaction History and Realized Summary CSV files have different statement periods."
        )

    _summary_fields, transaction_account = _ii_records._extract_summary_fields(
        transaction_rows, []
    )
    positions_account = _ii_ibkr._extract_account_information(positions_rows)
    if (
        transaction_account
        and positions_account
        and not _accounts_are_compatible("ibkr", transaction_account, positions_account)
    ):
        raise ValueError(
            "The IBKR Transaction History and Realized Summary CSV files belong to different accounts."
        )

    period = transaction_period or positions_period
    return {
        "transaction_title": transaction_metadata.get("Title", ""),
        "transaction_period": transaction_metadata.get("Period", ""),
        "transaction_generated_at": transaction_metadata.get("WhenGenerated", ""),
        "positions_title": positions_metadata.get("Title", ""),
        "positions_period": positions_metadata.get("Period", ""),
        "positions_generated_at": positions_metadata.get("WhenGenerated", ""),
        "period_start": period[0] if period else "",
        "period_end": period[1] if period else "",
    }


def _build_ibkr_source_artifact(
    *,
    payload: bytes,
    filename: str,
    source_kind: str,
    account: str | None,
    statement_title: str,
    statement_period: str,
    statement_generated_at: str,
    bundle_id: str,
    bundle_role: str,
    related_sha256: str,
) -> dict[str, Any]:
    content_sha256 = hashlib.sha256(payload).hexdigest()
    period_bounds = _parse_ibkr_statement_period(statement_period)
    normalized_filename = _normalize_text(filename) or f"ibkr-{bundle_role}.csv"
    return {
        "evidence_schema_version": "1.0",
        "sha256": content_sha256,
        "byte_count": len(payload),
        "filename": normalized_filename,
        "filenames": [normalized_filename],
        "broker": "ibkr",
        "account": _normalize_text(account),
        "source_kind": source_kind,
        "bundle_id": bundle_id,
        "bundle_ids": [bundle_id],
        "bundle_role": bundle_role,
        "related_sha256": related_sha256,
        "statement_title": statement_title,
        "statement_period": statement_period,
        "statement_period_start": period_bounds[0] if period_bounds else "",
        "statement_period_end": period_bounds[1] if period_bounds else "",
        "statement_generated_at": statement_generated_at,
        "content_encoding": "base64",
        "content_base64": base64.b64encode(payload).decode("ascii"),
    }


def _parse_longbridge_date(value: str, field_name: str) -> date:
    normalized = _normalize_text(value)
    if not normalized:
        raise ValueError(f"{field_name} is required for Longbridge imports.")
    try:
        return datetime.strptime(normalized, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{field_name} must use YYYY-MM-DD format.") from exc


def _fetch_longbridge_history_order_rows(
    settings: BrokerSettings,
    start_day: date,
    end_day: date,
) -> tuple[list[Any], int]:
    metadata_start_day = start_day - timedelta(
        days=LONGBRIDGE_ORDER_METADATA_LOOKBACK_DAYS
    )
    history_order_rows, history_order_window_count = (
        _fetch_longbridge_cli_rows_windowed(
            settings,
            ["order", "--history"],
            ("orders", "list"),
            metadata_start_day,
            end_day,
            timeout_seconds=45,
            window_days=LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS,
        )
    )
    return history_order_rows, history_order_window_count


def _build_longbridge_order_metadata_map(
    history_order_rows: list[Any],
) -> dict[str, dict[str, Any]]:
    metadata_by_order_id: dict[str, dict[str, Any]] = {}
    for row_number, row in enumerate(
        history_order_rows if isinstance(history_order_rows, list) else [], start=1
    ):
        if not isinstance(row, dict):
            continue
        order_id = _normalize_text(row.get("order_id"))
        if not order_id:
            continue
        candidate = dict(row)
        candidate["_row_number"] = row_number
        existing = metadata_by_order_id.get(order_id)
        if existing is None:
            metadata_by_order_id[order_id] = candidate
            continue

        existing_quantity = _parse_decimal(
            str(existing.get("executed_quantity") or ""), "executed_quantity", 0, []
        )
        candidate_quantity = _parse_decimal(
            str(candidate.get("executed_quantity") or ""), "executed_quantity", 0, []
        )
        existing_status = _normalize_longbridge_order_status(existing.get("status"))
        candidate_status = _normalize_longbridge_order_status(candidate.get("status"))
        existing_score = (
            1 if existing_status in LONGBRIDGE_EXECUTED_ORDER_STATUSES else 0,
            existing_quantity or ZERO,
        )
        candidate_score = (
            1 if candidate_status in LONGBRIDGE_EXECUTED_ORDER_STATUSES else 0,
            candidate_quantity or ZERO,
        )
        if candidate_score >= existing_score:
            metadata_by_order_id[order_id] = candidate
    return metadata_by_order_id


def _build_longbridge_execution_records(
    execution_rows: list[Any],
    order_metadata_by_id: dict[str, dict[str, Any]],
    warnings: list[str],
    unknown_types: set[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for row_number, row in enumerate(
        execution_rows if isinstance(execution_rows, list) else [], start=1
    ):
        if not isinstance(row, dict):
            continue
        order_id = _normalize_text(row.get("order_id"))
        metadata = order_metadata_by_id.get(order_id, {})
        side_raw = _normalize_text(row.get("side") or metadata.get("side"))
        side = side_raw.lower()
        if side not in {"buy", "sell"}:
            warnings.append(
                f"Longbridge execution row {row_number}: unsupported side {side_raw!r}."
            )
            continue

        quantity_dec = _longbridge_decimal(
            row.get("quantity"),
            "execution.quantity",
            row_number,
            warnings,
        )
        price_dec = _longbridge_decimal(
            row.get("price"),
            "execution.price",
            row_number,
            warnings,
        )
        if (
            quantity_dec is None
            or quantity_dec <= ZERO
            or price_dec is None
            or price_dec <= ZERO
        ):
            continue

        symbol = normalize_ticker(
            _normalize_text(row.get("symbol") or metadata.get("symbol"))
        )
        parsed_time = _parse_longbridge_datetime(
            row.get("time") or row.get("trade_done_at")
        )
        if parsed_time is None:
            warnings.append(
                f"Longbridge execution row {row_number}: missing execution time for order {order_id!r}."
            )
            continue
        date_text, datetime_text = _longbridge_parsed_datetime_to_strings(
            parsed_time,
            date_timezone=_longbridge_symbol_date_timezone(symbol),
        )
        status = _normalize_text(metadata.get("status"))
        normalized_status = _normalize_longbridge_order_status(status)
        if (
            normalized_status
            and normalized_status not in LONGBRIDGE_EXECUTED_ORDER_STATUSES
        ):
            unknown_types.add(status or "unknown_order_status")

        contract_multiplier = _longbridge_contract_multiplier(symbol)
        gross_amount_abs = abs(quantity_dec * price_dec * contract_multiplier)
        signed_amount_dec = -gross_amount_abs if side == "buy" else gross_amount_abs
        description = (
            _normalize_text(metadata.get("stock_name"))
            or symbol
            or _normalize_text(metadata.get("remark"))
            or "Longbridge execution"
        )
        execution_key = "|".join(
            [
                order_id or f"row-{row_number}",
                datetime_text,
                _decimal_to_str(quantity_dec) or "",
                _decimal_to_str(price_dec) or "",
                side,
                symbol,
                str(row_number),
            ]
        )
        source: dict[str, Any] = {
            "file_kind": "longbridge_history_executions",
            "row_number": row_number,
            "transaction_type_raw": status or "Execution",
            "order_id": order_id,
            "execution_key": execution_key,
            "execution_datetime": datetime_text,
            "datetime_source_field": "execution_time",
            "amount_source": "longbridge_order_executions",
        }
        if metadata:
            source["order_type_raw"] = _normalize_text(metadata.get("order_type"))
            source["history_order_row_number"] = int(metadata.get("_row_number", 0))
        if contract_multiplier != Decimal("1"):
            source["contract_multiplier"] = _decimal_to_str(contract_multiplier)

        record: dict[str, Any] = {
            "date": date_text,
            "datetime": datetime_text,
            "type": side,
            "currency": _infer_longbridge_order_currency(metadata or row, symbol),
            "description": description,
            "source": source,
            "quantity_raw": _decimal_to_str(abs(quantity_dec)),
            "quantity_abs": _decimal_to_str(abs(quantity_dec)),
            "price_raw": _decimal_to_str(price_dec),
            "gross_amount_raw": _decimal_to_str(signed_amount_dec),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(signed_amount_dec),
        }
        if symbol:
            record["ticker"] = symbol
        record["normalized"] = _build_normalized_view(
            side,
            abs(quantity_dec),
            price_dec,
            signed_amount_dec,
            ZERO,
            signed_amount_dec,
        )
        records.append(record)
    return records


def _build_longbridge_transactions_from_order_records(
    order_records: list[dict[str, Any]],
    cash_flow_rows: list[Any],
    position_snapshot: dict[str, dict[str, str]],
    warnings: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], int]:
    materialized_order_records = [dict(record) for record in order_records]
    transactions: list[dict[str, Any]] = []
    stock_cash_flow_contract_rows, stock_cash_flow_fee_rows = (
        _build_longbridge_stock_cash_flow_rows(
            cash_flow_rows if isinstance(cash_flow_rows, list) else [],
            warnings,
        )
    )
    matched_stock_cash_flow_row_numbers = (
        _apply_longbridge_stock_cash_flows_to_order_records(
            materialized_order_records,
            stock_cash_flow_contract_rows,
            stock_cash_flow_fee_rows,
            warnings,
        )
    )
    transactions.extend(materialized_order_records)

    for row_number, row in enumerate(
        cash_flow_rows if isinstance(cash_flow_rows, list) else [], start=1
    ):
        if not isinstance(row, dict):
            continue
        if row_number in matched_stock_cash_flow_row_numbers:
            continue
        record = _build_longbridge_cash_flow_record(row, row_number, warnings)
        if record is not None:
            transactions.append(record)

    # Synthesize trades from unmatched contract flows (HK Fund Details often has more complete
    # contract counts than the History Orders xlsx for some symbols; unmatched contracts were
    # previously dropped, causing negative final holdings).
    for c in stock_cash_flow_contract_rows or []:
        c_rn = int(c.get("row_number") or -999)
        if c_rn in matched_stock_cash_flow_row_numbers:
            continue
        synth = _build_synthetic_contract_trade_record(c, warnings)
        if synth is not None:
            transactions.append(synth)

    _ii_records._sort_transactions(transactions)
    holdings_mismatches = _ii_records._validate_holdings(
        transactions, position_snapshot
    )
    return transactions, holdings_mismatches, len(matched_stock_cash_flow_row_numbers)


def _build_synthetic_contract_trade_record(
    contract: dict[str, Any], warnings: list[str]
) -> dict[str, Any] | None:
    """Create a buy/sell txn from an unmatched Fund Details contract flow.

    Used for HK (and potentially SG) file imports where the History Orders xlsx
    may under-count some fills compared to the complete contract movements in Fund Details.
    This ensures final replayed holdings net to zero when the source data intends flat positions.
    """
    if not isinstance(contract, dict):
        return None
    symbol = _normalize_text(contract.get("symbol"))
    side = _normalize_text(contract.get("side")).lower()
    if side not in {"buy", "sell"} or not symbol:
        return None
    gross_dec = contract.get("gross_amount")
    if gross_dec is None:
        gross_dec = _longbridge_decimal(
            contract.get("gross_amount"), "gross_amount", 0, warnings
        )
    shares_dec = contract.get("shares")
    if shares_dec is None or shares_dec == ZERO:
        # shares should have been populated
        return None
    try:
        shares_dec = abs(Decimal(str(shares_dec)))
    except (InvalidOperation, ValueError):
        shares_dec = abs(Decimal(str(shares_dec or 0)))
    if shares_dec <= ZERO:
        return None
    gross_abs = abs(Decimal(str(gross_dec or 0)))
    if gross_abs <= ZERO:
        return None
    price_dec = (
        (gross_abs / shares_dec).quantize(Decimal("0.0001"))
        if shares_dec > ZERO
        else None
    )

    parsed_t = contract.get("time")
    date_text, datetime_text = (
        _longbridge_datetime_fields_to_strings(parsed_t) if parsed_t else ("", "")
    )
    booking_date = _normalize_text(contract.get("booking_date"))
    if booking_date:
        try:
            date_text = date.fromisoformat(booking_date).isoformat()
            datetime_text = f"{date_text} {DEFAULT_CONVENTION_TIME}"
        except ValueError:
            warnings.append(
                f"Longbridge Fund Details contract row {contract.get('row_number')}: "
                f"invalid booking date {booking_date!r}."
            )
    if not date_text:
        # fallback to a safe date; should be rare
        date_text = "1970-01-01"
        datetime_text = f"{date_text} {DEFAULT_CONVENTION_TIME}"

    signed_gross = -gross_abs if side == "buy" else gross_abs
    record: dict[str, Any] = {
        "date": date_text,
        "datetime": datetime_text,
        "type": side,
        "currency": _normalize_text(contract.get("currency")),
        "description": f"Fund Details contract {symbol}",
        "source": {
            "file_kind": "longbridge_fund_details_contract",
            "row_number": contract.get("row_number"),
            "synthetic_from_unmatched_contract": True,
            "fund_details_booking_date": date_text,
        },
        "quantity_raw": _decimal_to_str(abs(shares_dec)),
        "quantity_abs": _decimal_to_str(abs(shares_dec)),
        "price_raw": _decimal_to_str(price_dec) if price_dec else None,
        "gross_amount_raw": _decimal_to_str(signed_gross),
        "commission_raw": "0",
        "net_amount_raw": _decimal_to_str(signed_gross),
    }
    if symbol:
        record["ticker"] = symbol
    record["normalized"] = _build_normalized_view(
        side,
        abs(shares_dec),
        price_dec,
        signed_gross,
        ZERO,
        signed_gross,
    )
    return record


def _iter_longbridge_date_windows(
    start_day: date,
    end_day: date,
    *,
    window_days: int = LONGBRIDGE_IMPORT_WINDOW_DAYS,
) -> list[tuple[date, date]]:
    windows: list[tuple[date, date]] = []
    cursor = start_day
    normalized_window_days = max(1, int(window_days))
    while cursor <= end_day:
        window_end = min(cursor + timedelta(days=normalized_window_days - 1), end_day)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)
    return windows


def _longbridge_payload_rows(payload: Any, row_keys: tuple[str, ...]) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in row_keys:
            rows = payload.get(key)
            if isinstance(rows, list):
                return rows
    return []


def _is_longbridge_retryable_window_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "408" in message
        or "request timeout" in message
        or "timed out" in message
        or "timeout" in message
        or "internal server error" in message
        or "api error (code 14)" in message
    )


def _fetch_longbridge_cli_rows_for_window(
    settings: BrokerSettings,
    base_arguments: list[str],
    row_keys: tuple[str, ...],
    start_day: date,
    end_day: date,
    *,
    timeout_seconds: int,
    min_retry_window_days: int = LONGBRIDGE_IMPORT_MIN_RETRY_WINDOW_DAYS,
) -> list[Any]:
    try:
        payload = _investment_import_compat.run_longbridge_cli_json(
            settings,
            [
                *base_arguments,
                "--start",
                start_day.isoformat(),
                "--end",
                end_day.isoformat(),
                "--format",
                "json",
            ],
            timeout_seconds=timeout_seconds,
        )
        return _longbridge_payload_rows(payload, row_keys)
    except Exception as exc:
        span_days = (end_day - start_day).days + 1
        if not _is_longbridge_retryable_window_error(exc) or span_days <= max(
            1, min_retry_window_days
        ):
            raise RuntimeError(
                "Longbridge CLI request failed for "
                f"{start_day.isoformat()} to {end_day.isoformat()}: {exc}"
            ) from exc
        midpoint = start_day + timedelta(days=(span_days // 2) - 1)
        return [
            *_fetch_longbridge_cli_rows_for_window(
                settings,
                base_arguments,
                row_keys,
                start_day,
                midpoint,
                timeout_seconds=timeout_seconds,
                min_retry_window_days=min_retry_window_days,
            ),
            *_fetch_longbridge_cli_rows_for_window(
                settings,
                base_arguments,
                row_keys,
                midpoint + timedelta(days=1),
                end_day,
                timeout_seconds=timeout_seconds,
                min_retry_window_days=min_retry_window_days,
            ),
        ]


def _fetch_longbridge_cli_rows_windowed(
    settings: BrokerSettings,
    base_arguments: list[str],
    row_keys: tuple[str, ...],
    start_day: date,
    end_day: date,
    *,
    timeout_seconds: int = 45,
    window_days: int = LONGBRIDGE_IMPORT_WINDOW_DAYS,
) -> tuple[list[Any], int]:
    rows: list[Any] = []
    windows = _iter_longbridge_date_windows(start_day, end_day, window_days=window_days)
    for window_start, window_end in windows:
        rows.extend(
            _fetch_longbridge_cli_rows_for_window(
                settings,
                base_arguments,
                row_keys,
                window_start,
                window_end,
                timeout_seconds=timeout_seconds,
            )
        )
    return rows, len(windows)


def _parse_longbridge_datetime(value: object) -> datetime | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    if normalized.isdigit():
        try:
            return datetime.fromtimestamp(int(normalized), tz=timezone.utc)
        except (OverflowError, ValueError):
            return None
    iso_candidates = [
        normalized,
        normalized.replace("Z", "+00:00"),
    ]
    for candidate in iso_candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            return (
                parsed
                if parsed.tzinfo is not None
                else parsed.replace(tzinfo=timezone.utc)
            )
        except ValueError:
            continue
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(normalized, pattern)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _longbridge_datetime_fields_to_strings(
    value: object,
    *,
    date_timezone: timezone | ZoneInfo = timezone.utc,
) -> tuple[str, str]:
    parsed = _parse_longbridge_datetime(value)
    if parsed is None:
        return "", ""
    utc_normalized = parsed.astimezone(timezone.utc)
    date_normalized = parsed.astimezone(date_timezone)
    return date_normalized.date().isoformat(), utc_normalized.strftime(
        "%Y-%m-%d %H:%M:%S"
    )


def _longbridge_parsed_datetime_to_strings(
    parsed: datetime,
    *,
    date_timezone: timezone | ZoneInfo = timezone.utc,
) -> tuple[str, str]:
    utc_normalized = parsed.astimezone(timezone.utc)
    date_normalized = parsed.astimezone(date_timezone)
    return date_normalized.date().isoformat(), utc_normalized.strftime(
        "%Y-%m-%d %H:%M:%S"
    )


def _longbridge_decimal(
    value: object, field_name: str, row_number: int, warnings: list[str]
) -> Decimal | None:
    return _parse_decimal(str(value or ""), field_name, row_number, warnings)


def _normalize_longbridge_order_status(value: object) -> str:
    return re.sub(r"[\s_\-]+", "", _normalize_text(value).lower())


def _longbridge_symbol_date_timezone(symbol: str) -> timezone | ZoneInfo:
    normalized_symbol = normalize_ticker(_normalize_text(symbol))
    market = normalized_symbol.rsplit(".", 1)[-1] if "." in normalized_symbol else ""
    return LONGBRIDGE_MARKET_TIMEZONES.get(market.upper(), timezone.utc)


def _longbridge_contract_multiplier(symbol: str) -> Decimal:
    normalized_symbol = normalize_ticker(_normalize_text(symbol))
    if "." not in normalized_symbol:
        return Decimal("1")
    code, market = normalized_symbol.rsplit(".", 1)
    if market.upper() == "US" and LONGBRIDGE_US_OPTION_SYMBOL_PATTERN.fullmatch(code):
        return Decimal("100")
    return Decimal("1")


def _longbridge_order_datetime_fields_to_strings(
    row: dict[str, Any],
    symbol: str,
) -> tuple[str, str, str]:
    date_timezone = _longbridge_symbol_date_timezone(symbol)

    for field_name in LONGBRIDGE_ORDER_TIME_FIELDS:
        raw_value = row.get(field_name)
        date_text, datetime_text = _longbridge_datetime_fields_to_strings(
            raw_value,
            date_timezone=date_timezone,
        )
        if date_text:
            return date_text, datetime_text, field_name
    return "", "", ""


def _infer_longbridge_order_currency(row: dict[str, Any], symbol: str) -> str | None:
    explicit_currency = _normalize_text(row.get("currency"))
    if explicit_currency:
        return explicit_currency
    normalized = normalize_ticker(symbol)
    if normalized.endswith(".HK"):
        return "HKD"
    if normalized.endswith(".SH") or normalized.endswith(".SZ"):
        return "CNY"
    # US stocks (and other bare symbols) default to USD for Longbridge imports.
    # Project canonical form for US is bare (no .US suffix).
    return "USD"


def _normalize_longbridge_flow_type(
    flow_name: str, description: str, balance: Decimal | None
) -> str:
    normalized_flow = _normalize_whitespace(flow_name).lower()
    normalized_description = _normalize_whitespace(description).lower()
    if "currency conversion" in normalized_flow:
        return "forex_trade_component"
    if normalized_flow == "kol" or "kol" in normalized_flow:
        return "kol_reward"
    if (
        "promotion adjustment" in normalized_flow
        or "cash reward" in normalized_flow
        or "stock cash coupon" in normalized_flow
        or "cash coupon" in normalized_flow
        or "rewards center" in normalized_flow
        or "奖励" in normalized_flow
    ):
        return "kol_reward"
    if normalized_flow.startswith("rev -") or "reversal" in normalized_flow:
        return "adjustment"
    if normalized_flow == "corp action fee":
        return "foreign_tax_withholding"
    if normalized_flow == "others":
        return "adjustment"
    if normalized_flow == "credit corporate action funds":
        return "adjustment"
    if normalized_flow == "debit corporate action funds":
        return "foreign_tax_withholding"
    if normalized_flow in {"cash deposit", "deposit cash"}:
        return "deposit"
    if normalized_flow in {"cash withdrawal", "withdrawal cash", "cancel withdrawal"}:
        return "withdrawal"
    if normalized_flow == "credit interest":
        return "credit_interest"
    if normalized_flow == "debit interest":
        return "debit_interest"
    if normalized_flow == "payment in lieu":
        return "payment_in_lieu"
    if "dividend" in normalized_flow:
        return "dividend"
    if (
        "withholding tax" in normalized_description
        or "withholding tax" in normalized_flow
    ):
        return "foreign_tax_withholding"
    if normalized_flow in {"placement", "redemption"}:
        return "adjustment"
    if balance is not None and balance > ZERO:
        return "deposit"
    if balance is not None and balance < ZERO:
        return "withdrawal"
    return "adjustment"


def _is_longbridge_mmf_sweep(flow_name: str, description: str) -> bool:
    """Detect money market fund (GaoTeng/WeValue/Ping An etc.) internal sweeps.

    Treat as an interest-bearing cash equivalent. Skip these txns entirely so they
    do not affect running cash or equity curve (no artificial in/out swings).
    Real interest/ yield posted as separate entries will be kept as credit_interest etc.
    Also covers "unit trust" subscriptions/redemptions for these MMFs.
    """
    fn = _normalize_whitespace(flow_name or "").lower()
    desc = _normalize_whitespace(description or "").lower()
    combined = fn + " " + desc
    mmf_keywords = (
        "gaoteng",
        "wevalue",
        "ping an",
        "pingan",
        "HK0000720752",
        "money mkt",
        "moneymkt",
        "usd money",
        "hkd money",
        "货币市场",
        "mmf",
        "money market",
    )
    is_mmf = any(kw in combined for kw in mmf_keywords)
    if not is_mmf:
        return False
    # Skip common sweep flows for money market funds.
    if fn in {"placement", "redemption"}:
        return True
    if "contract - unit trust" in fn or "unit trust" in fn:
        return True
    if "subscription of" in fn or "redemption of" in fn:
        return True
    if fn.startswith("ping an money market") or fn.startswith("pingan"):
        return True
    return False


def _infer_longbridge_cash_flow_symbol(row: dict[str, Any]) -> str:
    explicit_symbol = normalize_ticker(_normalize_text(row.get("symbol")))
    if explicit_symbol:
        return explicit_symbol

    description = _normalize_whitespace(row.get("description")).upper()
    if not description:
        return ""

    option_match = LONGBRIDGE_OPTION_DESCRIPTION_PATTERN.search(description)
    if option_match is not None:
        option_symbol = _normalize_text(option_match.group("symbol"))
        option_market = _normalize_text(option_match.group("market")).upper()
        if option_symbol and option_market:
            return normalize_ticker(f"{option_symbol}.{option_market}")

    # Fund details cash flows for options often have desc like "EQNR 230421 28.99 Put"
    # (no "OP/..." prefix). Extract underlying so related premium/fee flows attribute
    # to the base ticker (fixes EQNR P&L cal including its option activity).
    opt_fund_match = re.search(
        r"^(?P<symbol>[A-Z0-9]{1,16})\s+\d{6}\s+[\d.]+\s+(Call|Put)",
        description,
        re.IGNORECASE,
    )
    if opt_fund_match:
        sym = normalize_ticker(opt_fund_match.group("symbol"))
        mkt = LONGBRIDGE_CURRENCY_MARKET_SUFFIXES.get(
            _normalize_text(row.get("currency")).upper(), "US"
        )
        return normalize_ticker(f"{sym}.{mkt}") if mkt else sym

    bare_match = LONGBRIDGE_BARE_SYMBOL_DESCRIPTION_PATTERN.fullmatch(description)
    if bare_match is None:
        return ""

    inferred_symbol = _normalize_text(bare_match.group("symbol")).upper()
    inferred_market = _normalize_text(bare_match.group("market")).upper()
    if not inferred_market:
        inferred_market = LONGBRIDGE_CURRENCY_MARKET_SUFFIXES.get(
            _normalize_text(row.get("currency")).upper(),
            "",
        )
    if inferred_symbol and inferred_market:
        return normalize_ticker(f"{inferred_symbol}.{inferred_market}")
    return normalize_ticker(inferred_symbol) if inferred_symbol else ""


def _looks_like_longbridge_trade_cash_flow(flow_name: str, symbol: str) -> bool:
    normalized_flow = _normalize_whitespace(flow_name).lower()
    normalized_symbol = _normalize_text(symbol)
    if not normalized_symbol:
        return False
    if normalized_flow in LONGBRIDGE_STOCK_CONTRACT_FLOW_SIDES:
        return True
    if normalized_flow in LONGBRIDGE_STOCK_FEE_FLOW_SIDES:
        return False
    trade_markers = (
        "buy",
        "sell",
        "成交",
        "买入",
        "卖出",
        "filled",
    )
    return any(marker in normalized_flow for marker in trade_markers)


def _parse_longbridge_cash_flow_time(row: dict[str, Any]) -> datetime | None:
    return _parse_longbridge_datetime(row.get("time") or row.get("business_time"))


def _longbridge_time_distance_hours(
    left: datetime | None, right: datetime | None
) -> Decimal:
    if left is None or right is None:
        return Decimal("999999")
    seconds = abs(
        (left.astimezone(timezone.utc) - right.astimezone(timezone.utc)).total_seconds()
    )
    return Decimal(str(seconds)) / Decimal("3600")


def _build_longbridge_stock_cash_flow_rows(
    cash_flow_rows: list[Any],
    warnings: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    contract_rows: list[dict[str, Any]] = []
    fee_rows: list[dict[str, Any]] = []

    for row_number, row in enumerate(cash_flow_rows, start=1):
        if not isinstance(row, dict):
            continue
        flow_name = _normalize_text(
            row.get("flow_name") or row.get("transaction_flow_name")
        )
        normalized_flow = _normalize_whitespace(flow_name).lower()
        symbol = _infer_longbridge_cash_flow_symbol(row)
        if not symbol:
            continue
        balance_dec = _longbridge_decimal(
            row.get("balance"), "balance", row_number, warnings
        )
        if balance_dec is None or balance_dec == ZERO:
            continue
        parsed_time = _parse_longbridge_cash_flow_time(row)
        currency = _normalize_text(
            row.get("currency")
        ) or _infer_longbridge_order_currency(row, symbol)

        contract_side = LONGBRIDGE_STOCK_CONTRACT_FLOW_SIDES.get(normalized_flow)
        if contract_side:
            shares_dec = _longbridge_decimal(
                row.get("shares"), "shares", row_number, warnings
            )
            if shares_dec is None:
                desc = _normalize_text(
                    row.get("description") or row.get("flow_name") or ""
                )
                m = re.search(r"(-?\d+)\s+Shares", desc, re.IGNORECASE)
                if m:
                    try:
                        shares_dec = abs(Decimal(m.group(1)))
                    except (InvalidOperation, ValueError):
                        shares_dec = None
            if shares_dec is not None:
                shares_dec = abs(shares_dec)
            contract_rows.append(
                {
                    "row_number": row_number,
                    "symbol": symbol,
                    "side": contract_side,
                    "currency": currency,
                    "time": parsed_time,
                    "booking_date": (
                        _normalize_text(row.get("booking_date"))
                        if bool(row.get("authoritative_booking_date"))
                        else ""
                    ),
                    "gross_amount": balance_dec,
                    "shares": shares_dec,
                }
            )
            continue

        fee_side = LONGBRIDGE_STOCK_FEE_FLOW_SIDES.get(normalized_flow)
        if normalized_flow in LONGBRIDGE_STOCK_FEE_FLOW_SIDES:
            fee_rows.append(
                {
                    "row_number": row_number,
                    "symbol": symbol,
                    "side": fee_side,  # may be None for generic "stock trade fee"
                    "currency": currency,
                    "time": parsed_time,
                    "amount": balance_dec,
                    "flow_name": flow_name,
                }
            )

    return contract_rows, fee_rows


def _apply_longbridge_fund_details_booking_dates(
    transactions: list[dict[str, Any]],
    cash_flow_rows: list[dict[str, Any]],
    warnings: list[str],
) -> int:
    """Keep Fund Details booking dates authoritative while retaining order audit times."""
    booking_dates_by_row = {
        row_number: _normalize_text(row.get("booking_date"))
        for row_number, row in enumerate(cash_flow_rows, start=1)
        if isinstance(row, dict)
        and bool(row.get("authoritative_booking_date"))
        and _normalize_text(row.get("booking_date"))
    }
    updated_count = 0
    for transaction in transactions:
        if _normalize_text(transaction.get("type")).lower() not in {"buy", "sell"}:
            continue
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )
        contract_row_numbers = source.get("cash_flow_contract_row_numbers")
        if not isinstance(contract_row_numbers, list):
            contract_row_number = source.get("cash_flow_contract_row_number") or (
                source.get("row_number")
                if _normalize_text(source.get("file_kind"))
                == "longbridge_fund_details_contract"
                else None
            )
            contract_row_numbers = (
                [contract_row_number] if contract_row_number is not None else []
            )

        booking_dates = sorted(
            {
                booking_dates_by_row.get(int(row_number), "")
                for row_number in contract_row_numbers
                if row_number is not None
            }
            - {""}
        )
        if not booking_dates:
            continue
        booking_date = booking_dates[0]
        if len(booking_dates) > 1:
            warnings.append(
                "Longbridge order "
                f"{source.get('order_id') or source.get('row_number')}: matched Fund Details "
                f"contracts span booking dates {', '.join(booking_dates)}; used {booking_date}."
            )

        original_date = _normalize_text(transaction.get("date"))
        original_datetime = _normalize_text(transaction.get("datetime"))
        if (
            _normalize_text(source.get("file_kind"))
            != "longbridge_fund_details_contract"
        ):
            if original_date:
                source.setdefault("history_order_date", original_date)
            if original_datetime:
                source.setdefault("history_order_datetime", original_datetime)
        source["fund_details_booking_date"] = booking_date
        source["fund_details_contract_booking_dates"] = booking_dates
        transaction["source"] = source
        transaction["date"] = booking_date
        transaction["datetime"] = f"{booking_date} {DEFAULT_CONVENTION_TIME}"
        updated_count += 1
    return updated_count


def _select_longbridge_cash_flow_contract_indexes(
    candidates: list[tuple[int, dict[str, Any]]],
    target_amount: Decimal,
    record_time: datetime | None,
) -> list[int]:
    if not candidates:
        return []

    ordered_candidates = sorted(
        candidates,
        key=lambda item: (
            _longbridge_time_distance_hours(item[1].get("time"), record_time),
            int(item[1]["row_number"]),
        ),
    )[:LONGBRIDGE_STOCK_CASH_FLOW_MATCH_MAX_CANDIDATES]

    ordered_amounts = [
        abs(ordered_candidate[1]["gross_amount"])
        for ordered_candidate in ordered_candidates
    ]
    remaining_amounts: list[Decimal] = [ZERO] * (len(ordered_amounts) + 1)
    for index in range(len(ordered_amounts) - 1, -1, -1):
        remaining_amounts[index] = remaining_amounts[index + 1] + ordered_amounts[index]

    best_score: tuple[Decimal, int, Decimal, tuple[int, ...]] | None = None
    best_indexes: list[int] = []

    def _search(
        position: int,
        running_total: Decimal,
        running_time_distance: Decimal,
        selected_positions: list[int],
    ) -> None:
        nonlocal best_score, best_indexes

        if selected_positions:
            difference = abs(running_total - target_amount)
            if difference <= LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE:
                selected_row_numbers = tuple(
                    int(ordered_candidates[selected_position][1]["row_number"])
                    for selected_position in selected_positions
                )
                score = (
                    difference,
                    len(selected_positions),
                    running_time_distance,
                    selected_row_numbers,
                )
                if best_score is None or score < best_score:
                    best_score = score
                    best_indexes = [
                        ordered_candidates[selected_position][0]
                        for selected_position in selected_positions
                    ]

        if position >= len(ordered_candidates):
            return
        if running_total > target_amount + LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE:
            return
        if (
            running_total + remaining_amounts[position]
            < target_amount - LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE
        ):
            return

        _, candidate = ordered_candidates[position]
        candidate_amount = abs(candidate["gross_amount"])
        candidate_time_distance = _longbridge_time_distance_hours(
            candidate.get("time"),
            record_time,
        )

        _search(
            position + 1,
            running_total + candidate_amount,
            running_time_distance + candidate_time_distance,
            [*selected_positions, position],
        )
        _search(position + 1, running_total, running_time_distance, selected_positions)

    _search(0, ZERO, ZERO, [])
    return best_indexes


def _select_longbridge_cash_flow_fee_indexes(
    record: dict[str, Any],
    contract_rows: list[dict[str, Any]],
    fee_rows: list[dict[str, Any]],
    matched_contract_indexes: list[int],
    matched_fee_indexes: set[int],
) -> list[int]:
    if not matched_contract_indexes:
        return []

    ticker = _normalize_text(record.get("ticker"))
    side = _normalize_text(record.get("type")).lower()
    currency = _normalize_text(record.get("currency"))
    contract_times = [
        contract_rows[index].get("time")
        for index in matched_contract_indexes
        if contract_rows[index].get("time") is not None
    ]
    latest_contract_time = max(contract_times) if contract_times else None

    candidates: list[tuple[Decimal, int, dict[str, Any]]] = []
    for index, fee in enumerate(fee_rows):
        if index in matched_fee_indexes:
            continue
        if fee.get("symbol") != ticker:
            continue
        fside = fee.get("side")
        if fside and fside != side:
            continue
        if _normalize_text(fee.get("currency")) != currency:
            continue
        time_distance = (
            min(
                _longbridge_time_distance_hours(fee.get("time"), contract_time)
                for contract_time in contract_times
            )
            if contract_times
            else Decimal("999999")
        )
        if time_distance > LONGBRIDGE_STOCK_CASH_FLOW_MATCH_HOURS:
            continue
        if (
            latest_contract_time is not None
            and fee.get("time") is not None
            and fee["time"] < latest_contract_time
        ):
            continue
        candidates.append((time_distance, index, fee))

    if not candidates:
        return []

    candidates.sort(key=lambda item: (item[0], int(item[2]["row_number"])))
    return [candidates[0][1]]


def _apply_longbridge_stock_cash_flows_to_order_records(
    order_records: list[dict[str, Any]],
    contract_rows: list[dict[str, Any]],
    fee_rows: list[dict[str, Any]],
    warnings: list[str],
) -> set[int]:
    matched_contract_indexes: set[int] = set()
    matched_fee_indexes: set[int] = set()
    matched_row_numbers: set[int] = set()

    for record in order_records:
        ticker = _normalize_text(record.get("ticker"))
        side = _normalize_text(record.get("type")).lower()
        currency = _normalize_text(record.get("currency"))
        gross_amount = _parse_decimal(
            record.get("gross_amount_raw"), "gross_amount_raw", 0, []
        )
        record_time = _parse_longbridge_datetime(record.get("datetime"))
        if not ticker or side not in {"buy", "sell"} or gross_amount is None:
            continue

        candidates: list[tuple[int, dict[str, Any]]] = []
        for index, contract in enumerate(contract_rows):
            if index in matched_contract_indexes:
                continue
            if contract.get("symbol") != ticker or contract.get("side") != side:
                continue
            if _normalize_text(contract.get("currency")) != currency:
                continue
            time_distance = _longbridge_time_distance_hours(
                contract.get("time"), record_time
            )
            if time_distance > LONGBRIDGE_STOCK_CASH_FLOW_MATCH_HOURS:
                continue
            candidates.append((index, contract))

        selected_contract_indexes = _select_longbridge_cash_flow_contract_indexes(
            candidates,
            abs(gross_amount),
            record_time,
        )
        if not selected_contract_indexes:
            warnings.append(
                "Longbridge order "
                f"{_normalize_text(record.get('source', {}).get('order_id')) or record.get('source', {}).get('row_number')}: "
                "kept the order-derived gross amount because no matching stock cash-flow group "
                "was within the amount tolerance."
            )
            continue

        matched_contract_indexes.update(selected_contract_indexes)
        selected_contracts = [
            contract_rows[index] for index in selected_contract_indexes
        ]
        matched_row_numbers.update(
            int(contract["row_number"]) for contract in selected_contracts
        )

        fee_indexes = _select_longbridge_cash_flow_fee_indexes(
            record,
            contract_rows,
            fee_rows,
            selected_contract_indexes,
            matched_fee_indexes,
        )
        matched_fee_indexes.update(fee_indexes)
        matched_row_numbers.update(
            int(fee_rows[index]["row_number"]) for index in fee_indexes
        )

        signed_gross_amount = sum(
            abs(contract["gross_amount"]) for contract in selected_contracts
        )
        if side == "buy":
            signed_gross_amount = -signed_gross_amount
        commission_dec = -sum(abs(fee_rows[index]["amount"]) for index in fee_indexes)
        net_amount_dec = signed_gross_amount + commission_dec

        record["gross_amount_raw"] = _decimal_to_str(signed_gross_amount)
        record["commission_raw"] = _decimal_to_str(commission_dec)
        record["commission_abs"] = _decimal_to_str(abs(commission_dec))
        record["net_amount_raw"] = _decimal_to_str(net_amount_dec)
        source = record.get("source")
        if isinstance(source, dict):
            contract_row_numbers = sorted(
                int(contract["row_number"]) for contract in selected_contracts
            )
            source["cash_flow_contract_row_numbers"] = contract_row_numbers
            if len(contract_row_numbers) == 1:
                source["cash_flow_contract_row_number"] = contract_row_numbers[0]
            else:
                source.pop("cash_flow_contract_row_number", None)
            source["cash_flow_fee_row_numbers"] = sorted(
                int(fee_rows[index]["row_number"]) for index in fee_indexes
            )

        quantity_dec = _parse_decimal(record.get("quantity_raw"), "quantity_raw", 0, [])
        price_dec = _parse_decimal(record.get("price_raw"), "price_raw", 0, [])
        record["normalized"] = _build_normalized_view(
            side,
            quantity_dec,
            price_dec,
            signed_gross_amount,
            commission_dec,
            net_amount_dec,
        )

    return matched_row_numbers


def _build_longbridge_position_snapshot(
    settings: BrokerSettings,
    warnings: list[str],
) -> tuple[dict[str, dict[str, str]], bool]:
    try:
        payload = _investment_import_compat.run_longbridge_cli_json(
            settings,
            ["positions", "--format", "json"],
            timeout_seconds=20,
        )
    except Exception as exc:
        warnings.append(
            f"Longbridge positions snapshot could not be refreshed during import: {exc}"
        )
        return {}, False

    snapshots: dict[str, dict[str, str]] = {}
    for row_number, row in enumerate(
        payload if isinstance(payload, list) else [], start=1
    ):
        if not isinstance(row, dict):
            continue
        symbol = normalize_ticker(
            _normalize_text(row.get("symbol") or row.get("stock_code"))
        )
        if not symbol:
            continue
        quantity_dec = _longbridge_decimal(
            row.get("quantity"),
            "positions.quantity",
            row_number,
            warnings,
        )
        if quantity_dec is None or quantity_dec == ZERO:
            continue
        cost_price_dec = _longbridge_decimal(
            row.get("cost_price"),
            "positions.cost_price",
            row_number,
            warnings,
        )
        currency = (
            _normalize_text(row.get("currency"))
            or _infer_longbridge_order_currency(row, symbol)
            or ""
        )
        cost_basis_dec = abs(quantity_dec) * (cost_price_dec or ZERO)
        existing_snapshot = snapshots.get(symbol)
        if existing_snapshot is None:
            snapshots[symbol] = {
                "asset_category": "Stock",
                "currency": currency,
                "quantity": _decimal_to_str(quantity_dec) or "0",
                "cost_price": _decimal_to_str(cost_price_dec) or "0",
                "cost_basis": _decimal_to_str(cost_basis_dec) or "0",
                "market": _normalize_text(row.get("market")),
                "account_channel": _normalize_text(row.get("account_channel")),
            }
            continue

        existing_quantity = (
            _parse_decimal(
                existing_snapshot.get("quantity"), "positions.quantity", 0, []
            )
            or ZERO
        )
        existing_cost_basis = (
            _parse_decimal(
                existing_snapshot.get("cost_basis"), "positions.cost_basis", 0, []
            )
            or ZERO
        )
        merged_quantity = existing_quantity + quantity_dec
        merged_cost_basis = existing_cost_basis + cost_basis_dec
        merged_cost_price = (
            merged_cost_basis / abs(merged_quantity)
            if merged_quantity != ZERO
            else ZERO
        )
        existing_snapshot["quantity"] = _decimal_to_str(merged_quantity) or "0"
        existing_snapshot["cost_basis"] = _decimal_to_str(merged_cost_basis) or "0"
        existing_snapshot["cost_price"] = _decimal_to_str(merged_cost_price) or "0"
        if not _normalize_text(existing_snapshot.get("currency")):
            existing_snapshot["currency"] = currency
        if not _normalize_text(existing_snapshot.get("market")):
            existing_snapshot["market"] = _normalize_text(row.get("market"))
        if _normalize_text(existing_snapshot.get("account_channel")) != _normalize_text(
            row.get("account_channel")
        ):
            existing_snapshot["account_channel"] = "multiple"
    return snapshots, True


def _build_longbridge_execution_summaries(
    execution_rows: list[Any],
    warnings: list[str],
) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for row_number, row in enumerate(
        execution_rows if isinstance(execution_rows, list) else [], start=1
    ):
        if not isinstance(row, dict):
            continue
        order_id = _normalize_text(row.get("order_id"))
        if not order_id:
            continue
        symbol = normalize_ticker(_normalize_text(row.get("symbol")))
        quantity_dec = _longbridge_decimal(
            row.get("quantity"),
            "execution.quantity",
            row_number,
            warnings,
        )
        price_dec = _longbridge_decimal(
            row.get("price"),
            "execution.price",
            row_number,
            warnings,
        )
        if (
            quantity_dec is None
            or quantity_dec <= ZERO
            or price_dec is None
            or price_dec <= ZERO
        ):
            continue

        contract_multiplier = _longbridge_contract_multiplier(symbol)
        summary = summaries.setdefault(
            order_id,
            {
                "quantity": ZERO,
                "gross_amount": ZERO,
                "row_count": 0,
                "latest_time": None,
            },
        )
        summary["quantity"] += quantity_dec
        summary["gross_amount"] += abs(quantity_dec * price_dec * contract_multiplier)
        summary["row_count"] += 1

        parsed_time = _parse_longbridge_datetime(
            row.get("time") or row.get("trade_done_at")
        )
        latest_time = summary.get("latest_time")
        if parsed_time is not None and (
            latest_time is None or parsed_time > latest_time
        ):
            summary["latest_time"] = parsed_time

    for summary in summaries.values():
        quantity_dec = summary.get("quantity")
        gross_amount_dec = summary.get("gross_amount")
        if quantity_dec and gross_amount_dec:
            summary["average_price"] = gross_amount_dec / quantity_dec
    return summaries


def _build_longbridge_history_order_record(
    row: dict[str, Any],
    row_number: int,
    warnings: list[str],
    execution_summaries: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    status = _normalize_text(row.get("status"))
    normalized_status = _normalize_longbridge_order_status(status)
    side_raw = _normalize_text(row.get("side"))
    side = side_raw.lower()
    if side not in {"buy", "sell"}:
        warnings.append(
            f"Longbridge history order row {row_number}: unsupported side {side_raw!r}."
        )
        return None
    if (
        normalized_status
        and normalized_status not in LONGBRIDGE_EXECUTED_ORDER_STATUSES
    ):
        return None

    order_id = _normalize_text(row.get("order_id"))
    execution_summary = (execution_summaries or {}).get(order_id) if order_id else None
    quantity_dec = None
    price_dec = None
    gross_amount_dec = None
    if execution_summary:
        quantity_dec = execution_summary.get("quantity")
        price_dec = execution_summary.get("average_price")
        gross_amount_dec = execution_summary.get("gross_amount")

    if quantity_dec is None:
        quantity_dec = _longbridge_decimal(
            row.get("executed_quantity") or row.get("quantity"),
            "executed_quantity",
            row_number,
            warnings,
        )
    if price_dec is None:
        price_dec = _longbridge_decimal(
            row.get("executed_price") or row.get("price"),
            "executed_price",
            row_number,
            warnings,
        )
    if quantity_dec is None or quantity_dec <= ZERO:
        return None
    if price_dec is None or price_dec <= ZERO:
        warnings.append(
            f"Longbridge history order row {row_number}: missing executed price for order {row.get('order_id')!r}."
        )
        return None

    symbol = normalize_ticker(_normalize_text(row.get("symbol")))
    if gross_amount_dec is None:
        gross_amount_dec = abs(quantity_dec * price_dec)
    signed_amount_dec = -gross_amount_dec if side == "buy" else gross_amount_dec
    date_timezone: timezone | ZoneInfo = timezone.utc
    normalized_sym = normalize_ticker(symbol)
    # Bare symbols or former *.US are US market time for Longbridge.
    if not normalized_sym.endswith((".HK", ".SG", ".SH", ".SZ")):
        date_timezone = LONGBRIDGE_US_MARKET_TIMEZONE
    latest_execution_time = (
        execution_summary.get("latest_time") if execution_summary else None
    )
    if isinstance(latest_execution_time, datetime):
        date_text, datetime_text = _longbridge_parsed_datetime_to_strings(
            latest_execution_time,
            date_timezone=date_timezone,
        )
        datetime_source_field = "execution_latest_time"
    else:
        date_text, datetime_text, datetime_source_field = (
            _longbridge_order_datetime_fields_to_strings(
                row,
                symbol,
            )
        )
        if not date_text:
            warnings.append(
                f"Longbridge history order row {row_number}: missing order timestamp for order {row.get('order_id')!r}."
            )
            return None

    description = (
        _normalize_text(row.get("stock_name"))
        or symbol
        or _normalize_text(row.get("remark"))
    )
    record: dict[str, Any] = {
        "date": date_text,
        "datetime": datetime_text or f"{date_text} {DEFAULT_CONVENTION_TIME}",
        "type": side,
        "currency": _infer_longbridge_order_currency(row, symbol),
        "description": description or symbol or f"Longbridge {status or 'order'}",
        "source": {
            "file_kind": "longbridge_history_orders",
            "row_number": row_number,
            "transaction_type_raw": status or side_raw or "HistoryOrder",
            "order_id": order_id,
            "datetime_source_field": datetime_source_field,
        },
        "quantity_raw": _decimal_to_str(abs(quantity_dec)),
        "quantity_abs": _decimal_to_str(abs(quantity_dec)),
        "price_raw": _decimal_to_str(price_dec),
        "gross_amount_raw": _decimal_to_str(signed_amount_dec),
        "commission_raw": "0",
        "net_amount_raw": _decimal_to_str(signed_amount_dec),
    }
    if symbol:
        record["ticker"] = symbol
    if execution_summary:
        source = record.get("source")
        if isinstance(source, dict):
            source["amount_source"] = "longbridge_order_executions"
            source["execution_row_count"] = execution_summary.get("row_count")
            latest_time = execution_summary.get("latest_time")
            if isinstance(latest_time, datetime):
                source["latest_execution_datetime"] = latest_time.astimezone(
                    timezone.utc
                ).strftime("%Y-%m-%d %H:%M:%S")
    record["normalized"] = _build_normalized_view(
        side,
        abs(quantity_dec),
        price_dec,
        signed_amount_dec,
        ZERO,
        signed_amount_dec,
    )
    return record


def _build_longbridge_order_records(
    history_order_rows: list[Any],
    execution_rows: list[Any],
    warnings: list[str],
    *,
    start_day: date,
    end_day: date,
) -> list[dict[str, Any]]:
    execution_summaries = _build_longbridge_execution_summaries(
        execution_rows, warnings
    )
    order_records: list[dict[str, Any]] = []
    deduped_order_rows = list(
        _build_longbridge_order_metadata_map(history_order_rows).values()
    )
    deduped_order_rows.sort(key=lambda row: int(row.get("_row_number") or 0))

    for fallback_row_number, row in enumerate(deduped_order_rows, start=1):
        if not isinstance(row, dict):
            continue
        row_number = int(row.get("_row_number") or fallback_row_number)
        record = _build_longbridge_history_order_record(
            row,
            row_number,
            warnings,
            execution_summaries,
        )
        if record is None:
            continue
        record_date = _normalize_text(record.get("date"))
        if not record_date:
            continue
        try:
            record_day = date.fromisoformat(record_date)
        except ValueError:
            warnings.append(
                f"Longbridge history order row {row_number}: produced invalid trade date {record_date!r}."
            )
            continue
        if start_day <= record_day <= end_day:
            order_records.append(record)
    return order_records


def _build_longbridge_cash_flow_record(
    row: dict[str, Any],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    flow_name = _normalize_text(
        row.get("flow_name") or row.get("transaction_flow_name")
    )
    description = _normalize_text(row.get("description"))
    symbol = _infer_longbridge_cash_flow_symbol(row)
    if _looks_like_longbridge_trade_cash_flow(flow_name, symbol) and not bool(
        row.get("force_cash_flow_record")
    ):
        return None

    balance_dec = _longbridge_decimal(
        row.get("balance"), "balance", row_number, warnings
    )
    if balance_dec is None or balance_dec == ZERO:
        return None

    cash_equivalent_transfer = bool(row.get("cash_equivalent_transfer"))
    if (
        _is_longbridge_mmf_sweep(flow_name, description)
        and not cash_equivalent_transfer
    ):
        return None

    date_text, datetime_text = _longbridge_datetime_fields_to_strings(
        row.get("time") or row.get("business_time")
    )
    explicit_booking_date = _normalize_text(row.get("booking_date"))
    if explicit_booking_date:
        try:
            date_text = date.fromisoformat(explicit_booking_date).isoformat()
        except ValueError:
            warnings.append(
                f"Longbridge cash-flow row {row_number}: invalid booking date {explicit_booking_date!r}."
            )
    if not date_text:
        warnings.append(
            f"Longbridge cash-flow row {row_number}: missing business timestamp for flow {flow_name!r}."
        )
        return None

    mapped_type = _normalize_text(
        row.get("mapped_type_override")
    ) or _normalize_longbridge_flow_type(flow_name, description, balance_dec)
    net_amount_dec = balance_dec
    if cash_equivalent_transfer:
        equity_delta_dec = _longbridge_decimal(
            row.get("cash_equivalent_equity_delta_raw"),
            "cash_equivalent_equity_delta_raw",
            row_number,
            warnings,
        )
        net_amount_dec = equity_delta_dec if equity_delta_dec is not None else ZERO
    record: dict[str, Any] = {
        "date": date_text,
        "datetime": datetime_text or f"{date_text} {DEFAULT_CONVENTION_TIME}",
        "type": mapped_type,
        "currency": _normalize_text(row.get("currency")) or None,
        "description": description or flow_name or "Longbridge cash flow",
        "source": {
            "file_kind": "longbridge_cash_flow",
            "row_number": row_number,
            "transaction_type_raw": flow_name or "CashFlow",
            "business_type_raw": _normalize_text(row.get("business_type")),
        },
        "gross_amount_raw": _decimal_to_str(balance_dec),
        "net_amount_raw": _decimal_to_str(net_amount_dec),
    }
    source = record["source"]
    for source_key in (
        "fund_details_entry_number",
        "source_symbol_raw",
        "symbol_inference",
        "fee_category",
        "cash_equivalent_action",
        "cash_equivalent_fund_id",
        "cash_equivalent_principal_raw",
        "cash_equivalent_interest_raw",
        "cash_equivalent_cost_basis_after_raw",
        "cash_equivalent_units_raw",
        "excluded_from_broker_pnl",
    ):
        source_value = row.get(source_key)
        if source_value not in {None, ""}:
            source[source_key] = source_value
    if cash_equivalent_transfer:
        source["cash_equivalent_transfer"] = True
        source["cash_equivalent_transfer_amount_raw"] = _decimal_to_str(balance_dec)
    if symbol:
        record["ticker"] = symbol
    record["normalized"] = _build_normalized_view(
        mapped_type,
        None,
        None,
        balance_dec,
        None,
        net_amount_dec,
        is_cash_flow_override=not cash_equivalent_transfer,
    )
    if cash_equivalent_transfer:
        record["normalized"]["cash_equivalent_transfer"] = True
        record["normalized"]["cash_equivalent_action"] = _normalize_text(
            row.get("cash_equivalent_action")
        )
        record["normalized"]["cash_equivalent_fund_id"] = _normalize_text(
            row.get("cash_equivalent_fund_id")
        )
        record["normalized"]["cash_equivalent_principal_amount"] = _normalize_text(
            row.get("cash_equivalent_principal_raw")
        )
        record["normalized"]["cash_equivalent_interest_amount"] = _normalize_text(
            row.get("cash_equivalent_interest_raw")
        )
        record["normalized"]["cash_equivalent_equity_delta"] = _decimal_to_str(
            net_amount_dec
        )
        record["normalized"]["cash_equivalent_cash_delta"] = _decimal_to_str(
            balance_dec
        )
        record["normalized"]["cash_equivalent_value_after"] = _normalize_text(
            row.get("cash_equivalent_cost_basis_after_raw")
        )
    return record
