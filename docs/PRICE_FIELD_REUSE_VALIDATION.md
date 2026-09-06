# Price Field reuse validation

Documentation version: `v1.0.0`
Validation date: `6 Sep 2026`

## Outcome

Bayesian and LSTM share a controller lifecycle and an injectable distribution
boundary. Existing probability geometry and model training remain unchanged.

## Scope and preserved state

- Checkout: `/Users/example/Desktop/worthward`, branch `main`.
- Starting HEAD: `262b29d366c5bbf16271f9d6c7d836a4bf2901e9`.
- Existing optimization/tuning/documentation/gate changes and unrelated browser
  test changes were preserved. The ongoing documentation-validation task owns
  its separate temporary checkout and E2E processes.
- Intentional changes: `backtest.js`, `backtest/chart-controller.js`,
  `backtest/distributions.js`, `backtest/probability-grid.js`, template script
  ordering/cache keys, associated tests, and Architecture ownership documentation.
- `scripts/test_js.sh` retains existing edits and adds distribution source coverage.
- `strategies/price_field_contract.py` changes its ownership comment only; its
  code version and runtime behavior are unchanged.
- No production stores, broker data, or credentials were intentionally written.
  Test applications use the repository's isolated runtime wrapper.
- User-owned port `8688`, PID `51286`, was not restarted or replaced.
- Changes are uncommitted. Reverse only this task's exact hunks; do not reset the
  working tree or overwrite pre-existing edits.

## Versions and boundaries

- `backtest.js`: `v0.41.1`, workspace preferences/tabs/share/controller wiring.
- `chart-controller.js`: `v1.0.0`, synchronized charts and probability DOM,
  events, caches, observers, scheduled work, and lifecycle.
- `distributions.js`: `v1.0.0`, Gaussian/AR(1) adapter and immutable local registries.
- `probability-grid.js`: `v0.30.0`, geometry/cells/opacity/reducer; legacy math
  exports delegate to the distribution module.
- `base.html`: `v0.33.19`, load distributions before grid and controller before entry.
- `Architecture`: `v1.77.2`, corrected ownership and extension constraints.
- `scripts/test_js.sh`: `v1.4.1`, retain coverage for extracted probability math.

The controller accepts the same DOM/chart shell; this is not an arbitrary chart
framework. A new distribution still supplies the v1 aligned predictive envelope.
Explicit unknown distribution kinds do not silently use Gaussian math.

## Verification

- `node --test tests/test_backtest_probability_grid.mjs tests/test_chart_axis_utils.mjs`:
  exit `0`, 58 passed.
- `./scripts/test.sh tests/test_price_field_contract.py tests/test_layout_anchor_contract.py`:
  exit `0`, 36 passed in 1.20s on the final focused replay.
- `WORTHWARD_PYTHON=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13 ./scripts/test.sh tests/test_repository_contracts.py`:
  exit `0`, 12 passed.
- `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs tests/e2e/bayesian-endpoint-stability.spec.mjs tests/e2e/lstm-guide-alignment.spec.mjs`:
  exit `0`, 15 passed. Covered canonical Backtest routes for both strategies,
  desktop/narrow geometry, drag, fixed-axis/cursor alignment, endpoint stability,
  and repeated controller mounting/disposal. Log: `/tmp/worthward-price-field-e2e.log`.
- The added custom-distribution browser case initially queried hover cells without
  activating hover and failed its nonempty-cell precondition. Its replay now
  supplies the existing isolated presentation fixture and activates curve hover.
- A replay attempt exited `73`: E2E owner PID `84616` belonged to the separate
  documentation-validation checkout. Its server and runtime were preserved.
- `./scripts/check.sh` initially exited `1` before running tests because the
  default Python 3.14 lacked Ruff/pytest-cov. The prepared Python 3.13 interpreter
  was explicitly selected for the subsequent full gate; no dependencies installed.
- `WORTHWARD_PYTHON=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13 ./scripts/check.sh`:
  Python static checks, JavaScript syntax, Python coverage tests, and JavaScript
  coverage tests passed. The wrapper exited `73` at its browser stage because
  PID `84616` still owned the shared E2E port/runtime. This is an ownership
  conflict, not a completed green gate. JavaScript coverage: 54.29% lines,
  71.90% branches, 86.33% functions. The terminal output was truncated, so no
  full-suite pass count is inferred from collection inventory.
- `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs --grep 'controller'`:
  final exit `0`, 3 passed in 17.9s after the competing owner released its lock.
  Actual browser DOM verified custom cell mass `0.25`, direction text `75.0%`,
  explicit unknown-kind rejection, model restoration, and desktop/narrow
  remount/disposal. Log: `/tmp/worthward-price-field-adapter-final.log`.
- Independent snapshot gate: `/private/tmp/worthward-isolated-final-gate.log`
  ended with `Quality gate passed.` and 325 Chromium cases passed. It also
  reported 1,182 Python cases passed, 6 skipped, 216 subtests passed, and
  328 Node cases passed with no failures. These are the other task's measured
  snapshot results, not the current checkout's uninterrupted gate result.
  The snapshot's entry/grid/distribution/template sources were byte-identical to
  this task's final sources. Its controller differed only in passing `{mean,
  scale, horizon: 1}` rather than `{...baseModel, horizon: 1}` to the direction
  adapter. The final 3-case replay above verifies that final adapter delta.
- `git diff --check`: exit `0`. Final controller and test syntax checks passed.
  Documentation-only edits followed the gate; product source did not change
  after the final controller replay.
- Final HEAD remains `262b29d366c5bbf16271f9d6c7d836a4bf2901e9`.
  No commit was created by this task. Port `8699` has no listener and all
  task-owned test processes have stopped; user-owned `8688` was preserved.

## Housekeeping and synchronization

Ten numbered-copy candidates were found: six byte-distinct coverage copies and
four protected investment-cache copies. All were retained; no cleanup or recovery
moves were made. Metadata and hashes: `/tmp/worthward-price-field-housekeeping.json`.
Final source/diff and service checks passed. The final root rescan retained the
same 10 candidates; no files were moved or deleted.

The central shared UI ledger records this product-specific controller boundary.
No equivalent Price Field implementation was found in agenticContext and no
sibling source was modified.
Sibling UI sync pending: review the controller lifecycle and distribution contract
in agenticContext if an equivalent probability-field surface is introduced.
