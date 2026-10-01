# Econometric Price Field research

Documentation version: `v1.0.0`
Last reviewed: `1 Oct 2026`

## Scope and ownership

Four daily, single-ticker Price Field strategies forecast the probability grid
from econometric location and scale models instead of trained neural networks.
They are numpy-only, need no training slot or compute job, and run a
deterministic causal re-estimation inside every `compute_signals` call. Their
only market input is daily OHLCV from the warmup-inclusive Longbridge CLI
bundle; every provider factor (valuation, options, benchmarks, research
factors) is switched off when they load data. They appear under Price Field
Models after `tft-price-field`, default to the `NVDA` research ticker, support
only the `1d` interval, and reuse the existing `probability-grid-v1` renderer.

| Strategy ID | Name | Location | Scale | Default fit window | Default scale multiplier |
| --- | --- | --- | --- | ---: | ---: |
| `har-range-price-field` | HAR Range Price Field | Bayesian Sharpe drift | Direct log-HAR of a range-based variance proxy | 2,000 | 0.94 |
| `score-driven-price-field` | Score-Driven Price Field | Bayesian Sharpe drift | Range-augmented Beta-t-EGARCH | 1,000 | 0.96 |
| `rough-volatility-price-field` | Rough Volatility Price Field | Bayesian Sharpe drift | Noise-aware Matérn kriging of log variance | 2,000 | 0.94 |
| `crps-learning-price-field` | CRPS Learning Price Field | Learned mix of drift and zero | Online CRPS learning over the three scales | 2,000 (cap) | 1.00 |

| Path | Responsibility |
| --- | --- |
| `strategies/algorithms/strategy_{har_range,score_driven,rough_volatility,crps_learning}_price_field.py` | Discovery modules: ID, name, description, display order 55–58, and parameter title |
| `strategies/price_field/econometric/strategy.py` | `EconometricPriceFieldStrategy`: parameters, warmup-sized OHLCV loading, forecast masking, factor-switch entries, fingerprint, and presentation; one subclass per model |
| `strategies/price_field/econometric/forecasts.py` | Frozen compositions of location and scale, including the CRPS Learning assembly |
| `strategies/price_field/econometric/location.py` | Shared Bayesian Sharpe drift |
| `strategies/price_field/econometric/har.py`, `score_driven.py`, `rough.py` | The three scale models |
| `strategies/price_field/econometric/crps_learning.py` | Bernstein Online Aggregation combiner and the scorer's reference scale |
| `strategies/price_field/econometric/measures.py` | Returns, gaps, rolling helpers, daily variance proxies, positive-proxy floors, and refit schedules |
| `strategies/price_field/direct_horizon.py` | Prediction columns, next-session signals, visible-window scoring, geometry metadata, and probability-grid presentation shared with the eight neural adapters |

Every file above is at `Code version: v1.0.0`. Importing the strategy modules
loads neither the web application, Torch, nor the neural input module: the
shared `plain_market_bundle()` helper lives in
`strategies/price_field/pipeline.py`, and `strategies/price_field/neural/inputs.py`
only re-exports it. The presentation uses schema
`<strategy-id>/v1`, model version `<strategy-id>-model/v1.0.0`, distribution
kind `direct-normal-horizon`, and horizon mapping
`direct-estimated-1-through-20` (the neural models report
`direct-learned-1-through-20`). The browser keys direct-horizon behavior on the
distribution kind, so these models render through the same direct-horizon path
as the neural models. Results are not cached by Backtest (`backtest_cacheable = False`).

The [Price Field startup defaults](PRICE_FIELD_DEFAULTS.md) own startup-profile
provenance, the [Architecture guide](ARCHITECTURE.md) owns runtime boundaries,
and the [Testing guide](TESTING.md) owns commands and isolation.

## Forecast target and headline score

At every origin `t` each model forecasts Gaussian marginals
`N(MU[t, h-1], SIG[t, h-1]^2)` of `ln(C[t+h] / C[t])` for `h = 1..20`, using
bars up to `t` only. A row is kept only when all 20 means are finite and all 20
standard deviations are finite and positive; other rows become missing
forecasts.

The Backtest headline is the equal mean of the 20 horizon CRPS skills against a
causal zero-drift reference whose daily scale is the sample standard deviation
of the last 60 log returns (floored at 0.005), times `sqrt(h)`. The headline is
withheld unless all 20 horizons and every eligible origin-horizon pair inside
the visible range are scored, so a model must forecast every visible origin.
Hidden warmup rows supply history but never contribute scored outcomes.

## Shared location: Bayesian Sharpe drift

`location.py` implements the frozen round-2 drift:

```text
r_t        = ln(C_t / C_{t-1})
sigma_t    = std_ddof1 of the last <= 252 valid r (at least 20 needed)
z_t        = r_t / max(sigma_{t-1}, 1e-4)                  defined after bar 20
S_t, n_t   = sum and count of valid z over (t - W, t]
c_t        = (N0 * SR0 / sqrt(252) + S_t) / (N0 + n_t)     posterior mean daily Sharpe
mu_t       = c_t * sigma_t                                 daily mean log return, 0 through bar 20
MU[t, h-1] = h * mu_t
```

