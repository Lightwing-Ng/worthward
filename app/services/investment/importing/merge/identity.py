"""Investment import domain: merge identity.

Code version: v0.3.2
- Fixed: A statement PDF that corroborates an HSBC CSV or pasted-text cash row
  is recorded as corroboration instead of a conflicting sequence-digest alias.
- Fixed: HSBC dividend fallback identity requires exact account, currency,
  amount, and reliable attribution or cash-row evidence.
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    DEFAULT_CONVENTION_TIMEZONE,
    Decimal,
    HSBC_CASH_ACCOUNT_FILE_KINDS,
    HSBC_CORPORATE_EVENT_PAYMENT_PREFIX,
    HSBC_CURRENCY_ALIASES,
    InvalidOperation,
    ZERO,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    date,
    datetime,
    defaultdict,
    normalize_ticker,
    re,
    timedelta,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.brokers.bochk as _ii_bochk

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.brokers.ibkr.parsers as _ii_ibkr

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries

import app.services.investment.importing.records as _ii_records

from app.services.investment.importing import compat as _investment_import_compat


_HSBC_POSITIVE_DIVIDEND_ATTRIBUTION_STATUSES = frozenset(
    {
        "matched",
        "matched_local_market_action",
        "preserved_existing_ledger_attribution",
        "user_confirmed",
    }
)


def _grant_identity_key(record: dict[str, Any]) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(record.get("broker"))
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    ticker = (
        normalize_ticker(_normalize_text(record.get("ticker")))
        if record.get("ticker")
        else ""
    )
    return (
        broker,
        _ii_basics._account_identity_token(broker, account),
        ticker,
        _normalize_text(record.get("date")),
        _normalize_text(record.get("vesting_date")),
        _normalize_text(source.get("row_number")),
        _normalize_text(source.get("file_kind")),
    )


def _incoming_grant_superseded_tickers(
    incoming_transactions: list[dict[str, Any]],
    latest_position_snapshot: dict[str, dict[str, str]],
) -> set[str]:
    if not latest_position_snapshot:
        return set()
    incoming_grant_tickers = {
        normalize_ticker(_normalize_text(record.get("ticker")))
        for record in incoming_transactions
        if _normalize_text(record.get("type")).lower() == "grant"
        and _normalize_text(record.get("ticker"))
    }
    return {
        ticker
        for ticker in incoming_grant_tickers
        if ticker in latest_position_snapshot
    }


def _incoming_payload_is_older_period(
    incoming_payload: dict[str, Any],
    latest_payload: dict[str, Any],
) -> bool:
    incoming_dates = _ii_payload_summaries._payload_transaction_dates(incoming_payload)
    latest_dates = _ii_payload_summaries._payload_transaction_dates(latest_payload)
    if not incoming_dates or not latest_dates:
        return False
    return max(incoming_dates) < max(latest_dates)


def _transactions_for_grant_merge(
    transactions: list[dict[str, Any]],
    *,
    latest_position_snapshot: dict[str, dict[str, str]],
    incoming_payload: dict[str, Any],
    latest_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if not _incoming_payload_is_older_period(incoming_payload, latest_payload):
        return transactions
    if not latest_position_snapshot:
        return transactions
    filtered: list[dict[str, Any]] = []
    for record in transactions:
        if _normalize_text(record.get("type")).lower() != "grant":
            filtered.append(record)
            continue
        ticker = (
            normalize_ticker(_normalize_text(record.get("ticker")))
            if record.get("ticker")
            else ""
        )
        if ticker and ticker in latest_position_snapshot:
            continue
        filtered.append(record)
    return filtered


def _is_fx_translation_pnl_record(record: dict[str, Any]) -> bool:
    return _normalize_text(record.get("type")).lower() == "fx_translation_pnl"


def _is_forex_trade_component_record(record: dict[str, Any]) -> bool:
    return _normalize_text(record.get("type")).lower() == "forex_trade_component"


def _forex_trade_component_identity_currency(record: dict[str, Any]) -> str:
    ticker = _normalize_text(record.get("ticker")).upper()
    if "." in ticker:
        base_currency, _quote_currency = ticker.split(".", 1)
        if base_currency:
            return base_currency
    explicit_currency = _normalize_text(record.get("currency")).upper()
    return explicit_currency


def _canonicalize_forex_trade_component_currency(
    record: dict[str, Any],
) -> dict[str, Any]:
    if not _is_forex_trade_component_record(record):
        return record
    canonical_currency = _forex_trade_component_identity_currency(record)
    if not canonical_currency:
        return record
    canonicalized = dict(record)
    canonicalized["currency"] = canonical_currency
    return canonicalized


def _fx_translation_pnl_merge_slot_key(record: dict[str, Any]) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(record.get("broker"))
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    return (
        broker,
        _ii_basics._account_identity_token(broker, account),
        "fx_translation_pnl",
    )


def _record_iso_date_for_merge(record: dict[str, Any]) -> str:
    raw_date = _normalize_text(record.get("date"))
    try:
        return date.fromisoformat(raw_date).isoformat()
    except ValueError:
        return raw_date


def _ibkr_stock_identity_date_token(
    record: dict[str, Any], source: dict[str, Any]
) -> str:
    raw_date = _record_iso_date_for_merge(record)
    if _normalize_text(source.get("file_kind")) not in {
        "gainskeeper",
        "ibkr_web_trade_notification",
    }:
        return raw_date
    if _normalize_text(record.get("type")).lower() not in {"buy", "sell"}:
        return raw_date
    raw_datetime = _normalize_text(record.get("datetime"))
    if len(raw_datetime) < 16:
        return raw_date
    try:
        trade_day = date.fromisoformat(raw_date)
        trade_time = datetime.strptime(raw_datetime[11:19], "%H:%M:%S").time()
    except ValueError:
        return raw_date
    if trade_time.hour >= 20:
        return (trade_day + timedelta(days=1)).isoformat()
    return raw_date


def _ibkr_forex_identity_date_token(
    record: dict[str, Any],
    source: dict[str, Any],
) -> str:
    """Use the displayed Hong Kong day to match a web FX fill to its CSV row."""
    if _normalize_text(source.get("file_kind")) != "ibkr_web_trade_notification":
        return _record_iso_date_for_merge(record)
    displayed = _normalize_text(source.get("source_datetime_raw"))
    displayed_date = displayed.split(",", 1)[0].strip()
    for format_string in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(displayed_date, format_string).date().isoformat()
        except ValueError:
            continue
    return _record_iso_date_for_merge(record)


def _normalize_ibkr_gainskeeper_transaction_datetimes(
    payload: dict[str, Any],
) -> int:
    """Normalize legacy GainsKeeper rows to their source wall-clock timezone."""
    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        return 0
    normalized_count = 0
    for record in transactions:
        if not isinstance(record, dict):
            continue
        if _ii_basics._normalize_broker_code(record.get("broker")) != "ibkr":
            continue
        source = record.get("source")
        if not isinstance(source, dict):
            continue
        if _normalize_text(source.get("file_kind")) not in {
            "gainskeeper",
            "ibkr_transfers",
        }:
            continue
        source_datetime_raw = _normalize_text(source.get("source_datetime_raw"))
        if not source_datetime_raw:
            continue
        _source_date, source_datetime = _ii_ibkr._parse_gkx_datetime(
            source_datetime_raw
        )
        if not source_datetime:
            continue
        if _normalize_text(record.get("datetime")) != source_datetime:
            record["datetime"] = source_datetime
            normalized_count += 1
        for legacy_key in (
            "datetime_local_timezone",
            "datetime_localized_from",
            "datetime_localized_to",
        ):
            source.pop(legacy_key, None)
        source["datetime_timezone"] = DEFAULT_CONVENTION_TIMEZONE
        source["datetime_normalization"] = "gainskeeper_source_wall_time"
        record["source"] = source
    return normalized_count


def _pick_fx_translation_pnl_record(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    current_date = _record_iso_date_for_merge(current)
    incoming_date = _record_iso_date_for_merge(incoming)
    if incoming_date >= current_date:
        return _merge_transaction_records(current, incoming)
    return _merge_transaction_records(incoming, current)


def _normalize_hsbc_currency_code(value: Any) -> str:
    return HSBC_CURRENCY_ALIASES.get(_normalize_text(value).upper(), "")


def _normalize_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _normalize_text(raw_currency).upper()
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in normalized.items()
        if amount != ZERO
    }


def _normalize_hsbc_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _normalize_hsbc_currency_code(raw_currency)
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in normalized.items()
    }


def _normalize_bochk_currency_balance_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Decimal] = {}
    for raw_currency, raw_amount in value.items():
        currency = _ii_bochk._normalize_bochk_currency_code(raw_currency)
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(raw_amount)
        if not currency or amount is None:
            continue
        normalized[currency] = normalized.get(currency, ZERO) + amount
    return {
        currency: _decimal_to_str(amount) or "0"
        for currency, amount in normalized.items()
        if amount != ZERO
    }


def _normalize_bochk_subaccount_balance_map(value: Any) -> dict[str, dict[str, Any]]:
    """Normalize BOCHK subaccount balances while retaining printed currency labels."""
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for raw_key, raw_balance in value.items():
        if not isinstance(raw_balance, dict):
            continue
        account_number = _normalize_text(raw_balance.get("account_number"))
        raw_key_text = _normalize_text(raw_key)
        raw_key_currency = (
            raw_key_text.rsplit(":", 1)[-1] if ":" in raw_key_text else ""
        )
        raw_currency = _normalize_text(
            raw_balance.get("currency_raw")
            or raw_balance.get("currency")
            or raw_key_currency
        ).upper()
        currency = _ii_bochk._normalize_bochk_currency_code(raw_currency)
        if not currency:
            currency = _normalize_text(raw_balance.get("currency")).upper()
        if not currency:
            continue
        balance = dict(raw_balance)
        if account_number:
            balance["account_number"] = account_number
        balance["currency"] = currency
        if raw_currency:
            balance["currency_raw"] = raw_currency
        normalized_key = (
            f"{account_number}:{currency}" if account_number else raw_key_text
        )
        if not normalized_key:
            continue
        existing = normalized.get(normalized_key)
        if existing is None:
            normalized[normalized_key] = balance
        else:
            normalized[normalized_key] = {**existing, **balance}
    return normalized


def _is_hsbc_cash_account_source(source: dict[str, Any] | None) -> bool:
    return (
        _normalize_text((source or {}).get("file_kind")) in HSBC_CASH_ACCOUNT_FILE_KINDS
    )


def _is_hsbc_cash_account_record(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _ii_basics._normalize_broker_code(
        record.get("broker")
    ) == "hsbc" and _is_hsbc_cash_account_source(source)


def _normalize_hsbc_cash_account_type(currency: Any, account_type: Any) -> str:
    """Return one canonical HSBC cash subaccount label across source formats."""
    normalized_currency = _normalize_hsbc_currency_code(currency)
    normalized_type = _normalize_whitespace(account_type).upper()
    leading_currency = re.match(r"^(USD|HKD|CNH|CNY|RMB)\s+", normalized_type)
    if leading_currency:
        if (
            _normalize_hsbc_currency_code(leading_currency.group(1))
            != normalized_currency
        ):
            return ""
        normalized_type = normalized_type[leading_currency.end() :]
    foreign_savings = re.fullmatch(
        r"FOREIGN CURRENCY SAVINGS(?:\s+(USD|HKD|CNH|CNY|RMB))?",
        normalized_type,
    )
    if foreign_savings:
        explicit_currency = foreign_savings.group(1)
        if (
            explicit_currency
            and _normalize_hsbc_currency_code(explicit_currency)
            != normalized_currency
        ):
            return ""
        normalized_type = "SAVINGS"
    normalized_type = re.sub(r"\b(?:CNY|RMB)\b", "CNH", normalized_type)
    if not normalized_currency or not normalized_type:
        return ""
    return normalized_type


def _hsbc_cash_account_identity_key(
    record: dict[str, Any],
    *,
    account: str,
    normalized_type: str,
    merge_currency: str,
) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    normalized_description = _normalize_whitespace(record.get("description"))
    upper_description = re.sub(
        r"\s*\(\d{1,2}[A-Z]{3}\d{2}\)$",
        "",
        normalized_description.upper(),
    )
    amount_token = _ii_basics._normalize_decimal_identity_token(
        record.get("net_amount_raw")
    )
    balance_after = _ii_basics._normalize_decimal_identity_token(
        source.get("balance_after_raw")
    )
    date_token = _normalize_text(record.get("date"))
    cash_scope = _normalize_hsbc_cash_account_type(
        merge_currency,
        source.get("account_type"),
    )
    if not cash_scope:
        source_file_kind = _normalize_text(source.get("file_kind")).lower()
        source_sha256 = _normalize_text(
            source.get("source_sequence_sha256")
            or source.get("source_file_sha256")
        ).lower()
        cash_scope = f"__UNSCOPED__:{source_file_kind}:{source_sha256}"
    cash_scope_token = (cash_scope,) if cash_scope else ()
    identity_type = (
        "hsbc_corporate_event_payment"
        if upper_description.startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX)
        else normalized_type
    )
    description_based_cash_rows = upper_description.startswith(
        "CASH REBATE"
    ) or upper_description.startswith("MDC P ")
    if description_based_cash_rows:
        return (
            "hsbc",
            _ii_basics._account_identity_token("hsbc", account),
            "hsbc_usd_cash_description",
            date_token,
            identity_type,
            merge_currency,
            *cash_scope_token,
            amount_token,
            upper_description,
        )
    if balance_after:
        return (
            "hsbc",
            _ii_basics._account_identity_token("hsbc", account),
            "hsbc_usd_cash_balance",
            date_token,
            identity_type,
            merge_currency,
            *cash_scope_token,
            amount_token,
            balance_after,
        )
    return (
        "hsbc",
        _ii_basics._account_identity_token("hsbc", account),
        "hsbc_usd_cash_fallback",
        date_token,
        identity_type,
        merge_currency,
        *cash_scope_token,
        amount_token,
        upper_description,
    )


def _hsbc_cash_cross_source_identity_key(record: dict[str, Any]) -> tuple[str, ...]:
    """Return a conservative event key for matching statement cash to legacy cash."""
    if not _is_hsbc_cash_account_record(record):
        return ()
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    date_token = _normalize_text(record.get("date"))
    normalized_type = _normalize_text(record.get("type")).lower()
    currency = _normalize_text(record.get("currency")).upper()
    amount_token = _ii_basics._normalize_decimal_identity_token(
        record.get("net_amount_raw")
    )
    balance_after = _ii_basics._normalize_decimal_identity_token(
        source.get("balance_after_raw")
    )
    description = _normalize_whitespace(record.get("description")).upper()
    if (
        not account
        or not date_token
        or not normalized_type
        or not currency
        or not amount_token
        or not balance_after
        or not description
    ):
        return ()
    account_scope = _normalize_hsbc_cash_account_type(
        currency,
        source.get("account_type"),
    )
    if not account_scope:
        return ()
    return (
        "hsbc",
        _ii_basics._account_identity_token("hsbc", account),
        "hsbc_cash_cross_source_event",
        date_token,
        normalized_type,
        currency,
        account_scope,
        amount_token,
        balance_after,
        description,
    )


def _hsbc_statement_cash_enrichment_key(
    record: dict[str, Any],
) -> tuple[str, ...]:
    """Return a coarse key used only with corroborating statement evidence."""
    if not _is_hsbc_cash_account_record(record):
        return ()
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account") or source.get("account_number")
    )
    transaction_date = _normalize_text(record.get("date"))
    currency = _normalize_hsbc_currency_code(record.get("currency"))
    amount = _ii_basics._normalize_decimal_identity_token(record.get("net_amount_raw"))
    account_scope = _normalize_hsbc_cash_account_type(
        currency,
        source.get("account_type"),
    )
    if not account_scope:
        return ()
    if not account or not transaction_date or not currency or not amount:
        return ()
    return (
        "hsbc_statement_cash_evidence",
        _ii_basics._account_identity_token("hsbc", account),
        transaction_date,
        currency,
        account_scope,
        amount,
    )


def _hsbc_cash_reference_tokens(record: dict[str, Any]) -> set[str]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    text = " ".join(
        (
            _normalize_whitespace(record.get("description")),
            _normalize_whitespace(source.get("reference_id")),
        )
    ).upper()
    return {
        token
        for token in re.findall(r"\b[A-Z]{1,6}[A-Z0-9]*\d[A-Z0-9]{7,}\b", text)
        if not token.isdigit()
    }


def _hsbc_statement_cash_enrichment_rank(
    existing_record: dict[str, Any],
    statement_record: dict[str, Any],
) -> int | None:
    """Rank exact balance or reference evidence for one cross-source event."""
    if not _is_hsbc_statement_pdf_cash_record(
        statement_record
    ) or _hsbc_statement_cash_enrichment_key(
        existing_record
    ) != _hsbc_statement_cash_enrichment_key(statement_record):
        return None
    if _is_hsbc_statement_pdf_cash_record(existing_record):
        return (
            -1
            if _investment_import_compat.has_same_hsbc_cash_source_row(
                existing_record,
                statement_record,
            )
            else None
        )
    existing_source = (
        existing_record.get("source")
        if isinstance(existing_record.get("source"), dict)
        else {}
    )
    statement_source = (
        statement_record.get("source")
        if isinstance(statement_record.get("source"), dict)
        else {}
    )
    existing_balance = _ii_basics._normalize_decimal_identity_token(
        existing_source.get("balance_after_raw")
    )
    statement_balance = _ii_basics._normalize_decimal_identity_token(
        statement_source.get("balance_after_raw")
    )
    if existing_balance and existing_balance == statement_balance:
        return 0
    if _hsbc_cash_reference_tokens(existing_record) & _hsbc_cash_reference_tokens(
        statement_record
    ):
        return 1
    return None


def _hsbc_cash_source_file_kind(record: dict[str, Any]) -> str:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return _normalize_text(source.get("file_kind"))


def _manual_investment_source_row_identity_key(
    record: dict[str, Any],
) -> tuple[str, ...]:
    """Return the immutable workbook-row identity for a manual XLSX record."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) not in {
        "manual_investment_xlsx",
        "zircon_hk_manual_xlsx",
    }:
        return ()
    source_sha256 = _normalize_text(source.get("source_file_sha256")).lower()
    source_sheet = _normalize_text(source.get("source_sheet")).casefold()
    source_row = source.get("source_row")
    try:
        source_row_number = int(source_row)
    except (TypeError, ValueError):
        return ()
    if not source_sha256 or not source_sheet or source_row_number < 1:
        return ()
    broker = _ii_basics._normalize_broker_code(
        record.get("broker") or source.get("broker")
    )
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    if not broker or not account:
        return ()
    return (
        "manual_investment_source_row",
        broker,
        _ii_basics._account_identity_token(broker, account),
        source_sha256,
        source_sheet,
        str(source_row_number),
    )


