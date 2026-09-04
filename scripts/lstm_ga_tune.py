"""
Durable, read-only GA tuning runner for LSTM Price Field.

The runner snapshots one causal market-data bundle, evaluates independent
candidate configurations in bounded spawn workers, and keeps checkpoints
outside the repository. It never writes to the market or investment stores.

Code version: v0.1.3
- Changed: LSTM tuning now consumes the canonical model-neutral Price Field
  market-factor provider and pipeline
  directly instead of importing Bayesian strategy helpers.
- Added: The web training manager can reuse the runner's canonical request and
  state-path builders without depending on private implementation names.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import asdict, dataclass, is_dataclass
from datetime import date, datetime, timedelta, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import sys
import time
from typing import Any, Iterator, Mapping, Sequence
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import PERIOD_OFFSETS  # noqa: E402
from app.services.price_field_market_factors import (  # noqa: E402
    build_local_price_field_factor_bundle,
)  # noqa: E402
from strategies.price_field_pipeline import (  # noqa: E402
    PRICE_FIELD_FACTOR_DEFINITIONS as _PRICE_FIELD_FACTOR_DEFINITIONS,
    build_price_field_factor_columns as _build_factor_columns,
    bundle_to_price_field_ohlcv as _bundle_ohlcv_frame,
    executable_price_field_return_targets as _executable_return_targets,
    merge_price_field_bundle_observations as _merge_bundle_observations,
)  # noqa: E402
from strategies.algorithms.strategy_lstm_price_field import (  # noqa: E402
    LSTMPriceFieldStrategy,
    _MODEL_VERSION,
)  # noqa: E402
from strategies.backtest import run_single_ticker_backtest  # noqa: E402


UTC = timezone.utc
NEW_YORK = ZoneInfo("America/New_York")
MODEL_PARAMETER_KEYS = (
    "training_window",
    "chip_window",
    "lstm_lookback",
    "lstm_hidden_size",
    "lstm_epochs",
    "lstm_learning_rate",
)
PRESENTATION_PARAMETER_KEYS = frozenset({"cell_display_threshold"})
FIXED_PARAMETER_KEYS = frozenset({"cell_display_threshold", "entry_probability", "compute_backend"})
MIN_FACTOR_OBSERVATIONS = 20
MIN_FOLD_DIRECTION_POINTS = 20
MIN_HOLDOUT_DIRECTION_POINTS = 20
MIN_COVERAGE_PCT = 80.0
VALIDATION_FOLD_COUNT = 3
MAX_LEADERBOARD_ENTRIES = 256
ROBUST_CANDIDATE_COUNT = 32
ROBUST_SEEDS = (42, 43, 44)
DEFAULT_DURATION_SECONDS = 43_200
DEFAULT_POPULATION_SIZE = 64
DEFAULT_GA_SEED = 20260903
MAX_WORKERS = 8

_FACTOR_PARAMETER_KEYS = {
    definition.key: definition.parameter_key
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS
}
_FACTOR_DEFINITIONS_BY_KEY = {
    definition.key: definition
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS
}
_WORKER_CONTEXT: "EvaluationContext | None" = None
_STOP_REQUESTED = False


@dataclass
class EvaluationContext:
    visible_frame: pd.DataFrame
    bundle_payload: dict[str, Any]
    active_factor_keys: tuple[str, ...]
    bounds: dict[str, tuple[int | float, int | float]]
    validation_folds: tuple[tuple[str, int, int], ...]
    holdout_start: int
    snapshot_fingerprint: str


@dataclass(frozen=True)
class RunPaths:
    root: Path
    state: Path
    request: Path
    snapshot: Path
    checkpoint: Path
    status: Path
    baseline: Path
    evaluations: Path
    leaderboard: Path
    result: Path
    log: Path
    lock: Path


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _timestamp(value: datetime | date | pd.Timestamp | str) -> str:
    parsed = pd.Timestamp(value)
    if parsed.tzinfo is not None:
        parsed = parsed.tz_convert("UTC").tz_localize(None)
    return parsed.isoformat()


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if is_dataclass(value) and not isinstance(value, type):
        return _json_safe(asdict(value))
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return _timestamp(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_json_safe(item) for item in value.tolist()]
    return str(value)


def _record_value(record: object, key: str, default: Any = None) -> Any:
    if isinstance(record, Mapping):
        return record.get(key, default)
    return getattr(record, key, default)


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(_json_safe(payload), sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return value


def _append_jsonl(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(_json_safe(payload), sort_keys=True, separators=(",", ":")))
        handle.write("\n")
        handle.flush()


def _write_log(path: Path, message: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{_now_utc().isoformat()} {message}\n")
        handle.flush()


@contextmanager
def _run_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+", encoding="utf-8")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(f"Another process already owns the run lock: {path}") from exc
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps({"pid": os.getpid(), "started_at": _now_utc().isoformat()}))
        handle.flush()
        yield
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _default_state_root() -> Path:
    configured = os.environ.get("WORTHWARD_COMPUTE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.home() / "Library" / "Application Support" / "Worthward" / "compute-jobs"


def _runner_fingerprint() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def _request_spec(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema": 1,
        "runner_version": "v0.1.0",
        "runner_fingerprint": _runner_fingerprint(),
        "model_version": _MODEL_VERSION,
        "ticker": str(args.ticker).strip().upper(),
        "period": str(args.period).strip().lower(),
        "duration_seconds": int(args.duration_seconds),
        "population_size": int(args.population_size),
        "max_workers": int(args.max_workers),
        "ga_seed": int(args.ga_seed),
        "offline": bool(args.offline),
    }


def _request_hash(spec: Mapping[str, Any]) -> str:
    encoded = json.dumps(spec, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _build_run_paths(args: argparse.Namespace, spec: Mapping[str, Any]) -> RunPaths:
    workspace_hash = hashlib.sha256(str(PROJECT_ROOT.resolve()).encode("utf-8")).hexdigest()[:16]
    run_hash = _request_hash(spec)
    root = (
        Path(args.state_root).expanduser().resolve()
        if args.state_root
        else _default_state_root()
    )
    state = root / workspace_hash / f"lstm-ga-{run_hash[:24]}"
    return RunPaths(
        root=root,
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


def build_request_spec(args: argparse.Namespace) -> dict[str, Any]:
    """Build the durable request identity used by the CLI and web launcher."""
    return _request_spec(args)


def build_run_paths(args: argparse.Namespace, spec: Mapping[str, Any]) -> RunPaths:
    """Build the durable state paths used by the CLI and web launcher."""
    return _build_run_paths(args, spec)


def _date_bounds(period: str) -> tuple[date, date]:
    normalized_period = str(period).strip().lower()
    if normalized_period not in PERIOD_OFFSETS:
        raise ValueError(f"Unsupported GA period: {period}.")
    end = pd.Timestamp.now(tz=NEW_YORK).tz_localize(None).normalize()
    start = end - PERIOD_OFFSETS[normalized_period]
    return start.date(), end.date()


def _base_params(strategy: LSTMPriceFieldStrategy) -> dict[str, Any]:
    params = strategy.get_default_params()
    params.update({
        "cell_display_threshold": 5.0,
        "entry_probability": 60.0,
        "compute_backend": "CPU",
        "lstm_seed": 42,
    })
    return params


def _bundle_payload(bundle: object) -> dict[str, Any]:
    keys = (
        "symbol",
        "start",
        "end",
        "ohlcv",
        "pe_history",
        "dynamic_pe_history",
        "option_history",
        "research_history",
        "fetched_at",
        "fingerprint",
        "factor_status",
        "source_commands",
    )
    return {
        key: _json_safe(_record_value(bundle, key, None))
        for key in keys
    }


def _frame_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in frame.to_dict(orient="records"):
        rows.append({str(key): _json_safe(value) for key, value in row.items()})
    return rows


def _snapshot_fingerprint(bundle_payload: Mapping[str, Any], visible_frame: pd.DataFrame) -> str:
    payload = {
        "bundle_fingerprint": bundle_payload.get("fingerprint"),
        "visible_rows": _frame_rows(visible_frame),
        "model_version": _MODEL_VERSION,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _effective_factor_keys(full_frame: pd.DataFrame, bundle_payload: Mapping[str, Any]) -> tuple[str, ...]:
    full_frame = _merge_bundle_observations(full_frame, bundle_payload)
    factor_values = _build_factor_columns(full_frame, 252)
    statuses = dict(bundle_payload.get("factor_status") or {})
    excluded_statuses = {
        "unsupported",
        "unsupported_market",
        "unsupported_history",
        "unavailable_point_in_time",
        "error",
    }
    active: list[str] = []
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS:
        values = factor_values.get(definition.key)
        finite_count = int(np.count_nonzero(np.isfinite(values))) if values is not None else 0
        status = str(statuses.get(definition.provider_key, "")).lower()
        if finite_count < MIN_FACTOR_OBSERVATIONS:
            continue
        if status in excluded_statuses:
            continue
        active.append(definition.key)
    return tuple(active)


def _build_snapshot(args: argparse.Namespace, paths: RunPaths) -> tuple[EvaluationContext, dict[str, Any]]:
    if paths.snapshot.exists():
        raw = _read_json(paths.snapshot)
        visible_frame = pd.DataFrame(raw.get("visible_rows") or [])
        if visible_frame.empty:
            raise ValueError("The saved GA snapshot contains no visible rows.")
        bundle_payload = raw.get("bundle")
        if not isinstance(bundle_payload, dict):
            raise ValueError("The saved GA snapshot has no factor bundle.")
        context = _context_from_snapshot(raw, visible_frame, bundle_payload)
        return context, raw

    strategy = LSTMPriceFieldStrategy()
    start, end = _date_bounds(args.period)
    loader_params = _base_params(strategy)
    loader_params.update({
        "training_window": 504,
        "chip_window": 252,
    })
    if args.offline:
        bundle = build_local_price_field_factor_bundle(
            f"{str(args.ticker).strip().upper()}.US",
            start,
            end,
        )
        strategy._warmup_bundle = bundle
    else:
        datasets = strategy.load_market_datasets(
            (str(args.ticker).strip().upper(),),
            interval="1d",
            start=start,
            end=end,
            params=loader_params,
        )
        if not datasets or strategy._warmup_bundle is None:
            raise ValueError("LSTM Price Field did not return a factor bundle for GA tuning.")
        bundle = strategy._warmup_bundle

    full_frame = _bundle_ohlcv_frame(bundle)
    visible_frame = full_frame.loc[
        (full_frame["Date"].dt.date >= start)
        & (full_frame["Date"].dt.date <= end)
    ].copy()
    if visible_frame.empty:
        raise ValueError("The GA snapshot has no rows in the selected Period.")

    bundle_payload = _bundle_payload(bundle)
    active_factor_keys = _effective_factor_keys(full_frame, bundle_payload)
    fingerprint = _snapshot_fingerprint(bundle_payload, visible_frame)
    context = _build_context(
        visible_frame,
        bundle_payload,
        active_factor_keys,
        fingerprint,
    )
    snapshot = {
        "schema": 1,
        "created_at": _now_utc().isoformat(),
        "ticker": str(args.ticker).strip().upper(),
        "period": str(args.period).strip().lower(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "snapshot_fingerprint": fingerprint,
        "active_factor_keys": list(active_factor_keys),
        "bundle": bundle_payload,
        "visible_rows": _frame_rows(visible_frame),
    }
    _atomic_write_json(paths.snapshot, snapshot)
    return context, snapshot


def _context_from_snapshot(
        raw: Mapping[str, Any],
        visible_frame: pd.DataFrame,
        bundle_payload: dict[str, Any],
) -> EvaluationContext:
    visible_frame["Date"] = pd.to_datetime(visible_frame["Date"], errors="coerce")
    visible_frame = visible_frame.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    active_factor_keys = tuple(str(item) for item in raw.get("active_factor_keys") or ())
    fingerprint = str(raw.get("snapshot_fingerprint") or "")
    if not fingerprint:
        fingerprint = _snapshot_fingerprint(bundle_payload, visible_frame)
    return _build_context(visible_frame, bundle_payload, active_factor_keys, fingerprint)


def _build_context(
        visible_frame: pd.DataFrame,
        bundle_payload: dict[str, Any],
        active_factor_keys: Sequence[str],
        fingerprint: str,
) -> EvaluationContext:
    row_count = len(visible_frame)
    if row_count < 80:
        raise ValueError(
            f"GA tuning requires at least 80 visible daily rows; found {row_count}."
        )
    bounds = {
        "training_window": (30, min(504, max(30, row_count))),
        "chip_window": (5, min(252, max(5, row_count))),
        "lstm_lookback": (4, 16),
        "lstm_hidden_size": (4, 32),
        "lstm_epochs": (1, 20),
        "lstm_learning_rate": (0.001, 0.5),
    }
    validation_start = max(0, int(row_count * 0.20))
    holdout_start = max(validation_start + 1, int(row_count * 0.80))
    validation_end = max(validation_start + VALIDATION_FOLD_COUNT, holdout_start)
    edges = np.linspace(
        validation_start,
        validation_end,
        VALIDATION_FOLD_COUNT + 1,
        dtype=int,
    )
    folds = tuple(
        (
            f"validation-{index + 1}",
            int(edges[index]),
            int(edges[index + 1]),
        )
        for index in range(VALIDATION_FOLD_COUNT)
        if int(edges[index + 1]) > int(edges[index])
    )
    if len(folds) != VALIDATION_FOLD_COUNT:
        raise ValueError("The GA validation folds are not large enough.")
    return EvaluationContext(
        visible_frame=visible_frame,
        bundle_payload=bundle_payload,
        active_factor_keys=tuple(active_factor_keys),
        bounds=bounds,
        validation_folds=folds,
        holdout_start=holdout_start,
        snapshot_fingerprint=fingerprint,
    )


def _canonical_params(
        params: Mapping[str, Any],
        base_params: Mapping[str, Any],
        active_factor_keys: Sequence[str],
        bounds: Mapping[str, tuple[int | float, int | float]],
) -> dict[str, Any]:
    normalized = {str(key): value for key, value in base_params.items()}
    normalized.update({str(key): value for key, value in params.items()})
    active = set(active_factor_keys)
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS:
        parameter_key = definition.parameter_key
        normalized[parameter_key] = bool(normalized.get(parameter_key, False)) and (
            definition.key in active
        )
    for key in ("training_window", "chip_window", "lstm_lookback", "lstm_hidden_size", "lstm_epochs"):
        low, high = bounds[key]
        value = int(round(float(normalized.get(key, low))))
        normalized[key] = max(int(low), min(int(high), value))
    low, high = bounds["lstm_learning_rate"]
    learning_rate = float(normalized.get("lstm_learning_rate", low))
    learning_rate = max(float(low), min(float(high), learning_rate))
    normalized["lstm_learning_rate"] = round(learning_rate, 3)
    normalized["lstm_seed"] = max(0, int(round(float(normalized.get("lstm_seed", 42)))))
    normalized["cell_display_threshold"] = 5.0
    normalized["entry_probability"] = 60.0
    normalized["compute_backend"] = "CPU"
    return normalized


def _candidate_key(params: Mapping[str, Any], snapshot_fingerprint: str) -> str:
    payload = {
        "snapshot_fingerprint": snapshot_fingerprint,
        "model_version": _MODEL_VERSION,
        "params": dict(sorted(params.items())),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _model_key(params: Mapping[str, Any], snapshot_fingerprint: str) -> str:
    model_params = {
        key: value
        for key, value in params.items()
        if key != "lstm_seed"
    }
    return _candidate_key(model_params, snapshot_fingerprint)


def _random_params(
        rng: np.random.Generator,
        base_params: Mapping[str, Any],
        active_factor_keys: Sequence[str],
        bounds: Mapping[str, tuple[int | float, int | float]],
) -> dict[str, Any]:
    params = dict(base_params)
    active = set(active_factor_keys)
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS:
        if definition.key in active:
            params[definition.parameter_key] = bool(rng.random() < 0.5)
        else:
            params[definition.parameter_key] = False
    for key in ("training_window", "chip_window", "lstm_lookback", "lstm_hidden_size", "lstm_epochs"):
        low, high = bounds[key]
        params[key] = int(rng.integers(int(low), int(high) + 1))
    low, high = bounds["lstm_learning_rate"]
    params["lstm_learning_rate"] = round(
        10 ** float(rng.uniform(math.log10(float(low)), math.log10(float(high)))),
        3,
    )
    return _canonical_params(params, base_params, active_factor_keys, bounds)


def _mutate_params(
        rng: np.random.Generator,
        parent: Mapping[str, Any],
        base_params: Mapping[str, Any],
        active_factor_keys: Sequence[str],
        bounds: Mapping[str, tuple[int | float, int | float]],
        mutation_rate: float,
) -> dict[str, Any]:
    params = dict(parent)
    for definition in _PRICE_FIELD_FACTOR_DEFINITIONS:
        if definition.key in active_factor_keys and rng.random() < mutation_rate:
            params[definition.parameter_key] = not bool(params.get(definition.parameter_key, False))
    for key in ("training_window", "chip_window", "lstm_lookback", "lstm_hidden_size", "lstm_epochs"):
        if rng.random() >= mutation_rate:
            continue
        low, high = bounds[key]
        span = max(1, int(high) - int(low))
        if rng.random() < 0.15:
            params[key] = int(rng.integers(int(low), int(high) + 1))
        else:
            step = max(1, int(round(span * 0.08)))
            params[key] = int(params.get(key, low)) + int(rng.integers(-step, step + 1))
    if rng.random() < mutation_rate:
        low, high = bounds["lstm_learning_rate"]
        if rng.random() < 0.15:
            params["lstm_learning_rate"] = 10 ** float(
                rng.uniform(math.log10(float(low)), math.log10(float(high)))
            )
        else:
            params["lstm_learning_rate"] = float(params.get("lstm_learning_rate", 0.05)) * (
                10 ** float(rng.normal(0.0, 0.25))
            )
    return _canonical_params(params, base_params, active_factor_keys, bounds)


def _crossover_params(
        rng: np.random.Generator,
        first: Mapping[str, Any],
        second: Mapping[str, Any],
        base_params: Mapping[str, Any],
        active_factor_keys: Sequence[str],
        bounds: Mapping[str, tuple[int | float, int | float]],
) -> dict[str, Any]:
    params = dict(first)
    for key in (*_FACTOR_PARAMETER_KEYS.values(), *MODEL_PARAMETER_KEYS):
        if rng.random() < 0.5:
            params[key] = second.get(key, params.get(key))
    return _canonical_params(params, base_params, active_factor_keys, bounds)


def _candidate_record(
        params: Mapping[str, Any],
        generation: int,
        origin: str,
        snapshot_fingerprint: str,
) -> dict[str, Any]:
    return {
        "candidate_key": _candidate_key(params, snapshot_fingerprint),
        "model_key": _model_key(params, snapshot_fingerprint),
        "params": dict(params),
        "generation": int(generation),
        "origin": str(origin),
    }


def _score_slice(
        opens: np.ndarray,
        means: np.ndarray,
        scales: np.ndarray,
        probabilities: np.ndarray,
        start: int,
        end: int,
) -> dict[str, Any]:
    targets = _executable_return_targets(opens)
    start = max(0, int(start))
    end = min(len(targets), max(start, int(end)))
    target = targets[start:end]
    mean = means[start:end]
    scale = scales[start:end]
    probability = probabilities[start:end]
    valid = (
        np.isfinite(target)
        & np.isfinite(mean)
        & np.isfinite(scale)
        & (scale > 0.0)
        & np.isfinite(probability)
    )
    eligible = valid & (target != 0.0)
    directional = eligible & (probability != 0.5)
    outcome = target > 0.0
    hits = int(np.count_nonzero(directional & ((probability > 0.5) == outcome)))
    directional_points = int(np.count_nonzero(directional))
    eligible_points = int(np.count_nonzero(eligible))
    valid_points = int(np.count_nonzero(valid))
    brier = float(np.mean(np.square(probability[valid] - (target[valid] > 0.0)))) if valid_points else None
    hit_rate = hits / directional_points * 100.0 if directional_points else None
    coverage = directional_points / eligible_points * 100.0 if eligible_points else 0.0
    probability_score = (1.0 - brier) * 100.0 if brier is not None else None
    return {
        "direction_hit_rate_pct": round(hit_rate, 4) if hit_rate is not None else None,
        "direction_hits": hits,
        "direction_scored_points": directional_points,
        "eligible_direction_points": eligible_points,
        "coverage_pct": round(coverage, 4),
        "valid_prediction_points": valid_points,
        "brier_score": round(brier, 8) if brier is not None else None,
        "probability_score_pct": round(probability_score, 4) if probability_score is not None else None,
    }


def _finite_metric(value: Any, default: float = -math.inf) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _evaluate_signal_result(
        candidate: Mapping[str, Any],
        context: EvaluationContext,
) -> dict[str, Any]:
    started = time.perf_counter()
    strategy = LSTMPriceFieldStrategy()
    strategy._warmup_bundle = context.bundle_payload
    params = dict(candidate["params"])
    try:
        signal_result = strategy.compute_signals(context.visible_frame, params)
        frame = signal_result.frame
        opens = frame["Open"].to_numpy(dtype=np.float64)
        means = frame["lstm_predictive_mean"].to_numpy(dtype=np.float64)
        scales = frame["lstm_predictive_std"].to_numpy(dtype=np.float64)
        probabilities = frame["lstm_probability_up"].to_numpy(dtype=np.float64)
        full_score = _score_slice(opens, means, scales, probabilities, 0, len(frame))
        validation_scores = {
            label: _score_slice(opens, means, scales, probabilities, start, end)
            for label, start, end in context.validation_folds
        }
        holdout_score = _score_slice(
            opens,
            means,
            scales,
            probabilities,
            context.holdout_start,
            len(frame),
        )
        backtest = run_single_ticker_backtest(
            signal_result,
            10_000.0,
            execution_mode="next_open",
            interval="1d",
            reinvest_cash_dividends=False,
            include_cash_dividends=True,
            stop_loss_enabled=True,
        )
        summary = backtest.get("summary") if isinstance(backtest, dict) else {}
        summary = summary if isinstance(summary, dict) else {}
        result = {
            **candidate,
            "snapshot_fingerprint": context.snapshot_fingerprint,
            "status": "ok",
            "full": full_score,
            "validation_folds": validation_scores,
            "holdout": holdout_score,
            "backtest": {
                "final_equity": _finite_metric(summary.get("final_equity"), 0.0),
                "net_return_pct": _finite_metric(summary.get("net_return_pct"), 0.0),
                "total_trades": int(summary.get("total_trades", 0) or 0),
                "win_rate_pct": _finite_metric(summary.get("win_rate_pct"), 0.0),
                "beat_bh_pct": _finite_metric(summary.get("beat_bh_pct"), 0.0),
            },
            "device": signal_result.presentation.get("device", {}),
        }
        result.update(_fitness_fields(result))
    except Exception as exc:
        result = {
            **candidate,
            "snapshot_fingerprint": context.snapshot_fingerprint,
            "status": "failed_closed",
            "error": f"{type(exc).__name__}: {str(exc) or 'candidate evaluation failed'}",
            "feasible": False,
            "fitness": -math.inf,
        }
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
    return _json_safe(result)


def _fitness_fields(result: Mapping[str, Any]) -> dict[str, Any]:
    folds = result.get("validation_folds")
    fold_values: list[dict[str, Any]] = []
    if isinstance(folds, Mapping):
        fold_values = [value for value in folds.values() if isinstance(value, dict)]
    accuracies = [
        _finite_metric(value.get("direction_hit_rate_pct"))
        for value in fold_values
    ]
    probability_scores = [
        _finite_metric(value.get("probability_score_pct"))
        for value in fold_values
    ]
    coverages = [
        _finite_metric(value.get("coverage_pct"), 0.0)
        for value in fold_values
    ]
    feasible = (
        len(fold_values) == VALIDATION_FOLD_COUNT
        and all(value != -math.inf for value in accuracies)
        and all(
            int(value.get("direction_scored_points", 0) or 0) >= MIN_FOLD_DIRECTION_POINTS
            and float(value.get("coverage_pct", 0.0) or 0.0) >= MIN_COVERAGE_PCT
            for value in fold_values
        )
    )
    validation_median = float(np.median(accuracies)) if accuracies and all(math.isfinite(value) for value in accuracies) else -math.inf
    validation_std = float(np.std(accuracies)) if accuracies and all(math.isfinite(value) for value in accuracies) else math.inf
    probability_median = float(np.median(probability_scores)) if probability_scores and all(math.isfinite(value) for value in probability_scores) else -math.inf
    coverage_min = min(coverages) if coverages else 0.0
    fitness = (
        validation_median
        - (0.25 * validation_std)
        + (0.01 * (probability_median - 50.0))
        if feasible
        else -math.inf
    )
    return {
        "feasible": feasible,
        "validation_median_hit_rate_pct": round(validation_median, 4) if math.isfinite(validation_median) else None,
        "validation_std_hit_rate_pct": round(validation_std, 4) if math.isfinite(validation_std) else None,
        "validation_median_probability_score_pct": round(probability_median, 4) if math.isfinite(probability_median) else None,
        "validation_min_coverage_pct": round(coverage_min, 4),
        "fitness": round(fitness, 6) if math.isfinite(fitness) else None,
    }


def _evaluate_candidate(candidate: Mapping[str, Any]) -> dict[str, Any]:
    if _WORKER_CONTEXT is None:
        raise RuntimeError("GA worker context was not initialized.")
    return _evaluate_signal_result(candidate, _WORKER_CONTEXT)


def _initialize_worker(context: EvaluationContext) -> None:
    global _WORKER_CONTEXT
    _WORKER_CONTEXT = context
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        os.environ[name] = "1"


def _ranking_key(result: Mapping[str, Any]) -> tuple[float, ...]:
    backtest = result.get("backtest") or {}
    return (
        1.0 if bool(result.get("feasible")) else 0.0,
        _finite_metric(result.get("fitness")),
        _finite_metric(result.get("validation_median_probability_score_pct")),
        _finite_metric(result.get("validation_median_hit_rate_pct")),
        _finite_metric(result.get("validation_min_coverage_pct"), 0.0),
        _finite_metric(backtest.get("net_return_pct"), 0.0),
    )


def _sorted_leaderboard(results: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for result in results:
        key = str(result.get("candidate_key", ""))
        if not key:
            continue
        previous = unique.get(key)
        if previous is None or _ranking_key(result) > _ranking_key(previous):
            unique[key] = dict(result)
    return sorted(unique.values(), key=_ranking_key, reverse=True)[:MAX_LEADERBOARD_ENTRIES]


def _tournament(
        rng: np.random.Generator,
        leaderboard: Sequence[Mapping[str, Any]],
        size: int = 4,
) -> Mapping[str, Any]:
    if not leaderboard:
        raise ValueError("Cannot select a parent from an empty leaderboard.")
    indices = rng.integers(0, len(leaderboard), size=max(1, size))
    candidates = [leaderboard[int(index)] for index in indices]
    return max(candidates, key=_ranking_key)


def _next_population(
        rng: np.random.Generator,
        leaderboard: Sequence[Mapping[str, Any]],
        base_params: Mapping[str, Any],
        context: EvaluationContext,
        population_size: int,
        generation: int,
        stagnation: int,
) -> list[dict[str, Any]]:
    if not leaderboard:
        return []
    elite_count = max(2, min(8, population_size // 8))
    mutation_rate = 0.10 if stagnation < 20 else 0.20
    population: list[dict[str, Any]] = []
    for result in leaderboard[:elite_count]:
        population.append(_candidate_record(
            result["params"],
            generation,
            "elite",
            context.snapshot_fingerprint,
        ))
    while len(population) < population_size:
        first = _tournament(rng, leaderboard)
        second = _tournament(rng, leaderboard)
        child_params = _crossover_params(
            rng,
            first["params"],
            second["params"],
            base_params,
            context.active_factor_keys,
            context.bounds,
        )
        child_params = _mutate_params(
            rng,
            child_params,
            base_params,
            context.active_factor_keys,
            context.bounds,
            mutation_rate,
        )
        population.append(_candidate_record(
            child_params,
            generation,
            "crossover-mutation",
            context.snapshot_fingerprint,
        ))
    return population


def _new_population(
        rng: np.random.Generator,
        base_params: Mapping[str, Any],
        context: EvaluationContext,
        size: int,
        generation: int,
) -> list[dict[str, Any]]:
    population = [
        _candidate_record(
            _canonical_params(
                base_params,
                base_params,
                context.active_factor_keys,
                context.bounds,
            ),
            generation,
            "baseline",
            context.snapshot_fingerprint,
        )
    ]
    while len(population) < size:
        params = _random_params(
            rng,
            base_params,
            context.active_factor_keys,
            context.bounds,
        )
        population.append(_candidate_record(
            params,
            generation,
            "random",
            context.snapshot_fingerprint,
        ))
    return population


def _evaluate_batch(
        executor: ProcessPoolExecutor,
        candidates: Sequence[Mapping[str, Any]],
        deadline: float,
) -> list[dict[str, Any]]:
    futures = {
        executor.submit(_evaluate_candidate, candidate): candidate
        for candidate in candidates
    }
    results: list[dict[str, Any]] = []
    for future in as_completed(futures):
        if _STOP_REQUESTED or time.monotonic() > deadline:
            for pending in futures:
                if not pending.done():
                    pending.cancel()
            break
        try:
            results.append(future.result())
        except Exception as exc:
            candidate = futures[future]
            results.append({
                **candidate,
                "status": "failed_closed",
                "snapshot_fingerprint": candidate.get("snapshot_fingerprint", ""),
                "error": f"{type(exc).__name__}: {str(exc) or 'worker failed'}",
                "feasible": False,
                "fitness": None,
            })
    return results


def _status_payload(
        spec: Mapping[str, Any],
        paths: RunPaths,
        *,
        status: str,
        started_at: str,
        elapsed_seconds: float,
        generation: int,
        evaluated: int,
        phase: str,
        leaderboard: Sequence[Mapping[str, Any]],
        context: EvaluationContext,
        error: str | None = None,
) -> dict[str, Any]:
    return {
        "schema": 1,
        "status": status,
        "phase": phase,
        "pid": os.getpid(),
        "started_at": started_at,
        "updated_at": _now_utc().isoformat(),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "duration_seconds": int(spec["duration_seconds"]),
        "generation": int(generation),
        "evaluated": int(evaluated),
        "ticker": spec["ticker"],
        "period": spec["period"],
        "snapshot_fingerprint": context.snapshot_fingerprint,
        "active_factor_keys": list(context.active_factor_keys),
        "best": dict(leaderboard[0]) if leaderboard else None,
        "log_path": str(paths.log),
        "error": error,
    }


def _write_checkpoint(
        paths: RunPaths,
        spec: Mapping[str, Any],
        rng: np.random.Generator,
        population: Sequence[Mapping[str, Any]],
        leaderboard: Sequence[Mapping[str, Any]],
        seen: set[str],
        generation: int,
        evaluated: int,
        elapsed_seconds: float,
        phase: str,
        stagnation: int,
) -> None:
    _atomic_write_json(paths.checkpoint, {
        "schema": 1,
        "request_hash": _request_hash(spec),
        "runner_fingerprint": spec["runner_fingerprint"],
        "rng_state": _json_safe(rng.bit_generator.state),
        "population": list(population),
        "leaderboard": list(leaderboard),
        "seen": list(seen)[-50_000:],
        "generation": generation,
        "evaluated": evaluated,
        "elapsed_seconds": elapsed_seconds,
        "phase": phase,
        "stagnation": int(stagnation),
        "updated_at": _now_utc().isoformat(),
    })


def _resume_state(
        paths: RunPaths,
        spec: Mapping[str, Any],
        context: EvaluationContext,
) -> tuple[
        np.random.Generator,
        list[dict[str, Any]],
        list[dict[str, Any]],
        set[str],
        int,
        int,
        float,
        str,
        int,
]:
    checkpoint = _read_json(paths.checkpoint)
    if checkpoint.get("request_hash") != _request_hash(spec):
        raise ValueError("The checkpoint belongs to a different GA request.")
    if checkpoint.get("runner_fingerprint") != spec["runner_fingerprint"]:
        raise ValueError("The checkpoint was created by different runner code.")
    saved_state = checkpoint.get("rng_state")
    rng = np.random.default_rng()
    if isinstance(saved_state, dict):
        rng.bit_generator.state = saved_state
    population = [item for item in checkpoint.get("population", []) if isinstance(item, dict)]
    leaderboard = [item for item in checkpoint.get("leaderboard", []) if isinstance(item, dict)]
    seen = {str(item) for item in checkpoint.get("seen", [])}
    generation = int(checkpoint.get("generation", 0) or 0)
    evaluated = int(checkpoint.get("evaluated", 0) or 0)
    elapsed_seconds = float(checkpoint.get("elapsed_seconds", 0.0) or 0.0)
    phase = str(checkpoint.get("phase", "ga") or "ga")
    stagnation = int(checkpoint.get("stagnation", 0) or 0)
    for candidate in population:
        candidate["snapshot_fingerprint"] = context.snapshot_fingerprint
    return (
        rng,
        population,
        leaderboard,
        seen,
        generation,
        evaluated,
        elapsed_seconds,
        phase,
        stagnation,
    )


def _aggregate_robust(results: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        if result.get("status") != "ok":
            continue
        model_key = str(result.get("model_key", ""))
        if model_key:
            groups.setdefault(model_key, []).append(dict(result))
    aggregated: list[dict[str, Any]] = []
    for model_key, group in groups.items():
        holdout_rates = [
            _finite_metric((item.get("holdout") or {}).get("direction_hit_rate_pct"))
            for item in group
        ]
        holdout_coverages = [
            _finite_metric((item.get("holdout") or {}).get("coverage_pct"), 0.0)
            for item in group
        ]
        validation_rates = [
            _finite_metric(item.get("validation_median_hit_rate_pct"))
            for item in group
        ]
        probability_scores = [
            _finite_metric(item.get("validation_median_probability_score_pct"))
            for item in group
        ]
        feasible = (
            len(group) == len(ROBUST_SEEDS)
            and all(math.isfinite(value) for value in holdout_rates)
            and all(value >= MIN_COVERAGE_PCT for value in holdout_coverages)
            and all(
                int((item.get("holdout") or {}).get("direction_scored_points", 0) or 0)
                >= MIN_HOLDOUT_DIRECTION_POINTS
                for item in group
            )
        )
        aggregate = {
            "model_key": model_key,
            "params": {
                key: value
                for key, value in group[0]["params"].items()
                if key != "lstm_seed"
            },
            "seed_results": group,
            "seed_count": len(group),
            "feasible": feasible,
            "holdout_median_hit_rate_pct": round(float(np.median(holdout_rates)), 4) if holdout_rates else None,
            "holdout_min_hit_rate_pct": round(float(np.min(holdout_rates)), 4) if holdout_rates else None,
            "holdout_median_coverage_pct": round(float(np.median(holdout_coverages)), 4) if holdout_coverages else None,
            "validation_median_hit_rate_pct": round(float(np.median(validation_rates)), 4) if validation_rates else None,
            "validation_median_probability_score_pct": round(float(np.median(probability_scores)), 4) if probability_scores else None,
        }
        aggregated.append(aggregate)
    return sorted(
        aggregated,
        key=lambda item: (
            1.0 if item["feasible"] else 0.0,
            _finite_metric(item.get("holdout_median_hit_rate_pct")),
            _finite_metric(item.get("holdout_min_hit_rate_pct")),
            _finite_metric(item.get("validation_median_hit_rate_pct")),
            _finite_metric(item.get("validation_median_probability_score_pct")),
        ),
        reverse=True,
    )


def _handle_stop(_signum: int, _frame: object) -> None:
    global _STOP_REQUESTED
    _STOP_REQUESTED = True


def _run(args: argparse.Namespace) -> int:
    spec = _request_spec(args)
    paths = _build_run_paths(args, spec)
    if paths.request.exists():
        existing = _read_json(paths.request)
        if existing != spec:
            raise RuntimeError(
                "A different request already uses this run path; choose another state root."
            )
        if paths.result.exists():
            print(json.dumps(_read_json(paths.result), indent=2, sort_keys=True))
            return 0
        if not args.resume:
            raise RuntimeError(
                f"A prior GA run exists at {paths.state}; use --resume explicitly to continue it."
            )
    paths.state.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(paths.request, spec)
    with _run_lock(paths.lock):
        context, snapshot = _build_snapshot(args, paths)
        strategy = LSTMPriceFieldStrategy()
        base_params = _canonical_params(
            _base_params(strategy),
            _base_params(strategy),
            context.active_factor_keys,
            context.bounds,
        )
        if args.resume:
            (
                rng,
                population,
                leaderboard,
                seen,
                generation,
                evaluated,
                elapsed_seconds,
                phase,
                stagnation,
            ) = _resume_state(
                paths,
                spec,
                context,
            )
        else:
            rng = np.random.default_rng(int(args.ga_seed))
            population = _new_population(
                rng,
                base_params,
                context,
                int(args.population_size),
                0,
            )
            leaderboard = []
            seen = set()
            generation = 0
            evaluated = 0
            elapsed_seconds = 0.0
            phase = "ga"
            stagnation = 0

        started_at = _now_utc() - timedelta(seconds=elapsed_seconds)
        started_at_text = started_at.isoformat()
        _write_log(paths.log, f"starting job state={paths.state} resume={args.resume}")
        _write_log(paths.log, f"snapshot={snapshot.get('snapshot_fingerprint')} active_factors={context.active_factor_keys}")

        baseline_candidate = _candidate_record(
            base_params,
            -1,
            "baseline",
            context.snapshot_fingerprint,
        )
        if not any(item.get("candidate_key") == baseline_candidate["candidate_key"] for item in leaderboard):
            baseline = _evaluate_signal_result(baseline_candidate, context)
            _atomic_write_json(paths.baseline, baseline)
            leaderboard = _sorted_leaderboard([*leaderboard, baseline])
            seen.add(str(baseline.get("candidate_key")))
            _append_jsonl(paths.evaluations, baseline)
            evaluated += 1
        else:
            baseline = next(
                item for item in leaderboard
                if item.get("candidate_key") == baseline_candidate["candidate_key"]
            )
        seen.add(str(baseline_candidate["candidate_key"]))

        _atomic_write_json(paths.status, _status_payload(
            spec,
            paths,
            status="running",
            started_at=started_at_text,
            elapsed_seconds=elapsed_seconds,
            generation=generation,
            evaluated=evaluated,
            phase=phase,
            leaderboard=leaderboard,
            context=context,
        ))

        signal.signal(signal.SIGINT, _handle_stop)
        signal.signal(signal.SIGTERM, _handle_stop)
        total_deadline = time.monotonic() + max(0.0, float(args.duration_seconds) - elapsed_seconds)
        final_reserve = min(900.0, max(300.0, float(args.duration_seconds) * 0.03))
        main_deadline = max(time.monotonic(), total_deadline - final_reserve)
        mp_context = __import__("multiprocessing").get_context("spawn")
        executor = ProcessPoolExecutor(
            max_workers=int(args.max_workers),
            mp_context=mp_context,
            initializer=_initialize_worker,
            initargs=(context,),
        )
        robust_results: list[dict[str, Any]] = []
        try:
            while (
                not _STOP_REQUESTED
                and time.monotonic() < main_deadline
                and population
            ):
                unique_population: list[dict[str, Any]] = []
                batch_keys: set[str] = set()
                for candidate in population:
                    key = str(candidate.get("candidate_key", ""))
                    if key and key not in seen and key not in batch_keys:
                        unique_population.append(candidate)
                        batch_keys.add(key)
                if not unique_population:
                    population = _next_population(
                        rng,
                        leaderboard,
                        base_params,
                        context,
                        int(args.population_size),
                        generation + 1,
                        generation,
                    )
                    continue
                remaining_deadline = min(main_deadline, time.monotonic() + 600.0)
                previous_best = leaderboard[0] if leaderboard else None
                previous_best_rank = _ranking_key(previous_best) if previous_best else None
                results = _evaluate_batch(executor, unique_population, remaining_deadline)
                if not results:
                    break
                completed_keys = {
                    str(result.get("candidate_key", ""))
                    for result in results
                    if result.get("candidate_key")
                }
                seen.update(completed_keys)
                pending_candidates = [
                    candidate
                    for candidate in unique_population
                    if str(candidate.get("candidate_key", "")) not in completed_keys
                ]
                leaderboard = _sorted_leaderboard([*leaderboard, *results])
                for result in results:
                    _append_jsonl(paths.evaluations, result)
                evaluated += len(results)
                generation += 1
                elapsed_seconds = float(args.duration_seconds) - max(0.0, total_deadline - time.monotonic())
                best = leaderboard[0] if leaderboard else {}
                best_rank = _ranking_key(best) if best else None
                if best and (
                    previous_best_rank is None
                    or best_rank > previous_best_rank
                ):
                    stagnation = 0
                else:
                    stagnation += 1
                _atomic_write_json(paths.leaderboard, {
                    "schema": 1,
                    "updated_at": _now_utc().isoformat(),
                    "generation": generation,
                    "evaluated": evaluated,
                    "entries": leaderboard,
                })
                _write_checkpoint(
                    paths,
                    spec,
                    rng,
                    population,
                    leaderboard,
                    seen,
                    generation,
                    evaluated,
                    elapsed_seconds,
                    "ga",
                    stagnation,
                )
                _atomic_write_json(paths.status, _status_payload(
                    spec,
                    paths,
                    status="running",
                    started_at=started_at_text,
                    elapsed_seconds=elapsed_seconds,
                    generation=generation,
                    evaluated=evaluated,
                    phase="ga",
                    leaderboard=leaderboard,
                    context=context,
                ))
                _write_log(
                    paths.log,
                    "generation="
                    f"{generation} evaluated={evaluated} best_fitness={best.get('fitness')} "
                    f"best_holdout={((best.get('holdout') or {}).get('direction_hit_rate_pct'))}",
                )
                if pending_candidates:
                    population = pending_candidates
                else:
                    population = _next_population(
                        rng,
                        leaderboard,
                        base_params,
                        context,
                        int(args.population_size),
                        generation,
                        stagnation,
                    )

            run_completed = False
            if not _STOP_REQUESTED and time.monotonic() < total_deadline:
                phase = "robust-rescore"
                top_models: list[dict[str, Any]] = []
                seen_models: set[str] = set()
                for result in leaderboard:
                    model_key = _model_key(result["params"], context.snapshot_fingerprint)
                    if model_key in seen_models:
                        continue
                    seen_models.add(model_key)
                    top_models.append(result)
                    if len(top_models) >= ROBUST_CANDIDATE_COUNT:
                        break
                robust_candidates: list[dict[str, Any]] = []
                for result in top_models:
                    for seed in ROBUST_SEEDS:
                        params = dict(result["params"])
                        params["lstm_seed"] = seed
                        robust_candidates.append(_candidate_record(
                            _canonical_params(
                                params,
                                base_params,
                                context.active_factor_keys,
                                context.bounds,
                            ),
                            generation,
                            "robust-rescore",
                            context.snapshot_fingerprint,
                        ))
                robust_results = _evaluate_batch(
                    executor,
                    robust_candidates,
                    total_deadline,
                )
                evaluated += len(robust_results)
                for result in robust_results:
                    _append_jsonl(paths.evaluations, result)
                if (
                    not _STOP_REQUESTED
                    and time.monotonic() < total_deadline
                    and len(robust_results) == len(robust_candidates)
                ):
                    aggregates = _aggregate_robust(robust_results)
                    best_aggregate = aggregates[0] if aggregates else None
                    final_payload = {
                        "schema": 1,
                        "status": "completed",
                        "completed_at": _now_utc().isoformat(),
                        "request": spec,
                        "snapshot": {
                            "fingerprint": context.snapshot_fingerprint,
                            "ticker": spec["ticker"],
                            "period": spec["period"],
                            "active_factor_keys": list(context.active_factor_keys),
                        },
                        "baseline": baseline,
                        "robust_leaderboard": aggregates,
                        "best": best_aggregate,
                        "evaluated": evaluated,
                        "generation": generation,
                    }
                    _atomic_write_json(paths.result, final_payload)
                    _atomic_write_json(paths.status, _status_payload(
                        spec,
                        paths,
                        status="completed",
                        started_at=started_at_text,
                        elapsed_seconds=float(args.duration_seconds) - max(0.0, total_deadline - time.monotonic()),
                        generation=generation,
                        evaluated=evaluated,
                        phase="completed",
                        leaderboard=leaderboard,
                        context=context,
                    ))
                    _write_log(paths.log, f"completed evaluated={evaluated} robust_groups={len(aggregates)}")
                    run_completed = True
                else:
                    _write_log(
                        paths.log,
                        "robust-rescore incomplete; preserving the GA checkpoint",
                    )
            if not run_completed:
                elapsed_seconds = float(args.duration_seconds) - max(0.0, total_deadline - time.monotonic())
                terminal_status = "interrupted" if _STOP_REQUESTED else "time_budget_reached"
                _write_checkpoint(
                    paths,
                    spec,
                    rng,
                    population,
                    leaderboard,
                    seen,
                    generation,
                    evaluated,
                    elapsed_seconds,
                    terminal_status,
                    stagnation,
                )
                _atomic_write_json(paths.status, _status_payload(
                    spec,
                    paths,
                    status=terminal_status,
                    started_at=started_at_text,
                    elapsed_seconds=elapsed_seconds,
                    generation=generation,
                    evaluated=evaluated,
                    phase=terminal_status,
                    leaderboard=leaderboard,
                    context=context,
                ))
        finally:
            executor.shutdown(wait=True, cancel_futures=True)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a durable local GA search for LSTM Price Field.")
    parser.add_argument("--ticker", default="NVDA")
    parser.add_argument("--period", default="1y", choices=tuple(PERIOD_OFFSETS))
    parser.add_argument("--duration-seconds", type=int, default=DEFAULT_DURATION_SECONDS)
    parser.add_argument("--population-size", type=int, default=DEFAULT_POPULATION_SIZE)
    parser.add_argument("--max-workers", type=int, default=min(MAX_WORKERS, max(1, (os.cpu_count() or 2) - 2)))
    parser.add_argument("--ga-seed", type=int, default=DEFAULT_GA_SEED)
    parser.add_argument("--state-root", default="")
    parser.add_argument("--offline", action="store_true", help="Use only the existing local daily market store.")
    parser.add_argument("--resume", action="store_true", help="Explicitly resume an interrupted request.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.duration_seconds < 600:
        raise SystemExit("duration-seconds must be at least 600 seconds for a durable GA run.")
    if args.population_size < 4:
        raise SystemExit("population-size must be at least 4.")
    if args.max_workers < 1 or args.max_workers > MAX_WORKERS:
        raise SystemExit(f"max-workers must be between 1 and {MAX_WORKERS}.")
    try:
        return _run(args)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"lstm_ga_tune failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
