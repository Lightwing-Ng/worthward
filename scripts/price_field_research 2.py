"""Frozen-input neural probability research coordinator. Code version: v1.1.1.

Search, replicated validation selection, and reporting have separate data
boundaries. This process never fetches data or updates production settings.
Run under the independent process-group supervisor for a hard wall deadline.
"""

from __future__ import annotations

import argparse
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import multiprocessing
from multiprocessing.connection import wait as wait_for_processes
import os
from pathlib import Path
import random
import signal
import sys
import time
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
def _configure_process_environment() -> None:
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        os.environ[name] = "1"
    os.environ["WORTHWARD_REMOTE_MARKET_ACCESS"] = "disabled"
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"


if __name__ == "__main__":
    _configure_process_environment()

import numpy as np  # noqa: E402 - Numerical runtimes must see worker thread limits first.
import pandas as pd  # noqa: E402

PROTOCOL_VERSION = "neural-probability-research/v1.1.0"
ROBUST_SEEDS = (42, 101, 202)
WARMUP = 128
SEARCH_CHOICES = {
    "training_window": (126, 168, 252), "lookback": (16, 24, 32, 48),
    "hidden_size": (16, 32, 48), "epochs": (4, 8, 16, 24),
    "learning_rate": (0.0003, 0.0006, 0.001, 0.003),
    "retrain_interval": (10, 20), "weight_decay": (0.0001, 0.001, 0.01),
    "dropout": (0.0, 0.1, 0.2), "chip_window": (21, 42, 63, 84),
}
_STOP = False
_WORKER_STOP_EVENT = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic(path: Path, payload: Any) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, allow_nan=False, default=str) + "\n")
    os.replace(temporary, path)


def _append(path: Path, payload: Any) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, allow_nan=False, default=str) + "\n")
        stream.flush()


def _signal_stop(_signum: int, _frame: Any) -> None:
    global _STOP
    _STOP = True


def clip_bundle(bundle: dict[str, Any], cutoff: pd.Timestamp) -> dict[str, Any]:
    """Physically remove every dated observation after the training boundary."""
    result = deepcopy(bundle)
    for key, value in result.items():
        if isinstance(value, list):
            result[key] = [row for row in value if not isinstance(row, dict) or "observed_at" not in row
                           or pd.Timestamp(row["observed_at"]).date() <= cutoff.date()]
        elif key == "benchmarks" and isinstance(value, dict):
            result[key] = {
                symbol: [row for row in rows if pd.Timestamp(row["observed_at"]).date() <= cutoff.date()]
                for symbol, rows in value.items()
            }
    result["end"] = cutoff.isoformat()
    return result


