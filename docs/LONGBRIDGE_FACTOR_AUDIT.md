# Longbridge factor coverage audit

Documentation version: v1.0.0
Verified: 7 Sep 2026. Installed CLI: longbridge 0.23.1.

## Existing controls and current selection

The shared Price Field registry exposes 23 switches. The observed Backtest form
had eight enabled: volume, options, call open interest, call volume, put volume,
put/call open-interest ratio, total open interest, and total option volume.

The following existing controls were not selected: broker holding, capital flow,
dividend yield, dynamic PE, fund-holder weight, market temperature, PB, PE, PS,
put open interest, put/call volume ratio, shareholder concentration, short interest,
short volume, and volume at price. This audit did not change any selection.

The CLI daily option payload includes all eight option statistics already in
the registry. Put open interest and put/call volume ratio are the two unselected
statistics; neither is an implementation omission. The enabled Options composite
already combines historical put/call volume and open-interest ratios, so the
unselected standalone volume-ratio switch does not imply total exclusion of that
information. Enabling both is not proof
of better out-of-sample performance, because these counts and ratios overlap.

## Candidate capabilities absent from the registry

| Capability | CLI command | Constraint before historical training |
| --- | --- | --- |
| Turnover value/rate, volume ratio, amplitude, market capitalization | calc-index | Current snapshot; verify historical availability and point-in-time share counts |
| IV and option Greeks (delta/gamma/theta/vega/rho) | calc-index, option quote | Contract-level current values; requires historical chains and a stable expiry/moneyness aggregation rule |
| Earnings growth, margins, cash-flow/debt ratios | financial-report, financial-statement | Requires actual publication timestamps and handling of restatements |
| Analyst EPS revisions, rating changes, target-price revisions | forecast-eps, institution-rating | Current consensus alone is insufficient; use timestamped historical revisions |
| Order-book imbalance, trade imbalance, capital-distribution composition | depth, trades, capital | Intraday/current observations need historical collection and market-session alignment |

Historical returns and volatility can also be derived from existing causal
OHLCV. Such derived features are new model inputs, not missing raw CLI fields.
These are candidates for a separately validated model extension; this audit does
not add switches backed only by present-day data.

## Read-only spot checks

Commands used: longbridge --help; longbridge --version; subcommand --help for
calc-index, option, valuation, financial-report, forecast-eps, institution-rating,
capital, short-positions, and option volume daily.

- calc-index DRAM.US --fields turnover,turnover_rate,volume_ratio,amplitude,mktcap --format json:
  all five requested snapshot fields were returned.
- option volume daily DRAM.US --count 3 --format json:
  three observations returned with all eight option statistics.
- institution-rating DRAM.US --history --count 3 --format json:
  rating and target history arrays were empty.
- valuation DRAM.US --history --indicator pb --range 1 --format json:
  the historical PB list was empty.
- short-positions DRAM.US --count 3 --format json: empty data array.
- short-trades DRAM.US --count 3 --format json: three observations returned,
  but only observation dates were provided. The existing provider intentionally
  requires publication timestamps for this factor, so these rows do not establish
  causal training eligibility.

Source ownership: strategies/price_field_pipeline.py declares switches;
app/services/price_field_market_factors.py fetches and gates provider data.
No production store or training history was modified by this audit.

Official references: [CLI calculated indexes](https://open.longbridge.com/docs/cli/market-data/calc-index)
and [CLI options](https://open.longbridge.com/docs/cli/derivatives/option).
