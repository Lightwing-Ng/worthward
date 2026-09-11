# Architecture guide

Documentation version: `v1.106.3`

## Shared Backtest controls and research

Leveraged Rotation exposes two integer-step allocation-limit bars with dynamic ticker labels, primary blue and leveraged magenta tracks, and white vertical handles. Browser constraints mirror strategy normalization: each minimum is at most its maximum, minimum allocations sum to at most 100%, and each maximum leaves room for the other minimum. Initial allocation remains a separate percentage preview subject to normalization on submission. Coincident or near-coincident handles move into separate vertical lanes without changing their true horizontal percentage positions; labels retain the exact values, including zero. Interior two-line limit labels are centered, while exact 0% and 100% labels align toward their respective track edges. The three bar components consume one foundation-backed allocation-range token family for compact geometry, title/detail type, and the limit-thumb surface; Style tokens catalogs the three-segment distribution and two limit-bar variants together. Their custom collapse bodies remove only the trailing block padding. Return window uses intrinsic content width at the value-column edge, while the field-label column remains the sole wrapping region. Generic rotation labels preserve the two causal clocks without embedding the selected ticker symbols: `Enter leveraged: primary drop` uses the selected Return window, while `Rotate back to primary: leveraged gain since entry` starts from the actual leveraged open where the last entry rotation executed. The Return window and entry threshold form one uninterrupted visual group; the divider remains only before the since-entry exit threshold. The price subplot remains a single primary-ticker curve: primary trades keep their execution-price marker, while leveraged-ticker trades use the exact aligned transaction timestamp and the primary close at that timestamp as their display-only marker ordinate. The equity subplot retains the strategy curve and renders two independently calculated all-in references. Each reference buys the maximum integer shares of its own ticker at the first aligned open, carries residual cash, applies that ticker's dividend policy, and marks equity at each aligned close. Both references use the restrained shared muted token and the original one-pixel all-in reference width so the green strategy-equity curve remains visually dominant. Summary alpha and beat-rate metrics continue to use the primary ticker as their benchmark.

The same strategy is available through `scripts/strategy_tune.py --strategy leveraged-rotation --ticker QQQ --ticker TQQQ`, including JSON fixed parameters, numeric bounds, categorical Return window search, genetic search, and random-forest search. Runs read existing local history and write explicit research outputs, with validation ranking and a separate final holdout. The adapter retains pre-fold observations for return-window warmup while stamping the scored fold's first date as the decision boundary, so a stateful strategy cannot inherit a rotation that the fold-local portfolio never executed. The default ranking is risk-adjusted; `--objective net-return` ranks the two validation folds by their mean net return percentage without changing the disclosed drawdown or allowing holdout data into selection. The result records normalized parameters for reuse in Backtest URLs or subsequent CLI requests.

An all-cash initial allocation is valid when the declared minima permit it. The execution engine requires finite positive opening prices, not an initial purchase; it retains cash until a later permitted signal creates a position, or throughout the backtest when both maxima are zero.

`templates/_collapse.html` and `components/collapse.css` own the shared
`ui-collapse` primitive. The `Collapse` Style tokens sample edits the same
foundation tokens used by all Backtest groups and the Settings strategy-card
branch. Capital and the four return/exit/detail controls live in `Backtest
parameters`. Strategy definitions declare parameter/factor groups and optional
private action slots through `BaseStrategy.get_parameter_sections()`; the web
form builder and one field-grid partial render them without strategy-specific
DOM regrouping. Parameter definitions may also declare a controlling field/value,
content-sized right alignment, and user-facing choice labels that remain separate
from stable submitted values. The generic field-grid adapter owns those behaviors;
strategies do not add page-specific show/hide or width scripts. LSTM declares its training slot; Bayesian declares only model
parameters and shared factors. Changing a standard collapse token updates every
consumer; product branches do not copy the base component. Summary padding is `10px 0`,
so disclosure triangles align with adjacent field labels at every width. The shared modal uses
the standard frosted-glass material directly, without a separate white highlight layer.

The strategy catalog declares `presentation_renderer`. Price Field detection
uses that capability, not a hard-coded strategy-ID list. A model-neutral
`renderer_schema=probability-grid/v1` accompanies each model's own versioned
schema; the browser validates the common schema, renderer, and aligned dates.
Old Bayesian/LSTM payloads remain read-compatible. New models can opt into the
same grid without copying geometry, templates, colors, or hover behavior.

The strategy class metadata is also the only category authority. Backtest and
`/settings/strategies` consume the same grouped catalog, so each enabled strategy
appears exactly once under Baseline, Investment Automation, Technical Analysis,
Machine Learning, Portfolio Rotation, or Price Field Models. The Settings page
adds navigation, category descriptions, capability badges, and strategy-owned
parameter tables without maintaining a second classification list. The Price
Field category is reserved for strategies that use the shared probability-grid
renderer; MACD, SuperTrend AI, and the TradingView-derived Lorentzian classifier
share Technical Analysis, while DCA and Grid Trading share Investment Automation.

`strategies/tuning.py` derives search domains from the same parameter definitions.
Display thresholds, compute backends, and the LSTM seed are not optimized;
explicit fixed values are validated rather than silently clamped. Genetic search
uses elite crossover and mutation. The random-forest method fits a bootstrap
CART ensemble to measured validation scores and chooses proposals by predicted
mean and ensemble spread; it does not invent strategy scores or forecast prices.
Numeric search bounds must be a two-number array, excluding JSON booleans and
numeric strings. Malformed domains fail explicitly rather than being coerced
into a different search range.

`app/services/strategy_tuning.py` loads real read-only local OHLC or the
strategy-declared provider once, reserves candidate warmup/factors, and reuses
the canonical single/multi-ticker, grid, rotation, DCA, and interval-bridge engines.
It requires 40 distinct trading dates, uses the first half for warmup, scores
50–65% and 65–80% as chronological expanding validation folds, then evaluates
only the chosen configuration on the last 20%. The default objective is mean
validation return percentage minus half the maximum drawdown percentage; the
explicit net-return objective instead uses mean validation net return percentage.
Final holdout data never ranks candidates. Price-frame fingerprints,
provider/model provenance, fixed configuration, and every evaluation are
recorded outside production stores.
`scripts/strategy_tune.py` persists holdout errors alongside the successful
validation evidence and returns a failing exit code rather than claiming success.

Research adapter v1.1.0 retains loaded pre-range history when constructing each
model prefix; the prefix ends at that fold's final trading date. Warmup rows
initialize indicators/models but never contribute trades or equity to the scored
window. For mixed-frequency execution, pre-range intents are removed before the
daily-to-minute bridge. Prediction eligibility is checked on the scored dates
before bridging, and model provenance survives the bridge. Predictions that exist
only in warmup cannot make an otherwise unavailable validation/holdout eligible.

## Direct-horizon neural Price Fields

PatchTST, TSMixer, N-HiTS, TimeXer, iTransformer, TiDE, ModernTCN, and TFT are discovered strategies using
one `NeuralPriceFieldStrategy`, causal input layer, Torch engine, and scorer.
They predict 1–20 session close-return marginals directly and share the existing
renderer through its direct-horizon distribution adapter. The declared
`neural-price-field-v1` capability connects them to one strategy-scoped training
manager and the existing training controller. The [neural research contract](NEURAL_PRICE_FIELD_RESEARCH.md)
owns model evidence, factor timing, probability-score interpretation, runtime
selection, and frozen validation boundaries. Legacy LSTM and Bayesian numerical
contracts remain separate.

The immutable `neural_price_field_registry.py` catalog owns architecture identity
and bounded research domains. `FrontierPriceFieldStrategy` narrows width defaults
for the four additional architectures while inheriting the complete existing
strategy contract. Their independently implemented cores live in
`neural_price_field_models.py` and `neural_price_field_tft.py`; dispatch preserves
the original four model construction paths. A new research process must explicitly
select its strategy group. The coordinator defaults to the original four and can
run CPU-only search, replicated validation, and reporting without creating a GPU
worker. It scales its final-evaluation reserve to the group, backend, and worker
count. Existing frozen experiments retain their own source and protocol version.

## Exact-configuration LSTM training

The web manager reserves a request before launching the worker. It passes the
exact reservation path with `--prepared-request`; the runner verifies the request
identity and claims it once under its run lock. A reservation alone is not a
previous run needing `--resume`. Existing worker/snapshot/status/checkpoint
artifacts cannot be silently resumed. A stale parent/worker fingerprint fails
with an explicit restart instruction. The manager exposes a bounded startup-log
error for an exited worker without rewriting historical files. This fixes the
former web launch failure caused by mistaking the manager's own request for
prior training work.

The web action snapshots the current ticker, relative or exact range, interval,
capital, return/exit settings, and all private factor/parameter controls. The LSTM form declares Compute backend in the training section and marks that control plus every market-factor switch as a training draft. A draft updates browser-local memory and the subgroup's plain enabled-count suffix, but does not submit or recalculate the current backtest. The canonical URL and chart continue to describe the last applied configuration until the user selects a completed training case; that selection navigates through the saved configuration and performs the recalculation. The manager validates the snapshot before creating a
job and passes them to the runner CLI; request identity, launch metadata, and the
market snapshot retain the interval. This trainer supports only `1d`: missing or
unsupported frequencies fail before launch, never silently switching `1m` to
daily bars. The market loader receives the selected configuration and date bounds;
the selected-configuration path bypasses GA mutation and retains provider source
metadata and actual OHLCV observations. Missing provider data fails closed.
Unavailable historical factor observations are never fabricated; the shared
model's factor-availability rules still apply.

Durable selected-configuration training allocates at least 180 seconds of completed
optimizer work across eligible causal origins. At each origin, the same weights
and Adam state continue beyond the requested epoch floor until that origin's
budget is met. GPU synchronization is included; loading, progress callbacks, and
artificial waiting are excluded. Auto/GPU uses a confirmed PyTorch MPS or CUDA
backend and fails closed on accelerator failure. Explicit CPU remains supported.
The quick interactive Backtest backend policy is unchanged. Results report actual
optimizer steps, compute seconds, engine, and precision. Longer training does not
guarantee better holdout accuracy. SIGTERM/SIGINT cancellation and monotonic
deadlines work on Windows; POSIX also retains its alarm watchdog.

