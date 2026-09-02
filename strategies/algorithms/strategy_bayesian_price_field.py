"""
Walk-forward Bayesian executable-return strategy.

Every production market input is loaded through the Longbridge CLI factor
provider. The model predicts the tradable next-open-to-next-open log return and
exposes a compact, declarative presentation payload for the Backtest
probability-grid renderer.

Code version: v1.26.0
- Changed: The signal target is the executable ``Open[t+1] -> Open[t+2]`` log
  return, so a close-origin prediction no longer receives credit for an
  overnight gap that has already occurred before the required next-open fill.
- Changed: Multi-column probabilities evolve through a causal AR(1) return
  state fitted at each origin instead of freezing one daily posterior mean and
  applying ``h * mean`` and ``sqrt(h) * scale`` diffusion extrapolation.
- Changed: Prior Strength is a direct percentage of standardized sample
  information, making the full slider range produce meaningful shrinkage.
- Changed: Enabled factors must add positive causal expanding-window log-score
  evidence after a complexity penalty; coverage and dispersion are only
  deterministic eligibility and tie-break inputs.
- Changed: User-facing diagnostics are a 0-100% executable-direction hit rate
  and a bounded proper Brier probability score. Gaussian log score and CRPS
  remain research diagnostics and are not mislabeled as hit rates.
- Changed: Direction diagnostics exclude flat executable returns and neutral
  50/50 forecasts; empty diagnostic samples remain explicitly unscored.
- Added: Factor presentation metadata separates provider availability,
  point-in-time eligibility, and actual selection at the latest model origin.
- Changed: Auto now coordinates independent walk-forward origins across the
  bounded CPU executor and an available Apple MPS or CUDA device, with a full
  NumPy CPU fallback when no accelerator is available or GPU execution fails.
- Changed: Causal CPU walk-forward origins use the shared bounded spawn process
  pool, with an ordered thread fallback when process execution is unavailable.
  Each worker receives only a causal batch and BLAS is capped to one thread per
  worker to use multiple processor cores without nested oversubscription.
- Added: Opt-in granular historical Longbridge option-volume and open-interest
  factors sit alongside the backward-compatible composite Options factor.
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
- Changed: Longbridge symbol resolution now reuses the shared adapter contract,
  including canonical US share-class tickers such as BRK-B.
- Fixed: Ordinary Torch initialization failures now preserve the documented
  NumPy CPU fallback while process-control exceptions still propagate.
- Fixed: Provider trading dates remain market-local naive midnights throughout
  the model frame and presentation time-axis contract.
- Fixed: A GPU runtime failure now restarts the full walk-forward pass on one
  NumPy CPU backend, so a single backtest cannot mix MPS/CUDA and CPU values.
- Fixed: Research factors that lack a verifiable point-in-time availability
  status surface as unavailable rather than silently acting like ordinary
  sparse historical factors.
- Added: The probability field now exposes opt-in Longbridge research factors.
- Added: The Bayesian Price Field exposes a private absolute probability display
  threshold for focusing the rendered field without changing signals or scores.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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

from app.infrastructure.parallel import (
    map_ordered_batches,
    resolve_worker_count,
)
from app.infrastructure.connectivity import is_remote_market_access_disabled

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
_AUTOREGRESSION_COLUMN = "bayesian_return_autoregression"
_LONG_RUN_MEAN_COLUMN = "bayesian_return_long_run_mean"
_INNOVATION_STD_COLUMN = "bayesian_return_innovation_std"
_MIN_TRAINING_OBSERVATIONS = 20
_PE_MAX_STALENESS_DAYS = 14
_DYNAMIC_PE_MAX_STALENESS_DAYS = 1
_OPTIONS_MAX_STALENESS_DAYS = 7
_RESEARCH_MAX_STALENESS_DAYS = 90
_VOLUME_AT_PRICE_BIN_COUNT = 32
_MODEL_VERSION = "bayesian-price-field-model/v1.10.0"
_EPSILON = 1e-12
_CPU_PARALLEL_MIN_ROWS = 64
_CPU_PARALLEL_MAX_WORKERS = 8
_PROBABILITY_FIELD_ROWS_ABOVE = 10
_PROBABILITY_FIELD_ROWS_BELOW = 10
_PROBABILITY_FIELD_COLUMNS = 20
_FACTOR_SELECTION_PRIORITY = (
    "volume",
    "pe",
    "options",
    "option_call_open_interest",
    "option_call_volume",
    "option_put_open_interest",
    "option_put_call_open_interest_ratio",
    "option_put_call_volume_ratio",
    "option_put_volume",
    "option_total_open_interest",
    "option_total_volume",
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
_MAX_ABS_AUTOREGRESSION = 0.95
_FACTOR_VALIDATION_POINTS = 6
_MIN_FACTOR_VALIDATION_POINTS = 4
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
                "Compatibility composite of historical put/call volume and "
                "open-interest ratios; it never backfills current snapshots."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_call_open_interest",
            label="Call OI",
            parameter_key="use_option_call_open_interest",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical call open interest from Longbridge's daily "
                "option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_call_volume",
            label="Call Volume",
            parameter_key="use_option_call_volume",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical call volume from Longbridge's daily "
                "option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_put_call_open_interest_ratio",
            label="Put/Call OI Ratio",
            parameter_key="use_option_put_call_open_interest_ratio",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical put/call open-interest ratio from "
                "Longbridge's daily option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_put_call_volume_ratio",
            label="Put/Call Volume Ratio",
            parameter_key="use_option_put_call_volume_ratio",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical put/call volume ratio from Longbridge's "
                "daily option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_put_open_interest",
            label="Put OI",
            parameter_key="use_option_put_open_interest",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical put open interest from Longbridge's daily "
                "option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_put_volume",
            label="Put Volume",
            parameter_key="use_option_put_volume",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical put volume from Longbridge's daily "
                "option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_total_open_interest",
            label="Total OI",
            parameter_key="use_option_total_open_interest",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical total option open interest from "
                "Longbridge's daily option-volume history."
            ),
            observation_key="option_history",
            max_staleness_days=_OPTIONS_MAX_STALENESS_DAYS,
        ),
        _BayesianFactorDefinition(
            key="option_total_volume",
            label="Total Option Volume",
            parameter_key="use_option_total_volume",
            provider_key="options",
            default=False,
            help_text=(
                "Opt-in historical total option volume from Longbridge's daily "
                "option-volume history."
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
    if "Open" not in frame.columns:
        raise ValueError(
            "Bayesian Price Field requires observed Open prices for its "
            "next-open execution target."
        )
    frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
    frame["Open"] = pd.to_numeric(frame["Open"], errors="coerce")
    for column in ("High", "Low"):
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


_OPTION_DETAIL_FACTOR_KEYS = (
    "option_call_open_interest",
    "option_call_volume",
    "option_put_call_open_interest_ratio",
    "option_put_call_volume_ratio",
    "option_put_open_interest",
    "option_put_volume",
    "option_total_open_interest",
    "option_total_volume",
)
_OPTION_COUNT_FACTOR_KEYS = frozenset({
    "option_call_open_interest",
    "option_call_volume",
    "option_put_open_interest",
    "option_put_volume",
    "option_total_open_interest",
    "option_total_volume",
})


def _option_nonnegative_value(observation: object, key: str) -> float | None:
    value = _record_value(observation, key)
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric_value) or numeric_value < 0:
        return None
    return numeric_value


def _option_ratio_value(
        observation: object,
        ratio_key: str,
        numerator_key: str,
        denominator_key: str,
) -> float | None:
    direct_value = _option_nonnegative_value(observation, ratio_key)
    if direct_value is not None:
        return direct_value
    numerator = _option_nonnegative_value(observation, numerator_key)
    denominator = _option_nonnegative_value(observation, denominator_key)
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator


def _option_feature_value(observation: object, factor_key: str) -> float | None:
    if factor_key == "option_put_call_volume_ratio":
        return _option_ratio_value(
            observation,
            "put_call_volume_ratio",
            "put_volume",
            "call_volume",
        )
    if factor_key == "option_put_call_open_interest_ratio":
        return _option_ratio_value(
            observation,
            "put_call_open_interest_ratio",
            "put_open_interest",
            "call_open_interest",
        )
    field_key = factor_key.removeprefix("option_")
    return _option_nonnegative_value(observation, field_key)


def _option_observation_frame(observations: Sequence[object]) -> pd.DataFrame:
    columns = [
        "Date",
        "bayesian_option_put_call_ratio",
        *(f"bayesian_{factor_key}" for factor_key in _OPTION_DETAIL_FACTOR_KEYS),
    ]
    rows: list[dict[str, Any]] = []
    for observation in observations:
        observed_at = _record_value(observation, "observed_at")
        if observed_at is None:
            continue
        values: dict[str, Any] = {
            "Date": _normalized_timestamp(observed_at),
            "bayesian_option_put_call_ratio": _option_ratio(observation),
        }
        for factor_key in _OPTION_DETAIL_FACTOR_KEYS:
            values[f"bayesian_{factor_key}"] = _option_feature_value(
                observation,
                factor_key,
            )
        if all(value is None for key, value in values.items() if key != "Date"):
            continue
        rows.append(values)
    if not rows:
        return pd.DataFrame(columns=columns)
    return (
        pd.DataFrame(rows, columns=columns)
        .sort_values("Date")
        .drop_duplicates(subset=["Date"], keep="last")
        .reset_index(drop=True)
    )


def _option_ratio(observation: object) -> float | None:
    ratios = [
        value
        for value in (
            _option_feature_value(observation, "option_put_call_volume_ratio"),
            _option_feature_value(observation, "option_put_call_open_interest_ratio"),
        )
        if value is not None
    ]
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

    option_frame = _option_observation_frame(
        tuple(_record_value(bundle, "option_history", ()) or ())
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


def _nonnegative_log_series(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce").clip(lower=0.0)
    return np.log1p(numeric)


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
    for factor in _OPTION_DETAIL_FACTOR_KEYS:
        source = frame.get(f"bayesian_{factor}")
        if source is None:
            continue
        transform = (
            _nonnegative_log_series
            if factor in _OPTION_COUNT_FACTOR_KEYS
            else _signed_log_series
        )
        result[factor] = transform(source).to_numpy(dtype=np.float64)
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
    parallel_workers: int = 1
    parallel_executor: str = "serial"
    parallel_fallback_reason: str | None = None

    def fall_back_to_cpu(self, reason: str) -> None:
        self.resolved = "cpu"
        self.engine = "numpy-fallback"
        self.torch_module = None
        self.numeric_precision = "float64"
        self.fallback_reason = reason
        self.runtime_fallback = True
        self.parallel_workers = 1
        self.parallel_executor = "serial"
        self.parallel_fallback_reason = None


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
    if normalized == "CPU":
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
            backend.engine = "hybrid" if normalized == "Auto" else "torch"
            backend.torch_module = torch_module
            backend.numeric_precision = "float32" if device == "mps" else "float64"
            return backend
    return backend


def _ridge_penalty(prior_strength: float, observation_count: int) -> float:
    """Map the UI percentage to standardized sample information.

    A standardized non-intercept factor contributes approximately ``n`` to the
    diagonal of ``X'X``. Treating Prior Strength as a percentage of that amount
    gives the slider a stable meaning across training-window lengths: 100 means
    a ridge penalty equal to one full sample-information diagonal.
    """
    normalized_strength = max(0.0, float(prior_strength)) / 100.0
    return normalized_strength * max(1, int(observation_count))


def _numpy_bayesian_prediction(
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    identity = np.eye(design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    ridge_penalty = _ridge_penalty(prior_strength, len(target))
    precision = (
        design.T @ design + ridge_penalty * identity
    ) / noise_variance
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
    ridge_penalty = _ridge_penalty(prior_strength, len(target))
    precision = (
        design_tensor.T @ design_tensor + ridge_penalty * identity
    ) / noise_variance
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
    if backend.engine in {"torch", "hybrid"}:
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
    identity = np.eye(numeric_design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    precision = numeric_design.T @ numeric_design + (
        _ridge_penalty(prior_strength, observation_count) * identity
    )
    try:
        coefficients = np.linalg.solve(
            precision,
            numeric_design.T @ numeric_target,
        )
        leverage = np.linalg.solve(precision, numeric_design.T)
    except (np.linalg.LinAlgError, ValueError):
        # Keep the recovery path on the same regularized precision system.
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
    noise_variance = max(
        _MIN_NOISE_VARIANCE,
        ridge_variance,
        sample_variance * 0.05,
    )
    # A modest fraction of the observed return dispersion is retained as
    # irreducible process noise even when the training design interpolates it.
    return max(_MIN_NOISE_VARIANCE, float(noise_variance), ridge_variance)


def _standardized_design_at_index(
        factor_values: dict[str, np.ndarray],
        factors: Sequence[str],
        training_indices: np.ndarray,
        current_index: int,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Build one causal standardized design and its current feature row."""
    standardized_training: list[np.ndarray] = []
    standardized_current: list[float] = []
    for factor in factors:
        training_values = np.asarray(
            factor_values[factor][training_indices],
            dtype=np.float64,
        )
        center = float(np.mean(training_values))
        scale = float(np.std(training_values))
        current_value = float(factor_values[factor][current_index])
        if (
                not math.isfinite(center)
                or not math.isfinite(scale)
                or scale <= _EPSILON
                or not math.isfinite(current_value)
        ):
            return None
        standardized_training.append((training_values - center) / scale)
        standardized_current.append((current_value - center) / scale)

    design = np.ones(
        (len(training_indices), 1 + len(standardized_training)),
        dtype=np.float64,
    )
    current = np.ones(1 + len(standardized_current), dtype=np.float64)
    if standardized_training:
        design[:, 1:] = np.column_stack(standardized_training)
        current[1:] = standardized_current
    return design, current