def _has_same_manual_investment_source_row(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    current_key = _manual_investment_source_row_identity_key(current)
    incoming_key = _manual_investment_source_row_identity_key(incoming)
    return bool(current_key and current_key == incoming_key)


def _transaction_identity_key(record: dict[str, Any]) -> tuple[str, ...]:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    broker = _ii_basics._normalize_broker_code(record.get("broker"))
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    normalized_type = _normalize_text(record.get("type")).lower()
    ticker = (
        normalize_ticker(_normalize_text(record.get("ticker")))
        if record.get("ticker")
        else ""
    )
    if broker == "ibkr":
        if normalized_type in {"transfer_in", "transfer_out"}:
            transfer_account = _normalize_text(source.get("transfer_account"))
            return (
                broker,
                _ii_basics._account_identity_token(broker, account),
                "ibkr_security_transfer",
                _record_iso_date_for_merge(record),
                normalized_type,
                ticker,
                _normalize_text(record.get("currency")).upper(),
                _ii_basics._normalize_decimal_identity_token(
                    record.get("quantity_abs") or record.get("quantity_raw")
                ),
                transfer_account,
            )
        if normalized_type in {
            "buy",
            "sell",
            "dividend",
            "foreign_tax_withholding",
            "payment_in_lieu",
            "credit_interest",
            "debit_interest",
            "deposit",
            "withdrawal",
        }:
            identity_currency = _normalize_text(record.get("currency")).upper()
            if normalized_type in {
                "dividend",
                "foreign_tax_withholding",
                "payment_in_lieu",
                "credit_interest",
                "debit_interest",
                "deposit",
                "withdrawal",
            } and identity_currency in {"", "USD"}:
                identity_currency = "USD_OR_MISSING"
            return (
                broker,
                _ii_basics._account_identity_token(broker, account),
                _ibkr_stock_identity_date_token(record, source),
                normalized_type,
                ticker,
                identity_currency,
                _ii_basics._normalize_decimal_identity_token(
                    record.get("quantity_raw")
                ),
                _ii_basics._normalize_decimal_identity_token(record.get("price_raw")),
                _ii_basics._normalize_decimal_identity_token(
                    record.get("gross_amount_raw")
                ),
                _ii_basics._normalize_decimal_identity_token(
                    record.get("commission_raw")
                ),
                _ii_basics._normalize_decimal_identity_token(
                    record.get("net_amount_raw")
                ),
            )
    if source.get("file_kind") in {
        "manual_investment_xlsx",
        "zircon_hk_manual_xlsx",
    }:
        reference_id = _normalize_whitespace(source.get("reference_id"))
        if reference_id:
            identity = (
                broker,
                _ii_basics._account_identity_token(broker, account),
                "manual_investment_reference",
                reference_id.casefold(),
            )
            if _is_forex_trade_component_record(record):
                return (
                    *identity,
                    _forex_trade_component_identity_currency(record),
                )
            return identity
    fund_details_entry_number = _normalize_text(source.get("fund_details_entry_number"))
    if (
        broker == "longbridge_hk"
        and bool(source.get("cash_equivalent_transfer"))
        and fund_details_entry_number
    ):
        return (
            broker,
            _ii_basics._account_identity_token(broker, account),
            "longbridge_hk_cash_equivalent_entry",
            fund_details_entry_number,
        )
    if _is_fx_translation_pnl_record(record):
        return _fx_translation_pnl_merge_slot_key(record)
    merge_currency = (
        _forex_trade_component_identity_currency(record)
        if _is_forex_trade_component_record(record)
        else _normalize_text(record.get("currency")).upper()
    )
    if _is_hsbc_cash_account_record(record):
        return _hsbc_cash_account_identity_key(
            record,
            account=account,
            normalized_type=normalized_type,
            merge_currency=merge_currency,
        )
    if _ii_basics._is_hsbc_order_status_record(record):
        return (
            broker,
            _ii_basics._account_identity_token(broker, account),
            _normalize_text(record.get("date")),
            normalized_type,
            ticker,
            merge_currency,
            _normalize_text(source.get("statement_order_id") or source.get("order_id")),
            _normalize_text(source.get("file_kind")),
        )
    if (
        broker == "boc_hk"
        and _normalize_text(source.get("file_kind")) == "boc_hk_statement_pdf"
    ):
        return (
            broker,
            _ii_basics._account_identity_token(broker, account),
            "boc_hk_statement_cash",
            _normalize_text(source.get("statement_period")),
            _normalize_text(source.get("account_number")),
            _normalize_text(record.get("date")),
            normalized_type,
            merge_currency,
            _normalize_whitespace(record.get("description")),
            _ii_basics._normalize_decimal_identity_token(
                record.get("gross_amount_raw")
            ),
            _ii_basics._normalize_decimal_identity_token(record.get("net_amount_raw")),
            _ii_basics._normalize_decimal_identity_token(
                source.get("balance_after_raw")
            ),
            _normalize_text(source.get("reference_id")),
        )
    return (
        broker,
        _ii_basics._account_identity_token(broker, account),
        _normalize_text(record.get("date")),
        normalized_type,
        ticker,
        merge_currency,
        _normalize_whitespace(record.get("description")),
        _ii_basics._normalize_decimal_identity_token(record.get("quantity_raw")),
        _ii_basics._normalize_decimal_identity_token(record.get("price_raw")),
        _ii_basics._normalize_decimal_identity_token(record.get("gross_amount_raw")),
        _ii_basics._normalize_decimal_identity_token(record.get("commission_raw")),
        _ii_basics._normalize_decimal_identity_token(record.get("net_amount_raw")),
        _normalize_text(record.get("vesting_date")),
        _normalize_text(source.get("file_kind")),
        _normalize_text(source.get("account")),
        _normalize_text(source.get("order_id")),
        _normalize_text(source.get("execution_key")),
        _normalize_text(source.get("statement_order_id")),
        _normalize_text(source.get("transaction_type_raw")),
        _ii_basics._normalize_decimal_identity_token(source.get("balance_after_raw")),
        _normalize_whitespace(source.get("reference_id")),
    )


def _is_missing_merge_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict, tuple, set)):
        return not value
    return False


