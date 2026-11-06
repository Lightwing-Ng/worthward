#!/usr/bin/env python3
"""Measure ledger input dependence in cold, source-preserving isolated copies.

Code version: v1.2.0
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
from time import perf_counter, sleep
from urllib.parse import unquote, urlparse
from uuid import uuid4
import zlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

VOLATILE_TOP_LEVEL = {"investment_cache", "investment_store_version", "realtime_quotes"}
ECONOMIC_FIELDS = (
    "id", "broker", "account", "account_id", "date", "datetime", "type", "ticker", "currency",
    "quantity", "quantity_raw", "price", "price_raw", "commission", "commission_raw", "fees_raw",
    "gross_amount_raw", "net_amount_raw", "amount", "amount_raw", "settlement_adjustment_raw",
)
MIB = 1024 * 1024
PAYLOAD_APPLICATION_ID = 0x57574154
PAYLOAD_SCHEMA_VERSION = 1
FORCE_RENDER_SCENARIOS = ["full_cold", "sqlite_without_cache", "conflicting_legacy_files"]


def require_free_space(path: Path, additional_bytes: int) -> None:
    existing = path.resolve()
    while not existing.exists():
        existing = existing.parent
    if shutil.disk_usage(existing).free < additional_bytes:
        raise RuntimeError("Insufficient free space; durable audit inputs were retained for review or retry.")


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json_checkpoint(path: Path, payload: dict, *, expected_sha256: str | None = None) -> str:
    """Publish complete private evidence atomically and verify its saved bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        if digest(json.loads(temporary.read_text(encoding="utf-8"))) != digest(payload):
            raise RuntimeError("The audit report failed its complete readback verification.")
        written_sha = file_sha(temporary)
        if expected_sha256 is None:
            os.link(temporary, path)
        else:
            if path.is_symlink() or path.stat().st_nlink != 1 or file_sha(path) != expected_sha256:
                raise RuntimeError("An audit report changed outside this run; preserve it instead of overwriting it.")
            os.replace(temporary, path)
        _fsync_directory(path.parent)
        if file_sha(path) != written_sha:
            raise RuntimeError("The published audit report does not match its verified checkpoint.")
        return written_sha
    finally:
        temporary.unlink(missing_ok=True)


def _has_extended_attributes(source: Path) -> bool:
    if hasattr(os, "listxattr"):
        try:
            return bool(os.listxattr(source))
        except OSError:
            return True
    # macOS CPython does not always expose os.listxattr. Query only the native
    # attribute-name byte count; no attribute values are read or copied.
    library = ctypes.CDLL(None, use_errno=True)
    query = getattr(library, "listxattr", None)
    if query is None:
        return True
    query.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    query.restype = ctypes.c_ssize_t
    return query(os.fsencode(source), None, 0, 0) != 0


def _clone_file(source: Path, target: Path) -> bool:
    """Use an APFS copy-on-write clone, never a hard link to a source inode."""
    if sys.platform != "darwin":
        return False
    info = source.stat()
    if getattr(info, "st_flags", 0) or _has_extended_attributes(source):
        # Cloud and compressed files retain metadata needed to materialize bytes.
        # Their isolated copy must use the verified byte-stream fallback instead.
        return False
    library = ctypes.CDLL(None, use_errno=True)
    clone = getattr(library, "clonefile", None)
    if clone is None:
        return False
    clone.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    clone.restype = ctypes.c_int
    if clone(os.fsencode(source), os.fsencode(target), 0) == 0:
        return True
    if target.exists():
        raise OSError("A failed audit clone left a destination; preserve it for diagnosis.")
    return False


def _sanitize_copy(source: Path, target: Path) -> None:
    # A clone is admitted only for plain materialized sources. Byte-stream copies
    # create a new regular file without inheriting cloud/compression metadata.
    info = source.stat()
    target.chmod(info.st_mode & 0o777)
    os.utime(target, ns=(info.st_atime_ns, info.st_mtime_ns))