def _gaussian_negative_log_score(value: float, mean: float, scale: float) -> float:
    """Return the proper Gaussian negative log predictive density."""
    normalized_scale = max(float(scale), math.sqrt(_MIN_NOISE_VARIANCE))
    z_score = (float(value) - float(mean)) / normalized_scale
    return (
        math.log(normalized_scale)
        + 0.5 * math.log(2.0 * math.pi)
        + 0.5 * z_score * z_score
    )


def _causal_incremental_factor_evidence(
        factor_values: dict[str, np.ndarray],
        selected_factors: Sequence[str],
        candidate_factor: str,
        candidate_indices: np.ndarray,
        target_values: np.ndarray,
        prior_strength: float,
) -> tuple[float, int]:
    """Score one added factor on identical expanding-window validation rows."""
    augmented_factors = [*selected_factors, candidate_factor]
    common_mask = np.isfinite(target_values[candidate_indices])
    for factor in augmented_factors:
        common_mask &= np.isfinite(factor_values[factor][candidate_indices])
    common_indices = candidate_indices[common_mask]
    if len(common_indices) < (
            _MIN_TRAINING_OBSERVATIONS + _MIN_FACTOR_VALIDATION_POINTS
    ):
        return -math.inf, 0

    validation_positions = list(
        range(_MIN_TRAINING_OBSERVATIONS, len(common_indices))
    )[-_FACTOR_VALIDATION_POINTS:]
    base_scores: list[float] = []
    augmented_scores: list[float] = []
    complexity_penalties: list[float] = []
    for position in validation_positions:
        validation_index = int(common_indices[position])
        # Recreate the same availability lag as a real close-origin fit. The
        # target on ``validation_index - 1`` still needs an Open after the
        # validation origin and must not enter this inner historical model.
        training_indices = common_indices[
            common_indices <= validation_index - 2
        ]
        if len(training_indices) < _MIN_TRAINING_OBSERVATIONS:
            continue
        base_design = _standardized_design_at_index(
            factor_values,
            selected_factors,
            training_indices,
            validation_index,
        )
        augmented_design = _standardized_design_at_index(
            factor_values,
            augmented_factors,
            training_indices,
            validation_index,
        )
        if base_design is None or augmented_design is None:
            continue
        observed = float(target_values[validation_index])
        for destination, (design, current) in (
                (base_scores, base_design),
                (augmented_scores, augmented_design),
        ):
            variance = _ridge_residual_variance(
                design,
                target_values[training_indices],
                prior_strength,
            )
            mean, scale = _numpy_bayesian_prediction(
                design,
                target_values[training_indices],
                current,
                prior_strength,
                variance,
            )
            destination.append(
                _gaussian_negative_log_score(observed, mean, scale)
            )
        complexity_penalties.append(
            math.log(max(2, len(training_indices)))
            / (2.0 * len(training_indices))
        )

    if len(base_scores) < _MIN_FACTOR_VALIDATION_POINTS:
        return -math.inf, len(base_scores)
    improvement = float(np.mean(np.asarray(base_scores) - np.asarray(augmented_scores)))
    adjusted_improvement = improvement - float(np.mean(complexity_penalties))
    return adjusted_improvement, len(base_scores)


