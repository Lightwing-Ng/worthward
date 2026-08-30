# Testing guide

Documentation version: `v1.33.0`

## Supported commands

Install all runtime and development dependencies:

```bash
./scripts/setup_python.sh
```

The supported host interpreters are Python `3.13` and `3.14`. On Windows,
install the same dependencies with `py -3.14 -m pip install -r
requirements.txt`.

The JavaScript toolchain requires Node.js `22`. The setup script validates the
major version, installs the exact lockfile with `npm ci`, and installs the
Playwright Chromium runtime.

Run Python tests only:

```bash
./scripts/test.sh
```

Run the focused, fully offline Yahoo transport regression tests:

```bash
./scripts/test.sh \
  tests/test_security_boundaries.py \
  tests/test_market_data_freshness.py
```

Run the complete quality gate:

```bash
./scripts/check.sh
```

Run the OpenAI Site tools contract, Flask rendering, and random-port disposable-browser layers:

```bash
node --test tests/test_agent_optimization.mjs
./scripts/test.sh \
  tests/test_agent_optimization.py \
  tests/test_agent_optimization_browser.py
./scripts/test_e2e.sh tests/e2e/agent-optimization.spec.mjs
```

The complete gate runs, in order:

1. Full Ruff static checks for `main.py`, `app`, `strategies`, `tests`, and
   `scripts`.
2. JavaScript syntax checks.
3. Python tests with branch coverage.
4. Node unit tests with source coverage thresholds.
5. Playwright Chromium E2E tests.

GitHub Actions runs this same script on every push and pull request through
`.github/workflows/quality.yml`. The workflow uses Node.js 22 for first-party
tests and Node.js 24-based `v7` releases of the official checkout, setup, and
artifact actions.
Failed CI browser runs upload `test-results/` as a seven-day
`playwright-failure-<python-version>` artifact. The artifact is
diagnostic evidence, not a repository fixture.

## Coverage baseline

Baseline remeasured on 28 Aug 2026 with Python `3.13.0`, pytest `9.0.3`, and
coverage.py `7.15.0`:

- Total combined statement-and-branch coverage: `71.92%` (`coverage.json`
  reports `20,331` covered lines of `26,841` statements and `6,994` covered
  branches of `11,162`).
- `app/services/dca.py`: `97.6%`, with recurring schedule, contribution
  accounting, dividend, normalization, and error paths covered by
  deterministic unit tests.
- Seven previously weak strategy variants now measure `88.4%` to `96.9%`
  through parameter-schema, signal-contract, and empty-frame tests.
- The complete gate enforces `--cov-fail-under=50` so coverage cannot silently
  regress below the current safety floor. Set `ANTIGRAVITY_COVERAGE_MINIMUM` to
  an explicit integer from `0` to `100` only when performing a deliberate local
  diagnostic run.
- Raise the threshold only after adding tests, never by excluding production modules.
- The next project target is `75%`, followed by measured module-level improvements.

Priority coverage gaps:

- `app/services/investment_import.py`: `71.0%`, with broker-specific
  reconciliation paths remaining more valuable than aggregate line gains.

Recently strengthened coverage:

- `app/services/live_trading.py`: `83.5%`, with offline CLI OAuth, the supported
  SDK order boundary, order validation, and API authorization contracts covered
  without a real account request or order.
- `app/infrastructure/broker_market_data.py`: `55.6%`, with offline Longbridge
  CLI normalization, candlestick adapters, one-minute cache freshness, and
  fail-closed refresh/status paths covered without live network or production
  store writes.

JavaScript source coverage is measured by Node's built-in test runner for the
first-party modules loaded by direct Node suites. The current baseline, remeasured on
28 Aug 2026 after adding the Agent Optimization runtime, is `51.41%` lines, `71.01%`
branches, and `85.45%` functions. The gate enforces
gradual minimums of `40%`, `60%`, and `65%`, respectively. Override them only
for an intentional diagnostic with
`ANTIGRAVITY_JS_COVERAGE_LINES_MINIMUM`,
`ANTIGRAVITY_JS_COVERAGE_BRANCHES_MINIMUM`, or
`ANTIGRAVITY_JS_COVERAGE_FUNCTIONS_MINIMUM`. This is not whole-browser bundle
coverage; assembled behavior remains independently protected by Playwright.

