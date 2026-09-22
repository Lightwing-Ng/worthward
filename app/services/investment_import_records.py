"""Investment import domain: records.

Code version: v0.1.1
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    DEFAULT_CONVENTION_TIME,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    GRANT_PATTERN,
    HSBC_CASH_ACCOUNT_FILE_KINDS,
    HSBC_CURRENCY_ALIASES,
    IBKR_CASH_EQUIVALENT_MAX_DATE_GAP_DAYS,
    IBKR_CASH_EQUIVALENT_RELATIVE_TOLERANCE,
    IBKR_REALIZED_SUMMARY_NATIVE_CASH_FILE_KIND,
    IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND,
    InvalidOperation,
    ZERO,
    _SECURITY_TRANSFER_FIFO_BASIS_FIELDS,
    _SECURITY_TRANSFER_FIFO_METHOD,
    _SECURITY_TRANSFER_FIFO_METHOD_LABEL,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    _parse_decimal,
    date,
    datetime,
    defaultdict,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bindings as _ii_bindings

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

from app.services import investment_import_compat as _investment_import_compat


def _build_transaction_record(
    row: list[str],
    row_number: int,
    warnings: list[str],
    unknown_types: set[str],
) -> dict[str, Any] | None:
    if len(row) < 2 or row[0] != "Transaction History" or row[1] != "Data":
        return None
    if len(row) < 13:
        warnings.append(
            f"Row {row_number}: Transaction History row has fewer than 13 columns"
        )
        return None

    date_str = _normalize_text(row[2])
    source_account = _normalize_text(row[3])
    description = _ii_basics._normalize_ibkr_description(row[4])
    transaction_type = _normalize_text(row[5])
    symbol = _normalize_text(row[6])
    quantity_dec = _parse_decimal(row[7], "quantity", row_number, warnings)
    price_dec = _parse_decimal(row[8], "price", row_number, warnings)
    price_currency = _normalize_text(row[9])
    gross_amount_dec = _parse_decimal(row[10], "gross_amount", row_number, warnings)
    commission_dec = _parse_decimal(row[11], "commission", row_number, warnings)
    net_amount_dec = _parse_decimal(row[12], "net_amount", row_number, warnings)

    mapped_type = _ii_basics._classify_transaction_type(
        transaction_type, description, unknown_types
    )
    record: dict[str, Any] = {
        "date": date_str,
        "datetime": _ii_basics._build_convention_datetime(date_str),
        "type": mapped_type,
        "currency": _ii_basics._detect_currency(
            transaction_type, price_currency, description, symbol
        ),
        "description": description,
        "source": {
            "file_kind": "transactions",
            "row_number": row_number,
            "transaction_type_raw": transaction_type,
            "account": source_account,
        },
    }

    if symbol and symbol != "-":
        record["ticker"] = normalize_ticker(symbol)
    if quantity_dec is not None:
        record["quantity_raw"] = _decimal_to_str(quantity_dec)
        record["quantity_abs"] = _decimal_to_str(abs(quantity_dec))
    if price_dec is not None:
        record["price_raw"] = _decimal_to_str(price_dec)
    if gross_amount_dec is not None:
        record["gross_amount_raw"] = _decimal_to_str(gross_amount_dec)
    if commission_dec is not None:
        record["commission_raw"] = _decimal_to_str(commission_dec)
        record["commission_abs"] = _decimal_to_str(abs(commission_dec))
    if net_amount_dec is not None:
        record["net_amount_raw"] = _decimal_to_str(net_amount_dec)

    record["normalized"] = _build_normalized_view(
        mapped_type,
        quantity_dec,
        price_dec,
        gross_amount_dec,
        commission_dec,
        net_amount_dec,
    )
    return record


def _build_ibkr_transfer_record(
    row: list[str],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    """Normalize one IBKR Realized Summary security transfer without treating it as cash."""
    if len(row) < 15 or row[0] != "Transfers" or row[1] != "Data":
        return None

    asset_category = _normalize_text(row[2])
    currency = _normalize_text(row[3]).upper() or "USD"
    symbol = normalize_ticker(_normalize_text(row[4]))
    date_text = _normalize_text(row[5])
    transfer_type = _normalize_text(row[6])
    direction = _normalize_text(row[7]).lower()
    transfer_company = _normalize_text(row[8])
    transfer_account = _normalize_text(row[9])
    quantity_dec = _parse_decimal(row[10], "transfer_quantity", row_number, warnings)
    transfer_price_dec = _parse_decimal(row[11], "transfer_price", row_number, warnings)
    market_value_dec = _parse_decimal(
        row[12], "transfer_market_value", row_number, warnings
    )
    realized_pl_dec = _parse_decimal(
        row[13], "transfer_realized_pl", row_number, warnings
    )
    cash_amount_dec = _parse_decimal(
        row[14], "transfer_cash_amount", row_number, warnings
    )

    if asset_category.lower() not in {"stock", "stocks", "equity", "equities"}:
        return None
    if not symbol or not date_text or direction not in {"in", "out"}:
        warnings.append(
            f"Row {row_number}: incomplete IBKR security-transfer details were skipped."
        )
        return None
    if quantity_dec is None or quantity_dec == ZERO:
        warnings.append(
            f"Row {row_number}: IBKR security transfer has no non-zero quantity."
        )
        return None
    if cash_amount_dec is not None and cash_amount_dec != ZERO:
        raise ValueError(
            f"IBKR security transfer row {row_number} for {symbol} has non-zero cash consideration. "
            "Import it with a manual reconciliation instead of treating it as an in-kind transfer."
        )
    if realized_pl_dec is not None and realized_pl_dec != ZERO:
        raise ValueError(
            f"IBKR security transfer row {row_number} for {symbol} has realized P/L. "
            "Import it with a manual reconciliation instead of treating it as an in-kind transfer."
        )

    mapped_type = "transfer_out" if direction == "out" else "transfer_in"
    quantity_abs = abs(quantity_dec)
    description = f"{transfer_type or 'Security'} transfer {direction}: {symbol}"
    record: dict[str, Any] = {
        "date": date_text,
        "datetime": _ii_basics._build_convention_datetime(date_text),
        "type": mapped_type,
        "currency": currency,
        "description": description,
        "ticker": symbol,
        "quantity_raw": _decimal_to_str(quantity_abs),
        "quantity_abs": _decimal_to_str(quantity_abs),
        "gross_amount_raw": "0",
        "commission_raw": "0",
        "net_amount_raw": "0",
        "source": {
            "file_kind": "ibkr_transfers",
            "row_number": row_number,
            "transaction_type_raw": transfer_type,
            "transfer_direction": direction,
            "transfer_company": transfer_company,
            "transfer_account": transfer_account,
            "market_value_raw": _decimal_to_str(market_value_dec),
            "realized_pl_raw": _decimal_to_str(realized_pl_dec),
            "cash_amount_raw": _decimal_to_str(cash_amount_dec),
        },
    }
    if transfer_price_dec is not None and transfer_price_dec > ZERO:
        record["price_raw"] = _decimal_to_str(transfer_price_dec)
    record["normalized"] = _build_normalized_view(
        mapped_type,
        quantity_abs,
        transfer_price_dec,
        ZERO,
        ZERO,
        ZERO,
        is_cash_flow_override=False,
        side_override="sell" if mapped_type == "transfer_out" else "buy",
    )
    return record


def _build_ibkr_realized_summary_cash_record(
    row: list[str],
    row_number: int,
    warnings: list[str],
    *,
    account: str,
    source_filename: str,
    source_sha256: str,
) -> dict[str, Any] | None:
    """Normalize one native-currency IBKR Deposits & Withdrawals row."""
    if len(row) < 6 or row[0] != "Deposits & Withdrawals" or row[1] != "Data":
        return None

    raw_currency = _normalize_text(row[2]).upper()
    if not raw_currency or raw_currency.startswith("TOTAL"):
        return None
    currency = HSBC_CURRENCY_ALIASES.get(raw_currency, raw_currency)
    if currency == "USD":
        # Transaction History already carries the authoritative USD/base-currency
        # cash rows. Keeping both USD representations would double-count them.
        return None
    if not re.fullmatch(r"[A-Z]{3}", currency):
        warnings.append(
            f"Row {row_number}: unsupported IBKR cash currency {raw_currency!r} was skipped."
        )
        return None

    settle_date = _normalize_text(row[3])
    try:
        date.fromisoformat(settle_date)
    except ValueError:
        warnings.append(
            f"Row {row_number}: IBKR native-currency cash row has an invalid settle date."
        )
        return None

    description = _ii_basics._normalize_ibkr_description(row[4])
    amount_dec = _parse_decimal(
        row[5], "realized_summary_cash_amount", row_number, warnings
    )
    if amount_dec is None or amount_dec == ZERO:
        return None

    mapped_type = "deposit" if amount_dec > ZERO else "withdrawal"
    normalized_account = _normalize_text(account)
    record: dict[str, Any] = {
        "date": settle_date,
        "datetime": _ii_basics._build_convention_datetime(settle_date),
        "type": mapped_type,
        "currency": currency,
        "description": description,
        "gross_amount_raw": _decimal_to_str(amount_dec),
        "net_amount_raw": _decimal_to_str(amount_dec),
        "source": {
            "file_kind": IBKR_REALIZED_SUMMARY_NATIVE_CASH_FILE_KIND,
            "source_format": "ibkr_realized_summary_csv",
            "source_section": "Deposits & Withdrawals",
            "row_number": row_number,
            "transaction_type_raw": mapped_type.title(),
            "account": normalized_account,
            "source_filename": _normalize_text(source_filename),
            "source_sha256": _normalize_text(source_sha256),
            "settle_date": settle_date,
            "statement_currency_raw": raw_currency,
        },
        "normalized": _build_normalized_view(
            mapped_type,
            None,
            None,
            amount_dec,
            None,
            amount_dec,
            is_cash_flow_override=True,
        ),
    }
    return record


def _is_ibkr_realized_summary_native_cash_record(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _normalize_text(source.get("file_kind"))
        == IBKR_REALIZED_SUMMARY_NATIVE_CASH_FILE_KIND
        and _ii_basics._normalize_broker_code(record.get("broker")) == "ibkr"
        and _normalize_text(record.get("currency")).upper() not in {"", "USD"}
        and _normalize_text(record.get("type")).lower() in {"deposit", "withdrawal"}
    )


def _is_ibkr_transaction_history_base_cash_record(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _normalize_text(source.get("file_kind"))
        == IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND
        and _ii_basics._normalize_broker_code(record.get("broker")) == "ibkr"
        and not _normalize_text(record.get("currency"))
        and not _normalize_text(record.get("ticker"))
        and _normalize_text(record.get("type")).lower() in {"deposit", "withdrawal"}
    )


def _ibkr_cash_record_amount(record: dict[str, Any]) -> Decimal | None:
    for field_name in ("net_amount_raw", "gross_amount_raw"):
        raw_value = record.get(field_name)
        if raw_value is None:
            continue
        try:
            return Decimal(str(raw_value).replace(",", ""))
        except (InvalidOperation, TypeError, ValueError):
            continue
    return None


def _ibkr_cash_record_date(record: dict[str, Any]) -> date | None:
    try:
        return date.fromisoformat(_normalize_text(record.get("date"))[:10])
    except ValueError:
        return None


def _ibkr_cash_record_description_group_key(record: dict[str, Any]) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = "ibkr"
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    return (
        _normalize_text(record.get("type")).lower(),
        _normalize_whitespace(record.get("description")).casefold(),
        _ii_basics._account_identity_token(broker, account),
    )


def _ibkr_cash_record_pair_candidates(
    native_records: list[dict[str, Any]],
    base_records: list[dict[str, Any]],
) -> list[tuple[int, int, Decimal, int]]:
    candidates: list[tuple[int, int, Decimal, int]] = []
    for native_index, native in enumerate(native_records):
        native_amount = _ibkr_cash_record_amount(native)
        native_date = _ibkr_cash_record_date(native)
        if native_amount is None or native_amount == ZERO or native_date is None:
            continue
        native_account = _normalize_text(native.get("account"))
        for base_index, base in enumerate(base_records):
            base_amount = _ibkr_cash_record_amount(base)
            base_date = _ibkr_cash_record_date(base)
            if base_amount is None or base_amount == ZERO or base_date is None:
                continue
            if (
                _normalize_text(base.get("type")).lower()
                != _normalize_text(native.get("type")).lower()
            ):
                continue
            if (
                _normalize_whitespace(base.get("description")).casefold()
                != _normalize_whitespace(native.get("description")).casefold()
            ):
                continue
            base_account = _normalize_text(base.get("account"))
            if not _ii_basics._accounts_are_compatible(
                "ibkr", native_account, base_account
            ):
                continue
            if (native_amount > ZERO) != (base_amount > ZERO):
                continue
            date_gap = abs((native_date - base_date).days)
            if date_gap > IBKR_CASH_EQUIVALENT_MAX_DATE_GAP_DAYS:
                continue
            candidates.append(
                (
                    native_index,
                    base_index,
                    abs(native_amount) / abs(base_amount),
                    date_gap,
                )
            )
    return candidates


def _select_ibkr_cash_equivalent_pairs(
    candidates: list[tuple[int, int, Decimal, int]],
) -> list[tuple[int, int]]:
    """Select the largest one-to-one exchange-rate-consistent match set."""
    if not candidates:
        return []

    best_score: tuple[int, int, Decimal] | None = None
    best_pairs: list[tuple[int, int]] = []
    for center in candidates:
        center_ratio = center[2]
        allowed = [
            candidate
            for candidate in candidates
            if abs(candidate[2] - center_ratio) / center_ratio
            <= IBKR_CASH_EQUIVALENT_RELATIVE_TOLERANCE
        ]
        used_native: set[int] = set()
        used_base: set[int] = set()
        pairs: list[tuple[int, int]] = []
        for native_index, base_index, ratio, date_gap in sorted(
            allowed,
            key=lambda candidate: (
                candidate[3],
                abs(candidate[2] - center_ratio) / center_ratio,
                candidate[0],
                candidate[1],
            ),
        ):
            if native_index in used_native or base_index in used_base:
                continue
            used_native.add(native_index)
            used_base.add(base_index)
            pairs.append((native_index, base_index))
        score = (len(pairs), len(allowed), center_ratio)
        if (
            best_score is None
            or score[:2] > best_score[:2]
            or (score[:2] == best_score[:2] and score[2] < best_score[2])
        ):
            best_score = score
            best_pairs = pairs
    return best_pairs


def _match_ibkr_realized_summary_cash_records(
    native_records: list[dict[str, Any]],
    base_records: list[dict[str, Any]],
) -> tuple[
    list[tuple[dict[str, Any], dict[str, Any]]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Match native cash to base-currency rows without inferring currency conversions."""
    grouped_native: defaultdict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    grouped_base: defaultdict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for record in native_records:
        grouped_native[
            (
                _normalize_text(record.get("currency")).upper(),
                *_ibkr_cash_record_description_group_key(record),
            )
        ].append(record)
    for record in base_records:
        grouped_base[_ibkr_cash_record_description_group_key(record)].append(record)

    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    native_without_candidates: list[dict[str, Any]] = []
    native_ambiguous: list[dict[str, Any]] = []
    used_base_ids: set[int] = set()
    for group_key, native_group in sorted(
        grouped_native.items(),
        key=lambda item: (-len(item[1]), item[0]),
    ):
        base_group = [
            record
            for record in grouped_base.get(group_key[1:], [])
            if id(record) not in used_base_ids
        ]
        candidates = _ibkr_cash_record_pair_candidates(native_group, base_group)
        if not candidates:
            native_without_candidates.extend(native_group)
            continue
        selected_pairs = _select_ibkr_cash_equivalent_pairs(candidates)
        selected_native_indices = {native_index for native_index, _ in selected_pairs}
        candidate_native_indices = {native_index for native_index, *_ in candidates}
        for native_index, base_index in selected_pairs:
            pairs.append((native_group[native_index], base_group[base_index]))
            used_base_ids.add(id(base_group[base_index]))
        for native_index in range(len(native_group)):
            if native_index not in candidate_native_indices:
                native_without_candidates.append(native_group[native_index])
        for native_index in sorted(candidate_native_indices - selected_native_indices):
            native_ambiguous.append(native_group[native_index])
    return pairs, native_without_candidates, native_ambiguous


