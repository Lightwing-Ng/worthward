# Shared UI workflow

Documentation version: `v1.3.0`

This is the public entrypoint for shared visual and interaction work. A private
sibling synchronization ledger may exist in a maintainer checkout, but it is not
required to build, run, test, or contribute to Worthward.

## Read order

1. Read this repository's complete baseline in
   [`../SHARED_UI_LAYOUT_CONTRACT.md`](../SHARED_UI_LAYOUT_CONTRACT.md).
2. In a maintainer checkout, read the central ledger and shared layout subset at
   `../../shared_docs/SHARED_UI_SYNC.md` and
   `../../shared_docs/SHARED_UI_LAYOUT_CONTRACT.md` when the change crosses projects.
3. Read [`../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md`](../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md)
   for every typography-family or font-asset change.
4. Read this file.
5. Read the central ledger's `Fast path for agents` section and the matching row.
6. For a cross-cutting change, follow `docs/AGENTS.md` and read `README.md`,
   `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `docs/KNOWN_ISSUES.md`.
7. Inspect the current `Worthward`, `agenticContext`, and `neoMe`
   implementations before editing a shared three-project pattern.

## Contract

- `Worthward` is the canonical complete baseline and the final convergence target.
  Shared improvements discovered anywhere must be promoted here.
- agenticContext is an adapter: its product-specific routes and markup may
  differ, but its shared tokens, states, responsive behavior, and accessibility
  invariants must remain aligned.
- neoMe is the third maintained consumer. Its health-record product surfaces may
  differ, but its shared typography, shell, tokens, and accessibility invariants
  must converge on the same maintained contracts.
- Univers Next for HSBC is the mandatory and sole Western interface typeface in
  all three projects. Browser TTF files are deterministic transports derived from
  the approved TTC, not additional typefaces. Technical text does not have a
  monospace exception; KaTeX mathematical glyphs remain a scoped exception.
- A Cache-first improvement is a `Candidate review`, not a finished synchronization.
  Review and promote it here before the ledger can say `Synchronized`.
- If only this repository is authorized, do not edit either sibling. Set every
  applicable ledger row to `Pending` and include the exact synchronization
  reminders in the handoff.
- Never declare parity from source text, one green test, or visual similarity alone.

## Shared select keyboard controller

Worthward owns `app/web/static/assets/js/select-controller.js` v1.0.1;
agenticContext vendors the aligned v1.0.1 controller at
`app/web/static/select-controller.js`.
The first migration covers Worthward shared fields and Strategy, and the
agenticContext Local resources native-select adapter and source filter. Other pickers are not
yet migrated. Existing domain CSS names remain compatibility contracts.
Templates load the controller before adapters. If a long-running server still
renders a cached template without that tag, each entrypoint dynamically imports
the same versioned same-origin module before initializing its dependent controls.

The reusable baseline is a standard single-value select adapter. It retains a
native `select` as the form-value authority and pairs it with one button trigger
using `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`; its menu
uses `role="listbox"`, and each focusable choice uses `role="option"` plus
`aria-selected`. The adapter mirrors the native select's disabled state to the
trigger and field, and mirrors each native option's hidden or disabled state to
its enhanced option. The trigger is 30 px high, options are at least 36 px high, and
an in-flow dropdown stays within both its parent and the 384 px shared control
width. The trigger and standard dropdown use the semantic Shared select Frosted
Glass material tokens. The closed chevron points right and the open chevron points
down through the shared -90-degree and zero-degree rotation tokens. The menu uses
the approved 62%-opacity theme-adaptive base and 56%-to-16% highlight gradient;
`--shared-select-dropdown-surface-opacity` owns its opacity without changing the
general Frosted Glass or trigger material. Reduced-motion behavior is preserved.

Product-owned portaled selectors keep their existing viewport-aware 420 px cap.
That exception includes Strategy, investment import broker, investment transfer,
and selectors hosted inside the strategy parameter panel; it is not the default
Shared select sizing contract. Product-specific multi-select filters and compact
table-header filters also remain adapter-owned. They may reuse material and
keyboard primitives, but their aggregation semantics, compact geometry, and
portal behavior must not be copied into a standard single-value select or treated
as a reason to migrate them wholesale.

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
verify the production DOM at desktop and narrow widths in every applicable project.

Before handoff, report exact commands, pass/fail counts, live verification, and any
unrelated failures. Update the central ledger only after every applicable project has evidence.
