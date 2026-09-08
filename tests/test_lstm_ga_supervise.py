"""Owned compute-process deadline tests. Code version: v1.1.0."""

from datetime import datetime, timezone
import json
import signal
import subprocess

import pytest

from scripts import lstm_ga_supervise as supervisor


class Clock:
    def __init__(self):
        self.monotonic = 0.0
        self.wall = 1_800_000_000.0

    def advance(self, seconds):
        self.monotonic += seconds
        self.wall += seconds

    def deadline(self, seconds):
        return datetime.fromtimestamp(self.wall + seconds, timezone.utc)


class Child:
    def __init__(self, clock, *, pid=999_991, returncode=None, hung=False):
        self.clock, self.pid, self.returncode = clock, pid, returncode
        self.hung = hung
        self.group_alive = returncode is None
        self.terminated = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        if not self.hung:
            self.returncode = -signal.SIGTERM

    def kill(self):
        if not self.hung:
            self.returncode = -signal.SIGKILL
            self.group_alive = False

    def wait(self, timeout):
        if self.returncode is None:
            self.clock.advance(timeout)
            raise subprocess.TimeoutExpired("owned-child", timeout)
        return self.returncode


@pytest.fixture
def harness(monkeypatch, tmp_path):
    clock = Clock()
    child = Child(clock)
    calls = []
    launches = []
    monkeypatch.setattr(supervisor.time, "monotonic", lambda: clock.monotonic)
    monkeypatch.setattr(supervisor.time, "time", lambda: clock.wall)
    monkeypatch.setattr(supervisor.time, "sleep", clock.advance)
    monkeypatch.setattr(supervisor, "process_start_identity", lambda _pid: "Mon Sep 7 20:00:00 2026")
    monkeypatch.setattr(supervisor.Path, "exists", lambda _path: False)

    def kill_group(pid, signum):
        calls.append((pid, signum, clock.monotonic))
        assert pid == child.pid
        if not child.group_alive:
            raise ProcessLookupError()
        if signum == signal.SIGKILL:
            child.kill()

    def launch(*args, **kwargs):
        launches.append((args, kwargs))
        return child

    monkeypatch.setattr(supervisor.os, "killpg", kill_group)
    monkeypatch.setattr(supervisor.subprocess, "Popen", launch)
    return clock, child, calls, launches, tmp_path / "supervisor.json"


def test_supervisor_terminates_only_new_group_before_hard_deadline(harness):
    clock, child, calls, launches, metadata = harness
    assert supervisor.supervise(["owned-compute"], metadata, 61) != 0
    assert launches[0][1]["start_new_session"] is True
    assert calls[0][:2] == (child.pid, signal.SIGTERM)
    assert any(signum == signal.SIGKILL and elapsed <= 56 for _, signum, elapsed in calls)
    record = json.loads(metadata.read_text())
    assert record["status"] == "hard_stopped"
    assert record["cleanup"]["status"] == "completed"
    assert clock.monotonic <= 61


def test_success_is_published_only_after_owned_cleanup(harness, monkeypatch):
    _clock, child, _calls, _launches, metadata = harness
    child.returncode, child.group_alive = 0, False
    states = []
    original = supervisor._persist

    def persist(path, record):
        states.append(record["status"])
        if record["status"] == "exited":
            assert record["cleanup"]["status"] == "completed"
            assert not child.group_alive
        original(path, record)

    monkeypatch.setattr(supervisor, "_persist", persist)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000) == 0
    assert states[-2:] == ["cleaning_up", "exited"]
    record = json.loads(metadata.read_text())
    assert record["supervisor_returncode"] == record["returncode"] == 0
    assert record["supervisor_identity"]["start_time"]


def test_expired_absolute_deadline_does_not_launch(harness):
    clock, _child, _calls, launches, metadata = harness
    assert supervisor.supervise(["owned-compute"], metadata, 36_000, deadline=clock.deadline(-1)) == 1
    assert not launches
    assert json.loads(metadata.read_text())["status"] == "expired"


def test_identity_lookup_delay_is_included_before_launch(harness, monkeypatch):
    clock, _child, _calls, launches, metadata = harness
    deadline = clock.deadline(1)

    def identity(_pid):
        clock.advance(2)
        return "Mon Sep 7 20:00:00 2026"

    monkeypatch.setattr(supervisor, "process_start_identity", identity)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000, deadline=deadline) == 1
    assert not launches
    assert json.loads(metadata.read_text())["status"] == "expired"


