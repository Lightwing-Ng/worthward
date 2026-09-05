# Style token alignment validation

Documentation version: `v1.0.0`
Reviewed: 5 Sep 2026

## Delivered scope

Worthward and agenticContext now follow Shared UI Layout Contract v1.1.0 for the
annotated controls. The obsolete Workspace article registry entries, template
branches, and demo-only CSS are removed. Live page containers remain intact.
Worthward's Collapse demo no longer contains the placeholder sentence.

Secondary button replaces the inverted-primary specimen and its unused CSS/tokens.
Both primitives use intrinsic width, 13px typography, a 31px natural height, and
the existing glass-chip, hover, and disabled treatments. Both dropdown/filter
triggers use the foundation's 30px shared-select height. Worthward's strategy
stepper uses 30px; general numeric controls remain 28px and Agent session controls
remain 36px. No new viewport breakpoint was introduced.

Modal and floating-notice dismiss actions use error red and reveal on owner hover
or focus-within for fine hover-capable pointers. Touch/no-hover devices retain
visible controls. Hidden controls do not intercept pointer input.

Current aggregate stylesheet versions include concurrent work: Worthward
`app.css` v0.70.1; agenticContext `style.css` v2.93.2-codex.1. Unrelated concurrent
Agent, Backtest, modal-material, and layout changes were preserved.

## Focused acceptance

- Worthward registry, table-token, and layout-anchor tests: 75 passed.
- Worthward JavaScript suite: 319 passed.
- Worthward new responsive/touch browser regressions: 4 passed; migrated existing
  primary/Secondary catalog regression: 1 passed.
- agenticContext final registry, component-catalog interaction, and new
  responsive/touch browser tests: 15 passed.
- The new regressions cover 1,024px, 800px, and 390px widths, 30px controls,
  intrinsic button sizing, hidden/revealed/error-red dismiss actions, keyboard
  access, touch visibility, obsolete-row absence, and document overflow.
- Isolated Worthward visual inspection on port 8703 confirmed the new Secondary
  specimen, 13px/31px typography/height, hidden red dismiss controls, removed old
  entries, and no horizontal document overflow. The temporary server and tabs
  were closed after verification.
- Changed Python files passed Ruff; both worktrees passed `git diff --check`.
  Static-file housekeeping found no numbered duplicate candidates in the
  affected app roots; no user files or production stores were deleted.

## Full-gate boundary

Both complete quality-gate commands were run, but this task does not claim a clean
full-gate result or mark the shared ledger Synchronized.

Worthward's gate recorded 1,155 passed, 6 skipped, 180 subtests passed, and one
failure in a hard-coded CSS import version assertion. Coverage was 73.60%.
The stale Settings/forms import assertions were corrected and the complete
75-test focused set subsequently passed. JavaScript and affected browser tests
were run separately; the full gate was not rerun after that correction.

agenticContext's concurrent-worktree gate recorded 1,422 passed, 556 subtests
passed, and 11 failures with 71.02% coverage. Four failures were obsolete catalog
count/Workspace article expectations; those were corrected and the final
15-test catalog/browser set passed. Other failures involved concurrently changing
Agent effort/header/keyboard behavior and asset-version assertions. They are not
claimed fixed by this component-alignment task.

Logs: `/tmp/worthward-style-full-gate.log`,
`/tmp/agentic-style-full-gate.log`, `/tmp/worthward-style-e2e.log`,
`/tmp/worthward-secondary-legacy-test.log`, and
`/tmp/agentic-style-catalog-final.log`.

## Live-service boundary

The user-owned services on 8688 and 8666 were not restarted by this task. Browser
checks still observed old catalog entries there despite newer CSS being served.
Relaunch those services and refresh before judging the final catalog; the current
source was verified using fresh isolated application instances.
