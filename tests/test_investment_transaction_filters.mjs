/* Tests for Investment transaction filtering. Code version: v1.3.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION,
    buildInvestmentBrokerFilterIndex,
    getAvailableInvestmentCurrencyCodes,
    hasInvestmentUnboundTransactions,
    isInvestmentBrokerFilterAllSelected,
    isInvestmentTransactionUnbound,
    matchesInvestmentDateFilter,
    normalizeInvestmentBroker,
    normalizeInvestmentDescriptionBindingFilter,
    normalizeInvestmentCurrencyFilter,
    normalizeInvestmentTransactionCurrency,
    normalizeInvestmentTransactionCurrencyForFilter,
    selectInvestmentBrokerCurrencyRows,
    selectInvestmentDescriptionBindingRows,
    selectInvestmentCurrencyRows,
    selectInvestmentBrokerRows,
    sortInvestmentBrokerFilterCodes,
} from '../app/web/static/assets/js/investment/transaction-filters.js';

const rows = [
    {id: 1, broker: 'IBKR', currency: 'usd', date: '2026-07-20'},
    {id: 2, broker: 'longbridge', currency: 'HKD', date: '2026-07-21'},
    {id: 3, broker: 'longbridge_sg', currency: 'SGD', date: '2026-07-21'},
    {id: 4, broker: 'IBKR', currency: '', date: '2026-07-22', hidden: true},
];

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('broker normalization preserves the canonical Longbridge region convention', () => {
    assert.equal(normalizeInvestmentBroker('longbridge'), 'longbridge_hk');
    assert.equal(normalizeInvestmentBroker(' LONGBridge_SG '), 'longbridge_sg');
    assert.equal(normalizeInvestmentBroker(''), 'ibkr');
});

test('broker sorting deduplicates canonical codes and follows configured sort keys', () => {
    assert.deepEqual(
        sortInvestmentBrokerFilterCodes(
            ['longbridge', 'ibkr', 'longbridge_hk', 'hsbc'],
            {
                labels: {ibkr: 'IBKR', hsbc: 'HSBC', longbridge_hk: 'Longbridge (HK)'},
                sortKeys: {longbridge_hk: 'a', hsbc: 'b', ibkr: 'c'},
            },
        ),
        ['longbridge_hk', 'hsbc', 'ibkr'],
    );
});

test('broker index selects sparse broker subsets without reordering ledger rows', () => {
    const index = buildInvestmentBrokerFilterIndex(rows, {
        isHidden: (row) => row.hidden,
        getBrokerCode: (row) => row.broker,
        normalizeDate: (value) => value,
    });
    assert.deepEqual(index.availableCodes, ['ibkr', 'longbridge_hk', 'longbridge_sg']);
    assert.equal(isInvestmentBrokerFilterAllSelected(new Set(index.availableCodes), index.availableCodes), true);
    assert.deepEqual(
        selectInvestmentBrokerRows(index, new Set(['ibkr', 'longbridge_sg'])).map(({txn}) => txn.id),
        [1, 3],
    );
    assert.deepEqual(selectInvestmentBrokerRows(index, new Set()), []);
});

test('currency options exclude hidden rows and reject unsupported selections', () => {
    const available = getAvailableInvestmentCurrencyCodes(rows, {
        isHidden: (row) => row.hidden,
        formatCurrency: (row) => row.currency,
    });
    assert.deepEqual(available, ['HKD', 'SGD', 'USD']);
    assert.equal(normalizeInvestmentCurrencyFilter('sgd', available), 'SGD');
    assert.equal(normalizeInvestmentCurrencyFilter('EUR', available), 'all');
});

test('HSBC HKD selection combines Savings and Current accounts without using account type', () => {
    const hsbcRows = [
        {
            id: 10,
            broker: 'hsbc',
            currency: 'HKD',
            source: {account_type: 'HKD Savings'},
            date: '2023-05-11',
        },
        {
            id: 11,
            broker: 'hsbc',
            currency: 'HKD',
            source: {account_type: 'HKD Current'},
            date: '2023-05-11',
        },
        {
            id: 12,
            broker: 'hsbc',
            currency: 'CNH',
            source: {account_type: 'CNH Savings'},
            date: '2023-05-11',
        },
        {id: 13, broker: 'ibkr', currency: 'HKD', date: '2023-05-11'},
    ];
    const index = buildInvestmentBrokerFilterIndex(hsbcRows, {
        getBrokerCode: (row) => row.broker,
        normalizeDate: (value) => value,
    });

    assert.deepEqual(
        selectInvestmentBrokerCurrencyRows(
            index,
            new Set(['hsbc']),
            'hkd',
            (row) => row.currency,
        ).map(({txn}) => txn.id),
        [10, 11],
    );
    assert.equal(normalizeInvestmentTransactionCurrency('CNY'), 'CNH');
    assert.equal(normalizeInvestmentTransactionCurrency('RMB'), 'CNH');
});

test('mainland CNY and offshore CNH remain distinct currency filters', () => {
    const mixedRows = [
        {id: 20, broker: 'cmb_cn', currency: 'CNY', date: '2024-03-29'},
        {id: 21, broker: 'hsbc', currency: 'CNH', date: '2024-03-29'},
        {id: 22, broker: 'hsbc', currency: 'CNY', date: '2024-03-29'},
    ];
    const index = buildInvestmentBrokerFilterIndex(mixedRows, {
        getBrokerCode: (row) => row.broker,
        normalizeDate: (value) => value,
    });

    assert.equal(normalizeInvestmentTransactionCurrencyForFilter(mixedRows[0]), 'CNY');
    assert.equal(normalizeInvestmentTransactionCurrencyForFilter(mixedRows[1]), 'CNH');
    assert.equal(normalizeInvestmentTransactionCurrencyForFilter(mixedRows[2]), 'CNH');
    assert.deepEqual(getAvailableInvestmentCurrencyCodes(mixedRows), ['CNH', 'CNY']);
    assert.equal(normalizeInvestmentCurrencyFilter('CNY', ['CNY', 'CNH']), 'CNY');
    assert.deepEqual(
        selectInvestmentBrokerCurrencyRows(index, new Set(['cmb_cn']), 'CNY').map(({txn}) => txn.id),
        [20],
    );
    assert.deepEqual(
        selectInvestmentCurrencyRows(mixedRows.map((txn) => ({txn})), 'CNH').map(({txn}) => txn.id),
        [21, 22],
    );
});

test('stock-detail date filtering handles exact days and natural months', () => {
    assert.equal(matchesInvestmentDateFilter(rows[0], {mode: 'day', value: '2026-07-20'}), true);
    assert.equal(matchesInvestmentDateFilter(rows[0], {mode: 'day', value: '2026-07-21'}), false);
    assert.equal(matchesInvestmentDateFilter(rows[1], {mode: 'month', value: '2026-07'}), true);
    assert.equal(matchesInvestmentDateFilter(rows[1], {mode: 'all', value: ''}), true);
});

test('description binding filter appears only for actionable unbound transfer rows', () => {
    const bindingRows = [
        {id: 31, manual_internal_transfer_needs_binding: true, manual_internal_transfer_candidate_count: 2},
        {id: 32, manual_internal_transfer_needs_binding: true, manual_internal_transfer_candidate_count: 0},
        {id: 33, manual_internal_transfer_needs_binding: false, manual_internal_transfer_candidate_count: 4},
    ];
    assert.equal(isInvestmentTransactionUnbound(bindingRows[0]), true);
    assert.equal(isInvestmentTransactionUnbound(bindingRows[1]), false);
    assert.equal(hasInvestmentUnboundTransactions(bindingRows), true);
    assert.equal(normalizeInvestmentDescriptionBindingFilter('unbound', bindingRows), 'unbound');
    assert.equal(normalizeInvestmentDescriptionBindingFilter('unbound', bindingRows.slice(1)), 'all');
    assert.deepEqual(
        selectInvestmentDescriptionBindingRows(bindingRows, 'unbound').map((row) => row.id),
        [31],
    );
    assert.deepEqual(
        selectInvestmentDescriptionBindingRows(bindingRows, 'all').map((row) => row.id),
        [31, 32, 33],
    );
});