def _is_hsbc_statement_pdf_cash_record(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _is_hsbc_cash_account_record(record)
        and _normalize_text(source.get("source_format")) == "statement_pdf"
    )


def _preserve_hsbc_dividend_attribution_on_cash_merge(
    merged: dict[str, Any],
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    current_description = _normalize_whitespace(current.get("description")).upper()
    if not current_description.startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX):
        return merged
    current_ticker = normalize_ticker(_normalize_text(current.get("ticker")))
    incoming_ticker = normalize_ticker(_normalize_text(incoming.get("ticker")))
    if not current_ticker or incoming_ticker:
        return merged

    source = merged.get("source") if isinstance(merged.get("source"), dict) else {}
    merged_type = _normalize_text(merged.get("type")).lower()
    if merged_type != "dividend":
        merged["type"] = "dividend"
        source["dividend_classification_preserved_on_incremental_import"] = True
    if (
        _normalize_text(source.get("dividend_attribution_status"))
        == "unavailable_from_hsbc_cash_text"
    ):
        source["dividend_attribution_status"] = "preserved_existing_ledger_attribution"
        source["dividend_attribution_method"] = (
            _normalize_text(source.get("dividend_attribution_method"))
            or "existing_hsbc_ledger_identity"
        )
        source["dividend_attribution_preserved_on_incremental_import"] = True
    merged["ticker"] = current_ticker
    merged["source"] = source
    return merged


def _relocate_hsbc_statement_pdf_corroboration_digest(
    record: dict[str, Any],
) -> dict[str, Any]:
    """Keep a corroborating statement PDF digest out of the row's sequence aliases.

    ``statement_pdf_source_sha256`` is an alias of the row's own immutable
    source sequence digest. A CSV or pasted-text cash row that a statement PDF
    merely corroborates has a different sequence artifact, so storing the PDF
    digest under the alias makes the row's cash evidence self-contradictory.
    """
    source = record.get("source") if isinstance(record.get("source"), dict) else None
    if source is None or _normalize_text(source.get("source_format")) == "statement_pdf":
        return record
    if _normalize_text(source.get("file_kind")).lower() == "hsbc_statement_cash":
        return record
    statement_digest = _normalize_text(source.get("statement_pdf_source_sha256")).lower()
    if not statement_digest:
        return record
    sequence_digest = _normalize_text(
        source.get("source_sequence_sha256") or source.get("source_file_sha256")
    ).lower()
    if not sequence_digest or statement_digest == sequence_digest:
        return record
    relocated = dict(source)
    relocated.pop("statement_pdf_source_sha256", None)
    relocated["statement_pdf_corroboration_sha256"] = statement_digest
    return {**record, "source": relocated}


