"""Causal daily return and variance measures for the econometric Price Field models.

Code version: v1.0.0

Every helper maps a chronological array to an array of the same length whose
row ``t`` depends on rows ``<= t`` only (``forward_log_returns`` is the
documented exception: it builds matured targets that callers read through a
causal index). Rolling helpers skip missing values the way pandas does, so the
ports reproduce the frozen research modules without importing pandas.

Daily variance proxies (``g`` overnight gap, ``R`` intraday log range):

* Parkinson plus gap: ``x_t = g_t^2 + R_t^2 / (4 ln 2)``, the squared
  close-to-close return where the range is unusable (HAR Range, Score-Driven).
* Yang-Zhang single-day form (Rough Volatility):
  ``x_t = g^2 + kz c^2 + (1 - kz) [u (u - c) + d (d - c)]`` with
  ``u = ln H/O``, ``d = ln L/O``, ``c = ln C/O`` and ``kz = 0.34 / 2.84``.
* Squared close return ``r_t^2``: the close-only fallback of every model.

Variance floors take the causal median of the positive, finite proxies only, so a
tick-bound or illiquid series whose window is mostly zero-range, zero-return bars
cannot pull the floor down to its absolute minimum.

Refit schedules (``refit_schedule``) are an index grid ``0, refit, 2 refit, ...`` for
pure-array callers; with session dates (``session_refit_origins``) they follow fixed
business-day blocks, so a bar's refit origin does not depend on where the loaded
history starts.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

LOG2 = math.log(2.0)
YANG_ZHANG_WEIGHT = 0.34 / (1.34 + 6 / 4)
MEDIAN_WINDOW = 252
REFIT_EPOCH = np.datetime64("2000-01-03", "D")      # a Monday; business-day blocks count from it


def log_returns(close: np.ndarray) -> np.ndarray:
    """``r[t] = ln(C_t / C_{t-1})``; ``r[0]`` is NaN."""
    close = np.asarray(close, dtype=float)
    returns = np.full(len(close), np.nan)
    if len(close) > 1:
        with np.errstate(divide="ignore", invalid="ignore"):
            returns[1:] = np.diff(np.log(close))
    return returns


def overnight_gap(open_: np.ndarray, close: np.ndarray, *, initial: float = math.nan) -> np.ndarray:
    """``g[t] = ln(O_t / C_{t-1})``; ``g[0] = initial``."""
    open_, close = np.asarray(open_, dtype=float), np.asarray(close, dtype=float)
    gap = np.full(len(close), float(initial))
    if len(close) > 1:
        with np.errstate(divide="ignore", invalid="ignore"):
            gap[1:] = np.log(open_[1:] / close[:-1])
    return gap


def rolling_sum_count(values: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Trailing sum and count of the finite entries over ``(t - window, t]`` (O(N))."""
    values = np.asarray(values, dtype=float)
    finite = np.isfinite(values)
    sums = np.concatenate([[0.0], np.cumsum(np.where(finite, values, 0.0))])
    counts = np.concatenate([[0], np.cumsum(finite.astype(np.int64))])
    index = np.arange(len(values))
    low = np.maximum(0, index + 1 - int(window))
    return sums[index + 1] - sums[low], (counts[index + 1] - counts[low]).astype(float)


def _trailing_windows(values: np.ndarray, window: int) -> np.ndarray:
    """(N, window) view of the trailing windows, NaN-padded before the first row."""
    window = max(1, int(window))
    padded = np.concatenate([np.full(window - 1, np.nan), np.asarray(values, dtype=float)])
    return sliding_window_view(padded, window)


def rolling_mean(values: np.ndarray, window: int, *, min_periods: int | None = None) -> np.ndarray:
    """Trailing mean of the non-missing entries; NaN below ``min_periods`` (default ``window``)."""
    values = np.asarray(values, dtype=float)
    if len(values) == 0:
        return np.empty(0)
    required = int(window) if min_periods is None else int(min_periods)
    windows = _trailing_windows(values, window)
    present = ~np.isnan(windows)
    counts = present.sum(1)
    totals = np.where(present, windows, 0.0).sum(1)
    with np.errstate(divide="ignore", invalid="ignore"):
        means = totals / counts
    return np.where(counts >= max(required, 1), means, np.nan)


