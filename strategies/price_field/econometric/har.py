"""HAR Range: direct 1..20-day log-HAR scale forecasts from a range-based variance proxy.

Code version: v1.0.0

Frozen round-2 specification (selected on the 16-ticker panel pre-window,
2016-10-01..2023-09-30):

Daily proxy known at the close of bar t (``measures.parkinson_gap_variance``):
    x_t  = g_t^2 + R_t^2 / (4 ln 2),  g_t = ln(O_t / C_{t-1}),  R_t = ln(H_t / L_t)
    xf_t = max(x_t, 0.05 * median+(x_{t-251..t}), 1e-8)
          (median+ is the median of the positive proxies: on real data without zero-range,
          zero-gap bars it is the plain median; on tick-bound series it keeps zero proxies
          from collapsing the floor to 1e-8)
Regressors at origin s (Corsi 2009 log-HAR plus two extensions):
    L_d = ln xf_s,  L_w = ln mean(xf_{s-4..s}),  L_m = ln mean(xf_{s-21..s})
    q_s = L_d * kappa_s,  kappa_s = sqrt(mean22 QE) / mean22 xf, with the range-based
          measurement-error estimate QE_t = (2/3) g_t^4 + 0.4073 R_t^4 / (9 zeta(3))
          (Bollerslev, Patton & Quaedvlieg 2016 HARQ-type term)
    n1_s = min(r_s, 0) / sqrt(mean22 xf),  n5_s = mean5(min(r, 0)) / sqrt(mean22 xf)
          (Corsi & Reno 2012 leverage terms)
Direct regression per horizon h = 1..20:
    ln mean(xf_{s+1..s+h}) = Z_s . beta_h, fitted at the refit origin tf of o's block (the index
    grid tf = refit * floor(o / refit), or date-anchored business-day blocks when the caller
    passes ``refit_origins``) on matured rows s in [tf - h - window + 1, tf - h] (expanding when
    shorter), ridge toward the prior slopes (0.2, 0.35, 0.45, 0, 0, 0) with penalty
    ridge_n0 * within-window variance; the intercept is unpenalized.
Forecast: V_{o,h} = h * exp(Z_o . beta_h + s2_h / 2) and SIG = k * sqrt(V), k = 0.94.
Fallback with fewer than n_min matured rows: V = h * (0.2 xf + 0.35 mean5 + 0.45 mean22).
Insanity filter (product guard after Bollerslev, Patton & Quaedvlieg 2016): the fitted log
rate Z_o . beta_h + s2_h / 2 is clipped to [min, max] of the matured targets in its own fit
window, widened by ln 10, so a price jump or a degenerate window cannot extrapolate to absurd
scales; on the research panel and NVDA it never binds at the defaults.

Close-only mode (``use_range=False``) uses the research r^2 variant: x_t = r_t^2 and
QE_t = (2/3) r_t^4 (the Gaussian measurement-error estimate of a squared return).
Product guard: every slope penalty is at least 1e-12, so a regressor that is identically
zero in a window (no down day) stays at its prior instead of making the system singular;
on real data the data-driven penalty is far larger and results are unchanged.
Bad-bar guard: a non-finite proxy (for example after a zero close) is missing, a target
window that contains a missing proxy is not a matured row for that horizon (each horizon
then keeps its own cross products), and a non-finite return adds no leverage term, so one
bad bar removes only the rows that touch it. On real data the proxy is finite on every bar
after the first and results are unchanged.

Defaults: window 2000, refit 20, ridge_n0 50, k 0.94. A full window needs about
2000 + 42 bars; shorter histories use every matured row and the ridge prior keeps the
fits stable. Rows are deterministic and prefix invariant: row o never reads a bar after o.
With the date-anchored schedule a row's forecast also does not depend on where the loaded
history starts, up to prefix-sum rounding, once its fit window lies inside the history.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from strategies.price_field.econometric.measures import (
    LOG2,
    floor_at_rolling_median,
    log_returns,
    parkinson_gap_variance,
    refit_schedule,
    rolling_mean,
    squared_return_variance,
)

HORIZONS = 20
HORIZON_STEPS = np.arange(1, HORIZONS + 1)
ZETA3 = 1.2020569031595942
PARKINSON_RELATIVE_VARIANCE = 9.0 * ZETA3 / (16.0 * LOG2 ** 2) - 1.0      # 0.4073
PRIOR_SLOPES = np.array([0.0, 0.2, 0.35, 0.45, 0.0, 0.0, 0.0])            # intercept, L_d, L_w, L_m, q, n1, n5
REGRESSOR_NAMES = ("intercept", "log_daily", "log_weekly", "log_monthly", "quarticity", "leverage_daily",
                   "leverage_weekly")
DEGENERATE_RIDGE = 1e-12
HAR_DEFAULTS: dict[str, float | int] = {
    "window": 2000, "refit": 20, "ridge_n0": 50.0, "k": 0.94, "floor_frac": 0.05, "abs_floor": 1e-8,
    "n_min": 60, "quarticity_window": 22, "numeric_ridge": 1e-6, "insanity_margin": math.log(10.0),
}


def har_design(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *,
        use_range: bool = True, floor_frac: float = 0.05, abs_floor: float = 1e-8, quarticity_window: int = 22,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Regressor matrix Z (N, 7), floored proxy xf (N,) and log returns r (N,).

    Rows with any non-finite regressor are NaN (the first ~22 bars).
    """
    close = np.asarray(close, dtype=float)
    if use_range:
        proxy, gap, log_range, _ = parkinson_gap_variance(open_, high, low, close)
        gap0 = np.where(np.isfinite(gap), gap, 0.0)                      # missing open -> no gap term
        range0 = np.where(np.isfinite(log_range), log_range, 0.0)
        quarticity = (2.0 / 3.0) * gap0 ** 4 + PARKINSON_RELATIVE_VARIANCE * range0 ** 4 / (9.0 * ZETA3)
    else:
        proxy, squared_source = squared_return_variance(close)
        returns0 = np.where(np.isfinite(squared_source), squared_source, 0.0)
        quarticity = (2.0 / 3.0) * returns0 ** 4
    if len(proxy):
        proxy[0] = np.nan
        quarticity[0] = np.nan
    proxy = np.where(np.isfinite(proxy), proxy, np.nan)                  # a zero close gives an infinite proxy
    floored = floor_at_rolling_median(proxy, floor_frac=floor_frac, abs_floor=abs_floor)
    returns = log_returns(close)
    weekly = rolling_mean(floored, 5)
    monthly = rolling_mean(floored, 22)
    window = int(quarticity_window)
    level = monthly if window == 22 else rolling_mean(floored, window)
    with np.errstate(divide="ignore", invalid="ignore"):
        daily = np.log(floored)
        kappa = np.sqrt(rolling_mean(quarticity, window)) / level
        negative = np.minimum(np.where(np.isfinite(returns), returns, 0.0), 0.0)
        monthly_scale = np.sqrt(monthly)
        design = np.column_stack([
            np.ones(len(close)), daily, np.log(weekly), np.log(monthly), daily * kappa,
            negative / monthly_scale, rolling_mean(negative, 5) / monthly_scale,
        ])
    design[~np.all(np.isfinite(design), 1)] = np.nan
    return design, floored, returns


