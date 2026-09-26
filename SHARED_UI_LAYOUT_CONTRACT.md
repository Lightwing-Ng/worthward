# Shared UI Layout Contract

Documentation version: `v1.21.5`

This is the normative spatial contract for Worthward and its sibling projects,
`agenticContext` and `neoMe`. The three implementations may have different product
surfaces, but every adopted shared component keeps the same shell geometry, token
meaning, ownership boundary, and acceptance tolerance.

## Western typeface contract

All three projects follow
`/Users/lightwing/Desktop/shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md`.
The maintainer has explicitly approved the bundled Univers Next for HSBC source for
these projects. The shared base and former monospace roles resolve Western glyphs
through that family; operating-system Western stacks and separate technical
typefaces are not fallbacks. CJK platform families remain explicit glyph-coverage
fallbacks after the approved family.

Vendored KaTeX mathematical fonts remain the scoped content-font exception and
must not be promoted into the interface stack. A future source change requires an
explicit maintainer instruction and one synchronized three-project contract update.

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
- The Worthward Style tokens Shared select and Strategy tuning specimens use a
  preview-column container query for two display tiers: the 384px control token
  below a 640px column and the 640px content token at or above it. Below 384px,
  each specimen fits its column. This specimen-only presentation leaves ordinary
  production Shared select controls and standard menus at their 384px maximum.
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
- A pressed strategy-tuning action uses the
  `--strategy-tune-button-active-*` contract: an opaque adaptive-white surface
  in Light mode and a transparent surface that follows the surrounding sidebar
  in Dark mode. The standard primary-blue glyph and border, restrained blue
  active shadow, and press transform distinguish it from the idle frosted
  material in both modes.
- Same-page Backtest hydration preserves the result surfaces in place and masks
  only the price/equity canvases, metric values, and Price Field detail plot.
  The mask's glass base is stationary; only its internal highlight animates.
  Whole chart/history-card masks and translating glass overlays are not part of
  the optimistic-loading contract.
- Collapse uses native `details > summary + .ui-collapse-body` semantics. Its
  summary is a two-column grid with one flexible text track and one trailing
  affordance track. The sole affordance is a 12px by 8px current-color chevron:
  it points right while closed and down while open through the shared rotation
  tokens. Keyboard activation and focus-visible treatment remain native, and
  reduced-motion preference removes the chevron transition. Product surfaces may
  adapt body spacing, but must not redefine the marker, direction, or state motion.
- Process List uses a semantic `.process-list > .process-list-step` ordered list.
  Set `role="list"` on the `ol` to retain list semantics when CSS removes the
  native marker.
  Each step has an `aria-hidden` numbered `.process-list-marker` and a
  `.process-list-content` containing a `.process-list-heading` and optional
  paragraph. Only nonterminal steps set `data-process-continues` to draw the
  connector. The common `--process-list-*` tokens preserve a 32px circular
  marker, 2px accent border and connector, transparent marker fill, a 4px
  connector gap without a painted halo, 24px vertical gap, and 16px column gap.
  The marker must reveal its actual carrying surface in both themes, including
  glass and modal surfaces; it must not paint the global page background inside
  or around the ring. A heading centers on the marker; copy starts 5px
  below it. The content track may wrap at narrow widths without changing the
  marker or overflowing the page. AgenticContext's Tunnel onboarding supplies
  the production content, while the Worthward catalog and neoMe component
  stylesheet expose the same primitive without inventing product flows.
  Investment import adapts each broker's numbered upload, paste, or date steps
  into this same ordered-list structure. Broker-specific controls remain inside
  the content track, while the shared marker and connector remain the only
  step affordances; switching an import mode must not leave a dangling track.