Training history is a plain heading followed by button rows, never nested native
disclosures. One row may show monospace details. Clicking a complete single-seed
case restores ticker, original period, exact scored data dates, interval, capital,
return/exit controls, and all private parameters. The requested window remains
separate metadata when listing dates or unavailable sessions shortened the data.
The green check represents configuration equality, not reuse of frozen neural
weights. Session-scoped selection survives reload and polling; any manual edit
detaches it. The selected case's URL retains explicit values and a
`lstm_training_run` identifier rather than eliding defaults. A fresh session
resolves that identifier only against an available, matching saved configuration.
Intermediate form-hydration events do not discard the selection; a user edit
removes both the selection and its URL identifier. Navigation immediately shows
the selected row and a loading status. Old multi-seed aggregates without a complete single-seed configuration
remain inspectable but are not guessed into selectable cases.

Active progress sits below the intrinsic-width start/stop button, outside history;
the outer training heading shows the shared SVG spinner. Its bar uses the positive
green token only. Terminal jobs have no bar. Rows show ticker, a measured holdout
accuracy badge using the Holdings allocation badge style, and right-aligned
monospace `yymmdd(##)` (UTC start day, chronological sequence per ticker/day).
Archives participate in numbering so deletion never renames surviving rows.
The CSRF-protected delete route moves one inactive, unlocked compute directory
to its workspace's `.deleted/` directory; market/settings stores are untouched.
Protocol version 2 prevents the updated UI from starting jobs through stale
pre-contract services. Activation of cached Python routes requires a user-owned
service restart, never an agent-triggered restart.

## Price Field detail view contract

Bayesian Price Field and LSTM Price Field share one Backtest history `Price Field`
option between `Metrics` and `Transactions` when a valid strategy presentation is
available. Both strategies emit the `probability-grid-v1` renderer payload defined
in `strategies/price_field_contract.py`. The browser uses three shared owners:

- `app/web/static/assets/js/backtest/chart-controller.js` exposes a controller
  factory with `mount(state)`, `update(state)`, and idempotent `destroy()`. It owns
  the synchronized Price/Equity charts, probability DOM, hover/pin/drag state,
  caches, listeners, observers, and scheduled work. Mount replaces the previous
  runtime; update with a different state object remounts, while update without
  new state refreshes layout. `backtest.js` owns workspace preferences, tabs,
  sharing, and controller wiring.
- `app/web/static/assets/js/backtest/probability-grid.js` owns geometry, cells,
  opacity, thresholding, and the pure pin-state reducer.
- `app/web/static/assets/js/backtest/distributions.js` owns probability math.
  Each controller receives an immutable registry whose adapters implement
  `probabilityBetweenPrices(parameters)` and `probabilityAboveAnchor(parameters)`.
  Bayesian and LSTM distribution kinds share the existing Gaussian/AR(1) adapter.
  Extensions are local to a registry and cannot overwrite built-ins. Omitted
  legacy kinds retain Gaussian behavior; explicit unknown kinds do not render a
  field. Invalid adapter probability masses reject the cell set. New distributions
  still need to supply the aligned predictive-series envelope required by v1.

The existing template `app/web/templates/_backtest_probability_field.html` and
shared styles remain common to both strategies. Neither model forks these files.

The model-neutral server-side foundation is
`strategies/price_field_pipeline.py`. It owns the warm-up-inclusive Longbridge
factor bundle request, OHLCV normalization, point-in-time as-of observation
merge, shared factor definitions and transforms, the executable
`Open[t+1] -> Open[t+2]` target, causal AR(1) return state, probabilistic
diagnostics, threshold intent, JSON normalization, and factor-status
presentation. Bayesian retains posterior inference, causal factor selection,
and Bayesian backend scheduling; LSTM retains sequence construction, training,
and its backend policy. Neither strategy is an infrastructure container for
the other.

The underlying read-only Longbridge provider is canonically named
`app/services/price_field_market_factors.py` and exposes model-neutral bundle
and cache APIs. `app/services/bayesian_market_factors.py` is only a live
backward-compatible import alias for older callers; the shared pipeline does
not import it.

The Backtest history surface exposes a third `Price Field` option between
`Metrics` and `Transactions` when the active Bayesian or LSTM strategy emits a
valid presentation. Selecting it renders the active model's product-specific
detail panel without replacing either existing view. `app/web/static/assets/js/backtest.js` builds separate
`probability-grid` models from the live Chart.js Y scale: the floating hover
model is clipped to the current Chart.js plot boundaries, while the persistent
detail model rebuilds the complete strategy-owned row lattice around the same
selected origin and scales it into its own viewport. A chart hover changes the
detail panel's selected origin; clearing hover hides only the floating overlay,
so the last valid forecast remains inspectable. Hovering any detail-grid row
shows its exact price interval and the cumulative raw probability mass across
all forecast cells in that row, including cells hidden by the display threshold;
the hovered row carries that summary without changing the status-line layout, and
only the contained detail grid makes those hidden cells hit-testable. The detail
heading keeps the selected date as the sole status-line text and omits the
redundant `Forecast date` axis title while retaining the forecast-date ticks.
It intentionally has no price-probability legend: the two-dimensional cell
field is explained by its axes and grid, not by a misleading one-dimensional
color scale. The detail plot, main column, grid viewport, and complete lattice
are separately clipped and contained so the full 20 × 20 geometry cannot paint
outside its owning surface. The detail viewport places normalized higher-price
and lower-price shares at the right end of the horizontal price guide. For each
forecast horizon, divide each direction's complete lattice mass by the total
represented mass, including threshold-hidden cells, then average those shares
equally across nonempty horizons. These are conditional shares within the
represented lattice, not full-distribution directional probabilities; accessible
labels explain the excluded tails and gaps. Empty distributions show unavailable,
not an invented split. Round the higher share to a hundredth of a percent and
derive the lower label as its exact complement, totaling 100.00%. Individual cell
probabilities, thresholding, and model outputs remain unchanged. The right-aligned
percentage labels use a dedicated 17px value style so they remain
legible beside the guide without changing the grid or axis typography.

The detail panel keeps the renderer's integer-trading-day horizon, fixed 20
columns, 2px gaps, opacity mapping, and square-cell geometry. A cell is green
only when its complete price interval is at or above the selected close; a cell
whose interval crosses the close remains red, so the horizontal guide is never
visually crossed by a green cell. The asymmetric grid is anchored to that guide
instead of being centered as one block, and a detail-viewport resize triggers a
fresh measurement after the surrounding layout settles. Its forecast-date ticks
call the Settings-owned date formatter and use only a small edge-aware tick set
to avoid collisions. Price ticks are derived from the exact cell price intervals
returned by the live scale. This is a Backtest-specific surface; it has no
equivalent in `agenticContext` and therefore remains Pending in the shared
UI synchronization ledger.

The renderer derives a target cell size from the trailing three-month data
density on the current chart. Every other available range reuses that target
when its integer trading-day lattice permits it, choosing the smallest
non-under-sized complete slot when quantization makes an exact match
impossible. Chart boundaries, the 20-column contract, the 4px floor, and the
existing strategy row limits remain authoritative; chart-boundary limits apply
to hover, not to the contained detail surface.

The history surface's shared vertical section-resizer minimum includes the
active detail panel's heading, lattice, and forecast-date axis budget. The
panel remains shrinkable within the allocated history rail, so the plot and
its labels cannot escape or be clipped by the parent surface when the
horizontal or vertical workspace handles change the available space. When the
10-row overview plot budget and that extra history demand cannot both fit,
Backtest keeps the overview minimum and compresses history instead of scaling
both tracks; shrinking the published plot minimum is what drops a 10-row field
to 8 rows.

The contained detail timeline uses `backtest/detail-chart.js` and
`chart-controller.js`. Its selected date stays at horizontal center, with the
complete square-cell forecast grid on the right and the same number of trading
sessions on the left. The chart frame fits the available width and height without
stretching cells. Unavailable earlier history remains empty; historical prices
outside the forecast price scale are clipped rather than changing cell geometry.
Both halves share one trading-session time scale and one linear price scale.
The axis column and tick positions depend only on the container geometry; hover
changes prices and dates without moving the axis. A fixed status row prevents
text wrapping from changing the plotting frame during hover.
Known dates come from the observed series. Beyond its endpoints, date ticks use
weekday projections, with the assumption available in their tooltip and no
approximation prefix. Historical start, origin, and forecast end remain visible;
intermediate labels are collision-filtered. No future prices are manufactured.

The forecast half also overlays observed prices when later bars already exist.
This read-only SVG layer ends at the earlier of the last real bar or the forecast
horizon. All segments use the same muted gray color and opacity as the crosshair
guides, below the probability grid and with the historical curve's stroke width. Missing prices remain gaps. Observations never alter the
forecast bins, fitting scale, or model inputs. Backtest's overview heading is
"Price and strategy analysis" for both prediction-only and trading analysis.

The contained detail surface reuses the overview price chart's axis typography.
Its Y-axis column has a fixed token-based width; Y ticks and date ticks use the
same `GDS Transport` 12px, regular-weight font and 10px line height as Canvas
labels. The centered frame fits the detail container's current dimensions,
including sidebar and resize changes, independently of the overview hover state.

