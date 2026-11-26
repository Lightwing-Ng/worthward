/**
 * Portfolio-level sell attribution for the Lowest-cost lots first method.
 *
 * Code version: v1.1.0
 */

const ACQUISITION_TYPES = new Set(['buy', 'grant', 'dividend_reinvestment']);
const TRANSFER_TYPES = new Set(['transfer_in', 'transfer_out']);
const QUANTITY_TOLERANCE = 1e-9;

export function getInvestmentPortfolioLotAssignmentKey(transaction, scope, executionQuantity) {
    const type = String(transaction?.type || '').trim().toLowerCase();
    if (!['buy', 'sell'].includes(type) || !Number.isFinite(executionQuantity) || executionQuantity <= 0
        || !scope?.ticker || scope.ticker === 'missing-ticker' || !/^[A-Z]{3}$/.test(scope.currency)) return '';

    const orderId = String(transaction.source?.statement_order_id || transaction.source?.order_id || '').trim();
    const fallbackKey = String(transaction.manual_internal_transfer_key || '').trim();
    const identity = scope.broker === 'hsbc' && orderId && scope.accountToken && scope.accountToken !== 'missing-account'
        ? ['hsbc', scope.accountToken, type, orderId]
        : fallbackKey;
    return identity ? JSON.stringify([scope.ticker, scope.currency, executionQuantity, identity]) : '';
}

function hasDateOnlyExecution(transaction) {
    const source = transaction.source || {};
    const intraday = String(source.source_has_intraday_timestamp ?? '').trim().toLowerCase();
    if (source.datetime_precision === 'day' || intraday === 'false') {
        return true;
    }
    if (source.datetime_precision === 'second' || intraday === 'true') {
        return false;
    }
    if (['hsbc_order_status_capture', 'hsbc_order_status_text'].includes(source.file_kind)) {
        return true;
    }
    const executionTime = String(transaction.datetime || '').match(/[T ](\d{2}:\d{2}(?::\d{2})?)/)?.[1];
    return !executionTime || ['00:00', '00:00:00', '20:00', '20:00:00'].includes(executionTime);
}

function orderPortfolioAcquisitions(entries) {
    const entriesByDate = new Map();
    for (const entry of entries) {
        if (!entriesByDate.has(entry.date)) entriesByDate.set(entry.date, []);
        entriesByDate.get(entry.date).push(entry);
    }
    return [...entriesByDate.values()].flatMap((dayEntries) => {
        const sells = dayEntries.filter(({type}) => type === 'sell');
        const ordered = [];
        const deferred = [];
        for (const entry of dayEntries) {
            const ambiguousAcquisition = ACQUISITION_TYPES.has(entry.type) && sells.some((sale) => (
                sale.scope.broker !== entry.scope.broker && (sale.dateOnly || entry.dateOnly)
            ));
            // A date-only row does not establish that a lot was open before another broker's sale.
            (ambiguousAcquisition ? deferred : ordered).push(entry);
        }
        return [...ordered, ...deferred];
    });
}

function findPortfolioTransferPairs(entries) {
    const transfersByKey = new Map();
    const receiptsBySource = new Map();
    for (const entry of entries) {
        if (!TRANSFER_TYPES.has(entry.type)) continue;
        const key = String(entry.transaction.manual_internal_transfer_key || '').trim();
        if (key) transfersByKey.set(key, transfersByKey.has(key) ? null : entry);
        if (entry.type !== 'transfer_in') continue;
        const sourceKey = String(entry.transaction.carried_cost_basis_source_transfer_key || '').trim();
        if (sourceKey) receiptsBySource.set(sourceKey, receiptsBySource.has(sourceKey) ? null : entry);
    }

    const paired = new Set();
    for (const [sourceKey, receipt] of receiptsBySource) {
        const source = transfersByKey.get(sourceKey);
        if (!receipt || source?.type !== 'transfer_out') continue;
        const receiptKey = String(receipt.transaction.manual_internal_transfer_key || '').trim();
        if (
            transfersByKey.get(receiptKey) !== receipt
            || source.transaction.transfer_out_cost_basis_status !== 'known'
            || receipt.transaction.carried_cost_basis_status !== 'known'
            || !source.date || !receipt.date || source.date > receipt.date
            || !(source.quantity > QUANTITY_TOLERANCE)
            || Math.abs(source.quantity - receipt.quantity) > QUANTITY_TOLERANCE
            || !Number.isFinite(source.quantity) || !Number.isFinite(receipt.quantity)
        ) continue;
        // An evidenced internal transfer leaves the portfolio's quantity and basis intact.
        paired.add(source);
        paired.add(receipt);
    }
    return paired;
}

