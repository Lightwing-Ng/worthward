"""Score-Driven scale model: range-augmented Beta-t-EGARCH with a close-only fallback.

Code version: v1.0.0

A first-order score-driven (GAS / DCS) log-scale filter for Student-t daily
returns (Harvey & Chakravarty 2008; Harvey 2013; Creal, Koopman & Lucas 2013)
with Harvey's leverage term and an exogenous log-range driver in the spirit of
Realized EGARCH (Hansen & Huang 2016):

    r_t = exp(lambda_t) * eps_t,  eps_t ~ standard Student-t(nu)
    b_t = (r_t^2 / (nu e^{2 lambda_t})) / (1 + r_t^2 / (nu e^{2 lambda_t}))   ~ Beta(1/2, nu/2)
    u_t = (nu + 1) b_t - 1,   s_t = sign(-r_t)
    w_t = 0.5 ln x_t - c_W    (x_t Parkinson + gap proxy; c_W re-centers it on the window rms)
    lambda_{t+1} = omega + phi (lambda_t - omega) + kappa u_t + kappa* s_t (u_t + 1) + delta (w_t - lambda_t)

Estimation: penalized Student-t maximum likelihood on the trailing ``window``
returns ending at each refit bar (bar ``min_bars - 1``, then every ``refit`` bars, or
every later date-anchored refit origin passed as ``refit_origins``),
solved for all refits at once by Levenberg-Marquardt with analytic score
recursions, BHHH curvature and box projection. The Gaussian prior on
(phi, kappa, kappa*, 1/nu, delta) is centered on panel medians of unpenalized
fits made before 2016-10-01; its standard deviations are ``prior_scale`` times
their pooled spread across tickers and refit dates (population standard deviation;
omega has no prior). ``scripts/econometric_price_field_research.py priors`` re-estimates
the centers and spreads from local history and checks them.

h-step scale in closed form: E_t exp(2 lambda_{t+k}) = exp(2 mu + 2 phi^{k-1}
(lambda_{t+1} - mu)) * prod_{i<k-1} M(2 phi^i), with the in-window empirical
moment-generating function M of the fitted innovations (the exact Beta /
Kummer 1F1 moments in the close-only fallback);
V_h = sum_k E_t exp(2 lambda_{t+k}) * nu / (nu - 2) and SIG = k_mult * sqrt(V_h).

Defaults: range model window 1000, prior_scale 0.1, k_mult 0.96; close-only
Beta-t-EGARCH (``use_range=False``) window 1000, prior_scale 0.5, k_mult 0.94.
Every origin uses bars <= origin only; forecasts start at bar ``min_bars - 1``. A fit
reads only its trailing window, so with date-anchored refit origins a forecast whose
window lies inside the loaded history does not depend on where that history starts.
The variance proxy floor uses the median of the positive proxies (backed up by the
median of the positive squared returns), so zero-range, zero-return bars on a
tick-bound series cannot collapse it.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from strategies.price_field.econometric.measures import (
    log_returns,
    parkinson_gap_variance,
    positive_rolling_median,
)

HORIZONS = 20
HORIZON_STEPS = np.arange(1, HORIZONS + 1)
PARAMETER_NAMES = ("omega", "phi", "kappa", "kappa_star", "inverse_nu", "delta")

# parameter order: omega, phi, kappa, kappa_star, eta (= 1 / nu), delta
LOWER = np.array([-9.0, 0.50, 0.0, -0.20, 0.01, 0.0])
UPPER = np.array([0.0, 0.9990, 0.30, 0.20, 0.34, 0.60])

# Prior centers / pooled sd (across tickers and refit dates) of unpenalized fits on data before 2016-10-01.
RANGE_PRIOR_CENTER = np.array([-4.0, 0.9557884954, 0.0003041885, 0.0321972348, 0.1468865433, 0.1054895984])
RANGE_PRIOR_SD = np.array([np.inf, 0.0481771553, 0.0167054818, 0.0212191338, 0.0531705924, 0.0911336171])
BETAT_PRIOR_CENTER = np.array([-4.0, 0.9802460216, 0.0349485765, 0.0278442259, 0.1620423303, 0.0])
BETAT_PRIOR_SD = np.array([np.inf, 0.0348636316, 0.0136984527, 0.0187507787, 0.0513607233, np.inf])

RANGE_DEFAULTS: dict[str, float | int] = {"k_mult": 0.96, "window": 1000, "prior_scale": 0.1}
BETAT_DEFAULTS: dict[str, float | int] = {"k_mult": 0.94, "window": 1000, "prior_scale": 0.5}
MIN_BARS = 60
MAX_FITS_PER_BATCH = 256


def _digamma(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, float)
    acc = np.zeros_like(x)
    y = x.copy()
    for _ in range(6):
        acc -= 1.0 / y
        y = y + 1.0
    iy2 = 1.0 / (y * y)
    return acc + np.log(y) - 0.5 / y - iy2 * (1 / 12 - iy2 * (1 / 120 - iy2 / 252))


def _lgamma(x: np.ndarray) -> np.ndarray:
    return np.array([math.lgamma(value) for value in np.ravel(x)]).reshape(np.shape(x))


def hyp1f1_half(b: np.ndarray, z: np.ndarray, nterms: int = 400) -> np.ndarray:
    """Kummer 1F1(1/2; b; z) by its power series (Kummer transformation for z < 0)."""
    z = np.asarray(z, float)
    b = np.broadcast_to(np.asarray(b, float), z.shape)
    negative = z < 0
    a = np.where(negative, b - 0.5, 0.5)
    zz = np.abs(z)
    term = np.ones_like(zz)
    total = np.ones_like(zz)
    for n in range(nterms):
        term = term * (a + n) / (b + n) * zz / (n + 1)
        total = total + term
        if n > 20 and np.all(term <= 1e-17 * total):
            break
    return np.where(negative, np.exp(z) * total, total)


def score_driven_range_variance(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *, floor_frac: float = 0.05,
) -> np.ndarray:
    """Parkinson + gap proxy (inverted ranges rejected), floored at ``floor_frac`` times the causal
    rolling-252 median of the positive proxies; the median of the positive squared returns backs the
    floor up when no proxy in the window is positive, and 1e-12 when neither is. Zero proxies never
    set the floor, so zero-range, zero-return bars on a tick-bound series cannot collapse it."""
    proxy, _, _, returns = parkinson_gap_variance(open_, high, low, close, reject_inverted_range=True)
    median = positive_rolling_median(proxy)
    median_returns = positive_rolling_median(returns * returns)
    floor = np.where(np.isfinite(median) & (median > 0), floor_frac * median, floor_frac * median_returns)
    floor = np.where(np.isfinite(floor) & (floor > 0), floor, 1e-12)
    return np.where(np.isfinite(proxy), np.maximum(proxy, floor), np.nan)


def _stack(r, wx, tfs, W, extra=0):
    N = len(r)
    idx = tfs[:, None] - W + 1 + np.arange(W + extra)[None, :]
    inside = (idx >= 1) & (idx <= N - 1)
    ci = np.clip(idx, 0, N - 1)
    ok = inside & np.isfinite(r[ci])
    R = np.where(ok, np.nan_to_num(r[ci]), 0.0)
    WX = np.where(ok, np.nan_to_num(wx[ci]), 0.0)
    act = ok.astype(float)
    lik = (ok & (idx <= tfs[:, None])).astype(float)
    return R, WX, act, lik


def _filter(theta, R, WX, ACT, LIK, want_grad=True):
    """Run the recursion for F fits at once. Returns nll (F,), grad (F,6), BHHH (F,6,6), lam (F,T),
    lam_next (F,T) (lambda_{t+1} after step t) and innovations g (F,T)."""
    F, T = R.shape
    om, ph, ka, ks, et, de = (theta[:, j].copy() for j in range(6))
    nu = 1.0 / et
    nu1 = nu + 1.0
    R2 = R * R
    SG = -np.sign(R)
    lam = om.copy()
    LAM = np.empty((F, T))
    LAMN = np.empty((F, T))
    GI = np.empty((F, T))
    if want_grad:
        J = [np.ones(F)] + [np.zeros(F) for _ in range(5)]
        JS = np.empty((F, T, 6))
    for t in range(T):
        act = ACT[:, t]
        LAM[:, t] = lam
        x = R2[:, t] * np.exp(-2.0 * lam) * et
        b = x / (1.0 + x)
        u = nu1 * b - 1.0
        s = SG[:, t]
        aa = (ka + ks * s) * act
        da = de * act
        wl = WX[:, t] - lam
        g = aa * u + ks * s * act + da * wl
        if want_grad:
            for j in range(6):
                JS[:, t, j] = J[j]
            b1b = b * (1.0 - b)
            c = ph + aa * (-2.0 * nu1 * b1b) - da
            J = [(1.0 - ph) + c * J[0],
                 (lam - om) + c * J[1],
                 act * u + c * J[2],
                 act * s * (u + 1.0) + c * J[3],
                 aa * (-nu * nu * b + nu * nu1 * b1b) + c * J[4],
                 act * wl + c * J[5]]
        lam = om + ph * (lam - om) + g
        LAMN[:, t] = lam
        GI[:, t] = g
    x = R2 * np.exp(-2.0 * LAM) * et[:, None]
    l1x = np.log1p(x)
    C = _lgamma(nu1 / 2) - _lgamma(nu / 2) - 0.5 * np.log(np.pi * nu)
    nll = -((C[:, None] - LAM - 0.5 * nu1[:, None] * l1x) * LIK).sum(1)
    if not want_grad:
        return nll, None, None, LAM, LAMN, GI
    b = x / (1 + x)
    u = nu1[:, None] * b - 1
    Cp = 0.5 * _digamma(nu1 / 2) - 0.5 * _digamma(nu / 2) - 0.5 / nu
    dl_dnu = Cp[:, None] - 0.5 * l1x + nu1[:, None] * b / (2 * nu[:, None])
    sc = u[:, :, None] * JS
    sc[:, :, 4] += -nu[:, None] ** 2 * dl_dnu
    sc *= LIK[:, :, None]
    return nll, -sc.sum(1), np.einsum("fti,ftj->fij", sc, sc), LAM, LAMN, GI


def _fit(R, WX, ACT, LIK, theta0, prior_w, prior_c, free, iters):
    """Batched Levenberg-Marquardt (BHHH curvature, Marquardt diagonal damping, projected box)."""
    F, P = theta0.shape
    fz = (~free).astype(float)
    keep = np.outer(free, free).astype(float)
    th = np.clip(theta0, LOWER, UPPER)

    def objective(th_):
        nll, g, B, *_ = _filter(th_, R, WX, ACT, LIK)
        d = th_ - prior_c
        return nll + 0.5 * np.sum(prior_w * d * d, 1), g + prior_w * d, B

    f, g, B = objective(th)
    mu = np.full(F, 1e-2)
    eye = np.eye(P)
    for _ in range(iters):
        Hm = B + mu[:, None, None] * (np.einsum("fii->fi", B)[:, :, None] * eye) + np.diag(prior_w)[None] + 1e-9 * eye
        Hm = Hm * keep + np.diag(fz)[None]
        step = np.linalg.solve(Hm, (g * free)[:, :, None])[:, :, 0]
        trial = np.clip(th - step, LOWER, UPPER)
        f2, g2, B2 = objective(trial)
        acc = np.isfinite(f2) & (f2 < f - 1e-10)
        th = np.where(acc[:, None], trial, th)
        f = np.where(acc, f2, f)
        g = np.where(acc[:, None], g2, g)
        B = np.where(acc[:, None, None], B2, B)
        mu = np.where(acc, np.maximum(mu / 4, 1e-6), np.minimum(mu * 5, 1e6))
    return th


def _fit_and_forecast(r, wx, tfs, spans, SIG, *, window, use_range, center, prior_w, free, iters, k_mult):
    """Fit one batch of refits, write their forecast rows (``spans`` rows from each refit bar) into
    SIG and return the parameters."""
    W, N = window, len(r)
    span = int(spans.max())
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        R, WX, ACT, LIK = _stack(r, wx, tfs, W)
        n = np.maximum(LIK.sum(1), 1.0)
        rms = np.sqrt(np.maximum((R * R * LIK).sum(1) / n, 1e-12))
        cfix = (WX * LIK).sum(1) / n - np.log(rms) if use_range else np.zeros(len(tfs))
        WX = (WX - cfix[:, None]) * ACT
        th0 = np.tile(center, (len(tfs), 1))
        th0[:, 0] = np.log(rms) - 0.5 * np.log(1.0 / (1.0 - 2.0 * th0[:, 4]))
        th = _fit(R, WX, ACT, LIK, th0, prior_w, center, free, iters)
        # final filter pass over the window plus the (span - 1) bars that use this fit; the
        # recursion is causal, so a longer pass leaves the earlier columns unchanged
        R2, WX2, ACT2, LIK2 = _stack(r, wx, tfs, W, extra=span - 1)
        WX2 = (WX2 - cfix[:, None]) * ACT2
        _, _, _, LAM, LAMN, GI = _filter(th, R2, WX2, ACT2, LIK2, want_grad=False)
        om, ph, ka, ks, et, de = (th[:, j] for j in range(6))
        nu = 1.0 / et
        a = 2.0 * ph[:, None] ** np.arange(HORIZONS - 1)[None, :]
        if use_range:
            Lk = LIK2[:, :W]
            nn = np.maximum(Lk.sum(1), 1.0)
            gw = GI[:, :W]
            gbar = (gw * Lk).sum(1) / nn
            gc = (gw - gbar[:, None]) * Lk
            logm = np.empty((len(tfs), HORIZONS - 1))
            for q in range(HORIZONS - 1):
                logm[:, q] = np.log((np.exp(a[:, q:q + 1] * gc) * Lk).sum(1) / nn)
            mu = om + gbar / (1.0 - ph)
        else:
            bb = (nu[:, None] + 1) / 2
            m1 = hyp1f1_half(bb, a * (ka + ks)[:, None] * (nu[:, None] + 1))
            m2 = hyp1f1_half(bb, a * (ka - ks)[:, None] * (nu[:, None] + 1))
            logm = -a * ka[:, None] + np.log(0.5 * (m1 + m2))
            mu = om
        Lc = np.concatenate([np.zeros((len(tfs), 1)), np.cumsum(logm, 1)], 1)
        fac = nu / (nu - 2.0)
        kk = np.arange(HORIZONS)
        for j in range(span):
            orig = tfs + j
            ok = (j < spans) & (orig <= N - 1)
            lam1 = LAMN[:, W - 1 + j]
            loge = 2 * mu[:, None] + 2 * ph[:, None] ** kk[None, :] * (lam1 - mu)[:, None] + Lc
            V = np.cumsum(np.exp(loge) * fac[:, None], 1)
            sig = k_mult * np.sqrt(V)
            # guard: a non-finite or non-positive value falls back to the window rms * sqrt(h)
            fallback = k_mult * rms[:, None] * np.sqrt(HORIZON_STEPS)[None, :]
            sig = np.where(np.isfinite(sig) & (sig > 0), sig, fallback)
            SIG[orig[ok]] = sig[ok]
    return th


def score_driven_sigma(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *,
        use_range: bool = True, k_mult: float | None = None, window: int | None = None,
        prior_scale: float | None = None, refit: int = 20, min_bars: int = MIN_BARS, iters: int = 20,
        start: int | None = None, refit_origins: np.ndarray | None = None, return_params: bool = False,
) -> np.ndarray | tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Gaussian scale forecasts SIG (N, 20) of ln(C[t+h] / C[t]) for every origin t >= min_bars - 1.

    ``use_range=False`` runs the close-only Beta-t-EGARCH with its own defaults.
    ``refit_origins`` (see ``measures.session_refit_origins``) replaces the grid
    ``min_bars - 1 + k * refit``: the first fit stays at bar ``min_bars - 1`` and each later
    origin above it starts a new fit. ``start`` skips the fits that serve only origins
    before it and leaves those rows NaN; fits are independent, so rows >= start are
    unchanged. ``return_params`` also returns the refit bars and fitted parameters.
    """
    defaults = RANGE_DEFAULTS if use_range else BETAT_DEFAULTS
    k_mult = float(defaults["k_mult"] if k_mult is None else k_mult)
    W = int(defaults["window"] if window is None else window)
    prior_scale = float(defaults["prior_scale"] if prior_scale is None else prior_scale)
    refit = max(1, int(refit))
    close = np.asarray(close, dtype=float)
    N = len(close)
    r = log_returns(close)
    anchor = max(1, int(min_bars) - 1)
    if refit_origins is None:
        tfs = np.arange(anchor, N, refit)
    else:
        later = np.unique(np.asarray(refit_origins, dtype=np.int64).ravel())
        tfs = np.concatenate([[anchor], later[(later > anchor) & (later < N)]]) if anchor < N else later[:0]
    spans = np.diff(np.append(tfs, N))                                   # rows served by each fit
    if start is not None:
        keep = tfs + spans - 1 >= start
        tfs, spans = tfs[keep], spans[keep]
    SIG = np.full((N, HORIZONS), np.nan)
    if len(tfs) == 0:
        return (SIG, tfs, np.zeros((0, 6))) if return_params else SIG
    if use_range:
        with np.errstate(divide="ignore", invalid="ignore"):
            wx = 0.5 * np.log(score_driven_range_variance(open_, high, low, close))
        center, sd = RANGE_PRIOR_CENTER, RANGE_PRIOR_SD
        free = np.ones(6, bool)
    else:
        wx = np.zeros(N)
        center, sd = BETAT_PRIOR_CENTER, BETAT_PRIOR_SD
        free = np.array([1, 1, 1, 1, 1, 0], bool)
    prior_w = np.where(np.isfinite(sd), 1.0 / (prior_scale * np.where(np.isfinite(sd), sd, 1.0)) ** 2, 0.0)
    # Fits are independent, so bounded batches give identical values with bounded memory.
    th = np.concatenate([
        _fit_and_forecast(r, wx, tfs[first:first + MAX_FITS_PER_BATCH], spans[first:first + MAX_FITS_PER_BATCH],
                          SIG, window=W, use_range=use_range, center=center, prior_w=prior_w, free=free,
                          iters=iters, k_mult=k_mult)
        for first in range(0, len(tfs), MAX_FITS_PER_BATCH)
    ])
    SIG[:max(anchor, 0 if start is None else int(start))] = np.nan
    if return_params:
        return SIG, tfs, th
    return SIG


def score_driven_fit_summary(refits: np.ndarray, parameters: np.ndarray) -> dict[str, Any]:
    """JSON-ready parameters of the latest refit (nu reported instead of 1/nu)."""
    if not len(refits):
        return {"latest_refit_origin": None, "refit_count": 0, "parameters": {}}
    latest = parameters[-1]
    values = {name: float(value) for name, value in zip(PARAMETER_NAMES, latest)}
    inverse_nu = values.pop("inverse_nu")
    values["nu"] = 1.0 / inverse_nu if inverse_nu > 0 else None
    return {"latest_refit_origin": int(refits[-1]), "refit_count": int(len(refits)), "parameters": values}
