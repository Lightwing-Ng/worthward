# Historical testing evidence

Documentation version: `v1.0.0`

These dated observations are historical evidence, not the current gate status.
Use [Testing](TESTING.md) for commands and isolation contracts.

## CI environment isolation on 6 Sep 2026

The all-enabled-strategy page regression supplies deterministic market datasets
to both Bayesian and LSTM Price Field loaders. It asserts that the LSTM market
bundle loader is never called, so installed Longbridge tools and local market
caches cannot mask a missing test double. Rendering assertions remain inside
each strategy subtest so failures identify the responsible strategy.

The Neural Engine fallback regression explicitly covers unsupported hardware
and Apple Silicon with missing optional packages. Both cases must resolve to
CPU without claiming confirmed Neural Engine execution, and each must retain
its specific fallback reason regardless of the test host.

## Shared disclosure icon refactor on 5 Sep 2026

Every native `details > summary` disclosure now uses a trailing two-column
affordance. The closed state uses
`arrowtriangle.down.circle.svg` rotated to point right; the open state uses
`arrowtriangle.down.circle.fill.svg` pointing down. The text remains in the first
column, so Backtest parameters, Strategy, Settings strategy cards, and the Style
tokens specimen keep the same left edge at desktop and narrow widths. The icon
size, gap, masks, and spatial transition are shared tokens; the Settings mobile
branch now keeps the same grid contract instead of overriding it with flex.

`tests/test_price_field_contract.py` and the layout-anchor contracts pass. The
isolated `tests/e2e/collapse-trailing-icons.spec.mjs` passes four cases at 1,138px
and 390px in light and dark modes, including keyboard open/close, exact asset
masks, text alignment, and zero horizontal overflow. `shared-backtest-controls`
also passes in both modes and widths. Final focused JavaScript validation passes
324 tests. The complete gate passes 1,159 Python tests and 324 JavaScript tests;
Chromium passes 322 tests, with one pre-existing Holdings/history Market value
alignment failure at 856px (4.25px edge delta) outside this component change.

## External audit challenge on 5 Sep 2026

Starting source: clean `main` at `c17dd71b`. The external report's five failures
were reproduced on this checkout rather than accepted from historical records.
The report's 60-second training description is stale: the current runner requires
180 seconds. Saved-case selection restores configuration, not frozen weights.
Missing live evidence is a verification limitation, not a severity-ranked defect.

Changes: Investment entry diagnostics v2.136.2 and a repository drift regression;
Backtest v0.40.1 measured detail-axis alignment and cancellation of a pending
Equity leave callback on Price re-entry; trade.css v3.61.2 reserves a rail only
for a visible output drawer. Browser assertions preserve the established 2px
padding and zero-threshold positive-probability behavior. The pan test uses an
interior origin and independently resolves the post-pan point under the cursor.
Existing endpoint coverage remains intact. Cache queries and operator training
budget documentation were synchronized.

Completed focused commands:

- `./scripts/test.sh tests/test_strategy_tuning.py tests/test_lstm_training.py tests/test_price_field_contract.py tests/test_backtest_page.py tests/test_layout_anchor_contract.py tests/test_repository_contracts.py`: exit 0, 177 passed and 16 subtests passed in 35.23 seconds before edits.
- `./scripts/test.sh tests/test_repository_contracts.py tests/test_layout_anchor_contract.py`: exit 0, 40 passed after edits.
- `./scripts/test_e2e.sh tests/e2e/backtest-share-layout.spec.mjs tests/e2e/critical-flows.spec.mjs --grep 'Backtest output control|Neo stock-details composition|Bayesian Price Field axes|compact numeric display and Backtest|renders, pans, pins'`: baseline exit 1, all five failed. First correction run: exit 1, three passed and two failed; the share control, module version, and spacing cases passed.
- `./scripts/test_e2e.sh tests/e2e/critical-flows.spec.mjs --grep 'Bayesian Price Field axes|renders, pans, pins'`: the measured axis passed; the remaining interaction test exposed additional stale pan assumptions and a real Equity-to-Price callback race.
- `./scripts/test_e2e.sh tests/e2e/critical-flows.spec.mjs --grep 'renders, pans, pins'`: final focused exit 0, one passed in 38.6 seconds, including pan, pin, clear, and return from Equity.
- `node --check app/web/static/assets/js/backtest.js` and `git diff --check`: exit 0.

