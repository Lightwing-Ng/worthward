"""Prepare a frozen Bayesian CRPS GA configuration for a durable job.

This explicit preparation step is the only phase that may ask the existing
read-only market-factor service for remote data. The emitted configuration
contains a deterministic, compressed snapshot so the durable optimizer can run
without network access or provider credentials.

Code version: v1.2.2
"""

from __future__ import annotations

import argparse
import base64
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import stat
import sys
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import PERIOD_OFFSETS  # noqa: E402
from app.infrastructure.broker_market_data import (  # noqa: E402
    normalize_longbridge_symbol,
)
from strategies.algorithms.strategy_bayesian_price_field import (  # noqa: E402
    BayesianPriceFieldStrategy,
)
from strategies.price_field.pipeline import (  # noqa: E402
    load_price_field_market_bundle,
)


UTC = timezone.utc
NEW_YORK = ZoneInfo("America/New_York")
CONFIG_SCHEMA_VERSION = 1
SNAPSHOT_SCHEMA_VERSION = 1
CONFIG_KIND = "worthward-bayesian-crps-ga"
SNAPSHOT_KIND = "worthward-price-field-market-bundle"
OPTIMIZER_VERSION = "worthward-bayesian-crps-ga/v1.2.0"
MAX_CONFIG_BYTES = 1_048_576
MAX_SNAPSHOT_BYTES = 16 * 1_048_576
OUTPUT_DIRECTORY_NAME = "outputs"
GA_SEED = 20_260_914
POPULATION_SIZE = 12
SEARCH_DURATION_SECONDS = 37_800
VALIDATION_FRACTION_START = 0.20
HOLDOUT_FRACTION_START = 0.80
MAX_TRAINING_WINDOW = 504
MAX_CHIP_WINDOW = 252

