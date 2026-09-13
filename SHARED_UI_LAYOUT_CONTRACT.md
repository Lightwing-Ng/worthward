# Shared UI Layout Contract

Documentation version: `v1.8.0`

This is the normative spatial contract for Worthward and its sibling
`agenticContext` project. The two implementations may have
different product surfaces, but shared shell geometry, token meanings, ownership
boundaries, and acceptance tolerances are the same.

## Western typeface contract

Publicly distributed projects must not bundle a proprietary interface typeface
without explicit redistribution rights. Worthward resolves ordinary Western
text through the shared `--font-family-base` role and the operating-system stack:
Apple system UI on macOS and iOS, Segoe UI on Windows, and the browser's generic
sans-serif fallback elsewhere. CJK platform families remain explicit glyph
coverage fallbacks. `--font-family-mono` remains a compatibility role that may
alias the same base stack.

Vendored KaTeX mathematical fonts remain an explicit content-font exception and
must not be promoted into the interface font stack. Any future bundled interface
font must carry a redistribution license compatible with the repository license.

## Canonical dimensions

### Component catalog ownership

Style tokens documents reusable components, not an alternate page layout. The
obsolete Workspace article specimen, registry row, and demo-only CSS are removed.
Live article containers remain governed by this contract's semantic layout roles.
The Collapse specimen has no placeholder explanatory paragraph.

- Secondary button supersedes Primary (inverted) button in the catalog. Use
  agenticContext's intrinsic-width glass-chip primitive: fit-content width,
  maximum 100%, right alignment, pill radius, and shared hover/disabled states.
  Product labels may differ; do not stretch the button to fill its specimen cell.
- Shared select dropdown and filter triggers use
  `--shared-select-control-height: 30px` at all existing breakpoints. This does not
  change the separate 36px Agent session-control rail.
- On the Style tokens page, the owning sidebar consumes the same
  `--sidebar-shell-*` contract as every other application sidebar; it has no
  page-local material or padding override.
- Worthward's trade strategy stepper uses `--strategy-param-control-height: 30px`,
  including its specimen input. agenticContext has no trade-strategy stepper and
  does not add a fictitious product component.
- Workspace navigation items use the shared `--settings-nav-item-block-size`,
  `--settings-nav-item-padding-block`, and `--settings-nav-item-gap` tokens. Their
  default block size is `48px`; the sidebar-overlay state uses `36px` for workspace
  destinations while leaving full Settings navigation density unchanged.
- The strategy-tuning row reserves at most `60%` for its label track so the
  right-aligned value track can display seven-digit holding limits without
  clipping. This is a component token, not a Grid Trading page override.
- Shared workspace-modal and floating-notice dismiss buttons use standard error red
  (`--theme-error`). Fine hover-capable pointers reveal them by hovering or
  focusing within the owning modal/notice, not the entire page. Keyboard focus
  reveals the control; coarse/no-hover devices keep it visible. Hidden controls
  do not intercept pointer events. Each shared workspace modal and floating notice uses `12px`
  padding on all four sides. Its circular `24px` dismiss target sits in the upper
  left with equal `12px` CSS top and left insets, so the center has the same distance
  from both axes; any surface border contributes equally. A dedicated leading grid
  track separates that target from the status icon and content rather than
  compensating with extra right padding.

These rules are not tied to the annotation's 1,024px viewport. Existing desktop,
overlay, and compact breakpoints and role-based shell geometry remain unchanged.

### Spatial tokens

The following values are semantic tokens, not page-local overrides:

| Symbol | Meaning | Canonical value |
| --- | --- | --- |
| `E` | Minimum viewport edge pad | `10px` |
| `G` | Shared edge gap | `10px` |
| `W` | Content and card maximum | `640px` |
| `C` | Control and standard dropdown maximum | `384px` |
| `B` | Physical-effect bleed | `48px` |
| `R` | Sidebar and soft card radius | `10px` |
| `T` | Round action size | project token; geometry is shared |
| `M` | Modal and floating-notice inner pad | `12px` |
| `D` | Modal dismiss target size | `24px` |
| `I` | Modal dismiss top/left edge inset | `12px` |

