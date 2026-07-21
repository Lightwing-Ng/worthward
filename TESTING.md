# Testing guide

Documentation version: `v1.3.9`

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

1. Ruff critical-error checks.
2. JavaScript syntax checks.
3. Python tests with branch coverage.
4. Node unit tests.
5. Playwright Chromium E2E tests.

## Coverage baseline

Baseline remeasured on 21 Jul 2026 with Python `3.13`, pytest `9.0.2`, pytest-cov `7.1.0`, and coverage.py `7.15.0`:

- Total combined statement and branch coverage: `53.6%` (pytest-cov `TOTAL` line from the latest full gate; `coverage.json` reports `10,380` covered of `18,168` statements).
- `app/services/dca.py`: `97.5%`, with recurring schedule, contribution accounting, dividend, normalization, and error paths covered by deterministic unit tests.
- The complete gate enforces `--cov-fail-under=50` so coverage cannot silently
  regress below the current safety floor. Set `ANTIGRAVITY_COVERAGE_MINIMUM` to
  an explicit integer from `0` to `100` only when performing a deliberate local
  diagnostic run.
- Raise the threshold only after adding tests, never by excluding production modules.
- The next project target is `55%`, followed by measured module-level improvements.

Priority coverage gaps:

- Alternative strategy implementations: approximately `9%` to `14%`.
- `app/infrastructure/ibkr_flex.py`: approximately `21.4%`.
- `app/infrastructure/broker_market_data.py`: approximately `33.9%`.
- `app/services/live_trading.py`: approximately `45.2%`.

## Test organization

Current suite inventory remeasured on 20 Jul 2026:

- 358 Python tests collected (`./scripts/test.sh --collect-only -q`); the latest
  full Python run reports 352 passed, 6 skipped, and 7 subtests passed.
- 41 Node unit tests (`npm run test:js`), including shared chart-axis theme
  fallback priority coverage.
- 65 Playwright test cases listed by `npx playwright test --list`, generated
  from 57 explicit top-level `test(...)` declarations with parameterized
  viewport coverage.

- `tests/conftest.py`: shared pytest application and client fixtures.
- `tests/factories/`: deterministic market, profile, strategy, and result factories.
- `tests/test_*.py`: Python unit and Flask integration tests.
- `tests/test_investment_data_utils.mjs`: Node unit tests for investment calculations.
- `tests/test_investment_pagination.mjs`: Node unit tests for fixed five-page Investment pagination chunks and one-page arrow targets.
- `tests/test_table_filter_contracts.mjs`: deterministic standard-table measurement, summary-scope, and All / Buy / Sell filter tests.
- `tests/test_chart_axis_utils.mjs`: Node unit tests for shared chart tick-index helpers and `readThemeTokens` priority (CSS, explicit fallbacks, `ANTIGRAVITY_APP.theme`, empty string).
- `tests/test_form_parsing.py`: pure workspace query parsing, portfolio weight, and navigation path contracts.
- `tests/test_investment_record_basics.py`: shared import decimal and normalized-view accounting invariants.
- `tests/e2e/`: Playwright browser tests and inert fixtures.

All tests are committed to Git. Do not add `tests/` back to `.gitignore`.

## Browser test isolation

Playwright starts a dedicated app server on `127.0.0.1:8699` through
`scripts/run_e2e_app.sh`. The launcher copies `market_store` into
`test-results/runtime-store`, points `settings_store` to an empty isolated
directory, and disables remote market access for that process. Browser tests
therefore cannot alter the user's production stores or depend on Yahoo,
Longbridge, a corporate proxy, or transient rate limits. Normal manual launches
remain unchanged. The `npm run test:e2e` wrapper removes the isolated runtime
copy after Playwright exits, including failed test runs.

The investment-import E2E verifies broker selection, file readiness, and submit enablement but does not submit the form. This prevents mutation of the real local investment store.

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
