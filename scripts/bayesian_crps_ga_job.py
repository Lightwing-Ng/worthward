"""Run an offline, durable Bayesian Price Field CRPS genetic search.

The entrypoint implements the fixed agenticContext compute-job protocol. Its
configuration carries an immutable compressed market snapshot, so candidate
evaluation never needs provider credentials, HTTP, or a child process.

Code version: v1.2.0
"""

from __future__ import annotations

import argparse
import base64
import calendar
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timezone
from functools import lru_cache
import gzip
import hashlib
from importlib import metadata as importlib_metadata
import io
import json
import math
import os
from pathlib import Path
import platform
import random
import secrets
import signal
import stat
import sys
import time
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


OPTIMIZER_VERSION = "worthward-bayesian-crps-ga/v1.2.0"
CONFIG_KIND = "worthward-bayesian-crps-ga"
SNAPSHOT_KIND = "worthward-price-field-market-bundle"
MAX_CONFIG_BYTES = 1_048_576
MAX_SNAPSHOT_BYTES = 16 * 1_048_576
MAX_CHECKPOINT_BYTES = 1_048_576
MAX_SOURCE_BYTES = 1_048_576
MAX_LEADERBOARD_RECORDS = 16
VALIDATION_FOLD_COUNT = 3
GRID_HORIZON_COUNT = 20
MIN_SEARCH_DURATION_SECONDS = 600
MAX_SEARCH_DURATION_SECONDS = 37_800
BACKEND_POLICY = "forced-cpu-numpy-float64-serial"
SEEN_ENCODING = "base64-sha256-list-v1"
IGNORED_CANDIDATE_PARAMETERS = frozenset({
    "cell_display_threshold",
    "entry_probability",
})
APPROVED_NUMERIC_DOMAINS = {
    "training_window": (30.0, 504.0, 1.0),
    "chip_window": (5.0, 252.0, 1.0),
    "prior_strength": (0.01, 100.0, 0.01),
}
APPROVED_FACTOR_PARAMETERS = (
    "use_illiquidity_20d",
    "use_close_location",
    "use_intraday_return",
    "use_volume",
    "use_volume_change",
    "use_option_call_volume",
    "use_options",
    "use_option_put_call_open_interest_ratio",
    "use_option_put_call_volume_ratio",
)
GENERAL_QUERY_KEYS = frozenset({
    "ticker",
    "strategy",
    "range",
    "period",
    "from",
    "to",
    "interval",
})
REQUIRED_RUNTIME_SOURCE_PATHS = frozenset({
    "app/infrastructure/parallel.py",
    "scripts/bayesian_crps_ga_job.py",
    "strategies/algorithms/strategy_bayesian_price_field.py",
    "strategies/base.py",
    "strategies/interval_bridge.py",
    "strategies/price_field_contract.py",
    "strategies/price_field_pipeline.py",
    "strategies/price_field_scoring.py",
})
PREPARATION_SOURCE_PATHS = frozenset({
    "app/core/config.py",
    "app/infrastructure/broker_market_data.py",
    "app/services/price_field_market_factors.py",
    "scripts/prepare_bayesian_crps_ga_config.py",
})


@dataclass(frozen=True)
class SearchSpec:
    seed: int
    population_size: int
    search_duration_seconds: int
    validation_fraction_start: float
    holdout_fraction_start: float
    numeric_domains: dict[str, tuple[float, float, float]]
    factor_parameters: tuple[str, ...]
    baseline_params: dict[str, Any]


@dataclass(frozen=True)
class EvaluationContext:
    project_root: Path
    snapshot: dict[str, Any]
    snapshot_sha256: str
    visible_frame: Any
    selection_frame: Any
    selection_bundle: dict[str, Any]
    validation_folds: tuple[tuple[str, int, int], ...]
    holdout_start: int


