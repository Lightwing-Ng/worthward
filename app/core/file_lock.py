"""Portable advisory locks for local read-modify-write operations. Code version: v1.0.0."""

from contextlib import contextmanager
import os
from pathlib import Path
from threading import Lock
from typing import Iterator

_GUARD = Lock()
_LOCKS: dict[str, Lock] = {}


@contextmanager
def local_file_lock(path: Path) -> Iterator[None]:
    """Serialize cooperating threads and processes through a stable sidecar."""
    if path.is_symlink():
        raise ValueError("Invalid settings lock path.")
    with _GUARD:
        lock = _LOCKS.setdefault(str(path.resolve()), Lock())
    with lock, path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.truncate(1)
                handle.flush()
            handle.seek(0)
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
