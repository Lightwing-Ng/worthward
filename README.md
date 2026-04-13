# antigravity

A local-first Flask web app for comparing US stock tickers, building weighted portfolios, running single-ticker strategy backtests, and reviewing timing signals from a server-rendered workspace with locally persisted market data.

## Screenshot

Backtest workspace captured on 28 Mar 2026:

<img src="https://free.boltp.com/2026/04/09/69d754e3d81d8.webp" alt="Screenshot 2026-04-09 at 15.21.05" />

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
- Review manually imported investment transactions from the `More → Investment` workspace
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

Default server bind:

```text
0.0.0.0:8688
```

Open `http://127.0.0.1:8688` locally in your browser. The host and port are configured in `config.toml`.

## Workspace map

- `Compare`
  Compare up to 5 tickers over the same window with optional cash dividend inclusion.
- `Portfolio`
  Build weighted portfolios and inspect both allocation and aggregate return.
- `Backtest`
  Run a single-ticker strategy backtest with configurable capital, interval, dividends, and strategy parameters.
- `More`
  Inspect the `Timing` and `Investment` views.
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
```

`settings_store/` is not committed in this repository, but it is created locally at runtime when broker or SMTP settings are saved or when investment transactions are imported.

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

### Investment ledger and valuation

- Investment transactions are read from `settings_store/investment.json`
- The `More → Investment` workspace renders a holdings table, an equity curve, metrics, and a transaction history table from that ledger
- The investment equity curve starts from the first real transaction row in the ledger and does not prepend any synthetic zero-value point
- Holdings reuse locally cached ticker profiles and logos when available
- Configured money market funds can fall back to the transaction `description` field for their display name when no local profile is available
- Realized P&L uses the investment ledger cash-flow model, with dividend reinvestment shares added without double-counting the reinvested cash as fresh cost basis
- Unrealized P&L uses the latest locally available close price for regular securities
- The equity-curve hover tooltip reports `Equity`, `Market value`, and `Cash` from the same processed transaction snapshots that feed the transaction-history table
- The investment equity chart now resolves its equity stroke from the shared primary accent token, keeps `Market value` on the standard accent magenta, uses the theme positive accent for `Cash`, and reuses the compare-style vertical hover guide
- Money market funds are intentionally simplified through configuration:
  buy-to-sell valuation is anchored to the effective buy price, and the sell date uses the sell price
- This money market rule is opt-in through `config.toml` under `investment.money_market_funds`, so regular equities and ETFs such as `MSFT`, `TQQQ`, `BOXX`, and `JEPQ` continue to use the standard historical-close workflow unchanged
- Configured money market funds are treated as ledger-priced cash-like instruments rather than normal market-data tickers:
  they do not require local daily-history parquet files, they do not contribute `missing market history` warnings, and their display identity may come from the imported ledger instead of remote profile lookup
- IBKR internal FX conversion symbols such as `USD.HKD` are treated as non-market ledger artifacts rather than queryable securities:
  they affect cash flow in the transaction ledger, but they are excluded from holdings, historical-close valuation, local market-history fetching, and missing-valuation warnings

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
- Imported IBKR transaction ledgers may include internal FX conversion rows whose synthetic symbols, for example `USD.HKD`, are not valid market-data tickers in this app
- Those FX symbols are intentionally handled as cash-conversion bookkeeping only and must not be interpreted as securities that need `1d`, `1m`, or logo data

## Local Market Store behavior

- Daily history can be refreshed per ticker
- `1m` history can be refreshed per ticker
- Bulk maintenance refreshes cached daily datasets plus protected metadata assets
- Bulk maintenance does not fetch `1m` history for every ticker
- Deleting a ticker removes its locally cached market and metadata records

## Investment configuration notes

`config.toml` also contains investment-specific overrides for cases where local market data is intentionally simplified.

Current supported rule family:

- `investment.money_market_funds`
  Use this for cash-like funds whose holdings view should not depend on daily mark-to-market closes
  - `tickers`
    The ticker allowlist for the special rule
  - `name_from_description`
    When enabled, use a matching transaction description as the holdings display name if no local profile exists
  - `description_keywords`
    Extra guardrails for matching only the intended instrument descriptions

Related permanent investment-ledger rule:

- IBKR internal FX conversion symbols in `AAA.BBB` form, for example `USD.HKD`
  These are treated as non-queryable ledger-only artifacts by design
  They should never trigger market-history refreshes, logo lookup, holdings valuation, or `Valuation is incomplete...` warnings

For the current workspace, ticker `005276756` is configured this way so the holdings table shows its proper fund name and avoids misleading equity-curve drawdowns caused by incomplete money market pricing data.

## Timezone and `1m` integrity

- The application standardizes market timestamps to `America/New_York`
- Longbridge `1m` timestamps for US symbols are interpreted as `Asia/Hong_Kong` before conversion
- Stored parquet timestamps are saved as naive New York Time values for consistency across the app
- A developer verification route is available at `/test/chart/1m/<ticker>/<date_str>` (`date_str=last5` checks the latest 5 trading days)

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
