# Known issues and operating constraints

Style tokens specimen width tiers, 25 Sep 2026: the Shared select dropdown,
Shared select filter, and Strategy tuning control demos use the existing 384px
control token while their preview column is narrower than the 640px content
tier, then use the 640px content token when that column reaches the wider tier.
Below 384px they fit the column. The preview column itself is a resizable CSS
container, so the tier follows divider drags at a fixed viewport width. Shared
select menus retain their separate 384px maximum; production controls keep
their standard sizing. The resizer's accessible minimum, maximum, and current
values refresh when the column changes width, including viewport resize.

Style tokens number and Process List specimens, 25 Sep 2026: all 12 decimal
values in the Investment Holdings allocation specimen already use the shared
numeric display's major/minor typography and 0.76 fraction scale. The actual
Holdings badge reuses the same parts; its glyph slots preserve width during
updates. Desktop and narrow browser regressions now guard this contract.
The Process List specimen no longer renders Python's dictionary `copy` method
as text. Its four steps now demonstrate an ordered list, an unordered list, a
plain paragraph, and a read-only field assembled from shared controls.

Settings sidebar and allocation handles, 24 Sep 2026: Settings keeps its
heading and toggle fixed while the section navigation scrolls within the
sidebar, with dock clearance for the last link on desktop and narrow layouts.
The Allocation range Style tokens specimen and its Leveraged Rotation controls
now draw all six range thumbs from the shared Frosted Glass resizer-handle
material. Primary and leveraged colors remain on their tracks, labels, and
thumb borders. The older active-theme-canvas limit-thumb treatment described
below is superseded; range hit areas and constraints are unchanged.

Investment share action placement, 24 Sep 2026: `contain: layout` on the
Investment workspace header, added to keep gel transforms out of root scroll
geometry, also makes that header the containing block of the fixed share
action group. Viewport coordinates therefore landed offset by the header's
position: 10px left of the global theme anchor's centerline and 10px below the
view selector, which let the button cross the Holdings card edge. The share
sync now measures the rendered group and removes that offset, so its centerline
matches the theme anchor horizontally and the view selector vertically. At
compact widths it reserves inline-end room in the view selector row only when
the centered selector would otherwise run under the share button.

Process List surface blending, 24 Sep 2026: numbered markers now leave their
centers and surrounding connector gaps transparent. A fixed page-background fill
and matching solid halo had produced visible disks on glass and modal surfaces,
especially in Dark mode. The shared 32px marker and 4px connector clearance
remain unchanged. The user-owned 8688 service was not restarted, so its current
page may continue serving the earlier CSS until the owner relaunches it.

Investment import session readiness, 24 Sep 2026: the import dialog could
accept chosen files and only then reject the import with "Investment changes
require a valid session security token", because a server restart regenerates
the Flask secret and invalidates the token rendered into an already-open page.
Opening the dialog now confirms the browser write session and keeps Import
disabled until it is ready. An unreachable server is reported inside the dialog
immediately. The session is refreshed again before each HSBC paste or workbook
validation and before the import request, so a restart while files are being
chosen no longer wastes the selection. The write boundary is unchanged: the
refresh route answers only same-origin local pages and is never cached.

Strategy-tuning Dark mode surface, 24 Sep 2026: the pressed round action now
uses a transparent fill so the sidebar background shows through. Light mode
keeps its adaptive-white fill; the primary-blue glyph, border, active shadow,
and press transform continue to identify the pressed state.

HSBC same-day settlement replay, 23 Sep 2026: an Overview trough around the
August SGOV sale came from discarding its evidenced SEC posting chain when a
same-day pasted cash row belonged to another source-sequence domain. The
independent USD Savings CSV supplies a chronological balance chain whose
opening balance exactly matches that cash row. Historical replay now accepts
that narrow corroboration, keeps the sale proceeds as a receivable from trade
date, and transfers them to settled cash on the CSV posting date. A mismatched
opening balance, broken posting chain, or additional incomparable cash row
continues to fail closed. The production ledger and the user-owned 8688
process were not rewritten or restarted for this source change.

Overview hover Realized P&L, 22 Sep 2026: historical hover previously rebuilt
realized P&L by point-in-time replay with broker performance calibrations
disabled, so any calibrated or partially covered ticker made the whole row
Unavailable while Holdings showed a value. Realized P&L now follows the
Holdings attribution timeline described in the Architecture Tooltip contract,
is available at every point whenever Holdings is, and equals Holdings at the
latest point. This supersedes the realized half of the 8 Sep 2026 statement
that hover P&L uses only the hovered point's replay. Broker performance
baselines are dated to the scope's last disposal on or before their as-of
date because their per-sale timing is not evidenced; before that disposal the
baseline is not yet counted. Unrealized and Cumulative P&L still use the
point-in-time replay and remain Unavailable on dates with partial basis; a
Holdings-consistent unrealized rollback is not yet implemented.

HSBC historical cash double count, 22 Sep 2026: the Overview equity curve showed
roughly 1.5 times the real portfolio from late June to late August 2026, then
fell back when a fully evidenced HSBC balance row appeared. Market value was
correct; only HSBC USD cash was inflated. Two defects combined:

- Legacy USD Savings CSV rows had no chronological sequence provenance and
  carried a corroborating statement PDF digest in `statement_pdf_source_sha256`.
  The strict direct-cash contract rejected them, so their amounts became
  unscoped deltas while the exact USD Savings scope stayed at zero.
- The history projection computed each settlement correction against that zero
  scoped balance but added it to the full USD balance, counting every unscoped
  delta twice. Days with rejected rows also dropped same-day settlement
  boundaries as sequence-incomparable, delaying buy debits.

Fixes: `history-projection.js` folds the unscoped same-currency delta into the
only same-currency scope when correcting; the merge stores a corroborating PDF
digest as `statement_pdf_corroboration_sha256`; and the production ledger was
repaired by merging the current HSBC USD Savings CSV through the import commit
pipeline after isolated verification. The pre-repair store is preserved as
`settings_store/investment.parquet.before-hsbc-usd-csv-provenance-20260922T1059+0800.bak`.
The repaired curve peaks near the current portfolio value and matches the raw
CSV running balance. Lessons for agents: reconcile a suspicious curve against
the broker's raw running balance first; an import simulation without the
configured HSBC account reports false duplicates; and no HTTP or UI import
mode yet exists for the USD Savings CSV. A residual IBKR CNH/HKD balance
remains after FX conversions whose `forex_trade_component` rows carry only
the FX P&L; its net effect is a few hundred USD and is not yet corrected.
The Python merge change is adopted by the user-owned 8688 process at its next
manual restart.

HSBC pending-marker ownership, 22 Sep 2026: Transaction history renders one
visible trailing `*` on the compact order reference of each genuinely unresolved
HSBC order. The same state is not repeated before Cash, Equity, or the current
cash total; those values retain their evidence explanation in accessible title
and supporting copy. With the current production ledger, the sole marker belongs
to the 21 Sep 2026 sale of 5 EUV shares. The user-owned 8688 process was not
restarted, so manual restart remains the adoption boundary for this source and
asset-chain change.