def validation_folds(count: int, *, smoke: bool = False) -> tuple[int, list[tuple[int, int]]]:
    """Leave the final approximately 100 real sessions outside all selection."""
    holdout = count - min(100, count // 4) if smoke else count - max(80, min(100, count // 5))
    warmup = 64 if smoke else WARMUP
    boundaries = np.linspace(warmup, holdout, 4, dtype=int).tolist()
    if boundaries[1] - boundaries[0] < (22 if smoke else 40):
        raise ValueError("Insufficient real daily history for three complete validation folds.")
    return holdout, list(zip(boundaries[:-1], boundaries[1:], strict=True))


def _load_snapshot(path: Path, *, smoke: bool = False) -> dict[str, Any]:
    from strategies.price_field_pipeline import bundle_to_price_field_ohlcv

    payload = json.loads(path.read_text())
    if payload.get("interval") != "1d":
        raise ValueError("Probability research requires a frozen 1d snapshot.")
    bundle = deepcopy(payload["bundle"])
    bundle.setdefault("benchmarks", {})
    for symbol in ("SPY", "QQQ", "SMH"):
        sibling = path.with_name(symbol + ".json")
        if sibling.is_file():
            bundle["benchmarks"][symbol] = json.loads(sibling.read_text())["bundle"]["ohlcv"]
    if smoke:
        # Remove the real holdout before frame construction or feature evaluation.
        rows = bundle.get("ohlcv") or []
        bundle["ohlcv"] = rows[:min(400, max(0, len(rows) - 100))]
        if not bundle["ohlcv"]:
            raise ValueError("The smoke snapshot needs sufficient historical observations.")
        bundle = clip_bundle(bundle, pd.Timestamp(bundle["ohlcv"][-1]["observed_at"]))
    frame = bundle_to_price_field_ohlcv(bundle)
    return {"ticker": payload["ticker"], "frame": frame, "bundle": bundle}


def _strategy_ids(requested: list[str] | None = None) -> tuple[str, ...]:
    from strategies.loader import instantiate_strategy, list_enabled_strategies
    from strategies.neural_price_field_registry import LEGACY_NEURAL_STRATEGY_IDS

    candidates = set()
    for entry in list_enabled_strategies():
        strategy = instantiate_strategy(entry["id"])
        if getattr(strategy, "strategy_training_family", None) == "neural-price-field-v1":
            candidates.add(entry["id"])
    selected = tuple(requested) if requested is not None else tuple(sorted(LEGACY_NEURAL_STRATEGY_IDS))
    if not selected or len(set(selected)) != len(selected):
        raise ValueError("Research strategies must be a nonempty unique list.")
    if unknown := set(selected) - candidates:
        raise ValueError(f"Unsupported neural research strategies: {', '.join(sorted(unknown))}")
    return selected


def factor_eligibility(frame: pd.DataFrame, bundle: dict[str, Any], strategy: Any) -> dict[str, Any]:
    """Inspect only the supplied validation prefix, never a final report frame."""
    from strategies.neural_price_field_inputs import factor_values_for_neural
    from strategies.price_field_pipeline import PRICE_FIELD_FACTOR_DEFINITIONS

    params = strategy.get_default_params()
    definitions = [item for item in strategy.get_parameter_definitions() if item.group == "factors"]
    params.update({item.key: True for item in definitions})
    prepared, factors, _bundle = factor_values_for_neural(frame, bundle, params)
    returns = pd.to_numeric(prepared["Close"], errors="coerce").apply(np.log).diff().to_numpy()
    audit = {}
    factor_keys = {item.parameter_key: item.key for item in PRICE_FIELD_FACTOR_DEFINITIONS}
    for definition in definitions:
        factor_key = factor_keys.get(definition.key, definition.key.removeprefix("use_"))
        values = np.asarray(factors.get(factor_key, np.full(len(frame), np.nan)), dtype=float)
        finite = values[np.isfinite(values)]
        count = len(finite)
        duplicate = len(values) == len(returns) and np.allclose(values, returns, equal_nan=True, atol=1e-14, rtol=1e-12)
        eligible = count >= 40 and float(np.ptp(finite)) > 1e-12 and not duplicate
        reason = "eligible" if eligible else "duplicate endogenous return" if duplicate else "fewer than 40 finite observations" if count < 40 else "constant observations"
        audit[definition.key] = {"eligible": eligible, "finite_count": count, "reason": reason, "label": definition.label}
    return audit


def _candidate_key(strategy_id: str, params: dict[str, Any], *, omit_seed: bool = False) -> str:
    identity = {key: value for key, value in params.items() if not omit_seed or key != "seed"}
    return hashlib.sha256(json.dumps([strategy_id, identity], sort_keys=True).encode()).hexdigest()


def _rank(result: dict[str, Any]) -> tuple[Any, ...]:
    return (bool(result.get("feasible")), float(result.get("fitness", -math.inf)),
            float(result.get("worst_fold", -math.inf)), -sum(bool(value) for key, value in result.get("params", {}).items() if key.startswith("use_")))


def _compact(score: dict[str, Any]) -> dict[str, Any]:
    return {**{key: score[key] for key in ("probability_score_pct", "brier_loss", "brier_skill_score", "coverage_pct", "horizon_count", "eligible_pairs", "valid_pairs", "next_day")},
            "minimum_horizon_coverage_pct": min((item["coverage_pct"] for item in score["horizons"].values()), default=0.0)}


def _score_feasible(score: dict[str, Any]) -> bool:
    return bool(score["coverage_pct"] >= 95 and score["horizon_count"] == 20
                and score["probability_score_pct"] is not None
                and all(item["coverage_pct"] >= 95 and item["valid_pairs"] > 0 for item in score["horizons"].values()))


def _worker_init(stop_event=None) -> None:
    global _WORKER_STOP_EVENT
    _WORKER_STOP_EVENT = stop_event
    signal.signal(signal.SIGTERM, _signal_stop)
    signal.signal(signal.SIGINT, _signal_stop)
    # The application's canonical import order resolves shared provider modules.
    __import__("app")
    import torch

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)


def _worker_cancelled(task: dict[str, Any]) -> bool:
    return bool(_STOP or (_WORKER_STOP_EVENT is not None and _WORKER_STOP_EVENT.is_set())
                or time.monotonic() >= task["deadline"] or Path(task["stop_file"]).exists())


