# antigravity

A local-first Flask web app for comparing US stock tickers, building weighted portfolios, running single-ticker strategy backtests, and reviewing timing signals from a server-rendered workspace with locally persisted market data.

## Screenshot

Backtest workspace captured on 28 Mar 2026, showing build `v2.11.11` with the in-app `Updated on` label set to `26 Mar 2026`:

![Backtest workspace screenshot](screenshots/Screenshot%202026-03-28%20at%2017.36.03.png)

## Current scope

- Compare up to 5 tickers on a normalized return basis
- Build weighted portfolios with custom allocations
- Run single-ticker backtests across the built-in strategy library
- Switch between relative periods and exact date ranges
- Use `1d` data by default and enable `1m` backtests when local intraday data exists for the selected ticker
- Choose the backtest execution mode between signal-bar close and next-bar open
- Optionally include cash dividends in comparison, portfolio, and backtest calculations
- Cache daily history, company profiles, logos, and search results locally
- Cache broker-backed `1m` history locally for the latest 6 months of trading days
- Review TradingView-based timing signals from the `More` workspace
- Manage connectivity checks, broker access, Outlook SMTP, Local Market Store maintenance, strategy metadata, and design tokens from the `Settings` workspace

## Runtime requirements

- Python `3.13`
- Dependencies from `requirements.txt`
- `pyarrow` for parquet persistence
- Longbridge credentials if you want broker-backed `1m` history
- Optional Microsoft Entra app credentials if you want Outlook SMTP OAuth

This repository uses the host machine's `Python 3.13` interpreter directly. The helper scripts pin the interpreter path so shell-level `Python 3.14` defaults do not affect the project.

## Setup the project environment

Install project dependencies into the host `Python 3.13` environment with:

```bash
./scripts/setup_python.sh
```

By default, the setup script uses:

```text
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
```

If your `Python 3.13` lives elsewhere, override it explicitly:

```bash
ANTIGRAVITY_PYTHON=/absolute/path/to/python3.13 ./scripts/setup_python.sh
```

## Run locally

Start the app through the pinned host-interpreter wrapper:

```bash
./scripts/run_app.sh
```

Default server endpoint:

```text
http://127.0.0.1:8688
```

The host and port are configured in `config.toml`.

## Workspace map

- `Compare`
  Compare up to 5 tickers over the same window with optional cash dividend inclusion.
- `Portfolio`
  Build weighted portfolios and inspect both allocation and aggregate return.
- `Backtest`
  Run a single-ticker strategy backtest with configurable capital, interval, dividends, and strategy parameters.
- `More`
  Inspect the `Timing` view, which combines your watched tickers with TradingView technical metrics.
- `Settings`
  Review app metadata, execution preferences, design tokens, service health, broker and SMTP configuration, Local Market Store maintenance, strategy metadata, and cache controls.

## Project layout

```text
main.py                  → Flask entry point
config.toml              → Local configuration, defaults, UI labels, and version metadata
README.md                → Project documentation
scripts/                 → Pinned host-Python setup, run, and test entrypoints
app/                     → Main application package
strategies/              → Strategy framework and implementations
tests/                   → Focused regression tests
market_store/            → Local parquet, profile, logo, and search caches
screenshots/             → README and release screenshots
```

`settings_store/` is not committed in this repository, but it is created locally at runtime when broker or SMTP settings are saved.

## Key modules

### `app/`

- `core/`
  Configuration, app settings, broker settings, SMTP settings, and backtest settings
- `services/`
  Comparison logic, market-data freshness, presentation helpers, logos, and date constraints
- `infrastructure/`
  Storage, connectivity checks, and broker-backed market data
- `models/`
  Shared schemas and typed payload models
- `web/`
  Route registration, runtime handlers, templates, static assets, and token registry

### `strategies/`

- `base.py`
  Strategy interface and parameter schema
- `loader.py`
  Strategy discovery, loading, and registry generation
- `backtest.py`
  Backtest execution and trade log formatting
- `registry.json`
  UI-facing strategy catalog metadata
- `algorithms/`
  Concrete strategy implementations

## Data sources and storage

### Daily history

- Retrieved through `yfinance`
- Stored in `market_store/historical/` as parquet
- Used by comparison views, portfolio views, and default backtests

### 1-minute history

- Retrieved through Longbridge only
- Stored in `market_store/historical/` as parquet
- Trimmed to the latest 6 months of trading days on refresh
- Used when local `1m` data is available for the selected ticker

### Metadata and search

- Company profiles and logo assets are cached locally
- Search-result caches and ticker-usage records are also stored locally

## Settings workspace

The current `Settings` navigation includes:

- `About`
- `General`
- `Font tokens`
- `Material tokens`
- `Style tokens`
- `Network self-check`
- `Broker access`
- `Email (SMTP)`
- `Local market store`
- `Strategies`
- `Clear caches`

## Outlook SMTP setup

- Uses `smtp-mail.outlook.com:587` with `STARTTLS`
- Targets Microsoft OAuth `2.0` rather than legacy password-first SMTP setup
- Supports both Microsoft `365` work or school mailboxes and personal Outlook.com, Hotmail, Live, or MSN mailboxes
- Expects a Microsoft Entra app client ID plus the delegated SMTP scope `https://outlook.office.com/SMTP.Send`
- Supports device-code authorization so the mailbox owner can approve the app in a browser and reuse refresh tokens locally

## Broker support

### Longbridge

- Supported for fetching `1m` history
- Requires App Key, App Secret, and Access Token

### IBKR

- The UI exposes IBKR configuration status
- Historical `1m` fetching is not implemented yet

## Local Market Store behavior

- Daily history can be refreshed per ticker
- `1m` history can be refreshed per ticker
- Bulk maintenance refreshes cached daily datasets plus protected metadata assets
- Bulk maintenance does not fetch `1m` history for every ticker
- Deleting a ticker removes its locally cached market and metadata records

## Timezone and `1m` integrity

- The application standardizes market timestamps to `America/New_York`
- Longbridge `1m` timestamps for US symbols are interpreted as `Asia/Hong_Kong` before conversion
- Stored parquet timestamps are saved as naive New York Time values for consistency across the app
- A dedicated verification route is available at `/test/chart/1m/<ticker>/<date>` and `/test/chart/1m/last5`

## Running tests

Run the full test suite through the pinned host interpreter:

```bash
./scripts/test.sh
```

You can also pass any regular `pytest` arguments through the wrapper:

```bash
./scripts/test.sh tests/test_more_page.py -vv
```

If dependencies are not installed yet, run `./scripts/setup_python.sh` first.
