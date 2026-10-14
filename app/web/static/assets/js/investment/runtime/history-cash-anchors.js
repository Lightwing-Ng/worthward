/**
 * Dated native-currency cash anchors and pending HSBC history cash.
 *
 * Code version: v1.2.0
 * - Added: Settlement accrual retirement and continuous cash evidence helpers.
 * - Added: Projects a pending row from its native USD boundary and dated
 *   foreign balances while retaining the caller's cloning and FX semantics.
 * - Added: A dated authoritative balance retires settlement corrections in
 *   its currency, so a correction computed on the replay balance is never
 *   added to cash that the dated snapshot has already replaced.
 */

export const HSBC_DATED_CASH_ANCHOR_CONFLICT_REASON = (
    'A dated HSBC cash balance predates a settlement posting in the same currency. '
    + 'Cash and Equity use the dated balance and remain provisional until the '
    + 'balance and its postings share one as-of boundary.'
);

export function projectHsbcPendingHistoryCash(txn, {
    baseCurrency,
    pendingCashBoundary,
    ledgerDate,
    cloneCashLedgerBalances,
    convertCashBalances,
}) {
    // The pending boundary replaces only native USD. Foreign cash stays on
    // this row's dated replay, and pending cash is already in base currency.
    // Older settlement corrections must not be added to that USD boundary.
    const balances = cloneCashLedgerBalances(
        txn?.broker_dated_cash_balances
        || txn?.broker_cash_by_currency
        || txn?.calculated_broker_cash_by_currency
        || {},
    );
    balances[baseCurrency] = Number(pendingCashBoundary);
    return convertCashBalances(balances, ledgerDate)
        + (Number(txn?.broker_pending_settlement_cash) || 0);
}

/**
 * Apply the active dated anchors of one projected history row.
 *
 * A dated balance is the end-of-day ledger state of its as-of date, so it
 * already includes every posting dated on or before that day. A posting dated
 * later cannot be ordered against it; its correction is retired as well, but
 * the cash scope and every row using that anchor remain provisional.
 *
 * @returns {string} The provisional reason for an anchor conflict, or ''.
 */
export function retireAnchoredHsbcSettlementCorrections(txn, {
    corrections,
    settlementBoundaries,
    ambiguousCashScopes,
    conflictingAnchorKeys,
}) {
    const anchors = txn?.broker_dated_cash_anchors;
    if (!anchors || typeof anchors !== 'object') return '';
    const anchorKey = (currency) => `${currency}|${anchors[currency]?.asOf || ''}`;
    new Set([...corrections.keys(), ...settlementBoundaries.keys()]).forEach((cashScopeKey) => {
        const currency = String(cashScopeKey).split('|').pop();
        const asOf = String(anchors[currency]?.asOf || '');
        if (!asOf) return;
        const hasLaterBoundary = (settlementBoundaries.get(cashScopeKey) || []).some((boundary) => (
            !boundary?.settlementDate || boundary.settlementDate > asOf
        ));
        if (hasLaterBoundary) {
            ambiguousCashScopes.add(cashScopeKey);
            conflictingAnchorKeys.add(anchorKey(currency));
        }
        corrections.delete(cashScopeKey);
        settlementBoundaries.delete(cashScopeKey);
    });
    return Object.keys(anchors).some((currency) => conflictingAnchorKeys.has(anchorKey(currency)))
        ? HSBC_DATED_CASH_ANCHOR_CONFLICT_REASON
        : '';
}

// Accruals belong to their posting owners until a settlement or a later
// authoritative row absorbs them. Retiring an owner is idempotent even when
// both events represent the same physical posting.
export function createHsbcSettlementAccrualTracker({getBrokerBalances, aggregateBalances, applyDelta, normalizeBroker}) {
    const active = new Set();
    const change = (boundary, sign) => {
        const broker = normalizeBroker(boundary.broker || 'hsbc');
        const currency = boundary.currency;
        const amount = Number(boundary.settlementAmount);
        if (!Number.isFinite(amount)) return;
        applyDelta(getBrokerBalances(broker), currency, sign * amount);
        applyDelta(aggregateBalances, currency, sign * amount);
    };
    const retire = (boundary) => {
        if (!active.delete(boundary)) return;
        change(boundary, -1);
    };
    return {
        add(boundary) {
            if (active.has(boundary)) return;
            active.add(boundary);
            change(boundary, 1);
        },
        retire,
        retireThroughCash(date, descriptor) {
            for (const boundary of active) {
                if (boundary.cashScopeKey !== descriptor.cashScopeKey) continue;
                const sameDomain = boundary.sourceFileKind === descriptor.sourceFileKind
                    && boundary.sourceSequenceSha256 === descriptor.sourceSequenceSha256;
                const direction = descriptor.sourceSequenceDirection;
                const cashSequence = direction < 0 ? descriptor.rowNumber : descriptor.ledgerSequence;
                const boundarySequence = direction < 0 ? boundary.sourceRowNumber : boundary.sourceRowSequence;
                if (boundary.date < date || (boundary.date === date && sameDomain
                    && Number.isFinite(cashSequence) && Number.isFinite(boundarySequence)
                    && direction * (cashSequence - boundarySequence) > 0)) retire(boundary);
            }
        },
    };
}

