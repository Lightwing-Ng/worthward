"""Parse immutable HSBC card statements and explicitly scoped CSV exports.

Code version: v1.0.0
"""

from __future__ import annotations

import base64
from collections import Counter
import csv
from datetime import date, datetime
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from typing import Any


PARSER_VERSION = "hsbc-credit-card-files-v1"
_AMOUNT = r"(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}"
_MONTHS = {
    name: index
    for index, name in enumerate(
        (
            "JAN",
            "FEB",
            "MAR",
            "APR",
            "MAY",
            "JUN",
            "JUL",
            "AUG",
            "SEP",
            "OCT",
            "NOV",
            "DEC",
        ),
        1,
    )
}
_CSV_COLUMNS = [
    "Transaction date",
    "Post date",
    "Description",
    "Billing amount",
    "Billing currency",
    "Transaction status",
    "Merchant name",
    "Country / region",
    "Area / district",
    "Credit / Debit",
]


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def normalize_card_account(number: str) -> str:
    """Require the complete account number; a suffix never establishes scope."""
    if not isinstance(number, str) or not re.fullmatch(r"[\d -]+", number):
        raise ValueError("A complete HSBC credit-card account number is required.")
    number = re.sub(r"[ -]", "", number)
    if len(number) != 16:
        raise ValueError("A complete HSBC credit-card account number is required.")
    return number


def _decimal(value: str) -> Decimal:
    return Decimal(value.replace(",", ""))


def _statement_date(day: str, month: str, year: str) -> date:
    return date(int(year), _MONTHS[month.upper()], int(day))


def _short_date(value: str, statement_day: date) -> str:
    match = re.fullmatch(r"(\d{2})([A-Z]{3})", value)
    if not match or match[2] not in _MONTHS:
        raise ValueError("Invalid HSBC card statement transaction date.")
    month = _MONTHS[match[2]]
    year = statement_day.year - (month > statement_day.month)
    return date(year, month, int(match[1])).isoformat()


def _row(
    account: str,
    digest: str,
    number: int,
    day: str,
    posted: str,
    description: str,
    kind: str,
    amount: Decimal,
    occurrences: Counter,
) -> dict[str, Any]:
    if amount <= 0:
        raise ValueError("HSBC credit-card transaction amounts must be positive.")
    identity = json.dumps(
        [account, day, _normalize(description).upper(), kind, str(amount)]
    )
    occurrences[identity] += 1
    return {
        "id": _sha256(f"{digest}:{number}".encode()),
        "transaction_date": day,
        "post_date": posted,
        "card_last4": account[-4:],
        "description": _normalize(description),
        "kind": kind,
        "status": "posted",
        "currency": "HKD",
        "amount": format(amount, ".2f"),
        "liability_delta": format(amount if kind == "purchase" else -amount, ".2f"),
        "occurrence": occurrences[identity],
        "source_row_number": number,
    }


def _pdf_text(raw: bytes) -> str:
    if not raw.startswith(b"%PDF-"):
        raise ValueError("The HSBC card statement is not a PDF.")
    try:
        completed = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=raw,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(
            "HSBC card PDF import requires a working pdftotext installation."
        ) from exc
    if completed.returncode:
        raise ValueError("The HSBC card statement PDF could not be read.")
    return completed.stdout.decode("utf-8")