Each project publishes `--layout-content-width: 640px`,
`--layout-control-width: 384px`, `--page-edge-pad: 10px`,
`--layout-edge-gap: var(--page-edge-pad)`, and
`--layout-physical-effect-bleed: 48px`. Feature aliases must reference these tokens.
The effective width of an owned element is `min(parent inline size, W)` or
`min(parent inline size, C)`, never a new intermediate pixel constant, unless a
documented product-specific result surface owns the full parent inline size.

### Sidebar shell tokens

The current agenticContext Agent sidebar is the measured shared-shell reference.
Both projects expose the outer `<aside>` as `data-layout-role="sidebar-shell"` and
consume one semantic `--sidebar-shell-*` token family instead of restating the
material on individual pages.

| Token | Contract |
| --- | --- |
| `--sidebar-shell-width` | `312px` maximum shell width; `--sidebar-width` is a compatibility alias |
| `--sidebar-shell-radius` | `var(--radius-panel)` (`10px`) |
| `--sidebar-shell-padding` | Desktop: `9px 10px 96px`, expressed from `G`, the 1px shell border, and Dock clearance tokens |
| `--sidebar-shell-overlay-padding` | Overlay: `9px 18px 84px`, expressed from the same border and Dock-clearance tokens |
| `--sidebar-shell-background` | Light and Dark gradients measured from the Agent sidebar |
| `--sidebar-shell-border` | Light `rgba(255,255,255,0.30)`; Dark `rgba(210,224,244,0.225)` at the shared 1px border width |
| `--sidebar-shell-shadow` | Light `0 18px 40px rgba(10,14,25,0.12)`; Dark `0 18px 40px rgba(0,0,0,0.22)`, plus the shared inset highlight |
| `--sidebar-shell-blur` | `saturate(160%) blur(18px)` |

The `<=900px` overlay breakpoint changes positioning and consumes the overlay
padding token. The `<=600px` compact breakpoint must not introduce another
sidebar material. A product may reduce the effective width below `312px` when an
external global-action rail owns required horizontal space; that constraint uses
the existing available-width equation and does not redefine the shell token.

## Edge and anchor equations

For each side `s`, define the safe-area-aware page inset:

`P_s = max(E, env(safe-area-inset-s, 0px))`

The page rectangle uses `P_top`, `P_right`, `P_bottom`, and `P_left` as its outer
viewport insets. The visible sidebar rectangle therefore satisfies:

`top = P_top`, `left = P_left`, `bottom = P_bottom`, `radius = R`

The global anchor rectangle is one shared edge gap inside that page rectangle:

`A_top = P_top + G`

`A_right = P_right + G`

`A_bottom = P_bottom + G`

`A_left = P_left + G`

The global theme/action anchor uses `A_top` and `A_right`. The expanded sidebar toggle
has the same vertical centerline and a horizontal offset of `G` from the sidebar's
right edge. Collapsing or opening an overlay preserves the vertical coordinate and
changes only the horizontal translation. No state may move the toggle along its
vertical axis.

The collapsed overlay toggle uses `A_top` and `A_left`, so its top and left viewport
distances are equal when the safe-area insets are equal. The full-viewport sidebar
dismissal target is a transparent rectangular hit layer with zero border radius and
no shadow; it is not a visual card or container.

The dock is centered by the owning sidebar or overlay, not by a viewport-specific
constant:

`dock center x = sidebar or overlay center x`

`sidebar bottom - dock bottom = G`

Any pagination belongs to an explicit owner and satisfies:

`pagination center x = owner center x`

The acceptance tolerance for rendered geometry is `<= 1px`, after waiting for the
intended media-query state and motion settle. Touch-sized controls may use the larger
responsive round-action token while retaining the same anchor equations.