## Test organization

Current suite inventory remeasured on 28 Aug 2026:

- 873 Python tests collected; the latest full Python run reports 867 passed and
  6 skipped.
- 269 Node unit tests (`npm run test:js`), including the 9 shared Agent Optimization contract
  cases, shared chart-axis theme fallback priority, and direct Investment module coverage.
- 252 Playwright test cases passed through `./scripts/test_e2e.sh` on 28 Aug 2026,
  including the 2 Agent Optimization cases and parameterized viewport coverage.

- `tests/conftest.py`: shared pytest application and client fixtures.
- `tests/factories/`: deterministic market, profile, strategy, and result factories.
- `tests/test_*.py`: Python unit and Flask integration tests.
- `tests/test_app_startup.py`: portable startup contracts that do not require
  local source-evidence stores.
- `tests/test_repository_contracts.py`: documentation links and versions,
  privacy-safe historical records, JavaScript and E2E resource versions,
  tracked E2E assets, CSS import-manifest integrity, and retired-entrypoint or
  unsafe-transport tombstones.
- `tests/test_agent_optimization.py`, `tests/test_agent_optimization_browser.py`, and
  `tests/test_agent_optimization.mjs`: manifest, schema, registration, security, unsupported-client,
  and random-port browser lifecycle contracts.
- `tests/e2e/agent-optimization.spec.mjs`: project Playwright coverage for top-level Site tool
  discovery, execution, navigation, fresh-document registration, and narrow-screen fallback.
- `tests/e2e/price-comparison.spec.mjs`: adaptive Market cap linear/logarithmic scale selection,
  absolute-value preservation, missing-history gaps, and visible tier separation.
- `tests/test_compatibility_routes.py`: canonical destinations for the
  documented compatibility redirect families.
- `tests/test_e2e_locking.py`: host-level E2E ownership across worktrees,
  fail-closed direct invocation, and no-cleanup-on-lock-conflict behavior.
- `tests/test_debug_reporting.py`: opt-in local debug endpoint validation and
  sensitive-data redaction.
- `tests/test_longbridge_cli.py`: Longbridge CLI path safety and client-safe
  OAuth or connection failure feedback.
- `tests/test_runtime_error_redaction.py`: stable client failures that retain
  full unexpected-error diagnostics only in local logs.
- `tests/test_investment_data_utils.mjs`: Node unit tests for investment
  calculations, including synthetic multi-account round trips, fail-closed
  handling for incomplete histories, validated open-position snapshots,
  same-day execution chronology, cost-method alternatives, zero-cost grant
  retention, cross-account cost aggregation, and P&L conservation.
- `tests/test_longbridge_import.py` and `tests/test_longbridge_sg_import.py`:
  account-scoped synthetic performance calibrations and exact paired-file
  source-artifact bundle identities. No broker account data is required.
- Investment replay coverage also asserts booking-date-first ordering when
  execution metadata crosses a ledger day, history-only internal-transfer
  continuity, dated ending-cash boundaries, exact signed HSBC settlement
  accruals, and equality between the final chart point and the current Holdings
  endpoint. The overlap regression keeps a payable active until its own
  settlement date, the mixed-broker regression prevents a later current HSBC
  cash projection from cancelling earlier settled sale proceeds, and the
  cash-equivalent endpoint regression verifies that Overview and Holdings use
  the same valid live quote.
- `tests/test_investment_import_feedback.mjs`: trusted IBKR feedback markup,
  escaped notices, evidence-retention copy, and HSBC transfer-review plurality.
- `tests/test_investment_import.py` and `tests/test_more_page.py`: IBKR Trade
  Notifications paste parsing, Beijing-to-New York conversion, synthetic
  position-gap validation, closed-trade aggregation, closed-lot metadata
  retention across CSV/GainsKeeper deduplication,
  authoritative GainsKeeper correction,
  provisional-source pruning, GKX statement metadata, same-origin and CSRF
  rejection, route persistence, and immutable evidence materialization.
