# Classic strategy signal and execution contract

Documentation version: `v1.4.0`

The 7 Sep 2026 repair covered MACD, SuperTrend, kNN, Lorentzian, DCA, and
Leveraged Rotation. On 8 Sep 2026, the duplicate MACD (Gemini), kNN Machine
Learning (Gemini), Lorentzian Classification (Gemini), Lorentzian Classification
(ChatGPT), and SuperTrend AI (Gemini) catalog entries and implementations were retired.
Bayesian Price Field, LSTM Price Field, PatchTST, TSMixer, N-HiTS, TimeXer,
All in, and Grid are outside this repair. Their strategy implementations remain
outside this change; shared parameter metadata and execution logic change only
for declarative allocation roles and the Leveraged Rotation profile.

## Causal indicator decisions

The nine indicator strategies require `next_open` execution. A signal computed
using a completed bar cannot buy at that same bar's open or close. MACD retains
the 12/26/9 defaults, but exposes a line only after the corresponding EMA has
enough observations; crossover decisions require two available line pairs.
Fast EMA must be shorter than Slow EMA. Explicit numeric parameters must be
finite; integer controls reject fractional values and accept integer strings
such as `"2.0"`. Validation stays local to signal computation so the shared
parameter normalization and candidate orchestration contracts remain intact.

SuperTrend uses a complete arithmetic mean to seed Wilder ATR. Its performance
history is bounded relative to each decision origin, rather than relative to
the final dataset length. Appending future bars therefore cannot change earlier
factors or signals. Fractional performance memory applies consistently to both
the numerator and denominator; the adaptive smoothing coefficient stays in
`[0, 1]`. Cluster selection ranks occupied clusters and retains the configured
factor step, with at most 512 factors to bound allocation.

The retained MACD and SuperTrend implementations each own a single catalog ID.

## Neighbor labels and indicator availability

kNN and Lorentzian features retain unavailable warmup values. Wilder RSI is 100
for a complete window with gains and no losses, 0 for losses and no gains, and
50 for an observed flat window. Missing warmup observations are not neutral
market evidence. CCI, ATR, ADX, and feature smoothing likewise require their
observed initialization windows.

kNN trains against matured one-bar forward outcomes. Lorentzian trains against
matured four-bar forward outcomes: at decision close `t`, an example starting
at `s` is eligible only when `s + 4 <= t`. Neighbor sampling includes the most
recent eligible example, measures distance to finite historical features, and
does not discard neutral labels. Exact-distance matches retain neutral votes.
The retained Lorentzian strategy uses its unweighted vote contract. The retained
kNN strategy owns the repaired implementation without a duplicate catalog identity.

Long-only holding timers start at an emitted entry intent rather than unrelated
prediction flips. Four holding bars are measured consistently with next-open
execution. These strategies generate intents; they do not observe execution
fills or override the shared loss-exit switch. Their votes are not calibrated
probabilities, and these repairs do not establish a higher financial win rate.

## Market data and scheduled contributions

Neighbor and SuperTrend strategies reject missing, nonfinite, nonpositive, or
incoherent OHLC observations instead of manufacturing missing execution prices.
Volume is required only when the explicit kNN Volume feature is selected. The
default All feature averages mature price-derived features and any available
nonnegative volume feature without treating absent Volume as a failed backtest. MACD validates
the observed Close series used by its calculation; the executor separately
requires a usable Open for `next_open` execution.

DCA normalizes real observations to their trading calendar day before sorting
and rejects duplicate calendar days. This prevents the same scheduled
contribution from being applied twice. Invalid dates, nonfinite amounts,
negative or nonfinite observations, and arithmetic overflow raise clear errors.
Existing finite contribution normalization, zero-close cash retention, sparse
trading-day aggregation, and valid-data All-in comparison formulas remain intact.

Leveraged Rotation requires ordered unique dates and aligned, finite positive
OHLC for both assets. Supplied dividends must be finite and nonnegative. Invalid
rows are not silently removed inside the strategy. Its triggers are completed-bar
daily percentage moves: a configured primary drop enters the leveraged regime,
and a configured leveraged rise returns to the primary regime. Initial and
minimum/maximum allocations are applied by market value, then rounded down to
integer shares; residual capital remains cash. Subsequent close-derived decisions
require opening-price execution. The Backtest form resolves every limit and
trigger label from the current ordered ticker inputs rather than persisting
`Ticker 1` or `Ticker 2` as visible names. All percentage controls use hundredth
steps and two-decimal display. The initial-allocation band renders primary,
leveraged, and cash segments with the standard blue, secondary-magenta, and
positive-green tokens. Its labels show the two target percentages and the cash
amount; integer share counts remain internal to the execution preview. Label
centers follow their allocation segments and are packed apart when a narrow
segment would otherwise cause a collision.

## Preserved integration boundaries

- The shared multi-asset combiner still fills absent OHLC from Close and cleans
  dates before strategy invocation. Local rotation validation cannot establish
  provenance already lost upstream. Use observed OHLC for execution research.
- Single-ticker history retains supplied Volume through normalization, cached
  loading, and price-mode selection. Older caches without Volume fail only for
  an explicitly selected kNN Volume feature. Existing provider adapters can default absent volume
  to zero; strategy-local validation cannot distinguish that upstream default
  from an observed zero. These shared adapters remain outside the repair.
- The shared rotation executor suppresses a close decision on a bar that already
  executed a pending morning rebalance, preventing a same-day round trip based
  on the previous close.
- The loss-exit switch can suppress losing algorithmic exits. A generated sell
  intent is not evidence of a completed transaction.
- GUI and research callers can supply different warmup prefixes. Compare results
  only with identical input history and parameters; this repair does not change
  protected shared runtime behavior.
- Previously saved backtests are historical evidence. Recompute them to apply
  the corrected warmup, labels, and execution timing.

## Verification ownership

Focused regression owners are `tests/test_macd_supertrend_regressions.py`,
`tests/test_strategy_neighbor_regressions.py`, `tests/test_dca_input_contract.py`,
and `tests/test_leveraged_rotation.py`. They cover future append invariance,
indicator seeds, mature labels, neutral neighbors, parameter boundaries,
duplicate contributions, delayed execution with distinct Open and Close,
blocked rotation retries, and preserved input frames. Existing strategy-variant
future-perturbation tests keep all OHLC values coherent while altering the future.
Run focused tests before the serialized `./scripts/check.sh` gate. A dated local
handoff records exact results and a byte comparison of the protected sources.

## Formula references

- [TradingView MACD definition](https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/)
  and [MACD strategy](https://www.tradingview.com/support/solutions/43000644943-macd-strategy/)
  define the line, signal smoothing, and crossover construction.
- [TradingView ATR](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/)
  documents True Range and default Wilder-style smoothing.
- [LuxAlgo SuperTrend AI](https://www.tradingview.com/script/wP7WWjLL-SuperTrend-AI-Clustering-LuxAlgo/)
  is the original author's clustering and adaptive-performance reference.

These references establish formula provenance, not a performance ranking or
an exact reproduction of every platform's seed and order-execution convention.
