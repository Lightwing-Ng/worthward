/**
 * Investment stock-details metric and range composition.
 *
 * Code version: v1.1.0
 * - Added: Isolated position-range, realized P&L, and broker metric builders.
 */

export function createInvestmentStockDetailsMetrics({
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
    normalizeInvestmentLedgerDate,
    normalizePriceHistoryPayload,
}) {
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
            const ledgerDate = normalizeInvestmentLedgerDate(txn?.date);
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

    function getStockDetailRealizedBreakdown(detailRows, authoritativeRealizedAccounts = []) {
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

        const hasNonTradingRealizedRows = (Array.isArray(detailRows) ? detailRows : [])
            .some((txn) => [
                'dividend',
                'foreign_tax_withholding',
                'payment_in_lieu',
                'adjustment',
            ].includes(getNormalizedTransactionType(txn)));
        const normalizedBaseCurrency = String(getInvestmentBaseCurrency() || '').trim().toUpperCase();
        const authoritativeBrokerBreakdown = (
            !hasNonTradingRealizedRows
            && Array.isArray(authoritativeRealizedAccounts)
            && authoritativeRealizedAccounts.length > 0
        )
            ? authoritativeRealizedAccounts
                .filter((account) => (
                    account?.status === 'complete'
                    && account?.reconciliation?.coverageStatus === 'complete'
                    && account?.reconciliation?.arithmeticCheck?.valid === true
                    && String(account.currency || '').trim().toUpperCase() === normalizedBaseCurrency
                    && Number.isFinite(Number(account.realizedPnl))
                ))
                .map((account) => ({
                    brokerCode: account.broker,
                    brokerLabel: getInvestmentBrokerMeta(account.broker).label,
                    dividendIncome: 0,
                    paymentInLieuIncome: 0,
                    dividendWithholding: 0,
                    tradingSpreadIncome: Number(account.realizedPnl),
                    realizedPnl: Number(account.realizedPnl),
                }))
            : [];
        if (authoritativeBrokerBreakdown.length === authoritativeRealizedAccounts.length) {
            const authoritativeRealizedPnl = authoritativeBrokerBreakdown.reduce(
                (total, entry) => total + entry.realizedPnl,
                0,
            );
            return {
                dividendIncome: 0,
                paymentInLieuIncome: 0,
                dividendWithholding: 0,
                tradingSpreadIncome: authoritativeRealizedPnl,
                realizedPnl: authoritativeRealizedPnl,
                brokerBreakdown: authoritativeBrokerBreakdown
                    .sort((left, right) => left.brokerLabel.localeCompare(right.brokerLabel)),
            };
        }

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
        const orderedRows = sortInvestmentTaxLotTransactions(
            [...(Array.isArray(detailRows) ? detailRows : [])].reverse(),
        );
        if (!normalizedTicker || !orderedRows.length) return [];
        const priceHistoryRows = window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {};
        const tickerPriceIndex = buildTickerPriceIndex(normalizePriceHistoryPayload(priceHistoryRows));
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedRows, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const quoteCurrency = getTickerQuoteCurrency(normalizedTicker) || baseCurrency;
        const orderedTransactions = sortInvestmentTransactionsForReplay(
            Array.isArray(getInvestmentProcessedTransactionsCache())
                ? getInvestmentProcessedTransactionsCache()
                : [],
        );
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const valuationDate = normalizeInvestmentLedgerDate(
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
                normalizeInvestmentLedgerDate(txn?.date),
                {
                    unitPriceOverride: getTransactionEffectiveUnitPrice(txn, valuationQuantity),
                },
            );
            if (
                normalizedType === 'sell'
                || normalizedType === 'buy'
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


    return {
        buildInvestmentStockDetailBrokerMetrics,
        getInvestmentStockDetailsAutoRangeContext,
        getStockDetailRealizedBreakdown,
    };
}