- `tests/test_zircon_hk_import.py` and `tests/test_more_page.py`: typed XLSX
  template structure, standard-export archive health, exact named ranges and
  validation ranges through the full selected scope, stable Reference ID and
  FX identity coverage, the 10,000-row boundary, full broker and
  transaction-type round trips, full broker-dropdown coverage, absence of
  Excel-repaired table and
  conditional-formatting parts, 23:00 Hong Kong date-only default,
  Hong Kong-to-New York time conversion, text-date and text-number rejection,
  formula rejection, cash-sign contracts, precise cell diagnostics, read-only
  prevalidation, isolated persistence, and immutable workbook evidence.
- `tests/test_investment_realtime.mjs`: poll lifecycle, retry timing, numeric
  parsing, alignment, and green-up/red-down transition contracts.
- `tests/test_investment_stock_details.mjs`: Stock-details range, minute,
  session, day-boundary, and shared transaction-applier contracts.
- `tests/test_investment_transaction_filters.mjs`: broker, currency, type, and
  canonical date-filter behavior.
- `tests/test_investment_transaction_table.mjs`: visible-row selection,
  descending page state, clamping, and ledger-to-page lookup.
- `tests/test_investment_layout.mjs`: split-layout measurement and clamp rules.
- `tests/test_investment_pagination.mjs`: Node unit tests for fixed five-page Investment pagination chunks and one-page arrow targets.
- `tests/test_investment_url_state.mjs`: Node unit tests for canonical Investment
  view, range, broker, table-filter, date, ticker, and pagination query state.
- `tests/test_workspace_url_state.mjs`: Node unit tests for the shared Workspace
  URL contract, including default omission, exact dates, repeated allocation
  order, backtest parameters, DCA schedule parameters, and legacy aliases.
- `tests/test_settings_url_state.mjs`: Node unit tests for canonical Settings
  sections, language tabs, pagination, default omission, and legacy aliases.
- `tests/test_table_filter_contracts.mjs`: deterministic standard-table measurement, summary-scope, and All / Buy / Sell filter tests.
- `tests/test_chart_axis_utils.mjs`: Node unit tests for shared chart tick-index helpers, `readThemeTokens` priority (CSS, explicit fallbacks, `ANTIGRAVITY_APP.theme`, empty string), and safe dynamic logo URL normalization.
- `tests/test_backtest_probability_grid.mjs`: deterministic schema and date-key validation; the fixed 36-column, six-row-per-side tooltip geometry and material contract; direct geometry and responsive symmetric Canvas-capacity clamping; stable median point-spacing resolution; integer-trading-day slots with a one-day minimum; requested-gap-as-upper-bound 1:1 square geometry; the 4 px minimum cell, 2 px cell radius, 10 px field radius, and 8 px concentric padding; exact price/time mapping; per-hover winner normalization, invisible-tail cutoff, nonlinear power opacity, extreme-magnitude scale invariance, raw-probability preservation, tied-winner, all-zero, and invalid-input behavior; curve-hit; and pin-state contracts for Bayesian Backtest overlays. The dedicated Chromium flow uses `NVDA` and later resizes to a 375 px viewport to verify the private `alpha: 0.50` non-blurred, borderless, shadowless material without changing standard Frosted Glass tokens; an instantaneous opacity update with no temporal residue; a fully opaque winner and invisible tail at multiple hover positions; stable field width while tracking; right-side placement; exact content-space mapping before and after scrolling; both-edge full-field containment on desktop and narrow screens; the shared Motion Core bouncy spring's minimum left shift; the conditional native horizontal scrollbar contained by the existing 12 px section-resizer slot with no accent-color paint; unchanged chart-stack, Canvas, and probability-grid dimensions while scrolling activates; a measurable but non-interactive resizer during that state and restored interaction after reset; exact floating visual target preservation over the browser's integral rail offset, including a rail dragged to its maximum; shared Canvas, crosshair, and tooltip alignment; zero-position reset; reserved result, chart-stage, resizer, and history geometry; price-extreme containment; narrow-screen price-span readability; real pointer movement followed by a genuine left mouse click for pinning; tracking, pinned, blank-clear, Escape-clear, and summary-hover remapping after resize; and a non-default Python presentation reaching the rendered grid geometry, radii, padding, 75%-transparent private material, custom opacity curve, and DOM metadata.
- `tests/test_bayesian_market_factors.py`: mocked Longbridge CLI chunking, optional-factor failure isolation, US/HK/SH/SZ/SG market-local trading-day normalization, availability-timestamp bounds (including rejection of report-period-only rows), retries, bounded LRU expiry, same-key single-flight, immutable status, and provenance contracts. Backtest page coverage separately verifies that a relative strategy-provider window ends on the ticker's own market-local date.
  The current Bayesian probability-grid assertions supersede the historical material checks: each side is independently bounded by `min(10, 50% of the current vertical plot height, its chart boundary)`, retains the requested 2 px gap, renders only square cells on a fully transparent no-radius container, ignores retired field-material properties, requires exact live-Y-scale price intervals, and preserves the curve Canvas range.
