"""CRPS Learning: Bernstein Online Aggregation of Gaussian experts with delayed feedback.

Code version: v1.0.0

Method (Berrisch & Ziel 2023 "CRPS learning"; Wintenberger 2017 BOA):

* Experts are Gaussian marginals N(m_j[t, h], s_j[t, h]) of ln(C[t+h] / C[t]).
* Combination by quantile averaging (Vincentization): MU = sum_j w_j m_j and
  SIG = sum_j w_j s_j with weights on the simplex.
* Weights are learned per horizon by BOA on the linearized CRPS (the exact
  gradient of the Vincentized mixture):
      z   = (y - MU) / SIG
      g_j = [-(2 Phi(z) - 1) m_j + (2 phi(z) - 1/sqrt(pi)) s_j] / R,   R = sigma60[s] * sqrt(h)
      l_j = g_j - sum_k w_k g_k
      L_j <- rho L_j + l_j + eta l_j^2,   w_j ∝ prior_j exp(-eta L_j)
  followed by an optional fixed share toward the prior.
* Delayed feedback: the forecast issued at origin s for horizon h is scored at
  t = s + h with the weights that were in force at s, so row t uses bars <= t.
* Sleeping experts: a non-finite forecast is excluded (weights renormalized)
  and receives zero regret.
* Decoupled mode (the frozen strategy): the location and the scale get
  separate learners, MU = sum_k v_k MU_k over location experts and
  SIG = sum_j w_j SIG_j over scale experts, fed by the two parts
  -(2 Phi(z) - 1) MU_k / R and (2 phi(z) - 1/sqrt(pi)) SIG_j / R.

Frozen combiner defaults: scale learner eta 0.5, rho 0.999, no fixed share,
regret increments smoothed across horizons (first-difference Whittaker,
lambda 10); location learner pooled across horizons, eta 2, rho 0.9995,
fixed share 0.1 toward the prior (0.95 drift, 0.05 zero); learning starts at
bar 60; R is the scorer's sigma60 reference scale.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

import numpy as np

from strategies.price_field.econometric.measures import forward_log_returns, log_returns, rolling_std

HORIZONS = 20
HORIZON_STEPS = np.arange(1, HORIZONS + 1)
SQRT_HORIZONS = np.sqrt(HORIZON_STEPS)
INV_SQRT_PI = 1.0 / math.sqrt(math.pi)
INV_SQRT_2PI = 1.0 / math.sqrt(2.0 * math.pi)
COMBINER_DEFAULTS: dict[str, Any] = {
    # scale learner (per-horizon weights over the scale experts)
    "eta": 0.5, "rho": 0.999, "alpha": 0.0, "lam_loss": 10.0, "lam_weight": 0.0,
    # location learner (weights over {drift, zero}, pooled across horizons)
    "loc_eta": 2.0, "loc_rho": 0.9995, "loc_alpha": 0.1, "loc_lam_loss": math.inf, "loc_prior": (0.95, 0.05),
    "start": 60, "norm": "ref",
}


def _erfc(x: np.ndarray) -> np.ndarray:
    """Numerical Recipes erfcc (Chebyshev fit), fractional error < 1.2e-7 everywhere."""
    x = np.asarray(x, float)
    z = np.abs(x)
    t = 1.0 / (1.0 + 0.5 * z)
    a = t * np.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (
        -0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
    return np.where(x >= 0, a, 2.0 - a)


def _normal_cdf(z: np.ndarray) -> np.ndarray:
    return 0.5 * _erfc(-z / math.sqrt(2.0))


def reference_sigma(close: np.ndarray) -> np.ndarray:
    """Scorer reference daily scale: std of the last 60 log returns (ddof=1), floor 0.005; NaN before bar 60."""
    return np.maximum(0.005, rolling_std(log_returns(close), 60, min_count=60))


def reference_scale_forecast(close: np.ndarray) -> np.ndarray:
    """sigma60 * sqrt(h), the fallback that fills rows where a scale expert is not yet available."""
    daily = reference_sigma(close)
    return np.sqrt(daily[:, None] ** 2 * HORIZON_STEPS[None, :])


def fill_invalid_scale(scale: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    """Replace non-finite or non-positive expert scales by the fallback expert."""
    filled = np.array(scale, dtype=float, copy=True)
    invalid = ~(np.isfinite(filled) & (filled > 0))
    filled[invalid] = fallback[invalid]
    return filled


def _smoother(lam: float | None) -> np.ndarray | None:
    """Whittaker hat matrix across the 20 horizons (0 -> per horizon, inf -> pooled)."""
    if lam is None or lam <= 0:
        return None
    if math.isinf(lam):
        return np.full((HORIZONS, HORIZONS), 1.0 / HORIZONS)
    D = np.diff(np.eye(HORIZONS), axis=0)
    return np.linalg.inv(np.eye(HORIZONS) + lam * D.T @ D)


class BernsteinOnlineAggregation:
    """Per-horizon BOA state (fixed eta, forgetting, fixed share, horizon smoothing)."""

    def __init__(self, J: int, eta: float, rho: float, alpha: float, lam_loss: float | None,
                 lam_weight: float | None, prior: object | None) -> None:
        self.eta, self.rho, self.alpha = float(eta), float(rho), float(alpha)
        self.prior = np.full(J, 1.0 / J) if prior is None else np.asarray(prior, float) / np.sum(prior)
        self.logprior = np.log(self.prior)
        self.PL, self.PW = _smoother(lam_loss), _smoother(lam_weight)
        self.L = np.zeros((HORIZONS, J))
        self.w = self._weights()

    def _weights(self) -> np.ndarray:
        lw = -self.eta * self.L + self.logprior
        w = np.exp(lw - lw.max(1, keepdims=True))
        w /= w.sum(1, keepdims=True)
        if self.alpha > 0:
            w = (1.0 - self.alpha) * w + self.alpha * self.prior
        if self.PW is not None:
            w = np.maximum(self.PW @ w, 0.0)
            w /= w.sum(1, keepdims=True)
        return w

    def update(self, lt: np.ndarray, ok: np.ndarray) -> None:
        """lt (H, J) linearized regrets (0 for sleeping experts / unused rows); ok (H,) matured rows."""
        if self.PL is not None:
            lt = self.PL @ lt
        self.L[ok] = self.rho * self.L[ok] + lt[ok] + self.eta * lt[ok] ** 2
        self.w = self._weights()


def _renorm(w: np.ndarray, awake: np.ndarray) -> np.ndarray:
    wt = w * awake
    total = wt.sum(1, keepdims=True)
    return np.where(total > 0, wt / np.where(total > 0, total, 1.0), np.nan)


def crps_learning_combine(
        close: np.ndarray, experts: Mapping[str, tuple[np.ndarray, np.ndarray]],
        location_experts: Mapping[str, np.ndarray] | None = None, *, eta: float | None = None,
        rho: float | None = None, alpha: float | None = None, lam_loss: float | None = None,
        lam_weight: float | None = None, prior: object | None = None, loc_eta: float | None = None,
        loc_rho: float | None = None, loc_alpha: float | None = None, loc_lam_loss: float | None = None,
        loc_prior: object | None = None, start: int | None = None, norm: str | None = None,
        keep_weights: bool = True,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Causal CRPS-learning (BOA) combination of Gaussian experts with delayed feedback.

    Coupled mode (``location_experts=None``): expert j is N(MU_j, SIG_j) and one weight vector
    per horizon combines both. Decoupled mode: the mean is sum_k v_k MU_k over the location
    experts and the std is sum_j w_j SIG_j over the scale experts (their MU is ignored).
    ``close`` provides the realized targets and the sigma60 normalizer. Returns
    (MU, SIG, diagnostics); with ``keep_weights`` the diagnostics hold the forecast weights
    used at every origin ('weights' (N, 20, J) and 'loc_weights').
    """
    settings = dict(COMBINER_DEFAULTS)
    for key, value in {"eta": eta, "rho": rho, "alpha": alpha, "lam_loss": lam_loss, "lam_weight": lam_weight,
                       "loc_eta": loc_eta, "loc_rho": loc_rho, "loc_alpha": loc_alpha,
                       "loc_lam_loss": loc_lam_loss, "start": start, "norm": norm}.items():
        if value is not None:
            settings[key] = value
    if loc_prior is None:
        loc_prior = settings.get("loc_prior")
    names = list(experts)
    J = len(names)
    EM = np.stack([np.asarray(experts[name][0], float) for name in names], 2)
    ES = np.stack([np.asarray(experts[name][1], float) for name in names], 2)
    N = ES.shape[0]
    coupled = location_experts is None
    if coupled:
        awake = np.isfinite(EM) & np.isfinite(ES) & (ES > 0)
        LM, lawake, lnames = EM, awake, names
    else:
        awake = np.isfinite(ES) & (ES > 0)
        lnames = list(location_experts)
        LM = np.stack([np.asarray(location_experts[name], float) for name in lnames], 2)
        lawake = np.isfinite(LM)
    LMf = np.where(lawake, LM, 0.0)
    ESf = np.where(awake, ES, 0.0)
    close = np.asarray(close, dtype=float)
    Y = forward_log_returns(close, HORIZONS)
    R = reference_sigma(close)[:, None] * SQRT_HORIZONS[None, :] if settings["norm"] == "ref" else np.ones((N, HORIZONS))
    scale_learner = BernsteinOnlineAggregation(J, settings["eta"], settings["rho"], settings["alpha"],
                                               settings["lam_loss"], settings["lam_weight"], prior)
    location_learner = None if coupled else BernsteinOnlineAggregation(
        len(lnames), settings["loc_eta"], settings["loc_rho"], settings["loc_alpha"], settings["loc_lam_loss"],
        0.0, loc_prior)
    WS = np.full((N, HORIZONS, J), np.nan)
    WL = WS if coupled else np.full((N, HORIZONS, len(lnames)), np.nan)
    hidx = HORIZON_STEPS - 1
    first = max(int(settings["start"]), 0)
    for t in range(N):
        s = t - HORIZON_STEPS
        use = s >= first
        if use.any():
            ss = np.where(use, s, 0)
            y = Y[ss, hidx]
            ws, wl = WS[ss, hidx], WL[ss, hidx]                   # weights in force at s
            m, sd = LMf[ss, hidx], ESf[ss, hidx]
            mc, sc = np.sum(wl * m, 1), np.sum(ws * sd, 1)
            rr = R[ss, hidx] if settings["norm"] == "ref" else (sc if settings["norm"] == "comb" else np.ones(HORIZONS))
            ok = use & np.isfinite(y) & np.isfinite(rr) & (rr > 0) & np.isfinite(mc) & np.isfinite(sc) & (sc > 0)
            if ok.any():
                z = np.where(ok, (y - np.where(ok, mc, 0.0)) / np.where(ok, sc, 1.0), 0.0)
                rr = np.where(ok, rr, 1.0)
                a = -(2.0 * _normal_cdf(z) - 1.0) / rr
                b = (2.0 * np.exp(-0.5 * z * z) * INV_SQRT_2PI - INV_SQRT_PI) / rr
                okc = ok[:, None]
                if coupled:
                    g = a[:, None] * m + b[:, None] * sd
                    wz = np.where(okc, ws, 0.0)
                    lt = np.where(awake[ss, hidx] & okc, g - np.sum(wz * g, 1, keepdims=True), 0.0)
                    scale_learner.update(lt, ok)
                else:
                    gs = b[:, None] * sd
                    wz = np.where(okc, ws, 0.0)
                    scale_learner.update(
                        np.where(awake[ss, hidx] & okc, gs - np.sum(wz * gs, 1, keepdims=True), 0.0), ok)
                    gl = a[:, None] * m
                    wz = np.where(okc, wl, 0.0)
                    location_learner.update(
                        np.where(lawake[ss, hidx] & okc, gl - np.sum(wz * gl, 1, keepdims=True), 0.0), ok)
        WS[t] = _renorm(scale_learner.w, awake[t])
        if not coupled:
            WL[t] = _renorm(location_learner.w, lawake[t])
    MU = np.sum(np.nan_to_num(WL) * LMf, 2)
    SIG = np.sum(np.nan_to_num(WS) * ESf, 2)
    MU[~np.any(lawake, 2)] = np.nan
    SIG[~np.any(awake, 2)] = np.nan
    diagnostics: dict[str, Any] = {"names": names, "loc_names": lnames}
    if keep_weights:
        diagnostics["weights"] = WS
        diagnostics["loc_weights"] = WL
    return MU, SIG, diagnostics