Read-only 8688 checks preserved user-owned PID 37665 and returned HTTP 200 for
About and the current Investment/Backtest scripts. This is asset-serving evidence,
not proof that an existing browser tab refreshed or that real training ran.
No production training, deletion, broker import, or order was submitted. E2E used
the supported isolated runtime. Ten differing numbered files were retained:
six coverage histories and four protected investment-cache files. No cleanup or
sibling source change was performed. Evidence logs use the local prefix
`/tmp/worthward-audit-`; the housekeeping inventory is
`/tmp/worthward-audit-housekeeping.json`.

Final complete-gate result on 5 Sep 2026:

- `./scripts/check.sh`: exit 1. Python: 1,157 passed, six skipped, 180 subtests
  passed in 322.26 seconds; total coverage 73.7%. JavaScript: all 319 passed.
  Chromium: 304 passed, four failed in 12.8 minutes. All five original audited
  failures passed in this run. The final Price re-entry fix landed during the
  Python stage, before the JavaScript and browser stages; its syntax was also
  checked separately.
- Failures were the obsolete 24px Style-token stepper expectation, Holdings/history
  Market value edge alignment, a notification-close click missing the new hover
  precondition, and the LSTM test's old Backtest asset-version expectation.
- After test-only corrections, `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs tests/e2e/critical-flows.spec.mjs --grep 'copies every Style token|aligns Holdings Market value|narrow Backtest tables scrollable|stays square at 390px'`:
  exit 1, three passed and one failed in 34.1 seconds. The remaining failure is
  Holdings alignment. No tolerance was relaxed and no force-click was used.
- A final diagnostic refinement reports the numeric edge difference instead of
  a boolean. `./scripts/test_e2e.sh tests/e2e/critical-flows.spec.mjs --grep 'aligns Holdings Market value'`
  still exits 1: at 856px, the largest Market value edge difference is 4.25px,
  exceeding the existing 1px contract. Both selectors address the correct column.
  This is an unresolved layout finding, not a financial-calculation finding;
  untouched-baseline attribution was not established. No Investment layout or
  accounting code was changed to hide it.

The complete gate was not repeated after these test-only corrections and final
documentation edits. This remains a non-green gate, with one reproduced open
browser finding. The audit runtime fixes were exercised in the complete gate; later test changes
have focused coverage. Final inspection also found a concurrent change in
`backtest.js` that avoids highlighting hidden transaction rows, and its assertion
in `tests/test_layout_anchor_contract.py`. Those edits were preserved; their
author and exact timing relative to the gate were not established, so the gate
does not certify the complete final shared checkout. The final layout/repository
replay passed 40 tests. Starting/final HEAD remains `c17dd71b`, branch `main`;
all edits are uncommitted and there were no initial dirty source files. Changes
are limited to README, Architecture/Testing/Known Issues, Backtest/Investment
scripts, trade.css and its cache manifest/templates, and the repository/critical-
flow/LSTM tests. The external shared UI ledger records the pending sibling
output-rail verification. No sibling source or user-owned service was changed.

## Price Field future dragging and saved-case selection

On 5 Sep 2026, `backtest.js` v0.40.0 and `lstm-training.js` v0.9.0 added
future-column dragging, a fixed price axis, visible blue coordinate badges,
threshold-empty feedback, and stable saved-configuration navigation. Saved
records still restore settings rather than frozen neural weights or predictions.

- `./scripts/test.sh tests/test_lstm_training.py tests/test_price_field_contract.py tests/test_layout_anchor_contract.py tests/test_repository_contracts.py`:
  exit 0, 93 passed in 1.79 seconds on that completed run's source state.
  A later `./scripts/test.sh tests/test_repository_contracts.py` repeat exited 1
  with ten passes and one failure after concurrent Investment CSS advanced to
  v1.78.8 while its E2E assertion still expected 1.78.7. Those concurrent files
  were not rewritten by this Price Field task.
- `npm run test:js`: exit 0, 319 passed. Final changed bundles and the LSTM
  browser specification also passed `node --check`; `git diff --check` passed.
- `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs tests/e2e/lstm-guide-alignment.spec.mjs tests/e2e/bayesian-endpoint-stability.spec.mjs tests/e2e/critical-flows.spec.mjs --grep 'future drag|threshold-empty|history selects|pins the Bayesian overview origin|right-half hover frame|28 and 29 Jul|final curve endpoint|server-side LSTM Price Field'`:
  exit 0, nine passed in 1.8 minutes. Coverage includes 1,276px light and
  1,018px dark dragging, curve presses, touch pinning, vertical-only movement,
  threshold-empty endpoints, fresh-session selection, and identical-parameter
  record switches across polling. Test data remains isolated from production.