The overview hover surface maps the pointer onto the visible price curve.
Tracking solves automatic overflow pan directly from screen-space pointer X and
static chart dimensions, independently of the previous pan. It then intersects
the settled visible curve and commits the date, lattice, and guides in one
animation frame. The vertical guide follows the cursor during pan as well as
before it; stationary and vertical-only moves cannot advance dates through
scroll feedback. The horizontal guide is the intersection of that vertical line with
the visible polyline, including linear interpolation across interrupted
gaps. The Price Field is drawn to the right of the
vertical guide, with green/up cells above the horizontal guide and
magenta/down cells below it. The vertical guide cannot travel past the
last finite curve point; a pointer over the overflow field stays clamped
to that endpoint instead of walking off the series. Overflow pan is
limited by the same endpoint: the chart may shift left only until the
vertical guide sits on the last trading day. Continued rightward tracking keeps
that endpoint under the cursor. The field origin never shifts away from the
guide merely to fit the viewport. When trailing columns are clipped, pressing
and dragging left pans the plot and forecast together. During the drag, the
cursor still owns the guide and its curve intersection. A four-pixel horizontal
gesture threshold distinguishes dragging from pinning. A curve press keeps its
immediate pin feedback but defers the viewport snap until release, allowing the
same press to become a drag without a jump. Pointer capture stays on the price
canvas so its compatibility click cannot be mistaken for an outside click.
Releasing a drag retains
the viewport, not a pinned date; stationary and vertical-only movement leave it
unchanged. The price-axis paint surface stays fixed, and blue price/date badges
remain visible at the settled intersection. Date badges are inset at the viewport
edges to avoid clipping. The detail panel retains the complete field. Leaving the chart stack
clears both guides and the floating field, except when the pointer enters
the native scroll rail to preserve manual field scrolling.
No Chart.js hover point is drawn for Price Field tracking;
a pinned field snaps back to the non-scrolling chart coordinate system and
returns both guides to its selected data point. Moving into
another chart subplot or leaving the stack still follows the existing
shared-tooltip ownership rules.

Threshold filtering never changes the raw cell probabilities. A finite forecast
whose cells all fall below the selected display threshold keeps its date and
guides and explicitly reports the threshold and largest cell mass in both views.
An empty-looking filtered lattice is not treated as missing training or an
unreachable chart endpoint.

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

IBKR Trade Notifications web paste keeps every full-page filled row, including
same-minute split fills that share an account, ticker, quantity, price, side,
and venue. The only exception is a compact Orders aggregate that declares the
same number of same-page fill details and closes exactly on quantity, gross,
commission, and net amount; the aggregate is the canonical representation and
the alternate full-page rows are removed. An optional paired Your Holdings
clipboard capture supplies the cash and position boundary at the latest
captured fill time. The server extracts every native-currency Cash Holdings row,
requires exactly one marked base-currency row, and reads each Instrument/Position
row. It requires the same IBKR account as Trade
Notifications, and retains the raw holdings page as separate immutable
evidence. This boundary creates neither an account-specific calibration record
nor synthetic transactions; because the pasted pages are not a complete ledger
history, the resulting snapshot remains partial-history evidence for P&L
validation.

A currency-pair fill such as `USD.CNH` is classified as a provisional
`forex_trade_component`, not a security buy or sell. The web capture retains the
base quantity, quote amount, direction, and quote-currency fee. It records no
cash-flow amount because the Trade Notifications page does not expose the
official base-currency residual used by Transaction History. A later official
row matching account, pair, displayed calendar date, quantity, and rate replaces
the provisional component idempotently.

Official IBKR Realized Summary reports are closed date intervals. A report that
partially overlaps an already covered interval may advance the performance
snapshot only after its stock and Forex realized components reconcile the whole
report. The aggregate then adds components strictly after the prior closed
boundary and takes unrealized marks from the newest accepted report; the shared
boundary date is never counted twice. Forex components use `Forex P/L Details`,
not Transaction History cash impact, because the broker-reported realized value
already includes the conversion fee. Missing, ambiguous, or unreconciled detail
keeps the older performance boundary. A newer date-only cash report likewise
replaces an older file boundary and clears its obsolete intraday timestamp so a
current balance cannot be projected backward.

One Trade Notifications capture may include current-day rows that show only a
time and older rows with a full displayed date. The required Hong Kong page
date is applied only to those time-only current-day rows; full-date rows retain
their own broker-provided calendar date before each timestamp is converted to
the New York ledger timezone.

When immutable IBKR GainsKeeper evidence supplies the split fills for a
provisional compact web aggregate, GainsKeeper becomes canonical even if its
commission and net-cash precision differs. This replacement requires one
compact aggregate, unique GKX FITIDs, the declared split count, and exact
agreement on account, side, ticker, currency, trading date, minute, price,
signed quantity, and gross trade value. It never synthesizes a trade or
removes a web aggregate from an incomplete or ambiguous match.

### Console logging

`main.py` configures process-wide console logging before runtime bootstrap. Every
record uses the shared schema
`UTC timestamp | level | logger | job_id | message`, so Werkzeug startup
messages and application diagnostics use the same spaced delimiters. The
default `job_id=-` remains explicit until a background operation binds a job
context.

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

## OpenAI Site tools and Agent Optimization boundary

Every canonical human page that extends `base.html` includes one static project manifest from
`_agent_optimization.html`. The byte-identical shared runtime in
`app/web/static/assets/js/agent-optimization.js` validates that manifest and conditionally registers
three OpenAI Site tools through `document.modelContext.registerTool`.

The v1 tools expose only bounded capability metadata, bounded current-page metadata, and navigation
to a manifest-owned same-origin route. They never serialize `WORTHWARD_APP`, chart series,
investment records, credentials, CSRF tokens, broker state, or settings values. They do not call a
Flask mutation endpoint. The Live trading PIN template does not extend `base.html` and remains
outside the Site tools surface. When WebMCP is unavailable or a document is framed, registration is
a no-op and the human interface remains complete.

Normal navigation may execute the destination page's existing market-data flow, so the navigation
tool declares a visible page change and normal page load. It does not claim that navigation is
network-free. The cross-project naming, schema, result, effects, security, evaluation, and promotion
rules may also be maintained in a private sibling contract; project-specific routes and
evidence live in [AGENT_OPTIMIZATION.md](AGENT_OPTIMIZATION.md).

## Beta module boundary

`app/beta` registers a separate optional Blueprint, with its own presentation
context, registry, bounded read-only daily-cache analysis, and scoped assets.
It has no strategy registration, training lifecycle, market refresh, or broker
mutation path. See [Beta research laboratory](BETA_LAB.md) for its removal
switch, numeric interpretation, and browser-only draft storage.

## Canonical navigation

```text
Workspace
  Return comparison  /workspaces/compare
  Ticker comparison  /workspaces/prices
                     /workspaces/prices?metric=market-cap
  Portfolio          /workspaces/portfolio
  Backtest           /workspaces/backtest

Trade
  Investment         /trade/investment
  Live trading       /trade/live-trading

Beta                 /beta/<experiment>

Settings             /settings/<section>

Settings includes a grouped `/settings/color-tokens` palette editor. Its Light
and Dark values are rendered from the versioned theme configuration, while
browser-local overrides remain in localStorage and never enter `settings_store/`.
```

Older route aliases are compatibility redirects, not independent renderers. The
complete matrix and removal rules live in
[`COMPATIBILITY.md`](COMPATIBILITY.md). The former market-cap route redirects
to `/workspaces/prices?metric=market-cap` while preserving canonical query
state.

## Return comparison identity and live-date ownership

Return comparison, Price comparison, and Market cap comparison preserve the
security identities selected by the user. If a selected ticker has neither
usable remote history nor a usable local cache, the workspace keeps every
original ticker slot and reports an explicit error; it does not calculate with a
different security. Portfolio is the sole exception under its positional
allocation contract below.

For relative `1d`, `3d`, and `1w` live refreshes, the server owns the current
comparison date in `Asia/Shanghai`; a client-supplied `live_date` is ignored
unless the request also carries the exact comparison axis date. Server-rendered
state and live responses publish that current comparison date so exact one-day
clients can decide whether polling is applicable without using the browser's
local calendar. Same-page Return comparison hydration restarts this lifecycle
after a live-range transition and invalidates its prior timer or response when
the selected range changes.

## Portfolio allocation correctness

Portfolio keeps ticker, dataset, weight, and share values in one positional
contract. Repeated query values follow repeated ticker positions, while legacy
`ticker_N`, `weight_N`, and `shares_N` values retain their common numbered slot;
empty ticker slots may be removed only after their allocation positions are
identified. A ticker without usable remote or local history may be replaced
only by a successfully loaded ticker that is not already selected. The
replacement dataset occupies the missing ticker's original slot; if no unique
dataset is available, calculation fails explicitly instead of shifting another
ticker's data or allocation.

In `allocation=shares` mode, opening allocation is each positive whole-share
count multiplied by that ticker's aligned opening close. The server exposes the
opening close with each Portfolio bootstrap item. The browser uses the same
definition for the immediate donut preview and retains the last verified
preview when a newly entered ticker has no server-provided opening price; it
does not substitute the hidden weight control or guess a price.

## Shared Settings dimensions

The Settings workspace uses the foundation layout tokens
`--layout-content-width: 640px` and `--layout-control-width: 384px` as its
canonical content and control maxima. Feature-specific Settings width tokens
alias these values instead of introducing page-local pixel widths. A page may
still opt into a wider surface, such as the Style tokens specimen shell, when
its scrollable demo layout requires it.

The Settings workspace shell itself stays `overflow: visible`. All non-Style-token
routes place their content in one `.settings-content-scrollport`, which is the only
page-level vertical overflow owner. Its shared
`--layout-physical-effect-bleed: 48px` start-side and bottom safe area keeps card
shadows and translated controls inside the scrollport ink boundary without moving
the 640px content or 384px control anchors. Tables and parameter lists retain their
smaller internal scroll regions.

## Shared spatial layout contract

The normative cross-project contract is maintained in
[`../SHARED_UI_LAYOUT_CONTRACT.md`](../SHARED_UI_LAYOUT_CONTRACT.md). This
project is the complete reference implementation; agenticContext adapts the
same contract to its local routes and single-file stylesheet.

The contract is geometry-first rather than selector-first. Production markup exposes
`data-layout-role` anchors for the sidebar toggle, sidebar title, global action rail,
global theme anchor, dock, title rails, result headings, result containers,
scrollports, actions, secondary headings, and pagination. Browser checks measure those
roles in the rendered DOM with a one CSS-pixel tolerance; XPath strings remain useful
diagnostic evidence but are not the implementation boundary.

