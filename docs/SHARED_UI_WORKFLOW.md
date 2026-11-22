# Shared UI workflow

Documentation version: `v1.4.1`

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
4. Read [`../../shared_docs/SHARED_UI_MOTION_CONTRACT.md`](../../shared_docs/SHARED_UI_MOTION_CONTRACT.md)
   for every cross-project finite acceleration or gesture release change. It
   uses damping ratio `0.80` and owns the shared spring sampling token.
5. Read this file.
6. Read the central ledger's `Fast path for agents` section and the matching row.
7. For a cross-cutting change, follow `docs/AGENTS.md` and read `README.md`,
   `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `docs/KNOWN_ISSUES.md`.
8. Inspect the current `Worthward`, `agenticContext`, and `neoMe`
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
- The central shared layout contract at `v1.23.0` retains responsibility for
  geometry and hit regions. Worthward's `--motion-spring-080` and
  `WorthwardMotion.springState` implement the motion contract without changing
  clamped model values. The resizer applies release velocity to its decorative
  pseudo-element; boundary stretch never moves its button hit region.

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
its enhanced option. The default pill trigger is 30 px high, and options are at
least 36 px high. An in-flow dropdown stays within both its parent and the
384 px shared control width. The trigger and standard dropdown use the semantic Shared select Frosted
Glass material tokens. The closed chevron points right and the open chevron points
down through the shared -90-degree and zero-degree rotation tokens. The menu uses
the approved 62%-opacity theme-adaptive base and 56%-to-16% highlight gradient;
`--shared-select-dropdown-surface-opacity` owns its opacity without changing the
general Frosted Glass or trigger material. Reduced-motion behavior is preserved.

The opt-in `data-shared-select-variant="rounded"` field keeps that same adapter,
material, and interaction contract while giving its trigger a 10 px
`--shared-select-rounded-radius` and content-driven `height: auto`. Its padding
and minimum height reuse the option geometry tokens. A selected identity reuses
the option content's 20 px logo and title/description metrics, including wrapping
within the available width. Different trigger and menu widths can produce
different intrinsic heights; never impose a fixed-height equality between them.
Stock details uses this variant, and Style tokens catalogs it as
`Shared select rounded rectangle` beside the unchanged standard Period specimen.
AgenticContext and neoMe remain pending consumers until their adaptations and
verification are recorded in the central ledger.

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

Run `node --test tests/js/shared/test_select_controller.mjs` and the isolated
`tests/e2e/shared/select-keyboard.spec.mjs` tests for this migration.

## Spring motion adoption

Worthward defines the shared 33-stop spring token in
`app/web/static/assets/css/foundation/tokens.css` and its analytic state and
velocity sampler in `app/web/static/assets/js/motion.js`. CSS aliases and
first-party finite animation consumers use the shared spring. The numeric digit
spring and Backtest scroll fallback recompute damping from the same ratio.
Previously keyed decorative pulses and the sidebar impulse interpolate their authored
samples linearly so a second spring does not amplify the rebound. Infinite
rotation, shimmer, and live marker breathing remain linear and Reduced Motion
continues to skip their transient effects. `app/web/static/assets/js/resizer.js`
keeps committed width and ARIA values clamped while animating a bounded
pseudo-element after pointer release. Validate the physics with
`node --test tests/js/shared/test_motion_core.mjs`, then run focused resizer
and rendered-style checks on an isolated server. Source tests, browser proof,
and the separately served `8688` version must be recorded independently in
the central ledger before marking three-project parity.

The Price Compare subplot reorder follows the pointer without nonlinear
distance amplification. Its release velocity initializes sampled spring frames
for the moved panel. At the first or last slot, only the handle's decorative
pseudo-element stretches; cancellation leaves the order unchanged and clears
the transient. The focused browser check lives in
[the Price subplot motion spec](../tests/e2e/workspaces/price-subplot-motion.spec.mjs).

## Verification evidence

Preserve unrelated dirty files and record the component row, paths, versions or
commit, invariant, focused checks, and live route evidence. Run focused tests first;
run `./scripts/check.sh` before handoff when shared tokens, shell, responsive
behavior, motion, or accessibility behavior changed. For visual or interaction work,
verify the production DOM at desktop and narrow widths in every applicable project.

Before handoff, report exact commands, pass/fail counts, live verification, and any
unrelated failures. Update the central ledger only after every applicable project has evidence.
