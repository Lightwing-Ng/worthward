# Price Field startup defaults

Documentation version: `v1.1.0`
Last reviewed: `27 Sep 2026`

## Current profile contract

All 11 Price Field strategies use their frozen NVDA 1d, two-year GA validation
selection as the startup configuration. Factor switches and the matching
training parameters are promoted together; users do not need to reconstruct
the optimized configuration manually. Strategy definitions remain the sole
runtime authority. `get_startup_params()` supplies the catalog, Backtest form,
web runtime, and `scripts/strategy_tune.py --describe`.

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

LSTM Auto retains the NumPy CPU path for the current tiny per-origin workload,
without importing or probing unused accelerators. Explicit CPU/GPU choices are
preserved. The frozen study used CPU; changing its default selector to Auto does
not change the fitted NumPy algorithm.

All 11 retain the 1% presentation-only cell threshold. Existing transaction
thresholds remain unchanged. Enabled provider factors still require historical,
causally available observations; enabling a factor never fills missing history
with current snapshots.

| Source owner | Code version |
| --- | --- |
| Bayesian strategy | `v1.35.0` |
| LSTM strategy | `v1.14.0` |
| Cycle strategy | `v1.1.0` |
| Neural startup registry | `v1.2.0` |
| Shared neural strategy adapter | `v1.6.0` |
| Browser strategy controls | `v1.3.0` |

## Research provenance and limits

The immutable source study is `price-field-ga-20260927T001637`. Its frozen
selection SHA-256 is
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

## Browser precedence

A new Backtest form and CLI call use the current source defaults. On form load
or strategy switch, a browser record that exactly matches the complete previous
startup profile (including the prior LSTM NVDA CPU profile) is retired
automatically, allowing the new source defaults to apply. The historical snapshot in `app/strategy-controls.js` exists only to
recognize these untouched defaults; it is not another runtime default registry.
One changed value, partial records, unknown keys, and malformed records preserve
the entire browser profile. Explicit URL parameters and saved training cases
keep their existing precedence. No production store or saved model is rewritten.

A running server must load the changed Python modules before its forms advertise
these defaults. Source and isolated-test success do not establish adoption by a
previously running user-owned service.
