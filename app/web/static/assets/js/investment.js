/**
 * Investment transaction tracker frontend.
 *
 * Code version: v1.36.0
 * - Refactored: Split chart-orbit helpers and transaction-valuation helpers into dedicated ES modules, keeping this entry file focused on page orchestration and reducing single-file context size
 * - Fixed: Stock details trade markers now infer cumulative stock-split factors from the rendered price series before mapping transaction fill prices onto the canvas, so older split-affected trades align with the chart without distorting normal unsplit fills
 * - Fixed: Stock details price-chart trade markers now wait for a stable visible chart box before first paint and resync again after the view-height animation settles, so hyperlink entry matches refresh rendering
 * - Fixed: Stock details tooltip now treats missing post-trade holdings keys as a flat position, so fully exited tickers no longer retain stale share counts on later hover dates
 * - Changed: Stock details share URLs now use the shorter `#stock_panel` hash while still recognizing the legacy long-form hash
 * - Fixed: Hover-linked history and stock-details tables now only auto-scroll their counterpart table, so the hovered table stays user-driven while the mirrored row remains visible
 * - Fixed: Holdings header table now compensates for the body scrollbar gutter, so numeric columns stay horizontally aligned with body cells even when the scroll state changes
 * - Fixed: Stock details price chart now keeps the same y-axis input domain across first paint and post-layout resync, so buy and sell triangles no longer jump vertically when opening a ticker view
 * - Added: Investment page now remembers the last visited view, stock-details ticker, and stock-details range in browser local storage, restoring bare `/more/investment` visits back to the prior selection
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
    getPortfolioDonutOrbitMetrics,
    registerInvestmentChartHelpers,
    renderInvestmentDonutOrbitLogoPosition,
    syncInvestmentDonutOrbitLogos,
} from './investment/chart-orbit.js';
import { createInvestmentDataUtils } from './investment/data-utils.js';

registerInvestmentChartHelpers(window);

document.addEventListener('DOMContentLoaded', () => {
    const theme = window.ANTIGRAVITY_APP?.theme || {};
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
    const investmentForm = document.getElementById('investment_form');
    const importFeedback = document.getElementById('investment_import_feedback');
    const importFeedbackMessage = document.getElementById('investment_import_feedback_message');
    const importFeedbackIcon = document.getElementById('investment_import_feedback_icon');
    const transactionsCsvInput = document.getElementById('transactions_csv');
    const positionsCsvInput = document.getElementById('positions_csv');
    const transactionsCsvStatus = document.getElementById('transactions_csv_status');
    const positionsCsvStatus = document.getElementById('positions_csv_status');
    const importSubmitButton = document.getElementById('investment_import_submit_button');
    const segmentedControl = document.getElementById('investment_view_segmented');
    const investmentViewSurface = document.getElementById('investment_view_surface');
    const investmentViewSurfaceBody = document.getElementById('investment_view_surface_body');
    const investmentDummyChart = document.getElementById('investment_dummy_chart');
    const investmentDummyLogoLayer = document.getElementById('investment_dummy_logo_layer');
    const investmentDummyDonut = document.getElementById('investment_dummy_donut');
    const INVESTMENT_STOCK_DETAILS_PANEL_ID = 'stock_panel';
    const INVESTMENT_STOCK_DETAILS_HASH = '#stock_panel';
    const LEGACY_INVESTMENT_STOCK_DETAILS_HASH = '#investment_stock_details_panel';
    const investmentStockDetailsPanel = document.getElementById(INVESTMENT_STOCK_DETAILS_PANEL_ID);
    const investmentStockDetailsTableHost = document.getElementById('investment_stock_details_table_host');
    const exportTransactionsButton = document.getElementById('export_transactions_button');
    const investmentPanels = document.querySelectorAll('[data-investment-view-panel]');
    const INVESTMENT_VIEW_ORDER = ['chart', 'holdings', 'stock_details', 'metrics'];
    const INVESTMENT_PAGE_MEMORY_STORAGE_KEY = 'antigravity:investment:page-memory:v1';
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
        },
        {
            key: 'net-usd-converted',
            label: 'Net USD converted',
            summary: 'USD received from FX conversion after subtracting conversion commissions.',
            valueKey: 'netUsdConverted',
            rowsKey: 'netUsdConvertedRows',
        },
        {
            key: 'fx-funding-loss',
            label: 'FX funding loss',
            summary: 'Real conversion cost only: FX commission plus the deposit-to-USD shortfall tied to matched conversion funding.',
            valueKey: 'fxFundingLoss',
            rowsKey: 'fxFundingLossRows',
            formatValue: (metrics) => formatMetricLossAmount(metrics?.fxFundingLoss),
            valueClass: (metrics) => getNegativeMetricClass(metrics?.fxFundingLoss),
        },
        {
            key: 'final-investable-usd',
            label: 'Final investable USD',
            summary: 'Direct USD deposits plus net USD obtained from FX conversion.',
            valueKey: 'finalInvestableUsd',
            rowsKey: 'finalInvestableUsdRows',
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
    const HOLDINGS_SUMMARY_METRIC_DEFINITIONS = [
        {
            key: 'cumulative-pnl',
            label: 'Cumulative P&L',
            summary: 'Combined realized and unrealized profit and loss across all tracked holdings.',
            valueKey: 'cumulativePnl',
            rowsKey: 'cumulativePnlRows',
            formatValue: (metrics) => formatSignedHoldingsMoney(metrics?.cumulativePnl),
            valueClass: (metrics) => getSignedMetricClass(metrics?.cumulativePnl),
        },
        {
            key: 'realized-pnl',
            label: 'Realized P&L',
            summary: 'Total realized profit and loss across all tracked holdings activity.',
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
        },
    ];
    let activeInvestmentView = 'chart';
    let investmentSurfaceCleanupTimer = null;
    let investmentFormHideTimer = null;
    let investmentImportInFlight = false;
    let investmentSegmentedMeasureRaf = 0;
    let activeInvestmentHistoryRowIds = [];
    let activeInvestmentStockDetailRowIds = [];
    const INVESTMENT_MANUAL_SCROLL_SUPPRESS_MS = 1400;
    const INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS = 900;
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
    let investmentEquityChartInstance = null;
    let investmentStockDetailsPriceChartInstance = null;
    let activeHoldingsHoverTicker = '';
    let activeHoldingsHoverLedgerNo = 0;
    let investmentChartPointsCache = [];
    let investmentSharedChartDateRange = [];
    let investmentChartPointIndexByLedgerNo = new Map();
    let investmentLatestChartPoint = null;
    let activeChartTooltipPointIndex = -1;
    let activeStockDetailsHoverPointRecord = null;
    let investmentDummyTickerProfiles = {};
    let selectedInvestmentStockTicker = '';
    let investmentProcessedTransactionsCache = [];
    let investmentTickerSummariesCache = [];
    let animatedHoldingsMarkerPoint = null;
    let animatedHoldingsMarkerTarget = null;
    let animatedHoldingsMarkerFrame = 0;
    let animatedHoldingsMarkerStartTime = 0;
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
    let investmentStockDetailsPriceChartRequestSerial = 0;
    const investmentStockDetailsIntradayCache = new Map();
    const investmentStockDetailsIntradayInflight = new Map();

    const STOCK_DETAILS_DONUT_GRAY_FILL = 'color-mix(in srgb, var(--theme-muted) 34%, transparent)';
    const STOCK_DETAILS_MARKER_VIEW_BOX = { width: 20.3027, height: 20.5176 };
    const INVESTMENT_SURFACE_LAYOUT_SETTLE_MS = 520;
    const INVESTMENT_COMMON_SPLIT_FACTORS = [
        1, 1.5, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256,
    ];
    const INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS = [
        { value: '3d', label: '3D' },
        { value: '1w', label: '1W' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: 'max', label: 'Max' },
    ];
    const INVESTMENT_EQUITY_RANGE_OPTIONS = [
        { value: '1w', label: '1W' },
        { value: '1m', label: '1M' },
        { value: '3m', label: '3M' },
        { value: 'ytd', label: 'YTD' },
        { value: 'max', label: 'Max' },
    ];

    const {
        adjustTradePriceForRenderedSeries,
        buildDailyEquityChartPoints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
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
        getInvestmentEquityRangeLabels,
        getInvestmentStartingCash,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        getMoneyMarketTickerSet,
        getNormalizedTransactionType,
        getTransactionAmount,
        getTransactionCommission,
        getTransactionEconomicAmount,
        getTransactionEffectiveUnitPrice,
        getTransactionPrice,
        getTransactionQuantity,
        isFlatPosition,
        isForexPairTicker,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        shouldTrackHoldingTicker,
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
            page_path: '/more/investment',
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

    function measureInvestmentSegmentedPillGeometry(control, activeLabel, {
        labelSelector = '',
        horizontalInset = null,
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
        const maxContentWidth = options.reduce((currentMax, option) => {
            const optionLabel = option.querySelector('input + span');
            if (!(optionLabel instanceof HTMLElement)) return currentMax;
            const measureTarget = labelSelector
                ? (optionLabel.querySelector(labelSelector) || optionLabel)
                : optionLabel;
            const measuredWidth = measureSegmentedInlineContentWidth(
                measureTarget instanceof HTMLElement ? measureTarget : optionLabel,
                renderSafetyPx,
            );
            return Math.max(currentMax, measuredWidth);
        }, 0);
        const optionWidth = Math.max(1, Math.ceil(maxContentWidth + (resolvedHorizontalInset * 2)));
        const optionCount = options.length;
        const activeIndex = Math.max(0, options.indexOf(activeOption));
        const totalControlWidth = controlPaddingInline
            + (optionWidth * optionCount)
            + (columnGap * Math.max(0, optionCount - 1));
        control.style.setProperty('--segmented-option-width', `${optionWidth}px`);
        control.style.setProperty('--segmented-option-count', String(optionCount));
        control.style.gridTemplateColumns = `repeat(${optionCount}, ${optionWidth}px)`;
        control.style.width = `${totalControlWidth}px`;
        return {
            left: activeIndex * (optionWidth + columnGap),
            width: optionWidth,
        };
    }

    function updateInvestmentSegmentedPill() {
        if (!segmentedControl) return;
        const activeLabel = segmentedControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            segmentedControl.classList.remove('is-pill-ready');
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(segmentedControl, activeLabel);
        if (!pillGeometry) {
            segmentedControl.classList.remove('is-pill-ready');
            return;
        }

        segmentedControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        segmentedControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        segmentedControl.classList.add('is-pill-ready');
    }

    function scheduleInvestmentSegmentedPillUpdate() {
        if (!segmentedControl) return;
        segmentedControl.classList.remove('is-pill-ready');
        clearInvestmentSegmentedMeasureRaf();
        investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
            investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
                investmentSegmentedMeasureRaf = 0;
                updateInvestmentSegmentedPill();
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
        return normalizedRange === '3d' || normalizedRange === '1w';
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

    function getInvestmentEquityRangeLabel(range = selectedInvestmentEquityRange) {
        const normalizedRange = normalizeInvestmentEquityRange(range);
        const matchedOption = INVESTMENT_EQUITY_RANGE_OPTIONS.find((option) => option.value === normalizedRange);
        return matchedOption?.label || 'Max';
    }

    function syncInvestmentHistoryHeading(range = selectedInvestmentEquityRange) {
        const heading = getInvestmentHistoryHeadingElement();
        if (!heading) return;
        heading.textContent = `Transaction history · ${getInvestmentEquityRangeLabel(range)}`;
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
            scheduleInvestmentEquityRangePillUpdate();
            syncInvestmentHistoryHeading(nextRange);
            renderInvestmentHistoryTableRows(investmentProcessedTransactionsCache, chartPoints);
            renderEquityChartWithEquity(chartPoints);
        }, { signal });
        window.addEventListener('resize', scheduleInvestmentEquityRangePillUpdate, { signal });
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                scheduleInvestmentEquityRangePillUpdate();
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
        investmentStockDetailsTableHost.hidden = activeInvestmentView !== 'stock_details' || !hasContent;
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
        cleanupInvestmentSurfaceHeight();

        if (document.fonts?.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => {
                scheduleInvestmentSegmentedPillUpdate();
            }).catch(() => {});
        }

        window.addEventListener('resize', scheduleInvestmentSegmentedPillUpdate);

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

    function buildMarketStoreLogoUrl(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        return `/market-store/logos/${encodeURIComponent(normalizedTicker || 'stock')}.png`;
    }

    function resolveInvestmentLogoUrl(profile, ticker) {
        const logoUrl = String(profile?.logo_url || '').trim();
        return logoUrl || buildMarketStoreLogoUrl(ticker);
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
        const holdingsMarketValues = pointRecord?.holdings_market_values || {};
        const openComponents = Object.entries(holdingsMarketValues)
            .map(([ticker, value]) => ({ ticker: normalizeInvestmentTicker(ticker), marketValue: Number(value) || 0 }))
            .filter((entry) => entry.ticker && entry.marketValue > 1e-9)
            .sort((left, right) => right.marketValue - left.marketValue);
        const openTotalValue = openComponents.reduce((sum, entry) => sum + entry.marketValue, 0);
        const cashValue = Math.max(0, Number(pointRecord?.running_cash) || 0);
        const fallbackTotal = openTotalValue + cashValue;
        const denominator = Math.max(Number(pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            syncAnimatedDonutLogos(investmentDummyLogoLayer, []);
            applyAnimatedDonutFill(investmentDummyDonut, 'conic-gradient(var(--theme-accent-positive) 0deg 360deg)');
            refreshInvestmentDummyDonut();
            return;
        }

        const palette = buildInvestmentDummyPalette(openComponents.length);
        const logoItems = [];
        const fillFragments = [];
        const gapDegrees = 1.2;
        let angle = 0;

        openComponents.forEach((entry, index) => {
            const marketValue = entry.marketValue;
            if (marketValue <= 1e-9) return;
            const sweep = (marketValue / denominator) * 360;
            if (sweep <= 1e-9) return;
            const segmentStart = angle;
            const segmentEnd = Math.min(segmentStart + sweep, 360);
            if ((segmentEnd - segmentStart) > 1e-9) {
                fillFragments.push(`${palette[index] || resolvedTheme.accentPrimary} ${segmentStart}deg ${segmentEnd}deg`);
                const midAngle = segmentStart + ((segmentEnd - segmentStart) / 2);
                const ticker = entry.ticker;
                const profile = tickerProfiles?.[ticker] || {};
                const logoUrl = resolveInvestmentLogoUrl(profile, ticker);
                logoItems.push({ ticker, logoUrl, midAngle });
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
        const holdingsMarketValues = pointRecord?.holdings_market_values || {};
        const currentTicker = normalizeInvestmentTicker(activeTicker || tickerSummary?.ticker);
        const currentTickerValue = Math.max(0, Number(holdingsMarketValues?.[currentTicker]) || 0);
        const cashValue = Math.max(0, Number(pointRecord?.running_cash) || 0);
        const holdingsTotal = Object.values(holdingsMarketValues)
            .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        const fallbackTotal = holdingsTotal + cashValue;
        const denominator = Math.max(Number(pointRecord?.total_equity) || 0, fallbackTotal, 0);
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
        const profile = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles?.[activeTicker] || {};
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
                ? investmentDonutOrbitLayerState.get(orbitLogoLayer)
                : null;
            if (orbitLayerState) {
                orbitLayerState.orbitMetrics = orbitMetrics;
            }
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                if (logoElement.classList.contains('is-orbit-animated')) {
                    const layerState = investmentDonutOrbitLayerState.get(logoElement.parentElement);
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

    function setImportFeedback(message, variant = 'success') {
        if (!importFeedback) return;
        const resolvedVariant = ['error', 'warning', 'success'].includes(variant) ? variant : 'success';
        const isError = resolvedVariant === 'error';
        const isWarning = resolvedVariant === 'warning';
        importFeedback.hidden = true;
        importFeedback.style.animation = 'none';
        void importFeedback.offsetWidth;
        importFeedback.style.animation = '';
        importFeedback.removeAttribute('hidden');
        if (importFeedbackMessage) {
            importFeedbackMessage.textContent = String(message || '').trim()
                || (isError ? 'Import failed.' : (isWarning ? 'Investment data loaded with warnings.' : 'Import complete.'));
        } else {
            importFeedback.textContent = message;
        }
        if (importFeedbackIcon) {
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-error', isError || isWarning);
            importFeedbackIcon.classList.toggle('investment-import-feedback-banner-icon-success', !isError && !isWarning);
            importFeedbackIcon.classList.toggle('icon-modal-dialog-banner-default', isError || isWarning);
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

    function setImportStatusIcon(icon, visible) {
        if (!icon) return;
        icon.classList.toggle('is-visible', Boolean(visible));
    }

    function setInvestmentExportButtonVisibility(isVisible) {
        investmentHasExportableTransactions = Boolean(isVisible);
        if (!exportTransactionsButton) return;
        exportTransactionsButton.hidden = !(investmentHasExportableTransactions && investmentChartReady);
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

    function downloadMarkdownFile(filename, content) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
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

    function buildInvestmentMarkdownExport() {
        const holdingsHeaderTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[aria-hidden="true"]');
        const holdingsBodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const historyHeaderTable = document.querySelector('#history_table_wrap table[aria-hidden="true"]');
        const historyBodyTable = document.querySelector('#history_table_wrap .investment-history-table-scroll table');
        if (!holdingsHeaderTable || !holdingsBodyTable || !metricsPanel || !historyHeaderTable || !historyBodyTable) {
            return null;
        }

        const holdingsHeaderRows = Array.from(holdingsHeaderTable.querySelectorAll('thead tr'));
        const holdingsBodyRows = Array.from(holdingsBodyTable.querySelectorAll('tbody tr'));
        const holdingsTable = document.createElement('table');
        if (holdingsHeaderRows.length) {
            const thead = document.createElement('thead');
            holdingsHeaderRows.forEach((row) => thead.appendChild(row.cloneNode(true)));
            holdingsTable.appendChild(thead);
        }
        const holdingsTbody = document.createElement('tbody');
        holdingsBodyRows.forEach((row) => holdingsTbody.appendChild(row.cloneNode(true)));
        holdingsTable.appendChild(holdingsTbody);

        const historyHeaderRows = Array.from(historyHeaderTable.querySelectorAll('thead tr'));
        const historyBodyRows = Array.from(historyBodyTable.querySelectorAll('tbody tr'));
        const historyTable = document.createElement('table');
        if (historyHeaderRows.length) {
            const thead = document.createElement('thead');
            historyHeaderRows.forEach((row) => thead.appendChild(row.cloneNode(true)));
            historyTable.appendChild(thead);
        }
        const historyTbody = document.createElement('tbody');
        historyBodyRows.forEach((row) => historyTbody.appendChild(row.cloneNode(true)));
        historyTable.appendChild(historyTbody);

        const holdingsMarkdown = extractMarkdownTable(holdingsTable);
        const historyMarkdown = extractMarkdownTable(historyTable);
        if (!holdingsMarkdown || !historyMarkdown) {
            return null;
        }

        const transactions = window.ANTIGRAVITY_INVESTMENT_DATA?.transactions || [];
        const latestEquityDate = String(investmentLatestChartPoint?.date || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        const dateRange = buildExportDateRange(transactions, latestEquityDate);
        const title = guessInvestmentExportDescription(transactions, holdingsMarkdown);
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

        let frameId = 0;
        let resizeObserver = null;

        const syncAlignment = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
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
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            window.removeEventListener('resize', scheduleAlignmentSync);
            resizeObserver?.disconnect();
            tableShell.style.removeProperty(scrollbarVariableName);
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
        investmentHoldingsTableAlignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-holdings-scrollbar-width'
        );
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
        investmentHistoryTableAlignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-history-scrollbar-width'
        );
    }

    function bindInvestmentExportButton() {
        if (!exportTransactionsButton || exportTransactionsButton.dataset.bound === '1') return;
        exportTransactionsButton.dataset.bound = '1';
        exportTransactionsButton.addEventListener('click', () => {
            const exportPayload = buildInvestmentMarkdownExport();
            if (!exportPayload) return;
            downloadMarkdownFile(exportPayload.filename, exportPayload.markdown);
        });
    }

    function bindHoldingsLogoFallbacks(container) {
        if (!container) return;
        container.querySelectorAll('[data-investment-logo-image]').forEach((logo) => {
            if (logo.dataset.logoFallbackBound === '1') return;
            logo.dataset.logoFallbackBound = '1';
            logo.addEventListener('error', () => {
                logo.remove();
            }, { once: true });
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
        return bindInvestmentScrollIntent(document.querySelector('.investment-history-table-scroll'), 'history');
    }

    function getInvestmentHistoryRowsByLedgerNos(ledgerNos) {
        return Array.from(new Set((Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)))
            .map((ledgerNo) => document.getElementById(`investment_history_row_${ledgerNo}`))
            .filter(Boolean);
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
            const row = document.getElementById(rowId);
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
        if (!rows.length) return;
        clearInvestmentHistoryHighlights();
        rows.forEach((row) => {
            row.classList.remove('is-metric-hover-target');
            void row.offsetWidth;
            row.classList.add('is-metric-hover-target');
            row.classList.add('is-metric-hover-active');
        });
        activeInvestmentHistoryRowIds = rows.map((row) => row.id);
        if (scroll) {
            scrollInvestmentHistoryRowsIntoView(rows, behavior);
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
        const activeTicker = normalizeInvestmentTicker(selectedInvestmentStockTicker || '');
        if (!normalizedDate || !activeTicker || !Array.isArray(investmentProcessedTransactionsCache)) return 0;
        const match = investmentProcessedTransactionsCache.find((txn) => (
            normalizeLedgerDate(txn?.date) === normalizedDate
            && normalizeInvestmentTicker(txn?.ticker) === activeTicker
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
            <div class="trade-metric-card">
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
                })}
            </div>
        `).join('');
    }

    function renderFundingMetricCards(fundingMetrics, holdingsSummaryMetrics) {
        return [
            renderMetricCards(HOLDINGS_SUMMARY_METRIC_DEFINITIONS, holdingsSummaryMetrics),
            renderMetricCards(FUNDING_METRIC_DEFINITIONS, fundingMetrics),
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
        clearInvestmentStockDetailHighlights();
        if (holdingsPanel) {
            holdingsPanel.innerHTML = renderHoldingsTable([], {}, 0);
        }
        if (metricsPanel) {
            metricsPanel.innerHTML = renderFundingMetricCards(
                getUsdFundingMetrics([]),
                getHoldingsSummaryMetrics([], {}, 0)
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
        const transactionReady = isLikelyTransactionHistoryFile(transactionFile);
        const positionsReady = isLikelyPositionsFile(positionsFile);
        const importReady = transactionReady && positionsReady;

        setImportStatusIcon(transactionsCsvStatus, transactionReady);
        setImportStatusIcon(positionsCsvStatus, positionsReady);

        const submitButton = investmentForm?.querySelector('button[type="submit"]');
        syncActionButtonState(submitButton, {
            disabled: !importReady,
            pending: investmentImportInFlight,
        });
    }

    function openInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        clearImportFeedback();
        formContainer.style.display = 'block';
        syncInvestmentFormLayout();
        setTimeout(() => {
            formContainer.style.opacity = '1';
            formContainer.style.transform = 'scale(1)';
        }, 50);
        toggleIcon.classList.add('is-minus');
        toggleBtn.setAttribute('aria-label', 'Hide IBKR CSV import form');
    }

    function closeInvestmentImportForm() {
        if (!toggleBtn || !formContainer || !toggleIcon) return;
        if (investmentFormHideTimer) {
            window.clearTimeout(investmentFormHideTimer);
            investmentFormHideTimer = null;
        }
        formContainer.style.opacity = '0';
        formContainer.style.transform = 'scale(0.98)';
        investmentFormHideTimer = window.setTimeout(() => {
            formContainer.style.display = 'none';
            syncInvestmentFormLayout();
            investmentFormHideTimer = null;
        }, 400);
        toggleIcon.classList.remove('is-minus');
        toggleBtn.setAttribute('aria-label', 'Import IBKR CSV files');
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
        const response = await fetch('/api/investment/transactions', buildInvestmentRequestOptions());
        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || `Failed to load investment data: ${response.status}`);
        }
        window.ANTIGRAVITY_INVESTMENT_DATA = data;
        const valuationStatus = await renderTransactionTable(data.transactions || []);
        scheduleInvestmentSegmentedPillUpdate();
        return { data, valuationStatus };
    }

    initInvestmentViewTabs();
    initInvestmentDummyDonut();
    bindInvestmentExportButton();
    syncImportValidationState();
    [transactionsCsvInput, positionsCsvInput].forEach((input) => {
        if (input) {
            input.addEventListener('change', () => {
                clearImportFeedback();
                syncImportValidationState();
            });
        }
    });

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
            const isVisible = formContainer.style.display === 'block';
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
        }
    }

    // Handle form submission
    if (investmentForm) {
        investmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearImportFeedback();
            const transactionsCsv = document.getElementById('transactions_csv');
            const positionsCsv = document.getElementById('positions_csv');
            const transactionsFile = transactionsCsv?.files?.[0];
            const positionsFile = positionsCsv?.files?.[0];
            if (!transactionsFile || !positionsFile) {
                setImportFeedback('Please choose both IBKR CSV files before importing.', 'error');
                return;
            }
            if (!isLikelyTransactionHistoryFile(transactionsFile) || !isLikelyPositionsFile(positionsFile)) {
                setImportFeedback('Please make sure the first file is your Transaction History CSV and the second file is your Realized Summary CSV.', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('transactions_csv', transactionsFile);
            formData.append('positions_csv', positionsFile);

            const submitButton = investmentForm.querySelector('button[type="submit"]');
            investmentImportInFlight = true;
            syncImportValidationState();
            fetch('/api/investment/transactions', {
                method: 'POST',
                body: formData,
            })
            .then(response => response.json())
            .then(async result => {
                if (result.success) {
                    const refreshNotice = Array.isArray(result.freshness_refresh_failures) && result.freshness_refresh_failures.length
                        ? ` Some open positions could not be refreshed yet: ${result.freshness_refresh_failures.join(', ')}.`
                        : '';
                    const { valuationStatus } = await fetchInvestmentData();
                    const valuationNotice = valuationStatus?.isDegraded ? ` ${valuationStatus.message}` : '';
                    const feedbackVariant = valuationStatus?.isDegraded ? 'warning' : 'success';
                    setImportFeedback(`${result.message || 'Import complete.'}${refreshNotice}${valuationNotice}`, feedbackVariant);
                    closeInvestmentImportForm();
                } else {
                    setImportFeedback(result.error || 'Import failed.', 'error');
                }
            })
            .catch(err => {
                setImportFeedback(`Network error: ${err.message}`, 'error');
            })
            .finally(() => {
                investmentImportInFlight = false;
                syncImportValidationState();
            });
        });
    }

    // Load and render transactions
    fetchInvestmentData()
        .then(({ valuationStatus }) => {
            if (valuationStatus?.isDegraded) {
                setImportFeedback(valuationStatus.message, 'warning');
            }
        })
        .catch(err => {
            console.error('Failed to load transactions:', err);
            setImportFeedback(`Failed to load investment data: ${err.message}`, 'error');
        });

    function setInvestmentSharedChartDateRange(chartPoints = []) {
        const normalizedDates = Array.isArray(chartPoints)
            ? chartPoints
                .map((point) => normalizeLedgerDate(point?.date))
                .filter(Boolean)
            : [];
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

    function renderHoldingsTable(summaries, tickerProfiles, TOTAL_EQUITY) {
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
            const profile = tickerProfiles?.[summary.ticker] || {};
            const companyName = String(profile.company_name || summary.ticker);
            const logoUrl = resolveInvestmentLogoUrl(profile, summary.ticker);
            const averagePriceDisplay = summary.averagePrice === null ? '-' : formatHoldingsMoney(summary.averagePrice);
            const lastPriceDisplay = summary.lastPrice === null ? '-' : formatHoldingsMoney(summary.lastPrice);
            const realizedDisplay = formatHoldingsMoney(summary.realizedPnl);
            const unrealizedDisplay = summary.unrealizedPnl === null ? '-' : formatHoldingsMoney(summary.unrealizedPnl);
            const weightDisplay = summary.hasOpenPosition ? formatHoldingsPercent(summary.positionWeight) : '-';
            const realizedClass = summary.realizedPnl >= 0
                ? ' investment-holdings-value-positive'
                : ' investment-holdings-value-negative';
            const unrealizedClass = summary.unrealizedPnl === null
                ? ''
                : (summary.unrealizedPnl >= 0
                    ? ' investment-holdings-value-positive'
                    : ' investment-holdings-value-negative');

            return `
                <tr data-investment-holdings-ticker="${escapeHtml(summary.ticker)}">
                    <td class="investment-holdings-cell investment-holdings-cell-center">${index + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <a class="investment-holdings-ticker-anchor" href="${escapeHtml(buildInvestmentStockDetailsHref(summary.ticker))}" data-investment-stock-link data-investment-stock-ticker="${escapeHtml(summary.ticker)}">
                            <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link" data-ticker="${escapeHtml(summary.ticker)}">
                                <div class="ticker-identity-row">
                                    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="ticker-identity-logo" loading="lazy" decoding="async" data-investment-logo-image>` : ``}
                                    <span class="ticker-identity-copy">
                                        <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(summary.ticker)}</span>
                                        <span class="suggestion-name ticker-identity-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                                    </span>
                                </div>
                            </div>
                        </a>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${averagePriceDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${lastPriceDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${formatHoldingsPosition(summary.shares)}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${realizedClass}">${realizedDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${unrealizedClass}">${unrealizedDisplay}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">${weightDisplay}</td>
                </tr>
            `;
        }).join('');

        const summaryRowHtml = `
            <tr class="investment-holdings-summary-row">
                <td class="investment-holdings-cell investment-holdings-cell-center"></td>
                <td class="investment-holdings-cell investment-holdings-cell-ticker">
                    <span class="investment-holdings-summary-copy">Cumulative P&amp;L: <span class="${cumulativePnlClass.trim()}">${cumulativePnl >= 0 ? '+' : '-'}${formatHoldingsMoney(Math.abs(cumulativePnl))}</span></span>
                    <span class="investment-holdings-summary-copy">${summaries.length} instruments, ${openCount} open, ${closedCount} closed</span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalRealizedClass}">${formatHoldingsMoney(totalRealizedPnl)}</td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalUnrealizedClass}">${formatHoldingsMoney(totalUnrealizedPnl)}</td>
                <td class="investment-holdings-cell investment-holdings-cell-money">${formatHoldingsPercent(totalWeight)}</td>
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
            .map((txn) => normalizeInvestmentTicker(txn?.ticker))
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

    function buildInvestmentStockDetailRows(processedTransactions, ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const stockState = createPositionState(normalizedTicker);
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        let lastKnownTickerPrice = null;
        const detailRows = [];
        (Array.isArray(processedTransactions) ? processedTransactions : []).forEach((txn) => {
            if (normalizeInvestmentTicker(txn?.ticker) !== normalizedTicker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionQuantity(txn);
            const transactionPrice = getTransactionPrice(txn);
            let realizedPnl = null;
            if (normalizedType === 'buy' && Number.isFinite(quantity) && quantity > 0) {
                applyDirectionalTrade(stockState, 'long', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
            } else if (normalizedType === 'grant' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
            } else if (normalizedType === 'dividend_reinvestment' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
            } else if (normalizedType === 'sell' && Number.isFinite(quantity) && quantity > 0) {
                realizedPnl = applyDirectionalTrade(stockState, 'short', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
            } else if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                realizedPnl = getTransactionAmount(txn);
            }
            if (shouldTrackHoldingTicker(txn) && Number.isFinite(transactionPrice) && transactionPrice > 0) {
                lastKnownTickerPrice = transactionPrice;
            }
            const holdingQuantity = Number(txn?.holdings?.[normalizedTicker]);
            const safeHoldingQuantity = Number.isFinite(holdingQuantity) ? holdingQuantity : 0;
            let rowMarketValue = null;
            if (!isFlatPosition(safeHoldingQuantity)) {
                const valuationDate = normalizeLedgerDate(txn?.date);
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const sameDaySellPrice = getNormalizedTransactionType(txn) === 'sell' ? transactionPrice : null;
                    const anchoredPrice = txn.money_market_anchors?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                if ((!Number.isFinite(closePrice) || Math.abs(closePrice) < 1e-9) && Number.isFinite(lastKnownTickerPrice) && lastKnownTickerPrice > 0) {
                    closePrice = lastKnownTickerPrice;
                }
                if (Number.isFinite(closePrice)) {
                    rowMarketValue = safeHoldingQuantity * closePrice;
                }
            }
            detailRows.push({
                ...txn,
                rowMarketValue,
                rowRealizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
            });
        });
        return detailRows.reverse();
    }

    // Code version: v0.2.0.2
    function getStockDetailRealizedBreakdown(detailRows) {
        let dividendIncome = 0;
        let tradingSpreadIncome = 0;

        (Array.isArray(detailRows) ? detailRows : []).forEach((txn) => {
            const realizedPnl = Number(txn?.rowRealizedPnl);
            if (!Number.isFinite(realizedPnl)) return;

            const normalizedType = getNormalizedTransactionType(txn);
            if (['dividend', 'payment_in_lieu', 'foreign_tax_withholding'].includes(normalizedType)) {
                dividendIncome += realizedPnl;
                return;
            }

            tradingSpreadIncome += realizedPnl;
        });

        return {
            dividendIncome,
            tradingSpreadIncome,
            realizedPnl: dividendIncome + tradingSpreadIncome,
        };
    }

    function destroyInvestmentStockDetailsPriceChart() {
        if (investmentStockDetailsVisibleLayoutTimer) {
            window.clearTimeout(investmentStockDetailsVisibleLayoutTimer);
            investmentStockDetailsVisibleLayoutTimer = 0;
        }
        if (investmentStockDetailsPriceChartInstance) {
            const chartCanvas = investmentStockDetailsPriceChartInstance.canvas;
            if (chartCanvas?._abortController) {
                chartCanvas._abortController.abort();
                chartCanvas._abortController = null;
            }
            if (chartCanvas?._resizeObserver) {
                chartCanvas._resizeObserver.disconnect();
                chartCanvas._resizeObserver = null;
            }
            if (typeof chartCanvas?._windowResizeHandler === 'function') {
                window.removeEventListener('resize', chartCanvas._windowResizeHandler);
                chartCanvas._windowResizeHandler = null;
            }
            if (Number.isInteger(chartCanvas?._layoutSyncRaf) && chartCanvas._layoutSyncRaf > 0) {
                window.cancelAnimationFrame(chartCanvas._layoutSyncRaf);
                chartCanvas._layoutSyncRaf = 0;
            }
            if (Number.isInteger(chartCanvas?._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                window.clearTimeout(chartCanvas._layoutSyncTimer);
                chartCanvas._layoutSyncTimer = 0;
            }
            chartCanvas._scheduleLayoutSync = null;
            investmentStockDetailsPriceChartInstance.destroy();
            investmentStockDetailsPriceChartInstance = null;
        }
        activeStockDetailsHoverPointRecord = null;
    }

    async function renderInvestmentStockDetailsPriceChart(ticker, detailRows = []) {
        const chartHost = investmentStockDetailsPanel?.querySelector('[data-investment-stock-price-chart]');
        if (!(chartHost instanceof HTMLElement)) {
            destroyInvestmentStockDetailsPriceChart();
            return;
        }

        destroyInvestmentStockDetailsPriceChart();
        const renderRequestId = ++investmentStockDetailsPriceChartRequestSerial;
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker || !window.Chart) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }

        const normalizedRange = normalizeInvestmentStockDetailsRange(selectedInvestmentStockDetailsRange);
        let intradayRows = [];
        if (isInvestmentStockDetailsIntradayRange(normalizedRange)) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Loading 1-minute price history...</div>';
            try {
                intradayRows = await loadInvestmentStockDetailsIntradayRows(normalizedTicker, normalizedRange);
            } catch (error) {
                console.warn(error);
                intradayRows = [];
            }
            if (renderRequestId !== investmentStockDetailsPriceChartRequestSerial) return;
        }

        const priceHistoryByTicker = normalizePriceHistoryPayload(window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {});
        const tickerPriceMap = priceHistoryByTicker[normalizedTicker] || {};
        const tickerLabels = Object.keys(tickerPriceMap).sort();
        const sharedLabels = getInvestmentSharedChartDateRange(tickerLabels);
        const fullLabels = sharedLabels.length ? sharedLabels : tickerLabels;
        const useIntradayCandles = Array.isArray(intradayRows) && intradayRows.length > 0;
        const labels = useIntradayCandles
            ? intradayRows.map((row) => String(row?.date || ''))
            : getInvestmentStockDetailsRangeLabels(fullLabels, normalizedRange);
        const closeValues = useIntradayCandles
            ? labels.map((_, index) => {
                const close = Number(intradayRows[index]?.close);
                return Number.isFinite(close) ? close : null;
            })
            : labels.map((date) => {
                const close = Number(tickerPriceMap[date]);
                return Number.isFinite(close) ? close : null;
            });
        const openValues = useIntradayCandles
            ? labels.map((_, index) => {
                const open = Number(intradayRows[index]?.open);
                return Number.isFinite(open) ? open : null;
            })
            : [];
        const highValues = useIntradayCandles
            ? labels.map((_, index) => {
                const high = Number(intradayRows[index]?.high);
                return Number.isFinite(high) ? high : null;
            })
            : [];
        const lowValues = useIntradayCandles
            ? labels.map((_, index) => {
                const low = Number(intradayRows[index]?.low);
                return Number.isFinite(low) ? low : null;
            })
            : [];
        if ((!tickerLabels.length && !useIntradayCandles) || !closeValues.some((value) => Number.isFinite(value))) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }

        await waitForInvestmentStableElementBox(chartHost, {
            minimumWidth: 160,
            minimumHeight: 180,
        });
        if (renderRequestId !== investmentStockDetailsPriceChartRequestSerial) return;

        chartHost.innerHTML = '<canvas class="investment-stock-details-price-chart-canvas"></canvas>';
        const canvas = chartHost.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return;

        const chronologicalRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        const dateIndex = new Map();
        labels.forEach((value, index) => {
            dateIndex.set(String(value), index);
            const minuteKey = normalizeInvestmentIntradayMinuteKey(value);
            if (minuteKey) dateIndex.set(minuteKey, index);
        });
        const intradayDayFallbackIndex = buildInvestmentIntradayDayFallbackIndex(labels);
        const intradayDayBoundaries = buildInvestmentIntradayDayBoundaries(labels);
        const resolveTradeMarkerPrice = (markerIndex, transactionPrice) => {
            const normalizedTransactionPrice = Number(transactionPrice);
            const normalizedClosePrice = Number(closeValues[markerIndex]);
            if (Number.isFinite(normalizedTransactionPrice)) {
                return adjustTradePriceForRenderedSeries(normalizedTransactionPrice, normalizedClosePrice);
            }
            return Number.isFinite(normalizedClosePrice) ? normalizedClosePrice : null;
        };
        const tradeMarkerPoints = chronologicalRows.reduce((accumulator, txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(normalizedType)) return accumulator;
            const exactMinuteKey = normalizeInvestmentIntradayMinuteKey(txn?.date);
            const transactionPrice = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            let markerIndex = null;
            let markerPlacement = 'bar';
            let markerSessionType = 'intraday';
            let markerPrice = null;
            if (useIntradayCandles) {
                markerSessionType = getInvestmentTradeSessionType(txn?.date);
                const exactMinuteIndex = dateIndex.get(exactMinuteKey);
                if (Number.isInteger(exactMinuteIndex)) {
                    markerIndex = exactMinuteIndex;
                    markerPrice = resolveTradeMarkerPrice(exactMinuteIndex, transactionPrice);
                } else if (markerSessionType !== 'intraday') {
                    const dayBoundary = intradayDayBoundaries.dayMap.get(ledgerDate);
                    if (dayBoundary) {
                        markerPlacement = 'gap';
                        markerIndex = markerSessionType === 'post' ? dayBoundary.lastIndex : dayBoundary.firstIndex;
                        markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                    }
                }
                if (!Number.isInteger(markerIndex)) {
                    markerIndex = intradayDayFallbackIndex.get(ledgerDate);
                    if (Number.isInteger(markerIndex)) {
                        markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                    }
                }
            } else {
                markerIndex = dateIndex.get(ledgerDate);
                if (Number.isInteger(markerIndex)) {
                    markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                }
            }
            if (!Number.isInteger(markerIndex)) return accumulator;
            if (!Number.isFinite(markerPrice)) return accumulator;
            // Match every trade marker vertically to the executed fill price whenever it exists.
            // If a transaction lacks a usable fill price, fall back to the rendered series value.
            const marker = {
                index: markerIndex,
                x: labels[markerIndex],
                y: markerPrice,
                type: normalizedType,
                placement: markerPlacement,
                sessionType: markerSessionType,
                ledgerDate,
                transactionPrice: Number.isFinite(transactionPrice) ? transactionPrice : null,
            };
            if (normalizedType === 'buy') accumulator.buy.push(marker);
            if (normalizedType === 'sell') accumulator.sell.push(marker);
            return accumulator;
        }, { buy: [], sell: [] });
        const transactionsByDate = chronologicalRows.reduce((accumulator, txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return accumulator;
            if (!accumulator.has(ledgerDate)) accumulator.set(ledgerDate, []);
            accumulator.get(ledgerDate).push(txn);
            return accumulator;
        }, new Map());
        const stockSnapshotsByDate = new Map();
        const investmentPointByDate = new Map((Array.isArray(investmentChartPointsCache) ? investmentChartPointsCache : [])
            .map((point) => [normalizeLedgerDate(point?.date), point])
            .filter(([date]) => Boolean(date)));
        let latestShares = 0;
        labels.forEach((label, index) => {
            const labelDateKey = normalizeLedgerDate(label);
            const dateTxns = transactionsByDate.get(labelDateKey) || [];
            const buySellLedgerNos = dateTxns
                .filter((txn) => ['buy', 'sell'].includes(getNormalizedTransactionType(txn)))
                .map((txn) => Number(txn?.ledger_no))
                .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                .sort((left, right) => right - left);
            if (dateTxns.length) {
                const latestTxn = dateTxns[dateTxns.length - 1];
                const latestHoldings = latestTxn?.holdings && typeof latestTxn.holdings === 'object'
                    ? latestTxn.holdings
                    : null;
                const hasTickerHolding = latestHoldings
                    ? Object.prototype.hasOwnProperty.call(latestHoldings, normalizedTicker)
                    : false;
                const txnShares = hasTickerHolding ? Number(latestHoldings[normalizedTicker]) : 0;
                latestShares = Number.isFinite(txnShares) ? txnShares : 0;
            }
            const close = Number(closeValues[index]);
            stockSnapshotsByDate.set(String(label), {
                shares: latestShares,
                close: Number.isFinite(close) ? close : null,
                buyQuantity: dateTxns.reduce((sum, txn) => {
                    if (getNormalizedTransactionType(txn) !== 'buy') return sum;
                    const quantity = Number(getTransactionQuantity(txn));
                    return Number.isFinite(quantity) && quantity > 0 ? sum + quantity : sum;
                }, 0),
                sellQuantity: dateTxns.reduce((sum, txn) => {
                    if (getNormalizedTransactionType(txn) !== 'sell') return sum;
                    const quantity = Number(getTransactionQuantity(txn));
                    return Number.isFinite(quantity) && quantity > 0 ? sum + quantity : sum;
                }, 0),
                buySellLedgerNos,
            });
        });

        const resolvedTheme = resolveInvestmentTheme();
        const formatMoney = (value) => new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
        const formatShareCount = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '--';
            return numericValue.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6,
            });
        };
        const parseRawDate = (value) => {
            if (typeof value !== 'string') return null;
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
        const formatTooltipDate = (dateParts) => {
            return formatInvestmentFullDateParts(dateParts, { includeTime: true });
        };
        const formatAxisDateLines = (dateParts) => {
            return formatInvestmentFullDateLines(dateParts, { allowWrap: true });
        };
        const buildTickIndexSet = (count, plotWidth) => {
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
        };
        const STOCK_DETAILS_MARKER_HALF_WIDTH_PX = 6;
        const STOCK_DETAILS_MARKER_HEIGHT_PX = 11;
        const STOCK_DETAILS_MARKER_X_PADDING_PX = STOCK_DETAILS_MARKER_HALF_WIDTH_PX + 2;
        const STOCK_DETAILS_MARKER_Y_PADDING_PX = STOCK_DETAILS_MARKER_HEIGHT_PX + 2;
        const getStockDetailsChartYScaleValues = () => ([
            ...openValues,
            ...highValues,
            ...lowValues,
            ...closeValues,
            ...tradeMarkerPoints.buy.map((marker) => marker.y),
            ...tradeMarkerPoints.sell.map((marker) => marker.y),
        ]);
        const buildPixelPaddedYScale = (chartCanvas, values, paddingPx) => {
            const finiteValues = (Array.isArray(values) ? values : [])
                .filter((value) => value !== null && value !== undefined && value !== '')
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value));
            if (!finiteValues.length) return {};
            const rawMin = Math.min(...finiteValues);
            const rawMax = Math.max(...finiteValues);
            if (rawMin === rawMax) {
                const fallbackPadding = Math.abs(rawMin || 1) * 0.02 || 1;
                return {
                    min: rawMin - fallbackPadding,
                    max: rawMax + fallbackPadding,
                };
            }
            const canvasHeight = Math.max(chartCanvas?.clientHeight || 0, 80);
            const usableHeight = Math.max(canvasHeight - (paddingPx * 2), 1);
            const dataPadding = (rawMax - rawMin) * (paddingPx / usableHeight);
            return {
                min: rawMin - dataPadding,
                max: rawMax + dataPadding,
            };
        };
        const getChartAxisTickDecimalPlaces = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return 0;
            const normalizedString = numericValue
                .toFixed(8)
                .replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, '$1');
            const decimalPart = normalizedString.split('.')[1] || '';
            return decimalPart.length;
        };
        const resolveStockDetailsYAxisFractionDigits = (ticks) => {
            const tickItems = Array.isArray(ticks) ? ticks : [];
            const visibleTickItems = tickItems.length > 2 ? tickItems.slice(1, -1) : tickItems;
            const maxFractionDigits = visibleTickItems.reduce((maxDigits, tick) => {
                const tickValue = Number(tick?.value ?? tick);
                return Math.max(maxDigits, getChartAxisTickDecimalPlaces(tickValue));
            }, 0);
            return maxFractionDigits > 0 ? Math.max(1, maxFractionDigits) : 0;
        };
        const formatStockDetailsYAxisTickLabel = (value, ticks) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '';
            const fractionDigits = resolveStockDetailsYAxisFractionDigits(ticks);
            return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
            }).format(numericValue);
        };
        const xAxisLabelPlugin = {
            id: 'investmentStockDetailsXAxisLabelPlugin',
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = '700 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                ctx.textBaseline = 'top';
                tickIndexes.forEach((index, tickIndex) => {
                    const parsedDate = parseRawDate(labels[index]);
                    if (!parsedDate) return;
                    const [firstLine, secondLine] = formatAxisDateLines(parsedDate);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = 'left';
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = 'right';
                    else ctx.textAlign = 'center';
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };
        const candlestickPlugin = {
            id: 'investmentStockDetailsCandlestickPlugin',
            afterDatasetsDraw(chartInstance) {
                if (!useIntradayCandles) return;
                const { ctx, chartArea, scales } = chartInstance;
                const meta = chartInstance.getDatasetMeta(0);
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!meta || !meta.data.length || !xScale || !yScale || !chartArea) return;
                const columnWidth = (chartArea.right - chartArea.left) / labels.length;
                const candleWidth = Math.min(20, Math.max(1.5, columnWidth * 0.72));
                ctx.save();
                meta.data.forEach((point, index) => {
                    const open = Number(openValues[index]);
                    const high = Number(highValues[index]);
                    const low = Number(lowValues[index]);
                    const close = Number(closeValues[index]);
                    if (![open, high, low, close].every(Number.isFinite)) return;
                    const x = Number(point?.x);
                    if (!Number.isFinite(x)) return;
                    const openY = yScale.getPixelForValue(open);
                    const highY = yScale.getPixelForValue(high);
                    const lowY = yScale.getPixelForValue(low);
                    const closeY = yScale.getPixelForValue(close);
                    ctx.strokeStyle = resolvedTheme.accentPrimary;
                    ctx.fillStyle = resolvedTheme.accentPrimary;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, highY);
                    ctx.lineTo(x, lowY);
                    ctx.stroke();
                    const bodyTop = Math.min(openY, closeY);
                    const bodyBottom = Math.max(openY, closeY);
                    const bodyHeight = Math.max(0.75, bodyBottom - bodyTop);
                    ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
                });
                ctx.restore();
            },
        };
        const hoverGuidePlugin = {
            id: 'investmentStockDetailsHoverGuidePlugin',
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
        const drawTradeMarker = (ctx, { x, y, type, color }) => {
            if (!Number.isFinite(x) || !Number.isFinite(y) || !color) return;
            const halfWidth = STOCK_DETAILS_MARKER_HALF_WIDTH_PX;
            const height = STOCK_DETAILS_MARKER_HEIGHT_PX;
            ctx.save();
            ctx.beginPath();
            if (type === 'sell') {
                ctx.moveTo(x, y);
                ctx.lineTo(x - halfWidth, y - height);
                ctx.lineTo(x + halfWidth, y - height);
            } else {
                ctx.moveTo(x, y);
                ctx.lineTo(x - halfWidth, y + height);
                ctx.lineTo(x + halfWidth, y + height);
            }
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
        };
        const resolveTradeMarkerPixelPosition = (chartInstance, marker) => {
            const yScale = chartInstance?.scales?.y;
            const linePoints = chartInstance?.getDatasetMeta(0)?.data || [];
            const chartArea = chartInstance?.chartArea;
            if (!yScale || !linePoints.length || !chartArea) return null;
            const fallbackPoint = linePoints[marker?.index];
            const fallbackX = Number(fallbackPoint?.x);
            const y = Number(yScale.getPixelForValue(marker?.y));
            if (!Number.isFinite(y)) return null;
            if (marker?.placement !== 'gap' || !useIntradayCandles) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            const dayBoundary = intradayDayBoundaries.dayMap.get(marker?.ledgerDate);
            if (!dayBoundary) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            const previousDay = dayBoundary.ordinal > 0
                ? intradayDayBoundaries.orderedDays[dayBoundary.ordinal - 1]
                : null;
            const nextDay = dayBoundary.ordinal < intradayDayBoundaries.orderedDays.length - 1
                ? intradayDayBoundaries.orderedDays[dayBoundary.ordinal + 1]
                : null;
            const getPointX = (index) => Number(linePoints[index]?.x);
            let leftX = Number.NaN;
            let rightX = Number.NaN;
            let fraction = 0.5;
            if (marker?.sessionType === 'post') {
                leftX = getPointX(dayBoundary.lastIndex);
                rightX = nextDay ? getPointX(nextDay.firstIndex) : chartArea.right;
                fraction = nextDay ? 0.25 : 0.5;
            } else if (marker?.sessionType === 'night' || marker?.sessionType === 'pre') {
                leftX = previousDay ? getPointX(previousDay.lastIndex) : chartArea.left;
                rightX = getPointX(dayBoundary.firstIndex);
                if (previousDay) {
                    fraction = marker.sessionType === 'night' ? 0.5 : 0.75;
                } else {
                    fraction = marker.sessionType === 'night' ? (1 / 3) : (2 / 3);
                }
            }
            if (!Number.isFinite(leftX) || !Number.isFinite(rightX) || rightX <= leftX) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            return {
                x: leftX + ((rightX - leftX) * fraction),
                y,
            };
        };
        const tradeMarkerPlugin = {
            id: 'investmentStockDetailsTradeMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                const drawMarkerGroup = (markers, color) => {
                    (Array.isArray(markers) ? markers : []).forEach((marker) => {
                        if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.y)) return;
                        const markerPosition = resolveTradeMarkerPixelPosition(chartInstance, marker);
                        const x = Number(markerPosition?.x);
                        const y = Number(markerPosition?.y);
                        drawTradeMarker(chartInstance.ctx, {
                            x,
                            y,
                            type: String(marker.type || ''),
                            color,
                        });
                    });
                };
                drawMarkerGroup(tradeMarkerPoints.buy, resolvedTheme.accentPositive);
                drawMarkerGroup(tradeMarkerPoints.sell, resolvedTheme.accentSecondary);
            },
        };
        const getOrCreateTooltip = () => {
            let tooltip = document.querySelector('[data-investment-stock-details-tooltip="1"]');
            if (tooltip) return tooltip;
            tooltip = document.createElement('div');
            tooltip.className = 'chart-tooltip';
            tooltip.dataset.investmentStockDetailsTooltip = '1';
            tooltip.style.position = 'fixed';
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            document.body.appendChild(tooltip);
            return tooltip;
        };
        const buildTooltipTriangle = (color, direction = 'up') => {
            const path = direction === 'down'
                ? 'M19.9414 1.38672C19.9414 0.546875 19.3066 0.0195312 18.3105 0.0195312L1.64062 0.00976562C0.634766 0.00976562 0 0.537109 0 1.37695C0 1.83594 0.195312 2.1875 0.439453 2.68555L8.45703 19.2578C8.92578 20.2051 9.36523 20.5176 9.9707 20.5176C10.5859 20.5176 11.0254 20.2051 11.4844 19.2578L19.5117 2.68555C19.7461 2.19727 19.9414 1.8457 19.9414 1.38672Z'
                : 'M19.9414 19.1406C19.9414 18.6914 19.7461 18.3398 19.5117 17.8516L11.4844 1.26953C11.0254 0.332031 10.5859 0.00976562 9.9707 0.00976562C9.36523 0.00976562 8.92578 0.332031 8.45703 1.26953L0.439453 17.8516C0.195312 18.3496 0 18.7012 0 19.1504C0 20 0.634766 20.5176 1.64062 20.5176L18.3105 20.5078C19.3066 20.5078 19.9414 19.9902 19.9414 19.1406Z';
            return `<svg class="investment-chart-tooltip-triangle" viewBox="0 0 ${STOCK_DETAILS_MARKER_VIEW_BOX.width} ${STOCK_DETAILS_MARKER_VIEW_BOX.height}" aria-hidden="true"><path fill="${color}" d="${path}"></path></svg>`;
        };
        let activeStockDetailsHoverDate = '';
        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip();
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove('is-visible');
                activeStockDetailsHoverDate = '';
                activeStockDetailsHoverPointRecord = null;
                clearInvestmentStockDetailHighlights();
                clearInvestmentHistoryHighlights();
                syncInvestmentStockDetailsDonutFromInteraction();
                return;
            }
            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const rawDate = labels[pointIndex];
            const parsedDate = parseRawDate(rawDate);
            const snapshot = stockSnapshotsByDate.get(String(rawDate)) || {};
            const buySellLedgerNos = Array.isArray(snapshot?.buySellLedgerNos) ? snapshot.buySellLedgerNos : [];
            const shares = Number(snapshot?.shares);
            const closePrice = Number(snapshot?.close);
            const marketValue = Number.isFinite(shares) && Number.isFinite(closePrice) ? shares * closePrice : null;
            const buyQuantity = Number(snapshot?.buyQuantity);
            const sellQuantity = Number(snapshot?.sellQuantity);
            const hoverLedgerDate = normalizeLedgerDate(rawDate);
            activeStockDetailsHoverPointRecord = investmentPointByDate.get(hoverLedgerDate) || null;
            syncInvestmentStockDetailsDonutFromInteraction();
            if (hoverLedgerDate !== activeStockDetailsHoverDate) {
                const primaryLedgerNo = normalizeInvestmentLedgerNos(buySellLedgerNos)[0] || 0;
                if (primaryLedgerNo > 0) {
                    syncInvestmentHoverLinkedViews({
                        hoverLedgerNo: primaryLedgerNo,
                        historyLedgerNos: [primaryLedgerNo],
                        stockDetailLedgerNos: [primaryLedgerNo],
                        interactionLedgerNo: primaryLedgerNo,
                        historyBehavior: 'auto',
                    historyScroll: false,
                        stockDetailBehavior: 'auto',
                    stockDetailScroll: false,
                    });
                } else {
                    clearInvestmentStockDetailHighlights();
                    clearInvestmentHistoryHighlights();
                }
                activeStockDetailsHoverDate = hoverLedgerDate;
            }
            const dateEl = tooltipEl.querySelector('.chart-tooltip-date');
            const listEl = tooltipEl.querySelector('.chart-tooltip-list');
            const activeMarkerType = String(chart?._activeInvestmentStockDetailsMarkerType || '');
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || '');
            const tooltipRows = [
                {
                    label: 'Position',
                    value: formatShareCount(shares),
                    color: resolvedTheme.accentPrimary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
                {
                    label: 'Market value',
                    value: Number.isFinite(marketValue) ? formatMoney(marketValue) : '--',
                    color: resolvedTheme.accentSecondary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
            ];
            if (Number.isFinite(buyQuantity) && buyQuantity > 0) {
                tooltipRows.push({
                    label: 'Buy shares',
                    value: formatShareCount(buyQuantity),
                    color: resolvedTheme.accentPositive,
                    bulletHtml: activeMarkerType === 'buy'
                        ? buildTooltipTriangle(resolvedTheme.accentPositive, 'up')
                        : '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            if (Number.isFinite(sellQuantity) && sellQuantity > 0) {
                tooltipRows.push({
                    label: 'Sell shares',
                    value: formatShareCount(sellQuantity),
                    color: resolvedTheme.accentSecondary,
                    bulletHtml: activeMarkerType === 'sell'
                        ? buildTooltipTriangle(resolvedTheme.accentSecondary, 'down')
                        : '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            listEl.innerHTML = tooltipRows.map((row) => `
                <div class="chart-tooltip-row">
                    ${row.bulletHtml.replace('class="chart-tooltip-dot"', `class="chart-tooltip-dot" style="background:${row.color}"`)}
                    <span aria-hidden="true"></span>
                    <span class="chart-tooltip-label">${row.label}</span>
                    <span class="chart-tooltip-value">${row.value}</span>
                </div>
            `).join('');
            const canvasRect = chart.canvas.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            const padding = 12;
            const gap = 14;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
            const anchorX = canvasRect.left + tooltip.caretX;
            const anchorY = canvasRect.top + tooltip.caretY;
            const donutCard = investmentStockDetailsPanel?.querySelector('.investment-stock-details-donut-card');
            const donutRect = donutCard instanceof HTMLElement ? donutCard.getBoundingClientRect() : null;
            const rightBoundary = donutRect && donutRect.left > padding
                ? Math.min(viewportWidth - padding, donutRect.left - gap)
                : viewportWidth - padding;
            const roomRight = rightBoundary - anchorX;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
            if (left < padding) left = padding;
            const maxLeft = rightBoundary - tooltipRect.width;
            if (left > maxLeft) left = maxLeft;
            if (left < padding) left = padding;
            let top = anchorY - (tooltipRect.height / 2);
            if (top < padding) top = padding;
            if (top + tooltipRect.height > viewportHeight - padding) {
                top = viewportHeight - tooltipRect.height - padding;
            }
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
            tooltipEl.classList.add('is-visible');
        };

        investmentStockDetailsPriceChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                rawLabels: labels,
                datasets: [
                    {
                        label: `${normalizedTicker} close`,
                        data: closeValues,
                        order: 0,
                        borderColor: useIntradayCandles ? 'transparent' : resolvedTheme.accentPrimary,
                        borderWidth: useIntradayCandles ? 0 : 1.0,
                        pointRadius: 0,
                        tension: 0,
                        borderJoinStyle: 'round',
                        borderCapStyle: 'round',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: STOCK_DETAILS_MARKER_X_PADDING_PX,
                        right: STOCK_DETAILS_MARKER_X_PADDING_PX,
                        top: 44,
                        bottom: 24,
                    },
                },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false, external: externalTooltipHandler },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { display: false },
                    },
                    y: {
                        ...buildPixelPaddedYScale(
                            canvas,
                            getStockDetailsChartYScaleValues(),
                            STOCK_DETAILS_MARKER_Y_PADDING_PX,
                        ),
                        bounds: 'ticks',
                        grid: { display: false, drawTicks: false },
                        border: { display: false },
                        ticks: {
                            color: resolvedTheme.muted,
                            display: true,
                            padding: 0,
                            callback(value, index, ticks) {
                                if (index === 0 || index === ticks.length - 1) return '';
                                return formatStockDetailsYAxisTickLabel(value, ticks);
                            },
                        },
                    },
                },
            },
            plugins: [candlestickPlugin, hoverGuidePlugin, xAxisLabelPlugin, tradeMarkerPlugin],
        });
        const TRADE_MARKER_SNAP_HORIZONTAL_BARS = 3;
        const TRADE_MARKER_SNAP_HORIZONTAL_PX = 20;
        const TRADE_MARKER_SNAP_VERTICAL_PX = 20;
        const resolveNearestHoverState = (chart, event) => {
            const chartArea = chart?.chartArea;
            if (!chartArea || !labels.length) return null;
            const canvasRect = chart.canvas.getBoundingClientRect();
            const relativeX = event.clientX - canvasRect.left;
            const relativeY = event.clientY - canvasRect.top;
            if (!Number.isFinite(relativeX)) return null;
            const points = chart.getDatasetMeta(0)?.data || [];
            let nearestIndex = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            points.forEach((point, index) => {
                if (!point || !Number.isFinite(point.x)) return;
                const distance = Math.abs(point.x - relativeX);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });
            if (!Number.isInteger(nearestIndex)) return null;
            if (!Number.isFinite(relativeY)) return { index: nearestIndex, markerType: '' };
            if (relativeY < chartArea.top || relativeY >= chartArea.bottom) return { index: nearestIndex, markerType: '' };
            const yScale = chart.scales?.y;
            if (!yScale) return { index: nearestIndex, markerType: '' };
            const markerCandidates = [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell];
            let snappedMarker = null;
            let snappedMarkerDistance = Number.POSITIVE_INFINITY;
            markerCandidates.forEach((marker) => {
                if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.y)) return;
                if (Math.abs(marker.index - nearestIndex) > TRADE_MARKER_SNAP_HORIZONTAL_BARS) return;
                const markerPosition = resolveTradeMarkerPixelPosition(chart, marker);
                const markerX = Number(markerPosition?.x);
                const markerY = Number(markerPosition?.y);
                if (!Number.isFinite(markerX) || !Number.isFinite(markerY)) return;
                if (Math.abs(markerY - relativeY) >= TRADE_MARKER_SNAP_VERTICAL_PX) return;
                const markerDistance = Math.abs(markerX - relativeX);
                if (markerDistance >= TRADE_MARKER_SNAP_HORIZONTAL_PX) return;
                if (markerDistance < snappedMarkerDistance) {
                    snappedMarkerDistance = markerDistance;
                    snappedMarker = {
                        ...marker,
                        pixelX: markerX,
                        pixelY: markerY,
                    };
                }
            });
            if (snappedMarker && Number.isInteger(snappedMarker.index)) {
                return {
                    index: snappedMarker.index,
                    markerType: String(snappedMarker.type || ''),
                    markerPosition: {
                        x: snappedMarker.pixelX,
                        y: snappedMarker.pixelY,
                    },
                };
            }
            return { index: nearestIndex, markerType: '' };
        };
        const syncStockDetailsHoverState = (chart, hoverState) => {
            const index = hoverState && Number.isInteger(hoverState.index) ? hoverState.index : null;
            chart._activeInvestmentStockDetailsMarkerType = index === null
                ? ''
                : String(hoverState?.markerType || '');
            const activeElements = index === null ? [] : [{ datasetIndex: 0, index }];
            chart.setActiveElements(activeElements);
            if (typeof chart.tooltip?.setActiveElements === 'function') {
                if (index === null) {
                    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                } else {
                    const point = chart.getDatasetMeta(0)?.data?.[index];
                    const fallbackX = Number(chart.chartArea?.left) || 0;
                    const fallbackY = Number(chart.chartArea?.top) || 0;
                    const markerX = Number(hoverState?.markerPosition?.x);
                    const markerY = Number(hoverState?.markerPosition?.y);
                    chart.tooltip.setActiveElements(
                        activeElements,
                        {
                            x: markerX || Number(point?.x) || fallbackX,
                            y: markerY || Number(point?.y) || fallbackY,
                        },
                    );
                }
            }
            chart.update('none');
        };
        const attachStockDetailsHover = (chart) => {
            const chartCanvas = chart?.canvas;
            if (!chartCanvas) return;
            if (chartCanvas._abortController) chartCanvas._abortController.abort();
            const controller = new AbortController();
            chartCanvas._abortController = controller;
            const { signal } = controller;
            chartCanvas.addEventListener('mousemove', (event) => {
                const hoverState = resolveNearestHoverState(chart, event);
                syncStockDetailsHoverState(chart, hoverState);
            }, { signal });
            chartCanvas.addEventListener('mouseleave', () => {
                syncStockDetailsHoverState(chart, null);
            }, { signal });
        };
        attachStockDetailsHover(investmentStockDetailsPriceChartInstance);
        const attachStockDetailsResizeSync = (chart) => {
            const chartCanvas = chart?.canvas;
            if (!chartCanvas) return;
            const applyLayoutSync = () => {
                chartCanvas._layoutSyncRaf = 0;
                const nextYScale = buildPixelPaddedYScale(
                    chartCanvas,
                    getStockDetailsChartYScaleValues(),
                    STOCK_DETAILS_MARKER_Y_PADDING_PX,
                );
                if (Number.isFinite(nextYScale?.min) && Number.isFinite(nextYScale?.max)) {
                    chart.options.scales.y.min = nextYScale.min;
                    chart.options.scales.y.max = nextYScale.max;
                }
                chart.resize();
                chart.update('none');
            };
            const scheduleLayoutSync = () => {
                if (Number.isInteger(chartCanvas._layoutSyncRaf) && chartCanvas._layoutSyncRaf > 0) return;
                chartCanvas._layoutSyncRaf = window.requestAnimationFrame(applyLayoutSync);
            };
            const scheduleSettledLayoutSync = () => {
                if (Number.isInteger(chartCanvas._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                    window.clearTimeout(chartCanvas._layoutSyncTimer);
                }
                chartCanvas._layoutSyncTimer = window.setTimeout(() => {
                    chartCanvas._layoutSyncTimer = 0;
                    scheduleLayoutSync();
                }, Math.max(260, INVESTMENT_SURFACE_LAYOUT_SETTLE_MS + 40));
            };
            chartCanvas._scheduleLayoutSync = () => {
                scheduleLayoutSync();
                scheduleSettledLayoutSync();
            };
            if (window.ResizeObserver && chartHost instanceof HTMLElement) {
                const resizeObserver = new ResizeObserver(() => {
                    chartCanvas._scheduleLayoutSync?.();
                });
                resizeObserver.observe(chartHost);
                resizeObserver.observe(chartCanvas);
                if (investmentStockDetailsPanel instanceof HTMLElement) {
                    resizeObserver.observe(investmentStockDetailsPanel);
                }
                chartCanvas._resizeObserver = resizeObserver;
            } else {
                const windowResizeHandler = () => {
                    chartCanvas._scheduleLayoutSync?.();
                };
                window.addEventListener('resize', windowResizeHandler);
                chartCanvas._windowResizeHandler = windowResizeHandler;
            }
            chartCanvas._scheduleLayoutSync?.();
        };
        attachStockDetailsResizeSync(investmentStockDetailsPriceChartInstance);
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
        const profile = tickerProfiles?.[activeTicker] || {};
        const companyName = String(profile.company_name || activeTicker);
        const logoUrl = resolveInvestmentLogoUrl(profile, activeTicker);
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
        const totalPnl = (Number(tickerSummary.realizedPnl) || 0) + (Number(tickerSummary.unrealizedPnl) || 0);
        const totalPnlClass = totalPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const realizedClass = (Number(tickerSummary.realizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const unrealizedClass = (Number(tickerSummary.unrealizedPnl) || 0) >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative';
        const stockMetricCards = [
            {
                label: 'Unrealized P&L',
                value: tickerSummary.unrealizedPnl === null ? '-' : formatHoldingsMoney(tickerSummary.unrealizedPnl),
                valueClass: tickerSummary.unrealizedPnl === null ? '' : unrealizedClass,
            },
            {
                label: 'Realized P&L',
                value: formatHoldingsMoney(tickerSummary.realizedPnl),
                valueClass: realizedClass,
                cardClass: 'investment-stock-details-metric-card-with-breakdown',
                details: [
                    {
                        label: 'Dividend income',
                        value: formatHoldingsMoney(realizedBreakdown.dividendIncome),
                        valueClass: getSignedMetricClass(realizedBreakdown.dividendIncome),
                    },
                    {
                        label: 'Trading spread income',
                        value: formatHoldingsMoney(realizedBreakdown.tradingSpreadIncome),
                        valueClass: getSignedMetricClass(realizedBreakdown.tradingSpreadIncome),
                    },
                ],
            },
            {
                label: 'Total P&L',
                value: formatHoldingsMoney(totalPnl),
                valueClass: totalPnlClass,
            },
            {
                label: 'Position',
                value: formatHoldingsPosition(tickerSummary.shares),
                valueClass: '',
            },
            {
                label: 'Market value',
                value: tickerSummary.hasOpenPosition ? formatHoldingsMoney(tickerSummary.marketValue) : '-',
                valueClass: '',
            },
            {
                label: 'Average price',
                value: averagePriceDisplay,
                valueClass: '',
            },
            {
                label: 'Total trades',
                value: totalTradeCountDisplay,
                valueClass: '',
            },
            {
                label: 'Total commission',
                value: totalCommissionDisplay,
                valueClass: totalCommissionClass,
            },
        ];
        const rowsHtml = detailRows.length ? detailRows.map((txn) => `
            <tr data-investment-stock-detail-ledger="${txn.ledger_no}">
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${formatTransactionDescription(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.display_amount ?? getTransactionEconomicAmount(txn))}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${txn.rowMarketValue === null ? '-' : formatAmount(txn.rowMarketValue)}</td>
                <td class="investment-history-cell investment-history-cell-right ${txn.rowRealizedPnl === null ? '' : (txn.rowRealizedPnl >= 0 ? 'investment-holdings-value-positive' : 'investment-holdings-value-negative')}">${txn.rowRealizedPnl === null ? '-' : formatAmountWithCurrency(txn.rowRealizedPnl, formatTransactionCurrency(txn), { showUsdSymbol: false })}</td>
            </tr>
        `).join('') : `
            <tr>
                <td colspan="9" class="investment-history-empty-cell">No ticker-linked transactions are available for this stock.</td>
            </tr>
        `;
        investmentStockDetailsPanel.innerHTML = `
            <div class="investment-stock-details-overview">
                <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-stock-details-identity">
                    <div class="ticker-identity-row">
                        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" class="ticker-identity-logo" loading="lazy" decoding="async" data-investment-logo-image>` : ``}
                        <span class="ticker-identity-copy">
                            <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(activeTicker)}</span>
                            <span class="suggestion-name ticker-identity-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                        </span>
                    </div>
                </div>
                <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid investment-stock-details-metrics">
                    ${stockMetricCards.map((metric) => `
                        <div class="trade-metric-card trade-metric-card--value-align-end investment-stock-details-metric-card${metric.cardClass ? ` ${metric.cardClass}` : ''}">
                            <span class="trade-metric-label">${metric.label}</span>
                            <span class="trade-metric-value investment-stock-details-metric-value${metric.valueClass ? ` ${metric.valueClass}` : ''}">${metric.value}</span>
                            ${Array.isArray(metric.details) && metric.details.length ? `
                                <div class="investment-stock-details-metric-breakdown">
                                    ${metric.details.map((detail) => `
                                        <div class="investment-stock-details-metric-breakdown-row">
                                            <span class="investment-stock-details-metric-breakdown-label">${detail.label}</span>
                                            <span class="investment-stock-details-metric-breakdown-value${detail.valueClass ? ` ${detail.valueClass}` : ''}">${detail.value}</span>
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
                        <thead>
                        <tr>
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
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
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

    function getVisibleInvestmentHistoryTransactions(processedTransactions = [], chartPoints = []) {
        const normalizedTransactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const normalizedChartPoints = Array.isArray(chartPoints) ? chartPoints : [];
        const visibleRangeLabels = new Set(getInvestmentEquityRangeLabels(
            normalizedChartPoints.map((point) => point?.date),
            selectedInvestmentEquityRange,
        ));
        if (!visibleRangeLabels.size) {
            return normalizedTransactions;
        }
        return normalizedTransactions.filter((txn) => visibleRangeLabels.has(normalizeLedgerDate(txn?.date)));
    }

    function renderInvestmentHistoryTableRows(processedTransactions = [], chartPoints = []) {
        const tbody = document.getElementById('investment_history');
        if (!(tbody instanceof HTMLElement)) return;
        clearInvestmentHistoryHighlights();
        const visibleTransactions = getVisibleInvestmentHistoryTransactions(processedTransactions, chartPoints);
        if (!visibleTransactions.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="investment-history-empty-cell">No transactions fall within the selected range.</td>
                </tr>
            `;
            attachHistoryTableAlignmentSync(historyTable);
            return;
        }
        tbody.innerHTML = [...visibleTransactions].reverse().map((txn) => {
            const description = formatTransactionDescription(txn);
            return `
            <tr id="investment_history_row_${txn.ledger_no}" data-investment-history-row="${txn.ledger_no}" data-investment-history-date="${escapeHtml(String(txn.date || '').slice(0, 10))}" data-investment-history-ticker="${escapeHtml(String(txn.ticker || '').trim().toUpperCase())}">
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${description}</td>
                <td class="investment-history-cell investment-history-cell-center">${formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.display_amount)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatTransactionCommissionDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.market_value)}</td>
                <td class="investment-history-cell investment-history-cell-right">${formatAmount(txn.running_cash)}</td>
                <td class="investment-history-cell investment-history-cell-right investment-history-cell-emphasis"><strong>${formatAmount(txn.total_equity)}</strong></td>
            </tr>
            `;
        }).join('');
        bindInvestmentHistoryChartInteractions(tbody);
        attachHistoryTableAlignmentSync(historyTable);
    }

    async function renderTransactionTable(transactions) {
        const tbody = document.getElementById('investment_history');
        if (!tbody) return { isDegraded: false, message: '' };
        clearInvestmentHistoryHighlights();
        syncInvestmentHistoryHeading();

        if (!transactions.length) {
            setInvestmentExportButtonVisibility(false);
            syncHoldingsChartHoverState('', 0);
            resetInvestmentDashboard();
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="investment-history-empty-cell">
                        <div class="investment-history-empty-state" role="status" aria-live="polite">
                            <p class="investment-history-empty-title"><strong>Import your IBKR files to begin.</strong></p>
                            <p class="investment-history-empty-step">➊ Click <span class="investment-inline-plus-icon" aria-hidden="true"></span> above to open the import panel.</p>
                            <p class="investment-history-empty-step">➋ Upload your Transaction History CSV and Realized Summary CSV.</p>
                            <p class="investment-history-empty-step">➌ Click Import now to rebuild this ledger and load the latest view.</p>
                        </div>
                    </td>
                </tr>
            `;
            attachHistoryTableAlignmentSync(historyTable);
            return { isDegraded: false, message: '' };
        }

        setInvestmentExportButtonVisibility(true);

        // 1. Sort by date ascending to calculate running cash and holdings
        // Read starting_cash from top-level JSON if available, otherwise default to 0
        let runningCash = getInvestmentStartingCash();
        const holdings = {}; // {ticker: quantity}
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const moneyMarketAnchors = {}; // {ticker: weightedAveragePrice}
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const priceHistoryFailures = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_failures || [];
        const tickerClosePrices = normalizePriceHistoryPayload(priceHistoryRows);
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const lastKnownTickerPrices = {};

        const orderedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
        const processed = orderedTransactions.map((txn, processedIndex) => {
            // ========== COMPLETELY COMPATIBLE FIELD READING ==========
            // 1. Quantity: for holdings and description
            let qty = getTransactionQuantity(txn);

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
            if (txn.ticker && qty !== null && !isNaN(qty)) {
                const normalizedTicker = String(txn.ticker).trim().toUpperCase();
                if (!isForexPairTicker(normalizedTicker)) {
                    if (!holdings[txn.ticker]) holdings[txn.ticker] = 0;
                    const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                    if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) {
                        if (isMoneyMarketTicker && price !== null && !Number.isNaN(price)) {
                            const previousQuantity = holdings[txn.ticker];
                            const previousAnchor = moneyMarketAnchors[txn.ticker] ?? price;
                            const nextQuantity = previousQuantity + qty;
                            moneyMarketAnchors[txn.ticker] = nextQuantity > 0
                                ? (((previousQuantity * previousAnchor) + (qty * price)) / nextQuantity)
                                : price;
                        }
                        holdings[txn.ticker] += qty;
                    } else if (['sell'].includes(normalizedType)) {
                        holdings[txn.ticker] -= qty;
                        if (isMoneyMarketTicker && holdings[txn.ticker] > 0 && price !== null && !Number.isNaN(price)) {
                            moneyMarketAnchors[txn.ticker] = moneyMarketAnchors[txn.ticker] ?? price;
                        }
                        if (holdings[txn.ticker] <= 0) {
                            delete moneyMarketAnchors[txn.ticker];
                        }
                        if (Math.abs(holdings[txn.ticker]) < 1e-9) {
                            delete holdings[txn.ticker];
                        }
                    }
                }
            }

            if (shouldTrackHoldingTicker(txn) && price !== null && Number.isFinite(price) && price > 0) {
                lastKnownTickerPrices[String(txn.ticker).trim().toUpperCase()] = price;
            }

            // Calculate cash impact based on transaction type

            // For IBKR imported format (txn.normalized exists), net_amount already includes commission
            // and is already correctly signed: -ve = cash out, +ve = cash in. Just add directly.
            if (txn.normalized !== undefined) {
                runningCash += amount;
            } else if (['forex_trade', 'adjustment', 'fx_translation_pnl'].includes(normalizedType)) {
                // Adjustment can be any direction - use the amount sign directly
                runningCash += amount;
            } else if (normalizedType === 'deposit' || normalizedType === 'sell' || normalizedType === 'dividend' || 
                normalizedType === 'credit_interest' || normalizedType === 'payment_in_lieu') {
                // Cash in: these transactions add cash to your account
                // For manually added transactions where commission is separate
                if (normalizedType === 'sell' && amount && commission) {
                    runningCash += (amount - commission);
                } else {
                    runningCash += amount;
                }
            } else if (normalizedType === 'withdrawal' || normalizedType === 'buy' || normalizedType === 'dividend_reinvestment' || 
                       normalizedType === 'foreign_tax_withholding' || normalizedType === 'debit_interest') {
                // Cash out: these transactions remove cash from your account
                // For manually added transactions
                if (amount !== 0) {
                    runningCash += amount;
                }
            }

            // For buy/sell we already accounted for commission above
            // Only subtract commission for other types
            // For IBKR imported format (normalized), commission is already included in net_amount
            // Only subtract commission for manually added transactions where commission is separate
            const isImported = txn.normalized !== undefined;
            if (!isImported && commission && !['buy', 'sell'].includes(normalizedType)) {
                runningCash -= Math.abs(commission);
            }
            return {
                ...txn,
                ledger_no: processedIndex + 1,
                running_cash: runningCash,
                display_amount: getTransactionEconomicAmount(txn),
                holdings: { ...holdings },
                money_market_anchors: { ...moneyMarketAnchors },
            };
        });

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

        // 2. For each transaction, get the closest available close price on or before the transaction date
        //    and calculate total equity = cash + sum(holdings * historical close price)
        const fallbackTickers = new Set();
        const missingTickers = new Set();
        processed.forEach((txn) => {
            let marketValue = 0;
            Object.entries(txn.holdings).forEach(([ticker, quantity]) => {
                const normalizedTicker = String(ticker).trim().toUpperCase();
                if (isForexPairTicker(normalizedTicker)) return;
                const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);
                const valuationDate = normalizeLedgerDate(txn.date);
                let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const sameDaySellPrice = normalizedTicker === String(txn.ticker || '').trim().toUpperCase()
                        && getNormalizedTransactionType(txn) === 'sell'
                        ? getTransactionPrice(txn)
                        : null;
                    const anchoredPrice = txn.money_market_anchors?.[ticker] ?? txn.money_market_anchors?.[normalizedTicker];
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
                marketValue += quantity * closePrice;
            });
            txn.market_value = marketValue;
            txn.total_equity = txn.running_cash + marketValue;
        });

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
        const chartPoints = buildDailyEquityChartPoints(processed, tickerClosePrices, moneyMarketTickers);
        const valuationStatus = buildValuationStatus({
            backendFailures: priceHistoryFailures,
            fallbackTickers: Array.from(fallbackTickers),
            missingTickers: Array.from(missingTickers),
        });

        // 3. Render reverse chronological rows constrained by the active equity range
        renderInvestmentHistoryTableRows(processed, chartPoints);

        // 4. Update dashboard with latest total equity
        updateDashboardWithEquity(processed, latestSnapshot, latestPrices, transactions, chartPoints);
        return valuationStatus;
    }

    function updateDashboardWithEquity(processed, latestSnapshot, latestPrices, rawTransactions, chartPoints = []) {
        const last = latestSnapshot || processed[processed.length - 1];
        if (!last) return;
        const TOTAL_EQUITY = getLatestDashboardEquity(processed, chartPoints);

        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!holdingsPanel || !metricsPanel || !(investmentStockDetailsPanel instanceof HTMLElement)) return;
        const shouldAnimateVisibleMetricsPanel = activeInvestmentView === 'holdings' || activeInvestmentView === 'metrics' || activeInvestmentView === 'stock_details';
        if (shouldAnimateVisibleMetricsPanel) {
            lockInvestmentSurfaceHeight();
        }
        setInvestmentSharedChartDateRange(chartPoints);

        const tickerProfiles = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_profiles || {};
        investmentDummyTickerProfiles = tickerProfiles;
        const tickerSummaries = buildTickerSummaries(rawTransactions, latestPrices, TOTAL_EQUITY);
        const fundingMetrics = getUsdFundingMetrics(rawTransactions);
        const holdingsSummaryMetrics = getHoldingsSummaryMetrics(rawTransactions, latestPrices, TOTAL_EQUITY);
        investmentProcessedTransactionsCache = Array.isArray(processed) ? [...processed] : [];
        investmentTickerSummariesCache = Array.isArray(tickerSummaries) ? [...tickerSummaries] : [];
        syncHoldingsChartHoverState('', 0);
        holdingsPanel.innerHTML = renderHoldingsTable(tickerSummaries, tickerProfiles, TOTAL_EQUITY);
        attachHoldingsTableAlignmentSync(holdingsPanel);
        bindHoldingsLogoFallbacks(holdingsPanel);
        bindHoldingsHistoryInteractions(holdingsPanel);
        bindHoldingsStockDetailsLinks(holdingsPanel);
        renderInvestmentStockDetailsPanel(tickerProfiles);
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length ? chartPoints[chartPoints.length - 1] : null;
        renderInvestmentDummyPortfolioDonut(latestChartPoint || {
            running_cash: Number(last?.running_cash) || 0,
            total_equity: Number(last?.total_equity) || Number(last?.running_cash) || 0,
            holdings_market_values: {},
        }, tickerProfiles);

        metricsPanel.innerHTML = renderFundingMetricCards(fundingMetrics, holdingsSummaryMetrics);
        bindInvestmentMetricTooltipInteractions(metricsPanel);
        if (shouldAnimateVisibleMetricsPanel) {
            animateInvestmentSurfaceHeight();
        }
        renderEquityChartWithEquity(chartPoints);
        syncInvestmentDummyDonutFromInteraction();
        syncInvestmentStockDetailsDonutFromInteraction();
    }

    // Reuse the same chart styling from the backtest page
    function renderEquityChartWithEquity(chartPoints) {
        if (!chartPoints.length || !window.Chart) {
            clearInvestmentEquityRangeControlBindings();
            if (investmentEquityChartInstance) {
                investmentEquityChartInstance.destroy();
                investmentEquityChartInstance = null;
            }
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
            setInvestmentChartReady(false);
            console.warn('Chart container not found');
            return;
        }

        clearInvestmentEquityRangeControlBindings();
        container.innerHTML = `${renderInvestmentEquityRangeControl()}<canvas id="investmentEquityChart"></canvas>`;
        const canvas = document.getElementById('investmentEquityChart');
        const existingChart = window.Chart.getChart?.(canvas);
        if (existingChart) existingChart.destroy();
        if (investmentEquityChartInstance) {
            investmentEquityChartInstance.destroy();
            investmentEquityChartInstance = null;
        }
        setInvestmentChartReady(false, canvas);

        const sortedChartPoints = [...chartPoints].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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
        const visiblePoints = visibleChartPointEntries.length
            ? visibleChartPointEntries
            : sortedChartPoints.map((point, sourceIndex) => ({ point, sourceIndex }));
        const visibleChartPoints = visiblePoints.map(({ point }) => point);
        const visiblePointSourceIndexes = visiblePoints.map(({ sourceIndex }) => sourceIndex);
        const rawDates = visibleChartPoints.map((point) => point.date);
        const equity = visibleChartPoints.map((point) => point.total_equity);
        const visibleChartPointIndexByLedgerNo = new Map();
        visibleChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                visibleChartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        investmentChartPointsCache = sortedChartPoints;
        investmentChartPointIndexByLedgerNo = fullChartPointIndexByLedgerNo;
        investmentLatestChartPoint = sortedChartPoints[sortedChartPoints.length - 1] || null;
        activeChartTooltipPointIndex = -1;

        // Read theme tokens
        const resolvedTheme = resolveInvestmentTheme();
        const equitySeriesColor = resolvedTheme.accentPrimary;

        const labels = [...rawDates];
        const fixedYAxisWidth = 52;
        let activeChartHoverDate = "";

        const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

        const parseRawDate = (value) => {
            if (typeof value !== "string") return null;
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return null;
            return {
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
            };
        };

        const formatRawDate = (date) => {
            const year = date.getFullYear();
            const month = `${date.getMonth() + 1}`.padStart(2, "0");
            const day = `${date.getDate()}`.padStart(2, "0");
            return `${year}-${month}-${day}`;
        };

        const formatChartDateLines = (dateParts) => formatInvestmentFullDateLines(dateParts, { allowWrap: true });

        const buildTickIndexSet = (count, plotWidth) => {
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
        };

        const collectFiniteValues = (datasets) => {
            if (!Array.isArray(datasets)) return [];
            return datasets.flatMap((dataset) => (Array.isArray(dataset) ? dataset : []))
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value));
        };

        const buildPixelPaddedYScale = (canvas, datasets, paddingPx) => {
            const values = collectFiniteValues(datasets);
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
        };

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
                const pointIndex = visibleChartPointIndexByLedgerNo.get(ledgerNo);
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

        const xAxisLabelPlugin = {
            id: "investmentXAxisLabelPlugin",
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = '700 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
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
        const equityYScale = buildPixelPaddedYScale(canvas, [equity], chartYPaddingPx);
        const getOrCreateTooltip = (chart) => {
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

        const formatTooltipDate = (dateParts) => formatInvestmentFullDateParts(dateParts);

        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip(chart);
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
            const parsedDate = parseRawDate(rawDates[pointIndex]);
            const pointRecord = visibleChartPoints[pointIndex];
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
                const pnlVsPreviousTradingDay = previousTradingPoint
                    ? (Number(pointRecord?.total_equity) || 0) - (Number(previousTradingPoint?.total_equity) || 0) - transferSincePreviousTradingDay
                    : null;
                const cashInAmount = Number(pointRecord?.cash_in_amount);
                const cashOutAmount = Number(pointRecord?.cash_out_amount);
                tooltipRows.push({
                    label: "Equity",
                    formattedValue: formatMoney(pointRecord.total_equity),
                    color: equitySeriesColor,
                });
                tooltipRows.push({
                    label: "Market value",
                    formattedValue: formatMoney(pointRecord.market_value),
                    color: resolvedTheme.accentSecondary,
                });
                tooltipRows.push({
                    label: "Cash",
                    formattedValue: formatMoney(pointRecord.running_cash),
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

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: holdingsMarkerSafePadding,
                    right: holdingsMarkerSafePadding,
                    top: 44,
                    bottom: 24,
                },
            },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false, external: externalTooltipHandler },
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
                            if (index === 0 || index === ticks.length - 1) return "";
                            return typeof this.getLabelForValue === "function" ? this.getLabelForValue(value) : String(value);
                        },
                    },
                },
            },
        };

        investmentEquityChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels,
                rawLabels: rawDates,
                datasets: [
                    {
                        label: "Equity",
                        data: equity,
                        borderColor: equitySeriesColor,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        tension: 0,
                        borderJoinStyle: "round",
                        borderCapStyle: "round",
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
            plugins: [hoverGuidePlugin, holdingsHoverMarkerPlugin, xAxisLabelPlugin],
        });
        if (activeHoldingsHoverLedgerNo > 0) {
            investmentEquityChartInstance.update('none');
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (canvas.dataset.investmentChartReady === '1') return;
                setInvestmentChartReady(true, canvas);
            });
        });
        bindInvestmentEquityRangeControls(sortedChartPoints);
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
        if (Math.abs(numericValue) < 1e-9) return formatAmountWithCurrency(0, currency);
        return formatAmountWithCurrency(-Math.abs(numericValue), currency);
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
        const tickerSummaries = buildTickerSummaries(safeTransactions, safeLatestPrices, TOTAL_EQUITY);
        const totalRealizedPnl = tickerSummaries.reduce((sum, summary) => sum + (Number(summary.realizedPnl) || 0), 0);
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
            .sort((left, right) => {
                const leftDate = new Date(left.txn?.date || 0).getTime();
                const rightDate = new Date(right.txn?.date || 0).getTime();
                if (leftDate !== rightDate) return leftDate - rightDate;
                const leftRow = Number(left.txn?.source?.row_number ?? left.index);
                const rightRow = Number(right.txn?.source?.row_number ?? right.index);
                return leftRow - rightRow;
            })
            .map(({ txn }, sortedIndex) => ({
                txn,
                ledgerNo: sortedIndex + 1,
            }));
        const realizedPnlRows = [];
        const unrealizedPnlRows = [];

        sortedTransactions.forEach(({ txn, ledgerNo }) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            realizedPnlRows.push(ledgerNo);
            const normalizedTicker = normalizeInvestmentTicker(txn?.ticker);
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

    function renderMetricValueWithTooltip(metric) {
        const sortedLedgerEntries = Array.isArray(window.ANTIGRAVITY_INVESTMENT_DATA?.transactions)
            ? [...window.ANTIGRAVITY_INVESTMENT_DATA.transactions]
                .sort((left, right) => {
                    const leftDate = new Date(left?.date || 0).getTime();
                    const rightDate = new Date(right?.date || 0).getTime();
                    if (leftDate !== rightDate) return leftDate - rightDate;
                    const leftRow = Number(left?.source?.row_number ?? 0);
                    const rightRow = Number(right?.source?.row_number ?? 0);
                    return leftRow - rightRow;
                })
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
                <span class="investment-metric-tooltip-value-copy${valueClass ? ` ${valueClass}` : ''}">${metric?.value || '--'}</span>
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
