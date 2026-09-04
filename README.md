# Worthward

Documentation version: `v3.6.0`

`Worthward` is a local-first Flask web app for comparing supported-market stock tickers and historical market caps, building weighted portfolios, simulating dollar-cost averaging, running single- and multi-ticker strategy backtests, and inspecting locally imported investment records from a server-rendered workspace backed by on-disk caches. Optional Longbridge connectivity powers protected live-trading workflows, while IBKR remains file-import-only.

The product name is `Worthward`. `WORTHWARD_*` environment variables and
`WORTHWARD_*` browser namespaces are canonical. Legacy `ANTIGRAVITY_*` environment
variables, browser namespaces, and persisted transaction identifiers remain
read-compatible interfaces; the application writes only the Worthward names.

## What the app does

- Compare up to 5 tickers over the same window on a normalized return basis
- Use `Ticker comparison` to compare original price scales for up to 5 tickers or historical market-cap series for up to 10 tickers. Price mode can overlay an OHLCV-derived estimated cost distribution on the right side of each price canvas; hovering a price cross-section updates every profile to the cumulative estimate from the selected range start through the shared vertical guide. This remains a historical volume-profile estimate, not shareholder-level holding data. Market-cap series use same-date daily FX closes for non-USD listings while retaining USD and New York wall time; direct Yahoo shares-out recovery, SEC company facts, and filing-level XBRL preserve access to authoritative share history when a provider transport omits or rate-limits it. The unified Market cap canvas keeps absolute USD values and uses a logarithmic Y axis only when positive values span at least a 6:1 ratio; narrower peer groups stay linear, and nonpositive unknown-history placeholders render as gaps rather than false zero market caps.
- Build weighted portfolios with custom allocations
- Simulate dollar-cost averaging from the Backtest strategy selector with configurable contribution amounts, schedules, date ranges, dividends, and transaction details
- Run strategy-declared single-ticker and multi-ticker backtests across the dynamically discovered strategy library
- Retain each Backtest strategy's tuning values in browser-local memory and restore them when returning to that strategy; explicit URL parameters remain authoritative
- Use Grid Trading from the Backtest strategy selector, with trigger price bounds plus asymmetric rise and fall percentages declared by `strategy_grid_trading.py`
- Use Bayesian Price Field, whose default research ticker is `NVDA`, to run a daily walk-forward probability forecast from the shared causal Price Field pipeline and Longbridge CLI factors and, when a local intraday store exists, execute its causal daily signals on real `1m` bars
- Use LSTM Price Field through the same model-neutral factor, target, state, diagnostic, and probability-grid pipeline, with independent namespaced LSTM training hyperparameters and Apple Silicon backend detection that falls back to NumPy CPU when MPS, MLX, or Neural Engine are unavailable
- Start or stop exact-configuration LSTM training using the selected ticker, relative or exact range, 1d interval, and private controls. Durable runs perform at least 60 seconds of optimizer work; Auto uses confirmed MPS/CUDA, while an explicit CPU choice stays on CPU. Select a completed case to restore its actual data window and all saved settings; editing any control detaches it. History has single-open details, measured accuracy badges, stable date codes, and recoverable deletion. Compute-job state stays outside market and investment stores.
- Rotate between a primary ticker and its leveraged companion after a configurable primary-ticker drawdown, then return to the primary ticker at a new all-time closing high
- Switch between relative periods and exact date ranges
- Include or exclude cash dividends in comparison, portfolio, and backtest calculations
- Use `1d` data by default and run `1m` backtests only when the strategy declares that execution interval, local intraday data exists for every required ticker, and the complete ticker set shares at least one supported Period
- Choose the backtest execution mode between `signal_close` and `next_open`
- Import broker files, including the validated Zircon HK manual XLSX template, into a local investment ledger used by `Trade -> Investment`
- Protect browser investment writes with a same-origin check and a session-bound CSRF token
- Review imported holdings, equity history, Metrics, Stock details, and transaction history from `Trade -> Investment`
- Filter Transaction history by broker, currency, type, date, and unresolved internal-transfer status; HSBC USD, HKD, and CNH cash remains scoped by source account
- Read broker account data and submit protected Longbridge orders from `Trade -> Live trading`
- Manage theme, date format, broker access, Yahoo Mail SMTP, cash-equivalent instruments, local cache maintenance, strategy metadata, export-image profiles, and design tokens from `Settings`
- Use a conservative OpenAI Site tools (WebMCP) adapter for bounded capability discovery,
  current-page metadata, and allowlisted same-origin navigation without exposing financial records,
  broker authorization, settings writes, cache mutation, or live orders

## Runtime requirements

- Python `3.13` or `3.14`
- Dependencies from `requirements.txt`
- `pyarrow` for parquet persistence
- Node.js `22` for the JavaScript and browser quality gate
- Optional Longbridge credentials for broker-backed market-data fallback
- Yahoo Mail app password for SMTP alerts

The supported launch and test workflows use host Python `3.13` or `3.14`.
Direct `python3` commands must resolve to one of those supported versions.
The helper scripts prefer the pinned macOS `3.13` interpreter when it exists
and otherwise use the first supported interpreter available on the host.

## Quick start

Install dependencies into the pinned host interpreter:

```bash
./scripts/setup_python.sh
```

By default, the setup script uses:

```text
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
```

If your Python `3.13` or `3.14` executable lives elsewhere, override it explicitly:

```bash
WORTHWARD_PYTHON=/absolute/path/to/python3.14 ./scripts/setup_python.sh
```

Run the app from the project root with the pinned interpreter:

```bash
./scripts/run_app.sh
```

The launcher invokes Python `3.13` or `3.14`. Direct `python3 main.py` is
supported when `python3 --version` reports either version; otherwise the
entrypoint exits with an explicit version error.

On Windows PowerShell, install dependencies and launch with the Python
Launcher for Windows:

```powershell
py -3.14 -m pip install --upgrade -r requirements.txt
py -3.14 main.py
```

The default server bind is:

```text
0.0.0.0:8688
```

Open `http://127.0.0.1:8688` on the host computer or
`http://<host-lan-ip>:8688` from another device on the same trusted local
network. Host and port are configured in `config.toml`.

