"""Shared adapter for the econometric direct-horizon Price Field strategies. Code version: v1.0.0.

Each model forecasts Gaussian marginals of ``log(Close[t+h] / Close[t])`` for
h = 1..20 at every origin from daily OHLC up to that origin. The adapter owns
market loading (a warmup-inclusive Longbridge CLI bundle, OHLCV only), the
parameter contract, visible-window scoring and the probability-grid
presentation; subclasses implement ``forecast_price_field``. There is no
training slot: every fit is a deterministic causal re-estimation inside
``compute_signals``. Refits follow fixed business-day blocks of the session
dates rather than the first loaded row, and the standalone Score-Driven model
skips fits that serve only warmup origins, which are never presented or scored.
"""

from __future__ import annotations

from dataclasses import replace
import hashlib
import json
import math
from typing import Any, Sequence

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix
from strategies.price_field.direct_horizon import (
    attach_direct_signals,
    build_direct_presentation,
    direct_horizon_series,
    direct_prediction_columns,
    score_direct_forecasts,
)
from strategies.price_field.econometric.crps_learning import COMBINER_DEFAULTS
from strategies.price_field.econometric.forecasts import (
    EconometricForecast,
    EconometricSettings,
    PriceArrays,
    crps_learning_forecast,
    har_range_forecast,
    rough_volatility_forecast,
    score_driven_forecast,
)
from strategies.price_field.econometric.location import DRIFT_DEFAULTS, drift_components, drift_in_use
from strategies.price_field.econometric.measures import usable_range_mask
from strategies.price_field.pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS,
    bundle_to_price_field_ohlcv,
    load_price_field_market_bundle,
    normalize_price_field_ohlcv,
    plain_market_bundle,
    record_price_field_value,
)
from strategies.price_field.scoring import visible_scoring_bounds

AVAILABILITY_POLICY = "origin-close-ohlcv/v1"
HORIZON_MAPPING = "direct-estimated-1-through-20"
# The bundle loader turns bars into calendar days with a 5/7 weekday ratio, so exchange holidays
# (about 4% of weekdays in New York, up to about 7% in Hong Kong) get a proportional allowance;
# the fixed margin covers the 22-session aggregates and the 20-session targets.
WARMUP_HOLIDAY_ALLOWANCE = 0.08
WARMUP_MARGIN_BARS = 60
# A fit reaches back over its window, the longest target (20) and the monthly aggregate (22)
# from the start of the refit block that holds the first visible origin.
FIT_LOOKBACK_BARS = 42
FACTOR_SWITCHES = (
    ("use_drift", "drift", "Long-run drift"),
    ("use_intraday_range", "intraday_range", "Intraday range measures"),
)


def json_safe(value: Any) -> Any:
    """Convert numpy containers and scalars to built-in JSON values (non-finite -> None)."""
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.ndarray):
        return json_safe(value.tolist())
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        return number if math.isfinite(number) else None
    if value is None or isinstance(value, str):
        return value
    return str(value)


def valid_forecast_rows(means: np.ndarray, stds: np.ndarray) -> np.ndarray:
    """Rows whose 20 means are finite and whose 20 standard deviations are finite and positive."""
    return (np.all(np.isfinite(means), 1) & np.all(np.isfinite(stds), 1)
            & np.all(np.where(np.isfinite(stds), stds, 0.0) > 0, 1))


