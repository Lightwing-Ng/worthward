/**
 * Investment transaction-history cash projection and broker-boundary helpers.
 *
 * Code version: v1.3.7
 * - Fixed: A direct cash row from another source can precede same-day SEC
 *   postings when its balance exactly matches their first opening balance.
 * - Historical cash corrections remain scoped to immutable broker evidence.
 */

import {
    createHsbcHistoryEvidenceUtils,
} from './history-evidence.js?v=investment-history-evidence-v1.0.3';
import {
    createHsbcOpeningCashCorroborationMatcher,
} from './history-cash-corroboration.js?v=investment-history-cash-corroboration-v1.0.0';

export function createInvestmentHistoryProjectionRuntime(runtime, context) {
const {
            getHsbcCashEvidenceState,
            getHsbcCashScopeDescriptor,
            getHsbcDirectCashPhysicalEvidenceIdentity,
            getHsbcStructuredPostingPhysicalEvidenceIdentity,
            hasConsistentHsbcStructuredSettlementAliases,
            isHsbcCashFileKindCurrencyCompatible,
            isHsbcCashEvidenceTransaction,
            isSupportedHsbcCashCurrency,
            normalizeHsbcCashAccountType,
            normalizeHsbcCashCurrency,
            normalizeHsbcCashScopeToken,
            normalizeHsbcDecimalText,
            normalizeHsbcEvidenceDate,
            parseFiniteNonBlankHsbcNumber,
            parseHsbcPositiveSequenceNumber,
        } = createHsbcHistoryEvidenceUtils(runtime, context);

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


function cloneHsbcCashScopeLedger(ledger) {
            return {
                unscopedBalances: {...(ledger?.unscopedBalances || {})},
                scopedBalances: {...(ledger?.scopedBalances || {})},
                scopedCurrencies: {...(ledger?.scopedCurrencies || {})},
            };
        }

function resolveHsbcRawCashScopeBalance(
            cashScopeLedger,
            cashScopeKey,
            currency,
            aggregateBalances = null,
            {allowMissingExactScope = false} = {},
        ) {
            const normalizedCurrency = String(
                currency || context.baseCurrency,
            ).trim().toUpperCase() || context.baseCurrency;
            const scopedBalances = cashScopeLedger?.scopedBalances
                && typeof cashScopeLedger.scopedBalances === 'object'
                ? cashScopeLedger.scopedBalances
                : {};
            const unscopedBalances = cashScopeLedger?.unscopedBalances
                && typeof cashScopeLedger.unscopedBalances === 'object'
                ? cashScopeLedger.unscopedBalances
                : {};
            if (Object.prototype.hasOwnProperty.call(scopedBalances, cashScopeKey)) {
                const exactBalance = parseFiniteNonBlankHsbcNumber(
                    scopedBalances[cashScopeKey],
                );
                if (exactBalance === null) return {balance: null, resolved: false};
                // Replay deltas after the last scoped boundary stay unscoped
                // but are still added to the currency total that receives this
                // correction. Fold them into the only same-currency scope, as
                // the next scoped boundary would; otherwise the correction
                // counts them twice. Several same-currency scopes are ambiguous.
                const hasUnscopedBalance = Object.prototype.hasOwnProperty.call(
                    unscopedBalances,
                    normalizedCurrency,
                );
                if (!hasUnscopedBalance) return {balance: exactBalance, resolved: true};
                const unscopedBalance = parseFiniteNonBlankHsbcNumber(
                    unscopedBalances[normalizedCurrency],
                );
                const hasOtherSameCurrencyScope = Object.keys(scopedBalances).some(
                    (scopeKey) => (
                        scopeKey !== cashScopeKey
                        && scopeKey.endsWith(`|${normalizedCurrency}`)
                    ),
                );
                if (unscopedBalance === null || (
                    hasOtherSameCurrencyScope && Math.abs(unscopedBalance) > 1e-9
                )) {
                    return {balance: null, resolved: false};
                }
                return {balance: exactBalance + unscopedBalance, resolved: true};
            }
            const hasOtherSameCurrencyScope = Object.keys(scopedBalances).some(
                (scopeKey) => scopeKey.endsWith(`|${normalizedCurrency}`),
            );
            if (hasOtherSameCurrencyScope) {
                const hasAggregateBalance = Boolean(
                    aggregateBalances
                    && typeof aggregateBalances === 'object'
                    && Object.prototype.hasOwnProperty.call(
                        aggregateBalances,
                        normalizedCurrency,
                    )
                );
                const hasExplicitUnscopedBalance = Object.prototype.hasOwnProperty.call(
                    unscopedBalances,
                    normalizedCurrency,
                );
                const explicitUnscopedBalance = hasExplicitUnscopedBalance
                    ? parseFiniteNonBlankHsbcNumber(unscopedBalances[normalizedCurrency])
                    : 0;
                const sameCurrencyScopedBalances = Object.entries(scopedBalances)
                    .filter(([scopeKey]) => scopeKey.endsWith(`|${normalizedCurrency}`))
                    .map(([, value]) => parseFiniteNonBlankHsbcNumber(value));
                const aggregateBalance = parseFiniteNonBlankHsbcNumber(
                    aggregateBalances?.[normalizedCurrency],
                );
                const hasInvalidKnownBalance = (
                    (hasExplicitUnscopedBalance && explicitUnscopedBalance === null)
                    || sameCurrencyScopedBalances.some((value) => value === null)
                    || (hasAggregateBalance && aggregateBalance === null)
                );
                const implicitUnscopedBalance = aggregateBalance === null
                    ? 0
                    : aggregateBalance
                        - sameCurrencyScopedBalances.reduce((total, value) => total + value, 0)
                        - explicitUnscopedBalance;
                const hasUnattributedSameCurrencyBalance = (
                    hasInvalidKnownBalance
                    || Math.abs(explicitUnscopedBalance) > 1e-9
                    || Math.abs(implicitUnscopedBalance) > 1e-9
                );
                return (
                    allowMissingExactScope
                    && (hasAggregateBalance || hasExplicitUnscopedBalance)
                    && !hasUnattributedSameCurrencyBalance
                )
                    ? {balance: 0, resolved: true}
                    : {balance: null, resolved: false};
            }
            const hasExplicitUnscopedBalance = Object.prototype.hasOwnProperty.call(
                unscopedBalances,
                normalizedCurrency,
            );
            if (hasExplicitUnscopedBalance) {
                const explicitUnscopedBalance = parseFiniteNonBlankHsbcNumber(
                    unscopedBalances[normalizedCurrency],
                );
                return explicitUnscopedBalance === null
                    ? {balance: null, resolved: false}
                    : {balance: explicitUnscopedBalance, resolved: true};
            }
            const hasAggregateBalance = Boolean(
                aggregateBalances
                && typeof aggregateBalances === 'object'
                && Object.prototype.hasOwnProperty.call(aggregateBalances, normalizedCurrency)
            );
            const aggregateBalance = hasAggregateBalance
                ? parseFiniteNonBlankHsbcNumber(aggregateBalances[normalizedCurrency])
                : 0;
            if (!hasAggregateBalance) {
                const hasAnyAggregateEvidence = Boolean(
                    aggregateBalances
                    && typeof aggregateBalances === 'object'
                    && Object.keys(aggregateBalances).length
                );
                return allowMissingExactScope && hasAnyAggregateEvidence
                    ? {balance: 0, resolved: true}
                    : {balance: null, resolved: false};
            }
            return aggregateBalance === null
                ? {balance: null, resolved: false}
                : {balance: aggregateBalance, resolved: true};
        }

function getHsbcScopedCorrectionBalances(correctionsByScope) {
            const balances = {};
            (correctionsByScope instanceof Map ? correctionsByScope : new Map()).forEach((entry) => {
                applyCashBalanceCorrection(balances, entry?.currency, entry?.amount);
            });
            return balances;
        }

function setHsbcScopedCorrection(correctionsByScope, cashScopeKey, currency, amount) {
            if (!(correctionsByScope instanceof Map) || !cashScopeKey) return;
            const numericAmount = Number(amount);
            if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) <= 1e-9) {
                correctionsByScope.delete(cashScopeKey);
                return;
            }
            correctionsByScope.set(cashScopeKey, {
                amount: numericAmount,
                currency: String(currency || context.baseCurrency).trim().toUpperCase() || context.baseCurrency,
            });
        }