The Live trading workspace is separately protected by a 6-digit browser PIN.
The configured PIN can be overridden for one launch with
`WORTHWARD_LIVE_TRADING_PIN`. A successful unlock lasts for the current
browser session; the existing strong access-token header remains available for
non-browser API clients.

## Architecture at a glance

### Backtest research CLI

`scripts/strategy_tune.py` v1.0.0 discovers the same enabled strategy registry as
the dropdown (15 strategies on 4 Sep 2026). It supports genetic search and a
random-forest regression surrogate, reuses each strategy's production execution
engine, ranks two chronological validation windows, and evaluates the winner on
an untouched final holdout. Buy and hold has no tunable parameters and is evaluated
once as a baseline. Research results are not recommendations or promised returns.

```bash
python3 scripts/strategy_tune.py --catalog
python3 scripts/strategy_tune.py --strategy macd --ticker NVDA \
  --from 2025-09-04 --to 2026-09-04 --method genetic --trials 16 \
  --bounds '{"fast_span":[4,20],"slow_span":[24,50],"signal_span":[3,15]}' \
  --output /tmp/worthward-macd-research
```

Use a new output directory for every run. Change `--method` to `random-forest`
for surrogate search; repeat `--ticker` in the strategy's required order for
rotation strategies. `--params` fixes JSON values; `--bounds` explicitly chooses
the searched dimensions. The default 600-second budget stops scheduling new
evaluations, allowing an in-flight evaluation to finish. Local price stores are
read-only; strategies with a declared Longbridge source use that canonical
provider. Missing real data fails explicitly. See the architecture and operating
constraints for chronology, provenance, and interval requirements.

### Runtime structure

The runtime entry chain is:

```text
main.py
  -> app.create_app()
  -> app/web/routes_entry.py
  -> app/web/routes/{compare,portfolio,dca,backtest,trade,settings}.py
```

There is no Node.js build step, Docker setup, or alternate app runner in this repository. The supported local workflow is the pinned Python shell-script flow under `scripts/`.

## Workspace map

- `Return comparison`
  Compare the normalized percentage returns of up to 5 tickers, with optional cash dividend inclusion.
- `Ticker comparison`
  Use the Price metric to review up to 5 tickers on separate charts using their original market-price scales, or the Market cap metric to compare up to 10 historical series. Switching the metric keeps the current sidebar and chart context mounted while the target result hydrates, so the selected segmented pill completes its existing elastic motion without a document reload. A busy metric request can be cancelled by closing its progress dialog and choosing the latest metric intent; invalid ticker sets are rejected before the metric state changes, and a Price switch with more than 5 selected tickers stays in Market cap mode with an explicit validation prompt instead of silently discarding selections. Comparison workspace links also retain their per-view remembered query during the brief page-script loading gap, so a fast click cannot fall back to a blank default workspace. The Price-only `Show chips` control derives an estimated cost distribution from the selected historical OHLCV range, distributes each candle's volume across its low-to-high interval, and renders the result in a cached right-side Canvas profile that shares the price scale. Hovering the price plot truncates each ticker's OHLCV at the shared crosshair timestamp and redraws every profile as the cumulative estimate from the visible range start through that timestamp. Snapshot bins retain the full-range price domain to prevent vertical drift, are recalculated at most once per animation frame, and use a bounded per-subplot cache so repeated hover positions do not recompute. Leaving the chart restores the complete selected-range profile. The profile reports estimated POC, weighted average cost, profit ratio, and central 70% and 90% cost ranges. When a single ticker changes, same-period and same-date chip profiles for unchanged tickers are reused; the Longbridge request is limited to the new ticker plus one cached ticker to satisfy the API's minimum request size, and loading is scoped to the changed subplot. When a legacy local history file has no Volume column, the app requests range-bounded Longbridge daily OHLCV sequentially, retries the documented one-second rate limit, and uses `trade-stats` only as a final recent-price-level fallback. Market-cap history uses cached prices and point-in-time yfinance shares with SEC company-facts, filing-level XBRL, and Form N-PORT fallbacks. Non-US quote currencies use same-date daily Yahoo FX closes for USD conversion. Longbridge is optional and can cross-check or replace only the latest trading-day point. The canonical route is `/workspaces/prices`; `?metric=market-cap` selects Market cap, while `/workspaces/market-caps` remains a compatibility redirect.
- `Portfolio`
  Build weighted portfolios and inspect allocation plus aggregate return.