- Live 8688 checks verified endpoint reachability, cursor/guide alignment,
  fixed axes, and all 20 future columns. The NVDA empty endpoint's maximum cell
  probability was below its selected display threshold; the model and threshold
  were not changed. This task did not restart 8688 or mutate training history.
- The earlier complete `./scripts/check.sh` exited 1: 1,155 Python passed,
  six skipped, 180 subtests, 73.63% coverage; JavaScript passed; Chromium had
  296 passes and seven failures. Those failures covered Backtest share-heading
  clearance, Holdings fixed-table alignment, Investment entry-version mismatch,
  Bayesian axis geometry, primary/click/touch pinning, 6px versus 2px spacing,
  and legacy zero-opacity behavior. Pinning was subsequently fixed and passed
  focused validation. The other six were not resolved or independently
  clean-baseline-attributed by this task. Concurrent work may change their
  current status. The full gate was not rerun after the final pointer-capture,
  saved-ID, and test refinements; only the focused results cover that state.
- E2E lock conflicts returned 73 and were retried through the supported wrapper
  after release. No competing runtime was stopped or reused.

## Audit challenge: research-window correctness

On 4 Sep 2026, follow-up verification found three P2 defects missed by the
earlier static audit. The adapter loaded pre-range history but discarded it
before model calculation; any finite prediction in warmup could qualify a scored
window with no predictions; numeric search domains accepted strings and booleans
through coercion. Adapter/search v1.1.0 correct these contracts. The minute bridge
also retains model provenance and checks prediction eligibility before discarding
the daily presentation. Warmup signals never execute outside the scored window.

Observed commands and evidence:

- `./scripts/test.sh tests/test_strategy_tuning.py -k 'malformed_json or prior_history or only_in_warmup'`: before the fix, all eight new regressions failed in 1.03 seconds. A direct isolated reproduction loaded 160 model rows but passed only 52 and 64 rows to the two folds, both starting at the requested date rather than the available warmup date. `{"fast_span":"12"}` incorrectly became bounds 1 to 2.
- `./scripts/test.sh tests/test_strategy_tuning.py`: after the first fix, exit 0, 51 passed in 7.44 seconds.
- `./scripts/test.sh tests/test_strategy_tuning.py tests/test_strategy_interval_bridge.py`: final focused verification, exit 0, 59 passed in 10.02 seconds, including an actual Bayesian daily-model/minute-execution path on isolated shared-factory data.
- Two real local-OHLC MACD runs using `scripts/strategy_tune.py`, `--from 2025-09-04 --to 2026-09-04`, eight trials, and bounds `{"fast_span":[4,20],"slow_span":[24,50],"signal_span":[3,15]}` completed with exit 0, one using `--method genetic` and one `--method random-forest`. Both input fingerprints matched and both kept the final holdout out of ranking. Outputs are under `/tmp/worthward-audit-challenge-G97fZL/genetic` and `/tmp/worthward-audit-challenge-G97fZL/forest`. Existing production prices and prior research outputs were not rewritten.
- An initial browser reproduction returned exit 73 because another task owned E2E lock PID 74176. Its server and runtime were preserved.
- Read-only accessibility inspection of user-owned 8688 PID 41290 found an older existing Backtest DOM without the common collapse. A separate fresh load of the same URL rendered `Backtest parameters` and loaded the existing history. No training/delete action or service restart was performed. This is live render evidence, not an end-to-end training claim or a complete visual gate.
- `./scripts/check.sh`: exit 1, completed at 23:55 Asia/Shanghai on 4 Sep 2026. Static checks passed; 1,153 Python tests passed, six skipped, and 180 subtests passed in 407.01 seconds at 73.6% coverage. All 319 JavaScript tests passed. Chromium finished with 294 passed and six failed in 11.7 minutes. The five historical failures below were reproduced (the zero-threshold minimum opacity was 0.0649232 in this run). A sixth failure was the narrow history-delete test: changing the viewport does not emulate touch, and the test attempted to click a hover-only action after focus moved to the sidebar toggle.
- `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs tests/e2e/shared-backtest-controls.spec.mjs`: after adding the missing row hover and explicit opacity/pointer-events assertions to the deletion flow, exit 0, 11 passed in 1.1 minutes, completed at 00:00 Asia/Shanghai on 5 Sep 2026. All existing configuration, detachment, CSRF, and recoverable-delete assertions remain. No force-click, production CSS change, or production deletion was used.

The adapter/search sources stayed unchanged throughout the complete gate. Only
the history E2E precondition and documentation changed afterward; the full gate
was not repeated after that test-only correction. The five other browser failures
remain unresolved, so this is not a green complete gate. Evidence logs are under
`/tmp/worthward-audit-challenge-G97fZL`. Both E2E runs stopped their owned 8699
server; user-owned 8688 remained on PID 41290.

