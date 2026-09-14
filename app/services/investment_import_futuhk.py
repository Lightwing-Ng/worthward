"""Investment import domain: futuhk.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    DEFAULT_CONVENTION_TIME,
    FUTUHK_ACCOUNT_PATTERN,
    FUTUHK_FLOW_ROW_PATTERN,
    FUTUHK_INTERNAL_TRANSFER_REMARK,
    FUTUHK_INTERNAL_TRANSFER_SCOPE,
    FUTUHK_PAGE_MARKER_PATTERN,
    FUTUHK_SETTLEMENT_DATE_PATTERN,
    FUTUHK_STATEMENT_PERIOD_PATTERN,
    FUTUHK_STATEMENT_TIMEZONE,
    FUTUHK_SYMBOL_PREFIX_PATTERN,
    FUTUHK_TRADE_CONTEXT_NOISE_PATTERNS,
    FUTUHK_TRADE_ROW_PATTERN,
    LOGGER,
    SCHEMA_VERSION,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    datetime,
    json,
    map_ordered,
    normalize_ticker,
    re,
    subprocess,
    tempfile,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records


def _is_futuhk_internal_transfer_remark(value: Any) -> bool:
    normalized = _normalize_whitespace(str(value or "")).upper()
    return FUTUHK_INTERNAL_TRANSFER_REMARK in normalized


def _stamp_futuhk_internal_transfer_metadata(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )
    if broker != "futuhk":
        return False
    is_already_marked = (
        record.get("internal_transfer_scope") == FUTUHK_INTERNAL_TRANSFER_SCOPE
        or source.get("internal_transfer_scope") == FUTUHK_INTERNAL_TRANSFER_SCOPE
    )
    is_marked_by_evidence = any(
        _is_futuhk_internal_transfer_remark(value)
        for value in (
            record.get("description"),
            source.get("statement_item_raw"),
            source.get("remark"),
        )
    )
    if not (is_already_marked or is_marked_by_evidence):
        return False
    record["internal_transfer_scope"] = FUTUHK_INTERNAL_TRANSFER_SCOPE
    record["internal_transfer_external_flow_excluded"] = True
    source["internal_transfer_scope"] = FUTUHK_INTERNAL_TRANSFER_SCOPE
    source["internal_transfer_external_flow_excluded"] = True
    record["source"] = source
    return True


def _extract_futuhk_pdf_text(pdf_bytes: bytes) -> str:
    if not pdf_bytes:
        raise ValueError("The uploaded Futu (HK) statement PDF is empty.")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temp_file:
        temp_file.write(pdf_bytes)
        temp_file.flush()
        completed = subprocess.run(
            ["pdftotext", "-layout", temp_file.name, "-"],
            capture_output=True,
            text=True,
            check=False,
        )
    if completed.returncode != 0:
        stderr = (
            completed.stderr.strip() or completed.stdout.strip() or "pdftotext failed."
        )
        LOGGER.warning(
            "pdftotext failed while extracting a Futu (HK) statement PDF: %s", stderr
        )
        raise ValueError(
            "Could not extract text from the Futu (HK) statement PDF. "
            "Make sure poppler/pdftotext is installed and that the PDF is valid."
        )
    return completed.stdout


def _futuhk_statement_date_to_iso(value: str) -> str:
    return datetime.strptime(value, "%Y/%m/%d").strftime("%Y-%m-%d")


def _is_futuhk_noise_line(line: str) -> bool:
    normalized = _normalize_whitespace(line)
    if not normalized:
        return True
    if FUTUHK_PAGE_MARKER_PATTERN.search(normalized):
        return True
    if normalized.startswith("美股保證金賬戶月結單"):
        return True
    if normalized.startswith("富途證券國際"):
        return True
    if normalized.startswith("Registered with SFC"):
        return True
    if normalized.startswith("Futu Securities International"):
        return True
    if any(
        normalized.startswith(prefix) for prefix in FUTUHK_TRADE_CONTEXT_NOISE_PATTERNS
    ):
        return True
    if re.fullmatch(r"\d{2}:\d{2}:\d{2}\s+[A-Z0-9]+.*", normalized):
        return True
    return False


def _looks_like_futuhk_trade_context_line(line: str) -> bool:
    candidate = _normalize_whitespace(line)
    if not candidate:
        return False
    if FUTUHK_TRADE_ROW_PATTERN.match(candidate) or FUTUHK_FLOW_ROW_PATTERN.match(
        candidate
    ):
        return True
    if re.fullmatch(r"\d{4}/\d{2}/\d{2}", candidate):
        return True
    return bool(
        re.search(r"\d", candidate)
        and "(" not in candidate
        and ")" not in candidate
        and not re.search(
            r"TRANSFER|FUND|DIVIDEND|COUPON|WITHHOLDING|TAX|SUBSCRIPTION|REDEMPTION",
            candidate,
            re.IGNORECASE,
        )
    )


def _consume_futuhk_trade_context_suffix(
    lines: list[str], start_index: int
) -> tuple[str, int]:
    parts: list[str] = []
    index = start_index
    while index < len(lines):
        candidate = _normalize_whitespace(lines[index])
        if not candidate or _is_futuhk_noise_line(candidate):
            break
        if _looks_like_futuhk_trade_context_line(candidate):
            break
        parts.append(candidate)
        index += 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip(), index


def _consume_futuhk_trade_context_prefix(lines: list[str], end_index: int) -> str:
    parts: list[str] = []
    index = end_index - 1
    while index >= 0:
        candidate = _normalize_whitespace(lines[index])
        if not candidate or _is_futuhk_noise_line(candidate):
            break
        if _looks_like_futuhk_trade_context_line(candidate):
            break
        parts.insert(0, candidate)
        index -= 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip()


def _consume_futuhk_flow_context_suffix(
    lines: list[str], start_index: int
) -> tuple[str, int]:
    parts: list[str] = []
    index = start_index
    while index < len(lines):
        candidate = _normalize_whitespace(lines[index])
        if not candidate or _is_futuhk_noise_line(candidate):
            break
        if FUTUHK_TRADE_ROW_PATTERN.match(candidate) or FUTUHK_FLOW_ROW_PATTERN.match(
            candidate
        ):
            break
        if re.fullmatch(r"\d{4}/\d{2}/\d{2}", candidate):
            break
        parts.append(candidate)
        index += 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip(), index


def _consume_futuhk_flow_context_prefix(lines: list[str], end_index: int) -> str:
    parts: list[str] = []
    index = end_index - 1
    while index >= 0:
        candidate = _normalize_whitespace(lines[index])
        if not candidate or _is_futuhk_noise_line(candidate):
            break
        if FUTUHK_TRADE_ROW_PATTERN.match(candidate) or FUTUHK_FLOW_ROW_PATTERN.match(
            candidate
        ):
            break
        if re.fullmatch(r"\d{4}/\d{2}/\d{2}", candidate):
            break
        parts.insert(0, candidate)
        index -= 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip()


def _infer_futuhk_ticker(description: str) -> str | None:
    normalized = _normalize_whitespace(description)
    if not normalized:
        return None
    symbol_match = FUTUHK_SYMBOL_PREFIX_PATTERN.match(normalized.upper())
    if symbol_match is not None:
        return normalize_ticker(f"{symbol_match.group(1)}.US")
    inline_match = re.search(r"\b([A-Z]{1,5})\(", normalized.upper())
    if inline_match is not None:
        return normalize_ticker(f"{inline_match.group(1)}.US")
    return None


def _classify_futuhk_flow_type(direction: str, remark: str) -> str:
    normalized_remark = _normalize_whitespace(remark).upper()
    if "DIVIDEND" in normalized_remark or "DIVIDENDS" in normalized_remark:
        return "dividend"
    if "WITHHOLDING TAX" in normalized_remark or " TAX" in normalized_remark:
        return "foreign_tax_withholding"
    if "COUPON DEPOSIT" in normalized_remark:
        return "deposit"
    if "TRANSFER FROM HK" in normalized_remark:
        return "deposit"
    if "FUND REDEMPTION" in normalized_remark:
        return "deposit"
    if "FUND SUBSCRIPTION" in normalized_remark:
        return "withdrawal"
    if direction.lower() == "in":
        return "deposit"
    return "withdrawal"


def _format_futuhk_flow_description(direction: str, remark: str) -> str:
    normalized = _normalize_whitespace(remark)
    if normalized:
        return normalized
    return "Deposit" if direction.lower() == "in" else "Withdrawal"


def _parse_futuhk_settlement_date(lines: list[str], start_index: int) -> str | None:
    for offset in range(0, 4):
        if start_index + offset >= len(lines):
            break
        candidate = _normalize_whitespace(lines[start_index + offset])
        match = FUTUHK_SETTLEMENT_DATE_PATTERN.search(candidate)
        if match is not None:
            return _futuhk_statement_date_to_iso(match.group("date"))
    return None


def _parse_futuhk_trade_records(
    lines: list[str],
    *,
    source_filename: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = _normalize_whitespace(lines[index])
        index += 1
        if not line:
            continue
        match = FUTUHK_TRADE_ROW_PATTERN.match(line)
        if match is None:
            continue

        prefix = _consume_futuhk_trade_context_prefix(lines, index - 1)
        suffix, index = _consume_futuhk_trade_context_suffix(lines, index)
        inline_name = _normalize_whitespace(match.group("inline_name") or "")
        description = _normalize_whitespace(
            " ".join(part for part in (prefix, inline_name, suffix) if part)
        )
        side_raw = match.group("side")
        side = "buy" if side_raw == "買入" else "sell"
        trade_date = _futuhk_statement_date_to_iso(match.group("trade_date"))
        settlement_date = _parse_futuhk_settlement_date(lines, index - 1)
        quantity_dec = _parse_decimal(
            match.group("quantity"), "quantity", index, warnings
        )
        price_dec = _parse_decimal(match.group("price"), "price", index, warnings)
        gross_abs_dec = _parse_decimal(
            match.group("gross"), "gross amount", index, warnings
        )
        net_signed_dec = _parse_decimal(
            match.group("net"), "net amount", index, warnings
        )
        if (
            quantity_dec is None
            or price_dec is None
            or gross_abs_dec is None
            or net_signed_dec is None
        ):
            continue

        gross_signed_dec = -gross_abs_dec if side == "buy" else gross_abs_dec
        fee_abs_dec = (
            abs(net_signed_dec) - gross_abs_dec
            if side == "buy"
            else gross_abs_dec - abs(net_signed_dec)
        )
        if fee_abs_dec < ZERO:
            fee_abs_dec = ZERO
        commission_dec = -fee_abs_dec
        ticker = _infer_futuhk_ticker(description)
        record: dict[str, Any] = {
            "date": trade_date,
            "datetime": _ii_basics._build_convention_datetime(trade_date),
            "type": side,
            "currency": "USD",
            "description": description
            or f"Futu (HK) {side_raw} {match.group('order_id')}",
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "source_filename": source_filename,
                "row_number": index,
                "transaction_type_raw": side_raw,
                "statement_order_id": match.group("order_id"),
            },
            "quantity_raw": _decimal_to_str(abs(quantity_dec)),
            "quantity_abs": _decimal_to_str(abs(quantity_dec)),
            "price_raw": _decimal_to_str(price_dec),
            "gross_amount_raw": _decimal_to_str(gross_signed_dec),
            "commission_raw": _decimal_to_str(commission_dec),
            "commission_abs": _decimal_to_str(abs(commission_dec)),
            "net_amount_raw": _decimal_to_str(net_signed_dec),
            "broker": "futuhk",
        }
        if settlement_date:
            record["statement_settlement_date"] = settlement_date
            record["source"]["statement_settlement_date"] = settlement_date
        if ticker:
            record["ticker"] = ticker
        record["normalized"] = _build_normalized_view(
            side,
            abs(quantity_dec),
            price_dec,
            gross_signed_dec,
            commission_dec,
            net_signed_dec,
            is_cash_flow_override=False,
        )
        records.append(record)
    return records


def _parse_futuhk_flow_records(
    lines: list[str],
    *,
    source_filename: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = _normalize_whitespace(lines[index])
        index += 1
        if not line:
            continue
        match = FUTUHK_FLOW_ROW_PATTERN.match(line)
        if match is None:
            continue

        prefix = _consume_futuhk_flow_context_prefix(lines, index - 1)
        suffix, index = _consume_futuhk_flow_context_suffix(lines, index)
        inline_remark = _normalize_whitespace(match.group("inline_remark") or "")
        remark = _normalize_whitespace(
            " ".join(part for part in (prefix, inline_remark, suffix) if part)
        )
        direction = match.group("direction")
        amount_dec = _parse_decimal(
            match.group("amount"), "cash-flow amount", index, warnings
        )
        if amount_dec is None:
            continue
        booking_date = _futuhk_statement_date_to_iso(match.group("date"))
        settlement_date = _futuhk_statement_date_to_iso(match.group("settlement_date"))
        mapped_type = _classify_futuhk_flow_type(direction, remark)
        description = _format_futuhk_flow_description(direction, remark)
        record: dict[str, Any] = {
            "date": booking_date,
            "datetime": _ii_basics._build_convention_datetime(booking_date),
            "type": mapped_type,
            "currency": "USD",
            "description": description,
            "source": {
                "file_kind": "futuhk_statement_pdf",
                "source_filename": source_filename,
                "row_number": index,
                "transaction_type_raw": direction,
                "statement_order_id": match.group("order_id"),
                "statement_settlement_date": settlement_date,
            },
            "gross_amount_raw": _decimal_to_str(amount_dec),
            "net_amount_raw": _decimal_to_str(amount_dec),
            "broker": "futuhk",
            "statement_settlement_date": settlement_date,
        }
        record["normalized"] = _build_normalized_view(
            mapped_type,
            None,
            None,
            amount_dec,
            None,
            amount_dec,
            is_cash_flow_override=True,
        )
        _stamp_futuhk_internal_transfer_metadata(record)
        records.append(record)
    return records


def _extract_futuhk_statement_metadata(text: str) -> tuple[str | None, str | None]:
    account_match = FUTUHK_ACCOUNT_PATTERN.search(text)
    account = account_match.group(1) if account_match else None
    period_match = FUTUHK_STATEMENT_PERIOD_PATTERN.search(text)
    statement_period = None
    if period_match is not None:
        statement_period = f"{period_match.group('year')}-{period_match.group('month')}"
    return account, statement_period


def _merge_futuhk_statement_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    if not payloads:
        raise ValueError("No Futu (HK) statement payloads were produced.")
    if len(payloads) == 1:
        return payloads[0]

    merged_transactions: list[dict[str, Any]] = []
    merged_warnings: list[str] = []
    accounts: set[str] = set()
    statement_periods: list[str] = []
    source_filenames: list[str] = []
    for payload in payloads:
        merged_transactions.extend(payload.get("transactions", []))
        summary = (
            payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        )
        merged_warnings.extend(summary.get("warnings", []))
        account = _normalize_text(payload.get("account"))
        if account:
            accounts.add(account)
        generator = (
            payload.get("generator")
            if isinstance(payload.get("generator"), dict)
            else {}
        )
        statement_period = _normalize_text(generator.get("statement_period"))
        if statement_period:
            statement_periods.append(statement_period)
        source_filename = _normalize_text(generator.get("source_filename"))
        if source_filename:
            source_filenames.append(source_filename)

    if len(accounts) > 1:
        raise ValueError(
            "The uploaded Futu (HK) statement PDFs belong to different accounts. "
            "Upload statements for one account at a time."
        )
    _ii_records._sort_transactions(merged_transactions)
    account = next(iter(accounts), None)
    merged_payload = dict(payloads[-1])
    merged_payload["account"] = account
    merged_payload["transactions"] = merged_transactions
    merged_payload["generator"] = {
        "name": "futuhk_statement_pdf_to_investment_json",
        "version": SCHEMA_VERSION,
        "generated_at": _ii_basics._now_iso(),
        "source_filename": ", ".join(source_filenames),
        "statement_period": ", ".join(sorted(set(statement_periods))),
        "statement_count": len(payloads),
    }
    merged_payload["summary"] = _ii_payload_summaries._build_summary(
        transactions=merged_transactions,
        warnings=merged_warnings,
        unknown_types=[],
        holdings_mismatches=[],
        open_position_snapshots={},
        performance_snapshots={},
        starting_cash=None,
        ending_cash=None,
    )
    merged_payload["summary"]["statement_count"] = len(payloads)
    merged_payload["summary"]["statement_periods"] = sorted(set(statement_periods))
    for transaction in merged_payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "futuhk"
        if account:
            transaction["account"] = account
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "futuhk"
            if account:
                source["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(merged_payload)
    _ii_payload_summaries._attach_broker_summaries(merged_payload)
    _ii_bindings.normalize_investment_payload_tickers(merged_payload)
    merged_payload["summary"]["json_size_bytes"] = len(
        json.dumps(merged_payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return merged_payload


def build_investment_payload_from_futuhk_statement_pdf(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
) -> dict[str, Any]:
    text = _extract_futuhk_pdf_text(pdf_bytes)
    lines = text.splitlines()
    warnings: list[str] = []
    account, statement_period = _extract_futuhk_statement_metadata(text)
    trade_records = _parse_futuhk_trade_records(
        lines,
        source_filename=source_filename,
        warnings=warnings,
    )
    flow_records = _parse_futuhk_flow_records(
        lines,
        source_filename=source_filename,
        warnings=warnings,
    )
    if not trade_records:
        warnings.append(
            f"No stock trades were parsed from {source_filename or 'the Futu (HK) statement PDF'}."
        )
    if not flow_records:
        warnings.append(
            f"No cash-flow rows were parsed from {source_filename or 'the Futu (HK) statement PDF'}."
        )
    transactions = trade_records + flow_records
    _ii_records._sort_transactions(transactions)
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "futuhk_statement_pdf_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "source_filename": source_filename,
            "statement_period": statement_period,
            "trade_row_count": len(trade_records),
            "cash_flow_row_count": len(flow_records),
        },
        "broker": "futuhk",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Trading or booking date from the Futu (HK) monthly statement PDF",
            "datetime_field_meaning": (
                "Business-convention datetime derived from the statement date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": FUTUHK_STATEMENT_TIMEZONE,
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
            ending_cash=None,
        ),
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "transactions": transactions,
    }
    for transaction in payload["transactions"]:
        if not isinstance(transaction, dict):
            continue
        transaction["broker"] = "futuhk"
        if account:
            transaction["account"] = account
        source = transaction.get("source")
        if isinstance(source, dict):
            source["broker"] = "futuhk"
            if account:
                source["account"] = account
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _parse_futuhk_statement_pdf_item(
    item: tuple[bytes, str],
) -> dict[str, Any]:
    """Parse one uploaded statement in a process-safe top-level task."""
    pdf_bytes, source_filename = item
    return build_investment_payload_from_futuhk_statement_pdf(
        pdf_bytes,
        source_filename=source_filename,
    )


def build_investment_payload_from_futuhk_statement_pdfs(
    statement_pdf_payloads: list[tuple[bytes, str]],
) -> dict[str, Any]:
    if not statement_pdf_payloads:
        raise ValueError("Upload at least one Futu (HK) monthly statement PDF.")
    non_empty_payloads = [
        (pdf_bytes, source_filename)
        for pdf_bytes, source_filename in statement_pdf_payloads
        if pdf_bytes
    ]
    payloads, _stats = map_ordered(
        _parse_futuhk_statement_pdf_item,
        non_empty_payloads,
        mode="cpu",
        min_items=2,
        max_workers=4,
    )
    if not payloads:
        raise ValueError("The uploaded Futu (HK) statement PDFs were empty.")
    return _merge_futuhk_statement_payloads(payloads)
