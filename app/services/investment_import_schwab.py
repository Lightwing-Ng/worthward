"""Investment import domain: schwab.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Counter,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    InvalidOperation,
    SCHEMA_VERSION,
    SCHWAB_ACCOUNT_SUFFIX_PATTERN,
    SCHWAB_ACTION_TO_TYPE,
    SCHWAB_FILENAME_ACCOUNT_PATTERN,
    SCHWAB_FILLED_STATUS,
    SCHWAB_INTERNAL_TRANSFER_JOURNAL_ACTIONS,
    SCHWAB_LEGACY_TRANSACTION_TYPE_ALIASES,
    SCHWAB_POSITIONS_HEADER_PATTERN,
    SCHWAB_POSITIONS_TOTAL_TOLERANCE,
    SCHWAB_SECURITY_TRANSFER_ACTIONS,
    SCHWAB_UNKNOWN_NUMERIC_VALUES,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    base64,
    datetime,
    defaultdict,
    hashlib,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records


def _canonicalize_schwab_legacy_transaction_type(
    record: dict[str, Any],
) -> None:
    """Canonicalize legacy Schwab type labels without discarding raw evidence."""
    raw_type = _normalize_text(record.get("type"))
    normalized_key = re.sub(r"[\s-]+", "_", raw_type.casefold())
    canonical_type = SCHWAB_LEGACY_TRANSACTION_TYPE_ALIASES.get(normalized_key)
    if not canonical_type or normalized_key == canonical_type:
        return
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    source.setdefault("legacy_type_raw", raw_type)
    record["type"] = canonical_type
    record["source"] = source


def _normalize_schwab_header_key(key: str) -> str:
    k = _normalize_text(key).lower()
    k = re.sub(r"[\s_|]+", "", k)
    k = k.replace("quantityfacevalue", "quantity")
    k = k.replace("timeanddate(et)", "datetime")
    k = k.replace("timeanddate", "datetime")
    k = k.replace("lastactivitydate(et)", "datetime")
    k = k.replace("fillpriceisaverage", "")
    k = k.replace("fillprice", "price")
    k = k.replace("nameofsecurity", "description")
    k = k.replace("strategyname", "")
    # fallback simple words
    if "quantity" in k:
        k = "quantity"
    if k == "datetime" or "timeanddate" in k or "activitydate" in k:
        k = "datetime"
    return k or key.lower()


def _parse_schwab_datetime(
    value: str, warnings: list[str], row_number: int
) -> tuple[str, str]:
    raw = _normalize_text(value)
    if not raw:
        return "", ""
    cleaned = re.sub(r"\s*ET$", "", raw, flags=re.IGNORECASE).strip()
    cleaned = re.sub(
        r"\s+as\s+of\s+\d{1,2}/\d{1,2}/\d{4}\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned)
    for fmt in (
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %H:%M",
        "%m/%d/%Y",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(cleaned, fmt)
            date_text = dt.strftime("%Y-%m-%d")
            if "%H" in fmt or "%I" in fmt:
                time_part = dt.strftime("%H:%M:%S")
            else:
                time_part = DEFAULT_CONVENTION_TIME
            return date_text, f"{date_text} {time_part}"
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(cleaned.replace(" ", "T"))
        date_text = dt.strftime("%Y-%m-%d")
        return date_text, f"{date_text} {dt.strftime('%H:%M:%S')}"
    except Exception:
        warnings.append(f"Row {row_number}: could not parse Schwab date/time {value!r}")
        return "", ""


def _parse_schwab_decimal(
    value: str | None,
    field_name: str,
    row_number: int,
    warnings: list[str],
) -> Decimal | None:
    raw = _normalize_text(value)
    if raw.lower() in SCHWAB_UNKNOWN_NUMERIC_VALUES:
        return None
    cleaned = (
        raw.replace("$", "").replace("%", "").replace(",", "").replace("−", "-").strip()
    )
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = f"-{cleaned[1:-1].strip()}"
    return _parse_decimal(cleaned, field_name, row_number, warnings)


def _schwab_has_intraday_timestamp(value: str | None) -> bool:
    """Return whether a Schwab date field contains a source-provided time."""
    normalized = _normalize_text(value)
    if not normalized:
        return False
    return bool(
        re.search(
            r"\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def _classify_schwab_transaction_type(
    action: str,
    description: str,
    unknown_types: set[str],
) -> str:
    """Map Schwab's human-readable action variants to ledger semantics."""
    normalized_action = _normalize_whitespace(action).lower()
    normalized_description = _normalize_whitespace(description).lower()
    direct_mapping = SCHWAB_ACTION_TO_TYPE.get(normalized_action)
    if direct_mapping is not None:
        return direct_mapping

    combined = f"{normalized_action} {normalized_description}".strip()
    if "tax" in combined and any(
        marker in combined for marker in ("nra", "foreign", "withhold", "dividend tax")
    ):
        return "foreign_tax_withholding"
    if re.search(r"\bdiv(?:idend)?\b|\bdistribution\b", combined):
        return "dividend"
    if "buy" in normalized_action:
        return "buy"
    if "sell" in normalized_action:
        return "sell"
    return _ii_basics._classify_transaction_type(
        action or "Trade", description, unknown_types
    )