Final repository/documentation checks passed with
`./scripts/test.sh tests/test_repository_contracts.py` (exit 0, 11 passed in
0.15 seconds), `node --check tests/e2e/lstm-price-field.spec.mjs`, and
`git diff --check`. Starting/final HEAD was `856f7a87`; no commit was created.
Task edits are limited to the research adapter, search-domain validation, their
unit tests, the history E2E hover precondition, and Architecture/Testing/Known
Issues. Pre-existing CSS/template/title-alignment changes and the concurrent
critical-flow title test were preserved. No production training/delete action
was performed. Final housekeeping retained 11 differing numbered files: five
coverage histories, two protected investment-cache files, and four browser
screenshots. None were removed or overwritten as cleanup.

This challenge does not convert absence of P0/P1 findings into release approval.
The historical full-gate results below remain dated evidence, not a substitute
for a fresh complete run. Concurrent Backtest title-rail changes were preserved.

## Shared controls, startup handshake, and registry tuning

On 4 Sep 2026, the web launch regression was reproduced from a failed worker's
log: the manager-created request was mistaken for a prior run requiring resume.
The prepared-request protocol now has a process-level real-data check in addition
to unit tests. An actual `LstmTrainingManager` launch into an isolated temporary
compute root completed NVDA/1y/1d with the selected private configuration on
confirmed MPS: 6,840 optimizer steps, 297 trained origins, and 62.570382 seconds
of synchronized training compute. The run completed in about 67.44 seconds with
no artificial wait or CPU fallback. Its holdout hit rate was 51.0204%; this is
evidence of real work, not a promise of improved accuracy. No production history
item was created or deleted by the verification.

The new `tests/test_strategy_tuning.py` covers all 15 dropdown strategies through
the production execution engines using isolated shared-factory market data. It
also covers seeded genetic/forest search, fixed-value validation, read-only price
files, synthetic-data rejection, holdout isolation, and durable holdout errors.
Two separate real NVDA CLI runs, one per search method, each completed eight
trials using existing local OHLC with identical input fingerprints. Both wrote
only new directories under `/tmp/worthward-backtest-shared-3S3rxa`; their final
holdout results were reported separately and never used for ranking.

Commands and observed outcomes:

- `./scripts/test.sh tests/test_strategy_tuning.py tests/test_layout_anchor_contract.py tests/test_repository_contracts.py`: exit 0, 81 passed in 4.48 seconds. This reconciles the imported-collapse manifest and stale probability-share/hover source assertions with the already tested normalized renderer contract.
- `./scripts/test_e2e.sh tests/e2e/shared-backtest-controls.spec.mjs tests/e2e/lstm-price-field.spec.mjs`: seven LSTM/grid tests passed; four new cases initially failed by sampling a still-running CSS color transition. Their assertions now wait for the final destructive-token color.
- `./scripts/test_e2e.sh tests/e2e/shared-backtest-controls.spec.mjs`: final retry exit 0, four passed in 31.2 seconds. Light/dark at 1,024px and 390px verify collapsed inputs, intrinsic right-aligned actions, hover-only deletion, error colors, absence of nested disclosures, the real Style tokens specimen, and propagation of a shared token to both kinds of collapse.
- E2E ownership conflicts returned 73 for existing owners 45503 and 51369; neither process was stopped or reused. Retries acquired the supported wrapper's own lock and passed.
- `./scripts/check.sh`: final exit 1. Python static checks and JavaScript syntax passed; 1,144 Python tests passed, six skipped, and 180 subtests passed in 277.49 seconds at 73.62% coverage. All 319 JavaScript tests passed. Chromium completed with 294 passed and five failed in 9.3 minutes. This is not a green complete gate; see the failures below. All seven LSTM/grid tests and four new shared-control tests passed within this complete browser run.
- `python3 scripts/strategy_tune.py --strategy macd --ticker NVDA --from 2025-09-04 --to 2026-09-04 --method genetic --trials 8 --bounds '{"fast_span":[4,20],"slow_span":[24,50],"signal_span":[3,15]}' --output /tmp/worthward-backtest-shared-3S3rxa/genetic-final`: exit 0, eight successful real-data evaluations. Replacing the method with `random-forest` and the output suffix with `random-forest-final` also exited 0 with eight successful evaluations.

