"""Investment import domain: bochk.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    BOCHK_ACCOUNT_SECTION_PATTERN,
    BOCHK_CURRENCY_ALIASES,
    BOCHK_CURRENCY_MARKERS,
    BOCHK_CUSTOMER_NUMBER_PATTERN,
    BOCHK_SECURITIES_CASH_SECTION,
    BOCHK_STATEMENT_DATE_PATTERN,
    BOCHK_STATEMENT_DATE_TIMEZONE,
    BOCHK_STATEMENT_IMPORTER_VERSION,
    BOCHK_STATEMENT_MONEY_PATTERN,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    SCHEMA_VERSION,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    base64,
    date,
    defaultdict,
    hashlib,
    json,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records

from app.services import investment_import_compat as _investment_import_compat


def _normalize_bochk_currency_code(value: Any) -> str:
    return BOCHK_CURRENCY_ALIASES.get(_normalize_text(value).upper(), "")


def _bochk_subaccount_short_number(account_number: str) -> str:
    match = re.search(r"-(?P<stem>\d{6})-(?P<check>\d)$", account_number)
    if match is None:
        return ""
    return f"{match.group('stem')[-3:]}{match.group('check')}"


def _parse_bochk_statement_date(text: str, source_filename: str) -> date:
    match = BOCHK_STATEMENT_DATE_PATTERN.search(text)
    if match is None:
        raise ValueError(
            f"BOCHK statement PDF {source_filename or '<uploaded file>'} is missing its statement date."
        )
    try:
        return date.fromisoformat(match.group("date").replace("/", "-"))
    except ValueError as exc:
        raise ValueError(
            f"BOCHK statement PDF {source_filename or '<uploaded file>'} has an invalid statement date."
        ) from exc


def _extract_bochk_customer_number(text: str, source_filename: str) -> str:
    match = BOCHK_CUSTOMER_NUMBER_PATTERN.search(text)
    if match is None:
        raise ValueError(
            f"BOCHK statement PDF {source_filename or '<uploaded file>'} is missing its customer number."
        )
    return _normalize_text(match.group("customer"))


def _extract_bochk_statement_sections(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    headings: list[tuple[int, re.Match[str]]] = []
    for index, line in enumerate(lines):
        match = BOCHK_ACCOUNT_SECTION_PATTERN.fullmatch(_normalize_text(line))
        if match is not None:
            headings.append((index, match))

    sections: list[dict[str, Any]] = []
    for heading_index, (start_index, match) in enumerate(headings):
        end_index = (
            headings[heading_index + 1][0]
            if heading_index + 1 < len(headings)
            else len(lines)
        )
        for probe in range(start_index + 1, end_index):
            if _normalize_text(lines[probe]).startswith(BOCHK_SECURITIES_CASH_SECTION):
                end_index = probe
                break
        account_type = _normalize_whitespace(match.group("account_type"))
        account_number = _normalize_text(match.group("account_number"))
        default_currency = "HKD" if account_type.upper().startswith("HKD ") else ""
        sections.append(
            {
                "account_type": account_type,
                "account_number": account_number,
                "account_number_short": _bochk_subaccount_short_number(account_number),
                "default_currency": default_currency,
                "lines": lines[start_index + 1 : end_index],
            }
        )
    return sections


def _bochk_statement_money_spans(line: str) -> list[tuple[int, int, str]]:
    return [
        (match.start(), match.end(), match.group(0))
        for match in BOCHK_STATEMENT_MONEY_PATTERN.finditer(line)
    ]


def _bochk_statement_column_positions(line: str) -> tuple[int, int, int] | None:
    deposit_match = re.search(r"\bDeposit\b", line, re.IGNORECASE)
    withdrawal_match = re.search(r"\bW\s*ithdrawal\b", line, re.IGNORECASE)
    balance_match = re.search(r"\bBalance\b", line, re.IGNORECASE)
    if deposit_match is None or withdrawal_match is None or balance_match is None:
        return None
    positions = (
        deposit_match.start(),
        withdrawal_match.start(),
        balance_match.start(),
    )
    return positions if positions[0] < positions[1] < positions[2] else None


def _bochk_statement_amount_kind(
    start_index: int,
    column_positions: tuple[int, int, int],
    *,
    is_final_balance: bool = False,
) -> str:
    """Classify a statement amount using the stable flow-column boundary.

    A right-aligned withdrawal can start to the right of the withdrawal
    header midpoint and therefore look like a balance when only the amount's
    start coordinate is considered.  Date rows are validated separately and
    always treat their rightmost amount as the balance column.
    """
    deposit_pos, withdrawal_pos, balance_pos = column_positions
    if is_final_balance:
        return "balance"
    if start_index < (deposit_pos + withdrawal_pos) / 2:
        return "deposit"
    return "withdrawal"


def _is_bochk_statement_boilerplate_line(line: str) -> bool:
    normalized = _normalize_whitespace(line)
    if not normalized:
        return True
    if re.search(r"\bConsolidated\s+Statement\b", normalized, re.IGNORECASE):
        return True
    if re.search(
        r"\b(?:Enrich|i-Free)\s+Banking\s+Customer\s+No\b",
        normalized,
        re.IGNORECASE,
    ):
        return True
    if re.search(
        r"\bStatement\s+Date\s+20\d{2}/\d{2}/\d{2}\b", normalized, re.IGNORECASE
    ):
        return True
    if re.search(r"\bPage\s+\d+\s*(?:/|of)\s*\d+\b", normalized, re.IGNORECASE):
        return True
    if re.search(r"\bAccount\s+Transaction\s+Details\b", normalized, re.IGNORECASE):
        return True
    if normalized.startswith(
        (
            "Address:",
            "Consolidated Statement",
            "Customer No",
            "Statement Date",
            "Page ",
            "Account Transaction Details",
            "For transactions conducted",
            "Important Notes",
            "BOCHK would like to remind",
            "Please examine and verify",
            "Unless otherwise specified",
            "The Reference Market Price",
            "The HK securities and China A Shares",
            "The Transaction Dates and Settlement Dates",
            "If the minimal unit",
            "(Applicable to HK securities only)",
        )
    ):
        return True
    if normalized in {
        "Deposit",
        "Savings Account",
        "Current Account",
        "Total Outstanding Balance:",
    }:
        return True
    if normalized.startswith(
        ("Date ", "Total Deposit / Withdrawal", "Total No. of Deposit")
    ):
        return True
    return bool(re.match(r"^\d+\.\)", normalized))


def _bochk_statement_type(description: str, signed_amount: Decimal) -> str:
    upper_description = description.upper()
    if "INTEREST" in upper_description:
        return "credit_interest" if signed_amount > ZERO else "debit_interest"
    if any(token in upper_description for token in ("FEE", "CHARGE", "COMMISSION")):
        return "fee"
    return "deposit" if signed_amount > ZERO else "withdrawal"


def _bochk_securities_cash_has_activity(text: str) -> bool:
    lines = text.splitlines()
    start_index = next(
        (
            index
            for index, line in enumerate(lines)
            if _normalize_text(line).startswith(BOCHK_SECURITIES_CASH_SECTION)
        ),
        -1,
    )
    if start_index < 0:
        return False
    end_index = next(
        (
            index
            for index in range(start_index + 1, len(lines))
            if _normalize_text(lines[index]).startswith("Important Notes")
        ),
        len(lines),
    )
    for line in lines[start_index:end_index]:
        if not re.match(r"^\s*20\d{2}/\d{2}/\d{2}\b", line):
            continue
        if any(
            abs(_parse_bochk_statement_money_value(raw_value)) > ZERO
            for _start, _end, raw_value in _bochk_statement_money_spans(line)
        ):
            return True
    return False


def _parse_bochk_statement_money_value(value: str) -> Decimal:
    normalized = value.strip().upper()
    is_parenthesized = normalized.startswith("(") and normalized.endswith(")")
    is_debit = normalized.endswith("DR")
    if is_debit:
        normalized = normalized[:-2].rstrip()
    if is_parenthesized:
        normalized = normalized[1:-1].strip()
    amount = Decimal(normalized.replace(",", ""))
    return -abs(amount) if is_debit or is_parenthesized else amount


def _bochk_statement_source_artifact(
    pdf_bytes: bytes,
    *,
    source_filename: str,
    account: str,
    statement_day: date,
) -> dict[str, Any]:
    return {
        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
        "byte_count": len(pdf_bytes),
        "content_encoding": "base64",
        "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "storage_key": hashlib.sha256(pdf_bytes).hexdigest(),
        "filename": source_filename,
        "source_kind": "boc_hk_statement_pdf",
        "broker": "boc_hk",
        "account": account,
        "statement_title": "BOCHK Consolidated Statement",
        "statement_period": statement_day.strftime("%Y-%m"),
        "statement_period_end": statement_day.isoformat(),
    }


def _build_bochk_statement_pdf_capture(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
    extracted_text: str | None = None,
) -> dict[str, Any]:
    text = (
        extracted_text
        if extracted_text is not None
        else _investment_import_compat.extract_statement_pdf_text(pdf_bytes, "BOCHK")
    )
    if (
        "Consolidated Statement" not in text
        or "Account Transaction Details" not in text
    ):
        raise ValueError(
            f"The uploaded PDF {source_filename or '<uploaded file>'} is not a recognized BOCHK Consolidated Statement."
        )
    statement_day = _parse_bochk_statement_date(text, source_filename)
    customer_number = _extract_bochk_customer_number(text, source_filename)
    sections = _extract_bochk_statement_sections(text)
    if not sections:
        raise ValueError(
            f"BOCHK statement PDF {source_filename or '<uploaded file>'} has no supported deposit-account sections."
        )
    if _bochk_securities_cash_has_activity(text):
        raise ValueError(
            f"BOCHK statement PDF {source_filename or '<uploaded file>'} contains non-zero securities-account cash activity; "
            "the BOCHK cash-only statement importer will not silently discard it."
        )

    warnings: list[str] = []
    records: list[dict[str, Any]] = []
    subaccounts: dict[tuple[str, str], dict[str, Any]] = {}
    row_number = 0

    for section in sections:
        account_type = _normalize_text(section.get("account_type"))
        account_number = _normalize_text(section.get("account_number"))
        account_number_short = _normalize_text(section.get("account_number_short"))
        current_currency = _normalize_text(section.get("default_currency")).upper()
        current_currency_raw = current_currency
        column_positions: tuple[int, int, int] | None = None
        in_transaction_details = False
        last_record: dict[str, Any] | None = None
        section_lines = (
            section.get("lines") if isinstance(section.get("lines"), list) else []
        )

        def state_for_subaccount() -> dict[str, Any]:
            subaccount_key = (account_number, current_currency)
            state = subaccounts.setdefault(
                subaccount_key,
                {
                    "account_number": account_number,
                    "account_number_short": account_number_short,
                    "account_type": account_type,
                    "currency": current_currency,
                    "currency_raw": current_currency_raw,
                    "starting": None,
                    "ending": None,
                    "running_balance": None,
                    "flow_total": ZERO,
                },
            )
            state["currency_raw"] = current_currency_raw
            return state

        for raw_line in section_lines:
            line = str(raw_line).rstrip()
            normalized_line = _normalize_whitespace(line)
            next_column_positions = _bochk_statement_column_positions(line)
            if next_column_positions is not None:
                column_positions = next_column_positions
                in_transaction_details = True
                last_record = None
                continue

            if normalized_line.upper() in BOCHK_CURRENCY_MARKERS:
                current_currency_raw = normalized_line.upper()
                current_currency = _normalize_bochk_currency_code(current_currency_raw)
                last_record = None
                continue

            if not normalized_line:
                continue

            if _is_bochk_statement_boilerplate_line(line):
                in_transaction_details = False
                column_positions = None
                last_record = None
                continue

            date_match = re.match(
                r"^\s*(?P<date>20\d{2}/\d{2}/\d{2})\s+(?P<rest>.*)$",
                line,
            )
            if date_match is None:
                money_spans = _bochk_statement_money_spans(line)
                if (
                    in_transaction_details
                    and column_positions is not None
                    and money_spans
                ):
                    deposit_pos, _withdrawal_pos, _balance_pos = column_positions
                    if (
                        last_record is None
                        or not line[:1].isspace()
                        or any(
                            end > deposit_pos for _start, end, _raw_value in money_spans
                        )
                    ):
                        raise ValueError(
                            f"BOCHK statement PDF {source_filename or '<uploaded file>'} has an "
                            "undated amount row outside the transaction-description boundary."
                        )
                if (
                    last_record is not None
                    and in_transaction_details
                    and line[:1].isspace()
                ):
                    description = _normalize_whitespace(
                        f"{last_record.get('description', '')} {normalized_line}"
                    )
                    last_record["description"] = description
                    source = last_record.get("source")
                    if isinstance(source, dict):
                        source["reference_id"] = description
                elif last_record is not None:
                    last_record = None
                continue

            last_record = None
            transaction_day = date.fromisoformat(
                date_match.group("date").replace("/", "-")
            )
            if column_positions is None or not in_transaction_details:
                raise ValueError(
                    f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                    f"{transaction_day.isoformat()} is outside a transaction-details table."
                )
            spans = _bochk_statement_money_spans(line)
            if len(spans) == 1:
                row_description_probe = _normalize_whitespace(
                    line[date_match.start("rest") : spans[0][0]]
                ).upper()
                if not any(
                    marker in row_description_probe
                    for marker in ("BALANCE BROUGHT FORWARD", "BALANCE CARRIED FORWARD")
                ):
                    raise ValueError(
                        f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                        f"{transaction_day.isoformat()} has an ambiguous single amount."
                    )
                classified_spans = [(*spans[0], "balance")]
            elif len(spans) == 2:
                _deposit_pos, withdrawal_pos, balance_pos = column_positions
                if spans[-1][0] < (withdrawal_pos + balance_pos) / 2:
                    raise ValueError(
                        f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                        f"{transaction_day.isoformat()} has an unstable balance-column position."
                    )
                classified_spans = [
                    (
                        start,
                        end,
                        raw_value,
                        _bochk_statement_amount_kind(
                            start,
                            column_positions,
                            is_final_balance=index == len(spans) - 1,
                        ),
                    )
                    for index, (start, end, raw_value) in enumerate(spans)
                ]
            else:
                raise ValueError(
                    f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                    f"{transaction_day.isoformat()} has {len(spans)} amount columns; "
                    "the importer will not guess which values are cash flows."
                )
            balance_values = [
                _parse_bochk_statement_money_value(raw_value)
                for _start, _end, raw_value, kind in classified_spans
                if kind == "balance"
            ]
            flow_spans = [
                (start, end, raw_value, kind)
                for start, end, raw_value, kind in classified_spans
                if kind in {"deposit", "withdrawal"}
            ]
            rest_start = date_match.start("rest")
            description_end = spans[0][0] if spans else len(line)
            row_description = _normalize_whitespace(line[rest_start:description_end])
            upper_description = row_description.upper()

            if balance_values and not flow_spans:
                balance = balance_values[-1]
                if not current_currency:
                    raise ValueError(
                        f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                        f"{transaction_day.isoformat()} has an unknown statement currency."
                    )
                state = state_for_subaccount()
                if "BALANCE BROUGHT FORWARD" in upper_description:
                    previous_running = state.get("running_balance")
                    if previous_running is not None and previous_running != balance:
                        raise ValueError(
                            f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                            f"{transaction_day.isoformat()} breaks the opening-balance continuity."
                        )
                    if state.get("starting") is None:
                        state["starting"] = balance
                    state["running_balance"] = balance
                elif "BALANCE CARRIED FORWARD" in upper_description:
                    previous_running = state.get("running_balance")
                    if previous_running is not None and previous_running != balance:
                        raise ValueError(
                            f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                            f"{transaction_day.isoformat()} breaks the closing-balance continuity."
                        )
                    state["ending"] = balance
                    state["running_balance"] = balance
                else:
                    raise ValueError(
                        f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                        f"{transaction_day.isoformat()} has an unlabelled balance-only amount."
                    )
                continue

            if not current_currency:
                raise ValueError(
                    f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                    f"{transaction_day.isoformat()} has an unknown statement currency."
                )
            if not flow_spans:
                raise ValueError(
                    f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                    f"{transaction_day.isoformat()} has no cash-flow amount."
                )
            if len(flow_spans) != 1 or len(balance_values) != 1:
                raise ValueError(
                    f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                    f"{transaction_day.isoformat()} does not contain exactly one flow and one balance."
                )
            flow_start, _flow_end, flow_raw_value, flow_kind = flow_spans[0]
            flow_amount = abs(_parse_bochk_statement_money_value(flow_raw_value))
            signed_amount = flow_amount if flow_kind == "deposit" else -flow_amount
            balance_after = balance_values[-1] if balance_values else None
            state = state_for_subaccount()
            direction_reconciled = False
            running_balance = state.get("running_balance")
            if running_balance is not None:
                expected_balance = running_balance + signed_amount
                if expected_balance != balance_after:
                    opposite_signed_amount = -signed_amount
                    if running_balance + opposite_signed_amount == balance_after:
                        signed_amount = opposite_signed_amount
                        direction_reconciled = True
                    else:
                        raise ValueError(
                            f"BOCHK statement PDF {source_filename or '<uploaded file>'} row "
                            f"{transaction_day.isoformat()} breaks balance continuity."
                        )
            elif balance_after is not None:
                state["starting"] = balance_after - signed_amount
            state["running_balance"] = balance_after
            state["ending"] = balance_after
            state["flow_total"] = state.get("flow_total", ZERO) + signed_amount
            if not row_description:
                row_description = (
                    f"BOCHK {current_currency} statement deposit"
                    if signed_amount > ZERO
                    else f"BOCHK {current_currency} statement withdrawal"
                )
            mapped_type = _bochk_statement_type(row_description, signed_amount)
            row_number += 1
            source: dict[str, Any] = {
                "file_kind": "boc_hk_statement_pdf",
                "source_format": "statement_pdf",
                "source_filename": source_filename,
                "row_number": row_number,
                "ledger_sequence": row_number,
                "broker": "boc_hk",
                "account": customer_number,
                "customer_number": customer_number,
                "account_number": account_number,
                "account_number_short": account_number_short,
                "account_type": account_type,
                "statement_period": statement_day.strftime("%Y-%m"),
                "statement_date": statement_day.isoformat(),
                "statement_currency_raw": current_currency_raw,
                "balance_after_raw": _decimal_to_str(balance_after)
                if balance_after is not None
                else "",
                "reference_id": row_description,
                "cash_balance_scope": "subaccount",
                "cash_balance_authoritative": False,
            }
            if direction_reconciled:
                source["flow_direction_reconciled_by_balance"] = True
            record: dict[str, Any] = {
                "date": transaction_day.isoformat(),
                "datetime": _ii_basics._build_convention_datetime(
                    transaction_day.isoformat()
                ),
                "type": mapped_type,
                "ticker": "",
                "currency": current_currency,
                "description": row_description,
                "source": source,
                "quantity_raw": "",
                "quantity_abs": "",
                "price_raw": "",
                "gross_amount_raw": _decimal_to_str(signed_amount),
                "commission_raw": "0",
                "net_amount_raw": _decimal_to_str(signed_amount),
                "broker": "boc_hk",
                "account": customer_number,
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
            last_record = record

    for state in subaccounts.values():
        if state.get("starting") is None and state.get("ending") is not None:
            state["starting"] = state["ending"]
        if state.get("ending") is None and state.get("starting") is not None:
            state["ending"] = state["starting"]
        starting = state.get("starting")
        ending = state.get("ending")
        flow_total = state.get("flow_total", ZERO)
        if (
            isinstance(starting, Decimal)
            and isinstance(ending, Decimal)
            and isinstance(flow_total, Decimal)
            and starting + flow_total != ending
        ):
            raise ValueError(
                f"BOCHK statement PDF {source_filename or '<uploaded file>'} has an "
                "unreconciled subaccount balance."
            )

    starting_by_currency: dict[str, Decimal] = {}
    ending_by_currency: dict[str, Decimal] = {}
    for state in subaccounts.values():
        currency = _normalize_text(state.get("currency")).upper()
        starting = state.get("starting")
        ending = state.get("ending")
        if currency and isinstance(starting, Decimal):
            starting_by_currency[currency] = (
                starting_by_currency.get(currency, ZERO) + starting
            )
        if currency and isinstance(ending, Decimal):
            ending_by_currency[currency] = (
                ending_by_currency.get(currency, ZERO) + ending
            )

    return {
        "account": customer_number,
        "statement_day": statement_day,
        "statement_period": statement_day.strftime("%Y-%m"),
        "records": records,
        "warnings": warnings,
        "starting_by_currency": starting_by_currency,
        "ending_by_currency": ending_by_currency,
        "subaccounts": subaccounts,
        "source_artifact": _bochk_statement_source_artifact(
            pdf_bytes,
            source_filename=source_filename,
            account=customer_number,
            statement_day=statement_day,
        ),
    }


def build_investment_payload_from_bochk_statement_pdfs(
    statement_pdf_payloads: list[tuple[bytes, str]],
    *,
    _extracted_text_by_payload_id: dict[int, str] | None = None,
) -> dict[str, Any]:
    normalized_payloads: list[tuple[bytes, str]] = []
    for pdf_bytes, filename in statement_pdf_payloads:
        source_filename = str(filename or "").strip()
        if not source_filename:
            raise ValueError(
                "Every uploaded BOCHK statement must have a non-empty filename."
            )
        if not source_filename.lower().endswith(".pdf"):
            raise ValueError(
                f"The uploaded BOCHK statement '{source_filename}' must use a .pdf filename."
            )
        if not pdf_bytes:
            raise ValueError(
                f"The uploaded BOCHK statement PDF '{source_filename}' is empty."
            )
        normalized_payloads.append((pdf_bytes, source_filename))

    if not normalized_payloads:
        raise ValueError("Upload at least one BOCHK Consolidated Statement PDF.")

    extracted_text_by_payload_id = dict(_extracted_text_by_payload_id or {})
    captures: list[dict[str, Any]] = []
    for pdf_bytes, filename in normalized_payloads:
        captures.append(
            _build_bochk_statement_pdf_capture(
                pdf_bytes,
                source_filename=filename,
                extracted_text=extracted_text_by_payload_id.get(id(pdf_bytes)),
            )
        )

    accounts = {_normalize_text(capture.get("account")) for capture in captures}
    accounts.discard("")
    if len(accounts) > 1:
        raise ValueError(
            "The uploaded BOCHK statement PDFs belong to different customer accounts."
        )
    account = next(iter(accounts), "")
    transactions: list[dict[str, Any]] = []
    seen_occurrence_slots: set[tuple[tuple[str, ...], int]] = set()
    duplicate_statement_rows = 0
    for capture in captures:
        occurrence_indexes: dict[tuple[str, ...], int] = defaultdict(int)
        for record in capture.get("records", []):
            if not isinstance(record, dict):
                continue
            identity_key = _ii_merge_identity._transaction_identity_key(record)
            occurrence_index = occurrence_indexes[identity_key]
            occurrence_indexes[identity_key] += 1
            occurrence_slot = (identity_key, occurrence_index)
            if occurrence_slot in seen_occurrence_slots:
                duplicate_statement_rows += 1
                continue
            seen_occurrence_slots.add(occurrence_slot)
            transactions.append(record)
    _ii_records._sort_transactions(transactions)

    warnings = [
        warning
        for capture in captures
        for warning in capture.get("warnings", [])
        if _normalize_text(warning)
    ]
    if not transactions:
        warnings.append(
            "No BOCHK deposit-account transactions were found in the uploaded statements."
        )
    ordered_captures = sorted(
        captures,
        key=lambda capture: (
            capture.get("statement_day", date.min),
            len(capture.get("records", [])),
            _normalize_text(capture.get("statement_period")),
        ),
    )
    earliest_capture = ordered_captures[0]
    latest_capture = ordered_captures[-1]
    statement_days = [capture["statement_day"] for capture in captures]
    periods = sorted(
        {_normalize_text(capture.get("statement_period")) for capture in captures}
    )
    subaccount_balances: dict[str, dict[str, Any]] = {}
    for state in latest_capture.get("subaccounts", {}).values():
        if not isinstance(state, dict):
            continue
        account_number = _normalize_text(state.get("account_number"))
        currency = _normalize_text(state.get("currency")).upper()
        if not account_number or not currency:
            continue
        subaccount_balances[f"{account_number}:{currency}"] = {
            "account_number": account_number,
            "account_number_short": _normalize_text(state.get("account_number_short")),
            "account_type": _normalize_text(state.get("account_type")),
            "currency": currency,
            "currency_raw": _normalize_text(state.get("currency_raw")).upper(),
            "starting": _decimal_to_str(state.get("starting"))
            if isinstance(state.get("starting"), Decimal)
            else None,
            "ending": _decimal_to_str(state.get("ending"))
            if isinstance(state.get("ending"), Decimal)
            else None,
        }
    starting_cash_by_currency = (
        _ii_merge_identity._normalize_bochk_currency_balance_map(
            earliest_capture.get("starting_by_currency")
        )
    )
    ending_cash_by_currency = _ii_merge_identity._normalize_bochk_currency_balance_map(
        latest_capture.get("ending_by_currency")
    )
    source_artifacts = [
        capture["source_artifact"]
        for capture in captures
        if isinstance(capture.get("source_artifact"), dict)
    ]
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "boc_hk_statement_pdf_to_investment_json",
            "version": BOCHK_STATEMENT_IMPORTER_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "source_filename": ", ".join(
                filename for _, filename in normalized_payloads
            ),
            "statement_period": ", ".join(periods),
            "statement_count": len(normalized_payloads),
            "transaction_row_count": len(transactions),
            "duplicate_statement_row_count": duplicate_statement_rows,
        },
        "broker": "boc_hk",
        "account": account or None,
        "datetime_policy": {
            "date_field_meaning": (
                "Hong Kong posting date printed on the BOCHK statement PDF; it is not time-zone converted."
            ),
            "datetime_field_meaning": (
                "The source statement has no intraday time; the project convention time is used only for ordering."
            ),
            "timezone": DEFAULT_CONVENTION_TIMEZONE,
            "source_date_timezone": BOCHK_STATEMENT_DATE_TIMEZONE,
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
        "starting_cash_by_currency": starting_cash_by_currency,
        "ending_cash_by_currency": ending_cash_by_currency,
        "starting_cash_base_currency": None,
        "ending_cash_base_currency": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "source_artifacts": source_artifacts,
        "transactions": transactions,
        "bochk_subaccount_balances": subaccount_balances,
    }
    payload["summary"].update(
        {
            "statement_count": len(normalized_payloads),
            "statement_periods": periods,
            "statement_date_min": min(statement_days).isoformat(),
            "statement_date_max": max(statement_days).isoformat(),
            "cash_flow_transaction_source": "boc_hk_statement_pdf",
            "cash_snapshot_source": "boc_hk_statement_balances",
            "historical_statement_backfill": True,
            "starting_cash_by_currency": starting_cash_by_currency,
            "ending_cash_by_currency": ending_cash_by_currency,
            "starting_cash_base_currency": None,
            "ending_cash_base_currency": None,
            "duplicate_statement_row_count": duplicate_statement_rows,
            "bochk_subaccount_balances": subaccount_balances,
            "position_snapshot_authoritative": False,
        }
    )
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload
