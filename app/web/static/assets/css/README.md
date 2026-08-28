# CSS architecture

Documentation version: `v1.0.0`

`app.css` is the manifest-style entrypoint. Its import order is part of the
cascade contract and must match the source exactly.

## Load order

1. `foundation/fonts.css`
2. `foundation/tokens.css`
3. `layout/shell.css`
4. `components/forms.css`
5. `components/resizer.css`
6. `components/tables.css`
7. `views/workspace.css`
8. `views/settings.css`
9. `views/trade.css`
10. `views/investment.css`
11. `utilities/responsive.css`
12. `foundation/motion.css`

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
