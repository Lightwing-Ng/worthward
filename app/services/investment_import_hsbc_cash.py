"""Investment import domain: hsbc cash.

Code version: v0.6.0
- Fixed: HSBC stock-order settlement evidence is restricted to USD Savings,
  and a fee may precede or follow its principal in the bank chronology.
- Fixed: Every structured settlement posting requires its own canonical,
  finite broker balance instead of borrowing validity from another row.
- Fixed: Non-CSV settlement postings require producer-native row identity and
  must not claim the official CSV chronological sequence contract.
- Fixed: USD-only cash source kinds require USD Savings postings, while
  official CSV postings require explicit chronological ledger metadata.
- Fixed: Settlement posting groups now require exact owner, date, amount,
  source-reference, physical-row, and alias identity before any repair commits.
- Fixed: Cash settlement matching rejects principal and fee rows outside the
  order account, currency, cash subaccount, date, and immutable source domain.
- Added: Settlement postings retain their cash subaccount and sequence-domain
  identity for browser replay boundaries.
- Fixed: Re-imported pasted cash may restore missing posting provenance only
  after an exact cash-ledger identity match.
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Decimal,
    HSBC_CASH_ACCOUNT_FILE_KINDS,
    HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN,
    HSBC_TRADE_SETTLEMENT_REFERENCE_PATTERN,
    InvalidOperation,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    normalize_ticker,
    date,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_hsbc_core as _ii_hsbc_core

import app.services.investment_import_merge_identity as _ii_merge_identity


def _resolve_hsbc_cash_capture_ending_components(
    cash_capture: dict[str, Any],
) -> tuple[dict[str, Decimal], dict[str, str]]:
    """Prefer ledger, then posted-row, then available per-account balances."""
    available_components = cash_capture.get("available_balance_components")
    ending_components = cash_capture.get("ending_balance_components")
    ledger_components = cash_capture.get("ledger_balance_components")
    available_dates = cash_capture.get("available_component_post_dates")
    ending_dates = cash_capture.get("ending_component_post_dates")
    ledger_dates = cash_capture.get("ledger_component_post_dates")
    resolved_components = (
        dict(available_components) if isinstance(available_components, dict) else {}
    )
    resolved_dates = dict(available_dates) if isinstance(available_dates, dict) else {}
    for components, dates in (
        (ending_components, ending_dates),
        (ledger_components, ledger_dates),
    ):
        if not isinstance(components, dict):
            continue
        for component_key, amount in components.items():
            if isinstance(amount, Decimal):
                resolved_components[component_key] = amount
            if isinstance(dates, dict):
                component_date = _normalize_text(dates.get(component_key))
                if component_date:
                    resolved_dates[component_key] = component_date
    return resolved_components, resolved_dates


def _build_hsbc_cash_account_records_from_text_single(
    raw_text: str,
    *,
    warnings: list[str],
) -> tuple[str, Decimal, Decimal | None, list[dict[str, Any]]]:
    capture = _ii_hsbc_core._build_hsbc_cash_account_capture_from_text_single(
        raw_text, warnings=warnings
    )
    available_balance = capture["available_by_currency"].get("USD")
    ledger_balance = capture["ledger_by_currency"].get("USD")
    if available_balance is None:
        raise ValueError(
            "The pasted HSBC cash-account text must include the USD Savings balance."
        )
    records = capture["records"]
    if not records:
        raise ValueError(
            "No HSBC cash-account transactions could be parsed from the pasted text."
        )
    return capture["account_number"], available_balance, ledger_balance, records


def _hsbc_cash_record_identity_key(record: dict[str, Any]) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _normalize_text(source.get("account_number") or record.get("account")).upper(),
        _ii_merge_identity._normalize_hsbc_cash_account_type(
            record.get("currency"),
            source.get("account_type"),
        ),
        _normalize_text(record.get("date")),
        _normalize_text(record.get("type")).lower(),
        _normalize_text(record.get("currency")).upper(),
        _normalize_whitespace(record.get("description")),
        _normalize_text(record.get("net_amount_raw")),
        _normalize_text(source.get("balance_after_raw")),
        _normalize_text(source.get("reference_id")),
    )


def _parse_decimal_text_or_none(value: Any) -> Decimal | None:
    raw = _normalize_text(str(value) if value is not None else "")
    if not raw:
        return None
    try:
        return Decimal(raw.replace(",", ""))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _parse_hsbc_positive_sequence_number(value: Any) -> int | None:
    """Parse one finite, integral, positive immutable row identity."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or not normalized.isascii() or not normalized.isdecimal():
            return None
        if normalized.startswith("0"):
            return None
        try:
            parsed = int(normalized)
        except (OverflowError, ValueError):
            return None
        return parsed if parsed > 0 else None
    if not isinstance(value, (Decimal, float)):
        return None
    try:
        numeric = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, OverflowError, ValueError):
        return None
    if (
        not numeric.is_finite()
        or numeric <= ZERO
        or numeric != numeric.to_integral_value()
    ):
        return None
    try:
        return int(numeric)
    except (OverflowError, ValueError):
        return None


def _extract_hsbc_order_reference_from_cash_description(description: Any) -> str:
    normalized_description = _normalize_whitespace(description)
    if not normalized_description:
        return ""
    match = HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN.fullmatch(normalized_description)
    if not match:
        return ""
    return f"{match.group('prefix').upper()}-{match.group('order_number')}"


def _looks_like_hsbc_trade_settlement_reference(description: Any) -> bool:
    normalized_description = _normalize_whitespace(description)
    if not normalized_description:
        return False
    return bool(
        HSBC_TRADE_SETTLEMENT_REFERENCE_PATTERN.fullmatch(normalized_description)
    )


