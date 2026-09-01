"""Tests for the shared bounded parallel execution layer. Code version: v0.1.1."""

from __future__ import annotations

import os
from unittest.mock import patch

from app.infrastructure.parallel import (
    map_ordered,
    map_ordered_batches,
    resolve_worker_count,
)


def _square(value: int) -> int:
    return value * value


def _batch_add(values: tuple[int, ...], offset: int) -> list[int]:
    return [value + offset for value in values]


def _identity(value: object) -> object:
    return value


def _worker_blas_threads(_value: int) -> str:
    return os.environ.get("OMP_NUM_THREADS", "")


class _Unpicklable:
    def __getstate__(self) -> object:
        raise TypeError("intentional test-only serialization failure")


def test_cpu_map_uses_spawn_processes_and_preserves_order() -> None:
    with patch("app.infrastructure.parallel.os.cpu_count", return_value=4):
        values, stats = map_ordered(
            _square,
            range(8),
            mode="cpu",
            min_items=1,
            max_workers=2,
        )

    assert values == [0, 1, 4, 9, 16, 25, 36, 49]
    assert stats.executor == "process"
    assert stats.workers == 2
    assert stats.fallback_reason is None


def test_cpu_batch_map_preserves_order_and_static_arguments() -> None:
    with patch("app.infrastructure.parallel.os.cpu_count", return_value=4):
        values, stats = map_ordered_batches(
            _batch_add,
            range(8),
            mode="cpu",
            static_args=(5,),
            min_items=1,
            max_workers=2,
        )

    assert values == [5, 6, 7, 8, 9, 10, 11, 12]
    assert stats.executor == "process"
    assert stats.workers == 2


def test_unpicklable_cpu_task_falls_back_to_threads() -> None:
    offset = 7

    def task(value: int) -> int:
        return value + offset

    values, stats = map_ordered(
        task,
        range(8),
        mode="cpu",
        min_items=1,
        max_workers=2,
    )

    assert values == list(range(7, 15))
    assert stats.executor == "thread"
    assert stats.workers == 2
    assert stats.fallback_reason == "task or input is not pickleable"


def test_cpu_worker_limit_one_stays_serial() -> None:
    with patch("app.infrastructure.parallel.os.cpu_count", return_value=16):
        assert resolve_worker_count(
            1_000,
            mode="cpu",
            min_items=1,
            max_workers=1,
        ) == 1


def test_process_workers_cap_nested_blas_threads() -> None:
    values, stats = map_ordered(
        _worker_blas_threads,
        range(8),
        mode="cpu",
        min_items=1,
        max_workers=2,
    )

    assert stats.executor == "process"
    assert values == ["1"] * 8


def test_later_unpicklable_item_is_detected_before_process_submission() -> None:
    values, stats = map_ordered(
        _identity,
        ["first", _Unpicklable()],
        mode="cpu",
        min_items=1,
        max_workers=2,
    )

    assert values[0] == "first"
    assert isinstance(values[1], _Unpicklable)
    assert stats.executor == "thread"
    assert stats.fallback_reason == "task or input is not pickleable"
