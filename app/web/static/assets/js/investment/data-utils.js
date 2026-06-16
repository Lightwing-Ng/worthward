/**
 * Investment transaction and valuation helpers.
 *
 * Code version: v1.36.2
 */

export function createInvestmentDataUtils({
    noCommissionTransactionTypes,
    investmentCommonSplitFactors,
    parseInvestmentDateParts,
    formatInvestmentShortDateParts,
    normalizeInvestmentTicker,
    normalizeInvestmentStockDetailsRange,
    normalizeInvestmentEquityRange,
}) {
    function getNormalizedTransactionType(txn) {
        return String(txn?.type || '').replace(/\s+/g, '_').toLowerCase();
    }

    function getTransactionQuantity(txn) {
        const quantity = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.position_quantity;
        return quantity === undefined || quantity === null ? null : Number(quantity);
    }

    function getTransactionAmount(txn) {
        if (txn.normalized?.net_amount !== undefined && txn.normalized?.net_amount !== null) {
            return Number(txn.normalized.net_amount);
        }
        if (txn.amount !== undefined && txn.amount !== null) {
            return Number(txn.amount);
        }
        if (txn.cash !== undefined && txn.cash !== null) {
            return Number(txn.cash);
        }
        return 0;
    }

    function getTransactionCommission(txn) {
        const commission = txn?.normalized?.commission ?? txn?.commission ?? 0;
        const numericCommission = Number(commission);
        return Number.isFinite(numericCommission) ? numericCommission : 0;
    }

    function getInvestmentStartingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.starting_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return 0;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getTransactionPrice(txn) {
        if (txn.normalized?.unit_price !== undefined && txn.normalized?.unit_price !== null) {
            return Number(txn.normalized.unit_price);
        }
        if (txn.price !== undefined && txn.price !== null) {
            return Number(txn.price);
        }
        return null;
    }

    function getTransactionEconomicAmount(txn) {
        const amount = getTransactionAmount(txn);
        if (Math.abs(amount) > 1e-9) return amount;

        const normalizedType = getNormalizedTransactionType(txn);
        const quantity = getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (quantity === null || price === null || Number.isNaN(quantity) || Number.isNaN(price)) {
            return amount;
        }

        if (['buy', 'sell', 'grant'].includes(normalizedType)) {
            return quantity * price;
        }

        return amount;
    }

    function formatTransactionDateDisplay(txn) {
        const rawDate = String(txn?.date || '').trim();
        const dateParts = parseInvestmentDateParts(rawDate);
        if (!dateParts) return rawDate;
        const baseDate = formatInvestmentShortDateParts(dateParts);
        if (!rawDate.includes(' ') || rawDate.endsWith('20:00:00')) {
            return baseDate;
        }
        const timeText = rawDate.split(' ')[1] || '';
        return timeText ? `${baseDate} ${timeText}` : baseDate;
    }

    function formatAmountWithCurrency(value, currency, { showUsdSymbol = true } = {}) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        const sign = numericValue < 0 ? '-' : '';
        const absDisplay = formatAmount(Math.abs(numericValue));
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        if (normalizedCurrency === 'USD') {
            return showUsdSymbol ? `${sign}$${absDisplay}` : `${sign}${absDisplay}`;
        }
        if (normalizedCurrency) {
            return `${sign}${normalizedCurrency} ${absDisplay}`;
        }
        return `${sign}${absDisplay}`;
    }

    function formatTransactionCommissionDisplay(txn, { includeCurrency = false } = {}) {
        const normalizedType = getNormalizedTransactionType(txn);
        const commission = getTransactionCommission(txn);
        if ((!commission || Math.abs(commission) < 1e-9) && noCommissionTransactionTypes.has(normalizedType)) {
            return '-';
        }
        const absoluteCommission = Math.abs(commission);
        if (!includeCurrency) {
            return formatAmount(absoluteCommission);
        }
        return formatAmountWithCurrency(absoluteCommission, formatTransactionCurrency(txn));
    }

    function formatTransactionCurrency(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'forex_trade_component') {
            const forexPair = String(txn?.ticker || '').trim();
            const [baseCurrency] = forexPair.split('.');
            return baseCurrency || '';
        }

        const explicitCurrency = String(txn?.currency || '').trim();
        if (explicitCurrency) return explicitCurrency;

        return '';
    }

    function formatForexTradeComponentDescription(txn) {
        const forexPair = String(txn?.ticker || '').trim();
        const [baseCurrency, quoteCurrency] = forexPair.split('.');
        const quantity = getTransactionQuantity(txn);
        const rate = getTransactionPrice(txn);

        if (!baseCurrency || !quoteCurrency || !Number.isFinite(quantity) || !Number.isFinite(rate)) {
            return txn.description || '--';
        }

        const quantityText = Number.isInteger(quantity) ? `${quantity}` : String(txn.quantity_raw ?? txn.quantity_abs ?? txn.normalized?.display_quantity ?? quantity);
        const rateText = String(txn.price_raw ?? txn.normalized?.unit_price ?? rate);
        return `Bought ${quantityText} ${baseCurrency} @ ${baseCurrency}.${quoteCurrency} ${rateText}`;
    }

    function formatTransactionDescription(txn) {
        let description;
        let qty = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity;
        const price = txn.normalized?.unit_price ?? txn.price;
        const normalizedTypeDesc = getNormalizedTransactionType(txn);

        if (normalizedTypeDesc === 'forex_trade_component') {
            return formatForexTradeComponentDescription(txn);
        }

        if (txn.ticker && qty) {
            const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty, 10)) : qty;
            if (price && ['buy', 'sell', 'grant'].includes(normalizedTypeDesc)) {
                const cleanPrice = Number(price).toFixed(2);
                description = `${txn.ticker} @ ${cleanPrice} × ${cleanQty}`;
            } else {
                description = `${txn.ticker}@${cleanQty}`;
            }
        } else if (normalizedTypeDesc === 'deposit') {
            description = '* Equivalent';
        } else if (normalizedTypeDesc === 'withdrawal') {
            description = '';
        } else {
            description = txn.description || '--';
        }

        return description;
    }

    function formatHoldingsMoney(value, { dashWhenZero = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        if (dashWhenZero && Math.abs(value) < 1e-9) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function formatSignedHoldingsMoney(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatHoldingsMoney(0);
        return `${numericValue > 0 ? '+' : '-'}${formatHoldingsMoney(Math.abs(numericValue))}`;
    }

    function formatHoldingsPercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        return `${new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value)}%`;
    }

    function formatHoldingsUsd(value, { dashWhenNull = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) {
            return dashWhenNull ? '-' : '$0.00';
        }
        const sign = value < 0 ? '-' : '';
        return `${sign}$${formatHoldingsMoney(Math.abs(value))}`;
    }

    function formatHoldingsPosition(quantity) {
        if (quantity === null || quantity === undefined || Number.isNaN(quantity) || Math.abs(quantity) < 1e-9) {
            return '-';
        }
        const hasFraction = Math.abs(quantity - Math.round(quantity)) > 1e-9;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: hasFraction ? 2 : 0,
            maximumFractionDigits: hasFraction ? 4 : 0,
        }).format(quantity);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function shouldTrackHoldingTicker(txn) {
        const ticker = String(txn?.ticker || '').trim();
        if (!ticker) return false;
        const normalizedType = getNormalizedTransactionType(txn);
        if (['forex_trade', 'forex_trade_component', 'fx_translation_pnl'].includes(normalizedType)) return false;
        return !isForexPairTicker(ticker);
    }

    function isForexPairTicker(ticker) {
        return /^[A-Z]{3}\.[A-Z]{3}$/i.test(String(ticker || '').trim());
    }

    function isFlatPosition(value) {
        return !Number.isFinite(value) || Math.abs(value) < 1e-9;
    }

    function createPositionState(ticker) {
        return {
            ticker,
            shares: 0,
            totalCost: 0,
            realizedPnl: 0,
        };
    }

    function compareInvestmentTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftDatetime = String(leftTxn?.datetime || leftTxn?.date || '');
        const rightDatetime = String(rightTxn?.datetime || rightTxn?.date || '');
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        const leftDate = String(leftTxn?.date || '');
        const rightDate = String(rightTxn?.date || '');
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftRow = Number(leftTxn?.source?.row_number ?? leftIndex);
        const rightRow = Number(rightTxn?.source?.row_number ?? rightIndex);
        return leftRow - rightRow;
    }

    function getAuthoritativePositionSnapshot() {
        if (window.ANTIGRAVITY_INVESTMENT_DATA?.summary?.position_snapshot_authoritative !== true) {
            return null;
        }
        const rawSnapshot = window.ANTIGRAVITY_INVESTMENT_DATA?.position_snapshot;
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const quantity = Number(snapshot.quantity);
            const costPrice = Number(snapshot.cost_price);
            normalizedSnapshot[normalizedTicker] = {
                quantity: Number.isFinite(quantity) ? quantity : 0,
                costPrice: Number.isFinite(costPrice) ? costPrice : null,
            };
        });
        return normalizedSnapshot;
    }

    function getTransactionEffectiveUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        if (quantity !== null && Number.isFinite(quantity) && quantity > 0) {
            if (txn?.normalized?.net_amount !== undefined && txn?.normalized?.net_amount !== null) {
                const normalizedAmount = Number(txn.normalized.net_amount);
                if (Number.isFinite(normalizedAmount) && Math.abs(normalizedAmount) > 1e-9) {
                    return Math.abs(normalizedAmount) / quantity;
                }
            }
            const normalizedType = getNormalizedTransactionType(txn);
            const economicAmount = getTransactionEconomicAmount(txn);
            const commission = Math.abs(getTransactionCommission(txn));
            if (Number.isFinite(economicAmount) && Math.abs(economicAmount) > 1e-9) {
                if (normalizedType === 'buy') {
                    return (Math.abs(economicAmount) + commission) / quantity;
                }
                if (normalizedType === 'sell') {
                    return Math.max(0, Math.abs(economicAmount) - commission) / quantity;
                }
                return Math.abs(economicAmount) / quantity;
            }
        }
        const price = getTransactionPrice(txn);
        return Number.isFinite(price) ? price : 0;
    }

    function getTransactionRenderedSplitFactor(txn, tickerPriceIndex) {
        if (!shouldTrackHoldingTicker(txn)) return 1;
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return 1;
        const ticker = normalizeInvestmentTicker(txn?.ticker);
        const rawPrice = getTransactionPrice(txn);
        if (!ticker || !Number.isFinite(rawPrice) || rawPrice <= 0) return 1;
        const valuationDate = normalizeLedgerDate(txn?.date);
        const renderedClose = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
        const adjustedPrice = adjustTradePriceForRenderedSeries(rawPrice, renderedClose);
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) return 1;
        const factor = rawPrice / adjustedPrice;
        if (!Number.isFinite(factor) || factor <= 0) return 1;
        const roundedFactor = Math.round(factor);
        return Math.abs(factor - roundedFactor) < 0.08 && roundedFactor >= 2 ? roundedFactor : factor;
    }

    function getTransactionValuationQuantity(txn, tickerPriceIndex) {
        const quantity = getTransactionQuantity(txn);
        if (!Number.isFinite(quantity)) return quantity;
        const factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
        return quantity * (Number.isFinite(factor) && factor > 0 ? factor : 1);
    }

    function resetPositionState(state) {
        state.shares = 0;
        state.totalCost = 0;
    }

    function openPositionLots(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        const signedQuantity = side === 'short' ? -quantity : quantity;
        state.shares += signedQuantity;
        state.totalCost += unitPrice * quantity;
    }

    function closePositionLots(state, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;

        const averagePrice = state.totalCost / Math.abs(state.shares);
        const isLongPosition = state.shares > 0;
        let realizedDelta = 0;

        if (isLongPosition) {
            realizedDelta = (unitPrice - averagePrice) * quantity;
            state.shares -= quantity;
        } else {
            realizedDelta = (averagePrice - unitPrice) * quantity;
            state.shares += quantity;
        }

        state.realizedPnl += realizedDelta;
        state.totalCost -= averagePrice * quantity;

        if (isFlatPosition(state.shares) || isFlatPosition(state.totalCost)) {
            resetPositionState(state);
        }
        return realizedDelta;
    }

    function applyDirectionalTrade(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return 0;

        if (isFlatPosition(state.shares)) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const currentSide = state.shares > 0 ? 'long' : 'short';
        if (currentSide === side) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const closingQuantity = Math.min(Math.abs(state.shares), quantity);
        const realizedDelta = closePositionLots(state, closingQuantity, unitPrice);

        const openingQuantity = quantity - closingQuantity;
        if (openingQuantity > 1e-9) {
            resetPositionState(state);
            openPositionLots(state, side, openingQuantity, unitPrice);
        }
        return realizedDelta;
    }

    function getMoneyMarketTickerSet() {
        const configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        return new Set(
            configuredTickers
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getLatestDashboardEquity(processedTransactions, chartPoints = []) {
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length
            ? chartPoints[chartPoints.length - 1]
            : null;
        const latestValuationEquity = Number(latestChartPoint?.total_equity);
        if (Number.isFinite(latestValuationEquity)) {
            return latestValuationEquity;
        }

        const latestRecord = Array.isArray(processedTransactions) && processedTransactions.length
            ? processedTransactions[processedTransactions.length - 1]
            : null;
        const totalEquity = Number(latestRecord?.total_equity);
        return Number.isFinite(totalEquity) ? totalEquity : 0;
    }

    function normalizeLedgerDate(value) {
        const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function parseInvestmentChartDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
        return new Date(Date.UTC(year, monthIndex, day));
    }

    function getInvestmentStockDetailsRangeLabels(labels, range = 'max') {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        if (normalizedRange === '3d') {
            return orderedLabels.slice(-Math.min(3, orderedLabels.length));
        }

        let startDate = null;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return currentDate instanceof Date && !Number.isNaN(currentDate.getTime()) && currentDate >= startDate;
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function getInvestmentEquityRangeLabels(labels, range = 'max') {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentEquityRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        let startDate = null;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '1m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 1);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return currentDate instanceof Date && !Number.isNaN(currentDate.getTime()) && currentDate >= startDate;
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function buildTickerPriceIndex(tickerClosePrices) {
        const priceIndex = {};
        Object.entries(tickerClosePrices || {}).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap || {}).sort();
            priceIndex[ticker] = {
                dates,
                closes: { ...(dateMap || {}) },
            };
        });
        return priceIndex;
    }

    function normalizePriceHistoryPayload(priceHistoryByTicker) {
        const normalized = {};
        Object.entries(priceHistoryByTicker || {}).forEach(([ticker, rows]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !Array.isArray(rows)) return;
            normalized[normalizedTicker] = {};
            rows.forEach((row) => {
                const date = normalizeLedgerDate(row?.date);
                const close = Number(row?.close);
                if (!date || !Number.isFinite(close)) return;
                normalized[normalizedTicker][date] = close;
            });
        });
        return normalized;
    }

    function getIndexedClosePriceOnOrBefore(priceEntry, targetDate) {
        if (!priceEntry || !targetDate) return null;
        const dates = Array.isArray(priceEntry.dates) ? priceEntry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= targetDate) {
                return Number(priceEntry.closes?.[dates[index]]);
            }
        }
        return null;
    }

    function buildValuationStatus({ backendFailures = [], fallbackTickers = [], missingTickers = [] } = {}) {
        const normalizedBackendFailures = Array.isArray(backendFailures) ? backendFailures : [];
        const formatDisplayTicker = (ticker) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            return normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : normalizedTicker;
        };
        const normalizedFallbackTickers = Array.from(new Set((Array.isArray(fallbackTickers) ? fallbackTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)));
        const normalizedMissingTickers = Array.from(new Set((Array.isArray(missingTickers) ? missingTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)));
        const filteredBackendFailures = normalizedBackendFailures.filter((entry) => {
            const ticker = normalizeInvestmentTicker(entry?.ticker || '');
            return ticker ? !isForexPairTicker(ticker) : true;
        });
        const hasBackendFailures = filteredBackendFailures.length > 0;
        const isDegraded = hasBackendFailures || normalizedFallbackTickers.length > 0 || normalizedMissingTickers.length > 0;
        if (!isDegraded) {
            return {
                isDegraded: false,
                message: '',
                backendFailures: filteredBackendFailures,
                fallbackTickers: normalizedFallbackTickers,
                missingTickers: normalizedMissingTickers,
            };
        }

        const messageParts = [];
        if (normalizedMissingTickers.length) {
            messageParts.push(`Valuation is incomplete for ${normalizedMissingTickers.map((ticker) => formatDisplayTicker(ticker)).join(', ')} because no usable local close history was found.`);
        }
        if (normalizedFallbackTickers.length) {
            messageParts.push(`Using the latest ledger price fallback for ${normalizedFallbackTickers.map((ticker) => formatDisplayTicker(ticker)).join(', ')} until local market history is refreshed.`);
        }
        if (hasBackendFailures) {
            messageParts.push(filteredBackendFailures.map((entry) => {
                const message = String(entry?.message || '');
                const ticker = normalizeInvestmentTicker(entry?.ticker || '');
                return ticker ? message.replaceAll(ticker, formatDisplayTicker(ticker)) : message;
            }).filter(Boolean).join(' '));
        }

        return {
            isDegraded: true,
            message: messageParts.filter(Boolean).join(' '),
            backendFailures: filteredBackendFailures,
            fallbackTickers: normalizedFallbackTickers,
            missingTickers: normalizedMissingTickers,
        };
    }

    function adjustTradePriceForRenderedSeries(transactionPrice, renderedSeriesPrice) {
        const rawTradePrice = Number(transactionPrice);
        const referencePrice = Number(renderedSeriesPrice);
        if (!Number.isFinite(rawTradePrice)) return null;
        if (!Number.isFinite(referencePrice) || referencePrice <= 0 || rawTradePrice <= 0) {
            return rawTradePrice;
        }
        const rawRatio = rawTradePrice / referencePrice;
        if (!Number.isFinite(rawRatio) || rawRatio <= 0) return rawTradePrice;
        const closeEnoughDistance = Math.log(1.35);
        const rawDistance = Math.abs(Math.log(rawRatio));
        if (rawDistance <= closeEnoughDistance) return rawTradePrice;

        const splitFactorCandidates = Array.from(new Set([
            ...investmentCommonSplitFactors,
            ...investmentCommonSplitFactors
                .filter((factor) => Number.isFinite(factor) && factor > 0 && factor !== 1)
                .map((factor) => 1 / factor),
        ])).sort((left, right) => left - right);

        let bestFactor = 1;
        let bestDistance = Number.POSITIVE_INFINITY;
        splitFactorCandidates.forEach((factor) => {
            if (!Number.isFinite(factor) || factor <= 0) return;
            const ratioDistance = Math.abs(Math.log(rawRatio / factor));
            if (ratioDistance < bestDistance) {
                bestDistance = ratioDistance;
                bestFactor = factor;
            }
        });

        const materiallyDifferentFactor = Math.abs(Math.log(bestFactor)) >= Math.log(1.5);
        const confidentlyMatchedFactor = bestDistance <= Math.log(1.12);
        const meaningfullyImproved = bestDistance + 0.08 < rawDistance;
        if (!materiallyDifferentFactor || !confidentlyMatchedFactor || !meaningfullyImproved) {
            return rawTradePrice;
        }

        const adjustedPrice = rawTradePrice / bestFactor;
        const adjustedRatio = adjustedPrice / referencePrice;
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0 || !Number.isFinite(adjustedRatio) || adjustedRatio <= 0) {
            return rawTradePrice;
        }
        return Math.abs(Math.log(adjustedRatio)) <= closeEnoughDistance ? adjustedPrice : rawTradePrice;
    }

    function calculateSnapshotMarketValue(snapshot, valuationDate, tickerPriceIndex, moneyMarketTickers) {
        if (!snapshot || !valuationDate) return { marketValue: 0, holdingsMarketValues: {} };
        let marketValue = 0;
        const holdingsMarketValues = {};

        Object.entries(snapshot.holdings || {}).forEach(([ticker, quantity]) => {
            const numericQuantity = Number(quantity);
            if (!Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;

            let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
            const normalizedTicker = String(ticker).trim().toUpperCase();
            const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);

            if (isMoneyMarketTicker) {
                const anchoredPrice = snapshot.money_market_anchors?.[ticker] ?? snapshot.money_market_anchors?.[normalizedTicker];
                closePrice = anchoredPrice ?? closePrice;
            }

            if ((!Number.isFinite(closePrice) || closePrice === 0) && String(snapshot.ticker || '').trim().toUpperCase() === normalizedTicker) {
                const fallbackPrice = Number(snapshot.price);
                if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                    closePrice = fallbackPrice;
                }
            }

            const safeClosePrice = Number.isFinite(closePrice) ? closePrice : 0;
            const holdingMarketValue = numericQuantity * safeClosePrice;
            marketValue += holdingMarketValue;
            if (Math.abs(holdingMarketValue) > 1e-9) {
                holdingsMarketValues[ticker] = holdingMarketValue;
            }
        });

        return { marketValue, holdingsMarketValues };
    }

    function buildDailyEquityChartPoints(processedTransactions, tickerClosePrices, moneyMarketTickers) {
        if (!Array.isArray(processedTransactions) || !processedTransactions.length) {
            return [];
        }

        const firstLedgerDate = normalizeLedgerDate(processedTransactions[0]?.date);
        if (!firstLedgerDate) return [];

        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const tradingDateSet = new Set();
        Object.values(tickerPriceIndex).forEach((entry) => {
            (entry?.dates || []).forEach((date) => {
                if (date >= firstLedgerDate) {
                    tradingDateSet.add(date);
                }
            });
        });

        const ledgerDateMap = new Map();
        processedTransactions.forEach((txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            if (!ledgerDateMap.has(ledgerDate)) {
                ledgerDateMap.set(ledgerDate, {
                    snapshot: txn,
                    ledgerNos: [],
                    cashInAmount: 0,
                    cashOutAmount: 0,
                    netTransferAmount: 0,
                });
            }
            const entry = ledgerDateMap.get(ledgerDate);
            entry.snapshot = txn;
            entry.ledgerNos.push(Number(txn.ledger_no || 0));
            const normalizedType = getNormalizedTransactionType(txn);
            const transactionAmount = Math.abs(Number(getTransactionAmount(txn)));
            if (!Number.isFinite(transactionAmount) || transactionAmount <= 1e-9) return;
            if (normalizedType === 'deposit') {
                entry.cashInAmount += transactionAmount;
                entry.netTransferAmount += transactionAmount;
            } else if (normalizedType === 'withdrawal') {
                entry.cashOutAmount += transactionAmount;
                entry.netTransferAmount -= transactionAmount;
            }
        });

        const candidateDates = Array.from(new Set([
            ...Array.from(tradingDateSet),
            ...Array.from(ledgerDateMap.keys()),
        ])).sort();

        const points = [];
        let processedCursor = 0;
        let activeSnapshot = null;
        let cumulativeNetTransferAmount = 0;
        let previousTradingPointIndex = -1;

        candidateDates.forEach((date) => {
            while (processedCursor < processedTransactions.length) {
                const nextSnapshot = processedTransactions[processedCursor];
                const nextLedgerDate = normalizeLedgerDate(nextSnapshot?.date);
                if (!nextLedgerDate || nextLedgerDate > date) break;
                activeSnapshot = nextSnapshot;
                processedCursor += 1;
            }

            if (!activeSnapshot) return;

            const valuation = calculateSnapshotMarketValue(activeSnapshot, date, tickerPriceIndex, moneyMarketTickers);
            const ledgerEntry = ledgerDateMap.get(date);
            const anchorLedgerNos = Array.isArray(ledgerEntry?.ledgerNos)
                ? ledgerEntry.ledgerNos.filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                : [];
            const cashInAmount = Number(ledgerEntry?.cashInAmount) || 0;
            const cashOutAmount = Number(ledgerEntry?.cashOutAmount) || 0;
            const netTransferAmount = Number(ledgerEntry?.netTransferAmount) || 0;
            const isTradingDay = tradingDateSet.has(date);
            cumulativeNetTransferAmount += netTransferAmount;

            points.push({
                date,
                running_cash: Number(activeSnapshot.running_cash) || 0,
                market_value: valuation.marketValue,
                holdings_market_values: valuation.holdingsMarketValues,
                total_equity: (Number(activeSnapshot.running_cash) || 0) + valuation.marketValue,
                anchor_ledger_date: anchorLedgerNos.length ? date : '',
                anchor_ledger_nos: anchorLedgerNos,
                cash_in_amount: cashInAmount,
                cash_out_amount: cashOutAmount,
                net_transfer_amount: netTransferAmount,
                cumulative_net_transfer_amount: cumulativeNetTransferAmount,
                is_trading_day: isTradingDay,
                previous_trading_point_index: previousTradingPointIndex,
            });
            if (isTradingDay) {
                previousTradingPointIndex = points.length - 1;
            }
        });

        return points;
    }

    function buildTickerSummaries(transactions, latestPrices, totalEquity, tickerClosePrices = {}) {
        const tickerMap = new Map();
        const orderedTransactions = [...transactions].sort((left, right) => compareInvestmentTransactions(left, right));
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const authoritativePositionSnapshot = getAuthoritativePositionSnapshot();
        const useAuthoritativePositionSnapshot = authoritativePositionSnapshot !== null;

        orderedTransactions.forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const ticker = String(txn.ticker).trim().toUpperCase();
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionValuationQuantity(txn, tickerPriceIndex);
            const amount = getTransactionAmount(txn);

            if (!tickerMap.has(ticker)) {
                tickerMap.set(ticker, createPositionState(ticker));
            }

            const summary = tickerMap.get(ticker);

            if (normalizedType === 'buy' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'long', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                return;
            }

            if (normalizedType === 'grant' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                return;
            }

            // Dividend reinvestment adds shares that were funded by a separate
            // dividend cash flow, so we should not count the reinvested amount
            // as fresh cost basis again in realized P&L reporting.
            if (normalizedType === 'dividend_reinvestment' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                return;
            }

            if (normalizedType === 'sell' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'short', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                return;
            }

            if (['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)) {
                summary.realizedPnl += amount;
            }
        });

        if (useAuthoritativePositionSnapshot) {
            Object.keys(authoritativePositionSnapshot).forEach((ticker) => {
                if (!tickerMap.has(ticker)) {
                    tickerMap.set(ticker, createPositionState(ticker));
                }
            });
        }

        return Array.from(tickerMap.values()).map((summary) => {
            const snapshotEntry = useAuthoritativePositionSnapshot
                ? authoritativePositionSnapshot[summary.ticker] ?? null
                : null;
            const shares = useAuthoritativePositionSnapshot
                ? Number(snapshotEntry?.quantity) || 0
                : summary.shares;
            const totalCost = useAuthoritativePositionSnapshot && snapshotEntry
                ? Math.abs(shares) * (Number(snapshotEntry.costPrice) || 0)
                : summary.totalCost;
            const hasOpenPosition = !isFlatPosition(shares);
            const averagePrice = hasOpenPosition
                ? (snapshotEntry && Number.isFinite(snapshotEntry.costPrice)
                    ? snapshotEntry.costPrice
                    : (totalCost / Math.abs(shares)))
                : null;
            const lastPrice = latestPrices[summary.ticker] ?? null;
            const marketValue = hasOpenPosition && lastPrice !== null ? shares * lastPrice : 0;
            const unrealizedPnl = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (shares > 0
                    ? (lastPrice - averagePrice) * shares
                    : (averagePrice - lastPrice) * Math.abs(shares))
                : null;
            const positionWeight = Number.isFinite(totalEquity) && Math.abs(totalEquity) > 1e-9 && hasOpenPosition
                ? (marketValue / totalEquity) * 100
                : 0;

            return {
                ...summary,
                shares,
                totalCost,
                averagePrice,
                lastPrice,
                marketValue,
                unrealizedPnl,
                positionWeight,
                hasOpenPosition,
            };
        }).sort((left, right) => {
            if (left.hasOpenPosition !== right.hasOpenPosition) {
                return left.hasOpenPosition ? -1 : 1;
            }
            if (left.hasOpenPosition && right.hasOpenPosition) {
                return Math.abs(right.marketValue) - Math.abs(left.marketValue);
            }
            return left.ticker.localeCompare(right.ticker);
        });
    }

    function formatAmount(value) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    return {
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        buildDailyEquityChartPoints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
        compareInvestmentTransactions,
        calculateSnapshotMarketValue,
        closePositionLots,
        createPositionState,
        escapeHtml,
        formatAmountWithCurrency,
        formatForexTradeComponentDescription,
        formatHoldingsMoney,
        formatHoldingsPercent,
        formatHoldingsPosition,
        formatHoldingsUsd,
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
        getAuthoritativePositionSnapshot,
        getMoneyMarketTickerSet,
        getNormalizedTransactionType,
        getTransactionAmount,
        getTransactionCommission,
        getTransactionEconomicAmount,
        getTransactionEffectiveUnitPrice,
        getTransactionRenderedSplitFactor,
        getTransactionValuationQuantity,
        getTransactionPrice,
        getTransactionQuantity,
        isFlatPosition,
        isForexPairTicker,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        parseInvestmentChartDate,
        resetPositionState,
        shouldTrackHoldingTicker,
    };
}
