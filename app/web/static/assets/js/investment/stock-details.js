/**
 * Investment stock details helpers.
 *
 * Code version: v0.15.0
 * - Changed: IBKR stock grants contribute to Stock-details buy counts and
 *   average-cost replay as buy-equivalent lots at their evidenced value.
 * - Refactored: Stock-details and Overview charts now share the same blue
 *   rounded y-axis value badge renderer.
 * - Changed: Stock details imports the current data-utilities revision so its
 *   shared scoped-position aggregation cannot retain a stale module cache.
 * - Changed: Stock details imports the corrected money-market and
 *   cash-equivalent classification contract.
 * - Added: Realized P&L breakdowns retain broker attribution so multi-broker
 *   tickers can show the HSBC and IBKR contributions separately.
 * - Changed: Stock details imports the settlement-boundary-aware Investment
 *   data-utilities revision used by the Overview replay.
 * - Fixed: Stock details imports open-position tax-lot attestation support from
 *   the current Investment data-utilities revision.
 * - Fixed: Stock details now imports the current Investment data-utilities
 *   revision used by the dated Overview replay and valuation guards.
 * - Fixed: Stock details now imports the current Investment data-utilities revision after the HSBC settlement replay presentation fix.
 * - Fixed: Stock-details tax-lot replay uses source execution timestamps for same-day HSBC trades and attested open-position history.
 * - Fixed: Stock-details intraday charts ignore non-positive or structurally invalid OHLC bars.
 * - Changed: Stock-details hover guides reuse the shared soft muted gray token.
 * - Refactored: Average-cost chart aggregation now reuses the shared scoped-position aggregation contract from data-utils.
 * - Fixed: Average-cost chart points now replay each broker/account/currency lot scope before aggregating the visible position, so cross-account sells cannot consume unrelated lots.
 * - Changed: Average-cost aggregation returns no curve for a ticker whose visible lots use multiple currencies rather than summing raw currency units.
 * - Refactored: Stock-details rows, broker metrics, and average-cost charts now use the shared transaction applier for trades, grants, and transfers.
 * - Changed: Stock-details exact-price hover badges now reuse the Holdings allocation badge corner radius while preserving their existing blue fill and alignment.
 * - Fixed: Stock-details hover guides span the complete chart area instead of stopping at the average-cost curve.
 * - Fixed: Daily stock-details replay carries weekend and market-holiday position changes to the next visible market close.
 * - Fixed: Stock-detail trade replay uses broker-account tax-lot scopes and displays broker-reported realized P&L when present.
 * - Refactored: Range, intraday-minute, day-boundary, and trade-session rules are exported for direct unit testing.
 * - Fixed: Eligible live markers keep the final chart x-position while resolving their y-position and y-scale from the current realtime quote price.
 * - Fixed: Mixed integer and fractional y-axis ticks now select a fractional tick when resolving the shared decimal anchor.
 * - Fixed: Exact-price badges now reuse the rendered y-axis label anchor and font so integer and decimal columns align with the covered tick labels.
 * - Added: Stock-details hover now draws a cost-curve-bounded horizontal guide beneath chart data and a blue exact-price badge over the y-axis labels.
 * - Changed: Stock-details charts no longer reserve top canvas padding for the range control now that the control has its own layout track.
 * - Changed: Stock-details price chart x-axis date labels now use weight 400 while preserving the existing font and size.
 * - Changed: Stock-details 1W x-axis labels now center each trading date within its intraday session and omit intraday times.
 * - Fixed: Stock-details intraday trade markers no longer project pre-range overnight trades onto the first visible candle.
 * - Fixed: Stock-details intraday average-price curves no longer draw solid point markers on cost-change indexes.
 * - Changed: Stock-details intraday average-price curves now render as event-stepped cost lines with subtle change points so each trade-driven cost update is visible.
 * - Fixed: Stock-details overnight trades at or after 20:00 now prefer the next visible intraday session's first candle before falling back to the ledger date.
 * - Fixed: Date-only HSBC order-status trades now anchor to the same day's regular-session close instead of being discarded as synthetic 20:00 overnight trades.
 * - Changed: Stock-details 1W uses regular-session 1-minute candles outside realtime sessions and anchors off-hours trade markers to the nearest session candle.
 * - Fixed: Broker metric replay now builds its own rendered split-factor hints instead of reading a stock-detail row-local variable.
 * - Fixed: Stock-details transaction replay now shares rendered split-factor hints with zero-price grant rows.
 * - Added: Exported module version metadata so the investment entry module can expose loaded helper versions for cache diagnostics.
 * - Fixed: Stock details now uses canonical investment tickers so MSFT.US and MSFT share one transaction history, broker metric set, and price chart.
 * - Fixed: Stock-details price chart axis labels now dedupe same-day ticks and reserve a stable today slot during live sessions so refresh and live polling no longer shift the plotted range.
 * - Fixed: Stock-details intraday candles and live pulse now stay off outside active realtime sessions.
 * - Added: Stock-details price chart rendering can notify the parent investment page after the canvas is ready for share preview refreshes
 * - Added: Stock-details price chart now reuses the DOM-based live pulse marker, so eligible ranges no longer need canvas-side pulse painting
 * - Fixed: Average-price chart replay now uses the same split-adjusted quantities as holdings, so fully closed historical positions leave a real gap instead of a residual cost line.
 * - Fixed: Aggregate stock-detail replay recognizes in-kind transfers as non-cash share movements.
 */