The page edge inset is `P = max(10px, safe-area-inset)` per side and the shared edge
gap is `G = 10px`. The sidebar's outer rectangle uses `P` for its viewport edge
distance and `10px` for its radius. Fixed global actions use `P + G` for their top
and right anchors. The expanded sidebar toggle uses the same vertical anchor and a
right offset of `G` from the sidebar edge; the collapsed and overlay states preserve
that vertical coordinate and change only the horizontal translation. In overlay mode,
the collapsed toggle uses `P + G` for both top and left when the corresponding safe
areas match; the transparent full-viewport dismissal layer has zero radius and no
shadow. Workspace destination rows use a tokenized `36px` compact height, while the
default navigation height remains `48px`. The dock's
centerline is the sidebar centerline and its bottom clearance from the sidebar is
`G`. Content and control widths are `min(100%, 640px)` and `min(100%, 384px)`;
standard selects and dropdowns use the control width token.
Portfolio keeps its 640px result maximum on desktop, but at widths up to 767px
its single-column result stack expands to the full workspace width so it aligns
with the full-width controls surface.

At desktop widths the sidebar is a grid column. At widths up to `900px` it becomes a
safe-area-aware overlay, while the dock is centered in the overlay and the toggle and
global actions remain separate. At widths up to `600px`, content changes to the
compact flow without changing the token meanings. In every state, title rails,
secondary headings, share actions, and dates have explicit owners so they cannot
collide or silently extend into the sidebar. Portfolio uses the short one-line
`Portfolio` title; its date and share action belong to the result container. A
pagination control belongs to and is centered by its parent surface. Backtest Metrics
and Transactions share the same resizer endpoint.

Overflow is an ownership decision. The page and workspace shells stay open wherever
card shadows, blur, translated controls, or focus rings must escape. Effect hosts set
`overflow: visible`. A named scrollport owns scrolling only for its data region and
uses the 48px effect bleed where needed. Chart canvases, tables, dropdowns, and long
text may retain local clipping only when that element is the documented viewport.

## Shared stock-price axis labels

Every chart whose Y-axis represents a stock price delegates label formatting to
`WORTHWARD_CHART_AXIS.formatStockPriceAxisValue`. Absolute prices at or above
`100` render as grouped integers, such as `1,234` or `567`; lower prices render
with exactly two decimals, such as `12.50` or `5.50`. Price comparison,
Backtest and DCA price subplots, Live trading candlesticks, Investment Stock
details, and their Settings share previews use this contract. Equity, return,
market-cap, volume, and share-count axes retain their domain-specific formats.
Price comparison suppresses three-letter currency prefixes on its left Y axes,
including mixed-market views, so its dynamically shared gutter is based on the
numeric labels alone. The shared hover tooltip retains the currency of every
price value.
The Investment filled hover badge is also the shared
`WORTHWARD_CHART_AXIS.drawYAxisValueBadge` primitive. Strategy-specific
Backtest overlays call that primitive instead of maintaining a second badge
renderer.

The Bayesian Backtest overview reuses the same filled blue Y-axis badge for the
horizontal hover guide, with its value taken from the exact polyline intersection
under the vertical guide. The corresponding vertical guide also paints a filled
blue X-axis date badge at the Canvas axis baseline. Its two lines use the shared
typical date format, axis font, and axis line height; endpoint alignment rules do
not apply to this centered hover badge. Both badges are transient and clear with
the hover overlay.

## Price comparison cost-distribution snapshots

The Price comparison Canvas owns both the price series and the optional right-side estimated Cost Distribution. The idle profile represents the complete selected OHLCV range. While the shared price crosshair is active, every subplot switches to a cumulative snapshot containing only OHLCV rows at or before the crosshair timestamp. Snapshot distributions retain the complete range's price-bin domain, so the shared Y-axis and bar-price positions never move while the cursor scrubs horizontally.

Selected-range local OHLCV with sufficiently complete positive volume is authoritative for fallback coverage. Those tickers are omitted from remote chip requests and satisfy payload completeness even when Longbridge does not support their market. If the remote API's two-ticker minimum requires an otherwise complete ticker as an anchor, any provider error for that anchor is ignored because it does not affect the locally rendered profile.

Snapshot calculation remains separate from rendering. The calculator accepts an optional enclosing price domain and prepares cumulative bin-weight prefixes once per subplot; selecting a new hover date uses binary search plus the prepared prefix instead of filtering and replaying the historical rows. `price-compare.js` owns timestamp truncation, per-subplot bounded LRU caches, one animation-frame commit for tooltip DOM, layout measurement, snapshot selection, and chart redraw, plus restoration of the complete profile on pointer exit. Repeated callbacks for an unchanged hover index and source chart short-circuit before DOM or Canvas work. Canvas plugins read the chart's active distribution state instead of capturing one immutable initial profile. The active snapshot's last known price controls the established magenta underwater and green profitable chip colors. Date-bounded Longbridge requests, including exact one-day ranges, use market-local daily OHLCV and never substitute current `trade-stats`; `trade-stats` remains only an unbounded recent-price-level fallback. Successful ticker payloads retain bounded LRU reuse, while transient per-ticker errors are not cached and receive bounded exponential retries.

The former `/trade/timing` and `/trade/invest` aliases resolve to the current
Investment workspace. There is no separate Timing renderer in the current
runtime.

Backtest owns the shared result presentation and market-range components. It exposes every enabled strategy in the dynamic catalog, including `dca`, `grid-trading`, `bayesian-price-field`, and `lstm-price-field`, and renders its parameter fields directly from the selected `strategy_*.py` implementation. Every strategy with private parameters uses the shared `Tune strategy parameters` control; the control starts pressed and the panel starts open. The panel remains in normal document flow immediately below the Strategy row. Above the registered 900 px sidebar-overlay breakpoint, the page-level `Backtest` title rail remains in its own row above the results grid, the result column's `Performance` title rail begins below it, and the complete controls surface owns vertical scrolling as one logical sequence. At 900 px and below, only the Backtest controls surface leaves the grid and becomes a fixed, safe-area-bounded left overlay. The result column then owns the full workspace width. A separate 44 px parameter toggle uses the shared round-control geometry; the overlay defaults closed, remembers its open state in session storage across parameter-driven reloads, closes through its transparent backdrop or Escape, and never remains open when the global navigation sidebar opens. The fixed panel retains one vertical scroll owner and marks its closed contents inert, so generic controls, Strategy, and every private parameter remain operable without adding a nested parameter-grid scrollbar. The Backtest-wide `Show trade details` preference defaults to enabled and is rendered between Stop loss and Strategy. Its browser controller gates trade markers, the equity comparison panel, and the Transactions history option together; disabling it selects Metrics, hides the lower subplot so the price chart expands in the same measured stack, and writes only `show_trade_details=0` to the canonical URL. The preference is excluded from computation and result-cache keys. Strategy tuning values are retained in `localStorage` under `worthward:backtest-strategy-params:v1`, keyed by strategy ID and field name, so every Backtest strategy restores its own last-used panel state across reloads and strategy switches. Explicit URL parameters take precedence for the current render, and this browser preference never writes to broker or server settings stores. For `lstm-price-field`, `app.services.lstm_training.LstmTrainingManager` launches the durable `scripts/lstm_ga_tune.py` runner in a detached process session, verifies process identity by script and request seed before termination, and reads only the current project's hashed compute-job state root for history. The private `Strategy parameters` collapse opened by the round `Tune strategy parameters` button contains the LSTM Start training and Stop training actions, while the strategy dropdown remains dedicated to strategy choices; native `<details>` sections provide the accessible collapse component for the durable history. Browser writes require the existing same-origin session CSRF proof; no training metadata enters market, broker, or investment stores. Dollar-cost averaging uses the recurring-investment simulator while sharing Backtest's charts, metrics, contribution table, export, and 100-row pagination contract. Grid Trading interprets Initial cash as spendable cash in addition to Current holding. The first marked value of that existing holding and the cash define starting equity, return denominator, and the all-in benchmark, so a real existing position is never rejected merely because its marked value exceeds the cash balance. Frequency remains a right-aligned intrinsic-width shared select. Weekly day appears only for weekly schedules and exposes Monday through Sunday; weekend intentions use the existing next-trading-day alignment. Monthly calendar day appears only for monthly schedules. Daily chart tooltips omit a meaningless midnight suffix, while minute data retains its time. The legacy `/workspaces/grid-trading` and `/workspaces/dca` paths redirect to `/workspaces/backtest` with the corresponding strategy preselected for compatibility.

Strategies declare their input contract through `StrategySupportMatrix.required_tickers`, `BaseStrategy.get_default_tickers()`, supported execution intervals, optional execution-to-model interval overrides, causal signal bridges, and strategy-owned market-data hooks. The strategy registry carries the declared execution intervals into both the initial browser state and the strategy-fields response, so temporary data availability is never mistaken for permanent strategy capability. Backtest preserves the ordered ticker inputs, fetches their common local-history range for ordinary strategies, and passes a combined dataset to multi-asset strategies. The browser requests presence for the complete ordered required-ticker snapshot, intersects each interval's Period options across that set, and exposes `1m` only when the strategy declares it and every required ticker shares a real one-minute Period. A monotonic request token plus required-count and ordered-snapshot revalidation makes availability updates latest-wins after rapid ticker or strategy edits. A strategy-owned provider is called before visible-range slicing so it can retain a trailing training window without leaking future observations. When model and execution intervals differ, the strategy must declare a bridge; the runtime never treats a daily posterior as a native minute posterior. Strategies may opt out of the process result cache when their posterior depends on live factor snapshots. `leveraged-rotation` uses the first ticker as the primary and benchmark, defaults the pair to QQQ/TQQQ, and accepts any ordered primary/leveraged pair with aligned observations. Initial capital is divided among integer shares of both assets and cash. Its Return window maps Single day, 1 week, 1 month, and 3 months to 1, 5, 21, and 63 completed daily trading sessions and applies only to the primary-decline entry trigger. Minute execution retains those daily signals through the causal daily-close-to-next-session-open bridge. A primary drop across the window creates a next-open rebalance toward the primary minimum and leveraged maximum. That execution open becomes the leveraged entry basis; a later leveraged close that reaches the configured gain from this basis creates a next-open rebalance toward the primary maximum and leveraged minimum. The left Initial allocation boundary holds cash fixed and transfers only between the primary and leveraged assets; the right boundary holds the primary allocation fixed and transfers only between leveraged and cash. Percentage targets are market-value constraints before integer-share rounding, and no fee model is applied.

