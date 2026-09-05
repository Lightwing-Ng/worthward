# Testing guide

Documentation version: `v1.50.2`

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
  regress below the current safety floor. Set `WORTHWARD_COVERAGE_MINIMUM` to
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
`WORTHWARD_JS_COVERAGE_LINES_MINIMUM`,
`WORTHWARD_JS_COVERAGE_BRANCHES_MINIMUM`, or
`WORTHWARD_JS_COVERAGE_FUNCTIONS_MINIMUM`. This is not whole-browser bundle
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
  retention, cross-account cost aggregation, and P&L conservation. The
  sanitized live API fixture also verifies broker/account/ticker coverage,
  independent snapshot as-of dates, replay completion, the snapshot-baseline
  plus boundary-increment invariant, and rejection of missing supplemental
  boundaries and legacy ticker fallbacks.
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
- `tests/test_chart_axis_utils.mjs`: Node unit tests for shared chart tick-index helpers, `readThemeTokens` priority (CSS, explicit fallbacks, `WORTHWARD_APP.theme`, empty string), and safe dynamic logo URL normalization.
- `tests/test_backtest_probability_grid.mjs`: deterministic schema and date-key validation for the fixed 20-column tooltip; actual-cell-size minimum-plot-height derivation; independent up-to-10-row clamping by the 50% current-plot cap and the relevant chart boundary; the opt-in complete-row geometry used by the detail surface; stable median point spacing; integer-trading-day slots with a one-day minimum; fixed 2 px logical guide-to-first-cell and cell-to-cell gaps with 1:1 square geometry; exact price/time mapping; 4 px cell floor, no-radius transparent matrix, 8 px top, bottom, and trailing padding; nonlinear per-hover opacity normalization; curve-hit plus pin-state contracts; and polyline intersection at the cursor X, including interrupted trading-day gaps. The dedicated Chromium flow uses `NVDA`, checks the transparent matrix without changing Frosted Glass tokens, proves the dynamic Backtest resizer lower bound preserves a real near-midpoint forecastable point at full 10-by-10 density, exercises a real pointer drag with a pinned field, preserves exact content-space mapping through the temporary scroll rail, and verifies tracking, pin, blank-clear, Escape-clear, resize, and narrow-screen behavior.
- `tests/test_price_field_market_factors.py`: mocked Longbridge CLI chunking, optional-factor failure isolation, US/HK/SH/SZ/SG market-local trading-day normalization, availability-timestamp bounds (including rejection of report-period-only rows), current Dynamic P/E snapshot date binding without historical backfill, retries, bounded LRU expiry, same-key single-flight, immutable status, and provenance contracts. Backtest page coverage separately verifies that a relative strategy-provider window ends on the ticker's own market-local date. The historical `app.services.bayesian_market_factors` import remains covered only through its compatibility alias.
  The current Bayesian probability-grid assertions supersede historical material checks: the floating field sides are independently bounded by `min(10, floor(50% of current plot height capacity), floor(its chart-boundary distance in complete slots))`, while the contained detail panel renders the complete strategy-owned row counts and scales them without clipping; the field fixes 20 columns, actual quantized cell size determines the private dynamic stage minimum passed to the generic resizer, square cells map through the live Y scale and integer-day width exactly, and the transparent no-radius matrix leaves the curve Canvas range and global Frosted Glass tokens unchanged. The isolated flow seeds a horizontal pan and then traverses immutable pre-pan content coordinates, proving every intermediate curve index remains reachable instead of collapsing to the rightmost point. A left-side hover must keep the last trading day away from the pointer, place the vertical guide on the cursor, place the horizontal guide on the curve intersection, and draw the Price Field to the right of that guide. The shared resizer callback is verified after Chart.js resize, including a real pointer drag while the field is pinned and while the native probability rail is active; the rail keeps its own browser hit area and the resizer remains keyboard-accessible. Desktop and narrow tests permit only true viewport-fit reductions; they never permit distorted cells, gaps, or fractional bars.
- `tests/test_parallel.py`: bounded worker sizing, deterministic ordered results, spawn-process execution, contiguous batch argument handling, and safe thread fallback for unpicklable CPU tasks.
- `tests/test_strategy_bayesian_price_field.py`: `NVDA` default-ticker selection, alphabetical quantitative-factor parameter ordering, daily-model and one-minute-execution capability declarations, executable next-open target alignment, walk-forward no-lookahead for Open, Close, historical P/E, Dynamic P/E, options, and research observations; causal volume-at-price distribution; AR(1) multi-step state evolution; standardized prior scaling; incremental predictive factor evidence; bounded direction hit rate and proper Brier probability score; regularized noise-floor calibration; fail-closed research-factor statuses; finite aligned 20-column presentation; integer-trading-day metadata; execution mode; model fingerprint including exclusion of LSTM-only parameters; end-to-end Bayesian compute isolation from LSTM-only parameters; two-decimal threshold form rendering; adaptive Auto CPU/GPU heterogeneous execution; explicit GPU MPS/CUDA selection; whole-run CPU recomputation after GPU failure; bounded CPU worker selection; process-executor reporting; and serial-versus-parallel result equivalence.
- `tests/test_price_field_contract.py`: identity checks prove that Bayesian and LSTM use the same model-neutral factor, target, state, diagnostic, and threshold helpers while retaining separate model modules; the shared payload builder and JavaScript schema allowlist remain aligned.
- `tests/test_strategy_variants.py`: signal-result contracts for the kNN, Lorentzian, and SuperTrend variants, parallel-versus-serial causal prediction equivalence, and future-perturbation invariance before the perturbation boundary.
- `tests/test_strategy_interval_bridge.py`: causal daily-final-bar signal placement, next-session first-minute execution, exchange-local US and HK session mapping, removal of daily-only presentation data from one-minute results, mixed-frequency provenance metadata, and fail-closed missing-session, duplicate-timestamp, out-of-order, or misaligned trading-date behavior.
- `tests/test_backtest_page.py`: server-rendered interval capabilities, actual-store Period normalization, daily Bayesian model loading during one-minute execution, one-minute-only refresh and read-only-cache contracts, explicit refresh-failure notices, default-on and explicit-off algorithmic stop-loss semantics, pure-price loss-exit behavior, and Simplified or Traditional Chinese stop-loss copy.
- `tests/e2e/critical-flows.spec.mjs`: the Backtest title/result-rail regression uses the annotated 974 by 1,354 desktop geometry to prove that the page-level `Backtest` title and the result-level `Performance` title occupy separate rows. The Backtest control regression uses the exact 972 by 841 desktop geometry to prove that strategy parameters remain below Strategy, the complete controls surface owns vertical scrolling, and the final private parameter remains reachable. It then verifies natural page flow and no horizontal overflow at 390 by 844. The shared `Show trade details` regression verifies the default-on state, real switch transitions, price-subplot expansion with a retained time axis, hidden equity comparison, disabled Transactions option, URL-only display persistence, and the same contract after entering DCA. A separate interval regression selects `1 year`, restores `1m`, proves the smart fallback to the final available Period option, and verifies that `Allow algorithmic stop-loss exits` is enabled by default. Mocked-presence regressions verify repeated ticker parameters, all-required-ticker `1m` gating, intersected Period lists, and that a delayed older response cannot override the latest ordered ticker snapshot.
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

When remote access is disabled, both Price Field strategies load their daily
OHLCV model input from that existing local store and mark Longbridge-only
factors unavailable. This keeps the Backtest renderer deterministic without
enabling network access or inventing market data in CI.

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

The root pytest bootstrap assigns `WORTHWARD_SETTINGS_STORE_DIR` to one
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
