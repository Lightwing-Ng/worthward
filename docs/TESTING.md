# Testing guide

Documentation version: `v1.42.4`

## Bayesian Price Field detail view coverage

The isolated Chromium Backtest flow verifies that the Bayesian `Price Field`
option sits between `Metrics` and `Transactions`, that selecting it preserves
both existing views, follows the active hover index, preserves the shared
probability model and live price scale, preserves square cells and the 2px lattice gap,
and retains the last valid field after hover is cleared. It also checks the
bar-gradient legend, Settings-formatted forecast dates, edge-aware tick
placement, the live price axis, accessible state, and narrow-layout geometry.
The detail contract also requires that green cells stay wholly above the live
price guide and red cells wholly below it, including the first render after a
layout change. An edge-adjacent hover regression proves that the floating field
may be boundary-capped while the detail panel still renders the complete
strategy-owned row lattice and contains it within the detail viewport on
desktop and narrow layouts.
Hovering a detail row must expose its exact price interval and the sum of all
raw row probabilities across the complete forecast horizon through the hovered
row's native hover label, with threshold-hidden cells included in that sum. The
detail heading contract also checks that the status line contains only `Selected
date: D Mmm yyyy`, the probability legend shares that row at the trailing edge,
and the redundant `Forecast date` axis title is absent while forecast-date ticks
remain; clearing a row hover restores the date-only status and original cell
labels.
The probability-grid unit contract additionally verifies the private 0–50%
absolute cell-display threshold, default 5% value, inclusive boundary, and
unchanged cell geometry; strategy tests verify that changing this parameter
does not change predictions, signals, or post-hoc scores.
It also verifies that longer ranges carry the trailing three-month reference
target for integer-day cell sizing. Strategy/provider regressions cover the
alphabetically ordered granular Options controls, independent selection without
the composite factor, one shared historical `option volume daily` fetch, all
Longbridge volume/open-interest fields, raw-ratio fallback, and backward as-of
staleness boundaries. Real-time-only option contract quote fields must not be
introduced into the historical feature matrix. Longer ranges must preserve the
three-month reference cell size through integer trading-day quantization.

The overview-hover regression also covers the `show_trade_details=0` path:
hidden Price Field detail cells stay untouched during repeated pointer moves,
the hidden equity Chart.js instance is not updated, and only the visible
probability field is refreshed. It also moves the pointer in one-pixel steps
while the right-edge field is active and verifies that the visual pan does not
amplify that input; the chart stack remains the stationary interaction surface
after the translated canvas leaves the pointer location.

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
- `tests/test_backtest_probability_grid.mjs`: deterministic schema and date-key validation for the fixed 20-column tooltip; actual-cell-size minimum-plot-height derivation; independent up-to-10-row clamping by the 50% current-plot cap and the relevant chart boundary; the opt-in complete-row geometry used by the detail surface; stable median point spacing; integer-trading-day slots with a one-day minimum; fixed 2 px logical guide-to-first-cell and cell-to-cell gaps with 1:1 square geometry; exact price/time mapping; 4 px cell floor, no-radius transparent matrix, 8 px top, bottom, and trailing padding; nonlinear per-hover opacity normalization; and curve-hit plus pin-state contracts. The dedicated Chromium flow uses `NVDA`, checks the transparent matrix without changing Frosted Glass tokens, proves the dynamic Backtest resizer lower bound preserves a real near-midpoint forecastable point at full 10-by-10 density, exercises a real pointer drag with a pinned field, preserves exact content-space mapping through the temporary scroll rail, and verifies tracking, pin, blank-clear, Escape-clear, resize, and narrow-screen behavior.
- `tests/test_bayesian_market_factors.py`: mocked Longbridge CLI chunking, optional-factor failure isolation, US/HK/SH/SZ/SG market-local trading-day normalization, availability-timestamp bounds (including rejection of report-period-only rows), current Dynamic P/E snapshot date binding without historical backfill, retries, bounded LRU expiry, same-key single-flight, immutable status, and provenance contracts. Backtest page coverage separately verifies that a relative strategy-provider window ends on the ticker's own market-local date.
  The current Bayesian probability-grid assertions supersede historical material checks: the floating field sides are independently bounded by `min(10, floor(50% of current plot height capacity), floor(its chart-boundary distance in complete slots))`, while the contained detail panel renders the complete strategy-owned row counts and scales them without clipping; the field fixes 20 columns, actual quantized cell size determines the private dynamic stage minimum passed to the generic resizer, square cells map through the live Y scale and integer-day width exactly, and the transparent no-radius matrix leaves the curve Canvas range and global Frosted Glass tokens unchanged. The shared resizer callback is verified after Chart.js resize, including a real pointer drag while the field is pinned. Desktop and narrow tests permit only true viewport-fit reductions; they never permit distorted cells, gaps, or fractional bars.
