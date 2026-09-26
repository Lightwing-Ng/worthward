"""Investment import domain: cmbwl.

Code version: v0.1.1
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    CMBWL_ACCOUNT_PATTERN,
    CMBWL_ACTION_PATTERN,
    CMBWL_CANCELLED_ORDER_PATTERN,
    CMBWL_CANCELLED_PRICE_PATTERN,
    CMBWL_CANCELLED_QTY_PATTERN,
    CMBWL_COMPLETED_ORDER_PATTERN,
    CMBWL_EXECUTED_PRICE_PATTERN,
    CMBWL_EXECUTED_QTY_PATTERN,
    CMBWL_ORDER_NO_PATTERN,
    CMBWL_SECURITIES_ORDER_TIMEZONE,
    CMBWL_SYMBOL_LINE_PATTERN,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    Path,
    SCHEMA_VERSION,
    ZERO,
    ZoneInfo,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _parse_decimal,
    date,
    email,
    json,
    normalize_ticker,
    parsedate_to_datetime,
    policy,
    re,
    timedelta,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.bindings as _ii_bindings

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries

import app.services.investment.importing.records as _ii_records


def _format_cmbwl_description(
    name: str,
    symbol: str,
    currency: str,
    *,
    ticker: str = "",
) -> str:
    normalized_name = _normalize_text(name)
    normalized_symbol = _normalize_text(symbol).upper()
    normalized_ticker = normalize_ticker(_normalize_text(ticker))
    normalized_currency = _normalize_text(currency).upper()

    if normalized_ticker.endswith(".HK"):
        return normalized_ticker
    if normalized_currency == "HKD" or re.fullmatch(r"\d{4,5}", normalized_symbol):
        return normalize_ticker(f"{normalized_symbol}.HK")
    return normalized_name or normalized_symbol


def _build_cmbwl_bonus_share_grant_record(
    *,
    grant_day: date,
    ticker: str,
    quantity_dec: Decimal,
    currency: str,
    description: str,
    account: str,
    related_sell_order_id: str,
) -> dict[str, Any]:
    grant_date = grant_day.isoformat()
    return {
        "date": grant_date,
        "datetime": f"{grant_date} {DEFAULT_CONVENTION_TIME}",
        "type": "grant",
        "currency": currency,
        "description": description,
        "ticker": ticker,
        "quantity_raw": _decimal_to_str(quantity_dec),
        "quantity_abs": _decimal_to_str(abs(quantity_dec)),
        "price_raw": "0",
        "gross_amount_raw": "0",
        "net_amount_raw": "0",
        "vesting_date": f"{grant_date} {DEFAULT_CONVENTION_TIME}",
        "broker": "cmbwl",
        "account": account,
        "source": {
            "file_kind": "cmbwl_bonus_share_grant",
            "transaction_type_raw": "Bonus Share Grant",
            "related_sell_order_id": related_sell_order_id,
            "broker": "cmbwl",
            "account": account,
        },
        "normalized": _build_normalized_view(
            "grant",
            quantity_dec,
            ZERO,
            ZERO,
            None,
            ZERO,
            is_cash_flow_override=False,
            side_override="buy",
        ),
    }


def _infer_cmbwl_bonus_share_grant_day(
    sell_day: date,
    *,
    prior_buy_days: list[date],
) -> date:
    eligible_buy_days = [day for day in prior_buy_days if day <= sell_day]
    if eligible_buy_days:
        return max(eligible_buy_days)
    return sell_day - timedelta(days=1)


def _synthesize_cmbwl_bonus_share_grants(
    transactions: list[dict[str, Any]],
    *,
    account: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    trade_records = [
        record
        for record in transactions
        if _ii_basics._normalize_broker_code(record.get("broker")) == "cmbwl"
        and _normalize_text(record.get("type")).lower() in {"buy", "sell"}
    ]
    if not trade_records:
        return []

    ordered_records = sorted(
        trade_records,
        key=lambda item: (
            _normalize_text(item.get("date")),
            _normalize_text(item.get("datetime")) or _normalize_text(item.get("date")),
            0 if _normalize_text(item.get("type")).lower() == "buy" else 1,
            _normalize_text(item.get("source", {}).get("order_id")),
        ),
    )

    holdings: dict[str, Decimal] = {}
    buy_days_by_ticker: dict[str, list[date]] = {}
    grants: list[dict[str, Any]] = []
    for record in ordered_records:
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        txn_type = _normalize_text(record.get("type")).lower()
        quantity_dec = _ii_records._transaction_quantity_for_replay(record)
        if not ticker or quantity_dec is None:
            continue

        if txn_type == "buy":
            holdings[ticker] = holdings.get(ticker, ZERO) + quantity_dec
            trade_day = _ii_basics._parse_longbridge_date(
                _normalize_text(record.get("date")),
                "CMB Wing Lung trade date",
            )
            buy_days_by_ticker.setdefault(ticker, []).append(trade_day)
            continue

        if txn_type != "sell":
            continue

        available = holdings.get(ticker, ZERO)
        deficit = quantity_dec - available
        if deficit <= ZERO:
            holdings[ticker] = available - quantity_dec
            if holdings[ticker] == ZERO:
                holdings.pop(ticker, None)
            continue

        sell_day = _ii_basics._parse_longbridge_date(
            _normalize_text(record.get("date")),
            "CMB Wing Lung sell date",
        )
        grant_day = _infer_cmbwl_bonus_share_grant_day(
            sell_day,
            prior_buy_days=buy_days_by_ticker.get(ticker, []),
        )
        related_sell_order_id = _normalize_text(
            record.get("source", {}).get("order_id")
            or record.get("source", {}).get("statement_order_id")
        )
        display_description = _format_cmbwl_description(
            _normalize_text(record.get("description")),
            _normalize_text(record.get("source", {}).get("symbol")),
            _normalize_text(record.get("currency")),
            ticker=ticker,
        )
        grants.append(
            _build_cmbwl_bonus_share_grant_record(
                grant_day=grant_day,
                ticker=ticker,
                quantity_dec=deficit,
                currency=_normalize_text(record.get("currency")).upper() or "USD",
                description=f"Bonus shares (赠股): {display_description}",
                account=account,
                related_sell_order_id=related_sell_order_id,
            )
        )
        warnings.append(
            f"CMB Wing Lung {ticker}: inferred {deficit} bonus share(s) (赠股) before sell order {related_sell_order_id or 'unknown'}."
        )
        holdings[ticker] = available + deficit - quantity_dec
        if holdings[ticker] == ZERO:
            holdings.pop(ticker, None)

    return grants


def _normalize_cmbwl_hk_ticker_code(symbol: str) -> str:
    normalized_symbol = _normalize_text(symbol).upper()
    if not re.fullmatch(r"\d{4,5}", normalized_symbol):
        return normalized_symbol
    return normalized_symbol.lstrip("0") or normalized_symbol


def _infer_cmbwl_ticker(symbol: str, currency: str) -> str:
    normalized_symbol = _normalize_text(symbol).upper()
    if not normalized_symbol:
        return ""
    if normalized_symbol.endswith((".US", ".HK")):
        if normalized_symbol.endswith(".HK"):
            hk_symbol, _, hk_suffix = normalized_symbol.partition(".")
            return normalize_ticker(
                f"{_normalize_cmbwl_hk_ticker_code(hk_symbol)}.{hk_suffix}"
            )
        return normalize_ticker(normalized_symbol)
    if currency == "HKD" or re.fullmatch(r"\d{4,5}", normalized_symbol):
        return normalize_ticker(
            f"{_normalize_cmbwl_hk_ticker_code(normalized_symbol)}.HK"
        )
    return normalize_ticker(f"{normalized_symbol}.US")


def _parse_cmbwl_securities_order_eml(
    eml_bytes: bytes,
    *,
    source_filename: str,
    warnings: list[str],
) -> dict[str, Any] | None:
    if not eml_bytes:
        warnings.append(f"{source_filename}: the email file is empty.")
        return None

    message = email.message_from_bytes(eml_bytes, policy=policy.default)
    body = ""
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_content()
                break
    else:
        body = message.get_content()

    normalized_body = _normalize_text(body)
    if not normalized_body:
        warnings.append(f"{source_filename}: no plain-text body was found.")
        return None

    is_cancelled = bool(CMBWL_CANCELLED_ORDER_PATTERN.search(normalized_body))
    is_completed = bool(CMBWL_COMPLETED_ORDER_PATTERN.search(normalized_body))
    if not is_cancelled and not is_completed:
        warnings.append(
            f"{source_filename}: could not determine whether the order was completed or cancelled."
        )
        return None

    account_match = CMBWL_ACCOUNT_PATTERN.search(normalized_body)
    account = account_match.group(1) if account_match else ""
    email_datetime = parsedate_to_datetime(message.get("Date", ""))
    if email_datetime.tzinfo is None:
        email_datetime = email_datetime.replace(
            tzinfo=ZoneInfo(CMBWL_SECURITIES_ORDER_TIMEZONE)
        )
    local_datetime = email_datetime.astimezone(
        ZoneInfo(CMBWL_SECURITIES_ORDER_TIMEZONE)
    )
    trade_day = local_datetime.date().isoformat()

    parsed: dict[str, str] = {}
    for line in normalized_body.splitlines():
        candidate = _normalize_text(line)
        if not candidate:
            continue
        symbol_match = CMBWL_SYMBOL_LINE_PATTERN.match(candidate)
        if symbol_match and "symbol" not in parsed:
            parsed["name"] = symbol_match.group(1).strip()
            parsed["symbol"] = symbol_match.group(2).strip()
        action_match = CMBWL_ACTION_PATTERN.match(candidate)
        if action_match:
            parsed["action"] = action_match.group(1).lower()
        qty_match = CMBWL_EXECUTED_QTY_PATTERN.match(candidate)
        if qty_match:
            parsed["quantity"] = qty_match.group(1).replace(",", "")
        cancelled_qty_match = CMBWL_CANCELLED_QTY_PATTERN.match(candidate)
        if cancelled_qty_match and "quantity" not in parsed:
            parsed["quantity"] = cancelled_qty_match.group(1).replace(",", "")
        price_match = CMBWL_EXECUTED_PRICE_PATTERN.match(candidate)
        if price_match:
            parsed["currency"] = price_match.group(1).upper()
            parsed["price"] = price_match.group(2).replace(",", "")
        cancelled_price_match = CMBWL_CANCELLED_PRICE_PATTERN.match(candidate)
        if cancelled_price_match and "price" not in parsed:
            parsed["currency"] = cancelled_price_match.group(1).upper()
            parsed["price"] = cancelled_price_match.group(2).replace(",", "")
        order_match = CMBWL_ORDER_NO_PATTERN.match(candidate)
        if order_match:
            parsed["order_no"] = order_match.group(1)

    side = parsed.get("action")
    if side not in {"bought", "sold"}:
        warnings.append(f"{source_filename}: unsupported or missing trade action.")
        return None
    if is_cancelled and side != "sold":
        return None

    mapped_type = "buy" if side == "bought" else "sell"
    quantity_dec = _parse_decimal(
        parsed.get("quantity"), "executed quantity", 0, warnings
    )
    price_dec = _parse_decimal(parsed.get("price"), "executed price", 0, warnings)
    if (
        quantity_dec is None
        or quantity_dec <= ZERO
        or price_dec is None
        or price_dec <= ZERO
    ):
        warnings.append(
            f"{source_filename}: missing executed quantity or price for order {parsed.get('order_no') or 'unknown'}."
        )
        return None

    currency = _normalize_text(parsed.get("currency")).upper() or "USD"
    symbol = _infer_cmbwl_ticker(parsed.get("symbol", ""), currency)
    if not symbol:
        warnings.append(f"{source_filename}: missing stock symbol.")
        return None

    gross_amount_dec = abs(quantity_dec * price_dec)
    signed_amount_dec = -gross_amount_dec if mapped_type == "buy" else gross_amount_dec
    raw_symbol = _normalize_text(parsed.get("symbol"))
    description = _format_cmbwl_description(
        _normalize_text(parsed.get("name")),
        raw_symbol,
        currency,
        ticker=symbol,
    )
    order_no = _normalize_text(parsed.get("order_no"))
    order_notification_status = "cancelled" if is_cancelled else "completed"
    if is_cancelled:
        warnings.append(
            f"{source_filename}: recorded cancelled sell notification for order {order_no or 'unknown'}."
        )
    return {
        "date": trade_day,
        "datetime": f"{trade_day} {DEFAULT_CONVENTION_TIME}",
        "type": mapped_type,
        "ticker": symbol,
        "currency": currency,
        "description": description,
        "source": {
            "file_kind": "cmbwl_securities_order_eml",
            "source_filename": source_filename,
            "transaction_type_raw": side,
            "order_id": order_no,
            "statement_order_id": order_no,
            "order_notification_status": order_notification_status,
            "symbol": raw_symbol,
            "email_datetime": local_datetime.isoformat(),
            "broker": "cmbwl",
            "account": account,
        },
        "quantity_raw": _decimal_to_str(abs(quantity_dec)),
        "quantity_abs": _decimal_to_str(abs(quantity_dec)),
        "price_raw": _decimal_to_str(price_dec),
        "gross_amount_raw": _decimal_to_str(signed_amount_dec),
        "commission_raw": "0",
        "net_amount_raw": _decimal_to_str(signed_amount_dec),
        "broker": "cmbwl",
        "account": account,
        "normalized": _build_normalized_view(
            mapped_type,
            abs(quantity_dec),
            price_dec,
            signed_amount_dec,
            ZERO,
            signed_amount_dec,
        ),
    }


def build_investment_payload_from_cmbwl_securities_order_emls(
    eml_payloads: list[tuple[bytes, str]],
) -> dict[str, Any]:
    if not eml_payloads:
        raise ValueError("Upload at least one CMB Wing Lung securities order email.")

    warnings: list[str] = []
    transactions: list[dict[str, Any]] = []
    seen_order_ids: set[str] = set()
    account = ""
    cancelled_buy_count = 0
    cancelled_sell_count = 0
    for eml_bytes, source_filename in eml_payloads:
        if not eml_bytes:
            warnings.append(f"{source_filename}: the email file is empty.")
            continue
        message = email.message_from_bytes(eml_bytes, policy=policy.default)
        body = ""
        if message.is_multipart():
            for part in message.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_content()
                    break
        else:
            body = message.get_content()
        normalized_body = _normalize_text(body)
        is_cancelled = bool(CMBWL_CANCELLED_ORDER_PATTERN.search(normalized_body))
        if is_cancelled:
            cancelled_side = ""
            for line in normalized_body.splitlines():
                action_match = CMBWL_ACTION_PATTERN.match(_normalize_text(line))
                if action_match:
                    cancelled_side = action_match.group(1).lower()
                    break
            if cancelled_side != "sold":
                cancelled_buy_count += 1
                continue
            cancelled_sell_count += 1

        record = _parse_cmbwl_securities_order_eml(
            eml_bytes,
            source_filename=source_filename,
            warnings=warnings,
        )
        if record is None:
            continue
        order_id = _normalize_text(record.get("source", {}).get("order_id"))
        if order_id:
            if order_id in seen_order_ids:
                warnings.append(
                    f"{source_filename}: duplicate order {order_id!r} was skipped."
                )
                continue
            seen_order_ids.add(order_id)
        record_account = _normalize_text(record.get("account"))
        if record_account:
            if account and account != record_account:
                warnings.append(
                    "Multiple CMB Wing Lung account numbers were detected across the uploaded emails."
                )
            account = account or record_account
        transactions.append(record)

    if cancelled_buy_count:
        warnings.append(
            f"Skipped {cancelled_buy_count} cancelled CMB Wing Lung buy notification(s)."
        )
    if cancelled_sell_count:
        warnings.append(
            f"Recorded {cancelled_sell_count} cancelled CMB Wing Lung sell notification(s) as executed sells."
        )
    if not transactions:
        raise ValueError(
            "No completed CMB Wing Lung securities orders were parsed from the uploaded emails."
        )

    grant_records = _synthesize_cmbwl_bonus_share_grants(
        transactions,
        account=account,
        warnings=warnings,
    )
    if grant_records:
        transactions.extend(grant_records)

    _ii_records._sort_transactions(transactions)
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "cmbwl_securities_order_eml_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": _ii_basics._now_iso(),
            "source_email_count": len(eml_payloads),
            "completed_order_count": len(transactions) - len(grant_records),
            "bonus_share_grant_count": len(grant_records),
            "cancelled_buy_notification_count": cancelled_buy_count,
            "cancelled_sell_notification_count": cancelled_sell_count,
        },
        "broker": "cmbwl",
        "account": account or None,
        "datetime_policy": {
            "date_field_meaning": (
                "Trading date derived from the CMB Wing Lung securities order email timestamp"
            ),
            "datetime_field_meaning": (
                "Business-convention datetime derived from the email date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": CMBWL_SECURITIES_ORDER_TIMEZONE,
            "source_has_intraday_timestamp": True,
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
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def build_investment_payload_from_cmbwl_securities_order_eml_paths(
    eml_paths: list[str | Path],
) -> dict[str, Any]:
    payloads: list[tuple[bytes, str]] = []
    for raw_path in eml_paths:
        path = Path(raw_path)
        payloads.append((path.read_bytes(), path.name))
    return build_investment_payload_from_cmbwl_securities_order_emls(payloads)