def _eligible_factor_candidates(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        candidate_indices: np.ndarray,
        current_index: int,
) -> list[tuple[str, int, float]]:
    """Return enabled factors that can enter one causal model origin."""
    candidates: list[tuple[str, int, float]] = []
    seen: set[str] = set()
    for raw_factor in enabled_factors:
        factor = str(raw_factor)
        if factor in seen or factor not in factor_values:
            continue
        seen.add(factor)
        values = np.asarray(factor_values[factor], dtype=np.float64)
        if current_index < 0 or current_index >= len(values):
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
    return candidates


def _select_active_factors(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        candidate_indices: np.ndarray,
        current_index: int,
        target_values: np.ndarray,
        prior_strength: float,
) -> list[str]:
    """Select factors by causal incremental predictive evidence.

    Coverage and dispersion determine eligibility only. Each admitted factor
    must improve expanding-window Gaussian log score on later historical rows
    after a one-parameter complexity penalty, and every comparison uses the
    same point-in-time rows for its base and augmented models.
    """
    candidates = _eligible_factor_candidates(
        factor_values,
        enabled_factors,
        candidate_indices,
        current_index,
    )

    candidate_metadata = {
        factor: (coverage, dispersion)
        for factor, coverage, dispersion in candidates
    }
    active: list[str] = []
    remaining = {factor for factor, _, _ in candidates}
    while remaining:
        evidence: list[tuple[str, float, int]] = []
        for factor in remaining:
            improvement, validation_points = _causal_incremental_factor_evidence(
                factor_values,
                active,
                factor,
                candidate_indices,
                target_values,
                prior_strength,
            )
            evidence.append((factor, improvement, validation_points))
        evidence.sort(
            key=lambda item: (
                -item[1],
                -item[2],
                -candidate_metadata[item[0]][0],
                -candidate_metadata[item[0]][1],
                _FACTOR_SELECTION_PRIORITY_INDEX.get(
                    item[0],
                    len(_FACTOR_SELECTION_PRIORITY),
                ),
                item[0],
            )
        )
        best_factor, best_improvement, _ = evidence[0]
        if not math.isfinite(best_improvement) or best_improvement <= 0.0:
            break
        active.append(best_factor)
        remaining.remove(best_factor)
    return active


