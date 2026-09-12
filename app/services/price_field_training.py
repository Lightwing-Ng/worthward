"""Strategy-neutral local probability-model training jobs. Code version: v1.1.3."""

from __future__ import annotations

from datetime import datetime, timezone
import math
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import time
from typing import Any

from app.core.config import PERIOD_OFFSETS
from app.infrastructure.compute_jobs import (
    assign_daily_run_identifiers,
    compute_workspace_lock,
    matching_run_directories,
    project_compute_workspace_root,
    read_json_object,
    write_json_atomic,
)
from app.infrastructure.storage import has_valid_ticker_format, normalize_ticker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_FAMILY = "neural-price-field-v1"
RUN_PATTERN = re.compile(r"^price-field-[a-f0-9]{24}$")
ACTIVE_STATUSES = frozenset({"starting", "running", "stopping"})
TRAINED_HORIZONS = tuple(range(1, 21))


class PriceFieldTrainingConflict(RuntimeError):
    """The requested job conflicts with an active or archived job."""


def completed_probability_score(diagnostics: object) -> float:
    """Require measured coverage of every trained horizon before durable completion."""
    if not isinstance(diagnostics, dict):
        raise ValueError("The training result has no measured probability-grid diagnostics.")
    score = diagnostics.get("probability_score_pct")
    if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 100:
        raise ValueError("The training result has no finite probability-grid score from 0 to 100.")
    horizons = diagnostics.get("horizons")
    if diagnostics.get("horizon_count") != len(TRAINED_HORIZONS) or not isinstance(horizons, dict):
        raise ValueError("Insufficient scoring window: all 20 trained horizons need observed outcomes.")
    valid_total, eligible_total, losses = 0, 0, []
    for horizon in TRAINED_HORIZONS:
        item = horizons.get(str(horizon))
        if not isinstance(item, dict):
            raise ValueError(f"Insufficient scoring window: horizon {horizon} has no measured diagnostics.")
        valid, eligible = item.get("valid_pairs"), item.get("eligible_pairs")
        if type(valid) is not int or type(eligible) is not int or not 0 < valid <= eligible:
            raise ValueError(f"Insufficient scoring window: horizon {horizon} needs a valid observed forecast.")
        loss = item.get("brier_loss")
        if type(loss) not in (int, float) or not math.isfinite(loss) or not 0 <= loss <= 1:
            raise ValueError(f"The training result has an invalid Brier loss for horizon {horizon}.")
        valid_total += valid
        eligible_total += eligible
        losses.append(loss)
    if diagnostics.get("valid_pairs") != valid_total or diagnostics.get("eligible_pairs") != eligible_total:
        raise ValueError("The training result has inconsistent measured forecast counts.")
    canonical_score = 100 * (1 - sum(losses) / len(TRAINED_HORIZONS))
    if not math.isclose(score, canonical_score, rel_tol=0, abs_tol=1e-7):
        raise ValueError("The training score does not match the equally weighted 20-horizon Brier loss.")
    return float(score)


def training_strategy(strategy_id: str):
    """Use the same enabled strategy registry as the Backtest selector."""
    from strategies.loader import instantiate_strategy

    strategy = instantiate_strategy(str(strategy_id))
    if getattr(strategy, "strategy_training_family", None) != TRAINING_FAMILY:
        raise ValueError("This strategy does not support probability-model training.")
    return strategy


def validate_parameters(strategy, raw: object) -> dict[str, Any]:
    """Reject malformed values before a process or compute directory is created."""
    if not isinstance(raw, dict):
        raise ValueError("Select the model parameters before starting training.")
    definitions = {item.key: item for item in strategy.get_parameter_definitions()}
    if set(raw) - definitions.keys():
        raise ValueError("Unknown probability-model parameter.")
    values = dict(raw)
    for key, value in values.items():
        definition = definitions[key]
        if definition.kind == "boolean":
            if not isinstance(value, (str, bool, int)) or str(value).lower() not in {
                "true", "false", "0", "1", "on", "off", "yes", "no",
            }:
                raise ValueError(f"Invalid value for {key}.")
        elif definition.kind in {"integer", "number"}:
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid value for {key}.") from exc
            if (isinstance(value, bool) or not math.isfinite(number)
                    or (definition.kind == "integer" and not number.is_integer())
                    or (definition.minimum is not None and number < definition.minimum)
                    or (definition.maximum is not None and number > definition.maximum)):
                raise ValueError(f"Invalid value for {key}.")
            values[key] = int(number) if definition.kind == "integer" else number
        elif definition.kind == "choice" and value not in definition.options:
            raise ValueError(f"Invalid value for {key}.")
    return strategy.normalize_params(values)


def read_json(path: Path) -> dict:
    """Compatibility wrapper for the shared compute-job JSON reader."""
    return read_json_object(path)