`BayesianPriceFieldStrategy` is a daily, single-ticker, Bayesian model whose default research ticker is `NVDA`. Its production model request uses the shared Price Field pipeline and the Longbridge CLI for forward-adjusted OHLCV, historical P/E, an opt-in current Dynamic P/E snapshot, daily volume, and daily option put/call volume and open-interest observations. The backward-compatible composite `Options` factor remains available, while independent opt-in controls expose the historical daily option put/call volume ratio, put/call open-interest ratio, call/put/total volume, and call/put/total open interest fields. All option subfactors share the one date-bounded `option volume daily` request and backward as-of merge; real-time-only contract quotes are not backfilled into historical rows. Selecting `1d` keeps the daily model and execution axes aligned and exposes the probability field. Selecting `1m` keeps the same causal daily model, refreshes only the required ticker's one-minute cache, then loads that file through a read-only path as the execution and equity axis. Refresh failure is reported before an existing cache may be reused; a missing cache fails closed. Daily intents and intraday bars are joined through the ticker exchange's local trading dates, not a global New York or UTC date. Each intent is placed on that session's final available one-minute bar, and the required `next_open` mode fills it at the next session's first available one-minute open. The bridge rejects missing, duplicate, out-of-order, or misaligned session mappings. The one-minute result intentionally omits the probability field rather than interpolating or forward-filling daily posterior values. When a selected daily Period exceeds the one-minute store, both server and client resolve it to the final actually supported one-minute Period, normally `max`, before execution.

The causal volume-at-price factor spreads each trailing Longbridge bar's volume uniformly across the fixed price bins intersecting its Low-High range, then records the current close's volume-weighted cumulative percentile; current `trade-stats` data is not rewritten into historical cost-basis evidence. Historical P/E and option observations join backward as-of with maximum ages of 14 and 7 calendar days respectively. Dynamic P/E is a separate opt-in `calc-index` snapshot bound only to its own market-local availability date, with a one-day maximum age, and is never backfilled across an earlier historical window. Optional research factors use Longbridge valuation history, capital flow, market temperature, shareholder and fund-holder reports, short-interest and short-volume reports, and HK broker holding history; each is disabled by default, fetched only when selected, filtered to dated observations, and joined backward as-of with a bounded 90-day staleness window. Snapshot-only values are never backfilled across a historical window. Quantitative-factor controls are registered once and sorted alphabetically; model parameters remain after the factor list. Every close-origin prediction targets `Open[t+1] -> Open[t+2]`, and training excludes the immediately preceding factor row until both opens required by its target are observable. Eligible factors are admitted sequentially only when they improve causal expanding-window Gaussian log score on identical validation rows after a one-parameter complexity penalty. Probability thresholds emit persistent buy or sell intent on every qualifying bar, while the backtest engine remains the sole owner of actual position state. The `Allow algorithmic stop-loss exits` switch is enabled by default; disabling it blocks a strategy sell or cover from closing below its entry price. This is a price-only gate that excludes dividends and total return, and it does not add a separate fixed-price stop. A rejected exit intent can therefore be attempted again on the next qualifying bar. Because walk-forward origins are independent, `Auto` and `CPU` use the shared bounded spawn process pool for sufficiently large workloads, keep small workloads inline, and fall back to an ordered thread pool when a process cannot be started; neither mode imports Torch. Only an explicit `GPU` request probes Apple MPS on macOS or CUDA on supported Windows/NVIDIA systems; an unavailable device or ordinary Torch failure falls back to NumPy CPU without changing the strategy contract.

Factor metadata keeps provider `status` separate from latest-origin `eligible`,
`selected`, and `selection_status` fields, so data availability is not
presented as evidence that a factor entered the posterior.

The current execution amendment supersedes the selectable-backend portion of
the preceding release paragraph: Bayesian no longer exposes a compute-backend
parameter. Its internal `Auto` policy probes for an available Apple MPS or CUDA
device and coordinates independent walk-forward origins between that device
and the bounded CPU executor. If no accelerator is available, it uses the CPU
executor; if accelerator execution fails, the complete pass is recomputed on
clean NumPy CPU results. Legacy browser-local or URL values for
`compute_backend` are ignored. When the process
explicitly disables remote market access, the strategy instead reads the
existing local daily market store for its OHLCV model input and marks
Longbridge-only factors unavailable; it does not synthesize factor values or
change the production Longbridge provider path.

The v1.26.0 model amendment supersedes the preceding one-step target, prior,
factor-selection, multi-step, and diagnostic wording. `Prior Strength` now maps
to a direct ridge penalty equal to its percentage of the standardized sample
information diagonal. Each origin also estimates a stable causal AR(1) return
state. The first-step factor-conditioned posterior evolves through that state
for every viewport-selected integer horizon, including mean reversion,
autocorrelation, innovation variance, and cumulative state covariance; the
renderer no longer applies frozen `h * mean` and `sqrt(h) * scale` diffusion.
The user-facing `Bayesian direction hit rate` is the observed 0-100% accuracy
of the 50% next-open direction decision, counting only non-flat executable
returns and non-neutral forecasts. Empty or all-neutral direction samples are
unscored. `Bayesian probability score` is the
bounded proper transformation `100% * (1 - mean Brier loss)`. Gaussian negative
log predictive density and CRPS remain research metadata and are not presented
as hit rates. The signal-close remains an explicitly declared display anchor
for absolute price cells; it is not the trading target or assumed fill price.
The shared `next_open` executor rejects a missing or nonpositive Open instead
of silently substituting Close.

The Longbridge factor provider is read-only and process-local. Aware provider timestamps and aware request boundaries are converted through the symbol market's timezone before they become naive local-trading-day midnights; relative provider windows also end on the selected ticker's market-local date rather than a global New York date. This keeps US, HK, SH, SZ, and SG daily OHLCV, P/E, Dynamic P/E, and option observations on the same causal date axis instead of shifting Asian midnight bars to the prior UTC date. Its factor bundles use a 32-entry, expiry-pruned LRU cache; concurrent requests for the same key share one in-flight CLI load, and cached status mappings are immutable. A strategy that declares a non-default market-data source must return a non-empty dataset list with `Date`, `Close`, and a matching `market_data_source` attribute. Missing, malformed, or source-mismatched strategy data fails closed and never falls through to the generic history provider.

`LSTMPriceFieldStrategy` reuses the Bayesian Longbridge factor pipeline, the executable `Open[t+1] -> Open[t+2]` target, `next_open` fills, and the shared 20-column probability-grid payload. Unavailable Longbridge factor columns are omitted rather than forcing every origin to fail closed, so the causal lag-return LSTM still emits a field when P/E or options history is missing. It trains a tiny causal LSTM at each origin on sequences that end at that origin and whose targets are already observable (`j <= origin - 2`). The NumPy LSTM uses the standard positive initialization bias on the forget-gate slice, matching the gate order used by its forward and backward passes rather than biasing the input gate. The one-step Gaussian mean and scale are converted to the same AR(1) multi-step field the renderer already understands. LSTM-only hyperparameters are namespaced (`lstm_lookback`, `lstm_hidden_size`, `lstm_epochs`, `lstm_learning_rate`, `lstm_seed`) so they cannot enter Bayesian cache keys. Compute backend `Auto` uses NumPy CPU for origin-local LSTM training. An explicit `GPU` request uses a confirmed Apple MPS or CUDA device only after a real tensor readback, then falls back to CPU. `Neural Engine` is reported only when Core ML compute-unit execution is confirmed. Torch, MLX, and coremltools are optional and are never imported at module load; a missing package falls back to CPU without crashing Backtest.

Signal strategies may return a JSON-safe `StrategySignalResult.presentation` dictionary. The backtest engine validates finite numbers and requires any presentation `data_keys` to match `chart.raw_dates` exactly before transmitting the declarative payload; strategy-owned HTML and executable code are never accepted. `bayesian-price-field/v1` and `lstm-price-field/v1` both supply aligned predictive log-return means and scales plus a fixed 20-column contract to `probability-grid-v1`. The renderer preserves strategy-owned bounded rows, preferred width, requested gap, padding, opacity exponent, and opacity-tail ratio while enforcing the product-owned 20 columns and 4 px minimum cell size. It derives one stable daily step `s` from the median positive Chart.js point spacing across the complete rendered series. Each column slot is an integer multiple `k × s` of that step and at least one trading day. The requested gap is an upper bound, not a reason to add a day to every column: the renderer chooses the smallest `k` that preserves the 4 px cell floor, then applies `effectiveGap = min(requestedGap, k × s - 4)`. The cell is `k × s - effectiveGap`, so all 20 squares retain stable square geometry. Autoregressive Price Fields use `k` as both the spatial and semantic forecast-horizon step, preserving exact chart-time mapping. Direct-horizon neural Price Fields instead use a semantic horizon step of one while retaining `k × s` as a presentation-only overview spacing: columns 1 through 20 therefore always consume the 20 separately learned distributions in both hover and detail, even on a dense multi-year chart. The preferred field width is one quarter of the price plot, but integer-day spatial quantization, the 20-column count, and the 4 px minimum cell size take priority when those constraints require a wider field. Overview rows use the live Y scale. The contained detail for a direct-horizon neural model instead builds a symmetric, selected-origin price domain from every learned horizon's 99% Gaussian envelope and recent observed prices capped at 1.5 times the forecast envelope. Its 20 row intervals are allocated directly across that domain, preventing a multi-year overview scale or one historical outlier from compressing forecast probability into a narrow band. This presentation transform does not change model means, standard deviations, cell probabilities, signals, or scores. The field has up to 10 independently bounded rows above and below the horizontal growth/decline boundary, uses a fixed 2 px logical gap, and places cells in a transparent, borderless, shadowless, non-blurred matrix with 8 px top, bottom, and trailing padding.