Live 8688 was restarted externally during this shared-checkout task, ending at
user-owned PID 41290. Its DOM serves app-css-v0.69.1, the four common/model/action/
factor groups, the shared `Price field detail` title, and the borderless Collapse
specimen in Style tokens. The agent did not restart the service or operate a
production training/delete action. Concurrent Price Field layout edits and commit
`07fa4ad6` were preserved. Seven pre-existing differing numbered copies (five
coverage files and two protected investment-cache files) were retained; nothing
was removed. Source changes remain in the shared working tree; the agent made no
commit. CSS architecture, README, Architecture, Known Issues, and the external
shared-UI ledger document the new owners and sibling synchronization boundary.

Remaining complete-gate failures (no accounting or concurrent layout changes
were overwritten to hide them):

- `tests/e2e/backtest-share-layout.spec.mjs:46`: the share button stays inside its card and away from the theme control, but no longer clears the chart heading after the separate share-rail spacing change.
- `tests/e2e/critical-flows.spec.mjs:8198`: the declared Investment entry version is v2.135.0 while the runtime's embedded module-version map reports v2.133.3.
- `tests/e2e/critical-flows.spec.mjs:15906`: the Bayesian axis/layout assertion differs by 26px (718px versus 744px).
- `tests/e2e/critical-flows.spec.mjs:17648`: the older expected 6px result-card block padding conflicts with the parallel layout task's recorded 2px contract.
- `tests/e2e/critical-flows.spec.mjs:18201`: the older field-opacity assertion expects an invisible cell at zero threshold, but the current threshold-relative mapping reports minimum opacity 0.0662361 for the strictly positive represented probabilities.

The source review separates these observed mismatches from the new passing
collapse/startup/search behavior; it does not claim an untouched-baseline browser
reproduction. The complete log is retained in the local evidence directory
`/tmp/worthward-backtest-shared-3S3rxa/check-final.log`. No runtime source changed
after this final gate began; subsequent documentation updates passed
`./scripts/test.sh tests/test_repository_contracts.py` (exit 0, 11 passed in
0.10 seconds). The E2E wrapper stopped its owned 8699 server.

## Selectable LSTM cases and sustained training

On 4 Sep 2026, the focused LSTM Python suite passed 80 tests. Isolated Chromium
passed three tests covering both existing control
flows and the new case-selection flow: full ticker/date/interval/private and
generic settings, persistence on reload, detachment after edits, single-open
details, recoverable delete requests, shared badge styling, intrinsic action
width, and a 390px viewport. Browser responses in those interaction tests are
test-only doubles and never create production history records.

A separate real-data validation read the existing DRAM snapshot (107 daily rows)
and wrote only to `/tmp/worthward-lstm-gpu-AI55JZ`. PyTorch MPS trained 82 causal
origins with 6,460 optimizer updates and 60.768531 seconds of synchronized optimizer
work (62.329795 seconds including per-origin setup/inference). There was no CPU
fallback or artificial delay. The measured holdout hit rate was 50.00%, not a
promise of improvement over the older configuration's 65.00%. CUDA was unavailable
on this Mac and was not presented as hardware-verified.

Live 8688 retained user-owned PID 76984. DOM verification found zero nested
disclosures in training history, a 125.90px action in a 250px menu, and monospace
codes. The UI explicitly gates updated actions on protocol version 2 because
that process still caches older Python routes. No user service was restarted and
no production run was deleted or added.

Final commands and outcomes:

- `./scripts/test.sh tests/test_lstm_training.py tests/test_lstm_compute.py tests/test_lstm_ga_tune.py tests/test_strategy_lstm_price_field.py`: exit 0, 80 passed in 3.69 seconds.
- `npm run test:js`: exit 0, 318 passed, 0 failed, 0 skipped.
- `./scripts/test_e2e.sh tests/e2e/lstm-price-field.spec.mjs --grep 'private training actions|training toggles one|history selects a complete'`: exit 0, 3 passed in 40.3 seconds on isolated port 8699, including 390px interactions. No E2E lock contention occurred; the wrapper stopped its server.
- `./scripts/check.sh`: exit 1 at the Python stage, 1,092 passed, 6 skipped, 180 passed subtests, 3 failed in 327.68 seconds; coverage 73.40%. Two failures were stale version literals introduced by this asset bump, now replaced by source-derived checks. The remaining Bayesian geometry source assertion already fails against starting HEAD `d1d04c37`.
- Final replay of layout, repository, and the four LSTM suites: exit 1, 116 passed and that same one pre-existing failure in 3.67 seconds. The full gate did not reach its JavaScript/browser stages; the separate commands above passed. No claim of a green full suite is made.
- Final targeted Ruff, JavaScript syntax, and `git diff --check`: exit 0.
- Post-review regression: the complete-case Chromium flow passed again in 16.9 seconds after selection-state hardening; all 80 focused Python tests were replayed, and documentation/repository contracts passed 11 tests. These focused checks cover the small changes made after the full gate.

