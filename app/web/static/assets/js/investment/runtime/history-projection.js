/**
 * Investment transaction-history cash projection and broker-boundary helpers.
 *
 * Code version: v1.0.0
 * - Added: Isolated replay projections from the transaction-table renderer.
 */

export function createInvestmentHistoryProjectionRuntime(runtime, context) {
function getHsbcSettlementScopeKey(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const brokerCode = runtime.normalizeInvestmentBroker(
                txn?.broker || source.broker || runtime.getTransactionBrokerCode(txn),
            );
            const account = String(
                txn?.account || source.account || source.account_number || '',
            ).trim();
            return `${brokerCode}|${account}`;
        }

function isAuthoritativeHsbcCashTransaction(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const balanceAfter = Number(source.balance_after_raw);
            return (
                brokerCode === 'hsbc'
                && !['buy', 'sell'].includes(normalizedType)
                && Number.isFinite(balanceAfter)
                && (
                    source.cash_balance_authoritative === true
                    || String(source.file_kind || '').trim().toLowerCase() === 'hsbc_usd_account_text'
                )
            );
        }

function addCashBalanceCorrection(targetBalances, correctionBalances) {
            const nextBalances = runtime.cloneCashLedgerBalances(targetBalances || {});
            Object.entries(correctionBalances || {}).forEach(([currency, value]) => {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue) || Math.abs(numericValue) <= 1e-9) return;
                const normalizedCurrency = String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
                const nextValue = (Number(nextBalances[normalizedCurrency]) || 0) + numericValue;
                if (Math.abs(nextValue) <= 1e-9) {
                    delete nextBalances[normalizedCurrency];
                } else {
                    nextBalances[normalizedCurrency] = nextValue;
                }
            });
            return nextBalances;
        }

function applyCashBalanceCorrection(targetBalances, currency, amount) {
            const numericAmount = Number(amount);
            if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) <= 1e-9) return;
            const normalizedCurrency = String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
            const nextValue = (Number(targetBalances[normalizedCurrency]) || 0) + numericAmount;
            if (Math.abs(nextValue) <= 1e-9) {
                delete targetBalances[normalizedCurrency];
            } else {
                targetBalances[normalizedCurrency] = nextValue;
            }
        }

function getCashCorrectionInBaseCurrency(correctionBalances, ledgerDate) {
            return runtime.sumCashLedgerInBaseCurrency(
                correctionBalances || {},
                ledgerDate,
                context.fxTimeline,
                context.baseCurrency,
            );
        }

function getAdjustedReplayCash(
            rawCash,
            rawBalances,
            correctionBalances,
            ledgerDate,
        ) {
            const normalizedRawCash = Number(rawCash) || 0;
            const balances = rawBalances && typeof rawBalances === 'object'
                ? rawBalances
                : {};
            if (Object.keys(balances).length) {
                return runtime.sumCashLedgerInBaseCurrency(
                    addCashBalanceCorrection(balances, correctionBalances),
                    ledgerDate,
                    context.fxTimeline,
                    context.baseCurrency,
                );
            }
            return normalizedRawCash + getCashCorrectionInBaseCurrency(correctionBalances, ledgerDate);
        }

