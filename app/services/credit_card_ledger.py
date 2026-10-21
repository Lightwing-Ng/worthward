"""Keep HSBC credit-card liabilities separate from investment accounting.

Code version: v1.1.0
- Added: Atomic PDF/CSV bundle reconciliation with retained original bytes,
  verified account bindings, dated statements, and exact-date evidence matching.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import unicodedata
from typing import Any, Iterator


_THREAD_LOCKS: dict[str, Any] = {}
_THREAD_LOCKS_GUARD = threading.Lock()
_HASH = re.compile(r"[0-9a-f]{64}")
_SNAPSHOT_FIELDS = (
    "account_balance",
    "current_amount_due",
    "minimum_payment",
    "payment_due_date",
    "rewardcash_balance",
)
_TRANSACTION_FIELDS = (
    "id",
    "account_id",
    "transaction_date",
    "card_last4",
    "description",
    "kind",
    "status",
    "currency",
    "amount",
    "liability_delta",
    "occurrence",
)


def _empty_ledger() -> dict[str, Any]:
    return {"schema_version": 1, "accounts": {}, "transactions": {}, "sources": {}}


def _money(value: Any, *, positive: bool = False) -> Decimal:
    if not isinstance(value, str):
        raise ValueError("Credit-card amounts must be decimal strings.")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid credit-card amount.") from exc
    if not amount.is_finite() or (positive and amount <= 0):
        raise ValueError("Invalid credit-card amount.")
    if amount != amount.quantize(Decimal("0.01")):
        raise ValueError("Credit-card amounts must use currency precision.")
    return amount


def _validate_snapshot(snapshot: Any) -> None:
    if not isinstance(snapshot, dict) or set(_SNAPSHOT_FIELDS) - snapshot.keys():
        raise ValueError("The credit-card snapshot is incomplete.")
    for field in _SNAPSHOT_FIELDS:
        value = snapshot[field]
        if field == "payment_due_date":
            if value is not None:
                date.fromisoformat(value)
        elif value is not None:
            _money(value)


def _validate_transaction(row: Any) -> None:
    if (
        not isinstance(row, dict)
        or set(_TRANSACTION_FIELDS) - {"account_id"} - row.keys()
    ):
        raise ValueError("The credit-card transaction is incomplete.")
    if not isinstance(row["id"], str) or not _HASH.fullmatch(row["id"]):
        raise ValueError("Invalid credit-card transaction identity.")
    date.fromisoformat(row["transaction_date"])
    if not re.fullmatch(r"\d{4}", str(row["card_last4"])):
        raise ValueError("Invalid credit-card suffix.")
    if not isinstance(row["description"], str) or not row["description"].strip():
        raise ValueError("Missing credit-card transaction description.")
    if row["kind"] not in {"purchase", "repayment", "rewardcash"}:
        raise ValueError("Invalid credit-card transaction kind.")
    if row["status"] not in {"posted", "pending"} or row["currency"] != "HKD":
        raise ValueError("Invalid credit-card transaction status or currency.")
    if type(row["occurrence"]) is not int or row["occurrence"] < 1:
        raise ValueError("Invalid credit-card transaction occurrence.")
    amount = _money(row["amount"], positive=True)
    delta = row["liability_delta"]
    if row["status"] == "pending":
        if delta is not None:
            raise ValueError("Pending card activity cannot change posted liabilities.")
    elif _money(delta) != (amount if row["kind"] == "purchase" else -amount):
        raise ValueError("Invalid posted credit-card liability change.")


def _validate_source(source: Any) -> None:
    if not isinstance(source, dict) or not isinstance(source.get("text"), str):
        raise ValueError("Credit-card source evidence is malformed.")
    if source.get("format"):
        from app.services.hsbc_credit_card_files import (
            parse_hsbc_credit_card_file_source,
        )

        parse_hsbc_credit_card_file_source(source)
        return
    if hashlib.sha256(source["text"].encode("utf-8")).hexdigest() != source.get(
        "sha256"
    ):
        raise ValueError("Credit-card source evidence failed SHA-256 verification.")


def _validate_ledger(ledger: Any) -> dict[str, Any]:
    if not isinstance(ledger, dict) or ledger.get("schema_version") != 1:
        raise ValueError("Unsupported credit-card ledger schema.")
    if any(
        not isinstance(ledger.get(key), dict)
        for key in ("accounts", "transactions", "sources")
    ):
        raise ValueError("The credit-card ledger is malformed.")
    parsed_sources: dict[str, dict[str, Any]] = {}
    for digest, source in ledger["sources"].items():
        _validate_source(source)
        if (
            digest != source["sha256"]
            or source.get("account_id") not in ledger["accounts"]
        ):
            raise ValueError("Invalid credit-card source ownership.")
        parsed = _parse_source(source)
        if parsed["account_id"] != source["account_id"]:
            raise ValueError(
                "Credit-card source account differs from its retained text."
            )
        parsed_sources[digest] = parsed
    for digest, source in ledger["sources"].items():
        if source.get("format") != "transaction_csv":
            continue
        binding = source.get("binding_source_sha256")
        if (
            binding == digest
            or binding not in parsed_sources
            or ledger["sources"][binding].get("format") == "transaction_csv"
            or parsed_sources[binding]["account_id"] != source["account_id"]
        ):
            raise ValueError(
                "The credit-card CSV has no verified full-account binding."
            )
    aliases: set[str] = set()
    for account_id, account in ledger["accounts"].items():
        if not _HASH.fullmatch(account_id) or not isinstance(account, dict):
            raise ValueError("Invalid credit-card account identity.")
        if account.get("account_id") != account_id or account.get("currency") != "HKD":
            raise ValueError("Invalid credit-card account ownership.")
        _validate_snapshot(account.get("snapshot"))
        history = account.get("captures")
        if not isinstance(history, list) or not history:
            raise ValueError("Missing credit-card snapshot provenance.")
        for sequence, capture in enumerate(history, 1):
            source = ledger["sources"].get(capture.get("source_sha256"), {})
            if (
                source.get("account_id") != account_id
                or capture.get("sequence") != sequence
            ):
                raise ValueError("Invalid credit-card snapshot provenance.")
            parsed = parsed_sources[capture["source_sha256"]]
            if capture.get("snapshot") is not None:
                _validate_snapshot(capture["snapshot"])
            if capture["snapshot"] != parsed["snapshot"]:
                raise ValueError("Credit-card snapshot differs from its retained text.")
            if capture.get("snapshot_as_of") != parsed.get("snapshot_as_of"):
                raise ValueError(
                    "Credit-card statement date differs from its original file."
                )
            if capture.get("statement_summary") != parsed.get("statement_summary"):
                raise ValueError(
                    "Credit-card statement summary differs from its original file."
                )
        selected = _select_snapshot_capture(history, parsed_sources)
        if account["snapshot"] != selected["snapshot"]:
            raise ValueError("Credit-card snapshot does not match its latest capture.")
        latest = parsed_sources[selected["source_sha256"]]
        if any(
            account.get(field) != latest[field]
            for field in ("account_last4", "account_name", "currency")
        ):
            raise ValueError(
                "Credit-card account details differ from their retained text."
            )
    for identity, row in ledger["transactions"].items():
        _validate_transaction(row)
        if row["id"] != identity or row.get("account_id") not in ledger["accounts"]:
            raise ValueError("Invalid credit-card transaction ownership.")
        row_aliases = row.get("capture_ids")
        if not isinstance(row_aliases, list) or identity not in row_aliases:
            raise ValueError("Missing credit-card transaction identity provenance.")
        for alias in row_aliases:
            if (
                not isinstance(alias, str)
                or not _HASH.fullmatch(alias)
                or alias in aliases
            ):
                raise ValueError("Conflicting credit-card transaction identities.")
            aliases.add(alias)
        sources = row.get("source_sha256s")
        if not isinstance(sources, list) or not sources:
            raise ValueError("Missing credit-card transaction source evidence.")
        if any(
            ledger["sources"].get(item, {}).get("account_id") != row["account_id"]
            for item in sources
        ):
            raise ValueError("Invalid credit-card transaction source ownership.")
        evidence = []
        for digest in sources:
            matched = [
                item
                for item in parsed_sources[digest]["transactions"]
                if item["id"] in row_aliases
            ]
            if len(matched) != 1:
                raise ValueError(
                    "Credit-card source rows must preserve transaction multiplicity."
                )
            evidence.extend(matched)
        if set(row_aliases) != {item["id"] for item in evidence}:
            raise ValueError(
                "Credit-card transaction identities differ from their retained text."
            )
        if any(
            item["transaction_date"] != row["transaction_date"]
            or _match_key({**item, "account_id": row["account_id"]}) != _match_key(row)
            for item in evidence
        ):
            raise ValueError("Credit-card corroborating rows differ economically.")
        expected_status = (
            "posted"
            if any(item["status"] == "posted" for item in evidence)
            else "pending"
        )
        fields = set(_TRANSACTION_FIELDS) - {"id", "account_id"}
        fields.update(
            field
            for field in (
                "post_date",
                "source_row_number",
                "source_line_number",
                "original_currency",
                "original_amount",
            )
            if field in row
        )
        if row["status"] != expected_status or not any(
            all(row[field] == item.get(field) for field in fields) for item in evidence
        ):
            raise ValueError("Credit-card transaction differs from its retained text.")
        post_dates = sorted(
            {item["post_date"] for item in evidence if item.get("post_date")}
        )
        if row.get("post_dates", []) != post_dates:
            raise ValueError(
                "Credit-card post dates differ from their source evidence."
            )
    if aliases != {
        row["id"]
        for source in parsed_sources.values()
        for row in source["transactions"]
    }:
        raise ValueError("Credit-card ledger omits retained transaction evidence.")
    return ledger


def load_credit_card_ledger(path: Path) -> dict[str, Any]:
    """Read verified local evidence without creating files or directories."""
    path = Path(path)
    if not path.exists():
        return _empty_ledger()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return _validate_ledger(payload)
    except (ValueError, TypeError, KeyError, AttributeError, ArithmeticError) as exc:
        raise ValueError(
            "The credit-card ledger is damaged or incompatible; it was not changed."
        ) from exc


def _public_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {field: snapshot[field] for field in _SNAPSHOT_FIELDS}


def _public_transaction(row: dict[str, Any]) -> dict[str, Any]:
    result = {field: row[field] for field in _TRANSACTION_FIELDS if field in row}
    result["description"] = re.sub(
        r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)",
        "[card number redacted]",
        result["description"],
    )
    if row.get("post_dates"):
        result["post_dates"] = row["post_dates"]
    elif row.get("post_date"):
        result["post_dates"] = [row["post_date"]]
    return result


def _summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for prefix, kind, status in (
        ("posted_purchase", "purchase", "posted"),
        ("repayment", "repayment", "posted"),
        ("rewardcash", "rewardcash", "posted"),
        ("pending", None, "pending"),
    ):
        selected = [
            row
            for row in rows
            if row["status"] == status and (kind is None or row["kind"] == kind)
        ]
        result[f"{prefix}_count"] = len(selected)
        result[f"{prefix}_total"] = format(
            sum((_money(row["amount"]) for row in selected), Decimal(0)), ".2f"
        )
    return result


def _public_account(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "account_id": account["account_id"],
        "last4": account["account_last4"],
        "name": account["account_name"],
        "currency": account["currency"],
        "snapshot": _public_snapshot(account["snapshot"]),
        "capture_count": len(account.get("captures", [])),
        "captured_at": account.get("captured_at"),
    }


def read_credit_card_ledger(path: Path) -> dict[str, Any]:
    """Return browser-safe card balances and transactions, never source text."""
    ledger = load_credit_card_ledger(path)
    rows = [_public_transaction(row) for row in ledger["transactions"].values()]
    return {
        "schema_version": 1,
        "accounts": [
            _public_account(account) for account in ledger["accounts"].values()
        ],
        "transactions": rows,
        "summary": _summary(rows),
        "warnings": [],
    }


def _parse_capture(text: str) -> dict[str, Any]:
    from app.services.hsbc_credit_card import parse_hsbc_credit_card_text

    capture = parse_hsbc_credit_card_text(text)
    if capture.get("schema_version") != 1 or capture.get("broker") != "hsbc":
        raise ValueError("Unsupported HSBC credit-card capture.")
    if not _HASH.fullmatch(capture["account_id"]) or capture["currency"] != "HKD":
        raise ValueError("Invalid HSBC credit-card capture ownership.")
    _validate_source(capture["source"])
    if capture["source"]["text"] != text:
        raise ValueError(
            "HSBC credit-card source evidence differs from the submitted text."
        )
    _validate_snapshot(capture["snapshot"])
    identities = set()
    for row in capture["transactions"]:
        _validate_transaction(row)
        if row["id"] in identities:
            raise ValueError("Conflicting transactions in the credit-card capture.")
        identities.add(row["id"])
    return capture


def _parse_source(source: dict[str, Any]) -> dict[str, Any]:
    if source.get("format"):
        from app.services.hsbc_credit_card_files import (
            parse_hsbc_credit_card_file_source,
        )

        return parse_hsbc_credit_card_file_source(source)
    return _parse_capture(source["text"])


def _select_snapshot_capture(
    history: list[dict[str, Any]],
    parsed_sources: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    # Importing historical statements never replaces a user's visible page snapshot.
    pages = [
        item
        for item in history
        if not parsed_sources[item["source_sha256"]]["source"].get("format")
    ]
    if pages:
        return pages[-1]
    statements = [item for item in history if item.get("snapshot") is not None]
    if not statements:
        raise ValueError(
            "A credit-card account needs a verified page or statement snapshot."
        )
    return max(
        statements, key=lambda item: (item.get("snapshot_as_of", ""), item["sequence"])
    )


def _match_key(row: dict[str, Any]) -> tuple[Any, ...]:
    description = " ".join(
        unicodedata.normalize("NFKC", row["description"]).upper().split()
    )
    if row["kind"] == "repayment" and description == "IFS PAYMENT - THANK YOU":
        description = "PAYMENT - THANK YOU"
    elif row["kind"] == "purchase" and description.startswith("APPLEPAY "):
        description = description[len("APPLEPAY ") :]
    elif row["kind"] == "rewardcash" and description.startswith("PAY W/RC "):
        description = description[len("PAY W/RC ") :]
    return (
        row["account_id"],
        row["card_last4"],
        row["kind"],
        row["currency"],
        _money(row["amount"]),
        description,
    )


def _cross_date_match(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if left["status"] == right["status"] or _match_key(left) != _match_key(right):
        return False
    pending, posted = (left, right) if left["status"] == "pending" else (right, left)
    distance = (
        date.fromisoformat(posted["transaction_date"])
        - date.fromisoformat(pending["transaction_date"])
    ).days
    return 1 <= distance <= 7


def _merge_capture(
    ledger: dict[str, Any], capture: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    merged = deepcopy(ledger)
    account_id, digest = capture["account_id"], capture["source"]["sha256"]
    incoming = [
        {**deepcopy(row), "account_id": account_id} for row in capture["transactions"]
    ]
    existing = {
        key: row
        for key, row in merged["transactions"].items()
        if row["account_id"] == account_id
    }
    aliases = {
        alias: key for key, row in existing.items() for alias in row["capture_ids"]
    }
    matches = {
        row["id"]: aliases[row["id"]] for row in incoming if row["id"] in aliases
    }
    if capture["source"].get("format") or any(
        merged["sources"][source].get("format")
        for row in existing.values()
        for source in row["source_sha256s"]
    ):
        consumed = set(matches.values())
        for row in incoming:
            if row["id"] in matches:
                continue
            compatible = [
                key
                for key, old in existing.items()
                if key not in consumed
                and old["transaction_date"] == row["transaction_date"]
                and _match_key(old) == _match_key(row)
            ]
            if compatible:
                key = min(
                    compatible, key=lambda value: (existing[value]["occurrence"], value)
                )
                matches[row["id"]] = key
                consumed.add(key)
    candidates = {
        row["id"]: [key for key, old in existing.items() if _cross_date_match(row, old)]
        for row in incoming
        if row["id"] not in matches
    }
    ambiguous = any(candidates.values()) or any(
        _cross_date_match(left, right)
        for index, left in enumerate(incoming)
        for right in incoming[index + 1 :]
    )
    counts = {"added_count": 0, "promoted_count": 0, "duplicate_count": 0}
    warnings = list(capture.get("warnings", []))
    if ambiguous:
        warnings.append(
            "Pending and posted card transactions on different dates may refer to the same purchase. A matching merchant and amount cannot prove this without a bank transaction reference. Review the original statements before importing; no records were committed."
        )
    else:
        for row in incoming:
            key = matches.get(row["id"])
            if key is None:
                merged["transactions"][row["id"]] = {
                    **row,
                    "capture_ids": [row["id"]],
                    "source_sha256s": [digest],
                    **(
                        {"post_dates": [row["post_date"]]}
                        if row.get("post_date")
                        else {}
                    ),
                }
                counts["added_count"] += 1
                continue
            old = merged["transactions"][key]
            if row["id"] not in old["capture_ids"]:
                old["capture_ids"].append(row["id"])
            if digest not in old["source_sha256s"]:
                old["source_sha256s"].append(digest)
            if row.get("post_date"):
                old["post_dates"] = sorted(
                    set(old.get("post_dates", [])) | {row["post_date"]}
                )
            if old["status"] == "pending" and row["status"] == "posted":
                old.update({**row, "id": key})
                counts["promoted_count"] += 1
            else:
                counts["duplicate_count"] += 1
        if digest not in merged["sources"]:
            captured_at = datetime.now(timezone.utc).isoformat()
            merged["sources"][digest] = {
                **capture["source"],
                "account_id": account_id,
                "captured_at": captured_at,
            }
            account = merged["accounts"].setdefault(account_id, {"captures": []})
            account["captures"].append(
                {
                    "sequence": len(account["captures"]) + 1,
                    "source_sha256": digest,
                    "captured_at": captured_at,
                    "snapshot": deepcopy(capture["snapshot"]),
                    **(
                        {"snapshot_as_of": capture["snapshot_as_of"]}
                        if capture.get("snapshot_as_of")
                        else {}
                    ),
                    **(
                        {"statement_summary": deepcopy(capture["statement_summary"])}
                        if capture.get("statement_summary")
                        else {}
                    ),
                }
            )
            parsed_sources = {
                key: _parse_source(source) for key, source in merged["sources"].items()
            }
            selected = _select_snapshot_capture(account["captures"], parsed_sources)
            account.update(
                {
                    "account_id": account_id,
                    "account_last4": capture["account_last4"],
                    "account_name": capture["account_name"],
                    "currency": capture["currency"],
                    "snapshot": deepcopy(selected["snapshot"]),
                    "captured_at": selected["captured_at"],
                }
            )
        _validate_ledger(merged)
    rows = [
        row
        for row in merged["transactions"].values()
        if row["account_id"] == account_id
    ]
    result = {
        "ready": not ambiguous,
        "review_required": ambiguous,
        "account": {
            "account_id": account_id,
            "last4": capture["account_last4"],
            "name": capture["account_name"],
            "currency": capture["currency"],
        },
        "snapshot": _public_snapshot(capture["snapshot"])
        if capture["snapshot"] is not None
        else None,
        "capture_snapshot": _public_snapshot(capture["snapshot"])
        if capture["snapshot"] is not None
        else None,
        "merged_snapshot": _public_snapshot(merged["accounts"][account_id]["snapshot"])
        if account_id in merged["accounts"]
        else None,
        "snapshot_captured_at": merged["accounts"]
        .get(account_id, {})
        .get("captured_at"),
        "transactions": [_public_transaction(row) for row in incoming],
        "merged_transactions": [_public_transaction(row) for row in rows],
        "capture_summary": _summary(incoming),
        "summary": {**_summary(rows), **counts},
        "warnings": warnings,
        "source_sha256": digest,
        "source_already_imported": digest in ledger["sources"],
    }
    return merged, result


def preview_hsbc_credit_card_import(text: str, path: Path) -> dict[str, Any]:
    """Parse and merge in memory; never create a lock, cache, or evidence file."""
    capture = _parse_capture(text)
    _, result = _merge_capture(load_credit_card_ledger(path), capture)
    return result


@contextmanager
def _write_lock(path: Path) -> Iterator[None]:
    key = str(path.resolve())
    with _THREAD_LOCKS_GUARD:
        thread_lock = _THREAD_LOCKS.setdefault(key, threading.RLock())
    with thread_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(
            path.with_name(f".{path.name}.lock"), os.O_CREAT | os.O_RDWR, 0o600
        )
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)


def _atomic_write(path: Path, ledger: dict[str, Any]) -> None:
    encoded = json.dumps(ledger, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        if load_credit_card_ledger(temporary) != ledger:
            raise ValueError("Credit-card ledger staging verification failed.")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def commit_hsbc_credit_card_import(text: str, path: Path) -> dict[str, Any]:
    """Commit one verified capture while holding thread and process locks."""
    path = Path(path)
    capture = _parse_capture(text)
    with _write_lock(path):
        before = load_credit_card_ledger(path)
        merged, result = _merge_capture(before, capture)
        if not result["ready"]:
            return {**result, "committed": False}
        if merged != before:
            _atomic_write(path, merged)
        persisted = load_credit_card_ledger(path)
        if persisted != merged:
            raise ValueError("Credit-card ledger readback verification failed.")
        account = persisted["accounts"][capture["account_id"]]
        rows = [
            _public_transaction(row)
            for row in persisted["transactions"].values()
            if row["account_id"] == capture["account_id"]
        ]
        return {
            **result,
            "committed": True,
            "snapshot": _public_snapshot(account["snapshot"]),
            "transactions": rows,
        }


def _file_captures(
    files: list[Path],
    ledger: dict[str, Any],
    account_number: str | None,
) -> list[dict[str, Any]]:
    from app.services.hsbc_credit_card_files import (
        capture_hsbc_credit_card_file,
        normalize_card_account,
    )

    if not files:
        raise ValueError("Supply at least one HSBC credit-card file.")
    inputs = [(Path(item), Path(item).read_bytes()) for item in files]
    if any(path.suffix.lower() not in {".pdf", ".csv"} for path, _ in inputs):
        raise ValueError("Only HSBC credit-card PDF and CSV files are supported.")
    captures = [
        capture_hsbc_credit_card_file(raw, path.name)
        for path, raw in inputs
        if path.suffix.lower() == ".pdf"
    ]
    accounts = {capture["account_id"] for capture in captures}
    if len(accounts) > 1:
        raise ValueError(
            "An HSBC card file bundle must belong to one complete account."
        )
    number = (
        normalize_card_account(account_number) if account_number is not None else None
    )
    if (
        number
        and accounts
        and hashlib.sha256(number.encode()).hexdigest() not in accounts
    ):
        raise ValueError(
            "The HSBC card file bundle differs from its explicit account scope."
        )
    if not number and captures:
        full_numbers = {
            normalize_card_account(value)
            for capture in captures
            for value in re.findall(
                r"(?<!\d)\d{4} \d{4} \d{4} \d{4}(?!\d)", capture["source"]["text"]
            )
        }
        if len(full_numbers) != 1:
            raise ValueError(
                "The HSBC card file bundle has no unambiguous full account."
            )
        number = full_numbers.pop()
    csv_inputs = [(path, raw) for path, raw in inputs if path.suffix.lower() == ".csv"]
    if csv_inputs:
        if number is None:
            raise ValueError(
                "An accountless card CSV needs a complete verified account scope."
            )
        account_id = hashlib.sha256(number.encode()).hexdigest()
        bindings = [
            capture["source"]["sha256"]
            for capture in captures
            if capture["account_id"] == account_id
        ] or [
            digest
            for digest, source in ledger["sources"].items()
            if source["account_id"] == account_id
            and source.get("format") != "transaction_csv"
        ]
        if not bindings:
            raise ValueError(
                "The card CSV account must be proven by a retained page or statement."
            )
        for path, raw in csv_inputs:
            capture = capture_hsbc_credit_card_file(
                raw,
                path.name,
                account_number=number,
                binding_source_sha256=bindings[0],
            )
            prior = ledger["sources"].get(capture["source"]["sha256"])
            if prior is not None:
                if prior["account_id"] != account_id:
                    raise ValueError(
                        "The retained card CSV is already bound to a different account."
                    )
                # Replaying one byte-identical source retains its original binding.
                capture = _parse_source(prior)
            captures.append(capture)
    return captures


def _merge_file_captures(
    before: dict[str, Any],
    captures: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    merged = before
    files = []
    counts = {"added_count": 0, "promoted_count": 0, "duplicate_count": 0}
    warnings = []
    ready = True
    for capture in captures:
        merged, item = _merge_capture(merged, capture)
        files.append(
            {
                "filename": capture["source"]["filename"],
                "format": capture["source"]["format"],
                "source_sha256": capture["source"]["sha256"],
                "snapshot_as_of": capture.get("snapshot_as_of"),
                "capture_snapshot": item["capture_snapshot"],
                "capture_summary": item["capture_summary"],
                "summary": {key: item["summary"][key] for key in counts},
                "source_already_imported": item["source_already_imported"],
            }
        )
        for key in counts:
            counts[key] += item["summary"][key]
        warnings.extend(item["warnings"])
        ready = ready and item["ready"]
        if not ready:
            break
    account_id = captures[0]["account_id"]
    rows = [
        row
        for row in merged["transactions"].values()
        if row["account_id"] == account_id
    ]
    account = merged["accounts"].get(account_id)
    return merged, {
        "ready": ready,
        "review_required": not ready,
        "account": _public_account(account) if account else None,
        "snapshot": _public_snapshot(account["snapshot"]) if account else None,
        "merged_snapshot": _public_snapshot(account["snapshot"]) if account else None,
        "files": files,
        "input_file_count": len(captures),
        "input_row_count": sum(len(capture["transactions"]) for capture in captures),
        "unique_transaction_count": len(rows),
        "transactions": [_public_transaction(row) for row in rows],
        "summary": {**_summary(rows), **counts},
        "warnings": list(dict.fromkeys(warnings)),
    }


def preview_hsbc_credit_card_files(
    files: list[Path],
    path: Path,
    *,
    account_number: str | None = None,
) -> dict[str, Any]:
    """Verify a real-file bundle and reconcile in memory without writing anything."""
    before = load_credit_card_ledger(Path(path))
    captures = _file_captures(files, before, account_number)
    _, result = _merge_file_captures(before, captures)
    return result


def commit_hsbc_credit_card_files(
    files: list[Path],
    path: Path,
    *,
    account_number: str | None = None,
) -> dict[str, Any]:
    """Commit an entire verified file bundle atomically under the normal ledger lock."""
    path = Path(path)
    with _write_lock(path):
        before = load_credit_card_ledger(path)
        captures = _file_captures(files, before, account_number)
        merged, result = _merge_file_captures(before, captures)
        if not result["ready"]:
            return {**result, "committed": False}
        if merged != before:
            _atomic_write(path, merged)
        if load_credit_card_ledger(path) != merged:
            raise ValueError("Credit-card file-bundle readback verification failed.")
        return {**result, "committed": True}