def _mark_hsbc_trade_settlement_history_hidden(
    cash_records: list[dict[str, Any]],
) -> None:
    records_by_date: dict[str, list[dict[str, Any]]] = {}
    for record in cash_records:
        if not isinstance(record, dict):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if not _ii_merge_identity._is_hsbc_cash_account_source(source):
            continue
        if not _looks_like_hsbc_trade_settlement_reference(record.get("description")):
            continue
        transaction_date = _normalize_text(record.get("date"))
        if not transaction_date:
            continue
        records_by_date.setdefault(transaction_date, []).append(record)

    for same_day_records in records_by_date.values():
        deposits = [
            record
            for record in same_day_records
            if _normalize_text(record.get("type")).lower() == "deposit"
        ]
        withdrawals = [
            record
            for record in same_day_records
            if _normalize_text(record.get("type")).lower() == "withdrawal"
        ]
        used_withdrawal_indexes: set[int] = set()
        for deposit in deposits:
            deposit_amount = _parse_decimal_text_or_none(deposit.get("net_amount_raw"))
            if deposit_amount is None or deposit_amount <= ZERO:
                continue
            deposit_source = (
                deposit.get("source") if isinstance(deposit.get("source"), dict) else {}
            )
            deposit_scope = (
                _normalize_text(
                    deposit_source.get("account_number") or deposit.get("account")
                ).upper(),
                _ii_merge_identity._normalize_hsbc_cash_account_type(
                    deposit.get("currency"),
                    deposit_source.get("account_type"),
                ),
                _ii_merge_identity._normalize_hsbc_currency_code(
                    deposit.get("currency")
                ),
                _normalize_text(deposit_source.get("file_kind")).lower(),
                _normalize_text(
                    deposit_source.get("source_sequence_sha256")
                    or deposit_source.get("source_file_sha256")
                ).lower(),
            )
            if not all(deposit_scope):
                continue
            best_match_index = -1
            best_match_diff: Decimal | None = None
            for withdrawal_index, withdrawal in enumerate(withdrawals):
                if withdrawal_index in used_withdrawal_indexes:
                    continue
                withdrawal_amount = _parse_decimal_text_or_none(
                    withdrawal.get("net_amount_raw")
                )
                if withdrawal_amount is None or withdrawal_amount >= ZERO:
                    continue
                withdrawal_source = (
                    withdrawal.get("source")
                    if isinstance(withdrawal.get("source"), dict)
                    else {}
                )
                withdrawal_scope = (
                    _normalize_text(
                        withdrawal_source.get("account_number")
                        or withdrawal.get("account")
                    ).upper(),
                    _ii_merge_identity._normalize_hsbc_cash_account_type(
                        withdrawal.get("currency"),
                        withdrawal_source.get("account_type"),
                    ),
                    _ii_merge_identity._normalize_hsbc_currency_code(
                        withdrawal.get("currency")
                    ),
                    _normalize_text(withdrawal_source.get("file_kind")).lower(),
                    _normalize_text(
                        withdrawal_source.get("source_sequence_sha256")
                        or withdrawal_source.get("source_file_sha256")
                    ).lower(),
                )
                if withdrawal_scope != deposit_scope:
                    continue
                withdrawal_balance = _parse_decimal_text_or_none(
                    withdrawal_source.get("balance_after_raw")
                )
                if withdrawal_balance is None or abs(withdrawal_balance) > Decimal(
                    "0.01"
                ):
                    continue
                magnitude = max(abs(deposit_amount), abs(withdrawal_amount))
                tolerance = max(Decimal("0.01"), magnitude * Decimal("0.02"))
                amount_diff = abs(abs(withdrawal_amount) - abs(deposit_amount))
                if amount_diff > tolerance:
                    continue
                if best_match_diff is None or amount_diff < best_match_diff:
                    best_match_index = withdrawal_index
                    best_match_diff = amount_diff
            if best_match_index < 0:
                continue
            counterpart = withdrawals[best_match_index]
            used_withdrawal_indexes.add(best_match_index)
            deposit["presentation_hidden"] = True
            deposit["presentation_hidden_reason"] = "hsbc_trade_settlement_pair"
            counterpart["presentation_hidden"] = True
            counterpart["presentation_hidden_reason"] = "hsbc_trade_settlement_pair"


def _hsbc_settlement_posting_sort_key(
    posting: dict[str, Any],
) -> tuple[str, int, int, int]:
    return (
        _normalize_text(posting.get("date")),
        _parse_hsbc_positive_sequence_number(posting.get("ledger_sequence")) or 0,
        _parse_hsbc_positive_sequence_number(posting.get("row_number")) or 0,
        0 if posting.get("role") == "principal" else 1,
    )


def _hsbc_settlement_postings_have_valid_role_sequence_order(
    postings: list[dict[str, Any]],
) -> bool:
    """Require one principal plus uniquely ordered fee postings."""
    participating = [posting for posting in postings if isinstance(posting, dict)]
    if len(participating) != len(postings):
        return False
    principal_postings = [
        posting
        for posting in participating
        if _normalize_text(posting.get("role")).lower() == "principal"
    ]
    if len(principal_postings) != 1:
        return False
    sequences = [
        _parse_hsbc_positive_sequence_number(posting.get("ledger_sequence"))
        for posting in participating
    ]
    if any(sequence is None for sequence in sequences):
        return False
    if len(set(sequences)) != len(sequences):
        return False
    return all(
        _normalize_text(posting.get("role")).lower() in {"principal", "fee"}
        for posting in participating
    )


