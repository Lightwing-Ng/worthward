"""Investment import domain: hsbc statements.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    DEFAULT_CONVENTION_TIME,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    HSBC_EXPECTED_ACCOUNT_NUMBER,
    HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER,
    HSBC_STATEMENT_DATE_PATTERN,
    HSBC_STATEMENT_DATE_TIMEZONE,
    HSBC_STATEMENT_MONTHS,
    HSBC_STATEMENT_PDF_IMPORTER_VERSION,
    SCHEMA_VERSION,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    base64,
    date,
    hashlib,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_hsbc_core as _ii_hsbc_core

import app.services.investment_import_merge as _ii_merge

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records

import app.services.investment_import_usmart_tiger as _ii_usmart_tiger

from app.services import investment_import_compat as _investment_import_compat


def _parse_hsbc_statement_date(text: str, source_filename: str) -> date:
    match = HSBC_STATEMENT_DATE_PATTERN.search(text)
    if match is None:
        match = re.search(
            r"\b(?P<day>\d{1,2})\s+(?P<month>January|February|March|April|May|June|July|August|September|October|November|December)\s+(?P<year>20\d{2})\b",
            text,
            re.IGNORECASE,
        )
    if match is None:
        raise ValueError(
            f"HSBC statement PDF {source_filename or '<uploaded file>'} is missing its statement date."
        )
    month_number = HSBC_STATEMENT_MONTHS.get(match.group("month")[:3].lower())
    if month_number is None:
        raise ValueError(
            f"HSBC statement PDF {source_filename or '<uploaded file>'} has an unsupported statement month."
        )
    return date(int(match.group("year")), month_number, int(match.group("day")))


def _parse_hsbc_statement_transaction_date(value: str, statement_day: date) -> date:
    match = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3})", _normalize_whitespace(value))
    if match is None:
        raise ValueError("HSBC statement transaction date must be in 'D Mon' format.")
    month_number = HSBC_STATEMENT_MONTHS.get(match.group(2)[:3].lower())
    if month_number is None:
        raise ValueError("HSBC statement transaction date has an unsupported month.")
    year = statement_day.year
    if month_number > statement_day.month:
        year -= 1
    return date(year, month_number, int(match.group(1)))


def _extract_hsbc_statement_usd_section(text: str) -> list[str]:
    lines = text.splitlines()
    start_index = next(
        (
            index
            for index, line in enumerate(lines)
            if _normalize_whitespace(line).lower() == "foreign currency savings"
        ),
        -1,
    )
    if start_index < 0:
        return []
    end_index = next(
        (
            index
            for index in range(start_index + 1, len(lines))
            if _normalize_whitespace(lines[index])
            .lower()
            .startswith("total relationship balance")
            or _normalize_whitespace(lines[index])
            .lower()
            .startswith("important notice")
        ),
        len(lines),
    )
    foreign_currency_lines = lines[start_index:end_index]
    usd_start = next(
        (
            index
            for index, line in enumerate(foreign_currency_lines)
            if re.match(r"^\s*USD\s+\d{1,2}\s+[A-Za-z]{3}\b", line)
        ),
        -1,
    )
    if usd_start < 0:
        return []
    header_start = max(
        (
            index
            for index in range(0, usd_start)
            if _hsbc_statement_column_positions(foreign_currency_lines[index])
            is not None
        ),
        default=usd_start,
    )
    usd_end = next(
        (
            index
            for index in range(usd_start + 1, len(foreign_currency_lines))
            if re.match(
                r"^\s*(?!USD\b)[A-Z]{3}\s+\d{1,2}\s+[A-Za-z]{3}\b",
                foreign_currency_lines[index],
            )
        ),
        len(foreign_currency_lines),
    )
    return foreign_currency_lines[header_start:usd_end]


def _hsbc_statement_money_spans(line: str) -> list[tuple[int, int, str]]:
    return [
        (match.start(), match.end(), match.group(0))
        for match in re.finditer(
            r"(?<![A-Z0-9])-?\d[\d,]*\.\d{2}(?:DR)?(?![A-Z0-9])",
            line,
            re.IGNORECASE,
        )
    ]


def _parse_hsbc_statement_money_value(value: str) -> Decimal:
    normalized = value.strip().upper()
    is_debit = normalized.endswith("DR")
    if is_debit:
        normalized = normalized[:-2]
    amount = Decimal(normalized.replace(",", ""))
    return -amount if is_debit else amount


def _hsbc_statement_amount_kind(
    start_index: int,
    column_positions: tuple[int, int, int],
) -> str:
    deposit_pos, withdrawal_pos, balance_pos = column_positions
    deposit_boundary = (deposit_pos + withdrawal_pos) / 2
    withdrawal_boundary = (withdrawal_pos + balance_pos) / 2
    if start_index <= deposit_boundary:
        return "deposit"
    if start_index <= withdrawal_boundary:
        return "withdrawal"
    return "balance"


def _hsbc_statement_column_positions(line: str) -> tuple[int, int, int] | None:
    deposit_match = re.search(r"Deposit", line, re.IGNORECASE)
    withdrawal_match = re.search(r"W\s*ithdrawal", line, re.IGNORECASE)
    balance_match = re.search(r"Balance", line, re.IGNORECASE)
    if deposit_match is None or withdrawal_match is None or balance_match is None:
        return None
    deposit_pos = deposit_match.start()
    withdrawal_pos = withdrawal_match.start()
    balance_pos = balance_match.start()
    if not (deposit_pos < withdrawal_pos < balance_pos):
        return None
    return deposit_pos, withdrawal_pos, balance_pos


def _is_hsbc_statement_boilerplate_line(line: str) -> bool:
    normalized = _normalize_whitespace(line)
    if not normalized:
        return True
    if "The Hongkong and Shanghai Banking Corporation Limited" in normalized:
        return True
    if normalized.startswith("Number Branch Page"):
        return True
    if normalized.startswith("Thank you for choosing HSBC"):
        return True
    if re.fullmatch(r"[\d\- ]+\s+TUEN MUN TOWN P& D&N", normalized):
        return True
    if re.fullmatch(r"\d{1,2}\s+[A-Z][a-z]+\s+20\d{2}", normalized):
        return True
    if re.fullmatch(r"(?:\d{2}¡)?IPSSTM\d+", normalized):
        return True
    return False


def _extract_hsbc_statement_cash_sections(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    history_start = next(
        (
            index
            for index, line in enumerate(lines)
            if _normalize_whitespace(line).lower()
            == "hsbc one account transaction history"
        ),
        0,
    )
    section_labels = {
        "hkd savings",
        "hkd current",
        "usd savings",
        "cnh savings",
        "cny savings",
        "rmb savings",
        "foreign currency savings",
    }
    starts: list[tuple[int, str]] = []
    for index in range(history_start, len(lines)):
        label = _normalize_whitespace(lines[index])
        if label.lower() in section_labels:
            starts.append((index, label))
    sections: list[dict[str, Any]] = []
    for section_index, (start_index, label) in enumerate(starts):
        end_index = (
            starts[section_index + 1][0]
            if section_index + 1 < len(starts)
            else len(lines)
        )
        for probe in range(start_index + 1, end_index):
            normalized = _normalize_whitespace(lines[probe]).lower()
            if normalized.startswith(
                "total relationship balance"
            ) or normalized.startswith("important notice"):
                end_index = probe
                break
        raw_currency = ""
        label_match = re.match(r"^(USD|HKD|CNH|CNY|RMB)\s+", label, re.IGNORECASE)
        if label_match:
            raw_currency = label_match.group(1).upper()
        sections.append(
            {
                "label": label,
                "lines": lines[start_index + 1 : end_index],
                "currency_raw": raw_currency,
                "currency": _ii_merge_identity._normalize_hsbc_currency_code(
                    raw_currency
                ),
            }
        )
    return sections


def _extract_hsbc_statement_exchange_rates(text: str) -> dict[str, str]:
    summary = _ii_usmart_tiger._text_between(
        text, "Portfolio Summary", "HSBC One Account Transaction History"
    )
    rates: dict[str, Decimal] = {}
    for line in summary.splitlines():
        match = re.search(
            r"\b(?P<currency>USD|HKD|CNH|CNY|RMB)\s+"
            r"(?P<rate>[\d,]+\.\d{3,})\s+"
            r"[\d,]+\.\d{2}",
            line,
            re.IGNORECASE,
        )
        if match is None:
            continue
        currency = _ii_merge_identity._normalize_hsbc_currency_code(
            match.group("currency")
        )
        if currency:
            rates[currency] = Decimal(match.group("rate").replace(",", ""))
    usd_hkd_rate = rates.get("USD")
    rates_to_base: dict[str, str] = {"USD": "1"}
    if usd_hkd_rate is not None and usd_hkd_rate > ZERO:
        rates_to_base["HKD"] = _decimal_to_str(usd_hkd_rate) or ""
        cnh_hkd_rate = rates.get("CNH")
        if cnh_hkd_rate is not None and cnh_hkd_rate > ZERO:
            rates_to_base["CNH"] = _decimal_to_str(usd_hkd_rate / cnh_hkd_rate) or ""
    return {currency: rate for currency, rate in rates_to_base.items() if rate}


def _build_hsbc_statement_source_artifact(
    pdf_bytes: bytes,
    *,
    source_filename: str,
    account: str,
    statement_day: date,
    source_kind: str,
    bundle_role: str,
    statement_title: str,
    statement_period_start: date | None = None,
    related_sha256: str = "",
) -> dict[str, Any]:
    """Build immutable evidence metadata for one exact HSBC statement PDF."""
    content_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    normalized_filename = _normalize_text(source_filename) or (
        f"hsbc-{bundle_role}-{statement_day.isoformat()}.pdf"
    )
    bundle_id = f"hsbc-statement:{statement_day.isoformat()}"
    return {
        "evidence_schema_version": "1.0",
        "sha256": content_sha256,
        "byte_count": len(pdf_bytes),
        "content_encoding": "base64",
        "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "storage_key": content_sha256,
        "filename": normalized_filename,
        "filenames": [normalized_filename],
        "broker": "hsbc",
        "account": account,
        "source_kind": source_kind,
        "bundle_id": bundle_id,
        "bundle_ids": [bundle_id],
        "bundle_role": bundle_role,
        "related_sha256": _normalize_text(related_sha256).lower(),
        "statement_title": statement_title,
        "statement_period": statement_day.strftime("%Y-%m"),
        "statement_period_start": (
            statement_period_start.isoformat() if statement_period_start else ""
        ),
        "statement_period_end": statement_day.isoformat(),
        "statement_generated_at": "",
    }


def _build_hsbc_statement_pdf_cash_capture(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
    extracted_text: str | None = None,
) -> dict[str, Any]:
    text = (
        extracted_text
        if extracted_text is not None
        else _investment_import_compat.extract_statement_pdf_text(pdf_bytes, "HSBC")
    )
    if "HSBC One" not in text:
        raise ValueError(
            f"The uploaded PDF {source_filename or '<uploaded file>'} is not a recognized HSBC One statement."
        )
    account_number = _ii_hsbc_core._extract_hsbc_account_number_from_text(text)
    if HSBC_EXPECTED_ACCOUNT_NUMBER and account_number != HSBC_EXPECTED_ACCOUNT_NUMBER:
        raise ValueError(
            f"HSBC statement PDF {source_filename or '<uploaded file>'} must belong to account {HSBC_EXPECTED_ACCOUNT_NUMBER}."
        )
    statement_day = _parse_hsbc_statement_date(text, source_filename)
    statement_period = f"{statement_day:%Y-%m}"
    source_artifact = _build_hsbc_statement_source_artifact(
        pdf_bytes,
        source_filename=source_filename,
        account=account_number,
        statement_day=statement_day,
        source_kind="hsbc_composite_statement_pdf",
        bundle_role="composite_statement",
        statement_title="HSBC One Composite Statement",
    )
    warnings: list[str] = []
    records: list[dict[str, Any]] = []
    starting_by_currency: dict[str, Decimal] = {}
    ending_by_currency: dict[str, Decimal] = {}
    ending_components: dict[str, Decimal] = {}
    component_post_dates: dict[str, str] = {}
    exchange_rates_to_base = _extract_hsbc_statement_exchange_rates(text)
    row_number = 0

    for section in _extract_hsbc_statement_cash_sections(text):
        current_day: date | None = None
        running_balances: dict[str, Decimal] = {}
        section_starting_by_currency: dict[str, Decimal] = {}
        section_ending_by_currency: dict[str, Decimal] = {}
        pending_description_parts: list[str] = []
        current_currency = _ii_merge_identity._normalize_hsbc_currency_code(
            section.get("currency")
        )
        current_currency_raw = _normalize_text(section.get("currency_raw")).upper()
        column_positions = (88, 116, 143)
        date_pattern = re.compile(
            r"^\s*(?:(?P<currency>USD|HKD|CNH|CNY|RMB)\s+)?"
            r"(?P<date>\d{1,2}\s+[A-Za-z]{3})\s+(?P<rest>.*)$",
            re.IGNORECASE,
        )

        for raw_line in section.get("lines", []):
            line = raw_line.rstrip()
            if _is_hsbc_statement_boilerplate_line(line):
                continue
            next_column_positions = _hsbc_statement_column_positions(line)
            if next_column_positions is not None:
                column_positions = next_column_positions
                continue
            date_match = date_pattern.match(line)
            content_start = 0
            if date_match is not None:
                raw_row_currency = _normalize_text(date_match.group("currency")).upper()
                if raw_row_currency:
                    current_currency_raw = raw_row_currency
                    current_currency = _ii_merge_identity._normalize_hsbc_currency_code(
                        raw_row_currency
                    )
                    pending_description_parts = []
                current_day = _parse_hsbc_statement_transaction_date(
                    date_match.group("date"),
                    statement_day,
                )
                content_start = date_match.start("rest")
            elif current_day is None:
                continue

            spans = _hsbc_statement_money_spans(line)
            content = line[content_start:]
            if not spans:
                detail = _normalize_whitespace(content)
                if detail:
                    pending_description_parts.append(detail)
                continue

            balance_values = [
                _parse_hsbc_statement_money_value(value)
                for start, _end, value in spans
                if _hsbc_statement_amount_kind(start, column_positions) == "balance"
            ]
            non_balance_spans = [
                (
                    start,
                    end,
                    value,
                    _hsbc_statement_amount_kind(start, column_positions),
                )
                for start, end, value in spans
                if _hsbc_statement_amount_kind(start, column_positions)
                in {"deposit", "withdrawal"}
            ]
            if not current_currency:
                continue
            if not non_balance_spans and balance_values:
                running_balances[current_currency] = balance_values[-1]
                section_ending_by_currency[current_currency] = balance_values[-1]
                if current_currency not in section_starting_by_currency:
                    section_starting_by_currency[current_currency] = balance_values[-1]
                pending_description_parts = []
                continue

            for span_index, (start, _end, amount_text, amount_kind) in enumerate(
                non_balance_spans
            ):
                detail = _normalize_whitespace(line[content_start:start])
                description_parts = pending_description_parts + (
                    [detail] if detail else []
                )
                description = _normalize_whitespace(" ".join(description_parts))
                pending_description_parts = []
                amount_dec = abs(_parse_hsbc_statement_money_value(amount_text))
                signed_amount = amount_dec if amount_kind == "deposit" else -amount_dec
                previous_balance = running_balances.get(current_currency)
                has_printed_balance = (
                    bool(balance_values) and span_index == len(non_balance_spans) - 1
                )
                if has_printed_balance:
                    balance_after = balance_values[-1]
                    if previous_balance is not None:
                        expected_balance = previous_balance + signed_amount
                        if balance_after != expected_balance:
                            opposite_signed_amount = -signed_amount
                            if (
                                previous_balance + opposite_signed_amount
                                == balance_after
                            ):
                                signed_amount = opposite_signed_amount
                                amount_kind = (
                                    "deposit"
                                    if amount_kind == "withdrawal"
                                    else "withdrawal"
                                )
                            else:
                                raise ValueError(
                                    f"HSBC statement PDF {source_filename or '<uploaded file>'} "
                                    f"failed balance continuity for {current_currency} on "
                                    f"{current_day.isoformat()}: printed balance "
                                    f"{_decimal_to_str(balance_after)} does not equal expected "
                                    f"{_decimal_to_str(expected_balance)} after "
                                    f"{_decimal_to_str(signed_amount)}."
                                )
                elif previous_balance is not None:
                    balance_after = previous_balance + signed_amount
                else:
                    balance_after = signed_amount
                running_balances[current_currency] = balance_after
                if current_currency not in section_starting_by_currency:
                    section_starting_by_currency[current_currency] = (
                        balance_after - signed_amount
                    )
                section_ending_by_currency[current_currency] = balance_after
                if not description:
                    description = (
                        f"HSBC {current_currency} statement deposit"
                        if signed_amount > ZERO
                        else f"HSBC {current_currency} statement withdrawal"
                    )
                mapped_type = _ii_hsbc_core._classify_hsbc_cash_account_transaction(
                    description, signed_amount
                )
                row_number += 1
                effective_account_type = _normalize_text(section.get("label"))
                if effective_account_type.lower() == "foreign currency savings":
                    effective_account_type = (
                        f"Foreign Currency Savings {current_currency}"
                    )
                record_source: dict[str, Any] = {
                    "file_kind": "hsbc_statement_cash",
                    "source_format": "statement_pdf",
                    "source_filename": source_filename,
                    "source_file_sha256": source_artifact["sha256"],
                    "row_number": row_number,
                    "ledger_sequence": row_number,
                    "account_number": account_number,
                    "balance_after_raw": _decimal_to_str(balance_after),
                    "reference_id": description,
                    "account_type": effective_account_type,
                    "cash_balance_scope": "account",
                    "cash_balance_authoritative": False,
                    "statement_period": statement_period,
                    "statement_date": statement_day.isoformat(),
                }
                if current_currency_raw:
                    record_source["statement_currency_raw"] = current_currency_raw
                if current_currency in exchange_rates_to_base:
                    record_source["statement_currency_to_base_rate_raw"] = (
                        exchange_rates_to_base[current_currency]
                    )
                if mapped_type == "forex_trade_component":
                    forex_pair_reference = (
                        _ii_hsbc_core._extract_hsbc_statement_forex_pair_reference(
                            description
                        )
                    )
                    if forex_pair_reference:
                        record_source["forex_pair_reference_id"] = forex_pair_reference
                        record_source["forex_pair_reference_source"] = (
                            "hsbc_statement_description"
                        )
                        record_source["forex_pair_component"] = (
                            "acquired" if signed_amount > ZERO else "sold"
                        )
                record: dict[str, Any] = {
                    "date": current_day.isoformat(),
                    "datetime": f"{current_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
                    "type": mapped_type,
                    "ticker": "",
                    "currency": current_currency,
                    "description": description,
                    "source": record_source,
                    "quantity_raw": "",
                    "quantity_abs": "",
                    "price_raw": "",
                    "gross_amount_raw": _decimal_to_str(signed_amount),
                    "commission_raw": "0",
                    "net_amount_raw": _decimal_to_str(signed_amount),
                    "broker": "hsbc",
                    "account": account_number,
                }
                record["normalized"] = _build_normalized_view(
                    mapped_type,
                    None,
                    None,
                    signed_amount,
                    ZERO,
                    signed_amount,
                    is_cash_flow_override=True,
                )
                records.append(record)
            tail_text = line[spans[-1][1] :]
            if _normalize_whitespace(tail_text):
                pending_description_parts.append(_normalize_whitespace(tail_text))
        for currency, amount in section_starting_by_currency.items():
            starting_by_currency[currency] = (
                starting_by_currency.get(currency, ZERO) + amount
            )
        for currency, amount in section_ending_by_currency.items():
            ending_by_currency[currency] = (
                ending_by_currency.get(currency, ZERO) + amount
            )
            account_type = (
                _normalize_text(section.get("label")) or f"{currency} Savings"
            )
            if account_type.lower() == "foreign currency savings":
                account_type = f"Foreign Currency Savings {currency}"
            component_key = _ii_hsbc_core._hsbc_cash_balance_component_key(
                currency, account_type
            )
            if component_key:
                ending_components[component_key] = amount
                component_post_dates[component_key] = statement_day.isoformat()

    return {
        "account_number": account_number,
        "statement_period": statement_period,
        "statement_day": statement_day,
        "records": records,
        "warnings": warnings,
        "starting_by_currency": starting_by_currency,
        "ending_by_currency": ending_by_currency,
        "ending_components": ending_components,
        "component_post_dates": component_post_dates,
        "exchange_rates_to_base": exchange_rates_to_base,
        "source_artifact": source_artifact,
    }


def _build_hsbc_statement_pdf_cash_records(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
    extracted_text: str | None = None,
) -> tuple[str, str, date, list[dict[str, Any]], list[str]]:
    capture = _build_hsbc_statement_pdf_cash_capture(
        pdf_bytes,
        source_filename=source_filename,
        extracted_text=extracted_text,
    )
    return (
        capture["account_number"],
        capture["statement_period"],
        capture["statement_day"],
        capture["records"],
        capture["warnings"],
    )


def build_investment_payload_from_hsbc_statement_pdfs(
    statement_pdf_payloads: list[tuple[bytes, str]],
    *,
    _extracted_text_by_payload_id: dict[int, str] | None = None,
) -> dict[str, Any]:
    non_empty = [
        (payload, filename) for payload, filename in statement_pdf_payloads if payload
    ]
    if not non_empty:
        raise ValueError("Upload at least one HSBC statement PDF.")

    all_transactions: list[dict[str, Any]] = []
    warnings: list[str] = []
    accounts: set[str] = set()
    periods: list[str] = []
    statement_dates: list[date] = []
    captures: list[dict[str, Any]] = []
    extracted_text_by_payload_id = dict(_extracted_text_by_payload_id or {})
    for pdf_bytes, filename in non_empty:
        extracted_text = extracted_text_by_payload_id.get(id(pdf_bytes))
        capture = _build_hsbc_statement_pdf_cash_capture(
            pdf_bytes,
            source_filename=filename,
            extracted_text=extracted_text,
        )
        account = capture["account_number"]
        period = capture["statement_period"]
        statement_day = capture["statement_day"]
        records = capture["records"]
        accounts.add(account)
        periods.append(period)
        statement_dates.append(statement_day)
        warnings.extend(capture["warnings"])
        all_transactions.extend(records)
        captures.append(capture)

    if len(accounts) > 1:
        raise ValueError(
            "The uploaded HSBC statement PDFs belong to different accounts."
        )

    seen_keys: set[tuple[str, ...]] = set()
    transactions: list[dict[str, Any]] = []
    duplicate_statement_rows = 0
    for record in all_transactions:
        record_key = _ii_hsbc_cash._hsbc_cash_record_identity_key(record)
        if record_key in seen_keys:
            duplicate_statement_rows += 1
            continue
        seen_keys.add(record_key)
        transactions.append(record)

    _ii_records._sort_transactions(transactions)
    account = next(iter(accounts), HSBC_EXPECTED_ACCOUNT_NUMBER)
    unique_periods = sorted(set(periods))
    if not transactions:
        warnings.append(
            "No HSBC cash-account transactions were found in the uploaded statements."
        )
    ordered_captures = sorted(captures, key=lambda capture: capture["statement_day"])
    cash_captures = [
        capture
        for capture in ordered_captures
        if capture.get("starting_by_currency") or capture.get("ending_by_currency")
    ]
    earliest_cash_capture = cash_captures[0] if cash_captures else {}
    latest_cash_capture = cash_captures[-1] if cash_captures else {}
    starting_cash_by_currency = _ii_merge_identity._normalize_hsbc_currency_balance_map(
        earliest_cash_capture.get("starting_by_currency")
    )
    ending_cash_by_currency = _ii_merge_identity._normalize_hsbc_currency_balance_map(
        latest_cash_capture.get("ending_by_currency")
    )
    ending_cash_components = (
        _ii_payload_summaries._normalize_hsbc_ending_cash_components(
            latest_cash_capture.get("ending_components")
        )
    )
    ending_cash_component_post_dates = (
        _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
            latest_cash_capture.get("component_post_dates") or {}
        )
    )
    starting_cash_dec = _ii_hsbc_cash._parse_decimal_text_or_none(
        (earliest_cash_capture.get("starting_by_currency") or {}).get("USD")
    )
    ending_cash_dec = _ii_hsbc_cash._parse_decimal_text_or_none(
        (latest_cash_capture.get("ending_by_currency") or {}).get("USD")
    )
    starting_cash = (
        _decimal_to_str(starting_cash_dec) if starting_cash_dec is not None else None
    )
    ending_cash = (
        _decimal_to_str(ending_cash_dec) if ending_cash_dec is not None else None
    )
    if cash_captures:
        latest_ending_by_currency = latest_cash_capture.get("ending_by_currency") or {}
        latest_rates_to_base = latest_cash_capture.get("exchange_rates_to_base") or {}
    else:
        latest_ending_by_currency = {}
        latest_rates_to_base = {}
    ending_cash_base_currency = None
    if cash_captures:
        ending_cash_base_currency_dec = ZERO
        for raw_currency, raw_amount in latest_ending_by_currency.items():
            currency = _ii_merge_identity._normalize_hsbc_currency_code(raw_currency)
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
            rate = _ii_hsbc_cash._parse_decimal_text_or_none(
                latest_rates_to_base.get(currency)
            )
            if not currency or amount is None:
                continue
            if currency == "USD":
                ending_cash_base_currency_dec += amount
            elif rate is not None and rate > ZERO:
                ending_cash_base_currency_dec += amount / rate
        ending_cash_base_currency = _decimal_to_str(ending_cash_base_currency_dec)
    source_artifacts = [
        capture["source_artifact"]
        for capture in captures
        if isinstance(capture.get("source_artifact"), dict)
    ]

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "hsbc_statement_pdf_to_investment_json",
            "version": HSBC_STATEMENT_PDF_IMPORTER_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "source_filename": ", ".join(filename for _, filename in non_empty),
            "statement_period": ", ".join(unique_periods),
            "statement_count": len(non_empty),
            "transaction_row_count": len(transactions),
            "duplicate_statement_row_count": duplicate_statement_rows,
        },
        "broker": "hsbc",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": (
                "Hong Kong posting date printed on the HSBC statement PDF cash-account row; "
                "it is not time-zone converted."
            ),
            "datetime_field_meaning": (
                "Source statement time is omitted. The original Hong Kong calendar date is "
                "retained and given the project convention time "
                f"{DEFAULT_CONVENTION_TIME}."
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_date_timezone": HSBC_STATEMENT_DATE_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots={},
            performance_snapshots={},
            starting_cash=starting_cash,
            ending_cash=ending_cash,
        ),
        "starting_cash": starting_cash,
        "ending_cash": ending_cash,
        "starting_cash_by_currency": starting_cash_by_currency,
        "ending_cash_by_currency": ending_cash_by_currency,
        "starting_cash_base_currency": starting_cash,
        "ending_cash_base_currency": ending_cash_base_currency,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": source_artifacts,
        "transactions": transactions,
    }
    payload["summary"]["statement_count"] = len(non_empty)
    payload["summary"]["statement_periods"] = unique_periods
    payload["summary"]["cash_flow_transaction_source"] = "hsbc_statement_cash"
    payload["summary"]["cash_snapshot_source"] = "hsbc_statement_cash_balances"
    payload["summary"]["historical_statement_backfill"] = True
    payload["summary"]["starting_cash_by_currency"] = starting_cash_by_currency
    payload["summary"]["ending_cash_by_currency"] = ending_cash_by_currency
    payload["summary"]["hsbc_ending_cash_components"] = (
        _ii_hsbc_core._serialize_hsbc_cash_balance_components(ending_cash_components)
    )
    payload["summary"]["hsbc_cash_component_post_dates"] = (
        ending_cash_component_post_dates
    )
    payload["summary"]["starting_cash_base_currency"] = starting_cash
    payload["summary"]["ending_cash_base_currency"] = ending_cash_base_currency
    payload["summary"]["account_expected"] = HSBC_EXPECTED_ACCOUNT_NUMBER
    payload["summary"]["duplicate_statement_row_count"] = duplicate_statement_rows
    if statement_dates:
        payload["summary"]["statement_date_min"] = min(statement_dates).isoformat()
        payload["summary"]["statement_date_max"] = max(statement_dates).isoformat()
    transaction_dates = [
        date.fromisoformat(_normalize_text(record.get("date"))[:10])
        for record in transactions
        if _normalize_text(record.get("date"))
    ]
    if transaction_dates:
        payload["summary"]["transaction_date_min"] = min(transaction_dates).isoformat()
        payload["summary"]["transaction_date_max"] = max(transaction_dates).isoformat()
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _parse_hsbc_compact_statement_date(value: str, field_label: str) -> date:
    match = re.fullmatch(
        r"(?P<day>\d{2})(?P<month>[A-Z]{3})(?P<year>20\d{2})", value.strip().upper()
    )
    if match is None:
        raise ValueError(f"{field_label} must use the DDMMMYYYY format.")
    month_number = HSBC_STATEMENT_MONTHS.get(match.group("month").lower())
    if month_number is None:
        raise ValueError(f"{field_label} has an unsupported month.")
    return date(int(match.group("year")), month_number, int(match.group("day")))


def _hsbc_investment_statement_metadata(
    text: str,
    source_filename: str,
) -> dict[str, Any]:
    if "Portfolio details" not in text or "Charges and income summary" not in text:
        raise ValueError(
            f"HSBC investment statement PDF {source_filename or '<uploaded file>'} "
            "is not an Investment services composite statement."
        )
    account_match = re.search(r"A/C no\s*:\s*([\d-]+)", text, re.IGNORECASE)
    date_match = re.search(r"Date\s*:\s*(\d{2}[A-Z]{3}20\d{2})", text, re.IGNORECASE)
    period_match = re.search(
        r"Period\s*:\s*From\s+(\d{2}[A-Z]{3}20\d{2})\s+to\s+(\d{2}[A-Z]{3}20\d{2})",
        text,
        re.IGNORECASE,
    )
    if account_match is None or date_match is None or period_match is None:
        raise ValueError(
            f"HSBC investment statement PDF {source_filename or '<uploaded file>'} "
            "is missing account, date, or period metadata."
        )
    account = _ii_basics._normalize_hsbc_account_number(account_match.group(1))
    if (
        HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER
        and account != HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER
    ):
        raise ValueError(
            f"HSBC investment statement PDF {source_filename or '<uploaded file>'} must belong "
            f"to investment account {HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER}."
        )
    statement_day = _parse_hsbc_compact_statement_date(
        date_match.group(1),
        "HSBC investment statement date",
    )
    period_start = _parse_hsbc_compact_statement_date(
        period_match.group(1),
        "HSBC investment statement period start",
    )
    period_end = _parse_hsbc_compact_statement_date(
        period_match.group(2),
        "HSBC investment statement period end",
    )
    if statement_day != period_end or period_start > period_end:
        raise ValueError(
            f"HSBC investment statement PDF {source_filename or '<uploaded file>'} has an inconsistent period."
        )
    holder_match = re.search(r"A/C name\s*:\s*([^\n\r]+)", text, re.IGNORECASE)
    return {
        "account": account,
        "statement_day": statement_day,
        "period_start": period_start,
        "period_end": period_end,
        "holder": _normalize_whitespace(holder_match.group(1)) if holder_match else "",
        "source_filename": source_filename,
    }


def _hsbc_composite_statement_metadata(
    text: str,
    source_filename: str,
) -> dict[str, Any]:
    if "HSBC One Portfolio" not in text or (
        "Foreign Currency Savings" not in text
        and "HSBC One Account Transaction History" not in text
    ):
        raise ValueError(
            f"HSBC composite statement PDF {source_filename or '<uploaded file>'} "
            "is not a recognized HSBC One composite statement."
        )
    account = _ii_hsbc_core._extract_hsbc_account_number_from_text(text)
    if HSBC_EXPECTED_ACCOUNT_NUMBER and account != HSBC_EXPECTED_ACCOUNT_NUMBER:
        raise ValueError(
            f"HSBC composite statement PDF {source_filename or '<uploaded file>'} must belong "
            f"to account {HSBC_EXPECTED_ACCOUNT_NUMBER}."
        )
    statement_day = _parse_hsbc_statement_date(text, source_filename)
    holder_match = re.search(r"\b(?:MR|MS|MRS|MISS)\s+([A-Z][A-Z ]+?)\s{2,}", text)
    return {
        "account": account,
        "statement_day": statement_day,
        "period_end": statement_day,
        "holder": _normalize_whitespace(holder_match.group(1)) if holder_match else "",
        "source_filename": source_filename,
    }


def _build_hsbc_investment_statement_position_snapshot(
    text: str,
    *,
    investment_account: str,
    statement_day: date,
) -> dict[str, dict[str, str]]:
    section = _ii_usmart_tiger._text_between(
        text, "Portfolio details", "Transaction summary"
    )
    header_pattern = re.compile(
        r"^\s*(?P<ticker>[A-Z][A-Z0-9.]{0,15})\s{2,}(?P<description>.+?\(SHS\))\s*$"
    )
    value_pattern = re.compile(
        r"^\s*Risk Lvl\s+\S+\s+(?P<opening>[\d,.-]+)\s+(?P<closing>[\d,.-]+)\s+"
        r"USD\s+(?P<price>[\d,.]+)\s+USD\s+(?P<value>[\d,.]+)\s*$"
    )
    lines = section.splitlines()
    snapshot: dict[str, dict[str, str]] = {}
    for index, line in enumerate(lines):
        header_match = header_pattern.match(line)
        if header_match is None:
            continue
        value_match = next(
            (
                value_pattern.match(lines[probe])
                for probe in range(index + 1, min(index + 4, len(lines)))
                if value_pattern.match(lines[probe]) is not None
            ),
            None,
        )
        if value_match is None:
            continue
        ticker = normalize_ticker(header_match.group("ticker"))
        opening_quantity = Decimal(value_match.group("opening").replace(",", ""))
        quantity = Decimal(value_match.group("closing").replace(",", ""))
        price = Decimal(value_match.group("price").replace(",", ""))
        market_value = Decimal(value_match.group("value").replace(",", ""))
        snapshot[ticker] = {
            "asset_category": "Stock",
            "currency": "USD",
            "quantity": _decimal_to_str(quantity) or "0",
            "statement_opening_quantity": (_decimal_to_str(opening_quantity) or "0"),
            "cost_price": "0",
            "cost_basis": "0",
            "market_value": _decimal_to_str(market_value) or "0",
            "market": "US",
            "full_name": re.sub(
                r"\s*\(SHS\)\s*$", "", header_match.group("description")
            ).strip(),
            "last_price": _decimal_to_str(price) or "0",
            "tradable_quantity": _decimal_to_str(quantity) or "0",
            "account_number": investment_account,
            "as_of": statement_day.isoformat(),
        }
    if not snapshot:
        raise ValueError(
            "No HSBC investment statement portfolio holdings could be parsed."
        )
    return snapshot


def _validate_hsbc_statement_period_holdings(
    transactions: list[dict[str, Any]],
    closing_position_snapshot: dict[str, dict[str, str]],
) -> list[dict[str, str]]:
    """Reconcile one statement period from printed opening to closing holdings."""
    period_changes = _ii_records._replay_holdings(transactions)
    mismatches: list[dict[str, str]] = []
    for ticker, snapshot in sorted(closing_position_snapshot.items()):
        opening_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            snapshot.get("statement_opening_quantity")
        )
        closing_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            snapshot.get("quantity")
        )
        if opening_quantity is None or closing_quantity is None:
            mismatches.append(
                {
                    "ticker": ticker,
                    "reason": "missing_statement_position_quantity",
                }
            )
            continue
        period_change = period_changes.get(ticker, ZERO)
        expected_closing_quantity = opening_quantity + period_change
        if expected_closing_quantity != closing_quantity:
            mismatches.append(
                {
                    "ticker": ticker,
                    "opening_quantity": _decimal_to_str(opening_quantity) or "0",
                    "period_change": _decimal_to_str(period_change) or "0",
                    "expected_closing_quantity": (
                        _decimal_to_str(expected_closing_quantity) or "0"
                    ),
                    "closing_quantity": _decimal_to_str(closing_quantity) or "0",
                }
            )

    for ticker, period_change in sorted(period_changes.items()):
        if ticker in closing_position_snapshot or period_change <= ZERO:
            continue
        mismatches.append(
            {
                "ticker": ticker,
                "opening_quantity": "0",
                "period_change": _decimal_to_str(period_change) or "0",
                "expected_closing_quantity": _decimal_to_str(period_change) or "0",
                "closing_quantity": "0",
            }
        )
    return mismatches


def _hsbc_statement_order_reference(raw_reference: str) -> str:
    match = re.fullmatch(
        r"(?P<prefix>PURTMP|SALTMP)(?P<number>\d+)001", raw_reference.strip().upper()
    )
    if match is None:
        return ""
    side_prefix = "P" if match.group("prefix") == "PURTMP" else "S"
    return f"{side_prefix}-{match.group('number')}"


def _parse_hsbc_investment_statement_charges(
    text: str,
) -> tuple[dict[str, Decimal], list[dict[str, Any]]]:
    section = text.split("Charges and income summary", 1)[1]
    lines = [_normalize_whitespace(line) for line in section.splitlines()]
    fees_by_order: dict[str, Decimal] = {}
    dividends: list[dict[str, Any]] = []
    event_pattern = re.compile(
        r"\d{2}[A-Z]{3}20\d{2} (?:SALE|CASH DIVIDEND) [A-Z0-9.]+"
    )
    event_indices = [
        index for index, line in enumerate(lines) if event_pattern.fullmatch(line)
    ]
    for event_offset, index in enumerate(event_indices):
        line = lines[index]
        next_event_index = (
            event_indices[event_offset + 1]
            if event_offset + 1 < len(event_indices)
            else len(lines)
        )
        event_block = lines[index + 1 : next_event_index]
        sale_match = re.fullmatch(
            r"(?P<date>\d{2}[A-Z]{3}20\d{2}) SALE (?P<ticker>[A-Z0-9.]+)", line
        )
        dividend_match = re.fullmatch(
            r"(?P<date>\d{2}[A-Z]{3}20\d{2}) CASH DIVIDEND (?P<ticker>[A-Z0-9.]+)",
            line,
        )
        if sale_match is not None:
            reference_match = next(
                (
                    re.search(r"OUR REFERENCE:\s*(SALTMP\d+001)", candidate)
                    for candidate in event_block
                    if re.search(r"OUR REFERENCE:\s*(SALTMP\d+001)", candidate)
                ),
                None,
            )
            fee_match = next(
                (
                    re.search(r"XACT CHARGE\s+USD\s+([\d,.]+)", candidate)
                    for candidate in event_block
                    if re.search(r"XACT CHARGE\s+USD\s+([\d,.]+)", candidate)
                ),
                None,
            )
            if reference_match is not None and fee_match is not None:
                order_reference = _hsbc_statement_order_reference(
                    reference_match.group(1)
                )
                fees_by_order[order_reference] = Decimal(
                    fee_match.group(1).replace(",", "")
                )
            continue
        if dividend_match is None:
            continue
        reference_match = next(
            (
                re.search(r"OUR REFERENCE:\s*(CORTMP\d+)", candidate)
                for candidate in event_block
                if re.search(r"OUR REFERENCE:\s*(CORTMP\d+)", candidate)
            ),
            None,
        )
        amount_match = next(
            (
                re.search(r"PAID BENEFITS\s+USD\s+([\d,.]+)", candidate)
                for candidate in event_block
                if re.search(r"PAID BENEFITS\s+USD\s+([\d,.]+)", candidate)
            ),
            None,
        )
        if reference_match is None or amount_match is None:
            continue
        description = next(
            (
                re.sub(r"\s*\(SHS\)\s*$", "", candidate).strip()
                for candidate in event_block
                if candidate.endswith("(SHS)")
            ),
            normalize_ticker(dividend_match.group("ticker")),
        )
        dividends.append(
            {
                "date": _parse_hsbc_compact_statement_date(
                    dividend_match.group("date"),
                    "HSBC dividend date",
                ),
                "ticker": normalize_ticker(dividend_match.group("ticker")),
                "description": description,
                "reference": reference_match.group(1),
                "amount": Decimal(amount_match.group(1).replace(",", "")),
            }
        )
    return fees_by_order, dividends


def _build_hsbc_investment_statement_records(
    text: str,
    *,
    metadata: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, str]]]:
    position_snapshot = _build_hsbc_investment_statement_position_snapshot(
        text,
        investment_account=metadata["account"],
        statement_day=metadata["statement_day"],
    )
    transaction_section = _ii_usmart_tiger._text_between(
        text, "Transaction summary", "Charges and income summary"
    )
    lines = transaction_section.splitlines()
    ticker_pattern = re.compile(
        r"^\s*(?P<ticker>[A-Z][A-Z0-9.]{0,15})\s{2,}(?P<description>.+?\(SHS\))\s*$"
    )
    trade_pattern = re.compile(
        r"^\s*(?P<trade_date>\d{2}[A-Z]{3}20\d{2})\s+"
        r"(?P<settlement_date>\d{2}[A-Z]{3}20\d{2})\s+USD\s+"
        r"(?P<price>[\d,.]+)\s+(?P<quantity>[\d,.]+)(?P<negative>-?)\s+"
        r"USD\s+(?P<settlement_amount>[\d,.]+)\s*$"
    )
    reference_pattern = re.compile(
        r"Reference:\s*(?P<reference>(?:PURTMP|SALTMP)\d+001)\s+Type:\s*(?P<type>PUR|SAL)"
    )
    fees_by_order, dividend_rows = _parse_hsbc_investment_statement_charges(text)
    current_ticker = ""
    current_description = ""
    pending_trade: dict[str, str] | None = None
    trade_records: list[dict[str, Any]] = []
    for line in lines:
        ticker_match = ticker_pattern.match(line)
        if ticker_match is not None:
            current_ticker = normalize_ticker(ticker_match.group("ticker"))
            current_description = re.sub(
                r"\s*\(SHS\)\s*$",
                "",
                ticker_match.group("description"),
            ).strip()
            continue
        trade_match = trade_pattern.match(line)
        if trade_match is not None:
            pending_trade = trade_match.groupdict()
            continue
        reference_match = reference_pattern.search(line)
        if reference_match is None or pending_trade is None or not current_ticker:
            continue
        order_reference = _hsbc_statement_order_reference(
            reference_match.group("reference")
        )
        side = "buy" if reference_match.group("type") == "PUR" else "sell"
        quantity = Decimal(pending_trade["quantity"].replace(",", ""))
        price = Decimal(pending_trade["price"].replace(",", ""))
        settlement_amount = Decimal(pending_trade["settlement_amount"].replace(",", ""))
        gross_amount = quantity * price
        signed_gross = -gross_amount if side == "buy" else gross_amount
        signed_net = -settlement_amount if side == "buy" else settlement_amount
        commission = -abs(fees_by_order.get(order_reference, ZERO))
        trade_day = _parse_hsbc_compact_statement_date(
            pending_trade["trade_date"],
            f"HSBC investment order {order_reference} trade date",
        )
        settlement_day = _parse_hsbc_compact_statement_date(
            pending_trade["settlement_date"],
            f"HSBC investment order {order_reference} settlement date",
        )
        record = {
            "date": trade_day.isoformat(),
            "datetime": f"{trade_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": side,
            "ticker": current_ticker,
            "currency": "USD",
            "description": current_description or current_ticker,
            "source": {
                "file_kind": "hsbc_order_status_text",
                "source_format": "investment_statement_pdf",
                "source_filename": metadata["source_filename"],
                "statement_account_number": metadata["account"],
                "statement_order_reference_raw": reference_match.group("reference"),
                "statement_order_id": order_reference,
                "order_id": order_reference,
                "order_status": "Settled",
                "transaction_type_raw": reference_match.group("type"),
                "cash_settlement_date": settlement_day.isoformat(),
                "cash_settlement_amount_raw": _decimal_to_str(signed_net),
                "statement_period_start": metadata["period_start"].isoformat(),
                "statement_period_end": metadata["period_end"].isoformat(),
            },
            "quantity_raw": _decimal_to_str(quantity) or "",
            "quantity_abs": _decimal_to_str(quantity) or "",
            "price_raw": _decimal_to_str(price) or "",
            "gross_amount_raw": _decimal_to_str(signed_gross),
            "commission_raw": _decimal_to_str(commission),
            "net_amount_raw": _decimal_to_str(signed_net),
            "broker": "hsbc",
            "account": HSBC_EXPECTED_ACCOUNT_NUMBER,
        }
        record["normalized"] = _build_normalized_view(
            side,
            quantity,
            price,
            signed_gross,
            commission,
            signed_net,
        )
        trade_records.append(record)
        pending_trade = None

    if not trade_records:
        raise ValueError("No HSBC investment statement transactions could be parsed.")

    dividend_records: list[dict[str, Any]] = []
    for row in dividend_rows:
        dividend_day = row["date"]
        amount = row["amount"]
        record = {
            "date": dividend_day.isoformat(),
            "datetime": f"{dividend_day.isoformat()} {DEFAULT_CONVENTION_TIME}",
            "type": "dividend",
            "ticker": row["ticker"],
            "currency": "USD",
            "description": row["description"],
            "source": {
                "file_kind": "hsbc_investment_statement_income",
                "source_format": "investment_statement_pdf",
                "source_filename": metadata["source_filename"],
                "statement_account_number": metadata["account"],
                "corporate_action_reference": row["reference"],
                "transaction_type_raw": "CASH DIVIDEND",
                "statement_period_start": metadata["period_start"].isoformat(),
                "statement_period_end": metadata["period_end"].isoformat(),
            },
            "quantity_raw": "",
            "quantity_abs": "",
            "price_raw": "",
            "gross_amount_raw": _decimal_to_str(amount),
            "commission_raw": "0",
            "net_amount_raw": _decimal_to_str(amount),
            "broker": "hsbc",
            "account": HSBC_EXPECTED_ACCOUNT_NUMBER,
        }
        record["normalized"] = _build_normalized_view(
            "dividend",
            None,
            None,
            amount,
            ZERO,
            amount,
            is_cash_flow_override=True,
        )
        dividend_records.append(record)
    return trade_records, dividend_records, position_snapshot


def _match_hsbc_statement_cash_record(
    cash_records: list[dict[str, Any]],
    used_record_ids: set[int],
    *,
    transaction_date: str,
    signed_amount: Decimal,
) -> dict[str, Any] | None:
    candidates = []
    for record in cash_records:
        if (
            id(record) in used_record_ids
            or _normalize_text(record.get("date")) != transaction_date
        ):
            continue
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(record.get("currency"))
            != "USD"
        ):
            continue
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(record.get("net_amount_raw"))
        if amount is None:
            continue
        difference = abs(amount - signed_amount)
        if difference <= Decimal("0.01"):
            candidates.append((difference, record))
    if not candidates:
        return None
    matched = min(candidates, key=lambda item: item[0])[1]
    used_record_ids.add(id(matched))
    return matched


def _build_hsbc_statement_pair_payload(
    composite_pdf: tuple[bytes, str],
    investment_pdf: tuple[bytes, str],
    *,
    composite_text: str | None = None,
    investment_text: str | None = None,
) -> dict[str, Any]:
    composite_bytes, composite_filename = composite_pdf
    investment_bytes, investment_filename = investment_pdf
    if composite_text is None:
        composite_text = _investment_import_compat.extract_statement_pdf_text(
            composite_bytes, "HSBC"
        )
    if investment_text is None:
        investment_text = _investment_import_compat.extract_statement_pdf_text(
            investment_bytes, "HSBC"
        )
    composite_metadata = _hsbc_composite_statement_metadata(
        composite_text, composite_filename
    )
    investment_metadata = _hsbc_investment_statement_metadata(
        investment_text, investment_filename
    )
    if composite_metadata["statement_day"] != investment_metadata["statement_day"]:
        raise ValueError(
            "HSBC composite and investment statements must have the same statement end date."
        )
    if (
        composite_metadata["holder"]
        and investment_metadata["holder"]
        and composite_metadata["holder"] != investment_metadata["holder"]
    ):
        raise ValueError(
            "HSBC composite and investment statements belong to different account holders."
        )

    cash_capture = _build_hsbc_statement_pdf_cash_capture(
        composite_bytes,
        source_filename=composite_filename,
        extracted_text=composite_text,
    )
    statement_day = cash_capture["statement_day"]
    cash_records = cash_capture["records"]
    cash_warnings = cash_capture["warnings"]
    trade_records, dividend_records, position_snapshot = (
        _build_hsbc_investment_statement_records(
            investment_text,
            metadata=investment_metadata,
        )
    )
    composite_artifact = cash_capture["source_artifact"]
    investment_artifact = _build_hsbc_statement_source_artifact(
        investment_bytes,
        source_filename=investment_filename,
        account=investment_metadata["account"],
        statement_day=statement_day,
        source_kind="hsbc_investment_statement_pdf",
        bundle_role="investment_statement",
        statement_title="HSBC Investment Services Composite Statement",
        statement_period_start=investment_metadata["period_start"],
        related_sha256=composite_artifact["sha256"],
    )
    composite_artifact["statement_period_start"] = investment_metadata[
        "period_start"
    ].isoformat()
    composite_artifact["related_sha256"] = investment_artifact["sha256"]
    for record in [*trade_records, *dividend_records]:
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        source["source_file_sha256"] = investment_artifact["sha256"]
        record["source"] = source
    warnings = list(cash_warnings)
    used_cash_record_ids: set[int] = set()
    unmatched_settlements: list[str] = []
    for record in trade_records:
        source = record["source"]
        signed_amount = (
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("net_amount_raw"))
            or ZERO
        )
        matched_cash = _match_hsbc_statement_cash_record(
            cash_records,
            used_cash_record_ids,
            transaction_date=source["cash_settlement_date"],
            signed_amount=signed_amount,
        )
        if matched_cash is None:
            unmatched_settlements.append(source["statement_order_id"])
            continue
        matched_source = (
            matched_cash.get("source")
            if isinstance(matched_cash.get("source"), dict)
            else {}
        )
        source["composite_cash_source_filename"] = composite_filename
        source["composite_cash_source_sha256"] = composite_artifact["sha256"]
        source["composite_cash_source_row_number"] = matched_source.get("row_number")
        source["cash_settlement_balance_after_raw"] = matched_source.get(
            "balance_after_raw"
        )
        commission = abs(
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("commission_raw"))
            or ZERO
        )
        if commission > ZERO:
            fee_cash = _match_hsbc_statement_cash_record(
                cash_records,
                used_cash_record_ids,
                transaction_date=source["cash_settlement_date"],
                signed_amount=-commission,
            )
            if fee_cash is None:
                unmatched_settlements.append(f"{source['statement_order_id']} fee")

    for record in dividend_records:
        signed_amount = (
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("net_amount_raw"))
            or ZERO
        )
        matched_cash = _match_hsbc_statement_cash_record(
            cash_records,
            used_cash_record_ids,
            transaction_date=_normalize_text(record.get("date")),
            signed_amount=signed_amount,
        )
        if matched_cash is None:
            unmatched_settlements.append(
                _normalize_text(
                    (record.get("source") or {}).get("corporate_action_reference")
                )
            )
            continue
        matched_source = (
            matched_cash.get("source")
            if isinstance(matched_cash.get("source"), dict)
            else {}
        )
        record["source"]["composite_cash_source_filename"] = composite_filename
        record["source"]["composite_cash_source_sha256"] = composite_artifact["sha256"]
        record["source"]["composite_cash_source_row_number"] = matched_source.get(
            "row_number"
        )
        record["source"]["cash_settlement_balance_after_raw"] = matched_source.get(
            "balance_after_raw"
        )

    if unmatched_settlements:
        raise ValueError(
            "HSBC statement pair cash reconciliation failed for: "
            + ", ".join(unmatched_settlements[:12])
        )

    remaining_cash_records = [
        record for record in cash_records if id(record) not in used_cash_record_ids
    ]
    transactions = remaining_cash_records + trade_records + dividend_records
    _ii_records._sort_transactions(transactions)
    holdings_mismatches = _validate_hsbc_statement_period_holdings(
        trade_records,
        position_snapshot,
    )
    if holdings_mismatches:
        mismatch_tickers = ", ".join(
            mismatch["ticker"] for mismatch in holdings_mismatches[:12]
        )
        raise ValueError(
            "HSBC investment statement opening holdings plus period trades do "
            f"not reconcile to the closing portfolio holdings: {mismatch_tickers}."
        )

    starting_cash_by_currency = _ii_merge_identity._normalize_hsbc_currency_balance_map(
        cash_capture.get("starting_by_currency")
    )
    ending_cash_by_currency = _ii_merge_identity._normalize_hsbc_currency_balance_map(
        cash_capture.get("ending_by_currency")
    )
    starting_cash = starting_cash_by_currency.get("USD")
    ending_cash = ending_cash_by_currency.get("USD")
    ending_cash_components = (
        _ii_payload_summaries._normalize_hsbc_ending_cash_components(
            cash_capture.get("ending_components")
        )
    )
    ending_cash_component_post_dates = (
        _ii_hsbc_core._serialize_hsbc_cash_component_post_dates(
            cash_capture.get("component_post_dates") or {}
        )
    )
    ending_cash_base_currency = None
    if ending_cash_by_currency:
        ending_cash_base_currency_dec = ZERO
        exchange_rates_to_base = cash_capture.get("exchange_rates_to_base") or {}
        for currency, raw_amount in ending_cash_by_currency.items():
            amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
            rate = _ii_hsbc_cash._parse_decimal_text_or_none(
                exchange_rates_to_base.get(currency)
            )
            if amount is None:
                continue
            if currency == "USD":
                ending_cash_base_currency_dec += amount
            elif rate is not None and rate > ZERO:
                ending_cash_base_currency_dec += amount / rate
        ending_cash_base_currency = _decimal_to_str(ending_cash_base_currency_dec)

    for record in transactions:
        record["broker"] = "hsbc"
        record["account"] = HSBC_EXPECTED_ACCOUNT_NUMBER
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        source["broker"] = "hsbc"
        source["account"] = HSBC_EXPECTED_ACCOUNT_NUMBER
        source["statement_pair_end_date"] = statement_day.isoformat()
        record["source"] = source

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "hsbc_statement_pair_to_investment_json",
            "version": HSBC_STATEMENT_PDF_IMPORTER_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "composite_source_filename": composite_filename,
            "investment_source_filename": investment_filename,
            "statement_period": statement_day.strftime("%Y-%m"),
            "statement_count": 2,
            "statement_pair_count": 1,
            "transaction_row_count": len(transactions),
        },
        "broker": "hsbc",
        "account": HSBC_EXPECTED_ACCOUNT_NUMBER,
        "datetime_policy": {
            "date_field_meaning": (
                "Hong Kong trade, settlement, posting, or income date printed on the paired "
                "HSBC statements; it is not time-zone converted."
            ),
            "datetime_field_meaning": (
                "Source statement time is omitted. The original Hong Kong calendar date is "
                "retained and given the project convention time "
                f"{DEFAULT_CONVENTION_TIME}."
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_date_timezone": HSBC_STATEMENT_DATE_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots=position_snapshot,
            performance_snapshots={},
            starting_cash=starting_cash,
            ending_cash=ending_cash,
        ),
        "starting_cash": starting_cash,
        "ending_cash": ending_cash,
        "starting_cash_by_currency": starting_cash_by_currency,
        "ending_cash_by_currency": ending_cash_by_currency,
        "starting_cash_base_currency": starting_cash,
        "ending_cash_base_currency": ending_cash_base_currency,
        "position_snapshot": position_snapshot,
        "performance_snapshot": {},
        "source_artifacts": [composite_artifact, investment_artifact],
        "transactions": transactions,
    }
    payload["summary"].update(
        {
            "position_snapshot_authoritative": True,
            "position_snapshot_source": "hsbc_investment_statement_pdf",
            "cash_snapshot_source": "hsbc_composite_statement_pdf",
            "cash_flow_transaction_source": "hsbc_composite_statement_pdf",
            "historical_statement_backfill": True,
            "statement_pair_count": 1,
            "statement_periods": [statement_day.strftime("%Y-%m")],
            "statement_date_min": statement_day.isoformat(),
            "statement_date_max": statement_day.isoformat(),
            "composite_statement_count": 1,
            "investment_statement_count": 1,
            "starting_cash_by_currency": starting_cash_by_currency,
            "ending_cash_by_currency": ending_cash_by_currency,
            "hsbc_ending_cash_components": (
                _ii_hsbc_core._serialize_hsbc_cash_balance_components(
                    ending_cash_components
                )
            ),
            "hsbc_cash_component_post_dates": ending_cash_component_post_dates,
            "starting_cash_base_currency": starting_cash,
            "ending_cash_base_currency": ending_cash_base_currency,
        }
    )
    transaction_dates = [
        _normalize_text(record.get("date"))[:10]
        for record in [*cash_records, *trade_records, *dividend_records]
        if re.fullmatch(
            r"20\d{2}-\d{2}-\d{2}",
            _normalize_text(record.get("date"))[:10],
        )
    ]
    if transaction_dates:
        payload["summary"]["transaction_date_min"] = min(transaction_dates)
        payload["summary"]["transaction_date_max"] = max(transaction_dates)
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    return payload


def build_investment_payload_from_hsbc_statement_pairs(
    *,
    composite_statement_payloads: list[tuple[bytes, str]],
    investment_statement_payloads: list[tuple[bytes, str]],
    _extracted_text_by_payload_id: dict[int, str] | None = None,
) -> dict[str, Any]:
    composites = [
        (payload, filename)
        for payload, filename in composite_statement_payloads
        if payload
    ]
    investments = [
        (payload, filename)
        for payload, filename in investment_statement_payloads
        if payload
    ]
    if not composites or not investments:
        raise ValueError(
            "Upload at least one HSBC composite statement PDF and one matching investment statement PDF."
        )

    extracted_text_by_payload_id = dict(_extracted_text_by_payload_id or {})
    composite_by_day: dict[date, tuple[bytes, str]] = {}
    for payload, filename in composites:
        text = extracted_text_by_payload_id.get(id(payload))
        if text is None:
            text = _investment_import_compat.extract_statement_pdf_text(payload, "HSBC")
            extracted_text_by_payload_id[id(payload)] = text
        metadata = _hsbc_composite_statement_metadata(text, filename)
        statement_day = metadata["statement_day"]
        if statement_day in composite_by_day:
            raise ValueError(
                f"Duplicate HSBC composite statements were uploaded for {statement_day.isoformat()}."
            )
        composite_by_day[statement_day] = (payload, filename)

    investment_by_day: dict[date, tuple[bytes, str]] = {}
    for payload, filename in investments:
        text = extracted_text_by_payload_id.get(id(payload))
        if text is None:
            text = _investment_import_compat.extract_statement_pdf_text(payload, "HSBC")
            extracted_text_by_payload_id[id(payload)] = text
        metadata = _hsbc_investment_statement_metadata(text, filename)
        statement_day = metadata["statement_day"]
        if statement_day in investment_by_day:
            raise ValueError(
                f"Duplicate HSBC investment statements were uploaded for {statement_day.isoformat()}."
            )
        investment_by_day[statement_day] = (payload, filename)

    composite_days = set(composite_by_day)
    investment_days = set(investment_by_day)
    if composite_days != investment_days:
        missing_investments = sorted(composite_days - investment_days)
        missing_composites = sorted(investment_days - composite_days)
        details = []
        if missing_investments:
            details.append(
                "missing investment statement for "
                + ", ".join(day.isoformat() for day in missing_investments)
            )
        if missing_composites:
            details.append(
                "missing composite statement for "
                + ", ".join(day.isoformat() for day in missing_composites)
            )
        raise ValueError("HSBC statement pairing failed: " + "; ".join(details) + ".")

    statement_days = sorted(composite_days)
    pair_payloads = [
        _build_hsbc_statement_pair_payload(
            composite_by_day[statement_day],
            investment_by_day[statement_day],
            composite_text=extracted_text_by_payload_id.get(
                id(composite_by_day[statement_day][0])
            ),
            investment_text=extracted_text_by_payload_id.get(
                id(investment_by_day[statement_day][0])
            ),
        )
        for statement_day in statement_days
    ]
    merged = pair_payloads[0]
    for pair_payload in pair_payloads[1:]:
        merged = _ii_merge.merge_investment_payloads(merged, pair_payload)
    merged["generator"] = {
        "name": "hsbc_statement_pairs_to_investment_json",
        "version": HSBC_STATEMENT_PDF_IMPORTER_VERSION,
        "generated_at": _ii_basics._now_iso(),
        "statement_pair_count": len(statement_days),
        "statement_count": len(statement_days) * 2,
        "statement_period": ", ".join(day.strftime("%Y-%m") for day in statement_days),
        "composite_source_filename": ", ".join(filename for _, filename in composites),
        "investment_source_filename": ", ".join(
            filename for _, filename in investments
        ),
    }
    merged["summary"].update(
        {
            "historical_statement_backfill": True,
            "statement_pair_count": len(statement_days),
            "statement_count": len(statement_days) * 2,
            "composite_statement_count": len(statement_days),
            "investment_statement_count": len(statement_days),
            "statement_date_min": statement_days[0].isoformat(),
            "statement_date_max": statement_days[-1].isoformat(),
        }
    )
    merged["summary"]["json_size_bytes"] = len(
        json.dumps(merged, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return merged


def build_investment_payload_from_hsbc_statement_bundle(
    statement_pdf_payloads: list[tuple[bytes, str]],
) -> dict[str, Any]:
    non_empty = [
        (payload, filename) for payload, filename in statement_pdf_payloads if payload
    ]
    if not non_empty:
        raise ValueError(
            "Upload matching HSBC composite and investment statement PDFs."
        )

    composite_statement_payloads: list[tuple[bytes, str]] = []
    investment_statement_payloads: list[tuple[bytes, str]] = []
    extracted_text_by_payload_id: dict[int, str] = {}
    classifications: list[tuple[bytes, str, str, bool]] = []
    for payload, filename in non_empty:
        text = _investment_import_compat.extract_statement_pdf_text(payload, "HSBC")
        extracted_text_by_payload_id[id(payload)] = text
        is_full_monthly_statement = (
            "HSBC One Portfolio" in text
            and "HSBC One Account Transaction History" in text
        )
        is_summary_only_statement = (
            "HSBC One Portfolio" in text
            and "Total Relationship Balance" in text
            and not is_full_monthly_statement
        )
        is_hsbc_cash_statement = is_full_monthly_statement or is_summary_only_statement
        is_composite_statement = "HSBC One Portfolio" in text and (
            "Foreign Currency Savings" in text
            or "HSBC One Account Transaction History" in text
        )
        is_investment_statement = (
            "Portfolio details" in text and "Charges and income summary" in text
        )
        if (
            is_hsbc_cash_statement or is_composite_statement
        ) and is_investment_statement:
            raise ValueError(
                f"HSBC could not identify {filename or '<uploaded file>'} as a cash statement or investment statement."
            )
        if (
            not is_hsbc_cash_statement
            and not is_composite_statement
            and not is_investment_statement
        ):
            raise ValueError(
                f"HSBC could not identify {filename or '<uploaded file>'} as a full monthly, composite, or investment statement."
            )
        classifications.append((payload, filename, text, is_hsbc_cash_statement))

    if classifications and all(item[3] for item in classifications):
        return build_investment_payload_from_hsbc_statement_pdfs(
            [
                (payload, filename)
                for payload, filename, _text, _is_full in classifications
            ],
            _extracted_text_by_payload_id=extracted_text_by_payload_id,
        )

    for payload, filename, text, _is_full_monthly_statement in classifications:
        is_investment_statement = (
            "Portfolio details" in text and "Charges and income summary" in text
        )
        if not is_investment_statement:
            _hsbc_composite_statement_metadata(text, filename)
            composite_statement_payloads.append((payload, filename))
        else:
            _hsbc_investment_statement_metadata(text, filename)
            investment_statement_payloads.append((payload, filename))

    return build_investment_payload_from_hsbc_statement_pairs(
        composite_statement_payloads=composite_statement_payloads,
        investment_statement_payloads=investment_statement_payloads,
        _extracted_text_by_payload_id=extracted_text_by_payload_id,
    )
