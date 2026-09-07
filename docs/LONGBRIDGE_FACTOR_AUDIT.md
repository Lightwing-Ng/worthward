# Longbridge factor coverage audit

Documentation version: v1.1.0
Verified: 7 Sep 2026. Installed CLI: longbridge 0.23.1.

## Implemented expansion

The shared catalog now exposes 36 controls. Thirteen opt-in factors reuse
Longbridge historical K-line OHLCV and observed turnover: turnover, daily return,
5/20/60-bar momentum, 20-bar volatility, daily amplitude, overnight gap,
intraday return, close location, 20-bar relative volume, volume change, and
20-bar Amihud-style illiquidity. Relative volume compares the current bar with
the preceding 20-bar mean; it is not the CLI intraday volume-ratio index.
Rolling inputs require complete windows. Missing or nonpositive turnover stays
unavailable; Close times Volume is never substituted. Extra warm-up history is
requested when a derived lookback is enabled. Existing default selections are
preserved; adding controls does not establish improved model performance.

The catalog owns labels, provider identity, help text, and categories. Both
Price Field strategies map that metadata into the generic parameter subgroup
contract. The presentation builder groups fields once; the template composes
existing Collapse and parameter-grid primitives, including switches, tooltips,
keyboard behavior, reduced motion, and independent disclosure state. Nested
field grids account for column gaps; help width uses the actual inline container
(100cqi) without introducing viewport-specific breakpoints. No strategy
IDs or factor lists are duplicated in the browser renderer. Five categories are
Price and volume, Options, Valuation, Market sentiment, and Research availability.

Read-only verification on 7 Sep 2026: `kline history DRAM.US --start 2026-09-01
--end 2026-09-04 --period day --format json` returned observed turnover alongside
OHLCV. `institution-rating NVDA.US --history --count 3` returned long historical
arrays despite the count argument; rating periods and monthly target timestamps
do not establish publication or revision availability. Those arrays are not
silently promoted to causal financial-statement or analyst features.

## Previous controls and observed selection

Before this expansion, the shared Price Field registry exposed 23 switches. The observed Backtest form
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

Historical returns and volatility are now implemented from causal OHLCV as
described above. Snapshot-only capabilities in this table remain unavailable to
historical training; adding them requires point-in-time data rather than more
unchecked toggles.

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