Shared modal and banner alignment, 21 Sep 2026: centered progress dialogs and
top floating notices now use one two-column, two-row contract. Their title shares
the dismiss control's centerline, while the unchanged topic icon and body copy or
list share the next row's top edge. Numbered copy retains hanging wrapped lines,
and dynamic message containers preserve the same structure. The user-owned 8688
process was deliberately not restarted, so this source change is not live there
until the owner performs the normal manual restart and verifies the served asset
versions.

HSBC post-import audit follow-up, 21 Sep 2026: the source now keeps pasted cash
rows in ledger sequence, prevents a transfer constraint from delaying its
receipt behind unrelated same-day transactions, scopes settlement corrections
to the exact customer account, cash account type, and native currency, and
prevents an older or sequence-incomparable same-day cash row from clearing
newer settlement evidence. Zero balances remain explicit at this boundary, so
another same-currency subaccount or foreign-currency balance is retained.
Settlement evidence is now a closed immutable domain: SHA and row aliases must
agree, one physical `(SHA-256, row)` belongs to one owner and one posting, and
provenance repair commits only after whole-order validation. Invalid calendar
dates, non-integral rows, conflicting direct-cash aliases, and ambiguous
same-day CSV balance order stay provisional and cannot create a synthetic cash
boundary. Direct cash also requires the producer's exact file-kind, account,
currency, authority flag, account scope, nonzero type/sign, balance, SHA, row,
and ledger-sequence matrix. Structured settlement legs require canonical raw
amount and balance fields plus exact decimal identity; scalar-only legacy
summaries cannot change cash or realized proceeds.
Cash-only dividend candidate inputs now accept only
explicitly USD same-account Order Status rows and position-snapshot entries;
eligible quantity remains Order Status-derived. Cash-only evidence periods
describe the earliest-to-latest visible posting range, and identical evidence
can correct the legacy one-day metadata on re-import. The production investment
stores were not rewritten. The user-owned
8688 process was deliberately not restarted during this repair, so neither the
Python changes nor the new `investment-v2.151.8` asset chain should be treated
as adopted there until the owner performs the normal manual restart and checks
the served versions.

HSBC cash-only dividend attribution, 21 Sep 2026: a newly pasted USD
corporate-event payment can now be attributed during the atomic incremental
merge when the existing same-account Order Status ledger and the complete local
dividend-action candidate set produce exactly one match. Existing manual or
statement-backed ticker provenance wins unchanged. Missing local history,
cross-account evidence, and ambiguous matches remain explicitly unresolved.
This is a source change; the user-owned 8688 process keeps its startup-loaded
Python modules until the owner performs the normal manual restart.

HSBC sell-fee replay, 21 Sep 2026: separately posted fees now reduce realized
sell proceeds exactly once when the settlement postings and commission fields
form one closed evidence set. Malformed, conflicting, non-HSBC, and buy-side
postings retain the prior amount instead of triggering an inferred adjustment.
The same user-owned 8688 restart boundary applies to the frontend module graph.

Investment-import physical effects, 21 Sep 2026: the source now gives the
broker-import scrollport explicit adaptive effect clearance and keeps its modal
and field-group effect hosts open, so Broker controls and all import-field cards
are no longer cut at the scroll boundary. The user-owned 8688 process keeps its
startup-cached template and stylesheet chain until the owner performs the normal
manual restart; isolated verification uses 8699.

Complete-gate baseline, 21 Sep 2026: the post-change static checks, complete
Python suite, and all 399 Node tests passed. The complete Chromium run reached
425 passes and retained eight unrelated failures; rerunning exactly those eight
reproduced all eight. Seven are existing layout/style-token cases with 38px or
58px document overflow (Collapse motion, Collapse trailing icons, workspace gel,
Style-token alignment, and Style-token physical effects). The eighth is the
Frontier CPU probability-model case, whose `skill` value is non-finite. These
failures do not intersect the Investment-import selectors or the three-viewport
physical-effect regression and remain outside this repair.

Cold ticker validation, 22 Sep 2026: autocomplete, blur, change, and submit-time
validation now share one in-flight exact-symbol lookup. A newly entered ticker
with no local search cache therefore cannot be marked unsupported by a later
duplicate lookup that returns an empty result after an earlier lookup already
confirmed the symbol. The isolated regression uses SPYI and makes every
hypothetical duplicate response empty so the cold-cache race stays reproducible.
The user-owned 8688 process remains on its currently served asset graph until
the owner performs the normal manual restart.

Return-comparison ticker memory, 20 Sep 2026: a successfully rendered ticker
set is now retained in browser-local storage. Returning through an unparameterized
`/workspaces/compare` entry restores that set, including across browser sessions;
an explicit ticker query remains authoritative and replaces the remembered set.
Only ticker symbols are persisted by this contract. The user-owned 8688 process
keeps serving its cached template and asset keys until the owner performs the
normal manual restart.

Market-session consolidation, 20 Sep 2026: `app/core/market_sessions.py` is
now the one maintained owner of every supported market family's regular
session, and the browser chart, SVG exporter, and date controls consume a
serialized projection of it instead of private rule tables. Four intentional
behavior fixes ride along with that consolidation.

- Buenos Aires (`.BA`) and Istanbul (`.IS`) are now their own market families in
  the browser. The chart and the SVG exporter previously drew them on Mexico
  City and Paris time with those markets' session hours, so one-day cross-market
  windows, session guides, and market-local hover times were wrong for Argentine
  and Turkish tickers. The backend was already correct.
- The Australian (`.AX`) regular session now opens at 10:00 Sydney time
  everywhere. `app/services/comparisons.py` used 09:00, which is the ASX
  pre-open phase; the browser chart and `broker_market_data.py` already used
  10:00. ASX cash-market normal trading is 10:00 to 16:00 Sydney time.
  Intraday gap filling no longer synthesizes 09:00 to 09:59 ASX rows.
- Broker candlestick filtering now keeps the closing-auction bar stamped on the
  session boundary for Euronext, Helsinki, India, Taiwan, Thailand, and Tel
  Aviv. `broker_market_data.py` used a half-open window for those markets and
  dropped that final bar, while `comparisons.py` already kept it.
- The one-day SVG export window now ends at the right edge of the last included
  minute bar for those same six markets, which previously clipped a half minute
  short of it. Every other market's export window is unchanged.

Live-session activity checks for Euronext and Helsinki now end at the 17:30
closing boundary rather than including that minute, matching Taiwan, India,
Thailand, and Tel Aviv. The user-owned 8688 process keeps serving its cached
template and asset keys until the owner performs the normal manual restart.

Ticker-comparison controls overlay, 16 Sep 2026: at the registered 900 px
sidebar-overlay breakpoint and below, the Ticker comparison controls now reuse
Backtest's shared workspace-controls overlay instead of consuming a permanent
312 px results column. The panel defaults closed, keeps an independent remembered
session state, returns focus after Escape, and cannot remain open beside global
navigation. Desktop widths retain the existing two-column layout. The user-owned
8688 process may continue serving its cached template and asset keys until the
owner performs the normal manual restart.