def _latest_factor_selection(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        target_values: np.ndarray,
        current_index: int,
        prior_strength: float,
) -> dict[str, Any]:
    """Describe eligibility and selection for the latest causal origin."""
    normalized_index = min(max(0, int(current_index)), max(0, len(target_values) - 1))
    training_end = max(0, normalized_index - 1)
    training_start = max(0, training_end - int(training_window))
    candidate_indices = np.arange(training_start, training_end, dtype=np.int64)
    candidates = _eligible_factor_candidates(
        factor_values,
        enabled_factors,
        candidate_indices,
        normalized_index,
    )
    eligible = [factor for factor, _, _ in candidates]
    selected = _select_active_factors(
        factor_values,
        enabled_factors,
        candidate_indices,
        normalized_index,
        target_values,
        prior_strength,
    )
    selected_set = set(selected)
    eligible_set = set(eligible)
    return {
        "origin_index": normalized_index,
        "eligible": eligible,
        "selected": selected,
        "selection_status": {
            factor: (
                "selected"
                if factor in selected_set
                else "eligible-not-selected"
                if factor in eligible_set
                else "ineligible"
            )
            for factor in dict.fromkeys(
                [*map(str, enabled_factors), *eligible, *selected]
            )
        },
    }


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


def _executable_return_targets(open_prices: Sequence[float]) -> np.ndarray:
    """Map a close-origin row to its next-open-to-following-open return."""
    open_values = np.asarray(open_prices, dtype=np.float64)
    targets = np.full(len(open_values), np.nan, dtype=np.float64)
    if len(open_values) < 3:
        return targets
    valid_pair = (
        np.isfinite(open_values[1:-1])
        & np.isfinite(open_values[2:])
        & (open_values[1:-1] > 0.0)
        & (open_values[2:] > 0.0)
    )
    targets[:-2][valid_pair] = np.log(
        open_values[2:][valid_pair] / open_values[1:-1][valid_pair]
    )
    return targets


