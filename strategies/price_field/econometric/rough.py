"""Rough Volatility scale model: noise-aware Matern (Gamma-kernel BSS) kriging of log variance.

Code version: v1.0.0

Frozen round-2 specification (``rough_sigma`` defaults):

1. Daily log-variance proxy ``L_t = ln max(X_t, 0.05 * median(X_{t-251..t}))`` with the
   Yang-Zhang single-day ``X_t`` (``measures.open_anchored_variance``); invalid bars take
   the causal median.
2. ``L_t = mu + Lambda_t + eps_t``: proxy noise ``eps`` with variance e2 (Alizadeh,
   Brandt & Diebold 2002) around a stationary latent log variance with variance s2 and
   the Gamma-kernel BSS / Matern correlation
   ``rho(k) = 2^{1-H} / Gamma(H) * (lam k)^H * K_H(lam k)`` (Bennedsen, Lunde & Pakkanen
   2022): rough at short lags (Gatheral, Jaisson & Rosenbaum 2018) and mean-reverting at
   rate lam.
3. At every refit origin (the index grid ``0, refit, 2 refit, ...`` by default, or the
   date-anchored business-day blocks passed as ``refit_origins``) fit the variogram
   ``m2(k) = a + b (1 - rho(k))`` (a = 2 e2, b = 2 s2) on the trailing ``window`` bars over
   30 log-spaced lags in [1, 250]: (H, lam) on a grid, (a >= 0, b > 0) in closed form; the
   empirical variogram is blended with the panel prior through 100 pseudo-pairs per lag.
4. Simple kriging of the latent log variance from the last K = 250 observations:
   ``E[L_{t+D}] = mu_t + w_D'(L - mu_t)``, ``w_D = (R + (e2 / s2) I)^{-1} r_D`` and
   ``v_D = s2 (1 - r_D' w_D)``, with mu_t the expanding mean of L.
5. ``V_h = sum_{D <= h} exp(E[L_{t+D}] + v_D / 2)``.
6. Proxy-to-close ratio on matured pairs s in [t - h - cal_window + 1, t - h] with 750
   prior pseudo-pairs: ``rho_h = (sum Y^2 + 750 rho0_h V_h(t)) / (sum V_h(s) + 750 V_h(t))``.
7. ``SIG = k * sqrt(rho_h * V_h)``, k = 0.94.

The ``yz`` and ``park`` priors were estimated by the research from panel data up to
2016-09-30 only. The close-only ``r2`` proxy (``X_t = r_t^2``, used when intraday range
measures are disabled) is an extension: its priors were estimated with the same procedure
(research script ``priors2.py``: 16-ticker panel, last 2000 bars before 2016-10-01, median
variogram fitted with this module's grid; median matured proxy-to-close ratio with no
pseudo-pairs), so they are out of sample for the selection and KPI windows too.
Defaults: proxy "yz", window 2000, lag_max 250, n_lags 30, K 250, refit 20, expanding
mean, cal_window 2000, prior_pairs 100, cal_prior_pairs 750, k 0.94. Output is finite and
positive from bar 0; full quality needs about 2000 bars of history.

Rows never read a later bar (no look-ahead). The frozen expanding mean ``mu_t`` of step 4
averages L from the first loaded bar, so a forecast depends slightly on how much history
precedes it even with a date-anchored refit schedule (about 0.4% of SIG at most when 20
leading NVDA bars are dropped from 2,841); ``mu_window`` would remove that but is not the
selected specification.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from strategies.price_field.econometric.measures import (
    expanding_mean,
    log_returns,
    median_filled_log_variance,
    open_anchored_variance,
    refit_schedule,
    rolling_mean,
)

HORIZONS = 20
GRID_H = (0.03, 0.05, 0.065, 0.08, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4)
GRID_LAM = (0.0002, 0.0005, 0.001, 0.002, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.1)
# Priors per proxy: Matern-BSS fit (a, b, H, lam) of the 16-ticker median variogram of L over the
# last 2000 bars before 2016-10-01, and the panel median proxy -> close-to-close ratio rho_h.
PRIORS: dict[str, dict[str, Any]] = {
    "yz": {"a": 0.184, "b": 2.224, "H": 0.065, "lam": 0.0005,
           "rho": np.array([1.210, 1.153, 1.113, 1.089, 1.046, 1.003, 0.977, 0.955, 0.933, 0.908,
                            0.899, 0.890, 0.886, 0.885, 0.878, 0.863, 0.855, 0.853, 0.851, 0.847])},
    "park": {"a": 0.264, "b": 2.033, "H": 0.065, "lam": 0.001,
             "rho": np.array([1.255, 1.182, 1.142, 1.116, 1.072, 1.026, 1.000, 0.973, 0.944, 0.922,
                              0.917, 0.908, 0.898, 0.894, 0.887, 0.881, 0.874, 0.872, 0.868, 0.864])},
    "r2": {"a": 5.513, "b": 1.136, "H": 0.2, "lam": 0.005,
           "rho": np.array([2.799, 2.729, 2.646, 2.606, 2.597, 2.549, 2.476, 2.394, 2.32, 2.254,
                            2.229, 2.205, 2.194, 2.192, 2.189, 2.19, 2.19, 2.203, 2.206, 2.204])},
}
DEFAULT_LOG_VARIANCE = math.log(0.02 ** 2)     # used only before any valid bar
ROUGH_DEFAULTS: dict[str, Any] = {
    "k": 0.94, "proxy": "yz", "window": 2000, "lag_max": 250, "n_lags": 30, "K": 250, "refit": 20,
    "mu_window": None, "cal_window": 2000, "prior_pairs": 100.0, "cal_prior_pairs": 750.0,
}

_RHO_CACHE: dict[tuple[float, float], np.ndarray] = {}


def _besselk(nu: float, x: np.ndarray) -> np.ndarray:
    """K_nu(x), x > 0: trapezoid rule on int_0^inf exp(-x cosh t) cosh(nu t) dt (801 nodes, ~1e-15)."""
    x = np.atleast_1d(np.asarray(x, float))
    upper = max(math.log(120.0 / float(np.min(x))) + 2.0, 5.0)
    t = np.linspace(0.0, upper, 801)
    f = np.exp(-np.outer(x, np.cosh(t))) * np.cosh(nu * t)[None, :]
    return (f.sum(1) - 0.5 * (f[:, 0] + f[:, -1])) * (t[1] - t[0])


def matern_rho(k: np.ndarray, H: float, lam: float) -> np.ndarray:
    """Autocorrelation of the Gamma-kernel BSS process (Matern, smoothness H, rate lam); rho(0) = 1."""
    k = np.asarray(k, float)
    out = np.ones_like(k)
    positive = k > 0
    if np.any(positive):
        x = lam * k[positive]
        out[positive] = 2.0 ** (1.0 - H) / math.gamma(H) * x ** H * _besselk(H, x)
    return out


def _rho_table(H: float, lam: float, n: int) -> np.ndarray:
    key = (H, lam)
    table = _RHO_CACHE.get(key)
    if table is None or len(table) < n:
        table = matern_rho(np.arange(max(n, 300)), H, lam)
        _RHO_CACHE[key] = table
    return table[:n]


def log_variance_proxy(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, proxy: str = "yz", *,
        floor: float = 0.05, med_window: int = 252,
) -> np.ndarray:
    """L_t = ln max(X_t, floor * rolling median X); invalid bars are replaced by the causal median."""
    if proxy in ("yz", "park"):
        raw = open_anchored_variance(open_, high, low, close, kind=proxy)
    elif proxy == "r2":
        returns = log_returns(close)
        raw = returns * returns
    else:
        raise ValueError(f"Unknown rough-volatility proxy: {proxy}.")
    return median_filled_log_variance(raw, floor_frac=floor, window=med_window,
                                      default_log_variance=DEFAULT_LOG_VARIANCE)


def _variogram(L: np.ndarray, tf: np.ndarray, lags: np.ndarray, window: int):
    """Sum of squared lag-k increments and pair counts inside the trailing window ending at each tf."""
    N = len(L)
    ss = np.empty((len(tf), len(lags)))
    cnt = np.empty((len(tf), len(lags)))
    lo = np.maximum(tf - window + 1, 0)
    for j, k in enumerate(lags):
        d = np.zeros(N)
        if k < N:
            d[k:] = (L[k:] - L[:-k]) ** 2
        cs = np.concatenate([[0.0], np.cumsum(d)])
        a = np.minimum(lo + k, tf + 1)
        ss[:, j] = cs[tf + 1] - cs[a]
        cnt[:, j] = tf + 1 - a
    return ss, cnt


def fit_matern_variogram(m2: np.ndarray, lags: np.ndarray):
    """m2 ~ a + b (1 - rho_{H,lam}(k)); grid over (H, lam), closed-form LS for (a >= 0, b > 0)."""
    n = m2.shape[0]
    best = np.full(n, np.inf)
    A, B, Hs, Ls = np.zeros(n), np.zeros(n), np.zeros(n), np.zeros(n)
    kmax = int(lags.max()) + 1
    for H in GRID_H:
        for lam in GRID_LAM:
            f = 1.0 - _rho_table(H, lam, kmax)[lags]
            fm, mm = f.mean(), m2.mean(1)
            b = ((m2 - mm[:, None]) @ (f - fm)) / np.sum((f - fm) ** 2)
            a = mm - b * fm
            b0 = (m2 @ f) / np.sum(f * f)                 # a clipped at 0
            negative = a < 0
            a = np.where(negative, 0.0, a)
            b = np.maximum(np.where(negative, b0, b), 1e-6)
            err = np.sum((m2 - a[:, None] - b[:, None] * f[None, :]) ** 2, 1)
            better = err < best
            best[better], A[better], B[better], Hs[better], Ls[better] = err[better], a[better], b[better], H, lam
    return A, B, Hs, Ls


def kriging_weights(H: float, lam: float, s2: float, e2: float, K: int, D: int = HORIZONS):
    """Simple-kriging weights W (D x K) of L_{t-j}, j = 0..K-1, for Lambda_{t+D}, and the latent
    conditional variances v (D,)."""
    rr = _rho_table(H, lam, K + D + 1)
    j = np.arange(K)
    R = rr[np.abs(j[:, None] - j[None, :])] + (e2 / s2 + 1e-9) * np.eye(K)
    rT = rr[np.arange(1, D + 1)[:, None] + j[None, :]]          # D x K
    w = np.linalg.solve(R, rT.T)                                 # K x D
    v = s2 * (1.0 - np.sum(rT.T * w, 0))
    return w.T, np.maximum(v, 0.0)


def rough_sigma(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *,
        k: float = 0.94, proxy: str = "yz", window: int = 2000, lag_max: int = 250, n_lags: int = 30,
        K: int = 250, refit: int = 20, mu_window: int | None = None, cal_window: int = 2000,
        prior_pairs: float = 100.0, cal_prior_pairs: float = 750.0, refit_origins: np.ndarray | None = None,
        return_parts: bool = False,
) -> np.ndarray | tuple[np.ndarray, dict[str, Any]]:
    """Rough-volatility forecast SIG (N, 20) of the 1..20-day log-return std from bars <= origin.

    ``refit_origins`` (see ``measures.session_refit_origins``) replaces the index grid; each
    variogram fit serves the rows up to the next refit origin. ``return_parts`` also returns V,
    the calibration ratio, L, mu and the fitted parameters.
    """
    close = np.asarray(close, dtype=float)
    N = len(close)
    L = log_variance_proxy(open_, high, low, close, proxy)
    lags = np.unique(np.round(np.geomspace(1, lag_max, n_lags)).astype(int))
    tf = refit_schedule(N, refit, refit_origins)
    block_ends = np.append(tf[1:], N)

    # 3. variogram fit with prior pseudo-pairs
    ss, cnt = _variogram(L, tf, lags, window)
    prior_spec = PRIORS[proxy]
    prior = prior_spec["a"] + prior_spec["b"] * (1.0 - matern_rho(lags, prior_spec["H"], prior_spec["lam"]))
    den = cnt + prior_pairs
    m2 = np.where(den > 0, (ss + prior_pairs * prior[None, :]) / np.where(den > 0, den, 1.0), prior[None, :])
    A, B, Hs, Lams = fit_matern_variogram(m2, lags)

    # 4./5. kriging forecast of log variance, integrated with the lognormal correction
    mu = expanding_mean(L) if mu_window is None else rolling_mean(L, int(mu_window), min_periods=1)
    V = np.empty((N, HORIZONS))
    for i, t0 in enumerate(tf):
        s2, e2 = B[i] / 2.0, max(A[i] / 2.0, 1e-6 * B[i])
        W, v = kriging_weights(float(Hs[i]), float(Lams[i]), s2, e2, K)
        block = np.arange(t0, block_ends[i])
        lag = block[:, None] - np.arange(K)[None, :]
        X = np.where(lag >= 0, L[np.maximum(lag, 0)], mu[block, None]) - mu[block, None]
        EL = mu[block, None] + X @ W.T
        V[block] = np.cumsum(np.exp(EL + 0.5 * v[None, :]), 1)

    # 6. per-horizon ratio on matured pairs (s + h <= t), with prior pseudo-pairs
    with np.errstate(divide="ignore", invalid="ignore"):
        log_close = np.log(close)
    t = np.arange(N)
    ratio = np.empty((N, HORIZONS))
    for horizon in range(1, HORIZONS + 1):
        y2 = np.full(N, np.nan)
        if N > horizon:
            y2[:-horizon] = (log_close[horizon:] - log_close[:-horizon]) ** 2
        vv = V[:, horizon - 1]
        ok = np.isfinite(y2) & np.isfinite(vv)
        cy = np.concatenate([[0.0], np.cumsum(np.where(ok, y2, 0.0))])
        cv = np.concatenate([[0.0], np.cumsum(np.where(ok, vv, 0.0))])
        hi1 = np.clip(t - horizon + 1, 0, N)
        lo = np.clip(t - horizon - cal_window + 1, 0, N)
        num = cy[hi1] - cy[lo] + cal_prior_pairs * prior_spec["rho"][horizon - 1] * vv
        den = cv[hi1] - cv[lo] + cal_prior_pairs * vv
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio[:, horizon - 1] = num / den
    SIG = k * np.sqrt(ratio * V)
    if return_parts:
        return SIG, {"V": V, "ratio": ratio, "L": L, "mu": mu, "refit_index": tf,
                     "a": A, "b": B, "H": Hs, "lam": Lams}
    return SIG


def rough_fit_summary(parts: dict[str, Any]) -> dict[str, Any]:
    """JSON-ready latest variogram fit and calibration ratios for horizons 1 and 20."""
    refits = parts["refit_index"]
    if not len(refits):
        return {"latest_refit_origin": None}
    b = float(parts["b"][-1])
    a = float(parts["a"][-1])
    ratio = parts["ratio"]
    return {
        "latest_refit_origin": int(refits[-1]),
        "hurst": float(parts["H"][-1]),
        "mean_reversion_rate": float(parts["lam"][-1]),
        "latent_variance": b / 2.0,
        "noise_variance": max(a / 2.0, 1e-6 * b),
        "calibration_ratio": {str(h): float(ratio[-1, h - 1]) if len(ratio) else None for h in (1, 20)},
    }
