# Known issues and operating constraints

Documentation version: `v1.240.0`

This document is intentionally privacy-safe. It contains no broker account
identifiers, account-holder names, balances, position quantities, order
references, transaction descriptions, or copied statement content.

## LSTM training

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

## Browser-gate follow-up

The 4 Sep 2026 complete gate passes Python/JavaScript and 294 Chromium cases but
retains five browser failures. They cover Backtest share-heading clearance,
Bayesian axis geometry, older 6px versus current 2px padding expectations, a
legacy zero-opacity expectation, and an Investment entry-version map mismatch.
See `TESTING.md` for exact cases and observed values. The current task preserves
the parallel Price Field layout changes and does not claim these are resolved
or reproduce them against a separate clean baseline.

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
- Durable training uses a minimum 60-second optimizer-work budget and resolves
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
