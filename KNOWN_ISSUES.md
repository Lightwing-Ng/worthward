# Known issues and test-failure classification

Documentation version: `v1.50.0`

## Investment intraday hover and vertical allocation corrected on 18 Jul 2026

- In the 1W and 1M Overview curves, the allocation donut now uses the exact
  hovered minute's holdings valuation. Date-only ledger activity remains
  effective after the prior trading day closes, so it never appears before a
  recorded time supports it.
- The default Investment Overview and Transaction history split is now 50/50
  when both panels can accommodate their protected minimum content. The
  resizer still clamps either panel before it would hide the chart or the first
  three transaction rows.

## Realtime quote rate-limit recovery corrected on 16 Jul 2026

- An explicit Yahoo `YFRateLimitError` now stops per-ticker recovery and starts
  a 60-second realtime-quote cooldown. The 10-second Investment poll therefore
  no longer amplifies one batched limit into repeated requests for every holding.
- A recoverable batch transport failure no longer emits a warning before its
  individual requests succeed. Genuine non-rate-limit recovery failures remain
  visible as one aggregated warning without exposing network secrets.

## Material registry consolidated on 16 Jul 2026

- Settings now exposes only the canonical `Frosted glass` material. It retains
  the approved visual values that were previously staged under a temporary name;
  the Apple-specific and superseded baseline material families were removed.
- Tooltips, validation pointers, the responsive dock, workspace headings, and
  remaining glass surfaces now consume the canonical `--frosted-glass-*` tokens
  directly, with no compatibility alias or duplicate registry row.

## Trusted-LAN access and Live trading PIN gate added on 15 Jul 2026

- The default Flask bind now listens on `0.0.0.0:8688`, allowing another device
  on the same trusted local network to open the application through the host's
  LAN address.
- General workspaces, Investment, and Settings remain directly accessible.
  Live trading requires a 6-digit PIN before its page, account data, or browser
  order requests are available.
- The PIN unlock is stored in a signed, HTTP-only, same-site browser-session
  cookie and expires when that browser session or application process ends.
  The strong header token remains supported for non-browser API clients.
- The unlock screen reuses the centered full-screen frosted-glass dialog
  treatment. Its Apple-style PIN field has a visual 3-and-3 grouping, with an
  empty underline for each unfilled digit and an Apple-style bullet for each
  entered digit, while retaining the native numeric password input for form
  submission and mobile keyboard support.

## Scoped proxy resilience completed on 15 Jul 2026

- Yahoo Chart fallbacks, remote logo providers, and Network self-check probes
  now reuse one proxy-aware urllib opener with the same verified enterprise-CA
  bundle as yfinance.
- The policy is capability-based rather than location-based. A blocked optional
  website does not disable Yahoo, local caches, or unrelated application views.
- Process-wide TLS defaults, IBKR Flex, Longbridge OpenAPI, and SMTP transports
  remain unchanged.

## Ticker search and profile proxy trust corrected on 15 Jul 2026

- Ticker autocomplete searches and yfinance profile lookups now reuse the shared
  verified curl_cffi session created during runtime network bootstrap.
- Corporate HTTPS interception remains supported through
  `ANTIGRAVITY_YAHOO_CA_PEM` or `[network].yahoo_ca_pem`; certificate
  verification is never disabled.
- Certificate-failure logs include the existing enterprise-CA configuration
  guidance while redacting proxy URL credentials and sensitive query values.

## Direct Yahoo Chart fallback for stale 1-minute caches added on 15 Jul 2026

- Existing intraday caches now refresh with one recent 7-day window instead of repeatedly requesting the full 30-day range.
- When `yfinance` is rate-limited or returns no usable 1-minute bars, the bounded request falls back to Yahoo Chart directly before the optional Longbridge provider.
- The fallback preserves the local `America/New_York` regular-session storage convention and merges the new bars into the existing parquet cache.

## Longbridge browser OAuth configuration completed on 14 Jul 2026

- Settings > Broker access exposes Longbridge beside IBKR and changes the visible configuration fields when the broker selection changes.
- Longbridge authorization starts the installed CLI's local browser OAuth flow in a separate process. The web application neither receives nor persists authorization codes or OAuth tokens, and it reuses the signed-in user's existing CLI profile.
- Existing legacy API-key settings are preserved for backward compatibility but are no longer requested by the Settings interface.

## Longbridge market-cap cross-check added on 14 Jul 2026

