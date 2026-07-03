/**
 * Investment transaction tracker frontend.
 *
 * Code version: v1.61.28
 * - Fixed: Investment stock-details helper import now revs to the pre-range overnight marker projection fix.
 * - Fixed: Investment stock-details helper import now revs to the no-dot intraday average-price line correction.
 * - Fixed: Investment stock-details helper import now revs to the intraday average-price event-stepped cost line update.
 * - Fixed: Investment stock-details helper import now revs to the overnight first-candle anchoring correction.
 * - Fixed: Investment entry module diagnostics now report the current loaded frontend file version after the stock-details intraday chart update.
 * - Changed: Stock details 1W now loads regular-session 1-minute candles independently of realtime polling so GKX intraday fills can be plotted precisely.
 * - Fixed: Investment history highlight cleanup now ignores empty cloned-row ids so post-import refresh cannot call querySelector("#").
 * - Fixed: Transaction history pagination now scopes history scroll and body lookups to the Transaction history surface so Stock details history tables cannot intercept updates.
 * - Fixed: Investment history pagination pointer handling now accepts browser pointerup events with neutral button codes, so coordinate mouse/touch clicks activate page buttons.
 * - Fixed: Investment history pagination binding now runs before heavier Investment view setup so page buttons remain interactive even if later initialization work is delayed.
 * - Fixed: Investment history pagination now handles pointer release directly as well as keyboard click, making page buttons respond reliably to real mouse and touch input.
 * - Fixed: Investment history pagination now preserves the shared Local store pagination bouncy indicator transition when changing pages.
 * - Fixed: Transaction history pagination now updates the real scroll table instead of the frosted underlay clone, and underlay table clones no longer duplicate DOM ids.
 * - Fixed: Scrollable investment overlay column syncing now preserves fractional body widths so per-column rounding cannot expand the fixed table past the shell.
 * - Fixed: Scrollable investment overlay tables now sync fixed cell border-box widths from body rows and assign the scrollbar track only to the final fixed cell.
 * - Fixed: Scrollable investment overlay tables now keep full-shell Frosted glass material while assigning the scrollbar track to the final fixed column only.
 * - Fixed: Scrollable investment overlay tables now use a shared content-width variable plus border compensation so rightmost fixed headers never occupy scrollbar tracks.
 * - Fixed: Scrollable investment table Frosted glass underlays now begin at the real scroll viewport edge, avoiding ghost rows at scroll top and restoring Transaction history header material.
 * - Fixed: Holdings table overlay now keeps a synced hidden body-table underlay behind the Frosted glass extracted header and summary material.
 * - Fixed: Investment view Metrics segmented pill now relies on the edge-cap geometry solver without a manual optical offset, keeping both the right cap and text center aligned.
 * - Fixed: Investment view segmented edge pills now lock their outer cap centers to the shell cap centers while preserving text-centered geometry.
 * - Fixed: Investment view segmented pill schedules a post-transition remeasure so active labels stay pixel-centered after final text layout settles.
 * - Fixed: Investment view segmented pill measurement now reads text-node ranges instead of the flex label box, aligning short labels to the actual rendered glyph center.
 * - Fixed: Investment view segmented pill positioning now uses the active label text range center, removing the last 1 px visual offset on Metrics.
 * - Fixed: Investment view segmented pills now center the blue highlight on the active label text for short labels such as Holdings and Metrics.
 * - Fixed: Scrollable investment tables now measure overlay header height dynamically so fixed summary rows never cover top rows.
 * - Changed: Community share PNG capture now uses a 1080 px by 1730 px 2x export shell grid.
 * - Changed: Community share PNG capture now reads export dimensions and footer sizing from the same CSS tokens used by the settings export-image preview.
 * - Fixed: Aggregate display cash no longer sums broker display balances, preventing internal-transfer bridge days from drawing zero-equity pits.
 * - Fixed: HSBC pending-settlement display cash now flows into Holdings cash, total equity, and realtime quote refreshes.
 * - Improved: Broker filter opens from cached ledger brokers without forced dropdown width measurement or first-click index rebuilds.
 * - Removed: IBKR manual Flex file upload mode from the import UI and submit path.
 * - Fixed: Measured segmented controls keep the selected item above the glowing pill and scroll internal items into view without moving the outer frame.
 * - Refined: Investment import help now gives GOV.UK-style guidance for IBKR CSV, IBKR GainsKeeper, and HSBC copy/paste imports.
 * - Added: IBKR GainsKeeper OFX/GKX multi-file import mode with idempotent precision upgrades for older CSV records.
 * - Fixed: IBKR CSV import now reports success as soon as the server commit finishes, then refreshes the large investment dataset in the background.
 * - Fixed: HSBC import validation now declares the selected statement/copy-paste mode before checking readiness, restoring Investment page initialization.
 * - Added: HSBC import mode now supports multi-file statement PDF upload for USD Foreign Currency Savings backfills while keeping copy/paste as the default path.
 * - Added: Investment Metrics now include Total offshore gain, combining holdings P&L with converted broker cash benefits without double-counting stock grants already inside holdings P&L.
 * - Fixed: Investment Metrics realized and cumulative P&L now exclude broker reward rows because broker benefits are reported in dedicated cards.
 * - Added: Investment Metrics now split broker benefits into coupon rebates, cash rewards, KOL rewards, and realized/unrealized stock-grant P&L.
 * - Fixed: Investment entry module version metadata now matches the loaded frontend file version.
 * - Fixed: Money-market Holdings icons now use an aligned green CSS-mask token instead of loading the black SVG fill through an img tag.
 * - Added: Cash-equivalent MMFs render as Holdings income rows with green dollar-token icons, while Franklin keeps its local fund logo.
 * - Fixed: Longbridge HK MMF transfers now replay as real cash plus synthetic cash-equivalent valuation anchors, removing saw-tooth overnight equity.
 * - Improved: Broker filter now uses a transaction broker index for large histories, avoiding full-list broker checks on every filter click while keeping options limited to brokers present in the loaded ledger.
 * - Refined: Tiger Trade and uSMART (HK) PDF import controls now reuse the shared bridge-field upload layout.
 * - Fixed: uSMART (HK) symbol-less fractional shares stay valued between purchase, withdrawal, and sale.
 * - Fixed: Tiger Trade Funds in Transit subscriptions no longer create false equity drawdowns.
 * - Fixed: Tiger Trade bond and money-market fund holdings retain statement-price equity between subscription and redemption.
 * - Added: uSMART (HK) and Tiger Trade statement PDF imports with multi-file validation and idempotent submission.
 * - Added: Broker-scoped Holdings P&L calibration keeps Longbridge HK and SG additive when both accounts are imported.
 * - Fixed: Investment Holdings now loads authoritative broker P&L calibrations from the refreshed data-utils module.
 * - Fixed: Longbridge HK money-market transfers preserve cash-equivalent equity through placements and recognize only redemption interest while retaining actual transfer amounts in history.
 * - Removed IBKR Gateway; added Flex Web Service v3 import mode and dry-run support.
 * - Fixed: IBKR forex trade component rows now dedupe across overlapping CSV imports and display the acquired quote currency with a compact conversion description.
 * - Fixed: Investment donut cash-equivalent tickers now keep their original holding order while using the standard cash-green token, and non-cash gradient colors are compressed around them.
 * - Fixed: Investment import broker dropdown refresh now stays idempotent, so selecting HSBC and other brokers is not broken by duplicate shared-select bindings.
 * - Fixed: Investment broker filter dropdown now sizes to its longest option instead of using a fixed narrow width.
 * - Fixed: Investment broker filter now unions payload and transaction broker codes and shows Longbridge (HK)/(SG) labels instead of identical logo-only tiles.
 * - Refactored: Broker filter dropdown always renders full names for every broker (matching "Longbridge (SG)" style) and uses fixed positioning + internal scrolling so the full list is reachable via scroll at any viewport height.
 * - Fixed: Investment stock-details helper import now revs to the broker metric split-factor hint scope fix.
 * - Fixed: Investment replay now passes rendered split-factor hints through ledger processing so zero-price grant rows share the same SPYM/SPLG quantity basis as sibling trades.
 * - Fixed: Versioned investment helper module imports so browser ES-module cache drift cannot keep stale SPYM/SPLG valuation logic after a git pull.
 * - Added: Loaded investment helper module versions are exposed on `window.ANTIGRAVITY_INVESTMENT_MODULE_VERSIONS` for automatic diagnostics.
 * - Fixed: Stock details metrics and price chart no longer fully re-render on realtime quote poll resets, so after-hours polling cannot blank metric cards or flicker the canvas.
 * - Fixed: Investment realtime polling and breathing pulse are disabled during New York post-market and on non-trading days.
 * - Fixed: Holdings Last always fetches open-position realtime quotes on page load and applies the latest US pre/post bar even when its session date is not today's New York calendar day.
 * - Fixed: Holdings Last now applies US post quotes from the prior session day and Hong Kong intraday quotes on their own market clocks during US after-hours.
 * - Fixed: Lineage profile lookup now uses exported data-utils helpers instead of an undefined local lineage-map reference.
 * - Fixed: Canonical lineage successors such as SPYM now inherit legacy ticker profiles so issuer full names remain visible after symbol-only subtitle suppression.
 * - Fixed: Investment ticker identity rows now resolve known issuer full names and hide duplicate symbol-only subtitles when no better label exists.
 * - Fixed: Investment holdings and overview chart now bootstrap yfinance pre/intraday/post quotes on first render instead of briefly showing the prior regular-session close.
 * - Fixed: Investment realtime quote application now only marks holdings and chart points when the quote session matches the active New York clock session.
 * - Fixed: Investment transaction descriptions now display canonical tickers, matching holdings and stock details.
 * - Fixed: Holdings, stock details, exports, and valuation replay now aggregate canonical investment tickers so MSFT.US merges into MSFT and SPLG.US inherits SPYM.
 * - Fixed: Investment cash replay now ignores IBKR FX Translation P&L accounting rows so broker cash stays aligned with the authoritative cash snapshot.
 * - Fixed: Investment cash replay now preallocates later same-currency funding to earlier broker-statement trades when missing intraday timestamps would otherwise create a false negative cash balance.
 * - Fixed: Investment history Max range and pagination now keep processed transaction caches current, so Gateway-ledger pages cannot render as empty while transactions exist.
 * - Added: Mixed-broker portfolios now calibrate each broker's latest history Balance from per-broker ending cash snapshots, so IBKR CSV Ending Cash can align with the broker app after HSBC merge
 * - Fixed: Investment export and share action buttons now align with the global theme toggle horizontally and the view segmented control vertical center.
 * - Fixed: Holdings Last now reuses the live digit-roll updater with green-up and red-down tone, and summary cash/equity values stay on the same realtime sync path.
 * - Fixed: Overview equity range switching now updates the chart in place so the segmented control is not destroyed and re-measured on every 1W through Max change.
 * - Fixed: Daily-equity live chart points now survive render-state preparation so 1M through Max can keep the is_realtime marker target needed by the breathing pulse.
 * - Fixed: Overview live-session slot, dedupe, shared-range extension, realtime polling chart writes, and breathing marker targeting now apply only to 1M through Max, leaving the specialized 1W intraday pipeline untouched.
 * - Fixed: Investment overview equity now keeps a single stable today slot during pre-market, regular, and post-market live sessions on daily ranges instead of appending a second same-day point that duplicated x-axis labels or shifted the plotted range.
 * - Fixed: Broker filter trigger now keeps a centered chevron in the resting state and no longer shows broker logos or placeholder tiles in the header cell.
 * - Improved: Holdings, Stock details, and Metrics live values now right-align integer digits, measure per-character slot widths, and animate only changed digit positions with easeOutCubic requestAnimationFrame rolls that avoid layout jitter.
 * - Changed: Investment metrics cards now add horizontal breathing room and right-align split metric values.
 * - Changed: USD funding metrics now omit the dollar sign because USD is the workspace default currency.
 * - Added: Investment metrics cumulative and unrealized P&L now reuse the Holdings live value updater during pre-market, regular, and post-market sessions.
 * - Fixed: Holdings and Stock details live value animations now reserve their measured maximum box so digit rolls do not resize surrounding table rows or metric cards.
 * - Fixed: Investment overview 1W now preserves the last healthy intraday equity curve when switching away and back from another range.
 * - Fixed: Investment overview 1W now rejects degraded flat recomputations so range switching cannot overwrite a real curve with a horizontal line.
 * - Fixed: Investment overview 1W ticker refresh requests now time out independently so one slow market-data source cannot block the whole chart.
 * - Fixed: Investment overview 1W now sends the exact five selected trading days to the intraday endpoint so missing days can be refreshed and returned.
 * - Fixed: Investment overview 1W now actively asks the intraday endpoint to refresh stale one-minute stores before calculating close-based equity.
 * - Fixed: Investment overview 1W now keeps successful ticker rows when another ticker's one-minute refresh fails.
 * - Fixed: Investment overview 1W now hides cross-day line segments so adjacent trading days can have factual gaps instead of forced joins.
 * - Removed: Investment overview 1W no longer keeps the unused flat-line fallback helper after switching to close-only intraday points.
 * - Fixed: Investment overview 1W now leaves a selected trading day blank when no local one-minute close data exists instead of drawing fallback flat steps.
 * - Fixed: Investment overview 1W now renders exactly five US trading days and only includes the current day while regular-session intraday is active.
 * - Fixed: Holdings live values now preserve the standard metric split-number layout during digit rolls so table rows do not jump while prices update.
 * - Fixed: Investment overview 1W now starts from an empty fixed intraday axis instead of briefly rendering the daily equity line before close-based data loads.
 * - Fixed: Investment overview 1W excludes the current New York calendar day before regular-session intraday begins.
 * - Fixed: Investment live metric updates now use a single in-place digit roll without rendering duplicate full-value spans or outside delta badges.
 * - Fixed: Investment overview 1W keeps blank intraday slots as null instead of coercing them to zero.
 * - Fixed: Investment overview 1W now leaves non-trading days and future intraday minutes blank unless at least one open holding has a real one-minute close for that slot.
 * - Changed: Investment overview 1W abandons candlesticks and renders a fixed five-trading-day intraday close equity line with 390 regular-session slots per day.
 * - Changed: Investment overview 1W applies dated trades and cash movements from the next trading-day open to match day-precision broker statements.
 * - Fixed: All investment share card titles and footer timestamps now use the Overview typography.
 * - Fixed: Stock details share cards now reserve the same 360 px chart height as the Overview share chart.
 * - Fixed: Holdings share cards now show the rendered summary row first and preserve view-colored P&L values.
 * - Fixed: Investment share footer brand icon and timestamp now share the same vertical centerline.
 * - Fixed: Investment share card titles now match the exported view instead of always rendering Overview.
 * - Fixed: Investment share donut previews now preserve satellite-logo safe bounds while using the available height.
 * - Fixed: Investment share footer now uses a 36 px brand icon and bottom-aligns the icon, timestamp, and QR code.
 * - Fixed: Investment share cards now apply the 108 px QR size in both template previews and all PNG export paths.
 * - Fixed: Overview share export now preserves identical curve coordinates when masking and replaces y-axis values with masked markers.
 * - Fixed: Holdings share export now eagerly resolves row logo assets and times out stalled screenshot encoding instead of leaving the output button busy.
 * - Changed: Investment share templates now align footer brand and QR sizing across all four exported views.
 * - Fixed: Investment share image capture now loads the screenshot renderer locally before falling back to CDN and reports stage timings.
 * - Fixed: Stock details intraday quote loading now stays off outside pre-market, regular, and post-market sessions.
 * - Fixed: Investment live values now stop polling and reset outside pre-market, regular, and post-market sessions.
 * - Fixed: Investment overview realtime pulse now only appears during pre-market, regular, or post-market sessions.
 * - Added: IBKR import feedback now reports incremental added and duplicate record counts
 * - Refined: Overview community share PNG export now redraws the equity chart on a share-card canvas so the curve uses the allocated height
 * - Refined: Overview community share PNG export now renders equity chart axis labels at 23 px
 * - Fixed: Overview community share PNG export now freezes donut satellite logos at their final orbit positions before capture
 * - Changed: Overview community share PNG export now uses the same 540 px token grid as the style-token preview
 * - Added: Investment share preview now renders the same community share card used by PNG export and refreshes across all four investment tabs
 * - Refined: Investment live values now show a transient signed delta badge while only rolling changed digit positions in the main value
 * - Added: Investment realtime quotes now update affected Stock details metric spans with the same live digit flip used by Holdings Last, Unrealized P&L, and weight cells
 * - Fixed: Share mask controls now stay expanded while masking is active so reveal/mask toggles remain clickable during repeated switching
 * - Added: Share masking now hides Investment overview y-axis numbers on the live chart and exported images without changing chart layout or point coordinates
 * - Refined: Investment overview realtime pulse now uses a calmer 1.8-second brokerage-style cadence with softer microwave opacity and glow
 * - Fixed: Investment overview realtime pulse now reserves enough chart padding so the right-side microwave rings are not clipped by the canvas edge
 * - Refined: Investment overview realtime marker now uses a strict 1-second pulse with a smaller solid-green contraction point and faster staggered microwave rings
 * - Added: Investment overview equity now appends a live yfinance 1-minute pre-market, regular-session, or post-market valuation point, polling every 10 seconds and marking the line end with a pulsing green ring
 * - Changed: Masked Holdings share cards now omit the `Shares` and `P&L` columns entirely instead of visually redacting stale table cells
 * - Added: Investment share actions now fan out to the right of the export button, let users mask stock-detail metric values as `***`, and save the currently visible panel as a local PNG screenshot
 * - Fixed: HSBC orders that carry matched bank settlement balances now reuse those authoritative post-trade cash snapshots, preventing impossible negative cash rows in the no-margin HSBC ledger
 * - Fixed: HSBC mirrored same-day settlement cash rows now stay in ledger replay but are hidden from Transaction history and Markdown export so trade-funding shadow deposits no longer masquerade as standalone events
 * - Refined: Investment fetch-abort debug reporting now uses the shared optional backend-provided config instead of a hard-coded localhost endpoint
 * - Changed: Investment page initial bootstrap now reuses the shared workspace modal dialog overlay instead of the floating import-feedback banner while data is loading
 * - Added: Stock details range segmented control now restores the 1Y option and adds an Auto window that keeps all buy and sell markers visible while trimming unrelated post-exit price history
 * - Refined: Stock details segmented control continues to reuse the shared nested range-label span markup while expanding to fit seven measured pill options
 * - Added: Initial investment page boot now shows the shared floating banner while transactions load, then clears it automatically once rendering finishes
 * - Refined: Internal-transfer link select now reuses the shared form-select styling, and the reference text matches the history table body size
 * - Added: Investment equity range segmented control now exposes a 1Y option between YTD and Max
 * - Refined: Resolved internal-transfer rows now show the bare HSBC reference in the history cell while the closed select displays a compact from HSBC label
 * - Refined: IBKR post-import feedback now renders as a numbered hanging-indent checklist and escalates immediate action when possible HSBC transfer links still need manual binding
 * - Refined: Manual internal-transfer rows now collapse into a compact resolved label, surface explicit USD currency evidence after linking, and expose an inline undo path inside the same select control
 * - Added: Mixed-broker investment history now supports manual internal-transfer binding for candidate deposit rows, with local persistence, unresolved pink prompts, and aggregate look-through cash bridging that removes duplicate-equity spikes between linked legs
 * - Added: Investment ledger rows now carry broker-scoped and aggregate valuation fields side by side, so mixed IBKR and HSBC imports keep per-broker Balance, Market value, and Equity without contaminating the combined portfolio panels
 * - Changed: Transaction history now renders broker-scoped valuation columns while Charts, Holdings, Stock details, and Metrics read explicit aggregate portfolio fields only
 * - Added: HSBC controlled browser bridge now includes an Edge-run dashboard collector that treats the HSBC Online Banking dashboard as the unified source for USD deposit and withdrawal records
 * - Fixed: Investment equity canvas now skips the synthetic pre-ledger starting-cash anchor, so the curve begins at the first real transaction row instead of the assumed 0.02 opening point while still extending forward across later valuation-only trading days
 * - Added: HSBC controlled browser bridge now closes blocking dialogs, opens Quick Trade in read-only mode, and captures cash-account buying power as authoritative cash without ever previewing or submitting an order
 * - Added: HSBC Order Status capture now proactively closes blocking dialogs before reading filters and pagination
 * - Changed: Authoritative broker position snapshots can now flow broker-supplied market values, last prices, and ending cash into the latest dashboard valuation
 * - Fixed: Investment equity canvas now keeps post-trade valuation dates in the rendered series, so the line extends from the last transaction day through the latest yfinance-backed trading day while holdings-linked hover anchors still target real ledger rows
 * - Changed: Investment equity canvas now rounds plotted values to the same 2-decimal precision used by the history table, so the curve starts at the first rendered total-equity value without hidden intermediate market-only micro-moves
 * - Added: Transaction history now uses the shared Local store pagination shell so large ledgers render a smaller DOM slice per page and switch faster
 * - Fixed: Stock detail and ticker identity displays now normalize Longbridge `.US` symbols to the short display ticker when rendering UI labels and fallback names
 * - Fixed: Stock details Average price cost curves now replay transaction unit costs onto the same split-adjusted price basis as the rendered chart, keeping split-affected tickers aligned without perturbing normal symbols
 * - Fixed: Stock details Markdown export now scopes the transaction-history section and metric snapshot to the currently selected ticker instead of reusing the full portfolio history table
 * - Added: Stock details price chart now renders a muted gray Average price cost curve, replaying ticker transactions onto every visible chart point so the line and tooltip match the point-in-time cost basis
 * - Refactored: Split chart-orbit helpers and transaction-valuation helpers into dedicated ES modules, keeping this entry file focused on page orchestration and reducing single-file context size
 * - Fixed: Restored missing cross-module orbit-state and position-state bindings after the split, so all investment view tabs render again without runtime ReferenceErrors
 * - Fixed: Stock details trade markers now infer cumulative stock-split factors from the rendered price series before mapping transaction fill prices onto the canvas, so older split-affected trades align with the chart without distorting normal unsplit fills
 * - Fixed: Stock details price-chart trade markers now wait for a stable visible chart box before first paint and resync again after the view-height animation settles, so hyperlink entry matches refresh rendering
 * - Fixed: Stock details tooltip now treats missing post-trade holdings keys as a flat position, so fully exited tickers no longer retain stale share counts on later hover dates
 * - Changed: Stock details share URLs now use the shorter `#stock_panel` hash while still recognizing the legacy long-form hash
 * - Fixed: Hover-linked history and stock-details tables now only auto-scroll their counterpart table, so the hovered table stays user-driven while the mirrored row remains visible
 * - Fixed: Holdings header table now compensates for the body scrollbar gutter, so numeric columns stay horizontally aligned with body cells even when the scroll state changes
 * - Fixed: Stock details price chart now keeps the same y-axis input domain across first paint and post-layout resync, so buy and sell triangles no longer jump vertically when opening a ticker view
 * - Added: Investment page now remembers the last visited view, stock-details ticker, and stock-details range in browser local storage, restoring bare `/trade/investment` visits back to the prior selection
 * - Changed: Stock details history table Realized P&L column now omits the USD dollar symbol while preserving numeric formatting and non-USD currency codes
 * - Fixed: Stock details buy and sell triangle markers now reserve horizontal in-canvas padding so edge markers no longer clip against the canvas boundary
 * - Changed: Stock details time-range segmented control replaces 1M with 3M and now filters by the natural prior 3-month window
 * - Changed: Stock details time-range segmented control removes the 1Y option and its matching date-filter branch
 * - Fixed: Segmented control measured-pill geometry now includes container inline padding in explicit width calculation, so the rightmost blue pill arc stays concentric with the outer shell and no longer clips
 * - Changed: Stock details now shows Average price instead of Buy cost so the metric matches the holdings average-price calculation
 * - Added: Stock details now uses local 1-minute OHLC candlesticks for the 3D and 1W ranges, auto-refreshing and storing missing intraday cache via the existing market-store pipeline
 * - Added: Stock details price chart now shows a right-aligned in-canvas time-range segmented control with 3D, 1W, 3M, YTD, and Max filters that reuse the shared pill animation
 * - Fixed: Stock details price chart y-axis now ignores shared-range gap points so sparse ticker histories no longer collapse toward zero
 * - Fixed: Stock details price chart now reuses the shared investment chart date range so every ticker keeps the same x-axis span as the main equity canvas
 * - Added: Stock details overview now includes a middle price chart card that plots the selected ticker close series with buy and sell triangle markers
 * - Fixed: Charts portfolio donut hover now coalesces duplicate updates and reuses cached orbit geometry to avoid flicker and animation stutter
 * - Improved: Charts portfolio donut satellites now enter from a distant transparent orbit, move along the shared orbit with non-linear angular easing, and resolve tiny-slice crowding with constrained on-orbit spacing
 * - Changed: Stock details donut now uses scoped non-linear orbit animation for its ring and ticker satellite while keeping the selected ticker on the standard blue token and cash on the standard green token
 * - Changed: Stock details donut is now decoupled from the Charts donut and renders a three-part allocation view for the selected ticker, cash, and remaining equity with hover-linked snapshot updates
 * - Fixed: History and stock-detail tables now respect recent manual scrolling, so hover-linked auto-scroll no longer snaps the view back to an older row while the user is browsing another date
 * - Added: Stock details transaction history now shows a per-row Market value column based on post-trade holdings times the same-day close, with flat positions rendered as '-'
 * - Improved: Investment Markdown export now reads the rendered Metrics panel so exported metric rows stay fully aligned with the page
 * - Added: Investment Metrics now include cumulative, realized, and unrealized P&L summary cards sourced from Holdings totals
 * - Fixed: Holdings weight column now uses the latest valuation-point total equity, so unlevered accounts no longer show allocations above 100% when the last trade date lags the latest 1d close
 * - Fixed: Investment Metrics no longer show false panel scrollbars when tooltip content extends beyond metric cards
 * - Added: Investment Metrics now include total commission and interest charged, and loss-like values render with explicit negative signs plus the shared negative color token
 * - Improved: Stock details metric cards now reuse the same negative-value treatment for total commission and align to the shared responsive metric grid pattern
 * - Fixed: Shared investment theme resolution now lives in page scope, so refresh no longer throws `resolvedTheme is not defined`
 * - Fixed: History-row and chart hover now preview matching stock-detail rows without overwriting the user's selected ticker
 * - Fixed: Holdings ticker clicks now use controlled stock-details hash syncing instead of native anchor jumps, so view state and scrolling stay aligned
 * - Fixed: Investment valuation now consumes bundled price history from the primary transactions payload, reports degraded states explicitly, and avoids per-ticker N+1 refresh fetches during first render
 * - Removed: Legacy manual-entry selector and transaction-form branches that no longer match the current Investment template contract
 * - Improved: Investment chart hover now scrolls the full same-day Transaction history row group into view instead of centering only the first matching row
 * - Added: Investment segmented control now appends a fourth "Stock details" view with same-page holdings links and animated pill focus
 * - Added: Stock details view now shows a selected ticker identity block, a standard donut shell, and a per-ticker detail table with realized P&L per transaction
 * - Improved: Trade effective price and realized P&L calculations now account for separate commissions in manual buy and sell rows
 * - Added: Settings action button import flow now exposes explicit disabled and in-progress states, including present-participle copy while the task is running
 * - Changed: Investment Charts now render one equity point per market day, filling no-trade trading days from parquet closes and collapsing same-day multi-trade activity into a single daily close snapshot
 * - Changed: Non-trading days with investment ledger activity now render on the curve using the previous available market close, while hover only anchors to history rows on dates that actually have ledger activity
 * - Fixed: Investment equity canvas now respects responsive container width at medium breakpoints instead of overflowing around 900 px layouts
 * - Fixed: Investment equity tooltip now uses viewport-safe positioning so frosted glass popovers no longer clip against ancestor overflow or screen edges
 * - Added: Charts hover now anchors and highlights all same-day Transaction history rows via the shared metric-style history locator
 * - Added: Holdings row hover now anchors and highlights the latest matching Transaction history row for that ticker via the shared metric-style history locator
 * - Improved: Metric, chart, and holdings interactions now share the same history-row highlight lifecycle and clear hover state on exit
 * - Fixed: Investment template, CSS, and JS now share the same chart-surface container contract again via investment_view_surface
 * - Improved: Transaction history rows now render through reusable cell classes instead of per-cell inline styles
 * - Improved: Holdings logos now use delegated fallback handling instead of inline onerror handlers
 * - Improved: Funding metric cards now render from a shared definition list instead of repeated hard-coded markup
 * - Fixed: Transaction processing no longer mutates the original API payload order while building the ledger view
 * - Fixed: Holdings header spelling now uses "Realized P&L"
 * - Reduced: Investment page accent colors now resolve through theme tokens instead of repeated hard-coded hex values
 * - Fixed: Holdings now keep a stable logo slot, so missing or failed ticker logos no longer break row alignment
 * - Fixed: Investment transaction payload now retries profile-based logo resolution when a local logo asset is missing
 * - Updated: Import feedback now appears as a top floating modal-banner notice with iOS-style drop-in motion
 * - Fixed: Import feedback copy no longer repeats the success prefix returned by the backend
 * - Updated: Investment segmented control now shows "Charts"
 * - Added: Export the Holdings and Transaction history tables as a Markdown download from the page header
 * - Fixed: Investment equity curve now starts from the first real transaction point instead of a synthetic zero-value seed
 * - Improved: Investment equity tooltip now shows equity, market value, and cash from the processed ledger snapshot
 * - Updated: Investment equity hover guide now matches the compare chart vertical hover line behavior
 * - Updated: Investment equity series color now resolves from the shared theme accent token
 * - Reworked: Holdings view now renders as a scrollable data table with per-ticker cost basis and P&L metrics
 * - Improved: Holdings and Metrics data now consistently use the Workspace metric value token
 * - Fixed: Investment view segmented control now switches cleanly between Chart, Holdings, and Metrics
 * - Fixed: Equity curve only renders inside the Chart view instead of bleeding into other tabs
 * - Fixed: Dashboard rendering no longer crashes on undefined transactions or parquet scope references
 * - Fixed: Total Equity calculation uses historical close prices from parquet files instead of latest prices for each transaction date
 * - Improved: Investment equity curve now reuses the shared chart tooltip tokens and layout
 * - Fixed: Equity curve seeds a zero-value point on the prior day when the first transaction starts above or below zero
 * - Adjusted: Investment chart panel better fills the available card height in Chart view
 * - Updated: Transaction history description format to TICKER@quantity for buy/sell operations
 * - Fixed: Cash calculation logic for payment_in_lieu and foreign tax withholding transactions
 * - Improved: Adjusted transaction table column widths for better readability
 * - Renamed: "Tax withholding" → "Foreign tax withholding" (value: tax_withholding → foreign_tax_withholding) for consistent naming
 * - Improved: Toggle button now switches plus/minus icons via reusable CSS classes
 * - Fixed: Transaction table header uses opaque background (var(--panel-strong)) instead of semi-transparent glass for better text readability
 * - Adjusted: Finalized transaction table column widths and min-widths per layout requirements
 * - Fixed: Added backward compatibility - normalize space-separated type names to snake_case for existing imported transactions (e.g., "foreign tax withholding" → foreign_tax_withholding)
 * - Improved: Show '-' instead of 0.00 in Commission column for transaction types that don't normally have commission (foreign tax withholding, dividend, adjustment, debit interest, payment in lieu, dividend reinvestment, forex trade, deposit, withdrawal, credit interest)
 * - Fixed: Investment history table now keeps the scrollbar below the rounded header and stays bottom-aligned with the sidebar
 * - Fixed: Add transaction form now reuses the standard controls and action button styling
 * - Improved: Add transaction form offset now follows the measured form height instead of hard-coded pixels
 * - Fixed: Grant transactions now add shares without affecting cash, while history still shows their economic amount
 * - Fixed: Holdings average price now uses out-of-pocket cost, so grant lots dilute cost per share instead of adding cost basis
 * - Fixed: Grant descriptions now use the standard TICKER @ PRICE x QTY transaction format
 * - Updated: Holdings summary row now colors only the cumulative P&L value, keeping the label text neutral
 * - Reworked: The investment import form now accepts the two IBKR CSV exports instead of manual transaction entry
 * - Added: Import feedback now spells out that the server discards raw CSV files after in-memory processing
 * - Improved: Empty transaction history now shows a compact guided import state with inline plus icon and width protection
 * - Updated: Import feedback now uses the standard modal dialog banner message token instead of the legacy modal dialog block
 * - Fixed: IBKR deposit rows no longer invent a USD currency when the CSV does not prove one
 * - Fixed: Forex Trade Component rows now render a precise English description and show the destination currency
 * - Refined: Deposit rows now describe the amount as a USD-equivalent credit when the source CSV only proves the base value
 * - Refined: Forex Trade Component rows now use compact trade-style wording and always display the acquired currency
 * - Fixed: Investment view segmented pill now stays hidden until the active label is measured, preventing the loading-time stretched Charts highlight
 */

import {
    INVESTMENT_CHART_ORBIT_MODULE_VERSION,
    getInvestmentDonutOrbitAnimationState,
    getPortfolioDonutOrbitMetrics,
    registerInvestmentChartHelpers,
    renderInvestmentDonutOrbitLogoPosition,
    syncInvestmentDonutOrbitLogos,
} from './investment/chart-orbit.js?v=investment-chart-orbit-v1.36.2';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    createInvestmentDataUtils,
} from './investment/data-utils.js?v=investment-data-utils-v1.47.7';
import {
    INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
    createInvestmentStockDetailsUtils,
} from './investment/stock-details.js?v=investment-stock-details-v0.2.12';

window.ANTIGRAVITY_INVESTMENT_MODULE_VERSIONS = Object.freeze({
    entry: 'v1.61.28',
    chartOrbit: INVESTMENT_CHART_ORBIT_MODULE_VERSION,
    dataUtils: INVESTMENT_DATA_UTILS_MODULE_VERSION,
    stockDetails: INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
});

registerInvestmentChartHelpers(window);

document.addEventListener('DOMContentLoaded', () => {
    const theme = window.ANTIGRAVITY_APP?.theme || {};
    const fetchAbortDebugConfig = window.ANTIGRAVITY_APP?.debug?.fetchAbort || null;
    const reportInvestmentFetchAbortDebug = (hypothesisId, location, msg, data = {}, runId = 'post-fix') => {
        // #region debug-point C:investment-fetch-abort
        if (!fetchAbortDebugConfig?.url) return;
        fetch(fetchAbortDebugConfig.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: fetchAbortDebugConfig.sessionId || 'frontend-fetch-aborts',
                runId,
                hypothesisId,
                location,
                msg: `[DEBUG] ${msg}`,
                data,
                ts: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
    };
    const resolveInvestmentTheme = () => {
        const computed = getComputedStyle(document.body);
        const themeTextColor = String(theme?.text || '').trim();
        const themeMutedColor = String(theme?.muted || '').trim();
        const themePrimaryColor = String(theme?.accent_primary || '').trim();
        const themeSecondaryColor = String(theme?.accent_secondary || '').trim();
        const themePositiveColor = String(theme?.accent_positive || '').trim();
        return {
            text: computed.getPropertyValue("--theme-text").trim() || themeTextColor,
            muted: computed.getPropertyValue("--theme-muted").trim() || themeMutedColor,
            accentPrimary: computed.getPropertyValue("--theme-accent-primary").trim() || themePrimaryColor,
            accentSecondary: computed.getPropertyValue("--theme-accent-secondary").trim() || themeSecondaryColor,
            accentPositive: computed.getPropertyValue("--theme-accent-positive").trim() || themePositiveColor,
        };
    };

    const toggleBtn = document.getElementById('toggle_form_button');
    const formContainer = document.getElementById('transaction_form_container');
    const historyTable = document.getElementById('history_table_wrap');
    const investmentHistorySurface = document.getElementById('investment_history_surface');
    const investmentForm = document.getElementById('investment_form');
    const importFeedback = document.getElementById('investment_import_feedback');
    const importFeedbackMessage = document.getElementById('investment_import_feedback_message');
    const importFeedbackIcon = document.getElementById('investment_import_feedback_icon');
    const workspaceModalOverlay = document.getElementById('workspace_modal_overlay');
    const workspaceModalOverlayTitle = workspaceModalOverlay?.querySelector('.workspace-modal-title');
    const workspaceModalOverlayCopy = workspaceModalOverlay?.querySelector('.workspace-modal-copy');
    const workspaceModalOverlayIcon = document.getElementById('workspace_modal_overlay_icon');
    const workspaceModalOverlayClose = document.getElementById('workspace_modal_overlay_close');
    const transactionsCsvInput = document.getElementById('transactions_csv');
    const positionsCsvInput = document.getElementById('positions_csv');
    const gainskeeperFilesInput = document.getElementById('gainskeeper_files');
    const gainskeeperFilesStatus = document.getElementById('gainskeeper_files_status');
    const investmentImportBrokerSelect = document.getElementById('investment_import_broker');
    const transactionsCsvStatus = document.getElementById('transactions_csv_status');
    const positionsCsvStatus = document.getElementById('positions_csv_status');
    const importSubmitButton = document.getElementById('investment_import_submit_button');
    const investmentImportNote = document.getElementById('investment_import_note');
    const investmentImportIbkrFields = document.getElementById('investment_import_ibkr_fields');
    const investmentImportIbkrMode = document.getElementById('investment_import_ibkr_mode');
    const investmentImportLongbridgeHkFields = document.getElementById('investment_import_longbridge_hk_fields');
    const investmentImportLongbridgeSgFields = document.getElementById('investment_import_longbridge_sg_fields');
    const longbridgeSgFundDetailsInput = document.getElementById('longbridge_sg_fund_details_txt');
    const longbridgeSgHistoryOrdersInput = document.getElementById('longbridge_sg_history_orders_xlsx');
    const longbridgeSgFundDetailsStatus = document.getElementById('longbridge_sg_fund_details_txt_status');
    const longbridgeSgHistoryOrdersStatus = document.getElementById('longbridge_sg_history_orders_xlsx_status');
    const longbridgeHkFundDetailsInput = document.getElementById('longbridge_hk_fund_details_txt');
    const longbridgeHkHistoryOrdersInput = document.getElementById('longbridge_hk_history_orders_xlsx');
    const longbridgeHkFundDetailsStatus = document.getElementById('longbridge_hk_fund_details_txt_status');
    const longbridgeHkHistoryOrdersStatus = document.getElementById('longbridge_hk_history_orders_xlsx_status');
    const investmentImportFutuhkFields = document.getElementById('investment_import_futuhk_fields');
    const investmentImportHsbcFields = document.getElementById('investment_import_hsbc_fields');
    const investmentImportHsbcMode = document.getElementById('investment_import_hsbc_mode');
    const investmentImportSchwabFields = document.getElementById('investment_import_schwab_fields');
    const schwabTransactionsCsvInput = document.getElementById('schwab_transactions_csv');
    const schwabTransactionsCsvStatus = document.getElementById('schwab_transactions_csv_status');
    const futuhkStatementPdfsInput = document.getElementById('futuhk_statement_pdfs');
    const futuhkStatementPdfsStatus = document.getElementById('futuhk_statement_pdfs_status');
    const investmentImportTigertradeFields = document.getElementById('investment_import_tigertrade_fields');
    const tigertradeStatementPdfsInput = document.getElementById('tigertrade_statement_pdfs');
    const tigertradeStatementPdfsStatus = document.getElementById('tigertrade_statement_pdfs_status');
    const investmentImportUsmartHkFields = document.getElementById('investment_import_usmart_hk_fields');
    const usmartHkStatementPdfsInput = document.getElementById('usmart_hk_statement_pdfs');
    const usmartHkStatementPdfsStatus = document.getElementById('usmart_hk_statement_pdfs_status');
    const longbridgeStartDateInput = null;
    const longbridgeStartDateStatus = null;
    const hsbcPortfolioTextInput = document.getElementById('hsbc_portfolio_text');
    const hsbcOrderStatusTextInput = document.getElementById('hsbc_order_status_text');
    const hsbcCashAccountTextInput = document.getElementById('hsbc_cash_account_text');
    const longbridgeEndDateStatus = null;
    const hsbcPortfolioTextDisplay = document.getElementById('hsbc_portfolio_text_display');
    const hsbcOrderStatusDisplay = document.getElementById('hsbc_order_status_display');
    const hsbcCashAccountDisplay = document.getElementById('hsbc_cash_account_display');
    const hsbcPortfolioTextPasteButton = document.getElementById('hsbc_portfolio_text_paste_button');
    const hsbcOrderStatusPasteButton = document.getElementById('hsbc_order_status_paste_button');
    const hsbcCashAccountPasteButton = document.getElementById('hsbc_cash_account_paste_button');
    const hsbcPortfolioTextStatus = document.getElementById('hsbc_portfolio_text_status');
    const hsbcOrderStatusTextStatus = document.getElementById('hsbc_order_status_text_status');
    const hsbcCashAccountTextStatus = document.getElementById('hsbc_cash_account_text_status');
    const hsbcStatementPdfsInput = document.getElementById('hsbc_statement_pdfs');
    const hsbcStatementPdfsStatus = document.getElementById('hsbc_statement_pdfs_status');
    const HSBC_EXPECTED_ACCOUNT_NUMBER = '103-555700-329';
    const HSBC_ACCOUNT_NUMBER_PATTERN = /\d{3}\s*[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*\d{6}\s*[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*\d{3}/g;
    const HSBC_PASTE_CHUNK_MARKER = '===== HSBC PASTE CHUNK =====';
    const hsbcPasteButtonFlashTimers = new WeakMap();
    const INVESTMENT_LOADING_MODAL_TITLE = 'Loading investment data';
    const INVESTMENT_LOADING_MODAL_COPY = 'We are reading the locally stored broker activity and rebuilding the holdings, charts, metrics, and transaction history for this page. Please keep this tab open while loading finishes.';
    const INVESTMENT_LOADING_MODAL_ICON_CLASS = 'icon-hourglass';
    const INVESTMENT_SHARE_RENDER_MODAL_TITLE = 'Rendering share image';
    const INVESTMENT_SHARE_RENDER_MODAL_COPY = 'We are rendering the community share card and encoding the PNG export. Please wait until the image finishes saving.';
    const INVESTMENT_SHARE_RENDER_MODAL_ICON_CLASS = 'icon-hourglass';
    const WORKSPACE_MODAL_DEFAULT_TITLE = String(workspaceModalOverlayTitle?.textContent || '').trim();
    const WORKSPACE_MODAL_DEFAULT_COPY = String(workspaceModalOverlayCopy?.textContent || '').trim();
    const WORKSPACE_MODAL_DEFAULT_ICON_CLASS = String(workspaceModalOverlayIcon?.className || '').trim();
    let investmentBootstrapTimer = 0;
    let investmentPageDisposed = false;
    const isLifecycleInterruptedFetch = (error) => (
        investmentPageDisposed
        || document.visibilityState === 'hidden'
        || error?.name === 'AbortError'
    );
    const markInvestmentPageDisposed = () => {
        investmentPageDisposed = true;
        if (investmentBootstrapTimer) {
            window.clearTimeout(investmentBootstrapTimer);
            investmentBootstrapTimer = 0;
        }
        stopInvestmentRealtimeQuotePolling();
        hideInvestmentLoadingModal({ resetContent: true });
    };
    window.addEventListener('pagehide', markInvestmentPageDisposed, { once: true });
    window.addEventListener('beforeunload', markInvestmentPageDisposed, { once: true });
    const longbridgeEndDateInput = null;
    const segmentedControl = document.getElementById('investment_view_segmented');
    const investmentViewSurface = document.getElementById('investment_view_surface');
    const investmentViewSurfaceBody = document.getElementById('investment_view_surface_body');
    const investmentDummyChart = document.getElementById('investment_dummy_chart');
    const investmentDummyLogoLayer = document.getElementById('investment_dummy_logo_layer');
    const investmentDummyDonut = document.getElementById('investment_dummy_donut');
    const INVESTMENT_STOCK_DETAILS_PANEL_ID = 'stock_panel';
    const INVESTMENT_STOCK_DETAILS_HASH = '#stock_panel';
    const LEGACY_INVESTMENT_STOCK_DETAILS_HASH = '#investment_stock_details_panel';
    const INVESTMENT_HISTORY_PAGE_SIZE = 50;
    const INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT = 5;
    const INVESTMENT_REALTIME_QUOTE_POLL_MS = 10000;
    const INVESTMENT_REALTIME_QUOTE_IDLE_CHECK_MS = 60000;
    const INVESTMENT_MARKET_SESSION_TTL_MS = 30000;
    const INVESTMENT_LIVE_DIGIT_EPSILON = 1e-9;
    const INVESTMENT_LIVE_DIGIT_ANIMATION_MS = 520;
    const INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS = {
        '1w': 5,
        '1m': 23,
    };
    const investmentLiveCharWidthCache = new Map();
    const investmentLiveValueAnimationCancels = new WeakMap();
    let investmentMarketSessionState = null;
    let investmentMarketSessionStateLoadedAt = 0;
    let investmentMarketSessionStateRequest = null;
    let investmentMarketSessionStateRequestDayCount = 0;
    let investmentMarketSessionStateDayCount = 0;
    const investmentStockDetailsPanel = document.getElementById(INVESTMENT_STOCK_DETAILS_PANEL_ID);
    const investmentStockDetailsTableHost = document.getElementById('investment_stock_details_table_host');
    const investmentShareActions = document.getElementById('investment_share_actions');
    const exportTransactionsButton = document.getElementById('export_transactions_button');
    const shareCaptureButton = document.getElementById('share_capture_button');
    const shareMaskButton = document.getElementById('share_mask_button');
    const investmentSharePreviewDemo = document.getElementById('investment_share_preview_demo');
    const investmentSharePreviewShell = document.getElementById('investment_share_preview_shell');
    const investmentSharePreviewViewLabel = document.getElementById('investment_share_preview_view_label');
    const investmentSharePreviewMaskButton = document.getElementById('investment_share_preview_mask_button');
    const investmentHistoryPagination = document.getElementById('investment_history_pagination');
    const investmentPanels = document.querySelectorAll('[data-investment-view-panel]');
    const INVESTMENT_VIEW_ORDER = ['chart', 'holdings', 'stock_details', 'metrics'];
    const INVESTMENT_PAGE_MEMORY_STORAGE_KEY = 'antigravity:investment:page-memory:v1';
    const INVESTMENT_INTERNAL_TRANSFER_BINDINGS_STORAGE_KEY = 'antigravity:investment:internal-transfer-bindings:v1';
    const INVESTMENT_INTERNAL_TRANSFER_LINK_WINDOW_DAYS = 7;
    const NO_COMMISSION_TRANSACTION_TYPES = new Set([
        'foreign_tax_withholding',
        'dividend',
        'adjustment',
        'debit_interest',
        'credit_interest',
        'payment_in_lieu',
        'dividend_reinvestment',
        'forex_trade',
        'forex_trade_component',
        'fx_translation_pnl',
        'deposit',
        'kol_reward',
        'grant',
        'withdrawal',
    ]);
    const FUNDING_METRIC_DEFINITIONS = [
        {
            key: 'direct-deposits',
            label: 'Direct deposits',
            summary: 'Direct USD cash deposits that were not consumed by later USD conversions.',
            valueKey: 'directUsdDeposits',
            rowsKey: 'directDepositRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.directUsdDeposits, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'net-usd-converted',
            label: 'Net USD converted',
            summary: 'USD received from FX conversion after subtracting conversion commissions.',
            valueKey: 'netUsdConverted',
            rowsKey: 'netUsdConvertedRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.netUsdConverted, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'fx-funding-loss',
            label: 'FX funding loss',
            summary: 'Real conversion cost only: FX commission plus the deposit-to-USD shortfall tied to matched conversion funding.',
            valueKey: 'fxFundingLoss',
            rowsKey: 'fxFundingLossRows',
            formatValue: (metrics) => formatMetricLossAmountWithCurrency(metrics?.fxFundingLoss, 'USD'),
            valueClass: (metrics) => getNegativeMetricClass(metrics?.fxFundingLoss),
        },
        {
            key: 'final-investable-usd',
            label: 'Final investable USD',
            summary: 'Direct USD deposits plus net USD obtained from FX conversion.',
            valueKey: 'finalInvestableUsd',
            rowsKey: 'finalInvestableUsdRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.finalInvestableUsd, 'USD', { showUsdSymbol: false }),
        },
        {
            key: 'total-commission',
            label: 'Total commission',
            summary: 'All commissions charged across the imported investment ledger.',
            valueKey: 'totalCommission',
            rowsKey: 'totalCommissionRows',
            formatValue: (metrics) => formatMetricLossAmount(metrics?.totalCommission),
            valueClass: (metrics) => getNegativeMetricClass(metrics?.totalCommission),
        },
        {
            key: 'interest-charged',
            label: 'Interest charged',
            summary: 'Debit interest charged by the broker and deducted from cash.',
            valueKey: 'interestCharged',
            rowsKey: 'interestChargedRows',
            formatValue: (metrics) => formatMetricLossAmount(metrics?.interestCharged),
            valueClass: (metrics) => getNegativeMetricClass(metrics?.interestCharged),
        },
    ];
    const BROKER_BENEFIT_METRIC_DEFINITIONS = [
        {
            key: 'coupon-rebates-hkd',
            label: 'Coupon rebates HKD',
            summary: 'Broker coupon and fee-rebate benefits whose economic notional is denominated in HKD.',
            valueKey: 'couponRebateHkd',
            rowsKey: 'couponRebateHkdRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.couponRebateHkd, 'HKD'),
            valueClass: (metrics) => getSignedMetricClass(metrics?.couponRebateHkd),
        },
        {
            key: 'coupon-rebates-usd',
            label: 'Coupon rebates USD',
            summary: 'Broker coupon and fee-rebate benefits denominated in USD.',
            valueKey: 'couponRebateUsd',
            rowsKey: 'couponRebateUsdRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.couponRebateUsd, 'USD', { showUsdSymbol: false }),
            valueClass: (metrics) => getSignedMetricClass(metrics?.couponRebateUsd),
        },
        {
            key: 'cash-rewards-hkd',
            label: 'Cash rewards HKD',
            summary: 'Cash cards, stock-cash coupons, task rewards, and signup or funding rewards denominated in HKD.',
            valueKey: 'cashRewardHkd',
            rowsKey: 'cashRewardHkdRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.cashRewardHkd, 'HKD'),
            valueClass: (metrics) => getSignedMetricClass(metrics?.cashRewardHkd),
        },
        {
            key: 'cash-rewards-usd',
            label: 'Cash rewards USD',
            summary: 'Cash cards, stock-cash coupons, task rewards, and signup or funding rewards denominated in USD.',
            valueKey: 'cashRewardUsd',
            rowsKey: 'cashRewardUsdRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.cashRewardUsd, 'USD', { showUsdSymbol: false }),
            valueClass: (metrics) => getSignedMetricClass(metrics?.cashRewardUsd),
        },
        {
            key: 'kol-rewards',
            label: 'KOL rewards',
            summary: 'KOL reward income converted to the workspace base currency at the ledger-date FX rate.',
            valueKey: 'kolRewardIncome',
            rowsKey: 'kolRewardRows',
            formatValue: (metrics) => formatAmountWithCurrency(metrics?.kolRewardIncome, getInvestmentBaseCurrency(), { showUsdSymbol: false }),
            valueClass: (metrics) => getSignedMetricClass(metrics?.kolRewardIncome),
        },
        {
            key: 'stock-grant-realized-pnl',
            label: 'Stock grant realized P&L',
            summary: 'Sale proceeds attributed to zero-cost broker stock grants using the same ledger ordering as holdings replay.',
            valueKey: 'stockGrantRealizedPnl',
            rowsKey: 'stockGrantRealizedRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.stockGrantRealizedPnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.stockGrantRealizedPnl),
        },
        {
            key: 'stock-grant-unrealized-pnl',
            label: 'Stock grant unrealized P&L',
            summary: 'Current mark-to-market value attributed to still-open zero-cost broker stock grants.',
            valueKey: 'stockGrantUnrealizedPnl',
            rowsKey: 'stockGrantUnrealizedRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.stockGrantUnrealizedPnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.stockGrantUnrealizedPnl),
        },
    ];
    const OFFSHORE_GAIN_METRIC_DEFINITIONS = [
        {
            key: 'total-offshore-gain',
            label: 'Total offshore gain',
            summary: 'Mainland-resident offshore gain view: holdings cumulative P&L plus converted broker coupon, cash, and KOL benefits. Stock-grant P&L is included once through holdings P&L, not added again.',
            valueKey: 'totalOffshoreGain',
            rowsKey: 'totalOffshoreGainRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.totalOffshoreGain),
            valueClass: (metrics) => getSignedMetricClass(metrics?.totalOffshoreGain),
        },
    ];
    const HOLDINGS_SUMMARY_METRIC_DEFINITIONS = [
        {
            key: 'cumulative-pnl',
            label: 'Cumulative P&L',
            summary: 'Combined realized and unrealized profit and loss across all tracked holdings.',
            valueKey: 'cumulativePnl',
            rowsKey: 'cumulativePnlRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.cumulativePnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.cumulativePnl),
            liveField: 'metrics_cumulative_pnl',
            liveNumberKey: 'cumulativePnl',
        },
        {
            key: 'realized-pnl',
            label: 'Realized P&L',
            summary: 'Realized profit and loss from holdings activity, excluding broker coupons, cash rewards, and KOL rewards that are shown separately.',
            valueKey: 'totalRealizedPnl',
            rowsKey: 'realizedPnlRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.totalRealizedPnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.totalRealizedPnl),
        },
        {
            key: 'unrealized-pnl',
            label: 'Unrealized P&L',
            summary: 'Mark-to-market profit and loss for holdings that still have an open position.',
            valueKey: 'totalUnrealizedPnl',
            rowsKey: 'unrealizedPnlRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.totalUnrealizedPnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.totalUnrealizedPnl),
            liveField: 'metrics_unrealized_pnl',
            liveNumberKey: 'totalUnrealizedPnl',
        },
    ];
    let activeInvestmentView = 'chart';
    let investmentSurfaceCleanupTimer = null;
    let investmentFormHideTimer = null;
    let investmentImportInFlight = false;
    let investmentSegmentedMeasureRaf = 0;
    let investmentSegmentedMeasureTimer = 0;
    let investmentIbkrModeMeasureRaf = 0;
    let investmentHsbcModeMeasureRaf = 0;
    let activeInvestmentHistoryRowIds = [];
    let activeInvestmentStockDetailRowIds = [];
    const INVESTMENT_MANUAL_SCROLL_SUPPRESS_MS = 1400;
    const INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS = 900;
    const INVESTMENT_OVERVIEW_INTRADAY_REQUEST_TIMEOUT_MS = 45000;
    const investmentScrollIntentState = {
        history: {
            suppressUntil: 0,
            ignoreUntil: 0,
        },
        stockDetails: {
            suppressUntil: 0,
            ignoreUntil: 0,
        },
    };
    let investmentChartReady = false;
    let investmentHasExportableTransactions = false;
    let investmentShareMaskEnabled = false;
    let investmentSharePreviewRenderSerial = 0;
    let investmentSharePreviewRenderRaf = 0;
    let investmentScreenshotLibraryPromise = null;
    let investmentQrCodeLibraryPromise = null;
    let investmentEquityChartInstance = null;
    let investmentStockDetailsPriceChartInstance = null;
    let activeHoldingsHoverTicker = '';
    let activeHoldingsHoverLedgerNo = 0;
    let investmentChartPointsCache = [];
    let investmentBaseChartPointsCache = [];
    let investmentBaseLatestPricesCache = {};
    let investmentLatestPricesCache = {};
    let investmentSharedChartDateRange = [];
    let investmentChartPointIndexByLedgerNo = new Map();
    let investmentLatestChartPoint = null;
    let activeChartTooltipPointIndex = -1;
    let activeStockDetailsHoverPointRecord = null;
    let investmentDummyTickerProfiles = {};
    let selectedInvestmentStockTicker = '';
    let investmentProcessedTransactionsCache = [];
    let investmentTickerSummariesCache = [];
    let investmentAvailableBrokerCodesCache = [];
    let investmentAvailableBrokerCodesSet = new Set();
    let animatedHoldingsMarkerPoint = null;
    let animatedHoldingsMarkerTarget = null;
    let animatedHoldingsMarkerFrame = 0;
    let animatedHoldingsMarkerStartTime = 0;
    let investmentEquityChartRuntimeState = null;
    let stockDetailsDonutAnimationFrame = 0;
    let stockDetailsDonutAnimationStartTime = 0;
    let stockDetailsDonutAnimatedState = null;
    let investmentDummyDonutSyncFrame = 0;
    let investmentDummyDonutRenderSignature = '';
    let investmentStockDetailsVisibleLayoutTimer = 0;
    let selectedInvestmentStockDetailsRange = 'max';
    let selectedInvestmentEquityRange = 'max';
    let investmentStockDetailsRangeMeasureRaf = 0;
    let investmentStockDetailsRangeControlAbortController = null;
    let investmentStockDetailsRangeControlResizeObserver = null;
    let investmentEquityRangeMeasureRaf = 0;
    let investmentEquityRangeControlAbortController = null;
    let investmentEquityRangeControlResizeObserver = null;
    let investmentHoldingsTableAlignmentCleanup = null;
    let investmentHistoryTableAlignmentCleanup = null;
    let investmentStockDetailsTableAlignmentCleanup = null;
    let investmentHistoryCurrentPage = 1;
    let investmentHistoryPendingPaginationAnimation = null;
    let investmentBrokerFilterSelectedCodes = new Set();
    let investmentBrokerFilterDocumentListenersBound = false;
    let investmentBrokerFilterApplyRaf = 0;
    let investmentBrokerFilterPositionRaf = 0;
    let investmentBrokerFilterTransactionIndex = {
        source: null,
        allRows: [],
        byBroker: new Map(),
        availableCodes: [],
        availableSet: new Set(),
    };
    let investmentHistoryVisibleTransactionsCache = [];
    let investmentRawTransactionsCache = [];
    let investmentTickerClosePricesCache = {};
    let investmentInternalTransferSourceOptionsByKey = new Map();
    let investmentInternalTransferResolvedBindingsBySourceKey = new Map();
    let investmentStockDetailsPriceChartRequestSerial = 0;
    const investmentStockDetailsIntradayCache = new Map();
    const investmentStockDetailsIntradayInflight = new Map();
    const investmentOverviewIntradayCache = new Map();
    const investmentOverviewIntradayInflight = new Map();
    let investmentOverviewIntradayRenderSerial = 0;
    let investmentOverviewIntradayLinePointsCache = {
        key: '',
        points: [],
        quality: null,
    };
    let investmentRealtimeQuoteTimer = 0;
    let investmentRealtimeQuoteAbortController = null;
    let investmentRealtimeQuoteInflight = false;

    const STOCK_DETAILS_DONUT_GRAY_FILL = 'color-mix(in srgb, var(--theme-muted) 34%, transparent)';
    const STOCK_DETAILS_MARKER_VIEW_BOX = { width: 20.3027, height: 20.5176 };
    const INVESTMENT_SURFACE_LAYOUT_SETTLE_MS = 520;
    const INVESTMENT_COMMON_SPLIT_FACTORS = [
        1, 1.5, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256,
    ];
    const INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS = [
        { value: '1w', label: '1W' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: '1y', label: '1Y' },
        { value: 'max', label: 'Max' },
        { value: 'auto', label: 'Auto' },
    ];
    const INVESTMENT_EQUITY_RANGE_OPTIONS = [
        { value: '1w', label: '1W' },
        { value: '1m', label: '1M' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: '1y', label: '1Y' },
        { value: 'max', label: 'Max' },
    ];
    const INVESTMENT_BROKER_META = {
        ibkr: {
            code: 'ibkr',
            label: 'IBKR',
            logoUrl: '/market-store/logos/brokers/IBKR.png',
            logoAlt: 'IBKR logo',
        },
        longbridge_hk: {
            code: 'longbridge_hk',
            label: 'Longbridge (HK)',
            logoUrl: '/market-store/logos/brokers/Longbridge.png',
            logoAlt: 'Longbridge (HK) logo',
        },
        longbridge_sg: {
            code: 'longbridge_sg',
            label: 'Longbridge (SG)',
            logoUrl: '/market-store/logos/brokers/Longbridge.png',
            logoAlt: 'Longbridge (SG) logo',
        },
        hsbc: {
            code: 'hsbc',
            label: 'HSBC',
            logoUrl: '/market-store/logos/brokers/HSBC.png',
            logoAlt: 'HSBC logo',
        },
        futuhk: {
            code: 'futuhk',
            label: 'Futu (HK)',
            logoUrl: '/market-store/logos/brokers/FutuHK.svg',
            logoAlt: 'Futu (HK) logo',
        },
        cmbwl: {
            code: 'cmbwl',
            label: 'CMB Wing Lung Bank',
            logoUrl: '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
            logoAlt: 'CMB Wing Lung Bank logo',
        },
        schwab: {
            code: 'schwab',
            label: 'Charles Schwab',
            logoUrl: '/market-store/logos/brokers/Charles%20Schwab.svg',
            logoAlt: 'Charles Schwab logo',
        },
        tigertrade: {
            code: 'tigertrade',
            label: 'Tiger Trade',
            logoUrl: '/market-store/logos/brokers/TigerTrade.png',
            logoAlt: 'Tiger Trade logo',
        },
        usmart_hk: {
            code: 'usmart_hk',
            label: 'uSMART (HK)',
            logoUrl: '/market-store/logos/brokers/uSAMRT.png',
            logoAlt: 'uSMART (HK) logo',
        },
    };
    const SUPPORTED_INVESTMENT_IMPORT_BROKERS = new Set(['ibkr', 'longbridge_hk', 'longbridge_sg', 'hsbc', 'futuhk', 'cmbwl', 'schwab', 'tigertrade', 'usmart_hk']);

    const {
        adjustTradePriceForRenderedSeries,
        addCashLedgerDelta,
        applyDirectionalTrade,
        buildDailyEquityChartPoints,
        buildInvestmentFxRateTimeline,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
        getInvestmentCanonicalTicker,
        getInvestmentTickerProfileLookupCandidates,
        getInvestmentTickerStoreAliasCandidates,
        cloneCashLedgerBalances,
        convertAmountToBaseCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        createCashLedger,
        compareInvestmentTransactions,
        createPositionState,
        escapeHtml,
        formatAmountWithCurrency,
        formatHoldingsMoney,
        formatHoldingsPercent,
        formatHoldingsPosition,
        formatSignedHoldingsMoney,
        formatTransactionCommissionDisplay,
        formatTransactionCurrency,
        formatTransactionDateDisplay,
        formatTransactionDescription,
        getIndexedClosePriceOnOrBefore,
        getAuthoritativePositionSnapshot,
        getInvestmentEquityRangeLabels,
        getInvestmentBrokerEndingCash,
        getInvestmentEndingCash,
        getInvestmentStartingCash,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        getTodayLedgerDate,
        getMoneyMarketTickerSet,
        getCashEquivalentTickerSet,
        isSyntheticCashEquivalentTicker,
        isLongbridgeHkCashEquivalentTransfer,
        getLongbridgeHkCashEquivalentSyntheticTicker,
        isUsmartHkFractionalSharesTransaction,
        getNormalizedTransactionType,
        getTransactionAmount,
        getTransactionCommission,
        getTransactionEconomicAmount,
        getTransactionEffectiveUnitPrice,
        getInvestmentBaseCurrency,
        getTransactionPrice,
        getTransactionQuantity,
        getTransactionValuationQuantity,
        getTickerQuoteCurrency,
        isFlatPosition,
        isForexPairTicker,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        shouldTrackHoldingTicker,
        sumCashLedgerInBaseCurrency,
        isKolRewardTransaction,
        USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
        LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX,
    } = createInvestmentDataUtils({
        noCommissionTransactionTypes: NO_COMMISSION_TRANSACTION_TYPES,
        investmentCommonSplitFactors: INVESTMENT_COMMON_SPLIT_FACTORS,
        parseInvestmentDateParts,
        formatInvestmentShortDateParts,
        normalizeInvestmentTicker,
        normalizeInvestmentStockDetailsRange,
        normalizeInvestmentEquityRange,
    });

    function normalizeInvestmentView(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return INVESTMENT_VIEW_ORDER.includes(normalized) ? normalized : 'chart';
    }

    function stopInvestmentRealtimeQuotePolling() {
        if (investmentRealtimeQuoteTimer) {
            window.clearTimeout(investmentRealtimeQuoteTimer);
            investmentRealtimeQuoteTimer = 0;
        }
        if (investmentRealtimeQuoteAbortController) {
            investmentRealtimeQuoteAbortController.abort();
            investmentRealtimeQuoteAbortController = null;
        }
        investmentRealtimeQuoteInflight = false;
    }

    function getInvestmentRealtimeQuoteEndpoint() {
        return window.ANTIGRAVITY_APP?.endpoints?.investmentRealtimeQuotes || '/api/investment/realtime-quotes';
    }

    function getInvestmentMarketSessionEndpoint() {
        return window.ANTIGRAVITY_APP?.endpoints?.investmentMarketSession || '/api/market-session/us-equity';
    }

    function getSafeInvestmentMarketSessionState() {
        return (investmentMarketSessionState && typeof investmentMarketSessionState === 'object') ? investmentMarketSessionState : null;
    }

    function isInvestmentOverviewHighPrecisionEquityRange(range = selectedInvestmentEquityRange) {
        const normalizedRange = normalizeInvestmentEquityRange(range);
        return normalizedRange === '1w' || normalizedRange === '1m';
    }

    function getInvestmentOverviewIntradayDayCount(range = selectedInvestmentEquityRange) {
        const normalizedRange = normalizeInvestmentEquityRange(range);
        return INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS[normalizedRange] || 0;
    }

    function refreshInvestmentMarketSessionState({
        force = false,
        dayCount = INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS['1w'],
    } = {}) {
        const now = Date.now();
        const requestedDayCount = Math.max(1, Math.min(365, Number(dayCount) || INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS['1w']));
        const isFresh = now - investmentMarketSessionStateLoadedAt <= INVESTMENT_MARKET_SESSION_TTL_MS;
        if (!force && isFresh && investmentMarketSessionStateRequest === null && investmentMarketSessionStateDayCount >= requestedDayCount) {
            return Promise.resolve(investmentMarketSessionState);
        }
        if (investmentMarketSessionStateRequest && investmentMarketSessionStateRequestDayCount === requestedDayCount) {
            return investmentMarketSessionStateRequest;
        }
        const sessionEndpoint = getInvestmentMarketSessionEndpoint();
        const resolvedEndpoint = `${sessionEndpoint}?day_count=${encodeURIComponent(String(requestedDayCount))}`;

        investmentMarketSessionStateRequest = (async () => {
            try {
                const response = await fetch(resolvedEndpoint, buildInvestmentRequestOptions());
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload?.success) {
                    throw new Error(payload?.error || 'Unable to read US equity market session state.');
                }
                const safePayload = (payload && typeof payload === 'object') ? payload : {};
                investmentMarketSessionState = {
                    market: String(safePayload.market || '').trim() || 'us_equity',
                    session: String(safePayload.session || '').trim().toLowerCase() || 'off',
                    is_trading_day: Boolean(safePayload.is_trading_day),
                    is_early_close: Boolean(safePayload.is_early_close),
                    is_realtime_allowed: Boolean(safePayload.is_realtime_allowed),
                    session_date: String(safePayload.session_date || '').trim(),
                    as_of: String(safePayload.as_of || '').trim(),
                    trading_days: Array.isArray(safePayload.trading_days)
                        ? [...new Set(safePayload.trading_days)]
                            .map((dayKey) => normalizeLedgerDate(dayKey))
                            .filter(Boolean)
                        : [],
                };
                investmentMarketSessionStateDayCount = requestedDayCount;
            } catch (error) {
                if (!isFresh || !investmentMarketSessionState) {
                    investmentMarketSessionState = {
                        market: 'us_equity',
                        session: 'off',
                        is_trading_day: false,
                        is_early_close: false,
                        is_realtime_allowed: false,
                        session_date: '',
                        as_of: '',
                        trading_days: [],
                    };
                }
                if (isFresh) {
                    console.warn('Unable to refresh US equity session state', error);
                }
            } finally {
                investmentMarketSessionStateLoadedAt = Date.now();
                investmentMarketSessionStateRequest = null;
                investmentMarketSessionStateRequestDayCount = 0;
            }
            return investmentMarketSessionState;
        })();
        investmentMarketSessionStateRequestDayCount = requestedDayCount;
        return investmentMarketSessionStateRequest;
    }

    function getCachedInvestmentMarketSessionState() {
        const now = Date.now();
        const isFresh = now - investmentMarketSessionStateLoadedAt <= INVESTMENT_MARKET_SESSION_TTL_MS;
        if (!isFresh) {
            void refreshInvestmentMarketSessionState();
        }
        return getSafeInvestmentMarketSessionState();
    }

    function shouldShowInvestmentRealtimePulse(session) {
        return ['pre', 'intraday', 'post'].includes(String(session || '').trim().toLowerCase());
    }

    function getInvestmentNewYorkClockParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date).reduce((nextParts, part) => {
            nextParts[part.type] = part.value;
            return nextParts;
        }, {});
        return {
            dateKey: `${parts.year || ''}-${parts.month || ''}-${parts.day || ''}`,
            weekday: String(parts.weekday || ''),
            hour: Number(parts.hour),
            minute: Number(parts.minute),
        };
    }

    function getInvestmentRealtimeClockSession(date = new Date()) {
        const { weekday, hour, minute } = getInvestmentNewYorkClockParts(date);
        if (weekday === 'Sat' || weekday === 'Sun' || !Number.isFinite(hour) || !Number.isFinite(minute)) {
            return 'off';
        }
        const totalMinutes = (hour * 60) + minute;
        const intradayOpenMinutes = (9 * 60) + 30;
        const intradayCloseMinutes = 16 * 60;
        const premarketOpenMinutes = 4 * 60;
        const postmarketCloseMinutes = 20 * 60;
        if (totalMinutes >= intradayOpenMinutes && totalMinutes < intradayCloseMinutes) return 'intraday';
        if (totalMinutes >= premarketOpenMinutes && totalMinutes < intradayOpenMinutes) return 'pre';
        if (totalMinutes >= intradayCloseMinutes && totalMinutes < postmarketCloseMinutes) return 'post';
        return 'off';
    }

    function shouldRunInvestmentRealtimeQuotes() {
        const usSessionState = getCachedInvestmentMarketSessionState();
        if (usSessionState?.is_realtime_allowed) {
            return true;
        }
        if (usSessionState && usSessionState.session !== 'off' && usSessionState.session !== 'post') {
            return false;
        }
        return (
            shouldShowInvestmentRealtimePulse(getInvestmentHongKongClockSession())
            && portfolioHasOpenHongKongHoldings()
        );
    }

    refreshInvestmentMarketSessionState({ force: true }).catch(() => {});

    function isInvestmentOverviewIntradayEquityRange(range = selectedInvestmentEquityRange) {
        return isInvestmentOverviewHighPrecisionEquityRange(range);
    }

    function isInvestmentDailyEquityLiveRange(range = selectedInvestmentEquityRange) {
        return !isInvestmentOverviewIntradayEquityRange(range);
    }

    function getInvestmentLiveSessionDateKey() {
        const sessionState = getCachedInvestmentMarketSessionState();
        return shouldRunInvestmentRealtimeQuotes()
            ? (sessionState?.session_date || getInvestmentNewYorkClockParts().dateKey)
            : '';
    }

    function getInvestmentDailyEquityLiveSessionDateKey() {
        return isInvestmentDailyEquityLiveRange()
            ? getInvestmentLiveSessionDateKey()
            : '';
    }

    function findInvestmentChartPointIndexForLedgerDate(chartPoints = [], ledgerDate = '') {
        const normalizedLedgerDate = normalizeLedgerDate(ledgerDate);
        if (!normalizedLedgerDate || !Array.isArray(chartPoints)) return -1;
        for (let index = chartPoints.length - 1; index >= 0; index -= 1) {
            if (normalizeLedgerDate(chartPoints[index]?.date) === normalizedLedgerDate) {
                return index;
            }
        }
        return -1;
    }

    function shouldPreferInvestmentChartPoint(candidate, incumbent) {
        if (candidate?.is_realtime && !incumbent?.is_realtime) return true;
        if (!candidate?.is_realtime && incumbent?.is_realtime) return false;
        return true;
    }

    function dedupeInvestmentChartPointsByLedgerDate(chartPoints = []) {
        if (!Array.isArray(chartPoints) || !chartPoints.length) return [];
        return chartPoints.reduce((dedupedPoints, point) => {
            const ledgerDate = normalizeLedgerDate(point?.date);
            if (!ledgerDate) {
                dedupedPoints.push(point);
                return dedupedPoints;
            }
            const previousPoint = dedupedPoints[dedupedPoints.length - 1];
            const previousLedgerDate = normalizeLedgerDate(previousPoint?.date);
            if (previousLedgerDate === ledgerDate) {
                dedupedPoints[dedupedPoints.length - 1] = shouldPreferInvestmentChartPoint(point, previousPoint)
                    ? point
                    : previousPoint;
                return dedupedPoints;
            }
            dedupedPoints.push(point);
            return dedupedPoints;
        }, []);
    }

    function ensureInvestmentLiveSessionChartSlot(chartPoints = []) {
        const sourcePoints = Array.isArray(chartPoints) ? chartPoints : [];
        const realtimePoints = sourcePoints.filter((point) => point?.is_realtime === true);
        let withoutRealtime = sourcePoints.filter((point) => point?.is_realtime !== true);
        const liveDateKey = getInvestmentDailyEquityLiveSessionDateKey();
        if (liveDateKey && withoutRealtime.length) {
            if (findInvestmentChartPointIndexForLedgerDate(withoutRealtime, liveDateKey) < 0) {
                const latestPoint = withoutRealtime[withoutRealtime.length - 1];
                if (latestPoint) {
                    withoutRealtime = [
                        ...withoutRealtime,
                        {
                            ...latestPoint,
                            date: liveDateKey,
                            is_live_session_slot: true,
                            is_trading_day: true,
                            anchor_ledger_date: '',
                            anchor_ledger_nos: [],
                        },
                    ];
                }
            }
        }
        if (!realtimePoints.length) return withoutRealtime;
        const realtimeByDate = new Map();
        realtimePoints.forEach((point) => {
            const dateKey = normalizeLedgerDate(point?.date);
            if (dateKey) realtimeByDate.set(dateKey, point);
        });
        const merged = withoutRealtime.map((point) => {
            const dateKey = normalizeLedgerDate(point?.date);
            return dateKey && realtimeByDate.has(dateKey) ? realtimeByDate.get(dateKey) : point;
        });
        realtimePoints.forEach((point) => {
            const dateKey = normalizeLedgerDate(point?.date);
            if (dateKey && !merged.some((entry) => normalizeLedgerDate(entry?.date) === dateKey)) {
                merged.push(point);
            }
        });
        return merged.sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
    }

    function getInvestmentEquityChartInputPoints(fallbackChartPoints = []) {
        const fallback = Array.isArray(fallbackChartPoints) ? fallbackChartPoints : [];
        if (!isInvestmentDailyEquityLiveRange()) return fallback;
        if (Array.isArray(investmentChartPointsCache) && investmentChartPointsCache.length) {
            return [...investmentChartPointsCache];
        }
        if (Array.isArray(investmentBaseChartPointsCache) && investmentBaseChartPointsCache.length) {
            return ensureInvestmentLiveSessionChartSlot(investmentBaseChartPointsCache);
        }
        return ensureInvestmentLiveSessionChartSlot(fallback);
    }

    function buildInvestmentAxisTickIndexes(labels = [], rawDates = [], plotWidth = 0, parseRawDate = null) {
        const normalizedLabels = Array.isArray(labels) ? labels : [];
        if (!normalizedLabels.length) return [];
        const tickIndexes = Array.from(buildInvestmentEquityTickIndexSet(normalizedLabels.length, plotWidth))
            .sort((left, right) => left - right);
        const seenLedgerDates = new Set();
        return tickIndexes.filter((index) => {
            const rawDate = Array.isArray(rawDates) && rawDates[index] !== undefined
                ? rawDates[index]
                : normalizedLabels[index];
            const ledgerDate = normalizeLedgerDate(rawDate);
            if (!ledgerDate || seenLedgerDates.has(ledgerDate)) return false;
            seenLedgerDates.add(ledgerDate);
            return true;
        });
    }

    function buildInvestmentEquityTickIndexSet(count, plotWidth) {
        if (count <= 0) return new Set();
        if (count === 1) return new Set([0]);
        const maxTickCount = plotWidth >= 768 ? 4 : 3;
        if (maxTickCount === 3 || count < 4) {
            return new Set([0, Math.round((count - 1) / 2), count - 1]);
        }
        return new Set([
            0,
            Math.round((count - 1) / 3),
            Math.round(((count - 1) * 2) / 3),
            count - 1,
        ]);
    }

    function getInvestmentRealtimeQuoteDateKey(quote) {
        const sessionDate = String(quote?.session_date || '').trim();
        if (sessionDate) return normalizeLedgerDate(sessionDate);
        const match = String(quote?.timestamp || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
    }

    function isInvestmentHongKongTicker(ticker) {
        return String(normalizeInvestmentTicker(ticker) || '').endsWith('.HK');
    }

    function getInvestmentQuoteMarket(quote, ticker = quote?.ticker) {
        const quoteMarket = String(quote?.market || '').trim().toUpperCase();
        if (quoteMarket) return quoteMarket;
        return isInvestmentHongKongTicker(ticker) ? 'HK' : 'US';
    }

    function getInvestmentHongKongClockParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date).reduce((nextParts, part) => {
            nextParts[part.type] = part.value;
            return nextParts;
        }, {});
        return {
            dateKey: `${parts.year || ''}-${parts.month || ''}-${parts.day || ''}`,
            weekday: String(parts.weekday || ''),
            hour: Number(parts.hour),
            minute: Number(parts.minute),
        };
    }

    function getInvestmentHongKongClockSession(date = new Date()) {
        const { weekday, hour, minute } = getInvestmentHongKongClockParts(date);
        if (weekday === 'Sat' || weekday === 'Sun' || !Number.isFinite(hour) || !Number.isFinite(minute)) {
            return 'off';
        }
        const totalMinutes = (hour * 60) + minute;
        const morningOpenMinutes = (9 * 60) + 30;
        const morningCloseMinutes = 12 * 60;
        const afternoonOpenMinutes = 13 * 60;
        const afternoonCloseMinutes = 16 * 60;
        if (totalMinutes >= morningOpenMinutes && totalMinutes < morningCloseMinutes) return 'intraday';
        if (totalMinutes >= afternoonOpenMinutes && totalMinutes < afternoonCloseMinutes) return 'intraday';
        return 'off';
    }

    function shiftInvestmentCalendarDateKey(dateKey, dayDelta = 0) {
        const normalizedDateKey = normalizeLedgerDate(dateKey);
        if (!normalizedDateKey || !Number.isFinite(Number(dayDelta))) return '';
        const [year, month, day] = normalizedDateKey.split('-').map((value) => Number(value));
        if (![year, month, day].every(Number.isFinite)) return '';
        const shifted = new Date(Date.UTC(year, month - 1, day + Number(dayDelta)));
        const shiftedYear = shifted.getUTCFullYear();
        const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
        const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
        return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
    }

    function shouldUseInvestmentUsRealtimeQuote(quote) {
        const currentDateKey = getInvestmentNewYorkClockParts().dateKey;
        const quoteDateKey = getInvestmentRealtimeQuoteDateKey(quote);
        const activeSession = getInvestmentRealtimeClockSession();
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        if (
            !shouldShowInvestmentRealtimePulse(activeSession)
            || !shouldShowInvestmentRealtimePulse(quoteSession)
            || quoteSession !== activeSession
            || !currentDateKey
            || !quoteDateKey
        ) {
            return false;
        }
        if (activeSession === 'intraday') {
            return quoteDateKey === currentDateKey;
        }
        return true;
    }

    function shouldApplyInvestmentRealtimePriceForHoldings(quote) {
        if (shouldUseInvestmentRealtimeQuote(quote)) return true;
        const market = getInvestmentQuoteMarket(quote);
        if (market !== 'US') return false;
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        const activeSession = getInvestmentRealtimeClockSession();
        if (quoteSession === 'post' && (activeSession === 'post' || activeSession === 'off')) {
            return true;
        }
        if (quoteSession === 'pre' && (activeSession === 'pre' || activeSession === 'off')) {
            return true;
        }
        return false;
    }

    function shouldUseInvestmentHongKongRealtimeQuote(quote) {
        const currentDateKey = getInvestmentHongKongClockParts().dateKey;
        const quoteDateKey = getInvestmentRealtimeQuoteDateKey(quote);
        const activeSession = getInvestmentHongKongClockSession();
        const quoteSession = String(quote?.session || '').trim().toLowerCase();
        return (
            shouldShowInvestmentRealtimePulse(activeSession)
            && shouldShowInvestmentRealtimePulse(quoteSession)
            && quoteSession === activeSession
            && Boolean(currentDateKey)
            && quoteDateKey === currentDateKey
        );
    }

    function shouldUseInvestmentRealtimeQuote(quote) {
        const ticker = normalizeInvestmentTicker(quote?.ticker);
        const market = getInvestmentQuoteMarket(quote, ticker);
        if (market === 'HK') {
            return shouldUseInvestmentHongKongRealtimeQuote(quote);
        }
        return shouldUseInvestmentUsRealtimeQuote(quote);
    }

    function portfolioHasOpenHongKongHoldings() {
        const latestSnapshot = Array.isArray(investmentProcessedTransactionsCache) && investmentProcessedTransactionsCache.length
            ? investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]
            : null;
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        return Object.keys(holdings).some((ticker) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            const quantity = Number(holdings[ticker]);
            return (
                isInvestmentHongKongTicker(normalizedTicker)
                && Number.isFinite(quantity)
                && Math.abs(quantity) > 1e-9
            );
        });
    }

    function getInvestmentRealtimeTickersFromSnapshot(snapshot) {
        const holdings = snapshot?.aggregate_holdings || snapshot?.holdings || {};
        const moneyMarketTickers = getMoneyMarketTickerSet();
        return Array.from(new Set(
            Object.entries(holdings)
                .filter(([ticker, quantity]) => {
                    const normalizedTicker = normalizeInvestmentTicker(ticker);
                    const numericQuantity = Number(quantity);
                    return (
                        normalizedTicker
                        && !isForexPairTicker(normalizedTicker)
                        && !moneyMarketTickers.has(normalizedTicker)
                        && Number.isFinite(numericQuantity)
                        && Math.abs(numericQuantity) > 1e-9
                    );
                })
                .map(([ticker]) => normalizeInvestmentTicker(ticker)),
        ));
    }

    async function requestInvestmentRealtimeQuotes(tickers = [], { signal } = {}) {
        const normalizedTickers = Array.from(new Set(
            (Array.isArray(tickers) ? tickers : [])
                .map((ticker) => normalizeInvestmentTicker(ticker))
                .filter(Boolean),
        ));
        if (!normalizedTickers.length) return [];
        const BATCH_SIZE = 8;
        const batches = [];
        for (let i = 0; i < normalizedTickers.length; i += BATCH_SIZE) {
            batches.push(normalizedTickers.slice(i, i + BATCH_SIZE));
        }
        const batchResults = await Promise.all(
            batches.map(async (batch) => {
                if (!batch.length) return [];
                const params = new URLSearchParams();
                batch.forEach((ticker) => params.append("ticker", ticker));
                try {
                    const response = await fetch(
                        `${getInvestmentRealtimeQuoteEndpoint()}?${params.toString()}`,
                        buildInvestmentRequestOptions({ signal }),
                    );
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && payload?.success !== false && Array.isArray(payload?.quotes)) {
                        return payload.quotes;
                    }
                    return [];
                } catch (err) {
                    if (isLifecycleInterruptedFetch(err)) throw err;
                    return [];
                }
            }),
        );
        return batchResults.flat();
    }

    function applyInvestmentSessionRealtimePrices(latestPrices, quotes = []) {
        const safeLatestPrices = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        (Array.isArray(quotes) ? quotes : [])
            .filter((quote) => isInvestmentHoldingsRealtimeQuote(quote) && shouldApplyInvestmentRealtimePriceForHoldings(quote))
            .forEach((quote) => {
                const ticker = normalizeInvestmentTicker(quote?.ticker);
                const price = Number(quote?.price);
                safeLatestPrices[ticker] = price;
                investmentLatestPricesCache[ticker] = price;
                investmentBaseLatestPricesCache[ticker] = price;
            });
        return safeLatestPrices;
    }

    function getInvestmentEmbeddedRealtimeQuotes() {
        const quotes = window.ANTIGRAVITY_INVESTMENT_DATA?.realtime_quotes;
        return Array.isArray(quotes) ? quotes : [];
    }

    function mergeInvestmentRealtimeQuotePayloads(...quoteGroups) {
        const merged = new Map();
        quoteGroups.flat().forEach((quote) => {
            const ticker = normalizeInvestmentTicker(quote?.ticker);
            if (!ticker || !isInvestmentHoldingsRealtimeQuote(quote)) return;
            merged.set(ticker, quote);
        });
        return Array.from(merged.values());
    }

    async function bootstrapInvestmentSessionRealtimeQuotes(latestSnapshot) {
        const tickers = getInvestmentRealtimeTickersFromSnapshot(latestSnapshot);
        if (!tickers.length) return [];
        try {
            return await requestInvestmentRealtimeQuotes(tickers);
        } catch (error) {
            if (!isLifecycleInterruptedFetch(error)) {
                console.warn('Unable to bootstrap investment session realtime quotes', error);
            }
            return [];
        }
    }

    function resetInvestmentRealtimeChartState() {
        const baseChartPoints = Array.isArray(investmentBaseChartPointsCache)
            ? investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
            : [];
        const hasRealtimePoint = Array.isArray(investmentChartPointsCache)
            && investmentChartPointsCache.some((point) => point?.is_realtime === true);
        if (!hasRealtimePoint || !baseChartPoints.length) return;
        investmentChartPointsCache = [...baseChartPoints];
        if (!isInvestmentDailyEquityLiveRange()) return;
        renderInvestmentHistoryTableRows(
            investmentProcessedTransactionsCache,
            baseChartPoints,
            { resetPage: false, scrollToTop: false },
        );
        updateInvestmentEquityChartDisplay(getInvestmentEquityChartInputPoints(baseChartPoints));
        const latestBasePoint = baseChartPoints[baseChartPoints.length - 1] || null;
        if (!latestBasePoint) return;
        renderInvestmentDummyPortfolioDonut(latestBasePoint, investmentDummyTickerProfiles);
        syncInvestmentDummyDonutFromInteraction();
        if (activeInvestmentView === 'stock_details') {
            syncInvestmentStockDetailsDonutFromInteraction();
        }
    }

    function resetInvestmentRealtimeState() {
        const baseChartPoints = Array.isArray(investmentBaseChartPointsCache)
            ? investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
            : [];
        const hasRealtimePoint = Array.isArray(investmentChartPointsCache)
            && investmentChartPointsCache.some((point) => point?.is_realtime === true);
        const latestSnapshot = Array.isArray(investmentProcessedTransactionsCache) && investmentProcessedTransactionsCache.length
            ? investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]
            : null;
        if (!hasRealtimePoint || !baseChartPoints.length || !latestSnapshot) return;
        const baseLatestPrices = investmentBaseLatestPricesCache && typeof investmentBaseLatestPricesCache === 'object'
            ? { ...investmentBaseLatestPricesCache }
            : {};
        investmentLatestPricesCache = { ...baseLatestPrices };
        investmentChartPointsCache = [...baseChartPoints];
        updateDashboardWithEquity(
            investmentProcessedTransactionsCache,
            latestSnapshot,
            baseLatestPrices,
            investmentRawTransactionsCache,
            baseChartPoints,
            investmentTickerClosePricesCache,
            { refreshStockDetailsPanel: false },
        );
    }

    function getInvestmentRealtimeOpenTickers() {
        const latestSnapshot = Array.isArray(investmentProcessedTransactionsCache) && investmentProcessedTransactionsCache.length
            ? investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]
            : null;
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const moneyMarketTickers = getMoneyMarketTickerSet();
        return Object.entries(holdings)
            .filter(([ticker, quantity]) => {
                const normalizedTicker = normalizeInvestmentTicker(ticker);
                const numericQuantity = Number(quantity);
                return (
                    normalizedTicker
                    && !isForexPairTicker(normalizedTicker)
                    && !moneyMarketTickers.has(normalizedTicker)
                    && Number.isFinite(numericQuantity)
                    && Math.abs(numericQuantity) > 1e-9
                );
            })
            .map(([ticker]) => normalizeInvestmentTicker(ticker));
    }

    function getInvestmentRealtimeHoldingsTickers() {
        const moneyMarketTickers = getMoneyMarketTickerSet();
        return Array.from(new Set(getAvailableInvestmentStockTickers()))
            .filter((ticker) => ticker && !isForexPairTicker(ticker) && !moneyMarketTickers.has(ticker));
    }

    function isInvestmentHoldingsRealtimeQuote(quote) {
        const ticker = normalizeInvestmentTicker(quote?.ticker);
        const price = Number(quote?.price);
        return Boolean(ticker) && Number.isFinite(price) && price > 0;
    }

    function buildInvestmentRealtimeTimestamp(quotes = []) {
        const timestamps = (Array.isArray(quotes) ? quotes : [])
            .map((quote) => String(quote?.timestamp || '').trim())
            .filter(Boolean)
            .sort();
        if (timestamps.length) return timestamps[timestamps.length - 1];
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function buildInvestmentRealtimeChartPoints(quotes = []) {
        if (!isInvestmentDailyEquityLiveRange()) {
            return Array.isArray(investmentBaseChartPointsCache)
                ? investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
                : [];
        }
        const baseChartPoints = ensureInvestmentLiveSessionChartSlot(
            Array.isArray(investmentBaseChartPointsCache)
                ? investmentBaseChartPointsCache.filter((point) => point?.is_realtime !== true)
                : [],
        );
        if (!baseChartPoints.length || !investmentProcessedTransactionsCache.length) return baseChartPoints;

        const latestSnapshot = investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1];
        const latestBasePoint = baseChartPoints[baseChartPoints.length - 1];
        const quoteByTicker = new Map(
            (Array.isArray(quotes) ? quotes : [])
                .map((quote) => [normalizeInvestmentTicker(quote?.ticker), quote])
                .filter(([ticker, quote]) => ticker && Number.isFinite(Number(quote?.price)))
        );
        if (!quoteByTicker.size) return baseChartPoints;

        const livePrices = { ...investmentLatestPricesCache };
        quoteByTicker.forEach((quote, ticker) => {
            const price = Number(quote?.price);
            if (Number.isFinite(price) && price > 0) {
                livePrices[ticker] = price;
            }
        });

        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(investmentProcessedTransactionsCache, baseCurrency);
        const valuationDate = normalizeLedgerDate(buildInvestmentRealtimeTimestamp(quotes))
            || normalizeLedgerDate(latestSnapshot?.date)
            || normalizeLedgerDate(latestBasePoint?.date);
        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const moneyMarketTickers = getMoneyMarketTickerSet();
        let aggregateMarketValue = 0;
        const holdingsMarketValues = {};

        Object.entries(holdings).forEach(([ticker, quantity]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            const numericQuantity = Number(quantity);
            if (!normalizedTicker || isForexPairTicker(normalizedTicker) || !Number.isFinite(numericQuantity)) return;
            let price = Number(livePrices[normalizedTicker]);
            if (moneyMarketTickers.has(normalizedTicker)) {
                const anchoredPrice = latestSnapshot?.aggregate_money_market_anchors?.[normalizedTicker]
                    ?? latestSnapshot?.money_market_anchors?.[normalizedTicker];
                if (Number.isFinite(Number(anchoredPrice))) {
                    price = Number(anchoredPrice);
                }
            }
            if (!Number.isFinite(price) || price <= 0) return;
            const quoteCurrency = getTickerQuoteCurrency(normalizedTicker);
            const marketValue = convertAmountToBaseCurrency(
                numericQuantity * price,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            holdingsMarketValues[normalizedTicker] = marketValue;
            aggregateMarketValue += marketValue;
        });

        const aggregateRunningCash = Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash) || 0;
        const aggregatePendingSettlementCash = Number(latestSnapshot?.aggregate_pending_settlement_cash) || 0;
        const rawAggregateDisplayCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : aggregateRunningCash + aggregatePendingSettlementCash;
        const realtimeTimestamp = buildInvestmentRealtimeTimestamp(quotes);
        const realtimeDateKey = normalizeLedgerDate(realtimeTimestamp)
            || getInvestmentDailyEquityLiveSessionDateKey()
            || normalizeLedgerDate(latestBasePoint?.date);
        const session = Array.from(quoteByTicker.values()).find((quote) => quote?.session)?.session || 'realtime';
        const targetIndex = findInvestmentChartPointIndexForLedgerDate(baseChartPoints, realtimeDateKey);
        const anchorPoint = targetIndex >= 0 ? baseChartPoints[targetIndex] : (latestBasePoint || {});
        const realtimePoint = {
            ...anchorPoint,
            date: realtimeDateKey || realtimeTimestamp,
            realtime_timestamp: realtimeTimestamp,
            running_cash: aggregateRunningCash,
            aggregate_running_cash: aggregateRunningCash,
            aggregate_display_cash: aggregateDisplayCash,
            market_value: aggregateMarketValue,
            aggregate_market_value: aggregateMarketValue,
            holdings_market_values: holdingsMarketValues,
            aggregate_holdings_market_values: holdingsMarketValues,
            total_equity: aggregateDisplayCash + aggregateMarketValue,
            aggregate_total_equity: aggregateDisplayCash + aggregateMarketValue,
            anchor_ledger_date: '',
            anchor_ledger_nos: [],
            cash_in_amount: 0,
            cash_out_amount: 0,
            net_transfer_amount: 0,
            cumulative_net_transfer_amount: Number(latestBasePoint?.cumulative_net_transfer_amount) || 0,
            is_trading_day: false,
            is_realtime: true,
            is_live_session_slot: false,
            realtime_session: session,
            realtime_source: 'yfinance',
            previous_trading_point_index: Number.isFinite(Number(anchorPoint?.previous_trading_point_index))
                ? Number(anchorPoint.previous_trading_point_index)
                : (targetIndex > 0 ? targetIndex - 1 : -1),
        };

        if (targetIndex >= 0) {
            const nextChartPoints = [...baseChartPoints];
            nextChartPoints[targetIndex] = realtimePoint;
            return dedupeInvestmentChartPointsByLedgerDate(nextChartPoints);
        }
        return dedupeInvestmentChartPointsByLedgerDate([...baseChartPoints, realtimePoint]);
    }

    function applyInvestmentRealtimeQuotes(quotes = []) {
        const holdingsQuotes = (Array.isArray(quotes) ? quotes : [])
            .filter((quote) => isInvestmentHoldingsRealtimeQuote(quote));
        const liveSessionQuotes = holdingsQuotes.filter((quote) => shouldApplyInvestmentRealtimePriceForHoldings(quote));
        if (liveSessionQuotes.length) {
            liveSessionQuotes.forEach((quote) => {
                const ticker = normalizeInvestmentTicker(quote?.ticker);
                const price = Number(quote?.price);
                investmentLatestPricesCache[ticker] = price;
                investmentBaseLatestPricesCache[ticker] = price;
            });
            syncInvestmentHoldingsRealtimeValues();
        }

        if (!liveSessionQuotes.length) {
            if (shouldRunInvestmentRealtimeQuotes()) {
                resetInvestmentRealtimeChartState();
            }
            return;
        }
        const liveChartPoints = buildInvestmentRealtimeChartPoints(liveSessionQuotes);
        if (isInvestmentDailyEquityLiveRange() && liveChartPoints.length && liveChartPoints !== investmentChartPointsCache) {
            investmentChartPointsCache = liveChartPoints;
        }
        if (!isInvestmentDailyEquityLiveRange()) return;
        if (!liveChartPoints.length || liveChartPoints === investmentChartPointsCache) return;
        investmentChartPointsCache = liveChartPoints;
        renderInvestmentHistoryTableRows(investmentProcessedTransactionsCache, liveChartPoints, { resetPage: false, scrollToTop: false });
        syncInvestmentEquityChartRealtime(liveChartPoints);
        const latestLiveChartPoint = liveChartPoints[liveChartPoints.length - 1] || null;
        if (latestLiveChartPoint) {
            renderInvestmentDummyPortfolioDonut(latestLiveChartPoint, investmentDummyTickerProfiles);
            syncInvestmentDummyDonutFromInteraction();
            if (activeInvestmentView === 'stock_details') {
                syncInvestmentStockDetailsDonutFromInteraction();
            }
        }
    }

    function scheduleInvestmentRealtimeQuotePolling() {
        if (investmentPageDisposed || !investmentProcessedTransactionsCache.length) return;
        const tickers = getInvestmentRealtimeHoldingsTickers();
        if (!tickers.length) return;
        if (investmentRealtimeQuoteTimer) {
            window.clearTimeout(investmentRealtimeQuoteTimer);
        }
        const delayMs = shouldRunInvestmentRealtimeQuotes()
            ? INVESTMENT_REALTIME_QUOTE_POLL_MS
            : INVESTMENT_REALTIME_QUOTE_IDLE_CHECK_MS;
        investmentRealtimeQuoteTimer = window.setTimeout(() => {
            pollInvestmentRealtimeQuotes();
        }, delayMs);
    }

    async function pollInvestmentRealtimeQuotes() {
        if (investmentPageDisposed || investmentRealtimeQuoteInflight) return;
        const tickers = getInvestmentRealtimeHoldingsTickers();
        if (!tickers.length) return;
        if (!shouldRunInvestmentRealtimeQuotes()) {
            resetInvestmentRealtimeChartState();
            scheduleInvestmentRealtimeQuotePolling();
            return;
        }
        investmentRealtimeQuoteInflight = true;
        investmentRealtimeQuoteAbortController = new AbortController();
        try {
            const quotes = await requestInvestmentRealtimeQuotes(tickers, {
                signal: investmentRealtimeQuoteAbortController.signal,
            });
            if (quotes.length) {
                applyInvestmentRealtimeQuotes(quotes);
            } else if (shouldRunInvestmentRealtimeQuotes()) {
                resetInvestmentRealtimeChartState();
            }
        } catch (error) {
            if (!isLifecycleInterruptedFetch(error)) {
                console.warn('Unable to refresh investment realtime quotes', error);
            }
        } finally {
            investmentRealtimeQuoteInflight = false;
            investmentRealtimeQuoteAbortController = null;
            scheduleInvestmentRealtimeQuotePolling();
        }
    }

    function restartInvestmentRealtimeQuotePolling() {
        stopInvestmentRealtimeQuotePolling();
        void refreshInvestmentMarketSessionState({ force: true })
            .catch(() => null)
            .then(() => pollInvestmentRealtimeQuotes());
    }

    function readInvestmentPageMemory() {
        try {
            const raw = window.localStorage.getItem(INVESTMENT_PAGE_MEMORY_STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            return {};
        }
    }

    function writeInvestmentPageMemory(nextMemory) {
        try {
            window.localStorage.setItem(INVESTMENT_PAGE_MEMORY_STORAGE_KEY, JSON.stringify(nextMemory));
        } catch (_error) {
        }
    }

    function rememberInvestmentPageState({
        view = activeInvestmentView || 'chart',
        ticker = selectedInvestmentStockTicker || '',
        range = selectedInvestmentStockDetailsRange || 'max',
        equityRange = selectedInvestmentEquityRange || 'max',
    } = {}) {
        const normalizedView = normalizeInvestmentView(view);
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        const normalizedEquityRange = normalizeInvestmentEquityRange(equityRange);
        const nextUrl = buildInvestmentViewUrl(normalizedView, normalizedTicker);
        const currentMemory = readInvestmentPageMemory();
        writeInvestmentPageMemory({
            ...currentMemory,
            page_key: 'investment',
            page_path: '/trade/investment',
            last_used_at: new Date().toISOString(),
            last_view: normalizedView,
            last_stock_ticker: normalizedTicker,
            last_stock_details_range: normalizedRange,
            last_equity_range: normalizedEquityRange,
            last_stock_details_url: normalizedView === 'stock_details' ? nextUrl : buildInvestmentViewUrl('stock_details', normalizedTicker),
        });
    }

    function restoreRememberedInvestmentPageState() {
        const memory = readInvestmentPageMemory();
        const rememberedTicker = normalizeInvestmentTicker(memory.last_stock_ticker || '');
        const rememberedRange = normalizeInvestmentStockDetailsRange(memory.last_stock_details_range || 'max');
        const rememberedEquityRange = normalizeInvestmentEquityRange(memory.last_equity_range || 'max');
        if (rememberedTicker) {
            selectedInvestmentStockTicker = rememberedTicker;
        }
        selectedInvestmentStockDetailsRange = rememberedRange;
        selectedInvestmentEquityRange = rememberedEquityRange;
        return normalizeInvestmentView(memory.last_view || 'chart');
    }

    function restoreRememberedInvestmentLocation() {
        const currentHash = String(window.location.hash || '').trim();
        const currentTicker = getInvestmentLocationTicker();
        if (currentHash || currentTicker) return false;
        const memory = readInvestmentPageMemory();
        if (normalizeInvestmentView(memory.last_view || '') !== 'stock_details') return false;
        const rememberedUrl = String(memory.last_stock_details_url || '').trim();
        if (!rememberedUrl) return false;
        try {
            const parsed = new URL(rememberedUrl, window.location.origin);
            if (parsed.pathname !== window.location.pathname) return false;
            window.history.replaceState(null, '', `${parsed.pathname}${parsed.search}${parsed.hash}`);
            return true;
        } catch (_error) {
            return false;
        }
    }

    function normalizeInvestmentInternalTransferBindings(rawBindings) {
        if (!rawBindings || typeof rawBindings !== 'object') return {};
        return Object.entries(rawBindings).reduce((nextBindings, [sourceKey, targetKey]) => {
            const normalizedSourceKey = String(sourceKey || '').trim();
            const normalizedTargetKey = String(targetKey || '').trim();
            if (!normalizedSourceKey || !normalizedTargetKey) return nextBindings;
            nextBindings[normalizedSourceKey] = normalizedTargetKey;
            return nextBindings;
        }, {});
    }

    function readInvestmentInternalTransferBindings() {
        const serverBindings = normalizeInvestmentInternalTransferBindings(
            window.ANTIGRAVITY_INVESTMENT_DATA?.manual_internal_transfer_bindings
        );
        let localBindings = {};
        try {
            const raw = window.localStorage.getItem(INVESTMENT_INTERNAL_TRANSFER_BINDINGS_STORAGE_KEY);
            if (raw) {
                localBindings = normalizeInvestmentInternalTransferBindings(JSON.parse(raw));
            }
        } catch (_error) {
            // ignore corrupt localStorage
        }
        return { ...serverBindings, ...localBindings };
    }

    function writeInvestmentInternalTransferBindings(nextBindings) {
        try {
            window.localStorage.setItem(
                INVESTMENT_INTERNAL_TRANSFER_BINDINGS_STORAGE_KEY,
                JSON.stringify(normalizeInvestmentInternalTransferBindings(nextBindings))
            );
        } catch (_error) {
        }
    }

    function rememberInvestmentInternalTransferBinding(sourceKey, targetKey) {
        const normalizedSourceKey = String(sourceKey || '').trim();
        const normalizedTargetKey = String(targetKey || '').trim();
        if (!normalizedSourceKey) return;
        const nextBindings = {
            ...readInvestmentInternalTransferBindings(),
        };
        Object.entries(nextBindings).forEach(([existingSourceKey, existingTargetKey]) => {
            if (existingSourceKey !== normalizedSourceKey && existingTargetKey === normalizedTargetKey) {
                delete nextBindings[existingSourceKey];
            }
        });
        if (normalizedTargetKey) {
            nextBindings[normalizedSourceKey] = normalizedTargetKey;
        } else {
            delete nextBindings[normalizedSourceKey];
        }
        writeInvestmentInternalTransferBindings(nextBindings);
        try {
            fetch('/api/investment/internal-transfer-binding', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_key: normalizedSourceKey,
                    target_key: normalizedTargetKey,
                }),
            }).catch(() => {});
        } catch (_error) {
            // fire-and-forget: do not block the UI if the server is unreachable
        }
    }

    function buildInvestmentTransactionBindingKey(txn) {
        if (!txn || typeof txn !== 'object') return '';
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const amountText = String(
            txn?.net_amount_raw
            ?? txn?.gross_amount_raw
            ?? txn?.normalized?.net_amount
            ?? txn?.normalized?.gross_amount
            ?? txn?.amount
            ?? ''
        ).trim();
        const descriptionText = String(txn?.description || '').replace(/\s+/g, ' ').trim();
        const brokerCode = getTransactionBrokerCode(txn);
        const accountText = String(txn?.account || source?.account || source?.account_number || '').trim();
        const referenceText = String(
            source?.reference_id
            ?? source?.row_number
            ?? source?.order_reference
            ?? source?.transaction_type_raw
            ?? ''
        ).trim();
        const currencyText = String(txn?.currency || '').trim().toUpperCase();
        return [
            brokerCode,
            accountText,
            String(txn?.date || '').trim(),
            getNormalizedTransactionType(txn),
            currencyText,
            amountText,
            descriptionText,
            String(source?.file_kind || '').trim(),
            referenceText,
        ].join('|');
    }

    function parseInvestmentLedgerDateUtc(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
        return new Date(Date.UTC(year, monthIndex, day));
    }

    function getInvestmentLedgerDateDistanceDays(leftDate, rightDate) {
        const left = parseInvestmentLedgerDateUtc(leftDate);
        const right = parseInvestmentLedgerDateUtc(rightDate);
        if (!(left instanceof Date) || !(right instanceof Date) || Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.round(Math.abs(right.getTime() - left.getTime()) / 86400000);
    }

    function getInvestmentInternalTransferDirection(txn) {
        const brokerCode = normalizeInvestmentBroker(getTransactionBrokerCode(txn));
        const normalizedType = getNormalizedTransactionType(txn);
        if (brokerCode !== 'hsbc' && normalizedType === 'deposit') return 'hsbc_to_broker';
        if (brokerCode === 'hsbc' && normalizedType === 'deposit') return 'broker_to_hsbc';
        return '';
    }

    function isInvestmentInternalTransferSourceCandidate(txn) {
        if (!getInvestmentInternalTransferDirection(txn)) return false;
        if (String(txn?.ticker || '').trim()) return false;
        return Math.abs(Number(getTransactionAmount(txn)) || 0) > 1e-9;
    }

    function isInvestmentInternalTransferTargetCandidateForDirection(txn, direction) {
        const brokerCode = normalizeInvestmentBroker(getTransactionBrokerCode(txn));
        if (direction === 'hsbc_to_broker' && brokerCode !== 'hsbc') return false;
        if (direction === 'broker_to_hsbc' && brokerCode === 'hsbc') return false;
        if (getNormalizedTransactionType(txn) !== 'withdrawal') return false;
        if (String(txn?.ticker || '').trim()) return false;
        return Math.abs(Number(getTransactionAmount(txn)) || 0) > 1e-9;
    }

    function getInvestmentInternalTransferPairAmount(sourceTxn, targetTxn) {
        const sourceAmount = Math.abs(Number(getTransactionAmount(sourceTxn)) || 0);
        const targetAmount = Math.abs(Number(getTransactionAmount(targetTxn)) || 0);
        return Math.min(sourceAmount, targetAmount);
    }

    function getInvestmentInternalTransferFeeAmount(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (!direction) return 0;
        const sourceAmount = Math.abs(Number(getTransactionAmount(sourceTxn)) || 0);
        const targetAmount = Math.abs(Number(getTransactionAmount(targetTxn)) || 0);
        const feeAmount = targetAmount - sourceAmount;
        return feeAmount > 0.005 ? feeAmount : 0;
    }

    function getInvestmentInternalTransferCommissionTxn(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (direction === 'broker_to_hsbc') return sourceTxn;
        if (direction === 'hsbc_to_broker') return targetTxn;
        return null;
    }

    function formatInvestmentTransferAccountCompact(txn) {
        const accountText = String(
            txn?.account
            || txn?.source?.account
            || txn?.source?.account_number
            || ''
        ).trim();
        if (!accountText) return '';
        const normalized = accountText.replace(/\s+/g, '');
        if (normalized.includes('-')) {
            return normalized.split('-').pop() || normalized;
        }
        return normalized.length > 4 ? normalized.slice(-4) : normalized;
    }

    function formatInvestmentInternalTransferOptionLabel(txn, metadata = {}) {
        const brokerLabel = getInvestmentBrokerMeta(getTransactionBrokerCode(txn)).label;
        const accountCompact = formatInvestmentTransferAccountCompact(txn);
        const dateLabel = formatTransactionDateDisplay(txn);
        const descriptionLabel = String(formatTransactionDescription(txn) || '').replace(/\s+/g, ' ').trim() || '--';
        const amountLabel = formatAmountWithCurrency(getTransactionAmount(txn), formatTransactionCurrency(txn), { showUsdSymbol: false });
        const feeAmount = Number(metadata?.feeAmount) || 0;
        const feeLabel = feeAmount > 0.005
            ? `includes ${formatInvestmentInternalTransferFeeAmount(feeAmount, formatTransactionCurrency(txn) || 'USD')} transfer fee`
            : '';
        return [
            accountCompact ? `${brokerLabel} ${accountCompact}` : brokerLabel,
            dateLabel,
            descriptionLabel,
            amountLabel,
            feeLabel,
        ].filter(Boolean).join(' · ');
    }

    function formatInvestmentInternalTransferFeeAmount(feeAmount, currency) {
        const normalizedCurrency = String(currency || '').trim().toUpperCase() || 'USD';
        const amountText = formatAmount(Number(feeAmount) || 0);
        return normalizedCurrency === 'USD'
            ? `USD ${amountText}`
            : `${normalizedCurrency} ${amountText}`;
    }

    function formatInvestmentInternalTransferFeeNote(feeAmount, currency) {
        const numericFeeAmount = Number(feeAmount);
        if (!Number.isFinite(numericFeeAmount) || numericFeeAmount <= 0.005) return '';
        return `Transfer fee ${formatInvestmentInternalTransferFeeAmount(numericFeeAmount, currency || 'USD')} will be recorded as HSBC commission.`;
    }

    function getInvestmentInternalTransferReferenceText(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return String(
            source?.reference_id
            || txn?.description
            || source?.row_number
            || ''
        ).replace(/\s+/g, ' ').trim();
    }

    function getInvestmentResolvedTransferDescription(txn) {
        const sourceKey = String(txn?.manual_internal_transfer_source_key || txn?.manual_internal_transfer_key || '').trim();
        if (!sourceKey) return '';
        const binding = investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey);
        if (!binding?.targetTxn) return '';
        if (getInvestmentInternalTransferDirection(binding.sourceTxn) === 'broker_to_hsbc') {
            const sourceReferenceText = getInvestmentInternalTransferReferenceText(binding.sourceTxn);
            return sourceReferenceText || '';
        }
        const referenceText = getInvestmentInternalTransferReferenceText(binding.targetTxn);
        return referenceText || '';
    }

    function formatInvestmentHistoryCurrencyDisplay(txn) {
        const explicitCurrency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
        if (explicitCurrency) return explicitCurrency;
        if (txn?.manual_internal_transfer_role === 'source' && txn?.manual_internal_transfer_selected_target_key) {
            return String(txn?.manual_internal_transfer_currency || 'USD').trim().toUpperCase() || 'USD';
        }
        return '';
    }

    function buildInvestmentInternalTransferContext(processedTransactions = []) {
        const sourceOptionsByKey = new Map();
        const resolvedBindingsBySourceKey = new Map();
        const targetByKey = new Map();
        const sourceTransactions = [];
        const targetTransactions = [];
        const storedBindings = readInvestmentInternalTransferBindings();

        processedTransactions.forEach((txn) => {
            const transactionKey = buildInvestmentTransactionBindingKey(txn);
            txn.manual_internal_transfer_key = transactionKey;
            if (!transactionKey) return;
            if (isInvestmentInternalTransferSourceCandidate(txn)) {
                sourceTransactions.push(txn);
            }
            if (getNormalizedTransactionType(txn) === 'withdrawal' && Math.abs(Number(getTransactionAmount(txn)) || 0) > 1e-9) {
                targetTransactions.push(txn);
                targetByKey.set(transactionKey, txn);
            }
        });

        sourceTransactions.forEach((sourceTxn) => {
            const sourceKey = String(sourceTxn?.manual_internal_transfer_key || '').trim();
            if (!sourceKey) return;
            const direction = getInvestmentInternalTransferDirection(sourceTxn);
            if (!direction) return;
            const selectedTargetKey = String(storedBindings[sourceKey] || '').trim();
            const sourceAmount = Math.abs(Number(getTransactionAmount(sourceTxn)) || 0);
            const sourceDate = normalizeLedgerDate(sourceTxn?.date);
            const amountTolerance = Math.max(0.01, sourceAmount * 0.02);
            const selectedTargetCandidate = selectedTargetKey ? targetByKey.get(selectedTargetKey) || null : null;
            const selectedTarget = (
                selectedTargetCandidate
                && isInvestmentInternalTransferTargetCandidateForDirection(selectedTargetCandidate, direction)
            )
                ? selectedTargetCandidate
                : null;
            const options = targetTransactions
                .filter((targetTxn) => {
                    const targetKey = String(targetTxn?.manual_internal_transfer_key || '').trim();
                    if (!targetKey || targetKey === selectedTargetKey) return Boolean(targetKey);
                    if (!isInvestmentInternalTransferTargetCandidateForDirection(targetTxn, direction)) return false;
                    const targetDate = normalizeLedgerDate(targetTxn?.date);
                    const dayDistance = getInvestmentLedgerDateDistanceDays(sourceDate, targetDate);
                    if (!Number.isFinite(dayDistance) || dayDistance > INVESTMENT_INTERNAL_TRANSFER_LINK_WINDOW_DAYS) return false;
                    const targetAmount = Math.abs(Number(getTransactionAmount(targetTxn)) || 0);
                    if (Math.abs(targetAmount - sourceAmount) > amountTolerance) return false;
                    const sourceCurrency = String(formatTransactionCurrency(sourceTxn) || '').trim().toUpperCase();
                    const targetCurrency = String(formatTransactionCurrency(targetTxn) || '').trim().toUpperCase();
                    return !sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency;
                })
                .map((targetTxn) => {
                    const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, targetTxn);
                    return {
                        key: String(targetTxn?.manual_internal_transfer_key || '').trim(),
                        label: formatInvestmentInternalTransferOptionLabel(targetTxn, { feeAmount }),
                        targetTxn,
                        dayDistance: getInvestmentLedgerDateDistanceDays(sourceDate, normalizeLedgerDate(targetTxn?.date)),
                        amountDiff: Math.abs((Math.abs(Number(getTransactionAmount(targetTxn)) || 0)) - sourceAmount),
                        feeAmount,
                        feeNote: formatInvestmentInternalTransferFeeNote(
                            feeAmount,
                            formatTransactionCurrency(sourceTxn) || formatTransactionCurrency(targetTxn) || 'USD'
                        ),
                    };
                })
                .sort((left, right) => (
                    left.amountDiff - right.amountDiff
                    || left.dayDistance - right.dayDistance
                    || left.feeAmount - right.feeAmount
                    || String(left.targetTxn?.date || '').localeCompare(String(right.targetTxn?.date || ''))
                    || (Number(left.targetTxn?.ledger_no) || 0) - (Number(right.targetTxn?.ledger_no) || 0)
                ));

            if (selectedTarget && !options.some((option) => option.key === selectedTargetKey)) {
                const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, selectedTarget);
                options.unshift({
                    key: selectedTargetKey,
                    label: formatInvestmentInternalTransferOptionLabel(selectedTarget, { feeAmount }),
                    targetTxn: selectedTarget,
                    dayDistance: getInvestmentLedgerDateDistanceDays(sourceDate, normalizeLedgerDate(selectedTarget?.date)),
                    amountDiff: Math.abs((Math.abs(Number(getTransactionAmount(selectedTarget)) || 0)) - sourceAmount),
                    feeAmount,
                    feeNote: formatInvestmentInternalTransferFeeNote(
                        feeAmount,
                        formatTransactionCurrency(sourceTxn) || formatTransactionCurrency(selectedTarget) || 'USD'
                    ),
                });
            }

            sourceOptionsByKey.set(sourceKey, options);
            if (selectedTarget) {
                const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, selectedTarget);
                resolvedBindingsBySourceKey.set(sourceKey, {
                    sourceKey,
                    targetKey: selectedTargetKey,
                    sourceTxn,
                    targetTxn: selectedTarget,
                    amount: getInvestmentInternalTransferPairAmount(sourceTxn, selectedTarget),
                    feeAmount,
                    commissionTxn: getInvestmentInternalTransferCommissionTxn(sourceTxn, selectedTarget),
                    feeNote: formatInvestmentInternalTransferFeeNote(
                        feeAmount,
                        formatTransactionCurrency(sourceTxn) || formatTransactionCurrency(selectedTarget) || 'USD'
                    ),
                });
            }
        });

        return {
            sourceOptionsByKey,
            resolvedBindingsBySourceKey,
        };
    }

    function applyAuthoritativeBrokerEndingCashBalances(processedTransactions = []) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        if (!transactions.length) return;

        const brokerCodes = Array.from(new Set(
            transactions
                .map((txn) => normalizeInvestmentBroker(getTransactionBrokerCode(txn)))
                .filter(Boolean)
        ));

        brokerCodes.forEach((brokerCode) => {
            const authoritativeEndingCash = getInvestmentBrokerEndingCash(brokerCode);
            if (authoritativeEndingCash === null) return;

            const lastBrokerTxn = [...transactions].reverse().find(
                (txn) => normalizeInvestmentBroker(getTransactionBrokerCode(txn)) === brokerCode
            );
            if (!lastBrokerTxn) return;

            if (brokerCode === 'hsbc') {
                const replayedCash = Number(lastBrokerTxn.broker_running_cash);
                if (Number.isFinite(replayedCash) && Math.abs(replayedCash - authoritativeEndingCash) < 0.005) {
                    return;
                }
            }

            const normalizedEndingCash = Math.max(0, authoritativeEndingCash);
            lastBrokerTxn.broker_running_cash = normalizedEndingCash;
            lastBrokerTxn.broker_cash_by_currency = createCashLedger(
                normalizedEndingCash,
                getInvestmentBaseCurrency(),
            );
            const brokerMarketValue = Number(lastBrokerTxn.broker_market_value) || 0;
            const brokerPendingSettlementCash = Number(lastBrokerTxn.broker_pending_settlement_cash) || 0;
            lastBrokerTxn.broker_display_cash = normalizedEndingCash + brokerPendingSettlementCash;
            lastBrokerTxn.broker_total_equity = normalizedEndingCash + brokerMarketValue + brokerPendingSettlementCash;
        });

        const isSingleBroker = brokerCodes.length <= 1;
        if (!isSingleBroker) {
            const latestProcessed = transactions[transactions.length - 1];
            if (latestProcessed) {
                let finalAggregateCash = 0;
                brokerCodes.forEach((brokerCode) => {
                    const normBroker = normalizeInvestmentBroker(brokerCode);
                    const authEndingCash = getInvestmentBrokerEndingCash(normBroker);
                    const lastBrokerTxn = [...transactions].reverse().find(
                        (txn) => normalizeInvestmentBroker(getTransactionBrokerCode(txn)) === normBroker
                    );
                    let brokerEndingCash = 0;
                    if (authEndingCash !== null) {
                        brokerEndingCash = Math.max(0, authEndingCash);
                    } else if (lastBrokerTxn) {
                        brokerEndingCash = Number(lastBrokerTxn.broker_running_cash) || 0;
                    }
                    finalAggregateCash += brokerEndingCash;
                });
                latestProcessed.running_cash = finalAggregateCash;
                latestProcessed.aggregate_running_cash = finalAggregateCash;
                latestProcessed.cash_by_currency = createCashLedger(
                    finalAggregateCash,
                    getInvestmentBaseCurrency(),
                );
                latestProcessed.aggregate_cash_by_currency = latestProcessed.cash_by_currency;
                const marketVal = Number(latestProcessed.market_value) || 0;
                const aggregatePendingSettlementCash = Number(latestProcessed.aggregate_pending_settlement_cash) || 0;
                latestProcessed.aggregate_display_cash = finalAggregateCash + aggregatePendingSettlementCash;
                latestProcessed.total_equity = finalAggregateCash + marketVal + aggregatePendingSettlementCash;
                latestProcessed.aggregate_total_equity = latestProcessed.total_equity;
            }
        }
    }

    function applyInvestmentInternalTransferBindings(processedTransactions = []) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const context = buildInvestmentInternalTransferContext(transactions);
        investmentInternalTransferSourceOptionsByKey = context.sourceOptionsByKey;
        investmentInternalTransferResolvedBindingsBySourceKey = context.resolvedBindingsBySourceKey;
        transactions.forEach((txn) => {
            const rawRunningCash = Number(txn?.aggregate_raw_running_cash ?? txn?.aggregate_running_cash ?? txn?.running_cash) || 0;
            const rawPendingSettlementCash = Number(txn?.aggregate_pending_settlement_cash) || 0;
            const rawDisplayCash = Number.isFinite(Number(txn?.aggregate_raw_display_cash ?? txn?.aggregate_display_cash))
                ? Number(txn?.aggregate_raw_display_cash ?? txn?.aggregate_display_cash)
                : rawRunningCash + rawPendingSettlementCash;
            const rawMarketValue = Number(txn?.aggregate_raw_market_value ?? txn?.aggregate_market_value ?? txn?.market_value) || 0;
            txn.aggregate_raw_running_cash = rawRunningCash;
            txn.aggregate_raw_display_cash = rawDisplayCash;
            txn.aggregate_raw_market_value = rawMarketValue;
            txn.aggregate_raw_total_equity = rawDisplayCash + rawMarketValue;
            txn.aggregate_running_cash = rawRunningCash;
            txn.aggregate_display_cash = rawDisplayCash;
            txn.aggregate_market_value = rawMarketValue;
            txn.aggregate_total_equity = rawDisplayCash + rawMarketValue;
            txn.running_cash = txn.aggregate_running_cash;
            txn.market_value = txn.aggregate_market_value;
            txn.total_equity = txn.aggregate_total_equity;
            txn.aggregate_bridge_adjustment = 0;
            txn.manual_internal_transfer_external_flow_excluded = false;
            txn.manual_internal_transfer_role = '';
            txn.manual_internal_transfer_pair_key = '';
            txn.manual_internal_transfer_pair_amount = 0;
            txn.manual_internal_transfer_source_key = '';
            txn.manual_internal_transfer_selected_target_key = '';
            txn.manual_internal_transfer_currency = '';
            txn.manual_internal_transfer_candidate_count = 0;
            txn.manual_internal_transfer_needs_binding = false;
            txn.manual_internal_transfer_fee_amount = 0;
            txn.manual_internal_transfer_fee_note = '';
            txn.manual_internal_transfer_commission_amount = 0;
        });

        const bridgeDeltasByIndex = new Map();
        const addBridgeDelta = (index, amount) => {
            if (!Number.isInteger(index) || index < 0 || !Number.isFinite(amount) || Math.abs(amount) <= 1e-9) return;
            bridgeDeltasByIndex.set(index, (Number(bridgeDeltasByIndex.get(index)) || 0) + amount);
        };

        transactions.forEach((txn) => {
            const sourceKey = String(txn?.manual_internal_transfer_key || '').trim();
            const options = sourceKey ? (investmentInternalTransferSourceOptionsByKey.get(sourceKey) || []) : [];
            const resolvedBinding = sourceKey ? investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey) || null : null;
            if (!sourceKey || !options.length) return;
            txn.manual_internal_transfer_source_key = sourceKey;
            txn.manual_internal_transfer_candidate_count = options.length;
            txn.manual_internal_transfer_selected_target_key = String(resolvedBinding?.targetKey || '').trim();
            txn.manual_internal_transfer_needs_binding = !resolvedBinding;
            const pendingFeeOption = options.find((option) => Number(option?.feeAmount) > 0.005) || null;
            txn.manual_internal_transfer_fee_amount = Number(resolvedBinding?.feeAmount ?? pendingFeeOption?.feeAmount ?? 0) || 0;
            txn.manual_internal_transfer_fee_note = String(resolvedBinding?.feeNote || pendingFeeOption?.feeNote || '').trim();
        });

        investmentInternalTransferResolvedBindingsBySourceKey.forEach((binding) => {
            const {
                sourceTxn,
                targetTxn,
                targetKey,
                amount,
                feeAmount,
                commissionTxn,
                feeNote,
            } = binding;
            const pairAmount = Number(amount) || 0;
            if (!(pairAmount > 1e-9)) return;
            sourceTxn.manual_internal_transfer_external_flow_excluded = true;
            sourceTxn.manual_internal_transfer_role = 'source';
            sourceTxn.manual_internal_transfer_pair_key = targetKey;
            sourceTxn.manual_internal_transfer_pair_amount = pairAmount;
            sourceTxn.manual_internal_transfer_currency = String(formatTransactionCurrency(targetTxn) || 'USD').trim().toUpperCase() || 'USD';
            targetTxn.manual_internal_transfer_external_flow_excluded = true;
            targetTxn.manual_internal_transfer_role = 'target';
            targetTxn.manual_internal_transfer_pair_key = String(sourceTxn?.manual_internal_transfer_key || '').trim();
            targetTxn.manual_internal_transfer_pair_amount = pairAmount;
            const numericFeeAmount = Number(feeAmount) || 0;
            if (numericFeeAmount > 0.005 && commissionTxn) {
                commissionTxn.manual_internal_transfer_fee_amount = numericFeeAmount;
                commissionTxn.manual_internal_transfer_fee_note = String(feeNote || '').trim();
                commissionTxn.manual_internal_transfer_commission_amount = -Math.abs(numericFeeAmount);
            }

            const sourceIndex = transactions.indexOf(sourceTxn);
            const targetIndex = transactions.indexOf(targetTxn);
            if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex < targetIndex) {
                addBridgeDelta(sourceIndex, -pairAmount);
                addBridgeDelta(targetIndex, pairAmount);
            } else if (sourceIndex >= 0 && targetIndex >= 0 && targetIndex < sourceIndex) {
                addBridgeDelta(targetIndex, pairAmount);
                addBridgeDelta(sourceIndex, -pairAmount);
            }
        });

        let cumulativeBridgeAdjustment = 0;
        transactions.forEach((txn, index) => {
            cumulativeBridgeAdjustment += Number(bridgeDeltasByIndex.get(index)) || 0;
            const rawRunningCash = Number(txn?.aggregate_raw_running_cash) || 0;
            const rawDisplayCash = Number(txn?.aggregate_raw_display_cash) || rawRunningCash;
            const rawMarketValue = Number(txn?.aggregate_raw_market_value) || 0;
            txn.aggregate_bridge_adjustment = cumulativeBridgeAdjustment;
            txn.aggregate_running_cash = rawRunningCash + cumulativeBridgeAdjustment;
            txn.aggregate_display_cash = rawDisplayCash + cumulativeBridgeAdjustment;
            txn.aggregate_market_value = rawMarketValue;
            txn.aggregate_total_equity = txn.aggregate_display_cash + rawMarketValue;
            txn.running_cash = txn.aggregate_running_cash;
            txn.market_value = txn.aggregate_market_value;
            txn.total_equity = txn.aggregate_total_equity;
        });
    }

    function getActionButtonLabels(button) {
        return {
            defaultLabel: String(button?.dataset?.defaultLabel || button?.textContent || '').trim() || 'Continue',
            pendingLabel: String(button?.dataset?.pendingLabel || '').trim() || 'Working',
        };
    }

    function renderPendingActionLabel(pendingLabel) {
        return /ing$/i.test(pendingLabel) ? `${pendingLabel}...` : pendingLabel;
    }

    function syncActionButtonState(button, { disabled = false, pending = false } = {}) {
        if (!button) return;
        const labels = getActionButtonLabels(button);
        const isDisabled = Boolean(disabled || pending);
        button.disabled = isDisabled;
        button.classList.toggle('is-pending', Boolean(pending));
        button.setAttribute('aria-disabled', String(isDisabled));
        if (pending) {
            button.setAttribute('aria-busy', 'true');
            button.textContent = renderPendingActionLabel(labels.pendingLabel);
            return;
        }
        button.removeAttribute('aria-busy');
        button.textContent = labels.defaultLabel;
    }

    function clearInvestmentSegmentedMeasureRaf() {
        if (!investmentSegmentedMeasureRaf) return;
        window.cancelAnimationFrame(investmentSegmentedMeasureRaf);
        investmentSegmentedMeasureRaf = 0;
    }

    function clearInvestmentSegmentedMeasureTimer() {
        if (!investmentSegmentedMeasureTimer) return;
        window.clearTimeout(investmentSegmentedMeasureTimer);
        investmentSegmentedMeasureTimer = 0;
    }

    const SEGMENTED_TEXT_RENDER_SAFETY_PX = 2;

    function measureSegmentedInlineContentWidth(element, renderSafetyPx = SEGMENTED_TEXT_RENDER_SAFETY_PX) {
        if (!(element instanceof HTMLElement)) return 0;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        let maxWidth = 0;
        rects.forEach((rect) => {
            maxWidth = Math.max(maxWidth, rect.width);
        });
        if (typeof range.detach === 'function') {
            range.detach();
        }
        if (maxWidth > 0) return Math.ceil(maxWidth + renderSafetyPx);
        return element.textContent
            ? Math.max(0, Math.ceil(element.getBoundingClientRect().width + renderSafetyPx))
            : 0;
    }

    function collectSegmentedTextNodes(element) {
        const nodes = [];
        const visit = (node) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                if (String(node.textContent || '').trim()) nodes.push(node);
                return;
            }
            Array.from(node.childNodes || []).forEach(visit);
        };
        visit(element);
        return nodes;
    }

    function measureSegmentedInlineContentRect(element, renderSafetyPx = SEGMENTED_TEXT_RENDER_SAFETY_PX) {
        if (!(element instanceof HTMLElement)) return null;
        const textNodes = collectSegmentedTextNodes(element);
        const rects = [];
        textNodes.forEach((textNode) => {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            rects.push(...Array.from(range.getClientRects()));
            if (typeof range.detach === 'function') {
                range.detach();
            }
        });
        let left = Infinity;
        let right = -Infinity;
        rects.forEach((rect) => {
            if (rect.width <= 0) return;
            left = Math.min(left, rect.left);
            right = Math.max(right, rect.right);
        });
        if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
            return {
                centerX: (left + right) / 2,
                width: Math.ceil((right - left) + renderSafetyPx),
            };
        }
        const fallbackRect = element.getBoundingClientRect();
        if (fallbackRect.width <= 0) return null;
        return {
            centerX: fallbackRect.left + (fallbackRect.width / 2),
            width: Math.ceil(fallbackRect.width + renderSafetyPx),
        };
    }

    function measureInvestmentSegmentedPillGeometry(control, activeLabel, {
        labelSelector = '',
        horizontalInset = null,
        centerOnActiveContent = false,
        alignEdgeCaps = false,
    } = {}) {
        if (!(control instanceof HTMLElement) || !(activeLabel instanceof HTMLElement)) return null;
        const activeOption = activeLabel.closest('.segmented-control-option');
        const options = Array.from(control.querySelectorAll('.segmented-control-option')).filter((option) => option instanceof HTMLElement);
        if (!(activeOption instanceof HTMLElement) || !options.length) return null;
        const controlStyles = window.getComputedStyle(control);
        const renderSafetyPx = Math.max(
            0,
            Math.round(
                Number.parseFloat(controlStyles.getPropertyValue('--segmented-text-render-safety-px'))
                || SEGMENTED_TEXT_RENDER_SAFETY_PX,
            ),
        );
        const resolvedHorizontalInset = Math.max(
            0,
            Math.round(
                Number.parseFloat(horizontalInset)
                || Math.max(
                    Number.parseFloat(window.getComputedStyle(activeLabel).paddingLeft) || 0,
                    Number.parseFloat(window.getComputedStyle(activeLabel).paddingRight) || 0,
                )
                || Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-label-pad-inline'))
                || 0,
            ),
        );
        const columnGap = Math.max(
            0,
            Math.round(
                Number.parseFloat(controlStyles.columnGap)
                || Number.parseFloat(controlStyles.getPropertyValue('gap'))
                || Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-gap'))
                || 0,
            ),
        );
        const controlPaddingInline = Math.max(
            0,
            Math.round(
                (Number.parseFloat(controlStyles.paddingLeft) || 0)
                + (Number.parseFloat(controlStyles.paddingRight) || 0),
            ),
        );
        const measureOptionContentWidth = (optionLabel) => {
            const measureTarget = labelSelector
                ? (optionLabel.querySelector(labelSelector) || optionLabel)
                : optionLabel;
            return measureSegmentedInlineContentWidth(
                measureTarget instanceof HTMLElement ? measureTarget : optionLabel,
                renderSafetyPx,
            );
        };
        const maxContentWidth = options.reduce((currentMax, option) => {
            const optionLabel = option.querySelector('input + span');
            if (!(optionLabel instanceof HTMLElement)) return currentMax;
            return Math.max(currentMax, measureOptionContentWidth(optionLabel));
        }, 0);
        const optionWidth = Math.max(1, Math.ceil(maxContentWidth + (resolvedHorizontalInset * 2)));
        const optionCount = options.length;
        const activeIndex = Math.max(0, options.indexOf(activeOption));
        const totalControlWidth = controlPaddingInline
            + (optionWidth * optionCount)
            + (columnGap * Math.max(0, optionCount - 1));
        const parentWidth = control.parentElement instanceof HTMLElement
            ? Math.floor(control.parentElement.getBoundingClientRect().width)
            : 0;
        const computedMaxWidth = Number.parseFloat(controlStyles.maxWidth);
        const cssMaxWidth = Number.isFinite(computedMaxWidth) && computedMaxWidth > 0
            ? Math.floor(computedMaxWidth)
            : 0;
        const maxControlWidth = Math.max(
            optionWidth + controlPaddingInline,
            Math.min(
                ...[parentWidth, cssMaxWidth, totalControlWidth].filter((value) => value > 0),
            ),
        );
        const visibleControlWidth = Math.min(totalControlWidth, maxControlWidth);
        control.style.setProperty('--segmented-option-width', `${optionWidth}px`);
        control.style.setProperty('--segmented-option-count', String(optionCount));
        control.style.gridTemplateColumns = `repeat(${optionCount}, ${optionWidth}px)`;
        control.style.width = `${visibleControlWidth}px`;
        control.dataset.segmentedOverflow = totalControlWidth > visibleControlWidth + 1 ? '1' : '0';
        const activeMeasureTarget = labelSelector
            ? (activeLabel.querySelector(labelSelector) || activeLabel)
            : activeLabel;
        const activeContentRect = measureSegmentedInlineContentRect(
            activeMeasureTarget instanceof HTMLElement ? activeMeasureTarget : activeLabel,
            renderSafetyPx,
        );
        const activeContentWidth = activeContentRect?.width || measureOptionContentWidth(activeLabel);
        const activePillWidth = centerOnActiveContent
            ? Math.min(optionWidth, Math.max(1, Math.ceil(activeContentWidth + (resolvedHorizontalInset * 2))))
            : optionWidth;
        const activeOptionRect = activeOption.getBoundingClientRect();
        const activeContentCenterOffset = (
            centerOnActiveContent
            && activeContentRect
            && activeOptionRect.width > 0
        )
            ? activeContentRect.centerX - activeOptionRect.left
            : optionWidth / 2;
        const activeContentCenter = (activeIndex * (optionWidth + columnGap)) + activeContentCenterOffset;
        let constrainedPillWidth = activePillWidth;
        let activePillLeft = activeContentCenter - (constrainedPillWidth / 2);
        if (centerOnActiveContent && alignEdgeCaps) {
            const thumbInset = Math.max(
                0,
                Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-thumb-inset'))
                || Number.parseFloat(controlStyles.paddingLeft)
                || 0,
            );
            if (activeIndex === 0) {
                constrainedPillWidth = Math.max(1, activeContentCenter * 2);
                activePillLeft = 0;
            } else if (activeIndex === optionCount - 1) {
                const rightCapEdge = Math.max(thumbInset, visibleControlWidth - (thumbInset * 2));
                constrainedPillWidth = Math.max(1, (rightCapEdge - activeContentCenter) * 2);
                activePillLeft = activeContentCenter - (constrainedPillWidth / 2);
            }
        }
        return {
            left: activePillLeft,
            width: constrainedPillWidth,
            totalWidth: totalControlWidth,
            visibleWidth: visibleControlWidth,
        };
    }

    function keepSegmentedActiveOptionVisible(control, pillGeometry) {
        if (!(control instanceof HTMLElement) || !pillGeometry) return;
        const maxScrollLeft = Math.max(0, control.scrollWidth - control.clientWidth);
        if (maxScrollLeft <= 0) {
            control.scrollLeft = 0;
            return;
        }
        const leftSafety = Math.max(0, Math.round(Number.parseFloat(getComputedStyle(control).paddingLeft) || 0));
        const rightSafety = Math.max(
            leftSafety,
            Math.round(Number.parseFloat(getComputedStyle(control).paddingRight) || 0),
        );
        const activeLeft = pillGeometry.left;
        const activeRight = pillGeometry.left + pillGeometry.width;
        let nextScrollLeft = control.scrollLeft;
        if (activeLeft < control.scrollLeft + leftSafety) {
            nextScrollLeft = activeLeft - leftSafety;
        } else if (activeRight > control.scrollLeft + control.clientWidth - rightSafety) {
            nextScrollLeft = activeRight - control.clientWidth + rightSafety;
        }
        control.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
    }

    function syncInvestmentShareActionsPosition() {
        if (!(investmentShareActions instanceof HTMLElement) || !(segmentedControl instanceof HTMLElement)) {
            return;
        }
        const segmentedRect = segmentedControl.getBoundingClientRect();
        if (!segmentedRect.height) return;
        const centerY = segmentedRect.top + (segmentedRect.height / 2);
        investmentShareActions.style.setProperty('--investment-share-actions-top', `${centerY}px`);
        investmentShareActions.style.top = `${centerY}px`;
    }

    function updateInvestmentSegmentedPill() {
        if (!segmentedControl) return;
        const activeLabel = segmentedControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            segmentedControl.classList.remove('is-pill-ready');
            syncInvestmentShareActionsPosition();
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(segmentedControl, activeLabel, {
            centerOnActiveContent: true,
            alignEdgeCaps: true,
        });
        if (!pillGeometry) {
            segmentedControl.classList.remove('is-pill-ready');
            syncInvestmentShareActionsPosition();
            return;
        }

        segmentedControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        segmentedControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(segmentedControl, pillGeometry);
        segmentedControl.classList.add('is-pill-ready');
        syncInvestmentShareActionsPosition();
    }

    function scheduleInvestmentSegmentedPillUpdate() {
        if (!segmentedControl) return;
        segmentedControl.classList.remove('is-pill-ready');
        clearInvestmentSegmentedMeasureRaf();
        clearInvestmentSegmentedMeasureTimer();
        investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
            investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
                investmentSegmentedMeasureRaf = 0;
                updateInvestmentSegmentedPill();
                investmentSegmentedMeasureTimer = window.setTimeout(() => {
                    investmentSegmentedMeasureTimer = 0;
                    updateInvestmentSegmentedPill();
                }, 520);
            });
        });
    }

    function updateIbkrImportSegmentedPill() {
        if (!(investmentImportIbkrMode instanceof HTMLElement)) return;
        const activeLabel = investmentImportIbkrMode.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            investmentImportIbkrMode.classList.remove('is-pill-ready');
            return;
        }
        const pillGeometry = measureInvestmentSegmentedPillGeometry(investmentImportIbkrMode, activeLabel);
        if (!pillGeometry) {
            investmentImportIbkrMode.classList.remove('is-pill-ready');
            return;
        }
        investmentImportIbkrMode.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        investmentImportIbkrMode.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(investmentImportIbkrMode, pillGeometry);
        investmentImportIbkrMode.classList.add('is-pill-ready');
    }

    function scheduleIbkrImportSegmentedPillUpdate() {
        if (!(investmentImportIbkrMode instanceof HTMLElement)) return;
        investmentImportIbkrMode.classList.remove('is-pill-ready');
        if (investmentIbkrModeMeasureRaf) {
            window.cancelAnimationFrame(investmentIbkrModeMeasureRaf);
            investmentIbkrModeMeasureRaf = 0;
        }
        investmentIbkrModeMeasureRaf = window.requestAnimationFrame(() => {
            investmentIbkrModeMeasureRaf = window.requestAnimationFrame(() => {
                investmentIbkrModeMeasureRaf = 0;
                updateIbkrImportSegmentedPill();
            });
        });
    }

    function updateHsbcImportSegmentedPill() {
        if (!(investmentImportHsbcMode instanceof HTMLElement)) return;
        const activeLabel = investmentImportHsbcMode.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            investmentImportHsbcMode.classList.remove('is-pill-ready');
            return;
        }
        const pillGeometry = measureInvestmentSegmentedPillGeometry(investmentImportHsbcMode, activeLabel);
        if (!pillGeometry) {
            investmentImportHsbcMode.classList.remove('is-pill-ready');
            return;
        }
        investmentImportHsbcMode.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        investmentImportHsbcMode.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(investmentImportHsbcMode, pillGeometry);
        investmentImportHsbcMode.classList.add('is-pill-ready');
    }

    function scheduleHsbcImportSegmentedPillUpdate() {
        if (!(investmentImportHsbcMode instanceof HTMLElement)) return;
        investmentImportHsbcMode.classList.remove('is-pill-ready');
        if (investmentHsbcModeMeasureRaf) {
            window.cancelAnimationFrame(investmentHsbcModeMeasureRaf);
            investmentHsbcModeMeasureRaf = 0;
        }
        investmentHsbcModeMeasureRaf = window.requestAnimationFrame(() => {
            investmentHsbcModeMeasureRaf = window.requestAnimationFrame(() => {
                investmentHsbcModeMeasureRaf = 0;
                updateHsbcImportSegmentedPill();
            });
        });
    }

    function getInvestmentStockDetailsRangeControl() {
        const control = investmentStockDetailsPanel?.querySelector('[data-investment-stock-details-range-segmented]');
        return control instanceof HTMLElement ? control : null;
    }

    function getInvestmentEquityRangeControl() {
        const chartContainer = document.getElementById('investment_equity_chart');
        const control = chartContainer?.querySelector('[data-investment-equity-range-segmented]');
        return control instanceof HTMLElement ? control : null;
    }

    function isInvestmentStockDetailsIntradayRange(range) {
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        return normalizedRange === '1w';
    }

    function parseInvestmentIntradayTimestamp(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        const hours = Number(match[4]);
        const minutes = Number(match[5]);
        if (![year, monthIndex, day, hours, minutes].every(Number.isFinite)) return null;
        return new Date(year, monthIndex, day, hours, minutes, 0, 0);
    }

    function normalizeInvestmentIntradayMinuteKey(value) {
        const parsed = parseInvestmentIntradayTimestamp(value);
        if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return '';
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        const hours = String(parsed.getHours()).padStart(2, '0');
        const minutes = String(parsed.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function buildInvestmentIntradayDayFallbackIndex(labels = []) {
        return (Array.isArray(labels) ? labels : []).reduce((accumulator, label, index) => {
            const dayKey = normalizeLedgerDate(label);
            if (dayKey) accumulator.set(dayKey, index);
            return accumulator;
        }, new Map());
    }

    function buildInvestmentIntradayDayBoundaries(labels = []) {
        const orderedDays = [];
        const dayMap = new Map();
        (Array.isArray(labels) ? labels : []).forEach((label, index) => {
            const dayKey = normalizeLedgerDate(label);
            if (!dayKey) return;
            const existing = dayMap.get(dayKey);
            if (existing) {
                existing.lastIndex = index;
                return;
            }
            const entry = {
                dayKey,
                ordinal: orderedDays.length,
                firstIndex: index,
                lastIndex: index,
            };
            orderedDays.push(entry);
            dayMap.set(dayKey, entry);
        });
        return { orderedDays, dayMap };
    }

    function getInvestmentTradeSessionType(value) {
        const dateParts = parseInvestmentDateParts(value);
        if (!dateParts || !Number.isInteger(dateParts.hours) || !Number.isInteger(dateParts.minutes)) {
            return 'intraday';
        }
        const totalMinutes = (dateParts.hours * 60) + dateParts.minutes;
        const intradayOpenMinutes = (9 * 60) + 30;
        const intradayCloseMinutes = 16 * 60;
        const premarketOpenMinutes = 4 * 60;
        const postmarketCloseMinutes = 20 * 60;
        if (totalMinutes >= intradayOpenMinutes && totalMinutes < intradayCloseMinutes) return 'intraday';
        if (totalMinutes >= premarketOpenMinutes && totalMinutes < intradayOpenMinutes) return 'pre';
        if (totalMinutes >= intradayCloseMinutes && totalMinutes < postmarketCloseMinutes) return 'post';
        return 'night';
    }

    async function loadInvestmentStockDetailsIntradayRows(ticker, range) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        if (!normalizedTicker || !isInvestmentStockDetailsIntradayRange(normalizedRange)) return [];
        const cacheKey = `${normalizedTicker}:${normalizedRange}`;
        if (investmentStockDetailsIntradayCache.has(cacheKey)) {
            return investmentStockDetailsIntradayCache.get(cacheKey) || [];
        }
        if (investmentStockDetailsIntradayInflight.has(cacheKey)) {
            return investmentStockDetailsIntradayInflight.get(cacheKey);
        }
        const requestPromise = (async () => {
            const response = await fetch(
                `/api/investment/intraday?ticker=${encodeURIComponent(normalizedTicker)}&range=${encodeURIComponent(normalizedRange)}&ensure_store=1`,
                buildInvestmentRequestOptions(),
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.error || `Unable to load 1-minute market data for ${normalizedTicker}.`);
            }
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
            investmentStockDetailsIntradayCache.set(cacheKey, rows);
            return rows;
        })();
        investmentStockDetailsIntradayInflight.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            investmentStockDetailsIntradayInflight.delete(cacheKey);
        }
    }

    async function loadInvestmentOverviewIntradayRows(ticker, dayKeys = [], range = selectedInvestmentEquityRange) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const normalizedRange = isInvestmentOverviewIntradayEquityRange(range)
            ? normalizeInvestmentEquityRange(range)
            : '1w';
        if (!normalizedTicker) return [];
        const requestedDayKeys = (Array.isArray(dayKeys) ? dayKeys : [])
            .map((dayKey) => normalizeLedgerDate(dayKey))
            .filter(Boolean);
        const requestedDays = requestedDayKeys.join(',');
        const cacheKey = `${normalizedTicker}:${normalizedRange}:${requestedDays}`;
        if (investmentOverviewIntradayCache.has(cacheKey)) {
            return investmentOverviewIntradayCache.get(cacheKey) || [];
        }
        if (investmentOverviewIntradayInflight.has(cacheKey)) {
            return investmentOverviewIntradayInflight.get(cacheKey);
        }
        const requestPromise = (async () => {
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(
                () => abortController.abort(),
                INVESTMENT_OVERVIEW_INTRADAY_REQUEST_TIMEOUT_MS,
            );
            const dayQuery = requestedDays ? `&days=${encodeURIComponent(requestedDays)}` : '';
            let response = null;
            try {
                response = await fetch(
                    `/api/investment/intraday?ticker=${encodeURIComponent(normalizedTicker)}&range=${encodeURIComponent(normalizedRange)}&ensure_store=1${dayQuery}`,
                    buildInvestmentRequestOptions({ signal: abortController.signal }),
                );
            } finally {
                window.clearTimeout(timeoutId);
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.error || `Unable to load 1-minute market data for ${normalizedTicker}.`);
            }
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
            investmentOverviewIntradayCache.set(cacheKey, rows);
            return rows;
        })();
        investmentOverviewIntradayInflight.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            investmentOverviewIntradayInflight.delete(cacheKey);
        }
    }

    function buildInvestmentOverviewIntradayMinuteMap(rows = [], requiredDateKey = '') {
        const minuteMap = new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const minuteKey = normalizeInvestmentIntradayMinuteKey(row?.date);
            if (!minuteKey) return;
            if (requiredDateKey && normalizeLedgerDate(minuteKey) !== requiredDateKey) return;
            if (getInvestmentTradeSessionType(minuteKey) !== 'intraday') return;
            const open = Number(row?.open);
            const high = Number(row?.high);
            const low = Number(row?.low);
            const close = Number(row?.close);
            if (![open, high, low, close].every(Number.isFinite)) return;
            minuteMap.set(minuteKey, { open, high, low, close });
        });
        return minuteMap;
    }

    function getInvestmentSnapshotFixedHoldingValue(snapshot, ticker, quantity, valuationDate, fxTimeline, baseCurrency, tickerPriceIndex = null) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const numericQuantity = Number(quantity);
        if (!normalizedTicker || !Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return 0;
        const moneyMarketTickers = getMoneyMarketTickerSet();
        let price = null;
        if (moneyMarketTickers.has(normalizedTicker)) {
            price = Number(
                snapshot?.aggregate_money_market_anchors?.[normalizedTicker]
                ?? snapshot?.money_market_anchors?.[normalizedTicker],
            );
        }
        if (!Number.isFinite(price) || price <= 0) {
            price = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[normalizedTicker], valuationDate);
        }
        if (!Number.isFinite(price) || price <= 0) return 0;
        return convertAmountToBaseCurrency(
            numericQuantity * price,
            getTickerQuoteCurrency(normalizedTicker),
            valuationDate,
            fxTimeline,
            baseCurrency,
        );
    }

    function getInvestmentOverviewLatestOneWeekMinuteKeys(minuteKeys = []) {
        const orderedMinuteKeys = [...new Set(Array.isArray(minuteKeys) ? minuteKeys : [])].filter(Boolean).sort();
        const latestMinuteKey = orderedMinuteKeys[orderedMinuteKeys.length - 1] || '';
        const latestDate = parseInvestmentIntradayTimestamp(latestMinuteKey);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedMinuteKeys;
        }
        const startDate = new Date(latestDate.getTime());
        startDate.setDate(startDate.getDate() - 6);
        return orderedMinuteKeys.filter((minuteKey) => {
            const minuteDate = parseInvestmentIntradayTimestamp(minuteKey);
            return minuteDate instanceof Date && !Number.isNaN(minuteDate.getTime()) && minuteDate >= startDate;
        });
    }

    function aggregateInvestmentOverviewCandlesForDisplay(candles = [], maxVisibleCandles = 220) {
        const normalizedCandles = (Array.isArray(candles) ? candles : [])
            .filter((bar) => (
                bar?.date
                && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(Number(value)))
            ));
        const safeMaxVisibleCandles = Math.max(40, Math.floor(Number(maxVisibleCandles) || 220));
        if (normalizedCandles.length <= safeMaxVisibleCandles) return normalizedCandles;
        const dayGroups = normalizedCandles.reduce((groups, bar) => {
            const dayKey = normalizeLedgerDate(bar.date) || 'unknown';
            if (!groups.has(dayKey)) groups.set(dayKey, []);
            groups.get(dayKey).push(bar);
            return groups;
        }, new Map());
        const maxCandlesPerDay = Math.max(12, Math.floor(safeMaxVisibleCandles / Math.max(dayGroups.size, 1)));
        const displayCandles = [];
        Array.from(dayGroups.keys()).sort().forEach((dayKey) => {
            const dayCandles = dayGroups.get(dayKey) || [];
            const bucketSize = Math.max(1, Math.ceil(dayCandles.length / maxCandlesPerDay));
            for (let start = 0; start < dayCandles.length; start += bucketSize) {
                const bucket = dayCandles.slice(start, start + bucketSize);
                if (!bucket.length) continue;
                const open = Number(bucket[0].open);
                const close = Number(bucket[bucket.length - 1].close);
                const high = Math.max(...bucket.map((bar) => Number(bar.high)).filter(Number.isFinite));
                const low = Math.min(...bucket.map((bar) => Number(bar.low)).filter(Number.isFinite));
                if (![open, high, low, close].every(Number.isFinite)) continue;
                displayCandles.push({
                    date: bucket[bucket.length - 1].date,
                    open: roundInvestmentChartCurrencyValue(open),
                    high: roundInvestmentChartCurrencyValue(high),
                    low: roundInvestmentChartCurrencyValue(low),
                    close: roundInvestmentChartCurrencyValue(close),
                });
            }
        });
        return displayCandles;
    }

    function buildInvestmentOverviewTradingDayKeys(range = selectedInvestmentEquityRange) {
        const normalizedRange = normalizeInvestmentEquityRange(range);
        const requiredDayCount = getInvestmentOverviewIntradayDayCount(normalizedRange);
        if (!requiredDayCount) return [];
        const safePayload = getSafeInvestmentMarketSessionState();
        const tradingDays = Array.isArray(safePayload?.trading_days) ? safePayload.trading_days : [];
        if (!tradingDays.length) {
            void refreshInvestmentMarketSessionState({ dayCount: requiredDayCount, force: true });
            return [];
        }
        const normalizedTradingDays = [...tradingDays]
            .map((dayKey) => normalizeLedgerDate(dayKey))
            .filter(Boolean);
        if (normalizedTradingDays.length < requiredDayCount) {
            void refreshInvestmentMarketSessionState({ dayCount: requiredDayCount, force: true });
            return [];
        }
        return normalizedTradingDays.slice(-requiredDayCount);
    }

    function buildInvestmentOverviewRegularSessionMinuteKeys(dayKey) {
        const keys = [];
        if (!normalizeLedgerDate(dayKey)) return keys;
        for (let minuteOffset = 0; minuteOffset < 390; minuteOffset += 1) {
            const totalMinutes = (9 * 60) + 30 + minuteOffset;
            const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
            const minutes = String(totalMinutes % 60).padStart(2, '0');
            keys.push(`${dayKey} ${hours}:${minutes}`);
        }
        return keys;
    }

    function getInvestmentOverviewEffectiveSnapshotForTradingDay(dayKey) {
        const normalizedDayKey = normalizeLedgerDate(dayKey);
        if (!normalizedDayKey || !Array.isArray(investmentProcessedTransactionsCache)) return null;
        let effectiveSnapshot = null;
        investmentProcessedTransactionsCache.forEach((snapshot) => {
            const snapshotDate = normalizeLedgerDate(snapshot?.date);
            if (snapshotDate && snapshotDate < normalizedDayKey) {
                effectiveSnapshot = snapshot;
            }
        });
        return effectiveSnapshot;
    }

    function buildInvestmentOverviewActiveTickerSetForSnapshots(snapshots = []) {
        const moneyMarketTickers = getMoneyMarketTickerSet();
        return Array.from((Array.isArray(snapshots) ? snapshots : []).reduce((tickerSet, snapshot) => {
            const holdings = snapshot?.aggregate_holdings || snapshot?.holdings || {};
            Object.entries(holdings).forEach(([ticker, quantity]) => {
                const normalizedTicker = normalizeInvestmentTicker(ticker);
                const numericQuantity = Number(quantity);
                if (
                    normalizedTicker
                    && !isForexPairTicker(normalizedTicker)
                    && !moneyMarketTickers.has(normalizedTicker)
                    && Number.isFinite(numericQuantity)
                    && Math.abs(numericQuantity) > 1e-9
                ) {
                    tickerSet.add(normalizedTicker);
                }
            });
            return tickerSet;
        }, new Set()));
    }

    async function buildInvestmentOverviewIntradayLinePoints() {
        const normalizedRange = normalizeInvestmentEquityRange(selectedInvestmentEquityRange);
        if (!isInvestmentOverviewHighPrecisionEquityRange(normalizedRange)) return [];
        const requiredDayCount = getInvestmentOverviewIntradayDayCount(normalizedRange);
        const dayKeys = buildInvestmentOverviewTradingDayKeys(normalizedRange);
        if (!dayKeys.length || dayKeys.length < requiredDayCount) return [];
        const effectiveSnapshotsByDay = new Map(
            dayKeys.map((dayKey) => [dayKey, getInvestmentOverviewEffectiveSnapshotForTradingDay(dayKey)]),
        );
        const activeTickers = buildInvestmentOverviewActiveTickerSetForSnapshots(
            Array.from(effectiveSnapshotsByDay.values()).filter(Boolean),
        );
        if (!activeTickers.length) return [];

        const tickerResults = await Promise.allSettled(activeTickers.map(async (ticker) => ({
            ticker,
            rows: await loadInvestmentOverviewIntradayRows(ticker, dayKeys),
        })));
        const tickerRows = tickerResults
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value);
        tickerResults
            .filter((result) => result.status === 'rejected')
            .forEach((result) => console.warn(result.reason));
        const minuteMapByTicker = new Map(tickerRows.map(({ ticker, rows }) => {
            const closeMap = new Map();
            buildInvestmentOverviewIntradayMinuteMap(rows).forEach((bar, minuteKey) => {
                const close = Number(bar?.close);
                if (Number.isFinite(close)) closeMap.set(minuteKey, close);
            });
            return [ticker, closeMap];
        }));
        const availableMinuteKeys = new Set(
            Array.from(minuteMapByTicker.values()).flatMap((minuteMap) => [...minuteMap.keys()]),
        );
        const tickerPriceIndex = buildTickerPriceIndex(investmentTickerClosePricesCache);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(investmentProcessedTransactionsCache, baseCurrency);
        const fallbackValueCache = new Map();
        const getFallbackValue = (snapshot, ticker, quantity, valuationDate) => {
            const cacheKey = `${ticker}:${quantity}:${valuationDate}`;
            if (fallbackValueCache.has(cacheKey)) return fallbackValueCache.get(cacheKey);
            const value = getInvestmentSnapshotFixedHoldingValue(
                snapshot,
                ticker,
                quantity,
                valuationDate,
                fxTimeline,
                baseCurrency,
                tickerPriceIndex,
            );
            fallbackValueCache.set(cacheKey, value);
            return value;
        };

        return dayKeys.flatMap((dayKey) => {
            const snapshot = effectiveSnapshotsByDay.get(dayKey);
            const minuteKeys = buildInvestmentOverviewRegularSessionMinuteKeys(dayKey);
            if (!snapshot) {
                return minuteKeys.map((minuteKey) => ({
                    date: minuteKey,
                    equity: null,
                    point: null,
                }));
            }
            const hasAnyIntradayCloseForDay = minuteKeys.some((minuteKey) => availableMinuteKeys.has(minuteKey));
            if (!hasAnyIntradayCloseForDay) {
                return minuteKeys.map((minuteKey) => ({
                    date: minuteKey,
                    equity: null,
                    point: null,
                }));
            }
            const holdings = snapshot?.aggregate_holdings || snapshot?.holdings || {};
            const aggregateRunningCash = Number(snapshot?.aggregate_running_cash ?? snapshot?.running_cash) || 0;
            const rawAggregateDisplayCash = Number(snapshot?.aggregate_display_cash);
            const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
                ? rawAggregateDisplayCash
                : aggregateRunningCash + (Number(snapshot?.aggregate_pending_settlement_cash) || 0);
            return minuteKeys.map((minuteKey) => {
                if (!availableMinuteKeys.has(minuteKey)) {
                    return {
                        date: minuteKey,
                        equity: null,
                        point: null,
                    };
                }
                let aggregateMarketValue = 0;
                const holdingsMarketValues = {};
                Object.entries(holdings).forEach(([ticker, quantity]) => {
                    const normalizedTicker = normalizeInvestmentTicker(ticker);
                    const numericQuantity = Number(quantity);
                    if (!normalizedTicker || isForexPairTicker(normalizedTicker) || !Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;
                    const close = minuteMapByTicker.get(normalizedTicker)?.get(minuteKey);
                    let marketValue = 0;
                    if (Number.isFinite(close) && close > 0) {
                        marketValue = convertAmountToBaseCurrency(
                            numericQuantity * close,
                            getTickerQuoteCurrency(normalizedTicker),
                            dayKey,
                            fxTimeline,
                            baseCurrency,
                        );
                    } else {
                        marketValue = getFallbackValue(snapshot, normalizedTicker, numericQuantity, dayKey);
                    }
                    aggregateMarketValue += marketValue;
                    if (Math.abs(marketValue) > 1e-9) {
                        holdingsMarketValues[normalizedTicker] = marketValue;
                    }
                });
                const aggregateTotalEquity = aggregateDisplayCash + aggregateMarketValue;
                const point = {
                    date: minuteKey,
                    running_cash: aggregateRunningCash,
                    aggregate_running_cash: aggregateRunningCash,
                    aggregate_display_cash: aggregateDisplayCash,
                    market_value: aggregateMarketValue,
                    aggregate_market_value: aggregateMarketValue,
                    holdings_market_values: holdingsMarketValues,
                    aggregate_holdings_market_values: holdingsMarketValues,
                    total_equity: aggregateTotalEquity,
                    aggregate_total_equity: aggregateTotalEquity,
                    anchor_ledger_date: '',
                    anchor_ledger_nos: [],
                    cash_in_amount: 0,
                    cash_out_amount: 0,
                    net_transfer_amount: 0,
                    cumulative_net_transfer_amount: Number(snapshot?.cumulative_net_transfer_amount) || 0,
                    is_trading_day: true,
                    is_intraday_equity: true,
                };
                return {
                    date: minuteKey,
                    equity: roundInvestmentChartCurrencyValue(aggregateTotalEquity),
                    point,
                };
            });
        });
    }

    function buildInvestmentOverviewEmptyIntradayLinePoints() {
        const normalizedRange = normalizeInvestmentEquityRange(selectedInvestmentEquityRange);
        if (!isInvestmentOverviewHighPrecisionEquityRange(normalizedRange)) return [];
        const requiredDayCount = getInvestmentOverviewIntradayDayCount(normalizedRange);
        const dayKeys = buildInvestmentOverviewTradingDayKeys(normalizedRange);
        if (!dayKeys.length || dayKeys.length < requiredDayCount) return [];
        return dayKeys.flatMap((dayKey) => (
            buildInvestmentOverviewRegularSessionMinuteKeys(dayKey).map((minuteKey) => ({
                date: minuteKey,
                equity: null,
                point: null,
            }))
        ));
    }

    function getInvestmentOverviewIntradayLineCacheKey(dayKeys = buildInvestmentOverviewTradingDayKeys()) {
        return (Array.isArray(dayKeys) ? dayKeys : [])
            .map((dayKey) => normalizeLedgerDate(dayKey))
            .filter(Boolean)
            .join(',');
    }

    function getInvestmentOverviewIntradayLineQuality(linePoints = []) {
        const finiteEntries = (Array.isArray(linePoints) ? linePoints : [])
            .map((entry) => ({
                date: String(entry?.date || ''),
                equity: Number(entry?.equity),
            }))
            .filter((entry) => entry.date && Number.isFinite(entry.equity));
        if (!finiteEntries.length) {
            return {
                finiteCount: 0,
                finiteDayCount: 0,
                distinctCount: 0,
                valueRange: 0,
                isHealthy: false,
            };
        }
        const values = finiteEntries.map((entry) => entry.equity);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const distinctCount = new Set(values.map((value) => value.toFixed(2))).size;
        const finiteDayCount = new Set(finiteEntries.map((entry) => normalizeLedgerDate(entry.date)).filter(Boolean)).size;
        const valueRange = maxValue - minValue;
        return {
            finiteCount: finiteEntries.length,
            finiteDayCount,
            distinctCount,
            valueRange,
            isHealthy: finiteEntries.length >= 390
                && finiteDayCount >= 2
                && distinctCount >= 12
                && valueRange > 10,
        };
    }

    function shouldUseInvestmentOverviewIntradayLinePoints(nextLinePoints = [], cachedLinePoints = []) {
        const nextQuality = getInvestmentOverviewIntradayLineQuality(nextLinePoints);
        const cachedQuality = getInvestmentOverviewIntradayLineQuality(cachedLinePoints);
        if (!cachedQuality.isHealthy) return nextQuality.isHealthy;
        if (!nextQuality.isHealthy) return false;
        if (nextQuality.finiteDayCount < cachedQuality.finiteDayCount) return false;
        if (nextQuality.valueRange < cachedQuality.valueRange * 0.08) return false;
        if (nextQuality.distinctCount < Math.max(12, Math.floor(cachedQuality.distinctCount * 0.4))) return false;
        return true;
    }

    function getCachedInvestmentOverviewIntradayLinePoints() {
        const cacheKey = getInvestmentOverviewIntradayLineCacheKey();
        if (
            investmentOverviewIntradayLinePointsCache.key === cacheKey
            && getInvestmentOverviewIntradayLineQuality(investmentOverviewIntradayLinePointsCache.points).isHealthy
        ) {
            return investmentOverviewIntradayLinePointsCache.points;
        }
        return [];
    }

    function resolveInvestmentEquityRealtimeMarkerTarget(runtimeState) {
        if (isInvestmentOverviewIntradayEquityRange()) return null;
        const visibleChartPoints = Array.isArray(runtimeState?.visibleChartPoints)
            ? runtimeState.visibleChartPoints
            : [];
        const realtimeIndex = visibleChartPoints.findIndex((point) => point?.is_realtime === true);
        if (realtimeIndex < 0) return null;
        return {
            index: realtimeIndex,
            session: visibleChartPoints[realtimeIndex]?.realtime_session,
        };
    }

    function cacheInvestmentOverviewIntradayLinePoints(linePoints = []) {
        const quality = getInvestmentOverviewIntradayLineQuality(linePoints);
        if (!quality.isHealthy) return;
        investmentOverviewIntradayLinePointsCache = {
            key: getInvestmentOverviewIntradayLineCacheKey(),
            points: linePoints,
            quality,
        };
    }

    function getInvestmentEquitySegmentBorderColor(context, fallbackColor = "#0055cc") {
        const rawLabels = context?.chart?.data?.rawLabels;
        const p0Index = Number(context?.p0DataIndex);
        const p1Index = Number(context?.p1DataIndex);
        if (
            investmentEquityChartRuntimeState?.overviewIntradayLinePoints?.length
            && Array.isArray(rawLabels)
            && Number.isInteger(p0Index)
            && Number.isInteger(p1Index)
        ) {
            const p0DayKey = normalizeLedgerDate(rawLabels[p0Index]);
            const p1DayKey = normalizeLedgerDate(rawLabels[p1Index]);
            if (p0DayKey && p1DayKey && p0DayKey !== p1DayKey) {
                return 'rgba(0, 85, 204, 0)';
            }
        }
        return fallbackColor;
    }

    async function buildInvestmentOverviewIntradayCandles() {
        if (!isInvestmentOverviewIntradayEquityRange()) return [];
        const latestSnapshot = Array.isArray(investmentProcessedTransactionsCache) && investmentProcessedTransactionsCache.length
            ? investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]
            : null;
        if (!latestSnapshot) return [];
        const openTickers = Array.from(new Set(getInvestmentRealtimeOpenTickers())).filter(Boolean);
        if (!openTickers.length) return [];

        let tickerRows = [];
        try {
            tickerRows = await Promise.all(openTickers.map(async (ticker) => ({
                ticker,
                rows: await loadInvestmentOverviewIntradayRows(ticker),
            })));
        } catch (error) {
            console.warn(error);
            return [];
        }
        const minuteMaps = tickerRows.map(({ ticker, rows }) => ({
            ticker,
            minuteMap: buildInvestmentOverviewIntradayMinuteMap(rows),
        }));
        const minuteKeys = getInvestmentOverviewLatestOneWeekMinuteKeys(
            minuteMaps.flatMap((entry) => [...entry.minuteMap.keys()]),
        );
        if (minuteKeys.length < 30) return [];

        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(investmentProcessedTransactionsCache, baseCurrency);
        const tickerPriceIndex = buildTickerPriceIndex(investmentTickerClosePricesCache);
        const aggregateRunningCash = Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash) || 0;
        const rawAggregateDisplayCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : aggregateRunningCash + (Number(latestSnapshot?.aggregate_pending_settlement_cash) || 0);
        const intradayTickerSet = new Set(openTickers);
        const holdingQuantityByTicker = new Map(
            Object.entries(holdings)
                .map(([ticker, quantity]) => [normalizeInvestmentTicker(ticker), Number(quantity)])
                .filter(([ticker, quantity]) => ticker && Number.isFinite(quantity)),
        );
        const fixedHoldingValue = Object.entries(holdings).reduce((sum, [ticker, quantity]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || intradayTickerSet.has(normalizedTicker)) return sum;
            return sum + getInvestmentSnapshotFixedHoldingValue(
                latestSnapshot,
                normalizedTicker,
                quantity,
                normalizeLedgerDate(minuteKeys[minuteKeys.length - 1]),
                fxTimeline,
                baseCurrency,
                tickerPriceIndex,
            );
        }, 0);
        const minuteMapByTicker = new Map(minuteMaps.map((entry) => [entry.ticker, entry.minuteMap]));
        const fallbackValueCache = new Map();
        const getCachedFallbackValue = (ticker, quantity, valuationDate) => {
            const cacheKey = `${ticker}:${valuationDate}`;
            if (fallbackValueCache.has(cacheKey)) return fallbackValueCache.get(cacheKey);
            const fallbackValue = getInvestmentSnapshotFixedHoldingValue(
                latestSnapshot,
                ticker,
                quantity,
                valuationDate,
                fxTimeline,
                baseCurrency,
                tickerPriceIndex,
            );
            fallbackValueCache.set(cacheKey, fallbackValue);
            return fallbackValue;
        };

        return minuteKeys.map((minuteKey) => {
            const valuationDate = normalizeLedgerDate(minuteKey) || normalizeLedgerDate(minuteKeys[minuteKeys.length - 1]);
            const totals = { open: aggregateDisplayCash + fixedHoldingValue, high: aggregateDisplayCash + fixedHoldingValue, low: aggregateDisplayCash + fixedHoldingValue, close: aggregateDisplayCash + fixedHoldingValue };
            openTickers.forEach((ticker) => {
                const quantity = Number(holdingQuantityByTicker.get(ticker));
                if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9) return;
                const bar = minuteMapByTicker.get(ticker)?.get(minuteKey);
                if (!bar) {
                    const fallbackValue = getCachedFallbackValue(ticker, quantity, valuationDate);
                    totals.open += fallbackValue;
                    totals.high += fallbackValue;
                    totals.low += fallbackValue;
                    totals.close += fallbackValue;
                    return;
                }
                const highPrice = quantity >= 0 ? bar.high : bar.low;
                const lowPrice = quantity >= 0 ? bar.low : bar.high;
                const quoteCurrency = getTickerQuoteCurrency(ticker);
                totals.open += convertAmountToBaseCurrency(quantity * bar.open, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.high += convertAmountToBaseCurrency(quantity * highPrice, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.low += convertAmountToBaseCurrency(quantity * lowPrice, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.close += convertAmountToBaseCurrency(quantity * bar.close, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
            });
            return {
                date: minuteKey,
                open: roundInvestmentChartCurrencyValue(totals.open),
                high: roundInvestmentChartCurrencyValue(totals.high),
                low: roundInvestmentChartCurrencyValue(totals.low),
                close: roundInvestmentChartCurrencyValue(totals.close),
            };
        }).filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
    }

    function normalizeInvestmentStockDetailsRange(range) {
        const normalizedRange = String(range || '').trim().toLowerCase();
        return INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS.some((option) => option.value === normalizedRange)
            ? normalizedRange
            : 'max';
    }

    function normalizeInvestmentEquityRange(range) {
        const normalizedRange = String(range || '').trim().toLowerCase();
        return INVESTMENT_EQUITY_RANGE_OPTIONS.some((option) => option.value === normalizedRange)
            ? normalizedRange
            : 'max';
    }

    function getInvestmentHistoryHeadingElement() {
        const heading = document.querySelector('#investment_history_surface .investment-history-heading-row .chart-heading');
        return heading instanceof HTMLElement ? heading : null;
    }

    function getInvestmentEquityActiveRangeLabel() {
        const rangeControl = getInvestmentEquityRangeControl();
        const activeLabel = rangeControl?.querySelector('input[type="radio"]:checked + span .investment-stock-details-range-label');
        return activeLabel instanceof HTMLElement ? activeLabel.textContent.trim() : '';
    }

    function syncInvestmentHistoryHeading() {
        const heading = getInvestmentHistoryHeadingElement();
        if (!heading) return;
        const nextHeading = String(heading.dataset.baseHeading || heading.textContent || '')
            .replace(/\s*·\s*.+$/, '')
            .trim() || 'Transaction history';
        heading.dataset.baseHeading = nextHeading;
        heading.dataset.activeRangeLabel = getInvestmentEquityActiveRangeLabel();
        heading.textContent = nextHeading;
    }

    function clearInvestmentStockDetailsRangeControlBindings() {
        if (investmentStockDetailsRangeMeasureRaf) {
            window.cancelAnimationFrame(investmentStockDetailsRangeMeasureRaf);
            investmentStockDetailsRangeMeasureRaf = 0;
        }
        if (investmentStockDetailsRangeControlAbortController) {
            investmentStockDetailsRangeControlAbortController.abort();
            investmentStockDetailsRangeControlAbortController = null;
        }
        if (investmentStockDetailsRangeControlResizeObserver) {
            investmentStockDetailsRangeControlResizeObserver.disconnect();
            investmentStockDetailsRangeControlResizeObserver = null;
        }
    }

    function clearInvestmentEquityRangeControlBindings() {
        if (investmentEquityRangeMeasureRaf) {
            window.cancelAnimationFrame(investmentEquityRangeMeasureRaf);
            investmentEquityRangeMeasureRaf = 0;
        }
        if (investmentEquityRangeControlAbortController) {
            investmentEquityRangeControlAbortController.abort();
            investmentEquityRangeControlAbortController = null;
        }
        if (investmentEquityRangeControlResizeObserver) {
            investmentEquityRangeControlResizeObserver.disconnect();
            investmentEquityRangeControlResizeObserver = null;
        }
    }

    function updateInvestmentStockDetailsRangePill() {
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;
        const activeLabel = rangeControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(rangeControl, activeLabel, {
            labelSelector: '.investment-stock-details-range-label',
        });
        if (!pillGeometry) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        rangeControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        rangeControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        rangeControl.classList.add('is-pill-ready');
    }

    function scheduleInvestmentStockDetailsRangePillUpdate() {
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;
        rangeControl.classList.remove('is-pill-ready');
        if (investmentStockDetailsRangeMeasureRaf) {
            window.cancelAnimationFrame(investmentStockDetailsRangeMeasureRaf);
            investmentStockDetailsRangeMeasureRaf = 0;
        }
        investmentStockDetailsRangeMeasureRaf = window.requestAnimationFrame(() => {
            investmentStockDetailsRangeMeasureRaf = window.requestAnimationFrame(() => {
                investmentStockDetailsRangeMeasureRaf = 0;
                updateInvestmentStockDetailsRangePill();
            });
        });
    }

    function updateInvestmentEquityRangePill() {
        const rangeControl = getInvestmentEquityRangeControl();
        if (!rangeControl) return;
        const activeLabel = rangeControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(rangeControl, activeLabel, {
            labelSelector: '.investment-stock-details-range-label',
        });
        if (!pillGeometry) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        rangeControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        rangeControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        rangeControl.classList.add('is-pill-ready');
    }

    function scheduleInvestmentEquityRangePillUpdate() {
        const rangeControl = getInvestmentEquityRangeControl();
        if (!rangeControl) return;
        rangeControl.classList.remove('is-pill-ready');
        if (investmentEquityRangeMeasureRaf) {
            window.cancelAnimationFrame(investmentEquityRangeMeasureRaf);
            investmentEquityRangeMeasureRaf = 0;
        }
        investmentEquityRangeMeasureRaf = window.requestAnimationFrame(() => {
            investmentEquityRangeMeasureRaf = window.requestAnimationFrame(() => {
                investmentEquityRangeMeasureRaf = 0;
                updateInvestmentEquityRangePill();
            });
        });
    }

    function renderInvestmentRangeControl({
        inputName = 'investment_stock_details_range',
        inputIdPrefix = 'investment_stock_details_range',
        shellClassName = 'investment-stock-details-range-shell',
        controlClassName = 'investment-stock-details-range-segmented',
        dataAttributeName = 'data-investment-stock-details-range-segmented',
        activeRange = 'max',
        options = INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS,
    } = {}) {
        const activeIndex = Math.max(0, options.findIndex((option) => option.value === activeRange));
        return `
            <div class="${escapeHtml(shellClassName)}">
                <div class="segmented-control ${escapeHtml(controlClassName)}"
                     ${dataAttributeName}
                     data-segmented-pill="measured"
                     data-active="${escapeHtml(activeRange)}"
                     data-option-count="${options.length}"
                     style="--segmented-active-index: ${activeIndex}; --segmented-pill-left: 0px; --segmented-pill-width: 0px;">
                    ${options.map((option) => `
                        <label class="segmented-control-option" for="${escapeHtml(inputIdPrefix)}_${option.value}">
                            <input id="${escapeHtml(inputIdPrefix)}_${option.value}"
                                   name="${escapeHtml(inputName)}"
                                   type="radio"
                                   value="${option.value}"
                                   ${option.value === activeRange ? 'checked' : ''}>
                            <span><span class="investment-stock-details-range-label">${option.label}</span></span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function renderInvestmentStockDetailsRangeControl() {
        return renderInvestmentRangeControl({
            inputName: 'investment_stock_details_range',
            inputIdPrefix: 'investment_stock_details_range',
            shellClassName: 'investment-stock-details-range-shell',
            controlClassName: 'investment-stock-details-range-segmented',
            dataAttributeName: 'data-investment-stock-details-range-segmented',
            activeRange: normalizeInvestmentStockDetailsRange(selectedInvestmentStockDetailsRange),
            options: INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS,
        });
    }

    function renderInvestmentEquityRangeControl() {
        return renderInvestmentRangeControl({
            inputName: 'investment_equity_range',
            inputIdPrefix: 'investment_equity_range',
            shellClassName: 'investment-stock-details-range-shell',
            controlClassName: 'investment-stock-details-range-segmented',
            dataAttributeName: 'data-investment-equity-range-segmented',
            activeRange: normalizeInvestmentEquityRange(selectedInvestmentEquityRange),
            options: INVESTMENT_EQUITY_RANGE_OPTIONS,
        });
    }

    function bindInvestmentStockDetailsRangeControls(ticker, detailRows = []) {
        clearInvestmentStockDetailsRangeControlBindings();
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;

        const checkedInput = rangeControl.querySelector(`input[value="${CSS.escape(normalizeInvestmentStockDetailsRange(selectedInvestmentStockDetailsRange))}"]`);
        if (checkedInput instanceof HTMLInputElement) {
            checkedInput.checked = true;
        }
        rangeControl.dataset.active = normalizeInvestmentStockDetailsRange(selectedInvestmentStockDetailsRange);

        const abortController = new AbortController();
        investmentStockDetailsRangeControlAbortController = abortController;
        const { signal } = abortController;
        rangeControl.addEventListener('change', (event) => {
            const nextInput = event.target;
            if (!(nextInput instanceof HTMLInputElement) || nextInput.name !== 'investment_stock_details_range') return;
            const nextRange = normalizeInvestmentStockDetailsRange(nextInput.value);
            selectedInvestmentStockDetailsRange = nextRange;
            rememberInvestmentPageState({ range: nextRange });
            rangeControl.dataset.active = nextRange;
            const nextIndex = Math.max(0, INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS.findIndex((option) => option.value === nextRange));
            rangeControl.style.setProperty('--segmented-active-index', String(nextIndex));
            scheduleInvestmentStockDetailsRangePillUpdate();
            renderInvestmentStockDetailsPriceChart(ticker, detailRows);
        }, { signal });
        window.addEventListener('resize', scheduleInvestmentStockDetailsRangePillUpdate, { signal });
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                scheduleInvestmentStockDetailsRangePillUpdate();
            });
            resizeObserver.observe(rangeControl);
            const rangeShell = rangeControl.closest('.investment-stock-details-range-shell');
            if (rangeShell instanceof HTMLElement) resizeObserver.observe(rangeShell);
            investmentStockDetailsRangeControlResizeObserver = resizeObserver;
        }
        scheduleInvestmentStockDetailsRangePillUpdate();
    }

    const {
        buildInvestmentStockDetailBrokerMetrics,
        buildInvestmentStockDetailRows,
        destroyInvestmentStockDetailsPriceChart,
        getStockDetailRealizedBreakdown,
        renderInvestmentStockDetailsPriceChart,
    } = createInvestmentStockDetailsUtils({
        STOCK_DETAILS_MARKER_VIEW_BOX,
        INVESTMENT_SURFACE_LAYOUT_SETTLE_MS,
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        buildInvestmentFxRateTimeline,
        buildInvestmentIntradayDayBoundaries,
        buildInvestmentIntradayDayFallbackIndex,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        clearInvestmentHistoryHighlights,
        clearInvestmentStockDetailHighlights,
        clearInvestmentStockDetailsVisibleLayoutTimer: () => {
            if (investmentStockDetailsVisibleLayoutTimer) {
                window.clearTimeout(investmentStockDetailsVisibleLayoutTimer);
                investmentStockDetailsVisibleLayoutTimer = 0;
            }
        },
        compareInvestmentTransactions,
        constrainTickerDatesToSharedRange,
        convertAmountToBaseCurrency,
        createPositionState,
        formatAmount,
        formatAmountWithCurrency,
        formatEventType,
        formatHoldingsMoney,
        formatHoldingsPosition,
        formatInvestmentFullDateLines,
        formatInvestmentFullDateParts,
        formatMetricLossAmount,
        formatMetricLossAmountWithCurrency,
        formatTransactionCommissionDisplay,
        formatTransactionCurrency,
        formatTransactionDateDisplay,
        formatTransactionDescription,
        getIndexedClosePriceOnOrBefore,
        getInvestmentBaseCurrency,
        getInvestmentBrokerMeta,
        getInvestmentChartPointsCache: () => investmentChartPointsCache,
        getInvestmentMarketStoreTickerCandidates,
        getInvestmentProcessedTransactionsCache: () => investmentProcessedTransactionsCache,
        getInvestmentStockDetailsPanel: () => investmentStockDetailsPanel,
        getInvestmentStockDetailsPriceChartInstance: () => investmentStockDetailsPriceChartInstance,
        getInvestmentStockDetailsPriceChartRequestSerial: () => investmentStockDetailsPriceChartRequestSerial,
        getInvestmentStockDetailsRangeLabels,
        getInvestmentTradeSessionType,
        getInvestmentCanonicalTicker,
        getMoneyMarketTickerSet,
        getCashEquivalentTickerSet,
        getNormalizedTransactionType,
        getSelectedInvestmentStockDetailsRange: () => selectedInvestmentStockDetailsRange,
        getTickerQuoteCurrency,
        getTransactionAmount,
        getTransactionBrokerCode,
        getTransactionCommission,
        getTransactionEffectiveUnitPrice,
        getTransactionPrice,
        getTransactionQuantity,
        getTransactionValuationQuantity,
        incrementInvestmentStockDetailsPriceChartRequestSerial: () => {
            investmentStockDetailsPriceChartRequestSerial += 1;
            return investmentStockDetailsPriceChartRequestSerial;
        },
        isFlatPosition,
        isInvestmentStockDetailsIntradayRange,
        loadInvestmentStockDetailsIntradayRows,
        normalizeInvestmentLedgerNos,
        normalizeInvestmentIntradayMinuteKey,
        normalizeInvestmentStockDetailsRange,
        normalizeInvestmentTicker,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        renderInvestmentBrokerCell,
        resolveInvestmentTheme,
        setActiveStockDetailsHoverPointRecord: (value) => {
            activeStockDetailsHoverPointRecord = value;
        },
        setInvestmentStockDetailsPriceChartInstance: (value) => {
            investmentStockDetailsPriceChartInstance = value;
        },
        buildInvestmentAxisTickIndexes,
        getInvestmentLiveSessionDateKey,
        shouldRunInvestmentRealtimeQuotes,
        shouldTrackHoldingTicker,
        syncInvestmentHoverLinkedViews,
        syncInvestmentStockDetailsDonutFromInteraction,
        waitForInvestmentStableElementBox,
    });

    function bindInvestmentEquityRangeControls(chartPoints = []) {
        clearInvestmentEquityRangeControlBindings();
        const rangeControl = getInvestmentEquityRangeControl();
        if (!rangeControl) return;

        const checkedInput = rangeControl.querySelector(`input[value="${CSS.escape(normalizeInvestmentEquityRange(selectedInvestmentEquityRange))}"]`);
        if (checkedInput instanceof HTMLInputElement) {
            checkedInput.checked = true;
        }
        rangeControl.dataset.active = normalizeInvestmentEquityRange(selectedInvestmentEquityRange);

        const abortController = new AbortController();
        investmentEquityRangeControlAbortController = abortController;
        const { signal } = abortController;
        rangeControl.addEventListener('change', (event) => {
            const nextInput = event.target;
            if (!(nextInput instanceof HTMLInputElement) || nextInput.name !== 'investment_equity_range') return;
            const nextRange = normalizeInvestmentEquityRange(nextInput.value);
            selectedInvestmentEquityRange = nextRange;
            rememberInvestmentPageState({ equityRange: nextRange });
            rangeControl.dataset.active = nextRange;
            const nextIndex = Math.max(0, INVESTMENT_EQUITY_RANGE_OPTIONS.findIndex((option) => option.value === nextRange));
            rangeControl.style.setProperty('--segmented-active-index', String(nextIndex));
            updateInvestmentEquityRangePill();
            syncInvestmentHistoryHeading();
            const nextChartPoints = getInvestmentEquityChartInputPoints(chartPoints);
            renderInvestmentHistoryTableRows(investmentProcessedTransactionsCache, nextChartPoints, { resetPage: true, scrollToTop: true });
            updateInvestmentEquityChartDisplay(nextChartPoints);
        }, { signal });
        window.addEventListener('resize', updateInvestmentEquityRangePill, { signal });
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                updateInvestmentEquityRangePill();
            });
            resizeObserver.observe(rangeControl);
            const rangeShell = rangeControl.closest('.investment-stock-details-range-shell');
            if (rangeShell instanceof HTMLElement) resizeObserver.observe(rangeShell);
            investmentEquityRangeControlResizeObserver = resizeObserver;
        }
        scheduleInvestmentEquityRangePillUpdate();
    }

    function lockInvestmentSurfaceHeight() {
        if (!investmentViewSurface) return;
        const currentHeight = investmentViewSurface.getBoundingClientRect().height;
        const cappedHeight = getInvestmentSurfaceCappedHeight(currentHeight);
        investmentViewSurface.style.height = `${cappedHeight}px`;
        investmentViewSurface.style.overflow = 'clip';
    }

    function getInvestmentSurfaceMaxHeight() {
        if (!investmentViewSurface) return null;
        const reportCard = investmentViewSurface.closest('.investment-report-card');
        if (!(reportCard instanceof HTMLElement)) return null;
        const reportCardRect = reportCard.getBoundingClientRect();
        if (!Number.isFinite(reportCardRect.height) || reportCardRect.height <= 0) return null;
        const styles = window.getComputedStyle(reportCard);
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const paddingBottom = parseFloat(styles.paddingBottom) || 0;
        return Math.max(0, reportCardRect.height - paddingTop - paddingBottom);
    }

    function getInvestmentSurfaceCappedHeight(height) {
        const numericHeight = Number(height) || 0;
        const maxHeight = getInvestmentSurfaceMaxHeight();
        if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
            return Math.max(0, numericHeight);
        }
        return Math.max(0, Math.min(numericHeight, maxHeight));
    }

    function cleanupInvestmentSurfaceHeight() {
        if (!investmentViewSurface) return;
        investmentViewSurface.style.height = '';
        investmentViewSurface.style.overflow = '';
        if (investmentSurfaceCleanupTimer) {
            window.clearTimeout(investmentSurfaceCleanupTimer);
            investmentSurfaceCleanupTimer = null;
        }
        syncInvestmentShareActionsPosition();
    }

    function animateInvestmentSurfaceHeight() {
        if (!investmentViewSurface || !investmentViewSurfaceBody) return;
        if (!investmentViewSurface.style.height) {
            lockInvestmentSurfaceHeight();
        }
        void investmentViewSurface.offsetHeight;
        const targetHeight = getInvestmentSurfaceCappedHeight(investmentViewSurface.scrollHeight);
        investmentViewSurface.style.height = `${targetHeight}px`;
        if (investmentSurfaceCleanupTimer) {
            window.clearTimeout(investmentSurfaceCleanupTimer);
        }
        investmentSurfaceCleanupTimer = window.setTimeout(() => {
            cleanupInvestmentSurfaceHeight();
        }, 460);
    }

    function getInvestmentLocationTicker() {
        const search = new URLSearchParams(window.location.search || '');
        return normalizeInvestmentTicker(search.get('ticker') || '');
    }

    function buildInvestmentViewUrl(nextView, ticker = '') {
        const nextUrl = new URL(window.location.href);
        if (nextView === 'stock_details') {
            const normalizedTicker = normalizeInvestmentTicker(ticker || selectedInvestmentStockTicker || '');
            nextUrl.hash = INVESTMENT_STOCK_DETAILS_HASH;
            if (normalizedTicker) nextUrl.searchParams.set('ticker', normalizedTicker);
            else nextUrl.searchParams.delete('ticker');
            return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
        }
        nextUrl.hash = '';
        nextUrl.searchParams.delete('ticker');
        return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    }

    function buildInvestmentStockDetailsHref(ticker = '') {
        return buildInvestmentViewUrl('stock_details', ticker);
    }

    function syncInvestmentViewHash(nextView, ticker = '') {
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const nextUrl = buildInvestmentViewUrl(nextView, ticker);
        if (currentUrl === nextUrl) return;
        window.history.replaceState(null, '', nextUrl);
    }

    function syncInvestmentStockDetailsTableVisibility() {
        if (!(investmentStockDetailsTableHost instanceof HTMLElement)) return;
        const hasContent = investmentStockDetailsTableHost.childElementCount > 0
            || Boolean(investmentStockDetailsTableHost.textContent.trim());
        const isVisible = activeInvestmentView === 'stock_details' && hasContent;
        investmentStockDetailsTableHost.hidden = !isVisible;
        investmentHistorySurface?.classList.toggle('is-stock-details-table-visible', isVisible);
        if (isVisible) {
            attachStockDetailsTableAlignmentSync(investmentStockDetailsTableHost);
            return;
        }
        teardownStockDetailsTableAlignmentSync();
    }

    function scheduleInvestmentStockDetailsVisibleLayoutSync() {
        if (investmentStockDetailsVisibleLayoutTimer) {
            window.clearTimeout(investmentStockDetailsVisibleLayoutTimer);
            investmentStockDetailsVisibleLayoutTimer = 0;
        }
        if (activeInvestmentView !== 'stock_details') return;
        window.requestAnimationFrame(() => {
            if (activeInvestmentView !== 'stock_details') return;
            // Re-measure the segmented pill after the panel becomes visible.
            scheduleInvestmentStockDetailsRangePillUpdate();
            refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            const chartCanvas = investmentStockDetailsPriceChartInstance?.canvas;
            chartCanvas?._scheduleLayoutSync?.();
        });
        investmentStockDetailsVisibleLayoutTimer = window.setTimeout(() => {
            investmentStockDetailsVisibleLayoutTimer = 0;
            if (activeInvestmentView !== 'stock_details') return;
            scheduleInvestmentStockDetailsRangePillUpdate();
            refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            const chartCanvas = investmentStockDetailsPriceChartInstance?.canvas;
            chartCanvas?._scheduleLayoutSync?.();
        }, INVESTMENT_SURFACE_LAYOUT_SETTLE_MS);
    }

    function waitForInvestmentStableElementBox(element, {
        minimumWidth = 120,
        minimumHeight = 120,
        stableFramesRequired = 3,
        timeoutMs = INVESTMENT_SURFACE_LAYOUT_SETTLE_MS + 260,
    } = {}) {
        if (!(element instanceof HTMLElement)) return Promise.resolve(false);
        const isElementReady = () => {
            if (!element.isConnected) return false;
            if (element.closest('[hidden]')) return false;
            const rect = element.getBoundingClientRect();
            return rect.width >= minimumWidth && rect.height >= minimumHeight;
        };
        if (isElementReady()) {
            return new Promise((resolve) => {
                let stableFrames = 0;
                let lastWidth = Number.NaN;
                let lastHeight = Number.NaN;
                const startedAt = performance.now();
                const step = () => {
                    if (!element.isConnected) {
                        resolve(false);
                        return;
                    }
                    const rect = element.getBoundingClientRect();
                    const width = Math.round(rect.width * 100) / 100;
                    const height = Math.round(rect.height * 100) / 100;
                    const isReady = width >= minimumWidth && height >= minimumHeight;
                    const isStable = isReady
                        && Math.abs(width - lastWidth) < 0.5
                        && Math.abs(height - lastHeight) < 0.5;
                    stableFrames = isStable ? (stableFrames + 1) : 0;
                    lastWidth = width;
                    lastHeight = height;
                    if (stableFrames >= stableFramesRequired) {
                        resolve(true);
                        return;
                    }
                    if ((performance.now() - startedAt) >= timeoutMs) {
                        resolve(isReady);
                        return;
                    }
                    window.requestAnimationFrame(step);
                };
                window.requestAnimationFrame(step);
            });
        }
        return new Promise((resolve) => {
            const startedAt = performance.now();
            const step = () => {
                if (!element.isConnected) {
                    resolve(false);
                    return;
                }
                if (isElementReady()) {
                    waitForInvestmentStableElementBox(element, {
                        minimumWidth,
                        minimumHeight,
                        stableFramesRequired,
                        timeoutMs: Math.max(120, timeoutMs - (performance.now() - startedAt)),
                    }).then(resolve);
                    return;
                }
                if ((performance.now() - startedAt) >= timeoutMs) {
                    resolve(false);
                    return;
                }
                window.requestAnimationFrame(step);
            };
            window.requestAnimationFrame(step);
        });
    }

    function setInvestmentView(nextView, { syncHash = true } = {}) {
        if (!nextView) {
            return;
        }

        const normalizedNextView = normalizeInvestmentView(nextView);

        if (normalizedNextView === 'stock_details') {
            ensureSelectedInvestmentStockTicker();
        }

        if (normalizedNextView === activeInvestmentView) {
            rememberInvestmentPageState({ view: normalizedNextView });
            if (normalizedNextView === 'stock_details') {
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            }
            return;
        }

        lockInvestmentSurfaceHeight();

        if (segmentedControl) {
            const activeIndex = Math.max(INVESTMENT_VIEW_ORDER.indexOf(normalizedNextView), 0);
            const nextRadio = segmentedControl.querySelector(`input[type="radio"][value="${CSS.escape(normalizedNextView)}"]`);
            if (nextRadio instanceof HTMLInputElement) {
                nextRadio.checked = true;
            }
            segmentedControl.dataset.active = normalizedNextView;
            segmentedControl.style.setProperty('--segmented-option-count', String(INVESTMENT_VIEW_ORDER.length));
            segmentedControl.style.setProperty('--segmented-active-index', String(activeIndex));
            scheduleInvestmentSegmentedPillUpdate();
        }
        if (investmentViewSurface) {
            investmentViewSurface.dataset.activeView = normalizedNextView;
        }
        investmentPanels.forEach((panel) => {
            panel.hidden = panel.dataset.investmentViewPanel !== normalizedNextView;
        });
        activeInvestmentView = normalizedNextView;
        syncInvestmentStockDetailsTableVisibility();
        if (syncHash) {
            syncInvestmentViewHash(normalizedNextView);
        }
        rememberInvestmentPageState({ view: normalizedNextView });
        animateInvestmentSurfaceHeight();
        if (normalizedNextView === 'stock_details') {
            scheduleInvestmentStockDetailsVisibleLayoutSync();
        }
    }

    function initInvestmentViewTabs() {
        if (!segmentedControl) return;
        const radios = segmentedControl.querySelectorAll('input[type="radio"]');
        radios.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    setInvestmentView(radio.value);
                }
            });
        });
        const checkedRadio = segmentedControl.querySelector('input[type="radio"]:checked');
        const rememberedView = restoreRememberedInvestmentPageState();
        const restoredLocationFromMemory = restoreRememberedInvestmentLocation();
        activeInvestmentView = '';
        syncInvestmentViewFromLocationHash(restoredLocationFromMemory ? 'stock_details' : (rememberedView || checkedRadio?.value || 'chart'));
        if (!String(window.location.hash || '').trim() && activeInvestmentView === 'stock_details') {
            syncInvestmentViewHash('stock_details', selectedInvestmentStockTicker);
        }
        rememberInvestmentPageState({ view: activeInvestmentView || rememberedView || checkedRadio?.value || 'chart' });
        scheduleInvestmentSegmentedPillUpdate();
        scheduleIbkrImportSegmentedPillUpdate();
        cleanupInvestmentSurfaceHeight();

        if (document.fonts?.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => {
                scheduleInvestmentSegmentedPillUpdate();
                scheduleIbkrImportSegmentedPillUpdate();
            }).catch(() => {});
        }

        window.addEventListener('resize', () => {
            scheduleInvestmentSegmentedPillUpdate();
            scheduleIbkrImportSegmentedPillUpdate();
        });

        if (window.ResizeObserver) {
            const segmentedResizeObserver = new ResizeObserver(() => {
                scheduleInvestmentSegmentedPillUpdate();
            });
            segmentedResizeObserver.observe(segmentedControl);
            radios.forEach((radio) => {
                const optionLabel = radio.nextElementSibling;
                if (optionLabel instanceof HTMLElement) {
                    segmentedResizeObserver.observe(optionLabel);
                }
            });
        }

        if (window.ResizeObserver && investmentImportIbkrMode instanceof HTMLElement) {
            const ibkrResizeObserver = new ResizeObserver(() => {
                scheduleIbkrImportSegmentedPillUpdate();
            });
            ibkrResizeObserver.observe(investmentImportIbkrMode);
            const ibkrRadios = investmentImportIbkrMode.querySelectorAll('input[type="radio"]');
            ibkrRadios.forEach((radio) => {
                const optionLabel = radio.nextElementSibling;
                if (optionLabel instanceof HTMLElement) {
                    ibkrResizeObserver.observe(optionLabel);
                }
            });
        }

        window.addEventListener('hashchange', () => {
            syncInvestmentViewFromLocationHash(activeInvestmentView || 'chart');
        });
    }

    function interpolateHexColor(startHex, endHex, t) {
        const normalizedT = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const parseHex = (hex) => {
            const normalized = String(hex || '').replace('#', '');
            if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
            return {
                r: Number.parseInt(normalized.slice(0, 2), 16),
                g: Number.parseInt(normalized.slice(2, 4), 16),
                b: Number.parseInt(normalized.slice(4, 6), 16),
            };
        };
        const start = parseHex(startHex);
        const end = parseHex(endHex);
        const mix = (left, right) => Math.round(left + ((right - left) * normalizedT));
        const toHex = (value) => value.toString(16).padStart(2, '0');
        return `#${toHex(mix(start.r, end.r))}${toHex(mix(start.g, end.g))}${toHex(mix(start.b, end.b))}`;
    }

    function buildInvestmentDummyPalette(count) {
        const resolvedTheme = resolveInvestmentTheme();
        if (!Number.isFinite(count) || count <= 0) return [];
        if (count === 1) return [resolvedTheme.accentPrimary];
        return Array.from({ length: count }, (_, index) => {
            const ratio = index / (count - 1);
            return interpolateHexColor(resolvedTheme.accentPrimary, resolvedTheme.accentSecondary, ratio);
        });
    }

    function ensureAnimatedDonutLayers(donutElement) {
        if (!(donutElement instanceof HTMLElement)) return [];
        donutElement.classList.add('is-animated');
        let fillLayerA = donutElement.querySelector('.portfolio-donut-fill-layer-a');
        let fillLayerB = donutElement.querySelector('.portfolio-donut-fill-layer-b');
        if (!(fillLayerA instanceof HTMLElement)) {
            fillLayerA = document.createElement('span');
            fillLayerA.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-a';
            donutElement.appendChild(fillLayerA);
        }
        if (!(fillLayerB instanceof HTMLElement)) {
            fillLayerB = document.createElement('span');
            fillLayerB.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-b';
            donutElement.appendChild(fillLayerB);
        }
        return [fillLayerA, fillLayerB];
    }

    function applyAnimatedDonutFill(donutElement, fillValue) {
        if (!(donutElement instanceof HTMLElement)) return;
        const [fillLayerA, fillLayerB] = ensureAnimatedDonutLayers(donutElement);
        if (!(fillLayerA instanceof HTMLElement) || !(fillLayerB instanceof HTMLElement)) {
            donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
            return;
        }
        const activeLayerKey = donutElement.dataset.activeFillLayer === 'b' ? 'b' : 'a';
        const nextLayerKey = activeLayerKey === 'a' ? 'b' : 'a';
        const nextLayer = nextLayerKey === 'a' ? fillLayerA : fillLayerB;
        nextLayer.style.background = fillValue;
        donutElement.dataset.activeFillLayer = nextLayerKey;
        donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
    }

    function syncAnimatedDonutLogos(logoLayer, logoItems) {
        if (!(logoLayer instanceof HTMLElement)) return;
        const existingLogos = new Map(
            Array.from(logoLayer.querySelectorAll('.portfolio-donut-logo')).map((logo) => [logo.dataset.ticker || '', logo])
        );
        const nextTickers = new Set();
        logoItems.forEach((item) => {
            nextTickers.add(item.ticker);
            let logo = existingLogos.get(item.ticker);
            if (!(logo instanceof HTMLImageElement)) {
                logo = document.createElement('img');
                logo.className = 'portfolio-donut-logo';
                logo.dataset.ticker = item.ticker;
                logo.alt = `${item.ticker} logo`;
                logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
                logo.style.opacity = '0';
                logoLayer.appendChild(logo);
                window.requestAnimationFrame(() => {
                    logo.style.opacity = '1';
                });
            } else {
                if (logo.src !== item.logoUrl) logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
            }
            if (item.className) {
                logo.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
            }
            logo.classList.remove('is-exiting');
        });
        existingLogos.forEach((logo, ticker) => {
            if (nextTickers.has(ticker)) return;
            logo.classList.add('is-exiting');
            window.setTimeout(() => {
                if (logo.classList.contains('is-exiting')) logo.remove();
            }, 220);
        });
    }

    function buildMarketStoreLogoFilenames(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return ['stock.png'];

        const filenames = [];
        const addFilename = (value) => {
            const normalizedValue = String(value || '').trim();
            if (!normalizedValue || filenames.includes(normalizedValue)) return;
            filenames.push(normalizedValue);
        };

        getInvestmentMarketStoreTickerCandidates(ticker).forEach((candidate) => {
            if (candidate.includes('.')) {
                const [symbol, suffix] = candidate.split('.');
                if (suffix === 'HK') {
                    const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
                    if (strippedSymbol && strippedSymbol !== symbol) {
                        addFilename(`${strippedSymbol}.${suffix}.svg`);
                        addFilename(`${strippedSymbol}.${suffix}.png`);
                    }
                }
                addFilename(`${candidate}.svg`);
                addFilename(`${candidate}.png`);
                return;
            }
            addFilename(`${candidate}.svg`);
            addFilename(`${candidate}.png`);
        });
        return filenames.length ? filenames : [`${normalizedTicker}.png`];
    }

    function buildMarketStoreLogoUrl(ticker) {
        const [filename] = buildMarketStoreLogoFilenames(ticker);
        return `/market-store/logos/${encodeURIComponent(filename || 'stock.png')}`;
    }

    function getInvestmentMarketStoreTickerCandidates(ticker) {
        return getInvestmentTickerStoreAliasCandidates(ticker);
    }

    function buildMarketStoreLogoUrls(ticker) {
        return buildMarketStoreLogoFilenames(ticker).map((filename) => (
            `/market-store/logos/${encodeURIComponent(filename)}`
        ));
    }

    function normalizeInvestmentLogoUrlList(logoUrl) {
        const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
        return Array.from(new Set(values
            .map((value) => String(value || '').trim())
            .filter(Boolean)));
    }

    function resolveInvestmentLogoUrl(profile, ticker) {
        if (isDollarTokenMoneyMarketTicker(ticker)) {
            return '/market-store/logos/dollarsign.ring.svg';
        }
        const logoUrl = String(profile?.logo_url || '').trim();
        return logoUrl || buildMarketStoreLogoUrls(ticker)[0] || buildMarketStoreLogoUrl(ticker);
    }

    function resolveInvestmentLogoUrls(profile, ticker) {
        if (isDollarTokenMoneyMarketTicker(ticker)) {
            return ['/market-store/logos/dollarsign.ring.svg'];
        }
        return normalizeInvestmentLogoUrlList([
            String(profile?.logo_url || '').trim(),
            ...buildMarketStoreLogoUrls(ticker),
        ]);
    }

    function setInvestmentTickerLogoVisibility(logo, placeholder, isLoaded) {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? '1' : '0';
        }
        if (placeholder instanceof HTMLElement) {
            placeholder.hidden = isLoaded;
        }
    }

    function syncInvestmentTickerLogoAsset(logo, placeholder, logoUrl, altText = '') {
        const normalizedUrls = normalizeInvestmentLogoUrlList(logoUrl);
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder instanceof HTMLElement) {
                placeholder.hidden = normalizedUrls.length > 0;
            }
            return;
        }
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrls.length) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute('src');
            logo.alt = '';
            setInvestmentTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.alt = altText;
        logo.loading = 'eager';
        const tryLoadAtIndex = (index) => {
            const nextUrl = normalizedUrls[index];
            if (!nextUrl) {
                delete logo.dataset.requestedSrc;
                logo.removeAttribute('src');
                setInvestmentTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            logo.dataset.requestedSrc = nextUrl;
            setInvestmentTickerLogoVisibility(logo, placeholder, false);
            const finalize = (isLoaded) => {
                if (logo.dataset.requestedSrc !== nextUrl) return;
                if (!isLoaded) {
                    tryLoadAtIndex(index + 1);
                    return;
                }
                setInvestmentTickerLogoVisibility(logo, placeholder, true);
            };
            logo.onload = () => finalize(true);
            logo.onerror = () => finalize(false);
            if (logo.getAttribute('src') !== nextUrl) {
                logo.src = nextUrl;
            }
            if (logo.complete) {
                finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
            }
        };
        tryLoadAtIndex(0);
    }

    function getActiveInvestmentInteractionPoint() {
        if (Array.isArray(investmentChartPointsCache) && investmentChartPointsCache.length) {
            if (Number.isFinite(activeChartTooltipPointIndex) && activeChartTooltipPointIndex >= 0) {
                return investmentChartPointsCache[activeChartTooltipPointIndex] || null;
            }
            if (Number.isFinite(activeHoldingsHoverLedgerNo) && activeHoldingsHoverLedgerNo > 0) {
                const hoverIndex = investmentChartPointIndexByLedgerNo.get(activeHoldingsHoverLedgerNo);
                if (Number.isFinite(hoverIndex) && hoverIndex >= 0) {
                    return investmentChartPointsCache[hoverIndex] || null;
                }
            }
            return investmentLatestChartPoint || investmentChartPointsCache[investmentChartPointsCache.length - 1] || null;
        }
        return null;
    }

    function renderInvestmentDummyPortfolioDonut(pointRecord, tickerProfiles) {
        const resolvedTheme = resolveInvestmentTheme();
        if (!(investmentDummyChart instanceof HTMLElement) || !(investmentDummyLogoLayer instanceof HTMLElement) || !(investmentDummyDonut instanceof HTMLElement)) return;
        const holdingsMarketValues = pointRecord?.aggregate_holdings_market_values || pointRecord?.holdings_market_values || {};
        const cashEquivalentSet = getCashEquivalentTickerSet();
        const allHoldings = Object.entries(holdingsMarketValues)
            .map(([ticker, value]) => ({ ticker: normalizeInvestmentTicker(ticker), marketValue: Number(value) || 0 }))
            .filter((entry) => entry.ticker && entry.marketValue > 1e-9)
            .sort((left, right) => right.marketValue - left.marketValue);
        const nonCashComponents = allHoldings.filter((entry) => !cashEquivalentSet.has(entry.ticker));
        const holdingsTotalValue = allHoldings.reduce((sum, entry) => sum + entry.marketValue, 0);
        const cashValue = Math.max(0, Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0);
        const fallbackTotal = holdingsTotalValue + cashValue;
        const denominator = Math.max(Number(pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            syncAnimatedDonutLogos(investmentDummyLogoLayer, []);
            applyAnimatedDonutFill(investmentDummyDonut, 'conic-gradient(var(--theme-accent-positive) 0deg 360deg)');
            refreshInvestmentDummyDonut();
            return;
        }

        const palette = buildInvestmentDummyPalette(nonCashComponents.length);
        const logoItems = [];
        const fillFragments = [];
        const gapDegrees = 1.2;
        let angle = 0;
        let gradientIndex = 0;

        allHoldings.forEach((entry) => {
            const marketValue = entry.marketValue;
            if (marketValue <= 1e-9) return;
            const sweep = (marketValue / denominator) * 360;
            if (sweep <= 1e-9) return;
            const segmentStart = angle;
            const segmentEnd = Math.min(segmentStart + sweep, 360);
            if ((segmentEnd - segmentStart) > 1e-9) {
                const ticker = entry.ticker;
                const isCashEquivalent = cashEquivalentSet.has(ticker);
                const segmentColor = isCashEquivalent
                    ? 'var(--theme-accent-positive)'
                    : (palette[gradientIndex] || resolvedTheme.accentPrimary);
                fillFragments.push(`${segmentColor} ${segmentStart}deg ${segmentEnd}deg`);
                const midAngle = segmentStart + ((segmentEnd - segmentStart) / 2);
                const profile = resolveInvestmentTickerProfile(tickerProfiles, ticker);
                const logoUrl = resolveInvestmentLogoUrl(profile, ticker);
                logoItems.push({ ticker, logoUrl, midAngle });
                if (!isCashEquivalent) {
                    gradientIndex += 1;
                }
            }
            const hasRemaining = segmentEnd < 360;
            const gapEnd = hasRemaining ? Math.min(segmentEnd + gapDegrees, 360) : segmentEnd;
            if ((gapEnd - segmentEnd) > 1e-9) {
                fillFragments.push(`transparent ${segmentEnd}deg ${gapEnd}deg`);
            }
            angle = gapEnd;
        });

        const cashStart = Math.min(Math.max(angle, 0), 360);
        if ((360 - cashStart) > 1e-9) {
            fillFragments.push(`var(--theme-accent-positive) ${cashStart}deg 360deg`);
        }

        const renderSignature = `${fillFragments.join('|')}::${logoItems.map((item) => (
            `${item.ticker}@${item.logoUrl}@${item.midAngle.toFixed(4)}`
        )).join('|')}`;
        if (renderSignature === investmentDummyDonutRenderSignature) return;
        investmentDummyDonutRenderSignature = renderSignature;

        syncInvestmentDonutOrbitLogos(investmentDummyLogoLayer, logoItems);
        applyAnimatedDonutFill(investmentDummyDonut, `conic-gradient(${fillFragments.join(', ')})`);
        refreshInvestmentDummyDonut();
    }

    function scheduleInvestmentDummyDonutSync() {
        if (investmentDummyDonutSyncFrame) return;
        investmentDummyDonutSyncFrame = window.requestAnimationFrame(() => {
            investmentDummyDonutSyncFrame = 0;
            syncInvestmentDummyDonutFromInteraction();
        });
    }

    function syncInvestmentDummyDonutFromInteraction() {
        if (!Array.isArray(investmentChartPointsCache) || !investmentChartPointsCache.length) return;
        const pointRecord = getActiveInvestmentInteractionPoint();
        if (!pointRecord) return;
        renderInvestmentDummyPortfolioDonut(pointRecord, investmentDummyTickerProfiles);
    }

    function buildStockDetailsDonutSegments(pointRecord, tickerSummary, activeTicker) {
        const holdingsMarketValues = pointRecord?.aggregate_holdings_market_values || pointRecord?.holdings_market_values || {};
        const currentTicker = normalizeInvestmentTicker(activeTicker || tickerSummary?.ticker);
        const currentTickerValue = Math.max(0, Number(holdingsMarketValues?.[currentTicker]) || 0);
        const cashValue = Math.max(0, Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0);
        const holdingsTotal = Object.values(holdingsMarketValues)
            .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        const fallbackTotal = holdingsTotal + cashValue;
        const denominator = Math.max(Number(pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            return {
                denominator: 0,
                currentTickerValue: 0,
                cashValue: 0,
                remainderValue: 0,
            };
        }

        const clampedTickerValue = Math.min(currentTickerValue, denominator);
        const availableAfterTicker = Math.max(0, denominator - clampedTickerValue);
        const clampedCashValue = Math.min(cashValue, availableAfterTicker);
        const remainderValue = Math.max(0, denominator - clampedTickerValue - clampedCashValue);
        return {
            denominator,
            currentTickerValue: clampedTickerValue,
            cashValue: clampedCashValue,
            remainderValue,
        };
    }

    function buildStockDetailsDonutState(pointRecord, tickerSummary, profile) {
        const activeTicker = normalizeInvestmentTicker(tickerSummary?.ticker || '');
        const logoUrl = resolveInvestmentLogoUrl(profile, activeTicker || 'stock');
        const segments = buildStockDetailsDonutSegments(pointRecord, tickerSummary, activeTicker);
        const tickerSweep = segments.denominator > 1e-9
            ? (segments.currentTickerValue / segments.denominator) * 360
            : 0;
        return {
            denominator: segments.denominator,
            tickerSweep: Math.max(0, Math.min(360, tickerSweep)),
            cashSweep: segments.denominator > 1e-9
                ? Math.max(0, Math.min(360, (segments.cashValue / segments.denominator) * 360))
                : 0,
            remainderSweep: segments.denominator > 1e-9
                ? Math.max(0, Math.min(360, (segments.remainderValue / segments.denominator) * 360))
                : 360,
            ticker: activeTicker,
            logoUrl,
        };
    }

    function normalizeStockDetailsDonutState(state, fallbackTicker = '') {
        const ticker = normalizeInvestmentTicker(state?.ticker || fallbackTicker || '');
        const tickerSweep = Math.max(0, Math.min(360, Number(state?.tickerSweep) || 0));
        const cashSweep = Math.max(0, Math.min(360 - tickerSweep, Number(state?.cashSweep) || 0));
        const remainderSweep = Math.max(0, 360 - tickerSweep - cashSweep);
        return {
            ticker,
            logoUrl: String(state?.logoUrl || '').trim(),
            tickerSweep,
            cashSweep,
            remainderSweep,
        };
    }

    function buildStockDetailsDonutFill(state) {
        const normalizedState = normalizeStockDetailsDonutState(state);
        const fragments = [];
        let angle = 0;

        if (normalizedState.tickerSweep > 1e-9) {
            const end = angle + normalizedState.tickerSweep;
            fragments.push(`var(--theme-accent-primary) ${angle}deg ${end}deg`);
            angle = end;
        }
        if (normalizedState.cashSweep > 1e-9) {
            const end = angle + normalizedState.cashSweep;
            fragments.push(`var(--theme-accent-positive) ${angle}deg ${end}deg`);
            angle = end;
        }
        const grayStart = Math.min(Math.max(angle, 0), 360);
        fragments.push(`${STOCK_DETAILS_DONUT_GRAY_FILL} ${grayStart}deg 360deg`);
        return `conic-gradient(${fragments.join(', ')})`;
    }

    function getStockDetailsLogoAngle(state) {
        const normalizedState = normalizeStockDetailsDonutState(state);
        if (normalizedState.tickerSweep <= 1e-9) return 0;
        return normalizedState.tickerSweep / 2;
    }

    function applyStockDetailsDonutState(renderState) {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const donutElement = investmentStockDetailsPanel.querySelector('.investment-stock-details-donut');
        const logoLayer = investmentStockDetailsPanel.querySelector('.investment-stock-details-donut-logo-layer');
        if (!(donutElement instanceof HTMLElement) || !(logoLayer instanceof HTMLElement)) return;
        const normalizedState = normalizeStockDetailsDonutState(renderState);
        const logoAngle = getStockDetailsLogoAngle(normalizedState);
        syncAnimatedDonutLogos(logoLayer, normalizedState.logoUrl ? [{
            ticker: normalizedState.ticker || 'stock',
            logoUrl: normalizedState.logoUrl,
            midAngle: logoAngle,
            className: 'investment-stock-details-donut-logo',
        }] : []);
        applyAnimatedDonutFill(donutElement, buildStockDetailsDonutFill(normalizedState));
        refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
    }

    function animateStockDetailsDonutTo(nextState) {
        const fallbackTicker = normalizeInvestmentTicker(nextState?.ticker || stockDetailsDonutAnimatedState?.ticker || '');
        const targetState = normalizeStockDetailsDonutState(nextState, fallbackTicker);
        const startState = normalizeStockDetailsDonutState(stockDetailsDonutAnimatedState || targetState, fallbackTicker);
        const isSameTarget = startState.ticker === targetState.ticker
            && startState.logoUrl === targetState.logoUrl
            && Math.abs(startState.tickerSweep - targetState.tickerSweep) < 1e-6
            && Math.abs(startState.cashSweep - targetState.cashSweep) < 1e-6;
        if (isSameTarget) {
            stockDetailsDonutAnimatedState = targetState;
            applyStockDetailsDonutState(targetState);
            return;
        }

        if (stockDetailsDonutAnimationFrame) {
            window.cancelAnimationFrame(stockDetailsDonutAnimationFrame);
            stockDetailsDonutAnimationFrame = 0;
        }

        stockDetailsDonutAnimationStartTime = performance.now();
        const duration = 440;
        const step = (now) => {
            const progress = Math.min(1, (now - stockDetailsDonutAnimationStartTime) / duration);
            const eased = easeOutCubic(progress);
            const frameState = normalizeStockDetailsDonutState({
                ticker: targetState.ticker,
                logoUrl: targetState.logoUrl,
                tickerSweep: startState.tickerSweep + ((targetState.tickerSweep - startState.tickerSweep) * eased),
                cashSweep: startState.cashSweep + ((targetState.cashSweep - startState.cashSweep) * eased),
            }, fallbackTicker);
            stockDetailsDonutAnimatedState = frameState;
            applyStockDetailsDonutState(frameState);
            if (progress < 1) {
                stockDetailsDonutAnimationFrame = window.requestAnimationFrame(step);
                return;
            }
            stockDetailsDonutAnimatedState = targetState;
            applyStockDetailsDonutState(targetState);
            stockDetailsDonutAnimationFrame = 0;
        };
        stockDetailsDonutAnimationFrame = window.requestAnimationFrame(step);
    }

    function renderInvestmentStockDetailsDonut(pointRecord, tickerSummary, profile) {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        animateStockDetailsDonutTo(buildStockDetailsDonutState(pointRecord, tickerSummary, profile));
    }

    function syncInvestmentStockDetailsDonutFromInteraction() {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = ensureSelectedInvestmentStockTicker();
        if (!activeTicker) return;
        const tickerSummary = investmentTickerSummariesCache.find((summary) => normalizeInvestmentTicker(summary?.ticker) === activeTicker) || createPositionState(activeTicker);
        const profile = resolveInvestmentTickerProfile(
            window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {},
            activeTicker,
        );
        const pointRecord = activeStockDetailsHoverPointRecord
            || getActiveInvestmentInteractionPoint()
            || investmentLatestChartPoint
            || null;
        renderInvestmentStockDetailsDonut(pointRecord, tickerSummary, profile);
    }

    function refreshPortfolioDonutOrbits(rootElement) {
        if (!(rootElement instanceof HTMLElement)) return;
        rootElement.querySelectorAll('.style-token-portfolio-donut-orbit').forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
            const orbitMetrics = getPortfolioDonutOrbitMetrics(orbitElement);
            if (!orbitMetrics) return;
            const orbitLogoLayer = orbitElement.querySelector('.portfolio-donut-logo-layer');
            const orbitLayerState = orbitLogoLayer instanceof HTMLElement
                ? getInvestmentDonutOrbitAnimationState(orbitLogoLayer)
                : null;
            if (orbitLayerState) {
                orbitLayerState.orbitMetrics = orbitMetrics;
            }
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                if (logoElement.classList.contains('is-orbit-animated')) {
                    const layerState = getInvestmentDonutOrbitAnimationState(logoElement.parentElement);
                    const stateEntry = layerState?.logos?.get(logoElement.dataset.ticker || '');
                    if (stateEntry) {
                        renderInvestmentDonutOrbitLogoPosition(
                            logoElement,
                            stateEntry.currentAngle,
                            orbitMetrics,
                            stateEntry.currentRadiusScale,
                            stateEntry.currentOpacity
                        );
                        return;
                    }
                }
                const angle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || '');
                if (!Number.isFinite(angle)) return;
                renderInvestmentDonutOrbitLogoPosition(logoElement, angle, orbitMetrics, 1, Number.parseFloat(logoElement.style.opacity || '1'));
            });
        });
    }

    function refreshInvestmentDummyDonut() {
        refreshPortfolioDonutOrbits(investmentDummyChart);
    }

    function initInvestmentDummyDonut() {
        if (!(investmentDummyChart instanceof HTMLElement)) return;
        refreshInvestmentDummyDonut();
        refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
        if (window.ResizeObserver) {
            const donutResizeObserver = new ResizeObserver(() => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            });
            donutResizeObserver.observe(investmentDummyChart);
            const orbit = investmentDummyChart.querySelector('.style-token-portfolio-donut-orbit');
            if (orbit instanceof HTMLElement) {
                donutResizeObserver.observe(orbit);
            }
            if (investmentStockDetailsPanel instanceof HTMLElement) {
                donutResizeObserver.observe(investmentStockDetailsPanel);
            }
        } else {
            window.addEventListener('resize', () => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(investmentStockDetailsPanel);
            }, {passive: true});
        }
    }

    function countInvestmentPendingInternalTransferBindings(processedTransactions = investmentProcessedTransactionsCache) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        return transactions.filter((txn) => (
            Boolean(txn?.manual_internal_transfer_needs_binding)
            && Number(txn?.manual_internal_transfer_candidate_count || 0) > 0
        )).length;
    }

    function buildInvestmentImportFeedbackListHtml(items = []) {
        const normalizedItems = Array.isArray(items)
            ? items.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (!normalizedItems.length) return '';
        return `
            <ol class="investment-import-feedback-list">
                ${normalizedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ol>
        `.trim();
    }

    function buildIbkrImportFeedbackMessage({
        importSummary = null,
        refreshNotice = '',
        valuationNotice = '',
        pendingTransferCount = 0,
    } = {}) {
        const incrementalImport = importSummary && typeof importSummary === 'object'
            ? importSummary.incremental_import
            : null;
        const importedRecordCount = Number(incrementalImport?.imported_record_count);
        const addedRecordCount = Number(incrementalImport?.added_record_count);
        const duplicateRecordCount = Number(incrementalImport?.duplicate_record_count);
        const items = [
            'Matching records were merged incrementally into the local investment store without clearing older data first.',
            'The server does not store your original CSV files. They were processed in memory and discarded after the import finished.',
        ];
        if (
            Number.isFinite(importedRecordCount)
            && Number.isFinite(addedRecordCount)
            && Number.isFinite(duplicateRecordCount)
        ) {
            items.unshift(
                `This run parsed ${importedRecordCount.toLocaleString('en-US')} records, added ${addedRecordCount.toLocaleString('en-US')}, and treated ${duplicateRecordCount.toLocaleString('en-US')} as already present.`
            );
        }
        if (pendingTransferCount > 0) {
            items.push(
                `Immediate action: Review and bind ${pendingTransferCount} possible HSBC transfer ${pendingTransferCount === 1 ? 'match' : 'matches'} in Transaction history to remove duplicate-equity spikes.`
            );
        }
        const trimmedRefreshNotice = String(refreshNotice || '').trim();
        const trimmedValuationNotice = String(valuationNotice || '').trim();
        if (trimmedRefreshNotice) items.push(trimmedRefreshNotice);
        if (trimmedValuationNotice) items.push(trimmedValuationNotice);
        return `
            <div class="investment-import-feedback-copy">
                <p class="investment-import-feedback-heading">IBKR import complete.</p>
                ${buildInvestmentImportFeedbackListHtml(items)}
            </div>
        `.trim();
    }

    function setImportFeedback(message, variant = 'success', { allowHtml = false } = {}) {
        if (!importFeedback) return;
        const resolvedVariant = ['error', 'warning', 'success', 'loading'].includes(variant) ? variant : 'success';
        const isError = resolvedVariant === 'error';
        const isWarning = resolvedVariant === 'warning';
        const isLoading = resolvedVariant === 'loading';
        importFeedback.hidden = true;
        importFeedback.style.animation = 'none';
        void importFeedback.offsetWidth;
        importFeedback.style.animation = '';
        importFeedback.removeAttribute('hidden');
        if (importFeedbackMessage) {
            const resolvedMessage = String(message || '').trim()
                || (isError ? 'Import failed.' : (isWarning ? 'Investment data loaded with warnings.' : 'Import complete.'));
            if (allowHtml) {
                importFeedbackMessage.innerHTML = resolvedMessage;
            } else {
                importFeedbackMessage.textContent = resolvedMessage;
            }
        } else {
            importFeedback.textContent = message;
        }
        if (importFeedbackIcon) {
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-error', isError || isWarning);
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-success', !isError && !isWarning && !isLoading);
            importFeedbackIcon.classList.toggle('icon-modal-dialog-banner-default', isError || isWarning || isLoading);
        }
    }

    function clearImportFeedback() {
        if (!importFeedback) return;
        importFeedback.setAttribute('hidden', '');
        if (importFeedbackMessage) {
            importFeedbackMessage.textContent = '';
        } else {
            importFeedback.textContent = '';
        }
        if (importFeedbackIcon) {
            importFeedbackIcon.classList.remove('investment-import-feedback-banner-icon-error');
            importFeedbackIcon.classList.remove('investment-import-feedback-banner-icon-success');
            importFeedbackIcon.classList.add('icon-modal-dialog-banner-default');
        }
    }

    function showInvestmentWorkspaceModal({
        title = WORKSPACE_MODAL_DEFAULT_TITLE,
        copy = WORKSPACE_MODAL_DEFAULT_COPY,
        iconClass = WORKSPACE_MODAL_DEFAULT_ICON_CLASS.replace(/^icon\s+/, ''),
        lockClose = false,
    } = {}) {
        if (!workspaceModalOverlay) return;
        if (workspaceModalOverlayTitle) {
            workspaceModalOverlayTitle.textContent = title;
        }
        if (workspaceModalOverlayCopy) {
            workspaceModalOverlayCopy.textContent = copy;
        }
        if (workspaceModalOverlayIcon) {
            const normalizedIconClass = String(iconClass || '').trim().replace(/^icon\s+/, '');
            workspaceModalOverlayIcon.className = normalizedIconClass
                ? `icon ${normalizedIconClass} workspace-modal-icon`
                : WORKSPACE_MODAL_DEFAULT_ICON_CLASS;
        }
        if (workspaceModalOverlayClose) {
            workspaceModalOverlayClose.hidden = lockClose;
            workspaceModalOverlayClose.disabled = lockClose;
            workspaceModalOverlayClose.setAttribute('aria-hidden', lockClose ? 'true' : 'false');
        }
        workspaceModalOverlay.hidden = false;
    }

    function showInvestmentLoadingModal() {
        showInvestmentWorkspaceModal({
            title: INVESTMENT_LOADING_MODAL_TITLE,
            copy: INVESTMENT_LOADING_MODAL_COPY,
            iconClass: INVESTMENT_LOADING_MODAL_ICON_CLASS,
        });
    }

    function hideInvestmentLoadingModal({ resetContent = false } = {}) {
        if (!workspaceModalOverlay) return;
        workspaceModalOverlay.hidden = true;
        if (workspaceModalOverlayClose) {
            workspaceModalOverlayClose.hidden = false;
            workspaceModalOverlayClose.disabled = false;
            workspaceModalOverlayClose.setAttribute('aria-hidden', 'false');
        }
        if (!resetContent) return;
        if (workspaceModalOverlayTitle && WORKSPACE_MODAL_DEFAULT_TITLE) {
            workspaceModalOverlayTitle.textContent = WORKSPACE_MODAL_DEFAULT_TITLE;
        }
        if (workspaceModalOverlayCopy && WORKSPACE_MODAL_DEFAULT_COPY) {
            workspaceModalOverlayCopy.textContent = WORKSPACE_MODAL_DEFAULT_COPY;
        }
        if (workspaceModalOverlayIcon && WORKSPACE_MODAL_DEFAULT_ICON_CLASS) {
            workspaceModalOverlayIcon.className = WORKSPACE_MODAL_DEFAULT_ICON_CLASS;
        }
    }

    function isLikelyCsvFile(file) {
        return Boolean(file && /\.csv$/i.test(file.name || ''));
    }

    function isLikelyTransactionHistoryFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return upperName.includes('TRANSACTIONS');
    }

    function isLikelyPositionsFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return !upperName.includes('TRANSACTIONS');
    }

    function isLikelyGainskeeperFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        return lowerName.endsWith('.gkx') || lowerName.endsWith('.ofx');
    }

    function isLikelyPdfFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
    }

    function isLikelyFutuStatementPdf(file) {
        if (!isLikelyPdfFile(file)) return false;
        const fileName = String(file.name || '').trim();
        if (!fileName) return false;
        if (/\d{10,}-\d+-\d{6}-/.test(fileName)) return true;
        if (/statement|月結單|结单/i.test(fileName)) return true;
        return file.size > 1024;
    }

    function isLikelyLongbridgeSgFundDetailsFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return lowerName.endsWith('.txt') || mimeType === 'text/plain';
    }

    function isLikelyLongbridgeSgHistoryOrdersFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return (
            lowerName.endsWith('.xlsx')
            || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    }

    function getSelectedFutuStatementPdfFiles() {
        if (!(futuhkStatementPdfsInput instanceof HTMLInputElement)) return [];
        return Array.from(futuhkStatementPdfsInput.files || []).filter((file) => file instanceof File);
    }

    function getSelectedStatementPdfFiles(input) {
        if (!(input instanceof HTMLInputElement)) return [];
        return Array.from(input.files || []).filter((file) => file instanceof File);
    }

    function setImportStatusIcon(icon, visible) {
        if (!icon) return;
        icon.classList.toggle('is-visible', Boolean(visible));
    }

    function setInvestmentExportButtonVisibility(isVisible) {
        investmentHasExportableTransactions = Boolean(isVisible);
        const shouldShowShareActions = investmentHasExportableTransactions && investmentChartReady;
        if (investmentShareActions) {
            investmentShareActions.hidden = !shouldShowShareActions;
        }
        if (!exportTransactionsButton) return;
        exportTransactionsButton.hidden = !shouldShowShareActions;
    }

    function setInvestmentChartReady(isReady, canvas = null) {
        investmentChartReady = Boolean(isReady);
        if (canvas instanceof HTMLCanvasElement) {
            canvas.dataset.investmentChartReady = investmentChartReady ? '1' : '0';
        }
        setInvestmentExportButtonVisibility(investmentHasExportableTransactions);
    }

    function normalizeInvestmentTicker(ticker) {
        return String(ticker || '').trim().toUpperCase();
    }

    function isLongbridgeHkCashEquivalentSyntheticTicker(ticker) {
        return normalizeInvestmentTicker(ticker).startsWith(`${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`);
    }

    function isFranklinMoneyMarketTicker(ticker) {
        return normalizeInvestmentTicker(ticker) === '005276756';
    }

    function isDollarTokenMoneyMarketTicker(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker || isFranklinMoneyMarketTicker(normalizedTicker)) return false;
        if (isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) return true;
        return getMoneyMarketTickerSet().has(normalizedTicker);
    }

    function getCashEquivalentFundDisplayName(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (isFranklinMoneyMarketTicker(normalizedTicker)) {
            return 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund';
        }
        if (!isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) {
            if (normalizedTicker === 'HK0000369196.USD') return 'USD Money Market Fund (HK0000369196.USD)';
            if (normalizedTicker === 'HK0001039582.USD') return 'USD Money Market Fund (HK0001039582.USD)';
            if (isDollarTokenMoneyMarketTicker(normalizedTicker)) return 'Money Market Fund';
            return '';
        }
        const parts = normalizedTicker.split('.');
        const fundId = parts[1] || '';
        const currency = parts[2] || '';
        const fundNames = {
            PING_AN_MONEY_MARKET_USD: 'Ping An Money Market Fund',
            PING_AN_MONEY_MARKET_HKD: 'Ping An Money Market Fund',
            GAOTENG_MONEY_MARKET_USD: 'GaoTeng WeValue USD Money Market Fund',
            GAOTENG_MONEY_MARKET_HKD: 'GaoTeng WeValue HKD Money Market Fund',
        };
        const baseName = fundNames[fundId] || 'Money Market Fund';
        return currency ? `${baseName} (${currency})` : baseName;
    }

    function getCashEquivalentTickerLabel(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (isFranklinMoneyMarketTicker(normalizedTicker)) return 'Franklin MMF';
        if (normalizedTicker === 'HK0000369196.USD') return 'HK0000369196 USD MMF';
        if (normalizedTicker === 'HK0001039582.USD') return 'HK0001039582 USD MMF';
        if (!isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) return '';
        const parts = normalizedTicker.split('.');
        const fundId = parts[1] || '';
        const currency = parts[2] || '';
        const labels = {
            PING_AN_MONEY_MARKET_USD: 'Ping An MMF',
            PING_AN_MONEY_MARKET_HKD: 'Ping An MMF',
            GAOTENG_MONEY_MARKET_USD: 'GaoTeng MMF',
            GAOTENG_MONEY_MARKET_HKD: 'GaoTeng MMF',
        };
        const label = labels[fundId] || 'MMF';
        return currency ? `${label} ${currency}` : label;
    }

    function formatInvestmentTickerForDisplay(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const cashEquivalentLabel = getCashEquivalentTickerLabel(normalizedTicker);
        if (cashEquivalentLabel) {
            return cashEquivalentLabel;
        }
        if (normalizedTicker.endsWith('.US')) {
            return normalizedTicker.slice(0, -3);
        }
        if (normalizedTicker.endsWith('.HK')) {
            const [symbol, suffix] = normalizedTicker.split('.');
            const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
            return strippedSymbol ? `${strippedSymbol}.${suffix}` : normalizedTicker;
        }
        return normalizedTicker;
    }

    function getInvestmentKnownTickerCompanyNames() {
        const payloadNames = window.ANTIGRAVITY_INVESTMENT_DATA?.known_ticker_company_names;
        return payloadNames && typeof payloadNames === 'object' && !Array.isArray(payloadNames)
            ? payloadNames
            : {};
    }

    function isInvestmentTickerFallbackCompanyName(companyName, ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const displayTicker = formatInvestmentTickerForDisplay(ticker);
        const normalizedName = String(companyName || '').trim().toUpperCase();
        if (!normalizedName) return true;
        return (
            normalizedName === normalizedTicker.toUpperCase()
            || normalizedName === displayTicker.toUpperCase()
        );
    }

    function resolveKnownInvestmentTickerCompanyName(ticker) {
        const knownNames = getInvestmentKnownTickerCompanyNames();
        const candidates = getInvestmentTickerProfileLookupCandidates(ticker);
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (normalizedTicker && !candidates.includes(normalizedTicker)) {
            candidates.unshift(normalizedTicker);
        }
        for (const candidate of candidates) {
            const knownName = String(knownNames[candidate] || '').trim();
            if (knownName && !isInvestmentTickerFallbackCompanyName(knownName, ticker)) {
                return knownName;
            }
        }
        return '';
    }

    function resolveInvestmentTickerProfile(tickerProfiles, ticker) {
        const profiles = tickerProfiles && typeof tickerProfiles === 'object' ? tickerProfiles : {};
        const candidates = getInvestmentTickerProfileLookupCandidates(ticker);
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (normalizedTicker && !candidates.includes(normalizedTicker)) {
            candidates.push(normalizedTicker);
        }
        let fallbackProfile = null;
        for (const candidate of candidates) {
            const profile = profiles[candidate];
            if (!profile || typeof profile !== 'object') continue;
            if (!fallbackProfile) fallbackProfile = profile;
            const companyName = String(profile.company_name || '').trim();
            if (!companyName) continue;
            if (!isInvestmentTickerFallbackCompanyName(companyName, candidate)) {
                return profile;
            }
        }
        const knownCompanyName = resolveKnownInvestmentTickerCompanyName(ticker);
        if (knownCompanyName) {
            return {
                ...(fallbackProfile || {}),
                ticker: normalizedTicker || String(ticker || '').trim().toUpperCase(),
                company_name: knownCompanyName,
            };
        }
        return fallbackProfile || {};
    }

    function resolveInvestmentTickerCompanyName(tickerProfiles, ticker) {
        const cashEquivalentName = getCashEquivalentFundDisplayName(ticker);
        if (cashEquivalentName) {
            return cashEquivalentName;
        }
        const profile = resolveInvestmentTickerProfile(tickerProfiles, ticker);
        const companyName = String(profile.company_name || '').trim();
        if (companyName && !isInvestmentTickerFallbackCompanyName(companyName, ticker)) {
            return companyName;
        }
        return '';
    }

    function renderInvestmentTickerIdentityNameHtml(companyName) {
        const normalizedName = String(companyName || '').trim();
        if (!normalizedName) return '';
        return `<span class="suggestion-name ticker-identity-name" title="${escapeHtml(normalizedName)}">${escapeHtml(normalizedName)}</span>`;
    }

    function normalizeInvestmentBroker(broker) {
        const normalizedBroker = String(broker || '').trim().toLowerCase();
        if (normalizedBroker === 'longbridge') {
            return 'longbridge_hk';
        }
        return normalizedBroker || 'ibkr';
    }

    function getInvestmentBrokerMeta(broker) {
        const normalizedBroker = normalizeInvestmentBroker(broker);
        if (INVESTMENT_BROKER_META[normalizedBroker]) {
            return INVESTMENT_BROKER_META[normalizedBroker];
        }
        const fallbackLabel = normalizedBroker ? normalizedBroker.toUpperCase() : 'Broker';
        return {
            code: normalizedBroker || 'unknown',
            label: fallbackLabel,
            logoUrl: '',
            logoAlt: `${fallbackLabel} logo`,
        };
    }

    const INVESTMENT_BROKER_FILTER_PINYIN_SORT_KEYS = {
        cmbwl: 'cmbwinglungbank',
        hsbc: 'hsbc',
        ibkr: 'ibkr',
        longbridge_hk: 'longbridgehk',
        longbridge_sg: 'longbridgesg',
        futuhk: 'futuhk',
        schwab: 'charlesschwab',
    };
    const investmentBrokerFilterCollator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true });

    function getInvestmentBrokerFilterSortKey(brokerCode) {
        const normalizedBrokerCode = normalizeInvestmentBroker(brokerCode);
        return INVESTMENT_BROKER_FILTER_PINYIN_SORT_KEYS[normalizedBrokerCode]
            || getInvestmentBrokerMeta(normalizedBrokerCode).label.trim().toLowerCase()
            || normalizedBrokerCode;
    }

    function compareInvestmentBrokerFilterCodes(leftCode, rightCode) {
        const bySortKey = investmentBrokerFilterCollator.compare(
            getInvestmentBrokerFilterSortKey(leftCode),
            getInvestmentBrokerFilterSortKey(rightCode),
        );
        if (bySortKey !== 0) return bySortKey;
        return normalizeInvestmentBroker(leftCode).localeCompare(normalizeInvestmentBroker(rightCode));
    }

    function sortInvestmentBrokerFilterCodes(brokerCodes = []) {
        return Array.from(new Set(
            (Array.isArray(brokerCodes) ? brokerCodes : [])
                .map((brokerCode) => normalizeInvestmentBroker(brokerCode))
                .filter(Boolean),
        )).sort(compareInvestmentBrokerFilterCodes);
    }

    function rebuildInvestmentBrokerFilterTransactionIndex(processedTransactions = investmentProcessedTransactionsCache) {
        const source = Array.isArray(processedTransactions) ? processedTransactions : [];
        const allRows = [];
        const byBroker = new Map();

        source.forEach((txn, index) => {
            if (isInvestmentHistoryDisplayHidden(txn)) return;
            const brokerCode = normalizeInvestmentBroker(getTransactionBrokerCode(txn));
            if (!brokerCode) return;
            const row = {
                txn,
                index,
                brokerCode,
                dateLabel: normalizeLedgerDate(txn?.date),
            };
            allRows.push(row);
            if (!byBroker.has(brokerCode)) {
                byBroker.set(brokerCode, []);
            }
            byBroker.get(brokerCode).push(row);
        });

        const ledgerBrokerCodes = sortInvestmentBrokerFilterCodes(Array.from(byBroker.keys()));
        const payloadBrokerCodes = Array.isArray(window.ANTIGRAVITY_INVESTMENT_DATA?.brokers)
            ? window.ANTIGRAVITY_INVESTMENT_DATA.brokers.map((broker) => normalizeInvestmentBroker(broker)).filter(Boolean)
            : [];
        // Prefer brokers proven by rendered ledger rows; use the server broker list only before
        // processed transactions exist so the filter never advertises an empty broker in large ledgers.
        const availableCodes = ledgerBrokerCodes.length
            ? ledgerBrokerCodes
            : sortInvestmentBrokerFilterCodes(payloadBrokerCodes);

        investmentBrokerFilterTransactionIndex = {
            source,
            allRows,
            byBroker,
            availableCodes,
            availableSet: new Set(availableCodes),
        };
    }

    function ensureInvestmentBrokerFilterTransactionIndex(processedTransactions = investmentProcessedTransactionsCache) {
        const source = Array.isArray(processedTransactions) ? processedTransactions : [];
        if (investmentBrokerFilterTransactionIndex.source !== source) {
            rebuildInvestmentBrokerFilterTransactionIndex(source);
        }
        return investmentBrokerFilterTransactionIndex;
    }

    function computeAvailableInvestmentBrokerCodes() {
        return ensureInvestmentBrokerFilterTransactionIndex().availableCodes;
    }

    function refreshInvestmentAvailableBrokerCodes() {
        rebuildInvestmentBrokerFilterTransactionIndex();
        const codes = computeAvailableInvestmentBrokerCodes();
        investmentAvailableBrokerCodesCache = codes;
        investmentAvailableBrokerCodesSet = new Set(codes);
    }

    function getAvailableInvestmentBrokerCodes() {
        if (investmentAvailableBrokerCodesCache.length === 0 && investmentProcessedTransactionsCache.length > 0) {
            refreshInvestmentAvailableBrokerCodes();
        }
        return investmentAvailableBrokerCodesCache;
    }

    function getInvestmentBrokerFilterSelectedCodes() {
        return new Set(
            Array.from(investmentBrokerFilterSelectedCodes)
                .map((brokerCode) => normalizeInvestmentBroker(brokerCode))
                .filter((brokerCode) => investmentAvailableBrokerCodesSet.has(brokerCode)),
        );
    }

    function isInvestmentBrokerFilterAllSelected(selectedCodes = getInvestmentBrokerFilterSelectedCodes(), availableCodes = getAvailableInvestmentBrokerCodes()) {
        if (!availableCodes.length) return true;
        if (!selectedCodes.size) return false;
        return availableCodes.every((brokerCode) => selectedCodes.has(brokerCode));
    }

    function matchesInvestmentBrokerFilter(txn) {
        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        if (!availableBrokerCodes.length) return true;
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        if (isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes)) {
            return true;
        }
        if (!selectedBrokerCodes.size) {
            return false;
        }
        return selectedBrokerCodes.has(normalizeInvestmentBroker(getTransactionBrokerCode(txn)));
    }

    function getInvestmentBrokerFilteredTransactionRows(processedTransactions = []) {
        const index = ensureInvestmentBrokerFilterTransactionIndex(processedTransactions);
        const availableBrokerCodes = index.availableCodes;
        if (!availableBrokerCodes.length) return [];

        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        if (isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes)) {
            return index.allRows;
        }
        if (!selectedBrokerCodes.size) {
            return [];
        }

        const selectedBrokerList = availableBrokerCodes.filter((brokerCode) => selectedBrokerCodes.has(brokerCode));
        if (selectedBrokerList.length === 1) {
            return index.byBroker.get(selectedBrokerList[0]) || [];
        }
        if (selectedBrokerList.length > Math.max(1, availableBrokerCodes.length / 2)) {
            return index.allRows.filter((row) => selectedBrokerCodes.has(row.brokerCode));
        }
        return selectedBrokerList
            .flatMap((brokerCode) => index.byBroker.get(brokerCode) || [])
            .sort((left, right) => left.index - right.index);
    }

    function initializeInvestmentBrokerFilterSelection() {
        investmentBrokerFilterSelectedCodes = new Set(getAvailableInvestmentBrokerCodes());
    }

    function renderInvestmentBrokerFilterHeaderInnerMarkup(filterId = 'investment_history_broker_filter') {
        return `
            <div class="field investment-broker-filter-field backtest-shared-select-field"
                 data-investment-broker-filter
                 data-filter-id="${escapeHtml(filterId)}">
                <div class="trade-strategy-row backtest-shared-select-row investment-broker-filter-row live-trading-broker-row">
                    <div class="trade-strategy-combobox backtest-shared-select-combobox">
                        <button type="button"
                                class="trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger live-trading-broker-trigger investment-broker-filter-trigger"
                                data-investment-broker-filter-trigger
                                aria-haspopup="listbox"
                                aria-expanded="false"
                                aria-controls="${escapeHtml(filterId)}_dropdown"
                                title="All brokers"
                                aria-label="Broker filter: All brokers">
                            <span class="ticker-leading-slot live-trading-broker-trigger-slot investment-broker-filter-trigger-slot" aria-hidden="true">
                                <span class="ticker-logo-placeholder"
                                      data-investment-broker-filter-placeholder></span>
                                <img class="ticker-input-logo live-trading-broker-trigger-logo investment-broker-filter-trigger-logo"
                                     data-investment-broker-filter-logo
                                     alt=""
                                     hidden>
                            </span>
                            <span class="trade-strategy-trigger-label live-trading-broker-trigger-label investment-broker-filter-trigger-label"
                                  data-investment-broker-filter-label
                                  hidden
                                  aria-hidden="true"></span>
                        </button>
                    </div>
                    <div id="${escapeHtml(filterId)}_dropdown"
                         class="trade-strategy-dropdown backtest-shared-select-dropdown live-trading-broker-dropdown investment-broker-filter-dropdown"
                         data-investment-broker-filter-dropdown
                         role="listbox"
                         aria-label="Broker"
                         hidden></div>
                </div>
            </div>
        `;
    }

    function getInvestmentBrokerFilterScopeId(th) {
        if (!(th instanceof HTMLElement)) return 'investment_history_broker_filter';
        return th.closest('.investment-stock-details-table-shell')
            ? 'investment_stock_details_broker_filter'
            : 'investment_history_broker_filter';
    }

    function syncInvestmentBrokerFilterTrigger(field) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const triggerLogo = field.querySelector('[data-investment-broker-filter-logo]');
        const triggerPlaceholder = field.querySelector('[data-investment-broker-filter-placeholder]');
        if (!(trigger instanceof HTMLButtonElement)) return;

        if (triggerLogo instanceof HTMLImageElement) {
            triggerLogo.hidden = true;
            triggerLogo.alt = '';
            triggerLogo.removeAttribute('src');
        }
        if (triggerPlaceholder instanceof HTMLElement) {
            triggerPlaceholder.hidden = true;
        }

        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        const selectedBrokerList = availableBrokerCodes.filter((brokerCode) => selectedBrokerCodes.has(brokerCode));
        const allSelected = isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);

        let triggerTitle = 'All brokers';
        if (!allSelected) {
            if (!selectedBrokerList.length) {
                triggerTitle = 'No brokers selected';
            } else if (selectedBrokerList.length === 1) {
                triggerTitle = getInvestmentBrokerMeta(selectedBrokerList[0]).label;
            } else {
                triggerTitle = `${selectedBrokerList.length} brokers selected`;
            }
        }

        trigger.title = triggerTitle;
        trigger.setAttribute('aria-label', `Broker filter: ${triggerTitle}`);
    }

    function estimateInvestmentBrokerFilterDropdownWidth(availableBrokerCodes = getAvailableInvestmentBrokerCodes()) {
        const labels = ['All', ...availableBrokerCodes.map((brokerCode) => getInvestmentBrokerMeta(brokerCode).label)];
        const longestLabelLength = labels.reduce((maxLength, label) => (
            Math.max(maxLength, Array.from(String(label || '')).length)
        ), 0);
        return Math.max(180, Math.min(360, 74 + (longestLabelLength * 8)));
    }

    function positionInvestmentBrokerFilterDropdown(field) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const dropdown = field.querySelector('[data-investment-broker-filter-dropdown]');
        if (!(trigger instanceof HTMLElement)
            || !(dropdown instanceof HTMLElement)
            || dropdown.hidden) {
            return;
        }
        const triggerRect = trigger.getBoundingClientRect();
        const viewportPadding = 16;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 600;
        const spaceBelow = viewportHeight - triggerRect.bottom - viewportPadding;
        // Allow scrolling within a comfortable max; ensures even on short viewports or near-bottom triggers
        // the list remains fully operable via internal scroll (matching the pattern used for import broker dropdown).
        const maxH = Math.max(120, Math.min(380, spaceBelow));

        const contentWidth = Math.max(
            Math.ceil(triggerRect.width),
            estimateInvestmentBrokerFilterDropdownWidth(),
        );
        const viewportMaxWidth = Math.max(140, window.innerWidth - triggerRect.left - viewportPadding);
        const finalWidth = Math.min(contentWidth, viewportMaxWidth);

        // Use fixed positioning so the dropdown escapes sticky table headers and any
        // scrollable table shells (e.g. .scrollable-data-table-scroll with overflow:auto).
        // This guarantees the full broker list is never clipped/truncated and is always scrollable.
        dropdown.style.position = 'fixed';
        dropdown.style.left = `${Math.round(triggerRect.left)}px`;
        dropdown.style.top = `${Math.round(triggerRect.bottom + 4)}px`;
        dropdown.style.right = 'auto';
        dropdown.style.bottom = 'auto';
        dropdown.style.width = `${finalWidth}px`;
        dropdown.style.maxWidth = `${viewportMaxWidth}px`;
        dropdown.style.maxHeight = `${Math.round(maxH)}px`;
        dropdown.style.zIndex = '10002';
        dropdown.style.overflowY = 'auto';
        dropdown.style.overscrollBehavior = 'contain';
    }

    function scheduleInvestmentBrokerFilterDropdownPosition() {
        if (investmentBrokerFilterPositionRaf) return;
        investmentBrokerFilterPositionRaf = window.requestAnimationFrame(() => {
            investmentBrokerFilterPositionRaf = 0;
            document.querySelectorAll('[data-investment-broker-filter].is-open').forEach((field) => {
                positionInvestmentBrokerFilterDropdown(field);
            });
        });
    }

    function setInvestmentBrokerFilterDropdownOpen(field, isOpen) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const dropdown = field.querySelector('[data-investment-broker-filter-dropdown]');
        if (!(trigger instanceof HTMLButtonElement) || !(dropdown instanceof HTMLElement)) return;
        dropdown.hidden = !isOpen;
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        field.classList.toggle('is-open', isOpen);
        if (isOpen) {
            positionInvestmentBrokerFilterDropdown(field);
        } else {
            dropdown.style.position = '';
            dropdown.style.left = '';
            dropdown.style.top = '';
            dropdown.style.right = '';
            dropdown.style.bottom = '';
            dropdown.style.width = '';
            dropdown.style.maxWidth = '';
            dropdown.style.maxHeight = '';
            dropdown.style.zIndex = '';
            dropdown.style.overflowY = '';
            dropdown.style.overscrollBehavior = '';
        }
    }

    function closeInvestmentBrokerFilterDropdowns(exceptField = null) {
        document.querySelectorAll('[data-investment-broker-filter]').forEach((field) => {
            if (!(field instanceof HTMLElement)) return;
            if (exceptField && field === exceptField) return;
            setInvestmentBrokerFilterDropdownOpen(field, false);
        });
    }

    function createInvestmentBrokerFilterOptionButton({
        value,
        label,
        iconUrl = '',
        iconAlt = '',
        logoOnly = false,
        isSelected = false,
        onClick,
    }) {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'trade-strategy-dropdown-option';
        if (logoOnly) {
            optionButton.classList.add('is-broker-logo-only');
        }
        optionButton.dataset.value = value;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        optionButton.setAttribute('aria-label', label);
        if (isSelected) {
            optionButton.classList.add('is-selected', 'is-active');
        }

        const checkElement = document.createElement('span');
        checkElement.className = 'trade-strategy-dropdown-check';
        checkElement.setAttribute('aria-hidden', 'true');
        optionButton.appendChild(checkElement);

        if (iconUrl) {
            optionButton.classList.add('is-with-icon');
            const mediaSlot = document.createElement('span');
            mediaSlot.className = 'trade-strategy-dropdown-media-slot';
            mediaSlot.setAttribute('aria-hidden', 'true');

            const mediaPlaceholder = document.createElement('span');
            mediaPlaceholder.className = 'trade-strategy-dropdown-media-placeholder';

            const mediaElement = document.createElement('img');
            mediaElement.className = 'trade-strategy-dropdown-media';
            mediaElement.alt = iconAlt || `${label} logo`;
            mediaElement.loading = 'eager';
            mediaElement.decoding = 'async';
            mediaElement.hidden = true;
            mediaElement.addEventListener('load', () => {
                mediaElement.hidden = false;
                mediaPlaceholder.hidden = true;
            });
            mediaElement.addEventListener('error', () => {
                mediaElement.hidden = true;
                mediaElement.removeAttribute('src');
                mediaPlaceholder.hidden = false;
            });
            mediaElement.src = iconUrl;
            if (mediaElement.complete && mediaElement.naturalWidth > 0 && mediaElement.naturalHeight > 0) {
                mediaElement.hidden = false;
                mediaPlaceholder.hidden = true;
            }

            mediaSlot.appendChild(mediaPlaceholder);
            mediaSlot.appendChild(mediaElement);
            optionButton.appendChild(mediaSlot);
        }

        if (!logoOnly || !iconUrl) {
            const copyElement = document.createElement('span');
            copyElement.className = 'trade-strategy-dropdown-copy';
            const titleElement = document.createElement('span');
            titleElement.className = 'trade-strategy-dropdown-title';
            titleElement.textContent = label;
            copyElement.appendChild(titleElement);
            optionButton.appendChild(copyElement);
        }

        optionButton.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick?.();
        });
        return optionButton;
    }

    function renderInvestmentBrokerFilterDropdown(field) {
        if (!(field instanceof HTMLElement)) return;
        const dropdown = field.querySelector('[data-investment-broker-filter-dropdown]');
        if (!(dropdown instanceof HTMLElement)) return;

        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        const allSelected = isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        dropdown.innerHTML = '';
        const fragment = document.createDocumentFragment();
        fragment.appendChild(createInvestmentBrokerFilterOptionButton({
            value: '__all__',
            label: 'All',
            isSelected: allSelected,
            onClick: () => {
                investmentBrokerFilterSelectedCodes = new Set(availableBrokerCodes);
                applyInvestmentBrokerFilterChange();
            },
        }));

        availableBrokerCodes.forEach((brokerCode) => {
            const brokerMeta = getInvestmentBrokerMeta(brokerCode);
            // Always show the broker name text (e.g. "Longbridge (SG)", "CMB Wing Lung Bank")
            // alongside the logo so every option is clearly labeled regardless of logo uniqueness.
            fragment.appendChild(createInvestmentBrokerFilterOptionButton({
                value: brokerCode,
                label: brokerMeta.label,
                iconUrl: brokerMeta.logoUrl,
                iconAlt: brokerMeta.logoAlt,
                logoOnly: false,
                isSelected: allSelected || selectedBrokerCodes.has(brokerCode),
                onClick: () => {
                    const nextSelection = new Set(getInvestmentBrokerFilterSelectedCodes());
                    if (allSelected) {
                        nextSelection.delete(brokerCode);
                    } else if (nextSelection.has(brokerCode)) {
                        nextSelection.delete(brokerCode);
                    } else {
                        nextSelection.add(brokerCode);
                    }
                    investmentBrokerFilterSelectedCodes = nextSelection;
                    applyInvestmentBrokerFilterChange();
                },
            }));
        });
        dropdown.appendChild(fragment);
    }

    function syncInvestmentBrokerFilterField(field) {
        if (!(field instanceof HTMLElement)) return;
        syncInvestmentBrokerFilterTrigger(field);
        if (!field.classList.contains('is-open')) return;
        renderInvestmentBrokerFilterDropdown(field);
        positionInvestmentBrokerFilterDropdown(field);
    }

    function syncAllInvestmentBrokerFilterUi() {
        document.querySelectorAll('[data-investment-broker-filter]').forEach((field) => {
            syncInvestmentBrokerFilterField(field);
        });
    }

    function bindInvestmentBrokerFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentBrokerFilterBound === '1') return;
        field.dataset.investmentBrokerFilterBound = '1';
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        if (!(trigger instanceof HTMLButtonElement)) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const shouldOpen = field.querySelector('[data-investment-broker-filter-dropdown]')?.hidden !== false;
            closeInvestmentBrokerFilterDropdowns(field);
            if (shouldOpen) {
                renderInvestmentBrokerFilterDropdown(field);
            }
            setInvestmentBrokerFilterDropdownOpen(field, shouldOpen);
        });

        syncInvestmentBrokerFilterField(field);
    }

    function ensureInvestmentBrokerFilterDocumentListeners() {
        if (investmentBrokerFilterDocumentListenersBound) return;
        investmentBrokerFilterDocumentListenersBound = true;
        document.addEventListener('click', () => {
            closeInvestmentBrokerFilterDropdowns();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeInvestmentBrokerFilterDropdowns();
            }
        });
        window.addEventListener('resize', () => {
            scheduleInvestmentBrokerFilterDropdownPosition();
        });
        // Reposition on scroll (capture) so the fixed dropdown stays aligned with its trigger
        // when the page, table body, or sticky header context scrolls.
        document.addEventListener('scroll', () => {
            scheduleInvestmentBrokerFilterDropdownPosition();
        }, true);
    }

    function mountInvestmentBrokerFilterHeaders(root = document) {
        ensureInvestmentBrokerFilterDocumentListeners();
        const scope = root instanceof Document ? root : root;
        const headers = scope.querySelectorAll ? scope.querySelectorAll('th[aria-label="Broker"]') : [];
        headers.forEach((th) => {
            if (!(th instanceof HTMLElement)) return;
            th.classList.add('investment-history-broker-filter-header');
            const filterId = getInvestmentBrokerFilterScopeId(th);
            if (!th.querySelector('[data-investment-broker-filter]')) {
                th.innerHTML = renderInvestmentBrokerFilterHeaderInnerMarkup(filterId);
            }
            bindInvestmentBrokerFilterField(th.querySelector('[data-investment-broker-filter]'));
        });
        syncAllInvestmentBrokerFilterUi();
    }

    function applyInvestmentBrokerFilterChange() {
        syncAllInvestmentBrokerFilterUi();
        if (investmentBrokerFilterApplyRaf) {
            window.cancelAnimationFrame(investmentBrokerFilterApplyRaf);
        }
        investmentBrokerFilterApplyRaf = window.requestAnimationFrame(() => {
            investmentBrokerFilterApplyRaf = 0;
            renderInvestmentHistoryTableRows(
                investmentProcessedTransactionsCache,
                investmentChartPointsCache,
                { resetPage: true, scrollToTop: true },
            );
            if (activeInvestmentView === 'stock_details') {
                refreshInvestmentStockDetailsTableRows();
            }
        });
    }

    function renderInvestmentStockDetailsTableRowsMarkup(detailRows = []) {
        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        const allSelected = isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        const filteredDetailRows = allSelected
            ? detailRows
            : detailRows.filter((txn) => selectedBrokerCodes.has(normalizeInvestmentBroker(getTransactionBrokerCode(txn))));
        if (!filteredDetailRows.length) {
            return `
                <tr>
                    <td colspan="10" class="investment-history-empty-cell">No ticker-linked transactions match the selected brokers.</td>
                </tr>
            `;
        }
        return filteredDetailRows.map((txn) => `
            <tr data-investment-stock-detail-ledger="${txn.ledger_no}">
                ${renderInvestmentBrokerCell(txn)}
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${formatTransactionDescription(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmountWithCurrency(txn.display_amount ?? getTransactionEconomicAmount(txn), formatTransactionCurrency(txn), { showUsdSymbol: false })}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${txn.rowMarketValue === null ? '-' : formatAmountWithCurrency(txn.rowMarketValue, formatTransactionCurrency(txn), { showUsdSymbol: false })}</td>
                <td class="investment-history-cell investment-history-cell-right ${txn.rowRealizedPnl === null ? '' : (txn.rowRealizedPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative')}">${txn.rowRealizedPnl === null ? '-' : formatAmountWithCurrency(txn.rowRealizedPnl, formatTransactionCurrency(txn), { showUsdSymbol: false })}</td>
            </tr>
        `).join('');
    }

    function refreshInvestmentStockDetailsTableRows() {
        if (!(investmentStockDetailsTableHost instanceof HTMLElement)) return;
        const activeTicker = ensureSelectedInvestmentStockTicker();
        if (!activeTicker) return;
        const detailRows = buildInvestmentStockDetailRows(investmentProcessedTransactionsCache, activeTicker);
        const tbody = investmentStockDetailsTableHost.querySelector('.investment-stock-details-table-scroll tbody');
        if (!(tbody instanceof HTMLElement)) return;
        tbody.innerHTML = renderInvestmentStockDetailsTableRowsMarkup(detailRows);
        mountInvestmentBrokerFilterHeaders(investmentStockDetailsTableHost);
        bindStockDetailsHistoryInteractions(investmentStockDetailsTableHost);
        attachStockDetailsTableAlignmentSync(investmentStockDetailsTableHost);
    }

    function getSelectedInvestmentImportBroker() {
        return normalizeInvestmentBroker(investmentImportBrokerSelect?.value || 'ibkr');
    }

    function getSelectedIbkrImportMode() {
        const checkedMode = document.querySelector('input[name="ibkr_import_mode"]:checked');
        const value = checkedMode instanceof HTMLInputElement ? checkedMode.value : 'csv';
        if (value === 'flex') return 'flex';
        if (value === 'gainskeeper') return 'gainskeeper';
        return 'csv';
    }

    function getSelectedHsbcImportMode() {
        const checkedMode = document.querySelector('input[name="hsbc_import_mode"]:checked');
        const value = checkedMode instanceof HTMLInputElement ? checkedMode.value : 'paste';
        return value === 'statement_pdf' ? 'statement_pdf' : 'paste';
    }

    function syncIbkrImportModePanels() {
        const selectedMode = getSelectedIbkrImportMode();
        if (investmentImportIbkrMode instanceof HTMLElement) {
            investmentImportIbkrMode.dataset.active = selectedMode;
            investmentImportIbkrMode.style.setProperty('--segmented-option-count', '3');
            const activeIndex = selectedMode === 'gainskeeper'
                ? '1'
                : (selectedMode === 'flex' ? '2' : '0');
            investmentImportIbkrMode.style.setProperty('--segmented-active-index', activeIndex);
            scheduleIbkrImportSegmentedPillUpdate();
        }
        document.querySelectorAll('[data-ibkr-import-mode-panel]').forEach((panel) => {
            if (!(panel instanceof HTMLElement)) return;
            panel.hidden = panel.dataset.ibkrImportModePanel !== selectedMode;
        });
    }

    function syncHsbcImportModePanels() {
        const selectedMode = getSelectedHsbcImportMode();
        if (investmentImportHsbcMode instanceof HTMLElement) {
            investmentImportHsbcMode.dataset.active = selectedMode;
            investmentImportHsbcMode.style.setProperty('--segmented-option-count', '2');
            investmentImportHsbcMode.style.setProperty(
                '--segmented-active-index',
                selectedMode === 'statement_pdf' ? '1' : '0',
            );
            scheduleHsbcImportSegmentedPillUpdate();
        }
        document.querySelectorAll('[data-hsbc-import-mode-panel]').forEach((panel) => {
            if (!(panel instanceof HTMLElement)) return;
            panel.hidden = panel.dataset.hsbcImportModePanel !== selectedMode;
        });
    }

    function toDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function normalizeClipboardText(rawText) {
        return String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

    function countClipboardLines(text) {
        const normalized = normalizeClipboardText(text);
        return normalized ? normalized.split('\n').length : 0;
    }

    function splitHsbcPastedTextChunks(rawText) {
        const normalized = normalizeClipboardText(rawText);
        if (!normalized) {
            return [];
        }
        const parts = normalized.split(new RegExp(`\\n+\\s*${HSBC_PASTE_CHUNK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'g'));
        const chunks = [];
        const seen = new Set();
        parts.forEach((part) => {
            const chunk = normalizeClipboardText(part);
            if (!chunk) {
                return;
            }
            const chunkKey = chunk.replace(/\s+/g, ' ').trim();
            if (!chunkKey || seen.has(chunkKey)) {
                return;
            }
            seen.add(chunkKey);
            chunks.push(chunk);
        });
        return chunks;
    }

    function mergeHsbcPastedText(existingRawText, incomingRawText) {
        const incomingText = normalizeClipboardText(incomingRawText);
        if (!incomingText) {
            return { mergedText: '', addedChunkCount: 0, duplicate: false };
        }
        const chunks = splitHsbcPastedTextChunks(existingRawText);
        const existingKeys = new Set(chunks.map((chunk) => chunk.replace(/\s+/g, ' ').trim()));
        const incomingKey = incomingText.replace(/\s+/g, ' ').trim();
        if (existingKeys.has(incomingKey)) {
            return {
                mergedText: chunks.join(`\n\n${HSBC_PASTE_CHUNK_MARKER}\n\n`),
                addedChunkCount: 0,
                duplicate: true,
            };
        }
        const mergedChunks = [...chunks, incomingText];
        return {
            mergedText: mergedChunks.join(`\n\n${HSBC_PASTE_CHUNK_MARKER}\n\n`),
            addedChunkCount: 1,
            duplicate: false,
        };
    }

    function normalizeHsbcAccountNumber(value) {
        return String(value || '')
            .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
            .replace(/\s+/g, '')
            .trim();
    }

    function extractHsbcAccountNumber(text) {
        const candidates = Array.from(String(text || '').matchAll(HSBC_ACCOUNT_NUMBER_PATTERN))
            .map((match) => normalizeHsbcAccountNumber(match[0]))
            .filter(Boolean);
        if (!candidates.length) {
            return '';
        }
        const expectedAccount = normalizeHsbcAccountNumber(HSBC_EXPECTED_ACCOUNT_NUMBER);
        return candidates.find((candidate) => candidate === expectedAccount) || candidates[0];
    }

    function hsbcTextBelongsToExpectedAccount(rawText) {
        return extractHsbcAccountNumber(rawText) === normalizeHsbcAccountNumber(HSBC_EXPECTED_ACCOUNT_NUMBER);
    }

    function summarizeHsbcPastedText(kind, rawText, isValid) {
        const normalized = normalizeClipboardText(rawText);
        if (!normalized) {
            return '';
        }
        const chunkCount = splitHsbcPastedTextChunks(normalized).length || 1;
        const lineCount = countClipboardLines(normalized);
        const charCount = normalized.length.toLocaleString('en-US');
        const label = kind === 'cash'
            ? 'USD Savings'
            : (kind === 'portfolio' ? 'Portfolio' : 'Order Status');
        const chunkLabel = chunkCount === 1 ? '1 clip' : `${chunkCount.toLocaleString('en-US')} clips`;
        return `${label} clipboard pasted · ${chunkLabel} · ${lineCount} lines · ${charCount} chars${isValid ? ' · Ready' : ' · Check format'}`;
    }

    function isLikelyHsbcCashAccountText(rawText) {
        const text = normalizeClipboardText(rawText);
        return Boolean(
            text
            && hsbcTextBelongsToExpectedAccount(text)
            && /USD Savings/i.test(text)
            && /Available balance/i.test(text)
            && /Post date/i.test(text)
            && text.length >= 400
        );
    }

    function isLikelyHsbcPortfolioText(rawText) {
        const text = normalizeClipboardText(rawText);
        return Boolean(
            text
            && hsbcTextBelongsToExpectedAccount(text)
            && /Portfolio/i.test(text)
            && /Market value/i.test(text)
            && /Average purchase price/i.test(text)
            && text.length >= 300
        );
    }

    function isLikelyHsbcOrderStatusText(rawText) {
        const text = normalizeClipboardText(rawText);
        return Boolean(
            text
            && hsbcTextBelongsToExpectedAccount(text)
            && /Order Status/i.test(text)
            && /P-\d+/i.test(text)
            && text.length >= 400
        );
    }

    function getHsbcPasteButton(kind) {
        if (kind === 'cash') return hsbcCashAccountPasteButton;
        if (kind === 'portfolio') return hsbcPortfolioTextPasteButton;
        if (kind === 'order') return hsbcOrderStatusPasteButton;
        return null;
    }

    function flashHsbcPasteButton(kind) {
        const button = getHsbcPasteButton(kind);
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        const priorTimer = hsbcPasteButtonFlashTimers.get(button);
        if (priorTimer) {
            window.clearTimeout(priorTimer);
        }
        button.classList.add('is-pasted');
        const timerId = window.setTimeout(() => {
            button.classList.remove('is-pasted');
            hsbcPasteButtonFlashTimers.delete(button);
        }, 1200);
        hsbcPasteButtonFlashTimers.set(button, timerId);
    }

    function updateHsbcPasteFieldDisplay(displayInput, summaryText, rawText) {
        if (!(displayInput instanceof HTMLInputElement)) {
            return;
        }
        displayInput.value = summaryText;
        displayInput.title = normalizeClipboardText(rawText);
    }

    function syncHsbcPasteDisplaySummaries() {
        const cashText = String(hsbcCashAccountTextInput?.value || '');
        const portfolioText = String(hsbcPortfolioTextInput?.value || '');
        const orderText = String(hsbcOrderStatusTextInput?.value || '');
        updateHsbcPasteFieldDisplay(
            hsbcCashAccountDisplay,
            summarizeHsbcPastedText('cash', cashText, isLikelyHsbcCashAccountText(cashText)),
            cashText,
        );
        updateHsbcPasteFieldDisplay(
            hsbcPortfolioTextDisplay,
            summarizeHsbcPastedText('portfolio', portfolioText, isLikelyHsbcPortfolioText(portfolioText)),
            portfolioText,
        );
        updateHsbcPasteFieldDisplay(
            hsbcOrderStatusDisplay,
            summarizeHsbcPastedText('order', orderText, isLikelyHsbcOrderStatusText(orderText)),
            orderText,
        );
    }

    async function pasteHsbcClipboardIntoField(kind) {
        if (!navigator.clipboard?.readText) {
            setImportFeedback('Clipboard paste is unavailable in this browser context.', 'error');
            return;
        }
        try {
            const rawText = await navigator.clipboard.readText();
            const normalizedText = normalizeClipboardText(rawText);
            if (!normalizedText) {
                setImportFeedback('Clipboard is empty.', 'error');
                return;
            }
            let mergeResult = null;
            if (kind === 'cash' && hsbcCashAccountTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(hsbcCashAccountTextInput.value, normalizedText);
                hsbcCashAccountTextInput.value = mergeResult.mergedText;
            } else if (kind === 'portfolio' && hsbcPortfolioTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(hsbcPortfolioTextInput.value, normalizedText);
                hsbcPortfolioTextInput.value = mergeResult.mergedText;
            } else if (kind === 'order' && hsbcOrderStatusTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(hsbcOrderStatusTextInput.value, normalizedText);
                hsbcOrderStatusTextInput.value = mergeResult.mergedText;
            }
            if (mergeResult?.duplicate) {
                setImportFeedback('That HSBC clipboard capture is already present. Existing pasted content was kept.', 'warning');
            } else if (mergeResult?.addedChunkCount) {
                setImportFeedback('Added a supplementary HSBC clipboard capture to this field.', 'success');
            } else {
                clearImportFeedback();
            }
            syncHsbcPasteDisplaySummaries();
            syncImportValidationState();
            flashHsbcPasteButton(kind);
        } catch (_error) {
            setImportFeedback('Clipboard access was blocked. Allow clipboard permissions, then try again.', 'error');
        }
    }

    function seedLongbridgeImportDateRange() {
        if (!(longbridgeStartDateInput instanceof HTMLInputElement) || !(longbridgeEndDateInput instanceof HTMLInputElement)) {
            return;
        }
        const today = new Date();
        const defaultEnd = toDateInputValue(today);
        const defaultStartDate = new Date(today);
        defaultStartDate.setFullYear(defaultStartDate.getFullYear() - 1);
        const defaultStart = toDateInputValue(defaultStartDate);
        let didChange = false;
        if (!longbridgeEndDateInput.value) {
            longbridgeEndDateInput.value = defaultEnd;
            didChange = true;
        }
        if (!longbridgeStartDateInput.value) {
            longbridgeStartDateInput.value = defaultStart;
            didChange = true;
        }
        if (didChange) {
            longbridgeStartDateInput.dispatchEvent(new Event('change', {bubbles: true}));
            longbridgeEndDateInput.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }

    function syncInvestmentImportMode() {
        const selectedBroker = getSelectedInvestmentImportBroker();
        const isIbkr = selectedBroker === 'ibkr';
        const ibkrImportMode = getSelectedIbkrImportMode();
        const hsbcImportMode = getSelectedHsbcImportMode();
        const isIbkrFlex = isIbkr && ibkrImportMode === 'flex';
        const isIbkrGainskeeper = isIbkr && ibkrImportMode === 'gainskeeper';
        const isLongbridgeHk = selectedBroker === 'longbridge_hk';
        const isLongbridgeSg = selectedBroker === 'longbridge_sg';
        const isFutuhk = selectedBroker === 'futuhk';
        const isHsbc = selectedBroker === 'hsbc';
        const isHsbcPaste = isHsbc && hsbcImportMode === 'paste';
        const isHsbcStatementPdf = isHsbc && hsbcImportMode === 'statement_pdf';
        const isSchwab = selectedBroker === 'schwab';
        const isTigertrade = selectedBroker === 'tigertrade';
        const isUsmartHk = selectedBroker === 'usmart_hk';
        const usesSyncAction = isIbkrFlex || isLongbridgeHk || (isHsbc && hsbcImportMode === 'paste');

        if (investmentImportIbkrFields instanceof HTMLElement) {
            investmentImportIbkrFields.hidden = !isIbkr;
            syncIbkrImportModePanels();
        }
        if (investmentImportLongbridgeHkFields instanceof HTMLElement) {
            investmentImportLongbridgeHkFields.hidden = !isLongbridgeHk;
        }
        if (investmentImportLongbridgeSgFields instanceof HTMLElement) {
            investmentImportLongbridgeSgFields.hidden = !isLongbridgeSg;
        }
        if (investmentImportFutuhkFields instanceof HTMLElement) {
            investmentImportFutuhkFields.hidden = !isFutuhk;
        }
        if (investmentImportHsbcFields instanceof HTMLElement) {
            investmentImportHsbcFields.hidden = !isHsbc;
            syncHsbcImportModePanels();
        }
        if (investmentImportSchwabFields instanceof HTMLElement) {
            investmentImportSchwabFields.hidden = !isSchwab;
        }
        if (investmentImportTigertradeFields instanceof HTMLElement) {
            investmentImportTigertradeFields.hidden = !isTigertrade;
        }
        if (investmentImportUsmartHkFields instanceof HTMLElement) {
            investmentImportUsmartHkFields.hidden = !isUsmartHk;
        }
        if (transactionsCsvInput instanceof HTMLInputElement) {
            transactionsCsvInput.required = isIbkr && ibkrImportMode === 'csv';
        }
        if (positionsCsvInput instanceof HTMLInputElement) {
            positionsCsvInput.required = isIbkr && ibkrImportMode === 'csv';
        }
        if (gainskeeperFilesInput instanceof HTMLInputElement) {
            gainskeeperFilesInput.required = isIbkrGainskeeper;
        }
        if (longbridgeSgFundDetailsInput instanceof HTMLInputElement) {
            longbridgeSgFundDetailsInput.required = isLongbridgeSg;
        }
        if (longbridgeSgHistoryOrdersInput instanceof HTMLInputElement) {
            longbridgeSgHistoryOrdersInput.required = isLongbridgeSg;
        }
        if (longbridgeHkFundDetailsInput instanceof HTMLInputElement) {
            longbridgeHkFundDetailsInput.required = isLongbridgeHk;
        }
        if (longbridgeHkHistoryOrdersInput instanceof HTMLInputElement) {
            longbridgeHkHistoryOrdersInput.required = isLongbridgeHk;
        }
        if (futuhkStatementPdfsInput instanceof HTMLInputElement) {
            futuhkStatementPdfsInput.required = isFutuhk;
        }
        if (schwabTransactionsCsvInput instanceof HTMLInputElement) {
            schwabTransactionsCsvInput.required = isSchwab;
        }
        if (tigertradeStatementPdfsInput instanceof HTMLInputElement) {
            tigertradeStatementPdfsInput.required = isTigertrade;
        }
        if (usmartHkStatementPdfsInput instanceof HTMLInputElement) {
            usmartHkStatementPdfsInput.required = isUsmartHk;
        }
        if (hsbcStatementPdfsInput instanceof HTMLInputElement) {
            hsbcStatementPdfsInput.required = isHsbc && hsbcImportMode === 'statement_pdf';
        }
        if (investmentImportNote instanceof HTMLElement) {
            investmentImportNote.innerHTML = isHsbc
                ? (hsbcImportMode === 'statement_pdf'
                    ? 'Upload one or more HSBC statement PDFs. The import records USD Foreign Currency Savings rows and keeps existing records.'
                    : 'Paste the HSBC USD Savings, Portfolio, and Order Status pages. Supplementary captures are allowed; duplicate chunks are ignored.')
                : (isLongbridgeHk
                    ? 'Imports Longbridge (HK) Fund Details + History Orders files (supports coupons/rewards) into <code>settings_store/investment.parquet</code> without clearing existing records.'
                    : (isLongbridgeSg
                        ? 'Imports Longbridge (SG) Fund Details text and History Orders spreadsheets into <code>settings_store/investment.parquet</code> without clearing existing records.'
                        : (isFutuhk
                        ? 'Imports Futu (HK) monthly statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                        : (isIbkrFlex
                            ? 'Fetches IBKR Activity Flex via Flex Web Service v3 (reporting-only) and merges into the local ledger. Use CSV for historical backfills.'
                            : (isIbkrGainskeeper
                                ? 'Upload as many IBKR GainsKeeper OFX/GKX files as available. Overlapping files are allowed and matching CSV rows are upgraded.'
                            : (isTigertrade
                                ? 'Imports Tiger Trade activity statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                                : (isUsmartHk
                                    ? 'Imports uSMART (HK) monthly statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                                    : (isSchwab
                                ? 'Imports Schwab CSV (Order Status / Transaction History) into <code>settings_store/investment.parquet</code> without clearing existing records.'
                                : (isIbkr
                                    ? 'Upload the IBKR Transaction History CSV and Realized Summary CSV for the same account and period.'
                                    : 'Imports into <code>settings_store/investment.parquet</code> without clearing existing records.')))))))));
        }
        if (importSubmitButton instanceof HTMLButtonElement) {
            importSubmitButton.dataset.defaultLabel = usesSyncAction ? 'Sync now' : 'Import now';
            importSubmitButton.dataset.pendingLabel = usesSyncAction ? 'Syncing' : 'Importing';
        }
        seedLongbridgeImportDateRange();
    }

    // Safety net: expose for the shared-select option click handler (especially with position:fixed dropdowns)
    // so that picking a different broker in the import dropdown reliably switches the visible fields.
    window.__forceSyncInvestmentImportMode = syncInvestmentImportMode;

    function getTransactionBrokerCode(txn) {
        return normalizeInvestmentBroker(
            txn?.broker
            || txn?.source?.broker
            || window.ANTIGRAVITY_INVESTMENT_DATA?.broker
            || 'ibkr'
        );
    }

    function renderInvestmentBrokerCell(txn) {
        const brokerMeta = getInvestmentBrokerMeta(getTransactionBrokerCode(txn));
        return `
            <td class="investment-history-cell investment-history-cell-center investment-history-broker-cell">
                <span class="ticker-leading-slot investment-history-broker-slot" aria-hidden="true">
                    <span class="ticker-logo-placeholder investment-history-broker-placeholder"></span>
                    <img class="ticker-input-logo investment-history-broker-logo"
                         src="${escapeHtml(brokerMeta.logoUrl)}"
                         alt="${escapeHtml(brokerMeta.logoAlt)}"
                         loading="lazy"
                         decoding="async">
                </span>
                <span class="sr-only">${escapeHtml(brokerMeta.label)}</span>
            </td>
        `;
    }

    function renderInvestmentStockDetailsColgroup() {
        return `
            <colgroup>
                <col style="width: var(--investment-col-broker-width);">
                <col style="width: var(--investment-col-no-width);">
                <col style="width: var(--investment-col-time-width);">
                <col style="width: var(--investment-col-type-width);">
                <col style="width: var(--investment-col-description-width);">
                <col style="width: var(--investment-col-currency-width);">
                <col style="width: var(--investment-col-amount-width);">
                <col style="width: var(--investment-col-commission-width);">
                <col style="width: var(--investment-col-market-value-width);">
                <col style="width: var(--investment-stock-col-realized-width);">
            </colgroup>
        `;
    }

    function syncHoldingsChartHoverState(ticker, ledgerNo) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const normalizedLedgerNo = Number.isFinite(Number(ledgerNo)) && Number(ledgerNo) > 0
            ? Number(ledgerNo)
            : 0;
        const shouldUpdate = normalizedTicker !== activeHoldingsHoverTicker || normalizedLedgerNo !== activeHoldingsHoverLedgerNo;
        activeHoldingsHoverTicker = normalizedTicker;
        activeHoldingsHoverLedgerNo = normalizedLedgerNo;
        scheduleInvestmentDummyDonutSync();
        syncInvestmentStockDetailsDonutFromInteraction();
        if (!shouldUpdate || !investmentEquityChartInstance) return;
        investmentEquityChartInstance.update('none');
    }

    function easeOutCubic(t) {
        const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const inverse = 1 - clamped;
        return 1 - (inverse * inverse * inverse);
    }

    function normalizeMarkdownCellWhitespace(value, { preserveLineBreaks = false } = {}) {
        const normalized = String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .trim();
        if (!preserveLineBreaks) {
            return normalized
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return normalized
            .replace(/[ \t]*\r?\n[ \t]*/g, '\n')
            .replace(/\n{2,}/g, '\n');
    }

    function extractMarkdownTableCellText(cell) {
        if (!(cell instanceof HTMLElement)) return '';
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('br').forEach((lineBreakNode) => {
            lineBreakNode.replaceWith('\n');
        });
        const rawText = clone.innerText || clone.textContent || '';
        const normalized = normalizeMarkdownCellWhitespace(rawText, { preserveLineBreaks: true });
        return normalized
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join('<br/>');
    }

    function escapeMarkdownTableCell(value) {
        return normalizeMarkdownCellWhitespace(value, { preserveLineBreaks: true })
            .replace(/\|/g, '\\|')
            .replace(/\n/g, '<br/>')
            .trim();
    }

    function extractMarkdownTable(tableElement) {
        if (!tableElement) return '';
        const rows = Array.from(tableElement.querySelectorAll('tr'));
        if (!rows.length) return '';

        const matrix = rows
            .map((row) => Array.from(row.children).map((cell) => escapeMarkdownTableCell(extractMarkdownTableCellText(cell))))
            .filter((row) => row.some((cell) => cell.length > 0));
        if (!matrix.length) return '';

        const header = matrix[0];
        const body = matrix.slice(1);
        const alignment = header.map(() => '---');
        const tableLines = [
            `| ${header.join(' | ')} |`,
            `| ${alignment.join(' | ')} |`,
            ...body.map((row) => {
                const paddedRow = [...row];
                while (paddedRow.length < header.length) {
                    paddedRow.push('');
                }
                return `| ${paddedRow.join(' | ')} |`;
            }),
        ];
        return tableLines.join('\n');
    }

    function getInvestmentDateDisplayHelpers() {
        return window.ANTIGRAVITY_BOOTSTRAP?.dateDisplay || {};
    }

    function parseInvestmentDateParts(rawValue) {
        const match = String(rawValue || '').match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return null;
        return {
            year: Number(match[1]),
            monthIndex: Number(match[2]) - 1,
            day: Number(match[3]),
            hours: match[4] ? Number(match[4]) : null,
            minutes: match[5] ? Number(match[5]) : null,
            seconds: match[6] ? Number(match[6]) : null,
        };
    }

    function formatInvestmentFullDateParts(dateParts, options = {}) {
        const formatter = getInvestmentDateDisplayHelpers().formatFullDateParts;
        if (typeof formatter === 'function') return formatter(dateParts, options);
        if (!dateParts) return '';
        return `${dateParts.day}/${dateParts.monthIndex + 1}/${dateParts.year}`;
    }

    function formatInvestmentFullDateLines(dateParts, options = {}) {
        const formatter = getInvestmentDateDisplayHelpers().formatFullDateLines;
        if (typeof formatter === 'function') return formatter(dateParts, options);
        if (!dateParts) return ['', ''];
        return [`${dateParts.day}/${dateParts.monthIndex + 1}`, `${dateParts.year}`];
    }

    function formatInvestmentShortDateParts(dateParts) {
        const formatter = getInvestmentDateDisplayHelpers().formatShortDateParts;
        if (typeof formatter === 'function') return formatter(dateParts);
        if (!dateParts) return '';
        const month = String(dateParts.monthIndex + 1).padStart(2, '0');
        const day = String(dateParts.day).padStart(2, '0');
        return `${dateParts.year}/${month}/${day}`;
    }

    function formatInvestmentExportDate(rawDate) {
        const dateParts = parseInvestmentDateParts(rawDate);
        if (!dateParts) return String(rawDate || '').trim();
        return formatInvestmentFullDateParts(dateParts);
    }

    function buildExportDateRange(transactions, latestEquityDate = '') {
        const rawDates = Array.isArray(transactions)
            ? transactions
                .map((txn) => String(txn?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1).join('-') || '')
                .filter(Boolean)
            : [];
        if (!rawDates.length) {
            const today = new Date();
            const year = `${today.getFullYear()}`;
            const month = `${today.getMonth() + 1}`.padStart(2, '0');
            const day = `${today.getDate()}`.padStart(2, '0');
            const fallback = `${year}-${month}-${day}`;
            return { start: fallback, end: fallback };
        }
        const sortedDates = [...rawDates].sort();
        const normalizedLatestEquityDate = String(latestEquityDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        const transactionEndDate = sortedDates[sortedDates.length - 1];
        const exportEndDate = normalizedLatestEquityDate && normalizedLatestEquityDate >= transactionEndDate
            ? normalizedLatestEquityDate
            : transactionEndDate;
        return { start: sortedDates[0], end: exportEndDate };
    }

    function getMetricCardExportValue(card) {
        const valueCopyNode = card?.querySelector('.investment-metric-tooltip-value-copy');
        if (valueCopyNode) {
            return valueCopyNode.textContent?.trim() || '';
        }

        const metricValueNode = card?.querySelector('.trade-metric-value');
        if (!metricValueNode) return '';
        const ownText = Array.from(metricValueNode.childNodes || [])
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || '')
            .join(' ')
            .trim();
        return ownText || metricValueNode.textContent?.trim() || '';
    }

    function buildInvestmentMetricsMarkdown(metricsPanel) {
        const metricCards = Array.from(metricsPanel?.querySelectorAll('.trade-metric-card') || [])
            .map((card) => {
                const label = card.querySelector('.trade-metric-label')?.textContent?.trim() || '';
                const value = getMetricCardExportValue(card);
                return [label, value];
            })
            .filter(([label, value]) => label && value);

        return metricCards
            .map(([label, value]) => `**${label}:** ${value}`)
            .join('\n');
    }

    function guessInvestmentExportDescription(transactions, holdingsTableMarkdown) {
        const tickerSet = new Set(
            (Array.isArray(transactions) ? transactions : [])
                .map((txn) => String(txn?.ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
        if (tickerSet.size === 1) {
            const [ticker] = Array.from(tickerSet);
            return `${ticker} Investment Holdings and Transaction History`;
        }
        if (holdingsTableMarkdown.includes('Money market')) {
            return 'Investment Holdings and Cash Transaction History';
        }
        return 'Investment Holdings and Transaction History';
    }

    function downloadBlobFile(filename, blob) {
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => {
            window.URL.revokeObjectURL(objectUrl);
        }, 0);
    }

    function downloadMarkdownFile(filename, content) {
        downloadBlobFile(filename, new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    }

    function cloneRenderedTable(headerTable, bodyTable) {
        if (!headerTable || !bodyTable) return null;
        const headerRows = Array.from(headerTable.querySelectorAll('thead tr'));
        const bodyRows = Array.from(bodyTable.querySelectorAll('tbody tr'));
        const table = document.createElement('table');
        if (headerRows.length) {
            const thead = document.createElement('thead');
            headerRows.forEach((row) => thead.appendChild(row.cloneNode(true)));
            table.appendChild(thead);
        }
        const tbody = document.createElement('tbody');
        bodyRows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
        table.appendChild(tbody);
        return table;
    }

    function renderInvestmentHistoryRowMarkup(txn) {
        const description = formatTransactionDescription(txn);
        const brokerMarketValue = Number(txn?.broker_market_value ?? txn?.market_value) || 0;
        const brokerRunningCash = Number(txn?.broker_running_cash ?? txn?.running_cash) || 0;
        const brokerPendingSettlementCash = Number(txn?.broker_pending_settlement_cash) || 0;
        const brokerDisplayCash = Number(txn?.broker_display_cash);
        const brokerTotalEquity = Number(txn?.broker_total_equity ?? txn?.total_equity) || 0;
        const brokerCode = normalizeInvestmentBroker(txn?.broker || getTransactionBrokerCode(txn));
        const shouldShowPendingSettlementCash = (
            brokerCode === 'hsbc'
            && txn?.source?.cash_replay_pending_settlement === true
            && Math.abs(brokerPendingSettlementCash) > 1e-9
        );
        const brokerCashForDisplay = Number.isFinite(brokerDisplayCash)
            ? brokerDisplayCash
            : (shouldShowPendingSettlementCash
                ? brokerRunningCash + brokerPendingSettlementCash
                : brokerRunningCash);
        const sourceKey = String(txn?.manual_internal_transfer_source_key || '').trim();
        const transferOptions = sourceKey ? (investmentInternalTransferSourceOptionsByKey.get(sourceKey) || []) : [];
        const selectedTargetKey = String(txn?.manual_internal_transfer_selected_target_key || '').trim();
        const resolvedDescription = getInvestmentResolvedTransferDescription(txn);
        const descriptionCurrentText = resolvedDescription || description;
        const resolvedBinding = sourceKey ? investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey) || null : null;
        const transferFeeNote = txn?.manual_internal_transfer_needs_binding
            ? String(txn?.manual_internal_transfer_fee_note || '').trim()
            : '';
        const resolvedBrokerLabel = resolvedBinding?.targetTxn
            ? getInvestmentBrokerMeta(getTransactionBrokerCode(resolvedBinding.targetTxn)).label
            : 'HSBC';
        const currencyDisplay = formatInvestmentHistoryCurrencyDisplay(txn);
        const descriptionMarkup = transferOptions.length
            ? `
                <div class="investment-transfer-link-shell${txn?.manual_internal_transfer_needs_binding ? ' is-unresolved' : ' is-resolved'}">
                    <span class="investment-transfer-link-current">${escapeHtml(descriptionCurrentText)}</span>
                    <select class="investment-transfer-link-select trade-strategy-select form-select"
                            data-investment-transfer-source-key="${escapeHtml(sourceKey)}"
                            aria-label="Bind internal transfer counterpart">
                        ${txn?.manual_internal_transfer_needs_binding
                            ? '<option value="">Bind transfer outflow...</option>'
                            : `<option value="${escapeHtml(selectedTargetKey)}" selected>from ${escapeHtml(resolvedBrokerLabel)}</option><option value="">Undo link</option>`}
                        ${transferOptions.map((option) => `
                            <option value="${escapeHtml(option.key)}"${txn?.manual_internal_transfer_needs_binding && option.key === selectedTargetKey ? ' selected' : ''}>
                                ${escapeHtml(option.label)}
                            </option>
                        `).join('')}
                    </select>
                    ${transferFeeNote ? `<span class="investment-transfer-link-fee-note">${escapeHtml(transferFeeNote)}</span>` : ''}
                </div>
            `
            : escapeHtml(description);
        return `
            <tr id="investment_history_row_${txn.ledger_no}" data-investment-history-row="${txn.ledger_no}" data-investment-history-date="${escapeHtml(String(txn.date || '').slice(0, 10))}" data-investment-history-ticker="${escapeHtml(String(txn.ticker || '').trim().toUpperCase())}">
                ${renderInvestmentBrokerCell(txn)}
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left${txn?.manual_internal_transfer_needs_binding ? ' investment-history-cell-transfer-pending' : ''}">${descriptionMarkup}</td>
                <td class="investment-history-cell investment-history-cell-center">${escapeHtml(currencyDisplay)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.display_amount)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(brokerMarketValue)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(brokerCashForDisplay)}</td>
                <td class="investment-history-cell investment-history-cell-right investment-history-cell-emphasis"><strong>${formatAmount(brokerTotalEquity)}</strong></td>
            </tr>
        `;
    }

    function bindInvestmentHistoryTransferControls(tbody) {
        if (!(tbody instanceof HTMLElement) || tbody.dataset.transferBindingBound === '1') return;
        tbody.dataset.transferBindingBound = '1';
        tbody.addEventListener('change', async (event) => {
            const select = event.target.closest('.investment-transfer-link-select');
            if (!(select instanceof HTMLSelectElement)) return;
            const sourceKey = String(select.dataset.investmentTransferSourceKey || '').trim();
            if (!sourceKey) return;
            const targetKey = String(select.value || '').trim();
            rememberInvestmentInternalTransferBinding(sourceKey, targetKey);
            setImportFeedback(
                targetKey
                    ? 'Linked the selected HSBC outflow. Aggregate equity now treats that bridge as an internal transfer.'
                    : 'Removed the manual HSBC outflow link. The aggregate curve now shows the raw transfer path again.',
                targetKey ? 'success' : 'warning'
            );
            await renderTransactionTable(investmentRawTransactionsCache, { preserveHistoryPage: true, scrollToTop: false });
        });
    }

    function buildInvestmentHistoryExportTable(processedTransactions = [], chartPoints = []) {
        const headerTable = document.querySelector('#history_table_wrap table[aria-hidden="true"]');
        if (!(headerTable instanceof HTMLTableElement)) return null;
        const visibleTransactions = getVisibleInvestmentHistoryTransactions(processedTransactions, chartPoints);
        if (!visibleTransactions.length) return null;
        const table = document.createElement('table');
        const thead = headerTable.querySelector('thead');
        if (thead) {
            table.appendChild(thead.cloneNode(true));
        }
        const tbody = document.createElement('tbody');
        tbody.innerHTML = [...visibleTransactions].reverse().map((txn) => renderInvestmentHistoryRowMarkup(txn)).join('');
        table.appendChild(tbody);
        return table;
    }

    function buildInvestmentMarkdownExport() {
        const latestEquityDate = String(investmentLatestChartPoint?.date || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        if (activeInvestmentView === 'stock_details') {
            const activeTicker = normalizeInvestmentTicker(selectedInvestmentStockTicker || getInvestmentLocationTicker());
            const metricsPanel = investmentStockDetailsPanel?.querySelector('.investment-stock-details-metrics');
            const historyHeaderTable = investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table[aria-hidden="true"]');
            const historyBodyTable = investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table-scroll table');
            const historyTable = cloneRenderedTable(historyHeaderTable, historyBodyTable);
            const historyMarkdown = extractMarkdownTable(historyTable);
            if (!metricsPanel || !historyMarkdown) {
                return null;
            }

            const processedTransactions = Array.isArray(investmentProcessedTransactionsCache)
                ? investmentProcessedTransactionsCache
                : [];
            const tickerTransactions = processedTransactions.filter((txn) => getInvestmentCanonicalTicker(txn?.ticker) === activeTicker);
            const dateRange = buildExportDateRange(tickerTransactions, latestEquityDate);
            if (!dateRange) {
                return null;
            }

            const metricsMarkdown = buildInvestmentMetricsMarkdown(metricsPanel);
            const companyName = investmentStockDetailsPanel?.querySelector('.ticker-identity-name')?.textContent?.trim() || '';
            const title = activeTicker
                ? `${activeTicker} Stock Details Transaction History`
                : 'Investment Stock Details Transaction History';
            const formattedRange = `${formatInvestmentExportDate(dateRange.start)} - ${formatInvestmentExportDate(dateRange.end)}`;
            const markdown = [
                `# ${title}`,
                '',
                activeTicker ? `**Ticker:** ${activeTicker}` : '',
                companyName ? `**Company:** ${companyName}` : '',
                `**Range:** ${formattedRange}`,
                '',
                '## Metrics',
                '',
                metricsMarkdown,
                '',
                '## Transaction history',
                '',
                historyMarkdown,
                '',
            ].filter((line, index, lines) => (
                line !== ''
                || index === 0
                || lines[index - 1] !== ''
            )).join('\n');

            return {
                filename: `${title} ${dateRange.start} - ${dateRange.end}.md`,
                markdown,
            };
        }

        const holdingsHeaderTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[aria-hidden="true"]');
        const holdingsBodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const holdingsTable = cloneRenderedTable(holdingsHeaderTable, holdingsBodyTable);
        const processedTransactions = Array.isArray(investmentProcessedTransactionsCache)
            ? investmentProcessedTransactionsCache
            : [];
        const visibleHistoryTransactions = getVisibleInvestmentHistoryTransactions(processedTransactions, investmentChartPointsCache);
        const historyTable = buildInvestmentHistoryExportTable(processedTransactions, investmentChartPointsCache);
        if (!metricsPanel || !holdingsTable || !historyTable) {
            return null;
        }

        const holdingsMarkdown = extractMarkdownTable(holdingsTable);
        const historyMarkdown = extractMarkdownTable(historyTable);
        if (!holdingsMarkdown || !historyMarkdown) {
            return null;
        }

        const dateRange = buildExportDateRange(visibleHistoryTransactions, latestEquityDate);
        if (!dateRange) {
            return null;
        }
        const title = guessInvestmentExportDescription(visibleHistoryTransactions, holdingsMarkdown);
        const metricsMarkdown = buildInvestmentMetricsMarkdown(metricsPanel);
        const formattedRange = `${formatInvestmentExportDate(dateRange.start)} - ${formatInvestmentExportDate(dateRange.end)}`;
        const markdown = [
            `# ${title}`,
            '',
            `**Range:** ${formattedRange}`,
            '',
            '## Holdings',
            '',
            holdingsMarkdown,
            '',
            '## Metrics',
            '',
            metricsMarkdown,
            '',
            '## Transaction history',
            '',
            historyMarkdown,
            '',
        ].join('\n');

        return {
            filename: `${title} ${dateRange.start} - ${dateRange.end}.md`,
            markdown,
        };
    }

    function buildTableAlignmentSync(tableShell, scrollContainer, scrollbarVariableName) {
        if (!(tableShell instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return null;

        const headerHeightVariableName = '--scrollable-data-table-header-height';
        let frameId = 0;
        let resizeObserver = null;
        let observedHeader = null;

        const getOverlayHeader = () => {
            const header = Array.from(tableShell.children).find((child) => (
                child instanceof HTMLTableElement
                && child.matches('table[aria-hidden="true"]')
            ));
            return header instanceof HTMLElement ? header : null;
        };

        const roundUpToDevicePixel = (value) => {
            const scale = window.devicePixelRatio || 1;
            return Math.ceil(value * scale) / scale;
        };

        const getBodyColumnWidths = (bodyTable) => {
            if (!(bodyTable instanceof HTMLTableElement)) return [];
            const row = Array.from(bodyTable.rows).find((candidate) => candidate.cells.length);
            if (!row) return [];
            return Array.from(row.cells).map((cell) => cell.getBoundingClientRect().width);
        };

        const syncOverlayColumnWidths = (scrollbarWidth, overlayBorderCompensation) => {
            const overlayHeader = getOverlayHeader();
            const bodyTable = scrollContainer.querySelector('table');
            if (!(overlayHeader instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return;
            const columnWidths = getBodyColumnWidths(bodyTable);
            if (!columnWidths.length) return;
            Array.from(overlayHeader.children).forEach((child) => {
                if (child instanceof HTMLElement && child.tagName === 'COLGROUP') {
                    child.remove();
                }
            });
            const lastIndex = columnWidths.length - 1;
            columnWidths[lastIndex] = Math.max(
                1,
                columnWidths[lastIndex] + scrollbarWidth,
            );
            Array.from(overlayHeader.rows).forEach((row) => {
                Array.from(row.cells).forEach((cell, index) => {
                    if (index >= columnWidths.length) return;
                    cell.style.width = `${columnWidths[index] || 1}px`;
                });
            });
        };

        const syncHeaderHeight = () => {
            const overlayHeader = getOverlayHeader();
            if (!(overlayHeader instanceof HTMLElement)) {
                tableShell.style.removeProperty(headerHeightVariableName);
                return;
            }
            if (resizeObserver && observedHeader !== overlayHeader) {
                if (observedHeader instanceof HTMLElement) {
                    resizeObserver.unobserve(observedHeader);
                }
                resizeObserver.observe(overlayHeader);
                observedHeader = overlayHeader;
            }
            const headerHeight = overlayHeader.getBoundingClientRect().height;
            if (headerHeight > 0) {
                tableShell.style.setProperty(headerHeightVariableName, `${roundUpToDevicePixel(headerHeight)}px`);
            }
        };

        const syncAlignment = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            const overlayBorderCompensation = scrollbarWidth > 0 ? 1 : 0;
            tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
            tableShell.style.setProperty('--scrollable-data-table-scrollbar-width', `${scrollbarWidth}px`);
            tableShell.style.setProperty(
                '--scrollable-data-table-overlay-border-compensation',
                `${overlayBorderCompensation}px`
            );
            syncOverlayColumnWidths(scrollbarWidth, overlayBorderCompensation);
            syncHeaderHeight();
        };

        const scheduleAlignmentSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncAlignment);
        };

        scheduleAlignmentSync();
        window.addEventListener('resize', scheduleAlignmentSync);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                scheduleAlignmentSync();
            });
            resizeObserver.observe(tableShell);
            resizeObserver.observe(scrollContainer);
            const bodyTable = scrollContainer.querySelector('table');
            if (bodyTable instanceof HTMLElement) {
                resizeObserver.observe(bodyTable);
            }
            const overlayHeader = getOverlayHeader();
            if (overlayHeader instanceof HTMLElement) {
                resizeObserver.observe(overlayHeader);
                observedHeader = overlayHeader;
            }
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            window.removeEventListener('resize', scheduleAlignmentSync);
            resizeObserver?.disconnect();
            tableShell.style.removeProperty(scrollbarVariableName);
            tableShell.style.removeProperty('--scrollable-data-table-scrollbar-width');
            tableShell.style.removeProperty('--scrollable-data-table-overlay-border-compensation');
            tableShell.style.removeProperty(headerHeightVariableName);
        };
    }

    function attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
        underlayClassName = '',
        underlayTableClassName = '',
        scrollbarVariableName = '',
    } = {}) {
        if (!(tableShell instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return null;
        const bodyTable = scrollContainer.querySelector('table');
        if (!(bodyTable instanceof HTMLTableElement)) return null;
        tableShell
            .querySelectorAll('.scrollable-data-table-frosted-underlay')
            .forEach((node) => node.remove());

        const underlay = document.createElement('div');
        underlay.className = [
            'scrollable-data-table-frosted-underlay',
            underlayClassName,
        ].filter(Boolean).join(' ');
        underlay.setAttribute('aria-hidden', 'true');
        const underlayTable = bodyTable.cloneNode(true);
        underlayTable.querySelectorAll('[id]').forEach((node) => {
            node.removeAttribute('id');
        });
        underlayTable.removeAttribute('id');
        underlayTable.classList.add('scrollable-data-table-frosted-underlay-table');
        if (underlayTableClassName) {
            underlayTable.classList.add(underlayTableClassName);
        }
        underlayTable.setAttribute('aria-hidden', 'true');
        underlay.appendChild(underlayTable);
        tableShell.insertBefore(underlay, tableShell.firstChild);

        let frameId = 0;
        let resizeObserver = null;

        const syncUnderlay = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            if (scrollbarVariableName) {
                tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
            }
            const shellRect = tableShell.getBoundingClientRect();
            const scrollRect = scrollContainer.getBoundingClientRect();
            const scrollViewportOffset = Math.max(0, scrollRect.top - shellRect.top);
            tableShell.style.setProperty(
                '--scrollable-data-table-underlay-offset-y',
                `${scrollViewportOffset - scrollContainer.scrollTop}px`
            );
            const bodyWidth = bodyTable.getBoundingClientRect().width;
            if (bodyWidth > 0) {
                underlayTable.style.width = `${bodyWidth}px`;
            }
        };

        const scheduleUnderlaySync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncUnderlay);
        };

        scheduleUnderlaySync();
        scrollContainer.addEventListener('scroll', scheduleUnderlaySync, { passive: true });
        window.addEventListener('resize', scheduleUnderlaySync);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(scheduleUnderlaySync);
            resizeObserver.observe(tableShell);
            resizeObserver.observe(scrollContainer);
            resizeObserver.observe(bodyTable);
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            scrollContainer.removeEventListener('scroll', scheduleUnderlaySync);
            window.removeEventListener('resize', scheduleUnderlaySync);
            resizeObserver?.disconnect();
            underlay.remove();
            tableShell.style.removeProperty('--scrollable-data-table-underlay-offset-y');
        };
    }

    function teardownHoldingsTableAlignmentSync() {
        if (typeof investmentHoldingsTableAlignmentCleanup === 'function') {
            investmentHoldingsTableAlignmentCleanup();
            investmentHoldingsTableAlignmentCleanup = null;
        }
    }

    function attachHoldingsTableAlignmentSync(holdingsPanel) {
        teardownHoldingsTableAlignmentSync();
        if (!(holdingsPanel instanceof HTMLElement)) return;
        const tableShell = holdingsPanel.querySelector('.investment-holdings-table-shell');
        const scrollContainer = holdingsPanel.querySelector('.investment-holdings-table-scroll');
        const alignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-holdings-scrollbar-width'
        );
        const underlayCleanup = attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
            underlayClassName: 'investment-holdings-frosted-underlay',
            underlayTableClassName: 'investment-holdings-frosted-underlay-table',
            scrollbarVariableName: '--investment-holdings-scrollbar-width',
        });
        investmentHoldingsTableAlignmentCleanup = () => {
            if (typeof alignmentCleanup === 'function') alignmentCleanup();
            if (typeof underlayCleanup === 'function') underlayCleanup();
        };
    }

    function teardownHistoryTableAlignmentSync() {
        if (typeof investmentHistoryTableAlignmentCleanup === 'function') {
            investmentHistoryTableAlignmentCleanup();
            investmentHistoryTableAlignmentCleanup = null;
        }
    }

    function attachHistoryTableAlignmentSync(historyPanel) {
        teardownHistoryTableAlignmentSync();
        if (!(historyPanel instanceof HTMLElement)) return;
        const tableShell = historyPanel.matches('.investment-history-table-shell')
            ? historyPanel
            : historyPanel.querySelector('.investment-history-table-shell');
        const scrollContainer = historyPanel.matches('.investment-history-table-scroll')
            ? historyPanel
            : historyPanel.querySelector('.investment-history-table-scroll');
        const alignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-history-scrollbar-width'
        );
        const underlayCleanup = attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
            underlayClassName: 'investment-history-frosted-underlay',
            underlayTableClassName: 'investment-history-frosted-underlay-table',
            scrollbarVariableName: '--investment-history-scrollbar-width',
        });
        investmentHistoryTableAlignmentCleanup = () => {
            if (typeof alignmentCleanup === 'function') alignmentCleanup();
            if (typeof underlayCleanup === 'function') underlayCleanup();
        };
    }

    function teardownStockDetailsTableAlignmentSync() {
        if (typeof investmentStockDetailsTableAlignmentCleanup === 'function') {
            investmentStockDetailsTableAlignmentCleanup();
            investmentStockDetailsTableAlignmentCleanup = null;
        }
    }

    function attachStockDetailsTableAlignmentSync(stockDetailsPanel) {
        teardownStockDetailsTableAlignmentSync();
        if (!(stockDetailsPanel instanceof HTMLElement)) return;
        const tableShell = stockDetailsPanel.matches('.investment-stock-details-table-shell')
            ? stockDetailsPanel
            : stockDetailsPanel.querySelector('.investment-stock-details-table-shell');
        const scrollContainer = stockDetailsPanel.matches('.investment-stock-details-table-scroll')
            ? stockDetailsPanel
            : stockDetailsPanel.querySelector('.investment-stock-details-table-scroll');
        investmentStockDetailsTableAlignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-stock-details-scrollbar-width'
        );
    }

    function syncInvestmentShareMaskButtonState() {
        if (!(shareMaskButton instanceof HTMLButtonElement)) return;
        const label = investmentShareMaskEnabled ? 'Reveal Sensitive Values' : 'Mask Sensitive Values';
        shareMaskButton.setAttribute('aria-pressed', investmentShareMaskEnabled ? 'true' : 'false');
        shareMaskButton.setAttribute('aria-label', label);
        shareMaskButton.title = label;
    }

    function syncInvestmentShareMaskState() {
        if (investmentStockDetailsPanel instanceof HTMLElement) {
            investmentStockDetailsPanel.classList.toggle('is-share-sensitive-masked', investmentShareMaskEnabled);
        }
        if (investmentShareActions instanceof HTMLElement) {
            investmentShareActions.classList.toggle('is-mask-active', investmentShareMaskEnabled);
        }
        syncInvestmentEquityChartAxisMask();
        syncInvestmentShareMaskButtonState();
    }

    function syncInvestmentEquityChartAxisMask() {
        if (!investmentEquityChartInstance) return;
        const yScaleTicks = investmentEquityChartInstance.options?.scales?.y?.ticks;
        if (!yScaleTicks) return;
        yScaleTicks.color = resolveInvestmentTheme().muted;
        yScaleTicks.callback = function (value, index, ticks) {
            if (index === 0 || index === ticks.length - 1) return '';
            if (investmentShareMaskEnabled) return '***';
            return typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : String(value);
        };
        investmentEquityChartInstance.update('none');
    }

    function getInvestmentShareViewTitle(view = activeInvestmentView) {
        return getInvestmentShareViewLabel(view);
    }

    function getInvestmentShareViewLabel(view = activeInvestmentView) {
        switch (normalizeInvestmentView(view)) {
            case 'holdings':
                return 'Holdings';
            case 'stock_details':
                return 'Stock details';
            case 'metrics':
                return 'Metrics';
            case 'chart':
            default:
                return 'Overview';
        }
    }

    function getInvestmentShareViewSubtitle(view = activeInvestmentView) {
        void view;
        return '';
    }

    function getInvestmentProjectMeta() {
        const sourceUrl = String(window.ANTIGRAVITY_APP?.project?.sourceUrl || '').trim();
        const displayUrl = String(window.ANTIGRAVITY_APP?.project?.displayUrl || '').trim();
        return {
            sourceUrl: sourceUrl || window.location.href,
            displayUrl: displayUrl || sourceUrl.replace(/^https?:\/\//, '') || window.location.host,
        };
    }

    function getInvestmentShareTimestampText() {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        const parts = Object.create(null);
        formatter.formatToParts(new Date()).forEach((part) => {
            if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return `${parts.day}/${parts.month}/${parts.year}\n${parts.hour}:${parts.minute}:${parts.second} HKT`;
    }

    function sanitizeInvestmentShareClone(node) {
        if (!(node instanceof HTMLElement)) return node;
        node.querySelectorAll('[id]').forEach((element) => {
            element.removeAttribute('id');
        });
        node.querySelectorAll('[data-bound], [data-history-hover-bound], [data-logo-fallback-bound]').forEach((element) => {
            element.removeAttribute('data-bound');
            element.removeAttribute('data-history-hover-bound');
            element.removeAttribute('data-logo-fallback-bound');
        });
        return node;
    }

    function createInvestmentShareHeader(view = activeInvestmentView) {
        const header = document.createElement('div');
        header.className = 'investment-community-share-header';

        const heading = document.createElement('div');
        heading.className = 'investment-community-share-heading';

        const title = document.createElement('p');
        title.className = 'investment-community-share-title';
        title.textContent = getInvestmentShareViewTitle(view);
        heading.appendChild(title);

        const subtitleText = getInvestmentShareViewSubtitle(view);
        if (subtitleText && normalizeInvestmentView(view) !== 'chart') {
            const subtitle = document.createElement('p');
            subtitle.className = 'investment-community-share-subtitle';
            subtitle.textContent = subtitleText;
            heading.appendChild(subtitle);
        }

        header.appendChild(heading);
        return header;
    }

    async function ensureInvestmentQrCodeFactory() {
        if (typeof window.qrcode === 'function') return window.qrcode;
        if (investmentQrCodeLibraryPromise) return investmentQrCodeLibraryPromise;
        investmentQrCodeLibraryPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-investment-share-library="qrcode-generator"]');
            if (existingScript) {
                existingScript.addEventListener('load', () => resolve(window.qrcode), { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Failed to load QR code renderer.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = '/static/assets/js/vendor/qrcode-generator.js';
            script.async = true;
            script.dataset.investmentShareLibrary = 'qrcode-generator';
            script.addEventListener('load', () => {
                if (typeof window.qrcode === 'function') {
                    resolve(window.qrcode);
                    return;
                }
                reject(new Error('QR code renderer loaded without exposing factory.'));
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error('Failed to load QR code renderer.'));
            }, { once: true });
            document.head.appendChild(script);
        }).catch((error) => {
            investmentQrCodeLibraryPromise = null;
            throw error;
        });
        return investmentQrCodeLibraryPromise;
    }

    async function createInvestmentShareQrNode(sourceUrl) {
        const qrFactory = await ensureInvestmentQrCodeFactory();
        const qr = qrFactory(0, 'M');
        qr.addData(String(sourceUrl || '').trim());
        qr.make();
        const moduleCount = qr.getModuleCount();
        const margin = 2;
        const viewBoxSize = moduleCount + margin * 2;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${viewBoxSize} ${viewBoxSize}`);
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');

        const pathData = [];
        for (let row = 0; row < moduleCount; row += 1) {
            for (let col = 0; col < moduleCount; col += 1) {
                if (!qr.isDark(row, col)) continue;
                const x = col + margin;
                const y = row + margin;
                pathData.push(`M${x} ${y}h1v1H${x}z`);
            }
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData.join(''));
        path.setAttribute('fill', 'currentColor');
        svg.appendChild(path);
        return svg;
    }

    const INVESTMENT_COMMUNITY_SHARE_FOOTER_PROMPT = 'Welcome to vibe and star this project.';

    async function createInvestmentShareFooter() {
        const projectMeta = getInvestmentProjectMeta();
        const footer = document.createElement('div');
        footer.className = 'investment-community-share-footer';
        footer.dataset.shareTemplateFixed = '1';

        const brandIcon = document.createElement('img');
        brandIcon.className = 'investment-community-share-footer-brand-icon';
        brandIcon.src = '/market-store/logos/favicon.svg';
        brandIcon.alt = '';
        brandIcon.decoding = 'sync';
        footer.appendChild(brandIcon);

        const copy = document.createElement('div');
        copy.className = 'investment-community-share-footer-copy';

        const timestamp = document.createElement('div');
        timestamp.className = 'investment-community-share-footer-timestamp';
        timestamp.textContent = getInvestmentShareTimestampText();

        copy.appendChild(timestamp);

        const prompt = document.createElement('p');
        prompt.className = 'investment-community-share-footer-prompt';
        prompt.textContent = INVESTMENT_COMMUNITY_SHARE_FOOTER_PROMPT;
        copy.appendChild(prompt);

        footer.appendChild(copy);

        const qrShell = document.createElement('div');
        qrShell.className = 'investment-community-share-footer-qr';
        qrShell.appendChild(await createInvestmentShareQrNode(projectMeta.sourceUrl));
        footer.appendChild(qrShell);
        return footer;
    }

    function createInvestmentShareTemplateFrame(view = activeInvestmentView) {
        const normalizedView = normalizeInvestmentView(view);
        const host = document.createElement('div');
        host.className = 'investment-community-share-capture';
        host.style.setProperty('--investment-community-share-shell-export-width', 'var(--investment-community-share-shell-width, 1080px)');
        host.style.setProperty('--investment-community-share-shell-export-height', 'var(--investment-community-share-shell-height, 1730px)');

        const card = document.createElement('article');
        card.className = 'investment-community-share-card';
        card.dataset.shareView = normalizedView;
        card.dataset.shareTemplate = 'stable-v1';

        const body = document.createElement('div');
        body.className = 'investment-community-share-body';

        card.appendChild(createInvestmentShareHeader(normalizedView));
        card.appendChild(body);
        host.appendChild(card);
        return { host, card, body };
    }

    function createInvestmentShareSection(className = '') {
        const section = document.createElement('div');
        section.className = ['investment-community-share-section', className].filter(Boolean).join(' ');
        return section;
    }

    function readInvestmentShareSafePaddingPx(scope = document.documentElement) {
        const readFromBootstrap = window.ANTIGRAVITY_BOOTSTRAP?.workspaceShare?.readSafePaddingPx;
        if (typeof readFromBootstrap === 'function') {
            return readFromBootstrap(scope);
        }
        const element = scope instanceof HTMLElement ? scope : document.documentElement;
        const styles = window.getComputedStyle(element);
        const raw = styles.getPropertyValue('--investment-community-share-safe-padding').trim()
            || styles.getPropertyValue('--investment-community-share-card-padding').trim()
            || '10px';
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : 10;
    }

    function resolveInvestmentShareChartInstance(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        if (canvas.id === 'investmentEquityChart') return investmentEquityChartInstance;
        if (canvas.classList.contains('investment-stock-details-price-chart-canvas')) {
            return investmentStockDetailsPriceChartInstance;
        }
        return window.Chart?.getChart?.(canvas) || null;
    }

    function createInvestmentShareChartDataUrl(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const capture = window.ANTIGRAVITY_BOOTSTRAP?.workspaceShare?.captureChartDataUrl;
        const chartInstance = resolveInvestmentShareChartInstance(canvas);
        if (typeof capture === 'function') {
            return capture(canvas, chartInstance) || canvas.toDataURL('image/png');
        }
        return canvas.toDataURL('image/png');
    }

    function createInvestmentShareChartImage(canvas) {
        const chartDataUrl = createInvestmentShareChartDataUrl(canvas);
        if (!chartDataUrl) return null;
        const image = document.createElement('img');
        image.className = 'investment-community-share-chart-image';
        image.alt = '';
        image.decoding = 'sync';
        image.src = chartDataUrl;
        return image;
    }

    function createInvestmentShareChartSection(canvas) {
        const image = createInvestmentShareChartImage(canvas);
        if (!(image instanceof HTMLImageElement)) return null;
        const section = createInvestmentShareSection('investment-community-share-section--chart');
        const shell = document.createElement('div');
        shell.className = 'investment-community-share-chart-shell';
        shell.appendChild(image);
        section.appendChild(shell);
        return section;
    }

    function buildInvestmentOverviewShareBody(body) {
        const chartCanvas = document.getElementById('investmentEquityChart');
        syncInvestmentEquityChartAxisMask();
        const chartSection = createInvestmentShareChartSection(chartCanvas);
        if (!(chartSection instanceof HTMLElement)) return false;
        body.appendChild(chartSection);

        const donutShell = investmentDummyChart?.querySelector('.style-token-portfolio-donut-shell');
        if (donutShell instanceof HTMLElement) {
            const donutSection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
            const donutWrap = document.createElement('div');
            donutWrap.className = 'investment-community-share-overview-donut';
            donutWrap.appendChild(sanitizeInvestmentShareClone(donutShell.cloneNode(true)));
            donutSection.appendChild(donutWrap);
            body.appendChild(donutSection);
        }
        return true;
    }

    function stabilizeInvestmentShareDonutOrbits(root) {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('.style-token-portfolio-donut-orbit').forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
            const orbitMetrics = getPortfolioDonutOrbitMetrics(orbitElement);
            if (!orbitMetrics) return;
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                const targetAngle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || '');
                if (!Number.isFinite(targetAngle)) return;
                logoElement.classList.remove('is-orbit-animated', 'is-exiting');
                logoElement.style.transition = 'none';
                renderInvestmentDonutOrbitLogoPosition(logoElement, targetAngle, orbitMetrics, 1, 1);
            });
        });
    }

    function buildInvestmentStockDetailsShareBody(body) {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return false;
        const identity = investmentStockDetailsPanel.querySelector('.investment-stock-details-identity');
        const chartCanvas = investmentStockDetailsPanel.querySelector('.investment-stock-details-price-chart-canvas');
        const metrics = investmentStockDetailsPanel.querySelector('.investment-stock-details-metrics');
        if (!(chartCanvas instanceof HTMLCanvasElement) || !(metrics instanceof HTMLElement)) return false;

        if (identity instanceof HTMLElement) {
            const identitySection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
            identitySection.appendChild(sanitizeInvestmentShareClone(identity.cloneNode(true)));
            body.appendChild(identitySection);
        }

        const chartSection = createInvestmentShareChartSection(chartCanvas);
        if (chartSection instanceof HTMLElement) {
            body.appendChild(chartSection);
        }

        const metricsSection = createInvestmentShareSection('investment-community-share-section--compact investment-community-share-section--padded');
        metricsSection.appendChild(sanitizeInvestmentShareClone(metrics.cloneNode(true)));
        body.appendChild(metricsSection);
        return true;
    }

    function buildInvestmentHoldingsShareTable({ maskSensitive = false } = {}) {
        const headerTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[aria-hidden="true"]');
        const bodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        if (!(headerTable instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return null;

        const removedColumnIndexes = maskSensitive ? [6, 3, 1] : [1];
        const pruneShareHoldingsRow = (tableRow) => {
            if (!(tableRow instanceof HTMLTableRowElement)) return;
            removedColumnIndexes.forEach((index) => {
                tableRow.cells.item(index)?.remove();
            });
        };
        const adaptShareHoldingsSummaryRow = (tableRow) => {
            if (!(tableRow instanceof HTMLTableRowElement)) return;
            const summaryCopyCell = tableRow.cells.item(1);
            const summaryLeadCell = tableRow.cells.item(0);
            if (summaryLeadCell instanceof HTMLTableCellElement && summaryCopyCell instanceof HTMLTableCellElement) {
                summaryLeadCell.className = 'investment-holdings-cell investment-holdings-cell-ticker';
                summaryLeadCell.textContent = '';
                Array.from(summaryCopyCell.childNodes).forEach((child) => {
                    summaryLeadCell.appendChild(child);
                });
            }
            pruneShareHoldingsRow(tableRow);
            Array.from(tableRow.cells).forEach((cell, index) => {
                if (!(cell instanceof HTMLTableCellElement)) return;
                if (index === 0 && (cell.querySelector('.investment-holdings-summary-ticker-body') || cell.querySelector('.investment-holdings-summary-copy'))) return;
                populateShareHoldingsMetricCell(cell);
            });
        };

        const buildShareTickerCell = (ticker) => {
            const normalizedTicker = String(ticker || '').trim().toUpperCase();
            const tickerProfiles = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {};
            const profile = resolveInvestmentTickerProfile(tickerProfiles, normalizedTicker);
            const tickerLabel = formatInvestmentTickerForDisplay(normalizedTicker);
            const companyName = resolveInvestmentTickerCompanyName(tickerProfiles, normalizedTicker);
            const logoUrls = resolveInvestmentLogoUrls(profile, normalizedTicker);

            const wrapper = document.createElement('div');
            wrapper.className = 'suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link';
            wrapper.dataset.ticker = normalizedTicker;

            const row = document.createElement('div');
            row.className = 'ticker-identity-row';

            const logo = document.createElement('img');
            logo.className = 'ticker-identity-logo';
            logo.alt = '';
            logo.hidden = true;
            logo.loading = 'eager';
            logo.decoding = 'async';
            logo.dataset.investmentLogoImage = '';
            logo.dataset.logoUrl = JSON.stringify(logoUrls);
            logo.dataset.ticker = normalizedTicker;

            const placeholder = document.createElement('span');
            placeholder.className = 'ticker-identity-logo ticker-identity-logo-placeholder';
            placeholder.setAttribute('aria-hidden', 'true');

            const copy = document.createElement('span');
            copy.className = 'ticker-identity-copy';

            const symbol = document.createElement('span');
            symbol.className = 'suggestion-symbol ticker-identity-symbol';
            symbol.textContent = tickerLabel;

            copy.appendChild(symbol);
            if (companyName) {
                const name = document.createElement('span');
                name.className = 'suggestion-name ticker-identity-name';
                name.title = companyName;
                name.textContent = companyName;
                copy.appendChild(name);
            }
            row.append(logo, placeholder, copy);
            wrapper.append(row);
            syncInvestmentTickerLogoAsset(
                logo,
                placeholder,
                logoUrls,
                normalizedTicker ? `${normalizedTicker} logo` : '',
            );
            return wrapper;
        };

        const headerRow = headerTable.querySelector('thead tr:first-child');
        const summaryRow = headerTable.querySelector('.investment-holdings-summary-row');
        const dataRows = Array.from(bodyTable.querySelectorAll('tbody tr')).slice(0, 5);
        if (!(headerRow instanceof HTMLTableRowElement) || !dataRows.length) return null;

        const shell = createInvestmentShareSection('investment-community-share-section--chart investment-community-share-table-shell');
        const innerShell = document.createElement('div');
        innerShell.className = 'investment-holdings-table-shell';

        const table = document.createElement('table');
        table.className = 'settings-table trade-transactions-table scrollable-data-table investment-holdings-table investment-community-share-holdings-table';

        const thead = document.createElement('thead');
        const sharedHeaderRow = sanitizeInvestmentShareClone(headerRow.cloneNode(true));
        if (!(sharedHeaderRow instanceof HTMLTableRowElement)) return null;
        pruneShareHoldingsRow(sharedHeaderRow);
        if (summaryRow instanceof HTMLTableRowElement) {
            const sharedSummaryRow = sanitizeInvestmentShareClone(summaryRow.cloneNode(true));
            if (sharedSummaryRow instanceof HTMLTableRowElement) {
                adaptShareHoldingsSummaryRow(sharedSummaryRow);
                thead.appendChild(sharedSummaryRow);
            }
        }
        thead.appendChild(sharedHeaderRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        dataRows.forEach((row) => {
            const sharedRow = sanitizeInvestmentShareClone(row.cloneNode(true));
            if (!(sharedRow instanceof HTMLTableRowElement)) return;
            pruneShareHoldingsRow(sharedRow);
            const tickerCell = sharedRow.cells.item(0);
            if (tickerCell instanceof HTMLTableCellElement) {
                const ticker = String(sharedRow.dataset.investmentHoldingsTicker || tickerCell.textContent || '').trim();
                tickerCell.textContent = '';
                tickerCell.appendChild(buildShareTickerCell(ticker));
            }
            Array.from(sharedRow.cells).forEach((cell, index) => {
                if (!(cell instanceof HTMLTableCellElement) || index === 0) return;
                populateShareHoldingsMetricCell(cell);
            });
            tbody.appendChild(sharedRow);
        });
        table.appendChild(tbody);

        innerShell.appendChild(table);
        shell.appendChild(innerShell);
        return shell;
    }

    function buildInvestmentHoldingsShareBody(body) {
        const tableShell = buildInvestmentHoldingsShareTable({ maskSensitive: investmentShareMaskEnabled });
        if (!(tableShell instanceof HTMLElement)) return false;
        body.appendChild(tableShell);
        return true;
    }

    function buildInvestmentMetricsShareBody(body) {
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!(metricsPanel instanceof HTMLElement)) return false;
        const metricsSection = createInvestmentShareSection('investment-community-share-section--chart investment-community-share-section--padded');
        const metricsGrid = sanitizeInvestmentShareClone(metricsPanel.cloneNode(true));
        if (!(metricsGrid instanceof HTMLElement)) return false;
        metricsGrid.classList.add('investment-community-share-metrics-grid');
        body.appendChild(metricsSection);
        metricsSection.appendChild(metricsGrid);
        return true;
    }

    async function buildInvestmentCommunityShareCard() {
        const normalizedView = normalizeInvestmentView(activeInvestmentView);
        const { host, card, body } = createInvestmentShareTemplateFrame(normalizedView);
        if (normalizedView === 'stock_details' && investmentShareMaskEnabled) {
            card.classList.add('is-share-sensitive-masked');
        }

        let rendered = false;
        if (normalizedView === 'stock_details') {
            rendered = buildInvestmentStockDetailsShareBody(body);
        } else if (normalizedView === 'holdings') {
            rendered = buildInvestmentHoldingsShareBody(body);
        } else if (normalizedView === 'metrics') {
            rendered = buildInvestmentMetricsShareBody(body);
        } else {
            rendered = buildInvestmentOverviewShareBody(body);
        }
        if (!rendered) return null;

        card.appendChild(await createInvestmentShareFooter());
        return host;
    }

    function buildInvestmentScreenshotFilename() {
        const timestamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
        const suffix = activeInvestmentView === 'stock_details'
            ? (ensureSelectedInvestmentStockTicker() || 'stock-details').toLowerCase()
            : getInvestmentShareViewLabel(activeInvestmentView).toLowerCase().replace(/\s+/g, '-');
        return `investment-${suffix}-${timestamp}.png`;
    }

    async function ensureInvestmentScreenshotLibrary() {
        if (window.domtoimage?.toBlob) return window.domtoimage;
        if (investmentScreenshotLibraryPromise) return investmentScreenshotLibraryPromise;
        const loadScript = (src, sourceLabel) => new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-investment-screenshot-library="dom-to-image-more"]');
            if (existingScript && existingScript.src === new URL(src, window.location.href).href) {
                existingScript.addEventListener('load', () => resolve(window.domtoimage), { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Failed to load screenshot library.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.investmentScreenshotLibrary = 'dom-to-image-more';
            script.dataset.investmentScreenshotLibrarySource = sourceLabel;
            script.addEventListener('load', () => {
                if (window.domtoimage?.toBlob) {
                    resolve(window.domtoimage);
                    return;
                }
                reject(new Error('Screenshot library loaded without exposing dom-to-image-more.'));
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error('Failed to load screenshot library.'));
            }, { once: true });
            document.head.appendChild(script);
        });
        investmentScreenshotLibraryPromise = loadScript(
            '/static/assets/js/vendor/dom-to-image-more.min.js',
            'local',
        ).catch(() => loadScript(
            'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.6.0/dist/dom-to-image-more.min.js',
            'cdn',
        )).catch((error) => {
            investmentScreenshotLibraryPromise = null;
            throw error;
        });
        return investmentScreenshotLibraryPromise;
    }

    function debugInvestmentShareCaptureTiming(label, startedAt) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        console.debug(`[Investment share capture] ${label}: ${elapsedMs} ms`);
    }

    function waitForInvestmentShareImages(root) {
        const images = Array.from(root.querySelectorAll('img'));
        const pendingImages = images.filter((image) => !image.complete);
        if (!pendingImages.length) return Promise.resolve();
        const imageSettled = Promise.allSettled(pendingImages.map((image) => new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        })));
        const timeout = new Promise((resolve) => window.setTimeout(resolve, 1500));
        return Promise.race([imageSettled, timeout]);
    }

    function withInvestmentShareTimeout(promise, timeoutMs, timeoutMessage) {
        let timeoutId = 0;
        const timeout = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => {
            if (timeoutId) window.clearTimeout(timeoutId);
        });
    }

    async function saveCurrentInvestmentPanelScreenshot() {
        showInvestmentWorkspaceModal({
            title: INVESTMENT_SHARE_RENDER_MODAL_TITLE,
            copy: INVESTMENT_SHARE_RENDER_MODAL_COPY,
            iconClass: INVESTMENT_SHARE_RENDER_MODAL_ICON_CLASS,
            lockClose: true,
        });
        try {
            const captureStartedAt = performance.now();
            await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
            debugInvestmentShareCaptureTiming('after initial frames', captureStartedAt);
            const captureTarget = await buildInvestmentCommunityShareCard();
            debugInvestmentShareCaptureTiming('after card build', captureStartedAt);
            if (!(captureTarget instanceof HTMLElement)) return;
            const domtoimage = await ensureInvestmentScreenshotLibrary();
            debugInvestmentShareCaptureTiming('after screenshot library ready', captureStartedAt);
            document.body.appendChild(captureTarget);
            try {
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                stabilizeInvestmentShareDonutOrbits(captureTarget);
                await waitForInvestmentShareImages(captureTarget);
                debugInvestmentShareCaptureTiming('after image readiness', captureStartedAt);
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                stabilizeInvestmentShareDonutOrbits(captureTarget);
                const captureRect = captureTarget.getBoundingClientRect();
                const blob = await withInvestmentShareTimeout(domtoimage.toBlob(captureTarget, {
                    cacheBust: true,
                    bgcolor: 'transparent',
                    quality: 1,
                    width: Math.max(1, Math.round(captureRect.width)),
                    height: Math.max(1, Math.round(captureRect.height)),
                    style: {
                        transform: 'none',
                    },
                }), 15000, 'Investment screenshot encoding timed out.');
                if (!(blob instanceof Blob)) {
                    throw new Error('Failed to encode screenshot.');
                }
                debugInvestmentShareCaptureTiming('after blob encode', captureStartedAt);
                downloadBlobFile(buildInvestmentScreenshotFilename(), blob);
            } finally {
                captureTarget.remove();
            }
        } finally {
            hideInvestmentLoadingModal({ resetContent: true });
        }
    }

    function bindInvestmentExportButton() {
        if (!exportTransactionsButton || exportTransactionsButton.dataset.bound === '1') return;
        exportTransactionsButton.dataset.bound = '1';
        exportTransactionsButton.addEventListener('click', () => {
            const exportPayload = buildInvestmentMarkdownExport();
            if (!exportPayload) return;
            downloadMarkdownFile(exportPayload.filename, exportPayload.markdown);
        });
        if (shareMaskButton && shareMaskButton.dataset.bound !== '1') {
            shareMaskButton.dataset.bound = '1';
            syncInvestmentShareMaskButtonState();
            shareMaskButton.addEventListener('click', () => {
                investmentShareMaskEnabled = !investmentShareMaskEnabled;
                syncInvestmentShareMaskState();
            });
        }
        if (shareCaptureButton && shareCaptureButton.dataset.bound !== '1') {
            shareCaptureButton.dataset.bound = '1';
            shareCaptureButton.addEventListener('click', async () => {
                if (shareCaptureButton.getAttribute('aria-busy') === 'true') return;
                shareCaptureButton.setAttribute('aria-busy', 'true');
                try {
                    await saveCurrentInvestmentPanelScreenshot();
                } catch (error) {
                    console.error('Failed to save investment screenshot.', error);
                } finally {
                    shareCaptureButton.removeAttribute('aria-busy');
                }
            });
        }
        syncInvestmentShareMaskState();
    }

    function bindHoldingsLogoFallbacks(container) {
        if (!container) return;
        container.querySelectorAll('[data-investment-logo-image]').forEach((logo) => {
            if (logo.dataset.logoFallbackBound === '1') return;
            logo.dataset.logoFallbackBound = '1';
            const row = logo.closest('.ticker-identity-row');
            const placeholder = row?.querySelector('.ticker-identity-logo-placeholder');
            const logoUrls = (() => {
                try {
                    return JSON.parse(logo.dataset.logoUrl || '[]');
                } catch {
                    return logo.dataset.logoUrl || '';
                }
            })();
            const ticker = logo.dataset.ticker || '';
            syncInvestmentTickerLogoAsset(
                logo instanceof HTMLImageElement ? logo : null,
                placeholder instanceof HTMLElement ? placeholder : null,
                logoUrls,
                ticker ? `${ticker} logo` : '',
            );
        });
    }

    function getInvestmentScrollIntentBucket(bucketName) {
        return investmentScrollIntentState[bucketName] || null;
    }

    function bindInvestmentScrollIntent(container, bucketName) {
        if (!(container instanceof HTMLElement) || !bucketName || container.dataset.investmentScrollIntentBound === '1') {
            return container;
        }
        container.dataset.investmentScrollIntentBound = '1';
        container.addEventListener('scroll', () => {
            const bucket = getInvestmentScrollIntentBucket(bucketName);
            if (!bucket) return;
            if (Date.now() < bucket.ignoreUntil) return;
            bucket.suppressUntil = Date.now() + INVESTMENT_MANUAL_SCROLL_SUPPRESS_MS;
        }, { passive: true });
        return container;
    }

    function getInvestmentHistoryScrollContainer() {
        return bindInvestmentScrollIntent(
            investmentHistorySurface?.querySelector('.investment-history-table-scroll'),
            'history',
        );
    }

    function getInvestmentHistoryTableBody() {
        return investmentHistorySurface?.querySelector('.investment-history-table-scroll #investment_history');
    }

    function getInvestmentHistoryRowsByLedgerNos(ledgerNos) {
        const scrollContainer = getInvestmentHistoryScrollContainer();
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => {
                const selector = `tr[data-investment-history-row="${CSS.escape(String(ledgerNo))}"]`;
                return scrollContainer?.querySelector(selector) || document.querySelector(selector);
            })
            .filter(Boolean);
    }

    function getInvestmentHistoryRowById(rowId) {
        const normalizedRowId = String(rowId || '').trim();
        if (!normalizedRowId) return null;
        return getInvestmentHistoryScrollContainer()?.querySelector(`#${CSS.escape(normalizedRowId)}`)
            || document.getElementById(normalizedRowId);
    }

    function getInvestmentStockDetailsScrollContainer() {
        return bindInvestmentScrollIntent(document.querySelector('.investment-stock-details-table-scroll'), 'stockDetails');
    }

    function getInvestmentStockDetailRowsByLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => document.querySelector(`tr[data-investment-stock-detail-ledger="${CSS.escape(String(ledgerNo))}"]`))
            .filter(Boolean);
    }

    function clearInvestmentHistoryHighlights() {
        activeInvestmentHistoryRowIds.forEach((rowId) => {
            const row = getInvestmentHistoryRowById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        activeInvestmentHistoryRowIds = [];
    }

    function clearInvestmentStockDetailHighlights() {
        activeInvestmentStockDetailRowIds.forEach((rowId) => {
            const row = document.getElementById(rowId);
            if (!row) return;
            row.classList.remove('is-metric-hover-active');
            row.classList.remove('is-metric-hover-target');
        });
        activeInvestmentStockDetailRowIds = [];
    }

    function getElementScrollOffsetWithinContainer(element, scrollContainer) {
        if (!(element instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return 0;
        const elementRect = element.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        return scrollContainer.scrollTop + (elementRect.top - containerRect.top);
    }

    function markInvestmentProgrammaticScroll(bucketName, behavior = 'auto') {
        const bucket = getInvestmentScrollIntentBucket(bucketName);
        if (!bucket) return;
        const guardMs = behavior === 'smooth'
            ? INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS
            : Math.min(220, INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS);
        bucket.ignoreUntil = Date.now() + guardMs;
    }

    function shouldSuppressInvestmentAutoScroll(bucketName) {
        const bucket = getInvestmentScrollIntentBucket(bucketName);
        return Boolean(bucket && Date.now() < bucket.suppressUntil);
    }

    // Code version: v0.4.0.0
    function scrollInvestmentHistoryRowsIntoView(rows, behavior = 'smooth') {
        const normalizedRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        if (!normalizedRows.length) return;
        const sortedRows = [...normalizedRows].sort((leftRow, rightRow) => leftRow.offsetTop - rightRow.offsetTop);
        const firstRow = sortedRows[0];
        const scrollContainer = getInvestmentHistoryScrollContainer();
        if (scrollContainer) {
            if (shouldSuppressInvestmentAutoScroll('history')) return;
            const edgePadding = Math.max(12, Math.min(24, Math.round(scrollContainer.clientHeight * 0.08)));
            const firstRowTop = getElementScrollOffsetWithinContainer(firstRow, scrollContainer);
            const lastRowBottom = Math.max(...sortedRows.map((row) => getElementScrollOffsetWithinContainer(row, scrollContainer) + row.offsetHeight));
            const visibleTop = scrollContainer.scrollTop + edgePadding;
            const visibleBottom = scrollContainer.scrollTop + scrollContainer.clientHeight - edgePadding;
            const isGroupAlreadyVisible = firstRowTop >= visibleTop && lastRowBottom <= visibleBottom;
            if (isGroupAlreadyVisible) return;
            const targetTop = firstRowTop - edgePadding;
            markInvestmentProgrammaticScroll('history', behavior);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        firstRow.scrollIntoView({ block: 'nearest', behavior });
    }

    function scrollInvestmentStockDetailRowIntoView(row, behavior = 'smooth') {
        if (!row) return;
        const scrollContainer = getInvestmentStockDetailsScrollContainer();
        if (scrollContainer) {
            if (shouldSuppressInvestmentAutoScroll('stockDetails')) return;
            const rowOffset = row.offsetTop - scrollContainer.offsetTop;
            const targetTop = rowOffset - (scrollContainer.clientHeight / 2) + (row.clientHeight / 2);
            markInvestmentProgrammaticScroll('stockDetails', behavior);
            scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior });
            return;
        }
        row.scrollIntoView({ block: 'center', behavior });
    }

    function activateInvestmentHistoryRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        const rows = getInvestmentHistoryRowsByLedgerNos(ledgerNos);
        if (!rows.length && scroll) {
            const targetPage = getInvestmentHistoryPageForLedgerNos(ledgerNos);
            if (targetPage > 0 && targetPage !== investmentHistoryCurrentPage) {
                investmentHistoryCurrentPage = targetPage;
                renderInvestmentHistoryTableRows(investmentProcessedTransactionsCache, investmentChartPointsCache);
            }
        }
        const resolvedRows = getInvestmentHistoryRowsByLedgerNos(ledgerNos);
        if (!resolvedRows.length) return;
        clearInvestmentHistoryHighlights();
        resolvedRows.forEach((row) => {
            row.classList.remove('is-metric-hover-target');
            void row.offsetWidth;
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        activeInvestmentHistoryRowIds = resolvedRows
            .map((row) => String(row.id || '').trim())
            .filter(Boolean);
        if (scroll) {
            scrollInvestmentHistoryRowsIntoView(resolvedRows, behavior);
        }
    }

    function activateInvestmentStockDetailRows(ledgerNos, { behavior = 'smooth', scroll = true } = {}) {
        const rows = getInvestmentStockDetailRowsByLedgerNos(ledgerNos);
        if (!rows.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        clearInvestmentStockDetailHighlights();
        rows.forEach((row, index) => {
            if (!row.id) {
                row.id = `investment_stock_detail_row_${ledgerNos[index]}`;
            }
            row.classList.remove('is-metric-hover-target');
            void row.offsetWidth;
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        activeInvestmentStockDetailRowIds = rows.map((row) => row.id).filter(Boolean);
        if (scroll) {
            scrollInvestmentStockDetailRowIntoView(rows[0], behavior);
        }
    }

    // Code version: v0.4.0.0
    function syncInvestmentStockDetailPreviewRows(ledgerNos, { behavior = 'auto', scroll = false } = {}) {
        const normalizedLedgerNos = Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)));
        if (!normalizedLedgerNos.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        const matchingRows = getInvestmentStockDetailRowsByLedgerNos(normalizedLedgerNos);
        if (!matchingRows.length) {
            clearInvestmentStockDetailHighlights();
            return;
        }
        activateInvestmentStockDetailRows(normalizedLedgerNos, { behavior, scroll });
    }

    function getLatestHistoryRowForTicker(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        return document.querySelector(`tr[data-investment-history-ticker="${CSS.escape(normalizedTicker)}"]`);
    }

    function getHistoryRowsForLedgerDate(rawDate) {
        const normalizedDate = String(rawDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        if (!normalizedDate) return [];
        return Array.from(document.querySelectorAll(`tr[data-investment-history-date="${CSS.escape(normalizedDate)}"]`));
    }

    function normalizeInvestmentLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .sort((left, right) => left - right);
    }

    function getInvestmentProcessedTransactionByLedgerNo(ledgerNo) {
        const normalizedLedgerNo = Number(ledgerNo);
        if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return null;
        if (!Array.isArray(investmentProcessedTransactionsCache)) return null;
        return investmentProcessedTransactionsCache.find((txn) => Number(txn?.ledger_no) === normalizedLedgerNo) || null;
    }

    function getInvestmentLedgerDateByLedgerNo(ledgerNo) {
        return normalizeLedgerDate(getInvestmentProcessedTransactionByLedgerNo(ledgerNo)?.date);
    }

    function getFirstStockDetailLedgerNoForDate(rawDate) {
        const normalizedDate = normalizeLedgerDate(rawDate);
        const activeTicker = getInvestmentCanonicalTicker(selectedInvestmentStockTicker || '');
        if (!normalizedDate || !activeTicker || !Array.isArray(investmentProcessedTransactionsCache)) return 0;
        const match = investmentProcessedTransactionsCache.find((txn) => (
            normalizeLedgerDate(txn?.date) === normalizedDate
            && getInvestmentCanonicalTicker(txn?.ticker) === activeTicker
        ));
        const ledgerNo = Number(match?.ledger_no);
        return Number.isFinite(ledgerNo) && ledgerNo > 0 ? ledgerNo : 0;
    }

    function syncInvestmentHoverLinkedViews({
        hoverTicker = '',
        hoverLedgerNo = 0,
        historyLedgerNos = [],
        stockDetailLedgerNos = [],
        interactionLedgerNo = 0,
        historyBehavior = 'auto',
        historyScroll = false,
        stockDetailBehavior = 'auto',
        stockDetailScroll = false,
    } = {}) {
        const normalizedHistoryLedgerNos = normalizeInvestmentLedgerNos(historyLedgerNos);
        const normalizedStockDetailLedgerNos = normalizeInvestmentLedgerNos(stockDetailLedgerNos);
        const normalizedInteractionLedgerNo = Number(interactionLedgerNo);
        const normalizedHoverLedgerNo = Number(hoverLedgerNo);
        const focusLedgerNo = (Number.isFinite(normalizedHoverLedgerNo) && normalizedHoverLedgerNo > 0 ? normalizedHoverLedgerNo : 0)
            || normalizedStockDetailLedgerNos[0]
            || normalizedHistoryLedgerNos[0]
            || (Number.isFinite(normalizedInteractionLedgerNo) && normalizedInteractionLedgerNo > 0 ? normalizedInteractionLedgerNo : 0);
        syncHoldingsChartHoverState(hoverTicker, focusLedgerNo);
        if (normalizedHistoryLedgerNos.length) {
            activateInvestmentHistoryRows(normalizedHistoryLedgerNos, {
                behavior: historyBehavior,
                scroll: historyScroll,
            });
        } else {
            clearInvestmentHistoryHighlights();
        }
        if (normalizedStockDetailLedgerNos.length) {
            syncInvestmentStockDetailPreviewRows(normalizedStockDetailLedgerNos, {
                behavior: stockDetailBehavior,
                scroll: stockDetailScroll,
            });
        } else {
            clearInvestmentStockDetailHighlights();
        }
    }

    function setInvestmentHoverContainerPayload(container, payload = null) {
        if (!(container instanceof HTMLElement)) return;
        if (!payload || typeof payload !== 'object') {
            delete container.dataset.investmentHoverPayload;
            return;
        }
        const normalizedPayload = {
            hoverTicker: normalizeInvestmentTicker(payload.hoverTicker || ''),
            hoverLedgerNo: Number.isFinite(Number(payload.hoverLedgerNo)) && Number(payload.hoverLedgerNo) > 0
                ? Number(payload.hoverLedgerNo)
                : 0,
            historyLedgerNos: normalizeInvestmentLedgerNos(payload.historyLedgerNos),
            stockDetailLedgerNos: normalizeInvestmentLedgerNos(payload.stockDetailLedgerNos),
            interactionLedgerNo: Number.isFinite(Number(payload.interactionLedgerNo)) && Number(payload.interactionLedgerNo) > 0
                ? Number(payload.interactionLedgerNo)
                : 0,
            historyBehavior: payload.historyBehavior === 'smooth' ? 'smooth' : 'auto',
            historyScroll: Boolean(payload.historyScroll),
            stockDetailBehavior: payload.stockDetailBehavior === 'smooth' ? 'smooth' : 'auto',
            stockDetailScroll: Boolean(payload.stockDetailScroll),
        };
        container.dataset.investmentHoverPayload = JSON.stringify(normalizedPayload);
    }

    function getInvestmentHoverContainerPayload(container) {
        if (!(container instanceof HTMLElement)) return null;
        const rawPayload = String(container.dataset.investmentHoverPayload || '').trim();
        if (!rawPayload) return null;
        try {
            const payload = JSON.parse(rawPayload);
            return {
                hoverTicker: normalizeInvestmentTicker(payload?.hoverTicker || ''),
                hoverLedgerNo: Number(payload?.hoverLedgerNo) || 0,
                historyLedgerNos: normalizeInvestmentLedgerNos(payload?.historyLedgerNos),
                stockDetailLedgerNos: normalizeInvestmentLedgerNos(payload?.stockDetailLedgerNos),
                interactionLedgerNo: Number(payload?.interactionLedgerNo) || 0,
                historyBehavior: payload?.historyBehavior === 'smooth' ? 'smooth' : 'auto',
                historyScroll: Boolean(payload?.historyScroll),
                stockDetailBehavior: payload?.stockDetailBehavior === 'smooth' ? 'smooth' : 'auto',
                stockDetailScroll: Boolean(payload?.stockDetailScroll),
            };
        } catch (error) {
            delete container.dataset.investmentHoverPayload;
            return null;
        }
    }

    function clearInvestmentChartLinkedHoverState() {
        syncHoldingsChartHoverState('', 0);
        clearInvestmentStockDetailHighlights();
        clearInvestmentHistoryHighlights();
    }

    function bindInvestmentHoverContainerPersistence(container) {
        if (!(container instanceof HTMLElement) || container.dataset.investmentHoverContainerBound === '1') return;
        container.dataset.investmentHoverContainerBound = '1';
        container.addEventListener('mouseenter', () => {
            const payload = getInvestmentHoverContainerPayload(container);
            if (!payload) return;
            syncInvestmentHoverLinkedViews(payload);
        });
        container.addEventListener('mouseleave', () => {
            clearInvestmentChartLinkedHoverState();
        });
    }

    function renderMetricCards(metricDefinitions, metricValues) {
        return metricDefinitions.map((definition) => `
            <div class="trade-metric-card trade-metric-card--value-align-end">
                <span class="trade-metric-label">${definition.label}</span>
                ${renderMetricValueWithTooltip({
                    key: definition.key,
                    value: definition.formatValue
                        ? definition.formatValue(metricValues)
                        : formatAmount(metricValues?.[definition.valueKey]),
                    valueClass: typeof definition.valueClass === 'function'
                        ? definition.valueClass(metricValues)
                        : (definition.valueClass || ''),
                    summary: definition.summary,
                    rows: metricValues?.[definition.rowsKey],
                    liveField: definition.liveField,
                    liveNumber: definition.liveNumberKey
                        ? metricValues?.[definition.liveNumberKey]
                        : metricValues?.[definition.valueKey],
                })}
            </div>
        `).join('');
    }

    function getTotalOffshoreGainMetrics(holdingsSummaryMetrics, brokerBenefitMetrics) {
        const cumulativePnl = Number(holdingsSummaryMetrics?.cumulativePnl) || 0;
        const cashBenefitIncome = Number(brokerBenefitMetrics?.couponRebateIncome) || 0;
        const cashRewardIncome = Number(brokerBenefitMetrics?.cashRewardIncome) || 0;
        const kolRewardIncome = Number(brokerBenefitMetrics?.kolRewardIncome) || 0;
        return {
            totalOffshoreGain: cumulativePnl + cashBenefitIncome + cashRewardIncome + kolRewardIncome,
            totalOffshoreGainRows: Array.from(new Set([
                ...(Array.isArray(holdingsSummaryMetrics?.cumulativePnlRows) ? holdingsSummaryMetrics.cumulativePnlRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.couponRebateHkdRows) ? brokerBenefitMetrics.couponRebateHkdRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.couponRebateUsdRows) ? brokerBenefitMetrics.couponRebateUsdRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.cashRewardHkdRows) ? brokerBenefitMetrics.cashRewardHkdRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.cashRewardUsdRows) ? brokerBenefitMetrics.cashRewardUsdRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.kolRewardRows) ? brokerBenefitMetrics.kolRewardRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.stockGrantRealizedRows) ? brokerBenefitMetrics.stockGrantRealizedRows : []),
                ...(Array.isArray(brokerBenefitMetrics?.stockGrantUnrealizedRows) ? brokerBenefitMetrics.stockGrantUnrealizedRows : []),
            ])),
        };
    }

    function renderFundingMetricCards(fundingMetrics, holdingsSummaryMetrics, brokerBenefitMetrics) {
        const offshoreGainMetrics = getTotalOffshoreGainMetrics(holdingsSummaryMetrics, brokerBenefitMetrics);
        return [
            renderMetricCards(OFFSHORE_GAIN_METRIC_DEFINITIONS, offshoreGainMetrics),
            renderMetricCards(HOLDINGS_SUMMARY_METRIC_DEFINITIONS, holdingsSummaryMetrics),
            renderMetricCards(FUNDING_METRIC_DEFINITIONS, fundingMetrics),
            renderMetricCards(BROKER_BENEFIT_METRIC_DEFINITIONS, brokerBenefitMetrics),
        ].join('');
    }

    function resetInvestmentDashboard() {
        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const stockDetailsPanel = document.getElementById(INVESTMENT_STOCK_DETAILS_PANEL_ID);
        const chartContainer = document.getElementById('investment_equity_chart');

        selectedInvestmentStockTicker = '';
        investmentProcessedTransactionsCache = [];
        investmentTickerSummariesCache = [];
        refreshInvestmentAvailableBrokerCodes();
        clearInvestmentStockDetailHighlights();
        if (holdingsPanel) {
            holdingsPanel.innerHTML = renderHoldingsTable([], {}, 0);
        }
        if (metricsPanel) {
            metricsPanel.innerHTML = renderFundingMetricCards(
                getUsdFundingMetrics([]),
                getHoldingsSummaryMetrics([], {}, 0),
                getBrokerBenefitMetrics([], {}, 0)
            );
            bindInvestmentMetricTooltipInteractions(metricsPanel);
        }
        if (stockDetailsPanel) {
            stockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
        }
        if (investmentStockDetailsTableHost instanceof HTMLElement) {
            investmentStockDetailsTableHost.innerHTML = '';
            syncInvestmentStockDetailsTableVisibility();
        }
        if (chartContainer) {
            chartContainer.innerHTML = '';
        }
    }

    function syncImportValidationState() {
        const transactionFile = transactionsCsvInput?.files?.[0];
        const positionsFile = positionsCsvInput?.files?.[0];
        const selectedBroker = getSelectedInvestmentImportBroker();
        const isIbkr = selectedBroker === 'ibkr';
        const ibkrImportMode = getSelectedIbkrImportMode();
        const isIbkrCsv = isIbkr && ibkrImportMode === 'csv';
        const isIbkrFlex = isIbkr && ibkrImportMode === 'flex';
        const isIbkrGainskeeper = isIbkr && ibkrImportMode === 'gainskeeper';
        const isLongbridgeHk = selectedBroker === 'longbridge_hk';
        const isLongbridgeSg = selectedBroker === 'longbridge_sg';
        const isFutuhk = selectedBroker === 'futuhk';
        const isHsbc = selectedBroker === 'hsbc';
        const hsbcImportMode = getSelectedHsbcImportMode();
        const isHsbcPaste = isHsbc && hsbcImportMode === 'paste';
        const isHsbcStatementPdf = isHsbc && hsbcImportMode === 'statement_pdf';
        const isSchwab = selectedBroker === 'schwab';
        const isTigertrade = selectedBroker === 'tigertrade';
        const isUsmartHk = selectedBroker === 'usmart_hk';
        const futuhkStatementFiles = getSelectedFutuStatementPdfFiles();
        const hsbcStatementFiles = getSelectedStatementPdfFiles(hsbcStatementPdfsInput);
        const tigertradeStatementFiles = getSelectedStatementPdfFiles(tigertradeStatementPdfsInput);
        const usmartHkStatementFiles = getSelectedStatementPdfFiles(usmartHkStatementPdfsInput);
        const longbridgeSgFundDetailsFile = longbridgeSgFundDetailsInput?.files?.[0];
        const longbridgeSgHistoryOrdersFile = longbridgeSgHistoryOrdersInput?.files?.[0];
        const transactionReady = isIbkrCsv ? isLikelyTransactionHistoryFile(transactionFile) : false;
        const positionsReady = isIbkrCsv ? isLikelyPositionsFile(positionsFile) : false;
        const gainskeeperFiles = gainskeeperFilesInput?.files ? Array.from(gainskeeperFilesInput.files) : [];
        const gainskeeperReady = isIbkrGainskeeper
            && gainskeeperFiles.length > 0
            && gainskeeperFiles.every((file) => isLikelyGainskeeperFile(file));
        const hsbcPortfolioText = String(hsbcPortfolioTextInput?.value || '').trim();
        const hsbcOrderStatusText = String(hsbcOrderStatusTextInput?.value || '').trim();
        const hsbcCashAccountText = String(hsbcCashAccountTextInput?.value || '').trim();
        const longbridgeHkFundDetailsFile = longbridgeHkFundDetailsInput?.files?.[0];
        const longbridgeHkHistoryOrdersFile = longbridgeHkHistoryOrdersInput?.files?.[0];
        const longbridgeHkFilesReady = isLongbridgeHk && isLikelyLongbridgeSgFundDetailsFile(longbridgeHkFundDetailsFile) && isLikelyLongbridgeSgHistoryOrdersFile(longbridgeHkHistoryOrdersFile);
        const longbridgeSgFundDetailsReady = isLongbridgeSg && isLikelyLongbridgeSgFundDetailsFile(longbridgeSgFundDetailsFile);
        const longbridgeSgHistoryOrdersReady = isLongbridgeSg && isLikelyLongbridgeSgHistoryOrdersFile(longbridgeSgHistoryOrdersFile);
        const hsbcPortfolioReady = isHsbcPaste && isLikelyHsbcPortfolioText(hsbcPortfolioText);
        const hsbcOrderStatusReady = isHsbcPaste && isLikelyHsbcOrderStatusText(hsbcOrderStatusText);
        const hsbcCashAccountReady = isHsbcPaste && isLikelyHsbcCashAccountText(hsbcCashAccountText);
        const hsbcStatementsReady = isHsbcStatementPdf
            && hsbcStatementFiles.length > 0
            && hsbcStatementFiles.every((file) => isLikelyPdfFile(file));
        const futuhkStatementsReady = isFutuhk
            && futuhkStatementFiles.length > 0
            && futuhkStatementFiles.every((file) => isLikelyFutuStatementPdf(file));
        const schwabCsvFile = schwabTransactionsCsvInput?.files?.[0];
        const schwabReady = isSchwab && !!schwabCsvFile;
        const tigertradeStatementsReady = isTigertrade
            && tigertradeStatementFiles.length > 0
            && tigertradeStatementFiles.every((file) => isLikelyPdfFile(file));
        const usmartHkStatementsReady = isUsmartHk
            && usmartHkStatementFiles.length > 0
            && usmartHkStatementFiles.every((file) => isLikelyPdfFile(file));
        const brokerReady = SUPPORTED_INVESTMENT_IMPORT_BROKERS.has(selectedBroker);
        const importReady = brokerReady && (
            (isIbkrCsv && transactionReady && positionsReady)
            || isIbkrFlex
            || gainskeeperReady
            || (isLongbridgeHk && Boolean(longbridgeHkFilesReady))
            || (isLongbridgeSg && Boolean(longbridgeSgFundDetailsReady) && Boolean(longbridgeSgHistoryOrdersReady))
            || (isFutuhk && Boolean(futuhkStatementsReady))
            || (isHsbcPaste && Boolean(hsbcCashAccountReady) && Boolean(hsbcPortfolioReady) && Boolean(hsbcOrderStatusReady))
            || (isHsbcStatementPdf && Boolean(hsbcStatementsReady))
            || (isSchwab && Boolean(schwabReady))
            || (isTigertrade && Boolean(tigertradeStatementsReady))
            || (isUsmartHk && Boolean(usmartHkStatementsReady))
        );

        setImportStatusIcon(transactionsCsvStatus, transactionReady);
        setImportStatusIcon(positionsCsvStatus, positionsReady);
        setImportStatusIcon(gainskeeperFilesStatus, gainskeeperReady);

        setImportStatusIcon(longbridgeSgFundDetailsStatus, Boolean(longbridgeSgFundDetailsReady));
        setImportStatusIcon(longbridgeSgHistoryOrdersStatus, Boolean(longbridgeSgHistoryOrdersReady));
        const longbridgeHkFundDetailsReady = !!(longbridgeHkFundDetailsInput && longbridgeHkFundDetailsInput.files && longbridgeHkFundDetailsInput.files.length > 0);
        const longbridgeHkHistoryOrdersReady = !!(longbridgeHkHistoryOrdersInput && longbridgeHkHistoryOrdersInput.files && longbridgeHkHistoryOrdersInput.files.length > 0);
        setImportStatusIcon(longbridgeHkFundDetailsStatus, longbridgeHkFundDetailsReady);
        setImportStatusIcon(longbridgeHkHistoryOrdersStatus, longbridgeHkHistoryOrdersReady);
        setImportStatusIcon(hsbcPortfolioTextStatus, Boolean(hsbcPortfolioReady));
        setImportStatusIcon(hsbcOrderStatusTextStatus, Boolean(hsbcOrderStatusReady));
        setImportStatusIcon(hsbcCashAccountTextStatus, Boolean(hsbcCashAccountReady));
        setImportStatusIcon(hsbcStatementPdfsStatus, Boolean(hsbcStatementsReady));
        setImportStatusIcon(futuhkStatementPdfsStatus, Boolean(futuhkStatementsReady));
        setImportStatusIcon(schwabTransactionsCsvStatus, Boolean(schwabReady));
        setImportStatusIcon(tigertradeStatementPdfsStatus, Boolean(tigertradeStatementsReady));
        setImportStatusIcon(usmartHkStatementPdfsStatus, Boolean(usmartHkStatementsReady));

        const submitButton = investmentForm?.querySelector('button[type="submit"]');
        syncActionButtonState(submitButton, {
            disabled: !importReady,
            pending: investmentImportInFlight,
        });
    }

    function syncInvestmentImportContainerHeight() {
        if (!(formContainer instanceof HTMLElement) || formContainer.style.display === 'none' || !investmentHistorySurface) {
            return;
        }
        const surfaceRect = investmentHistorySurface.getBoundingClientRect();
        const toggleRect = toggleBtn instanceof HTMLElement ? toggleBtn.getBoundingClientRect() : null;
        const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
        if (!Number.isFinite(surfaceRect.width) || surfaceRect.width <= 0 || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
            formContainer.style.removeProperty('top');
            formContainer.style.removeProperty('left');
            formContainer.style.removeProperty('right');
            formContainer.style.removeProperty('max-height');
            return;
        }
        const edgeGap = window.innerWidth <= 767 ? 8 : 10;
        // Compute left/right from the surface rect so the form width always obeys the mother container (responds to sidebar etc.)
        const leftInset = Math.max(edgeGap, Math.floor(surfaceRect.left) + edgeGap);
        const rightInset = Math.max(edgeGap, Math.floor(viewportWidth - surfaceRect.right) + edgeGap);
        let topInset = edgeGap;
        if (toggleRect) {
            topInset = Math.max(topInset, Math.floor(toggleRect.bottom) + edgeGap);
        } else {
            topInset = Math.max(topInset, 42);
        }
        const availableHeight = Math.max(80, viewportHeight - topInset - edgeGap);
        formContainer.style.top = `${topInset}px`;
        formContainer.style.left = `${leftInset}px`;
        formContainer.style.right = `${rightInset}px`;
        formContainer.style.maxHeight = `${availableHeight}px`;
    }

    function openInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        clearImportFeedback();
        formContainer.style.display = 'flex';
        formContainer.scrollTop = 0;
        syncInvestmentFormLayout();
        syncInvestmentImportContainerHeight();
        // Re-ensure the broker dropdown shared select is fully bound and labels synced
        // when the form becomes visible. The shared binder is idempotent; preserving
        // its bound flag avoids stacking duplicate click/change handlers.
        if (typeof window.repairSidebarControlBindings === 'function') {
            window.repairSidebarControlBindings();
        }
        if (investmentImportBrokerSelect) {
            investmentImportBrokerSelect.dispatchEvent(new Event('change', {bubbles: true}));
        }
        setTimeout(() => {
            formContainer.style.opacity = '1';
            formContainer.style.transform = 'scale(1)';
            window.setTimeout(syncInvestmentImportContainerHeight, 180);
            window.setTimeout(syncInvestmentImportContainerHeight, 360);
        }, 50);
        toggleIcon.classList.add('is-minus');
        toggleBtn.setAttribute('aria-label', 'Hide broker import or sync form');
    }

    function closeInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        formContainer.style.opacity = '0';
        formContainer.style.transform = 'scale(0.98)';
        // ensure any open shared selects (e.g. broker dropdown) inside the form are closed so fixed popovers don't linger
        const importBrokerField = formContainer.querySelector('[data-shared-select-field]');
        if (importBrokerField instanceof HTMLElement) {
            importBrokerField.classList.remove('is-open');
            const dd = importBrokerField.querySelector('[data-shared-select-dropdown]');
            if (dd instanceof HTMLElement) {
                dd.hidden = true;
                dd.style.position = '';
                dd.style.left = '';
                dd.style.top = '';
                dd.style.bottom = '';
                dd.style.right = '';
                dd.style.width = '';
                dd.style.minWidth = '';
                dd.style.maxHeight = '';
                dd.style.maxWidth = '';
                dd.style.zIndex = '';
                dd.style.overflowY = '';
                dd.style.overscrollBehavior = '';
            }
            const tr = importBrokerField.querySelector('[data-shared-select-trigger]');
            if (tr instanceof HTMLElement) tr.setAttribute('aria-expanded', 'false');
        }
        investmentFormHideTimer = window.setTimeout(() => {
            formContainer.style.display = 'none';
            formContainer.style.removeProperty('top');
            formContainer.style.removeProperty('left');
            formContainer.style.removeProperty('right');
            formContainer.style.removeProperty('max-height');
            syncInvestmentFormLayout();
            investmentFormHideTimer = null;
        }, 400);
        toggleIcon.classList.remove('is-minus');
        toggleBtn.setAttribute('aria-label', 'Import or sync broker activity');
    }

    function buildInvestmentRequestOptions(overrides = {}) {
        const headers = {
            'Cache-Control': 'no-cache',
            ...(overrides.headers || {}),
        };
        return {
            credentials: 'same-origin',
            cache: 'no-store',
            ...overrides,
            headers,
        };
    }

    async function fetchInvestmentData() {
        reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'starting transactions fetch', {
            pathname: window.location.pathname,
            search: window.location.search,
            visibilityState: document.visibilityState,
        });
        let response;
        try {
            response = await fetch('/api/investment/transactions', buildInvestmentRequestOptions());
        } catch (error) {
            reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions fetch failed before response', {
                pathname: window.location.pathname,
                search: window.location.search,
                visibilityState: document.visibilityState,
                errorName: error?.name || '',
                errorMessage: error?.message || '',
            });
            throw error;
        }
        reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions response received', {
            status: response.status,
            ok: response.ok,
            visibilityState: document.visibilityState,
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions payload reported failure', {
                status: response.status,
                ok: response.ok,
                success: data.success,
                error: data.error || '',
            });
            throw new Error(data.error || `Failed to load investment data: ${response.status}`);
        }
        reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions payload rendered successfully', {
            transactionCount: Array.isArray(data.transactions) ? data.transactions.length : -1,
            success: data.success,
        });
        window.ANTIGRAVITY_INVESTMENT_DATA = data;
        const valuationStatus = await renderTransactionTable(data.transactions || []);
        scheduleInvestmentSegmentedPillUpdate();
        return { data, valuationStatus };
    }

    bindInvestmentHistoryPagination();
    initInvestmentViewTabs();
    initInvestmentDummyDonut();
    mountInvestmentBrokerFilterHeaders();
    bindInvestmentExportButton();
    syncInvestmentImportMode();
    syncHsbcPasteDisplaySummaries();
    syncImportValidationState();
    // Re-force shared select refresh (the broker dropdown uses the backtest-shared-select machinery).
    // The binder is idempotent; keeping the bound flag prevents duplicate handlers from fighting.
    if (typeof window.repairSidebarControlBindings === 'function') {
        window.repairSidebarControlBindings();
    }
    // Force a change event on the broker native select so shared-select label/logo + import mode sync run.
    if (investmentImportBrokerSelect) {
        investmentImportBrokerSelect.dispatchEvent(new Event('change', {bubbles: true}));
    }
    [transactionsCsvInput, positionsCsvInput, gainskeeperFilesInput, futuhkStatementPdfsInput, hsbcStatementPdfsInput, tigertradeStatementPdfsInput, usmartHkStatementPdfsInput, longbridgeSgFundDetailsInput, longbridgeSgHistoryOrdersInput, longbridgeHkFundDetailsInput, longbridgeHkHistoryOrdersInput, investmentImportBrokerSelect, schwabTransactionsCsvInput].forEach((input) => {
        if (input) {
            input.addEventListener('change', () => {
                clearImportFeedback();
                if (input === investmentImportBrokerSelect) {
                    syncInvestmentImportMode();
                }
                syncImportValidationState();
                syncInvestmentImportContainerHeight();
            });
        }
    });
    document.querySelectorAll('input[name="ibkr_import_mode"]').forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        input.addEventListener('change', () => {
            clearImportFeedback();
            syncInvestmentImportMode();
            syncImportValidationState();
            syncInvestmentImportContainerHeight();
        });
    });
    document.querySelectorAll('input[name="hsbc_import_mode"]').forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        input.addEventListener('change', () => {
            clearImportFeedback();
            syncInvestmentImportMode();
            syncImportValidationState();
            syncInvestmentImportContainerHeight();
        });
    });
    [hsbcCashAccountTextInput, hsbcPortfolioTextInput, hsbcOrderStatusTextInput].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => {
            clearImportFeedback();
            syncHsbcPasteDisplaySummaries();
            syncImportValidationState();
        });
    });
    [
        ['cash', hsbcCashAccountPasteButton],
        ['portfolio', hsbcPortfolioTextPasteButton],
        ['order', hsbcOrderStatusPasteButton],
    ].forEach(([kind, button]) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('click', () => {
            pasteHsbcClipboardIntoField(kind);
        });
    });
    window.addEventListener('resize', syncInvestmentImportContainerHeight);
    window.visualViewport?.addEventListener('resize', syncInvestmentImportContainerHeight);
    window.addEventListener('scroll', syncInvestmentImportContainerHeight, { passive: true });

    function syncInvestmentFormLayout() {
        if (!formContainer || !historyTable || !parentSection) return;
        historyTable.style.transform = 'translateY(0)';
        parentSection.style.paddingBottom = '20px';
    }

    // Toggle form visibility
    const parentSection = formContainer.closest('.chart-surface');
    const toggleIcon = document.getElementById('toggle_form_icon');
    if (toggleBtn && formContainer && parentSection && toggleIcon) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = formContainer.style.display === 'flex';
            if (isVisible) {
                closeInvestmentImportForm();
            } else {
                openInvestmentImportForm();
            }
        });

        const handleInvestmentLayoutChange = () => {
            syncInvestmentFormLayout();
        };

        window.addEventListener('resize', handleInvestmentLayoutChange);

        if (window.ResizeObserver) {
            const investmentFormResizeObserver = new ResizeObserver(handleInvestmentLayoutChange);
            investmentFormResizeObserver.observe(formContainer);
            if (investmentHistorySurface) {
                const surfaceResizeObserver = new ResizeObserver(() => {
                    requestAnimationFrame(() => {
                        if (formContainer && formContainer.style.display === 'flex') {
                            syncInvestmentImportContainerHeight();
                        }
                    });
                });
                surfaceResizeObserver.observe(investmentHistorySurface);
            }
        }
    }

    // Handle form submission
    if (investmentForm) {
        investmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearImportFeedback();
            const transactionsCsv = document.getElementById('transactions_csv');
            const positionsCsv = document.getElementById('positions_csv');
            const selectedBroker = getSelectedInvestmentImportBroker();
            const transactionsFile = transactionsCsv?.files?.[0];
            const positionsFile = positionsCsv?.files?.[0];
            const ibkrImportMode = getSelectedIbkrImportMode();
            const formData = new FormData();
            formData.append('broker', selectedBroker);
            if (!SUPPORTED_INVESTMENT_IMPORT_BROKERS.has(selectedBroker)) {
                const pendingBroker = getInvestmentBrokerMeta(selectedBroker);
                setImportFeedback(`${pendingBroker.label} investment import is not implemented yet.`, 'warning');
                return;
            }
            if (selectedBroker === 'ibkr') {
                formData.append('ibkr_import_mode', ibkrImportMode);
                if (ibkrImportMode === 'flex') {
                    // Flex config comes from Broker Access; no additional per-import UI
                } else if (ibkrImportMode === 'gainskeeper') {
                    const gainskeeperFiles = gainskeeperFilesInput?.files ? Array.from(gainskeeperFilesInput.files) : [];
                    if (!gainskeeperFiles.length) {
                        setImportFeedback('Please choose at least one IBKR GainsKeeper .gkx file before importing.', 'error');
                        return;
                    }
                    if (!gainskeeperFiles.every((file) => isLikelyGainskeeperFile(file))) {
                        setImportFeedback('Please upload IBKR GainsKeeper files with .gkx or .ofx filenames.', 'error');
                        return;
                    }
                    gainskeeperFiles.forEach((file) => {
                        formData.append('gainskeeper_files', file);
                    });
                } else if (!transactionsFile || !positionsFile) {
                    setImportFeedback('Please choose both IBKR CSV files before importing.', 'error');
                    return;
                } else if (!isLikelyTransactionHistoryFile(transactionsFile) || !isLikelyPositionsFile(positionsFile)) {
                    setImportFeedback('Please make sure the first file is your Transaction History CSV and the second file is your Realized Summary CSV.', 'error');
                    return;
                } else {
                    formData.append('transactions_csv', transactionsFile);
                    formData.append('positions_csv', positionsFile);
                }
            } else if (selectedBroker === 'longbridge_hk') {
                const hkFundFile = longbridgeHkFundDetailsInput?.files?.[0];
                const hkOrdersFile = longbridgeHkHistoryOrdersInput?.files?.[0];
                if (!hkFundFile || !hkOrdersFile) {
                    setImportFeedback('Please upload both the Fund Details text file and the History Orders spreadsheet.', 'error');
                    return;
                }
                if (
                    !isLikelyLongbridgeSgFundDetailsFile(hkFundFile)
                    || !isLikelyLongbridgeSgHistoryOrdersFile(hkOrdersFile)
                ) {
                    setImportFeedback('Please upload a Fund Details .txt and History Orders .xlsx for Longbridge (HK).', 'error');
                    return;
                }
                formData.append('longbridge_hk_fund_details_txt', hkFundFile);
                formData.append('longbridge_hk_history_orders_xlsx', hkOrdersFile);
            } else if (selectedBroker === 'longbridge_sg') {
                const fundDetailsFile = longbridgeSgFundDetailsInput?.files?.[0];
                const historyOrdersFile = longbridgeSgHistoryOrdersInput?.files?.[0];
                if (!fundDetailsFile || !historyOrdersFile) {
                    setImportFeedback('Please choose both Longbridge (SG) import files before importing.', 'error');
                    return;
                }
                if (
                    !isLikelyLongbridgeSgFundDetailsFile(fundDetailsFile)
                    || !isLikelyLongbridgeSgHistoryOrdersFile(historyOrdersFile)
                ) {
                    setImportFeedback('Please upload a Fund Details .txt file and a History Orders .xlsx file.', 'error');
                    return;
                }
                formData.append('longbridge_sg_fund_details_txt', fundDetailsFile);
                formData.append('longbridge_sg_history_orders_xlsx', historyOrdersFile);
            } else if (selectedBroker === 'futuhk') {
                const statementFiles = getSelectedFutuStatementPdfFiles();
                if (!statementFiles.length) {
                    setImportFeedback('Please choose at least one Futu (HK) monthly statement PDF before importing.', 'error');
                    return;
                }
                if (!statementFiles.every((file) => isLikelyFutuStatementPdf(file))) {
                    setImportFeedback('Please upload valid Futu (HK) monthly statement PDF files.', 'error');
                    return;
                }
                statementFiles.forEach((file) => {
                    formData.append('futuhk_statement_pdfs', file);
                });
            } else if (selectedBroker === 'hsbc') {
                const hsbcImportMode = getSelectedHsbcImportMode();
                formData.append('hsbc_import_mode', hsbcImportMode);
                if (hsbcImportMode === 'statement_pdf') {
                    const statementFiles = getSelectedStatementPdfFiles(hsbcStatementPdfsInput);
                    if (!statementFiles.length) {
                        setImportFeedback('Please choose at least one HSBC statement PDF before importing.', 'error');
                        return;
                    }
                    if (!statementFiles.every((file) => isLikelyPdfFile(file))) {
                        setImportFeedback('Please upload valid HSBC statement PDF files.', 'error');
                        return;
                    }
                    statementFiles.forEach((file) => {
                        formData.append('hsbc_statement_pdfs', file);
                    });
                } else {
                    const portfolioText = String(hsbcPortfolioTextInput?.value || '').trim();
                    const orderStatusText = String(hsbcOrderStatusTextInput?.value || '').trim();
                    const cashAccountText = String(hsbcCashAccountTextInput?.value || '').trim();
                    if (!cashAccountText) {
                        setImportFeedback('Please paste the HSBC USD Savings page text before syncing.', 'error');
                        return;
                    }
                    if (!portfolioText) {
                        setImportFeedback('Please paste the HSBC Portfolio page text before syncing.', 'error');
                        return;
                    }
                    if (!orderStatusText) {
                        setImportFeedback('Please paste the HSBC Order Status page text before syncing.', 'error');
                        return;
                    }
                    if (!isLikelyHsbcCashAccountText(cashAccountText)) {
                        setImportFeedback('The HSBC USD Savings page text is missing required details or belongs to the wrong account.', 'error');
                        return;
                    }
                    if (!isLikelyHsbcPortfolioText(portfolioText)) {
                        setImportFeedback('The HSBC Portfolio page text is missing required details or belongs to the wrong account.', 'error');
                        return;
                    }
                    if (!isLikelyHsbcOrderStatusText(orderStatusText)) {
                        setImportFeedback('The HSBC Order Status page text is missing required details or belongs to the wrong account.', 'error');
                        return;
                    }
                    formData.append('hsbc_portfolio_text', portfolioText);
                    formData.append('hsbc_order_status_text', orderStatusText);
                    formData.append('hsbc_cash_account_text', cashAccountText);
                }
            } else if (selectedBroker === 'schwab') {
                const schwabFile = schwabTransactionsCsvInput?.files?.[0] || transactionsCsv?.files?.[0];
                if (!schwabFile) {
                    setImportFeedback('Please choose a Schwab CSV file before importing.', 'error');
                    return;
                }
                formData.append('transactions_csv', schwabFile);
            } else if (selectedBroker === 'tigertrade' || selectedBroker === 'usmart_hk') {
                const input = selectedBroker === 'tigertrade'
                    ? tigertradeStatementPdfsInput
                    : usmartHkStatementPdfsInput;
                const brokerLabel = selectedBroker === 'tigertrade' ? 'Tiger Trade' : 'uSMART (HK)';
                const statementFiles = getSelectedStatementPdfFiles(input);
                if (!statementFiles.length) {
                    setImportFeedback(`Please choose at least one ${brokerLabel} statement PDF before importing.`, 'error');
                    return;
                }
                if (!statementFiles.every((file) => isLikelyPdfFile(file))) {
                    setImportFeedback(`Please upload valid ${brokerLabel} statement PDF files.`, 'error');
                    return;
                }
                statementFiles.forEach((file) => {
                    formData.append(`${selectedBroker}_statement_pdfs`, file);
                });
            }

            investmentImportInFlight = true;
            syncImportValidationState();
            reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'starting transactions import', {
                broker: selectedBroker,
                hasTransactionsFile: Boolean(transactionsFile),
                hasPositionsFile: Boolean(positionsFile),
            });
            fetch('/api/investment/transactions', {
                method: 'POST',
                body: formData,
            })
            .then(response => {
                reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import response received', {
                    broker: selectedBroker,
                    status: response.status,
                    ok: response.ok,
                });
                return response.json();
            })
            .then(async result => {
                reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import payload received', {
                    broker: selectedBroker,
                    success: result.success,
                    error: result.error || '',
                });
                if (result.success) {
                    const refreshNotice = Array.isArray(result.freshness_refresh_failures) && result.freshness_refresh_failures.length
                        ? `Some open positions could not be refreshed yet: ${result.freshness_refresh_failures.map((ticker) => formatInvestmentTickerForDisplay(ticker)).join(', ')}.`
                        : '';
                    const pendingTransferCount = countInvestmentPendingInternalTransferBindings();
                    if (selectedBroker === 'ibkr') {
                        setImportFeedback(
                            buildIbkrImportFeedbackMessage({
                                importSummary: result.summary,
                                refreshNotice,
                                valuationNotice: '',
                                pendingTransferCount,
                            }),
                            'success',
                            { allowHtml: true }
                        );
                    } else {
                        setImportFeedback(
                            `${result.message || 'Import complete.'}${refreshNotice ? ` ${refreshNotice}` : ''}`,
                            'success'
                        );
                    }
                    closeInvestmentImportForm();
                    try {
                        const { valuationStatus } = await fetchInvestmentData();
                        const valuationNotice = valuationStatus?.isDegraded ? String(valuationStatus.message || '').trim() : '';
                        if (valuationNotice) {
                            setImportFeedback(
                                `${result.message || 'Import complete.'} ${valuationNotice}`,
                                'warning'
                            );
                        }
                    } catch (error) {
                        if (isLifecycleInterruptedFetch(error)) return;
                        throw error;
                    }
                } else {
                    setImportFeedback(result.error || 'Import failed.', 'error');
                }
            })
            .catch(err => {
                reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import failed', {
                    broker: selectedBroker,
                    errorName: err?.name || '',
                    errorMessage: err?.message || '',
                });
                setImportFeedback(`Network error: ${err.message}`, 'error');
            })
            .finally(() => {
                investmentImportInFlight = false;
                syncImportValidationState();
            });
        });
    }

    // Load and render transactions
    investmentBootstrapTimer = window.setTimeout(() => {
        investmentBootstrapTimer = 0;
        if (investmentPageDisposed || document.visibilityState === 'hidden') return;
        showInvestmentLoadingModal();
        fetchInvestmentData()
            .then(({ valuationStatus }) => {
                hideInvestmentLoadingModal({ resetContent: true });
                if (valuationStatus?.isDegraded) {
                    setImportFeedback(valuationStatus.message, 'warning');
                    return;
                }
                clearImportFeedback();
            })
            .catch(err => {
                hideInvestmentLoadingModal({ resetContent: true });
                if (isLifecycleInterruptedFetch(err)) return;
                console.error('Failed to load transactions:', err);
                setImportFeedback(`Failed to load investment data: ${err.message}`, 'error');
            });
    }, 150);

    function setInvestmentSharedChartDateRange(chartPoints = []) {
        const normalizedDates = Array.isArray(chartPoints)
            ? chartPoints
                .map((point) => normalizeLedgerDate(point?.date))
                .filter(Boolean)
            : [];
        if (isInvestmentDailyEquityLiveRange()) {
            const liveDateKey = getInvestmentDailyEquityLiveSessionDateKey();
            if (liveDateKey) {
                normalizedDates.push(liveDateKey);
            }
        }
        investmentSharedChartDateRange = Array.from(new Set(normalizedDates)).sort();
    }

    function getInvestmentSharedChartDateRange(fallbackDates = []) {
        if (Array.isArray(investmentSharedChartDateRange) && investmentSharedChartDateRange.length) {
            return [...investmentSharedChartDateRange];
        }
        const normalizedFallbackDates = Array.isArray(fallbackDates)
            ? fallbackDates.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        return Array.from(new Set(normalizedFallbackDates)).sort();
    }

    function constrainTickerDatesToSharedRange(tickerDates = []) {
        const normalizedTickerDates = Array.isArray(tickerDates)
            ? tickerDates.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!normalizedTickerDates.length) return [];
        const sharedDates = getInvestmentSharedChartDateRange(normalizedTickerDates);
        if (!sharedDates.length) return normalizedTickerDates;
        const sharedStart = sharedDates[0];
        const sharedEnd = sharedDates[sharedDates.length - 1];
        const boundedDates = normalizedTickerDates.filter((date) => date >= sharedStart && date <= sharedEnd);
        return boundedDates.length ? boundedDates : normalizedTickerDates;
    }

    function renderHoldingsTable(summaries, tickerProfiles, TOTAL_EQUITY, AGGREGATE_CASH) {
        if (!summaries.length) {
            return `
                <div class="investment-holdings-table-shell">
                    <div class="investment-holdings-empty">No holdings or ticker-linked transactions yet.</div>
                </div>
            `;
        }

        const openSummaries = summaries.filter((summary) => summary.hasOpenPosition);
        const openCount = openSummaries.length;
        const closedCount = summaries.length - openCount;
        const totalRealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.realizedPnl) || 0), 0);
        const totalUnrealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const cumulativePnl = totalRealizedPnl + totalUnrealizedPnl;
        const totalNetMarketValue = openSummaries.reduce((sum, summary) => sum + (Number(summary.marketValue) || 0), 0);
        const totalWeight = Number.isFinite(TOTAL_EQUITY) && Math.abs(TOTAL_EQUITY) > 1e-9
            ? (totalNetMarketValue / TOTAL_EQUITY) * 100
            : 0;
        const totalRealizedClass = totalRealizedPnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const totalUnrealizedClass = totalUnrealizedPnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const cumulativePnlClass = cumulativePnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';

        const rowsHtml = summaries.map((summary, index) => {
            const profile = resolveInvestmentTickerProfile(tickerProfiles, summary.ticker);
            const tickerLabel = formatInvestmentTickerForDisplay(summary.ticker);
            const companyName = resolveInvestmentTickerCompanyName(tickerProfiles, summary.ticker);
            const logoUrls = resolveInvestmentLogoUrls(profile, summary.ticker);
            const usesCashEquivalentTokenLogo = isDollarTokenMoneyMarketTicker(summary.ticker);
            const logoHtml = usesCashEquivalentTokenLogo
                ? '<span class="ticker-identity-logo investment-cash-equivalent-token-logo" aria-hidden="true"></span>'
                : `
                                    <img class="ticker-identity-logo"
                                         alt=""
                                         hidden
                                         loading="lazy"
                                         decoding="async"
                                         data-investment-logo-image
                                         data-logo-url="${escapeHtml(JSON.stringify(logoUrls))}"
                                         data-ticker="${escapeHtml(summary.ticker)}">
                                    <span class="ticker-identity-logo ticker-identity-logo-placeholder" aria-hidden="true"></span>
                `;
            const averagePriceDisplay = summary.averagePrice === null ? '-' : formatHoldingsMoney(summary.averagePrice);
            const positionDisplay = formatHoldingsPosition(summary.shares);
            const realizedClass = summary.realizedPnl >= 0
                ? ' investment-holdings-value-positive'
                : ' investment-holdings-value-negative';
            const unrealizedClass = summary.unrealizedPnl === null
                ? ''
                : (summary.unrealizedPnl >= 0
                    ? ' investment-holdings-value-positive'
                    : ' investment-holdings-value-negative');
            const lastClass = resolveInvestmentLastPriceToneClass(summary.lastPrice, summary.ticker);

            return `
                <tr data-investment-holdings-ticker="${escapeHtml(summary.ticker)}">
                    <td class="investment-holdings-cell investment-holdings-cell-center">${index + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <a class="investment-holdings-ticker-anchor" href="${escapeHtml(buildInvestmentStockDetailsHref(summary.ticker))}" data-investment-stock-link data-investment-stock-ticker="${escapeHtml(summary.ticker)}">
                            <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link" data-ticker="${escapeHtml(summary.ticker)}">
                                <div class="ticker-identity-row">
                                    ${logoHtml}
                                    <span class="ticker-identity-copy">
                                        <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(tickerLabel)}</span>
                                        ${renderInvestmentTickerIdentityNameHtml(companyName)}
                                    </span>
                                </div>
                            </div>
                        </a>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        <span class="trade-metric-value investment-stock-details-metric-value">${renderWorkspaceMetricValueContent(averagePriceDisplay)}</span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${lastClass}">
                        ${renderInvestmentLiveValue('last', summary.lastPrice, {
                            ticker: summary.ticker,
                            className: `trade-metric-value investment-stock-details-metric-value${lastClass}`,
                            formatter: (nextValue) => formatHoldingsLocalMoney(nextValue, summary.quoteCurrency),
                            useSplitValue: true,
                        })}
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        <span class="trade-metric-value investment-stock-details-metric-value">${renderWorkspaceMetricValueContent(positionDisplay)}</span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${realizedClass}">
                        ${renderHoldingsDualCurrencyValue(
                            summary.realizedPnl,
                            summary.realizedPnlLocal,
                            summary.quoteCurrency,
                            { valueClass: realizedClass },
                        )}
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${unrealizedClass}">
                        ${renderInvestmentLiveValue('unrealized_pnl', summary.unrealizedPnl, {
                            ticker: summary.ticker,
                            className: `trade-metric-value investment-stock-details-metric-value ${unrealizedClass.trim()}`,
                            formatter: (nextValue) => nextValue === null ? '-' : formatHoldingsMoney(nextValue),
                            useSplitValue: true,
                        })}
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        ${renderInvestmentLiveValue('position_weight', summary.hasOpenPosition ? summary.positionWeight : null, {
                            ticker: summary.ticker,
                            className: 'trade-metric-value investment-stock-details-metric-value',
                            formatter: (nextValue) => nextValue === null ? '-' : formatHoldingsPercent(nextValue),
                            useSplitValue: true,
                        })}
                    </td>
                </tr>
            `;
        }).join('');

        const cashClass = Number.isFinite(AGGREGATE_CASH) && AGGREGATE_CASH >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const totalEquityClass = Number.isFinite(TOTAL_EQUITY) && TOTAL_EQUITY >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';

        const summaryRowHtml = `
            <tr class="investment-holdings-summary-row">
                <td class="investment-holdings-cell investment-holdings-cell-center"></td>
                <td class="investment-holdings-cell investment-holdings-cell-ticker">
                    <span class="investment-holdings-summary-ticker-body">
                        <span class="investment-holdings-summary-instruments">${summaries.length} instruments, ${openCount} open, ${closedCount} closed</span>
                        <span class="investment-holdings-summary-metrics">
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Cash</span>
                                ${renderInvestmentLiveValue('summary_cash_balance', Number.isFinite(AGGREGATE_CASH) ? AGGREGATE_CASH : null, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${cashClass}`,
                                    formatter: (nextValue) => nextValue === null ? '-' : formatHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                            </span>
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Total Equity</span>
                                ${renderInvestmentLiveValue('summary_total_equity', Number.isFinite(TOTAL_EQUITY) ? TOTAL_EQUITY : null, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${totalEquityClass}`,
                                    formatter: (nextValue) => nextValue === null ? '-' : formatHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                            </span>
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Cumulative P&amp;L</span>
                                ${renderInvestmentLiveValue('summary_cumulative_pnl', cumulativePnl, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${cumulativePnlClass}`,
                                    formatter: (nextValue) => formatSignedHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                            </span>
                        </span>
                    </span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalRealizedClass}">
                    <span class="trade-metric-value investment-stock-details-metric-value${totalRealizedClass}">${renderWorkspaceMetricValueContent(formatHoldingsMoney(totalRealizedPnl))}</span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalUnrealizedClass}">
                    ${renderInvestmentLiveValue('summary_unrealized_pnl', totalUnrealizedPnl, {
                        className: `trade-metric-value investment-stock-details-metric-value ${totalUnrealizedClass.trim()}`,
                        formatter: (nextValue) => formatHoldingsMoney(nextValue),
                        useSplitValue: true,
                    })}
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money">
                    ${renderInvestmentLiveValue('summary_position_weight', totalWeight, {
                        formatter: (nextValue) => formatHoldingsPercent(nextValue),
                        useSplitValue: true,
                    })}
                </td>
            </tr>
        `;

        return `
            <div class="scrollable-data-table-shell investment-holdings-table-shell">
                <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table" aria-hidden="true">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Ticker</th>
                            <th>Average price</th>
                            <th>Last</th>
                            <th>Position</th>
                            <th>Realized P&amp;L</th>
                            <th>Unrealized P&amp;L</th>
                            <th>%</th>
                        </tr>
                        ${summaryRowHtml}
                    </thead>
                </table>
                <div class="trade-transactions-wrap scrollable-data-table-scroll investment-holdings-table-scroll">
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table">
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function bindHoldingsHistoryInteractions(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('tr[data-investment-holdings-ticker]').forEach((row) => {
            if (row.dataset.historyHoverBound === '1') return;
            row.dataset.historyHoverBound = '1';
            const activateRelatedHistoryRow = () => {
                const ticker = row.dataset.investmentHoldingsTicker || '';
                const historyRow = getLatestHistoryRowForTicker(ticker);
                const ledgerNo = Number(historyRow?.dataset.investmentHistoryRow || 0);
                syncHoldingsChartHoverState(ticker, ledgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                activateInvestmentHistoryRows([ledgerNo], { behavior: 'auto', scroll: false });
            };
            const clearRelatedHistoryRow = () => {
                syncHoldingsChartHoverState('', 0);
                clearInvestmentHistoryHighlights();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

    function syncSelectedStockLinkState() {
        document.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            const ticker = normalizeInvestmentTicker(link.dataset.investmentStockTicker || '');
            link.setAttribute('href', buildInvestmentStockDetailsHref(ticker));
            link.classList.toggle('is-active', Boolean(selectedInvestmentStockTicker) && ticker === selectedInvestmentStockTicker);
        });
    }

    function bindHoldingsStockDetailsLinks(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            if (link.dataset.stockDetailsBound === '1') return;
            link.dataset.stockDetailsBound = '1';
            link.addEventListener('click', (event) => {
                event.preventDefault();
                selectInvestmentStockTicker(link.dataset.investmentStockTicker || '', { focusView: true });
            });
        });
        syncSelectedStockLinkState();
    }

    function bindStockDetailsHistoryInteractions(stockDetailsPanel) {
        if (!stockDetailsPanel) return;
        const hoverContainer = stockDetailsPanel.querySelector('.investment-stock-details-table-shell')
            || stockDetailsPanel.querySelector('.investment-stock-details-table-host')
            || stockDetailsPanel;
        setInvestmentHoverContainerPayload(hoverContainer, null);
        bindInvestmentHoverContainerPersistence(hoverContainer);
        stockDetailsPanel.querySelectorAll('tr[data-investment-stock-detail-ledger]').forEach((row) => {
            if (row.dataset.stockHistoryBound === '1') return;
            row.dataset.stockHistoryBound = '1';
            const activateRelatedHistoryRow = () => {
                const ledgerNo = Number(row.dataset.investmentStockDetailLedger || 0);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                const hoverPayload = {
                    hoverTicker: ensureSelectedInvestmentStockTicker(),
                    hoverLedgerNo: ledgerNo,
                    historyLedgerNos: [ledgerNo],
                    stockDetailLedgerNos: [ledgerNo],
                    interactionLedgerNo: ledgerNo,
                    historyBehavior: 'auto',
                    historyScroll: true,
                    stockDetailBehavior: 'auto',
                    stockDetailScroll: false,
                };
                setInvestmentHoverContainerPayload(hoverContainer, hoverPayload);
                syncInvestmentHoverLinkedViews(hoverPayload);
            };
            const clearRelatedHistoryRow = () => {
                if (hoverContainer instanceof HTMLElement && hoverContainer.matches(':hover')) return;
                clearInvestmentChartLinkedHoverState();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

    function getAvailableInvestmentStockTickers() {
        if (Array.isArray(investmentTickerSummariesCache) && investmentTickerSummariesCache.length) {
            return investmentTickerSummariesCache
                .map((summary) => normalizeInvestmentTicker(summary?.ticker))
                .filter(Boolean);
        }
        return Array.from(new Set((Array.isArray(investmentProcessedTransactionsCache) ? investmentProcessedTransactionsCache : [])
            .filter((txn) => shouldTrackHoldingTicker(txn))
            .map((txn) => getInvestmentCanonicalTicker(txn?.ticker))
            .filter(Boolean)));
    }

    function ensureSelectedInvestmentStockTicker() {
        const availableTickers = getAvailableInvestmentStockTickers();
        if (!availableTickers.length) {
            const locationTicker = getInvestmentLocationTicker();
            if (locationTicker) {
                selectedInvestmentStockTicker = locationTicker;
            }
            rememberInvestmentPageState({ ticker: selectedInvestmentStockTicker || '' });
            return normalizeInvestmentTicker(selectedInvestmentStockTicker || '');
        }
        if (!availableTickers.includes(selectedInvestmentStockTicker)) {
            selectedInvestmentStockTicker = availableTickers[0];
        }
        rememberInvestmentPageState({ ticker: selectedInvestmentStockTicker });
        return selectedInvestmentStockTicker;
    }

    function buildInvestmentStockDonutMarkup(summary, profile) {
        const logoUrl = resolveInvestmentLogoUrl(profile, summary?.ticker || 'stock');
        const ticker = escapeHtml(summary?.ticker || 'Ticker');
        return `
            <div class="style-token-portfolio-donut-shell investment-stock-details-donut-shell">
                <div class="portfolio-donut-orbit style-token-portfolio-donut-orbit investment-stock-details-donut-orbit" aria-hidden="true">
                    <div class="portfolio-donut-logo-layer investment-stock-details-donut-logo-layer">
                        <img class="portfolio-donut-logo investment-stock-details-donut-logo" src="${escapeHtml(logoUrl)}" alt="${ticker} logo" loading="lazy" decoding="async" data-ticker="${ticker}" data-style-token-donut-angle="44.4">
                    </div>
                    <div class="portfolio-donut investment-stock-details-donut" style="--portfolio-donut-fill: ${STOCK_DETAILS_DONUT_GRAY_FILL};"></div>
                </div>
            </div>
        `;
    }

    function getWorkspaceMetricValueParts(value) {
        const rawValue = String(value ?? '').trim() || '--';
        const numericMatch = rawValue.match(/^([+\-]?(?:[A-Z]{3}\s|\$)?)(\d[\d,]*)(?:\.(\d+))(%?)$/);
        if (!numericMatch) {
            return [{ className: 'workspace-metric-value-major', text: rawValue }];
        }
        const [, prefix, integerPart, decimalPart = '', suffix = ''] = numericMatch;
        if (!decimalPart) {
            return [{ className: 'workspace-metric-value-major', text: `${prefix}${integerPart}${suffix}` }];
        }
        return [
            { className: 'workspace-metric-value-major', text: `${prefix}${integerPart}.` },
            { className: 'workspace-metric-value-minor', text: decimalPart },
            ...(suffix ? [{ className: 'workspace-metric-value-suffix', text: suffix }] : []),
        ];
    }

    function normalizeShareHoldingsMoneyText(value) {
        return String(value || '').replace(/([+-]?)\$\s*/g, '$1').trim();
    }

    function resolveShareHoldingsMetricToneClass(displayText, element) {
        if (element instanceof HTMLElement) {
            if (element.classList.contains('investment-holdings-value-positive')) return ' investment-holdings-value-positive';
            if (element.classList.contains('investment-holdings-value-negative')) return ' investment-holdings-value-negative';
        }
        const normalized = String(displayText || '').trim();
        if (normalized.startsWith('+')) return ' investment-holdings-value-positive';
        if (normalized.startsWith('-') && normalized !== '-') return ' investment-holdings-value-negative';
        return '';
    }

    function populateShareHoldingsMetricCell(cell) {
        if (!(cell instanceof HTMLTableCellElement)) return;
        const existingMetric = cell.querySelector('.trade-metric-value, .investment-live-value');
        const displayText = normalizeShareHoldingsMoneyText(
            (existingMetric instanceof HTMLElement
                ? (existingMetric.dataset.investmentLiveDisplay || existingMetric.textContent)
                : cell.textContent) || '',
        ).trim() || '-';
        const toneClass = resolveShareHoldingsMetricToneClass(displayText, existingMetric);
        cell.textContent = '';
        const metric = document.createElement('span');
        metric.className = `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${toneClass}`.trim();
        metric.innerHTML = renderWorkspaceMetricValueContent(displayText);
        cell.appendChild(metric);
    }

    function renderWorkspaceMetricValueContent(value) {
        return getWorkspaceMetricValueParts(value)
            .map((part) => `<span class="${part.className}">${escapeHtml(part.text)}</span>`)
            .join('');
    }

    function formatHoldingsLocalMoney(value, currency) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = getInvestmentBaseCurrency();
        const formatted = formatHoldingsMoney(value);
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) {
            return formatted;
        }
        return `${normalizedCurrency} ${formatted}`;
    }

    function formatHoldingsLocalCurrencyLine(value, currency) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return '';
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = getInvestmentBaseCurrency();
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return '';
        const sign = numericValue < 0 ? '-' : '';
        return `${normalizedCurrency} ${formatHoldingsMoney(Math.abs(numericValue))}`;
    }

    function shouldShowHoldingsLocalCurrencyLine(localValue, currency) {
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        const baseCurrency = getInvestmentBaseCurrency();
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return false;
        const numericValue = Number(localValue);
        return Number.isFinite(numericValue) && Math.abs(numericValue) >= 1e-9;
    }

    function renderHoldingsDualCurrencyValue(usdValue, localValue, currency, { valueClass = '' } = {}) {
        const usdDisplay = formatHoldingsMoney(usdValue);
        if (!shouldShowHoldingsLocalCurrencyLine(localValue, currency)) {
            return `<span class="trade-metric-value investment-stock-details-metric-value${valueClass}">${renderWorkspaceMetricValueContent(usdDisplay)}</span>`;
        }
        const localDisplay = formatHoldingsLocalCurrencyLine(localValue, currency);
        return `
            <span class="investment-holdings-dual-currency">
                <span class="trade-metric-value investment-stock-details-metric-value investment-holdings-dual-currency-primary${valueClass}">${renderWorkspaceMetricValueContent(usdDisplay)}</span>
                <span class="investment-holdings-dual-currency-secondary">${escapeHtml(localDisplay)}</span>
            </span>
        `;
    }

    function renderInvestmentLiveValue(field, value, {
        ticker = '',
        formatter = (nextValue) => String(nextValue ?? '').trim() || '-',
        className = '',
        useSplitValue = false,
    } = {}) {
        const displayText = formatter(value);
        const numericValue = Number(value);
        const classToken = className ? ` ${className}` : '';
        const tickerAttr = ticker ? ` data-investment-live-ticker="${escapeHtml(ticker)}"` : '';
        const numberAttr = Number.isFinite(numericValue)
            ? ` data-investment-live-number="${escapeHtml(String(numericValue))}"`
            : '';
        const innerHtml = useSplitValue ? renderWorkspaceMetricValueContent(displayText) : escapeHtml(displayText);
        return `<span class="investment-live-value${classToken}" data-investment-live-field="${escapeHtml(field)}"${tickerAttr}${numberAttr} data-investment-live-display="${escapeHtml(displayText)}">${innerHtml}</span>`;
    }

    function computeLiveHoldingsTotalEquity(summaries, aggregateCash) {
        const safeCash = Number.isFinite(Number(aggregateCash)) ? Number(aggregateCash) : 0;
        const openMarketValue = (Array.isArray(summaries) ? summaries : [])
            .filter((summary) => summary?.hasOpenPosition)
            .reduce((sum, summary) => sum + (Number(summary.marketValue) || 0), 0);
        return safeCash + openMarketValue;
    }

    function resolveInvestmentTickerReferenceClose(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return null;
        const tickerPriceIndex = buildTickerPriceIndex(investmentTickerClosePricesCache);
        const latestLedgerDate = normalizeLedgerDate(
            investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]?.date
        );
        const referenceClose = getIndexedClosePriceOnOrBefore(
            tickerPriceIndex[normalizedTicker],
            latestLedgerDate,
        );
        return Number.isFinite(Number(referenceClose)) ? Number(referenceClose) : null;
    }

    function resolveInvestmentLastPriceToneClass(lastPrice, ticker) {
        const price = Number(lastPrice);
        const referenceClose = resolveInvestmentTickerReferenceClose(ticker);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(referenceClose)) return '';
        if (price > referenceClose + INVESTMENT_LIVE_DIGIT_EPSILON) return ' investment-holdings-value-positive';
        if (price < referenceClose - INVESTMENT_LIVE_DIGIT_EPSILON) return ' investment-holdings-value-negative';
        return '';
    }

    function getInvestmentHoldingsRealtimeState() {
        if (!Array.isArray(investmentRawTransactionsCache) || !investmentRawTransactionsCache.length) {
            return null;
        }
        const latestSnapshot = investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1];
        const rawAggregateCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateCash = Number.isFinite(rawAggregateCash)
            ? rawAggregateCash
            : Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash);
        const latestChartPoint = Array.isArray(investmentChartPointsCache) && investmentChartPointsCache.length
            ? investmentChartPointsCache[investmentChartPointsCache.length - 1]
            : null;
        const realtimeChartPoint = Array.isArray(investmentChartPointsCache)
            ? investmentChartPointsCache.find((point) => point?.is_realtime === true)
            : null;
        const preliminaryRealtimeEquity = Number(
            realtimeChartPoint?.aggregate_total_equity ?? realtimeChartPoint?.total_equity
        );
        const preliminaryChartEquity = Number(
            latestChartPoint?.aggregate_total_equity ?? latestChartPoint?.total_equity
        );
        const preliminaryTotalEquity = Number.isFinite(preliminaryRealtimeEquity)
            ? preliminaryRealtimeEquity
            : preliminaryChartEquity;
        const safeTotalEquity = Number.isFinite(preliminaryTotalEquity) ? preliminaryTotalEquity : 0;
        const valuationDate = normalizeLedgerDate(latestChartPoint?.date)
            || normalizeLedgerDate(investmentProcessedTransactionsCache[investmentProcessedTransactionsCache.length - 1]?.date)
            || '';
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(investmentRawTransactionsCache, baseCurrency);
        const summaries = buildTickerSummaries(
            investmentRawTransactionsCache,
            investmentLatestPricesCache,
            safeTotalEquity,
            investmentTickerClosePricesCache,
        ).map((summary) => {
            const nextSummary = { ...summary };
            const livePrice = Number(investmentLatestPricesCache[nextSummary.ticker]);
            if (Number.isFinite(livePrice) && livePrice > 0) {
                nextSummary.lastPrice = livePrice;
            }
            if (!nextSummary.hasOpenPosition || !Number.isFinite(livePrice) || livePrice <= 0) {
                return nextSummary;
            }
            const quoteCurrency = getTickerQuoteCurrency(nextSummary.ticker);
            const marketValueLocal = Number(nextSummary.shares) * livePrice;
            const unrealizedPnlLocal = nextSummary.averagePrice === null
                ? null
                : (
                    Number(nextSummary.shares) >= 0
                        ? (livePrice - nextSummary.averagePrice) * Number(nextSummary.shares)
                        : (nextSummary.averagePrice - livePrice) * Math.abs(Number(nextSummary.shares))
                );
            const marketValue = convertAmountToBaseCurrency(
                marketValueLocal,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            const unrealizedPnl = unrealizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    unrealizedPnlLocal,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            nextSummary.marketValue = marketValue;
            nextSummary.unrealizedPnl = unrealizedPnl;
            nextSummary.positionWeight = Number.isFinite(safeTotalEquity) && Math.abs(safeTotalEquity) > INVESTMENT_LIVE_DIGIT_EPSILON
                ? (marketValue / safeTotalEquity) * 100
                : 0;
            return nextSummary;
        });
        const totalEquity = Number.isFinite(preliminaryRealtimeEquity)
            ? preliminaryRealtimeEquity
            : computeLiveHoldingsTotalEquity(summaries, aggregateCash);
        const resolvedTotalEquity = Number.isFinite(totalEquity) ? totalEquity : 0;
        if (Math.abs(resolvedTotalEquity - safeTotalEquity) > INVESTMENT_LIVE_DIGIT_EPSILON) {
            summaries.forEach((summary) => {
                if (!summary?.hasOpenPosition) return;
                summary.positionWeight = Math.abs(resolvedTotalEquity) > INVESTMENT_LIVE_DIGIT_EPSILON
                    ? ((Number(summary.marketValue) || 0) / resolvedTotalEquity) * 100
                    : 0;
            });
        }
        return {
            summaries,
            totalEquity: resolvedTotalEquity,
            aggregateCash: Number.isFinite(aggregateCash) ? aggregateCash : null,
        };
    }

    function resolveInvestmentLiveNumberDirection(previousValue, nextValue) {
        const previousNumber = Number(previousValue);
        const nextNumber = Number(nextValue);
        if (!Number.isFinite(previousNumber) || !Number.isFinite(nextNumber)) return 'flat';
        if (Math.abs(nextNumber - previousNumber) <= INVESTMENT_LIVE_DIGIT_EPSILON) return 'flat';
        return nextNumber > previousNumber ? 'rise' : 'fall';
    }

    function parseInvestmentLiveDisplaySegments(display) {
        const raw = String(display ?? '').trim();
        if (!raw || raw === '-') {
            return null;
        }
        const match = raw.match(/^([+\-]?(?:[A-Z]{3}\s|\$)?)(\d[\d,]*)(\.)(\d*)(%?)$/);
        if (!match) {
            return {
                isStructured: false,
                chars: Array.from(raw),
            };
        }
        const [, prefix, integerPart, dot, fractionalPart, suffix] = match;
        return {
            isStructured: true,
            prefix: Array.from(prefix),
            integer: Array.from(integerPart),
            dot: [dot],
            fraction: Array.from(fractionalPart),
            suffix: Array.from(suffix),
        };
    }

    function alignInvestmentLiveSegmentChars(previousChars, nextChars, align = 'left') {
        const safePrevious = Array.isArray(previousChars) ? previousChars : [];
        const safeNext = Array.isArray(nextChars) ? nextChars : [];
        const maxLength = Math.max(safePrevious.length, safeNext.length);
        const pairs = [];
        for (let index = 0; index < maxLength; index += 1) {
            const previousIndex = align === 'right'
                ? index - (maxLength - safePrevious.length)
                : index;
            const nextIndex = align === 'right'
                ? index - (maxLength - safeNext.length)
                : index;
            const previousChar = previousIndex >= 0 && previousIndex < safePrevious.length
                ? safePrevious[previousIndex]
                : '';
            const nextChar = nextIndex >= 0 && nextIndex < safeNext.length
                ? safeNext[nextIndex]
                : '';
            if (!previousChar && !nextChar) continue;
            pairs.push({ previousChar, nextChar });
        }
        return pairs;
    }

    function buildInvestmentLiveSegmentPairs(previousDisplay, nextDisplay) {
        const previousSegments = parseInvestmentLiveDisplaySegments(previousDisplay);
        const nextSegments = parseInvestmentLiveDisplaySegments(nextDisplay);
        if (!previousSegments && !nextSegments) {
            return [];
        }
        if (!previousSegments || !nextSegments) {
            return alignInvestmentLiveSegmentChars(
                Array.from(String(previousDisplay || '')),
                Array.from(String(nextDisplay || '')),
                'right',
            ).map((pair) => ({ ...pair, partClassName: '' }));
        }
        if (!previousSegments.isStructured || !nextSegments.isStructured) {
            return alignInvestmentLiveSegmentChars(previousSegments.chars, nextSegments.chars, 'right')
                .map((pair) => ({ ...pair, partClassName: '' }));
        }
        const segmentOrder = ['prefix', 'integer', 'dot', 'fraction', 'suffix'];
        const segmentAlign = {
            prefix: 'left',
            integer: 'right',
            dot: 'left',
            fraction: 'left',
            suffix: 'left',
        };
        const segmentPartClass = {
            prefix: 'workspace-metric-value-major',
            integer: 'workspace-metric-value-major',
            dot: 'workspace-metric-value-major',
            fraction: 'workspace-metric-value-minor',
            suffix: 'workspace-metric-value-suffix',
        };
        return segmentOrder.flatMap((segmentKey) => (
            alignInvestmentLiveSegmentChars(
                previousSegments[segmentKey],
                nextSegments[segmentKey],
                segmentAlign[segmentKey],
            ).map((pair) => ({
                ...pair,
                partClassName: segmentPartClass[segmentKey],
            }))
        ));
    }

    function getInvestmentLiveMeasurementFingerprint(node, partClassName = '') {
        if (!(node instanceof HTMLElement)) return '';
        const styles = window.getComputedStyle(node);
        return [
            partClassName,
            styles.fontFamily,
            styles.fontSize,
            styles.fontWeight,
            styles.fontStyle,
            styles.letterSpacing,
            styles.fontVariantNumeric,
        ].join('|');
    }

    function measureInvestmentLiveCharWidth(node, char, partClassName = '') {
        const safeChar = String(char || '0');
        const fingerprint = getInvestmentLiveMeasurementFingerprint(node, partClassName);
        const cacheKey = `${fingerprint}::${safeChar}`;
        if (investmentLiveCharWidthCache.has(cacheKey)) {
            return investmentLiveCharWidthCache.get(cacheKey);
        }
        if (!(node instanceof HTMLElement) || !(document.body instanceof HTMLElement)) {
            return 0;
        }
        const wrapper = document.createElement('span');
        wrapper.className = node.className;
        wrapper.style.position = 'absolute';
        wrapper.style.left = '-10000px';
        wrapper.style.top = '0';
        wrapper.style.visibility = 'hidden';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.whiteSpace = 'nowrap';
        const measurer = document.createElement('span');
        measurer.className = partClassName || 'workspace-metric-value-major';
        measurer.style.whiteSpace = 'pre';
        measurer.textContent = safeChar;
        wrapper.appendChild(measurer);
        document.body.appendChild(wrapper);
        const width = Math.ceil(Math.max(0, measurer.getBoundingClientRect().width || 0));
        wrapper.remove();
        investmentLiveCharWidthCache.set(cacheKey, width);
        return width;
    }

    function resolveInvestmentLiveSlotWidth(node, previousChar, nextChar, partClassName = '') {
        const widths = [previousChar, nextChar]
            .filter(Boolean)
            .map((char) => measureInvestmentLiveCharWidth(node, char, partClassName));
        if (widths.length) return Math.max(...widths);
        return measureInvestmentLiveCharWidth(node, '0', partClassName);
    }

    function applyInvestmentLiveDigitSlotWidth(digit, width) {
        if (!(digit instanceof HTMLElement) || !Number.isFinite(width) || width <= 0) return;
        digit.style.width = `${Math.ceil(width)}px`;
        digit.style.minWidth = `${Math.ceil(width)}px`;
        digit.style.maxWidth = `${Math.ceil(width)}px`;
    }

    function createInvestmentLiveDigit(previousChar, nextChar, direction, slotWidth = 0) {
        const digit = document.createElement('span');
        const previous = String(previousChar || '');
        const next = String(nextChar || '');
        const displayChar = next || previous;
        const changed = previous !== next && direction !== 'flat' && Boolean(previous || next);
        applyInvestmentLiveDigitSlotWidth(digit, slotWidth);

        if (!changed) {
            digit.className = 'investment-live-digit';
            digit.textContent = displayChar;
            return { digit, animate: false };
        }

        digit.className = `investment-live-digit investment-live-digit--changed investment-live-digit--${direction}`;
        if (previous) {
            const oldFace = document.createElement('span');
            oldFace.className = 'investment-live-digit-face investment-live-digit-face--old';
            oldFace.textContent = previous;
            digit.appendChild(oldFace);
        }
        if (next) {
            const newFace = document.createElement('span');
            newFace.className = 'investment-live-digit-face investment-live-digit-face--new';
            newFace.textContent = next;
            if (direction === 'rise') {
                newFace.style.color = 'var(--theme-accent-positive)';
            } else if (direction === 'fall') {
                newFace.style.color = 'var(--theme-accent-secondary)';
            }
            digit.appendChild(newFace);
        }
        return { digit, animate: true };
    }

    function applyInvestmentLiveDigitFrame(digit, direction, eased) {
        const oldFace = digit.querySelector('.investment-live-digit-face--old');
        const newFace = digit.querySelector('.investment-live-digit-face--new');
        const isRise = direction === 'rise';
        const oldYOffset = isRise ? (-100 * eased) : (100 * eased);
        const newYOffset = isRise ? (100 * (1 - eased)) : (-100 * (1 - eased));
        if (oldFace instanceof HTMLElement) {
            oldFace.style.opacity = String(1 - eased);
            oldFace.style.transform = `translate(-50%, calc(-50% + ${oldYOffset}%))`;
        }
        if (newFace instanceof HTMLElement) {
            newFace.style.opacity = String(eased);
            newFace.style.transform = `translate(-50%, calc(-50% + ${newYOffset}%))`;
        }
    }

    function animateInvestmentLiveDigit(digit, direction, onComplete) {
        if (!(digit instanceof HTMLElement)) {
            if (typeof onComplete === 'function') onComplete();
            return () => {};
        }
        const startTime = performance.now();
        let frameId = 0;
        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / INVESTMENT_LIVE_DIGIT_ANIMATION_MS);
            applyInvestmentLiveDigitFrame(digit, direction, easeOutCubic(progress));
            if (progress < 1) {
                frameId = window.requestAnimationFrame(step);
                return;
            }
            if (typeof onComplete === 'function') onComplete();
        };
        applyInvestmentLiveDigitFrame(digit, direction, 0);
        frameId = window.requestAnimationFrame(step);
        return () => {
            if (frameId) window.cancelAnimationFrame(frameId);
        };
    }

    function runInvestmentLiveDigitAnimations(digits, onComplete) {
        const animatedDigits = (Array.isArray(digits) ? digits : []).filter((entry) => entry?.animate);
        if (!animatedDigits.length) {
            if (typeof onComplete === 'function') onComplete();
            return () => {};
        }
        let remaining = animatedDigits.length;
        const cancelers = [];
        const finishOne = () => {
            remaining -= 1;
            if (remaining <= 0 && typeof onComplete === 'function') {
                onComplete();
            }
        };
        animatedDigits.forEach(({ digit, direction }) => {
            cancelers.push(animateInvestmentLiveDigit(digit, direction, finishOne));
        });
        return () => {
            cancelers.forEach((cancel) => {
                if (typeof cancel === 'function') cancel();
            });
        };
    }

    function cancelInvestmentLiveValueAnimation(node) {
        const cancel = investmentLiveValueAnimationCancels.get(node);
        if (typeof cancel === 'function') cancel();
        investmentLiveValueAnimationCancels.delete(node);
    }

    function buildInvestmentLiveValueFragment(referenceNode, previousDisplay, nextDisplay, direction, useSplit = false) {
        const fragment = document.createDocumentFragment();
        const pairs = buildInvestmentLiveSegmentPairs(previousDisplay, nextDisplay);
        const animatedDigits = [];
        let splitWrapper = null;
        let splitPartClassName = '';

        const ensureSplitWrapper = (partClassName) => {
            if (!useSplit) return fragment;
            const safeClassName = partClassName || 'workspace-metric-value-major';
            if (splitWrapper && splitPartClassName === safeClassName) return splitWrapper;
            splitWrapper = document.createElement('span');
            splitWrapper.className = safeClassName;
            splitPartClassName = safeClassName;
            fragment.appendChild(splitWrapper);
            return splitWrapper;
        };

        pairs.forEach(({ previousChar, nextChar, partClassName }) => {
            const slotWidth = resolveInvestmentLiveSlotWidth(
                referenceNode,
                previousChar,
                nextChar,
                partClassName,
            );
            const { digit, animate } = createInvestmentLiveDigit(
                previousChar,
                nextChar,
                direction,
                slotWidth,
            );
            const target = ensureSplitWrapper(partClassName);
            target.appendChild(digit);
            if (animate) {
                animatedDigits.push({ digit, direction });
            }
        });

        return { fragment, animatedDigits };
    }

    function renderInvestmentLiveStaticContent(node, nextDisplay, useSplit) {
        if (!(node instanceof HTMLElement)) return;
        if (useSplit) {
            node.innerHTML = renderWorkspaceMetricValueContent(nextDisplay);
        } else {
            node.textContent = nextDisplay;
        }
    }

    function measureInvestmentLiveStaticContent(node, display, useSplit) {
        if (!(node instanceof HTMLElement) || !(document.body instanceof HTMLElement)) {
            return { width: 0, height: 0 };
        }
        const clone = document.createElement('span');
        clone.className = node.className;
        clone.classList.remove('is-live-rise', 'is-live-fall');
        clone.style.position = 'absolute';
        clone.style.left = '-10000px';
        clone.style.top = '0';
        clone.style.visibility = 'hidden';
        clone.style.pointerEvents = 'none';
        clone.style.minWidth = '0';
        clone.style.minHeight = '0';
        clone.style.whiteSpace = 'nowrap';
        renderInvestmentLiveStaticContent(clone, display, useSplit);
        const measurementHost = node.parentElement instanceof HTMLElement ? node.parentElement : document.body;
        measurementHost.appendChild(clone);
        const rect = clone.getBoundingClientRect();
        clone.remove();
        return {
            width: Math.ceil(Math.max(0, rect.width || 0)),
            height: Math.ceil(Math.max(0, rect.height || 0)),
        };
    }

    function reserveInvestmentLiveValueLayout(node, previousDisplay, nextDisplay, useSplit) {
        if (!(node instanceof HTMLElement)) return;
        const currentRect = node.getBoundingClientRect();
        const previousSize = measureInvestmentLiveStaticContent(node, previousDisplay, useSplit);
        const nextSize = measureInvestmentLiveStaticContent(node, nextDisplay, useSplit);
        const previousReservedWidth = Number(node.dataset.investmentLiveReserveWidth || 0);
        const previousReservedHeight = Number(node.dataset.investmentLiveReserveHeight || 0);
        const reserveWidth = Math.ceil(Math.max(
            previousReservedWidth,
            currentRect.width || 0,
            previousSize.width,
            nextSize.width,
        ));
        const reserveHeight = Math.ceil(Math.max(
            previousReservedHeight,
            currentRect.height || 0,
            previousSize.height,
            nextSize.height,
        ));
        if (reserveWidth > 0) {
            node.dataset.investmentLiveReserveWidth = String(reserveWidth);
            node.style.minWidth = `${reserveWidth}px`;
        }
        if (reserveHeight > 0) {
            node.dataset.investmentLiveReserveHeight = String(reserveHeight);
            node.style.minHeight = `${reserveHeight}px`;
        }
    }

    function shouldUseSplitLiveValue(node) {
        return node instanceof HTMLElement && (
            node.classList.contains('investment-stock-details-metric-value')
            || node.closest('.investment-holdings-summary-row')
        );
    }

    function updateInvestmentLiveValueNode(node, nextDisplay, nextNumber) {
        if (!(node instanceof HTMLElement)) return;
        const previousDisplay = String(node.dataset.investmentLiveDisplay || node.textContent || '').trim();
        const nextDisplayNormalized = String(nextDisplay ?? '').trim();
        const previousNumber = String(node.dataset.investmentLiveNumber || '').trim();
        const nextNumberNormalized = Number.isFinite(Number(nextNumber)) ? String(nextNumber) : '';
        if (
            previousDisplay === nextDisplayNormalized
            && previousNumber === nextNumberNormalized
            && !node.dataset.investmentLiveAnimationToken
        ) {
            return;
        }
        cancelInvestmentLiveValueAnimation(node);
        const direction = resolveInvestmentLiveNumberDirection(node.dataset.investmentLiveNumber, nextNumber);
        const useSplit = shouldUseSplitLiveValue(node);
        const shouldAnimate = (
            previousDisplay
            && previousDisplay !== nextDisplay
            && direction !== 'flat'
            && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        );
        reserveInvestmentLiveValueLayout(node, previousDisplay, nextDisplay, useSplit);
        node.classList.remove('is-live-rise', 'is-live-fall');
        node.replaceChildren();
        if (shouldAnimate) {
            const animationToken = `${Date.now()}:${Math.random()}`;
            node.dataset.investmentLiveAnimationToken = animationToken;
            const { fragment, animatedDigits } = buildInvestmentLiveValueFragment(
                node,
                previousDisplay,
                nextDisplay,
                direction,
                useSplit,
            );
            node.appendChild(fragment);
            node.classList.add(direction === 'rise' ? 'is-live-rise' : 'is-live-fall');
            const cancelAnimation = runInvestmentLiveDigitAnimations(animatedDigits, () => {
                if (!node.isConnected) return;
                if (node.dataset.investmentLiveAnimationToken !== animationToken) return;
                renderInvestmentLiveStaticContent(node, nextDisplay, useSplit);
                node.classList.remove('is-live-rise', 'is-live-fall');
                delete node.dataset.investmentLiveAnimationToken;
                investmentLiveValueAnimationCancels.delete(node);
            });
            investmentLiveValueAnimationCancels.set(node, cancelAnimation);
        } else {
            delete node.dataset.investmentLiveAnimationToken;
            renderInvestmentLiveStaticContent(node, nextDisplay, useSplit);
        }
        node.dataset.investmentLiveDisplay = nextDisplay;
        if (Number.isFinite(Number(nextNumber))) {
            node.dataset.investmentLiveNumber = String(nextNumber);
        } else {
            delete node.dataset.investmentLiveNumber;
        }
    }

    function syncInvestmentLiveTone(targets, numericValue, { enableSignedTone = false } = {}) {
        const elements = Array.isArray(targets) ? targets : [targets];
        elements.forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            if (!enableSignedTone || !Number.isFinite(Number(numericValue))) {
                element.classList.remove('investment-holdings-value-positive', 'investment-holdings-value-negative');
                return;
            }
            element.classList.toggle('investment-holdings-value-positive', Number(numericValue) >= 0);
            element.classList.toggle('investment-holdings-value-negative', Number(numericValue) < 0);
        });
    }

    function syncInvestmentLiveDirectionTone(targets, previousValue, nextValue) {
        const direction = resolveInvestmentLiveNumberDirection(previousValue, nextValue);
        if (direction === 'flat') return;
        const elements = Array.isArray(targets) ? targets : [targets];
        elements.forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            element.classList.remove('investment-holdings-value-positive', 'investment-holdings-value-negative');
            if (direction === 'rise') {
                element.classList.add('investment-holdings-value-positive');
            } else if (direction === 'fall') {
                element.classList.add('investment-holdings-value-negative');
            }
        });
    }

    function syncInvestmentHoldingsRealtimeValues() {
        const realtimeState = getInvestmentHoldingsRealtimeState();
        if (!realtimeState) return;
        const { summaries, totalEquity, aggregateCash } = realtimeState;
        investmentTickerSummariesCache = Array.isArray(summaries) ? [...summaries] : [];

        summaries.forEach((summary) => {
            const row = document.querySelector(
                `#investment_holdings_panel tr[data-investment-holdings-ticker="${CSS.escape(summary.ticker)}"]`
            );
            if (!(row instanceof HTMLTableRowElement)) return;
            const lastNode = row.querySelector('[data-investment-live-field="last"]');
            const unrealizedNode = row.querySelector('[data-investment-live-field="unrealized_pnl"]');
            const weightNode = row.querySelector('[data-investment-live-field="position_weight"]');
            const lastCell = lastNode?.closest('td');
            const unrealizedCell = unrealizedNode?.closest('td');
            const previousLastPrice = Number(lastNode?.dataset.investmentLiveNumber);

            updateInvestmentLiveValueNode(
                lastNode,
                formatHoldingsLocalMoney(summary.lastPrice, summary.quoteCurrency),
                summary.lastPrice,
            );
            updateInvestmentLiveValueNode(
                unrealizedNode,
                summary.unrealizedPnl === null ? '-' : formatHoldingsMoney(summary.unrealizedPnl),
                summary.unrealizedPnl,
            );
            updateInvestmentLiveValueNode(
                weightNode,
                summary.hasOpenPosition ? formatHoldingsPercent(summary.positionWeight) : '-',
                summary.hasOpenPosition ? summary.positionWeight : null,
            );
            syncInvestmentLiveDirectionTone([lastNode, lastCell], previousLastPrice, summary.lastPrice);
            syncInvestmentLiveTone([unrealizedNode, unrealizedCell], summary.unrealizedPnl, {
                enableSignedTone: summary.unrealizedPnl !== null,
            });
        });

        const openSummaries = summaries.filter((summary) => summary.hasOpenPosition);
        const totalRealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.realizedPnl) || 0), 0);
        const totalUnrealizedPnl = summaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const cumulativePnl = totalRealizedPnl + totalUnrealizedPnl;
        const totalNetMarketValue = openSummaries.reduce((sum, summary) => sum + (Number(summary.marketValue) || 0), 0);
        const totalWeight = Number.isFinite(totalEquity) && Math.abs(totalEquity) > INVESTMENT_LIVE_DIGIT_EPSILON
            ? (totalNetMarketValue / totalEquity) * 100
            : 0;

        const cashNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]');
        const totalEquityNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_total_equity"]');
        const cumulativeNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_cumulative_pnl"]');
        const summaryUnrealizedNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_unrealized_pnl"]');
        const summaryWeightNode = document.querySelector('#investment_holdings_panel [data-investment-live-field="summary_position_weight"]');
        const summaryUnrealizedCell = summaryUnrealizedNode?.closest('td');

        updateInvestmentLiveValueNode(
            cashNode,
            aggregateCash === null ? '-' : formatHoldingsMoney(aggregateCash),
            aggregateCash,
        );
        updateInvestmentLiveValueNode(
            totalEquityNode,
            totalEquity === null ? '-' : formatHoldingsMoney(totalEquity),
            totalEquity,
        );
        syncInvestmentLiveTone(cashNode, aggregateCash, { enableSignedTone: aggregateCash !== null });
        syncInvestmentLiveTone(totalEquityNode, totalEquity, { enableSignedTone: totalEquity !== null });
        const metricsCumulativeNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_cumulative_pnl"]');
        const metricsUnrealizedNode = document.querySelector('#investment_metrics_panel [data-investment-live-field="metrics_unrealized_pnl"]');
        const metricsCumulativeTrigger = metricsCumulativeNode?.closest('.investment-metric-tooltip-trigger');
        const metricsUnrealizedTrigger = metricsUnrealizedNode?.closest('.investment-metric-tooltip-trigger');

        updateInvestmentLiveValueNode(cumulativeNode, formatSignedHoldingsMoney(cumulativePnl), cumulativePnl);
        updateInvestmentLiveValueNode(summaryUnrealizedNode, formatHoldingsMoney(totalUnrealizedPnl), totalUnrealizedPnl);
        updateInvestmentLiveValueNode(summaryWeightNode, formatHoldingsPercent(totalWeight), totalWeight);
        updateInvestmentLiveValueNode(metricsCumulativeNode, formatSignedHoldingsMoney(cumulativePnl), cumulativePnl);
        updateInvestmentLiveValueNode(metricsUnrealizedNode, formatSignedHoldingsMoney(totalUnrealizedPnl), totalUnrealizedPnl);
        syncInvestmentLiveTone(cumulativeNode, cumulativePnl, { enableSignedTone: true });
        syncInvestmentLiveTone([summaryUnrealizedNode, summaryUnrealizedCell], totalUnrealizedPnl, { enableSignedTone: true });
        syncInvestmentLiveTone([metricsCumulativeNode, metricsCumulativeTrigger], cumulativePnl, { enableSignedTone: true });
        syncInvestmentLiveTone([metricsUnrealizedNode, metricsUnrealizedTrigger], totalUnrealizedPnl, { enableSignedTone: true });
        syncInvestmentStockDetailsRealtimeMetrics();
    }

    function syncInvestmentStockDetailsRealtimeMetrics() {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = normalizeInvestmentTicker(selectedInvestmentStockTicker || '');
        if (!activeTicker || activeInvestmentView !== 'stock_details') return;
        const tickerSummary = investmentTickerSummariesCache.find((summary) => (
            normalizeInvestmentTicker(summary?.ticker) === activeTicker
        ));
        if (!tickerSummary) return;

        const totalPnl = (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const updates = [
            {
                field: 'stock_unrealized_pnl',
                display: tickerSummary.unrealizedPnl === null ? '-' : formatHoldingsMoney(tickerSummary.unrealizedPnl),
                value: tickerSummary.unrealizedPnl,
                signedTone: true,
            },
            {
                field: 'stock_total_pnl',
                display: formatHoldingsMoney(totalPnl),
                value: totalPnl,
                signedTone: true,
            },
            {
                field: 'stock_market_value',
                display: tickerSummary.hasOpenPosition ? formatHoldingsMoney(tickerSummary.marketValue) : '-',
                value: tickerSummary.hasOpenPosition ? tickerSummary.marketValue : null,
                signedTone: false,
            },
            {
                field: 'stock_last_price',
                display: tickerSummary.lastPrice === null ? '-' : formatHoldingsMoney(tickerSummary.lastPrice),
                value: tickerSummary.lastPrice,
                signedTone: false,
                directionTone: true,
            },
            {
                field: 'stock_position_weight',
                display: tickerSummary.hasOpenPosition ? formatHoldingsPercent(tickerSummary.positionWeight) : '-',
                value: tickerSummary.hasOpenPosition ? tickerSummary.positionWeight : null,
                signedTone: false,
            },
        ];

        updates.forEach((update) => {
            const node = investmentStockDetailsPanel.querySelector(
                `[data-investment-live-field="${CSS.escape(update.field)}"][data-investment-live-ticker="${CSS.escape(activeTicker)}"]`
            );
            const previousValue = Number(node?.dataset.investmentLiveNumber);
            updateInvestmentLiveValueNode(node, update.display, update.value);
            if (update.signedTone) {
                syncInvestmentLiveTone(node, update.value, { enableSignedTone: Number.isFinite(Number(update.value)) });
            }
            if (update.directionTone) {
                syncInvestmentLiveDirectionTone(node, previousValue, update.value);
            }
        });
    }

    function renderInvestmentStockDetailsMetricValueSpan(value, valueClass = '') {
        const className = [
            'trade-metric-value',
            'investment-stock-details-metric-value',
            valueClass,
        ].filter(Boolean).join(' ');
        return `<span class="${className}">${renderWorkspaceMetricValueContent(value)}</span>`;
    }

    function renderInvestmentStockDetailsLiveMetricValueSpan(metric, activeTicker) {
        const className = [
            'investment-live-value',
            'trade-metric-value',
            'investment-stock-details-metric-value',
            metric?.valueClass || '',
        ].filter(Boolean).join(' ');
        const display = metric?.value || '-';
        const numeric = metric?.liveNumber;
        const numberAttr = Number.isFinite(Number(numeric))
            ? ` data-investment-live-number="${escapeHtml(String(numeric))}"`
            : '';
        const tickerAttr = activeTicker ? ` data-investment-live-ticker="${escapeHtml(activeTicker)}"` : '';
        return `<span class="${className}" data-investment-live-field="${escapeHtml(metric?.liveField || '')}"${tickerAttr}${numberAttr} data-investment-live-display="${escapeHtml(display)}">${renderWorkspaceMetricValueContent(display)}</span>`;
    }

    function renderInvestmentStockDetailsPanel(tickerProfiles = {}) {
        if (!(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = ensureSelectedInvestmentStockTicker();
        destroyInvestmentStockDetailsPriceChart();
        if (!activeTicker) {
            clearInvestmentStockDetailsRangeControlBindings();
            investmentStockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
            if (investmentStockDetailsTableHost instanceof HTMLElement) {
                investmentStockDetailsTableHost.innerHTML = '';
                syncInvestmentStockDetailsTableVisibility();
            }
            syncSelectedStockLinkState();
            return;
        }
        clearInvestmentStockDetailsRangeControlBindings();
        const tickerSummary = investmentTickerSummariesCache.find((summary) => normalizeInvestmentTicker(summary?.ticker) === activeTicker) || createPositionState(activeTicker);
        const profile = resolveInvestmentTickerProfile(tickerProfiles, activeTicker);
        const displayTicker = formatInvestmentTickerForDisplay(activeTicker);
        const companyName = resolveInvestmentTickerCompanyName(tickerProfiles, activeTicker);
        const logoUrls = resolveInvestmentLogoUrls(profile, activeTicker);
        const detailRows = buildInvestmentStockDetailRows(investmentProcessedTransactionsCache, activeTicker);
        const totalCommission = detailRows.reduce((sum, txn) => sum + Math.abs(getTransactionCommission(txn)), 0);
        const totalCommissionCurrency = detailRows
            .map((txn) => formatTransactionCurrency(txn))
            .find((currency) => String(currency || '').trim());
        const normalizedTotalCommissionCurrency = String(totalCommissionCurrency || '').trim().toUpperCase();
        const totalCommissionDisplay = totalCommissionCurrency
            ? (normalizedTotalCommissionCurrency === 'USD'
                ? formatMetricLossAmount(totalCommission)
                : formatMetricLossAmountWithCurrency(totalCommission, totalCommissionCurrency))
            : formatMetricLossAmount(totalCommission);
        const totalCommissionClass = getNegativeMetricClass(totalCommission);
        const totalTradeCount = detailRows.filter((txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            return normalizedType === 'buy' || normalizedType === 'sell';
        }).length;
        const averagePriceDisplay = tickerSummary.averagePrice === null ? '-' : formatHoldingsMoney(tickerSummary.averagePrice);
        const totalTradeCountDisplay = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(totalTradeCount);
        const realizedBreakdown = getStockDetailRealizedBreakdown(detailRows);
        const brokerMetricDetails = buildInvestmentStockDetailBrokerMetrics(detailRows, activeTicker, tickerSummary.lastPrice);
        const hasBrokerMetricBreakdown = brokerMetricDetails.length > 1;
        const totalPnl = (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const totalPnlClass = totalPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const realizedClass = (Number(tickerSummary.realizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const unrealizedClass = (Number(tickerSummary.unrealizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const lastPriceDisplay = tickerSummary.lastPrice === null ? '-' : formatHoldingsMoney(tickerSummary.lastPrice);
        const lastPriceClass = resolveInvestmentLastPriceToneClass(tickerSummary.lastPrice, activeTicker);
        const weightDisplay = tickerSummary.hasOpenPosition ? formatHoldingsPercent(tickerSummary.positionWeight) : '-';
        const stockMetricCards = [
            {
                label: 'Unrealized P&L',
                value: tickerSummary.unrealizedPnl === null ? '-' : formatHoldingsMoney(tickerSummary.unrealizedPnl),
                valueClass: tickerSummary.unrealizedPnl === null ? '' : unrealizedClass,
                liveField: 'stock_unrealized_pnl',
                liveNumber: tickerSummary.unrealizedPnl,
            },
            {
                label: 'Realized P&L',
                value: formatHoldingsMoney(tickerSummary.realizedPnl),
                valueClass: realizedClass,
                cardClass: 'investment-stock-details-metric-card-with-breakdown',
                details: [
                    realizedBreakdown.dividendIncome !== 0 && {
                        label: 'Dividend income',
                        value: formatHoldingsMoney(realizedBreakdown.dividendIncome),
                        valueClass: getSignedMetricClass(realizedBreakdown.dividendIncome),
                    },
                    realizedBreakdown.paymentInLieuIncome !== 0 && {
                        label: 'Payment in lieu',
                        value: formatHoldingsMoney(realizedBreakdown.paymentInLieuIncome),
                        valueClass: getSignedMetricClass(realizedBreakdown.paymentInLieuIncome),
                    },
                    realizedBreakdown.dividendWithholding !== 0 && {
                        label: 'Foreign tax withholding',
                        value: formatHoldingsMoney(realizedBreakdown.dividendWithholding),
                        valueClass: getSignedMetricClass(realizedBreakdown.dividendWithholding),
                    },
                    realizedBreakdown.tradingSpreadIncome !== 0 && {
                        label: 'Trading spread income',
                        value: formatHoldingsMoney(realizedBreakdown.tradingSpreadIncome),
                        valueClass: getSignedMetricClass(realizedBreakdown.tradingSpreadIncome),
                    },
                ].filter(Boolean),
            },
            {
                label: 'Total P&L',
                value: formatHoldingsMoney(totalPnl),
                valueClass: totalPnlClass,
                liveField: 'stock_total_pnl',
                liveNumber: totalPnl,
            },
            {
                label: 'Position',
                value: formatHoldingsPosition(tickerSummary.shares),
                valueClass: '',
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.positionDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: 'Market value',
                value: tickerSummary.hasOpenPosition ? formatHoldingsMoney(tickerSummary.marketValue) : '-',
                valueClass: '',
                liveField: 'stock_market_value',
                liveNumber: tickerSummary.hasOpenPosition ? tickerSummary.marketValue : null,
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.marketValueDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: 'Average price',
                value: averagePriceDisplay,
                valueClass: '',
            },
            {
                label: 'Last price',
                value: lastPriceDisplay,
                valueClass: lastPriceClass.trim(),
                liveField: 'stock_last_price',
                liveNumber: tickerSummary.lastPrice,
            },
            {
                label: 'Portfolio weight',
                value: weightDisplay,
                valueClass: '',
                liveField: 'stock_position_weight',
                liveNumber: tickerSummary.hasOpenPosition ? tickerSummary.positionWeight : null,
            },
            {
                label: 'Total trades',
                value: totalTradeCountDisplay,
                valueClass: '',
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.totalTradesDisplay,
                            valueClass: '',
                        }))
                    : [],
            },
            {
                label: 'Total commission',
                value: totalCommissionDisplay,
                valueClass: totalCommissionClass,
                details: hasBrokerMetricBreakdown
                    ? brokerMetricDetails
                        .filter((metric) => !isFlatPosition(metric.shares))
                        .map((metric) => ({
                            label: metric.brokerLabel,
                            value: metric.totalCommissionDisplay,
                            valueClass: getNegativeMetricClass(metric.totalCommission),
                        }))
                    : [],
            },
        ];
        const rowsHtml = detailRows.length
            ? renderInvestmentStockDetailsTableRowsMarkup(detailRows)
            : `
            <tr>
                <td colspan="10" class="investment-history-empty-cell">No ticker-linked transactions are available for this stock.</td>
            </tr>
        `;
        investmentStockDetailsPanel.innerHTML = `
            <div class="investment-stock-details-overview">
                <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-stock-details-identity">
                    <div class="ticker-identity-row">
                        <img class="ticker-identity-logo"
                             alt=""
                             hidden
                             loading="lazy"
                             decoding="async"
                             data-investment-logo-image
                             data-logo-url="${escapeHtml(JSON.stringify(logoUrls))}"
                             data-ticker="${escapeHtml(activeTicker)}">
                        <span class="ticker-identity-logo ticker-identity-logo-placeholder" aria-hidden="true"></span>
                        <span class="ticker-identity-copy">
                            <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(displayTicker)}</span>
                            ${renderInvestmentTickerIdentityNameHtml(companyName)}
                        </span>
                    </div>
                </div>
                <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid investment-stock-details-metrics">
                    ${stockMetricCards.map((metric) => `
                        <div class="trade-metric-card trade-metric-card--value-align-end investment-stock-details-metric-card${metric.cardClass ? ` ${metric.cardClass}` : ''}">
                            <span class="trade-metric-label">${metric.label}</span>
                            ${metric.liveField
                                ? renderInvestmentStockDetailsLiveMetricValueSpan(metric, activeTicker)
                                : renderInvestmentStockDetailsMetricValueSpan(metric.value, metric.valueClass)}
                            ${Array.isArray(metric.details) && metric.details.length ? `
                                <div class="investment-stock-details-metric-breakdown">
                                    ${metric.details.map((detail) => `
                                        <div class="investment-stock-details-metric-breakdown-row">
                                            <span class="investment-stock-details-metric-breakdown-label">${detail.label}</span>
                                            <span class="investment-stock-details-metric-breakdown-value${detail.valueClass ? ` ${detail.valueClass}` : ''}">${renderWorkspaceMetricValueContent(detail.value)}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="investment-stock-details-price-chart-card">
                    ${renderInvestmentStockDetailsRangeControl()}
                    <div class="investment-stock-details-price-chart-shell" data-investment-stock-price-chart></div>
                </div>
                <div class="investment-stock-details-donut-card">
                    ${buildInvestmentStockDonutMarkup(tickerSummary, profile)}
                </div>
            </div>
        `;
        if (investmentStockDetailsTableHost instanceof HTMLElement) {
            investmentStockDetailsTableHost.innerHTML = `
                <div class="scrollable-data-table-shell investment-history-table-shell investment-stock-details-table-shell">
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table" aria-hidden="true">
                        ${renderInvestmentStockDetailsColgroup()}
                        <thead>
                        <tr>
                            <th aria-label="Broker">${renderInvestmentBrokerFilterHeaderInnerMarkup('investment_stock_details_broker_filter')}</th>
                            <th>No.</th>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Description</th>
                            <th>Currency</th>
                            <th>Amount</th>
                            <th>Commission</th>
                            <th>Market value</th>
                            <th>Realized P&amp;L</th>
                        </tr>
                        </thead>
                    </table>
                    <div class="trade-transactions-wrap scrollable-data-table-scroll investment-history-table-scroll investment-stock-details-table-scroll">
                        <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table investment-stock-details-table">
                            ${renderInvestmentStockDetailsColgroup()}
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
            attachStockDetailsTableAlignmentSync(investmentStockDetailsTableHost);
            mountInvestmentBrokerFilterHeaders(investmentStockDetailsTableHost);
            bindStockDetailsHistoryInteractions(investmentStockDetailsTableHost);
            syncInvestmentStockDetailsTableVisibility();
        }
        bindInvestmentStockDetailsRangeControls(activeTicker, detailRows);
        renderInvestmentStockDetailsPriceChart(activeTicker, detailRows);
        bindHoldingsLogoFallbacks(investmentStockDetailsPanel);
        syncSelectedStockLinkState();
        syncInvestmentStockDetailsDonutFromInteraction();
        scheduleInvestmentStockDetailsVisibleLayoutSync();
    }

    function selectInvestmentStockTicker(ticker, { focusView = false } = {}) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (normalizedTicker) {
            selectedInvestmentStockTicker = normalizedTicker;
        }
        rememberInvestmentPageState({ ticker: selectedInvestmentStockTicker, view: focusView ? 'stock_details' : activeInvestmentView || 'chart' });
        if (focusView) {
            setInvestmentView('stock_details', { syncHash: false });
        }
        renderInvestmentStockDetailsPanel(window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {});
        if (focusView || activeInvestmentView === 'stock_details') {
            syncInvestmentViewHash('stock_details', selectedInvestmentStockTicker);
        }
    }

    function syncInvestmentViewFromLocationHash(fallbackView = 'chart') {
        const hash = String(window.location.hash || '').trim();
        if (hash === INVESTMENT_STOCK_DETAILS_HASH || hash === LEGACY_INVESTMENT_STOCK_DETAILS_HASH) {
            const locationTicker = getInvestmentLocationTicker();
            if (locationTicker) {
                selectedInvestmentStockTicker = locationTicker;
            }
            ensureSelectedInvestmentStockTicker();
            setInvestmentView('stock_details', { syncHash: false });
            return;
        }
        setInvestmentView(fallbackView, { syncHash: false });
    }

    function bindInvestmentHistoryChartInteractions(historyContainer) {
        if (!historyContainer) return;
        const hoverContainer = historyContainer.closest('#history_table_wrap')
            || historyContainer.closest('.investment-history-table-shell')
            || historyContainer;
        setInvestmentHoverContainerPayload(hoverContainer, null);
        bindInvestmentHoverContainerPersistence(hoverContainer);
        historyContainer.querySelectorAll('tr[data-investment-history-row]').forEach((row) => {
            if (row.dataset.chartHoverBound === '1') return;
            row.dataset.chartHoverBound = '1';
            const activateChartMarker = () => {
                const ledgerNo = Number(row.dataset.investmentHistoryRow || 0);
                const ledgerDate = getInvestmentLedgerDateByLedgerNo(ledgerNo) || row.dataset.investmentHistoryDate || '';
                const stockDetailLedgerNo = getFirstStockDetailLedgerNoForDate(ledgerDate);
                const hoverPayload = {
                    hoverTicker: row.dataset.investmentHistoryTicker || '',
                    hoverLedgerNo: ledgerNo,
                    historyLedgerNos: [ledgerNo],
                    stockDetailLedgerNos: stockDetailLedgerNo > 0 ? [stockDetailLedgerNo] : [],
                    interactionLedgerNo: stockDetailLedgerNo > 0 ? stockDetailLedgerNo : ledgerNo,
                    historyBehavior: 'auto',
                    historyScroll: false,
                    stockDetailBehavior: 'auto',
                    stockDetailScroll: stockDetailLedgerNo > 0,
                };
                setInvestmentHoverContainerPayload(hoverContainer, hoverPayload);
                syncInvestmentHoverLinkedViews(hoverPayload);
            };
            const clearChartMarker = () => {
                if (hoverContainer instanceof HTMLElement && hoverContainer.matches(':hover')) return;
                clearInvestmentChartLinkedHoverState();
            };
            row.addEventListener('mouseenter', activateChartMarker);
            row.addEventListener('mouseleave', clearChartMarker);
            row.addEventListener('focusin', activateChartMarker);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearChartMarker();
            });
        });
    }

    function isInvestmentHistoryDisplayHidden(txn) {
        return txn?.presentation_hidden === true;
    }

    function getVisibleInvestmentHistoryTransactions(processedTransactions = [], chartPoints = []) {
        const brokerFilteredRows = getInvestmentBrokerFilteredTransactionRows(processedTransactions);
        if (normalizeInvestmentEquityRange(selectedInvestmentEquityRange) === 'max') {
            return brokerFilteredRows.map((row) => row.txn);
        }
        const normalizedChartPoints = Array.isArray(chartPoints) ? chartPoints : [];
        const visibleRangeLabels = new Set(getInvestmentEquityRangeLabels(
            normalizedChartPoints.map((point) => point?.date),
            selectedInvestmentEquityRange,
        ));
        if (!visibleRangeLabels.size) {
            return brokerFilteredRows.map((row) => row.txn);
        }
        return brokerFilteredRows
            .filter((row) => visibleRangeLabels.has(row.dateLabel))
            .map((row) => row.txn);
    }

    function getInvestmentHistoryTotalPages(totalRows = 0) {
        const normalizedTotalRows = Math.max(0, Number(totalRows) || 0);
        return Math.max(1, Math.ceil(normalizedTotalRows / INVESTMENT_HISTORY_PAGE_SIZE));
    }

    function buildInvestmentHistoryPaginationSlots(totalPages = 1, currentPage = 1) {
        const normalizedTotalPages = Math.max(1, Number(totalPages) || 1);
        const normalizedCurrentPage = Math.min(normalizedTotalPages, Math.max(1, Number(currentPage) || 1));
        const currentGroupIndex = Math.floor((normalizedCurrentPage - 1) / INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT);
        const startPage = (currentGroupIndex * INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT) + 1;
        const pageSlots = Array.from({ length: INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT }, (_, index) => {
            const page = startPage + index;
            if (page > normalizedTotalPages) {
                return { page: 0, isActive: false };
            }
            return { page, isActive: page === normalizedCurrentPage };
        });
        return {
            previousPage: startPage > 1 ? startPage - 1 : 0,
            pageSlots,
            nextPage: startPage + INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT <= normalizedTotalPages
                ? startPage + INVESTMENT_HISTORY_PAGINATION_SLOT_COUNT
                : 0,
        };
    }

    function ensureInvestmentHistoryPaginationIndicator(pagination) {
        if (!(pagination instanceof HTMLElement)) return null;
        let indicator = pagination.querySelector('.local-store-pagination-indicator');
        if (!(indicator instanceof HTMLElement)) {
            indicator = document.createElement('span');
            indicator.className = 'local-store-pagination-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            pagination.prepend(indicator);
        }
        return indicator;
    }

    function positionInvestmentHistoryPaginationIndicator({ immediate = false } = {}) {
        if (!(investmentHistoryPagination instanceof HTMLElement) || investmentHistoryPagination.hidden) return;
        const target = investmentHistoryPagination.querySelector('.local-store-page-button.is-active');
        if (!(target instanceof HTMLElement)) return;
        const indicator = ensureInvestmentHistoryPaginationIndicator(investmentHistoryPagination);
        if (!(indicator instanceof HTMLElement)) return;
        const navRect = investmentHistoryPagination.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const x = targetRect.left - navRect.left;
        const y = targetRect.top - navRect.top;
        if (immediate) indicator.style.transition = 'none';
        indicator.style.width = `${targetRect.width}px`;
        indicator.style.height = `${targetRect.height}px`;
        indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        investmentHistoryPagination.classList.add('is-animated');
        if (immediate) {
            void indicator.offsetWidth;
            indicator.style.removeProperty('transition');
        }
    }

    function getInvestmentHistoryPaginationButtonRect(button) {
        if (!(investmentHistoryPagination instanceof HTMLElement) || !(button instanceof HTMLElement)) return null;
        const navRect = investmentHistoryPagination.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
            x: buttonRect.left - navRect.left,
            y: buttonRect.top - navRect.top,
            width: buttonRect.width,
            height: buttonRect.height,
        };
    }

    function captureInvestmentHistoryPaginationAnimation(targetPage) {
        if (!(investmentHistoryPagination instanceof HTMLElement) || investmentHistoryPagination.hidden) return null;
        const current = investmentHistoryPagination.querySelector('.local-store-page-button.is-active')
            || investmentHistoryPagination.querySelector('.local-store-page-button[data-pagination-current="1"]');
        const fromRect = getInvestmentHistoryPaginationButtonRect(current);
        if (!fromRect) return null;
        return {
            fromRect,
            targetPage: Number(targetPage),
        };
    }

    function getInvestmentHistoryPaginationMotionDurationMs() {
        if (!(investmentHistoryPagination instanceof HTMLElement)) return 500;
        const styles = window.getComputedStyle(investmentHistoryPagination);
        const rawDuration = styles.getPropertyValue('--local-store-pagination-motion-duration').trim();
        const parsedDuration = Number.parseFloat(rawDuration);
        if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return 500;
        return rawDuration.endsWith('ms') ? parsedDuration : parsedDuration * 1000;
    }

    function animateInvestmentHistoryPaginationIndicator(animationState) {
        if (!(investmentHistoryPagination instanceof HTMLElement) || investmentHistoryPagination.hidden) {
            positionInvestmentHistoryPaginationIndicator({ immediate: true });
            return;
        }
        const fromRect = animationState?.fromRect;
        const targetPage = Number(animationState?.targetPage);
        const target = Number.isFinite(targetPage)
            ? investmentHistoryPagination.querySelector(
                `.local-store-page-button[data-investment-history-page-target="${CSS.escape(String(targetPage))}"]:not(.local-store-page-nav)`
            )
            : investmentHistoryPagination.querySelector('.local-store-page-button.is-active');
        if (!(target instanceof HTMLElement) || !fromRect) {
            positionInvestmentHistoryPaginationIndicator({ immediate: true });
            return;
        }
        const indicator = ensureInvestmentHistoryPaginationIndicator(investmentHistoryPagination);
        if (!(indicator instanceof HTMLElement)) return;
        investmentHistoryPagination.classList.add('is-animated', 'is-animating');
        indicator.style.transition = 'none';
        indicator.style.width = `${fromRect.width}px`;
        indicator.style.height = `${fromRect.height}px`;
        indicator.style.transform = `translate3d(${fromRect.x}px, ${fromRect.y}px, 0)`;
        void indicator.offsetWidth;
        indicator.style.removeProperty('transition');
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                const targetRect = getInvestmentHistoryPaginationButtonRect(target);
                if (!targetRect) {
                    positionInvestmentHistoryPaginationIndicator({ immediate: true });
                    return;
                }
                indicator.style.width = `${targetRect.width}px`;
                indicator.style.height = `${targetRect.height}px`;
                indicator.style.transform = `translate3d(${targetRect.x}px, ${targetRect.y}px, 0)`;
            });
        });
        window.setTimeout(() => {
            investmentHistoryPagination?.classList.remove('is-animating');
        }, getInvestmentHistoryPaginationMotionDurationMs());
    }

    function renderInvestmentHistoryPagination(totalRows = 0) {
        if (!(investmentHistoryPagination instanceof HTMLElement)) return;
        const pendingAnimation = investmentHistoryPendingPaginationAnimation;
        investmentHistoryPendingPaginationAnimation = null;
        const totalPages = getInvestmentHistoryTotalPages(totalRows);
        if (totalRows <= INVESTMENT_HISTORY_PAGE_SIZE) {
            investmentHistoryPagination.hidden = true;
            investmentHistoryPagination.innerHTML = '';
            investmentHistoryPagination.classList.remove('is-animated', 'is-animating');
            return;
        }
        investmentHistoryCurrentPage = Math.min(totalPages, Math.max(1, investmentHistoryCurrentPage || 1));
        const { previousPage, pageSlots, nextPage } = buildInvestmentHistoryPaginationSlots(totalPages, investmentHistoryCurrentPage);
        investmentHistoryPagination.hidden = false;
        investmentHistoryPagination.classList.remove('is-animated', 'is-animating');
        investmentHistoryPagination.innerHTML = `
            <span class="local-store-pagination-indicator" aria-hidden="true"></span>
            ${previousPage
                ? `<button type="button" class="local-store-page-button local-store-page-nav" data-investment-history-page-target="${previousPage}" aria-label="Previous pages"><span class="icon icon-page-prev" aria-hidden="true"></span></button>`
                : '<span class="local-store-page-button local-store-page-placeholder" aria-hidden="true"></span>'}
            ${pageSlots.map((slot) => (
                slot.page
                    ? `<button type="button" class="local-store-page-button${slot.isActive ? ' is-active' : ''}" data-investment-history-page-target="${slot.page}" data-pagination-current="${slot.isActive ? '1' : '0'}"${slot.isActive ? ' aria-current="page"' : ''}>${slot.page}</button>`
                    : '<span class="local-store-page-button local-store-page-placeholder" aria-hidden="true"></span>'
            )).join('')}
            ${nextPage
                ? `<button type="button" class="local-store-page-button local-store-page-nav" data-investment-history-page-target="${nextPage}" aria-label="Next pages"><span class="icon icon-page-next" aria-hidden="true"></span></button>`
                : '<span class="local-store-page-button local-store-page-placeholder" aria-hidden="true"></span>'}
        `;
        window.requestAnimationFrame(() => {
            if (pendingAnimation) {
                animateInvestmentHistoryPaginationIndicator(pendingAnimation);
                return;
            }
            positionInvestmentHistoryPaginationIndicator({ immediate: true });
        });
    }

    function getInvestmentHistoryPageForLedgerNos(ledgerNos = []) {
        const normalizedLedgerNos = normalizeInvestmentLedgerNos(ledgerNos);
        if (!normalizedLedgerNos.length || !Array.isArray(investmentHistoryVisibleTransactionsCache) || !investmentHistoryVisibleTransactionsCache.length) {
            return 0;
        }
        const targetIndex = investmentHistoryVisibleTransactionsCache.findIndex((txn) => normalizedLedgerNos.includes(Number(txn?.ledger_no)));
        if (targetIndex < 0) return 0;
        return Math.floor(targetIndex / INVESTMENT_HISTORY_PAGE_SIZE) + 1;
    }

    function resetInvestmentHistoryScrollPosition() {
        const scrollContainer = getInvestmentHistoryScrollContainer();
        if (scrollContainer instanceof HTMLElement) {
            scrollContainer.scrollTop = 0;
        }
    }

    function bindInvestmentHistoryPagination() {
        if (!(investmentHistoryPagination instanceof HTMLElement) || investmentHistoryPagination.dataset.bound === '1') return;
        investmentHistoryPagination.dataset.bound = '1';
        const handleInvestmentHistoryPaginationActivation = (event) => {
            const button = event.target instanceof Element
                ? event.target.closest('[data-investment-history-page-target]')
                : null;
            if (!(button instanceof HTMLElement)) return;
            if (button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true') return;
            const targetPage = Number(button.dataset.investmentHistoryPageTarget || 0);
            if (!Number.isFinite(targetPage) || targetPage <= 0 || targetPage === investmentHistoryCurrentPage) return;
            event.preventDefault();
            investmentHistoryPendingPaginationAnimation = captureInvestmentHistoryPaginationAnimation(targetPage);
            investmentHistoryCurrentPage = targetPage;
            renderInvestmentHistoryTableRows(investmentProcessedTransactionsCache, investmentChartPointsCache, { scrollToTop: true });
        };
        investmentHistoryPagination.addEventListener('click', handleInvestmentHistoryPaginationActivation);
        window.addEventListener('resize', () => {
            positionInvestmentHistoryPaginationIndicator({ immediate: true });
        });
    }

    function renderInvestmentHistoryTableRows(processedTransactions = [], chartPoints = [], { resetPage = false, scrollToTop = false } = {}) {
        const tbody = getInvestmentHistoryTableBody();
        if (!(tbody instanceof HTMLElement)) return;
        clearInvestmentHistoryHighlights();
        const visibleTransactions = getVisibleInvestmentHistoryTransactions(processedTransactions, chartPoints);
        investmentHistoryVisibleTransactionsCache = [...visibleTransactions].reverse();
        if (!visibleTransactions.length) {
            investmentHistoryCurrentPage = 1;
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="investment-history-empty-cell">No transactions fall within the selected range.</td>
                </tr>
            `;
            renderInvestmentHistoryPagination(0);
            attachHistoryTableAlignmentSync(historyTable);
            return;
        }
        const totalPages = getInvestmentHistoryTotalPages(investmentHistoryVisibleTransactionsCache.length);
        if (resetPage) {
            investmentHistoryCurrentPage = 1;
        } else {
            investmentHistoryCurrentPage = Math.min(totalPages, Math.max(1, investmentHistoryCurrentPage || 1));
        }
        const pageStart = (investmentHistoryCurrentPage - 1) * INVESTMENT_HISTORY_PAGE_SIZE;
        let pageTransactions = investmentHistoryVisibleTransactionsCache.slice(pageStart, pageStart + INVESTMENT_HISTORY_PAGE_SIZE);
        if (!pageTransactions.length && investmentHistoryVisibleTransactionsCache.length) {
            investmentHistoryCurrentPage = totalPages;
            const fallbackPageStart = (investmentHistoryCurrentPage - 1) * INVESTMENT_HISTORY_PAGE_SIZE;
            pageTransactions = investmentHistoryVisibleTransactionsCache.slice(
                fallbackPageStart,
                fallbackPageStart + INVESTMENT_HISTORY_PAGE_SIZE,
            );
        }
        tbody.innerHTML = pageTransactions.map((txn) => renderInvestmentHistoryRowMarkup(txn)).join('');
        renderInvestmentHistoryPagination(investmentHistoryVisibleTransactionsCache.length);
        bindInvestmentHistoryChartInteractions(tbody);
        bindInvestmentHistoryTransferControls(tbody);
        attachHistoryTableAlignmentSync(historyTable);
        if (scrollToTop) {
            resetInvestmentHistoryScrollPosition();
        }
    }

    async function renderTransactionTable(transactions, { preserveHistoryPage = false, scrollToTop = true } = {}) {
        const tbody = getInvestmentHistoryTableBody();
        if (!tbody) return { isDegraded: false, message: '' };
        clearInvestmentHistoryHighlights();
        syncInvestmentHistoryHeading();
        investmentRawTransactionsCache = Array.isArray(transactions) ? [...transactions] : [];

        if (!transactions.length) {
            investmentProcessedTransactionsCache = [];
            refreshInvestmentAvailableBrokerCodes();
            setInvestmentExportButtonVisibility(false);
            syncHoldingsChartHoverState('', 0);
            resetInvestmentDashboard();
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="investment-history-empty-cell">
                        <div class="investment-history-empty-state" role="status" aria-live="polite">
                            <p class="investment-history-empty-title"><strong>Import or sync broker activity to begin.</strong></p>
                            <p class="investment-history-empty-step">➊ Click <span class="investment-inline-plus-icon" aria-hidden="true"></span> above to open the import panel.</p>
                            <p class="investment-history-empty-step">➋ Select a broker, then upload IBKR CSV files or paste the HSBC USD Savings, Portfolio, and Order Status page text.</p>
                            <p class="investment-history-empty-step">➌ IBKR, Longbridge (HK)/(SG), and HSBC are available through their current import adapters.</p>
                        </div>
                    </td>
                </tr>
            `;
            initializeInvestmentBrokerFilterSelection();
            mountInvestmentBrokerFilterHeaders();
            renderInvestmentHistoryPagination(0);
            attachHistoryTableAlignmentSync(historyTable);
            return { isDegraded: false, message: '' };
        }

        setInvestmentExportButtonVisibility(true);

        // 1. Sort by date ascending to calculate running cash and holdings
        // Read starting_cash from top-level JSON if available, otherwise default to 0
        const baseCurrency = getInvestmentBaseCurrency();
        const aggregateStartingCash = getInvestmentStartingCash();
        const aggregateLedgerState = {
            cashBalances: createCashLedger(aggregateStartingCash, baseCurrency),
            runningCash: aggregateStartingCash,
            pendingSettlementCash: 0,
            holdings: {},
            moneyMarketAnchors: {},
        };
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const priceHistoryFailures = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_failures || [];
        const tickerClosePrices = normalizePriceHistoryPayload(priceHistoryRows);
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const lastKnownTickerPrices = {};

        const orderedTransactions = [...transactions].sort((left, right) => compareInvestmentTransactions(left, right));
        const hsbcAvailableCashWindowStartDate = orderedTransactions.reduce((latestDate, txn) => {
            if (normalizeInvestmentBroker(getTransactionBrokerCode(txn)) !== 'hsbc') return latestDate;
            const settlementDate = normalizeLedgerDate(txn?.source?.cash_settlement_date);
            if (!settlementDate) return latestDate;
            return !latestDate || settlementDate > latestDate ? settlementDate : latestDate;
        }, '');
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const payloadBrokerCodes = Array.isArray(window.ANTIGRAVITY_INVESTMENT_DATA?.brokers)
            ? window.ANTIGRAVITY_INVESTMENT_DATA.brokers.map((broker) => normalizeInvestmentBroker(broker)).filter(Boolean)
            : [];
        const orderedBrokerCodes = Array.from(new Set(orderedTransactions.map((txn) => getTransactionBrokerCode(txn))));
        const effectiveBrokerCodes = payloadBrokerCodes.length ? payloadBrokerCodes : orderedBrokerCodes;
        const isSingleBrokerPortfolio = effectiveBrokerCodes.length <= 1;
        const singleBrokerCode = isSingleBrokerPortfolio
            ? normalizeInvestmentBroker(effectiveBrokerCodes[0] || window.ANTIGRAVITY_INVESTMENT_DATA?.broker || 'ibkr')
            : '';
        const brokerLedgerStates = new Map();

        function createLedgerState(startingCash = 0) {
            const numericStartingCash = Number(startingCash);
            const safeStartingCash = Number.isFinite(numericStartingCash) ? numericStartingCash : 0;
            return {
                cashBalances: createCashLedger(safeStartingCash, baseCurrency),
                runningCash: safeStartingCash,
                pendingSettlementCash: 0,
                holdings: {},
                moneyMarketAnchors: {},
            };
        }

        function getBrokerLedgerState(brokerCode) {
            const normalizedBrokerCode = normalizeInvestmentBroker(brokerCode);
            if (!brokerLedgerStates.has(normalizedBrokerCode)) {
                const brokerStartingCash = isSingleBrokerPortfolio && normalizedBrokerCode === singleBrokerCode
                    ? aggregateStartingCash
                    : 0;
                brokerLedgerStates.set(normalizedBrokerCode, createLedgerState(brokerStartingCash));
            }
            return brokerLedgerStates.get(normalizedBrokerCode);
        }

        function applyHoldingStateUpdate(state, txn, normalizedType, valuationQty, price) {
            if (isLongbridgeHkCashEquivalentTransfer(txn)) {
                const syntheticTicker = getLongbridgeHkCashEquivalentSyntheticTicker(txn);
                if (!syntheticTicker) return;
                const valueAfter = Number(
                    txn?.normalized?.cash_equivalent_value_after
                    ?? txn?.source?.cash_equivalent_cost_basis_after_raw
                    ?? 0
                );
                if (!Number.isFinite(valueAfter) || valueAfter <= 1e-9) {
                    delete state.holdings[syntheticTicker];
                    delete state.moneyMarketAnchors[syntheticTicker];
                    return;
                }
                state.holdings[syntheticTicker] = valueAfter;
                state.moneyMarketAnchors[syntheticTicker] = 1;
                return;
            }
            const isSyntheticFractional = isUsmartHkFractionalSharesTransaction(txn);
            if (!txn.ticker && !isSyntheticFractional) return;
            const rawTicker = isSyntheticFractional
                ? USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                : String(txn.ticker).trim().toUpperCase();
            const normalizedTicker = getInvestmentCanonicalTicker(rawTicker);
            if (isForexPairTicker(normalizedTicker)) return;
            if (!normalizedTicker) return;
            let effectiveValuationQty = valuationQty;
            let effectivePrice = price;
            if (
                isSyntheticFractional
                && (effectiveValuationQty === null || Number.isNaN(effectiveValuationQty))
            ) {
                const existingQuantity = Number(state.holdings[normalizedTicker]) || 0;
                const notionalAmount = Math.abs(Number(getTransactionAmount(txn)) || 0);
                effectiveValuationQty = normalizedType === 'sell' && existingQuantity > 0
                    ? existingQuantity
                    : notionalAmount;
            }
            if (effectiveValuationQty === null || Number.isNaN(effectiveValuationQty)) return;
            if (isSyntheticFractional && (!Number.isFinite(effectivePrice) || effectivePrice <= 0)) {
                const notionalAmount = Math.abs(Number(getTransactionAmount(txn)) || 0);
                effectivePrice = notionalAmount > 0 && effectiveValuationQty > 0
                    ? notionalAmount / effectiveValuationQty
                    : 1;
            }
            if (!state.holdings[normalizedTicker]) state.holdings[normalizedTicker] = 0;
            const isMoneyMarketTicker = (
                moneyMarketTickers.has(normalizedTicker)
                || moneyMarketTickers.has(rawTicker)
                || isSyntheticCashEquivalentTicker(normalizedTicker)
            );
            if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) {
                if (isMoneyMarketTicker && effectivePrice !== null && !Number.isNaN(effectivePrice)) {
                    const previousQuantity = state.holdings[normalizedTicker];
                    const previousAnchor = state.moneyMarketAnchors[normalizedTicker] ?? effectivePrice;
                    const nextQuantity = previousQuantity + effectiveValuationQty;
                    state.moneyMarketAnchors[normalizedTicker] = nextQuantity > 0
                        ? (((previousQuantity * previousAnchor) + (effectiveValuationQty * effectivePrice)) / nextQuantity)
                        : effectivePrice;
                }
                state.holdings[normalizedTicker] += effectiveValuationQty;
                return;
            }
            if (normalizedType !== 'sell') return;
            state.holdings[normalizedTicker] -= effectiveValuationQty;
            if (isMoneyMarketTicker && state.holdings[normalizedTicker] > 0 && effectivePrice !== null && !Number.isNaN(effectivePrice)) {
                state.moneyMarketAnchors[normalizedTicker] = state.moneyMarketAnchors[normalizedTicker] ?? effectivePrice;
            }
            if (state.holdings[normalizedTicker] <= 0) {
                delete state.moneyMarketAnchors[normalizedTicker];
            }
            if (Math.abs(state.holdings[normalizedTicker]) < 1e-9) {
                delete state.holdings[normalizedTicker];
            }
        }

        function applyCashStateUpdate(state, transactionCurrency, cashDelta, ledgerDate) {
            addCashLedgerDelta(state.cashBalances, transactionCurrency, cashDelta, baseCurrency);
            state.runningCash = sumCashLedgerInBaseCurrency(state.cashBalances, ledgerDate, fxTimeline, baseCurrency);
        }

        function applyAuthoritativeCashBalance(state, authoritativeCash) {
            const normalizedCash = Number(authoritativeCash);
            if (!Number.isFinite(normalizedCash)) return;
            state.cashBalances = createCashLedger(normalizedCash, baseCurrency);
            state.runningCash = normalizedCash;
        }

        function rebuildAggregateCashState(ledgerDate) {
            const mergedBalances = {};
            brokerLedgerStates.forEach((state) => {
                Object.entries(state?.cashBalances || {}).forEach(([currency, value]) => {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                    mergedBalances[currency] = (Number(mergedBalances[currency]) || 0) + numericValue;
                });
            });
            aggregateLedgerState.cashBalances = mergedBalances;
            aggregateLedgerState.runningCash = sumCashLedgerInBaseCurrency(
                mergedBalances,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
        }

        function calculatePendingSettlementCashDelta(txn) {
            const brokerCode = normalizeInvestmentBroker(getTransactionBrokerCode(txn));
            const normalizedType = getNormalizedTransactionType(txn);
            const hasCashSettlement = (
                txn?.source?.cash_settlement_amount_raw !== undefined
                || txn?.source?.cash_settlement_balance_after_raw !== undefined
            );
            if (
                brokerCode !== 'hsbc'
                || !['buy', 'sell'].includes(normalizedType)
                || txn?.source?.cash_replay_pending_settlement !== true
                || hasCashSettlement
            ) {
                return 0;
            }
            const amount = Number(
                txn?.normalized?.net_amount
                ?? txn?.net_amount_raw
                ?? txn?.gross_amount_raw
                ?? 0
            );
            return Number.isFinite(amount) && amount > 0 ? amount : 0;
        }

        function calculateInvestmentCashDelta(txn) {
            let qty = getTransactionQuantity(txn);
            let amount = getTransactionAmount(txn);
            let price = getTransactionPrice(txn);
            let commission = 0;
            if (txn.normalized?.commission !== undefined && txn.normalized?.commission !== null) commission = Number(txn.normalized.commission);
            else if (txn.commission !== undefined && txn.commission !== null) commission = Number(txn.commission);
            const normalizedType = getNormalizedTransactionType(txn);
            const brokerCode = normalizeInvestmentBroker(getTransactionBrokerCode(txn));
            if (
                brokerCode === 'hsbc'
                && ['buy', 'sell'].includes(normalizedType)
                && txn?.source?.cash_replay_pending_settlement === true
                && txn?.source?.cash_settlement_amount_raw === undefined
                && txn?.source?.cash_settlement_balance_after_raw === undefined
            ) {
                return 0;
            }
            if (normalizedType === 'fx_translation_pnl') {
                return 0;
            }
            if ((amount === 0 || amount === undefined) && qty !== null && price !== null && ['buy', 'sell'].includes(txn.type)) {
                amount = qty * price;
            }

            let cashDelta = 0;
            if (txn.normalized !== undefined) {
                cashDelta += amount;
            } else if (['forex_trade', 'adjustment', 'fx_translation_pnl'].includes(normalizedType)) {
                cashDelta += amount;
            } else if (normalizedType === 'deposit' || normalizedType === 'sell' || normalizedType === 'dividend'
                || normalizedType === 'credit_interest' || normalizedType === 'payment_in_lieu') {
                if (normalizedType === 'sell' && amount && commission) {
                    cashDelta += (amount - commission);
                } else {
                    cashDelta += amount;
                }
            } else if (normalizedType === 'withdrawal' || normalizedType === 'buy' || normalizedType === 'dividend_reinvestment'
                || normalizedType === 'foreign_tax_withholding' || normalizedType === 'debit_interest') {
                if (amount !== 0) {
                    cashDelta += amount;
                }
            }

            const isImported = txn.normalized !== undefined;
            if (!isImported && commission && !['buy', 'sell'].includes(normalizedType)) {
                cashDelta -= Math.abs(commission);
            }
            return Number.isFinite(cashDelta) ? cashDelta : 0;
        }

        function buildInvestmentCashFundingAdjustments(transactionsForReplay) {
            const adjustments = new Map();
            const simulatedBalances = new Map();
            const cashDeltas = transactionsForReplay.map((txn) => calculateInvestmentCashDelta(txn));
            const simulationKeyFor = (txn) => {
                const brokerCode = getTransactionBrokerCode(txn);
                const currency = formatTransactionCurrency(txn) || getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
                return `${brokerCode}|${currency}`;
            };
            const getAdjustment = (index) => Number(adjustments.get(index)) || 0;
            transactionsForReplay.forEach((txn, index) => {
                const key = simulationKeyFor(txn);
                const currentBalance = Number(simulatedBalances.get(key)) || 0;
                let effectiveDelta = cashDeltas[index] + getAdjustment(index);
                let projectedBalance = currentBalance + effectiveDelta;
                if (projectedBalance < -1e-9) {
                    let deficit = Math.abs(projectedBalance);
                    for (let futureIndex = index + 1; futureIndex < transactionsForReplay.length && deficit > 1e-9; futureIndex += 1) {
                        const futureTxn = transactionsForReplay[futureIndex];
                        if (simulationKeyFor(futureTxn) !== key) continue;
                        const availableFutureCash = cashDeltas[futureIndex] + getAdjustment(futureIndex);
                        if (availableFutureCash <= 1e-9) continue;
                        const allocation = Math.min(availableFutureCash, deficit);
                        adjustments.set(index, getAdjustment(index) + allocation);
                        adjustments.set(futureIndex, getAdjustment(futureIndex) - allocation);
                        deficit -= allocation;
                    }
                    effectiveDelta = cashDeltas[index] + getAdjustment(index);
                    projectedBalance = currentBalance + effectiveDelta;
                }
                simulatedBalances.set(key, projectedBalance);
            });
            return adjustments;
        }

        const cashFundingAdjustments = buildInvestmentCashFundingAdjustments(orderedTransactions);
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedTransactions, tickerPriceIndex);
        const processed = orderedTransactions.map((txn, processedIndex) => {
            // ========== COMPLETELY COMPATIBLE FIELD READING ==========
            // 1. Quantity: for holdings and description
            let qty = getTransactionQuantity(txn);
            const valuationQty = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);

            // 2. Net amount: for cash calculation
            let amount = getTransactionAmount(txn);

            // 3. Price: for auto-calculating amount and market value
            let price = getTransactionPrice(txn);

            // 4. Commission: for cash impact
            let commission = 0;
            if (txn.normalized?.commission !== undefined && txn.normalized?.commission !== null) commission = Number(txn.normalized.commission);
            else if (txn.commission !== undefined && txn.commission !== null) commission = Number(txn.commission);

            // Auto-calculate amount if missing but we have quantity and price
            if ((amount === 0 || amount === undefined) && qty !== null && price !== null && ['buy', 'sell'].includes(txn.type)) {
                amount = qty * price;
            }

            // Update holdings based on transaction type
            // Normalize type first
            const normalizedType = getNormalizedTransactionType(txn);
            const brokerCode = getTransactionBrokerCode(txn);
            const brokerLedgerState = getBrokerLedgerState(brokerCode);
            applyHoldingStateUpdate(aggregateLedgerState, txn, normalizedType, valuationQty, price);
            applyHoldingStateUpdate(brokerLedgerState, txn, normalizedType, valuationQty, price);

            if (shouldTrackHoldingTicker(txn) && price !== null && Number.isFinite(price) && price > 0) {
                const priceTicker = getInvestmentCanonicalTicker(txn.ticker);
                if (priceTicker) {
                    lastKnownTickerPrices[priceTicker] = price;
                }
            }

            const ledgerDate = normalizeLedgerDate(txn?.date);
            const transactionCurrency = formatTransactionCurrency(txn) || getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
            const cashDelta = calculateInvestmentCashDelta(txn) + (Number(cashFundingAdjustments.get(processedIndex)) || 0);
            const pendingSettlementDelta = calculatePendingSettlementCashDelta(txn);
            applyCashStateUpdate(aggregateLedgerState, transactionCurrency, cashDelta, ledgerDate);
            applyCashStateUpdate(brokerLedgerState, transactionCurrency, cashDelta, ledgerDate);
            aggregateLedgerState.pendingSettlementCash += pendingSettlementDelta;
            brokerLedgerState.pendingSettlementCash += pendingSettlementDelta;
            const normalizedBrokerCode = normalizeInvestmentBroker(brokerCode);
            const shouldReplayPendingSettlement = (
                normalizedBrokerCode === 'hsbc'
                && txn?.source?.cash_replay_pending_settlement === true
                && txn?.source?.cash_settlement_amount_raw === undefined
                && txn?.source?.cash_settlement_balance_after_raw === undefined
            );
            const transactionDate = normalizeLedgerDate(txn?.date);
            const hasWindowedAvailableCash = (
                txn?.source?.available_cash_after_raw !== undefined
                && txn?.source?.available_cash_after_raw !== null
                && (
                    !hsbcAvailableCashWindowStartDate
                    || !transactionDate
                    || transactionDate >= hsbcAvailableCashWindowStartDate
                )
            );
            const authoritativeHsbcCashAfter = Number(
                (
                    hasWindowedAvailableCash
                        ? txn?.source?.available_cash_after_raw
                        : undefined
                )
                ?? txn?.source?.cash_settlement_balance_after_raw
                ?? (
                    txn?.source?.file_kind === 'hsbc_usd_account_text'
                        ? txn?.source?.balance_after_raw
                        : undefined
                )
            );
            if (
                normalizeInvestmentBroker(brokerCode) === 'hsbc'
                && Number.isFinite(authoritativeHsbcCashAfter)
                && authoritativeHsbcCashAfter >= -1e-9
            ) {
                applyAuthoritativeCashBalance(brokerLedgerState, Math.max(0, authoritativeHsbcCashAfter));
                if (isSingleBrokerPortfolio) {
                    applyAuthoritativeCashBalance(aggregateLedgerState, Math.max(0, authoritativeHsbcCashAfter));
                } else {
                    rebuildAggregateCashState(ledgerDate);
                }
            }
            const normalizedBrokerCashForDisplay = normalizeInvestmentBroker(brokerCode) === 'hsbc'
                ? (
                    shouldReplayPendingSettlement
                        ? brokerLedgerState.runningCash + brokerLedgerState.pendingSettlementCash
                        : brokerLedgerState.runningCash
                )
                : Number(brokerLedgerState.runningCash);
            const aggregateDisplayCash = aggregateLedgerState.runningCash + aggregateLedgerState.pendingSettlementCash;
            const aggregateCashByCurrency = cloneCashLedgerBalances(aggregateLedgerState.cashBalances);
            const brokerCashByCurrency = cloneCashLedgerBalances(brokerLedgerState.cashBalances);
            return {
                ...txn,
                broker: brokerCode,
                ledger_no: processedIndex + 1,
                running_cash: aggregateLedgerState.runningCash,
                cash_by_currency: aggregateCashByCurrency,
                display_amount: getTransactionEconomicAmount(txn),
                holdings: { ...aggregateLedgerState.holdings },
                money_market_anchors: { ...aggregateLedgerState.moneyMarketAnchors },
                aggregate_running_cash: aggregateLedgerState.runningCash,
                aggregate_display_cash: aggregateDisplayCash,
                aggregate_cash_by_currency: aggregateCashByCurrency,
                aggregate_pending_settlement_cash: aggregateLedgerState.pendingSettlementCash,
                aggregate_holdings: { ...aggregateLedgerState.holdings },
                aggregate_money_market_anchors: { ...aggregateLedgerState.moneyMarketAnchors },
                broker_running_cash: brokerLedgerState.runningCash,
                broker_display_cash: normalizedBrokerCashForDisplay,
                broker_cash_by_currency: brokerCashByCurrency,
                broker_pending_settlement_cash: brokerLedgerState.pendingSettlementCash,
                broker_holdings: { ...brokerLedgerState.holdings },
                broker_money_market_anchors: { ...brokerLedgerState.moneyMarketAnchors },
            };
        });

        const authoritativePositionSnapshot = getAuthoritativePositionSnapshot();
        if (authoritativePositionSnapshot !== null && processed.length) {
            const latestProcessed = processed[processed.length - 1];
            const authoritativeHoldings = {};
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const quantity = Number(snapshot?.quantity);
                if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9) return;
                const canonicalTicker = getInvestmentCanonicalTicker(ticker);
                if (!canonicalTicker) return;
                authoritativeHoldings[canonicalTicker] = (Number(authoritativeHoldings[canonicalTicker]) || 0) + quantity;
            });
            latestProcessed.holdings = authoritativeHoldings;
            latestProcessed.aggregate_holdings = { ...authoritativeHoldings };
            if (isSingleBrokerPortfolio) {
                latestProcessed.broker_holdings = { ...authoritativeHoldings };
            }
        }

        // Get latest price from parquet (last available close) for final valuation
        const latestPrices = {};
        Object.entries(tickerClosePrices).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            if (dates.length > 0) {
                latestPrices[ticker] = dateMap[dates[dates.length - 1]];
            }
        });
        Object.entries(lastKnownTickerPrices).forEach(([ticker, price]) => {
            if (!Number.isFinite(latestPrices[ticker]) && Number.isFinite(price)) {
                latestPrices[ticker] = price;
            }
        });
        if (authoritativePositionSnapshot !== null) {
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const snapshotLastPrice = Number(snapshot?.lastPrice);
                if (Number.isFinite(snapshotLastPrice) && snapshotLastPrice > 0) {
                    latestPrices[ticker] = snapshotLastPrice;
                }
            });
        }

        // 2. For each transaction, get the closest available close price on or before the transaction date
        //    and calculate total equity = cash + sum(holdings * historical close price)
        const fallbackTickers = new Set();
        const missingTickers = new Set();
        function calculateTransactionMarketValue(txn, holdingsSnapshot, moneyMarketAnchorSnapshot) {
            let marketValue = 0;
            Object.entries(holdingsSnapshot || {}).forEach(([ticker, quantity]) => {
                const normalizedTicker = String(ticker).trim().toUpperCase();
                if (isForexPairTicker(normalizedTicker)) return;
                const isMoneyMarketTicker = (
                    moneyMarketTickers.has(normalizedTicker)
                    || isSyntheticCashEquivalentTicker(normalizedTicker)
                );
                const valuationDate = normalizeLedgerDate(txn.date);
                let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const transactionValuationTicker = isUsmartHkFractionalSharesTransaction(txn)
                        ? USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                        : getInvestmentCanonicalTicker(txn.ticker);
                    const sameDaySellPrice = normalizedTicker === transactionValuationTicker
                        && getNormalizedTransactionType(txn) === 'sell'
                        ? getTransactionPrice(txn)
                        : null;
                    const anchoredPrice = moneyMarketAnchorSnapshot?.[ticker] ?? moneyMarketAnchorSnapshot?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                if (!Number.isFinite(closePrice) || Math.abs(closePrice) < 1e-9) {
                    const fallbackPrice = lastKnownTickerPrices[normalizedTicker];
                    if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                        closePrice = fallbackPrice;
                        fallbackTickers.add(normalizedTicker);
                    } else {
                        closePrice = 0;
                        missingTickers.add(normalizedTicker);
                    }
                }
                const quoteCurrency = getTickerQuoteCurrency(ticker);
                marketValue += convertAmountToBaseCurrency(
                    quantity * closePrice,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            });
            return marketValue;
        }

        processed.forEach((txn) => {
            const aggregateHoldings = txn.aggregate_holdings || txn.holdings || {};
            const aggregateMoneyMarketAnchors = txn.aggregate_money_market_anchors || txn.money_market_anchors || {};
            const aggregateRunningCash = Number(txn.aggregate_running_cash ?? txn.running_cash) || 0;
            const aggregatePendingSettlementCash = Number(txn.aggregate_pending_settlement_cash) || 0;
            const aggregateDisplayCash = Number.isFinite(Number(txn.aggregate_display_cash))
                ? Number(txn.aggregate_display_cash)
                : aggregateRunningCash + aggregatePendingSettlementCash;
            const brokerHoldings = txn.broker_holdings || {};
            const brokerMoneyMarketAnchors = txn.broker_money_market_anchors || {};
            const brokerRunningCash = Number(txn.broker_running_cash) || 0;
            const brokerPendingSettlementCash = Number(txn.broker_pending_settlement_cash) || 0;
            const brokerDisplayCash = Number.isFinite(Number(txn.broker_display_cash))
                ? Number(txn.broker_display_cash)
                : brokerRunningCash + brokerPendingSettlementCash;
            const aggregateMarketValue = calculateTransactionMarketValue(txn, aggregateHoldings, aggregateMoneyMarketAnchors);
            const brokerMarketValue = calculateTransactionMarketValue(txn, brokerHoldings, brokerMoneyMarketAnchors);

            txn.aggregate_market_value = aggregateMarketValue;
            txn.aggregate_total_equity = aggregateDisplayCash + aggregateMarketValue;
            txn.broker_market_value = brokerMarketValue;
            txn.broker_total_equity = brokerDisplayCash + brokerMarketValue;

            txn.market_value = aggregateMarketValue;
            txn.total_equity = txn.aggregate_total_equity;
        });
        applyAuthoritativeBrokerEndingCashBalances(processed);
        if (authoritativePositionSnapshot !== null && processed.length) {
            const latestProcessed = processed[processed.length - 1];
            const authoritativeEndingCash = getInvestmentEndingCash();
            const authoritativeMarketValue = Object.values(authoritativePositionSnapshot).reduce((sum, snapshot) => {
                const marketValue = Number(snapshot?.marketValue);
                return Number.isFinite(marketValue) ? (sum + marketValue) : sum;
            }, 0);
            if (authoritativeEndingCash !== null) {
                latestProcessed.running_cash = authoritativeEndingCash;
                latestProcessed.aggregate_running_cash = authoritativeEndingCash;
            }
            if (Number.isFinite(authoritativeMarketValue) && authoritativeMarketValue > 0) {
                latestProcessed.market_value = authoritativeMarketValue;
                latestProcessed.aggregate_market_value = authoritativeMarketValue;
            }
            const aggregatePendingSettlementCash = Number(latestProcessed.aggregate_pending_settlement_cash) || 0;
            latestProcessed.aggregate_display_cash = latestProcessed.running_cash + aggregatePendingSettlementCash;
            latestProcessed.total_equity = latestProcessed.aggregate_display_cash + latestProcessed.market_value;
            latestProcessed.aggregate_total_equity = latestProcessed.total_equity;
            if (isSingleBrokerPortfolio) {
                latestProcessed.broker_running_cash = latestProcessed.aggregate_running_cash ?? latestProcessed.running_cash;
                latestProcessed.broker_display_cash = latestProcessed.aggregate_display_cash;
                latestProcessed.broker_market_value = latestProcessed.aggregate_market_value ?? latestProcessed.market_value;
                latestProcessed.broker_total_equity = latestProcessed.aggregate_total_equity ?? latestProcessed.total_equity;
                latestProcessed.broker_cash_by_currency = { ...(latestProcessed.aggregate_cash_by_currency || latestProcessed.cash_by_currency || {}) };
            }
        }

        applyInvestmentInternalTransferBindings(processed);

        Object.keys(latestPrices).forEach((ticker) => {
            if (moneyMarketTickers.has(String(ticker).trim().toUpperCase())) {
                const lastProcessedWithAnchor = [...processed].reverse().find((txn) => (
                    txn.money_market_anchors?.[ticker] !== undefined
                ));
                if (lastProcessedWithAnchor) {
                    latestPrices[ticker] = lastProcessedWithAnchor.money_market_anchors[ticker];
                }
            }
        });

        const latestSnapshot = processed[processed.length - 1];
        let chartPoints = buildDailyEquityChartPoints(processed, tickerClosePrices, moneyMarketTickers);
        investmentBaseChartPointsCache = Array.isArray(chartPoints) ? [...chartPoints] : [];
        investmentChartPointsCache = isInvestmentDailyEquityLiveRange()
            ? ensureInvestmentLiveSessionChartSlot(investmentBaseChartPointsCache)
            : [...investmentBaseChartPointsCache];
        investmentProcessedTransactionsCache = Array.isArray(processed) ? processed : [];
        refreshInvestmentAvailableBrokerCodes();
        investmentBaseLatestPricesCache = latestPrices && typeof latestPrices === 'object' ? { ...latestPrices } : {};
        investmentLatestPricesCache = latestPrices && typeof latestPrices === 'object' ? { ...latestPrices } : {};

        // Use server-preloaded realtime quotes (now using efficient batched yfinance download)
        // for immediate render. The additional client-side bootstrap (for freshest possible)
        // is fired without await so a large number of holdings after IBKR import does not
        // block the UI / import completion feedback.
        const embeddedQuotes = getInvestmentEmbeddedRealtimeQuotes();
        const bootstrapRealtimeQuotes = mergeInvestmentRealtimeQuotePayloads(embeddedQuotes);
        const bootstrapSessionQuotes = bootstrapRealtimeQuotes.filter((quote) => shouldApplyInvestmentRealtimePriceForHoldings(quote));
        if (bootstrapSessionQuotes.length) {
            applyInvestmentSessionRealtimePrices(latestPrices, bootstrapSessionQuotes);
            if (isInvestmentDailyEquityLiveRange()) {
                const liveChartPoints = buildInvestmentRealtimeChartPoints(bootstrapSessionQuotes);
                if (liveChartPoints.length) {
                    chartPoints = liveChartPoints;
                    investmentChartPointsCache = [...liveChartPoints];
                }
            }
        }

        // Fire-and-forget fresher quotes (using efficient batched yfinance).
        // The main render uses the server-preloaded quotes so import doesn't block on this.
        // Subsequent poll / interactions will pick up fresher data via caches.
        bootstrapInvestmentSessionRealtimeQuotes(latestSnapshot).then((fresh) => {
            const merged = mergeInvestmentRealtimeQuotePayloads(embeddedQuotes, fresh);
            const sessionQuotes = merged.filter((quote) => shouldApplyInvestmentRealtimePriceForHoldings(quote));
            if (sessionQuotes.length) {
                applyInvestmentSessionRealtimePrices(latestPrices, sessionQuotes);
                if (isInvestmentDailyEquityLiveRange()) {
                    const livePoints = buildInvestmentRealtimeChartPoints(sessionQuotes);
                    if (livePoints.length) {
                        investmentChartPointsCache = [...livePoints];
                    }
                }
            }
        }).catch((err) => {
            if (!isLifecycleInterruptedFetch(err)) {
                console.warn('Post-import realtime bootstrap failed', err);
            }
        });

        const valuationStatus = buildValuationStatus({
            backendFailures: priceHistoryFailures,
            fallbackTickers: Array.from(fallbackTickers),
            missingTickers: Array.from(missingTickers),
            openTickers: window.ANTIGRAVITY_INVESTMENT_DATA?.section_freshness?.open_tickers || [],
        });

        // 3. Render reverse chronological rows constrained by the active equity range
        initializeInvestmentBrokerFilterSelection();
        mountInvestmentBrokerFilterHeaders();
        renderInvestmentHistoryTableRows(processed, chartPoints, { resetPage: !preserveHistoryPage, scrollToTop });

        // 4. Update dashboard with latest total equity
        updateDashboardWithEquity(processed, latestSnapshot, latestPrices, transactions, chartPoints, tickerClosePrices);
        restartInvestmentRealtimeQuotePolling();
        return valuationStatus;
    }

    function updateDashboardWithEquity(
        processed,
        latestSnapshot,
        latestPrices,
        rawTransactions,
        chartPoints = [],
        tickerClosePrices = {},
        { refreshStockDetailsPanel = true } = {},
    ) {
        const last = latestSnapshot || processed[processed.length - 1];
        if (!last) return;
        const AGGREGATE_TOTAL_EQUITY = getLatestDashboardEquity(processed, chartPoints);

        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!holdingsPanel || !metricsPanel || !(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const shouldAnimateVisibleMetricsPanel = (
            activeInvestmentView === 'holdings'
            || activeInvestmentView === 'metrics'
            || (activeInvestmentView === 'stock_details' && refreshStockDetailsPanel)
        );
        if (shouldAnimateVisibleMetricsPanel) {
            lockInvestmentSurfaceHeight();
        }
        setInvestmentSharedChartDateRange(chartPoints);

        const tickerProfiles = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {};
        investmentDummyTickerProfiles = tickerProfiles;
        investmentTickerClosePricesCache = tickerClosePrices && typeof tickerClosePrices === 'object'
            ? { ...tickerClosePrices }
            : {};
        const mergedLatestPrices = {
            ...(latestPrices && typeof latestPrices === 'object' ? latestPrices : {}),
            ...(investmentLatestPricesCache && typeof investmentLatestPricesCache === 'object' ? investmentLatestPricesCache : {}),
        };
        const tickerSummaries = buildTickerSummaries(rawTransactions, mergedLatestPrices, AGGREGATE_TOTAL_EQUITY, tickerClosePrices);
        const fundingMetrics = getUsdFundingMetrics(processed);
        const holdingsSummaryMetrics = getHoldingsSummaryMetrics(rawTransactions, mergedLatestPrices, AGGREGATE_TOTAL_EQUITY);
        const brokerBenefitMetrics = getBrokerBenefitMetrics(rawTransactions, mergedLatestPrices, AGGREGATE_TOTAL_EQUITY);
        if (investmentProcessedTransactionsCache !== processed) {
            investmentProcessedTransactionsCache = Array.isArray(processed) ? processed : [];
            refreshInvestmentAvailableBrokerCodes();
        }
        investmentTickerSummariesCache = Array.isArray(tickerSummaries) ? [...tickerSummaries] : [];
        syncHoldingsChartHoverState('', 0);
        const rawAggregateDisplayCash = Number(last?.aggregate_display_cash);
        const AGGREGATE_CASH = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : Number(last?.aggregate_running_cash ?? last?.running_cash);
        holdingsPanel.innerHTML = renderHoldingsTable(tickerSummaries, tickerProfiles, AGGREGATE_TOTAL_EQUITY, AGGREGATE_CASH);
        attachHoldingsTableAlignmentSync(holdingsPanel);
        bindHoldingsLogoFallbacks(holdingsPanel);
        bindHoldingsHistoryInteractions(holdingsPanel);
        bindHoldingsStockDetailsLinks(holdingsPanel);
        if (refreshStockDetailsPanel) {
            renderInvestmentStockDetailsPanel(tickerProfiles);
        } else if (activeInvestmentView === 'stock_details') {
            syncInvestmentStockDetailsRealtimeMetrics();
        }
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length ? chartPoints[chartPoints.length - 1] : null;
        renderInvestmentDummyPortfolioDonut(latestChartPoint || {
            aggregate_running_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_display_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_total_equity: Number(last?.aggregate_total_equity ?? last?.total_equity) || Number(last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_holdings_market_values: {},
            running_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            total_equity: Number(last?.aggregate_total_equity ?? last?.total_equity) || Number(last?.aggregate_running_cash ?? last?.running_cash) || 0,
            holdings_market_values: {},
        }, tickerProfiles);

        metricsPanel.innerHTML = renderFundingMetricCards(fundingMetrics, holdingsSummaryMetrics, brokerBenefitMetrics);
        bindInvestmentMetricTooltipInteractions(metricsPanel);
        if (shouldAnimateVisibleMetricsPanel) {
            animateInvestmentSurfaceHeight();
        }
        updateInvestmentEquityChartDisplay(getInvestmentEquityChartInputPoints(chartPoints));
        syncInvestmentDummyDonutFromInteraction();
        syncInvestmentStockDetailsDonutFromInteraction();
    }

    function roundInvestmentChartCurrencyValue(value) {
        const normalizedValue = Number(value);
        if (!Number.isFinite(normalizedValue)) return null;
        return Math.round(normalizedValue * 100) / 100;
    }

    function buildInvestmentEquityChartRenderState(chartPoints = [], overviewIntradayLinePoints = []) {
        const useOverviewIntradayLineRequested = isInvestmentOverviewIntradayEquityRange();
        const preparedChartPoints = (Array.isArray(chartPoints) ? chartPoints : [])
            .filter((point) => useOverviewIntradayLineRequested ? point?.is_realtime !== true : true);
        const normalizedChartPoints = useOverviewIntradayLineRequested
            ? preparedChartPoints
            : ensureInvestmentLiveSessionChartSlot(preparedChartPoints);
        const sortedChartPoints = (useOverviewIntradayLineRequested
            ? normalizedChartPoints
            : dedupeInvestmentChartPointsByLedgerDate(normalizedChartPoints))
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        setInvestmentSharedChartDateRange(sortedChartPoints);
        const fullChartPointIndexByLedgerNo = new Map();
        sortedChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                fullChartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        const visibleRangeLabels = new Set(getInvestmentEquityRangeLabels(
            sortedChartPoints.map((point) => point.date),
            selectedInvestmentEquityRange,
        ));
        const visibleChartPointEntries = sortedChartPoints
            .map((point, sourceIndex) => ({ point, sourceIndex }))
            .filter(({ point }) => (
                !visibleRangeLabels.size
                || visibleRangeLabels.has(normalizeLedgerDate(point?.date))
            ));
        const allPointEntries = sortedChartPoints.map((point, sourceIndex) => ({ point, sourceIndex }));
        const firstLedgerAnchoredPointSourceIndex = allPointEntries.findIndex(({ point }) => (
            Array.isArray(point?.anchor_ledger_nos)
            && point.anchor_ledger_nos.some((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                return Number.isFinite(normalizedLedgerNo) && normalizedLedgerNo > 0;
            })
        ));
        const visiblePoints = visibleRangeLabels.size
            ? visibleChartPointEntries
            : allPointEntries;
        const renderableVisiblePoints = visiblePoints.filter(({ sourceIndex }) => (
            firstLedgerAnchoredPointSourceIndex < 0
            || sourceIndex >= firstLedgerAnchoredPointSourceIndex
        ));
        const visibleChartPoints = renderableVisiblePoints.map(({ point }) => point);
        const visiblePointSourceIndexes = renderableVisiblePoints.map(({ sourceIndex }) => sourceIndex);
        const normalizedIntradayLinePoints = (Array.isArray(overviewIntradayLinePoints) ? overviewIntradayLinePoints : [])
            .map((entry) => ({
                date: String(entry?.date || ''),
                equity: entry?.equity !== null && entry?.equity !== undefined && Number.isFinite(Number(entry.equity))
                    ? roundInvestmentChartCurrencyValue(entry.equity)
                    : null,
                point: entry?.point || null,
            }))
            .filter((entry) => entry.date);
        const useOverviewIntradayLine = isInvestmentOverviewIntradayEquityRange()
            && normalizedIntradayLinePoints.length >= 390;
        const rawDates = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.date)
            : visibleChartPoints.map((point) => point.date);
        const equity = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.equity)
            : visibleChartPoints.map((point) => roundInvestmentChartCurrencyValue(point.aggregate_total_equity ?? point.total_equity));
        const historicalEquity = useOverviewIntradayLine
            ? normalizedIntradayLinePoints
                .map((entry) => entry.equity)
                .filter((value) => Number.isFinite(value))
            : visibleChartPoints
            .filter((point) => point?.is_realtime !== true)
            .map((point) => roundInvestmentChartCurrencyValue(point.aggregate_total_equity ?? point.total_equity))
            .filter((value) => Number.isFinite(value));
        const renderedVisibleChartPoints = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.point || {
                date: entry.date,
                aggregate_total_equity: entry.equity,
                total_equity: entry.equity,
                anchor_ledger_date: '',
                anchor_ledger_nos: [],
            })
            : visibleChartPoints;
        const renderedVisiblePointSourceIndexes = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map(() => -1)
            : visiblePointSourceIndexes;
        const visibleChartPointIndexByLedgerNo = new Map();
        visibleChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                visibleChartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        return {
            sortedChartPoints,
            fullChartPointIndexByLedgerNo,
            visibleChartPoints: renderedVisibleChartPoints,
            visiblePointSourceIndexes: renderedVisiblePointSourceIndexes,
            visibleChartPointIndexByLedgerNo,
            rawDates,
            labels: [...rawDates],
            equity,
            historicalEquity,
            overviewIntradayLinePoints: useOverviewIntradayLine ? normalizedIntradayLinePoints : [],
            latestChartPoint: sortedChartPoints[sortedChartPoints.length - 1] || null,
        };
    }

    function syncInvestmentEquityChartCaches(chartState) {
        investmentChartPointsCache = Array.isArray(chartState?.sortedChartPoints) ? chartState.sortedChartPoints : [];
        investmentChartPointIndexByLedgerNo = chartState?.fullChartPointIndexByLedgerNo instanceof Map
            ? chartState.fullChartPointIndexByLedgerNo
            : new Map();
        investmentLatestChartPoint = chartState?.latestChartPoint || null;
        activeChartTooltipPointIndex = -1;
    }

    function syncInvestmentEquityChartRealtime(chartPoints = []) {
        if (!investmentEquityChartInstance || !window.Chart) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        if (
            isInvestmentOverviewIntradayEquityRange()
            || investmentEquityChartRuntimeState?.overviewIntradayLinePoints?.length
        ) {
            return;
        }
        const canvas = investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        const previousRuntimeState = investmentEquityChartRuntimeState || {};
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints);
        const previousLabels = Array.isArray(previousRuntimeState.labels) ? previousRuntimeState.labels : [];
        const nextLabels = Array.isArray(nextChartState.labels) ? nextChartState.labels : [];
        const labelsStable = previousLabels.length === nextLabels.length
            && previousLabels.every((label, index) => label === nextLabels[index]);
        const chartYPaddingPx = 5;
        const nextYScale = labelsStable && previousRuntimeState.frozenYScale
            ? previousRuntimeState.frozenYScale
            : buildPixelPaddedInvestmentEquityYScale(
                canvas,
                nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
                chartYPaddingPx,
            );
        investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: previousRuntimeState.realtimeMarkerElement || null,
        };
        syncInvestmentEquityChartCaches(investmentEquityChartRuntimeState);
        if (!labelsStable) {
            investmentEquityChartInstance.data.labels = [...investmentEquityChartRuntimeState.labels];
            investmentEquityChartInstance.data.rawLabels = [...investmentEquityChartRuntimeState.rawDates];
        }
        if (Array.isArray(investmentEquityChartInstance.data.datasets) && investmentEquityChartInstance.data.datasets[0]) {
            investmentEquityChartInstance.data.datasets[0].data = [...investmentEquityChartRuntimeState.equity];
        }
        const yScale = investmentEquityChartInstance.options?.scales?.y;
        if (yScale && !labelsStable) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        investmentEquityChartInstance.update('none');
    }

    function applyInvestmentEquityRangeChange(chartPoints = []) {
        if (!investmentEquityChartInstance || !window.Chart) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        const canvas = investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }

        if (!isInvestmentOverviewIntradayEquityRange()) {
            investmentOverviewIntradayRenderSerial += 1;
        }

        const cachedOverviewIntradayLinePoints = isInvestmentOverviewIntradayEquityRange()
            ? getCachedInvestmentOverviewIntradayLinePoints()
            : [];
        const initialOverviewIntradayLinePoints = isInvestmentOverviewIntradayEquityRange()
            ? (cachedOverviewIntradayLinePoints.length
                ? cachedOverviewIntradayLinePoints
                : buildInvestmentOverviewEmptyIntradayLinePoints())
            : [];

        const previousRuntimeState = investmentEquityChartRuntimeState || {};
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints, initialOverviewIntradayLinePoints);
        const chartYPaddingPx = 5;
        const nextYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
            chartYPaddingPx,
        );
        const realtimeMarkerElement = previousRuntimeState.realtimeMarkerElement
            || canvas.closest('.investment-equity-chart-stage')?.querySelector('[data-investment-equity-live-marker]');

        investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: realtimeMarkerElement instanceof HTMLElement ? realtimeMarkerElement : null,
        };
        syncInvestmentEquityChartCaches(investmentEquityChartRuntimeState);
        investmentEquityChartInstance.data.labels = [...investmentEquityChartRuntimeState.labels];
        investmentEquityChartInstance.data.rawLabels = [...investmentEquityChartRuntimeState.rawDates];
        const dataset = investmentEquityChartInstance.data.datasets?.[0];
        if (dataset) {
            dataset.data = [...investmentEquityChartRuntimeState.equity];
            dataset.showLine = true;
            dataset.spanGaps = false;
            dataset.borderColor = "#0055cc";
            dataset.segment = {
                borderColor: (context) => getInvestmentEquitySegmentBorderColor(context, "#0055cc"),
            };
        }
        const yScale = investmentEquityChartInstance.options?.scales?.y;
        if (yScale) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        investmentEquityChartInstance.update('none');
        if (isInvestmentOverviewIntradayEquityRange()) {
            scheduleInvestmentOverviewIntradayLinePoints(chartPoints);
        }
    }

    function updateInvestmentEquityChartDisplay(chartPoints = []) {
        const inputPoints = Array.isArray(chartPoints) ? chartPoints : [];
        if (!inputPoints.length) {
            renderEquityChartWithEquity(inputPoints);
            return;
        }
        if (investmentEquityChartInstance?.canvas?.isConnected) {
            applyInvestmentEquityRangeChange(inputPoints);
            return;
        }
        renderEquityChartWithEquity(inputPoints);
    }

    window.addEventListener('antigravity:theme-mode-change', () => {
        window.requestAnimationFrame(() => {
            if (investmentEquityChartInstance?.canvas?.isConnected) {
                renderEquityChartWithEquity(investmentChartPointsCache);
            }
            if (investmentStockDetailsPriceChartInstance?.canvas?.isConnected && selectedInvestmentStockTicker) {
                renderInvestmentStockDetailsPriceChart(
                    selectedInvestmentStockTicker,
                    buildInvestmentStockDetailRows(investmentProcessedTransactionsCache, selectedInvestmentStockTicker)
                );
            }
        });
    });

    function applyInvestmentOverviewIntradayLinePoints(chartPoints = [], overviewIntradayLinePoints = []) {
        if (!investmentEquityChartInstance || !window.Chart) return;
        const canvas = investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return;
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints, overviewIntradayLinePoints);
        if (!nextChartState.overviewIntradayLinePoints.length) return;
        cacheInvestmentOverviewIntradayLinePoints(nextChartState.overviewIntradayLinePoints);
        const chartYPaddingPx = 5;
        const nextYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
            chartYPaddingPx,
        );
        investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: investmentEquityChartRuntimeState?.realtimeMarkerElement || null,
        };
        syncInvestmentEquityChartCaches(investmentEquityChartRuntimeState);
        investmentEquityChartInstance.data.labels = [...investmentEquityChartRuntimeState.labels];
        investmentEquityChartInstance.data.rawLabels = [...investmentEquityChartRuntimeState.rawDates];
        if (Array.isArray(investmentEquityChartInstance.data.datasets) && investmentEquityChartInstance.data.datasets[0]) {
            investmentEquityChartInstance.data.datasets[0].data = [...investmentEquityChartRuntimeState.equity];
            investmentEquityChartInstance.data.datasets[0].showLine = true;
            investmentEquityChartInstance.data.datasets[0].spanGaps = false;
            investmentEquityChartInstance.data.datasets[0].borderColor = "#0055cc";
            investmentEquityChartInstance.data.datasets[0].segment = {
                borderColor: (context) => getInvestmentEquitySegmentBorderColor(context, "#0055cc"),
            };
        }
        const yScale = investmentEquityChartInstance.options?.scales?.y;
        if (yScale) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        investmentEquityChartInstance.update('none');
    }

    function scheduleInvestmentOverviewIntradayLinePoints(chartPoints = []) {
        const requestSerial = ++investmentOverviewIntradayRenderSerial;
        if (!isInvestmentOverviewIntradayEquityRange()) return;
        const normalizedRange = normalizeInvestmentEquityRange(selectedInvestmentEquityRange);
        const requestedDayCount = getInvestmentOverviewIntradayDayCount(normalizedRange);
        const readiness = requestedDayCount
            ? refreshInvestmentMarketSessionState({ dayCount: requestedDayCount, force: true })
            : Promise.resolve(investmentMarketSessionState);
        readiness.then(() => {
            if (requestSerial !== investmentOverviewIntradayRenderSerial) return;
            if (!isInvestmentOverviewIntradayEquityRange()) return;
            return buildInvestmentOverviewIntradayLinePoints();
        }).then((linePoints) => {
            if (requestSerial !== investmentOverviewIntradayRenderSerial) return;
            if (!isInvestmentOverviewIntradayEquityRange()) return;
            if (!Array.isArray(linePoints) || linePoints.length < 390) return;
            const cachedLinePoints = getCachedInvestmentOverviewIntradayLinePoints();
            if (
                cachedLinePoints.length
                && !shouldUseInvestmentOverviewIntradayLinePoints(linePoints, cachedLinePoints)
            ) {
                applyInvestmentOverviewIntradayLinePoints(chartPoints, cachedLinePoints);
                return;
            }
            if (
                !cachedLinePoints.length
                && !getInvestmentOverviewIntradayLineQuality(linePoints).isHealthy
            ) {
                return;
            }
            applyInvestmentOverviewIntradayLinePoints(chartPoints, linePoints);
        }).catch((error) => {
            console.warn(error);
        });
    }

    function buildPixelPaddedInvestmentEquityYScale(canvas, dataset = [], paddingPx = 0) {
        const values = (Array.isArray(dataset) ? dataset : [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));
        if (!values.length) return {};
        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return {};
        if (rawMin === rawMax) {
            const fallbackPadding = Math.abs(rawMin || 1) * 0.02 || 1;
            return {
                min: rawMin - fallbackPadding,
                max: rawMax + fallbackPadding,
                rawMin,
                rawMax,
            };
        }
        const canvasHeight = Math.max(canvas?.clientHeight || 0, 80);
        const safePaddingPx = Math.max(0, paddingPx);
        const usableHeight = Math.max(canvasHeight - (safePaddingPx * 2), 1);
        const dataRange = rawMax - rawMin;
        const dataPadding = dataRange * (safePaddingPx / usableHeight);
        return {
            min: rawMin - dataPadding,
            max: rawMax + dataPadding,
            rawMin,
            rawMax,
        };
    }

    // Reuse the same chart styling from the backtest page
    function renderEquityChartWithEquity(chartPoints) {
        if (!chartPoints.length || !window.Chart) {
            clearInvestmentEquityRangeControlBindings();
            if (investmentEquityChartInstance) {
                investmentEquityChartInstance.destroy();
                investmentEquityChartInstance = null;
            }
            investmentEquityChartRuntimeState = null;
            setInvestmentChartReady(false);
            console.warn('Chart.js not available');
            return;
        }

        const container = document.getElementById('investment_equity_chart');
        if (!container) {
            clearInvestmentEquityRangeControlBindings();
            if (investmentEquityChartInstance) {
                investmentEquityChartInstance.destroy();
                investmentEquityChartInstance = null;
            }
            investmentEquityChartRuntimeState = null;
            setInvestmentChartReady(false);
            console.warn('Chart container not found');
            return;
        }

        clearInvestmentEquityRangeControlBindings();
        container.innerHTML = `${renderInvestmentEquityRangeControl()}<div class="investment-equity-chart-stage"><canvas id="investmentEquityChart"></canvas><div class="investment-equity-live-marker" data-investment-equity-live-marker hidden aria-hidden="true"><span class="investment-equity-live-marker-ring investment-equity-live-marker-ring-outer"></span><span class="investment-equity-live-marker-ring investment-equity-live-marker-ring-inner"></span><span class="investment-equity-live-marker-core"></span></div></div>`;
        const canvas = document.getElementById('investmentEquityChart');
        const realtimeMarkerElement = container.querySelector('[data-investment-equity-live-marker]');
        const existingChart = window.Chart.getChart?.(canvas);
        if (existingChart) existingChart.destroy();
        if (investmentEquityChartInstance) {
            investmentEquityChartInstance.destroy();
            investmentEquityChartInstance = null;
        }
        investmentEquityChartRuntimeState = null;
        setInvestmentChartReady(false, canvas);

        const referenceLineWidth = 2.0;
        const cachedOverviewIntradayLinePoints = isInvestmentOverviewIntradayEquityRange()
            ? getCachedInvestmentOverviewIntradayLinePoints()
            : [];
        const initialOverviewIntradayLinePoints = isInvestmentOverviewIntradayEquityRange()
            ? (cachedOverviewIntradayLinePoints.length
                ? cachedOverviewIntradayLinePoints
                : buildInvestmentOverviewEmptyIntradayLinePoints())
            : [];
        const chartState = buildInvestmentEquityChartRenderState(chartPoints, initialOverviewIntradayLinePoints);
        syncInvestmentEquityChartCaches(chartState);

        // Read theme tokens
        const resolvedTheme = resolveInvestmentTheme();
        const equitySeriesColor = "#0055cc";

        const fixedYAxisWidth = 52;
        let activeChartHoverDate = "";
        const getRuntimeState = () => investmentEquityChartRuntimeState || chartState;

        const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

        const parseRawDate = (value) => {
            if (typeof value !== "string") return null;
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!match) return null;
            return {
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
                hours: match[4] ? Number(match[4]) : null,
                minutes: match[5] ? Number(match[5]) : null,
            };
        };

        const formatChartDateLines = (dateParts) => formatInvestmentFullDateLines(dateParts, { allowWrap: true });

        const hoverGuidePlugin = {
            id: "investmentHoverGuidePlugin",
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, tooltip } = chartInstance;
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.muted;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            },
        };

        const animateHoldingsMarkerToward = (targetPoint, chartInstance) => {
            if (!targetPoint) {
                animatedHoldingsMarkerPoint = null;
                animatedHoldingsMarkerTarget = null;
                if (animatedHoldingsMarkerFrame) {
                    window.cancelAnimationFrame(animatedHoldingsMarkerFrame);
                    animatedHoldingsMarkerFrame = 0;
                }
                return;
            }
            const normalizedTarget = {
                x: Number(targetPoint.x),
                y: Number(targetPoint.y),
            };
            if (!Number.isFinite(normalizedTarget.x) || !Number.isFinite(normalizedTarget.y)) return;
            const sameTarget = animatedHoldingsMarkerTarget
                && Math.abs(animatedHoldingsMarkerTarget.x - normalizedTarget.x) < 0.25
                && Math.abs(animatedHoldingsMarkerTarget.y - normalizedTarget.y) < 0.25;
            animatedHoldingsMarkerTarget = normalizedTarget;
            if (!animatedHoldingsMarkerPoint) {
                animatedHoldingsMarkerPoint = { ...normalizedTarget };
                return;
            }
            if (sameTarget) return;
            const startPoint = { ...animatedHoldingsMarkerPoint };
            animatedHoldingsMarkerStartTime = performance.now();
            if (animatedHoldingsMarkerFrame) {
                window.cancelAnimationFrame(animatedHoldingsMarkerFrame);
            }
            const step = (now) => {
                const progress = Math.min(1, (now - animatedHoldingsMarkerStartTime) / 300);
                const eased = easeOutCubic(progress);
                animatedHoldingsMarkerPoint = {
                    x: startPoint.x + ((normalizedTarget.x - startPoint.x) * eased),
                    y: startPoint.y + ((normalizedTarget.y - startPoint.y) * eased),
                };
                chartInstance.draw();
                if (progress < 1) {
                    animatedHoldingsMarkerFrame = window.requestAnimationFrame(step);
                    return;
                }
                animatedHoldingsMarkerPoint = { ...normalizedTarget };
                animatedHoldingsMarkerFrame = 0;
            };
            animatedHoldingsMarkerFrame = window.requestAnimationFrame(step);
        };

        const holdingsHoverMarkerPlugin = {
            id: "investmentHoldingsHoverMarkerPlugin",
            afterDatasetsDraw(chartInstance) {
                const ledgerNo = Number(activeHoldingsHoverLedgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) {
                    animateHoldingsMarkerToward(null, chartInstance);
                    return;
                }
                const runtimeState = getRuntimeState();
                const pointIndex = runtimeState.visibleChartPointIndexByLedgerNo.get(ledgerNo);
                if (!Number.isFinite(pointIndex)) return;
                const dataset = chartInstance.data?.datasets?.[0];
                const pointValue = Number(dataset?.data?.[pointIndex]);
                if (!Number.isFinite(pointValue)) return;
                const { ctx, scales, chartArea } = chartInstance;
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!ctx || !xScale || !yScale || !chartArea) return;
                const x = xScale.getPixelForValue(pointIndex);
                const y = yScale.getPixelForValue(pointValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
                animateHoldingsMarkerToward({ x, y }, chartInstance);
                const animatedPoint = animatedHoldingsMarkerPoint || { x, y };
                const markerStroke = resolvedTheme.accentPositive || "#16a34a";
                const markerGlow = resolvedTheme.accentPositive || "rgba(22, 163, 74, 0.85)";
                ctx.save();
                ctx.beginPath();
                ctx.arc(animatedPoint.x, animatedPoint.y, holdingsMarkerRadius, 0, Math.PI * 2);
                ctx.lineWidth = holdingsMarkerStrokeWidth;
                ctx.strokeStyle = markerStroke;
                ctx.shadowColor = markerGlow;
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.restore();
            },
        };

        const realtimeEndMarkerPlugin = {
            id: "investmentRealtimeEndMarkerPlugin",
            afterDatasetsDraw(chartInstance) {
                const runtimeState = getRuntimeState();
                const markerElement = runtimeState?.realtimeMarkerElement;
                if (!(markerElement instanceof HTMLElement)) return;
                const markerTarget = resolveInvestmentEquityRealtimeMarkerTarget(runtimeState);
                if (!markerTarget || !Number.isInteger(markerTarget.index) || markerTarget.index < 0) {
                    markerElement.hidden = true;
                    return;
                }
                if (!shouldRunInvestmentRealtimeQuotes()) {
                    markerElement.hidden = true;
                    return;
                }
                const realtimeIndex = markerTarget.index;
                if (!shouldShowInvestmentRealtimePulse(markerTarget.session)) {
                    markerElement.hidden = true;
                    return;
                }
                const dataset = chartInstance.data?.datasets?.[0];
                const pointValue = Number(dataset?.data?.[realtimeIndex]);
                if (!Number.isFinite(pointValue)) {
                    markerElement.hidden = true;
                    return;
                }
                const { scales, chartArea } = chartInstance;
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!xScale || !yScale || !chartArea) {
                    markerElement.hidden = true;
                    return;
                }
                const x = xScale.getPixelForValue(realtimeIndex);
                const y = yScale.getPixelForValue(pointValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    markerElement.hidden = true;
                    return;
                }
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
                    markerElement.hidden = true;
                    return;
                }
                markerElement.style.left = `${x}px`;
                markerElement.style.top = `${y}px`;
                markerElement.hidden = false;
            },
        };

        const xAxisLabelPlugin = {
            id: "investmentXAxisLabelPlugin",
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                const runtimeState = getRuntimeState();
                const labels = Array.isArray(runtimeState.labels) ? runtimeState.labels : [];
                const rawDates = Array.isArray(runtimeState.rawDates) ? runtimeState.rawDates : [];
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = buildInvestmentAxisTickIndexes(labels, rawDates, viewportWidth, parseRawDate);
                const baselineY = chartArea.bottom;
                const labelOptions = chart.options?.plugins?.investmentXAxisLabels || {};
                const fontSize = Number.parseFloat(labelOptions.fontSize) || 12;
                const lineHeight = Number.parseFloat(labelOptions.lineHeight) || 10;
                const fontWeight = String(labelOptions.fontWeight || '700');
                const fontFamily = String(labelOptions.fontFamily || '"GDS Transport", "Helvetica Neue", Arial, sans-serif');
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
                ctx.textBaseline = "top";
                tickIndexes.forEach((index, tickIndex) => {
                    const parsedDate = parseRawDate(rawDates[index]);
                    if (!parsedDate) return;
                    const [firstLine, secondLine] = formatChartDateLines(parsedDate);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = "left";
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
                    else ctx.textAlign = "center";
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };

        const chartYPaddingPx = 5;
        const equityYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            chartState.historicalEquity.length ? chartState.historicalEquity : chartState.equity,
            chartYPaddingPx,
        );
        const getOrCreateTooltip = () => {
            let tooltip = document.querySelector('[data-investment-chart-tooltip="1"]');
            if (tooltip) return tooltip;
            tooltip = document.createElement("div");
            tooltip.className = "chart-tooltip";
            tooltip.dataset.investmentChartTooltip = "1";
            tooltip.style.position = "fixed";
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            document.body.appendChild(tooltip);
            return tooltip;
        };

        const formatTooltipDate = (dateParts) => formatInvestmentFullDateParts(dateParts, {
            includeTime: Number.isFinite(dateParts?.hours) && Number.isFinite(dateParts?.minutes),
        });

        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip();
            const runtimeState = getRuntimeState();
            const rawDates = Array.isArray(runtimeState.rawDates) ? runtimeState.rawDates : [];
            const visibleChartPoints = Array.isArray(runtimeState.visibleChartPoints) ? runtimeState.visibleChartPoints : [];
            const visiblePointSourceIndexes = Array.isArray(runtimeState.visiblePointSourceIndexes) ? runtimeState.visiblePointSourceIndexes : [];
            const sortedChartPoints = Array.isArray(runtimeState.sortedChartPoints) ? runtimeState.sortedChartPoints : [];
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove("is-visible");
                activeChartHoverDate = "";
                activeChartTooltipPointIndex = -1;
                clearInvestmentHistoryHighlights();
                clearInvestmentStockDetailHighlights();
                scheduleInvestmentDummyDonutSync();
                syncInvestmentStockDetailsDonutFromInteraction();
                return;
            }

            const dateEl = tooltipEl.querySelector(".chart-tooltip-date");
            const listEl = tooltipEl.querySelector(".chart-tooltip-list");
            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const pointRecord = visibleChartPoints[pointIndex];
            const tooltipDateSource = String(pointRecord?.realtime_timestamp || rawDates[pointIndex] || '');
            const parsedDate = parseRawDate(tooltipDateSource);
            const sourcePointIndex = Number.isFinite(pointIndex) && pointIndex >= 0
                ? Number(visiblePointSourceIndexes[pointIndex])
                : -1;
            activeChartTooltipPointIndex = Number.isFinite(sourcePointIndex) && sourcePointIndex >= 0 ? sourcePointIndex : -1;
            scheduleInvestmentDummyDonutSync();
            syncInvestmentStockDetailsDonutFromInteraction();
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || "");
            const hoveredLedgerDate = String(pointRecord?.anchor_ledger_date || "").slice(0, 10);

            if (hoveredLedgerDate && hoveredLedgerDate !== activeChartHoverDate) {
                const ledgerNos = Array.isArray(pointRecord?.anchor_ledger_nos)
                    ? pointRecord.anchor_ledger_nos
                    : getHistoryRowsForLedgerDate(hoveredLedgerDate).map((row) => Number(row.dataset.investmentHistoryRow || 0));
                activateInvestmentHistoryRows(ledgerNos, { behavior: "auto", scroll: false });
                syncInvestmentStockDetailPreviewRows(ledgerNos, { behavior: 'auto', scroll: false });
                activeChartHoverDate = hoveredLedgerDate;
            } else if (!hoveredLedgerDate && activeChartHoverDate) {
                activeChartHoverDate = "";
                clearInvestmentHistoryHighlights();
                clearInvestmentStockDetailHighlights();
            }

            const tooltipRows = [];
            if (pointRecord) {
                const previousTradingPointIndex = Number(pointRecord?.previous_trading_point_index);
                const previousTradingPoint = Number.isFinite(previousTradingPointIndex) && previousTradingPointIndex >= 0
                    ? sortedChartPoints[previousTradingPointIndex] || null
                    : null;
                const cumulativeTransferAmount = Number(pointRecord?.cumulative_net_transfer_amount) || 0;
                const previousTradingCumulativeTransferAmount = Number(previousTradingPoint?.cumulative_net_transfer_amount) || 0;
                const transferSincePreviousTradingDay = previousTradingPoint
                    ? cumulativeTransferAmount - previousTradingCumulativeTransferAmount
                    : 0;
                const pointEquity = Number(pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity) || 0;
                const previousPointEquity = Number(previousTradingPoint?.aggregate_total_equity ?? previousTradingPoint?.total_equity) || 0;
                const pointMarketValue = Number(pointRecord?.aggregate_market_value ?? pointRecord?.market_value) || 0;
                const pointRunningCash = Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0;
                const pnlVsPreviousTradingDay = previousTradingPoint
                    ? pointEquity - previousPointEquity - transferSincePreviousTradingDay
                    : null;
                const cashInAmount = Number(pointRecord?.cash_in_amount);
                const cashOutAmount = Number(pointRecord?.cash_out_amount);
                tooltipRows.push({
                    label: "Equity",
                    formattedValue: formatMoney(pointEquity),
                    color: equitySeriesColor,
                });
                tooltipRows.push({
                    label: "Market value",
                    formattedValue: formatMoney(pointMarketValue),
                    color: resolvedTheme.accentSecondary,
                });
                tooltipRows.push({
                    label: "Cash",
                    formattedValue: formatMoney(pointRunningCash),
                    color: resolvedTheme.accentPositive,
                });
                if (Number.isFinite(pnlVsPreviousTradingDay)) {
                    tooltipRows.push({
                        label: "P&L",
                        formattedValue: formatSignedHoldingsMoney(pnlVsPreviousTradingDay),
                        color: pnlVsPreviousTradingDay >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary,
                        valueClass: getSignedMetricClass(pnlVsPreviousTradingDay),
                    });
                }
                if (Number.isFinite(cashInAmount) && cashInAmount > 1e-9) {
                    tooltipRows.push({
                        label: "Cash in",
                        formattedValue: formatSignedHoldingsMoney(cashInAmount),
                        color: resolvedTheme.accentPositive,
                        valueClass: 'investment-holdings-value-positive',
                    });
                }
                if (Number.isFinite(cashOutAmount) && cashOutAmount > 1e-9) {
                    tooltipRows.push({
                        label: "Cash out",
                        formattedValue: formatSignedHoldingsMoney(-cashOutAmount),
                        color: resolvedTheme.accentSecondary,
                        valueClass: 'investment-holdings-value-negative',
                    });
                }
            } else {
                tooltipRows.push({
                    label: "Equity",
                    formattedValue: formatMoney(tooltip.dataPoints?.[0]?.parsed?.y ?? null),
                    color: equitySeriesColor,
                });
            }

            listEl.innerHTML = tooltipRows.map((row) => `
                <div class="chart-tooltip-row">
                    <span class="chart-tooltip-dot" style="background:${row.color}"></span>
                    <span></span>
                    <span class="chart-tooltip-label">${row.label}</span>
                    <span class="chart-tooltip-value${row.valueClass ? ` ${row.valueClass}` : ''}">${row.formattedValue}</span>
                </div>
            `).join("");

            const canvasRect = chart.canvas.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            const padding = 12;
            const gap = 14;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
            const anchorX = canvasRect.left + tooltip.caretX;
            const anchorY = canvasRect.top + tooltip.caretY;
            const donutRect = investmentDummyChart instanceof HTMLElement ? investmentDummyChart.getBoundingClientRect() : null;
            const rightBoundary = donutRect && donutRect.left > padding
                ? Math.min(viewportWidth - padding, donutRect.left - gap)
                : viewportWidth - padding;
            const roomRight = rightBoundary - anchorX;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
            if (left < padding) left = padding;
            const maxLeft = rightBoundary - tooltipRect.width;
            if (left > maxLeft) {
                left = maxLeft;
            }
            if (left < padding) left = padding;
            let top = anchorY - (tooltipRect.height / 2);
            if (top < padding) top = padding;
            if (top + tooltipRect.height > viewportHeight - padding) {
                top = viewportHeight - tooltipRect.height - padding;
            }
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
            tooltipEl.classList.add("is-visible");
        };

        const holdingsMarkerRadius = 5;
        const holdingsMarkerStrokeWidth = 2.8;
        const holdingsMarkerSafePadding = Math.ceil(holdingsMarkerRadius + holdingsMarkerStrokeWidth + 2);
        const realtimeMarkerSafePadding = 32;

        investmentEquityChartRuntimeState = {
            ...chartState,
            frozenYScale: equityYScale,
            realtimeMarkerElement: realtimeMarkerElement instanceof HTMLElement ? realtimeMarkerElement : null,
        };

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: holdingsMarkerSafePadding,
                    right: Math.max(holdingsMarkerSafePadding, realtimeMarkerSafePadding),
                    top: Math.max(44, realtimeMarkerSafePadding),
                    bottom: 24,
                },
            },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false, external: externalTooltipHandler },
                investmentXAxisLabels: {
                    fontSize: 12,
                    fontWeight: '700',
                    fontFamily: '"GDS Transport", "Helvetica Neue", Arial, sans-serif',
                    lineHeight: 10,
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { display: false },
                },
                y: {
                    bounds: "ticks",
                    grid: { display: false, drawTicks: false },
                    border: { display: false },
                    afterFit: (scale) => {
                        scale.width = fixedYAxisWidth;
                    },
                    ticks: {
                        color: resolvedTheme.muted,
                        display: true,
                        padding: 8,
                        callback(value, index, ticks) {
                            if (index === 0 || index === ticks.length - 1) return '';
                            if (investmentShareMaskEnabled) return '***';
                            return typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : String(value);
                        },
                    },
                },
            },
        };

        investmentEquityChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels: [...chartState.labels],
                rawLabels: [...chartState.rawDates],
                datasets: [
                    {
                        label: "Equity",
                        data: [...chartState.equity],
                        borderColor: equitySeriesColor,
                        borderWidth: referenceLineWidth,
                        pointRadius: 0,
                        tension: 0,
                        showLine: true,
                        spanGaps: false,
                        borderJoinStyle: "round",
                        borderCapStyle: "round",
                        segment: {
                            borderColor: (context) => getInvestmentEquitySegmentBorderColor(context, equitySeriesColor),
                        },
                    },
                ],
            },
            options: {
                ...commonOptions,
                animation: {
                    onComplete: () => {
                        if (canvas.dataset.investmentChartReady === '1') return;
                        setInvestmentChartReady(true, canvas);
                    },
                },
                scales: {
                    ...commonOptions.scales,
                    x: { ...commonOptions.scales.x, display: false },
                    y: { ...commonOptions.scales.y, ...equityYScale },
                },
            },
            plugins: [hoverGuidePlugin, holdingsHoverMarkerPlugin, realtimeEndMarkerPlugin, xAxisLabelPlugin],
        });
        scheduleInvestmentOverviewIntradayLinePoints(chartPoints);
        if (activeHoldingsHoverLedgerNo > 0) {
            investmentEquityChartInstance.update('none');
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (canvas.dataset.investmentChartReady === '1') return;
                setInvestmentChartReady(true, canvas);
            });
        });
        bindInvestmentEquityRangeControls(chartState.sortedChartPoints);
    }

    function formatEventType(type) {
        if (!type) return '';
        return type.split('_').map(word => {
            // Special case capitalization for IBKR transaction types
            const lower = word.toLowerCase();
            if (lower === 'fx') return 'FX';
            if (lower === 'pnl') return 'P&L';
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
    }

    function formatAmount(value) {
        if (value === undefined || value === null || isNaN(value)) return '--';
        return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatMetricLossAmount(value) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatAmount(0);
        return formatAmount(-Math.abs(numericValue));
    }

    function formatMetricLossAmountWithCurrency(value, currency) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatAmountWithCurrency(0, currency, { showUsdSymbol: false });
        return formatAmountWithCurrency(-Math.abs(numericValue), currency, { showUsdSymbol: false });
    }

    function getNegativeMetricClass(value) {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && Math.abs(numericValue) > 1e-9
            ? 'investment-holdings-value-negative'
            : '';
    }

    function getSignedMetricClass(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || Math.abs(numericValue) <= 1e-9) return '';
        return numericValue >= 0
            ? 'investment-holdings-value-positive'
            : 'investment-holdings-value-negative';
    }

    function getTotalDeposits(transactions) {
        return transactions
            .filter(t => getNormalizedTransactionType(t) === 'deposit')
            .reduce((sum, t) => sum + getTransactionAmount(t), 0);
    }

    function getHoldingsSummaryMetrics(transactions, latestPrices, TOTAL_EQUITY) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const safeLatestPrices = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        const tickerSummaries = buildTickerSummaries(
            safeTransactions,
            safeLatestPrices,
            TOTAL_EQUITY,
            normalizePriceHistoryPayload(window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {})
        );
        const holdingsRealizedPnl = tickerSummaries.reduce((sum, summary) => sum + (Number(summary.realizedPnl) || 0), 0);
        const totalRealizedPnl = holdingsRealizedPnl;
        const totalUnrealizedPnl = tickerSummaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const cumulativePnl = totalRealizedPnl + totalUnrealizedPnl;
        const openTickers = new Set(
            tickerSummaries
                .filter((summary) => summary.hasOpenPosition)
                .map((summary) => normalizeInvestmentTicker(summary.ticker))
                .filter(Boolean)
        );
        const sortedTransactions = safeTransactions
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => compareInvestmentTransactions(left.txn, right.txn, left.index, right.index))
            .map(({ txn }, sortedIndex) => ({
                txn,
                ledgerNo: sortedIndex + 1,
            }));
        const realizedPnlRows = [];
        const unrealizedPnlRows = [];

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            realizedPnlRows.push(ledgerNo);
            const normalizedTicker = getInvestmentCanonicalTicker(txn?.ticker);
            if (normalizedTicker && openTickers.has(normalizedTicker)) {
                unrealizedPnlRows.push(ledgerNo);
            }
        });

        return {
            totalRealizedPnl,
            totalUnrealizedPnl,
            cumulativePnl,
            realizedPnlRows,
            unrealizedPnlRows,
            cumulativePnlRows: Array.from(new Set([
                ...realizedPnlRows,
                ...unrealizedPnlRows,
            ])),
        };
    }

    function getSortedInvestmentMetricTransactions(transactions) {
        return (Array.isArray(transactions) ? transactions : [])
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => compareInvestmentTransactions(left.txn, right.txn, left.index, right.index))
            .map(({ txn }, sortedIndex) => ({
                txn,
                ledgerNo: sortedIndex + 1,
            }));
    }

    function getLatestInvestmentMetricPrice(ticker, latestPrices) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const candidates = [
            ticker,
            normalizedTicker,
            getInvestmentCanonicalTicker(normalizedTicker),
            normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : '',
        ].filter(Boolean);
        const priceStore = latestPrices && typeof latestPrices === 'object' ? latestPrices : {};
        for (const candidate of candidates) {
            const rawValue = priceStore[candidate];
            const numericValue = Number(
                rawValue && typeof rawValue === 'object'
                    ? rawValue.price ?? rawValue.last ?? rawValue.close ?? rawValue.value
                    : rawValue
            );
            if (Number.isFinite(numericValue) && numericValue > 0) {
                return numericValue;
            }
        }
        return null;
    }

    function classifyBrokerBenefitTransaction(txn) {
        if (!isKolRewardTransaction(txn)) return '';
        const broker = String(txn?.broker || '').trim().toLowerCase();
        const description = String(txn?.description || '').trim();
        const rawItem = String(txn?.source?.statement_item_raw || '').trim();
        const normalizedText = `${description} ${rawItem}`.toLowerCase();
        const amount = Math.abs(getTransactionAmount(txn));

        if (/\bkol\b/i.test(description)) return 'kol_reward';
        if (broker === 'longbridge_sg') return 'kol_reward';
        if (broker === 'tigertrade' && description === 'Order Rebate' && amount >= 12) {
            return 'coupon_hkd_notional';
        }
        if (broker === 'tigertrade') {
            return 'coupon_usd';
        }
        if (
            normalizedText.includes('cash card')
            || normalizedText.includes('cash coupon')
            || normalizedText.includes('cash reward')
            || normalizedText.includes('stock cash')
            || normalizedText.includes('rewards center')
            || normalizedText.includes('股票卡')
            || normalizedText.includes('现金卡')
            || normalizedText.includes('現金卡')
            || normalizedText.includes('任务中心')
            || normalizedText.includes('任務中心')
            || normalizedText.includes('开户礼')
            || normalizedText.includes('開戶禮')
            || normalizedText.includes('入金礼')
            || normalizedText.includes('入金禮')
        ) {
            return 'cash_reward';
        }
        if (
            normalizedText.includes('coupon')
            || normalizedText.includes('rebate')
            || normalizedText.includes('优惠券')
            || normalizedText.includes('優惠券')
            || normalizedText.includes('抵扣卡')
        ) {
            return 'coupon';
        }
        return 'cash_reward';
    }

    function getStockGrantBenefitMetrics(transactions, latestPrices, TOTAL_EQUITY) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const priceHistory = normalizePriceHistoryPayload(window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {});
        const tickerPriceIndex = buildTickerPriceIndex(priceHistory);
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(safeTransactions, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        const sortedTransactions = getSortedInvestmentMetricTransactions(safeTransactions);
        const lotStates = new Map();
        let stockGrantRealizedPnl = 0;
        let stockGrantUnrealizedPnl = 0;
        const stockGrantRealizedRowSet = new Set();
        const stockGrantUnrealizedRowSet = new Set();

        const getStateKey = (txn) => [
            String(txn?.broker || '').trim().toLowerCase(),
            String(txn?.account || '').trim(),
            getInvestmentCanonicalTicker(txn?.ticker),
        ].join('|');

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return;
            const stateKey = getStateKey(txn);
            if (!stateKey.endsWith(`|${getInvestmentCanonicalTicker(txn?.ticker)}`)) return;
            const quantity = Math.abs(Number(getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints)));
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            const currency = formatTransactionCurrency(txn) || getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!lotStates.has(stateKey)) {
                lotStates.set(stateKey, []);
            }
            const lots = lotStates.get(stateKey);

            if (['buy', 'grant', 'dividend_reinvestment'].includes(normalizedType)) {
                lots.push({
                    remainingQuantity: quantity,
                    isGrant: normalizedType === 'grant',
                    rowNo: ledgerNo,
                    ticker: getInvestmentCanonicalTicker(txn?.ticker),
                    currency,
                });
                return;
            }

            const grossAmount = Math.abs(getTransactionEconomicAmount(txn));
            const unitProceeds = quantity > 0 ? grossAmount / quantity : 0;
            let remainingToClose = quantity;
            while (remainingToClose > 1e-9 && lots.length) {
                const lot = lots[0];
                const consumedQuantity = Math.min(remainingToClose, lot.remainingQuantity);
                if (lot.isGrant && unitProceeds > 0) {
                    const realizedLocal = consumedQuantity * unitProceeds;
                    stockGrantRealizedPnl += convertAmountToBaseCurrency(
                        realizedLocal,
                        currency,
                        ledgerDate,
                        fxTimeline,
                        baseCurrency,
                    );
                    stockGrantRealizedRowSet.add(ledgerNo);
                    stockGrantRealizedRowSet.add(lot.rowNo);
                }
                lot.remainingQuantity -= consumedQuantity;
                remainingToClose -= consumedQuantity;
                if (lot.remainingQuantity <= 1e-9) {
                    lots.shift();
                }
            }
        });

        lotStates.forEach((lots) => {
            lots.forEach((lot) => {
                if (!lot.isGrant || !(lot.remainingQuantity > 1e-9)) return;
                const latestPrice = getLatestInvestmentMetricPrice(lot.ticker, latestPrices);
                if (!(latestPrice > 0)) return;
                stockGrantUnrealizedPnl += convertAmountToBaseCurrency(
                    lot.remainingQuantity * latestPrice,
                    lot.currency,
                    getTodayLedgerDate(),
                    fxTimeline,
                    baseCurrency,
                );
                stockGrantUnrealizedRowSet.add(lot.rowNo);
            });
        });

        return {
            stockGrantRealizedPnl,
            stockGrantUnrealizedPnl,
            stockGrantRealizedRows: Array.from(stockGrantRealizedRowSet),
            stockGrantUnrealizedRows: Array.from(stockGrantUnrealizedRowSet),
        };
    }

    function getBrokerBenefitMetrics(transactions, latestPrices, TOTAL_EQUITY) {
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        const sortedTransactions = getSortedInvestmentMetricTransactions(safeTransactions);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(safeTransactions, baseCurrency);
        let couponRebateHkd = 0;
        let couponRebateUsd = 0;
        let cashRewardHkd = 0;
        let cashRewardUsd = 0;
        let kolRewardIncome = 0;
        let couponRebateIncome = 0;
        let cashRewardIncome = 0;
        const couponRebateHkdRowSet = new Set();
        const couponRebateUsdRowSet = new Set();
        const cashRewardHkdRowSet = new Set();
        const cashRewardUsdRowSet = new Set();
        const kolRewardRowSet = new Set();

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const benefitType = classifyBrokerBenefitTransaction(txn);
            if (!benefitType) return;
            const amount = Math.abs(getTransactionAmount(txn));
            if (!(amount > 1e-9)) return;
            const currency = formatTransactionCurrency(txn) || baseCurrency;
            const ledgerDate = normalizeLedgerDate(txn?.date);

            if (benefitType === 'kol_reward') {
                kolRewardIncome += convertAmountToBaseCurrency(
                    amount,
                    currency,
                    ledgerDate,
                    fxTimeline,
                    baseCurrency,
                );
                kolRewardRowSet.add(ledgerNo);
                return;
            }

            if (benefitType === 'coupon_hkd_notional') {
                couponRebateHkd += 100;
                couponRebateIncome += convertAmountToBaseCurrency(
                    100,
                    'HKD',
                    ledgerDate,
                    fxTimeline,
                    baseCurrency,
                );
                couponRebateHkdRowSet.add(ledgerNo);
                return;
            }

            if (benefitType === 'coupon_usd' || currency === 'USD') {
                if (benefitType === 'cash_reward') {
                    cashRewardUsd += amount;
                    cashRewardIncome += convertAmountToBaseCurrency(
                        amount,
                        currency,
                        ledgerDate,
                        fxTimeline,
                        baseCurrency,
                    );
                    cashRewardUsdRowSet.add(ledgerNo);
                } else {
                    couponRebateUsd += amount;
                    couponRebateIncome += convertAmountToBaseCurrency(
                        amount,
                        currency,
                        ledgerDate,
                        fxTimeline,
                        baseCurrency,
                    );
                    couponRebateUsdRowSet.add(ledgerNo);
                }
                return;
            }

            if (benefitType === 'cash_reward') {
                cashRewardHkd += amount;
                cashRewardIncome += convertAmountToBaseCurrency(
                    amount,
                    currency,
                    ledgerDate,
                    fxTimeline,
                    baseCurrency,
                );
                cashRewardHkdRowSet.add(ledgerNo);
                return;
            }

            couponRebateHkd += amount;
            couponRebateIncome += convertAmountToBaseCurrency(
                amount,
                currency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            couponRebateHkdRowSet.add(ledgerNo);
        });

        return {
            couponRebateHkd,
            couponRebateUsd,
            cashRewardHkd,
            cashRewardUsd,
            kolRewardIncome,
            couponRebateIncome,
            cashRewardIncome,
            couponRebateHkdRows: Array.from(couponRebateHkdRowSet),
            couponRebateUsdRows: Array.from(couponRebateUsdRowSet),
            cashRewardHkdRows: Array.from(cashRewardHkdRowSet),
            cashRewardUsdRows: Array.from(cashRewardUsdRowSet),
            kolRewardRows: Array.from(kolRewardRowSet),
            ...getStockGrantBenefitMetrics(safeTransactions, latestPrices, TOTAL_EQUITY),
        };
    }

    function renderMetricValueCopy(metric, valueClass) {
        const value = metric?.value || '--';
        if (metric?.liveField) {
            return renderInvestmentLiveValue(metric.liveField, metric?.liveNumber, {
                className: `investment-metric-tooltip-value-copy trade-metric-value investment-stock-details-metric-value${valueClass ? ` ${valueClass}` : ''}`,
                formatter: () => value,
                useSplitValue: true,
            });
        }
        return `<span class="investment-metric-tooltip-value-copy${valueClass ? ` ${valueClass}` : ''}">${renderWorkspaceMetricValueContent(value)}</span>`;
    }

    function renderMetricValueWithTooltip(metric) {
        const sortedLedgerEntries = Array.isArray(window.ANTIGRAVITY_INVESTMENT_DATA?.transactions)
            ? [...window.ANTIGRAVITY_INVESTMENT_DATA.transactions]
                .sort((left, right) => compareInvestmentTransactions(left, right))
                .map((txn, index) => ({
                    ledgerNo: index + 1,
                    date: String(txn?.date || ''),
                }))
            : [];
        const ledgerDateMap = new Map(sortedLedgerEntries.map((entry) => [entry.ledgerNo, entry.date]));
        const formatTooltipLedgerDate = (rawDate) => {
            const dateParts = parseInvestmentDateParts(rawDate);
            if (!dateParts) return '';
            return formatInvestmentFullDateParts(dateParts);
        };
        const rows = Array.isArray(metric?.rows) ? [...metric.rows].sort((left, right) => right - left) : [];
        const visibleRows = rows.slice(0, 4);
        const extraCount = Math.max(0, rows.length - visibleRows.length);
        const rowListHtml = visibleRows.length
            ? `
                <ul class="investment-metric-tooltip-list">
                    ${visibleRows.map((rowNo) => `
                        <li>
                            <span class="investment-metric-tooltip-list-line">
                                <span class="investment-metric-tooltip-row-no">${rowNo}</span>
                                <span class="investment-metric-tooltip-row-date">${formatTooltipLedgerDate(ledgerDateMap.get(rowNo))}</span>
                            </span>
                        </li>
                    `).join('')}
                </ul>
                ${extraCount > 0 ? `<p class="investment-metric-tooltip-note">+ ${extraCount} earlier row${extraCount === 1 ? '' : 's'}</p>` : ''}
            `
            : `<p class="investment-metric-tooltip-note">No contributing rows were detected.</p>`;
        const latestRow = rows.length ? rows[0] : '';
        const valueClass = String(metric?.valueClass || '').trim();

        return `
            <span class="investment-metric-tooltip-trigger trade-metric-value${valueClass ? ` ${valueClass}` : ''}" tabindex="0" data-metric-key="${metric?.key || ''}" data-metric-target-row="${latestRow}" data-workspace-mask="trade-metric">
                ${renderMetricValueCopy(metric, valueClass)}
                <span class="investment-metric-tooltip field-tooltip liquid-glass-surface" role="tooltip">
                    <span class="investment-metric-tooltip-copy">${metric?.summary || ''}</span>
                    ${rowListHtml}
                </span>
            </span>
        `;
    }

    function bindInvestmentMetricTooltipInteractions(metricsPanel) {
        if (!metricsPanel) return;
        metricsPanel.querySelectorAll('.investment-metric-tooltip-trigger').forEach((trigger) => {
            if (trigger.dataset.tooltipBound === '1') return;
            trigger.dataset.tooltipBound = '1';
            const jumpToContributionRow = () => {
                const targetRowNo = Number(trigger.dataset.metricTargetRow);
                if (!Number.isFinite(targetRowNo) || targetRowNo <= 0) return;
                activateInvestmentHistoryRows([targetRowNo], { behavior: 'auto', scroll: false });
            };
            const clearContributionRow = () => {
                clearInvestmentHistoryHighlights();
            };
            trigger.addEventListener('mouseenter', jumpToContributionRow);
            trigger.addEventListener('focus', jumpToContributionRow);
            trigger.addEventListener('mouseleave', clearContributionRow);
            trigger.addEventListener('blur', clearContributionRow);
        });
    }

    function getNetUsdConverted(transactions) {
        return getUsdFundingMetrics(transactions).netUsdConverted;
    }

    function getUsdFundingMetrics(transactions) {
        if (!Array.isArray(transactions)) {
            return {
                totalDeposits: 0,
                directUsdDeposits: 0,
                netUsdConverted: 0,
                fxFundingLoss: 0,
                finalInvestableUsd: 0,
                totalCommission: 0,
                interestCharged: 0,
                directDepositRows: [],
                netUsdConvertedRows: [],
                fxFundingLossRows: [],
                finalInvestableUsdRows: [],
                totalCommissionRows: [],
                interestChargedRows: [],
            };
        }

        const sortedTransactions = transactions
            .map((txn, index) => ({ txn, index }))
            .sort((left, right) => {
                const leftDate = new Date(left.txn?.date || 0).getTime();
                const rightDate = new Date(right.txn?.date || 0).getTime();
                if (leftDate !== rightDate) return leftDate - rightDate;
                const leftRow = Number(left.txn?.source?.row_number ?? left.index);
                const rightRow = Number(right.txn?.source?.row_number ?? right.index);
                return leftRow - rightRow;
            })
            .map(({ txn, index }, sortedIndex) => ({
                txn,
                index,
                ledgerNo: sortedIndex + 1,
            }));

        const currentDepositStreak = [];
        const allDepositRows = [];
        let totalDeposits = 0;
        let pairedDepositFunding = 0;
        let netUsdConverted = 0;
        let pairedNetUsdConverted = 0;
        let totalCommission = 0;
        let interestCharged = 0;
        const pairedDepositRowSet = new Set();
        const netUsdConvertedRowSet = new Set();
        const pairedNetUsdConvertedRowSet = new Set();
        const totalCommissionRowSet = new Set();
        const interestChargedRowSet = new Set();

        const getFundingTolerance = (targetAmount) => Math.max(0.01, targetAmount * 0.001);
        const chooseClosestDepositSubset = (entries, targetAmount) => {
            const itemCount = entries.length;
            if (!itemCount) return null;

            let bestMask = 0;
            let bestTotal = 0;
            let bestDiff = Number.POSITIVE_INFINITY;
            const subsetCount = 1 << itemCount;

            for (let mask = 1; mask < subsetCount; mask += 1) {
                let subsetTotal = 0;
                for (let bit = 0; bit < itemCount; bit += 1) {
                    if (mask & (1 << bit)) subsetTotal += entries[bit].amount;
                }
                const diff = Math.abs(subsetTotal - targetAmount);
                if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && subsetTotal < bestTotal)) {
                    bestMask = mask;
                    bestTotal = subsetTotal;
                    bestDiff = diff;
                }
            }

            return {
                mask: bestMask,
                total: bestTotal,
                diff: bestDiff,
            };
        };

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const commissionAmount = Math.abs(getTransactionCommission(txn));

            if (commissionAmount > 1e-9) {
                totalCommission += commissionAmount;
                totalCommissionRowSet.add(ledgerNo);
            }

            if (normalizedType === 'debit_interest') {
                const chargedInterest = Math.abs(getTransactionAmount(txn));
                if (chargedInterest > 1e-9) {
                    interestCharged += chargedInterest;
                    interestChargedRowSet.add(ledgerNo);
                }
            }

            if (normalizedType === 'deposit') {
                if (isKolRewardTransaction(txn)) {
                    currentDepositStreak.length = 0;
                    return;
                }
                if (txn?.manual_internal_transfer_external_flow_excluded === true) {
                    currentDepositStreak.length = 0;
                    return;
                }
                const depositAmount = getTransactionAmount(txn);
                if (Number.isFinite(depositAmount) && depositAmount > 0) {
                    totalDeposits += depositAmount;
                    const depositEntry = { amount: depositAmount, ledgerNo };
                    allDepositRows.push(depositEntry);
                    currentDepositStreak.push(depositEntry);
                }
                return;
            }

            if (normalizedType !== 'forex_trade_component') {
                currentDepositStreak.length = 0;
                return;
            }

            const forexPair = String(txn?.ticker || '').trim().toUpperCase();
            if (!forexPair.startsWith('USD.')) {
                currentDepositStreak.length = 0;
                return;
            }

            const quantity = getTransactionQuantity(txn);
            const commissionDisplay = Number(txn?.normalized?.commission_display ?? txn?.commission_abs ?? 0);
            const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
            const safeCommission = Number.isFinite(commissionDisplay) ? commissionDisplay : 0;
            const netConvertedAmount = safeQuantity - safeCommission;

            if (netConvertedAmount > 0) {
                netUsdConverted += netConvertedAmount;
                netUsdConvertedRowSet.add(ledgerNo);
            }

            const grossFundingTarget = safeQuantity + safeCommission;
            if (!(grossFundingTarget > 0) || currentDepositStreak.length === 0) return;

            const tolerance = getFundingTolerance(grossFundingTarget);
            const bestSubset = chooseClosestDepositSubset(currentDepositStreak, grossFundingTarget);
            if (!bestSubset || bestSubset.total <= 0 || bestSubset.diff > tolerance) {
                currentDepositStreak.length = 0;
                return;
            }

            const remainingDeposits = [];
            currentDepositStreak.forEach((entry, index) => {
                if (!(bestSubset.mask & (1 << index))) {
                    remainingDeposits.push(entry);
                } else {
                    pairedDepositRowSet.add(entry.ledgerNo);
                }
            });
            currentDepositStreak.length = 0;
            remainingDeposits.forEach((entry) => currentDepositStreak.push(entry));

            pairedDepositFunding += bestSubset.total;
            if (netConvertedAmount > 0) {
                pairedNetUsdConverted += netConvertedAmount;
                pairedNetUsdConvertedRowSet.add(ledgerNo);
            }
        });

        const directUsdDeposits = totalDeposits - pairedDepositFunding;
        const fxFundingLoss = Math.max(0, pairedDepositFunding - pairedNetUsdConverted);
        const finalInvestableUsd = directUsdDeposits + netUsdConverted;
        const directDepositRows = allDepositRows
            .map((entry) => entry.ledgerNo)
            .filter((ledgerNo) => !pairedDepositRowSet.has(ledgerNo));
        const netUsdConvertedRows = Array.from(netUsdConvertedRowSet);
        const fxFundingLossRows = Array.from(new Set([
            ...Array.from(pairedDepositRowSet),
            ...Array.from(pairedNetUsdConvertedRowSet),
        ]));
        const finalInvestableUsdRows = Array.from(new Set([
            ...directDepositRows,
            ...netUsdConvertedRows,
        ]));

        return {
            totalDeposits,
            directUsdDeposits,
            netUsdConverted,
            fxFundingLoss,
            finalInvestableUsd,
            totalCommission,
            interestCharged,
            directDepositRows,
            netUsdConvertedRows,
            fxFundingLossRows,
            finalInvestableUsdRows,
            totalCommissionRows: Array.from(totalCommissionRowSet),
            interestChargedRows: Array.from(interestChargedRowSet),
        };
    }
});
