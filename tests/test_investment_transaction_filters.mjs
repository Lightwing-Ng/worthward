/* Tests for Investment transaction filtering. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_TRANSACTION_FILTERS_MODULE_VERSION,
    buildInvestmentBrokerFilterIndex,
    getAvailableInvestmentCurrencyCodes,
    isInvestmentBrokerFilterAllSelected,
    matchesInvestmentDateFilter,
    normalizeInvestmentBroker,
    normalizeInvestmentCurrencyFilter,
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

test('stock-detail date filtering handles exact days and natural months', () => {
    assert.equal(matchesInvestmentDateFilter(rows[0], {mode: 'day', value: '2026-07-20'}), true);
    assert.equal(matchesInvestmentDateFilter(rows[0], {mode: 'day', value: '2026-07-21'}), false);
    assert.equal(matchesInvestmentDateFilter(rows[1], {mode: 'month', value: '2026-07'}), true);
    assert.equal(matchesInvestmentDateFilter(rows[1], {mode: 'all', value: ''}), true);
});
