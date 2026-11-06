#!/usr/bin/env python3
"""Archive verified legacy sources after runtime SQLite activation.

Code version: v1.0.1
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.file_lock import local_file_lock  # noqa: E402
from app.core import object_sqlite  # noqa: E402
from app.infrastructure import frame_sqlite, investment_sqlite  # noqa: E402
from scripts.migrate_local_sqlite import _lock_paths, _sha  # noqa: E402


def archive_sources(entries: list[dict], roots: list[Path], receipt_path: Path, *, apply: bool) -> dict:
    """Move only unchanged, verified originals; retain a complete recovery plan first."""
    roots = [root.resolve() for root in roots]
    receipt_path = receipt_path.resolve()
    if receipt_path.exists():
        raise FileExistsError("Choose a new archive receipt; previous evidence is immutable.")
    archive_name = "sqlite-migration-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8]
    plan = []
    for entry in entries:
        if Path(entry["source"]).is_symlink() or Path(entry["target"]).is_symlink():
            raise ValueError("Archive inputs must be ordinary local files.")
        source, target = Path(entry["source"]).resolve(), Path(entry["target"]).resolve()
        root = next((root for root in roots if source.is_relative_to(root)), None)
        if root is None or target != source.with_suffix(".sqlite3"):
            raise ValueError("An archive source is outside the selected runtime roots.")
        destination = root / "archives" / archive_name / source.relative_to(root)
        if destination.exists():
            raise FileExistsError("An archive destination already exists; never overwrite originals.")
        plan.append({**entry, "archive": str(destination), "archive_root": str(root / "archives" / archive_name)})

    all_paths = [str(Path(entry[key])) for entry in plan for key in ("source", "target")]
    if all_paths:
        owners = subprocess.run(["lsof", "-t", *all_paths], capture_output=True, text=True, check=False)
        if owners.returncode not in (0, 1) or owners.stdout.strip():
            raise RuntimeError("An active process still owns a migration source or target; preserve it and retry later.")

    with ExitStack() as locks:
        # Acquire the complete lock set before validation so no admitted writer can
        # invalidate a later source between verification and its recoverable move.
        acquired = set()
        for entry in sorted(plan, key=lambda item: item["target"]):
            for path in _lock_paths(Path(entry["source"]), Path(entry["target"])):
                if path not in acquired:
                    acquired.add(path)
                    locks.enter_context(local_file_lock(path))
        for entry in plan:
            source, target = Path(entry["source"]), Path(entry["target"])
            if _sha(source) != entry["source_sha256"]:
                raise RuntimeError("A source changed after migration; keep both files and reconcile before archiving.")
            if entry["kind"] == "frame":
                verified = frame_sqlite.verify_database(target)
                key = "table_sha256"
            elif entry["kind"] == "investment":
                verified = investment_sqlite.verify_database(target)
                key = "payload_sha256"
            else:
                verified = object_sqlite.verify_database(target)
                key = "payload_sha256"
            if verified[key] != entry["validation"][key]:
                raise RuntimeError("The active SQLite store changed after migration; preserve its legacy source for review.")

        receipt = {
            "receipt_version": "1.0.0", "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "applied": apply, "complete": False, "files": plan,
        }
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(receipt_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(receipt, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        object_sqlite._fsync_directory(receipt_path.parent)
        if apply:
            for entry in plan:
                source, destination = Path(entry["source"]), Path(entry["archive"])
                Path(entry["archive_root"]).mkdir(mode=0o700, parents=True, exist_ok=True)
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                # A no-overwrite link retains exact bytes even if execution stops
                # between the recoverable publication and removal of the old name.
                os.link(source, destination)
                object_sqlite._fsync_directory(destination.parent)
                if _sha(destination) != entry["source_sha256"]:
                    raise RuntimeError("An archived source failed its original SHA-256 verification.")
                source.unlink()
                object_sqlite._fsync_directory(source.parent)
            for entry in plan:
                if Path(entry["source"]).exists() or _sha(Path(entry["archive"])) != entry["source_sha256"]:
                    raise RuntimeError("A legacy archive did not read back as planned.")
        receipt["complete"] = True
        temporary = receipt_path.with_name(receipt_path.name + ".tmp")
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(receipt, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, receipt_path)
        object_sqlite._fsync_directory(receipt_path.parent)
        return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration_report", type=Path)
    parser.add_argument("--root", type=Path, action="append", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    migration = json.loads(args.migration_report.read_text(encoding="utf-8"))
    if migration.get("applied") is not True or not migration.get("summary", {}).get("all_sources_unchanged"):
        parser.error("Use the verified report of an explicitly applied migration.")
    receipt = archive_sources(migration["files"], args.root, args.receipt, apply=args.apply)
    print(json.dumps({"files": len(receipt["files"]), "applied": receipt["applied"], "complete": receipt["complete"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
