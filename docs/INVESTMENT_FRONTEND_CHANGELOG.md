# Investment frontend changelog

Documentation version: `v1.51.1`

This is a historical record, not a current implementation contract. Entries
may be superseded by later source code, tests, Architecture, or Known Issues.
It must not contain user account identifiers, real balances, position
quantities, portfolio size, transaction dates, or a private acceptance
portfolio. Record only privacy-safe behavior invariants.

- Fixed: Mixed-broker Overview replay now calculates HSBC settlement
  boundaries from the pre-current-snapshot broker ledger. A later current cash
  projection can no longer remove earlier settled sale proceeds from historical
  aggregate Cash or create a false equity cliff, while the final point remains
  equal to Holdings.

- Fixed: HSBC current Cash now starts from the posted USD Savings ledger
  balance, applies visible pending settlements exactly once, and converts each
  retained foreign-currency balance once at the agreed workspace FX rate. The
  bank's Available balance remains separate audit evidence.
- Changed: HSBC Cash displays a leading `*` only while settlement evidence is
  unresolved, such as a fee scheduled to post on the following day. FX
  conversion alone is deterministic and does not add a marker; initial and
  realtime Holdings and Metrics rendering share the same contract.
- Fixed: An evidence-backed IBKR current Cash boundary is shared by the latest
  exact-time Transaction history row, Holdings, and Metrics, while rows before
  the snapshot boundary keep their historical replay.

- Changed: Stock-details buy and sell points now render as volume-scaled
  glowing zones. Nearby same-side points use distance-weighted fluid adhesion
  bridges to soften discrete clusters, while each transaction center remains
  aligned to the rendered transaction time and price across every range. The
  largest plotted transaction uses a lighter 8 px radius and existing
  red/green theme tokens.
- Changed: Same-side Glow bridges now follow the rendered close-price path;
  bridges are omitted when a material reversal or deep V-shaped move would
  make the connection visually detach from the stock-price trend.
- Changed: Trend-valid same-side links now start weighted connected zones with
  smooth nonlinear boundaries derived from marker radii, link distances, and
  adhesion strength. Weak links and singleton markers remain isolated.
- Changed: Connected zones now use a center-weighted radial fade with no border
  stroke; the visible outer edge resolves to fully transparent.
- Changed: Individual buy and sell origins now reuse the original center-out
  radial fade. Their circle areas scale with transaction amounts, and the
  largest amount is normalized only against trades visible in the selected
  range.
- Changed: Connected zones now use a capped inverse-square amount field. The
  visible intensity is the sum of connected trade amount contributions over
  squared distance, normalized to a 100% threshold instead of circular blobs.
- Changed: Connected inverse-square fields now apply a 2.2× visual gain after
  computing `I(x,y)`, strengthening the continuous buffer without changing the
  field formula or its 100% cap.

- Added: HSBC USD Savings settlement-only cash refreshes can be imported
  without Portfolio and Order Status text. Existing Holdings positions remain
  authoritative while posted `REF P... SEC` cash legs reconcile matching buys.
- Fixed: HSBC cash-only imports now preserve USD, HKD, and CNH per-account
  balances without treating a settled USD cash page as an unsettled buy
  projection.

- Fixed: Current aggregate Cash now sums authoritative per-broker current
  snapshots rather than borrowing a sequential history row. Native HSBC HKD
  cash is retained in the aggregate and converted exactly once.
- Fixed: IBKR history cash now replays at the displayed cent precision, so
  sequential buy rows remain arithmetically consistent with the visible amount.
- Changed: HSBC and IBKR Transaction history retain sequential replay before a
  current snapshot boundary, while the latest boundary row agrees with the
  current cash shown by Holdings and Metrics.

- Fixed: Stock-details 1W now retains trusted overnight and pre-market buys
  that occur after the latest visible regular-session candle. Their green buy
  circles use the established gap positions, and existing off-hours markers
  no longer snap onto regular-session candles.

- Changed: HSBC cash-account, Portfolio, and Order Status copy/paste fields now
  expose only clipboard paste controls. The debug-only local TXT upload
  carriers and their file-reading path have been removed.

- Changed: IBKR web-paste current-position calibration now removes the
  misleading currency column, labels cash as `Cash (USD)` or another native
  currency, and unions the authoritative snapshot with pre-snapshot calculated
  holdings and cash currencies. A newly calculated holding or distinct cash
  currency therefore receives its own verification row.

- Added: Investment Metrics now shows Cash, Market value, and Total equity cards. They reuse the current Holdings valuation and realtime quote update path, including broker-scoped refreshes.

- Fixed: Schwab Transaction history no longer renders balanced internal
  processing Journal pairs when the same account and ticker have matching
  Security Transfer evidence. Incremental re-imports also remove stale rows
  left by the earlier date-specific cleanup rule while retaining the original
  CSV files as immutable source evidence.

- Fixed: IBKR Web paste now labels Page date as step ➋ and current holdings
  calibration as step ➌. Its method control keeps a stable grid position while
  pill geometry is measured, so opening or switching modes does not flash the
  control.

- Changed: The centered investment import modal now grows until its upper edge
  aligns with the close control's upper tangent when the viewport allows it.

- Fixed: Initial aggregate Holdings, Metrics, and Overview now share one
  current valuation snapshot. Total equity is confirmed aggregate cash plus
  the current market value of every open holding, so a stale chart replay
  point cannot understate the current portfolio equity. Historical transaction
  rows and genuinely historical charts continue to use their own valuation
  points.

- Changed: HSBC's provisional current balance now applies the signed net of
  visible unsettled buy and sell orders, aligning the import summary, feedback,
  and Transaction History projection. Unposted sell clearing fees and other
  settlement adjustments remain excluded until HSBC evidence is available.

- Changed: IBKR web-paste current-position calibration now derives a dynamic
  broker-scoped row set from the current IBKR position snapshot or calculated
  holdings. Ticker symbols are prefilled as read-only labels, while quantities
  remain blank for manual verification instead of copying stale snapshot values.

- Changed: IBKR web-paste current-position calibration now reuses the standard
  Settings table format. Cash is a USD row with two-decimal grouping, the
  broker-scoped current tickers are prefilled as labels, fractional quantities
  retain at least four decimal places, and blank cash or holding quantities
  remain valid optional input without exposing the legacy textarea.

- Fixed: While the investment import modal is open, the light/dark toggle stays
  above the dedicated close control. The two controls share a stable vertical
  column and no longer collide with the drawer.

- Fixed: A validated HSBC snapshot now verifies a fully covered closed ticker
  when replay reaches exactly zero shares and the open-position list omits it,
  allowing closed round-trip realized P&L to appear without trusting partial
  history.

- Fixed: Tax-lot replay now normalizes transaction datetimes before comparing
  source evidence, so mixed-format IBKR Trade Notifications cannot move a
  current fill ahead of older history or omit its realized P&L.

- Changed: The Investment importer is now a centered, rounded frosted modal
  over a full-page Gaussian blur. The dedicated `×` close control remains the
  only active entry control while the original `+` is disabled, and only the
  field stack scrolls. Its final action section reuses the standard Settings
  action-package structure without a page-specific visual override. The close
  control is kept above the modal edge, the disabled `+` is removed from the
  pointer hit path, the `+` is hidden while expanded, the sidebar toggle is
  locked, the investment section resizer is locked, the global theme toggle
  remains available, and long text inputs use a 10px rectangular radius. The
  modal keeps the import-method segmented control sticky during field-stack
  scrolling and uses the full Settings action-package title/copy/action slot.

- Fixed: All four sell-matching methods now resolve through one shared browser
  helper. An invalid refreshed API value cannot override the valid Settings
  value or silently mix with the default. Stock-details Average price, chart
  tooltip, and chart-series labels use that same resolver; `FIFO reconstructed`
  remains transfer-basis metadata only.

- Fixed: Stock details now displays the configured global sell-matching method
  beside Average price. A bound transfer's `FIFO reconstructed` basis remains a
  separate Transfer basis detail and cannot masquerade as a global FIFO
  fallback.

- Fixed: Supplemental IBKR fills now replay from the complete broker-scoped
  transaction inventory in FIFO order. A stale aggregate position cost can no
  longer be applied as the pasted fill's average cost. The changelog retains
  only the rule, not the private source amounts.

- Fixed: Every stock grant, including an IBKR grant, now replays as a zero-cost
  lot across Holdings, Overview, Metrics, Stock details, and dated snapshot
  projection. Its reported per-share value remains source evidence only and is
  never converted into a paid purchase cost. A separately evidenced buy retains
  its exact net acquisition cost.

- Fixed: Broker-scoped realized-P&L snapshots now act as dated cutoffs. Later
  evidenced trades are replayed from the exact FIFO transaction-history
  inventory, so an old IBKR closed-trade snapshot cannot hide or mis-cost a
  supplemental web fill.

- Fixed: IBKR Trade Notifications are now documented and reported as
  supplemental transaction records after the available file-snapshot cutoff.
  Unique fills remain additive, matching file rows refine them, and a stale
  GKX cash snapshot cannot displace a user-verified post-fill boundary.

- Added: IBKR web-paste imports can optionally retain the exact cash shown in
  the IBKR app after the captured fills. The value is a dated intraday cash
  boundary, not a synthetic transaction, and exact-time replay leaves earlier
  same-day trades unchanged.

- Added: IBKR web-paste import now accepts the compact Orders page by collecting
  its Hong Kong page date, allowing same-page split Trades fees to reconcile
  into one filled order without a duplicate provisional row.

- Fixed: Bound security-transfer replay order is now carried through every
  later history, chart, and Metrics sort. A fallback to broker timestamps or
  source row numbers can no longer move a Schwab receipt ahead of its IBKR
  transfer-out after the manual binding has been confirmed.

- Fixed: Completed-import feedback now uses the freshly reloaded merged ledger
  summary. Re-importing an already reconciled Schwab snapshot therefore cannot
  revive stale receipt-review, carried-basis, or manual-review warnings.

