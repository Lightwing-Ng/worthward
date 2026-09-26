"""Investment import domain: merge reconciliation.

Code version: v0.2.1
- Added: Statement-derived settlement postings retain their cash subaccount and
  immutable source sequence identity for browser replay.
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    HSBC_CORPORATE_EVENT_PAYMENT_PREFIX,
    ZERO,
    _normalize_text,
    _normalize_whitespace,
    date,
    defaultdict,
    normalize_ticker,
    re,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.merge.identity as _ii_merge_identity

import app.services.investment.importing.records as _ii_records


def _merge_non_grant_transactions(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int]:
    superseded_fx_translation_count = 0

    merged_by_key: dict[tuple[tuple[str, ...], int], dict[str, Any]] = {}
    candidate_slots: dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]] = (
        defaultdict(list)
    )
    slot_order: dict[tuple[tuple[str, ...], int], int] = {}

    def register_merge_candidate(
        composite_key: tuple[tuple[str, ...], int],
        record: dict[str, Any],
    ) -> None:
        if composite_key not in slot_order:
            slot_order[composite_key] = len(slot_order)
        # A cross-source merge can adopt incoming source fields whose identity
        # differs from the original composite key. Keep both aliases so a
        # later duplicate source row reaches the same exact-match predicate.
        identity_aliases = dict.fromkeys(
            (
                composite_key[0],
                _ii_merge_identity._transaction_identity_key(record),
            )
        )
        for identity_alias in identity_aliases:
            for index_key in _ii_merge_identity._merge_candidate_index_keys(
                record, identity_alias
            ):
                slots = candidate_slots[index_key]
                if composite_key not in slots:
                    slots.append(composite_key)

    duplicate_count = 0
    existing_occurrences: dict[tuple[str, ...], int] = {}
    cross_source_slots: dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]] = (
        defaultdict(list)
    )
    statement_evidence_slots: dict[
        tuple[str, ...], list[tuple[tuple[str, ...], int]]
    ] = defaultdict(list)
    for record in existing_transactions:
        if _normalize_text(record.get("type")).lower() == "grant":
            continue
        identity_key = _ii_merge_identity._transaction_identity_key(record)
        composite_key, _ = _ii_merge_identity._merge_slot_for_transaction(
            record,
            identity_key,
            existing_occurrences,
            merged_by_key,
            candidate_slots,
            slot_order,
        )
        existing_record = merged_by_key.get(composite_key)
        if existing_record is None:
            merged_by_key[composite_key] = dict(record)
            register_merge_candidate(composite_key, merged_by_key[composite_key])
            cross_source_key = _ii_merge_identity._hsbc_cash_cross_source_identity_key(
                record
            )
            if cross_source_key:
                cross_source_slots[cross_source_key].append(composite_key)
            statement_evidence_key = (
                _ii_merge_identity._hsbc_statement_cash_enrichment_key(record)
            )
            if statement_evidence_key:
                statement_evidence_slots[statement_evidence_key].append(composite_key)
            continue
        duplicate_count += 1
        if _ii_merge_identity._is_fx_translation_pnl_record(record):
            superseded_fx_translation_count += 1
            merged_by_key[composite_key] = (
                _ii_merge_identity._pick_fx_translation_pnl_record(
                    existing_record, record
                )
            )
        else:
            merged_by_key[composite_key] = (
                _ii_merge_identity._merge_transaction_records(existing_record, record)
            )
        register_merge_candidate(composite_key, merged_by_key[composite_key])

    incoming_occurrences: dict[tuple[str, ...], int] = {}
    claimed_cross_source_slots: set[tuple[tuple[str, ...], int]] = set()
    claimed_statement_evidence_slots: set[tuple[tuple[str, ...], int]] = set()
    for record in incoming_transactions:
        if _normalize_text(record.get("type")).lower() == "grant":
            continue
        statement_evidence_key = _ii_merge_identity._hsbc_statement_cash_enrichment_key(
            record
        )
        if (
            statement_evidence_key
            and _ii_merge_identity._is_hsbc_statement_pdf_cash_record(record)
        ):
            ranked_candidates = sorted(
                (
                    rank,
                    candidate_key,
                )
                for candidate_key in statement_evidence_slots.get(
                    statement_evidence_key,
                    [],
                )
                if candidate_key not in claimed_statement_evidence_slots
                and (existing_record := merged_by_key.get(candidate_key)) is not None
                and (
                    rank := _ii_merge_identity._hsbc_statement_cash_enrichment_rank(
                        existing_record,
                        record,
                    )
                )
                is not None
            )
            if ranked_candidates:
                best_rank = ranked_candidates[0][0]
                best_candidates = [
                    candidate_key
                    for rank, candidate_key in ranked_candidates
                    if rank == best_rank
                ]
                if len(best_candidates) == 1:
                    candidate_key = best_candidates[0]
                    claimed_statement_evidence_slots.add(candidate_key)
                    duplicate_count += 1
                    merged_by_key[candidate_key] = (
                        _ii_merge_identity._merge_transaction_records(
                            merged_by_key[candidate_key],
                            record,
                        )
                    )
                    register_merge_candidate(
                        candidate_key,
                        merged_by_key[candidate_key],
                    )
                    continue
        cross_source_key = _ii_merge_identity._hsbc_cash_cross_source_identity_key(
            record
        )
        if cross_source_key:
            for candidate_key in cross_source_slots.get(cross_source_key, []):
                if candidate_key in claimed_cross_source_slots:
                    continue
                existing_record = merged_by_key.get(candidate_key)
                if existing_record is None:
                    continue
                existing_file_kind = _ii_merge_identity._hsbc_cash_source_file_kind(
                    existing_record
                )
                incoming_file_kind = _ii_merge_identity._hsbc_cash_source_file_kind(
                    record
                )
                if existing_file_kind == incoming_file_kind:
                    continue
                claimed_cross_source_slots.add(candidate_key)
                duplicate_count += 1
                merged_by_key[candidate_key] = (
                    _ii_merge_identity._merge_transaction_records(
                        existing_record,
                        record,
                    )
                )
                register_merge_candidate(candidate_key, merged_by_key[candidate_key])
                break
            else:
                candidate_key = None
            if candidate_key is not None:
                continue
        identity_key = _ii_merge_identity._transaction_identity_key(record)
        composite_key, _ = _ii_merge_identity._merge_slot_for_transaction(
            record,
            identity_key,
            incoming_occurrences,
            merged_by_key,
            candidate_slots,
            slot_order,
        )
        existing_record = merged_by_key.get(composite_key)
        if existing_record is None:
            merged_by_key[composite_key] = dict(record)
            register_merge_candidate(composite_key, merged_by_key[composite_key])
            continue
        duplicate_count += 1
        if _ii_merge_identity._is_fx_translation_pnl_record(record):
            superseded_fx_translation_count += 1
            merged_by_key[composite_key] = (
                _ii_merge_identity._pick_fx_translation_pnl_record(
                    existing_record, record
                )
            )
        else:
            merged_by_key[composite_key] = (
                _ii_merge_identity._merge_transaction_records(existing_record, record)
            )
        register_merge_candidate(composite_key, merged_by_key[composite_key])

    merged_transactions = list(merged_by_key.values())
    _ii_records._sort_transactions(merged_transactions)
    return merged_transactions, duplicate_count, superseded_fx_translation_count


def _suppress_resolved_hsbc_dividend_warnings(
    warnings: list[str],
    transactions: list[dict[str, Any]],
) -> list[str]:
    resolved_events = {
        (
            _normalize_text(record.get("date")),
            _normalize_text(record.get("net_amount_raw")),
        )
        for record in transactions
        if _ii_basics._normalize_broker_code(record.get("broker")) == "hsbc"
        and _normalize_text(record.get("type")).lower() == "dividend"
        and normalize_ticker(_normalize_text(record.get("ticker")))
        and _normalize_whitespace(record.get("description"))
        .upper()
        .startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX)
    }
    if not resolved_events:
        return warnings
    return [
        warning
        for warning in warnings
        if not (
            warning.startswith("HSBC corporate-event payment ")
            and "could not be attributed to one ticker" in warning
            and any(
                f"{event_date} / {event_amount} USD" in warning
                for event_date, event_amount in resolved_events
            )
        )
    ]


def _suppress_obsolete_hsbc_snapshot_warnings(
    warnings: list[str],
    incoming_summary: dict[str, Any],
) -> list[str]:
    snapshot = incoming_summary.get("hsbc_snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("status") != "validated":
        return warnings
    return [
        warning
        for warning in warnings
        if not (
            warning.startswith("HSBC pasted snapshot requires review because")
            and (
                "Order Status has no recognizable selected date range" in warning
                or "latest fully executed order is newer than the visible USD Savings postings"
                in warning
            )
        )
    ]


def _suppress_obsolete_ibkr_total_currency_warnings(
    warnings: list[str],
) -> list[str]:
    """Remove legacy warnings emitted for IBKR cash-section total rows."""
    obsolete_pattern = re.compile(
        r"^Row \d+: unsupported IBKR cash currency 'TOTAL[^']*' was skipped\.$",
        re.IGNORECASE,
    )
    return [
        warning for warning in warnings if obsolete_pattern.fullmatch(warning) is None
    ]


def _hsbc_matched_order_cash_references(
    transactions: list[dict[str, Any]],
) -> set[tuple[str, str, str]]:
    references: set[tuple[str, str, str]] = set()
    for record in transactions:
        if not isinstance(record, dict):
            continue
        if not _ii_basics._is_hsbc_order_status_record(record):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        cash_reference = (
            _ii_hsbc_cash._extract_hsbc_order_reference_from_cash_description(
                source.get("cash_settlement_reference")
            )
        )
        if not cash_reference:
            continue
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account")
        )
        references.add(
            (
                _ii_basics._account_identity_token("hsbc", account),
                cash_reference,
                _normalize_text(source.get("cash_settlement_date")),
            )
        )
    return references


def _remove_hsbc_cash_rows_superseded_by_matched_orders(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    matched_references = _hsbc_matched_order_cash_references(incoming_transactions)
    if not matched_references:
        return existing_transactions
    retained: list[dict[str, Any]] = []
    for record in existing_transactions:
        if not isinstance(
            record, dict
        ) or not _ii_merge_identity._is_hsbc_cash_account_record(record):
            retained.append(record)
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        cash_reference = (
            _ii_hsbc_cash._extract_hsbc_order_reference_from_cash_description(
                record.get("description")
            )
        )
        if not cash_reference:
            retained.append(record)
            continue
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account")
        )
        key = (
            _ii_basics._account_identity_token("hsbc", account),
            cash_reference,
            _normalize_text(record.get("date")),
        )
        if key in matched_references:
            continue
        retained.append(record)
    return retained


def _hsbc_order_settlement_leg_key(
    *,
    account: str,
    account_type: Any,
    transaction_date: Any,
    currency: Any,
    amount: Any,
) -> tuple[str, ...]:
    date_token = _normalize_text(transaction_date)
    currency_token = _ii_merge_identity._normalize_hsbc_currency_code(currency)
    account_type_token = _ii_merge_identity._normalize_hsbc_cash_account_type(
        currency_token,
        account_type,
    )
    amount_token = _ii_basics._normalize_decimal_identity_token(amount)
    if (
        not account
        or not account_type_token
        or not date_token
        or not currency_token
        or not amount_token
    ):
        return ()
    return (
        "hsbc_order_settlement_leg",
        _ii_basics._account_identity_token("hsbc", account),
        account_type_token,
        date_token,
        currency_token,
        amount_token,
    )


def _enrich_hsbc_orders_with_statement_cash_evidence(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Embed exact statement cash rows in orders without replaying cash twice."""
    statement_records = [
        record
        for record in incoming_transactions
        if _ii_merge_identity._is_hsbc_statement_pdf_cash_record(record)
    ]
    if not statement_records:
        return (
            existing_transactions,
            incoming_transactions,
            {
                "total": 0,
                "principal": 0,
                "fee": 0,
            },
        )

    existing_cash_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    for record in existing_transactions:
        evidence_key = _ii_merge_identity._hsbc_statement_cash_enrichment_key(record)
        if evidence_key:
            existing_cash_by_key[evidence_key].append(record)
    reserved_statement_record_ids = {
        id(statement_record)
        for statement_record in statement_records
        if any(
            _ii_merge_identity._hsbc_statement_cash_enrichment_rank(
                existing_record,
                statement_record,
            )
            is not None
            for existing_record in existing_cash_by_key.get(
                _ii_merge_identity._hsbc_statement_cash_enrichment_key(
                    statement_record
                ),
                [],
            )
        )
    }

    leg_candidates_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    for record_index, record in enumerate(existing_transactions):
        if not _ii_basics._is_hsbc_order_status_record(record):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account")
        )
        currency = _ii_merge_identity._normalize_hsbc_currency_code(
            record.get("currency")
        )
        raw_postings_value = source.get("cash_settlement_postings")
        if raw_postings_value is not None and not isinstance(raw_postings_value, list):
            continue
        raw_postings = raw_postings_value or []
        if any(not isinstance(posting, dict) for posting in raw_postings):
            continue
        if raw_postings:
            normalized_posting_sequences = [
                _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                    posting.get("ledger_sequence") or posting.get("row_number")
                )
                for posting in raw_postings
            ]
            if any(sequence is None for sequence in normalized_posting_sequences):
                continue
            for posting_index, posting in enumerate(raw_postings):
                role = _normalize_text(posting.get("role")) or "principal"
                key = _hsbc_order_settlement_leg_key(
                    account=account,
                    account_type=posting.get("account_type"),
                    transaction_date=(
                        posting.get("date") or source.get("cash_settlement_date")
                    ),
                    currency=posting.get("currency") or currency,
                    amount=posting.get("amount_raw") or posting.get("amount"),
                )
                if not key:
                    continue
                leg_candidates_by_key[key].append(
                    {
                        "record_index": record_index,
                        "posting_index": posting_index,
                        "role": role,
                        "source_sequence": normalized_posting_sequences[posting_index],
                        "order_id": _normalize_text(
                            source.get("statement_order_id") or source.get("order_id")
                        ),
                    }
                )
            continue

        settlement_date = _normalize_text(source.get("cash_settlement_date"))
        settlement_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
            source.get("cash_settlement_amount_raw")
        )
        raw_principal_row_number = source.get("cash_settlement_source_row_number")
        principal_row_number = (
            _ii_hsbc_cash._parse_hsbc_positive_sequence_number(raw_principal_row_number)
            if raw_principal_row_number not in (None, "")
            else 0
        )
        fee_row_numbers = source.get("cash_flow_fee_row_numbers")
        if fee_row_numbers is not None and not isinstance(fee_row_numbers, list):
            continue
        normalized_fee_row_numbers = [
            _ii_hsbc_cash._parse_hsbc_positive_sequence_number(row_number)
            for row_number in (fee_row_numbers or [])
        ]
        if principal_row_number is None or any(
            row_number is None for row_number in normalized_fee_row_numbers
        ):
            continue
        pending_candidates: list[tuple[tuple[str, ...], dict[str, Any]]] = []
        if settlement_date and settlement_amount is not None:
            principal_key = _hsbc_order_settlement_leg_key(
                account=account,
                account_type=source.get("cash_settlement_account_type"),
                transaction_date=settlement_date,
                currency=currency,
                amount=settlement_amount,
            )
            if principal_key:
                pending_candidates.append(
                    (
                        principal_key,
                        {
                            "record_index": record_index,
                            "posting_index": None,
                            "role": "principal",
                            "source_sequence": principal_row_number,
                            "order_id": _normalize_text(
                                source.get("statement_order_id")
                                or source.get("order_id")
                            ),
                        },
                    )
                )
        fee_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
            source.get("cash_flow_fee_amount_raw")
        )
        if settlement_date and fee_amount is not None and fee_amount > ZERO:
            fee_key = _hsbc_order_settlement_leg_key(
                account=account,
                account_type=source.get("cash_settlement_account_type"),
                transaction_date=settlement_date,
                currency=currency,
                amount=-fee_amount,
            )
            if fee_key:
                pending_candidates.append(
                    (
                        fee_key,
                        {
                            "record_index": record_index,
                            "posting_index": None,
                            "role": "fee",
                            "source_sequence": (
                                normalized_fee_row_numbers[0]
                                if normalized_fee_row_numbers
                                else 0
                            ),
                            "order_id": _normalize_text(
                                source.get("statement_order_id")
                                or source.get("order_id")
                            ),
                        },
                    )
                )
        for candidate_key, candidate in pending_candidates:
            leg_candidates_by_key[candidate_key].append(candidate)

    statement_records_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    for record in statement_records:
        if id(record) in reserved_statement_record_ids:
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        statement_row_number = _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
            source.get("row_number")
        )
        statement_ledger_sequence = _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
            source.get("ledger_sequence")
        )
        if statement_row_number is None or statement_ledger_sequence is None:
            continue
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account") or source.get("account_number")
        )
        key = _hsbc_order_settlement_leg_key(
            account=account,
            account_type=source.get("account_type"),
            transaction_date=record.get("date"),
            currency=record.get("currency"),
            amount=record.get("net_amount_raw"),
        )
        if key:
            statement_records_by_key[key].append(record)

    matches_by_record_index: dict[int, list[tuple[dict[str, Any], dict[str, Any]]]] = (
        defaultdict(list)
    )
    consumed_statement_record_ids: set[int] = set()
    matched_role_counts = {"principal": 0, "fee": 0}
    for key, legs in leg_candidates_by_key.items():
        records = statement_records_by_key.get(key, [])
        if not records or len(records) != len(legs):
            continue
        ordered_legs = sorted(
            legs,
            key=lambda leg: (
                int(leg.get("source_sequence", 0) or 0),
                _normalize_text(leg.get("order_id")),
                int(leg.get("record_index", 0) or 0),
            ),
        )
        ordered_records = sorted(
            records,
            key=lambda record: (
                _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                    (record.get("source") or {}).get("ledger_sequence")
                ),
                _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                    (record.get("source") or {}).get("row_number")
                ),
            ),
        )
        for leg, statement_record in zip(ordered_legs, ordered_records, strict=True):
            matches_by_record_index[int(leg["record_index"])].append(
                (leg, statement_record)
            )
            consumed_statement_record_ids.add(id(statement_record))
            role = _normalize_text(leg.get("role")) or "principal"
            if role in matched_role_counts:
                matched_role_counts[role] += 1

    enriched_transactions = list(existing_transactions)
    for record_index, matches in matches_by_record_index.items():
        record = dict(enriched_transactions[record_index])
        source = (
            dict(record.get("source")) if isinstance(record.get("source"), dict) else {}
        )
        raw_postings = source.get("cash_settlement_postings")
        if (raw_postings is not None and not isinstance(raw_postings, list)) or (
            isinstance(raw_postings, list)
            and any(not isinstance(posting, dict) for posting in raw_postings)
        ):
            for leg, statement_record in matches:
                consumed_statement_record_ids.discard(id(statement_record))
                role = _normalize_text(leg.get("role")) or "principal"
                if role in matched_role_counts:
                    matched_role_counts[role] -= 1
            continue
        postings = (
            [dict(posting) for posting in raw_postings or []]
            if isinstance(raw_postings, list)
            else []
        )
        statement_sha256_values: set[str] = set()
        for leg, statement_record in matches:
            statement_source = (
                statement_record.get("source")
                if isinstance(statement_record.get("source"), dict)
                else {}
            )
            statement_row_number = _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                statement_source.get("row_number")
            )
            statement_ledger_sequence = (
                _ii_hsbc_cash._parse_hsbc_positive_sequence_number(
                    statement_source.get("ledger_sequence")
                )
            )
            if statement_row_number is None or statement_ledger_sequence is None:
                continue
            statement_sha256 = _normalize_text(
                statement_source.get("source_file_sha256")
            ).lower()
            if statement_sha256:
                statement_sha256_values.add(statement_sha256)
            evidence_posting = {
                "date": _normalize_text(statement_record.get("date")),
                "amount_raw": _normalize_text(statement_record.get("net_amount_raw")),
                "balance_after_raw": _normalize_text(
                    statement_source.get("balance_after_raw")
                ),
                "reference": _normalize_whitespace(statement_record.get("description")),
                "row_number": statement_row_number,
                "ledger_sequence": statement_ledger_sequence,
                "source_file_kind": _normalize_text(statement_source.get("file_kind")),
                "source_sequence_sha256": _normalize_text(
                    statement_source.get("source_sequence_sha256")
                    or statement_source.get("source_file_sha256")
                ).lower(),
                "account_number": _normalize_text(
                    statement_source.get("account_number")
                    or statement_record.get("account")
                ),
                "account_type": _normalize_text(statement_source.get("account_type")),
                "currency": _ii_merge_identity._normalize_hsbc_currency_code(
                    statement_record.get("currency")
                ),
                "role": _normalize_text(leg.get("role")) or "principal",
                "statement_pdf_source_filename": _normalize_text(
                    statement_source.get("source_filename")
                ),
                "statement_pdf_source_sha256": statement_sha256,
                "statement_pdf_source_row_number": statement_row_number,
                "statement_pdf_statement_period": _normalize_text(
                    statement_source.get("statement_period")
                ),
            }
            posting_index = leg.get("posting_index")
            if isinstance(posting_index, int) and 0 <= posting_index < len(postings):
                postings[posting_index] = {
                    **postings[posting_index],
                    **evidence_posting,
                }
            else:
                postings.append(evidence_posting)
        if not _ii_hsbc_cash._hsbc_settlement_postings_have_valid_sequence_order(
            postings,
            order_source=source,
            order_record=record,
            order_account=record.get("account"),
            order_currency=record.get("currency"),
        ):
            for leg, statement_record in matches:
                consumed_statement_record_ids.discard(id(statement_record))
                role = _normalize_text(leg.get("role")) or "principal"
                if role in matched_role_counts:
                    matched_role_counts[role] -= 1
            continue
        postings.sort(key=_ii_hsbc_cash._hsbc_settlement_posting_sort_key)
        source["cash_settlement_postings"] = postings
        existing_sha256_values = source.get("statement_pdf_settlement_evidence_sha256")
        if isinstance(existing_sha256_values, list):
            statement_sha256_values.update(
                _normalize_text(value).lower()
                for value in existing_sha256_values
                if _normalize_text(value)
            )
        source["statement_pdf_settlement_evidence_sha256"] = sorted(
            statement_sha256_values
        )
        source["statement_pdf_settlement_match_count"] = len(postings)
        record["source"] = source
        enriched_transactions[record_index] = record

    retained_incoming = [
        record
        for record in incoming_transactions
        if id(record) not in consumed_statement_record_ids
    ]
    return (
        enriched_transactions,
        retained_incoming,
        {
            "total": len(consumed_statement_record_ids),
            "principal": matched_role_counts["principal"],
            "fee": matched_role_counts["fee"],
        },
    )


