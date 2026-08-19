#!/usr/bin/env python3
"""
Rebuild Longbridge transactions from a monthly statement PDF.

Code version: v0.1.1
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.infrastructure.storage import INVESTMENT_STORE_PATH, load_investment_store_payload, save_investment_store_payload  # noqa: E402

SCHEMA_VERSION = "3.0.0"
DEFAULT_CONVENTION_TIME = "20:00:00"
STATEMENT_TIMEZONE = "Asia/Hong_Kong"
ZERO = Decimal("0")

STOCK_ROW_PATTERN = re.compile(
    r"^(?P<trade_date>\d{4}\.\d{2}\.\d{2})\s+"
    r"(?P<settlement_date>\d{4}\.\d{2}\.\d{2})\s+"
    r"(?P<order_id>OS\d+)\s+"
    r"(?P<side>BUY|SELL)\s+"
    r"(?P<description>.+?)\s+"
    r"(?P<quantity>-?[\d,]+\.\d+)\s+"
    r"(?P<price>[\d,]+\.\d+)\s+"
    r"(?P<gross>[\d,]+\.\d+)\s+"
    r"(?P<net>-?[\d,]+\.\d+)$"
)
FLOW_ROW_PATTERN = re.compile(
    r"^(?P<date>\d{4}\.\d{2}\.\d{2})\s+"
    r"(?P<flow_name>"
    r"Deposit\s*Cash|"
    r"Currency\s*Conversion\s*\(Debit\)|"
    r"Currency\s*Conversion\s*\(Credit\)|"
    r"Placement|"
    r"Redemption|"
    r"Cheque\s*Withdrawal"
    r")\s*"
    r"(?P<description>.*?)"
    r"(?P<amount>-?[\d,]+\.\d+)$"
)
DATE_ROW_PATTERN = re.compile(r"^\d{4}\.\d{2}\.\d{2}\s+")
PAGE_MARKER_PATTERN = re.compile(r"Page\d+of\d+", re.IGNORECASE)
ORDER_ID_PATTERN = re.compile(r"OS\d+")

FLOW_TYPE_MAPPING = {
    "DepositCash": "deposit",
    "CurrencyConversion(Debit)": "withdrawal",
    "CurrencyConversion(Credit)": "deposit",
    "Placement": "adjustment",
    "Redemption": "adjustment",
    "ChequeWithdrawal": "withdrawal",
}

FLOW_CURRENCY_MAPPING = {
    "DepositCash": "HKD",
    "CurrencyConversion(Debit)": "HKD",
    "CurrencyConversion(Credit)": "USD",
    "Placement": "USD",
    "Redemption": "USD",
    "ChequeWithdrawal": "USD",
}


def _normalize_text(value: object) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return text.strip()


def _normalize_whitespace(value: object) -> str:
    return " ".join(_normalize_text(value).split())


def _decimal_to_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _parse_decimal(value: str) -> Decimal:
    return Decimal(_normalize_text(value).replace(",", ""))


def normalize_ticker(ticker: str) -> str:
    raw_value = _normalize_text(ticker).upper()
    share_class_match = re.fullmatch(r"^([A-Z0-9]{1,4})[.\-\s]+([ABC])$", raw_value)
    if share_class_match is not None:
        return f"{share_class_match.group(1)}-{share_class_match.group(2)}"
    normalized = re.sub(r"\s+", "-", raw_value)
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized.replace("/", "_")


def _canonicalize_flow_name(value: str) -> str:
    return re.sub(r"\s+", "", _normalize_text(value))


def _statement_date_to_iso(value: str) -> str:
    return datetime.strptime(value, "%Y.%m.%d").strftime("%Y-%m-%d")


def _build_convention_datetime(date_text: str) -> str:
    return f"{date_text} {DEFAULT_CONVENTION_TIME}"


def _build_normalized_view(
    mapped_type: str,
    quantity_dec: Decimal | None,
    price_dec: Decimal | None,
    gross_amount_dec: Decimal | None,
    commission_dec: Decimal | None,
    net_amount_dec: Decimal | None,
    *,
    is_cash_flow_override: bool | None = None,
) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    side = None
    if mapped_type == "buy":
        side = "buy"
    elif mapped_type == "sell":
        side = "sell"
    if side:
        normalized["side"] = side
    if quantity_dec is not None:
        normalized["position_quantity"] = _decimal_to_str(quantity_dec)
        normalized["display_quantity"] = _decimal_to_str(abs(quantity_dec))
    if price_dec is not None:
        normalized["unit_price"] = _decimal_to_str(price_dec)
    if gross_amount_dec is not None:
        normalized["gross_amount"] = _decimal_to_str(gross_amount_dec)
        normalized["display_amount"] = _decimal_to_str(
            abs(gross_amount_dec) if mapped_type in {"buy", "sell"} else gross_amount_dec
        )
    if commission_dec is not None:
        normalized["commission"] = _decimal_to_str(commission_dec)
        normalized["commission_display"] = _decimal_to_str(abs(commission_dec))
    if net_amount_dec is not None:
        normalized["net_amount"] = _decimal_to_str(net_amount_dec)
    is_cash_flow = (
        is_cash_flow_override if is_cash_flow_override is not None else mapped_type not in {"buy", "sell"}
    )
    normalized["is_cash_flow"] = is_cash_flow
    if net_amount_dec is not None:
        key = "cash_flow_amount" if is_cash_flow else "accounting_adjustment_amount"
        normalized[key] = _decimal_to_str(net_amount_dec)
    return normalized


def _sort_transactions(transactions: list[dict[str, Any]]) -> None:
    transactions.sort(
        key=lambda item: (
            _normalize_text(item.get("date")),
            _normalize_text(item.get("source", {}).get("file_kind")),
            int(item.get("source", {}).get("row_number", 0)),
        )
    )


def _extract_pdf_text(pdf_path: Path) -> str:
    completed = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "pdftotext failed."
        raise RuntimeError(stderr)
    return completed.stdout


def _infer_stock_ticker(description: str) -> str | None:
    normalized = re.sub(r"\s+", " ", description).strip().upper()
    if normalized == "PROSHARES ULTRAPRO QQQ":
        return "TQQQ.US"
    if normalized == "PROSHARESULTRAPRO QQQ":
        return "TQQQ.US"
    last_token = normalized.split(" ")[-1] if normalized else ""
    if re.fullmatch(r"[A-Z]{1,5}", last_token):
        return f"{last_token}.US"
    return None


def _is_noise_line(line: str) -> bool:
    normalized = _normalize_whitespace(line)
    if not normalized:
        return True
    if PAGE_MARKER_PATTERN.search(normalized):
        return True
    if normalized.startswith("IntegratedA/CMonthlyStatement"):
        return True
    if normalized.startswith("OrderTime") or normalized.startswith("TransactionTime"):
        return True
    if normalized.startswith("Commission") or normalized.startswith("PlatformFee"):
        return True
    if normalized.startswith("ClearingFee") or normalized.startswith("SECFee"):
        return True
    if normalized.startswith("TradingActivityFee") or normalized.startswith("OtherFee"):
        return True
    if normalized.startswith("LongBridgeHKLimited"):
        return True
    if normalized.startswith("RegisteredwithSFCasaLicensedCorporation"):
        return True
    if normalized.startswith("01.Unlessotherwisestated"):
        return True
    if normalized.startswith("Company'swebsiteatanytime."):
        return True
    return False


def _consume_stock_suffix(lines: list[str], start_index: int) -> tuple[str, int]:
    parts: list[str] = []
    index = start_index
    while index < len(lines):
        candidate = _normalize_whitespace(lines[index])
        if not candidate:
            break
        if _is_noise_line(candidate):
            break
        if DATE_ROW_PATTERN.match(candidate) or ORDER_ID_PATTERN.search(candidate):
            break
        if re.search(r"\d", candidate):
            break
        if len(candidate.split()) > 6:
            break
        parts.append(candidate)
        index += 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip(), index


def _consume_flow_suffix(lines: list[str], start_index: int) -> tuple[str, int]:
    parts: list[str] = []
    index = start_index
    while index < len(lines):
        candidate = _normalize_whitespace(lines[index])
        if not candidate:
            break
        if _is_noise_line(candidate):
            break
        if DATE_ROW_PATTERN.match(candidate) or ORDER_ID_PATTERN.search(candidate):
            break
        parts.append(candidate)
        index += 1
        if len(parts) >= 2:
            break
    return " ".join(parts).strip(), index


def _format_statement_description(flow_name: str, description: str) -> str:
    normalized = _normalize_text(description)
    if not normalized:
        if flow_name == "DepositCash":
            return "Deposit Cash"
        if flow_name == "ChequeWithdrawal":
            return "Cheque Withdrawal"
        return flow_name
    replacements = {
        "FXFROMHKDTOUSD@": "FX FROM HKD TO USD @ ",
        "Subscriptionof": "Subscription of ",
        "Redemptionof": "Redemption of ",
        "GaoTengWeValueUSDMoneyMktAUSDAcc": "GaoTeng WeValue USD Money Mkt A USD Acc",
        "(Withdrawal)": " (Withdrawal)",
    }
    formatted = normalized
    for old, new in replacements.items():
        formatted = formatted.replace(old, new)
    formatted = formatted.replace("HK0000584737of", "HK0000584737 of ")
    return formatted


def _parse_stock_records(lines: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = _normalize_whitespace(lines[index])
        index += 1
        if not line:
            continue
        match = STOCK_ROW_PATTERN.match(line)
        if match is None:
            continue
        suffix, index = _consume_stock_suffix(lines, index)
        description = _normalize_whitespace(
            f"{match.group('description')} {suffix}".strip()
        )
        ticker = _infer_stock_ticker(description)
        trade_date = _statement_date_to_iso(match.group("trade_date"))
        settlement_date = _statement_date_to_iso(match.group("settlement_date"))
        side = match.group("side").lower()
        quantity_dec = _parse_decimal(match.group("quantity"))
        price_dec = _parse_decimal(match.group("price"))
        gross_abs_dec = _parse_decimal(match.group("gross"))
        net_signed_dec = _parse_decimal(match.group("net"))
        gross_signed_dec = -gross_abs_dec if side == "buy" else gross_abs_dec
        fee_abs_dec = (
            abs(net_signed_dec) - gross_abs_dec if side == "buy" else gross_abs_dec - net_signed_dec
        )
        if fee_abs_dec < ZERO:
            fee_abs_dec = ZERO
        commission_dec = -fee_abs_dec
        record: dict[str, Any] = {
            "date": trade_date,
            "datetime": _build_convention_datetime(trade_date),
            "type": side,
            "currency": "USD",
            "description": description,
            "source": {
                "file_kind": "longbridge_statement_pdf",
                "row_number": index,
                "transaction_type_raw": match.group("side"),
                "statement_settlement_date": settlement_date,
                "statement_order_id": match.group("order_id"),
            },
            "quantity_raw": _decimal_to_str(abs(quantity_dec)),
            "quantity_abs": _decimal_to_str(abs(quantity_dec)),
            "price_raw": _decimal_to_str(price_dec),
            "gross_amount_raw": _decimal_to_str(gross_signed_dec),
            "commission_raw": _decimal_to_str(commission_dec),
            "commission_abs": _decimal_to_str(abs(commission_dec)),
            "net_amount_raw": _decimal_to_str(net_signed_dec),
            "broker": "longbridge",
            "statement_settlement_date": settlement_date,
        }
        if ticker:
            record["ticker"] = normalize_ticker(ticker)
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


def _parse_flow_records(lines: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = _normalize_whitespace(lines[index])
        index += 1
        if not line:
            continue
        match = FLOW_ROW_PATTERN.match(line)
        if match is None:
            continue
        flow_name = _canonicalize_flow_name(match.group("flow_name"))
        continuation, index = _consume_flow_suffix(lines, index)
        raw_description = _normalize_whitespace(
            f"{match.group('description')} {continuation}".strip()
        )
        description = _format_statement_description(flow_name, raw_description)
        amount_dec = _parse_decimal(match.group("amount"))
        booking_date = _statement_date_to_iso(match.group("date"))
        mapped_type = FLOW_TYPE_MAPPING[flow_name]
        record: dict[str, Any] = {
            "date": booking_date,
            "datetime": _build_convention_datetime(booking_date),
            "type": mapped_type,
            "currency": FLOW_CURRENCY_MAPPING[flow_name],
            "description": description,
            "source": {
                "file_kind": "longbridge_statement_pdf",
                "row_number": index,
                "transaction_type_raw": flow_name,
            },
            "gross_amount_raw": _decimal_to_str(amount_dec),
            "net_amount_raw": _decimal_to_str(amount_dec),
            "broker": "longbridge",
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
        records.append(record)
    return records


def _build_summary(transactions: list[dict[str, Any]], warnings: list[str]) -> dict[str, Any]:
    return {
        "starting_cash_raw": None,
        "ending_cash_raw": None,
        "transaction_count": len(transactions),
        "grant_count": 0,
        "total_record_count": len(transactions),
        "unknown_transaction_type_count": 0,
        "unknown_transaction_types": [],
        "warning_count": len(warnings),
        "warnings": warnings,
        "holdings_validation": {
            "matched": True,
            "mismatch_count": 0,
            "mismatches": [],
        },
        "open_position_count": 0,
        "performance_symbol_count": 0,
    }


def _load_existing_account(store_path: Path) -> str | None:
    payload = load_investment_store_payload(store_path)
    account = _normalize_text(payload.get("account"))
    return account or None


def build_payload_from_statement(pdf_path: Path, account: str | None = None) -> dict[str, Any]:
    text = _extract_pdf_text(pdf_path)
    lines = text.splitlines()
    stock_records = _parse_stock_records(lines)
    flow_records = _parse_flow_records(lines)
    transactions = stock_records + flow_records
    warnings: list[str] = []
    if not stock_records:
        warnings.append("No stock trades were parsed from the monthly statement.")
    if not flow_records:
        warnings.append("No cash-flow rows were parsed from the monthly statement.")
    _sort_transactions(transactions)
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generator": {
            "name": "longbridge_statement_pdf_to_investment_json",
            "version": SCHEMA_VERSION,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        "broker": "longbridge",
        "account": account,
        "datetime_policy": {
            "date_field_meaning": "Trading or booking date from the Longbridge monthly statement PDF",
            "datetime_field_meaning": (
                "Business-convention datetime derived from the statement date "
                f"with default time {DEFAULT_CONVENTION_TIME}"
            ),
            "timezone": STATEMENT_TIMEZONE,
            "source_has_intraday_timestamp": False,
        },
        "summary": _build_summary(transactions, warnings),
        "starting_cash": None,
        "ending_cash": None,
        "position_snapshot": {},
        "performance_snapshot": {},
        "transactions": transactions,
    }
    payload["summary"]["json_size_bytes"] = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    return payload


def _backup_existing_store(store_path: Path) -> Path | None:
    if not store_path.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    backup_path = store_path.with_name(f"{store_path.stem}.backup.{timestamp}{store_path.suffix}")
    backup_path.write_bytes(store_path.read_bytes())
    return backup_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild a Longbridge investment payload from a monthly statement PDF."
    )
    parser.add_argument("statement_pdf", type=Path, help="Absolute path to the Longbridge monthly statement PDF.")
    parser.add_argument(
        "--output",
        type=Path,
        default=INVESTMENT_STORE_PATH,
        help="Output path. Defaults to the local investment Parquet store; pass a .json path to export JSON.",
    )
    parser.add_argument(
        "--account",
        type=str,
        default="",
        help="Account identifier to embed in the generated payload.",
    )
    args = parser.parse_args()

    pdf_path = args.statement_pdf.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if not pdf_path.exists():
        raise FileNotFoundError(f"Statement PDF was not found: {pdf_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    account = _normalize_text(args.account) or _load_existing_account(output_path)
    payload = build_payload_from_statement(pdf_path, account=account)
    backup_path = _backup_existing_store(output_path)
    if output_path.suffix.lower() == ".json":
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        save_investment_store_payload(payload, output_path)

    message = {
        "success": True,
        "output_path": str(output_path),
        "backup_path": str(backup_path) if backup_path else None,
        "transaction_count": payload["summary"]["transaction_count"],
        "warning_count": payload["summary"]["warning_count"],
    }
    print(json.dumps(message, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
