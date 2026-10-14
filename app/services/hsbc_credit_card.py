"""Parse HSBC credit-card clipboard evidence without persistence or network access.

Code version: v0.1.0
"""

from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import unicodedata


_NUMBER = r"(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?"
_MONEY = re.compile(rf"(?P<amount>-?{_NUMBER})(?:\s+(?P<currency>[A-Z]{{3}}))?")
_DATE = re.compile(r"(\d{1,2}) ([A-Za-z]{3}) (\d{4})")
_MONTHS = {
    month: index
    for index, month in enumerate(
        (
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
        ),
        start=1,
    )
}
_TABLE_HEADER = (
    "Transaction date Card Description Amount in Amount out Additional options"
)
_FOOTER_STARTS = {
    "Download",
    "Print your transaction summary",
    "Show more transactions",
}


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _date(value: str, field: str) -> str:
    match = _DATE.fullmatch(value)
    if not match or match[2].lower() not in _MONTHS:
        raise ValueError(f"The HSBC credit-card {field} is missing or invalid.")
    try:
        return date(int(match[3]), _MONTHS[match[2].lower()], int(match[1])).isoformat()
    except ValueError as error:
        raise ValueError(f"The HSBC credit-card {field} is invalid.") from error


def _field(lines: list[str], label: str) -> tuple[str, int]:
    matches = []
    for index, line in enumerate(lines):
        if line.casefold() == label.casefold():
            matches.append(
                (lines[index + 1] if index + 1 < len(lines) else "", index + 1)
            )
        elif line.casefold().startswith(label.casefold() + " "):
            matches.append((line[len(label) :].strip(), index))
    if len(matches) != 1 or not matches[0][0]:
        raise ValueError(
            f"The HSBC credit-card text requires exactly one {label.rstrip(':')}."
        )
    return matches[0]


def _money(value: str, *, currency: bool, signed: bool = False) -> str:
    match = _MONEY.fullmatch(value)
    if not match or (currency and match["currency"] != "HKD"):
        raise ValueError(
            "The HSBC credit-card amount must be an unambiguous HKD amount."
        )
    if match["currency"] not in (None, "HKD"):
        raise ValueError("Only HKD HSBC credit-card amounts are supported.")
    amount = Decimal(match["amount"].replace(",", ""))
    if amount < 0 and not signed:
        raise ValueError(
            "The HSBC credit-card amount has an unsupported negative direction."
        )
    try:
        return format(amount.quantize(Decimal("0.01")), "f")
    except InvalidOperation as error:
        raise ValueError(
            "The HSBC credit-card amount exceeds the supported precision."
        ) from error


def _snapshot_money(lines: list[str], label: str, *, signed: bool = False) -> str:
    value, index = _field(lines, label)
    if re.fullmatch(rf"-?{_NUMBER}", value) and index + 1 < len(lines):
        value += " " + lines[index + 1]
    return _money(value, currency=True, signed=signed)


def _account(lines: list[str]) -> tuple[str, str, str]:
    raw_number, _ = _field(lines, "Account number:")
    if not re.fullmatch(r"[\d -]+", raw_number):
        raise ValueError(
            "The HSBC credit-card text requires the complete account number."
        )
    number = re.sub(r"[ -]", "", raw_number)
    if len(number) == 32 and number[:16] == number[16:]:
        number = number[:16]
    if len(number) != 16:
        raise ValueError(
            "The HSBC credit-card account number is incomplete or ambiguous."
        )
    names = [line for line in lines if re.fullmatch(r"HSBC .+Credit Card", line)]
    if len(names) != 1:
        raise ValueError(
            "The HSBC text requires exactly one named credit-card account."
        )
    return _digest(number), number[-4:], names[0]


def _transaction_lines(lines: list[str]) -> list[str]:
    starts = []
    for index, line in enumerate(lines):
        if line.startswith("Transaction date"):
            combined = line
            end = index + 1
            while end < len(lines) and len(combined) < len(_TABLE_HEADER):
                combined += " " + lines[end]
                end += 1
            if combined != _TABLE_HEADER:
                raise ValueError(
                    "The HSBC credit-card transaction columns are unsupported."
                )
            starts.append(end)
    if len(starts) != 1:
        raise ValueError(
            "The HSBC credit-card text requires exactly one transaction table."
        )
    rows = lines[starts[0] :]
    end = next(
        (index for index, line in enumerate(rows) if line in _FOOTER_STARTS), len(rows)
    )
    rows = rows[:end]
    if not rows:
        raise ValueError("The HSBC credit-card transaction table is empty.")
    return rows


def _kind(description: str) -> tuple[str, str]:
    normalized = _normalize(description).upper()
    if normalized == "PAYMENT - THANK YOU":
        return "repayment", "in"
    if re.search(r"\b(?:REFUND|REVERSAL|REVERSED|CHARGEBACK|CREDIT)\b", normalized):
        raise ValueError(
            "The HSBC credit-card transaction has an ambiguous credit direction."
        )
    if re.match(r"^PAY W/RC \S", normalized):
        return "rewardcash", "in"
    if re.match(r"^APPLEPAY \S", normalized):
        return "purchase", "out"
    raise ValueError(
        "The HSBC credit-card transaction description has an unsupported direction."
    )