- Longbridge `calc-index` supplies current `mktcap` and `last_done`; their quotient provides a same-timestamp implied total-share count without mixing live and closing prices.
- The latest trading-day market-cap point prefers that Longbridge share count. Earlier history continues to use point-in-time yfinance shares, and Longbridge's current snapshot is never projected backward.
- When both providers are available, the serialized series records the normalized percentage difference as `matched` at or below 2%, `review` above 2% through 10%, and `diverged` above 10%.
- The provider boundary reuses the existing Longbridge CLI and SDK adapters. User-level CLI OAuth is attempted first even when IBKR is the selected broker; configured legacy Longbridge credentials are the secondary path, and yfinance remains the no-Longbridge fallback.

## Exact-date year picker completed on 14 Jul 2026

- Selecting the month-year heading opens an animated, stable 3-by-4 January-to-December grid; choosing an available month returns to its calendar-day view.
- The picker derives its first and last years from the selected tickers' shared history. Every month remains in its normal grid position, while unavailable months and days are visually muted.
- Muted dates, months, and boundary year arrows remain physically activatable. They explain the limiting ticker's comparable-history boundary or the selected date's unavailable trading status instead of silently ignoring the interaction.

## Market cap comparison workspace added on 14 Jul 2026

- `/workspaces/market-caps` appears between Return comparison and Price performance and reuses the shared ticker, range-option, exact-date-picker, and hydration infrastructure.
- Historical market capitalization multiplies each authoritative market price by the latest point-in-time shares-outstanding observation known at that timestamp. It does not backfill periods before the first available disclosure.
- Reported shares use an isolated derived cache under `market_store/fundamentals/shares/`; existing historical price stores are not rewritten.
- Return comparison, Market cap comparison, and Price performance retain independent ticker and range selections in session memory. A destination with no prior state inherits the current comparison selection on first entry.

## Workspace range-option policy unified on 14 Jul 2026

- Return comparison, Price performance, Portfolio, DCA, Backtest, and Grid Trading now derive relative range options from one shared policy and one canonical period metadata source.
- Multi-ticker workspaces retain a requested horizon when any selected security supplies that history, leaving newer listings blank before their first authoritative record. `Max` continues to use shared history.
- Unsupported URL periods now resolve to an option that is actually rendered, preventing the calculation period and dropdown selection from diverging.
- Period labels and exact-range span metadata are serialized from Python to the browser instead of being maintained in a second JavaScript table.

## Date-picker viewport containment completed on 14 Jul 2026

- The shared exact-date picker now measures the complete popover and opens above a low trigger when the remaining space below cannot contain it.
- Popovers are clamped to the visual viewport on both axes and become internally scrollable on exceptionally short screens, keeping every calendar action physically reachable.
- Chromium coverage verifies that the low one-day trading-date picker remains fully inside a 720 px-tall viewport and that selecting a day commits the hidden canonical ISO value.

## Price subplot ordering and compact labels completed on 14 Jul 2026

- Price-performance subplot cards reveal the standard frosted-glass handle only while the pointer is in a card's right half, or while the keyboard-accessible handle is focused. This ordering variant omits the divider line and retains a 48 px touch target with safe-area clearance.
- Pointer and keyboard reordering highlight both the lifted card and its insertion boundary. The chart stack, ticker controls, application series, and URL ticker order update together with Y-axis translation and Z-axis depth motion.
- Reordering preserves existing Chart.js instances, aborts any obsolete in-flight live response, and never starts a calculation or live request by itself. The bottom time axis follows the newly bottommost subplot.
- Local symbol suggestions replace symbol-only cached names with canonical issuer names. `SKHY` therefore displays `SK hynix Inc.` even when an older local profile stores only `SKHY`.
- One-day cross-market session labels are measured and laid out inside the chart bounds with a minimum gap, preventing neighboring labels such as `02:30` and `04:00` from colliding.
- US pre-market and after-hours bars are now automatic in every one-day comparison containing a US security. The `Overnight` switch adds only the true 20:00–04:00 New York session.
- Historical Longbridge overnight requests use a bounded five-minute date window, avoiding the latest-1,000-candle truncation that previously removed the beginning of 13 Jul 2026. yfinance remains the preferred one-minute source for pre-market and after-hours bars, with Longbridge full-session data as the configured fallback.

## Yahoo corporate HTTPS proxy trust supported on 14 Jul 2026

- The yfinance transport accepts a corporate CA PEM through
  `ANTIGRAVITY_YAHOO_CA_PEM` or `[network].yahoo_ca_pem` in `config.toml`.
