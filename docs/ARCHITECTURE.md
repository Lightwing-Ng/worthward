# Architecture guide

Documentation version: `v1.27.0`

## Holdings P&L display contract

The fixed Holdings summary keeps the cumulative account result separate from
the daily P&L badges shown on other Holdings surfaces:

- `Cumulative P&L` is cumulative realized P&L plus current cumulative
  unrealized P&L.
- Daily realized and unrealized P&L remain available beneath their respective
  values where those badges are rendered.
- Holdings rows may be rendered in fixed and scrollable DOM layers; realtime
  synchronization must update every matching ticker row in both layers.

These values may have opposite signs. A daily badge must not be used as a
replacement for the cumulative account result.

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

Settings includes a grouped `/settings/color-tokens` palette editor. Its Light
and Dark values are rendered from the versioned theme configuration, while
browser-local overrides remain in localStorage and never enter `settings_store/`.
```

Older `/compare`, `/portfolio`, `/backtest`, `/more/*`, `/invest`, and `/investment` paths are compatibility redirects.

The former `/trade/timing` and `/trade/invest` aliases resolve to the current
Investment workspace. There is no separate Timing renderer in the current
runtime.

Backtest and Grid trading share result presentation and market-range components, but they are separate workspace modes. Backtest exposes the general strategy catalog; Grid trading locks strategy execution to `grid-trading` and owns its parameter surface.

All `/workspaces/*` pages use the `Canonical URL State Contract`: semantic query names, repeated values whose order carries meaning, omitted defaults, and one stable serialization order. Relative windows use `range=<period>`; custom windows use `range=custom` with `period` and either `date` or `from` / `to`. Workspace tabs and result pagination use `tab` and `page`. Legacy aliases remain readable and are normalized to the canonical form on page hydration or the next state-changing interaction.

Settings uses the same contract: the section is always the path in `/settings/<section>`, General language mapping uses `tab=history` when History is active, and General or Local Market Store pagination uses `page=<n>`. Current and page one are defaults and are omitted. Legacy `section`, `settings_section`, `language_tab`, `settings_tab`, `local_page`, and `language_page` aliases remain readable and redirect or hydrate into the canonical form. The container deployment uses these same Flask routes; there is no Docker-specific URL dialect.

Return comparison, Market cap comparison, and Price performance share ticker, relative-range, exact-date, and per-view session-memory infrastructure. Market cap history is derived from authoritative cached prices and point-in-time Yahoo-reported shares outstanding, with SEC company facts and filing-level XBRL as rate-limit fallbacks. Funds without company-facts shares use SEC Form N-PORT net assets. For the latest trading day, Longbridge `mktcap` and `last_done` provide an independent implied-share cross-check and the preferred current point. Non-US market caps are converted at the same-date daily Yahoo FX close into the immutable USD base currency; the comparison axis remains America/New_York. The service records matched, review, or diverged status after normalizing comparable providers to the same price; missing pre-disclosure periods remain unknown, and current Longbridge shares are never backfilled into older dates. The market-cap workspace accepts up to 10 user-selected tickers; other comparison workspaces retain the shared 5-ticker limit.

## Data ownership

- `market_store/`: cached price histories, profiles, and logos.
- `settings_store/`: device-local settings and investment ledger data.
- `config.toml`: versioned defaults and UI labels.

Investment buy/sell cost attribution is a browser-side replay concern owned by
the shared `data-utils.js` engine. It tracks open lots inside each broker,
account, ticker, and currency scope, then aggregates the scoped results for
display. The persisted `Settings -> Investment` preference selects the matcher
(`lowest_cost_first` by default, with FIFO, LIFO, and moving-average options).
Broker-reported closed-trade P&L remains authoritative; security-transfer basis
reconstruction is explicitly labelled FIFO reconstructed and remains separate.
When a broker provides a validated current-position snapshot, explicit order
history coverage, and a quantity-reconciling complete replay, the same engine
may attest realized P&L for open lots; rolling or incomplete histories remain
unverified.
The shared `aggregateInvestmentScopedPositionStates` helper owns the common
scope-to-ticker aggregation contract. Stock details replays the same scopes
independently at every visible chart point before calculating the aggregate
average-cost curve. A canonical ticker with multiple position currencies is not
reduced to one raw-unit average; its combined cost, market value, unrealized P&L,
and total P&L remain unavailable unless an authoritative snapshot provides a
valid aggregate basis. Converted account-level realized P&L evidence remains
  available in the scoped breakdown, even when the combined row remains
  unavailable.
Unknown carried basis on a security `transfer_in` is represented by an explicit
zero-cost lot while retaining the scope's unknown basis status. This preserves
the lot identities that existed before the receipt without fabricating the
transferred cost basis.

Tests must not rely on or mutate real device-local data. Unit tests patch store paths; browser tests avoid committing write actions.

## HSBC pending-sell transaction valuation contract

HSBC's transferable cash and current Portfolio position snapshot remain the
authoritative broker facts. Pending sell proceeds remain a separate display
projection and must not be treated as settled cash.

For row-level transaction valuation, the browser applies the following explicit
projection contract:

- The current authoritative broker position snapshot is treated as the
  post-trade endpoint for the broker's visible transaction sequence.
- The sequence is replayed in reverse. A pending sell row is valued using the
  current virtual holdings, representing the holdings immediately after that
  sell. After valuing the row, its sold quantity is added back before an earlier
  row is valued. This keeps sequential pending sells distinct; a later sell is
  not retroactively applied to an earlier sell row.
- `Market value` is the sum of each virtual holding quantity multiplied by the
  last available close in that trading day's one-minute intraday series. If no
  usable intraday row exists, the existing daily close fallback is used.
- `Equity` is the row's displayed broker cash projection plus that row's
  `Market value`.
- Because exact execution timestamps are unavailable, this convention is a
  deterministic display approximation. It must not be presented as a precise
  fill-time or settlement-time valuation.

## High-risk invariants

- Broker imports are incremental and must remain idempotent.
- Browser investment writes require a local same-origin request and a
  session-bound CSRF token. Cross-site forms, non-local rebinding hosts, and
  requests without the rendered session proof fail before request bodies reach
  an investment parser or persistence boundary.
- IBKR is an offline import-only integration. Official CSV and GainsKeeper files,
  plus user-pasted Trade Notifications text, may enter the ledger. Pasted trades
  are provisional current-moment evidence and matching CSV or GainsKeeper rows
  supersede their rounded values. Flex Web Service, Client Portal, Gateway,
  credentials, sessions, market data, and order-routing must not be reintroduced
  without an explicit user-approved architecture and security decision.
- Zircon (HK) exposes the offline generic fallback-workbook integration. The
  downloadable XLSX provides controlled broker, transaction-type, and currency
  lists plus typed date/date-time and numeric validation. Date-only entries
  default to 23:00 Asia/Hong_Kong time. Trade totals are derived from Quantity,
  Trade Price, and Commission; Amount is used only for non-trade cash activity.
  The standard parser and exporter support up to 10,000 transaction rows; the
  blank template validates and formats its first 2,000 input rows, while
  populated exports extend those controls to the complete selected scope.
  Exported Reference IDs use a stable source fingerprint rather than browser
  display order, with deterministic collision suffixes for repeated broker
  references. Source rows that cannot satisfy strict security or cash sign
  rules are represented as annotated signed `Adjustment` rows, and a populated
  workbook must pass the same parser before it is returned to the browser.
  A currency conversion is represented by exactly two Forex trade component
  rows sharing broker, account, timestamp, and Reference ID. One signed Amount
  removes the sold currency and the other adds the acquired currency. Manual
  reconciliation scopes the shared correction identity by leg currency so the
  pair cannot collapse during an incremental correction.
  Its prevalidation endpoint runs the same parser as the
  commit route but never reaches persistence. The exact validated workbook must
  be resubmitted through the immutable-evidence and readback-verified commit
  boundary.
- Stock details exports its active, filtered transaction scope through the same
  typed workbook builder. The `No specified broker` import selector is a
  broker-neutral entrypoint to that shared parser; each workbook row, rather
  than the selector, remains authoritative for broker identity.
- Investment source evidence is immutable, SHA-256-addressed, capacity-bounded, and verified under the ledger lock before persistence and at application startup. A ledger manifest must never retain raw uploaded Base64 bytes.
- Each distinct source-artifact manifest digest maps to exactly one immutable `.bin` file at `investment_evidence_dir_for(parquet_path) / <sha256>.bin`; identical source bytes reuse that file. The evidence directory is derived from the ledger parquet path as `<parquet-stem>_evidence` and is not an independently configurable store.
- `commit_investment_import` requires both the source-evidence materializer and persisted-payload verifier. Every production import path must provide and execute both callbacks; neither is an optional escape hatch.
- Evidence materialization, persisted-manifest verification, and `clear_investment_store` evidence-directory removal all hold the same reentrant `market_store_file_lock(parquet_path)`. A per-artifact file lock is supplementary and must never replace the ledger lock for an operation that changes or validates the manifest-to-directory relationship.
- Manually confirmed internal-transfer bindings are durable ledger facts. Import
  adapters must preserve their cross-import leg identities and must fail back to
  explicit review when an identity becomes ambiguous.
- IBKR Transaction History cash rows with an omitted currency are treated as
  base-currency-equivalent USD evidence only for manual matching to CNH bank
  withdrawals. Candidate ranking converts the CNH leg with the transaction-day
  CNY/CNH-per-USD FX history; the raw CNH amount is never compared as USD, and
  FPS is not inferred as a transfer fee. The persisted binding remains an
  explicit user-selected pair.
- Authoritative broker position snapshots reconcile synthesized grant quantities.
- Mixed-broker payloads retain authoritative position snapshots per broker/account;
  a scoped HSBC Holdings view may use its Portfolio snapshot even when the global
  portfolio intentionally disables a single top-level snapshot.
- HSBC available cash calibrates cash-account rows, not individual unsettled order rows.
  Pending sell proceeds are a separate display projection, while the transferable
  bank balance remains the authoritative cash fact.
- All-brokers account-balance fields retain the aggregate broker cash ledgers and
  source-bounded pending sell proceeds. Internal-transfer bridges are an
  external-flow attribution layer only; they must not subtract from the cash or
  equity balance displayed by Holdings.
- HSBC copy/paste and full monthly PDF imports preserve separate USD, HKD, and CNH cash ledgers. An offshore-RMB statement label such as `CNY` is raw provenance only; the canonical HSBC currency is `CNH`.
- HSBC copy/paste first uses a read-only preflight. USD Savings remains a three-page composite, while a valid HKD/CNH cash-only page can commit without a Portfolio or Order Status page. Cash-only payloads have no position snapshot and merge per-account-kind cash components, so HKD Current and Savings can aggregate without replacing the current USD snapshot.
- HSBC monthly PDF imports accept one unordered bundle of full monthly cash statements, including a summary-only statement with no transaction history, while retaining the legacy composite-plus-Investment-services pair path. Full monthly cash rows carry per-currency balances and quoted conversion-rate provenance; paired investment rows still own security identity, and paired composite rows own reconciled USD cash. Historical statement snapshots cannot supersede a newer live paste snapshot.
- BOCHK imports accept one or more full Consolidated Statement PDFs per batch. The customer number is the parent account, while full deposit-account numbers and short subaccount identifiers remain source-scoped. HKD Savings and HKD Current remain distinct subaccounts; `0079` printed CNY/RMB (canonical CNH) and USD sections are separate cash ledgers, with the printed marker retained as raw provenance. The parser anchors the rightmost amount as the balance, reconciles each subaccount's running balance, rejects composite page-header continuations, and fails closed on non-zero securities cash activity because this adapter is cash-only. Its period/count/balance metadata is broker-scoped so it survives a mixed ledger.
- The browser UI exposes only the BOCHK PDF path. The backend retains a tested legacy fallback for `broker=boc_hk` with `zircon_hk_transactions_xlsx`; this compatibility path must not be removed as part of PDF UI changes.
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
- `app/web/request_security.py`: local-host, same-origin, and session-CSRF
  validation for browser investment writes.
- `app/web/strategy_forms.py`: pure strategy selector, parameter-field, and
  Settings catalog presentation builders. WebRuntime supplies strategy usage
  history and the strategy factory while retaining request assembly.
- `app/web/style_token_rows.py`: pure Settings design-token presentation
  builders. WebRuntime supplies translated labels, the project display URL,
  and the Light / Dark theme mappings;
  the module has no request, storage, broker, or live-order dependency.
- `app/services/investment_record_basics.py`: shared import text, decimal, and normalized transaction-view helpers reused by `investment_import.py`.
- `app/services/investment_import_registry.py`: explicit broker and source-format parser dispatch plus the normalize, idempotent merge, atomic persistence, cache invalidation, and readback-verification boundary. Most legacy broker parsers remain in `investment_import.py`; the cohesive Zircon (HK) template and parser live in `zircon_hk_import.py`.
- `app/web/static/assets/js/chart-axis-utils.js`: shared chart tick-index, theme-token, and dynamic logo-URL helpers loaded from `base.html` as `window.ANTIGRAVITY_CHART_AXIS` before consumer scripts. `readThemeTokens` resolves CSS custom properties, then explicit fallbacks, then `ANTIGRAVITY_APP.theme`, then empty strings. `normalizeSafeImageUrl` permits HTTP(S) URLs and controlled local logo paths only; dynamic tooltip data is rendered through DOM properties rather than interpolated HTML. Existing theme-token consumers keep local fallbacks if the shared script is unavailable.
- `app/web/static/assets/js/export-image-config.js`: shared versioned export profile registry loaded before screenshot consumers. Settings previews and detached PNG exporters apply the same profile tokens and derived dimensions, while future exporters can register an isolated template profile through `window.ANTIGRAVITY_EXPORT_IMAGE`.
- `app/web/static/assets/js/numeric-display.js`: one numeric parser, integer/fraction part builder, escaped HTML renderer, and progressive enhancement pass shared by workspace metrics, Investment realtime transitions, Compare, and Settings token previews. Font tokens own the fractional scale; Style tokens expose the workspace alias consumed by the same CSS rule.
- `app/web/static/assets/js/investment/realtime.js`: quote-poll lifecycle and numeric transition behavior.
- `app/web/static/assets/js/investment/stock-details.js`: Stock-details range, session-boundary, and rendering helpers.
- `app/web/static/assets/js/investment/data-utils.js`: shared investment ledger replay, lot matching, cost basis, realized P&L, and unrealized P&L calculations used by Holdings and Stock details.
- `app/web/static/assets/js/investment/transaction-filters.js`: broker, currency, type, and date-filter contracts.
- `app/web/static/assets/js/investment/transaction-table.js`: visible-row selection, stable descending order, page clamping, and ledger-to-page lookup.
- `app/web/static/assets/js/investment/url-state.js`: canonical query-string parsing and serialization for Investment views, ranges, broker scopes, table filters, Stock details dates, and pagination.
- `app/web/static/assets/js/workspace/url-state.js`: shared canonical query-string parsing and serialization for Workspace tickers, ranges, return modes, portfolio allocation, backtest and DCA parameters, detail tabs, and pagination.
- `app/web/static/assets/js/settings/url-state.js`: canonical Settings section, language-tab, and pagination parsing and serialization, including legacy aliases and default omission.
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
