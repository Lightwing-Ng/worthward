# compareStocks

A local-first web app for comparing stock tickers and running single-ticker strategy backtests with full static rendering.

Source code: <https://github.com/Lightwing-Ng/compareStocks>

## What it does

- compares up to five securities on a normalized cumulative return basis
- runs single-ticker backtests with built-in trading strategies (Buy and Hold, MACD, SuperTrend AI)
- supports relative time ranges (1mo → max) and exact date ranges
- can include or exclude cash dividends in total return calculations
- stores historical data, ticker profiles, logos, and symbol search results locally
- renders a lightweight responsive UI with mobile-first behavior
- works entirely in-browser after server render, no external dependencies for viewing

## Run

Use the interpreter that already has the project dependencies installed:

```bash
/usr/local/bin/python3.13 main.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Project layout

```text
main.py
config.toml
README.md
app/
strategies/
market_store/
```

### `app/`

Application package.

- `web.py`
  - HTTP routes and page rendering
- `market_data.py`
  - price history retrieval and normalization
- `comparisons.py`
  - shared-window return comparison logic
- `date_constraints.py`
  - exact-range trading-day alignment
- `logos.py`
  - ticker profiles and logo retrieval
- `presentation.py`
  - human-readable labels and presentation helpers
- `schemas.py`
  - dataclass schemas
- `storage.py`
  - persistence paths under `market_store/`
- `settings.py`
  - config loading from `config.toml`
- `config.py`
  - static application constants
- `web/static/`
  - front-end CSS, JS, images, and HTML templates

### `strategies/`

Trading strategy registry and backtest implementation.

- `base.py`
  - base strategy interface and parameter schema
- `loader.py`
  - dynamic strategy loading
- `registry.json`
  - strategy registry metadata
- `algorithms/`
  - concrete strategy implementations (Buy and Hold, MACD, SuperTrend AI)

### `market_store/`

Persistent local store.

- `historical/`
  - canonical ticker parquet files
- `profiles/`
  - per-ticker profile JSON files
- `logos/`
  - cached logo images
- `search/`
  - cached symbol search results

## Ticker input rules

Ticker inputs are validated in both places:

- front end
  - blocks illegal characters and invalid formats before submit
- back end
  - rejects malformed or unsupported tickers before data fetch

Supported examples include:

- `MSFT`
- `GOOGL`
- `NVDA`
- `AMZN`
- `MU`
- `AMD`
- `META`
- `QQQ`
- `JEPQ`

## Notes

- symbol search depends partly on Yahoo Finance coverage and may vary by ticker class
- logo retrieval uses provider fallbacks and local persistence
- the app is designed for local development, not production deployment
