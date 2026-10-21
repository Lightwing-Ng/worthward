#!/usr/bin/env python3
"""Preview or explicitly commit HSBC card files through the card ledger service.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import SETTINGS_STORE_DIR  # noqa: E402
from app.services.credit_card_ledger import (  # noqa: E402
    commit_hsbc_credit_card_files,
    preview_hsbc_credit_card_files,
)


def _fingerprint(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def _input_files(inputs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for item in inputs:
        item = item.expanduser()
        candidates = sorted(item.iterdir()) if item.is_dir() else [item]
        files.extend(
            candidate.resolve()
            for candidate in candidates
            if candidate.is_file() and candidate.suffix.lower() in {".pdf", ".csv"}
        )
    unique = list(dict.fromkeys(files))
    if not unique:
        raise ValueError("Supply HSBC credit-card PDF or CSV files.")
    return unique


def _backup(path: Path, digest: str) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = path.with_name(f"{path.name}.before-hsbc-card-files-{timestamp}.bak")
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as destination, path.open("rb") as source:
        shutil.copyfileobj(source, destination)
        destination.flush()
        os.fsync(destination.fileno())
    if _fingerprint(backup) != digest or _fingerprint(path) != digest:
        raise ValueError("The card ledger changed during backup. Preview it again.")
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument(
        "--store", type=Path, default=SETTINGS_STORE_DIR / "credit_cards.json"
    )
    parser.add_argument("--commit", action="store_true")
    parser.add_argument(
        "--expected-ledger-sha256",
        help="Require the existing card ledger to match a previously reviewed preview.",
    )
    args = parser.parse_args()
    try:
        files = _input_files(args.inputs)
        source_hashes = {file: _fingerprint(file) for file in files}
        store = args.store.expanduser().resolve()
        before = _fingerprint(store)
        if args.expected_ledger_sha256 and before != args.expected_ledger_sha256:
            raise ValueError("The card ledger changed. Preview it again before committing.")
        result = preview_hsbc_credit_card_files(files, store)
        backup = None
        if args.commit and result.get("ready"):
            if any(_fingerprint(file) != digest for file, digest in source_hashes.items()):
                raise ValueError("A source file changed after preview. Preview it again.")
            if _fingerprint(store) != before:
                raise ValueError("The card ledger changed after preview. Preview it again.")
            if before is not None:
                backup = _backup(store, before)
            result = commit_hsbc_credit_card_files(files, store)
        report = {
            "script_version": "v1.0.0",
            "ready": result.get("ready", False),
            "committed": result.get("committed", False),
            "input_files": [path.name for path in files],
            "ledger_sha256_before": before,
            "ledger_sha256_after": _fingerprint(store),
            "backup": str(backup) if backup else None,
            "summary": result.get("summary", {}),
            "warnings": result.get("warnings", []),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ready"] and (not args.commit or report["committed"]) else 2
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Card reconciliation stopped: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
