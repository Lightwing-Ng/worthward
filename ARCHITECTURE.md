# Architecture guide

Documentation version: `v1.8.8`

## Runtime flow

```text
main.py
  -> app.create_app()
  -> app/web/routes_entry.py
  -> app/web/routes/*.py
  -> app/web/runtime.py
  -> app/services/* and app/infrastructure/*
```

`app/web/runtime.py` assembles request handlers and presentation state. Route modules only register canonical and compatibility URLs. The trade module also owns the browser PIN unlock endpoint; account and order APIs apply the separate strong access-token check at the request boundary.

## Layers

- `app/core/`: configuration and persisted local settings.
- `app/models/`: shared data schemas.
- `app/infrastructure/`: filesystem storage, network boundaries, and broker clients.
- `app/services/`: domain logic for comparisons, market data, investments, DCA, logos, and live trading.
- `app/web/`: Flask routes, templates, token registry, CSS, and browser JavaScript.
- `strategies/`: strategy discovery, signal generation, and backtest execution.

Dependencies should point inward: web handlers call services; services use infrastructure boundaries; templates and JavaScript do not own accounting rules.

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
- Live-order APIs remain locked unless the server has a strong access token and the request presents it.
- Browser Live trading additionally requires a six-digit PIN, with the unlock
  held only in the signed browser session.
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
- `app/services/investment_record_basics.py`: shared import text, decimal, and normalized transaction-view helpers reused by `investment_import.py`.
- `app/web/static/assets/js/chart-axis-utils.js`: shared chart tick-index and theme-token helpers loaded from `base.html` as `window.ANTIGRAVITY_CHART_AXIS` before consumer scripts. `readThemeTokens` resolves CSS custom properties, then explicit fallbacks, then `ANTIGRAVITY_APP.theme`, then empty strings. Consumers keep local fallbacks if the shared script is unavailable.

## Known structural debt

`app/web/runtime.py`, `app/services/investment_import.py`, and the investment browser modules remain large. Prefer extracting cohesive behavior behind tested interfaces rather than adding another branch to these files.