import {aggregateInvestmentScopedPositionStates} from './data-utils.js?investment-data-utils-v1.99.0';

const aggregateInvestmentStockDetailPositionStates = aggregateInvestmentScopedPositionStates;

export const INVESTMENT_STOCK_DETAILS_MODULE_VERSION = 'v0.15.0';

const INVESTMENT_DATE_ONLY_TRANSACTION_FILE_KINDS = new Set([
    'hsbc_order_status_capture',
    'hsbc_order_status_text',
]);

export function isInvestmentTransactionDateOnly(transaction) {
    const source = transaction?.source;
    const sourceTimestampFlag = source?.source_has_intraday_timestamp;
    if (sourceTimestampFlag === false || String(sourceTimestampFlag).trim().toLowerCase() === 'false') {
        return true;
    }
    if (sourceTimestampFlag === true || String(sourceTimestampFlag).trim().toLowerCase() === 'true') {
        return false;
    }
    return INVESTMENT_DATE_ONLY_TRANSACTION_FILE_KINDS.has(
        String(source?.file_kind || '').trim().toLowerCase(),
    );
}

export function getInvestmentStockDetailsTransactionSessionType(
    transaction,
    datetimeValue,
    getTradeSessionType = getInvestmentTradeSessionType,
) {
    if (isInvestmentTransactionDateOnly(transaction)) return 'intraday';
    return getTradeSessionType(datetimeValue);
}

export function normalizeInvestmentRange(range, options = [], fallback = 'max') {
    const normalizedRange = String(range || '').trim().toLowerCase();
    return options.some((option) => option?.value === normalizedRange)
        ? normalizedRange
        : fallback;
}

export function isInvestmentStockDetailsIntradayRange(range, options = []) {
    return normalizeInvestmentRange(range, options) === '1w';
}

export function normalizeInvestmentStockDetailsIntradayRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const date = String(row.date || '').trim();
            const open = Number(row.open);
            const high = Number(row.high);
            const low = Number(row.low);
            const close = Number(row.close);
            const prices = [open, high, low, close];
            if (!date || !prices.every(Number.isFinite) || prices.some((value) => value <= 0)) {
                return null;
            }
            if (
                high < Math.max(open, close)
                || low > Math.min(open, close)
                || high < low
            ) {
                return null;
            }
            return {
                ...row,
                date,
                open,
                high,
                low,
                close,
            };
        })
        .filter(Boolean);
}

