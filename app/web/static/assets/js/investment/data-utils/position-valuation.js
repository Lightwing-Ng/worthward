/**
 * Position lots, split adjustment, ranges, and valuation utilities.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment data-utilities composition root.
 */

export function createInvestmentPositionValuationUtils(runtime) {
    const INVESTMENT_BASE_CURRENCY = runtime.INVESTMENT_BASE_CURRENCY;
    const INVESTMENT_MONEY_MARKET_STANDARD_NAMES = runtime.INVESTMENT_MONEY_MARKET_STANDARD_NAMES;
    const investmentCommonSplitFactors = runtime.investmentCommonSplitFactors;
    const convertAmountToBaseCurrency = (...args) => runtime.convertAmountToBaseCurrency(...args);
    const getInvestmentCostBasisMethod = (...args) => runtime.getInvestmentCostBasisMethod(...args);
    const getNormalizedTransactionType = (...args) => runtime.getNormalizedTransactionType(...args);
    const getTickerQuoteCurrency = (...args) => runtime.getTickerQuoteCurrency(...args);
    const getTransactionPrice = (...args) => runtime.getTransactionPrice(...args);
    const getTransactionQuantity = (...args) => runtime.getTransactionQuantity(...args);
    const isFlatPosition = (...args) => runtime.isFlatPosition(...args);
    const isForexPairTicker = (...args) => runtime.isForexPairTicker(...args);
    const isSyntheticCashEquivalentTicker = (...args) => runtime.isSyntheticCashEquivalentTicker(...args);
    const normalizeInvestmentEquityRange = (...args) => runtime.normalizeInvestmentEquityRange(...args);
    const normalizeInvestmentStockDetailsRange = (...args) => runtime.normalizeInvestmentStockDetailsRange(...args);
    const normalizeInvestmentTicker = (...args) => runtime.normalizeInvestmentTicker(...args);
    const shouldTrackHoldingTicker = (...args) => runtime.shouldTrackHoldingTicker(...args);

    const INVESTMENT_LINEAGE_PROXY_TICKERS = new Set(['SPY', 'SPY.US']);

    function getInvestmentIdentityStoreAliasCandidates(ticker) {
        return getInvestmentTickerStoreAliasCandidates(ticker)
            .filter((candidate) => !INVESTMENT_LINEAGE_PROXY_TICKERS.has(candidate));
    }

    function getIndexedClosePriceForTransaction(txn, tickerPriceIndex) {
        const valuationDate = normalizeLedgerDate(txn?.date);
        if (!valuationDate || !tickerPriceIndex) return null;
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        addCandidate(txn?.ticker);
        addCandidate(getInvestmentCanonicalTicker(txn?.ticker));
        getInvestmentIdentityStoreAliasCandidates(txn?.ticker).forEach(addCandidate);
        for (let index = 0; index < candidates.length; index += 1) {
            const close = getIndexedClosePriceOnOrBefore(tickerPriceIndex[candidates[index]], valuationDate);
            if (Number.isFinite(close) && close > 0) {
                return close;
            }
        }
        return null;
    }

    function normalizeRenderedSplitFactor(factor) {
        if (!Number.isFinite(factor) || factor <= 0) return 1;
        const roundedFactor = Math.round(factor);
        if (factor >= 1 && Math.abs(factor - roundedFactor) < 0.08 && roundedFactor >= 2) {
            return roundedFactor;
        }
        const reciprocalFactor = 1 / factor;
        const roundedReciprocalFactor = Math.round(reciprocalFactor);
        if (
            factor < 1
            && Math.abs(reciprocalFactor - roundedReciprocalFactor) < 0.08
            && roundedReciprocalFactor >= 2
        ) {
            return 1 / roundedReciprocalFactor;
        }
        return factor;
    }

    function getTransactionRenderedSplitFactor(txn, tickerPriceIndex) {
        if (!shouldTrackHoldingTicker(txn)) return 1;
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return 1;
        const rawPrice = getTransactionPrice(txn);
        if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 1;
        const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
        const adjustedPrice = adjustTradePriceForRenderedSeries(rawPrice, renderedClose);
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) return 1;
        return normalizeRenderedSplitFactor(rawPrice / adjustedPrice);
    }

    function getRenderedSplitFactorHintKey(txn) {
        const ticker = getInvestmentCanonicalTicker(txn?.ticker);
        const date = normalizeLedgerDate(txn?.date);
        return ticker && date ? `${ticker}|${date}` : '';
    }

    function buildRenderedSplitFactorHints(transactions, tickerPriceIndex) {
        const buckets = new Map();
        const factorEvidenceByTicker = new Map();
        const earliestFactorEvidenceByTicker = new Map();
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return;
            const key = getRenderedSplitFactorHintKey(txn);
            if (!key) return;
            const factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
            if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return;
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            if (ticker) {
                if (!factorEvidenceByTicker.has(ticker)) {
                    factorEvidenceByTicker.set(ticker, []);
                }
                factorEvidenceByTicker.get(ticker).push(factor);
                const date = normalizeLedgerDate(txn?.date);
                const earliestEvidence = earliestFactorEvidenceByTicker.get(ticker);
                if (date && (!earliestEvidence || date < earliestEvidence.date)) {
                    earliestFactorEvidenceByTicker.set(ticker, {date, factor});
                }
            }
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(factor);
        });
        const dominantFactorByTicker = new Map();
        factorEvidenceByTicker.forEach((evidence, ticker) => {
            const roundedCounts = new Map();
            evidence.forEach((factor) => {
                const roundedKey = factor.toFixed(8);
                roundedCounts.set(roundedKey, (Number(roundedCounts.get(roundedKey)) || 0) + 1);
            });
            const rankedFactors = Array.from(roundedCounts.entries())
                .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]));
            const [bestFactor, bestCount] = rankedFactors[0] || [];
            const secondCount = Number(rankedFactors[1]?.[1]) || 0;
            const numericFactor = Number(bestFactor);
            if (
                Number.isFinite(numericFactor)
                && numericFactor > 0
                && Math.abs(Math.log(numericFactor)) >= Math.log(1.5)
                && bestCount >= 3
                && (secondCount === 0 || bestCount >= secondCount * 2)
            ) {
                dominantFactorByTicker.set(ticker, {
                    factor: numericFactor,
                    count: bestCount,
                });
            }
        });
        const hints = new Map();
        const dominantFactorCorrections = new Map();
        buckets.forEach((factors, key) => {
            const roundedCounts = new Map();
            factors.forEach((factor) => {
                const roundedKey = factor.toFixed(8);
                roundedCounts.set(roundedKey, (Number(roundedCounts.get(roundedKey)) || 0) + 1);
            });
            const [bestFactor] = Array.from(roundedCounts.entries())
                .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]))[0] || [];
            const numericFactor = Number(bestFactor);
            if (Number.isFinite(numericFactor) && numericFactor > 0) {
                hints.set(key, numericFactor);
            }
        });

        // A trade can be far enough from that day's close to miss the strict
        // per-row split match even though sibling trades for the same ticker
        // prove the rendered price basis. Use the nearest proven factor only
        // when the raw-to-rendered ratio still falls within the normal close
        // movement tolerance. This preserves post-split rows whose ratio is
        // near 1 while repairing noisy pre-split rows such as old TQQQ fills.
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const key = getRenderedSplitFactorHintKey(txn);
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            if (!key || !ticker || hints.has(key)) return;
            const evidence = factorEvidenceByTicker.get(ticker);
            if (!Array.isArray(evidence) || !evidence.length) return;
            const rawPrice = getTransactionPrice(txn);
            const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
            if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(renderedClose) || renderedClose <= 0) {
                return;
            }
            const rawRatio = rawPrice / renderedClose;
            if (!Number.isFinite(rawRatio) || rawRatio <= 0) return;
            const bestFactor = evidence
                .reduce((best, factor) => (
                    Math.abs(Math.log(rawRatio / factor)) < best.distance
                        ? {factor, distance: Math.abs(Math.log(rawRatio / factor))}
                        : best
                ), {factor: 1, distance: Number.POSITIVE_INFINITY});
            if (
                Number.isFinite(bestFactor.factor)
                && bestFactor.factor > 0
                && bestFactor.distance <= Math.log(1.35)
            ) {
                hints.set(key, bestFactor.factor);
            }
        });

        // Local daily history can begin after an earlier split. A transaction
        // before the first observed close has no row-level price ratio, but it
        // is still on the same pre-split basis as the first proven trade.
        // Carry that earliest non-trivial factor backward only for rows without
        // close evidence, preserving normal factor-one rows thereafter.
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const key = getRenderedSplitFactorHintKey(txn);
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            const date = normalizeLedgerDate(txn?.date);
            if (!key || !ticker || !date || hints.has(key)) return;
            const earliestEvidence = earliestFactorEvidenceByTicker.get(ticker);
            if (!earliestEvidence || date >= earliestEvidence.date) return;
            const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
            if (Number.isFinite(renderedClose) && renderedClose > 0) return;
            hints.set(key, earliestEvidence.factor);
        });

        // A single fill can produce a plausible but wrong common split factor
        // when its raw price happens to be close to another candidate. If the
        // ticker has overwhelming sibling evidence for one factor, prefer that
        // factor for the isolated row while keeping the normal close movement
        // tolerance. This keeps a noisy TQQQ 1.5× inference from leaving 12.50
        // phantom shares after a genuinely flat 2-for-1-adjusted sequence.
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const key = getRenderedSplitFactorHintKey(txn);
            const ticker = getInvestmentCanonicalTicker(txn?.ticker);
            const dominant = dominantFactorByTicker.get(ticker);
            if (!key || !ticker || !dominant) return;
            const currentFactor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
            if (
                Number.isFinite(currentFactor)
                && currentFactor > 0
                && Math.abs(Math.log(currentFactor / dominant.factor)) <= Math.log(1.12)
            ) {
                return;
            }
            const rawPrice = getTransactionPrice(txn);
            const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
            if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(renderedClose) || renderedClose <= 0) {
                return;
            }
            const rawRatio = rawPrice / renderedClose;
            const dominantDistance = Math.abs(Math.log(rawRatio / dominant.factor));
            if (Number.isFinite(rawRatio) && rawRatio > 0 && dominantDistance <= Math.log(1.35)) {
                hints.set(key, dominant.factor);
                dominantFactorCorrections.set(key, dominant.factor);
            }
        });
        hints.dominantFactorCorrections = dominantFactorCorrections;
        return hints;
    }

    function hasAuthoritativeImportedPositionQuantity(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return false;
        if (
            txn?.normalized?.position_quantity !== undefined
            && txn?.normalized?.position_quantity !== null
            && String(txn.normalized.position_quantity).trim() !== ''
        ) {
            return true;
        }
        if (txn?.quantity_abs !== undefined && txn?.quantity_abs !== null && String(txn.quantity_abs).trim() !== '') {
            return true;
        }
        if (txn?.quantity_raw !== undefined && txn?.quantity_raw !== null && String(txn.quantity_raw).trim() !== '') {
            return true;
        }
        return false;
    }

    function getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints = null) {
        const quantity = getTransactionQuantity(txn);
        if (!Number.isFinite(quantity)) return quantity;
        const normalizedType = getNormalizedTransactionType(txn);
        let factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
        if (
            ['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)
            && renderedSplitFactorHints instanceof Map
        ) {
            const hintKey = getRenderedSplitFactorHintKey(txn);
            const hintedFactor = renderedSplitFactorHints.get(hintKey);
            const dominantHintedFactor = renderedSplitFactorHints.dominantFactorCorrections instanceof Map
                ? renderedSplitFactorHints.dominantFactorCorrections.get(hintKey)
                : null;
            if (Number.isFinite(dominantHintedFactor) && dominantHintedFactor > 0) {
                factor = dominantHintedFactor;
            } else if (
                (!Number.isFinite(factor) || Math.abs(Math.log(factor)) < 1e-9)
                && Number.isFinite(hintedFactor)
                && hintedFactor > 0
            ) {
                factor = hintedFactor;
            }
        }
        if (
            hasAuthoritativeImportedPositionQuantity(txn)
            && (!Number.isFinite(factor) || Math.abs(Math.log(factor)) < 1e-9)
        ) {
            return quantity;
        }
        return quantity * (Number.isFinite(factor) && factor > 0 ? factor : 1);
    }

    function resetPositionState(state) {
        state.shares = 0;
        state.totalCost = 0;
        state.lots = [];
        state.nextLotSequence = 0;
    }

    function ensurePositionLots(state) {
        if (!Array.isArray(state.lots)) state.lots = [];
        if (state.lots.length || isFlatPosition(state.shares)) return state.lots;
        const shares = Number(state.shares) || 0;
        const totalCost = Number(state.totalCost) || 0;
        const averagePrice = Math.abs(shares) > 1e-9 ? totalCost / Math.abs(shares) : 0;
        state.lots.push({
            quantity: shares,
            unitPrice: Number.isFinite(averagePrice) ? averagePrice : 0,
            sequence: Number(state.nextLotSequence) || 0,
        });
        state.nextLotSequence = (Number(state.nextLotSequence) || 0) + 1;
        return state.lots;
    }

    function openPositionLots(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        ensurePositionLots(state);
        const safeUnitPrice = Number.isFinite(Number(unitPrice)) ? Number(unitPrice) : 0;
        const signedQuantity = side === 'short' ? -quantity : quantity;
        state.shares += signedQuantity;
        state.totalCost += safeUnitPrice * quantity;
        state.lotMatchingMethod = getInvestmentCostBasisMethod();
        state.lots.push({
            quantity: signedQuantity,
            unitPrice: safeUnitPrice,
            sequence: Number(state.nextLotSequence) || 0,
        });
        state.nextLotSequence = (Number(state.nextLotSequence) || 0) + 1;
    }

    function getLotsForClosing(state, side) {
        const method = getInvestmentCostBasisMethod();
        const sign = side === 'short' ? -1 : 1;
        const lots = ensurePositionLots(state).filter((lot) => (
            Math.sign(Number(lot?.quantity) || 0) === sign
            && Math.abs(Number(lot?.quantity) || 0) > 1e-9
            && Number.isFinite(Number(lot?.unitPrice))
        ));
        const sequenceOrder = (left, right) => (
            (Number(left?.sequence) || 0) - (Number(right?.sequence) || 0)
        );
        if (method === 'fifo') return lots.sort(sequenceOrder);
        if (method === 'lifo') return lots.sort((left, right) => sequenceOrder(right, left));
        if (method === 'lowest_cost_first') {
            return lots.sort((left, right) => {
                const priceDelta = sign > 0
                    ? Number(left.unitPrice) - Number(right.unitPrice)
                    : Number(right.unitPrice) - Number(left.unitPrice);
                return Math.abs(priceDelta) > 1e-9 ? priceDelta : sequenceOrder(left, right);
            });
        }
        return lots;
    }

    function consumePositionLots(state, quantity, {useAverage = false} = {}) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) {
            return {removedQuantity: 0, removedCost: 0};
        }
        const sign = state.shares > 0 ? 1 : -1;
        const originalShares = Number(state.shares) || 0;
        const originalTotalCost = Number(state.totalCost) || 0;
        if (useAverage) {
            const averagePrice = Math.abs(originalShares) > 1e-9
                ? originalTotalCost / Math.abs(originalShares)
                : 0;
            state.lots = [{
                quantity: originalShares,
                unitPrice: averagePrice,
                sequence: Number(state.nextLotSequence) || 0,
            }];
        }
        const lots = getLotsForClosing(state, sign > 0 ? 'long' : 'short');
        let remaining = Math.min(quantity, Math.abs(originalShares));
        let removedCost = 0;
        let removedQuantity = 0;
        lots.forEach((lot) => {
            if (remaining <= 1e-9) return;
            const lotQuantity = Math.abs(Number(lot.quantity) || 0);
            const matchedQuantity = Math.min(lotQuantity, remaining);
            if (matchedQuantity <= 1e-9) return;
            lot.quantity -= sign * matchedQuantity;
            removedQuantity += matchedQuantity;
            removedCost += Number(lot.unitPrice) * matchedQuantity;
            remaining -= matchedQuantity;
        });
        if (remaining > 1e-9) {
            const sharesAfterLots = originalShares - (sign * removedQuantity);
            const costAfterLots = originalTotalCost - removedCost;
            const fallbackQuantity = Math.min(Math.abs(sharesAfterLots), remaining);
            const fallbackAverage = Math.abs(sharesAfterLots) > 1e-9
                ? costAfterLots / Math.abs(sharesAfterLots)
                : 0;
            removedQuantity += fallbackQuantity;
            removedCost += fallbackAverage * fallbackQuantity;
        }
        state.shares = originalShares - (sign * removedQuantity);
        state.totalCost = Math.max(0, originalTotalCost - removedCost);
        state.lots = ensurePositionLots(state).filter((lot) => Math.abs(Number(lot.quantity) || 0) > 1e-9);
        return {removedQuantity, removedCost};
    }

    function removePositionLots(state, quantity, { basisOverride = null, useAverage = false } = {}) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;
        const originalTotalCost = Number(state.totalCost) || 0;
        const {removedQuantity} = consumePositionLots(state, quantity, {useAverage});
        if (basisOverride !== null && Number.isFinite(Number(basisOverride))) {
            const targetTotalCost = Math.max(0, originalTotalCost - Number(basisOverride));
            const remainingShares = Math.abs(Number(state.shares) || 0);
            const remainingLotCost = state.lots.reduce(
                (total, lot) => total + (Math.abs(Number(lot.quantity) || 0) * Number(lot.unitPrice) || 0),
                0,
            );
            const costAdjustmentPerShare = remainingShares > 1e-9
                ? (targetTotalCost - remainingLotCost) / remainingShares
                : 0;
            state.lots.forEach((lot) => {
                lot.unitPrice = Math.max(0, Number(lot.unitPrice) + costAdjustmentPerShare);
            });
            state.totalCost = targetTotalCost;
        }
        return removedQuantity;
    }

    function closePositionLots(state, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;

        const isLongPosition = state.shares > 0;
        const method = getInvestmentCostBasisMethod();
        state.lotMatchingMethod = method;
        const {removedQuantity, removedCost} = consumePositionLots(
            state,
            quantity,
            {useAverage: method === 'moving_average'},
        );
        const realizedDelta = isLongPosition
            ? (unitPrice * removedQuantity) - removedCost
            : removedCost - (unitPrice * removedQuantity);

        state.realizedPnl += realizedDelta;

        if (isFlatPosition(state.shares)) {
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
        const configuredTickers = globalThis.window?.WORTHWARD_INVESTMENT_DATA?.money_market_tickers;
        const sourceTickers = Array.isArray(configuredTickers)
            ? configuredTickers
            : Object.keys(INVESTMENT_MONEY_MARKET_STANDARD_NAMES);
        return new Set(
            sourceTickers
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getCashEquivalentTickerSet() {
        const configuredTickers = window.WORTHWARD_INVESTMENT_DATA?.cash_equivalent_tickers;
        return new Set(
            [
                ...(Array.isArray(configuredTickers) ? configuredTickers : []),
                ...getMoneyMarketTickerSet(),
            ]
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getLatestDashboardEquity(processedTransactions, chartPoints = []) {
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length
            ? chartPoints[chartPoints.length - 1]
            : null;
        const latestValuationEquity = Number(
            latestChartPoint?.aggregate_current_total_equity
            ?? latestChartPoint?.aggregate_total_equity
            ?? latestChartPoint?.total_equity,
        );
        if (Number.isFinite(latestValuationEquity)) {
            return latestValuationEquity;
        }

        const latestRecord = Array.isArray(processedTransactions) && processedTransactions.length
            ? processedTransactions[processedTransactions.length - 1]
            : null;
        const totalEquity = Number(latestRecord?.aggregate_total_equity ?? latestRecord?.total_equity);
        return Number.isFinite(totalEquity) ? totalEquity : 0;
    }

    function computeInvestmentLiveHoldingsTotalEquity(summaries, aggregateCash) {
        if (aggregateCash === null || aggregateCash === undefined || aggregateCash === '') return null;
        const safeCash = Number(aggregateCash);
        if (!Number.isFinite(safeCash)) return null;
        const openSummaries = (Array.isArray(summaries) ? summaries : [])
            .filter((summary) => summary?.hasOpenPosition);
        if (openSummaries.some((summary) => (
            summary?.marketValue === null
            || summary?.marketValue === undefined
            || summary?.marketValue === ''
            || !Number.isFinite(Number(summary.marketValue))
        ))) {
            return null;
        }
        const openMarketValue = openSummaries.reduce(
            (sum, summary) => sum + Number(summary.marketValue),
            0,
        );
        return safeCash + openMarketValue;
    }

    function normalizeLedgerDate(value) {
        const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function compareHsbcCashSettlementBoundaries(left, right) {
        return (
            left.date.localeCompare(right.date)
            || left.sourceRowSequence - right.sourceRowSequence
            || left.sourceRowNumber - right.sourceRowNumber
            || left.sourceIndex - right.sourceIndex
            || left.postingIndex - right.postingIndex
        );
    }

    function getHsbcCashSettlementBoundaryScopeKey(boundary) {
        return [
            boundary.date,
            String(boundary.broker || '').trim().toLowerCase(),
            String(boundary.account || '').trim(),
            String(boundary.currency || '').trim().toUpperCase(),
        ].join('|');
    }

    function areHsbcCashSettlementBalancesContinuous(leftBalance, rightBalance) {
        return (
            Number.isFinite(leftBalance)
            && Number.isFinite(rightBalance)
            && Math.abs(leftBalance - rightBalance) <= 0.011
        );
    }

    function orderHsbcCashSettlementBoundaryScope(boundaries) {
        const fallbackOrder = [...boundaries].sort(compareHsbcCashSettlementBoundaries);
        if (fallbackOrder.length < 2) return fallbackOrder;

        const outgoingByBoundary = new Map(fallbackOrder.map((boundary) => [boundary, []]));
        const incomingByBoundary = new Map(fallbackOrder.map((boundary) => [boundary, []]));
        fallbackOrder.forEach((left) => {
            const leftBalanceAfter = left.settlementBalanceAfter === null
                ? Number.NaN
                : Number(left.settlementBalanceAfter);
            fallbackOrder.forEach((right) => {
                if (left === right) return;
                const rightBalanceAfter = right.settlementBalanceAfter === null
                    ? Number.NaN
                    : Number(right.settlementBalanceAfter);
                const rightAmount = right.settlementAmount === null
                    ? Number.NaN
                    : Number(right.settlementAmount);
                const rightBalanceBefore = rightBalanceAfter - rightAmount;
                if (!areHsbcCashSettlementBalancesContinuous(leftBalanceAfter, rightBalanceBefore)) return;
                outgoingByBoundary.get(left).push(right);
                incomingByBoundary.get(right).push(left);
            });
        });

        const connectedByBoundary = new Map(fallbackOrder.map((boundary) => [boundary, new Set([
            ...outgoingByBoundary.get(boundary),
            ...incomingByBoundary.get(boundary),
        ])]));
        const visited = new Set();
        const reordered = [...fallbackOrder];
        fallbackOrder.forEach((candidate) => {
            if (visited.has(candidate)) return;
            const component = [];
            const pending = [candidate];
            while (pending.length) {
                const boundary = pending.pop();
                if (visited.has(boundary)) continue;
                visited.add(boundary);
                component.push(boundary);
                connectedByBoundary.get(boundary).forEach((neighbor) => {
                    if (!visited.has(neighbor)) pending.push(neighbor);
                });
            }
            if (component.length < 2) return;
            if (component.some((boundary) => (
                outgoingByBoundary.get(boundary).length > 1
                || incomingByBoundary.get(boundary).length > 1
            ))) return;
            const starts = component.filter((boundary) => incomingByBoundary.get(boundary).length === 0);
            if (starts.length !== 1) return;

            const chronologicalOrder = [];
            const seen = new Set();
            let cursor = starts[0];
            while (cursor && !seen.has(cursor)) {
                chronologicalOrder.push(cursor);
                seen.add(cursor);
                cursor = outgoingByBoundary.get(cursor)[0] || null;
            }
            if (chronologicalOrder.length !== component.length) return;

            const occupiedIndexes = component
                .map((boundary) => fallbackOrder.indexOf(boundary))
                .sort((left, right) => left - right);
            occupiedIndexes.forEach((targetIndex, index) => {
                reordered[targetIndex] = chronologicalOrder[index];
            });
        });
        return reordered;
    }

    function orderHsbcCashSettlementBoundaries(boundaries) {
        const fallbackOrder = [...boundaries].sort(compareHsbcCashSettlementBoundaries);
        const groupedByScope = new Map();
        fallbackOrder.forEach((boundary) => {
            const scopeKey = getHsbcCashSettlementBoundaryScopeKey(boundary);
            if (!groupedByScope.has(scopeKey)) groupedByScope.set(scopeKey, []);
            groupedByScope.get(scopeKey).push(boundary);
        });
        const rankByBoundary = new Map();
        groupedByScope.forEach((scopeBoundaries) => {
            orderHsbcCashSettlementBoundaryScope(scopeBoundaries).forEach((boundary, index) => {
                rankByBoundary.set(boundary, index);
            });
        });
        return fallbackOrder.sort((left, right) => {
            const fallbackComparison = compareHsbcCashSettlementBoundaries(left, right);
            if (getHsbcCashSettlementBoundaryScopeKey(left) !== getHsbcCashSettlementBoundaryScopeKey(right)) {
                return fallbackComparison;
            }
            return (rankByBoundary.get(left) - rankByBoundary.get(right)) || fallbackComparison;
        });
    }

    function buildHsbcCashSettlementBoundaryPlan(transactions = []) {
        const boundaries = [];
        (Array.isArray(transactions) ? transactions : []).forEach((txn, ownerTransactionIndex) => {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const broker = String(txn?.broker || source.broker || '').trim().toLowerCase();
            const normalizedType = String(txn?.type || '').trim().toLowerCase();
            const transactionDate = normalizeLedgerDate(txn?.date);
            if (
                broker !== 'hsbc'
                || !['buy', 'sell'].includes(normalizedType)
                || !transactionDate
            ) return;

            const rawPostings = Array.isArray(source.cash_settlement_postings)
                ? source.cash_settlement_postings
                : [];
            const candidatePostings = rawPostings.length
                ? rawPostings
                : [{
                    date: source.cash_settlement_date,
                    amount_raw: source.cash_settlement_amount_raw,
                    balance_after_raw: source.cash_settlement_balance_after_raw,
                    reference: source.cash_settlement_reference,
                    row_number: source.cash_settlement_source_row_number,
                    ledger_sequence: source.cash_settlement_source_row_number,
                    currency: txn?.currency,
                    role: 'legacy_order_summary',
                }];

            candidatePostings.forEach((posting, postingIndex) => {
                const settlementDate = normalizeLedgerDate(posting?.date || source.cash_settlement_date);
                if (!settlementDate || settlementDate <= transactionDate) return;
                const settlementAmount = Number(posting?.amount_raw ?? posting?.amount);
                const settlementBalance = Number(posting?.balance_after_raw);
                if (!Number.isFinite(settlementAmount) && !Number.isFinite(settlementBalance)) return;
                const sourceRowSequence = Number(
                    posting?.ledger_sequence
                    ?? posting?.row_number
                    ?? source.cash_settlement_source_row_number
                    ?? 0,
                );
                const sourceRowNumber = Number(
                    posting?.row_number
                    ?? source.cash_settlement_source_row_number
                    ?? 0,
                );
                boundaries.push({
                    ownerTransactionIndex,
                    broker: txn?.broker || source.broker || 'hsbc',
                    account: txn?.account || source.account || source.account_number || '',
                    transactionDate,
                    date: settlementDate,
                    currency: String(posting?.currency || txn?.currency || 'USD').trim().toUpperCase() || 'USD',
                    settlementAmount: Number.isFinite(settlementAmount) ? settlementAmount : null,
                    settlementBalanceAfter: Number.isFinite(settlementBalance) ? settlementBalance : null,
                    sourceRowSequence: Number.isFinite(sourceRowSequence) ? sourceRowSequence : 0,
                    sourceRowNumber: Number.isFinite(sourceRowNumber) ? sourceRowNumber : 0,
                    sourceFileKind: String(
                        posting?.source_file_kind || source.file_kind || '',
                    ).trim().toLowerCase(),
                    sourceIndex: ownerTransactionIndex,
                    postingIndex,
                    role: String(posting?.role || 'principal').trim() || 'principal',
                    reference: String(
                        posting?.reference
                        || source.cash_settlement_reference
                        || source.statement_order_id
                        || '',
                    ).trim(),
                });
            });
        });
        return orderHsbcCashSettlementBoundaries(boundaries);
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

    function shiftLedgerDate(value, dayOffset) {
        const parsedDate = parseInvestmentChartDate(value);
        if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) return '';
        const shiftedDate = new Date(parsedDate.getTime());
        shiftedDate.setUTCDate(shiftedDate.getUTCDate() + Number(dayOffset || 0));
        const year = shiftedDate.getUTCFullYear();
        const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(shiftedDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function enumerateCalendarDateKeys(startValue, endValue) {
        const startDate = parseInvestmentChartDate(startValue);
        const endDate = parseInvestmentChartDate(endValue);
        if (
            !(startDate instanceof Date)
            || Number.isNaN(startDate.getTime())
            || !(endDate instanceof Date)
            || Number.isNaN(endDate.getTime())
            || startDate > endDate
        ) {
            return [];
        }
        const dates = [];
        for (
            let currentDate = new Date(startDate.getTime());
            currentDate <= endDate;
            currentDate.setUTCDate(currentDate.getUTCDate() + 1)
        ) {
            dates.push(currentDate.toISOString().slice(0, 10));
        }
        return dates;
    }

    function getInvestmentStockDetailsRangeLabels(labels, range = 'max', options = {}) {
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
        let endDate = latestDate;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        } else if (normalizedRange === 'auto') {
            const tradeDates = Array.isArray(options?.tradeDates)
                ? options.tradeDates.map((value) => normalizeLedgerDate(value)).filter(Boolean)
                : [];
            if (!tradeDates.length) return orderedLabels;
            const firstTradeDate = parseInvestmentChartDate(tradeDates[0]);
            const lastTradeDate = parseInvestmentChartDate(tradeDates[tradeDates.length - 1]);
            if (
                !(firstTradeDate instanceof Date)
                || Number.isNaN(firstTradeDate.getTime())
                || !(lastTradeDate instanceof Date)
                || Number.isNaN(lastTradeDate.getTime())
            ) {
                return orderedLabels;
            }
            startDate = new Date(firstTradeDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            if (options?.isOpenPosition === false) {
                endDate = new Date(lastTradeDate.getTime());
                endDate.setUTCDate(endDate.getUTCDate() + 7);
                if (endDate > latestDate) {
                    endDate = latestDate;
                }
            }
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return (
                currentDate instanceof Date
                && !Number.isNaN(currentDate.getTime())
                && currentDate >= startDate
                && currentDate <= endDate
            );
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
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
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
        const rawMaps = {};
        Object.entries(priceHistoryByTicker || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, rows]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !Array.isArray(rows)) return;
            rawMaps[normalizedTicker] = rawMaps[normalizedTicker] || {};
            const candidatesByDate = {};
            rows.forEach((row) => {
                const date = normalizeLedgerDate(row?.date);
                const close = Number(row?.close);
                if (!date || !Number.isFinite(close) || close <= 0) return;
                if (!candidatesByDate[date]) candidatesByDate[date] = [];
                candidatesByDate[date].push({
                    close,
                    signature: JSON.stringify(row),
                });
            });
            Object.entries(candidatesByDate).forEach(([date, candidates]) => {
                candidates.sort((left, right) => (
                    left.signature.localeCompare(right.signature)
                    || left.close - right.close
                ));
                rawMaps[normalizedTicker][date] = candidates[0].close;
            });
        });
        const normalized = {};
        Object.entries(rawMaps).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, dateMap]) => {
            normalized[ticker] = { ...(normalized[ticker] || {}), ...dateMap };
        });
        Object.entries(rawMaps).sort(([left], [right]) => left.localeCompare(right)).forEach(([ticker, dateMap]) => {
            if (INVESTMENT_LINEAGE_PROXY_TICKERS.has(ticker)) return;
            const canonicalTicker = getInvestmentCanonicalTicker(ticker);
            if (!canonicalTicker || canonicalTicker === ticker) return;
            normalized[canonicalTicker] = normalized[canonicalTicker] || {};
            Object.entries(dateMap || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([date, close]) => {
                if (normalized[canonicalTicker][date] === undefined) {
                    normalized[canonicalTicker][date] = close;
                }
            });
        });
        return normalized;
    }

    function getIndexedClosePriceOnOrBefore(priceEntry, targetDate) {
        if (!priceEntry || !targetDate) return null;
        const dates = Array.isArray(priceEntry.dates) ? priceEntry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= targetDate) {
                const close = Number(priceEntry.closes?.[dates[index]]);
                if (Number.isFinite(close) && close > 0) return close;
            }
        }
        return null;
    }

    const INVESTMENT_TICKER_LINEAGE_FALLBACK = {
        'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
        SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
        'HK0000369196.USD': ['HK0000369196'],
        'HK0000369196.HK': ['HK0000369196'],
        'HK0000584752.HK': ['HK0000584752'],
        'HK0000584737.HK': ['HK0000584737'],
        'HK0000478872.HK': ['HK0000478872'],
        'HK0000720752.HK': ['HK0000720752'],
        'HK0001039582.USD': ['HK0001039582'],
        'HK0001039582.HK': ['HK0001039582'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD': ['HK0000720752'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_USD.USD': ['HK0000584737'],
        'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_HKD.HKD': ['HK0000478872'],
    };

    function getInvestmentTickerLineageMap() {
        const payloadLineage = globalThis.window?.WORTHWARD_INVESTMENT_DATA?.ticker_lineage;
        if (payloadLineage && typeof payloadLineage === 'object' && !Array.isArray(payloadLineage)) {
            return payloadLineage;
        }
        return INVESTMENT_TICKER_LINEAGE_FALLBACK;
    }

    function getInvestmentTickerStoreAliasCandidates(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedAlias = normalizeInvestmentTicker(value);
            if (normalizedAlias && !candidates.includes(normalizedAlias)) {
                candidates.push(normalizedAlias);
            }
        };
        const lineageMap = getInvestmentTickerLineageMap();
        (lineageMap[normalizedTicker] || []).forEach((alias) => {
            addCandidate(alias);
        });
        if (normalizedTicker.endsWith('.US')) {
            addCandidate(normalizedTicker.slice(0, -3).trim());
        }
        if (normalizedTicker.endsWith('.HK')) {
            const [symbol, suffix] = normalizedTicker.split('.');
            const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
            if (strippedSymbol && strippedSymbol !== symbol) {
                addCandidate(`${strippedSymbol}.${suffix}`);
            }
        }
        addCandidate(normalizedTicker);
        if (
            !normalizedTicker.endsWith('.US')
            && !normalizedTicker.endsWith('.HK')
            && /^[A-Z0-9]+$/.test(normalizedTicker)
        ) {
            addCandidate(`${normalizedTicker}.US`);
        }
        return candidates;
    }

    function getInvestmentCanonicalTicker(ticker) {
        const candidates = getInvestmentTickerStoreAliasCandidates(ticker);
        return candidates[0] || normalizeInvestmentTicker(ticker);
    }

    function getInvestmentLegacyLineageTickers(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const lineageMap = getInvestmentTickerLineageMap();
        const proxyTickers = new Set(['SPY', 'SPY.US']);
        const legacyTickers = [];
        Object.entries(lineageMap).forEach(([legacyTicker, successors]) => {
            const identitySuccessors = (Array.isArray(successors) ? successors : [])
                .map((entry) => normalizeInvestmentTicker(entry))
                .filter((entry) => entry && !proxyTickers.has(entry));
            if (identitySuccessors.includes(normalizedTicker)) {
                const normalizedLegacyTicker = normalizeInvestmentTicker(legacyTicker);
                if (normalizedLegacyTicker && !legacyTickers.includes(normalizedLegacyTicker)) {
                    legacyTickers.push(normalizedLegacyTicker);
                }
            }
        });
        return legacyTickers;
    }

    function getInvestmentTickerProfileLookupCandidates(ticker) {
        const legacyLineageTickers = getInvestmentLegacyLineageTickers(ticker);
        const storeAliasCandidates = getInvestmentTickerStoreAliasCandidates(ticker);
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        legacyLineageTickers.forEach(addCandidate);
        storeAliasCandidates.forEach(addCandidate);
        return candidates;
    }

    function buildValuationStatus({
        backendFailures = [],
        fallbackTickers = [],
        missingTickers = [],
        openTickers = [],
    } = {}) {
        const normalizedBackendFailures = Array.isArray(backendFailures) ? backendFailures : [];
        const openTickerSet = new Set(
            (Array.isArray(openTickers) ? openTickers : [])
                .map((ticker) => normalizeInvestmentTicker(ticker))
                .filter(Boolean),
        );
        const isOpenTicker = (ticker) => openTickerSet.has(normalizeInvestmentTicker(ticker));
        const formatDisplayTicker = (ticker) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            return normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : normalizedTicker;
        };
        const normalizedFallbackTickers = Array.from(new Set((Array.isArray(fallbackTickers) ? fallbackTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const normalizedMissingTickers = Array.from(new Set((Array.isArray(missingTickers) ? missingTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const filteredBackendFailures = normalizedBackendFailures.filter((entry) => {
            const ticker = normalizeInvestmentTicker(entry?.ticker || '');
            if (ticker && isForexPairTicker(ticker)) return false;
            if (ticker && !isOpenTicker(ticker)) return false;
            return true;
        });
        const hasBackendFailures = filteredBackendFailures.length > 0;
        const isDegraded = hasBackendFailures || normalizedMissingTickers.length > 0;
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

    function calculateSnapshotMarketValue(
        snapshot,
        valuationDate,
        tickerPriceIndex,
        moneyMarketTickers,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (!snapshot || !valuationDate) {
            return {
                marketValue: 0,
                holdingsMarketValues: {},
                holdingPrices: {},
                missingPriceTickers: [],
                degradedPriceTickers: [],
                isComplete: false,
            };
        }
        let marketValue = 0;
        const holdingsMarketValues = {};
        const holdingPrices = {};
        const missingPriceTickers = new Set();
        const degradedPriceTickers = new Set();

        Object.entries(snapshot.holdings || {}).forEach(([ticker, quantity]) => {
            const numericQuantity = Number(quantity);
            if (!Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;

            let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
            const normalizedTicker = String(ticker).trim().toUpperCase();
            const isMoneyMarketTicker = (
                moneyMarketTickers.has(normalizedTicker)
                || isSyntheticCashEquivalentTicker(normalizedTicker)
            );

            if (isMoneyMarketTicker) {
                const anchoredPrice = snapshot.money_market_anchors?.[ticker] ?? snapshot.money_market_anchors?.[normalizedTicker];
                closePrice = anchoredPrice ?? closePrice;
            }

            if (!Number.isFinite(closePrice) || closePrice <= 0) {
                missingPriceTickers.add(normalizedTicker);
                return;
            }

            const holdingMarketValue = numericQuantity * closePrice;
            const quoteCurrency = getTickerQuoteCurrency(ticker);
            const holdingMarketValueBase = convertAmountToBaseCurrency(
                holdingMarketValue,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            marketValue += holdingMarketValueBase;
            if (Math.abs(holdingMarketValueBase) > 1e-9) {
                holdingsMarketValues[ticker] = holdingMarketValueBase;
            }
            holdingPrices[normalizedTicker] = closePrice;
        });

        return {
            marketValue,
            holdingsMarketValues,
            holdingPrices,
            missingPriceTickers: Array.from(missingPriceTickers).sort(),
            degradedPriceTickers: Array.from(degradedPriceTickers).sort(),
            isComplete: missingPriceTickers.size === 0 && Number.isFinite(marketValue),
        };
    }

    return {
        INVESTMENT_LINEAGE_PROXY_TICKERS,
        INVESTMENT_TICKER_LINEAGE_FALLBACK,
        getInvestmentIdentityStoreAliasCandidates,
        getIndexedClosePriceForTransaction,
        normalizeRenderedSplitFactor,
        getTransactionRenderedSplitFactor,
        getRenderedSplitFactorHintKey,
        buildRenderedSplitFactorHints,
        hasAuthoritativeImportedPositionQuantity,
        getTransactionValuationQuantity,
        resetPositionState,
        ensurePositionLots,
        openPositionLots,
        getLotsForClosing,
        consumePositionLots,
        removePositionLots,
        closePositionLots,
        applyDirectionalTrade,
        getMoneyMarketTickerSet,
        getCashEquivalentTickerSet,
        getLatestDashboardEquity,
        computeInvestmentLiveHoldingsTotalEquity,
        normalizeLedgerDate,
        compareHsbcCashSettlementBoundaries,
        getHsbcCashSettlementBoundaryScopeKey,
        areHsbcCashSettlementBalancesContinuous,
        orderHsbcCashSettlementBoundaryScope,
        orderHsbcCashSettlementBoundaries,
        buildHsbcCashSettlementBoundaryPlan,
        parseInvestmentChartDate,
        shiftLedgerDate,
        enumerateCalendarDateKeys,
        getInvestmentStockDetailsRangeLabels,
        getInvestmentEquityRangeLabels,
        buildTickerPriceIndex,
        normalizePriceHistoryPayload,
        getIndexedClosePriceOnOrBefore,
        getInvestmentTickerLineageMap,
        getInvestmentTickerStoreAliasCandidates,
        getInvestmentCanonicalTicker,
        getInvestmentLegacyLineageTickers,
        getInvestmentTickerProfileLookupCandidates,
        buildValuationStatus,
        adjustTradePriceForRenderedSeries,
        calculateSnapshotMarketValue,
    };
}