- The corporate CA is appended to certifi's public CA bundle for one shared
  curl_cffi session. TLS verification stays enabled, and other public HTTPS
  certificate chains remain trusted.
- When no corporate CA is configured, the secure curl_cffi default is retained.
  Certificate verification failures now identify both supported configuration
  entries without weakening process-wide TLS behavior.
- Proxy and direct-connect environments have separate offline regression tests.
  The Yahoo fallback never injects a proxy of its own, so computers without
  proxy environment variables continue to connect directly with `verify=True`.

## US overnight and extended-hours policy completed on 14 Jul 2026

- yfinance pre-market and after-hours bars are automatic and remain available on test machines without Longbridge, including Windows. A configured Longbridge source can fill those extended sessions when Yahoo is unavailable.
- The `Overnight` switch appears only when Longbridge can provide the unsupported-by-yfinance overnight session. A transient Longbridge failure leaves the automatic extended-hours curve intact and never claims that Yahoo supplied overnight bars.
- SKHY is the only user-visible identity. The yfinance fallback tries SKHY first and then the temporary SKHYV provider symbol without adding SKHYV to ticker controls, chart labels, or URLs.
- Neither provider's chart-specific frame is written into the production 1-minute market store.

## Active cross-market one-day date presentation corrected on 14 Jul 2026

- Relative `1 day` price comparisons still use the latest complete local session as a geometry reference, but a successful current-session refresh now moves that axis onto the live market-local trading date.
- The Price history date label and shared tooltip timestamps advance together, so current South Korea and Hong Kong bars no longer appear under the previous trading day. The heading follows the configured date format and adds the browser-local timezone abbreviation.
- The bottom axis remains a New York wall-time axis with compact clock labels. Market-local timezone abbreviations are reserved for the shared hover tooltip.
- Exact historical one-day selections retain their explicitly requested axis and are not relabeled as live data.

## Numeric ticker inference now requires confirmation on 14 Jul 2026

- A suffix-free numeric query such as `660` remains in the ticker field while matching market-qualified symbols such as `000660.KS` appear in the suggestion menu.
- Numeric padding and market selection are committed only after the user clicks a suggestion or confirms the active suggestion with the keyboard.
- Exact ticker text and explicit supported aliases retain their existing validation behavior.

## Investment split content-aware limits added on 14 Jul 2026

- The upper resize limit protects the equity chart stage itself, excluding the range selector, with a viewport-responsive minimum drawing height.
- The lower resize limit measures the rendered Transaction history header and first three data rows, so wrapped labels and taller transaction descriptions automatically receive enough space.
- When an exceptionally short viewport cannot satisfy both preferred limits, the two protected regions scale their discretionary height proportionally while retaining the existing emergency floor.

## TTM dividend cache completeness corrected on 14 Jul 2026

- A daily cache with a present but empty `Dividends` column is no longer assumed to contain complete corporate actions.
- A material step in the trailing adjusted-close ratio without a matching cash action triggers one full `yfinance`-first repair, restoring dividend-paying securities such as MSFT while leaving true non-payers unchanged.
- Isolated Parquet tests cover both the damaged dividend cache and a stable zero-dividend cache without reading or writing the production market store.

## Investment split viewport shrink corrected on 14 Jul 2026

- A user-adjusted Overview and Transaction history split now reflows from the workspace's actual available height after the viewport becomes shorter.
- The calculation excludes the title card, separator, padding, and grid gaps instead of reusing already-overflowing child heights.
- Chromium coverage drags the split to its lower limit, shrinks to a `922 px` by `773 px` viewport, switches to Holdings, and verifies that the complete Transaction history surface remains inside the workspace and viewport.

## Windows Yahoo daily-history fallback corrected on 14 Jul 2026

- A failed `yfinance` daily request now retries the authoritative Yahoo Chart endpoint through Python's standard-library network stack before considering the optional Longbridge fallback.
- Yahoo transport diagnostics are retained with URL credentials and secret query values redacted. An unconfigured Longbridge account no longer replaces the actual Yahoo failure with a broker-configuration instruction.
- The pinned `yfinance` and `curl_cffi` versions now match the current supported transport pair. Pulling source changes on another machine still requires reinstalling the pinned Python dependencies.

## Responsive investment surface split added on 14 Jul 2026

- The Style token width handle and the new Investment height handle now share one direction-aware resizer component with pointer, touch, and keyboard behavior.
- Both orientations reuse the canonical Frosted Glass material. The Investment separator remains visually hidden until hover, keyboard focus, or active resizing.
- Overview and Transaction history keep independent minimum heights, and a user-selected split is proportionally reflowed when the portrait viewport changes size.

