# CSS Architecture

Code version: v0.3.0

This directory now uses a manifest-style entry file in `app.css`.
Keep the manifest query-string version in sync with the code version when you change module contents.

## Load Order

1. `foundation/tokens.css`
2. `layout/shell.css`
3. `components/forms.css`
4. `views/workspace.css`
5. `views/settings.css`
6. `views/trade.css`
7. `utilities/responsive.css`

## Editing Guide

- Put design tokens, globals, and cross-cutting primitives in `foundation/`.
- Put app shell and structural layout rules in `layout/`.
- Put reusable controls and interaction patterns in `components/`.
- Put page or feature-specific styling in `views/`.
- Put shared breakpoints and responsive overrides in `utilities/`.

Keep selector order stable unless you are intentionally changing cascade behavior.