- `tests/test_parallel.py`: bounded worker sizing, deterministic ordered results, spawn-process execution, contiguous batch argument handling, and safe thread fallback for unpicklable CPU tasks.
- `tests/test_strategy_bayesian_price_field.py`: `NVDA` default-ticker selection, alphabetical quantitative-factor parameter ordering, daily-model and one-minute-execution capability declarations, walk-forward no-lookahead for price, historical P/E, Dynamic P/E, options, and research observations; causal volume-at-price distribution; causal-model-lattice realized-cell score and coverage with no same-day scoring; regularized noise-floor calibration; fail-closed research-factor statuses; finite aligned 20-column presentation; integer-trading-day metadata; execution mode; model fingerprint; two-decimal threshold form rendering; adaptive Auto CPU/GPU heterogeneous execution; explicit GPU MPS/CUDA selection; whole-run CPU recomputation after GPU failure; bounded CPU worker selection; process-executor reporting; and serial-versus-parallel result equivalence.
- `tests/test_strategy_variants.py`: signal-result contracts for the kNN, Lorentzian, and SuperTrend variants, parallel-versus-serial causal prediction equivalence, and future-perturbation invariance before the perturbation boundary.
- `tests/test_strategy_interval_bridge.py`: causal daily-final-bar signal placement, next-session first-minute execution, exchange-local US and HK session mapping, removal of daily-only presentation data from one-minute results, mixed-frequency provenance metadata, and fail-closed missing-session, duplicate-timestamp, out-of-order, or misaligned trading-date behavior.
- `tests/test_backtest_page.py`: server-rendered interval capabilities, actual-store Period normalization, daily Bayesian model loading during one-minute execution, one-minute-only refresh and read-only-cache contracts, explicit refresh-failure notices, default-on and explicit-off algorithmic stop-loss semantics, pure-price loss-exit behavior, and Simplified or Traditional Chinese stop-loss copy.
- `tests/e2e/critical-flows.spec.mjs`: the Backtest control regression uses the exact 972 by 841 desktop geometry to prove that strategy parameters remain below Strategy, the complete controls surface owns vertical scrolling, and the final private parameter remains reachable. It then verifies natural page flow and no horizontal overflow at 390 by 844. The shared `Show trade details` regression verifies the default-on state, real switch transitions, price-subplot expansion with a retained time axis, hidden equity comparison, disabled Transactions option, URL-only display persistence, and the same contract after entering DCA. A separate interval regression selects `1 year`, restores `1m`, proves the smart fallback to the final available Period option, and verifies that `Allow algorithmic stop-loss exits` is enabled by default. Mocked-presence regressions verify repeated ticker parameters, all-required-ticker `1m` gating, intersected Period lists, and that a delayed older response cannot override the latest ordered ticker snapshot.
- `tests/e2e/backtest-strategy-params-memory.spec.mjs`: the Backtest strategy-parameter memory regression verifies browser-local persistence across reloads, strategy-scoped values for Grid Trading and DCA, and explicit URL parameters taking precedence without changing the remembered value.
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

When remote access is disabled, Bayesian Price Field loads its daily OHLCV model
input from that existing local store and marks Longbridge-only factors
unavailable. This keeps the Backtest renderer deterministic without enabling
network access or inventing market data in CI.

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