def _hsbc_settlement_postings_have_valid_sequence_order(
    postings: list[dict[str, Any]],
    *,
    order_source: dict[str, Any] | None = None,
    order_record: dict[str, Any] | None = None,
    order_account: Any = "",
    order_currency: Any = "",
) -> bool:
    """Require valid role order inside one immutable HSBC cash domain."""
    if not _hsbc_settlement_postings_have_valid_role_sequence_order(postings):
        return False
    participating = [posting for posting in postings if isinstance(posting, dict)]
    domain_identities: list[tuple[str, ...]] = []
    physical_posting_identities: list[tuple[str, int]] = []
    expected_order_reference = _normalize_text(
        (order_source or {}).get("statement_order_id")
        or (order_source or {}).get("order_id")
    ).upper()
    expected_order_account = _normalize_text(
        order_account
        or (order_source or {}).get("account")
        or (order_source or {}).get("account_number")
    ).upper()
    expected_order_currency = _ii_merge_identity._normalize_hsbc_currency_code(
        order_currency or (order_source or {}).get("currency")
    )
    expected_order_date = _normalize_text((order_record or {}).get("date"))
    expected_order_type = _normalize_text((order_record or {}).get("type")).lower()
    expected_settlement_date = _normalize_text(
        (order_source or {}).get("cash_settlement_date")
    )
    expected_principal_amount = _parse_decimal_text_or_none(
        (order_source or {}).get("cash_settlement_amount_raw")
    )
    order_normalized = (
        (order_record or {}).get("normalized")
        if isinstance((order_record or {}).get("normalized"), dict)
        else {}
    )
    owner_net_values = [
        value
        for value in (
            (order_record or {}).get("net_amount_raw"),
            order_normalized.get("net_amount"),
        )
        if _normalize_text(value)
    ]
    owner_net_amounts = [
        _parse_decimal_text_or_none(value) for value in owner_net_values
    ]
    if order_source is not None:
        if (
            not isinstance(order_record, dict)
            or not expected_order_reference
            or not expected_order_date
            or expected_order_type not in {"buy", "sell"}
            or not expected_settlement_date
            or expected_principal_amount is None
            or not expected_principal_amount.is_finite()
            or expected_principal_amount == ZERO
            or not owner_net_amounts
            or any(
                amount is None or not amount.is_finite() for amount in owner_net_amounts
            )
            or len(set(owner_net_amounts)) != 1
            or any(
                amount is None
                or abs(amount - expected_principal_amount) > Decimal("0.01")
                for amount in owner_net_amounts
            )
        ):
            return False
        try:
            trade_date = date.fromisoformat(expected_order_date)
            settlement_date = date.fromisoformat(expected_settlement_date)
        except ValueError:
            return False
        if (
            trade_date.isoformat() != expected_order_date
            or settlement_date.isoformat() != expected_settlement_date
            or settlement_date < trade_date
        ):
            return False
    for posting in participating:
        currency = _ii_merge_identity._normalize_hsbc_currency_code(
            posting.get("currency")
        )
        digest_aliases = [
            _normalize_text(posting.get(field_name)).lower()
            for field_name in (
                "source_sequence_sha256",
                "source_file_sha256",
                "statement_pdf_source_sha256",
            )
            if _normalize_text(posting.get(field_name))
        ]
        if (
            not digest_aliases
            or len(set(digest_aliases)) != 1
            or any(
                len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
                for digest in digest_aliases
            )
        ):
            return False
        sequence_sha256 = digest_aliases[0]
        domain_identity = (
            _normalize_text(posting.get("account_number")).upper(),
            _ii_merge_identity._normalize_hsbc_cash_account_type(
                currency,
                posting.get("account_type"),
            ),
            currency,
            _normalize_text(posting.get("date")),
            _normalize_text(posting.get("source_file_kind")).lower(),
            sequence_sha256,
            _normalize_text(posting.get("ledger_sequence_order")).lower(),
        )
        row_number = _parse_hsbc_positive_sequence_number(posting.get("row_number"))
        ledger_sequence = _parse_hsbc_positive_sequence_number(
            posting.get("ledger_sequence")
        )
        statement_row_number_raw = posting.get("statement_pdf_source_row_number")
        statement_row_number = (
            _parse_hsbc_positive_sequence_number(statement_row_number_raw)
            if statement_row_number_raw not in (None, "")
            else None
        )
        amount = _parse_decimal_text_or_none(posting.get("amount_raw"))
        balance_raw = posting.get("balance_after_raw")
        balance_text = _normalize_text(balance_raw)
        balance = _parse_decimal_text_or_none(balance_text)
        role = _normalize_text(posting.get("role")).lower()
        if (
            not all(domain_identity[:6])
            or row_number is None
            or ledger_sequence is None
            or (
                statement_row_number_raw not in (None, "")
                and statement_row_number != row_number
            )
            or amount is None
            or not amount.is_finite()
            or amount == ZERO
            or (role == "fee" and amount >= ZERO)
            or not isinstance(balance_raw, str)
            or not balance_text
            or "," in balance_text
            or balance is None
            or not balance.is_finite()
        ):
            return False
        source_file_kind = domain_identity[4]
        sequence_order = domain_identity[6]
        try:
            posting_date = date.fromisoformat(domain_identity[3])
        except ValueError:
            return False
        if (
            posting_date.isoformat() != domain_identity[3]
            or source_file_kind not in HSBC_CASH_ACCOUNT_FILE_KINDS
            or domain_identity[1] not in {"CURRENT", "SAVINGS"}
        ):
            return False
        if source_file_kind in {
            "hsbc_usd_account_text",
            "hsbc_usd_savings_csv",
        } and (domain_identity[2] != "USD" or domain_identity[1] != "SAVINGS"):
            return False
        if source_file_kind == "hsbc_usd_savings_csv":
            if sequence_order != "chronological":
                return False
        elif sequence_order or ledger_sequence != row_number:
            return False
        if order_source is not None and (
            domain_identity[1] != "SAVINGS" or domain_identity[2] != "USD"
        ):
            return False
        if source_file_kind != "hsbc_statement_cash" and order_source is not None:
            posting_order_reference = (
                _extract_hsbc_order_reference_from_cash_description(
                    posting.get("reference")
                )
            )
            if (
                not expected_order_reference
                or posting_order_reference != expected_order_reference
            ):
                return False
        if order_source is not None and (
            not expected_order_account
            or not expected_order_currency
            or domain_identity[0] != expected_order_account
            or domain_identity[2] != expected_order_currency
            or domain_identity[3] != expected_settlement_date
        ):
            return False
        domain_identities.append(domain_identity)
        physical_posting_identities.append((sequence_sha256, row_number))
    if len(set(domain_identities)) != 1:
        return False
    if len(set(physical_posting_identities)) != len(physical_posting_identities):
        return False
    if order_source is not None:
        principal = next(
            posting
            for posting in participating
            if _normalize_text(posting.get("role")).lower() == "principal"
        )
        principal_amount = _parse_decimal_text_or_none(principal.get("amount_raw"))
        if (
            principal_amount != expected_principal_amount
            or (expected_order_type == "buy" and principal_amount >= ZERO)
            or (expected_order_type == "sell" and principal_amount <= ZERO)
        ):
            return False
    return True


def _build_hsbc_cash_settlement_posting(
    cash_record: dict[str, Any],
    *,
    role: str,
    fallback_currency: Any = "",
    fallback_account: Any = "",
) -> dict[str, Any] | None:
    """Project one immutable HSBC cash row into settlement evidence."""
    posting_amount = _parse_decimal_text_or_none(cash_record.get("net_amount_raw"))
    posting_date = _normalize_text(cash_record.get("date"))
    if posting_amount is None or not posting_date:
        return None
    posting_source = (
        cash_record.get("source") if isinstance(cash_record.get("source"), dict) else {}
    )
    posting_row_number = _parse_hsbc_positive_sequence_number(
        posting_source.get("row_number")
    )
    posting_sequence = _parse_hsbc_positive_sequence_number(
        posting_source.get("ledger_sequence", posting_row_number)
    )
    if posting_row_number is None or posting_sequence is None:
        return None
    posting = {
        "date": posting_date,
        "amount_raw": _decimal_to_str(posting_amount) or "0",
        "balance_after_raw": _normalize_text(posting_source.get("balance_after_raw")),
        "reference": _normalize_whitespace(cash_record.get("description")),
        "row_number": posting_row_number,
        "ledger_sequence": posting_sequence,
        "source_file_kind": _normalize_text(posting_source.get("file_kind")),
        "source_sequence_sha256": _normalize_text(
            posting_source.get("source_sequence_sha256")
        ).lower(),
        "account_number": _normalize_text(
            posting_source.get("account_number")
            or cash_record.get("account")
            or fallback_account
        ),
        "account_type": _normalize_text(posting_source.get("account_type")),
        "currency": _ii_merge_identity._normalize_hsbc_currency_code(
            cash_record.get("currency")
        )
        or _ii_merge_identity._normalize_hsbc_currency_code(fallback_currency),
        "role": _normalize_text(role) or "principal",
    }
    ledger_sequence_order = _normalize_text(
        posting_source.get("ledger_sequence_order")
    ).lower()
    if ledger_sequence_order:
        posting["ledger_sequence_order"] = ledger_sequence_order
    if _normalize_text(posting_source.get("source_format")) == "statement_pdf":
        statement_sha256 = _normalize_text(
            posting_source.get("source_file_sha256")
        ).lower()
        posting.update(
            {
                "statement_pdf_source_filename": _normalize_text(
                    posting_source.get("source_filename")
                ),
                "statement_pdf_source_sha256": statement_sha256,
                "statement_pdf_source_row_number": posting_row_number,
                "statement_pdf_statement_period": _normalize_text(
                    posting_source.get("statement_period")
                ),
            }
        )
    return posting


