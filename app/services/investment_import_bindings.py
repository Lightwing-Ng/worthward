"""Investment import domain: bindings.

Code version: v0.2.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Counter,
    Decimal,
    HSBC_CORPORATE_EVENT_PAYMENT_PREFIX,
    HSBC_STATEMENT_MONTHS,
    IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND,
    InvalidOperation,
    ZERO,
    _INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS,
    _INVESTMENT_INTERNAL_TRANSFER_DATE_PATTERN,
    _INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS,
    _normalize_text,
    _normalize_whitespace,
    canonicalize_investment_ticker,
    date,
    deepcopy,
    defaultdict,
    json,
    normalize_ticker,
    timedelta,
)

import app.services.investment_import_artifacts as _ii_artifacts

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_bochk as _ii_bochk

import app.services.investment_import_futuhk as _ii_futuhk

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries

import app.services.investment_import_records as _ii_records

import app.services.investment_import_schwab as _ii_schwab

from app.services import investment_import_compat as _investment_import_compat


def normalize_investment_payload_tickers(payload: dict[str, Any]) -> dict[str, Any]:
    payload_broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    is_hsbc_payload = payload_broker == "hsbc"
    is_bochk_payload = payload_broker == "boc_hk"
    transactions = payload.get("transactions")
    if isinstance(transactions, list):
        for txn in transactions:
            if not isinstance(txn, dict):
                continue
            _ii_merge_identity._prune_ibkr_authoritative_source_metadata(txn)
            source = txn.get("source") if isinstance(txn.get("source"), dict) else {}
            record_broker = _ii_basics._normalize_broker_code(
                txn.get("broker") or source.get("broker")
            )
            if (
                payload_broker == "schwab"
                or record_broker == "schwab"
                or _normalize_text(source.get("file_kind")) == "schwab_csv"
            ):
                _ii_schwab._canonicalize_schwab_legacy_transaction_type(txn)
            is_bochk_record = (
                record_broker == "boc_hk"
                or _normalize_text(source.get("file_kind")) == "boc_hk_statement_pdf"
            )
            if is_hsbc_payload or record_broker == "hsbc":
                raw_currency = _normalize_text(txn.get("currency")).upper()
                normalized_currency = _ii_merge_identity._normalize_hsbc_currency_code(
                    raw_currency
                )
                if normalized_currency:
                    txn["currency"] = normalized_currency
                    if raw_currency in {"CNY", "RMB"}:
                        source.setdefault("statement_currency_raw", raw_currency)
                        txn["source"] = source
            elif is_bochk_record:
                raw_currency = _normalize_text(
                    txn.get("currency") or source.get("statement_currency_raw")
                ).upper()
                normalized_currency = _ii_bochk._normalize_bochk_currency_code(
                    raw_currency
                )
                if normalized_currency:
                    txn["currency"] = normalized_currency
                    if raw_currency in {"CNY", "RMB"}:
                        source.setdefault("statement_currency_raw", raw_currency)
                    txn["source"] = source
            raw_ticker = txn.get("ticker")
            if raw_ticker:
                txn["ticker"] = canonicalize_investment_ticker(str(raw_ticker))
            description = _ii_basics._normalize_standard_transaction_description(
                txn.get("description"),
                transaction_type=txn.get("type"),
                source=source,
            )
            if description:
                txn["description"] = description
            if is_hsbc_payload or record_broker == "hsbc":
                attribution_evidence = bool(
                    _normalize_text(source.get("dividend_attribution_status"))
                    or _normalize_text(source.get("dividend_attribution_method"))
                    or _normalize_text(source.get("corporate_action_reference"))
                )
                cash_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                    txn.get("net_amount_raw")
                )
                if (
                    _normalize_text(txn.get("type")).lower() == "deposit"
                    and normalize_ticker(_normalize_text(txn.get("ticker")))
                    and description.upper().startswith(
                        HSBC_CORPORATE_EVENT_PAYMENT_PREFIX
                    )
                    and attribution_evidence
                    and cash_amount is not None
                    and cash_amount > ZERO
                ):
                    txn["type"] = "dividend"
                    source["dividend_classification_repaired_after_import"] = True
                    source["dividend_classification_repair_basis"] = (
                        "attributed_positive_hsbc_corporate_event_payment"
                    )
                    txn["source"] = source
            if description.startswith("Bonus shares (赠股): "):
                bonus_ticker = description.removeprefix("Bonus shares (赠股): ").strip()
                txn["description"] = (
                    f"Bonus shares (赠股): {canonicalize_investment_ticker(bonus_ticker)}"
                )
            elif description.endswith(".HK"):
                txn["description"] = canonicalize_investment_ticker(description)
            _ii_futuhk._stamp_futuhk_internal_transfer_metadata(txn)
            if is_hsbc_payload or record_broker == "hsbc":
                settlement_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                    source.get("cash_settlement_amount_raw")
                )
                if (
                    _normalize_text(txn.get("type")).lower() in {"buy", "sell"}
                    and settlement_amount is not None
                ):
                    _ii_hsbc_cash._reconcile_hsbc_order_execution_price_from_cash_settlement(
                        txn,
                        settlement_amount=settlement_amount,
                        settlement_date=_normalize_text(
                            source.get("cash_settlement_date")
                        ),
                        settlement_source=source,
                    )
                _ii_hsbc_cash._annotate_hsbc_order_settlement_adjustment(txn)

    payload["position_snapshot"] = _ii_artifacts._normalize_snapshot_keys(
        payload.get("position_snapshot")
    )
    payload["performance_snapshot"] = _ii_artifacts._normalize_snapshot_keys(
        payload.get("performance_snapshot")
    )
    payload["source_artifacts"] = _ii_artifacts._normalize_source_artifacts(
        payload.get("source_artifacts")
    )

    if is_hsbc_payload or is_bochk_payload:
        normalize_balance_map = (
            _ii_merge_identity._normalize_hsbc_currency_balance_map
            if is_hsbc_payload
            else _ii_merge_identity._normalize_bochk_currency_balance_map
        )
        for field_name in ("starting_cash_by_currency", "ending_cash_by_currency"):
            if field_name in payload:
                payload[field_name] = normalize_balance_map(payload.get(field_name))

    if "bochk_subaccount_balances" in payload:
        payload["bochk_subaccount_balances"] = (
            _ii_merge_identity._normalize_bochk_subaccount_balance_map(
                payload.get("bochk_subaccount_balances")
            )
        )

    summary = payload.get("summary")
    if isinstance(summary, dict):
        if is_hsbc_payload:
            for field_name in ("starting_cash_by_currency", "ending_cash_by_currency"):
                if field_name in summary:
                    summary[field_name] = (
                        _ii_merge_identity._normalize_hsbc_currency_balance_map(
                            summary.get(field_name)
                        )
                    )
        elif is_bochk_payload:
            for field_name in ("starting_cash_by_currency", "ending_cash_by_currency"):
                if field_name in summary:
                    summary[field_name] = (
                        _ii_merge_identity._normalize_bochk_currency_balance_map(
                            summary.get(field_name)
                        )
                    )
        if "bochk_subaccount_balances" in summary:
            summary["bochk_subaccount_balances"] = (
                _ii_merge_identity._normalize_bochk_subaccount_balance_map(
                    summary.get("bochk_subaccount_balances")
                )
            )
        holdings_validation = summary.get("holdings_validation")
        mismatches = (
            holdings_validation.get("mismatches")
            if isinstance(holdings_validation, dict)
            else None
        )
        if isinstance(mismatches, list):
            for mismatch in mismatches:
                if not isinstance(mismatch, dict):
                    continue
                raw_ticker = mismatch.get("ticker")
                if raw_ticker:
                    mismatch["ticker"] = normalize_ticker(str(raw_ticker))

    payload["manual_internal_transfer_bindings"] = (
        normalize_investment_internal_transfer_bindings(
            payload.get("manual_internal_transfer_bindings"),
            transactions=transactions,
        )
    )
    payload["manual_internal_transfer_ignored_source_keys"] = (
        normalize_investment_internal_transfer_ignored_source_keys(
            payload.get("manual_internal_transfer_ignored_source_keys"),
            transactions=transactions,
        )
    )
    payload["manual_security_transfer_attributions"] = (
        normalize_investment_security_transfer_attributions(
            payload.get("manual_security_transfer_attributions"),
            transactions=transactions,
        )
    )
    payload["broker_snapshots"] = _ii_artifacts._normalize_broker_snapshots(payload)
    payload["realized_pnl_reconciliation"] = {
        snapshot_key: {
            "broker": snapshot.get("broker", ""),
            "account": snapshot.get("account", ""),
            "tickers": deepcopy(snapshot.get("realized_pnl_reconciliation", {})),
        }
        for snapshot_key, snapshot in payload["broker_snapshots"].items()
        if isinstance(snapshot, dict)
        and isinstance(snapshot.get("realized_pnl_reconciliation"), dict)
    }
    payload["broker_summaries"] = _ii_payload_summaries._normalize_broker_summaries(
        payload
    )
    for broker_code, broker_summary in payload["broker_summaries"].items():
        if broker_code == "hsbc":
            for field_name in ("starting_cash_by_currency", "ending_cash_by_currency"):
                if field_name in broker_summary:
                    broker_summary[field_name] = (
                        _ii_merge_identity._normalize_hsbc_currency_balance_map(
                            broker_summary.get(field_name)
                        )
                    )
        elif broker_code == "boc_hk":
            for field_name in ("starting_cash_by_currency", "ending_cash_by_currency"):
                if field_name in broker_summary:
                    broker_summary[field_name] = (
                        _ii_merge_identity._normalize_bochk_currency_balance_map(
                            broker_summary.get(field_name)
                        )
                    )
            if "bochk_subaccount_balances" in broker_summary:
                broker_summary["bochk_subaccount_balances"] = (
                    _ii_merge_identity._normalize_bochk_subaccount_balance_map(
                        broker_summary.get("bochk_subaccount_balances")
                    )
                )

    return payload


def _canonicalize_investment_internal_transfer_binding_key(raw_key: Any) -> str:
    """Migrate persisted BOCHK CNY cash keys to the canonical CNH identity."""
    key = str(raw_key or "").strip()
    if not key:
        return ""

    if key.startswith("v2:"):
        try:
            identity = json.loads(key[3:])
        except (TypeError, ValueError, json.JSONDecodeError):
            return key
        if (
            isinstance(identity, list)
            and len(identity) >= 6
            and _ii_basics._normalize_broker_code(identity[0]) == "boc_hk"
            and _normalize_text(identity[3]).replace(" ", "_").lower()
            in {"deposit", "withdrawal"}
            and _normalize_text(identity[4]).upper() in {"CNY", "RMB"}
        ):
            identity[4] = "CNH"
            return "v2:" + json.dumps(
                identity,
                ensure_ascii=False,
                separators=(",", ":"),
            )
        return key

    if key.startswith("v3:"):
        try:
            identity = json.loads(key[3:])
        except (TypeError, ValueError, json.JSONDecodeError):
            return key
        if isinstance(identity, list) and identity:
            canonical_base_key = _canonicalize_investment_internal_transfer_binding_key(
                identity[0]
            )
            if canonical_base_key != identity[0]:
                identity[0] = canonical_base_key
                return "v3:" + json.dumps(
                    identity,
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
        return key

    legacy_parts = key.split("|")
    if (
        len(legacy_parts) >= 6
        and _ii_basics._normalize_broker_code(legacy_parts[0]) == "boc_hk"
        and _normalize_text(legacy_parts[3]).replace(" ", "_").lower()
        in {"deposit", "withdrawal"}
        and _normalize_text(legacy_parts[4]).upper() in {"CNY", "RMB"}
    ):
        legacy_parts[4] = "CNH"
        return "|".join(legacy_parts)
    return key


def normalize_investment_internal_transfer_bindings(
    raw_bindings: Any,
    *,
    transactions: Any = None,
) -> dict[str, str]:
    if not isinstance(raw_bindings, dict):
        return {}
    normalized_bindings: dict[str, str] = {}
    for source_key, target_key in raw_bindings.items():
        normalized_source_key = _canonicalize_investment_internal_transfer_binding_key(
            source_key
        )
        normalized_target_key = _canonicalize_investment_internal_transfer_binding_key(
            target_key
        )
        if not normalized_source_key or not normalized_target_key:
            continue
        normalized_bindings[normalized_source_key] = normalized_target_key
    if not isinstance(transactions, list):
        return normalized_bindings

    base_key_counts: Counter[str] = Counter()
    records_by_base_key: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    legacy_key_records: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in transactions:
        if not isinstance(record, dict):
            continue
        base_key = build_investment_internal_transfer_binding_key(record)
        if not base_key:
            continue
        base_key_counts[base_key] += 1
        records_by_base_key[base_key].append(record)
        legacy_key = _build_legacy_investment_internal_transfer_binding_key(record)
        if legacy_key:
            legacy_key_records[legacy_key].append(record)

    effective_key_index = (
        _investment_import_compat.build_investment_internal_transfer_binding_index(
            transactions,
            base_key_counts=base_key_counts,
        )
    )
    legacy_to_effective: dict[str, str] = {}
    for legacy_key, records in legacy_key_records.items():
        if len(records) != 1:
            continue
        record = records[0]
        base_key = build_investment_internal_transfer_binding_key(record)
        effective_key = _build_effective_investment_internal_transfer_binding_key(
            record,
            base_key=base_key,
            base_key_counts=base_key_counts,
        )
        if effective_key and len(effective_key_index.get(effective_key, [])) == 1:
            legacy_to_effective[legacy_key] = effective_key

    # Native-currency cash rows retain explicit provenance for the replaced
    # base-currency export row. Use that evidence, never an inferred FX rate.
    replacement_aliases: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for record in transactions:
        if not isinstance(record, dict) or record.get("broker") != "ibkr":
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if (
            source.get("source_format") != "ibkr_realized_summary_csv"
            or source.get("replaced_base_amount_raw") in (None, "")
            or source.get("replaces_transaction_history_row_number") in (None, "")
            or record.get("type") not in {"deposit", "withdrawal"}
        ):
            continue
        alias = dict(record)
        alias["currency"] = "USD"
        alias["date"] = source.get("replaced_base_date") or record.get("date")
        alias["net_amount_raw"] = source["replaced_base_amount_raw"]
        alias["source"] = source.get("replaced_base_source") or {
            "file_kind": "transactions",
            "row_number": source["replaces_transaction_history_row_number"],
        }
        replacement_aliases.append((alias, record))
    alias_counts = Counter(
        build_investment_internal_transfer_binding_key(alias)
        for alias, _ in replacement_aliases
    )
    replacement_key_candidates: defaultdict[str, set[str]] = defaultdict(set)
    for alias, record in replacement_aliases:
        alias_key = _build_effective_investment_internal_transfer_binding_key(
            alias,
            base_key=build_investment_internal_transfer_binding_key(alias),
            base_key_counts=alias_counts,
        )
        current_key = _build_effective_investment_internal_transfer_binding_key(
            record,
            base_key=build_investment_internal_transfer_binding_key(record),
            base_key_counts=base_key_counts,
        )
        if len(effective_key_index.get(current_key, [])) == 1:
            replacement_key_candidates[alias_key].add(current_key)

    def resolve_stable_key(key: str) -> str:
        direct_matches = effective_key_index.get(key, [])
        if len(direct_matches) == 1:
            return key
        replacement_candidates = replacement_key_candidates.get(key, set())
        if len(replacement_candidates) == 1:
            return next(iter(replacement_candidates))
        migrated_legacy_key = legacy_to_effective.get(key)
        if migrated_legacy_key:
            return migrated_legacy_key
        if not key.startswith("v3:"):
            return key
        try:
            raw_identity = json.loads(key[3:])
        except (TypeError, ValueError, json.JSONDecodeError):
            return key
        if (
            not isinstance(raw_identity, list)
            or len(raw_identity) != 2
            or not isinstance(raw_identity[1], list)
        ):
            return key
        base_key = _canonicalize_investment_internal_transfer_binding_key(
            raw_identity[0]
        )
        historical_source_identity = [
            _normalize_text(value) for value in raw_identity[1]
        ]
        if not base_key or not any(historical_source_identity):
            return key

        compatible_effective_keys: set[str] = set()
        for record in records_by_base_key.get(base_key, []):
            current_source_identity = _investment_internal_transfer_source_identity(
                record
            )
            if len(current_source_identity) != len(historical_source_identity):
                continue
            if any(
                historical_value and historical_value != current_value
                for historical_value, current_value in zip(
                    historical_source_identity,
                    current_source_identity,
                )
            ):
                continue
            effective_key = _build_effective_investment_internal_transfer_binding_key(
                record,
                base_key=base_key,
                base_key_counts=base_key_counts,
            )
            if effective_key and len(effective_key_index.get(effective_key, [])) == 1:
                compatible_effective_keys.add(effective_key)
        if len(compatible_effective_keys) == 1:
            return next(iter(compatible_effective_keys))
        return key

    migrated_bindings: dict[str, str] = {}
    claimed_target_keys: set[str] = set()
    for source_key, target_key in normalized_bindings.items():
        stable_source_key = resolve_stable_key(source_key)
        stable_target_key = resolve_stable_key(target_key)
        if (
            not stable_source_key
            or not stable_target_key
            or stable_source_key == stable_target_key
            or stable_target_key in claimed_target_keys
        ):
            continue
        migrated_bindings[stable_source_key] = stable_target_key
        claimed_target_keys.add(stable_target_key)
    return migrated_bindings


def normalize_investment_internal_transfer_ignored_source_keys(
    raw_keys: Any,
    *,
    transactions: Any = None,
) -> list[str]:
    """Normalize durable user decisions that a source is not an internal transfer."""
    if isinstance(raw_keys, dict):
        raw_values = raw_keys.keys()
    elif isinstance(raw_keys, (list, tuple, set)):
        raw_values = raw_keys
    else:
        return []

    normalized_keys: list[str] = []
    seen_keys: set[str] = set()
    for raw_key in raw_values:
        key = _canonicalize_investment_internal_transfer_binding_key(raw_key)
        if key and key not in seen_keys:
            normalized_keys.append(key)
            seen_keys.add(key)
    if not isinstance(transactions, list):
        return normalized_keys

    base_key_counts = Counter(
        base_key
        for record in transactions
        if isinstance(record, dict)
        for base_key in [build_investment_internal_transfer_binding_key(record)]
        if base_key
    )
    effective_key_by_record: dict[int, str] = {}
    legacy_key_by_record: dict[int, str] = {}
    for record in transactions:
        if not isinstance(record, dict):
            continue
        base_key = build_investment_internal_transfer_binding_key(record)
        if not base_key:
            continue
        effective_key = _build_effective_investment_internal_transfer_binding_key(
            record,
            base_key=base_key,
            base_key_counts=base_key_counts,
        )
        if not effective_key:
            continue
        record_id = id(record)
        effective_key_by_record[record_id] = effective_key
        legacy_key_by_record[record_id] = (
            _build_legacy_investment_internal_transfer_binding_key(record)
        )

    migrated_keys: list[str] = []
    seen_migrated_keys: set[str] = set()
    for key in normalized_keys:
        matches = [
            effective_key_by_record[record_id]
            for record_id, effective_key in effective_key_by_record.items()
            if key == effective_key or key == legacy_key_by_record.get(record_id)
        ]
        if len(set(matches)) != 1:
            continue
        migrated_key = matches[0]
        if migrated_key not in seen_migrated_keys:
            migrated_keys.append(migrated_key)
            seen_migrated_keys.add(migrated_key)
    return migrated_keys


def _investment_internal_transfer_record_amount(record: dict[str, Any]) -> Any:
    normalized = (
        record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
    )
    for value in (
        record.get("net_amount_raw"),
        record.get("gross_amount_raw"),
        normalized.get("net_amount"),
        normalized.get("gross_amount"),
        record.get("amount"),
    ):
        if value is not None:
            return value
    return ""


def _investment_internal_transfer_currency_token(
    record: dict[str, Any],
    *,
    broker: str,
    normalized_type: str,
) -> str:
    currency = _normalize_text(record.get("currency")).upper()
    if (
        broker == "ibkr"
        and normalized_type in {"deposit", "withdrawal"}
        and currency in {"", "USD"}
    ):
        return "USD_OR_MISSING"
    return currency


def build_investment_internal_transfer_binding_key(record: dict[str, Any]) -> str:
    """Build a cross-import identity for a manually confirmed cash or security transfer leg."""
    if not isinstance(record, dict):
        return ""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    normalized_type = _normalize_text(record.get("type")).replace(" ", "_").lower()
    date_token = _normalize_text(record.get("date"))
    amount_token = _ii_basics._normalize_decimal_identity_token(
        _investment_internal_transfer_record_amount(record)
    )
    if not broker or not date_token or not normalized_type or not amount_token:
        return ""
    if normalized_type in {"transfer_in", "transfer_out"}:
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        quantity_token = _ii_basics._normalize_decimal_identity_token(
            record.get("quantity_abs") or record.get("quantity_raw")
        )
        if not ticker or not quantity_token:
            return ""
        identity = [
            broker,
            _ii_basics._account_identity_token(broker, account),
            date_token,
            normalized_type,
            ticker,
            quantity_token,
            _investment_internal_transfer_currency_token(
                record,
                broker=broker,
                normalized_type=normalized_type,
            ),
        ]
        return "v2:" + json.dumps(identity, ensure_ascii=False, separators=(",", ":"))
    identity = [
        broker,
        _ii_basics._account_identity_token(broker, account),
        date_token,
        normalized_type,
        _investment_internal_transfer_currency_token(
            record,
            broker=broker,
            normalized_type=normalized_type,
        ),
        amount_token,
    ]
    return "v2:" + json.dumps(identity, ensure_ascii=False, separators=(",", ":"))


def _investment_internal_transfer_source_identity(record: dict[str, Any]) -> list[str]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    row_identity = next(
        (
            source.get(field_name)
            for field_name in ("row_number", "source_row", "ledger_sequence")
            if source.get(field_name) is not None
            and str(source.get(field_name)).strip()
        ),
        "",
    )
    reference_identity = next(
        (
            source.get(field_name)
            for field_name in (
                "reference_id",
                "order_reference",
                "transaction_id",
            )
            if source.get(field_name) is not None
            and str(source.get(field_name)).strip()
        ),
        "",
    )
    return [
        _normalize_text(source.get("file_kind")),
        _normalize_text(source.get("source_filename")),
        _normalize_text(source.get("source_file_sha256")),
        _normalize_text(row_identity),
        _normalize_text(reference_identity),
        _normalize_whitespace(record.get("description")),
    ]


def _build_disambiguated_investment_internal_transfer_binding_key(
    record: dict[str, Any],
    *,
    base_key: str,
) -> str:
    identity = _investment_internal_transfer_source_identity(record)
    if not base_key or not any(identity):
        return ""
    return "v3:" + json.dumps(
        [base_key, identity],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _build_effective_investment_internal_transfer_binding_key(
    record: dict[str, Any],
    *,
    base_key: str | None = None,
    base_key_counts: Counter[str] | None = None,
) -> str:
    resolved_base_key = base_key or build_investment_internal_transfer_binding_key(
        record
    )
    if not resolved_base_key:
        return ""
    if (base_key_counts or {}).get(resolved_base_key, 0) <= 1:
        return resolved_base_key
    return _build_disambiguated_investment_internal_transfer_binding_key(
        record,
        base_key=resolved_base_key,
    )


def build_investment_internal_transfer_binding_index(
    transactions: Any,
    *,
    base_key_counts: Counter[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Index transfer legs by a unique key, disambiguating genuine duplicate rows."""
    records = [record for record in (transactions or []) if isinstance(record, dict)]
    records_with_base_keys = [
        (record, build_investment_internal_transfer_binding_key(record))
        for record in records
    ]
    counts = base_key_counts or Counter(
        base_key for _, base_key in records_with_base_keys if base_key
    )
    index: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for record, base_key in records_with_base_keys:
        effective_key = _build_effective_investment_internal_transfer_binding_key(
            record,
            base_key=base_key,
            base_key_counts=counts,
        )
        if effective_key:
            index[effective_key].append(record)
    return dict(index)