function buildHsbcSettlementReplaySnapshots(canonicalTransactions, settlementBoundaries) {
            const transactionsForReplay = Array.isArray(canonicalTransactions)
                ? canonicalTransactions
                : [];
            const boundariesForReplay = Array.isArray(settlementBoundaries)
                ? settlementBoundaries
                : [];
            if (!boundariesForReplay.length) return transactionsForReplay;

            const brokerCorrectionsByCode = new Map();
            const aggregateCorrectionsByCurrency = {};
            const brokerSettlementAccrualsByCode = new Map();
            const aggregateSettlementAccrualsByCurrency = {};
            const settlementAccrualsByOwnerTransactionIndex = new Map();
            const latestRawBrokerBalances = new Map();
            let latestRawAggregateBalances = {};
            let activeTransaction = null;
            let replaySnapshotOrder = 0;
            const snapshots = [];

            boundariesForReplay.forEach((boundary) => {
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
                if (!settlementAccrualsByOwnerTransactionIndex.has(ownerTransactionIndex)) {
                    settlementAccrualsByOwnerTransactionIndex.set(ownerTransactionIndex, []);
                }
                settlementAccrualsByOwnerTransactionIndex.get(ownerTransactionIndex).push(boundary);
            });

            const getBrokerCorrections = (brokerCode) => {
                const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
                if (!brokerCorrectionsByCode.has(normalizedBrokerCode)) {
                    brokerCorrectionsByCode.set(normalizedBrokerCode, {});
                }
                return brokerCorrectionsByCode.get(normalizedBrokerCode);
            };
            const getBrokerSettlementAccruals = (brokerCode) => {
                const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
                if (!brokerSettlementAccrualsByCode.has(normalizedBrokerCode)) {
                    brokerSettlementAccrualsByCode.set(normalizedBrokerCode, {});
                }
                return brokerSettlementAccrualsByCode.get(normalizedBrokerCode);
            };
            const applyCorrection = (balances, currency, amount) => {
                const numericAmount = Number(amount);
                if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) <= 1e-9) return;
                const normalizedCurrency = String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
                const nextValue = (Number(balances[normalizedCurrency]) || 0) + numericAmount;
                if (Math.abs(nextValue) <= 1e-9) {
                    delete balances[normalizedCurrency];
                } else {
                    balances[normalizedCurrency] = nextValue;
                }
            };
            const resetBrokerCurrencyCorrection = (brokerCode, currency) => {
                const corrections = getBrokerCorrections(brokerCode);
                const normalizedCurrency = String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
                const existingCorrection = Number(corrections[normalizedCurrency]) || 0;
                if (Math.abs(existingCorrection) <= 1e-9) return;
                delete corrections[normalizedCurrency];
                applyCorrection(aggregateCorrectionsByCurrency, normalizedCurrency, -existingCorrection);
            };
            const buildSnapshotFromTransaction = (
                txn,
                ledgerDate,
                {isSettlementBoundary = false} = {},
            ) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                // The current holdings snapshot is an authoritative balance
                // boundary. Historical settlement corrections model the path
                // to that boundary, but must not be applied on top of the
                // already-authoritative balances or the final equity is
                // double-counted.
                const isAuthoritativeCurrentCashSnapshot = (
                    txn?.authoritative_current_cash_snapshot === true
                );
                const aggregateCorrections = isAuthoritativeCurrentCashSnapshot
                    ? {}
                    : aggregateCorrectionsByCurrency;
                const brokerCorrections = isAuthoritativeCurrentCashSnapshot
                    ? {}
                    : getBrokerCorrections(brokerCode);
                const aggregateSettlementAccruals = isAuthoritativeCurrentCashSnapshot
                    ? {}
                    : aggregateSettlementAccrualsByCurrency;
                const brokerSettlementAccruals = isAuthoritativeCurrentCashSnapshot
                    ? {}
                    : getBrokerSettlementAccruals(brokerCode);
                const rawAggregateBalances = latestRawAggregateBalances;
                const rawBrokerBalances = isAuthoritativeCurrentCashSnapshot
                    ? (txn?.broker_cash_by_currency || txn?.calculated_broker_cash_by_currency || {})
                    : (latestRawBrokerBalances.get(brokerCode)
                    || txn?.calculated_broker_cash_by_currency
                    || txn?.broker_cash_by_currency
                    || {});
                const rawAggregateRunningCash = Number(
                    txn?.aggregate_running_cash ?? txn?.running_cash,
                ) || 0;
                const rawAggregateDisplayCash = Number.isFinite(Number(txn?.aggregate_display_cash))
                    ? Number(txn.aggregate_display_cash)
                    : rawAggregateRunningCash + (Number(txn?.aggregate_pending_settlement_cash) || 0);
                const rawBrokerRunningCash = Number(txn?.broker_running_cash);
                const rawBrokerDisplayCash = Number.isFinite(Number(txn?.broker_display_cash))
                    ? Number(txn.broker_display_cash)
                    : rawBrokerRunningCash + (Number(txn?.broker_pending_settlement_cash) || 0);
                const rawAggregatePendingSettlementCash = Number(txn?.aggregate_pending_settlement_cash) || 0;
                const rawBrokerPendingSettlementCash = Number(txn?.broker_pending_settlement_cash) || 0;
                const aggregateSettlementAccrualCash = getCashCorrectionInBaseCurrency(
                    aggregateSettlementAccruals,
                    ledgerDate,
                );
                const brokerSettlementAccrualCash = getCashCorrectionInBaseCurrency(
                    brokerSettlementAccruals,
                    ledgerDate,
                );
                const adjustedAggregatePendingSettlementCash = rawAggregatePendingSettlementCash
                    + aggregateSettlementAccrualCash;
                const adjustedBrokerPendingSettlementCash = rawBrokerPendingSettlementCash
                    + brokerSettlementAccrualCash;
                const adjustedAggregateRunningCash = getAdjustedReplayCash(
                    rawAggregateRunningCash,
                    rawAggregateBalances,
                    aggregateCorrections,
                    ledgerDate,
                );
                const adjustedBrokerRunningCash = getAdjustedReplayCash(
                    rawBrokerRunningCash,
                    rawBrokerBalances,
                    brokerCorrections,
                    ledgerDate,
                );
                const aggregateCashAdjustment = adjustedAggregateRunningCash - rawAggregateRunningCash;
                const brokerCashAdjustment = adjustedBrokerRunningCash - rawBrokerRunningCash;
                const aggregateHistoryRunningCash = Number.isFinite(Number(txn?.aggregate_history_running_cash))
                    ? adjustedAggregateRunningCash
                        + (Number(txn.aggregate_history_running_cash) - rawAggregateRunningCash)
                    : adjustedAggregateRunningCash;
                const replayAggregateDisplayCash = isSettlementBoundary
                    ? adjustedAggregateRunningCash + adjustedAggregatePendingSettlementCash
                    : rawAggregateDisplayCash + aggregateCashAdjustment + aggregateSettlementAccrualCash;
                const aggregateHistoryDisplayCash = Number.isFinite(Number(txn?.aggregate_history_display_cash))
                    ? replayAggregateDisplayCash
                        + (Number(txn.aggregate_history_display_cash) - rawAggregateDisplayCash)
                    : replayAggregateDisplayCash;
                const aggregateDisplayCash = replayAggregateDisplayCash;
                const brokerDisplayCash = isSettlementBoundary
                    ? adjustedBrokerRunningCash + adjustedBrokerPendingSettlementCash
                    : rawBrokerDisplayCash + brokerCashAdjustment + brokerSettlementAccrualCash;
                const sharedSnapshotFields = {
                    date: ledgerDate,
                    datetime: isSettlementBoundary
                        ? `${ledgerDate} 23:59:00.${String(replaySnapshotOrder).padStart(4, '0')}`
                        : txn?.datetime,
                    replay_snapshot_order: replaySnapshotOrder,
                    aggregate_running_cash: adjustedAggregateRunningCash,
                    aggregate_display_cash: aggregateDisplayCash,
                    aggregate_history_running_cash: aggregateHistoryRunningCash,
                    aggregate_history_display_cash: aggregateHistoryDisplayCash,
                    aggregate_cash_by_currency: addCashBalanceCorrection(
                        rawAggregateBalances,
                        aggregateCorrections,
                    ),
                    aggregate_pending_settlement_cash: adjustedAggregatePendingSettlementCash,
                    aggregate_holdings: { ...(txn?.aggregate_holdings || txn?.holdings || {}) },
                    aggregate_money_market_anchors: {
                        ...(txn?.aggregate_money_market_anchors || txn?.money_market_anchors || {}),
                    },
                    running_cash: adjustedAggregateRunningCash,
                    cash_by_currency: addCashBalanceCorrection(
                        rawAggregateBalances,
                        aggregateCorrections,
                    ),
                    holdings: { ...(txn?.aggregate_holdings || txn?.holdings || {}) },
                    money_market_anchors: {
                        ...(txn?.aggregate_money_market_anchors || txn?.money_market_anchors || {}),
                    },
                    broker_running_cash: adjustedBrokerRunningCash,
                    broker_display_cash: brokerDisplayCash,
                    broker_cash_by_currency: addCashBalanceCorrection(rawBrokerBalances, brokerCorrections),
                    broker_pending_settlement_cash: adjustedBrokerPendingSettlementCash,
                    broker_holdings: { ...(txn?.broker_holdings || {}) },
                    broker_money_market_anchors: { ...(txn?.broker_money_market_anchors || {}) },
                };
                if (isSettlementBoundary) {
                    return {
                        ...sharedSnapshotFields,
                        replay_snapshot_kind: 'hsbc_cash_settlement_boundary',
                    };
                }
                return {
                    ...txn,
                    ...sharedSnapshotFields,
                };
            };

            const replayEvents = [
                ...transactionsForReplay.map((txn, index) => ({
                    kind: 'transaction',
                    date: runtime.normalizeLedgerDate(txn?.date),
                    index,
                    txn,
                })),
                ...boundariesForReplay.map((boundary, index) => ({
                    kind: 'boundary',
                    date: runtime.normalizeLedgerDate(boundary?.date),
                    index,
                    boundary,
                })),
            ].filter((event) => event.date).sort((left, right) => {
                if (left.date !== right.date) return left.date.localeCompare(right.date);
                if (left.kind === 'boundary' && right.kind === 'boundary') {
                    const leftBoundary = left.boundary || {};
                    const rightBoundary = right.boundary || {};
                    const sameSettlementScope = (
                        runtime.normalizeInvestmentBroker(leftBoundary.broker || 'hsbc')
                            === runtime.normalizeInvestmentBroker(rightBoundary.broker || 'hsbc')
                        && String(leftBoundary.account || '').trim()
                            === String(rightBoundary.account || '').trim()
                        && String(leftBoundary.currency || context.baseCurrency).trim().toUpperCase()
                            === String(rightBoundary.currency || context.baseCurrency).trim().toUpperCase()
                    );
                    if (sameSettlementScope && left.index !== right.index) {
                        return left.index - right.index;
                    }
                }
                const getCashEvidenceSequence = (event) => {
                    if (event.kind === 'boundary') {
                        const boundary = event.boundary || {};
                        const sequence = Number(boundary.sourceRowSequence);
                        return {
                            broker: runtime.normalizeInvestmentBroker(boundary.broker || 'hsbc'),
                            account: String(boundary.account || '').trim(),
                            sequence: Number.isFinite(sequence) && sequence > 0 ? sequence : null,
                            sourceFileKind: String(boundary.sourceFileKind || '').trim().toLowerCase(),
                        };
                    }
                    const txn = event.txn || {};
                    const source = txn.source && typeof txn.source === 'object' ? txn.source : {};
                    const sourceFileKind = String(source.file_kind || '').trim().toLowerCase();
                    const sequence = Number(source.ledger_sequence ?? source.row_number);
                    const isHsbcCashEvidence = (
                        runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === 'hsbc'
                        && !['buy', 'sell'].includes(runtime.getNormalizedTransactionType(txn))
                        && sourceFileKind.startsWith('hsbc_')
                        && sourceFileKind.includes('cash')
                    );
                    return {
                        broker: runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)),
                        account: String(txn.account || source.account || source.account_number || '').trim(),
                        sequence: isHsbcCashEvidence && Number.isFinite(sequence) && sequence > 0
                            ? sequence
                            : null,
                        sourceFileKind,
                    };
                };
                const leftEvidence = getCashEvidenceSequence(left);
                const rightEvidence = getCashEvidenceSequence(right);
                if (
                    leftEvidence.broker === 'hsbc'
                    && rightEvidence.broker === 'hsbc'
                    && leftEvidence.account === rightEvidence.account
                    && leftEvidence.sequence !== null
                    && rightEvidence.sequence !== null
                    && leftEvidence.sequence !== rightEvidence.sequence
                ) {
                    // `ledger_sequence` is assigned in posted-ledger order,
                    // even when the source CSV itself is displayed newest-first.
                    // Keep same-day settlement boundaries chronological so the
                    // final balance includes every later principal and fee leg.
                    return leftEvidence.sequence - rightEvidence.sequence;
                }
                if (left.kind !== right.kind) return left.kind === 'transaction' ? -1 : 1;
                return left.index - right.index;
            });

            replayEvents.forEach((event) => {
                replaySnapshotOrder += 1;
                if (event.kind === 'transaction') {
                    const txn = event.txn;
                    const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                    const transactionCurrency = runtime.formatTransactionCurrency(txn)
                        || runtime.getTickerQuoteCurrency(txn?.ticker)
                        || context.baseCurrency;
                    if (isAuthoritativeHsbcCashTransaction(txn)) {
                        resetBrokerCurrencyCorrection(brokerCode, transactionCurrency);
                    }
                    latestRawAggregateBalances = runtime.cloneCashLedgerBalances(
                        txn?.aggregate_cash_by_currency || txn?.cash_by_currency || {},
                    );
                    latestRawBrokerBalances.set(
                        brokerCode,
                        // Current cash is projected onto the latest broker row
                        // for Holdings. Settlement corrections must instead
                        // use the immutable pre-projection replay balance.
                        runtime.cloneCashLedgerBalances(
                            txn?.calculated_broker_cash_by_currency
                            || txn?.broker_cash_by_currency
                            || {},
                        ),
                    );
                    (settlementAccrualsByOwnerTransactionIndex.get(event.index) || []).forEach(
                        (boundary) => {
                            const settlementAmount = Number(boundary?.settlementAmount);
                            const currency = String(
                                boundary?.currency || transactionCurrency || context.baseCurrency,
                            ).trim().toUpperCase() || context.baseCurrency;
                            if (!Number.isFinite(settlementAmount)) return;
                            applyCorrection(
                                getBrokerSettlementAccruals(brokerCode),
                                currency,
                                settlementAmount,
                            );
                            applyCorrection(
                                aggregateSettlementAccrualsByCurrency,
                                currency,
                                settlementAmount,
                            );
                        },
                    );
                    activeTransaction = txn;
                    snapshots.push(buildSnapshotFromTransaction(txn, event.date));
                    return;
                }

                if (!activeTransaction) return;
                const boundary = event.boundary;
                const brokerCode = runtime.normalizeInvestmentBroker(boundary?.broker || 'hsbc');
                const currency = String(boundary?.currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
                const brokerCorrections = getBrokerCorrections(brokerCode);
                const rawBrokerBalances = latestRawBrokerBalances.get(brokerCode) || {};
                const currentBrokerBalance = (Number(rawBrokerBalances[currency]) || 0)
                    + (Number(brokerCorrections[currency]) || 0);
                const settlementBalanceAfter = Number(boundary?.settlementBalanceAfter);
                const settlementAmount = Number(boundary?.settlementAmount);
                const boundaryCorrection = Number.isFinite(settlementBalanceAfter)
                    ? settlementBalanceAfter - currentBrokerBalance
                    : settlementAmount;
                if (!Number.isFinite(boundaryCorrection)) return;
                if (Number.isFinite(settlementAmount)) {
                    applyCorrection(
                        getBrokerSettlementAccruals(brokerCode),
                        currency,
                        -settlementAmount,
                    );
                    applyCorrection(
                        aggregateSettlementAccrualsByCurrency,
                        currency,
                        -settlementAmount,
                    );
                }
                applyCorrection(brokerCorrections, currency, boundaryCorrection);
                applyCorrection(aggregateCorrectionsByCurrency, currency, boundaryCorrection);
                snapshots.push(buildSnapshotFromTransaction(
                    activeTransaction,
                    event.date,
                    {isSettlementBoundary: true},
                ));
            });
            return snapshots;
        }