def _estimate_return_state(
        target_values: np.ndarray,
        training_indices: np.ndarray,
        fallback_scale: float,
) -> tuple[float, float, float]:
    """Estimate one stable causal AR(1) state from contiguous executable returns."""
    values = np.asarray(target_values[training_indices], dtype=np.float64)
    long_run_mean = float(np.mean(values)) if len(values) else 0.0
    if not math.isfinite(long_run_mean):
        long_run_mean = 0.0
    consecutive = np.diff(training_indices) == 1
    previous = values[:-1][consecutive]
    following = values[1:][consecutive]
    autoregression = 0.0
    residuals = values - long_run_mean
    if len(previous) >= 2:
        centered_previous = previous - long_run_mean
        centered_following = following - long_run_mean
        denominator = float(centered_previous @ centered_previous)
        if denominator > _EPSILON:
            autoregression = float(
                centered_previous @ centered_following / denominator
            )
            autoregression = min(
                _MAX_ABS_AUTOREGRESSION,
                max(-_MAX_ABS_AUTOREGRESSION, autoregression),
            )
            residuals = centered_following - autoregression * centered_previous
    innovation_variance = (
        float(np.var(residuals, ddof=1))
        if len(residuals) > 1
        else float(fallback_scale) ** 2
    )
    if not math.isfinite(innovation_variance):
        innovation_variance = float(fallback_scale) ** 2
    innovation_scale = math.sqrt(max(_MIN_NOISE_VARIANCE, innovation_variance))
    return autoregression, long_run_mean, innovation_scale


def _multi_step_normal_parameters(
        one_step_mean: float,
        one_step_scale: float,
        horizon: int,
        autoregression: float,
        long_run_mean: float,
        innovation_scale: float,
) -> tuple[float, float]:
    """Evolve cumulative return moments through the fitted AR(1) state."""
    normalized_horizon = max(1, int(horizon))
    phi = min(
        _MAX_ABS_AUTOREGRESSION,
        max(-_MAX_ABS_AUTOREGRESSION, float(autoregression)),
    )
    state_mean = float(one_step_mean)
    state_variance = max(_EPSILON, float(one_step_scale) ** 2)
    cumulative_mean = state_mean
    cumulative_variance = state_variance
    cumulative_state_covariance = state_variance
    innovation_variance = max(_EPSILON, float(innovation_scale) ** 2)
    for _ in range(1, normalized_horizon):
        state_mean = float(long_run_mean) + phi * (
            state_mean - float(long_run_mean)
        )
        next_state_variance = phi * phi * state_variance + innovation_variance
        previous_cumulative_next_state_covariance = (
            phi * cumulative_state_covariance
        )
        cumulative_mean += state_mean
        cumulative_variance += (
            next_state_variance
            + 2.0 * previous_cumulative_next_state_covariance
        )
        cumulative_state_covariance = (
            previous_cumulative_next_state_covariance + next_state_variance
        )
        state_variance = next_state_variance
    return cumulative_mean, math.sqrt(max(_EPSILON, cumulative_variance))


def _normal_crps(observed: float, mean: float, scale: float) -> float:
    """Return Gaussian CRPS in log-return units."""
    normalized_scale = max(float(scale), math.sqrt(_MIN_NOISE_VARIANCE))
    z_score = (float(observed) - float(mean)) / normalized_scale
    density = math.exp(-0.5 * z_score * z_score) / math.sqrt(2.0 * math.pi)
    return normalized_scale * (
        z_score * (2.0 * _normal_cdf(z_score) - 1.0)
        + 2.0 * density
        - (1.0 / math.sqrt(math.pi))
    )


def _probabilistic_diagnostics(
        open_prices: Sequence[float],
        predictive_mean: Sequence[float],
        predictive_std: Sequence[float],
        probability_up: Sequence[float],
) -> dict[str, Any]:
    """Score only the executable next-open-to-next-open outcome."""
    targets = _executable_return_targets(open_prices)
    means = np.asarray(predictive_mean, dtype=np.float64)
    scales = np.asarray(predictive_std, dtype=np.float64)
    probabilities = np.asarray(probability_up, dtype=np.float64)
    row_count = min(len(targets), len(means), len(scales), len(probabilities))
    direction_hits = 0
    direction_scored_points = 0
    brier_losses: list[float] = []
    negative_log_scores: list[float] = []
    crps_values: list[float] = []
    for index in range(row_count):
        observed = float(targets[index])
        mean = float(means[index])
        scale = float(scales[index])
        probability = float(probabilities[index])
        if (
                not math.isfinite(observed)
                or not math.isfinite(mean)
                or not math.isfinite(scale)
                or scale <= _EPSILON
                or not math.isfinite(probability)
        ):
            continue
        outcome = 1.0 if observed > 0.0 else 0.0
        bounded_probability = min(1.0, max(0.0, probability))
        # A flat return has no direction, and a 50/50 forecast is deliberately
        # neutral. Excluding both prevents the human-facing directional rate
        # from receiving a systematic tie-break bias.
        if observed != 0.0 and bounded_probability != 0.5:
            direction_scored_points += 1
            direction_hits += int((bounded_probability > 0.5) == bool(outcome))
        brier_losses.append((bounded_probability - outcome) ** 2)
        negative_log_scores.append(
            _gaussian_negative_log_score(observed, mean, scale)
        )
        crps_values.append(_normal_crps(observed, mean, scale))

    scored_points = len(brier_losses)
    brier_score = float(np.mean(brier_losses)) if scored_points else None
    direction_hit_rate_pct = (
        direction_hits / direction_scored_points * 100.0
        if direction_scored_points
        else None
    )
    probability_score_pct = (
        min(100.0, max(0.0, (1.0 - brier_score) * 100.0))
        if brier_score is not None
        else None
    )
    return {
        "direction_hit_rate_pct": (
            round(direction_hit_rate_pct, 2)
            if direction_hit_rate_pct is not None
            else None
        ),
        "direction_hits": direction_hits,
        "direction_scored_points": direction_scored_points,
        "probability_score_pct": (
            round(probability_score_pct, 2)
            if probability_score_pct is not None
            else None
        ),
        "brier_score": round(brier_score, 8) if brier_score is not None else None,
        "mean_negative_log_predictive_density": (
            round(float(np.mean(negative_log_scores)), 8)
            if negative_log_scores
            else None
        ),
        "mean_crps_log_return": (
            round(float(np.mean(crps_values)), 8)
            if crps_values
            else None
        ),
        "scored_points": scored_points,
        "metric_kind": "causal-next-open-direction-and-probability-score",
        "target_interval": "next-open-to-following-open",
        "proper_probability_rule": "one-minus-brier-score",
        "causal": True,
    }


