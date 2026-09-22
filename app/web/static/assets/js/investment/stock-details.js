/**
 * Investment stock-details composition and chart runtime.
 *
 * Code version: v0.38.2
 * - Changed: Loads Investment data utilities v1.120.3 and the shared stable
 *   replay-order helpers.
 * - Optimized: Pointer hover commits are animation-frame coalesced, static
 *   trade-marker Glow fields are cached, and theme changes update in place.
 * Historical changes are recorded in docs/INVESTMENT_FRONTEND_CHANGELOG.md.
 */

import '../backtest/distributions.js?v=backtest-distributions-v1.1.0';
import '../backtest/probability-grid.js?v=backtest-probability-grid-v0.35.0';

import {
    aggregateInvestmentScopedPositionStates,
} from './data-utils.js?v=investment-data-utils-v1.120.3';
import {
    INVESTMENT_TRADE_MARKER_GLOW_MAX_DISTANCE_PX,
    INVESTMENT_TRADE_MARKER_GLOW_MAX_NEIGHBORS,
    INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO,
    INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_RESOLUTION,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_SOFTENING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_THRESHOLD,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_VISUAL_GAIN,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_MIN_STRENGTH,
    INVESTMENT_TRADE_MARKER_MAX_RADIUS_PX,
    drawInvestmentTradeMarkerCircle,
    drawInvestmentTradeMarkerGlow,
    resolveInvestmentTradeMarkerGlowLinks,
    resolveInvestmentTradeMarkerGlowZoneFieldIntensity,
    resolveInvestmentTradeMarkerGlowZones,
    resolveInvestmentTradeMarkerColorWithAlpha,
    resolveInvestmentTradeMarkerRadius,
} from './trade-marker-glow.js?v=investment-trade-marker-glow-v1.0.2';
import {
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    buildInvestmentStockDetailsRealizedPnlTimeline,
    getInvestmentStockDetailsAveragePriceLabel,
    getInvestmentStockDetailsTransactionSessionType,
    getInvestmentTradeSessionType,
    isInvestmentStockDetailsIntradayRange,
    isInvestmentTransactionDateOnly,
    normalizeInvestmentIntradayMinuteKey,
    normalizeInvestmentStockDetailsIntradayRows,
    normalizeInvestmentRange,
    parseInvestmentIntradayTimestamp,
    resolveInvestmentStockDetailsCumulativeRealizedPnl,
    resolveInvestmentStockDetailsDailySnapshotIndex,
    resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey,
} from './stock-details-range.js?v=investment-stock-details-range-v1.0.0';
import {
    createInvestmentStockDetailsMetrics,
} from './stock-details-metrics.js?v=investment-stock-details-metrics-v1.1.0';

const aggregateInvestmentStockDetailPositionStates = aggregateInvestmentScopedPositionStates;

export const INVESTMENT_STOCK_DETAILS_MODULE_VERSION = 'v0.38.2';

export {
    INVESTMENT_TRADE_MARKER_GLOW_MAX_DISTANCE_PX,
    INVESTMENT_TRADE_MARKER_GLOW_MAX_NEIGHBORS,
    INVESTMENT_TRADE_MARKER_GLOW_MAX_PATH_DEVIATION_RATIO,
    INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_TREND_TOLERANCE_RATIO,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_BOUNDARY_SAMPLES,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_EDGE_PADDING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_RESOLUTION,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_SOFTENING_PX,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_THRESHOLD,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_FIELD_VISUAL_GAIN,
    INVESTMENT_TRADE_MARKER_GLOW_ZONE_MIN_STRENGTH,
    INVESTMENT_TRADE_MARKER_MAX_RADIUS_PX,
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    buildInvestmentStockDetailsRealizedPnlTimeline,
    drawInvestmentTradeMarkerCircle,
    drawInvestmentTradeMarkerGlow,
    getInvestmentStockDetailsAveragePriceLabel,
    getInvestmentStockDetailsTransactionSessionType,
    getInvestmentTradeSessionType,
    isInvestmentStockDetailsIntradayRange,
    isInvestmentTransactionDateOnly,
    normalizeInvestmentIntradayMinuteKey,
    normalizeInvestmentStockDetailsIntradayRows,
    normalizeInvestmentRange,
    parseInvestmentIntradayTimestamp,
    resolveInvestmentStockDetailsCumulativeRealizedPnl,
    resolveInvestmentStockDetailsDailySnapshotIndex,
    resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey,
    resolveInvestmentTradeMarkerGlowLinks,
    resolveInvestmentTradeMarkerGlowZoneFieldIntensity,
    resolveInvestmentTradeMarkerGlowZones,
    resolveInvestmentTradeMarkerRadius,
};


export {
    aggregateInvestmentScopedPositionStates as aggregateInvestmentStockDetailPositionStates,
};

export function drawInvestmentYAxisValueBadge(chartInstance, {
    y,
    value,
    formattedValue,
    formatTickLabel = (tickValue) => String(tickValue ?? ''),
    fillColor = '#0055cc',
    boundsProperty = '',
    boundsAliases = {},
} = {}) {
    const sharedDrawer = globalThis.WORTHWARD_CHART_AXIS?.drawYAxisValueBadge;
    if (typeof sharedDrawer !== 'function') return null;
    return sharedDrawer(chartInstance, {
        y,
        value,
        formattedValue,
        formatTickLabel,
        fillColor,
        boundsProperty,
        boundsAliases,
    });
}

