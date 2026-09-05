# Settings annotation validation

Documentation version: `v1.0.0`
Reviewed: 5 Sep 2026

## Outcome and scope

All 16 requested annotations are implemented in the owning Settings templates,
shared control styles, and semantic tokens. Changes remain uncommitted on `main`
at `ecb5004e` in `/Users/example/Desktop/worthward`. The initial worktree was
clean. No sibling source, broker configuration, production market or investment
store, or live-order authorization was intentionally changed. No subagents were
used. The application release metadata remains v2.60.0 / 2 Sep 2026 because this
is not an application release.

| Comment | Owner and resulting behavior |
| --- | --- |
| 1 | The specimen width rule excludes the primary primitive; its width follows its label and standard padding. |
| 2 | The action specimen and production maintenance action use the same Settings action-package classes and primary-button tokens. No replacement button styling was introduced. |
| 3 | The selected execution option keeps the normal theme surface, with the standard accent border and inset outline. |
| 4 | Switch thumb transitions alias the shared spatial duration and nonlinear bouncy curve in both directions; reduced motion remains supported. |
| 5 | The ticker specimen aligns left, without extra vertical padding or the independent 320px cap. It follows the existing 384px control maximum. |
| 6 | The ticker-input semantic token uses the existing 15px font scale. Other text inputs retain their own font token. |
| 7 | Tooltip material resolves through the canonical frosted-glass background alias; border, shadow, and blur already reused that material. |
| 8 | About uses two short paragraphs describing current comparisons, research, forecasts, imports, and optional protected trading. |
| 9 | The risk notice covers hypothetical results, model limitations, losses, source verification, live-order failures, warranty limits, and nonwaivable rights. It is not a claim of legal immunity. |
| 10 | About removes its unused negative start-side effect gutter. Its scrollport stays inside the workspace, without altering other Settings effect gutters. |
| 11 | The cash-equivalent Add a ticker action aligns to its category's right edge. |
| 12 | Reset all color overrides is the last color-page section and uses the Clear caches danger assembly. Its existing browser-local reset hook is preserved. |
| 13 | General follows About in both DOM navigation and the active-index mapping. |
| 14 | The local-store effect host uses visible overflow; the data-only scrollport retains automatic scrolling and pagination stays its sibling. |
| 15 | Network keeps one description in the standard action assembly. Transport and last-check details use the shared expandable disclosure and normal note typography. |
| 16 | Strategy summaries use 6px block and 4px inline padding with sufficient selector specificity to override the collapse primitive at existing widths. |

No new viewport breakpoint was introduced. The 640px content and 384px control
limits remain authoritative. The annotation viewport is a test case, not a
hard-coded layout size.

## Versions

- app.css v0.70.5 and both direct template cache keys.
- settings.css v0.26.1; trade.css v3.61.3; forms.css v0.20.2;
  foundation/tokens.css v0.28.2.
- settings.html v0.15.1; style_token_rows.py v1.16.1;
  language_settings.py v0.6.1, including both Chinese translations.
- seed_e2e_market_store.py v1.2.1: missing fixture logos receive a bundled neutral
  icon only after checking the exact isolated runtime path. This makes all 11
  fixture tickers eligible for the existing two-page Local market store case.
- settings-annotations.spec.mjs v1.0.0; two existing token/cache assertions updated.

## Verification

- Baseline `./scripts/test.sh tests/test_table_style_tokens.py tests/test_web_token_registry.py tests/test_layout_anchor_contract.py tests/test_language_settings.py -q`:
  exit 0, all 78 cases passed (the extra quiet flag suppressed the summary).
- Final focused run of the same command without the extra `-q`: exit 0,
  78 passed in 4.15 seconds. Log: `/tmp/worthward-settings-focused.log`.
- `./scripts/test_e2e.sh tests/e2e/settings-annotations.spec.mjs`: exit 0,
  4 passed in 31.0 seconds. Covers 1138x959, 800x959, and 390x959, light/dark
  surfaces, both switch states, reduced motion, compact primary composition,
  ticker font/alignment, About boundary, right-aligned add action, final danger
  reset, pagination ownership, strategy padding, and expandable Network detail.
  Log: `/tmp/worthward-settings-browser.log`.
- `./scripts/test_e2e.sh tests/e2e/style-token-alignment.spec.mjs tests/e2e/style-token-physical-effects.spec.mjs tests/e2e/style-token-pagination.spec.mjs tests/e2e/critical-flows.spec.mjs --grep 'shared component annotations|touch users|physical-effects|canonical seven|Settings surfaces|hydrates the network self-check|Local market store pagination aligned'`:
  exit 0, 9 passed in 1.2 minutes. Log: `/tmp/worthward-settings-regression.log`.
