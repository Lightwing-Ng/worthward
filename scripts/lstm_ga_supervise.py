"""Bound one explicitly launched compute job. Code version: v1.0.0."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def supervise(command: list[str], metadata: Path, budget: float) -> int:
    """Own only a new process group; include launch and cleanup in the budget."""
    if os.name != "posix" or budget <= 60:
        raise ValueError("This supervisor requires POSIX and a budget above 60 seconds.")
    started = time.monotonic()
    metadata.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema": 1, "supervisor_pid": os.getpid(), "command": command,
        "started_at": datetime.now(timezone.utc).isoformat(), "budget_seconds": budget,
        "status": "starting",
    }

    def persist() -> None:
        temporary = metadata.with_suffix(".tmp")
        temporary.write_text(json.dumps(record, indent=2), encoding="utf-8")
        temporary.replace(metadata)

    def terminate_group(pid: int, signum: int) -> None:
        try:
            os.killpg(pid, signum)
        except ProcessLookupError:
            pass

    persist()
    with metadata.with_suffix(".log").open("a", encoding="utf-8") as output:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        awake = None
        try:
            if Path("/usr/bin/caffeinate").exists():
                awake = subprocess.Popen(["/usr/bin/caffeinate", "-i", "-w", str(process.pid)])
            record.update(pid=process.pid, status="running")
            persist()
            stop_requested = False

            def request_stop(_signum: int, _frame: object) -> None:
                nonlocal stop_requested
                stop_requested = True

            signal.signal(signal.SIGTERM, request_stop)
            signal.signal(signal.SIGINT, request_stop)
            signaled_at = None
            while process.poll() is None:
                elapsed = time.monotonic() - started
                if signaled_at is None and (stop_requested or elapsed >= budget - 60):
                    signaled_at = elapsed
                    terminate_group(process.pid, signal.SIGTERM)
                    record.update(status="stopping", term_at_seconds=elapsed)
                    persist()
                if elapsed >= budget or (signaled_at is not None and elapsed >= signaled_at + 60):
                    terminate_group(process.pid, signal.SIGKILL)
                    record.update(status="hard_stopped", kill_at_seconds=elapsed)
                    break
                time.sleep(min(1.0, max(0.001, budget - elapsed)))
            process.wait(timeout=5)
            record.update(
                status="exited" if signaled_at is None else record["status"],
                returncode=process.returncode,
                elapsed_seconds=time.monotonic() - started,
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
            persist()
            return int(process.returncode or 0)
        finally:
            # Cover an unexpected supervisor exception and orphaned workers.
            terminate_group(process.pid, signal.SIGKILL)
            if awake is not None and awake.poll() is None:
                awake.terminate()
                awake.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budget-seconds", type=float, default=36_000)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("A compute command is required after --.")
    return supervise(command, args.metadata, args.budget_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
