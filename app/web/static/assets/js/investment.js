/**
 * Investment workspace composition entry.
 *
 * Code version: v2.144.0
 * - Refactored: Feature runtimes are composed from bounded, versioned modules.
 * Historical changes are recorded in docs/INVESTMENT_FRONTEND_CHANGELOG.md.
 */

import {createInvestmentBindingPaginationRuntime} from './investment/runtime/binding-pagination.js?v=investment-binding-pagination-v1.0.0';
import {createInvestmentRuntimeConfig} from './investment/runtime/config.js?v=investment-runtime-config-v1.0.0';
import {createInvestmentEquityChartRuntime} from './investment/runtime/equity-chart.js?v=investment-equity-chart-v1.0.0';
import {createInvestmentExportHistoryRuntime} from './investment/runtime/export-history.js?v=investment-export-history-v1.0.0';
import {createInvestmentFundingMetricsRuntime} from './investment/runtime/funding-metrics.js?v=investment-funding-metrics-v1.0.0';
import {createInvestmentHistoryPaginationRuntime} from './investment/runtime/history-pagination.js?v=investment-history-pagination-v1.0.0';
import {createInvestmentHoldingsLiveRuntime} from './investment/runtime/holdings-live.js?v=investment-holdings-live-v1.0.0';
import {createInvestmentHoldingsWorkspaceRuntime} from './investment/runtime/holdings-workspace.js?v=investment-holdings-workspace-v1.0.0';
import {createInvestmentImportWorkflowRuntime} from './investment/runtime/import-workflows.js?v=investment-import-workflows-v1.0.0';
import {createInvestmentMetricsImportRuntime} from './investment/runtime/metrics-import.js?v=investment-metrics-import-v1.0.0';
import {createInvestmentRangeTransferRuntime} from './investment/runtime/range-transfer.js?v=investment-range-transfer-v1.0.0';
import {createInvestmentRealtimeChartRuntime} from './investment/runtime/realtime-chart.js?v=investment-realtime-chart-v1.0.0';
import {createInvestmentShareLinkedHoverRuntime} from './investment/runtime/share-linked-hover.js?v=investment-share-linked-hover-v1.0.0';
import {createInvestmentStockHistoryFilterRuntime} from './investment/runtime/stock-history-filters.js?v=investment-stock-history-filters-v1.0.0';
import {createInvestmentTransactionTableRuntime} from './investment/runtime/transaction-table.js?v=investment-transaction-table-runtime-v1.0.0';
import {createInvestmentWorkspaceControlsRuntime} from './investment/runtime/workspace-controls.js?v=investment-workspace-controls-v1.0.0';

import {
    INVESTMENT_CHART_ORBIT_MODULE_VERSION,
    getInvestmentDonutOrbitAnimationState,
    getPortfolioDonutOrbitMetrics,
    registerInvestmentChartHelpers,
    renderInvestmentDonutOrbitLogoPosition,
    syncInvestmentDonutOrbitLogos,
} from './investment/chart-orbit.js?v=investment-chart-orbit-v1.39.0';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    getInvestmentAggregatePnlCoverage,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    classifyInvestmentUsRealtimeSession,
    createInvestmentDataUtils,
    filterAggregateOnlyOverlayTransactions,
    isCompleteHsbcStatementPdfBundle,
    isHsbcSettlementActuallyPending,
    isRealtimeQuotePulseProviderEligible,
    parseInvestmentOptionalNumber,
    resolveRealtimeQuoteSource,
} from './investment/data-utils.js?v=investment-data-utils-v1.114.1';
import {
    INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
    buildHsbcImportFeedbackMessage,
    buildIbkrImportFeedbackMessage,
    buildSchwabImportFeedbackMessage,
    countNewInvestmentPendingTransferRows,
    getInvestmentPendingTransferSourceKeys,
    resolveInvestmentImportFeedbackSummary,
} from './investment/import-feedback.js?v=investment-import-feedback-v1.10.0';
import {
    INVESTMENT_PAGINATION_MODULE_VERSION,
    animateLocalStorePaginationIndicator,
    bindLocalStorePagination,
    buildInvestmentHistoryPagination,
    positionLocalStorePaginationIndicator,
    renderLocalStorePagination,
} from './investment/pagination.js?v=investment-pagination-v1.4.1';
import {
    INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
    buildInvestmentIntradayDayBoundaries as buildInvestmentIntradayDayBoundariesCore,
    buildInvestmentIntradayDayFallbackIndex as buildInvestmentIntradayDayFallbackIndexCore,
    createInvestmentStockDetailsUtils,
    drawInvestmentYAxisValueBadge,
    getInvestmentTradeSessionType as getInvestmentTradeSessionTypeCore,
    getInvestmentStockDetailsAveragePriceLabel,
    isInvestmentTransactionDateOnly,
    isInvestmentStockDetailsIntradayRange as isInvestmentStockDetailsIntradayRangeCore,
    normalizeInvestmentStockDetailsIntradayRows,
    normalizeInvestmentIntradayMinuteKey,
    normalizeInvestmentRange,
} from './investment/stock-details.js?v=investment-stock-details-v0.34.3';
import {
    INVESTMENT_REALTIME_MODULE_VERSION,
    createInvestmentLiveValueAnimator,
    createInvestmentRealtimeQuotePoller,
} from './investment/realtime.js?v=investment-realtime-v1.3.3';
import {
    INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION,
    buildInvestmentBrokerFilterIndex,
    getAvailableInvestmentCurrencyCodes as getAvailableInvestmentCurrencyCodesFromRows,
    hasInvestmentUnboundTransactions,
    isInvestmentBrokerFilterAllSelected,
    matchesInvestmentCurrencyFilter as matchesInvestmentCurrencyFilterValue,
    matchesInvestmentDateFilter,
    normalizeInvestmentBroker,
    normalizeInvestmentDescriptionBindingFilter as normalizeInvestmentDescriptionBindingFilterValue,
    normalizeInvestmentCurrencyFilter as normalizeInvestmentCurrencyFilterValue,
    selectInvestmentBrokerCurrencyRows,
    selectInvestmentDescriptionBindingRows,
    sortInvestmentBrokerFilterCodes as sortInvestmentBrokerFilterCodesCore,
} from './investment/transaction-filters.js?v=investment-transaction-filters-v1.3.0';
import {
    INVESTMENT_LAYOUT_MODULE_VERSION,
    bindInvestmentSectionResizer,
} from './investment/layout.js?v=investment-layout-v1.4.0';
import {
    INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION,
    INVESTMENT_HISTORY_PAGE_SIZE,
    buildInvestmentHistoryPage,
    getInvestmentHistoryPageForLedgerNos as getInvestmentHistoryPageForLedgerNosCore,
    getInvestmentHistoryTotalPages,
    isInvestmentHistoryDisplayHidden,
    selectVisibleInvestmentHistoryTransactions,
} from './investment/transaction-table.js?v=investment-transaction-table-v1.0.2';
import {
    INVESTMENT_URL_STATE_MODULE_VERSION,
    buildInvestmentUrl,
    parseInvestmentUrlState,
} from './investment/url-state.js?v=investment-url-state-v1.2.0';
import {
    NUMERIC_DISPLAY_MODULE_VERSION,
    getNumericDisplayParts,
    renderNumericDisplayContent as renderWorkspaceMetricValueContent,
} from './numeric-display.js?v=numeric-display-v1.1.0';

const chartAxis = window.WORTHWARD_CHART_AXIS || {};
const preferenceStorage = window.WORTHWARD_STORAGE || {local: window.localStorage};

window.WORTHWARD_INVESTMENT_MODULE_VERSIONS = Object.freeze({
    entry: 'v2.144.0',
    chartOrbit: INVESTMENT_CHART_ORBIT_MODULE_VERSION,
    dataUtils: INVESTMENT_DATA_UTILS_MODULE_VERSION,
    importFeedback: INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
    layout: INVESTMENT_LAYOUT_MODULE_VERSION,
    pagination: INVESTMENT_PAGINATION_MODULE_VERSION,
    realtime: INVESTMENT_REALTIME_MODULE_VERSION,
    numericDisplay: NUMERIC_DISPLAY_MODULE_VERSION,
    stockDetails: INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
    transactionFilters: INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION,
    transactionTable: INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION,
    urlState: INVESTMENT_URL_STATE_MODULE_VERSION,
});

registerInvestmentChartHelpers(window);