The work started clean on `main` at `d1d04c37`; changes remain uncommitted and are
limited to training/backend integration, the affected UI assets/cache keys,
regressions, and documentation. The independent Bayesian model was preserved.
Final housekeeping found the same seven ignored numbered copies: five coverage
files and two protected investment-cache files. All differ from their primary
file by SHA-256 and byte comparison, so all were retained. No source or user data
was deleted. Temporary real-data compute evidence and verification logs remain
under `/tmp/worthward-lstm-gpu-AI55JZ`; production history is unchanged.

## Price Field shared-grid coverage

Python tests cover LSTM strategy registration, the shared `probability-grid-v1`
payload, causal walk-forward with no future lookahead, fail-closed short
windows, and backend readback that reports the resolved CPU engine rather than
the requested GPU or Neural Engine label. Node tests accept both
`bayesian-price-field/v1` and `lstm-price-field/v1` through one
`probability-grid.js` module. Backtest split layout prefers the published
10-row overview plot budget over extra Price Field history height when both
cannot fit, so the shared resizer minimum still yields 10 rows per side.
The isolated Chromium file `tests/e2e/lstm-price-field.spec.mjs` checks the
LSTM selector, namespaced parameters, shared Price Field DOM, cache-busted
version-aligned probability-grid and backtest assets, square cells, and 390px overflow on port
`8699`. A second case waits for a real server `lstm-price-field/v1` payload
(not an injected presentation), requires the renderer to normalize it, hovers a
forecastable origin, and asserts both the floating field and the detail lattice
render from that computation. Walk-forward LSTM training keeps the causal lag
return even when enabled Longbridge factor columns are entirely unavailable.
The same file verifies three ordered, sentence-case LSTM accordion groups:
`LSTM parameters` (Cell display threshold through Compute backend), `LSTM training`,
and `Market factors` (the boolean factors). Opening a section closes the others
without changing form values; keyboard activation and page reload retain a usable
initial state. All three sections stay in the
`Strategy parameters` collapse opened by the round `Tune strategy parameters`
button, stay out of the strategy selector and global sidebar, use the
`bolt.fill.svg` and `stop.fill.svg` masks, and keep historical runs inside an
accessible button list with single-open details. `tests/test_lstm_training.py`
covers isolated state discovery, detached launch arguments, seed-checked
termination, and CSRF rejection at the web boundary.
Web training snapshots both the current parameter and factor controls into a validated
`selected_params` request. The runner loads and evaluates that exact configuration
without GA mutation or seed replacement; the CLI without `--selected-params` retains
its existing GA search. Configuration is recorded in the durable request and history,
and the request hash separates different selections. Missing or invalid configurations
fail before process launch. Tests intercept browser start requests and mock evaluation
in temporary compute stores, so verification does not launch a real training job.
All three LSTM summaries use the existing 15px and medium-weight tokens at desktop
and narrow widths, without card borders. One start/stop action uses the sibling
secondary-button glass-chip tokens, 13px semibold text, and blue text; idle helper
copy is hidden while actual errors remain visible. Browser tests intercept start,
stop, stopping, interruption, and history-error states without launching a job.
History displays allowlisted existing artifact names and byte sizes. Progress is
the runner's completed-origin count divided by its total, not elapsed time divided
by the job budget and not a model-quality score. Unknown progress is indeterminate
only for active runs. Its fill uses the positive green token, with no gradient.
Terminal progress remains in metadata but has no rendered progress bar.
Tests cover real strategy callbacks, terminal progress, unknown counters, and
excluding symlinks and unrecognized artifact names in temporary stores.

The current history regression requires details closed until clicked, restoration
of the selected case after reload, preserved expansion across polling, ticker/date sequence summaries
without a Completed badge, and right alignment at desktop and 390px widths.
Request tests cover ticker, period, interval, and all selected private controls;
unsupported or missing intervals fail before any process or state directory is
created. Isolated provider doubles prove the snapshot retains source observations,
date slicing, and selected configuration, and no data fallback creates demo rows.
Grid tests compare `[10%, 20%]` and `[2%, 19%]` contrast endpoints, equality at the
threshold, tied maxima, zero fields, and no visible cells; raw masses and geometry
remain unchanged. These tests do not launch a production training job.

