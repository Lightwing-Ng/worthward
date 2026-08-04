/**
 * Investment transaction filter state helpers.
 *
 * Code version: v1.3.0
 * - Fixed: Mainland CNY rows remain CNY while offshore RMB rows retain the CNH filter.
 * - Added: Description filtering can isolate the unresolved internal-transfer rows that need a binding.
 */

export const INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION = 'v1.3.0';

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

export function normalizeInvestmentTransactionCurrency(value) {
    const normalizedCurrency = String(value || '').trim().toUpperCase();
    if (['CNY', 'RMB'].includes(normalizedCurrency)) return 'CNH';
    return normalizedCurrency;
}

function isMainlandCnyBroker(transaction) {
    const broker = normalizeInvestmentBroker(transaction?.broker || transaction?.source?.broker);
    return broker === 'cmb_cn' || broker === 'cmb' || broker.endsWith('_cn');
}

export function normalizeInvestmentTransactionCurrencyForFilter(
    transaction,
    formatCurrency = (row) => row?.currency,
) {
    const row = transaction?.txn ?? transaction;
    const rawCurrency = String(formatCurrency(row) || '').trim().toUpperCase();
    if (['CNY', 'RMB'].includes(rawCurrency) && isMainlandCnyBroker(row)) return 'CNY';
    return normalizeInvestmentTransactionCurrency(rawCurrency);
}

export function selectInvestmentCurrencyRows(
    rows = [],
    selectedCurrency = 'all',
    formatCurrency = (transaction) => transaction?.currency,
) {
    const source = Array.isArray(rows) ? rows : [];
    const normalizedCurrency = normalizeInvestmentTransactionCurrency(selectedCurrency);
    const normalizedSelectedCurrency = String(selectedCurrency || '').trim().toUpperCase() === 'CNY'
        ? 'CNY'
        : normalizedCurrency;
    if (!normalizedSelectedCurrency || normalizedSelectedCurrency === 'ALL') return source;
    return source.filter((row) => {
        const transaction = row?.txn ?? row;
        return normalizeInvestmentTransactionCurrencyForFilter(transaction, formatCurrency)
            === normalizedSelectedCurrency;
    });
}

export function selectInvestmentBrokerCurrencyRows(
    index,
    selectedCodes,
    selectedCurrency = 'all',
    formatCurrency = (transaction) => transaction?.currency,
) {
    return selectInvestmentCurrencyRows(
        selectInvestmentBrokerRows(index, selectedCodes),
        selectedCurrency,
        formatCurrency,
    );
}

export function getAvailableInvestmentCurrencyCodes(transactions = [], {
    isHidden = () => false,
    formatCurrency = (transaction) => transaction?.currency,
} = {}) {
    return Array.from(new Set(
        (Array.isArray(transactions) ? transactions : [])
            .filter((txn) => !isHidden(txn))
            .map((txn) => normalizeInvestmentTransactionCurrencyForFilter(txn, formatCurrency))
            .filter((currency) => /^[A-Z]{3}$/.test(currency)),
    )).sort((left, right) => left.localeCompare(right));
}

export function normalizeInvestmentCurrencyFilter(value, availableCurrencies = []) {
    const raw = String(value || '').trim().toUpperCase();
    const normalized = availableCurrencies.includes(raw)
        ? raw
        : normalizeInvestmentTransactionCurrency(raw);
    if (!normalized || normalized === 'ALL') return 'all';
    return availableCurrencies.includes(normalized) ? normalized : 'all';
}

export function matchesInvestmentCurrencyFilter(transaction, selectedCurrency, formatCurrency) {
    if (selectedCurrency === 'all') return true;
    return normalizeInvestmentTransactionCurrencyForFilter(transaction, formatCurrency)
        === selectedCurrency;
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

export function isInvestmentTransactionUnbound(transaction) {
    const row = transaction?.txn ?? transaction;
    return row?.manual_internal_transfer_needs_binding === true
        && Number(row?.manual_internal_transfer_candidate_count || 0) > 0;
}

export function hasInvestmentUnboundTransactions(transactions = []) {
    return (Array.isArray(transactions) ? transactions : []).some((transaction) => (
        isInvestmentTransactionUnbound(transaction)
    ));
}

export function normalizeInvestmentDescriptionBindingFilter(value, transactions = []) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (normalizedValue !== 'unbound') return 'all';
    return hasInvestmentUnboundTransactions(transactions) ? 'unbound' : 'all';
}

export function selectInvestmentDescriptionBindingRows(rows = [], selectedFilter = 'all') {
    const source = Array.isArray(rows) ? rows : [];
    return String(selectedFilter || '').trim().toLowerCase() === 'unbound'
        ? source.filter((row) => isInvestmentTransactionUnbound(row))
        : source;
}
