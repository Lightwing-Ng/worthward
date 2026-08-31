"""
Walk-forward Bayesian price-distribution strategy.

Every production market input is loaded through the Longbridge CLI factor
provider. The model predicts the next daily log return and exposes a compact,
declarative presentation payload for the Backtest probability-grid renderer.

Code version: v1.19.0
- Added: An opt-in Dynamic P/E Ratio factor uses the current Longbridge
  ``calc-index`` snapshot only on its own availability date.
- Changed: Bayesian quantitative-factor controls are registered once and
  rendered in alphabetical order; model parameters remain after the factors.
- Changed: Walk-forward observation noise now uses regularized, effective-degree-of-freedom ridge residual variance with a small process-noise floor, avoiding in-sample OLS overconfidence.
- Changed: The probability renderer keeps only the matrix itself; its Python
  presentation owns the instantaneous nonlinear cell-opacity curve.
- Added: Daily posterior signals may execute on real one-minute bars through a
  causal final-bar to next-session-open bridge without fabricating minute-level
  posterior values.
- Changed: The declarative presentation contract retains a fixed 20-column,
  ten-row-per-side maximum field with integer-trading-day slots and a fixed
  2 px cell gap. The renderer applies the same 2 px guide-to-first-cell inset
  while retaining the vertical and trailing 8 px field padding.
- Changed: The probability field no longer carries private radius or material
  fields; the renderer is a transparent, square-cell matrix only.
- Changed: NVDA is the default research ticker for this strategy.
- Changed: Auto and CPU now use NumPy directly for this small-matrix
  walk-forward workload; only an explicit GPU request imports Torch and probes
  Apple MPS or CUDA.
- Changed: Longbridge symbol resolution now reuses the shared adapter contract,
  including canonical US share-class tickers such as BRK-B.
- Fixed: Ordinary Torch initialization failures now preserve the documented
  NumPy CPU fallback while process-control exceptions still propagate.
- Fixed: Provider trading dates remain market-local naive midnights throughout
  the model frame and presentation time-axis contract.
- Changed: The probability field reports a clearly named probability-weighted
  realized-cell score and lattice coverage; both metrics use only later
  observations and neither is presented as a viewport-grid hit rate.
- Fixed: A GPU runtime failure now restarts the full walk-forward pass on one
  NumPy CPU backend, so a single backtest cannot mix MPS/CUDA and CPU values.
- Fixed: Research factors that lack a verifiable point-in-time availability
  status surface as unavailable rather than silently acting like ordinary
  sparse historical factors.
- Fixed: Sparse-factor fallback ranks candidates by causal coverage and
  dispersion with deterministic tie-breaking instead of parameter order.
- Added: The probability field now exposes opt-in Longbridge research factors.
- Added: The Bayesian Price Field exposes a private absolute probability display
  threshold for focusing the rendered field without changing signals or scores.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import hashlib
import importlib
import json
import math
import platform
from typing import Any, Sequence

import numpy as np
import pandas as pd

from ..base import (
    BaseStrategy,
    StrategyParameterDefinition,
    StrategySignalResult,
    StrategySupportMatrix,
)
from ..interval_bridge import DAILY_CLOSE_TO_NEXT_SESSION_OPEN


_PREDICTION_MEAN_COLUMN = "bayesian_predictive_mean"
_PREDICTION_STD_COLUMN = "bayesian_predictive_std"
_PROBABILITY_COLUMN = "bayesian_probability_up"
_MIN_TRAINING_OBSERVATIONS = 20
_PE_MAX_STALENESS_DAYS = 14
_DYNAMIC_PE_MAX_STALENESS_DAYS = 1
_OPTIONS_MAX_STALENESS_DAYS = 7
_RESEARCH_MAX_STALENESS_DAYS = 90
_VOLUME_AT_PRICE_BIN_COUNT = 32
_MODEL_VERSION = "bayesian-price-field-model/v1.7.0"
_EPSILON = 1e-12
_PROBABILITY_FIELD_MAX_HORIZON = 20
_PROBABILITY_FIELD_ROWS_ABOVE = 10
_PROBABILITY_FIELD_ROWS_BELOW = 10
_PROBABILITY_FIELD_COLUMNS = 20
_PROBABILITY_FIELD_RETURN_SIGMA = 6.0
_FACTOR_SELECTION_PRIORITY = (
    "volume",
    "pe",
    "options",
    "volume_at_price",
    "pb_ratio",
    "ps_ratio",
    "dividend_yield",
    "market_temperature",
    "capital_flow",
    "shareholder_concentration",
    "fund_holder_weight",
    "short_interest",
    "short_volume",
    "broker_holding",
)
_FACTOR_SELECTION_PRIORITY_INDEX = {
    factor: index for index, factor in enumerate(_FACTOR_SELECTION_PRIORITY)
}
_MIN_NOISE_VARIANCE = 1e-8
_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT = 5.0
_CELL_DISPLAY_THRESHOLD_MIN_PCT = 0.0
_CELL_DISPLAY_THRESHOLD_MAX_PCT = 50.0
_PRESENTATION_ONLY_PARAMETER_KEYS = frozenset({"cell_display_threshold"})


@dataclass(frozen=True)
class _BayesianFactorDefinition:
    key: str
    label: str
    parameter_key: str
    provider_key: str
    default: bool
    help_text: str
    observation_key: str | None = None
    max_staleness_days: int | None = None


_BAYESIAN_FACTOR_DEFINITIONS = tuple(sorted(
    (
        _BayesianFactorDefinition(
            key="broker_holding",
            label="Broker Holding",
            parameter_key="use_broker_holding",
            provider_key="broker_holding",
            default=False,
            help_text=(
                "Research-only: HK history requires a selected broker and an "
                "aggregation rule, so no causal aggregate is available yet."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="capital_flow",
            label="Capital Flow",
            parameter_key="use_capital_flow",
            provider_key="capital_flow",
            default=False,
            help_text=(
                "Research-only: Longbridge currently exposes an intraday "
                "snapshot, not causal daily history, so this factor is "
                "unavailable to backtests."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="dividend_yield",
            label="Dividend Yield",
            parameter_key="use_dividend_yield",
            provider_key="dividend_yield",
            default=False,
            help_text=(
                "Opt-in historical dividend-yield observations from Longbridge "
                "valuation history; no current snapshot is backfilled."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="dynamic_pe_ratio",
            label="Dynamic P/E Ratio",
            parameter_key="use_dynamic_pe_ratio",
            provider_key="dynamic_pe",
            default=False,
            help_text=(
                "Uses the current Longbridge calc-index P/E snapshot only on "
                "its market-local availability date; it is never backfilled "
                "into earlier dates."
            ),
            observation_key="dynamic_pe_history",
            max_staleness_days=_DYNAMIC_PE_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="fund_holder_weight",
            label="Fund Holder Weight",
            parameter_key="use_fund_holder_weight",
            provider_key="fund_holder_weight",
            default=False,
            help_text=(
                "Research-only until Longbridge supplies a verified publication "
                "timestamp; fund report dates are not causal availability dates."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="market_temperature",
            label="Market Temperature",
            parameter_key="use_market_temperature",
            provider_key="market_temperature",
            default=False,
            help_text="Opt-in Longbridge market sentiment temperature history for the ticker's exchange.",
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="options",
            label="Options",
            parameter_key="use_options",
            provider_key="options",
            default=True,
            help_text=(
                "Combines put/call volume and open-interest ratios without "
                "broadcasting current snapshots backward."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="pb_ratio",
            label="P/B Ratio",
            parameter_key="use_pb_ratio",
            provider_key="pb_ratio",
            default=False,
            help_text=(
                "Opt-in historical price-to-book observations from Longbridge "
                "valuation history; joined backward as-of."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="pe",
            label="P/E Ratio",
            parameter_key="use_pe_ratio",
            provider_key="pe",
            default=True,
            help_text="Uses backward as-of P/E observations from Longbridge CLI when available.",
            observation_key="pe_history",
            max_staleness_days=_PE_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="ps_ratio",
            label="P/S Ratio",
            parameter_key="use_ps_ratio",
            provider_key="ps_ratio",
            default=False,
            help_text=(
                "Opt-in historical price-to-sales observations from Longbridge "
                "valuation history; joined backward as-of."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="shareholder_concentration",
            label="Shareholder Concentration",
            parameter_key="use_shareholder_concentration",
            provider_key="shareholder_concentration",
            default=False,
            help_text=(
                "Research-only until Longbridge supplies a verified publication "
                "timestamp; filing-period dates are never used as availability "
                "dates."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="short_interest",
            label="Short Interest",
            parameter_key="use_short_interest",
            provider_key="short_interest",
            default=False,
            help_text=(
                "Research-only until a source publication timestamp is available; "
                "FINRA settlement dates are not causal availability dates."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="short_volume",
            label="Short Volume",
            parameter_key="use_short_volume",
            provider_key="short_volume",
            default=False,
            help_text=(
                "Research-only until Longbridge supplies a verified publication "
                "timestamp for each daily short-sale report."
            ),
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="volume",
            label="Volume",
            parameter_key="use_volume",
            provider_key="ohlcv",
            default=True,
            help_text="Uses daily Longbridge CLI trading volume as a walk-forward factor.",
        ),
        _BayesianFactorDefinition(
            key="volume_at_price",
            label="Volume-at-price Percentile",
            parameter_key="use_volume_at_price",
            provider_key="ohlcv",
            default=True,
            help_text=(
                "Uses the current close's causal percentile in a trailing volume-"
                "at-price distribution built by spreading each Longbridge CLI "
                "bar's volume across fixed Low-High price bins."
            ),
        ),
    ),
    key=lambda definition: definition.label.casefold(),
))


def _record_value(record: object, key: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(key, default)
    return getattr(record, key, default)


def _normalized_timestamp(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert("UTC").tz_localize(None)
    return timestamp.normalize()


def _normalized_datetime_series(values: pd.Series) -> pd.Series:
    return (
        pd.to_datetime(values, errors="coerce", utc=True)
        .dt.tz_localize(None)
        .dt.normalize()
    )


def _longbridge_symbol(ticker: str) -> str:
    from app.infrastructure.broker_market_data import normalize_longbridge_symbol

    try:
        return normalize_longbridge_symbol(ticker)
    except ValueError as exc:
        raise ValueError("Bayesian Price Field requires a ticker.") from exc


def _normalize_ohlcv_frame(dataset: pd.DataFrame) -> pd.DataFrame:
    frame = dataset.copy()
    if "Date" not in frame.columns:
        frame["Date"] = pd.to_datetime(frame.index, errors="coerce", utc=True)
    frame["Date"] = _normalized_datetime_series(frame["Date"])

    if "Close" not in frame.columns:
        raise ValueError("Bayesian Price Field requires a Close column.")
    frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
    for column in ("Open", "High", "Low"):
        if column not in frame.columns:
            frame[column] = frame["Close"]
        else:
            frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(frame["Close"])
    if "Volume" not in frame.columns:
        frame["Volume"] = 0.0
    else:
        frame["Volume"] = pd.to_numeric(frame["Volume"], errors="coerce").fillna(0.0)
    if "Turnover" in frame.columns:
        frame["Turnover"] = pd.to_numeric(frame["Turnover"], errors="coerce")

    return (
        frame.dropna(subset=["Date", "Close"])
        .sort_values("Date")
        .drop_duplicates(subset=["Date"], keep="last")
        .reset_index(drop=True)
    )


def _bundle_ohlcv_frame(bundle: object) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for bar in tuple(_record_value(bundle, "ohlcv", ()) or ()):
        rows.append(
            {
                "Date": _record_value(bar, "observed_at"),
                "Open": _record_value(bar, "open"),
                "High": _record_value(bar, "high"),
                "Low": _record_value(bar, "low"),
                "Close": _record_value(bar, "close"),
                "Volume": _record_value(bar, "volume", 0.0),
                "Turnover": _record_value(bar, "turnover"),
            }
        )
    frame = _normalize_ohlcv_frame(
        pd.DataFrame(
            rows,
            columns=("Date", "Open", "High", "Low", "Close", "Volume", "Turnover"),
        )
    )
    frame.attrs["market_data_source"] = "longbridge-cli"
    frame.attrs["bayesian_factor_fingerprint"] = str(
        _record_value(bundle, "fingerprint", "") or ""
    )
    return frame


def _observation_frame(
        observations: Sequence[object],
        value_builder: Any,
        value_column: str,
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for observation in observations:
        observed_at = _record_value(observation, "observed_at")
        value = value_builder(observation)
        if observed_at is None or value is None:
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(numeric_value):
            continue
        rows.append({"Date": _normalized_timestamp(observed_at), value_column: numeric_value})
    if not rows:
        return pd.DataFrame(columns=["Date", value_column])
    return (
        pd.DataFrame(rows)
        .sort_values("Date")
        .drop_duplicates(subset=["Date"], keep="last")
        .reset_index(drop=True)
    )


def _option_ratio(observation: object) -> float | None:
    ratios: list[float] = []
    for key in ("put_call_volume_ratio", "put_call_open_interest_ratio"):
        value = _record_value(observation, key)
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(numeric_value) and numeric_value >= 0:
            ratios.append(numeric_value)
    for numerator_key, denominator_key in (
        ("put_volume", "call_volume"),
        ("put_open_interest", "call_open_interest"),
    ):
        numerator = _record_value(observation, numerator_key)
        denominator = _record_value(observation, denominator_key)
        try:
            numerator_value = float(numerator)
            denominator_value = float(denominator)
        except (TypeError, ValueError):
            continue
        if (
            math.isfinite(numerator_value)
            and numerator_value >= 0
            and math.isfinite(denominator_value)
            and denominator_value > 0
        ):
            ratios.append(numerator_value / denominator_value)
    if not ratios:
        return None
    return float(sum(ratios) / len(ratios))


def _merge_bundle_observations(frame: pd.DataFrame, bundle: object | None) -> pd.DataFrame:
    merged = frame.sort_values("Date").reset_index(drop=True)
    if bundle is None:
        return merged

    pe_frame = _observation_frame(
        tuple(_record_value(bundle, "pe_history", ()) or ()),
        lambda observation: _record_value(observation, "value"),
        "bayesian_pe_ratio",
    )
    if not pe_frame.empty:
        pe_frame = pe_frame.rename(
            columns={"Date": "bayesian_pe_observed_at"}
        )
        merged = pd.merge_asof(
            merged,
            pe_frame,
            left_on="Date",
            right_on="bayesian_pe_observed_at",
            direction="backward",
            allow_exact_matches=True,
            tolerance=pd.Timedelta(days=_PE_MAX_STALENESS_DAYS),
        )

    dynamic_pe_frame = _observation_frame(
        tuple(_record_value(bundle, "dynamic_pe_history", ()) or ()),
        lambda observation: _record_value(observation, "value"),
        "bayesian_dynamic_pe_ratio",
    )
    if not dynamic_pe_frame.empty:
        dynamic_pe_frame = dynamic_pe_frame.rename(
            columns={"Date": "bayesian_dynamic_pe_observed_at"}
        )
        merged = pd.merge_asof(
            merged,
            dynamic_pe_frame,
            left_on="Date",
            right_on="bayesian_dynamic_pe_observed_at",
            direction="backward",
            allow_exact_matches=True,
            tolerance=pd.Timedelta(days=_DYNAMIC_PE_MAX_STALENESS_DAYS),
        )

    option_frame = _observation_frame(
        tuple(_record_value(bundle, "option_history", ()) or ()),
        _option_ratio,
        "bayesian_option_put_call_ratio",
    )
    if not option_frame.empty:
        option_frame = option_frame.rename(
            columns={"Date": "bayesian_options_observed_at"}
        )
        merged = pd.merge_asof(
            merged,
            option_frame,
            left_on="Date",
            right_on="bayesian_options_observed_at",
            direction="backward",
            allow_exact_matches=True,
            tolerance=pd.Timedelta(days=_OPTIONS_MAX_STALENESS_DAYS),
        )
    research_rows = tuple(_record_value(bundle, "research_history", ()) or ())
    if research_rows:
        for factor in sorted({str(_record_value(row, "factor", "")) for row in research_rows}):
            if not factor:
                continue
            research_frame = _observation_frame(
                [
                    row for row in research_rows
                    if str(_record_value(row, "factor", "")) == factor
                ],
                lambda observation: _record_value(observation, "value"),
                f"bayesian_{factor}",
            )
            if research_frame.empty:
                continue
            observed_column = f"bayesian_{factor}_observed_at"
            research_frame = research_frame.rename(columns={"Date": observed_column})
            merged = pd.merge_asof(
                merged,
                research_frame,
                left_on="Date",
                right_on=observed_column,
                direction="backward",
                allow_exact_matches=True,
                tolerance=pd.Timedelta(days=_RESEARCH_MAX_STALENESS_DAYS),
            )
    return merged


def _signed_log_series(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    return np.sign(numeric) * np.log1p(np.abs(numeric))


def _rolling_volume_at_price_percentile(
        frame: pd.DataFrame,
        chip_window: int,
        bin_count: int = _VOLUME_AT_PRICE_BIN_COUNT,
) -> np.ndarray:
    """Build a causal close-price percentile from rolling volume-at-price bins."""
    low = pd.to_numeric(frame["Low"], errors="coerce").to_numpy(dtype=np.float64)
    high = pd.to_numeric(frame["High"], errors="coerce").to_numpy(dtype=np.float64)
    close = pd.to_numeric(frame["Close"], errors="coerce").to_numpy(dtype=np.float64)
    volume = (
        pd.to_numeric(frame["Volume"], errors="coerce")
        .clip(lower=0.0)
        .to_numpy(dtype=np.float64)
    )
    percentile = np.full(len(frame), np.nan, dtype=np.float64)
    minimum_observations = max(3, chip_window // 3)
    normalized_bin_count = max(4, int(bin_count))

    for index in range(len(frame)):
        if not math.isfinite(close[index]):
            continue
        start = max(0, index - chip_window + 1)
        window_low = np.minimum(low[start:index + 1], high[start:index + 1])
        window_high = np.maximum(low[start:index + 1], high[start:index + 1])
        window_volume = volume[start:index + 1]
        valid = (
            np.isfinite(window_low)
            & np.isfinite(window_high)
            & np.isfinite(window_volume)
            & (window_volume > 0.0)
        )
        if int(np.count_nonzero(valid)) < minimum_observations:
            continue

        valid_low = window_low[valid]
        valid_high = window_high[valid]
        valid_volume = window_volume[valid]
        price_floor = float(np.min(valid_low))
        price_ceiling = float(np.max(valid_high))
        if not math.isfinite(price_floor) or not math.isfinite(price_ceiling):
            continue
        if price_ceiling - price_floor <= _EPSILON:
            percentile[index] = 0.5
            continue

        edges = np.linspace(
            price_floor,
            price_ceiling,
            normalized_bin_count + 1,
            dtype=np.float64,
        )
        bin_mass = np.zeros(normalized_bin_count, dtype=np.float64)
        for bar_low, bar_high, bar_volume in zip(
                valid_low,
                valid_high,
                valid_volume,
                strict=True,
        ):
            bar_width = float(bar_high - bar_low)
            if bar_width <= _EPSILON:
                bin_index = int(
                    np.clip(
                        np.searchsorted(edges, bar_low, side="right") - 1,
                        0,
                        normalized_bin_count - 1,
                    )
                )
                bin_mass[bin_index] += float(bar_volume)
                continue
            overlap = np.maximum(
                0.0,
                np.minimum(edges[1:], bar_high) - np.maximum(edges[:-1], bar_low),
            )
            bin_mass += float(bar_volume) * overlap / bar_width

        total_mass = float(np.sum(bin_mass))
        if total_mass <= _EPSILON or not math.isfinite(total_mass):
            continue
        current_close = float(close[index])
        if current_close <= price_floor:
            percentile[index] = 0.0
            continue
        if current_close >= price_ceiling:
            percentile[index] = 1.0
            continue
        close_bin = int(
            np.clip(
                np.searchsorted(edges, current_close, side="right") - 1,
                0,
                normalized_bin_count - 1,
            )
        )
        bin_width = float(edges[close_bin + 1] - edges[close_bin])
        within_bin_fraction = (
            (current_close - float(edges[close_bin])) / bin_width
            if bin_width > _EPSILON
            else 0.5
        )
        cumulative_mass = float(np.sum(bin_mass[:close_bin]))
        cumulative_mass += float(bin_mass[close_bin]) * min(
            1.0,
            max(0.0, within_bin_fraction),
        )
        percentile[index] = min(1.0, max(0.0, cumulative_mass / total_mass))
    return percentile


def _build_factor_columns(frame: pd.DataFrame, chip_window: int) -> dict[str, np.ndarray]:
    volume = pd.to_numeric(frame["Volume"], errors="coerce").clip(lower=0.0)
    volume_at_price = _rolling_volume_at_price_percentile(frame, chip_window)

    pe_source = frame.get("bayesian_pe_ratio", frame.get("pe_ratio"))
    option_source = frame.get(
        "bayesian_option_put_call_ratio",
        frame.get("option_put_call_ratio"),
    )

    result: dict[str, np.ndarray] = {
        "volume": np.log1p(volume.where(volume > 0.0)).to_numpy(dtype=np.float64),
        "volume_at_price": volume_at_price,
    }
    if pe_source is not None:
        result["pe"] = _signed_log_series(pe_source).to_numpy(dtype=np.float64)
    dynamic_pe_source = frame.get("bayesian_dynamic_pe_ratio")
    if dynamic_pe_source is not None:
        result["dynamic_pe_ratio"] = _signed_log_series(
            dynamic_pe_source
        ).to_numpy(dtype=np.float64)
    if option_source is not None:
        result["options"] = _signed_log_series(option_source).to_numpy(dtype=np.float64)
    for factor in (
        "pb_ratio",
        "ps_ratio",
        "dividend_yield",
        "market_temperature",
        "capital_flow",
        "shareholder_concentration",
        "fund_holder_weight",
        "short_interest",
        "short_volume",
        "broker_holding",
    ):
        source = frame.get(f"bayesian_{factor}")
        if source is not None:
            result[factor] = _signed_log_series(source).to_numpy(dtype=np.float64)
    return result


def _load_torch() -> Any | None:
    try:
        return importlib.import_module("torch")
    except Exception:
        return None


@dataclass
class _ComputeBackend:
    requested: str
    resolved: str = "cpu"
    engine: str = "numpy"
    torch_module: Any | None = None
    numeric_precision: str = "float64"
    fallback_reason: str | None = None
    runtime_fallback: bool = False

    def fall_back_to_cpu(self, reason: str) -> None:
        self.resolved = "cpu"
        self.engine = "numpy-fallback"
        self.torch_module = None
        self.numeric_precision = "float64"
        self.fallback_reason = reason
        self.runtime_fallback = True


def _torch_device_available(torch_module: Any, device: str) -> bool:
    try:
        if device == "mps":
            return bool(torch_module.backends.mps.is_available())
        if device == "cuda":
            return bool(torch_module.cuda.is_available())
    except (AttributeError, RuntimeError):
        return False
    return False


def _resolve_compute_backend(requested: str) -> _ComputeBackend:
    normalized = requested if requested in {"Auto", "CPU", "GPU"} else "Auto"
    backend = _ComputeBackend(requested=normalized)
    if normalized in {"Auto", "CPU"}:
        return backend

    torch_module = _load_torch()
    if torch_module is None:
        return backend

    system_name = platform.system()
    candidate_devices = (
        ("mps", "cuda")
        if system_name == "Darwin"
        else (("cuda",) if system_name == "Windows" else ("cuda", "mps"))
    )
    for device in candidate_devices:
        if _torch_device_available(torch_module, device):
            backend.resolved = device
            backend.engine = "torch"
            backend.torch_module = torch_module
            backend.numeric_precision = "float32" if device == "mps" else "float64"
            return backend
    return backend


def _numpy_bayesian_prediction(
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    identity = np.eye(design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    precision = (design.T @ design) / noise_variance + prior_strength * identity
    right_hand_side = (design.T @ target) / noise_variance
    posterior_mean = np.linalg.solve(precision, right_hand_side)
    current_precision_solution = np.linalg.solve(precision, current)
    predictive_mean = float(current @ posterior_mean)
    predictive_variance = float(
        noise_variance + current @ current_precision_solution
    )
    return predictive_mean, math.sqrt(max(predictive_variance, _EPSILON))


def _torch_bayesian_prediction(
        backend: _ComputeBackend,
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    torch_module = backend.torch_module
    if torch_module is None:
        raise RuntimeError("Torch is unavailable.")
    dtype = torch_module.float32 if backend.resolved == "mps" else torch_module.float64
    device = torch_module.device(backend.resolved)
    design_tensor = torch_module.as_tensor(design, dtype=dtype, device=device)
    target_tensor = torch_module.as_tensor(target, dtype=dtype, device=device)
    current_tensor = torch_module.as_tensor(current, dtype=dtype, device=device)
    identity = torch_module.eye(design.shape[1], dtype=dtype, device=device)
    identity[0, 0] = 0.1
    precision = (
        design_tensor.T @ design_tensor / noise_variance
        + prior_strength * identity
    )
    right_hand_side = design_tensor.T @ target_tensor / noise_variance
    posterior_mean = torch_module.linalg.solve(precision, right_hand_side)
    precision_solution = torch_module.linalg.solve(precision, current_tensor)
    predictive_mean = float((current_tensor @ posterior_mean).detach().cpu().item())
    predictive_variance = float(
        (
            noise_variance
            + current_tensor @ precision_solution
        ).detach().cpu().item()
    )
    predictive_standard_deviation = math.sqrt(max(predictive_variance, _EPSILON))
    if not math.isfinite(predictive_mean) or not math.isfinite(predictive_standard_deviation):
        raise ValueError("Torch posterior prediction was non-finite.")
    return predictive_mean, predictive_standard_deviation


def _bayesian_prediction(
        backend: _ComputeBackend,
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    if backend.engine == "torch":
        try:
            return _torch_bayesian_prediction(
                backend,
                design,
                target,
                current,
                prior_strength,
                noise_variance,
            )
        except (RuntimeError, TypeError, ValueError) as exc:
            backend.fall_back_to_cpu(
                f"{type(exc).__name__}: {str(exc) or 'Torch posterior failure'}"
            )
    return _numpy_bayesian_prediction(
        design,
        target,
        current,
        prior_strength,
        noise_variance,
    )


def _ridge_residual_variance(
        design: np.ndarray,
        target: np.ndarray,
        prior_strength: float,
) -> float:
    """Estimate causal process noise from the same ridge model as prediction.

    The old estimator fit an unregularized OLS model and divided its in-sample
    residual sum by ``n - p``. With correlated factors that residual can be
    almost zero even though a future return remains uncertain. Reusing the
    Bayesian ridge coefficients and its effective residual degrees of freedom
    keeps the scale aligned with the posterior while the variance floor avoids
    a degenerate, overconfident forecast on a short or perfectly fitted sample.
    """
    numeric_design = np.asarray(design, dtype=np.float64)
    numeric_target = np.asarray(target, dtype=np.float64)
    observation_count = len(numeric_target)
    if observation_count <= 1:
        return _MIN_NOISE_VARIANCE

    sample_variance = float(np.var(numeric_target, ddof=1))
    if not math.isfinite(sample_variance):
        sample_variance = 0.0
    # `_bayesian_prediction` is equivalent to ridge regression with a penalty
    # of `prior_strength * noise_variance` after multiplying its precision
    # system by the noise scale. Iterate that fixed point a few times so the
    # residual estimate and the eventual posterior use the same regularizer.
    noise_variance = max(_MIN_NOISE_VARIANCE, sample_variance)
    identity = np.eye(numeric_design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    regularization = max(0.0, float(prior_strength))
    ridge_variance = noise_variance
    for _ in range(4):
        precision = numeric_design.T @ numeric_design + (
            regularization * noise_variance * identity
        )
        try:
            coefficients = np.linalg.solve(
                precision,
                numeric_design.T @ numeric_target,
            )
            # trace(H) is the effective parameter count for a ridge fit.
            leverage = np.linalg.solve(precision, numeric_design.T)
            effective_degrees_of_freedom = observation_count - float(
                np.trace(numeric_design @ leverage)
            )
        except (np.linalg.LinAlgError, ValueError):
            # Keep the recovery path on the same ridge precision system. An
            # unregularized OLS fallback would reintroduce the exact
            # overconfidence this estimator is intended to avoid.
            precision_inverse = np.linalg.pinv(precision)
            coefficients = precision_inverse @ numeric_design.T @ numeric_target
            leverage = precision_inverse @ numeric_design.T
            effective_degrees_of_freedom = observation_count - float(
                np.trace(numeric_design @ leverage)
            )

        residuals = numeric_target - numeric_design @ coefficients
        residual_sum = float(np.sum(np.square(residuals)))
        effective_degrees_of_freedom = max(1.0, effective_degrees_of_freedom)
        ridge_variance = residual_sum / effective_degrees_of_freedom
        if not math.isfinite(ridge_variance):
            ridge_variance = 0.0
        next_noise_variance = max(
            _MIN_NOISE_VARIANCE,
            ridge_variance,
            sample_variance * 0.05,
        )
        if abs(next_noise_variance - noise_variance) <= max(
            1e-12,
            noise_variance * 1e-6,
        ):
            noise_variance = next_noise_variance
            break
        noise_variance = next_noise_variance
    # A modest fraction of the observed return dispersion is retained as
    # irreducible process noise even when the training design interpolates it.
    return max(_MIN_NOISE_VARIANCE, float(noise_variance), ridge_variance)


def _select_active_factors(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        candidate_indices: np.ndarray,
        current_index: int,
        target_mask: np.ndarray,
) -> list[str]:
    """Select a stable factor subset using point-in-time coverage.

    Every candidate is scored only from observations available before the
    current origin. Candidates are then ordered by finite coverage, useful
    dispersion, and a fixed product priority; the caller's parameter order is
    intentionally ignored. If the joint training mask is too sparse, the
    lowest-information candidate is removed deterministically.
    """
    candidates: list[tuple[str, int, float]] = []
    seen: set[str] = set()
    for raw_factor in enabled_factors:
        factor = str(raw_factor)
        if factor in seen or factor not in factor_values:
            continue
        seen.add(factor)
        values = np.asarray(factor_values[factor], dtype=np.float64)
        if current_index >= len(values):
            continue
        candidate_values = values[candidate_indices]
        finite = np.isfinite(candidate_values)
        coverage = int(np.count_nonzero(finite))
        if not np.isfinite(values[current_index]) or coverage < _MIN_TRAINING_OBSERVATIONS:
            continue
        finite_values = candidate_values[finite]
        dispersion = float(np.std(finite_values)) if len(finite_values) > 1 else 0.0
        if not math.isfinite(dispersion):
            dispersion = 0.0
        candidates.append((factor, coverage, dispersion))

    candidates.sort(
        key=lambda item: (
            -item[1],
            -item[2],
            _FACTOR_SELECTION_PRIORITY_INDEX.get(item[0], len(_FACTOR_SELECTION_PRIORITY)),
            item[0],
        )
    )
    active = [item[0] for item in candidates]
    coverage_by_factor = {item[0]: item[1] for item in candidates}
    dispersion_by_factor = {item[0]: item[2] for item in candidates}

    def joint_training_count(selected: Sequence[str]) -> int:
        joint_mask = target_mask.copy()
        for factor in selected:
            joint_mask &= np.isfinite(factor_values[factor][candidate_indices])
        return int(np.count_nonzero(joint_mask))

    while active and joint_training_count(active) < _MIN_TRAINING_OBSERVATIONS:
        drop_factor = min(
            active,
            key=lambda factor: (
                coverage_by_factor[factor],
                dispersion_by_factor[factor],
                -_FACTOR_SELECTION_PRIORITY_INDEX.get(
                    factor,
                    len(_FACTOR_SELECTION_PRIORITY),
                ),
                factor,
            ),
        )
        active.remove(drop_factor)
    return active


def _normal_probability_above_zero(mean: float, standard_deviation: float) -> float:
    if standard_deviation <= 0 or not math.isfinite(standard_deviation):
        return 0.5
    z_score = mean / standard_deviation
    return min(
        1.0,
        max(0.0, 0.5 * (1.0 + math.erf(z_score / math.sqrt(2.0)))),
    )


def _normal_cdf(value: float) -> float:
    """Return a bounded standard-normal CDF value without a SciPy dependency."""
    if not math.isfinite(value):
        return 0.0 if value < 0 else 1.0
    return min(1.0, max(0.0, 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))))


def _probability_field_hit_rate(
        close: Sequence[float],
        predictive_mean: Sequence[float],
        predictive_std: Sequence[float],
        *,
        max_horizon: int = _PROBABILITY_FIELD_MAX_HORIZON,
        rows_above: int = _PROBABILITY_FIELD_ROWS_ABOVE,
        rows_below: int = _PROBABILITY_FIELD_ROWS_BELOW,
) -> dict[str, Any]:
    """Score a causal model lattice against observations after each origin.

    At origin ``i`` the posterior was fitted only with rows before ``i``. The
    score then evaluates each available future trading-day close ``i + h``
    against a finite ten-row-per-side return lattice. The probability mass of
    the cell containing that future close is accumulated; unavailable horizons
    near the end of a sample are not counted. Both the weighted score and the
    separate lattice-coverage rate are therefore honest walk-forward
    diagnostics, rather than future features. This is intentionally not a
    score for the browser's viewport-dependent probability field: that field
    quantizes time and price from the live canvas dimensions.
    """
    close_values = np.asarray(close, dtype=np.float64)
    means = np.asarray(predictive_mean, dtype=np.float64)
    scales = np.asarray(predictive_std, dtype=np.float64)
    row_count = min(len(close_values), len(means), len(scales))
    row_count = max(0, row_count)
    normalized_horizon = max(1, min(_PROBABILITY_FIELD_MAX_HORIZON, int(max_horizon)))
    normalized_rows_above = max(1, min(_PROBABILITY_FIELD_ROWS_ABOVE, int(rows_above)))
    normalized_rows_below = max(1, min(_PROBABILITY_FIELD_ROWS_BELOW, int(rows_below)))
    total_weight = 0.0
    hit_weight = 0.0
    scored_points = 0
    event_hits = 0
    row_count_lattice = normalized_rows_above + normalized_rows_below

    for origin in range(row_count):
        anchor = float(close_values[origin])
        mean = float(means[origin])
        scale = float(scales[origin])
        if (
                not math.isfinite(anchor)
                or anchor <= 0.0
                or not math.isfinite(mean)
                or not math.isfinite(scale)
                or scale <= _EPSILON
        ):
            continue
        last_horizon = min(normalized_horizon, row_count - origin - 1)
        for horizon in range(1, last_horizon + 1):
            future_close = float(close_values[origin + horizon])
            if not math.isfinite(future_close) or future_close <= 0.0:
                continue
            horizon_scale = scale * math.sqrt(float(horizon))
            horizon_mean = mean * float(horizon)
            if not math.isfinite(horizon_scale) or horizon_scale <= _EPSILON:
                continue
            # The horizontal guide is the zero-return axis. Keep at most ten
            # rows on each side while extending the side containing the
            # posterior mean, so a strongly directional but valid forecast is
            # still scored instead of producing an empty lattice.
            lower_extent = _PROBABILITY_FIELD_RETURN_SIGMA * horizon_scale + max(0.0, -horizon_mean)
            upper_extent = _PROBABILITY_FIELD_RETURN_SIGMA * horizon_scale + max(0.0, horizon_mean)
            boundaries = np.concatenate((
                np.linspace(-lower_extent, 0.0, normalized_rows_below + 1),
                np.linspace(0.0, upper_extent, normalized_rows_above + 1)[1:],
            ))
            log_return = math.log(future_close / anchor)
            cell_index = int(np.searchsorted(boundaries, log_return, side="right") - 1)
            probabilities = []
            for lower, upper in zip(boundaries[:-1], boundaries[1:], strict=True):
                probabilities.append(
                    _normal_cdf((float(upper) - horizon_mean) / horizon_scale)
                    - _normal_cdf((float(lower) - horizon_mean) / horizon_scale)
                )
            lattice_mass = max(0.0, float(sum(probabilities)))
            if lattice_mass <= _EPSILON:
                continue
            probability_mass = (
                max(0.0, float(probabilities[cell_index]))
                if 0 <= cell_index < row_count_lattice
                else 0.0
            )
            if 0 <= cell_index < row_count_lattice:
                event_hits += 1
            total_weight += lattice_mass
            hit_weight += probability_mass
            scored_points += 1

    score_pct = (hit_weight / total_weight) * 100.0 if total_weight > _EPSILON else 0.0
    event_hit_rate_pct = (
        (event_hits / scored_points) * 100.0
        if scored_points
        else 0.0
    )
    return {
        # ``score_pct`` and the hit-rate names remain compatibility aliases
        # for existing saved result payloads. New consumers must use the
        # explicit realized-cell and coverage names below.
        "score_pct": round(float(score_pct), 2),
        "probability_weighted_score_pct": round(float(score_pct), 2),
        "realized_cell_score_pct": round(float(score_pct), 2),
        "event_hit_rate_pct": round(float(event_hit_rate_pct), 2),
        "lattice_coverage_pct": round(float(event_hit_rate_pct), 2),
        "event_hits": event_hits,
        "scored_points": scored_points,
        "max_horizon": normalized_horizon,
        "rows_above": normalized_rows_above,
        "rows_below": normalized_rows_below,
        "metric_kind": "causal-log-return-realized-cell-score",
        "weighting": "probability-mass-of-realized-cell",
        "scoring_lattice": {
            "horizons": f"1..{normalized_horizon}",
            "rows_above": normalized_rows_above,
            "rows_below": normalized_rows_below,
            "bounds": "six-sigma-plus-directional-mean",
        },
        "causal": True,
    }


def _walk_forward_predictions(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    row_count = len(frame)
    predictive_mean = np.full(row_count, np.nan, dtype=np.float64)
    predictive_std = np.full(row_count, np.nan, dtype=np.float64)
    probability_up = np.full(row_count, np.nan, dtype=np.float64)
    close = pd.to_numeric(frame["Close"], errors="coerce").to_numpy(dtype=np.float64)
    forward_return = np.full(row_count, np.nan, dtype=np.float64)
    valid_price_pair = (
        np.isfinite(close[:-1])
        & np.isfinite(close[1:])
        & (close[:-1] > 0)
        & (close[1:] > 0)
    )
    forward_return[:-1][valid_price_pair] = np.log(
        close[1:][valid_price_pair] / close[:-1][valid_price_pair]
    )

    for index in range(row_count):
        training_start = max(0, index - training_window)
        candidate_indices = np.arange(training_start, index, dtype=np.int64)
        if len(candidate_indices) < _MIN_TRAINING_OBSERVATIONS:
            continue

        target_mask = np.isfinite(forward_return[candidate_indices])
        active_factors = _select_active_factors(
            factor_values,
            enabled_factors,
            candidate_indices,
            index,
            target_mask,
        )

        joint_mask = target_mask.copy()
        for factor in active_factors:
            joint_mask &= np.isfinite(factor_values[factor][candidate_indices])
        training_indices = candidate_indices[joint_mask]
        if len(training_indices) < _MIN_TRAINING_OBSERVATIONS:
            continue

        target = forward_return[training_indices]
        standardized_training: list[np.ndarray] = []
        standardized_current: list[float] = []
        for factor in active_factors:
            training_values = factor_values[factor][training_indices]
            center = float(np.mean(training_values))
            scale = float(np.std(training_values))
            if not math.isfinite(scale) or scale <= _EPSILON:
                continue
            standardized_training.append((training_values - center) / scale)
            standardized_current.append((factor_values[factor][index] - center) / scale)

        design = np.ones((len(training_indices), 1 + len(standardized_training)), dtype=np.float64)
        current = np.ones(1 + len(standardized_current), dtype=np.float64)
        if standardized_training:
            design[:, 1:] = np.column_stack(standardized_training)
            current[1:] = standardized_current

        noise_variance = _ridge_residual_variance(
            design,
            target,
            prior_strength,
        )
        mean, standard_deviation = _bayesian_prediction(
            backend,
            design,
            target,
            current,
            prior_strength,
            noise_variance,
        )
        if not math.isfinite(mean) or not math.isfinite(standard_deviation):
            continue
        predictive_mean[index] = mean
        predictive_std[index] = standard_deviation
        probability_up[index] = _normal_probability_above_zero(mean, standard_deviation)

    return predictive_mean, predictive_std, probability_up


def _json_number_list(values: Sequence[float]) -> list[float | None]:
    return [
        float(value) if math.isfinite(float(value)) else None
        for value in values
    ]


def _probability_threshold_signals(
        probabilities: Sequence[float],
        entry_probability: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Emit persistent threshold intent while the execution engine owns position state."""
    numeric = np.asarray(probabilities, dtype=np.float64)
    finite = np.isfinite(numeric)
    return (
        finite & (numeric >= entry_probability),
        finite & (numeric <= 1.0 - entry_probability),
    )