function getHsbcHistorySettlementCashBoundary(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const transactionDate = runtime.normalizeLedgerDate(txn?.date);
            const transactionType = runtime.getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(transactionType)) return null;
            const postings = Array.isArray(source.cash_settlement_postings)
                ? source.cash_settlement_postings
                : [];
            const settlementDate = runtime.normalizeLedgerDate(source.cash_settlement_date)
                || runtime.normalizeLedgerDate(postings.find((posting) => posting?.date)?.date);
            if (!transactionDate || !settlementDate || settlementDate <= transactionDate) return null;

            const postingWithBoundary = [...postings].reverse().find((posting) => (
                Number.isFinite(Number(posting?.balance_after_raw ?? posting?.balance_after))
            ));
            const balanceAfter = Number(
                postingWithBoundary?.balance_after_raw
                ?? postingWithBoundary?.balance_after
                ?? source.cash_settlement_balance_after_raw,
            );
            if (!Number.isFinite(balanceAfter)) return null;
            return {
                currency: String(
                    postingWithBoundary?.currency
                    || txn?.currency
                    || context.baseCurrency,
                ).trim().toUpperCase() || context.baseCurrency,
                balanceAfter,
            };
        }

function setHsbcHistoryCashBoundary(
            corrections,
            currency,
            balanceAfter,
            baseCash,
            ledgerDate,
        ) {
            const normalizedCurrency = String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency;
            delete corrections[normalizedCurrency];
            const otherCurrencyCorrection = getCashCorrectionInBaseCurrency(corrections, ledgerDate);
            const targetCorrectionInBase = Number(balanceAfter) - Number(baseCash) - otherCurrencyCorrection;
            if (!Number.isFinite(targetCorrectionInBase)) return;
            const oneUnitInBase = runtime.convertAmountToBaseCurrency(
                1,
                normalizedCurrency,
                ledgerDate,
                context.fxTimeline,
                context.baseCurrency,
            );
            const targetCorrection = Math.abs(oneUnitInBase) > 1e-9
                ? targetCorrectionInBase / oneUnitInBase
                : targetCorrectionInBase;
            if (!Number.isFinite(targetCorrection)) return;
            applyCashBalanceCorrection(corrections, normalizedCurrency, targetCorrection);
        }