- Shared workspace-modal and floating-notice dismiss buttons use standard error red
  (`--theme-error`). Fine hover-capable pointers reveal them by hovering or
  focusing within the owning modal/notice, not the entire page. Keyboard focus
  reveals the control; coarse/no-hover devices keep it visible. Hidden controls
  do not intercept pointer events. Each shared workspace modal and floating notice uses `12px`
  padding on all four sides. Its circular `24px` dismiss target sits in the upper
  left with equal `12px` CSS top and left insets, so the center has the same distance
  from both axes; any surface border contributes equally. A two-column, two-row
  semantic grid leaves the dismiss target absolutely positioned instead of reserving
  a content rail. The first row has a minimum height of
  `--workspace-modal-title-row-min-height`, which resolves to the dismiss size; the
  title occupies its flexible second column and is vertically centered on the dismiss
  target while it fits one line. A wrapped title may grow that row without moving the
  fixed, equal-inset dismiss control. In the second row, the unchanged `36px` topic icon starts at the surface's
  left inset and the paragraph or list starts at the same top coordinate in the
  flexible column after the standard gap. Row gap is the only vertical separation:
  neither the topic icon nor the body adds a private top margin. Ordered and unordered
  body lists use outside markers and hanging wrapped lines. Their shared indentation
  is owned by `--workspace-modal-list-padding-inline-start` and
  `--workspace-modal-list-marker-gap`, not local list literals. A dynamic message wrapper
  exposes one direct title and one direct paragraph or list; without a title, that
  wrapper remains explicitly assigned to the body row.
  The Investment import overlay uses the same upper-left dismiss inset and size.
  Its close button is absolutely positioned inside the modal, not in the
  history-card control rail, so it cannot displace broker or method controls.
  The approved Local resources waiting notification owns the shared notification
  Frosted Glass variant: `--frosted-glass-notice-background`,
  `--frosted-glass-notice-border`, `--frosted-glass-notice-shadow`, and
  `--frosted-glass-notice-blur`. The two existing semantic material aliases resolve
  to that background. The variant uses `saturate(160%) blur(18px)` with its approved
  light and dark translucent gradients, without an extra painted pseudo-element.
  A notification title uses 15px semibold text; paragraph and list bodies use 15px
  regular text with a 1.45 line height, and ordinary paragraph and list copy is muted. The
  close glyph is 12px inside the unchanged 24px target. Catalog specimens consume
  the same variant and hierarchy. Ordinary controls retain the separate general
  62%-opacity, 12px-blur Frosted Glass material. Full-page product forms and the
  460px Investment feedback width remain explicit adapters, not extra notification
  grid owners. The standalone PIN adapter inherits the notification material and
  soft overlay scrim while retaining its one-column form, 392px width, 24px padding,
  six input slots, and authentication boundary. Its existing 420px narrow breakpoint
  keeps a viewport-minus-24px width and 20px padding.
  Investment feedback lists use the same muted ordinary copy; explicit inline
  emphasis and success/error colors remain semantic presentation.
- Circular icon actions use the `.circular-icon-button` primitive. Its canonical
  `--circular-icon-button-*` token family owns the `36px` desktop target, `18px`
  current-color glyph, pill radius, Frosted Glass material, and idle, hover, active,
  and focus-visible states. Responsive layouts may raise the shared target to `44px`.
  Product-specific class names are adapters only; the legacy
  `--settings-round-icon-button-*` names remain compatibility aliases and do not own
  independent values.
- Numeric values may split integer, fractional, and suffix glyphs only as a visual
  presentation. The owning value keeps one complete `aria-label`; every generated
  fragment, including allocation-badge glyph slots, is `aria-hidden="true"` so
  assistive technology reads the original numeric value exactly once.
- Monetary values declare an ISO 4217 `data-currency-code`. Currencies with minor
  units, including CNY/RMB and USD, reuse the shared `0.76` fractional scale;
  zero-minor-unit currencies such as JPY stay in one same-size major fragment.
  Minor-unit behavior is never inferred from a symbol, table position, or locale,
  and the authored display string remains the complete accessible name.
- Pagination reuses `.local-store-pagination`, `.local-store-page-button`, and the
  shared `local-store-pagination.js` builder. Non-active controls use
  `--local-store-pagination-button-color`; hover and focus-visible both resolve to
  the shared blue `--local-store-pagination-button-color-hover`. Arrow masks inherit
  `currentColor`, so glyph and page text cannot diverge. Reduced Motion preserves
  state and geometry while shortening motion.