class EconometricPriceFieldStrategy(BaseStrategy):
    """Own the data, parameter and presentation policy; subclasses own the forecast."""

    strategy_category = "price-field"
    strategy_supports = StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)
    strategy_supported_intervals = ("1d",)
    strategy_market_data_source = "longbridge-cli"
    strategy_presentation_renderer = "probability-grid-v1"
    backtest_cacheable = False
    econometric_model = ""
    default_fit_window = 2000
    default_scale_multiplier = 1.0
    fit_window_help = ""
    scale_multiplier_help = ""

    def __init__(self) -> None:
        self._warmup_bundle: object | None = None

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("NVDA",)

    def model_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        """Extra model parameters placed after the shared drift controls."""
        return ()

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        parameter = StrategyParameterDefinition
        return (
            parameter("cell_display_threshold", "Cell display threshold (%)", kind="number", default=1.0,
                      minimum=0.0, maximum=50.0, step=0.01, optimizable=False,
                      help_text="Visibility only; all cells and tails still contribute to probability scoring."),
            parameter("training_window", "Fit window", default=self.default_fit_window, minimum=63, maximum=2520,
                      step=1, unit_hint="sessions", help_text=self.fit_window_help),
            parameter("retrain_interval", "Refit interval", default=20, minimum=1, maximum=63, step=1,
                      unit_hint="weekdays",
                      help_text=("Weekdays per re-estimation block; blocks are fixed business-day ranges counted "
                                 "from 3 Jan 2000, so exchange holidays only shorten a block and forecasts do not "
                                 "depend on where the loaded history starts. Intervening forecasts reuse the "
                                 "block's fit.")),
            parameter("scale_multiplier", "CRPS scale multiplier", kind="number",
                      default=self.default_scale_multiplier, minimum=0.5, maximum=1.5, step=0.01,
                      help_text=("Gaussian CRPS prefers a slightly narrower scale than the standard deviation on "
                                 "fat-tailed returns; this fixed factor multiplies every forecast standard deviation. "
                                 + self.scale_multiplier_help).strip()),
            parameter("drift_prior_sharpe", "Prior annual Sharpe", kind="number",
                      default=float(DRIFT_DEFAULTS["prior_sharpe"]), minimum=0.0, maximum=2.0, step=0.05,
                      help_text=("Center of the Bayesian prior on the annualized Sharpe ratio of daily log returns; "
                                 "the drift is the posterior Sharpe times the rolling 252-session volatility.")),
            parameter("drift_prior_strength", "Prior strength", default=int(DRIFT_DEFAULTS["prior_strength"]),
                      minimum=0, maximum=10080, step=1, unit_hint="sessions",
                      help_text="Pseudo-sessions of prior evidence weighed against the observed standardized returns."),
            parameter("drift_window", "Drift window", default=int(DRIFT_DEFAULTS["window"]), minimum=21,
                      maximum=2520, step=1, unit_hint="sessions",
                      help_text="Trailing sessions of volatility-standardized returns that update the Sharpe prior."),
            *self.model_parameter_definitions(),
            parameter("entry_probability", "Entry probability (%)", kind="number", default=60.0,
                      minimum=50.0, maximum=95.0, step=0.1, optimizable=False,
                      help_text="Compatibility threshold for the Backtest transaction display; not a probability-training objective."),
            parameter("use_drift", "Long-run drift", kind="boolean", default=True, group="factors",
                      subgroup="Location",
                      help_text=("Bayesian Sharpe-ratio drift from closes known at the forecast date; "
                                 "off forecasts a zero mean log return.")),
            parameter("use_intraday_range", "Intraday range measures", kind="boolean", default=True,
                      group="factors", subgroup="Realized measures",
                      help_text=("Open, high and low of each session in the daily variance proxy; "
                                 "off uses close-to-close returns only.")),
        )

    def settings_from_params(self, normalized: dict[str, Any]) -> EconometricSettings:
        """Resolve the model settings from normalized strategy parameters."""
        return EconometricSettings(
            fit_window=int(normalized["training_window"]),
            refit_interval=int(normalized["retrain_interval"]),
            scale_multiplier=float(normalized["scale_multiplier"]),
            use_drift=bool(normalized["use_drift"]),
            use_intraday_range=bool(normalized["use_intraday_range"]),
            drift_prior_sharpe=float(normalized["drift_prior_sharpe"]),
            drift_prior_strength=float(normalized["drift_prior_strength"]),
            drift_window=int(normalized["drift_window"]),
            learning_rate=float(normalized.get("learning_rate", COMBINER_DEFAULTS["eta"])),
            forgetting=float(normalized.get("forgetting", COMBINER_DEFAULTS["rho"])),
        )

    def forecast_price_field(self, prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
        """Return per-origin (N, 20) means and standard deviations plus JSON-ready diagnostics."""
        raise NotImplementedError

    def warmup_bars(self, normalized: dict[str, Any]) -> int:
        """Bars of history requested before the visible range (fit window and drift inputs)."""
        fit_inputs = int(normalized["training_window"]) + int(normalized["retrain_interval"]) + FIT_LOOKBACK_BARS
        drift_inputs = int(normalized["drift_window"]) + int(DRIFT_DEFAULTS["vol_window"])
        base = max(fit_inputs, drift_inputs)
        return base + math.ceil(WARMUP_HOLIDAY_ALLOWANCE * base) + WARMUP_MARGIN_BARS

    def load_market_datasets(
            self, tickers: Sequence[str], *, interval: str, start: Any, end: Any,
            params: dict[str, Any] | None = None,
    ) -> list[pd.DataFrame]:
        normalized = self.normalize_params(params)
        # OHLCV only: every provider factor stays off so no extra history is fetched.
        load_params: dict[str, Any] = {definition.parameter_key: False for definition in PRICE_FIELD_FACTOR_DEFINITIONS}
        load_params.update(training_window=self.warmup_bars(normalized), use_volume_at_price=False)
        bundle = plain_market_bundle(load_price_field_market_bundle(
            tickers, interval=interval, start=start, end=end, params=load_params,
        ))
        self._warmup_bundle = bundle
        return [bundle_to_price_field_ohlcv(bundle)]

    def _factor_entries(
            self, normalized: dict[str, Any], prices: PriceArrays, settings: EconometricSettings,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Presentation entries for the two factor switches, in the neural benchmark-entry shape.

        ``finite_observations`` counts the bars at which the model uses the input: origins whose
        mean comes from the drift (past its burn-in, through its prior before any observed return)
        and sessions whose open, high and low enter the variance proxy. An enabled switch is
        ``active`` and selected when the model uses its input at least once, and ``insufficient``
        (ineligible) when the forecasts never use it, for example with no origin past the drift
        burn-in or with no usable intraday range.
        """
        total = len(prices)
        drift = drift_components(prices.close, prior_sharpe=settings.drift_prior_sharpe,
                                 prior_strength=settings.drift_prior_strength, window=settings.drift_window)
        used = {
            "drift": int(drift_in_use(drift).sum()),
            "intraday_range": int(usable_range_mask(prices.open, prices.high, prices.low, prices.close).sum()),
        }
        factors: list[dict[str, Any]] = []
        for parameter_key, key, label in FACTOR_SWITCHES:
            enabled = bool(normalized[parameter_key])
            active = enabled and used[key] > 0
            factors.append({"key": key, "label": label, "enabled": enabled,
                            "status": "disabled" if not enabled else "active" if active else "insufficient",
                            "eligible": active, "selected": active,
                            "selection_status": "selected" if active else "ineligible" if enabled else "disabled",
                            "finite_observations": used[key], "total_observations": total,
                            "coverage": used[key] / total if total else 0.0})
        selected = [entry["key"] for entry in factors if entry["selected"]]
        selection = {"eligible": selected, "selected": selected, "method": "econometric-factor-switches",
                     "selection_status": {entry["key"]: entry["selection_status"] for entry in factors}}
        return factors, selection

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        normalized = self.normalize_params(params)
        visible = normalize_price_field_ohlcv(dataset)
        full = bundle_to_price_field_ohlcv(self._warmup_bundle) if self._warmup_bundle is not None else visible
        # Session dates anchor every refit schedule, so a date's forecast does not follow the loaded start.
        prices = PriceArrays(*(full[column].to_numpy(dtype=float) for column in ("Open", "High", "Low", "Close")),
                             dates=full["Date"].to_numpy(dtype="datetime64[ns]"))
        first_visible, _ = visible_scoring_bounds(full["Date"], visible["Date"])
        settings = replace(self.settings_from_params(normalized), first_origin=first_visible)
        forecast = self.forecast_price_field(prices, settings)
        means = np.array(forecast.means, dtype=float, copy=True)
        stds = np.array(forecast.stds, dtype=float, copy=True)
        valid = valid_forecast_rows(means, stds)
        means[~valid] = np.nan
        stds[~valid] = np.nan
        prediction_frame = pd.DataFrame(direct_prediction_columns(full["Date"], means, stds))
        output, visible_means, visible_stds, probabilities = attach_direct_signals(
            visible, prediction_frame, normalized["entry_probability"],
        )
        scoring_frame = full.merge(prediction_frame, on="Date", how="left", validate="one_to_one")
        diagnostics = score_direct_forecasts(scoring_frame, visible["Date"])
        factors, selection = self._factor_entries(normalized, prices, settings)
        selection = {"origin_index": max(0, len(output) - 1), **selection}
        first_valid = int(np.argmax(valid)) if valid.any() else None
        model_diagnostics = json_safe({
            **forecast.diagnostics,
            "first_forecast_origin": first_valid,
            "first_visible_origin": first_visible,
            "first_forecast_date": (pd.Timestamp(full["Date"].iloc[first_valid]).isoformat()
                                    if first_valid is not None else None),
            "history_rows": len(full),
        })
        model_version = f"{self.strategy_id}-model/v1.0.0"
        identity = json.dumps({"model": model_version, "availability": AVAILABILITY_POLICY,
                               "params": {key: value for key, value in normalized.items()
                                          if key != "cell_display_threshold"}}, sort_keys=True, default=str)
        market = full[["Date", "Open", "High", "Low", "Close"]]
        fingerprint = hashlib.sha256(
            identity.encode() + pd.util.hash_pandas_object(market, index=False).values.tobytes()
        ).hexdigest()
        device = {"requested": "CPU", "resolved": "cpu", "engine": "numpy"}
        commands = record_price_field_value(self._warmup_bundle, "source_commands", []) if self._warmup_bundle else []
        presentation = build_direct_presentation(
            schema=f"{self.strategy_id}/v1", model_version=model_version,
            cell_display_threshold_pct=normalized["cell_display_threshold"], dates=output["Date"],
            means=visible_means, stds=visible_stds, probabilities=probabilities, diagnostics=diagnostics,
            factors=factors, factor_selection=selection, device=device,
            source={"market_data": "longbridge-cli", "commands": json_safe(list(commands or [])),
                    "availability_policy": AVAILABILITY_POLICY},
            fingerprint=fingerprint, horizon_mapping=HORIZON_MAPPING,
            extra={**direct_horizon_series(visible_means, visible_stds), "econometric": model_diagnostics},
        )
        return StrategySignalResult(output, "buy_signal", "sell_signal", required_execution_mode="next_open",
                                    presentation=presentation, metadata={
                                        "fingerprint": fingerprint, "factors": factors, "factor_selection": selection,
                                        "compute_device": "cpu", "compute_engine": "numpy",
                                        "market_data_source": "longbridge-cli", "diagnostics": diagnostics,
                                        "model_version": model_version, "econometric": model_diagnostics})


class HarRangeEconometricStrategy(EconometricPriceFieldStrategy):
    """Shared drift plus the HAR Range scale."""

    econometric_model = "har-range"
    default_fit_window = 2000
    default_scale_multiplier = 0.94
    fit_window_help = ("Maximum matured sessions in each per-horizon HAR regression; "
                       "shorter histories use every matured session.")

    def forecast_price_field(self, prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
        return har_range_forecast(prices, settings)


class ScoreDrivenEconometricStrategy(EconometricPriceFieldStrategy):
    """Shared drift plus the Score-Driven (Beta-t-EGARCH) scale."""

    econometric_model = "score-driven"
    default_fit_window = 1000
    default_scale_multiplier = 0.96
    fit_window_help = "Trailing returns in each penalized maximum-likelihood fit."
    scale_multiplier_help = ("With intraday range measures off, the close-only fallback uses this value "
                             "times 0.94/0.96, which is its own 0.94 at the default.")

    def forecast_price_field(self, prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
        return score_driven_forecast(prices, settings)


class RoughVolatilityEconometricStrategy(EconometricPriceFieldStrategy):
    """Shared drift plus the Rough Volatility (Matern kriging) scale."""

    econometric_model = "rough-volatility"
    default_fit_window = 2000
    default_scale_multiplier = 0.94
    fit_window_help = ("Trailing sessions for the variogram fit and matured pairs for the "
                       "proxy-to-close calibration.")

    def forecast_price_field(self, prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
        return rough_volatility_forecast(prices, settings)


class CrpsLearningEconometricStrategy(EconometricPriceFieldStrategy):
    """CRPS Learning combination of the three scale models and of {drift, zero}."""

    econometric_model = "crps-learning"
    default_fit_window = 2000
    default_scale_multiplier = 1.0
    fit_window_help = ("Caps each expert's own fit window (HAR Range 2000, Score-Driven 1000, "
                       "Rough Volatility 2000 sessions).")
    scale_multiplier_help = "It applies to the combined forecast; each expert keeps its own frozen multiplier."

    def model_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        parameter = StrategyParameterDefinition
        return (
            parameter("learning_rate", "Learning rate", kind="number", default=float(COMBINER_DEFAULTS["eta"]),
                      minimum=0.05, maximum=4.0, step=0.05,
                      help_text="Bernstein Online Aggregation rate for the per-horizon scale-expert weights."),
            parameter("forgetting", "Forgetting factor", kind="number", default=float(COMBINER_DEFAULTS["rho"]),
                      minimum=0.95, maximum=1.0, step=0.0005,
                      help_text="Discount applied to accumulated regret at each update; 1 keeps the full history."),
        )

    def forecast_price_field(self, prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
        return crps_learning_forecast(prices, settings)
