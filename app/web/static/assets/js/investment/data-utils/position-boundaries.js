/**
 * Authoritative broker position snapshots and scoped replay boundary evidence.
 *
 * Code version: v1.0.0
 * - Added: Extracted boundary normalization with injected reconciliation dependencies.
 */

export function createInvestmentPositionBoundaryUtils(runtime) {
    const {
        getAuthoritativeSnapshotFiniteNumber,
        getBrokerRealizedPnlReconciliationMap,
        getInvestmentCanonicalTicker,
        getInvestmentReplayTransactionQuantity,
        getNormalizedTransactionType,
        getTransactionLotScope,
        normalizeAuthoritativePositionSnapshot,
        normalizeInvestmentLotScopeAccount,
        normalizeLedgerDate,
    } = runtime;

    function getAuthoritativePositionSnapshot() {
        if (window.WORTHWARD_INVESTMENT_DATA?.summary?.position_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePositionSnapshot(
            window.WORTHWARD_INVESTMENT_DATA?.position_snapshot,
        );
    }

    function getHistoricalPositionSnapshotDateTime(value) {
        const match = String(value || '').trim().match(
            /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/,
        );
        if (!match) return '';
        const [, year, month, day, hour = '23', minute = '59', second = '59'] = match;
        const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
        if (
            !Number.isFinite(date.getTime())
            || date.getUTCFullYear() !== Number(year)
            || date.getUTCMonth() + 1 !== Number(month)
            || date.getUTCDate() !== Number(day)
            || date.getUTCHours() !== Number(hour)
            || date.getUTCMinutes() !== Number(minute)
            || date.getUTCSeconds() !== Number(second)
        ) return '';
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    function getAuthoritativeBrokerPositionSnapshots() {
        const data = window.WORTHWARD_INVESTMENT_DATA || {};
        const snapshotsByAccount = new Map();
        const seenAccounts = new Set();
        const addSnapshot = (broker, summary) => {
            if (!summary) return;
            if (!Object.prototype.hasOwnProperty.call(summary, 'position_snapshot_authoritative')
                && !summary.position_snapshot) return;
            const normalizedBroker = String(summary.broker || broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            const accountId = String(summary.account_id ?? summary.account ?? '').trim();
            const accountToken = normalizeInvestmentLotScopeAccount(normalizedBroker, accountId);
            const key = `${normalizedBroker}|${accountToken}`;
            if (seenAccounts.has(key)) return;
            seenAccounts.add(key);
            const rawSnapshot = summary.position_snapshot;
            if (summary.position_snapshot_authoritative !== true || !rawSnapshot || typeof rawSnapshot !== 'object') return;
            const snapshot = {
                broker: normalizedBroker, accountId, accountToken,
                positionSnapshotAsOf: normalizeLedgerDate(summary.position_snapshot_as_of)
                    || Object.values(rawSnapshot).map((entry) => normalizeLedgerDate(entry?.as_of ?? entry?.asOf)).filter(Boolean).sort().at(-1)
                    || '',
                positionSnapshot: normalizeAuthoritativePositionSnapshot(rawSnapshot),
                positionSnapshotRaw: rawSnapshot,
                positionSnapshotEvidenceId: String(summary.position_snapshot_evidence_id || '').trim(),
                holdingsValidation: summary.holdings_validation || null,
                realizedPnlReconciliation: getBrokerRealizedPnlReconciliationMap(
                    normalizedBroker, accountId, summary.realized_pnl_reconciliation,
                ),
            };
            const selectedBoundary = getBrokerPositionSnapshotBoundaryDateTime(snapshot);
            snapshot.historicalPositionSnapshots = normalizedBroker === 'ibkr'
                && accountId && getHistoricalPositionSnapshotDateTime(selectedBoundary)
                && Array.isArray(summary.evidence)
                ? summary.evidence.flatMap((evidence) => {
                    if (!evidence || typeof evidence !== 'object') return [];
                    const evidenceBroker = String(evidence.broker || '').trim().toLowerCase();
                    const evidenceAccount = String(evidence.account_id ?? evidence.account ?? '').trim();
                    const evidenceId = String(evidence.evidence_id || '').trim();
                    const evidenceSource = String(evidence.position_snapshot_source || '').trim();
                    const evidenceSnapshot = evidence.position_snapshot;
                    if (
                        evidenceBroker !== normalizedBroker
                        || !evidenceAccount
                        || normalizeInvestmentLotScopeAccount(evidenceBroker, evidenceAccount) !== accountToken
                        || !evidenceId
                        || !evidenceSource
                        || evidence.position_snapshot_authoritative !== true
                        || !evidenceSnapshot
                        || typeof evidenceSnapshot !== 'object'
                        || Array.isArray(evidenceSnapshot)
                        || !Object.keys(evidenceSnapshot).length
                    ) return [];
                    const rawDates = [evidence.position_snapshot_as_of || evidence.snapshot_as_of];
                    const invalidPosition = Object.values(evidenceSnapshot).some((entry) => {
                        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
                        const quantity = getAuthoritativeSnapshotFiniteNumber(entry.quantity);
                        if (quantity === null || quantity < 0) return true;
                        const rawDate = entry.as_of ?? entry.asOf;
                        if (rawDate !== undefined && rawDate !== null && String(rawDate).trim()) {
                            rawDates.push(rawDate);
                        }
                        return false;
                    });
                    if (invalidPosition) return [];
                    const datedValues = rawDates.filter((value) => String(value || '').trim());
                    if (!datedValues.length || datedValues.some((value) => {
                        const normalizedDateTime = getHistoricalPositionSnapshotDateTime(value);
                        if (!normalizedDateTime) return true;
                        return String(value).trim().length === 10
                            ? normalizedDateTime.slice(0, 10) > selectedBoundary.slice(0, 10)
                            : normalizedDateTime > selectedBoundary;
                    })) return [];
                    const datedSnapshot = Object.fromEntries(Object.entries(evidenceSnapshot).map(
                        ([ticker, entry]) => {
                            const rawDate = entry.as_of ?? entry.asOf;
                            return [ticker, rawDate && String(rawDate).trim()
                                ? {...entry, as_of: getHistoricalPositionSnapshotDateTime(rawDate)}
                                : entry];
                        },
                    ));
                    const historicalSnapshot = {
                        broker: evidenceBroker,
                        accountId: evidenceAccount,
                        accountToken,
                        positionSnapshotAsOf: normalizeLedgerDate(
                            evidence.position_snapshot_as_of || evidence.snapshot_as_of,
                        ),
                        positionSnapshot: normalizeAuthoritativePositionSnapshot(datedSnapshot),
                        positionSnapshotRaw: datedSnapshot,
                        positionSnapshotEvidenceId: evidenceId,
                        holdingsValidation: evidence.holdings_validation || null,
                    };
                    const boundary = getBrokerPositionSnapshotBoundaryDateTime(historicalSnapshot);
                    return getHistoricalPositionSnapshotDateTime(boundary)
                        && boundary <= selectedBoundary ? [historicalSnapshot] : [];
                }).sort((left, right) => (
                    getBrokerPositionSnapshotBoundaryDateTime(right).localeCompare(
                        getBrokerPositionSnapshotBoundaryDateTime(left),
                    )
                ))
                : [];
            snapshotsByAccount.set(key, snapshot);
        };
        Object.values(data.broker_snapshots || {}).forEach((snapshot) => addSnapshot(snapshot?.broker, snapshot));
        Object.entries(data.broker_summaries || {}).forEach(([broker, summary]) => addSnapshot(broker, summary));
        return [...snapshotsByAccount.values()];
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
        if (!normalizedEntry || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;
        const rawQuantity = getAuthoritativeSnapshotFiniteNumber(rawEntry.quantity);
        const quantity = getAuthoritativeSnapshotFiniteNumber(normalizedEntry.quantity);
        const costPrice = normalizedEntry.costBasisStatus === 'known'
            ? getAuthoritativeSnapshotFiniteNumber(normalizedEntry.costPrice)
            : null;
        if (rawQuantity === null || quantity === null || quantity < 0 || (costPrice !== null && costPrice < 0)) return null;
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

    return {
        getAuthoritativePositionSnapshot,
        getAuthoritativeBrokerPositionSnapshots,
        normalizeLedgerDateTime,
        getInvestmentTransactionDateTime,
        getAuthoritativeBrokerPositionBoundary,
        getBrokerPositionSnapshotBoundaryDateTime,
        derivePartialBrokerPositionBoundaryFromHistory,
    };
}