def test_delayed_child_startup_does_not_extend_absolute_deadline(harness, monkeypatch):
    clock, child, calls, _launches, metadata = harness
    deadline = clock.deadline(90)

    def launch(*_args, **_kwargs):
        clock.advance(20)
        return child

    monkeypatch.setattr(supervisor.subprocess, "Popen", launch)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000, deadline=deadline) != 0
    assert max(elapsed for _, signum, elapsed in calls if signum == signal.SIGKILL) <= 85
    assert clock.wall <= deadline.timestamp()
    assert json.loads(metadata.read_text())["deadline_utc"] == deadline.isoformat()


def test_backward_wall_clock_change_cannot_extend_monotonic_cap(harness, monkeypatch):
    clock, child, calls, _launches, metadata = harness
    deadline = clock.deadline(90)

    def launch(*_args, **_kwargs):
        clock.wall -= 3600
        return child

    monkeypatch.setattr(supervisor.subprocess, "Popen", launch)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000, deadline=deadline) != 0
    assert max(elapsed for _, signum, elapsed in calls if signum == signal.SIGKILL) <= 85


def test_forward_wall_clock_change_is_checked_after_child_start(harness, monkeypatch):
    clock, child, calls, _launches, metadata = harness
    deadline = clock.deadline(90)

    def launch(*_args, **_kwargs):
        clock.wall += 100
        return child

    monkeypatch.setattr(supervisor.subprocess, "Popen", launch)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000, deadline=deadline) != 0
    assert any(signum == signal.SIGKILL and elapsed == 0 for _, signum, elapsed in calls)


def test_cleanup_exception_cannot_publish_success(harness, monkeypatch):
    _clock, child, _calls, _launches, metadata = harness
    child.returncode, child.group_alive = 0, False
    monkeypatch.setattr(supervisor, "_cleanup", lambda *_args: (_ for _ in ()).throw(RuntimeError("cleanup exploded")))
    assert supervisor.supervise(["owned-compute"], metadata, 36_000) == 1
    record = json.loads(metadata.read_text())
    assert record["status"] == "cleanup_failed"
    assert record["supervisor_returncode"] == 1
    assert "cleanup exploded" in record["cleanup"]["errors"][0]


def test_caffeinate_hang_is_bounded_and_reported_as_cleanup_failure(harness, monkeypatch):
    clock, child, _calls, _launches, metadata = harness
    child.returncode, child.group_alive = 0, False
    awake = Child(clock, pid=999_992, hung=True)
    monkeypatch.setattr(supervisor.Path, "exists", lambda _path: True)
    children = iter((child, awake))
    monkeypatch.setattr(supervisor.subprocess, "Popen", lambda *_args, **_kwargs: next(children))
    assert supervisor.supervise(["owned-compute"], metadata, 36_000) == 1
    record = json.loads(metadata.read_text())
    assert record["status"] == "cleanup_failed"
    assert not record["cleanup"]["caffeinate_reaped"]
    assert clock.monotonic <= 2


def test_surviving_owned_group_rejects_success(harness, monkeypatch):
    clock, child, _calls, _launches, metadata = harness
    child.returncode = 0
    monkeypatch.setattr(supervisor, "_terminate_group", lambda *_args: None)
    assert supervisor.supervise(["owned-compute"], metadata, 36_000) == 1
    record = json.loads(metadata.read_text())
    assert record["status"] == "cleanup_failed"
    assert not record["cleanup"]["owned_group_gone"]
    assert clock.monotonic <= 2


def test_deadline_parser_requires_timezone_and_accepts_utc():
    assert supervisor.parse_deadline("2026-09-08T00:02:56Z").isoformat() == "2026-09-08T00:02:56+00:00"
    with pytest.raises(supervisor.argparse.ArgumentTypeError):
        supervisor.parse_deadline("2026-09-08T00:02:56")


@pytest.mark.parametrize("budget", [float("nan"), float("inf"), -1, 60])
def test_budget_requires_finite_bounded_duration(tmp_path, budget):
    with pytest.raises(ValueError):
        supervisor.supervise(["owned-compute"], tmp_path / "supervisor.json", budget)
