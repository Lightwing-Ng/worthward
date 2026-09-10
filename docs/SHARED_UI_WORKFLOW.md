# Shared UI workflow

Documentation version: `v1.1.4`

This is the short entrypoint for shared visual and interaction work. The only
long-form synchronization state lives in:

`/Users/example/Desktop/shared_docs/SHARED_UI_SYNC.md`

## Read order

1. Read [`../SHARED_UI_LAYOUT_CONTRACT.md`](../SHARED_UI_LAYOUT_CONTRACT.md).
2. Read this file.
3. Read the central ledger's `Fast path for agents` section and the matching row.
4. For a cross-cutting change, follow `docs/AGENTS.md` and read `README.md`,
   `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `docs/KNOWN_ISSUES.md`.
5. Inspect the current `Worthward` implementation and the named
   `agenticContext` implementation before editing either one.

## Contract

- `Worthward` is the canonical complete baseline and the final convergence target.
  Shared improvements discovered anywhere must be promoted here.
- agenticContext is an adapter: its product-specific routes and markup may
  differ, but its shared tokens, states, responsive behavior, and accessibility
  invariants must remain aligned.
- A Cache-first improvement is a `Candidate review`, not a finished synchronization.
  Review and promote it here before the ledger can say `Synchronized`.
- If only this repository is authorized, do not edit the sibling. Set the ledger row
  to `Pending` and include the exact sibling-sync reminder in the handoff.
- Never declare parity from source text, one green test, or visual similarity alone.

## Shared select keyboard controller

Worthward owns `app/web/static/assets/js/select-controller.js` v1.0.1;
agenticContext still vendors v1.0.0 at
`app/web/static/select-controller.js`, pending the propagation fix described in
the central ledger.
The first migration covers Worthward shared fields and Strategy, and the sibling
Local resources native-select adapter and source filter. Other pickers are not
yet migrated. Existing domain CSS names remain compatibility contracts.
Templates load the controller before adapters. If a long-running server still
renders a cached template without that tag, each entrypoint dynamically imports
the same versioned same-origin module before initializing its dependent controls.

The controller uses DOM focus on options, without a competing
`aria-activedescendant` on the blurred trigger. Arrow keys open at the selected
enabled option; Home/End open at boundaries. Navigation clamps without selection,
skips disabled/hidden options, and resolves the current option list on each event.
Enter/Space invokes the existing selection callback once. Escape restores trigger
focus and stops the handled key event from leaking into an enclosing overlay.
Tab closes and allows native traversal from the trigger, including body
portals. Rendering, pointer selection, outside-click dismissal, submission, and
portal positioning remain adapter-owned. Keyboard binding exposes a teardown
callback; dynamically hydrated Worthward fields use weakly keyed adapters.

Run `node --test tests/test_select_controller.mjs` and the isolated
`tests/e2e/select-keyboard.spec.mjs` tests for this migration.

## Verification evidence

Preserve unrelated dirty files and record the component row, paths, versions or
commit, invariant, focused checks, and live route evidence. Run focused tests first;
run `./scripts/check.sh` before handoff when shared tokens, shell, responsive
behavior, motion, or accessibility behavior changed. For visual or interaction work,
verify the production DOM at desktop and narrow widths in both projects.

Before handoff, report exact commands, pass/fail counts, live verification, and any
unrelated failures. Update the central ledger only after both projects have evidence.
