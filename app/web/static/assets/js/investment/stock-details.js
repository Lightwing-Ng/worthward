/**
 * Investment stock details helpers.
 *
 * Code version: v0.2.3
 * - Fixed: Stock-details price chart axis labels now dedupe same-day ticks and reserve a stable today slot during live sessions so refresh and live polling no longer shift the plotted range.
 * - Fixed: Stock-details intraday candles and live pulse now stay off outside active realtime sessions.
 * - Added: Stock-details price chart rendering can notify the parent investment page after the canvas is ready for share preview refreshes
 * - Added: Stock-details price chart now reuses the DOM-based live pulse marker, so eligible ranges no longer need canvas-side pulse painting
 */

export function createInvestmentStockDetailsUtils({
    STOCK_DETAILS_MARKER_VIEW_BOX,
    INVESTMENT_SURFACE_LAYOUT_SETTLE_MS,
    adjustTradePriceForRenderedSeries,
    applyDirectionalTrade,
    buildInvestmentFxRateTimeline,
    buildInvestmentAxisTickIndexes,
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    buildTickerPriceIndex,
    clearInvestmentHistoryHighlights,
    clearInvestmentStockDetailHighlights,
    clearInvestmentStockDetailsVisibleLayoutTimer,
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
    getInvestmentChartPointsCache,
    getInvestmentMarketStoreTickerCandidates,
    getInvestmentProcessedTransactionsCache,
    getInvestmentStockDetailsPanel,
    getInvestmentStockDetailsPriceChartInstance,
    getInvestmentStockDetailsPriceChartRequestSerial,
    getInvestmentStockDetailsRangeLabels,
    getInvestmentLiveSessionDateKey,
    getInvestmentTradeSessionType,
    getMoneyMarketTickerSet,
    getNormalizedTransactionType,
    getSelectedInvestmentStockDetailsRange,
    getTickerQuoteCurrency,
    getTransactionAmount,
    getTransactionBrokerCode,
    getTransactionCommission,
    getTransactionEffectiveUnitPrice,
    getTransactionPrice,
    getTransactionQuantity,
    getTransactionValuationQuantity,
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
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex);
            const transactionPrice = getTransactionPrice(txn);
            let realizedPnl = null;
            if (normalizedType === 'buy' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                applyDirectionalTrade(stockState, 'long', valuationQuantity, getTransactionEffectiveUnitPrice(txn, valuationQuantity));
            } else if (normalizedType === 'grant' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                stockState.shares += valuationQuantity;
            } else if (normalizedType === 'dividend_reinvestment' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                stockState.shares += valuationQuantity;
            } else if (normalizedType === 'sell' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                realizedPnl = applyDirectionalTrade(stockState, 'short', valuationQuantity, getTransactionEffectiveUnitPrice(txn, valuationQuantity));
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

    function getInvestmentStockDetailsAutoRangeContext(ticker, detailRows = []) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
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
            if (normalizeInvestmentTicker(txn?.ticker) !== normalizedTicker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (ledgerDate && ['buy', 'sell'].includes(normalizedType)) {
                tradeDates.push(ledgerDate);
            }
            const quantity = Number(getTransactionQuantity(txn));
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            if (normalizedType === 'buy' || normalizedType === 'grant' || normalizedType === 'dividend_reinvestment') {
                fallbackShares += quantity;
                return;
            }
            if (normalizedType === 'sell') {
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

        (Array.isArray(detailRows) ? detailRows : []).forEach((txn) => {
            const realizedPnl = Number(txn?.rowRealizedPnl);
            if (!Number.isFinite(realizedPnl)) return;

            const normalizedType = getNormalizedTransactionType(txn);
            if (normalizedType === 'dividend') {
                dividendIncome += realizedPnl;
                return;
            }
            if (normalizedType === 'payment_in_lieu') {
                paymentInLieuIncome += realizedPnl;
                return;
            }
            if (normalizedType === 'foreign_tax_withholding') {
                dividendWithholding += realizedPnl;
                return;
            }

            tradingSpreadIncome += realizedPnl;
        });

        return {
            dividendIncome,
            paymentInLieuIncome,
            dividendWithholding,
            tradingSpreadIncome,
            realizedPnl: dividendIncome + paymentInLieuIncome + dividendWithholding + tradingSpreadIncome,
        };
    }

    function buildInvestmentStockDetailBrokerMetrics(detailRows, ticker, lastPrice) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        const orderedRows = [...(Array.isArray(detailRows) ? detailRows : [])].reverse();
        if (!normalizedTicker || !orderedRows.length) return [];
        const priceHistoryRows = window.ANTIGRAVITY_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
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
            if (!brokerMetrics.has(brokerCode)) {
                brokerMetrics.set(brokerCode, {
                    brokerCode,
                    positionState: createPositionState(normalizedTicker),
                    totalCommission: 0,
                    totalTrades: 0,
                    currencyCounts: new Map(),
                });
            }
            const metric = brokerMetrics.get(brokerCode);
            const normalizedType = getNormalizedTransactionType(txn);
            const valuationQuantity = getTransactionValuationQuantity(txn, tickerPriceIndex);
            const transactionCurrency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
            if (transactionCurrency) {
                metric.currencyCounts.set(
                    transactionCurrency,
                    Number(metric.currencyCounts.get(transactionCurrency) || 0) + 1,
                );
            }
            metric.totalCommission += Math.abs(getTransactionCommission(txn));
            if (normalizedType === 'buy' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                applyDirectionalTrade(
                    metric.positionState,
                    'long',
                    valuationQuantity,
                    getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                );
                metric.totalTrades += 1;
                return;
            }
            if (normalizedType === 'grant' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                metric.positionState.shares += valuationQuantity;
                return;
            }
            if (normalizedType === 'dividend_reinvestment' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                metric.positionState.shares += valuationQuantity;
                return;
            }
            if (normalizedType === 'sell' && Number.isFinite(valuationQuantity) && valuationQuantity > 0) {
                applyDirectionalTrade(
                    metric.positionState,
                    'short',
                    valuationQuantity,
                    getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                );
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
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker || !window.Chart) {
            chartHost.innerHTML = '<div class="investment-stock-details-price-chart-empty">Price history is unavailable for this ticker.</div>';
            return;
        }

        const normalizedRange = normalizeInvestmentStockDetailsRange(getSelectedInvestmentStockDetailsRange());
        const allowRealtimeData = shouldRunInvestmentRealtimeQuotes();
        let intradayRows = [];
        if (isInvestmentStockDetailsIntradayRange(normalizedRange) && allowRealtimeData) {
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
                return Number.isFinite(close) ? close : null;
            })
            : labels.map((date) => {
                const close = Number(tickerPriceMap[date]);
                return Number.isFinite(close) ? close : null;
            });
        if (!useIntradayCandles) {
            const liveDateKey = typeof getInvestmentLiveSessionDateKey === 'function'
                ? getInvestmentLiveSessionDateKey()
                : '';
            if (liveDateKey && !labels.some((label) => normalizeLedgerDate(label) === liveDateKey)) {
                const lastFiniteClose = [...closeValues].reverse().find((value) => Number.isFinite(value));
                const fallbackClose = Number(
                    tickerPriceMap[liveDateKey]
                    ?? tickerPriceMap[labels[labels.length - 1]]
                    ?? lastFiniteClose
                );
                labels = [...labels, liveDateKey];
                closeValues = [
                    ...closeValues,
                    Number.isFinite(fallbackClose) ? fallbackClose : null,
                ];
            }
        }
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
                const exactMinuteIndex = dateIndex.get(normalizeInvestmentIntradayMinuteKey(txn?.date));
                if (Number.isInteger(exactMinuteIndex)) return exactMinuteIndex;
                const dayBoundary = intradayDayBoundaries.dayMap.get(ledgerDate);
                const sessionType = getInvestmentTradeSessionType(txn?.date);
                if (dayBoundary) {
                    if (sessionType === 'post') {
                        const nextDay = dayBoundary.ordinal < intradayDayBoundaries.orderedDays.length - 1
                            ? intradayDayBoundaries.orderedDays[dayBoundary.ordinal + 1]
                            : null;
                        return nextDay ? nextDay.firstIndex : dayBoundary.lastIndex;
                    }
                    if (sessionType === 'pre' || sessionType === 'night') {
                        return dayBoundary.firstIndex;
                    }
                }
                const fallbackIndex = intradayDayFallbackIndex.get(ledgerDate);
                return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
            }
            const dailyIndex = dateIndex.get(ledgerDate);
            return Number.isInteger(dailyIndex) ? dailyIndex : null;
        };
        const isTransactionBeforeVisibleRange = (txn) => {
            if (!labels.length) return false;
            const firstVisibleLabel = String(labels[0] || '');
            const firstVisibleLedgerDate = normalizeLedgerDate(firstVisibleLabel);
            const transactionLedgerDate = normalizeLedgerDate(txn?.date);
            if (!firstVisibleLedgerDate || !transactionLedgerDate) return false;
            if (!useIntradayCandles) {
                return transactionLedgerDate < firstVisibleLedgerDate;
            }
            const firstVisibleMinuteKey = normalizeInvestmentIntradayMinuteKey(firstVisibleLabel);
            const transactionMinuteKey = normalizeInvestmentIntradayMinuteKey(txn?.date);
            if (firstVisibleMinuteKey && transactionMinuteKey) {
                return transactionMinuteKey < firstVisibleMinuteKey;
            }
            return transactionLedgerDate < firstVisibleLedgerDate;
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
        const stockState = createPositionState(normalizedTicker);
        const renderedStockState = createPositionState(normalizedTicker);
        const averagePriceSeries = [];
        const applyStockDetailsTransactionToStates = (txn, renderIndex = null) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = Number(getTransactionQuantity(txn));
            const effectiveUnitPrice = getTransactionEffectiveUnitPrice(txn, quantity);
            const renderedEffectiveUnitPrice = Number.isInteger(renderIndex)
                ? resolveTradeMarkerPrice(renderIndex, effectiveUnitPrice)
                : effectiveUnitPrice;
            if (normalizedType === 'buy' && Number.isFinite(quantity) && quantity > 0) {
                applyDirectionalTrade(stockState, 'long', quantity, effectiveUnitPrice);
                applyDirectionalTrade(
                    renderedStockState,
                    'long',
                    quantity,
                    Number.isFinite(renderedEffectiveUnitPrice) ? renderedEffectiveUnitPrice : effectiveUnitPrice,
                );
                return { buyQuantity: quantity, sellQuantity: 0 };
            }
            if (normalizedType === 'grant' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
                renderedStockState.shares += quantity;
                return { buyQuantity: 0, sellQuantity: 0 };
            }
            if (normalizedType === 'dividend_reinvestment' && Number.isFinite(quantity) && quantity > 0) {
                stockState.shares += quantity;
                renderedStockState.shares += quantity;
                return { buyQuantity: 0, sellQuantity: 0 };
            }
            if (normalizedType === 'sell' && Number.isFinite(quantity) && quantity > 0) {
                applyDirectionalTrade(stockState, 'short', quantity, effectiveUnitPrice);
                applyDirectionalTrade(
                    renderedStockState,
                    'short',
                    quantity,
                    Number.isFinite(renderedEffectiveUnitPrice) ? renderedEffectiveUnitPrice : effectiveUnitPrice,
                );
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
            const averagePrice = !isFlatPosition(renderedStockState.shares)
                ? renderedStockState.totalCost / Math.abs(renderedStockState.shares)
                : null;
            const close = Number(closeValues[index]);
            averagePriceSeries.push(Number.isFinite(averagePrice) ? averagePrice : null);
            stockSnapshotsByDate.set(String(label), {
                shares: Number.isFinite(stockState.shares) ? stockState.shares : 0,
                close: Number.isFinite(close) ? close : null,
                averagePrice: Number.isFinite(averagePrice) ? averagePrice : null,
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
            ...averagePriceSeries,
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
                const tickIndexes = typeof buildInvestmentAxisTickIndexes === 'function'
                    ? buildInvestmentAxisTickIndexes(labels, labels, viewportWidth, parseRawDate)
                    : Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
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
        const realtimeEndMarkerPlugin = {
            id: 'investmentStockDetailsRealtimeEndMarkerPlugin',
            afterDatasetsDraw(chartInstance) {
                if (!shouldRenderRealtimePulse || !(realtimeMarkerElement instanceof HTMLElement)) return;
                const dataset = chartInstance.data?.datasets?.[0];
                const lastIndex = Math.max(0, labels.length - 1);
                const pointValue = Number(dataset?.data?.[lastIndex]);
                const xScale = chartInstance.scales?.x;
                const yScale = chartInstance.scales?.y;
                const chartArea = chartInstance.chartArea;
                if (!Number.isFinite(pointValue) || !xScale || !yScale || !chartArea) {
                    realtimeMarkerElement.hidden = true;
                    return;
                }
                const x = Number(xScale.getPixelForValue(lastIndex));
                const y = Number(yScale.getPixelForValue(pointValue));
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
                        borderColor: applyCanvasAlpha(resolvedTheme.muted, 0.5),
                        borderWidth: 1.0,
                        pointRadius: 0,
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
                        top: shouldRenderRealtimePulse ? 32 : 44,
                        bottom: 24,
                    },
                },
                interaction: { mode: 'index', intersect: false },
                animation: {
                    onComplete: notifyChartReady,
                },
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
        window.requestAnimationFrame(() => window.requestAnimationFrame(notifyChartReady));
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