def _pdf(raw: bytes, source: dict[str, Any]) -> dict[str, Any]:
    text = _pdf_text(raw)
    if "Statement of HSBC Red Credit Card Account" not in text:
        raise ValueError("Only English HSBC Red credit-card statements are supported.")
    accounts = {
        normalize_card_account(match)
        for match in re.findall(r"(?<!\d)\d{4} \d{4} \d{4} \d{4}(?!\d)", text)
    }
    if len(accounts) != 1:
        raise ValueError("The HSBC card statement account is missing or ambiguous.")
    account = accounts.pop()
    balances = re.findall(
        rf"(\d{{2}}) ([A-Z]{{3}}) (\d{{4}})\s+HKD({_AMOUNT})(CR)?\b", text
    )
    if not balances or len(set(balances)) != 1:
        raise ValueError("The HSBC card statement date or balance is ambiguous.")
    day, month, year, balance, credit = balances[0]
    statement_day = _statement_date(day, month, year)
    statement_balance = _decimal(balance) * (-1 if credit else 1)
    previous = re.findall(rf"PREVIOUS BALANCE\s+({_AMOUNT})(CR)?\b", text)
    if len(previous) != 1:
        raise ValueError("The HSBC card statement opening balance is missing.")
    previous_balance = _decimal(previous[0][0]) * (-1 if previous[0][1] else 1)
    rewards = {}
    for field in (
        "OPENING BALANCE",
        "EARNED",
        "ADJUSTED",
        "REDEEMED",
        "CLOSING BALANCE",
    ):
        values = re.findall(rf"REWARDCASH {field}\s*:\s*(-?\d+(?:\.\d{{2}})?)\b", text)
        if len(values) != 1:
            raise ValueError(
                "The HSBC card statement RewardCash summary is incomplete."
            )
        rewards[field.lower().replace(" ", "_")] = format(Decimal(values[0]), ".2f")
    if Decimal(rewards["opening_balance"]) + Decimal(rewards["earned"]) + Decimal(
        rewards["adjusted"]
    ) - Decimal(rewards["redeemed"]) != Decimal(rewards["closing_balance"]):
        raise ValueError("The HSBC statement RewardCash summary does not reconcile.")
    lines = text.splitlines()
    rows = []
    occurrences: Counter = Counter()
    for index, line in enumerate(lines):
        if not re.match(r"^\s*\d{2}[A-Z]{3}\b", line):
            continue
        match = re.fullmatch(
            rf"\s*(\d{{2}}[A-Z]{{3}})\s+(\d{{2}}[A-Z]{{3}})\s+(.+?)\s+({_AMOUNT})(CR)?\s*",
            line,
        )
        if not match:
            raise ValueError("An HSBC card statement transaction row is unsupported.")
        post, transaction, description, amount, credit = match.groups()
        continuation = []
        for following in lines[index + 1 :]:
            if not following.strip() or re.match(r"^\s*\d{2}[A-Z]{3}\b", following):
                break
            continuation.append(following.strip())
        reward = any(
            re.fullmatch(r"#PAY WITH RC: \d{2}[A-Z]{3}", value)
            for value in continuation
        )
        normalized = _normalize(description)
        if normalized == "IFS PAYMENT - THANK YOU" and credit:
            kind = "repayment"
        elif reward and credit:
            kind = "rewardcash"
        elif not credit and not re.search(
            r"\b(?:REFUND|REVERSAL|CREDIT|PAYMENT)\b", normalized
        ):
            kind = "purchase"
        else:
            raise ValueError(
                "The HSBC card statement transaction direction is unsupported."
            )
        foreign = re.search(rf"\s+([A-Z]{{3}})\s+({_AMOUNT})$", description)
        if foreign:
            description = description[: foreign.start()]
        row = _row(
            account,
            source["sha256"],
            len(rows) + 1,
            _short_date(transaction, statement_day),
            _short_date(post, statement_day),
            description,
            kind,
            _decimal(amount),
            occurrences,
        )
        if row["post_date"] < row["transaction_date"]:
            raise ValueError(
                "The HSBC card statement post date precedes its transaction date."
            )
        row["source_line_number"] = index + 1
        if foreign:
            row["original_currency"] = foreign[1]
            row["original_amount"] = format(_decimal(foreign[2]), ".2f")
        rows.append(row)
    if (
        not rows
        or previous_balance + sum(Decimal(row["liability_delta"]) for row in rows)
        != statement_balance
    ):
        raise ValueError(
            "The HSBC card statement transactions do not reconcile to its balance."
        )
    due = re.findall(r"Please pay by[^\n]*?(\d{2}) ([A-Z]{3}) (\d{4})\s*(?:\n|$)", text)
    minimum = re.findall(rf"Total minimum payment due\s+({_AMOUNT})\b", text)
    if len(minimum) != 1 or len(due) > 1:
        raise ValueError("The HSBC card statement payment summary is unsupported.")
    return {
        "account_number": account,
        "snapshot_as_of": statement_day.isoformat(),
        "snapshot": {
            "account_balance": format(statement_balance, ".2f"),
            "current_amount_due": None,
            "minimum_payment": format(_decimal(minimum[0]), ".2f"),
            "payment_due_date": _statement_date(*due[0]).isoformat() if due else None,
            "rewardcash_balance": rewards["closing_balance"],
        },
        "statement_summary": {
            "previous_balance": format(previous_balance, ".2f"),
            "rewardcash": rewards,
        },
        "transactions": rows,
        "text": text,
    }