The probability field is not a Frosted Glass consumer. Its matrix is explicitly transparent with no background image, blur, border, or shadow; legacy 50%-transparent material values are retained only in the historical note below. Standard Frosted Glass tokens and every other material consumer remain unchanged. For one hover instant, let the finite clamped raw posterior cell masses be `p`, the maximum be `m`, and the selected absolute display threshold be `t`. Visible cells use `u = clamp((p - t) / (m - t), 0, 1)` and opacity `u ^ exponent`, with the existing default exponent 1.6 and unchanged green/magenta colors. The threshold always maps to the transparent/lightest endpoint, and the maximum always maps to full opacity. If `m = t > 0`, tied winners remain fully opaque; if `m < t` or all masses are zero, every cell is invisible. The standalone legacy contrast helper retains its relative-tail mode only when no absolute floor is supplied. The shared hover and detail renderers always pass the user-selected floor. Raw masses, geometry, titles, diagnostics, and scores are unchanged. The strategy-private Cell display threshold defaults to 1%, is bounded to 0–50%, and includes its exact boundary; below-threshold cells remain non-interactive and inaccessible. Cell opacity has no temporal CSS transition, preventing the prior hover's visible tail from leaking into the new instant. On desktop the field remains to the right of its vertical guide and retains one stable width while the pointer moves. On the narrow responsive chart-stage breakpoint, the same field is clamped in screen space to the stack's right edge when needed so all cells remain visible; this only changes the overlay offset, not the selected origin or probability-grid geometry. If its right edge exceeds the visible chart stack on a wider layout, the stack derives the exact missing floating visual distance `V` and reuses Motion Core's bouncy spring to reach it. The browser-native rail uses the sufficient integer physical offset `P = ceil(V)`; the controller applies `C = P - V` to both chart panels, the crosshair, the summary tooltip, and the probability tooltip, so their shared visual position is exactly `V` and their 1:1 curve/grid relationship is unchanged. Content-space calculations use `V`, not physical `scrollLeft`; a manual rail position may move left naturally, but its rightmost visual position clamps to the current exact target. Every Price Field hit test maps the pointer onto the visible curve and clamps that X to the first and last finite points, so the vertical guide cannot travel past the last trading day into the overflow field. The horizontal guide is the visible polyline intersection at that clamped X. Overflow pan is limited by the last curve point: the chart may shift left only until the vertical guide sits on that endpoint. Leaving the chart stack still clears both guides and the field. The native horizontal scrollbar exists only while that extent is needed and is absolutely positioned inside the existing 10 px Backtest section-resizer grid slot, without changing the measured chart-stack, Canvas, or probability-grid dimensions. The resizer remains keyboard-accessible and keeps a 2 px center hit strip above the native rail while the rail is active, so pointer drag and keyboard resizing continue to work without stealing the rail's lower hit area. The native surface never uses the accent scrollbar token. Returning to a fitting point, hiding the field, clearing the pinned state, or destroying the controller springs back to zero, removes the temporary extent, and restores the full resizer hit area.

The current `bayesian-price-field/v1` amendment supersedes the historical 36-column, six-row, transparent-material, and no-radius descriptions above. The renderer fixes 20 columns and limits each hover side independently to `min(10, floor(50% of the current plot height in complete cell slots), floor(the relevant chart-boundary distance in complete cell slots))`; the half-plot cap prevents edge-adjacent hover fields from consuming the entire plot. The contained Price Field detail surface uses the complete strategy-owned row counts without the hover boundary cap and scales them inside its own viewport. Grid cells use a fixed 2 px logical gap; the same 2 px inset separates the vertical guide from the first column. Overview cells map their top and bottom pixels through the live Y scale to exact price intervals. Detail cells for direct-horizon neural models use their independent adaptive price domain; other detail cells retain live-Y-scale intervals. Horizontal cells map to an integer number of trading days. The field therefore may span more than 20 days: the fixed count is columns, not forecast-horizon days. It has no cell or outer radius and uses an explicitly transparent, borderless, shadowless, non-blurred matrix with 8 px top, bottom, and trailing padding. The shared vertical resizer invokes the Backtest overlay refresh after Chart.js has resized, so a pinned or tracking field cannot retain a stale geometry frame. During native or visual probability scrolling, the pointer-defined crosshair is recomputed in the same frame as the overlay translation. Every chart layout refresh clears screen-space pointer coordinates before recalculating geometry, so viewport, sidebar, and resizer reflows cannot inherit a stale pointer anchor or overflowed field; the next real pointer event re-establishes both guides from the current chart bounds. This matrix has no dependency on Settings Frosted Glass tokens, and it never changes the price Canvas range.

The model diagnostics are independent of the viewport-quantized 20-column grid. Direction hit rate, Brier probability score, Gaussian log score, and CRPS score the single executable next-open-to-following-open outcome for each origin. None is a model feature, signal input, or cache key. Autoregressive browser columns may represent more than one trading day, and their probability masses come from the origin's fitted return-state transition rather than a frozen one-day diffusion. Direct-horizon browser columns always represent learned horizons 1 through 20; their wider overview slots are a legibility constraint, not horizon downsampling.

Durable LSTM GPU workers use `scripts/lstm_runtime.py` before starting a run.
The worker checks the current interpreter, an explicit configured runtime, the
project virtual environment, PATH interpreters, and standard macOS framework
installations. Only an interpreter with compatible project imports and a real
MPS/CUDA readback is selected. `WORTHWARD_TRAINING_PYTHON` is authoritative when
set. Process replacement preserves the worker PID and arguments, including stop
ownership; Auto and CPU retain the launching interpreter. Failure to find a
usable GPU runtime is explicit and never silently changes a GPU request to CPU.
Training startup and execution use the progress bar without a heading spinner.

Research-factor time semantics fail closed. The provider accepts real `published_at`, `available_at`, or equivalent disclosure timestamps; it does not use `filing_date`, report period, settlement date, `updated_at`, or a snapshot timestamp as a historical availability date. Until a source exposes a verifiable availability timestamp and a causal aggregation rule, capital flow, broker holding, shareholder concentration, fund-holder weight, short interest, and short volume report `unsupported_history` or `unavailable_point_in_time` and cannot enter the factor matrix. The safe historical research set is limited to P/B, P/S, dividend yield, and market temperature when they meet the timestamp rule. A GPU failure restarts the complete walk-forward calculation with a fresh NumPy float64 CPU backend; it never combines prior GPU rows with later CPU rows, and its presentation exposes the effective device, numeric precision, and fallback reason.

For vertical containment, the price scale uses the unmodified chart range while the grid clips to the existing plot area. At widths up to 767 px, the normalized presentation marks the result stack with `has-probability-field`; the shared result/history splitter measures `.trade-chart-stack`, reserves its 254 px stage minimum, and raises the complete result stack to a 600 px minimum. This preserves independent report, resizer, and history grid rows on a fresh narrow load rather than relying on a desktop split ratio. Pointer movement is coalesced to the next animation frame and tracks the curve; only a point with a finite prediction can be pinned. A primary pointer press pins the current curve origin immediately, covering trackpad press, mouse click, and touch tap; the synthetic click that follows that press is consumed once so the pinned frame is not rendered twice. Blank-space clicks and Escape clear it. Non-primary pointer presses remain available to the chart context menu, including Download SVG, while probability and standard summary overlays retain their source chart and recompute after chart, viewport, or sidebar layout changes.

All `/workspaces/*` pages use the `Canonical URL State Contract`: semantic query names, repeated values whose order carries meaning, omitted defaults, and one stable serialization order. Relative windows use `range=<period>`; custom windows use `range=custom` with `period` and either `date` or `from` / `to`. Workspace tabs and result pagination use `tab` and `page`. Legacy aliases remain readable and are normalized to the canonical form on page hydration or the next state-changing interaction.

Settings uses the same contract: the section is always the path in `/settings/<section>`, General language mapping uses `tab=history` when History is active, and General or Local Market Store pagination uses `page=<n>`. Current and page one are defaults and are omitted. Legacy `section`, `settings_section`, `language_tab`, `settings_tab`, `local_page`, and `language_page` aliases remain readable and redirect or hydrate into the canonical form. The container deployment uses these same Flask routes; there is no Docker-specific URL dialect.

All client-side pagination surfaces reuse the five-page chunk builder and shared
active-page indicator. A single-page result omits the pagination shell entirely.
Hidden-page range menus remain keyboard accessible and keep vertical scrolling
available within the calculated viewport range while delegating scrollbar
painting to the native browser surface.

Return comparison and Ticker comparison share ticker, relative-range, exact-date, and per-view session-memory infrastructure. Ticker comparison defaults to Price and retains the existing 5-ticker price-subplot contract; its `metric=market-cap` mode reuses the comparison controls and range workflow while allowing 10 tickers. Market-cap history is derived from authoritative cached prices and point-in-time Yahoo-reported shares outstanding, with SEC company facts and filing-level XBRL as rate-limit fallbacks. Funds without company-facts shares use SEC Form N-PORT net assets. For the latest trading day, Longbridge `mktcap` and `last_done` provide an independent implied-share cross-check and the preferred current point. Non-US market caps are converted at the same-date daily Yahoo FX close into the immutable USD base currency; the comparison axis remains America/New_York. The service records matched, review, or diverged status after normalizing comparable providers to the same price; missing pre-disclosure periods remain unknown, and current Longbridge shares are never backfilled into older dates.

