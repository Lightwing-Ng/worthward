# Known issues and operating constraints

Documentation version: `v1.243.6`

External Price Field audit follow-up, 6 Sep 2026: the reported Bayesian
loss-exit behavior follows the configured execution policy. This does not
resolve its effect on strategy evaluation or establish that it reduces risk.
`stop_loss=false` deliberately keeps a
strategy sell or cover intent open when its price would realize a loss; use the
explicit `stop_loss=1` URL parameter when evaluating signal-faithful exits.
The local Price Field fallback rejects the requested bundle if any retained
trading date has nonfinite OHLC. It must not delete that date and bridge the
next-open target across the resulting gap. Invalid OHLC outside the requested
interval does not prevent loading valid observations inside it.
Model fingerprints also record the resolved compute device, engine,
numeric precision, and whole-run fallback state. PyTorch 2.14.0 is declared in
the setup requirements; clean installation of that pin remains unverified.
The inspected Python 3.13 environment used PyTorch 2.7.1 with MPS available.
Bayesian acceleration remains scoped to the
confirmed MPS or CUDA posterior backend; full SoC, Neural Engine, and browser
WebGPU utilization are not claimed or verified.

The previous full browser gate reported 320 passes and three failures:
Holdings/history alignment, DCA internal overflow, and Bayesian edge hover.
The edge-hover failure also reproduced alone. A pre-change reproduction was
not obtained for all three failures, so they cannot all be classified as
pre-existing from that evidence.

LSTM GA v0.9.0 adds opt-in `--objective probability` and a SHA-256-pinned
`--snapshot-file` input. It ranks chronological validation Brier scores with
missing-prediction penalties and excludes holdout results from selection.
The default direction objective retains its existing legacy ranking. See
[LSTM probability tuning](LSTM_PROBABILITY_TUNING.md) for the offline budget,
selection boundaries, and hard-stop limitation. Native disclosure masks now use
the standard blue accent in both open and closed states.

Backtest annotation follow-up, 5 Sep 2026: algorithmic stop-loss exits and trade
details now default off throughout web configuration and URL state. Explicit
opt-ins remain supported. `Market factors` reuses the shared strategy collapse
for real model inputs; technical-indicator strategies do not expose unsupported
Longbridge inputs. The final targeted browser run passed 34 cases. Full Python
and JavaScript checks passed; the pre-existing Holdings/history Market value
alignment issue still prevents a green full browser gate. See
[Backtest validation](BACKTEST_MARKET_FACTORS_VALIDATION.md).

Settings annotation follow-up, 5 Sep 2026: primary action specimens retain intrinsic
width; ticker input controls use the 15px semantic token and their specimen starts
at the content edge. Selected execution options keep the neutral theme surface and
standard blue border. Switch thumbs reuse the shared spatial duration and bouncy
curve, including the existing reduced-motion override. Tooltips resolve their
material through the canonical frosted-glass background alias.

