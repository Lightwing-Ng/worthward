/**
 * Dated native-currency cash anchors in HSBC Transaction History.
 *
 * Code version: v1.0.0
 * - Added: A dated authoritative balance retires settlement corrections in
 *   its currency, so a correction computed on the replay balance is never
 *   added to cash that the dated snapshot has already replaced.
 */

export const HSBC_DATED_CASH_ANCHOR_CONFLICT_REASON = (
    'A dated HSBC cash balance predates a settlement posting in the same currency. '
    + 'Cash and Equity use the dated balance and remain provisional until the '
    + 'balance and its postings share one as-of boundary.'
);

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
