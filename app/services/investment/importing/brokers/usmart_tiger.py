"""Investment import domain: usmart tiger.

Code version: v0.1.1
"""

from __future__ import annotations

from app.services.investment.importing.support import (
    Any,
    DEFAULT_CONVENTION_TIME,
    Decimal,
    LOGGER,
    SCHEMA_VERSION,
    TIGERTRADE_ACCOUNT_PATTERN,
    TIGERTRADE_FOREX_PATTERN,
    TIGERTRADE_FUND_PATTERN,
    TIGERTRADE_IMPORTER_VERSION,
    TIGERTRADE_PERIOD_PATTERN,
    TIGERTRADE_STOCK_PATTERN,
    TIGERTRADE_US_TIMEZONE,
    USMART_HK_ACCOUNT_PATTERN,
    USMART_HK_CASH_ROW_PATTERN,
    USMART_HK_IMPORTER_VERSION,
    USMART_HK_PERIOD_PATTERN,
    USMART_HK_TIMEZONE,
    USMART_HK_TRADE_PATTERN,
    ZERO,
    _build_normalized_view,
    _decimal_to_str,
    _normalize_text,
    _normalize_whitespace,
    json,
    normalize_ticker,
    re,
    subprocess,
    tempfile,
)

import app.services.investment.importing.basics as _ii_basics

import app.services.investment.importing.bindings as _ii_bindings

import app.services.investment.importing.brokers.hsbc.cash as _ii_hsbc_cash

import app.services.investment.importing.merge.operations as _ii_merge

import app.services.investment.importing.merge.reconciliation as _ii_merge_reconciliation

import app.services.investment.importing.payload_summaries as _ii_payload_summaries

import app.services.investment.importing.records as _ii_records

from app.services.investment.importing import compat as _investment_import_compat


