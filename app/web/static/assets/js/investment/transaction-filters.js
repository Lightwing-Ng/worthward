/**
 * Investment transaction filter state helpers.
 *
 * Code version: v1.0.0
 */

export const INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION = 'v1.0.0';

export function normalizeInvestmentBroker(broker) {
    const normalizedBroker = String(broker || '').trim().toLowerCase();
    if (normalizedBroker === 'longbridge') return 'longbridge_hk';
    return normalizedBroker || 'ibkr';
}

export function sortInvestmentBrokerFilterCodes(brokerCodes = [], {
    labels = {},
    sortKeys = {},
    locale = 'zh-CN',
} = {}) {
    const collator = new Intl.Collator(locale, {sensitivity: 'base', numeric: true});
    const normalizedCodes = Array.from(new Set(
        (Array.isArray(brokerCodes) ? brokerCodes : [])
            .map((brokerCode) => normalizeInvestmentBroker(brokerCode))
            .filter(Boolean),
    ));
    const getSortKey = (brokerCode) => (
        String(sortKeys[brokerCode] || labels[brokerCode] || brokerCode).trim().toLowerCase()
    );
    return normalizedCodes.sort((leftCode, rightCode) => {
        const bySortKey = collator.compare(getSortKey(leftCode), getSortKey(rightCode));
        if (bySortKey !== 0) return bySortKey;
        return leftCode.localeCompare(rightCode);
    });
}

export function buildInvestmentBrokerFilterIndex(transactions = [], {
    isHidden = () => false,
    getBrokerCode = (transaction) => transaction?.broker,
    normalizeDate = (value) => String(value || ''),
    payloadBrokers = [],
    labels = {},
    sortKeys = {},
} = {}) {
    const source = Array.isArray(transactions) ? transactions : [];
    const allRows = [];
    const byBroker = new Map();
    source.forEach((txn, index) => {
        if (isHidden(txn)) return;
        const brokerCode = normalizeInvestmentBroker(getBrokerCode(txn));
        if (!brokerCode) return;
        const row = {
            txn,
            index,
            brokerCode,
            dateLabel: normalizeDate(txn?.date),
        };
        allRows.push(row);
        if (!byBroker.has(brokerCode)) byBroker.set(brokerCode, []);
        byBroker.get(brokerCode).push(row);
    });
    const sortOptions = {labels, sortKeys};
    const ledgerBrokerCodes = sortInvestmentBrokerFilterCodes(Array.from(byBroker.keys()), sortOptions);
    const payloadBrokerCodes = sortInvestmentBrokerFilterCodes(payloadBrokers, sortOptions);
    const availableCodes = ledgerBrokerCodes.length ? ledgerBrokerCodes : payloadBrokerCodes;
    return {
        source,
        allRows,
        byBroker,
        availableCodes,
        availableSet: new Set(availableCodes),
    };
}

export function isInvestmentBrokerFilterAllSelected(selectedCodes, availableCodes = []) {
    if (!availableCodes.length) return true;
    if (!(selectedCodes instanceof Set) || !selectedCodes.size) return false;
    return availableCodes.every((brokerCode) => selectedCodes.has(brokerCode));
}

export function selectInvestmentBrokerRows(index, selectedCodes) {
    const availableBrokerCodes = Array.isArray(index?.availableCodes) ? index.availableCodes : [];
    if (!availableBrokerCodes.length) return [];
    if (isInvestmentBrokerFilterAllSelected(selectedCodes, availableBrokerCodes)) return index.allRows;
    if (!(selectedCodes instanceof Set) || !selectedCodes.size) return [];
    const selectedBrokerList = availableBrokerCodes.filter((brokerCode) => selectedCodes.has(brokerCode));
    if (selectedBrokerList.length === 1) return index.byBroker.get(selectedBrokerList[0]) || [];
    if (selectedBrokerList.length > Math.max(1, availableBrokerCodes.length / 2)) {
        return index.allRows.filter((row) => selectedCodes.has(row.brokerCode));
    }
    return selectedBrokerList
        .flatMap((brokerCode) => index.byBroker.get(brokerCode) || [])
        .sort((left, right) => left.index - right.index);
}

export function getAvailableInvestmentCurrencyCodes(transactions = [], {
    isHidden = () => false,
    formatCurrency = (transaction) => transaction?.currency,
} = {}) {
    return Array.from(new Set(
        (Array.isArray(transactions) ? transactions : [])
            .filter((txn) => !isHidden(txn))
            .map((txn) => String(formatCurrency(txn) || '').trim().toUpperCase())
            .filter((currency) => /^[A-Z]{3}$/.test(currency)),
    )).sort((left, right) => left.localeCompare(right));
}

export function normalizeInvestmentCurrencyFilter(value, availableCurrencies = []) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || normalized === 'ALL') return 'all';
    return availableCurrencies.includes(normalized) ? normalized : 'all';
}

export function matchesInvestmentCurrencyFilter(transaction, selectedCurrency, formatCurrency) {
    if (selectedCurrency === 'all') return true;
    return String(formatCurrency(transaction) || '').trim().toUpperCase() === selectedCurrency;
}

export function matchesInvestmentDateFilter(transaction, dateFilter, normalizeDate = (value) => String(value || '')) {
    const mode = String(dateFilter?.mode || 'all');
    const value = String(dateFilter?.value || '').trim();
    if (mode === 'all' || !value) return true;
    const transactionDate = normalizeDate(transaction?.date);
    if (!transactionDate) return false;
    if (mode === 'day') return transactionDate === value;
    if (mode === 'month') return transactionDate.startsWith(`${value}-`);
    return false;
}