FACTOR_PARAMETERS = (
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
NUMERIC_DOMAINS = {
    "training_window": [30, 504, 1],
    "chip_window": [5, 252, 1],
    "prior_strength": [0.01, 100.0, 0.01],
}
OPTION_PARAMETER_FIELDS: dict[str, tuple[str, ...]] = {
    "use_option_call_volume": ("call_volume",),
    "use_option_put_call_open_interest_ratio": (
        "put_call_open_interest_ratio",
        "put_open_interest",
        "call_open_interest",
    ),
    "use_option_put_call_volume_ratio": (
        "put_call_volume_ratio",
        "put_volume",
        "call_volume",
    ),
}
CRITICAL_SOURCE_PATHS = (
    "app/infrastructure/broker_market_data.py",
    "app/infrastructure/parallel.py",
    "app/services/research/price_field_market_factors.py",
    "strategies/base.py",
    "strategies/algorithms/strategy_bayesian_price_field.py",
    "strategies/interval_bridge.py",
    "strategies/price_field/contract.py",
    "strategies/price_field/pipeline.py",
    "strategies/price_field/scoring.py",
    "scripts/bayesian_crps_ga_job.py",
    "scripts/prepare_bayesian_crps_ga_config.py",
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
BUNDLE_KEYS = (
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


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_json_bytes(payload: object) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _timestamp(value: datetime | date | object) -> str:
    parsed = datetime.fromisoformat(str(value)) if isinstance(value, str) else value
    if isinstance(parsed, datetime):
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(UTC)
        return parsed.isoformat()
    if isinstance(parsed, date):
        return parsed.isoformat()
    raise TypeError(f"Unsupported date value: {type(value).__name__}.")


def _json_safe(value: object) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Market snapshot contains a non-finite number.")
        return value
    if isinstance(value, (datetime, date)):
        return _timestamp(value)
    if is_dataclass(value) and not isinstance(value, type):
        return _json_safe(asdict(value))
    if isinstance(value, Mapping):
        return {
            str(key): _json_safe(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    raise TypeError(
        "Market snapshot contains an unsupported value: "
        f"{type(value).__name__}."
    )


def _record_value(record: object, key: str, default: object = None) -> object:
    if isinstance(record, Mapping):
        return record.get(key, default)
    return getattr(record, key, default)


def _parse_query(backtest_url: str) -> tuple[str, dict[str, str]]:
    parsed = urlsplit(str(backtest_url).strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Backtest URL must be an absolute HTTP or HTTPS URL.")
    if parsed.username or parsed.password:
        raise ValueError("Backtest URL must not contain credentials.")
    if parsed.path.rstrip("/") != "/workspaces/backtest":
        raise ValueError("Backtest URL must target /workspaces/backtest.")
    if parsed.fragment:
        raise ValueError("Backtest URL must not contain a fragment.")

    pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    values: dict[str, str] = {}
    for key, value in pairs:
        if key in values:
            raise ValueError(f"Backtest URL repeats query parameter {key!r}.")
        values[key] = value

    canonical_query = urlencode(sorted(values.items()))
    canonical_url = urlunsplit((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        "/workspaces/backtest",
        canonical_query,
        "",
    ))
    return canonical_url, values


def _resolve_request(
    backtest_url: str,
    *,
    as_of: date | None,
) -> dict[str, Any]:
    canonical_url, query = _parse_query(backtest_url)
    strategy = BayesianPriceFieldStrategy()
    definitions = {
        definition.key: definition
        for definition in strategy.get_parameter_definitions()
    }
    unknown = set(query) - GENERAL_QUERY_KEYS - set(definitions)
    if unknown:
        raise ValueError(
            "Backtest URL contains unsupported query parameters: "
            f"{', '.join(sorted(unknown))}."
        )
    if query.get("strategy", "") != "bayesian-price-field":
        raise ValueError("Backtest URL must select bayesian-price-field.")
    interval = query.get("interval", "1d").strip().lower() or "1d"
    if interval != "1d":
        raise ValueError("Bayesian CRPS GA preparation requires interval=1d.")

    ticker = query.get("ticker", "").strip().upper()
    if not ticker:
        raise ValueError("Backtest URL must provide exactly one ticker.")
    provider_symbol = normalize_longbridge_symbol(ticker)

    raw_range = query.get("range", "").strip().lower()
    period = query.get("period", "").strip().lower()
    if raw_range in {"exact", "custom"}:
        start_text = query.get("from", "").strip()
        end_text = query.get("to", "").strip()
        if not start_text or not end_text:
            raise ValueError("An exact Backtest range requires from and to dates.")
        requested_start = date.fromisoformat(start_text)
        requested_end = date.fromisoformat(end_text)
        requested_range = "exact"
    else:
        requested_range = period or raw_range or "1y"
        if requested_range not in PERIOD_OFFSETS:
            raise ValueError(f"Unsupported Backtest range: {requested_range}.")
        requested_end = as_of or datetime.now(NEW_YORK).date()
        requested_start = (
            datetime.combine(requested_end, datetime.min.time())
            - PERIOD_OFFSETS[requested_range]
        ).date()
    if requested_start > requested_end:
        raise ValueError("Backtest range start must not be after its end.")

    startup_params = strategy.get_startup_params()
    raw_params = {
        key: query.get(key, startup_params[key])
        for key in definitions
    }
    baseline_params = strategy.normalize_params(raw_params)
    return {
        "canonical_url": canonical_url,
        "query": dict(sorted(query.items())),
        "ticker": ticker,
        "provider_symbol": provider_symbol,
        "interval": interval,
        "requested_range": requested_range,
        "requested_start": requested_start,
        "requested_end": requested_end,
        "baseline_params": baseline_params,
    }


def _bundle_payload(bundle: object) -> dict[str, Any]:
    payload = {
        key: _json_safe(_record_value(bundle, key))
        for key in BUNDLE_KEYS
    }
    payload["schema_version"] = SNAPSHOT_SCHEMA_VERSION
    payload["kind"] = SNAPSHOT_KIND
    return payload


def _observed_date(record: object) -> date:
    raw_value = _record_value(record, "observed_at")
    if raw_value is None:
        raise ValueError("Market snapshot row is missing observed_at.")
    value = datetime.fromisoformat(raw_value) if isinstance(raw_value, str) else raw_value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raise ValueError("Market snapshot row has an invalid observed_at value.")


def _finite_option_value(record: object, key: str) -> float | None:
    raw_value = _record_value(record, key)
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0.0 else None


def _has_requested_option_value(
    history: Sequence[object],
    parameter: str,
) -> bool:
    if parameter == "use_options":
        return any(
            _has_requested_option_value(history, detailed_parameter)
            for detailed_parameter in (
                "use_option_put_call_open_interest_ratio",
                "use_option_put_call_volume_ratio",
            )
        )
    fields = OPTION_PARAMETER_FIELDS.get(parameter, ())
    if len(fields) == 1:
        return any(
            _finite_option_value(row, fields[0]) is not None
            for row in history
        )
    direct, numerator, denominator = fields
    return any(
        _finite_option_value(row, direct) is not None
        or (
            _finite_option_value(row, numerator) is not None
            and (_finite_option_value(row, denominator) or 0.0) > 0.0
        )
        for row in history
    )


def _validate_requested_options(
    bundle: object,
    baseline_params: Mapping[str, Any],
) -> None:
    requested = tuple(
        parameter
        for parameter in FACTOR_PARAMETERS
        if parameter.startswith("use_option")
        and bool(baseline_params.get(parameter))
    )
    if not requested:
        return
    statuses = _record_value(bundle, "factor_status", {})
    option_status = str(
        statuses.get("options", "") if isinstance(statuses, Mapping) else ""
    ).strip().lower()
    history = tuple(_record_value(bundle, "option_history", ()) or ())
    if option_status != "available" or not history:
        raise ValueError(
            "Requested option factors are unavailable; refusing to prepare "
            f"a partial snapshot (options status: {option_status or 'missing'})."
        )
    missing = [
        parameter
        for parameter in requested
        if not _has_requested_option_value(history, parameter)
    ]
    if missing:
        raise ValueError(
            "Requested option factors have no usable history: "
            f"{', '.join(missing)}."
        )


def _source_sha256() -> dict[str, str]:
    result: dict[str, str] = {}
    for relative_path in CRITICAL_SOURCE_PATHS:
        path = PROJECT_ROOT / relative_path
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Critical source is unavailable: {relative_path}.")
        result[relative_path] = _sha256(path.read_bytes())
    return result


def build_config(
    backtest_url: str,
    *,
    as_of: date | None = None,
    prepared_at: datetime | None = None,
) -> dict[str, Any]:
    """Load one broad read-only bundle and return its durable GA config."""
    request = _resolve_request(backtest_url, as_of=as_of)
    loader_params = dict(request["baseline_params"])
    loader_params["training_window"] = MAX_TRAINING_WINDOW
    loader_params["chip_window"] = MAX_CHIP_WINDOW
    bundle = load_price_field_market_bundle(
        (request["ticker"],),
        interval=request["interval"],
        start=request["requested_start"],
        end=request["requested_end"],
        params=loader_params,
    )
    ohlcv = tuple(_record_value(bundle, "ohlcv", ()) or ())
    if not ohlcv:
        raise ValueError("Price Field provider returned no OHLCV history.")
    latest_bar = max(_observed_date(row) for row in ohlcv)
    if latest_bar > request["requested_end"]:
        raise ValueError("Price Field provider returned OHLCV after the requested end.")
    if request["requested_range"] == "exact":
        visible_start = request["requested_start"]
    else:
        visible_start = (
            datetime.combine(latest_bar, datetime.min.time())
            - PERIOD_OFFSETS[request["requested_range"]]
        ).date()
    if not any(visible_start <= _observed_date(row) <= latest_bar for row in ohlcv):
        raise ValueError("Price Field provider returned no OHLCV in the visible range.")
    _validate_requested_options(bundle, request["baseline_params"])

    snapshot_payload = _bundle_payload(bundle)
    snapshot_payload.update({
        "ticker": request["ticker"],
        "interval": request["interval"],
        "visible_start": visible_start.isoformat(),
        "visible_end": latest_bar.isoformat(),
    })
    snapshot_bytes = _canonical_json_bytes(snapshot_payload)
    if len(snapshot_bytes) > MAX_SNAPSHOT_BYTES:
        raise ValueError(
            "Market snapshot is too large after canonicalization: "
            f"{len(snapshot_bytes):,} bytes; limit is {MAX_SNAPSHOT_BYTES:,} bytes."
        )
    compressed = gzip.compress(snapshot_bytes, mtime=0)
    encoded_snapshot = base64.b64encode(compressed).decode("ascii")
    canonical_url = request["canonical_url"]
    resolved_prepared_at = prepared_at or datetime.now(UTC)
    if resolved_prepared_at.tzinfo is None:
        resolved_prepared_at = resolved_prepared_at.replace(tzinfo=UTC)

    config = {
        "schema_version": CONFIG_SCHEMA_VERSION,
        "kind": CONFIG_KIND,
        "prepared_at": resolved_prepared_at.astimezone(UTC).isoformat(),
        "source": {
            "backtest_url": backtest_url,
            "canonical_url": canonical_url,
            "sha256": _sha256(canonical_url.encode("utf-8")),
        },
        "request": {
            "ticker": request["ticker"],
            "provider_symbol": request["provider_symbol"],
            "strategy": "bayesian-price-field",
            "interval": request["interval"],
            "query_params": request["query"],
        },
        "range": {
            "requested": request["requested_range"],
            "start": visible_start.isoformat(),
            "end": latest_bar.isoformat(),
            "broad_fetch_start": _timestamp(_record_value(bundle, "start")),
            "broad_fetch_end": _timestamp(_record_value(bundle, "end")),
            "max_warmup": {
                "training_window": MAX_TRAINING_WINDOW,
                "chip_window": MAX_CHIP_WINDOW,
            },
        },
        "baseline_params": request["baseline_params"],
        "optimizer": {
            "version": OPTIMIZER_VERSION,
            "seed": GA_SEED,
            "population_size": POPULATION_SIZE,
            "search_duration_seconds": SEARCH_DURATION_SECONDS,
            "validation_fraction_start": VALIDATION_FRACTION_START,
            "holdout_fraction_start": HOLDOUT_FRACTION_START,
            "numeric_domains": NUMERIC_DOMAINS,
            "factor_parameters": list(FACTOR_PARAMETERS),
            "source_sha256": _source_sha256(),
        },
        "snapshot": {
            "encoding": "gzip+base64",
            "sha256": _sha256(snapshot_bytes),
            "uncompressed_bytes": len(snapshot_bytes),
            "compressed_bytes": len(compressed),
            "data": encoded_snapshot,
        },
    }
    encoded_config = _canonical_json_bytes(config) + b"\n"
    if len(encoded_config) >= MAX_CONFIG_BYTES:
        raise ValueError(
            "Durable GA configuration is too large: "
            f"{len(encoded_config):,} bytes; limit is below {MAX_CONFIG_BYTES:,} bytes."
        )
    return config


def write_config(path: Path, config: Mapping[str, Any]) -> int:
    """Atomically write one config beneath the workspace outputs directory."""
    encoded = _canonical_json_bytes(config) + b"\n"
    if len(encoded) >= MAX_CONFIG_BYTES:
        raise ValueError(
            "Durable GA configuration is too large: "
            f"{len(encoded):,} bytes; limit is below {MAX_CONFIG_BYTES:,} bytes."
        )
    project_root_input = PROJECT_ROOT.expanduser().absolute()
    project_root = project_root_input.resolve(strict=True)
    output_root = project_root / OUTPUT_DIRECTORY_NAME
    if output_root.is_symlink():
        raise ValueError("The workspace outputs directory must not be a symbolic link.")
    output_root.mkdir(mode=0o700, exist_ok=True)
    if not output_root.is_dir():
        raise ValueError("The workspace outputs path must be a directory.")
    requested = path.expanduser()
    if requested.is_absolute():
        try:
            requested = project_root / requested.relative_to(project_root_input)
        except ValueError:
            pass
    else:
        requested = project_root / requested
    target = requested.resolve(strict=False)
    try:
        relative = target.relative_to(output_root)
    except ValueError as exc:
        raise ValueError("Config output must stay beneath the workspace outputs directory.") from exc
    if not relative.parts:
        raise ValueError("Config output must name one JSON file.")
    parent = output_root
    for component in relative.parts[:-1]:
        parent = parent / component
        if parent.is_symlink():
            raise ValueError("Config output parent must not be a symbolic link.")
        parent.mkdir(mode=0o700, exist_ok=True)
        if not parent.is_dir():
            raise ValueError("Config output parent must be a directory.")
    target = parent / relative.name
    if target.is_symlink():
        raise ValueError("Config output must not be a symbolic link.")
    if target.exists():
        metadata = target.stat(follow_symlinks=False)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError("Config output must be one regular, singly linked file.")
    temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        if os.name == "posix":
            descriptor = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return len(encoded)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Freeze a read-only Price Field bundle into a durable Bayesian "
            "CRPS GA configuration."
        ),
    )
    parser.add_argument(
        "--backtest-url",
        "--url",
        required=True,
        dest="backtest_url",
        help="Canonical Worthward Backtest URL to preserve as the baseline.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Target path for the durable JSON configuration.",
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        help="Optional market-local end date for a reproducible relative range.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    config = build_config(args.backtest_url, as_of=args.as_of)
    size = write_config(args.output, config)
    print(json.dumps({
        "output": str(args.output.expanduser().resolve()),
        "bytes": size,
        "snapshot_sha256": config["snapshot"]["sha256"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
