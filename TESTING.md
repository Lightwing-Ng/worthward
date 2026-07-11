# Testing guide

Documentation version: `v1.2.0`

## Supported commands

Install all runtime and development dependencies:

```bash
./scripts/setup_python.sh
```

Run Python tests only:

```bash
./scripts/test.sh
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

Baseline captured on 11 Jul 2026 with Python `3.13`, pytest `9.0.2`, pytest-cov `7.1.0`, and coverage.py `7.15.0`:

- Total statement and branch coverage: `46.2%`.
- The initial gate records coverage with `--cov-fail-under=0` so adoption does not hide existing gaps.
- Raise the threshold only after adding tests, never by excluding production modules.
- Recommended increments: `35%`, `40%`, `45%`, then the measured baseline rounded down.

Priority coverage gaps:

- `app/services/dca.py`: approximately `8.6%`.
- Alternative strategy implementations: approximately `9%` to `14%`.
- `app/infrastructure/ibkr_flex.py`: approximately `21.4%`.
- `app/infrastructure/broker_market_data.py`: approximately `30.3%`.
- `app/services/live_trading.py`: approximately `37.7%`.

## Test organization

- `tests/conftest.py`: shared pytest application and client fixtures.
- `tests/factories/`: deterministic market, profile, strategy, and result factories.
- `tests/test_*.py`: Python unit and Flask integration tests.
- `tests/test_investment_data_utils.mjs`: Node unit tests for investment calculations.
- `tests/test_table_filter_contracts.mjs`: deterministic standard-table measurement, summary-scope, and All / Buy / Sell filter tests.
- `tests/e2e/`: Playwright browser tests and inert fixtures.

All tests are committed to Git. Do not add `tests/` back to `.gitignore`.

## Browser test isolation

Playwright starts a dedicated app server on `127.0.0.1:8699` through the `ANTIGRAVITY_PORT` override. This avoids reusing a developer server on port `8688`.

The investment-import E2E verifies broker selection, file readiness, and submit enablement but does not submit the form. This prevents mutation of the real local investment store.

Flask integration tests that exercise investment import or transaction loading patch both `INVESTMENT_STORE_PATH` and `INVESTMENT_TRANSACTIONS_CACHE_PATH` to a per-test temporary directory. A regression assertion compares the real parquet bytes before and after a synthetic IBKR import.

## Writing new tests

- Use canonical routes, not compatibility aliases.
- Import reusable doubles from `tests.factories.market`.
- Accept forward-compatible keyword arguments in service doubles when the production function has optional policy parameters.
- Prefer behavior assertions over cache-busting version literals or exact full HTML fragments.
- For ledger behavior, assert both the transaction result and the reconciliation invariant.
