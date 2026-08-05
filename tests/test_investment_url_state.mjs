/* Tests for the canonical Investment URL state contract. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_URL_STATE_MODULE_VERSION,
    buildInvestmentUrl,
    getInvestmentUrlParameterNames,
    parseInvestmentUrlState,
} from '../app/web/static/assets/js/investment/url-state.js';

test('exposes a semantic cache-busting version and the complete query contract', () => {
    assert.match(INVESTMENT_URL_STATE_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
    assert.deepEqual(getInvestmentUrlParameterNames(), [
        'view',
        'ticker',
        'range',
        'metrics-broker',
        'broker',
        'type',
        'currency',
        'description',
        'date',
        'page',
    ]);
});

test('parses the user-facing view slug and every Investment table control', () => {
    const state = parseInvestmentUrlState(
        'http://localhost:8688/trade/investment?view=metrics&range=3m'
            + '&metrics-broker=longbridge_hk&broker=ibkr,longbridge_hk'
            + '&type=buy,sell&currency=hkd&description=unbound&date=2026-08-04&page=3',
    );

    assert.equal(state.view, 'metrics');
    assert.equal(state.range, '3m');
    assert.equal(state.metricsBroker, 'longbridge_hk');
    assert.deepEqual(state.brokerSelection, {
        all: false,
        codes: ['ibkr', 'longbridge_hk'],
    });
    assert.deepEqual(state.typeFilter, ['buy', 'sell']);
    assert.equal(state.currencyFilter, 'HKD');
    assert.equal(state.descriptionFilter, 'unbound');
    assert.deepEqual(state.dateFilter, {mode: 'day', value: '2026-08-04'});
    assert.equal(state.page, 3);
});

test('serializes a compact canonical URL and uses the stock range for Stock details', () => {
    const url = buildInvestmentUrl(
        'http://localhost:8688/trade/investment?legacy=keep#stock_panel',
        {
            view: 'stock_details',
            ticker: 'nvda',
            overviewRange: '1y',
            stockDetailsRange: '3m',
            metricsBroker: 'all',
            brokerSelection: {all: false, codes: ['longbridge_hk', 'ibkr']},
            typeFilter: ['sell', 'buy'],
            currencyFilter: 'hkd',
            descriptionFilter: 'unbound',
            dateFilter: {mode: 'month', value: '2026-08'},
            page: 4,
        },
    );

    assert.equal(
        url,
        '/trade/investment?legacy=keep&view=stock-details&ticker=NVDA&range=3m'
            + '&broker=ibkr%2Clongbridge_hk&type=buy%2Csell&currency=HKD'
            + '&description=unbound&date=2026-08&page=4',
    );
});

test('omits default values while retaining the explicit Overview view', () => {
    assert.equal(
        buildInvestmentUrl('http://localhost:8688/trade/investment', {
            view: 'chart',
            overviewRange: 'max',
            stockDetailsRange: 'max',
            metricsBroker: 'all',
            brokerSelection: {all: true, codes: []},
            typeFilter: 'all',
            currencyFilter: 'all',
            descriptionFilter: 'all',
            dateFilter: {mode: 'all', value: ''},
            page: 1,
        }),
        '/trade/investment?view=overview',
    );
});

test('reads the legacy Stock details hash during migration', () => {
    const state = parseInvestmentUrlState(
        'http://localhost:8688/trade/investment?ticker=MSFT#investment_stock_details_panel',
    );
    assert.equal(state.view, 'stock_details');
    assert.equal(state.ticker, 'MSFT');
    assert.equal(state.hasExplicitState, true);
});