- `tests/test_strategy_bayesian_price_field.py`: `NVDA` default-ticker selection, daily-model and one-minute-execution capability declarations, walk-forward no-lookahead, causal volume-at-price distribution, P/E and option staleness, opt-in research-factor selection, probability-weighted realized-cell score plus event hit-rate bounds with no same-day scoring, regularized noise-floor calibration, parameter-order-independent sparse-factor selection, persistent threshold intent, finite aligned 36-column by ten-row-per-side presentation, integer-trading-day metadata, factor status and coverage, execution mode, model fingerprint, direct NumPy selection without Torch imports for `Auto`/`CPU`, explicit-GPU MPS/CUDA selection and fallback, and warmup-provider contracts.
- `tests/test_strategy_interval_bridge.py`: causal daily-final-bar signal placement, next-session first-minute execution, exchange-local US and HK session mapping, removal of daily-only presentation data from one-minute results, mixed-frequency provenance metadata, and fail-closed missing-session, duplicate-timestamp, out-of-order, or misaligned trading-date behavior.
- `tests/test_backtest_page.py`: server-rendered interval capabilities, actual-store Period normalization, daily Bayesian model loading during one-minute execution, one-minute-only refresh and read-only-cache contracts, explicit refresh-failure notices, default-on and explicit-off algorithmic stop-loss semantics, pure-price loss-exit behavior, and Simplified or Traditional Chinese stop-loss copy.
- `tests/e2e/critical-flows.spec.mjs`: the Backtest control regression uses the exact 972 by 841 desktop geometry to prove that strategy parameters remain below Strategy, the complete controls surface owns vertical scrolling, and the final private parameter remains reachable. It then verifies natural page flow and no horizontal overflow at 390 by 844. The shared `Show trade details` regression verifies the default-on state, real switch transitions, price-subplot expansion with a retained time axis, hidden equity comparison, disabled Transactions option, URL-only display persistence, and the same contract after entering DCA. A separate interval regression selects `1 year`, restores `1m`, proves the smart fallback to the final available Period option, and verifies that `Allow algorithmic stop-loss exits` is enabled by default. Mocked-presence regressions verify repeated ticker parameters, all-required-ticker `1m` gating, intersected Period lists, and that a delayed older response cannot override the latest ordered ticker snapshot.
- `tests/test_backtest_interval_sync_contract.mjs`: deterministic browser-state helper coverage verifies complete required-ticker snapshots, ordered Period intersections, strategy-declared interval capability, and monotonic stale-response rejection before state mutation.
- `tests/test_form_parsing.py`: pure workspace query parsing, portfolio weight, and navigation path contracts.
- `tests/test_settings_url_state.py`: Flask route redirects and server-rendered
  Settings tab state for canonical and legacy URLs.
- `tests/test_investment_settings.py`: isolated persistence and normalization
  tests for the Settings Investment cost-basis preference.
- `tests/test_web_market_history.py`: extracted, read-only local-history date, exchange-local trading-date, exact-range slicing, and supported-period helpers.
- `tests/test_web_strategy_forms.py`: pure strategy grouping, field-schema,
  injected factory, and Settings catalog presentation contracts.