def write_json(path: Path, value: dict) -> None:
    """Compatibility wrapper for the shared compute-job JSON writer."""
    write_json_atomic(path, value)


def _workspace_lock(path: Path):
    """Retain the established private name for existing callers and tests."""
    return compute_workspace_lock(path)


class PriceFieldTrainingManager:
    """Own exact-configuration jobs independently of legacy LSTM tuning."""

    def __init__(self, state_root: Path | str | None = None):
        configured = state_root or os.environ.get("WORTHWARD_COMPUTE_ROOT")
        self.root = Path(configured).expanduser().resolve() if configured else (
            Path.home() / "Library/Application Support/Worthward/compute-jobs"
        )

    def workspace_root(self) -> Path:
        return project_compute_workspace_root(
            self.root,
            PROJECT_ROOT,
            "probability-models",
        )

    def _path(self, run_id: str) -> Path:
        if not RUN_PATTERN.fullmatch(str(run_id)):
            raise ValueError("Invalid probability training run identifier.")
        path = self.workspace_root() / run_id
        if path.is_symlink() or not path.is_dir() or path.resolve().parent != self.workspace_root().resolve():
            raise ValueError("The probability training run was not found.")
        return path

    def list_runs(self, strategy_id: str = "") -> list[dict]:
        if strategy_id:
            training_strategy(strategy_id)
        root = self.workspace_root()
        if not root.is_dir():
            return []
        paths = matching_run_directories(root, RUN_PATTERN)
        archive = root / ".deleted"
        archived = matching_run_directories(archive, RUN_PATTERN)
        runs = [self.read_run(path) for path in paths]
        assign_daily_run_identifiers(
            runs,
            [self.read_run(path) for path in archived],
            group_fields=("strategy", "ticker"),
        )
        return sorted([run for run in runs if not strategy_id or run["strategy"] == strategy_id],
                      key=lambda run: (run["started_at"], run["id"]), reverse=True)

    def start(self, strategy_id: str, ticker: str, period: str, params: object, *, interval: str, configuration: object = None) -> dict:
        from scripts.lstm_ga_tune import validate_training_configuration

        strategy = training_strategy(strategy_id)
        selected = validate_parameters(strategy, params)
        ticker = normalize_ticker(ticker)
        period = str(period).strip().lower()
        if not has_valid_ticker_format(ticker):
            raise ValueError("Enter a valid ticker before starting training.")
        if period not in PERIOD_OFFSETS:
            raise ValueError("Select a supported training period.")
        if interval != "1d":
            raise ValueError("Probability-model training requires Interval 1d.")
        settings = validate_training_configuration(configuration)
        root = self.workspace_root()
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink():
            raise ValueError("Invalid probability training workspace.")
        with _workspace_lock(root / "workspace.lock"):
            if any(run["active"] for run in self.list_runs()):
                raise PriceFieldTrainingConflict("A probability-model training run is already active. Stop it before starting another.")
            token = secrets.token_hex(16)
            path = root / f"price-field-{secrets.token_hex(12)}"
            path.mkdir()
            request = {"schema": 1, "strategy": strategy_id, "ticker": ticker, "period": period,
                       "interval": interval, "params": selected, "configuration": settings,
                       "run_token": token, "started_at": datetime.now(timezone.utc).isoformat()}
            write_json(path / "request.json", request)
            command = [sys.executable, "-B", str(PROJECT_ROOT / "scripts/price_field_train.py"),
                       "--request", str(path / "request.json"), "--run-token", token]
            with (path / "run.log").open("a", encoding="utf-8") as log:
                try:
                    process = subprocess.Popen(command, cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL,
                                               stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                except OSError as exc:
                    write_json(path / "status.json", {"status": "failed", "error": str(exc)})
                    raise
            write_json(path / "launch.json", {"pid": process.pid, "started_at": request["started_at"]})
            return {**self.read_run(path), "status": "starting", "active": True}

    @staticmethod
    def process_matches(pid: int, path: Path, token: str) -> bool:
        if not pid or not token:
            return False
        command = ["ps", "-p", str(pid), "-o", "command="]
        if os.name == "nt":
            command = ["powershell", "-NoProfile", "-NonInteractive", "-Command",
                       f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=2, check=False)
            return ("price_field_train.py" in result.stdout and str(path / "request.json") in result.stdout
                    and token in result.stdout)
        except (OSError, subprocess.SubprocessError):
            return False

    def stop(self, run_id: str) -> dict:
        path = self._path(run_id)
        run = self.read_run(path)
        if not run["active"]:
            return run
        request = read_json(path / "request.json")
        pid = run["pid"]
        if not self.process_matches(pid, path, request.get("run_token", "")):
            return {**run, "active": False, "status": "stale"}
        write_json(path / "stop-request.json", {"requested_at": datetime.now(timezone.utc).isoformat()})
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=True, capture_output=True, timeout=5)
            else:
                if os.getpgid(pid) != pid:
                    raise RuntimeError("Training process-group ownership could not be verified.")
                os.killpg(pid, signal.SIGTERM)
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline and self.process_matches(pid, path, request["run_token"]):
                    time.sleep(0.1)
                if self.process_matches(pid, path, request["run_token"]) and os.getpgid(pid) == pid:
                    os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        status = read_json(path / "status.json")
        if status.get("status") != "completed":
            write_json(path / "status.json", {**status, "status": "stopped", "updated_at": datetime.now(timezone.utc).isoformat()})
        return self.read_run(path)

    def delete(self, run_id: str) -> dict:
        path = self._path(run_id)
        with _workspace_lock(self.workspace_root() / "workspace.lock"):
            if self.read_run(path)["active"]:
                raise PriceFieldTrainingConflict("Stop training before deleting this run.")
            archive = path.parent / ".deleted"
            if archive.is_symlink():
                raise ValueError("Invalid training archive path.")
            archive.mkdir(exist_ok=True)
            if (archive / path.name).exists():
                raise PriceFieldTrainingConflict("A recoverable archive already exists for this run.")
            path.rename(archive / path.name)
        return {"id": run_id, "deleted": True, "recoverable": True}

    def read_run(self, path: Path) -> dict:
        request = read_json(path / "request.json")
        launch = read_json(path / "launch.json")
        status = read_json(path / "status.json")
        result = read_json(path / "result.json")
        pid = launch.get("pid")
        pid = pid if type(pid) is int and pid > 0 else 0
        effective = status.get("status", "starting")
        if effective in ACTIVE_STATUSES and not self.process_matches(pid, path, request.get("run_token", "")):
            effective = "stale"
        completed = effective == "completed" and result.get("status") == "completed"
        if effective == "completed" and not completed:
            effective = "failed"
        diagnostics = result.get("diagnostics", {}) if completed else {}
        if not isinstance(diagnostics, dict):
            diagnostics = {}
        score, completion_error = None, None
        if completed:
            try:
                score = completed_probability_score(diagnostics)
            except ValueError as exc:
                completed = False
                effective = "failed"
                completion_error = str(exc)
                diagnostics = {}
        configuration = self.saved_configuration(request, result) if completed else None
        if completed and configuration is None:
            completed = False
            effective = "failed"
            score = None
            completion_error = "The completed record has no valid matching configuration."
        progress = status.get("progress", {"percent": None})
        if completed:
            progress = {"percent": 100.0}
        files = [{"name": name, "size_bytes": target.stat().st_size}
                 for name in ("request.json", "snapshot.json", "result.json", "status.json", "run.log")
                 if (target := path / name).is_file() and not target.is_symlink()]
        return {"id": path.name, "strategy": request.get("strategy", ""), "ticker": request.get("ticker", ""),
                "period": request.get("period", ""), "interval": request.get("interval", ""), "status": effective,
                "active": effective in ACTIVE_STATUSES, "pid": pid, "started_at": request.get("started_at", ""),
                "updated_at": status.get("updated_at", ""), "completed_at": result.get("completed_at", "") if completed else "",
                "phase": effective if completion_error else status.get("phase", effective), "progress": progress, "configuration": configuration,
                "configuration_error": None if configuration else completion_error or "No completed configuration is available for this run.",
                "probability_score_pct": score, "probability_score_label": "Complete-grid probability score",
                "accuracy_pct": None, "device": result.get("device"), "selected_params": request.get("params"),
                "diagnostics": diagnostics, "result_available": completed, "files": files,
                "error": status.get("error") or completion_error or
                         ("Training worker exited before recording completion." if effective == "stale" else None)}

    @staticmethod
    def saved_configuration(request: dict, result: dict) -> dict | None:
        """Only restore a complete configuration belonging to this exact job."""
        from scripts.lstm_ga_tune import validate_training_configuration

        configuration = result.get("configuration")
        if not isinstance(configuration, dict) or not isinstance(configuration.get("params"), dict):
            return None
        if any(configuration.get(key) != request.get(key) for key in ("strategy", "ticker", "period", "interval")):
            return None
        if configuration.get("range") != "exact" or configuration.get("interval") != "1d":
            return None
        try:
            strategy = training_strategy(request["strategy"])
            if not {item.key for item in strategy.get_parameter_definitions()}.issubset(configuration["params"]):
                return None
            params = validate_parameters(strategy, configuration["params"])
            if params != request.get("params"):
                return None
            settings = validate_training_configuration(configuration)
        except (KeyError, TypeError, ValueError):
            return None
        return {**settings, **{key: configuration[key] for key in ("strategy", "ticker", "period", "interval")}, "params": params}