Earlier verification on 4 Sep 2026: focused LSTM Python passed 53 tests,
probability-grid Node passed 39 tests, the complete JavaScript unit suite passed
318 tests, and the two isolated Chromium control/lifecycle flows passed. Ruff,
JavaScript syntax, and whitespace checks passed. The full quality gate stopped
at Python with 3 failures, 1,079 passes, 6 skips, and 180 passed subtests (73.37%
coverage). After updating affected version/contrast assertions and concurrent
pointer work, replaying repository/layout/Price Field contracts passed 43 tests
with one pre-existing source assertion still failing:
`test_bayesian_history_detail_preserves_hover_and_complete_geometry` expects
`probability_grid_geometry_fields` directly in the Bayesian strategy. This task
does not change that model. The full browser suite was not reached by the gate.
Live 8688 showed collapsed `NVDA 260903(01)`, right-aligned identification, opt-in
actual artifact details, and no terminal progress bar. At 2% and 10% thresholds,
all 400 detail cells matched the new opacity formula within 2.3e-16, with the
same fully opaque maximum. The original 2% selection was restored. The user-owned
PID 76984 still served cached route code and old asset query versions; its
backend interval validation needs a normal service restart. No real training
job, user-service restart, or production-store fixture write was performed.
Seven pre-existing numbered files were retained, including protected investment
cache copies. Concurrent pointer/layout work was preserved.

Earlier verification on 4 Sep 2026: the focused LSTM Python suite passed 45 tests, the two
private-control Chromium flows passed, and JavaScript unit checks passed. A full
`./scripts/check.sh` run reported 5 failures and 1,070 passes while parallel work
was changing grid code; after fixing the local cache-version assertion and launch
mock, replaying the affected files passed 56 tests with three remaining unrelated
grid-contract failures: dynamic-grid pointer source, Bayesian geometry source,
and the JavaScript renderer version allowlist. Live 8688 subsequently served the
new controls, sentence-case labels, nine actual artifact filenames, and 100% for
the completed historical run after an external restart. No real job was launched.
The final numbered-copy scan retained seven existing ignored files: five coverage
files differ from their primary, and two differing investment-cache files are
protected state. No files were deleted; unrelated working-tree edits were preserved.

Architecture-boundary tests assert that LSTM imports the model-neutral
`strategies.price_field_pipeline`, never the Bayesian strategy module, and
never instantiates `BayesianPriceFieldStrategy` as a service. They also cover
the lag-return-only ablation, shared factor/window parameter semantics,
presentation-only threshold invariance for diagnostics and fingerprints, and
the exclusion of Bayesian-only parameters from LSTM fingerprints.
NumPy and Torch LSTM paths also share the explicit
`input/forget/candidate/output` bias initialization contract (`0/1/0/0`).

## Bayesian Price Field detail view coverage