## Responsive state matrix

| State | Sidebar | Toggle and global actions | Content |
| --- | --- | --- | --- |
| Desktop, `>900px` | Normal grid column | Fixed shared top/right anchors; expanded toggle is `G` inside sidebar edge | Two-column or product-specific layout; `W`/`C` maxima apply |
| Overlay, `<=900px` | Fixed inside safe-area insets | Toggle remains separate from global action rail; dock centers inside overlay | Parent width remains authoritative; no sidebar collision |
| Compact, `<=600px` | Same overlay ownership | Same vertical anchors; horizontal reserve is explicit | Single-column flow; controls use `min(parent, C)` |

The matrix is a state contract, not a screenshot breakpoint guess. JavaScript reads the
registered responsive values; production scripts do not create independent width media
queries.

## Ownership and clipping

The following ownership rules are mandatory:

1. The page/workspace shell stays `overflow: visible` wherever shadows, blur,
   translated controls, focus rings, or dropdown ink must escape.
2. An effect host such as a frosted card sets `overflow: visible`; its outer layout
   parent must not clip it accidentally.
3. A named `content-scrollport` is the owner of vertical data scrolling. It may use
   `overflow-x: hidden; overflow-y: auto` and must provide `B` start/bottom bleed when
   its children paint elevated effects near that edge.
4. A chart canvas viewport, data table viewport, answer pane, dropdown, or media viewer
   may clip only its own documented content. That local clipping must not be used as a
   substitute for shell geometry.
5. A resizer, scrollbar, pagination control, and share action must remain measurable in
   its owning surface. Temporary overflow must not resize an unrelated chart or change
   the endpoint of a shared splitter.

## Semantic DOM registry

The implementation exposes these roles through `data-layout-role`:

| Role | Owner or purpose |
| --- | --- |
| `sidebar-shell` | Outer reusable application sidebar surface |
| `sidebar-toggle` | Root sidebar button |
| `sidebar-title` | Sidebar title anchor |
| `global-action-column` | Global action rail |
| `global-theme-anchor` | Theme button used as the global anchor |
| `sidebar-dock` | Bottom sidebar/overlay dock |
| `title-rail`, `title-heading` | Primary page title |
| `result-title-rail`, `result-heading` | Result title/date rail |
| `result-container` | Result surface owning metadata/actions |
| `secondary-heading` | Secondary content heading |
| `content-scrollport` | Explicit top-level content scroll owner |
| `result-actions`, `result-action` | Action group and action button |
| `pagination` | Pagination owned by its nearest surface |

The registry is the test and inspection boundary. Diagnostic XPath selectors may point
to the same nodes, but source CSS and tests must not depend on browser annotation
attributes or temporary preview markers.

## Product-specific invariants

- Portfolio's visible primary title is the single-line `Portfolio`. Its result stack,
  summary card, and return-chart surface use the full available parent inline size at
  desktop and responsive widths rather than the `W` content maximum. The date belongs
  inside the result container, and the share action belongs in that container's upper
  right corner, aligned to the global action centerline without collision.
- Three-column comparison surfaces partition controls, result title, and result body
  into explicit grid owners. Secondary headings cannot extend left of the primary
  result heading.
- Local market-store pagination is centered by the table region, not by the viewport.
- Backtest Metrics and Transactions use the same horizontal resizer endpoint. Metrics
  must not leave a lower unused extent than Transactions.
- Shared select controls and period controls use `C = 384px` or the smaller external
  parent width.

## Acceptance gates

Each project must provide static contract tests for tokens, roles, and overflow
ownership, focused functional tests for its affected surfaces, and rendered browser
checks at desktop, overlay/iPad, and compact widths. The final entry in the
private sibling synchronization ledger may be marked `Synchronized` only after
both projects pass their complete gates and the same geometry is measured on isolated
verification ports.