About now summarizes current research, forecast, import, and optional trading
features. Its reading scrollport no longer extends into the sidebar; other elevated
Settings surfaces retain their effect gutters. The risk notice distinguishes
hypothetical results, model and data limitations, capital loss, live-order failures,
and nonwaivable legal rights. It is a disclosure, not proof of legal compliance or
immunity from claims; public distribution or commercial investment use requires a
fact-specific legal review. Sources: [SEC automated investment tools alert](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/investor-56),
[SEC backtest enforcement example](https://www.sec.gov/newsroom/press-releases/2014-289),
and [15 U.S.C. 80b-15](https://www.law.cornell.edu/uscode/text/15/80b-15).

General follows About in both navigation order and the active-index mapping.
Cash-equivalent additions align right. Color reset is the final danger action
package and retains its browser-local reset handler. Network transport diagnostics
use the shared disclosure primitive outside the standard action package. Strategy
summaries use 6px block and 4px inline padding at existing breakpoints. Local-store
pagination remains outside the table scrollport, with an open effect host; only
table data scrolls. No broker, persistence, or order-authorization contract changed.

IBKR supplemental realized-P&L replay accepts complete file history when a
user-confirmed partial position snapshot omits a ticker. Transaction-source
partial-history flags are not prerequisites; complete scoped replay and the
existing position-boundary checks still determine whether reconciliation is available.

Manual LSTM training now requires at least 180 seconds of optimizer work,
distributed across eligible causal origins. Loading and evaluation add wall time.
Additional optimization does not guarantee improved holdout accuracy. History
rows reserve five ems for ticker symbols and right-align percentage badges.

This document is intentionally privacy-safe. It contains no broker account
identifiers, account-holder names, balances, position quantities, order
references, transaction descriptions, or copied statement content.

## LSTM training

- Completed history records restore saved settings, not frozen neural weights
  or predictions. Older result artifacts contain aggregate scores and input
  snapshots only. Applying them recomputes the interactive forecast and does
  not imply that the displayed probabilities reuse durable training output.
- Price Field backtest.js v0.40.0 supports dragging an overflowing future field
  left while preserving cursor alignment and a stationary price axis. All-hidden
  lattices display their threshold and maximum cell probability; lowering a
  display threshold is a user choice, not an automatic model change.

- The prepared-request launch handshake is fixed in manager/runner v0.6.0.
  An already failed history item remains historical evidence; it is not relabeled
  successful or automatically retried. Restart a cached older service through the
  normal user-owned launcher before starting a new run. An exited worker's actual
  startup error is available in its details rather than only `Unavailable`.
- Durable exact-configuration training currently accepts only `1d`. A `1m`
  selection or missing interval is rejected before launch, not silently replaced
  with daily data. The separate daily-model/one-minute Backtest execution bridge
  does not add intraday training support.
- Missing intervals may be read from the saved request or snapshot; the original
  daily-only runner versions can be identified as 1d without rewriting files.
  Legacy multi-seed aggregates without a saved single seed cannot be applied as
  a complete case. Their measured aggregate scores and files remain inspectable.
- Applying a case freezes its actual data dates, not a rolling period ending
  today. A requested one-year period can contain fewer observations for a recent
  listing; both the requested bounds and actual data window remain visible.
- Protocol version 2 is required for updated training controls. A cached older
  Python service must be restarted by its owner; refreshing static assets alone
  cannot activate the new configuration/delete endpoints.
- Deletion archives inactive compute output under `.deleted/<run-id>` beside the
  active run directories. It is recoverable, not a permanent purge. Running or
  locked jobs and symlink targets cannot be deleted.
- Longbridge factors without verified historical availability remain unavailable,
  not synthetic features. Selecting a factor does not create missing observations.

## Registry-wide CLI research

- Research adapter/search v1.1.0 fixes three audit findings: discarded loaded
  pre-range warmup, eligibility inferred from predictions outside the scored
  window, and coercion of malformed numeric search bounds. Prior tuning outputs
  remain historical artifacts; they are not rewritten or automatically rerun.
  Use a new output directory to evaluate a configuration under the corrected
  scoring contract. The adapter preserves model evidence across the minute bridge.
- The CLI requires at least 40 distinct real trading dates and complete OHLC.
  It never creates missing market history. Default-source strategies read existing
  local files; Price Field strategies retain their declared Longbridge provider.
  Unsupported execution intervals or missing causal bridges fail explicitly.
- Numeric domains without a declared maximum use a finite exploratory bound
  derived from the default, not a claim that this is an economically optimal
  search region. Nullable automatic price limits require explicit bounds.
  Use `--bounds` for a deliberate research range and `--params` for fixed values;
  display-only thresholds and hardware choices cannot enter parameter rankings.
- The random forest is a parameter-search surrogate, not a stock-price predictor.
  More trials or longer training can overfit validation; the untouched holdout is
  reported separately and is never used to choose a winner. There is no profitability
  guarantee. Buy and hold is a one-evaluation baseline, not a fabricated search.
- The time budget is cooperative between evaluations. An expensive in-flight
  strategy completes before the process exits. The output directory must be new
  and outside market/settings stores; every evaluation and holdout error is retained.
- macOS MPS has actual-device verification. Windows CUDA is supported by the
  existing backend dispatcher but has no physical Windows verification in this change.

## Backtest title-rail alignment

Fixed on 4 Sep 2026 in workspace.css v1.22.4: Backtest no longer disables the
shared desktop result-column lift. At widths of at least 768px, Performance
shares the page-title, sidebar-toggle, and theme-control centerline. Below 768px,
the existing stacked flow remains unchanged. The title-rail fix did not change
shared anchor tokens or chart padding. The regression checks five widths from
390px to 1,276px, including chart visibility, splitter placement, and horizontal
overflow.

On 5 Sep 2026, the next annotated Backtest spacing pass updated trade.css v3.61.1:
the Price Field chart stack uses a 4px bottom inset, and the Overview surface uses
6px inline padding through its local result-surface token. The narrow probability
detail panel keeps its dedicated 10px inline margin and 12px inline padding.

The shared-control sample pass also updated forms.css v0.19.9: date-picker values
use a 30px minimum height; strategy parameter rows use a 35px content baseline
with no inter-row top padding, producing 36px bordered rows; and LSTM history
selection buttons use the shared pill radius. These are shared rules rather than
field-specific overrides, so date fields, numeric/select parameters, factor
switches, and history entries keep the same compact geometry.

Validation: the 28 focused layout contracts, the shared-control geometry
regression, and both default-strategy and five-width LSTM title browser
regressions pass. The complete gate passes its
Python and JavaScript stages, then reports 293 Chromium passes and seven failures.
The failures are unrelated share-heading clearance, a market-cap ticker blur
navigation timeout, stale Investment entry-module version, desktop gel-motion
scale, Bayesian axis geometry, the older 6px Backtest result-card expectation,
and the legacy zero-opacity expectation. These failures were not repaired or
independently baseline-reproduced in this spacing-only change.

The subsequent full-gate attempt for this shared-control pass reached 1,155
passed, 6 skipped, 180 subtests, and 73.63% coverage before stopping on the
pre-existing `investment.css` E2E resource-version mismatch: the stylesheet
reports v1.78.8 while a concurrent `critical-flows.spec.mjs` assertion still
uses 1.78.7. The focused JavaScript suite separately passed all 319 tests.

## Browser-gate follow-up

Current verification: the 5 Sep 2026 complete gate passed 304 Chromium cases and
failed four. Three were corrected and passed focused replay. The remaining
Holdings/history Market value alignment differs by 4.25px at an 856px viewport,
exceeding the 1px contract. No tolerance was relaxed; this layout finding remains
open. The full gate was not repeated after the test-only follow-ups.

On 5 Sep 2026, a fresh audit reproduced all five previously listed failures.
The Investment diagnostic map now matches its entry source version, with a
repository regression preventing drift. The detail axis uses measured Canvas
geometry. A visible Backtest share drawer reserves its own heading rail; hidden
drawers retain compact spacing. The spacing assertion follows the existing 2px
contract. Zero-threshold tests retain positive-probability cells and the nonlinear
opacity checks. Automatic-pan coverage uses an interior origin because the final
curve endpoint has no remaining curve content to pan. The existing endpoint and
future-drag tests cover that separate boundary. Returning from Equity to Price
also cancels the queued Equity leave callback before it can erase the new pointer.
See the latest Testing record
for current outcomes; the dated failures below remain historical evidence.


The latest 4 Sep 2026 complete gate passes Python/JavaScript and 294 Chromium
cases but fails six browser cases. Five repeat the recorded Backtest share-heading
clearance, Bayesian axis geometry, 6px versus 2px padding, zero-opacity, and
Investment entry-version map mismatches. The sixth exposed a missing hover
precondition in the narrow desktop history-delete test. That test now reveals the
action before clicking and asserts its opacity and pointer-events; all 11 LSTM
and shared-control browser cases passed on 5 Sep 2026. The five other failures
remain unresolved. The complete gate was not rerun after this test-only correction.
See `TESTING.md` for exact commands and evidence; no clean-baseline attribution
is claimed and concurrent layout work remains preserved.

## Investment imports

- Import-complete `Transfer review` feedback is scoped to source rows that
  became actionable during that import. Pre-existing `Unbound` rows remain
  available in Transaction history but are not repeated as work created by an
  unrelated later import; the comparison uses the completed post-commit
  transaction render rather than a pre-import frontend count.

- Schwab transaction exports classify `Non-Qualified Div` as dividend income
  and `NRA Tax Adj` or related withholding-tax actions as
  `foreign_tax_withholding`; date-only exports retain day-level timestamp
  provenance, while an explicit intraday datetime column is preserved when
  present. Incremental re-imports also canonicalize legacy persisted
  `nra_tax_adj` records before duplicate matching and retain the old type as
  source provenance. When Schwab supplies only a date, same-day buy and sell
  chronology follows the inferred source row direction; an explicit user
  confirmation takes precedence in both persisted replay and browser replay.
  A linked dividend or withholding row displays its canonical ticker before
  the preserved broker description.
- IBKR GainsKeeper imports retain `BUYOTHER` and `SELLOTHER` money-market
  transactions with their immutable FITIDs, exact source timestamps, and
  cash values; legacy stored GainsKeeper timestamps are normalized to the
  source's America/New_York wall-clock convention during incremental merge.
- IBKR web paste is supplemental evidence. Matching CSV or GainsKeeper rows
  remain the higher-precision source when they are available.
- A compact Orders aggregate only supersedes full-page split fills when the
  declared fill count and all signed economic fields reconcile exactly;
  otherwise every independently captured filled row remains in the ledger.
- Immutable GainsKeeper split fills supersede a matching provisional compact
  web aggregate when their unique FITIDs, split count, identity fields, signed
  quantity, and gross trade value reconcile exactly. GainsKeeper commission
  and net-cash values remain authoritative when they differ from the web
  aggregate.
- The optional cash and position boundary comes from a paired IBKR Your
  Holdings page paste. Its account must match Trade Notifications; its raw
  text is retained as immutable evidence, it is dated to the captured fill
  boundary, and it never creates synthetic trades.
- When a Trade Notifications page mixes current-day time-only rows with dated
  history, select the displayed Hong Kong page date. It fills only the omitted
  current-day dates; dated rows remain independent broker evidence.
- Your Holdings parsing requires one account, recognizable Instrument/Position
  rows, and a base-currency Cash Holdings row. Invalid, duplicate, or
  cross-account evidence fails closed.
- Broker account validation is opt-in through local environment configuration;
  no personal account number is stored in source code.
- Local source artifacts may contain sensitive financial evidence. Keep the
  local settings store and exported statements outside Git and unencrypted or
  shared backups. Preserve a binary-safe encrypted local backup when recovery
  is required; do not discard the only evidence sidecar for a ledger that may
  receive later imports.

## Accounting behavior

- Investment FX conversion returns an internal nonfinite sentinel when a nonzero
  foreign amount has no valid rate. Cash arithmetic preserves that unknown;
  Holdings market values and equity expose unavailable values instead of currency
  parity. Zero amounts and base-currency amounts do not require an FX rate.
- Aggregate P&L tracks complete, partial, and unavailable ticker coverage. Partial
  coverage displays `Partial · total unavailable`, and complete totals are withheld
  across Holdings and Metrics. Missing standalone cash-flow FX also withholds the
  total. Valid ticker rows remain individually inspectable.


- Unknown cost basis, incomplete history, and conflicting broker snapshots are
  represented explicitly instead of being replaced with guessed values.
- Mixed-broker snapshots remain scoped by broker and account. Aggregation is
  disabled when the evidence boundary is ambiguous.
- A broker performance snapshot and a position snapshot have independent
  as-of boundaries. Later trades supplement realized P&L from the performance
  boundary while the position snapshot validates inventory; the newer position
  date cannot hide those trades.
- Security-transfer links require explicit evidence and do not invent a
  carried cost basis.
- HSBC settled-order balances use the final chronological principal or fee
  posting. When copy/paste order conflicts with the official USD Savings CSV,
  the CSV's continuous balance sequence is authoritative.
- Current broker cash snapshots are presentation endpoints. HSBC historical
  settlement corrections use the pre-projection broker ledger, so a later
  mixed-broker current cash refresh cannot cancel earlier settled proceeds.

## Local store housekeeping

- A machine-local `market_store/` can contain Finder-style collision names such
  as `*_1m-2.parquet` or `*_1m-3.parquet`. Canonical path resolvers do not read
  those names, but that alone does not prove that their bytes are disposable.
  Treat every non-bundled market file as protected local data: verify lineage,
  compare it with the canonical cache, and obtain explicit user authorization
  before removing it. Zero-byte companion locks follow the same ownership
  boundary while a writer may be active.

## LSTM Price Field compute backends

- Interactive LSTM `Auto` uses NumPy CPU because origin-local tiny LSTM training is faster
  on unified-memory CPU than GPU kernel launch. An explicit `GPU` request uses
  Apple MPS or CUDA only after a real tensor readback.
- Durable training uses a minimum 180-second optimizer-work budget and resolves
  Auto to confirmed MPS/CUDA. Accelerator failures are visible failures, not silent
  CPU successes. Explicit CPU remains available. The configured epoch count is a
  floor during durable training. MPS was exercised on this Mac; Windows CUDA
  selection and portable process/lock paths have no live Windows hardware proof.
- Neural Engine is never claimed from a static import or an unconfirmed Core ML
  compile. `Auto` does not select it. An explicit `Neural Engine` request falls
  back to CPU when compute-unit execution is not confirmed.
- Walk-forward LSTM origins run serially to bound unified-memory occupancy.
  Intermediate sequences are released after each origin.
- MLX and coremltools are not required packages. They are probed when present
  and otherwise recorded as unavailable.

## Backtest interval constraints

- Bayesian Price Field signals target the executable next-session-open to
  following-session-open return. The absolute-price grid remains visually
  anchored to the signal close because the unknown entry Open does not exist at
  forecast time; this display anchor is not treated as a fill price or model
  target. The Price Field detail panel labels this distinction explicitly. A
  missing execution Open fails closed.
- The 20 browser columns retain their accepted square-cell geometry and may
  cover more than 20 trading days under integer-day quantization. Their
  probability masses use the fitted causal AR(1) return-state transition at the
  selected origin; they are not 20 separately fitted future factor paths.
- Provider factor `status` is separate from latest-origin `eligible` and
  `selected` metadata. An available factor can therefore be intentionally
  excluded by causal incremental evidence, and the UI must not interpret
  availability alone as posterior inclusion.
- Bayesian Price Field remains a daily posterior model. Its `1m` option uses
  real local one-minute bars only for execution prices and the equity axis;
  the daily probability field is intentionally unavailable in that mode. Daily
  signals and intraday bars map through the ticker exchange's local trading
  dates, so Asian sessions are not shifted by UTC or New York midnight.
- One-minute Backtest history follows the local store retention window. A
  longer selected Period is automatically reduced to the final available
  one-minute option, normally `max`, rather than fabricating older minute bars.
- Multi-ticker strategies expose `1m` only when every required ticker has real
  one-minute history and the complete required set shares at least one Period;
  the browser intersects Period choices across that ordered set.
- Bayesian one-minute execution refreshes only its required one-minute cache.
  If refresh fails, Backtest reports the failure before read-only reuse of an
  existing cache; without an existing cache, the request fails closed.

## Security

- Browser Live Trading requires the configured PIN and establishes a signed
  browser session. Non-browser clients require the configured strong access
  token. A request is authorized by one of those boundaries, not by both at
  once; the repository contains neither a default PIN nor a default token.
- IBKR remains file-import-only. No broker session, credential, market-data,
  or order-routing transport is implemented.
