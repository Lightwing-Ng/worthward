"""Investment import domain: hsbc core.

Code version: v0.3.0
- Fixed: Pasted cash evidence periods include visible zero-net postings even
  though those rows remain excluded from the economic transaction ledger.
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Callable,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    HSBC_CORPORATE_EVENT_PAYMENT_PREFIX,
    HSBC_DIVIDEND_MATCH_LOOKBACK_DAYS,
    HSBC_DIVIDEND_NET_RETENTION_RATES,
    HSBC_EXPECTED_ACCOUNT_NUMBER,
    HSBC_EXPLICIT_FOREX_TRANSACTION_PATTERN,
    HSBC_FOREX_REFERENCE_PATTERN,
    HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN,
    HSBC_ORDER_STATUS_ROLLING_WINDOW_PATTERN,
    HSBC_PASTE_CHUNK_MARKER,
    HSBC_PORTFOLIO_UPDATED_PATTERN,
    InvalidOperation,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    base64,
    date,
    datetime,
    hashlib,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_merge_identity as _ii_merge_identity


def _parse_hsbc_capture_json(
    raw_capture: str,
    *,
    field_label: str,
    expected_page: str,
    require_us_market: bool = True,
) -> dict[str, Any]:
    capture_text = str(raw_capture or "").strip()
    if not capture_text:
        raise ValueError(f"{field_label} is required.")
    try:
        capture = json.loads(capture_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_label} must be valid JSON: {exc.msg}.") from exc
    if not isinstance(capture, dict):
        raise ValueError(f"{field_label} must decode to a JSON object.")
    page = _normalize_text(capture.get("page")).lower()
    if page != expected_page:
        raise ValueError(
            f"{field_label} must be collected from the HSBC {expected_page} page."
        )
    if not bool(capture.get("logged_in")):
        raise ValueError(
            f"{field_label} indicates the HSBC session was not logged on during capture."
        )
    language = _normalize_text(capture.get("language"))
    if language.lower() != "english":
        raise ValueError(
            f"{field_label} must be collected from the English HSBC interface."
        )
    market = _normalize_text(capture.get("market")).upper()
    if require_us_market and market != "US":
        raise ValueError(
            f"{field_label} must be collected from the HSBC US market view."
        )
    return capture


def _parse_hsbc_iso_date(value: Any, field_label: str) -> date:
    text = _normalize_text(value)
    if not text:
        raise ValueError(f"{field_label} is required.")
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{field_label} must be a valid ISO date.") from exc


def _parse_hsbc_decimal(
    value: Any,
    field_label: str,
    warnings: list[str],
    *,
    row_number: int = 0,
    required: bool = False,
) -> Decimal | None:
    text = _normalize_text(value).replace(",", "")
    if not text:
        if required:
            if row_number > 0:
                warnings.append(f"HSBC row {row_number}: missing {field_label}.")
            else:
                warnings.append(f"HSBC capture: missing {field_label}.")
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        if row_number > 0:
            warnings.append(
                f"HSBC row {row_number}: invalid {field_label} value {text!r}."
            )
        else:
            warnings.append(f"HSBC capture: invalid {field_label} value {text!r}.")
        return None


def _build_hsbc_position_snapshot(
    portfolio_capture: dict[str, Any],
    warnings: list[str],
) -> tuple[dict[str, dict[str, str]], str | None]:
    holdings = portfolio_capture.get("holdings")
    if not isinstance(holdings, list) or not holdings:
        raise ValueError(
            "The HSBC portfolio capture does not contain any holdings rows."
        )

    snapshots: dict[str, dict[str, str]] = {}
    capture_currency = (
        _normalize_text(portfolio_capture.get("currency")).upper() or "USD"
    )
    account_payload = (
        portfolio_capture.get("account")
        if isinstance(portfolio_capture.get("account"), dict)
        else {}
    )
    account_number = _normalize_text(account_payload.get("number"))

    for row_number, row in enumerate(holdings, start=1):
        if not isinstance(row, dict):
            continue
        symbol = normalize_ticker(_normalize_text(row.get("symbol")))
        if not symbol:
            warnings.append(f"HSBC portfolio row {row_number}: missing stock code.")
            continue
        quantity_dec = _parse_hsbc_decimal(
            row.get("quantity"),
            "quantity",
            warnings,
            row_number=row_number,
            required=True,
        )
        if quantity_dec is None or quantity_dec == ZERO:
            continue
        average_price_dec = (
            _parse_hsbc_decimal(
                row.get("average_purchase_price"),
                "average purchase price",
                warnings,
                row_number=row_number,
                required=True,
            )
            or ZERO
        )
        market_value_dec = (
            _parse_hsbc_decimal(
                row.get("market_value"),
                "market value",
                warnings,
                row_number=row_number,
                required=True,
            )
            or ZERO
        )
        last_price_dec = _parse_hsbc_decimal(
            row.get("last_price"),
            "last price",
            warnings,
            row_number=row_number,
            required=False,
        )
        tradable_quantity_dec = _parse_hsbc_decimal(
            row.get("tradable_quantity"),
            "tradable quantity",
            warnings,
            row_number=row_number,
            required=False,
        )
        currency = (
            _normalize_text(row.get("currency")).upper() or capture_currency or "USD"
        )
        exact_market_value_dec = (
            abs(quantity_dec) * last_price_dec
            if last_price_dec is not None and last_price_dec > ZERO
            else market_value_dec
        )
        snapshots[symbol] = {
            "asset_category": "Stock",
            "currency": currency,
            "quantity": _decimal_to_str(quantity_dec) or "0",
            "cost_price": _decimal_to_str(average_price_dec) or "0",
            "cost_basis": _decimal_to_str(abs(quantity_dec) * average_price_dec) or "0",
            "market_value": _decimal_to_str(exact_market_value_dec) or "0",
            "reported_market_value": _decimal_to_str(market_value_dec) or "0",
            "market_value_source": (
                "quantity_times_last_price"
                if last_price_dec is not None and last_price_dec > ZERO
                else "hsbc_compact_display_value"
            ),
            "reported_market_value_precision": "hsbc_compact_display_rounded",
            "market": "US",
            "full_name": _normalize_text(row.get("full_name")),
        }
        if last_price_dec is not None:
            snapshots[symbol]["last_price"] = _decimal_to_str(last_price_dec) or "0"
        if tradable_quantity_dec is not None:
            snapshots[symbol]["tradable_quantity"] = (
                _decimal_to_str(tradable_quantity_dec) or "0"
            )
        if account_number:
            snapshots[symbol]["account_number"] = account_number
    return snapshots, account_number or None


def _build_hsbc_order_records(
    orders_capture: dict[str, Any],
    *,
    start_day: date,
    end_day: date,
    warnings: list[str],
) -> list[dict[str, Any]]:
    filter_status = _normalize_text(orders_capture.get("filter_status"))
    if filter_status.lower() != "fully executed":
        raise ValueError(
            "The HSBC Order Status capture must be filtered to Fully Executed orders."
        )

    observed_start = _parse_hsbc_iso_date(
        orders_capture.get("observed_start_date"),
        "HSBC Order Status observed start date",
    )
    observed_end = _parse_hsbc_iso_date(
        orders_capture.get("observed_end_date"),
        "HSBC Order Status observed end date",
    )
    if observed_start != start_day or observed_end != end_day:
        raise ValueError(
            "The HSBC Order Status capture date range does not match the selected import date range."
        )

    rows = orders_capture.get("rows")
    if not isinstance(rows, list):
        raise ValueError("The HSBC Order Status capture is missing its rows array.")

    order_records: list[dict[str, Any]] = []
    seen_order_refs: set[str] = set()
    for row_number, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        order_reference = _normalize_text(
            row.get("order_reference") or row.get("order_reference_no")
        )
        if not order_reference:
            warnings.append(
                f"HSBC Order Status row {row_number}: missing order reference number."
            )
            continue
        if order_reference in seen_order_refs:
            warnings.append(
                f"HSBC Order Status row {row_number}: duplicate order reference {order_reference!r} was skipped."
            )
            continue
        seen_order_refs.add(order_reference)

        symbol = normalize_ticker(_normalize_text(row.get("symbol")))
        if not symbol:
            warnings.append(
                f"HSBC Order Status row {row_number}: missing stock code for order {order_reference!r}."
            )
            continue
        status = _normalize_text(row.get("status"))
        if status.lower() != "fully executed":
            continue
        side_raw = _normalize_text(row.get("transaction_type") or row.get("side"))
        side = side_raw.lower()
        if side not in {"buy", "sell"}:
            warnings.append(
                f"HSBC Order Status row {row_number}: unsupported transaction type {side_raw!r}."
            )
            continue

        order_day = _parse_hsbc_iso_date(
            row.get("order_date"),
            f"HSBC Order Status row {row_number} order date",
        )
        if not (start_day <= order_day <= end_day):
            warnings.append(
                f"HSBC Order Status row {row_number}: order {order_reference!r} falls outside the requested range."
            )
            continue

        quantity_dec = _parse_hsbc_decimal(
            row.get("executed_quantity") or row.get("quantity"),
            "executed quantity",
            warnings,
            row_number=row_number,
            required=True,
        )
        price_dec = _parse_hsbc_decimal(
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
        currency = _normalize_text(row.get("currency")).upper() or "USD"
        description = (
            _normalize_text(row.get("full_name"))
            or symbol
            or f"HSBC {status or side_raw or 'order'}"
        )
        record: dict[str, Any] = {
            "date": order_day.isoformat(),
            "datetime": f"{order_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": side,
            "ticker": symbol,
            "currency": currency,
            "description": description,
            "source": {
                "file_kind": "hsbc_order_status_capture",
                "row_number": row_number,
                "transaction_type_raw": side_raw or status or "HSBCOrder",
                "order_id": order_reference,
                "statement_order_id": order_reference,
                "order_status": status,
                "order_type": _normalize_text(row.get("order_type")),
                "page_number": row.get("page_number"),
                "page_row_number": row.get("page_row_number"),
                "captured_order_date_display": _normalize_text(
                    row.get("order_date_display")
                ),
            },
            "quantity_raw": _decimal_to_str(abs(quantity_dec)),
            "quantity_abs": _decimal_to_str(abs(quantity_dec)),
            "price_raw": _decimal_to_str(price_dec),
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
    return order_records


def _iter_hsbc_dashboard_row_items(row: dict[str, Any]) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    by_header = row.get("by_header") if isinstance(row.get("by_header"), dict) else {}
    for key, value in by_header.items():
        items.append((_normalize_text(str(key)).lower(), _normalize_text(value)))
    cells = row.get("cells") if isinstance(row.get("cells"), list) else []
    for index, value in enumerate(cells, start=1):
        items.append((f"column_{index}", _normalize_text(value)))
    return items


def _find_hsbc_dashboard_row_value(
    row: dict[str, Any],
    header_keywords: tuple[str, ...],
) -> str:
    for key, value in _iter_hsbc_dashboard_row_items(row):
        if value and any(keyword in key for keyword in header_keywords):
            return value
    return ""


def _parse_hsbc_dashboard_row_date(
    row: dict[str, Any],
    *,
    row_number: int,
    warnings: list[str],
) -> date | None:
    candidates = [
        _find_hsbc_dashboard_row_value(
            row,
            ("date", "posting", "transaction date", "value date", "book date"),
        )
    ]
    cells = row.get("cells") if isinstance(row.get("cells"), list) else []
    if cells:
        candidates.extend(_normalize_text(value) for value in cells[:2])
    for raw_candidate in candidates:
        candidate = _normalize_text(raw_candidate)
        if not candidate:
            continue
        for fmt in ("%Y-%m-%d", "%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
    warnings.append(
        f"HSBC dashboard row {row_number}: missing or invalid transaction date."
    )
    return None


def _parse_hsbc_dashboard_signed_amount(
    row: dict[str, Any],
    *,
    row_number: int,
    warnings: list[str],
) -> Decimal | None:
    credit_text = _find_hsbc_dashboard_row_value(row, ("credit", "deposit", "money in"))
    debit_text = _find_hsbc_dashboard_row_value(row, ("debit", "withdraw", "money out"))
    if credit_text or debit_text:
        credit_amount = _parse_hsbc_decimal(
            credit_text,
            "credit amount",
            warnings,
            row_number=row_number,
            required=False,
        )
        debit_amount = _parse_hsbc_decimal(
            debit_text, "debit amount", warnings, row_number=row_number, required=False
        )
        if credit_amount and credit_amount > ZERO:
            return abs(credit_amount)
        if debit_amount and debit_amount > ZERO:
            return -abs(debit_amount)
    amount_text = _find_hsbc_dashboard_row_value(
        row, ("amount", "transaction amount", "value")
    )
    if not amount_text:
        amount_text = _normalize_text(row.get("row_text"))
    if not amount_text:
        warnings.append(f"HSBC dashboard row {row_number}: missing amount.")
        return None
    normalized_amount = amount_text.upper()
    sign = (
        -1
        if (
            normalized_amount.startswith("-")
            or " DR" in normalized_amount
            or normalized_amount.endswith("DR")
            or (normalized_amount.startswith("(") and normalized_amount.endswith(")"))
        )
        else 1
    )
    amount_dec = _parse_hsbc_decimal(
        amount_text, "amount", warnings, row_number=row_number, required=False
    )
    if amount_dec is None:
        warnings.append(
            f"HSBC dashboard row {row_number}: could not parse amount from {amount_text!r}."
        )
        return None
    if amount_dec == ZERO:
        return None
    return abs(amount_dec) * sign


def _build_hsbc_dashboard_cash_records(
    dashboard_capture: dict[str, Any],
    *,
    start_day: date,
    end_day: date,
    warnings: list[str],
) -> list[dict[str, Any]]:
    rows = dashboard_capture.get("rows")
    if not isinstance(rows, list):
        raise ValueError("The HSBC dashboard capture is missing its rows array.")

    cash_records: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        transaction_day = _parse_hsbc_dashboard_row_date(
            row, row_number=row_number, warnings=warnings
        )
        if transaction_day is None or not (start_day <= transaction_day <= end_day):
            continue
        currency = (
            _find_hsbc_dashboard_row_value(row, ("currency",))
            or ("USD" if "USD" in _normalize_text(row.get("row_text")).upper() else "")
        ).upper()
        if currency != "USD":
            continue
        signed_amount_dec = _parse_hsbc_dashboard_signed_amount(
            row, row_number=row_number, warnings=warnings
        )
        if signed_amount_dec is None or signed_amount_dec == ZERO:
            continue
        mapped_type = "deposit" if signed_amount_dec > ZERO else "withdrawal"
        description = (
            _find_hsbc_dashboard_row_value(
                row,
                (
                    "description",
                    "details",
                    "transaction",
                    "narrative",
                    "remark",
                    "reference",
                    "type",
                ),
            )
            or _normalize_text(
                (row.get("cells") or ["", ""])[1]
                if isinstance(row.get("cells"), list)
                else ""
            )
            or f"HSBC dashboard {mapped_type}"
        )
        record: dict[str, Any] = {
            "date": transaction_day.isoformat(),
            "datetime": f"{transaction_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": mapped_type,
            "ticker": "",
            "currency": "USD",
            "description": description,
            "source": {
                "file_kind": "hsbc_dashboard_capture",
                "row_number": row_number,
                "page_number": row.get("page_number"),
                "raw_row_text": _normalize_text(row.get("row_text")),
                "table_headers": dashboard_capture.get("table_headers"),
                "unified_cash_source": "hsbc_online_dashboard",
            },
            "quantity_raw": "",
            "quantity_abs": "",
            "price_raw": "",
            "gross_amount_raw": _decimal_to_str(signed_amount_dec),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(signed_amount_dec),
        }
        record["normalized"] = _build_normalized_view(
            mapped_type,
            None,
            None,
            signed_amount_dec,
            ZERO,
            signed_amount_dec,
            is_cash_flow_override=True,
        )
        cash_records.append(record)
    return cash_records


def _parse_hsbc_human_date(value: Any, field_label: str) -> date:
    text = _normalize_text(value)
    if not text:
        raise ValueError(f"{field_label} is required.")
    normalized_text = re.sub(r"\s+U\.S\.\s+ET$", "", text, flags=re.IGNORECASE).strip()
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(normalized_text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{field_label} must be a valid HSBC date.")


def _extract_hsbc_account_number_from_text(raw_text: str) -> str:
    translated = str(raw_text or "").translate(
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
    matches = [
        _ii_basics._normalize_hsbc_account_number(match.group(0))
        for match in re.finditer(r"\d{3}\s*-\s*\d{6}\s*-\s*\d{3}", translated)
    ]
    if not matches:
        return ""
    expected = _ii_basics._normalize_hsbc_account_number(HSBC_EXPECTED_ACCOUNT_NUMBER)
    if expected and expected in matches:
        return HSBC_EXPECTED_ACCOUNT_NUMBER
    return matches[0]


def _split_hsbc_pasted_text_chunks(raw_text: str) -> list[str]:
    normalized_text = (
        str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    )
    if not normalized_text:
        return []
    parts = re.split(
        rf"\n+\s*{re.escape(HSBC_PASTE_CHUNK_MARKER)}\s*\n+",
        normalized_text,
    )
    chunks: list[str] = []
    seen_chunk_keys: set[str] = set()
    for part in parts:
        chunk = part.strip()
        if not chunk:
            continue
        chunk_key = _normalize_whitespace(chunk)
        if chunk_key in seen_chunk_keys:
            continue
        seen_chunk_keys.add(chunk_key)
        chunks.append(chunk)
    return chunks


def _extract_hsbc_portfolio_market_data_updated_at(raw_text: str) -> dict[str, str]:
    candidates: list[tuple[date, str, str]] = []
    for line in raw_text.splitlines():
        normalized_line = _normalize_whitespace(line)
        match = HSBC_PORTFOLIO_UPDATED_PATTERN.fullmatch(normalized_line)
        if not match:
            continue
        try:
            updated_date = _parse_hsbc_human_date(
                match.group("date"),
                "HSBC Portfolio market-data update date",
            )
        except ValueError:
            continue
        candidates.append((updated_date, match.group("time"), normalized_line))
    if not candidates:
        return {}
    updated_date, updated_time, updated_raw = max(candidates)
    return {
        "raw": updated_raw,
        "date": updated_date.isoformat(),
        "time": updated_time,
    }


def _extract_hsbc_order_status_window_from_chunk(raw_text: str) -> dict[str, str]:
    lines = [_normalize_text(line) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    order_status_index = next(
        (index for index, line in enumerate(lines) if line.lower() == "order status"),
        -1,
    )
    if order_status_index < 0:
        return {}

    order_reference_pattern = re.compile(r"^[PS]-\d+$", re.IGNORECASE)
    first_order_index = next(
        (
            index
            for index in range(order_status_index + 1, len(lines))
            if order_reference_pattern.fullmatch(lines[index])
        ),
        len(lines),
    )
    preamble_lines = lines[order_status_index + 1 : first_order_index]
    iso_dates: list[date] = []
    for line in preamble_lines:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", line):
            continue
        try:
            parsed_date = date.fromisoformat(line)
        except ValueError:
            continue
        if parsed_date not in iso_dates:
            iso_dates.append(parsed_date)

    if len(iso_dates) < 2:
        human_date_pattern = re.compile(
            r"^\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}\s+U\.S\. ET$",
            re.IGNORECASE,
        )
        for line in preamble_lines:
            if not human_date_pattern.fullmatch(line):
                continue
            try:
                parsed_date = _parse_hsbc_human_date(
                    line,
                    "HSBC Order Status selected date",
                )
            except ValueError:
                continue
            if parsed_date not in iso_dates:
                iso_dates.append(parsed_date)

    if len(iso_dates) < 2:
        return {}
    return {
        "start_date": iso_dates[0].isoformat(),
        "end_date": iso_dates[-1].isoformat(),
    }


def _extract_hsbc_order_status_windows(raw_text: str) -> list[dict[str, str]]:
    return [
        window
        for chunk in _split_hsbc_pasted_text_chunks(raw_text)
        if (window := _extract_hsbc_order_status_window_from_chunk(chunk))
    ]


def _extract_hsbc_order_status_coverage(raw_text: str) -> dict[str, Any]:
    windows = _extract_hsbc_order_status_windows(raw_text)
    if windows:
        return {
            "mode": "explicit_date_ranges",
            "windows": windows,
        }

    rolling_windows: list[dict[str, str]] = []
    for chunk in _split_hsbc_pasted_text_chunks(raw_text):
        for line in chunk.splitlines():
            normalized_line = _normalize_whitespace(line)
            match = HSBC_ORDER_STATUS_ROLLING_WINDOW_PATTERN.search(normalized_line)
            if not match:
                continue
            rolling_windows.append(
                {
                    "mode": "rolling_recent_window",
                    "calendar_days": match.group("calendar_days"),
                    "raw": normalized_line,
                }
            )
    if rolling_windows:
        return rolling_windows[-1]
    return {"mode": "unknown"}


def _build_hsbc_pasted_snapshot_fingerprint(
    *,
    cash_account_text: str,
    portfolio_text: str,
    order_status_text: str,
) -> str:
    canonical_parts: list[str] = []
    for field_name, raw_text in (
        ("cash_account", cash_account_text),
        ("portfolio", portfolio_text),
        ("order_status", order_status_text),
    ):
        canonical_parts.append(field_name)
        canonical_parts.extend(
            _normalize_whitespace(line)
            for line in str(raw_text or "")
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .split("\n")
            if _normalize_whitespace(line)
        )
        canonical_parts.append(HSBC_PASTE_CHUNK_MARKER)
    return hashlib.sha256("\n".join(canonical_parts).encode("utf-8")).hexdigest()


def _build_hsbc_pasted_text_source_artifact(
    *,
    raw_text: str,
    role: str,
    account: str,
    bundle_id: str,
    statement_period_start: str = "",
    statement_period_end: str = "",
    statement_generated_at: str = "",
    cash_earliest_post_date: str = "",
    cash_latest_post_date: str = "",
) -> dict[str, Any]:
    """Build one immutable artifact from the exact UTF-8 parser input."""
    source_bytes = raw_text.encode("utf-8")
    digest = hashlib.sha256(source_bytes).hexdigest()
    normalized_role = _normalize_text(role).lower().replace("-", "_")
    title_by_role = {
        "cash_account": "HSBC cash-account pasted text",
        "portfolio": "HSBC Portfolio pasted text",
        "order_status": "HSBC Order Status pasted text",
    }
    period = "/".join(
        value for value in (statement_period_start, statement_period_end) if value
    )
    artifact = {
        "evidence_schema_version": "1.0",
        "sha256": digest,
        "byte_count": len(source_bytes),
        "filename": f"hsbc-{normalized_role.replace('_', '-')}-{bundle_id[:12]}.txt",
        "filenames": [f"hsbc-{normalized_role.replace('_', '-')}-{bundle_id[:12]}.txt"],
        "broker": "hsbc",
        "account": account,
        "source_kind": f"hsbc_{normalized_role}_pasted_text",
        "bundle_id": bundle_id,
        "bundle_ids": [bundle_id],
        "bundle_role": normalized_role,
        "statement_title": title_by_role.get(
            normalized_role,
            "HSBC pasted text",
        ),
        "statement_period": period,
        "statement_period_start": statement_period_start,
        "statement_period_end": statement_period_end,
        "statement_generated_at": statement_generated_at,
        "content_encoding": "base64",
        "content_base64": base64.b64encode(source_bytes).decode("ascii"),
    }
    if cash_earliest_post_date and cash_latest_post_date:
        artifact["cash_earliest_post_date"] = cash_earliest_post_date
        artifact["cash_latest_post_date"] = cash_latest_post_date
    return artifact


def _build_hsbc_pasted_text_source_artifacts(
    *,
    cash_account_text: str,
    portfolio_text: str,
    order_status_text: str,
    account: str,
    snapshot_report: dict[str, Any],
) -> list[dict[str, Any]]:
    """Keep every supplied HSBC page in one fingerprint-addressed bundle."""
    bundle_id = _normalize_text(snapshot_report.get("fingerprint"))
    coverage = snapshot_report.get("order_status_coverage")
    windows = coverage.get("windows") if isinstance(coverage, dict) else None
    starts = sorted(
        {
            _normalize_text(window.get("start_date"))
            for window in windows or []
            if isinstance(window, dict) and _normalize_text(window.get("start_date"))
        }
    )
    ends = sorted(
        {
            _normalize_text(window.get("end_date"))
            for window in windows or []
            if isinstance(window, dict) and _normalize_text(window.get("end_date"))
        }
    )
    statement_period_start = starts[0] if starts else ""
    statement_period_end = (
        ends[-1]
        if ends
        else _normalize_text(snapshot_report.get("cash_latest_post_date"))
    )
    if not statement_period_start and not portfolio_text and not order_status_text:
        # A cash-account capture is a visible, potentially truncated transaction
        # range rather than a complete bank statement period.
        statement_period_start = _normalize_text(
            snapshot_report.get("cash_earliest_post_date")
        )
    cash_only_capture = bool(
        cash_account_text and not portfolio_text and not order_status_text
    )
    cash_earliest_post_date = (
        _normalize_text(snapshot_report.get("cash_earliest_post_date"))
        if cash_only_capture
        else ""
    )
    cash_latest_post_date = (
        _normalize_text(snapshot_report.get("cash_latest_post_date"))
        if cash_only_capture
        else ""
    )
    market_data = snapshot_report.get("portfolio_market_data_updated_at")
    statement_generated_at = (
        _normalize_text(market_data.get("raw")) if isinstance(market_data, dict) else ""
    )
    artifacts = []
    for role, raw_text in (
        ("cash_account", cash_account_text),
        ("portfolio", portfolio_text),
        ("order_status", order_status_text),
    ):
        if not raw_text:
            continue
        artifacts.append(
            _build_hsbc_pasted_text_source_artifact(
                raw_text=raw_text,
                role=role,
                account=account,
                bundle_id=bundle_id,
                statement_period_start=statement_period_start,
                statement_period_end=statement_period_end,
                statement_generated_at=statement_generated_at,
                cash_earliest_post_date=(
                    cash_earliest_post_date if role == "cash_account" else ""
                ),
                cash_latest_post_date=(
                    cash_latest_post_date if role == "cash_account" else ""
                ),
            )
        )
    return artifacts


def _parse_hsbc_order_status_plain_text_single(
    raw_text: str,
) -> tuple[str, list[dict[str, str]]]:
    text = _normalize_text(raw_text)
    if not text:
        raise ValueError("The HSBC Order Status text is empty.")
    if "Order Status" not in text:
        raise ValueError(
            "The pasted HSBC Order Status text does not look like the Order Status page."
        )
    account_number = _extract_hsbc_account_number_from_text(raw_text)
    if HSBC_EXPECTED_ACCOUNT_NUMBER and account_number != HSBC_EXPECTED_ACCOUNT_NUMBER:
        raise ValueError(
            f"The pasted HSBC Order Status text must belong to account {HSBC_EXPECTED_ACCOUNT_NUMBER}."
        )

    order_date_pattern = re.compile(r"^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+U\.S\. ET$")
    order_reference_pattern = re.compile(r"^[PS]-\d+$", re.IGNORECASE)
    price_quantity_pattern = re.compile(
        r"^(?P<price>\d+(?:\.\d+)?)\s*USD\s*(?P<quantity>\d+(?:\.\d+)?)$",
        re.IGNORECASE,
    )

    lines = [_normalize_text(line) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    rows: list[dict[str, str]] = []
    seen_order_refs: set[str] = set()

    for index, line in enumerate(lines):
        if not order_reference_pattern.fullmatch(line):
            continue
        order_reference = line.upper()
        if order_reference in seen_order_refs:
            continue
        seen_order_refs.add(order_reference)
        date_index = -1
        for probe in range(index - 1, max(-1, index - 14), -1):
            if order_date_pattern.fullmatch(lines[probe]):
                date_index = probe
                break
        if date_index < 2:
            continue
        symbol = normalize_ticker(lines[date_index - 2])
        full_name = lines[date_index - 1]
        if not symbol or not full_name:
            continue
        status = _normalize_text(
            lines[date_index + 1] if date_index + 1 < len(lines) else ""
        )
        side = _normalize_text(
            lines[date_index + 2] if date_index + 2 < len(lines) else ""
        )
        order_type = _normalize_text(
            lines[date_index + 3] if date_index + 3 < len(lines) else ""
        )
        price_line = ""
        executed_line = ""
        outstanding_line = ""
        for probe in range(date_index + 4, min(index, date_index + 10) + 1):
            candidate = lines[probe]
            if not price_line and "USD" in candidate.upper():
                price_line = candidate
            if not executed_line and candidate.lower().startswith("executed quantity"):
                executed_line = candidate
            if not outstanding_line and candidate.lower().startswith(
                "outstanding quantity"
            ):
                outstanding_line = candidate
        price_match = price_quantity_pattern.match(price_line)
        executed_match = re.search(
            r"Executed quantity\s*(\d+(?:\.\d+)?)", executed_line, re.IGNORECASE
        )
        outstanding_match = re.search(
            r"Outstanding quantity\s*(\d+(?:\.\d+)?)", outstanding_line, re.IGNORECASE
        )
        if not price_match or not executed_match:
            continue
        rows.append(
            {
                "symbol": symbol,
                "full_name": full_name,
                "order_date": _parse_hsbc_human_date(
                    lines[date_index],
                    f"HSBC order {order_reference} date",
                ).isoformat(),
                "order_date_display": lines[date_index],
                "status": status,
                "transaction_type": side,
                "order_type": order_type,
                "price": price_match.group("price"),
                "currency": "USD",
                "quantity": price_match.group("quantity"),
                "executed_quantity": executed_match.group(1),
                "outstanding_quantity": (
                    outstanding_match.group(1) if outstanding_match else "0"
                ),
                "order_reference": order_reference,
            }
        )

    if not rows:
        raise ValueError(
            "No HSBC order rows could be parsed from the pasted Order Status text."
        )
    return account_number, rows


def _parse_hsbc_order_status_plain_text(
    raw_text: str,
) -> tuple[str, list[dict[str, str]]]:
    chunks = _split_hsbc_pasted_text_chunks(raw_text)
    if len(chunks) <= 1:
        return _parse_hsbc_order_status_plain_text_single(raw_text)

    account_number = ""
    parsed_rows: list[dict[str, str]] = []
    seen_order_refs: set[str] = set()
    errors: list[str] = []
    for chunk_index, chunk in enumerate(chunks, start=1):
        try:
            chunk_account_number, chunk_rows = (
                _parse_hsbc_order_status_plain_text_single(chunk)
            )
        except ValueError as exc:
            errors.append(f"HSBC Order Status chunk {chunk_index}: {exc}")
            continue
        if account_number and chunk_account_number != account_number:
            raise ValueError(
                "The pasted HSBC Order Status text chunks belong to different accounts."
            )
        account_number = chunk_account_number
        for row in chunk_rows:
            order_reference = _normalize_text(row.get("order_reference"))
            if order_reference and order_reference in seen_order_refs:
                continue
            if order_reference:
                seen_order_refs.add(order_reference)
            parsed_rows.append(row)
    if parsed_rows:
        return account_number or HSBC_EXPECTED_ACCOUNT_NUMBER, parsed_rows
    raise ValueError(
        errors[0]
        if len(errors) == 1
        else "No HSBC order rows could be parsed from the pasted Order Status text chunks."
    )


def _parse_hsbc_portfolio_plain_text_single(
    raw_text: str,
) -> tuple[str, dict[str, Any]]:
    text = _normalize_text(raw_text)
    if not text:
        raise ValueError("The HSBC Portfolio text is empty.")
    if "Portfolio" not in text or "Market value" not in text:
        raise ValueError(
            "The pasted HSBC Portfolio text does not look like the Portfolio page."
        )
    account_number = _extract_hsbc_account_number_from_text(raw_text)
    if HSBC_EXPECTED_ACCOUNT_NUMBER and account_number != HSBC_EXPECTED_ACCOUNT_NUMBER:
        raise ValueError(
            f"The pasted HSBC Portfolio text must belong to account {HSBC_EXPECTED_ACCOUNT_NUMBER}."
        )

    lines = [_normalize_text(line) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    header_index = next(
        (
            index
            for index, line in enumerate(lines)
            if "Price (%)" in line and "Average purchase price" in line
        ),
        -1,
    )
    if header_index < 0:
        raise ValueError(
            "The pasted HSBC Portfolio text is missing the holdings table."
        )
    footer_index = next(
        (
            index
            for index in range(header_index + 1, len(lines))
            if lines[index].lower() == "information"
            or lines[index].startswith("© Copyright")
            or lines[index].startswith("This website is designed")
        ),
        len(lines),
    )
    table_lines = lines[header_index + 1 : footer_index]
    if not table_lines:
        raise ValueError(
            "The pasted HSBC Portfolio text does not contain any holdings rows."
        )

    portfolio_header_text = "\n".join(lines[:header_index])
    total_market_value_match = re.search(
        r"(?:^|\n)Market value\s*\nUSD\s*\n(?P<value>[\d,]+\.\d{2,4})(?:\n|$)",
        portfolio_header_text,
        re.IGNORECASE,
    )
    if total_market_value_match is None:
        total_market_value_match = re.search(
            r"PortfolioMarket valueUSD\s*(?P<value>[\d,]+\.\d{2,4}[KM]?)",
            portfolio_header_text,
            re.IGNORECASE,
        )

    symbol_pattern = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
    price_pattern = re.compile(r"^\d[\d,]*\.\d{2,4}$")
    skip_symbols = {
        "USD",
        "HKD",
        "MARKET",
        "VALUE",
        "PORTFOLIO",
        "INFORMATION",
        "CURRENCY",
        "PRICE",
    }
    holdings: list[dict[str, str]] = []
    cursor = 0
    while cursor < len(table_lines):
        symbol_line = table_lines[cursor]
        symbol = normalize_ticker(symbol_line)
        if (
            not symbol
            or not symbol_pattern.fullmatch(symbol_line)
            or symbol_line in skip_symbols
            or cursor + 1 >= len(table_lines)
        ):
            cursor += 1
            continue
        full_name = table_lines[cursor + 1]
        block_end = cursor + 2
        while block_end < len(table_lines):
            next_line = table_lines[block_end]
            if (
                next_line.lower() == "information"
                or next_line.startswith("© Copyright")
                or next_line.startswith("This website is designed")
            ):
                break
            if (
                symbol_pattern.fullmatch(next_line)
                and next_line not in skip_symbols
                and block_end + 1 < len(table_lines)
            ):
                break
            block_end += 1
        block_lines = table_lines[cursor + 2 : block_end]
        joined_block = " ".join(block_lines)
        last_price_text = next(
            (line for line in block_lines if price_pattern.fullmatch(line)),
            "",
        )
        usd_amounts = re.findall(
            r"USD\s*([\d,]+\.\d{2,4}[KM]?)",
            joined_block,
            re.IGNORECASE,
        )
        if not last_price_text or len(usd_amounts) < 2:
            cursor = max(block_end, cursor + 1)
            continue
        last_price_dec = Decimal(last_price_text.replace(",", ""))

        def parse_hsbc_amount(val_str: str) -> Decimal:
            val_str = val_str.upper().replace(",", "")
            factor = Decimal("1")
            if val_str.endswith("K"):
                factor = Decimal("1000")
                val_str = val_str[:-1]
            elif val_str.endswith("M"):
                factor = Decimal("1000000")
                val_str = val_str[:-1]
            return Decimal(val_str) * factor

        market_value_dec = parse_hsbc_amount(usd_amounts[0])
        average_price_dec = parse_hsbc_amount(usd_amounts[-1])
        if last_price_dec <= ZERO or market_value_dec <= ZERO:
            cursor = max(block_end, cursor + 1)
            continue
        inferred_quantity_dec = market_value_dec / last_price_dec
        nearest_integer = inferred_quantity_dec.to_integral_value()
        if abs(inferred_quantity_dec - nearest_integer) <= Decimal("0.05"):
            inferred_quantity_dec = nearest_integer
        quantity_dec, tradable_quantity_dec = _parse_hsbc_portfolio_quantity_from_block(
            block_lines,
            inferred_quantity_dec,
        )
        holdings.append(
            {
                "symbol": symbol,
                "full_name": full_name,
                "last_price": _decimal_to_str(last_price_dec) or "0",
                "quantity": _decimal_to_str(quantity_dec) or "0",
                "tradable_quantity": _decimal_to_str(tradable_quantity_dec) or "0",
                "market_value": _decimal_to_str(market_value_dec) or "0",
                "average_purchase_price": _decimal_to_str(average_price_dec) or "0",
                "currency": "USD",
            }
        )
        cursor = max(block_end, cursor + 1)

    if not holdings:
        raise ValueError(
            "No HSBC holdings could be parsed from the pasted Portfolio text."
        )
    capture: dict[str, Any] = {
        "currency": "USD",
        "account": {
            "number": account_number,
            "label": "HSBC One Investment Services",
        },
        "holdings": holdings,
    }
    if total_market_value_match is not None:
        total_market_value_text = total_market_value_match.group("value")
        capture["reported_total_market_value"] = (
            _decimal_to_str(parse_hsbc_amount(total_market_value_text)) or "0"
        )
    market_data_updated_at = _extract_hsbc_portfolio_market_data_updated_at(raw_text)
    if market_data_updated_at:
        capture["snapshot_metadata"] = {
            "market_data_updated_at": market_data_updated_at,
        }
    return account_number, capture


def _parse_hsbc_portfolio_plain_text(raw_text: str) -> tuple[str, dict[str, Any]]:
    chunks = _split_hsbc_pasted_text_chunks(raw_text)
    if len(chunks) <= 1:
        return _parse_hsbc_portfolio_plain_text_single(raw_text)

    account_number = ""
    best_capture: dict[str, Any] | None = None
    best_score: tuple[int, int] | None = None
    errors: list[str] = []
    for chunk_index, chunk in enumerate(chunks, start=1):
        try:
            chunk_account_number, capture = _parse_hsbc_portfolio_plain_text_single(
                chunk
            )
        except ValueError as exc:
            errors.append(f"HSBC Portfolio chunk {chunk_index}: {exc}")
            continue
        if account_number and chunk_account_number != account_number:
            raise ValueError(
                "The pasted HSBC Portfolio text chunks belong to different accounts."
            )
        account_number = chunk_account_number
        holdings = capture.get("holdings") if isinstance(capture, dict) else []
        score = (len(holdings) if isinstance(holdings, list) else 0, chunk_index)
        if best_score is None or score >= best_score:
            best_score = score
            best_capture = capture
    if best_capture is not None:
        return account_number or HSBC_EXPECTED_ACCOUNT_NUMBER, best_capture
    raise ValueError(
        errors[0]
        if len(errors) == 1
        else "No HSBC holdings could be parsed from the pasted Portfolio text chunks."
    )


def _parse_hsbc_portfolio_quantity_from_block(
    block_lines: list[str],
    inferred_quantity: Decimal,
) -> tuple[Decimal, Decimal]:
    joined_block = " ".join(block_lines)
    match = re.search(
        r"\d+(?:\.\d+)?%\s*(?P<quantity_blob>[\d.,]+)\s*USD\b",
        joined_block,
        re.IGNORECASE,
    )
    if not match:
        return inferred_quantity, inferred_quantity

    quantity_blob = match.group("quantity_blob").replace(",", "")
    quantity_candidates: list[Decimal] = []
    if (
        len(quantity_blob) % 2 == 0
        and quantity_blob[: len(quantity_blob) // 2]
        == quantity_blob[len(quantity_blob) // 2 :]
    ):
        quantity_candidates.append(Decimal(quantity_blob[: len(quantity_blob) // 2]))

    numeric_parts = re.findall(r"\d+(?:\.\d+)?", quantity_blob)
    quantity_candidates.extend(Decimal(part) for part in numeric_parts)

    for quantity_dec in quantity_candidates:
        if quantity_dec > ZERO and abs(quantity_dec - inferred_quantity) <= Decimal(
            "1"
        ):
            return quantity_dec, quantity_dec

    return inferred_quantity, inferred_quantity


def _classify_hsbc_cash_account_transaction(
    description: str,
    signed_amount: Decimal,
) -> str:
    upper_description = description.upper()
    if HSBC_EXPLICIT_FOREX_TRANSACTION_PATTERN.search(description):
        return "forex_trade_component"
    if signed_amount > ZERO and upper_description.startswith(
        HSBC_CORPORATE_EVENT_PAYMENT_PREFIX
    ):
        return "dividend"
    if signed_amount > ZERO and (
        "INTEREST" in upper_description or "REBATE" in upper_description
    ):
        return "credit_interest"
    if signed_amount < ZERO and "INTEREST" in upper_description:
        return "debit_interest"
    return "deposit" if signed_amount > ZERO else "withdrawal"


def _extract_hsbc_statement_forex_pair_reference(description: str) -> str:
    if not HSBC_EXPLICIT_FOREX_TRANSACTION_PATTERN.search(description):
        return ""
    match = HSBC_FOREX_REFERENCE_PATTERN.search(description)
    return _normalize_text(match.group("reference")).upper() if match else ""


def _hsbc_order_quantity_before_date(
    order_records: list[dict[str, Any]],
    ticker: str,
    cutoff_date: date,
) -> Decimal:
    quantity = ZERO
    normalized_ticker = normalize_ticker(ticker)
    for record in order_records:
        if normalize_ticker(_normalize_text(record.get("ticker"))) != normalized_ticker:
            continue
        try:
            order_day = date.fromisoformat(_normalize_text(record.get("date")))
        except ValueError:
            continue
        # Purchases on the ex-date are not entitled to that distribution.
        if order_day >= cutoff_date:
            continue
        order_quantity = (
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("quantity_abs"))
            or ZERO
        )
        record_type = _normalize_text(record.get("type")).lower()
        if record_type == "buy":
            quantity += order_quantity
        elif record_type == "sell":
            quantity -= order_quantity
    return max(quantity, ZERO)


def _attribute_hsbc_corporate_event_dividends(
    cash_records: list[dict[str, Any]],
    order_records: list[dict[str, Any]],
    position_snapshot: dict[str, dict[str, str]],
    warnings: list[str],
    dividend_action_loader: Callable[[set[str]], dict[str, list[dict[str, str]]]]
    | None,
) -> None:
    corporate_event_records = [
        record
        for record in cash_records
        if _normalize_text(record.get("type")).lower() == "dividend"
        and _ii_merge_identity._normalize_hsbc_currency_code(
            record.get("currency")
        )
        == "USD"
        and _normalize_whitespace(record.get("description"))
        .upper()
        .startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX)
    ]
    if not corporate_event_records:
        return

    usd_order_records = [
        record
        for record in order_records
        if _ii_merge_identity._normalize_hsbc_currency_code(record.get("currency"))
        == "USD"
    ]
    candidate_tickers = {
        normalize_ticker(ticker)
        for ticker, position in position_snapshot.items()
        if normalize_ticker(ticker)
        and isinstance(position, dict)
        and _ii_merge_identity._normalize_hsbc_currency_code(
            position.get("currency")
        )
        == "USD"
    }
    candidate_tickers.update(
        normalize_ticker(_normalize_text(record.get("ticker")))
        for record in usd_order_records
        if normalize_ticker(_normalize_text(record.get("ticker")))
    )
    dividend_actions: dict[str, list[dict[str, str]]] = {}
    if dividend_action_loader is not None and candidate_tickers:
        try:
            dividend_actions = dividend_action_loader(candidate_tickers)
        except Exception as exc:
            warnings.append(
                "HSBC corporate-event dividend attribution skipped because local dividend "
                f"history could not be read: {exc}"
            )

    for record in corporate_event_records:
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        cash_amount = (
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("net_amount_raw"))
            or ZERO
        )
        try:
            payment_day = date.fromisoformat(_normalize_text(record.get("date")))
        except ValueError:
            payment_day = date.min
        matches: list[tuple[Decimal, str, date, Decimal, Decimal, Decimal]] = []
        for ticker in sorted(candidate_tickers):
            for action in dividend_actions.get(ticker, []):
                try:
                    ex_date = date.fromisoformat(_normalize_text(action.get("date")))
                except ValueError:
                    continue
                days_after_ex_date = (payment_day - ex_date).days
                if not 0 <= days_after_ex_date <= HSBC_DIVIDEND_MATCH_LOOKBACK_DAYS:
                    continue
                dividend_per_share = (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        action.get("dividend_per_share")
                    )
                    or ZERO
                )
                eligible_quantity = _hsbc_order_quantity_before_date(
                    usd_order_records,
                    ticker,
                    ex_date,
                )
                expected_gross = eligible_quantity * dividend_per_share
                if expected_gross <= ZERO:
                    continue
                tolerance = max(Decimal("0.05"), expected_gross * Decimal("0.002"))
                for retention_rate in HSBC_DIVIDEND_NET_RETENTION_RATES:
                    difference = abs(cash_amount - (expected_gross * retention_rate))
                    if difference <= tolerance:
                        matches.append(
                            (
                                difference,
                                ticker,
                                ex_date,
                                dividend_per_share,
                                eligible_quantity,
                                retention_rate,
                            )
                        )

        matched_tickers = {match[1] for match in matches}
        if len(matched_tickers) != 1:
            source["dividend_attribution_status"] = "unavailable_from_hsbc_cash_text"
            record["source"] = source
            warnings.append(
                "HSBC corporate-event payment "
                f"{_normalize_text(record.get('date'))} / {_decimal_to_str(cash_amount)} USD "
                "was classified as dividend income but could not be attributed to one ticker "
                "from local dividend history."
            )
            continue

        best_match = min(matches, key=lambda match: match[0])
        _, ticker, ex_date, dividend_per_share, eligible_quantity, retention_rate = (
            best_match
        )
        record["ticker"] = ticker
        source.update(
            {
                "dividend_attribution_status": "matched_local_market_action",
                "dividend_attribution_method": "eligible_shares_and_local_dividend_action",
                "dividend_ex_date": ex_date.isoformat(),
                "dividend_per_share_raw": _decimal_to_str(dividend_per_share),
                "dividend_eligible_quantity_raw": _decimal_to_str(eligible_quantity),
                "dividend_expected_gross_raw": _decimal_to_str(
                    eligible_quantity * dividend_per_share
                ),
                "dividend_inferred_net_retention_rate": _decimal_to_str(retention_rate),
            }
        )
        record["source"] = source
        warnings.append(
            "HSBC corporate-event payment "
            f"{_normalize_text(record.get('date'))} / {_decimal_to_str(cash_amount)} USD "
            f"was attributed to {ticker} using the unique local dividend-action match."
        )


def _should_ignore_hsbc_cash_account_row(description: str) -> bool:
    normalized_description = _normalize_whitespace(description)
    if not normalized_description:
        return False
    return bool(
        HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN.fullmatch(normalized_description)
    )


def _infer_hsbc_cash_account_direction_from_description(description: str) -> int:
    normalized_description = _normalize_whitespace(description)
    upper_description = normalized_description.upper()
    if not upper_description:
        return 0
    settlement_reference = (
        _ii_hsbc_cash._extract_hsbc_order_reference_from_cash_description(
            normalized_description
        )
    )
    if settlement_reference.startswith("P-"):
        return -1
    if settlement_reference.startswith("S-"):
        return 1
    if upper_description in {"USD CLEARING CHEQUE", "INTEREST"}:
        return 1
    if upper_description.startswith("CASH REBATE"):
        return 1
    if upper_description.startswith("NET- "):
        return -1
    if upper_description.startswith("MDC P "):
        return -1
    if upper_description.startswith("MOBILE WITHDRAWAL"):
        return -1
    if re.fullmatch(r"\d+\s+R\d+", normalized_description):
        return 1
    if re.fullmatch(r"HK\d{6}[A-Z0-9]+\s+0\d{2}", upper_description):
        return 1
    if re.fullmatch(r"HK\d{6}[A-Z0-9]+", upper_description):
        return -1
    return 0


def _parse_hsbc_pasted_money_cell(value: str) -> Decimal | None:
    match = re.fullmatch(
        r"(?P<sign>-?)(?P<amount>[\d,]+\.\d{2})(?P<debit>DR)?",
        value.strip(),
        re.IGNORECASE,
    )
    if match is None:
        return None
    amount = Decimal(match.group("amount").replace(",", ""))
    if match.group("sign") == "-" or match.group("debit"):
        return -amount
    return amount


def _hsbc_pasted_cash_account_sections(raw_text: str) -> list[dict[str, Any]]:
    lines = raw_text.splitlines()
    heading_pattern = re.compile(
        r"^\s*(?:(?P<currency>USD|HKD|CNH|CNY|RMB)\s+)?"
        r"(?P<account_type>(?:Foreign\s+Currency\s+)?(?:Savings|Current))\s*$",
        re.IGNORECASE,
    )
    headings: list[tuple[int, re.Match[str]]] = []
    for index, line in enumerate(lines):
        match = heading_pattern.fullmatch(_normalize_whitespace(line))
        if match is not None:
            headings.append((index, match))
    if not headings:
        return [{"lines": lines, "currency": "", "account_type": ""}]

    sections: list[dict[str, Any]] = []
    for heading_index, (start_index, match) in enumerate(headings):
        end_index = (
            headings[heading_index + 1][0]
            if heading_index + 1 < len(headings)
            else len(lines)
        )
        raw_currency = _normalize_text(match.group("currency")).upper()
        account_type = _normalize_whitespace(match.group("account_type"))
        sections.append(
            {
                "lines": lines[start_index + 1 : end_index],
                "currency": _ii_merge_identity._normalize_hsbc_currency_code(
                    raw_currency
                ),
                "currency_raw": raw_currency,
                "account_type": (
                    f"{raw_currency} {account_type}" if raw_currency else account_type
                ),
            }
        )
    return sections


def _hsbc_cash_balance_component_key(currency: str, account_type: Any) -> str:
    """Return a stable balance key that keeps HSBC cash account kinds distinct."""
    normalized_currency = _ii_merge_identity._normalize_hsbc_currency_code(currency)
    normalized_type = _ii_merge_identity._normalize_hsbc_cash_account_type(
        normalized_currency,
        account_type,
    )
    normalized_type = normalized_type or "UNSPECIFIED"
    return f"{normalized_currency}:{normalized_type}"


def _sum_hsbc_cash_balance_components(
    components: dict[str, Decimal],
) -> dict[str, Decimal]:
    """Aggregate unique HSBC cash-account components into currency totals."""
    canonical_components: dict[str, Decimal] = {}
    for component_key, amount in components.items():
        raw_currency, separator, raw_account_type = component_key.partition(":")
        if not separator:
            continue
        canonical_key = _hsbc_cash_balance_component_key(
            raw_currency,
            raw_account_type,
        )
        if canonical_key.partition(":")[0]:
            canonical_components[canonical_key] = amount
    totals: dict[str, Decimal] = {}
    for component_key, amount in canonical_components.items():
        currency = _ii_merge_identity._normalize_hsbc_currency_code(
            component_key.partition(":")[0]
        )
        if not currency:
            continue
        totals[currency] = totals.get(currency, ZERO) + amount
    return totals


def _serialize_hsbc_cash_balance_components(
    components: dict[str, Decimal],
) -> dict[str, str]:
    """Serialize HSBC account-kind balance components for the local payload."""
    serialized: dict[str, str] = {}
    for component_key, amount in components.items():
        raw_currency, separator, raw_account_type = component_key.partition(":")
        if not separator:
            continue
        canonical_key = _hsbc_cash_balance_component_key(
            raw_currency,
            raw_account_type,
        )
        if canonical_key.partition(":")[0]:
            serialized[canonical_key] = _decimal_to_str(amount) or "0"
    return serialized


def _serialize_hsbc_cash_component_post_dates(
    component_post_dates: dict[str, str],
) -> dict[str, str]:
    """Serialize the latest visible transaction date for each HSBC cash component."""
    serialized: dict[str, str] = {}
    for component_key, raw_post_date in component_post_dates.items():
        raw_currency, separator, raw_account_type = _normalize_text(
            component_key
        ).partition(":")
        post_date = _normalize_text(raw_post_date)
        if not separator or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", post_date):
            continue
        canonical_key = _hsbc_cash_balance_component_key(
            raw_currency,
            raw_account_type,
        )
        if not canonical_key.partition(":")[0]:
            continue
        if post_date >= serialized.get(canonical_key, ""):
            serialized[canonical_key] = post_date
    return serialized


def _hsbc_cash_record_component_key(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _hsbc_cash_balance_component_key(
        _normalize_text(record.get("currency")),
        source.get("account_type"),
    )


def _hsbc_cash_component_post_dates_from_records(
    records: list[dict[str, Any]],
) -> dict[str, str]:
    """Derive conservative per-subaccount snapshot dates from parsed cash rows."""
    component_post_dates: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        component_key = _hsbc_cash_record_component_key(record)
        post_date = _normalize_text(record.get("date"))
        if not component_key or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", post_date):
            continue
        if post_date >= component_post_dates.get(component_key, ""):
            component_post_dates[component_key] = post_date
    return component_post_dates


def _merge_hsbc_cash_component_values(
    target_values: dict[str, Decimal],
    target_post_dates: dict[str, str],
    incoming_values: dict[str, Decimal],
    incoming_post_dates: dict[str, str],
) -> None:
    """Merge subaccount balances without allowing an older clip to win."""

    def component_parts(component_key: str) -> tuple[str, str]:
        raw_currency, _separator, raw_account_type = component_key.partition(":")
        return (
            _ii_merge_identity._normalize_hsbc_currency_code(raw_currency),
            _normalize_whitespace(raw_account_type).upper(),
        )

    target_explicit_currencies = {
        currency
        for component_key in target_values
        for currency, account_type in [component_parts(component_key)]
        if currency and account_type != "LEGACY"
    }
    incoming_explicit_currencies = {
        currency
        for component_key in incoming_values
        for currency, account_type in [component_parts(component_key)]
        if currency and account_type != "LEGACY"
    }

    # A legacy currency total is an aggregate fallback used by older statement
    # payloads. It must not be added beside explicit account-kind balances for
    # the same currency, or one real-world balance would be counted twice.
    for component_key in list(target_values):
        currency, account_type = component_parts(component_key)
        if currency in incoming_explicit_currencies and account_type == "LEGACY":
            target_values.pop(component_key, None)
            target_post_dates.pop(component_key, None)

    for component_key, incoming_amount in incoming_values.items():
        currency, account_type = component_parts(component_key)
        if account_type == "LEGACY" and currency in target_explicit_currencies:
            continue
        incoming_date = _normalize_text(incoming_post_dates.get(component_key))
        existing_date = _normalize_text(target_post_dates.get(component_key))
        should_replace = component_key not in target_values
        if not should_replace and incoming_date:
            should_replace = not existing_date or incoming_date >= existing_date
        elif not should_replace and not existing_date:
            # When neither capture exposes a transaction date, preserve the
            # established clipboard order and let the later clip win.
            should_replace = True
        if not should_replace:
            continue
        target_values[component_key] = incoming_amount
        if incoming_date:
            target_post_dates[component_key] = incoming_date


def _build_hsbc_pasted_cash_account_section(
    section: dict[str, Any],
    *,
    account_number: str,
    warnings: list[str],
    row_number_start: int,
) -> tuple[
    list[dict[str, Any]],
    dict[str, Decimal],
    dict[str, Decimal],
    dict[str, Decimal | None],
    list[str],
    int,
]:
    raw_lines = section.get("lines") if isinstance(section.get("lines"), list) else []
    lines = [_normalize_text(line) for line in raw_lines]
    default_currency = _ii_merge_identity._normalize_hsbc_currency_code(
        section.get("currency")
    )
    default_currency_raw = _normalize_text(section.get("currency_raw")).upper()
    account_type = _normalize_text(section.get("account_type"))
    balance_matches = list(
        re.finditer(
            r"Available balance:\s*(-?[\d,]+\.\d{2})(?:\s*(USD|HKD|CNH|CNY|RMB))?",
            "\n".join(lines),
            re.IGNORECASE | re.DOTALL,
        )
    )
    ledger_matches = list(
        re.finditer(
            r"Ledger balance:\s*(-?[\d,]+\.\d{2})(?:\s*(USD|HKD|CNH|CNY|RMB))?",
            "\n".join(lines),
            re.IGNORECASE | re.DOTALL,
        )
    )
    available_by_currency: dict[str, Decimal] = {}
    ledger_by_currency: dict[str, Decimal] = {}
    for match in balance_matches:
        raw_currency = _normalize_text(match.group(2)).upper() or default_currency_raw
        currency = _ii_merge_identity._normalize_hsbc_currency_code(raw_currency)
        if currency:
            available_by_currency[currency] = Decimal(match.group(1).replace(",", ""))
    for match in ledger_matches:
        raw_currency = _normalize_text(match.group(2)).upper() or default_currency_raw
        currency = _ii_merge_identity._normalize_hsbc_currency_code(raw_currency)
        if currency:
            ledger_by_currency[currency] = Decimal(match.group(1).replace(",", ""))

    if not available_by_currency:
        raise ValueError(
            "The pasted HSBC cash-account text is missing an available balance for a supported currency."
        )
    table_start = next(
        (
            index
            for index, line in enumerate(lines)
            if "Post date" in line and "Amount in" in line and "Balance" in line
        ),
        -1,
    )
    if table_start < 0:
        return (
            [],
            available_by_currency,
            ledger_by_currency,
            {},
            [],
            row_number_start,
        )
    table_end = next(
        (
            index
            for index in range(table_start + 1, len(lines))
            if lines[index] in {"Download", "Print", "Show more transactions"}
            or lines[index].startswith("EnglishSelected")
        ),
        len(lines),
    )

    date_pattern = re.compile(
        r"^(?:(?P<currency>USD|HKD|CNH|CNY|RMB)\s+)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$",
        re.IGNORECASE,
    )
    money_pattern = re.compile(r"-?[\d,]+\.\d{2}(?:DR)?", re.IGNORECASE)
    raw_rows: list[dict[str, Any]] = []
    cursor = table_start + 1
    while cursor < table_end:
        current_line = lines[cursor]
        date_match = date_pattern.fullmatch(current_line)
        if date_match is None:
            cursor += 1
            continue
        transaction_date_text = current_line
        row_currency_raw = (
            _normalize_text(date_match.group("currency")).upper()
            or default_currency_raw
        )
        cursor += 1
        block: list[str] = []
        while cursor < table_end and date_pattern.fullmatch(lines[cursor]) is None:
            if lines[cursor]:
                block.append(lines[cursor])
            cursor += 1
        numeric_indices = [
            index for index, value in enumerate(block) if money_pattern.fullmatch(value)
        ]
        if not numeric_indices:
            continue
        first_numeric_index = numeric_indices[0]
        description = " ".join(block[:first_numeric_index]).strip()
        amount_cells = [block[index] for index in numeric_indices]
        if not description or len(amount_cells) < 2:
            continue
        raw_rows.append(
            {
                "transaction_date": transaction_date_text,
                "description": description,
                "amount_cells": amount_cells,
                "currency_raw": row_currency_raw,
            }
        )

    ordered_rows = list(reversed(raw_rows))
    cash_records: list[dict[str, Any]] = []
    starting_by_currency: dict[str, Decimal] = {}
    ending_by_currency: dict[str, Decimal] = {}
    visible_post_dates: list[str] = []
    current_row_number = row_number_start
    for row_index, row in enumerate(ordered_rows):
        amount_cells = row["amount_cells"]
        balance_after = _parse_hsbc_pasted_money_cell(amount_cells[-1])
        if balance_after is None:
            continue
        amount_in: Decimal | None = None
        amount_out: Decimal | None = None
        if len(amount_cells) >= 3:
            amount_in = abs(_parse_hsbc_pasted_money_cell(amount_cells[-3]) or ZERO)
            amount_out = abs(_parse_hsbc_pasted_money_cell(amount_cells[-2]) or ZERO)
        elif len(amount_cells) == 2:
            transaction_amount = abs(
                _parse_hsbc_pasted_money_cell(amount_cells[0]) or ZERO
            )
            previous_balance = None
            if row_index > 0:
                previous_balance = _parse_hsbc_pasted_money_cell(
                    ordered_rows[row_index - 1]["amount_cells"][-1]
                )
            if previous_balance is not None:
                balance_delta = balance_after - previous_balance
                if abs(balance_delta - transaction_amount) <= Decimal("0.01"):
                    amount_in = transaction_amount
                elif abs(balance_delta + transaction_amount) <= Decimal("0.01"):
                    amount_out = transaction_amount
            direction_hint = _infer_hsbc_cash_account_direction_from_description(
                row["description"]
            )
            if amount_in is None and amount_out is None:
                if direction_hint > 0:
                    amount_in = transaction_amount
                elif direction_hint < 0:
                    amount_out = transaction_amount
            if amount_in is None and amount_out is None:
                if balance_after == transaction_amount or balance_after > ZERO:
                    amount_in = transaction_amount
                else:
                    amount_out = transaction_amount
        signed_amount = (amount_in or ZERO) - (amount_out or ZERO)
        row_currency_raw = _normalize_text(row.get("currency_raw")).upper()
        currency = _ii_merge_identity._normalize_hsbc_currency_code(
            row_currency_raw or default_currency
        )
        if not currency:
            continue
        transaction_day = _parse_hsbc_human_date(
            row["transaction_date"],
            f"HSBC {currency} cash row {current_row_number} date",
        )
        visible_post_dates.append(transaction_day.isoformat())
        if signed_amount == ZERO:
            warnings.append(
                f"HSBC {currency} cash row {current_row_number}: skipped zero-value row {row['description']!r}."
            )
            continue
        if currency not in starting_by_currency:
            starting_by_currency[currency] = balance_after - signed_amount
        ending_by_currency[currency] = balance_after
        mapped_type = _classify_hsbc_cash_account_transaction(
            row["description"], signed_amount
        )
        source_file_kind = (
            "hsbc_usd_account_text"
            if currency == "USD" and account_type.upper() == "USD SAVINGS"
            else "hsbc_multi_currency_cash_account_text"
        )
        effective_account_type = account_type or f"{currency} Savings"
        if effective_account_type.upper() == "FOREIGN CURRENCY SAVINGS":
            effective_account_type = f"Foreign Currency Savings {currency}"
        record: dict[str, Any] = {
            "date": transaction_day.isoformat(),
            "datetime": f"{transaction_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": mapped_type,
            "ticker": "",
            "currency": currency,
            "description": row["description"],
            "source": {
                "file_kind": source_file_kind,
                "row_number": current_row_number,
                "ledger_sequence": current_row_number,
                "account_number": account_number,
                "balance_after_raw": _decimal_to_str(balance_after),
                "reference_id": _normalize_whitespace(row["description"]),
                "account_type": effective_account_type,
                "cash_balance_scope": "account",
                "cash_balance_authoritative": source_file_kind
                == "hsbc_usd_account_text",
            },
            "quantity_raw": "",
            "quantity_abs": "",
            "price_raw": "",
            "gross_amount_raw": _decimal_to_str(signed_amount),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(signed_amount),
        }
        if row_currency_raw:
            record["source"]["statement_currency_raw"] = row_currency_raw
        record["normalized"] = _build_normalized_view(
            mapped_type,
            None,
            None,
            signed_amount,
            ZERO,
            signed_amount,
            is_cash_flow_override=True,
        )
        if _should_ignore_hsbc_cash_account_row(row["description"]):
            record["presentation_hidden"] = True
            record["presentation_hidden_reason"] = "hsbc_order_cash_settlement"
            record["exclude_from_holdings_replay"] = True
        cash_records.append(record)
        current_row_number += 1

    return (
        cash_records,
        available_by_currency,
        ledger_by_currency,
        ending_by_currency,
        visible_post_dates,
        current_row_number,
    )


def _build_hsbc_cash_account_capture_from_text_single(
    raw_text: str,
    *,
    warnings: list[str],
) -> dict[str, Any]:
    text = _normalize_text(raw_text)
    if not text:
        raise ValueError("The HSBC cash-account text is empty.")
    if "Available balance" not in text:
        raise ValueError(
            "The pasted HSBC cash-account text is missing the available balance."
        )
    account_number = _extract_hsbc_account_number_from_text(raw_text)
    if HSBC_EXPECTED_ACCOUNT_NUMBER and account_number != HSBC_EXPECTED_ACCOUNT_NUMBER:
        raise ValueError(
            f"The pasted HSBC cash-account text must belong to account {HSBC_EXPECTED_ACCOUNT_NUMBER}."
        )

    combined_records: list[dict[str, Any]] = []
    available_balance_components: dict[str, Decimal] = {}
    ledger_balance_components: dict[str, Decimal] = {}
    ending_balance_components: dict[str, Decimal] = {}
    available_component_post_dates: dict[str, str] = {}
    ledger_component_post_dates: dict[str, str] = {}
    ending_component_post_dates: dict[str, str] = {}
    errors: list[str] = []
    visible_post_dates: list[str] = []
    next_row_number = 1
    for section in _hsbc_pasted_cash_account_sections(raw_text):
        section_label = _normalize_text(section.get("account_type")) or "cash account"
        try:
            (
                section_records,
                section_available,
                section_ledger,
                section_ending,
                section_visible_post_dates,
                next_row_number,
            ) = _build_hsbc_pasted_cash_account_section(
                section,
                account_number=account_number,
                warnings=warnings,
                row_number_start=next_row_number,
            )
        except ValueError as exc:
            errors.append(f"HSBC {section_label} section: {exc}")
            continue
        combined_records.extend(section_records)
        visible_post_dates.extend(section_visible_post_dates)
        account_type = _normalize_text(section.get("account_type"))
        section_post_dates = _hsbc_cash_component_post_dates_from_records(
            section_records
        )
        for currency, amount in section_available.items():
            component_key = _hsbc_cash_balance_component_key(currency, account_type)
            _merge_hsbc_cash_component_values(
                available_balance_components,
                available_component_post_dates,
                {component_key: amount},
                section_post_dates,
            )
        for currency, amount in section_ledger.items():
            component_key = _hsbc_cash_balance_component_key(currency, account_type)
            _merge_hsbc_cash_component_values(
                ledger_balance_components,
                ledger_component_post_dates,
                {component_key: amount},
                section_post_dates,
            )
        for currency, amount in section_ending.items():
            if amount is None:
                continue
            component_key = _hsbc_cash_balance_component_key(currency, account_type)
            _merge_hsbc_cash_component_values(
                ending_balance_components,
                ending_component_post_dates,
                {component_key: amount},
                section_post_dates,
            )

    if errors:
        raise ValueError(
            errors[0]
            if len(errors) == 1
            else "One or more HSBC cash-account subaccount sections could not be parsed."
        )
    available_by_currency = _sum_hsbc_cash_balance_components(
        available_balance_components
    )
    if not available_by_currency:
        raise ValueError("No supported HSBC cash-account balances were found.")
    sequence_domain_sha256 = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    for record in combined_records:
        source = record.get("source")
        if isinstance(source, dict):
            source["source_sequence_sha256"] = sequence_domain_sha256
    return {
        "account_number": account_number,
        "available_by_currency": available_by_currency,
        "ledger_by_currency": _sum_hsbc_cash_balance_components(
            ledger_balance_components
        ),
        "ending_by_currency": _sum_hsbc_cash_balance_components(
            ending_balance_components
        ),
        "available_balance_components": available_balance_components,
        "ledger_balance_components": ledger_balance_components,
        "ending_balance_components": ending_balance_components,
        "available_component_post_dates": available_component_post_dates,
        "ledger_component_post_dates": ledger_component_post_dates,
        "ending_component_post_dates": ending_component_post_dates,
        "visible_post_dates": sorted(set(visible_post_dates)),
        "records": combined_records,
    }


def _build_hsbc_cash_account_capture_from_text(
    raw_text: str,
    *,
    warnings: list[str],
) -> dict[str, Any]:
    chunks = _split_hsbc_pasted_text_chunks(raw_text)
    if not chunks:
        raise ValueError("The HSBC cash-account text is empty.")
    account_number = ""
    available_balance_components: dict[str, Decimal] = {}
    ledger_balance_components: dict[str, Decimal] = {}
    ending_balance_components: dict[str, Decimal] = {}
    available_component_post_dates: dict[str, str] = {}
    ledger_component_post_dates: dict[str, str] = {}
    ending_component_post_dates: dict[str, str] = {}
    combined_records: list[dict[str, Any]] = []
    visible_post_dates: list[str] = []
    seen_keys: set[tuple[str, ...]] = set()
    errors: list[str] = []
    for chunk_index, chunk in enumerate(chunks, start=1):
        try:
            capture = _build_hsbc_cash_account_capture_from_text_single(
                chunk,
                warnings=warnings,
            )
        except ValueError as exc:
            errors.append(f"HSBC cash chunk {chunk_index}: {exc}")
            continue
        chunk_account = capture["account_number"]
        if account_number and chunk_account != account_number:
            raise ValueError(
                "The pasted HSBC cash-account text chunks belong to different accounts."
            )
        account_number = chunk_account
        visible_post_dates.extend(capture.get("visible_post_dates", []))
        _merge_hsbc_cash_component_values(
            available_balance_components,
            available_component_post_dates,
            capture["available_balance_components"],
            capture.get("available_component_post_dates", {}),
        )
        _merge_hsbc_cash_component_values(
            ledger_balance_components,
            ledger_component_post_dates,
            capture["ledger_balance_components"],
            capture.get("ledger_component_post_dates", {}),
        )
        _merge_hsbc_cash_component_values(
            ending_balance_components,
            ending_component_post_dates,
            capture["ending_balance_components"],
            capture.get("ending_component_post_dates", {}),
        )
        for record in capture["records"]:
            record_key = _ii_hsbc_cash._hsbc_cash_record_identity_key(record)
            if record_key in seen_keys:
                continue
            seen_keys.add(record_key)
            combined_records.append(record)
    if errors:
        raise ValueError(errors[0])
    available_by_currency = _sum_hsbc_cash_balance_components(
        available_balance_components
    )
    if not available_by_currency:
        raise ValueError(
            errors[0]
            if len(errors) == 1
            else "No supported HSBC cash-account balances were parsed from the pasted text chunks."
        )
    _ii_hsbc_cash._mark_hsbc_trade_settlement_history_hidden(combined_records)
    return {
        "account_number": account_number or HSBC_EXPECTED_ACCOUNT_NUMBER,
        "available_by_currency": available_by_currency,
        "ledger_by_currency": _sum_hsbc_cash_balance_components(
            ledger_balance_components
        ),
        "ending_by_currency": _sum_hsbc_cash_balance_components(
            ending_balance_components
        ),
        "available_balance_components": available_balance_components,
        "ledger_balance_components": ledger_balance_components,
        "ending_balance_components": ending_balance_components,
        "available_component_post_dates": available_component_post_dates,
        "ledger_component_post_dates": ledger_component_post_dates,
        "ending_component_post_dates": ending_component_post_dates,
        "visible_post_dates": sorted(set(visible_post_dates)),
        "records": combined_records,
    }