- `Backtest`
  Run any discovered strategy with configurable capital, interval, dividends, and strategy-owned parameters. Every strategy with private parameters exposes them through the shared `Tune strategy parameters` control, which starts pressed and its panel open immediately below Strategy. The complete desktop controls surface scrolls vertically as one logical sequence; narrow layouts grow in normal page flow. The default-on `Allow algorithmic stop-loss exits` switch permits a strategy sell or cover signal to close below its entry price and is not a separate fixed-price stop. This gate compares execution price with entry price only; dividends and total return do not change the decision. Select `Bayesian Price Field` or `LSTM Price Field` for the daily Longbridge CLI probability model; both default to the `NVDA` research ticker and share one probability-grid renderer. LSTM-only controls are namespaced and do not enter Bayesian cache keys. The round `Tune strategy parameters` control opens strategy-declared collapses for model parameters, shared market factors, and optional private actions. LSTM supplies a training action slot with one right-aligned Start/Stop button and a plain history heading; individual history rows have mutually exclusive details, not nested arrow collapses. Capital and return/exit/detail switches belong to the separate `Backtest parameters` collapse. All of these groups reuse the `Collapse` component in Style tokens; the strategy selector remains dedicated to strategy choices. The actions are CSRF-protected and the runner state is isolated from market and investment stores. Historical legacy renderer note (not the current contract): the old implementation added a price-anchored crosshair, a stable-width 36-column probability field, six rows per side, and the legacy radii and 4 px cell floor described in the archived release prose below. The current implementation is defined by the authoritative contract in the next paragraph.

  Historical legacy material note (not the current contract): the old probability field used a strategy-private 50%-transparent background, six rows per side, a fixed 36-column horizon, and the legacy opacity and geometry values preserved in the archived release prose below. The current renderer, including its transparent material, row bounds, integer-bar lattice, and responsive panning behavior, is defined by the authoritative contract above and in `docs/ARCHITECTURE.md`.
  The current Bayesian probability-grid contract supersedes the legacy six-row and private-material wording above: each hover side is independently bounded by `min(10, floor(50% of the current plot height in complete slots), floor(the relevant chart-boundary distance in complete slots))`. The half-plot cap prevents an edge-adjacent guide from consuming the whole hover field, while the boundary cap preserves strict clipping. The `Price Field` detail panel uses a separate complete-row geometry, so it renders the strategy-owned rows above and below the selected guide even when the floating hover field is edge-capped; its grid is then scaled to fit the detail viewport. The renderer derives the required plot height from the actual quantized horizontal cell size, then publishes that private requirement to the generic Backtest resizer callback. At the resizer minimum, the nearest forecastable curve point within 10% of the plot midpoint retains the intended 10 rows above and below; a truly constrained hover viewport may reduce rows through the same fit calculation, never by distorting squares, the 2 px logical gap, or integer-bar slots. The probability field remains clipped within the existing plot area and does not change the curve Canvas drawing range.

  When the Bayesian strategy presentation is available, the history surface adds a third `Price Field` option between `Metrics` and `Transactions`; selecting it preserves both existing views and opens a large Bayesian Price Field detail panel. It follows the same selected chart index and live Y scale as the hover field, but rebuilds the complete strategy-owned row lattice so edge-capped hover rows are not lost; the detail cells then scale to fit their own viewport. It retains the latest valid field after the pointer leaves the overview chart. Its horizontal axis uses the configured Settings date formatter for forecast horizons and limits labels to collision-safe edge-aware ticks; its vertical axis labels the live-Y-scale price range represented by the rendered cells. The detail panel keeps cells square, preserves the 2 px gap and row semantics, exposes a bar-gradient lower-to-higher-price legend, and exposes the selected origin through an accessible region and live status.

  The current Bayesian model targets the executable `Open[t+1] -> Open[t+2]` log return from information available at the close of `t`; the immediately preceding factor row is excluded until both required opens are observable. Multi-column probabilities evolve through a causal AR(1) return state fitted independently at every walk-forward origin, so the renderer no longer freezes one daily conditional mean across the complete horizon. The signal-close remains the display anchor for the absolute-price grid; trading probabilities and diagnostics are explicitly next-open-to-following-open. `Prior Strength` is a percentage of standardized sample information, and enabled factors enter only after positive expanding-window log-score evidence net of a complexity penalty. The UI and Markdown export report `Bayesian direction hit rate` and the bounded proper `Bayesian probability score` (`100% × (1 - mean Brier loss)`); Gaussian negative log predictive density and CRPS remain non-UI research diagnostics. Research factors still require a verified historical availability timestamp, and report-period-only fields are discarded to prevent point-in-time leakage.

  The Backtest-wide `Show trade details` switch defaults on for every strategy, including DCA. Turning it off hides the trade markers and equity comparison subplot, gives the price subplot the released space while retaining its time axis, and disables the `Transactions` history option in favor of `Metrics`; it is a display preference and never changes strategy computation or the result cache.

  The long Bayesian contract immediately below is retained as historical release prose. The current implementation version is v1.26.0; its accepted probability-grid geometry remains unchanged. Direction diagnostics exclude flat executable returns and neutral 50/50 forecasts; empty samples are reported as unavailable rather than 0%.

  Bayesian `Auto` execution coordinates independent causal walk-forward origins across the shared bounded CPU executor and an available Apple MPS or CUDA device; without an accelerator it uses the CPU executor. The same process layer serves independent kNN/Lorentzian predictions and Futu (HK) PDF parsing; it caps nested BLAS threads, preserves deterministic input order, and falls back to an ordered thread pool when process execution is unavailable. I/O probes and Longbridge fetches remain thread-parallel, while cash replay, stateful SuperTrend recurrences, and signal finite-state machines remain serial by design because their ordering is part of the causal contract. The presentation reports the effective executor and worker count; explicit GPU execution remains device-parallel and restarts cleanly on CPU after a runtime failure.

  Historical Bayesian Price Field compatibility contract (strategy v1.21.0; superseded by current strategy v1.22.0): the preceding release-history prose is retired. The renderer fixes 20 columns, not 36, and renders up to 10 rows independently above and below the price guide. Each square remains exactly mapped to an integer number of trading days and its live-Y-scale price interval; a 20-column field can therefore span more than 20 trading days when integer-day quantization is needed. The preferred width is one quarter of the price plot, while exact time and price mapping, the fixed column count, and the 4 px cell floor take precedence. Cells have no radius and the field is transparent, with 8 px top, bottom, and trailing padding. The production 2 px logical gap applies both between cells and from the vertical guide to the first column. The count on each side is `min(10, floor(50% of current plot height capacity), floor(relevant chart-boundary capacity))` in complete cell slots. `computeGridMinimumPlotHeight` reuses the actual horizontal lattice cell size to set a private Backtest stage minimum through the generic resizer callback. The shared vertical resizer invokes the Backtest overlay refresh only after Chart.js has resized, so a pinned or tracking field cannot retain a stale frame. That lower bound applies on desktop and narrow layouts, protects a real forecastable curve point within 10% of the plot midpoint at 10 rows above and below, and permits edge-only cropping or a true viewport-fit reduction without aspect-ratio, gap, or integer-bar drift. The transparent matrix has no frosted material, blur, border, shadow, or Settings Frosted Glass dependency. `Metrics` and `Transactions` remain unchanged; Bayesian adds a third `Price Field` option between them, and selecting it shows the detail panel rather than replacing either existing view. The detail legend is a horizontal bar gradient from `Lower price` magenta to `Higher price` green. Forecast-date labels keep the Settings formatter and are reduced when the available width would cause overlap. `Bayesian realized-cell score` and `Bayesian lattice coverage` are strictly post-hoc causal-model-lattice diagnostics over horizons 1 through 20. They are not a hit rate for the viewport-sized probability field and never enter signals, fitting, or cache keys. The left strategy panel exposes a private `Cell Display Threshold` parameter from 0% through 50%, defaulting to 5%; cells whose absolute probability is below that value are hidden in the presentation only, while grid geometry, signals, and scores remain unchanged. Historical P/E and options remain causal factors; the backward-compatible `Options` composite is supplemented by independent, opt-in historical `option volume daily` controls for call/put/total volume, call/put/total open interest, and put/call volume/open-interest ratios. These controls share one as-of-safe history request and never admit real-time-only option contract quotes into earlier dates. Dynamic P/E Ratio is a separate opt-in current `calc-index` snapshot bound only to its own market-local availability date and never backfilled into earlier dates. P/B, P/S, dividend yield, and market temperature are admitted only with an actual disclosure or safe historical observation timestamp. Capital flow, broker holding, shareholder concentration, fund-holder weight, short interest, and short volume remain exposed for research but are unavailable to the historical model until Longbridge supplies a verified point-in-time availability timestamp and, where needed, a causal aggregation definition. Quantitative-factor controls are registered once and sorted alphabetically, with model parameters after the factor list. A GPU runtime failure restarts the complete walk-forward calculation on clean NumPy CPU rather than mixing backend results; the presentation records the selected device, numeric precision, and fallback reason.

  The historical paragraph above retains its original v1.22.0 label for compatibility; its Auto scheduler wording is superseded by the v1.23.0 execution contract stated above.
  The rendered cell-size target is derived from the trailing three-month data density on the current chart. Other available ranges reuse that target when the integer trading-day lattice permits it; when exact matching is impossible, the renderer chooses the smallest complete slot that does not undershoot the three-month target. Chart boundaries remain authoritative for hover, while the detail panel's separate complete-row geometry is authoritative for its own contained grid; the 20-column density, 4 px floor, and existing strategy row limits remain shared.

  The current implementation version is strategy v1.26.0. Its `Auto` walk-forward scheduler coordinates the shared CPU executor with an available GPU as described above; when remote market access is explicitly disabled, the strategy reads the existing local daily store and marks Longbridge-only factors unavailable instead of failing the Backtest page. The v1.26.0 executable-target, dynamic multi-step, prior-scaling, factor-evidence, and scoring contract is stated above. Factor metadata now separates provider status, latest-origin eligibility, and actual latest-origin selection. The historical v1.21.0 release note remains only as a compatibility record.