def _child_is_running(child: Any) -> bool:
    # The executor manager also joins these processes. Its cached exit status
    # can race a concurrent join; the OS sentinel is the completion authority.
    return not bool(wait_for_processes([child.sentinel], timeout=0))


def _shutdown_owned_workers(pools: list[Any], previous_children: set[int], *, grace_seconds: float = 5.0) -> dict[str, Any]:
    """Bound cleanup to children created by this dedicated research coordinator.

    The coordinator is a standalone process, so children present before its
    pools were created are explicitly excluded. No user process, sibling task,
    application server, or system service is selected by name or process group.
    """
    children = [child for child in multiprocessing.active_children() if child.pid not in previous_children]
    for pool in pools:
        pool.shutdown(wait=False, cancel_futures=True)
    deadline = time.monotonic() + grace_seconds
    for child in children:
        child.join(timeout=max(0.0, deadline - time.monotonic()))
    terminated = [child for child in children if _child_is_running(child)]
    for child in terminated:
        child.terminate()
    deadline = time.monotonic() + min(2.0, grace_seconds)
    for child in terminated:
        child.join(timeout=max(0.0, deadline - time.monotonic()))
    killed = [child for child in terminated if _child_is_running(child)]
    for child in killed:
        child.kill()
    deadline = time.monotonic() + 2.0
    for child in killed:
        child.join(timeout=max(0.0, deadline - time.monotonic()))
    survivors = [child.pid for child in children if _child_is_running(child)]
    if survivors:
        raise RuntimeError(f"Owned research workers did not exit after bounded cleanup: {survivors}")
    return {"owned_pids": [child.pid for child in children], "terminated_pids": [child.pid for child in terminated],
            "killed_pids": [child.pid for child in killed], "surviving_pids": []}


def evaluate_candidate(task: dict[str, Any]) -> dict[str, Any]:
    """Run one candidate against physically restricted inputs or frozen reporting."""
    from strategies.loader import instantiate_strategy
    from strategies.neural_price_field_scoring import score_neural_price_field

    started = time.monotonic()
    record = {key: task[key] for key in ("strategy_id", "params", "phase", "ticker")}
    record["role"] = task.get("role", "candidate")
    record["candidate_key"] = _candidate_key(task["strategy_id"], task["params"])
    try:
        strategy = instantiate_strategy(task["strategy_id"])
        strategy._warmup_bundle = task["bundle"]
        strategy.training_cancel = lambda: _worker_cancelled(task)
        result = strategy.compute_signals(task["frame"], task["params"])
        device = result.presentation.get("device", {})
        resolved = str(device.get("resolved", "")).lower()
        expected = {"mps", "cuda"} if task["params"]["compute_backend"] == "GPU" else {"cpu"}
        if resolved not in expected or device.get("runtime_fallback"):
            raise RuntimeError(f"Unexpected training backend: {resolved}")
        scores = [score_neural_price_field(result.frame, start, end) for start, end in task["folds"]]
        feasible = all(_score_feasible(item) for item in scores)
        values = [item["probability_score_pct"] for item in scores if item["probability_score_pct"] is not None]
        record.update(status="ok", feasible=feasible, fitness=float(np.mean(values)) if values else -1.0,
                      worst_fold=float(min(values)) if values else -1.0,
                      folds=scores if task.get("full_report") else [_compact(item) for item in scores], device=device)
    except Exception as exc:
        record.update(status="cancelled" if _worker_cancelled(task) else "failed",
                      feasible=False, fitness=-1.0, worst_fold=-1.0, error=f"{type(exc).__name__}: {exc}")
    record["elapsed_seconds"] = time.monotonic() - started
    record["finished_at"] = _now()
    return record


def _new_params(rng: random.Random, defaults: dict[str, Any], eligible: list[str], leaders: list[dict[str, Any]], backend: str,
                domains: dict[str, tuple] | None = None) -> dict[str, Any]:
    domains = SEARCH_CHOICES if domains is None else domains
    params = dict(defaults)
    parents = sorted((item for item in leaders if item.get("feasible")), key=_rank, reverse=True)[:24]
    if parents and rng.random() > 0.20:
        first, second = rng.choice(parents)["params"], rng.choice(parents)["params"]
        params.update({key: first[key] if rng.random() < 0.5 else second[key] for key in first})
        for key, choices in domains.items():
            if rng.random() < 0.20:
                params[key] = rng.choice(choices)
        for key in eligible:
            if rng.random() < 0.12:
                params[key] = not bool(params[key])
    else:
        params.update({key: rng.choice(choices) for key, choices in domains.items()})
        params.update({key: rng.random() < 0.35 for key in eligible})
    params["compute_backend"], params["seed"] = backend, 42
    return params