def _cpu_parallel_worker_count(row_count: int) -> int:
    """Choose a bounded worker count for independent CPU walk-forward origins."""
    return resolve_worker_count(
        max(0, int(row_count)),
        mode="cpu",
        min_items=_CPU_PARALLEL_MIN_ROWS,
        max_workers=_CPU_PARALLEL_MAX_WORKERS,
    )


def _walk_forward_prediction_at_index(
        index: int,
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[int, float, float, float, float, float, float]:
    """Compute one causal origin; no worker reads a future row as a feature."""
    missing = (
        index,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
    )
    # A factor row ``j`` targets Open[j+1] -> Open[j+2]. At the close of
    # origin ``index`` only targets through ``j = index - 2`` are observable;
    # the immediately preceding factor row still depends on the next open.
    training_end = max(0, index - 1)
    training_start = max(0, training_end - training_window)
    candidate_indices = np.arange(training_start, training_end, dtype=np.int64)
    if len(candidate_indices) < _MIN_TRAINING_OBSERVATIONS:
        return missing

    active_factors = _select_active_factors(
        factor_values,
        enabled_factors,
        candidate_indices,
        index,
        target_values,
        prior_strength,
    )

    joint_mask = np.isfinite(target_values[candidate_indices])
    for factor in active_factors:
        joint_mask &= np.isfinite(factor_values[factor][candidate_indices])
    training_indices = candidate_indices[joint_mask]
    if len(training_indices) < _MIN_TRAINING_OBSERVATIONS:
        return missing

    target = target_values[training_indices]
    design_contract = _standardized_design_at_index(
        factor_values,
        active_factors,
        training_indices,
        index,
    )
    if design_contract is None:
        return missing
    design, current = design_contract

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
        return missing
    autoregression, long_run_mean, innovation_scale = _estimate_return_state(
        target_values,
        training_indices,
        standard_deviation,
    )
    return (
        index,
        mean,
        standard_deviation,
        _normal_probability_above_zero(mean, standard_deviation),
        autoregression,
        long_run_mean,
        innovation_scale,
    )


def _walk_forward_prediction_batch(
        indices: Sequence[int],
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> list[tuple[int, float, float, float, float, float, float]]:
    """Evaluate a contiguous causal batch in a process-safe top-level task."""
    return [
        _walk_forward_prediction_at_index(
            int(index),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
        for index in indices
    ]


def _walk_forward_predictions_cpu(
        indices: Sequence[int],
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[list[tuple[int, float, float, float, float, float, float]], Any]:
    """Run the CPU share of origins and return its executor statistics."""
    cpu_backend = _ComputeBackend(
        requested=backend.requested,
        resolved="cpu",
        engine="numpy",
        numeric_precision="float64",
    )
    predictions, stats = map_ordered_batches(
        _walk_forward_prediction_batch,
        indices,
        mode="cpu",
        static_args=(
            target_values,
            factor_values,
            tuple(enabled_factors),
            training_window,
            prior_strength,
            cpu_backend,
        ),
        min_items=_CPU_PARALLEL_MIN_ROWS,
        max_workers=_CPU_PARALLEL_MAX_WORKERS,
    )
    return predictions, stats


def _walk_forward_predictions_hybrid(
        frame: pd.DataFrame,
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> list[tuple[int, float, float, float, float, float, float]]:
    """Coordinate CPU origins and GPU origins concurrently for Auto mode."""
    del frame
    indices = tuple(range(len(target_values)))
    if not indices:
        backend.parallel_workers = 1
        backend.parallel_executor = "serial"
        backend.parallel_fallback_reason = None
        return []

    gpu_indices = indices[::2]
    cpu_indices = indices[1::2]

    def run_cpu() -> tuple[
            list[tuple[int, float, float, float, float, float, float]],
            Any,
    ]:
        return _walk_forward_predictions_cpu(
            cpu_indices,
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        cpu_future = executor.submit(run_cpu)
        gpu_future = executor.submit(
            _walk_forward_prediction_batch,
            gpu_indices,
            target_values,
            factor_values,
            tuple(enabled_factors),
            training_window,
            prior_strength,
            backend,
        )
        cpu_predictions, cpu_stats = cpu_future.result()
        gpu_predictions = gpu_future.result()

    backend.parallel_workers = cpu_stats.workers + 1
    backend.parallel_executor = "hybrid"
    backend.parallel_fallback_reason = cpu_stats.fallback_reason
    return [*cpu_predictions, *gpu_predictions]


def _walk_forward_predictions(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    row_count = len(frame)
    predictive_mean = np.full(row_count, np.nan, dtype=np.float64)
    predictive_std = np.full(row_count, np.nan, dtype=np.float64)
    probability_up = np.full(row_count, np.nan, dtype=np.float64)
    autoregression = np.full(row_count, np.nan, dtype=np.float64)
    long_run_mean = np.full(row_count, np.nan, dtype=np.float64)
    innovation_std = np.full(row_count, np.nan, dtype=np.float64)
    open_prices = pd.to_numeric(
        frame["Open"],
        errors="coerce",
    ).to_numpy(dtype=np.float64)
    target_values = _executable_return_targets(open_prices)

    if backend.engine == "torch":
        backend.parallel_workers = 1
        backend.parallel_executor = "serial"
        backend.parallel_fallback_reason = None
        predictions = _walk_forward_prediction_batch(
            tuple(range(row_count)),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
    elif backend.engine == "hybrid":
        predictions = _walk_forward_predictions_hybrid(
            frame,
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
    else:
        predictions, stats = _walk_forward_predictions_cpu(
            tuple(range(row_count)),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
        backend.parallel_workers = stats.workers
        backend.parallel_executor = stats.executor
        backend.parallel_fallback_reason = stats.fallback_reason

    for (
            index,
            mean,
            standard_deviation,
            probability,
            origin_autoregression,
            origin_long_run_mean,
            origin_innovation_std,
    ) in predictions:
        predictive_mean[index] = mean
        predictive_std[index] = standard_deviation
        probability_up[index] = probability
        autoregression[index] = origin_autoregression
        long_run_mean[index] = origin_long_run_mean
        innovation_std[index] = origin_innovation_std

    return (
        predictive_mean,
        predictive_std,
        probability_up,
        autoregression,
        long_run_mean,
        innovation_std,
    )


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
            "Open",
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
        "Walk-forward Bayesian regression estimates executable next-open returns "
        "from point-in-time-safe Longbridge CLI price, volume, options, valuation, "
        "and sentiment factors, then evolves a causal multi-step price field."
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
                step=0.01,
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
                unit_hint="% sample information",
                help_text=(
                    "Sets coefficient shrinkage as a percentage of the standardized "
                    "training sample's information. 100% adds a ridge penalty equal "
                    "to one factor-information diagonal."
                ),
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
                help_text="Auto coordinates bounded multi-core CPU work with an available Apple MPS or CUDA GPU for heterogeneous walk-forward computation; without an accelerator it uses CPU. CPU forces bounded multi-core CPU work. GPU explicitly requests Apple MPS or CUDA, then safely falls back to CPU.",
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

        from app.services.bayesian_market_factors import (
            build_local_bayesian_factor_bundle,
            fetch_bayesian_factor_bundle,
        )

        research_factors = tuple(
            definition.provider_key
            for definition in _BAYESIAN_FACTOR_DEFINITIONS
            if definition.observation_key == "research_history"
            and bool(normalized_params[definition.parameter_key])
        )
        option_factors_requested = any(
            bool(normalized_params[definition.parameter_key])
            for definition in _BAYESIAN_FACTOR_DEFINITIONS
            if definition.observation_key == "option_history"
        )

        provider_symbol = _longbridge_symbol(str(tickers[0]))
        if is_remote_market_access_disabled():
            bundle = build_local_bayesian_factor_bundle(
                provider_symbol,
                warmup_start,
                end,
            )
        else:
            bundle = fetch_bayesian_factor_bundle(
                provider_symbol,
                warmup_start,
                end,
                include_pe=bool(normalized_params["use_pe_ratio"]),
                include_dynamic_pe=bool(normalized_params["use_dynamic_pe_ratio"]),
                include_options=option_factors_requested,
                research_factors=research_factors,
            )
        self._warmup_bundle = bundle
        return [_bundle_ohlcv_frame(bundle)]

    def _factor_status(
            self,
            frame: pd.DataFrame,
            factor_values: dict[str, np.ndarray],
            normalized_params: dict[str, Any],
            selection: dict[str, Any] | None = None,
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
        selection = selection or {}
        eligible_factors = {
            str(factor) for factor in tuple(selection.get("eligible", ()) or ())
        }
        selected_factors = {
            str(factor) for factor in tuple(selection.get("selected", ()) or ())
        }
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
                    if definition.observation_key == "option_history":
                        if definition.key == "options":
                            value_builder = _option_ratio
                        else:
                            def value_builder(
                                    observation: object,
                                    factor_key: str = definition.key,
                            ) -> float | None:
                                return _option_feature_value(observation, factor_key)
                    else:
                        def value_builder(observation: object) -> Any:
                            return _record_value(observation, "value")
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
            is_eligible = definition.key in eligible_factors
            is_selected = definition.key in selected_factors
            selection_status = (
                "disabled"
                if not enabled
                else "selected"
                if is_selected
                else "eligible-not-selected"
                if is_eligible
                else "ineligible"
            )
            factors.append(
                {
                    "key": definition.key,
                    "label": definition.label,
                    "enabled": enabled,
                    "status": status,
                    # ``status`` describes provider/data availability. These
                    # fields describe the latest causal model-origin decision
                    # so an available factor cannot be mistaken for an active
                    # posterior coefficient.
                    "eligible": is_eligible,
                    "selected": is_selected,
                    "selection_status": selection_status,
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
        target_values = _executable_return_targets(
            pd.to_numeric(full_frame["Open"], errors="coerce").to_numpy(
                dtype=np.float64
            )
        )
        factor_selection = _latest_factor_selection(
            factor_values,
            enabled_factors,
            int(normalized_params["training_window"]),
            target_values,
            len(full_frame) - 1,
            float(normalized_params["prior_strength"]),
        )
        backend = _resolve_compute_backend(str(normalized_params["compute_backend"]))
        (
            predictive_mean,
            predictive_std,
            probability_up,
            autoregression,
            long_run_mean,
            innovation_std,
        ) = _walk_forward_predictions(
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
            (
                predictive_mean,
                predictive_std,
                probability_up,
                autoregression,
                long_run_mean,
                innovation_std,
            ) = _walk_forward_predictions(
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
                _AUTOREGRESSION_COLUMN: autoregression,
                _LONG_RUN_MEAN_COLUMN: long_run_mean,
                _INNOVATION_STD_COLUMN: innovation_std,
            }
        )
        output = visible_frame.merge(prediction_frame, on="Date", how="left", validate="one_to_one")
        # Score only the visible backtest interval. The hidden warm-up bars
        # may train a posterior, but they are not part of the user-facing
        # equity curve or its diagnostic denominator.
        diagnostics = _probabilistic_diagnostics(
            output["Open"].to_numpy(dtype=np.float64),
            output[_PREDICTION_MEAN_COLUMN].to_numpy(dtype=np.float64),
            output[_PREDICTION_STD_COLUMN].to_numpy(dtype=np.float64),
            output[_PROBABILITY_COLUMN].to_numpy(dtype=np.float64),
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
            factor_selection,
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
            "distribution_kind": "dynamic-normal-log-return",
            "target_interval": "next-open-to-following-open",
            "price_anchor_kind": "signal-close-display-anchor",
            "multi_step_kind": "causal-ar1-return-state",
            "step_unit": "trading-day",
            "predictive_mean": _json_number_list(output[_PREDICTION_MEAN_COLUMN]),
            "predictive_scale": _json_number_list(output[_PREDICTION_STD_COLUMN]),
            "probability_up": _json_number_list(output[_PROBABILITY_COLUMN]),
            "return_autoregression": _json_number_list(
                output[_AUTOREGRESSION_COLUMN]
            ),
            "return_long_run_mean": _json_number_list(
                output[_LONG_RUN_MEAN_COLUMN]
            ),
            "return_innovation_scale": _json_number_list(
                output[_INNOVATION_STD_COLUMN]
            ),
            "diagnostics": diagnostics,
            # The compatibility key now points to a genuine direction hit-rate
            # payload rather than the retired realized-cell lattice score.
            "hit_rate": diagnostics,
            "metric_geometry": {
                "diagnostic_outcome": {
                    "horizon": 1,
                    "horizon_unit": "executed-open-to-open-session",
                    "proper_probability_rule": "one-minus-brier-score",
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
            "factor_selection": {
                "origin_index": factor_selection["origin_index"],
                "eligible": list(factor_selection["eligible"]),
                "selected": list(factor_selection["selected"]),
                "selection_status": dict(factor_selection["selection_status"]),
                "method": (
                    "latest-causal-expanding-window-incremental-gaussian-log-score"
                ),
            },
            "device": {
                "requested": backend.requested,
                "resolved": backend.resolved,
                "engine": backend.engine,
                "numeric_precision": backend.numeric_precision,
                "fallback_reason": backend.fallback_reason,
                "parallel_workers": backend.parallel_workers,
                "parallel_strategy": (
                    "gpu-device"
                    if backend.engine == "torch"
                    else "cpu-gpu-heterogeneous"
                    if backend.engine == "hybrid"
                    else {
                        "process": "cpu-process-pool",
                        "thread": "cpu-thread-fallback",
                        "serial": "cpu-serial",
                    }.get(backend.parallel_executor, "cpu-serial")
                ),
                "parallel_fallback_reason": backend.parallel_fallback_reason,
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
                "factor_selection": presentation["factor_selection"],
                "compute_device": backend.resolved,
                "compute_parallel_workers": backend.parallel_workers,
                "compute_parallel_executor": backend.parallel_executor,
                "compute_parallel_fallback_reason": backend.parallel_fallback_reason,
                "market_data_source": "longbridge-cli",
                "fingerprint": fingerprint,
                "probability_field_direction_hit_rate_pct": diagnostics[
                    "direction_hit_rate_pct"
                ],
                "probability_field_direction_hits": diagnostics["direction_hits"],
                "probability_field_direction_scored_points": diagnostics[
                    "direction_scored_points"
                ],
                "probability_field_probability_score_pct": diagnostics[
                    "probability_score_pct"
                ],
                "probability_field_brier_score": diagnostics["brier_score"],
                "probability_field_scored_points": diagnostics["scored_points"],
                "probability_field_mean_nlpd": diagnostics[
                    "mean_negative_log_predictive_density"
                ],
                "probability_field_mean_crps_log_return": diagnostics[
                    "mean_crps_log_return"
                ],
            },
            presentation=presentation,
        )
