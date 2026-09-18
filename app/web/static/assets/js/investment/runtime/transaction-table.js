/**
 * Investment transaction-table replay and dashboard composition.
 *
 * Code version: v1.1.0
 * - Added: Dated broker interest-accrual NAV boundaries are applied after
 *   every cash and position projection, only on their statement as-of date.
 * - Added: Isolated the primary transaction replay from the workspace entry.
 */

import {createInvestmentHistoryProjectionRuntime} from './history-projection.js?v=investment-history-projection-v1.0.0';

export function createInvestmentTransactionTableRuntime(runtime) {
async function renderTransactionTable(transactions, { preserveHistoryPage = false, scrollToTop = true } = {}) {
        const tbody = runtime.getInvestmentHistoryTableBody();
        if (!tbody) return { isDegraded: false, message: '' };
        runtime.clearInvestmentHistoryHighlights();
        runtime.syncInvestmentHistoryHeading();
        runtime.state.investmentRawTransactionsCache = Array.isArray(transactions) ? [...transactions] : [];

        if (!transactions.length) {
            runtime.state.investmentProcessedTransactionsCache = [];
            runtime.refreshInvestmentAvailableBrokerCodes();
            runtime.setInvestmentExportButtonVisibility(false);
            runtime.syncHoldingsChartHoverState('', 0);
            runtime.resetInvestmentDashboard();
            tbody.innerHTML = `
                <tr data-table-empty-row>
                    <td colspan="11" class="investment-history-empty-cell">
                        <div class="investment-history-empty-state" role="status" aria-live="polite">
                            <p class="investment-history-empty-title"><strong>Import or sync broker activity to begin.</strong></p>
                            <p class="investment-history-empty-step">➊ Click <span class="investment-inline-plus-icon" aria-hidden="true"></span> above to open the import panel.</p>
                            <p class="investment-history-empty-step">➋ Select a broker, then upload IBKR CSV files or paste the HSBC cash-account, Portfolio, and Order Status page text.</p>
                            <p class="investment-history-empty-step">➌ IBKR, Longbridge (HK)/(SG), and HSBC are available through their current import adapters.</p>
                        </div>
                    </td>
                </tr>
            `;
            runtime.initializeInvestmentBrokerFilterSelection();
            runtime.mountInvestmentBrokerFilterHeaders();
            runtime.mountInvestmentSideFilterHeaders();
            runtime.mountInvestmentCurrencyFilterHeaders();
            runtime.mountInvestmentDescriptionBindingFilterHeaders();
            runtime.renderInvestmentHistoryPagination(0);
            runtime.attachHistoryTableAlignmentSync(runtime.historyTable);
            return { isDegraded: false, message: '' };
        }

        runtime.setInvestmentExportButtonVisibility(true);

        // 1. Sort by date ascending to calculate running cash and holdings
        // Read starting_cash from top-level JSON if available, otherwise default to 0
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const aggregateStartingCashBalances = runtime.getInvestmentStartingCashBalances();
        const aggregateStartingCash = Number.isFinite(Number(aggregateStartingCashBalances?.[baseCurrency]))
            ? Number(aggregateStartingCashBalances[baseCurrency])
            : runtime.getInvestmentStartingCash();
        const aggregateLedgerState = {
            cashBalances: runtime.createCashLedgerFromBalances(
                aggregateStartingCashBalances,
                aggregateStartingCash,
                baseCurrency,
            ),
            runningCash: aggregateStartingCash,
            pendingSettlementCash: 0,
            holdings: {},
            moneyMarketAnchors: {},
        };
        aggregateLedgerState.cashScopeLedger = runtime.createInvestmentCashScopeLedger(
            aggregateLedgerState.cashBalances,
        );
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        const priceHistoryRows = window.WORTHWARD_INVESTMENT_DATA?.price_history_by_ticker || {};
        const priceHistoryFailures = window.WORTHWARD_INVESTMENT_DATA?.price_history_failures || [];
        const tickerClosePrices = runtime.normalizePriceHistoryPayload(priceHistoryRows);
        const tickerPriceIndex = runtime.buildTickerPriceIndex(tickerClosePrices);
        const lastKnownTickerPrices = {};

        let orderedTransactions = [...transactions].sort((left, right) => runtime.compareInvestmentTransactionsForReplay(left, right));
        // Transfer keys come from immutable imported record fields.  Establish
        // them before replay so the server's reconciliation is the only source
        // of truth for aggregate-only exclusions.
        const transferContext = runtime.buildInvestmentInternalTransferContext(orderedTransactions);
        orderedTransactions = runtime.reorderInvestmentTransactionsForBoundTransfers(
            orderedTransactions,
            transferContext,
        );
        // Settlement boundaries carry broker-native SEC evidence through the
        // cash replay only. They never become transactions, history rows, or
        // ledger numbers.
        const hsbcCashSettlementBoundaryPlan = runtime.buildHsbcCashSettlementBoundaryPlan(orderedTransactions);
        const hsbcFutureSettlementCashByTransactionIndex = new Map();
        hsbcCashSettlementBoundaryPlan.forEach((boundary) => {
            const ownerTransactionIndex = Number(boundary?.ownerTransactionIndex);
            const settlementAmount = Number(boundary?.settlementAmount);
            if (
                !Number.isInteger(ownerTransactionIndex)
                || ownerTransactionIndex < 0
                || !Number.isFinite(settlementAmount)
                || Math.abs(settlementAmount) <= 1e-9
            ) {
                return;
            }
            hsbcFutureSettlementCashByTransactionIndex.set(
                ownerTransactionIndex,
                (Number(hsbcFutureSettlementCashByTransactionIndex.get(ownerTransactionIndex)) || 0)
                    + settlementAmount,
            );
        });
        const aggregateSecurityTransferState = runtime.refreshInvestmentAggregateSecurityTransferState(
            orderedTransactions,
        );
        const hsbcAvailableCashWindowStartDate = orderedTransactions.reduce((latestDate, txn) => {
            if (runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) !== 'hsbc') return latestDate;
            const settlementDate = runtime.normalizeLedgerDate(txn?.source?.cash_settlement_date);
            if (!settlementDate) return latestDate;
            return !latestDate || settlementDate > latestDate ? settlementDate : latestDate;
        }, '');
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const payloadBrokerCodes = Array.isArray(window.WORTHWARD_INVESTMENT_DATA?.brokers)
            ? window.WORTHWARD_INVESTMENT_DATA.brokers.map((broker) => runtime.normalizeInvestmentBroker(broker)).filter(Boolean)
            : [];
        const orderedBrokerCodes = Array.from(new Set(orderedTransactions.map((txn) => runtime.getTransactionBrokerCode(txn))));
        const effectiveBrokerCodes = payloadBrokerCodes.length ? payloadBrokerCodes : orderedBrokerCodes;
        const isSingleBrokerPortfolio = effectiveBrokerCodes.length <= 1;
        const singleBrokerCode = isSingleBrokerPortfolio
            ? runtime.normalizeInvestmentBroker(effectiveBrokerCodes[0] || window.WORTHWARD_INVESTMENT_DATA?.broker || 'ibkr')
            : '';
        const brokerLedgerStates = new Map();

        function createLedgerState(startingCash = 0, startingBalances = null) {
            const numericStartingCash = Number(startingCash);
            const safeStartingCash = Number.isFinite(numericStartingCash) ? numericStartingCash : 0;
            const cashBalances = runtime.createCashLedgerFromBalances(
                startingBalances,
                safeStartingCash,
                baseCurrency,
            );
            return {
                cashBalances,
                cashScopeLedger: runtime.createInvestmentCashScopeLedger(cashBalances),
                runningCash: safeStartingCash,
                pendingSettlementCash: 0,
                holdings: {},
                moneyMarketAnchors: {},
            };
        }

        function getBrokerLedgerState(brokerCode) {
            const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
            if (!brokerLedgerStates.has(normalizedBrokerCode)) {
                const brokerStartingBalances = isSingleBrokerPortfolio && normalizedBrokerCode === singleBrokerCode
                    ? aggregateStartingCashBalances
                    : runtime.getInvestmentBrokerStartingCashBalances(normalizedBrokerCode);
                const brokerStartingCash = Object.keys(brokerStartingBalances).length
                    ? runtime.sumCashLedgerInBaseCurrency(
                        brokerStartingBalances,
                        runtime.normalizeLedgerDate(orderedTransactions[0]?.date) || runtime.getTodayLedgerDate(),
                        fxTimeline,
                        baseCurrency,
                    )
                    : (
                        isSingleBrokerPortfolio && normalizedBrokerCode === singleBrokerCode
                            ? aggregateStartingCash
                            : runtime.getInvestmentBrokerStartingCash(normalizedBrokerCode)
                    );
                brokerLedgerStates.set(normalizedBrokerCode, createLedgerState(
                    brokerStartingCash,
                    brokerStartingBalances,
                ));
            }
            return brokerLedgerStates.get(normalizedBrokerCode);
        }

        function applyHoldingStateUpdate(state, txn, normalizedType, valuationQty, price) {
            if (runtime.isLongbridgeHkCashEquivalentTransfer(txn)) {
                const syntheticSourceTicker = runtime.getLongbridgeHkCashEquivalentSyntheticTicker(txn);
                const syntheticTicker = runtime.getInvestmentCanonicalTicker(syntheticSourceTicker);
                if (!syntheticTicker) return;
                const valueAfter = Number(
                    txn?.normalized?.cash_equivalent_value_after
                    ?? txn?.source?.cash_equivalent_cost_basis_after_raw
                    ?? 0
                );
                if (!Number.isFinite(valueAfter) || valueAfter <= 1e-9) {
                    delete state.holdings[syntheticTicker];
                    delete state.moneyMarketAnchors[syntheticTicker];
                    return;
                }
                state.holdings[syntheticTicker] = valueAfter;
                state.moneyMarketAnchors[syntheticTicker] = 1;
                return;
            }
            const isSyntheticFractional = runtime.isUsmartHkFractionalSharesTransaction(txn);
            if (!txn.ticker && !isSyntheticFractional) return;
            const rawTicker = isSyntheticFractional
                ? runtime.USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                : String(txn.ticker).trim().toUpperCase();
            const normalizedTicker = runtime.getInvestmentCanonicalTicker(rawTicker);
            if (runtime.isForexPairTicker(normalizedTicker)) return;
            if (!normalizedTicker) return;
            let effectiveValuationQty = valuationQty;
            let effectivePrice = price;
            if (
                isSyntheticFractional
                && (effectiveValuationQty === null || Number.isNaN(effectiveValuationQty))
            ) {
                const existingQuantity = Number(state.holdings[normalizedTicker]) || 0;
                const notionalAmount = Math.abs(Number(runtime.getTransactionAmount(txn)) || 0);
                effectiveValuationQty = normalizedType === 'sell' && existingQuantity > 0
                    ? existingQuantity
                    : notionalAmount;
            }
            if (effectiveValuationQty === null || Number.isNaN(effectiveValuationQty)) return;
            if (isSyntheticFractional && (!Number.isFinite(effectivePrice) || effectivePrice <= 0)) {
                const notionalAmount = Math.abs(Number(runtime.getTransactionAmount(txn)) || 0);
                effectivePrice = notionalAmount > 0 && effectiveValuationQty > 0
                    ? notionalAmount / effectiveValuationQty
                    : 1;
            }
            if (!state.holdings[normalizedTicker]) state.holdings[normalizedTicker] = 0;
            const isMoneyMarketTicker = (
                moneyMarketTickers.has(normalizedTicker)
                || moneyMarketTickers.has(rawTicker)
                || runtime.isSyntheticCashEquivalentTicker(normalizedTicker)
            );
            if (['buy', 'dividend_reinvestment', 'grant', 'transfer_in'].includes(normalizedType)) {
                if (isMoneyMarketTicker && effectivePrice !== null && !Number.isNaN(effectivePrice)) {
                    const previousQuantity = state.holdings[normalizedTicker];
                    const previousAnchor = state.moneyMarketAnchors[normalizedTicker] ?? effectivePrice;
                    const nextQuantity = previousQuantity + effectiveValuationQty;
                    state.moneyMarketAnchors[normalizedTicker] = nextQuantity > 0
                        ? (((previousQuantity * previousAnchor) + (effectiveValuationQty * effectivePrice)) / nextQuantity)
                        : effectivePrice;
                }
                state.holdings[normalizedTicker] += effectiveValuationQty;
                return;
            }
            if (!['sell', 'transfer_out'].includes(normalizedType)) return;
            state.holdings[normalizedTicker] -= effectiveValuationQty;
            if (isMoneyMarketTicker && state.holdings[normalizedTicker] > 0 && effectivePrice !== null && !Number.isNaN(effectivePrice)) {
                state.moneyMarketAnchors[normalizedTicker] = state.moneyMarketAnchors[normalizedTicker] ?? effectivePrice;
            }
            if (state.holdings[normalizedTicker] <= 0) {
                delete state.moneyMarketAnchors[normalizedTicker];
            }
            if (Math.abs(state.holdings[normalizedTicker]) < 1e-9) {
                delete state.holdings[normalizedTicker];
            }
        }

        function refreshCashState(state, ledgerDate) {
            state.cashBalances = runtime.getInvestmentCashScopeBalances(state.cashScopeLedger);
            state.runningCash = runtime.sumCashLedgerInBaseCurrency(state.cashBalances, ledgerDate, fxTimeline, baseCurrency);
        }

        function applyCashStateUpdate(state, transactionCurrency, cashDelta, ledgerDate, txn = null) {
            const boundary = runtime.getInvestmentCashBalanceBoundary(txn);
            if (boundary) {
                runtime.setInvestmentCashScopeBoundary(state.cashScopeLedger, boundary);
            } else {
                runtime.addInvestmentCashScopeDelta(state.cashScopeLedger, transactionCurrency, cashDelta);
            }
            refreshCashState(state, ledgerDate);
        }

        function applyAuthoritativeCashBalance(
            state,
            authoritativeCash,
            currency = baseCurrency,
            ledgerDate = '',
            txn = null,
        ) {
            const normalizedCash = Number(authoritativeCash);
            if (!Number.isFinite(normalizedCash)) return;
            const normalizedCurrency = String(currency || baseCurrency).trim().toUpperCase() || baseCurrency;
            const boundary = runtime.getInvestmentCashBalanceBoundary(txn);
            if (boundary) {
                runtime.setInvestmentCashScopeBoundary(state.cashScopeLedger, {
                    ...boundary,
                    balance: Math.max(0, normalizedCash),
                });
            } else {
                runtime.setInvestmentCashScopeAggregateBalance(
                    state.cashScopeLedger,
                    normalizedCurrency,
                    normalizedCash,
                );
            }
            refreshCashState(state, ledgerDate);
        }

        function rebuildAggregateCashState(ledgerDate) {
            const mergedBalances = {};
            brokerLedgerStates.forEach((state) => {
                Object.entries(state?.cashBalances || {}).forEach(([currency, value]) => {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                    mergedBalances[currency] = (Number(mergedBalances[currency]) || 0) + numericValue;
                });
            });
            aggregateLedgerState.cashScopeLedger = runtime.createInvestmentCashScopeLedger(mergedBalances);
            aggregateLedgerState.cashBalances = runtime.getInvestmentCashScopeBalances(
                aggregateLedgerState.cashScopeLedger,
            );
            aggregateLedgerState.runningCash = runtime.sumCashLedgerInBaseCurrency(
                aggregateLedgerState.cashBalances,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
        }

        function calculatePendingSettlementCashDelta(txn) {
            const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            if (
                brokerCode !== 'hsbc'
                || !['buy', 'sell'].includes(normalizedType)
                || !runtime.isHsbcSettlementActuallyPending(txn?.source)
            ) {
                return 0;
            }
            const amount = Number(
                txn?.normalized?.net_amount
                ?? txn?.net_amount_raw
                ?? txn?.gross_amount_raw
                ?? runtime.getTransactionAmount(txn)
                ?? txn?.source?.cash_settlement_amount_raw
                ?? 0
            );
            return Number.isFinite(amount) ? amount : 0;
        }

        function calculateInvestmentCashDelta(txn, transactionIndex = -1) {
            let qty = runtime.getTransactionQuantity(txn);
            let amount = runtime.getTransactionAmount(txn);
            let price = runtime.getTransactionPrice(txn);
            let commission = 0;
            if (txn.normalized?.commission !== undefined && txn.normalized?.commission !== null) commission = Number(txn.normalized.commission);
            else if (txn.commission !== undefined && txn.commission !== null) commission = Number(txn.commission);
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
            if (normalizedType === 'fx_translation_pnl') {
                return 0;
            }
            if ((amount === 0 || amount === undefined) && qty !== null && price !== null && ['buy', 'sell'].includes(txn.type)) {
                amount = qty * price;
            }

            let cashDelta = 0;
            if (txn.normalized !== undefined) {
                cashDelta += amount;
            } else if (['forex_trade', 'adjustment', 'fx_translation_pnl'].includes(normalizedType)) {
                cashDelta += amount;
            } else if (normalizedType === 'deposit' || normalizedType === 'virtual_deposit' || normalizedType === 'sell' || normalizedType === 'dividend'
                || normalizedType === 'credit_interest' || normalizedType === 'payment_in_lieu') {
                if (normalizedType === 'sell' && amount && commission) {
                    cashDelta += (amount - commission);
                } else {
                    cashDelta += amount;
                }
            } else if (normalizedType === 'withdrawal' || normalizedType === 'virtual_withdrawal' || normalizedType === 'virtual_balance_reset' || normalizedType === 'buy' || normalizedType === 'dividend_reinvestment'
                || normalizedType === 'foreign_tax_withholding' || normalizedType === 'debit_interest') {
                if (amount !== 0) {
                    cashDelta += amount;
                }
            }

            const isImported = txn.normalized !== undefined;
            if (!isImported && commission && !['buy', 'sell'].includes(normalizedType)) {
                cashDelta -= Math.abs(commission);
            }
            if (brokerCode === 'hsbc' && ['buy', 'sell'].includes(normalizedType)) {
                if (runtime.isHsbcSettlementActuallyPending(txn?.source)) {
                    return 0;
                }
                const futureSettlementCash = Number(
                    hsbcFutureSettlementCashByTransactionIndex.get(transactionIndex),
                );
                if (
                    Number.isFinite(futureSettlementCash)
                    && Math.abs(futureSettlementCash) > 1e-9
                    && Math.abs(cashDelta) > 1e-9
                    && Math.sign(cashDelta) === Math.sign(futureSettlementCash)
                ) {
                    const deferredCash = Math.sign(futureSettlementCash) * Math.min(
                        Math.abs(cashDelta),
                        Math.abs(futureSettlementCash),
                    );
                    cashDelta -= deferredCash;
                }
            }
            return Number.isFinite(cashDelta) ? cashDelta : 0;
        }

        // Pending HSBC proceeds are a source-bounded projection.  Do not use
        // the replay ledger's pending total here: that total can inherit
        // unrelated historical drift after the current cash snapshot.
        const pendingSettlementCashByIndex = [];
        const pendingSettlementEntries = [];
        orderedTransactions.forEach((candidate) => {
            const transactionDate = runtime.normalizeLedgerDate(candidate?.date);
            if (transactionDate) {
                for (let entryIndex = pendingSettlementEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
                    const entry = pendingSettlementEntries[entryIndex];
                    if (entry.settlementDate && entry.settlementDate <= transactionDate) {
                        pendingSettlementEntries.splice(entryIndex, 1);
                    }
                }
            }
            const pendingAmount = calculatePendingSettlementCashDelta(candidate);
            const settlementDate = runtime.normalizeLedgerDate(candidate?.source?.cash_settlement_date);
            if (
                Number.isFinite(pendingAmount)
                && Math.abs(pendingAmount) > 1e-9
                && (!settlementDate || !transactionDate || settlementDate > transactionDate)
            ) {
                const currency = runtime.formatTransactionCurrency(candidate)
                    || runtime.getTickerQuoteCurrency(candidate?.ticker)
                    || baseCurrency;
                const pendingAmountBase = runtime.convertAmountToBaseCurrency(
                    pendingAmount,
                    currency,
                    transactionDate,
                    fxTimeline,
                    baseCurrency,
                );
                if (Number.isFinite(pendingAmountBase) && Math.abs(pendingAmountBase) > 1e-9) {
                    pendingSettlementEntries.push({
                        settlementDate,
                        amountBase: pendingAmountBase,
                    });
                }
            }
            pendingSettlementCashByIndex.push(
                pendingSettlementEntries.reduce((total, entry) => total + entry.amountBase, 0),
            );
        });

        function buildInvestmentCashFundingAdjustments(transactionsForReplay) {
            const adjustments = new Map();
            const simulatedBalances = new Map();
            const cashDeltas = transactionsForReplay.map(
                (txn, index) => calculateInvestmentCashDelta(txn, index),
            );
            const simulationKeyFor = (txn) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                const account = String(
                    txn?.account_id
                    ?? txn?.account
                    ?? txn?.source?.account_id
                    ?? txn?.source?.account
                    ?? txn?.source?.account_number
                    ?? '',
                ).trim();
                const currency = runtime.formatTransactionCurrency(txn) || runtime.getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
                return `${brokerCode}|${account}|${currency}`;
            };
            const getAdjustment = (index) => Number(adjustments.get(index)) || 0;
            const getSimulationStartingBalance = (txn) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                const currency = runtime.formatTransactionCurrency(txn)
                    || runtime.getTickerQuoteCurrency(txn?.ticker)
                    || baseCurrency;
                const startingBalances = isSingleBrokerPortfolio && brokerCode === singleBrokerCode
                    ? aggregateStartingCashBalances
                    : runtime.getInvestmentBrokerStartingCashBalances(brokerCode);
                const explicitBalance = Number(startingBalances?.[currency]);
                if (Number.isFinite(explicitBalance)) return explicitBalance;
                return currency === baseCurrency
                    ? runtime.getInvestmentBrokerStartingCash(brokerCode)
                    : 0;
            };
            transactionsForReplay.forEach((txn, index) => {
                const key = simulationKeyFor(txn);
                const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
                const currentBalance = simulatedBalances.has(key)
                    ? Number(simulatedBalances.get(key)) || 0
                    : getSimulationStartingBalance(txn);
                let effectiveDelta = cashDeltas[index] + getAdjustment(index);
                let projectedBalance = currentBalance + effectiveDelta;
                if (projectedBalance < -1e-9) {
                    let deficit = Math.abs(projectedBalance);
                    for (let futureIndex = index + 1; futureIndex < transactionsForReplay.length && deficit > 1e-9; futureIndex += 1) {
                        const futureTxn = transactionsForReplay[futureIndex];
                        if (simulationKeyFor(futureTxn) !== key) continue;
                        if (runtime.normalizeLedgerDate(futureTxn?.date) !== ledgerDate) continue;
                        const availableFutureCash = cashDeltas[futureIndex] + getAdjustment(futureIndex);
                        if (availableFutureCash <= 1e-9) continue;
                        const allocation = Math.min(availableFutureCash, deficit);
                        adjustments.set(index, getAdjustment(index) + allocation);
                        adjustments.set(futureIndex, getAdjustment(futureIndex) - allocation);
                        deficit -= allocation;
                    }
                    effectiveDelta = cashDeltas[index] + getAdjustment(index);
                    projectedBalance = currentBalance + effectiveDelta;
                }
                simulatedBalances.set(key, projectedBalance);
            });
            return adjustments;
        }

        const cashFundingAdjustments = buildInvestmentCashFundingAdjustments(orderedTransactions);
        const hsbcSettlementDatesWithSameDayPosting = new Set();
        orderedTransactions.forEach((txn) => {
            if (runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) !== 'hsbc') return;
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const transactionDate = runtime.normalizeLedgerDate(txn?.date);
            const settlementDate = runtime.normalizeLedgerDate(source.cash_settlement_date);
            if (!transactionDate || !settlementDate || settlementDate <= transactionDate) return;
            const rawSourceDatetime = String(source.source_datetime_raw || '');
            const compactDatetimeMatch = rawSourceDatetime.match(/^(\d{4})(\d{2})(\d{2})/);
            const sourceDatetimeDate = compactDatetimeMatch
                ? `${compactDatetimeMatch[1]}-${compactDatetimeMatch[2]}-${compactDatetimeMatch[3]}`
                : runtime.normalizeLedgerDate(rawSourceDatetime);
            if (sourceDatetimeDate === settlementDate) {
                hsbcSettlementDatesWithSameDayPosting.add(settlementDate);
            }
        });
        const renderedSplitFactorHints = runtime.buildRenderedSplitFactorHints(orderedTransactions, tickerPriceIndex);
        const authoritativeBrokerPositionSnapshots = new Map();
        effectiveBrokerCodes.forEach((brokerCode) => {
            const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
            const brokerTransactions = orderedTransactions.filter((txn) => (
                runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === normalizedBrokerCode
            ));
            const snapshot = runtime.getAuthoritativePositionSnapshotForTransactions(brokerTransactions);
            if (snapshot !== null && Object.keys(snapshot).length) {
                authoritativeBrokerPositionSnapshots.set(normalizedBrokerCode, snapshot);
            }
        });
        const latestBrokerTransactionByCode = new Map();
        orderedTransactions.forEach((txn) => {
            latestBrokerTransactionByCode.set(
                runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)),
                txn,
            );
        });
        const transactionIntradayDaysByTicker = new Map();
        orderedTransactions.forEach((txn) => {
            const normalizedBrokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
            const authoritativeSnapshot = authoritativeBrokerPositionSnapshots.get(normalizedBrokerCode);
            const isPendingSettlementRow = runtime.isHsbcSettlementActuallyPending(txn?.source);
            if (!authoritativeSnapshot || (
                txn !== latestBrokerTransactionByCode.get(normalizedBrokerCode)
                && !isPendingSettlementRow
            )) {
                return;
            }
            const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            const valuationTickers = new Set([
                ...Object.keys(authoritativeSnapshot),
                txn?.ticker,
            ]);
            valuationTickers.forEach((ticker) => {
                const normalizedTicker = runtime.getInvestmentCanonicalTicker(ticker);
                if (!normalizedTicker || runtime.isForexPairTicker(normalizedTicker)) return;
                if (!transactionIntradayDaysByTicker.has(normalizedTicker)) {
                    transactionIntradayDaysByTicker.set(normalizedTicker, new Set());
                }
                transactionIntradayDaysByTicker.get(normalizedTicker).add(ledgerDate);
            });
        });
        const transactionIntradayClosePrices = new Map();
        const transactionIntradayResults = await Promise.allSettled(
            Array.from(transactionIntradayDaysByTicker.entries()).map(async ([ticker, daySet]) => ({
                ticker,
                rows: await runtime.loadInvestmentOverviewIntradayRows(ticker, Array.from(daySet), '1w'),
            })),
        );
        transactionIntradayResults
            .filter((result) => result.status === 'fulfilled')
            .forEach(({value}) => {
                const normalizedTicker = runtime.getInvestmentCanonicalTicker(value?.ticker);
                if (!normalizedTicker) return;
                (Array.isArray(value?.rows) ? value.rows : []).forEach((row) => {
                    const ledgerDate = runtime.normalizeLedgerDate(row?.date);
                    const close = Number(row?.close);
                    if (!ledgerDate || !Number.isFinite(close) || close <= 0) return;
                    // Rows are sorted by timestamp, so the last close wins for the trading day.
                    transactionIntradayClosePrices.set(`${normalizedTicker}|${ledgerDate}`, close);
                });
            });
        const processed = orderedTransactions.map((txn, processedIndex) => {
            // ========== COMPLETELY COMPATIBLE FIELD READING ==========
            // 1. Quantity: for holdings and description
            let qty = runtime.getTransactionQuantity(txn);
            const valuationQty = runtime.getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);

            // 2. Net amount: for cash calculation
            let amount = runtime.getTransactionAmount(txn);

            // 3. Price: for auto-calculating amount and market value
            let price = runtime.getTransactionPrice(txn);

            // 4. Commission: for cash impact
            let commission = 0;
            if (txn.normalized?.commission !== undefined && txn.normalized?.commission !== null) commission = Number(txn.normalized.commission);
            else if (txn.commission !== undefined && txn.commission !== null) commission = Number(txn.commission);

            // Auto-calculate amount if missing but we have quantity and price
            if ((amount === 0 || amount === undefined) && qty !== null && price !== null && ['buy', 'sell'].includes(txn.type)) {
                amount = qty * price;
            }

            // Update holdings based on transaction type
            // Normalize type first
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const brokerCode = runtime.getTransactionBrokerCode(txn);
            const brokerLedgerState = getBrokerLedgerState(brokerCode);
            const receiptKey = String(txn?.manual_internal_transfer_key || '').trim();
            const includeInAggregate = !aggregateSecurityTransferState.excludedReceiptKeys.has(receiptKey);
            if (includeInAggregate) {
                applyHoldingStateUpdate(aggregateLedgerState, txn, normalizedType, valuationQty, price);
            }
            applyHoldingStateUpdate(brokerLedgerState, txn, normalizedType, valuationQty, price);

            if (runtime.shouldTrackHoldingTicker(txn) && price !== null && Number.isFinite(price) && price > 0) {
                const priceTicker = runtime.getInvestmentCanonicalTicker(txn.ticker);
                if (priceTicker) {
                    lastKnownTickerPrices[priceTicker] = price;
                }
            }

            const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
            const transactionCurrency = runtime.formatTransactionCurrency(txn) || runtime.getTickerQuoteCurrency(txn?.ticker) || baseCurrency;
            const cashDelta = calculateInvestmentCashDelta(txn, processedIndex)
                + (Number(cashFundingAdjustments.get(processedIndex)) || 0);
            const pendingSettlementDelta = calculatePendingSettlementCashDelta(txn);
            const sourceBoundedPendingSettlementCashForRow = Number(
                pendingSettlementCashByIndex[processedIndex],
            ) || 0;
            const cashBoundary = runtime.getInvestmentCashBalanceBoundary(txn);
            applyCashStateUpdate(brokerLedgerState, transactionCurrency, cashDelta, ledgerDate, txn);
            if (cashBoundary) {
                rebuildAggregateCashState(ledgerDate);
            } else {
                applyCashStateUpdate(aggregateLedgerState, transactionCurrency, cashDelta, ledgerDate, txn);
            }
            aggregateLedgerState.pendingSettlementCash += pendingSettlementDelta;
            brokerLedgerState.pendingSettlementCash += pendingSettlementDelta;
            const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
            const brokerPendingSettlementCashForRow = normalizedBrokerCode === 'hsbc'
                ? sourceBoundedPendingSettlementCashForRow
                : brokerLedgerState.pendingSettlementCash;
            const shouldReplayPendingSettlement = (
                normalizedBrokerCode === 'hsbc'
                && runtime.isHsbcSettlementActuallyPending(txn?.source)
            );
            const transactionDate = runtime.normalizeLedgerDate(txn?.date);
            const cashSettlementDate = runtime.normalizeLedgerDate(txn?.source?.cash_settlement_date);
            const hasWindowedAvailableCash = (
                txn?.source?.available_cash_after_raw !== undefined
                && txn?.source?.available_cash_after_raw !== null
                && (
                    !hsbcAvailableCashWindowStartDate
                    || !transactionDate
                    || transactionDate >= hsbcAvailableCashWindowStartDate
                )
            );
            const hasReachedCashSettlementDate = (
                !cashSettlementDate
                || !transactionDate
                || transactionDate >= cashSettlementDate
            );
            const settlementBalanceAfter = hasReachedCashSettlementDate
                ? txn?.source?.cash_settlement_balance_after_raw
                : undefined;
            const shouldSkipSavingsBalanceAfter = (
                runtime.normalizeInvestmentBroker(brokerCode) === 'hsbc'
                && String(txn?.source?.file_kind || '').trim().toLowerCase() === 'hsbc_usd_savings_csv'
                && hsbcSettlementDatesWithSameDayPosting.has(transactionDate)
            );
            const bankBalanceAfter = shouldSkipSavingsBalanceAfter
                ? undefined
                : (
                    txn?.source?.cash_balance_authoritative === true
                    || txn?.source?.file_kind === 'hsbc_usd_account_text'
                )
                    ? txn?.source?.balance_after_raw
                    : undefined;
            const authoritativeHsbcCashAfter = Number(
                (
                    hasWindowedAvailableCash
                        ? txn?.source?.available_cash_after_raw
                        : undefined
                )
                ?? settlementBalanceAfter
                ?? bankBalanceAfter
            );
            if (
                runtime.normalizeInvestmentBroker(brokerCode) === 'hsbc'
                && Number.isFinite(authoritativeHsbcCashAfter)
            ) {
                applyAuthoritativeCashBalance(
                    brokerLedgerState,
                    authoritativeHsbcCashAfter,
                    transactionCurrency,
                    ledgerDate,
                    txn,
                );
                if (cashBoundary) {
                    rebuildAggregateCashState(ledgerDate);
                } else if (isSingleBrokerPortfolio) {
                    applyAuthoritativeCashBalance(
                        aggregateLedgerState,
                        authoritativeHsbcCashAfter,
                        transactionCurrency,
                        ledgerDate,
                        txn,
                    );
                } else {
                    rebuildAggregateCashState(ledgerDate);
                }
            }
            const authoritativeBrokerCash = runtime.normalizeInvestmentBroker(brokerCode) === 'hsbc'
                ? Number(runtime.getInvestmentBrokerEndingCashInBaseCurrency(brokerCode))
                : Number.NaN;
            const brokerRunningCashForRow = (
                shouldReplayPendingSettlement
                && Number.isFinite(authoritativeBrokerCash)
            )
                ? authoritativeBrokerCash
                : brokerLedgerState.runningCash;
            const normalizedBrokerCashForDisplay = runtime.normalizeInvestmentBroker(brokerCode) === 'hsbc'
                ? brokerRunningCashForRow + brokerPendingSettlementCashForRow
                : Number(brokerRunningCashForRow);
            const aggregateDisplayCash = aggregateLedgerState.runningCash + sourceBoundedPendingSettlementCashForRow;
            const aggregateCashByCurrency = runtime.cloneCashLedgerBalances(aggregateLedgerState.cashBalances);
            const brokerCashByCurrency = runtime.cloneCashLedgerBalances(brokerLedgerState.cashBalances);
            return {
                ...txn,
                broker: brokerCode,
                ledger_no: processedIndex + 1,
                running_cash: aggregateLedgerState.runningCash,
                cash_by_currency: aggregateCashByCurrency,
                display_amount: runtime.getTransactionEconomicAmount(txn),
                holdings: { ...aggregateLedgerState.holdings },
                money_market_anchors: { ...aggregateLedgerState.moneyMarketAnchors },
                aggregate_running_cash: aggregateLedgerState.runningCash,
                aggregate_display_cash: aggregateDisplayCash,
                aggregate_cash_by_currency: aggregateCashByCurrency,
                aggregate_pending_settlement_cash: sourceBoundedPendingSettlementCashForRow,
                aggregate_holdings: { ...aggregateLedgerState.holdings },
                aggregate_money_market_anchors: { ...aggregateLedgerState.moneyMarketAnchors },
                broker_running_cash: brokerRunningCashForRow,
                broker_display_cash: normalizedBrokerCashForDisplay,
                broker_cash_by_currency: brokerCashByCurrency,
                broker_pending_settlement_cash: brokerPendingSettlementCashForRow,
                broker_holdings: { ...brokerLedgerState.holdings },
                broker_money_market_anchors: { ...brokerLedgerState.moneyMarketAnchors },
            };
        });
        processed.forEach((txn, processedIndex) => {
            Object.defineProperty(txn, runtime.INVESTMENT_REPLAY_ORDER_SYMBOL, {
                configurable: true,
                enumerable: false,
                value: processedIndex,
                writable: false,
            });
            Object.defineProperty(txn, 'calculated_broker_holdings', {
                configurable: true,
                enumerable: false,
                value: {...(txn.broker_holdings || {})},
                writable: true,
            });
            Object.defineProperty(txn, 'calculated_broker_cash_by_currency', {
                configurable: true,
                enumerable: false,
                value: {...(txn.broker_cash_by_currency || {})},
                writable: true,
            });
        });

        const authoritativePositionSnapshot = runtime.getAuthoritativePositionSnapshotForTransactions(
            orderedTransactions,
        );
        // Get latest price from parquet (last available close) for final valuation
        const latestPrices = {};
        Object.entries(tickerClosePrices).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            if (dates.length > 0) {
                latestPrices[ticker] = dateMap[dates[dates.length - 1]];
            }
        });
        Object.entries(lastKnownTickerPrices).forEach(([ticker, price]) => {
            if (!Number.isFinite(latestPrices[ticker]) && Number.isFinite(price)) {
                latestPrices[ticker] = price;
            }
        });
        if (authoritativePositionSnapshot !== null) {
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const snapshotLastPrice = Number(snapshot?.lastPrice);
                if (Number.isFinite(snapshotLastPrice) && snapshotLastPrice > 0) {
                    latestPrices[ticker] = snapshotLastPrice;
                }
            });
        }

        // 2. For each transaction, get the closest available close price on or before the transaction date
        //    and calculate total equity = cash + sum(holdings * historical close price)
        const missingTickers = new Set();
        function calculateTransactionMarketValue(txn, holdingsSnapshot, moneyMarketAnchorSnapshot) {
            let marketValue = 0;
            let isComplete = true;
            const valuationMissingTickers = new Set();
            Object.entries(holdingsSnapshot || {}).forEach(([ticker, quantity]) => {
                const normalizedTicker = String(ticker).trim().toUpperCase();
                if (runtime.isForexPairTicker(normalizedTicker)) return;
                const isMoneyMarketTicker = (
                    moneyMarketTickers.has(normalizedTicker)
                    || runtime.isSyntheticCashEquivalentTicker(normalizedTicker)
                );
                const valuationDate = runtime.normalizeLedgerDate(txn.date);
                let closePrice = runtime.getIndexedClosePriceOnOrBefore(tickerPriceIndex[normalizedTicker], valuationDate);
                if (isMoneyMarketTicker) {
                    const transactionValuationTicker = runtime.isUsmartHkFractionalSharesTransaction(txn)
                        ? runtime.USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                        : runtime.getInvestmentCanonicalTicker(txn.ticker);
                    const sameDaySellPrice = normalizedTicker === transactionValuationTicker
                        && runtime.getNormalizedTransactionType(txn) === 'sell'
                        ? runtime.getTransactionPrice(txn)
                        : null;
                    const anchoredPrice = moneyMarketAnchorSnapshot?.[ticker] ?? moneyMarketAnchorSnapshot?.[normalizedTicker];
                    closePrice = sameDaySellPrice ?? anchoredPrice ?? closePrice;
                }
                const intradayClose = transactionIntradayClosePrices.get(`${normalizedTicker}|${valuationDate}`);
                if (!isMoneyMarketTicker && Number.isFinite(intradayClose) && intradayClose > 0) {
                    closePrice = intradayClose;
                }
                if (!Number.isFinite(closePrice) || closePrice <= 0) {
                    isComplete = false;
                    valuationMissingTickers.add(normalizedTicker);
                    missingTickers.add(normalizedTicker);
                    return;
                }
                const quoteCurrency = runtime.getTickerQuoteCurrency(ticker);
                marketValue += runtime.convertAmountToBaseCurrency(
                    quantity * closePrice,
                    quoteCurrency,
                    valuationDate,
                    fxTimeline,
                    baseCurrency,
                );
            });
            return {
                marketValue,
                isComplete,
                missingTickers: Array.from(valuationMissingTickers).sort(),
            };
        }

        processed.forEach((txn) => {
            const aggregateHoldings = txn.aggregate_holdings || txn.holdings || {};
            const aggregateMoneyMarketAnchors = txn.aggregate_money_market_anchors || txn.money_market_anchors || {};
            const aggregateRunningCash = Number(txn.aggregate_running_cash ?? txn.running_cash);
            const aggregatePendingSettlementCash = Number(txn.aggregate_pending_settlement_cash) || 0;
            const aggregateDisplayCash = Number.isFinite(Number(txn.aggregate_display_cash))
                ? Number(txn.aggregate_display_cash)
                : aggregateRunningCash + aggregatePendingSettlementCash;
            const brokerHoldings = txn.broker_holdings || {};
            const brokerMoneyMarketAnchors = txn.broker_money_market_anchors || {};
            const brokerRunningCash = Number(txn.broker_running_cash);
            const brokerPendingSettlementCash = Number(txn.broker_pending_settlement_cash) || 0;
            const brokerDisplayCash = Number.isFinite(Number(txn.broker_display_cash))
                ? Number(txn.broker_display_cash)
                : brokerRunningCash + brokerPendingSettlementCash;
            const aggregateValuation = calculateTransactionMarketValue(txn, aggregateHoldings, aggregateMoneyMarketAnchors);
            const brokerValuation = calculateTransactionMarketValue(txn, brokerHoldings, brokerMoneyMarketAnchors);
            const aggregateMarketValue = aggregateValuation.isComplete ? aggregateValuation.marketValue : null;
            const brokerMarketValue = brokerValuation.isComplete ? brokerValuation.marketValue : null;

            txn.aggregate_market_value = aggregateMarketValue;
            txn.aggregate_total_equity = Number.isFinite(aggregateMarketValue)
                ? aggregateDisplayCash + aggregateMarketValue
                : null;
            txn.broker_market_value = brokerMarketValue;
            txn.broker_total_equity = Number.isFinite(brokerMarketValue)
                ? brokerDisplayCash + brokerMarketValue
                : null;

            txn.market_value = aggregateMarketValue;
            txn.total_equity = txn.aggregate_total_equity;
            txn.valuation_complete = aggregateValuation.isComplete && brokerValuation.isComplete;
            txn.missing_price_tickers = Array.from(new Set([
                ...aggregateValuation.missingTickers,
                ...brokerValuation.missingTickers,
            ])).sort();
        });
        function reverseBrokerPositionForTransaction(holdings, txn) {
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const isSyntheticFractional = runtime.isUsmartHkFractionalSharesTransaction(txn);
            if (!txn?.ticker && !isSyntheticFractional) return;
            const rawTicker = isSyntheticFractional
                ? runtime.USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
                : String(txn.ticker).trim().toUpperCase();
            const normalizedTicker = runtime.getInvestmentCanonicalTicker(rawTicker);
            if (!normalizedTicker || runtime.isForexPairTicker(normalizedTicker)) return;
            const quantity = Number(
                runtime.getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints),
            );
            if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9) return;
            let positionDelta = 0;
            if (['buy', 'dividend_reinvestment', 'grant', 'transfer_in'].includes(normalizedType)) {
                positionDelta = -quantity;
            } else if (['sell', 'transfer_out'].includes(normalizedType)) {
                positionDelta = quantity;
            }
            if (Math.abs(positionDelta) < 1e-9) return;
            const nextQuantity = (Number(holdings[normalizedTicker]) || 0) + positionDelta;
            if (Math.abs(nextQuantity) < 1e-9) {
                delete holdings[normalizedTicker];
            } else {
                holdings[normalizedTicker] = nextQuantity;
            }
        }

        function applyAuthoritativeBrokerPositionSnapshots(processedTransactions = []) {
            authoritativeBrokerPositionSnapshots.forEach((snapshot, brokerCode) => {
                const brokerRows = processedTransactions.filter((txn) => (
                    runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === brokerCode
                ));
                if (!brokerRows.length) return;
                const positionSnapshotAsOf = runtime.getInvestmentBrokerPositionSnapshotAsOf(brokerCode);
                const latestBrokerDate = runtime.normalizeLedgerDate(brokerRows[brokerRows.length - 1]?.date);
                if (positionSnapshotAsOf && latestBrokerDate && latestBrokerDate < positionSnapshotAsOf) {
                    return;
                }
                const holdings = {};
                Object.entries(snapshot).forEach(([ticker, position]) => {
                    const quantity = Number(position?.quantity);
                    const normalizedTicker = runtime.getInvestmentCanonicalTicker(ticker);
                    if (normalizedTicker && Number.isFinite(quantity) && Math.abs(quantity) > 1e-9) {
                        holdings[normalizedTicker] = quantity;
                    }
                });
                const latestBrokerRow = brokerRows[brokerRows.length - 1];
                for (let rowIndex = brokerRows.length - 1; rowIndex >= 0; rowIndex -= 1) {
                    const txn = brokerRows[rowIndex];
                    const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
                    if (positionSnapshotAsOf && ledgerDate && ledgerDate < positionSnapshotAsOf) break;
                    const isPendingSettlementRow = (
                        brokerCode === 'hsbc'
                        && runtime.isHsbcSettlementActuallyPending(txn?.source)
                    );
                    if (txn === latestBrokerRow || isPendingSettlementRow) {
                        const virtualHoldings = { ...holdings };
                        const valuation = calculateTransactionMarketValue(
                            txn,
                            virtualHoldings,
                            txn.broker_money_market_anchors || {},
                        );
                        const marketValue = valuation.isComplete ? valuation.marketValue : null;
                        txn.broker_holdings = virtualHoldings;
                        txn.broker_market_value = marketValue;
                        const displayCash = Number(
                            txn.broker_display_cash
                            ?? txn.broker_running_cash,
                        );
                        if (Number.isFinite(displayCash) && Number.isFinite(marketValue)) {
                            txn.broker_total_equity = displayCash + marketValue;
                        }
                        txn.broker_balance_source = isPendingSettlementRow
                            ? 'hsbc_authoritative_position_snapshot_pending_projection'
                            : 'authoritative_position_snapshot';
                    }
                    reverseBrokerPositionForTransaction(holdings, txn);
                }
            });

            if (!authoritativeBrokerPositionSnapshots.size || !processedTransactions.length) return;
            const latestHoldingsByBroker = new Map();
            processedTransactions.forEach((txn) => {
                latestHoldingsByBroker.set(
                    runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)),
                    txn?.broker_holdings || {},
                );
            });
            const aggregateHoldings = {};
            latestHoldingsByBroker.forEach((holdings) => {
                Object.entries(holdings || {}).forEach(([ticker, quantity]) => {
                    const canonicalTicker = runtime.getInvestmentCanonicalTicker(ticker);
                    const numericQuantity = Number(quantity);
                    if (!canonicalTicker || !Number.isFinite(numericQuantity)) return;
                    aggregateHoldings[canonicalTicker] = (
                        Number(aggregateHoldings[canonicalTicker]) || 0
                    ) + numericQuantity;
                    if (Math.abs(aggregateHoldings[canonicalTicker]) < 1e-9) {
                        delete aggregateHoldings[canonicalTicker];
                    }
                });
            });
            const latestProcessed = processedTransactions[processedTransactions.length - 1];
            latestProcessed.holdings = {...aggregateHoldings};
            latestProcessed.aggregate_holdings = {...aggregateHoldings};
            const aggregateValuation = calculateTransactionMarketValue(
                latestProcessed,
                aggregateHoldings,
                latestProcessed.aggregate_money_market_anchors || {},
            );
            latestProcessed.market_value = aggregateValuation.isComplete
                ? aggregateValuation.marketValue
                : null;
            latestProcessed.aggregate_market_value = latestProcessed.market_value;
            const aggregateDisplayCash = Number(
                latestProcessed.aggregate_display_cash
                ?? latestProcessed.aggregate_running_cash
                ?? latestProcessed.running_cash,
            );
            latestProcessed.total_equity = (
                Number.isFinite(aggregateDisplayCash)
                && Number.isFinite(latestProcessed.market_value)
            )
                ? aggregateDisplayCash + latestProcessed.market_value
                : null;
            latestProcessed.aggregate_total_equity = latestProcessed.total_equity;
            if (isSingleBrokerPortfolio) {
                latestProcessed.broker_holdings = {...aggregateHoldings};
            }
        }

        const {
            getHsbcSettlementScopeKey,
            isAuthoritativeHsbcCashTransaction,
            addCashBalanceCorrection,
            applyCashBalanceCorrection,
            getCashCorrectionInBaseCurrency,
            getAdjustedReplayCash,
            buildHsbcSettlementReplaySnapshots,
            getHsbcHistorySettlementCashBoundary,
            setHsbcHistoryCashBoundary,
            getHsbcHistorySettlementCashDeltas,
            applyHsbcHistoryPresentationProjection,
            roundInvestmentHistoryCash,
            getInvestmentHistoryCashScopeKey,
            applyIbkrHistoryPresentationProjection,
            applyAuthoritativeCurrentBrokerHistoryBoundary,
        } = createInvestmentHistoryProjectionRuntime(runtime, {
            baseCurrency,
            calculateInvestmentCashDelta,
            cashFundingAdjustments,
            fxTimeline,
        });

        runtime.applyAuthoritativeBrokerEndingCashBalances(processed);
        applyAuthoritativeBrokerPositionSnapshots(processed);
        runtime.applyInvestmentInternalTransferBindings(processed);
        applyHsbcHistoryPresentationProjection(processed);
        applyIbkrHistoryPresentationProjection(processed);
        runtime.applyAuthoritativeCurrentAggregateCash(processed, fxTimeline, runtime.getTodayLedgerDate());

        const hsbcSettlementReplaySnapshots = buildHsbcSettlementReplaySnapshots(
            processed,
            hsbcCashSettlementBoundaryPlan,
        );
        applyAuthoritativeCurrentBrokerHistoryBoundary(processed);
        // Accrued interest is a separate NAV component. Apply it last so no
        // later cash or position projection can overwrite or double count it.
        runtime.applyInvestmentInterestAccrualBoundaries(processed, {
            fxTimeline,
            baseCurrency,
            getBrokerCode: (txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)),
        });

        Object.keys(latestPrices).forEach((ticker) => {
            if (moneyMarketTickers.has(String(ticker).trim().toUpperCase())) {
                const lastProcessedWithAnchor = [...processed].reverse().find((txn) => (
                    txn.money_market_anchors?.[ticker] !== undefined
                ));
                if (lastProcessedWithAnchor) {
                    latestPrices[ticker] = lastProcessedWithAnchor.money_market_anchors[ticker];
                }
            }
        });

        const latestSnapshot = processed[processed.length - 1];
        let chartPoints = aggregateSecurityTransferState.blocked
            ? []
            : runtime.buildDailyEquityChartPoints(
                processed,
                tickerClosePrices,
                moneyMarketTickers,
                {
                    includeCalendarDays: runtime.isInvestmentDailyEquityLiveRange(),
                    replaySnapshots: hsbcSettlementReplaySnapshots,
                },
            );
        runtime.state.investmentBaseChartPointsCache = Array.isArray(chartPoints) ? [...chartPoints] : [];
        runtime.state.investmentChartPointsCache = runtime.isInvestmentDailyEquityLiveRange()
            ? runtime.ensureInvestmentLiveSessionChartSlot(runtime.state.investmentBaseChartPointsCache)
            : [...runtime.state.investmentBaseChartPointsCache];
        runtime.state.investmentProcessedTransactionsCache = Array.isArray(processed) ? processed : [];
        runtime.state.investmentReplaySnapshotsCache = Array.isArray(hsbcSettlementReplaySnapshots)
            ? hsbcSettlementReplaySnapshots
            : runtime.state.investmentProcessedTransactionsCache;
        runtime.refreshInvestmentAvailableBrokerCodes();
        runtime.state.investmentBaseLatestPricesCache = latestPrices && typeof latestPrices === 'object' ? { ...latestPrices } : {};
        runtime.state.investmentLatestPricesCache = latestPrices && typeof latestPrices === 'object' ? { ...latestPrices } : {};
        runtime.investmentRealtimeQuotesByTicker.clear();
        runtime.investmentOverviewRealtimeLinePointsByMinute.clear();
        runtime.state.investmentChartPnlMetricsByPoint = new WeakMap();
        runtime.state.investmentChartPnlTickerPriceIndex = null;
        runtime.cancelInvestmentChartPnlResolution();
        runtime.state.investmentOverviewIntradayLinePointsCache = {
            key: '',
            points: [],
            quality: null,
        };
        runtime.state.investmentOverviewIntradayRenderSerial += 1;

        // Use server-preloaded realtime quotes (now using efficient batched yfinance download)
        // for immediate render. The additional client-side bootstrap (for freshest possible)
        // is fired without await so a large number of holdings after IBKR import does not
        // block the UI / import completion feedback.
        const embeddedQuotes = runtime.getInvestmentEmbeddedRealtimeQuotes();
        const bootstrapRealtimeQuotes = runtime.mergeInvestmentRealtimeQuotePayloads(embeddedQuotes);
        runtime.rememberInvestmentRealtimeQuotes(bootstrapRealtimeQuotes);
        const bootstrapSessionQuotes = aggregateSecurityTransferState.blocked
            ? []
            : bootstrapRealtimeQuotes.filter((quote) => runtime.shouldApplyInvestmentRealtimePriceForHoldings(quote));
        if (bootstrapSessionQuotes.length) {
            runtime.applyInvestmentSessionRealtimePrices(latestPrices, bootstrapSessionQuotes);
            if (runtime.isInvestmentDailyEquityLiveRange()) {
                const liveChartPoints = runtime.buildInvestmentRealtimeChartPoints(bootstrapSessionQuotes);
                if (liveChartPoints.length) {
                    chartPoints = liveChartPoints;
                    runtime.state.investmentChartPointsCache = [...liveChartPoints];
                }
            } else {
                const liveChartPoints = runtime.buildInvestmentRealtimeChartPoints(bootstrapSessionQuotes);
                const latestRealtimePoint = [...liveChartPoints]
                    .reverse()
                    .find((point) => point?.is_realtime === true) || null;
                runtime.rememberInvestmentOverviewRealtimeLinePoint(latestRealtimePoint);
            }
        }

        // Fire-and-forget fresher quotes (using efficient batched yfinance).
        // The main render uses the server-preloaded quotes so import doesn't block on this.
        // Subsequent poll / interactions will pick up fresher data via caches.
        const realtimeBootstrap = aggregateSecurityTransferState.blocked
            ? Promise.resolve([])
            : runtime.bootstrapInvestmentSessionRealtimeQuotes(latestSnapshot);
        realtimeBootstrap.then((fresh) => {
            const merged = runtime.mergeInvestmentRealtimeQuotePayloads(embeddedQuotes, fresh);
            runtime.rememberInvestmentRealtimeQuotes(merged);
            runtime.syncInvestmentStockDetailsLivePulse();
            const sessionQuotes = merged.filter((quote) => runtime.shouldApplyInvestmentRealtimePriceForHoldings(quote));
            if (sessionQuotes.length) {
                runtime.applyInvestmentSessionRealtimePrices(latestPrices, sessionQuotes);
                runtime.syncInvestmentHoldingsRealtimeValues();
                if (runtime.isInvestmentDailyEquityLiveRange()) {
                    const livePoints = runtime.buildInvestmentRealtimeChartPoints(sessionQuotes);
                    if (livePoints.length) {
                        runtime.state.investmentChartPointsCache = [...livePoints];
                    }
                } else {
                    const livePoints = runtime.buildInvestmentRealtimeChartPoints(sessionQuotes);
                    const latestRealtimePoint = [...livePoints]
                        .reverse()
                        .find((point) => point?.is_realtime === true) || null;
                    runtime.rememberInvestmentOverviewRealtimeLinePoint(latestRealtimePoint);
                }
            }
        }).catch((err) => {
            if (!runtime.isLifecycleInterruptedFetch(err)) {
                console.warn('Post-import realtime bootstrap failed', err);
            }
        });

        const valuationStatus = runtime.buildValuationStatus({
            backendFailures: priceHistoryFailures,
            fallbackTickers: [],
            missingTickers: Array.from(missingTickers),
            openTickers: window.WORTHWARD_INVESTMENT_DATA?.section_freshness?.open_tickers || [],
        });

        // 3. Render reverse chronological rows constrained by the active equity range
        if (!preserveHistoryPage) {
            runtime.initializeInvestmentBrokerFilterSelection();
        }
        runtime.mountInvestmentBrokerFilterHeaders();
        runtime.mountInvestmentSideFilterHeaders();
        runtime.mountInvestmentCurrencyFilterHeaders();
        runtime.mountInvestmentDescriptionBindingFilterHeaders();

        // 4. Update dashboard with latest total equity
        const dashboardChartPoints = runtime.updateDashboardWithEquity(
            processed,
            latestSnapshot,
            latestPrices,
            transactions,
            chartPoints,
            tickerClosePrices,
        );
        runtime.renderInvestmentHistoryTableRows(
            processed,
            chartPoints,
            {resetPage: !preserveHistoryPage, scrollToTop},
        );
        if (!aggregateSecurityTransferState.blocked) {
            runtime.restartInvestmentRealtimeQuotePolling();
        }
        return valuationStatus;
    }

    return {
        renderTransactionTable,
    };
}