def _replace_ibkr_transaction_history_cash_with_native_summary(
    transactions: list[dict[str, Any]],
    native_records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int, int]:
    """Replace matched base-currency cash rows and fail closed on ambiguous matches."""
    base_records = [
        record
        for record in transactions
        if _is_ibkr_transaction_history_base_cash_record(record)
    ]
    pairs, native_without_candidates, native_ambiguous = (
        _match_ibkr_realized_summary_cash_records(native_records, base_records)
    )
    paired_base_ids = {id(base_record) for _, base_record in pairs}
    paired_native_ids = {id(native_record) for native_record, _ in pairs}
    retained_transactions = [
        record for record in transactions if id(record) not in paired_base_ids
    ]
    materialized_native_records = [
        record
        for record in native_records
        if id(record) in paired_native_ids
        or id(record) in {id(item) for item in native_without_candidates}
    ]
    for native_record, base_record in pairs:
        source = native_record.get("source")
        if not isinstance(source, dict):
            source = {}
            native_record["source"] = source
        source["replaces_transaction_history_row_number"] = (
            base_record.get("source", {}).get("row_number")
            if isinstance(base_record.get("source"), dict)
            else None
        )
        source["replaced_base_amount_raw"] = _normalize_text(
            base_record.get("net_amount_raw")
        )
        source["replaced_base_date"] = base_record.get("date")
        source["replaced_base_source"] = dict(base_record.get("source") or {})
    retained_transactions.extend(materialized_native_records)
    return (
        retained_transactions,
        len(pairs),
        len(native_without_candidates),
        len(native_ambiguous),
    )