export function parseInvestmentIntradayTimestamp(value) {
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

export function normalizeInvestmentIntradayMinuteKey(value) {
    const parsed = parseInvestmentIntradayTimestamp(value);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function buildInvestmentIntradayDayFallbackIndex(labels = [], normalizeDate = (value) => value) {
    return (Array.isArray(labels) ? labels : []).reduce((accumulator, label, index) => {
        const dayKey = normalizeDate(label);
        if (dayKey) accumulator.set(dayKey, index);
        return accumulator;
    }, new Map());
}

export function buildInvestmentIntradayDayBoundaries(labels = [], normalizeDate = (value) => value) {
    const orderedDays = [];
    const dayMap = new Map();
    (Array.isArray(labels) ? labels : []).forEach((label, index) => {
        const dayKey = normalizeDate(label);
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
    return {orderedDays, dayMap};
}

export function resolveInvestmentStockDetailsDailySnapshotIndex(
    ledgerDate,
    labels = [],
    normalizeDate = (value) => String(value || '').slice(0, 10),
) {
    const normalizedLedgerDate = normalizeDate(ledgerDate);
    const normalizedLabels = Array.isArray(labels) ? labels : [];
    if (!normalizedLedgerDate || !normalizedLabels.length) return null;
    const firstVisibleDate = normalizeDate(normalizedLabels[0]);
    if (!firstVisibleDate || normalizedLedgerDate < firstVisibleDate) return null;
    for (let index = 0; index < normalizedLabels.length; index += 1) {
        const visibleDate = normalizeDate(normalizedLabels[index]);
        if (visibleDate && visibleDate >= normalizedLedgerDate) return index;
    }
    return null;
}

export function getInvestmentTradeSessionType(value, parseDateParts) {
    const dateParts = parseDateParts(value);
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
    const {ctx, chartArea, scales} = chartInstance || {};
    const yScale = scales?.y;
    const numericY = Number(y);
    const numericValue = Number(value);
    const valueCopy = String(formattedValue ?? '').trim();
    if (
        !ctx
        || !chartArea
        || !yScale
        || !Number.isFinite(numericY)
        || numericY < chartArea.top
        || numericY > chartArea.bottom
        || !Number.isFinite(numericValue)
        || !valueCopy
    ) {
        return null;
    }

    const decimalIndex = valueCopy.lastIndexOf('.');
    const integerCopy = decimalIndex >= 0 ? valueCopy.slice(0, decimalIndex) : valueCopy;
    const fractionCopy = decimalIndex >= 0 ? valueCopy.slice(decimalIndex) : '';

    ctx.save();
    const visibleAxisLabelItems = (Array.isArray(yScale._labelItems) ? yScale._labelItems : [])
        .filter((item) => String(item?.label ?? '').trim());
    const visibleAxisLabelItem = visibleAxisLabelItems
        .find((item) => String(item?.label ?? '').includes('.'))
        || visibleAxisLabelItems[0];
    const axisLabelOptions = visibleAxisLabelItem?.options || {};
    const axisTickCopy = String(visibleAxisLabelItem?.label ?? '');
    ctx.font = String(
        visibleAxisLabelItem?.font?.string
        || '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif'
    );
    ctx.textBaseline = 'middle';
    const axisLabelTranslationX = Number(axisLabelOptions?.translation?.[0]);
    const axisTickWidth = ctx.measureText(axisTickCopy).width;
    const axisTextAlign = String(axisLabelOptions?.textAlign || 'right');
    const axisLabelRight = Number.isFinite(axisLabelTranslationX)
        ? axisLabelTranslationX + (
            axisTextAlign === 'center'
                ? axisTickWidth / 2
                : (axisTextAlign === 'left' || axisTextAlign === 'start' ? axisTickWidth : 0)
        )
        : Number(yScale.right ?? chartArea.left);
    const axisTickDecimalIndex = axisTickCopy.lastIndexOf('.');
    const axisFractionCopy = axisTickDecimalIndex >= 0
        ? axisTickCopy.slice(axisTickDecimalIndex)
        : '';
    const axisFractionWidth = axisFractionCopy
        ? ctx.measureText(axisFractionCopy).width
        : 0;
    const decimalAnchor = axisLabelRight - axisFractionWidth;
    const integerWidth = ctx.measureText(integerCopy).width;
    const fractionWidth = ctx.measureText(fractionCopy).width;
    const widestAxisTickWidth = (Array.isArray(yScale.ticks) ? yScale.ticks : []).reduce((width, tick) => (
        Math.max(width, ctx.measureText(formatTickLabel(tick?.value, yScale.ticks)).width)
    ), 0);
    const horizontalPadding = 5;
    const badgeLeft = Math.min(
        decimalAnchor - integerWidth - horizontalPadding,
        axisLabelRight - widestAxisTickWidth - horizontalPadding,
    );
    const badgeRight = decimalAnchor + fractionWidth + horizontalPadding;
    const badgeHeight = 20;
    const allocationBadgeRadius = Number.parseFloat(
        getComputedStyle(chartInstance.canvas)
            .getPropertyValue('--investment-holdings-allocation-badge-radius'),
    );
    const badgeRadius = Math.min(
        Number.isFinite(allocationBadgeRadius) ? allocationBadgeRadius : 0,
        (badgeRight - badgeLeft) / 2,
        badgeHeight / 2,
    );
    const badgeTop = numericY - (badgeHeight / 2);
    const badgeWidth = badgeRight - badgeLeft;
    const bounds = {
        badgeBottom: numericY + (badgeHeight / 2),
        badgeLeft,
        badgeRight,
        badgeTop,
        axisLabelRight,
        axisTickCopy,
        decimalAnchor,
        formattedValue: valueCopy,
        value: numericValue,
        y: numericY,
        ...(boundsAliases && typeof boundsAliases === 'object' ? boundsAliases : {}),
    };
    if (boundsProperty) {
        chartInstance[boundsProperty] = {
            ...(chartInstance[boundsProperty] || {}),
            ...bounds,
        };
    }

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeLeft, badgeTop, badgeWidth, badgeHeight, badgeRadius);
    } else {
        ctx.moveTo(badgeLeft + badgeRadius, badgeTop);
        ctx.arcTo(badgeRight, badgeTop, badgeRight, badgeTop + badgeHeight, badgeRadius);
        ctx.arcTo(badgeRight, badgeTop + badgeHeight, badgeLeft, badgeTop + badgeHeight, badgeRadius);
        ctx.arcTo(badgeLeft, badgeTop + badgeHeight, badgeLeft, badgeTop, badgeRadius);
        ctx.arcTo(badgeLeft, badgeTop, badgeRight, badgeTop, badgeRadius);
        ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(integerCopy, decimalAnchor, numericY);
    if (fractionCopy) {
        ctx.textAlign = 'left';
        ctx.fillText(fractionCopy, decimalAnchor, numericY);
    }
    ctx.restore();
    return bounds;
}

export function createInvestmentStockDetailsUtils({
    STOCK_DETAILS_MARKER_VIEW_BOX,
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
    compareInvestmentTaxLotTransactions = compareInvestmentTransactions,
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
    incrementInvestmentStockDetailsPriceChartRequestSerial,
    isInvestmentGrantBuyEquivalent = () => false,
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
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(processedTransactions, tickerPriceIndex);
        let lastKnownTickerPrice = null;
        const detailRowsBySourceIndex = new Map();
        sourceTransactions
            .map((txn, sourceIndex) => ({txn, sourceIndex}))
            .filter(({txn}) => getInvestmentCanonicalTicker(txn?.ticker) === normalizedTicker)
            .sort((left, right) => compareInvestmentTaxLotTransactions(
                left.txn,
                right.txn,
                left.sourceIndex,
                right.sourceIndex,
            ))
            .forEach(({txn, sourceIndex}) => {
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

    function getInvestmentStockDetailsAutoRangeContext(ticker, detailRows = []) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker) {
            return {
                tradeDates: [],
                isOpenPosition: null,
            };
        }
        const orderedRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        const tradeDates = [];
        let fallbackShares = 0;
        orderedRows.forEach((txn) => {
            if (getInvestmentCanonicalTicker(txn?.ticker) !== normalizedTicker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (ledgerDate && ['buy', 'sell'].includes(normalizedType)) {
                tradeDates.push(ledgerDate);
            }
            const quantity = Number(getTransactionQuantity(txn));
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            if (
                normalizedType === 'buy'
                || normalizedType === 'grant'
                || normalizedType === 'dividend_reinvestment'
                || normalizedType === 'transfer_in'
            ) {
                fallbackShares += quantity;
                return;
            }
            if (normalizedType === 'sell' || normalizedType === 'transfer_out') {
                fallbackShares -= quantity;
            }
        });
        const latestHoldingQuantity = Number(
            Array.isArray(detailRows) && detailRows.length
                ? detailRows[0]?.holdings?.[normalizedTicker]
                : Number.NaN,
        );
        return {
            tradeDates: Array.from(new Set(tradeDates)).sort(),
            isOpenPosition: Number.isFinite(latestHoldingQuantity)
                ? !isFlatPosition(latestHoldingQuantity)
                : !isFlatPosition(fallbackShares),
        };
    }

    function getStockDetailRealizedBreakdown(detailRows) {
        let dividendIncome = 0;
        let paymentInLieuIncome = 0;
        let dividendWithholding = 0;
        let tradingSpreadIncome = 0;
        const brokerBreakdowns = new Map();

        const addBrokerAmount = (txn, field, amount) => {
            const brokerCode = getTransactionBrokerCode(txn);
            if (!brokerBreakdowns.has(brokerCode)) {
                brokerBreakdowns.set(brokerCode, {
                    brokerCode,
                    brokerLabel: getInvestmentBrokerMeta(brokerCode).label,
                    dividendIncome: 0,
                    paymentInLieuIncome: 0,
                    dividendWithholding: 0,
                    tradingSpreadIncome: 0,
                });
            }
            brokerBreakdowns.get(brokerCode)[field] += amount;
        };

        (Array.isArray(detailRows) ? detailRows : []).forEach((txn) => {
            const realizedPnl = Number(txn?.rowRealizedPnl);
            if (!Number.isFinite(realizedPnl)) return;

            const normalizedType = getNormalizedTransactionType(txn);
            if (normalizedType === 'dividend') {
                dividendIncome += realizedPnl;
                addBrokerAmount(txn, 'dividendIncome', realizedPnl);
                return;
            }
            if (normalizedType === 'payment_in_lieu') {
                paymentInLieuIncome += realizedPnl;
                addBrokerAmount(txn, 'paymentInLieuIncome', realizedPnl);
                return;
            }
            if (normalizedType === 'foreign_tax_withholding') {
                dividendWithholding += realizedPnl;
                addBrokerAmount(txn, 'dividendWithholding', realizedPnl);
                return;
            }

            tradingSpreadIncome += realizedPnl;
            addBrokerAmount(txn, 'tradingSpreadIncome', realizedPnl);
        });

        const brokerBreakdown = Array.from(brokerBreakdowns.values())
            .map((entry) => ({
                ...entry,
                realizedPnl: (
                    entry.dividendIncome
                    + entry.paymentInLieuIncome
                    + entry.dividendWithholding
                    + entry.tradingSpreadIncome
                ),
            }))
            .filter((entry) => Math.abs(entry.realizedPnl) > 1e-9)
            .sort((left, right) => left.brokerLabel.localeCompare(right.brokerLabel));

        return {
            dividendIncome,
            paymentInLieuIncome,
            dividendWithholding,
            tradingSpreadIncome,
            realizedPnl: dividendIncome + paymentInLieuIncome + dividendWithholding + tradingSpreadIncome,
            brokerBreakdown,
        };
    }

    function buildInvestmentStockDetailBrokerMetrics(detailRows, ticker, lastPrice) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        const orderedRows = [...(Array.isArray(detailRows) ? detailRows : [])]
            .reverse()
            .sort((left, right) => compareInvestmentTaxLotTransactions(left, right));
        if (!normalizedTicker || !orderedRows.length) return [];
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedRows, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const quoteCurrency = getTickerQuoteCurrency(normalizedTicker) || baseCurrency;
        const orderedTransactions = [...(Array.isArray(getInvestmentProcessedTransactionsCache()) ? getInvestmentProcessedTransactionsCache() : [])]
            .sort((left, right) => compareInvestmentTransactions(left, right));
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const valuationDate = normalizeLedgerDate(
            orderedRows[orderedRows.length - 1]?.date
            || orderedRows[0]?.date
            || '',
        );
        const brokerMetrics = new Map();

        orderedRows.forEach((txn) => {
            const brokerCode = getTransactionBrokerCode(txn);
            const lotScope = getTransactionLotScope(txn, normalizedTicker);
            const lotScopeKey = getTransactionLotScopeKey(txn, normalizedTicker);
            if (!brokerMetrics.has(lotScopeKey)) {
                brokerMetrics.set(lotScopeKey, {
                    brokerCode,
                    accountId: lotScope.accountId,
                    positionState: createPositionState(normalizedTicker),
                    totalCommission: 0,
                    totalTrades: 0,
                    currencyCounts: new Map(),
                });
            }
            const metric = brokerMetrics.get(lotScopeKey);
            const normalizedType = getNormalizedTransactionType(txn);
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const transactionCurrency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
            if (transactionCurrency) {
                metric.currencyCounts.set(
                    transactionCurrency,
                    Number(metric.currencyCounts.get(transactionCurrency) || 0) + 1,
                );
            }
            metric.totalCommission += Math.abs(getTransactionCommission(txn));
            applyInvestmentTransactionToState(
                metric.positionState,
                txn,
                normalizedType,
                valuationQuantity,
                getTransactionAmount(txn),
                normalizeLedgerDate(txn?.date),
                {
                    unitPriceOverride: getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                },
            );
            if (
                normalizedType === 'sell'
                || normalizedType === 'buy'
                || isInvestmentGrantBuyEquivalent(txn)
            ) {
                metric.totalTrades += 1;
            }
        });

        return Array.from(brokerMetrics.values()).map((metric) => {
            const currency = Array.from(metric.currencyCounts.entries())
                .sort((left, right) => right[1] - left[1])[0]?.[0] || quoteCurrency;
            const shares = Number(metric.positionState.shares) || 0;
            const marketValue = !isFlatPosition(shares) && Number.isFinite(lastPrice)
                ? convertAmountToBaseCurrency(
                    shares * lastPrice,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                )
                : null;
            return {
                brokerCode: metric.brokerCode,
                accountId: metric.accountId,
                brokerLabel: getInvestmentBrokerMeta(metric.brokerCode).label,
                shares,
                positionDisplay: formatHoldingsPosition(shares),
                marketValue,
                marketValueDisplay: marketValue === null ? '-' : formatHoldingsMoney(marketValue),
                totalTrades: metric.totalTrades,
                totalTradesDisplay: new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                }).format(metric.totalTrades),
                totalCommission: metric.totalCommission,
                totalCommissionDisplay: currency
                    ? formatMetricLossAmountWithCurrency(metric.totalCommission, currency)
                    : formatMetricLossAmount(metric.totalCommission),
            };
        }).sort((left, right) => {
            const leftMarketValue = Number(left.marketValue) || 0;
            const rightMarketValue = Number(right.marketValue) || 0;
            return Math.abs(rightMarketValue) - Math.abs(leftMarketValue);
        });
    }

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
            if (Number.isInteger(chartCanvas?._layoutSyncTimer) && chartCanvas._layoutSyncTimer > 0) {
                window.clearTimeout(chartCanvas._layoutSyncTimer);
                chartCanvas._layoutSyncTimer = 0;
            }
            chartCanvas._scheduleLayoutSync = null;
            chartCanvas._syncInvestmentStockDetailsRealtimePulse = null;
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

        const priceHistoryByTicker = normalizePriceHistoryPayload(window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {});
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
                <div class="investment-stock-details-live-marker" data-investment-stock-details-live-marker hidden aria-hidden="true">
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-outer"></span>
                    <span class="investment-stock-details-live-marker-ring investment-stock-details-live-marker-ring-inner"></span>
                    <span class="investment-stock-details-live-marker-core"></span>
                </div>
            </div>
        `;
        const canvas = chartHost.querySelector('canvas');
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
            const datetimeMatch = transactionDatetimeValue.match(/^\d{4}-\d{2}-\d{2}(?:[T ](\d{2}):(\d{2}))/);
            const hour = datetimeMatch ? Number(datetimeMatch[1]) : null;
            const minute = datetimeMatch ? Number(datetimeMatch[2]) : null;
            const totalMinutes = Number.isInteger(hour) && Number.isInteger(minute)
                ? (hour * 60) + minute
                : null;
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
        const tradeMarkerPoints = chronologicalRows.reduce((accumulator, txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(normalizedType)) return accumulator;
            if (useIntradayCandles && (isTransactionBeforeVisibleRange(txn) || isTransactionAfterVisibleRange(txn))) {
                return accumulator;
            }
            const transactionDatetimeValue = getTransactionDatetimeValue(txn);
            const exactMinuteKey = normalizeInvestmentIntradayMinuteKey(transactionDatetimeValue);
            const transactionPrice = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            let markerIndex = null;
            let markerPlacement = 'bar';
            let markerSessionType = 'intraday';
            let markerPrice = null;
            if (useIntradayCandles) {
                markerSessionType = getTransactionSessionType(txn, transactionDatetimeValue);
                const exactMinuteIndex = dateIndex.get(exactMinuteKey);
                if (Number.isInteger(exactMinuteIndex)) {
                    markerIndex = exactMinuteIndex;
                    markerPrice = resolveTradeMarkerPrice(exactMinuteIndex, transactionPrice);
                } else if (markerSessionType !== 'intraday') {
                    const dayBoundary = resolveIntradayDayBoundaryForTransaction(txn, markerSessionType);
                    if (dayBoundary) {
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
                placement: markerPlacement,
                sessionType: markerSessionType,
                ledgerDate,
                transactionPrice: Number.isFinite(transactionPrice) ? transactionPrice : null,
            };
            if (normalizedType === 'buy') accumulator.buy.push(marker);
            if (normalizedType === 'sell') accumulator.sell.push(marker);
            return accumulator;
        }, { buy: [], sell: [] });
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
            const renderedAveragePrice = Number(renderedAggregateState.averagePrice);
            averagePriceSeries.push(
                Number.isFinite(renderedAveragePrice) && renderedAveragePrice > 0
                    ? renderedAveragePrice
                    : null,
            );
            stockSnapshotsByDate.set(String(label), {
                shares: Number.isFinite(aggregateState.shares) ? aggregateState.shares : 0,
                close: Number.isFinite(close) ? close : null,
                averagePrice: Number.isFinite(renderedAggregateState.averagePrice)
                    ? renderedAggregateState.averagePrice
                    : null,
                buyQuantity,
                sellQuantity,
                buySellLedgerNos,
            });
        });

        const resolvedTheme = resolveInvestmentTheme();
        const applyCanvasAlpha = (color, alpha) => {
            const normalizedColor = String(color || '').trim();
            const normalizedAlpha = Number(alpha);
            if (!normalizedColor) return normalizedColor;
            if (!Number.isFinite(normalizedAlpha)) return normalizedColor;
            const clampedAlpha = Math.min(1, Math.max(0, normalizedAlpha));
            const hexMatch = normalizedColor.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
            if (hexMatch) {
                const rawHex = hexMatch[1];
                const expandedHex = rawHex.length === 3
                    ? rawHex.split('').map((char) => `${char}${char}`).join('')
                    : rawHex;
                const red = parseInt(expandedHex.slice(0, 2), 16);
                const green = parseInt(expandedHex.slice(2, 4), 16);
                const blue = parseInt(expandedHex.slice(4, 6), 16);
                return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
            }
            const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/i);
            if (rgbMatch) {
                const channels = rgbMatch[1].split(',').slice(0, 3).map((value) => value.trim());
                if (channels.length === 3) {
                    return `rgba(${channels.join(', ')}, ${clampedAlpha})`;
                }
            }
            return normalizedColor;
        };
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
        const chartAxis = (typeof window !== "undefined" && window.ANTIGRAVITY_CHART_AXIS) || {};
        const buildTickIndexSet = (count, plotWidth) => (
            typeof chartAxis.buildTickIndexSet === "function"
                ? chartAxis.buildTickIndexSet(count, plotWidth)
                : (() => {
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
                })()
        );
        const STOCK_DETAILS_MARKER_HALF_WIDTH_PX = 6;
        const STOCK_DETAILS_MARKER_HEIGHT_PX = 11;
        const STOCK_DETAILS_MARKER_X_PADDING_PX = STOCK_DETAILS_MARKER_HALF_WIDTH_PX + 2;
        const STOCK_DETAILS_MARKER_Y_PADDING_PX = STOCK_DETAILS_MARKER_HEIGHT_PX + 2;
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
                const intradayCenteredTicks = buildIntradayCenteredAxisTicks();
                if (intradayCenteredTicks.length) {
                    const baselineY = chartArea.bottom;
                    const lineHeight = 10;
                    ctx.save();
                    ctx.fillStyle = resolvedTheme.muted;
                    ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
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
                ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
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
            beforeDatasetsDraw(chartInstance) {
                const { ctx, chartArea } = chartInstance;
                const y = Number(chartInstance?._activeInvestmentStockDetailsGuideY);
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
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();

                const y = Number(chartInstance?._activeInvestmentStockDetailsGuideY);
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
            const activeMarkerType = String(chart?._activeInvestmentStockDetailsMarkerType || '');
            dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || '');
            const averagePrice = Number(snapshot?.averagePrice);
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
                    label: 'Average price',
                    value: Number.isFinite(averagePrice) ? formatMoney(averagePrice) : '--',
                    color: resolvedTheme.muted,
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
                        label: `${normalizedTicker} average price`,
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
                        right: shouldRenderRealtimePulse ? 32 : STOCK_DETAILS_MARKER_X_PADDING_PX,
                        top: shouldRenderRealtimePulse ? 32 : STOCK_DETAILS_MARKER_Y_PADDING_PX,
                        bottom: 24,
                    },
                },
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
        const readyScheduler = window.AntigravityMotion?.scheduler;
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
            const guideY = relativeY;
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
                    guideY,
                    markerPosition: {
                        x: snappedMarker.pixelX,
                        y: snappedMarker.pixelY,
                    },
                };
            }
            return { index: nearestIndex, markerType: '', guideY };
        };
        const syncStockDetailsHoverState = (chart, hoverState) => {
            const index = hoverState && Number.isInteger(hoverState.index) ? hoverState.index : null;
            const guideY = Number(hoverState?.guideY);
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
            chartCanvas.addEventListener('mousemove', (event) => {
                const hoverState = resolveNearestHoverState(chart, event);
                syncStockDetailsHoverState(chart, hoverState);
            }, { signal });
            chartCanvas.addEventListener('mouseleave', () => {
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
