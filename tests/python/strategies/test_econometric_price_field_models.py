"""Econometric Price Field model contracts. Code version: v1.0.0."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from strategies.price_field.econometric import crps_learning, har, measures, rough, score_driven
from strategies.price_field.econometric.forecasts import (
    EconometricSettings,
    PriceArrays,
    crps_learning_forecast,
    har_range_forecast,
    rough_volatility_forecast,
    score_driven_forecast,
)
from strategies.price_field.econometric.location import bayesian_sharpe_drift, drift_components
from tests.factories.market import (
    clustered_ohlc_random_walk,
    illiquid_ohlc_random_walk,
    ohlc_frame_for_dates,
    oscillating_ohlc_frame_for_dates,
)

PRICE_COLUMNS = ("Open", "High", "Low", "Close")
# forecast, frozen fit window, frozen multiplier, documented first forecast origin
MODELS = {
    "har-range": (har_range_forecast, 2000, 0.94, 22),
    "score-driven": (score_driven_forecast, 1000, 0.96, score_driven.MIN_BARS - 1),
    "rough-volatility": (rough_volatility_forecast, 2000, 0.94, 0),
    "crps-learning": (crps_learning_forecast, 2000, 1.0, 60),
}


def prices_of(frame) -> PriceArrays:
    return PriceArrays(*(frame[column].to_numpy(dtype=float) for column in PRICE_COLUMNS))


def forecast(model: str, frame, *, use_range: bool = True, use_drift: bool = True):
    function, window, multiplier, _ = MODELS[model]
    settings = EconometricSettings(fit_window=window, scale_multiplier=multiplier, use_intraday_range=use_range,
                                   use_drift=use_drift)
    return function(prices_of(frame), settings)


@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
@pytest.mark.parametrize("model", tuple(MODELS))
def test_forecast_rows_ignore_every_bar_after_their_origin(model, use_range):
    original = clustered_ohlc_random_walk(220)
    changed = original.copy()
    cut = 150
    later = np.arange(cut + 1, len(changed))
    shift = np.exp(np.cumsum(np.random.default_rng(3).normal(0.0, 0.04, len(later))))
    changed.loc[later, list(PRICE_COLUMNS)] = changed.loc[later, list(PRICE_COLUMNS)].to_numpy() * shift[:, None]
    changed.loc[later, "High"] *= 1.03

    first = forecast(model, original, use_range=use_range)
    second = forecast(model, changed, use_range=use_range)

    for before, after in ((first.means, second.means), (first.stds, second.stds)):
        np.testing.assert_allclose(before[:cut + 1], after[:cut + 1], rtol=1e-12, atol=1e-15, equal_nan=True)
    assert not np.allclose(first.stds[cut + 21:], second.stds[cut + 21:], equal_nan=True)


@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
@pytest.mark.parametrize("model", tuple(MODELS))
def test_short_history_with_bad_bars_is_finite_from_the_documented_origin(model, use_range):
    frame = clustered_ohlc_random_walk(160, zero_range_rows=(40, 41, 90), missing_open_rows=(55, 120))
    result = forecast(model, frame, use_range=use_range)
    first_origin = MODELS[model][3]

    assert result.means.shape == result.stds.shape == (160, 20)
    assert np.isfinite(result.means).all()
    assert np.isfinite(result.stds[first_origin:]).all()
    assert (result.stds[first_origin:] > 0).all()
    assert np.isfinite(result.stds[60:]).all()


def test_drift_matches_a_hand_computed_sharpe_posterior():
    closes = clustered_ohlc_random_walk(400)["Close"].to_numpy()
    prior_sharpe, prior_strength, window = 0.8, 100.0, 50
    components = drift_components(closes, prior_sharpe=prior_sharpe, prior_strength=prior_strength, window=window)

    returns = np.full(len(closes), np.nan)
    returns[1:] = np.log(closes[1:] / closes[:-1])
    sigma = np.full(len(closes), np.nan)
    for t in range(len(closes)):
        sample = returns[max(0, t - 251):t + 1]
        sample = sample[np.isfinite(sample)]
        if len(sample) >= 20:
            sigma[t] = np.std(sample, ddof=1)
    standardized = np.full(len(closes), np.nan)
    for t in range(21, len(closes)):
        if np.isfinite(sigma[t - 1]):
            standardized[t] = returns[t] / max(sigma[t - 1], 1e-4)
    for t in (0, 20, 21, 30, 70, 399):
        sample = standardized[max(0, t - window + 1):t + 1]
        sample = sample[np.isfinite(sample)]
        sharpe = (prior_strength * prior_sharpe / math.sqrt(252.0) + sample.sum()) / (prior_strength + len(sample))
        expected = 0.0 if t <= 20 else sharpe * sigma[t]
        assert components["mu"][t] == pytest.approx(expected, rel=1e-10, abs=1e-15)
        assert components["n"][t] == len(sample)
    means = drift_components(closes)["mu"]
    assert (means[:21] == 0).all()
    np.testing.assert_array_equal(bayesian_sharpe_drift(closes), means[:, None] * np.arange(1, 21))


@pytest.mark.parametrize("zero_close", (False, True), ids=("clean", "zero-close"))
@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
def test_har_regression_matches_naive_ridge_least_squares(use_range, zero_close):
    frame = clustered_ohlc_random_walk(420)
    if zero_close:
        frame.loc[300, "Close"] = 0.0                    # inside the fit window: only the rows touching it drop out
    arrays = prices_of(frame)
    window = 150
    variance, info = har.har_variance(*arrays, use_range=use_range, window=window, return_info=True)
    design, floored, _ = har.har_design(*arrays, use_range=use_range)
    refit_row = len(info["refits"]) - 3
    origin = int(info["refits"][refit_row])
    for horizon in (1, 7, 20):
        latest = origin - horizon
        rows = np.arange(max(0, latest - window + 1), latest + 1)
        targets = np.array([math.log(np.mean(floored[s + 1:s + horizon + 1])) for s in rows])
        usable = np.all(np.isfinite(design[rows]), 1) & np.isfinite(targets)
        Z, y = design[rows][usable], targets[usable]
        penalty = 50.0 * Z.var(0) + 1e-6 * np.mean(Z * Z, 0)
        penalty[0] = 0.0
        augmented = np.vstack([Z, np.diag(np.sqrt(penalty))[1:]])
        response = np.concatenate([y, np.sqrt(penalty[1:]) * har.PRIOR_SLOPES[1:]])
        beta = np.linalg.lstsq(augmented, response, rcond=None)[0]
        np.testing.assert_allclose(info["beta"][refit_row, horizon - 1], beta, rtol=1e-7, atol=1e-9)
        residual = y - Z @ beta
        s2 = float(residual @ residual) / (len(y) - Z.shape[1])
        assert info["s2"][refit_row, horizon - 1] == pytest.approx(s2, rel=1e-7)
        for o in (origin, origin + 5):
            expected = horizon * math.exp(design[o] @ info["beta"][refit_row, horizon - 1]
                                          + 0.5 * info["s2"][refit_row, horizon - 1])
            assert variance[o, horizon - 1] == pytest.approx(expected, rel=1e-12)


def test_har_ordinary_least_squares_without_ridge_matches_lstsq():
    arrays = prices_of(clustered_ohlc_random_walk(300))
    _, info = har.har_variance(*arrays, window=120, ridge_n0=0.0, numeric_ridge=0.0, return_info=True)
    design, floored, _ = har.har_design(*arrays)
    origin = int(info["refits"][-1])
    horizon = 5
    rows = np.arange(origin - horizon - 119, origin - horizon + 1)
    y = np.array([math.log(np.mean(floored[s + 1:s + horizon + 1])) for s in rows])
    beta = np.linalg.lstsq(design[rows], y, rcond=None)[0]
    np.testing.assert_allclose(info["beta"][-1, horizon - 1], beta, rtol=1e-7, atol=1e-9)


def _naive_beta_t_path(theta, returns, drivers):
    omega, phi, kappa, kappa_star, inverse_nu, delta = theta
    nu = 1.0 / inverse_nu
    level = omega
    levels, log_likelihood = [], 0.0
    constant = math.lgamma((nu + 1) / 2) - math.lgamma(nu / 2) - 0.5 * math.log(math.pi * nu)
    for value, driver in zip(returns, drivers):
        levels.append(level)
        scaled = value * value / (nu * math.exp(2 * level))
        log_likelihood += constant - level - 0.5 * (nu + 1) * math.log1p(scaled)
        beta_share = scaled / (1 + scaled)
        score = (nu + 1) * beta_share - 1
        sign = -np.sign(value)
        level = (omega + phi * (level - omega) + kappa * score + kappa_star * sign * (score + 1)
                 + delta * (driver - level))
    return np.array(levels), -log_likelihood


def test_beta_t_egarch_filter_and_score_match_a_naive_loop():
    closes = clustered_ohlc_random_walk(180)["Close"].to_numpy()
    returns = np.diff(np.log(closes))[None, :]
    drivers = 0.5 * np.log(returns ** 2 + 1e-4)
    theta = np.array([[-4.2, 0.95, 0.03, 0.02, 0.15, 0.1]])
    ones = np.ones_like(returns)
    nll, gradient, _, levels, _, _ = score_driven._filter(theta, returns, drivers, ones, ones)
    naive_levels, naive_nll = _naive_beta_t_path(theta[0], returns[0], drivers[0])

    np.testing.assert_allclose(levels[0], naive_levels, rtol=1e-12)
    assert nll[0] == pytest.approx(naive_nll, rel=1e-12)
    for index in range(6):
        step = np.zeros_like(theta)
        step[0, index] = 1e-6
        upper = score_driven._filter(theta + step, returns, drivers, ones, ones, want_grad=False)[0][0]
        lower = score_driven._filter(theta - step, returns, drivers, ones, ones, want_grad=False)[0][0]
        assert gradient[0, index] == pytest.approx((upper - lower) / 2e-6, rel=1e-4, abs=1e-4)


def test_kriging_weights_solve_the_noisy_matern_system():
    H, lam, s2, e2, K = 0.1, 0.01, 1.2, 0.3, 40
    weights, variances = rough.kriging_weights(H, lam, s2, e2, K)
    lags = np.arange(K)
    covariance = rough.matern_rho(np.abs(lags[:, None] - lags[None, :]), H, lam) + (e2 / s2 + 1e-9) * np.eye(K)
    for step in (1, 5, 20):
        target = rough.matern_rho(step + lags, H, lam)
        np.testing.assert_allclose(covariance @ weights[step - 1], target, rtol=1e-9, atol=1e-12)
        assert variances[step - 1] == pytest.approx(s2 * (1.0 - target @ weights[step - 1]), rel=1e-9)
    # Matern smoothness 1/2 is the exponential correlation exp(-lam k).
    np.testing.assert_allclose(rough.matern_rho(np.arange(0, 200, 7), 0.5, 0.03),
                               np.exp(-0.03 * np.arange(0, 200, 7)), rtol=1e-12)


def test_boa_concentrates_on_the_calibrated_expert():
    closes = clustered_ohlc_random_walk(800, alpha=0.0, beta=0.0, seed=11)["Close"].to_numpy()
    true_scale = 0.02 * math.sqrt(0.35 ** 2 + 0.9 ** 2) * np.sqrt(np.arange(1, 21))
    calibrated = np.tile(true_scale, (len(closes), 1))
    zero = np.zeros_like(calibrated)
    _, stds, diagnostics = crps_learning.crps_learning_combine(
        closes, {"calibrated": (zero, calibrated), "wide": (zero, 2.5 * calibrated)},
        location_experts={"zero": zero}, loc_prior=(1.0,))
    weights = diagnostics["weights"]

    assert (weights[:61] == 0.5).all()
    assert weights[-1, 0, 0] > 0.99
    assert weights[-1, 19, 0] > 0.99
    assert weights[400, 0, 0] > weights[200, 0, 0] > 0.9
    np.testing.assert_allclose(stds[-1], (weights[-1] * np.stack([calibrated[-1], 2.5 * calibrated[-1]], 1)).sum(1))


def test_boa_weights_at_an_origin_ignore_targets_that_mature_later():
    frame = clustered_ohlc_random_walk(320)
    closes = frame["Close"].to_numpy()
    zero = np.zeros((len(closes), 20))
    base = crps_learning.reference_scale_forecast(closes)
    experts = {"narrow": (zero, 0.8 * base), "wide": (zero, 1.3 * base)}
    locations = {"drift": np.tile(0.001 * np.arange(1, 21), (len(closes), 1)), "zero": zero}
    changed = closes.copy()
    cut = 200
    changed[cut + 1:] *= np.exp(np.cumsum(np.random.default_rng(5).normal(0.0, 0.05, len(closes) - cut - 1)))
    first = crps_learning.crps_learning_combine(closes, experts, location_experts=locations)[2]
    second = crps_learning.crps_learning_combine(changed, experts, location_experts=locations)[2]

    for key in ("weights", "loc_weights"):
        np.testing.assert_array_equal(first[key][:cut + 1], second[key][:cut + 1])
        assert not np.allclose(first[key][cut + 2:], second[key][cut + 2:])


def test_rolling_measures_match_naive_windows():
    values = clustered_ohlc_random_walk(300)["Close"].to_numpy()
    values = np.diff(np.log(values), prepend=np.nan)
    values[[10, 11, 150]] = np.nan
    median = measures.rolling_median(values, 30)
    mean = measures.rolling_mean(values, 7)
    loose = measures.rolling_mean(values, 7, min_periods=1)
    std = measures.rolling_std(values, 25, min_count=20)
    for t in range(len(values)):
        window = values[max(0, t - 29):t + 1]
        present = window[~np.isnan(window)]
        assert (np.isnan(median[t]) if not len(present) else median[t] == np.median(present))
        short = values[max(0, t - 6):t + 1]
        short_present = short[~np.isnan(short)]
        if len(short_present) == 7:
            assert mean[t] == pytest.approx(short_present.mean(), rel=1e-12)
        else:
            assert np.isnan(mean[t])
        assert loose[t] == pytest.approx(short_present.mean(), rel=1e-12) if len(short_present) else np.isnan(loose[t])
        sample = values[max(0, t - 24):t + 1]
        sample = sample[np.isfinite(sample)]
        if len(sample) >= 20:
            assert std[t] == pytest.approx(np.std(sample, ddof=1), rel=1e-9)
        else:
            assert np.isnan(std[t])
    filled = measures.forward_fill(np.array([np.nan, 1.0, np.nan, np.nan, 3.0, np.nan]))
    np.testing.assert_array_equal(filled, [np.nan, 1.0, 1.0, 1.0, 3.0, 3.0])
    np.testing.assert_array_equal(measures.expanding_mean(np.array([np.nan, 2.0, np.nan, 4.0])),
                                  [np.nan, 2.0, 2.0, 3.0])


def test_variance_proxies_fall_back_on_unusable_bars():
    frame = clustered_ohlc_random_walk(40, zero_range_rows=(10,), missing_open_rows=(20,))
    arrays = prices_of(frame)
    proxy, gap, log_range, returns = measures.parkinson_gap_variance(*arrays)
    assert np.isnan(proxy[0])
    assert proxy[20] == pytest.approx(returns[20] ** 2)
    assert proxy[10] == pytest.approx(0.0, abs=1e-30)
    expected = gap[5] ** 2 + log_range[5] ** 2 / (4 * math.log(2))
    assert proxy[5] == pytest.approx(expected, rel=1e-14)
    floored = measures.floor_at_rolling_median(proxy)
    window = proxy[1:11]
    assert floored[10] == pytest.approx(0.05 * np.median(window[window > 0]), rel=1e-12)  # zero proxies never set it
    log_variance = rough.log_variance_proxy(*arrays, "yz")
    raw = measures.open_anchored_variance(*arrays, kind="yz")
    usable = np.isfinite(raw) & (raw > 0)
    assert not usable[10] and not usable[20]
    assert np.isfinite(log_variance).all()
    for row in (10, 20):
        assert log_variance[row] == pytest.approx(math.log(np.median(raw[:row + 1][usable[:row + 1]])), rel=1e-12)
    close_only = rough.log_variance_proxy(*arrays, "r2")
    assert close_only[0] == rough.DEFAULT_LOG_VARIANCE
    for row in (5, 30):
        squares = returns[1:row + 1] ** 2
        expected = max(returns[row] ** 2, 0.05 * np.median(squares))
        assert close_only[row] == pytest.approx(math.log(expected), rel=1e-12)


@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
def test_har_keeps_identically_zero_regressors_at_their_prior(use_range):
    dates = pd.bdate_range("2025-01-02", periods=160).strftime("%Y-%m-%d").tolist()
    rising = ohlc_frame_for_dates("NVDA", dates)
    variance, info = har.har_variance(*prices_of(rising), use_range=use_range, window=63, refit=63,
                                      return_info=True)
    assert np.isfinite(variance[22:]).all() and (variance[22:] > 0).all()
    fitted = info["ok"][-1]
    assert fitted.any()
    np.testing.assert_allclose(info["beta"][-1][fitted][:, 5:], 0.0, atol=1e-9)


@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
def test_har_insanity_filter_bounds_a_price_jump_in_a_short_window(use_range):
    dates = pd.bdate_range("2024-01-02", periods=300).strftime("%Y-%m-%d").tolist()
    jumped = oscillating_ohlc_frame_for_dates("NVDA", dates)
    jumped.loc[244:, list(PRICE_COLUMNS)] *= 1.5
    arrays = prices_of(jumped)
    bounded = har.har_variance(*arrays, use_range=use_range, window=63, refit=63)
    unbounded = har.har_variance(*arrays, use_range=use_range, window=63, refit=63, insanity_margin=None)
    rows = np.arange(22, len(jumped))
    assert np.isfinite(bounded[rows]).all() and (bounded[rows] > 0).all()
    # Never more than ten times the largest matured h-day mean proxy (ln 1.5 squared is the jump day).
    assert np.max(np.sqrt(bounded[rows] / np.arange(1, 21))) < math.sqrt(10.0) * math.log(1.5) * 1.01
    assert np.max(bounded[rows]) <= np.max(unbounded[rows])


def test_har_insanity_filter_is_inactive_on_ordinary_data():
    arrays = prices_of(clustered_ohlc_random_walk(700))
    for use_range in (True, False):
        np.testing.assert_array_equal(
            har.har_variance(*arrays, use_range=use_range),
            har.har_variance(*arrays, use_range=use_range, insanity_margin=None),
        )


def test_score_driven_fit_batches_do_not_change_the_forecasts(monkeypatch):
    arrays = prices_of(clustered_ohlc_random_walk(260))
    whole = score_driven.score_driven_sigma(*arrays, refit=7)
    monkeypatch.setattr(score_driven, "MAX_FITS_PER_BATCH", 3)
    batched = score_driven.score_driven_sigma(*arrays, refit=7)
    np.testing.assert_array_equal(whole, batched)


@pytest.mark.parametrize("bad_close", (0.0, math.nan, math.inf), ids=("zero", "missing", "infinite"))
@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
@pytest.mark.parametrize("model", tuple(MODELS))
def test_one_bad_close_removes_only_the_rows_that_touch_it(model, use_range, bad_close):
    clean = clustered_ohlc_random_walk(420)
    damaged = clean.copy()
    damaged.loc[150, "Close"] = bad_close
    first_origin = MODELS[model][3]
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        reference = forecast(model, clean, use_range=use_range)
        result = forecast(model, damaged, use_range=use_range)

    assert np.isfinite(result.means).all()
    assert np.isfinite(result.stds[first_origin:]).all() and (result.stds[first_origin:] > 0).all()
    # Later fits exclude the damaged windows instead of losing every target after the bad bar.
    ratio = np.median(result.stds[-100:] / reference.stds[-100:], axis=0)
    assert (ratio > 0.8).all() and (ratio < 1.25).all(), ratio


@pytest.mark.parametrize("use_range", (True, False), ids=("range", "close-only"))
@pytest.mark.parametrize("model", tuple(MODELS))
def test_variance_floors_ignore_zero_proxies_on_an_illiquid_series(model, use_range):
    frame = illiquid_ohlc_random_walk(800, halted_share=0.55)
    proxy = measures.parkinson_gap_variance(*prices_of(frame))[0]
    assert np.mean(measures.rolling_median(proxy)[1:] == 0) > 0.5    # a plain median floor would collapse
    returns = np.diff(np.log(frame["Close"].to_numpy()))
    realized = math.sqrt(np.mean(returns[-400:] ** 2))

    result = forecast(model, frame, use_range=use_range, use_drift=False)

    assert 0.5 < np.median(result.stds[-400:, 0]) / realized < 2.0
    floored = measures.floor_at_rolling_median(proxy)
    traded = int(np.flatnonzero(proxy > 0)[0])
    assert floored[traded:].min() > 1e-6                              # never the 1e-8 absolute floor once traded


def test_positive_median_floor_matches_the_plain_floor_without_zero_proxies():
    arrays = prices_of(clustered_ohlc_random_walk(400))
    proxy = measures.parkinson_gap_variance(*arrays)[0]
    assert (proxy[1:] > 0).all()
    plain = np.maximum(proxy, np.maximum(0.05 * measures.rolling_median(proxy), 1e-8))
    np.testing.assert_array_equal(measures.floor_at_rolling_median(proxy), plain)


def test_session_refit_origins_follow_dates_not_the_first_loaded_row():
    dates = pd.bdate_range("2019-12-02", periods=300).to_numpy()
    dates = np.delete(dates, [37, 38, 120])                           # holidays shorten a block
    origins = measures.session_refit_origins(dates, 20)
    blocks = np.busday_count(measures.REFIT_EPOCH, dates.astype("datetime64[D]")) // 20
    assert origins[0] == 0
    np.testing.assert_array_equal(blocks[origins[1:]] - blocks[origins[1:] - 1], 1)
    for skipped in (1, 7, 19, 20, 45):
        later = measures.session_refit_origins(dates[skipped:], 20) + skipped
        np.testing.assert_array_equal(later[1:], origins[origins > skipped])
    np.testing.assert_array_equal(measures.session_refit_origins(dates, 1), np.arange(len(dates)))
    np.testing.assert_array_equal(measures.refit_schedule(10, 4), [0, 4, 8])
    np.testing.assert_array_equal(measures.refit_schedule(10, 4, np.array([3, 12, 7])), [0, 3, 7])
    with pytest.raises(ValueError, match="chronological"):
        measures.session_refit_origins(dates[::-1], 20)


def test_explicit_refit_origins_reproduce_the_index_grid():
    arrays = prices_of(clustered_ohlc_random_walk(300, missing_open_rows=(120,)))
    count = len(arrays)
    np.testing.assert_array_equal(har.har_variance(*arrays, refit=20),
                                  har.har_variance(*arrays, refit=20, refit_origins=np.arange(0, count, 20)))
    np.testing.assert_array_equal(rough.rough_sigma(*arrays, refit=20),
                                  rough.rough_sigma(*arrays, refit=20, refit_origins=np.arange(0, count, 20)))
    anchor = score_driven.MIN_BARS - 1
    np.testing.assert_array_equal(score_driven.score_driven_sigma(*arrays, refit=20),
                                  score_driven.score_driven_sigma(*arrays, refit=20,
                                                                  refit_origins=np.arange(anchor, count, 20)))


def test_score_driven_start_skips_only_fits_that_serve_earlier_origins():
    frame = clustered_ohlc_random_walk(300)
    arrays = prices_of(frame)
    origins = measures.session_refit_origins(frame["Date"].to_numpy(), 20)
    for refit_origins in (None, origins):
        whole, refits, _ = score_driven.score_driven_sigma(*arrays, refit_origins=refit_origins, return_params=True)
        start = 187
        skipped, kept, _ = score_driven.score_driven_sigma(*arrays, refit_origins=refit_origins, start=start,
                                                           return_params=True)
        np.testing.assert_array_equal(skipped[start:], whole[start:])
        assert np.isnan(skipped[:start]).all()
        assert kept[0] == refits[refits <= start][-1] and len(kept) < len(refits)