def _transactions(lines: list[str], account_id: str, account_last4: str) -> list[dict]:
    result = []
    occurrences: Counter[str] = Counter()
    identity_statuses = {}
    index = 0
    while index < len(lines):
        transaction_date = _date(lines[index], "transaction date")
        index += 1
        if index < len(lines) and not lines[index].startswith("Card ending in "):
            # A copied row may include one cardholder-name line. It is not structured data.
            if not re.fullmatch(r"[^\d:]+", lines[index]) or _DATE.fullmatch(
                lines[index]
            ):
                raise ValueError(
                    "The HSBC credit-card row has ambiguous cardholder details."
                )
            index += 1
        if index >= len(lines):
            raise ValueError("The HSBC credit-card row is incomplete.")
        card = re.fullmatch(r"Card ending in (\d{4})", lines[index])
        if not card or card[1] != account_last4:
            raise ValueError(
                "The HSBC credit-card row does not match the selected account."
            )
        index += 1
        description_lines = []
        while index < len(lines):
            line = lines[index]
            if _MONEY.fullmatch(line) or line.startswith(("Amount in", "Amount out")):
                break
            if line == "Pending" or _DATE.fullmatch(line) or line in _FOOTER_STARTS:
                break
            if line.startswith("Card ending in "):
                raise ValueError(
                    "The HSBC credit-card row is missing a transaction date or amount."
                )
            description_lines.append(line)
            index += 1
        if not description_lines or index >= len(lines):
            raise ValueError(
                "The HSBC credit-card transaction description or amount is missing."
            )
        description = " ".join(description_lines)
        kind, direction = _kind(description)
        direction_source = "description"
        amount_text = lines[index]
        explicit_direction = re.fullmatch(r"Amount (in|out):?(?: (.+))?", amount_text)
        if explicit_direction:
            if explicit_direction[1] != direction:
                raise ValueError(
                    "The HSBC credit-card amount column contradicts its description."
                )
            direction_source = "amount_column"
            if explicit_direction[2]:
                amount_text = explicit_direction[2]
            else:
                index += 1
                if index >= len(lines):
                    raise ValueError(
                        "The HSBC credit-card transaction amount is missing."
                    )
                amount_text = lines[index]
        if re.fullmatch(_NUMBER, amount_text) and index + 1 < len(lines):
            index += 1
            amount_text += " " + lines[index]
        amount = _money(amount_text, currency=True)
        if Decimal(amount) == 0:
            raise ValueError(
                "The HSBC credit-card transaction amount must be positive."
            )
        index += 1
        status = "posted"
        if index < len(lines) and lines[index] == "Pending":
            status = "pending"
            index += 1
        identity = json.dumps(
            [
                account_id,
                card[1],
                transaction_date,
                _normalize(description).upper(),
                kind,
                "HKD",
                amount,
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        if identity in identity_statuses and identity_statuses[identity] != status:
            raise ValueError(
                "The HSBC credit-card capture has ambiguous matching pending and posted rows."
            )
        identity_statuses[identity] = status
        occurrences[identity] += 1
        occurrence = occurrences[identity]
        delta = amount if direction == "out" else format(-Decimal(amount), "f")
        result.append(
            {
                "id": _digest(f"{identity}:{occurrence}"),
                "transaction_date": transaction_date,
                "card_last4": card[1],
                "description": description,
                "kind": kind,
                "status": status,
                "currency": "HKD",
                "amount": amount,
                "amount_direction": direction,
                "direction_source": direction_source,
                "liability_delta": delta if status == "posted" else None,
                "occurrence": occurrence,
            }
        )
    return result


def parse_hsbc_credit_card_text(text: str) -> dict:
    """Return an evidence-backed capture or reject unsupported/ambiguous content.

    Copied HSBC text loses empty amount-column cells. Only descriptions with an
    explicit meaning can then establish direction: Apple Pay purchases increase
    the liability, repayments and Pay with RC reduce it. This function never
    infers a missing opening balance or reconciles a partial transaction list to
    the displayed account balance.
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Paste an HSBC credit-card account page with transactions.")
    lines = [_normalize(line) for line in text.splitlines() if line.strip()]
    account_id, account_last4, account_name = _account(lines)
    rewardcash, _ = _field(lines, "RewardCash balance:")
    due_date, _ = _field(lines, "Payment due date:")
    snapshot = {
        "account_balance": _snapshot_money(lines, "Account balance:", signed=True),
        "current_amount_due": _snapshot_money(lines, "Current amount due:"),
        "minimum_payment": _snapshot_money(lines, "Total minimum payment amount:"),
        "payment_due_date": _date(due_date, "payment due date"),
        "rewardcash_balance": _money(rewardcash, currency=False),
    }
    transactions = _transactions(_transaction_lines(lines), account_id, account_last4)
    return {
        "schema_version": 1,
        "broker": "hsbc",
        "account_id": account_id,
        "account_last4": account_last4,
        "account_name": account_name,
        "currency": "HKD",
        "snapshot": snapshot,
        "transactions": transactions,
        "source": {"sha256": _digest(text), "text": text},
        "warnings": [],
    }