def _csv(raw: bytes, source: dict[str, Any]) -> dict[str, Any]:
    account = normalize_card_account(source.get("bound_account_number", ""))
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != _CSV_COLUMNS:
        raise ValueError("The HSBC card CSV columns are unsupported.")
    rows = []
    occurrences: Counter = Counter()
    for number, values in enumerate(reader, 2):
        if None in values or any(value is None for value in values.values()):
            raise ValueError("The HSBC card CSV row is incomplete.")
        description = _normalize(values["Description"])
        raw_amount = values["Billing amount"].strip()
        if not re.fullmatch(rf"-?{_AMOUNT}", raw_amount):
            raise ValueError("The HSBC card CSV billing amount is invalid.")
        amount = _decimal(raw_amount)
        direction = values["Credit / Debit"]
        if (
            values["Billing currency"] != "HKD"
            or values["Transaction status"] != "POSTED"
        ):
            raise ValueError("Only posted HKD card CSV transactions are supported.")
        if (
            direction == "DEBIT"
            and amount < 0
            and description.upper().startswith("APPLEPAY ")
        ):
            kind = "purchase"
        elif (
            direction == "CREDIT"
            and amount > 0
            and description == "PAYMENT - THANK YOU"
        ):
            kind = "repayment"
        elif (
            direction == "CREDIT"
            and amount > 0
            and description.upper().startswith("PAY W/RC ")
        ):
            kind = "rewardcash"
        else:
            raise ValueError(
                "The HSBC card CSV direction is unsupported or contradictory."
            )
        day = datetime.strptime(values["Transaction date"], "%d/%m/%Y").date()
        posted = datetime.strptime(values["Post date"], "%d/%m/%Y").date()
        if posted < day:
            raise ValueError(
                "The HSBC card CSV post date precedes its transaction date."
            )
        rows.append(
            _row(
                account,
                source["sha256"],
                number,
                day.isoformat(),
                posted.isoformat(),
                description,
                kind,
                abs(amount),
                occurrences,
            )
        )
    if not rows:
        raise ValueError("The HSBC card CSV contains no transactions.")
    return {
        "account_number": account,
        "snapshot": None,
        "transactions": rows,
        "text": text,
    }


def parse_hsbc_credit_card_file_source(source: dict[str, Any]) -> dict[str, Any]:
    """Reparse original retained file bytes and verify extracted-text provenance."""
    try:
        raw = base64.b64decode(source["content_base64"], validate=True)
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError("The HSBC card file source bytes are invalid.") from exc
    if (
        _sha256(raw) != source.get("sha256")
        or source.get("parser_version") != PARSER_VERSION
    ):
        raise ValueError("The HSBC card file failed immutable source verification.")
    kind = source.get("format")
    if kind not in {"statement_pdf", "transaction_csv"}:
        raise ValueError("Unsupported HSBC card file source format.")
    parsed = _pdf(raw, source) if kind == "statement_pdf" else _csv(raw, source)
    text = parsed.pop("text")
    if source.get("text") != text or source.get("text_sha256") != _sha256(
        text.encode()
    ):
        raise ValueError("The HSBC card extracted text differs from its original file.")
    account = parsed.pop("account_number")
    return {
        "schema_version": 1,
        "broker": "hsbc",
        "account_id": _sha256(account.encode()),
        "account_last4": account[-4:],
        "account_name": "HSBC Red Credit Card",
        "currency": "HKD",
        "source": dict(source),
        "warnings": [],
        **parsed,
    }


def capture_hsbc_credit_card_file(
    raw: bytes,
    filename: str,
    *,
    account_number: str | None = None,
    binding_source_sha256: str | None = None,
) -> dict[str, Any]:
    """Build a source envelope from real bytes, never synthesized clipboard text."""
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".csv"} or not isinstance(raw, bytes) or not raw:
        raise ValueError("Supply an HSBC credit-card PDF or CSV file.")
    source: dict[str, Any] = {
        "sha256": _sha256(raw),
        "filename": Path(filename).name,
        "format": "statement_pdf" if suffix == ".pdf" else "transaction_csv",
        "parser_version": PARSER_VERSION,
        "content_base64": base64.b64encode(raw).decode("ascii"),
    }
    if suffix == ".csv":
        source["bound_account_number"] = normalize_card_account(account_number or "")
        source["binding_source_sha256"] = binding_source_sha256
    parsed = _pdf(raw, source) if suffix == ".pdf" else _csv(raw, source)
    source["text"] = parsed["text"]
    source["text_sha256"] = _sha256(parsed["text"].encode())
    return parse_hsbc_credit_card_file_source(source)
