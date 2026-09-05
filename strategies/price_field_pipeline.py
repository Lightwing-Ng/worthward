"""Shared causal Price Field pipeline.

Both Bayesian Price Field and LSTM Price Field use this module for the
model-neutral market-data preparation, factor transforms, executable target,
AR(1) return state, diagnostics, and signal/presentation support. Model
training, posterior inference, factor selection, and backend scheduling remain
strategy-owned.

Code version: v0.2.0
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import math
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from app.infrastructure.connectivity import is_remote_market_access_disabled

_PRICE_FIELD_PE_MAX_STALENESS_DAYS = 14
_PRICE_FIELD_DYNAMIC_PE_MAX_STALENESS_DAYS = 1
_PRICE_FIELD_OPTIONS_MAX_STALENESS_DAYS = 7
_PRICE_FIELD_RESEARCH_MAX_STALENESS_DAYS = 90
_PRICE_FIELD_VOLUME_AT_PRICE_BIN_COUNT = 32
_PRICE_FIELD_MIN_TRAINING_OBSERVATIONS = 20
_PRICE_FIELD_MIN_NOISE_VARIANCE = 1e-8
_PRICE_FIELD_MAX_ABS_AUTOREGRESSION = 0.95
_PRICE_FIELD_EPSILON = 1e-12

_EPSILON = _PRICE_FIELD_EPSILON
_MIN_NOISE_VARIANCE = _PRICE_FIELD_MIN_NOISE_VARIANCE
_MAX_ABS_AUTOREGRESSION = _PRICE_FIELD_MAX_ABS_AUTOREGRESSION
_RESEARCH_MAX_STALENESS_DAYS = _PRICE_FIELD_RESEARCH_MAX_STALENESS_DAYS
_DYNAMIC_PE_MAX_STALENESS_DAYS = _PRICE_FIELD_DYNAMIC_PE_MAX_STALENESS_DAYS
_OPTIONS_MAX_STALENESS_DAYS = _PRICE_FIELD_OPTIONS_MAX_STALENESS_DAYS
_PE_MAX_STALENESS_DAYS = _PRICE_FIELD_PE_MAX_STALENESS_DAYS
_VOLUME_AT_PRICE_BIN_COUNT = _PRICE_FIELD_VOLUME_AT_PRICE_BIN_COUNT
_MIN_TRAINING_OBSERVATIONS = _PRICE_FIELD_MIN_TRAINING_OBSERVATIONS
_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT = 5.0
_CELL_DISPLAY_THRESHOLD_MIN_PCT = 0.0
_CELL_DISPLAY_THRESHOLD_MAX_PCT = 50.0

@dataclass(frozen=True)
class PriceFieldFactorDefinition:
    key: str
    label: str
    parameter_key: str
    provider_key: str
    default: bool
    help_text: str
    observation_key: str | None = None
    max_staleness_days: int | None = None


PRICE_FIELD_FACTOR_DEFINITIONS = tuple(sorted(
    (
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
            key="market_temperature",
            label="Market Temperature",
            parameter_key="use_market_temperature",
            provider_key="market_temperature",
            default=False,
            help_text="Opt-in Longbridge market sentiment temperature history for the ticker's exchange.",
            observation_key="research_history",
            max_staleness_days=_RESEARCH_MAX_STALENESS_DAYS,
        ),
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
            key="pe",
            label="P/E Ratio",
            parameter_key="use_pe_ratio",
            provider_key="pe",
            default=True,
            help_text="Uses backward as-of P/E observations from Longbridge CLI when available.",
            observation_key="pe_history",
            max_staleness_days=_PE_MAX_STALENESS_DAYS,
        ),
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
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
        PriceFieldFactorDefinition(
            key="volume",
            label="Volume",
            parameter_key="use_volume",
            provider_key="ohlcv",
            default=True,
            help_text="Uses daily Longbridge CLI trading volume as a walk-forward factor.",
        ),
        PriceFieldFactorDefinition(
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
PRICE_FIELD_FACTOR_PARAMETER_KEYS = frozenset(
    definition.parameter_key for definition in PRICE_FIELD_FACTOR_DEFINITIONS
)
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
        raise ValueError("Price Field requires a ticker.") from exc


def _normalize_ohlcv_frame(dataset: pd.DataFrame) -> pd.DataFrame:
    frame = dataset.copy()
    if "Date" not in frame.columns:
        frame["Date"] = pd.to_datetime(frame.index, errors="coerce", utc=True)
    frame["Date"] = _normalized_datetime_series(frame["Date"])

    if "Close" not in frame.columns:
        raise ValueError("Price Field requires a Close column.")
    if "Open" not in frame.columns:
        raise ValueError(
            "Price Field requires observed Open prices for its "
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


def _build_factor_columns(
        frame: pd.DataFrame,
        chip_window: int,
        *,
        use_volume_at_price: bool = True,
) -> dict[str, np.ndarray]:
    volume = pd.to_numeric(frame["Volume"], errors="coerce").clip(lower=0.0)
    volume_at_price = (
        _rolling_volume_at_price_percentile(frame, chip_window)
        if use_volume_at_price
        else np.full(len(frame), np.nan, dtype=np.float64)
    )

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
def _gaussian_negative_log_score(value: float, mean: float, scale: float) -> float:
    """Return the proper Gaussian negative log predictive density."""
    normalized_scale = max(float(scale), math.sqrt(_MIN_NOISE_VARIANCE))
    z_score = (float(value) - float(mean)) / normalized_scale
    return (
        math.log(normalized_scale)
        + 0.5 * math.log(2.0 * math.pi)
        + 0.5 * z_score * z_score
    )
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

def load_price_field_market_bundle(
        tickers: Sequence[str],
        *,
        interval: str,
        start: Any,
        end: Any,
        params: Mapping[str, Any] | None = None,
) -> object:
    """Load one causal, warm-up-inclusive factor bundle for either model."""
    if interval != "1d":
        raise ValueError("Price Field supports daily data only.")
    if len(tickers) != 1:
        raise ValueError("Price Field requires exactly one ticker.")

    normalized_params = dict(params or {})
    warmup_bars = max(
        int(normalized_params.get("training_window", 60)),
        int(normalized_params.get("chip_window", 30))
        if bool(normalized_params.get("use_volume_at_price", True)) else 0,
    ) + 2
    warmup_days = math.ceil(warmup_bars * 7 / 5) + 14
    warmup_start = _normalized_timestamp(start) - timedelta(days=warmup_days)

    from app.services.price_field_market_factors import (
        build_local_price_field_factor_bundle,
        fetch_price_field_factor_bundle,
    )

    research_factors = tuple(
        definition.provider_key
        for definition in PRICE_FIELD_FACTOR_DEFINITIONS
        if definition.observation_key == "research_history"
        and bool(normalized_params.get(definition.parameter_key, definition.default))
    )
    option_factors_requested = any(
        bool(normalized_params.get(definition.parameter_key, definition.default))
        for definition in PRICE_FIELD_FACTOR_DEFINITIONS
        if definition.observation_key == "option_history"
    )

    provider_symbol = _longbridge_symbol(str(tickers[0]))
    if is_remote_market_access_disabled():
        return build_local_price_field_factor_bundle(
            provider_symbol,
            warmup_start,
            end,
        )
    return fetch_price_field_factor_bundle(
        provider_symbol,
        warmup_start,
        end,
        include_pe=bool(normalized_params.get("use_pe_ratio", True)),
        include_dynamic_pe=bool(normalized_params.get("use_dynamic_pe_ratio", False)),
        include_options=option_factors_requested,
        research_factors=research_factors,
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
    """Emit threshold intent while the execution engine owns position state."""
    numeric = np.asarray(probabilities, dtype=np.float64)
    finite = np.isfinite(numeric)
    return (
        finite & (numeric >= entry_probability),
        finite & (numeric <= 1.0 - entry_probability),
    )


def build_price_field_factor_status(
        bundle: object | None,
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        normalized_params: dict[str, Any],
        selection: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    bundle_status = dict(
        _record_value(bundle, "factor_status", {}) or {}
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
    for definition in PRICE_FIELD_FACTOR_DEFINITIONS:
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
                        bundle,
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


# Public model-neutral entry points. The implementation helpers above stay
# private to this module so the strategy APIs remain narrow and explicit.
record_price_field_value = _record_value
normalize_price_field_timestamp = _normalized_timestamp
normalize_price_field_ohlcv = _normalize_ohlcv_frame
bundle_to_price_field_ohlcv = _bundle_ohlcv_frame
merge_price_field_bundle_observations = _merge_bundle_observations
build_price_field_factor_columns = _build_factor_columns
executable_price_field_return_targets = _executable_return_targets
estimate_price_field_return_state = _estimate_return_state
multi_step_price_field_normal_parameters = _multi_step_normal_parameters
normal_probability_above_zero = _normal_probability_above_zero
price_field_probabilistic_diagnostics = _probabilistic_diagnostics
probability_threshold_signals = _probability_threshold_signals
json_number_list = _json_number_list
longbridge_price_field_symbol = _longbridge_symbol
rolling_price_field_volume_at_price_percentile = _rolling_volume_at_price_percentile
gaussian_negative_log_score = _gaussian_negative_log_score
option_ratio = _option_ratio
min_price_field_noise_variance = _MIN_NOISE_VARIANCE
price_field_epsilon = _EPSILON
