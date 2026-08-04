#!/usr/bin/env python3
"""Validate HSBC statement PDF imports without writing investment.parquet.

Code version: v0.1.3
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.infrastructure.storage import INVESTMENT_STORE_PATH, load_investment_store_payload  # noqa: E402
from app.services.investment_import import (  # noqa: E402
    HSBC_STATEMENT_PDF_IMPORTER_VERSION,
    build_investment_payload_from_hsbc_statement_pdfs,
    merge_investment_payloads,
)


SCRIPT_VERSION = "0.1.3"
ZERO = Decimal("0")

HSBC_OFFICIAL_CSV_FILES = {
    "HKD Current": "TransactionHistoryHKDCurrent.csv",
    "HKD Savings": "TransactionHistoryHKDSavings.csv",
    "Foreign Currency Savings CNH": "TransactionHistoryCNHSavings.csv",
    "Foreign Currency Savings USD": "TransactionHistoryUSDSavings.csv",
}
HSBC_CURRENCY_ALIASES = {
    "USD": "USD",
    "HKD": "HKD",
    "CNH": "CNH",
    "CNY": "CNH",
    "RMB": "CNH",
}


def _decimal(value: Any) -> Decimal:
    raw = str(value or "0").replace(",", "").strip()
    return Decimal(raw or "0")


def _decimal_text(value: Decimal) -> str:
    return format(value, "f")


def _pdf_paths(inputs: list[str]) -> list[Path]:
    paths: list[Path] = []
    for item in inputs:
        path = Path(item).expanduser()
        if path.is_dir():
            paths.extend(sorted(path.glob("*.pdf")))
        elif path.is_file() and path.suffix.lower() == ".pdf":
            paths.append(path)
    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(path)
    return deduped


def _official_csv_paths(directory: Path) -> dict[str, Path]:
    if not directory.is_dir():
        raise ValueError(f"Official HSBC CSV directory does not exist: {directory}")
    paths = {
        account_type: directory / filename
        for account_type, filename in HSBC_OFFICIAL_CSV_FILES.items()
    }
    missing = [str(path.name) for path in paths.values() if not path.is_file()]
    if missing:
        raise ValueError(
            "Official HSBC CSV validation requires all four account files; missing: "
            + ", ".join(missing)
        )
    return paths


def _official_csv_decimal(
    value: Any,
    *,
    source_path: Path,
    row_number: int,
    field_name: str,
    allow_empty: bool = False,
) -> Decimal | None:
    raw = str(value or "").replace(",", "").strip()
    if not raw:
        if allow_empty:
            return None
        raise ValueError(
            f"{source_path.name} row {row_number} has an empty {field_name}."
        )
    try:
        return Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError(
            f"{source_path.name} row {row_number} has an invalid {field_name}: {value!r}."
        ) from exc


def _official_csv_report(source_path: Path, account_type: str) -> dict[str, Any]:
    expected_currency = (
        "CNH"
        if account_type.endswith(" CNH")
        else "HKD"
        if account_type.startswith("HKD ")
        else "USD"
    )
    rows: list[dict[str, Any]] = []
    with source_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required_columns = {
            "Date",
            "Description",
            "Billing amount",
            "Billing currency",
            "Balance",
            "Balance currency",
        }
        actual_columns = set(reader.fieldnames or [])
        missing_columns = sorted(required_columns - actual_columns)
        if missing_columns:
            raise ValueError(
                f"{source_path.name} is missing required columns: {', '.join(missing_columns)}."
            )
        for row_number, row in enumerate(reader, start=2):
            try:
                transaction_date = datetime.strptime(
                    str(row.get("Date") or "").strip(),
                    "%d/%m/%Y",
                ).date()
            except ValueError as exc:
                raise ValueError(
                    f"{source_path.name} row {row_number} has an invalid Date."
                ) from exc
            amount = _official_csv_decimal(
                row.get("Billing amount"),
                source_path=source_path,
                row_number=row_number,
                field_name="Billing amount",
            )
            balance = _official_csv_decimal(
                row.get("Balance"),
                source_path=source_path,
                row_number=row_number,
                field_name="Balance",
                allow_empty=True,
            )
            billing_currency_raw = str(row.get("Billing currency") or "").strip().upper()
            balance_currency_raw = str(row.get("Balance currency") or "").strip().upper()
            billing_currency = HSBC_CURRENCY_ALIASES.get(billing_currency_raw, "")
            balance_currency = HSBC_CURRENCY_ALIASES.get(balance_currency_raw, "")
            if billing_currency != expected_currency or balance_currency != expected_currency:
                raise ValueError(
                    f"{source_path.name} row {row_number} has unexpected currency "
                    f"{billing_currency_raw}/{balance_currency_raw}; expected {expected_currency}."
                )
            rows.append({
                "date": transaction_date,
                "amount": amount,
                "balance": balance,
                "description": " ".join(str(row.get("Description") or "").split()),
                "currency": expected_currency,
                "currency_raw": billing_currency_raw,
            })

    if not rows:
        raise ValueError(f"{source_path.name} contains no transaction rows.")

    date_order_inversions = sum(
        rows[index]["date"] > rows[index - 1]["date"]
        for index in range(1, len(rows))
    )
    balance_continuity_mismatches: list[dict[str, Any]] = []
    balance_continuity_checked = 0
    for index in range(len(rows) - 1):
        newer = rows[index]
        older = rows[index + 1]
        if newer["balance"] is None or older["balance"] is None:
            continue
        balance_continuity_checked += 1
        expected_newer_balance = older["balance"] + newer["amount"]
        if expected_newer_balance != newer["balance"]:
            balance_continuity_mismatches.append({
                "row_index": index,
                "expected_newer_balance": _decimal_text(expected_newer_balance),
                "actual_newer_balance": _decimal_text(newer["balance"]),
            })

    return {
        "account_type": account_type,
        "source_filename": source_path.name,
        "row_count": len(rows),
        "date_min": min(row["date"] for row in rows).isoformat(),
        "date_max": max(row["date"] for row in rows).isoformat(),
        "currency": expected_currency,
        "raw_currency_counts": dict(
            sorted(Counter(row["currency_raw"] for row in rows).items())
        ),
        "balance_first_newest": (
            _decimal_text(rows[0]["balance"]) if rows[0]["balance"] is not None else None
        ),
        "balance_last_oldest": (
            _decimal_text(rows[-1]["balance"]) if rows[-1]["balance"] is not None else None
        ),
        "date_order_inversions": date_order_inversions,
        "balance_continuity_checked": balance_continuity_checked,
        "balance_continuity_mismatches": balance_continuity_mismatches,
        "rows": rows,
    }


def _hsbc_official_csv_validation(
    payload: dict[str, Any],
    official_csv_paths: dict[str, Path],
) -> dict[str, Any]:
    imported_by_account: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for transaction in payload.get("transactions", []):
        if not isinstance(transaction, dict):
            continue
        source = transaction.get("source") if isinstance(transaction.get("source"), dict) else {}
        account_type = str(source.get("account_type") or "").strip()
        if not account_type:
            continue
        statement_date_raw = str(source.get("statement_date") or transaction.get("date") or "")
        try:
            statement_date = date.fromisoformat(statement_date_raw)
        except ValueError as exc:
            raise ValueError(
                f"HSBC imported row has an invalid statement date: {statement_date_raw!r}."
            ) from exc
        imported_by_account[account_type].append({
            "date": date.fromisoformat(str(transaction.get("date"))),
            "amount": _decimal(transaction.get("net_amount_raw")),
            "balance": _official_csv_decimal(
                source.get("balance_after_raw"),
                source_path=Path(str(source.get("source_filename") or "<PDF>")),
                row_number=int(source.get("row_number") or 0),
                field_name="balance_after_raw",
                allow_empty=True,
            ),
            "statement_date": statement_date,
            "row_number": int(source.get("row_number") or 0),
        })

    account_reports: dict[str, Any] = {}
    failed_checks: list[str] = []
    for account_type, source_path in official_csv_paths.items():
        csv_report = _official_csv_report(source_path, account_type)
        csv_rows = csv_report["rows"]
        imported_rows = imported_by_account.get(account_type, [])
        if not imported_rows:
            failed_checks.append(f"no imported PDF rows for {account_type}")
            account_reports[account_type] = {
                key: value
                for key, value in csv_report.items()
                if key != "rows"
            }
            account_reports[account_type]["status"] = "failed"
            account_reports[account_type]["failure"] = "No imported PDF rows were available."
            continue

        csv_min = min(row["date"] for row in csv_rows)
        csv_max = max(row["date"] for row in csv_rows)
        imported_min = min(row["date"] for row in imported_rows)
        imported_max = max(row["date"] for row in imported_rows)
        overlap_min = max(csv_min, imported_min)
        overlap_max = min(csv_max, imported_max)
        csv_overlap = [
            row for row in csv_rows if overlap_min <= row["date"] <= overlap_max
        ]
        imported_overlap = [
            row for row in imported_rows if overlap_min <= row["date"] <= overlap_max
        ]
        csv_keys = Counter((row["date"], row["amount"]) for row in csv_overlap)
        imported_keys = Counter((row["date"], row["amount"]) for row in imported_overlap)
        missing_official_rows = sum((csv_keys - imported_keys).values())
        unexpected_imported_rows = sum((imported_keys - csv_keys).values())

        latest_imported_row = max(
            imported_rows,
            key=lambda row: (row["statement_date"], row["row_number"]),
        )
        official_at_cutoff = next(
            (
                row
                for row in csv_rows
                if row["date"] <= latest_imported_row["date"]
            ),
            None,
        )
        ending_balance_match = bool(
            official_at_cutoff is not None
            and latest_imported_row["balance"] is not None
            and official_at_cutoff["balance"] == latest_imported_row["balance"]
        )
        balance_continuity_passed = not csv_report["balance_continuity_mismatches"]
        account_passed = bool(
            csv_report["date_order_inversions"] == 0
            and balance_continuity_passed
            and missing_official_rows == 0
            and unexpected_imported_rows == 0
            and ending_balance_match
        )
        if not account_passed:
            failed_checks.append(f"official CSV check failed for {account_type}")
        account_reports[account_type] = {
            key: value
            for key, value in csv_report.items()
            if key != "rows"
        }
        account_reports[account_type].update({
            "status": "passed" if account_passed else "failed",
            "pdf_overlap": {
                "date_min": overlap_min.isoformat(),
                "date_max": overlap_max.isoformat(),
                "official_csv_rows": len(csv_overlap),
                "imported_pdf_rows": len(imported_overlap),
                "missing_official_rows": missing_official_rows,
                "unexpected_imported_rows": unexpected_imported_rows,
            },
            "ending_balance_check": {
                "imported_pdf_cutoff_date": latest_imported_row["date"].isoformat(),
                "imported_pdf_balance": (
                    _decimal_text(latest_imported_row["balance"])
                    if latest_imported_row["balance"] is not None
                    else None
                ),
                "official_csv_balance": (
                    _decimal_text(official_at_cutoff["balance"])
                    if official_at_cutoff and official_at_cutoff["balance"] is not None
                    else None
                ),
                "passed": ending_balance_match,
            },
        })

    return {
        "status": "passed" if not failed_checks else "failed",
        "account_count": len(official_csv_paths),
        "failed_checks": failed_checks,
        "accounts": account_reports,
    }


def _transaction_report(payload: dict[str, Any]) -> dict[str, Any]:
    totals_by_period: dict[str, Decimal] = defaultdict(Decimal)
    counts_by_period: dict[str, int] = defaultdict(int)
    totals_by_currency: dict[str, Decimal] = defaultdict(Decimal)
    counts_by_currency: dict[str, int] = defaultdict(int)
    raw_currency_counts: dict[str, int] = defaultdict(int)
    total = ZERO
    rows: list[dict[str, Any]] = []
    for transaction in payload.get("transactions", []):
        if not isinstance(transaction, dict):
            continue
        source = transaction.get("source") if isinstance(transaction.get("source"), dict) else {}
        period = str(source.get("statement_period") or "")
        currency = str(transaction.get("currency") or "UNKNOWN").strip().upper() or "UNKNOWN"
        raw_currency = str(source.get("statement_currency_raw") or currency).strip().upper() or currency
        amount = _decimal(transaction.get("net_amount_raw"))
        total += amount
        counts_by_currency[currency] += 1
        totals_by_currency[currency] += amount
        raw_currency_counts[raw_currency] += 1
        if period:
            totals_by_period[period] += amount
            counts_by_period[period] += 1
        rows.append({
            "date": transaction.get("date"),
            "type": transaction.get("type"),
            "amount": _decimal_text(amount),
            "description": transaction.get("description"),
            "balance_after": source.get("balance_after_raw"),
            "statement_period": period,
            "source_filename": source.get("source_filename"),
        })
    return {
        "transaction_count": len(rows),
        "net_amount_total": _decimal_text(total),
        "counts_by_currency": dict(sorted(counts_by_currency.items())),
        "totals_by_currency": {
            key: _decimal_text(value)
            for key, value in sorted(totals_by_currency.items())
        },
        "raw_currency_counts": dict(sorted(raw_currency_counts.items())),
        "counts_by_period": dict(sorted(counts_by_period.items())),
        "totals_by_period": {
            key: _decimal_text(value)
            for key, value in sorted(totals_by_period.items())
        },
        "rows": rows,
    }


def _load_store(path: Path) -> dict[str, Any]:
    return load_investment_store_payload(path)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate HSBC statement PDF import output without writing investment.parquet."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="PDF files or folders containing HSBC statement PDFs.",
    )
    parser.add_argument(
        "--store",
        default=str(INVESTMENT_STORE_PATH),
        help="Existing investment.parquet path used for merge simulation.",
    )
    parser.add_argument(
        "--official-csv-dir",
        help=(
            "Read-only directory containing the four official HSBC transaction-history CSVs "
            "for an independent account-level validation."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the validation report as JSON.",
    )
    args = parser.parse_args()

    paths = _pdf_paths(args.inputs)
    if not paths:
        raise SystemExit("No PDF files were found.")

    payload = build_investment_payload_from_hsbc_statement_pdfs(
        [(path.read_bytes(), path.name) for path in paths]
    )
    existing = _load_store(Path(args.store).expanduser())
    merged = merge_investment_payloads(existing, payload) if existing else payload
    merged_again = merge_investment_payloads(merged, payload)

    official_csv_validation = None
    if args.official_csv_dir:
        official_csv_validation = _hsbc_official_csv_validation(
            payload,
            _official_csv_paths(Path(args.official_csv_dir).expanduser()),
        )

    report = {
        "script_version": SCRIPT_VERSION,
        "importer_version": HSBC_STATEMENT_PDF_IMPORTER_VERSION,
        "input_pdf_count": len(paths),
        "input_files": [path.name for path in paths],
        "import_summary": payload.get("summary", {}),
        "transaction_report": _transaction_report(payload),
        "merge_simulation": {
            "store_path": str(Path(args.store).expanduser()),
            "existing_transaction_count": len(existing.get("transactions", [])) if existing else 0,
            "imported_transaction_count": len(payload.get("transactions", [])),
            "merged_transaction_count": len(merged.get("transactions", [])),
            "merged_again_transaction_count": len(merged_again.get("transactions", [])),
            "repeat_import_idempotent": (
                len(merged.get("transactions", []))
                == len(merged_again.get("transactions", []))
            ),
            "merge_details": merged.get("summary", {}).get("merge_details", {}),
            "repeat_merge_details": merged_again.get("summary", {}).get("merge_details", {}),
        },
        "official_csv_validation": official_csv_validation,
    }

    exit_code = 0
    if official_csv_validation and official_csv_validation["status"] != "passed":
        exit_code = 1

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return exit_code

    tx_report = report["transaction_report"]
    merge_report = report["merge_simulation"]
    print(f"HSBC statement validator v{SCRIPT_VERSION}")
    print(f"Importer version: {HSBC_STATEMENT_PDF_IMPORTER_VERSION}")
    print(f"PDF files: {report['input_pdf_count']}")
    print(f"Imported transaction rows: {tx_report['transaction_count']:,}")
    print(
        "Imported rows by currency: "
        + ", ".join(
            f"{currency}={count:,}"
            for currency, count in tx_report["counts_by_currency"].items()
        )
    )
    print(
        "Imported net totals by currency: "
        + ", ".join(
            f"{currency}={total}"
            for currency, total in tx_report["totals_by_currency"].items()
        )
    )
    print(
        "Merge simulation: "
        f"{merge_report['existing_transaction_count']} -> "
        f"{merge_report['merged_transaction_count']} transactions"
    )
    print(f"Repeat import idempotent: {merge_report['repeat_import_idempotent']}")
    if official_csv_validation:
        print(f"Official CSV validation: {official_csv_validation['status']}")
        for account_type, account_report in official_csv_validation["accounts"].items():
            overlap = account_report.get("pdf_overlap") or {}
            ending = account_report.get("ending_balance_check") or {}
            print(
                f"  {account_type}: {account_report.get('status')} "
                f"rows={account_report.get('row_count', 0):,} "
                f"overlap={overlap.get('official_csv_rows', 0):,}/"
                f"{overlap.get('imported_pdf_rows', 0):,} "
                f"missing={overlap.get('missing_official_rows', 0):,} "
                f"unexpected={overlap.get('unexpected_imported_rows', 0):,} "
                f"ending_balance={ending.get('passed')}"
            )
    print("Rows:")
    for row in tx_report["rows"]:
        print(
            f"  {row['date']} {row['type']} {row['amount']} "
            f"{row['description']} balance={row['balance_after']} "
            f"period={row['statement_period']} file={row['source_filename']}"
        )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