def _extract_statement_pdf_text(pdf_bytes: bytes, broker_label: str) -> str:
    if not pdf_bytes:
        raise ValueError(f"The uploaded {broker_label} statement PDF is empty.")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temp_file:
        temp_file.write(pdf_bytes)
        temp_file.flush()
        try:
            completed = subprocess.run(
                ["pdftotext", "-layout", temp_file.name, "-"],
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError as exc:
            raise ValueError(
                f"Could not extract text from the {broker_label} statement PDF because pdftotext is not installed."
            ) from exc
    if completed.returncode != 0:
        detail = (
            completed.stderr.strip() or completed.stdout.strip() or "pdftotext failed."
        )
        LOGGER.warning(
            "pdftotext failed while extracting a %s statement PDF: %s",
            broker_label,
            detail,
        )
        raise ValueError(
            f"Could not extract text from the {broker_label} statement PDF. "
            "Make sure pdftotext is installed and that the PDF is valid."
        )
    if not completed.stdout.strip():
        raise ValueError(
            f"The uploaded {broker_label} statement PDF contains no extractable text."
        )
    return completed.stdout


def _statement_decimal(value: str) -> Decimal:
    return Decimal(value.replace(",", "").strip())


def _statement_record(
    *,
    broker: str,
    account: str | None,
    file_kind: str,
    source_filename: str,
    row_number: int,
    transaction_type: str,
    transaction_date: str,
    currency: str,
    amount: Decimal,
    description: str,
    ticker: str | None = None,
    quantity: Decimal | None = None,
    price: Decimal | None = None,
    gross: Decimal | None = None,
    commission: Decimal | None = None,
    datetime_text: str | None = None,
    source_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    effective_gross = amount if gross is None else gross
    source: dict[str, Any] = {
        "file_kind": file_kind,
        "source_filename": source_filename,
        "row_number": row_number,
        "transaction_type_raw": transaction_type,
        "broker": broker,
        "statement_currency_raw": currency,
    }
    if account:
        source["account"] = account
    if source_extra:
        source.update(source_extra)
    record: dict[str, Any] = {
        "date": transaction_date,
        "datetime": datetime_text
        or _ii_basics._build_convention_datetime(transaction_date),
        "type": transaction_type,
        "currency": currency,
        "description": description,
        "source": source,
        "gross_amount_raw": _decimal_to_str(effective_gross),
        "net_amount_raw": _decimal_to_str(amount),
        "broker": broker,
    }
    if account:
        record["account"] = account
    if ticker:
        record["ticker"] = normalize_ticker(ticker)
    if quantity is not None:
        record["quantity_raw"] = _decimal_to_str(abs(quantity))
        record["quantity_abs"] = _decimal_to_str(abs(quantity))
    if price is not None:
        record["price_raw"] = _decimal_to_str(price)
    if commission is not None:
        record["commission_raw"] = _decimal_to_str(commission)
        record["commission_abs"] = _decimal_to_str(abs(commission))
    record["normalized"] = _build_normalized_view(
        transaction_type,
        abs(quantity) if quantity is not None else None,
        price,
        effective_gross,
        commission,
        amount,
        is_cash_flow_override=transaction_type not in {"buy", "sell"},
    )
    return record


def _statement_cash_reconciliation(
    transactions: list[dict[str, Any]],
    currencies: tuple[str, ...],
) -> dict[str, dict[str, str | bool]]:
    totals = {currency: ZERO for currency in currencies}
    for transaction in transactions:
        source = (
            transaction.get("source")
            if isinstance(transaction.get("source"), dict)
            else {}
        )
        currency = _normalize_text(
            source.get("statement_currency_raw") or transaction.get("currency")
        ).upper()
        if currency not in totals:
            continue
        amount = _ii_hsbc_cash._parse_decimal_text_or_none(
            transaction.get("net_amount_raw")
        )
        if amount is not None:
            totals[currency] += amount
    return {
        currency: {
            "starting_cash": "0.00",
            "parsed_net_change": _decimal_to_str(total),
            "ending_cash": "0.00",
            "reconciled": abs(total) <= Decimal("0.01"),
        }
        for currency, total in totals.items()
    }


def _build_statement_payload(
    *,
    broker: str,
    importer_name: str,
    importer_version: str,
    account: str | None,
    source_filename: str,
    statement_period: str,
    timezone_name: str,
    transactions: list[dict[str, Any]],
    warnings: list[str],
    currencies: tuple[str, ...],
) -> dict[str, Any]:
    _ii_records._sort_transactions(transactions)
    reconciliation = _statement_cash_reconciliation(transactions, currencies)
    for currency, result in reconciliation.items():
        if not result["reconciled"]:
            warnings.append(
                f"{broker} {currency} cash did not reconcile to zero; parsed net change is {result['parsed_net_change']}."
            )
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": importer_name,
            "version": importer_version,
            "generated_at": _ii_basics._now_iso(),
            "source_filename": source_filename,
            "statement_period": statement_period,
        },
        "broker": broker,
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Trading or booking date from the broker statement PDF",
            "datetime_field_meaning": "Statement timestamp when present; otherwise the project business-convention time",
            "timezone": timezone_name,
            "source_has_intraday_timestamp": True,
        },
        "summary": _ii_payload_summaries._build_summary(
            transactions=transactions,
            warnings=warnings,
            unknown_types=[],
            holdings_mismatches=[],
            open_position_snapshots={},
            performance_snapshots={},
            starting_cash="0.00",
            ending_cash="0.00",
        ),
        "starting_cash": "0.00",
        "ending_cash": "0.00",
        "position_snapshot": {},
        "performance_snapshot": {},
        "transactions": transactions,
    }
    payload["summary"]["position_snapshot_authoritative"] = True
    payload["summary"]["cash_reconciliation"] = reconciliation
    payload["summary"]["statement_period"] = statement_period
    _ii_merge_reconciliation._stamp_payload_transaction_context(payload)
    _ii_payload_summaries._attach_broker_summaries(payload)
    _ii_bindings.normalize_investment_payload_tickers(payload)
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    )
    return payload