- `./scripts/test.sh tests/test_repository_contracts.py tests/test_table_style_tokens.py tests/test_web_token_registry.py tests/test_layout_anchor_contract.py tests/test_language_settings.py`: exit 0, 90 passed in 25.73 seconds.
- After adding this record and its documentation-map link, `./scripts/test.sh tests/test_repository_contracts.py`: exit 0, 12 passed in 0.57 seconds.
- Additional Ruff verification of the seed helper and translations passed;
  `node --check tests/e2e/settings-annotations.spec.mjs` and `git diff --check`
  passed.
- In-app browser inspection of the isolated 8699 About page at 1138x959 measured
  the scrollport left edge at 336px and sidebar right edge at 322px. The updated
  copy and navigation were rendered. Local-store inspection measured visible host
  overflow and confirmed the floating pagination and shadow visually.
- Early test failures were corrected test instrumentation: the switch uses
  `.ios-switch-slider::after`; theme changes need to settle; the original seed
  lacked the eleventh ticker's bundled logo. No production assertion was relaxed.

## Complete quality gate

`./scripts/check.sh`: exit 1, completed 5 Sep 2026 before 11:44 UTC.

- Ruff and JavaScript syntax passed.
- Python: 1,157 passed, six skipped, 180 subtests passed in 425.17 seconds.
  Coverage: 73.64%, above the 50% minimum.
- JavaScript: 323 passed, zero failed.
- Chromium: 312 passed, four failed in 22.0 minutes. All four new Settings
  annotation tests passed in this full run.
- Portfolio summary and Portfolio Period dropdown: navigation/reload exceeded the
  30-second test timeout before reaching geometry assertions.
- Holdings live-value geometry: shell height changed from 383.75px to 260px.
- Holdings/history Market value alignment: 4.25px mismatch at 856px, above the
  existing 1px tolerance.

These failures are outside the requested Settings surfaces. An untouched-checkout
baseline was not run, so this record does not assert their provenance. No
Investment geometry or assertion tolerance was changed. Full details are retained
in `/tmp/worthward-settings-gate.log`.

Failure recheck:
`./scripts/test_e2e.sh tests/e2e/critical-flows.spec.mjs --grep 'keeps Portfolio summary metadata|constrains the Portfolio Period dropdown|keeps Holdings live-value geometry|aligns Holdings Market value'`:
exit 1, three passed and one failed in 37.7 seconds. Both Portfolio navigation
cases and Holdings live-value stability passed without source changes. The
Holdings/history Market value alignment still failed with a 4.25px difference at
856px. Log: `/tmp/worthward-settings-failure-recheck.log`. The full gate was not
rerun; its four failures remain the recorded full-run result.

The isolated seed helper was completed during the gate's Python stage, before
browser execution, and was separately checked with Ruff. All product changes
preceded the gate. Later edits only updated validation documentation and the
external synchronization ledger.

## Runtime and recovery

The user-owned 8688 listener was initially PID 80226 and subsequently PID 97785,
with cwd `/Users/example/Desktop/worthward`. Neither process was restarted or
stopped by this task. Repeated live browser reloads still returned the old
app.css v0.70.4 template key and old navigation/reset markup; CSS serving alone
was newer. Full new-template evidence is from isolated 8699, not the stale
8688 template response. Relaunch with `./scripts/run_app.sh` from the user's
Terminal and reload to apply the complete change.

The housekeeping scan found ten differing numbered files: six coverage histories
and four protected investment-cache files. All were retained; no files were moved
or deleted. Metadata and hashes are recorded outside Git in
`/tmp/worthward-settings-housekeeping.json`. No private records are included here.
The shared UI ledger is Pending because agenticContext was inspected but not
changed or verified. Sibling UI sync pending: propagate and verify the shared
Settings control, motion, and material contracts in agenticContext.

Rollback must target only the listed task changes; do not reset the worktree or
restore protected stores. Logs use `/tmp/worthward-settings-*.log`.

Final checks: `git diff --check` passed; HEAD remained `ecb5004e`. All task changes
remain uncommitted. The final numbered-copy scan retained the same ten differing
files. Port 8699 and the agent-owned E2E runtime were stopped and cleaned by the
supported wrapper; user-owned 8688 remained running.
