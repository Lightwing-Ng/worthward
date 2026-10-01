# Price Field startup defaults

Documentation version: `v1.2.0`
Last reviewed: `1 Oct 2026`

## Current profile contract

The 15 Price Field strategies have two kinds of startup profile. The 11
strategies that existed on 27 Sep 2026 use their frozen NVDA 1d, two-year GA
validation selection. The four econometric strategies added on 1 Oct 2026 use
frozen research specifications selected on a 16-ticker panel pre-window; they
were not part of the NVDA GA study (see
[Econometric profile provenance](#econometric-profile-provenance)). Factor
switches and the matching model parameters are defined together; users do not
need to reconstruct the selected configuration manually. Strategy definitions
remain the sole runtime authority. `get_startup_params()` supplies the catalog,
Backtest form, web runtime, and `scripts/strategy_tune.py --describe`.

The source owners are:

- `strategies/algorithms/strategy_bayesian_price_field.py`: Bayesian factors,
  252-session training window, 232-session chip window, and prior strength 14.16.
- `strategies/algorithms/strategy_cycle_of_price_action.py`: independent Cycle
  factors, 252-session training window, 42-session chip window, and prior
  strength 0.01. Its cycle trading rules retain their existing defaults.
- `strategies/algorithms/strategy_lstm_price_field.py`: LSTM factors,
  252-session training window, 21-session chip window, lookback 4, hidden size 23,
  8 epochs, learning rate 0.03, seed 42, and Auto execution.
- `strategies/price_field/neural/registry.py`: eight neural profiles, including
  Market context factors, seeds, and CPU execution. The
  [neural research contract](NEURAL_PRICE_FIELD_RESEARCH.md) lists their numeric
  parameters and enabled factors.
- `strategies/price_field/econometric/strategy.py`: the four econometric
  profiles through `EconometricPriceFieldStrategy` and its subclasses. Each uses
  refit interval 20 weekdays, prior annual Sharpe 0.6, prior strength 2,520
  sessions, drift window 1,260, both factor switches (`use_drift` and
  `use_intraday_range`) on, and a 60% entry probability. The fit window and CRPS
  scale multiplier are 2,000 and 0.94 for HAR Range and Rough Volatility, 1,000
  and 0.96 for Score-Driven, and 2,000 and 1.0 for CRPS Learning, which adds
  learning rate 0.5 and forgetting 0.999. The modules under
  `strategies/algorithms/` declare only identity, description, and display
  order.

LSTM Auto retains the NumPy CPU path for the current tiny per-origin workload,
without importing or probing unused accelerators. Explicit CPU/GPU choices are
preserved. The frozen study used CPU; changing its default selector to Auto does
not change the fitted NumPy algorithm.

All 15 use the 1% presentation-only cell threshold. Existing transaction
thresholds remain unchanged. Enabled provider factors still require historical,
causally available observations; enabling a factor never fills missing history
with current snapshots. The econometric strategies load OHLCV only and have no
provider factors.

| Source owner | Code version |
| --- | --- |
| Bayesian strategy | `v1.35.0` |
| LSTM strategy | `v1.14.0` |
| Cycle strategy | `v1.1.0` |
| Neural startup registry | `v1.2.0` |
| Shared neural strategy adapter | `v1.6.1` |
| Shared direct-horizon module | `v1.0.0` |
| Econometric strategy adapter and models | `v1.0.0` |
| Four econometric strategy modules | `v1.0.0` |
| Browser strategy controls | `v1.3.1` |

## Research provenance and limits

This section covers the 11 NVDA GA profiles. The immutable source study is
`price-field-ga-20260927T001637`. Its frozen selection SHA-256 is
`2c7f151d34ba4639baa56dc95eb2e7d07ce3a10b0b66e70021b7b424e6c114f3`.
The paired completion study is `price-field-ga-holdout-20260927T113637`; its
`report/parameters/<strategy-id>.json` files are the exact promoted exports.
Both studies live under the external Worthward research directory and remain
unchanged by this promotion.

The visible NVDA history is 27 Sep 2024 through 25 Sep 2026, with 500 daily bars.
Selection used the first 400 bars, through 4 May 2026; three causal validation
folds used offsets 100–200, 200–300, and 300–400. The untouched final 100 bars,
5 May through 25 Sep 2026, were evaluated only after selection froze.
The objective is the existing strict CRPS probability skill, equally weighted
across all 20 horizons. It is a forecast score, not trading profit.

All 58 paired winner/baseline holdout evaluations completed for all 11 models.
Nine neural models used seeds 42, 43, and 44; Bayesian and Cycle used their
deterministic seed 42. Seven selections improved their prior-default holdout
score; Bayesian, LSTM, Cycle, and iTransformer regressed. The user authorized
promotion of every frozen selection after receiving these results. No holdout
ranking is used to choose replacements, and these NVDA-specific defaults do not
establish superiority for other tickers or periods.

## Econometric profile provenance

The four econometric profiles are the frozen round-2 and round-3 research
specifications documented in the
[econometric research contract](ECONOMETRIC_PRICE_FIELD_RESEARCH.md). Every
hyperparameter was selected by the mean CRPS skill of a 16-ticker panel (NVDA,
QQQ, SMH, SPY, AAPL, MSFT, MU, AVGO, TSM, ORCL, QCOM, GOOGL, JPM, IBM, VZ, and C)
over the pre-window 2016-10-01 through 2023-09-30. Model priors were estimated
only on data before 2016-10-01. The NVDA three-year KPI window from 2023-10-01
was reported and never used to select, and no GA or holdout promotion step was
applied. These are therefore not NVDA-tuned defaults; the research contract
records the evidence, the one documented tie-break, and the limitations,
including the drift's dependence on bull-market regimes.

## Browser precedence

A new Backtest form and CLI call use the current source defaults. On form load
or strategy switch, a browser record that exactly matches the complete previous
startup profile (including the prior LSTM NVDA CPU profile) is retired
automatically, allowing the new source defaults to apply. The historical snapshot in `app/strategy-controls.js` exists only to
recognize these untouched defaults; it is not another runtime default registry.
One changed value, partial records, unknown keys, and malformed records preserve
the entire browser profile. The four econometric strategies have no earlier
startup profile, so no browser record is retired for them. Explicit URL
parameters and saved training cases keep their existing precedence. No production store or saved model is rewritten.

A running server must load the changed Python modules before its forms advertise
these defaults. Source and isolated-test success do not establish adoption by a
previously running user-owned service.