def _usmart_hk_trade_records(
    text: str,
    *,
    account: str | None,
    source_filename: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    lines = text.splitlines()
    records: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        match = USMART_HK_TRADE_PATTERN.search(line)
        if match is None:
            continue
        ticker = ""
        for candidate_index in range(index, max(-1, index - 4), -1):
            ticker_match = re.search(
                r"(?:^|\s)([A-Z][A-Z0-9.]{0,15})\s*\(", lines[candidate_index]
            )
            if ticker_match:
                ticker = ticker_match.group(1)
                break
        if not ticker:
            warnings.append(
                f"uSMART (HK) trade row {index + 1}: could not identify the security symbol."
            )

        net_amount: Decimal | None = None
        statement_order_id = ""
        for candidate in lines[index + 1 : index + 40]:
            if USMART_HK_TRADE_PATTERN.search(candidate):
                break
            net_match = re.search(r"總變動⾦額\s+(-?[\d,]+\.\d+)", candidate)
            if net_match and net_amount is None:
                net_amount = _statement_decimal(net_match.group(1))
            order_match = re.match(r"^\s*(\d{8,})\s+", candidate)
            if order_match:
                statement_order_id = order_match.group(1)
        side = "buy" if match.group("side") in {"買⼊", "買入"} else "sell"
        gross_abs = _statement_decimal(match.group("gross"))
        gross = -gross_abs if side == "buy" else gross_abs
        if net_amount is None:
            warnings.append(
                f"uSMART (HK) trade row {index + 1}: missing total change; gross amount was used."
            )
            net_amount = gross
        commission = net_amount - gross
        trade_date = match.group("trade_date")
        records.append(
            _statement_record(
                broker="usmart_hk",
                account=account,
                file_kind="usmart_hk_statement_pdf",
                source_filename=source_filename,
                row_number=index + 1,
                transaction_type=side,
                transaction_date=trade_date,
                currency=match.group("currency"),
                amount=net_amount,
                description=f"uSMART (HK) {ticker or 'security'} {match.group('side')}",
                ticker=ticker or None,
                quantity=_statement_decimal(match.group("quantity")),
                price=_statement_decimal(match.group("price")),
                gross=gross,
                commission=commission,
                source_extra={"statement_order_id": statement_order_id}
                if statement_order_id
                else None,
            )
        )
    return records


def _pair_usmart_hk_forex_records(records: list[dict[str, Any]]) -> None:
    groups: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = {}
    for record in records:
        if record.get("type") != "forex_trade_component":
            continue
        currency = _normalize_text(record.get("currency")).upper()
        amount = (
            _ii_hsbc_cash._parse_decimal_text_or_none(record.get("net_amount_raw"))
            or ZERO
        )
        direction = (
            "hkd_to_usd"
            if (currency == "HKD" and amount < ZERO)
            or (currency == "USD" and amount > ZERO)
            else "usd_to_hkd"
        )
        groups.setdefault((record["date"], direction), {}).setdefault(
            currency, []
        ).append(record)

    for (transaction_date, direction), currency_rows in groups.items():
        hkd_rows = currency_rows.get("HKD", [])
        usd_rows = currency_rows.get("USD", [])
        pair_count = max(len(hkd_rows), len(usd_rows))
        for pair_index in range(pair_count):
            description = (
                f"FX from HKD to USD #{pair_index + 1}"
                if direction == "hkd_to_usd"
                else f"FX from USD to HKD #{pair_index + 1}"
            )
            pair = [
                rows[pair_index]
                for rows in (hkd_rows, usd_rows)
                if pair_index < len(rows)
            ]
            hkd_amount = next(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(row.get("net_amount_raw"))
                    for row in pair
                    if row.get("currency") == "HKD"
                ),
                None,
            )
            usd_amount = next(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(row.get("net_amount_raw"))
                    for row in pair
                    if row.get("currency") == "USD"
                ),
                None,
            )
            rate = (
                abs(hkd_amount / usd_amount)
                if hkd_amount is not None and usd_amount not in {None, ZERO}
                else None
            )
            for record in pair:
                record["description"] = description
                record["source"]["execution_key"] = (
                    f"{transaction_date}:{direction}:{pair_index + 1}:{record['currency']}"
                )
                if record["currency"] == "HKD":
                    record["ticker"] = "USD.HKD"
                    if rate is not None:
                        record["price_raw"] = _decimal_to_str(rate)
                        record["normalized"]["unit_price"] = _decimal_to_str(rate)
                else:
                    record["ticker"] = "USD"


def _usmart_hk_cash_records(
    text: str,
    *,
    account: str | None,
    source_filename: str,
) -> list[dict[str, Any]]:
    section = text.split("資⾦出⼊", 1)[1] if "資⾦出⼊" in text else ""
    if "證券提存" in section:
        section = section.split("證券提存", 1)[0]
    records: list[dict[str, Any]] = []
    for index, line in enumerate(section.splitlines(), start=1):
        match = USMART_HK_CASH_ROW_PATTERN.match(line)
        if match is None:
            continue
        item = match.group("item")
        currency = match.group("currency")
        amount = _statement_decimal(match.group("amount"))
        transaction_date = match.group("date")
        if item in {"買⼊股票", "買入股票", "賣出股票"}:
            continue
        if item == "貨幣兌換":
            transaction_type = "forex_trade_component"
            ticker = "USD.HKD" if currency == "HKD" else "USD"
            description = "FX conversion"
            commission = None
        elif item in {"存款", "EDDA⼊⾦", "EDDA入金"}:
            transaction_type = "deposit"
            ticker = None
            description = "Cash Deposit" if item == "存款" else "eDDA Cash Deposit"
            commission = None
        elif item == "提款":
            transaction_type = "withdrawal"
            ticker = None
            description = "Cash Withdrawal"
            commission = None
        elif item == "優惠券":
            transaction_type = "kol_reward"
            ticker = None
            description = "Coupon"
            commission = None
        elif item in {"買碎股", "买碎股"}:
            transaction_type = "buy"
            ticker = None
            description = "Fractional Shares Purchase (symbol unavailable in statement)"
            commission = None
        elif item in {"賣碎股", "卖碎股"}:
            transaction_type = "sell"
            ticker = None
            description = "Fractional Shares Sale (symbol unavailable in statement)"
            commission = None
        elif "⼿續費" in item or "手续费" in item:
            transaction_type = "fee"
            ticker = None
            description = "Fractional Shares Commission"
            commission = amount
        else:
            transaction_type = "adjustment"
            ticker = None
            description = item
            commission = None
        records.append(
            _statement_record(
                broker="usmart_hk",
                account=account,
                file_kind="usmart_hk_statement_pdf",
                source_filename=source_filename,
                row_number=index,
                transaction_type=transaction_type,
                transaction_date=transaction_date,
                currency=currency,
                amount=amount,
                description=description,
                ticker=ticker,
                commission=commission,
                source_extra={"statement_item_raw": item},
            )
        )
    _pair_usmart_hk_forex_records(records)
    return records