def _schwab_amount_from_row(
    row: dict[str, str], quantity: Decimal | None, price: Decimal | None, side: str
) -> Decimal | None:
    for key in ("amount", "netamount", "proceeds"):
        val = row.get(key)
        if val:
            dec = _parse_schwab_decimal(val, "amount", 0, [])
            if dec is not None:
                return dec
    if quantity is not None and price is not None:
        gross = quantity * price
        return -gross if side == "buy" else gross
    return None


def _build_schwab_transaction_record(
    row: list[str] | dict[str, Any],
    row_number: int,
    headers: list[str] | None,
    warnings: list[str],
    unknown_types: set[str],
) -> dict[str, Any] | None:
    if isinstance(row, list):
        if headers is None:
            return None
        row_dict = {
            headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))
        }
    else:
        row_dict = {str(k): v for k, v in row.items()}

    norm_row: dict[str, str] = {}
    for k, v in row_dict.items():
        nk = _normalize_schwab_header_key(k)
        if nk and nk not in norm_row:
            norm_row[nk] = _normalize_text(v)

    symbol = norm_row.get("symbol") or norm_row.get("ticker") or ""
    description = norm_row.get("description") or norm_row.get("name") or ""
    status = norm_row.get("status", "").lower()
    action_raw = (norm_row.get("action") or norm_row.get("type") or "").strip()

    if status and status not in SCHWAB_FILLED_STATUS and "filled" not in status:
        if "price" not in norm_row and "fillprice" not in norm_row:
            return None

    mapped_type = _classify_schwab_transaction_type(
        action_raw,
        description,
        unknown_types,
    )

    qty_raw = (
        norm_row.get("quantity") or norm_row.get("qty") or norm_row.get("shares") or ""
    )
    price_raw = (
        norm_row.get("price")
        or norm_row.get("fillprice")
        or norm_row.get("avgprice")
        or ""
    )
    fee_raw = (
        norm_row.get("fees")
        or norm_row.get("commission")
        or norm_row.get("fees&comm")
        or "0"
    )

    quantity_dec = _parse_schwab_decimal(qty_raw, "quantity", row_number, warnings)
    price_dec = _parse_schwab_decimal(price_raw, "price", row_number, warnings)
    commission_dec = (
        _parse_schwab_decimal(fee_raw, "commission", row_number, warnings) or ZERO
    )
    if commission_dec < 0:
        commission_dec = abs(commission_dec)

    if (
        mapped_type == "transfer_in"
        and quantity_dec is not None
        and quantity_dec < ZERO
    ):
        mapped_type = "transfer_out"

    if mapped_type in {"buy", "sell"} and (
        quantity_dec is None
        or quantity_dec <= ZERO
        or price_dec is None
        or price_dec <= ZERO
    ):
        return None

    side = (
        "buy"
        if mapped_type in {"buy", "dividend_reinvestment", "grant", "transfer_in"}
        else ("sell" if mapped_type in {"sell", "transfer_out"} else None)
    )

    datetime_source_field = ""
    if norm_row.get("datetime"):
        date_str = norm_row["datetime"]
        datetime_source_field = "datetime"
    elif norm_row.get("date") and norm_row.get("time"):
        date_str = f"{norm_row['date']} {norm_row['time']}"
        datetime_source_field = "date_and_time"
    else:
        date_str = norm_row.get("date") or norm_row.get("time") or ""
        datetime_source_field = "date" if norm_row.get("date") else "time"
    date_text, datetime_text = _parse_schwab_datetime(date_str, warnings, row_number)
    if not date_text:
        for alt in ("lastactivitydate", "settledate", "executeddate"):
            if norm_row.get(alt):
                candidate_date_value = norm_row[alt]
                date_text, datetime_text = _parse_schwab_datetime(
                    candidate_date_value,
                    warnings,
                    row_number,
                )
                if date_text:
                    date_str = candidate_date_value
                    datetime_source_field = alt
                    break
    if not date_text:
        warnings.append(f"Row {row_number}: missing date for Schwab row")
        return None

    currency = "USD"
    gross_amount = None
    if (
        quantity_dec is not None
        and price_dec is not None
        and mapped_type in {"buy", "sell"}
    ):
        gross = quantity_dec * price_dec
        gross_amount = -gross if mapped_type == "buy" else gross
    elif mapped_type in {"transfer_in", "transfer_out"}:
        gross_amount = ZERO
    else:
        amt = _schwab_amount_from_row(norm_row, quantity_dec, price_dec, side or "")
        if amt is not None:
            gross_amount = amt

    net_amount = gross_amount
    if gross_amount is not None and commission_dec:
        net_amount = (
            gross_amount - commission_dec
            if (side == "buy" or mapped_type == "buy")
            else (gross_amount - commission_dec)
        )
    if net_amount is None and gross_amount is not None:
        net_amount = gross_amount

    reinvestment_cost_basis_status = ""
    if mapped_type == "dividend_reinvestment":
        has_reinvestment_quantity = quantity_dec is not None and quantity_dec > ZERO
        has_reinvestment_value = (
            (price_dec is not None and price_dec > ZERO)
            or (gross_amount is not None and abs(gross_amount) > ZERO)
            or (net_amount is not None and abs(net_amount) > ZERO)
        )
        reinvestment_cost_basis_status = (
            "known"
            if has_reinvestment_quantity and has_reinvestment_value
            else "unknown"
        )
        if reinvestment_cost_basis_status == "unknown":
            warnings.append(
                f"Row {row_number}: Schwab dividend reinvestment has no positive "
                "quantity-and-value cost-basis evidence; P&L remains unavailable."
            )

    record: dict[str, Any] = {
        "date": date_text,
        "datetime": datetime_text,
        "type": mapped_type,
        "currency": currency,
        "description": description or symbol or action_raw or "Schwab trade",
        "source": {
            "file_kind": "schwab_csv",
            "row_number": row_number,
            "action_raw": action_raw,
            "status_raw": status,
            "datetime_source_field": datetime_source_field,
            "datetime_precision": (
                "second" if _schwab_has_intraday_timestamp(date_str) else "day"
            ),
            "source_has_intraday_timestamp": _schwab_has_intraday_timestamp(date_str),
        },
    }
    if reinvestment_cost_basis_status:
        record["source"]["reinvestment_cost_basis_status"] = (
            reinvestment_cost_basis_status
        )
    if symbol:
        record["ticker"] = normalize_ticker(symbol)

    if quantity_dec is not None:
        record["quantity_raw"] = _decimal_to_str(
            quantity_dec if mapped_type == "adjustment" else abs(quantity_dec)
        )
        record["quantity_abs"] = _decimal_to_str(abs(quantity_dec))
    if price_dec is not None:
        record["price_raw"] = _decimal_to_str(price_dec)
    if gross_amount is not None:
        record["gross_amount_raw"] = _decimal_to_str(gross_amount)
    record["commission_raw"] = (
        _decimal_to_str(-abs(commission_dec)) if commission_dec else "0"
    )
    if net_amount is not None:
        record["net_amount_raw"] = _decimal_to_str(net_amount)

    record["normalized"] = _build_normalized_view(
        mapped_type,
        quantity_dec,
        price_dec,
        gross_amount,
        commission_dec,
        net_amount,
        is_cash_flow_override=False
        if mapped_type in {"transfer_in", "transfer_out"}
        else None,
        side_override=side,
    )

    # Explicitly tag like all other broker builders (ensures merge logic + history table are clean)
    record["broker"] = "schwab"
    src = record.get("source")
    if isinstance(src, dict):
        src["broker"] = "schwab"
    return record