## Investment import popover and scroll containment corrected on 14 Jul 2026

- The broker dropdown directly reuses the standard Frosted glass material, matching the shared popover treatment without a page-specific surface override.
- The import field stack is the sole vertical scroll owner. The overlay now sizes to its content until it reaches the viewport limit, then scrolls the field stack while keeping the action package immediately adjacent to it.
- The import overlay uses no physical shadow. The import E2E checks the popover material, bounded-scroll contract, mode-card height, and action-package alignment.

## HSBC authoritative import readback corrected on 14 Jul 2026

- Post-import verification now compares the committed merged transaction set with the authoritative store readback.
- A pasted HSBC dividend that is correctly absorbed by a stronger matching monthly-statement record no longer produces a false missing-record banner.
- Genuine persistence divergence still fails closed, while tests continue to use an isolated temporary investment store.

## yfinance-first market-data policy completed on 14 Jul 2026

- Free `yfinance` data is now the default for daily history, 1-minute history, extended-hours comparisons, and investment realtime quotes.
- Longbridge is contacted for market history only after the supported `yfinance` windows fail and only when broker credentials are configured.
- Batched realtime quotes retry every missing ticker individually, and partial responses are not cached as complete results.

## Unconfigured Longbridge market-data fallback completed on 13 Jul 2026

- Every public 1-minute history download path now falls back to bounded `yfinance` windows when Longbridge is unconfigured or unavailable.
- Daily history, current and extended-hours quotes, comparison charts, portfolio views, backtests, and investment valuation can operate without Longbridge credentials.
- This interim Longbridge-first policy was superseded by the `yfinance`-first policy recorded above. Both revisions preserve authoritative unknowns when no provider returns data and never fabricate market records.

## Comparison workspace memory added on 13 Jul 2026

- Return comparison and Price performance now remember their own ticker and range selections when users switch between the two workspace modes.
- The first switch into either mode inherits the current comparison query when that destination has no saved state yet. Later switches restore the destination mode's most recently used state for the current browser session.

## Korea–US market-time geometry corrected on 12 Jul 2026

- Cross-market one-day price comparisons now preserve every elapsed New York wall-time minute between the earliest and latest selected sessions. Closed-market gaps remain empty, so South Korea open, South Korea close, and US pre-market open landmarks keep their true spacing.
- Any one-day comparison containing a US security exposes the pre-market and after-hours control, including mixed-market comparisons.
- The SK hynix USD 149.00 first-day reference begins at 09:30 New York time and ends at the first normal trade. Axis labels show a currency code only on the top tick; KRW and JPY use zero minor units globally.

## Korea–US debut-day price comparison corrected on 12 Jul 2026

- One-day price comparisons between a Korean primary listing and a US security draw solid shared-session landmarks for the South Korea close and New York open. The landmarks reuse the standard session-divider stroke treatment.
- Cached quote profiles no longer trigger a remote connectivity probe before the page can render. Cross-market minute timestamps are converted with vectorized timezone operations, removing tens of thousands of per-row Python callbacks from a typical request.
- A newly listed US security remains blank before its first authoritative quote; the Korean close and New York open landmarks do not fabricate pre-listing prices.

## Cross-market one-day return comparison corrected on 12 Jul 2026

- One-day return comparisons spanning multiple exchanges render normalized-return lines on the shared market-time axis. They no longer hide those lines in favor of a same-market candlestick overlay.
- Same-market one-day comparisons retain candlesticks only when every selected series contains at least one drawable OHLC record. A length-matched but empty candlestick payload now falls back to visible return lines.
- The return-chart module initializes the canvas after registering its renderer, removing a startup-order race in which the application bootstrap could run before the chart module was available.

## Multi-market intraday landmarks added on 12 Jul 2026

- One-day price comparisons spanning Hong Kong, London, and New York draw shared solid vertical landmarks for London open, Hong Kong close, and New York open. These landmarks reuse the existing session-divider stroke treatment; the bottom subplot labels each landmark with its market-local time and timezone abbreviation.
- Shared hover tooltips retain one Settings-formatted HKT date, then list HKT and each distinct compared market timezone once. A different local calendar day is annotated with a signed day offset such as `EDT (-1)`.

## Price workspace startup stall corrected on 12 Jul 2026

