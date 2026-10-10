/* Investment workspace-control ordering and dated-cash regressions.
 * Code version: v1.1.0
 * Added: Native-currency dated cash projection regressions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentWorkspaceControlsRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/workspace-controls.js';
import {
    createInvestmentDataUtils,
} from '../../../app/web/static/assets/js/investment/data-utils.js';
import {
    normalizeInvestmentBroker,
} from '../../../app/web/static/assets/js/investment/transaction-filters.js';

test('a bound transfer advances its predecessor without delaying the receipt', () => {
    const runtime = {
        state: {},
        normalizeInvestmentBroker: (value) => String(value || '').trim().toLowerCase(),
        getTransactionBrokerCode: (txn) => txn?.broker || '',
        getNormalizedTransactionType: (txn) => txn?.type || '',
        normalizeLedgerDate: (value) => String(value || '').slice(0, 10),
        getTransactionAmount: (txn) => Number(txn?.amount),
        INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS: new Set(['hsbc']),
    };
    const {reorderInvestmentTransactionsForBoundTransfers} = (
        createInvestmentWorkspaceControlsRuntime(runtime)
    );
    const receipt = {
        id: 'receipt',
        broker: 'hsbc',
        date: '2026-09-17',
        type: 'deposit',
        amount: 100,
    };
    const sellA = {id: 'sell-a', broker: 'hsbc', date: '2026-09-17', type: 'sell'};
    const sellB = {id: 'sell-b', broker: 'hsbc', date: '2026-09-17', type: 'sell'};
    const withdrawal = {
        id: 'withdrawal',
        broker: 'ibkr',
        date: '2026-09-17',
        type: 'withdrawal',
        amount: -100,
    };

    const reordered = reorderInvestmentTransactionsForBoundTransfers(
        [receipt, sellA, sellB, withdrawal],
        {
            resolvedBindingsBySourceKey: new Map([
                ['bound-transfer', {sourceTxn: receipt, targetTxn: withdrawal}],
            ]),
        },
    );

    assert.deepEqual(
        reordered.map((txn) => txn.id),
        ['withdrawal', 'receipt', 'sell-a', 'sell-b'],
    );
});

const FIXTURE_FX_HISTORY = {
    HKD: {dates: ['2026-03-04'], values: {'2026-03-04': 7.8}},
    CNH: {dates: ['2026-03-04'], values: {'2026-03-04': 7}},
};

function withInvestmentData(t, data) {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: data};
    t.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
}

function createCashProjectionRuntime() {
    const utils = createInvestmentDataUtils({
        noCommissionTransactionTypes: new Set(),
        investmentCommonSplitFactors: [1],
        parseInvestmentDateParts: (value) => value,
        formatInvestmentShortDateParts: (value) => value,
        normalizeInvestmentTicker: (value) => String(value || '').trim().toUpperCase(),
        normalizeInvestmentStockDetailsRange: (value) => value || 'max',
        normalizeInvestmentEquityRange: (value) => value || 'max',
    });
    const runtime = {
        ...utils,
        state: {investmentRawTransactionsCache: []},
        normalizeInvestmentBroker,
        getTransactionBrokerCode: (txn) => txn?.broker || '',
        getOptionalInvestmentNumber: (value) => (
            value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
                ? null
                : Number(value)
        ),
        shouldPreserveSequentialBrokerBuyHistory: () => false,
    };
    Object.assign(runtime, createInvestmentWorkspaceControlsRuntime(runtime));
    return runtime;
}

function hsbcReplayRow(date, balances, extra = {}) {
    const runningCash = Object.entries(balances).reduce(
        (total, [currency, amount]) => total + (amount / ({HKD: 7.8, CNH: 7}[currency] || 1)),
        0,
    );
    return {
        broker: 'hsbc',
        account: 'HSBC-TEST-001',
        date,
        datetime: `${date} 20:00:00`,
        type: 'deposit',
        currency: 'HKD',
        broker_running_cash: runningCash,
        broker_display_cash: runningCash + 305.6,
        broker_cash_by_currency: {...balances},
        broker_pending_settlement_cash: 305.6,
        broker_market_value: 10400,
        // A single-broker replay mirrors these fields on the aggregate path.
        aggregate_pending_settlement_cash: 305.6,
        market_value: 10400,
        ...extra,
    };
}

test('HSBC dated cash keeps converted foreign balances and per-component dates', (t) => {
    withInvestmentData(t, {
        brokers: ['hsbc'],
        fx_rate_history_by_currency: FIXTURE_FX_HISTORY,
        broker_summaries: {
            hsbc: {
                ending_cash: '21210.00',
                ending_cash_base_currency: '21210.00',
                ending_cash_base_currency_as_of: '2026-03-05',
                cash_snapshot_as_of: '2026-03-06',
                cash_snapshot_authoritative: true,
                ending_cash_by_currency: {USD: '21210.00', HKD: '2804.88', CNH: '0.00'},
                hsbc_ending_cash_components: {
                    'USD:SAVINGS': '21210.00',
                    'HKD:SAVINGS': '2804.88',
                    'HKD:CURRENT': '0.00',
                    'CNH:SAVINGS': '0.00',
                },
                hsbc_cash_component_post_dates: {
                    'USD:SAVINGS': '2026-03-05',
                    'HKD:SAVINGS': '2026-03-06',
                    'HKD:CURRENT': '2026-01-20',
                    'CNH:SAVINGS': '2026-03-06',
                },
            },
        },
    });
    const runtime = createCashProjectionRuntime();
    const rows = [
        hsbcReplayRow('2026-03-04', {USD: 21500, HKD: 1950, CNH: 420}),
        hsbcReplayRow('2026-03-05', {USD: 21500, HKD: 1950, CNH: 490}),
        hsbcReplayRow('2026-03-05', {USD: 21500, HKD: 2262, CNH: 490}),
        hsbcReplayRow('2026-03-06', {USD: 21500, HKD: 2262}),
        hsbcReplayRow('2026-03-06', {USD: 21500, HKD: 2804.88}),
    ];
    const untouched = rows.slice(0, 2).map((row) => ({...row}));

    runtime.applyAuthoritativeBrokerEndingCashBalances(rows);

    assert.deepEqual(rows.slice(0, 2), untouched);
    const expectedCash = [21210 + 290 + 70, 21210 + 290, 21210 + 359.6];
    rows.slice(2).forEach((row, offset) => {
        assert.ok(Math.abs(row.broker_running_cash - expectedCash[offset]) < 1e-9, `row ${offset + 2}`);
        assert.ok(Math.abs(row.broker_display_cash - (expectedCash[offset] + 305.6)) < 1e-9);
        assert.ok(Math.abs(row.broker_total_equity - (expectedCash[offset] + 305.6 + 10400)) < 1e-9);
        assert.equal(row.broker_cash_balance_source, 'dated_authoritative_cash_snapshot_projection');
    });
    assert.deepEqual(rows[2].broker_cash_by_currency, {USD: 21210, HKD: 2262, CNH: 490});
    assert.deepEqual(rows[3].broker_cash_by_currency, {USD: 21210, HKD: 2262});
    assert.deepEqual(rows[4].broker_cash_by_currency, {USD: 21210, HKD: 2804.88});
    // The history projection needs each row's active native anchors.
    assert.deepEqual(Object.keys(rows[2].broker_dated_cash_anchors), ['USD']);
    assert.equal(rows[2].broker_dated_cash_anchors.USD.asOf, '2026-03-05');
    assert.equal(Object.keys(rows[2]).includes('broker_dated_cash_anchors'), false);
    assert.deepEqual(Object.keys(rows[4].broker_dated_cash_anchors).sort(), ['CNH', 'HKD', 'USD']);
    // Only movement after each currency's own boundary rolls the current snapshot.
    assert.deepEqual(rows[3].broker_post_snapshot_cash_delta, {});
    assert.deepEqual(rows[4].broker_post_snapshot_cash_delta, {});
});

test('a scalar-only cash snapshot keeps its base-currency total semantics', (t) => {
    withInvestmentData(t, {
        brokers: ['ibkr'],
        broker_summaries: {
            ibkr: {
                ending_cash: '420.38',
                ending_cash_as_of: '2026-03-02',
                cash_snapshot_authoritative: true,
            },
        },
    });
    const runtime = createCashProjectionRuntime();
    const rows = [
        {broker: 'ibkr', date: '2026-03-02', broker_running_cash: 400, broker_cash_by_currency: {USD: 400}},
        {broker: 'ibkr', date: '2026-03-03', broker_running_cash: 249.65, broker_cash_by_currency: {USD: 249.65}},
    ];

    runtime.applyAuthoritativeBrokerEndingCashBalances(rows);

    assert.ok(Math.abs(rows[0].broker_running_cash - 420.38) < 1e-9);
    assert.ok(Math.abs(rows[1].broker_running_cash - 270.03) < 1e-9);
    assert.equal(rows[1].broker_dated_cash_anchors, undefined);
});

test('explicit balances without a dated component never fall back to the scalar total', (t) => {
    withInvestmentData(t, {
        brokers: ['hsbc'],
        fx_rate_history_by_currency: FIXTURE_FX_HISTORY,
        broker_summaries: {
            hsbc: {
                ending_cash: '21210.00',
                ending_cash_base_currency: '21210.00',
                ending_cash_base_currency_as_of: '2026-03-05',
                cash_snapshot_authoritative: true,
                ending_cash_by_currency: {USD: '21210.00', HKD: '2804.88'},
                hsbc_ending_cash_components: {'USD:SAVINGS': '21210.00', 'HKD:SAVINGS': '2804.88'},
                hsbc_cash_component_post_dates: {'HKD:SAVINGS': '2026-03-06'},
            },
        },
    });
    const runtime = createCashProjectionRuntime();
    const rows = [
        hsbcReplayRow('2026-03-05', {USD: 21500, HKD: 2262}),
        hsbcReplayRow('2026-03-06', {USD: 21500, HKD: 2804.88}),
    ];
    const replayCash = rows.map((row) => row.broker_running_cash);

    runtime.applyAuthoritativeBrokerEndingCashBalances(rows);

    // USD has no dated component, so only the dated HKD component anchors.
    assert.equal(rows[0].broker_running_cash, replayCash[0]);
    assert.ok(Math.abs(rows[1].broker_running_cash - replayCash[1]) < 1e-9);
    assert.deepEqual(rows[1].broker_cash_by_currency, {USD: 21500, HKD: 2804.88});
    assert.deepEqual(Object.keys(rows[1].broker_dated_cash_anchors), ['HKD']);
});

test('an explicit balance map with no usable balance fails closed instead of using the scalar', (t) => {
    withInvestmentData(t, {
        brokers: ['hsbc'],
        fx_rate_history_by_currency: FIXTURE_FX_HISTORY,
        broker_summaries: {
            hsbc: {
                ending_cash: '21210.00',
                ending_cash_base_currency: '21210.00',
                ending_cash_base_currency_as_of: '2026-03-05',
                cash_snapshot_authoritative: true,
                ending_cash_by_currency: {USD: '21,210.00', HKD: 'n/a'},
            },
        },
    });
    const runtime = createCashProjectionRuntime();
    const rows = [
        hsbcReplayRow('2026-03-05', {USD: 21500, HKD: 2262}),
        hsbcReplayRow('2026-03-06', {USD: 21500, HKD: 2804.88}),
    ];
    const replayRows = rows.map((row) => ({...row}));

    runtime.applyAuthoritativeBrokerEndingCashBalances(rows);

    assert.deepEqual(rows, replayRows);
});