def _hsbc_settlement_posting_cash_identity(
    posting: dict[str, Any],
) -> tuple[Any, ...]:
    """Return the strict immutable cash identity required for provenance repair."""
    posting_date = _normalize_text(posting.get("date"))
    posting_amount = _parse_decimal_text_or_none(posting.get("amount_raw"))
    posting_balance = _parse_decimal_text_or_none(posting.get("balance_after_raw"))
    posting_reference = _normalize_whitespace(posting.get("reference"))
    posting_row_number = _parse_hsbc_positive_sequence_number(posting.get("row_number"))
    posting_sequence = _parse_hsbc_positive_sequence_number(
        posting.get("ledger_sequence", posting_row_number)
    )
    if posting_row_number is None or posting_sequence is None:
        return ()
    posting_file_kind = _normalize_text(posting.get("source_file_kind"))
    posting_currency = _ii_merge_identity._normalize_hsbc_currency_code(
        posting.get("currency")
    )
    posting_role = _normalize_text(posting.get("role")).lower()
    if (
        not posting_date
        or posting_amount is None
        or posting_balance is None
        or not posting_reference
        or not posting_file_kind
        or not posting_currency
        or posting_role not in {"principal", "fee"}
    ):
        return ()
    return (
        posting_date,
        posting_amount,
        posting_balance,
        posting_reference,
        posting_row_number,
        posting_sequence,
        posting_file_kind,
        posting_currency,
        posting_role,
    )


def _repair_hsbc_pasted_cash_settlement_posting_provenance(
    order_records: list[dict[str, Any]],
    cash_records: list[dict[str, Any]],
) -> int:
    """Restore only missing posting provenance from one exact pasted cash row."""
    candidates_by_role_and_identity: dict[
        tuple[str, tuple[Any, ...]], list[tuple[dict[str, Any], dict[str, Any]]]
    ] = {}
    for cash_record in cash_records:
        if not isinstance(cash_record, dict):
            continue
        cash_source = (
            cash_record.get("source")
            if isinstance(cash_record.get("source"), dict)
            else {}
        )
        if _normalize_text(cash_source.get("file_kind")) not in {
            "hsbc_usd_account_text",
            "hsbc_multi_currency_cash_account_text",
        }:
            continue
        sequence_sha256 = _normalize_text(
            cash_source.get("source_sequence_sha256")
        ).lower()
        account_number = _normalize_text(
            cash_source.get("account_number") or cash_record.get("account")
        )
        account_type = _normalize_text(cash_source.get("account_type"))
        if (
            len(sequence_sha256) != 64
            or any(character not in "0123456789abcdef" for character in sequence_sha256)
            or not account_number
            or not account_type
            or _normalize_whitespace(cash_source.get("reference_id"))
            != _normalize_whitespace(cash_record.get("description"))
        ):
            continue
        for role in ("principal", "fee"):
            candidate_posting = _build_hsbc_cash_settlement_posting(
                cash_record,
                role=role,
            )
            if candidate_posting is None:
                continue
            identity = _hsbc_settlement_posting_cash_identity(candidate_posting)
            if identity:
                candidates_by_role_and_identity.setdefault((role, identity), []).append(
                    (candidate_posting, cash_record)
                )

    repaired_count = 0
    for order_record in order_records:
        if not isinstance(order_record, dict):
            continue
        order_source = (
            order_record.get("source")
            if isinstance(order_record.get("source"), dict)
            else {}
        )
        raw_postings = order_source.get("cash_settlement_postings")
        if not isinstance(raw_postings, list) or not raw_postings:
            continue
        order_reference = _normalize_text(
            order_source.get("statement_order_id") or order_source.get("order_id")
        )
        order_account = _normalize_text(
            order_record.get("account")
            or order_source.get("account")
            or order_source.get("account_number")
        )
        if not order_reference or not order_account:
            continue
        postings = [
            dict(posting) if isinstance(posting, dict) else posting
            for posting in raw_postings
        ]
        if not _hsbc_settlement_postings_have_valid_role_sequence_order(postings):
            continue
        posting_identity_counts: dict[tuple[Any, ...], int] = {}
        for posting in postings:
            if not isinstance(posting, dict):
                continue
            identity = _hsbc_settlement_posting_cash_identity(posting)
            if identity:
                posting_identity_counts[identity] = (
                    posting_identity_counts.get(identity, 0) + 1
                )
        order_changed = False
        order_repaired_count = 0
        for posting in postings:
            if not isinstance(posting, dict):
                continue
            missing_fields = [
                field_name
                for field_name in (
                    "source_sequence_sha256",
                    "account_number",
                    "account_type",
                )
                if not _normalize_text(posting.get(field_name))
            ]
            if not missing_fields:
                continue
            identity = _hsbc_settlement_posting_cash_identity(posting)
            if not identity or posting_identity_counts.get(identity) != 1:
                continue
            role = _normalize_text(posting.get("role")).lower()
            matches = candidates_by_role_and_identity.get((role, identity), [])
            if len(matches) != 1:
                continue
            candidate_posting, candidate_record = matches[0]
            candidate_reference = _extract_hsbc_order_reference_from_cash_description(
                candidate_record.get("description")
            )
            if candidate_reference != order_reference:
                continue
            if candidate_posting.get("account_number") != order_account:
                continue
            if role == "principal":
                principal_amount = _parse_decimal_text_or_none(
                    order_source.get("cash_settlement_amount_raw")
                )
                if principal_amount is None or principal_amount != identity[1]:
                    continue
            else:
                fee_row_numbers = order_source.get("cash_flow_fee_row_numbers")
                if not isinstance(fee_row_numbers, list):
                    continue
                parsed_fee_rows = [
                    _parse_hsbc_positive_sequence_number(row_number)
                    for row_number in fee_row_numbers
                ]
                if not parsed_fee_rows or any(
                    row_number is None for row_number in parsed_fee_rows
                ):
                    continue
                normalized_fee_rows = set(parsed_fee_rows)
                if (
                    identity[1] >= ZERO
                    or abs(identity[1]) > Decimal("1.00")
                    or identity[4] not in normalized_fee_rows
                ):
                    continue
            conflicting_provenance = any(
                _normalize_text(posting.get(field_name))
                and (
                    _normalize_text(posting.get(field_name)).lower()
                    != _normalize_text(candidate_posting.get(field_name)).lower()
                )
                for field_name in (
                    "source_sequence_sha256",
                    "account_number",
                    "account_type",
                )
            )
            if conflicting_provenance:
                continue
            for field_name in missing_fields:
                posting[field_name] = candidate_posting[field_name]
            order_repaired_count += 1
            order_changed = True
        if order_changed and _hsbc_settlement_postings_have_valid_sequence_order(
            postings,
            order_source=order_source,
            order_record=order_record,
            order_account=order_account,
            order_currency=order_record.get("currency"),
        ):
            order_source["cash_settlement_postings"] = postings
            order_record["source"] = order_source
            repaired_count += order_repaired_count
    return repaired_count