def _merge_hsbc_cash_account_records(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    current_is_pdf = _is_hsbc_statement_pdf_cash_record(current)
    incoming_is_pdf = _is_hsbc_statement_pdf_cash_record(incoming)
    if current_is_pdf == incoming_is_pdf:
        if current_is_pdf:
            semantic_priorities = {
                "deposit": 1,
                "withdrawal": 1,
                "credit_interest": 2,
                "debit_interest": 2,
                "dividend": 3,
                "kol_reward": 3,
            }
            current_priority = semantic_priorities.get(
                _normalize_text(current.get("type")).lower(),
                0,
            )
            incoming_priority = semantic_priorities.get(
                _normalize_text(incoming.get("type")).lower(),
                0,
            )
            preferred = current if current_priority > incoming_priority else incoming
            supplemental = incoming if preferred is current else current
            merged = _merge_transaction_records_default(supplemental, preferred)
            merged["description"] = preferred.get("description")
            return _preserve_hsbc_dividend_attribution_on_cash_merge(
                merged,
                current,
                incoming,
            )
        return _preserve_hsbc_dividend_attribution_on_cash_merge(
            _merge_transaction_records_default(current, incoming),
            current,
            incoming,
        )

    preferred = incoming if current_is_pdf else current
    supplemental = current if current_is_pdf else incoming
    merged = _merge_transaction_records_default(preferred, supplemental)
    preferred_source = (
        preferred.get("source") if isinstance(preferred.get("source"), dict) else {}
    )
    supplemental_source = (
        supplemental.get("source")
        if isinstance(supplemental.get("source"), dict)
        else {}
    )
    merged_source = (
        merged.get("source") if isinstance(merged.get("source"), dict) else {}
    )
    source = {
        **supplemental_source,
        **merged_source,
        **preferred_source,
    }
    if _normalize_text(supplemental_source.get("source_format")) == "statement_pdf":
        source["statement_pdf_source_filename"] = supplemental_source.get(
            "source_filename"
        )
        source["statement_pdf_source_sha256"] = supplemental_source.get(
            "source_file_sha256"
        )
        source["statement_pdf_statement_period"] = supplemental_source.get(
            "statement_period"
        )
        source["statement_pdf_balance_after_raw"] = supplemental_source.get(
            "balance_after_raw"
        )
        source.pop("source_format", None)
        source.pop("source_filename", None)
        source.pop("statement_period", None)
        if not _normalize_text(preferred_source.get("source_file_sha256")):
            source.pop("source_file_sha256", None)
    merged["source"] = source
    merged["description"] = preferred.get("description")
    return _preserve_hsbc_dividend_attribution_on_cash_merge(
        merged,
        current,
        incoming,
    )


def _prune_hsbc_settled_pending_flag(record: dict[str, Any]) -> dict[str, Any]:
    if _ii_basics._normalize_broker_code(record.get("broker")) != "hsbc":
        return record
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if not (
        _normalize_text(source.get("cash_settlement_amount_raw"))
        or _normalize_text(source.get("cash_settlement_balance_after_raw"))
    ):
        return record
    source.pop("cash_replay_pending_settlement", None)
    record["source"] = source
    return record


def _merge_transaction_records_default(
    current: dict[str, Any], incoming: dict[str, Any]
) -> dict[str, Any]:
    merged: dict[str, Any] = dict(current)
    for key, incoming_value in incoming.items():
        current_value = merged.get(key)
        if isinstance(current_value, dict) and isinstance(incoming_value, dict):
            nested = dict(current_value)
            for nested_key, nested_incoming_value in incoming_value.items():
                nested_current_value = nested.get(nested_key)
                if _is_missing_merge_value(
                    nested_current_value
                ) and not _is_missing_merge_value(nested_incoming_value):
                    nested[nested_key] = nested_incoming_value
                elif not _is_missing_merge_value(nested_incoming_value):
                    nested[nested_key] = nested_incoming_value
            merged[key] = nested
            continue
        if _is_missing_merge_value(current_value) and not _is_missing_merge_value(
            incoming_value
        ):
            merged[key] = incoming_value
        elif not _is_missing_merge_value(incoming_value):
            merged[key] = incoming_value
    return merged


def _preserve_hsbc_order_status_execution_sequence(
    merged: dict[str, Any],
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    """Keep the first evidenced HSBC Order Status rank when enrichment arrives."""
    if not (
        _ii_basics._is_hsbc_order_status_record(current)
        and _ii_basics._is_hsbc_order_status_record(incoming)
    ):
        return merged
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_order_id = _normalize_text(
        current_source.get("statement_order_id") or current_source.get("order_id")
    )
    incoming_order_id = _normalize_text(
        incoming_source.get("statement_order_id") or incoming_source.get("order_id")
    )
    if not current_order_id or current_order_id != incoming_order_id:
        return merged
    current_rank = int(current_source.get("order_status_source_row_number", 0) or 0)
    if current_rank <= 0:
        return merged
    source = merged.get("source") if isinstance(merged.get("source"), dict) else {}
    source["order_status_source_row_number"] = current_rank
    source["order_status_page_order"] = (
        _normalize_text(current_source.get("order_status_page_order")).lower()
        or "newest_first"
    )
    if _ii_records._is_hsbc_execution_notification_timestamp(current):
        merged["datetime"] = current["datetime"]
        for field in (
            "hsbc_order_execution_notification_sent_at",
            "hsbc_order_execution_notification_timezone",
            "hsbc_order_execution_notification_time_basis",
            "hsbc_order_execution_notification_gmail_message_id",
            "hsbc_order_execution_notification_sender",
            "datetime_source_field",
            "datetime_precision",
            "datetime_is_execution_notification_proxy",
        ):
            if field in current_source:
                source[field] = current_source[field]
    merged["source"] = source
    return merged


def _merge_manual_investment_source_row_records(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    """Merge one immutable manual workbook row without losing user enrichment."""
    merged = _merge_transaction_records_default(current, incoming)
    current_description = _normalize_whitespace(current.get("description"))
    incoming_description = _normalize_whitespace(incoming.get("description"))
    if current_description and incoming_description:
        current_description_folded = current_description.casefold()
        incoming_description_folded = incoming_description.casefold()
        if current_description_folded in incoming_description_folded:
            merged["description"] = incoming_description
        elif incoming_description_folded in current_description_folded:
            merged["description"] = current_description
        else:
            merged["description"] = f"{current_description} · {incoming_description}"
    elif current_description:
        merged["description"] = current_description

    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    if current_source.get("virtual_balance_reset_not_real_world_transaction") is True:
        merged["type"] = current.get("type")
    return merged


def _merge_transaction_records(
    current: dict[str, Any], incoming: dict[str, Any]
) -> dict[str, Any]:
    if _has_same_manual_investment_source_row(current, incoming):
        return _prune_hsbc_settled_pending_flag(
            _merge_manual_investment_source_row_records(current, incoming)
        )
    if _has_same_hsbc_dividend_event(current, incoming):
        current_source = (
            current.get("source") if isinstance(current.get("source"), dict) else {}
        )
        incoming_source = (
            incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
        )
        current_is_statement = bool(
            _normalize_text(current_source.get("corporate_action_reference"))
        )
        incoming_is_statement = bool(
            _normalize_text(incoming_source.get("corporate_action_reference"))
        )
        preferred = (
            incoming if incoming_is_statement or not current_is_statement else current
        )
        supplemental = current if preferred is incoming else incoming
        return _prune_hsbc_settled_pending_flag(
            _merge_transaction_records_default(supplemental, preferred)
        )
    if _is_hsbc_cash_account_record(current) and _is_hsbc_cash_account_record(incoming):
        return _prune_hsbc_settled_pending_flag(
            _relocate_hsbc_statement_pdf_corroboration_digest(
                _merge_hsbc_cash_account_records(current, incoming)
            )
        )
    if _is_ibkr_web_trade_refinement_pair(current, incoming):
        current_has_fee = not _is_missing_merge_value(current.get("commission_raw"))
        incoming_has_fee = not _is_missing_merge_value(incoming.get("commission_raw"))
        preferred = incoming if incoming_has_fee else current
        supplemental = current if preferred is incoming else incoming
        merged = _merge_transaction_records_default(supplemental, preferred)
        source = merged.get("source") if isinstance(merged.get("source"), dict) else {}
        if current_has_fee or incoming_has_fee:
            source.pop("fee_missing_from_capture", None)
        merged["source"] = source
        return _prune_hsbc_settled_pending_flag(merged)
    if _is_ibkr_web_authoritative_precision_pair(current, incoming):
        current_source = (
            current.get("source") if isinstance(current.get("source"), dict) else {}
        )
        incoming_source = (
            incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
        )
        preferred = (
            incoming
            if _ibkr_stock_trade_source_precision(incoming_source)
            > _ibkr_stock_trade_source_precision(current_source)
            else current
        )
        supplemental = current if preferred is incoming else incoming
        return _prune_ibkr_authoritative_source_metadata(
            _prune_hsbc_settled_pending_flag(
                _merge_transaction_records_default(supplemental, preferred)
            )
        )
    if _is_ibkr_web_forex_authoritative_precision_pair(current, incoming):
        current_source = (
            current.get("source") if isinstance(current.get("source"), dict) else {}
        )
        incoming_source = (
            incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
        )
        preferred = (
            incoming
            if _ibkr_stock_trade_source_precision(incoming_source)
            > _ibkr_stock_trade_source_precision(current_source)
            else current
        )
        supplemental = current if preferred is incoming else incoming
        return _prune_ibkr_authoritative_source_metadata(
            _prune_hsbc_settled_pending_flag(
                _merge_transaction_records_default(supplemental, preferred)
            )
        )
    if _is_ibkr_csv_gainskeeper_precision_pair(current, incoming):
        current_source = (
            current.get("source") if isinstance(current.get("source"), dict) else {}
        )
        incoming_source = (
            incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
        )
        preferred = (
            current
            if _normalize_text(current_source.get("file_kind")) == "gainskeeper"
            else incoming
        )
        supplemental = incoming if preferred is current else current
        return _prune_hsbc_settled_pending_flag(
            _merge_transaction_records_default(supplemental, preferred)
        )
    return _prune_hsbc_settled_pending_flag(
        _preserve_hsbc_order_status_execution_sequence(
            _merge_transaction_records_default(current, incoming),
            current,
            incoming,
        )
    )


def _prune_ibkr_authoritative_source_metadata(
    record: dict[str, Any],
) -> dict[str, Any]:
    """Remove provisional web-only provenance from authoritative IBKR trades."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) not in {"transactions", "gainskeeper"}:
        return record
    for key in (
        "execution_key",
        "provisional_until_file_import",
        "source_timezone",
        "venue",
        "cash_delta_status",
    ):
        source.pop(key, None)
    record["source"] = source
    return record


def _is_ibkr_csv_gainskeeper_precision_pair(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    if (
        _ii_basics._normalize_broker_code(current.get("broker")) != "ibkr"
        or _ii_basics._normalize_broker_code(incoming.get("broker")) != "ibkr"
    ):
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    file_kinds = {
        _normalize_text(current_source.get("file_kind")),
        _normalize_text(incoming_source.get("file_kind")),
    }
    return file_kinds == {"transactions", "gainskeeper"}


def _ibkr_stock_trade_source_precision(source: dict[str, Any]) -> int:
    return {
        "ibkr_web_trade_notification": 100,
        "transactions": 200,
        "gainskeeper": 300,
    }.get(_normalize_text(source.get("file_kind")), 0)


def _is_ibkr_web_trade_refinement_pair(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    """Match a fee-bearing same-order web capture to its provisional compact row."""
    if _ii_basics._normalize_broker_code(current.get("broker")) != "ibkr":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "ibkr":
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    if {
        _normalize_text(current_source.get("file_kind")),
        _normalize_text(incoming_source.get("file_kind")),
    } != {"ibkr_web_trade_notification"}:
        return False
    current_order_id = _normalize_text(current_source.get("order_id"))
    incoming_order_id = _normalize_text(incoming_source.get("order_id"))
    current_execution_key = _normalize_text(current_source.get("execution_key"))
    incoming_execution_key = _normalize_text(incoming_source.get("execution_key"))
    same_order = bool(current_order_id and current_order_id == incoming_order_id)
    same_execution = bool(
        current_execution_key and current_execution_key == incoming_execution_key
    )
    if not (same_order or same_execution):
        return False
    current_type = _normalize_text(current.get("type")).lower()
    incoming_type = _normalize_text(incoming.get("type")).lower()
    if current_type != incoming_type or current_type not in {"buy", "sell"}:
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    if not _ii_basics._accounts_are_compatible(
        "ibkr", current_account, incoming_account
    ):
        return False
    if normalize_ticker(_normalize_text(current.get("ticker"))) != normalize_ticker(
        _normalize_text(incoming.get("ticker"))
    ):
        return False
    if (
        _normalize_text(current.get("currency")).upper()
        != _normalize_text(incoming.get("currency")).upper()
    ):
        return False
    if _ibkr_stock_identity_date_token(
        current, current_source
    ) != _ibkr_stock_identity_date_token(
        incoming,
        incoming_source,
    ):
        return False
    if not all(
        _decimal_identity_values_match(
            current.get(field_name), incoming.get(field_name)
        )
        for field_name in ("quantity_raw", "price_raw")
    ):
        return False
    if not _decimal_identity_abs_values_match(
        current.get("gross_amount_raw"),
        incoming.get("gross_amount_raw"),
        tolerance=Decimal("0.01"),
    ):
        return False
    current_has_fee = not _is_missing_merge_value(current.get("commission_raw"))
    incoming_has_fee = not _is_missing_merge_value(incoming.get("commission_raw"))
    return current_has_fee != incoming_has_fee


def _ibkr_web_trade_notification_venue_token(source: dict[str, Any]) -> str:
    """Normalize the compact and full-page venue labels used by IBKR web paste."""
    venue = _normalize_text(source.get("venue")).upper()
    return {
        "OVT": "OVERNIGHT",
        "OVERNIGHT": "OVERNIGHT",
    }.get(venue, venue)


def _ibkr_web_compact_split_fill_group_key(
    record: dict[str, Any],
) -> tuple[str, ...] | None:
    """Return the fail-closed identity shared by one compact order and its fills."""
    if _ii_basics._normalize_broker_code(record.get("broker")) != "ibkr":
        return None
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) != "ibkr_web_trade_notification":
        return None
    transaction_type = _normalize_text(record.get("type")).lower()
    if transaction_type not in {"buy", "sell"}:
        return None
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    ticker = normalize_ticker(_normalize_text(record.get("ticker")))
    currency = _normalize_text(record.get("currency")).upper()
    datetime_token = _normalize_text(record.get("datetime"))
    price = _ii_basics._normalize_decimal_identity_token(record.get("price_raw"))
    venue = _ibkr_web_trade_notification_venue_token(source)
    if not all((account, ticker, currency, datetime_token, price, venue)):
        return None
    if len(datetime_token) < 16:
        return None
    return (
        _ii_basics._account_identity_token("ibkr", account),
        transaction_type,
        ticker,
        currency,
        _ibkr_stock_identity_date_token(record, source),
        datetime_token[:16],
        price,
        venue,
    )


def _ibkr_web_compact_fill_detail_count(record: dict[str, Any]) -> int:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    try:
        fill_detail_count = int(str(source.get("fill_detail_count") or "").strip())
    except (TypeError, ValueError):
        return 0
    return fill_detail_count if fill_detail_count > 1 else 0


def _is_ibkr_web_compact_aggregate_with_fill_details(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("source_format")) != "pasted_text_compact_orders":
        return False
    if _normalize_text(source.get("fee_source")) != "same_page_trade_fill_details":
        return False
    if _ibkr_web_compact_fill_detail_count(record) < 2:
        return False
    if _ibkr_web_compact_split_fill_group_key(record) is None:
        return False
    return all(
        not _is_missing_merge_value(record.get(field_name))
        for field_name in (
            "quantity_raw",
            "gross_amount_raw",
            "commission_raw",
            "net_amount_raw",
        )
    )


def _is_ibkr_web_full_page_split_fill(record: dict[str, Any]) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("source_format")) != "pasted_text":
        return False
    if not bool(source.get("provisional_until_file_import")):
        return False
    if _ibkr_web_compact_split_fill_group_key(record) is None:
        return False
    return all(
        not _is_missing_merge_value(record.get(field_name))
        for field_name in (
            "quantity_raw",
            "gross_amount_raw",
            "commission_raw",
            "net_amount_raw",
        )
    )


def _sum_ibkr_web_split_fill_amounts(
    records: list[dict[str, Any]],
    field_name: str,
) -> Decimal | None:
    total = ZERO
    for record in records:
        token = _ii_basics._normalize_decimal_identity_token(record.get(field_name))
        if not token:
            return None
        try:
            total += Decimal(token)
        except (InvalidOperation, TypeError, ValueError):
            return None
    return total


def _ibkr_web_split_fills_exactly_reconcile_compact_aggregate(
    compact_record: dict[str, Any],
    split_fill_records: list[dict[str, Any]],
) -> bool:
    """Require every economic field to close before removing split-fill duplicates."""
    if len(split_fill_records) != _ibkr_web_compact_fill_detail_count(compact_record):
        return False
    for field_name in (
        "quantity_raw",
        "gross_amount_raw",
        "commission_raw",
        "net_amount_raw",
    ):
        split_total = _sum_ibkr_web_split_fill_amounts(split_fill_records, field_name)
        compact_value = _ii_basics._normalize_decimal_identity_token(
            compact_record.get(field_name)
        )
        if split_total is None or not compact_value:
            return False
        if not _decimal_identity_values_match(
            split_total,
            compact_value,
            tolerance=ZERO,
        ):
            return False
    return True


def _reconcile_ibkr_web_compact_split_fills(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, int]:
    """Drop only full-page rows that exactly duplicate a compact aggregate order."""
    compact_records_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    split_fill_records_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = (
        defaultdict(list)
    )
    for record in [*existing_transactions, *incoming_transactions]:
        group_key = _ibkr_web_compact_split_fill_group_key(record)
        if group_key is None:
            continue
        if _is_ibkr_web_compact_aggregate_with_fill_details(record):
            compact_records_by_key[group_key].append(record)
        elif _is_ibkr_web_full_page_split_fill(record):
            split_fill_records_by_key[group_key].append(record)

    superseded_split_fill_ids: set[int] = set()
    for group_key, compact_records in compact_records_by_key.items():
        if len(compact_records) != 1:
            continue
        split_fill_records = split_fill_records_by_key.get(group_key, [])
        if _ibkr_web_split_fills_exactly_reconcile_compact_aggregate(
            compact_records[0],
            split_fill_records,
        ):
            superseded_split_fill_ids.update(
                id(record) for record in split_fill_records
            )

    if not superseded_split_fill_ids:
        return existing_transactions, incoming_transactions, 0, 0
    retained_existing = [
        record
        for record in existing_transactions
        if id(record) not in superseded_split_fill_ids
    ]
    retained_incoming = [
        record
        for record in incoming_transactions
        if id(record) not in superseded_split_fill_ids
    ]
    return (
        retained_existing,
        retained_incoming,
        len(existing_transactions) - len(retained_existing),
        len(incoming_transactions) - len(retained_incoming),
    )


def _ibkr_web_compact_gainskeeper_split_fill_group_key(
    record: dict[str, Any],
) -> tuple[str, ...] | None:
    """Return the narrow identity shared by a web aggregate and GKX split fills."""
    if _ii_basics._normalize_broker_code(record.get("broker")) != "ibkr":
        return None
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    file_kind = _normalize_text(source.get("file_kind"))
    if file_kind not in {"ibkr_web_trade_notification", "gainskeeper"}:
        return None
    transaction_type = _normalize_text(record.get("type")).lower()
    if transaction_type not in {"buy", "sell"}:
        return None
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    ticker = normalize_ticker(_normalize_text(record.get("ticker")))
    currency = _normalize_text(record.get("currency")).upper()
    datetime_token = _normalize_text(record.get("datetime"))
    price = _ii_basics._normalize_decimal_identity_token(record.get("price_raw"))
    if not all((account, ticker, currency, datetime_token, price)):
        return None
    if len(datetime_token) < 16:
        return None
    return (
        _ii_basics._account_identity_token("ibkr", account),
        transaction_type,
        ticker,
        currency,
        _ibkr_stock_identity_date_token(record, source),
        datetime_token[:16],
        price,
    )


def _is_ibkr_gainskeeper_split_stock_fill(record: dict[str, Any]) -> bool:
    """Require immutable GKX trade evidence before it can replace a web aggregate."""
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) != "gainskeeper":
        return False
    if not _normalize_text(source.get("fitid")):
        return False
    if _ibkr_web_compact_gainskeeper_split_fill_group_key(record) is None:
        return False
    return all(
        not _is_missing_merge_value(record.get(field_name))
        for field_name in ("quantity_raw", "gross_amount_raw")
    )


def _ibkr_gainskeeper_split_fills_reconcile_web_compact_aggregate(
    compact_record: dict[str, Any],
    split_fill_records: list[dict[str, Any]],
) -> bool:
    """Accept GKX split fills when their count, quantity, and gross trade value close exactly."""
    if len(split_fill_records) != _ibkr_web_compact_fill_detail_count(compact_record):
        return False
    fitids = {
        _normalize_text(
            record.get("source", {}).get("fitid")
            if isinstance(record.get("source"), dict)
            else ""
        )
        for record in split_fill_records
    }
    if len(fitids) != len(split_fill_records) or not all(fitids):
        return False
    for field_name in ("quantity_raw", "gross_amount_raw"):
        split_total = _sum_ibkr_web_split_fill_amounts(split_fill_records, field_name)
        compact_value = _ii_basics._normalize_decimal_identity_token(
            compact_record.get(field_name)
        )
        if split_total is None or not compact_value:
            return False
        if not _decimal_identity_values_match(
            split_total, compact_value, tolerance=ZERO
        ):
            return False
    return True


def _reconcile_ibkr_web_compact_aggregates_with_gainskeeper_split_fills(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, int]:
    """Replace a provisional web aggregate with the corresponding authoritative GKX fills."""
    compact_records_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    gainskeeper_fills_by_key: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(
        list
    )
    for record in [*existing_transactions, *incoming_transactions]:
        group_key = _ibkr_web_compact_gainskeeper_split_fill_group_key(record)
        if group_key is None:
            continue
        if _is_ibkr_web_compact_aggregate_with_fill_details(record):
            compact_records_by_key[group_key].append(record)
        elif _is_ibkr_gainskeeper_split_stock_fill(record):
            gainskeeper_fills_by_key[group_key].append(record)

    superseded_compact_ids: set[int] = set()
    for group_key, compact_records in compact_records_by_key.items():
        if len(compact_records) != 1:
            continue
        gainskeeper_fills = gainskeeper_fills_by_key.get(group_key, [])
        if _ibkr_gainskeeper_split_fills_reconcile_web_compact_aggregate(
            compact_records[0],
            gainskeeper_fills,
        ):
            superseded_compact_ids.add(id(compact_records[0]))

    if not superseded_compact_ids:
        return existing_transactions, incoming_transactions, 0, 0
    retained_existing = [
        record
        for record in existing_transactions
        if id(record) not in superseded_compact_ids
    ]
    retained_incoming = [
        record
        for record in incoming_transactions
        if id(record) not in superseded_compact_ids
    ]
    return (
        retained_existing,
        retained_incoming,
        len(existing_transactions) - len(retained_existing),
        len(incoming_transactions) - len(retained_incoming),
    )


def _is_ibkr_web_authoritative_precision_pair(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    if _ii_basics._normalize_broker_code(current.get("broker")) != "ibkr":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "ibkr":
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    file_kinds = {
        _normalize_text(current_source.get("file_kind")),
        _normalize_text(incoming_source.get("file_kind")),
    }
    if "ibkr_web_trade_notification" not in file_kinds:
        return False
    if not file_kinds.intersection({"transactions", "gainskeeper"}):
        return False
    current_type = _normalize_text(current.get("type")).lower()
    incoming_type = _normalize_text(incoming.get("type")).lower()
    if current_type != incoming_type or current_type not in {"buy", "sell"}:
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    if not _ii_basics._accounts_are_compatible(
        "ibkr", current_account, incoming_account
    ):
        return False
    if normalize_ticker(_normalize_text(current.get("ticker"))) != normalize_ticker(
        _normalize_text(incoming.get("ticker"))
    ):
        return False
    if (
        _normalize_text(current.get("currency")).upper()
        != _normalize_text(incoming.get("currency")).upper()
    ):
        return False
    if _ibkr_stock_identity_date_token(
        current,
        current_source,
    ) != _ibkr_stock_identity_date_token(incoming, incoming_source):
        return False
    if not _decimal_identity_values_match(
        current.get("quantity_raw"),
        incoming.get("quantity_raw"),
    ):
        return False
    if not _decimal_identity_values_match(
        current.get("price_raw"),
        incoming.get("price_raw"),
    ):
        return False
    if not _decimal_identity_abs_values_match(
        current.get("gross_amount_raw"),
        incoming.get("gross_amount_raw"),
        tolerance=Decimal("0.01"),
    ):
        return False
    if "gainskeeper" in file_kinds:
        current_datetime = _normalize_text(current.get("datetime"))
        incoming_datetime = _normalize_text(incoming.get("datetime"))
        if (
            len(current_datetime) >= 16
            and len(incoming_datetime) >= 16
            and current_datetime[:16] != incoming_datetime[:16]
        ):
            return False
    return True


def _is_ibkr_web_forex_authoritative_precision_pair(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    """Match one provisional web FX fill to its authoritative file component."""
    if _ii_basics._normalize_broker_code(current.get("broker")) != "ibkr":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "ibkr":
        return False
    if not (
        _is_forex_trade_component_record(current)
        and _is_forex_trade_component_record(incoming)
    ):
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    file_kinds = {
        _normalize_text(current_source.get("file_kind")),
        _normalize_text(incoming_source.get("file_kind")),
    }
    if "ibkr_web_trade_notification" not in file_kinds:
        return False
    if not file_kinds.intersection({"transactions", "gainskeeper"}):
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    if not _ii_basics._accounts_are_compatible(
        "ibkr", current_account, incoming_account
    ):
        return False
    if normalize_ticker(_normalize_text(current.get("ticker"))) != normalize_ticker(
        _normalize_text(incoming.get("ticker"))
    ):
        return False
    if _ibkr_forex_identity_date_token(
        current,
        current_source,
    ) != _ibkr_forex_identity_date_token(incoming, incoming_source):
        return False
    if not _decimal_identity_values_match(
        current.get("quantity_raw"),
        incoming.get("quantity_raw"),
    ):
        return False
    return _decimal_identity_values_match(
        current.get("price_raw"),
        incoming.get("price_raw"),
        tolerance=Decimal("0.00001"),
    )


def _decimal_identity_values_match(
    left: Any,
    right: Any,
    *,
    tolerance: Decimal = Decimal("0.000001"),
) -> bool:
    left_token = _ii_basics._normalize_decimal_identity_token(left)
    right_token = _ii_basics._normalize_decimal_identity_token(right)
    if left_token == right_token:
        return True
    if not left_token or not right_token:
        return False
    try:
        return abs(Decimal(left_token) - Decimal(right_token)) <= tolerance
    except (InvalidOperation, ValueError):
        return False


def _decimal_identity_abs_values_match(
    left: Any,
    right: Any,
    *,
    tolerance: Decimal = Decimal("0.000001"),
) -> bool:
    left_token = _ii_basics._normalize_decimal_identity_token(left)
    right_token = _ii_basics._normalize_decimal_identity_token(right)
    if left_token == right_token:
        return True
    if not left_token or not right_token:
        return False
    try:
        return abs(abs(Decimal(left_token)) - abs(Decimal(right_token))) <= tolerance
    except (InvalidOperation, ValueError):
        return False


def _is_ibkr_csv_gainskeeper_equivalent_stock_trade(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    if not _is_ibkr_csv_gainskeeper_precision_pair(current, incoming):
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    if (
        _normalize_text(current.get("type")).lower()
        != _normalize_text(incoming.get("type")).lower()
    ):
        return False
    if _normalize_text(current.get("type")).lower() not in {"buy", "sell"}:
        return False
    current_broker = _ii_basics._normalize_broker_code(current.get("broker"))
    incoming_broker = _ii_basics._normalize_broker_code(incoming.get("broker"))
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    if _ii_basics._account_identity_token(
        current_broker, current_account
    ) != _ii_basics._account_identity_token(incoming_broker, incoming_account):
        return False
    if normalize_ticker(_normalize_text(current.get("ticker"))) != normalize_ticker(
        _normalize_text(incoming.get("ticker"))
    ):
        return False
    if (
        _normalize_text(current.get("currency")).upper()
        != _normalize_text(incoming.get("currency")).upper()
    ):
        return False
    if _ibkr_stock_identity_date_token(
        current, current_source
    ) != _ibkr_stock_identity_date_token(incoming, incoming_source):
        return False
    if not all(
        _decimal_identity_values_match(
            current.get(field_name), incoming.get(field_name)
        )
        for field_name in (
            "quantity_raw",
            "price_raw",
            "net_amount_raw",
        )
    ):
        return False
    if _decimal_identity_values_match(
        current.get("commission_raw"), incoming.get("commission_raw")
    ):
        return True
    return _decimal_identity_abs_values_match(
        current.get("commission_raw"), incoming.get("commission_raw")
    )


def _is_ibkr_legacy_transaction_gainskeeper_match(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    """Match a legacy CSV row whose exact GKX FITID was not persisted."""
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    if (
        _ii_basics._normalize_broker_code(current.get("broker")) != "ibkr"
        or _ii_basics._normalize_broker_code(incoming.get("broker")) != "ibkr"
        or _normalize_text(current_source.get("file_kind")) != "transactions"
        or _normalize_text(incoming_source.get("file_kind")) != "gainskeeper"
        or _normalize_text(current_source.get("fitid"))
        or not _normalize_text(incoming_source.get("fitid"))
    ):
        return False
    current_type = _normalize_text(current.get("type")).lower()
    if current_type == "dividend_reinvestment":
        current_type = "buy"
    incoming_type = _normalize_text(incoming.get("type")).lower()
    if current_type != incoming_type or incoming_type not in {"buy", "sell"}:
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    if not _ii_basics._accounts_are_compatible(
        "ibkr", current_account, incoming_account
    ):
        return False
    if normalize_ticker(_normalize_text(current.get("ticker"))) != normalize_ticker(
        _normalize_text(incoming.get("ticker"))
    ):
        return False
    if (
        _normalize_text(current.get("currency")).upper()
        != _normalize_text(incoming.get("currency")).upper()
    ):
        return False
    if not all(
        _decimal_identity_values_match(
            current.get(field_name), incoming.get(field_name)
        )
        for field_name in ("quantity_raw", "price_raw")
    ):
        return False
    if not _decimal_identity_values_match(
        current.get("net_amount_raw"),
        incoming.get("net_amount_raw"),
        tolerance=Decimal("0.01"),
    ):
        return False
    current_commission = current.get("commission_raw")
    incoming_commission = incoming.get("commission_raw")
    if not _is_missing_merge_value(current_commission) and not _is_missing_merge_value(
        incoming_commission
    ):
        return _decimal_identity_values_match(current_commission, incoming_commission)
    return True


def _has_ibkr_closed_trade_metadata(record: dict[str, Any]) -> bool:
    normalized = (
        record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
    )
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return bool(
        _normalize_text(record.get("broker_realized_pnl_raw"))
        or _normalize_text(normalized.get("broker_realized_pnl"))
        or _normalize_text(source.get("closed_lot_id"))
    )


def _merge_ibkr_closed_trade_metadata(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> None:
    """Preserve Realized Summary fields before CSV/GainsKeeper deduplication."""
    existing_gainskeeper = [
        record
        for record in existing_transactions
        if _is_ibkr_source_stock_trade(record, file_kind="gainskeeper")
    ]
    incoming_gainskeeper = [
        record
        for record in incoming_transactions
        if _is_ibkr_source_stock_trade(record, file_kind="gainskeeper")
    ]
    existing_csv = [
        record
        for record in existing_transactions
        if _is_ibkr_source_stock_trade(record, file_kind="transactions")
    ]
    incoming_csv = [
        record
        for record in incoming_transactions
        if _is_ibkr_source_stock_trade(record, file_kind="transactions")
    ]
    for gainskeeper_record in (*existing_gainskeeper, *incoming_gainskeeper):
        for csv_record in (*existing_csv, *incoming_csv):
            if not _is_ibkr_csv_gainskeeper_equivalent_stock_trade(
                gainskeeper_record,
                csv_record,
            ):
                continue
            if _has_ibkr_closed_trade_metadata(gainskeeper_record):
                continue
            if not _has_ibkr_closed_trade_metadata(csv_record):
                continue
            merged = _merge_transaction_records(gainskeeper_record, csv_record)
            if gainskeeper_record in existing_transactions:
                existing_transactions[
                    existing_transactions.index(gainskeeper_record)
                ] = merged
            else:
                incoming_transactions[
                    incoming_transactions.index(gainskeeper_record)
                ] = merged
            gainskeeper_record.clear()
            gainskeeper_record.update(merged)
            break


def _has_same_source_fitid(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_fitid = _normalize_text(current_source.get("fitid"))
    incoming_fitid = _normalize_text(incoming_source.get("fitid"))
    return bool(current_fitid and incoming_fitid and current_fitid == incoming_fitid)


def _ibkr_source_fitid_identity_key(record: dict[str, Any]) -> tuple[str, ...]:
    """Return a broker/account-scoped key for an immutable IBKR FITID."""
    if _ii_basics._normalize_broker_code(record.get("broker")) != "ibkr":
        return ()
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    if _normalize_text(source.get("file_kind")) != "gainskeeper":
        return ()
    fitid = _normalize_text(source.get("fitid"))
    account = _normalize_text(record.get("account")) or _normalize_text(
        source.get("account")
    )
    if not fitid or not account:
        return ()
    return (
        "ibkr_source_fitid",
        _ii_basics._account_identity_token("ibkr", account),
        fitid,
    )


def _has_same_hsbc_order_reference(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    if _ii_basics._normalize_broker_code(current.get("broker")) != "hsbc":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "hsbc":
        return False
    current_type = _normalize_text(current.get("type")).lower()
    incoming_type = _normalize_text(incoming.get("type")).lower()
    if current_type not in {"buy", "sell"} or incoming_type not in {"buy", "sell"}:
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_order_id = _normalize_text(
        current_source.get("statement_order_id") or current_source.get("order_id")
    )
    incoming_order_id = _normalize_text(
        incoming_source.get("statement_order_id") or incoming_source.get("order_id")
    )
    if not current_order_id or current_order_id != incoming_order_id:
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
    )
    return _ii_basics._accounts_are_compatible(
        "hsbc", current_account, incoming_account
    )


def _has_same_hsbc_dividend_event(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    if _ii_basics._normalize_broker_code(current.get("broker")) != "hsbc":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "hsbc":
        return False
    if _normalize_text(current.get("type")).lower() != "dividend":
        return False
    if _normalize_text(incoming.get("type")).lower() != "dividend":
        return False
    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_reference = _normalize_text(
        current_source.get("corporate_action_reference")
    )
    incoming_reference = _normalize_text(
        incoming_source.get("corporate_action_reference")
    )
    if current_reference and incoming_reference and current_reference != incoming_reference:
        return False
    has_matching_reference = bool(
        current_reference
        and incoming_reference
        and current_reference == incoming_reference
    )
    current_status = _normalize_text(
        current_source.get("dividend_attribution_status")
    ).lower()
    incoming_status = _normalize_text(
        incoming_source.get("dividend_attribution_status")
    ).lower()
    has_attribution_evidence = bool(
        has_matching_reference
        or current_status in _HSBC_POSITIVE_DIVIDEND_ATTRIBUTION_STATUSES
        or incoming_status in _HSBC_POSITIVE_DIVIDEND_ATTRIBUTION_STATUSES
    )
    if not has_attribution_evidence:
        return False
    if _normalize_text(current.get("date")) != _normalize_text(incoming.get("date")):
        return False
    current_ticker = normalize_ticker(_normalize_text(current.get("ticker")))
    incoming_ticker = normalize_ticker(_normalize_text(incoming.get("ticker")))
    if not current_ticker or current_ticker != incoming_ticker:
        return False
    current_currency = _normalize_hsbc_currency_code(current.get("currency"))
    incoming_currency = _normalize_hsbc_currency_code(incoming.get("currency"))
    if not current_currency or current_currency != incoming_currency:
        return False
    if not _decimal_identity_values_match(
        current.get("net_amount_raw"),
        incoming.get("net_amount_raw"),
        tolerance=ZERO,
    ):
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account")
        or current_source.get("account_number")
        or current_source.get("statement_account_number")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account")
        or incoming_source.get("account_number")
        or incoming_source.get("statement_account_number")
    )
    if not current_account or current_account != incoming_account:
        return False
    current_balance = _ii_basics._normalize_decimal_identity_token(
        current_source.get("balance_after_raw")
        or current_source.get("cash_settlement_balance_after_raw")
    )
    incoming_balance = _ii_basics._normalize_decimal_identity_token(
        incoming_source.get("balance_after_raw")
        or incoming_source.get("cash_settlement_balance_after_raw")
    )
    if has_matching_reference:
        return not (
            current_balance
            and incoming_balance
            and current_balance != incoming_balance
        )
    return bool(
        current_balance
        and current_balance == incoming_balance
    )


def _has_same_hsbc_corporate_event_cash_record(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> bool:
    """Match one HSBC corporate-event cash row across paste and CSV sources."""
    if _ii_basics._normalize_broker_code(current.get("broker")) != "hsbc":
        return False
    if _ii_basics._normalize_broker_code(incoming.get("broker")) != "hsbc":
        return False
    current_description = _normalize_whitespace(current.get("description")).upper()
    incoming_description = _normalize_whitespace(incoming.get("description")).upper()
    if not current_description.startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX):
        return False
    if not incoming_description.startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX):
        return False
    if _normalize_text(current.get("date")) != _normalize_text(incoming.get("date")):
        return False
    if (
        _normalize_text(current.get("currency")).upper()
        != _normalize_text(incoming.get("currency")).upper()
    ):
        return False
    if not _decimal_identity_values_match(
        current.get("net_amount_raw"),
        incoming.get("net_amount_raw"),
        tolerance=Decimal("0.01"),
    ):
        return False

    current_source = (
        current.get("source") if isinstance(current.get("source"), dict) else {}
    )
    incoming_source = (
        incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    )
    current_balance = _ii_basics._normalize_decimal_identity_token(
        current_source.get("balance_after_raw")
    )
    incoming_balance = _ii_basics._normalize_decimal_identity_token(
        incoming_source.get("balance_after_raw")
    )
    if (
        not current_balance
        or not incoming_balance
        or current_balance != incoming_balance
    ):
        return False

    current_ticker = normalize_ticker(_normalize_text(current.get("ticker")))
    incoming_ticker = normalize_ticker(_normalize_text(incoming.get("ticker")))
    if current_ticker and incoming_ticker and current_ticker != incoming_ticker:
        return False
    current_account = _normalize_text(current.get("account")) or _normalize_text(
        current_source.get("account") or current_source.get("account_number")
    )
    incoming_account = _normalize_text(incoming.get("account")) or _normalize_text(
        incoming_source.get("account") or incoming_source.get("account_number")
    )
    return _ii_basics._accounts_are_compatible(
        "hsbc", current_account, incoming_account
    )


def _is_ibkr_gainskeeper_payload(payload: dict[str, Any]) -> bool:
    if _ii_basics._normalize_broker_code(payload.get("broker")) != "ibkr":
        return False
    generator = (
        payload.get("generator") if isinstance(payload.get("generator"), dict) else {}
    )
    if (
        _normalize_text(generator.get("name"))
        == "ibkr_gainskeeper_ofx_to_investment_json"
    ):
        return True
    return any(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "gainskeeper"
        for record in _ii_merge_reconciliation._payload_transactions(payload)
    )


def _is_ibkr_web_trade_notification_payload(payload: dict[str, Any]) -> bool:
    if _ii_basics._normalize_broker_code(payload.get("broker")) != "ibkr":
        return False
    generator = (
        payload.get("generator") if isinstance(payload.get("generator"), dict) else {}
    )
    if (
        _normalize_text(generator.get("name"))
        == "ibkr_web_trade_notifications_to_investment_json"
    ):
        return True
    transactions = _ii_merge_reconciliation._payload_transactions(payload)
    return bool(transactions) and all(
        _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "ibkr_web_trade_notification"
        for record in transactions
    )


def _is_ibkr_source_stock_trade(
    record: dict[str, Any],
    *,
    file_kind: str,
) -> bool:
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    return (
        _ii_basics._normalize_broker_code(record.get("broker")) == "ibkr"
        and _normalize_text(source.get("file_kind")) == file_kind
        and _normalize_text(record.get("type")).lower() in {"buy", "sell"}
        and bool(normalize_ticker(_normalize_text(record.get("ticker"))))
    )


def _ibkr_gainskeeper_stock_trade_coverage(
    incoming_transactions: list[dict[str, Any]],
) -> dict[tuple[str, str], tuple[str, str]]:
    coverage: dict[tuple[str, str], tuple[str, str]] = {}
    for record in incoming_transactions:
        if not _is_ibkr_source_stock_trade(record, file_kind="gainskeeper"):
            continue
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        broker = _ii_basics._normalize_broker_code(record.get("broker"))
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account")
        )
        account_token = _ii_basics._account_identity_token(broker, account)
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        date_token = _ibkr_stock_identity_date_token(record, source)
        if not account_token or not ticker or not date_token:
            continue
        key = (account_token, ticker)
        current = coverage.get(key)
        if current is None:
            coverage[key] = (date_token, date_token)
            continue
        coverage[key] = (min(current[0], date_token), max(current[1], date_token))
    return coverage


def _remove_ibkr_csv_stock_trades_superseded_by_gainskeeper(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    _merge_ibkr_closed_trade_metadata(existing_transactions, incoming_transactions)
    coverage = _ibkr_gainskeeper_stock_trade_coverage(incoming_transactions)
    if not coverage:
        return existing_transactions, 0

    legacy_candidates = [
        record
        for record in incoming_transactions
        if _normalize_text(
            (
                record.get("source") if isinstance(record.get("source"), dict) else {}
            ).get("file_kind")
        )
        == "gainskeeper"
        and _normalize_text(record.get("type")).lower() in {"buy", "sell"}
    ]
    claimed_legacy_candidates: set[int] = set()

    retained: list[dict[str, Any]] = []
    superseded_count = 0
    for record in existing_transactions:
        source = record.get("source") if isinstance(record.get("source"), dict) else {}
        if _normalize_text(source.get("file_kind")) == "transactions":
            matched_legacy_candidate = next(
                (
                    candidate
                    for candidate in legacy_candidates
                    if id(candidate) not in claimed_legacy_candidates
                    and _is_ibkr_legacy_transaction_gainskeeper_match(
                        record,
                        candidate,
                    )
                ),
                None,
            )
            if matched_legacy_candidate is not None:
                claimed_legacy_candidates.add(id(matched_legacy_candidate))
                superseded_count += 1
                continue
        if not _is_ibkr_source_stock_trade(record, file_kind="transactions"):
            retained.append(record)
            continue
        broker = _ii_basics._normalize_broker_code(record.get("broker"))
        account = _normalize_text(record.get("account")) or _normalize_text(
            source.get("account")
        )
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        date_token = _ibkr_stock_identity_date_token(record, source)
        date_range = coverage.get(
            (_ii_basics._account_identity_token(broker, account), ticker)
        )
        if date_range is not None and date_range[0] <= date_token <= date_range[1]:
            superseded_count += 1
            continue
        retained.append(record)
    return retained, superseded_count


def _remove_incoming_ibkr_csv_stock_trades_already_covered_by_gainskeeper(
    existing_transactions: list[dict[str, Any]],
    incoming_transactions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    _merge_ibkr_closed_trade_metadata(existing_transactions, incoming_transactions)
    existing_gainskeeper_stock_trades = [
        record
        for record in existing_transactions
        if _is_ibkr_source_stock_trade(record, file_kind="gainskeeper")
    ]
    if not existing_gainskeeper_stock_trades:
        return incoming_transactions, 0

    retained: list[dict[str, Any]] = []
    superseded_count = 0
    for record in incoming_transactions:
        if not _is_ibkr_source_stock_trade(record, file_kind="transactions"):
            retained.append(record)
            continue
        if any(
            _is_ibkr_csv_gainskeeper_equivalent_stock_trade(existing_record, record)
            for existing_record in existing_gainskeeper_stock_trades
        ):
            superseded_count += 1
            continue
        retained.append(record)
    return retained, superseded_count


def _merge_candidate_index_keys(
    record: dict[str, Any],
    identity_key: tuple[str, ...],
) -> list[tuple[str, ...]]:
    """Return narrow candidate buckets for duplicate-record reconciliation.

    The precise pair predicates below remain the authority. These keys only
    prevent an incremental import from comparing every historical row with
    every other historical row before it can reach those predicates.
    """
    keys: list[tuple[str, ...]] = [("identity", *identity_key)]
    source = record.get("source") if isinstance(record.get("source"), dict) else {}
    manual_source_key = _manual_investment_source_row_identity_key(record)
    if manual_source_key:
        keys.append(("manual_source_row", *manual_source_key))

    broker = _ii_basics._normalize_broker_code(record.get("broker"))
    transaction_type = _normalize_text(record.get("type")).lower()
    if broker == "hsbc":
        order_reference = _normalize_text(
            source.get("statement_order_id") or source.get("order_id")
        )
        if transaction_type in {"buy", "sell"} and order_reference:
            keys.append(("hsbc_order_reference", order_reference))
        if transaction_type == "dividend":
            account = _normalize_text(record.get("account")) or _normalize_text(
                source.get("account")
                or source.get("account_number")
                or source.get("statement_account_number")
            )
            currency = _normalize_hsbc_currency_code(record.get("currency"))
            ticker = normalize_ticker(_normalize_text(record.get("ticker")))
            amount = _ii_basics._normalize_decimal_identity_token(
                record.get("net_amount_raw")
            )
            if account and currency and ticker and amount:
                keys.append(
                    (
                        "hsbc_dividend_event",
                        _ii_basics._account_identity_token("hsbc", account),
                        _normalize_text(record.get("date")),
                        ticker,
                        currency,
                        amount,
                    )
                )
        description = _normalize_whitespace(record.get("description")).upper()
        balance_after = _ii_basics._normalize_decimal_identity_token(
            source.get("balance_after_raw")
        )
        if (
            description.startswith(HSBC_CORPORATE_EVENT_PAYMENT_PREFIX)
            and balance_after
        ):
            account = _normalize_text(record.get("account")) or _normalize_text(
                source.get("account") or source.get("account_number")
            )
            keys.append(
                (
                    "hsbc_corporate_event_cash",
                    _ii_basics._account_identity_token("hsbc", account),
                    _normalize_text(record.get("date")),
                    _normalize_text(record.get("currency")).upper(),
                    _ii_basics._normalize_decimal_identity_token(
                        record.get("net_amount_raw")
                    ),
                    balance_after,
                )
            )
    elif broker == "ibkr":
        if transaction_type in {"buy", "sell"}:
            fitid_key = _ibkr_source_fitid_identity_key(record)
            if fitid_key:
                keys.append(fitid_key)
            keys.append(
                (
                    "ibkr_stock_trade",
                    transaction_type,
                    normalize_ticker(_normalize_text(record.get("ticker"))),
                    _normalize_text(record.get("currency")).upper(),
                    _ibkr_stock_identity_date_token(record, source),
                )
            )
        elif transaction_type == "forex_trade_component":
            account = _normalize_text(record.get("account")) or _normalize_text(
                source.get("account")
            )
            keys.append(
                (
                    "ibkr_forex_trade_component",
                    _ii_basics._account_identity_token(broker, account),
                    normalize_ticker(_normalize_text(record.get("ticker"))),
                    _ibkr_forex_identity_date_token(record, source),
                    _ii_basics._normalize_decimal_identity_token(
                        record.get("quantity_raw")
                    ),
                )
            )
    return keys


def _merge_slot_for_transaction(
    record: dict[str, Any],
    identity_key: tuple[str, ...],
    occurrences: dict[tuple[str, ...], int],
    merged_by_key: dict[tuple[tuple[str, ...], int], dict[str, Any]],
    candidate_slots: dict[tuple[str, ...], list[tuple[tuple[str, ...], int]]],
    slot_order: dict[tuple[tuple[str, ...], int], int],
) -> tuple[tuple[tuple[str, ...], int], bool]:
    if _is_fx_translation_pnl_record(record):
        return (identity_key, 0), False
    candidate_keys = {
        candidate_key
        for index_key in _merge_candidate_index_keys(record, identity_key)
        for candidate_key in candidate_slots.get(index_key, [])
        if candidate_key in merged_by_key
    }
    for existing_key in sorted(
        candidate_keys,
        key=lambda candidate_key: slot_order.get(candidate_key, 0),
    ):
        existing_record = merged_by_key[existing_key]
        record_fitid_key = _ibkr_source_fitid_identity_key(record)
        if (
            record_fitid_key
            and _ibkr_source_fitid_identity_key(existing_record) == record_fitid_key
        ):
            return existing_key, False
        if existing_key[0] == identity_key and _has_same_source_fitid(
            existing_record, record
        ):
            return existing_key, False
        if _investment_import_compat.has_same_hsbc_cash_source_row(
            existing_record,
            record,
        ):
            return existing_key, False
        if _has_same_manual_investment_source_row(existing_record, record):
            return existing_key, False
        if _has_same_hsbc_order_reference(existing_record, record):
            return existing_key, False
        if _has_same_hsbc_corporate_event_cash_record(existing_record, record):
            return existing_key, False
        if _has_same_hsbc_dividend_event(existing_record, record):
            return existing_key, False
        if _is_ibkr_csv_gainskeeper_equivalent_stock_trade(existing_record, record):
            return existing_key, False
        if _is_ibkr_web_trade_refinement_pair(existing_record, record):
            return existing_key, False
        if _is_ibkr_web_authoritative_precision_pair(existing_record, record):
            return existing_key, False
        if _is_ibkr_web_forex_authoritative_precision_pair(existing_record, record):
            return existing_key, False
    precision_slot = (identity_key, 0)
    existing_record = merged_by_key.get(precision_slot)
    if existing_record is not None:
        if _has_same_source_fitid(existing_record, record):
            return precision_slot, False
        if _is_ibkr_csv_gainskeeper_precision_pair(existing_record, record):
            return precision_slot, False
        if _is_ibkr_web_trade_refinement_pair(existing_record, record):
            return precision_slot, False
        if _is_ibkr_web_authoritative_precision_pair(existing_record, record):
            return precision_slot, False
        if _is_ibkr_web_forex_authoritative_precision_pair(existing_record, record):
            return precision_slot, False
    if _is_forex_trade_component_record(record):
        return precision_slot, False
    occurrence_index = occurrences.get(identity_key, 0)
    occurrences[identity_key] = occurrence_index + 1
    return (identity_key, occurrence_index), True