def replicated_selection(records: list[dict[str, Any]], strategy_ids: tuple[str, ...], seeds: tuple[int, ...]) -> dict[str, Any]:
    """Freeze exactly one validation winner per architecture without holdout access."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        groups.setdefault(_candidate_key(record["strategy_id"], record["params"], omit_seed=True), []).append(record)
    selected = {}
    for strategy_id in strategy_ids:
        eligible = []
        for rows in groups.values():
            if rows[0]["strategy_id"] != strategy_id or {row["params"]["seed"] for row in rows} != set(seeds) or len(rows) != len(seeds):
                continue
            if not all(row.get("feasible") and row.get("status") == "ok" for row in rows):
                continue
            values = [row["fitness"] for row in rows]
            eligible.append({"strategy_id": strategy_id, "params": rows[0]["params"], "mean_validation_score_pct": float(np.mean(values)),
                             "seed_stddev": float(np.std(values)), "seed_results": rows})
        if not eligible:
            raise RuntimeError(f"No complete feasible replicated validation candidate for {strategy_id}.")
        selected[strategy_id] = max(eligible, key=lambda item: (item["mean_validation_score_pct"], -item["seed_stddev"]))
    return selected


def endogenous_ablation_summary(selected: dict[str, Any], records: list[dict[str, Any]],
                                seeds: tuple[int, ...]) -> dict[str, Any]:
    """Report paired validation deltas without changing the frozen selection."""
    ablated = replicated_selection(records, tuple(selected), seeds)
    comparison = {}
    for strategy_id, winner in selected.items():
        baseline = ablated[strategy_id]
        selected_scores = {row["params"]["seed"]: row["fitness"] for row in winner["seed_results"]}
        baseline_scores = {row["params"]["seed"]: row["fitness"] for row in baseline["seed_results"]}
        deltas = {str(seed): selected_scores[seed] - baseline_scores[seed] for seed in seeds}
        comparison[strategy_id] = {
            "removed_factors": [key for key, value in winner["params"].items() if key.startswith("use_") and value],
            "selected_validation_score_pct": winner["mean_validation_score_pct"],
            "endogenous_only_validation_score_pct": baseline["mean_validation_score_pct"],
            "selected_minus_endogenous_only_points": float(np.mean(list(deltas.values()))),
            "paired_seed_deltas": deltas, "endogenous_only_seed_results": baseline["seed_results"],
        }
    return {"status": "completed", "method": "three-seed endogenous-only validation ablation",
            "selection_unchanged": True, "by_strategy": comparison,
            "group_removals": {"status": "not_run", "reason": "Budget reserved for replicated model comparison and transfer reporting."}}


def finalization_reserve(gpu_times: list[float], full_bars: int, validation_bars: int, *,
                         model_count: int = 4, search_backends: int = 2, final_workers: int = 1) -> float:
    """Reserve measured work for replications, ablation, and all four report tickers.

    Defaults retain the original 132-fit bound. CPU-only experiments use their
    own measured CPU latency and actual parallelism, never GPU throughput.
    """
    if min(model_count, search_backends, final_workers) < 1:
        raise ValueError("Finalization model, backend, and worker counts must be positive.")
    size_ratio = max(1.0, full_bars / max(1, validation_bars))
    fits = model_count * ((2 * search_backends + 1) * len(ROBUST_SEEDS) + 6 * len(ROBUST_SEEDS))
    estimate = math.ceil(fits / final_workers) * float(np.quantile(gpu_times[-256:], 0.90)) * 1.50 * size_ratio if gpu_times else 0.0
    return max(900.0, estimate)


class ResearchRun:
    """Own scheduling, durable evidence, and cooperative cancellation boundaries."""

    def __init__(self, args: argparse.Namespace):
        from strategies.loader import instantiate_strategy
        from strategies.neural_price_field_registry import research_choices

        self.args = args
        self.cpu_only = bool(getattr(args, "cpu_only", False))
        self.search_backends = ("CPU",) if self.cpu_only else ("CPU", "GPU")
        self.final_backend = "CPU" if self.cpu_only else "GPU"
        self.final_workers = args.cpu_workers if self.cpu_only else 1
        self.output = Path(args.output).resolve()
        if self.output.exists() and any(self.output.iterdir()):
            raise ValueError("Output already contains evidence; automatic resume or overwrite is forbidden.")
        self.output.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic()
        self.started_at = _now()
        started_utc = datetime.fromisoformat(self.started_at)
        deadline_utc = datetime.fromisoformat(args.deadline.replace("Z", "+00:00")) if args.deadline else None
        remaining = (deadline_utc - started_utc).total_seconds() if deadline_utc else args.seconds
        if remaining is None or not math.isfinite(remaining) or remaining <= 0:
            raise ValueError("The research deadline must be in the future.")
        deadline_utc = deadline_utc or started_utc + timedelta(seconds=remaining)
        self.deadline = self.started + remaining
        self.snapshot_path = Path(args.snapshot).resolve()
        self.data = _load_snapshot(self.snapshot_path, smoke=args.smoke)
        self.holdout, self.folds = validation_folds(len(self.data["frame"]), smoke=args.smoke)
        self.prefix_frame = self.data["frame"].iloc[:self.holdout].copy()
        self.prefix_bundle = clip_bundle(self.data["bundle"], pd.Timestamp(self.prefix_frame["Date"].iloc[-1]))
        requested = getattr(args, "strategy_id", None)
        self.ids = _strategy_ids(requested) if requested is not None else _strategy_ids()
        self.domains = {strategy_id: research_choices(strategy_id, SEARCH_CHOICES) for strategy_id in self.ids}
        self.defaults, self.factor_audit, self.eligible = {}, {}, {}
        for strategy_id in self.ids:
            strategy = instantiate_strategy(strategy_id)
            self.defaults[strategy_id] = strategy.get_default_params()
            audit = factor_eligibility(self.prefix_frame, self.prefix_bundle, strategy)
            self.factor_audit[strategy_id] = audit
            self.eligible[strategy_id] = [key for key, value in audit.items() if value["eligible"]]
            # Factors lacking training-prefix evidence stay disabled for every candidate.
            self.defaults[strategy_id].update({key: bool(self.defaults[strategy_id].get(key)) and value["eligible"] for key, value in audit.items()})
        self.rng = random.Random(20260907)
        self.leaders = {(strategy_id, backend): [] for strategy_id in self.ids for backend in ("CPU", "GPU")}
        self.counts = {backend: 0 for backend in ("CPU", "GPU")}
        self.failures = 0
        self.cancelled_counts = {backend: 0 for backend in ("CPU", "GPU")}
        self.consecutive_failures = {backend: 0 for backend in ("CPU", "GPU")}
        self.gpu_times: list[float] = []
        self.phase = "initializing"
        self.seen: set[str] = set()
        self.candidate_collisions = 0
        self.last_status = 0.0
        self.manifest = {
            "protocol": PROTOCOL_VERSION, "started_at": self.started_at,
            "deadline_utc": deadline_utc.astimezone(timezone.utc).isoformat(),
            "snapshot": str(self.snapshot_path), "snapshot_sha256": hashlib.sha256(self.snapshot_path.read_bytes()).hexdigest(),
            "input_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(self.snapshot_path.parent.glob("*.json"))},
            "ticker": self.data["ticker"], "bars": len(self.data["frame"]), "holdout_start": self.holdout,
            "validation_folds": self.folds, "strategies": self.ids,
            "search_choices": SEARCH_CHOICES, "strategy_search_choices": self.domains, "factor_audit": self.factor_audit,
            "seeds": ROBUST_SEEDS, "cpu_workers": args.cpu_workers, "gpu_workers": 0 if self.cpu_only else 1,
            "search_backends": self.search_backends, "final_backend": self.final_backend,
            "final_workers": self.final_workers,
            "selection": f"equal-fold complete-grid score; replicated {self.final_backend} validation; holdout excluded",
            "smoke": args.smoke,
        }
        _atomic(self.output / "protocol.json", self.manifest)

    def cancelled(self) -> bool:
        return _STOP or (self.output / "STOP").exists() or time.monotonic() >= self.deadline

    def verify_inputs(self) -> None:
        for name, expected in self.manifest["input_sha256"].items():
            path = self.snapshot_path.parent / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Frozen research input changed during the run: {name}")

    def status(self, state: str = "running", *, force: bool = False, **extra: Any) -> None:
        if not force and time.monotonic() - self.last_status < 15:
            return
        self.last_status = time.monotonic()
        payload = {"protocol": PROTOCOL_VERSION, "status": state, "phase": self.phase,
                   "updated_at": _now(), "started_at": self.started_at,
                   "deadline_utc": self.manifest["deadline_utc"], "pid": os.getpid(),
                   "evaluations": sum(self.counts.values()), "backend_counts": self.counts,
                   "failures": self.failures, "cancelled_counts": self.cancelled_counts,
                   "candidate_collisions": self.candidate_collisions,
                   "elapsed_seconds": time.monotonic() - self.started, **extra}
        _atomic(self.output / "status.json", payload)
        _atomic(self.output / "checkpoint.json", {**payload, "leaders": {f"{key[0]}:{key[1]}": rows for key, rows in self.leaders.items()},
                                                 "random_state": self.rng.getstate(), "resumable": False})

    def record(self, result: dict[str, Any]) -> None:
        backend = result["params"]["compute_backend"]
        self.counts[backend] += 1
        self.failures += int(result["status"] == "failed")
        self.cancelled_counts[backend] += int(result["status"] == "cancelled")
        self.consecutive_failures[backend] = self.consecutive_failures[backend] + 1 if result["status"] == "failed" else 0
        _append(self.output / "evaluations.jsonl", result)
        if backend == self.final_backend and result["status"] == "ok":
            self.gpu_times.append(float(result["elapsed_seconds"]))
        if self.consecutive_failures[backend] >= 5:
            raise RuntimeError(f"Five consecutive {backend} evaluations failed; inspect preserved errors.")
        self.status()

    def task(self, strategy_id: str, params: dict[str, Any], *, data: dict[str, Any] | None = None,
             folds: list[tuple[int, int]] | None = None, deadline: float | None = None, full: bool = False) -> dict[str, Any]:
        return {"strategy_id": strategy_id, "params": params, "phase": self.phase,
                "ticker": data["ticker"] if data else self.data["ticker"],
                "frame": data["frame"] if data else self.prefix_frame,
                "bundle": data["bundle"] if data else self.prefix_bundle,
                "folds": folds if folds is not None else self.folds,
                "deadline": deadline if deadline is not None else self.deadline,
                "stop_file": str(self.output / "STOP"), "full_report": full}

    def batch(self, pool: ProcessPoolExecutor, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        pending, results = {}, []
        iterator = iter(tasks)
        exhausted = False
        while pending or not exhausted:
            if self.cancelled():
                raise RuntimeError("Research cancelled or deadline reached; final report is incomplete.")
            while len(pending) < self.final_workers and not exhausted:
                task = next(iterator, None)
                if task is None:
                    exhausted = True
                else:
                    pending[pool.submit(evaluate_candidate, task)] = task
            done, _ = wait(pending, timeout=1, return_when=FIRST_COMPLETED) if pending else (set(), set())
            for future in done:
                pending.pop(future)
                result = future.result()
                self.record(result)
                results.append(result)
            self.status()
        return results

    def unseen_candidate(self, strategy_id: str, backend: str) -> dict[str, Any] | None:
        """Keep ordinary GA collisions from masquerading as search completion."""
        leaders = self.leaders[(strategy_id, backend)]
        for attempt in range(128):
            parents = leaders if attempt < 16 else []
            params = dict(self.defaults[strategy_id]) if not leaders and attempt == 0 else _new_params(
                self.rng, self.defaults[strategy_id], self.eligible[strategy_id], parents, backend, self.domains[strategy_id],
            )
            params.update(compute_backend=backend, seed=42)
            if self.args.smoke:
                params.update(lookback=8, hidden_size=8, epochs=1, retrain_interval=63)
            key = _candidate_key(strategy_id, params)
            if key not in self.seen:
                self.seen.add(key)
                return params
            self.candidate_collisions += 1
        return None

    def run(self) -> None:
        mp_context = multiprocessing.get_context("spawn")
        self.worker_stop = mp_context.Event()
        previous_children = {child.pid for child in multiprocessing.active_children()}
        pools = []
        try:
            cpu_pool = ProcessPoolExecutor(max_workers=self.args.cpu_workers, mp_context=mp_context,
                                           initializer=_worker_init, initargs=(self.worker_stop,))
            pools.append(cpu_pool)
            gpu_pool = cpu_pool
            if not self.cpu_only:
                gpu_pool = ProcessPoolExecutor(max_workers=1, mp_context=mp_context,
                                               initializer=_worker_init, initargs=(self.worker_stop,))
                pools.append(gpu_pool)
            self._run_with_pools(cpu_pool, gpu_pool)
        except BaseException as exc:
            self.worker_stop.set()
            state = "interrupted" if _STOP or (self.output / "STOP").exists() else "incomplete" if time.monotonic() >= self.deadline else "failed"
            self.status(state, force=True, error=f"{type(exc).__name__}: {exc}")
            raise
        finally:
            self.worker_stop.set()
            try:
                cleanup = _shutdown_owned_workers(pools, previous_children)
                _atomic(self.output / "worker-cleanup.json", {**cleanup, "completed_at": _now()})
            except BaseException as exc:
                self.status("failed", force=True, error=f"Worker cleanup failed: {type(exc).__name__}: {exc}")
                raise
        if self.cancelled():
            raise RuntimeError("Research cancelled or deadline reached before final completion.")
        payload = self.pending_result
        payload.update(status="completed", completed_at=_now())
        _atomic(self.output / ("smoke.json" if self.args.smoke else "result.json"), payload)
        self.phase = "completed"
        self.status("completed", force=True)

    def _run_with_pools(self, cpu_pool: ProcessPoolExecutor, gpu_pool: ProcessPoolExecutor) -> None:
        self.phase = "search"
        self.status(force=True)
        pending: dict[Any, tuple[str, str]] = {}
        rotations = {backend: 0 for backend in ("CPU", "GPU")}
        slots = {"CPU": self.args.cpu_workers, "GPU": 0 if self.cpu_only else 1}
        search_deadline = min(self.deadline, self.started + 30) if self.args.smoke else self.deadline - 900
        while not self.cancelled():
            # Selection is frozen before ablation and all held-out reporting.
            reserve = finalization_reserve(
                self.gpu_times, len(self.data["frame"]), len(self.prefix_frame),
                model_count=len(self.ids), search_backends=len(self.search_backends), final_workers=self.final_workers,
            )
            if not self.args.smoke:
                # Re-estimate in both directions so one cold graph compilation
                # does not permanently strand an hour of the research budget.
                search_deadline = self.deadline - reserve
            scheduling = time.monotonic() < search_deadline
            for backend, pool in (("CPU", cpu_pool), ("GPU", gpu_pool)):
                while scheduling and sum(value[1] == backend for value in pending.values()) < slots[backend]:
                    strategy_id = self.ids[rotations[backend] % len(self.ids)]
                    rotations[backend] += 1
                    params = self.unseen_candidate(strategy_id, backend)
                    if params is None:
                        break
                    pending[pool.submit(evaluate_candidate, self.task(strategy_id, params, deadline=search_deadline))] = (strategy_id, backend)
            if not pending:
                if not scheduling:
                    break
                self.status(search_wait="candidate-collisions")
                time.sleep(0.1)
                continue
            done, _ = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
            for future in done:
                group = pending.pop(future)
                result = future.result()
                self.record(result)
                if result["status"] == "ok":
                    self.leaders[group] = sorted([*self.leaders[group], result], key=_rank, reverse=True)[:128]
            self.status()
            if self.args.smoke and all(self.leaders[(strategy_id, backend)] for strategy_id in self.ids for backend in self.search_backends):
                search_deadline = time.monotonic()
        if self.cancelled():
            raise RuntimeError("Research cancelled or deadline reached during search.")
        self.phase = "replicated-validation"
        self.status(force=True)
        seeds = (42,) if self.args.smoke else ROBUST_SEEDS
        candidates: dict[str, tuple[str, dict[str, Any]]] = {}
        for strategy_id in self.ids:
            for backend in self.search_backends:
                for row in self.leaders[(strategy_id, backend)][:1 if self.args.smoke else 2]:
                    params = dict(row["params"], compute_backend=self.final_backend)
                    candidates[_candidate_key(strategy_id, params, omit_seed=True)] = (strategy_id, params)
            params = dict(self.defaults[strategy_id], compute_backend=self.final_backend)
            if self.args.smoke:
                params.update(lookback=8, hidden_size=8, epochs=1, retrain_interval=63)
            candidates[_candidate_key(strategy_id, params, omit_seed=True)] = (strategy_id, params)
        tasks = [self.task(strategy_id, dict(params, seed=seed)) for strategy_id, params in candidates.values() for seed in seeds]
        replications = self.batch(gpu_pool, tasks)
        selected = replicated_selection(replications, self.ids, seeds)
        selection = {"protocol": PROTOCOL_VERSION, "selected_at": _now(), "selection_basis": "validation only", "winners": selected}
        _atomic(self.output / "selection.json", selection)
        ablation = {"status": "not_run", "reason": "Endogenous-only ablation is reserved for the formal three-seed run."}
        if not self.args.smoke:
            self.phase = "validation-ablation"
            self.status(force=True)
            ablation_tasks, ablation_records = [], []
            for strategy_id, winner in selected.items():
                params = {key: False if key.startswith("use_") else value for key, value in winner["params"].items()}
                if params == winner["params"]:
                    # An already endogenous-only winner supplies the exact
                    # paired seed replications; do not rerun identical fits.
                    ablation_records.extend(winner["seed_results"])
                else:
                    ablation_tasks.extend({**self.task(strategy_id, dict(params, seed=seed)), "role": "endogenous-only-ablation"} for seed in seeds)
            ablation_records.extend(self.batch(gpu_pool, ablation_tasks))
            ablation = endogenous_ablation_summary(selected, ablation_records, seeds)
            _atomic(self.output / "factor-ablation.json", ablation)
        self.phase = "frozen-selection-reporting"
        self.status(force=True)
        self.verify_inputs()
        report_tasks, limited = [], []
        datasets = [self.data]
        if not self.args.smoke:
            transfer_paths = self.args.transfer_snapshot or [str(self.snapshot_path.with_name(symbol + ".json")) for symbol in ("QQQ", "MU", "DRAM")]
            for path in transfer_paths:
                datasets.append(_load_snapshot(Path(path)))
        for data in datasets:
            count = len(data["frame"])
            start = self.holdout if data["ticker"] == self.data["ticker"] else max(80, count - min(100, count // 3))
            if count - start <= 20:
                limited.append({"ticker": data["ticker"], "bars": count, "reason": "insufficient independent reporting origins for all 20 horizons"})
                continue
            for strategy_id, winner in selected.items():
                for seed in seeds:
                    report_tasks.append({**self.task(strategy_id, dict(winner["params"], seed=seed), data=data, folds=[(start, count)], full=True), "role": "selected"})
                    if data["ticker"] == self.data["ticker"] and not self.args.smoke:
                        report_tasks.append({**self.task(strategy_id, dict(self.defaults[strategy_id], seed=seed, compute_backend=self.final_backend), data=data, folds=[(start, count)], full=True), "role": "default-baseline"})
        reports = self.batch(gpu_pool, report_tasks)
        if len(reports) != len(report_tasks) or any(row["status"] != "ok" for row in reports):
            raise RuntimeError("Selection is frozen, but held-out reporting failed or is incomplete.")
        limited.extend({"ticker": row["ticker"], "strategy_id": row["strategy_id"], "seed": row["params"]["seed"],
                        "reason": "Forecast coverage below 95%; inspect fixed-window diagnostics."} for row in reports if not row["feasible"])
        self.verify_inputs()
        payload = {"protocol": self.manifest, "status": "awaiting-cleanup", "reports_prepared_at": _now(),
                   "selection": selection, "reports": reports, "limited_reports": limited,
                   "evaluations": sum(self.counts.values()), "backend_counts": self.counts,
                   "failures": self.failures, "cancelled_counts": self.cancelled_counts,
                   "factor_ablation": ablation,
                   "existing_lstm_baseline": {"status": "not_run", "reason": "Legacy executable target differs; causal zero-drift grid reference is reported for every direct horizon."},
                   "transfer_semantics": "Frozen hyperparameters are retrained causally on each ticker; this is not zero-shot weight transfer."}
        self.pending_result = payload
        _atomic(self.output / "pending-result.json", payload)
        self.phase = "cleanup"
        self.status(force=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", required=True)
    budget = parser.add_mutually_exclusive_group(required=True)
    budget.add_argument("--deadline", help="Absolute ISO-8601 UTC deadline, including timezone.")
    budget.add_argument("--seconds", type=float)
    parser.add_argument("--cpu-workers", type=int, default=8)
    parser.add_argument("--strategy-id", action="append", help="Select an explicit neural strategy; repeat for a fixed research group. Defaults to the original four.")
    parser.add_argument("--cpu-only", action="store_true", help="Use only CPU workers for search, replication, and reporting; never create or probe a GPU worker.")
    parser.add_argument("--transfer-snapshot", action="append")
    parser.add_argument("--smoke", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.cpu_workers < 1 or args.cpu_workers > (os.cpu_count() or 1):
        raise ValueError("cpu-workers must fit the local CPU count.")
    signal.signal(signal.SIGTERM, _signal_stop)
    signal.signal(signal.SIGINT, _signal_stop)
    _configure_process_environment()
    run = None
    try:
        __import__("app")
        run = ResearchRun(args)
        run.run()
        return 0
    except Exception as exc:
        if run is not None:
            run.status("interrupted" if _STOP or (run.output / "STOP").exists() else "incomplete" if time.monotonic() >= run.deadline else "failed",
                       force=True, error=f"{type(exc).__name__}: {exc}")
        print(f"price_field_research: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 130 if _STOP else 1


if __name__ == "__main__":
    raise SystemExit(main())
