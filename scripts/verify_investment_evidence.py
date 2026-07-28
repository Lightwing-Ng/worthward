#!/usr/bin/env python3
"""Verify local investment source evidence without repairing or replacing it.

Code version: v0.1.0
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.infrastructure.storage import (  # noqa: E402
    INVESTMENT_STORE_PATH,
    investment_evidence_dir_for,
    verify_persisted_investment_source_artifacts,
)


SCRIPT_VERSION = "0.1.0"


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
    args = parser.parse_args()
    store_path = Path(args.store).expanduser()
    evidence_dir = investment_evidence_dir_for(store_path)

    try:
        verified_count = verify_persisted_investment_source_artifacts(store_path)
    except RuntimeError as exc:
        print(f"Investment evidence verification failed: {exc}", file=sys.stderr)
        print(f"Ledger path: {store_path}", file=sys.stderr)
        print(f"Evidence directory: {evidence_dir}", file=sys.stderr)
        print(
            "Recovery: copy the exact matching evidence directory from the device that "
            "created this ledger. Do not regenerate files, normalize line endings, or use "
            "Git as the transfer mechanism.",
            file=sys.stderr,
        )
        return 2

    print(
        f"Investment evidence verified: {verified_count} artifact(s) for {store_path} "
        f"(evidence directory: {evidence_dir})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
