# Architecture guide

Documentation version: `v1.1.0`

## Runtime flow

```text
main.py
  -> app.create_app()
  -> app/web/routes_entry.py
  -> app/web/routes/*.py
  -> app/web/runtime.py
  -> app/services/* and app/infrastructure/*
```

`app/web/runtime.py` assembles request handlers and presentation state. Route modules only register canonical and compatibility URLs.

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
  Price performance  /workspaces/prices
  Portfolio          /workspaces/portfolio
  DCA                /workspaces/dca
  Backtest           /workspaces/backtest
  Grid Trading       /workspaces/grid-trading

Trade
  Investment         /trade/investment
  Live trading       /trade/live-trading

Settings             /settings/<section>
```

Older `/compare`, `/portfolio`, `/backtest`, `/more/*`, `/invest`, and `/investment` paths are compatibility redirects.

## Data ownership

- `market_store/`: cached price histories, profiles, and logos.
- `settings_store/`: device-local settings and investment ledger data.
- `config.toml`: versioned defaults and UI labels.

Tests must not rely on or mutate real device-local data. Unit tests patch store paths; browser tests avoid committing write actions.

## High-risk invariants

- Broker imports are incremental and must remain idempotent.
- Authoritative broker position snapshots reconcile synthesized grant quantities.
- HSBC available cash calibrates cash-account rows, not individual unsettled order rows.
- `.US` broker aliases normalize to the bare US ticker while preserving lineage aliases where required.
- Live-order APIs remain locked unless the server has a strong access token and the request presents it.

## Known structural debt

`app/web/runtime.py`, `app/services/investment_import.py`, and the investment browser modules remain large. Prefer extracting cohesive behavior behind tested interfaces rather than adding another branch to these files.