- A standard scrollable table is
  `.scrollable-data-table-shell.local-store-pagination-host`. Its controller may
  prepend the production `[data-table-visual-overlay]`; after that overlay, the shell
  keeps a direct fixed `table.scrollable-data-table[data-table-header]`, followed by a direct
  `.scrollable-data-table-scroll[data-table-scroll]` containing
  `table.scrollable-data-table[data-table-body]`. A floating shared pagination nav
  may be the final direct child. The shell, header, cell, summary, row, and scrollbar
  geometry come only from `--scrollable-data-table-*`; a specimen must use this
  production DOM and token family rather than a parallel demo table.
- A standard segmented control is emitted by `render_segmented_control` with the
  `.segmented-control` shell and explicit `data-option-count`. Its default geometry
  is shrink-wrapped and centered (`width: fit-content; max-width: 100%;
  margin-inline: auto`) with equal grid tracks
  (`repeat(var(--segmented-option-count), minmax(0, 1fr))`), centered labels, a
  `32px` shell, and `28px` options. Start/end alignment and measured overflow are
  explicit adapters; route CSS must not silently stretch the default primitive.

These rules are not tied to the annotation's 1,024px viewport. Existing desktop,
overlay, and compact breakpoints and role-based shell geometry remain unchanged.

### Standard single-value Shared select

The standard Shared select is the reusable replacement for an ordinary single-value
native `<select>`. A product-specific multi-select, searchable picker, model chooser,
or table-header filter may reuse its visual tokens and keyboard controller, but remains
an explicit adapter and must not be reported as a migrated standard select until it
implements this complete contract.

- The native `<select>` remains the sole form and application-state authority. It is
  retained inside the owning `[data-shared-select-field]`, hidden, marked
  `aria-hidden="true"`, and removed from the tab order with `tabindex="-1"`.
- The visible trigger is a `button[type="button"]` with
  `aria-haspopup="listbox"`, current `aria-expanded`, and `aria-controls` pointing to
  exactly one menu. Its accessible name contains the field label and current option.
  The menu has `role="listbox"` and a field-specific accessible name.
- Each rendered option is a `button[type="button"][role="option"]` with stable identity,
  `tabindex="-1"`, and current `aria-selected`. Disabled native options remain disabled
  and expose `aria-disabled="true"`. Text-only options use direct check and text
  children; optional media adds one explicit media column between them.
- Pointer or keyboard commit first updates native `value`, `selected`, and
  `defaultSelected`, then synchronizes the trigger and option states, closes the menu,
  and dispatches exactly one bubbling native `change` event when the value changed.
  Choosing the current value only closes the menu. Programmatic option replacement or
  value assignment must call the adapter's refresh boundary so native, trigger, and
  listbox state cannot diverge.
- Only one Shared select menu is open in a document. Trigger activation toggles it;
  pointer activation outside the owner closes it. A hidden or disabled backing select
  cannot expose an operable trigger.
- Worthward's `select-controller.js` v1.0.1 is the byte-identical keyboard core in all
  three projects. It uses DOM focus, opens Arrow Up or Arrow Down on the selected
  enabled option, opens Home or End on the corresponding boundary, clamps navigation,
  skips hidden or disabled options, and never changes selection during navigation.
  Enter or Space commits once. Escape is consumed, closes, and restores trigger focus.
  Tab closes without preventing native traversal. Rendering, pointer dismissal, native
  synchronization, and optional portal placement remain adapter-owned.
- The trigger uses `--shared-select-trigger-material`; a standard menu uses
  `--shared-select-dropdown-material`. Both resolve to the shared translucent Frosted
  Glass surface with its standard border, shadow, hover shadow, and blur. A deliberately
  opaque product menu is an explicitly named local variant, not the default material.
- The cross-project semantic token surface is named identically:
  `--shared-select-trigger-material`, `--shared-select-trigger-material-hover`,
  `--shared-select-dropdown-material`, `--shared-select-border`,
  `--shared-select-shadow`, `--shared-select-shadow-hover`, `--shared-select-blur`,
  `--shared-select-trigger-padding-inline-end`, `--shared-select-dropdown-max-width`,
  the existing control/dropdown/option geometry tokens, and the
  `--shared-select-chevron-*` mask, width, height, inline-end, rotation, and duration
  tokens. Local compatibility aliases may resolve into this surface; component rules
  consume the canonical names.