Stock-details interaction performance, 16 Sep 2026: price-chart pointer events
are coalesced to one commit per animation frame, while the geometry- and
theme-dependent trade-marker Glow raster is reused across hover-only redraws.
Unchanged tooltip presentations no longer replace or remeasure their DOM. Theme
switching updates the active Stock-details chart in place and limits motion to
the compositor-friendly theme-toggle icon; the former universal descendant and
pseudo-element transition is removed. Hidden Investment charts are not rebuilt
for a Stock-details theme switch. The user-owned 8688 process still requires an
owner-controlled restart before this source change is adopted live.

Price Field detail responsive protection, 15 Sep 2026: the contained detail
plot now consumes the complete inline width assigned by its panel; available
height no longer creates a narrower centered plot with unused side space. Its
minimum height follows container width and the shared Backtest splitter gives
that history budget priority only while `Price Field` is active. At the exact
732 by 1,318 responsive viewport, the 20-by-24 lattice retains 480 square cells
of at least 12px, 2px gaps, full-width plot ownership, and zero plot, panel, or
document overflow. A desktop endpoint regression proves that moving the
splitter to its limit does not reduce the width-limited cell resolution.

LSTM Web-training and CLI-GA boundary, 15 Sep 2026: Start training sends the
current private controls through `--selected-params`, bypasses crossover and
mutation, and retains the 180-second minimum optimizer-work contract before the
completed configuration can be applied to LSTM Price Field. The standalone CLI
owns the 36,000-second genetic search and now defaults to the same strict 1–20 day
CRPS skill versus causal baseline that Backtest displays. Every validation fold
requires all 20 horizons and complete eligible-pair coverage; the final holdout
is evaluated only after selection is frozen. Completed robust GA runs remain
readable in shared compute history and replay their complete seed-42 member
because an aggregate parameter set without a seed is not executable. Protocol v3
disables the browser action against a cached pre-exact-training Python service;
the user-owned 8688 service requires an owner-controlled restart before the new
launch contract is live. Existing history is not rewritten, no training starts
merely by loading Backtest, and the runner budget remains a scheduling deadline,
not the strict outer wall-clock supervisor described in
`docs/LSTM_PROBABILITY_TUNING.md`.

Strategy-tuning pressed state, 15 Sep 2026: the active round control now uses an
opaque adaptive-white surface with the standard primary-blue SVG glyph and border.
It keeps a restrained blue shadow and press transform so it remains distinct from
the idle frosted control in both themes. This updates the shared token contract;
the sibling product still requires an explicit adaptation before convergence.

Settings navigation and effect-boundary repair, 14 Sep 2026: Settings section
links now have one optimistic-navigation owner. The global hard-navigation path
does not intercept those links, and the Settings replacement path does not run a
document View Transition. The final region replaces the complete skeleton wrapper
and its live status, preventing current content from remaining under `aria-hidden`.
The optimistic skeleton now reproduces the real content-scrollport hierarchy; the
scrollport no longer expands 48px beyond its inline parent, while network service
rows clip their own pending effects. Language save actions use the standard action
row aligned to the form end, and allocation-limit handles use the active theme canvas
instead of adaptive white. The isolated `1,007 × 1,355` dark-mode regression retains
one document, bounds the skeleton, and completes without a full-page exposure flash.

Price Field metric interpretation, 14 Sep 2026: Backtest Metrics now presents
standardized 1–20 day CRPS skill against a causal zero-drift volatility
baseline instead of the ambiguous `100% * (1 - Brier loss)` probability score.
The headline is the equal mean of horizon-specific relative skills for days 1
through 20, with days 1, 5, 10, and 20 visible underneath. The headline is
`N/A` unless all 20 horizons and every causally eligible pair have valid
forecasts. Its companion reports valid-versus-eligible forecast coverage,
realized central-80% interval coverage, and mean price span relative to the
forecast median. Skill uses equal horizon weights; interval evidence uses
valid-pair weights. Hidden pre-range history supplies causal context, but scored
outcomes remain inside the visible range. Origin and horizon outcomes overlap,
and the displayed pair count is not an independent-sample count. The legacy
executable-direction and Brier fields remain compatibility diagnostics; the
LSTM training-history badge retains its separately labelled training score and
is not numerically comparable with the new Backtest skill card.

Price Field rendering audit, 13 Sep 2026: direct-horizon neural models now use
the central 95% Gaussian envelope for their finite detail viewport. The former
99% viewport spent multiple rows on tail mass that an ordinary 2% cell display
threshold could never show, so otherwise square PatchTST, TSMixer, N-HiTS,
TimeXer, iTransformer, TiDE, ModernTCN, and TFT lattices appeared as horizontal
bands. The shared nonlinear color scale remains normalized within each selected
field: its winner is fully opaque, values continuously approach transparency at
the selected display threshold, and below-threshold cells remain hidden. The
display-domain repair does not alter forecasts, signals, probability diagnostics,
or scoring.

Audit remediation, 12 Sep 2026: Settings POST routes now require a local
same-origin request and a session-bound CSRF token. Native forms carry the
token as a hidden field; asynchronous writes use the existing security header
or submitted form data. Settings documents retain only same-origin referrers
so Chromium native submissions preserve Origin proof. This remains a trusted-LAN
application, not a multi-user authenticated administration service.

Settings persistence serializes cooperating threads and processes, atomically
replaces the JSON document with an owner-only temporary file, and refuses to
overwrite malformed existing JSON. Existing production directories and credential
files are not rewritten by an upgrade alone. Browser ticker suggestions escape
external labels and image attributes before markup insertion.

Pytest configures temporary market, settings, and compute directories before
application imports. Remote market downloads and real Longbridge CLI invocation
are disabled by default; transport unit tests explicitly enable their mocked
provider branch. The Playwright launcher binds only to 127.0.0.1:8699 and disables
the real CLI, including account reads and browser OAuth launches. Its market
fixture includes the supported test tickers; disabled remote access also blocks
the direct Yahoo Chart fallback.

Backtest parameter overlay, 10 Sep 2026: at the registered 900 px sidebar-overlay
breakpoint and below, the Backtest controls surface is a default-collapsed fixed
overlay instead of a full-width block above Performance. The result column keeps
the workspace width. The dedicated parameter toggle, backdrop, Escape behavior,
session memory, inert closed state, and global-sidebar mutual exclusion are covered
at the annotated 751 by 912 viewport. The global navigation state hides the parameter
toggle, the global dismissal layer is a transparent zero-radius viewport rectangle,
and workspace destinations use the shared 36 px compact-row token. The collapsed
global toggle uses equal top and left global-anchor distances; desktop retains the
existing two-column layout.

Backtest header clearance, 12 Sep 2026: the 900 px overlay layout keeps
Performance below the Backtest title instead of applying the desktop upward
translation. The title reserves both round controls, whose edges remain 10 px
apart in either parameter-panel state. The existing compact vertical anchors
remain aligned. A 13 Sep 2026 follow-up removed the narrow title card's inherited
60 px safe-top offset: the primary title now shares the vertical centerline of
the sidebar, Backtest-parameter, and theme controls while Performance remains in
compact flow below it. The title-alignment browser regression covers 390, 600,
687, 767, 768, 897, 900, 901, 1,021, and 1,276 px widths.