- `Grid Trading`
  Select Grid Trading directly from Backtest. Its private parameter panel is generated from `strategies/algorithms/strategy_grid_trading.py` and opens through the shared tune control with Trigger price min, Trigger price max, Rise %, and Fall %; the legacy `/workspaces/grid-trading` URL redirects here with Grid Trading preselected.
- `Trade`
  Inspect the `Investment` and `Live trading` views. The former Timing and
  investment aliases redirect to `/trade/investment` for compatibility.
- `Settings`
  Review app metadata, appearance and date preferences, backtest execution mode, design tokens, service health, broker access, Yahoo Mail SMTP, Local Market Store maintenance, strategy metadata, and cache controls.

## Documentation conventions for handoff

- Language: American English
- Currency: USD
- Default full date format: `D Mmm yyyy` (for example, `2 Jul 2026`); additional full and compact formats are available in `Settings -> General`
- Timezone: America/New_York for handoff records and comparison chart axes
- Market-cap base currency and comparison timezone are application invariants: USD and America/New_York

## Settings navigation

The current `Settings` navigation includes:

- `About`
- `General`
- `Investment`
- `Backtest`
- `Broker access`
- `Cash equivalents`
- `Clear caches`
- `Email (SMTP)`
- `Export images`
- `Font tokens`
- `Color tokens`
- `Material tokens`
- `Style tokens`
- `Network self-check`
- `Local market store`
- `Strategies`

`Settings -> Color tokens` exposes the semantic palette in grouped Light and Dark
rows. Color edits are browser-local overrides stored in localStorage; Reset
controls restore the configured defaults. Positive accent, success, and strong
success intentionally keep distinct Light and Dark green values.

## Data sources and local storage

### Canonical ticker notation

The project has one canonical ticker format for visible labels, URLs, cache
keys, profiles, and market-history filenames. Normalize symbols at every input
boundary before they reach those surfaces.

| Market | Canonical format | Example | Boundary rule |
| --- | --- | --- | --- |
| United States | Bare symbol | `META` | Accept `META.US` only as an input compatibility alias. Normalize it to `META` before display or persistence. Longbridge receives `META.US` only in its outbound adapter call. |
| Hong Kong | `.HK` suffix | `700.HK` | Retain the suffix to distinguish the market. Normalize leading-zero code variants to one canonical code. |
| Shanghai | `.SH` suffix | `600519.SH` | Retain the suffix. The Yahoo adapter converts it to Yahoo's `.SS` request form only while making that remote call. |
| Shenzhen | `.SZ` suffix | `000001.SZ` | Retain the suffix to distinguish the market. |

Longbridge's `.US` notation and Yahoo's `.SS` notation are provider transport
formats, not project ticker formats. Legacy aliases and raw import provenance
may retain their original spelling for compatibility or auditability, but they
must never become the canonical ticker shown to users or written as a new
market-store key.

### Daily history

- Stored in `market_store/historical/` as parquet
- Used by comparison views, portfolio views, investment valuation, and default backtests
- Downloaded through `yfinance` first
- Retries the same authoritative Yahoo Chart endpoint through the standard-library network stack when the `yfinance` transport fails, including on Windows
- Falls back to Longbridge only when both Yahoo transports fail, valid Longbridge credentials are configured, and the ticker's market is covered by Longbridge. A `yfinance` rate limit still permits the direct Yahoo Chart retry.

### 1-minute history

- Stored in `market_store/historical/` as parquet
- Preferred source is `yfinance`, using bounded recent-data windows supported by the free service
- When `yfinance` returns no usable bars without an explicit rate-limit signal, the same bounded request falls back to Yahoo Chart directly before the optional Longbridge provider
- An explicit Yahoo rate-limit signal stops further Yahoo transport retries; an optional Longbridge provider may still supply the requested bars
- Falls back to Longbridge only after both `yfinance` windows fail and valid Longbridge credentials are configured
- Persisted data is trimmed to the latest 6 months of trading days
- Used when local `1m` data exists for the selected ticker

