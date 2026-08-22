/**
 * Investment transaction-table selection and page-state helpers.
 *
 * Code version: v1.0.1
 */

import {
    LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE,
} from '../local-store-pagination.js?v=local-store-pagination-v1.2.2';

export const INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION = 'v1.0.1';
export const INVESTMENT_HISTORY_PAGE_SIZE = LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE;

export function isInvestmentHistoryDisplayHidden(transaction) {
    return transaction?.presentation_hidden === true;
}

export function selectVisibleInvestmentHistoryTransactions({
    brokerFilteredRows = [],
    chartPoints = [],
    selectedRange = 'max',
    matchesSide = () => true,
    matchesCurrency = () => true,
    normalizeRange = (value) => value,
    getRangeLabels = () => [],
} = {}) {
    const filteredRows = (Array.isArray(brokerFilteredRows) ? brokerFilteredRows : [])
        .filter((row) => matchesSide(row?.txn) && matchesCurrency(row?.txn));
    if (normalizeRange(selectedRange) === 'max') {
        return filteredRows.map((row) => row.txn);
    }

    const normalizedChartPoints = Array.isArray(chartPoints) ? chartPoints : [];
    const visibleRangeLabels = new Set(getRangeLabels(
        normalizedChartPoints.map((point) => point?.date),
        selectedRange,
    ));
    if (!visibleRangeLabels.size) {
        return filteredRows.map((row) => row.txn);
    }
    return filteredRows
        .filter((row) => visibleRangeLabels.has(row?.dateLabel))
        .map((row) => row.txn);
}

export function getInvestmentHistoryTotalPages(
    totalRows = 0,
    pageSize = INVESTMENT_HISTORY_PAGE_SIZE,
) {
    const normalizedTotalRows = Math.max(0, Number(totalRows) || 0);
    const normalizedPageSize = Math.max(1, Math.trunc(Number(pageSize) || INVESTMENT_HISTORY_PAGE_SIZE));
    return Math.max(1, Math.ceil(normalizedTotalRows / normalizedPageSize));
}

export function buildInvestmentHistoryPage(
    visibleTransactions = [],
    currentPage = 1,
    {
        pageSize = INVESTMENT_HISTORY_PAGE_SIZE,
        resetPage = false,
    } = {},
) {
    const normalizedPageSize = Math.max(1, Math.trunc(Number(pageSize) || INVESTMENT_HISTORY_PAGE_SIZE));
    const source = Array.isArray(visibleTransactions) ? visibleTransactions : [];
    const descendingTransactions = [...source].reverse();
    const totalPages = getInvestmentHistoryTotalPages(descendingTransactions.length, normalizedPageSize);
    const requestedPage = resetPage ? 1 : Math.max(1, Math.trunc(Number(currentPage) || 1));
    const normalizedCurrentPage = Math.min(totalPages, requestedPage);
    const pageStart = (normalizedCurrentPage - 1) * normalizedPageSize;
    return {
        visibleTransactions: descendingTransactions,
        pageTransactions: descendingTransactions.slice(pageStart, pageStart + normalizedPageSize),
        totalPages,
        currentPage: normalizedCurrentPage,
    };
}

export function getInvestmentHistoryPageForLedgerNos(
    visibleTransactions = [],
    ledgerNos = [],
    pageSize = INVESTMENT_HISTORY_PAGE_SIZE,
) {
    const transactions = Array.isArray(visibleTransactions) ? visibleTransactions : [];
    const normalizedLedgerNos = new Set(
        (Array.isArray(ledgerNos) ? ledgerNos : [])
            .map((ledgerNo) => Number(ledgerNo))
            .filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0),
    );
    if (!transactions.length || !normalizedLedgerNos.size) return 0;
    const targetIndex = transactions.findIndex((transaction) => (
        normalizedLedgerNos.has(Number(transaction?.ledger_no))
    ));
    if (targetIndex < 0) return 0;
    const normalizedPageSize = Math.max(1, Math.trunc(Number(pageSize) || INVESTMENT_HISTORY_PAGE_SIZE));
    return Math.floor(targetIndex / normalizedPageSize) + 1;
}
