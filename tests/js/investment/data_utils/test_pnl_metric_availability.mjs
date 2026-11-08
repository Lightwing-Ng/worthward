/* Independent Investment P&L coverage tests. Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getInvestmentAggregatePnlCoverage,
    isInvestmentRealizedPnlUnavailable,
    isInvestmentUnrealizedPnlUnavailable,
} from '../../../../app/web/static/assets/js/investment/data-utils.js';
import {createUtils} from './context.mjs';

function withPayload(payload, run) {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: payload};
    try {
        return run(createUtils());
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

function trade(type, account, quantity, price, date, ticker = 'SAMPLE') {
    const amount = quantity * price * (type === 'buy' ? -1 : 1);
    return {
        broker: 'ibkr', account, ticker, currency: 'USD', type, date,
        quantity, price, amount,
        normalized: {
            position_quantity: String(quantity), unit_price: String(price),
            net_amount: String(amount),
        },
    };
}

test('explicit component flags override a combined gap while preserving finite-value checks', () => {
    const row = {
        ticker: 'SAMPLE', hasOpenPosition: true, pnlUnavailable: true,
        realizedPnl: 0, unrealizedPnl: 5,
        realizedPnlUnavailable: false, unrealizedPnlUnavailable: false,
    };
    assert.equal(isInvestmentRealizedPnlUnavailable(row), false);
    assert.equal(isInvestmentUnrealizedPnlUnavailable(row), false);
    assert.equal(isInvestmentRealizedPnlUnavailable({...row, realizedPnlUnavailable: true}), true);
    assert.equal(isInvestmentUnrealizedPnlUnavailable({...row, unrealizedPnlUnavailable: true}), true);
    for (const value of [null, undefined, NaN, Infinity, '0']) {
        assert.equal(isInvestmentRealizedPnlUnavailable({...row, realizedPnl: value}), true);
        assert.equal(isInvestmentUnrealizedPnlUnavailable({...row, unrealizedPnl: value}), true);
    }
    const utils = createUtils();
    assert.equal(utils.isInvestmentRealizedPnlUnavailable, isInvestmentRealizedPnlUnavailable);
    assert.equal(utils.isInvestmentUnrealizedPnlUnavailable, isInvestmentUnrealizedPnlUnavailable);
    assert.equal(utils.getInvestmentAggregatePnlCoverage, getInvestmentAggregatePnlCoverage);
});

test('legacy summaries retain their fail-closed combined and status behavior', () => {
    const row = {hasOpenPosition: true, realizedPnl: 0, unrealizedPnl: 0};
    assert.equal(isInvestmentRealizedPnlUnavailable(row), false);
    assert.equal(isInvestmentUnrealizedPnlUnavailable(row), false);
    assert.equal(isInvestmentRealizedPnlUnavailable({...row, pnlUnavailable: true}), true);
    assert.equal(isInvestmentUnrealizedPnlUnavailable({...row, pnlUnavailable: true}), true);
    assert.equal(isInvestmentRealizedPnlUnavailable({...row, realizedPnlStatus: 'partial'}), true);
    assert.equal(isInvestmentUnrealizedPnlUnavailable({...row, unrealizedPnlStatus: 'unavailable'}), true);
    assert.equal(isInvestmentRealizedPnlUnavailable(null), true);
    assert.equal(isInvestmentUnrealizedPnlUnavailable(null), true);
});

test('unrealized coverage counts only open positions and preserves known zero', () => {
    const closed = {ticker: 'CLOSED', hasOpenPosition: false, pnlUnavailable: true,
        realizedPnl: null, unrealizedPnl: null, realizedPnlStatus: 'partial'};
    const open = {ticker: 'OPEN', hasOpenPosition: true, realizedPnl: null,
        unrealizedPnl: 0, realizedPnlUnavailable: true, unrealizedPnlUnavailable: false};
    assert.equal(isInvestmentUnrealizedPnlUnavailable(closed), false);
    assert.deepEqual(getInvestmentAggregatePnlCoverage([closed], {metric: 'unrealized'}), {
        status: 'complete', completeCount: 0, totalCount: 0, missingTickers: [],
    });
    assert.deepEqual(getInvestmentAggregatePnlCoverage([closed, open], {metric: 'unrealized'}), {
        status: 'complete', completeCount: 1, totalCount: 1, missingTickers: [],
    });
    assert.equal(getInvestmentAggregatePnlCoverage([closed, open], {metric: 'realized'}).status, 'partial');
    assert.equal(getInvestmentAggregatePnlCoverage([closed, open]).status, 'partial');
    assert.throws(() => getInvestmentAggregatePnlCoverage([], {metric: 'unsupported'}), RangeError);
});

test('an incomplete closed account cannot erase another account known open-position valuation', () => {
    withPayload({}, (utils) => {
        const rows = [
            trade('sell', 'OLD-ACCOUNT', 2, 10, '2026-01-01'),
            trade('buy', 'OLD-ACCOUNT', 2, 10, '2026-01-02'),
            trade('buy', 'OPEN-ACCOUNT', 3, 10, '2026-01-03'),
        ];
        const original = structuredClone(rows);
        const [summary] = utils.buildTickerSummaries(rows, {SAMPLE: 12}, 0, {});
        assert.equal(summary.shares, 3);
        assert.equal(summary.totalCost, 30);
        assert.equal(summary.realizedPnlStatus, 'partial');
        assert.equal(summary.realizedPnlUnavailable, true);
        assert.equal(summary.realizedPnlUnavailableReason, 'realized_pnl_coverage_partial');
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.realizedPnlReconciliation.coverageStatus, 'partial');
        assert.equal(summary.unrealizedPnlUnavailable, false);
        assert.equal(summary.unrealizedPnlUnavailableReason, null);
        assert.equal(summary.unrealizedPnlStatus, 'complete');
        assert.equal(summary.unrealizedPnl, 6);
        assert.equal(summary.totalPnl, null);
        assert.equal(summary.pnlUnavailable, true);
        assert.deepEqual(summary.realizedPnlByDate, {});
        assert.equal(summary.realizedPnlAccounts.filter((account) => account.status === 'complete').length, 1);
        assert.deepEqual(rows, original);
    });
});

test('unknown current basis cannot erase a complete realized baseline and its dated income proof', () => {
    const payload = {
        summary: {position_snapshot_authoritative: true},
        position_snapshot: {SAMPLE: {quantity: '3', cost_basis_status: 'unknown', last_price: '12'}},
        broker_summaries: {ibkr: {
            account: 'ACCOUNT', performance_snapshot_authoritative: true,
            performance_snapshot_as_of: '2026-01-02',
            performance_snapshot: {SAMPLE: {currency: 'USD', realized_total: '7'}},
        }},
    };
    withPayload(payload, (utils) => {
        const income = {broker: 'ibkr', account: 'ACCOUNT', ticker: 'SAMPLE', currency: 'USD',
            type: 'dividend', date: '2026-01-03', normalized: {net_amount: '3'}};
        const [summary] = utils.buildTickerSummaries([
            trade('buy', 'ACCOUNT', 3, 10, '2026-01-01'), income,
        ], {SAMPLE: 12}, 0, {});
        assert.equal(summary.costBasisStatus, 'unknown');
        assert.equal(summary.averagePrice, null);
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.realizedPnlUnavailableReason, null);
        assert.equal(summary.realizedPnlStatus, 'complete');
        assert.equal(summary.realizedPnl, 10);
        assert.equal(summary.realizedPnlReconciliation.coverageStatus, 'complete');
        assert.equal(summary.realizedPnlReconciliation.arithmeticCheck.valid, true);
        assert.deepEqual(summary.realizedPnlByDate, {'2026-01-02': 7, '2026-01-03': 3});
        assert.equal(summary.realizedPnlAccounts[0].status, 'complete');
        assert.equal(summary.realizedPnlAccounts[0].realizedPnl, 10);
        assert.equal(summary.unrealizedPnlUnavailable, true);
        assert.equal(summary.unrealizedPnlUnavailableReason, 'authoritative_position_snapshot_cost_basis_unknown');
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.totalPnl, null);
    });
});

test('a positions-only snapshot does not invent zero realized history', () => {
    withPayload({summary: {position_snapshot_authoritative: true},
        position_snapshot: {SAMPLE: {quantity: '3', cost_price: '10', last_price: '12'}}}, (utils) => {
        const [summary] = utils.buildTickerSummaries([], {SAMPLE: 12}, 0, {});
        assert.equal(summary.realizedPnlUnavailable, true);
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.unrealizedPnlUnavailable, false);
        assert.equal(summary.unrealizedPnl, 6);
        assert.equal(summary.totalPnl, null);
    });
});

test('missing current price leaves proven realized zero intact', () => {
    withPayload({}, (utils) => {
        const [summary] = utils.buildTickerSummaries([trade('buy', 'ACCOUNT', 3, 10, '2026-01-01')], {}, 0, {});
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.realizedPnl, 0);
        assert.equal(summary.unrealizedPnlUnavailable, true);
        assert.equal(summary.unrealizedPnlUnavailableReason, 'missing_market_price');
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.totalPnl, null);
    });
});

test('missing unrealized FX does not erase a proven zero realized amount', () => {
    withPayload({}, (utils) => {
        const row = {...trade('buy', 'ACCOUNT', 3, 10, '2026-01-01', '5.HK'), currency: 'HKD'};
        const [summary] = utils.buildTickerSummaries([row], {'5.HK': 12}, 0, {});
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.realizedPnl, 0);
        assert.equal(summary.unrealizedPnlUnavailable, true);
        assert.equal(summary.unrealizedPnlUnavailableReason, 'missing_fx_rate');
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.totalPnl, null);
    });
});

test('missing realized-report FX cannot erase a known USD open-position gain', () => {
    withPayload({broker_summaries: {ibkr: {
        account: 'ACCOUNT', performance_snapshot_authoritative: true,
        performance_snapshot_as_of: '2026-01-02',
        performance_snapshot: {SAMPLE: {currency: 'EUR', realized_total: '7'}},
    }}}, (utils) => {
        const [summary] = utils.buildTickerSummaries([
            trade('buy', 'ACCOUNT', 3, 10, '2026-01-01'),
        ], {SAMPLE: 12}, 0, {});
        assert.equal(summary.realizedPnlUnavailable, true);
        assert.equal(summary.realizedPnlUnavailableReason, 'missing_fx_rate');
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.unrealizedPnlUnavailable, false);
        assert.equal(summary.unrealizedPnl, 6);
        assert.equal(summary.totalPnl, null);
    });
});

test('complete account realized amounts convert independently of mixed open-position currencies', () => {
    withPayload({fx_rate_history_by_currency: {
        EUR: {dates: ['2026-01-01'], values: {'2026-01-01': 2}},
    }}, (utils) => {
        const rows = ['USD', 'EUR'].flatMap((currency) => [
            {...trade('buy', currency, 3, 10, '2026-01-01'), currency},
            {...trade('sell', currency, 1, 12, '2026-01-02'), currency},
        ]);
        const [summary] = utils.buildTickerSummaries(rows, {SAMPLE: 12}, 0, {});
        // Each scope realizes two native units; two EUR per USD converts the EUR gain to one USD.
        assert.deepEqual(summary.realizedPnlAccounts.map((row) => row.realizedPnl).sort(), [1, 2]);
        assert.ok(summary.realizedPnlAccounts.every((row) => row.status === 'complete'
            && row.reconciliation.coverageStatus === 'complete'));
        assert.equal(summary.realizedPnl, 3);
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.realizedPnlStatus, 'complete');
        assert.equal(summary.hasMixedPositionCurrencies, true);
        assert.equal(summary.unrealizedPnlUnavailable, true);
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.totalPnl, null);
    });
});

test('missing one account FX withholds combined realized without erasing the known account proof', () => {
    withPayload({}, (utils) => {
        const rows = ['USD', 'EUR'].flatMap((currency) => [
            {...trade('buy', currency, 3, 10, '2026-01-01'), currency},
            {...trade('sell', currency, 1, 12, '2026-01-02'), currency},
        ]);
        const [summary] = utils.buildTickerSummaries(rows, {SAMPLE: 12}, 0, {});
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.realizedPnlUnavailable, true);
        assert.equal(summary.realizedPnlUnavailableReason, 'missing_fx_rate');
        const known = summary.realizedPnlAccounts.find((row) => row.currency === 'USD');
        assert.equal(known.realizedPnl, 2);
        assert.equal(known.status, 'complete');
        assert.equal(summary.unrealizedPnlUnavailable, true);
    });
});
