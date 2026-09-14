/**
 * Daily equity and ticker-summary composition utilities.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment data-utilities composition root.
 */

export function createInvestmentSummaryUtils(runtime) {
    const aggregateInvestmentScopedPositionStates = (...args) => runtime.aggregateInvestmentScopedPositionStates(...args);
    const applyInvestmentTransactionToState = (...args) => runtime.applyInvestmentTransactionToState(...args);
    const buildInvestmentFxRateTimeline = (...args) => runtime.buildInvestmentFxRateTimeline(...args);
    const buildInvestmentRealizedPnlReconciliation = (...args) => runtime.buildInvestmentRealizedPnlReconciliation(...args);
    const buildRenderedSplitFactorHints = (...args) => runtime.buildRenderedSplitFactorHints(...args);
    const buildSupplementalBrokerRealizedPnl = (...args) => runtime.buildSupplementalBrokerRealizedPnl(...args);
    const buildTickerPriceIndex = (...args) => runtime.buildTickerPriceIndex(...args);
    const calculateSnapshotMarketValue = (...args) => runtime.calculateSnapshotMarketValue(...args);
    const combineAuthoritativeCostBasisStatus = (...args) => runtime.combineAuthoritativeCostBasisStatus(...args);
    const compareInvestmentReplaySnapshots = (...args) => runtime.compareInvestmentReplaySnapshots(...args);
    const compareInvestmentTaxLotTransactions = (...args) => runtime.compareInvestmentTaxLotTransactions(...args);
    const compareInvestmentTransactionsForReplay = (...args) => runtime.compareInvestmentTransactionsForReplay(...args);
    const convertAmountToBaseCurrency = (...args) => runtime.convertAmountToBaseCurrency(...args);
    const convertAmountToBaseCurrencyAtLatestRate = (...args) => runtime.convertAmountToBaseCurrencyAtLatestRate(...args);
    const createPositionState = (...args) => runtime.createPositionState(...args);
    const enumerateCalendarDateKeys = (...args) => runtime.enumerateCalendarDateKeys(...args);
    const formatTransactionCurrency = (...args) => runtime.formatTransactionCurrency(...args);
    const getAuthoritativeBrokerPerformanceSnapshots = (...args) => runtime.getAuthoritativeBrokerPerformanceSnapshots(...args);
    const getAuthoritativeBrokerPositionSnapshots = (...args) => runtime.getAuthoritativeBrokerPositionSnapshots(...args);
    const getAuthoritativePerformanceSnapshot = (...args) => runtime.getAuthoritativePerformanceSnapshot(...args);
    const getAuthoritativePositionSnapshotForTransactions = (...args) => runtime.getAuthoritativePositionSnapshotForTransactions(...args);
    const getAuthoritativeSnapshotFiniteNumber = (...args) => runtime.getAuthoritativeSnapshotFiniteNumber(...args);
    const getBrokerRealizedPnlReconciliationSeed = (...args) => runtime.getBrokerRealizedPnlReconciliationSeed(...args);
    const getDynamicallyVerifiedTaxLotHistoryScopes = (...args) => runtime.getDynamicallyVerifiedTaxLotHistoryScopes(...args);
    const getInvestmentBaseCurrency = (...args) => runtime.getInvestmentBaseCurrency(...args);
    const getInvestmentBrokerPerformanceReplayCoverage = (...args) => runtime.getInvestmentBrokerPerformanceReplayCoverage(...args);
    const getInvestmentCanonicalTicker = (...args) => runtime.getInvestmentCanonicalTicker(...args);
    const getInvestmentCostBasisMethod = (...args) => runtime.getInvestmentCostBasisMethod(...args);
    const getInvestmentInternalTransferAggregateBridgeDelta = (...args) => runtime.getInvestmentInternalTransferAggregateBridgeDelta(...args);
    const getInvestmentStartingCash = (...args) => runtime.getInvestmentStartingCash(...args);
    const getLongbridgeHkCashEquivalentSyntheticTicker = (...args) => runtime.getLongbridgeHkCashEquivalentSyntheticTicker(...args);
    const getNormalizedTransactionType = (...args) => runtime.getNormalizedTransactionType(...args);
    const getTickerQuoteCurrency = (...args) => runtime.getTickerQuoteCurrency(...args);
    const getTransactionAmount = (...args) => runtime.getTransactionAmount(...args);
    const getTransactionLotScope = (...args) => runtime.getTransactionLotScope(...args);
    const getTransactionLotScopeKey = (...args) => runtime.getTransactionLotScopeKey(...args);
    const getTransactionValuationQuantity = (...args) => runtime.getTransactionValuationQuantity(...args);
    const getVerifiedTaxLotHistoryScopes = (...args) => runtime.getVerifiedTaxLotHistoryScopes(...args);
    const isCashDepositType = (...args) => runtime.isCashDepositType(...args);
    const isCashWithdrawalType = (...args) => runtime.isCashWithdrawalType(...args);
    const isFlatPosition = (...args) => runtime.isFlatPosition(...args);
    const isSyntheticCashEquivalentTicker = (...args) => runtime.isSyntheticCashEquivalentTicker(...args);
    const matchesVerifiedTaxLotHistory = (...args) => runtime.matchesVerifiedTaxLotHistory(...args);
    const normalizeCurrencyCode = (...args) => runtime.normalizeCurrencyCode(...args);
    const normalizeLedgerDate = (...args) => runtime.normalizeLedgerDate(...args);
    const shiftLedgerDate = (...args) => runtime.shiftLedgerDate(...args);
    const shouldPreferDynamicTaxLotHistoryVerification = (...args) => runtime.shouldPreferDynamicTaxLotHistoryVerification(...args);
    const shouldTrackHoldingTicker = (...args) => runtime.shouldTrackHoldingTicker(...args);
    const sumInvestmentRealizedPnlByDate = (...args) => runtime.sumInvestmentRealizedPnlByDate(...args);

    function buildDailyEquityChartPoints(
        processedTransactions,
        tickerClosePrices,
        moneyMarketTickers,
        {includeCalendarDays = false, replaySnapshots = []} = {},
    ) {
        if (!Array.isArray(processedTransactions) || !processedTransactions.length) {
            return [];
        }

        // Chart replay is keyed by the ledger booking date.  Do not trust the
        // execution timestamp to establish day order: broker imports may carry
        // a later booking date with an earlier history timestamp.
        const canonicalTransactions = [...processedTransactions].sort(
            (left, right) => compareInvestmentTransactionsForReplay(left, right),
        );
        const chartTransactions = (
            Array.isArray(replaySnapshots) && replaySnapshots.length
                ? replaySnapshots
                : canonicalTransactions
        ).slice().sort(
            (left, right) => compareInvestmentReplaySnapshots(left, right),
        );
        const firstLedgerDate = normalizeLedgerDate(chartTransactions[0]?.date);
        if (!firstLedgerDate) return [];

        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(canonicalTransactions, baseCurrency);
        const tradingDateSet = new Set();
        Object.values(tickerPriceIndex).forEach((entry) => {
            (entry?.dates || []).forEach((date) => {
                if (date >= firstLedgerDate) {
                    tradingDateSet.add(date);
                }
            });
        });

        const ledgerDateMap = new Map();
        canonicalTransactions.forEach((txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            if (!ledgerDateMap.has(ledgerDate)) {
                ledgerDateMap.set(ledgerDate, {
                    snapshot: txn,
                    ledgerNos: [],
                    cashInAmountBase: 0,
                    cashOutAmountBase: 0,
                    netTransferAmount: 0,
                    netTransferAmountsInBase: 0,
                });
            }
            const entry = ledgerDateMap.get(ledgerDate);
            entry.snapshot = txn;
            entry.ledgerNos.push(Number(txn.ledger_no || 0));
            const normalizedType = getNormalizedTransactionType(txn);
            const transactionAmount = Math.abs(Number(getTransactionAmount(txn)));
            const transactionCurrency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || baseCurrency;
            const transactionAmountBase = convertAmountToBaseCurrency(
                transactionAmount,
                transactionCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            if (!Number.isFinite(transactionAmount) || transactionAmount <= 1e-9) return;
            if (
                txn?.manual_internal_transfer_external_flow_excluded === true
                || getInvestmentInternalTransferAggregateBridgeDelta(txn) !== 0
            ) return;
            if (isCashDepositType(normalizedType)) {
                entry.cashInAmountBase += transactionAmountBase;
                entry.netTransferAmount += transactionAmount;
                entry.netTransferAmountsInBase += transactionAmountBase;
            } else if (isCashWithdrawalType(normalizedType)) {
                entry.cashOutAmountBase += transactionAmountBase;
                entry.netTransferAmount -= transactionAmount;
                entry.netTransferAmountsInBase -= transactionAmountBase;
            }
        });

        const replayLedgerDates = chartTransactions
            .map((snapshot) => normalizeLedgerDate(snapshot?.date))
            .filter(Boolean);
        const observedCandidateDates = Array.from(new Set([
            ...Array.from(tradingDateSet),
            ...Array.from(ledgerDateMap.keys()),
            ...replayLedgerDates,
        ])).sort();
        const observedCandidateDateSet = new Set(observedCandidateDates);

        const points = [];
        let processedCursor = 0;
        let activeSnapshot = null;
        let cumulativeNetTransferAmount = 0;
        let previousTradingPointIndex = -1;
        const anchorDate = shiftLedgerDate(firstLedgerDate, -1);
        const candidateDates = includeCalendarDays && observedCandidateDates.length
            ? Array.from(new Set([
                ...observedCandidateDates,
                ...enumerateCalendarDateKeys(firstLedgerDate, observedCandidateDates[observedCandidateDates.length - 1]),
            ])).sort()
            : observedCandidateDates;
        const startingCash = getInvestmentStartingCash();

        if (anchorDate) {
            points.push({
                date: anchorDate,
                running_cash: startingCash,
                aggregate_running_cash: startingCash,
                market_value: 0,
                aggregate_market_value: 0,
                holdings_market_values: {},
                aggregate_holdings_market_values: {},
                holdings_quote_prices: {},
                aggregate_holdings_quote_prices: {},
                total_equity: startingCash,
                aggregate_total_equity: startingCash,
                aggregate_current_display_cash: startingCash,
                aggregate_current_total_equity: startingCash,
                anchor_ledger_date: '',
                anchor_ledger_nos: [],
                cash_in_amount: 0,
                cash_out_amount: 0,
                net_transfer_amount: 0,
                cumulative_net_transfer_amount: 0,
                is_trading_day: false,
                previous_trading_point_index: -1,
            });
        }

        candidateDates.forEach((date) => {
            while (processedCursor < chartTransactions.length) {
                const nextSnapshot = chartTransactions[processedCursor];
                const nextLedgerDate = normalizeLedgerDate(nextSnapshot?.date);
                if (!nextLedgerDate || nextLedgerDate > date) break;
                activeSnapshot = nextSnapshot;
                processedCursor += 1;
            }

            if (!activeSnapshot) return;

            const aggregateSnapshot = {
                ...activeSnapshot,
                holdings: activeSnapshot?.aggregate_holdings || activeSnapshot?.holdings || {},
                money_market_anchors: activeSnapshot?.aggregate_money_market_anchors || activeSnapshot?.money_market_anchors || {},
            };
            const valuation = calculateSnapshotMarketValue(
                aggregateSnapshot,
                date,
                tickerPriceIndex,
                moneyMarketTickers,
                fxTimeline,
                baseCurrency,
            );
            const rawRunningCash = Number(
                activeSnapshot?.aggregate_running_cash
                ?? activeSnapshot?.running_cash,
            );
            const aggregatePendingSettlementCash = Number(activeSnapshot?.aggregate_pending_settlement_cash ?? 0);
            const currentRunningCash = rawRunningCash;
            const currentDisplayCash = Number(
                activeSnapshot?.aggregate_display_cash
                ?? currentRunningCash + aggregatePendingSettlementCash,
            );
            const isCurrentReplayBoundary = activeSnapshot === chartTransactions[chartTransactions.length - 1];
            const aggregateBridgeAdjustment = Number(activeSnapshot?.aggregate_bridge_adjustment ?? 0);
            const historicalRunningCash = Number(activeSnapshot?.aggregate_history_running_cash);
            const aggregateRunningCash = Number(
                isCurrentReplayBoundary
                    ? currentRunningCash
                    : Number.isFinite(historicalRunningCash)
                        ? historicalRunningCash
                        : Number(activeSnapshot?.aggregate_running_cash ?? activeSnapshot?.running_cash) + aggregateBridgeAdjustment,
            );
            const historicalDisplayCash = Number(activeSnapshot?.aggregate_history_display_cash);
            const rawAggregateDisplayCash = Number(
                isCurrentReplayBoundary
                    ? currentDisplayCash
                    : Number.isFinite(historicalDisplayCash)
                        ? historicalDisplayCash
                        : Number(activeSnapshot?.aggregate_display_cash) + aggregateBridgeAdjustment,
            );
            const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
                ? rawAggregateDisplayCash
                : aggregateRunningCash + aggregatePendingSettlementCash;
            const aggregateMarketValue = valuation.marketValue;
            const aggregateTotalEquity = valuation.isComplete && Number.isFinite(aggregateDisplayCash)
                ? aggregateDisplayCash + aggregateMarketValue
                : null;
            const currentTotalEquity = valuation.isComplete && Number.isFinite(currentDisplayCash)
                ? currentDisplayCash + aggregateMarketValue
                : null;
            const ledgerEntry = ledgerDateMap.get(date);
            const isCalendarCarryForward = includeCalendarDays && !observedCandidateDateSet.has(date);
            const anchorLedgerNos = Array.isArray(ledgerEntry?.ledgerNos)
                ? ledgerEntry.ledgerNos.filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                : [];
            const cashInAmount = Number(ledgerEntry?.cashInAmountBase) || 0;
            const cashOutAmount = Number(ledgerEntry?.cashOutAmountBase) || 0;
            const netTransferAmount = (Number(ledgerEntry?.netTransferAmountsInBase) || 0);
            const isTradingDay = tradingDateSet.has(date);
            cumulativeNetTransferAmount += netTransferAmount;

            points.push({
                date,
                running_cash: aggregateRunningCash,
                aggregate_running_cash: aggregateRunningCash,
                aggregate_display_cash: aggregateDisplayCash,
                aggregate_current_display_cash: currentDisplayCash,
                market_value: valuation.isComplete ? aggregateMarketValue : null,
                aggregate_market_value: valuation.isComplete ? aggregateMarketValue : null,
                holdings_market_values: valuation.holdingsMarketValues,
                aggregate_holdings_market_values: valuation.holdingsMarketValues,
                holdings_quote_prices: valuation.holdingPrices,
                aggregate_holdings_quote_prices: valuation.holdingPrices,
                total_equity: aggregateTotalEquity,
                aggregate_total_equity: aggregateTotalEquity,
                aggregate_current_total_equity: currentTotalEquity,
                valuation_complete: valuation.isComplete && Number.isFinite(aggregateDisplayCash),
                missing_price_tickers: valuation.missingPriceTickers,
                degraded_price_tickers: valuation.degradedPriceTickers,
                anchor_ledger_date: anchorLedgerNos.length ? date : '',
                anchor_ledger_nos: anchorLedgerNos,
                cash_in_amount: cashInAmount,
                cash_out_amount: cashOutAmount,
                net_transfer_amount: netTransferAmount,
                cumulative_net_transfer_amount: cumulativeNetTransferAmount,
                is_trading_day: isTradingDay,
                is_calendar_carry_forward: isCalendarCarryForward,
                previous_trading_point_index: previousTradingPointIndex,
            });
            if (isTradingDay) {
                previousTradingPointIndex = points.length - 1;
            }
        });

        return points;
    }

    function buildTickerSummaries(
        transactions,
        latestPrices,
        totalEquity,
        tickerClosePrices = {},
        {
            useAuthoritativePositionSnapshot: allowAuthoritativePositionSnapshot = true,
            useAuthoritativePerformanceSnapshot: allowAuthoritativePerformanceSnapshot = true,
            valuationDate = '',
        } = {},
    ) {
        const tickerMap = new Map();
        const lotScopeMap = new Map();
        const orderedTransactions = [...transactions].sort((left, right) => (
            compareInvestmentTaxLotTransactions(left, right)
        ));
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedTransactions, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const authoritativePositionSnapshot = allowAuthoritativePositionSnapshot
            ? getAuthoritativePositionSnapshotForTransactions(orderedTransactions)
            : null;
        const authoritativePerformanceSnapshot = allowAuthoritativePerformanceSnapshot
            ? getAuthoritativePerformanceSnapshot()
            : null;
        const authoritativeBrokerPerformanceSnapshots = allowAuthoritativePerformanceSnapshot
            ? getAuthoritativeBrokerPerformanceSnapshots()
            : [];
        const authoritativeBrokerPositionSnapshots = allowAuthoritativePerformanceSnapshot
            ? getAuthoritativeBrokerPositionSnapshots()
            : [];
        const supplementalBrokerRealizedPnlCache = new Map();
        const verifiedTaxLotHistoryScopes = getVerifiedTaxLotHistoryScopes();
        const useAuthoritativePositionSnapshot = authoritativePositionSnapshot !== null;
        const canonicalAuthoritativePositionSnapshot = {};
        if (useAuthoritativePositionSnapshot) {
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const canonicalTicker = getInvestmentCanonicalTicker(ticker);
                if (!canonicalTicker) return;
                const quantity = getAuthoritativeSnapshotFiniteNumber(snapshot?.quantity) ?? 0;
                const costBasisStatus = snapshot?.costBasisStatus === 'known'
                    || snapshot?.costBasisStatus === 'partial'
                    ? snapshot.costBasisStatus
                    : 'unknown';
                const costPrice = costBasisStatus === 'known'
                    ? getAuthoritativeSnapshotFiniteNumber(snapshot?.costPrice)
                    : null;
                const marketValue = getAuthoritativeSnapshotFiniteNumber(snapshot?.marketValue);
                const lastPrice = getAuthoritativeSnapshotFiniteNumber(snapshot?.lastPrice);
                const previous = canonicalAuthoritativePositionSnapshot[canonicalTicker];
                if (!previous) {
                    canonicalAuthoritativePositionSnapshot[canonicalTicker] = {
                        ...snapshot,
                        quantity,
                        costBasisStatus,
                        costPrice,
                    };
                    return;
                }
                const previousQuantity = Number(previous.quantity) || 0;
                const nextQuantity = previousQuantity + quantity;
                const nextCostBasisStatus = combineAuthoritativeCostBasisStatus(
                    previous.costBasisStatus,
                    costBasisStatus,
                );
                previous.quantity = nextQuantity;
                if (
                    nextCostBasisStatus === 'known'
                    && Number.isFinite(previous.costPrice)
                    && Number.isFinite(costPrice)
                ) {
                    const previousCostTotal = Math.abs(previousQuantity) * previous.costPrice;
                    const nextCostTotal = Math.abs(quantity) * costPrice;
                    previous.costBasisStatus = 'known';
                    previous.costPrice = Math.abs(nextQuantity) > 1e-9
                        ? (previousCostTotal + nextCostTotal) / Math.abs(nextQuantity)
                        : costPrice;
                } else {
                    previous.costBasisStatus = nextCostBasisStatus === 'known'
                        ? 'unknown'
                        : nextCostBasisStatus;
                    previous.costPrice = null;
                }
                if (Number.isFinite(marketValue)) {
                    previous.marketValue = (Number(previous.marketValue) || 0) + marketValue;
                }
                if (Number.isFinite(lastPrice) && lastPrice > 0) {
                    previous.lastPrice = lastPrice;
                }
            });
        }

        orderedTransactions.forEach((txn) => {
            const syntheticCashEquivalentTicker = getLongbridgeHkCashEquivalentSyntheticTicker(txn);
            const ticker = syntheticCashEquivalentTicker
                ? getInvestmentCanonicalTicker(syntheticCashEquivalentTicker)
                : (
                shouldTrackHoldingTicker(txn)
                    ? getInvestmentCanonicalTicker(txn.ticker)
                    : ''
                );
            if (!ticker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const amount = getTransactionAmount(txn);

            const ledgerDate = normalizeLedgerDate(txn?.date);

            const lotScopeKey = getTransactionLotScopeKey(txn, ticker);
            if (!lotScopeMap.has(lotScopeKey)) {
                const scopedState = createPositionState(ticker);
                scopedState.lotScope = getTransactionLotScope(txn, ticker);
                lotScopeMap.set(lotScopeKey, scopedState);
            }
            const scopedState = lotScopeMap.get(lotScopeKey);
            const scopedVerification = verifiedTaxLotHistoryScopes.get([
                scopedState.lotScope.broker,
                scopedState.lotScope.accountToken,
                scopedState.lotScope.ticker,
                scopedState.lotScope.currency,
            ].join('|')) ?? null;
            const scopedRealizedPnlBeforeTransaction = Number(scopedState.realizedPnl) || 0;
            if (syntheticCashEquivalentTicker) {
                const valueAfter = Number(
                    txn?.normalized?.cash_equivalent_value_after
                    ?? txn?.source?.cash_equivalent_cost_basis_after_raw
                    ?? 0
                );
                const interestAmount = Number(
                    txn?.normalized?.cash_equivalent_interest_amount
                    ?? txn?.source?.cash_equivalent_interest_raw
                    ?? 0
                );
                scopedState.shares = Number.isFinite(valueAfter) ? Math.max(0, valueAfter) : 0;
                scopedState.totalCost = scopedState.shares;
                if (Number.isFinite(interestAmount)) {
                    scopedState.realizedPnl += interestAmount;
                }
                if (isFlatPosition(scopedState.shares)) {
                    scopedState.lastCloseDate = ledgerDate;
                }
            } else {
                applyInvestmentTransactionToState(
                    scopedState,
                    txn,
                    normalizedType,
                    quantity,
                    amount,
                    ledgerDate,
                    {
                        preferBrokerRealizedPnl: true,
                        preferTradePriceAndCommission: (
                            scopedVerification?.calculationMethod === 'trade_price_and_commission'
                        ),
                    },
                );
            }
            const scopedRealizedPnlDelta = (
                Number(scopedState.realizedPnl) || 0
            ) - scopedRealizedPnlBeforeTransaction;
            if (ledgerDate && Math.abs(scopedRealizedPnlDelta) > 1e-9) {
                scopedState.realizedPnlByDate[ledgerDate] = (
                    Number(scopedState.realizedPnlByDate[ledgerDate]) || 0
                ) + scopedRealizedPnlDelta;
            }
        });

        getDynamicallyVerifiedTaxLotHistoryScopes(lotScopeMap).forEach((verification, key) => {
            const existingVerification = verifiedTaxLotHistoryScopes.get(key);
            if (shouldPreferDynamicTaxLotHistoryVerification(existingVerification, verification)) {
                verifiedTaxLotHistoryScopes.set(key, verification);
            }
        });

        // Position quantities, cost basis, and realized P&L are aggregated only
        // from the same broker/account/currency scopes that generated them.
        const scopedStatesByTicker = new Map();
        lotScopeMap.forEach((scopeState, lotScopeKey) => {
            const ticker = scopeState.lotScope?.ticker || scopeState.ticker;
            if (!ticker) return;
            if (!scopedStatesByTicker.has(ticker)) scopedStatesByTicker.set(ticker, new Map());
            scopedStatesByTicker.get(ticker).set(lotScopeKey, scopeState);
        });
        const scopedPositionAggregatesByTicker = new Map();
        scopedStatesByTicker.forEach((scopedStates, ticker) => {
            scopedPositionAggregatesByTicker.set(
                ticker,
                aggregateInvestmentScopedPositionStates(
                    scopedStates,
                    ticker,
                    getTickerQuoteCurrency,
                ),
            );
        });
        scopedPositionAggregatesByTicker.forEach((aggregate, ticker) => {
            if (!tickerMap.has(ticker)) tickerMap.set(ticker, createPositionState(ticker));
            const summary = tickerMap.get(ticker);
            summary.shares = aggregate.shares;
            summary.totalCost = aggregate.totalCost;
            summary.realizedPnl = aggregate.realizedPnl;
            summary.nonPerformanceRealizedPnl = aggregate.nonPerformanceRealizedPnl;
            summary.buyCount = aggregate.buyCount;
            summary.buyQuantity = aggregate.buyQuantity;
            summary.sellCount = aggregate.sellCount;
            summary.sellQuantity = aggregate.sellQuantity;
            summary.brokerRealizedSellCount = aggregate.brokerRealizedSellCount;
            summary.realizedPnlStatus = aggregate.realizedPnlStatus;
            summary.hasPartialTaxLotHistory = aggregate.hasPartialTaxLotHistory;
            summary.costBasisStatus = aggregate.costBasisStatus;
            summary.costBasisMethod = aggregate.costBasisMethod;
            summary.realizedPnlByDate = aggregate.realizedPnlByDate;
            summary.lastTradeDate = aggregate.lastTradeDate;
            summary.lastCloseDate = aggregate.lastCloseDate;
            summary.positionCurrencies = aggregate.positionCurrencies;
            summary.hasMixedPositionCurrencies = aggregate.hasMixedPositionCurrencies;
            summary.lotMatchingMethod = getInvestmentCostBasisMethod();
            summary.lots = [];
        });

        const realizedAccountResultsByTicker = new Map();
        lotScopeMap.forEach((scopeState) => {
            const scope = scopeState.lotScope;
            const authoritativeSnapshot = authoritativeBrokerPerformanceSnapshots.find((entry) => (
                entry.broker === scope.broker
                && entry.accountToken === scope.accountToken
            ));
            const performanceEntry = authoritativeSnapshot?.performanceSnapshot?.[scope.ticker] ?? null;
            const authoritativePositionSnapshot = authoritativeBrokerPositionSnapshots.find((entry) => (
                entry.broker === scope.broker
                && entry.accountId
                && entry.accountToken === scope.accountToken
            ));
            const supplementalCacheKey = [
                scope.broker,
                scope.accountToken,
                scope.ticker,
                scope.currency,
            ].join('|');
            if (
                (performanceEntry || authoritativePositionSnapshot)
                && !supplementalBrokerRealizedPnlCache.has(supplementalCacheKey)
            ) {
                supplementalBrokerRealizedPnlCache.set(
                    supplementalCacheKey,
                    buildSupplementalBrokerRealizedPnl(
                        authoritativePositionSnapshot,
                        authoritativeSnapshot,
                        scope,
                        scopeState,
                        orderedTransactions,
                    ),
                );
            }
            const supplementalRealizedPnl = supplementalBrokerRealizedPnlCache.get(supplementalCacheKey) ?? null;
            const performanceAsOf = normalizeLedgerDate(
                authoritativeSnapshot?.performanceSnapshotAsOf,
            );
            const supplementalForPerformance = (
                performanceEntry && performanceAsOf
            ) ? supplementalRealizedPnl : null;
            const replayCoverage = getInvestmentBrokerPerformanceReplayCoverage(
                scope,
                performanceAsOf,
                orderedTransactions,
            );
            const reconciliationSeed = getBrokerRealizedPnlReconciliationSeed(
                authoritativePositionSnapshot,
                authoritativeSnapshot,
                scope.ticker,
            );
            const taxLotHistoryVerification = verifiedTaxLotHistoryScopes.get([
                scope.broker,
                scope.accountToken,
                scope.ticker,
                scope.currency,
            ].join('|')) ?? null;
            const verifiedTaxLotHistory = matchesVerifiedTaxLotHistory(
                scopeState,
                taxLotHistoryVerification,
            );
            const nonPerformanceRealizedPnlLocal = Number(scopeState.nonPerformanceRealizedPnl) || 0;
            let status = 'complete';
            let source = scopeState.brokerRealizedSellCount > 0
                ? 'broker_closed_trades'
                : 'account_tax_lot_reconstruction';
            let sourceCurrency = scope.currency;

            if (performanceEntry && Number.isFinite(performanceEntry.realizedTotal)) {
                sourceCurrency = performanceEntry.currency;
                const replayRequired = Boolean(
                    performanceAsOf
                    && (
                        replayCoverage.postPerformanceTransactionCount > 0
                        || reconciliationSeed?.replay?.required === true
                    )
                );
                if (
                    replayRequired
                    && supplementalForPerformance?.status !== 'complete'
                ) {
                    status = 'unavailable';
                    source = 'unavailable';
                } else {
                    source = supplementalForPerformance?.status === 'complete'
                        && Math.abs(Number(supplementalForPerformance.realizedPnl) || 0) > 1e-9
                        ? 'broker_performance_snapshot_plus_boundary_replay'
                        : 'broker_performance_snapshot';
                }
            } else if (scopeState.realizedPnlStatus === 'incomplete') {
                status = 'incomplete';
                source = 'unavailable';
            } else if (
                scopeState.sellCount > scopeState.brokerRealizedSellCount
                && scopeState.hasPartialTaxLotHistory
                && !verifiedTaxLotHistory
            ) {
                status = 'unverified';
                source = 'unavailable';
            }

            const reconciliation = buildInvestmentRealizedPnlReconciliation({
                scope,
                seed: reconciliationSeed,
                performanceEntry,
                performanceAsOf,
                positionSnapshotAsOf: authoritativePositionSnapshot?.positionSnapshotAsOf,
                scopeState,
                supplemental: supplementalForPerformance,
                replayCoverage,
                nonPerformanceRealizedPnlLocal,
                status,
                source,
                sourceCurrency,
            });
            if (reconciliation.coverageStatus !== 'complete') {
                if (status === 'complete') status = 'unavailable';
                source = 'unavailable';
            }
            const realizedPnlLocal = reconciliation.realizedPnlLocal;
            const realizedPnl = realizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrencyAtLatestRate(
                    realizedPnlLocal,
                    sourceCurrency,
                    fxTimeline,
                    baseCurrency,
                );
            if (realizedPnl !== null && !Number.isFinite(realizedPnl)) {
                status = 'unavailable';
                source = 'missing_fx_rate';
            }
            const accountResult = {
                ...scope,
                realizedPnl: Number.isFinite(realizedPnl) ? Number(realizedPnl.toFixed(12)) : null,
                realizedPnlLocal: realizedPnlLocal === null
                    ? null
                    : Number(realizedPnlLocal.toFixed(12)),
                reconstructedPositionShares: supplementalRealizedPnl?.status === 'complete'
                    ? Number(supplementalRealizedPnl.endingShares)
                    : null,
                reconstructedPositionCostBasis: supplementalRealizedPnl?.status === 'complete'
                    ? Number(supplementalRealizedPnl.endingTotalCost)
                    : null,
                reconstructedPositionCostBasisMethod: supplementalRealizedPnl?.status === 'complete'
                    ? supplementalRealizedPnl.costBasisMethod
                    : null,
                status,
                source,
                reconciliation,
                realizedPnlByDateLocal: status === 'complete'
                    ? {...reconciliation.realizedPnlByDateLocal}
                    : {},
                sellCount: scopeState.sellCount,
                brokerRealizedSellCount: scopeState.brokerRealizedSellCount,
                taxLotHistoryVerification: verifiedTaxLotHistory
                    ? {...taxLotHistoryVerification}
                    : null,
            };
            if (!realizedAccountResultsByTicker.has(scope.ticker)) {
                realizedAccountResultsByTicker.set(scope.ticker, []);
            }
            realizedAccountResultsByTicker.get(scope.ticker).push(accountResult);
        });

        if (useAuthoritativePositionSnapshot) {
            Object.keys(canonicalAuthoritativePositionSnapshot).forEach((ticker) => {
                if (!tickerMap.has(ticker)) {
                    tickerMap.set(ticker, createPositionState(ticker));
                }
            });
        }

        return Array.from(tickerMap.values()).map((summary) => {
            const snapshotEntry = useAuthoritativePositionSnapshot
                ? canonicalAuthoritativePositionSnapshot[summary.ticker] ?? null
                : null;
            const shares = useAuthoritativePositionSnapshot
                ? Number(snapshotEntry?.quantity) || 0
                : summary.shares;
            const hasReconstructedCostBasis = (
                summary.costBasisMethod === 'FIFO reconstructed'
                && summary.costBasisStatus === 'known'
                && Number.isFinite(Number(summary.totalCost))
            );
            const costBasisStatus = snapshotEntry?.costBasisStatus === 'known'
                || snapshotEntry?.costBasisStatus === 'partial'
                ? snapshotEntry.costBasisStatus
                : (snapshotEntry ? (hasReconstructedCostBasis ? 'known' : 'unknown') : summary.costBasisStatus);
            const snapshotCostPrice = costBasisStatus === 'known'
                ? getAuthoritativeSnapshotFiniteNumber(snapshotEntry?.costPrice)
                : null;
            const performanceEntry = authoritativePerformanceSnapshot?.[summary.ticker] ?? null;
            const realizedPnlAccounts = realizedAccountResultsByTicker.get(summary.ticker) || [];
            const completeRealizedPnlAccounts = realizedPnlAccounts.filter((result) => (
                result?.status === 'complete'
                && result?.reconciliation?.coverageStatus === 'complete'
                && result.realizedPnl !== null
            ));
            const summaryCoverageStatus = realizedPnlAccounts.length === 0
                ? (performanceEntry ? 'unavailable' : 'complete')
                : completeRealizedPnlAccounts.length === realizedPnlAccounts.length
                    ? 'complete'
                    : (completeRealizedPnlAccounts.length ? 'partial' : 'unavailable');
            const hasOnlyUnavailableRealizedAccounts = (
                realizedPnlAccounts.length > 0 && completeRealizedPnlAccounts.length === 0
            );
            const hasAuthoritativeBrokerRealizedPnl = realizedPnlAccounts.some((result) => (
                String(result.source || '').startsWith('broker_performance_snapshot')
                && result.status === 'complete'
                && result.reconciliation?.coverageStatus === 'complete'
                && result.realizedPnl !== null
            ));
            const hasMixedPositionCurrencies = !snapshotEntry && summary.hasMixedPositionCurrencies === true;
            const preserveMixedCurrencyRealizedBreakdown = hasMixedPositionCurrencies;
            const hasUnknownOpenCostBasis = !isFlatPosition(shares) && costBasisStatus !== 'known';
            const costBasisUnavailable = hasMixedPositionCurrencies || hasUnknownOpenCostBasis;
            let pnlUnavailable = (
                summaryCoverageStatus !== 'complete'
                || (hasMixedPositionCurrencies && !hasAuthoritativeBrokerRealizedPnl)
                || hasUnknownOpenCostBasis
            );
            let pnlUnavailableReason = !pnlUnavailable
                ? null
                : (hasUnknownOpenCostBasis
                    ? (costBasisStatus === 'partial'
                        ? (snapshotEntry
                            ? 'authoritative_position_snapshot_cost_basis_partial'
                            : 'open_position_cost_basis_partial')
                        : (snapshotEntry
                            ? 'authoritative_position_snapshot_cost_basis_unknown'
                            : 'open_position_cost_basis_unknown'))
                    : (summaryCoverageStatus !== 'complete'
                        ? (summaryCoverageStatus === 'partial'
                            ? 'realized_pnl_coverage_partial'
                            : 'realized_pnl_reconciliation_unavailable')
                        : 'multiple_position_currencies'));
            const costBasisUnavailableReason = !costBasisUnavailable
                ? null
                : (hasMixedPositionCurrencies
                    ? 'multiple_position_currencies'
                    : (costBasisStatus === 'partial'
                        ? 'open_position_cost_basis_partial'
                        : 'open_position_cost_basis_unknown'));
            let totalCost = useAuthoritativePositionSnapshot && snapshotEntry
                ? (snapshotCostPrice === null
                    ? (hasReconstructedCostBasis ? Number(summary.totalCost) : null)
                    : Math.abs(shares) * snapshotCostPrice)
                : (costBasisUnavailable ? null : summary.totalCost);
            let reconstructedCostBasisApplied = false;
            const reconstructedPositionResults = realizedPnlAccounts.filter((result) => (
                result.reconstructedPositionShares !== null
                && result.reconstructedPositionCostBasis !== null
                && Number.isFinite(Number(result.reconstructedPositionShares))
                && Number.isFinite(Number(result.reconstructedPositionCostBasis))
            ));
            if (reconstructedPositionResults.length && Number.isFinite(Number(totalCost))) {
                if (
                    snapshotEntry
                    && reconstructedPositionResults.length === 1
                    && Math.abs(
                        Number(reconstructedPositionResults[0].reconstructedPositionShares) - shares,
                    ) <= 1e-7
                ) {
                    totalCost = Number(reconstructedPositionResults[0].reconstructedPositionCostBasis);
                    reconstructedCostBasisApplied = true;
                } else {
                    let replacedScopeCost = 0;
                    let replacementCost = 0;
                    reconstructedPositionResults.forEach((result) => {
                        const scopeState = Array.from(lotScopeMap.values()).find((candidate) => (
                            candidate.lotScope?.broker === result.broker
                            && candidate.lotScope?.accountToken === result.accountToken
                            && candidate.lotScope?.ticker === result.ticker
                            && candidate.lotScope?.currency === result.currency
                        ));
                        if (!scopeState) return;
                        replacedScopeCost += Number(scopeState.totalCost) || 0;
                        replacementCost += Number(result.reconstructedPositionCostBasis) || 0;
                    });
                    if (replacedScopeCost || replacementCost) {
                        totalCost = Number(totalCost) - replacedScopeCost + replacementCost;
                        reconstructedCostBasisApplied = true;
                    }
                }
            }
            const hasOpenPosition = !isFlatPosition(shares);
            const averagePrice = hasOpenPosition
                ? (snapshotEntry && snapshotCostPrice !== null && !reconstructedCostBasisApplied
                    ? snapshotCostPrice
                    : (totalCost === null ? null : (totalCost / Math.abs(shares))))
                : null;
            const marketValueFromSnapshot = snapshotEntry && Number.isFinite(snapshotEntry.marketValue)
                ? snapshotEntry.marketValue
                : null;
            const snapshotLastPrice = snapshotEntry && Number.isFinite(snapshotEntry.lastPrice)
                ? snapshotEntry.lastPrice
                : null;
            const computedLastPrice = isSyntheticCashEquivalentTicker(summary.ticker)
                ? 1
                : (latestPrices[summary.ticker] ?? null);
            const lastPrice = snapshotLastPrice !== null
                ? snapshotLastPrice
                : (computedLastPrice !== null
                    ? computedLastPrice
                    : (marketValueFromSnapshot !== null && Math.abs(shares) > 1e-9
                        ? marketValueFromSnapshot / shares
                        : null));
            const quoteCurrency = getTickerQuoteCurrency(summary.ticker);
            const lastLedgerDate = normalizeLedgerDate(orderedTransactions[orderedTransactions.length - 1]?.date || '');
            const resolvedValuationDate = normalizeLedgerDate(valuationDate) || lastLedgerDate;
            let realizedPnlLocal = hasOnlyUnavailableRealizedAccounts
                ? null
                : completeRealizedPnlAccounts.reduce(
                    (total, result) => total + (Number(result.realizedPnlLocal) || 0),
                    0,
                );
            const nonPerformanceRealizedPnlLocal = Number(summary.nonPerformanceRealizedPnl) || 0;
            let realizedPnl = hasOnlyUnavailableRealizedAccounts
                ? null
                : completeRealizedPnlAccounts.reduce(
                    (total, result) => total + (Number(result.realizedPnl) || 0),
                    0,
                );
            if (realizedPnlLocal !== null) realizedPnlLocal = Number(realizedPnlLocal.toFixed(12));
            if (realizedPnl !== null) realizedPnl = Number(realizedPnl.toFixed(12));
            const legacyAccount = realizedPnlAccounts.length === 1
                ? realizedPnlAccounts[0]
                : null;
            const legacyExpectedRealizedPnlLocal = performanceEntry
                ? performanceEntry.realizedTotal + (
                    performanceEntry.includesNonperformance ? 0 : nonPerformanceRealizedPnlLocal
                )
                : null;
            const usedLegacyTickerPerformanceSnapshot = (
                legacyAccount
                && performanceEntry
                && Number.isFinite(performanceEntry.realizedTotal)
                && legacyAccount.status === 'complete'
                && legacyAccount.reconciliation?.coverageStatus === 'complete'
                && legacyAccount.reconciliation?.replay?.status === 'not_required'
                && Number.isFinite(legacyExpectedRealizedPnlLocal)
                && Number.isFinite(Number(legacyAccount.realizedPnlLocal))
                && Math.abs(
                    Number(legacyAccount.realizedPnlLocal) - legacyExpectedRealizedPnlLocal,
                ) <= 1e-7
                && Number.isFinite(Number(legacyAccount.realizedPnl))
            );
            if (usedLegacyTickerPerformanceSnapshot) {
                // Keep the legacy compatibility path only when it agrees with
                // the complete account-level reconciliation. The account result
                // remains the canonical value and source of truth.
                realizedPnlLocal = Number(legacyAccount.realizedPnlLocal);
                realizedPnl = Number(legacyAccount.realizedPnl);
            }
            const marketValueLocal = hasMixedPositionCurrencies
                ? null
                : (hasOpenPosition
                ? (marketValueFromSnapshot !== null
                    ? marketValueFromSnapshot
                    : (lastPrice !== null ? shares * lastPrice : null))
                : 0);
            const marketValue = marketValueLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    marketValueLocal,
                    quoteCurrency,
                    resolvedValuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            const unrealizedPnlLocal = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (shares > 0
                    ? (lastPrice - averagePrice) * shares
                    : (averagePrice - lastPrice) * Math.abs(shares))
                : null;
            const unrealizedPnl = unrealizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    unrealizedPnlLocal,
                    quoteCurrency,
                    resolvedValuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            const missingFxRate = realizedPnlAccounts.some((result) => result.source === 'missing_fx_rate')
                || Number.isNaN(marketValue)
                || Number.isNaN(unrealizedPnl);
            if (missingFxRate) {
                pnlUnavailable = true;
                pnlUnavailableReason = 'missing_fx_rate';
            }
            const scopedRealizedPnlByDateLocal = completeRealizedPnlAccounts.reduce(
                (dailyTotals, result) => {
                    Object.entries(result.reconciliation?.realizedPnlByDateLocal || {}).forEach(
                        ([ledgerDate, value]) => {
                            dailyTotals[ledgerDate] = (
                                Number(dailyTotals[ledgerDate]) || 0
                            ) + (Number(value) || 0);
                        },
                    );
                    return dailyTotals;
                },
                {},
            );
            const realizedPnlByDateLocal = pnlUnavailable
                ? {}
                : Object.fromEntries(
                    Object.entries(scopedRealizedPnlByDateLocal).map(([ledgerDate, value]) => ([
                        ledgerDate,
                        Number(Number(value).toFixed(12)),
                    ])),
                );
            const realizedPnlByDate = pnlUnavailable
                ? {}
                : Object.fromEntries(
                    Object.entries(realizedPnlByDateLocal).map(([ledgerDate, dailyRealizedPnlLocal]) => ([
                        ledgerDate,
                        convertAmountToBaseCurrency(
                            dailyRealizedPnlLocal,
                            quoteCurrency,
                            ledgerDate,
                            fxTimeline,
                            baseCurrency,
                        ),
                    ])),
                );
            const safeRealizedPnl = pnlUnavailable ? null : realizedPnl;
            const safeRealizedPnlLocal = pnlUnavailable ? null : realizedPnlLocal;
            const safeUnrealizedPnl = pnlUnavailable ? null : unrealizedPnl;
            const safeUnrealizedPnlLocal = pnlUnavailable ? null : unrealizedPnlLocal;
            const accountReconciliations = realizedPnlAccounts
                .map((accountResult) => accountResult?.reconciliation)
                .filter((reconciliation) => reconciliation && typeof reconciliation === 'object');
            const completeAccountReconciliations = completeRealizedPnlAccounts
                .map((accountResult) => accountResult.reconciliation)
                .filter((reconciliation) => reconciliation && typeof reconciliation === 'object');
            const latestReconciliationDate = (field) => accountReconciliations
                .map((reconciliation) => normalizeLedgerDate(reconciliation?.asOf?.[field]))
                .filter(Boolean)
                .sort()
                .pop() || '';
            const summaryBaselineRealizedPnlLocal = completeAccountReconciliations.reduce(
                (total, reconciliation) => total + (
                    Number(reconciliation.baselineRealizedPnlLocal) || 0
                ),
                0,
            );
            const summaryIncrementalRealizedPnlLocal = completeAccountReconciliations.reduce(
                (total, reconciliation) => total + (
                    Number(reconciliation.incrementalRealizedPnlLocal) || 0
                ),
                0,
            );
            const summaryReplayRequired = accountReconciliations.some(
                (reconciliation) => reconciliation.replay?.required === true,
            );
            const summaryReplayUnavailable = accountReconciliations.some((reconciliation) => (
                reconciliation.coverageStatus === 'unavailable'
                || reconciliation.replay?.status === 'unavailable'
            ));
            const summaryReplayStatus = summaryReplayUnavailable
                ? 'unavailable'
                : (summaryCoverageStatus === 'partial'
                    ? 'partial'
                    : (summaryReplayRequired ? 'complete' : 'not_required'));
            const summaryArithmeticDifference = realizedPnlLocal === null
                ? null
                : realizedPnlLocal - (
                    summaryBaselineRealizedPnlLocal + summaryIncrementalRealizedPnlLocal
                );
            const summaryTimelineDifference = realizedPnlLocal === null
                ? null
                : sumInvestmentRealizedPnlByDate(scopedRealizedPnlByDateLocal) - realizedPnlLocal;
            const summaryReconciliation = {
                schemaVersion: 'v1',
                broker: '',
                account: '',
                ticker: summary.ticker,
                currency: quoteCurrency,
                coverageStatus: summaryCoverageStatus,
                asOf: {
                    performanceSnapshot: latestReconciliationDate('performanceSnapshot'),
                    positionSnapshot: latestReconciliationDate('positionSnapshot'),
                    transactionHistory: latestReconciliationDate('transactionHistory'),
                },
                replay: {
                    status: summaryReplayStatus,
                    required: summaryReplayRequired,
                    reason: summaryReplayUnavailable
                        ? accountReconciliations.find((reconciliation) => (
                            reconciliation.coverageStatus === 'unavailable'
                            || reconciliation.replay?.status === 'unavailable'
                        ))?.replay?.reason || 'realized_pnl_reconciliation_unavailable'
                        : (summaryReplayRequired
                            ? 'supplemental_replay_complete'
                            : 'no_transactions_after_performance_snapshot'),
                    accounts: accountReconciliations,
                },
                baselineRealizedPnlLocal: Number(summaryBaselineRealizedPnlLocal.toFixed(12)),
                incrementalRealizedPnlLocal: Number(summaryIncrementalRealizedPnlLocal.toFixed(12)),
                realizedPnlLocal: safeRealizedPnlLocal,
                realizedPnl: safeRealizedPnl,
                realizedPnlByDateLocal: {...realizedPnlByDateLocal},
                realizedPnlByDate: {...realizedPnlByDate},
                accounts: accountReconciliations,
                arithmeticCheck: {
                    valid: summaryCoverageStatus === 'complete'
                        && Number.isFinite(summaryArithmeticDifference)
                        && Math.abs(summaryArithmeticDifference) <= 1e-7
                        && Number.isFinite(summaryTimelineDifference)
                        && Math.abs(summaryTimelineDifference) <= 1e-6,
                    tolerance: 1e-7,
                },
            };
            // Partial coverage retains each account's original evidence. A
            // separate open-position basis failure still withholds otherwise
            // complete account totals to preserve the established contract.
            const preserveRealizedAccountEvidence = (
                preserveMixedCurrencyRealizedBreakdown
                || summaryCoverageStatus === 'partial'
            );
            const safeRealizedPnlAccounts = (
                pnlUnavailable
                && summaryCoverageStatus === 'complete'
                && !preserveRealizedAccountEvidence
            )
                ? realizedPnlAccounts.map((accountResult) => ({
                    ...accountResult,
                    realizedPnl: null,
                    realizedPnlLocal: null,
                    realizedPnlByDateLocal: {},
                    status: 'unavailable',
                    source: 'unavailable',
                }))
                : realizedPnlAccounts;
            const totalPnl = pnlUnavailable || safeRealizedPnl === null || costBasisUnavailable
                ? null
                : Number((safeRealizedPnl + (safeUnrealizedPnl ?? 0)).toFixed(12));
            const totalPnlLocal = pnlUnavailable || safeRealizedPnlLocal === null || costBasisUnavailable
                ? null
                : Number((safeRealizedPnlLocal + (safeUnrealizedPnlLocal ?? 0)).toFixed(12));
            const positionWeight = Number.isFinite(totalEquity)
                && Number.isFinite(marketValue)
                && Math.abs(totalEquity) > 1e-9
                && hasOpenPosition
                ? (marketValue / totalEquity) * 100
                : null;

            return {
                ...summary,
                shares,
                totalCost,
                averagePrice,
                costBasisStatus,
                costBasisMethod: summary.costBasisMethod,
                lotMatchingMethod: summary.lotMatchingMethod || getInvestmentCostBasisMethod(),
                lastPrice,
                marketValue: Number.isFinite(marketValue) ? marketValue : null,
                valuationComplete: Number.isFinite(marketValue),
                realizedPnl: safeRealizedPnl,
                realizedPnlLocal: safeRealizedPnlLocal,
                realizedPnlAccounts: safeRealizedPnlAccounts,
                realizedPnlReconciliation: summaryReconciliation,
                realizedPnlStatus: summaryCoverageStatus === 'unavailable'
                    ? 'unavailable'
                    : (summaryCoverageStatus === 'partial'
                        ? 'partial'
                        : (pnlUnavailable && !preserveMixedCurrencyRealizedBreakdown
                            ? 'unavailable'
                            : (realizedPnlAccounts.some((result) => result.status !== 'complete')
                                ? 'partial'
                                : 'complete'))),
                realizedPnlBreakdownAvailable: preserveRealizedAccountEvidence
                    && realizedPnlAccounts.some((result) => result.realizedPnl !== null),
                realizedPnlByDate,
                realizedPnlByDateLocal,
                quoteCurrency,
                unrealizedPnl: safeUnrealizedPnl,
                unrealizedPnlLocal: safeUnrealizedPnlLocal,
                unrealizedPnlStatus: pnlUnavailable
                    ? 'unavailable'
                    : (safeUnrealizedPnl === null ? 'unavailable' : 'complete'),
                totalPnl,
                totalPnlLocal,
                pnlUnavailable,
                pnlUnavailableReason,
                costBasisUnavailable,
                costBasisUnavailableReason,
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
            // Closed positions: sort by close time descending (most recent 清仓 first),
            // matching the requested top-to-bottom order (newest exit at top).
            const leftDate = left.lastCloseDate || '';
            const rightDate = right.lastCloseDate || '';
            if (leftDate !== rightDate) {
                return rightDate.localeCompare(leftDate);
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
        buildDailyEquityChartPoints,
        buildTickerSummaries,
        formatAmount,
    };
}