Bayesian automatic compute, 8 Sep 2026: Bayesian Price Field no longer exposes
a compute-backend selector. Every refresh uses an internal `Auto` policy that
coordinates the bounded local CPU executor with an available Apple MPS or CUDA
device, ignores retired browser or URL overrides, and recomputes the complete
walk-forward pass on CPU after an accelerator failure. LSTM and neural Price
Fields retain their own training backend controls.

Backtest schedule and interval controls, 8 Sep 2026: interval pills retain both
`1d` and `1m` slots after availability resolution; unavailable `1m` remains
visible and disabled through the shared segmented-control state instead of being
removed. Daily chart hover dates omit `00:00`, while one-minute hover dates keep
their time. Registry-driven DCA parameters use generic conditional visibility
and content-sized select metadata: weekly and monthly schedule details are
mutually exclusive, weekday labels run from Monday through Sunday, and weekend
contributions continue to align to the next trading day.

Backtest annotation geometry, 8 Sep 2026: radio-backed segmented labels derive
emphasis only from their checked input; positional skeleton fallbacks do not
override radio or ARIA-tab state. Compute-backend options use a local 32px
minimum with wrapping allowed, without changing the shared 36px menu default.
Training history uses the regular 15px UI label and flush-left empty copy.
Parameter separators paint halfway through the existing 10px row gap; numeric
controls and labels are vertically centered without changing row sizing or
responsive breakpoints. Regression: `tests/e2e/backtest-annotation-geometry.spec.mjs`.

Investment import feedback layer, 8 Sep 2026: validation and clipboard error
banners are portaled to the document root before display. They remain above the
full-screen broker-import modal instead of being trapped inside the earlier
Investment report-card stacking context. While the modal is open, the feedback
banner owns one layer above the global popover token; browser regression also
checks viewport containment and center-point paint ownership.

IBKR CSV interval reconciliation, 9 Sep 2026: partially overlapping Realized
Summary windows no longer add the complete newer period. The importer first
reconciles broker-native stock and Forex detail, adds only realized components
strictly after the prior closed boundary, and adopts the latest unrealized marks.
The USD 2 conversion fee remains included once in the broker-reported Forex P&L.
A newer date-only CSV cash boundary clears an older GainsKeeper timestamp, and
`Total in USD` cash-section rows are treated as summaries; matching legacy false
warnings are removed during the next incremental merge.

Investment P&L audit, 8 Sep 2026: dividend-reinvestment shares now retain their
actual reinvestment cost basis instead of opening zero-cost lots. A reinvestment
without positive quantity-and-value evidence remains explicitly unknown and
produces an import warning. Open positions with unknown or partial carried basis
fail P&L closed, including sales whose realized basis cannot be established. If
one account is incomplete, ticker-level realized, unrealized, and total P&L are
all withheld while complete account evidence remains inspectable. Historical
Overview hover P&L now uses only the hovered point's transaction replay; current
broker performance or position snapshots cannot rewrite earlier chart points.
Missing quotes, previous closes, or FX rates remain unavailable in Holdings;
blank live-badge state cannot be reinterpreted as numeric zero during a session
refresh.

Transfer bindings, 7 Sep 2026: IBKR native-currency replacements migrate uniquely
identified base-currency binding keys using retained replacement evidence.
New imports preserve the replaced date and source identity. Ambiguous mappings
remain unchanged; persisted target ownership survives broker filtering.

Dividend reconciliation, 7 Sep 2026: when an authoritative trading-performance
snapshot precedes later income, dividends, payment in lieu, withholding, and
included cash adjustments after that boundary enter only incremental P&L.
They are not also added to the baseline. Snapshots already including income
retain their reported baseline.

HSBC pending-order history cash, 7 Sep 2026: an unresolved order uses the
authoritative bank cash plus the signed, source-bounded pending amount once.
Earlier settlement replay corrections cannot change this row when the broker
filter changes. The provisional marker remains until settlement is evidenced.

Market factor expansion, 7 Sep 2026: 36 shared Price Field controls now include
13 opt-in historical quantity/price factors. Generic parameter subgroups reuse
the existing Collapse and field primitives. Snapshot-only and undisclosed
research data remain unavailable to causal training. See the factor audit for
formulas, source checks, and eligibility boundaries.

Backtest disclosures and training history, 9 Sep 2026: strategy parameter,
training, and market-factor sections no longer share a native details name, so
all can remain open independently. LSTM training owns Compute backend at its
head and uses 4px inline and zero bottom body padding. Training history entries
use zero padding around a 32px selection control while retaining the 36px compact
row minimum. Factor subgroup summaries append the checked count in plain
parentheses. LSTM backend and factor changes are staged for durable training and
do not recalculate the current backtest; selecting a completed case always
navigates through its saved configuration and recalculates the probability
field, including when the displayed controls already match that case. Expanded
details retain natural height. The selection focus ring aligns with the Training
history heading. A run started on the current page is applied automatically when
it first completes, provided that the strategy and training inputs have not been
edited in the meantime. Failed, stopped, historical, and context-detached runs
remain available for explicit review without causing an unexpected navigation.
Loading a completed training run opens the Price field view directly, including
when transaction details are enabled, so the recomputed probability grid is not
hidden behind the default Metrics or Transactions view.
See [Longbridge factor audit](LONGBRIDGE_FACTOR_AUDIT.md) for current CLI gaps.

Overview tooltip coverage, 7 Sep 2026: historical realized P&L requires complete
reconciliation coverage, but verified unrealized P&L for open positions is evaluated
independently. Missing realized coverage on a closed ticker no longer blanks the
unrealized total. Cumulative P&L remains unavailable unless both components are
known. Pending values show `--`; completed unavailable values show `Unavailable`.
The Investment report card uses zero bottom padding across its tabs and breakpoints;
Backtest and Live trading retain their existing scoped padding.

Settings surface annotations, 7 Sep 2026: language pagination uses the shared
frosted-glass background, border, shadow, blur, and pill radius. Network status
masks stay inside their status boxes, including wrapped text. The SMTP symbol
uses an accent-text mask while preserving the existing image semantics. Strategy
disclosure chevrons sit 12px from the summary top rather than centering against
its full multi-line description. These changes are owned by settings.css v0.27.1.

Stock-details compact layout, 7 Sep 2026: below 768px, the single-column
identity, metrics, price chart, and allocation chart retain their natural heights.
The Stock-details panel owns vertical scrolling. The price chart reuses the equity
stage height token with a 200px floor, so its canvas and date axis remain intact
instead of being compressed beneath the allocation chart. Scroll the upper panel
to inspect its content; the transaction history retains its own scroll position.

Stock-details hover date, 7 Sep 2026: the x-axis date badge shares the Overview
blue date component, typography, date formatter, and chart-axis update helper.
Its two-line date follows the curve intersection rather than a nearby trade marker;
plot exit and chart destruction clear it. Range changes recreate one badge.

Stock-details crosshair, 7 Sep 2026: hover uses the Backtest polyline intersection
at pointer X, clamped to the first/last finite price point. Vertical pointer movement
does not change the guide price. Trade-marker selection retains its linked history
behavior without moving the crosshair away from the price curve. Leaving the plot
clears both guides. All date ranges use the same resolver.

