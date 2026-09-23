/**
 * Corroborate a pasted cash row against the opening balance of SEC postings.
 *
 * Code version: v1.0.0
 */

export function createHsbcOpeningCashCorroborationMatcher(
    transactions,
    boundaries,
    {
        normalizeLedgerDate,
        isHsbcCashEvidenceTransaction,
        getHsbcCashEvidenceState,
        parseFiniteNonBlankHsbcNumber,
    },
) {
    const openingCashRows = new Map();
    const boundariesByDateAndScope = new Map();
    boundaries.forEach((boundary) => {
        const key = `${normalizeLedgerDate(boundary?.date)}|${boundary.cashScopeKey}`;
        if (!boundariesByDateAndScope.has(key)) boundariesByDateAndScope.set(key, []);
        boundariesByDateAndScope.get(key).push(boundary);
    });
    boundariesByDateAndScope.forEach((sameScopeBoundaries, key) => {
        const domains = new Set(sameScopeBoundaries.map((boundary) => (
            `${boundary.sourceFileKind}|${boundary.sourceSequenceSha256}|${boundary.sourceSequenceDirection}`
        )));
        if (domains.size !== 1) return;
        const ordered = [...sameScopeBoundaries].sort((left, right) => (
            (Number(left.sourceRowSequence) - Number(right.sourceRowSequence))
            * (Number(left.sourceSequenceDirection) || 1)
        ));
        const first = ordered[0];
        const firstAmount = parseFiniteNonBlankHsbcNumber(first?.settlementAmount);
        const firstBalance = parseFiniteNonBlankHsbcNumber(first?.settlementBalanceAfter);
        if (firstAmount === null || firstBalance === null) return;
        const hasContinuousBalances = ordered.every((boundary, index) => {
            if (!index) return true;
            const amount = parseFiniteNonBlankHsbcNumber(boundary?.settlementAmount);
            const balance = parseFiniteNonBlankHsbcNumber(boundary?.settlementBalanceAfter);
            const priorBalance = parseFiniteNonBlankHsbcNumber(
                ordered[index - 1]?.settlementBalanceAfter,
            );
            return amount !== null && balance !== null && priorBalance !== null
                && Math.abs(balance - amount - priorBalance) <= 1e-6;
        });
        if (!hasContinuousBalances) return;
        const [date, ...scopeParts] = key.split('|');
        const scopeKey = scopeParts.join('|');
        const foreignCashRows = transactions.filter((txn) => {
            if (normalizeLedgerDate(txn?.date) !== date
                || !isHsbcCashEvidenceTransaction(txn)) return false;
            const evidence = getHsbcCashEvidenceState(txn);
            return evidence.descriptor.cashScopeKey === scopeKey
                && (
                    evidence.descriptor.sourceFileKind !== first.sourceFileKind
                    || evidence.descriptor.sourceSequenceSha256 !== first.sourceSequenceSha256
                );
        });
        if (foreignCashRows.length !== 1) return;
        const cashRow = foreignCashRows[0];
        const source = cashRow?.source || {};
        // A legacy pasted row can carry a CSV-only marker. Independent CSV
        // balances must prove its position before that marker is disregarded.
        const markerOnlyCandidate = source.file_kind === 'hsbc_usd_account_text'
            && source.ledger_sequence_order === 'chronological'
            ? {...cashRow, source: {...source, ledger_sequence_order: ''}}
            : cashRow;
        const evidence = getHsbcCashEvidenceState(markerOnlyCandidate);
        if (evidence.isConsistent
            && evidence.balance !== null
            && Math.abs(evidence.balance - (firstBalance - firstAmount)) <= 1e-6) {
            openingCashRows.set(key, cashRow);
        }
    });
    return (txn, boundary) => (
        openingCashRows.get(`${normalizeLedgerDate(boundary?.date)}|${boundary?.cashScopeKey}`)
            === txn
    );
}
