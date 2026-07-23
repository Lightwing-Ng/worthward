# Architecture guide

Documentation version: `v1.12.3`

## Runtime flow

```text
main.py
  -> app.create_app()
  -> app/web/routes_entry.py
  -> app/web/routes/*.py
  -> app/web/runtime.py
  -> app/services/* and app/infrastructure/*
```

`app/web/runtime.py` assembles request handlers and presentation state. Route modules only register canonical and compatibility URLs. The trade module also owns the browser PIN unlock endpoint; live account and order APIs authorize either that signed browser session or a valid strong access token at the request boundary.

## Layers

- `app/core/`: configuration, persisted local settings, and dependency-neutral
  market-calendar primitives.
- `app/models/`: shared data schemas.
- `app/infrastructure/`: filesystem storage, network boundaries, and broker clients.
- `app/services/`: domain logic for comparisons, market data, investments, DCA, logos, and live trading.
- `app/web/`: Flask routes, templates, token registry, CSS, and browser JavaScript.
- `strategies/`: strategy discovery, signal generation, and backtest execution.

Dependencies should point inward: web handlers call services; services use infrastructure boundaries; templates and JavaScript do not own accounting rules.

Infrastructure may import `app/core`, models, and infrastructure peers, but it
must not import a service merely to reuse a domain-neutral primitive. NYSE
calendar and completed-session calculations therefore live in
`app/core/market_calendar.py`; `app/services/date_constraints.py` re-exports
their established public names for compatibility.

## Canonical navigation

```text
Workspace
  Return comparison  /workspaces/compare
  Market cap         /workspaces/market-caps
  Price performance  /workspaces/prices
  Portfolio          /workspaces/portfolio
  DCA                /workspaces/dca
  Backtest           /workspaces/backtest
  Grid trading       /workspaces/grid-trading

Trade
  Investment         /trade/investment
  Live trading       /trade/live-trading

Settings             /settings/<section>
```

Older `/compare`, `/portfolio`, `/backtest`, `/more/*`, `/invest`, and `/investment` paths are compatibility redirects.

The former `/trade/timing` and `/trade/invest` aliases resolve to the current
Investment workspace. There is no separate Timing renderer in the current
runtime.

Backtest and Grid trading share result presentation and market-range components, but they are separate workspace modes. Backtest exposes the general strategy catalog; Grid trading locks strategy execution to `grid-trading` and owns its parameter surface.

Return comparison, Market cap comparison, and Price performance share ticker, relative-range, exact-date, and per-view session-memory infrastructure. Market cap history is derived from authoritative cached prices and point-in-time Yahoo-reported shares outstanding, with SEC company facts as the rate-limit fallback. Funds without company-facts shares use SEC Form N-PORT net assets. For the latest trading day, Longbridge `mktcap` and `last_done` provide an independent implied-share cross-check and the preferred current point. The service records matched, review, or diverged status after normalizing comparable providers to the same price; missing pre-disclosure periods remain unknown, and current Longbridge shares are never backfilled into older dates.

## Data ownership

- `market_store/`: cached price histories, profiles, and logos.
- `settings_store/`: device-local settings and investment ledger data.
- `config.toml`: versioned defaults and UI labels.

Tests must not rely on or mutate real device-local data. Unit tests patch store paths; browser tests avoid committing write actions.

## High-risk invariants

- Broker imports are incremental and must remain idempotent.
- IBKR is a file-import-only integration. Official CSV and GainsKeeper files may enter the ledger, but Flex Web Service, Client Portal, Gateway, credentials, sessions, market data, and order-routing must not be reintroduced without an explicit user-approved architecture and security decision.
- Investment source evidence is immutable, SHA-256-addressed, capacity-bounded, and verified under the ledger lock before persistence and at application startup. A ledger manifest must never retain raw uploaded Base64 bytes.
- Each distinct source-artifact manifest digest maps to exactly one immutable `.bin` file at `investment_evidence_dir_for(parquet_path) / <sha256>.bin`; identical source bytes reuse that file. The evidence directory is derived from the ledger parquet path as `<parquet-stem>_evidence` and is not an independently configurable store.
- `commit_investment_import` requires both the source-evidence materializer and persisted-payload verifier. Every production import path must provide and execute both callbacks; neither is an optional escape hatch.
- Evidence materialization, persisted-manifest verification, and `clear_investment_store` evidence-directory removal all hold the same reentrant `market_store_file_lock(parquet_path)`. A per-artifact file lock is supplementary and must never replace the ledger lock for an operation that changes or validates the manifest-to-directory relationship.
- Manually confirmed internal-transfer bindings are durable ledger facts. Import
  adapters must preserve their cross-import leg identities and must fail back to
  explicit review when an identity becomes ambiguous.