function addHsbcScopedCorrection(correctionsByScope, cashScopeKey, currency, amount) {
            if (!(correctionsByScope instanceof Map) || !cashScopeKey) return;
            const existing = correctionsByScope.get(cashScopeKey);
            setHsbcScopedCorrection(
                correctionsByScope,
                cashScopeKey,
                currency,
                (Number(existing?.amount) || 0) + (Number(amount) || 0),
            );
        }

function isAuthoritativeHsbcCashTransaction(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            const cashEvidence = getHsbcCashEvidenceState(txn);
            const balanceAfter = parseFiniteNonBlankHsbcNumber(
                source.balance_after_raw ?? source.balance_after,
            );
            return (
                brokerCode === 'hsbc'
                && !['buy', 'sell'].includes(normalizedType)
                && cashEvidence.isConsistent
                && balanceAfter !== null
                && source.cash_balance_authoritative === true
                && [
                    'hsbc_usd_account_text',
                    'hsbc_usd_savings_csv',
                ].includes(String(source.file_kind || '').trim().toLowerCase())
            );
        }

function getValidatedHsbcAvailableCashAfter(txn) {
            const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
            const rawAvailableCash = source.available_cash_after_raw;
            if (
                !isAuthoritativeHsbcCashTransaction(txn)
                || source.available_cash_calibration_source
                    !== 'hsbc_usd_savings_available_balance'
                || source.cash_replay_pending_settlement === true
                || runtime.isHsbcSettlementActuallyPending(source)
                || (
                    source.cash_settlement_balance_after_raw !== undefined
                    && source.cash_settlement_balance_after_raw !== null
                    && String(source.cash_settlement_balance_after_raw).trim() !== ''
                )
                || typeof rawAvailableCash !== 'string'
                || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawAvailableCash)
                || !normalizeHsbcDecimalText(rawAvailableCash)
            ) return null;
            return parseFiniteNonBlankHsbcNumber(rawAvailableCash);
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
            let boundariesForReplay = (Array.isArray(settlementBoundaries)
                ? settlementBoundaries
                : []).map((boundary) => {
                const currency = String(
                    boundary?.currency || context.baseCurrency,
                ).trim().toUpperCase() || context.baseCurrency;
                const cashScopeKey = String(
                    boundary?.cashScopeKey
                    || getHsbcCashScopeDescriptor({
                        broker: boundary?.broker || 'hsbc',
                        account: boundary?.account,
                        account_type: boundary?.accountType,
                        currency,
                        source: {file_kind: boundary?.sourceFileKind},
                    }).cashScopeKey,
                ).trim();
                return {...boundary, cashScopeKey, currency};
            }).filter((boundary) => boundary.cashScopeKey);
            let boundariesForAccrual = [...boundariesForReplay];
            const settledBoundariesByCashTransactionIndex = new Map();
            const incomparableOwnerTransactionIndexes = new Set();
            const boundaryOwnersByIdentity = new Map();
            const directCashEvidenceByIdentity = new Map();
            transactionsForReplay.forEach((txn) => {
                const identityKey = getHsbcDirectCashPhysicalEvidenceIdentity(txn);
                if (!identityKey) return;
                if (!directCashEvidenceByIdentity.has(identityKey)) {
                    directCashEvidenceByIdentity.set(identityKey, []);
                }
                directCashEvidenceByIdentity.get(identityKey).push({
                    date: normalizeHsbcEvidenceDate(txn?.date),
                    evidence: getHsbcCashEvidenceState(txn),
                });
            });
            boundariesForReplay.forEach((boundary) => {
                const ownerTransactionIndex = Number(boundary?.ownerTransactionIndex);
                if (!Number.isInteger(ownerTransactionIndex)) return;
                const rowNumber = parseHsbcPositiveSequenceNumber(
                    boundary?.sourceRowNumber,
                );
                const cashScopeKey = String(boundary?.cashScopeKey || '').trim();
                const sourceSequenceSha256 = String(
                    boundary?.sourceSequenceSha256 || '',
                ).trim().toLowerCase();
                if (
                    !cashScopeKey
                    || !/^[0-9a-f]{64}$/.test(sourceSequenceSha256)
                    || rowNumber === null
                ) {
                    incomparableOwnerTransactionIndexes.add(ownerTransactionIndex);
                    return;
                }
                const identityKey = JSON.stringify([
                    sourceSequenceSha256,
                    rowNumber,
                ]);
                if (!boundaryOwnersByIdentity.has(identityKey)) {
                    boundaryOwnersByIdentity.set(identityKey, []);
                }
                boundaryOwnersByIdentity.get(identityKey).push(ownerTransactionIndex);
                const directEvidence = directCashEvidenceByIdentity.get(identityKey) || [];
                const boundaryDate = normalizeHsbcEvidenceDate(boundary?.date);
                const boundaryFileKind = String(
                    boundary?.sourceFileKind || '',
                ).trim().toLowerCase();
                if (
                    directEvidence.length > 1
                    || directEvidence.some(({date: directDate, evidence}) => (
                        !evidence.isConsistent
                        || !directDate
                        || directDate !== boundaryDate
                        || evidence.descriptor.cashScopeKey !== cashScopeKey
                        || evidence.descriptor.sourceFileKind !== boundaryFileKind
                    ))
                ) {
                    incomparableOwnerTransactionIndexes.add(ownerTransactionIndex);
                }
            });
            boundaryOwnersByIdentity.forEach((ownerIndexes) => {
                if (ownerIndexes.length <= 1) return;
                ownerIndexes.forEach((ownerIndex) => {
                    incomparableOwnerTransactionIndexes.add(ownerIndex);
                });
            });
            boundariesForReplay = boundariesForReplay.filter((boundary) => (
                !incomparableOwnerTransactionIndexes.has(
                    Number(boundary?.ownerTransactionIndex),
                )
            ));
            const isCorroboratedOpeningCash = createHsbcOpeningCashCorroborationMatcher(
                transactionsForReplay,
                boundariesForReplay,
                {
                    normalizeLedgerDate: runtime.normalizeLedgerDate,
                    isHsbcCashEvidenceTransaction,
                    getHsbcCashEvidenceState,
                    parseFiniteNonBlankHsbcNumber,
                },
            );
            boundariesForReplay = boundariesForReplay.filter((boundary) => {
                const boundaryDate = runtime.normalizeLedgerDate(boundary?.date);
                if (!boundaryDate) return false;
                let sameScopeCashCount = 0;
                let comparableSequenceDomainCount = 0;
                let sameSequenceCandidateCount = 0;
                const exactCashTransactionIndexes = [];
                transactionsForReplay.forEach((txn, transactionIndex) => {
                    if (
                        runtime.normalizeLedgerDate(txn?.date) !== boundaryDate
                        || !isHsbcCashEvidenceTransaction(txn)
                    ) {
                        return;
                    }
                    const cashEvidence = getHsbcCashEvidenceState(txn);
                    const descriptor = cashEvidence.descriptor;
                    if (descriptor.cashScopeKey !== boundary.cashScopeKey) return;
                    if (isCorroboratedOpeningCash(txn, boundary)) return;
                    sameScopeCashCount += 1;
                    const boundaryFileKind = String(
                        boundary?.sourceFileKind || '',
                    ).trim().toLowerCase();
                    const boundarySha256 = String(
                        boundary?.sourceSequenceSha256 || '',
                    ).trim().toLowerCase();
                    const boundarySequenceDirection = Number(
                        boundary?.sourceSequenceDirection,
                    ) || (boundaryFileKind === 'hsbc_usd_savings_csv' ? -1 : 1);
                    const boundarySequence = Number(
                        boundarySequenceDirection < 0
                            ? boundary?.sourceRowNumber
                            : boundary?.sourceRowSequence,
                    );
                    const transactionSequence = Number(
                        descriptor.sourceSequenceDirection < 0
                            ? descriptor.rowNumber
                            : descriptor.ledgerSequence,
                    );
                    const hasExactSequenceDomain = (
                        cashEvidence.isConsistent
                        && boundaryFileKind
                        && boundaryFileKind === descriptor.sourceFileKind
                        && /^[0-9a-f]{64}$/.test(boundarySha256)
                        && boundarySha256 === descriptor.sourceSequenceSha256
                        && boundarySequenceDirection
                            === descriptor.sourceSequenceDirection
                        && Number.isFinite(boundarySequence)
                        && Number.isFinite(transactionSequence)
                        && boundarySequence > 0
                        && transactionSequence > 0
                    );
                    if (!hasExactSequenceDomain) {
                        return;
                    }
                    comparableSequenceDomainCount += 1;
                    if (boundarySequence === transactionSequence) {
                        sameSequenceCandidateCount += 1;
                        const directAmount = cashEvidence.amount;
                        const boundaryAmount = parseFiniteNonBlankHsbcNumber(
                            boundary?.settlementAmount,
                        );
                        const directBalance = cashEvidence.balance;
                        const boundaryBalance = parseFiniteNonBlankHsbcNumber(
                            boundary?.settlementBalanceAfter,
                        );
                        const amountMatches = (
                            directAmount !== null
                            && boundaryAmount !== null
                            && Math.abs(directAmount - boundaryAmount) <= 1e-6
                        );
                        const balanceMatches = (
                            directBalance === null
                            || boundaryBalance === null
                            || Math.abs(directBalance - boundaryBalance) <= 1e-6
                        );
                        if (amountMatches && balanceMatches) {
                            exactCashTransactionIndexes.push(transactionIndex);
                        }
                    }
                });
                if (
                    sameSequenceCandidateCount === 1
                    && exactCashTransactionIndexes.length === 1
                ) {
                    const [transactionIndex] = exactCashTransactionIndexes;
                    if (!settledBoundariesByCashTransactionIndex.has(transactionIndex)) {
                        settledBoundariesByCashTransactionIndex.set(transactionIndex, []);
                    }
                    settledBoundariesByCashTransactionIndex
                        .get(transactionIndex).push(boundary);
                    return false;
                }
                if (
                    sameSequenceCandidateCount > 0
                    || sameScopeCashCount > comparableSequenceDomainCount
                ) {
                    const ownerTransactionIndex = Number(
                        boundary?.ownerTransactionIndex,
                    );
                    if (Number.isInteger(ownerTransactionIndex)) {
                        incomparableOwnerTransactionIndexes.add(ownerTransactionIndex);
                    }
                    return false;
                }
                return true;
            });
            settledBoundariesByCashTransactionIndex.forEach((boundaries) => {
                if (boundaries.length === 1) return;
                boundaries.forEach((boundary) => {
                    const ownerTransactionIndex = Number(
                        boundary?.ownerTransactionIndex,
                    );
                    if (Number.isInteger(ownerTransactionIndex)) {
                        incomparableOwnerTransactionIndexes.add(ownerTransactionIndex);
                    }
                });
            });
            settledBoundariesByCashTransactionIndex.forEach((boundaries, index) => {
                const retained = boundaries.filter((boundary) => (
                    !incomparableOwnerTransactionIndexes.has(
                        Number(boundary?.ownerTransactionIndex),
                    )
                ));
                if (retained.length) {
                    settledBoundariesByCashTransactionIndex.set(index, retained);
                } else {
                    settledBoundariesByCashTransactionIndex.delete(index);
                }
            });
            boundariesForAccrual = boundariesForAccrual.filter((boundary) => (
                !incomparableOwnerTransactionIndexes.has(
                    Number(boundary?.ownerTransactionIndex),
                )
            ));
            if (!boundariesForAccrual.length) return transactionsForReplay;

            const brokerCorrectionsByCode = new Map();
            const brokerSettlementAccrualsByCode = new Map();
            const aggregateSettlementAccrualsByCurrency = {};
            const settlementAccrualsByOwnerTransactionIndex = new Map();
            const latestRawBrokerBalances = new Map();
            const latestRawBrokerScopeLedgers = new Map();
            let latestRawAggregateBalances = {};
            let activeTransaction = null;
            let replaySnapshotOrder = 0;
            const snapshots = [];

            boundariesForAccrual.forEach((boundary) => {
                const ownerTransactionIndex = Number(boundary?.ownerTransactionIndex);
                const settlementAmount = parseFiniteNonBlankHsbcNumber(
                    boundary?.settlementAmount,
                );
                if (
                    !Number.isInteger(ownerTransactionIndex)
                    || ownerTransactionIndex < 0
                    || settlementAmount === null
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
                    brokerCorrectionsByCode.set(normalizedBrokerCode, new Map());
                }
                return brokerCorrectionsByCode.get(normalizedBrokerCode);
            };
            const getBrokerCorrectionBalances = (brokerCode) => (
                getHsbcScopedCorrectionBalances(getBrokerCorrections(brokerCode))
            );
            const getAggregateCorrectionBalances = () => {
                const balances = {};
                brokerCorrectionsByCode.forEach((corrections) => {
                    Object.entries(getHsbcScopedCorrectionBalances(corrections)).forEach(
                        ([currency, amount]) => applyCashBalanceCorrection(balances, currency, amount),
                    );
                });
                return balances;
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
            const resetBrokerCashScopeCorrection = (brokerCode, cashScopeKey) => {
                if (!cashScopeKey) return;
                const corrections = getBrokerCorrections(brokerCode);
                corrections.delete(cashScopeKey);
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
                    : getAggregateCorrectionBalances();
                const brokerCorrections = isAuthoritativeCurrentCashSnapshot
                    ? {}
                    : getBrokerCorrectionBalances(brokerCode);
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

            const getCashEvidenceSequence = (event) => {
                if (event.kind === 'boundary') {
                    const boundary = event.boundary || {};
                    const sourceFileKind = String(
                        boundary.sourceFileKind || '',
                    ).trim().toLowerCase();
                    const direction = Number(boundary.sourceSequenceDirection)
                        || (sourceFileKind === 'hsbc_usd_savings_csv' ? -1 : 1);
                    const sequence = Number(
                        direction < 0
                            ? boundary.sourceRowNumber
                            : boundary.sourceRowSequence,
                    );
                    return {
                        broker: runtime.normalizeInvestmentBroker(boundary.broker || 'hsbc'),
                        cashScopeKey: String(boundary.cashScopeKey || '').trim(),
                        direction,
                        sequence: Number.isFinite(sequence) && sequence > 0 ? sequence : null,
                        sourceFileKind,
                        sourceSequenceSha256: String(
                            boundary.sourceSequenceSha256 || '',
                        ).trim().toLowerCase(),
                    };
                }
                const txn = event.txn || {};
                const source = txn.source && typeof txn.source === 'object' ? txn.source : {};
                const sourceFileKind = String(source.file_kind || '').trim().toLowerCase();
                const cashEvidence = getHsbcCashEvidenceState(txn);
                const descriptor = cashEvidence.descriptor;
                const direction = descriptor.sourceSequenceDirection;
                const sequence = parseHsbcPositiveSequenceNumber(
                    direction < 0
                        ? (source.row_number ?? source.ledger_sequence)
                        : (source.ledger_sequence ?? source.row_number),
                );
                const isHsbcCashEvidence = (
                    runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === 'hsbc'
                    && !['buy', 'sell'].includes(runtime.getNormalizedTransactionType(txn))
                    && [
                        'hsbc_usd_account_text',
                        'hsbc_usd_savings_csv',
                        'hsbc_multi_currency_cash_account_text',
                        'hsbc_statement_cash',
                    ].includes(sourceFileKind)
                );
                return {
                    broker: runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)),
                    cashScopeKey: descriptor.cashScopeKey,
                    direction,
                    sequence: isHsbcCashEvidence && cashEvidence.isConsistent
                        ? sequence
                        : null,
                    sourceFileKind,
                    sourceSequenceSha256: cashEvidence.isConsistent
                        ? descriptor.sourceSequenceSha256
                        : '',
                };
            };
            const replayEventsByDate = new Map();
            [
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
            ].filter((event) => event.date).forEach((event) => {
                if (!replayEventsByDate.has(event.date)) replayEventsByDate.set(event.date, []);
                replayEventsByDate.get(event.date).push(event);
            });
            const replayEvents = [...replayEventsByDate.entries()]
                .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
                .flatMap(([, dateEvents]) => {
                    const reordered = [...dateEvents];
                    const exactDomains = new Map();
                    dateEvents.forEach((event, slot) => {
                        const evidence = getCashEvidenceSequence(event);
                        if (
                            evidence.broker !== 'hsbc'
                            || !evidence.cashScopeKey
                            || !evidence.sourceFileKind
                            || !/^[0-9a-f]{64}$/.test(evidence.sourceSequenceSha256)
                            || evidence.sequence === null
                        ) return;
                        const domainKey = [
                            evidence.cashScopeKey,
                            evidence.sourceFileKind,
                            evidence.sourceSequenceSha256,
                            evidence.direction,
                        ].join('|');
                        if (!exactDomains.has(domainKey)) exactDomains.set(domainKey, []);
                        exactDomains.get(domainKey).push({event, evidence, slot});
                    });
                    exactDomains.forEach((members) => {
                        const orderedMembers = members.sort((left, right) => (
                            left.evidence.direction * (
                                left.evidence.sequence - right.evidence.sequence
                            )
                            || left.slot - right.slot
                        ));
                        const occupiedSlots = members
                            .map(({slot}) => slot)
                            .sort((left, right) => left - right);
                        occupiedSlots.forEach((slot, index) => {
                            reordered[slot] = orderedMembers[index].event;
                        });
                    });
                    return reordered;
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
                        resetBrokerCashScopeCorrection(
                            brokerCode,
                            getHsbcCashScopeDescriptor(txn).cashScopeKey,
                        );
                    }
                    (settledBoundariesByCashTransactionIndex.get(event.index) || []).forEach(
                        (boundary) => {
                            const settledAmount = parseFiniteNonBlankHsbcNumber(
                                boundary?.settlementAmount,
                            );
                            const settledCurrency = String(
                                boundary?.currency
                                || transactionCurrency
                                || context.baseCurrency,
                            ).trim().toUpperCase() || context.baseCurrency;
                            if (settledAmount === null) return;
                            applyCorrection(
                                getBrokerSettlementAccruals(brokerCode),
                                settledCurrency,
                                -settledAmount,
                            );
                            applyCorrection(
                                aggregateSettlementAccrualsByCurrency,
                                settledCurrency,
                                -settledAmount,
                            );
                        },
                    );
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
                    latestRawBrokerScopeLedgers.set(
                        brokerCode,
                        cloneHsbcCashScopeLedger(txn?.calculated_broker_cash_scope_ledger),
                    );
                    (settlementAccrualsByOwnerTransactionIndex.get(event.index) || []).forEach(
                        (boundary) => {
                            const settlementAmount = parseFiniteNonBlankHsbcNumber(
                                boundary?.settlementAmount,
                            );
                            const currency = String(
                                boundary?.currency || transactionCurrency || context.baseCurrency,
                            ).trim().toUpperCase() || context.baseCurrency;
                            if (settlementAmount === null) return;
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
                const cashScopeKey = String(
                    boundary?.cashScopeKey
                    || getHsbcCashScopeDescriptor({
                        broker: brokerCode,
                        account: boundary?.account,
                        account_type: boundary?.accountType,
                        currency,
                        source: {file_kind: boundary?.sourceFileKind},
                    }).cashScopeKey,
                ).trim();
                if (!cashScopeKey) return;
                const settlementAmount = parseFiniteNonBlankHsbcNumber(
                    boundary?.settlementAmount,
                );
                const brokerCorrections = getBrokerCorrections(brokerCode);
                const existingScopeCorrection = Number(
                    brokerCorrections.get(cashScopeKey)?.amount,
                ) || 0;
                const settlementBalanceAfter = parseFiniteNonBlankHsbcNumber(
                    boundary?.settlementBalanceAfter,
                );
                const rawBrokerScopeLedger = latestRawBrokerScopeLedgers.get(brokerCode);
                const rawScopeBalance = resolveHsbcRawCashScopeBalance(
                    rawBrokerScopeLedger,
                    cashScopeKey,
                    currency,
                    latestRawBrokerBalances.get(brokerCode) || {},
                    {
                        allowMissingExactScope: (
                            settlementBalanceAfter !== null
                            || brokerCorrections.has(cashScopeKey)
                        ),
                    },
                );
                if (!rawScopeBalance.resolved) {
                    return;
                }
                if (settlementAmount !== null) {
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
                const currentBrokerBalance = rawScopeBalance.balance + existingScopeCorrection;
                const boundaryCorrection = settlementBalanceAfter !== null
                    ? settlementBalanceAfter - currentBrokerBalance
                    : settlementAmount;
                if (boundaryCorrection === null || !Number.isFinite(boundaryCorrection)) return;
                addHsbcScopedCorrection(
                    brokerCorrections,
                    cashScopeKey,
                    currency,
                    boundaryCorrection,
                );
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
            const transactionDate = normalizeHsbcEvidenceDate(txn?.date);
            const transactionType = runtime.getNormalizedTransactionType(txn);
            if (!['buy', 'sell'].includes(transactionType)) return null;
            const postings = Array.isArray(source.cash_settlement_postings)
                ? source.cash_settlement_postings
                : [];
            if (
                postings.length
                && !hasConsistentHsbcStructuredSettlementAliases(txn, postings)
            ) return null;
            const normalizeOrderReference = (value) => {
                const match = String(value || '')
                    .trim().toUpperCase().match(/^([PS])[- ]?(\d+)$/);
                return match ? `${match[1]}-${match[2]}` : '';
            };
            const transactionOrderReference = normalizeOrderReference(
                source.statement_order_id || source.order_id,
            );
            const extractPostingOrderReference = (posting) => {
                const normalized = String(posting?.reference || '')
                    .trim().replace(/\s+/g, ' ');
                const match = normalized.match(
                    /^REF\s+([PS])(\d+)001\s+SEC(?:\s+\(\d{2}[A-Z]{3}\d{2}\))?$/i,
                );
                return match ? `${match[1].toUpperCase()}-${match[2]}` : '';
            };
            const getPostingIdentity = (posting) => {
                const accountNumber = normalizeHsbcCashScopeToken(posting?.account_number);
                const currency = normalizeHsbcCashCurrency(posting?.currency);
                const accountType = normalizeHsbcCashAccountType(
                    posting?.account_type,
                    currency,
                );
                const settlementDate = normalizeHsbcEvidenceDate(posting?.date);
                const sourceFileKind = String(
                    posting?.source_file_kind || '',
                ).trim().toLowerCase();
                const sourceSequenceSha256 = String(
                    posting?.source_sequence_sha256
                    || posting?.source_file_sha256
                    || posting?.statement_pdf_source_sha256
                    || '',
                ).trim().toLowerCase();
                const rowNumber = parseHsbcPositiveSequenceNumber(
                    posting?.row_number,
                );
                const statementRowRaw = posting?.statement_pdf_source_row_number;
                const hasStatementRowAlias = statementRowRaw !== undefined
                    && statementRowRaw !== null
                    && String(statementRowRaw).trim() !== '';
                const statementRowNumber = hasStatementRowAlias
                    ? parseHsbcPositiveSequenceNumber(statementRowRaw)
                    : null;
                const sequenceOrder = String(
                    posting?.ledger_sequence_order || '',
                ).trim().toLowerCase();
                const hasChronologicalSequence = sequenceOrder === 'chronological';
                const sequenceDirection = (
                    sourceFileKind === 'hsbc_usd_savings_csv'
                    && !hasChronologicalSequence
                ) ? -1 : 1;
                const sequenceValue = parseHsbcPositiveSequenceNumber(
                    sequenceDirection < 0
                        ? posting?.row_number
                        : posting?.ledger_sequence,
                );
                if (
                    !accountNumber
                    || !accountType
                    || !isSupportedHsbcCashCurrency(currency)
                    || !settlementDate
                    || ![
                        'hsbc_usd_account_text',
                        'hsbc_usd_savings_csv',
                        'hsbc_multi_currency_cash_account_text',
                        'hsbc_statement_cash',
                    ].includes(sourceFileKind)
                    || !isHsbcCashFileKindCurrencyCompatible(
                        sourceFileKind,
                        currency,
                    )
                    || !['', 'chronological'].includes(sequenceOrder)
                    || !/^[0-9a-f]{64}$/.test(sourceSequenceSha256)
                    || rowNumber === null
                    || (hasStatementRowAlias && statementRowNumber !== rowNumber)
                    || sequenceValue === null
                    || !transactionOrderReference
                    || (
                        sourceFileKind !== 'hsbc_statement_cash'
                        && extractPostingOrderReference(posting)
                            !== transactionOrderReference
                    )
                ) {
                    return null;
                }
                return {
                    accountNumber,
                    accountType,
                    currency,
                    settlementDate,
                    sourceFileKind,
                    sourceSequenceSha256,
                    rowNumber,
                    sequenceOrder,
                    sequenceDirection,
                    sequenceValue,
                };
            };
            const hasSamePostingIdentity = (left, right) => Boolean(
                left
                && right
                && left.accountNumber === right.accountNumber
                && left.accountType === right.accountType
                && left.currency === right.currency
                && left.settlementDate === right.settlementDate
                && left.sourceFileKind === right.sourceFileKind
                && left.sourceSequenceSha256 === right.sourceSequenceSha256
                && left.sequenceOrder === right.sequenceOrder
                && left.sequenceDirection === right.sequenceDirection
            );
            const principalPostings = postings.filter((posting) => (
                String(posting?.role || '').trim().toLowerCase() === 'principal'
            ));
            if (
                principalPostings.length !== 1
                || postings.some((posting) => (
                    !posting
                    || typeof posting !== 'object'
                    || !['principal', 'fee'].includes(
                        String(posting.role || '').trim().toLowerCase(),
                    )
                ))
            ) {
                return null;
            }
            const principalPosting = principalPostings[0];
            const principalIdentity = getPostingIdentity(principalPosting);
            const transactionAccount = normalizeHsbcCashScopeToken(
                txn?.account || source.account || source.account_number,
            );
            const transactionCurrency = normalizeHsbcCashCurrency(txn?.currency);
            const sourceSettlementDate = normalizeHsbcEvidenceDate(
                source.cash_settlement_date,
            );
            const sourceSettlementAmount = parseFiniteNonBlankHsbcNumber(
                source.cash_settlement_amount_raw,
            );
            const sourceSettlementAmountExact = normalizeHsbcDecimalText(
                source.cash_settlement_amount_raw,
            );
            if (
                !principalIdentity
                || !transactionAccount
                || principalIdentity.accountNumber !== transactionAccount
                || !transactionCurrency
                || principalIdentity.currency !== transactionCurrency
                || !sourceSettlementDate
                || principalIdentity.settlementDate !== sourceSettlementDate
                || sourceSettlementAmount === null
            ) {
                return null;
            }
            const participatingPostings = postings.map((posting) => ({
                identity: getPostingIdentity(posting),
                posting,
            }));
            if (participatingPostings.some(({identity, posting}) => {
                const sequenceDelta = principalIdentity.sequenceDirection
                    * (identity?.sequenceValue - principalIdentity.sequenceValue);
                const role = String(posting?.role || '').trim().toLowerCase();
                return (
                    !hasSamePostingIdentity(identity, principalIdentity)
                    || (role === 'principal' && sequenceDelta !== 0)
                    || (role === 'fee' && sequenceDelta <= 0)
                );
            })) {
                return null;
            }
            const postingSequenceKeys = participatingPostings.map(({identity}) => (
                `${identity.sequenceDirection}:${identity.sequenceValue}`
            ));
            if (new Set(postingSequenceKeys).size !== postingSequenceKeys.length) {
                return null;
            }
            const physicalPostingKeys = participatingPostings.map(({identity}) => (
                `${identity.sourceSequenceSha256}:${identity.rowNumber}`
            ));
            if (new Set(physicalPostingKeys).size !== physicalPostingKeys.length) {
                return null;
            }
            if (participatingPostings.some(({posting}) => {
                const rawBalance = posting?.balance_after_raw;
                return rawBalance !== undefined
                    && rawBalance !== null
                    && String(rawBalance).trim() !== ''
                    && parseFiniteNonBlankHsbcNumber(rawBalance) === null;
            })) {
                return null;
            }
            const postingAmounts = participatingPostings.map(({posting}) => ({
                amount: parseFiniteNonBlankHsbcNumber(
                    posting?.amount_raw,
                ),
                role: String(posting?.role || '').trim().toLowerCase(),
            }));
            if (postingAmounts.some(({amount}) => amount === null)) return null;
            const principalAmount = postingAmounts.find(({role}) => role === 'principal')?.amount;
            const principalBalance = parseFiniteNonBlankHsbcNumber(
                principalPosting?.balance_after_raw,
            );
            const feeAmounts = postingAmounts.filter(({role}) => role === 'fee')
                .map(({amount}) => amount);
            if (
                principalBalance === null
                || normalizeHsbcDecimalText(principalPosting?.amount_raw)
                    !== sourceSettlementAmountExact
                || (transactionType === 'buy' && principalAmount >= 0)
                || (transactionType === 'sell' && principalAmount <= 0)
                || feeAmounts.some((amount) => amount >= 0)
            ) {
                return null;
            }
            const commissionInputs = [
                txn?.normalized?.commission,
                txn?.commission_raw,
            ].filter((value) => (
                value !== undefined
                && value !== null
                && String(value).trim() !== ''
            ));
            const commissions = commissionInputs.map(Number);
            if (
                commissions.some((commission) => !Number.isFinite(commission))
                || commissionInputs.length !== 2
                || commissions.some((commission) => (
                    Math.abs(commission - commissions[0]) > 1e-6
                ))
            ) {
                return null;
            }
            const commission = commissions[0] ?? 0;
            const feeTotal = feeAmounts.reduce((total, amount) => total + amount, 0);
            const rawTransactionAmount = typeof runtime.getTransactionAmount === 'function'
                ? runtime.getTransactionAmount(txn)
                : (
                    txn?.normalized?.net_amount
                    ?? txn?.net_amount_raw
                    ?? txn?.amount
                    ?? txn?.cash
                );
            const transactionAmount = parseFiniteNonBlankHsbcNumber(rawTransactionAmount);
            const evidencedNetAmount = principalAmount + feeTotal;
            if (
                commission > 1e-9
                || (commission < -1e-9 && (
                    !feeAmounts.length
                    || Math.abs(commission - feeTotal) > 1e-6
                ))
                || (Math.abs(commission) <= 1e-9 && feeAmounts.length)
                || transactionAmount === null
                || (
                    Math.abs(transactionAmount - principalAmount) > 1e-6
                    && Math.abs(transactionAmount - evidencedNetAmount) > 1e-6
                )
            ) {
                return null;
            }
            const postingWithBoundary = participatingPostings.filter(({posting}) => (
                parseFiniteNonBlankHsbcNumber(
                    posting?.balance_after_raw,
                ) !== null
            )).reduce((latest, candidate) => {
                if (!latest) return candidate;
                return principalIdentity.sequenceDirection
                    * (candidate.identity.sequenceValue - latest.identity.sequenceValue) > 0
                    ? candidate
                    : latest;
            }, null);
            if (!postingWithBoundary) return null;
            const trailingPostings = participatingPostings.filter(({identity, posting}) => (
                parseFiniteNonBlankHsbcNumber(
                    posting?.balance_after_raw,
                ) === null
                && principalIdentity.sequenceDirection
                    * (identity.sequenceValue
                        - postingWithBoundary.identity.sequenceValue) > 0
            )).sort((left, right) => (
                principalIdentity.sequenceDirection
                    * (left.identity.sequenceValue - right.identity.sequenceValue)
            ));
            let previousParticipatingPosting = postingWithBoundary;
            for (const trailingPosting of trailingPostings) {
                const sequenceDelta = principalIdentity.sequenceDirection * (
                    trailingPosting.identity.sequenceValue
                    - previousParticipatingPosting.identity.sequenceValue
                );
                if (sequenceDelta !== 1) return null;
                previousParticipatingPosting = trailingPosting;
            }
            const trailingCashDelta = trailingPostings.reduce((total, posting) => {
                const amount = parseFiniteNonBlankHsbcNumber(
                    posting?.posting?.amount_raw,
                );
                return amount === null ? total : total + amount;
            }, 0);
            const settlementDate = principalIdentity.settlementDate;
            if (!transactionDate || !settlementDate || settlementDate < transactionDate) return null;
            const postedBalanceAfter = parseFiniteNonBlankHsbcNumber(
                postingWithBoundary.posting?.balance_after_raw,
            );
            if (postedBalanceAfter === null) return null;
            const balanceAfter = postedBalanceAfter + trailingCashDelta;
            const currency = principalIdentity.currency;
            const descriptor = getHsbcCashScopeDescriptor(txn, {
                accountNumber: principalPosting?.account_number,
                accountType: principalPosting?.account_type,
                currency,
                ledgerSequence: postingWithBoundary.posting?.ledger_sequence,
                rowNumber: postingWithBoundary.posting?.row_number,
                sourceFileKind: principalPosting?.source_file_kind,
                sourceSequenceDirection: postingWithBoundary.identity.sequenceDirection,
                ledgerSequenceOrder: postingWithBoundary.posting?.ledger_sequence_order,
                sourceSequenceSha256: (
                    principalPosting?.source_sequence_sha256
                    || principalPosting?.source_file_sha256
                    || principalPosting?.statement_pdf_source_sha256
                ),
            });
            return {
                ...descriptor,
                balanceAfter,
                matchBalanceAfter: postedBalanceAfter,
                postingProvenanceKeys: participatingPostings.map(({identity}) => (
                    JSON.stringify([
                        identity.sourceSequenceSha256,
                        identity.rowNumber,
                    ])
                )),
                settlementAmount: parseFiniteNonBlankHsbcNumber(
                    postingWithBoundary.posting?.amount_raw,
                ),
                settlementDate,
            };
        }

function setHsbcHistoryCashBoundary(
            correctionsByScope,
            boundary,
            rawCashScopeLedger = null,
            rawCashBalances = null,
        ) {
            const cashScopeKey = String(boundary?.cashScopeKey || '').trim();
            const balanceAfter = parseFiniteNonBlankHsbcNumber(boundary?.balanceAfter);
            if (!cashScopeKey || balanceAfter === null) return false;
            const rawScopeBalance = resolveHsbcRawCashScopeBalance(
                rawCashScopeLedger,
                cashScopeKey,
                boundary?.currency,
                rawCashBalances,
                {allowMissingExactScope: true},
            );
            if (!rawScopeBalance.resolved) return false;
            setHsbcScopedCorrection(
                correctionsByScope,
                cashScopeKey,
                boundary?.currency,
                balanceAfter - rawScopeBalance.balance,
            );
            return true;
        }

function getHsbcHistorySettlementCashDeltas(txn) {
            // Scalar-only settlement metadata predates immutable per-posting
            // identities. It cannot safely change cash without structured legs.
            return [];
        }

function applyHsbcHistoryPresentationProjection(processedTransactions) {
            const historyCorrectionsByCashScope = new Map();
            const settlementBoundariesByCashScope = new Map();
            const pendingScopes = new Set();
            const ambiguousCashScopes = new Set();
            const rememberSettlementBoundary = (boundary) => {
                const cashScopeKey = String(boundary?.cashScopeKey || '').trim();
                const nextDate = runtime.normalizeLedgerDate(boundary?.settlementDate);
                if (!cashScopeKey || !nextDate) return;
                if (!settlementBoundariesByCashScope.has(cashScopeKey)) {
                    settlementBoundariesByCashScope.set(cashScopeKey, []);
                }
                settlementBoundariesByCashScope.get(cashScopeKey).push({
                    ...boundary,
                    settlementDate: nextDate,
                });
            };
            const cashTransactions = Array.isArray(processedTransactions)
                ? processedTransactions
                : [];
            const settlementBoundaryByTransactionIndex = new Map();
            const rawOwnersByPostingProvenance = new Map();
            cashTransactions.forEach((txn, index) => {
                const source = txn?.source && typeof txn.source === 'object'
                    ? txn.source
                    : {};
                if (
                    runtime.normalizeInvestmentBroker(
                        txn?.broker || source.broker || runtime.getTransactionBrokerCode(txn),
                    ) !== 'hsbc'
                ) return;
                const postings = Array.isArray(source.cash_settlement_postings)
                    ? source.cash_settlement_postings
                    : [];
                postings.forEach((posting) => {
                    const provenanceKey = (
                        getHsbcStructuredPostingPhysicalEvidenceIdentity(posting)
                    );
                    if (!provenanceKey) return;
                    if (!rawOwnersByPostingProvenance.has(provenanceKey)) {
                        rawOwnersByPostingProvenance.set(provenanceKey, new Set());
                    }
                    rawOwnersByPostingProvenance.get(provenanceKey).add(index);
                });
            });
            const rawConflictingBoundaryOwnerIndexes = new Set();
            rawOwnersByPostingProvenance.forEach((ownerIndexes) => {
                if (ownerIndexes.size <= 1) return;
                ownerIndexes.forEach((ownerIndex) => {
                    rawConflictingBoundaryOwnerIndexes.add(ownerIndex);
                });
            });
            const ownersByPostingProvenance = new Map();
            cashTransactions.forEach((txn, index) => {
                const boundary = getHsbcHistorySettlementCashBoundary(txn);
                if (!boundary) return;
                settlementBoundaryByTransactionIndex.set(index, boundary);
                (Array.isArray(boundary.postingProvenanceKeys)
                    ? boundary.postingProvenanceKeys
                    : []).forEach((provenanceKey) => {
                    if (!ownersByPostingProvenance.has(provenanceKey)) {
                        ownersByPostingProvenance.set(provenanceKey, new Set());
                    }
                    ownersByPostingProvenance.get(provenanceKey).add(index);
                });
            });
            const conflictingBoundaryOwnerIndexes = new Set();
            rawConflictingBoundaryOwnerIndexes.forEach((ownerIndex) => {
                conflictingBoundaryOwnerIndexes.add(ownerIndex);
                const boundary = settlementBoundaryByTransactionIndex.get(ownerIndex);
                if (boundary?.cashScopeKey) {
                    ambiguousCashScopes.add(boundary.cashScopeKey);
                }
            });
            ownersByPostingProvenance.forEach((ownerIndexes) => {
                if (ownerIndexes.size <= 1) return;
                ownerIndexes.forEach((ownerIndex) => {
                    conflictingBoundaryOwnerIndexes.add(ownerIndex);
                    const boundary = settlementBoundaryByTransactionIndex.get(ownerIndex);
                    if (boundary?.cashScopeKey) {
                        ambiguousCashScopes.add(boundary.cashScopeKey);
                    }
                });
            });
            const inconsistentDirectCashDomains = new Set();
            const directCashEvidenceByPhysicalIdentity = new Map();
            cashTransactions.forEach((txn) => {
                if (!isHsbcCashEvidenceTransaction(txn)) return;
                const cashEvidence = getHsbcCashEvidenceState(txn);
                const cashScopeKey = String(
                    cashEvidence.descriptor?.cashScopeKey || '',
                ).trim();
                const cashDate = normalizeHsbcEvidenceDate(txn?.date);
                if (!cashEvidence.isConsistent && cashScopeKey && cashDate) {
                    inconsistentDirectCashDomains.add(
                        JSON.stringify([cashScopeKey, cashDate]),
                    );
                }
                const physicalIdentity = getHsbcDirectCashPhysicalEvidenceIdentity(txn);
                if (physicalIdentity) {
                    if (!directCashEvidenceByPhysicalIdentity.has(physicalIdentity)) {
                        directCashEvidenceByPhysicalIdentity.set(physicalIdentity, []);
                    }
                    directCashEvidenceByPhysicalIdentity.get(physicalIdentity).push({
                        date: cashDate,
                        evidence: cashEvidence,
                    });
                }
            });
            const conflictingDirectCashPhysicalIdentities = new Set(
                [...directCashEvidenceByPhysicalIdentity.entries()]
                    .filter(([, group]) => group.length > 1)
                    .map(([physicalIdentity]) => physicalIdentity),
            );
            settlementBoundaryByTransactionIndex.forEach((boundary, ownerIndex) => {
                const domainKey = JSON.stringify([
                    String(boundary?.cashScopeKey || '').trim(),
                    normalizeHsbcEvidenceDate(boundary?.settlementDate),
                ]);
                if (!inconsistentDirectCashDomains.has(domainKey)) return;
                conflictingBoundaryOwnerIndexes.add(ownerIndex);
                if (boundary?.cashScopeKey) {
                    ambiguousCashScopes.add(boundary.cashScopeKey);
                }
            });
            settlementBoundaryByTransactionIndex.forEach((boundary, ownerIndex) => {
                const boundaryDate = normalizeHsbcEvidenceDate(
                    boundary?.settlementDate,
                );
                const boundaryFileKind = String(
                    boundary?.sourceFileKind || '',
                ).trim().toLowerCase();
                const matchingDirectEvidenceGroups = (
                    Array.isArray(boundary?.postingProvenanceKeys)
                        ? boundary.postingProvenanceKeys
                        : []
                ).map((identityKey) => (
                    directCashEvidenceByPhysicalIdentity.get(identityKey) || []
                )).filter((group) => group.length);
                const hasPhysicalEvidenceConflict = matchingDirectEvidenceGroups.some(
                    (group) => (
                        group.length > 1
                        || group.some(({date: directDate, evidence}) => !(
                            evidence.isConsistent
                            && directDate
                            && directDate === boundaryDate
                            && evidence.descriptor.cashScopeKey === boundary.cashScopeKey
                            && evidence.descriptor.sourceFileKind === boundaryFileKind
                        ))
                    ),
                );
                if (!hasPhysicalEvidenceConflict) return;
                conflictingBoundaryOwnerIndexes.add(ownerIndex);
                if (boundary?.cashScopeKey) {
                    ambiguousCashScopes.add(boundary.cashScopeKey);
                }
            });
            const classifyCashAgainstBoundary = (txn, cashEvidence, boundary) => {
                const cashDescriptor = cashEvidence?.descriptor;
                if (!cashDescriptor?.cashScopeKey || !cashEvidence.isConsistent) {
                    return 'incomparable';
                }
                const cashDate = runtime.normalizeLedgerDate(txn?.date);
                if (!cashDate) return 'incomparable';
                if (cashDate < boundary.settlementDate) return 'before';
                if (cashDate > boundary.settlementDate) return 'after';
                const boundarySha256 = String(
                    boundary?.sourceSequenceSha256 || '',
                ).trim().toLowerCase();
                if (
                    !cashDescriptor.sourceSequenceSha256
                    || !boundarySha256
                    || cashDescriptor.sourceSequenceSha256 !== boundarySha256
                    || !cashDescriptor.sourceFileKind
                    || cashDescriptor.sourceFileKind !== boundary.sourceFileKind
                ) {
                    return 'incomparable';
                }
                const boundarySequenceDirection = Number(
                    boundary?.sourceSequenceDirection,
                ) || (
                    cashDescriptor.sourceFileKind === 'hsbc_usd_savings_csv' ? -1 : 1
                );
                if (
                    cashDescriptor.sourceSequenceDirection
                    !== boundarySequenceDirection
                ) return 'incomparable';
                const cashSequence = cashDescriptor.sourceSequenceDirection < 0
                    ? cashDescriptor.rowNumber
                    : cashDescriptor.ledgerSequence;
                const boundarySequence = boundarySequenceDirection < 0
                    ? boundary.rowNumber
                    : boundary.ledgerSequence;
                if (!Number.isFinite(cashSequence) || !Number.isFinite(boundarySequence)) {
                    return 'incomparable';
                }
                const sequenceDelta = boundarySequenceDirection
                    * (cashSequence - boundarySequence);
                if (sequenceDelta < 0) return 'before';
                if (sequenceDelta > 0) return 'after';

                const sameSequenceCandidates = cashTransactions.filter((candidate) => {
                    if (
                        runtime.normalizeLedgerDate(candidate?.date) !== cashDate
                        || !isHsbcCashEvidenceTransaction(candidate)
                    ) return false;
                    const candidateEvidence = getHsbcCashEvidenceState(candidate);
                    const candidateDescriptor = candidateEvidence.descriptor;
                    const candidateSequence = candidateDescriptor.sourceSequenceDirection < 0
                        ? candidateDescriptor.rowNumber
                        : candidateDescriptor.ledgerSequence;
                    return (
                        candidateDescriptor.cashScopeKey === cashDescriptor.cashScopeKey
                        && candidateDescriptor.sourceFileKind === boundary.sourceFileKind
                        && candidateDescriptor.sourceSequenceSha256 === boundarySha256
                        && candidateDescriptor.sourceSequenceDirection
                            === boundarySequenceDirection
                        && candidateSequence === boundarySequence
                    );
                });
                const exactCandidates = sameSequenceCandidates.filter((candidate) => {
                    const candidateEvidence = getHsbcCashEvidenceState(candidate);
                    const boundaryAmount = parseFiniteNonBlankHsbcNumber(
                        boundary?.settlementAmount ?? boundary?.amount,
                    );
                    const boundaryBalance = parseFiniteNonBlankHsbcNumber(
                        boundary?.matchBalanceAfter ?? boundary?.balanceAfter,
                    );
                    return (
                        candidateEvidence.isConsistent
                        && candidateEvidence.amount !== null
                        && boundaryAmount !== null
                        && Math.abs(candidateEvidence.amount - boundaryAmount) <= 1e-6
                        && (
                            candidateEvidence.balance === null
                            || boundaryBalance === null
                            || Math.abs(candidateEvidence.balance - boundaryBalance) <= 1e-6
                        )
                    );
                });
                if (
                    sameSequenceCandidates.length === 1
                    && exactCandidates.length === 1
                    && exactCandidates[0] === txn
                ) {
                    const exactEvidence = getHsbcCashEvidenceState(exactCandidates[0]);
                    const boundaryBalance = parseFiniteNonBlankHsbcNumber(
                        boundary?.matchBalanceAfter ?? boundary?.balanceAfter,
                    );
                    return exactEvidence.balance === null || boundaryBalance === null
                        ? 'exact-unresolved-balance'
                        : 'exact';
                }
                return 'incomparable';
            };
            const canCashRowClearSettlementBoundary = (txn, cashEvidence) => {
                const cashDescriptor = cashEvidence?.descriptor;
                if (!cashDescriptor?.cashScopeKey) return false;
                const boundaries = settlementBoundariesByCashScope.get(
                    cashDescriptor.cashScopeKey,
                ) || [];
                return boundaries.length > 0 && boundaries.every((boundary) => (
                    ['exact', 'exact-unresolved-balance', 'after'].includes(
                        classifyCashAgainstBoundary(txn, cashEvidence, boundary),
                    )
                ));
            };
            const hasSequenceIncomparableSameDayBoundary = (txn, cashEvidence) => {
                const cashDescriptor = cashEvidence?.descriptor;
                if (!cashDescriptor?.cashScopeKey) return false;
                const cashDate = runtime.normalizeLedgerDate(txn?.date);
                if (!cashDate) return false;
                return (settlementBoundariesByCashScope.get(
                    cashDescriptor.cashScopeKey,
                ) || []).some((boundary) => (
                    cashDate === boundary.settlementDate
                    && classifyCashAgainstBoundary(
                        txn,
                        cashEvidence,
                        boundary,
                    ) === 'incomparable'
                ));
            };
            cashTransactions.forEach((txn, transactionIndex) => {
                const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
                if (brokerCode !== 'hsbc') return;
                const scopeKey = getHsbcSettlementScopeKey(txn);
                const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
                if (runtime.isHsbcSettlementActuallyPending(source)) {
                    pendingScopes.add(scopeKey);
                }

                const baseCash = Number.isFinite(Number(txn?.broker_display_cash))
                    ? Number(txn.broker_display_cash)
                    : (Number(txn?.broker_running_cash));
                const ledgerDate = runtime.normalizeLedgerDate(txn?.date);
                const settlementBoundary = settlementBoundaryByTransactionIndex.get(
                    transactionIndex,
                ) || null;
                if (settlementBoundary) {
                    if (conflictingBoundaryOwnerIndexes.has(transactionIndex)) {
                        ambiguousCashScopes.add(settlementBoundary.cashScopeKey);
                    } else {
                        const applied = setHsbcHistoryCashBoundary(
                            historyCorrectionsByCashScope,
                            settlementBoundary,
                            txn?.calculated_broker_cash_scope_ledger || null,
                            txn?.calculated_broker_cash_by_currency
                                || txn?.broker_cash_by_currency
                                || null,
                        );
                        rememberSettlementBoundary(settlementBoundary);
                        if (!applied) {
                            ambiguousCashScopes.add(settlementBoundary.cashScopeKey);
                        }
                    }
                } else if (
                    Array.isArray(source.cash_settlement_postings)
                    && source.cash_settlement_postings.length
                ) {
                    const principalPostings = source.cash_settlement_postings.filter(
                        (posting) => String(
                            posting?.role || '',
                        ).trim().toLowerCase() === 'principal',
                    );
                    const principalPosting = principalPostings.length === 1
                        ? principalPostings[0]
                        : null;
                    const transactionAccount = normalizeHsbcCashScopeToken(
                        txn?.account || source.account || source.account_number,
                    );
                    const postingAccount = normalizeHsbcCashScopeToken(
                        principalPosting?.account_number,
                    );
                    const transactionCurrency = normalizeHsbcCashScopeToken(txn?.currency);
                    const postingCurrency = normalizeHsbcCashScopeToken(
                        principalPosting?.currency,
                    );
                    const settlementDate = runtime.normalizeLedgerDate(
                        source.cash_settlement_date,
                    );
                    if (
                        principalPosting
                        && transactionAccount
                        && postingAccount === transactionAccount
                        && transactionCurrency
                        && postingCurrency === transactionCurrency
                        && settlementDate
                        && runtime.normalizeLedgerDate(principalPosting?.date)
                            === settlementDate
                    ) {
                        const descriptor = getHsbcCashScopeDescriptor(txn, {
                            accountNumber: principalPosting?.account_number,
                            accountType: principalPosting?.account_type,
                            currency: postingCurrency,
                            ledgerSequence: principalPosting?.ledger_sequence,
                            rowNumber: principalPosting?.row_number,
                            sourceFileKind: principalPosting?.source_file_kind,
                            sourceSequenceSha256: (
                                principalPosting?.source_sequence_sha256
                                || principalPosting?.source_file_sha256
                                || principalPosting?.statement_pdf_source_sha256
                            ),
                        });
                        if (descriptor.cashScopeKey) {
                            rememberSettlementBoundary({
                                ...descriptor,
                                settlementDate,
                            });
                            ambiguousCashScopes.add(descriptor.cashScopeKey);
                        }
                    }
                } else {
                    getHsbcHistorySettlementCashDeltas(txn).forEach((posting) => {
                        if (!posting.cashScopeKey) return;
                        addHsbcScopedCorrection(
                            historyCorrectionsByCashScope,
                            posting.cashScopeKey,
                            posting.currency,
                            posting.amount,
                        );
                        rememberSettlementBoundary(posting);
                    });
                }

                let hasInconsistentCashEvidence = false;
                if (isHsbcCashEvidenceTransaction(txn)) {
                    const cashEvidence = getHsbcCashEvidenceState(txn);
                    const cashDescriptor = cashEvidence.descriptor;
                    const physicalIdentity = getHsbcDirectCashPhysicalEvidenceIdentity(
                        txn,
                    );
                    hasInconsistentCashEvidence = (
                        !cashEvidence.isConsistent
                        || conflictingDirectCashPhysicalIdentities.has(
                            physicalIdentity,
                        )
                    );
                    if (hasInconsistentCashEvidence) {
                        historyCorrectionsByCashScope.delete(
                            cashDescriptor.cashScopeKey,
                        );
                        if (cashDescriptor.cashScopeKey) {
                            ambiguousCashScopes.add(cashDescriptor.cashScopeKey);
                        }
                    } else if (hasSequenceIncomparableSameDayBoundary(txn, cashEvidence)) {
                        historyCorrectionsByCashScope.delete(cashDescriptor.cashScopeKey);
                        ambiguousCashScopes.add(cashDescriptor.cashScopeKey);
                    } else if (canCashRowClearSettlementBoundary(txn, cashEvidence)) {
                        const boundaryClassifications = (
                            settlementBoundariesByCashScope.get(
                                cashDescriptor.cashScopeKey,
                            ) || []
                        ).map((boundary) => (
                            classifyCashAgainstBoundary(txn, cashEvidence, boundary)
                        ));
                        historyCorrectionsByCashScope.delete(cashDescriptor.cashScopeKey);
                        settlementBoundariesByCashScope.delete(cashDescriptor.cashScopeKey);
                        if (
                            boundaryClassifications.includes('exact-unresolved-balance')
                            || !isAuthoritativeHsbcCashTransaction(txn)
                        ) {
                            ambiguousCashScopes.add(cashDescriptor.cashScopeKey);
                        } else {
                            ambiguousCashScopes.delete(cashDescriptor.cashScopeKey);
                        }
                    }
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
                    : baseCash + getCashCorrectionInBaseCurrency(
                        getHsbcScopedCorrectionBalances(historyCorrectionsByCashScope),
                        ledgerDate,
                    );
                const brokerMarketValue = Number(txn?.broker_market_value ?? txn?.market_value) || 0;
                const cashScopeKey = settlementBoundary?.cashScopeKey
                    || getHsbcCashScopeDescriptor(txn).cashScopeKey;
                const hasAmbiguousCashSequence = ambiguousCashScopes.has(cashScopeKey);
                const isProvisional = pendingScopes.has(scopeKey)
                    || hasAmbiguousCashSequence
                    || hasInconsistentCashEvidence;
                txn.history_broker_cash = historyCash;
                txn.history_broker_equity = historyCash + brokerMarketValue;
                txn.history_cash_is_provisional = isProvisional;
                txn.history_equity_is_provisional = isProvisional;
                txn.history_balance_provisional_reason = hasInconsistentCashEvidence
                    ? 'This HSBC cash row has incomplete or inconsistent immutable source-sequence evidence. Cash and Equity use the direct bank balance and remain provisional for that cash subaccount.'
                    : (hasAmbiguousCashSequence
                    ? 'A same-day HSBC cash row and settlement boundary do not share comparable source-sequence evidence. Cash and Equity use the direct cash row and remain provisional for that cash subaccount.'
                    : (isProvisional
                        ? 'An earlier or current HSBC order in this account has not reached a matched SEC cash settlement. Cash and Equity are provisional until HSBC posts every settlement leg.'
                        : ''));
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
        getHsbcDirectCashPhysicalEvidenceIdentity,
        getValidatedHsbcAvailableCashAfter,
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