def store_browser_payload(database: Path, payload_key: str, source: Path) -> dict:
    """Commit lossless compressed transport before removing a transient JSON file."""
    before = source.stat()
    checksum = hashlib.sha256()
    compressor = zlib.compressobj(level=6)
    encoded = bytearray()
    count = 0
    with source.open("rb") as handle:
        for block in iter(lambda: handle.read(64 * 1024), b""):
            checksum.update(block)
            count += len(block)
            encoded.extend(compressor.compress(block))
    encoded.extend(compressor.flush())
    after = source.stat()
    if count != before.st_size or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError("The transient browser payload changed or was incomplete; its JSON was retained.")
    require_free_space(database.parent, len(encoded) * 3 + 8 * MIB)
    database.parent.mkdir(parents=True, exist_ok=True)
    created = not database.exists()
    if database.is_symlink() or (not created and database.stat().st_nlink != 1):
        raise ValueError("Browser payload transport must be an isolated regular SQLite file.")
    if created:
        descriptor = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
    connection = sqlite3.connect(database)
    try:
        if connection.execute("PRAGMA journal_mode").fetchone()[0] != "delete":
            raise ValueError("Browser payload transport requires rollback-journal mode.")
        connection.execute("PRAGMA synchronous=FULL")
        with connection:
            if created:
                connection.execute(f"PRAGMA application_id={PAYLOAD_APPLICATION_ID}")
                connection.execute(f"PRAGMA user_version={PAYLOAD_SCHEMA_VERSION}")
                connection.execute(
                    "CREATE TABLE payloads (payload_key TEXT PRIMARY KEY, raw_sha256 TEXT NOT NULL, "
                    "raw_bytes INTEGER NOT NULL, codec TEXT NOT NULL CHECK(codec='zlib'), "
                    "payload BLOB NOT NULL) WITHOUT ROWID"
                )
            elif (
                connection.execute("PRAGMA application_id").fetchone()[0] != PAYLOAD_APPLICATION_ID
                or connection.execute("PRAGMA user_version").fetchone()[0] != PAYLOAD_SCHEMA_VERSION
            ):
                raise ValueError("The browser payload transport has an incompatible schema.")
            existing = connection.execute(
                "SELECT raw_sha256,raw_bytes,codec,payload FROM payloads WHERE payload_key=?", (payload_key,),
            ).fetchone()
            if existing is None:
                connection.execute("INSERT INTO payloads VALUES (?,?,?,?,?)", (payload_key, checksum.hexdigest(), count, "zlib", bytes(encoded)))
            elif existing[:3] != (checksum.hexdigest(), count, "zlib"):
                raise ValueError("A browser scenario already owns different input bytes; neither input was overwritten.")
    finally:
        connection.close()
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as saved:
        record = saved.execute(
            "SELECT raw_sha256,raw_bytes,codec,payload FROM payloads WHERE payload_key=?", (payload_key,),
        ).fetchone()
        restored = zlib.decompress(record[3])
        if len(restored) != count or hashlib.sha256(restored).hexdigest() != checksum.hexdigest() or record[:3] != (checksum.hexdigest(), count, "zlib"):
            raise RuntimeError("Browser payload SQLite roundtrip failed; the original transient JSON was retained.")
    with database.open("rb") as handle:
        os.fsync(handle.fileno())
    _fsync_directory(database.parent)
    source.unlink()
    return {"payload_database": str(database), "payload_key": payload_key, "input_sha256": checksum.hexdigest(), "input_bytes": count, "compressed_bytes": len(encoded)}


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def leaf_fingerprints(value, path: tuple = ()) -> dict:
    """Compare summary values without recording account identities or amounts."""
    if isinstance(value, dict) and value:
        return {
            key: item
            for field, child in value.items()
            for key, item in leaf_fingerprints(child, (*path, field)).items()
        }
    if isinstance(value, list) and value:
        return {
            key: item
            for index, child in enumerate(value)
            for key, item in leaf_fingerprints(child, (*path, index)).items()
        }
    return {digest(path): {
        "field": str(path[-1]) if path else "root",
        "value_sha256": digest(value), "value_type": type(value).__name__,
    }}


def file_sha(path: Path) -> str:
    for attempt in range(20):
        checksum = hashlib.sha256()
        remaining = path.stat().st_size
        with path.open("rb") as handle:
            while remaining:
                chunk = handle.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                checksum.update(chunk)
                remaining -= len(chunk)
        if not remaining:
            return checksum.hexdigest()
        if attempt < 19:
            sleep(0.5)
    raise OSError(f"A source was not fully materialized: {path}. No corruption conclusion was made.")


def stable_payload(payload: dict, isolated_root: Path) -> dict:
    """Exclude transport volatility without dropping financial dates or amounts."""
    def normalize(value):
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, str):
            return value.replace(str(isolated_root), "<isolated-runtime>")
        return value

    result = normalize({key: value for key, value in payload.items() if key not in VOLATILE_TOP_LEVEL})
    freshness = result.get("section_freshness")
    if isinstance(freshness, dict):
        freshness.pop("target_trading_day", None)
    return result


def snapshot_files(root: Path) -> dict:
    selected = []
    for path in sorted(root.rglob("*")):
        if (
            not path.is_file() or path.is_symlink() or path.name == ".DS_Store"
            or path.suffix in {".lock", ".png", ".svg", ".jpg", ".jpeg"}
        ):
            continue
        relative = path.relative_to(root)
        if root.name == "market_store" and "archives" in relative.parts:
            continue
        selected.append((path, relative))

    def inspect(item):
        path, relative = item
        record = {"bytes": path.stat().st_size}
        if path.suffix == ".bin" and "investment_evidence" in relative.parts:
            record["content_verification"] = "not read; immutable broker artifacts outside ordinary-GET scope"
        else:
            record["sha256"] = file_sha(path)
        return str(relative), record

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(inspect, selected))


def copy_audit_source(source: Path, target: Path, inventory: dict) -> None:
    """Copy structured inputs; opaque broker bytes use explicit isolated placeholders."""
    for relative, record in inventory.items():
        incoming, outgoing = source / relative, target / relative
        outgoing.parent.mkdir(parents=True, exist_ok=True)
        if "sha256" in record:
            if not _clone_file(incoming, outgoing):
                require_free_space(outgoing.parent, record["bytes"] + 64 * MIB)
                remaining = record["bytes"]
                with incoming.open("rb") as source_handle, outgoing.open("xb") as target_handle:
                    while remaining:
                        chunk = source_handle.read(min(64 * 1024, remaining))
                        if not chunk:
                            raise OSError("A source copy was incomplete; no scenario was run.")
                        target_handle.write(chunk)
                        remaining -= len(chunk)
            _sanitize_copy(incoming, outgoing)
            if file_sha(outgoing) != record["sha256"]:
                raise OSError("The isolated source copy failed its byte-level verification.")
        else:
            # An ordinary GET must not consume these files. Matching names and
            # sizes retain existence probes; audit hooks detect every byte read.
            with outgoing.open("xb") as handle:
                handle.truncate(record["bytes"])