def build_investment_payload_from_usmart_hk_statement_pdf(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
) -> dict[str, Any]:
    text = _investment_import_compat.extract_statement_pdf_text(
        pdf_bytes, "uSMART (HK)"
    )
    if "uSmart Securities Limited" not in text:
        raise ValueError(
            "The uploaded PDF is not a recognized uSMART (HK) monthly statement."
        )
    account_match = USMART_HK_ACCOUNT_PATTERN.search(text)
    period_match = USMART_HK_PERIOD_PATTERN.search(text)
    account = account_match.group(1) if account_match else None
    statement_period = period_match.group(1) if period_match else ""
    warnings: list[str] = []
    transactions = _usmart_hk_trade_records(
        text,
        account=account,
        source_filename=source_filename,
        warnings=warnings,
    )
    transactions.extend(
        _usmart_hk_cash_records(
            text,
            account=account,
            source_filename=source_filename,
        )
    )
    if not transactions:
        raise ValueError(
            "No supported transactions were found in the uSMART (HK) statement PDF."
        )
    payload = _build_statement_payload(
        broker="usmart_hk",
        importer_name="usmart_hk_statement_pdf_to_investment_json",
        importer_version=USMART_HK_IMPORTER_VERSION,
        account=account,
        source_filename=source_filename,
        statement_period=statement_period,
        timezone_name=USMART_HK_TIMEZONE,
        transactions=transactions,
        warnings=warnings,
        currencies=("HKD", "USD"),
    )
    reward_rows = [
        transaction
        for transaction in transactions
        if transaction.get("type") == "kol_reward"
    ]
    payload["summary"]["statement_calibrations"] = {
        "coupon_count": len(reward_rows),
        "coupon_amount_hkd": _decimal_to_str(
            sum(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        transaction.get("net_amount_raw")
                    )
                    or ZERO
                )
                for transaction in reward_rows
            )
        ),
    }
    return payload


def _nearby_statement_date(lines: list[str], index: int, *, lookback: int = 6) -> str:
    for candidate_index in range(index, max(-1, index - lookback), -1):
        dates = re.findall(r"\d{4}-\d{2}-\d{2}", lines[candidate_index])
        if dates:
            return dates[-1]
    return ""


def _nearby_statement_ticker(lines: list[str], index: int) -> str:
    for candidate_index in list(range(index, min(len(lines), index + 7))) + list(
        range(index - 1, max(-1, index - 6), -1)
    ):
        match = re.search(r"\(([A-Z][A-Z0-9.]{0,24})\)", lines[candidate_index])
        if match:
            return match.group(1)
    return ""


def _nearby_statement_time(lines: list[str], index: int) -> str:
    for candidate_index in range(max(0, index - 3), min(len(lines), index + 5)):
        match = re.search(r"(\d{2}:\d{2}:\d{2})", lines[candidate_index])
        if match:
            return match.group(1)
    return DEFAULT_CONVENTION_TIME


