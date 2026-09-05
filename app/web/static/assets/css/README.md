# CSS architecture

Documentation version: `v1.1.1`

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
10. `views/trade.css`
11. `views/investment.css`
12. `utilities/responsive.css`
13. `foundation/motion.css`

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

The shared `ui-collapse` primitive owns native disclosure markers and token-driven
header/body spacing. Native disclosures use the agenticContext browser-picker
chevron: 12px by 8px, current text color, down when closed and rotated 180
degrees when open, with the same 180ms standard easing. Render it through `templates/_collapse.html`; use the
`Collapse` row in Style tokens to edit its standard values. Backtest common
controls, strategy parameters, training factors, and private action slots all
reuse it. Settings strategy cards retain their dense card-specific branch while
inheriting the same primitive. Do not restore model-specific accordion CSS.

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