- Chart.js, Luxon, the Luxon adapter, and the financial chart extension are now served from versioned local static assets. An unavailable external CDN can no longer leave populated price canvases permanently blank.
- Period-based 1D, 3D, and 1W price requests use the existing local intraday and daily stores for initial rendering instead of synchronously refreshing every selected daily cache. Live refresh remains asynchronous after the page becomes usable.

## SK hynix first-day price presentation completed on 12 Jul 2026

- Temporary `SKHYV` and future `SKHY` reuse the stored `000660.KS` butterfly SVG until a dedicated US listing asset is available.
- A one-day US comparison labels the bottom axis at the beginning, midpoint, and end with time above the Settings-formatted full date.
- The authoritative USD 149.00 previous close is preserved as a thin reference segment from its first-day marker to the first normal trade. Missing minutes remain unknown rather than being fabricated as market bars.

## Equal-width short intraday sessions corrected on 12 Jul 2026

- Price comparisons spanning 2–5 US trading days now use a canonical 09:30–15:59 minute axis for every selected day. A ticker with missing afternoon bars remains blank for those minutes instead of compressing that day for every series.
- The bottom subplot labels each trading date using the configured full-date format. Every subplot draws `N-1` shared vertical session dividers, covering 3D, 1W, and exact 2-day or 4-day ranges selected through the date picker.

## Price subplot tooltip time corrected on 12 Jul 2026

- The shared price tooltip now renders its date and time on separate lines. The date uses the full-date format selected in Settings, while the time converts the New York chart timestamp to Hong Kong time and uses the `HKT` market abbreviation.
- The implementation reuses the application date-display helpers and the existing chart tooltip market-time classes instead of maintaining a price-workspace-only date style.

## Broker-backed US overnight comparison added on 14 Jul 2026

- `yfinance` supplies pre-market and post-market minute bars but does not expose the US overnight session. Those extended sessions are always included; the concise `Overnight` switch adds broker-backed 20:00–04:00 bars when Longbridge is authenticated.
- Overnight bars remain chart-specific and are never persisted into the regular-session local market store. Longbridge CLI requests explicitly enable overnight access and request all trade sessions; the legacy SDK path selects the same sessions through its trade-session API.
- US bars at or after 20:00 New York time belong to the following trading date. This keeps the full SKHY overnight curve aligned with the corresponding South Korean and Hong Kong trading date instead of dropping the pre-midnight segment.
- `SKHYV` is canonicalized to `SKHY` on the overnight path. Selecting `000660.KS` can add SKHY as its known US overnight companion without adding the temporary symbol to the visible ticker controls or URL.
- SKHY and SKHYV share a local canonical issuer profile and the Korean primary-listing logo. Rendering the overnight comparison never waits for a remote Yahoo profile lookup merely to obtain display metadata.
- Exact one-day date constraints obtain SKHY's eligible trading dates from the authenticated overnight provider. Historical overnight retrieval is explicitly bounded to the selected trading date instead of using an incomplete latest-candle window.
- When an explicitly selected exact trading date already exists in a local 1-minute store, the page renders that cache immediately and leaves the existing live endpoint to append intraday updates. A synchronous yfinance refresh is retained only when the requested date is missing.
- Mapping a current target session onto an older common comparison axis also reuses the available target-day cache on the initial HTML response. The live comparison endpoint remains responsible for the network refresh after the page becomes interactive.
- Overnight date constraints, reference-axis loading, and target-axis mapping share one request-scoped broker frame. The cache is discarded at the end of the HTTP request and is never persisted as ordinary-session market history.
- Exact-day reference loading now checks each local 1-minute store before contacting Yahoo. The remote exact-day request remains a gap-repair fallback when the selected session is genuinely absent.

## One-day candlestick body fill corrected on 15 Jul 2026

- One-day price candlestick bodies now use the same opacity as their outlines. Bright comparison-series colors no longer make US overnight candles appear hollow while darker Hong Kong series appear solid.
- Candlestick width is derived from the shared one-day timeline rather than each ticker's number of observed bars. Sparse US overnight series therefore use the same body width as the Korean and Hong Kong subplots.
- The one-day candlestick policy is immutable and versioned. Browser coverage asserts its solid body style, shared-timeline width basis, common computed width, and `0.82` opacity contract.

## One-day candlestick series colors corrected on 12 Jul 2026

- One-day price candlesticks no longer introduce directional green/red coloring. Every subplot uses its ticker's single comparison-series color for both wicks and bodies.
- The colors come from the same blue-to-red token interpolation used by the return-comparison workspace: the first and last tickers use the endpoint tokens, while 3–5 ticker layouts receive evenly spaced intermediate colors.