- Changed: Transfer review feedback now describes the current rows that remain
  marked `Unbound`, so a message cannot imply that already-bound historical
  transfers were rediscovered by the latest import. Initial large-ledger
  hydration also keeps its loading modal locked until Holdings, Overview,
  Metrics, and Transaction history finish rendering.

- Fixed: Stock details and ticker replay now have regression coverage for
  multi-broker holding structures. Broker-scoped realized P&L remains
  independent before aggregation; private quantities and totals are kept in
  local test fixtures only.

- Fixed: During US overnight, pre-market, and post-market sessions, Overview
  `1W` and `1M` now retain the completed regular-session equity curve and place
  the extended-hours valuation at the far-right live marker. The marker uses
  the same immediate Total equity snapshot as Holdings.

- Fixed: Stock details now displays the sum of complete broker-account
  realized-P&L scopes. An incremental IBKR summary limited to the latest CSV
  window can no longer hide historical closed-trade P&L from the aggregate.

- Added: Hovering any Overview equity range now paints the hovered point's
  total equity in the same solid blue rounded y-axis badge used by Stock
  details. Both charts share one canvas renderer, including axis-font reuse,
  decimal alignment, white text, and the Holdings allocation corner radius.
  Overview measures the widest equity label before layout so the complete
  badge and both rounded corners remain inside the canvas.

- Fixed: Moving across the Overview equity chart no longer runs a full
  point-in-time transaction and tax-lot replay inside every pointer event.
  Historical P&L resolves after a short pointer-settle window, stale work is
  cancelled, exact results are cached per chart point, and the Tooltip never
  carries a prior point's P&L into the pending point.

- Fixed: Transaction History hover places its linked equity-chart marker with
  one coalesced draw. It no longer restarts a 240–300 ms full-canvas animation
  for every crossed row, and the former paint-heavy row pulse is removed.

- Improved: Historical Tooltip replay reuses the close-price index and avoids
  rebuilding detailed realized-P&L attribution that is not rendered there.
  `Cumulative P&L` remains the rounded sum of the hovered point's exact
  Realized P&L and Unrealized P&L.

- Fixed: Live Holdings values now render inside stable, column-sized slots.
  Changes in digit count, sign, or magnitude no longer resize the table rows,
  body, or summary grid while realtime quotes update.

- Fixed: Transaction History pagination now paints its indicator shadow,
  hover lift, and motion outside the table host without ancestor clipping.
  Table rows remain clipped by their dedicated scrolling layer, and the fixed
  header and scrolling body retain their rounded outer corners.

- Changed: Every Overview hover Tooltip now names its third P&L row
  `Cumulative P&L`. At each historical or realtime point, it is recalculated
  from that point's displayed Realized P&L plus Unrealized P&L, including after
  the live endpoint advances.

- Added: Metrics Unrealized P&L now uses the same collapsed disclosure pattern
  as Realized P&L. Expanding it lists each open ticker's signed contribution
  while the card retains its live aggregate value and accessible toggle state.

- Fixed: Overview Tooltip P&L now replays the hovered point's effective tax
  lots and observed close. An earlier minute retains its own P&L after a later
  realtime quote arrives; only the live end marker uses the current Holdings
  summary. Cumulative P&L is always realized P&L plus unrealized P&L, never
  Equity less funding flows.

- Fixed: During an active US regular session, Overview 1W and 1M preserve the
  complete current-day axis while ending the visible equity line at the current
  New York minute. Realtime quotes now add Holdings-aligned minute endpoints;
  later session minutes remain unavailable instead of carrying a stale price
  through the close.

- Fixed: Realtime quote polls now await a fresh market-session clock before
  placing the next minute. Empty Longbridge timestamps use the authoritative
  New York minute, and the live Tooltip endpoint refreshes with Holdings.
  Polls preserve the selected range's full trading calendar, including all 23
  trading days in 1M.

- Changed: Overview equity-chart Tooltips remove the superseded daily `P&L`
  row and retain the Holdings-aligned realized, unrealized, and cumulative P&L
  breakdown.

- Added: Every Overview equity-chart range now appends Realized P&L,
  Unrealized P&L, and Cumulative P&L to its hover Tooltip.

- Fixed: Matched future HSBC SEC postings now accrue as exact signed
  trade-date receivables or payables and clear only at their own settlement
  boundaries. Overlapping multi-day buys can no longer create a false one-day
  equity cliff by omitting or prematurely clearing a later payable.

- Fixed: The realtime Overview endpoint now uses the same valid live quote as
  Holdings for cash-equivalent securities. A historical money-market anchor
  remains a fallback only when no live price is available.

- Fixed: Realized P&L includes every attributed, evidenced corporate-event
  dividend. A later generic cash merge can no longer downgrade one to a deposit
  and silently remove it from ticker-level income.

- Fixed: Holdings and Stock details accept an explicit expected-share
  attestation for an evidence-backed open tax-lot history. Cross-broker realized
  P&L aggregates only after every broker and account retains an independent lot
  inventory.

- Fixed: Neutral Holdings daily-change badges again use the active theme
  background for text, rendering white in light mode and black in dark mode.

- Improved: Overview chart and Transaction History hover restore the recovered
  Tooltip reuse path, replace full linked-chart updates with lightweight draws,
  skip hidden Stock details Donut work, coalesce visible work per animation
  frame, and avoid forced row layout. The chart Tooltip remains a
  compositor-backed Frosted Glass surface, while provisional HSBC `*` values
  retain their existing disclosure text.

- Fixed: HSBC sync feedback now explains the transferable-cash projection only
  when positive unsettled sell proceeds produce a provisional `*` marker in
  Transaction History. Fully settled imports no longer show a `$0.00`
  unsettled-proceeds warning.

- Fixed: HSBC orders that provide a date but no fill timestamp now replay in
  their evidenced Order Status page sequence. The cash-account `SEC` posting
  rank remains dedicated to settlement cash, so a later settlement import
  cannot reverse a same-day buy and sell or create a transient short lot.

- Fixed: HSBC Transaction History rows with an evidenced future SEC
  settlement balance now anchor displayed Cash to that source balance. The
  presentation repair prevents an incomplete replay baseline from producing a
  misleading cash value; the Overview accounting path still applies the
  settlement only on its own ledger date.

- Fixed: Historical equity valuation now aligns split-only daily closes with
  dynamic end-of-day holdings for both ordinary and reverse splits. Dividend
  cash remains ledgered separately, so a total-return forward-adjusted price
  cannot create a phantom market-value increase.

- Fixed: Transaction History and Overview chart tooltips now show `--` for an
  incomplete historical valuation rather than coercing it to `0.00`. The
  tooltip identifies the ticker or tickers whose daily closing price is absent.

- Fixed: HSBC Transaction History and Overview cash replay now keep balance
  boundaries separated by account type and currency. A RMB Savings withdrawal
  to CNH 0.00 no longer turns the independent USD Savings balance negative or
  creates a false equity-curve cliff.

- Fixed: A later HSBC statement balance now removes stale, unscoped cash replay
  deltas in that currency. Historic trade cash can no longer be added a second
  time beside verified USD Savings cash or collapse earlier daily equity points.

- Changed: Overview `1W` and `1M` now replay trusted regular-session fills into the
  following one-minute state, so dynamic holdings and display cash change with
  the completed bar. Date-only and off-hours trades still enter at the next
  trading-day opening state.

- Fixed: Historical Overview and Transaction History valuation now accepts only
  one-minute closes, daily closes, or designated money-market anchors. Missing
  close evidence remains unavailable instead of falling back to a transaction
  price or remembered quote.

- Fixed: Moving the Investment split fully upward now preserves the Holdings
  column-and-summary layer plus the first real holding row, so a position cannot
  be clipped beneath the fixed header.

- Fixed: Configured cash-equivalent tickers now use the money-market identity
  formatter for dividend and other cash-flow descriptions, so corporate-event
  payments remain visibly linked to their security in Transaction History.

- Fixed: Ticker-level split-factor consensus now repairs an isolated noisy
  inference on a pre-split fill, preventing a phantom Longbridge HK position
  after the position is flat.

- Fixed: Investment equity replay now follows ledger booking dates before
  execution timestamps, so a position is not carried into the wrong ledger day.

- Fixed: Future-dated HSBC settlement balances no longer overwrite
  execution-day cash. An overlapping cross-day settlement sequence remains
  continuous through a sale and later buys.

- Fixed: Confirmed internal-transfer bridges are history-only. Current Holdings
  cash and equity remain broker-authoritative, while the final chart point is
  reconciled to the current account boundary.

- Changed: The fixed Holdings summary no longer shows a realtime `Today's net
  P&L` badge beside `Cumulative P&L`. The cumulative value remains the
  cumulative realized-plus-unrealized calculation; daily badges on the other
  Holdings surfaces are unchanged.

- Fixed: Realtime Holdings quote updates now refresh both fixed and scrollable
  row layers, avoiding stale duplicate rows after a quote poll.

- Fixed: All-brokers Cash, Cash equivalents, and Total equity now retain the
  actual aggregate broker cash balance. Internal-transfer bridge adjustments
  remain available for excluding those rows from external funding attribution,
  but can no longer make current cash or equity disappear.

- Refined: Holdings summary and Settings Investment Holdings allocation badges
  now use narrower code-style glyph slots while preserving right-edge and
  decimal alignment. Last price and Unrealized P&L badges are unchanged.

- Changed: Holdings now suppresses zero daily-change badges only in the
  Realized P&L column, while retaining the gray `0.00` main value. Last price
  and Unrealized P&L keep their existing zero-change badges.

- Fixed: HSBC pending-sell cash and equity projections now use authoritative
  transferable cash plus the source-bounded cumulative unsettled sell
  proceeds. Replay drift cannot create unsupported cash during the settlement
  window, and the row note states that unknown fees and settlement adjustments
  are excluded.

- Fixed: HSBC pending-sell transaction rows now reverse-replay virtual
  post-trade holdings and value them with the day's intraday close before
  calculating Market value and Equity.

