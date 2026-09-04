"""Durable local LSTM training launch and history service.

Code version: v0.3.0

This service owns only compute-job metadata. Market data and investment stores
remain outside its write boundary.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
from typing import Any, Mapping

from app.core.config import PERIOD_OFFSETS
from scripts import lstm_ga_tune as ga_runner


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DURATION_SECONDS = ga_runner.DEFAULT_DURATION_SECONDS
DEFAULT_POPULATION_SIZE = ga_runner.DEFAULT_POPULATION_SIZE
MAX_WORKERS = ga_runner.MAX_WORKERS
RUN_ID_PATTERN = re.compile(r"^lstm-ga-[a-f0-9]{24}$")
TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,14}$")
ACTIVE_STATUSES = frozenset({"starting", "running"})


class LstmTrainingConflict(RuntimeError):
    """Raised when the requested ticker already has an active training run."""


class LstmTrainingManager:
    """Launch and inspect one project's durable LSTM tuning runs."""

    def __init__(self, state_root: Path | str | None = None) -> None:
        self._state_root_override = Path(state_root).expanduser().resolve() if state_root else None

    def list_runs(self) -> list[dict[str, Any]]:
        workspace_root = self._workspace_root()
        if not workspace_root.is_dir():
            return []
        runs = [
            self._read_run(state_dir)
            for state_dir in workspace_root.iterdir()
            if state_dir.is_dir() and RUN_ID_PATTERN.fullmatch(state_dir.name)
        ]
        return sorted(
            runs,
            key=lambda item: str(item.get("started_at") or item.get("created_at") or ""),
            reverse=True,
        )

    def start(self, ticker: str, period: str, params: object = None) -> dict[str, Any]:
        normalized_ticker = self._normalize_ticker(ticker)
        normalized_period = self._normalize_period(period)
        selected_params = ga_runner.validate_selected_params(params)
        if any(
            run.get("ticker") == normalized_ticker and run.get("status") in ACTIVE_STATUSES
            for run in self.list_runs()
        ):
            raise LstmTrainingConflict(
                f"LSTM training is already running for {normalized_ticker}."
            )

        seed = self._unique_seed(normalized_ticker, normalized_period)
        args = self._build_runner_args(normalized_ticker, normalized_period, seed)
        args.selected_params = selected_params
        spec = ga_runner.build_request_spec(args)
        paths = ga_runner.build_run_paths(args, spec)
        paths.state.mkdir(parents=True, exist_ok=False)
        command = [
            sys.executable,
            str(PROJECT_ROOT / "scripts" / "lstm_ga_tune.py"),
            "--ticker",
            normalized_ticker,
            "--period",
            normalized_period,
            "--duration-seconds",
            str(DEFAULT_DURATION_SECONDS),
            "--population-size",
            str(DEFAULT_POPULATION_SIZE),
            "--max-workers",
            str(args.max_workers),
            "--ga-seed",
            str(seed),
            "--state-root",
            str(paths.root),
            "--selected-params",
            json.dumps(selected_params, sort_keys=True, allow_nan=False),
        ]
        log_handle = paths.log.open("a", encoding="utf-8")
        try:
            process = subprocess.Popen(
                command,
                cwd=str(PROJECT_ROOT),
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except Exception:
            log_handle.close()
            self._remove_empty_state(paths.state)
            raise
        finally:
            if not log_handle.closed:
                log_handle.close()

        self._write_json(paths.state / "launch.json", {
            "schema": 1,
            "run_id": paths.state.name,
            "pid": process.pid,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ticker": normalized_ticker,
            "period": normalized_period,
            "ga_seed": seed,
            "selected_params": selected_params,
        })
        return {
            **self._read_run(paths.state),
            "status": "starting",
            "active": True,
        }

    def stop(self, run_id: str) -> dict[str, Any]:
        paths = self._paths_for_run_id(run_id)
        run = self._read_run(paths.state)
        if run.get("status") not in ACTIVE_STATUSES:
            return run
        request = self._read_json(paths.request) or self._read_json(paths.state / "launch.json")
        pid = self._run_pid(run)
        if not pid or not self._process_matches(pid, request):
            return {**run, "status": "stale", "active": False}
        try:
            if hasattr(os, "killpg"):
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return {**run, "status": "stale", "active": False}
        except PermissionError as exc:
            raise RuntimeError("The LSTM training process could not be terminated.") from exc
        return {**run, "status": "stopping", "active": True}

    def _state_root(self) -> Path:
        if self._state_root_override is not None:
            return self._state_root_override
        configured = os.environ.get("WORTHWARD_COMPUTE_ROOT", "").strip()
        if configured:
            return Path(configured).expanduser().resolve()
        return Path.home() / "Library" / "Application Support" / "Worthward" / "compute-jobs"

    def _workspace_root(self) -> Path:
        workspace_hash = hashlib.sha256(str(PROJECT_ROOT.resolve()).encode("utf-8")).hexdigest()[:16]
        return self._state_root() / workspace_hash

    def _paths_for_run_id(self, run_id: str) -> ga_runner.RunPaths:
        if not RUN_ID_PATTERN.fullmatch(str(run_id).strip()):
            raise ValueError("Invalid LSTM training run identifier.")
        state = self._workspace_root() / str(run_id).strip()
        if not state.is_dir():
            raise ValueError("The requested LSTM training run was not found.")
        return ga_runner.RunPaths(
            root=self._state_root(),
            state=state,
            request=state / "request.json",
            snapshot=state / "snapshot.json",
            checkpoint=state / "checkpoint.json",
            status=state / "status.json",
            baseline=state / "baseline.json",
            evaluations=state / "evaluations.jsonl",
            leaderboard=state / "leaderboard.json",
            result=state / "result.json",
            log=state / "run.log",
            lock=state / "run.lock",
        )

    def _build_runner_args(self, ticker: str, period: str, seed: int) -> argparse.Namespace:
        return argparse.Namespace(
            ticker=ticker,
            period=period,
            duration_seconds=DEFAULT_DURATION_SECONDS,
            population_size=DEFAULT_POPULATION_SIZE,
            max_workers=min(MAX_WORKERS, max(1, (os.cpu_count() or 2) - 2)),
            ga_seed=seed,
            state_root=str(self._state_root()),
            offline=False,
            resume=False,
        )

    def _unique_seed(self, ticker: str, period: str) -> int:
        for _ in range(8):
            seed = secrets.randbelow(1_000_000_000)
            args = self._build_runner_args(ticker, period, seed)
            spec = ga_runner.build_request_spec(args)
            if not ga_runner.build_run_paths(args, spec).state.exists():
                return seed
        raise RuntimeError("Unable to allocate a unique LSTM training run.")

    def _read_run(self, state: Path) -> dict[str, Any]:
        request = self._read_json(state / "request.json")
        status = self._read_json(state / "status.json")
        launch = self._read_json(state / "launch.json")
        identity = request or launch
        result = self._read_json(state / "result.json")
        ticker = str(status.get("ticker") or request.get("ticker") or launch.get("ticker") or "")
        period = str(status.get("period") or request.get("period") or launch.get("period") or "")
        stored_status = str(status.get("status") or "").strip()
        pid = self._run_pid({**launch, **status})
        if stored_status in ACTIVE_STATUSES:
            effective_status = stored_status if self._process_matches(pid, identity) else "stale"
        elif stored_status:
            effective_status = stored_status
        elif pid and self._process_matches(pid, identity):
            effective_status = "starting"
        else:
            effective_status = "unknown"
        best = result.get("best") if isinstance(result.get("best"), Mapping) else status.get("best")
        if not isinstance(best, Mapping):
            best = None
        started_at = str(status.get("started_at") or launch.get("started_at") or "")
        updated_at = str(status.get("updated_at") or launch.get("started_at") or "")
        return {
            "id": state.name,
            "ticker": ticker,
            "period": period,
            "status": effective_status,
            "phase": str(status.get("phase") or effective_status),
            "active": effective_status in ACTIVE_STATUSES,
            "pid": pid,
            "started_at": started_at,
            "updated_at": updated_at,
            "completed_at": str(result.get("completed_at") or status.get("completed_at") or ""),
            "elapsed_seconds": status.get("elapsed_seconds"),
            "duration_seconds": status.get("duration_seconds") or request.get("duration_seconds"),
            "generation": status.get("generation"),
            "evaluated": status.get("evaluated") or result.get("evaluated"),
            "best": self._best_summary(best),
            "selected_params": request.get("selected_params", launch.get("selected_params")),
            "result_available": (state / "result.json").is_file(),
            "progress": self._progress_summary(status, effective_status),
            "files": self._training_files(state),
            "error": str(status.get("error") or "") or None,
        }

    @staticmethod
    def _progress_summary(status: Mapping[str, Any], effective_status: str) -> dict[str, Any]:
        progress = status.get("progress")
        summary: dict[str, Any] = {"percent": None}
        if isinstance(progress, Mapping):
            completed, total = progress.get("completed"), progress.get("total")
            if (
                type(completed) is int and type(total) is int
                and 0 <= completed <= total and total > 0
            ):
                percent = round(completed / total * 100, 1)
                if math.isfinite(percent):
                    summary = {"completed": completed, "total": total, "unit": "origins", "percent": percent}
        if effective_status == "completed":
            summary["percent"] = 100.0
        return summary

    @staticmethod
    def _training_files(state: Path) -> list[dict[str, Any]]:
        """Expose existing artifact names and sizes, never arbitrary paths or contents."""
        files = []
        for name in (
            "request.json", "snapshot.json", "checkpoint.json", "baseline.json",
            "evaluations.jsonl", "leaderboard.json", "result.json", "status.json", "run.log",
        ):
            path = state / name
            try:
                if not path.is_symlink() and path.is_file():
                    files.append({"name": name, "size_bytes": path.stat().st_size})
            except OSError:
                continue
        return files

    def _process_matches(self, pid: int | None, request: Mapping[str, Any]) -> bool:
        if not pid or pid <= 0:
            return False
        seed = str(request.get("ga_seed") or "").strip()
        if not seed:
            return False
        try:
            result = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                check=False,
                capture_output=True,
                text=True,
                timeout=1,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        command = result.stdout or ""
        return "lstm_ga_tune.py" in command and f"--ga-seed {seed}" in command

    @staticmethod
    def _run_pid(values: Mapping[str, Any]) -> int | None:
        try:
            pid = int(values.get("pid") or 0)
        except (TypeError, ValueError):
            return None
        return pid if pid > 0 else None

    @staticmethod
    def _normalize_ticker(ticker: str) -> str:
        normalized = str(ticker or "").strip().upper()
        if not TICKER_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid ticker before starting LSTM training.")
        return normalized

    @staticmethod
    def _normalize_period(period: str) -> str:
        normalized = str(period or "").strip().lower()
        if normalized not in PERIOD_OFFSETS:
            raise ValueError("Select a supported backtest period before starting LSTM training.")
        return normalized

    @staticmethod
    def _best_summary(best: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if not best:
            return None
        allowed = (
            "holdout_median_hit_rate_pct",
            "holdout_min_hit_rate_pct",
            "holdout_median_coverage_pct",
            "validation_median_probability_score_pct",
            "fitness",
        )
        summary = {key: best.get(key) for key in allowed if best.get(key) is not None}
        params = best.get("params")
        if isinstance(params, Mapping):
            summary["params"] = {
                str(key): value
                for key, value in params.items()
                if str(key) in {
                    "training_window",
                    "chip_window",
                    "lstm_lookback",
                    "lstm_hidden_size",
                    "lstm_epochs",
                    "lstm_learning_rate",
                }
                and isinstance(value, (str, int, float, bool))
            }
        return summary

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, path)

    @staticmethod
    def _remove_empty_state(state: Path) -> None:
        try:
            if state.is_dir() and not any(state.iterdir()):
                state.rmdir()
        except OSError:
            pass
