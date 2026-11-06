#!/usr/bin/env python3
"""Preview, benchmark, and explicitly publish a lossless SQLite investment ledger.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import statistics
import sys
from tempfile import TemporaryDirectory
from time import perf_counter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _size(path: Path) -> dict[str, int | None]:
    stat = path.stat()
    blocks = getattr(stat, "st_blocks", None)
    return {"bytes": stat.st_size, "allocated_bytes": blocks * 512 if blocks is not None else None}


def _summarize(samples: list[float]) -> dict[str, object]:
    return {
        "median_ms": statistics.median(samples),
        "min_ms": min(samples),
        "max_ms": max(samples),
        "samples_ms": samples,
    }


def _benchmark(storage, sqlite_store, root: Path, parquet: Path, sqlite: Path, runs: int):
    payload = storage.load_investment_store_payload(parquet)
    expected = sqlite_store.payload_sha256(payload)
    result = {}
    for backend, original in (("parquet", parquet), ("sqlite", sqlite)):
        samples = []
        storage.load_investment_store_payload(original)
        for _ in range(runs):
            start = perf_counter()
            readback = storage.load_investment_store_payload(original)
            samples.append((perf_counter() - start) * 1000)
            if sqlite_store.payload_sha256(readback) != expected:
                raise RuntimeError("Benchmark readback differs from the source ledger.")
        result[backend] = {"full_read": _summarize(samples)}

        for workload in ("snapshot_metadata", "snapshot_one_transaction", "atomic_metadata", "atomic_one_transaction"):
            work = root / workload / backend / original.name
            work.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, work)
            current = deepcopy(payload)
            samples = []
            for revision in range(runs + 1):
                def change(previous):
                    updated = dict(previous)
                    if "one_transaction" in workload and previous.get("transactions"):
                        rows = list(previous["transactions"])
                        rows[0] = {**rows[0], "_isolated_sqlite_benchmark_revision": revision}
                        updated["transactions"] = rows
                    else:
                        updated["_isolated_sqlite_benchmark_revision"] = revision
                    return updated, None

                if workload.startswith("snapshot"):
                    current, _ = change(current)
                    start = perf_counter()
                    storage.save_investment_store_payload(current, work)
                else:
                    start = perf_counter()
                    storage.update_investment_store_payload(change, work)
                elapsed = (perf_counter() - start) * 1000
                if revision:
                    samples.append(elapsed)
            result[backend][workload] = _summarize(samples)
            readback = storage.load_investment_store_payload(work)
            expected_final, _ = change(payload)
            if sqlite_store.payload_sha256(readback) != sqlite_store.payload_sha256(expected_final):
                raise RuntimeError("Benchmark write readback differs from its requested snapshot.")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=PROJECT_ROOT / "settings_store/investment.parquet")
    parser.add_argument("--target", type=Path, default=PROJECT_ROOT / "settings_store/investment.sqlite3")
    parser.add_argument("--apply", action="store_true", help="Publish only after full validation; retain the source.")
    parser.add_argument("--benchmark-runs", type=int, default=7)
    parser.add_argument("--report", type=Path, help="Write local JSON evidence outside protected stores.")
    args = parser.parse_args()
    source, target = args.source.expanduser().resolve(), args.target.expanduser().resolve()
    if source.suffix.lower() != ".parquet" or target.suffix.lower() != ".sqlite3":
        parser.error("Use a Parquet source and a separate .sqlite3 target.")
    if not 1 <= args.benchmark_runs <= 100:
        parser.error("--benchmark-runs must be between 1 and 100.")
    report_path = args.report.expanduser().resolve() if args.report else None
    if report_path:
        protected = [source.parent, target.parent, PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store"]
        report_key = str(report_path).casefold()
        if any(
            report_key == str(path.resolve()).casefold()
            or report_key.startswith(str(path.resolve()).casefold() + os.sep)
            for path in protected
        ):
            parser.error("The report must be outside source, target, settings, and market stores.")
        if report_path.exists():
            parser.error("The report already exists; choose a new evidence path.")
    peak_estimate = source.stat().st_size * 16 + 64 * 1024 * 1024
    if shutil.disk_usage(target.parent if target.parent.exists() else source.parent).free < peak_estimate:
        raise RuntimeError("Insufficient disk space for the bounded migration and benchmark copies.")
    target.parent.mkdir(parents=True, exist_ok=True)

    with TemporaryDirectory(prefix="worthward-ledger-migration-") as temporary:
        root = Path(temporary)
        # Keep general storage initialization and every benchmark outside live stores.
        os.environ["WORTHWARD_SETTINGS_STORE_DIR"] = str(root / "settings")
        os.environ["WORTHWARD_MARKET_STORE_DIR"] = str(root / "market")
        from app.infrastructure import investment_sqlite, storage

        snapshot = root / "investment.parquet"
        with storage.market_store_file_lock(target), storage.market_store_file_lock(source):
            source_digest = _hash_file(source)
            shutil.copy2(source, snapshot)
            if _hash_file(source) != source_digest or _hash_file(snapshot) != source_digest:
                raise RuntimeError("The source changed while taking the immutable benchmark snapshot.")
        candidate = root / "investment.sqlite3"
        start = perf_counter()
        receipt = storage.migrate_investment_store_to_sqlite(candidate, source=snapshot)
        conversion_ms = (perf_counter() - start) * 1000
        original_payload = storage.load_investment_store_payload(snapshot)
        candidate_payload = investment_sqlite.load_payload(candidate)
        if investment_sqlite.payload_sha256(original_payload) != investment_sqlite.payload_sha256(candidate_payload):
            raise RuntimeError("The complete candidate payload does not match the source.")
        report = {
            "report_version": "1.0.0",
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "environment": {"python": platform.python_version(), "sqlite": sqlite3.sqlite_version, "platform": platform.platform()},
            "source": str(source), "target": str(target),
            "source_sha256": source_digest,
            "validation": receipt,
            "conversion_ms": conversion_ms,
            "storage": {"parquet": _size(source), "sqlite": _size(candidate), "estimated_peak_additional_bytes": peak_estimate},
            "benchmark": {
                "cache": "warm filesystem cache; one untimed warmup per workload",
                "runs": args.benchmark_runs,
                "timings": _benchmark(storage, investment_sqlite, root, snapshot, candidate, args.benchmark_runs),
            },
            "limitations": [
                "No cold-cache, browser-rendering, remote-filesystem, or large-scale extrapolation.",
                "Snapshot saves exclude a preceding read; atomic updates include read, mutation, and commit.",
                "All timed writes change isolated metadata or one isolated transaction; production evidence is never rewritten.",
                "The original Parquet is retained; smaller active-store bytes do not mean total disk space was reclaimed.",
            ],
            "applied": False,
        }
        with storage.market_store_file_lock(target), storage.market_store_file_lock(source):
            if _hash_file(source) != source_digest:
                raise RuntimeError("The source changed during benchmarking; rerun before publication.")
            if args.apply:
                applied = storage.migrate_investment_store_to_sqlite(target, source=source)
                if applied["payload_sha256"] != receipt["payload_sha256"]:
                    raise RuntimeError("The published SQLite ledger differs from the preview.")
                report["applied"] = True
                report["publication"] = applied
                report["storage"]["published_sqlite"] = _size(target)
            report["source_unchanged"] = _hash_file(source) == source_digest
        if report_path:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(report_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
