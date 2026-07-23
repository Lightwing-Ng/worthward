# Testing guide

Documentation version: `v1.8.5`

## Supported commands

Install all runtime and development dependencies:

```bash
./scripts/setup_python.sh
```

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

The complete gate runs, in order:

1. Full Ruff static checks for `app`, `strategies`, `tests`, and `scripts`.
2. JavaScript syntax checks.
3. Python tests with branch coverage.
4. Node unit tests with source coverage thresholds.
5. Playwright Chromium E2E tests.

GitHub Actions runs this same script on every push and pull request through
`.github/workflows/quality.yml`. The workflow uses Node.js 22 for first-party
tests and Node.js 24-based `v7` releases of the official checkout, setup, and
artifact actions.

## Coverage baseline

Baseline remeasured on 23 Jul 2026 with Python `3.13.0`, pytest `9.0.3`, and coverage.py `7.15.0`:

- Total combined statement-and-branch coverage: `61.3%` (`coverage.json`
  reports `11,935` covered lines of `18,212` statements and `3,673` covered
  branches of `7,260`).
- `app/services/dca.py`: `97.5%`, with recurring schedule, contribution accounting, dividend, normalization, and error paths covered by deterministic unit tests.
- Seven previously weak strategy variants now measure `88.4%` to `96.9%`
  through parameter-schema, signal-contract, and empty-frame tests.
- The complete gate enforces `--cov-fail-under=50` so coverage cannot silently
  regress below the current safety floor. Set `ANTIGRAVITY_COVERAGE_MINIMUM` to
  an explicit integer from `0` to `100` only when performing a deliberate local
  diagnostic run.
- Raise the threshold only after adding tests, never by excluding production modules.
- The next project target is `62%`, followed by measured module-level improvements.

Priority coverage gaps:

- `app/services/live_trading.py`: `32.8%`.
- `app/infrastructure/broker_market_data.py`: `44.0%` after removing the
  unreachable IBKR Client Portal transport.
- `app/services/investment_import.py`: `51.9%`, with broker-specific
  reconciliation paths remaining more valuable than aggregate line gains.

JavaScript source coverage is measured by Node's built-in test runner for the
first-party modules loaded by direct Node suites. The current baseline is
`43.41%` lines, `62.93%` branches, and `70.25%` functions. The gate enforces
gradual minimums of `40%`, `60%`, and `65%`, respectively. Override them only
for an intentional diagnostic with
`ANTIGRAVITY_JS_COVERAGE_LINES_MINIMUM`,
`ANTIGRAVITY_JS_COVERAGE_BRANCHES_MINIMUM`, or
`ANTIGRAVITY_JS_COVERAGE_FUNCTIONS_MINIMUM`. This is not whole-browser bundle
coverage; assembled behavior remains independently protected by Playwright.

## Test organization

Current suite inventory remeasured on 23 Jul 2026:

- 437 Python tests collected; the latest full Python run reports 431 passed,
  6 skipped, and 52 subtests passed.
- 72 Node unit tests (`npm run test:js`), including shared chart-axis theme
  fallback priority and direct Investment module coverage.
- 76 Playwright test cases listed by `npx playwright test --list`, including
  parameterized viewport coverage.

- `tests/conftest.py`: shared pytest application and client fixtures.
- `tests/factories/`: deterministic market, profile, strategy, and result factories.
- `tests/test_*.py`: Python unit and Flask integration tests.
- `tests/test_app_startup.py`: fail-closed application-startup source-evidence scans.
- `tests/test_debug_reporting.py`: opt-in local debug endpoint validation and
  sensitive-data redaction.
- `tests/test_longbridge_cli.py`: Longbridge CLI path safety and client-safe
  OAuth or connection failure feedback.
- `tests/test_runtime_error_redaction.py`: stable client failures that retain
  full unexpected-error diagnostics only in local logs.
- `tests/test_investment_data_utils.mjs`: Node unit tests for investment calculations.
- `tests/test_investment_realtime.mjs`: poll lifecycle, retry timing, numeric
  parsing, alignment, and green-up/red-down transition contracts.