function getHsbcHistorySettlementCashDeltas(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const transactionDate = runtime.normalizeLedgerDate(txn?.date);
            const settlementDate = runtime.normalizeLedgerDate(source.cash_settlement_date);
            if (!transactionDate || !settlementDate || settlementDate <= transactionDate) return [];
            const postings = Array.isArray(source.cash_settlement_postings)
                ? source.cash_settlement_postings
                : [];
            if (postings.length) {
                return postings.map((posting) => ({
                    currency: String(posting?.currency || txn?.currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency,
                    amount: Number(posting?.amount_raw ?? posting?.amount),
                })).filter((posting) => Number.isFinite(posting.amount));
            }
            const principal = Number(source.cash_settlement_amount_raw);
            if (!Number.isFinite(principal)) return [];
            const fee = Number(source.cash_flow_fee_amount_raw);
            return [{
                currency: String(txn?.currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency,
                amount: principal,
            }, ...(Number.isFinite(fee) && fee > 0 ? [{
                currency: String(txn?.currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency,
                amount: -fee,
            }] : [])];
        }

function applyHsbcHistoryPresentationProjection(processedTransactions) {
            const historyCorrectionsByScope = new Map();
            const pendingScopes = new Set();
            const getHistoryCorrections = (scopeKey) => {
                if (!historyCorrectionsByScope.has(scopeKey)) {
                    historyCorrectionsByScope.set(scopeKey, {});
                }
                return historyCorrectionsByScope.get(scopeKey);
            };
            (Array.isArray(processedTransactions) ? processedTransactions : []).forEach((txn) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                if (brokerCode !== 'hsbc') return;
                const scopeKey = getHsbcSettlementScopeKey(txn);
                const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
                const corrections = getHistoryCorrections(scopeKey);
                if (runtime.isHsbcSettlementActuallyPending(source)) {
                    pendingScopes.add(scopeKey);
                }

                const baseCash = Number.isFinite(Number(txn?.broker_display_cash))
                    ? Number(txn.broker_display_cash)
                    : (Number(txn?.broker_running_cash));
                const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
                const settlementBoundary = getHsbcHistorySettlementCashBoundary(txn);
                if (settlementBoundary) {
                    setHsbcHistoryCashBoundary(
                        corrections,
                        settlementBoundary.currency,
                        settlementBoundary.balanceAfter,
                        baseCash,
                        ledgerDate,
                    );
                } else {
                    getHsbcHistorySettlementCashDeltas(txn).forEach((posting) => {
                        applyCashBalanceCorrection(corrections, posting.currency, posting.amount);
                    });
                }

                const transactionCurrency = runtime.formatTransactionCurrency(txn)
                    || runtime.getTickerQuoteCurrency(txn?.ticker)
                    || context.baseCurrency;
                if (isAuthoritativeHsbcCashTransaction(txn)) {
                    const normalizedCurrency = String(transactionCurrency).trim().toUpperCase() || context.baseCurrency;
                    delete corrections[normalizedCurrency];
                }
                const pendingCashBoundary = runtime.isHsbcSettlementActuallyPending(source)
                    ? runtime.getInvestmentBrokerEndingCashInBaseCurrency(brokerCode)
                    : null;
                // Pending orders already project the authoritative bank cash.
                // Older settlement corrections belong to historical replay and
                // cannot be added to this independently anchored row again.
                const historyCash = pendingCashBoundary !== null
                    && Number.isFinite(Number(pendingCashBoundary))
                    ? Number(pendingCashBoundary) + (Number(txn?.broker_pending_settlement_cash) || 0)
                    : baseCash + getCashCorrectionInBaseCurrency(corrections, ledgerDate);
                const brokerMarketValue = Number(txn?.broker_market_value ?? txn?.market_value) || 0;
                const isProvisional = pendingScopes.has(scopeKey);
                txn.history_broker_cash = historyCash;
                txn.history_broker_equity = historyCash + brokerMarketValue;
                txn.history_cash_is_provisional = isProvisional;
                txn.history_equity_is_provisional = isProvisional;
                txn.history_balance_provisional_reason = isProvisional
                    ? 'An earlier or current HSBC order in this account has not reached a matched SEC cash settlement. Cash and Equity are provisional until HSBC posts every settlement leg.'
                    : '';
            });
        }

function roundInvestmentHistoryCash(value) {
            const numericValue = Number(value);
            return Number.isFinite(numericValue)
                ? Number(numericValue.toFixed(2))
                : null;
        }

function getInvestmentHistoryCashScopeKey(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const account = String(
                txn?.account
                ?? txn?.account_id
                ?? source.account
                ?? source.account_id
                ?? source.account_number
                ?? '',
            ).trim();
            return `${account}|${runtime.formatTransactionCurrency(txn) || runtime.getTickerQuoteCurrency(txn?.ticker) || context.baseCurrency}`;
        }

function applyIbkrHistoryPresentationProjection(processedTransactions) {
            const previousCashByScope = new Map();
            (Array.isArray(processedTransactions) ? processedTransactions : []).forEach((txn, processedIndex) => {
                if (runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) !== 'ibkr') return;
                const rawCash = Number(txn?.broker_running_cash);
                if (!Number.isFinite(rawCash)) return;

                const scopeKey = getInvestmentHistoryCashScopeKey(txn);
                const transactionCurrency = String(
                    runtime.formatTransactionCurrency(txn)
                    || runtime.getTickerQuoteCurrency(txn?.ticker)
                    || context.baseCurrency,
                ).trim().toUpperCase() || context.baseCurrency;
                const replayIndex = Number.isInteger(txn?.[runtime.INVESTMENT_REPLAY_ORDER_SYMBOL])
                    ? txn[runtime.INVESTMENT_REPLAY_ORDER_SYMBOL]
                    : processedIndex;
                const cashDelta = context.calculateInvestmentCashDelta(txn, replayIndex)
                    + (Number(context.cashFundingAdjustments.get(replayIndex)) || 0);
                const hasCashBoundary = Boolean(runtime.getInvestmentCashBalanceBoundary(txn));
                const previousCash = previousCashByScope.get(scopeKey);
                const roundedRawCash = roundInvestmentHistoryCash(rawCash);
                let historyCash = roundedRawCash;
                const sequentialCash = transactionCurrency === context.baseCurrency
                    && runtime.getNormalizedTransactionType(txn) === 'buy'
                    && !hasCashBoundary
                    && Number.isFinite(previousCash)
                    ? roundInvestmentHistoryCash(
                        previousCash + (roundInvestmentHistoryCash(cashDelta) || 0),
                    )
                    : null;
                if (
                    Number.isFinite(sequentialCash)
                    && Number.isFinite(roundedRawCash)
                    && Math.abs(sequentialCash - roundedRawCash) <= 0.02
                ) {
                    historyCash = sequentialCash;
                }
                if (!Number.isFinite(historyCash)) return;

                previousCashByScope.set(scopeKey, historyCash);
                if (Math.abs(historyCash - roundedRawCash) <= 1e-9) return;
                const brokerMarketValue = Number(txn?.broker_market_value ?? txn?.market_value) || 0;
                txn.history_broker_cash = historyCash;
                txn.history_broker_equity = historyCash + brokerMarketValue;
            });
        }

function applyAuthoritativeCurrentBrokerHistoryBoundary(processedTransactions) {
            const latestByBroker = new Map();
            (Array.isArray(processedTransactions) ? processedTransactions : []).forEach((txn) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                if (brokerCode) latestByBroker.set(brokerCode, txn);
            });
            latestByBroker.forEach((txn) => {
                if (txn?.broker_cash_balance_source !== 'authoritative_current_cash_snapshot') return;
                const displayCash = Number(txn?.broker_display_cash);
                const marketValue = Number(txn?.broker_market_value);
                if (!Number.isFinite(displayCash) || !Number.isFinite(marketValue)) return;
                txn.history_broker_cash = displayCash;
                txn.history_broker_equity = displayCash + marketValue;
            });
        }

    return {
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
    };
}