- The trigger affordance is one 12px by 8px `currentColor` down-chevron. It points down
  while closed and rotates 180 degrees to point up while open, using the shared 180ms
  standard easing. Reduced motion removes that transition. The affordance is a distinct
  mask or pseudo-element so a material `background` declaration cannot erase it.
- The trigger is 30px high with a pill radius. The menu opens 4px from the trigger, uses
  10px padding and the shared soft radius, and is bounded by
  `min(360px, 55vh)`. Options are at least 36px high with `9px 10px` padding and a pill
  radius. Standard field and menu width is `min(parent inline size, 384px)`.
- The field and its ordinary ancestors stay paint-visible. When a known clipping or
  modal owner requires a body portal, the adapter measures the trigger, uses fixed
  positioning inside a pointer-transparent overlay, preserves the same inline width
  contract, selects above or below placement from available viewport space, and
  repositions on resize or external scroll. Internal menu scrolling does not move the
  portal.

### Spatial tokens

The following values are semantic tokens, not page-local overrides:

| Symbol | Meaning | Canonical value |
| --- | --- | --- |
| `E` | Minimum viewport edge pad | `10px` |
| `G` | Shared edge gap | `10px` |
| `W` | Content and card maximum | `640px` |
| `C` | Control and standard dropdown maximum | `384px` |
| `B` | Block-end physical-effect clearance | `48px` |
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
Each project exposing this shared shell marks the outer `<aside>` as
`data-layout-role="sidebar-shell"` and
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

Theme switching must not attach forced transitions to the document descendant
tree or its pseudo-elements. Theme values may update in one style pass; finite
interaction feedback is limited to the global toggle icon using compositor-owned
opacity and transform. Reduced-motion preference removes that icon animation.
Product charts update theme colors in place when their data and geometry are
unchanged rather than recreating the chart or refetching data.

The collapsed overlay toggle uses `A_top` and `A_left`, so its top and left viewport
distances are equal when the safe-area insets are equal. The full-viewport sidebar
dismissal target is a transparent rectangular hit layer with zero border radius and
no shadow; it is not a visual card or container.

The dock is centered by the owning sidebar or overlay, not by a viewport-specific
constant:

`dock center x = sidebar or overlay center x`

`sidebar bottom - dock bottom = G`

The Dock is icon-only at every supported breakpoint. Its 44px items and active
indicator step do not expand into a labeled mobile variant. Visible names remain
available through the owning links' `aria-label` and hover/focus tooltips; the
redundant `.sidebar-dock-label` copy stays hidden from rendering.

Any pagination belongs to an explicit owner and satisfies:

`pagination center x = owner center x`

The active-page indicator must be remeasured from the active control after any
viewport or pagination-container geometry change. Once responsive layout and motion
settle, the indicator and active control must have matching x/y coordinates, width,
and height within the rendered-geometry tolerance; a fractional gap must never expose
the active control as a crescent around the indicator.

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
3. A named `content-scrollport` is the owner of vertical data scrolling. Its border
   box must remain inside the workspace shell's inline bounds. It may use
   `overflow-x: hidden; overflow-y: auto` and provide `B` at the block end, but it
   must not manufacture inline effect space with negative margins. Inline effects
   are clipped by their smallest local owner or accommodated without changing the
   scrollport's measured width.
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
- Backtest `Price Field` detail is a product-specific full-inline-width result
  surface. Its plot must meet both parent content edges, preserve the complete
  square 20-by-24 lattice through a container-responsive block minimum, and
  receive history-minimum priority from the shared vertical splitter only while
  that view is active. The plot, panel, and document must not acquire horizontal
  or vertical overflow from this protection.
- Shared select controls and period controls use `C = 384px` or the smaller external
  parent width.

## Acceptance gates

Each project must provide static contract tests for tokens, roles, and overflow
ownership, focused functional tests for its affected surfaces, and rendered browser
checks at desktop, overlay/iPad, and compact widths. The final entry in the
private sibling synchronization ledger may be marked `Synchronized` only after every
applicable project passes its complete gate and the same geometry is measured on
isolated verification ports.