## New US listing intraday completeness corrected on 11 Jul 2026

- A US IPO or ADR debut is no longer required to contain a 09:30 opening bar before it can participate in a one-day comparison. The latest shared observed trading day is accepted when no fully complete common session exists, and the shared axis remains empty before the security's first real quote.
- During the current US session, a validated ticker whose one-minute store has not received its first quote remains selected as a pending empty series. Once bars arrive, the normal live refresh fills that series without changing the requested period. This behavior is ticker-agnostic and covers temporary-to-permanent symbol transitions such as `SKHYV` to `SKHY`, as well as future US listings.
- A closed-session or pre-quote live response containing no valid prices is ignored, so it cannot erase the most recent valid debut-day chart.

## One-day price candlesticks and stale refreshes corrected on 11 Jul 2026

- The `1d` price-performance view now renders each ticker from its absolute one-minute OHLC values as a candlestick subplot. Longer intraday ranges remain line charts to preserve density.
- Live price refreshes carry a request generation and URL fingerprint. A delayed response for `3d` or `1w` can no longer overwrite a newly selected `1d` chart while leaving the control and URL unchanged.

## Short-range price interaction and formatting corrected on 11 Jul 2026

- Ticker-logo fallbacks use a neutral glass treatment rather than the application accent, and the application asset version is `v2.24.0` so JavaScript and CSS cannot remain on mismatched cached revisions.
- `3d` and `1w` requests append live minute data only while at least one selected market is in its regular session. Weekends and closed sessions no longer perform sequential, futile live refreshes for every ticker.
- Price axes and shared-tooltip prices use fixed `#,###.##` formatting, including trailing zeroes, with a widened fixed axis gutter for decimal alignment.
- Chromium coverage exercises `3d` to `1d` to `3d` transitions and verifies that both the URL and visible Period control reach the requested state.

## Price-performance optimistic hydration corrected on 11 Jul 2026

- Period and exact-date changes immediately open the standard centered frosted-glass progress dialog.
- The price-history heading, known date range, and current charts remain visible behind the dialog until the replacement result is ready.
- Price hydration replaces only the right-side results region. The left controls retain their original event handlers, so Period, Relative / Exact, and Add ticker remain operable after repeated updates.

## Price-performance controls and subplot density corrected on 11 Jul 2026

- Stacked price charts render date or time labels only on the bottom subplot. All charts retain the shared New York comparison axis and synchronized hover behavior.
- Ticker inputs try profile, PNG, and SVG logo sources in order. If every image source fails, a visible ticker monogram remains in the leading slot instead of an empty circle.
- Price-performance refreshes no longer replace the controls with pending markup. Range-mode changes made during an active hydration request are retained and submitted after the current request settles.

## Comparison selection and listing-window behavior corrected on 11 Jul 2026

- Clicking a ticker autocomplete candidate now commits the candidate before focus can leave the input and immediately reloads the workspace with that ticker.
- Relative daily periods use the requested horizon whenever at least one selected security has that history. Securities listed later remain blank before their first daily bar instead of shortening every established security to the newest listing date.
- `Max` retains the shared-history convention because it has no explicit requested start date.

## New ADR comparison handling added on 11 Jul 2026

- Price and return comparisons treat `SKHYV` and `SKHY` as ordered aliases for the same SK hynix ADR transition. The explicitly requested symbol wins when its cache exists; the alternate symbol is a compatibility fallback.
- A newly listed ADR may begin producing usable quotes after the regular-session open. Multi-day intraday comparisons preserve the established securities' full time axis and leave the ADR blank before its first quote instead of truncating every series to the ADR's first timestamp.
- A short-history constituent no longer removes an otherwise available `3d` or `1w` intraday option when another selected constituent supplies that full comparison window.

## IBKR test-fixture ledger leakage corrected on 11 Jul 2026

- Flask investment-import tests now patch both the investment parquet path and the derived transaction-cache path into a per-test temporary directory. They never write synthetic transactions into the real `settings_store/investment.parquet`.
- The persisted test fixture `1 Mar 2026 / U***TEST / QQQ / Buy 1 / USD 101 net cost` was never present in the authoritative broker exports. A running browser could briefly observe it only while an older integration test had replaced the real store.
- The production commit path rejects IBKR account identifiers ending in `TEST` or `E2E`, providing a second fail-closed boundary if test isolation regresses.

## HSBC pasted three-page snapshot boundary added on 16 Jul 2026

