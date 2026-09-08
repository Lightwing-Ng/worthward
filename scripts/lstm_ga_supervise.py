"""Bound one explicitly launched compute job. Code version: v1.1.0."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import time


def process_start_identity(pid: int) -> str:
    """Identify this process independently of a potentially recycled PID."""
    result = subprocess.run(
        ["/bin/ps", "-p", str(pid), "-o", "lstart="],
        capture_output=True, text=True, timeout=2, check=False,
    )
    identity = result.stdout.strip()
    if result.returncode or not identity:
        raise RuntimeError("Cannot record the supervisor process-start identity.")
    return identity


def _persist(metadata: Path, record: dict) -> None:
    temporary = metadata.with_suffix(".tmp")
    temporary.write_text(json.dumps(record, indent=2), encoding="utf-8")
    temporary.replace(metadata)


def _terminate_group(pid: int, signum: int) -> None:
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def _group_exists(pid: int) -> bool:
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _cleanup(process, awake, remaining) -> dict:
    """Reap only the launched child/group and the owned sleep inhibitor."""
    errors = []
    if process is not None:
        try:
            _terminate_group(process.pid, signal.SIGKILL)
        except Exception as exc:  # noqa: BLE001 - Continue other owned cleanup.
            errors.append(f"group kill: {type(exc).__name__}: {exc}")
        try:
            process.wait(timeout=min(1.0, max(0.0, remaining())))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"child reap: {type(exc).__name__}: {exc}")
    if awake is not None:
        try:
            if awake.poll() is None:
                awake.terminate()
            try:
                awake.wait(timeout=min(1.0, max(0.0, remaining())))
            except subprocess.TimeoutExpired:
                awake.kill()
                awake.wait(timeout=min(1.0, max(0.0, remaining())))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"caffeinate reap: {type(exc).__name__}: {exc}")
    group_gone = process is None
    if process is not None:
        try:
            until = time.monotonic() + min(2.0, max(0.0, remaining()))
            while _group_exists(process.pid):
                delay = min(0.05, until - time.monotonic(), remaining())
                if delay <= 0:
                    break
                time.sleep(delay)
            group_gone = not _group_exists(process.pid)
            if not group_gone:
                errors.append("owned process group still exists after bounded cleanup")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"group verification: {type(exc).__name__}: {exc}")
    child_reaped = process is None or process.poll() is not None
    awake_reaped = awake is None or awake.poll() is not None
    completed = not errors and group_gone and child_reaped and awake_reaped
    return {"status": "completed" if completed else "failed", "errors": errors,
            "owned_group_gone": group_gone, "child_reaped": child_reaped,
            "caffeinate_reaped": awake_reaped}


def supervise(command: list[str], metadata: Path, budget: float, *, deadline: datetime | None = None) -> int:
    """Include launch and cleanup within absolute and monotonic time limits."""
    if os.name != "posix" or not math.isfinite(budget) or budget <= 60:
        raise ValueError("This supervisor requires POSIX and a budget above 60 seconds.")
    if deadline is not None and deadline.utcoffset() is None:
        raise ValueError("The absolute deadline must include a UTC offset.")
    started = time.monotonic()
    wall_deadline = deadline.timestamp() if deadline is not None else None
    initial_remaining = min(budget, wall_deadline - time.time()) if wall_deadline is not None else budget
    monotonic_deadline = started + max(0.0, initial_remaining)

    def remaining() -> float:
        duration = monotonic_deadline - time.monotonic()
        return min(duration, wall_deadline - time.time()) if wall_deadline is not None else duration

    metadata.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema": 2, "supervisor_pid": os.getpid(), "command": command,
        "started_at": datetime.now(timezone.utc).isoformat(), "budget_seconds": budget,
        "deadline_utc": deadline.astimezone(timezone.utc).isoformat() if deadline else None,
        "effective_budget_seconds": max(0.0, initial_remaining), "status": "starting",
    }
    process = awake = None
    previous_handlers = {}
    outcome, exit_code = "failed", 1
    stop_requested = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stop_requested
        stop_requested = True

    try:
        _persist(metadata, record)
        if remaining() <= 0:
            outcome = "expired"
        else:
            record["supervisor_identity"] = {"pid": os.getpid(), "start_time": process_start_identity(os.getpid())}
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous_handlers[signum] = signal.signal(signum, request_stop)
            # Identity lookup and filesystem startup count toward the deadline.
            if remaining() <= 0 or stop_requested:
                outcome = "expired" if not stop_requested else "interrupted"
            else:
                with metadata.with_suffix(".log").open("a", encoding="utf-8") as output:
                    process = subprocess.Popen(
                        command, stdin=subprocess.DEVNULL, stdout=output,
                        stderr=subprocess.STDOUT, start_new_session=True,
                    )
                    record.update(pid=process.pid, status="running")
                    _persist(metadata, record)
                    if remaining() > 5 and Path("/usr/bin/caffeinate").exists():
                        awake = subprocess.Popen(["/usr/bin/caffeinate", "-i", "-w", str(process.pid)])
                    signaled_at = None
                    outcome = "exited"
                    while process.poll() is None:
                        elapsed = time.monotonic() - started
                        time_left = remaining()
                        if signaled_at is None and (stop_requested or time_left <= 60):
                            signaled_at = time.monotonic()
                            _terminate_group(process.pid, signal.SIGTERM)
                            outcome = "interrupted" if stop_requested else "stopping"
                            record.update(status=outcome, term_at_seconds=elapsed)
                            _persist(metadata, record)
                        # Leave five seconds for reaping and group verification.
                        if time_left <= 5 or (signaled_at is not None and time.monotonic() - signaled_at >= 55):
                            _terminate_group(process.pid, signal.SIGKILL)
                            outcome = "hard_stopped"
                            record.update(status=outcome, kill_at_seconds=elapsed)
                            _persist(metadata, record)
                            break
                        time.sleep(min(1.0, max(0.001, time_left - 5)))
                    exit_code = int(process.returncode or 0)
                    if outcome != "exited" and exit_code == 0:
                        exit_code = 130 if stop_requested else 1
    except BaseException as exc:  # Cleanup and truthful evidence also cover interruption.
        outcome, exit_code = "failed", 1
        record["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        record.update(status="cleaning_up", outcome=outcome)
        try:
            _persist(metadata, record)
        finally:
            try:
                cleanup = _cleanup(process, awake, remaining)
            except BaseException as exc:
                cleanup = {"status": "failed", "errors": [f"{type(exc).__name__}: {exc}"],
                           "owned_group_gone": False, "child_reaped": False,
                           "caffeinate_reaped": False}
            finally:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
    if cleanup["status"] != "completed":
        outcome, exit_code = "cleanup_failed", 1
    if outcome == "exited" and remaining() < 0:
        outcome, exit_code = "expired", 1
    record.update(
        status=outcome, returncode=process.returncode if process is not None else None,
        supervisor_returncode=exit_code, cleanup=cleanup,
        elapsed_seconds=time.monotonic() - started,
        finished_at=datetime.now(timezone.utc).isoformat(),
    )
    _persist(metadata, record)
    return exit_code


def parse_deadline(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError("timezone is required")
        return parsed.astimezone(timezone.utc)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Deadline must be an ISO-8601 timestamp with a UTC offset.") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budget-seconds", type=float, default=36_000)
    parser.add_argument("--deadline", type=parse_deadline, help="Absolute ISO-8601 UTC deadline; also bounded by budget-seconds.")
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("A compute command is required after --.")
    return supervise(command, args.metadata, args.budget_seconds, deadline=args.deadline)


if __name__ == "__main__":
    raise SystemExit(main())