This is the normal-normal update of a daily Sharpe ratio with prior
`N(SR0 / sqrt(252), 1 / N0)` and unit-variance standardized returns; multiplying
by volatility turns the Sharpe ratio into a drift. Frozen defaults are
`SR0 = 0.6` (annual prior Sharpe), `N0 = 2520` prior pseudo-sessions, window
`W = 1260`, volatility window 252, burn-in 20, and volatility floor `1e-4`.
`drift_prior_sharpe`, `drift_prior_strength`, and `drift_window` are strategy
parameters; the volatility window, burn-in, and floor are fixed. With a full
window the prior still carries `2520 / (2520 + 1260)`, two thirds of the weight,
so the model behaves like a volatility-proportional 0.6 Sharpe prior with a
one-third data update. With about 160 bars the prior carries about 95%. The
research's optional parameter-uncertainty inflation was neutral on the panel
and is not part of the product.

Primary sources: Merton (1980, *Journal of Financial Economics*), on tying the
risk premium to variance; James and Stein (1961) and Efron and Morris (1975,
*JASA*), on shrinkage; Jorion (1986, *JFQA*), Bayes-Stein means; Pástor and
Stambaugh (1999, *Journal of Finance*), informative priors on expected returns;
Campbell and Thompson (2008, *RFS*) and Welch and Goyal (2008, *RFS*), on the
difficulty of beating the historical mean.

## HAR Range

`har.py` fits one direct log-HAR regression per horizon on a range-based daily
variance proxy known at the close of bar `t`:

```text
x_t  = g_t^2 + R_t^2 / (4 ln 2),   g_t = ln(O_t / C_{t-1}),  R_t = ln(H_t / L_t)
xf_t = max(x_t, 0.05 * median(positive x over the last 252 bars), 1e-8)
Z_s  = [1, L_d, L_w, L_m, q, n1, n5]
  L_d = ln xf_s,  L_w = ln mean5(xf),  L_m = ln mean22(xf)
  q   = L_d * kappa_s,  kappa_s = sqrt(mean22 QE) / mean22 xf,
        QE_t = (2/3) g_t^4 + 0.4073 R_t^4 / (9 zeta(3))
  n1  = min(r_s, 0) / sqrt(mean22 xf),  n5 = mean5(min(r, 0)) / sqrt(mean22 xf)
ln mean(xf_{s+1..s+h}) = Z_s . beta_h                     for h = 1..20
V_{t,h} = h * exp(Z_t . beta_h + s_h^2 / 2),   SIG = k * sqrt(V)
```