- `tests/test_investment_stock_details.mjs`: Stock-details range, minute,
  session, and day-boundary contracts.
- `tests/test_investment_transaction_filters.mjs`: broker, currency, type, and
  canonical date-filter behavior.
- `tests/test_investment_transaction_table.mjs`: visible-row selection,
  descending page state, clamping, and ledger-to-page lookup.
- `tests/test_investment_layout.mjs`: split-layout measurement and clamp rules.
- `tests/test_investment_pagination.mjs`: Node unit tests for fixed five-page Investment pagination chunks and one-page arrow targets.
- `tests/test_table_filter_contracts.mjs`: deterministic standard-table measurement, summary-scope, and All / Buy / Sell filter tests.
- `tests/test_chart_axis_utils.mjs`: Node unit tests for shared chart tick-index helpers and `readThemeTokens` priority (CSS, explicit fallbacks, `ANTIGRAVITY_APP.theme`, empty string).
- `tests/test_form_parsing.py`: pure workspace query parsing, portfolio weight, and navigation path contracts.
- `tests/test_web_market_history.py`: extracted, read-only local-history date and supported-period helpers.
- `tests/test_web_strategy_forms.py`: pure strategy grouping, field-schema,
  injected factory, and Settings catalog presentation contracts.
- `tests/test_web_token_registry.py`: foundation-default drift, canonical
  material references, and globally unique Style token registry names.
- `tests/test_broker_market_data.py`: Longbridge normalization, fail-closed
  one-minute cache persistence safeguards, and the absence of the retired IBKR
  Client Portal transport.
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

All tests are committed to Git. Do not add `tests/` back to `.gitignore`.

## Browser test isolation

Playwright starts a dedicated app server on `127.0.0.1:8699` through
`scripts/run_e2e_app.sh`. The launcher copies only bundled logo assets, then
builds fixed daily, one-minute, profile, and market-cap fixtures inside
`test-results/runtime-store`. It points both application stores at that isolated
runtime and disables remote market access for the process. Browser checks
therefore use the same deterministic history on local machines and clean GitHub
runners without reading or copying production Parquet stores. Normal manual
launches remain unchanged. The `npm run test:e2e` wrapper removes the isolated
runtime copy after Playwright exits, including failed test runs.

The investment-import E2E verifies broker selection, file readiness, and submit enablement but does not submit the form. This prevents mutation of the real local investment store.

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
without calling the atomic parquet writer. Tests compare the isolated file's
exact bytes before and after the attempt and compare valid cached frames with
`pd.testing.assert_frame_equal`.

Flask integration tests that exercise investment import or transaction loading patch both `INVESTMENT_STORE_PATH` and `INVESTMENT_TRANSACTIONS_CACHE_PATH` to a per-test temporary directory. A regression assertion compares the real parquet bytes before and after a synthetic IBKR import.

## Yahoo transport isolation

Yahoo transport unit tests never contact Yahoo, a corporate proxy, or any other
remote endpoint. Temporary PEM files and mocked yfinance downloads cover:

- macOS-style `HTTP_PROXY` and `HTTPS_PROXY` environments with a corporate CA;
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

- Current CLI OAuth and legacy SDK payload shapes are covered without making a
  real broker request.
- A regular-session CLI quote remains usable when the provider omits a quote
  timestamp. The timestamp stays explicitly unknown while the independently
  known New York session date is retained.
- Provider timestamps are converted to New York display time before reaching
  the Investment frontend.
- Pre-market, regular, and post-market selection, transport failure, non-US and
  off-session short circuits, per-ticker yfinance fallback, and mixed provider
  provenance are deterministic regressions.
- Browser coverage verifies the actual loaded `stock-details.js` resource URL
  and module version, preventing a stale cache key from passing source-only
  assertions.

## Writing new tests

- Use canonical routes, not compatibility aliases.
- Import reusable doubles from `tests.factories.market`.
- Accept forward-compatible keyword arguments in service doubles when the production function has optional policy parameters.
- Prefer behavior assertions over cache-busting version literals or exact full HTML fragments.
- For ledger behavior, assert both the transaction result and the reconciliation invariant.