Longbridge is optional for every market-data view. Daily history, intraday charts,
and extended-hours comparisons use `yfinance` by default. When configured,
Investment realtime quotes use Longbridge first for US overnight, pre-market,
regular, and post-market sessions. Overnight values require Longbridge because
Yahoo does not expose that session. During the overnight window, a machine
without a usable Longbridge quote keeps the latest `yfinance` post-market close
for Holdings valuation without labeling or animating it as a live overnight
quote. Other unresolved supported-session quotes also fall back to batched
`yfinance` requests, which make at most one rotating individual recovery request
per poll. Investment polling and its server-side
complete-batch cache use a 60-second interval. An
explicit Yahoo rate limit pauses all yfinance requests for 5 minutes, then uses
bounded exponential backoff up to 30 minutes for repeated limits. Each returned
quote identifies its provider, and a mixed response preserves that per-quote
provenance.

### Yahoo Finance proxy and TLS configuration

The Yahoo transport uses one shared curl_cffi session for daily, intraday,
extended-hours, realtime, search, and profile yfinance requests. Yahoo Chart
fallbacks, remote logo downloads, and Network self-check probes reuse a separate
scoped urllib opener with the same verified trust bundle. Neither transport
injects a proxy; both read the standard `HTTP_PROXY`, `HTTPS_PROXY`, and
`NO_PROXY` environment variables.

For a corporate HTTPS interception proxy, export the corporate CA PEM path
before starting the app:

```bash
export HTTP_PROXY="http://proxy.example:8080"
export HTTPS_PROXY="http://proxy.example:8080"
export WORTHWARD_YAHOO_CA_PEM="/absolute/path/to/corporate-ca.pem"
./scripts/run_app.sh
```

The CA path can instead be stored in the existing versioned configuration:

```toml
[network]
yahoo_ca_pem = "/absolute/path/to/corporate-ca.pem"
```

`WORTHWARD_YAHOO_CA_PEM` takes precedence over
`[network].yahoo_ca_pem`. When both settings are empty on macOS, the app
automatically exports the System Roots and System keychains as a third-precedence
fallback. The selected corporate or system CA bundle is appended to certifi's
public CA bundle, so both intercepted Yahoo certificates and normal public
certificate chains remain verified. The same scoped trust bundle is used only
for Yahoo, remote logo providers, and Network self-check probes; broker, SMTP,
and other transports are not changed. Restart the app after changing either CA
setting because the verified clients are created during runtime bootstrap. A
corporate CA installed only in a macOS user keychain must be exported to a PEM
file and configured explicitly.

On a non-macOS computer that connects directly, leave both CA settings empty and
do not set proxy environment variables. The session then uses `verify=True`
with the secure curl_cffi default. Never work around `CertificateVerifyError`
or curl error `60` with `verify=False`; configure the corporate CA PEM instead.
The focused offline regression command is documented in
[the testing guide](docs/TESTING.md).

After pulling a dependency update on Windows, refresh the active Python `3.14`
environment before launching the app:

```powershell
py -3.14 -m pip install --upgrade -r requirements.txt
```

### Metadata and search caches

- `market_store/profiles/profiles.parquet` stores cached company profiles
- `market_store/logos/` stores cached ticker logos
- `settings_store/search/search_cache.parquet` stores search-result caches
- `settings_store/search/ticker_usage.json` stores ticker usage frequency
- `settings_store/search/strategy_usage.json` stores strategy usage frequency

Investment ticker identities prefer a valid provider name, then an exact local
search-cache name, then a vetted standard-name fallback. A symbol-only provider
response, including a bare-US alias mismatch such as `META.US` for `META`, is
never treated as a company name or allowed to replace an existing non-placeholder
profile name.

### Runtime-only local settings

`settings_store/` is created locally at runtime and is ignored by Git. It is used for device-local data such as:

- `settings_store/settings.json`
- `settings_store/investment.parquet`
- `settings_store/investment_cache/`
- `settings_store/search/`

## Investment ledger notes

- Investment transactions are read from `settings_store/investment.parquet`
- The investment API may cache derived transaction, profile, and local price-history payloads under `settings_store/investment_cache/`; these device-local files are ignored by Git, are never required for startup, and are rebuilt from `investment.parquet` plus local market history files
- The `Trade -> Investment` workspace renders holdings, equity history, metrics, and transaction history from that ledger
- `Settings -> Investment` controls the shared buy-lot matching method used by Holdings, Stock details, and local realized P&L. The default is `Lowest-cost lots first`, which attributes a sale to the cheapest open lots first; FIFO, LIFO, and moving-average alternatives remain available.
- Holdings remaining shares, cost basis, and unrealized P&L are aggregated only after each broker/account/ticker/currency scope has replayed its own transactions, so one account's sale cannot consume another account's lots.
- A stock `grant`, including an IBKR stock grant, adds a zero-cost lot. Its
  imported per-share value remains immutable source evidence, not paid cost
  basis; any separately imported purchase continues to contribute its own net
  acquisition cost to the aggregate average price.
- If one canonical ticker has open lots in multiple currencies, Holdings preserves shares but leaves combined cost basis, market value, average price, and local unrealized P&L unavailable rather than adding incompatible raw currency units; an authoritative broker performance snapshot still supplies realized P&L. Unknown carried basis on an in-kind `transfer_in` remains explicitly disclosed as a reconstruction limitation.
- Broker-reported closed-trade P&L remains authoritative when present. Stock details displays the selected buy/sell matcher beside Average price; security-transfer basis reconstruction remains a separate FIFO-reconstructed detail and does not inherit or replace that preference.
- The Overview and Transaction history surfaces share a responsive horizontal separator that appears on hover or focus and supports pointer, touch, and keyboard resizing
- Holdings reuse locally cached ticker profiles and logos when available
- Configured money market funds can use the transaction `description` field as a display-name fallback when no local profile exists
- IBKR internal FX conversion symbols such as `USD.HKD` are treated as ledger-only cash-conversion artifacts rather than queryable securities
- Confirmed internal-transfer bindings are persisted in `investment.parquet` with
  cross-import `v2` leg identities. Broker re-imports preserve cash-transfer
  identities across source-file, row-number, description, IBKR account-mask,
  and USD blank-field presentation changes. In-kind security-transfer identities
  additionally require broker, account, date, direction, ticker, and quantity.