def _finalize_hsbc_order_settlement_balance(
    order_source: dict[str, Any],
    *,
    order_record: dict[str, Any] | None = None,
) -> bool:
    """Set the order balance to the last chronological bank posting."""
    raw_postings = order_source.get("cash_settlement_postings")
    if not isinstance(raw_postings, list):
        return False
    postings = [posting for posting in raw_postings if isinstance(posting, dict)]
    if (
        len(postings) != len(raw_postings)
        or not postings
        or not _hsbc_settlement_postings_have_valid_sequence_order(
            postings,
            order_source=order_source,
            order_record=order_record,
            order_account=(order_record or {}).get("account"),
            order_currency=(order_record or {}).get("currency"),
        )
    ):
        return False
    postings.sort(key=_hsbc_settlement_posting_sort_key)
    order_source["cash_settlement_postings"] = postings
    final_posting = postings[-1]
    if not _normalize_text(final_posting.get("balance_after_raw")):
        return False
    final_balance = _normalize_text(final_posting.get("balance_after_raw"))
    existing_row_number = (
        _parse_hsbc_positive_sequence_number(
            order_source.get("cash_settlement_source_row_number")
        )
        or 0
    )
    final_row_number = _parse_hsbc_positive_sequence_number(
        final_posting.get("row_number")
    )
    if final_row_number is None:
        return False
    changed = (
        _normalize_text(order_source.get("cash_settlement_balance_after_raw"))
        != final_balance
        or existing_row_number != final_row_number
    )
    order_source["cash_settlement_balance_after_raw"] = final_balance
    order_source["cash_settlement_source_row_number"] = final_row_number
    return changed


def _match_hsbc_orders_to_cash_settlements(
    order_records: list[dict[str, Any]],
    cash_records: list[dict[str, Any]],
    warnings: list[str],
) -> None:
    cash_candidates_by_order_id: dict[str, list[dict[str, Any]]] = {}
    for cash_record in cash_records:
        if not isinstance(cash_record, dict):
            continue
        source = (
            cash_record.get("source")
            if isinstance(cash_record.get("source"), dict)
            else {}
        )
        if not _ii_merge_identity._is_hsbc_cash_account_source(source):
            continue
        order_reference = _extract_hsbc_order_reference_from_cash_description(
            cash_record.get("description")
        )
        if not order_reference:
            continue
        source["matched_cash_order_reference"] = order_reference
        cash_candidates_by_order_id.setdefault(order_reference, []).append(cash_record)

    used_cash_record_ids: set[int] = set()
    for order_record in order_records:
        if not isinstance(order_record, dict):
            continue
        order_source = (
            order_record.get("source")
            if isinstance(order_record.get("source"), dict)
            else {}
        )
        order_reference = _normalize_text(
            order_source.get("statement_order_id") or order_source.get("order_id")
        )
        if not order_reference:
            continue
        order_account = _normalize_text(
            order_record.get("account")
            or order_source.get("account")
            or order_source.get("account_number")
        ).upper()
        order_currency = _ii_merge_identity._normalize_hsbc_currency_code(
            order_record.get("currency")
        )
        order_date = _normalize_text(order_record.get("date"))
        if not order_account or order_currency != "USD" or not order_date:
            continue

        def cash_settlement_identity(
            cash_record: dict[str, Any],
        ) -> tuple[str, str, str, str, str, str] | None:
            cash_source = (
                cash_record.get("source")
                if isinstance(cash_record.get("source"), dict)
                else {}
            )
            identity = (
                _normalize_text(
                    cash_source.get("account_number") or cash_record.get("account")
                ).upper(),
                _ii_merge_identity._normalize_hsbc_cash_account_type(
                    cash_record.get("currency"),
                    cash_source.get("account_type"),
                ),
                _ii_merge_identity._normalize_hsbc_currency_code(
                    cash_record.get("currency")
                ),
                _normalize_text(cash_record.get("date")),
                _normalize_text(cash_source.get("file_kind")).lower(),
                _normalize_text(
                    cash_source.get("source_sequence_sha256")
                    or cash_source.get("source_file_sha256")
                ).lower(),
            )
            sequence_sha256 = identity[5]
            if (
                not all(identity)
                or len(sequence_sha256) != 64
                or any(
                    character not in "0123456789abcdef" for character in sequence_sha256
                )
                or not _normalize_whitespace(cash_record.get("description"))
                or identity[1] != "SAVINGS"
                or identity[2] != "USD"
            ):
                return None
            row_number = _parse_hsbc_positive_sequence_number(
                cash_source.get("row_number")
            )
            ledger_sequence = _parse_hsbc_positive_sequence_number(
                cash_source.get("ledger_sequence", row_number)
            )
            balance_raw = cash_source.get("balance_after_raw")
            balance_text = _normalize_text(balance_raw)
            balance = _parse_decimal_text_or_none(balance_text)
            if (
                row_number is None
                or ledger_sequence is None
                or not isinstance(balance_raw, str)
                or not balance_text
                or "," in balance_text
                or balance is None
                or not balance.is_finite()
            ):
                return None
            return identity

        candidates = [
            candidate
            for candidate in cash_candidates_by_order_id.get(order_reference, [])
            if id(candidate) not in used_cash_record_ids
            and (candidate_identity := cash_settlement_identity(candidate)) is not None
            and candidate_identity[0] == order_account
            and candidate_identity[2] == order_currency
            and candidate_identity[3] >= order_date
        ]
        if not candidates:
            continue
        expected_amount = _parse_decimal_text_or_none(
            order_record.get("net_amount_raw")
        )
        expected_sign = (
            -1 if _normalize_text(order_record.get("type")).lower() == "buy" else 1
        )
        best_candidate: dict[str, Any] | None = None
        best_candidate_diff: Decimal | None = None
        for candidate in candidates:
            candidate_amount = _parse_decimal_text_or_none(
                candidate.get("net_amount_raw")
            )
            if candidate_amount is None or candidate_amount == ZERO:
                continue
            if expected_sign < 0 and candidate_amount >= ZERO:
                continue
            if expected_sign > 0 and candidate_amount <= ZERO:
                continue
            amount_diff = (
                abs(candidate_amount - expected_amount)
                if expected_amount is not None
                else ZERO
            )
            if (
                best_candidate is None
                or best_candidate_diff is None
                or amount_diff < best_candidate_diff
            ):
                best_candidate = candidate
                best_candidate_diff = amount_diff
        if best_candidate is None:
            continue
        equally_best_candidates = []
        for candidate in candidates:
            candidate_amount = _parse_decimal_text_or_none(
                candidate.get("net_amount_raw")
            )
            if candidate_amount is None or candidate_amount == ZERO:
                continue
            if expected_sign < 0 and candidate_amount >= ZERO:
                continue
            if expected_sign > 0 and candidate_amount <= ZERO:
                continue
            amount_diff = (
                abs(candidate_amount - expected_amount)
                if expected_amount is not None
                else ZERO
            )
            if amount_diff == best_candidate_diff:
                equally_best_candidates.append(candidate)
        if len(equally_best_candidates) != 1:
            continue
        best_candidate = equally_best_candidates[0]
        best_candidate_identity = cash_settlement_identity(best_candidate)
        if best_candidate_identity is None:
            continue
        best_candidate_source = (
            best_candidate.get("source")
            if isinstance(best_candidate.get("source"), dict)
            else {}
        )
        if (
            _parse_decimal_text_or_none(best_candidate_source.get("balance_after_raw"))
            is None
        ):
            continue
        fee_candidates: list[dict[str, Any]] = []
        principal_sequence = int(
            best_candidate_source.get(
                "ledger_sequence",
                best_candidate_source.get("row_number", 0),
            )
            or 0
        )
        if expected_sign > 0:
            for candidate in candidates:
                if id(candidate) in used_cash_record_ids:
                    continue
                candidate_amount = _parse_decimal_text_or_none(
                    candidate.get("net_amount_raw")
                )
                if candidate_amount is None or candidate_amount >= ZERO:
                    continue
                if abs(candidate_amount) > Decimal("1.00"):
                    continue
                if cash_settlement_identity(candidate) != best_candidate_identity:
                    continue
                candidate_source = (
                    candidate.get("source")
                    if isinstance(candidate.get("source"), dict)
                    else {}
                )
                try:
                    candidate_sequence = int(
                        candidate_source.get(
                            "ledger_sequence",
                            candidate_source.get("row_number", 0),
                        )
                        or 0
                    )
                except (TypeError, ValueError):
                    continue
                if candidate_sequence == principal_sequence:
                    continue
                fee_candidates.append(candidate)
            fee_sequences = [
                int(
                    (candidate.get("source") or {}).get(
                        "ledger_sequence",
                        (candidate.get("source") or {}).get("row_number", 0),
                    )
                    or 0
                )
                for candidate in fee_candidates
            ]
            if (
                len(set(fee_sequences)) != len(fee_sequences)
                or len(fee_candidates) != 1
            ):
                continue
            used_cash_record_ids.add(id(best_candidate))
            for fee_candidate in fee_candidates:
                used_cash_record_ids.add(id(fee_candidate))
        else:
            used_cash_record_ids.add(id(best_candidate))
        candidate_source = (
            best_candidate.get("source")
            if isinstance(best_candidate.get("source"), dict)
            else {}
        )
        candidate_amount = _parse_decimal_text_or_none(
            best_candidate.get("net_amount_raw")
        )
        candidate_date = _normalize_text(best_candidate.get("date"))
        candidate_reference = _normalize_whitespace(best_candidate.get("description"))
        candidate_balance_after = _normalize_text(
            candidate_source.get("balance_after_raw")
        )
        if candidate_amount is not None:
            candidate_amount_text = _decimal_to_str(candidate_amount) or ""
            order_record["net_amount_raw"] = candidate_amount_text
            normalized = (
                order_record.get("normalized")
                if isinstance(order_record.get("normalized"), dict)
                else {}
            )
            normalized["net_amount"] = candidate_amount_text
            normalized["accounting_adjustment_amount"] = candidate_amount_text
            order_record["normalized"] = normalized
            order_source["cash_settlement_amount_raw"] = candidate_amount_text
        if candidate_date:
            order_source["cash_settlement_date"] = candidate_date
        order_source["cash_settlement_reference"] = candidate_reference
        order_source["cash_settlement_balance_after_raw"] = candidate_balance_after
        order_source["cash_settlement_source_row_number"] = int(
            candidate_source.get("row_number", 0)
        )
        best_candidate["presentation_hidden"] = True
        best_candidate["presentation_hidden_reason"] = (
            "hsbc_order_cash_settlement_matched"
        )
        best_candidate["exclude_from_holdings_replay"] = True
        total_fee_abs = sum(
            abs(_parse_decimal_text_or_none(candidate.get("net_amount_raw")) or ZERO)
            for candidate in fee_candidates
        )
        if total_fee_abs > ZERO:
            commission_dec = -total_fee_abs
            commission_text = _decimal_to_str(commission_dec) or "0"
            order_record["commission_raw"] = commission_text
            normalized = (
                order_record.get("normalized")
                if isinstance(order_record.get("normalized"), dict)
                else {}
            )
            normalized["commission"] = commission_text
            normalized["commission_display"] = _decimal_to_str(total_fee_abs) or "0"
            order_record["normalized"] = normalized
            order_source["cash_flow_fee_amount_raw"] = (
                _decimal_to_str(total_fee_abs) or "0"
            )
            order_source["cash_flow_fee_row_numbers"] = [
                int((candidate.get("source") or {}).get("row_number", 0))
                for candidate in fee_candidates
            ]
            for fee_candidate in fee_candidates:
                fee_candidate["presentation_hidden"] = True
                fee_candidate["presentation_hidden_reason"] = (
                    "hsbc_order_cash_settlement_fee_matched"
                )
                fee_candidate["exclude_from_holdings_replay"] = True

        # Keep the broker-native cash legs as immutable settlement evidence.
        # A sell can have its principal and SEC fee separated by another
        # order's cash posting, so an order-level final balance alone cannot
        # reproduce the statement sequence safely.
        settlement_postings: list[dict[str, Any]] = []
        for posting_candidate, role in [
            (best_candidate, "principal"),
            *((fee_candidate, "fee") for fee_candidate in fee_candidates),
        ]:
            posting = _build_hsbc_cash_settlement_posting(
                posting_candidate,
                role=role,
                fallback_currency=order_record.get("currency"),
                fallback_account=order_record.get("account"),
            )
            if posting is not None:
                settlement_postings.append(posting)
        if settlement_postings:
            order_source["cash_settlement_postings"] = settlement_postings
            _finalize_hsbc_order_settlement_balance(
                order_source,
                order_record=order_record,
            )
        _reconcile_hsbc_order_execution_price_from_cash_settlement(
            order_record,
            settlement_amount=candidate_amount or ZERO,
            settlement_date=candidate_date,
            settlement_source=candidate_source,
        )
        _annotate_hsbc_order_settlement_adjustment(order_record)
        if expected_amount is not None and candidate_amount is not None:
            amount_diff = abs(candidate_amount - expected_amount)
            if amount_diff > Decimal("0.01"):
                warnings.append(
                    "HSBC order "
                    f"{order_reference}: Order Status amount {(_decimal_to_str(expected_amount) or '')!r} "
                    f"did not match cash settlement {(_decimal_to_str(candidate_amount) or '')!r}; "
                    "cash ledger replay now follows the settlement amount."
                )


