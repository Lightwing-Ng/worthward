# CSS architecture

Documentation version: `v1.6.1`

`app.css` is the manifest-style entrypoint. Its import order is part of the
cascade contract and must match the source exactly.

## Load order

1. `foundation/fonts.css`
2. `foundation/tokens.css`
3. `layout/shell.css`
4. `components/forms.css`
5. `components/collapse.css`
6. `components/resizer.css`
7. `components/tables.css`
8. `views/workspace.css`
9. `views/settings.css`
10. `views/settings-sections.css`
11. `views/trade.css`
12. `views/investment.css`
13. `views/investment-tables.css`
14. `utilities/responsive.css`
15. `foundation/motion.css`

## Cache versions

Every `app.css` import query is a cache contract. When a module's behavior or
rendered output changes, update its query in `app.css` in the same change and
bump the `app.css` cache version used by every direct template consumer.
Likewise, a template or JavaScript module that imports a first-party asset must
use the imported file's current `Code version`. Do not infer freshness from a
file modification time or update only one of several consumers.

The file-level version and a historical CSS import query are separate revision
markers in older modules. Preserve an existing module's convention unless a
dedicated migration updates its manifest entry and tests together.

## Editing guide

Standard circular icon actions use `--circular-icon-button-size`: 30px above
900px and the existing 44px touch target at or below 900px. The 18px glyph is
unchanged. Compatibility aliases, shared action rails, sidebar positions, and
title clearance derive from that owner; do not restore private 36px control
dimensions or change independent modal-dismiss, topic-icon, or Process List sizes.

The sidebar Dock retains its pill-shaped Frosted Glass surface at every breakpoint.
Settings navigation extends behind it instead of ending above a fixed footer band.
Dock clearance belongs to the navigation scroll content's trailing padding and
scroll padding, with a short fade at the sidebar's bottom edge. Keep the sidebar
material, Dock indicator, and tooltip surfaces intact. Settings rows locally use
36px block size and 4px vertical padding; other navigation keeps its own density.

Shared workspace modals and floating notices use a two-column, two-row semantic
grid. The absolutely positioned upper-left dismiss target stays out of flow. The
title occupies the flexible first-row cell and centers on that dismiss target;
the unchanged topic icon and the paragraph or list share the second-row start.
Use the shared row gap rather than icon or body top margins. Dynamic banner
content contains one direct heading and one direct body element; a heading-less
fallback is assigned explicitly to the body row. Numbered copy uses a semantic
`ol` with outside markers so wrapped lines keep a hanging indent. Its list inset
and marker gap come from `--workspace-modal-list-padding-inline-start` and
`--workspace-modal-list-marker-gap`. Do not restore
a dismiss column that consumes the full content height.

Ticker inputs share one leading-slot geometry in `components/forms.css`: the
logo center is half the input height from its leading edge and vertically
centered. Text padding follows the same center and logo size, preserving the
existing logo-to-text gap as responsive control heights change.

Nested `ui-collapse` children retain their leading indentation while their
containing body omits trailing padding. Parent and child disclosure chevrons
therefore share the same trailing edge at every nesting level.

The shared `ui-collapse` primitive owns native disclosure markers and token-driven
header/body spacing. Native disclosures use one 12px by 8px current-color chevron:
the closed state rotates the down-chevron mask -90 degrees to point right, and the
open state returns it to 0 degrees to point down. The 90-degree transition uses
the standard 180ms easing and is disabled for reduced motion. Render it through
`templates/_collapse.html`; use the `Collapse` row in Style tokens to edit its
standard values. Backtest common
controls, strategy parameters, training factors, and private action slots all
reuse it. Settings strategy cards retain their dense card-specific branch while
inheriting the same primitive. Do not restore model-specific accordion CSS.

Standard Shared select menus use their own opacity token while retaining the
approved Backtest Period material: a 56%/16% theme-highlight gradient over a 62%
theme-background surface. The trigger and general Frosted Glass material are
unchanged. The shared current-color chevron uses the same right-closed,
down-expanded states as Collapse. Explicitly opaque strategy-parameter adapters
retain their existing local surface rather than changing the standard menu.

- Put design tokens, globals, and cross-cutting primitives in `foundation/`.
- Put app shell and structural layout rules in `layout/`.
- Put reusable controls and interaction patterns in `components/`.
- Put page or feature-specific styling in `views/`.
- Put shared breakpoints and responsive overrides in `utilities/`.
- Read the root documentation map before deleting an unreferenced selector;
  compatibility routes and reserved assets may be dynamic.

Keep selector order stable unless the change intentionally modifies cascade
behavior. Run the static cache-version contract and browser checks after a
manifest or load-order change.

Allocation range thumbs use the shared resizer's Frosted Glass background, border,
shadow, and backdrop blur in both browser pseudo-elements. Hover, keyboard focus,
and dragging add its accent border with the standard primary-blue focus ring and
glow tokens. Range colors belong to the tracks and labels; the thumb dimensions
and pointer hit areas stay unchanged.

## Field-label typography

The font-family layer follows
[`../../../../../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md`](../../../../../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md).
`foundation/fonts.css` exposes only deterministic standalone faces from the
pinned Univers Next for HSBC TTC, while `foundation/tokens.css` routes ordinary
and technical Western text through that one family. Do not add a platform or
monospace Western bypass. CJK glyph fallback and scoped KaTeX mathematical fonts
do not create an alternate interface family.

Ordinary form labels, ticker field headings, switch captions, and strategy parameter
labels use `--font-ui-lg` (15px) and `--font-weight-regular` (400), matching the
agenticContext Agent Session source label. Forms and workspace component owners
apply this contract at every existing breakpoint. Keep input values, selected
segmented options, section headings, and data-table headers on their own semantic
typography rules. Do not change `--font-form-label` globally: legacy consumers also
include control values and supporting copy.