def _forward_log_mean(floored: np.ndarray) -> np.ndarray:
    """Y[s, h-1] = ln(mean(xf[s+1..s+h])), NaN where the window runs past the end or holds a missing proxy."""
    count = len(floored)
    finite = np.isfinite(floored)
    cumulative = np.concatenate([[0.0], np.cumsum(np.where(finite, floored, 0.0))])
    missing = np.concatenate([[0], np.cumsum(~finite)])
    targets = np.full((count, HORIZONS), np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        for horizon in HORIZON_STEPS:
            rows = np.arange(count - horizon)
            total = cumulative[rows + horizon + 1] - cumulative[rows + 1]
            complete = missing[rows + horizon + 1] == missing[rows + 1]
            targets[rows, horizon - 1] = np.where(complete, np.log(total / horizon), np.nan)
    return targets


def _cumsum0(values: np.ndarray) -> np.ndarray:
    output = np.zeros((values.shape[0] + 1,) + values.shape[1:])
    np.cumsum(values, axis=0, out=output[1:])
    return output


def _window_extremes(
        targets: np.ndarray, lower: np.ndarray, upper: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Min and max of the finite targets[lower:upper, h] per (refit, horizon), by sparse tables.

    ``lower``/``upper`` are (n_ref, H) row bounds; empty or all-missing windows give
    (+inf, -inf), which leaves the insanity filter inactive for that fit.
    """
    count = targets.shape[0]
    low_table = [np.where(np.isfinite(targets), targets, np.inf)]
    high_table = [np.where(np.isfinite(targets), targets, -np.inf)]
    span = 1
    while 2 * span <= count:
        low_table.append(np.minimum(low_table[-1][:-span], low_table[-1][span:]))
        high_table.append(np.maximum(high_table[-1][:-span], high_table[-1][span:]))
        span *= 2
    length = upper - lower
    level = np.floor(np.log2(np.maximum(length, 1))).astype(int)
    horizon = np.broadcast_to(np.arange(targets.shape[1])[None, :], lower.shape)
    minimum = np.full(lower.shape, np.inf)
    maximum = np.full(lower.shape, -np.inf)
    for depth in np.unique(level[length > 0]):
        mask = (length > 0) & (level == depth)
        start, stop = lower[mask], upper[mask] - (1 << int(depth))
        columns = horizon[mask]
        minimum[mask] = np.minimum(low_table[depth][start, columns], low_table[depth][stop, columns])
        maximum[mask] = np.maximum(high_table[depth][start, columns], high_table[depth][stop, columns])
    return minimum, maximum


def har_variance(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *,
        use_range: bool = True, window: int = 2000, refit: int = 20, ridge_n0: float = 50.0,
        floor_frac: float = 0.05, abs_floor: float = 1e-8, n_min: int = 60, quarticity_window: int = 22,
        numeric_ridge: float = 1e-6, first: int = 0, refit_origins: np.ndarray | None = None,
        insanity_margin: float | None = math.log(10.0), return_info: bool = False,
) -> np.ndarray | tuple[np.ndarray, dict[str, Any]]:
    """Cumulative h-day variance forecasts V (N, 20) of ln(C_{o+h} / C_o), before the multiplier k.

    The rolling OLS uses prefix sums of cross products, so each refit costs O(p^2).
    ``first`` only skips work for origins below it; computed rows do not depend on it.
    ``refit_origins`` (see ``measures.session_refit_origins``) replaces the index grid
    ``0, refit, 2 refit, ...``; each origin uses the fit of the latest refit origin at or
    before it.
    """
    design, floored, _ = har_design(open_, high, low, close, use_range=use_range, floor_frac=floor_frac,
                                    abs_floor=abs_floor, quarticity_window=quarticity_window)
    count, width = design.shape
    targets = _forward_log_mean(floored)
    valid = np.all(np.isfinite(design), 1)
    design0 = np.where(valid[:, None], design, 0.0)
    valid_target = valid[:, None] & np.isfinite(targets)
    targets0 = np.where(valid_target, targets, 0.0)
    products = design0[:, :, None] * design0[:, None, :]                        # (N, p, p)
    inside = np.arange(count)[:, None] < count - HORIZON_STEPS[None, :]         # target window inside the data
    # Bad-bar guard: a missing proxy drops the target rows that touch it, so each horizon then keeps
    # its own cross products; otherwise every matured row has a target and one set serves all horizons.
    per_horizon = bool(np.any(valid[:, None] & inside & ~valid_target))
    if per_horizon:
        cross = _cumsum0(products[:, None] * valid_target[:, :, None, None])    # (N+1, H, p, p)
    else:
        cross = _cumsum0(products)                                              # (N+1, p, p)
    cross_target = _cumsum0(design0[:, None, :] * targets0[:, :, None])        # (N+1, H, p)
    target_squares = _cumsum0(targets0 * targets0)                            # (N+1, H)
    matured = _cumsum0(valid_target.astype(float))                            # (N+1, H)

    first = max(0, int(first))
    schedule = refit_schedule(count, refit, refit_origins)
    refits = schedule[max(int(np.searchsorted(schedule, first, side="right")) - 1, 0):]   # from first's block
    V = np.full((count, HORIZONS), np.nan)
    info: dict[str, Any] = {"refits": refits, "beta": np.zeros((0, HORIZONS, width)),
                            "s2": np.zeros((0, HORIZONS)), "n": np.zeros((0, HORIZONS)),
                            "ok": np.zeros((0, HORIZONS), bool)}
    if len(refits) == 0:
        return (V, info) if return_info else V
    latest = refits[:, None] - HORIZON_STEPS[None, :]                          # latest matured row per (tf, h)
    upper = np.clip(latest + 1, 0, count)
    lower = np.minimum(np.maximum(0, latest - int(window) + 1), upper)
    horizon_index = np.arange(HORIZONS)[None, :]
    if per_horizon:
        A = cross[upper, horizon_index] - cross[lower, horizon_index]          # (n_ref, H, p, p)
    else:
        A = cross[upper] - cross[lower]
    b = cross_target[upper, horizon_index] - cross_target[lower, horizon_index]
    yy = target_squares[upper, horizon_index] - target_squares[lower, horizon_index]
    n = matured[upper, horizon_index] - matured[lower, horizon_index]
    rows = np.maximum(n, 1.0)
    diagonal = np.diagonal(A, axis1=2, axis2=3)                               # (n_ref, H, p)
    penalty = numeric_ridge * diagonal / rows[..., None]
    if ridge_n0:
        weight = np.maximum(A[..., 0, 0], 1e-300)
        within = diagonal / weight[..., None] - (A[..., 0, :] / weight[..., None]) ** 2
        penalty = penalty + ridge_n0 * np.maximum(within, 0.0) * (weight / rows)[..., None]
    penalty[..., 0] = 0.0
    # Product guard (inactive on real data): a regressor that is identically zero in the window,
    # such as the leverage terms without a down day, has no data penalty; keep it at its prior.
    penalty[..., 1:] = np.maximum(penalty[..., 1:], DEGENERATE_RIDGE)
    A2 = A + penalty[..., None] * np.eye(width)
    b2 = b + penalty * PRIOR_SLOPES[None, None, :]
    ok = n >= n_min
    A2[~ok] = np.eye(width)
    b2[~ok] = 0.0
    beta = np.linalg.solve(A2, b2[..., None])[..., 0]                          # (n_ref, H, p)
    residual = yy - 2.0 * np.sum(beta * b, -1) + np.einsum("rhi,rhij,rhj->rh", beta, A, beta)
    s2 = np.maximum(residual, 0.0) / np.maximum(n - width, 1.0)
    # Insanity filter (Bollerslev, Patton & Quaedvlieg 2016): keep each log-variance forecast
    # within the range of the matured targets of its own fit window, widened by
    # ``insanity_margin`` in log units, so a jump or a degenerate window cannot extrapolate the
    # regression to absurd scales. Genuine volatility regimes stay far inside the band.
    if insanity_margin is None:
        floor_rate, ceiling_rate = np.full(lower.shape, -np.inf), np.full(lower.shape, np.inf)
    else:
        target_low, target_high = _window_extremes(np.where(valid_target, targets, np.nan), lower, upper)
        # An empty window leaves (+inf, -inf); such fits are below n_min and never used.
        floor_rate = np.where(np.isfinite(target_low), target_low - float(insanity_margin), -np.inf)
        ceiling_rate = np.where(np.isfinite(target_high), target_high + float(insanity_margin), np.inf)

    origins = np.arange(max(first, 1), count)
    refit_index = np.searchsorted(refits, origins, side="right") - 1
    fitted = np.einsum("op,ohp->oh", np.nan_to_num(design[origins]), beta[refit_index]) + 0.5 * s2[refit_index]
    fitted = np.clip(fitted, floor_rate[refit_index], ceiling_rate[refit_index])
    monthly = rolling_mean(floored, 22, min_periods=1)
    persistence = 0.2 * floored + 0.35 * rolling_mean(floored, 5, min_periods=1) + 0.45 * monthly
    persistence = np.where(np.isfinite(persistence), persistence, monthly)[origins]
    with np.errstate(over="ignore"):
        rate = np.where(ok[refit_index] & valid[origins][:, None], np.exp(fitted), persistence[:, None])
    V[origins] = HORIZON_STEPS[None, :] * rate
    if return_info:
        info.update(beta=beta, s2=s2, n=n, ok=ok)
        return V, info
    return V


def har_sigma(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *, k: float = 0.94,
        use_range: bool = True, **overrides: Any,
) -> np.ndarray:
    """SIG[o, h-1] = k * sqrt(V[o, h-1]): Gaussian std of ln(C_{o+h} / C_o) from bars <= o."""
    params = {key: value for key, value in HAR_DEFAULTS.items() if key != "k"}
    params.update(overrides)
    return k * np.sqrt(har_variance(open_, high, low, close, use_range=use_range, **params))


def har_fit_summary(info: dict[str, Any]) -> dict[str, Any]:
    """JSON-ready coefficients of the latest refit for horizons 1 and 20."""
    refits = info["refits"]
    if not len(refits) or not len(info["beta"]):
        return {"latest_refit_origin": None, "horizons": {}}
    summary: dict[str, Any] = {"latest_refit_origin": int(refits[-1]), "horizons": {}}
    for horizon in (1, 20):
        column = horizon - 1
        fitted = bool(info["ok"][-1, column])
        summary["horizons"][str(horizon)] = {
            "regression": "ridge-log-har" if fitted else "persistence-fallback",
            "matured_rows": int(info["n"][-1, column]),
            "coefficients": {name: float(value) if fitted and math.isfinite(float(value)) else None
                             for name, value in zip(REGRESSOR_NAMES, info["beta"][-1, column])},
            "residual_variance": float(info["s2"][-1, column]) if fitted else None,
        }
    return summary