- Fixed: Holdings live Total equity now recalculates from aggregate cash and the
  same live market-value snapshot displayed in the table, preventing a stale
  chart-point equity from disagreeing with the visible market value.

- Fixed: An unknown carried-basis `transfer_in` now appends a zero-cost lot
  without erasing existing tax-lot identities, preserving the configured sell
  matching method for subsequent disposals while keeping basis status unknown.

- Fixed: Holdings and Stock details now consume the same
  `aggregateInvestmentScopedPositionStates` helper after replaying
  broker/account/ticker/currency scopes independently.

- Changed: A mixed-currency ticker still keeps combined cost, market value,
  unrealized P&L, and total P&L unavailable, while retaining each independently
  converted account-level realized P&L result for auditability.

- Fixed: A missing market value no longer renders as a `0%` portfolio weight.
  The weight remains unavailable until both market value and total equity are
  numeric.

- Fixed: HSBC pending-sell rows no longer inherit incomplete order-replay drift
  as a cash loss. Mixed-broker payloads retain the account-level Portfolio
  snapshot, while the table distinguishes authoritative transferable cash from
  positive unsettled sell proceeds and labels the resulting balance as a current
  snapshot projection.

- Fixed: Holdings and Stock details now replay broker/account/currency lot scopes
  before ticker aggregation, preventing cross-account sells from consuming
  unrelated lots and preventing the average-cost chart from showing a different
  cost basis than Holdings.

- Changed: Same-ticker positions with multiple currencies now fail closed for
  combined cost basis, market value, average price, and P&L instead of summing
  incompatible raw currency units. Authoritative Longbridge HK/SG broker
  performance snapshots remain unchanged for realized P&L. Unknown carried
  basis on `transfer_in` is documented as an explicit reconstruction limitation.

- Fixed: Manual internal-transfer bridge amounts now convert HKD, CNH, and
  other source currencies into the workspace base currency before adjusting
  All brokers equity, preventing a raw HKD amount from rendering as USD.

- Fixed: IBKR `Realized Summary` foreign-currency cash flows now reach the
  internal-transfer candidate menu as exact native `CNH`/`HKD` records after
  their base-currency `Transaction History` equivalents are safely replaced.
  Cross-bank funding legs remain available for manual binding, with no
  automatic counterpart selection.

- Fixed: Futu (HK) `TRANSFER FROM HK STOCKS ACCOUNT` rows now preserve Futu
  subaccount cash while removing the internal movement from All brokers equity,
  the daily transfer series, and funding metrics.

- Fixed: Negative Longbridge (HK) cash reversals, including a returned-cheque
  record, no longer appear as internal-transfer deposit sources.

- Fixed: A dated Longbridge (HK) deposit can bind to the matching BOCHK
  withdrawal, with any difference shown as a transfer fee.

- Fixed: A Longbridge (HK) deposit can be bound to the matching BOCHK
  withdrawal after an earlier HSBC-to-BOCHK leg. Binding failures now also
  surface the server's actionable error text.

- Changed: Unresolved internal-transfer binding selects now use the standard
  control border instead of a magenta emphasis border, and their surrounding
  binding shells no longer draw a magenta frame. The existing unresolved alert
  affordance remains available for review.

- Fixed: A BOCHK deposit can now bind to a matching Longbridge (HK)
  withdrawal, while HSBC-to-BOCHK bindings remain available for the same
  receiving-bank ledger.

- Fixed: A Longbridge (HK) cash deposit can now bind to a matching BOCHK
  withdrawal when BOCHK is the intermediate bank in a multi-bank funding chain.

- Changed: The standard scrollable-table filter header contract now lives in the
  shared table component stylesheet. Settings → Style tokens → Scrollable data
  table now demonstrates the Type-to-All hover disclosure, dropdown selection,
  and filtered-row update used by Investment History.

- Fixed: The `+` import panel's Broker dropdown now uses the single semantic
  frosted-glass surface with stable coverage and a page-level overlay, so HSBC,
  Charles Schwab, and IBKR options remain legible without inheriting the import
  form's `transform` or `overflow` composition context.

- Changed: BOCHK binding options now show the source subaccount type and short
  number, so HKD Current and HKD Savings are distinguishable. Printed CNY/RMB
  in BOCHK statements is displayed and stored as canonical CNH while the raw
  statement marker remains available as provenance.

- Changed: Transaction History `Type`, `Description`, and `Currency` compact
  filters now share the Type header's hover disclosure motion, inherited
  typography, and centered `All` alignment. Future compact column filters must
  use the same shared header classes and visual contract.

- Added: Internal-transfer candidate dropdowns now offer `Incorrectly identified, ignore`.
  The choice is durable and reversible, removes only the false-positive binding review,
  and leaves ledger cash, KOL classification, and aggregate replay unchanged.

- Fixed: Date-only HSBC order-status trades no longer disappear from the 1W
  intraday chart when the importer uses `20:00:00` solely as an ordering
  convention. Their buy or sell marker now anchors to that trading day's
  regular-session close.

- Changed: An exact same-day Schwab security-transfer binding now carries
  source-account FIFO basis into Holdings when IBKR does not provide a lot ID.
  The derived method is visibly labelled `FIFO reconstructed`; acquisition net
  cash includes source commissions and incomplete source inventory remains
  unavailable.
- Changed: A confirmed Schwab in-kind receipt is rendered as a passive
  destination record. Transaction History no longer offers a source-confirmation
  removal action or the aggregate-only carried-basis warning on that receipt;
  source-side manual binding remains the active reconciliation operation.

This permanent changelog preserves the historical notes that previously occupied the
`investment.js` module header. The source file now keeps only its current version and
architectural boundary summary so code navigation begins at the imports.

- Fixed: Unresolved Schwab security receipts are now scoped to the affected
  receipt and ticker. All brokers keeps unaffected holdings, equity, chart, and
  metrics visible, while only transferred positions with unverified carried
  basis show `Unavailable` P&L.

- Fixed: After a user binds an in-kind security transfer, replay now orders the
  source broker's transfer-out before the destination broker's transfer-in. This
  remains deterministic when same-day imported source row numbers place the receipt
  first.

- Fixed: Bound cash transfers now replay the withdrawal/outflow leg before the
  receiving deposit. The same deterministic rule applies when bindings are restored
  from storage or created manually.

- Fixed: Holdings values with a leading HSBC settlement marker now split integer
  and decimal digits using the same typography as ordinary values. Transaction
  History's Amount, Commission, Market value, Cash, and Equity columns reuse
  that split-number presentation.

- Added: Broker-scoped Metrics now exposes negative buy/sell spread as `Cut losses`
  in USD, including the Zircon (HK) closed-lot path. Transaction History's binding
  action dot and Description filter follow the currently visible filters, and the
  dot opens a body-level frosted tooltip only when an actionable row exists.

- Changed: Investment history, Settings language mappings, Backtest transactions,
  and DCA contributions now reuse the shared Local store pagination builder,
  renderer, tokenized styles, and active-indicator motion. Backtest and DCA use
  the shared ten-row page size.

- Changed: Unresolved transfer binding controls now use a transparent 10px-radius
  magenta border. Description wording standardizes `eDDA`, `KOL Rewards · ...`,
  and broker-specific cash-dividend spacing while retaining imported details.

- Added: Binding an internal transfer now uses the shared workspace Modal dialog
  with a rotating loading indicator and a notice that the rebuild may take up to
  10 seconds
  while the affected history, holdings, and Metrics are rebuilt.

- Fixed: Same-shaped internal-transfer rows now receive row-level disambiguation
  keys when their business fields collide. The binding endpoint rejects missing,
  ambiguous, cross-broker, cross-currency, out-of-window, and over-tolerance pairs;
  failed saves restore the prior local binding state, and transfer-fee attribution
  follows the outflow leg.

- Fixed: Longbridge HK cash-transfer candidates now use a two-day date window,
  so same-amount HSBC activity several days later cannot appear as a binding
  counterpart.

- Fixed: Cash-transfer candidates now require the outflow leg to occur on or
  before the deposit leg. Bank descriptions with an explicit earlier event date
  such as `01MAR` remain eligible when the statement posting date is later.

- Fixed: Cash-transfer outflows without an explicit event date may use a
  one-calendar-day posting lag. Explicitly later event dates and undated outflows
  two or more days after the deposit remain ineligible.

- Added: HSBC Copy/paste now performs a silent, read-only preflight after each
  clipboard change. Valid HKD Current, HKD Savings, and CNH cash-only pages can
  sync from ❶ alone, including mixed clips; USD Savings still requires the
  matching ❶❷❸ composite. Each pasted field has the shared blue pending spinner,
  green passed check, and ticker-style clear control. Only rejected content
  displays an error banner.

- Added: Bank of China (Hong Kong) now has a multi-file Consolidated Statement PDF
  input. The import help explains that HKD Savings, HKD Current, CNH (printed
  CNY/RMB), and USD subaccounts remain
  separate, while the server accepts incremental batches and exact re-uploads
  idempotently. Non-zero securities cash activity is rejected by the cash-only
  adapter.

- Changed: Transaction history descriptions now canonicalize spaced hyphen, en dash,
  em dash, vertical-bar, and bullet clause separators to ` · `. Identifiers and
  ticker hyphens remain unchanged. New imports apply the same rule during
  payload normalization.

- Fixed: Re-uploading the exact same manual XLSX cannot duplicate a transaction
  merely because a user-confirmed description or virtual-balance-reset category
  was enriched after the first import. The immutable SHA-256, sheet, and source
  row now form a conservative duplicate anchor; meaningful existing descriptions
  and the explicit virtual-reset marker remain intact.

- Verified: Longbridge KOL reward records remain source-currency income plus
  separately marked virtual balance resets. Metrics and Holdings value the
  rewards through the same dated CNY-to-USD conversion path used for other
  non-USD currencies; they are never relabeled as HKD or an equal USD amount.