Each regression uses matured rows `s` in `[tf - h - W + 1, tf - h]` (expanding
when shorter), where `tf` is the refit origin of the block that contains `t`
(see [Refit schedule and loaded history](#refit-schedule-and-loaded-history)),
with a ridge toward prior slopes `(0.2, 0.35, 0.45, 0, 0, 0)` of strength `50`
times each regressor's in-window variance and an unpenalized intercept. Frozen
defaults are `W = 2000`, refit 20, ridge strength 50, and `k = 0.94`. With fewer
than 60 matured rows the forecast falls back to
`V = h * (0.2 xf + 0.35 mean5 + 0.45 mean22)`. The first forecast origin is bar
22. With intraday range measures off, the model uses `x_t = r_t^2` and
`QE_t = (2/3) r_t^4`.

Four product guards sit outside the round-2 selection:

- **Positive-proxy floor.** The floor median ignores zero and non-finite
  proxies, so zero-range, zero-return sessions on a halted or tick-bound series
  cannot pull the floor down to `1e-8`. Where the trailing window holds no zero
  proxy the floor equals the plain rolling-median floor of the research module.
- **Degenerate regressors.** Every slope penalty is at least `1e-12`, so an
  identically zero regressor, such as a leverage term in a window without a down
  day, stays at its prior instead of making the system singular.
- **Bad bars.** A non-finite proxy, for example after a zero close, is missing;
  a target window that touches a missing proxy is not a matured row for that
  horizon, and a non-finite return adds no leverage term. One bad close
  therefore removes only the rows whose windows touch it rather than every
  later forecast. When rows are dropped this way, each horizon keeps its own
  cross products so both sides of its regression cover the same rows.
- **Insanity filter.** Each fitted log rate `Z_t . beta_h + s_h^2 / 2` is
  clipped to the minimum and maximum of the matured targets
  `ln mean(xf_{s+1..s+h})` in its own fit window, widened by `ln 10` on each
  side, after the insanity filter of Bollerslev, Patton, and Quaedvlieg (2016).
  On 1 Oct 2026 it was verified never to bind at the defaults on all 16 panel
  tickers, with intraday range measures on and off, on both the research index
  grid and the date-anchored refit grid. It binds in degenerate short windows:
  a +50% price jump inside a 63-session fit window previously produced a scale
  near `2e7`.

Primary sources: Corsi (2009, *Journal of Financial Econometrics*), HAR;
Parkinson (1980, *Journal of Business*), range variance; Bollerslev, Patton, and
Quaedvlieg (2016, *Journal of Econometrics*), HARQ; Corsi and Renò (2012,
*JBES*), leverage HAR; Marcellino, Stock, and Watson (2006, *Journal of
Econometrics*), direct versus iterated forecasts.

## Score-Driven

`score_driven.py` implements a first-order score-driven Student-t log-scale
filter with a leverage term and an exogenous daily-range driver:

```text
r_t = exp(lambda_t) * eps_t,  eps_t ~ standard Student-t(nu)
b_t = (r_t^2 / (nu e^{2 lambda_t})) / (1 + r_t^2 / (nu e^{2 lambda_t}))
u_t = (nu + 1) b_t - 1,   s_t = sign(-r_t)
w_t = 0.5 ln x_t - c_W    (x_t: Parkinson plus overnight gap; c_W re-centers it on the window)
lambda_{t+1} = omega + phi (lambda_t - omega) + kappa u_t + kappa* s_t (u_t + 1) + delta (w_t - lambda_t)
V_h = sum_{k<=h} E_t[exp(2 lambda_{t+k})] * nu / (nu - 2),   SIG = k_mult * sqrt(V_h)
```

Parameters are fitted by penalized Student-t maximum likelihood on the trailing
fit window: first at bar 59 of the loaded history, then at every later refit
origin (see [Refit schedule and loaded history](#refit-schedule-and-loaded-history)).
All fits are solved at once by Levenberg-Marquardt with analytic score
recursions, BHHH curvature, and box projection (in batches of 256 fits, which is
bit-identical to one batch). The range proxy `x_t` uses the squared
close-to-close return on a bar with an inverted or unusable range and is floored
at 0.05 times the trailing 252-bar median of the positive proxies; the median of
the positive squared returns backs the floor up when no proxy in the window is
positive, and `1e-12` when neither is, so zero-range, zero-return sessions
cannot collapse it.

The Gaussian prior on `(phi, kappa, kappa*, 1/nu, delta)` is centered on panel
medians of unpenalized fits made on data before 2016-10-01; its standard
deviations are 0.1 times their cross-sectional spread, and `omega` has no prior.
The h-step expectation is closed form: it uses the in-window empirical
moment-generating function of the fitted innovations, or the exact Beta and
Kummer moments in the close-only fallback. Forecasts begin at bar 59 when every
fit is computed. Because fits are independent, the standalone strategy skips the
fits that serve only hidden warmup origins: rows before the first visible origin
stay empty, `first_forecast_origin` equals `first_visible_origin` in the
presentation diagnostics, `scale.refit_count` counts only the computed fits, and
every visible row and every other presentation field is identical to computing
all fits. The Score-Driven expert inside CRPS Learning still fits every refit,
because the learner scores its forecasts from bar 60.

Frozen defaults are window 1,000, prior scale 0.1, and `k_mult = 0.96`. With
intraday range measures off, the close-only Beta-t-EGARCH (`delta = 0`) uses its
own prior centers, prior scale 0.5, and multiplier 0.94. The strategy's
`scale_multiplier` maps onto that fallback as `multiplier * 0.94 / 0.96`, which
is exactly 0.94 at the default.

Primary sources: Harvey and Chakravarty (2008, Cambridge Working Papers in
Economics 0840), Beta-t-EGARCH; Harvey (2013, *Dynamic Models for Volatility
and Heavy Tails*, Cambridge University Press); Creal, Koopman, and Lucas (2013,
*Journal of Applied Econometrics*), score-driven models; Hansen, Huang, and Shek
(2012, *Journal of Applied Econometrics*) and Hansen and Huang (2016, *JBES*),
realized measures in GARCH and EGARCH.

## Rough Volatility

`rough.py` kriges a noisy daily log-variance proxy with a rough, mean-reverting
correlation:

```text
X_t = g^2 + kz c^2 + (1 - kz)[u(u - c) + d(d - c)]    Yang-Zhang single day, kz = 0.34 / 2.84
      (u = ln H/O, d = ln L/O, c = ln C/O, g = ln O_t/C_{t-1})
L_t = ln max(X_t, 0.05 * median(positive X over the last 252 bars))    non-positive or missing X take the median
L_t = mu + Lambda_t + eps_t,   Var(eps) = e2,  Var(Lambda) = s2
rho(k) = 2^{1-H} / Gamma(H) * (lam k)^H * K_H(lam k)          Gamma-kernel BSS / Matérn
E[L_{t+D}] = mu_t + w_D'(L_{t..t-249} - mu_t),   w_D = (R + (e2/s2) I)^{-1} r_D
v_D = s2 (1 - r_D' w_D),   V_h = sum_{D<=h} exp(E[L_{t+D}] + v_D / 2)
rho_h = (sum Y^2 + 750 rho0_h V_h(t)) / (sum V_h(s) + 750 V_h(t))    matured pairs only
SIG = k * sqrt(rho_h * V_h)
```

At every refit origin (see
[Refit schedule and loaded history](#refit-schedule-and-loaded-history)) the
variogram `m2(k) = a + b (1 - rho(k))` is fitted on the trailing fit window over
30 log-spaced lags from 1 to 250: `(H, lam)` on a fixed grid and `(a, b)` in
closed form, blended with a prior variogram through 100 pseudo-pairs per lag.
`mu_t` is the expanding mean of `L` from the first loaded bar, as frozen by the
research; the presentation reports it as `scale.log_variance_mean:
expanding-from-first-loaded-bar`. The fit window sets both the variogram window
and the proxy-to-close calibration window. Frozen
defaults are fit window 2,000, kriging depth 250, refit 20, and `k = 0.94`.
The Yang-Zhang priors (prior variogram and `rho0_h`) were estimated from panel
data up to 2016-09-30. With intraday range measures off, the product uses a
close-only `X_t = r_t^2` proxy whose priors were estimated with the same
procedure on the same pre-2016-10-01 panel data; this proxy is a product
extension, not a round-2 selection. Output is finite and positive from bar 0.

Primary sources: Gatheral, Jaisson, and Rosenbaum (2018, *Quantitative
Finance*), rough volatility; Bennedsen, Lunde, and Pakkanen (2022, *Journal of
Financial Econometrics*), Gamma-kernel Brownian semistationary volatility;
Barndorff-Nielsen and Schmiegel (2009), Brownian semistationary processes;
Alizadeh, Brandt, and Diebold (2002, *Journal of Finance*), noise in the log
range; Yang and Zhang (2000, *Journal of Business*); Stein (1999,
*Interpolation of Spatial Data*), kriging.

## CRPS Learning

`crps_learning.py` combines Gaussian experts by quantile averaging
(Vincentization) with Bernstein Online Aggregation on the linearized CRPS:

```text
MU = sum_k v_k MU_k    (location experts: drift, zero)
SIG = sum_j w_j SIG_j  (scale experts: HAR Range, Score-Driven, Rough Volatility)
z = (y - MU) / SIG,   R = sigma60[s] * sqrt(h)
scale regret     (2 phi(z) - 1/sqrt(pi)) SIG_j / R, smoothed across horizons (Whittaker, lambda 10)
location regret  -(2 Phi(z) - 1) MU_k / R, pooled across horizons
L <- rho L + l + eta l^2,   weights ∝ prior * exp(-eta L)
```

Feedback is delayed: the forecast issued at origin `s` for horizon `h` is scored
at `s + h` with the weights in force at `s`, so row `t` uses bars up to `t`
only. The scale learner uses per-horizon weights with `eta = 0.5`,
`rho = 0.999`, a uniform prior, and no fixed share. The location learner uses
`eta = 2`, `rho = 0.9995`, prior `(0.95 drift, 0.05 zero)`, and a 0.1 fixed share
toward that prior. Learning starts at bar 60 of the loaded history, and the
weights accumulate from there, as frozen by the research; the presentation
reports this as `scale.learning_state: accumulated-from-first-loaded-bar`. Each
scale expert computes all of its fits over the loaded history, keeps its own
frozen multiplier (0.94, 0.96 or 0.94 close-only, and 0.94), fits on the smaller
of its own default window and the strategy fit window, and falls back to
`sigma60 * sqrt(h)` where it has no forecast yet. With the drift off, zero is the
only location expert. The strategy exposes the scale learner's `learning_rate`
and `forgetting`; its `scale_multiplier` (default 1.0) scales the combined
standard deviation. The presentation reports the latest and trailing-252 mean
weights for horizons 1 and 20.

Round 2 chose the combiner settings over six simpler experts (EWMA 0.94 and
0.97, HAR-Parkinson, GARCH, GJR-GARCH, and an RFSV model); round 3 then
selected the expert set `{HAR Range, Score-Driven, Rough Volatility}` with
location learning on the same panel window. The location fixed share is one
recorded deviation: the strict argmax was 0 (panel pre-window 2.589%), and a
pre-window neighbor-stability check chose 0.1 (2.586%) because one grid step
away from the argmax lost 0.19 pp.

Primary sources: Berrisch and Ziel (2023, *Journal of Econometrics*), CRPS
learning; Wintenberger (2017, *Machine Learning*), BOA; Genest (1992, *Annals of
Statistics*), Vincentization; Herbster and Warmuth (1998, *Machine Learning*),
fixed share; Joulani, György, and Szepesvári (2013, ICML), delayed feedback;
Gneiting and Raftery (2007, *JASA*), closed-form Gaussian CRPS for every model.

## Refit schedule and loaded history

`compute_signals` passes the session dates of the loaded history with the prices
(`PriceArrays.dates`). A refit then starts on row 0 and on every row where
`busday_count(2000-01-03, date) // refit interval` changes: fixed blocks of
`refit interval` weekdays counted from a constant Monday epoch
(`measures.REFIT_EPOCH`), which exchange holidays and missing sessions only
shorten. HAR Range, Score-Driven (after its first fit at bar 59), Rough
Volatility, and the CRPS Learning experts all use this schedule. Pure-array
callers that pass no dates keep the research index grid `0, refit, 2 refit, ...`
and reproduce the frozen research modules. The presentation diagnostics report
`econometric.refit_schedule` (`session-date-blocks` on the strategy path,
`row-index-grid` otherwise) and `econometric.first_visible_origin`, the first
visible row of the loaded history. The `Refit interval` parameter is therefore
expressed in weekdays rather than sessions: a block always spans the same
business days, and holidays only shorten it.

Because a session's refit origin depends only on its date:

- **HAR Range and Score-Driven do not depend on the loaded start** once their fit
  windows lie inside the loaded history. Score-Driven is bit-identical; HAR
  Range can differ only by prefix-sum rounding (its adapter test allows a
  `1e-10` relative difference). The warmup request (see **Warmup** under
  [Limitations](#limitations)) reaches back over the refit block that holds the
  first visible origin, so the HAR Range forecasts on the first visible rows do
  not depend on the typed start date either. The final NVDA CLI runs below
  returned the same full-window values, agreeing within `1e-13`, from
  `--from 2023-10-01` and `--from 2023-10-02`; for HAR Range the two runs loaded
  histories one daily row apart for the same visible sessions.
- **Rough Volatility and CRPS Learning depend slightly on the loaded start, by
  design.** The frozen expanding log-variance mean and the BOA weights both
  accumulate from the first loaded bar. The same two NVDA runs scored 3.3149 and
  3.3156 for Rough Volatility, whose rounded headline therefore moves from 3.31
  to 3.32, and 3.1961 and 3.1978 for CRPS Learning. For the same reason, the
  larger warmup request introduced later on 1 Oct 2026 moved these two models'
  values while leaving HAR Range and Score-Driven unchanged. A rolling
  log-variance mean would remove the Rough Volatility dependence but is not the
  selected specification.

The Backtest sizes warmup from its typed `From` date, so two Backtests of the
same visible sessions whose `From` dates differ, such as a weekend date and the
next trading date, can load different first bars.

## Frozen selection protocol

The startup defaults are frozen research specifications, not NVDA GA
selections:

- Panel: NVDA, QQQ, SMH, SPY, AAPL, MSFT, MU, AVGO, TSM, ORCL, QCOM, GOOGL, JPM,
  IBM, VZ, and C daily history.
- Selection: every hyperparameter, multiplier, and model choice is the argmax of
  the panel mean CRPS skill over the pre-window 2016-10-01 through 2023-09-30,
  except the CRPS Learning tie-break recorded above.
- KPI isolation: the NVDA three-year window from 2023-10-01 is reported and
  never used to select. NVDA-favored settings seen during research are recorded
  as in-sample and not selectable.
- Priors: the Score-Driven prior centers and spreads and the Rough Volatility
  prior variograms and proxy-to-close ratios use only data before 2016-10-01,
  so they are out of sample for both the selection and KPI windows. The drift's
  `SR0` and `N0` are grid choices on the pre-window.
- Staging: round 2 selected each scale model with a common reference drift (the
  trailing 1,000-session mean return) and selected the drift with a common
  reference scale. Round 3 composed the frozen parts with the frozen drift and
  chose only the CRPS Learning expert set.
- Checks: each research method passed a prefix-invariance check (a row computed
  on bars up to its origin equals the same row on the full series), and the
  research scorer matched the official scorer on the NVDA KPI window within
  `1e-9`. On the research index grid with intraday range measures on, the
  product modules reproduce the research modules within `1.5e-12` relative on
  NVDA, QQQ, and SMH (Score-Driven is bit-exact). The strategy path departs
  from that parity in two documented ways: it refits on date-anchored blocks,
  and its positive-proxy floors differ from the research floors where a
  trailing window holds a zero proxy, such as a zero close-to-close return in
  close-only mode.

## Evidence

All values below are CRPS skill percentages against the zero-drift `sigma60`
reference. Research fractions are shown times 100.

### Research harness, computed 1 Oct 2026

Round-3 compositions with the frozen drift, full local history:

| Model | Panel pre mean | Panel pre median | NVDA pre | NVDA 3y | Panel 3y |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.92 × EWMA(0.94) scale, reference only | 1.91 | 2.11 | 2.90 | 3.30 | 1.97 |
| HAR Range | 3.09 | 3.43 | 3.89 | 3.12 | 3.02 |
| Score-Driven | 3.14 | 3.43 | 4.01 | 2.62 | 2.91 |
| Rough Volatility | 3.08 | 3.30 | 3.94 | 3.32 | 2.83 |
| **CRPS Learning, selected** (three experts, location learning) | **3.22** | 3.51 | 4.00 | 3.23 | 3.01 |
| Three experts, scale learning only | 3.18 | 3.51 | 4.01 | 3.24 | 3.04 |
| Geometric mean of the three scales | 3.19 | 3.52 | 4.05 | 3.14 | 3.02 |
| Five experts (adds EWMA 0.94 and 0.97), location learning | 3.16 | 3.47 | 3.92 | 3.39 | 3.00 |
| Five experts, scale learning only | 3.12 | 3.47 | 3.92 | 3.40 | 3.02 |

The five-expert rows score higher on NVDA alone but lower on the panel
pre-window, so they were not selected. The simple EWMA reference matches the
new models on NVDA while trailing them by more than 1 pp on the panel, which is
why NVDA alone cannot discriminate between scale models.

Round-2 component selection (panel pre-window mean, each with its common
reference):

| Component | Frozen choice | Comparators |
| --- | ---: | --- |
| Drift, reference scale | 2.67 | trailing 2,000-session mean 2.45; zero drift 1.33 |
| HAR Range, reference drift | 2.68 | first-round HAR 2.43; EWMA(0.94) 1.56 |
| Score-Driven, reference drift | 2.72 | close-only fallback 2.60; first-round core 2.29 |
| Rough Volatility, reference drift | 2.66 | 0.92 × EWMA(0.94) 1.55; 0.92 × HAR-Parkinson 2.40 |
| CRPS Learning over six simple experts | 2.59 | equal-weight geometric mean 2.45 |

### Product CLI, 1 Oct 2026

Final offline runs at 07:21 CST on 1 Oct 2026, after the refit-schedule,
floor, bad-bar, insanity-filter, warmup-sizing, and CLI fixes described in this
document, on a scratch copy of the local NVDA daily store (SHA-256 prefix
`309623bf2cf0cb1a`, unchanged from the earlier runs), which ends on 2026-09-21:

```bash
python3 -B scripts/strategy_tune.py --offline --strategy <id> --ticker NVDA \
  --from 2023-10-01 --to 2026-09-30 --objective crps-skill --bounds '{}' \
  --trials 1 --output <new scratch directory>
```

Each strategy also ran with `--from 2023-10-02`. The full window is 2023-10-02
through 2026-09-21 (745 sessions); every run completed, scored 14,690 of 14,690
pairs, and recorded `full_window.history_basis: exact-range-backtest-load`.
The strategies requested 2,287 warmup bars before the window (1,693 for
Score-Driven); see **Warmup** under [Limitations](#limitations).

| Strategy | `full_window` `crps_skill_pct` | Headline | h1 | h5 | h10 | h20 | 80% interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `har-range-price-field` | 3.1167 | 3.12 | 1.45 | 2.14 | 3.07 | 4.65 | 82.89 |
| `score-driven-price-field` | 2.6402 | 2.64 | 1.34 | 2.04 | 2.51 | 3.92 | 84.91 |
| `rough-volatility-price-field` | 3.3149 | 3.31 | 1.49 | 2.09 | 3.14 | 5.24 | 81.45 |
| `crps-learning-price-field` | 3.1961 | 3.20 | 1.57 | 2.21 | 3.06 | 4.82 | 83.13 |

With `--from 2023-10-02`, HAR Range and Score-Driven returned the same values
(within `1e-13`). Rough Volatility returned 3.3156 (headline 3.32; h1 1.49, h5
2.08, h10 3.14, h20 5.24; coverage 81.42), and CRPS Learning returned 3.1978
(headline 3.20; h1 1.57, h5 2.21, h10 3.07, h20 4.82; coverage 83.12); see
[Refit schedule and loaded history](#refit-schedule-and-loaded-history).
A Backtest reproduces a `full_window` value when its From and To dates are the
typed `--from` and `--to`.

Earlier runs of the same command are superseded. At 06:08 CST, before the
warmup request grew to its current size, HAR Range and Score-Driven returned
the values above, while Rough Volatility returned 3.2985 (headline 3.30) and
CRPS Learning 3.1819 (headline 3.18); only the start-dependent Rough Volatility
log-variance mean and CRPS Learning learning state changed. Before the other
fixes, the command had returned headlines of 3.12, 2.67, 3.33, and 3.19
(pre-fix CLI, 1 Oct 2026, 04:24 to 05:14 CST). The changes from those pre-fix
values come from the date-anchored refit grid and, for Rough Volatility and
CRPS Learning, also from the larger warmup; the floor, bad-bar, and
insanity-filter guards leave these NVDA forecasts with intraday range measures
on unchanged.

The same runs also scored the CLI's own chronological windows, which show how
strongly skill depends on the regime. These values are session-basis
(`history_basis: session-bundle-clipped-at-fold-end`): each window's model sees
the run's single warmup-inclusive load clipped at that window's last date, not a
Backtest loaded for the window's own dates. With `--bounds '{}'` the run loads
the startup parameters themselves, so every window scores the same
configuration as the full window. Values are from the final `--from 2023-10-01`
runs; with `--from 2023-10-02` the Rough Volatility and CRPS Learning holdouts
were 1.104 and 0.846. The Bayesian row is from the pre-fix CLI run described
below.

| Strategy | Validation 2025-03-27 to 2025-09-05 | Validation 2025-09-08 to 2026-02-17 | Holdout 2026-02-18 to 2026-09-21 |
| --- | ---: | ---: | ---: |
| HAR Range | 13.19 | −4.15 | 0.27 |
| Score-Driven | 12.73 | −6.83 | −0.24 |
| Rough Volatility | 12.55 | −1.53 | 1.10 |
| CRPS Learning | 12.87 | −3.57 | 0.84 |
| Bayesian | 1.81 | −7.41 | 1.81 |

The research-harness NVDA 3y values differ slightly from the product values
because the harness uses the complete local history as warmup and refits on the
row-index grid from its own first bar.

### Comparison with the existing Price Field strategies

The 11 existing strategies ran through the same offline CLI command with their
startup defaults on 1 Oct 2026 between 04:24 and 05:14 CST, before the fixes;
with `--bounds '{}'` the fixes do not change their `full_window` values. Every
run completed and scored 14,690 of 14,690 pairs on the same window. The four
new models' rows are from the final 07:21 CST `--from 2023-10-01` runs. The
holdout column is session-basis, as described above.

| Strategy | Full-window headline | h1 | h5 | h10 | h20 | 80% interval coverage | Holdout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rough Volatility (new) | 3.31 | 1.49 | 2.09 | 3.14 | 5.24 | 81.45 | 1.10 |
| CRPS Learning (new) | 3.20 | 1.57 | 2.21 | 3.06 | 4.82 | 83.13 | 0.84 |
| HAR Range (new) | 3.12 | 1.45 | 2.14 | 3.07 | 4.65 | 82.89 | 0.27 |
| Score-Driven (new) | 2.64 | 1.34 | 2.04 | 2.51 | 3.92 | 84.91 | −0.24 |
| LSTM | 1.98 | −2.49 | 1.08 | 1.99 | 4.23 | 83.21 | 2.33 |
| Cycle of Price Action | 1.95 | −1.26 | 0.81 | 1.81 | 4.25 | 84.49 | 1.62 |
| Bayesian | 1.83 | −1.23 | 0.63 | 1.64 | 4.19 | 84.47 | 1.81 |
| TSMixer | 1.57 | −1.27 | 0.61 | 1.15 | 3.05 | 80.33 | 0.29 |
| TFT | 1.49 | −1.59 | 0.15 | 1.14 | 4.19 | 81.79 | 0.69 |
| ModernTCN | 1.25 | −1.60 | 0.24 | 1.07 | 3.05 | 80.48 | 0.87 |
| N-HiTS | 1.06 | −1.80 | −0.52 | 0.75 | 2.85 | 75.44 | −0.16 |
| TimeXer | 0.62 | −0.82 | 0.49 | 0.31 | 0.74 | 78.87 | 0.86 |
| PatchTST | 0.12 | −1.55 | −0.63 | 0.31 | 0.93 | 78.80 | 2.16 |
| iTransformer | −0.91 | −1.80 | −0.93 | −1.13 | −0.53 | 76.98 | 0.53 |
| TiDE | −1.17 | −1.25 | −0.28 | 0.14 | −1.43 | 75.57 | 0.17 |

Read this table with its limits:

- **The full-window lead does not hold on the holdout.** The full window
  overlaps the validation and holdout windows and is reporting-only. On the
  untouched 149-session holdout, LSTM (2.33), PatchTST (2.16), and Bayesian
  (1.81) beat the best new model, Rough Volatility (1.10), and Score-Driven was
  negative. One short, single-regime slice is weak evidence either way, but the
  new models' full-window lead is not out-of-sample evidence that they are
  better. LSTM (1.98) is the best existing strategy on the full window.
- Offline, the existing strategies ran without the provider factors that a
  local-store run cannot build, such as valuation, option, turnover,
  illiquidity, and benchmark inputs, depending on the strategy; the models report
  those factors as `insufficient` (or `unavailable_point_in_time` for P/E) and
  leave them out. Their profiles were selected on NVDA with live factors. The
  new models use no provider factors, so offline mode does not remove any of
  their inputs.
- The new models' main advantage is at short horizons, where every existing
  model has negative h1 skill.
- Hand-specified causal drift baselines on the same window scored 2.94
  (half the trailing 252-session mean log return with the reference scale) and
  3.16 (the same drift with the average of the reference and EWMA(0.94) scales).
  Those settings were not chosen by the frozen panel protocol, so they are
  context rather than competitors, but they show that a simple positive drift
  already reaches this range on NVDA.

## Limitations

- **Most of the KPI gain is the positive drift, a bull-regime bet.** With the
  research reference scale, the frozen drift scores 3.45 on NVDA 3y against 0.50
  for zero drift. Both the selection window and the KPI window were mostly bull
  markets. In bear windows every positive drift loses to zero drift (research
  reference scale, frozen drift versus zero drift):

  | Window | NVDA | QQQ | SMH | SPY |
  | --- | --- | --- | --- | --- |
  | 2021-11-22 to 2022-10-14 | −6.22 vs −1.07 | −5.20 vs −0.95 | −5.60 vs −0.79 | −3.73 vs −0.76 |
  | 2007-10-01 to 2009-03-09 | −3.08 vs −0.37 | −0.97 vs +1.56 | −0.52 vs +1.28 | −1.78 vs +2.00 |

  In the round-2 CRPS Learning study the location learner behaved like a slow
  per-ticker switch (weights near 0.10 or 0.99, a memory of about 2,000
  origins) and did not react to the 2022 bear market. The product's second CLI
  validation window was negative for all four new models and for 10 of the 11
  existing strategies. With `use_drift` off the
  models give a zero-mean, regime-neutral scale forecast. The research panel used
  price-only closes, so the price-return Sharpe prior over-predicted for a
  high-yield stock (VZ scored below the trailing-mean drift on the pre-window).
- **Differences between the four models on NVDA alone are within noise.** Paired
  block-bootstrap standard errors (60-day blocks) of NVDA 3y differences between
  scale models were about 0.2 to 0.8 pp in the round-2 reports; for example,
  Score-Driven trailed the first-round core by 0.76 pp with a 0.57 pp standard
  error, and HAR Range differed from 0.92 × EWMA(0.94) by −0.06 pp with a
  0.59 pp standard error. The largest product gap among the four, 0.67 pp between
  Rough Volatility and Score-Driven, is about one such standard error. Overlapping
  origins and horizons are not independent observations. The panel pre-window,
  not the NVDA KPI, is the selection evidence.
- **Offline versus live data.** The KPI runs read the local daily store, which
  ended on 2026-09-21. A live Backtest loads forward-adjusted Longbridge CLI
  bars, which may differ in adjustment and will score later sessions, so live
  results can differ in either direction. Compare runs only under the same
  connectivity.
- **Warmup.** The strategy requests `base + ceil(0.08 * base) + 60` bars before
  the first visible date, where
  `base = max(fit window + refit interval + 42, drift window + 252)`: 2,287 by
  default for HAR Range, Rough Volatility, and CRPS Learning and 1,693 for
  Score-Driven. The 42 bars cover the longest target (20) and the monthly
  aggregate (22) behind the fit of the refit block that holds the first visible
  origin, so the HAR Range forecasts on the first visible rows do not depend on
  the typed start date. The bundle loader adds two bars and converts the request
  to calendar days with a 7/5 weekday ratio plus 14 days, which does not count
  exchange holidays; the 8% allowance (`WARMUP_HOLIDAY_ALLOWANCE`) covers
  holiday-dense calendars such as Hong Kong, and the 60-bar margin
  (`WARMUP_MARGIN_BARS`) covers the 22-session aggregates and 20-session
  targets. With less history the models
  degrade gradually instead of failing: HAR Range uses every matured row and its
  ridge prior, falling back to fixed HAR weights below 60 rows; Score-Driven fits
  on all available bars under its prior; Rough Volatility leans on its prior
  variogram and calibration ratios; the drift reverts toward its prior; and the
  CRPS Learning location learner needs about 2,000 bars before it moves far from
  its prior. Forecasts begin at bar 22 (HAR Range), 59 (Score-Driven), 0 (Rough
  Volatility), or 60 (CRPS Learning) of the loaded history, and the drift is zero
  through bar 20. With warmup loaded, standalone Score-Driven leaves the hidden
  warmup rows empty because it skips their fits. A Backtest whose first visible
  origin has no complete forecast withholds its headline. In research
  short-history checks, Rough Volatility with zero drift scored 0.51, 1.55, and
  2.21 on 160-, 400-, and 1,000-bar histories (0.92 × EWMA(0.94): −0.02, 0.81,
  1.16), and Score-Driven with its prior scored 0.58 on 400-bar sub-series
  (−52 without the prior).
- **Factor switches.** `use_drift` (Location) replaces the drift with a zero
  mean. `use_intraday_range` (Realized measures) switches every variance proxy
  to close-to-close returns: HAR Range regresses on `r^2`, Score-Driven uses the
  close-only Beta-t-EGARCH, Rough Volatility uses the close-only proxy and its
  priors, and CRPS Learning combines those close-only experts. The
  presentation's factor list reports whether the forecast uses each enabled
  input: a switch is `active` and selected when the model uses its input at
  least once, and `insufficient` (ineligible) when it never does. Its
  `finite_observations` counts origins whose mean comes from the drift (past the
  20-session burn-in once the 252-session volatility is defined, through the
  prior alone before any standardized return is observed, so a 21-session
  history is `insufficient` and a 22-session history `active`) or sessions with
  finite, positive open, high, low, and close, `H >= L`, and a previous close.
  Research-harness results on 1 Oct 2026 (panel pre-window / NVDA 3y, range
  measures on versus off):

  | Model | Range on | Close-only |
  | --- | --- | --- |
  | HAR Range | 3.09 / 3.12 | 2.93 / 3.00 |
  | Score-Driven | 3.14 / 2.62 | 3.01 / 2.89 |
  | Rough Volatility | 3.08 / 3.32 | 2.28 / 3.45 |
  | CRPS Learning | 3.21 / 3.23 | 3.05 / 3.28 |

  Close-only Rough Volatility is clearly weaker on the panel even though it
  scores higher on NVDA alone.
- **Gaussian marginals, not joint paths.** Each horizon is a separate Gaussian
  marginal of the cumulative log return. The 20 columns are not a simulated
  path, carry no dependence structure across horizons, and have no skew or fat
  tails; the Score-Driven model uses the Student-t variance but still reports a
  Gaussian marginal. On NVDA 3y the calibrated research models overstated
  20-day variance (realized-to-forecast variance ratio about 0.73). In the
  final product CLI runs the four new models' full-window 80% interval coverage
  was 81.45% to 84.91%, and every validation and holdout window covered more
  than the same model's full window, that is, intervals that were often too
  wide.
- **Illiquid or tick-bound series.** The positive-proxy floors keep zero-range,
  zero-return sessions from collapsing the HAR Range and Score-Driven variance
  floors, and Rough Volatility already treats zero proxies as missing. On a
  synthetic series with 55% halted sessions the model test requires every
  model's median 1-day scale to stay within 0.5 and 2 times the realized
  volatility, with intraday range measures on and off. That bounds, but does
  not establish, calibration on such series.
- **Trading signals are a compatibility display.** Buy intent is emitted when
  the horizon-1 probability of a positive return reaches `entry_probability`
  (default 60%), and sell intent when it falls to `100% − entry_probability` or
  below. A 0.6 annual Sharpe drift moves that probability only slightly above
  50%, so in the 1 Oct 2026 KPI runs none of the four models took a position in
  any scored window (net return 0.0%, drawdown 0.0%). The objective is forecast
  quality, not trading profit.
- **Scope.** The panel contains US large caps and ETFs; other asset classes and
  markets are untested. The CRPS Learning decoupled location and scale weighting
  is an extension of, not a reproduction of, Berrisch and Ziel's algorithm.

## Verification

Focused model, adapter, and CLI tests (conftest isolates the stores):

```bash
./scripts/test.sh -q -p no:cacheprovider \
  tests/python/strategies/test_econometric_price_field_models.py \
  tests/python/strategies/test_econometric_price_field_strategy.py
./scripts/test.sh -q -p no:cacheprovider \
  tests/python/tooling/test_strategy_tune_crps.py \
  tests/python/services/test_strategy_tuning_crps.py
```

Reproduce a headline KPI offline against a scratch copy of the daily store. The
CLI never writes market rows, but the market reader leaves
`historical/NVDA.parquet.lock` and may create empty `logos/`, `profiles/`, and
settings `search/` directories in the stores it is pointed at:

```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/market/historical" "$SCRATCH/settings" "$SCRATCH/compute"
cp market_store/historical/NVDA.parquet "$SCRATCH/market/historical/"
WORTHWARD_MARKET_STORE_DIR="$SCRATCH/market" \
WORTHWARD_SETTINGS_STORE_DIR="$SCRATCH/settings" \
WORTHWARD_COMPUTE_ROOT="$SCRATCH/compute" \
WORTHWARD_REMOTE_MARKET_ACCESS=disabled \
WORTHWARD_LONGBRIDGE_CLI_ACCESS=disabled \
python3 -B scripts/strategy_tune.py --offline --strategy har-range-price-field \
  --ticker NVDA --from 2023-10-01 --to 2026-09-30 --objective crps-skill \
  --bounds '{}' --trials 1 --output "$SCRATCH/out-har-range-price-field"
```

Replace the strategy ID for the other models. `--bounds '{}' --trials 1`
evaluates the startup defaults once; it is not needed for Backtest parity.
`full_window` reloads the provider with the best parameters for the exact
requested range, so in every mode it reproduces a Backtest whose From and To
dates are the typed `--from` and `--to`. `result.json` records
`full_window.crps_skill_pct` (unrounded), `full_window.backtest_headline_pct`
(the rounded Backtest value), and `full_window.history_basis:
exact-range-backtest-load`. Validation and holdout entries carry
`history_basis: session-bundle-clipped-at-fold-end` and no
`backtest_headline_pct`; they score the search session's single load, which a
search sizes with every searched numeric parameter at its upper bound and every
searched switch on, so they are not reproducible as a Backtest of the fold
dates. `full_window` overlaps the
validation and holdout windows and is reporting-only. The dated runs are
recorded in [Historical testing evidence](TESTING_HISTORY.md).