document.addEventListener('DOMContentLoaded', () => {
    const runtime = {state: {}};
    Object.assign(runtime, {
        createInvestmentBindingPaginationRuntime,
        createInvestmentRuntimeConfig,
        createInvestmentEquityChartRuntime,
        createInvestmentExportHistoryRuntime,
        createInvestmentFundingMetricsRuntime,
        createInvestmentHistoryPaginationRuntime,
        createInvestmentHoldingsLiveRuntime,
        createInvestmentHoldingsWorkspaceRuntime,
        createInvestmentImportWorkflowRuntime,
        createInvestmentMetricsImportRuntime,
        createInvestmentRangeTransferRuntime,
        createInvestmentRealtimeChartRuntime,
        createInvestmentShareLinkedHoverRuntime,
        createInvestmentStockHistoryFilterRuntime,
        createInvestmentTransactionTableRuntime,
        createInvestmentWorkspaceControlsRuntime,
        INVESTMENT_CHART_ORBIT_MODULE_VERSION,
        getInvestmentDonutOrbitAnimationState,
        getPortfolioDonutOrbitMetrics,
        registerInvestmentChartHelpers,
        renderInvestmentDonutOrbitLogoPosition,
        syncInvestmentDonutOrbitLogos,
        INVESTMENT_DATA_UTILS_MODULE_VERSION,
        getInvestmentAggregatePnlCoverage,
        INVESTMENT_REPLAY_ORDER_SYMBOL,
        applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
        classifyInvestmentUsRealtimeSession,
        createInvestmentDataUtils,
        filterAggregateOnlyOverlayTransactions,
        isCompleteHsbcStatementPdfBundle,
        isHsbcSettlementActuallyPending,
        isRealtimeQuotePulseProviderEligible,
        parseInvestmentOptionalNumber,
        resolveRealtimeQuoteSource,
        INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
        buildHsbcImportFeedbackMessage,
        buildIbkrImportFeedbackMessage,
        buildSchwabImportFeedbackMessage,
        countNewInvestmentPendingTransferRows,
        getInvestmentPendingTransferSourceKeys,
        resolveInvestmentImportFeedbackSummary,
        INVESTMENT_PAGINATION_MODULE_VERSION,
        animateLocalStorePaginationIndicator,
        bindLocalStorePagination,
        buildInvestmentHistoryPagination,
        positionLocalStorePaginationIndicator,
        renderLocalStorePagination,
        INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
        buildInvestmentIntradayDayBoundariesCore,
        buildInvestmentIntradayDayFallbackIndexCore,
        createInvestmentStockDetailsUtils,
        drawInvestmentYAxisValueBadge,
        getInvestmentTradeSessionTypeCore,
        getInvestmentStockDetailsAveragePriceLabel,
        isInvestmentTransactionDateOnly,
        isInvestmentStockDetailsIntradayRangeCore,
        normalizeInvestmentStockDetailsIntradayRows,
        normalizeInvestmentIntradayMinuteKey,
        normalizeInvestmentRange,
        INVESTMENT_REALTIME_MODULE_VERSION,
        createInvestmentLiveValueAnimator,
        createInvestmentRealtimeQuotePoller,
        INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION,
        buildInvestmentBrokerFilterIndex,
        getAvailableInvestmentCurrencyCodesFromRows,
        hasInvestmentUnboundTransactions,
        isInvestmentBrokerFilterAllSelected,
        matchesInvestmentCurrencyFilterValue,
        matchesInvestmentDateFilter,
        normalizeInvestmentBroker,
        normalizeInvestmentDescriptionBindingFilterValue,
        normalizeInvestmentCurrencyFilterValue,
        selectInvestmentBrokerCurrencyRows,
        selectInvestmentDescriptionBindingRows,
        sortInvestmentBrokerFilterCodesCore,
        INVESTMENT_LAYOUT_MODULE_VERSION,
        bindInvestmentSectionResizer,
        INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION,
        INVESTMENT_HISTORY_PAGE_SIZE,
        buildInvestmentHistoryPage,
        getInvestmentHistoryPageForLedgerNosCore,
        getInvestmentHistoryTotalPages,
        isInvestmentHistoryDisplayHidden,
        selectVisibleInvestmentHistoryTransactions,
        INVESTMENT_URL_STATE_MODULE_VERSION,
        buildInvestmentUrl,
        parseInvestmentUrlState,
        NUMERIC_DISPLAY_MODULE_VERSION,
        getNumericDisplayParts,
        renderWorkspaceMetricValueContent,
        chartAxis,
        preferenceStorage,
    });

    runtime.theme = window.WORTHWARD_APP?.theme || {};
    runtime.fetchAbortDebugConfig = window.WORTHWARD_APP?.debug?.fetchAbort || null;
    runtime.reportInvestmentFetchAbortDebug = (hypothesisId, location, msg, data = {}, runId = 'post-fix') => {
        // #region debug-point C:investment-fetch-abort
        if (!runtime.fetchAbortDebugConfig?.url) return;
        fetch(runtime.fetchAbortDebugConfig.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: runtime.fetchAbortDebugConfig.sessionId || 'frontend-fetch-aborts',
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
    runtime.resolveInvestmentTheme = () => {
        const computed = getComputedStyle(document.body);
        const themeTextColor = String(runtime.theme?.text || '').trim();
        const themeMutedColor = String(runtime.theme?.muted || '').trim();
        const themePrimaryColor = String(runtime.theme?.accent_primary || '').trim();
        const themeSecondaryColor = String(runtime.theme?.accent_secondary || '').trim();
        const themePositiveColor = String(runtime.theme?.accent_positive || '').trim();
        return {
            text: computed.getPropertyValue("--theme-text").trim() || themeTextColor,
            muted: computed.getPropertyValue("--theme-muted").trim() || themeMutedColor,
            mutedSoft: computed.getPropertyValue("--theme-muted-soft").trim() || themeMutedColor,
            accentPrimary: computed.getPropertyValue("--theme-accent-primary").trim() || themePrimaryColor,
            accentSecondary: computed.getPropertyValue("--theme-accent-secondary").trim() || themeSecondaryColor,
            accentPositive: computed.getPropertyValue("--theme-accent-positive").trim() || themePositiveColor,
        };
    };

    runtime.toggleBtn = document.getElementById('toggle_form_button');
    runtime.investmentImportCloseButton = document.getElementById('investment_import_close_button');
    runtime.sidebarToggle = document.getElementById('sidebar_toggle');
    runtime.sidebarDock = document.querySelector('.sidebar-dock');
    runtime.globalQuickActions = document.getElementById('global_quick_actions');
    runtime.formContainer = document.getElementById('transaction_form_container');
    runtime.historyTable = document.getElementById('history_table_wrap');
    runtime.investmentHistorySurface = document.getElementById('investment_history_surface');
    runtime.investmentWorkspaceHeader = document.querySelector('.investment-workspace-header');
    runtime.investmentReportCard = runtime.investmentWorkspaceHeader?.querySelector(':scope > .investment-report-card');
    runtime.investmentSectionResizer = document.getElementById('investment_section_resizer');
    runtime.investmentForm = document.getElementById('investment_form');
    runtime.importFeedback = document.getElementById('investment_import_feedback');
    runtime.importFeedbackMessage = document.getElementById('investment_import_feedback_message');
    runtime.importFeedbackIcon = document.getElementById('investment_import_feedback_icon');
    // A fixed descendant cannot escape the report card's stacking context.
    // Keep global import feedback at the document root so modal errors remain visible.
    if (runtime.importFeedback && runtime.importFeedback.parentElement !== document.body) {
        document.body.append(runtime.importFeedback);
    }
    runtime.workspaceModalOverlay = document.getElementById('workspace_modal_overlay');
    runtime.workspaceModalOverlayTitle = runtime.workspaceModalOverlay?.querySelector('.workspace-modal-title');
    runtime.workspaceModalOverlayCopy = runtime.workspaceModalOverlay?.querySelector('.workspace-modal-copy');
    runtime.workspaceModalOverlayIcon = document.getElementById('workspace_modal_overlay_icon');
    runtime.workspaceModalOverlayClose = document.getElementById('workspace_modal_overlay_close');
    runtime.transactionsCsvInput = document.getElementById('transactions_csv');
    runtime.positionsCsvInput = document.getElementById('positions_csv');
    runtime.gainskeeperFilesInput = document.getElementById('gainskeeper_files');
    runtime.gainskeeperFilesStatus = document.getElementById('gainskeeper_files_status');
    runtime.ibkrTradeNotificationsTextInput = document.getElementById('ibkr_trade_notifications_text');
    runtime.ibkrTradeNotificationsDateInput = document.getElementById('ibkr_trade_notifications_date');
    runtime.ibkrTradeNotificationsDisplay = document.getElementById('ibkr_trade_notifications_display');
    runtime.ibkrTradeNotificationsPasteButton = document.getElementById('ibkr_trade_notifications_paste_button');
    runtime.ibkrTradeNotificationsTextStatus = document.getElementById('ibkr_trade_notifications_text_status');
    runtime.ibkrHoldingsTextInput = document.getElementById('ibkr_holdings_text');
    runtime.ibkrHoldingsDisplay = document.getElementById('ibkr_holdings_display');
    runtime.ibkrHoldingsPasteButton = document.getElementById('ibkr_holdings_paste_button');
    runtime.ibkrHoldingsTextStatus = document.getElementById('ibkr_holdings_text_status');
    runtime.investmentImportBrokerSelect = document.getElementById('investment_import_broker');
    runtime.transactionsCsvStatus = document.getElementById('transactions_csv_status');
    runtime.positionsCsvStatus = document.getElementById('positions_csv_status');
    runtime.importSubmitButton = document.getElementById('investment_import_submit_button');
    runtime.investmentImportNote = document.getElementById('investment_import_note');
    runtime.investmentImportIbkrFields = document.getElementById('investment_import_ibkr_fields');
    runtime.investmentImportIbkrMode = document.getElementById('investment_import_ibkr_mode');
    runtime.investmentImportLongbridgeHkFields = document.getElementById('investment_import_longbridge_hk_fields');
    runtime.investmentImportLongbridgeSgFields = document.getElementById('investment_import_longbridge_sg_fields');
    runtime.longbridgeSgFundDetailsInput = document.getElementById('longbridge_sg_fund_details_txt');
    runtime.longbridgeSgHistoryOrdersInput = document.getElementById('longbridge_sg_history_orders_xlsx');
    runtime.longbridgeSgFundDetailsStatus = document.getElementById('longbridge_sg_fund_details_txt_status');
    runtime.longbridgeSgHistoryOrdersStatus = document.getElementById('longbridge_sg_history_orders_xlsx_status');
    runtime.longbridgeHkFundDetailsInput = document.getElementById('longbridge_hk_fund_details_txt');
    runtime.longbridgeHkHistoryOrdersInput = document.getElementById('longbridge_hk_history_orders_xlsx');
    runtime.longbridgeHkFundDetailsStatus = document.getElementById('longbridge_hk_fund_details_txt_status');
    runtime.longbridgeHkHistoryOrdersStatus = document.getElementById('longbridge_hk_history_orders_xlsx_status');
    runtime.investmentImportFutuhkFields = document.getElementById('investment_import_futuhk_fields');
    runtime.investmentImportBocHkFields = document.getElementById('investment_import_boc_hk_fields');
    runtime.bocHkStatementPdfsInput = document.getElementById('boc_hk_statement_pdfs');
    runtime.bocHkStatementPdfsStatus = document.getElementById('boc_hk_statement_pdfs_status');
    runtime.investmentImportHsbcFields = document.getElementById('investment_import_hsbc_fields');
    runtime.investmentImportHsbcMode = document.getElementById('investment_import_hsbc_mode');
    runtime.investmentImportSchwabFields = document.getElementById('investment_import_schwab_fields');
    runtime.schwabTransactionsCsvInput = document.getElementById('schwab_transactions_csv');
    runtime.schwabTransactionsCsvStatus = document.getElementById('schwab_transactions_csv_status');
    runtime.schwabPositionsCsvInput = document.getElementById('schwab_positions_csv');
    runtime.schwabPositionsCsvStatus = document.getElementById('schwab_positions_csv_status');
    runtime.investmentImportZirconHkFields = document.getElementById('investment_import_zircon_hk_fields');
    runtime.zirconHkTransactionsXlsxInput = document.getElementById('zircon_hk_transactions_xlsx');
    runtime.zirconHkTransactionsXlsxStatus = document.getElementById('zircon_hk_transactions_xlsx_status');
    runtime.futuhkStatementPdfsInput = document.getElementById('futuhk_statement_pdfs');
    runtime.futuhkStatementPdfsStatus = document.getElementById('futuhk_statement_pdfs_status');
    runtime.investmentImportTigertradeFields = document.getElementById('investment_import_tigertrade_fields');
    runtime.tigertradeStatementPdfsInput = document.getElementById('tigertrade_statement_pdfs');
    runtime.tigertradeStatementPdfsStatus = document.getElementById('tigertrade_statement_pdfs_status');
    runtime.investmentImportUsmartHkFields = document.getElementById('investment_import_usmart_hk_fields');
    runtime.usmartHkStatementPdfsInput = document.getElementById('usmart_hk_statement_pdfs');
    runtime.usmartHkStatementPdfsStatus = document.getElementById('usmart_hk_statement_pdfs_status');
    runtime.longbridgeStartDateInput = null;
    runtime.longbridgeStartDateStatus = null;
    runtime.hsbcPortfolioTextInput = document.getElementById('hsbc_portfolio_text');
    runtime.hsbcOrderStatusTextInput = document.getElementById('hsbc_order_status_text');
    runtime.hsbcCashAccountTextInput = document.getElementById('hsbc_cash_account_text');
    runtime.longbridgeEndDateStatus = null;
    runtime.hsbcPortfolioTextDisplay = document.getElementById('hsbc_portfolio_text_display');
    runtime.hsbcOrderStatusDisplay = document.getElementById('hsbc_order_status_display');
    runtime.hsbcCashAccountDisplay = document.getElementById('hsbc_cash_account_display');
    runtime.hsbcPortfolioTextPasteButton = document.getElementById('hsbc_portfolio_text_paste_button');
    runtime.hsbcOrderStatusPasteButton = document.getElementById('hsbc_order_status_paste_button');
    runtime.hsbcCashAccountPasteButton = document.getElementById('hsbc_cash_account_paste_button');
    runtime.hsbcPortfolioTextClearButton = document.getElementById('hsbc_portfolio_text_clear_button');
    runtime.hsbcOrderStatusTextClearButton = document.getElementById('hsbc_order_status_text_clear_button');
    runtime.hsbcCashAccountTextClearButton = document.getElementById('hsbc_cash_account_clear_button');
    runtime.hsbcPortfolioTextStatus = document.getElementById('hsbc_portfolio_text_status');
    runtime.hsbcOrderStatusTextStatus = document.getElementById('hsbc_order_status_text_status');
    runtime.hsbcCashAccountTextStatus = document.getElementById('hsbc_cash_account_text_status');
    runtime.hsbcStatementPdfsInput = document.getElementById('hsbc_statement_pdfs');
    runtime.hsbcStatementPdfsStatus = document.getElementById('hsbc_statement_pdfs_status');
    runtime.HSBC_PASTE_CHUNK_MARKER = '===== HSBC PASTE CHUNK =====';
    runtime.HSBC_PASTE_VALIDATION_ENDPOINT = '/api/investment/imports/hsbc-paste/validate';
    runtime.HSBC_PASTE_VALIDATION_DEBOUNCE_MS = 140;
    runtime.hsbcPasteButtonFlashTimers = new WeakMap();
    runtime.INVESTMENT_LOADING_MODAL_TITLE = 'Loading investment data';
    runtime.INVESTMENT_LOADING_MODAL_COPY = 'We are reading the locally stored broker activity and rebuilding the holdings, charts, metrics, and transaction history for this page. Please keep this tab open while loading finishes.';
    runtime.INVESTMENT_LOADING_MODAL_ICON_CLASS = 'suggestion-loading-spinner';
    runtime.INVESTMENT_TRANSFER_BINDING_MODAL_TITLE = 'Binding internal transfer';
    runtime.INVESTMENT_TRANSFER_BINDING_MODAL_COPY = 'This is a multi-step operation. It may take up to 10 seconds while the affected transaction history, holdings, and Metrics are rebuilt. Please keep this tab open.';
    runtime.INVESTMENT_SHARE_RENDER_MODAL_TITLE = 'Rendering share image';
    runtime.INVESTMENT_SHARE_RENDER_MODAL_COPY = 'We are rendering the community share card and encoding the PNG export. Please wait until the image finishes saving.';
    runtime.INVESTMENT_SHARE_RENDER_MODAL_ICON_CLASS = 'suggestion-loading-spinner';
    runtime.WORKSPACE_MODAL_DEFAULT_TITLE = String(runtime.workspaceModalOverlayTitle?.textContent || '').trim();
    runtime.WORKSPACE_MODAL_DEFAULT_COPY = String(runtime.workspaceModalOverlayCopy?.textContent || '').trim();
    runtime.WORKSPACE_MODAL_DEFAULT_ICON_CLASS = String(runtime.workspaceModalOverlayIcon?.className || '').trim();
    runtime.state.investmentBootstrapTimer = 0;
    runtime.state.investmentPageDisposed = false;
    runtime.isLifecycleInterruptedFetch = (error) => (
        runtime.state.investmentPageDisposed
        || document.visibilityState === 'hidden'
        || error?.name === 'AbortError'
    );
    runtime.markInvestmentPageDisposed = () => {
        runtime.state.investmentPageDisposed = true;
        runtime.cancelHsbcPasteValidation();
        if (runtime.state.investmentBootstrapTimer) {
            window.clearTimeout(runtime.state.investmentBootstrapTimer);
            runtime.state.investmentBootstrapTimer = 0;
        }
        runtime.stopInvestmentRealtimeQuotePolling();
        runtime.hideInvestmentLoadingModal({ resetContent: true });
    };
    window.addEventListener('pagehide', runtime.markInvestmentPageDisposed, { once: true });
    window.addEventListener('beforeunload', runtime.markInvestmentPageDisposed, { once: true });
    runtime.longbridgeEndDateInput = null;
    runtime.segmentedControl = document.getElementById('investment_view_segmented');
    runtime.investmentViewSurface = document.getElementById('investment_view_surface');
    runtime.investmentViewSurfaceBody = document.getElementById('investment_view_surface_body');
    runtime.investmentBrokerSummarySelector = document.getElementById('investment_broker_summary_selector');
    runtime.investmentDummyChart = document.getElementById('investment_dummy_chart');
    runtime.investmentDummyLogoLayer = document.getElementById('investment_dummy_logo_layer');
    runtime.investmentDummyDonut = document.getElementById('investment_dummy_donut');
    runtime.INVESTMENT_STOCK_DETAILS_PANEL_ID = 'stock_panel';
    runtime.INVESTMENT_STOCK_DETAILS_HASH = '#stock_panel';
    runtime.LEGACY_INVESTMENT_STOCK_DETAILS_HASH = '#investment_stock_details_panel';
    runtime.INVESTMENT_HISTORY_MIN_VISIBLE_ROWS = 2;
    runtime.INVESTMENT_REALTIME_QUOTE_POLL_MS = 60000;
    runtime.INVESTMENT_REALTIME_QUOTE_IDLE_CHECK_MS = 60000;
    runtime.INVESTMENT_MARKET_SESSION_TTL_MS = 30000;
    runtime.INVESTMENT_LIVE_DIGIT_EPSILON = 1e-9;
    runtime.INVESTMENT_DAILY_PNL_DISPLAY_EPSILON = 0.005;

    runtime.initInvestmentSectionResizer = function initInvestmentSectionResizer() {
        return bindInvestmentSectionResizer({
            workspaceHeader: runtime.investmentWorkspaceHeader,
            reportCard: runtime.investmentReportCard,
            historySurface: runtime.investmentHistorySurface,
            sectionResizer: runtime.investmentSectionResizer,
            minVisibleRows: runtime.INVESTMENT_HISTORY_MIN_VISIBLE_ROWS,
            getChartInstance: () => runtime.state.investmentEquityChartInstance,
        });
    };
        Object.assign(runtime, createInvestmentRuntimeConfig(runtime));

    runtime.state.investmentMarketSessionState = null;
    runtime.state.investmentMarketSessionStateLoadedAt = 0;
    runtime.state.investmentMarketSessionStateRequest = null;
    runtime.state.investmentMarketSessionStateRequestDayCount = 0;
    runtime.state.investmentMarketSessionStateDayCount = 0;
    runtime.investmentStockDetailsPanel = document.getElementById(runtime.INVESTMENT_STOCK_DETAILS_PANEL_ID);
    runtime.investmentStockDetailsTableHost = document.getElementById('investment_stock_details_table_host');
    runtime.investmentShareActions = document.getElementById('investment_share_actions');
    runtime.exportTransactionsButton = document.getElementById('export_transactions_button');
    runtime.exportStandardXlsxButton = document.getElementById('export_standard_xlsx_button');
    runtime.shareCaptureButton = document.getElementById('share_capture_button');
    runtime.shareMaskButton = document.getElementById('share_mask_button');
    runtime.investmentSharePreviewDemo = document.getElementById('investment_share_preview_demo');
    runtime.investmentSharePreviewShell = document.getElementById('investment_share_preview_shell');
    runtime.investmentSharePreviewViewLabel = document.getElementById('investment_share_preview_view_label');
    runtime.investmentSharePreviewMaskButton = document.getElementById('investment_share_preview_mask_button');
    runtime.investmentHistoryPagination = document.getElementById('investment_history_pagination');
    runtime.investmentPanels = document.querySelectorAll('[data-investment-view-panel]');


    runtime.state.activeInvestmentView = 'chart';
    runtime.state.investmentSurfaceCleanupTimer = null;
    runtime.state.investmentFormHideTimer = null;
    runtime.state.investmentImportInFlight = false;
    runtime.state.zirconHkWorkbookValidationAbortController = null;
    runtime.state.zirconHkWorkbookValidation = {
        signature: '',
        valid: false,
        transactionCount: 0,
    };
    runtime.state.hsbcPasteValidationAbortController = null;
    runtime.state.hsbcPasteValidationTimer = 0;
    runtime.state.hsbcPasteValidation = {
        signature: '',
        state: 'idle',
        ready: false,
        mode: '',
        fieldStatus: {
            cash: false,
            portfolio: false,
            order_status: false,
        },
        cashCurrencies: [],
    };
    runtime.state.investmentSegmentedMeasureRaf = 0;
    runtime.state.investmentSegmentedMeasureTimer = 0;
    runtime.state.investmentIbkrModeMeasureRaf = 0;
    runtime.state.investmentHsbcModeMeasureRaf = 0;
    runtime.state.activeInvestmentHistoryRowIds = [];
    runtime.state.activeInvestmentStockDetailRowIds = [];
    runtime.state.activeInvestmentMetricTooltipState = null;
    runtime.INVESTMENT_MANUAL_SCROLL_SUPPRESS_MS = 1400;
    runtime.INVESTMENT_PROGRAMMATIC_SCROLL_GUARD_MS = 900;
    runtime.INVESTMENT_OVERVIEW_INTRADAY_REQUEST_TIMEOUT_MS = 45000;
    runtime.investmentScrollIntentState = {
        history: {
            suppressUntil: 0,
            ignoreUntil: 0,
        },
        stockDetails: {
            suppressUntil: 0,
            ignoreUntil: 0,
        },
    };
    runtime.state.investmentChartReady = false;
    runtime.state.investmentHasExportableTransactions = false;
    runtime.state.investmentShareMaskEnabled = false;
    runtime.state.investmentSharePreviewRenderSerial = 0;
    runtime.state.investmentSharePreviewRenderRaf = 0;
    runtime.state.investmentScreenshotLibraryPromise = null;
    runtime.state.investmentQrCodeLibraryPromise = null;
    runtime.state.investmentEquityChartInstance = null;
    runtime.state.investmentStockDetailsPriceChartInstance = null;
    runtime.state.activeHoldingsHoverTicker = '';
    runtime.state.activeHoldingsHoverLedgerNo = 0;
    runtime.state.investmentChartPointsCache = [];
    runtime.state.investmentBaseChartPointsCache = [];
    runtime.state.investmentBaseLatestPricesCache = {};
    runtime.state.investmentLatestPricesCache = {};
    runtime.state.investmentSharedChartDateRange = [];
    runtime.state.investmentChartPointIndexByLedgerNo = new Map();
    runtime.state.investmentLatestChartPoint = null;
    runtime.state.activeChartTooltipPointIndex = -1;
    runtime.state.activeChartTooltipPointRecord = null;
    runtime.state.activeStockDetailsHoverPointRecord = null;
    runtime.state.investmentDummyTickerProfiles = {};
    runtime.state.selectedInvestmentStockTicker = '';
    runtime.state.investmentProcessedTransactionsCache = [];
    runtime.state.investmentReplaySnapshotsCache = [];
    runtime.state.investmentTickerSummariesCache = [];
    runtime.state.investmentCurrentChartPnlMetrics = null;
    runtime.state.investmentCurrentChartPnlMetricsRevision = 0;
    runtime.state.investmentChartPnlMetricsByPoint = new WeakMap();
    runtime.state.investmentChartPnlTickerPriceIndex = null;
    runtime.state.investmentChartPnlResolveTimer = 0;
    runtime.state.investmentChartPnlResolveSerial = 0;
    runtime.state.investmentAvailableBrokerCodesCache = [];
    runtime.state.investmentAvailableBrokerCodesSet = new Set();
    runtime.state.animatedHoldingsMarkerPoint = null;
    runtime.state.investmentEquityChartRuntimeState = null;
    runtime.state.stockDetailsDonutAnimationCancel = null;
    runtime.state.stockDetailsDonutAnimatedState = null;
    runtime.state.investmentDummyDonutSyncFrame = 0;
    runtime.state.investmentStockDetailsDonutSyncFrame = 0;
    runtime.state.investmentEquityHoverSyncFrame = 0;
    runtime.state.investmentDummyDonutRenderSignature = '';
    runtime.state.investmentStockDetailsVisibleLayoutTimer = 0;
    runtime.state.selectedInvestmentStockDetailsRange = 'max';
    runtime.state.selectedInvestmentEquityRange = 'max';
    runtime.state.investmentStockDetailsRangeMeasureRaf = 0;
    runtime.state.investmentStockDetailsRangeControlAbortController = null;
    runtime.state.investmentStockDetailsRangeControlResizeObserver = null;
    runtime.state.investmentEquityRangeMeasureRaf = 0;
    runtime.state.investmentEquityRangeControlAbortController = null;
    runtime.state.investmentEquityRangeControlResizeObserver = null;
    runtime.state.investmentHoldingsTableAlignmentCleanup = null;
    runtime.state.investmentHistoryTableAlignmentCleanup = null;
    runtime.state.investmentStockDetailsTableAlignmentCleanup = null;
    runtime.state.investmentHistoryCurrentPage = 1;
    runtime.state.investmentHistoryPendingPaginationAnimation = null;
    runtime.state.investmentUrlStateApplying = false;
    runtime.state.investmentUrlStateReady = false;
    runtime.state.investmentBrokerFilterSelectedCodes = new Set();
    runtime.state.investmentBrokerSummarySelectedCode = 'all';
    runtime.state.investmentBrokerSummarySelectionInitialized = false;
    runtime.state.investmentBrokerFilterDocumentListenersBound = false;
    runtime.state.investmentBrokerFilterApplyRaf = 0;
    runtime.state.investmentBrokerFilterPositionRaf = 0;
    runtime.state.investmentSideFilter = 'all';
    runtime.state.investmentSideFilterDocumentListenersBound = false;
    runtime.state.investmentCurrencyFilter = 'all';
    runtime.state.investmentCurrencyFilterDocumentListenersBound = false;
    runtime.state.investmentDescriptionBindingFilter = 'all';
    runtime.state.investmentDescriptionBindingFilterDocumentListenersBound = false;
    runtime.state.investmentDescriptionBindingAlertTooltipState = null;
    runtime.state.investmentStockDetailsDateFilter = { mode: 'all', value: '' };
    runtime.state.investmentStockDetailsTimeFilterDocumentListenersBound = false;
    runtime.state.investmentBrokerFilterTransactionIndex = {
        source: null,
        allRows: [],
        byBroker: new Map(),
        availableCodes: [],
        availableSet: new Set(),
    };
    runtime.state.investmentHistoryVisibleTransactionsCache = [];
    runtime.state.investmentRawTransactionsCache = [];
    runtime.state.investmentTickerClosePricesCache = {};
    runtime.state.investmentInternalTransferSourceOptionsByKey = new Map();
    runtime.state.investmentInternalTransferResolvedBindingsBySourceKey = new Map();
    runtime.state.investmentAggregateSecurityTransferState = {
        blocked: false,
        reconciliationBlocked: false,
        activeReceiptKeys: new Set(),
        excludedReceiptKeys: new Set(),
        pnlUnavailableTickers: new Set(),
    };
    runtime.state.investmentStockDetailsPriceChartRequestSerial = 0;
    runtime.investmentStockDetailsIntradayCache = new Map();
    runtime.investmentStockDetailsIntradayInflight = new Map();
    runtime.investmentOverviewIntradayCache = new Map();
    runtime.investmentOverviewIntradayInflight = new Map();
    runtime.state.investmentOverviewIntradayRenderSerial = 0;
    runtime.state.investmentOverviewIntradayLinePointsCache = {
        key: '',
        points: [],
        quality: null,
    };
    runtime.investmentOverviewRealtimeLinePointsByMinute = new Map();
    runtime.investmentRealtimeQuotesByTicker = new Map();


        Object.assign(runtime, createInvestmentRealtimeChartRuntime(runtime));
    Object.assign(runtime, createInvestmentWorkspaceControlsRuntime(runtime));
    Object.assign(runtime, createInvestmentRangeTransferRuntime(runtime));
    Object.assign(runtime, createInvestmentStockHistoryFilterRuntime(runtime));
    Object.assign(runtime, createInvestmentBindingPaginationRuntime(runtime));
    Object.assign(runtime, createInvestmentImportWorkflowRuntime(runtime));
    Object.assign(runtime, createInvestmentExportHistoryRuntime(runtime));
    Object.assign(runtime, createInvestmentShareLinkedHoverRuntime(runtime));
    Object.assign(runtime, createInvestmentMetricsImportRuntime(runtime));
    Object.assign(runtime, createInvestmentHoldingsWorkspaceRuntime(runtime));
    Object.assign(runtime, createInvestmentHoldingsLiveRuntime(runtime));
    Object.assign(runtime, createInvestmentHistoryPaginationRuntime(runtime));
    Object.assign(runtime, createInvestmentTransactionTableRuntime(runtime));
    Object.assign(runtime, createInvestmentEquityChartRuntime(runtime));
    Object.assign(runtime, createInvestmentFundingMetricsRuntime(runtime));
Object.assign(runtime, createInvestmentDataUtils({
        noCommissionTransactionTypes: runtime.NO_COMMISSION_TRANSACTION_TYPES,
        investmentCommonSplitFactors: runtime.INVESTMENT_COMMON_SPLIT_FACTORS,
        parseInvestmentDateParts: runtime.parseInvestmentDateParts,
        formatInvestmentShortDateParts: runtime.formatInvestmentShortDateParts,
        normalizeInvestmentTicker: runtime.normalizeInvestmentTicker,
        normalizeInvestmentStockDetailsRange: runtime.normalizeInvestmentStockDetailsRange,
        normalizeInvestmentEquityRange: runtime.normalizeInvestmentEquityRange,
    }));

    Object.assign(runtime, createInvestmentLiveValueAnimator({
        epsilon: runtime.INVESTMENT_LIVE_DIGIT_EPSILON,
        easeOutCubic: runtime.easeOutCubic,
        renderWorkspaceMetricValueContent,
        scheduler: window.WorthwardMotion?.scheduler,
    }));

    runtime.investmentRealtimeQuotePoller = createInvestmentRealtimeQuotePoller({
        pollDelayMs: runtime.INVESTMENT_REALTIME_QUOTE_POLL_MS,
        idleDelayMs: runtime.INVESTMENT_REALTIME_QUOTE_IDLE_CHECK_MS,
        isDisposed: () => runtime.state.investmentPageDisposed,
        hasData: () => runtime.state.investmentProcessedTransactionsCache.length > 0,
        getTickers: runtime.getInvestmentRealtimeHoldingsTickers,
        shouldRun: runtime.shouldRunInvestmentRealtimeQuotes,
        requestQuotes: runtime.requestInvestmentRealtimeQuotes,
        applyQuotes: runtime.applyInvestmentRealtimeQuotes,
        resetState: runtime.resetInvestmentRealtimeChartState,
        refreshSession: () => runtime.refreshInvestmentMarketSessionState({
            force: true,
            dayCount: runtime.getInvestmentOverviewIntradayDayCount(runtime.state.selectedInvestmentEquityRange)
                || runtime.INVESTMENT_OVERVIEW_INTRADAY_DAY_COUNTS['1w'],
        }),
        isLifecycleInterrupted: runtime.isLifecycleInterruptedFetch,
        onError: (error) => console.warn('Unable to refresh investment realtime quotes', error),
        setTimeoutFn: window.setTimeout.bind(window),
        clearTimeoutFn: window.clearTimeout.bind(window),
    });


    runtime.refreshInvestmentMarketSessionState({ force: true }).catch(() => {});


    runtime.SEGMENTED_TEXT_RENDER_SAFETY_PX = 2;


    Object.assign(runtime, createInvestmentStockDetailsUtils({
        INVESTMENT_SURFACE_LAYOUT_SETTLE_MS: runtime.INVESTMENT_SURFACE_LAYOUT_SETTLE_MS,
        adjustTradePriceForRenderedSeries: runtime.adjustTradePriceForRenderedSeries,
        applyInvestmentTransactionToState: runtime.applyInvestmentTransactionToState,
        buildInvestmentFxRateTimeline: runtime.buildInvestmentFxRateTimeline,
        buildInvestmentIntradayDayBoundaries: runtime.buildInvestmentIntradayDayBoundaries,
        buildInvestmentIntradayDayFallbackIndex: runtime.buildInvestmentIntradayDayFallbackIndex,
        buildRenderedSplitFactorHints: runtime.buildRenderedSplitFactorHints,
        buildTickerPriceIndex: runtime.buildTickerPriceIndex,
        clearInvestmentHistoryHighlights: runtime.clearInvestmentHistoryHighlights,
        clearInvestmentStockDetailHighlights: runtime.clearInvestmentStockDetailHighlights,
        clearInvestmentStockDetailsVisibleLayoutTimer: () => {
            if (runtime.state.investmentStockDetailsVisibleLayoutTimer) {
                window.clearTimeout(runtime.state.investmentStockDetailsVisibleLayoutTimer);
                runtime.state.investmentStockDetailsVisibleLayoutTimer = 0;
            }
        },
        compareInvestmentTransactions: runtime.compareInvestmentTransactions,
        constrainTickerDatesToSharedRange: runtime.constrainTickerDatesToSharedRange,
        convertAmountToBaseCurrency: runtime.convertAmountToBaseCurrency,
        createPositionState: runtime.createPositionState,
        formatAmount: runtime.formatAmount,
        formatAmountWithCurrency: runtime.formatAmountWithCurrency,
        formatEventType: runtime.formatEventType,
        formatHoldingsMoney: runtime.formatHoldingsMoney,
        formatHoldingsPosition: runtime.formatHoldingsPosition,
        formatInvestmentFullDateLines: runtime.formatInvestmentFullDateLines,
        formatInvestmentFullDateParts: runtime.formatInvestmentFullDateParts,
        formatMetricLossAmount: runtime.formatMetricLossAmount,
        formatMetricLossAmountWithCurrency: runtime.formatMetricLossAmountWithCurrency,
        formatTransactionCommissionDisplay: runtime.formatTransactionCommissionDisplay,
        formatTransactionCurrency: runtime.formatTransactionCurrency,
        formatTransactionDateDisplay: runtime.formatTransactionDateDisplay,
        formatTransactionDescription: runtime.formatTransactionDescription,
        getIndexedClosePriceOnOrBefore: runtime.getIndexedClosePriceOnOrBefore,
        getInvestmentBaseCurrency: runtime.getInvestmentBaseCurrency,
        getInvestmentBrokerMeta: runtime.getInvestmentBrokerMeta,
        getInvestmentChartPointsCache: () => runtime.state.investmentChartPointsCache,
        getInvestmentMarketStoreTickerCandidates: runtime.getInvestmentTickerStoreAliasCandidates,
        getInvestmentProcessedTransactionsCache: () => runtime.state.investmentProcessedTransactionsCache,
        getInvestmentStockDetailsPnlSummary: (ticker) => runtime.state.investmentTickerSummariesCache.find((summary) => (
            runtime.normalizeInvestmentTicker(summary?.ticker) === runtime.normalizeInvestmentTicker(ticker)
        )) || null,
        getInvestmentStockDetailsPanel: () => runtime.investmentStockDetailsPanel,
        getInvestmentStockDetailsPriceChartInstance: () => runtime.state.investmentStockDetailsPriceChartInstance,
        getInvestmentStockDetailsPriceChartRequestSerial: () => runtime.state.investmentStockDetailsPriceChartRequestSerial,
        getInvestmentStockDetailsRangeLabels: runtime.getInvestmentStockDetailsRangeLabels,
        getInvestmentTradeSessionType: runtime.getInvestmentTradeSessionType,
        getInvestmentCanonicalTicker: runtime.getInvestmentCanonicalTicker,
        getMoneyMarketTickerSet: runtime.getMoneyMarketTickerSet,
        getCashEquivalentTickerSet: runtime.getCashEquivalentTickerSet,
        getNormalizedTransactionType: runtime.getNormalizedTransactionType,
        getSelectedInvestmentStockDetailsRange: () => runtime.state.selectedInvestmentStockDetailsRange,
        getSignedMetricClass: runtime.getSignedMetricClass,
        getTickerQuoteCurrency: runtime.getTickerQuoteCurrency,
        getTransactionAmount: runtime.getTransactionAmount,
        getTransactionBrokerCode: runtime.getTransactionBrokerCode,
        getTransactionCommission: runtime.getTransactionCommission,
        getTransactionBrokerRealizedPnl: runtime.getTransactionBrokerRealizedPnl,
        getTransactionEffectiveUnitPrice: runtime.getTransactionEffectiveUnitPrice,
        getTransactionLotScope: runtime.getTransactionLotScope,
        getTransactionLotScopeKey: runtime.getTransactionLotScopeKey,
        getTransactionPrice: runtime.getTransactionPrice,
        getTransactionQuantity: runtime.getTransactionQuantity,
        getTransactionValuationQuantity: runtime.getTransactionValuationQuantity,
        incrementInvestmentStockDetailsPriceChartRequestSerial: () => {
            runtime.state.investmentStockDetailsPriceChartRequestSerial += 1;
            return runtime.state.investmentStockDetailsPriceChartRequestSerial;
        },
        isFlatPosition: runtime.isFlatPosition,
        isInvestmentStockDetailsIntradayRange: runtime.isInvestmentStockDetailsIntradayRange,
        loadInvestmentStockDetailsIntradayRows: runtime.loadInvestmentStockDetailsIntradayRows,
        normalizeInvestmentLedgerNos: runtime.normalizeInvestmentLedgerNos,
        normalizeInvestmentIntradayMinuteKey,
        normalizeInvestmentStockDetailsRange: runtime.normalizeInvestmentStockDetailsRange,
        normalizeInvestmentTicker: runtime.normalizeInvestmentTicker,
        normalizeLedgerDate: runtime.normalizeLedgerDate,
        normalizePriceHistoryPayload: runtime.normalizePriceHistoryPayload,
        renderInvestmentBrokerCell: runtime.renderInvestmentBrokerCell,
        resolveInvestmentTheme: runtime.resolveInvestmentTheme,
        setActiveStockDetailsHoverPointRecord: (value) => {
            runtime.state.activeStockDetailsHoverPointRecord = value;
        },
        setInvestmentStockDetailsPriceChartInstance: (value) => {
            runtime.state.investmentStockDetailsPriceChartInstance = value;
        },
        buildInvestmentAxisTickIndexes: runtime.buildInvestmentAxisTickIndexes,
        getInvestmentLiveSessionDateKey: runtime.getInvestmentLiveSessionDateKey,
        getInvestmentStockDetailsRealtimePulseTarget: runtime.getInvestmentStockDetailsRealtimePulseTarget,
        shouldRunInvestmentRealtimeQuotes: runtime.shouldRunInvestmentRealtimeQuotes,
        shouldTrackHoldingTicker: runtime.shouldTrackHoldingTicker,
        syncInvestmentHoverLinkedViews: runtime.syncInvestmentHoverLinkedViews,
        syncInvestmentStockDetailsDonutFromInteraction: runtime.syncInvestmentStockDetailsDonutFromInteraction,
        waitForInvestmentStableElementBox: runtime.waitForInvestmentStableElementBox,
    }));


    // Safety net: expose for the shared-select option click handler (especially with position:fixed dropdowns)
    // so that picking a different broker in the import dropdown reliably switches the visible fields.
    window.__forceSyncInvestmentImportMode = runtime.syncInvestmentImportMode;


    runtime.INVESTMENT_COMMUNITY_SHARE_FOOTER_PROMPT = 'Welcome to vibe and star this project.';


    // Code version: v0.4.0.0


    // Code version: v0.4.0.0


    runtime.bindInvestmentHistoryPagination();
    runtime.initInvestmentSectionResizer();
    runtime.initInvestmentViewTabs();
    runtime.initInvestmentDummyDonut();
    runtime.mountInvestmentBrokerFilterHeaders();
    runtime.mountInvestmentBrokerSummarySelector();
    runtime.mountInvestmentSideFilterHeaders();
    runtime.mountInvestmentCurrencyFilterHeaders();
    runtime.mountInvestmentDescriptionBindingFilterHeaders();
    runtime.bindInvestmentExportButton();
    runtime.syncInvestmentImportMode();
    runtime.syncIbkrTradeNotificationsDisplay();
    runtime.syncIbkrHoldingsDisplay();
    runtime.syncHsbcPasteDisplaySummaries();
    runtime.syncImportValidationState();
    // Re-force shared select refresh (the broker dropdown uses the backtest-shared-select machinery).
    // The binder is idempotent; keeping the bound flag prevents duplicate handlers from fighting.
    if (typeof window.repairSidebarControlBindings === 'function') {
        window.repairSidebarControlBindings();
    }
    // Force a change event on the broker native select so shared-select label/logo + import mode sync run.
    if (runtime.investmentImportBrokerSelect) {
        runtime.investmentImportBrokerSelect.dispatchEvent(new Event('change', {bubbles: true}));
    }
    [runtime.transactionsCsvInput, runtime.positionsCsvInput, runtime.gainskeeperFilesInput, runtime.futuhkStatementPdfsInput, runtime.bocHkStatementPdfsInput, runtime.hsbcStatementPdfsInput, runtime.tigertradeStatementPdfsInput, runtime.usmartHkStatementPdfsInput, runtime.longbridgeSgFundDetailsInput, runtime.longbridgeSgHistoryOrdersInput, runtime.longbridgeHkFundDetailsInput, runtime.longbridgeHkHistoryOrdersInput, runtime.investmentImportBrokerSelect, runtime.schwabTransactionsCsvInput, runtime.schwabPositionsCsvInput].forEach((input) => {
        if (input) {
            input.addEventListener('change', () => {
                runtime.clearImportFeedback();
                if (input === runtime.investmentImportBrokerSelect) {
                    runtime.syncInvestmentImportMode();
                }
                runtime.syncImportValidationState();
                runtime.syncInvestmentImportContainerHeight();
            });
        }
    });
    if (runtime.zirconHkTransactionsXlsxInput instanceof HTMLInputElement) {
        runtime.zirconHkTransactionsXlsxInput.addEventListener('change', () => {
            runtime.clearImportFeedback();
            runtime.syncInvestmentImportContainerHeight();
            runtime.validateZirconHkWorkbook();
        });
    }
    document.querySelectorAll('input[name="ibkr_import_mode"]').forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        input.addEventListener('change', () => {
            runtime.clearImportFeedback();
            runtime.syncInvestmentImportMode();
            runtime.syncImportValidationState();
            runtime.syncInvestmentImportContainerHeight();
        });
    });
    document.querySelectorAll('input[name="hsbc_import_mode"]').forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        input.addEventListener('change', () => {
            runtime.clearImportFeedback();
            runtime.syncInvestmentImportMode();
            runtime.syncImportValidationState();
            runtime.syncInvestmentImportContainerHeight();
        });
    });
    [runtime.hsbcCashAccountTextInput, runtime.hsbcPortfolioTextInput, runtime.hsbcOrderStatusTextInput].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => {
            runtime.clearImportFeedback();
            runtime.syncHsbcPasteDisplaySummaries();
            runtime.syncImportValidationState();
            runtime.requestHsbcPasteValidation();
        });
    });
    if (runtime.ibkrTradeNotificationsTextInput) {
        runtime.ibkrTradeNotificationsTextInput.addEventListener('input', () => {
            runtime.clearImportFeedback();
            runtime.syncIbkrTradeNotificationsDisplay();
            runtime.syncImportValidationState();
        });
    }
    if (runtime.ibkrHoldingsTextInput) {
        runtime.ibkrHoldingsTextInput.addEventListener('input', () => {
            runtime.clearImportFeedback();
            runtime.syncIbkrHoldingsDisplay();
            runtime.syncImportValidationState();
        });
    }
    if (runtime.ibkrTradeNotificationsDateInput) {
        ['input', 'change'].forEach((eventType) => {
            runtime.ibkrTradeNotificationsDateInput.addEventListener(eventType, () => {
                runtime.clearImportFeedback();
                runtime.syncIbkrTradeNotificationsDisplay();
                runtime.syncImportValidationState();
            });
        });
    }
    if (runtime.ibkrTradeNotificationsPasteButton instanceof HTMLButtonElement) {
        runtime.ibkrTradeNotificationsPasteButton.addEventListener('click', () => {
            runtime.pasteIbkrTradeNotificationsFromClipboard();
        });
    }
    if (runtime.ibkrHoldingsPasteButton instanceof HTMLButtonElement) {
        runtime.ibkrHoldingsPasteButton.addEventListener('click', () => {
            runtime.pasteIbkrHoldingsFromClipboard();
        });
    }
    [
        ['cash', runtime.hsbcCashAccountPasteButton],
        ['portfolio', runtime.hsbcPortfolioTextPasteButton],
        ['order', runtime.hsbcOrderStatusPasteButton],
    ].forEach(([kind, button]) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('click', () => {
            runtime.pasteHsbcClipboardIntoField(kind);
        });
    });
    [
        ['cash', runtime.hsbcCashAccountTextClearButton],
        ['portfolio', runtime.hsbcPortfolioTextClearButton],
        ['order', runtime.hsbcOrderStatusTextClearButton],
    ].forEach(([kind, button]) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });
        button.addEventListener('click', () => {
            runtime.clearHsbcPastedText(kind);
        });
    });
    window.addEventListener('resize', runtime.syncInvestmentImportContainerHeight);
    window.visualViewport?.addEventListener('resize', runtime.syncInvestmentImportContainerHeight);


    // Toggle form visibility
    runtime.parentSection = runtime.formContainer.closest('.chart-surface');
    if (runtime.toggleBtn && runtime.formContainer) {
        runtime.toggleBtn.addEventListener('click', () => {
            runtime.openInvestmentImportForm();
        });

        runtime.investmentImportCloseButton?.addEventListener('click', () => {
            runtime.closeInvestmentImportForm();
        });

        const handleInvestmentLayoutChange = () => {
            runtime.syncInvestmentFormLayout();
        };

        window.addEventListener('resize', handleInvestmentLayoutChange);

        if (window.ResizeObserver) {
            const investmentFormResizeObserver = new ResizeObserver(handleInvestmentLayoutChange);
            investmentFormResizeObserver.observe(runtime.formContainer);
        }
    }

    // Handle form submission
    if (runtime.investmentForm) {
        runtime.investmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            runtime.clearImportFeedback();
            const transactionsCsv = document.getElementById('transactions_csv');
            const positionsCsv = document.getElementById('positions_csv');
            const selectedBroker = runtime.getSelectedInvestmentImportBroker();
            const transactionsFile = transactionsCsv?.files?.[0];
            const positionsFile = positionsCsv?.files?.[0];
            const ibkrImportMode = runtime.getSelectedIbkrImportMode();
            const formData = new FormData();
            formData.append('broker', selectedBroker);
            if (!runtime.SUPPORTED_INVESTMENT_IMPORT_BROKERS.has(selectedBroker)) {
                const pendingBroker = runtime.getInvestmentBrokerMeta(selectedBroker);
                runtime.setImportFeedback(`${pendingBroker.label} investment import is not implemented yet.`, 'warning');
                return;
            }
            if (selectedBroker === 'ibkr') {
                formData.append('ibkr_import_mode', ibkrImportMode);
                if (ibkrImportMode === 'gainskeeper') {
                    const gainskeeperFiles = runtime.gainskeeperFilesInput?.files ? Array.from(runtime.gainskeeperFilesInput.files) : [];
                    if (!gainskeeperFiles.length) {
                        runtime.setImportFeedback('Please choose at least one IBKR GainsKeeper .gkx file before importing.', 'error');
                        return;
                    }
                    if (!gainskeeperFiles.every((file) => runtime.isLikelyGainskeeperFile(file))) {
                        runtime.setImportFeedback('Please upload IBKR GainsKeeper files with .gkx or .ofx filenames.', 'error');
                        return;
                    }
                    gainskeeperFiles.forEach((file) => {
                        formData.append('gainskeeper_files', file);
                    });
                } else if (ibkrImportMode === 'web_paste') {
                    const tradeNotificationsText = String(
                        runtime.ibkrTradeNotificationsTextInput?.value || ''
                    ).trim();
                    if (!tradeNotificationsText) {
                        runtime.setImportFeedback('Please paste the IBKR Trade Notifications page text before syncing.', 'error');
                        return;
                    }
                    const tradeNotificationsReadiness = runtime.getIbkrTradeNotificationsReadiness(
                        tradeNotificationsText,
                    );
                    if (tradeNotificationsReadiness.reason === 'missing_page_date') {
                        runtime.setImportFeedback(
                            'Please select the Hong Kong page date. Current-day IBKR fills show only a time and cannot be dated from the pasted text alone.',
                            'error',
                        );
                        return;
                    }
                    if (!tradeNotificationsReadiness.ready) {
                        runtime.setImportFeedback('The pasted text does not look like the IBKR Trade Notifications page.', 'error');
                        return;
                    }
                    formData.append(
                        'ibkr_trade_notifications_text',
                        tradeNotificationsText,
                    );
                    formData.append(
                        'ibkr_trade_notifications_date',
                        String(runtime.ibkrTradeNotificationsDateInput?.value || '').trim(),
                    );
                    const holdingsText = String(runtime.ibkrHoldingsTextInput?.value || '').trim();
                    if (holdingsText && !runtime.getIbkrHoldingsReadiness(holdingsText).ready) {
                        runtime.setImportFeedback(
                            'The pasted text does not look like the IBKR Your Holdings page.',
                            'error',
                        );
                        return;
                    }
                    if (holdingsText) {
                        formData.append('ibkr_holdings_text', holdingsText);
                    }
                } else if (!transactionsFile || !positionsFile) {
                    runtime.setImportFeedback('Please choose both IBKR CSV files before importing.', 'error');
                    return;
                } else if (!runtime.isLikelyTransactionHistoryFile(transactionsFile) || !runtime.isLikelyPositionsFile(positionsFile)) {
                    runtime.setImportFeedback('Please make sure the first file is your Transaction History CSV and the second file is your Realized Summary CSV.', 'error');
                    return;
                } else {
                    formData.append('transactions_csv', transactionsFile);
                    formData.append('positions_csv', positionsFile);
                }
            } else if (selectedBroker === 'longbridge_hk') {
                const hkFundFile = runtime.longbridgeHkFundDetailsInput?.files?.[0];
                const hkOrdersFile = runtime.longbridgeHkHistoryOrdersInput?.files?.[0];
                if (!hkFundFile || !hkOrdersFile) {
                    runtime.setImportFeedback('Please upload both the Fund Details text file and the History Orders spreadsheet.', 'error');
                    return;
                }
                if (
                    !runtime.isLikelyLongbridgeSgFundDetailsFile(hkFundFile)
                    || !runtime.isLikelyLongbridgeSgHistoryOrdersFile(hkOrdersFile)
                ) {
                    runtime.setImportFeedback('Please upload a Fund Details .txt and History Orders .xlsx for Longbridge (HK).', 'error');
                    return;
                }
                formData.append('longbridge_hk_fund_details_txt', hkFundFile);
                formData.append('longbridge_hk_history_orders_xlsx', hkOrdersFile);
            } else if (selectedBroker === 'longbridge_sg') {
                const fundDetailsFile = runtime.longbridgeSgFundDetailsInput?.files?.[0];
                const historyOrdersFile = runtime.longbridgeSgHistoryOrdersInput?.files?.[0];
                if (!fundDetailsFile || !historyOrdersFile) {
                    runtime.setImportFeedback('Please choose both Longbridge (SG) import files before importing.', 'error');
                    return;
                }
                if (
                    !runtime.isLikelyLongbridgeSgFundDetailsFile(fundDetailsFile)
                    || !runtime.isLikelyLongbridgeSgHistoryOrdersFile(historyOrdersFile)
                ) {
                    runtime.setImportFeedback('Please upload a Fund Details .txt file and a History Orders .xlsx file.', 'error');
                    return;
                }
                formData.append('longbridge_sg_fund_details_txt', fundDetailsFile);
                formData.append('longbridge_sg_history_orders_xlsx', historyOrdersFile);
            } else if (selectedBroker === 'futuhk') {
                const statementFiles = runtime.getSelectedFutuStatementPdfFiles();
                if (!statementFiles.length) {
                    runtime.setImportFeedback('Please choose at least one Futu (HK) monthly statement PDF before importing.', 'error');
                    return;
                }
                if (!statementFiles.every((file) => runtime.isLikelyFutuStatementPdf(file))) {
                    runtime.setImportFeedback('Please upload valid Futu (HK) monthly statement PDF files.', 'error');
                    return;
                }
                statementFiles.forEach((file) => {
                    formData.append('futuhk_statement_pdfs', file);
                });
            } else if (selectedBroker === 'boc_hk') {
                const statementFiles = runtime.getSelectedStatementPdfFiles(runtime.bocHkStatementPdfsInput);
                if (!statementFiles.length) {
                    runtime.setImportFeedback('Please choose at least one BOCHK Consolidated Statement PDF before importing.', 'error');
                    return;
                }
                if (!statementFiles.every((file) => runtime.isLikelyBocHkStatementPdf(file))) {
                    runtime.setImportFeedback('Please upload valid BOCHK Consolidated Statement PDF files.', 'error');
                    return;
                }
                statementFiles.forEach((file) => {
                    formData.append('boc_hk_statement_pdfs', file);
                });
            } else if (selectedBroker === 'hsbc') {
                const hsbcImportMode = runtime.getSelectedHsbcImportMode();
                formData.append('hsbc_import_mode', hsbcImportMode);
                if (hsbcImportMode === 'statement_pdf') {
                    const statementFiles = runtime.getSelectedStatementPdfFiles(runtime.hsbcStatementPdfsInput);
                    if (!isCompleteHsbcStatementPdfBundle(statementFiles, runtime.isLikelyPdfFile)) {
                        runtime.setImportFeedback('Please choose at least one valid HSBC monthly statement PDF.', 'error');
                        return;
                    }
                    statementFiles.forEach((file) => {
                        formData.append('hsbc_statement_pdfs', file);
                    });
                } else {
                    const portfolioText = String(runtime.hsbcPortfolioTextInput?.value || '').trim();
                    const orderStatusText = String(runtime.hsbcOrderStatusTextInput?.value || '').trim();
                    const cashAccountText = String(runtime.hsbcCashAccountTextInput?.value || '').trim();
                    const hsbcPasteSignature = runtime.getHsbcPasteValidationSignature({
                        cash: cashAccountText,
                        portfolio: portfolioText,
                        order_status: orderStatusText,
                    });
                    if (
                        runtime.state.hsbcPasteValidation.signature !== hsbcPasteSignature
                        || runtime.state.hsbcPasteValidation.state !== 'valid'
                        || !runtime.state.hsbcPasteValidation.ready
                    ) {
                        return;
                    }
                    formData.append('hsbc_portfolio_text', portfolioText);
                    formData.append('hsbc_order_status_text', orderStatusText);
                    formData.append('hsbc_cash_account_text', cashAccountText);
                }
            } else if (selectedBroker === 'schwab') {
                const schwabTransactionsFile = runtime.schwabTransactionsCsvInput?.files?.[0] || transactionsCsv?.files?.[0];
                const schwabPositionsFile = runtime.schwabPositionsCsvInput?.files?.[0] || positionsCsv?.files?.[0];
                if (!schwabTransactionsFile || !schwabPositionsFile) {
                    runtime.setImportFeedback('Please choose both the Schwab Transactions CSV and Positions CSV before importing.', 'error');
                    return;
                }
                if (!runtime.isLikelyCsvFile(schwabTransactionsFile) || !runtime.isLikelyCsvFile(schwabPositionsFile)) {
                    runtime.setImportFeedback('Please upload the Schwab Transactions and Positions exports as CSV files.', 'error');
                    return;
                }
                formData.append('transactions_csv', schwabTransactionsFile);
                formData.append('positions_csv', schwabPositionsFile);
            } else if (runtime.GENERIC_XLSX_INVESTMENT_BROKERS.has(selectedBroker)) {
                const workbookFile = runtime.zirconHkTransactionsXlsxInput?.files?.[0];
                const workbookSignature = runtime.getImportFileSignature(workbookFile);
                if (!workbookFile || !runtime.isLikelyXlsxFile(workbookFile)) {
                    runtime.setImportFeedback('Please upload a completed Worthward standard .xlsx workbook.', 'error');
                    return;
                }
                if (
                    !runtime.state.zirconHkWorkbookValidation.valid
                    || runtime.state.zirconHkWorkbookValidation.signature !== workbookSignature
                ) {
                    runtime.setImportFeedback(
                        'Wait for the manual investment workbook to pass validation before importing.',
                        'error',
                    );
                    return;
                }
                formData.append('zircon_hk_transactions_xlsx', workbookFile);
            } else if (selectedBroker === 'tigertrade' || selectedBroker === 'usmart_hk') {
                const input = selectedBroker === 'tigertrade'
                    ? runtime.tigertradeStatementPdfsInput
                    : runtime.usmartHkStatementPdfsInput;
                const brokerLabel = selectedBroker === 'tigertrade' ? 'Tiger Trade' : 'uSMART (HK)';
                const statementFiles = runtime.getSelectedStatementPdfFiles(input);
                if (!statementFiles.length) {
                    runtime.setImportFeedback(`Please choose at least one ${brokerLabel} statement PDF before importing.`, 'error');
                    return;
                }
                if (!statementFiles.every((file) => runtime.isLikelyPdfFile(file))) {
                    runtime.setImportFeedback(`Please upload valid ${brokerLabel} statement PDF files.`, 'error');
                    return;
                }
                statementFiles.forEach((file) => {
                    formData.append(`${selectedBroker}_statement_pdfs`, file);
                });
            }

            const pendingTransferSourceKeysBeforeImport = (
                getInvestmentPendingTransferSourceKeys(runtime.state.investmentProcessedTransactionsCache)
            );
            runtime.state.investmentImportInFlight = true;
            runtime.syncImportValidationState();
            runtime.showInvestmentImportProgressModal(
                'We are parsing and merging the imported broker activity. Please keep this tab open until the import finishes.',
            );
            runtime.reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'starting transactions import', {
                broker: selectedBroker,
                hasTransactionsFile: Boolean(transactionsFile),
                hasPositionsFile: Boolean(positionsFile),
            });
            fetch('/api/investment/transactions', runtime.buildInvestmentRequestOptions({
                method: 'POST',
                body: formData,
            }))
            .then(response => {
                runtime.reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import response received', {
                    broker: selectedBroker,
                    status: response.status,
                    ok: response.ok,
                });
                return response.json();
            })
            .then(async result => {
                runtime.reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import payload received', {
                    broker: selectedBroker,
                    success: result.success,
                    error: result.error || '',
                });
                if (result.success) {
                    const refreshNotice = Array.isArray(result.freshness_refresh_failures) && result.freshness_refresh_failures.length
                        ? `Some open positions could not be refreshed yet: ${result.freshness_refresh_failures.map((ticker) => runtime.formatInvestmentTickerForDisplay(ticker)).join(', ')}.`
                        : '';
                    runtime.closeInvestmentImportForm();
                    runtime.setImportFeedback('Import committed. Refreshing the transaction table…', 'loading');
                    try {
                        const {
                            data: refreshedInvestmentData,
                            valuationStatus,
                            processedTransactions: refreshedProcessedTransactions,
                        } = await runtime.fetchInvestmentData({
                            expectedStoreVersion: result.investment_store_version,
                        });
                        const feedbackImportSummary = resolveInvestmentImportFeedbackSummary({
                            refreshedSummary: refreshedInvestmentData?.summary,
                            importSummary: result.summary,
                        });
                        const pendingTransferCount = countNewInvestmentPendingTransferRows({
                            beforeSourceKeys: pendingTransferSourceKeysBeforeImport,
                            refreshedTransactions: refreshedProcessedTransactions,
                        });
                        const valuationNotice = valuationStatus?.isDegraded ? String(valuationStatus.message || '').trim() : '';
                        if (valuationNotice) {
                            runtime.setImportFeedback(
                                `${result.message || 'Import complete.'} ${valuationNotice}`,
                                'warning'
                            );
                        } else if (selectedBroker === 'ibkr') {
                            runtime.setImportFeedback(
                                buildIbkrImportFeedbackMessage({
                                    importSummary: feedbackImportSummary,
                                    refreshNotice,
                                    valuationNotice: '',
                                    pendingTransferCount,
                                }, { escapeHtml: runtime.escapeHtml }),
                                'success',
                                { allowHtml: true }
                            );
                        } else if (selectedBroker === 'hsbc') {
                            runtime.setImportFeedback(
                                buildHsbcImportFeedbackMessage({
                                    importSummary: feedbackImportSummary,
                                    refreshNotice,
                                }, { escapeHtml: runtime.escapeHtml }),
                                'success',
                                { allowHtml: true }
                            );
                        } else if (selectedBroker === 'schwab') {
                            runtime.setImportFeedback(
                                buildSchwabImportFeedbackMessage({
                                    importSummary: feedbackImportSummary,
                                    refreshNotice,
                                    pendingTransferCount,
                                }, { escapeHtml: runtime.escapeHtml }),
                                'success',
                                { allowHtml: true }
                            );
                        } else {
                            runtime.setImportFeedback(
                                `${result.message || 'Import complete.'}${refreshNotice ? ` ${refreshNotice}` : ''}`,
                                'success'
                            );
                        }
                    } catch (error) {
                        if (runtime.isLifecycleInterruptedFetch(error)) return;
                        throw error;
                    }
                } else {
                    runtime.setImportFeedback(result.error || 'Import failed.', 'error');
                }
            })
            .catch(err => {
                runtime.reportInvestmentFetchAbortDebug('D', 'investment.js:investmentFormSubmit', 'transactions import failed', {
                    broker: selectedBroker,
                    errorName: err?.name || '',
                    errorMessage: err?.message || '',
                });
                runtime.setImportFeedback(`Network error: ${err.message}`, 'error');
            })
            .finally(() => {
                runtime.state.investmentImportInFlight = false;
                runtime.syncImportValidationState();
                runtime.hideInvestmentLoadingModal({ resetContent: true });
            });
        });
    }

    // Load and render transactions
    runtime.state.investmentBootstrapTimer = window.setTimeout(() => {
        runtime.state.investmentBootstrapTimer = 0;
        if (runtime.state.investmentPageDisposed || document.visibilityState === 'hidden') return;
        runtime.showInvestmentLoadingModal();
        runtime.fetchInvestmentData()
            .then(({ valuationStatus }) => {
                runtime.hideInvestmentLoadingModal({ resetContent: true });
                if (valuationStatus?.isDegraded) {
                    runtime.setImportFeedback(valuationStatus.message, 'warning');
                    return;
                }
                runtime.clearImportFeedback();
            })
            .catch(err => {
                runtime.hideInvestmentLoadingModal({ resetContent: true });
                if (runtime.isLifecycleInterruptedFetch(err)) return;
                console.error('Failed to load transactions:', err);
                runtime.setImportFeedback(`Failed to load investment data: ${err.message}`, 'error');
            });
    }, 150);


    window.addEventListener('worthward:theme-mode-change', () => {
        window.requestAnimationFrame(() => {
            if (runtime.state.investmentEquityChartInstance?.canvas?.isConnected) {
                runtime.renderEquityChartWithEquity(runtime.state.investmentChartPointsCache);
            }
            if (runtime.state.investmentStockDetailsPriceChartInstance?.canvas?.isConnected && runtime.state.selectedInvestmentStockTicker) {
                runtime.renderInvestmentStockDetailsPriceChart(
                    runtime.state.selectedInvestmentStockTicker,
                    runtime.buildSafeInvestmentStockDetailRows(
                        runtime.state.investmentProcessedTransactionsCache,
                        runtime.state.selectedInvestmentStockTicker,
                    )
                );
            }
        });
    });
});
