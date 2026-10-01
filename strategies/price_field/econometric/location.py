"""Shared causal location model: the Bayesian Sharpe-ratio drift.

Code version: v1.0.0

Frozen round-2 specification (selected on the 16-ticker panel pre-window mean
CRPS skill, 2016-10-01..2023-09-30, never on the NVDA KPI window):

    r_t        = ln(C_t / C_{t-1})                             daily log return
    sigma_t    = std_ddof1(r) over the last <= 252 valid returns (>= 20 needed)
    z_t        = r_t / max(sigma_{t-1}, 1e-4)                  defined for t > burn
    S_t, n_t   = sum and count of the valid z over (t - W, t]
    c_t        = (N0 * SR0 / sqrt(252) + S_t) / (N0 + n_t)    posterior mean daily Sharpe
    mu_t       = c_t * sigma_t                                 daily mean log return (0 for t <= burn)
    MU[t, h-1] = h * mu_t,  h = 1..20

Defaults: SR0 = 0.6 (annual prior Sharpe), N0 = 2520 prior pseudo-sessions,
W = 1260, vol window 252 (minimum 20), burn 20, vol floor 1e-4. This is the
normal-normal update of a daily Sharpe ratio with prior N(SR0 / sqrt(252),
1 / N0) and unit-variance standardized returns; multiplying by sigma_t turns
the Sharpe ratio into a drift (a Merton-1980-style risk-return prior). Every
row is a rolling sum over past bars, so it is exact and prefix invariant.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from strategies.price_field.econometric.measures import log_returns, rolling_std, rolling_sum_count

HORIZONS = 20
HORIZON_STEPS = np.arange(1, HORIZONS + 1, dtype=float)
TRADING_DAYS = 252.0
DRIFT_DEFAULTS: dict[str, float | int] = {
    "prior_sharpe": 0.6,
    "prior_strength": 2520,
    "window": 1260,
    "vol_window": 252,
    "vol_min": 20,
    "burn": 20,
    "vol_floor": 1e-4,
}


def drift_components(
        close: np.ndarray, *,
        prior_sharpe: float = DRIFT_DEFAULTS["prior_sharpe"],
        prior_strength: float = DRIFT_DEFAULTS["prior_strength"],
        window: int = DRIFT_DEFAULTS["window"],
        vol_window: int = DRIFT_DEFAULTS["vol_window"],
        vol_min: int = DRIFT_DEFAULTS["vol_min"],
        burn: int = DRIFT_DEFAULTS["burn"],
        vol_floor: float = DRIFT_DEFAULTS["vol_floor"],
) -> dict[str, np.ndarray]:
    """Daily causal building blocks, each of length N.

    ``r`` returns, ``sigma`` rolling volatility, ``z`` standardized returns, ``n``
    counted observations, ``c`` posterior mean daily Sharpe, ``mu`` daily mean log
    return and ``post_var_c = 1 / (N0 + n)``.
    """
    returns = log_returns(close)
    sigma = rolling_std(returns, int(vol_window), min_count=int(vol_min))
    previous = np.concatenate([[np.nan], sigma[:-1]])[: len(sigma)]
    with np.errstate(invalid="ignore", divide="ignore"):
        standardized = returns / np.maximum(previous, vol_floor)
    standardized[: int(burn) + 1] = np.nan
    standardized[~np.isfinite(previous)] = np.nan
    total, count = rolling_sum_count(standardized, int(window))
    with np.errstate(invalid="ignore", divide="ignore"):
        sharpe = (prior_strength * prior_sharpe / math.sqrt(TRADING_DAYS) + total) / (prior_strength + count)
        mean = sharpe * sigma
        posterior_variance = 1.0 / (prior_strength + count)
    mean[: int(burn) + 1] = 0.0
    mean = np.where(np.isfinite(mean), mean, 0.0)
    return {"r": returns, "sigma": sigma, "z": standardized, "n": count, "c": sharpe, "mu": mean,
            "post_var_c": posterior_variance}


def drift_in_use(components: dict[str, np.ndarray], *, burn: int = DRIFT_DEFAULTS["burn"]) -> np.ndarray:
    """Origins whose mean comes from the drift: past the burn-in with a defined posterior drift.

    With a positive prior strength the prior alone defines the drift once the rolling
    volatility exists, so the drift is in use before any standardized return is observed.
    """
    rows = np.arange(len(components["mu"]))
    with np.errstate(invalid="ignore"):
        defined = np.isfinite(components["c"] * components["sigma"])
    return defined & (rows > int(burn))


def bayesian_sharpe_drift(close: np.ndarray, **overrides: Any) -> np.ndarray:
    """MU (N, 20): Gaussian mean of ``ln(C_{t+h} / C_t)`` from closes up to ``t`` only."""
    mean = drift_components(close, **overrides)["mu"]
    return mean[:, None] * HORIZON_STEPS[None, :]


def drift_summary(components: dict[str, np.ndarray], *, prior_strength: float) -> dict[str, float | int | None]:
    """JSON-ready snapshot of the latest origin (annualized Sharpe and drift, prior weight)."""
    if not len(components["mu"]):
        return {"latest_posterior_annual_sharpe": None, "latest_annual_drift": None,
                "latest_prior_weight": None, "latest_observations": 0}
    count = float(components["n"][-1])
    sharpe = float(components["c"][-1])
    total = float(prior_strength) + count
    return {
        "latest_posterior_annual_sharpe": sharpe * math.sqrt(TRADING_DAYS) if math.isfinite(sharpe) else None,
        "latest_annual_drift": float(components["mu"][-1]) * TRADING_DAYS,
        "latest_prior_weight": float(prior_strength) / total if total > 0 else None,
        "latest_observations": int(count),
    }