- IBKR Realized Summary `Transfers` rows record FOP security transfers as
  non-cash `transfer_out` or `transfer_in` ledger events. Charles Schwab imports
  require the paired Transactions and Positions CSV exports; the Positions file
  provides the authoritative broker snapshot. Same-ticker lots are aggregated,
  and the reported `Positions Total` must reconcile to securities plus cash or
  the import fails closed. A same-day, cross-broker in-kind transfer is never
  linked merely from matching date, broker, ticker, quantity, or currency. The
  user must explicitly select an imported source broker and account. One unique,
  exact source `transfer_out` then becomes evidence-backed; without that source
  leg, a confirmed source account can create only a net-neutral aggregate overlay
  after its prior inventory is verified. Until every Schwab receipt is confirmed,
  All brokers Holdings, Equity, P&L, and stock details fail closed. Neither path
  creates a source-broker transfer-out or assumes a carried cost basis.

`config.toml` contains an `investment.money_market_funds` rule family for cash-like instruments whose valuation should not depend on normal daily mark-to-market history.

## HSBC import convention

This section documents the privacy-safe import contract rather than a personal
account snapshot. Historical equity uses settled bank cash plus exact signed
pending-settlement receivables or payables. Each matched posting enters pending
cash on its booking date and clears on its own settlement date; unmatched orders
remain explicitly provisional.

- HSBC clipboard pages are validated as one composite snapshot when the source
  requires multiple pages. Duplicate chunks are deduplicated and conflicting
  boundaries fail closed before the local store changes.
- Current HSBC cash uses the posted USD Savings Ledger balance as its USD
  boundary. The bank's Available balance remains separate audit evidence;
  visible pending settlements are applied exactly once, and retained foreign
  cash is converted with the dated project FX history. This estimated current
  amount is marked as provisional in the browser.
- Historical HSBC settlement corrections use the broker ledger before any
  current-cash presentation projection, so a later mixed-broker refresh cannot
  cancel sale proceeds that were already settled on an earlier date.
- Cash-only non-USD captures remain separate by source account kind and
  currency; they cannot replace an unrelated portfolio snapshot.
- Account validation is opt-in through local environment variables. No account
  number, balance, position quantity, or order reference is documented here.

### HSBC statement import

- Statement mode accepts one or more HSBC full monthly PDFs. It also retains the legacy unordered composite-plus-Investment-services pair path for older statement formats.
- Full monthly cash histories may contain HKD Savings or Current, USD Savings, and Foreign Currency Savings or offshore-RMB pages. Cash rows are stored as USD, HKD, or CNH; the latest per-currency balance map is retained, and the base-currency scalar is calculated from the statement's quoted rates.
- A bank statement's `CNY` label means offshore RMB in this account. It is normalized to `CNH`; `CNY` remains available only as raw source provenance and is never emitted as the HSBC ledger currency.
- The legacy paired path keeps the investment statement authoritative for settled trades, closing holdings, transaction charges, and ticker-linked income such as cash dividends. Its HSBC One composite statement remains authoritative for the reconciled USD cash postings and closing cash.
- Every trade, charge, and dividend in the legacy paired path must reconcile to a same-date and same-amount USD cash posting. The statement import fails closed when reconciliation is incomplete.
- Historical statement snapshots do not replace a newer copy/paste Portfolio or posted-ledger cash snapshot. Matching order references and corporate actions upgrade existing rows idempotently.
- When a historical HSBC statement overlaps an existing cash-account import, the same-account event is deduplicated by date, type, currency, signed amount, and occurrence count. Existing USD cash rows remain the current snapshot, while statement-only HKD and CNH rows are added to the ledger.
- The read-only validator can independently audit the four official account CSVs with `python3 scripts/validate_hsbc_statement_import.py /path/to/statements --official-csv-dir /path/to/official-csvs`. It checks each CSV's descending-date balance continuity, compares per-account date-and-amount multisets across the PDF/CSV overlap, and verifies the imported cutoff balance. The CSVs are never imported into `investment.parquet`.

### BOCHK statement import

- BOCHK mode accepts one or more `Consolidated Statement` PDFs in a single batch. Later batches are merged incrementally, and re-uploading the same PDF is idempotent.
- The customer number is retained as the parent account, while each full deposit-account number, short subaccount number, account type, source currency, and statement balance remain attached to the imported rows. A short subaccount that contains multiple currency sections keeps them separate, and one HKD subaccount is never collapsed into another account at parse time.
- BOCHK statement currencies remain source currencies: `HKD`, `CNY`, and `USD` are not converted or relabeled. No securities positions or trades are created.
- The securities cash-balance section is accepted only when it contains no non-zero activity. A non-zero securities cash row fails closed so the statement cannot silently discard securities activity.
- Flow amounts are classified with stable printed-column boundaries and each subaccount's running balance. Right-aligned withdrawals are retained, while ambiguous rows, balance discontinuities, and page headers outside the transaction-detail region fail closed.
- The browser UI exposes only the BOCHK Consolidated Statement PDF importer. For compatibility, the API still accepts `broker=boc_hk` with `zircon_hk_transactions_xlsx` through the tested legacy standard-workbook fallback; do not remove that backend path without an explicit migration.

## IBKR import convention (handover reference)

IBKR is separate from HSBC behavior. Under the current repository convention, entries are booked directly from IBKR transaction flow and no HSBC-style unsettled replay is applied. For handoff and sanity checks:

- Import source rule:
  - Use official IBKR CSV exports or GainsKeeper files as the source of truth.
  - Use pasted Trade Notifications as supplemental transaction evidence after
    the available file-snapshot cutoff, especially while the prior-day files are
    stale or not yet available. Unique filled trades are added to the ledger;
    the paste is not treated as a replacement holdings or cash snapshot.
    Displayed Beijing times are converted to New York ledger times.
  - A later matching CSV or GainsKeeper row replaces the web row's rounded fee,
    net amount, and timestamp precision without creating a duplicate trade.
  - If the IBKR app supplies a user-verified post-fill cash value with the
    paste, it is anchored to the latest captured fill. An older CSV or
    GainsKeeper cash snapshot cannot roll that boundary back.
  - A broker realized-P&L snapshot is likewise treated as valid only through
    its dated file boundary. Later evidenced fills are replayed from the
    complete transaction-history inventory in broker-consistent FIFO order;
    they are not discarded merely because the older snapshot already reports
    a ticker total. If the history cannot establish an exact FIFO inventory,
    the supplemental P&L fails closed instead of silently using a stale
    aggregate average cost.
  - Do not apply HSBC pending logic to IBKR data.
- Booking and reconciliation:
  - Record each row using imported fields for gross amount, commission, taxes, and cash movement.
  - Treat ledger cash changes as ledger data from transaction rows, with no HSBC-style "transferable cash" manual offset.
- Failure modes:
  - With consistent IBKR imports, positions and equity should progress on a stable accounting basis without abrupt cross-row resets to zero.
  - If equity suddenly drops abnormally, first check for overlapping CSV or GainsKeeper imports and duplicate date ranges.

## Broker and email support

### Longbridge

- Used for broker-backed market data
- Optional fallback source for `1m` and `1d` history when `yfinance` fails
- Broker Access launches the installed Longbridge CLI's browser OAuth flow; the CLI keeps its OAuth session in the signed-in user's CLI profile, and the app never receives or stores an authorization code or OAuth token
- An existing terminal `longbridge auth login` session is detected automatically
- The browser Live trading page requires the configured 6-digit PIN and creates a
  signed browser session. Live account balances, positions, and order-submission
  APIs authorize a request through either that signed PIN session or a correctly
  presented configured server access token of at least 32 characters:
  ```bash
  export WORTHWARD_LIVE_TRADING_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  ./scripts/run_app.sh
  ```
- Non-browser API clients present the token through the
  `X-Worthward-Live-Trading-Token` header. The browser unlock uses the PIN
  session and does not expose or persist the server token.

### IBKR

- IBKR has no direct connection or credential configuration in this app. It cannot place orders, request live data, or start a brokerage session.
- IBKR Flex Web Service, Client Portal, and Gateway integrations are deliberately retired, not deferred fallbacks. Do not reintroduce a direct IBKR transport without an explicit user-approved architecture and security review.
- Import only user-supplied offline evidence; the app never connects to IBKR:
  - **CSV**: Transaction History plus Realized Summary exports for historical backfills.
  - **GainsKeeper**: OFX/GKX files for precision upgrades and overlapping historical coverage.
  - **Web paste**: copied Trade Notifications page text for immediate provisional
    filled trades. It is not a browser session, API, or direct broker transport.
- Each newly imported file or pasted evidence capture is retained locally as an immutable source-evidence artifact keyed by its SHA-256 digest. For the default ledger, artifacts live under `settings_store/investment_evidence/`; for every ledger, the evidence directory is derived from its Parquet path as `<parquet-stem>_evidence`. The ledger stores the matching manifest, statement metadata, and source role; a re-import of identical bytes reuses the same artifact instead of duplicating it. A single source file is capped at 64 MiB and the evidence directory at 256 MiB. On POSIX systems, evidence directories are owner-only (`0700`) and artifacts, including staging files, are owner-only (`0600`).
- Application startup and read-only Investment browsing require only `investment.parquet`. Source-evidence verification remains mandatory at the investment-import commit boundary, so a device without the matching evidence sidecar can inspect the portable ledger but cannot silently extend it with unauditable imports.
- Existing ledger records remain readable after a Parquet-only transfer and
  remain mergeable when their matching evidence sidecar is present. Legacy
  imports that predate source-evidence persistence remain explicitly without a
  reconstructed raw artifact; the application never fabricates one.

### Cross-platform evidence recovery

`settings_store/` is intentionally ignored by Git. Therefore, a Git pull never
transfers the investment ledger or its device-local derived cache. To start the
app and browse the ledger on another macOS or Windows device, transfer only
`investment.parquet` through a binary-safe copy method. Do not transfer
`investment_cache/`; it contains disposable machine-local fingerprints and is
rebuilt automatically. A stale, malformed, or unwritable cache is treated as a
cache miss and never blocks ledger startup.

The sibling `investment_evidence/` directory is optional for startup and
read-only browsing, but remains necessary to verify old source files and to
commit later imports against the complete audit trail. Copy it separately when
those operations are required. Do not regenerate an evidence `.bin` file from a
CSV or text editor, and do not permit line-ending conversion: the SHA-256 value
represents the exact original upload.

On Windows PowerShell, inspect the local ledger and any evidence sidecar before
performing another broker import:

```powershell
py -3.14 scripts/verify_investment_evidence.py
```

For a non-default ledger location, pass its Parquet path explicitly:

```powershell
py -3.14 scripts/verify_investment_evidence.py --store D:\worthward\settings_store\investment.parquet
```

If verification reports a missing or changed artifact, read-only startup remains
available, but do not perform another broker import until the exact matching
evidence has been restored from the Mac that created that ledger. After copying
that directory, or the original broker export files, into a temporary Windows
folder, safely materialize only exact manifest matches:

```powershell
py -3.14 scripts/verify_investment_evidence.py --restore-from D:\worthward-evidence-recovery
```

The recovery mode does not rewrite the ledger and does not overwrite an existing
artifact. It writes a missing artifact only when both its SHA-256 digest and byte
count match the ledger manifest, then runs the complete verification again.

### Investment import adapters