def normalize_investment_security_transfer_attributions(
    raw_attributions: Any,
    *,
    transactions: Any = None,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, dict[str, str]]:
    """Keep only structurally safe, user-attested aggregate overlay metadata."""
    if not isinstance(raw_attributions, dict) or not raw_attributions:
        return {}
    resolved_binding_index = (
        binding_index
        if binding_index is not None
        else (
            _investment_import_compat.build_investment_internal_transfer_binding_index(
                transactions
            )
            if isinstance(transactions, list)
            else {}
        )
    )
    normalized: dict[str, dict[str, str]] = {}
    for raw_receipt_key, raw_attribution in raw_attributions.items():
        if not isinstance(raw_attribution, dict):
            continue
        receipt_key = str(raw_receipt_key or "").strip()
        raw_broker = _normalize_text(raw_attribution.get("source_broker"))
        source_broker = (
            _ii_basics._normalize_broker_code(raw_broker) if raw_broker else ""
        )
        source_account = _normalize_text(raw_attribution.get("source_account"))
        if not receipt_key or not source_broker or not source_account:
            continue
        if resolved_binding_index:
            receipt_records = resolved_binding_index.get(receipt_key, [])
            if len(receipt_records) != 1:
                continue
            receipt_leg = _ii_records._security_transfer_reconciliation_leg(
                receipt_records[0]
            )
            if (
                receipt_leg is None
                or receipt_leg["type"] != "transfer_in"
                or receipt_leg["broker"] != "schwab"
            ):
                continue
        attribution = {
            "schema_version": "1",
            "source_broker": source_broker,
            "source_account": source_account,
        }
        attested_at = _normalize_text(raw_attribution.get("attested_at"))
        if attested_at:
            attribution["attested_at"] = attested_at
        normalized[receipt_key] = attribution
    return normalized