def _mark_unsettled_hsbc_order_cash_replay_pending(
    order_records: list[dict[str, Any]],
    cash_records: list[dict[str, Any]],
) -> None:
    visible_cash_dates = [
        _normalize_text(record.get("date"))
        for record in cash_records
        if isinstance(record, dict) and _normalize_text(record.get("date"))
    ]
    visible_cash_window_start = min(visible_cash_dates, default="")
    matched_order_dates = [
        _normalize_text(order_record.get("date"))
        for order_record in order_records
        if isinstance(order_record, dict)
        and _normalize_text(
            (order_record.get("source") or {}).get("cash_settlement_amount_raw")
        )
        and _normalize_text(order_record.get("date"))
    ]
    matched_order_window_start = min(matched_order_dates, default="")
    for order_record in order_records:
        if not isinstance(order_record, dict):
            continue
        source = (
            order_record.get("source")
            if isinstance(order_record.get("source"), dict)
            else {}
        )
        if _normalize_text(source.get("cash_settlement_amount_raw")):
            source.pop("cash_replay_pending_settlement", None)
            source.pop("cash_settlement_match_status", None)
            order_record["source"] = source
            continue
        order_date = _normalize_text(order_record.get("date"))
        outside_visible_window = (
            bool(matched_order_window_start)
            and order_date <= matched_order_window_start
        ) or (
            not matched_order_window_start
            and bool(visible_cash_window_start)
            and order_date < visible_cash_window_start
        )
        if outside_visible_window:
            source.pop("cash_replay_pending_settlement", None)
            source["cash_settlement_match_status"] = "outside_visible_cash_window"
            order_record["source"] = source
            continue
        source.pop("cash_settlement_match_status", None)
        source["cash_replay_pending_settlement"] = True
        order_record["source"] = source