def _remove_ibkr_base_cash_records_superseded_by_native_summary(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Remove stale Transaction History cash rows after a native summary import."""
    native_records = [
        record
        for record in [*existing_transactions, *incoming_transactions]
        if _is_ibkr_realized_summary_native_cash_record(record)
    ]
    base_records = [
        record
        for record in [*existing_transactions, *incoming_transactions]
        if _is_ibkr_transaction_history_base_cash_record(record)
    ]
    pairs, _, _ = _match_ibkr_realized_summary_cash_records(
        native_records, base_records
    )
    paired_base_ids = {id(base_record) for _, base_record in pairs}
    return (
        [
            record
            for record in existing_transactions
            if id(record) not in paired_base_ids
        ],
        [
            record
            for record in incoming_transactions
            if id(record) not in paired_base_ids
        ],
        len(pairs),
    )


def _build_grant_candidate(
    row: list[str],
    row_number: int,
    warnings: list[str],
) -> dict[str, Any] | None:
    if len(row) < 15:
        return None
    if row[0] != "Open Positions" or row[1] != "Data" or row[2] != "Lot":
        return None

    open_field = _normalize_text(row[6])
    match = GRANT_PATTERN.match(open_field)
    if not match:
        return None

    symbol = _normalize_text(row[5])
    currency = _normalize_text(row[4]) or "USD"
    quantity_dec = _parse_decimal(row[7], "grant_quantity", row_number, warnings)
    price_dec = _parse_decimal(row[9], "grant_cost_price", row_number, warnings)
    if not symbol or quantity_dec is None or price_dec is None:
        warnings.append(
            f"Row {row_number}: unable to parse stock grant lot from Open Positions"
        )
        return None

    grant_date = match.group("grant_date")
    vesting_date = match.group("vesting_date")
    return {
        "grant_date": grant_date,
        "vesting_date": vesting_date,
        "currency": currency,
        "ticker": normalize_ticker(symbol),
        "price_raw": _decimal_to_str(price_dec),
        "source": {
            "file_kind": "positions",
            "row_number": row_number,
            "transaction_type_raw": "Stock Grant",
        },
        "lot_quantity_raw": _decimal_to_str(quantity_dec),
    }


def _build_grant_record_from_candidate(
    candidate: dict[str, Any],
    quantity_dec: Decimal,
) -> dict[str, Any]:
    price_dec = Decimal(str(candidate["price_raw"]))
    grant_date = str(candidate["grant_date"])
    vesting_date = str(candidate["vesting_date"])
    symbol = str(candidate["ticker"])
    return {
        "date": grant_date,
        "datetime": _ii_basics._build_convention_datetime(grant_date),
        "type": "grant",
        "currency": candidate["currency"],
        "description": f"Unvested shares from stock grant: {symbol}",
        "ticker": symbol,
        "quantity_raw": _decimal_to_str(quantity_dec),
        "quantity_abs": _decimal_to_str(abs(quantity_dec)),
        "price_raw": _decimal_to_str(price_dec),
        "gross_amount_raw": "0",
        "net_amount_raw": "0",
        "vesting_date": _ii_basics._build_convention_datetime(vesting_date),
        "source": candidate["source"],
        "normalized": _build_normalized_view(
            "grant",
            quantity_dec,
            price_dec,
            ZERO,
            None,
            ZERO,
            is_cash_flow_override=False,
            side_override="buy",
        ),
    }


def _synthesize_grant_records(
    grant_candidates: list[dict[str, Any]],
    transactions: list[dict[str, Any]],
    open_position_snapshots: dict[str, dict[str, str]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    if not grant_candidates:
        return []

    replayed_without_grants = _replay_holdings(transactions)
    candidates_by_ticker: dict[str, list[dict[str, Any]]] = {}
    for candidate in grant_candidates:
        ticker = str(candidate.get("ticker") or "").strip()
        if not ticker:
            continue
        candidates_by_ticker.setdefault(ticker, []).append(candidate)

    grants: list[dict[str, Any]] = []
    for ticker, ticker_candidates in candidates_by_ticker.items():
        snapshot = open_position_snapshots.get(ticker)
        snapshot_quantity = Decimal(snapshot["quantity"]) if snapshot else ZERO
        known_quantity = replayed_without_grants.get(ticker, ZERO)
        remaining_quantity = snapshot_quantity - known_quantity
        if remaining_quantity <= ZERO:
            warnings.append(
                f"Ticker {ticker}: skipped stock grant synthesis because the inferred missing quantity is {remaining_quantity}."
            )
            continue

        ordered_candidates = sorted(
            ticker_candidates,
            key=lambda item: (
                str(item.get("grant_date") or ""),
                int(item.get("source", {}).get("row_number", 0)),
            ),
        )
        for index, candidate in enumerate(ordered_candidates):
            if remaining_quantity <= ZERO:
                break
            lot_quantity = Decimal(str(candidate.get("lot_quantity_raw") or "0"))
            if index == len(ordered_candidates) - 1:
                grant_quantity = remaining_quantity
            else:
                grant_quantity = min(lot_quantity, remaining_quantity)
            if grant_quantity <= ZERO:
                continue
            if grant_quantity != lot_quantity:
                warnings.append(
                    f"Ticker {ticker}: inferred stock grant quantity {grant_quantity} differs from open lot quantity {lot_quantity}."
                )
            grants.append(_build_grant_record_from_candidate(candidate, grant_quantity))
            remaining_quantity -= grant_quantity

    return grants


def _extract_summary_fields(
    rows: list[list[str]],
    warnings: list[str],
) -> tuple[dict[str, Decimal | None], str | None]:
    result: dict[str, Decimal | None] = {
        "starting_cash": None,
        "ending_cash": None,
    }
    account: str | None = None

    for row_number, row in enumerate(rows, start=1):
        if len(row) >= 4 and row[0] == "Summary" and row[1] == "Data":
            field_name = _normalize_text(row[2])
            if field_name == "Starting Cash":
                result["starting_cash"] = _parse_decimal(
                    row[3], "Starting Cash", row_number, warnings
                )
            elif field_name == "Ending Cash":
                result["ending_cash"] = _parse_decimal(
                    row[3], "Ending Cash", row_number, warnings
                )
        if len(row) >= 4 and row[0] == "Transaction History" and row[1] == "Data":
            account = _normalize_text(row[3]) or account
            break

    return result, account


def _ibkr_cash_snapshot_dates(
    transactions: list[dict[str, Any]],
    *,
    period_start: str,
    period_end: str,
) -> dict[str, str]:
    """Return auditable reported and replay dates for an IBKR cash snapshot."""
    transaction_dates: list[str] = []
    for transaction in transactions:
        raw_date = _normalize_text(transaction.get("date"))
        try:
            date.fromisoformat(raw_date)
        except ValueError:
            continue
        transaction_dates.append(raw_date)

    reported_as_of = _normalize_text(period_end)
    if not reported_as_of and transaction_dates:
        reported_as_of = max(transaction_dates)
    replay_candidates = [
        transaction_date
        for transaction_date in transaction_dates
        if not reported_as_of or transaction_date <= reported_as_of
    ]
    replay_as_of = max(replay_candidates, default=reported_as_of)
    metadata: dict[str, str] = {}
    if _normalize_text(period_start):
        metadata["starting_cash_as_of"] = _normalize_text(period_start)
    if reported_as_of:
        metadata["ending_cash_as_of"] = reported_as_of
    if replay_as_of:
        metadata["ending_cash_replay_as_of"] = replay_as_of
    return metadata


def _ibkr_latest_intraday_transaction_datetime(
    transactions: list[dict[str, Any]],
    *,
    as_of_date: str,
) -> str:
    """Return the latest GainsKeeper transaction boundary within the report."""
    candidates: list[str] = []
    for transaction in transactions:
        source = transaction.get("source")
        if not isinstance(source, dict):
            continue
        if _normalize_text(source.get("file_kind")) not in {
            "gainskeeper",
            "ibkr_transfers",
        }:
            continue
        normalized = _ii_payload_summaries._normalize_ibkr_cash_snapshot_datetime(
            transaction.get("datetime")
        )
        if not normalized:
            continue
        if as_of_date and normalized[:10] > as_of_date:
            continue
        candidates.append(normalized)
    return max(candidates, default="")


def _extract_open_position_summaries(
    rows: list[list[str]],
    warnings: list[str],
) -> dict[str, dict[str, str]]:
    snapshots: dict[str, dict[str, str]] = {}
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 15:
            continue
        if row[0] != "Open Positions" or row[1] != "Data" or row[2] != "Summary":
            continue
        symbol = normalize_ticker(_normalize_text(row[5]))
        if not symbol:
            continue
        snapshots[symbol] = {
            "asset_category": _normalize_text(row[3]),
            "currency": _normalize_text(row[4]) or "USD",
            "quantity": _decimal_to_str(
                _parse_decimal(row[7], "open_quantity", row_number, warnings)
            )
            or "0",
            "cost_price": _decimal_to_str(
                _parse_decimal(row[9], "cost_price", row_number, warnings)
            )
            or "0",
            "cost_basis": _decimal_to_str(
                _parse_decimal(row[10], "cost_basis", row_number, warnings)
            )
            or "0",
            "close_price": _decimal_to_str(
                _parse_decimal(row[11], "close_price", row_number, warnings)
            )
            or "0",
            "value": _decimal_to_str(
                _parse_decimal(row[12], "value", row_number, warnings)
            )
            or "0",
            "unrealized_pl": _decimal_to_str(
                _parse_decimal(row[13], "unrealized_pl", row_number, warnings)
            )
            or "0",
        }
    return snapshots


def _extract_performance_summaries(
    rows: list[list[str]],
    warnings: list[str],
) -> dict[str, dict[str, str]]:
    snapshots: dict[str, dict[str, str]] = {}
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 17:
            continue
        if row[0] != "Realized & Unrealized Performance Summary" or row[1] != "Data":
            continue
        asset_category = _normalize_text(row[2])
        symbol = normalize_ticker(_normalize_text(row[3]))
        if not symbol or asset_category.startswith("Total"):
            continue
        snapshots[symbol] = {
            "asset_category": asset_category,
            "realized_total": _decimal_to_str(
                _parse_decimal(row[9], "realized_total", row_number, warnings)
            )
            or "0",
            "unrealized_total": _decimal_to_str(
                _parse_decimal(row[14], "unrealized_total", row_number, warnings)
            )
            or "0",
            "total": _decimal_to_str(
                _parse_decimal(row[15], "total", row_number, warnings)
            )
            or "0",
            "code": _normalize_text(row[16]),
        }
    return snapshots


def _extract_ibkr_closed_trade_details(
    rows: list[list[str]],
    warnings: list[str],
) -> list[dict[str, str]]:
    """Extract authoritative closed-trade accounting fields from IBKR Realized Summary rows."""
    details: list[dict[str, str]] = []
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 14 or row[0] != "Trades" or row[1] != "Data":
            continue
        if _normalize_text(row[2]).lower() != "order":
            continue
        quantity = _parse_decimal(row[7], "closed_trade_quantity", row_number, warnings)
        realized_pnl = _parse_decimal(
            row[12], "closed_trade_realized_pnl", row_number, warnings
        )
        if quantity is None or quantity >= ZERO or realized_pnl is None:
            continue
        ticker = normalize_ticker(_normalize_text(row[5]))
        trade_datetime = _normalize_text(row[6])
        trade_date = trade_datetime.split(",", 1)[0].strip()
        if not ticker or not trade_date:
            continue
        details.append(
            {
                "ticker": ticker,
                "currency": _normalize_text(row[4]).upper() or "USD",
                "trade_datetime": trade_datetime,
                "trade_date": trade_date,
                "quantity": _decimal_to_str(abs(quantity)) or "0",
                "price": _decimal_to_str(
                    _parse_decimal(row[8], "closed_trade_price", row_number, warnings)
                )
                or "0",
                "proceeds": _decimal_to_str(
                    _parse_decimal(
                        row[9], "closed_trade_proceeds", row_number, warnings
                    )
                )
                or "0",
                "commission_or_fee": _decimal_to_str(
                    _parse_decimal(
                        row[10], "closed_trade_commission", row_number, warnings
                    )
                )
                or "0",
                "basis": _decimal_to_str(
                    _parse_decimal(row[11], "closed_trade_basis", row_number, warnings)
                )
                or "0",
                "realized_pnl": _decimal_to_str(realized_pnl) or "0",
                "closed_lot_id": f"ibkr-realized-summary-row-{row_number}",
                "row_number": str(row_number),
            }
        )
    return details


def _extract_ibkr_forex_pnl_details(
    rows: list[list[str]],
    warnings: list[str],
) -> list[dict[str, str]]:
    """Extract dated realized FX components from IBKR Forex P/L Details rows."""
    details: list[dict[str, str]] = []
    description_pattern = re.compile(
        r"^Forex\s+(?P<base_quantity>[+-]?[\d,]+(?:\.\d+)?)\s+"
        r"(?P<pair>[A-Z]{3}\.[A-Z]{3})$",
        re.IGNORECASE,
    )
    for row_number, row in enumerate(rows, start=1):
        if len(row) < 12 or row[0] != "Forex P/L Details" or row[1] != "Data":
            continue
        if _normalize_text(row[2]).upper().startswith("TOTAL"):
            continue
        realized_pnl = _parse_decimal(
            row[10],
            "forex_realized_pnl",
            row_number,
            warnings,
        )
        if realized_pnl in {None, ZERO}:
            continue
        description = _normalize_text(row[4])
        description_match = description_pattern.fullmatch(description)
        trade_datetime = _normalize_text(row[5])
        pnl_ticker = normalize_ticker(_normalize_text(row[6]))
        if description_match is None or not trade_datetime or not pnl_ticker:
            warnings.append(
                f"Row {row_number}: incomplete IBKR Forex P/L detail was retained "
                "only in the source artifact."
            )
            continue
        trade_date = trade_datetime.split(",", 1)[0].strip()
        try:
            date.fromisoformat(trade_date)
        except ValueError:
            warnings.append(
                f"Row {row_number}: IBKR Forex P/L detail has an invalid trade date."
            )
            continue
        base_quantity = _parse_decimal(
            description_match.group("base_quantity"),
            "forex_base_quantity",
            row_number,
            warnings,
        )
        if base_quantity is None or base_quantity == ZERO:
            continue
        details.append(
            {
                "pair": normalize_ticker(description_match.group("pair")),
                "pnl_ticker": pnl_ticker,
                "pnl_currency": _normalize_text(row[3]).upper() or "USD",
                "trade_datetime": trade_datetime,
                "trade_date": trade_date,
                "base_quantity": _decimal_to_str(abs(base_quantity)) or "0",
                "quantity": _decimal_to_str(
                    _parse_decimal(row[7], "forex_pnl_quantity", row_number, warnings)
                )
                or "0",
                "proceeds": _decimal_to_str(
                    _parse_decimal(row[8], "forex_pnl_proceeds", row_number, warnings)
                )
                or "0",
                "basis": _decimal_to_str(
                    _parse_decimal(row[9], "forex_pnl_basis", row_number, warnings)
                )
                or "0",
                "realized_pnl": _decimal_to_str(realized_pnl) or "0",
                "code": _normalize_text(row[11]),
                "row_number": str(row_number),
            }
        )
    return details


def _attach_ibkr_forex_pnl_details(
    transactions: list[dict[str, Any]],
    forex_pnl_details: list[dict[str, str]],
    warnings: list[str],
) -> None:
    """Attach each broker-reported FX result to one exact Transaction History fill."""
    used_transaction_indexes: set[int] = set()
    for detail in forex_pnl_details:
        candidate_indexes: list[int] = []
        for index, record in enumerate(transactions):
            if index in used_transaction_indexes:
                continue
            if _normalize_text(record.get("type")).lower() != "forex_trade_component":
                continue
            if (
                normalize_ticker(_normalize_text(record.get("ticker")))
                != detail["pair"]
            ):
                continue
            if not _ii_merge_identity._decimal_identity_abs_values_match(
                record.get("quantity_abs") or record.get("quantity_raw"),
                detail["base_quantity"],
            ):
                continue
            try:
                record_day = date.fromisoformat(_normalize_text(record.get("date")))
                detail_day = date.fromisoformat(detail["trade_date"])
            except ValueError:
                continue
            if (record_day - detail_day).days not in {0, 1}:
                continue
            candidate_indexes.append(index)
        if len(candidate_indexes) != 1:
            warnings.append(
                "An IBKR Forex P/L detail could not be matched uniquely to its "
                "Transaction History fill; overlapping performance reports will "
                "remain fail-closed."
            )
            continue

        matched_index = candidate_indexes[0]
        used_transaction_indexes.add(matched_index)
        record = transactions[matched_index]
        record["broker_realized_pnl_raw"] = detail["realized_pnl"]
        normalized = (
            record.get("normalized")
            if isinstance(record.get("normalized"), dict)
            else {}
        )
        normalized = dict(normalized)
        normalized["broker_realized_pnl"] = detail["realized_pnl"]
        record["normalized"] = normalized
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        source = dict(source)
        source.update(
            {
                "broker_realized_pnl_source": "ibkr_forex_pnl_details",
                "broker_realized_pnl_ticker": detail["pnl_ticker"],
                "broker_realized_pnl_currency": detail["pnl_currency"],
                "broker_realized_pnl_datetime": detail["trade_datetime"],
                "broker_realized_pnl_date": detail["trade_date"],
                "broker_realized_pnl_row_number": detail["row_number"],
                "broker_forex_pnl_quantity_raw": detail["quantity"],
                "broker_forex_pnl_proceeds_raw": detail["proceeds"],
                "broker_forex_pnl_basis_raw": detail["basis"],
                "broker_forex_pnl_code": detail["code"],
            }
        )
        record["source"] = source


def _attach_ibkr_closed_trade_details(
    transactions: list[dict[str, Any]],
    closed_trade_details: list[dict[str, str]],
) -> None:
    """Attach each broker-reported closed lot to the matching normalized sell record."""
    used_transaction_indexes: set[int] = set()
    for detail in closed_trade_details:
        matched_index: int | None = None
        for index, record in enumerate(transactions):
            if index in used_transaction_indexes:
                continue
            if _normalize_text(record.get("type")).lower() != "sell":
                continue
            if (
                normalize_ticker(_normalize_text(record.get("ticker")))
                != detail["ticker"]
            ):
                continue
            if _normalize_text(record.get("date")) != detail["trade_date"]:
                continue
            if not _ii_merge_identity._decimal_identity_abs_values_match(
                record.get("quantity_abs") or record.get("quantity_raw"),
                detail["quantity"],
            ):
                continue
            if not _ii_merge_identity._decimal_identity_values_match(
                record.get("price_raw"), detail["price"]
            ):
                continue
            matched_index = index
            break
        if matched_index is None:
            continue

        used_transaction_indexes.add(matched_index)
        record = transactions[matched_index]
        record["broker_proceeds_raw"] = detail["proceeds"]
        record["broker_commission_or_fee_raw"] = detail["commission_or_fee"]
        record["broker_cost_basis_raw"] = detail["basis"]
        record["broker_realized_pnl_raw"] = detail["realized_pnl"]
        normalized = (
            record.get("normalized")
            if isinstance(record.get("normalized"), dict)
            else {}
        )
        normalized = dict(normalized)
        normalized["broker_proceeds"] = detail["proceeds"]
        normalized["broker_commission_or_fee"] = detail["commission_or_fee"]
        normalized["broker_cost_basis"] = detail["basis"]
        normalized["broker_realized_pnl"] = detail["realized_pnl"]
        record["normalized"] = normalized
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        source = dict(source)
        source["closed_lot_id"] = detail["closed_lot_id"]
        source["closed_lot_row_number"] = detail["row_number"]
        source["closed_lot_trade_datetime"] = detail["trade_datetime"]
        record["source"] = source


def _prefer_ibkr_closed_trade_realized_totals(
    performance_snapshots: dict[str, dict[str, str]],
    closed_trade_details: list[dict[str, str]],
    *,
    transactions: list[dict[str, Any]] | None = None,
) -> None:
    """Prefer exact closed-trade sums over the lower-precision performance summary field."""
    totals: dict[str, Decimal] = {}
    currencies: dict[str, set[str]] = {}
    detail_counts: dict[str, int] = {}
    for detail in closed_trade_details:
        ticker = detail["ticker"]
        totals[ticker] = totals.get(ticker, ZERO) + Decimal(detail["realized_pnl"])
        currencies.setdefault(ticker, set()).add(detail["currency"])
        detail_counts[ticker] = detail_counts.get(ticker, 0) + 1
    transaction_counts: dict[str, int] = {}
    if transactions:
        for transaction in transactions:
            if (
                _ii_basics._normalize_broker_code(transaction.get("broker")) != "ibkr"
                or _normalize_text(transaction.get("type")).lower() != "sell"
            ):
                continue
            ticker = normalize_ticker(_normalize_text(transaction.get("ticker")))
            if ticker:
                transaction_counts[ticker] = transaction_counts.get(ticker, 0) + 1
    for ticker, realized_total in totals.items():
        snapshot = performance_snapshots.setdefault(
            ticker, {"asset_category": "Stocks"}
        )
        if transaction_counts.get(ticker, 0) > detail_counts.get(ticker, 0):
            # The report contains more closed sells than the detail rows we can
            # match. Its aggregate is therefore the complete source of truth.
            continue
        snapshot["realized_total"] = _decimal_to_str(realized_total) or "0"
        snapshot["realized_total_source"] = "ibkr_closed_trades"
        if len(currencies.get(ticker, set())) == 1:
            snapshot["currency"] = next(iter(currencies[ticker]))


def _extract_ibkr_closed_trade_details_from_transactions(
    transactions: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Read exact IBKR closed-trade P&L already retained on normalized sells."""
    details: list[dict[str, str]] = []
    for record in transactions:
        if _ii_basics._normalize_broker_code(record.get("broker")) != "ibkr":
            continue
        if _normalize_text(record.get("type")).lower() != "sell":
            continue
        raw_realized_pnl = (
            record.get("broker_realized_pnl_raw")
            or record.get("broker_realized_pnl")
            or (
                record.get("normalized", {}).get("broker_realized_pnl")
                if isinstance(record.get("normalized"), dict)
                else None
            )
        )
        realized_pnl = _ii_hsbc_cash._parse_decimal_text_or_none(raw_realized_pnl)
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        if realized_pnl is None or not ticker:
            continue
        details.append(
            {
                "ticker": ticker,
                "currency": _normalize_text(record.get("currency")).upper() or "USD",
                "realized_pnl": _decimal_to_str(realized_pnl) or "0",
            }
        )
    return details


def _transaction_quantity_for_replay(record: dict[str, Any]) -> Decimal | None:
    if "quantity_abs" in record:
        quantity_abs = Decimal(str(record["quantity_abs"]))
        if record.get("type") == "sell":
            return quantity_abs
    if "quantity_raw" in record:
        return Decimal(str(record["quantity_raw"]))
    normalized_quantity = record.get("normalized", {}).get("display_quantity")
    if normalized_quantity is None:
        return None
    return Decimal(str(normalized_quantity))


def _is_positions_grant_record(record: dict[str, Any]) -> bool:
    if _normalize_text(record.get("type")).lower() != "grant":
        return False
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _normalize_text(source.get("file_kind")) == "positions"


def _set_transaction_quantity(
    record: dict[str, Any], quantity_dec: Decimal
) -> dict[str, Any]:
    updated = dict(record)
    quantity_text = _decimal_to_str(quantity_dec) or "0"
    updated["quantity_raw"] = quantity_text
    updated["quantity_abs"] = _decimal_to_str(abs(quantity_dec)) or "0"
    normalized = dict(
        updated.get("normalized") if isinstance(updated.get("normalized"), dict) else {}
    )
    normalized["position_quantity"] = quantity_text
    normalized["display_quantity"] = _decimal_to_str(abs(quantity_dec)) or "0"
    updated["normalized"] = normalized
    return updated


def _reconcile_positions_grants_to_snapshot(
    transactions: list[dict[str, Any]],
    open_position_snapshots: dict[str, dict[str, str]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    if not transactions or not open_position_snapshots:
        return transactions

    position_grants_by_ticker: dict[str, list[dict[str, Any]]] = {}
    for record in transactions:
        if not _is_positions_grant_record(record):
            continue
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        if ticker:
            position_grants_by_ticker.setdefault(ticker, []).append(record)
    if not position_grants_by_ticker:
        return transactions

    non_position_grant_transactions = [
        record for record in transactions if not _is_positions_grant_record(record)
    ]
    replayed_without_position_grants = _replay_holdings(non_position_grant_transactions)
    replacement_by_identity: dict[int, dict[str, Any] | None] = {}

    for ticker, grant_records in position_grants_by_ticker.items():
        snapshot = open_position_snapshots.get(ticker)
        if not snapshot:
            continue
        snapshot_quantity = Decimal(snapshot["quantity"])
        known_quantity = replayed_without_position_grants.get(ticker, ZERO)
        target_grant_quantity = snapshot_quantity - known_quantity
        if target_grant_quantity < ZERO:
            warnings.append(
                f"Ticker {ticker}: skipped stock grant reconciliation because recorded non-grant quantity {known_quantity} exceeds Open Positions quantity {snapshot_quantity}."
            )
            continue

        remaining_quantity = target_grant_quantity
        ordered_grants = sorted(
            grant_records,
            key=lambda item: (
                _normalize_text(item.get("date")),
                _normalize_text(item.get("vesting_date")),
                int(
                    (
                        item.get("source")
                        if isinstance(item.get("source"), dict)
                        else {}
                    ).get("row_number", 0)
                ),
            ),
        )
        for index, grant in enumerate(ordered_grants):
            current_quantity = _transaction_quantity_for_replay(grant) or ZERO
            if index == len(ordered_grants) - 1:
                next_quantity = remaining_quantity
            else:
                next_quantity = min(current_quantity, remaining_quantity)
            remaining_quantity -= next_quantity
            if next_quantity <= ZERO:
                replacement_by_identity[id(grant)] = None
                continue
            if next_quantity != current_quantity:
                warnings.append(
                    f"Ticker {ticker}: reconciled stock grant quantity from {current_quantity} to {next_quantity} using Open Positions and imported trades."
                )
            replacement_by_identity[id(grant)] = _set_transaction_quantity(
                grant, next_quantity
            )

    if not replacement_by_identity:
        return transactions

    reconciled: list[dict[str, Any]] = []
    for record in transactions:
        replacement = replacement_by_identity.get(id(record), record)
        if replacement is None:
            continue
        reconciled.append(replacement)
    return reconciled


def _replay_holdings(transactions: list[dict[str, Any]]) -> dict[str, Decimal]:
    holdings: dict[str, Decimal] = {}
    for record in transactions:
        ticker = _normalize_text(record.get("ticker"))
        if not ticker:
            continue
        normalized_type = _normalize_text(record.get("type")).lower()
        if normalized_type not in {
            "buy",
            "sell",
            "dividend_reinvestment",
            "grant",
            "transfer_in",
            "transfer_out",
        }:
            continue
        quantity_dec = _transaction_quantity_for_replay(record)
        if quantity_dec is None:
            continue
        holdings.setdefault(ticker, ZERO)
        if normalized_type in {"buy", "dividend_reinvestment", "grant", "transfer_in"}:
            holdings[ticker] += quantity_dec
        elif normalized_type in {"sell", "transfer_out"}:
            holdings[ticker] -= abs(quantity_dec)
        if holdings[ticker] == ZERO:
            holdings.pop(ticker, None)
    return holdings


def _validate_holdings(
    transactions: list[dict[str, Any]],
    open_position_snapshots: dict[str, dict[str, str]],
) -> list[dict[str, str]]:
    replayed = _replay_holdings(transactions)
    mismatches: list[dict[str, str]] = []
    for symbol in sorted(set(replayed) | set(open_position_snapshots)):
        replayed_quantity = replayed.get(symbol, ZERO)
        snapshot = open_position_snapshots.get(symbol)
        snapshot_quantity = Decimal(snapshot["quantity"]) if snapshot else ZERO
        if replayed_quantity != snapshot_quantity:
            mismatches.append(
                {
                    "ticker": symbol,
                    "replayed_quantity": _decimal_to_str(replayed_quantity) or "0",
                    "open_positions_quantity": _decimal_to_str(snapshot_quantity)
                    or "0",
                }
            )
    return mismatches


def _security_transfer_reconciliation_leg(
    record: dict[str, Any],
) -> dict[str, Any] | None:
    """Return the evidence fields needed to reconcile one in-kind transfer leg."""
    transaction_type = _normalize_text(record.get("type")).replace(" ", "_").lower()
    if transaction_type not in {"transfer_in", "transfer_out"}:
        return None
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    ticker = normalize_ticker(_normalize_text(record.get("ticker")))
    date_text = _normalize_text(record.get("date"))[:10]
    quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
        record.get("quantity_abs") or record.get("quantity_raw")
    )
    if (
        not broker
        or not ticker
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_text)
        or quantity is None
        or quantity <= ZERO
    ):
        return None
    return {
        "record": record,
        "type": transaction_type,
        "broker": broker,
        "account": account,
        "date": date_text,
        "ticker": ticker,
        "quantity": abs(quantity),
        "currency": _normalize_text(record.get("currency")).upper(),
    }


def _security_transfer_legs_match(
    outbound: dict[str, Any],
    inbound: dict[str, Any],
) -> bool:
    """Match only exact, same-day cross-broker security-transfer evidence."""
    outbound_currency = _normalize_text(outbound.get("currency"))
    inbound_currency = _normalize_text(inbound.get("currency"))
    return (
        outbound.get("broker") != inbound.get("broker")
        and outbound.get("date") == inbound.get("date")
        and outbound.get("ticker") == inbound.get("ticker")
        and outbound.get("quantity") == inbound.get("quantity")
        and (
            not outbound_currency
            or not inbound_currency
            or outbound_currency == inbound_currency
        )
    )


def _security_transfer_record_key_by_id(
    transactions: list[dict[str, Any]],
    *,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[int, str]:
    """Return unique, persisted transfer keys without mutating source records."""
    return {
        id(records[0]): key
        for key, records in (
            binding_index
            if binding_index is not None
            else _investment_import_compat.build_investment_internal_transfer_binding_index(
                transactions
            )
        ).items()
        if len(records) == 1
    }


def _security_transfer_fifo_scope_key(
    record: dict[str, Any],
) -> tuple[str, str, str, str] | None:
    """Keep FIFO reconstruction inside one broker, account, ticker, and currency."""
    broker = _ii_bindings._investment_internal_transfer_broker(record)
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    ticker = normalize_ticker(_normalize_text(record.get("ticker")))
    currency = _normalize_text(record.get("currency")).upper()
    if not broker or not account or not ticker:
        return None
    return (
        broker,
        _ii_basics._account_identity_token(broker, account),
        ticker,
        currency,
    )


def _security_transfer_fifo_sort_key(
    record: dict[str, Any],
    original_index: int,
) -> tuple[str, str, str, int, str, int]:
    """Replay source inventory by the strongest imported chronology available."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    history_datetime = next(
        (
            _normalize_text(source.get(field_name))
            for field_name in (
                "history_order_datetime",
                "execution_datetime",
                "trade_datetime",
            )
            if _normalize_text(source.get(field_name))
        ),
        "",
    )
    row_number = _ii_hsbc_cash._parse_decimal_text_or_none(source.get("row_number"))
    row_value = int(row_number) if row_number is not None else 10**9
    transaction_type = _ii_bindings._investment_internal_transfer_type(record)
    type_order = {
        "buy": 0,
        "dividend_reinvestment": 1,
        "grant": 2,
        "transfer_in": 3,
        "sell": 4,
        "transfer_out": 5,
    }.get(transaction_type, 9)
    return (
        history_datetime,
        _normalize_text(record.get("datetime")),
        _normalize_text(record.get("date")),
        type_order,
        transaction_type,
        row_value,
    )


def _security_transfer_fifo_quantity(record: dict[str, Any]) -> Decimal | None:
    raw_quantity = record.get("quantity_abs") or record.get("quantity_raw")
    quantity = _ii_hsbc_cash._parse_decimal_text_or_none(raw_quantity)
    if quantity is None or quantity <= ZERO:
        return None
    return abs(quantity)


def _security_transfer_fifo_unit_cost(
    record: dict[str, Any],
    quantity: Decimal,
) -> Decimal | None:
    """Use net acquisition cash so imported commissions remain in carried basis."""
    if quantity <= ZERO:
        return None
    normalized = (
        record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
    )
    transaction_type = _ii_bindings._investment_internal_transfer_type(record)
    if transaction_type == "grant":
        return ZERO
    if transaction_type == "transfer_in":
        carried_status = _normalize_text(
            record.get("carried_cost_basis_status")
        ).lower()
        carried_basis = _ii_hsbc_cash._parse_decimal_text_or_none(
            record.get("carried_cost_basis_raw")
        )
        if carried_status == "known" and carried_basis is not None:
            return abs(carried_basis) / quantity
        return None
    if transaction_type not in {"buy", "dividend_reinvestment"}:
        return None

    for raw_amount in (
        normalized.get("net_amount"),
        record.get("net_amount_raw"),
        normalized.get("gross_amount"),
        record.get("gross_amount_raw"),
    ):
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if amount is not None and abs(amount) > ZERO:
            return abs(amount) / quantity
    for raw_price in (
        normalized.get("unit_price"),
        record.get("price_raw"),
        record.get("price"),
    ):
        price = _ii_hsbc_cash._parse_decimal_text_or_none(raw_price)
        if price is not None and abs(price) > ZERO:
            return abs(price)
    return None


def _security_transfer_fifo_clear_derived_basis(record: dict[str, Any]) -> None:
    for field_name in _SECURITY_TRANSFER_FIFO_BASIS_FIELDS:
        record.pop(field_name, None)


def _security_transfer_fifo_set_basis(
    record: dict[str, Any],
    *,
    prefix: str,
    quantity: Decimal,
    status: str,
    total_cost: Decimal | None,
    source_transfer_key: str = "",
    allocations: list[dict[str, str]] | None = None,
) -> None:
    basis_prefix = (
        "carried_cost_basis" if prefix == "carried" else "transfer_out_cost_basis"
    )
    record[f"{basis_prefix}_status"] = status
    record[f"{basis_prefix}_method"] = _SECURITY_TRANSFER_FIFO_METHOD
    record[f"{basis_prefix}_method_label"] = _SECURITY_TRANSFER_FIFO_METHOD_LABEL
    record[f"{basis_prefix}_quantity_raw"] = _decimal_to_str(quantity) or "0"
    if total_cost is not None:
        record[f"{basis_prefix}_raw"] = _decimal_to_str(total_cost) or "0"
    if source_transfer_key:
        record["carried_cost_basis_source_transfer_key"] = source_transfer_key
    if allocations is not None:
        record[f"{basis_prefix}_allocations"] = allocations


def _security_transfer_fifo_consume_lots(
    lots: list[dict[str, Any]],
    quantity: Decimal,
    *,
    record_keys: dict[int, str],
) -> tuple[Decimal | None, str, list[dict[str, str]]]:
    """Consume source lots in FIFO order and preserve an auditable allocation trace."""
    remaining = quantity
    known_cost = ZERO
    known_quantity = ZERO
    allocations: list[dict[str, str]] = []
    while remaining > ZERO and lots:
        lot = lots[0]
        lot_quantity = lot["quantity"]
        consumed = min(remaining, lot_quantity)
        lot_cost = lot.get("unit_cost")
        allocation = {
            "source_record_key": record_keys.get(id(lot["record"]), ""),
            "quantity_raw": _decimal_to_str(consumed) or "0",
        }
        if lot_cost is not None:
            allocation["unit_cost_raw"] = _decimal_to_str(lot_cost) or "0"
            allocation["cost_basis_raw"] = _decimal_to_str(lot_cost * consumed) or "0"
            known_cost += lot_cost * consumed
            known_quantity += consumed
        allocations.append(allocation)
        lot["quantity"] -= consumed
        remaining -= consumed
        if lot["quantity"] <= ZERO:
            lots.pop(0)

    if remaining > ZERO:
        status = "unknown"
        total_cost: Decimal | None = None
    elif known_quantity == quantity:
        status = "known"
        total_cost = known_cost
    elif known_quantity > ZERO:
        status = "partial"
        total_cost = known_cost
    else:
        status = "unknown"
        total_cost = None
    return total_cost, status, allocations


def _reconstruct_security_transfer_fifo_basis(
    transactions: list[dict[str, Any]],
    matched_transfer_pairs: list[dict[str, Any]],
    *,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    """Reconstruct matched transfer basis from FIFO source-account inventory."""
    record_keys = _security_transfer_record_key_by_id(
        transactions,
        binding_index=binding_index,
    )
    pair_by_source_id = {
        id(pair["source_record"]): pair
        for pair in matched_transfer_pairs
        if isinstance(pair.get("source_record"), dict)
        and isinstance(pair.get("target_record"), dict)
    }
    for record in transactions:
        if isinstance(record, dict):
            _security_transfer_fifo_clear_derived_basis(record)

    scoped_records: defaultdict[
        tuple[str, str, str, str], list[tuple[int, dict[str, Any]]]
    ] = defaultdict(list)
    for original_index, record in enumerate(transactions):
        if not isinstance(record, dict):
            continue
        scope_key = _security_transfer_fifo_scope_key(record)
        if scope_key is not None:
            scoped_records[scope_key].append((original_index, record))

    basis_results: list[dict[str, Any]] = []
    for records in scoped_records.values():
        ordered_records = sorted(
            records,
            key=lambda item: _security_transfer_fifo_sort_key(item[1], item[0]),
        )
        lots: list[dict[str, Any]] = []
        for _, record in ordered_records:
            transaction_type = _ii_bindings._investment_internal_transfer_type(record)
            quantity = _security_transfer_fifo_quantity(record)
            if quantity is None:
                continue
            if transaction_type in {
                "buy",
                "dividend_reinvestment",
                "grant",
                "transfer_in",
            }:
                lots.append(
                    {
                        "record": record,
                        "quantity": quantity,
                        "unit_cost": _security_transfer_fifo_unit_cost(
                            record, quantity
                        ),
                    }
                )
                continue
            if transaction_type == "sell":
                _security_transfer_fifo_consume_lots(
                    lots,
                    quantity,
                    record_keys=record_keys,
                )
                continue
            if transaction_type != "transfer_out":
                continue

            total_cost, status, allocations = _security_transfer_fifo_consume_lots(
                lots,
                quantity,
                record_keys=record_keys,
            )
            pair = pair_by_source_id.get(id(record))
            if pair is None:
                continue
            source_key = record_keys.get(id(record), "")
            target_record = pair["target_record"]
            target_key = record_keys.get(id(target_record), "")
            _security_transfer_fifo_set_basis(
                record,
                prefix="transfer_out",
                quantity=quantity,
                status=status,
                total_cost=total_cost,
                allocations=allocations,
            )
            _security_transfer_fifo_set_basis(
                target_record,
                prefix="carried",
                quantity=quantity,
                status=status,
                total_cost=total_cost,
                source_transfer_key=source_key,
                allocations=allocations,
            )
            basis_results.append(
                {
                    "source_key": source_key,
                    "target_key": target_key,
                    "ticker": normalize_ticker(
                        _normalize_text(target_record.get("ticker"))
                    ),
                    "quantity": _decimal_to_str(quantity) or "0",
                    "status": status,
                    "method": _SECURITY_TRANSFER_FIFO_METHOD,
                    "method_label": _SECURITY_TRANSFER_FIFO_METHOD_LABEL,
                    "carried_cost_basis": _decimal_to_str(total_cost)
                    if total_cost is not None
                    else "",
                    "source_transfer_out_cost_basis": _decimal_to_str(total_cost)
                    if total_cost is not None
                    else "",
                    "source_broker": _ii_bindings._investment_internal_transfer_broker(
                        record
                    ),
                    "source_account": _normalize_text(record.get("account")),
                    "destination_broker": _ii_bindings._investment_internal_transfer_broker(
                        target_record
                    ),
                    "destination_account": _normalize_text(
                        target_record.get("account")
                    ),
                }
            )
    return basis_results


def _security_transfer_same_account(
    leg: dict[str, Any],
    broker: str,
    account: str,
) -> bool:
    leg_broker = _ii_basics._normalize_broker_code(leg.get("broker"))
    requested_broker = _ii_basics._normalize_broker_code(broker)
    if leg_broker != requested_broker:
        return False
    return _ii_basics._account_identity_token(
        leg_broker,
        _normalize_text(leg.get("account")),
    ) == _ii_basics._account_identity_token(requested_broker, _normalize_text(account))


def _security_transfer_attribution_source_evidence(
    outbound_legs: list[dict[str, Any]],
    inbound_leg: dict[str, Any],
    *,
    source_broker: str,
    source_account: str,
) -> list[dict[str, Any]]:
    """Find evidence only after the user has named a concrete source account."""
    return [
        outbound
        for outbound in outbound_legs
        if _security_transfer_same_account(outbound, source_broker, source_account)
        and _security_transfer_legs_match(outbound, inbound_leg)
    ]


def _reconcile_cross_broker_security_transfers(
    transactions: list[dict[str, Any]],
    manual_bindings: Any = None,
    security_transfer_attributions: Any = None,
) -> dict[str, Any]:
    """Report transfer evidence and aggregate-only attestations without inventing legs."""
    legs = [
        leg
        for record in transactions
        if isinstance(record, dict)
        for leg in [_security_transfer_reconciliation_leg(record)]
        if leg is not None
    ]
    outbound_legs = [leg for leg in legs if leg["type"] == "transfer_out"]
    inbound_legs = [leg for leg in legs if leg["type"] == "transfer_in"]
    binding_index = (
        _investment_import_compat.build_investment_internal_transfer_binding_index(
            transactions
        )
    )
    record_keys = _security_transfer_record_key_by_id(
        transactions,
        binding_index=binding_index,
    )
    manually_matched_record_ids: set[int] = set()
    manual_match_count = 0
    matched_transfer_pairs: list[dict[str, Any]] = []
    for (
        source_key,
        target_key,
    ) in _ii_bindings.normalize_investment_internal_transfer_bindings(
        manual_bindings
    ).items():
        source_records = binding_index.get(source_key, [])
        target_records = binding_index.get(target_key, [])
        if len(source_records) != 1 or len(target_records) != 1:
            continue
        try:
            source_record, target_record = (
                _ii_bindings.validate_investment_internal_transfer_binding(
                    transactions,
                    source_key,
                    target_key,
                    binding_index=binding_index,
                )
            )
        except ValueError:
            continue
        source_leg = _security_transfer_reconciliation_leg(source_record)
        target_leg = _security_transfer_reconciliation_leg(target_record)
        if (
            source_leg is None
            or target_leg is None
            or source_leg["type"] != "transfer_out"
            or target_leg["type"] != "transfer_in"
            or id(source_record) in manually_matched_record_ids
            or id(target_record) in manually_matched_record_ids
        ):
            continue
        manually_matched_record_ids.update(
            {
                id(source_record),
                id(target_record),
            }
        )
        matched_transfer_pairs.append(
            {
                "source_record": source_record,
                "target_record": target_record,
            }
        )
        manual_match_count += 1

    transfer_basis = _reconstruct_security_transfer_fifo_basis(
        transactions,
        matched_transfer_pairs,
        binding_index=binding_index,
    )
    basis_by_target_id = {
        id(pair["target_record"]): next(
            (
                result
                for result in transfer_basis
                if result.get("target_key")
                == record_keys.get(id(pair["target_record"]), "")
            ),
            {},
        )
        for pair in matched_transfer_pairs
        if isinstance(pair.get("target_record"), dict)
    }

    unmatched_outbound_legs = [
        leg
        for leg in outbound_legs
        if id(leg["record"]) not in manually_matched_record_ids
    ]
    unmatched_inbound_legs = [
        leg
        for leg in inbound_legs
        if id(leg["record"]) not in manually_matched_record_ids
    ]

    # Never infer an unconfirmed cross-broker source from a coincident ticker,
    # date, and quantity. A user attestation can later identify one source
    # account; only then may a subsequently imported exact source leg supersede
    # that aggregate-only overlay.
    normalized_attributions = (
        _ii_bindings.normalize_investment_security_transfer_attributions(
            security_transfer_attributions,
            transactions=transactions,
            binding_index=binding_index,
        )
    )
    attribution_by_inbound_id: dict[int, dict[str, str]] = {}
    attribution_evidence_record_ids: set[int] = set()
    attribution_evidence_match_count = 0
    active_overlay_receipt_keys: list[str] = []
    superseded_receipt_keys: list[str] = []
    invalid_attribution_receipt_keys: list[str] = []
    attribution_statuses: list[dict[str, str]] = []

    for receipt_key, attribution in normalized_attributions.items():
        receipt_records = binding_index.get(receipt_key, [])
        if len(receipt_records) != 1:
            continue
        receipt_record = receipt_records[0]
        receipt_leg = _security_transfer_reconciliation_leg(receipt_record)
        if (
            receipt_leg is None
            or receipt_leg["type"] != "transfer_in"
            or id(receipt_record) in manually_matched_record_ids
        ):
            continue
        source_broker = _ii_basics._normalize_broker_code(
            attribution.get("source_broker")
        )
        source_account = _normalize_text(attribution.get("source_account"))
        source_evidence = _security_transfer_attribution_source_evidence(
            unmatched_outbound_legs,
            receipt_leg,
            source_broker=source_broker,
            source_account=source_account,
        )
        if len(source_evidence) == 1:
            source_record = source_evidence[0]["record"]
            attribution_evidence_record_ids.update(
                {id(receipt_record), id(source_record)}
            )
            superseded_receipt_keys.append(receipt_key)
            attribution_statuses.append(
                {
                    "receipt_key": receipt_key,
                    "status": "superseded_by_source_evidence",
                    "source_broker": source_broker,
                    "source_account": source_account,
                }
            )
            attribution_evidence_match_count += 1
            continue
        if len(source_evidence) > 1:
            invalid_attribution_receipt_keys.append(receipt_key)
            attribution_statuses.append(
                {
                    "receipt_key": receipt_key,
                    "status": "source_record_ambiguous",
                    "source_broker": source_broker,
                    "source_account": source_account,
                }
            )
            continue
        try:
            _ii_bindings.validate_investment_security_transfer_attribution(
                transactions,
                receipt_key,
                source_broker,
                source_account,
                existing_attributions=normalized_attributions,
                binding_index=binding_index,
            )
        except ValueError:
            invalid_attribution_receipt_keys.append(receipt_key)
            attribution_statuses.append(
                {
                    "receipt_key": receipt_key,
                    "status": "inactive_validation_failed",
                    "source_broker": source_broker,
                    "source_account": source_account,
                }
            )
            continue
        attribution_by_inbound_id[id(receipt_record)] = {
            "receipt_key": receipt_key,
            "status": "active_user_attested_overlay",
        }
        active_overlay_receipt_keys.append(receipt_key)
        attribution_statuses.append(
            {
                "receipt_key": receipt_key,
                "status": "active_user_attested_overlay",
                "source_broker": source_broker,
                "source_account": source_account,
            }
        )

    unreconciled_inbounds: list[dict[str, str]] = []
    for inbound in unmatched_inbound_legs:
        inbound_record_id = id(inbound["record"])
        if inbound_record_id in attribution_evidence_record_ids:
            continue
        attribution_state = attribution_by_inbound_id.get(inbound_record_id, {})
        receipt_key = record_keys.get(inbound_record_id, "")
        unreconciled_inbounds.append(
            {
                "record_key": receipt_key,
                "date": inbound["date"],
                "ticker": inbound["ticker"],
                "quantity": _decimal_to_str(inbound["quantity"]) or "0",
                "currency": inbound["currency"],
                "destination_broker": inbound["broker"],
                "status": "source_record_missing",
                "aggregate_overlay_status": attribution_state.get("status", ""),
            }
        )
    unreconciled_outbound_count = sum(
        1
        for outbound in unmatched_outbound_legs
        if id(outbound["record"]) not in attribution_evidence_record_ids
    )
    source_attribution_required_receipt_keys = [
        item["record_key"]
        for item in unreconciled_inbounds
        if item.get("record_key")
        and item.get("aggregate_overlay_status") != "active_user_attested_overlay"
    ]
    aggregate_holdings_available = not (
        source_attribution_required_receipt_keys
        or invalid_attribution_receipt_keys
        or unreconciled_outbound_count
    )
    if source_attribution_required_receipt_keys:
        aggregate_scope_status = "blocked_source_attribution_required"
    elif invalid_attribution_receipt_keys or unreconciled_outbound_count:
        aggregate_scope_status = "blocked_source_evidence_required"
    elif active_overlay_receipt_keys:
        aggregate_scope_status = "user_attested_net_neutral"
    else:
        aggregate_scope_status = "evidence_backed"
    pnl_unavailable_tickers = sorted(
        {
            inbound["ticker"]
            for inbound in inbound_legs
            if inbound["ticker"]
            and (
                id(inbound["record"]) not in manually_matched_record_ids
                or basis_by_target_id.get(id(inbound["record"]), {}).get("status")
                != "known"
            )
        }
    )
    return {
        "matched_count": manual_match_count + attribution_evidence_match_count,
        "manual_match_count": manual_match_count,
        "automatic_match_count": 0,
        "attribution_evidence_match_count": attribution_evidence_match_count,
        "unreconciled_inbound_count": len(unreconciled_inbounds),
        "unreconciled_outbound_count": unreconciled_outbound_count,
        "aggregate_history_complete": not unreconciled_inbounds
        and not unreconciled_outbound_count,
        "aggregate_holdings_available": aggregate_holdings_available,
        "aggregate_scope_status": aggregate_scope_status,
        "aggregate_overlay": {
            "active_receipt_keys": sorted(active_overlay_receipt_keys),
            "source_attribution_required_receipt_keys": sorted(
                source_attribution_required_receipt_keys
            ),
            "invalid_receipt_keys": sorted(invalid_attribution_receipt_keys),
            "superseded_receipt_keys": sorted(superseded_receipt_keys),
            "attribution_statuses": attribution_statuses,
        },
        "transfer_basis": transfer_basis,
        "pnl_status": "unavailable" if pnl_unavailable_tickers else "available",
        "pnl_unavailable_tickers": sorted(pnl_unavailable_tickers),
        "pnl_unavailable_reason": (
            "cross_broker_security_transfer_basis_unverified"
            if pnl_unavailable_tickers
            else ""
        ),
        "unreconciled_inbounds": unreconciled_inbounds,
    }


def _sort_transactions(transactions: list[dict[str, Any]]) -> None:
    def _schwab_date_only_trade_sequence(item: dict[str, Any]) -> Decimal | None:
        if _ii_basics._normalize_broker_code(item.get("broker")) != "schwab":
            return None
        if _normalize_text(item.get("type")).lower() not in {"buy", "sell"}:
            return None
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        if source.get("source_has_intraday_timestamp") is True:
            return None
        if _normalize_text(source.get("datetime_precision")).lower() == "second":
            return None

        explicit_sequence = source.get("same_day_execution_sequence")
        if explicit_sequence not in (None, ""):
            try:
                return Decimal(str(explicit_sequence))
            except (InvalidOperation, TypeError, ValueError):
                pass

        try:
            row_number = int(source.get("row_number", 0) or 0)
        except (TypeError, ValueError):
            row_number = 0
        if row_number <= 0:
            return None
        source_row_order = _normalize_text(source.get("source_row_order")).lower()
        if source_row_order == "newest_first":
            return Decimal(-row_number)
        if source_row_order == "oldest_first":
            return Decimal(row_number)
        return None

    def _transaction_cash_sort_amount(item: dict[str, Any]) -> Decimal:
        normalized = (
            item.get("normalized") if isinstance(item.get("normalized"), dict) else {}
        )
        for value in (
            normalized.get("net_amount"),
            normalized.get("cash_flow_amount"),
            normalized.get("accounting_adjustment_amount"),
            item.get("net_amount_raw"),
            item.get("gross_amount_raw"),
        ):
            parsed = (
                _parse_decimal(str(value), "cash_sort_amount", 0, [])
                if value is not None
                else None
            )
            if parsed is not None:
                return parsed
        return ZERO

    def _cash_safety_sort_key(item: dict[str, Any]) -> tuple[int, Decimal]:
        normalized_type = _normalize_text(item.get("type")).replace(" ", "_").lower()
        cash_amount = _transaction_cash_sort_amount(item)
        schwab_trade_sequence = _schwab_date_only_trade_sequence(item)
        if schwab_trade_sequence is not None:
            # Schwab's date-only transaction export is newest-first. Keep
            # same-day buy/sell chronology ahead of the generic cash-safety
            # fallback, which otherwise always places a sell before a buy.
            return (1, schwab_trade_sequence)
        if cash_amount > ZERO:
            return (0, -cash_amount)
        if normalized_type in {
            "deposit",
            "sell",
            "dividend",
            "credit_interest",
            "payment_in_lieu",
        }:
            return (0, -cash_amount)
        if normalized_type in {"buy", "dividend_reinvestment", "grant"}:
            return (1, ZERO)
        if cash_amount < ZERO:
            return (2, -cash_amount)
        if normalized_type in {
            "withdrawal",
            "foreign_tax_withholding",
            "debit_interest",
        }:
            return (2, ZERO)
        return (1, ZERO)

    def _hsbc_sort_key(item: dict[str, Any]) -> tuple[int, int, int]:
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        file_kind = _normalize_text(source.get("file_kind"))
        row_number = int(source.get("row_number", 0))
        if file_kind in HSBC_CASH_ACCOUNT_FILE_KINDS:
            ledger_sequence = int(source.get("ledger_sequence", 0) or 0)
            if file_kind == "hsbc_usd_savings_csv" and ledger_sequence:
                if (
                    _normalize_text(source.get("ledger_sequence_order")).lower()
                    == "chronological"
                ):
                    return (0, ledger_sequence, row_number)
                # Legacy payloads stored raw newest-first row numbers here.
                return (0, -ledger_sequence, -row_number)
            if ledger_sequence:
                return (0, ledger_sequence, row_number)
            return (0, row_number, row_number)
        if file_kind in {"hsbc_order_status_text", "hsbc_order_status_capture"}:
            source_rank = int(
                source.get("order_status_source_row_number")
                or source.get("row_number", 0)
                or 0
            )
            if source_rank:
                page_order = _normalize_text(
                    source.get("order_status_page_order")
                ).lower()
                # HSBC Order Status is displayed newest-first. Retain the page
                # sequence as execution evidence when the source omits a fill
                # time; SEC cash-posting order belongs only to cash replay.
                chronological_rank = (
                    source_rank if page_order == "oldest_first" else -source_rank
                )
                return (1, chronological_rank, row_number)
            return (1, 10**9, row_number)
        return (9, 10**9, row_number)

    transactions.sort(
        key=lambda item: (
            item.get("date", ""),
            item.get("datetime", "") or item.get("date", ""),
            _hsbc_sort_key(item)[0],
            _hsbc_sort_key(item)[1],
            _cash_safety_sort_key(item)[0],
            _cash_safety_sort_key(item)[1],
            _normalize_text(item.get("source", {}).get("file_kind")),
            _hsbc_sort_key(item)[2],
        )
    )


def _hsbc_order_reference(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _normalize_text(
        source.get("statement_order_id") or source.get("order_id")
    ).upper()


def _hsbc_order_decimal(
    record: dict[str, Any],
    fields: tuple[str, ...],
) -> Decimal | None:
    normalized = (
        record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
    )
    for field in fields:
        value = record.get(field)
        if value is None:
            value = normalized.get(field)
        if value is None:
            continue
        parsed = _parse_decimal(str(value), field, 0, [])
        if parsed is not None:
            return abs(parsed)
    return None


def _is_hsbc_execution_notification_timestamp(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    notification_datetime = _normalize_text(
        source.get("hsbc_order_execution_notification_sent_at")
    )
    return bool(
        notification_datetime
        and notification_datetime == _normalize_text(record.get("datetime"))
        and _normalize_text(source.get("datetime_source_field"))
        == "hsbc_order_execution_notification_sent_at"
    )


def _is_hsbc_legacy_email_notification_timestamp(record: dict[str, Any]) -> bool:
    """Identify an older HSBC email-derived timestamp eligible for refresh."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return bool(
        _normalize_text(source.get("datetime_authority"))
        == "hsbc_notification_email_received_at"
        and _normalize_text(source.get("source_notification_email_message_id"))
        and _normalize_text(source.get("datetime_local_timezone")) == "Asia/Shanghai"
        and _normalize_text(source.get("datetime_source_field"))
        != "hsbc_order_execution_notification_sent_at"
    )


def apply_hsbc_order_execution_notification_timestamps(
    payload: dict[str, Any],
    notifications: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Apply verified HSBC execution-notification times to HSBC order records.

    HSBC Order Status exposes an order date but not a fill time. A signed HSBC
    execution-result email supplies a precise notification timestamp, but it
    is not a venue execution report. This function therefore records the
    provenance explicitly and replaces either the shared date-only convention
    or an older Asia/Shanghai email-derived proxy.
    after every order-level fact agrees with the ledger.
    """
    raw_transactions = payload.get("transactions")
    if not isinstance(raw_transactions, list):
        raise ValueError("The investment payload has no transaction list.")
    transactions = _ii_merge_reconciliation._payload_transactions(payload)
    if not notifications:
        raise ValueError("At least one HSBC execution notification is required.")

    records_by_order_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for transaction in transactions:
        if not _ii_basics._is_hsbc_order_status_record(transaction):
            continue
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )
        broker = _ii_basics._normalize_broker_code(
            transaction.get("broker") or source.get("broker")
        )
        if broker != "hsbc":
            continue
        order_id = _hsbc_order_reference(transaction)
        if order_id:
            records_by_order_id[order_id].append(transaction)

    applied: list[dict[str, str]] = []
    seen_order_ids: set[str] = set()
    timezone_name = DEFAULT_CONVENTION_TIMEZONE
    for index, notification in enumerate(notifications, start=1):
        if not isinstance(notification, dict):
            raise ValueError(f"HSBC execution notification {index} must be an object.")
        order_id = _normalize_text(notification.get("order_id")).upper()
        if not order_id:
            raise ValueError(
                f"HSBC execution notification {index} is missing an order ID."
            )
        if order_id in seen_order_ids:
            raise ValueError(
                f"HSBC execution notification duplicates order {order_id}."
            )
        seen_order_ids.add(order_id)

        matching_records = records_by_order_id.get(order_id, [])
        if len(matching_records) != 1:
            raise ValueError(
                f"HSBC execution notification {order_id} matched {len(matching_records)} ledger orders."
            )
        transaction = matching_records[0]
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )

        raw_datetime = _normalize_text(notification.get("notification_datetime"))
        try:
            notification_datetime = datetime.strptime(raw_datetime, "%Y-%m-%d %H:%M:%S")
        except ValueError as exc:
            raise ValueError(
                f"HSBC execution notification {order_id} has an invalid New York timestamp."
            ) from exc
        if _normalize_text(notification.get("notification_timezone")) != timezone_name:
            raise ValueError(
                f"HSBC execution notification {order_id} must use {timezone_name}."
            )
        transaction_date = _normalize_text(transaction.get("date"))
        if transaction_date != notification_datetime.date().isoformat():
            raise ValueError(
                f"HSBC execution notification {order_id} date does not match the ledger order date."
            )

        expected_side = _normalize_text(notification.get("side")).lower()
        actual_side = _normalize_text(transaction.get("type")).lower()
        if expected_side not in {"buy", "sell"} or expected_side != actual_side:
            raise ValueError(
                f"HSBC execution notification {order_id} side does not match the ledger order."
            )
        expected_ticker = normalize_ticker(_normalize_text(notification.get("ticker")))
        actual_ticker = normalize_ticker(_normalize_text(transaction.get("ticker")))
        if not expected_ticker or expected_ticker != actual_ticker:
            raise ValueError(
                f"HSBC execution notification {order_id} ticker does not match the ledger order."
            )

        expected_quantity = _parse_decimal(
            str(notification.get("quantity") or ""),
            "notification quantity",
            index,
            [],
        )
        actual_quantity = _hsbc_order_decimal(
            transaction,
            ("quantity_abs", "quantity_raw", "quantity"),
        )
        if (
            expected_quantity is None
            or expected_quantity <= ZERO
            or actual_quantity is None
            or expected_quantity != actual_quantity
        ):
            raise ValueError(
                f"HSBC execution notification {order_id} quantity does not match the ledger order."
            )

        expected_price_text = _normalize_text(notification.get("price"))
        if expected_price_text:
            expected_price = _parse_decimal(
                expected_price_text,
                "notification price",
                index,
                [],
            )
            actual_price = _hsbc_order_decimal(transaction, ("price_raw", "price"))
            if (
                expected_price is None
                or expected_price <= ZERO
                or actual_price is None
                or expected_price != actual_price
            ):
                raise ValueError(
                    f"HSBC execution notification {order_id} price does not match the ledger order."
                )

        sender = _normalize_text(notification.get("sender")).lower()
        sender_domain = sender.rsplit("@", 1)[-1] if "@" in sender else ""
        if sender_domain != "hsbc.com.hk" and not sender_domain.endswith(
            ".hsbc.com.hk"
        ):
            raise ValueError(
                f"HSBC execution notification {order_id} has an unverified sender domain."
            )
        message_id = _normalize_text(notification.get("gmail_message_id"))
        if not message_id:
            raise ValueError(
                f"HSBC execution notification {order_id} is missing its Gmail message ID."
            )

        current_datetime = _normalize_text(transaction.get("datetime"))
        default_datetime = f"{transaction_date} {DEFAULT_CONVENTION_TIME}"
        legacy_email_timestamp = _is_hsbc_legacy_email_notification_timestamp(
            transaction
        )
        current_notification_timestamp = _is_hsbc_execution_notification_timestamp(
            transaction
        )
        if (
            current_datetime not in {default_datetime, raw_datetime}
            and not legacy_email_timestamp
        ):
            raise ValueError(
                f"HSBC ledger order {order_id} already has a non-default timestamp without matching notification provenance."
            )
        if (
            current_datetime == raw_datetime
            and not current_notification_timestamp
            and not legacy_email_timestamp
        ):
            raise ValueError(
                f"HSBC ledger order {order_id} already has an unverified precise timestamp."
            )

        transaction["datetime"] = raw_datetime
        source.update(
            {
                "hsbc_order_execution_notification_sent_at": raw_datetime,
                "hsbc_order_execution_notification_timezone": timezone_name,
                "hsbc_order_execution_notification_time_basis": "dkim_signed_email_date_header",
                "hsbc_order_execution_notification_gmail_message_id": message_id,
                "hsbc_order_execution_notification_sender": sender,
                "datetime_source_field": "hsbc_order_execution_notification_sent_at",
                "datetime_precision": "second",
                "datetime_is_execution_notification_proxy": True,
            }
        )
        transaction["source"] = source
        applied.append(
            {
                "order_id": order_id,
                "datetime": raw_datetime,
                "timezone": timezone_name,
            }
        )

    sortable_transactions = (
        raw_transactions
        if all(isinstance(transaction, dict) for transaction in raw_transactions)
        else transactions
    )
    _sort_transactions(sortable_transactions)
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    payload["summary"] = summary
    summary["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return applied