Shared disclosure motion, 7 Sep 2026: `.ui-collapse` expands with the existing
620ms bouncy spring, including a small height overshoot before settling to its
natural size. Native keyboard toggles and named accordion behavior remain intact.
Closing cancels the expansion; reduced-motion preference bypasses it, including
when that preference changes during playback. The Style tokens Collapse specimen
and product disclosures share `motion.js` v1.2.0.

Manual LSTM startup, 7 Sep 2026: the CLI now decodes `--selected-params`
JSON before validating the requested compute backend. Previously every web
launch failed before training because a JSON string reached the dictionary-only
validator. Regression coverage follows the web manager's generated command
through the CLI entrypoint and prepared-request claim. Saved failed runs remain
historical records; start a new run to retry.

Backtest loading feedback, 6 Sep 2026: the chart retains a centered spinner and
`Loading backtest…` while a refresh or saved-case navigation is pending, even
when the modal is dismissed. A saved case receives its green check only after
the current charts report readiness; chart initialization failures never mark
it successful.

Verification boundary, 6 Sep 2026: the centered-detail full gate completed with
1,188 Python tests, 333 JavaScript tests, and 332 Chromium scenarios passing.
The earlier 28/29 Jul guide-alignment failure passed in that complete run.
Subsequent square-grid/symmetric-time changes have their own validation record.

Training failure diagnosis, 6 Sep 2026: QQQ runs `260906(02)` and `260906(03)`
recorded `Auto` but failed immediately because the earlier durable-training path
required a working PyTorch MPS/CUDA GPU. Their saved failure evidence is retained.
The corrected worker preserves `Auto` as NumPy CPU; explicit GPU continues to
require an accelerator. The history list now exposes the error without requiring
expansion. A short isolated execution exercised the corrected Auto CPU path;
it is not evidence of a completed production training run.

