#!/usr/bin/env python3

"""Run one command while holding the user- and port-scoped host E2E lock."""

# Code version: v1.0.0

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from typing import Sequence


LOCK_BUSY_EXIT = 73
E2E_PORT = 8699


def _compatible_environment(primary_name: str, legacy_name: str) -> str:
    return str(
        os.environ.get(primary_name)
        or os.environ.get(legacy_name)
        or ""
    ).strip()


def _repository_root(raw_root: str) -> Path:
    return Path(raw_root).resolve(strict=True)


def e2e_lock_path(root: Path) -> Path:
    override = _compatible_environment(
        "WORTHWARD_E2E_LOCK_FILE_OVERRIDE",
        "ANTIGRAVITY_E2E_LOCK_FILE_OVERRIDE",
    )
    if override:
        return Path(override).resolve()
    user_id = os.getuid() if hasattr(os, "getuid") else 0
    return Path(tempfile.gettempdir()) / f"worthward-e2e-{user_id}-port-{E2E_PORT}.lock"


def _read_owner(lock_handle: object) -> str:
    try:
        lock_handle.seek(0)
        raw_owner = lock_handle.read().strip()
    except OSError:
        return "unknown"
    if not raw_owner:
        return "unknown"
    try:
        owner = json.loads(raw_owner)
    except json.JSONDecodeError:
        return raw_owner
    pid = owner.get("pid", "unknown")
    command = owner.get("command", "unknown")
    return f"PID {pid} ({command})"


def _write_owner(
    lock_handle: object,
    *,
    root: Path,
    command: Sequence[str],
    token: str,
) -> None:
    owner = {
        "command": " ".join(command),
        "pid": os.getpid(),
        "root": str(root),
        "token": token,
    }
    lock_handle.seek(0)
    lock_handle.truncate()
    json.dump(owner, lock_handle, sort_keys=True)
    lock_handle.write("\n")
    lock_handle.flush()
    os.fsync(lock_handle.fileno())


def _run_locked(root: Path, command: Sequence[str]) -> int:
    if not command:
        raise ValueError("A command is required after --.")

    lock_path = e2e_lock_path(root)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock_handle:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            owner = _read_owner(lock_handle)
            print(
                "E2E suite is already running for "
                f"{root}; lock owner: {owner}. No E2E files were changed.",
                file=sys.stderr,
            )
            return LOCK_BUSY_EXIT

        token = secrets.token_hex(16)
        _write_owner(lock_handle, root=root, command=command, token=token)
        lock_fd = lock_handle.fileno()
        os.set_inheritable(lock_fd, True)
        environment = os.environ.copy()
        environment.update(
            {
                "WORTHWARD_E2E_LOCK_FD": str(lock_fd),
                "WORTHWARD_E2E_LOCK_FILE": str(lock_path),
                "WORTHWARD_E2E_LOCK_ROOT": str(root),
                "WORTHWARD_E2E_LOCK_TOKEN": token,
                "ANTIGRAVITY_E2E_LOCK_FD": str(lock_fd),
                "ANTIGRAVITY_E2E_LOCK_FILE": str(lock_path),
                "ANTIGRAVITY_E2E_LOCK_ROOT": str(root),
                "ANTIGRAVITY_E2E_LOCK_TOKEN": token,
            }
        )
        try:
            completed = subprocess.run(
                list(command),
                check=False,
                env=environment,
                pass_fds=(lock_fd,),
            )
        except KeyboardInterrupt:
            return 130
        return completed.returncode


def _verify_inherited(root: Path) -> int:
    try:
        inherited_path_raw = _compatible_environment(
            "WORTHWARD_E2E_LOCK_FILE",
            "ANTIGRAVITY_E2E_LOCK_FILE",
        )
        inherited_root_raw = _compatible_environment(
            "WORTHWARD_E2E_LOCK_ROOT",
            "ANTIGRAVITY_E2E_LOCK_ROOT",
        )
        inherited_token = _compatible_environment(
            "WORTHWARD_E2E_LOCK_TOKEN",
            "ANTIGRAVITY_E2E_LOCK_TOKEN",
        )
        if not inherited_path_raw or not inherited_root_raw or not inherited_token:
            raise KeyError("incomplete lock metadata")
        inherited_path = Path(inherited_path_raw)
        inherited_root = Path(inherited_root_raw)
    except (KeyError, TypeError):
        print(
            "Missing inherited E2E lock metadata. "
            "Use ./scripts/test_e2e.sh or ./scripts/run_e2e_app.sh.",
            file=sys.stderr,
        )
        return LOCK_BUSY_EXIT

    expected_path = e2e_lock_path(root)
    if inherited_root.resolve() != root or inherited_path != expected_path:
        print("Inherited E2E lock does not belong to this repository.", file=sys.stderr)
        return LOCK_BUSY_EXIT

    try:
        path_stat = expected_path.stat()
        with expected_path.open(encoding="utf-8") as owner_file:
            owner = json.load(owner_file)
    except (OSError, json.JSONDecodeError):
        print("Inherited E2E lock is no longer valid.", file=sys.stderr)
        return LOCK_BUSY_EXIT

    if owner.get("root") != str(root) or owner.get("token") != inherited_token:
        print("Inherited E2E lock metadata does not match its owner.", file=sys.stderr)
        return LOCK_BUSY_EXIT

    raw_lock_fd = _compatible_environment(
        "WORTHWARD_E2E_LOCK_FD",
        "ANTIGRAVITY_E2E_LOCK_FD",
    )
    if raw_lock_fd:
        try:
            descriptor_stat = os.fstat(int(raw_lock_fd))
        except (OSError, ValueError):
            descriptor_stat = None
        if descriptor_stat is not None and (
            descriptor_stat.st_dev == path_stat.st_dev
            and descriptor_stat.st_ino == path_stat.st_ino
        ):
            return 0

    try:
        with expected_path.open("a+", encoding="utf-8") as probe_handle:
            fcntl.flock(
                probe_handle.fileno(),
                fcntl.LOCK_EX | fcntl.LOCK_NB,
            )
    except BlockingIOError:
        return 0

    print("Inherited E2E lock has no active host owner.", file=sys.stderr)
    return LOCK_BUSY_EXIT


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--root", required=True)
    run_parser.add_argument("command", nargs=argparse.REMAINDER)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--root", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    root = _repository_root(args.root)
    if args.action == "verify":
        return _verify_inherited(root)

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    return _run_locked(root, command)


if __name__ == "__main__":
    raise SystemExit(main())