- Fixed: Funding Metrics now preserve a deposit's actual USD, HKD, CNH, or CNY
  currency and pair each supported non-USD FX source leg with its matching USD
  receipt before deriving base-currency funding. A HKD deposit can no longer be
  presented as an identically numbered USD deposit.

- Added: The Metrics Realized P&L disclosure classifies base-currency results as
  trading spread gains, dividends net of withholding, cash rewards, interest
  credited or charged, cut losses, and commissions / fees. A transparent
  broker-reported reconciliation is retained whenever authoritative broker P&L
  cannot be allocated exactly to source rows. Holdings now uses the same total.

- Added: Transaction History exposes a Description filter only while one or more
  actionable internal-transfer rows remain unbound. Its only choices are All and
  the magenta, 10px-radius Unbound alert state.

- Changed: Transaction descriptions retain source evidence while presenting FX
  direction in sentence case and using ticker × quantity for grants and in-kind
  transfers. Currency-backed descriptions no longer receive the legacy
  `* Equivalent` fallback.

- Added: HSBC full monthly statements recognize an FX component only when the
  transaction description states an explicit foreign-exchange or currency-
  conversion event. A shared bank reference is retained for safe two-leg pairing;
  balance changes and `GOLD/EXCHANGE` text are never inferred as currency FX.

- Fixed: HSBC statement dates retain the Hong Kong calendar date printed by the
  bank. Because the source omits a time, the ledger's New York convention time is
  only a stable sort value and never shifts the source date.

- Fixed: Selecting one broker in the Metrics Brokers selector now displays that
  broker's existing logo in the trigger. All intentionally remains text-only.

- Changed: Metrics no longer renders the duplicate Total gain card. Coupon rebates and
  cash rewards now share one `Coupon rebates / Cash rewards` card, aggregated in the
  workspace base currency. Its disclosure lists each category and original currency;
  FX conversion does not add the HSBC settlement marker.

- Fixed: Expandable investment metrics now reserve their disclosure control as an overlay,
  so the summary amount and every detail row retain the same full-width, right-aligned
  numeric column.

- Fixed: Transaction history broker-and-currency filtering now uses canonical currency
  codes. Selecting HSBC and HKD therefore keeps HKD Savings and HKD Current rows in one
  result set; the account-type metadata is not treated as a separate filter dimension.

- Added: HSBC cash-ledger snapshots now retain USD, HKD, and CNH balances, including the
  per-currency ending map and its USD base-currency scalar. Full monthly HSBC PDFs can be
  uploaded individually while legacy paired statements remain available.

- Changed: Transaction history now renders configured money-market fund descriptions with
  their canonical ISIN and standard full name while preserving subscription, redemption,
  dividend, and share details from the imported source text. Raw ledger descriptions remain
  unchanged.

- Fixed: Settings export-image controls now persist through the shared versioned export-image
  registry and apply to the Settings preview, Investment PNG card, and workspace PNG card
  through the same derived dimensions and CSS variables.
- Added: Future exporters can register an isolated profile through
  `window.WORTHWARD_EXPORT_IMAGE` without duplicating the capture contract.

- Added: The standard manual investment workbook now recognizes China Merchants Bank,
  Bank of China, and Bank of China (Hong Kong) as
  institution choices. Existing CNY, CNH, HKD, and USD currency choices remain in the
  separate Currency column; the China Merchants Bank entry reuses the existing Wing
  Lung pure-mark SVG as permitted by the product design.

- Changed: The three manual bank institution choices now use the existing generic XLSX
  validation and import path directly from Trade > Investment.

- Changed: Broker and bank selectors now sort by their English display labels. Mainland
  China institution labels no longer include the redundant Mainland China parenthetical,
  and Zircon is displayed as Zircon (HK) while its internal code and resource filename
  remain stable.

- Added: Industrial and Commercial Bank of China and China Construction Bank now each
  have Mainland China and Asia institution choices. Each pair reuses one pure-mark SVG
  and uses the same generic XLSX validation and import path.

- Added: Investment Metrics now includes a single-select Brokers scope. All is the
  default, and selecting a broker refreshes the metrics and transaction history using
  the same broker filter semantics as Overview.

- Fixed: The existing hover-revealed Standard XLSX export now uses the Metrics Brokers
  scope as the same source of truth as the transaction table. All exports every visible
  broker row; a selected broker exports only that broker's rows. The workbook remains
  the existing standard import contract and is verified by the same round-trip parser.

- Fixed: Investment Metrics tooltips now use current calculation copy for offshore
  gain, broker rewards, stock grants, funding, commission, and P&L cards. Each
  tooltip identifies its calculation and lists the contributing ledger rows with
  row number, date, and a readable transaction description.

- Changed: Investment Metrics now removes the redundant portfolio-performance copy
  and renders the Brokers selector with the existing investment import broker-field
  treatment.

- Changed: Resolved in-kind transfers in Transaction history now use the canonical
  ticker-and-quantity description and a compact counterpart broker label.
- Fixed: Metrics tooltips now portal to the document body, wrap long content, and
  clamp to the viewport. The Metrics grid can scroll at narrow widths without
  clipping or creating a false scroll range from tooltip content.

- Verified: A complete read-only pass over all non-money-market stock and ETF
  rows confirms that Holdings, Stock details, and the calculation engine agree
  at two decimal places. The audited fourth Stock-details action is Export
  Transactions; Realized P&L remains a persistent metric card.
- Tested: Synthetic multi-account round trips remain consistent across the
  calculation engine and the Holdings and Stock details surfaces. Broker
  contributions stay scoped before aggregation.
- Documented: Scopes backed only by rolling broker history retain `partial`
  calculation status when that evidence cannot supply a verified account
  result. Displayed values include complete accounts only; no local estimate
  from incomplete history is added.
- Fixed: Stock-details identity for every configured money-market fund now uses
  the same positive green token logo as Holdings instead of rendering the raw
  black SVG asset.
- Fixed: The configured fund registry displays each canonical money-market
  symbol while retaining its standard full fund name.

- Changed: Stock-details exact-price hover badges now reuse the Holdings
  allocation badge's shared 2px corner radius while preserving the existing
  standard-blue fill, dimensions, and axis alignment.

- Fixed: The Stock-details horizontal hover guide now spans the complete price
  chart area, independently of the average-cost curve's visible range.

- Fixed: Stock-details daily-chart tooltips now carry weekend and market-holiday
  position changes to the following visible market close, so affected
  securities show the correct point-in-time position on hover.

- Fixed: Explicit, evidence-backed account history attestations allow otherwise
  rolling broker sources to reconstruct realized P&L only while broker, account,
  ticker, currency, cutoff date, trade counts, and quantities all match. The
  cross-broker display total is formed only after each scope is validated.
- Fixed: The final Holdings broker-rewards row now keeps its label and description
  on one compact line, so a table without pagination no longer ends in an
  oversized visual chin.
- Fixed: Account-scoped broker calibrations restore closed realized-P&L rows,
  preserve broker-reported negative signs, and avoid adding ticker cash
  adjustments when the broker total already includes them.
- Fixed: Realized P&L now replays inside broker-account security scopes, uses
  broker-reported closed-lot P&L without a second fee deduction, and aggregates
  only after each account result has been validated.
- Fixed: IBKR CSV/GainsKeeper deduplication now preserves official closed-lot
  proceeds, signed fee, basis, realized P&L, and source identity on the retained
  execution row.
- Fixed: Scrollable Investment tables now use one rounded clipping shell for the header, optional fixed summary, scrolling rows, and pagination tail. The reserved scrollbar gutter remains alignment-only with a transparent track, eliminating child-layer corner leaks.
- Changed: Holdings labels the live-price column `Last price` and shows each open position's local-currency session price change beneath it, using the same solid, right-aligned badge treatment as Unrealized P&L.
- Added: The Investment share drawer exports the active transaction scope as a round-trip standard XLSX workbook, and the broker selector exposes a neutral `No specified broker` fallback for importing that contract.
- Fixed: Fixed Holdings summary values for Market value, Realized P&L, Unrealized P&L, and % now derive their physical columns directly from the scrolling body table, preserving the same right edge across scrollbar and responsive-width changes.
- Added: The fixed Holdings summary row now shows non-zero aggregate daily realized and unrealized P&L badges, while every daily P&L badge sizes to its content and preserves decimal-point alignment with the cumulative value above it.
- Fixed: Holdings now uses the backend US market `session_date` even when a ticker has no realtime quote, so the daily P&L base advances at the Overnight boundary and remains the prior trading day's Intraday close through Post.
- Fixed: Investment ticker logos now use only the backend-resolved local asset URL. A missing logo renders the established placeholder without speculative `.svg` or `.png` requests, and Investment images load eagerly so Chromium-based browsers do not emit deferred lazy-load intervention diagnostics.
- Added: Open Holdings rows now show non-zero daily realized and unrealized P&L beneath their cumulative values in solid positive/negative badges with aligned decimal points.
- Fixed: Holdings allocation badges now render their text with the active theme background color, producing white text in light mode and dark text in dark mode without changing the established color-token contract.
- Fixed: Holdings supplies canonical issuer or fund names when a local market
  profile contains only its ticker placeholder.
- Fixed: The Holdings summary uses sentence case for Total equity and keeps the Cash through Cumulative P&L values on one shared right edge after live-number transitions reserve different widths.
- Added: Holdings now includes a live Market value column between Position and Realized P&L. Its 70%–80% horizontal track and numeric right edge match Transaction history at every supported width; the two P&L columns remain equal and the percent column uses the remaining compact track.
- Added: Holdings now displays Cash equivalents between Cash and Total equity, combining cash with the current market value of configured cash-equivalent positions and refreshing the total with live quotes.
- Added: Holdings and live valuation now accept Longbridge overnight quotes during the eligible US 20:00–04:00 New York session.
- Changed: During the overnight session, Holdings preserves the latest yfinance post-market quote when Longbridge is unavailable, while keeping the aggregate realtime pulse disabled because the fallback is not a live overnight quote.
- Refactored: IBKR import-feedback markup now lives in tested pure `investment/import-feedback.js`; `investment.js` remains the composition root and injects its established HTML escaper, preserving evidence and transfer-review copy.
- Changed: HSBC import feedback now explains the rolling Order Status scope, pending USD Savings settlement, and Portfolio-based execution-price calibration after a current-moment paste.
- Changed: HSBC import feedback now distinguishes provisional Portfolio pricing from final execution pricing repaired by a later settled USD Savings cash flow.

