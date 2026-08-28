# Compatibility routes and reserved source

Documentation version: `v1.0.0`

This document separates supported compatibility behavior from obsolete
renderers. Compatibility is a tested redirect or normalization contract, not a
license to revive an independent page.

## Route matrix

| Compatibility entry | Canonical target | Contract |
| --- | --- | --- |
| `/compare` | `/workspaces/compare` | Preserve supported comparison query state |
| `/portfolio` | `/workspaces/portfolio` | Preserve supported portfolio query state |
| `/backtest` | `/workspaces/backtest` | Preserve supported backtest query state |
| `/trade-messages` | `/workspaces/backtest` | Historical Backtest alias; redirect only |
| `/dca`, `/workspaces/dca` | `/workspaces/backtest?strategy=dca` | DCA remains a Backtest strategy; preserve DCA query aliases |
| `/workspaces/market-caps` | `/workspaces/prices?metric=market-cap` | Market Cap remains a Ticker comparison metric; redirect only |
| `/workspaces/grid-trading` | `/workspaces/backtest?strategy=grid-trading` | Grid Trading remains a Backtest strategy; redirect only |
| `/more`, `/more/<section>` | `/trade/investment` or normalized `/trade/<section>` | Historical Trade navigation aliases |
| `/invest`, `/investment` | `/trade/investment` | Historical Investment aliases |
| `/?view=<legacy-view>` | The corresponding canonical workspace | Normalize supported legacy query state before redirecting |

Redirect behavior is covered by `tests/test_compatibility_routes.py` and the
domain route tests. New code and browser tests must use canonical URLs.

## Retired and quarantined renderers

- The standalone Market Cap and Grid Trading templates were removed on
  28 Aug 2026. Their compatibility URLs remain redirects.
- `app/web/templates/dca.html` and `_dca_form.html` are an isolated legacy
  renderer pair. Public DCA URLs do not render them. Do not extend this pair or
  treat it as the current DCA UI; the supported implementation is
  `/workspaces/backtest?strategy=dca` with `dca.js` and the
  `_dca_backtest_*` partials. Remove the pair only in a dedicated change that
  also proves no in-progress source work depends on it.
- `runtime.py` and `app.js` still accept selected legacy view names while
  normalizing requests. Do not remove individual branches without testing the
  complete redirect, URL-state, and Backtest DCA chain.

## Dynamic and reserved source

- Strategy modules under `strategies/algorithms/` are dynamically discovered.
  A missing direct import does not prove that a strategy is unused.
- The SF Symbols catalog reserves some currently unreferenced SVG assets. Read
  [`../app/web/static/images/SF_SYMBOLS.md`](../app/web/static/images/SF_SYMBOLS.md)
  before deleting an icon.
- Legacy ticker aliases, broker source spellings, and tracked logo aliases may
  be persistence or adapter contracts. Check Architecture and tests before
  normalizing or removing them.
- Tracked logo assets are the only logo inputs copied into the isolated E2E
  runtime. Machine-local logo caches are not fixtures.

## Retired unsafe entrypoints

The following paths or behaviors must not be restored without an explicit
architecture and security decision:

- `scripts/reconcile_longbridge_statement.py`, which rebuilt and overwrote the
  production investment ledger outside the import commit boundary.
- `playwright.reuse.config.mjs`, which allowed E2E to attach to an arbitrary
  existing server instead of the isolated runtime.
- Raw Longbridge authorization-code handling inside the application.
- The unused direct Bearer-token Longbridge asset REST transport. Current asset
  reads use the CLI; supported order operations use the SDK boundary.
- Independent DCA, Market Cap, or Grid Trading page renderers behind their
  compatibility URLs.

## Removal checklist

Before deleting a compatibility candidate:

1. Search exact names and semantic aliases with `rg`.
2. Inspect route registration, template maps, dynamic loaders, CSS classes, and
   tests.
3. Preserve the canonical feature and query-state conversion.
4. Add or retain an explicit redirect regression.
5. Update this matrix, Architecture or Known Issues as appropriate.
6. Run the focused domain tests and the complete quality gate.
