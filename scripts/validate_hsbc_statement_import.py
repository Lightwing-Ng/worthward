#!/usr/bin/env python3
"""Validate HSBC statement PDF imports without writing investment.parquet.

Code version: v0.1.1
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from decimal import Decimal
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


SCRIPT_VERSION = "0.1.0"
ZERO = Decimal("0")


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


def _transaction_report(payload: dict[str, Any]) -> dict[str, Any]:
    totals_by_period: dict[str, Decimal] = defaultdict(Decimal)
    counts_by_period: dict[str, int] = defaultdict(int)
    total = ZERO
    rows: list[dict[str, Any]] = []
    for transaction in payload.get("transactions", []):
        if not isinstance(transaction, dict):
            continue
        source = transaction.get("source") if isinstance(transaction.get("source"), dict) else {}
        period = str(source.get("statement_period") or "")
        amount = _decimal(transaction.get("net_amount_raw"))
        total += amount
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
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    tx_report = report["transaction_report"]
    merge_report = report["merge_simulation"]
    print(f"HSBC statement validator v{SCRIPT_VERSION}")
    print(f"Importer version: {HSBC_STATEMENT_PDF_IMPORTER_VERSION}")
    print(f"PDF files: {report['input_pdf_count']}")
    print(f"Imported USD rows: {tx_report['transaction_count']}")
    print(f"Imported USD net total: {tx_report['net_amount_total']}")
    print(
        "Merge simulation: "
        f"{merge_report['existing_transaction_count']} -> "
        f"{merge_report['merged_transaction_count']} transactions"
    )
    print(f"Repeat import idempotent: {merge_report['repeat_import_idempotent']}")
    print("Rows:")
    for row in tx_report["rows"]:
        print(
            f"  {row['date']} {row['type']} {row['amount']} "
            f"{row['description']} balance={row['balance_after']} "
            f"period={row['statement_period']} file={row['source_filename']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