Price and Market cap reuse one mounted sidebar form during same-page metric hydration. The selected metric, title, result main, Price-only chips availability, and 5-versus-10 ticker constraint synchronize from the returned canonical document without replacing the form or creating another document navigation. Metric intent is latest-wins: closing the progress dialog and selecting the other metric cancels the stale hydration token before starting the new request. Invalid ticker sets are rejected before mutating the selected metric, and a request that would move more than 5 Market cap tickers into Price stays in Market cap mode with a validation prompt rather than silently dropping the extra selections. The segmented metric shell exposes a radiogroup label and visible keyboard focus ring while retaining the existing elastic pill motion. A small pre-app navigation guard records comparison URLs and preserves the target workspace's remembered query if a user activates a workspace link during the page-script loading gap; once the full app binding is ready, the normal optimistic navigation path remains authoritative.

The Market cap canvas preserves every positive value as an absolute USD amount. When the visible positive maximum is at least 6 times the positive minimum, the Y scale becomes logarithmic so materially different capitalization tiers remain readable; a narrower span keeps the ordinary linear scale. Zero or negative placeholders mean unavailable history and are converted to Canvas gaps only at the presentation boundary. They are never rendered as a zero market cap or used to expand the logarithmic domain. Tooltip values remain absolute and currency-prefixed under both scale types.

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
reconstruction is explicitly labelled FIFO reconstructed in its transfer-basis
detail and remains separate from the selected buy/sell matcher shown in Stock
details.
When a broker performance snapshot is older than its position snapshot, the
browser reads the performance snapshot's own canonical broker-snapshot as-of
date to determine which later trades supplement realized P&L. The position
snapshot remains an inventory-validation boundary only. A newer position
snapshot must never suppress a trade that is later than the performance
snapshot.
When a broker provides a validated current-position snapshot, explicit order
history coverage, and a quantity-reconciling complete replay, the same engine
may attest realized P&L for open lots; rolling or incomplete histories remain
unverified.
The normalized Investment API emits one reconciliation record for every
broker/account/ticker scope. Each record carries `coverage_status`, independent
performance and position `as_of` boundaries, transaction-history coverage, and
the supplemental `replay` requirement and status. A performance snapshot that
needs later fills remains partial until the browser proves the replay; an
unavailable replay cannot be promoted to complete.
Holdings, Stock details, and historical timelines consume that same canonical
record, including its snapshot baseline, post-boundary increment, and dated
realized-P&L map. The reconciliation invariant is
`snapshot baseline + boundary increment = current realized P&L`, and the dated
map must sum to the same current value. The legacy ticker-level performance
fallback is compatibility-only and is eligible only when the sole account has
the same complete reconciliation and no replay requirement.
A `grant` always opens a zero-cost lot, regardless of broker. A source-reported
grant value remains immutable transaction evidence and cannot be replayed as a
purchase cost basis. This includes IBKR stock grants; separately evidenced paid
purchases retain their own net acquisition cost.
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

HSBC's posted USD Savings Ledger balance and current Portfolio position
snapshot remain the authoritative broker facts. The bank's Available balance
is separate audit evidence. Pending settlements remain a display projection,
are applied exactly once, and must not be treated as settled cash.

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
- A DKIM-authenticated HSBC execution-result email may provide a second-level
  notification-time proxy for a date-only order. The reconciliation must match
  the order identity, direction, ticker, and total quantity; settled-order
  price normalization may be audited separately and must not be mistaken for
  the email's notification time.
- When a prior import stored that email-derived proxy in Asia/Shanghai wall
  time, a later verified Gmail reconciliation may refresh all matching HSBC
  orders into the canonical America/New_York wall time without changing
  prices, settlement evidence, or booking dates.

## Investment equity replay contract

The Investment overview curve is a deterministic historical replay, not a
second broker balance ledger. Its accounting boundaries are explicit:

- The canonical replay order is the broker ledger booking date. Execution
  datetime, source row, and stable ledger identity are tie-breakers within the
  same booking date; an earlier execution timestamp must not move a row into an
  earlier equity day.
- A cash settlement or available-cash boundary is valid only on its own ledger
  date. A source row may retain a future settlement date as evidence, but its
  balance must not replace cash on the execution or booking day.
- Historical equity is settled bank cash plus signed pending-settlement cash.
  When an HSBC buy or sell has matched future SEC postings, each exact posting
  accrues as a payable or receivable on the trade's booking date while the
  position changes on that same date. The posting clears only at its own
  settlement boundary; settlement therefore transfers value between pending
  and settled cash without changing equity.
- Overlapping settlements are tracked by owner transaction and posting amount,
  not by sign. Settling one buy cannot clear a later buy's payable merely
  because both amounts are negative. An unmatched order uses the existing
  source-bounded provisional pending amount until evidence is available.
- A confirmed internal cash-transfer pair is cash in transit between its two
  legs. The history-only bridge may keep the curve continuous until the receipt
  is posted, including a documented currency conversion or fee difference.
  Transfer rows remain excluded from external funding attribution.
- The raw aggregate cash, current Holdings Cash, Cash equivalents, and Total
  equity fields represent actual broker-account balances. History-only bridge
  fields must never modify the current endpoint.
- Authoritative ending-cash and position snapshots are dated boundaries. They
  may calibrate a replay row only when that row's booking date is on or after
  the snapshot's explicit as-of date. The final chart point must reconcile to
  the current Holdings endpoint. If a current cash-equivalent quote is valid,
  both surfaces use that quote; the historical money-market anchor is only a
  fallback when no usable live price exists.
- A current broker cash snapshot may project onto the latest broker row for
  Holdings, but HSBC settlement-boundary corrections must use that row's
  pre-projection broker ledger. Current presentation state must never enter the
  historical aggregate correction base or cancel earlier settled proceeds.
- Daily security valuation uses an end-of-day close on a split-only basis and
  a dynamic end-of-day position converted to that same split basis. Reverse
  splits use a factor below one. Dividend cash stays in the cash ledger and
  must not be embedded in a total-return-adjusted price series.
- When local close history starts after a split, the earliest verified
  non-trivial factor applies backward to earlier position trades that lack a
  same-day close. This preserves a flat historical position as flat rather
  than creating phantom shares from mixed share bases.
- The Investment API checks each loaded daily cache against the earliest
  ledger date that requires that ticker's valuation. If an existing cache
  starts later, it requests one full historical refresh through the resolved
  lineage store. If the provider still cannot supply an earlier authoritative
  close, the affected point remains unavailable and the coverage failure is
  reported; no transaction price, remembered quote, or fabricated value is
  substituted.

The implementation lives in `app/web/static/assets/js/investment.js` and
`app/web/static/assets/js/investment/data-utils.js`; regression coverage must
assert both historical continuity and current-endpoint equality.

## Overview Tooltip P&L contract

Overview Tooltip P&L is a point-in-time tax-lot replay, not Equity less
funding flows. Each historical hover uses only ledger entries effective at that
point and its observed historical close. Current broker position and
performance snapshots have no historical as-of guarantee and must not alter a
historical point. The one live endpoint may reuse the current Holdings summary
so the two current surfaces reconcile. In every case, the Tooltip's Cumulative
P&L is recalculated from the realized P&L plus unrealized P&L displayed at that
point; incomplete basis or valuation evidence is shown as unavailable rather
than fabricated.

## High-precision Overview intraday equity valuation contract

The high-precision Overview curve (`1W` and `1M`) is a historical minute-close projection. It must
not interpolate prices or use a remembered transaction quote as a substitute
for market-close evidence.

- Each visible minute uses the latest replay snapshot that is effective at that
  minute. Holdings and display cash therefore change together when a trade
  becomes effective.
- A trusted normalized regular-session execution time becomes effective on the
  following one-minute point, after the source bar's close is observable. A
  date-only transaction, the project convention time `20:00:00`, and any
  pre-market, post-market, or final-minute record become part of the next
  trading-day opening state.
- For every held ticker, price is the latest positive one-minute close observed
  at or before the visible minute. The price is carried across sparse minute
  gaps. If the ticker has no usable one-minute row for that trading day, the
  latest available daily close on or before the valuation date is used. If
  neither price exists, the point is unavailable rather than valued at zero.
- Transaction prices, cached last-known prices, and broker snapshot prices are
  not historical closing-price fallbacks. Money-market anchors remain valid
  for their designated cash-equivalent positions.

During US overnight, pre-market, and post-market sessions, the high-precision
Overview ranges retain the completed regular-session minute curve. The current
extended-hours valuation is a separate far-right live point, and its total
equity must equal the immediate Holdings Total equity snapshot. A future
regular-session minute remains unavailable until that regular session starts.

## Longbridge performance-calibration contract

Longbridge HK and SG may supply an account-scoped, cumulative closed-position
P&L value when the local tax-lot history is incomplete. The value is explicitly
labelled `user_confirmed_broker_performance_calibration`; it is authoritative
only for that broker/account/ticker scope and does not imply an independently
reconstructed lot history or an account-balance snapshot. Calibration fixtures
remain synthetic and are kept out of user-facing documentation. Shared tickers
remain separate broker/account scopes before any all-broker aggregation.

The Longbridge paired-file importer retains both exact uploaded Fund Details
and History Orders files as SHA-256-addressed source artifacts in one bundle.
Those files prove the imported ledger and replay context, not the calibrated
P&L value. The broker P&L calibration itself has no invented as-of date or raw
report artifact. A future broker-native performance report must carry its own
source and replaces the complete fallback scope rather than blending the two
sets of values.

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
- For one IBKR account and trading day, authoritative file snapshots are selected
  by exact observed time before row completeness, so a later CSV or GainsKeeper
  observation cannot be replaced by an older manual app capture. The compatibility
  broker summary must mirror the same verified CSV interval-union performance
  snapshot, including only reconciled uncovered tails; it must not expose a
  separate closed-trade subset.
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
- Investment source evidence is immutable, SHA-256-addressed, capacity-bounded,
  and verified under the ledger lock at the import commit and persisted-readback
  boundary. Application startup and read-only ledger browsing intentionally
  require only the portable Parquet ledger; an explicit verifier checks the
  sidecar when evidence validation or a later import is required. A ledger
  manifest must never retain raw uploaded Base64 bytes.
