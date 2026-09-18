/**
 * Dated broker interest-accrual NAV boundaries.
 *
 * Code version: v1.0.0
 * - Added: Broker-reported accrued interest is a separate NAV component. It
 *   is applied only at its statement as-of boundary, never folded into cash,
 *   and never carried forward to later dates.
 */

export function createInvestmentInterestAccrualUtils(runtime) {
    const convertAmountToBaseCurrency = (...args) => runtime.convertAmountToBaseCurrency(...args);
    const getInvestmentBaseCurrency = (...args) => runtime.getInvestmentBaseCurrency(...args);
    const normalizeCurrencyCode = (...args) => runtime.normalizeCurrencyCode(...args);
    const normalizeLedgerDate = (...args) => runtime.normalizeLedgerDate(...args);

    function normalizeInterestAccrualBrokerCode(value) {
        const normalizedBroker = String(value || '').trim().toLowerCase();
        return normalizedBroker === 'longbridge' ? 'longbridge_hk' : normalizedBroker;
    }

    function getDefaultInterestAccrualRowBrokerCode(txn) {
        return normalizeInterestAccrualBrokerCode(
            txn?.broker || txn?.source?.broker || window.WORTHWARD_INVESTMENT_DATA?.broker || 'ibkr',
        );
    }

    // Returns broker -> as-of date -> reported native-currency components.
    // Only `reported` boundaries carry an amount; conflicting, undated, or
    // incomplete evidence stays unknown and is never replaced by zero.
    function getInvestmentInterestAccrualBoundaries() {
        const boundaries = new Map();
        const brokerSnapshots = window.WORTHWARD_INVESTMENT_DATA?.broker_snapshots;
        if (!brokerSnapshots || typeof brokerSnapshots !== 'object') return boundaries;
        Object.values(brokerSnapshots).forEach((snapshot) => {
            const brokerCode = normalizeInterestAccrualBrokerCode(snapshot?.broker);
            const entries = snapshot?.interest_accrual_snapshots;
            if (!brokerCode || !Array.isArray(entries)) return;
            entries.forEach((entry) => {
                if (entry?.status !== 'reported') return;
                const asOf = normalizeLedgerDate(entry?.as_of);
                const currency = normalizeCurrencyCode(entry?.currency);
                const rawAmount = String(entry?.amount ?? '').trim();
                const amount = Number(rawAmount);
                if (!asOf || !currency || !rawAmount || !Number.isFinite(amount)) return;
                if (!boundaries.has(brokerCode)) boundaries.set(brokerCode, new Map());
                const brokerBoundaries = boundaries.get(brokerCode);
                if (!brokerBoundaries.has(asOf)) brokerBoundaries.set(asOf, []);
                brokerBoundaries.get(asOf).push({currency, amount});
            });
        });
        return boundaries;
    }

    function convertInterestAccrualComponents(components, asOf, fxTimeline, baseCurrency) {
        // A missing FX rate yields NaN so the boundary equity fails closed.
        return components.reduce((total, component) => total + convertAmountToBaseCurrency(
            component.amount,
            component.currency,
            asOf,
            fxTimeline,
            baseCurrency,
        ), 0);
    }

    // Returns null when no reported boundary is effective on this ledger date.
    function getInvestmentInterestAccrualOnDate(ledgerDate, {
        brokerCodes = null,
        fxTimeline = null,
        baseCurrency = getInvestmentBaseCurrency(),
        boundaries = getInvestmentInterestAccrualBoundaries(),
    } = {}) {
        const targetDate = normalizeLedgerDate(ledgerDate);
        if (!targetDate) return null;
        const brokerFilter = brokerCodes
            ? new Set(Array.from(brokerCodes, (code) => normalizeInterestAccrualBrokerCode(code)))
            : null;
        const byBroker = {};
        let amount = 0;
        let hasBoundary = false;
        boundaries.forEach((brokerBoundaries, brokerCode) => {
            if (brokerFilter && !brokerFilter.has(brokerCode)) return;
            const components = brokerBoundaries.get(targetDate);
            if (!components?.length) return;
            const brokerAmount = convertInterestAccrualComponents(components, targetDate, fxTimeline, baseCurrency);
            byBroker[brokerCode] = brokerAmount;
            amount += brokerAmount;
            hasBoundary = true;
        });
        return hasBoundary ? {amount, byBroker} : null;
    }

    function addInterestAccrualToEquityField(record, fieldName, accrual) {
        const currentValue = record?.[fieldName];
        if (currentValue === null || currentValue === undefined || currentValue === '') return;
        const numericValue = Number(currentValue);
        if (!Number.isFinite(numericValue)) return;
        const nextValue = numericValue + accrual;
        record[fieldName] = Number.isFinite(nextValue) ? nextValue : null;
    }

    // The boundary row is the broker's last replay row on the statement as-of
    // date: that row carries the broker's end-of-day NAV. Aggregate rows on the
    // same date from that row onward include it; earlier same-day rows and any
    // later date do not, because no accrual movement evidence exists there.
    function applyInvestmentInterestAccrualBoundaries(processedTransactions, {
        fxTimeline = null,
        baseCurrency = getInvestmentBaseCurrency(),
        getBrokerCode = getDefaultInterestAccrualRowBrokerCode,
    } = {}) {
        const rows = Array.isArray(processedTransactions) ? processedTransactions : [];
        const boundaries = getInvestmentInterestAccrualBoundaries();
        if (!rows.length || !boundaries.size) return [];
        const lastRowIndexByBrokerDate = new Map();
        rows.forEach((txn, rowIndex) => {
            const brokerCode = normalizeInterestAccrualBrokerCode(getBrokerCode(txn));
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (brokerCode && ledgerDate) {
                lastRowIndexByBrokerDate.set(`${brokerCode}|${ledgerDate}`, rowIndex);
            }
        });
        const applied = [];
        boundaries.forEach((brokerBoundaries, brokerCode) => {
            brokerBoundaries.forEach((components, asOf) => {
                const boundaryIndex = lastRowIndexByBrokerDate.get(`${brokerCode}|${asOf}`);
                if (boundaryIndex === undefined) return;
                const accrual = convertInterestAccrualComponents(components, asOf, fxTimeline, baseCurrency);
                const boundaryRow = rows[boundaryIndex];
                boundaryRow.broker_interest_accrual = accrual;
                boundaryRow.broker_interest_accrual_as_of = asOf;
                addInterestAccrualToEquityField(boundaryRow, 'broker_total_equity', accrual);
                addInterestAccrualToEquityField(boundaryRow, 'history_broker_equity', accrual);
                for (let rowIndex = boundaryIndex; rowIndex < rows.length; rowIndex += 1) {
                    const row = rows[rowIndex];
                    if (normalizeLedgerDate(row?.date) !== asOf) break;
                    row.aggregate_interest_accrual = (Number(row.aggregate_interest_accrual) || 0) + accrual;
                    addInterestAccrualToEquityField(row, 'aggregate_total_equity', accrual);
                    addInterestAccrualToEquityField(row, 'total_equity', accrual);
                    addInterestAccrualToEquityField(row, 'aggregate_history_total_equity', accrual);
                }
                applied.push({brokerCode, asOf, amount: accrual, rowIndex: boundaryIndex});
            });
        });
        return applied;
    }

    return {
        getInvestmentInterestAccrualRowBrokerCode: getDefaultInterestAccrualRowBrokerCode,
        getInvestmentInterestAccrualBoundaries,
        getInvestmentInterestAccrualOnDate,
        applyInvestmentInterestAccrualBoundaries,
    };
}