- `tests/test_live_trading_orders.py`: PIN-session-or-token authorization,
  stable API failures, mocked Longbridge account readers, and order-validation
  contracts without a broker request or order.
- `tests/test_web_token_registry.py`: foundation-default drift, canonical
  material references, globally unique Style token registry names, and pure
  Settings design-token builder inputs.
- `tests/test_broker_market_data.py`: Longbridge normalization, CLI and SDK
  candlestick adapters, fail-closed one-minute cache freshness and completeness,
  isolated refresh/status paths, and the absence of the retired IBKR Client
  Portal transport.
- `tests/test_investment_record_basics.py`: shared import decimal and normalized-view accounting invariants.
- `tests/test_investment_import_registry.py`: parser registration, duplicate and
  unknown-format rejection, payload validation, idempotent commit, atomic
  persistence, and readback boundaries.
- `tests/test_strategy_variants.py`: behavior contracts for every formerly
  low-coverage alternative strategy without asserting implementation trivia.
- `tests/test_investment_ticker_lineage.py`, `tests/test_logos.py`, and
  Investment Playwright coverage: standard-name fallbacks, bare-US alias
  placeholders, yfinance symbol-only profile responses, and rendered Holdings
  identity labels.
- Ticker-format regressions assert that canonical persistence and presentation
  use bare US symbols, retain `.HK`, `.SH`, and `.SZ` market suffixes, and
  restrict Longbridge's `.US` and Yahoo's `.SS` spellings to their adapter
  boundaries.
- `tests/e2e/`: Playwright browser tests and inert fixtures.
  Holdings coverage also verifies that an internal subaccount bridge cannot
  reduce the actual aggregate Cash, Cash equivalents, or Total equity.
  HSBC pending-sell coverage verifies that dated cash boundaries do not create
  a false one-day equity loss; overlapping matched buy settlements verify that
  one boundary cannot clear another transaction's payable. Internal-transfer
  coverage verifies both historical bridge continuity and current Holdings
  equality.
  It also verifies that the fixed summary's realtime Today's net P&L can be
  positive while Cumulative P&L remains negative, and that both update after
  a quote poll; the same assertion covers all duplicated fixed and scrollable
  Holdings row layers.

All test sources must be committed to Git. Do not add `tests/` back to
`.gitignore`.

## Browser test isolation

Playwright starts a dedicated app server on `127.0.0.1:8699` through
`scripts/run_e2e_app.sh`. The launcher copies only Git-tracked bundled logo
assets that still exist in the working tree, then builds fixed daily,
one-minute, profile, and market-cap fixtures inside
`test-results/runtime-store`. It points both application stores at that isolated
runtime and disables remote market access for the process. Browser checks
therefore use the same deterministic history on local machines and clean GitHub
runners without reading or copying production Parquet stores. Normal manual
launches remain unchanged. The `npm run test:e2e` wrapper removes the isolated
runtime copy after Playwright exits, including failed test runs.

Only one browser suite may own port `8699` at a time. Always start it through
`./scripts/test_e2e.sh` or through `./scripts/check.sh`; a direct
`npx playwright test` invocation is rejected. The wrapper acquires a host-level
`fcntl` lock scoped to the current macOS user and port `8699`, so separate Git
worktrees cannot clean or replace one another's isolated runtime. A competing
runner exits with status `73` before changing any E2E files. Process listings
and port checks are useful diagnostics, but they are not a substitute for this
lock.

Investment-import E2E verifies broker selection, file readiness, submit
enablement, and Zircon (HK) prevalidation. Tests that click Submit intercept and
fulfill the write request in Playwright; no browser import request reaches the
isolated backend, much less the user's investment store.

The generic manual-workbook unit suite verifies paired currency conversions:
exactly two Forex trade component rows must share broker, account, timestamp,
and Reference ID; currencies must differ; and Amount signs must identify one
sold and one acquired leg. It also verifies that a later workbook corrects both
currency-scoped legs without collapsing the pair.

Investment Markdown export E2E tests must observe the downloaded file and assert its semantic column labels, declared filter scope, and filtered row/date-range alignment. Verifying only that the export button is present is insufficient.

## Python settings-store isolation