def _infer_schwab_source_row_order(
    transactions: list[dict[str, Any]],
) -> str:
    """Infer whether the export rows run newest-first or oldest-first."""
    dated_rows: list[tuple[int, str]] = []
    for transaction in transactions:
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )
        try:
            row_number = int(source.get("row_number", 0) or 0)
        except (TypeError, ValueError):
            continue
        date_text = _normalize_text(transaction.get("date"))
        if row_number > 0 and date_text:
            dated_rows.append((row_number, date_text))
    dated_rows.sort(key=lambda item: item[0])
    dates = [date_text for _row_number, date_text in dated_rows]
    if len(dates) < 2 or len(set(dates)) < 2:
        return "unknown"
    if all(left >= right for left, right in zip(dates, dates[1:])):
        return "newest_first"
    if all(left <= right for left, right in zip(dates, dates[1:])):
        return "oldest_first"
    return "mixed"


def _normalize_schwab_positions_header_key(key: str) -> str:
    compact = re.sub(r"[^a-z0-9]+", "", _normalize_text(key).lower())
    aliases = {
        "symbol": "symbol",
        "description": "description",
        "qty": "quantity",
        "qtyquantity": "quantity",
        "quantity": "quantity",
        "price": "price",
        "mktvalmarketvalue": "market_value",
        "marketvalue": "market_value",
        "costbasis": "cost_basis",
        "assettype": "asset_type",
    }
    return aliases.get(compact, compact)


