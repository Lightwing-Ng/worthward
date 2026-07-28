#!/usr/bin/env python3
"""Verify or safely restore local investment source evidence.

Code version: v0.2.0
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import re
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.infrastructure.storage import (  # noqa: E402
    INVESTMENT_STORE_PATH,
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES,
    investment_evidence_dir_for,
    load_investment_store_payload,
    materialize_investment_source_artifacts,
    verify_persisted_investment_source_artifacts,
)


SCRIPT_VERSION = "0.2.0"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _required_missing_artifacts(
    payload: dict[str, Any],
    store_path: Path,
) -> dict[str, int]:
    raw_artifacts = payload.get("source_artifacts")
    if raw_artifacts is None:
        return {}
    if not isinstance(raw_artifacts, list):
        raise RuntimeError("Investment source evidence manifest list is malformed.")

    evidence_dir = investment_evidence_dir_for(store_path)
    missing: dict[str, int] = {}
    for artifact in raw_artifacts:
        if not isinstance(artifact, dict):
            raise RuntimeError("Investment source evidence manifest is malformed.")
        sha256 = str(artifact.get("sha256") or "").strip().lower()
        raw_byte_count = artifact.get("byte_count")
        if (
            not re.fullmatch(r"[0-9a-f]{64}", sha256)
            or isinstance(raw_byte_count, bool)
            or not str(raw_byte_count or "").strip().isdigit()
        ):
            raise RuntimeError("Investment source evidence manifest is incomplete.")
        byte_count = int(str(raw_byte_count).strip())
        target = evidence_dir / f"{sha256}.bin"
        if not target.is_file():
            missing[sha256] = byte_count
    return missing


def _find_exact_source_bytes(
    source_dir: Path,
    required: dict[str, int],
) -> dict[str, bytes]:
    if source_dir.is_symlink() or not source_dir.is_dir():
        raise RuntimeError(f"Recovery source is not a readable directory: {source_dir}")

    matched: dict[str, bytes] = {}
    for candidate in source_dir.rglob("*"):
        if len(matched) == len(required):
            break
        if candidate.is_symlink() or not candidate.is_file():
            continue
        candidate_size = candidate.stat().st_size
        if candidate_size > MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES:
            continue
        possible_hashes = {
            sha256
            for sha256, expected_size in required.items()
            if expected_size == candidate_size and sha256 not in matched
        }
        if not possible_hashes:
            continue
        candidate_sha256 = _sha256_file(candidate)
        if candidate_sha256 in possible_hashes:
            matched[candidate_sha256] = candidate.read_bytes()
    return matched


def restore_missing_investment_evidence(
    store_path: Path,
    source_dir: Path,
) -> int:
    """Restore only missing artifacts whose exact bytes match the ledger manifest."""
    payload = load_investment_store_payload(store_path)
    missing = _required_missing_artifacts(payload, store_path)
    if not missing:
        return 0

    matched = _find_exact_source_bytes(source_dir, missing)
    unmatched = sorted(set(missing) - set(matched))
    if unmatched:
        raise RuntimeError(
            "Recovery source does not contain exact bytes for missing SHA-256 artifact(s): "
            + ", ".join(unmatched)
        )

    recovery_payload = deepcopy(payload)
    raw_artifacts = recovery_payload.get("source_artifacts")
    if not isinstance(raw_artifacts, list):
        raise RuntimeError("Investment source evidence manifest list is malformed.")
    for artifact in raw_artifacts:
        if not isinstance(artifact, dict):
            raise RuntimeError("Investment source evidence manifest is malformed.")
        sha256 = str(artifact.get("sha256") or "").strip().lower()
        source_bytes = matched.get(sha256)
        if source_bytes is None:
            continue
        artifact["content_encoding"] = "base64"
        artifact["content_base64"] = base64.b64encode(source_bytes).decode("ascii")

    materialize_investment_source_artifacts(recovery_payload, store_path)
    return len(matched)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify immutable investment source evidence for one local investment ledger."
        )
    )
    parser.add_argument(
        "--store",
        default=str(INVESTMENT_STORE_PATH),
        help="Investment ledger path; defaults to the configured investment.parquet.",
    )
    parser.add_argument(
        "--restore-from",
        type=Path,
        help=(
            "Directory containing copied evidence files or original broker exports. "
            "Only exact SHA-256 and byte-count matches are restored."
        ),
    )
    args = parser.parse_args()
    store_path = Path(args.store).expanduser()
    evidence_dir = investment_evidence_dir_for(store_path)

    try:
        restored_count = 0
        if args.restore_from is not None:
            restored_count = restore_missing_investment_evidence(
                store_path,
                args.restore_from.expanduser(),
            )
        verified_count = verify_persisted_investment_source_artifacts(store_path)
    except RuntimeError as exc:
        print(f"Investment evidence verification failed: {exc}", file=sys.stderr)
        print(f"Ledger path: {store_path}", file=sys.stderr)
        print(f"Evidence directory: {evidence_dir}", file=sys.stderr)
        print(
            "Recovery: copy the matching evidence directory or original broker exports "
            "from the device that created this ledger, then rerun with --restore-from. "
            "Do not normalize line endings or use Git as the transfer mechanism.",
            file=sys.stderr,
        )
        return 2

    if args.restore_from is not None:
        print(f"Investment evidence restored: {restored_count} missing artifact(s).")
    print(
        f"Investment evidence verified: {verified_count} artifact(s) for {store_path} "
        f"(evidence directory: {evidence_dir})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