export function rebaseHsbcUnsettledHistoryCash(txn, {
    boundariesByScope, corrections, classify, getEvidence, setCorrection,
}) {
    const evidence = getEvidence(txn);
    if (!evidence.isConsistent || evidence.balance === null) return;
    const descriptor = evidence.descriptor;
    const boundaries = boundariesByScope.get(descriptor.cashScopeKey) || [];
    const remaining = boundaries.filter((boundary) => classify(txn, evidence, boundary) === 'before');
    if (!remaining.length) return;
    const amount = remaining.reduce((total, boundary) => total + Number(boundary.accrualAmount || 0), 0);
    setCorrection(corrections, descriptor.cashScopeKey, descriptor.currency, amount);
    boundariesByScope.set(descriptor.cashScopeKey, remaining);
}

// A settlement's closing balance can include later booked cash. Remove that
// evidenced intervening movement before projecting the balance at its owner.
export function projectHsbcBoundaryToOwner(boundary, ownerIndex, rows, {
    getEvidence, classify, ownerBalance, ownerBoundaries = new Map(), excludedOwners = new Set(),
}) {
    let laterCash = 0;
    let rollingBalance = ownerBalance;
    rows.slice(ownerIndex + 1).forEach((txn) => {
        const evidence = getEvidence(txn);
        if (!Number.isFinite(rollingBalance) || !evidence.isConsistent || evidence.amount === null
            || evidence.balance === null
            || evidence.descriptor.cashScopeKey !== boundary.cashScopeKey) return;
        // A later array entry can repeat an already-applied closing balance.
        // Only a continuous opening/closing pair proves additional movement.
        let earlierPending = 0;
        ownerBoundaries.forEach((other, otherIndex) => {
            if (otherIndex < ownerIndex && !excludedOwners.has(otherIndex)
                && other.cashScopeKey === boundary.cashScopeKey
                && classify(txn, evidence, other) === 'before') earlierPending += other.accrualAmount;
        });
        const openingBalance = evidence.balance - evidence.amount;
        const continuous = Math.abs(openingBalance - rollingBalance) <= 1e-7;
        const continuousBeforePending = Math.abs(openingBalance - rollingBalance + earlierPending) <= 1e-7;
        if (classify(txn, evidence, boundary) === 'before' && (continuous || continuousBeforePending)) {
            laterCash += evidence.amount;
            rollingBalance = evidence.balance + (continuous ? 0 : earlierPending);
        }
    });
    let tradeOrderAdjustment = 0;
    ownerBoundaries.forEach((other, otherIndex) => {
        if (otherIndex === ownerIndex || excludedOwners.has(otherIndex)
            || other.cashScopeKey !== boundary.cashScopeKey) return;
        const sameDay = other.settlementDate === boundary.settlementDate;
        if (sameDay && (other.sourceFileKind !== boundary.sourceFileKind
            || other.sourceSequenceSha256 !== boundary.sourceSequenceSha256
            || other.sourceSequenceDirection !== boundary.sourceSequenceDirection)) return;
        for (const posting of other.postingAmounts || []) {
            const postingOrder = sameDay
                ? boundary.sourceSequenceDirection * (posting.sequence - boundary.finalPostingSequence)
                : (other.settlementDate < boundary.settlementDate ? -1 : 1);
            // A bank closing balance follows posting order. History follows
            // execution order, with each signed principal and fee counted once.
            if (otherIndex > ownerIndex && postingOrder <= 0) tradeOrderAdjustment -= posting.amount;
            else if (otherIndex < ownerIndex && postingOrder > 0) tradeOrderAdjustment += posting.amount;
        }
    });
    return {...boundary, balanceAfter: boundary.balanceAfter - laterCash + tradeOrderAdjustment};
}
