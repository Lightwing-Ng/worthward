# compareStocks

A local-first web app for comparing stock tickers and running single-ticker strategy backtests with full server-side static rendering.

Source code: <https://github.com/Lightwing-Ng/compareStocks>

## What it does

- Compare up to five securities on a normalized cumulative return basis
- Build weighted equity comparison portfolios with custom percentages
- Run single-ticker backtests with a growing library of open-source trading strategies
- Supports both relative time ranges (1d → 10y → max) and exact custom date ranges
- Optionally include cash dividends in total return calculations
- Stores all historical data, ticker profiles, logos, and symbol search results locally on your device
- Renders a lightweight, responsive UI with a mobile-first layout
- Works entirely client-side in-browser after initial server render—no external JavaScript dependencies for viewing
- Includes 1-minute intraday historical data support when connected to your broker
- Full glassmorphism/frosted-glass UI styling that adapts to light/dark system appearance

## Run

Use the Python interpreter that already has project dependencies installed (requires Python 3.11+):

```bash
/usr/local/bin/python3.13 main.py
```

Then open this URL in your browser:

```text
http://127.0.0.1:5000
```

## Project layout

```text
main.py                  → Flask application entry point
config.toml              → Local configuration (endpoints, credentials, defaults)
README.md               → This file
app/                    → Main Python application package
strategies/              → Trading strategy framework and implementations
market_store/            → Persistent local storage for cached data
```

### `app/`

Core application package:

- `web.py`
  - HTTP route handlers and full HTML page rendering
- `market_data.py`
  - Price history retrieval, caching, and normalization
- `comparisons.py`
  - Shared-window cumulative return comparison logic
- `date_constraints.py`
  - Exact-date-range valid trading day alignment
- `logos.py`
  - Ticker company profile fetching and logo caching
- `presentation.py`
  - Human-readable date formatting and presentation helpers
- `schemas.py`
  - Typed dataclass schemas for API payloads and strategy outputs
- `storage.py`
  - Path resolution and persistence helpers for `market_store/`
- `settings.py`
  - Configuration loading from `config.toml`
- `config.py`
  - Static application constants and default values
- `web/templates/`
  - Jinja2 HTML templates
- `web/static/assets/`
  - Front-end CSS, JavaScript, SVG icons, and static images

### `strategies/`

Trading strategy registry, base interface, and concrete implementations:

- `base.py`
  - Base strategy abstract interface, parameter definition schema
- `loader.py`
  - Dynamic strategy discovery and loading
- `registry.json`
  - Strategy registry metadata for UI rendering
- `algorithms/`
  - Concrete strategy implementations (Buy and Hold, MACD Crossover, SuperTrend, Lorentzian Classification, etc.)

### `market_store/`

Persistent local cache storage (created automatically on first run):

- `historical/`
  - Per-ticker normalized OHLCV parquet files (daily + 1-minute)
- `profiles/`
  - Per-ticker company profile JSON cache
- `logos/`
  - Cached ticker logo images
- `search/`
  - Cached symbol search result JSONs

## Ticker input rules

Ticker symbols are validated on both the front-end and back-end:

- Front-end: Blocks invalid characters and malformed formats before form submission
- Back-end: Rejects malformed or unsupported tickers before attempting data fetch

Common examples of supported tickers:

- `MSFT`
- `GOOGL`
- `NVDA`
- `AMZN`
- `MU`
- `AMD`
- `META`
- `QQQ`
- `JEPQ`
- `TQQQ`

## Notes

- Symbol search quality depends partly on Yahoo Finance coverage and may vary across ticker classes
- Logo retrieval uses multiple fallbacks and persists results locally after first fetch
- This project is designed for local personal use, not public production deployment
- All sensitive broker credentials are kept locally on your machine and never transmitted elsewhere

## Timezone & Data Integrity (critical for 1-minute data)

- **System-wide Standard**: The application internally normalizes all market data timestamps to **New York Time (America/New_York)** using standard IANA timezone identifiers, with robust Daylight Saving Time handling.
- **Broker Data (Longbridge)**: The Longbridge OpenAPI returns 1-minute timestamp values numerically aligned with **Hong Kong Time (HKT)** for US market data.
  - The fetcher (`app/broker_market_data.py`) correctly parses these raw values as `Asia/Hong_Kong` before converting to `America/New_York`.
  - **Persistent Storage (Parquet)**: 1-minute parquet files in `market_store/historical/` store timestamps as naive datetimes strictly in **NYT** for cross-layer consistency.
- **Visual Verification Tool**: A dedicated test route is available at `/test/chart/1m/<ticker>/<date>` (or `/test/chart/1m/last5`) to visually compare 1-minute candle shapes against your broker's trading terminal for end-to-end accuracy.
