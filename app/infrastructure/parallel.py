"""
Bounded parallel execution primitives for the local application.

CPU-bound work uses a bounded reusable ``spawn`` process pool when the workload
is large enough. I/O-bound work uses threads, and small workloads stay inline
so pool startup cannot dominate the request. All public helpers preserve input
order.

Code version: v0.1.1
- Fixed: CPU dispatch validates every input item before process submission, so
  a later unpicklable item selects the ordered thread fallback instead of
  surfacing an avoidable serialization error.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
import atexit
from dataclasses import dataclass
from functools import partial
import multiprocessing
import os
import pickle
import sys
import threading
from typing import Any, Callable, Iterable, Literal, Sequence, TypeVar


T = TypeVar("T")
R = TypeVar("R")
ParallelMode = Literal["cpu", "io"]

DEFAULT_CPU_MAX_WORKERS = 8
DEFAULT_CPU_MIN_ITEMS = 64
DEFAULT_IO_MAX_WORKERS = 8

__all__ = [
    "ParallelStats",
    "available_cpu_count",
    "map_ordered",
    "map_ordered_batches",
    "resolve_worker_count",
]


_PROCESS_EXECUTORS: dict[int, ProcessPoolExecutor] = {}
_PROCESS_EXECUTORS_LOCK = threading.Lock()


@dataclass(frozen=True)
class ParallelStats:
    """Describe the executor actually used for one ordered map."""

    requested_mode: ParallelMode
    executor: Literal["serial", "process", "thread"]
    workers: int
    item_count: int
    fallback_reason: str | None = None


def available_cpu_count() -> int:
    """Return a safe positive logical-CPU count for worker sizing."""
    try:
        return max(1, int(os.cpu_count() or 1))
    except (TypeError, ValueError):
        return 1


def resolve_worker_count(
        item_count: int,
        *,
        mode: ParallelMode,
        min_items: int | None = None,
        max_workers: int | None = None,
) -> int:
    """Choose a bounded worker count without oversubscribing tiny workloads."""
    normalized_items = max(0, int(item_count))
    if mode == "cpu":
        threshold = (
            DEFAULT_CPU_MIN_ITEMS
            if min_items is None
            else max(1, int(min_items))
        )
        worker_limit = (
            DEFAULT_CPU_MAX_WORKERS
            if max_workers is None
            else max(1, int(max_workers))
        )
        available = available_cpu_count()
        if normalized_items < threshold or available < 2 or worker_limit < 2:
            return 1
        workload_workers = max(2, (normalized_items + threshold - 1) // threshold)
        return max(2, min(available, worker_limit, workload_workers))

    threshold = 2 if min_items is None else max(1, int(min_items))
    worker_limit = (
        DEFAULT_IO_MAX_WORKERS
        if max_workers is None
        else max(1, int(max_workers))
    )
    if normalized_items < threshold:
        return 1
    return max(1, min(worker_limit, normalized_items))


def _is_picklable(value: object) -> bool:
    try:
        pickle.dumps(value)
    except (pickle.PickleError, TypeError, AttributeError, ValueError, OSError):
        return False
    return True


def _spawn_context_available() -> bool:
    """Avoid noisy spawn failures in REPL, stdin, and notebook entrypoints."""
    main_module = sys.modules.get("__main__")
    main_file = getattr(main_module, "__file__", None)
    return bool(main_file and not str(main_file).startswith("<"))


def _run_batch(
        function: Callable[..., Sequence[R]],
        static_args: tuple[Any, ...],
        batch: tuple[T, ...],
) -> list[R]:
    return list(function(batch, *static_args))


def _configure_cpu_worker() -> None:
    """Prevent nested BLAS pools from oversubscribing the process pool."""
    for variable in (
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "VECLIB_MAXIMUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[variable] = "1"


def _process_executor(worker_count: int) -> ProcessPoolExecutor:
    """Return a reusable spawn pool so repeated backtests amortize startup."""
    with _PROCESS_EXECUTORS_LOCK:
        executor = _PROCESS_EXECUTORS.get(worker_count)
        if executor is None:
            executor = ProcessPoolExecutor(
                max_workers=worker_count,
                mp_context=multiprocessing.get_context("spawn"),
                initializer=_configure_cpu_worker,
            )
            _PROCESS_EXECUTORS[worker_count] = executor
        return executor


def _discard_process_executor(worker_count: int) -> None:
    with _PROCESS_EXECUTORS_LOCK:
        executor = _PROCESS_EXECUTORS.pop(worker_count, None)
    if executor is not None:
        executor.shutdown(wait=False, cancel_futures=True)


def _shutdown_process_executors() -> None:
    with _PROCESS_EXECUTORS_LOCK:
        executors = tuple(_PROCESS_EXECUTORS.values())
        _PROCESS_EXECUTORS.clear()
    for executor in executors:
        executor.shutdown(wait=True, cancel_futures=True)


atexit.register(_shutdown_process_executors)


def map_ordered(
        function: Callable[[T], R],
        items: Iterable[T],
        *,
        mode: ParallelMode,
        min_items: int | None = None,
        max_workers: int | None = None,
) -> tuple[list[R], ParallelStats]:
    """Map a pure task in input order using the appropriate bounded executor."""
    values = list(items)
    worker_count = resolve_worker_count(
        len(values),
        mode=mode,
        min_items=min_items,
        max_workers=max_workers,
    )
    if worker_count <= 1:
        return (
            [function(value) for value in values],
            ParallelStats(mode, "serial", 1, len(values)),
        )

    if mode == "io":
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            return (
                list(executor.map(function, values)),
                ParallelStats(mode, "thread", worker_count, len(values)),
            )

    if (
            _spawn_context_available()
            and _is_picklable(function)
            and all(_is_picklable(value) for value in values)
    ):
        try:
            executor = _process_executor(worker_count)
        except (OSError, RuntimeError) as exc:
            fallback_reason = f"{type(exc).__name__}: {str(exc) or 'process pool unavailable'}"
        else:
            try:
                return (
                    list(executor.map(function, values)),
                    ParallelStats(mode, "process", worker_count, len(values)),
                )
            except BrokenProcessPool as exc:
                _discard_process_executor(worker_count)
                fallback_reason = f"{type(exc).__name__}: process pool broke"
    else:
        fallback_reason = (
            "spawn requires a file-backed __main__ module"
            if not _spawn_context_available()
            else "task or input is not pickleable"
        )

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        return (
            list(executor.map(function, values)),
            ParallelStats(
                mode,
                "thread",
                worker_count,
                len(values),
                fallback_reason,
            ),
        )


def map_ordered_batches(
        function: Callable[..., Sequence[R]],
        items: Iterable[T],
        *,
        mode: ParallelMode,
        static_args: tuple[Any, ...] = (),
        min_items: int | None = None,
        max_workers: int | None = None,
) -> tuple[list[R], ParallelStats]:
    """Map contiguous batches while serializing large static inputs once per batch."""
    values = list(items)
    worker_count = resolve_worker_count(
        len(values),
        mode=mode,
        min_items=min_items,
        max_workers=max_workers,
    )
    if worker_count <= 1:
        flattened: list[R] = []
        batch = tuple(values)
        if batch:
            flattened.extend(function(batch, *static_args))
        return flattened, ParallelStats(mode, "serial", 1, len(values))

    batch_size = max(1, (len(values) + worker_count - 1) // worker_count)
    batches = [
        tuple(values[offset:offset + batch_size])
        for offset in range(0, len(values), batch_size)
    ]
    bound = partial(_run_batch, function, static_args)
    outputs, stats = map_ordered(
        bound,
        batches,
        mode=mode,
        min_items=1,
        max_workers=worker_count,
    )
    return [item for batch in outputs for item in batch], ParallelStats(
        mode,
        stats.executor,
        stats.workers,
        len(values),
        stats.fallback_reason,
    )
