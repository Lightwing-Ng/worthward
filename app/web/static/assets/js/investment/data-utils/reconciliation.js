/**
 * Authoritative snapshot, reconciliation, and transaction-state utilities.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment data-utilities composition root.
 */

export function createInvestmentReconciliationUtils(runtime) {
    const USMART_HK_FRACTIONAL_SYNTHETIC_TICKER = runtime.USMART_HK_FRACTIONAL_SYNTHETIC_TICKER;
    const applyDirectionalTrade = (...args) => runtime.applyDirectionalTrade(...args);
    const compareInvestmentTaxLotTransactions = (...args) => runtime.compareInvestmentTaxLotTransactions(...args);
    const compareInvestmentTransactionsForReplay = (...args) => runtime.compareInvestmentTransactionsForReplay(...args);
    const getInvestmentBrokerPositionSnapshotAsOf = (...args) => runtime.getInvestmentBrokerPositionSnapshotAsOf(...args);
    const getInvestmentCanonicalTicker = (...args) => runtime.getInvestmentCanonicalTicker(...args);
    const getInvestmentPositionSnapshotAsOf = (...args) => runtime.getInvestmentPositionSnapshotAsOf(...args);
    const getNormalizedTransactionType = (...args) => runtime.getNormalizedTransactionType(...args);
    const getTickerQuoteCurrency = (...args) => runtime.getTickerQuoteCurrency(...args);
    const getTransactionAmount = (...args) => runtime.getTransactionAmount(...args);
    const getTransactionBrokerRealizedPnl = (...args) => runtime.getTransactionBrokerRealizedPnl(...args);
    const getTransactionCommission = (...args) => runtime.getTransactionCommission(...args);
    const getTransactionEconomicAmount = (...args) => runtime.getTransactionEconomicAmount(...args);
    const getTransactionLotScope = (...args) => runtime.getTransactionLotScope(...args);
    const getTransactionPrice = (...args) => runtime.getTransactionPrice(...args);
    const getTransactionQuantity = (...args) => runtime.getTransactionQuantity(...args);
    const hasPartialTaxLotHistorySource = (...args) => runtime.hasPartialTaxLotHistorySource(...args);
    const isFlatPosition = (...args) => runtime.isFlatPosition(...args);
    const isForexPairTicker = (...args) => runtime.isForexPairTicker(...args);
    const isUsmartHkFractionalSharesTransaction = (...args) => runtime.isUsmartHkFractionalSharesTransaction(...args);
    const normalizeInvestmentLotScopeAccount = (...args) => runtime.normalizeInvestmentLotScopeAccount(...args);
    const normalizeInvestmentTicker = (...args) => runtime.normalizeInvestmentTicker(...args);
    const normalizeLedgerDate = (...args) => runtime.normalizeLedgerDate(...args);
    const openPositionLots = (...args) => runtime.openPositionLots(...args);
    const removePositionLots = (...args) => runtime.removePositionLots(...args);

    function getAuthoritativeSnapshotFiniteNumber(value) {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        const normalizedValue = typeof value === 'string' ? value.trim() : value;
        if (normalizedValue === '') return null;
        const numericValue = Number(normalizedValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function normalizeAuthoritativeCostBasis(snapshot) {
        const reportedStatus = String(snapshot?.cost_basis_status || '').trim().toLowerCase();
        const costPrice = getAuthoritativeSnapshotFiniteNumber(snapshot?.cost_price);
        if (reportedStatus === 'partial' || reportedStatus === 'unknown') {
            return { costBasisStatus: reportedStatus, costPrice: null };
        }
        if (costPrice === null) {
            return { costBasisStatus: 'unknown', costPrice: null };
        }
        return { costBasisStatus: 'known', costPrice };
    }

    function combineAuthoritativeCostBasisStatus(leftStatus, rightStatus) {
        const left = leftStatus === 'known' || leftStatus === 'partial'
            ? leftStatus
            : 'unknown';
        const right = rightStatus === 'known' || rightStatus === 'partial'
            ? rightStatus
            : 'unknown';
        if (left === 'known' && right === 'known') return 'known';
        if (left === 'unknown' && right === 'unknown') return 'unknown';
        return 'partial';
    }

    function normalizeAuthoritativePositionSnapshot(rawSnapshot) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const quantity = getAuthoritativeSnapshotFiniteNumber(snapshot.quantity);
            const { costBasisStatus, costPrice } = normalizeAuthoritativeCostBasis(snapshot);
            const marketValue = (
                getAuthoritativeSnapshotFiniteNumber(snapshot.market_value)
                ?? getAuthoritativeSnapshotFiniteNumber(snapshot.value)
            );
            const lastPrice = (
                getAuthoritativeSnapshotFiniteNumber(snapshot.last_price)
                ?? getAuthoritativeSnapshotFiniteNumber(snapshot.close_price)
            );
            normalizedSnapshot[normalizedTicker] = {
                quantity: quantity ?? 0,
                costBasisStatus,
                costPrice,
                marketValue,
                lastPrice,
            };
        });
        return normalizedSnapshot;
    }

    function normalizeBrokerRealizedPnlReconciliation(rawReconciliation, ticker = '') {
        if (!rawReconciliation || typeof rawReconciliation !== 'object') return null;
        const rawAsOf = rawReconciliation.as_of && typeof rawReconciliation.as_of === 'object'
            ? rawReconciliation.as_of
            : {};
        const rawReplay = rawReconciliation.replay && typeof rawReconciliation.replay === 'object'
            ? rawReconciliation.replay
            : {};
        const normalizedTicker = getInvestmentCanonicalTicker(
            rawReconciliation.ticker || ticker,
        );
        const baseline = Number(rawReconciliation.baseline?.realized_pnl);
        const postTransactionCount = Number(
            rawReplay.post_performance_transaction_count
            ?? rawReconciliation.post_performance_transaction_count,
        );
        const postSellCount = Number(
            rawReplay.post_performance_sell_count
            ?? rawReconciliation.post_performance_sell_count,
        );
        return {
            schemaVersion: String(rawReconciliation.schema_version || 'v1').trim() || 'v1',
            broker: String(rawReconciliation.broker || '').trim().toLowerCase(),
            account: String(rawReconciliation.account || '').trim(),
            ticker: normalizedTicker,
            coverageStatus: String(
                rawReconciliation.coverage_status || rawReconciliation.coverage || 'unknown',
            ).trim().toLowerCase() || 'unknown',
            asOf: {
                performanceSnapshot: normalizeLedgerDate(
                    rawAsOf.performance_snapshot
                    ?? rawReconciliation.performance_snapshot_as_of,
                ),
                positionSnapshot: normalizeLedgerDate(
                    rawAsOf.position_snapshot
                    ?? rawReconciliation.position_snapshot_as_of,
                ),
                transactionHistory: normalizeLedgerDate(
                    rawAsOf.transaction_history
                    ?? rawReconciliation.transaction_history_through,
                ),
            },
            replay: {
                status: String(
                    rawReplay.status || rawReconciliation.replay_status || 'unknown',
                ).trim().toLowerCase() || 'unknown',
                required: rawReplay.required === true
                    || rawReconciliation.replay_required === true,
                reason: String(
                    rawReplay.reason || rawReconciliation.replay_reason || '',
                ).trim(),
                postPerformanceTransactionCount: Number.isFinite(postTransactionCount)
                    ? postTransactionCount
                    : 0,
                postPerformanceSellCount: Number.isFinite(postSellCount) ? postSellCount : 0,
                source: String(rawReconciliation.replay_source || '').trim(),
            },
            baselineRealizedPnlLocal: Number.isFinite(baseline) ? baseline : null,
            baselineCurrency: String(rawReconciliation.baseline?.currency || '').trim().toUpperCase(),
            historyComplete: typeof rawReconciliation.history_complete === 'boolean'
                ? rawReconciliation.history_complete
                : null,
            historyMatched: rawReconciliation.history_matched === true,
            source: String(rawReconciliation.source || '').trim(),
            backend: rawReconciliation,
        };
    }

    function getBrokerRealizedPnlReconciliationMap(broker, accountId, fallback = null) {
        if (fallback && typeof fallback === 'object') return fallback;
        const rawByAccount = window.WORTHWARD_INVESTMENT_DATA?.realized_pnl_reconciliation;
        if (!rawByAccount || typeof rawByAccount !== 'object') return {};
        const normalizedBroker = String(broker || '').trim().toLowerCase();
        const normalizedAccount = String(accountId || '').trim();
        const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, normalizedAccount);
        const directCandidates = [
            rawByAccount[`${normalizedBroker}:${normalizedAccount}`],
            rawByAccount[`${normalizedBroker}:${accountToken}`],
        ];
        const direct = directCandidates.find((candidate) => candidate && typeof candidate === 'object');
        if (direct?.tickers && typeof direct.tickers === 'object') return direct.tickers;
        if (direct && typeof direct === 'object') return direct;
        return {};
    }

    function getBrokerRealizedPnlReconciliationSeed(
        brokerPositionSnapshot,
        brokerPerformanceSnapshot,
        ticker,
    ) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker) return null;
        const candidates = [
            brokerPositionSnapshot?.realizedPnlReconciliation?.[normalizedTicker],
            brokerPositionSnapshot?.realizedPnlReconciliation?.[ticker],
            brokerPerformanceSnapshot?.realizedPnlReconciliation?.[normalizedTicker],
            brokerPerformanceSnapshot?.realizedPnlReconciliation?.[ticker],
            getBrokerRealizedPnlReconciliationMap(
                brokerPositionSnapshot?.broker,
                brokerPositionSnapshot?.accountId,
            )?.[normalizedTicker],
            getBrokerRealizedPnlReconciliationMap(
                brokerPerformanceSnapshot?.broker,
                brokerPerformanceSnapshot?.accountId,
            )?.[normalizedTicker],
        ];
        const rawCandidate = candidates.find((candidate) => candidate && typeof candidate === 'object');
        return normalizeBrokerRealizedPnlReconciliation(rawCandidate, normalizedTicker);
    }

    function getAuthoritativePositionSnapshot() {
        if (window.WORTHWARD_INVESTMENT_DATA?.summary?.position_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePositionSnapshot(
            window.WORTHWARD_INVESTMENT_DATA?.position_snapshot,
        );
    }

    function getAuthoritativeBrokerPositionSnapshots() {
        const brokerSummaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return [];
        const snapshots = [];
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            if (summary.position_snapshot_authoritative !== true) return;
            const rawSnapshot = summary.position_snapshot;
            if (!rawSnapshot || typeof rawSnapshot !== 'object') return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            snapshots.push({
                broker: normalizedBroker,
                accountId: String(summary.account_id ?? summary.account ?? '').trim(),
                accountToken: normalizeInvestmentLotScopeAccount(
                    normalizedBroker,
                    summary.account_id ?? summary.account ?? '',
                ),
                positionSnapshotAsOf: getInvestmentBrokerPositionSnapshotAsOf(normalizedBroker),
                positionSnapshot: normalizeAuthoritativePositionSnapshot(rawSnapshot),
                positionSnapshotRaw: rawSnapshot,
                holdingsValidation: summary.holdings_validation && typeof summary.holdings_validation === 'object'
                    ? summary.holdings_validation
                    : null,
                realizedPnlReconciliation: getBrokerRealizedPnlReconciliationMap(
                    normalizedBroker,
                    summary.account_id ?? summary.account ?? '',
                    summary.realized_pnl_reconciliation,
                ),
            });
        });
        return snapshots;
    }

    function normalizeLedgerDateTime(value, fallbackDate = '') {
        const rawValue = String(value || '').trim().replace('T', ' ');
        const dateTimeMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
        if (dateTimeMatch) return `${dateTimeMatch[1]} ${dateTimeMatch[2]}`;
        const dateMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) return `${dateMatch[1]} 00:00:00`;
        const normalizedFallbackDate = normalizeLedgerDate(fallbackDate);
        return normalizedFallbackDate ? `${normalizedFallbackDate} 00:00:00` : '';
    }

    function getInvestmentTransactionDateTime(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        for (const candidate of [
            txn?.datetime,
            source.execution_datetime,
            source.trade_datetime,
            source.history_order_datetime,
            txn?.date,
        ]) {
            const normalized = normalizeLedgerDateTime(candidate, txn?.date);
            if (normalized) return normalized;
        }
        return '';
    }

    function getAuthoritativeBrokerPositionBoundary(
        brokerPositionSnapshot,
        ticker,
    ) {
        const normalizedTicker = getInvestmentCanonicalTicker(ticker);
        if (!normalizedTicker || !brokerPositionSnapshot) return null;
        const normalizedEntry = brokerPositionSnapshot.positionSnapshot?.[normalizedTicker];
        const rawEntry = brokerPositionSnapshot.positionSnapshotRaw?.[normalizedTicker]
            ?? brokerPositionSnapshot.positionSnapshotRaw?.[ticker];
        if (!normalizedEntry || !rawEntry || typeof rawEntry !== 'object') return null;
        const quantity = getAuthoritativeSnapshotFiniteNumber(normalizedEntry.quantity);
        const costPrice = normalizedEntry.costBasisStatus === 'known'
            ? getAuthoritativeSnapshotFiniteNumber(normalizedEntry.costPrice)
            : null;
        if (quantity === null || quantity < 0 || (costPrice !== null && costPrice < 0)) return null;
        const rawAsOf = rawEntry.as_of ?? rawEntry.asOf;
        const exactBoundaryMatch = String(rawAsOf || '')
            .trim()
            .replace('T', ' ')
            .match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
        const fallbackBoundaryDate = normalizeLedgerDate(
            brokerPositionSnapshot.positionSnapshotAsOf,
        );
        const boundaryDateTime = exactBoundaryMatch
            ? `${exactBoundaryMatch[1]} ${exactBoundaryMatch[2]}`
            : (fallbackBoundaryDate ? `${fallbackBoundaryDate} 23:59:59` : '');
        if (!boundaryDateTime) return null;
        return {
            quantity,
            totalCost: costPrice === null ? null : quantity * costPrice,
            boundaryDateTime,
            boundarySource: 'authoritative_position_snapshot',
        };
    }

    function getBrokerPositionSnapshotBoundaryDateTime(brokerPositionSnapshot) {
        const rawSnapshot = brokerPositionSnapshot?.positionSnapshotRaw;
        const exactBoundaries = Object.values(rawSnapshot || {})
            .map((snapshot) => String(snapshot?.as_of ?? snapshot?.asOf ?? '').trim().replace('T', ' '))
            .map((value) => value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/))
            .filter(Boolean)
            .map((match) => `${match[1]} ${match[2]}`)
            .sort();
        if (exactBoundaries.length) return exactBoundaries[exactBoundaries.length - 1];
        const fallbackDate = normalizeLedgerDate(brokerPositionSnapshot?.positionSnapshotAsOf);
        return fallbackDate ? `${fallbackDate} 23:59:59` : '';
    }

    function derivePartialBrokerPositionBoundaryFromHistory(
        brokerPositionSnapshot,
        scope,
        scopeState,
        transactions,
    ) {
        const validation = brokerPositionSnapshot?.holdingsValidation;
        if (
            !brokerPositionSnapshot
            || !scope
            || scope.broker !== 'ibkr'
            || !scopeState
            || scopeState.realizedPnlStatus !== 'complete'
            || validation?.matched !== true
            || validation?.history_complete !== false
            || validation?.comparison_scope !== 'user_confirmed_current_position_snapshot'
            || brokerPositionSnapshot.positionSnapshot?.[scope.ticker]
            || brokerPositionSnapshot.positionSnapshotRaw?.[scope.ticker]
            || !Array.isArray(transactions)
        ) {
            return null;
        }

        const boundaryDateTime = getBrokerPositionSnapshotBoundaryDateTime(
            brokerPositionSnapshot,
        );
        if (!boundaryDateTime) return null;
        const supportedTypes = new Set([
            'buy',
            'sell',
            'grant',
            'dividend_reinvestment',
            'transfer_in',
            'transfer_out',
        ]);
        let quantity = 0;
        transactions.forEach((txn) => {
            const txnScope = getTransactionLotScope(txn);
            if (
                txnScope.broker !== scope.broker
                || txnScope.accountToken !== scope.accountToken
                || txnScope.ticker !== scope.ticker
                || txnScope.currency !== scope.currency
                || !supportedTypes.has(getNormalizedTransactionType(txn))
            ) return;
            const txnDateTime = getInvestmentTransactionDateTime(txn);
            const txnQuantity = getInvestmentReplayTransactionQuantity(txn);
            if (!txnDateTime || txnDateTime > boundaryDateTime || txnQuantity === null) return;
            const normalizedType = getNormalizedTransactionType(txn);
            if (['buy', 'grant', 'dividend_reinvestment', 'transfer_in'].includes(normalizedType)) {
                quantity += txnQuantity;
            } else {
                quantity -= txnQuantity;
            }
        });
        if (!Number.isFinite(quantity) || quantity < -1e-7) return null;
        return {
            quantity: Math.abs(quantity) < 1e-7 ? 0 : quantity,
            totalCost: null,
            boundaryDateTime,
            boundarySource: 'partial_current_position_snapshot_history_replay',
        };
    }

    function consumeInvestmentFifoReplayLots(lots, quantity) {
        if (!Array.isArray(lots) || !Number.isFinite(quantity) || quantity <= 0) return null;
        let remaining = quantity;
        let removedQuantity = 0;
        let removedCost = 0;
        while (remaining > 1e-9 && lots.length) {
            const lot = lots[0];
            const lotQuantity = Number(lot?.quantity) || 0;
            const unitCost = Number(lot?.unitCost);
            if (lotQuantity <= 1e-9 || !Number.isFinite(unitCost) || unitCost < 0) {
                return null;
            }
            const matchedQuantity = Math.min(lotQuantity, remaining);
            removedQuantity += matchedQuantity;
            removedCost += matchedQuantity * unitCost;
            lot.quantity -= matchedQuantity;
            remaining -= matchedQuantity;
            if (lot.quantity <= 1e-9) lots.shift();
        }
        if (remaining > 1e-7) return null;
        return {removedQuantity, removedCost};
    }

    function getInvestmentReplayTransactionQuantity(txn) {
        const quantity = Math.abs(Number(getTransactionQuantity(txn)));
        return Number.isFinite(quantity) && quantity > 1e-9 ? quantity : null;
    }

    function getInvestmentReplayCarriedCostBasis(txn, prefix) {
        const directBasis = getTransactionDerivedCostBasis(txn, prefix);
        if (directBasis !== null) return directBasis;
        const allocationField = prefix === 'transfer_out'
            ? 'transfer_out_cost_basis_allocations'
            : 'carried_cost_basis_allocations';
        const allocations = Array.isArray(txn?.[allocationField])
            ? txn[allocationField]
            : [];
        if (!allocations.length) return null;
        const allocationCosts = allocations.map((allocation) => Number(allocation?.cost_basis_raw));
        if (allocationCosts.some((value) => !Number.isFinite(value) || value < 0)) return null;
        return allocationCosts.reduce((total, value) => total + value, 0);
    }

    function getInvestmentBrokerPerformanceReplayCoverage(scope, performanceAsOf, transactions) {
        const normalizedPerformanceAsOf = normalizeLedgerDate(performanceAsOf);
        const supportedTypes = new Set([
            'buy',
            'sell',
            'grant',
            'dividend_reinvestment',
            'transfer_in',
            'transfer_out',
        ]);
        const scopedTransactions = (Array.isArray(transactions) ? transactions : [])
            .filter((txn) => {
                const txnScope = getTransactionLotScope(txn);
                return (
                    txnScope.broker === scope?.broker
                    && txnScope.accountToken === scope?.accountToken
                    && txnScope.ticker === scope?.ticker
                    && txnScope.currency === scope?.currency
                    && supportedTypes.has(getNormalizedTransactionType(txn))
                );
            });
        const transactionDates = scopedTransactions
            .map((txn) => normalizeLedgerDate(txn?.date))
            .filter(Boolean);
        const laterTransactions = normalizedPerformanceAsOf
            ? scopedTransactions.filter((txn) => (
                getInvestmentTransactionDateTime(txn) > `${normalizedPerformanceAsOf} 23:59:59`
            ))
            : [];
        return {
            historyThrough: transactionDates.sort().pop() || '',
            postPerformanceTransactionCount: laterTransactions.length,
            postPerformanceSellCount: laterTransactions.filter((txn) => (
                getNormalizedTransactionType(txn) === 'sell'
            )).length,
        };
    }

    function buildAuthoritativeBrokerFifoReplay(
        positionBoundary,
        performanceBoundary,
        scope,
        transactions,
    ) {
        if (!positionBoundary || !scope || !Array.isArray(transactions)) return null;
        const supportedTypes = new Set([
            'buy',
            'sell',
            'grant',
            'dividend_reinvestment',
            'transfer_in',
            'transfer_out',
        ]);
        const scopedTransactions = transactions
            .filter((txn) => {
                const txnScope = getTransactionLotScope(txn);
                return (
                    txnScope.broker === scope.broker
                    && txnScope.accountToken === scope.accountToken
                    && txnScope.ticker === scope.ticker
                    && txnScope.currency === scope.currency
                    && supportedTypes.has(getNormalizedTransactionType(txn))
                );
            })
            .sort((left, right) => {
                const leftDateTime = getInvestmentTransactionDateTime(left);
                const rightDateTime = getInvestmentTransactionDateTime(right);
                if (leftDateTime !== rightDateTime) return leftDateTime.localeCompare(rightDateTime);
                return compareInvestmentTaxLotTransactions(left, right);
            });
        const lots = [];
        let shares = 0;
        let realizedPnl = 0;
        const realizedPnlByDate = {};
        let hasLaterTransaction = false;
        let postPerformanceTransactionCount = 0;
        let postPerformanceSellCount = 0;
        let historyThrough = '';
        let boundaryShares = null;
        let boundaryTotalCost = null;
        const sameDayBoundaryCandidates = [];

        const addLot = (quantity, unitCost) => {
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
                return false;
            }
            lots.push({quantity, unitCost});
            shares += quantity;
            return true;
        };
        const consumeLotInventory = (quantity) => {
            const consumption = consumeInvestmentFifoReplayLots(lots, quantity);
            if (!consumption) return null;
            shares -= consumption.removedQuantity;
            return consumption;
        };
        const applyTransaction = (txn, isAfterPerformanceBoundary) => {
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getInvestmentReplayTransactionQuantity(txn);
            if (!quantity) return false;
            if (isAfterPerformanceBoundary) hasLaterTransaction = true;

            if (normalizedType === 'grant') return addLot(quantity, 0);
            if (['buy', 'dividend_reinvestment'].includes(normalizedType)) {
                const unitCost = getTransactionEvidencedUnitPrice(txn, quantity);
                return addLot(quantity, unitCost);
            }
            if (normalizedType === 'transfer_in') {
                const carriedCostBasis = getInvestmentReplayCarriedCostBasis(txn, 'carried');
                return carriedCostBasis !== null
                    && addLot(quantity, carriedCostBasis / quantity);
            }

            const consumption = consumeLotInventory(quantity);
            if (!consumption) return false;
            if (normalizedType === 'transfer_out') {
                const declaredCostBasis = getInvestmentReplayCarriedCostBasis(txn, 'transfer_out');
                if (
                    declaredCostBasis === null
                    || Math.abs(declaredCostBasis - consumption.removedCost) > 1e-6
                ) {
                    return false;
                }
                return true;
            }

            if (!isAfterPerformanceBoundary) return true;
            const brokerRealizedPnl = getTransactionBrokerRealizedPnl(txn);
            const proceeds = getTransactionAmount(txn);
            const delta = brokerRealizedPnl === null
                ? proceeds - consumption.removedCost
                : brokerRealizedPnl;
            if (!Number.isFinite(delta)) return false;
            realizedPnl += delta;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (ledgerDate) {
                realizedPnlByDate[ledgerDate] = (
                    Number(realizedPnlByDate[ledgerDate]) || 0
                ) + delta;
            }
            return true;
        };

        for (const txn of scopedTransactions) {
            const txnDateTime = getInvestmentTransactionDateTime(txn);
            if (!txnDateTime) continue;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (ledgerDate && ledgerDate > historyThrough) historyThrough = ledgerDate;
            const isAfterPositionBoundary = txnDateTime > positionBoundary.boundaryDateTime;
            const isAfterPerformanceBoundary = txnDateTime > (
                performanceBoundary?.boundaryDateTime ?? positionBoundary.boundaryDateTime
            );
            if (isAfterPerformanceBoundary) {
                postPerformanceTransactionCount += 1;
                if (getNormalizedTransactionType(txn) === 'sell') postPerformanceSellCount += 1;
            }
            if (isAfterPositionBoundary && boundaryShares === null) {
                boundaryShares = shares;
                boundaryTotalCost = lots.reduce(
                    (total, lot) => total + (Number(lot.quantity) || 0) * (Number(lot.unitCost) || 0),
                    0,
                );
            }
            if (!applyTransaction(txn, isAfterPerformanceBoundary)) {
                return {status: 'incomplete', reason: 'fifo_inventory_replay_failed'};
            }
            if (
                isAfterPositionBoundary
                && txnDateTime.slice(0, 10) === positionBoundary.boundaryDateTime.slice(0, 10)
            ) {
                sameDayBoundaryCandidates.push({
                    shares,
                    totalCost: lots.reduce(
                        (total, lot) => total + (Number(lot.quantity) || 0) * (Number(lot.unitCost) || 0),
                        0,
                    ),
                });
            }
        }
        if (boundaryShares === null) {
            boundaryShares = shares;
            boundaryTotalCost = lots.reduce(
                (total, lot) => total + (Number(lot.quantity) || 0) * (Number(lot.unitCost) || 0),
                0,
            );
        }
        if (Math.abs(boundaryShares - positionBoundary.quantity) > 1e-7) {
            const matchingSameDayBoundary = sameDayBoundaryCandidates.find((candidate) => (
                Math.abs(candidate.shares - positionBoundary.quantity) <= 1e-7
            ));
            if (!matchingSameDayBoundary) {
                return {status: 'incomplete', reason: 'fifo_boundary_quantity_mismatch'};
            }
            boundaryShares = matchingSameDayBoundary.shares;
            boundaryTotalCost = matchingSameDayBoundary.totalCost;
        }
        const endingTotalCost = lots.reduce(
            (total, lot) => total + (Number(lot.quantity) || 0) * (Number(lot.unitCost) || 0),
            0,
        );
        return {
            status: 'complete',
            realizedPnl: hasLaterTransaction ? realizedPnl : 0,
            realizedPnlByDate,
            source: 'authoritative_position_snapshot_fifo_transaction_history_replay',
            costBasisMethod: 'FIFO reconstructed',
            positionBoundarySource: positionBoundary.boundarySource || '',
            positionBoundaryDateTime: positionBoundary.boundaryDateTime,
            performanceBoundaryDateTime: performanceBoundary?.boundaryDateTime || '',
            postPerformanceTransactionCount,
            postPerformanceSellCount,
            historyThrough,
            boundaryQuantity: boundaryShares,
            boundaryTotalCost,
            boundarySnapshotTotalCost: positionBoundary.totalCost,
            endingShares: shares,
            endingTotalCost,
            endingLots: lots,
        };
    }

    function addInvestmentRealizedPnlByDate(target, ledgerDate, value) {
        const normalizedDate = normalizeLedgerDate(ledgerDate);
        const numericValue = Number(value);
        if (!normalizedDate || !Number.isFinite(numericValue)) return;
        target[normalizedDate] = (Number(target[normalizedDate]) || 0) + numericValue;
    }

    function sumInvestmentRealizedPnlByDate(values) {
        return Object.values(values || {}).reduce(
            (total, value) => total + (Number(value) || 0),
            0,
        );
    }

    function buildInvestmentRealizedPnlReconciliation({
        scope,
        seed,
        performanceEntry,
        performanceAsOf,
        positionSnapshotAsOf,
        scopeState,
        supplemental,
        replayCoverage,
        nonPerformanceRealizedPnlLocal,
        status,
        source,
        sourceCurrency,
    }) {
        const hasPerformance = Boolean(
            performanceEntry && Number.isFinite(Number(performanceEntry.realizedTotal)),
        );
        const normalizedPerformanceAsOf = normalizeLedgerDate(
            performanceAsOf || seed?.asOf?.performanceSnapshot,
        );
        const normalizedPositionAsOf = normalizeLedgerDate(
            positionSnapshotAsOf || seed?.asOf?.positionSnapshot,
        );
        const historyThrough = normalizeLedgerDate(
            replayCoverage?.historyThrough || seed?.asOf?.transactionHistory,
        );
        const supplementalComplete = supplemental?.status === 'complete';
        const seedReplayRequired = seed?.replay?.required === true;
        const postPerformanceTransactionCount = Number(
            replayCoverage?.postPerformanceTransactionCount
            ?? supplemental?.postPerformanceTransactionCount
            ?? seed?.replay?.postPerformanceTransactionCount,
        );
        const postPerformanceSellCount = Number(
            replayCoverage?.postPerformanceSellCount
            ?? supplemental?.postPerformanceSellCount
            ?? seed?.replay?.postPerformanceSellCount,
        );
        const replayRequired = Boolean(
            hasPerformance
            && normalizedPerformanceAsOf
            && (
                (Number.isFinite(postPerformanceTransactionCount)
                    && postPerformanceTransactionCount > 0)
                || seedReplayRequired
            ),
        );
        const postPerformanceIncome = normalizedPerformanceAsOf
            ? Object.entries(scopeState?.nonPerformanceRealizedPnlByDate || {}).reduce(
                (total, [date, amount]) => date > normalizedPerformanceAsOf
                    ? total + (Number(amount) || 0)
                    : total,
                0,
            )
            : 0;
        const baselineRealizedPnlLocal = hasPerformance
            ? Number(performanceEntry.realizedTotal)
                + (performanceEntry.includesNonperformance
                    ? 0
                    : nonPerformanceRealizedPnlLocal - postPerformanceIncome)
            : 0;
        const incrementalRealizedPnlLocal = hasPerformance
            ? (supplementalComplete ? Number(supplemental.realizedPnl) || 0 : 0)
            : Number(scopeState?.realizedPnl) || 0;
        const proposedRealizedPnlLocal = hasPerformance
            ? baselineRealizedPnlLocal + incrementalRealizedPnlLocal
            : Number(scopeState?.realizedPnl) || 0;
        const dailyRealizedPnlLocal = {};
        if (status === 'complete') {
            if (hasPerformance) {
                if (normalizedPerformanceAsOf) {
                    addInvestmentRealizedPnlByDate(
                        dailyRealizedPnlLocal,
                        normalizedPerformanceAsOf,
                        baselineRealizedPnlLocal,
                    );
                }
                if (supplementalComplete) {
                    Object.entries(supplemental.realizedPnlByDate || {}).forEach(
                        ([ledgerDate, value]) => addInvestmentRealizedPnlByDate(
                            dailyRealizedPnlLocal,
                            ledgerDate,
                            value,
                        ),
                    );
                }
            } else {
                Object.entries(scopeState?.realizedPnlByDate || {}).forEach(
                    ([ledgerDate, value]) => addInvestmentRealizedPnlByDate(
                        dailyRealizedPnlLocal,
                        ledgerDate,
                        value,
                    ),
                );
            }
        }
        const arithmeticDifference = proposedRealizedPnlLocal - (
            baselineRealizedPnlLocal + incrementalRealizedPnlLocal
        );
        const timelineDifference = hasPerformance && !normalizedPerformanceAsOf
            ? 0
            : sumInvestmentRealizedPnlByDate(dailyRealizedPnlLocal) - proposedRealizedPnlLocal;
        const arithmeticValid = (
            Number.isFinite(proposedRealizedPnlLocal)
            && Math.abs(arithmeticDifference) <= 1e-7
        );
        const timelineValid = Math.abs(timelineDifference) <= 1e-6;
        const valid = status === 'complete' && arithmeticValid && timelineValid && !(
            replayRequired && !supplementalComplete
        );
        const coverageStatus = valid ? 'complete' : 'unavailable';
        const replayStatus = valid
            ? (hasPerformance ? (replayRequired ? 'complete' : 'not_required') : 'complete')
            : 'unavailable';
        const replayReason = valid
            ? (replayRequired
                ? 'supplemental_replay_complete'
                : (seed?.replay?.reason || 'no_transactions_after_performance_snapshot'))
            : (
                supplemental?.reason
                || seed?.replay?.reason
                || 'realized_pnl_reconciliation_invariant_failed'
            );
        return {
            schemaVersion: 'v1',
            broker: scope?.broker || '',
            account: scope?.accountId || scope?.accountToken || '',
            ticker: scope?.ticker || '',
            currency: sourceCurrency || scope?.currency || '',
            coverageStatus,
            asOf: {
                performanceSnapshot: normalizedPerformanceAsOf,
                positionSnapshot: normalizedPositionAsOf,
                transactionHistory: historyThrough,
            },
            replay: {
                status: replayStatus,
                required: replayRequired,
                reason: replayReason,
                source: supplemental?.source || seed?.source || source || '',
                positionBoundarySource: supplemental?.positionBoundarySource || '',
                postPerformanceTransactionCount: Number.isFinite(postPerformanceTransactionCount)
                    ? postPerformanceTransactionCount
                    : 0,
                postPerformanceSellCount: Number.isFinite(postPerformanceSellCount)
                    ? postPerformanceSellCount
                    : 0,
            },
            baselineRealizedPnlLocal: Number.isFinite(baselineRealizedPnlLocal)
                ? Number(baselineRealizedPnlLocal.toFixed(12))
                : null,
            incrementalRealizedPnlLocal: Number.isFinite(incrementalRealizedPnlLocal)
                ? Number(incrementalRealizedPnlLocal.toFixed(12))
                : null,
            realizedPnlLocal: valid
                ? Number(proposedRealizedPnlLocal.toFixed(12))
                : null,
            realizedPnlByDateLocal: valid
                ? Object.fromEntries(Object.entries(dailyRealizedPnlLocal).map(([date, value]) => [
                    date,
                    Number(Number(value).toFixed(12)),
                ]))
                : {},
            timelineCoverage: hasPerformance && !normalizedPerformanceAsOf
                ? 'latest_only'
                : 'complete',
            arithmeticCheck: {
                valid: arithmeticValid && timelineValid && !(
                    replayRequired && !supplementalComplete
                ),
                tolerance: 1e-7,
            },
            source,
        };
    }

    function buildSupplementalBrokerRealizedPnl(
        brokerPositionSnapshot,
        brokerPerformanceSnapshot,
        scope,
        scopeState,
        transactions,
    ) {
        const positionBoundary = getAuthoritativeBrokerPositionBoundary(
            brokerPositionSnapshot,
            scope?.ticker,
        ) || derivePartialBrokerPositionBoundaryFromHistory(
            brokerPositionSnapshot,
            scope,
            scopeState,
            transactions,
        );
        if (!positionBoundary) return null;
        const performanceAsOf = normalizeLedgerDate(
            brokerPerformanceSnapshot?.performanceSnapshotAsOf,
        );
        const performanceBoundary = performanceAsOf
            ? {boundaryDateTime: `${performanceAsOf} 23:59:59`}
            : null;
        const fifoReplay = buildAuthoritativeBrokerFifoReplay(
            positionBoundary,
            performanceBoundary,
            scope,
            transactions,
        );
        if (
            fifoReplay?.status !== 'complete'
            || !performanceAsOf
            || !scopeState
            || typeof scopeState !== 'object'
        ) {
            return fifoReplay;
        }
        const realizedPnlByDate = {};
        Object.entries(scopeState.realizedPnlByDate || {}).forEach(([rawDate, rawAmount]) => {
            const ledgerDate = normalizeLedgerDate(rawDate);
            const amount = Number(rawAmount);
            if (!ledgerDate || ledgerDate <= performanceAsOf || !Number.isFinite(amount)) return;
            realizedPnlByDate[ledgerDate] = (Number(realizedPnlByDate[ledgerDate]) || 0) + amount;
        });
        const realizedPnl = Object.values(realizedPnlByDate).reduce(
            (total, amount) => total + (Number(amount) || 0),
            0,
        );
        return {
            ...fifoReplay,
            realizedPnl,
            realizedPnlByDate,
            source: 'authoritative_position_snapshot_scoped_transaction_history_replay',
        };
    }

    function projectAuthoritativePositionSnapshot(rawSnapshot, transactions = [], snapshotAsOf = '') {
        const projectedSnapshot = {};
        Object.entries(rawSnapshot || {}).forEach(([ticker, snapshot]) => {
            if (!snapshot || typeof snapshot !== 'object') return;
            projectedSnapshot[ticker] = {...snapshot};
        });
        const boundaryDate = normalizeLedgerDate(snapshotAsOf);
        if (!boundaryDate) return projectedSnapshot;

        const laterTransactions = (Array.isArray(transactions) ? transactions : [])
            .filter((txn) => {
                const ledgerDate = normalizeLedgerDate(txn?.date);
                return ledgerDate && ledgerDate > boundaryDate;
            })
            .sort((left, right) => compareInvestmentTransactionsForReplay(left, right));
        laterTransactions.forEach((txn) => {
            if (txn?.exclude_from_holdings_replay === true) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const isSyntheticFractional = isUsmartHkFractionalSharesTransaction(txn);
            const rawTicker = isSyntheticFractional
                ? USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                : txn?.ticker;
            const ticker = getInvestmentCanonicalTicker(rawTicker);
            if (!ticker || isForexPairTicker(ticker)) return;
            const quantity = Math.abs(Number(getTransactionQuantity(txn)));
            if (!Number.isFinite(quantity) || quantity < 1e-9) return;
            const isIncrease = ['buy', 'dividend_reinvestment', 'grant', 'transfer_in'].includes(normalizedType);
            const isDecrease = ['sell', 'transfer_out'].includes(normalizedType);
            if (!isIncrease && !isDecrease) return;

            const existing = projectedSnapshot[ticker] || {
                quantity: 0,
                costBasisStatus: 'unknown',
                costPrice: null,
                marketValue: null,
                lastPrice: null,
            };
            const previousQuantity = Number(existing.quantity) || 0;
            const nextQuantity = previousQuantity + (isIncrease ? quantity : -quantity);
            let costBasisStatus = existing.costBasisStatus;
            let costPrice = Number(existing.costPrice);
            if (isIncrease) {
                let incomingCostPrice = null;
                if (normalizedType === 'grant') {
                    incomingCostPrice = 0;
                } else if (normalizedType === 'transfer_in') {
                    const carriedBasis = getTransactionDerivedCostBasis(txn, 'carried');
                    incomingCostPrice = carriedBasis === null ? null : carriedBasis / quantity;
                } else {
                    const effectiveUnitPrice = getTransactionEvidencedUnitPrice(txn, quantity);
                    incomingCostPrice = Number.isFinite(effectiveUnitPrice) && effectiveUnitPrice > 0
                        ? effectiveUnitPrice
                        : null;
                }
                if (
                    existing.costBasisStatus === 'known'
                    && Number.isFinite(costPrice)
                    && incomingCostPrice !== null
                    && previousQuantity >= -1e-9
                    && nextQuantity > 1e-9
                ) {
                    costPrice = (
                        Math.abs(previousQuantity) * costPrice
                        + quantity * incomingCostPrice
                    ) / Math.abs(nextQuantity);
                    costBasisStatus = 'known';
                } else if (Math.abs(previousQuantity) < 1e-9 && incomingCostPrice !== null) {
                    costPrice = incomingCostPrice;
                    costBasisStatus = 'known';
                } else {
                    costPrice = null;
                    costBasisStatus = 'unknown';
                }
            } else if (previousQuantity > 1e-9 && nextQuantity < -1e-9) {
                costPrice = null;
                costBasisStatus = 'unknown';
            }
            if (Math.abs(nextQuantity) < 1e-9) {
                costPrice = null;
                costBasisStatus = 'known';
            }
            projectedSnapshot[ticker] = {
                ...existing,
                quantity: Math.abs(nextQuantity) < 1e-9 ? 0 : nextQuantity,
                costBasisStatus,
                costPrice: Number.isFinite(costPrice) ? costPrice : null,
                marketValue: null,
                lastPrice: null,
            };
        });
        return projectedSnapshot;
    }

    function getAuthoritativePositionSnapshotForTransactions(transactions = []) {
        const globalSnapshot = getAuthoritativePositionSnapshot();
        const scopedTransactions = Array.isArray(transactions) ? transactions : [];
        if (globalSnapshot !== null) {
            return projectAuthoritativePositionSnapshot(
                globalSnapshot,
                scopedTransactions,
                getInvestmentPositionSnapshotAsOf(),
            );
        }
        const brokerCodes = new Set(
            scopedTransactions
                .map((txn) => String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase())
                .filter(Boolean),
        );
        if (brokerCodes.size !== 1) return null;
        const broker = [...brokerCodes][0];
        const accountIds = new Set(
            scopedTransactions
                .map((txn) => String(txn?.account || txn?.source?.account || '').trim())
                .filter(Boolean),
        );
        const candidates = getAuthoritativeBrokerPositionSnapshots().filter((entry) => (
            entry.broker === broker
            && (!accountIds.size || !entry.accountId || accountIds.has(entry.accountId))
        ));
        if (candidates.length !== 1) return null;
        return projectAuthoritativePositionSnapshot(
            candidates[0].positionSnapshot,
            scopedTransactions,
            candidates[0].positionSnapshotAsOf,
        );
    }

    function normalizeAuthoritativePerformanceSnapshot(rawSnapshot) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = getInvestmentCanonicalTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const realizedTotal = Number(snapshot.realized_total);
            if (!Number.isFinite(realizedTotal)) return;
            normalizedSnapshot[normalizedTicker] = {
                realizedTotal,
                currency: String(snapshot.currency || getTickerQuoteCurrency(normalizedTicker)).trim().toUpperCase(),
                includesNonperformance: snapshot.realized_total_includes_nonperformance === true,
            };
        });
        return normalizedSnapshot;
    }

    function getAuthoritativePerformanceSnapshot() {
        if (window.WORTHWARD_INVESTMENT_DATA?.summary?.performance_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePerformanceSnapshot(
            window.WORTHWARD_INVESTMENT_DATA?.performance_snapshot,
        );
    }

    function getAuthoritativeBrokerPerformanceSnapshots() {
        const brokerSummaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const brokerSnapshots = window.WORTHWARD_INVESTMENT_DATA?.broker_snapshots;
        const snapshotsByAccount = new Map();
        if (brokerSnapshots && typeof brokerSnapshots === 'object') {
            Object.values(brokerSnapshots).forEach((snapshot) => {
                if (!snapshot || typeof snapshot !== 'object') return;
                if (snapshot.performance_snapshot_authoritative !== true) return;
                const normalizedBroker = String(snapshot.broker || '').trim().toLowerCase();
                if (!normalizedBroker) return;
                const accountId = String(snapshot.account_id ?? snapshot.account ?? '').trim();
                const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, accountId);
                snapshotsByAccount.set([normalizedBroker, accountToken].join('|'), {
                    broker: normalizedBroker,
                    accountId,
                    accountToken,
                    performanceSnapshotAsOf: normalizeLedgerDate(snapshot.performance_snapshot_as_of),
                    performanceSnapshot: normalizeAuthoritativePerformanceSnapshot(
                        snapshot.performance_snapshot,
                    ),
                    realizedPnlReconciliation: getBrokerRealizedPnlReconciliationMap(
                        normalizedBroker,
                        accountId,
                        snapshot.realized_pnl_reconciliation,
                    ),
                });
            });
        }
        if (!brokerSummaries || typeof brokerSummaries !== 'object') {
            return [...snapshotsByAccount.values()];
        }
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            if (summary.performance_snapshot_authoritative !== true) return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            const accountId = String(summary.account_id ?? summary.account ?? '').trim();
            const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, accountId);
            const key = [normalizedBroker, accountToken].join('|');
            if (snapshotsByAccount.has(key)) return;
            snapshotsByAccount.set(key, {
                broker: normalizedBroker,
                accountId,
                accountToken,
                performanceSnapshotAsOf: normalizeLedgerDate(summary.performance_snapshot_as_of),
                performanceSnapshot: normalizeAuthoritativePerformanceSnapshot(
                    summary.performance_snapshot,
                ),
                realizedPnlReconciliation: getBrokerRealizedPnlReconciliationMap(
                    normalizedBroker,
                    accountId,
                    summary.realized_pnl_reconciliation,
                ),
            });
        });
        return [...snapshotsByAccount.values()];
    }

    function getVerifiedTaxLotHistoryScopes() {
        const brokerSummaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const scopes = new Map();
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return scopes;
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            const accountId = String(summary.account_id ?? summary.account ?? '').trim();
            if (!normalizedBroker || !accountId) return;
            const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, accountId);
            const rawVerifications = summary.tax_lot_history_verifications;
            if (!rawVerifications || typeof rawVerifications !== 'object') return;
            Object.entries(rawVerifications).forEach(([ticker, rawVerification]) => {
                if (!rawVerification || typeof rawVerification !== 'object') return;
                const normalizedTicker = getInvestmentCanonicalTicker(ticker);
                const currency = String(rawVerification.currency || '').trim().toUpperCase();
                const verifiedThrough = normalizeLedgerDate(rawVerification.verified_through);
                const buyCount = Number(rawVerification.buy_count);
                const sellCount = Number(rawVerification.sell_count);
                const buyQuantity = Number(rawVerification.buy_quantity);
                const sellQuantity = Number(rawVerification.sell_quantity);
                const rawExpectedShares = rawVerification.expected_shares;
                const hasExpectedShares = (
                    rawExpectedShares !== undefined
                    && rawExpectedShares !== null
                    && String(rawExpectedShares).trim() !== ''
                );
                const expectedShares = hasExpectedShares
                    ? Number(rawExpectedShares)
                    : null;
                if (
                    !normalizedTicker
                    || !currency
                    || !verifiedThrough
                    || !Number.isInteger(buyCount)
                    || buyCount < 0
                    || !Number.isInteger(sellCount)
                    || sellCount < 0
                    || !Number.isFinite(buyQuantity)
                    || buyQuantity < 0
                    || !Number.isFinite(sellQuantity)
                    || sellQuantity < 0
                    || (hasExpectedShares && !Number.isFinite(expectedShares))
                ) return;
                scopes.set([
                    normalizedBroker,
                    accountToken,
                    normalizedTicker,
                    currency,
                ].join('|'), {
                    verifiedThrough,
                    buyCount,
                    sellCount,
                    buyQuantity,
                    sellQuantity,
                    ...(hasExpectedShares ? {expectedShares} : {}),
                    calculationMethod: String(rawVerification.calculation_method || '').trim(),
                    verificationSource: String(rawVerification.verification_source || '').trim(),
                });
            });
        });
        return scopes;
    }

    function getDynamicallyVerifiedTaxLotHistoryScopes(lotScopeMap) {
        const brokerSummaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const scopes = new Map();
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return scopes;

        const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
        const getCoverageEndDate = (scopeSummary, snapshot) => {
            const coverage = scopeSummary?.order_history_scope
                || snapshot?.order_status_coverage;
            if (coverage?.mode !== 'explicit_date_ranges' || !Array.isArray(coverage.windows)) {
                return '';
            }
            return coverage.windows
                .map((window) => normalizeLedgerDate(window?.end_date))
                .filter(Boolean)
                .sort()
                .pop() || '';
        };

        lotScopeMap.forEach((scopeState) => {
            const scope = scopeState?.lotScope;
            if (!scope || scope.broker !== 'hsbc') return;

            const matchingSummary = Object.entries(brokerSummaries).find(([broker, summary]) => {
                if (!summary || typeof summary !== 'object') return false;
                const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
                const accountId = String(summary.account_id ?? summary.account ?? '').trim();
                return (
                    normalizedBroker === scope.broker
                    && normalizeInvestmentLotScopeAccount(normalizedBroker, accountId) === scope.accountToken
                );
            });
            const summary = matchingSummary?.[1];
            const snapshot = summary?.hsbc_snapshot;
            if (
                !summary
                || summary.position_snapshot_authoritative !== true
                || snapshot?.status !== 'validated'
                || scopeState.realizedPnlStatus !== 'complete'
                || scopeState.sellCount <= scopeState.brokerRealizedSellCount
                || scopeState.hasPartialTaxLotHistory !== true
            ) return;

            const positionSnapshotEntry = Object.entries(summary.position_snapshot || {})
                .find(([ticker]) => getInvestmentCanonicalTicker(ticker) === scope.ticker)?.[1];
            const snapshotHasTicker = Boolean(positionSnapshotEntry);
            const expectedShares = snapshotHasTicker
                ? Number(positionSnapshotEntry?.quantity)
                : 0;
            const verifiedThrough = normalizeLedgerDate(summary.position_snapshot_as_of)
                || normalizeLedgerDate(snapshot.portfolio_market_data_updated_at?.date);
            const coverageEndDate = getCoverageEndDate(summary, snapshot);
            if (
                (!snapshotHasTicker && !isFlatPosition(scopeState.shares))
                || !Number.isFinite(expectedShares)
                || !verifiedThrough
                || !coverageEndDate
                || coverageEndDate < verifiedThrough
                || !scopeState.lastTradeDate
                || scopeState.lastTradeDate > verifiedThrough
                || !closeEnough(scopeState.shares, expectedShares)
            ) return;

            scopes.set([
                scope.broker,
                scope.accountToken,
                scope.ticker,
                scope.currency,
            ].join('|'), {
                verifiedThrough,
                expectedShares,
                buyCount: scopeState.buyCount,
                sellCount: scopeState.sellCount,
                buyQuantity: scopeState.buyQuantity,
                sellQuantity: scopeState.sellQuantity,
                calculationMethod: 'trade_price_and_commission',
                verificationSource: 'authoritative_position_snapshot_and_complete_replay',
            });
        });
        return scopes;
    }

    function shouldPreferDynamicTaxLotHistoryVerification(existing, dynamic) {
        if (!existing) return true;
        const dynamicThrough = normalizeLedgerDate(dynamic?.verifiedThrough);
        const existingThrough = normalizeLedgerDate(existing?.verifiedThrough);
        if (!dynamicThrough) return false;
        if (!existingThrough || dynamicThrough > existingThrough) return true;
        if (dynamicThrough < existingThrough) return false;

        const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
        const sameExpectedShares = (
            existing.expectedShares !== undefined
            && existing.expectedShares !== null
        )
            ? closeEnough(existing.expectedShares, dynamic.expectedShares)
            : dynamic.expectedShares === undefined || dynamic.expectedShares === null;
        return !(
            sameExpectedShares
            && existing.buyCount === dynamic.buyCount
            && existing.sellCount === dynamic.sellCount
            && closeEnough(existing.buyQuantity, dynamic.buyQuantity)
            && closeEnough(existing.sellQuantity, dynamic.sellQuantity)
        );
    }

    function matchesVerifiedTaxLotHistory(scopeState, verification) {
        if (!verification) return false;
        const hasExpectedShares = (
            verification.expectedShares !== undefined
            && verification.expectedShares !== null
            && Number.isFinite(Number(verification.expectedShares))
        );
        if (!hasExpectedShares && !isFlatPosition(scopeState?.shares)) return false;
        const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
        return (
            scopeState.realizedPnlStatus === 'complete'
            && scopeState.lastTradeDate
            && scopeState.lastTradeDate <= verification.verifiedThrough
            && scopeState.buyCount === verification.buyCount
            && scopeState.sellCount === verification.sellCount
            && closeEnough(scopeState.buyQuantity, verification.buyQuantity)
            && closeEnough(scopeState.sellQuantity, verification.sellQuantity)
            && (!hasExpectedShares || closeEnough(scopeState.shares, verification.expectedShares))
        );
    }

    function getTransactionEvidencedUnitPrice(txn, quantityOverride = null) {
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
        return Number.isFinite(price) ? price : null;
    }

    function getTransactionEffectiveUnitPrice(txn, quantityOverride = null) {
        return getTransactionEvidencedUnitPrice(txn, quantityOverride) ?? 0;
    }

    function getTransactionDerivedCostBasis(txn, prefix = 'carried') {
        const basisPrefix = prefix === 'transfer_out'
            ? 'transfer_out_cost_basis'
            : 'carried_cost_basis';
        const status = String(txn?.[`${basisPrefix}_status`] || '').trim().toLowerCase();
        if (status !== 'known') return null;
        const rawBasis = txn?.[`${basisPrefix}_raw`];
        if (rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '') return null;
        const numericBasis = Number(rawBasis);
        return Number.isFinite(numericBasis) && numericBasis >= 0 ? numericBasis : null;
    }

    function getTransactionDerivedCostBasisMethod(txn, prefix = 'carried') {
        const basisPrefix = prefix === 'transfer_out'
            ? 'transfer_out_cost_basis'
            : 'carried_cost_basis';
        return String(
            txn?.[`${basisPrefix}_method_label`]
            || txn?.[`${basisPrefix}_method`]
            || '',
        ).trim();
    }

    function markReconstructedCostBasis(state, txn, prefix, status) {
        const method = getTransactionDerivedCostBasisMethod(txn, prefix);
        if (method) state.costBasisMethod = method === 'fifo_reconstructed' ? 'FIFO reconstructed' : method;
        const normalizedStatus = String(status || '').trim().toLowerCase();
        if (normalizedStatus === 'known') return;
        if (normalizedStatus === 'partial' || normalizedStatus === 'unknown') {
            state.costBasisStatus = normalizedStatus;
        }
    }

    function applyInvestmentTransactionToState(
        summary,
        txn,
        normalizedType,
        quantity,
        amount,
        ledgerDate,
        {
            preferBrokerRealizedPnl = false,
            preferTradePriceAndCommission = false,
            unitPriceOverride = null,
        } = {},
    ) {
        summary.hasPartialTaxLotHistory = (
            summary.hasPartialTaxLotHistory || hasPartialTaxLotHistorySource(txn)
        );
        const resolveTradeUnitPrice = () => {
            if (unitPriceOverride !== null && Number.isFinite(Number(unitPriceOverride))) {
                return Number(unitPriceOverride);
            }
            return preferTradePriceAndCommission
                ? getTransactionTradePriceAndCommissionUnitPrice(txn, quantity)
                : getTransactionEffectiveUnitPrice(txn, quantity);
        };
        if (
            normalizedType === 'buy'
            && quantity !== null
            && !Number.isNaN(quantity)
        ) {
            summary.buyCount += 1;
            summary.buyQuantity += quantity;
            summary.lastTradeDate = ledgerDate || summary.lastTradeDate;
            applyDirectionalTrade(summary, 'long', quantity, resolveTradeUnitPrice());
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'grant' && quantity !== null && !Number.isNaN(quantity)) {
            openPositionLots(summary, 'long', quantity, 0);
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'dividend_reinvestment' && quantity !== null && !Number.isNaN(quantity)) {
            // The dividend cash flow is separate, but the reinvested shares still
            // acquire basis at the actual reinvestment price. Treating DRIP lots
            // as zero-cost would double count the distribution in later P&L.
            const evidencedUnitPrice = getTransactionEvidencedUnitPrice(txn, quantity);
            const resolvedUnitPrice = resolveTradeUnitPrice();
            if (
                evidencedUnitPrice === null
                || evidencedUnitPrice <= 0
                || !Number.isFinite(resolvedUnitPrice)
                || resolvedUnitPrice <= 0
            ) {
                const hadKnownOpenBasis = (
                    !isFlatPosition(summary.shares)
                    && summary.costBasisStatus === 'known'
                );
                openPositionLots(summary, 'long', quantity, 0);
                summary.costBasisStatus = (
                    hadKnownOpenBasis
                    || summary.costBasisStatus === 'partial'
                )
                    ? 'partial'
                    : 'unknown';
            } else {
                openPositionLots(summary, 'long', quantity, resolvedUnitPrice);
            }
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'sell' && quantity !== null && !Number.isNaN(quantity)) {
            const sharesBeforeSell = Number(summary.shares) || 0;
            const costBasisStatusBeforeSell = summary.costBasisStatus;
            const realizedBeforeSell = Number(summary.realizedPnl) || 0;
            applyDirectionalTrade(summary, 'short', quantity, resolveTradeUnitPrice());
            summary.sellCount += 1;
            summary.sellQuantity += quantity;
            summary.lastTradeDate = ledgerDate || summary.lastTradeDate;
            const brokerRealizedPnl = preferBrokerRealizedPnl
                ? getTransactionBrokerRealizedPnl(txn)
                : null;
            if (brokerRealizedPnl !== null) {
                summary.realizedPnl = realizedBeforeSell + brokerRealizedPnl;
                summary.brokerRealizedSellCount += 1;
            } else if (
                sharesBeforeSell < quantity - 1e-9
                || costBasisStatusBeforeSell !== 'known'
            ) {
                summary.realizedPnlStatus = 'incomplete';
            }
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return (Number(summary.realizedPnl) || 0) - realizedBeforeSell;
        }
        if (normalizedType === 'transfer_in' && quantity !== null && !Number.isNaN(quantity)) {
            const carriedCostBasis = getTransactionDerivedCostBasis(txn, 'carried');
            if (carriedCostBasis !== null) {
                openPositionLots(summary, 'long', quantity, carriedCostBasis / quantity);
                markReconstructedCostBasis(
                    summary,
                    txn,
                    'carried',
                    txn?.carried_cost_basis_status,
                );
            } else {
                // Preserve existing lot identities. Unknown carried basis is represented by
                // a zero-cost lot and remains marked unknown below; it must not erase lots
                // that were opened before the transfer receipt.
                openPositionLots(summary, 'long', quantity, 0);
                markReconstructedCostBasis(
                    summary,
                    txn,
                    'carried',
                    txn?.carried_cost_basis_status || 'unknown',
                );
            }
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (normalizedType === 'transfer_out' && quantity !== null && !Number.isNaN(quantity)) {
            const transferredCostBasis = getTransactionDerivedCostBasis(txn, 'transfer_out');
            const sharesBeforeTransfer = Number(summary.shares) || 0;
            if (sharesBeforeTransfer > 1e-9) {
                removePositionLots(summary, quantity, {
                    basisOverride: transferredCostBasis,
                });
            } else {
                summary.shares -= quantity;
            }
            markReconstructedCostBasis(
                summary,
                txn,
                'transfer_out',
                transferredCostBasis !== null
                    ? txn?.transfer_out_cost_basis_status
                    : txn?.transfer_out_cost_basis_status || 'unknown',
            );
            if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
            return 0;
        }
        if (
            ['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)
            && txn?.source?.excluded_from_broker_pnl !== true
        ) {
            summary.realizedPnl += amount;
            summary.nonPerformanceRealizedPnl += amount;
            if (ledgerDate) {
                summary.nonPerformanceRealizedPnlByDate ||= {};
                summary.nonPerformanceRealizedPnlByDate[ledgerDate] = (
                    Number(summary.nonPerformanceRealizedPnlByDate[ledgerDate]) || 0
                ) + amount;
            }
            return amount;
        }
        return 0;
    }

    function getTransactionTradePriceAndCommissionUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (
            quantity === null
            || !Number.isFinite(quantity)
            || quantity <= 0
            || !Number.isFinite(price)
            || price < 0
        ) {
            return getTransactionEffectiveUnitPrice(txn, quantityOverride);
        }
        const commissionPerShare = Math.abs(getTransactionCommission(txn)) / quantity;
        return getNormalizedTransactionType(txn) === 'sell'
            ? Math.max(0, price - commissionPerShare)
            : price + commissionPerShare;
    }

    return {
        getAuthoritativeSnapshotFiniteNumber,
        normalizeAuthoritativeCostBasis,
        combineAuthoritativeCostBasisStatus,
        normalizeAuthoritativePositionSnapshot,
        normalizeBrokerRealizedPnlReconciliation,
        getBrokerRealizedPnlReconciliationMap,
        getBrokerRealizedPnlReconciliationSeed,
        getAuthoritativePositionSnapshot,
        getAuthoritativeBrokerPositionSnapshots,
        normalizeLedgerDateTime,
        getInvestmentTransactionDateTime,
        getAuthoritativeBrokerPositionBoundary,
        getBrokerPositionSnapshotBoundaryDateTime,
        derivePartialBrokerPositionBoundaryFromHistory,
        consumeInvestmentFifoReplayLots,
        getInvestmentReplayTransactionQuantity,
        getInvestmentReplayCarriedCostBasis,
        getInvestmentBrokerPerformanceReplayCoverage,
        buildAuthoritativeBrokerFifoReplay,
        addInvestmentRealizedPnlByDate,
        sumInvestmentRealizedPnlByDate,
        buildInvestmentRealizedPnlReconciliation,
        buildSupplementalBrokerRealizedPnl,
        projectAuthoritativePositionSnapshot,
        getAuthoritativePositionSnapshotForTransactions,
        normalizeAuthoritativePerformanceSnapshot,
        getAuthoritativePerformanceSnapshot,
        getAuthoritativeBrokerPerformanceSnapshots,
        getVerifiedTaxLotHistoryScopes,
        getDynamicallyVerifiedTaxLotHistoryScopes,
        shouldPreferDynamicTaxLotHistoryVerification,
        matchesVerifiedTaxLotHistory,
        getTransactionEvidencedUnitPrice,
        getTransactionEffectiveUnitPrice,
        getTransactionDerivedCostBasis,
        getTransactionDerivedCostBasisMethod,
        markReconstructedCostBasis,
        applyInvestmentTransactionToState,
        getTransactionTradePriceAndCommissionUnitPrice,
    };
}