- Authoritative broker position snapshots reconcile synthesized grant quantities.
- HSBC available cash calibrates cash-account rows, not individual unsettled order rows.
- HSBC monthly PDF imports accept one unordered file bundle, classify composite and investment statements from extracted content, and require a matched pair for every end date. Investment rows own security identity; composite rows own cash reconciliation, and historical statement snapshots cannot supersede a newer live paste snapshot.
- Canonical tickers are market-qualified only when the market needs to be
  distinguished: US securities are bare (`META`), Hong Kong uses `.HK`,
  Shanghai uses `.SH`, and Shenzhen uses `.SZ`. The format applies to display,
  routes, profiles, caches, and new market-store keys.
- `.US` is a Longbridge adapter format only. Inbound `.US` aliases normalize to
  the bare US ticker before persistence or display; the outbound Longbridge
  adapter adds `.US` only for a bare US request. The Yahoo adapter similarly
  converts canonical Shanghai `.SH` to Yahoo's `.SS` only for its remote
  request. Legacy aliases and raw import provenance can retain their original
  spelling for compatibility, but cannot become canonical project tickers.
- Live account and order APIs authorize a request through either a signed browser
  session established by the six-digit PIN or a configured, correctly presented
  access token of at least 32 characters. The PIN unlock remains browser-session-only.
- A Yahoo rate-limit signal pauses every yfinance request routed through the
  shared market-data service; the backoff is bounded and browser Investment
  polling must not bypass it with per-ticker request fan-out.
- Investment identity labels treat bare US tickers and their `.US` aliases as
  one placeholder family. A valid stored name is preserved across a degraded
  yfinance profile refresh; a vetted fallback is rendered in memory without
  rewriting the user's profile or investment stores.

## Shared web helpers

- `app/web/form_parsing.py`: pure query/form parsing and portfolio weight normalization used by WebRuntime.
- `app/web/navigation.py`: canonical workspace, settings, and trade path constants and builders.
- `app/web/market_history.py`: read-only local-history range and date-alignment helpers used by WebRuntime.
- `app/web/strategy_forms.py`: pure strategy selector, parameter-field, and
  Settings catalog presentation builders. WebRuntime supplies strategy usage
  history and the strategy factory while retaining request assembly.
- `app/web/style_token_rows.py`: pure Settings design-token presentation
  builders. WebRuntime supplies translated labels and the project display URL;
  the module has no request, storage, broker, or live-order dependency.
- `app/services/investment_record_basics.py`: shared import text, decimal, and normalized transaction-view helpers reused by `investment_import.py`.
- `app/services/investment_import_registry.py`: explicit broker and source-format parser dispatch plus the normalize, idempotent merge, atomic persistence, cache invalidation, and readback-verification boundary. Broker parsers remain in `investment_import.py` until they can move without obscuring their reconciliation invariants.
- `app/web/static/assets/js/chart-axis-utils.js`: shared chart tick-index, theme-token, and dynamic logo-URL helpers loaded from `base.html` as `window.ANTIGRAVITY_CHART_AXIS` before consumer scripts. `readThemeTokens` resolves CSS custom properties, then explicit fallbacks, then `ANTIGRAVITY_APP.theme`, then empty strings. `normalizeSafeImageUrl` permits HTTP(S) URLs and controlled local logo paths only; dynamic tooltip data is rendered through DOM properties rather than interpolated HTML. Existing theme-token consumers keep local fallbacks if the shared script is unavailable.
- `app/web/static/assets/js/investment/realtime.js`: quote-poll lifecycle and numeric transition behavior.
- `app/web/static/assets/js/investment/stock-details.js`: Stock-details range, session-boundary, and rendering helpers.
- `app/web/static/assets/js/investment/transaction-filters.js`: broker, currency, type, and date-filter contracts.
- `app/web/static/assets/js/investment/transaction-table.js`: visible-row selection, stable descending order, page clamping, and ledger-to-page lookup.
- `app/web/static/assets/js/investment/layout.js`: split-layout measurement, clamping, observers, and resizer cleanup.

`investment.js` imports these browser modules and remains their composition root.
Each extracted module has a direct Node unit-test suite; Playwright verifies the
assembled browser behavior.

## Quality-gate topology

`scripts/check.sh` is the single local and CI entry point. It runs Ruff,
JavaScript syntax checks, Python coverage, Node tests with source coverage, and
isolated Chromium E2E tests. `.github/workflows/quality.yml` invokes the same
script on pushes and pull requests, so CI does not maintain a parallel test
definition.

## Known structural debt

`app/web/runtime.py`, the broker-specific parser collection in
`app/services/investment_import.py`, and the remaining Investment entry
composition are still large. Extend the parser registry and tested JavaScript
module boundaries instead of adding route-level dispatch or another cohesive
feature implementation directly to those files.