The Investment workspace currently exposes import adapters for HSBC, Bank of China
(Hong Kong), IBKR,
Futu (HK), Longbridge (HK), Longbridge (SG), Charles Schwab, Tiger Trade,
uSMART (HK), CMB Wing Lung Bank, and Zircon HK. The Zircon HK flow downloads a
plain generic fallback XLSX template whose Broker dropdown covers every cataloged
broker. It provides transaction-type, currency, date/date-time, and numeric
validation; the browser prevalidates the completed workbook without writing the
ledger, then enables the ordinary incremental import only for that exact file.
Date-only entries default to 23:00 Hong Kong time. Trade cash is derived from
Quantity, Trade Price, and Commission; the Amount column is reserved for
non-trade cash activity.
Reusing a non-empty Reference ID within the same account lets a later corrected
workbook replace that manual entry instead of duplicating it.
Currency conversions use exactly two Forex trade component rows at the same
date and time with one shared Reference ID: the sold-currency Amount is
negative, while the acquired-currency Amount is positive. The shared ID is
scoped by currency during reconciliation so both legs remain distinct and a
later corrected pair replaces both original legs safely.
Each adapter preserves its source-specific reconciliation rules; imports are
local and incremental.

### Yahoo Mail SMTP

- Uses `smtp.mail.yahoo.com:587` with `STARTTLS`
- Uses a Yahoo Mail app password stored locally for authentication

## Strategy system

- Strategy implementations live under `strategies/algorithms/`
- Runtime strategy discovery is dynamic and is handled by `strategies/loader.py`
- Runtime strategy metadata is derived directly from strategy classes and no longer relies on `strategies/registry.json`
- Strategy classes can declare ordered ticker defaults and a required ticker count through `StrategySupportMatrix`
- Strategy classes can optionally declare supported intervals, provide their own read-only market datasets, disable result caching for live-factor models, and return a validated declarative browser-presentation payload
- Backtest execution logic, including aligned multi-ticker histories and rotation execution, lives in `strategies/backtest.py`

## Project layout

```text
AGENTS.md                       -> Root compatibility pointer to docs/AGENTS.md
main.py                         -> Flask runtime entry point
config.toml                     -> App metadata, defaults, server bind, labels, and integration settings
README.md                       -> Project documentation
docs/README.md                  -> Documentation authority, ownership, and cleanup map
docs/AGENTS.md                  -> Agent workflow, safety, and quality boundaries
docs/ARCHITECTURE.md            -> Runtime layers, routes, data ownership, and invariants
docs/TESTING.md                 -> Test commands, factories, coverage, and E2E isolation
docs/AGENT_OPTIMIZATION.md      -> OpenAI Site tools adapter, privacy boundary, and verification
docs/STATIC_FILE_HOUSEKEEPING.md -> Project entrypoint for shared numbered-copy housekeeping
docs/KNOWN_ISSUES.md            -> Current debt and classified historical failures
docs/COMPATIBILITY.md           -> Canonical routes, aliases, retired renderers, and reserved source
docs/HANDOFF_TEMPLATE.md        -> Required agent handoff evidence structure
docs/INVESTMENT_FRONTEND_CHANGELOG.md -> Historical Investment frontend changes
requirements.txt                -> Python runtime, test, coverage, and static-check dependency pins
scripts/setup_python.sh         -> Supported host-Python dependency installer
scripts/run_app.sh              -> Supported host-Python app launcher
scripts/test.sh                 -> Supported host-Python pytest wrapper
scripts/test_js.sh              -> Node unit tests and gradual JavaScript coverage thresholds
scripts/check.sh                -> Complete local and CI quality gate
.github/workflows/quality.yml   -> Push and pull-request quality-gate workflow
app/core/                       -> Shared config, settings helpers, and market-calendar primitives
app/infrastructure/             -> Storage, connectivity, and broker market-data integration
app/services/                   -> Business logic for comparisons, market data, investment import, and presentation
app/web/routes/                 -> Flask route registration by workspace
app/web/runtime.py              -> Web runtime assembly and request handling
app/web/templates/              -> Server-rendered HTML templates
app/web/static/                 -> CSS, JavaScript, and image assets
strategies/                     -> Strategy framework, loader, backtest engine, and algorithms
market_store/                   -> Local market history, profile, and logo caches
settings_store/                 -> Runtime-generated local settings, investment ledger, and search caches
outputs/                        -> Ignored, potentially sensitive local review output; never canonical docs
tmp/                            -> Ignored disposable task scratch; clean only when no active owner remains
```

## Agent documentation

Agents should begin with the documentation map, which defines authority,
ownership, cleanup classes, and the required reading path:

- [Root agent compatibility pointer](AGENTS.md)
- [Documentation map and repository ownership](docs/README.md)
- [Canonical agent operating guide](docs/AGENTS.md)
- [Architecture guide](docs/ARCHITECTURE.md)
- [Testing guide](docs/TESTING.md)
- [OpenAI Site tools and Agent Optimization](docs/AGENT_OPTIMIZATION.md)
- [Static-file numbered-copy housekeeping](docs/STATIC_FILE_HOUSEKEEPING.md)
- [Known issues and operating constraints](docs/KNOWN_ISSUES.md)
- [Compatibility routes and reserved source](docs/COMPATIBILITY.md)
- [Shared UI workflow](docs/SHARED_UI_WORKFLOW.md) (required only for shared UI work)
- [Agent handoff template](docs/HANDOFF_TEMPLATE.md)
- [Investment frontend changelog](docs/INVESTMENT_FRONTEND_CHANGELOG.md) (historical reference only)

## Versioning note

The version displayed in the web UI comes from `config.toml` under
`[app].version`. Change that release metadata only as part of an explicit
application release. The documentation version markers in this README and
`docs/*.md` track document revisions independently and are not expected to
match the application version. File-level `Code version:` comments are source
revision markers, not the app metadata shown in the interface.

## Running tests

Run Python tests through the pinned host interpreter:

```bash
./scripts/test.sh
```

You can also pass normal `pytest` arguments through the wrapper:

```bash
./scripts/test.sh -q
```

Run the complete Python, JavaScript, coverage, static, and browser quality gate:

```bash
./scripts/check.sh
```

The same command runs in GitHub Actions for pushes and pull requests. Node unit
tests enforce gradual first-party JavaScript coverage floors; current baselines
and safe threshold overrides are documented in [the testing guide](docs/TESTING.md).

The committed test suite, coverage baseline, shared factories, and E2E isolation rules are documented in [the testing guide](docs/TESTING.md).