def remove_legacy_copies(root: Path) -> int:
    """Ablate rollback files in a disposable scenario, never in the source tree."""
    removed = 0
    for path in sorted(root.rglob("*"), reverse=True):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if "archives" in relative.parts or path.suffix in {".bak", ".json", ".jsonl", ".parquet"}:
            path.unlink()
            removed += 1
    return removed


def _resolved_data_path(value) -> Path | None:
    if not isinstance(value, (str, bytes, os.PathLike)):
        return None
    text = os.fsdecode(value)
    if text == ":memory:":
        return None
    if text.startswith("file:"):
        text = unquote(urlparse(text).path)
    return Path(text).expanduser().resolve()


def path_is_within(path: Path, root: Path) -> bool:
    """Protect macOS aliases conservatively, including nonexistent output files."""
    child_parts = tuple(part.casefold() for part in path.resolve().parts)
    root_parts = tuple(part.casefold() for part in root.resolve().parts)
    return child_parts[:len(root_parts)] == root_parts


def run_browser_process(command: list[str], environment: dict, *, timeout: int = 1800) -> subprocess.CompletedProcess:
    """Own a dedicated process group so a timeout cannot leave a hidden server."""
    process = subprocess.Popen(
        command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()


def validate_worker_case(case: Path, protected_roots: list[Path]) -> None:
    """Reject source ancestors, descendants, and symlink escapes before any mutation."""
    case = case.resolve()
    protected = {
        root.resolve() for root in [
            *protected_roots, PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store",
        ]
    }
    for root in protected:
        if path_is_within(case, root) or path_is_within(root, case):
            raise ValueError("An ablation case must be isolated from every protected source root.")
    for name in ("settings_store", "market_store"):
        child = case / name
        if child.is_symlink() or not path_is_within(child, case):
            raise ValueError("An ablation input directory cannot escape its isolated case.")
    if any(path.is_symlink() for path in case.rglob("*")):
        raise ValueError("An ablation case cannot contain symbolic links to source data.")
    if any(path.is_file() and path.stat().st_nlink > 1 for path in case.rglob("*")):
        raise ValueError("An ablation case cannot contain hard links to other data.")


def install_native_read_tracing(
    classify, reads, attempts, *, patcher=setattr, is_recording=lambda: True,
) -> dict:
    """Guard Python-visible Arrow path entrypoints without replacing native classes.

    Counts represent observed reader calls and successful opens, not physical
    syscalls or consumed bytes. Direct native file classes, pre-opened handles,
    and arbitrary C extensions remain outside this trace's guarantees.
    """
    import pandas as pd
    import pyarrow as pa
    import pyarrow.dataset as dataset
    import pyarrow.fs as arrow_fs
    import pyarrow.parquet as parquet

    trace = {
        "instrumented_entrypoints": [],
        "attempted_entrypoint_calls": Counter(),
        "successful_entrypoint_calls": Counter(),
        "unsupported_filesystem_calls": 0,
        "remaining_blind_spots": [
            "Direct pyarrow.OSFile and filesystem-object methods are not wrapped.",
            "Pre-opened native handles or datasets may consume bytes without a new traced path call.",
            "Arbitrary C/OS file and network I/O is not covered by Python audit/open hooks.",
            "Reader-call counts are not physical-open or byte-read counts; nested wrappers may count twice.",
        ],
    }

    def paths_for(source):
        if isinstance(source, (str, bytes, os.PathLike)):
            return [source]
        if isinstance(source, (list, tuple)):
            return [path for item in source for path in paths_for(item)]
        return []

    def observe(module, attribute, source_name):
        original = getattr(module, attribute)
        name = f"{module.__name__}.{attribute}"
        trace["instrumented_entrypoints"].append(name)

        def tracked(*args, **kwargs):
            source = args[0] if args else kwargs.get(source_name)
            paths = paths_for(source)
            labels = []
            if paths and is_recording():
                trace["attempted_entrypoint_calls"][name] += 1
            filesystem = kwargs.get("filesystem")
            if paths and filesystem is not None and not isinstance(filesystem, arrow_fs.LocalFileSystem):
                if is_recording():
                    trace["unsupported_filesystem_calls"] += 1
                raise PermissionError("A native ablation reader used an untraced filesystem context.")
            for path in paths:
                raw = os.fsdecode(path)
                scheme = urlparse(raw).scheme
                if scheme and scheme != "file" and not (len(scheme) == 1 and raw[1:2] == ":"):
                    raise PermissionError("A native ablation reader attempted a nonlocal source URI.")
                label = classify(path)
                if label:
                    labels.append(label)
                    if is_recording():
                        attempts[label] += 1
            result = original(*args, **kwargs)
            if is_recording():
                for label in labels:
                    reads[label] += 1
            if paths and is_recording():
                trace["successful_entrypoint_calls"][name] += 1
            return result

        patcher(module, attribute, tracked)

    for module, attribute, source_name in (
        (pd, "read_parquet", "path"),
        (parquet, "read_table", "source"),
        (parquet, "read_pandas", "source"),
        (dataset, "dataset", "source"),
        (pa, "memory_map", "path"),
        (pa, "input_stream", "source"),
    ):
        observe(module, attribute, source_name)
    return trace


def _prepare_case(case: Path, scenario: str) -> dict:
    from app.core import object_sqlite
    from app.infrastructure import investment_sqlite

    settings = case / "settings_store"
    ledger = settings / "investment.sqlite3"
    private = settings / "private_investment_evidence.sqlite3"
    cache = settings / "investment_cache/transactions_payload.sqlite3"
    preparation = {"removed_legacy_files": 0, "cache_present_at_start": cache.exists()}
    evidence = object_sqlite.read_object(private) if private.exists() else {}
    if scenario != "full_cold":
        preparation["removed_legacy_files"] = remove_legacy_copies(case)
    if scenario not in {"full_cold", "sqlite_with_cache"}:
        cache.unlink(missing_ok=True)
    if scenario in {"without_external_evidence", "without_both_calibration_layers", "without_external_and_tagged_calibrations"}:
        private.unlink(missing_ok=True)
    if scenario in {
        "without_embedded_evidence", "without_both_calibration_layers",
        "without_tagged_calibrations", "without_external_and_tagged_calibrations",
    }:
        from scripts.investment_ablation_controls import strip_materialized_private_evidence

        payload = investment_sqlite.load_payload(ledger)
        changed, audit = strip_materialized_private_evidence(payload, evidence)
        assert payload.get("transactions") == changed.get("transactions")
        assert payload.get("source_artifacts") == changed.get("source_artifacts")
        investment_sqlite.save_payload(ledger, changed)
        preparation["materialized_controls"] = audit
        if scenario in {"without_tagged_calibrations", "without_external_and_tagged_calibrations"}:
            from scripts.investment_ablation_controls import strip_explicit_user_calibration_markers

            tagged, tagged_audit = strip_explicit_user_calibration_markers(changed)
            assert tagged.get("transactions") == payload.get("transactions")
            assert tagged.get("source_artifacts") == payload.get("source_artifacts")
            investment_sqlite.save_payload(ledger, tagged)
            preparation["exploratory_tagged_controls"] = tagged_audit
    if scenario in {"conflicting_legacy_files", "missing_canonical_with_legacy", "corrupt_canonical_with_legacy"}:
        # A real historical ledger is injected by the parent under this neutral name.
        historical = case / "historical-ledger-source"
        if historical.is_file():
            shutil.copy2(historical, settings / "investment.parquet")
        else:
            (settings / "investment.parquet").write_bytes(b"unreadable legacy shadow")
        (settings / "investment.json").write_text('{"transactions":[],"shadow_control":true}')
        (settings / "investment.parquet.before-ablation.bak").write_bytes(b"inactive rollback sentinel")
    if scenario == "missing_canonical_with_legacy":
        ledger.unlink()
    elif scenario == "corrupt_canonical_with_legacy":
        ledger.write_bytes(b"damaged canonical SQLite; legacy must not replace it")
    elif scenario in {"stale_cache", "stale_same_schema_cache"}:
        ledger_stat = ledger.stat()
        private_stat = private.stat() if private.exists() else None
        current_ledger = {
            "exists": True, "path": str(ledger), "mtime_ns": ledger_stat.st_mtime_ns,
            "size": ledger_stat.st_size,
        }
        object_sqlite.write_object(cache, {
            "schema_version": "investment-transactions-v18" if scenario == "stale_cache" else "investment-transactions-v19",
            "investment_store": current_ledger,
            "private_investment_evidence": {
                "exists": private.exists(), "path": str(private),
                "mtime_ns": private_stat.st_mtime_ns if private_stat else 0,
                "size": (private_stat.st_size if private_stat else 0) + 1,
            },
            "payload": {"transactions": [], "shadow_control": True},
        })
        preparation["cache_control"] = "old_schema" if scenario == "stale_cache" else "malformed_current_schema_and_stale_private_size"
    return preparation


def run_worker(case: Path, scenario: str, protected_roots: list[Path], *, emit_browser_payload: bool = False) -> dict:
    """Call the real GET handler while rejecting any access to production stores."""
    validate_worker_case(case, protected_roots)
    protected_roots = list({
        path.resolve() for path in [
            *protected_roots, PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store",
        ]
    })
    os.environ.update(
        WORTHWARD_SETTINGS_STORE_DIR=str(case / "settings_store"),
        WORTHWARD_MARKET_STORE_DIR=str(case / "market_store"),
        WORTHWARD_COMPUTE_ROOT=str(case / "compute"),
        WORTHWARD_REMOTE_MARKET_ACCESS="disabled",
        WORTHWARD_LONGBRIDGE_CLI_ACCESS="disabled",
    )
    reads = Counter()
    attempts = Counter()
    boundary_violations = []
    network_attempts = []
    collecting_application_reads = False

    def classify(value):
        path = _resolved_data_path(value)
        if path is None:
            return None
        for root in protected_roots:
            if path_is_within(path, root):
                boundary_violations.append(str(path))
                raise PermissionError("An ablation worker attempted to access a protected source store.")
        if path_is_within(path, case):
            return str(Path(*path.parts[len(case.parts):]))
        return None

    def audit(event, arguments):
        if event == "open" and arguments:
            path = classify(arguments[0])
            if path and collecting_application_reads:
                attempts[path] += 1
        elif event == "sqlite3.connect" and arguments:
            path = classify(arguments[0])
            if path and collecting_application_reads:
                attempts[path] += 1
        elif event == "socket.connect":
            network_attempts.append(str(arguments[1]) if len(arguments) > 1 else "unknown")
            raise PermissionError("Network connections are disabled during source ablation.")

    sys.addaudithook(audit)
    original_connect = sqlite3.connect

    def tracked_connect(database, *args, **kwargs):
        label = classify(database)
        connection = original_connect(database, *args, **kwargs)
        if label and collecting_application_reads:
            reads[label] += 1
        return connection

    sqlite3.connect = tracked_connect
    import builtins
    import io

    original_open, original_io_open = builtins.open, io.open

    def track_open(original, file, *args, **kwargs):
        label = classify(file)
        handle = original(file, *args, **kwargs)
        mode = kwargs.get("mode", args[0] if args else "r")
        if label and collecting_application_reads and (isinstance(mode, str) and ("r" in mode or "+" in mode)):
            reads[label] += 1
        return handle

    builtins.open = lambda file, *args, **kwargs: track_open(original_open, file, *args, **kwargs)
    io.open = lambda file, *args, **kwargs: track_open(original_io_open, file, *args, **kwargs)
    native_trace = install_native_read_tracing(
        classify, reads, attempts, is_recording=lambda: collecting_application_reads,
    )
    preparation = _prepare_case(case, scenario)
    from app import create_app

    core_paths = [case / "settings_store" / name for name in (
        "investment.sqlite3", "private_investment_evidence.sqlite3", "settings.sqlite3", "credit_cards.sqlite3",
    )]
    before = {path.name: file_sha(path) if path.exists() else None for path in core_paths}
    threads_before = {thread.ident for thread in threading.enumerate()}
    started = perf_counter()
    collecting_application_reads = True
    api_clock_utc = datetime.now(timezone.utc).isoformat()
    try:
        app = create_app()
        with app.test_client() as client:
            response = client.get("/api/investment/transactions")
            payload = response.get_json() or {}
    finally:
        collecting_application_reads = False
    elapsed = (perf_counter() - started) * 1000
    after = {path.name: file_sha(path) if path.exists() else None for path in core_paths}
    assert before == after, "A read-only ablation request rewrote a core input."
    stable = stable_payload(payload, case)
    transactions = stable.get("transactions", [])
    economics = [{key: row[key] for key in ECONOMIC_FIELDS if key in row} for row in transactions]
    shadow_reads = sorted(path for path in reads if (
        "archives/" in path or path.endswith((".bak", ".parquet", ".json", ".jsonl"))
        or path == "historical-ledger-source"
    ))
    attempted_shadow_opens = sorted(path for path in attempts if (
        "archives/" in path or path.endswith((".bak", ".parquet", ".json", ".jsonl"))
        or path == "historical-ledger-source"
    ))
    artifact_reads = sorted(
        path for path in reads.keys() | attempts.keys()
        if path.endswith(".bin") and "investment_evidence/" in path
    )
    if emit_browser_payload:
        # This is a private transient transport to the isolated browser harness.
        # It is never a runtime store or a candidate production ledger.
        descriptor = os.open(case / "browser-payload.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)
    return {
        "scenario": scenario, "status": response.status_code, "success": payload.get("success"),
        "transactions": len(transactions), "stable_payload_sha256": digest(stable),
        "economic_transactions_sha256": digest(economics),
        "complete_transactions_sha256": digest(transactions),
        "api_clock_utc": api_clock_utc,
        "api_target_trading_day": payload.get("section_freshness", {}).get("target_trading_day"),
        "section_sha256": {key: digest(value) for key, value in stable.items()},
        "broker_summary_leaves": leaf_fingerprints(stable.get("broker_summaries", {})),
        "cache": payload.get("investment_cache"), "preparation": preparation,
        "core_inputs_unchanged": before == after,
        "successful_data_opens": dict(sorted(reads.items())), "attempted_data_opens": dict(sorted(attempts.items())),
        "native_read_trace": native_trace,
        "trace_collection_scope": "create_app and GET only; excludes before/after core verification hashes",
        "self_verification_core_file_count": len(core_paths),
        "successful_shadow_reads": shadow_reads, "production_access_attempts": boundary_violations,
        "attempted_shadow_opens": attempted_shadow_opens,
        "immutable_artifact_reads": artifact_reads,
        "network_connection_attempts": network_attempts,
        "additional_live_threads": [thread.name for thread in threading.enumerate() if thread.ident not in threads_before],
        "elapsed_ms": elapsed,
        "cache_hit_exercised": payload.get("investment_cache", {}).get("status") == "hit",
    }


@contextmanager
def audit_workspace(selected: Path | None):
    """Retain an explicitly requested private workspace across browser failures."""
    if selected is None:
        with TemporaryDirectory(prefix="worthward-ledger-ablation-") as temporary:
            yield Path(temporary)
        return
    selected.mkdir(mode=0o700, parents=True, exist_ok=False)
    selected.chmod(0o700)
    yield selected


def finalize_api_results(result: dict, before: dict, sources: list[Path]) -> None:
    result["source_files_unchanged"] = before == {str(root): snapshot_files(root) for root in sources}
    if not result["source_files_unchanged"]:
        raise RuntimeError("Protected source files changed while the audit was running.")
    baseline_result = result["scenarios"][0]
    for scenario in result["scenarios"]:
        scenario["same_as_full_baseline"] = scenario["stable_payload_sha256"] == baseline_result["stable_payload_sha256"]
        scenario["economic_transactions_unchanged"] = scenario["economic_transactions_sha256"] == baseline_result["economic_transactions_sha256"]
        scenario["complete_transactions_unchanged"] = scenario["complete_transactions_sha256"] == baseline_result["complete_transactions_sha256"]
        scenario["changed_sections"] = sorted(
            key for key in baseline_result["section_sha256"].keys() | scenario["section_sha256"].keys()
            if baseline_result["section_sha256"].get(key) != scenario["section_sha256"].get(key)
        )
        previous = baseline_result["broker_summary_leaves"]
        current = scenario["broker_summary_leaves"]
        changed_leaves = [
            key for key in previous.keys() | current.keys()
            if previous.get(key) != current.get(key)
        ]
        scenario["changed_broker_summary_fields"] = sorted({
            (current.get(key) or previous[key])["field"] for key in changed_leaves
        })
        scenario["changed_broker_summary_leaf_count"] = len(changed_leaves)
    expected_errors = {"missing_canonical_with_legacy", "corrupt_canonical_with_legacy"}
    equivalent_controls = {
        "full_cold", "sqlite_with_cache", "sqlite_without_cache", "sqlite_without_cache_repeat",
        "conflicting_legacy_files", "stale_cache", "stale_same_schema_cache",
    }
    result["acceptance"] = {
        "baseline_success": baseline_result["status"] == 200 and baseline_result["success"] is True,
        "expected_http_statuses": all(
            scenario["status"] == (500 if scenario["scenario"] in expected_errors else 200)
            and scenario["success"] is (scenario["scenario"] not in expected_errors)
            for scenario in result["scenarios"]
        ),
        "legacy_and_stale_cache_equivalence": all(
            scenario["same_as_full_baseline"] for scenario in result["scenarios"]
            if scenario["scenario"] in equivalent_controls
        ),
        "successful_transaction_economics_preserved": all(
            scenario["economic_transactions_unchanged"] for scenario in result["scenarios"]
            if scenario["scenario"] not in expected_errors
        ),
        "complete_successful_transactions_preserved": all(
            scenario["complete_transactions_unchanged"] for scenario in result["scenarios"]
            if scenario["scenario"] not in expected_errors
        ),
        "same_api_target_trading_day": all(
            scenario["api_target_trading_day"] == baseline_result["api_target_trading_day"]
            for scenario in result["scenarios"] if scenario["scenario"] not in expected_errors
        ),
        "core_inputs_unchanged": all(scenario["core_inputs_unchanged"] for scenario in result["scenarios"]),
        "no_observed_shadow_reads": all(not scenario["successful_shadow_reads"] for scenario in result["scenarios"]),
        "protected_sources_unchanged": result["source_files_unchanged"],
    }
    result["interpretation_limits"] = [
        "Equal legacy-file ablations establish non-dependence, not broker-level economic correctness.",
        "Private calibration ablations measure influence; a changed result does not establish that authoritative evidence is wrong.",
        "Only complete, unambiguous materialized private controls are removed; unsupported scopes remain visible in the audit.",
        "Raw broker artifacts remain necessary for later source verification/imports even when ordinary GET does not open them.",
        "Opaque broker artifact contents are not copied or rehashed; an observed GET reader/open on an isolated sparse placeholder rejects the scenario.",
        "Market rollback archives and presentation-only native images are outside this ledger-file ablation; current market SQLite is held constant and logos are absent in every scenario.",
        "The real baseline has no derived cache; cache_hit_exercised must be true before claiming a valid warm-cache ablation. Isolated regression fixtures cover that branch separately.",
        "The same-schema stale-cache scenario also has an incomplete payload; it measures rejection of that combined malformed control, not independent proof of the private-fingerprint check. Valid hit-to-miss transitions are covered by isolated dependency regressions.",
        "API workers use their recorded wall clocks and must agree on the target trading day; only the browser Date clock and captured auxiliary inputs are frozen. The selected economic digest is supplemented by the complete transactions digest.",
        "Read observations and source guards cover Python open/io.open, sqlite3.connect, and the listed pandas/Arrow path entrypoints. Direct native file classes/filesystem methods, pre-opened handles, and arbitrary C/OS I/O remain blind spots; this is not syscall-level isolation.",
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings-root", type=Path, default=PROJECT_ROOT / "settings_store")
    parser.add_argument("--market-root", type=Path, default=PROJECT_ROOT / "market_store")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--scenario")
    parser.add_argument("--protected-root", type=Path, action="append", default=[],
                        help="Additional read-protected original archive; never copied into scenarios.")
    parser.add_argument("--emit-browser-payload", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--browser-report", type=Path, help="Also measure the rendered browser P&L and complete chart series.")
    parser.add_argument("--browser-workspace", type=Path,
                        help="A new private artifact directory retained for browser checkpoint retry.")
    args = parser.parse_args()
    sources = [args.settings_root.resolve(), args.market_root.resolve()]
    protected_sources = [*sources, *(path.resolve() for path in args.protected_root)]
    if args.worker:
        print(json.dumps(run_worker(args.worker.resolve(), args.scenario, protected_sources, emit_browser_payload=args.emit_browser_payload)))
        return 0
    if args.report is None:
        parser.error("Specify an explicit local --report path outside the source stores.")
    report_path = args.report.resolve()
    protected_outputs = [*protected_sources, PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store"]
    if report_path.exists() or any(path_is_within(report_path, root) for root in protected_outputs):
        parser.error("Use a new report path outside the protected source stores.")
    browser_report = args.browser_report.resolve() if args.browser_report else None
    if browser_report is not None and (
        browser_report.exists() or path_is_within(browser_report, report_path)
        or path_is_within(report_path, browser_report)
        or any(path_is_within(browser_report, root) for root in protected_outputs)
    ):
        parser.error("Use a distinct new browser report outside every protected source store.")
    requested_workspace = args.browser_workspace or (
        browser_report.with_name(browser_report.name + ".workspace") if browser_report else None
    )
    browser_workspace = requested_workspace.resolve() if requested_workspace else None
    if browser_workspace is not None:
        if browser_report is None:
            parser.error("--browser-workspace requires --browser-report.")
        if requested_workspace.is_symlink() or browser_workspace.exists():
            parser.error("Use a new browser workspace; existing artifacts are retained for explicit retry.")
        if any(path_is_within(browser_workspace, root) or path_is_within(root, browser_workspace) for root in protected_outputs):
            parser.error("The browser workspace must be isolated from every protected source root.")
        if any(path_is_within(browser_workspace, output) for output in (report_path, browser_report)):
            parser.error("An output file cannot be an ancestor of the browser workspace.")
    before = {str(root): snapshot_files(root) for root in sources}
    source_bytes = sum(item["bytes"] for files in before.values() for item in files.values())
    # APFS clones avoid full physical baseline/case duplication. The reserve
    # covers one transient JSON/cache pair, compressed inputs, captures, and Chrome.
    copy_budget = 64 * MIB if sys.platform == "darwin" else source_bytes * 3
    estimated_peak = copy_budget + (192 * MIB if browser_report else 32 * MIB)
    require_free_space(browser_workspace or Path(os.environ.get("TMPDIR", "/tmp")), estimated_peak)
    scenarios = [
        "full_cold", "sqlite_with_cache", "sqlite_without_cache", "sqlite_without_cache_repeat",
        "conflicting_legacy_files", "stale_cache", "stale_same_schema_cache",
        "without_external_evidence", "without_embedded_evidence", "without_both_calibration_layers",
        "without_tagged_calibrations", "without_external_and_tagged_calibrations",
        "missing_canonical_with_legacy", "corrupt_canonical_with_legacy",
    ]
    if args.scenario:
        if args.scenario not in scenarios:
            parser.error("Unknown ablation scenario.")
        scenarios = ["full_cold"] + ([args.scenario] if args.scenario != "full_cold" else [])
        if browser_report:
            # Selected browser scopes still render the required independent controls.
            scenarios = list(dict.fromkeys([*FORCE_RENDER_SCENARIOS, *scenarios]))
    result = {
        "report_version": "1.3.0", "estimated_peak_additional_bytes": estimated_peak,
        "source_inventory_sha256": digest(before),
        "canonical_source_sha256": before[str(sources[0])].get("investment.sqlite3", {}).get("sha256"),
        "scenarios": [], "api_complete": False, "complete": False,
        "browser_requested": browser_report is not None,
    }
    with audit_workspace(browser_workspace) as workspace:
        result["browser_workspace"] = str(workspace) if browser_workspace else None
        result["workspace_retained"] = browser_workspace is not None
        write_json_checkpoint(workspace / "source-inventory.json", before)
        baseline = workspace / "baseline"
        for source in sources:
            copy_audit_source(source, baseline / source.name, before[str(source)])
        historical = next(iter(sorted((baseline / sources[0].name).glob("investment.parquet.before-*.bak"))), None)
        browser_scenarios = []
        transport = workspace / "browser-inputs.sqlite3"
        progress_path = workspace / "api-progress.json"
        progress_sha = None
        frozen_clock = datetime.now(timezone.utc).isoformat()
        for scenario in scenarios:
            require_free_space(workspace, 64 * MIB)
            case = workspace / scenario
            for source in sources:
                copy_audit_source(baseline / source.name, case / source.name, before[str(source)])
            if historical:
                destination = case / "historical-ledger-source"
                if not _clone_file(historical, destination):
                    require_free_space(case, historical.stat().st_size + 64 * MIB)
                    shutil.copyfile(historical, destination)
                _sanitize_copy(historical, destination)
            environment = {
                **os.environ, "PYTHONPYCACHEPREFIX": os.environ.get("WORTHWARD_ABLATION_PYCACHE", str(workspace / "bytecode")),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            command = [
                sys.executable, str(Path(__file__).resolve()), "--worker", str(case), "--scenario", scenario,
                "--settings-root", str(sources[0]), "--market-root", str(sources[1]),
            ]
            for original_root in args.protected_root:
                command.extend(["--protected-root", str(original_root.resolve())])
            if browser_report:
                command.append("--emit-browser-payload")
            completed = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=300, check=False)
            if completed.returncode:
                raise RuntimeError(f"Ablation scenario {scenario} failed: {completed.stderr[-2000:]}")
            measured = json.loads(completed.stdout)
            if measured["production_access_attempts"]:
                raise RuntimeError("An ablation worker crossed its protected source boundary.")
            measured["network_connections_blocked"] = True
            if measured["immutable_artifact_reads"]:
                raise RuntimeError("An ordinary-GET scenario unexpectedly consumed opaque broker artifact bytes.")
            if browser_report:
                payload_record = store_browser_payload(transport, scenario, case / "browser-payload.json")
                measured["browser_input"] = payload_record
                browser_scenarios.append({"name": scenario, "http_status": measured["status"], **payload_record})
            result["scenarios"].append(measured)
            progress_sha = write_json_checkpoint(progress_path, result, expected_sha256=progress_sha)
            shutil.rmtree(case)
        finalize_api_results(result, before, sources)
        result["api_complete"] = True
        result["complete"] = not browser_report and all(result["acceptance"].values())
        result["interpretation_limits"].extend([
            "API evidence is committed and read back before browser replay; a browser failure cannot erase completed API checks.",
            "Browser inputs are exact original worker JSON bytes in a FULL-sync compressed SQLite transport. No raw transport is removed until its committed SQLite roundtrip is verified.",
            "Exact-input deduplication is opt-in and requires identical full transport bytes and controls; required controls still render independently. Changed calibration inputs and negative cases remain distinct.",
        ])
        if browser_report:
            manifest = {
                "version": "1.1.0", "clock": frozen_clock, "scenarios": browser_scenarios,
                "protected_roots": [str(root) for root in protected_sources], "ranges": ["max", "1w"],
                "timezone": "Asia/Taipei", "deduplicate_exact_inputs": True,
                "force_render": FORCE_RENDER_SCENARIOS,
                "checkpoint_path": str(workspace / "browser-captures.sqlite3"), "resume_checkpoint": True,
                "server": {
                    "settings_root": str(baseline / "settings_store"), "market_root": str(baseline / "market_store"),
                    "compute_root": str(workspace / "browser-compute"), "python": sys.executable,
                },
            }
            manifest_path = workspace / "browser-manifest.json"
            write_json_checkpoint(manifest_path, manifest)
            result["browser_manifest"] = str(manifest_path)
            result["browser_report"] = str(browser_report)
            result["browser_replay"] = {"status": "pending", "complete": False}
        report_sha = write_json_checkpoint(report_path, result)
        if browser_report:
            browser_command = ["node", str(PROJECT_ROOT / "scripts/ledger_browser_ablation.mjs"),
                               "--manifest", str(manifest_path), "--report", str(browser_report)]
            if not os.environ.get("WORTHWARD_E2E_LOCK_TOKEN"):
                browser_command = [sys.executable, str(PROJECT_ROOT / "scripts/e2e_lock.py"),
                                   "run", "--root", str(PROJECT_ROOT), "--", *browser_command]
            browser_environment = {**os.environ, "PYTHONPYCACHEPREFIX": environment["PYTHONPYCACHEPREFIX"], "PYTHONDONTWRITEBYTECODE": "1"}
            try:
                require_free_space(workspace, 128 * MIB)
                browser_completed = run_browser_process(browser_command, browser_environment, timeout=max(1800, len(browser_scenarios) * 240))
                if browser_completed.returncode:
                    raise RuntimeError(f"Browser ablation failed ({browser_completed.returncode}): {browser_completed.stderr[-3000:]}")
                browser_evidence = json.loads(browser_report.read_text(encoding="utf-8"))
                if browser_evidence.get("complete") is not True:
                    raise RuntimeError("The browser report did not record completed acceptance.")
                result["source_files_unchanged"] = before == {str(root): snapshot_files(root) for root in sources}
                if not result["source_files_unchanged"]:
                    raise RuntimeError("Protected source files changed during browser replay.")
                result["browser_replay"] = {"status": "complete", "complete": True, "report_sha256": file_sha(browser_report)}
                result["complete"] = all(result["acceptance"].values())
                report_sha = write_json_checkpoint(report_path, result, expected_sha256=report_sha)
            except BaseException as error:
                result["browser_replay"] = {"status": "failed", "complete": False, "error_type": type(error).__name__}
                result["complete"] = False
                try:
                    write_json_checkpoint(report_path, result, expected_sha256=report_sha)
                except OSError:
                    pass
                raise
    print(json.dumps({"report": str(report_path), "api_complete": result["api_complete"], "complete": result["complete"],
                      "workspace_retained": result["workspace_retained"], "scenarios": len(result["scenarios"])}, indent=2))
    return 0 if result["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