The isolated Chromium Backtest flow verifies that the Bayesian `Price Field`
option sits between `Metrics` and `Transactions`, that selecting it preserves
both existing views, follows the active hover index, preserves the shared
probability model and live price scale, preserves square cells and the 2px lattice gap,
and retains the last valid field after hover is cleared. It also checks the
Settings-formatted forecast dates, edge-aware tick placement, the live price
axis, accessible state, and narrow-layout geometry. The detail heading has
no Display anchor contract line or price-probability legend.
The detail plot, main column, grid viewport, and complete lattice also remain
contained within their owning surfaces, including at the narrow breakpoint.
A dedicated history-rail regression moves the shared section handle to both
endpoints and checks the plot, square lattice, Y axis, and forecast-date ticks
against the rendered history surface without document overflow.
The Y-axis boundary and tick labels align with the main price Canvas plot
boundary, while the DOM Y ticks and forecast-date ticks reuse the Canvas axis
font contract (`GDS Transport`, 12px, regular weight, 10px line height) at the
annotated desktop viewport and the narrow breakpoint.
The overview hover contract also requires the shared filled blue Y-axis value
badge to follow the exact polyline intersection and the centered filled blue
date badge to align with the vertical guide at the typical X-axis baseline. The
date badge must preserve the two-line `D Mmm` and `yyyy` format and the shared
axis font metrics, and both badges must clear with the hover overlay.
The overview regression also verifies that a primary pointer press pins the
visible origin before release, the ordinary mouse click remains supported, and
an iPad-style touch tap pins the same frame. It verifies that movement cannot
change a pinned origin, that Escape clears it, that the Price Field detail keeps
the pinned index, and that the chart context menu remains available for SVG
download.
The right end of the horizontal detail guide displays normalized directional
shares of represented mass. E2E independently normalizes every horizon using
all detail cells (including threshold-hidden cells), averages the shares, and
verifies complementary hundredth-percent rounding totaling 100.00%. Node tests
cover unequal horizon coverage, empty distributions, and one-sided mass.
`tests/e2e/lstm-guide-alignment.spec.mjs` samples every frame during vertical-only
movement at five right-half positions and a reversible one-pixel sweep at
1018 × 1294. The selected date, lattice, and intersection must be coherent in
every sampled frame, not merely after a polling assertion eventually passes.
Both the vertical guide and the visible curve intersection must remain within
one pixel of cursor X during pan. Pan is solved absolutely, with no previous-pan
feedback; a one-pixel pointer move contributes at most one additional pixel of
pan. The endpoint plateau preserves the final model while following the cursor.
The detail contract also requires that green cells stay wholly above the live
price guide and red cells wholly below it, including the first render after a
layout change. An edge-adjacent hover regression proves that the floating field
may be boundary-capped while the detail panel still renders the complete
strategy-owned row lattice and contains it within the detail viewport on
desktop and narrow layouts.
The desktop Bayesian hover flow also sweeps the pointer across visible forecast
points, including after overflow pan, requiring the selected origin and
`Selected date` status to match the visible curve point under the pointer.
A final-endpoint regression sweeps both sides of the horizontal guide through
the field's visible width and requires the last curve point's intersection and
complete probability lattice to remain unique while the pointer moves.
A layout refresh regression also confirms that sidebar, resizer, and viewport
reflows clear stale screen-space pointer coordinates when the pointer is no
longer over the chart stack, then recalculate geometry. A pointer that is still
over the stack is kept so a vertical split change can recompute overflow pan
without waiting for another mousemove. It verifies that hovering a translated
Canvas still selects the visible middle of the curve rather than a lagged
unscrolled date, that leaving the chart stack clears both guides and the field,
and that moving onto the native scroll rail preserves the active field.
Hovering a detail row must expose its exact price interval and the sum of all
raw row probabilities across the complete forecast horizon through the hovered
row's native hover label, with threshold-hidden cells included in that sum. The
detail heading contract also checks that the status line contains only `Selected
date: D Mmm yyyy`, and the redundant `Forecast date` axis title is absent while
forecast-date ticks remain; clearing a row hover restores the date-only status
and original cell labels.
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

The v1.26.0 model regressions separately prove that a factor row targets
`Open[t+1] -> Open[t+2]`, that the immediately preceding target remains
unavailable at a close-origin fit, and that changing any future Open cannot
alter an earlier posterior. A missing next-session Open makes `next_open`
execution fail closed instead of filling at Close. Python and Node tests compare
the same AR(1) cumulative-return moments and prove that a nonzero one-step mean
reverts rather than being multiplied unchanged across every horizon. Prior
tests assert the percentage-of-sample-information mapping, while synthetic
factor tests require positive causal incremental log-score evidence and reject
a noise factor. Diagnostics are bounded 0-100% direction hit-rate and Brier
  probability-score values; flat returns and neutral 50/50 forecasts are not
  counted as directional decisions, and empty samples remain unscored. Raw
  Gaussian log score and CRPS remain metadata. Factor tests also verify that
  provider availability is reported separately from latest-origin eligibility
  and selection.

The overview-hover regression also covers the `show_trade_details=0` path:
hidden Price Field detail cells stay untouched during repeated pointer moves,
the hidden equity Chart.js instance is not updated, and only the visible
probability field is refreshed. It also moves the pointer in one-pixel steps
while the right-edge field is active and verifies that the visual pan does not
amplify that input into a jump to the series endpoint, the vertical guide stays on the
visible curve and never to the right of the last trading day, the horizontal
guide stays on the price-curve intersection rather than the pointer Y, the
field's left boundary is that vertical guide, the horizontal guide continues
through the field to its right edge, and the first probability-field column
stays to the right of the vertical guide. A left-side hover must keep the last
curve point away from the pointer so interrupted and middle trading days remain
reachable. Overflow pan is limited by the last curve point, so a right-edge
hover cannot walk the vertical guide off the series endpoint. An
off-curve pointer move additionally verifies that the horizontal guide remains
on the curve, green rows remain above that guide, and magenta rows remain below
it. The chart stack remains the
stationary interaction surface after the translated canvas leaves the pointer
location, and Bayesian overview tracking renders the shared filled Y-axis value
badge and centered X-axis date badge. Moving past the chart stack still clears the floating field plus
both guides. Pinning after a translated
tracking hover also snaps the shared chart back to its fit coordinate system
and hides the temporary native horizontal rail.
It also verifies that the hovered price-curve point keeps a zero radius, so no
circular hover bubble is painted over the curve.