def _canonical_json_bytes(payload: object) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_safe(value: object) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Optimizer output contains a non-finite number.")
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        return _json_safe(value.item())
    raise TypeError(f"Optimizer output contains unsupported {type(value).__name__}.")


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    encoded = _canonical_json_bytes(_json_safe(payload)) + b"\n"
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name == "posix":
            descriptor = os.open(
                path.parent,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
            )
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _append_jsonl(path: Path, payload: Mapping[str, Any]) -> None:
    encoded = _canonical_json_bytes(_json_safe(payload)) + b"\n"
    descriptor = os.open(
        path,
        os.O_APPEND
        | os.O_CREAT
        | os.O_WRONLY
        | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        os.close(descriptor)
        raise ValueError("Evaluation log must be one regular, singly linked file.")
    with os.fdopen(descriptor, "ab") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    if os.name == "posix":
        directory = os.open(
            path.parent,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


def _read_bounded(path: Path, maximum_bytes: int, label: str) -> bytes:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"{label} must be one regular non-linked file.")
    if path.stat().st_size > maximum_bytes:
        raise ValueError(f"{label} exceeds the {maximum_bytes:,}-byte limit.")
    payload = path.read_bytes()
    if len(payload) > maximum_bytes:
        raise ValueError(f"{label} exceeds the {maximum_bytes:,}-byte limit.")
    return payload


def resolve_project_root() -> Path:
    """Resolve Worthward from the source directory chosen by the job manager."""
    candidates = (Path.cwd(), Path.cwd().parent)
    for candidate in candidates:
        resolved = candidate.resolve()
        if (
            (resolved / "strategies/price_field_scoring.py").is_file()
            and (resolved / "app/infrastructure/parallel.py").is_file()
        ):
            return resolved
    live_source = Path(__file__).resolve()
    if live_source.parent.name == "scripts":
        candidate = live_source.parent.parent
        if (candidate / "strategies/price_field_scoring.py").is_file():
            return candidate
    raise ValueError("Worthward project root is unavailable from the approved source directory.")


def _decode_snapshot(snapshot_record: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    if snapshot_record.get("encoding") != "gzip+base64":
        raise ValueError("Snapshot encoding must be gzip+base64.")
    try:
        compressed = base64.b64decode(
            str(snapshot_record.get("data") or ""),
            validate=True,
        )
    except (ValueError, TypeError) as exc:
        raise ValueError("Snapshot data is not valid base64.") from exc
    if len(compressed) != snapshot_record.get("compressed_bytes"):
        raise ValueError("Snapshot compressed byte count does not match.")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
            raw = archive.read(MAX_SNAPSHOT_BYTES + 1)
    except (OSError, EOFError) as exc:
        raise ValueError("Snapshot gzip payload is invalid.") from exc
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Snapshot expands beyond the bounded size.")
    if len(raw) != snapshot_record.get("uncompressed_bytes"):
        raise ValueError("Snapshot uncompressed byte count does not match.")
    digest = _sha256(raw)
    if digest != snapshot_record.get("sha256"):
        raise ValueError("Snapshot SHA-256 does not match.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Snapshot is not valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict) or _canonical_json_bytes(payload) != raw:
        raise ValueError("Snapshot must use canonical JSON bytes.")
    if "bundle" in payload:
        raise ValueError("Snapshot must use the direct market-bundle schema.")
    if not isinstance(payload.get("ohlcv"), list):
        raise ValueError("Snapshot does not contain a Price Field market bundle.")
    return payload, digest


def _validated_source_hashes(
    project_root: Path,
    entrypoint_snapshot: Path,
    raw_hashes: object,
) -> dict[str, str]:
    if not isinstance(raw_hashes, dict):
        raise ValueError("optimizer.source_sha256 must be one object.")
    hashes = {str(path): str(digest).lower() for path, digest in raw_hashes.items()}
    missing = sorted(REQUIRED_RUNTIME_SOURCE_PATHS.difference(hashes))
    if missing:
        raise ValueError("optimizer.source_sha256 is missing: " + ", ".join(missing))
    for relative_path, expected in sorted(hashes.items()):
        if not expected or len(expected) != 64 or any(
            character not in "0123456789abcdef" for character in expected
        ):
            raise ValueError(f"Invalid source SHA-256 for {relative_path}.")
        relative = Path(relative_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Invalid source path: {relative_path}.")
        source = (
            entrypoint_snapshot
            if relative_path == "scripts/bayesian_crps_ga_job.py"
            else project_root / relative
        )
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Pinned source is unavailable: {relative_path}.")
        if _sha256(source.read_bytes()) != expected:
            raise ValueError(f"Pinned source changed: {relative_path}.")
    return hashes


def _validate_domain(name: str, raw: object) -> tuple[float, float, float]:
    if not isinstance(raw, list) or len(raw) != 3:
        raise ValueError(f"Numeric domain {name} must be [minimum, maximum, step].")
    if any(isinstance(value, bool) for value in raw):
        raise ValueError(f"Numeric domain {name} contains a boolean.")
    try:
        low, high, step = (float(value) for value in raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Numeric domain {name} is not numeric.") from exc
    if not all(math.isfinite(value) for value in (low, high, step)):
        raise ValueError(f"Numeric domain {name} must be finite.")
    if low > high or step <= 0:
        raise ValueError(f"Numeric domain {name} has invalid bounds.")
    return low, high, step


def _parse_search_spec(config: Mapping[str, Any]) -> SearchSpec:
    baseline = config.get("baseline_params")
    optimizer = config.get("optimizer")
    if not isinstance(baseline, dict) or not isinstance(optimizer, dict):
        raise ValueError("Config requires baseline_params and optimizer objects.")
    if optimizer.get("version") != OPTIMIZER_VERSION:
        raise ValueError("Optimizer version does not match this runner.")
    numeric = optimizer.get("numeric_domains")
    if not isinstance(numeric, dict) or set(numeric) != set(APPROVED_NUMERIC_DOMAINS):
        raise ValueError("Optimizer numeric domains do not match the approved model genes.")
    domains = {
        str(name): _validate_domain(str(name), domain)
        for name, domain in numeric.items()
    }
    if domains != APPROVED_NUMERIC_DOMAINS:
        raise ValueError("Optimizer numeric domains do not match the approved bounds.")
    factors = optimizer.get("factor_parameters")
    if (
        not isinstance(factors, list)
        or not factors
        or len(factors) != len(set(map(str, factors)))
        or any(not str(name).startswith("use_") for name in factors)
    ):
        raise ValueError("Optimizer factor_parameters must be a nonempty unique list.")
    factor_parameters = tuple(map(str, factors))
    if factor_parameters != APPROVED_FACTOR_PARAMETERS:
        raise ValueError("Optimizer factor parameters do not match the approved genes.")
    if any(name not in baseline for name in factor_parameters):
        raise ValueError("Every factor gene must exist in baseline_params.")
    if any(type(baseline[name]) is not bool for name in factor_parameters):
        raise ValueError("Every baseline factor gene must be a boolean.")
    duration = optimizer.get("search_duration_seconds")
    population_size = optimizer.get("population_size")
    seed = optimizer.get("seed")
    if isinstance(duration, bool) or not isinstance(duration, int):
        raise ValueError("search_duration_seconds must be an integer.")
    if not MIN_SEARCH_DURATION_SECONDS <= duration <= MAX_SEARCH_DURATION_SECONDS:
        raise ValueError(
            "search_duration_seconds must be between 600 and 37,800 seconds."
        )
    if isinstance(population_size, bool) or not isinstance(population_size, int):
        raise ValueError("population_size must be an integer.")
    if not 4 <= population_size <= 64:
        raise ValueError("population_size must be between 4 and 64.")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError("optimizer.seed must be a non-negative integer.")
    validation_start = float(optimizer.get("validation_fraction_start", 0.20))
    holdout_start = float(optimizer.get("holdout_fraction_start", 0.80))
    if not 0.0 <= validation_start < holdout_start < 1.0:
        raise ValueError("Validation and holdout fractions are invalid.")
    spec = SearchSpec(
        seed=seed,
        population_size=population_size,
        search_duration_seconds=duration,
        validation_fraction_start=validation_start,
        holdout_fraction_start=holdout_start,
        numeric_domains=domains,
        factor_parameters=factor_parameters,
        baseline_params=dict(baseline),
    )
    normalized_baseline = canonical_candidate(spec.baseline_params, spec)
    for name in (*spec.numeric_domains, *spec.factor_parameters):
        if spec.baseline_params.get(name) != normalized_baseline[name]:
            raise ValueError(f"Baseline gene {name} is outside the approved domain.")
    return spec


def _parse_backtest_url(backtest_url: object) -> tuple[str, dict[str, str]]:
    if not isinstance(backtest_url, str):
        raise ValueError("Backtest URL must be a string.")
    parsed = urlsplit(backtest_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Backtest URL must be an absolute HTTP or HTTPS URL.")
    if parsed.username or parsed.password:
        raise ValueError("Backtest URL must not contain credentials.")
    if parsed.path.rstrip("/") != "/workspaces/backtest":
        raise ValueError("Backtest URL must target /workspaces/backtest.")
    if parsed.fragment:
        raise ValueError("Backtest URL must not contain a fragment.")
    try:
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise ValueError("Backtest URL query is malformed.") from exc
    query: dict[str, str] = {}
    for key, value in pairs:
        if key in query:
            raise ValueError(f"Backtest URL repeats query parameter {key!r}.")
        query[key] = value
    canonical_url = urlunsplit((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        "/workspaces/backtest",
        urlencode(sorted(query.items())),
        "",
    ))
    return canonical_url, query


def _normalize_provider_symbol(ticker: str) -> str:
    normalized = ticker.strip().upper()
    if normalized in {"SKHY", "SKHYV", "SKHY.US", "SKHYV.US"}:
        return "SKHY.US"
    if normalized.endswith(".SS"):
        symbol, _ = normalized.rsplit(".", 1)
        return f"{symbol}.SH"
    dot_share_class = normalized.rsplit(".", 1)
    if (
        len(dot_share_class) == 2
        and dot_share_class[0].isalnum()
        and 1 <= len(dot_share_class[0]) <= 4
        and dot_share_class[1] in {"A", "B", "C"}
    ):
        return f"{normalized}.US"
    dash_share_class = normalized.rsplit("-", 1)
    if (
        len(dash_share_class) == 2
        and dash_share_class[0].isalnum()
        and 1 <= len(dash_share_class[0]) <= 4
        and dash_share_class[1] in {"A", "B", "C"}
    ):
        return f"{dash_share_class[0]}.{dash_share_class[1]}.US"
    return normalized if "." in normalized else f"{normalized}.US"


def _relative_range_start(end: date, period: str) -> date:
    day_offsets = {"1d": 1, "3d": 3, "1w": 6, "2w": 13}
    if period in day_offsets:
        return end.fromordinal(end.toordinal() - day_offsets[period])
    month_offsets = {
        "1mo": 1,
        "3mo": 3,
        "6mo": 6,
        "1y": 12,
        "2y": 24,
        "3y": 36,
        "5y": 60,
        "10y": 120,
    }
    if period not in month_offsets:
        raise ValueError(f"Unsupported Backtest range: {period}.")
    month_index = end.year * 12 + end.month - 1 - month_offsets[period]
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    day = min(end.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _validate_backtest_request(
    source: Mapping[str, Any],
    request: Mapping[str, Any],
    range_record: Mapping[str, Any],
    baseline: Mapping[str, Any],
    project_root: Path,
) -> None:
    canonical_url, query = _parse_backtest_url(source.get("backtest_url"))
    if canonical_url != source.get("canonical_url"):
        raise ValueError("Canonical Backtest URL does not match its source URL.")
    if _sha256(canonical_url.encode("utf-8")) != source.get("sha256"):
        raise ValueError("Canonical Backtest URL SHA-256 does not match.")
    if request.get("query_params") != dict(sorted(query.items())):
        raise ValueError("Backtest query parameters do not match the compute request.")

    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    from strategies.algorithms.strategy_bayesian_price_field import (
        BayesianPriceFieldStrategy,
    )

    strategy = BayesianPriceFieldStrategy()
    definitions = {
        definition.key: definition
        for definition in strategy.get_parameter_definitions()
    }
    unknown = set(query) - GENERAL_QUERY_KEYS - set(definitions)
    if unknown:
        raise ValueError(
            "Backtest URL contains unsupported query parameters: "
            + ", ".join(sorted(unknown))
            + "."
        )
    ticker = query.get("ticker", "").strip().upper()
    interval = query.get("interval", "1d").strip().lower() or "1d"
    if (
        not ticker
        or query.get("strategy", "") != "bayesian-price-field"
        or interval != "1d"
        or request.get("ticker") != ticker
        or request.get("provider_symbol") != _normalize_provider_symbol(ticker)
        or request.get("strategy") != "bayesian-price-field"
        or request.get("interval") != interval
    ):
        raise ValueError("Backtest identity does not match the compute request.")

    raw_range = query.get("range", "").strip().lower()
    if raw_range in {"exact", "custom"}:
        requested_range = "exact"
        try:
            requested_start = date.fromisoformat(query.get("from", ""))
            requested_end = date.fromisoformat(query.get("to", ""))
            visible_start = date.fromisoformat(str(range_record.get("start")))
            visible_end = date.fromisoformat(str(range_record.get("end")))
        except ValueError as exc:
            raise ValueError("Exact Backtest range dates are invalid.") from exc
        if (
            requested_start > requested_end
            or visible_start != requested_start
            or visible_end > requested_end
        ):
            raise ValueError("Exact Backtest range does not match the compute request.")
    else:
        requested_range = query.get("period", "").strip().lower() or raw_range or "1y"
        try:
            visible_start = date.fromisoformat(str(range_record.get("start")))
            visible_end = date.fromisoformat(str(range_record.get("end")))
        except ValueError as exc:
            raise ValueError("Backtest range dates are invalid.") from exc
        if visible_start != _relative_range_start(visible_end, requested_range):
            raise ValueError("Backtest range dates do not match the requested period.")
    if range_record.get("requested") != requested_range:
        raise ValueError("Backtest range does not match the compute request.")

    startup_params = strategy.get_startup_params()
    raw_params = {
        key: query.get(key, startup_params[key])
        for key in definitions
    }
    normalized = strategy.normalize_params(raw_params)
    if normalized != baseline:
        raise ValueError("URL baseline parameters do not match the Backtest URL.")


def load_config(
    path: Path,
    project_root: Path,
    entrypoint_snapshot: Path,
) -> tuple[dict[str, Any], str, dict[str, Any], str, SearchSpec, dict[str, str]]:
    raw = _read_bounded(path, MAX_CONFIG_BYTES, "Compute config")
    try:
        config = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Compute config is not valid UTF-8 JSON.") from exc
    if not isinstance(config, dict):
        raise ValueError("Compute config must contain one object.")
    if config.get("schema_version") != 1 or config.get("kind") != CONFIG_KIND:
        raise ValueError("Compute config schema or kind is unsupported.")
    source = config.get("source")
    request = config.get("request")
    range_record = config.get("range")
    if not all(isinstance(item, dict) for item in (source, request, range_record)):
        raise ValueError("Compute config source, request, and range must be objects.")
    source_hashes = _validated_source_hashes(
        project_root,
        entrypoint_snapshot,
        config.get("optimizer", {}).get("source_sha256"),
    )
    baseline = config.get("baseline_params")
    if not isinstance(baseline, dict):
        raise ValueError("Compute config baseline_params must be one object.")
    _validate_backtest_request(source, request, range_record, baseline, project_root)
    snapshot_record = config.get("snapshot")
    if not isinstance(snapshot_record, dict):
        raise ValueError("Compute config snapshot must be one object.")
    snapshot, snapshot_sha256 = _decode_snapshot(snapshot_record)
    if (
        snapshot.get("schema_version") != 1
        or snapshot.get("kind") != SNAPSHOT_KIND
    ):
        raise ValueError("Snapshot schema or kind is unsupported.")
    snapshot_bindings = {
        "ticker": request.get("ticker"),
        "interval": request.get("interval"),
        "visible_start": range_record.get("start"),
        "visible_end": range_record.get("end"),
        "symbol": request.get("provider_symbol"),
    }
    for field, expected in snapshot_bindings.items():
        if not isinstance(expected, str) or not expected:
            raise ValueError(f"Compute config is missing the {field} identity binding.")
        if snapshot.get(field) != expected:
            raise ValueError(f"Snapshot {field} does not match the compute request.")
    spec = _parse_search_spec(config)
    return config, _sha256(raw), snapshot, snapshot_sha256, spec, source_hashes


def candidate_key(params: Mapping[str, Any], spec: SearchSpec) -> str:
    genes = {
        name: params[name]
        for name in (*spec.numeric_domains, *spec.factor_parameters)
        if name not in IGNORED_CANDIDATE_PARAMETERS
    }
    return _sha256(_canonical_json_bytes(genes))


def _step_decimals(step: float) -> int:
    text = f"{step:.12f}".rstrip("0")
    return len(text.partition(".")[2])


def canonical_candidate(params: Mapping[str, Any], spec: SearchSpec) -> dict[str, Any]:
    candidate = dict(spec.baseline_params)
    for name, (low, high, step) in spec.numeric_domains.items():
        raw = params.get(name, spec.baseline_params.get(name, low))
        if isinstance(raw, bool):
            raise ValueError(f"Candidate gene {name} must be numeric.")
        value = min(high, max(low, float(raw)))
        value = low + round((value - low) / step) * step
        if name in {"training_window", "chip_window"}:
            candidate[name] = int(round(value))
        else:
            candidate[name] = round(value, _step_decimals(step))
    for name in spec.factor_parameters:
        candidate[name] = bool(params.get(name, spec.baseline_params.get(name, False)))
    return candidate


def random_candidate(rng: random.Random, spec: SearchSpec) -> dict[str, Any]:
    genes: dict[str, Any] = {}
    for name, (low, high, step) in spec.numeric_domains.items():
        steps = int(math.floor((high - low) / step + 1e-9))
        genes[name] = low + rng.randint(0, steps) * step
    for name in spec.factor_parameters:
        genes[name] = bool(rng.getrandbits(1))
    return canonical_candidate(genes, spec)


def breed_candidate(
    first: Mapping[str, Any],
    second: Mapping[str, Any],
    rng: random.Random,
    spec: SearchSpec,
    *,
    mutation_rate: float = 0.20,
) -> dict[str, Any]:
    genes: dict[str, Any] = {}
    for name, (low, high, step) in spec.numeric_domains.items():
        genes[name] = first[name] if rng.random() < 0.5 else second[name]
        if rng.random() < mutation_rate:
            span = int(math.floor((high - low) / step + 1e-9))
            genes[name] = low + rng.randint(0, span) * step
    for name in spec.factor_parameters:
        genes[name] = first[name] if rng.random() < 0.5 else second[name]
        if rng.random() < mutation_rate:
            genes[name] = not bool(genes[name])
    return canonical_candidate(genes, spec)


def score_is_feasible(score: Mapping[str, Any]) -> bool:
    skill = score.get("crps_skill_score")
    horizons = score.get("horizons")
    try:
        finite_skill = math.isfinite(float(skill))
    except (TypeError, ValueError):
        return False
    if (
        not finite_skill
        or score.get("horizon_count") != GRID_HORIZON_COUNT
        or score.get("crps_skill_valid_horizon_count") != GRID_HORIZON_COUNT
        or score.get("crps_skill_required_horizon_count") != GRID_HORIZON_COUNT
        or score.get("crps_skill_has_complete_pair_coverage") is not True
        or not isinstance(horizons, dict)
        or set(horizons) != {str(index) for index in range(1, GRID_HORIZON_COUNT + 1)}
    ):
        return False
    aggregate_eligible = int(score.get("eligible_pairs") or 0)
    if aggregate_eligible <= 0:
        return False
    if score.get("valid_pairs") != score.get("eligible_pairs"):
        return False
    horizon_skills: list[float] = []
    horizon_eligible = 0
    for horizon in horizons.values():
        if not isinstance(horizon, dict):
            return False
        eligible = int(horizon.get("eligible_pairs") or 0)
        if eligible <= 0:
            return False
        if horizon.get("valid_pairs") != horizon.get("eligible_pairs"):
            return False
        try:
            horizon_skill = float(horizon.get("crps_skill_score"))
            if not math.isfinite(horizon_skill):
                return False
        except (TypeError, ValueError):
            return False
        horizon_eligible += eligible
        horizon_skills.append(horizon_skill)
    return (
        horizon_eligible == aggregate_eligible
        and math.isclose(
            float(skill),
            sum(horizon_skills) / GRID_HORIZON_COUNT,
            rel_tol=1e-12,
            abs_tol=1e-12,
        )
    )


def record_rank(record: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        bool(record.get("feasible")),
        float(record.get("mean_validation_crps_skill", -math.inf)),
        float(record.get("worst_validation_crps_skill", -math.inf)),
        -int(record.get("enabled_factor_count", 0)),
        str(record.get("candidate_key", "")),
    )


def _compact_score(score: Mapping[str, Any], *, include_horizons: bool = False) -> dict[str, Any]:
    compact = {
        key: score.get(key)
        for key in (
            "crps_skill_score",
            "crps",
            "reference_crps",
            "horizon_count",
            "eligible_pairs",
            "valid_pairs",
            "coverage_pct",
            "crps_skill_valid_horizon_count",
            "crps_skill_required_horizon_count",
            "crps_skill_has_complete_pair_coverage",
        )
    }
    if include_horizons:
        compact["horizons"] = {
            str(horizon): {
                key: values.get(key)
                for key in (
                    "crps_skill_score",
                    "crps",
                    "reference_crps",
                    "eligible_pairs",
                    "valid_pairs",
                    "coverage_pct",
                )
            }
            for horizon, values in dict(score.get("horizons") or {}).items()
            if isinstance(values, dict)
        }
    return compact


def _observed_date(row: Mapping[str, Any]) -> date:
    value = row.get("observed_at")
    if value is None:
        raise ValueError("Snapshot observation is missing observed_at.")
    parsed = datetime.fromisoformat(str(value))
    return parsed.date()


def _clip_bundle(bundle: Mapping[str, Any], cutoff: date) -> dict[str, Any]:
    clipped = deepcopy(dict(bundle))
    for key, value in tuple(clipped.items()):
        if isinstance(value, list):
            clipped[key] = [
                row
                for row in value
                if not isinstance(row, dict)
                or "observed_at" not in row
                or _observed_date(row) <= cutoff
            ]
    clipped["end"] = cutoff.isoformat()
    clipped["fingerprint"] = _sha256(
        _canonical_json_bytes({"source": bundle.get("fingerprint"), "cutoff": cutoff.isoformat()})
    )
    return clipped


def _runtime_modules(project_root: Path) -> tuple[Any, Any, Any]:
    os.environ["WORTHWARD_REMOTE_MARKET_ACCESS"] = "disabled"
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    from strategies.algorithms import strategy_bayesian_price_field as bayesian
    from strategies.price_field_pipeline import bundle_to_price_field_ohlcv
    from strategies.price_field_scoring import score_price_field_grid

    # Keep every candidate on the same deterministic float64 implementation.
    # This also matches a Worthward runtime without optional Torch installed.
    bayesian._load_torch = lambda: None
    # The macOS compute sandbox rejects process creation. Force the existing
    # ordered implementation to stay serial instead of attempting spawn first.
    bayesian._CPU_PARALLEL_MAX_WORKERS = 1
    return bayesian, bundle_to_price_field_ohlcv, score_price_field_grid


@lru_cache(maxsize=1)
def _runtime_provenance() -> dict[str, Any]:
    """Describe the numeric runtime that produced the optimization evidence."""
    import numpy
    import pandas

    try:
        torch_version = importlib_metadata.version("torch")
    except Exception:
        # Optional package metadata must never invalidate completed evidence.
        torch_version = None
    return {
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "executable": sys.executable,
        "platform": sys.platform,
        "platform_release": platform.release(),
        "machine": platform.machine(),
        "numpy": str(numpy.__version__),
        "pandas": str(pandas.__version__),
        "torch": torch_version,
        "backend_policy": BACKEND_POLICY,
    }


def _compute_provenance(result: Any) -> dict[str, Any]:
    metadata = getattr(result, "metadata", {})
    if not isinstance(metadata, Mapping):
        return {}
    evidence = {
        key: _json_safe(metadata.get(key))
        for key in (
            "compute_device",
            "compute_parallel_workers",
            "compute_parallel_executor",
            "compute_parallel_fallback_reason",
            "fingerprint",
        )
    }
    evidence["runner_backend_policy"] = BACKEND_POLICY
    return evidence


def build_evaluation_context(
    project_root: Path,
    config: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    snapshot_sha256: str,
    spec: SearchSpec,
) -> EvaluationContext:
    _, bundle_to_frame, _ = _runtime_modules(project_root)
    bundle = snapshot.get("bundle", snapshot)
    if not isinstance(bundle, dict):
        raise ValueError("Snapshot bundle must be one object.")
    frame = bundle_to_frame(bundle)
    if frame.empty:
        raise ValueError("Snapshot bundle produced no OHLCV frame.")
    frame = frame.sort_values("Date").reset_index(drop=True)
    start = date.fromisoformat(str(config["range"]["start"]))
    end = date.fromisoformat(str(config["range"]["end"]))
    dates = frame["Date"].dt.date
    visible_indices = [index for index, value in enumerate(dates) if start <= value <= end]
    if not visible_indices:
        raise ValueError("Snapshot contains no bars in the configured visible range.")
    first_visible, last_visible = visible_indices[0], visible_indices[-1]
    if visible_indices != list(range(first_visible, last_visible + 1)):
        raise ValueError("Visible OHLCV rows must be contiguous after date sorting.")
    required_warmup = int(spec.numeric_domains["training_window"][1]) + 2
    if first_visible < required_warmup:
        raise ValueError(
            f"Snapshot has {first_visible} warmup bars; at least {required_warmup} are required."
        )
    visible = frame.iloc[first_visible:last_visible + 1].copy().reset_index(drop=True)
    row_count = len(visible)
    validation_start = int(math.floor(row_count * spec.validation_fraction_start))
    holdout_start = int(math.floor(row_count * spec.holdout_fraction_start))
    if holdout_start - validation_start < VALIDATION_FOLD_COUNT * (GRID_HORIZON_COUNT + 1):
        raise ValueError("Visible history is too short for three complete validation folds.")
    if row_count - holdout_start <= GRID_HORIZON_COUNT:
        raise ValueError("Visible history is too short for a complete final holdout.")
    boundaries = [
        round(validation_start + (holdout_start - validation_start) * index / VALIDATION_FOLD_COUNT)
        for index in range(VALIDATION_FOLD_COUNT + 1)
    ]
    folds = tuple(
        (f"validation-{index + 1}", boundaries[index], boundaries[index + 1])
        for index in range(VALIDATION_FOLD_COUNT)
    )
    cutoff = visible["Date"].iloc[holdout_start - 1].date()
    selection_bundle = _clip_bundle(bundle, cutoff)
    selection_frame = visible.iloc[:holdout_start].copy().reset_index(drop=True)
    return EvaluationContext(
        project_root=project_root,
        snapshot=dict(snapshot),
        snapshot_sha256=snapshot_sha256,
        visible_frame=visible,
        selection_frame=selection_frame,
        selection_bundle=selection_bundle,
        validation_folds=folds,
        holdout_start=holdout_start,
    )


def _score_frame(frame: Any, start: int, end: int, scorer: Any) -> dict[str, Any]:
    return scorer(
        frame,
        start,
        end,
        predictive_mean_column="bayesian_predictive_mean",
        predictive_scale_column="bayesian_predictive_std",
        return_autoregression_column="bayesian_return_autoregression",
        return_long_run_mean_column="bayesian_return_long_run_mean",
        return_innovation_scale_column="bayesian_return_innovation_std",
    )


def evaluate_candidate(
    params: Mapping[str, Any],
    spec: SearchSpec,
    context: EvaluationContext,
    *,
    phase: str,
) -> dict[str, Any]:
    bayesian, _, scorer = _runtime_modules(context.project_root)
    normalized = canonical_candidate(params, spec)
    key = candidate_key(normalized, spec)
    started = time.monotonic()
    strategy = bayesian.BayesianPriceFieldStrategy()
    try:
        if phase == "selection":
            strategy._warmup_bundle = context.selection_bundle
            result = strategy.compute_signals(context.selection_frame, normalized)
            fold_scores = {
                label: _score_frame(result.frame, start, end, scorer)
                for label, start, end in context.validation_folds
            }
            feasible = all(score_is_feasible(score) for score in fold_scores.values())
            skills = [
                float(score["crps_skill_score"])
                for score in fold_scores.values()
                if score_is_feasible(score)
            ]
            return {
                "status": "ok",
                "phase": phase,
                "candidate_key": key,
                "params": normalized,
                "feasible": feasible,
                "mean_validation_crps_skill": (
                    sum(skills) / len(skills) if len(skills) == len(fold_scores) else -1e308
                ),
                "worst_validation_crps_skill": min(skills) if skills else -1e308,
                "enabled_factor_count": sum(
                    bool(normalized[name]) for name in spec.factor_parameters
                ),
                "folds": {
                    label: _compact_score(score, include_horizons=True)
                    for label, score in fold_scores.items()
                },
                "compute": _compute_provenance(result),
                "elapsed_seconds": time.monotonic() - started,
            }
        strategy._warmup_bundle = context.snapshot.get("bundle", context.snapshot)
        result = strategy.compute_signals(context.visible_frame, normalized)
        score = _score_frame(
            result.frame,
            context.holdout_start,
            len(context.visible_frame),
            scorer,
        )
        return {
            "status": "ok",
            "phase": phase,
            "candidate_key": key,
            "params": normalized,
            "feasible": score_is_feasible(score),
            "holdout": _compact_score(score, include_horizons=True),
            "compute": _compute_provenance(result),
            "elapsed_seconds": time.monotonic() - started,
        }
    except (ArithmeticError, ValueError) as exc:
        return {
            "status": "failed",
            "phase": phase,
            "candidate_key": key,
            "params": normalized,
            "feasible": False,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_seconds": time.monotonic() - started,
        }


def _rng_state_to_json(value: object) -> Any:
    if isinstance(value, tuple):
        return [_rng_state_to_json(item) for item in value]
    return value


def _rng_state_from_json(value: object) -> object:
    if isinstance(value, list):
        return tuple(_rng_state_from_json(item) for item in value)
    return value


def _encode_seen(keys: Sequence[str]) -> dict[str, Any]:
    ordered = list(keys)
    if any(
        not isinstance(key, str)
        or len(key) != 64
        or any(character not in "0123456789abcdef" for character in key)
        for key in ordered
    ):
        raise ValueError("Optimizer seen candidates are not canonical SHA-256 keys.")
    if ordered != sorted(set(ordered)):
        raise ValueError("Optimizer seen candidates are not canonical SHA-256 keys.")
    packed = b"".join(bytes.fromhex(key) for key in ordered)
    return {
        "encoding": SEEN_ENCODING,
        "count": len(ordered),
        "data": base64.b64encode(packed).decode("ascii"),
    }


def _decode_seen(raw: object) -> list[str]:
    if not isinstance(raw, dict) or raw.get("encoding") != SEEN_ENCODING:
        raise ValueError("Resume checkpoint seen-candidate encoding is invalid.")
    count = raw.get("count")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError("Resume checkpoint seen-candidate count is invalid.")
    try:
        packed = base64.b64decode(str(raw.get("data") or ""), validate=True)
    except (TypeError, ValueError) as exc:
        raise ValueError("Resume checkpoint seen-candidate data is invalid.") from exc
    if len(packed) != count * 32:
        raise ValueError("Resume checkpoint seen-candidate byte count does not match.")
    keys = [
        packed[offset:offset + 32].hex()
        for offset in range(0, len(packed), 32)
    ]
    if keys != sorted(set(keys)):
        raise ValueError("Resume checkpoint seen candidates are not canonical.")
    return keys


def _initial_population(rng: random.Random, spec: SearchSpec) -> list[dict[str, Any]]:
    population = [canonical_candidate(spec.baseline_params, spec)]
    keys = {candidate_key(population[0], spec)}
    attempts = 0
    while len(population) < spec.population_size and attempts < spec.population_size * 200:
        attempts += 1
        candidate = random_candidate(rng, spec)
        key = candidate_key(candidate, spec)
        if key not in keys:
            population.append(candidate)
            keys.add(key)
    if len(population) != spec.population_size:
        raise RuntimeError("The approved initial genetic population cannot be constructed.")
    return population


def _next_population(
    rng: random.Random,
    spec: SearchSpec,
    leaderboard: Sequence[Mapping[str, Any]],
    seen: set[str],
) -> list[dict[str, Any]]:
    parents = [record["params"] for record in leaderboard if record.get("feasible")][:8]
    if not parents:
        raise RuntimeError("No feasible validation candidate is available for breeding.")
    population: list[dict[str, Any]] = []
    attempts = 0
    while len(population) < spec.population_size and attempts < spec.population_size * 200:
        attempts += 1
        if rng.random() < 0.15:
            candidate = random_candidate(rng, spec)
        else:
            candidate = breed_candidate(rng.choice(parents), rng.choice(parents), rng, spec)
        key = candidate_key(candidate, spec)
        if key in seen or any(candidate_key(item, spec) == key for item in population):
            continue
        population.append(candidate)
    if not population:
        raise RuntimeError("The approved genetic search space is exhausted.")
    return population


def _validated_resume_candidate(
    raw: object,
    spec: SearchSpec,
    *,
    label: str,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"Resume checkpoint {label} must be one candidate object.")
    try:
        normalized = canonical_candidate(raw, spec)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Resume checkpoint {label} candidate is invalid.") from exc
    if normalized != raw:
        raise ValueError(f"Resume checkpoint {label} candidate is not canonical.")
    return normalized


def _compact_score_is_feasible(score: object) -> bool:
    return isinstance(score, dict) and score_is_feasible(score)


def _compute_provenance_is_valid(raw: object) -> bool:
    fingerprint = raw.get("fingerprint") if isinstance(raw, dict) else None
    return (
        isinstance(raw, dict)
        and raw.get("runner_backend_policy") == BACKEND_POLICY
        and raw.get("compute_device") == "cpu"
        and raw.get("compute_parallel_workers") == 1
        and raw.get("compute_parallel_executor") == "serial"
        and isinstance(fingerprint, str)
        and len(fingerprint) == 64
        and not any(character not in "0123456789abcdef" for character in fingerprint)
    )


def _validated_resume_record(
    raw: object,
    spec: SearchSpec,
    context: EvaluationContext,
    *,
    label: str,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"Resume checkpoint {label} must be one record object.")
    record = dict(raw)
    params = _validated_resume_candidate(record.get("params"), spec, label=label)
    expected_key = candidate_key(params, spec)
    if record.get("candidate_key") != expected_key:
        raise ValueError(f"Resume checkpoint {label} candidate key does not match.")
    if record.get("phase") != "selection":
        raise ValueError(f"Resume checkpoint {label} must be selection evidence.")
    if record.get("status") not in {"ok", "failed"}:
        raise ValueError(f"Resume checkpoint {label} status is invalid.")
    if not isinstance(record.get("feasible"), bool):
        raise ValueError(f"Resume checkpoint {label} feasibility is invalid.")
    try:
        record_elapsed = float(record.get("elapsed_seconds"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Resume checkpoint {label} elapsed time is invalid.") from exc
    if not math.isfinite(record_elapsed) or record_elapsed < 0:
        raise ValueError(f"Resume checkpoint {label} elapsed time is invalid.")
    if not record["feasible"]:
        return record
    if record["status"] != "ok":
        raise ValueError(f"Resume checkpoint {label} feasible record did not succeed.")
    folds = record.get("folds")
    expected_folds = [item[0] for item in context.validation_folds]
    if not isinstance(folds, dict) or list(folds) != expected_folds:
        raise ValueError(f"Resume checkpoint {label} validation folds do not match.")
    if not all(_compact_score_is_feasible(score) for score in folds.values()):
        raise ValueError(f"Resume checkpoint {label} CRPS evidence is incomplete.")
    skills = [float(score["crps_skill_score"]) for score in folds.values()]
    mean_skill = float(record.get("mean_validation_crps_skill", math.nan))
    worst_skill = float(record.get("worst_validation_crps_skill", math.nan))
    if not math.isclose(mean_skill, sum(skills) / len(skills), rel_tol=1e-15):
        raise ValueError(f"Resume checkpoint {label} mean CRPS skill does not match.")
    if not math.isclose(worst_skill, min(skills), rel_tol=1e-15):
        raise ValueError(f"Resume checkpoint {label} worst CRPS skill does not match.")
    if record.get("enabled_factor_count") != sum(
        bool(params[name]) for name in spec.factor_parameters
    ):
        raise ValueError(f"Resume checkpoint {label} factor count does not match.")
    if not _compute_provenance_is_valid(record.get("compute")):
        raise ValueError(f"Resume checkpoint {label} compute provenance is invalid.")
    return record


def _validated_resume_holdout_record(
    raw: object,
    expected_params: Mapping[str, Any],
    spec: SearchSpec,
    *,
    phase: str,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"Resume checkpoint {phase} must be one record object.")
    record = dict(raw)
    params = _validated_resume_candidate(record.get("params"), spec, label=phase)
    if (
        params != expected_params
        or record.get("candidate_key") != candidate_key(params, spec)
        or record.get("phase") != phase
        or record.get("status") not in {"ok", "failed"}
        or not isinstance(record.get("feasible"), bool)
    ):
        raise ValueError(f"Resume checkpoint {phase} identity is invalid.")
    try:
        record_elapsed = float(record.get("elapsed_seconds"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Resume checkpoint {phase} elapsed time is invalid.") from exc
    if not math.isfinite(record_elapsed) or record_elapsed < 0:
        raise ValueError(f"Resume checkpoint {phase} elapsed time is invalid.")
    if record["feasible"] and (
        record["status"] != "ok"
        or not score_is_feasible(record.get("holdout", {}))
        or not _compute_provenance_is_valid(record.get("compute"))
    ):
        raise ValueError(f"Resume checkpoint {phase} evidence is invalid.")
    return record


def _validated_resume_state(
    raw: object,
    checkpoint: Mapping[str, Any],
    spec: SearchSpec,
    context: EvaluationContext,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Resume checkpoint has no optimizer_state.")
    required_fields = {
        "phase",
        "generation",
        "pending",
        "inflight",
        "leaderboard",
        "seen",
        "evaluation_count",
        "successful_evaluation_count",
        "failed_evaluation_count",
        "feasible_evaluation_count",
        "elapsed_seconds",
        "selection_elapsed_seconds",
        "url_baseline_validation",
        "frozen_winner",
        "winner_holdout",
        "baseline_holdout",
    }
    if set(raw) != required_fields:
        raise ValueError("Resume checkpoint optimizer_state fields are invalid.")
    state = dict(raw)
    phase = state.get("phase")
    if phase not in {"search", "holdout", "completed"}:
        raise ValueError("Resume checkpoint phase is invalid.")
    generation = state.get("generation")
    evaluation_count = state.get("evaluation_count")
    counters = {
        "generation": generation,
        "evaluation_count": evaluation_count,
        "successful_evaluation_count": state.get("successful_evaluation_count"),
        "failed_evaluation_count": state.get("failed_evaluation_count"),
        "feasible_evaluation_count": state.get("feasible_evaluation_count"),
    }
    for label, value in counters.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"Resume checkpoint {label} is invalid.")
    if (
        counters["successful_evaluation_count"]
        + counters["failed_evaluation_count"]
        != evaluation_count
        or counters["feasible_evaluation_count"]
        > counters["successful_evaluation_count"]
    ):
        raise ValueError("Resume checkpoint evaluation counters are inconsistent.")
    try:
        elapsed_seconds = float(state.get("elapsed_seconds"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Resume checkpoint elapsed_seconds is invalid.") from exc
    if not math.isfinite(elapsed_seconds) or elapsed_seconds < 0:
        raise ValueError("Resume checkpoint elapsed_seconds is invalid.")
    selection_elapsed_raw = state.get("selection_elapsed_seconds")
    if phase == "search":
        if selection_elapsed_raw is not None:
            raise ValueError("Resume checkpoint recorded selection elapsed time during search.")
        selection_elapsed_seconds = None
    else:
        try:
            selection_elapsed_seconds = float(selection_elapsed_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "Resume checkpoint selection_elapsed_seconds is invalid."
            ) from exc
        if (
            not math.isfinite(selection_elapsed_seconds)
            or selection_elapsed_seconds < spec.search_duration_seconds
            or selection_elapsed_seconds > elapsed_seconds
        ):
            raise ValueError("Resume checkpoint selection elapsed time is inconsistent.")

    seen = _decode_seen(state.get("seen"))
    if evaluation_count != len(seen):
        raise ValueError("Resume checkpoint seen candidates are inconsistent.")
    seen_set = set(seen)

    raw_pending = state.get("pending")
    if not isinstance(raw_pending, list):
        raise ValueError("Resume checkpoint pending population is invalid.")
    pending = [
        _validated_resume_candidate(item, spec, label=f"pending[{index}]")
        for index, item in enumerate(raw_pending)
    ]
    inflight_raw = state.get("inflight")
    inflight = (
        None
        if inflight_raw is None
        else _validated_resume_candidate(inflight_raw, spec, label="inflight")
    )
    if inflight is not None and phase != "search":
        raise ValueError("Resume checkpoint has inflight work outside search.")
    queued_keys = [candidate_key(item, spec) for item in pending]
    if inflight is not None:
        queued_keys.append(candidate_key(inflight, spec))
    if len(queued_keys) != len(set(queued_keys)) or seen_set.intersection(queued_keys):
        raise ValueError("Resume checkpoint queued candidates are inconsistent.")
    if phase != "search" and queued_keys:
        raise ValueError("Resume checkpoint has queued work after search.")
    if phase != "search" and elapsed_seconds < spec.search_duration_seconds:
        raise ValueError("Resume checkpoint ended search before its duration budget.")

    raw_leaderboard = state.get("leaderboard")
    if not isinstance(raw_leaderboard, list) or len(raw_leaderboard) > MAX_LEADERBOARD_RECORDS:
        raise ValueError("Resume checkpoint leaderboard is invalid.")
    leaderboard = [
        _validated_resume_record(
            item,
            spec,
            context,
            label=f"leaderboard[{index}]",
        )
        for index, item in enumerate(raw_leaderboard)
    ]
    leaderboard_keys = [str(item["candidate_key"]) for item in leaderboard]
    if (
        len(leaderboard_keys) != len(set(leaderboard_keys))
        or not set(leaderboard_keys).issubset(seen_set)
        or leaderboard != sorted(leaderboard, key=record_rank, reverse=True)
    ):
        raise ValueError("Resume checkpoint leaderboard is inconsistent.")

    baseline_raw = state.get("url_baseline_validation")
    if evaluation_count == 0:
        if baseline_raw is not None or leaderboard or seen:
            raise ValueError("Resume checkpoint has evidence before baseline evaluation.")
        next_candidate = inflight if inflight is not None else (pending[0] if pending else None)
        expected_baseline = canonical_candidate(spec.baseline_params, spec)
        if phase != "search" or next_candidate != expected_baseline:
            raise ValueError("Resume checkpoint must evaluate the URL baseline first.")
        baseline = None
    else:
        baseline = _validated_resume_record(
            baseline_raw,
            spec,
            context,
            label="URL baseline",
        )
        expected_baseline = canonical_candidate(spec.baseline_params, spec)
        if (
            baseline.get("params") != expected_baseline
            or baseline.get("candidate_key") != candidate_key(expected_baseline, spec)
            or not baseline.get("feasible")
            or baseline.get("candidate_key") not in seen_set
        ):
            raise ValueError("Resume checkpoint URL baseline is inconsistent.")

    winner_raw = state.get("frozen_winner")
    if phase == "search":
        if winner_raw is not None:
            raise ValueError("Resume checkpoint froze a winner during search.")
        winner = None
    else:
        winner = _validated_resume_record(
            winner_raw,
            spec,
            context,
            label="frozen winner",
        )
        if not leaderboard or not winner.get("feasible") or winner != leaderboard[0]:
            raise ValueError("Resume checkpoint frozen winner is inconsistent.")

    winner_holdout_raw = state.get("winner_holdout")
    baseline_holdout_raw = state.get("baseline_holdout")
    if phase == "search":
        if winner_holdout_raw is not None or baseline_holdout_raw is not None:
            raise ValueError("Resume checkpoint has holdout evidence during search.")
        winner_holdout = None
        baseline_holdout = None
    else:
        winner_holdout = (
            None
            if winner_holdout_raw is None
            else _validated_resume_holdout_record(
                winner_holdout_raw,
                winner["params"],
                spec,
                phase="winner-holdout",
            )
        )
        baseline_holdout = (
            None
            if baseline_holdout_raw is None
            else _validated_resume_holdout_record(
                baseline_holdout_raw,
                baseline["params"],
                spec,
                phase="url-baseline-holdout",
            )
        )
        if baseline_holdout is not None and winner_holdout is None:
            raise ValueError("Resume checkpoint baseline holdout precedes winner holdout.")
        if phase == "completed" and (
            winner_holdout is None
            or baseline_holdout is None
            or not winner_holdout.get("feasible")
            or not baseline_holdout.get("feasible")
        ):
            raise ValueError("Resume checkpoint completed holdout evidence is missing.")

    best = leaderboard[0] if leaderboard else {}
    if (
        checkpoint.get("iteration") != generation
        or checkpoint.get("evaluation_count") != evaluation_count
        or checkpoint.get("population") != raw_pending
        or checkpoint.get("best_parameters") != dict(best.get("params") or {})
        or checkpoint.get("best_objective")
        != float(best.get("mean_validation_crps_skill", -1e308))
    ):
        raise ValueError("Resume checkpoint summary does not match optimizer_state.")
    state.update({
        "pending": pending,
        "inflight": inflight,
        "leaderboard": leaderboard,
        "seen": seen,
        "url_baseline_validation": baseline,
        "frozen_winner": winner,
        "winner_holdout": winner_holdout,
        "baseline_holdout": baseline_holdout,
        "elapsed_seconds": elapsed_seconds,
        "selection_elapsed_seconds": selection_elapsed_seconds,
    })
    return state


def _checkpoint_payload(
    state: Mapping[str, Any],
    rng: random.Random,
    spec: SearchSpec,
    config_sha256: str,
    context: EvaluationContext,
    source_hashes: Mapping[str, str],
) -> dict[str, Any]:
    leaderboard = list(state.get("leaderboard") or [])
    best = leaderboard[0] if leaderboard else {}
    runtime = _runtime_provenance()
    optimizer_state = dict(state)
    optimizer_state["seen"] = _encode_seen(list(state.get("seen") or []))
    payload = {
        "schema_version": 1,
        "optimizer_version": OPTIMIZER_VERSION,
        "iteration": int(state.get("generation", 0)),
        "population": list(state.get("pending") or []),
        "rng_state": _rng_state_to_json(rng.getstate()),
        "seed": spec.seed,
        "best_objective": float(best.get("mean_validation_crps_skill", -1e308)),
        "best_parameters": dict(best.get("params") or {}),
        "evaluation_count": int(state.get("evaluation_count", 0)),
        "config_sha256": config_sha256,
        "snapshot_sha256": context.snapshot_sha256,
        "source_sha256": dict(source_hashes),
        "runtime": runtime,
        "runtime_sha256": _sha256(_canonical_json_bytes(runtime)),
        "optimizer_state": _json_safe(optimizer_state),
    }
    if len(_canonical_json_bytes(payload)) > MAX_CHECKPOINT_BYTES:
        raise RuntimeError("Optimizer checkpoint exceeds the 1 MiB resume contract.")
    return payload


def _write_checkpoint(
    runtime: Path,
    state: Mapping[str, Any],
    rng: random.Random,
    spec: SearchSpec,
    config_sha256: str,
    context: EvaluationContext,
    source_hashes: Mapping[str, str],
) -> None:
    _atomic_write_json(
        runtime / "checkpoint.json",
        _checkpoint_payload(
            state,
            rng,
            spec,
            config_sha256,
            context,
            source_hashes,
        ),
    )


def _load_resume(
    path: Path,
    spec: SearchSpec,
    config_sha256: str,
    context: EvaluationContext,
    source_hashes: Mapping[str, str],
) -> tuple[dict[str, Any], random.Random]:
    raw = _read_bounded(path, MAX_CHECKPOINT_BYTES, "Resume checkpoint")
    try:
        checkpoint = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Resume checkpoint is not valid UTF-8 JSON.") from exc
    if not isinstance(checkpoint, dict) or checkpoint.get("schema_version") != 1:
        raise ValueError("Resume checkpoint schema is invalid.")
    comparisons = {
        "optimizer_version": OPTIMIZER_VERSION,
        "seed": spec.seed,
        "config_sha256": config_sha256,
        "snapshot_sha256": context.snapshot_sha256,
        "source_sha256": dict(source_hashes),
        "runtime": _runtime_provenance(),
        "runtime_sha256": _sha256(_canonical_json_bytes(_runtime_provenance())),
    }
    for key, expected in comparisons.items():
        if checkpoint.get(key) != expected:
            raise ValueError(f"Resume checkpoint {key} does not match this request.")
    state = _validated_resume_state(
        checkpoint.get("optimizer_state"),
        checkpoint,
        spec,
        context,
    )
    pending = list(state.get("pending") or [])
    inflight = state.get("inflight")
    if isinstance(inflight, dict):
        pending.insert(0, inflight)
    state = dict(state)
    state["pending"] = pending
    state["inflight"] = None
    rng = random.Random()
    rng.setstate(_rng_state_from_json(checkpoint.get("rng_state")))
    return state, rng


def _progress(
    runtime: Path,
    state: Mapping[str, Any],
    elapsed: float,
    budget: float,
    summary: str,
) -> None:
    leaderboard = list(state.get("leaderboard") or [])
    best = leaderboard[0] if leaderboard else {}
    _atomic_write_json(runtime / "progress.json", {
        "generation": int(state.get("generation", 0)),
        "evaluations_completed": int(state.get("evaluation_count", 0)),
        "best_objective": float(best.get("mean_validation_crps_skill", -1e308)),
        "elapsed_seconds": max(0.0, elapsed),
        "eta_seconds": max(0.0, budget - elapsed),
        "summary": str(summary)[:1_000],
    })


def _final_summary(result: Mapping[str, Any], spec: SearchSpec) -> str:
    winner = result["winner"]
    baseline = result["url_baseline"]
    holdout = winner["holdout"]["crps_skill_score"]
    baseline_holdout = baseline["holdout"]["crps_skill_score"]
    genes = {
        name: winner["params"][name]
        for name in (*spec.numeric_domains, *spec.factor_parameters)
    }
    return (
        f"Completed Bayesian CRPS GA: validation={winner['validation_crps_skill']:.6f}; "
        f"holdout={holdout:.6f}; URL baseline holdout={baseline_holdout:.6f}; "
        f"delta={holdout - baseline_holdout:+.6f}; genes="
        f"{json.dumps(genes, ensure_ascii=True, sort_keys=True, separators=(',', ':'))}"
    )[:1_000]


def _evaluation_issue(record: Mapping[str, Any]) -> str:
    if record.get("status") == "failed":
        return str(record.get("error") or "unknown candidate error")[:500]
    return "incomplete 20-horizon CRPS or pair coverage"


def run_job(config_path: Path, runtime: Path, resume_path: Path | None = None) -> int:
    project_root = resolve_project_root()
    runtime = runtime.resolve(strict=True)
    if not runtime.is_dir() or runtime.is_symlink():
        raise ValueError("Job runtime must be one existing non-linked directory.")
    (
        config,
        config_sha256,
        snapshot,
        snapshot_sha256,
        spec,
        source_hashes,
    ) = load_config(config_path, project_root, Path(__file__).resolve())
    context = build_evaluation_context(
        project_root,
        config,
        snapshot,
        snapshot_sha256,
        spec,
    )
    if resume_path is not None:
        state, rng = _load_resume(
            resume_path,
            spec,
            config_sha256,
            context,
            source_hashes,
        )
    else:
        rng = random.Random(spec.seed)
        state = {
            "phase": "search",
            "generation": 0,
            "pending": _initial_population(rng, spec),
            "inflight": None,
            "leaderboard": [],
            "seen": [],
            "evaluation_count": 0,
            "successful_evaluation_count": 0,
            "failed_evaluation_count": 0,
            "feasible_evaluation_count": 0,
            "elapsed_seconds": 0.0,
            "selection_elapsed_seconds": None,
            "url_baseline_validation": None,
            "frozen_winner": None,
            "winner_holdout": None,
            "baseline_holdout": None,
        }
    elapsed_before = float(state.get("elapsed_seconds", 0.0))
    started = time.monotonic()

    def elapsed() -> float:
        return elapsed_before + time.monotonic() - started

    _write_checkpoint(
        runtime,
        state,
        rng,
        spec,
        config_sha256,
        context,
        source_hashes,
    )
    while state.get("phase") == "search":
        pending = list(state.get("pending") or [])
        if elapsed() >= spec.search_duration_seconds:
            feasible = [
                item for item in state["leaderboard"] if item.get("feasible")
            ]
            if not feasible:
                raise RuntimeError("No complete CRPS validation candidate was found.")
            state["frozen_winner"] = feasible[0]
            state["phase"] = "holdout"
            state["pending"] = []
            state["elapsed_seconds"] = elapsed()
            state["selection_elapsed_seconds"] = state["elapsed_seconds"]
            _write_checkpoint(
                runtime,
                state,
                rng,
                spec,
                config_sha256,
                context,
                source_hashes,
            )
            break
        if not pending:
            state["generation"] = int(state["generation"]) + 1
            state["pending"] = _next_population(
                rng,
                spec,
                state["leaderboard"],
                set(map(str, state["seen"])),
            )
            pending = list(state["pending"])

        candidate = canonical_candidate(pending.pop(0), spec)
        key = candidate_key(candidate, spec)
        state["pending"] = pending
        state["inflight"] = candidate
        state["elapsed_seconds"] = elapsed()
        _write_checkpoint(
            runtime,
            state,
            rng,
            spec,
            config_sha256,
            context,
            source_hashes,
        )
        _progress(
            runtime,
            state,
            elapsed(),
            spec.search_duration_seconds,
            f"Evaluating generation {state['generation']} candidate {state['evaluation_count'] + 1}.",
        )
        record = evaluate_candidate(candidate, spec, context, phase="selection")
        _append_jsonl(runtime / "evaluations.jsonl", record)
        state["inflight"] = None
        state["evaluation_count"] = int(state["evaluation_count"]) + 1
        if record.get("status") == "ok":
            state["successful_evaluation_count"] = (
                int(state["successful_evaluation_count"]) + 1
            )
        else:
            state["failed_evaluation_count"] = (
                int(state["failed_evaluation_count"]) + 1
            )
        if record.get("feasible"):
            state["feasible_evaluation_count"] = (
                int(state["feasible_evaluation_count"]) + 1
            )
        state["seen"] = sorted({*map(str, state["seen"]), key})
        if int(state["evaluation_count"]) == 1:
            expected_baseline = canonical_candidate(spec.baseline_params, spec)
            if (
                record.get("params") != expected_baseline
                or record.get("candidate_key")
                != candidate_key(expected_baseline, spec)
            ):
                raise RuntimeError("The first evaluation was not the URL baseline.")
            state["url_baseline_validation"] = record
            if not record.get("feasible"):
                raise RuntimeError(
                    "URL baseline did not produce complete CRPS validation evidence."
                )
        state["leaderboard"] = sorted(
            [*state["leaderboard"], record],
            key=record_rank,
            reverse=True,
        )[:MAX_LEADERBOARD_RECORDS]
        state["elapsed_seconds"] = elapsed()
        _write_checkpoint(
            runtime,
            state,
            rng,
            spec,
            config_sha256,
            context,
            source_hashes,
        )

    winner_validation = state.get("frozen_winner")
    baseline_validation = state.get("url_baseline_validation")
    if (
        not isinstance(winner_validation, dict)
        or not isinstance(baseline_validation, dict)
        or not baseline_validation.get("feasible")
    ):
        raise RuntimeError("Frozen winner or URL baseline validation evidence is missing.")
    _progress(
        runtime,
        state,
        elapsed(),
        spec.search_duration_seconds,
        "Selection frozen; evaluating the untouched holdout.",
    )
    winner_holdout = state.get("winner_holdout")
    if not isinstance(winner_holdout, dict):
        winner_holdout = evaluate_candidate(
            winner_validation["params"],
            spec,
            context,
            phase="winner-holdout",
        )
        _append_jsonl(runtime / "evaluations.jsonl", winner_holdout)
        state["winner_holdout"] = winner_holdout
        state["elapsed_seconds"] = elapsed()
        _write_checkpoint(
            runtime,
            state,
            rng,
            spec,
            config_sha256,
            context,
            source_hashes,
        )
    if not winner_holdout.get("feasible"):
        raise RuntimeError(
            "Frozen winner did not produce complete holdout CRPS evidence: "
            + _evaluation_issue(winner_holdout)
        )
    baseline_key = candidate_key(baseline_validation["params"], spec)
    baseline_holdout = state.get("baseline_holdout")
    if not isinstance(baseline_holdout, dict):
        if baseline_key == winner_holdout["candidate_key"]:
            baseline_holdout = dict(winner_holdout)
            baseline_holdout["phase"] = "url-baseline-holdout"
        else:
            baseline_holdout = evaluate_candidate(
                baseline_validation["params"],
                spec,
                context,
                phase="url-baseline-holdout",
            )
            _append_jsonl(runtime / "evaluations.jsonl", baseline_holdout)
        state["baseline_holdout"] = baseline_holdout
        state["elapsed_seconds"] = elapsed()
        _write_checkpoint(
            runtime,
            state,
            rng,
            spec,
            config_sha256,
            context,
            source_hashes,
        )
    if not baseline_holdout.get("feasible"):
        raise RuntimeError(
            "URL baseline did not produce complete holdout CRPS evidence: "
            + _evaluation_issue(baseline_holdout)
        )
    result = {
        "schema_version": 1,
        "optimizer_version": OPTIMIZER_VERSION,
        "status": "completed",
        "completed_at": _utc_now(),
        "config_sha256": config_sha256,
        "snapshot_sha256": snapshot_sha256,
        "source_sha256": source_hashes,
        "runtime": _runtime_provenance(),
        "source": config["source"],
        "request": config["request"],
        "range": config["range"],
        "scoring_baseline": "causal-zero-drift-distribution",
        "selection_uses_holdout": False,
        "generation": int(state["generation"]),
        "evaluation_count": int(state["evaluation_count"]),
        "successful_evaluation_count": int(state["successful_evaluation_count"]),
        "failed_evaluation_count": int(state["failed_evaluation_count"]),
        "feasible_evaluation_count": int(state["feasible_evaluation_count"]),
        "selection_elapsed_seconds": float(state["selection_elapsed_seconds"]),
        "completed_elapsed_seconds": elapsed(),
        "winner": {
            "params": winner_validation["params"],
            "validation_crps_skill": winner_validation["mean_validation_crps_skill"],
            "worst_validation_crps_skill": winner_validation["worst_validation_crps_skill"],
            "validation_folds": winner_validation["folds"],
            "validation_compute": winner_validation.get("compute", {}),
            "holdout": winner_holdout["holdout"],
            "holdout_compute": winner_holdout.get("compute", {}),
        },
        "url_baseline": {
            "params": baseline_validation["params"],
            "validation_crps_skill": baseline_validation["mean_validation_crps_skill"],
            "worst_validation_crps_skill": baseline_validation["worst_validation_crps_skill"],
            "validation_folds": baseline_validation["folds"],
            "validation_compute": baseline_validation.get("compute", {}),
            "holdout": baseline_holdout["holdout"],
            "holdout_compute": baseline_holdout.get("compute", {}),
        },
    }
    result["winner_vs_url_baseline"] = {
        "validation_crps_skill_delta": (
            result["winner"]["validation_crps_skill"]
            - result["url_baseline"]["validation_crps_skill"]
        ),
        "holdout_crps_skill_delta": (
            result["winner"]["holdout"]["crps_skill_score"]
            - result["url_baseline"]["holdout"]["crps_skill_score"]
        ),
    }
    _atomic_write_json(runtime / "result.json", result)
    state["phase"] = "completed"
    state["elapsed_seconds"] = elapsed()
    _write_checkpoint(
        runtime,
        state,
        rng,
        spec,
        config_sha256,
        context,
        source_hashes,
    )
    summary = _final_summary(result, spec)
    _progress(
        runtime,
        state,
        elapsed(),
        spec.search_duration_seconds,
        summary,
    )
    print(summary, flush=True)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one approved offline Bayesian Price Field CRPS GA job.",
    )
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--job-runtime", required=True, type=Path)
    parser.add_argument("--resume", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    def interrupted(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    for signal_number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signal_number, interrupted)
    try:
        return run_job(args.config, args.job_runtime, args.resume)
    except KeyboardInterrupt:
        print("Bayesian CRPS GA interrupted; the latest complete checkpoint is preserved.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(
            f"Bayesian CRPS GA failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
