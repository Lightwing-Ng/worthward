#!/usr/bin/env python3
"""Validate uSMART (HK) and Tiger Trade PDF imports without writing the store.

Code version: v0.1.1
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


from app.services.investment_import import (  # noqa: E402  # The project root is added to sys.path immediately above.
    build_investment_payload_from_tigertrade_statement_pdfs,
    build_investment_payload_from_usmart_hk_statement_pdfs,
    merge_investment_payloads,
)


def _pdf_payload(path: Path) -> tuple[bytes, str]:
    return path.read_bytes(), path.name


def _summary(payload: dict[str, Any]) -> dict[str, Any]:
    transactions = payload.get("transactions", [])
    return {
        "broker": payload.get("broker"),
        "account": payload.get("account"),
        "transaction_count": len(transactions),
        "transaction_types": dict(Counter(
            str(transaction.get("type", ""))
            for transaction in transactions
        )),
        "cash_reconciliation": payload.get("summary", {}).get("cash_reconciliation", {}),
        "statement_calibrations": payload.get("summary", {}).get("statement_calibrations", {}),
        "warnings": payload.get("summary", {}).get("warnings", []),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--usmart", type=Path, action="append", required=True)
    parser.add_argument("--tiger", type=Path, action="append", required=True)
    args = parser.parse_args()

    usmart = build_investment_payload_from_usmart_hk_statement_pdfs([
        _pdf_payload(path) for path in args.usmart
    ])
    tiger = build_investment_payload_from_tigertrade_statement_pdfs([
        _pdf_payload(path) for path in args.tiger
    ])
    merged_once = merge_investment_payloads(usmart, tiger)
    merged_twice = merge_investment_payloads(
        merge_investment_payloads(merged_once, usmart),
        tiger,
    )

    print(json.dumps({
        "usmart": _summary(usmart),
        "tiger": _summary(tiger),
        "idempotence": {
            "first_merge_count": len(merged_once.get("transactions", [])),
            "second_merge_count": len(merged_twice.get("transactions", [])),
            "passed": len(merged_once.get("transactions", [])) == len(merged_twice.get("transactions", [])),
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