def _merge_grant_transactions(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
    *,
    superseded_tickers: set[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    superseded = {
        normalize_ticker(_normalize_text(ticker))
        for ticker in (superseded_tickers or set())
        if normalize_ticker(_normalize_text(ticker))
    }
    merged_by_key: dict[tuple[str, ...], dict[str, Any]] = {}
    duplicate_count = 0

    for record in existing_transactions:
        if _normalize_text(record.get("type")).lower() != "grant":
            continue
        ticker = (
            normalize_ticker(_normalize_text(record.get("ticker")))
            if record.get("ticker")
            else ""
        )
        if ticker and ticker in superseded:
            continue
        identity_key = _ii_merge_identity._grant_identity_key(record)
        if identity_key in merged_by_key:
            duplicate_count += 1
        merged_by_key[identity_key] = dict(record)

    for record in incoming_transactions:
        if _normalize_text(record.get("type")).lower() != "grant":
            continue
        identity_key = _ii_merge_identity._grant_identity_key(record)
        if identity_key in merged_by_key:
            duplicate_count += 1
        merged_by_key[identity_key] = dict(record)

    merged_transactions = list(merged_by_key.values())
    _ii_records._sort_transactions(merged_transactions)
    return merged_transactions, duplicate_count


def _payload_transactions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_transactions = payload.get("transactions")
    if not isinstance(raw_transactions, list):
        return []
    return [txn for txn in raw_transactions if isinstance(txn, dict)]


def _payload_generator(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    generator = payload.get("generator")
    return generator if isinstance(generator, dict) else {}


def _payload_order_source(payload: dict[str, Any] | None) -> str:
    return _normalize_text(_payload_generator(payload).get("order_source"))


def _is_longbridge_order_payload(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    order_source = _payload_order_source(payload)
    if broker == "longbridge_hk" and order_source in {
        "longbridge_history_orders",
        "longbridge_hk_history_orders_xlsx",
        "longbridge_hk_fund_details_contracts",
    }:
        return True
    return (
        broker == "longbridge_sg"
        and order_source == "longbridge_sg_history_orders_xlsx"
    )


def _is_hsbc_historical_statement_payload(payload: dict[str, Any] | None) -> bool:
    if (
        not isinstance(payload, dict)
        or _ii_basics._normalize_broker_code(payload.get("broker")) != "hsbc"
    ):
        return False
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return summary.get("historical_statement_backfill") is True


def _is_hsbc_usd_savings_csv_payload(payload: dict[str, Any] | None) -> bool:
    """Return whether an HSBC historical payload is an authoritative USD CSV calibration."""
    if (
        not isinstance(payload, dict)
        or _ii_basics._normalize_broker_code(payload.get("broker")) != "hsbc"
    ):
        return False
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    if (
        _normalize_text(summary.get("cash_snapshot_source"))
        == "hsbc_usd_savings_transaction_history_csv"
    ):
        return True
    if (
        _normalize_text(_payload_generator(payload).get("name"))
        == "hsbc_usd_savings_csv_to_investment_json"
    ):
        return True
    return any(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "hsbc_usd_savings_csv"
        for record in _payload_transactions(payload)
    )


def _is_hsbc_cash_only_paste_payload(payload: dict[str, Any] | None) -> bool:
    """Return whether an HSBC payload carries only a cash-account capture."""
    if (
        not isinstance(payload, dict)
        or _ii_basics._normalize_broker_code(payload.get("broker")) != "hsbc"
    ):
        return False
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return _normalize_text(summary.get("hsbc_paste_import_scope")).startswith(
        "cash_only_"
    )


def _hsbc_paste_import_scope(payload: dict[str, Any] | None) -> str:
    """Return the explicit or legacy-inferred live HSBC paste scope."""
    if (
        not isinstance(payload, dict)
        or _ii_basics._normalize_broker_code(payload.get("broker")) != "hsbc"
    ):
        return ""
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    scope = _normalize_text(summary.get("hsbc_paste_import_scope"))
    if scope in {"cash_only_non_usd", "cash_only_usd", "usd_composite"}:
        return scope
    generator_name = _normalize_text(_payload_generator(payload).get("name"))
    if generator_name == "hsbc_cash_account_pasted_text_to_investment_json":
        return "cash_only_non_usd"
    if generator_name == "hsbc_pasted_text_to_investment_json":
        return "usd_composite"
    return ""


def _is_hsbc_live_paste_payload(payload: dict[str, Any] | None) -> bool:
    """Return whether an HSBC payload is a current copy/paste capture."""
    return bool(_hsbc_paste_import_scope(payload))


def _is_bochk_statement_payload(payload: dict[str, Any] | None) -> bool:
    if (
        not isinstance(payload, dict)
        or _ii_basics._normalize_broker_code(payload.get("broker")) != "boc_hk"
    ):
        return False
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    if (
        _normalize_text(summary.get("cash_flow_transaction_source"))
        == "boc_hk_statement_pdf"
    ):
        return True
    return any(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "boc_hk_statement_pdf"
        for record in _payload_transactions(payload)
    )


def _bochk_statement_artifacts(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw_artifacts = payload.get("source_artifacts")
    if not isinstance(raw_artifacts, list):
        return []
    return [
        artifact
        for artifact in raw_artifacts
        if isinstance(artifact, dict)
        and _normalize_text(artifact.get("source_kind")) == "boc_hk_statement_pdf"
    ]


def _payload_contains_bochk_statement_component(payload: dict[str, Any] | None) -> bool:
    """Return whether a payload contains BOCHK data even when its broker is mixed."""
    if not isinstance(payload, dict):
        return False
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    if (
        _normalize_text(summary.get("cash_flow_transaction_source"))
        == "boc_hk_statement_pdf"
    ):
        return True
    raw_broker_summaries = payload.get("broker_summaries")
    bochk_summary = (
        raw_broker_summaries.get("boc_hk")
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get("boc_hk"), dict)
        else {}
    )
    if bochk_summary and (
        _normalize_text(bochk_summary.get("cash_flow_transaction_source"))
        == "boc_hk_statement_pdf"
        or _normalize_text(bochk_summary.get("cash_snapshot_source"))
        == "boc_hk_statement_balances"
        or "statement_periods" in bochk_summary
        or "bochk_subaccount_balances" in bochk_summary
    ):
        return True
    if _ii_basics._normalize_broker_code(payload.get("broker")) == "boc_hk" and (
        summary.get("historical_statement_backfill") is True
        or "bochk_subaccount_balances" in payload
    ):
        return True
    if _bochk_statement_artifacts(payload):
        return True
    return any(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "boc_hk_statement_pdf"
        for record in _payload_transactions(payload)
    )


def _bochk_statement_metadata_from_payload(
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    """Extract BOCHK metadata without depending on the payload's top-level broker."""
    if not isinstance(payload, dict):
        return {}
    raw_summary = (
        payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    )
    raw_broker_summaries = payload.get("broker_summaries")
    raw_broker_summary = (
        raw_broker_summaries.get("boc_hk")
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get("boc_hk"), dict)
        else {}
    )
    metadata: dict[str, Any] = {}
    for key in (
        "statement_periods",
        "statement_count",
        "statement_date_min",
        "statement_date_max",
        "duplicate_statement_row_count",
        "cash_flow_transaction_source",
        "cash_snapshot_source",
        "historical_statement_backfill",
        "bochk_subaccount_balances",
        "starting_cash_by_currency",
        "ending_cash_by_currency",
    ):
        if key in raw_broker_summary:
            metadata[key] = raw_broker_summary[key]
        if key in raw_summary:
            metadata[key] = raw_summary[key]
    for key in (
        "bochk_subaccount_balances",
        "starting_cash_by_currency",
        "ending_cash_by_currency",
    ):
        if key in payload:
            metadata[key] = payload[key]

    artifacts = _bochk_statement_artifacts(payload)
    periods: set[str] = set()
    for summary_source in (raw_broker_summary, raw_summary):
        raw_periods = summary_source.get("statement_periods")
        if isinstance(raw_periods, list):
            periods.update(
                _normalize_text(period)
                for period in raw_periods
                if _normalize_text(period)
            )
        elif _normalize_text(raw_periods):
            periods.add(_normalize_text(raw_periods))
    statement_dates: list[str] = []
    artifact_digests: set[str] = set()
    for artifact in artifacts:
        period = _normalize_text(artifact.get("statement_period"))
        period_end = _normalize_text(artifact.get("statement_period_end"))
        if period:
            periods.add(period)
        elif len(period_end) >= 7:
            periods.add(period_end[:7])
        if period_end:
            statement_dates.append(period_end)
        digest = _normalize_text(artifact.get("sha256"))
        if digest:
            artifact_digests.add(digest)
    if periods:
        metadata["statement_periods"] = sorted(periods)
    if artifact_digests:
        metadata["statement_count"] = len(artifact_digests)
    elif _normalize_text(metadata.get("statement_count")):
        try:
            metadata["statement_count"] = int(str(metadata["statement_count"]))
        except (TypeError, ValueError):
            metadata.pop("statement_count", None)
    if statement_dates:
        metadata["statement_date_min"] = min(statement_dates)
        metadata["statement_date_max"] = max(statement_dates)
    return metadata


def _payload_contains_hsbc_statement_component(payload: dict[str, Any] | None) -> bool:
    """Return whether a payload contains historical HSBC statement cash data."""
    if not isinstance(payload, dict):
        return False
    raw_summary = (
        payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    )
    raw_broker_summaries = payload.get("broker_summaries")
    hsbc_summary = (
        raw_broker_summaries.get("hsbc")
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get("hsbc"), dict)
        else {}
    )
    top_level_hsbc = _ii_basics._normalize_broker_code(payload.get("broker")) == "hsbc"
    if top_level_hsbc and not _is_hsbc_usd_savings_csv_payload(payload):
        if raw_summary.get("historical_statement_backfill") is True:
            return True
    if (
        _normalize_text(raw_summary.get("cash_flow_transaction_source"))
        == "hsbc_statement_cash"
    ):
        return True
    if (
        _normalize_text(raw_summary.get("cash_snapshot_source"))
        == "hsbc_statement_cash_balances"
    ):
        return True
    if hsbc_summary and (
        hsbc_summary.get("historical_statement_backfill") is True
        or _normalize_text(hsbc_summary.get("cash_flow_transaction_source"))
        == "hsbc_statement_cash"
        or _normalize_text(hsbc_summary.get("cash_snapshot_source"))
        == "hsbc_statement_cash_balances"
        or "statement_periods" in hsbc_summary
        or "statement_count" in hsbc_summary
    ):
        return True
    return any(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "hsbc_statement_cash"
        for record in _payload_transactions(payload)
    )


def _hsbc_statement_metadata_from_payload(
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    """Extract HSBC statement metadata without replacing live cash snapshots."""
    if not _payload_contains_hsbc_statement_component(payload):
        return {}
    raw_summary = (
        payload.get("summary")
        if isinstance(payload, dict) and isinstance(payload.get("summary"), dict)
        else {}
    )
    raw_broker_summaries = (
        payload.get("broker_summaries") if isinstance(payload, dict) else None
    )
    raw_broker_summary = (
        raw_broker_summaries.get("hsbc")
        if isinstance(raw_broker_summaries, dict)
        and isinstance(raw_broker_summaries.get("hsbc"), dict)
        else {}
    )
    metadata: dict[str, Any] = {}
    metadata_fields = (
        "statement_periods",
        "statement_count",
        "statement_pair_count",
        "composite_statement_count",
        "investment_statement_count",
        "statement_date_min",
        "statement_date_max",
        "transaction_date_min",
        "transaction_date_max",
        "duplicate_statement_row_count",
        "historical_statement_backfill",
    )
    for key in metadata_fields:
        if key in raw_broker_summary:
            metadata[key] = raw_broker_summary[key]
        if key in raw_summary:
            metadata[key] = raw_summary[key]

    generator = _payload_generator(payload)
    for key in (
        "statement_count",
        "statement_pair_count",
        "composite_statement_count",
        "investment_statement_count",
        "duplicate_statement_row_count",
    ):
        if key not in metadata and key in generator:
            metadata[key] = generator[key]

    periods: set[str] = set()
    for summary_source in (raw_broker_summary, raw_summary):
        raw_periods = summary_source.get("statement_periods")
        period_values = (
            raw_periods
            if isinstance(raw_periods, list)
            else re.split(",", _normalize_text(raw_periods))
        )
        periods.update(
            _normalize_text(period)
            for period in period_values
            if re.fullmatch(r"20\d{2}-\d{2}", _normalize_text(period))
        )
    generator_periods = re.split(
        ",", _normalize_text(generator.get("statement_period"))
    )
    periods.update(
        _normalize_text(period)
        for period in generator_periods
        if re.fullmatch(r"20\d{2}-\d{2}", _normalize_text(period))
    )

    statement_dates: list[str] = []
    transaction_dates: list[str] = []
    for field_name in ("statement_date_min", "statement_date_max"):
        value = _normalize_text(metadata.get(field_name))
        if value:
            statement_dates.append(value)
    for field_name in ("transaction_date_min", "transaction_date_max"):
        value = _normalize_text(metadata.get(field_name))
        if value:
            transaction_dates.append(value)
    for record in _payload_transactions(payload or {}):
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _normalize_text(source.get("file_kind")) != "hsbc_statement_cash":
            continue
        statement_period = _normalize_text(source.get("statement_period"))
        if re.fullmatch(r"20\d{2}-\d{2}", statement_period):
            periods.add(statement_period)
        statement_date = _normalize_text(source.get("statement_date"))
        if statement_date:
            statement_dates.append(statement_date)
        transaction_date = _normalize_text(record.get("date"))[:10]
        try:
            transaction_dates.append(date.fromisoformat(transaction_date).isoformat())
        except ValueError:
            continue

    if periods:
        metadata["statement_periods"] = sorted(periods)
    if not _normalize_text(metadata.get("statement_count")) and periods:
        metadata["statement_count"] = len(periods)
    if statement_dates:
        metadata["statement_date_min"] = min(statement_dates)
        metadata["statement_date_max"] = max(statement_dates)
    if transaction_dates:
        metadata["transaction_date_min"] = min(transaction_dates)
        metadata["transaction_date_max"] = max(transaction_dates)
    if metadata.get("historical_statement_backfill") is not True:
        metadata["historical_statement_backfill"] = True

    for key in (
        "statement_count",
        "statement_pair_count",
        "composite_statement_count",
        "investment_statement_count",
        "duplicate_statement_row_count",
    ):
        raw_value = metadata.get(key)
        if isinstance(raw_value, bool) or raw_value is None:
            metadata.pop(key, None)
            continue
        try:
            normalized_value = int(str(raw_value).strip())
        except (TypeError, ValueError):
            metadata.pop(key, None)
            continue
        if normalized_value < 0:
            metadata.pop(key, None)
        else:
            metadata[key] = normalized_value
    return metadata


def _is_legacy_longbridge_execution_trade(record: dict[str, Any]) -> bool:
    if _normalize_text(record.get("type")).lower() not in {"buy", "sell"}:
        return False
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _normalize_text(source.get("file_kind")) == "longbridge_history_executions"


def _transactions_for_merge(
    payload: dict[str, Any],
    *,
    prefer_longbridge_orders: bool,
) -> list[dict[str, Any]]:
    transactions = [dict(txn) for txn in _payload_transactions(payload)]
    payload_broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    payload_account = _normalize_text(payload.get("account"))
    for index, txn in enumerate(transactions):
        txn = _ii_merge_identity._canonicalize_forex_trade_component_currency(txn)
        transactions[index] = txn
        raw_broker = _normalize_text(txn.get("broker"))
        txn["broker"] = (
            _ii_basics._normalize_broker_code(raw_broker)
            if raw_broker
            else payload_broker
        )
        raw_acct = _normalize_text(txn.get("account"))
        txn["account"] = raw_acct or payload_account
        source = txn.get("source") if isinstance(txn.get("source"), dict) else {}
        source_copy = dict(source)
        raw_src_b = _normalize_text(source_copy.get("broker"))
        source_copy["broker"] = (
            _ii_basics._normalize_broker_code(raw_src_b) if raw_src_b else txn["broker"]
        )
        raw_src_a = _normalize_text(source_copy.get("account"))
        source_copy["account"] = raw_src_a or txn["account"]
        if (
            _ii_basics._normalize_broker_code(txn.get("broker")) == "hsbc"
            and _ii_merge_identity._is_hsbc_cash_account_source(source_copy)
            and not _normalize_text(source_copy.get("ledger_sequence"))
            and _normalize_text(source_copy.get("row_number"))
        ):
            source_copy["ledger_sequence"] = source_copy.get("row_number")
        txn["source"] = source_copy
    if not prefer_longbridge_orders:
        return transactions
    return [
        txn for txn in transactions if not _is_legacy_longbridge_execution_trade(txn)
    ]


def _stamp_payload_transaction_context(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    payload["transactions"] = _transactions_for_merge(
        payload, prefer_longbridge_orders=False
    )
    return payload