def _security_transfer_is_zero_cash_leg(record: dict[str, Any]) -> bool:
    """Require an explicit zero monetary amount before a holdings-only overlay."""
    raw_amount = _investment_internal_transfer_record_amount(record)
    raw_text = _normalize_text(str(raw_amount) if raw_amount is not None else "")
    if not raw_text:
        return False
    try:
        return Decimal(raw_text.replace(",", "")) == ZERO
    except (InvalidOperation, TypeError, ValueError):
        return False


def _security_transfer_source_quantity_before(
    transactions: list[dict[str, Any]],
    *,
    source_broker: str,
    source_account: str,
    ticker: str,
    receipt_date: str,
) -> Decimal:
    """Replay only proven source-account inventory before a date-only receipt."""
    quantity = ZERO
    for record in transactions:
        if not isinstance(record, dict):
            continue
        record_date = _normalize_text(record.get("date"))[:10]
        if not record_date or record_date >= receipt_date:
            continue
        record_broker = _investment_internal_transfer_broker(record)
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        record_account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account") or source.get("account_number")
        )
        if (
            record_broker != source_broker
            or _ii_basics._account_identity_token(record_broker, record_account)
            != _ii_basics._account_identity_token(source_broker, source_account)
            or normalize_ticker(_normalize_text(record.get("ticker"))) != ticker
        ):
            continue
        transaction_type = _investment_internal_transfer_type(record)
        if transaction_type not in {
            "buy",
            "sell",
            "dividend_reinvestment",
            "grant",
            "transfer_in",
            "transfer_out",
        }:
            continue
        try:
            record_quantity = abs(
                _ii_records._transaction_quantity_for_replay(record) or ZERO
            )
        except (InvalidOperation, TypeError, ValueError):
            continue
        if transaction_type in {"buy", "dividend_reinvestment", "grant", "transfer_in"}:
            quantity += record_quantity
        else:
            quantity -= record_quantity
    return quantity