Market-factor source review, 6 Sep 2026: [TradingView_TA](https://python-tradingview-ta.readthedocs.io/en/stable/faq.html)
explicitly does not retrieve historical data. Its 1-day and 1-minute analysis
intervals are current snapshots, not historical factor series. The original
[repository](https://github.com/AnalyzerREST/python-tradingview-ta) was archived
on 13 Jun 2024. It is not integrated as a historical fallback. Longbridge CLI
already exposes daily/minute OHLCV and server-side `quant run` indicators.
The Price Field provider still lacks defensible point-in-time historical
availability for ownership and short-selling series, and supported historical
capital-flow/broker-aggregation inputs. Current snapshots cannot fill those
past rows. Price Field models currently form daily features and may execute
those daily signals on real minute bars; this is not minute-frequency model
training. Adding technical indicators from local OHLCV would add derived
features, not the missing external observations or independent accuracy proof.

Documentation version: `v1.264.5`

Price Field display-lattice expansion, 14 Sep 2026: every Price Field strategy
now publishes one reusable 20-column by 24-row display lattice with 12 rows
above and 12 rows below the signal-close anchor. The floating field still
applies its plot-height and chart-boundary caps independently, while the
contained detail surface always requests the complete row contract and derives
its square-grid width from the declared shape instead of a ten-row literal.
This is a presentation-resolution change only: the 20 forecast horizons,
direct-horizon identities, strategy signals, model moments, and standardized
CRPS skill versus baseline remain unchanged. Focused Python and JavaScript
contract tests cover the shared shape, the 480-cell detail lattice, exact-square
geometry, asymmetric inputs, and unchanged scoring boundaries. Isolated
Chromium acceptance at the reported 732 by 1,232 viewport passes through the
dedicated Backtest Price Field regression. The overview minimum-height
conversion also reserves one CSS pixel for split-grid rounding, preventing a
stable Home-position chart from dropping the twelfth complete row by a
subpixel.

Local browser infrastructure audit, 6 Sep 2026: the original disclosure-layout
case requested three years of LSTM data with the default GPU backend. It timed
out, then the isolated server aborted with Metal's
`commit command buffer with uncommitted encoder` assertion. Subsequent connection
failures were consequences of that server exit. Layout-only LSTM cases now use
explicit lightweight CPU parameters; their focused checks pass. This isolates
UI tests but does not fix or establish compatibility of the GPU training path.
The native backend failure remains an independent issue requiring a compute-focused
reproduction. No production backend default or UI tolerance was changed.

Browser gate correction, 6 Sep 2026: Investment history now uses the same 4px
article inline padding as Holdings, keeping Market value columns aligned at
856px, 1,024px, and 1,440px without relaxing the 1px tolerance. The Bayesian
chart-edge lattice regression selects an origin with a valid forecast; warmup
points with null predictions correctly have no probability tooltip. The full
20-by-20 detail lattice and edge-capped hover assertions remain enforced.

AAPL Price Field defaults, 9 Sep 2026: Bayesian, LSTM, and the eight direct
neural strategies use the validation-selected startup profiles from their
8 Sep 2026 AAPL family cohorts. Bayesian uses its deterministic winner. LSTM
uses the robust three-seed grid winner with CPU execution. The neural models
use independent architecture profiles with portable `Auto` execution; the
cohort's final GPU reporting policy was not a searched parameter. The shared
cell display threshold is 1% and remains presentation-only. Exact URL values
and browser-local per-strategy preferences still override source defaults and
are not cleared by this change.

The outer family supervisor exited 1 and did not produce a suite aggregate.
LSTM and neural cohort result and status files are internally complete.
Bayesian wrote a complete result and completed status, but its frozen wrapper
then caught the normal `SystemExit(0)` and overwrote only the status as failed.
The promoted profiles are therefore documented as AAPL-derived cohort winners,
not as a formally completed family suite or evidence of cross-ticker advantage.
The neural holdout profiles improve their respective old defaults but remain
slightly below the causal random-walk reference on Brier skill.

LSTM backend audit correction, 6 Sep 2026: model `v1.1.0` standardizes each
origin's inputs using only its causal training sequences before NumPy/Torch
dispatch. Existing tuned GPU configurations must be reevaluated under this
model version; prior scores do not establish performance after preprocessing
changes. NumPy and Torch still differ in initialization, gradient clipping, and
precision, so shared preprocessing does not guarantee equal predictions.
Disabled volume-at-price skips the rolling kernel and contributes no chip-window
warmup in either Price Field model. Latest factor selection now reflects columns
actually used by the final origin, and is empty when that origin cannot train.
Training timing includes model setup and input transfer; inference timing includes
prediction and result readback. Accelerator work is synchronized at the boundary;
these are host elapsed times, not GPU occupancy or kernel-only measurements.
MLX/ANE training and concurrent origins remain unimplemented. Their absence is
not benchmark evidence that using them would improve this small workload.

External Price Field audit follow-up, 6 Sep 2026: the reported Bayesian
loss-exit behavior follows the configured execution policy. This does not
resolve its effect on strategy evaluation or establish that it reduces risk.
`stop_loss=false` deliberately keeps a
strategy sell or cover intent open when its price would realize a loss; use the
explicit `stop_loss=1` URL parameter when evaluating signal-faithful exits.
The local Price Field fallback rejects the requested bundle if any retained
trading date has nonfinite OHLC. It must not delete that date and bridge the
next-open target across the resulting gap. Invalid OHLC outside the requested
interval does not prevent loading valid observations inside it.
Model fingerprints also record the resolved compute device, engine,
numeric precision, and whole-run fallback state. PyTorch 2.14.0 is declared in
the setup requirements; clean installation of that pin remains unverified.
The inspected Python 3.13 environment used PyTorch 2.7.1 with MPS available.
Bayesian acceleration remains scoped to the
confirmed MPS or CUDA posterior backend; full SoC, Neural Engine, and browser
WebGPU utilization are not claimed or verified.

The previous full browser gate reported 320 passes and three failures:
Holdings/history alignment, DCA internal overflow, and Bayesian edge hover.
The edge-hover failure also reproduced alone. A pre-change reproduction was
not obtained for all three failures, so they cannot all be classified as
pre-existing from that evidence.

LSTM GA v0.9.0 added opt-in `--objective probability` and a SHA-256-pinned
`--snapshot-file` input. It ranks chronological validation Brier scores with
missing-prediction penalties and excludes holdout results from selection.
At that historical version, an omitted objective selected the legacy direction
ranking. The current standalone runner defaults to CRPS; direction, probability,
and grid objectives remain explicit compatibility options. See
[LSTM probability tuning](LSTM_PROBABILITY_TUNING.md) for the offline budget,
selection boundaries, and hard-stop limitation. Native disclosure masks now use
the standard blue accent in both open and closed states.

Backtest annotation follow-up, 5 Sep 2026: algorithmic stop-loss exits and trade
details now default off throughout web configuration and URL state. Explicit
opt-ins remain supported. `Market factors` reuses the shared strategy collapse
for real model inputs; technical-indicator strategies do not expose unsupported
Longbridge inputs. The final targeted browser run passed 34 cases. Full Python
and JavaScript checks passed; the pre-existing Holdings/history Market value
alignment issue still prevents a green full browser gate. See
[Backtest validation](BACKTEST_MARKET_FACTORS_VALIDATION.md).

Settings annotation follow-up, 5 Sep 2026: primary action specimens retain intrinsic
width; ticker input controls use the 15px semantic token and their specimen starts
at the content edge. Selected execution options keep the neutral theme surface and
standard blue border. Switch thumbs reuse the shared spatial duration and bouncy
curve, including the existing reduced-motion override. Tooltips resolve their
material through the canonical frosted-glass background alias.

About now summarizes current research, forecast, import, and optional trading
features. Its reading scrollport no longer extends into the sidebar; other elevated
Settings surfaces retain their effect gutters. The risk notice distinguishes
hypothetical results, model and data limitations, capital loss, live-order failures,
and nonwaivable legal rights. It is a disclosure, not proof of legal compliance or
immunity from claims; public distribution or commercial investment use requires a
fact-specific legal review. Sources: [SEC automated investment tools alert](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/investor-56),
[SEC backtest enforcement example](https://www.sec.gov/newsroom/press-releases/2014-289),
and [15 U.S.C. 80b-15](https://www.law.cornell.edu/uscode/text/15/80b-15).

General follows About in both navigation order and the active-index mapping.
Cash-equivalent additions align right. Color reset is the final danger action
package and retains its browser-local reset handler. Network transport diagnostics
use the shared disclosure primitive outside the standard action package. Strategy
summaries use 6px block and 4px inline padding at existing breakpoints. Local-store
pagination remains outside the table scrollport, with an open effect host; only
table data scrolls. No broker, persistence, or order-authorization contract changed.

IBKR supplemental realized-P&L replay accepts complete file history when a
user-confirmed partial position snapshot omits a ticker. Transaction-source
partial-history flags are not prerequisites; complete scoped replay and the
existing position-boundary checks still determine whether reconciliation is available.

Manual LSTM training now requires at least 180 seconds of optimizer work,
distributed across eligible causal origins. Loading and evaluation add wall time.
Additional optimization does not guarantee improved holdout accuracy. History
rows reserve five ems for ticker symbols and right-align percentage badges.

This document is intentionally privacy-safe. It contains no broker account
identifiers, account-holder names, balances, position quantities, order
references, transaction descriptions, or copied statement content.

## LSTM training

- Completed history records restore saved settings, not frozen neural weights
  or predictions. Older result artifacts contain aggregate scores and input
  snapshots only. Applying them recomputes the interactive forecast and does
  not imply that the displayed probabilities reuse durable training output.
- Price Field backtest.js v0.40.0 supports dragging an overflowing future field
  left while preserving cursor alignment and a stationary price axis. All-hidden
  lattices display their threshold and maximum cell probability; lowering a
  display threshold is a user choice, not an automatic model change.

- The prepared-request launch handshake is fixed in manager/runner v0.6.0.
  An already failed history item remains historical evidence; it is not relabeled
  successful or automatically retried. Restart a cached older service through the
  normal user-owned launcher before starting a new run. An exited worker's actual
  startup error is available in its details rather than only `Unavailable`.
- Durable exact-configuration training currently accepts only `1d`. A `1m`
  selection or missing interval is rejected before launch, not silently replaced
  with daily data. The separate daily-model/one-minute Backtest execution bridge
  does not add intraday training support.
- Missing intervals may be read from the saved request or snapshot; the original
  daily-only runner versions can be identified as 1d without rewriting files.
  Legacy multi-seed aggregates without a saved single seed cannot be applied as
  a complete case. Their measured aggregate scores and files remain inspectable.
- Applying a case freezes its actual data dates, not a rolling period ending
  today. A requested one-year period can contain fewer observations for a recent
  listing; both the requested bounds and actual data window remain visible.
- Protocol version 3 is required for exact-configuration training controls. A cached older
  Python service must be restarted by its owner; refreshing static assets alone
  cannot activate the new configuration/delete endpoints.
- Deletion archives inactive compute output under `.deleted/<run-id>` beside the
  active run directories. It is recoverable, not a permanent purge. Running or
  locked jobs and symlink targets cannot be deleted.
- Longbridge factors without verified historical availability remain unavailable,
  not synthetic features. Selecting a factor does not create missing observations.

## Registry-wide CLI research

- Research adapter/search v1.1.0 fixes three audit findings: discarded loaded
  pre-range warmup, eligibility inferred from predictions outside the scored
  window, and coercion of malformed numeric search bounds. Prior tuning outputs
  remain historical artifacts; they are not rewritten or automatically rerun.
  Use a new output directory to evaluate a configuration under the corrected
  scoring contract. The adapter preserves model evidence across the minute bridge.
- The CLI requires at least 40 distinct real trading dates and complete OHLC.
  It never creates missing market history. Default-source strategies read existing
  local files; Price Field strategies retain their declared Longbridge provider.
  Unsupported execution intervals or missing causal bridges fail explicitly.
- Numeric domains without a declared maximum use a finite exploratory bound
  derived from the default, not a claim that this is an economically optimal
  search region. Nullable automatic price limits require explicit bounds.
  Use `--bounds` for a deliberate research range and `--params` for fixed values;
  display-only thresholds and hardware choices cannot enter parameter rankings.
- The random forest is a parameter-search surrogate, not a stock-price predictor.
  More trials or longer training can overfit validation; the untouched holdout is
  reported separately and is never used to choose a winner. There is no profitability
  guarantee. Buy and hold is a one-evaluation baseline, not a fabricated search.
- The time budget is cooperative between evaluations. An expensive in-flight
  strategy completes before the process exits. The output directory must be new
  and outside market/settings stores; every evaluation and holdout error is retained.
- macOS MPS has actual-device verification. Windows CUDA is supported by the
  existing backend dispatcher but has no physical Windows verification in this change.

## Backtest title-rail alignment

Fixed on 4 Sep 2026 in workspace.css v1.22.4: Backtest no longer disables the
shared desktop result-column lift. At widths of at least 768px, Performance
shares the page-title, sidebar-toggle, and theme-control centerline. Below 768px,
the existing stacked flow remains unchanged. The title-rail fix did not change
shared anchor tokens or chart padding. The regression checks five widths from
390px to 1,276px, including chart visibility, splitter placement, and horizontal
overflow.

On 5 Sep 2026, the next annotated Backtest spacing pass updated trade.css v3.61.1:
the Price Field chart stack uses a 4px bottom inset, and the Overview surface uses
6px inline padding through its local result-surface token. The narrow probability
detail panel keeps its dedicated 10px inline margin and 12px inline padding.

The shared-control sample pass also updated forms.css v0.19.9: date-picker values
use a 30px minimum height; strategy parameter rows use a 35px content baseline
with no inter-row top padding, producing 36px bordered rows; and LSTM history
selection buttons use the shared pill radius. These are shared rules rather than
field-specific overrides, so date fields, numeric/select parameters, factor
switches, and history entries keep the same compact geometry.

Validation: the 28 focused layout contracts, the shared-control geometry
regression, and both default-strategy and five-width LSTM title browser
regressions pass. The complete gate passes its
Python and JavaScript stages, then reports 293 Chromium passes and seven failures.
The failures are unrelated share-heading clearance, a market-cap ticker blur
navigation timeout, stale Investment entry-module version, desktop gel-motion
scale, Bayesian axis geometry, the older 6px Backtest result-card expectation,
and the legacy zero-opacity expectation. These failures were not repaired or
independently baseline-reproduced in this spacing-only change.

The subsequent full-gate attempt for this shared-control pass reached 1,155
passed, 6 skipped, 180 subtests, and 73.63% coverage before stopping on the
pre-existing `investment.css` E2E resource-version mismatch: the stylesheet
reports v1.78.8 while a concurrent `critical-flows.spec.mjs` assertion still
uses 1.78.7. The focused JavaScript suite separately passed all 319 tests.

## Browser-gate follow-up

Current verification: the 5 Sep 2026 complete gate passed 304 Chromium cases and
failed four. Three were corrected and passed focused replay. The remaining
Holdings/history Market value alignment differs by 4.25px at an 856px viewport,
exceeding the 1px contract. No tolerance was relaxed; this layout finding remains
open. The full gate was not repeated after the test-only follow-ups.

On 5 Sep 2026, a fresh audit reproduced all five previously listed failures.
The Investment diagnostic map now matches its entry source version, with a
repository regression preventing drift. The detail axis uses measured Canvas
geometry. A visible Backtest share drawer reserves its own heading rail; hidden
drawers retain compact spacing. The spacing assertion follows the existing 2px
contract. Zero-threshold tests retain positive-probability cells and the nonlinear
opacity checks. Automatic-pan coverage uses an interior origin because the final
curve endpoint has no remaining curve content to pan. The existing endpoint and
future-drag tests cover that separate boundary. Returning from Equity to Price
also cancels the queued Equity leave callback before it can erase the new pointer.
See the latest Testing record
for current outcomes; the dated failures below remain historical evidence.


The latest 4 Sep 2026 complete gate passes Python/JavaScript and 294 Chromium
cases but fails six browser cases. Five repeat the recorded Backtest share-heading
clearance, Bayesian axis geometry, 6px versus 2px padding, zero-opacity, and
Investment entry-version map mismatches. The sixth exposed a missing hover
precondition in the narrow desktop history-delete test. That test now reveals the
action before clicking and asserts its opacity and pointer-events; all 11 LSTM
and shared-control browser cases passed on 5 Sep 2026. The five other failures
remain unresolved. The complete gate was not rerun after this test-only correction.
See `TESTING.md` for exact commands and evidence; no clean-baseline attribution
is claimed and concurrent layout work remains preserved.

## Investment imports

- IBKR cash boundaries with explicit intraday times are compared
  chronologically. Reapplying an older same-day web capture cannot overwrite
  newer file cash, and obsolete currency components are removed with the old
  boundary. A newer date-only file boundary also removes an older precise
  timestamp. A canonical verified interval-union CSV performance snapshot
  refreshes the compatibility broker summary, including its independent as-of
  date, without double-counting a shared report boundary.

- Import-complete `Transfer review` feedback is scoped to source rows that
  became actionable during that import. Pre-existing `Unbound` rows remain
  available in Transaction history but are not repeated as work created by an
  unrelated later import; the comparison uses the completed post-commit
  transaction render rather than a pre-import frontend count.

- Schwab transaction exports classify `Non-Qualified Div` as dividend income
  and `NRA Tax Adj` or related withholding-tax actions as
  `foreign_tax_withholding`; date-only exports retain day-level timestamp
  provenance, while an explicit intraday datetime column is preserved when
  present. Incremental re-imports also canonicalize legacy persisted
  `nra_tax_adj` records before duplicate matching and retain the old type as
  source provenance. When Schwab supplies only a date, same-day buy and sell
  chronology follows the inferred source row direction; an explicit user
  confirmation takes precedence in both persisted replay and browser replay.
  A linked dividend or withholding row displays its canonical ticker before
  the preserved broker description.
- An unbound Schwab `Security Transfer` receipt offers only imported source
  `transfer_out` legs from another broker with the same date, ticker, and
  exact quantity; selecting one saves the same manual pair binding as the
  source row. Accounts with unrelated activity, buys, or positions are never
  offered. Until the source broker's transfer-out is imported, the receipt
  shows an explicit awaiting note and stays excluded from aggregate holdings.
  A previously saved aggregate-only attribution remains visible and can be
  cleared.
- IBKR Transactions CSV cash rows have no currency column. Both deposits and
  withdrawals from that file are treated as base-currency (USD) cash for
  internal-transfer matching, so a bank deposit can bind the matching IBKR
  disbursement through the normal binding selector.
- IBKR GainsKeeper imports retain `BUYOTHER` and `SELLOTHER` money-market
  transactions with their immutable FITIDs, exact source timestamps, and
  cash values; legacy stored GainsKeeper timestamps are normalized to the
  source's America/New_York wall-clock convention during incremental merge.
- IBKR web paste is supplemental evidence. Matching CSV or GainsKeeper rows
  remain the higher-precision source when they are available.
- A compact Orders aggregate only supersedes full-page split fills when the
  declared fill count and all signed economic fields reconcile exactly;
  otherwise every independently captured filled row remains in the ledger.
- Immutable GainsKeeper split fills supersede a matching provisional compact
  web aggregate when their unique FITIDs, split count, identity fields, signed
  quantity, and gross trade value reconcile exactly. GainsKeeper commission
  and net-cash values remain authoritative when they differ from the web
  aggregate.
- The optional cash and position boundary comes from a paired IBKR Your
  Holdings page paste. Its account must match Trade Notifications; its raw
  text is retained as immutable evidence, it is dated to the captured fill
  boundary, and it never creates synthetic trades.
- When a Trade Notifications page mixes current-day time-only rows with dated
  history, select the displayed Hong Kong page date. It fills only the omitted
  current-day dates; dated rows remain independent broker evidence.
- Your Holdings parsing requires one account, recognizable Instrument/Position
  rows, and a base-currency Cash Holdings row. Invalid, duplicate, or
  cross-account evidence fails closed.
- Broker account validation is opt-in through local environment configuration;
  no personal account number is stored in source code.
- Local source artifacts may contain sensitive financial evidence. Keep the
  local settings store and exported statements outside Git and unencrypted or
  shared backups. Preserve a binary-safe encrypted local backup when recovery
  is required; do not discard the only evidence sidecar for a ledger that may
  receive later imports.

## Accounting behavior

- Investment FX conversion returns an internal nonfinite sentinel when a nonzero
  foreign amount has no valid rate. Cash arithmetic preserves that unknown;
  Holdings market values and equity expose unavailable values instead of currency
  parity. Zero amounts and base-currency amounts do not require an FX rate.
- Aggregate P&L tracks complete, partial, and unavailable ticker coverage. Partial
  coverage displays `Partial · total unavailable`, and complete totals are withheld
  across Holdings and Metrics. Missing standalone cash-flow FX also withholds the
  total. Valid ticker rows remain individually inspectable.


- Unknown cost basis, incomplete history, and conflicting broker snapshots are
  represented explicitly instead of being replaced with guessed values.
- Mixed-broker snapshots remain scoped by broker and account. Aggregation is
  disabled when the evidence boundary is ambiguous.
- A broker performance snapshot and a position snapshot have independent
  as-of boundaries. Later trades supplement realized P&L from the performance
  boundary while the position snapshot validates inventory; the newer position
  date cannot hide those trades.
- Security-transfer links require explicit evidence and do not invent a
  carried cost basis.
- HSBC settled-order balances use the final chronological principal or fee
  posting. When copy/paste order conflicts with the official USD Savings CSV,
  the CSV's continuous balance sequence is authoritative.
- Current broker cash snapshots are presentation endpoints. HSBC historical
  settlement corrections use the pre-projection broker ledger, so a later
  mixed-broker current cash refresh cannot cancel earlier settled proceeds.
- IBKR statement `Interest Accruals` are a separate NAV component, not cash or
  market value. A reported accrual applies only on its statement as-of date:
  to the broker's last replay row that day, to aggregate rows from that row to
  the end of the day, to that day's daily equity point, and to Holdings Total
  equity only when the current valuation date is that as-of date. It is never
  carried forward or interpolated, so dates between statements and the
  high-precision intraday Overview curve exclude it. A statement with no
  accrual evidence, conflicting NAV and Ending Accrual Balance values, or no
  as-of date leaves the accrual unknown rather than zero. Statements imported
  before this parser existed carry no accrual snapshot until they are
  re-imported, and the CSV pair import still requires identical Transaction
  History and Realized Summary periods.
- IBKR NAV can also report a separate `Dividend Accruals` component. It is not
  yet modeled as an equity component.

## Local store housekeeping

- A machine-local `market_store/` can contain Finder-style collision names such
  as `*_1m-2.parquet` or `*_1m-3.parquet`. Canonical path resolvers do not read
  those names, but that alone does not prove that their bytes are disposable.
  Treat every non-bundled market file as protected local data: verify lineage,
  compare it with the canonical cache, and obtain explicit user authorization
  before removing it. Zero-byte companion locks follow the same ownership
  boundary while a writer may be active.

## LSTM Price Field compute backends

- Interactive LSTM `Auto` uses NumPy CPU because origin-local tiny LSTM training is faster
  on unified-memory CPU than GPU kernel launch. An explicit `GPU` request uses
  Apple MPS or CUDA only after a real tensor readback.
- Durable training uses a minimum 180-second optimizer-work budget while preserving
  the selected compute-backend semantics. `Auto` remains NumPy CPU, matching
  interactive LSTM behavior; an explicit `GPU` request requires confirmed MPS/CUDA,
  and accelerator failures are visible failures rather than silent CPU successes.
  Explicit CPU remains available. The configured epoch count is a floor during
  durable training. MPS was exercised on this Mac; Windows CUDA selection and
  portable process/lock paths have no live Windows hardware proof.
- Neural Engine is never claimed from a static import or an unconfirmed Core ML
  compile. `Auto` does not select it. An explicit `Neural Engine` request falls
  back to CPU when compute-unit execution is not confirmed.
- Walk-forward LSTM origins run serially to bound unified-memory occupancy.
  Intermediate sequences are released after each origin.
- MLX and coremltools are not required packages. They are probed when present
  and otherwise recorded as unavailable.

## Backtest interval constraints

- Bayesian Price Field signals target the executable next-session-open to
  following-session-open return. The absolute-price grid remains visually
  anchored to the signal close because the unknown entry Open does not exist at
  forecast time; this display anchor is not treated as a fill price or model
  target. The Price Field detail panel labels this distinction explicitly. A
  missing execution Open fails closed.
- The 20 browser columns retain their accepted square-cell geometry and may
  cover more than 20 trading days under integer-day quantization. Their
  probability masses use the fitted causal AR(1) return-state transition at the
  selected origin; they are not 20 separately fitted future factor paths.
- Provider factor `status` is separate from latest-origin `eligible` and
  `selected` metadata. An available factor can therefore be intentionally
  excluded by causal incremental evidence, and the UI must not interpret
  availability alone as posterior inclusion.
- Bayesian Price Field remains a daily posterior model. Its `1m` option uses
  real local one-minute bars only for execution prices and the equity axis;
  the daily probability field is intentionally unavailable in that mode. Daily
  signals and intraday bars map through the ticker exchange's local trading
  dates, so Asian sessions are not shifted by UTC or New York midnight.
- One-minute Backtest history follows the local store retention window. A
  longer selected Period is automatically reduced to the final available
  one-minute option, normally `max`, rather than fabricating older minute bars.
- Multi-ticker strategies expose `1m` only when every required ticker has real
  one-minute history and the complete required set shares at least one Period;
  the browser intersects Period choices across that ordered set.
- Bayesian one-minute execution refreshes only its required one-minute cache.
  If refresh fails, Backtest reports the failure before read-only reuse of an
  existing cache; without an existing cache, the request fails closed.

## Security

- Browser Live Trading requires the configured PIN and establishes a signed
  browser session. Non-browser clients require the configured strong access
  token. A request is authorized by one of those boundaries, not by both at
  once; the repository contains neither a default PIN nor a default token.
- IBKR remains file-import-only. No broker session, credential, market-data,
  or order-routing transport is implemented.

GPU worker runtime diagnosis, 6 Sep 2026: a later explicit-GPU training failure
came from the web service's Python 3.14 environment without Torch. The installed
Python 3.13 framework environment confirmed MPS and completed isolated optimizer
work. The training CLI now discovers and verifies a compatible installed GPU
interpreter before replacing its worker process. This does not convert saved
failed runs into successes or establish completion of a new production run.
