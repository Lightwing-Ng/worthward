"""Frozen compositions of the econometric location and scale models.

Code version: v1.0.0

Every Price Field model here forecasts Gaussian marginals N(MU[t, h-1],
SIG[t, h-1]^2) of ln(C[t+h] / C[t]) for h = 1..20 from bars <= t:

* the location is the shared Bayesian Sharpe drift (``location.py``) or zero;
* HAR Range, Score-Driven and Rough Volatility each supply their own scale,
  already multiplied by the model's CRPS scale multiplier;
* CRPS Learning combines those three scales (each at its own frozen
  multiplier, rows without a forecast filled by sigma60 * sqrt(h)) with a
  decoupled BOA whose location experts are {drift, zero}, then applies its own
  multiplier (1.0 by default).

The research assembly (round 3) composed the frozen models exactly this way;
the defaults below reproduce it for pure-array inputs.

Refit schedule: without session dates every scale model refits on the index grid of
the research modules (``0, refit, 2 refit, ...``). With ``PriceArrays.dates`` (the
strategy path) each refit origin starts a fixed business-day block
(``measures.session_refit_origins``), so a session's HAR Range and Score-Driven
forecasts do not depend on where the loaded history starts once their fit windows
lie inside it. Two frozen states still do, by design: the Rough Volatility
expanding log-variance mean and the CRPS Learning weights, which accumulate from
the first loaded bar (learning starts at bar 60 of the loaded history).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import math
from typing import Any, Iterator

import numpy as np

from strategies.price_field.econometric.crps_learning import (
    COMBINER_DEFAULTS,
    crps_learning_combine,
    fill_invalid_scale,
    reference_scale_forecast,
)
from strategies.price_field.econometric.har import HAR_DEFAULTS, har_fit_summary, har_variance
from strategies.price_field.econometric.location import (
    DRIFT_DEFAULTS,
    drift_components,
    drift_summary,
    HORIZON_STEPS,
)
from strategies.price_field.econometric.measures import session_refit_origins
from strategies.price_field.econometric.rough import ROUGH_DEFAULTS, rough_fit_summary, rough_sigma
from strategies.price_field.econometric.score_driven import (
    BETAT_DEFAULTS,
    RANGE_DEFAULTS,
    score_driven_fit_summary,
    score_driven_sigma,
)

HORIZONS = 20
SCORE_DRIVEN_FALLBACK_RATIO = float(BETAT_DEFAULTS["k_mult"]) / float(RANGE_DEFAULTS["k_mult"])


@dataclass(frozen=True)
class PriceArrays:
    """Chronological daily OHLC arrays of equal length, with optional session dates.

    ``dates`` (datetime64-compatible, one per bar) anchors the refit schedules to
    business-day blocks; without it the models use the research index grid.
    Iteration yields the four price arrays only.
    """

    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    dates: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.close)

    def __iter__(self) -> Iterator[np.ndarray]:
        return iter((self.open, self.high, self.low, self.close))

    def refit_origins(self, refit_interval: int) -> np.ndarray | None:
        """Date-anchored refit origins, or None for the index grid when no dates are attached."""
        if self.dates is None:
            return None
        if len(self.dates) != len(self.close):
            raise ValueError("Price arrays need one session date per bar.")
        return session_refit_origins(self.dates, refit_interval)

    @property
    def refit_schedule(self) -> str:
        """Diagnostic name of the refit schedule these arrays select."""
        return "row-index-grid" if self.dates is None else "session-date-blocks"


@dataclass(frozen=True)
class EconometricSettings:
    """Model settings resolved from the strategy parameters (defaults are the frozen spec)."""

    fit_window: int
    refit_interval: int = 20
    scale_multiplier: float = 1.0
    use_drift: bool = True
    use_intraday_range: bool = True
    drift_prior_sharpe: float = float(DRIFT_DEFAULTS["prior_sharpe"])
    drift_prior_strength: float = float(DRIFT_DEFAULTS["prior_strength"])
    drift_window: int = int(DRIFT_DEFAULTS["window"])
    learning_rate: float = float(COMBINER_DEFAULTS["eta"])
    forgetting: float = float(COMBINER_DEFAULTS["rho"])
    # First origin whose standalone forecast is presented; Score-Driven skips earlier fits.
    first_origin: int = 0


@dataclass(frozen=True)
class EconometricForecast:
    """Per-origin direct-horizon means and standard deviations (N, 20) plus diagnostics."""

    means: np.ndarray
    stds: np.ndarray
    diagnostics: dict[str, Any]


def location_forecast(close: np.ndarray, settings: EconometricSettings) -> tuple[np.ndarray, dict[str, Any]]:
    """Shared drift MU (N, 20), or zero when the drift switch is off."""
    count = len(close)
    if not settings.use_drift:
        return np.zeros((count, HORIZONS)), {"model": "zero-mean"}
    components = drift_components(close, prior_sharpe=settings.drift_prior_sharpe,
                                  prior_strength=settings.drift_prior_strength, window=settings.drift_window)
    means = components["mu"][:, None] * HORIZON_STEPS[None, :]
    return means, {
        "model": "bayesian-sharpe-drift",
        "prior_annual_sharpe": float(settings.drift_prior_sharpe),
        "prior_strength_sessions": float(settings.drift_prior_strength),
        "window_sessions": int(settings.drift_window),
        "volatility_window_sessions": int(DRIFT_DEFAULTS["vol_window"]),
        **drift_summary(components, prior_strength=settings.drift_prior_strength),
    }


def har_range_scale(prices: PriceArrays, settings: EconometricSettings, *,
                    multiplier: float | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """HAR Range SIG (N, 20) with the model multiplier (the strategy parameter by default)."""
    k = settings.scale_multiplier if multiplier is None else multiplier
    variance, info = har_variance(prices.open, prices.high, prices.low, prices.close,
                                  use_range=settings.use_intraday_range, window=settings.fit_window,
                                  refit=settings.refit_interval,
                                  refit_origins=prices.refit_origins(settings.refit_interval), return_info=True)
    return k * np.sqrt(variance), {
        "model": "har-range",
        "proxy": "parkinson-plus-overnight-gap" if settings.use_intraday_range else "squared-close-return",
        "scale_multiplier": float(k),
        **har_fit_summary(info),
    }


def score_driven_scale(prices: PriceArrays, settings: EconometricSettings, *,
                       multiplier: float | None = None, start: int | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """Score-Driven SIG (N, 20).

    With intraday range measures the range-augmented Beta-t-EGARCH uses ``multiplier``;
    without them the close-only Beta-t-EGARCH uses ``multiplier * 0.94 / 0.96``, i.e. its
    own frozen 0.94 at the default 0.96. ``multiplier=None`` in the CRPS Learning expert
    keeps each variant's frozen multiplier. ``start`` skips the fits that serve only
    earlier origins (rows before it are NaN; later rows are unchanged).
    """
    use_range = settings.use_intraday_range
    if multiplier is None:
        k = None
    else:
        k = float(multiplier) if use_range else float(multiplier) * SCORE_DRIVEN_FALLBACK_RATIO
    sigma, refits, parameters = score_driven_sigma(
        prices.open, prices.high, prices.low, prices.close, use_range=use_range, k_mult=k,
        window=settings.fit_window, refit=settings.refit_interval, start=start,
        refit_origins=prices.refit_origins(settings.refit_interval), return_params=True)
    defaults = RANGE_DEFAULTS if use_range else BETAT_DEFAULTS
    return sigma, {
        "model": "range-beta-t-egarch" if use_range else "beta-t-egarch",
        "prior_scale": float(defaults["prior_scale"]),
        "scale_multiplier": float(defaults["k_mult"] if k is None else k),
        **score_driven_fit_summary(refits, parameters),
    }


def rough_volatility_scale(prices: PriceArrays, settings: EconometricSettings, *,
                           multiplier: float | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """Rough Volatility SIG (N, 20); the fit window sets both the variogram and calibration windows."""
    k = settings.scale_multiplier if multiplier is None else multiplier
    proxy = "yz" if settings.use_intraday_range else "r2"
    sigma, parts = rough_sigma(prices.open, prices.high, prices.low, prices.close, k=k, proxy=proxy,
                               window=settings.fit_window, cal_window=settings.fit_window,
                               refit=settings.refit_interval,
                               refit_origins=prices.refit_origins(settings.refit_interval), return_parts=True)
    return sigma, {
        "model": "matern-bss-kriging",
        "proxy": "yang-zhang" if settings.use_intraday_range else "squared-close-return",
        "scale_multiplier": float(k),
        # Frozen specification: the log-variance mean averages every loaded bar, so it depends
        # slightly on where the loaded history starts.
        "log_variance_mean": "expanding-from-first-loaded-bar",
        **rough_fit_summary(parts),
    }


def _compose(means: np.ndarray, stds: np.ndarray, location: dict[str, Any], scale: dict[str, Any],
             settings: EconometricSettings, model: str, prices: PriceArrays) -> EconometricForecast:
    return EconometricForecast(means, stds, {
        "model": model,
        "fit_window": int(settings.fit_window),
        "refit_interval": int(settings.refit_interval),
        "refit_schedule": prices.refit_schedule,
        "scale_multiplier": float(settings.scale_multiplier),
        "intraday_range_measures": bool(settings.use_intraday_range),
        "location": location,
        "scale": scale,
    })


def har_range_forecast(prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
    """Shared drift + HAR Range scale."""
    means, location = location_forecast(prices.close, settings)
    stds, scale = har_range_scale(prices, settings)
    return _compose(means, stds, location, scale, settings, "har-range", prices)


def score_driven_forecast(prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
    """Shared drift + Score-Driven scale.

    Fits that serve only origins before ``settings.first_origin`` are skipped (their rows
    are NaN); the presented rows are identical to fitting every refit.
    """
    means, location = location_forecast(prices.close, settings)
    start = int(settings.first_origin) if settings.first_origin > 0 else None
    stds, scale = score_driven_scale(prices, settings, multiplier=settings.scale_multiplier, start=start)
    return _compose(means, stds, location, scale, settings, "score-driven", prices)


def rough_volatility_forecast(prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
    """Shared drift + Rough Volatility scale."""
    means, location = location_forecast(prices.close, settings)
    stds, scale = rough_volatility_scale(prices, settings)
    return _compose(means, stds, location, scale, settings, "rough-volatility", prices)


def _weight_snapshot(weights: np.ndarray, names: list[str]) -> dict[str, Any]:
    """Latest and trailing-252 mean weights for horizons 1 and 20 (JSON-ready)."""
    snapshot: dict[str, Any] = {}
    if not len(weights):
        return snapshot
    recent = weights[-252:]
    for horizon in (1, 20):
        column = recent[:, horizon - 1, :]
        finite = np.all(np.isfinite(column), 1)
        latest = weights[-1, horizon - 1, :]
        snapshot[str(horizon)] = {
            "latest": {name: float(value) if math.isfinite(float(value)) else None
                       for name, value in zip(names, latest)},
            "mean_last_252": ({name: float(value) for name, value in zip(names, column[finite].mean(0))}
                              if finite.any() else None),
        }
    return snapshot


def crps_learning_forecast(prices: PriceArrays, settings: EconometricSettings) -> EconometricForecast:
    """Decoupled BOA over the HAR Range, Score-Driven and Rough Volatility scales.

    Each expert keeps its frozen multiplier (0.94 / 0.96 or 0.94 / 0.94) and fits on
    ``min(expert default window, fit window)``; rows without an expert forecast are filled
    with sigma60 * sqrt(h). Location experts are {drift, zero} (zero only when the drift is
    off). The strategy multiplier (1.0 by default) scales the combined SIG. The experts
    forecast every loaded origin (``settings.first_origin`` is ignored) because the learner
    scores them from bar 60 of the loaded history; its weights therefore depend on where
    that history starts (frozen specification).
    """
    close = prices.close
    means, location = location_forecast(close, settings)

    def capped(default: int) -> EconometricSettings:
        return replace(settings, fit_window=min(int(default), int(settings.fit_window)))

    fallback = reference_scale_forecast(close)
    har, har_diag = har_range_scale(prices, capped(int(HAR_DEFAULTS["window"])),
                                    multiplier=float(HAR_DEFAULTS["k"]))
    driven, driven_diag = score_driven_scale(
        prices, capped(int((RANGE_DEFAULTS if settings.use_intraday_range else BETAT_DEFAULTS)["window"])))
    rough, rough_diag = rough_volatility_scale(prices, capped(int(ROUGH_DEFAULTS["window"])),
                                               multiplier=float(ROUGH_DEFAULTS["k"]))
    experts = {
        "har_range": (means, fill_invalid_scale(har, fallback)),
        "score_driven": (means, fill_invalid_scale(driven, fallback)),
        "rough_volatility": (means, fill_invalid_scale(rough, fallback)),
    }
    if settings.use_drift:
        location_experts = {"drift": means, "zero": np.zeros_like(means)}
        location_prior = COMBINER_DEFAULTS["loc_prior"]
    else:
        location_experts = {"zero": np.zeros_like(means)}
        location_prior = (1.0,)
    combined_means, combined_stds, weights = crps_learning_combine(
        close, experts, location_experts=location_experts, eta=settings.learning_rate, rho=settings.forgetting,
        loc_prior=location_prior, keep_weights=True)
    scale = {
        "model": "decoupled-bernstein-online-aggregation",
        "learning_rate": float(settings.learning_rate),
        "forgetting": float(settings.forgetting),
        "location_learning_rate": float(COMBINER_DEFAULTS["loc_eta"]),
        "location_forgetting": float(COMBINER_DEFAULTS["loc_rho"]),
        "location_fixed_share": float(COMBINER_DEFAULTS["loc_alpha"]),
        "horizon_smoothing": float(COMBINER_DEFAULTS["lam_loss"]),
        "learning_start": int(COMBINER_DEFAULTS["start"]),
        # Frozen specification: the weights accumulate from bar 60 of the loaded history, so
        # they depend slightly on where that history starts.
        "learning_state": "accumulated-from-first-loaded-bar",
        "experts": {"har_range": har_diag, "score_driven": driven_diag, "rough_volatility": rough_diag},
        "scale_weights": _weight_snapshot(weights["weights"], list(weights["names"])),
        "location_weights": _weight_snapshot(weights["loc_weights"], list(weights["loc_names"])),
    }
    return _compose(combined_means, settings.scale_multiplier * combined_stds, location, scale, settings,
                    "crps-learning", prices)