def _security_transfer_attribution_reserved_quantity(
    transactions: list[dict[str, Any]],
    attributions: dict[str, dict[str, str]],
    *,
    receipt_key: str,
    source_broker: str,
    source_account: str,
    ticker: str,
    receipt_date: str,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> Decimal:
    """Reserve prior attested receipts so one source position cannot be reused."""
    resolved_binding_index = (
        binding_index
        if binding_index is not None
        else _investment_import_compat.build_investment_internal_transfer_binding_index(
            transactions
        )
    )
    reserved = ZERO
    for existing_key, attribution in attributions.items():
        if existing_key == receipt_key:
            continue
        if _ii_basics._normalize_broker_code(
            attribution.get("source_broker")
        ) != source_broker or _ii_basics._account_identity_token(
            source_broker, attribution.get("source_account", "")
        ) != _ii_basics._account_identity_token(source_broker, source_account):
            continue
        existing_records = resolved_binding_index.get(existing_key, [])
        if len(existing_records) != 1:
            continue
        existing_leg = _ii_records._security_transfer_reconciliation_leg(
            existing_records[0]
        )
        if (
            existing_leg is None
            or existing_leg["type"] != "transfer_in"
            or existing_leg["ticker"] != ticker
            or existing_leg["date"] > receipt_date
        ):
            continue
        reserved += existing_leg["quantity"]
    return reserved


def validate_investment_security_transfer_attribution(
    transactions: Any,
    receipt_key: str,
    source_broker: str,
    source_account: str,
    *,
    existing_attributions: Any = None,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Validate a user-attested source account without fabricating source evidence."""
    if not isinstance(transactions, list):
        raise ValueError("The investment ledger has no transfer records to attribute.")
    index = (
        binding_index
        if binding_index is not None
        else _investment_import_compat.build_investment_internal_transfer_binding_index(
            transactions
        )
    )
    normalized_receipt_key = str(receipt_key or "").strip()
    receipt_records = index.get(normalized_receipt_key, [])
    if len(receipt_records) != 1:
        raise ValueError("The Schwab transfer receipt key is missing or ambiguous.")
    receipt = receipt_records[0]
    receipt_leg = _ii_records._security_transfer_reconciliation_leg(receipt)
    if (
        receipt_leg is None
        or receipt_leg["type"] != "transfer_in"
        or receipt_leg["broker"] != "schwab"
        or not _security_transfer_is_zero_cash_leg(receipt)
    ):
        raise ValueError(
            "Only a uniquely identified, zero-cash Schwab security-transfer receipt can be attributed."
        )
    raw_source_broker = _normalize_text(source_broker)
    normalized_source_broker = (
        _ii_basics._normalize_broker_code(raw_source_broker)
        if raw_source_broker
        else ""
    )
    normalized_source_account = _normalize_text(source_account)
    if not normalized_source_broker or not normalized_source_account:
        raise ValueError("Select both a source broker and a source account.")
    if normalized_source_broker == "schwab":
        raise ValueError(
            "A Schwab receipt cannot be attributed to the same Schwab broker."
        )

    source_records = [
        record
        for record in transactions
        if isinstance(record, dict)
        and _investment_internal_transfer_broker(record) == normalized_source_broker
        and _ii_basics._account_identity_token(
            normalized_source_broker,
            _normalize_text(record.get("account"))
            or _normalize_text(
                (
                    record.get("source")
                    if isinstance(record.get("source"), dict)
                    else {}
                ).get("account")
                or (
                    record.get("source")
                    if isinstance(record.get("source"), dict)
                    else {}
                ).get("account_number")
            ),
        )
        == _ii_basics._account_identity_token(
            normalized_source_broker, normalized_source_account
        )
    ]
    if not source_records:
        raise ValueError(
            "The selected source broker and account are not represented by imported ledger evidence."
        )

    matching_source_evidence = (
        _ii_records._security_transfer_attribution_source_evidence(
            [
                leg
                for record in transactions
                if isinstance(record, dict)
                for leg in [_ii_records._security_transfer_reconciliation_leg(record)]
                if leg is not None and leg["type"] == "transfer_out"
            ],
            receipt_leg,
            source_broker=normalized_source_broker,
            source_account=normalized_source_account,
        )
    )
    if len(matching_source_evidence) > 1:
        raise ValueError(
            "More than one matching source transfer-out is imported; select the exact source leg manually."
        )
    if len(matching_source_evidence) == 1:
        # The user has explicitly named the source account and there is exactly
        # one matching immutable source record.  Persisting this confirmation is
        # safe: reconciliation will mark it evidence-backed, never as an overlay.
        return receipt

    normalized_attributions = normalize_investment_security_transfer_attributions(
        existing_attributions,
        transactions=transactions,
        binding_index=index,
    )
    available_quantity = _security_transfer_source_quantity_before(
        transactions,
        source_broker=normalized_source_broker,
        source_account=normalized_source_account,
        ticker=receipt_leg["ticker"],
        receipt_date=receipt_leg["date"],
    )
    reserved_quantity = _security_transfer_attribution_reserved_quantity(
        transactions,
        normalized_attributions,
        receipt_key=normalized_receipt_key,
        source_broker=normalized_source_broker,
        source_account=normalized_source_account,
        ticker=receipt_leg["ticker"],
        receipt_date=receipt_leg["date"],
        binding_index=index,
    )
    if available_quantity - reserved_quantity < receipt_leg["quantity"]:
        raise ValueError(
            "The selected source account lacks enough prior imported shares for this attribution."
        )
    return receipt


def refresh_investment_security_transfer_reconciliation(
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Recompute transfer safeguards after an import or metadata-only user action."""
    transactions = _ii_merge_reconciliation._payload_transactions(payload)
    payload["manual_internal_transfer_bindings"] = (
        normalize_investment_internal_transfer_bindings(
            payload.get("manual_internal_transfer_bindings"),
            transactions=transactions,
        )
    )
    payload["manual_internal_transfer_ignored_source_keys"] = (
        normalize_investment_internal_transfer_ignored_source_keys(
            payload.get("manual_internal_transfer_ignored_source_keys"),
            transactions=transactions,
        )
    )
    payload["manual_security_transfer_attributions"] = (
        normalize_investment_security_transfer_attributions(
            payload.get("manual_security_transfer_attributions"),
            transactions=transactions,
        )
    )
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    summary["security_transfer_reconciliation"] = (
        _ii_records._reconcile_cross_broker_security_transfers(
            transactions,
            payload["manual_internal_transfer_bindings"],
            payload["manual_security_transfer_attributions"],
        )
    )
    payload["summary"] = summary
    _ii_payload_summaries._attach_broker_summaries(payload)
    return payload


def _investment_internal_transfer_amount(record: dict[str, Any]) -> Decimal:
    raw_amount = _investment_internal_transfer_record_amount(record)
    try:
        return Decimal(str(raw_amount).replace(",", "")).copy_abs()
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _investment_internal_transfer_signed_amount(record: dict[str, Any]) -> Decimal:
    raw_amount = _investment_internal_transfer_record_amount(record)
    try:
        return Decimal(str(raw_amount).replace(",", ""))
    except (InvalidOperation, TypeError, ValueError):
        return ZERO


def _investment_internal_transfer_broker(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )


def _investment_internal_transfer_type(record: dict[str, Any]) -> str:
    return _normalize_text(record.get("type")).replace(" ", "_").lower()


def _is_ibkr_base_currency_equivalent_cash_record(record: dict[str, Any]) -> bool:
    """Identify an IBKR cash row whose omitted currency denotes the base USD equivalent."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _investment_internal_transfer_broker(record) == "ibkr"
        and _investment_internal_transfer_type(record) == "deposit"
        and not _normalize_text(record.get("currency"))
        and not _normalize_text(record.get("ticker"))
        and _normalize_text(source.get("file_kind"))
        == IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND
        and _investment_internal_transfer_amount(record) > ZERO
    )


def _is_investment_internal_transfer_fx_pair(
    source: dict[str, Any],
    target: dict[str, Any],
) -> bool:
    """Allow an IBKR-equivalent-USD funding leg converted to bank currency."""
    target_broker = _investment_internal_transfer_broker(target)
    target_currency = _normalize_text(target.get("currency")).upper()
    return (
        _is_ibkr_base_currency_equivalent_cash_record(source)
        and target_broker in _INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS
        and _investment_internal_transfer_type(target) == "withdrawal"
        and target_currency in {"CNH", "CNY", "HKD", "RMB"}
    )


def _is_investment_internal_transfer_bank_broker(broker: str) -> bool:
    return (
        _ii_basics._normalize_broker_code(broker)
        in _INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS
    )


def _investment_internal_transfer_direction(record: dict[str, Any]) -> str:
    broker = _investment_internal_transfer_broker(record)
    transaction_type = _investment_internal_transfer_type(record)
    if transaction_type == "transfer_out" and _normalize_text(record.get("ticker")):
        return "security_broker_to_broker"
    if transaction_type == "deposit":
        if _investment_internal_transfer_signed_amount(record) <= ZERO:
            return ""
        if _is_investment_internal_transfer_bank_broker(broker):
            return "bank_deposit_to_counterparty"
        return "hsbc_to_broker"
    return ""


def _investment_internal_transfer_effective_date(
    record: dict[str, Any],
) -> tuple[date | None, bool]:
    """Resolve the transfer date and whether it came from explicit event evidence."""
    try:
        booked_date = date.fromisoformat(_normalize_text(record.get("date"))[:10])
    except ValueError:
        return None, False
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    evidence_texts = {
        _normalize_whitespace(value)
        for value in (
            record.get("description"),
            source.get("reference_id"),
            source.get("memo_raw"),
        )
        if _normalize_whitespace(value)
    }
    for evidence_text in evidence_texts:
        match = _INVESTMENT_INTERNAL_TRANSFER_DATE_PATTERN.search(evidence_text)
        if not match:
            continue
        day = int(match.group("day"))
        month = HSBC_STATEMENT_MONTHS.get(match.group("month").lower())
        year_text = _normalize_text(match.group("year"))
        year = (
            ((2000 + int(year_text)) if len(year_text) == 2 else int(year_text))
            if year_text
            else booked_date.year
        )
        if month is None:
            continue
        try:
            evidence_date = date(year, month, day)
        except ValueError:
            continue
        if not year_text:
            distance_from_booked = evidence_date - booked_date
            if distance_from_booked.days > 31:
                evidence_date = date(year - 1, month, day)
            elif distance_from_booked.days < -180:
                evidence_date = date(year + 1, month, day)
        return evidence_date, True
    return booked_date, False


def _investment_internal_transfer_cash_chronology_is_valid(
    source: dict[str, Any],
    target: dict[str, Any],
) -> bool:
    direction = _investment_internal_transfer_direction(source)
    if not direction or direction == "security_broker_to_broker":
        return True
    try:
        source_date = date.fromisoformat(_normalize_text(source.get("date"))[:10])
    except ValueError:
        return False
    target_effective_date, has_explicit_event_date = (
        _investment_internal_transfer_effective_date(target)
    )
    if target_effective_date is None:
        return False
    posting_lag_days = (
        0
        if has_explicit_event_date
        else _INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS
    )
    if (
        has_explicit_event_date
        and target_effective_date > source_date
        and _is_ibkr_base_currency_equivalent_cash_record(source)
        and _investment_internal_transfer_broker(target)
        in _INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS
        and _investment_internal_transfer_type(target) == "withdrawal"
    ):
        # IBKR records the USD-equivalent funding leg before the bank's
        # converted-currency settlement date. Keep this exception specific to
        # that evidenced path; generic future bank outflows remain rejected.
        posting_lag_days = _INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS
    return target_effective_date <= source_date + timedelta(days=posting_lag_days)


def get_investment_internal_transfer_link_window_days(
    source: dict[str, Any],
    target: dict[str, Any],
    *,
    default_days: int = 7,
) -> int:
    """Return the permitted date window for one transfer-counterpart pair."""
    direction = _investment_internal_transfer_direction(source)
    if direction == "security_broker_to_broker":
        # In-kind transfers require the same evidence date as reconciliation.
        return 0
    source_broker = _investment_internal_transfer_broker(source)
    target_broker = _investment_internal_transfer_broker(target)
    if direction and "longbridge_hk" in {
        source_broker,
        target_broker,
    }:
        return 2
    return max(0, int(default_days))


def validate_investment_internal_transfer_binding(
    transactions: Any,
    source_key: str,
    target_key: str,
    *,
    link_window_days: int = 7,
    binding_index: dict[str, list[dict[str, Any]]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate one manual transfer pair using the same constraints as the UI."""
    index = (
        binding_index
        if binding_index is not None
        else _investment_import_compat.build_investment_internal_transfer_binding_index(
            transactions
        )
    )
    source_matches = index.get(str(source_key or "").strip(), [])
    target_matches = index.get(str(target_key or "").strip(), [])
    if len(source_matches) != 1:
        raise ValueError("The source transfer key is missing or ambiguous.")
    if len(target_matches) != 1:
        raise ValueError("The target transfer key is missing or ambiguous.")

    source = source_matches[0]
    target = target_matches[0]
    direction = _investment_internal_transfer_direction(source)
    source_broker = _investment_internal_transfer_broker(source)
    target_broker = _investment_internal_transfer_broker(target)
    target_type = _investment_internal_transfer_type(target)
    source_amount = _investment_internal_transfer_amount(source)
    target_amount = _investment_internal_transfer_amount(target)
    if not direction:
        raise ValueError(
            "The source transaction is not a supported internal-transfer source."
        )
    if direction != "security_broker_to_broker" and source_amount <= 0:
        raise ValueError(
            "The source transaction is not a supported internal-transfer source."
        )
    if source_broker == target_broker:
        raise ValueError(
            "Internal-transfer counterparts must belong to different brokers."
        )

    source_currency = _normalize_text(source.get("currency")).upper()
    target_currency = _normalize_text(target.get("currency")).upper()
    is_fx_pair = _is_investment_internal_transfer_fx_pair(source, target)
    if (
        source_currency
        and target_currency
        and source_currency != target_currency
        and not is_fx_pair
    ):
        raise ValueError("Internal-transfer counterpart currencies must match.")

    try:
        source_date = date.fromisoformat(_normalize_text(source.get("date"))[:10])
        target_date = date.fromisoformat(_normalize_text(target.get("date"))[:10])
    except ValueError as exc:
        raise ValueError("Internal-transfer counterpart dates are invalid.") from exc
    if direction == "security_broker_to_broker" and source_date != target_date:
        raise ValueError(
            "A security-transfer counterpart must have the same calendar date as the source leg."
        )
    effective_link_window_days = get_investment_internal_transfer_link_window_days(
        source,
        target,
        default_days=link_window_days,
    )
    if not _investment_internal_transfer_cash_chronology_is_valid(source, target):
        raise ValueError(
            "The cash-transfer outflow is later than the permitted deposit posting window."
        )
    if abs((target_date - source_date).days) > effective_link_window_days:
        raise ValueError("Internal-transfer counterpart dates are too far apart.")

    if direction == "security_broker_to_broker":
        source_ticker = normalize_ticker(_normalize_text(source.get("ticker")))
        target_ticker = normalize_ticker(_normalize_text(target.get("ticker")))
        try:
            source_quantity = Decimal(
                str(source.get("quantity_abs") or source.get("quantity_raw") or "0")
            )
            target_quantity = Decimal(
                str(target.get("quantity_abs") or target.get("quantity_raw") or "0")
            )
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValueError(
                "The security-transfer counterpart has an invalid quantity."
            ) from exc
        if (
            target_broker == source_broker
            or target_type != "transfer_in"
            or not source_ticker
            or source_ticker != target_ticker
            or source_amount != ZERO
            or target_amount != ZERO
            or source_quantity <= 0
            or target_quantity <= 0
            or abs(target_quantity - source_quantity)
            > max(
                Decimal("0.000001"),
                source_quantity * Decimal("0.000001"),
            )
        ):
            raise ValueError(
                "The security-transfer counterpart does not match the source leg."
            )
        return source, target

    if target_type != "withdrawal" or _normalize_text(target.get("ticker")):
        raise ValueError("The cash-transfer counterpart must be a cash withdrawal.")
    if (
        direction == "hsbc_to_broker"
        and not _is_investment_internal_transfer_bank_broker(target_broker)
    ):
        raise ValueError(
            "The cash-transfer counterpart must be an eligible bank withdrawal."
        )
    if target_amount <= 0:
        raise ValueError(
            "Internal-transfer counterpart amount is outside the permitted tolerance."
        )
    if not is_fx_pair and abs(target_amount - source_amount) > max(
        Decimal("0.01"),
        source_amount * Decimal("0.02"),
    ):
        raise ValueError(
            "Internal-transfer counterpart amount is outside the permitted tolerance."
        )
    return source, target


def _build_legacy_investment_internal_transfer_binding_key(
    record: dict[str, Any],
) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    normalized_type = _normalize_text(record.get("type")).replace(" ", "_").lower()
    reference_value = next(
        (
            value
            for value in (
                source.get("reference_id"),
                source.get("row_number"),
                source.get("order_reference"),
                source.get("transaction_type_raw"),
            )
            if value is not None
        ),
        "",
    )
    return "|".join(
        (
            broker,
            account,
            _normalize_text(record.get("date")),
            normalized_type,
            _normalize_text(record.get("currency")).upper(),
            _normalize_text(_investment_internal_transfer_record_amount(record)),
            _normalize_whitespace(record.get("description")),
            _normalize_text(source.get("file_kind")),
            _normalize_text(reference_value),
        )
    )