function getPortfolioSecurityId(transaction, scope) {
    const source = transaction.source || {};
    const id = String(source.isin || source.cusip || scope.securityId || '').trim().toUpperCase();
    if (id === 'MISSING-SECURITY-ID') return '';
    // The national security number of a US ISIN is its CUSIP.
    return id.match(/^US([A-Z0-9]{9})\d$/)?.[1] || id;
}

function hasPortfolioAssignmentScope(key, scope) {
    try {
        const identity = JSON.parse(key);
        return Array.isArray(identity) && identity[0] === scope.ticker && identity[1] === scope.currency;
    } catch {
        return false;
    }
}

function getPortfolioExecutionTime(transaction) {
    const datetime = String(transaction.datetime || '').trim().replace(' ', 'T');
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(datetime);
    const timestamp = /T\d{2}:\d{2}/.test(datetime) ? Date.parse(hasOffset ? datetime : `${datetime}Z`) : NaN;
    return {timestamp, hasOffset};
}

function isPortfolioBuyEligibleForAssignment(buy, sale) {
    if (buy?.type !== 'buy' || !buy.date || !sale.date || buy.date > sale.date
        || !Number.isFinite(buy.quantity) || buy.quantity <= QUANTITY_TOLERANCE) return false;
    // A manual pairing can establish the order of date-only fills on the same day.
    if (buy.dateOnly || sale.dateOnly) return true;
    const buyTime = getPortfolioExecutionTime(buy.transaction);
    const saleTime = getPortfolioExecutionTime(sale.transaction);
    return buyTime.hasOffset === saleTime.hasOffset && buyTime.timestamp <= saleTime.timestamp;
}

function findPortfolioLotReservations(entries, lotAssignments, getTransactionEvidencedUnitPrice) {
    const assignments = lotAssignments.filter(([key]) => hasPortfolioAssignmentScope(key, entries[0].scope));
    if (!assignments.length) return null;
    const entriesByKey = new Map();
    for (const entry of entries) {
        const {transaction, scope, executionQuantity} = entry;
        const key = getInvestmentPortfolioLotAssignmentKey(transaction, scope, executionQuantity);
        if (key) entriesByKey.set(key, entriesByKey.has(key) ? null : entry);
    }

    const reservedBuys = new Set();
    const basisBySale = new Map();
    for (const [saleKey, buyKeys] of assignments) {
        const sale = entriesByKey.get(saleKey);
        if (sale?.type !== 'sell' || !Array.isArray(buyKeys) || !buyKeys.length
            || !Number.isFinite(sale.quantity) || sale.quantity <= QUANTITY_TOLERANCE) return null;

        let quantity = 0;
        let basis = 0;
        for (const buyKey of buyKeys) {
            const buy = entriesByKey.get(buyKey);
            if (!isPortfolioBuyEligibleForAssignment(buy, sale) || reservedBuys.has(buy)) return null;
            const unitPrice = getTransactionEvidencedUnitPrice(buy.transaction, buy.executionQuantity);
            if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
            quantity += buy.quantity;
            basis += unitPrice * buy.executionQuantity;
            reservedBuys.add(buy);
        }
        if (Math.abs(quantity - sale.quantity) > QUANTITY_TOLERANCE || !Number.isFinite(basis)) return null;
        basisBySale.set(sale, basis);
    }
    return {reservedBuys, basisBySale};
}