The root pytest bootstrap assigns `ANTIGRAVITY_SETTINGS_STORE_DIR` to one
process-scoped temporary directory before importing the Flask application.
This applies whether tests run through `scripts/test.sh`, `scripts/check.sh`,
or a direct root-level pytest invocation. Module-level transaction-cache,
ticker-usage, and strategy-usage paths therefore cannot resolve into the
user's production `settings_store`. Pytest removes the temporary directory at
the end of the session, including after test failures.

## Market persistence test isolation

Market-data freshness regressions patch both daily and intraday store path
resolvers into per-test temporary directories. They never replace a real QQQ or
DRAM parquet file and then attempt to restore it. This keeps the user's running
application from racing with pytest and makes repeated full-suite coverage
measurements deterministic.

Longbridge one-minute-store tests also prove that an unreadable existing cache,
including a cache that becomes unreadable while a refresh is in flight, raises
without calling the atomic parquet writer. The Bayesian Backtest path refreshes
only the one-minute cache and reports a failed refresh before using an existing
cache through the read-only loader. Tests compare the isolated file's exact
bytes before and after the attempt and compare valid cached frames with
`pd.testing.assert_frame_equal`.

Flask integration tests that exercise investment import or transaction loading patch both `INVESTMENT_STORE_PATH` and `INVESTMENT_TRANSACTIONS_CACHE_PATH` to a per-test temporary directory. A regression assertion compares the real parquet bytes before and after a synthetic IBKR import.

## Yahoo transport isolation

Yahoo transport unit tests never contact Yahoo, a corporate proxy, or any other
remote endpoint. Temporary PEM files and mocked yfinance downloads cover:

- macOS-style `HTTP_PROXY` and `HTTPS_PROXY` environments with a corporate CA;
- mocked macOS System Roots and System keychain export, caching, and fallback;
- immediate system-CA detection bypass on non-macOS platforms;
- direct-connect environments with all proxy and corporate CA variables absent;
- environment-variable precedence over `[network].yahoo_ca_pem`;
- fail-closed handling for missing or malformed enterprise CA files;
- certifi public roots remaining present in the combined CA bundle;
- `verify=True` as the unconfigured default;
- reuse of one shared curl_cffi session by the yfinance fallback;
- global 5-minute initial Yahoo rate-limit cooldown with bounded exponential
  backoff through 30 minutes, including a no-transport assertion while paused;
- one batched Investment quote request per minute, with one rotating individual
  recovery ticker rather than per-ticker polling fan-out;
- reuse of one proxy-aware, verified urllib opener by Yahoo Chart, logo, and
  Network self-check requests without changing broker or SMTP transports;
- actionable certificate-failure diagnostics without credentials or query
  secrets leaking into error messages.

These tests must remain offline and must never replace certificate verification
with `verify=False`, an unverified SSL context, or a process-wide TLS patch.

## Longbridge realtime quote contract

- Current CLI OAuth and supported SDK response shapes are covered without
  making a real broker request.
- A regular-session CLI quote remains usable when the provider omits a quote
  timestamp. The timestamp stays explicitly unknown while the independently
  known New York session date is retained.
- Provider timestamps are converted to New York display time before reaching
  the Investment frontend.
- Overnight, pre-market, regular, and post-market selection, transport failure,
  non-US and off-session short circuits, per-ticker yfinance fallback, and mixed
  provider provenance are deterministic regressions.
- Overnight regressions preserve the next NYSE trading date across the 20:00
  boundary and reject Friday and Saturday windows. Longbridge provenance is
  required for an overnight pulse; when Longbridge is unavailable, Holdings
  may retain the latest yfinance post-market quote without displaying a live
  overnight marker.
- Browser coverage verifies the actual loaded `stock-details.js` resource URL
  and module version, preventing a stale cache key from passing source-only
  assertions.

## Writing new tests

- Use canonical routes, not compatibility aliases.
- Import reusable doubles from `tests.factories.market`.
- Accept forward-compatible keyword arguments in service doubles when the production function has optional policy parameters.
- Prefer behavior assertions over cache-busting version literals or exact full HTML fragments.
- For ledger behavior, assert both the transaction result and the reconciliation invariant.