def _build_hsbc_cash_account_records_from_text(
    raw_text: str,
    *,
    warnings: list[str],
) -> tuple[str, Decimal, Decimal | None, list[dict[str, Any]]]:
    capture = _ii_hsbc_core._build_hsbc_cash_account_capture_from_text(
        raw_text, warnings=warnings
    )
    available_balance = capture["available_by_currency"].get("USD")
    if available_balance is None:
        raise ValueError(
            "The pasted HSBC cash-account text must include the USD Savings balance."
        )
    cash_records = capture["records"]
    if not cash_records:
        raise ValueError(
            "No HSBC cash-account transactions could be parsed from the pasted text."
        )
    return (
        capture["account_number"],
        available_balance,
        capture["ledger_by_currency"].get("USD"),
        cash_records,
    )


def _annotate_hsbc_available_cash_after(
    transactions: list[dict[str, Any]],
    available_balance: Decimal,
) -> None:
    settlement_dates = [
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("cash_settlement_date")
        )
        for record in transactions
        if isinstance(record, dict)
    ]
    window_start_date = max((value for value in settlement_dates if value), default="")
    eligible_records = []
    for record in transactions:
        if not isinstance(record, dict):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _ii_basics._normalize_broker_code(
            record.get("broker") or source.get("broker")
        ) not in {"", "hsbc"}:
            continue
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(record.get("currency"))
            != "USD"
        ):
            continue
        if _normalize_text(source.get("cash_settlement_balance_after_raw")):
            continue
        if source.get("cash_replay_pending_settlement") is True:
            continue
        if (
            window_start_date
            and _normalize_text(record.get("date")) < window_start_date
        ):
            continue
        eligible_records.append(record)
    calibration_source = "hsbc_usd_savings_available_balance"
    if not eligible_records:
        return
    available_after = available_balance
    for record in reversed(eligible_records):
        if not isinstance(record, dict):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _normalize_text(source.get("cash_settlement_balance_after_raw")):
            continue
        if (
            _ii_merge_identity._normalize_hsbc_currency_code(record.get("currency"))
            != "USD"
        ):
            continue
        if source.get("cash_replay_pending_settlement") is True:
            continue
        source["available_cash_after_raw"] = _decimal_to_str(available_after) or "0"
        source["available_cash_calibration_source"] = calibration_source
        record["source"] = source
        cash_delta = _parse_decimal_text_or_none(record.get("net_amount_raw")) or ZERO
        available_after -= cash_delta


def _prune_stale_hsbc_available_cash_annotations(
    transactions: list[dict[str, Any]],
) -> None:
    settlement_dates = [
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("cash_settlement_date")
        )
        for record in transactions
        if isinstance(record, dict)
    ]
    window_start_date = max((value for value in settlement_dates if value), default="")
    if not window_start_date:
        return
    for record in transactions:
        if not isinstance(record, dict):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if (
            _ii_basics._normalize_broker_code(
                record.get("broker") or source.get("broker")
            )
            != "hsbc"
        ):
            continue
        if source.get("cash_replay_pending_settlement") is True:
            source.pop("available_cash_after_raw", None)
            source.pop("available_cash_calibration_source", None)
            record["source"] = source
            continue
        should_prune = _normalize_text(record.get("date")) < window_start_date or bool(
            _normalize_text(source.get("cash_settlement_balance_after_raw"))
        )
        if should_prune:
            source.pop("available_cash_after_raw", None)
            source.pop("available_cash_calibration_source", None)
            record["source"] = source


def _summarize_hsbc_pending_settlement_cash(
    transactions: list[dict[str, Any]],
    available_balance: Decimal,
    *,
    broker_cash_balance: Decimal | None = None,
) -> dict[str, Any]:
    pending_records = [
        record
        for record in transactions
        if isinstance(record, dict)
        and isinstance(record.get("source"), dict)
        and record["source"].get("cash_replay_pending_settlement") is True
    ]
    pending_cash_raw = sum(
        _parse_decimal_text_or_none(record.get("net_amount_raw")) or ZERO
        for record in pending_records
    )
    pending_fee = sum(
        abs(
            _parse_decimal_text_or_none(
                (
                    record.get("source")
                    if isinstance(record.get("source"), dict)
                    else {}
                ).get("cash_replay_pending_settlement_fee_amount_raw")
            )
            or ZERO
        )
        for record in pending_records
    )
    # Pending sell clearing fees are not yet cash-settled. Keep any source
    # amount as unapplied evidence, but do not reduce the current display
    # balance until a later settled cash posting confirms the deduction.
    pending_cash = pending_cash_raw
    display_balance = (
        broker_cash_balance if broker_cash_balance is not None else available_balance
    )
    broker_cash = display_balance + pending_cash
    return {
        "hsbc_bank_available_cash": _decimal_to_str(available_balance) or "0",
        "hsbc_pending_settlement_cash_raw": _decimal_to_str(pending_cash_raw) or "0",
        "hsbc_pending_settlement_fee_adjustment": "0.000",
        "hsbc_pending_settlement_fee_unapplied": _decimal_to_str(pending_fee)
        or "0.000",
        "hsbc_pending_settlement_fee_policy": "exclude_unposted_until_settled_cash_posting",
        "hsbc_pending_settlement_cash": _decimal_to_str(pending_cash) or "0",
        "hsbc_broker_cash_estimate": _decimal_to_str(broker_cash) or "0",
        "hsbc_pending_settlement_order_count": len(pending_records),
        "hsbc_cash_display_convention": (
            "The posted USD Savings ledger balance is the current cash boundary; "
            "the signed net amount of visible unsettled buy and sell orders is applied "
            "exactly once for the current display estimate. The bank's available "
            "balance remains separate audit evidence. Unposted source-labelled "
            "settlement fees are not deducted until settled cash confirms them."
        ),
    }