## Historical changes

- Changed: Markdown transaction exports now declare their active broker, event-type, currency, and date/range filters, preserve the Broker column label, and scope Stock details date ranges to the same filtered rows rendered in the exported table.
- Fixed: Overview realtime markers now use the active market's calendar day. During Hong Kong trading after the US session has closed, the marker is anchored to Hong Kong's current date instead of the previous New York date.
- Refactored: Realtime quote polling cadence, in-flight cancellation, and restart sequencing now use the tested realtime module.
- Refactored: Investment split-layout measurement, clamping, observation, and resizer cleanup now live in a dedicated tested module.
- Refactored: Stock-details range and intraday boundary rules now come from the tested Stock-details module.
- Refactored: Broker, currency, and Stock-details date filtering now use a dedicated tested transaction-filter module.
- Refactored: Realtime numeric transition parsing and DOM animation now live in a dedicated tested module.
- Fixed: US-suffixed ticker placeholders now resolve through the same standard-name fallback as their bare ticker aliases.
- Changed: Investment realtime polling now uses the one-minute cadence of its yfinance source, reducing free-provider rate-limit pressure while preserving live session updates.
- Fixed: Stock-details live markers now retain their horizontal endpoint while using the eligible realtime quote price for the vertical coordinate.
- Changed: Stock-details realtime updates animate only changing values; metric-card chrome no longer pulses or glows.
- Fixed: A duplicate same-value realtime sync no longer cancels a visible digit-roll animation.
- Fixed: Digit-roll batches now retain their animated entries instead of completing immediately.
- Fixed: Realtime chart points now preserve Longbridge, yfinance, or mixed provider provenance.
- Fixed: Investment stock-details loads the current helper revision through an updated cache key.
- Fixed: Stock-details date guidance now stays in the fixed feedback region without a redundant visible field label.
- Changed: The Stock-details date picker now uses dynamic guidance, an opaque surface, and a stable frame across day and month views.
- Changed: Stock-details Time filtering now selects one day or one natural month and keeps the date picker open after selection.
- Fixed: Type filter dropdowns now size to their widest option while respecting the available viewport width.
- Changed: Transaction-history arrows now switch five-page chunks, selecting the next chunk's first page or the previous chunk's last page.
- Fixed: Mixed y-axis tick formats now align exact-price badges to the visible fractional tick column.
- Fixed: Stock-details exact-price badges now align their integer or decimal column to the rendered y-axis tick anchor.
- Fixed: Fractional metric glyphs now share a precise visual bottom edge, with the decimal point sized as part of the fraction.
- Added: Stock-details hover guides now include an exact-price horizontal crosshair and y-axis badge across every supported range.
- Fixed: Pagination ellipses now use three geometry-centered solid dots instead of a font-baseline glyph.
- Changed: The Type filter now discovers every visible ledger event type instead of limiting selection to Buy and Sell.
- Changed: Transaction history pagination now uses fixed five-page chunks with one-page navigation arrows, boundary ellipses, and accessible page labels.
- Fixed: Variable-width pagination renders now synchronously recalculate the active indicator and preserve its cross-chunk animation in viewport coordinates.
- Changed: Transaction history pagination now displays 100 ledger rows per page.
- Changed: Transaction history pagination now mounts as a canonical Frosted glass overlay inside the lower table, revealing scrolling rows beneath it while preserving end-of-table clearance.
- Added: The primary Investment view rail now uses the shared equal-width overflow contract with a directional faded preview for future items.
- Changed: Overview 1W and 1M x-axis labels now show date and year only while tooltips retain minute precision.
- Changed: Stock-detail metric source rows now start collapsed and disclose independently through the shared table-arrow control.
- Fixed: Measured segmented controls now resolve edge-cap geometry from their rendered box, keeping the first and last thumb caps concentric with the rail.
- Fixed: Investment range rails now remain above chart canvases without clipping their elevation shadows.
- Fixed: The vertical split now reserves explicit in-flow chrome and pagination height, keeping page controls visible at the lower drag limit.
- Changed: Stock details now follows the Neo draft's three-column composition, with independently aligned identity, chart, metrics, and donut tracks.
- Changed: Responsive donut orbit sizing now uses the rendered circle diameter, maximizing the track without cropping satellite logos.
- Changed: The Stock-details range control now occupies its own layout row instead of overlapping the chart canvas.
- Changed: The vertical split now protects two visible transaction rows per history table, allowing Stock details charts to use more height.
- Fixed: Type menu selections now keep the dropdown open for continuous editing until an outside click or Escape closes it.
- Changed: The Type filter now supports checked multi-selection, mirrors All across every child check, and separates All from individual types.
- Fixed: Overview track reflows now resize the equity canvas after its stage settles, preserving both YTD x-axis label lines at low viewport heights.
- Changed: The Type filter's selected All option now toggles to no selection, and All restores the full transaction set from that state.
- Fixed: The hover-revealed Type filter label now inherits the table header typography instead of the browser's native button font.
- Fixed: Broker filter all-selection keeps individual broker checks without rendering every option as an active gray pill.
- Fixed: Manual internal-transfer binding preserves the active history filters, page, and scroll position.
- Fixed: Linked history scrolling now resolves the global history scrollport explicitly, avoiding the similarly named selected-ticker scrollport.
- Fixed: Hover-linked transaction tables now match the selected ticker by exact ledger entry and never scroll the table the user is inspecting.
- Changed: The Investment split now derives its limits from the chart stage and two visible transaction rows at the current resolution.
- Fixed: The 1M overview honors its requested 23-session calendar and preserves a tokenized guard above the curve peak.
- Fixed: Resized investment tracks now clamp against the workspace's real available height after viewport shrink, keeping Transaction history fully visible.
- Added: Overview and Transaction history share a responsive horizontal resizer with pointer and keyboard support.
- Changed: HSBC statement mode uses one smart multi-file selector and validates complete PDF pairs before enabling import.
- Changed: Investment Type headers now show the legacy Type label by default and reveal the current side filter only on hover, focus, or open interaction.
- Added: HSBC statement mode now accepts matched composite and investment PDF batches and refreshes from the committed store version before reporting success.
- Fixed: Fixed table headers and holdings summaries render canonical Frosted Glass directly on their interactive header table, matching the pre-refactor material hierarchy.
- Fixed: Broker filter controls in extracted investment table headers now receive pointer input and portal their dropdowns outside clipped Frosted glass table layers.
- Fixed: Investment range segmented controls now scroll the active edge option fully into view when horizontal space is constrained.
- Changed: Investment equity chart x-axis date labels now use weight 400 while preserving the existing font and size.
- Fixed: Investment stock-details helper import now revs to the x-axis date label font-weight update.
- Fixed: Investment stock-details helper import now revs to the pre-range overnight marker projection fix.
- Fixed: Investment stock-details helper import now revs to the no-dot intraday average-price line correction.
- Fixed: Investment stock-details helper import now revs to the intraday average-price event-stepped cost line update.
- Fixed: Investment stock-details helper import now revs to the overnight first-candle anchoring correction.
- Fixed: Investment entry module diagnostics now report the current loaded frontend file version after the stock-details intraday chart update.
- Changed: Stock details 1W now loads regular-session 1-minute candles independently of realtime polling so GKX intraday fills can be plotted precisely.
- Fixed: Investment history highlight cleanup now ignores empty cloned-row ids so post-import refresh cannot call querySelector("#").
- Fixed: Transaction history pagination now scopes history scroll and body lookups to the Transaction history surface so Stock details history tables cannot intercept updates.
- Fixed: Investment history pagination pointer handling now accepts browser pointerup events with neutral button codes, so coordinate mouse/touch clicks activate page buttons.
- Fixed: Investment history pagination binding now runs before heavier Investment view setup so page buttons remain interactive even if later initialization work is delayed.
- Fixed: Investment history pagination now handles pointer release directly as well as keyboard click, making page buttons respond reliably to real mouse and touch input.
- Fixed: Investment history pagination now preserves the shared Local store pagination bouncy indicator transition when changing pages.
- Fixed: Transaction history pagination now updates the real scroll table instead of the frosted underlay clone, and underlay table clones no longer duplicate DOM ids.
- Fixed: Scrollable investment overlay column syncing now preserves fractional body widths so per-column rounding cannot expand the fixed table past the shell.
- Fixed: Scrollable investment overlay tables now sync fixed cell border-box widths from body rows and assign the scrollbar track only to the final fixed cell.
- Fixed: Scrollable investment overlay tables now keep full-shell Frosted glass material while assigning the scrollbar track to the final fixed column only.
- Fixed: Scrollable investment overlay tables now use a shared content-width variable plus border compensation so rightmost fixed headers never occupy scrollbar tracks.
- Fixed: Scrollable investment table Frosted glass underlays now begin at the real scroll viewport edge, avoiding ghost rows at scroll top and restoring Transaction history header material.
- Fixed: Holdings table overlay now keeps a synced hidden body-table underlay behind the Frosted glass header and summary material.
- Fixed: Investment view Metrics segmented pill now relies on the edge-cap geometry solver without a manual optical offset, keeping both the right cap and text center aligned.
- Fixed: Investment view segmented edge pills now lock their outer cap centers to the shell cap centers while preserving text-centered geometry.
- Fixed: Investment view segmented pill schedules a post-transition remeasure so active labels stay pixel-centered after final text layout settles.
- Fixed: Investment view segmented pill measurement now reads text-node ranges instead of the flex label box, aligning short labels to the actual rendered glyph center.
- Fixed: Investment view segmented pill positioning now uses the active label text range center, removing the last 1 px visual offset on Metrics.
- Fixed: Investment view segmented pills now center the blue highlight on the active label text for short labels such as Holdings and Metrics.
- Fixed: Scrollable investment tables now measure overlay header height dynamically so fixed summary rows never cover top rows.
- Changed: Community share PNG capture now uses a 1080 px by 1730 px 2x export shell grid.
- Changed: Community share PNG capture now reads export dimensions and footer sizing from the same CSS tokens used by the settings export-image preview.
- Fixed: Aggregate display cash no longer sums broker display balances, preventing internal-transfer bridge days from drawing zero-equity pits.
- Fixed: HSBC pending-settlement display cash now flows into Holdings cash, total equity, and realtime quote refreshes.
- Improved: Broker filter opens from cached ledger brokers without forced dropdown width measurement or first-click index rebuilds.
- Removed: the retired IBKR manual API upload mode from the import UI and submit path.
- Fixed: Measured segmented controls keep the selected item above the glowing pill and scroll internal items into view without moving the outer frame.
- Refined: Investment import help now gives GOV.UK-style guidance for IBKR CSV, IBKR GainsKeeper, and HSBC copy/paste imports.
- Added: IBKR GainsKeeper OFX/GKX multi-file import mode with idempotent precision upgrades for older CSV records.
- Fixed: IBKR CSV import now reports success as soon as the server commit finishes, then refreshes the large investment dataset in the background.
- Fixed: HSBC import validation now declares the selected statement/copy-paste mode before checking readiness, restoring Investment page initialization.
- Added: HSBC import mode now supports multi-file statement PDF upload for USD Foreign Currency Savings backfills while keeping copy/paste as the default path.
- Added: Investment Metrics now include Total offshore gain, combining holdings P&L with converted broker cash benefits without double-counting stock grants already inside holdings P&L.
- Fixed: Investment Metrics realized and cumulative P&L now exclude broker reward rows because broker benefits are reported in dedicated cards.
- Added: Investment Metrics now split broker benefits into coupon rebates, cash rewards, KOL rewards, and realized/unrealized stock-grant P&L.
- Fixed: Investment entry module version metadata now matches the loaded frontend file version.
- Fixed: Money-market Holdings icons now use an aligned green CSS-mask token instead of loading the black SVG fill through an img tag.
- Added: Cash-equivalent MMFs render as Holdings income rows with green dollar-token icons, while Franklin keeps its local fund logo.
- Fixed: Longbridge HK MMF transfers now replay as real cash plus synthetic cash-equivalent valuation anchors, removing saw-tooth overnight equity.
- Improved: Broker filter now uses a transaction broker index for large histories, avoiding full-list broker checks on every filter click while keeping options limited to brokers present in the loaded ledger.
- Refined: Tiger Trade and uSMART (HK) PDF import controls now reuse the shared bridge-field upload layout.
- Fixed: uSMART (HK) symbol-less fractional shares stay valued between purchase, withdrawal, and sale.
- Fixed: Tiger Trade Funds in Transit subscriptions no longer create false equity drawdowns.
- Fixed: Tiger Trade bond and money-market fund holdings retain statement-price equity between subscription and redemption.
- Added: uSMART (HK) and Tiger Trade statement PDF imports with multi-file validation and idempotent submission.
- Added: Broker-scoped Holdings P&L calibration keeps Longbridge HK and SG additive when both accounts are imported.
- Fixed: Investment Holdings now loads authoritative broker P&L calibrations from the refreshed data-utils module.
- Fixed: Longbridge HK money-market transfers preserve cash-equivalent equity through placements and recognize only redemption interest while retaining actual transfer amounts in history.
- Removed IBKR Gateway; the former web-service importer was subsequently retired in favor of offline files.
- Fixed: IBKR forex trade component rows now dedupe across overlapping CSV imports and display the acquired quote currency with a compact conversion description.
- Fixed: Investment donut cash-equivalent tickers now keep their original holding order while using the standard cash-green token, and non-cash gradient colors are compressed around them.
- Fixed: Investment import broker dropdown refresh now stays idempotent, so selecting HSBC and other brokers is not broken by duplicate shared-select bindings.
- Fixed: Investment broker filter dropdown now sizes to its longest option instead of using a fixed narrow width.
- Fixed: Investment broker filter now unions payload and transaction broker codes and shows Longbridge (HK)/(SG) labels instead of identical logo-only tiles.
- Refactored: Broker filter dropdown always renders full names for every broker (matching "Longbridge (SG)" style) and uses fixed positioning + internal scrolling so the full list is reachable via scroll at any viewport height.
- Fixed: Investment stock-details helper import now revs to the broker metric split-factor hint scope fix.
- Fixed: Investment replay now passes rendered split-factor hints through ledger processing so zero-price grant rows share the same SPYM/SPLG quantity basis as sibling trades.
- Fixed: Versioned investment helper module imports so browser ES-module cache drift cannot keep stale SPYM/SPLG valuation logic after a git pull.
- Added: Loaded investment helper module versions are exposed on `window.WORTHWARD_INVESTMENT_MODULE_VERSIONS` for automatic diagnostics.
- Fixed: Stock details metrics and price chart no longer fully re-render on realtime quote poll resets, so after-hours polling cannot blank metric cards or flicker the canvas.
- Fixed: Investment realtime polling and breathing pulse are disabled during New York post-market and on non-trading days.
- Fixed: Holdings Last always fetches open-position realtime quotes on page load and applies the latest US pre/post bar even when its session date is not today's New York calendar day.
- Fixed: Holdings Last now applies US post quotes from the prior session day and Hong Kong intraday quotes on their own market clocks during US after-hours.
- Fixed: Lineage profile lookup now uses exported data-utils helpers instead of an undefined local lineage-map reference.
- Fixed: Canonical lineage successors such as SPYM now inherit legacy ticker profiles so issuer full names remain visible after symbol-only subtitle suppression.
- Fixed: Investment ticker identity rows now resolve known issuer full names and hide duplicate symbol-only subtitles when no better label exists.
- Fixed: Investment holdings and overview chart now bootstrap yfinance pre/intraday/post quotes on first render instead of briefly showing the prior regular-session close.
- Fixed: Investment realtime quote application now only marks holdings and chart points when the quote session matches the active New York clock session.
- Fixed: Investment transaction descriptions now display canonical tickers, matching holdings and stock details.
- Fixed: Holdings, stock details, exports, and valuation replay now aggregate canonical investment tickers so MSFT.US merges into MSFT and SPLG.US inherits SPYM.
- Fixed: Investment cash replay now ignores IBKR FX Translation P&L accounting rows so broker cash stays aligned with the authoritative cash snapshot.
- Fixed: Investment cash replay now preallocates later same-currency funding to earlier broker-statement trades when missing intraday timestamps would otherwise create a false negative cash balance.
- Fixed: Investment history Max range and pagination now keep processed transaction caches current, so Gateway-ledger pages cannot render as empty while transactions exist.
- Added: Mixed-broker portfolios now calibrate each broker's latest history Balance from per-broker ending cash snapshots, so IBKR CSV Ending Cash can align with the broker app after HSBC merge
- Fixed: Investment export and share action buttons now align with the global theme toggle horizontally and the view segmented control vertical center.
- Fixed: Holdings Last now reuses the live digit-roll updater with green-up and red-down tone, and summary cash/equity values stay on the same realtime sync path.
- Fixed: Overview equity range switching now updates the chart in place so the segmented control is not destroyed and re-measured on every 1W through Max change.
- Fixed: Daily-equity live chart points now survive render-state preparation so 1M through Max can keep the is_realtime marker target needed by the breathing pulse.
- Fixed: Overview live-session slot, dedupe, shared-range extension, realtime polling chart writes, and breathing marker targeting now apply only to 1M through Max, leaving the specialized 1W intraday pipeline untouched.
- Fixed: Investment overview equity now keeps a single stable today slot during pre-market, regular, and post-market live sessions on daily ranges instead of appending a second same-day point that duplicated x-axis labels or shifted the plotted range.
- Fixed: Broker filter trigger now keeps a centered chevron in the resting state and no longer shows broker logos or placeholder tiles in the header cell.
- Improved: Holdings, Stock details, and Metrics live values now right-align integer digits, measure per-character slot widths, and animate only changed digit positions with easeOutCubic requestAnimationFrame rolls that avoid layout jitter.
- Changed: Investment metrics cards now add horizontal breathing room and right-align split metric values.
- Changed: USD funding metrics now omit the dollar sign because USD is the workspace default currency.
- Added: Investment metrics cumulative and unrealized P&L now reuse the Holdings live value updater during pre-market, regular, and post-market sessions.
- Fixed: Holdings and Stock details live value animations now reserve their measured maximum box so digit rolls do not resize surrounding table rows or metric cards.
- Fixed: Investment overview 1W now preserves the last healthy intraday equity curve when switching away and back from another range.
- Fixed: Investment overview 1W now rejects degraded flat recomputations so range switching cannot overwrite a real curve with a horizontal line.
- Fixed: Investment overview 1W ticker refresh requests now time out independently so one slow market-data source cannot block the whole chart.
- Fixed: Investment overview 1W now sends the exact five selected trading days to the intraday endpoint so missing days can be refreshed and returned.
- Fixed: Investment overview 1W now actively asks the intraday endpoint to refresh stale one-minute stores before calculating close-based equity.
- Fixed: Investment overview 1W now keeps successful ticker rows when another ticker's one-minute refresh fails.
- Fixed: Investment overview 1W now hides cross-day line segments so adjacent trading days can have factual gaps instead of forced joins.
- Removed: Investment overview 1W no longer keeps the unused flat-line fallback helper after switching to close-only intraday points.
- Fixed: Investment overview 1W now leaves a selected trading day blank when no local one-minute close data exists instead of drawing fallback flat steps.
- Fixed: Investment overview 1W now renders exactly five US trading days and only includes the current day while regular-session intraday is active.
- Fixed: Holdings live values now preserve the standard metric split-number layout during digit rolls so table rows do not jump while prices update.
- Fixed: Investment overview 1W now starts from an empty fixed intraday axis instead of briefly rendering the daily equity line before close-based data loads.
- Fixed: Investment overview 1W excludes the current New York calendar day before regular-session intraday begins.
- Fixed: Investment live metric updates now use a single in-place digit roll without rendering duplicate full-value spans or outside delta badges.
- Fixed: Investment overview 1W keeps blank intraday slots as null instead of coercing them to zero.
- Fixed: Investment overview 1W now leaves non-trading days and future intraday minutes blank unless at least one open holding has a real one-minute close for that slot.
- Changed: Investment overview 1W abandons candlesticks and renders a fixed five-trading-day intraday close equity line with 390 regular-session slots per day.
- Changed: Investment overview 1W applies dated trades and cash movements from the next trading-day open to match day-precision broker statements.
- Fixed: All investment share card titles and footer timestamps now use the Overview typography.
- Fixed: Stock details share cards now reserve the same 360 px chart height as the Overview share chart.
- Fixed: Holdings share cards now show the rendered summary row first and preserve view-colored P&L values.
- Fixed: Investment share footer brand icon and timestamp now share the same vertical centerline.
- Fixed: Investment share card titles now match the exported view instead of always rendering Overview.
- Fixed: Investment share donut previews now preserve satellite-logo safe bounds while using the available height.
- Fixed: Investment share footer now uses a 36 px brand icon and bottom-aligns the icon, timestamp, and QR code.
- Fixed: Investment share cards now apply the 108 px QR size in both template previews and all PNG export paths.
- Fixed: Overview share export now preserves identical curve coordinates when masking and replaces y-axis values with masked markers.
- Fixed: Holdings share export now eagerly resolves row logo assets and times out stalled screenshot encoding instead of leaving the output button busy.
- Changed: Investment share templates now align footer brand and QR sizing across all four exported views.
- Fixed: Investment share image capture now loads the screenshot renderer locally before falling back to CDN and reports stage timings.
- Fixed: Stock details intraday quote loading now stays off outside pre-market, regular, and post-market sessions.
- Fixed: Investment live values now stop polling and reset outside pre-market, regular, and post-market sessions.
- Fixed: Investment overview realtime pulse now only appears during pre-market, regular, or post-market sessions.
- Added: IBKR import feedback now reports incremental added and duplicate record counts
- Refined: Overview community share PNG export now redraws the equity chart on a share-card canvas so the curve uses the allocated height
- Refined: Overview community share PNG export now renders equity chart axis labels at 23 px
- Fixed: Overview community share PNG export now freezes donut satellite logos at their final orbit positions before capture
- Changed: Overview community share PNG export now uses the same 540 px token grid as the style-token preview
- Added: Investment share preview now renders the same community share card used by PNG export and refreshes across all four investment tabs
- Refined: Investment live values now show a transient signed delta badge while only rolling changed digit positions in the main value
- Added: Investment realtime quotes now update affected Stock details metric spans with the same live digit flip used by Holdings Last, Unrealized P&L, and weight cells
- Fixed: Share mask controls now stay expanded while masking is active so reveal/mask toggles remain clickable during repeated switching
- Added: Share masking now hides Investment overview y-axis numbers on the live chart and exported images without changing chart layout or point coordinates
- Refined: Investment overview realtime pulse now uses a calmer 1.8-second brokerage-style cadence with softer microwave opacity and glow
- Fixed: Investment overview realtime pulse now reserves enough chart padding so the right-side microwave rings are not clipped by the canvas edge
- Refined: Investment overview realtime marker now uses a strict 1-second pulse with a smaller solid-green contraction point and faster staggered microwave rings
- Added: Investment overview equity now appends a live yfinance 1-minute pre-market, regular-session, or post-market valuation point, polling every 10 seconds and marking the line end with a pulsing green ring
- Changed: Masked Holdings share cards now omit the `Shares` and `P&L` columns entirely instead of visually redacting stale table cells
- Added: Investment share actions now fan out to the right of the export button, let users mask stock-detail metric values as `***`, and save the currently visible panel as a local PNG screenshot
- Fixed: HSBC orders that carry matched bank settlement balances now reuse those authoritative post-trade cash snapshots, preventing impossible negative cash rows in the no-margin HSBC ledger
- Fixed: HSBC mirrored same-day settlement cash rows now stay in ledger replay but are hidden from Transaction history and Markdown export so trade-funding shadow deposits no longer masquerade as standalone events
- Refined: Investment fetch-abort debug reporting now uses the shared optional backend-provided config instead of a hard-coded localhost endpoint
- Changed: Investment page initial bootstrap now reuses the shared workspace modal dialog overlay instead of the floating import-feedback banner while data is loading
- Added: Stock details range segmented control now restores the 1Y option and adds an Auto window that keeps all buy and sell markers visible while trimming unrelated post-exit price history
- Refined: Stock details segmented control continues to reuse the shared nested range-label span markup while expanding to fit seven measured pill options
- Added: Initial investment page boot now shows the shared floating banner while transactions load, then clears it automatically once rendering finishes
- Refined: Internal-transfer link select now reuses the shared form-select styling, and the reference text matches the history table body size
- Added: Investment equity range segmented control now exposes a 1Y option between YTD and Max
- Refined: Resolved internal-transfer rows now show the bare HSBC reference in the history cell while the closed select displays a compact from HSBC label
- Refined: IBKR post-import feedback now renders as a numbered hanging-indent checklist and escalates immediate action when possible HSBC transfer links still need manual binding
- Refined: Manual internal-transfer rows now collapse into a compact resolved label, surface explicit USD currency evidence after linking, and expose an inline undo path inside the same select control
- Added: Mixed-broker investment history now supports manual internal-transfer binding for candidate deposit rows, with local persistence, unresolved pink prompts, and aggregate look-through cash bridging that removes duplicate-equity spikes between linked legs
- Added: Investment ledger rows now carry broker-scoped and aggregate valuation fields side by side, so mixed IBKR and HSBC imports keep per-broker Balance, Market value, and Equity without contaminating the combined portfolio panels
- Changed: Transaction history now renders broker-scoped valuation columns while Charts, Holdings, Stock details, and Metrics read explicit aggregate portfolio fields only
- Added: HSBC controlled browser bridge now includes an Edge-run dashboard collector that treats the HSBC Online Banking dashboard as the unified source for USD deposit and withdrawal records
- Fixed: Investment equity canvas now skips the synthetic pre-ledger starting-cash anchor, so the curve begins at the first real transaction row instead of the assumed 0.02 opening point while still extending forward across later valuation-only trading days
- Added: HSBC controlled browser bridge now closes blocking dialogs, opens Quick Trade in read-only mode, and captures cash-account buying power as authoritative cash without ever previewing or submitting an order
- Added: HSBC Order Status capture now proactively closes blocking dialogs before reading filters and pagination
- Changed: Authoritative broker position snapshots can now flow broker-supplied market values, last prices, and ending cash into the latest dashboard valuation
- Fixed: Investment equity canvas now keeps post-trade valuation dates in the rendered series, so the line extends from the last transaction day through the latest yfinance-backed trading day while holdings-linked hover anchors still target real ledger rows
- Changed: Investment equity canvas now rounds plotted values to the same 2-decimal precision used by the history table, so the curve starts at the first rendered total-equity value without hidden intermediate market-only micro-moves
- Added: Transaction history now uses the shared Local store pagination shell so large ledgers render a smaller DOM slice per page and switch faster
- Fixed: Stock detail and ticker identity displays now normalize Longbridge `.US` symbols to the short display ticker when rendering UI labels and fallback names
- Fixed: Stock details Average price cost curves now replay transaction unit costs onto the same split-adjusted price basis as the rendered chart, keeping split-affected tickers aligned without perturbing normal symbols
- Fixed: Stock details Markdown export now scopes the transaction-history section and metric snapshot to the currently selected ticker instead of reusing the full portfolio history table
- Added: Stock details price chart now renders a muted gray Average price cost curve, replaying ticker transactions onto every visible chart point so the line and tooltip match the point-in-time cost basis
- Refactored: Split chart-orbit helpers and transaction-valuation helpers into dedicated ES modules, keeping this entry file focused on page orchestration and reducing single-file context size
- Fixed: Restored missing cross-module orbit-state and position-state bindings after the split, so all investment view tabs render again without runtime ReferenceErrors
- Fixed: Stock details trade markers now infer cumulative stock-split factors from the rendered price series before mapping transaction fill prices onto the canvas, so older split-affected trades align with the chart without distorting normal unsplit fills
- Fixed: Stock details price-chart trade markers now wait for a stable visible chart box before first paint and resync again after the view-height animation settles, so hyperlink entry matches refresh rendering
- Fixed: Stock details tooltip now treats missing post-trade holdings keys as a flat position, so fully exited tickers no longer retain stale share counts on later hover dates
- Changed: Stock details share URLs now use the shorter `#stock_panel` hash while still recognizing the legacy long-form hash
- Fixed: Hover-linked history and stock-details tables now only auto-scroll their counterpart table, so the hovered table stays user-driven while the mirrored row remains visible
- Fixed: Holdings header table now compensates for the body scrollbar gutter, so numeric columns stay horizontally aligned with body cells even when the scroll state changes
- Fixed: Stock details price chart now keeps the same y-axis input domain across first paint and post-layout resync, so buy and sell triangles no longer jump vertically when opening a ticker view
- Added: Investment page now remembers the last visited view, stock-details ticker, and stock-details range in browser local storage, restoring bare `/trade/investment` visits back to the prior selection
- Changed: Stock details history table Realized P&L column now omits the USD dollar symbol while preserving numeric formatting and non-USD currency codes
- Fixed: Stock details buy and sell triangle markers now reserve horizontal in-canvas padding so edge markers no longer clip against the canvas boundary
- Changed: Stock details time-range segmented control replaces 1M with 3M and now filters by the natural prior 3-month window
- Changed: Stock details time-range segmented control removes the 1Y option and its matching date-filter branch
- Fixed: Segmented control measured-pill geometry now includes container inline padding in explicit width calculation, so the rightmost blue pill arc stays concentric with the outer shell and no longer clips
- Changed: Stock details now shows Average price instead of Buy cost so the metric matches the holdings average-price calculation
- Added: Stock details now uses local 1-minute OHLC candlesticks for the 3D and 1W ranges, auto-refreshing and storing missing intraday cache via the existing market-store pipeline
- Added: Stock details price chart now shows a right-aligned in-canvas time-range segmented control with 3D, 1W, 3M, YTD, and Max filters that reuse the shared pill animation
- Fixed: Stock details price chart y-axis now ignores shared-range gap points so sparse ticker histories no longer collapse toward zero
- Fixed: Stock details price chart now reuses the shared investment chart date range so every ticker keeps the same x-axis span as the main equity canvas
- Added: Stock details overview now includes a middle price chart card that plots the selected ticker close series with buy and sell triangle markers
- Fixed: Charts portfolio donut hover now coalesces duplicate updates and reuses cached orbit geometry to avoid flicker and animation stutter
- Improved: Charts portfolio donut satellites now enter from a distant transparent orbit, move along the shared orbit with non-linear angular easing, and resolve tiny-slice crowding with constrained on-orbit spacing
- Changed: Stock details donut now uses scoped non-linear orbit animation for its ring and ticker satellite while keeping the selected ticker on the standard blue token and cash on the standard green token
- Changed: Stock details donut is now decoupled from the Charts donut and renders a three-part allocation view for the selected ticker, cash, and remaining equity with hover-linked snapshot updates
- Fixed: History and stock-detail tables now respect recent manual scrolling, so hover-linked auto-scroll no longer snaps the view back to an older row while the user is browsing another date
- Added: Stock details transaction history now shows a per-row Market value column based on post-trade holdings times the same-day close, with flat positions rendered as '-'
- Improved: Investment Markdown export now reads the rendered Metrics panel so exported metric rows stay fully aligned with the page
- Added: Investment Metrics now include cumulative, realized, and unrealized P&L summary cards sourced from Holdings totals
- Fixed: Holdings weight column now uses the latest valuation-point total equity, so unlevered accounts no longer show allocations above 100% when the last trade date lags the latest 1d close
- Fixed: Investment Metrics no longer show false panel scrollbars when tooltip content extends beyond metric cards
- Added: Investment Metrics now include total commission and interest charged, and loss-like values render with explicit negative signs plus the shared negative color token
- Improved: Stock details metric cards now reuse the same negative-value treatment for total commission and align to the shared responsive metric grid pattern
- Fixed: Shared investment theme resolution now lives in page scope, so refresh no longer throws `resolvedTheme is not defined`
- Fixed: History-row and chart hover now preview matching stock-detail rows without overwriting the user's selected ticker
- Fixed: Holdings ticker clicks now use controlled stock-details hash syncing instead of native anchor jumps, so view state and scrolling stay aligned
- Fixed: Investment valuation now consumes bundled price history from the primary transactions payload, reports degraded states explicitly, and avoids per-ticker N+1 refresh fetches during first render
- Removed: Legacy manual-entry selector and transaction-form branches that no longer match the current Investment template contract
- Improved: Investment chart hover now scrolls the full same-day Transaction history row group into view instead of centering only the first matching row
- Added: Investment segmented control now appends a fourth "Stock details" view with same-page holdings links and animated pill focus
- Added: Stock details view now shows a selected ticker identity block, a standard donut shell, and a per-ticker detail table with realized P&L per transaction
- Improved: Trade effective price and realized P&L calculations now account for separate commissions in manual buy and sell rows
- Added: Settings action button import flow now exposes explicit disabled and in-progress states, including present-participle copy while the task is running
- Changed: Investment Charts now render one equity point per market day, filling no-trade trading days from parquet closes and collapsing same-day multi-trade activity into a single daily close snapshot
- Changed: Non-trading days with investment ledger activity now render on the curve using the previous available market close, while hover only anchors to history rows on dates that actually have ledger activity
- Fixed: Investment equity canvas now respects responsive container width at medium breakpoints instead of overflowing around 900 px layouts
- Fixed: Investment equity tooltip now uses viewport-safe positioning so frosted glass popovers no longer clip against ancestor overflow or screen edges
- Added: Charts hover now anchors and highlights all same-day Transaction history rows via the shared metric-style history locator
- Added: Holdings row hover now anchors and highlights the latest matching Transaction history row for that ticker via the shared metric-style history locator
- Improved: Metric, chart, and holdings interactions now share the same history-row highlight lifecycle and clear hover state on exit
- Fixed: Investment template, CSS, and JS now share the same chart-surface container contract again via investment_view_surface
- Improved: Transaction history rows now render through reusable cell classes instead of per-cell inline styles
- Improved: Holdings logos now use delegated fallback handling instead of inline onerror handlers
- Improved: Funding metric cards now render from a shared definition list instead of repeated hard-coded markup
- Fixed: Transaction processing no longer mutates the original API payload order while building the ledger view
- Fixed: Holdings header spelling now uses "Realized P&L"
- Reduced: Investment page accent colors now resolve through theme tokens instead of repeated hard-coded hex values
- Fixed: Holdings now keep a stable logo slot, so missing or failed ticker logos no longer break row alignment
- Fixed: Investment transaction payload now retries profile-based logo resolution when a local logo asset is missing
- Updated: Import feedback now appears as a top floating modal-banner notice with iOS-style drop-in motion
- Fixed: Import feedback copy no longer repeats the success prefix returned by the backend
- Updated: Investment segmented control now shows "Charts"
- Added: Export the Holdings and Transaction history tables as a Markdown download from the page header
- Fixed: Investment equity curve now starts from the first real transaction point instead of a synthetic zero-value seed
- Improved: Investment equity tooltip now shows equity, market value, and cash from the processed ledger snapshot
- Updated: Investment equity hover guide now matches the compare chart vertical hover line behavior
- Updated: Investment equity series color now resolves from the shared theme accent token
- Reworked: Holdings view now renders as a scrollable data table with per-ticker cost basis and P&L metrics
- Improved: Holdings and Metrics data now consistently use the Workspace metric value token
- Fixed: Investment view segmented control now switches cleanly between Chart, Holdings, and Metrics
- Fixed: Equity curve only renders inside the Chart view instead of bleeding into other tabs
- Fixed: Dashboard rendering no longer crashes on undefined transactions or parquet scope references
- Fixed: Total equity calculation uses historical close prices from parquet files instead of latest prices for each transaction date
- Improved: Investment equity curve now reuses the shared chart tooltip tokens and layout
- Fixed: Equity curve seeds a zero-value point on the prior day when the first transaction starts above or below zero
- Adjusted: Investment chart panel better fills the available card height in Chart view
- Updated: Transaction history description format to TICKER@quantity for buy/sell operations
- Fixed: Cash calculation logic for payment_in_lieu and foreign tax withholding transactions
- Improved: Adjusted transaction table column widths for better readability
- Renamed: "Tax withholding" → "Foreign tax withholding" (value: tax_withholding → foreign_tax_withholding) for consistent naming
- Improved: Toggle button now switches plus/minus icons via reusable CSS classes
- Fixed: Transaction table header uses opaque background (var(--panel-strong)) instead of semi-transparent glass for better text readability
- Adjusted: Finalized transaction table column widths and min-widths per layout requirements
- Fixed: Added backward compatibility - normalize space-separated type names to snake_case for existing imported transactions (e.g., "foreign tax withholding" → foreign_tax_withholding)
- Improved: Show '-' instead of 0.00 in Commission column for transaction types that don't normally have commission (foreign tax withholding, dividend, adjustment, debit interest, payment in lieu, dividend reinvestment, forex trade, deposit, withdrawal, credit interest)
- Fixed: Investment history table now keeps the scrollbar below the rounded header and stays bottom-aligned with the sidebar
- Fixed: Add transaction form now reuses the standard controls and action button styling
- Improved: Add transaction form offset now follows the measured form height instead of hard-coded pixels
- Fixed: Grant transactions now add shares without affecting cash, while history still shows their economic amount
- Fixed: Holdings average price now uses out-of-pocket cost, so grant lots dilute cost per share instead of adding cost basis
- Fixed: Grant descriptions now use the standard TICKER @ PRICE x QTY transaction format
- Updated: Holdings summary row now colors only the cumulative P&L value, keeping the label text neutral
- Reworked: The investment import form now accepts the two IBKR CSV exports instead of manual transaction entry
- Superseded: The earlier in-memory-only raw-CSV feedback was replaced by SHA-256-verified immutable source-evidence persistence. Exact uploaded IBKR CSV and GainsKeeper files are now retained locally, while the ledger stores verified manifests and metadata.
- Improved: Empty transaction history now shows a compact guided import state with inline plus icon and width protection
- Updated: Import feedback now uses the standard modal dialog banner message token instead of the legacy modal dialog block
- Fixed: IBKR deposit rows no longer invent a USD currency when the CSV does not prove one
- Fixed: Forex Trade Component rows now render a precise English description and show the destination currency
- Refined: Deposit rows now describe the amount as a USD-equivalent credit when the source CSV only proves the base value
- Refined: Forex Trade Component rows now use compact trade-style wording and always display the acquired currency
- Fixed: Investment view segmented pill now stays hidden until the active label is measured, preventing the loading-time stretched Charts highlight
- Fixed: Stock-details average-price replay now uses split-adjusted quantities, preserving genuine flat-position gaps in the cost line.
- Changed: Stock-details metrics now retain complete historical broker trade and commission breakdowns.
- Added: Investment tables support a currency filter, and Stock details adds a guided reusable date-range filter.