export function createInvestmentStockDetailsUtils({
    INVESTMENT_SURFACE_LAYOUT_SETTLE_MS,
    adjustTradePriceForRenderedSeries,
    applyInvestmentTransactionToState,
    buildInvestmentFxRateTimeline,
    buildInvestmentAxisTickIndexes,
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    buildRenderedSplitFactorHints,
    buildTickerPriceIndex,
    clearInvestmentHistoryHighlights,
    clearInvestmentStockDetailHighlights,
    clearInvestmentStockDetailsVisibleLayoutTimer,
    compareInvestmentTransactions,
    sortInvestmentTransactionsForReplay,
    sortInvestmentTaxLotTransactions,
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
    getInvestmentChartPointsCache,
    getInvestmentCanonicalTicker,
    getInvestmentMarketStoreTickerCandidates,
    getInvestmentProcessedTransactionsCache,
    getInvestmentStockDetailsPnlSummary = () => null,
    getInvestmentStockDetailsPanel,
    getInvestmentStockDetailsPriceChartInstance,
    getInvestmentStockDetailsPriceChartRequestSerial,
    getInvestmentStockDetailsRangeLabels,
    getInvestmentLiveSessionDateKey,
    getInvestmentStockDetailsRealtimePulseTarget = () => null,
    getInvestmentTradeSessionType,
    getMoneyMarketTickerSet,
    getNormalizedTransactionType,
    getSelectedInvestmentStockDetailsRange,
    getTickerQuoteCurrency,
    getTransactionAmount,
    getTransactionBrokerCode,
    getTransactionBrokerRealizedPnl,
    getTransactionCommission,
    getTransactionEffectiveUnitPrice,
    getTransactionPrice,
    getTransactionQuantity,
    getTransactionLotScope,
    getTransactionLotScopeKey,
    getTransactionValuationQuantity,
    getSignedMetricClass = () => '',
    incrementInvestmentStockDetailsPriceChartRequestSerial,
    isFlatPosition,
    isInvestmentStockDetailsIntradayRange,
    loadInvestmentStockDetailsIntradayRows,
    normalizeInvestmentLedgerNos,
    normalizeInvestmentStockDetailsRange,
    normalizeInvestmentTicker,
    normalizeInvestmentIntradayMinuteKey,
    normalizeLedgerDate,
    normalizePriceHistoryPayload,
    renderInvestmentBrokerCell,
    resolveInvestmentTheme,
    setActiveStockDetailsHoverPointRecord,
    setInvestmentStockDetailsPriceChartInstance,
    shouldRunInvestmentRealtimeQuotes = () => false,
    shouldTrackHoldingTicker,
    syncInvestmentHoverLinkedViews,
    syncInvestmentStockDetailsDonutFromInteraction,
    syncInvestmentSharePreview,
    waitForInvestmentStableElementBox,
}) {
    function buildInvestmentStockDetailRows(processedTransactions, ticker) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker) return [];
        const sourceTransactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const stockStates = new Map();
        const moneyMarketTickers = getMoneyMarketTickerSet();
        const priceHistoryRows = window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(processedTransactions, tickerPriceIndex);
        let lastKnownTickerPrice = null;
        const detailRowsBySourceIndex = new Map();
        const sourceIndexes = new Map(
            sourceTransactions.map((txn, sourceIndex) => [txn, sourceIndex]),
        );
        sortInvestmentTaxLotTransactions(
            sourceTransactions.filter(
                (txn) => getInvestmentCanonicalTicker(txn?.ticker) === normalizedTicker,
            ),
        ).forEach((txn) => {
            const sourceIndex = sourceIndexes.get(txn);
            const normalizedType = getNormalizedTransactionType(txn);
            const lotScopeKey = getTransactionLotScopeKey(txn, normalizedTicker);
            if (!stockStates.has(lotScopeKey)) {
                stockStates.set(lotScopeKey, createPositionState(normalizedTicker));
            }
            const stockState = stockStates.get(lotScopeKey);
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const transactionPrice = getTransactionPrice(txn);
            let realizedPnl = null;
            const computedRealizedPnl = applyInvestmentTransactionToState(
                stockState,
                txn,
                normalizedType,
                valuationQuantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                },
            );
            if (normalizedType === 'sell') {
                realizedPnl = getTransactionBrokerRealizedPnl(txn) ?? computedRealizedPnl;
            } else if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                realizedPnl = computedRealizedPnl;
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
            detailRowsBySourceIndex.set(sourceIndex, {
                ...txn,
                rowMarketValue,
                rowRealizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
            });
        });
        return sourceTransactions
            .map((txn, sourceIndex) => detailRowsBySourceIndex.get(sourceIndex) || null)
            .filter(Boolean)
            .reverse();
    }

    const {
        buildInvestmentStockDetailBrokerMetrics,
        getInvestmentStockDetailsAutoRangeContext,
        getStockDetailRealizedBreakdown,
    } = createInvestmentStockDetailsMetrics({
        applyInvestmentTransactionToState,
        buildInvestmentFxRateTimeline,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        compareInvestmentTransactions,
        sortInvestmentTaxLotTransactions,
        sortInvestmentTransactionsForReplay,
        convertAmountToBaseCurrency,
        createPositionState,
        formatHoldingsMoney,
        formatHoldingsPosition,
        formatMetricLossAmount,
        formatMetricLossAmountWithCurrency,
        formatTransactionCurrency,
        getInvestmentBaseCurrency,
        getInvestmentBrokerMeta,
        getInvestmentCanonicalTicker,
        getInvestmentProcessedTransactionsCache,
        getNormalizedTransactionType,
        getTickerQuoteCurrency,
        getTransactionAmount,
        getTransactionBrokerCode,
        getTransactionCommission,
        getTransactionEffectiveUnitPrice,
        getTransactionLotScope,
        getTransactionLotScopeKey,
        getTransactionQuantity,
        getTransactionValuationQuantity,
        isFlatPosition,
        normalizeInvestmentLedgerDate: normalizeLedgerDate,
        normalizePriceHistoryPayload,
    });
    function destroyInvestmentStockDetailsPriceChart() {
        clearInvestmentStockDetailsVisibleLayoutTimer();
        const chartInstance = getInvestmentStockDetailsPriceChartInstance();
        if (chartInstance) {
            const chartCanvas = chartInstance.canvas;
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
            if (Number.isInteger(chartCanvas?._hoverSyncRaf) && chartCanvas._hoverSyncRaf > 0) {
                window.cancelAnimationFrame(chartCanvas._hoverSyncRaf);
                chartCanvas._hoverSyncRaf = 0;
            }
            if (Number.isInteger(chartCanvas?._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                window.clearTimeout(chartCanvas._layoutSyncTimer);
                chartCanvas._layoutSyncTimer = 0;
            }
            chartCanvas._scheduleLayoutSync = null;
            chartCanvas._syncInvestmentStockDetailsRealtimePulse = null;
            chartCanvas._syncInvestmentStockDetailsTheme = null;
            chartCanvas._investmentStockDetailsChart = null;
            chartInstance.destroy();
            setInvestmentStockDetailsPriceChartInstance(null);
        }
        setActiveStockDetailsHoverPointRecord(null);
    }

    async function renderInvestmentStockDetailsPriceChart(ticker, detailRows = []) {
        const investmentStockDetailsPanel = getInvestmentStockDetailsPanel();
        const chartHost = investmentStockDetailsPanel?.querySelector('[data-investment-stock-price-chart]');
        if (!(chartHost instanceof HTMLElement)) {
            destroyInvestmentStockDetailsPriceChart();
            return;
        }

        destroyInvestmentStockDetailsPriceChart();
        const renderRequestId = incrementInvestmentStockDetailsPriceChartRequestSerial();
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker || !window.Chart) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }

        const pnlSummary = getInvestmentStockDetailsPnlSummary(normalizedTicker) || {};
        const baseCurrency = getInvestmentBaseCurrency();
        const quoteCurrency = String(
            pnlSummary.quoteCurrency || getTickerQuoteCurrency(normalizedTicker) || baseCurrency,
        ).trim().toUpperCase() || baseCurrency;
        const processedTransactions = getInvestmentProcessedTransactionsCache();
        const orderedTransactions = sortInvestmentTransactionsForReplay(
            Array.isArray(processedTransactions) ? processedTransactions : [],
        );
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const canonicalReconciliation = pnlSummary.realizedPnlReconciliation;
        const realizedPnlByDate = (
            canonicalReconciliation
            && Object.prototype.hasOwnProperty.call(canonicalReconciliation, 'realizedPnlByDate')
        ) ? canonicalReconciliation.realizedPnlByDate : pnlSummary.realizedPnlByDate;
        const realizedPnlTimeline = buildInvestmentStockDetailsRealizedPnlTimeline(
            realizedPnlByDate,
            normalizeLedgerDate,
        );
        const fallbackRealizedPnl = Number(
            canonicalReconciliation
            && Object.prototype.hasOwnProperty.call(canonicalReconciliation, 'realizedPnl')
                ? canonicalReconciliation.realizedPnl
                : pnlSummary.realizedPnl,
        );
        const resolveHistoricalRealizedPnl = (ledgerDate, isLatestPoint = false) => {
            if (pnlSummary.pnlUnavailable === true) return null;
            if (realizedPnlTimeline.length) {
                return resolveInvestmentStockDetailsCumulativeRealizedPnl(realizedPnlTimeline, ledgerDate);
            }
            // A broker-only total cannot be truthfully allocated to earlier points.
            if (!Number.isFinite(fallbackRealizedPnl)) return null;
            if (Math.abs(fallbackRealizedPnl) <= 1e-9 || isLatestPoint) return fallbackRealizedPnl;
            return null;
        };
        const resolveHistoricalUnrealizedPnl = (snapshot, ledgerDate) => {
            if (pnlSummary.pnlUnavailable === true) return null;
            const shares = Number(snapshot?.shares);
            const closePrice = Number(snapshot?.close);
            const averagePrice = Number(snapshot?.averagePrice);
            if (
                !ledgerDate
                || !Number.isFinite(shares)
                || Math.abs(shares) <= 1e-9
                || !Number.isFinite(closePrice)
                || !Number.isFinite(averagePrice)
            ) {
                return null;
            }
            const unrealizedPnlLocal = shares > 0
                ? (closePrice - averagePrice) * shares
                : (averagePrice - closePrice) * Math.abs(shares);
            const unrealizedPnl = convertAmountToBaseCurrency(
                unrealizedPnlLocal,
                quoteCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            return Number.isFinite(unrealizedPnl) ? unrealizedPnl : null;
        };

        const normalizedRange = normalizeInvestmentStockDetailsRange(getSelectedInvestmentStockDetailsRange());
        const allowRealtimeData = shouldRunInvestmentRealtimeQuotes();
        let intradayRows = [];
        if (isInvestmentStockDetailsIntradayRange(normalizedRange)) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Loading 1-minute price history...</div>';
            try {
                intradayRows = await loadInvestmentStockDetailsIntradayRows(normalizedTicker, normalizedRange);
            } catch (error) {
                console.warn(error);
                intradayRows = [];
            }
            if (renderRequestId !== getInvestmentStockDetailsPriceChartRequestSerial()) return;
        }

        const priceHistoryByTicker = normalizePriceHistoryPayload(window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {});
        const tickerPriceIndex = buildTickerPriceIndex(priceHistoryByTicker);
        const tickerPriceMap = getInvestmentMarketStoreTickerCandidates(normalizedTicker).reduce((selectedMap, candidate) => {
            if (selectedMap && Object.keys(selectedMap).length) return selectedMap;
            const candidateMap = priceHistoryByTicker[candidate];
            return candidateMap && typeof candidateMap === 'object' ? candidateMap : selectedMap;
        }, null) || {};
        const tickerLabels = Object.keys(tickerPriceMap).sort();
        const fullLabels = constrainTickerDatesToSharedRange(tickerLabels);
        const useIntradayCandles = Array.isArray(intradayRows) && intradayRows.length > 0;
        const stockDetailsAutoRangeContext = getInvestmentStockDetailsAutoRangeContext(normalizedTicker, detailRows);
        let labels = useIntradayCandles
            ? intradayRows.map((row) => String(row?.date || ''))
            : getInvestmentStockDetailsRangeLabels(fullLabels, normalizedRange, stockDetailsAutoRangeContext);
        let closeValues = useIntradayCandles
            ? labels.map((_, index) => {
                const close = Number(intradayRows[index]?.close);
                return Number.isFinite(close) && close > 0 ? close : null;
            })
            : labels.map((date) => {
                const close = Number(tickerPriceMap[date]);
                return Number.isFinite(close) && close > 0 ? close : null;
            });
        if (!useIntradayCandles) {
            const liveDateKey = typeof getInvestmentLiveSessionDateKey === 'function'
                ? getInvestmentLiveSessionDateKey()
                : '';
            if (liveDateKey && !labels.some((label) => normalizeLedgerDate(label) === liveDateKey)) {
                const lastFiniteClose = [...closeValues].reverse().find((value) => Number.isFinite(value) && value > 0);
                const fallbackClose = Number(
                    tickerPriceMap[liveDateKey]
                    ?? tickerPriceMap[labels[labels.length - 1]]
                    ?? lastFiniteClose
                );
                labels = [...labels, liveDateKey];
                closeValues = [
                    ...closeValues,
                    Number.isFinite(fallbackClose) && fallbackClose > 0 ? fallbackClose : null,
                ];
            }
        }
        const openValues = useIntradayCandles
            ? labels.map((_, index) => {
                const open = Number(intradayRows[index]?.open);
                return Number.isFinite(open) && open > 0 ? open : null;
            })
            : [];
        const highValues = useIntradayCandles
            ? labels.map((_, index) => {
                const high = Number(intradayRows[index]?.high);
                return Number.isFinite(high) && high > 0 ? high : null;
            })
            : [];
        const lowValues = useIntradayCandles
            ? labels.map((_, index) => {
                const low = Number(intradayRows[index]?.low);
                return Number.isFinite(low) && low > 0 ? low : null;
            })
            : [];
        if (
            (!tickerLabels.length && !useIntradayCandles)
            || !closeValues.some((value) => Number.isFinite(value) && value > 0)
        ) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }
        const latestVisibleLabel = String(labels[labels.length - 1] || '');
        const latestAvailableLabel = String(
            useIntradayCandles
                ? intradayRows[intradayRows.length - 1]?.date || ''
                : fullLabels[fullLabels.length - 1] || ''
        );
        const shouldRenderRealtimePulse = Boolean(
            allowRealtimeData
            && latestVisibleLabel
            && latestAvailableLabel
            && latestVisibleLabel === latestAvailableLabel
            && !(normalizedRange === 'auto' && stockDetailsAutoRangeContext?.isOpenPosition === false)
        );
        const getRealtimePulseTarget = () => {
            if (!shouldRenderRealtimePulse || typeof getInvestmentStockDetailsRealtimePulseTarget !== 'function') {
                return null;
            }
            const target = getInvestmentStockDetailsRealtimePulseTarget(normalizedTicker);
            const price = Number(target?.price);
            return Number.isFinite(price) && price > 0 ? { ...target, price } : null;
        };

        await waitForInvestmentStableElementBox(chartHost, {
            minimumWidth: 160,
            minimumHeight: 180,
        });
        if (renderRequestId !== getInvestmentStockDetailsPriceChartRequestSerial()) return;

        chartHost.innerHTML = `
            <div class="investment-stock-details-price-chart-stage">
                <canvas class="investment-stock-details-price-chart-canvas"></canvas>
                <div class="trade-chart-hover-date-label investment-equity-hover-date-label" data-investment-stock-details-hover-date-label aria-hidden="true" hidden><span></span><span></span></div>
                <div class="investment-stock-details-live-marker" data-investment-stock-details-live-marker hidden aria-hidden="true">
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-outer"></span>
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-inner"></span>
                    <span class="investment-stock-details-live-marker-core"></span>
                </div>
            </div>
        `;
        const canvas = chartHost.querySelector('canvas');
        const hoverDateLabel = chartHost.querySelector('[data-investment-stock-details-hover-date-label]');
        const realtimeMarkerElement = chartHost.querySelector('[data-investment-stock-details-live-marker]');
        if (!(canvas instanceof HTMLCanvasElement)) return;

        const chronologicalRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(chronologicalRows, tickerPriceIndex);
        const dateIndex = new Map();
        labels.forEach((value, index) => {
            dateIndex.set(String(value), index);
            const minuteKey = normalizeInvestmentIntradayMinuteKey(value);
            if (minuteKey) dateIndex.set(minuteKey, index);
        });
        const intradayDayFallbackIndex = buildInvestmentIntradayDayFallbackIndex(labels);
        const intradayDayBoundaries = buildInvestmentIntradayDayBoundaries(labels);
        const getTransactionDatetimeValue = (txn) => String(txn?.datetime || txn?.date || '').trim();
        const getTransactionSessionType = (txn, datetimeValue) => (
            getInvestmentStockDetailsTransactionSessionType(
                txn,
                datetimeValue,
                getInvestmentTradeSessionType,
            )
        );
        const getNextVisibleIntradayDayBoundary = (ledgerDate) => {
            const normalizedLedgerDate = normalizeLedgerDate(ledgerDate);
            if (!normalizedLedgerDate) return null;
            return intradayDayBoundaries.orderedDays.find((dayBoundary) => dayBoundary.dayKey > normalizedLedgerDate) || null;
        };
        const resolveIntradayDayBoundaryForTransaction = (txn, sessionType) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            const datetimeMatch = getTransactionDatetimeValue(txn).match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
            const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
            const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
            const totalMinutes = Number.isInteger(hour) && Number.isInteger(minute)
                ? (hour * 60) + minute
                : null;
            if (sessionType === 'night' && Number.isFinite(totalMinutes) && totalMinutes >= 20 * 60) {
                return getNextVisibleIntradayDayBoundary(ledgerDate);
            }
            return intradayDayBoundaries.dayMap.get(ledgerDate) || null;
        };
        const getTransactionTotalMinutes = (txn) => {
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const datetimeMatch = transactionDatetimeValue.match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
            const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
            const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
            return Number.isInteger(hour) && Number.isInteger(minute)
                ? (hour * 60) + minute
                : null;
        };
        const resolveTrailingOffHoursDayBoundaryForTransaction = (txn, sessionType) => {
            const lastVisibleDayBoundary = intradayDayBoundaries.orderedDays.at(-1) || null;
            const anchorDayKey = resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
                txn,
                sessionType,
                lastVisibleDayBoundary?.dayKey,
            );
            return anchorDayKey
                ? intradayDayBoundaries.dayMap.get(anchorDayKey) || null
                : null;
        };
        const isTransactionBeforeVisibleRange = (txn) => {
            if (!labels.length) return false;
            const firstVisibleLedgerDate = normalizeLedgerDate(labels[0]);
            const transactionLedgerDate = normalizeLedgerDate(txn?.date);
            if (!firstVisibleLedgerDate || !transactionLedgerDate) return false;
            return transactionLedgerDate < firstVisibleLedgerDate;
        };
        const isTransactionAfterVisibleRange = (txn) => {
            if (!labels.length) return false;
            const lastVisibleLedgerDate = normalizeLedgerDate(labels[labels.length - 1]);
            const transactionLedgerDate = normalizeLedgerDate(txn?.date);
            if (!lastVisibleLedgerDate || !transactionLedgerDate) return false;
            if (transactionLedgerDate > lastVisibleLedgerDate) return true;
            if (transactionLedgerDate < lastVisibleLedgerDate) return false;
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const sessionType = getTransactionSessionType(txn, transactionDatetimeValue);
            const totalMinutes = getTransactionTotalMinutes(txn);
            return sessionType === 'night' && Number.isFinite(totalMinutes) && totalMinutes >= 20 * 60;
        };
        const resolveTradeMarkerPrice = (markerIndex, transactionPrice) => {
            const normalizedTransactionPrice = Number(transactionPrice);
            const normalizedClosePrice = Number(closeValues[markerIndex]);
            if (Number.isFinite(normalizedTransactionPrice) && normalizedTransactionPrice > 0) {
                return adjustTradePriceForRenderedSeries(normalizedTransactionPrice, normalizedClosePrice);
            }
            return Number.isFinite(normalizedClosePrice) && normalizedClosePrice > 0
                ? normalizedClosePrice
                : null;
        };
        const resolveTradeMarkerAmount = (txn, fallbackPrice = null) => {
            const transactionAmount = Number(getTransactionAmount(txn));
            if (Number.isFinite(transactionAmount) && Math.abs(transactionAmount) > 1e-9) {
                return Math.abs(transactionAmount);
            }
            const quantity = Math.abs(Number(getTransactionQuantity(txn)));
            const transactionPrice = Number(getTransactionPrice(txn));
            const price = Math.abs(
                Number.isFinite(transactionPrice) && transactionPrice > 0
                    ? transactionPrice
                    : Number(fallbackPrice),
            );
            if (
                Number.isFinite(quantity)
                && quantity > 0
                && Number.isFinite(price)
                && price > 0
            ) {
                return quantity * price;
            }
            return 0;
        };
        const tradeMarkerPoints = chronologicalRows.reduce((accumulator, txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(normalizedType)) return accumulator;
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const transactionSessionType = getTransactionSessionType(txn, transactionDatetimeValue);
            const trailingOffHoursDayBoundary = useIntradayCandles
                ? resolveTrailingOffHoursDayBoundaryForTransaction(txn, transactionSessionType)
                : null;
            if (
                useIntradayCandles
                && (
                    isTransactionBeforeVisibleRange(txn)
                    || (isTransactionAfterVisibleRange(txn) && !trailingOffHoursDayBoundary)
                )
            ) {
                return accumulator;
            }
            const exactMinuteKey = normalizeInvestmentIntradayMinuteKey(transactionDatetimeValue);
            const transactionPrice = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            let markerIndex = null;
            let markerPlacement = 'bar';
            let markerSessionType = 'intraday';
            let markerPrice = null;
            let markerAnchorDayKey = ledgerDate;
            if (useIntradayCandles) {
                markerSessionType = transactionSessionType;
                const exactMinuteIndex = dateIndex.get(exactMinuteKey);
                if (Number.isInteger(exactMinuteIndex)) {
                    markerIndex = exactMinuteIndex;
                    markerPrice = resolveTradeMarkerPrice(exactMinuteIndex, transactionPrice);
                } else if (trailingOffHoursDayBoundary) {
                    markerPlacement = 'trailing-gap';
                    markerIndex = trailingOffHoursDayBoundary.lastIndex;
                    markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                } else if (markerSessionType !== 'intraday') {
                    const dayBoundary = resolveIntradayDayBoundaryForTransaction(txn, markerSessionType);
                    if (dayBoundary) {
                        markerPlacement = 'gap';
                        markerAnchorDayKey = dayBoundary.dayKey;
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
                markerIndex = resolveInvestmentStockDetailsDailySnapshotIndex(
                    ledgerDate,
                    labels,
                    normalizeLedgerDate,
                );
                if (Number.isInteger(markerIndex)) {
                    markerPrice = resolveTradeMarkerPrice(markerIndex, transactionPrice);
                }
            }
            if (!Number.isInteger(markerIndex)) return accumulator;
            if (!Number.isFinite(markerPrice)) return accumulator;
            const marker = {
                index: markerIndex,
                x: labels[markerIndex],
                y: markerPrice,
                type: normalizedType,
                amount: resolveTradeMarkerAmount(txn, markerPrice),
                quantity: Math.abs(Number(getTransactionQuantity(txn))),
                placement: markerPlacement,
                sessionType: markerSessionType,
                ledgerDate,
                anchorDayKey: trailingOffHoursDayBoundary?.dayKey || markerAnchorDayKey,
                transactionPrice: Number.isFinite(transactionPrice) ? transactionPrice : null,
            };
            if (normalizedType === 'buy') accumulator.buy.push(marker);
            if (normalizedType === 'sell') accumulator.sell.push(marker);
            return accumulator;
        }, { buy: [], sell: [] });
        const maxTradeMarkerAmount = Math.max(
            0,
            ...[...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell]
                .map((marker) => Number(marker?.amount))
                .filter((amount) => Number.isFinite(amount) && amount > 0),
        );
        const shouldReserveTrailingOffHoursGap = Boolean(
            useIntradayCandles
            && [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell]
                .some((marker) => marker?.placement === 'trailing-gap'),
        );
        const resolveAveragePriceSnapshotIndex = (txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return null;
            if (useIntradayCandles) {
                if (isTransactionBeforeVisibleRange(txn) || isTransactionAfterVisibleRange(txn)) return null;
                const transactionDatetimeValue = getTransactionDatetimeValue(txn);
                const exactMinuteIndex = dateIndex.get(normalizeInvestmentIntradayMinuteKey(transactionDatetimeValue));
                if (Number.isInteger(exactMinuteIndex)) return exactMinuteIndex;
                const sessionType = getTransactionSessionType(txn, transactionDatetimeValue);
                const dayBoundary = resolveIntradayDayBoundaryForTransaction(txn, sessionType);
                if (dayBoundary) {
                    if (sessionType === 'post') {
                        return dayBoundary.lastIndex;
                    }
                    if (sessionType === 'pre' || sessionType === 'night') {
                        return dayBoundary.firstIndex;
                    }
                }
                const fallbackIndex = intradayDayFallbackIndex.get(ledgerDate);
                return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
            }
            return resolveInvestmentStockDetailsDailySnapshotIndex(
                ledgerDate,
                labels,
                normalizeLedgerDate,
            );
        };
        const preRangeTransactions = [];
        const transactionsBySnapshotIndex = chronologicalRows.reduce((accumulator, txn) => {
            const snapshotIndex = resolveAveragePriceSnapshotIndex(txn);
            if (!Number.isInteger(snapshotIndex)) {
                if (isTransactionBeforeVisibleRange(txn)) {
                    preRangeTransactions.push(txn);
                }
                return accumulator;
            }
            if (!accumulator.has(snapshotIndex)) accumulator.set(snapshotIndex, []);
            accumulator.get(snapshotIndex).push(txn);
            return accumulator;
        }, new Map());
        const stockSnapshotsByDate = new Map();
        const investmentPointByDate = new Map((Array.isArray(getInvestmentChartPointsCache()) ? getInvestmentChartPointsCache() : [])
            .map((point) => [normalizeLedgerDate(point?.date), point])
            .filter(([date]) => Boolean(date)));
        const stockStates = new Map();
        const renderedStockStates = new Map();
        const getStockDetailScopeKey = (txn) => (
            getTransactionLotScopeKey(txn, normalizedTicker)
            || `ticker:${normalizedTicker}`
        );
        const getOrCreateStockState = (states, scopeKey) => {
            if (!states.has(scopeKey)) states.set(scopeKey, createPositionState(normalizedTicker));
            return states.get(scopeKey);
        };
        const averagePriceSeries = [];
        const applyStockDetailsTransactionToStates = (txn, renderIndex = null) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const scopeKey = getStockDetailScopeKey(txn);
            const stockState = getOrCreateStockState(stockStates, scopeKey);
            const renderedStockState = getOrCreateStockState(renderedStockStates, scopeKey);
            const lotScope = getTransactionLotScope(txn, normalizedTicker);
            stockState.lotScope = lotScope;
            renderedStockState.lotScope = lotScope;
            const quantity = Number(getTransactionValuationQuantity(
                txn,
                tickerPriceIndex,
                renderedSplitFactorHints,
            ));
            const effectiveUnitPrice = getTransactionEffectiveUnitPrice(txn, quantity);
            const renderedEffectiveUnitPrice = Number.isInteger(renderIndex)
                ? resolveTradeMarkerPrice(renderIndex, effectiveUnitPrice)
                : effectiveUnitPrice;
            applyInvestmentTransactionToState(
                stockState,
                txn,
                normalizedType,
                quantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {unitPriceOverride: effectiveUnitPrice},
            );
            applyInvestmentTransactionToState(
                renderedStockState,
                txn,
                normalizedType,
                quantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: Number.isFinite(renderedEffectiveUnitPrice)
                        ? renderedEffectiveUnitPrice
                        : effectiveUnitPrice,
                },
            );
            if (normalizedType === 'buy' && Number.isFinite(quantity) && quantity > 0) {
                return { buyQuantity: quantity, sellQuantity: 0 };
            }
            if (normalizedType === 'sell' && Number.isFinite(quantity) && quantity > 0) {
                return { buyQuantity: 0, sellQuantity: quantity };
            }
            return { buyQuantity: 0, sellQuantity: 0 };
        };
        preRangeTransactions.forEach((txn) => {
            applyStockDetailsTransactionToStates(txn);
        });
        labels.forEach((label, index) => {
            const snapshotTxns = transactionsBySnapshotIndex.get(index) || [];
            let buyQuantity = 0;
            let sellQuantity = 0;
            snapshotTxns.forEach((txn) => {
                const deltas = applyStockDetailsTransactionToStates(txn, index);
                buyQuantity += deltas.buyQuantity;
                sellQuantity += deltas.sellQuantity;
            });
            const buySellLedgerNos = snapshotTxns
                .filter((txn) => ['buy', 'sell'].includes(getNormalizedTransactionType(txn)))
                .map((txn) => Number(txn?.ledger_no))
                .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                .sort((left, right) => right - left);
            const aggregateState = aggregateInvestmentStockDetailPositionStates(
                stockStates,
                normalizedTicker,
                getTickerQuoteCurrency,
            );
            const renderedAggregateState = aggregateInvestmentStockDetailPositionStates(
                renderedStockStates,
                normalizedTicker,
                getTickerQuoteCurrency,
            );
            const close = Number(closeValues[index]);
            const averagePrice = Number(aggregateState.averagePrice);
            averagePriceSeries.push(
                Number.isFinite(averagePrice) && averagePrice > 0
                    ? averagePrice
                    : null,
            );
            stockSnapshotsByDate.set(String(label), {
                shares: Number.isFinite(aggregateState.shares) ? aggregateState.shares : 0,
                close: Number.isFinite(close) ? close : null,
                averagePrice: Number.isFinite(averagePrice)
                    ? averagePrice
                    : null,
                buyQuantity,
                sellQuantity,
                buySellLedgerNos,
            });
        });

        const resolvedTheme = resolveInvestmentTheme();
        const applyCanvasAlpha = resolveInvestmentTradeMarkerColorWithAlpha;
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
        const formatAxisDateOnlyLines = (dateParts) => {
            if (!dateParts) return ['', ''];
            return formatInvestmentFullDateLines({
                year: dateParts.year,
                monthIndex: dateParts.monthIndex,
                day: dateParts.day,
                hours: null,
                minutes: null,
            }, { allowWrap: true });
        };
        const buildIntradayCenteredAxisTicks = () => {
            if (!useIntradayCandles || normalizedRange !== '1w') return [];
            return intradayDayBoundaries.orderedDays
                .map((dayBoundary) => {
                    const firstIndex = Number(dayBoundary?.firstIndex);
                    const lastIndex = Number(dayBoundary?.lastIndex);
                    if (!Number.isInteger(firstIndex) || !Number.isInteger(lastIndex)) return null;
                    const labelIndex = Math.round((firstIndex + lastIndex) / 2);
                    const parsedDate = parseRawDate(labels[firstIndex] || labels[labelIndex]);
                    if (!parsedDate) return null;
                    return {
                        firstIndex,
                        lastIndex,
                        labelIndex,
                        parsedDate,
                    };
                })
                .filter(Boolean);
        };
        const chartAxis = (typeof window !== "undefined" && window.WORTHWARD_CHART_AXIS) || {};
        // `chart-axis-utils.js` owns the one tick-selection algorithm.
        // base.html loads it before every chart consumer.
        const buildTickIndexSet = (count, plotWidth) => chartAxis.buildTickIndexSet(count, plotWidth);
        const STOCK_DETAILS_MARKER_X_PADDING_PX = INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX;
        const STOCK_DETAILS_MARKER_Y_PADDING_PX = INVESTMENT_TRADE_MARKER_GLOW_SAFE_PADDING_PX;
        const getStockDetailsChartYScaleValues = () => ([
            ...openValues,
            ...highValues,
            ...lowValues,
            ...closeValues,
            ...averagePriceSeries,
            ...tradeMarkerPoints.buy.map((marker) => marker.y),
            ...tradeMarkerPoints.sell.map((marker) => marker.y),
            getRealtimePulseTarget()?.price,
        ]);
        const buildPixelPaddedYScale = (chartCanvas, values, paddingPx) => {
            const finiteValues = (Array.isArray(values) ? values : [])
                .filter((value) => value !== null && value !== undefined && value !== '')
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0);
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
        const formatStockDetailsYAxisTickLabel = (value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '';
            if (typeof chartAxis.formatStockPriceAxisValue === 'function') {
                return chartAxis.formatStockPriceAxisValue(numericValue);
            }
            const fractionDigits = Math.abs(numericValue) >= 100 ? 0 : 2;
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
                const intradayCenteredTicks = buildIntradayCenteredAxisTicks();
                if (intradayCenteredTicks.length) {
                    const baselineY = chartArea.bottom;
                    const lineHeight = 10;
                    ctx.save();
                    ctx.fillStyle = resolvedTheme.muted;
                    ctx.font = `400 12px ${getComputedStyle(document.body).fontFamily}`;
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'center';
                    intradayCenteredTicks.forEach((tick) => {
                        const leftX = xScale.getPixelForValue(tick.firstIndex);
                        const rightX = xScale.getPixelForValue(tick.lastIndex);
                        const fallbackX = xScale.getPixelForValue(tick.labelIndex);
                        const x = Number.isFinite(leftX) && Number.isFinite(rightX)
                            ? (leftX + rightX) / 2
                            : fallbackX;
                        if (!Number.isFinite(x)) return;
                        const [firstLine, secondLine] = formatAxisDateOnlyLines(tick.parsedDate);
                        ctx.fillText(firstLine, x, baselineY);
                        ctx.fillText(secondLine, x, baselineY + lineHeight);
                    });
                    ctx.restore();
                    return;
                }
                const tickIndexes = typeof buildInvestmentAxisTickIndexes === 'function'
                    ? buildInvestmentAxisTickIndexes(labels, labels, viewportWidth, parseRawDate)
                    : Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = `400 12px ${getComputedStyle(document.body).fontFamily}`;
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
            afterDestroy() {
                hoverDateLabel?.remove();
            },
            beforeDatasetsDraw(chartInstance) {
                const { ctx, chartArea } = chartInstance;
                const y = chartInstance?._activeInvestmentStockDetailsGuideY;
                if (!chartArea || !Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                const { left, right } = chartArea;
                chartInstance._activeInvestmentStockDetailsGuideBounds = { left, right, y };
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
                ctx.stroke();
                ctx.restore();
            },
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, scales, tooltip } = chartInstance;
                const x = chartInstance._activeInvestmentStockDetailsGuideX;
                const dateParts = parseRawDate(labels[chartInstance._activeInvestmentStockDetailsGuideIndex]);
                const rect = canvas.getBoundingClientRect();
                const stage = canvas.parentElement;
                window.WORTHWARD_CHART_AXIS.updateHoverDateLabel(hoverDateLabel, {
                    lines: chartArea && tooltip?.opacity && Number.isFinite(x) && dateParts
                        ? formatAxisDateOnlyLines(dateParts) : null,
                    x: canvas.offsetLeft + x * rect.width / chartInstance.width,
                    top: canvas.offsetTop + (chartArea?.bottom || 0) * rect.height / chartInstance.height,
                    width: stage.clientWidth,
                });
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();

                const y = chartInstance?._activeInvestmentStockDetailsGuideY;
                const yScale = scales?.y;
                if (!yScale || !Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                const price = Number(yScale.getValueForPixel(y));
                if (!Number.isFinite(price)) return;
                const axisFractionDigits = resolveStockDetailsYAxisFractionDigits(yScale.ticks);
                const priceFractionDigits = Math.max(2, axisFractionDigits);
                const formattedPrice = new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: priceFractionDigits,
                    maximumFractionDigits: priceFractionDigits,
                }).format(price);
                drawInvestmentYAxisValueBadge(chartInstance, {
                    y,
                    value: price,
                    formattedValue: formattedPrice,
                    formatTickLabel: formatStockDetailsYAxisTickLabel,
                    fillColor: resolvedTheme.accentPrimary,
                    boundsProperty: '_activeInvestmentStockDetailsGuideBounds',
                    boundsAliases: {formattedPrice, price},
                });
            },
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
            if (!['gap', 'trailing-gap'].includes(marker?.placement) || !useIntradayCandles) {
                return Number.isFinite(fallbackX) ? { x: fallbackX, y } : null;
            }
            const dayBoundary = intradayDayBoundaries.dayMap.get(
                marker?.anchorDayKey || marker?.ledgerDate,
            );
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
            if (marker?.placement === 'trailing-gap') {
                leftX = getPointX(dayBoundary.lastIndex);
                rightX = chartArea.right;
                fraction = marker.sessionType === 'night' ? 0.5 : 0.75;
            } else if (marker?.sessionType === 'post') {
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
        const tradeMarkerGlowCache = {
            buy: {},
            sell: {},
        };
        const tradeMarkerPlugin = {
            id: 'investmentStockDetailsTradeMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                const drawMarkerGroup = (markers, color, cache) => {
                    const positionedMarkers = [];
                    (Array.isArray(markers) ? markers : []).forEach((marker) => {
                        if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.y)) return;
                        const markerPosition = resolveTradeMarkerPixelPosition(chartInstance, marker);
                        const x = Number(markerPosition?.x);
                        const y = Number(markerPosition?.y);
                        const radius = resolveInvestmentTradeMarkerRadius(
                            marker.amount,
                            maxTradeMarkerAmount,
                        );
                        if (!Number.isFinite(x) || !Number.isFinite(y) || radius <= 0) return;
                        positionedMarkers.push({
                            ...marker,
                            x,
                            y,
                            radius,
                            price: Number(marker.y),
                        });
                    });
                    drawInvestmentTradeMarkerGlow(chartInstance.ctx, {
                        markers: positionedMarkers,
                        priceValues: closeValues,
                        color,
                        cache,
                    });
                };
                drawMarkerGroup(
                    tradeMarkerPoints.buy,
                    resolvedTheme.accentPositive,
                    tradeMarkerGlowCache.buy,
                );
                drawMarkerGroup(
                    tradeMarkerPoints.sell,
                    resolvedTheme.accentSecondary,
                    tradeMarkerGlowCache.sell,
                );
            },
        };
        const realtimeEndMarkerPlugin = {
            id: 'investmentStockDetailsRealtimeEndMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                if (!shouldRenderRealtimePulse || !(realtimeMarkerElement instanceof HTMLElement)) return;
                const realtimePulseTarget = getRealtimePulseTarget();
                if (!realtimePulseTarget) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                const lastIndex = Math.max(0, labels.length - 1);
                const xScale = chartInstance.scales?.x;
                const yScale = chartInstance.scales?.y;
                const chartArea = chartInstance.chartArea;
                if (!xScale || !yScale || !chartArea) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                const x = Number(xScale.getPixelForValue(lastIndex));
                const y = Number(yScale.getPixelForValue(realtimePulseTarget.price));
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                realtimeMarkerElement.style.left = `${x}px`;
                realtimeMarkerElement.style.top = `${y}px`;
                realtimeMarkerElement.hidden = false;
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
        let activeStockDetailsHoverDate = '';
        let activeStockDetailsTooltipPresentation = '';
        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip();
            if (tooltip.opacity === 0) {
                tooltipEl.classList.remove('is-visible');
                activeStockDetailsHoverDate = '';
                activeStockDetailsTooltipPresentation = '';
                setActiveStockDetailsHoverPointRecord(null);
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
            const tooltipPresentation = [
                pointIndex,
                String(chart?._activeInvestmentStockDetailsMarkerType || ''),
                Math.round(Number(tooltip.caretX) || 0),
                Math.round(Number(tooltip.caretY) || 0),
            ].join(':');
            if (
                tooltipPresentation === activeStockDetailsTooltipPresentation
                && tooltipEl.classList.contains('is-visible')
            ) {
                return;
            }
            activeStockDetailsTooltipPresentation = tooltipPresentation;
            setActiveStockDetailsHoverPointRecord(investmentPointByDate.get(hoverLedgerDate) || null);
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
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || '');
            const averagePrice = Number(snapshot?.averagePrice);
            const realizedPnl = resolveHistoricalRealizedPnl(
                hoverLedgerDate,
                pointIndex === labels.length - 1,
            );
            const unrealizedPnl = resolveHistoricalUnrealizedPnl(snapshot, hoverLedgerDate);
            const buildPnlRow = (label, value) => {
                const numericValue = Number(value);
                const hasValue = Number.isFinite(numericValue);
                return {
                    label,
                    value: hasValue ? formatHoldingsMoney(numericValue) : '--',
                    color: hasValue
                        ? (numericValue >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary)
                        : resolvedTheme.muted,
                    valueClass: hasValue ? getSignedMetricClass(numericValue) : '',
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                };
            };
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
                {
                    label: getInvestmentStockDetailsAveragePriceLabel(),
                    value: Number.isFinite(averagePrice) ? formatMoney(averagePrice) : '--',
                    color: resolvedTheme.muted,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                },
                buildPnlRow('Unrealized P&L', unrealizedPnl),
                buildPnlRow('Realized P&L', realizedPnl),
            ];
            if (Number.isFinite(buyQuantity) && buyQuantity > 0) {
                tooltipRows.push({
                    label: 'Buy shares',
                    value: formatShareCount(buyQuantity),
                    color: resolvedTheme.accentPositive,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            if (Number.isFinite(sellQuantity) && sellQuantity > 0) {
                tooltipRows.push({
                    label: 'Sell shares',
                    value: formatShareCount(sellQuantity),
                    color: resolvedTheme.accentSecondary,
                    bulletHtml: '<span class="chart-tooltip-dot" aria-hidden="true"></span>',
                });
            }
            listEl.innerHTML = tooltipRows.map((row) => `
                <div class="chart-tooltip-row">
                    ${row.bulletHtml.replace('class="chart-tooltip-dot"', `class="chart-tooltip-dot" style="background:${row.color}"`)}
                    <span aria-hidden="true"></span>
                    <span class="chart-tooltip-label">${row.label}</span>
                    <span class="chart-tooltip-value${row.valueClass ? ` ${row.valueClass}` : ''}">${row.value}</span>
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

        let didNotifyChartReady = false;
        const notifyChartReady = () => {
            if (didNotifyChartReady) return;
            didNotifyChartReady = true;
            if (typeof syncInvestmentSharePreview === 'function') {
                syncInvestmentSharePreview();
            }
        };

        const chartInstance = new window.Chart(canvas, {
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
                        borderWidth: useIntradayCandles ? 0 : 1.5,
                        pointRadius: 0,
                        tension: 0,
                        borderJoinStyle: 'round',
                        borderCapStyle: 'round',
                    },
                    {
                        label: `${normalizedTicker} ${getInvestmentStockDetailsAveragePriceLabel()}`,
                        data: averagePriceSeries,
                        order: 1,
                        borderColor: applyCanvasAlpha(resolvedTheme.muted, useIntradayCandles ? 0.78 : 0.5),
                        backgroundColor: applyCanvasAlpha(resolvedTheme.muted, useIntradayCandles ? 0.78 : 0.5),
                        borderWidth: useIntradayCandles ? 1.35 : 1.0,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        pointBackgroundColor: applyCanvasAlpha(resolvedTheme.muted, 0.9),
                        pointBorderColor: applyCanvasAlpha(resolvedTheme.muted, 0.9),
                        stepped: useIntradayCandles ? 'before' : false,
                        tension: 0,
                        borderJoinStyle: 'round',
                        borderCapStyle: 'round',
                        spanGaps: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: STOCK_DETAILS_MARKER_X_PADDING_PX,
                        right: shouldRenderRealtimePulse || shouldReserveTrailingOffHoursGap
                            ? 32
                            : STOCK_DETAILS_MARKER_X_PADDING_PX,
                        top: shouldRenderRealtimePulse ? 32 : STOCK_DETAILS_MARKER_Y_PADDING_PX,
                        bottom: 24,
                    },
                },
                events: [],
                interaction: { mode: 'index', intersect: false },
                animation: false,
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
            plugins: [candlestickPlugin, hoverGuidePlugin, xAxisLabelPlugin, tradeMarkerPlugin, realtimeEndMarkerPlugin],
        });
        setInvestmentStockDetailsPriceChartInstance(chartInstance);
        canvas._syncInvestmentStockDetailsTheme = () => {
            Object.assign(resolvedTheme, resolveInvestmentTheme());
            const closeDataset = chartInstance.data?.datasets?.[0];
            if (closeDataset) {
                closeDataset.borderColor = useIntradayCandles
                    ? 'transparent'
                    : resolvedTheme.accentPrimary;
            }
            const averageDataset = chartInstance.data?.datasets?.[1];
            if (averageDataset) {
                const averageColor = applyCanvasAlpha(
                    resolvedTheme.muted,
                    useIntradayCandles ? 0.78 : 0.5,
                );
                averageDataset.borderColor = averageColor;
                averageDataset.backgroundColor = averageColor;
                averageDataset.pointBackgroundColor = applyCanvasAlpha(resolvedTheme.muted, 0.9);
                averageDataset.pointBorderColor = applyCanvasAlpha(resolvedTheme.muted, 0.9);
            }
            if (chartInstance.options?.scales?.y?.ticks) {
                chartInstance.options.scales.y.ticks.color = resolvedTheme.muted;
            }
            chartInstance.update('none');
        };
        canvas._syncInvestmentStockDetailsRealtimePulse = () => {
            const yScale = chartInstance.options?.scales?.y;
            if (!yScale) return;
            const nextYScale = buildPixelPaddedYScale(
                canvas,
                getStockDetailsChartYScaleValues(),
                STOCK_DETAILS_MARKER_Y_PADDING_PX,
            );
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
            chartInstance.update('none');
        };
        const readyScheduler = window.WorthwardMotion?.scheduler;
        if (readyScheduler?.frame) {
            let readyFrameCount = 0;
            readyScheduler.frame(`investment-stock-details-chart-ready-${renderRequestId}`, () => {
                readyFrameCount += 1;
                if (readyFrameCount < 2) return true;
                notifyChartReady();
                return false;
            });
        } else {
            window.requestAnimationFrame(() => window.requestAnimationFrame(notifyChartReady));
        }
        const TRADE_MARKER_SNAP_HORIZONTAL_BARS = 3;
        const TRADE_MARKER_SNAP_HORIZONTAL_PX = 20;
        const TRADE_MARKER_SNAP_VERTICAL_PX = 20;
        const resolveNearestHoverState = (chart, event) => {
            const chartArea = chart?.chartArea;
            if (!chartArea || !labels.length) return null;
            const canvasRect = chart.canvas.getBoundingClientRect();
            const relativeX = (event.clientX - canvasRect.left) * chart.width / canvasRect.width;
            const relativeY = (event.clientY - canvasRect.top) * chart.height / canvasRect.height;
            if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY)
                || relativeX < chartArea.left || relativeX > chartArea.right
                || relativeY < chartArea.top || relativeY > chartArea.bottom) return null;
            const points = chart.getDatasetMeta(0)?.data || [];
            const intersection = window.WORTHWARD_BACKTEST_PROBABILITY_GRID
                ?.intersectPolylineAtX(points, relativeX);
            if (!intersection) return null;
            const nearestIndex = intersection.index;
            const guideX = intersection.x;
            const guideY = intersection.y;
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
                    guideIndex: nearestIndex,
                    guideX,
                    guideY,
                    markerPosition: {
                        x: snappedMarker.pixelX,
                        y: snappedMarker.pixelY,
                    },
                };
            }
            return { index: nearestIndex, guideIndex: nearestIndex, markerType: '', guideX, guideY };
        };
        const syncStockDetailsHoverState = (chart, hoverState) => {
            const index = hoverState && Number.isInteger(hoverState.index) ? hoverState.index : null;
            chart._activeInvestmentStockDetailsGuideIndex = hoverState?.guideIndex ?? null;
            const guideX = hoverState?.guideX;
            const guideY = hoverState?.guideY;
            chart._activeInvestmentStockDetailsGuideX = Number.isFinite(guideX) ? guideX : null;
            chart._activeInvestmentStockDetailsGuideY = Number.isFinite(guideY) ? guideY : null;
            if (!Number.isFinite(guideY)) chart._activeInvestmentStockDetailsGuideBounds = null;
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
            chartCanvas._investmentStockDetailsChart = chart;
            if (chartCanvas._abortController) chartCanvas._abortController.abort();
            const controller = new AbortController();
            chartCanvas._abortController = controller;
            const { signal } = controller;
            let pendingPointer = null;
            const commitHoverFrame = () => {
                chartCanvas._hoverSyncRaf = 0;
                const pointer = pendingPointer;
                pendingPointer = null;
                if (!pointer || chartCanvas._investmentStockDetailsChart !== chart) return;
                const hoverState = resolveNearestHoverState(chart, pointer);
                syncStockDetailsHoverState(chart, hoverState);
            };
            chartCanvas.addEventListener('mousemove', (event) => {
                pendingPointer = {clientX: event.clientX, clientY: event.clientY};
                if (Number.isInteger(chartCanvas._hoverSyncRaf) && chartCanvas._hoverSyncRaf > 0) return;
                chartCanvas._hoverSyncRaf = window.requestAnimationFrame(commitHoverFrame);
            }, { signal });
            chartCanvas.addEventListener('mouseleave', () => {
                pendingPointer = null;
                if (Number.isInteger(chartCanvas._hoverSyncRaf) && chartCanvas._hoverSyncRaf > 0) {
                    window.cancelAnimationFrame(chartCanvas._hoverSyncRaf);
                    chartCanvas._hoverSyncRaf = 0;
                }
                syncStockDetailsHoverState(chart, null);
            }, { signal });
        };
        attachStockDetailsHover(chartInstance);
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
        attachStockDetailsResizeSync(chartInstance);
    }

    return {
        buildInvestmentStockDetailBrokerMetrics,
        buildInvestmentStockDetailRows,
        destroyInvestmentStockDetailsPriceChart,
        getStockDetailRealizedBreakdown,
        renderInvestmentStockDetailsPriceChart,
    };
}