- HSBC USD Savings, Portfolio, and Order Status paste text is committed as one bundle with a persisted SHA-256 fingerprint and observable page-date metadata.
- Account mismatches and explicit temporal contradictions fail closed before the investment store is changed. A bundle without enough timestamp evidence is imported only with a `review` status and an explicit warning.
- Settlement lag remains valid: a fully executed order can be newer than the visible USD Savings posting and remains subject to the existing pending-cash replay path.

## HSBC paired monthly statement import added on 11 Jul 2026

- HSBC statement mode uses one multi-file input, identifies composite and investment statements from PDF content, and pairs them by statement end date.
- The client marks an upload set ready only when it contains an even number of PDF files with at least one pair; the server remains authoritative for statement type, account, holder, period, and reconciliation validation.
- Settled trades, closing holdings, transaction charges, and dividends come from the investment statement and must reconcile against the composite statement USD cash ledger before commit.
- Import success is reported only after authoritative store readback. The browser then requests that exact store version before presenting the final success banner.
- Ledger-price fallback tickers remain available as diagnostic metadata but no longer produce a user-facing warning banner when valuation is otherwise complete.

## HSBC pasted corporate-event payments corrected on 11 Jul 2026

- Positive `CORP EVT PAYMENT` rows from pasted HSBC USD Savings text are dividend income, not external deposits.
- Ticker attribution is accepted only when one locally cached dividend action matches the eligible pre-ex-date order quantity and the net cash amount under a supported retention rate. Ambiguous or unavailable matches remain unattributed dividends and surface a warning instead of guessing a security.
- HSBC cash-row merge identity is stable across this classification upgrade, so re-importing replaces a legacy deposit classification rather than duplicating the same ledger entry.
- Fully executed orders older than the first visible USD Savings cash row are no longer labeled as unsettled merely because their settlement rows have rolled off the pasted page window.

## Standard table and filter contract recorded on 11 Jul 2026

- Standard scrollable tables use the shared `table-controller.js`; empty, summary, and colspan rows are excluded from column measurement.
- Interactive header tables are accessible and distinct from the pointer-inert Frosted Glass visual overlay.
- Fixed summaries declare an explicit `all`, `filtered`, or `both` scope. Holdings currently use `all`; filtered tables can opt into the other scopes without changing the visual default.
- Investment History and Stock Details share an All / Buy / Sell side filter in the Type column. Broker and side filters compose before pagination.
- The Investment History Type header inherits the standard header typography, padding, and top alignment while idle. Its compact filter replaces the label only during hover, keyboard focus, or an open selection menu.

## SF Symbols 7.2 asset audit on 11 Jul 2026

- The host Mac provides SF Symbols 7.2 and readable system symbol alias and availability metadata.
- The deprecated `waveform.and.person.filled` asset name was migrated to the canonical `waveform.and.person` name.
- Grid Trading now has a distinct grid symbol. A maintained reserve list lives beside the SVG assets in `app/web/static/images/SF_SYMBOLS.md`.

## Grid trading workspace added on 11 Jul 2026

- `/workspaces/grid-trading` is a canonical, parallel Workspace route and locks execution to the `Grid Trading` strategy even if another strategy is supplied in the query string.
- The grid model supports SMA or EMA centers, center-line window, percentage spacing, and asymmetric buy/sell grid levels. It reuses the long-only single-position backtest engine; multi-position inventory sizing and live order placement remain outside this module's current scope.

## Apple 27 design alignment recorded on 11 Jul 2026

- Liquid Glass is reserved for the functional layer: navigation, floating controls, popovers, and transient overlays. Workspace content cards and Settings action packages use standard content materials without backdrop blur.
- Sidebar symbols use a consistent monochrome weight and inherit the app accent when selected. Fixed per-section color tiles were removed; destructive cache controls retain semantic red.
- The compact bottom navigation shows both symbols and visible labels on iPhone and narrow iPad layouts. macOS and wide iPad layouts retain icon-only controls with hover tooltips.
- The web UI reuses the repository's existing SF Symbols-derived SVG assets. Producing a distributable native app icon with Icon Composer remains outside the web runtime and is not emulated with CSS.

## Classification of the 31 Python failures found on 11 Jul 2026