- Each distinct source-artifact manifest digest maps to exactly one immutable `.bin` file at `investment_evidence_dir_for(parquet_path) / <sha256>.bin`; identical source bytes reuse that file. The evidence directory is derived from the ledger parquet path as `<parquet-stem>_evidence` and is not an independently configurable store.
- Historical sidecars may be recovered from an explicit broker-export archive
  only when both SHA-256 and byte count match the ledger manifest. The recovery
  command is all-or-nothing by default; its explicit partial mode writes only
  exact matches and leaves every unmatched digest visible to strict verification.
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
- HSBC Available cash calibrates cash-account rows, not individual unsettled order
  rows, and remains separate audit evidence. The posted Ledger balance is the
  authoritative USD cash boundary. The current display projection applies the
  source-bounded signed net of visible unsettled buy and sell orders exactly once.
  Unposted sell clearing-fee evidence is retained as unapplied metadata and remains
  excluded until a settled cash posting confirms it.
- All-brokers account-balance fields retain the aggregate broker cash ledgers and
  source-bounded pending buy/sell settlement amounts. Internal-transfer bridges are an
  external-flow attribution layer only; they must not subtract from the cash or
  equity balance displayed by Holdings.
- HSBC copy/paste and full monthly PDF imports preserve separate USD, HKD, and CNH cash ledgers. Each evidenced cash balance remains scoped by HSBC broker, account, account type, and currency until aggregation, so an RMB Savings zero cannot overwrite or offset USD Savings. A new balance boundary also removes same-currency replay deltas without verified subaccount scope, preventing stale trade cash from being double counted beside a later statement balance. An offshore-RMB statement label such as `CNY` is raw provenance only; the canonical HSBC currency is `CNH`.
- HSBC copy/paste first uses a read-only preflight. USD Savings remains a three-page composite, while a valid HKD/CNH cash-only page can commit without a Portfolio or Order Status page. Cash-only payloads have no position snapshot and merge per-account-kind cash components, so HKD Current and Savings can aggregate without replacing the current USD snapshot.
- Every accepted HSBC pasted page is retained as exact UTF-8 parser-input bytes
  in one fingerprint-addressed immutable evidence bundle. The Portfolio
  snapshot stores `market_value` as exact `quantity * last_price`, preserves the
  broker's compact rounded row value separately as `reported_market_value`, and
  reconciles the calculated position total to the exact Portfolio total when
  that total is present. A holdings mismatch against visible Order Status rows
  is labelled as a partial-history comparison; it does not invalidate the
  authoritative current Portfolio snapshot.
- HSBC monthly PDF imports accept one unordered bundle of full monthly cash statements, including a summary-only statement with no transaction history, while retaining the legacy composite-plus-Investment-services pair path. Full monthly cash rows carry per-currency balances and quoted conversion-rate provenance; paired investment rows still own security identity, and paired composite rows own reconciled USD cash. Historical statement snapshots cannot supersede a newer live paste snapshot.
- BOCHK imports accept one or more full Consolidated Statement PDFs per batch.
  The customer number is the parent account, while full deposit-account numbers
  and short subaccount identifiers remain source-scoped. HKD Savings and HKD
  Current remain distinct subaccounts; separate CNY/RMB (canonical CNH) and USD
  sections under one printed short marker remain separate cash ledgers, with
  that marker retained as raw provenance. The parser anchors the rightmost
  amount as the balance, reconciles each subaccount's running balance, rejects
  composite page-header continuations, and fails closed on non-zero securities
  cash activity because this adapter is cash-only. Its period/count/balance
  metadata is broker-scoped so it survives a mixed ledger.
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
- `app/web/strategy_forms.py`: pure shared-category strategy selector,
  parameter-field, and Settings catalog presentation builders. WebRuntime
  supplies the strategy factory while retaining request assembly.
- `app/web/style_token_rows.py`: pure Settings design-token presentation
  builders. WebRuntime supplies translated labels, the project display URL,
  and the Light / Dark theme mappings;
  the module has no request, storage, broker, or live-order dependency.
- `app/services/investment_record_basics.py`: shared import text, decimal, and normalized transaction-view helpers reused by `investment_import.py`.
- `app/services/investment_import_registry.py`: explicit broker and source-format parser dispatch plus the normalize, idempotent merge, atomic persistence, cache invalidation, and readback-verification boundary. Most legacy broker parsers remain in `investment_import.py`; the cohesive Zircon (HK) template and parser live in `zircon_hk_import.py`.
- `app/web/static/assets/js/chart-axis-utils.js`: shared stock-price label, chart tick-index, theme-token, and dynamic logo-URL helpers loaded from `base.html` as `window.WORTHWARD_CHART_AXIS` before consumer scripts. `formatStockPriceAxisValue` owns the project-wide stock-price precision rule. `readThemeTokens` resolves CSS custom properties, then explicit fallbacks, then `WORTHWARD_APP.theme`, then empty strings. `normalizeSafeImageUrl` permits HTTP(S) URLs and controlled local logo paths only; dynamic tooltip data is rendered through DOM properties rather than interpolated HTML. Existing consumers keep local fallbacks if the shared script is unavailable.
- `app/web/static/assets/js/export-image-config.js`: shared versioned export profile registry loaded before screenshot consumers. Settings previews and detached PNG exporters apply the same profile tokens and derived dimensions, while future exporters can register an isolated template profile through `window.WORTHWARD_EXPORT_IMAGE`.
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

### Historical Bayesian Price Field geometry amendment

This release note describes a retired renderer and is retained solely for
compatibility archaeology. It is not an implementation contract; use the
current detail-view contract at the top of this document and the current
strategy notes below. That renderer used 20 columns, a one-pixel requested gap,
2 px cell radii inside a 10 px outer radius, and a 50%-transparent private
material. It bounded rows only by the chart edge and did not apply the current
half-plot cap. Those historical values must not be copied into the current
transparent, fixed-two-pixel-gap matrix. The old renderer still mapped square
cells to live-Y price intervals and integer trading-day horizons, which is why
the note remains useful when interpreting archived screenshots or payloads.

CPU execution parallelizes independent causal walk-forward origins through
`app/infrastructure/parallel.py`. In `Auto` mode, independent origins are
coordinated between that bounded CPU executor and an available Apple MPS or
CUDA device; without an accelerator, `Auto` uses the CPU executor. Large CPU
workloads use a
bounded, reusable `spawn` `ProcessPoolExecutor`; each worker caps nested BLAS
threads at one so the process pool, rather than nested native thread pools,
owns CPU parallelism. Small workloads remain inline, and an ordered
`ThreadPoolExecutor` fallback handles environments where a process cannot be
started. The same primitive is used by the independent kNN/Lorentzian
prediction passes and Futu (HK) PDF parsing. Results are collected in input
order, so parallel scheduling cannot alter signals or introduce a future
observation. Network probes and Longbridge fetches retain bounded I/O threads;
cash replay, stateful SuperTrend recurrences, and signal finite-state machines
remain serial because their ordering is a causal/accounting invariant.
Explicit GPU execution remains serialized at the origin level because the selected
MPS/CUDA device supplies its own parallelism; a GPU runtime failure still
restarts the complete pass on CPU.

The `spawn` boundary is safe for the supported `main.py` launcher: a worker
recognizes the `__mp_main__` import and skips Flask construction, Longbridge
prewarm, and network bootstrap. WSGI imports and the normal CLI path retain
their existing application initialization behavior.

The post-hoc model diagnostics score the executable next-open direction and
return distribution. The UI exposes only the 0-100% direction hit rate and
bounded Brier probability score; raw Gaussian log score and CRPS remain
research metadata. None is a model input. Research-factor rows
require a verified availability or disclosure timestamp. `filing_date`, report
period, settlement date, `updated_at`, and snapshot timestamps are not accepted
as historical availability dates. Factors without that proof remain unavailable
to the model rather than being projected into the past.

## Quality-gate topology

`scripts/check.sh` is the single local and CI entry point. It runs Ruff,
JavaScript syntax checks, Python coverage, Node tests with source coverage, and
isolated Chromium E2E tests. `.github/workflows/quality.yml` invokes the same
script on pushes and pull requests, so CI does not maintain a parallel test
definition. The E2E launcher copies only Git-tracked logo assets into its
isolated runtime; it must not attach to an arbitrary existing server. CI retains
Playwright failure evidence when the browser stage fails.

## Known structural debt

`app/web/runtime.py`, the broker-specific parser collection in
`app/services/investment_import.py`, and the remaining Investment entry
composition are still large. Extend the parser registry and tested JavaScript
module boundaries instead of adding route-level dispatch or another cohesive
feature implementation directly to those files.

`tests/e2e/critical-flows.spec.mjs` is also an oversized aggregation point.
Place new coverage in domain-focused Playwright files for comparison,
portfolio, Backtest, Investment, Live Trading, or Settings behavior instead of
continuing to grow the shared critical-flow file. Splitting the existing file
requires a dedicated behavior-preserving change with an unchanged collected
test inventory.

## Shared component catalog, 8 Sep 2026

Style token rows and component CSS follow Shared UI Layout Contract v1.3.0.
Secondary button replaces the inverted-primary specimen with the intrinsic-width
agenticContext glass-chip action and has a 32px minimum height. The foundation owns
the 30px shared-select trigger, 36px shared-select option, and 30px strategy-stepper
heights; the 28px general numeric-input contract is unchanged. Options without media
use only check and text columns, so an empty media slot cannot truncate their labels.
The Settings rail uses the shared transparent monochrome icon treatment, Style tokens
uses the sparkles symbol, and the optional Beta Dock destination uses the same local
`sparkles.2.svg` asset in both projects. Style-token copy actions align to the global
theme action's right anchor.
Modal and notice dismiss controls reveal on owner hover or keyboard focus, and
remain visible for touch input. The obsolete Workspace article catalog row and
demo branch are removed, without deleting role-governed live page containers.
Responsive acceptance lives in tests/e2e/style-token-alignment.spec.mjs.
