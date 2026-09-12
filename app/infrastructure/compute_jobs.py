"""Side-effect-isolated primitives for durable compute-job metadata.

Code version: v1.1.1

These helpers never initialize or migrate market, settings, or investment
stores. Compute managers retain ownership of their domain-specific lifecycle.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from threading import Lock
from typing import Iterator, Mapping, Sequence
from uuid import uuid4


_THREAD_LOCKS_GUARD = Lock()
_THREAD_LOCKS: dict[str, Lock] = {}


def _thread_lock_for(path: Path) -> Lock:
    key = str(path.resolve(strict=False))
    with _THREAD_LOCKS_GUARD:
        return _THREAD_LOCKS.setdefault(key, Lock())


def _prepare_windows_lock_byte(handle) -> None:
    """Ensure byte zero exists without growing an append-opened lock file."""
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.truncate(1)
        handle.flush()
    handle.seek(0)


def project_compute_workspace_root(
        state_root: Path,
        project_root: Path,
        *children: str,
) -> Path:
    """Return the stable project-scoped directory below a compute state root."""
    project_digest = hashlib.sha256(
        str(project_root.resolve()).encode("utf-8")
    ).hexdigest()[:16]
    return state_root / project_digest / Path(*children)


def read_json_object(path: Path) -> dict:
    """Read one non-symlink JSON object, failing closed to an empty object."""
    if path.is_symlink():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def write_json_atomic(
        path: Path,
        payload: Mapping,
        *,
        compact: bool = False,
) -> None:
    """Atomically replace one compute-job JSON object in its existing directory."""
    options: dict[str, object] = {
        "allow_nan": False,
        "sort_keys": True,
    }
    if compact:
        options["separators"] = (",", ":")
    serialized = json.dumps(payload, **options)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp"
    )
    try:
        temporary.write_text(serialized, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


@contextmanager
def compute_workspace_lock(path: Path) -> Iterator[None]:
    """Serialize compute-job admission and archive decisions across threads and processes."""
    if path.is_symlink():
        raise ValueError("Invalid compute workspace lock path.")
    with _thread_lock_for(path), path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            _prepare_windows_lock_byte(handle)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def matching_run_directories(
        root: Path,
        pattern: re.Pattern[str],
) -> list[Path]:
    """List direct, non-symlink run directories matching one manager pattern."""
    if root.is_symlink() or not root.is_dir():
        return []
    return [
        path
        for path in root.iterdir()
        if path.is_dir()
        and not path.is_symlink()
        and pattern.fullmatch(path.name)
    ]


def assign_daily_run_identifiers(
        runs: Sequence[dict],
        archived_runs: Sequence[dict],
        *,
        group_fields: Sequence[str],
) -> None:
    """Assign stable per-day ordinals while counting recoverable archives."""
    counters: dict[tuple[str, ...], int] = {}
    ordered = sorted(
        [*runs, *archived_runs],
        key=lambda item: (
            str(item.get("started_at") or ""),
            str(item.get("id") or ""),
        ),
    )
    for run in ordered:
        try:
            day = datetime.fromisoformat(
                str(run.get("started_at") or "")
            ).astimezone(timezone.utc).strftime("%y%m%d")
        except (TypeError, ValueError):
            continue
        key = (*(
            str(run.get(field) or "")
            for field in group_fields
        ), day)
        counters[key] = counters.get(key, 0) + 1
        run["identifier"] = f"{day}({counters[key]:02d})"
