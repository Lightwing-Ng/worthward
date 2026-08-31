# Shared UI Layout Contract

Documentation version: `v1.0.0`

This is the normative spatial contract for the sibling projects
`/Users/example/Desktop/antigravity` and
`/Users/example/Desktop/CacheLikesFromTwitter`. The two implementations may have
different product surfaces, but shared shell geometry, token meanings, ownership
boundaries, and acceptance tolerances are the same.

## Canonical dimensions

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

Each project publishes `--layout-content-width: 640px`,
`--layout-control-width: 384px`, `--page-edge-pad: 10px`,
`--layout-edge-gap: var(--page-edge-pad)`, and
`--layout-physical-effect-bleed: 48px`. Feature aliases must reference these tokens.
The effective width of an owned element is `min(parent inline size, W)` or
`min(parent inline size, C)`, never a new intermediate pixel constant.

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

- Portfolio's visible primary title is the single-line `Portfolio`. The date belongs
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
checks at desktop, overlay/iPad, and compact widths. The final synchronization entry in
`/Users/example/Desktop/SHARED_UI_SYNC.md` may be marked `Synchronized` only after
both projects pass their complete gates and the same geometry is measured on isolated
verification ports.