def _tigertrade_forex_records(
    lines: list[str],
    *,
    account: str | None,
    source_filename: str,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        match = TIGERTRADE_FOREX_PATTERN.match(line)
        if match is None:
            continue
        trade_date = _nearby_statement_date(lines, index, lookback=3)
        if not trade_date:
            continue
        quantity = _statement_decimal(match.group("quantity"))
        quote_amount = _statement_decimal(match.group("amount"))
        price = _statement_decimal(match.group("price"))
        base_currency, quote_currency = match.group("ticker").split(".", 1)
        side = match.group("side").lower()
        base_amount = abs(quantity) if side == "buy" else -abs(quantity)
        description = (
            f"FX from {quote_currency} to {base_currency}"
            if side == "buy"
            else f"FX from {base_currency} to {quote_currency}"
        )
        execution_key = f"{trade_date}:{_nearby_statement_time(lines, index)}:{match.group('ticker')}:{side}"
        common_extra = {
            "execution_key": execution_key,
            "statement_settlement_date": match.group("settle_date"),
            "statement_activity_raw": match.group("side"),
        }
        records.append(
            _statement_record(
                broker="tigertrade",
                account=account,
                file_kind="tigertrade_statement_pdf",
                source_filename=source_filename,
                row_number=index + 1,
                transaction_type="forex_trade_component",
                transaction_date=trade_date,
                currency=quote_currency,
                amount=quote_amount,
                description=description,
                ticker=match.group("ticker"),
                quantity=abs(quantity),
                price=price,
                datetime_text=f"{trade_date} {_nearby_statement_time(lines, index)}",
                source_extra={**common_extra, "forex_leg": "quote"},
            )
        )
        records.append(
            _statement_record(
                broker="tigertrade",
                account=account,
                file_kind="tigertrade_statement_pdf",
                source_filename=source_filename,
                row_number=index + 1,
                transaction_type="forex_trade_component",
                transaction_date=trade_date,
                currency=base_currency,
                amount=base_amount,
                description=description,
                ticker=base_currency,
                quantity=abs(quantity),
                price=Decimal("1"),
                datetime_text=f"{trade_date} {_nearby_statement_time(lines, index)}",
                source_extra={**common_extra, "forex_leg": "base"},
            )
        )
    return records


def _tigertrade_stock_fee(lines: list[str], index: int) -> Decimal:
    total = ZERO
    for label in ("Other Tripartite fees", "SEC Fee", "Commission", "Platform Fee"):
        for label_index in range(max(0, index - 3), min(len(lines), index + 5)):
            if label.lower() not in lines[label_index].lower():
                continue
            label_offset = lines[label_index].lower().find(label.lower()) + len(label)
            amount_match = re.search(
                r"-\d[\d,]*\.\d{2}\b", lines[label_index][label_offset:]
            )
            if amount_match is None and label_index + 1 < len(lines):
                amount_match = re.search(r"-\d[\d,]*\.\d{2}\b", lines[label_index + 1])
            if amount_match:
                total += _statement_decimal(amount_match.group(0))
            break
    return total


def _tigertrade_stock_records(
    lines: list[str],
    *,
    account: str | None,
    source_filename: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        match = TIGERTRADE_STOCK_PATTERN.search(line)
        if match is None:
            continue
        ticker = _nearby_statement_ticker(lines, index)
        trade_date = _nearby_statement_date(lines, index)
        if not ticker or not trade_date:
            warnings.append(
                f"Tiger Trade stock row {index + 1}: missing ticker or trade date."
            )
            continue
        side = "buy" if match.group("activity") == "Open" else "sell"
        gross = (
            -abs(_statement_decimal(match.group("amount")))
            if side == "buy"
            else abs(_statement_decimal(match.group("amount")))
        )
        commission = _tigertrade_stock_fee(lines, index)
        net = gross + commission
        records.append(
            _statement_record(
                broker="tigertrade",
                account=account,
                file_kind="tigertrade_statement_pdf",
                source_filename=source_filename,
                row_number=index + 1,
                transaction_type=side,
                transaction_date=trade_date,
                currency="USD",
                amount=net,
                description=f"Tiger Trade {ticker} {match.group('activity')}",
                ticker=ticker,
                quantity=abs(_statement_decimal(match.group("quantity"))),
                price=_statement_decimal(match.group("price")),
                gross=gross,
                commission=commission,
                datetime_text=f"{trade_date} {_nearby_statement_time(lines, index)}",
                source_extra={
                    "statement_activity_raw": match.group("activity"),
                    "exchange": match.group("exchange"),
                },
            )
        )
    return records


def _tigertrade_fund_records(
    lines: list[str],
    *,
    account: str | None,
    source_filename: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        match = TIGERTRADE_FUND_PATTERN.search(line)
        if match is None:
            continue
        ticker = ""
        for candidate_index in range(max(0, index - 4), min(len(lines), index + 6)):
            ticker_match = re.search(r"\((HK\d+\.USD)\)", lines[candidate_index])
            if ticker_match:
                ticker = ticker_match.group(1)
                break
        trade_date = _nearby_statement_date(lines, index)
        if not ticker or not trade_date:
            warnings.append(
                f"Tiger Trade fund row {index + 1}: missing ticker or trade date."
            )
            continue
        side = "buy" if match.group("activity") == "Buy" else "sell"
        gross = (
            -abs(_statement_decimal(match.group("amount")))
            if side == "buy"
            else abs(_statement_decimal(match.group("amount")))
        )
        fee = _statement_decimal(match.group("fee"))
        commission = -abs(fee) if fee else ZERO
        net = gross + commission
        records.append(
            _statement_record(
                broker="tigertrade",
                account=account,
                file_kind="tigertrade_statement_pdf",
                source_filename=source_filename,
                row_number=index + 1,
                transaction_type=side,
                transaction_date=trade_date,
                currency="USD",
                amount=net,
                description=f"Tiger Trade fund {ticker} {match.group('activity')}",
                ticker=ticker,
                quantity=abs(_statement_decimal(match.group("quantity"))),
                price=_statement_decimal(match.group("price")),
                gross=gross,
                commission=commission,
                datetime_text=f"{trade_date} {_nearby_statement_time(lines, index)}",
                source_extra={
                    "statement_activity_raw": match.group("activity"),
                    "market": match.group("market"),
                    "security_type": "fund",
                    "statement_realized_pnl_raw": match.group("realized").replace(
                        ",", ""
                    ),
                },
            )
        )
    return records


def _tigertrade_simple_cash_rows(
    section: str,
    *,
    account: str | None,
    source_filename: str,
    transaction_type_for_description: dict[str, str],
    source_section: str,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    row_pattern = re.compile(
        r"^\s*(?P<date>\d{4}-\d{2}-\d{2})\s{2,}(?P<description>.*?)\s{2,}"
        r"(?P<amount>-?[\d,]+(?:\.\d+)?)\s{2,}(?P<currency>[A-Z]{3})\s*$"
    )
    for index, line in enumerate(section.splitlines(), start=1):
        match = row_pattern.match(line)
        if match is None:
            continue
        description = _normalize_whitespace(match.group("description"))
        transaction_type = transaction_type_for_description.get(description)
        if not transaction_type:
            continue
        amount = _statement_decimal(match.group("amount"))
        source_extra: dict[str, Any] = {"statement_section": source_section}
        if description in {
            "Withdrawal Fail Refund",
            "Fund Subscription",
            "Fund Subscription Returned",
        }:
            source_extra["excluded_from_broker_pnl"] = True
        record = _statement_record(
            broker="tigertrade",
            account=account,
            file_kind="tigertrade_statement_pdf",
            source_filename=source_filename,
            row_number=index,
            transaction_type=transaction_type,
            transaction_date=match.group("date"),
            currency=match.group("currency"),
            amount=amount,
            description=description,
            source_extra=source_extra,
        )
        if source_section == "Funds in Transit":
            action = (
                "subscription"
                if description == "Fund Subscription"
                else "subscription_returned"
            )
            record["source"]["cash_equivalent_transfer"] = True
            record["source"]["cash_equivalent_transfer_amount_raw"] = _decimal_to_str(
                amount
            )
            normalized = record["normalized"]
            normalized["net_amount"] = "0"
            normalized["is_cash_flow"] = False
            normalized.pop("cash_flow_amount", None)
            normalized["accounting_adjustment_amount"] = "0"
            normalized["cash_equivalent_transfer"] = True
            normalized["cash_equivalent_action"] = action
            normalized["cash_equivalent_equity_delta"] = "0"
        records.append(record)
    return records


def _tigertrade_dividend_records(
    section: str,
    *,
    account: str | None,
    source_filename: str,
) -> list[dict[str, Any]]:
    lines = section.splitlines()
    records: list[dict[str, Any]] = []
    pattern = re.compile(
        r"^\s*(?P<date>\d{4}-\d{2}-\d{2})\s+Stock.*?Paid\s+"
        r"(?P<gross>[\d,]+(?:\.\d+)?)\s+0\s+Dividend tax:\s*"
        r"(?P<tax>[\d,]+(?:\.\d+)?)\s+(?P<net>[\d,]+(?:\.\d+)?)\s+(?P<currency>[A-Z]{3})"
    )
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if match is None:
            continue
        ticker = _nearby_statement_ticker(lines, index)
        gross = _statement_decimal(match.group("gross"))
        tax = -abs(_statement_decimal(match.group("tax")))
        common = {
            "broker": "tigertrade",
            "account": account,
            "file_kind": "tigertrade_statement_pdf",
            "source_filename": source_filename,
            "row_number": index + 1,
            "transaction_date": match.group("date"),
            "currency": match.group("currency"),
            "ticker": ticker or None,
        }
        records.append(
            _statement_record(
                **common,
                transaction_type="dividend",
                amount=gross,
                description=f"{ticker or 'Stock'} Cash Dividend",
            )
        )
        if tax:
            records.append(
                _statement_record(
                    **common,
                    transaction_type="foreign_tax_withholding",
                    amount=tax,
                    description=f"{ticker or 'Stock'} Dividend Tax",
                    source_extra={
                        "statement_gross_dividend_raw": _decimal_to_str(gross)
                    },
                )
            )
    return records


def _tigertrade_allowance_records(
    section: str,
    *,
    account: str | None,
    source_filename: str,
) -> list[dict[str, Any]]:
    return _tigertrade_simple_cash_rows(
        section,
        account=account,
        source_filename=source_filename,
        transaction_type_for_description={
            "Order Rebate": "kol_reward",
            "Coupon Rebate": "kol_reward",
        },
        source_section="Allowance",
    )


def _text_between(text: str, start: str, end: str) -> str:
    if start not in text:
        return ""
    section = text.split(start, 1)[1]
    return section.split(end, 1)[0] if end in section else section


def build_investment_payload_from_tigertrade_statement_pdf(
    pdf_bytes: bytes,
    *,
    source_filename: str = "",
) -> dict[str, Any]:
    text = _investment_import_compat.extract_statement_pdf_text(
        pdf_bytes, "Tiger Trade"
    )
    if "Tiger Brokers" not in text or "Activity Statement" not in text:
        raise ValueError(
            "The uploaded PDF is not a recognized Tiger Trade activity statement."
        )
    account_match = TIGERTRADE_ACCOUNT_PATTERN.search(text)
    period_match = TIGERTRADE_PERIOD_PATTERN.search(text)
    account = account_match.group(1) if account_match else None
    statement_period = ""
    if period_match:
        statement_period = f"{period_match.group(1).replace('.', '-')}/{period_match.group(2).replace('.', '-')}"
    warnings: list[str] = []
    trade_section = _text_between(text, "  Trades", "  Deposits & Withdrawals")
    trade_lines = trade_section.splitlines()
    transactions = _tigertrade_forex_records(
        trade_lines,
        account=account,
        source_filename=source_filename,
    )
    transactions.extend(
        _tigertrade_stock_records(
            trade_lines,
            account=account,
            source_filename=source_filename,
            warnings=warnings,
        )
    )
    transactions.extend(
        _tigertrade_fund_records(
            trade_lines,
            account=account,
            source_filename=source_filename,
            warnings=warnings,
        )
    )
    transactions.extend(
        _tigertrade_simple_cash_rows(
            _text_between(text, "  Deposits & Withdrawals", "  Interest"),
            account=account,
            source_filename=source_filename,
            transaction_type_for_description={
                "Deposit": "deposit",
                "Withdrawal": "withdrawal",
                "Withdrawal Fail Refund": "adjustment",
            },
            source_section="Deposits & Withdrawals",
        )
    )
    transactions.extend(
        _tigertrade_simple_cash_rows(
            _text_between(text, "  Interest", "  Interest Accruals"),
            account=account,
            source_filename=source_filename,
            transaction_type_for_description={
                "Accrual Transferred To Actual Financing Interest 2024-12": "debit_interest",
            },
            source_section="Interest",
        )
    )
    transactions.extend(
        _tigertrade_dividend_records(
            _text_between(text, "  Dividends", "  Allowance"),
            account=account,
            source_filename=source_filename,
        )
    )
    transactions.extend(
        _tigertrade_allowance_records(
            _text_between(text, "  Allowance", "  Funds in Transit"),
            account=account,
            source_filename=source_filename,
        )
    )
    transactions.extend(
        _tigertrade_simple_cash_rows(
            _text_between(text, "  Funds in Transit", "  Segment Transfer"),
            account=account,
            source_filename=source_filename,
            transaction_type_for_description={
                "Fund Subscription": "adjustment",
                "Fund Subscription Returned": "adjustment",
            },
            source_section="Funds in Transit",
        )
    )
    if not transactions:
        raise ValueError(
            "No supported transactions were found in the Tiger Trade statement PDF."
        )
    payload = _build_statement_payload(
        broker="tigertrade",
        importer_name="tigertrade_statement_pdf_to_investment_json",
        importer_version=TIGERTRADE_IMPORTER_VERSION,
        account=account,
        source_filename=source_filename,
        statement_period=statement_period,
        timezone_name=TIGERTRADE_US_TIMEZONE,
        transactions=transactions,
        warnings=warnings,
        currencies=("HKD", "USD"),
    )
    reward_rows = [
        transaction
        for transaction in transactions
        if transaction.get("type") == "kol_reward"
    ]
    hkd_card_rows = [
        transaction
        for transaction in reward_rows
        if transaction.get("description") == "Order Rebate"
        and (
            _ii_hsbc_cash._parse_decimal_text_or_none(transaction.get("net_amount_raw"))
            or ZERO
        )
        >= Decimal("12")
    ]
    fee_rebate_rows = [
        transaction for transaction in reward_rows if transaction not in hkd_card_rows
    ]
    payload["summary"]["statement_calibrations"] = {
        "hkd_100_card_redemption_count": len(hkd_card_rows),
        "hkd_100_card_rebate_amount_usd": _decimal_to_str(
            sum(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        transaction.get("net_amount_raw")
                    )
                    or ZERO
                )
                for transaction in hkd_card_rows
            )
        ),
        "fee_rebate_posting_count": len(fee_rebate_rows),
        "fee_rebate_amount_usd": _decimal_to_str(
            sum(
                (
                    _ii_hsbc_cash._parse_decimal_text_or_none(
                        transaction.get("net_amount_raw")
                    )
                    or ZERO
                )
                for transaction in fee_rebate_rows
            )
        ),
    }
    return payload


def _merge_statement_pdf_payloads(
    statement_pdf_payloads: list[tuple[bytes, str]],
    *,
    broker_label: str,
    builder: Any,
    importer_name: str,
    importer_version: str,
) -> dict[str, Any]:
    non_empty = [
        (payload, filename) for payload, filename in statement_pdf_payloads if payload
    ]
    if not non_empty:
        raise ValueError(f"Upload at least one {broker_label} statement PDF.")
    payloads = [
        builder(payload, source_filename=filename) for payload, filename in non_empty
    ]
    merged = payloads[0]
    for payload in payloads[1:]:
        merged = _ii_merge.merge_investment_payloads(merged, payload)
    periods = sorted(
        {
            _normalize_text(
                _ii_merge_reconciliation._payload_generator(payload).get(
                    "statement_period"
                )
            )
            for payload in payloads
            if _normalize_text(
                _ii_merge_reconciliation._payload_generator(payload).get(
                    "statement_period"
                )
            )
        }
    )
    merged["generator"] = {
        "name": importer_name,
        "version": importer_version,
        "generated_at": _ii_basics._now_iso(),
        "source_filename": ", ".join(filename for _, filename in non_empty),
        "statement_period": ", ".join(periods),
        "statement_count": len(payloads),
    }
    merged["summary"]["statement_count"] = len(payloads)
    merged["summary"]["statement_periods"] = periods
    currencies = ("HKD", "USD")
    reconciliation = _statement_cash_reconciliation(
        merged.get("transactions", []), currencies
    )
    merged["summary"]["cash_reconciliation"] = reconciliation
    merged["summary"]["warnings"] = [
        warning
        for warning in merged["summary"].get("warnings", [])
        if "cash did not reconcile to zero" not in warning
    ]
    for currency, result in reconciliation.items():
        if not result["reconciled"]:
            merged["summary"]["warnings"].append(
                f"{broker_label} {currency} cash did not reconcile to zero; parsed net change is {result['parsed_net_change']}."
            )
    reward_rows = [
        transaction
        for transaction in merged.get("transactions", [])
        if transaction.get("type") == "kol_reward"
    ]
    if broker_label == "uSMART (HK)":
        merged["summary"]["statement_calibrations"] = {
            "coupon_count": len(reward_rows),
            "coupon_amount_hkd": _decimal_to_str(
                sum(
                    (
                        _ii_hsbc_cash._parse_decimal_text_or_none(
                            transaction.get("net_amount_raw")
                        )
                        or ZERO
                    )
                    for transaction in reward_rows
                )
            ),
        }
    elif broker_label == "Tiger Trade":
        hkd_card_rows = [
            transaction
            for transaction in reward_rows
            if transaction.get("description") == "Order Rebate"
            and (
                _ii_hsbc_cash._parse_decimal_text_or_none(
                    transaction.get("net_amount_raw")
                )
                or ZERO
            )
            >= Decimal("12")
        ]
        fee_rebate_rows = [
            transaction
            for transaction in reward_rows
            if transaction not in hkd_card_rows
        ]
        merged["summary"]["statement_calibrations"] = {
            "hkd_100_card_redemption_count": len(hkd_card_rows),
            "hkd_100_card_rebate_amount_usd": _decimal_to_str(
                sum(
                    (
                        _ii_hsbc_cash._parse_decimal_text_or_none(
                            transaction.get("net_amount_raw")
                        )
                        or ZERO
                    )
                    for transaction in hkd_card_rows
                )
            ),
            "fee_rebate_posting_count": len(fee_rebate_rows),
            "fee_rebate_amount_usd": _decimal_to_str(
                sum(
                    (
                        _ii_hsbc_cash._parse_decimal_text_or_none(
                            transaction.get("net_amount_raw")
                        )
                        or ZERO
                    )
                    for transaction in fee_rebate_rows
                )
            ),
        }
    return merged


def build_investment_payload_from_usmart_hk_statement_pdfs(
    statement_pdf_payloads: list[tuple[bytes, str]],
) -> dict[str, Any]:
    return _merge_statement_pdf_payloads(
        statement_pdf_payloads,
        broker_label="uSMART (HK)",
        builder=build_investment_payload_from_usmart_hk_statement_pdf,
        importer_name="usmart_hk_statement_pdf_to_investment_json",
        importer_version=USMART_HK_IMPORTER_VERSION,
    )


def build_investment_payload_from_tigertrade_statement_pdfs(
    statement_pdf_payloads: list[tuple[bytes, str]],
) -> dict[str, Any]:
    return _merge_statement_pdf_payloads(
        statement_pdf_payloads,
        broker_label="Tiger Trade",
        builder=build_investment_payload_from_tigertrade_statement_pdf,
        importer_name="tigertrade_statement_pdf_to_investment_json",
        importer_version=TIGERTRADE_IMPORTER_VERSION,
    )
