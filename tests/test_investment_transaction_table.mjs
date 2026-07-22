/* Tests for Investment transaction-table state. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_HISTORY_PAGE_SIZE,
    INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION,
    buildInvestmentHistoryPage,
    getInvestmentHistoryPageForLedgerNos,
    getInvestmentHistoryTotalPages,
    isInvestmentHistoryDisplayHidden,
    selectVisibleInvestmentHistoryTransactions,
} from '../app/web/static/assets/js/investment/transaction-table.js';

test('publishes the transaction-table boundary and canonical page size', () => {
    assert.match(INVESTMENT_TRANSACTION_TABLE_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
    assert.equal(INVESTMENT_HISTORY_PAGE_SIZE, 100);
});

test('recognizes only explicit presentation-hidden rows', () => {
    assert.equal(isInvestmentHistoryDisplayHidden({presentation_hidden: true}), true);
    assert.equal(isInvestmentHistoryDisplayHidden({presentation_hidden: false}), false);
    assert.equal(isInvestmentHistoryDisplayHidden({}), false);
    assert.equal(isInvestmentHistoryDisplayHidden(null), false);
});

test('applies side and currency filters without range work for Max', () => {
    const rows = [
        {txn: {ledger_no: 1, side: 'buy', currency: 'USD'}, dateLabel: '2026-07-01'},
        {txn: {ledger_no: 2, side: 'sell', currency: 'USD'}, dateLabel: '2026-07-02'},
        {txn: {ledger_no: 3, side: 'buy', currency: 'HKD'}, dateLabel: '2026-07-03'},
    ];
    let rangeLabelsCalled = false;
    const selected = selectVisibleInvestmentHistoryTransactions({
        brokerFilteredRows: rows,
        selectedRange: 'max',
        matchesSide: (txn) => txn.side === 'buy',
        matchesCurrency: (txn) => txn.currency === 'USD',
        normalizeRange: (value) => value,
        getRangeLabels: () => {
            rangeLabelsCalled = true;
            return [];
        },
    });

    assert.deepEqual(selected.map((txn) => txn.ledger_no), [1]);
    assert.equal(rangeLabelsCalled, false);
});

test('intersects filtered rows with the visible chart-date range', () => {
    const rows = [
        {txn: {ledger_no: 1}, dateLabel: '2026-07-01'},
        {txn: {ledger_no: 2}, dateLabel: '2026-07-02'},
        {txn: {ledger_no: 3}, dateLabel: '2026-07-03'},
    ];
    const selected = selectVisibleInvestmentHistoryTransactions({
        brokerFilteredRows: rows,
        chartPoints: [{date: '2026-07-02'}, {date: '2026-07-03'}],
        selectedRange: '1w',
        matchesSide: () => true,
        matchesCurrency: () => true,
        normalizeRange: (value) => value,
        getRangeLabels: (labels) => labels,
    });

    assert.deepEqual(selected.map((txn) => txn.ledger_no), [2, 3]);
});

test('keeps filtered rows when a non-Max chart range has no labels', () => {
    const rows = [{txn: {ledger_no: 7}, dateLabel: '2026-07-07'}];
    const selected = selectVisibleInvestmentHistoryTransactions({
        brokerFilteredRows: rows,
        selectedRange: '1m',
        matchesSide: () => true,
        matchesCurrency: () => true,
        normalizeRange: (value) => value,
        getRangeLabels: () => [],
    });

    assert.deepEqual(selected.map((txn) => txn.ledger_no), [7]);
});

test('builds reversed, clamped table pages without mutating source order', () => {
    const source = Array.from({length: 205}, (_, index) => ({ledger_no: index + 1}));
    const page = buildInvestmentHistoryPage(source, 99);

    assert.equal(page.totalPages, 3);
    assert.equal(page.currentPage, 3);
    assert.deepEqual(page.pageTransactions.map((txn) => txn.ledger_no), [5, 4, 3, 2, 1]);
    assert.deepEqual(source.slice(0, 3).map((txn) => txn.ledger_no), [1, 2, 3]);
    assert.equal(getInvestmentHistoryTotalPages(205), 3);
    assert.equal(getInvestmentHistoryTotalPages(0), 1);
});

test('resets pages and locates ledger numbers in rendered descending order', () => {
    const source = Array.from({length: 250}, (_, index) => ({ledger_no: index + 1}));
    const page = buildInvestmentHistoryPage(source, 3, {resetPage: true});

    assert.equal(page.currentPage, 1);
    assert.equal(page.pageTransactions[0].ledger_no, 250);
    assert.equal(getInvestmentHistoryPageForLedgerNos(page.visibleTransactions, [151]), 1);
    assert.equal(getInvestmentHistoryPageForLedgerNos(page.visibleTransactions, [150]), 2);
    assert.equal(getInvestmentHistoryPageForLedgerNos(page.visibleTransactions, [999]), 0);
});