def _frame_fingerprint(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        params: dict[str, Any],
        bundle_fingerprint: str,
) -> str:
    """Hash every model input, including derived factors and model settings."""
    columns = [
        column
        for column in (
            "Date",
            "High",
            "Low",
            "Close",
            "Volume",
            "bayesian_pe_ratio",
            "bayesian_option_put_call_ratio",
        )
        if column in frame.columns
    ]
    frame_hash = pd.util.hash_pandas_object(
        frame[columns],
        index=False,
    ).to_numpy().tobytes()
    derived_frame = pd.DataFrame(
        {
            key: np.asarray(factor_values[key], dtype=np.float64)
            for key in sorted(factor_values)
        },
        index=frame.index,
    )
    derived_hash = pd.util.hash_pandas_object(
        derived_frame,
        index=False,
    ).to_numpy().tobytes()
    contract_bytes = json.dumps(
        {
            "bundle_fingerprint": str(bundle_fingerprint or ""),
            "model_version": _MODEL_VERSION,
            "params": {
                key: value
                for key, value in params.items()
                if key not in _PRESENTATION_ONLY_PARAMETER_KEYS
            },
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(contract_bytes + frame_hash + derived_hash).hexdigest()


class BayesianPriceFieldStrategy(BaseStrategy):
    strategy_id = "bayesian-price-field"
    strategy_name = "Bayesian Price Field"
    strategy_description = (
        "Walk-forward Bayesian regression estimates the next-price probability field "
        "from point-in-time-safe Longbridge CLI price, volume, options, valuation, "
        "and sentiment factors, while exposing unavailable research sources honestly."
    )
    strategy_category = "machine-learning"
    strategy_display_order = 42
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
        required_tickers=1,
    )
    strategy_supported_intervals = ("1d", "1m")
    strategy_model_interval_overrides = {"1m": "1d"}
    strategy_signal_bridges = {"1m": DAILY_CLOSE_TO_NEXT_SESSION_OPEN}
    strategy_interval_notices = {
        "1m": "Daily Bayesian model; the probability field is available at 1d.",
    }
    strategy_market_data_source = "longbridge-cli"
    backtest_cacheable = False

    def __init__(self) -> None:
        self._warmup_bundle: object | None = None

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("NVDA",)

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            *(
                StrategyParameterDefinition(
                    key=definition.parameter_key,
                    label=definition.label,
                    kind="boolean",
                    default=definition.default,
                    help_text=definition.help_text,
                )
                for definition in _BAYESIAN_FACTOR_DEFINITIONS
            ),
            StrategyParameterDefinition(
                key="cell_display_threshold",
                label="Cell Display Threshold (%)",
                kind="number",
                default=_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT,
                minimum=_CELL_DISPLAY_THRESHOLD_MIN_PCT,
                maximum=_CELL_DISPLAY_THRESHOLD_MAX_PCT,
                step=0.1,
                unit_hint="%",
                help_text=(
                    "Hides individual probability-field cells below this absolute "
                    "probability. 0% shows every cell; 50% is the maximum focus "
                    "threshold. This changes presentation only, not signals or scoring."
                ),
            ),
            StrategyParameterDefinition(
                key="training_window",
                label="Training Window",
                kind="integer",
                default=120,
                minimum=30,
                maximum=504,
                step=1,
                unit_hint="bars",
                help_text="Limits each posterior fit to observations already known at the hovered date.",
            ),
            StrategyParameterDefinition(
                key="chip_window",
                label="Volume-at-price Window",
                kind="integer",
                default=30,
                minimum=5,
                maximum=252,
                step=1,
                unit_hint="bars",
                help_text="Sets the trailing bar window for the volume-at-price distribution factor.",
            ),
            StrategyParameterDefinition(
                key="prior_strength",
                label="Prior Strength",
                kind="number",
                default=1.0,
                minimum=0.01,
                maximum=100.0,
                step=0.01,
                help_text="Controls Bayesian coefficient shrinkage; larger values favor a more conservative posterior.",
            ),
            StrategyParameterDefinition(
                key="entry_probability",
                label="Entry Probability",
                kind="number",
                default=60.0,
                minimum=51.0,
                maximum=95.0,
                step=0.1,
                unit_hint="%",
                help_text="Enters when the posterior rise probability reaches this threshold and exits at its symmetric downside threshold.",
            ),
            StrategyParameterDefinition(
                key="compute_backend",
                label="Compute Backend",
                kind="choice",
                default="Auto",
                options=("Auto", "CPU", "GPU"),
                help_text="Auto uses NumPy CPU for this small-matrix walk-forward model. GPU explicitly requests Apple MPS on macOS or CUDA on supported Windows or NVIDIA systems, then safely falls back to CPU.",
            ),
        )

    def load_market_datasets(
            self,
            tickers: Sequence[str],
            *,
            interval: str,
            start: Any,
            end: Any,
            params: dict[str, Any] | None = None,
    ) -> list[pd.DataFrame] | None:
        if interval != "1d":
            raise ValueError("Bayesian Price Field supports daily data only.")
        if len(tickers) != 1:
            raise ValueError("Bayesian Price Field requires exactly one ticker.")

        normalized_params = self.normalize_params(params)
        warmup_bars = max(
            int(normalized_params["training_window"]),
            int(normalized_params["chip_window"]),
        ) + 2
        warmup_days = math.ceil(warmup_bars * 7 / 5) + 14
        warmup_start = _normalized_timestamp(start) - timedelta(days=warmup_days)

        from app.services.bayesian_market_factors import fetch_bayesian_factor_bundle

        research_factors = tuple(
            definition.provider_key
            for definition in _BAYESIAN_FACTOR_DEFINITIONS
            if definition.observation_key == "research_history"
            and bool(normalized_params[definition.parameter_key])
        )

        bundle = fetch_bayesian_factor_bundle(
            _longbridge_symbol(str(tickers[0])),
            warmup_start,
            end,
            include_pe=bool(normalized_params["use_pe_ratio"]),
            include_dynamic_pe=bool(normalized_params["use_dynamic_pe_ratio"]),
            include_options=bool(normalized_params["use_options"]),
            research_factors=research_factors,
        )
        self._warmup_bundle = bundle
        return [_bundle_ohlcv_frame(bundle)]

    def _factor_status(
            self,
            frame: pd.DataFrame,
            factor_values: dict[str, np.ndarray],
            normalized_params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        bundle_status = dict(
            _record_value(self._warmup_bundle, "factor_status", {}) or {}
        )
        total_observations = len(frame)
        latest_frame_date = (
            _normalized_timestamp(frame["Date"].iloc[-1])
            if total_observations > 0
            else None
        )
        factors: list[dict[str, Any]] = []
        for definition in _BAYESIAN_FACTOR_DEFINITIONS:
            enabled = bool(normalized_params[definition.parameter_key])
            values = np.asarray(
                factor_values.get(
                    definition.key,
                    np.full(total_observations, np.nan, dtype=np.float64),
                ),
                dtype=np.float64,
            )
            finite_observations = int(np.count_nonzero(np.isfinite(values)))
            coverage = (
                float(finite_observations / total_observations)
                if total_observations > 0
                else 0.0
            )
            provider_status = str(
                bundle_status.get(definition.provider_key, "") or ""
            ).lower()
            if not enabled:
                status = "disabled"
            elif provider_status == "error":
                status = "error"
            elif provider_status in {
                "unsupported",
                "unsupported_market",
                "unsupported_history",
                "unavailable_point_in_time",
            }:
                status = provider_status
            else:
                is_stale = False
                if (
                        definition.observation_key is not None
                        and definition.max_staleness_days is not None
                        and latest_frame_date is not None
                ):
                    observations = tuple(
                        _record_value(
                            self._warmup_bundle,
                            definition.observation_key,
                            (),
                        )
                        or ()
                    )
                    if definition.observation_key == "research_history":
                        observations = tuple(
                            observation for observation in observations
                            if str(_record_value(observation, "factor", ""))
                            == definition.provider_key
                        )
                    value_builder = (
                        _option_ratio
                        if definition.observation_key == "option_history"
                        else lambda observation: _record_value(observation, "value")
                    )
                    observation_frame = _observation_frame(
                        observations,
                        value_builder,
                        "value",
                    )
                    eligible_observations = observation_frame[
                        observation_frame["Date"] <= latest_frame_date
                    ]
                    if not eligible_observations.empty:
                        latest_observation = _normalized_timestamp(
                            eligible_observations["Date"].iloc[-1]
                        )
                        is_stale = (
                            latest_frame_date - latest_observation
                            > pd.Timedelta(days=definition.max_staleness_days)
                        )
                if is_stale:
                    status = "stale"
                elif finite_observations >= _MIN_TRAINING_OBSERVATIONS:
                    status = "active"
                else:
                    status = "insufficient"
            factors.append(
                {
                    "key": definition.key,
                    "label": definition.label,
                    "enabled": enabled,
                    "status": status,
                    "finite_observations": finite_observations,
                    "total_observations": total_observations,
                    "coverage": round(coverage, 6),
                }
            )
        return factors

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        normalized_params = self.normalize_params(params)
        visible_frame = _normalize_ohlcv_frame(dataset)
        full_frame = (
            _bundle_ohlcv_frame(self._warmup_bundle)
            if self._warmup_bundle is not None
            else visible_frame.copy()
        )
        full_frame = _merge_bundle_observations(full_frame, self._warmup_bundle)
        factor_values = _build_factor_columns(
            full_frame,
            int(normalized_params["chip_window"]),
        )
        enabled_factors = [
            definition.key
            for definition in _BAYESIAN_FACTOR_DEFINITIONS
            if bool(normalized_params[definition.parameter_key])
        ]
        backend = _resolve_compute_backend(str(normalized_params["compute_backend"]))
        predictive_mean, predictive_std, probability_up = _walk_forward_predictions(
            full_frame,
            factor_values,
            enabled_factors,
            int(normalized_params["training_window"]),
            float(normalized_params["prior_strength"]),
            backend,
        )
        if backend.runtime_fallback:
            # A runtime MPS/CUDA failure can happen only after earlier origins
            # have already completed. Recompute every origin on one clean CPU
            # backend instead of returning a mixed-precision backtest.
            fallback_backend = _ComputeBackend(
                requested=backend.requested,
                resolved="cpu",
                engine="numpy-fallback",
                numeric_precision="float64",
                fallback_reason=backend.fallback_reason,
                runtime_fallback=True,
            )
            predictive_mean, predictive_std, probability_up = _walk_forward_predictions(
                full_frame,
                factor_values,
                enabled_factors,
                int(normalized_params["training_window"]),
                float(normalized_params["prior_strength"]),
                fallback_backend,
            )
            backend = fallback_backend
        prediction_frame = pd.DataFrame(
            {
                "Date": full_frame["Date"],
                _PREDICTION_MEAN_COLUMN: predictive_mean,
                _PREDICTION_STD_COLUMN: predictive_std,
                _PROBABILITY_COLUMN: probability_up,
            }
        )
        output = visible_frame.merge(prediction_frame, on="Date", how="left", validate="one_to_one")
        # Score only the visible backtest interval. The hidden warm-up bars
        # may train a posterior, but they are not part of the user-facing
        # equity curve or its diagnostic denominator.
        hit_rate = _probability_field_hit_rate(
            output["Close"].to_numpy(dtype=np.float64),
            output[_PREDICTION_MEAN_COLUMN].to_numpy(dtype=np.float64),
            output[_PREDICTION_STD_COLUMN].to_numpy(dtype=np.float64),
        )

        entry_probability = float(normalized_params["entry_probability"]) / 100.0
        buy_signals, sell_signals = _probability_threshold_signals(
            pd.to_numeric(output[_PROBABILITY_COLUMN], errors="coerce"),
            entry_probability,
        )
        output["buy_signal"] = pd.Series(buy_signals, index=output.index, dtype="bool")
        output["sell_signal"] = pd.Series(sell_signals, index=output.index, dtype="bool")

        bundle_fingerprint = str(
            _record_value(self._warmup_bundle, "fingerprint", "") or ""
        )
        fingerprint = _frame_fingerprint(
            full_frame,
            factor_values,
            normalized_params,
            bundle_fingerprint,
        )
        source_commands = [
            str(command)
            for command in tuple(
                _record_value(self._warmup_bundle, "source_commands", ()) or ()
            )
        ]
        factors = self._factor_status(
            full_frame,
            factor_values,
            normalized_params,
        )
        presentation = {
            "schema": "bayesian-price-field/v1",
            "renderer": "probability-grid-v1",
            "model_version": _MODEL_VERSION,
            "rows_above": _PROBABILITY_FIELD_ROWS_ABOVE,
            "rows_below": _PROBABILITY_FIELD_ROWS_BELOW,
            "columns": _PROBABILITY_FIELD_COLUMNS,
            "width_fraction": 0.25,
            "gap_px": 2,
            "padding_px": 8,
            "min_cell_px": 4,
            "cell_opacity_mapping": "instant-contrast-power-v1",
            "cell_opacity_exponent": 1.6,
            "cell_opacity_tail_ratio": 0.02,
            "cell_display_threshold_pct": float(
                normalized_params["cell_display_threshold"]
            ),
            "time_quantization": "integer-trading-days",
            "distribution_kind": "normal-log-return",
            "step_unit": "trading-day",
            "predictive_mean": _json_number_list(output[_PREDICTION_MEAN_COLUMN]),
            "predictive_scale": _json_number_list(output[_PREDICTION_STD_COLUMN]),
            "probability_up": _json_number_list(output[_PROBABILITY_COLUMN]),
            "hit_rate": hit_rate,
            "metric_geometry": {
                "scoring_lattice": {
                    "horizons": f"1..{_PROBABILITY_FIELD_MAX_HORIZON}",
                    "rows_above": _PROBABILITY_FIELD_ROWS_ABOVE,
                    "rows_below": _PROBABILITY_FIELD_ROWS_BELOW,
                    "horizon_unit": "trading-day",
                    "bounds": "six-sigma-plus-directional-mean",
                },
                "render_lattice": {
                    "columns": _PROBABILITY_FIELD_COLUMNS,
                    "rows_above": _PROBABILITY_FIELD_ROWS_ABOVE,
                    "rows_below": _PROBABILITY_FIELD_ROWS_BELOW,
                    "horizon_unit": "integer-trading-days-per-viewport-column",
                    "horizon_mapping": "viewport-quantized",
                },
            },
            "data_keys": [
                pd.Timestamp(value).isoformat()
                for value in output["Date"].tolist()
            ],
            "factors": factors,
            "device": {
                "requested": backend.requested,
                "resolved": backend.resolved,
                "engine": backend.engine,
                "numeric_precision": backend.numeric_precision,
                "fallback_reason": backend.fallback_reason,
            },
            "source": {
                "market_data": "longbridge-cli",
                "commands": source_commands,
            },
            "fingerprint": fingerprint,
        }
        return StrategySignalResult(
            frame=output,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
            metadata={
                "factors": factors,
                "compute_device": backend.resolved,
                "market_data_source": "longbridge-cli",
                "fingerprint": fingerprint,
                "probability_field_hit_rate_pct": hit_rate["score_pct"],
                "probability_field_hit_rate_scored_points": hit_rate["scored_points"],
                "probability_field_event_hit_rate_pct": hit_rate["event_hit_rate_pct"],
                "probability_field_event_hits": hit_rate["event_hits"],
                "probability_field_realized_cell_score_pct": hit_rate[
                    "realized_cell_score_pct"
                ],
                "probability_field_lattice_coverage_pct": hit_rate[
                    "lattice_coverage_pct"
                ],
            },
            presentation=presentation,
        )