def _schwab_account_suffix(value: str) -> str:
    match = SCHWAB_ACCOUNT_SUFFIX_PATTERN.search(_normalize_text(value))
    return match.group("suffix") if match is not None else ""


def _schwab_filename_account_suffix(filename: str) -> str:
    match = SCHWAB_FILENAME_ACCOUNT_PATTERN.search(_normalize_text(filename))
    return _schwab_account_suffix(match.group("account")) if match is not None else ""


def _schwab_record_account(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _normalize_text(record.get("account") or source.get("account"))


def _schwab_absolute_quantity_token(value: Any) -> str:
    token = _ii_basics._normalize_decimal_identity_token(value)
    if not token:
        return ""
    try:
        return _ii_basics._normalize_decimal_identity_token(abs(Decimal(token)))
    except (InvalidOperation, ValueError, TypeError):
        return ""


def _schwab_cleanup_record_signature(
    record: dict[str, Any],
) -> tuple[str, str, str, str, str, str]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _schwab_record_account(record),
        _normalize_text(record.get("date")),
        normalize_ticker(_normalize_text(record.get("ticker"))),
        _normalize_text(record.get("type")).lower(),
        _normalize_text(source.get("action_raw")).lower(),
        _ii_basics._normalize_decimal_identity_token(record.get("quantity_raw")),
    )


def _schwab_internal_transfer_cleanup_signatures(
    transactions: list[dict[str, Any]],
) -> set[tuple[str, str, str, str, str, str]]:
    """Find balanced Journal pairs backed by Security Transfer receipts.

    Schwab exports may contain zero-cash Journal rows that move a transferred
    position between internal processing stages. A Journal pair is suppressible
    only when the same account and ticker also have a matching Security
    Transfer receipt in this authoritative bundle. Unpaired Journal rows stay
    visible for review.
    """
    transfer_quantities: set[tuple[str, str, str]] = set()
    journal_counts: defaultdict[
        tuple[str, str, str], defaultdict[str, Counter[str]]
    ] = defaultdict(lambda: defaultdict(Counter))
    journal_records: list[dict[str, Any]] = []

    for record in transactions:
        if not isinstance(record, dict):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        action = _normalize_text(source.get("action_raw")).lower()
        normalized_type = _normalize_text(record.get("type")).lower()
        account = _schwab_record_account(record)
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        quantity_raw = record.get("quantity_raw")
        quantity_token = _ii_basics._normalize_decimal_identity_token(quantity_raw)
        quantity_abs = _schwab_absolute_quantity_token(quantity_raw)
        if not account or not ticker or not quantity_token or not quantity_abs:
            continue
        if (
            action in SCHWAB_SECURITY_TRANSFER_ACTIONS
            or normalized_type == "transfer_in"
        ):
            transfer_quantities.add((account, ticker, quantity_abs))
            continue
        if (
            action not in SCHWAB_INTERNAL_TRANSFER_JOURNAL_ACTIONS
            or normalized_type != "adjustment"
        ):
            continue
        try:
            signed_quantity = Decimal(quantity_token)
        except (InvalidOperation, ValueError, TypeError):
            continue
        if signed_quantity == ZERO:
            continue
        group_key = (account, _normalize_text(record.get("date")), ticker)
        journal_counts[group_key][quantity_abs][
            "positive" if signed_quantity > ZERO else "negative"
        ] += 1
        journal_records.append(record)

    balanced_quantities = {
        (*group_key, quantity_abs)
        for group_key, quantity_counts in journal_counts.items()
        for quantity_abs, signed_counts in quantity_counts.items()
        if (
            signed_counts["positive"] > 0
            and signed_counts["positive"] == signed_counts["negative"]
            and (group_key[0], group_key[2], quantity_abs) in transfer_quantities
        )
    }
    return {
        _schwab_cleanup_record_signature(record)
        for record in journal_records
        if (
            _schwab_record_account(record),
            _normalize_text(record.get("date")),
            normalize_ticker(_normalize_text(record.get("ticker"))),
            _schwab_absolute_quantity_token(record.get("quantity_raw")),
        )
        in balanced_quantities
    }