def rolling_median(values: np.ndarray, window: int = MEDIAN_WINDOW) -> np.ndarray:
    """Trailing median of the non-missing entries over ``(t - window, t]`` (pandas ``min_periods=1``)."""
    values = np.asarray(values, dtype=float)
    result = np.full(len(values), np.nan)
    if len(values) == 0:
        return result
    ordered = np.sort(_trailing_windows(values, window), axis=1)        # NaN sorts last
    counts = (~np.isnan(ordered)).sum(1)
    rows = np.flatnonzero(counts > 0)
    present = counts[rows]
    lower = ordered[rows, (present - 1) // 2]
    upper = ordered[rows, present // 2]
    result[rows] = np.where(present % 2 == 1, lower, (lower + upper) / 2)
    return result


def positive_rolling_median(values: np.ndarray, window: int = MEDIAN_WINDOW) -> np.ndarray:
    """Trailing median of the positive, finite entries; zero, negative and non-finite entries are missing."""
    values = np.asarray(values, dtype=float)
    return rolling_median(np.where(np.isfinite(values) & (values > 0), values, np.nan), window)


def rolling_std(values: np.ndarray, window: int, *, min_count: int) -> np.ndarray:
    """Trailing sample std (ddof=1) of the finite entries; NaN below ``min_count``.

    Uses running sums of ``x`` and ``x^2``: for daily log returns the squared mean
    is tiny next to the mean square, so cancellation is benign (matches pandas
    ``rolling(window, min_periods).std()`` to about 1e-12).
    """
    values = np.asarray(values, dtype=float)
    first, count = rolling_sum_count(values, window)
    finite = np.isfinite(values)
    squares = np.where(finite, values, 0.0)
    cumulative = np.concatenate([[0.0], np.cumsum(squares * squares)])
    index = np.arange(len(values))
    low = np.maximum(0, index + 1 - int(window))
    second = cumulative[index + 1] - cumulative[low]
    with np.errstate(invalid="ignore", divide="ignore"):
        variance = (second - first * first / count) / (count - 1.0)
    variance = np.where(count >= max(2, int(min_count)), np.maximum(variance, 0.0), np.nan)
    return np.sqrt(variance)


def expanding_mean(values: np.ndarray) -> np.ndarray:
    """Mean of the non-missing entries up to each row (NaN before the first one)."""
    values = np.asarray(values, dtype=float)
    present = ~np.isnan(values)
    totals = np.cumsum(np.where(present, values, 0.0))
    counts = np.cumsum(present)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(counts > 0, totals / counts, np.nan)


def forward_fill(values: np.ndarray) -> np.ndarray:
    """Carry the last non-missing value forward; leading gaps stay NaN."""
    values = np.asarray(values, dtype=float)
    present = ~np.isnan(values)
    last = np.where(present, np.arange(len(values)), 0)
    np.maximum.accumulate(last, out=last)
    filled = values[last]
    filled[np.cumsum(present) == 0] = np.nan
    return filled


def forward_log_returns(close: np.ndarray, horizons: int = 20) -> np.ndarray:
    """Matured targets ``Y[s, h-1] = ln C_{s+h} - ln C_s`` (NaN beyond the end)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        log_close = np.log(np.asarray(close, dtype=float))
    targets = np.full((len(log_close), int(horizons)), np.nan)
    for horizon in range(1, int(horizons) + 1):
        targets[:-horizon, horizon - 1] = log_close[horizon:] - log_close[:-horizon]
    return targets


def parkinson_gap_variance(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *,
        reject_inverted_range: bool = False,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Parkinson (1980) range plus squared overnight gap, known at the close of bar ``t``.

    Returns ``(x, gap, log_range, returns)``. Bars whose proxy is not finite (missing
    or non-positive open/high/low), and with ``reject_inverted_range`` also bars with
    ``H < L``, fall back to the squared close-to-close return. ``x[0]`` is NaN.
    """
    open_, high, low, close = (np.asarray(item, dtype=float) for item in (open_, high, low, close))
    returns = log_returns(close)
    gap = overnight_gap(open_, close)
    with np.errstate(divide="ignore", invalid="ignore"):
        log_range = np.log(high / low)
        proxy = gap * gap + log_range * log_range / (4.0 * LOG2)
        invalid = ~np.isfinite(proxy)
        if reject_inverted_range:
            invalid |= (proxy < 0) | ~(high >= low)
    proxy = np.where(invalid, returns * returns, proxy)
    if len(proxy):
        proxy[0] = np.nan
    return proxy, gap, log_range, returns


def squared_return_variance(close: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Close-only daily proxy ``x_t = r_t^2`` and the returns (``x[0]`` is NaN)."""
    returns = log_returns(close)
    return returns * returns, returns


def floor_at_rolling_median(
        proxy: np.ndarray, *, floor_frac: float = 0.05, abs_floor: float = 1e-8,
        window: int = MEDIAN_WINDOW,
) -> np.ndarray:
    """``max(x_t, floor_frac * median+(x_{t-window+1..t}), abs_floor)``; NaN stays NaN.

    ``median+`` is the median of the positive, finite proxies in the window, so zero-range,
    zero-return bars cannot set the floor; a window without a positive proxy uses ``abs_floor``.
    Where the window holds no zero proxy the floor equals the plain rolling-median floor.
    """
    median = np.nan_to_num(positive_rolling_median(proxy, window), nan=0.0)
    return np.maximum(proxy, np.maximum(floor_frac * median, abs_floor))


def open_anchored_variance(
        open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, *, kind: str = "yz",
) -> np.ndarray:
    """Raw single-day proxy from open-anchored logs, with the first bar's gap set to zero.

    ``kind="yz"`` is the Yang-Zhang (2000) single-day form and ``kind="park"`` is
    Parkinson plus the squared gap. The result may be non-positive or non-finite on
    unusable bars; ``median_filled_log_variance`` treats those as missing.
    """
    open_, high, low, close = (np.asarray(item, dtype=float) for item in (open_, high, low, close))
    gap = overnight_gap(open_, close, initial=0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        up, down, drift = np.log(high / open_), np.log(low / open_), np.log(close / open_)
        if kind == "park":
            return gap ** 2 + (up - down) ** 2 / (4 * LOG2)
        if kind == "yz":
            weight = YANG_ZHANG_WEIGHT
            return gap ** 2 + weight * drift ** 2 + (1 - weight) * (up * (up - drift) + down * (down - drift))
    raise ValueError(f"Unknown open-anchored variance proxy: {kind}.")


def median_filled_log_variance(
        proxy: np.ndarray, *, floor_frac: float = 0.05, window: int = MEDIAN_WINDOW,
        default_log_variance: float = math.log(0.02 ** 2),
) -> np.ndarray:
    """``L_t = ln max(x_t, floor_frac * causal median)``; invalid bars take the causal median.

    Non-positive or non-finite ``x_t`` is missing; a bar with no causal median carries the
    last finite value forward, and ``default_log_variance`` covers a leading gap.
    """
    proxy = np.asarray(proxy, dtype=float)
    proxy = np.where(np.isfinite(proxy) & (proxy > 0), proxy, np.nan)
    median = rolling_median(proxy, window)
    floored = np.where(np.isnan(proxy), median, np.maximum(proxy, floor_frac * median))
    with np.errstate(divide="ignore", invalid="ignore"):
        log_variance = forward_fill(np.log(floored))
    return np.where(np.isfinite(log_variance), log_variance, default_log_variance)


def refit_schedule(count: int, refit: int, refit_origins: np.ndarray | None = None) -> np.ndarray:
    """Sorted rows that start a refit block: ``0, refit, 2 refit, ...`` or the given origins.

    Given origins are restricted to ``[0, count)`` and always include row 0, so every row
    belongs to the block of the latest origin at or before it.
    """
    count = max(0, int(count))
    if refit_origins is None:
        return np.arange(0, count, max(1, int(refit)))
    origins = np.unique(np.concatenate([[0], np.asarray(refit_origins, dtype=np.int64).ravel()]))
    return origins[(origins >= 0) & (origins < count)]


def session_refit_origins(dates: np.ndarray, refit: int) -> np.ndarray:
    """Date-anchored refit origins: row 0 plus every row that starts a new business-day block.

    A row's block is ``busday_count(REFIT_EPOCH, date) // refit``: fixed runs of ``refit``
    weekdays counted from a constant epoch. The schedule therefore depends on each session's
    date only, not on the first loaded row, so a later origin is refit on the same date
    whatever history precedes it; exchange holidays and missing sessions only shorten a block.
    ``dates`` must be chronological.
    """
    days = np.asarray(dates).astype("datetime64[D]")
    if days.size == 0:
        return np.zeros(0, dtype=np.int64)
    if np.any(np.isnat(days)) or np.any(np.diff(days) < np.timedelta64(0, "D")):
        raise ValueError("Refit origins need chronological session dates.")
    block = np.busday_count(REFIT_EPOCH, days) // max(1, int(refit))
    return np.concatenate([[0], np.flatnonzero(np.diff(block) != 0) + 1]).astype(np.int64)


def usable_range_mask(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """Bars with finite positive OHLC, ``H >= L`` and a previous close (diagnostic coverage only)."""
    open_, high, low, close = (np.asarray(item, dtype=float) for item in (open_, high, low, close))
    prices = np.vstack([open_, high, low, close])
    usable = np.all(np.isfinite(prices) & (prices > 0), axis=0) & (high >= low)
    if len(usable):
        previous = np.concatenate([[False], np.isfinite(close[:-1]) & (close[:-1] > 0)])
        usable &= previous
    return usable

