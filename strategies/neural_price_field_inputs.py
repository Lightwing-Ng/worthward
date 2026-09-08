"""Shared causal inputs for direct-horizon neural models. Code version: v1.0.0."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd

from strategies.price_field_pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS,
    build_price_field_factor_columns,
    merge_price_field_bundle_observations,
    normalize_price_field_ohlcv,
)

AVAILABILITY_POLICY = "next-observed-session/v1"
BENCHMARK_SYMBOLS = ("SPY", "QQQ", "SMH")
BENCHMARK_FACTORS = tuple(
    (f"benchmark_{symbol.lower()}_{kind}", symbol, horizon)
    for symbol in BENCHMARK_SYMBOLS
    for kind, horizon in (("return", 1), ("momentum20", 20))
)


def plain_market_bundle(value: Any) -> Any:
    """Convert provider records without deepcopying immutable MappingProxy values."""
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: plain_market_bundle(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): plain_market_bundle(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain_market_bundle(item) for item in value]
    if isinstance(value, (date, datetime, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, np.generic):
        return value.item()
    return value


def causal_neural_market_bundle(bundle: object | None, dates: pd.Series) -> dict[str, Any]:
    """Release date-only external measurements at the next observed real session.

    This conservative policy is explicit and idempotent. It does not manufacture
    provider publication timestamps or assume a missing future trading session.
    """
    result = plain_market_bundle(bundle) if bundle is not None else {}
    if result.get("neural_availability_policy") == AVAILABILITY_POLICY:
        return result
    sessions = pd.to_datetime(dates).dt.date.to_numpy()
    for key in ("option_history", "pe_history", "dynamic_pe_history", "research_history"):
        delayed = []
        for original in result.get(key) or []:
            row = dict(original)
            observed = pd.to_datetime(row.get("observed_at"), errors="coerce")
            if pd.isna(observed):
                continue
            index = int(np.searchsorted(sessions, observed.date(), side="right"))
            if index < len(sessions):
                row["measurement_at"] = row["observed_at"]
                row["observed_at"] = str(sessions[index])
                delayed.append(row)
        result[key] = delayed
    result["neural_availability_policy"] = AVAILABILITY_POLICY
    return result


def factor_values_for_neural(
        frame: pd.DataFrame,
        bundle: object | None,
        params: Mapping[str, Any],
) -> tuple[pd.DataFrame, dict[str, np.ndarray], dict[str, Any]]:
    normalized = normalize_price_field_ohlcv(frame)
    prepared_bundle = causal_neural_market_bundle(bundle, normalized["Date"])
    prepared = merge_price_field_bundle_observations(normalized, prepared_bundle)
    values = build_price_field_factor_columns(
        prepared,
        int(params.get("chip_window", 30)),
        use_volume_at_price=bool(params.get("use_volume_at_price", False)),
    )
    benchmarks = prepared_bundle.get("benchmarks") or {}
    for symbol in BENCHMARK_SYMBOLS:
        rows = benchmarks.get(symbol) or []
        for key, _, _ in (item for item in BENCHMARK_FACTORS if item[1] == symbol):
            values[key] = np.full(len(prepared), np.nan)
        if not rows:
            continue
        history = pd.DataFrame(rows)
        if not {"observed_at", "close"}.issubset(history.columns):
            continue
        history["Date"] = pd.to_datetime(history["observed_at"], utc=True).dt.tz_localize(None).dt.normalize()
        history = history.sort_values("Date").drop_duplicates("Date", keep="last")
        close = pd.to_numeric(history["close"], errors="coerce")
        log_close = np.log(close.where(np.isfinite(close) & (close > 0)))
        for key, _, horizon in (item for item in BENCHMARK_FACTORS if item[1] == symbol):
            history[key] = log_close.diff(horizon)
            aligned = prepared[["Date"]].merge(history[["Date", key]], on="Date", how="left", validate="one_to_one")
            values[key] = aligned[key].to_numpy(dtype=float)
    return prepared, values, prepared_bundle


def prepare_neural_price_field_inputs(
        frame: pd.DataFrame,
        bundle: object | None,
        params: Mapping[str, Any],
) -> tuple[pd.DataFrame, np.ndarray, tuple[str, ...]]:
    prepared, values, _ = factor_values_for_neural(frame, bundle, params)
    names = ["close_return"]
    columns = [np.log(prepared["Close"]).diff().to_numpy(dtype=float)]
    switches = [(d.key, d.parameter_key) for d in PRICE_FIELD_FACTOR_DEFINITIONS]
    switches.extend((key, f"use_{key}") for key, _, _ in BENCHMARK_FACTORS)
    for key, parameter in switches:
        if not bool(params.get(parameter, False)):
            continue
        # Preserve declared dimensions even when only future rows are finite;
        # the engine admits usable columns separately at each historical fit.
        names.append(key)
        columns.append(np.asarray(values.get(key, np.full(len(prepared), np.nan)), dtype=float))
    return prepared, np.column_stack(columns), tuple(names)