def _schwab_cleanup_signatures_from_summary(
    payload: dict[str, Any] | None,
) -> set[tuple[str, str, str, str, str, str]]:
    """Recover cleanup identities from a persisted import summary."""
    if not isinstance(payload, dict):
        return set()
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    raw_rows = summary.get("schwab_suppressed_internal_transfer_rows")
    if not isinstance(raw_rows, list):
        return set()
    payload_account = _normalize_text(payload.get("account"))
    signatures: set[tuple[str, str, str, str, str, str]] = set()
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            continue
        account = _normalize_text(raw_row.get("account")) or payload_account
        if not account:
            continue
        record = {
            "account": account,
            "date": _normalize_text(raw_row.get("date")),
            "type": "adjustment",
            "ticker": normalize_ticker(_normalize_text(raw_row.get("ticker"))),
            "quantity_raw": raw_row.get("quantity"),
            "source": {"action_raw": _normalize_text(raw_row.get("action"))},
        }
        signatures.add(_schwab_cleanup_record_signature(record))
    return signatures


def _normalized_schwab_suppressed_internal_transfer_rows(
    payload: dict[str, Any] | None,
) -> list[dict[str, str]]:
    summary = payload.get("summary") if isinstance(payload, dict) else None
    raw_rows = (
        summary.get("schwab_suppressed_internal_transfer_rows")
        if isinstance(summary, dict)
        else None
    )
    if not isinstance(raw_rows, list):
        return []
    rows_by_signature: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            continue
        row = {
            "date": _normalize_text(raw_row.get("date")),
            "action": _normalize_text(raw_row.get("action")),
            "ticker": normalize_ticker(_normalize_text(raw_row.get("ticker"))),
            "quantity": _ii_basics._normalize_decimal_identity_token(
                raw_row.get("quantity")
            ),
        }
        signature = (
            row["date"],
            row["action"].lower(),
            row["ticker"],
            row["quantity"],
        )
        rows_by_signature[signature] = row
    return [rows_by_signature[key] for key in sorted(rows_by_signature)]


def _merge_schwab_suppressed_internal_transfer_rows(
    *payloads: dict[str, Any] | None,
) -> list[dict[str, str]]:
    rows_by_signature: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for payload in payloads:
        for row in _normalized_schwab_suppressed_internal_transfer_rows(payload):
            signature = (
                row["date"],
                row["action"].lower(),
                row["ticker"],
                row["quantity"],
            )
            rows_by_signature[signature] = row
    return [rows_by_signature[key] for key in sorted(rows_by_signature)]


def _validate_schwab_bundle_account(
    *,
    transaction_filename: str,
    positions_filename: str,
    positions_account: str,
) -> None:
    """Reject a paired export when a visible account suffix contradicts Positions."""
    positions_suffix = _schwab_account_suffix(positions_account)
    transaction_suffix = _schwab_filename_account_suffix(transaction_filename)
    positions_filename_suffix = _schwab_filename_account_suffix(positions_filename)
    if not positions_suffix:
        raise ValueError(
            "The Schwab Positions CSV is missing its visible account suffix."
        )
    if not transaction_suffix:
        raise ValueError(
            "The Schwab Transactions CSV filename is missing its visible account suffix."
        )
    if transaction_suffix != positions_suffix:
        raise ValueError(
            "The Schwab Transactions and Positions CSV files have different visible account suffixes."
        )
    if positions_filename_suffix and positions_filename_suffix != positions_suffix:
        raise ValueError(
            "The Schwab Transactions and Positions CSV filenames have different visible account suffixes."
        )