| Test | Classification | Resolution |
|---|---|---|
| `backtest_page_limits_intraday_period_options_to_available_history` | Outdated route and Mock | Uses canonical route and forward-compatible history stub. |
| `backtest_page_serializes_logo_profile_for_selected_ticker` | Outdated route | Uses `/workspaces/backtest`. |
| `backtest_page_uses_default_ticker_when_query_is_missing` | Outdated route | Uses `/workspaces/backtest`. |
| `hsbc_merge_prunes_stale_available_cash_before_settlement_window` | Intentional product behavior | Order rows no longer receive synthetic available-cash calibration. |
| `hsbc_pasted_import_annotates_unsettled_orders_from_available_cash` | Intentional product behavior | Cash calibration remains on cash-account rows only. |
| `ibkr_grant_merge_dedupes_conflicting_quantities_for_same_lot` | Intentional product behavior | Authoritative position snapshot reconciles the final grant quantity. |
| `longbridge_import_fetches_large_ranges_in_windows` | Intentional product behavior | Order metadata uses 60-day windows and a 30-day lookback; cash flow uses 120-day windows. |
| `longbridge_import_retries_timeout_windows_with_smaller_ranges` | Intentional product behavior | Retry assertions now start from the metadata lookback window. |
| `replay_holdings_suppresses_same_day_buy_when_positions_grant_exists` | Intentional product behavior | Raw replay reports the mismatch; snapshot reconciliation performs correction separately. |
| `investment_transactions_skips_live_refresh_for_closed_tickers` | Intentional product behavior | US broker ticker aliases are normalized to bare symbols. |
| `investment_transactions_skip_spy_proxy_for_splg_price_history` | Intentional product behavior | Failure payload uses canonical `SPLG`, never the `SPY` proxy. |
| `investment_page_uses_context_page_title` | Outdated route | Uses `/trade/investment`. |
| `build_quote_profile_payload_uses_bare_symbol_for_us_broker_tickers` | Intentional product behavior | Payload ticker is canonical bare `TSM`. |
| `compare_page_checks_each_selected_ticker_for_fresh_daily_cache` | Outdated route and Mock | Uses canonical route and accepts policy keywords. |
| `portfolio_page_uses_the_same_freshness_checks` | Outdated route and Mock | Uses canonical route and accepts policy keywords. |
| `exact_range_markup_exposes_shared_date_roles` | Outdated routes | Uses canonical Workspace routes. |
| `ibkr_csv_import_merges_incrementally_into_investment_store` | Outdated API contract | Asserts the compact response `summary`, not removed duplicate investment data. |
| `import_prewarms_all_investment_tickers_not_only_open_tickers` | Outdated helper Patch | Patches `ensure_latest_investment_daily_caches`. |
| `investment_transactions_attempts_profile_fetch_when_logo_asset_is_missing` | Intentional product behavior | Missing identity assets now request a forced refresh. |
| `investment_transactions_refresh_open_tickers_via_shared_freshness_helper` | Outdated helper Patch | Patches the investment-specific freshness boundary. |
| `investment_transactions_skip_money_market_freshness_refresh` | Outdated helper Patch | Patches the investment-specific freshness boundary. |
| `legacy_invest_routes_redirect_to_more_investment` | Outdated redirect contract | Compatibility aliases now redirect to `/trade/investment`. |
| `more_investment_page_exposes_dual_csv_import_form` | Outdated route | Uses `/trade/investment`. |
| `more_investment_page_exposes_markdown_export_button` | Outdated route | Uses `/trade/investment`. |
| `more_investment_page_renders_from_more_section` | Outdated route and markup | Uses the Trade route and current card classes. |
| `more_timing_page_renders_after_storage_refactor` | Intentional product behavior | Removed Timing redirects to Investment. |
| `primary_workspace_pages_render_after_runtime_split` | Outdated routes | Uses canonical Workspace routes. |
| `frosted_glass_baseline_material_defaults_match_foundation_css` | Real regression | Runtime material default was synchronized with foundation CSS. |
| `loader_reads_foundation_root_tokens` | Intentional material change | Tooltip uses the canonical frosted-glass material. |
| `style_and_font_runtime_defaults_match_foundation_css_baseline` | Real regression | Runtime control and pagination defaults were synchronized with CSS. |
| `compare_portfolio_and_backtest_pages_keep_controls_inside_workspace` | Outdated routes, labels, and Mock | Uses canonical routes, current labels, and shared factories. |

## Open issues

- Browser requests show missing optional `HelveticaNeueforHSBCW84` WOFF2 assets; the committed TTF fallback loads successfully. This should be cleaned up or the missing assets should be supplied.
- Overall Python coverage is `46.2%`; the weakest modules are listed in `TESTING.md`.
- Core runtime and investment-import modules remain oversized and expensive to reason about.
- E2E currently covers Chromium only. Add WebKit when its rendering differences can be maintained without making the local gate excessively slow.
