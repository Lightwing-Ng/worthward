#!/usr/bin/env python3
"""Verify and explicitly migrate every local structured runtime store to SQLite.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import perf_counter
from uuid import uuid4

import pandas as pd
import pyarrow.parquet as pq

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.file_lock import local_file_lock  # noqa: E402
from app.core import object_sqlite  # noqa: E402
from app.infrastructure import frame_sqlite  # noqa: E402


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _size(path: Path) -> dict:
    stat = path.stat()
    blocks = getattr(stat, "st_blocks", None)
    return {"bytes": stat.st_size, "allocated_bytes": blocks * 512 if blocks is not None else None}


def _signature(path: Path) -> tuple:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ino, _sha(path)


def _lock_paths(source: Path, target: Path) -> list[Path]:
    paths = [target.with_name(target.name + ".lock"), source.with_name(source.name + ".lock")]
    # Settings historically uses settings.lock rather than settings.json.lock.
    if source.name == "settings.json":
        paths.append(source.with_suffix(".lock"))
    if source.name == "credit_cards.json":
        paths.extend([
            source.with_name(f".{source.name}.lock"),
            target.with_name(f".{target.name}.lock"),
        ])
    return list(dict.fromkeys(paths))


def discover(market: Path, settings: Path, compute: Path | None) -> list[tuple[Path, Path, str]]:
    entries = []
    for root in (market, settings):
        if not root.is_dir():
            continue
        for source in sorted(root.rglob("*.parquet")):
            if source.is_symlink() or any(part in {"archives", "rollback"} for part in source.relative_to(root).parts):
                continue
            # This ledger already uses its independently verified, versioned SQLite schema.
            if source == settings / "investment.parquet":
                continue
            entries.append((source, source.with_suffix(".sqlite3"), "frame"))
    for root in (settings, compute):
        if root is None or not root.is_dir():
            continue
        for source in sorted(root.rglob("*")):
            if not source.is_file() or source.is_symlink() or source.suffix not in {".json", ".jsonl"}:
                continue
            relative = source.relative_to(root)
            if any(part in {"archives", "rollback"} for part in relative.parts):
                continue
            entries.append((source, source.with_suffix(".sqlite3"), "events" if source.suffix == ".jsonl" else "object"))
    targets = [str(target.resolve()) for _, target, _ in entries]
    if len(targets) != len(set(targets)):
        raise ValueError("Two legacy inputs would map to the same SQLite target; preserve both and resolve explicitly.")
    return entries


def _source_value(source: Path, kind: str):
    if kind == "frame":
        return pq.read_table(source)
    if kind == "events":
        with source.open(encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]
    return json.loads(source.read_text(encoding="utf-8"))


def _write(path: Path, value, kind: str) -> None:
    if kind == "frame":
        frame_sqlite.write_table(path, value)
    elif kind == "events":
        object_sqlite.append_jsonl(path, value)
    else:
        object_sqlite.write_object(path, value)


def _verify(path: Path, value, kind: str) -> dict:
    if kind == "frame":
        receipt = frame_sqlite.verify_database(path)
        actual = frame_sqlite.read_table(path)
        if not value.schema.equals(actual.schema, check_metadata=True):
            raise RuntimeError("The migrated Arrow schema or metadata differs from its source.")
        if receipt["table_sha256"] != frame_sqlite.table_digest(value):
            raise RuntimeError("The migrated ordered column values differ from their source.")
        pd.testing.assert_frame_equal(
            value.to_pandas(), actual.to_pandas(), check_exact=True, check_dtype=True,
            check_index_type=True, check_column_type=True, check_categorical=True,
        )
        return receipt
    receipt = object_sqlite.verify_database(path)
    actual = object_sqlite.read_jsonl(path) if kind == "events" else object_sqlite.read_object(path)
    if object_sqlite.payload_sha256(value) != object_sqlite.payload_sha256(actual):
        raise RuntimeError("The migrated JSON values, types, or event order differ from their source.")
    return receipt


def migrate_one(source: Path, target: Path, kind: str, *, apply: bool, scratch: Path) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    with ExitStack() as locks:
        for lock_path in _lock_paths(source, target):
            locks.enter_context(local_file_lock(lock_path))
        signature = _signature(source)
        value = _source_value(source, kind)
        candidate = scratch / f"{uuid4().hex}.sqlite3"
        started = perf_counter()
        existed = target.exists()
        if existed:
            receipt = _verify(target, value, kind)
        else:
            _write(candidate, value, kind)
            receipt = _verify(candidate, value, kind)
        if _signature(source) != signature:
            raise RuntimeError("A legacy source changed during migration; publication was refused.")
        candidate_size = _size(target if existed else candidate)
        if apply and not existed:
            # Publish a same-volume candidate so hard linking never crosses filesystems.
            publish = target.with_name(f".{target.name}.{uuid4().hex}.migration")
            try:
                with candidate.open("rb") as incoming:
                    descriptor = os.open(publish, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    with os.fdopen(descriptor, "wb") as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
                        outgoing.flush()
                        os.fsync(outgoing.fileno())
                _verify(publish, value, kind)
                if _signature(source) != signature:
                    raise RuntimeError("A legacy source changed before SQLite publication.")
                # Cache freshness belongs to the source data, not conversion time.
                os.utime(publish, ns=(source.stat().st_atime_ns, signature[1]))
                os.link(publish, target)
                object_sqlite._fsync_directory(target.parent)
            finally:
                publish.unlink(missing_ok=True)
        if _signature(source) != signature:
            raise RuntimeError("A legacy source changed before migration completion.")
        candidate.unlink(missing_ok=True)
        return {
            "source": str(source), "target": str(target), "kind": kind,
            "source_sha256": signature[3], "source_mtime_ns": signature[1],
            "source_size": _size(source), "sqlite_size": candidate_size,
            "validation": receipt, "elapsed_ms": (perf_counter() - started) * 1000,
            "source_unchanged": True, "published": apply, "already_exists": existed,
        }


def benchmark(entries: list[dict], root: Path, runs: int) -> list[dict]:
    frames = sorted((entry for entry in entries if entry["kind"] == "frame"), key=lambda entry: entry["source_size"]["bytes"], reverse=True)
    selected = frames[:2]
    daily = next((entry for entry in frames if "_1m" not in Path(entry["source"]).stem and "/historical/" in entry["source"]), None)
    if daily is not None and daily not in selected:
        selected.append(daily)
    results = []
    for entry in selected:
        source = Path(entry["source"])
        path = root / f"benchmark-{uuid4().hex}.sqlite3"
        original = pq.read_table(source)
        frame_sqlite.write_table(path, original)
        timings = {}
        workloads = {"full_read": None, "date_column": ["Date"] if "Date" in original.column_names else original.column_names[:1]}
        for name, columns in workloads.items():
            for backend in ("parquet", "sqlite"):
                read = (lambda: pd.read_parquet(source, columns=columns)) if backend == "parquet" else (lambda: frame_sqlite.read_frame(path, columns=columns))
                read()
                samples = []
                for _ in range(runs):
                    started = perf_counter()
                    read()
                    samples.append((perf_counter() - started) * 1000)
                timings[f"{backend}_{name}"] = {"median_ms": statistics.median(samples), "samples_ms": samples}
        results.append({"source": str(source), "rows": original.num_rows, "columns": original.num_columns, "runs": runs, "cache": "warm filesystem cache; one untimed warmup", "timings": timings})
        path.unlink()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market-root", type=Path, default=PROJECT_ROOT / "market_store")
    parser.add_argument("--settings-root", type=Path, default=PROJECT_ROOT / "settings_store")
    parser.add_argument("--compute-root", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--benchmark-runs", type=int, default=7)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    market, settings = args.market_root.expanduser().resolve(), args.settings_root.expanduser().resolve()
    compute = args.compute_root.expanduser().resolve() if args.compute_root else None
    report_path = args.report.expanduser().resolve()
    if not 1 <= args.benchmark_runs <= 100:
        parser.error("Use between 1 and 100 benchmark runs.")
    for protected in (market, settings, compute):
        if protected is not None and (str(report_path).casefold() == str(protected).casefold() or str(report_path).casefold().startswith(str(protected).casefold() + os.sep)):
            parser.error("Reports must be outside the protected source stores.")
    if report_path.exists():
        parser.error("The report already exists; choose a new evidence filename.")
    entries = discover(market, settings, compute)
    source_bytes = sum(source.stat().st_size for source, _, _ in entries)
    peak = source_bytes * 3 + 64 * 1024 * 1024
    if shutil.disk_usage(PROJECT_ROOT).free < peak:
        raise RuntimeError("Insufficient free disk space for bounded SQLite candidates and retained originals.")
    if compute is not None:
        processes = subprocess.run(["ps", "-axo", "pid,args"], text=True, capture_output=True, check=True).stdout
        for line in processes.splitlines():
            if str(compute) in line and ("lstm_ga_tune.py" in line or "price_field_train.py" in line):
                raise RuntimeError("An active compute worker still owns a legacy source. Preserve the worker and migrate after it finishes.")
    report = {"report_version": "1.0.0", "created_at_utc": datetime.now(timezone.utc).isoformat(), "applied": args.apply, "estimated_peak_additional_bytes": peak, "files": []}
    with TemporaryDirectory(prefix="worthward-local-sqlite-") as temporary:
        scratch = Path(temporary)
        for source, target, kind in entries:
            report["files"].append(migrate_one(source, target, kind, apply=args.apply, scratch=scratch))
        report["benchmarks"] = benchmark(report["files"], scratch, args.benchmark_runs)
        for entry in report["files"]:
            if _sha(Path(entry["source"])) != entry["source_sha256"]:
                raise RuntimeError("A migrated source changed before final acceptance; do not activate yet.")
    report["summary"] = {
        "files": len(report["files"]),
        "source_bytes": sum(entry["source_size"]["bytes"] for entry in report["files"]),
        "sqlite_bytes": sum(entry["sqlite_size"]["bytes"] for entry in report["files"]),
        "all_sources_unchanged": True,
        "frame_rows": sum(entry["validation"]["rows"] for entry in report["files"] if entry["kind"] == "frame"),
        "event_records": sum(entry["validation"]["records"] for entry in report["files"] if entry["kind"] == "events"),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(report_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(report["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