def _extract_schwab_positions_snapshot(
    rows: list[list[str]],
    warnings: list[str],
) -> tuple[dict[str, dict[str, str]], str, str, str | None, dict[str, Any]]:
    if not rows or not rows[0]:
        raise ValueError("The Schwab Positions CSV appears to be empty.")

    heading = _normalize_text(rows[0][0])
    heading_match = SCHWAB_POSITIONS_HEADER_PATTERN.match(heading)
    if heading_match is None:
        raise ValueError("The second CSV does not look like a Schwab Positions export.")
    account = _normalize_text(heading_match.group("account"))
    try:
        as_of_datetime = datetime.strptime(
            f"{heading_match.group('date').replace('/', '-')} {heading_match.group('time').upper()}",
            "%Y-%m-%d %I:%M %p",
        )
    except ValueError as exc:
        raise ValueError(
            "The Schwab Positions CSV has an invalid as-of timestamp."
        ) from exc
    as_of_date = as_of_datetime.strftime("%Y-%m-%d")
    as_of_timestamp = f"{as_of_date} {as_of_datetime.strftime('%H:%M:%S')}"

    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if row and _normalize_schwab_positions_header_key(row[0]) == "symbol"
        ),
        None,
    )
    if header_index is None:
        raise ValueError(
            "The Schwab Positions CSV is missing its positions header row."
        )
    headers = [
        _normalize_schwab_positions_header_key(value) for value in rows[header_index]
    ]
    position_lots: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    reported_positions_total: Decimal | None = None
    cash_total = ZERO
    cash_row_seen = False
    for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not row or not any(_normalize_text(value) for value in row):
            continue
        row_data = {
            headers[index]: _normalize_text(row[index]) if index < len(row) else ""
            for index in range(len(headers))
            if headers[index]
        }
        raw_symbol = row_data.get("symbol", "")
        raw_symbol_key = _normalize_text(raw_symbol).lower()
        if raw_symbol_key == "cash & cash investments":
            if cash_row_seen:
                raise ValueError(
                    "The Schwab Positions CSV contains more than one Cash & Cash Investments row."
                )
            cash_value = _parse_schwab_decimal(
                row_data.get("market_value"),
                "cash_market_value",
                row_number,
                warnings,
            )
            if cash_value is None:
                raise ValueError(
                    f"Schwab Positions row {row_number}: Cash & Cash Investments is missing Market Value."
                )
            cash_total += cash_value
            cash_row_seen = True
            continue
        if raw_symbol_key.startswith("positions total"):
            if reported_positions_total is not None:
                raise ValueError(
                    "The Schwab Positions CSV contains more than one Positions Total row."
                )
            reported_positions_total = _parse_schwab_decimal(
                row_data.get("market_value"),
                "positions_total_market_value",
                row_number,
                warnings,
            )
            if reported_positions_total is None:
                raise ValueError(
                    "The Schwab Positions Total row is missing Market Value."
                )
            continue
        symbol = normalize_ticker(raw_symbol)
        if not symbol:
            if raw_symbol_key:
                raise ValueError(
                    f"Schwab Positions row {row_number}: unsupported non-empty symbol {raw_symbol!r}."
                )
            continue
        quantity = _parse_schwab_decimal(
            row_data.get("quantity"),
            "position_quantity",
            row_number,
            warnings,
        )
        if quantity is None:
            raise ValueError(
                f"Schwab Positions row {row_number}: {symbol} is missing Quantity."
            )
        price = _parse_schwab_decimal(
            row_data.get("price"), "position_price", row_number, warnings
        )
        market_value = _parse_schwab_decimal(
            row_data.get("market_value"),
            "position_market_value",
            row_number,
            warnings,
        )
        cost_basis = _parse_schwab_decimal(
            row_data.get("cost_basis"),
            "position_cost_basis",
            row_number,
            warnings,
        )
        if market_value is None:
            raise ValueError(
                f"Schwab Positions row {row_number}: {symbol} is missing Market Value."
            )
        position_lots[symbol].append(
            {
                "asset_category": row_data.get("asset_type") or "",
                "quantity": quantity,
                "price": price,
                "market_value": market_value,
                "cost_basis": cost_basis,
            }
        )

    snapshots: dict[str, dict[str, str]] = {}
    securities_total = ZERO
    lot_counts: dict[str, int] = {}
    for symbol in sorted(position_lots):
        lots = position_lots[symbol]
        quantities = [lot["quantity"] for lot in lots]
        market_values = [lot["market_value"] for lot in lots]
        aggregate_quantity = sum(quantities, ZERO)
        aggregate_value = sum(market_values, ZERO)
        securities_total += aggregate_value
        lot_counts[symbol] = len(lots)
        asset_categories = {
            _normalize_text(lot["asset_category"])
            for lot in lots
            if _normalize_text(lot["asset_category"])
        }
        if len(asset_categories) > 1:
            raise ValueError(
                f"Schwab Positions rows for {symbol} have incompatible Asset Type values."
            )
        prices = [lot["price"] for lot in lots if lot["price"] is not None]
        close_price: Decimal | None = None
        if prices and all(price == prices[0] for price in prices):
            close_price = prices[0]
        elif prices:
            warnings.append(
                f"Schwab Positions rows for {symbol} have inconsistent close prices; the aggregated close price was left blank."
            )
        cost_bases = [lot["cost_basis"] for lot in lots]
        known_cost_bases = [
            cost_basis for cost_basis in cost_bases if cost_basis is not None
        ]
        aggregate_cost_basis: Decimal | None = None
        cost_basis_status = "unknown"
        if len(known_cost_bases) == len(lots):
            aggregate_cost_basis = sum(known_cost_bases, ZERO)
            cost_basis_status = "known"
        elif known_cost_bases:
            cost_basis_status = "partial"
        cost_price = (
            aggregate_cost_basis / abs(aggregate_quantity)
            if aggregate_cost_basis is not None and aggregate_quantity != ZERO
            else None
        )
        snapshots[symbol] = {
            "asset_category": next(iter(asset_categories), ""),
            "currency": "USD",
            "quantity": _decimal_to_str(aggregate_quantity) or "0",
            "cost_price": _decimal_to_str(cost_price) or "",
            "cost_basis": _decimal_to_str(aggregate_cost_basis) or "",
            "cost_basis_status": cost_basis_status,
            "close_price": _decimal_to_str(close_price) or "",
            "value": _decimal_to_str(aggregate_value) or "",
            "unrealized_pl": "",
            "as_of": as_of_timestamp,
            "source_lot_count": str(len(lots)),
        }

    if not cash_row_seen:
        raise ValueError(
            "The Schwab Positions CSV is missing its Cash & Cash Investments row."
        )
    if reported_positions_total is None:
        raise ValueError("The Schwab Positions CSV is missing its Positions Total row.")
    calculated_positions_total = securities_total + cash_total
    if (
        abs(reported_positions_total - calculated_positions_total)
        > SCHWAB_POSITIONS_TOTAL_TOLERANCE
    ):
        raise ValueError(
            "The Schwab Positions Total does not reconcile to the listed securities and cash market values."
        )
    positions_validation = {
        "status": "matched",
        "reported_total": _decimal_to_str(reported_positions_total) or "",
        "calculated_total": _decimal_to_str(calculated_positions_total) or "",
        "lot_counts": lot_counts,
    }
    ending_cash = _decimal_to_str(cash_total)
    return snapshots, account, as_of_date, ending_cash, positions_validation