function replayPortfolioSales(entries, pairedTransfers, reservations, {
    createPositionState,
    applyInvestmentTransactionToState,
    closePositionLots,
    getInvestmentReplaySellProceeds,
    getTransactionEvidencedUnitPrice,
}) {
    const results = new Map();
    const applied = new Set();
    const state = createPositionState(entries[0].scope.ticker);
    for (const entry of entries) {
        const {transaction, type, date, quantity, executionQuantity} = entry;
        if (!date || !Number.isFinite(quantity) || quantity <= QUANTITY_TOLERANCE) break;
        // A reserved acquisition contributes its full basis to its designated sale.
        if (pairedTransfers.has(entry) || reservations?.reservedBuys.has(entry)) continue;
        if (TRANSFER_TYPES.has(type)) break;
        if (!Number.isFinite(executionQuantity) || executionQuantity <= 0) break;
        if (type === 'sell') {
            const reservedBasis = reservations?.basisBySale.get(entry);
            const proceeds = getInvestmentReplaySellProceeds(transaction, executionQuantity);
            if (reservedBasis !== undefined) {
                const realized = proceeds - reservedBasis;
                if (!Number.isFinite(proceeds) || !Number.isFinite(realized)) break;
                results.set(transaction, realized);
                applied.add(transaction);
                continue;
            }
            if (state.shares < quantity - QUANTITY_TOLERANCE) break;
            // Even an unpriced sale consumes its evidenced quantity for later attribution.
            const unitPrice = Number.isFinite(proceeds) ? proceeds / quantity : 0;
            const realizedPnl = closePositionLots(state, quantity, unitPrice);
            if (Number.isFinite(proceeds) && Number.isFinite(realizedPnl)) {
                results.set(transaction, realizedPnl);
            }
            continue;
        }

        const executionUnitPrice = getTransactionEvidencedUnitPrice(transaction, executionQuantity);
        const unitPriceOverride = executionUnitPrice === null
            ? null : executionUnitPrice * executionQuantity / quantity;
        applyInvestmentTransactionToState(state, transaction, type, quantity, 0, date, {unitPriceOverride});
        const lot = state.lots.at(-1);
        if (
            state.costBasisStatus !== 'known'
            || !Number.isFinite(state.totalCost)
            || !Number.isFinite(lot?.unitPrice)
            || (type !== 'grant' && lot.unitPrice <= 0)
        ) break;
    }
    return {results, applied};
}

export function buildInvestmentPortfolioSellAttribution(transactions, {
    getInvestmentCostBasisMethod,
    getTransactionLotScope,
    getNormalizedTransactionType,
    normalizeLedgerDate,
    sortInvestmentTransactionsForReplay,
    createPositionState,
    applyInvestmentTransactionToState,
    closePositionLots,
    getInvestmentReplaySellProceeds,
    getTransactionEvidencedUnitPrice,
    getTransactionQuantity,
}, getValuationQuantity, {lotAssignments = {}, appliedAssignments = null} = {}) {
    const results = new Map();
    if (getInvestmentCostBasisMethod() !== 'lowest_cost_first') return results;

    const requestedAssignments = Object.entries(lotAssignments || {});
    const entriesByCurrency = new Map();
    for (const transaction of sortInvestmentTransactionsForReplay(transactions)) {
        const type = getNormalizedTransactionType(transaction);
        if (type !== 'sell' && !ACQUISITION_TYPES.has(type) && !TRANSFER_TYPES.has(type)) continue;
        const scope = getTransactionLotScope(transaction);
        if (!/^[A-Z]{3}$/.test(scope.currency)) continue;
        if (!entriesByCurrency.has(scope.currency)) entriesByCurrency.set(scope.currency, []);
        entriesByCurrency.get(scope.currency).push({
            transaction,
            type,
            scope,
            date: normalizeLedgerDate(transaction.date),
            dateOnly: hasDateOnlyExecution(transaction),
            quantity: getValuationQuantity(transaction),
            executionQuantity: getTransactionQuantity(transaction),
        });
    }

    const replayHelpers = {
        createPositionState,
        applyInvestmentTransactionToState,
        closePositionLots,
        getInvestmentReplaySellProceeds,
        getTransactionEvidencedUnitPrice,
    };
    for (const entries of entriesByCurrency.values()) {
        const brokers = new Set(entries.map(({scope}) => scope.broker));
        const tickers = new Set(entries.map(({scope}) => scope.ticker));
        const securityIds = new Set(entries.map(({transaction, scope}) => (
            getPortfolioSecurityId(transaction, scope)
        )).filter(Boolean));
        if (brokers.size < 2 || brokers.has('missing-broker') || tickers.size !== 1 || securityIds.size > 1) {
            continue;
        }
        const pairedTransfers = findPortfolioTransferPairs(entries);
        const ordered = orderPortfolioAcquisitions(entries);
        const reservations = findPortfolioLotReservations(entries, requestedAssignments, getTransactionEvidencedUnitPrice);
        let replay = replayPortfolioSales(ordered, pairedTransfers, reservations, replayHelpers);
        // Infeasible reservations never partially replace the default attribution for a pool.
        if (reservations && replay.applied.size !== reservations.basisBySale.size) {
            replay = replayPortfolioSales(ordered, pairedTransfers, null, replayHelpers);
        }
        for (const [transaction, realized] of replay.results) results.set(transaction, realized);
        if (appliedAssignments) for (const transaction of replay.applied) appliedAssignments.add(transaction);
    }
    return results;
}