def _calibrate_hsbc_order_prices_from_portfolio(
    order_records: list[dict[str, Any]],
    position_snapshot: dict[str, dict[str, str]],
) -> int:
    records_by_ticker: dict[str, list[dict[str, Any]]] = {}
    for record in order_records:
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        if ticker:
            records_by_ticker.setdefault(ticker, []).append(record)

    calibrated_count = 0
    for ticker, ticker_records in records_by_ticker.items():
        if len(ticker_records) != 1:
            continue
        record = ticker_records[0]
        if _normalize_text(record.get("type")).lower() != "buy":
            continue
        snapshot = position_snapshot.get(ticker)
        if not isinstance(snapshot, dict):
            continue
        quantity_dec = _parse_decimal_text_or_none(record.get("quantity_abs"))
        snapshot_quantity_dec = _parse_decimal_text_or_none(snapshot.get("quantity"))
        portfolio_price_dec = _parse_decimal_text_or_none(snapshot.get("cost_price"))
        order_price_dec = _parse_decimal_text_or_none(record.get("price_raw"))
        if (
            quantity_dec is None
            or snapshot_quantity_dec is None
            or portfolio_price_dec is None
            or order_price_dec is None
            or quantity_dec <= ZERO
            or portfolio_price_dec <= ZERO
            or quantity_dec != snapshot_quantity_dec
            or order_price_dec == portfolio_price_dec
        ):
            continue

        signed_amount_dec = -quantity_dec * portfolio_price_dec
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        source.update(
            {
                "order_status_limit_price_raw": _decimal_to_str(order_price_dec) or "",
                "execution_price_raw": _decimal_to_str(portfolio_price_dec) or "",
                "execution_price_provisional_raw": _decimal_to_str(portfolio_price_dec)
                or "",
                "execution_price_provisional_source": "hsbc_portfolio_average_purchase_price",
                "execution_price_source": "hsbc_portfolio_average_purchase_price",
                "execution_price_status": "provisional_pending_settlement",
                "execution_price_calibration_status": "calibrated_current_position",
                "execution_price_calibration_reason": (
                    "One visible fully executed buy order matches the authoritative current "
                    "Portfolio quantity for this ticker; the price remains provisional until "
                    "the USD Savings cash settlement is visible."
                ),
            }
        )
        record["source"] = source
        record["price_raw"] = _decimal_to_str(portfolio_price_dec) or ""
        record["gross_amount_raw"] = _decimal_to_str(signed_amount_dec) or ""
        record["net_amount_raw"] = _decimal_to_str(signed_amount_dec) or ""
        record["normalized"] = _build_normalized_view(
            "buy",
            quantity_dec,
            portfolio_price_dec,
            signed_amount_dec,
            ZERO,
            signed_amount_dec,
        )
        calibrated_count += 1
    return calibrated_count


def _reconcile_hsbc_order_execution_price_from_cash_settlement(
    order_record: dict[str, Any],
    *,
    settlement_amount: Decimal,
    settlement_date: str,
    settlement_source: dict[str, Any],
) -> bool:
    quantity_dec = _parse_decimal_text_or_none(order_record.get("quantity_abs"))
    if quantity_dec is None or quantity_dec <= ZERO or settlement_amount == ZERO:
        return False

    side = _normalize_text(order_record.get("type")).lower()
    if side not in {"buy", "sell"}:
        return False
    commission_dec = (
        _parse_decimal_text_or_none(order_record.get("commission_raw")) or ZERO
    )
    signed_gross_dec = settlement_amount - commission_dec
    expected_sign = -1 if side == "buy" else 1
    if (expected_sign < 0 and signed_gross_dec >= ZERO) or (
        expected_sign > 0 and signed_gross_dec <= ZERO
    ):
        return False
    final_price_dec = abs(signed_gross_dec) / quantity_dec
    if final_price_dec <= ZERO:
        return False

    source = (
        order_record.get("source")
        if isinstance(order_record.get("source"), dict)
        else {}
    )
    previous_price_raw = _normalize_text(
        source.get("execution_price_raw")
    ) or _normalize_text(order_record.get("price_raw"))
    previous_price_dec = _parse_decimal_text_or_none(previous_price_raw)
    if previous_price_dec is not None:
        previous_price_quantum = Decimal(1).scaleb(
            previous_price_dec.as_tuple().exponent
        )
        price_quantum = min(previous_price_quantum, Decimal("0.001"))
        final_price_dec = final_price_dec.quantize(price_quantum)
        signed_gross_dec = (
            -final_price_dec * quantity_dec
            if side == "buy"
            else final_price_dec * quantity_dec
        )
    if previous_price_raw:
        source.setdefault("execution_price_provisional_raw", previous_price_raw)
    source.setdefault(
        "execution_price_provisional_source",
        _normalize_text(source.get("execution_price_source"))
        or "hsbc_order_status_price",
    )
    source["execution_price_previous_calibration_status"] = _normalize_text(
        source.get("execution_price_calibration_status")
    )
    final_price_raw = _decimal_to_str(final_price_dec) or ""
    settlement_amount_raw = _decimal_to_str(settlement_amount) or ""
    source.update(
        {
            "execution_price_raw": final_price_raw,
            "execution_price_final_raw": final_price_raw,
            "execution_price_source": "hsbc_cash_settlement_amount",
            "execution_price_status": "final_settled",
            "execution_price_calibration_status": "settled_cash_reconciled",
            "execution_price_settlement_amount_raw": settlement_amount_raw,
            "execution_price_settlement_date": settlement_date,
            "execution_price_settlement_source_row_number": int(
                settlement_source.get("row_number", 0) or 0
            ),
            "execution_price_reconciliation_reason": (
                "The settled USD Savings cash flow supersedes the provisional Portfolio "
                "average purchase price for this order."
            ),
        }
    )
    order_record["source"] = source
    order_record["price_raw"] = final_price_raw
    order_record["gross_amount_raw"] = _decimal_to_str(signed_gross_dec) or ""
    order_record["normalized"] = _build_normalized_view(
        side,
        quantity_dec,
        final_price_dec,
        signed_gross_dec,
        commission_dec,
        settlement_amount,
    )
    return True


def _annotate_hsbc_order_settlement_adjustment(
    order_record: dict[str, Any],
) -> bool:
    """Expose an evidenced HSBC settlement residual without changing cash."""
    source = (
        order_record.get("source")
        if isinstance(order_record.get("source"), dict)
        else {}
    )
    broker = _ii_basics._normalize_broker_code(
        order_record.get("broker") or source.get("broker")
    )
    side = _normalize_text(order_record.get("type")).lower()
    settlement_amount = _parse_decimal_text_or_none(
        source.get("cash_settlement_amount_raw")
    )
    gross_amount = _parse_decimal_text_or_none(order_record.get("gross_amount_raw"))
    commission = _parse_decimal_text_or_none(order_record.get("commission_raw"))
    if (
        broker != "hsbc"
        or side not in {"buy", "sell"}
        or settlement_amount is None
        or gross_amount is None
        or commission is None
    ):
        return False

    component_total = gross_amount + commission
    adjustment = settlement_amount - component_total
    component_total_raw = _decimal_to_str(component_total.normalize()) or "0"
    source["settlement_component_total_raw"] = component_total_raw
    source["settlement_adjustment_calculation"] = (
        "cash_settlement_amount_raw - (gross_amount_raw + commission_raw)"
    )
    normalized = (
        order_record.get("normalized")
        if isinstance(order_record.get("normalized"), dict)
        else {}
    )
    normalized["settlement_component_total"] = component_total_raw

    if adjustment == ZERO:
        order_record.pop("settlement_adjustment_raw", None)
        source.pop("settlement_adjustment_raw", None)
        source.pop("settlement_adjustment_classification", None)
        normalized.pop("settlement_adjustment", None)
        order_record["source"] = source
        order_record["normalized"] = normalized
        return False

    adjustment_raw = _decimal_to_str(adjustment.normalize()) or "0"
    order_record["settlement_adjustment_raw"] = adjustment_raw
    source["settlement_adjustment_raw"] = adjustment_raw
    source["settlement_adjustment_classification"] = (
        "unclassified_broker_settlement_difference"
    )
    normalized["settlement_adjustment"] = adjustment_raw
    order_record["source"] = source
    order_record["normalized"] = normalized
    return True