def _build_schwab_source_artifact(
    *,
    payload: bytes,
    filename: str,
    account: str,
    bundle_id: str,
    bundle_role: str,
    related_sha256: str,
    statement_period: str,
) -> dict[str, Any]:
    content_sha256 = hashlib.sha256(payload).hexdigest()
    normalized_filename = _normalize_text(filename) or f"schwab-{bundle_role}.csv"
    return {
        "evidence_schema_version": "1.0",
        "sha256": content_sha256,
        "byte_count": len(payload),
        "filename": normalized_filename,
        "filenames": [normalized_filename],
        "broker": "schwab",
        "account": account,
        "source_kind": f"schwab_{bundle_role}_csv",
        "bundle_id": bundle_id,
        "bundle_ids": [bundle_id],
        "bundle_role": bundle_role,
        "related_sha256": related_sha256,
        "statement_title": "Charles Schwab Positions"
        if bundle_role == "positions"
        else "Charles Schwab Transactions",
        "statement_period": statement_period,
        "statement_period_start": statement_period,
        "statement_period_end": statement_period,
        "statement_generated_at": "",
        "content_encoding": "base64",
        "content_base64": base64.b64encode(payload).decode("ascii"),
    }


def build_investment_payload_from_schwab_csv(
    transaction_csv_bytes: bytes,
    positions_csv_bytes: bytes,
    *,
    transaction_filename: str = "",
    positions_filename: str = "",
) -> dict[str, Any]:
    """Build one reconciled payload from Schwab Transactions and Positions CSV exports."""
    for label, filename in (
        ("Transactions", transaction_filename),
        ("Positions", positions_filename),
    ):
        normalized_filename = _normalize_text(filename)
        if not normalized_filename or not normalized_filename.lower().endswith(".csv"):
            raise ValueError(f"The Schwab {label} filename must end in .csv.")
    rows = _ii_basics._iter_csv_rows(transaction_csv_bytes)
    positions_rows = _ii_basics._iter_csv_rows(positions_csv_bytes)
    if not rows:
        raise ValueError("The Schwab Transactions CSV appears to be empty.")
    if not positions_rows:
        raise ValueError("The Schwab Positions CSV appears to be empty.")

    headers = [h.strip() for h in rows[0]] if rows else []
    data_rows = rows[1:] if len(rows) > 1 else []

    warnings: list[str] = []
    unknown_types: set[str] = set()
    transactions: list[dict[str, Any]] = []

    for i, row in enumerate(data_rows, start=2):
        rec = _build_schwab_transaction_record(row, i, headers, warnings, unknown_types)
        if rec:
            transactions.append(rec)

    if not transactions:
        warnings.append(
            "No recognized transactions were found in the Schwab Transactions CSV."
        )

    (
        open_position_snapshots,
        account,
        positions_as_of,
        ending_cash,
        positions_validation,
    ) = _extract_schwab_positions_snapshot(
        positions_rows,
        warnings,
    )
    _validate_schwab_bundle_account(
        transaction_filename=transaction_filename,
        positions_filename=positions_filename,
        positions_account=account,
    )

    source_row_order = _infer_schwab_source_row_order(transactions)
    for transaction in transactions:
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )
        source["source_row_order"] = source_row_order
        transaction["source"] = source

    _ii_records._sort_transactions(transactions)

    for t in transactions:
        if isinstance(t, dict):
            t["broker"] = "schwab"
            t["account"] = account
            s = t.get("source")
            if isinstance(s, dict):
                s["broker"] = "schwab"
                s["account"] = account

    # Validate the broker bundle before applying the evidence-backed cleanup
    # policy. The Positions snapshot remains authoritative even when balanced
    # internal-transfer Journal rows are intentionally omitted from the ledger.
    holdings_mismatches = _ii_records._validate_holdings(
        transactions, open_position_snapshots
    )
    cleanup_signatures = _schwab_internal_transfer_cleanup_signatures(transactions)
    suppressed_transactions = [
        transaction
        for transaction in transactions
        if _schwab_cleanup_record_signature(transaction) in cleanup_signatures
    ]
    if suppressed_transactions:
        transactions = [
            transaction
            for transaction in transactions
            if _schwab_cleanup_record_signature(transaction) not in cleanup_signatures
        ]
    transaction_sha256 = hashlib.sha256(transaction_csv_bytes).hexdigest()
    positions_sha256 = hashlib.sha256(positions_csv_bytes).hexdigest()
    bundle_id = hashlib.sha256(
        "|".join(sorted((transaction_sha256, positions_sha256))).encode("ascii")
    ).hexdigest()
    source_artifacts = [
        _build_schwab_source_artifact(
            payload=transaction_csv_bytes,
            filename=transaction_filename,
            account=account,
            bundle_id=bundle_id,
            bundle_role="transactions",
            related_sha256=positions_sha256,
            statement_period=positions_as_of,
        ),
        _build_schwab_source_artifact(
            payload=positions_csv_bytes,
            filename=positions_filename,
            account=account,
            bundle_id=bundle_id,
            bundle_role="positions",
            related_sha256=transaction_sha256,
            statement_period=positions_as_of,
        ),
    ]

    summary = _ii_payload_summaries._build_summary(
        transactions=transactions,
        warnings=warnings,
        unknown_types=sorted(unknown_types),
        holdings_mismatches=holdings_mismatches,
        open_position_snapshots=open_position_snapshots,
        performance_snapshots={},
        starting_cash=None,
        ending_cash=ending_cash,
    )
    summary["schwab_positions_validation"] = positions_validation
    summary["schwab_suppressed_internal_transfer_count"] = len(suppressed_transactions)
    summary["schwab_suppressed_internal_transfer_rows"] = [
        {
            "date": transaction.get("date", ""),
            "action": (
                transaction.get("source", {}).get("action_raw", "")
                if isinstance(transaction.get("source"), dict)
                else ""
            ),
            "ticker": transaction.get("ticker", ""),
            "quantity": transaction.get("quantity_raw", ""),
        }
        for transaction in suppressed_transactions
    ]
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "schwab_csv_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
        },
        "broker": "schwab",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Trade / fill date from Schwab export (ET)",
            "datetime_field_meaning": (
                "Intraday datetime from the Schwab export when present; otherwise "
                "business-convention datetime derived from the date"
            ),
            "timezone": "America/New_York",
            "source_has_intraday_timestamp": any(
                isinstance(transaction.get("source"), dict)
                and transaction["source"].get("source_has_intraday_timestamp") is True
                for transaction in transactions
            ),
        },
        "summary": summary,
        "starting_cash": None,
        "ending_cash": ending_cash,
        "position_snapshot": open_position_snapshots,
        "performance_snapshot": {},
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    payload["summary"]["position_snapshot_authoritative"] = bool(
        open_position_snapshots
    )
    if open_position_snapshots:
        payload["summary"]["position_snapshot_source"] = "schwab_positions_csv"
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    _ii_bindings.refresh_investment_security_transfer_reconciliation(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload
