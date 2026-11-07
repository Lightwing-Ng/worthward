/* Missing execution-price evidence controls. Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createUtils} from './context.mjs';

function trade(type, quantity, price, date = '2026-01-01', account = 'ACCOUNT') {
    const row = {broker: 'ibkr', account, ticker: 'SAMPLE', currency: 'USD',
        type, quantity, date, normalized: {position_quantity: String(quantity)}};
    if (price !== undefined) {
        row.price = price;
        row.normalized.unit_price = String(price);
        row.normalized.net_amount = String(quantity * Number(price) * (type === 'buy' ? -1 : 1));
    }
    return row;
}

function withData(payload, run) {
    const previous = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: payload};
    try { return run(createUtils()); }
    finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
}

function apply(utils, state, row, options = {}) {
    return utils.applyInvestmentTransactionToState(state, row, row.type, row.quantity,
        utils.getTransactionAmount(row), row.date, options);
}

test('an ordinary missing-price purchase preserves realized zero and withholds current cost', () => {
    withData({}, (utils) => {
        const [summary] = utils.buildTickerSummaries([trade('buy', 3)], {SAMPLE: 12}, 0, {});
        assert.equal(summary.shares, 3);
        assert.equal(summary.costBasisStatus, 'unknown');
        assert.equal(summary.totalCost, null);
        assert.equal(summary.realizedPnl, 0);
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.unrealizedPnlUnavailable, true);
    });
});

test('unknown new cost contaminates only its open account inventory', () => {
    withData({}, (utils) => {
        const state = utils.createPositionState('SAMPLE');
        apply(utils, state, trade('buy', 2, 10));
        apply(utils, state, trade('buy', 1));
        assert.equal(state.costBasisStatus, 'partial');
        apply(utils, state, trade('buy', 1));
        assert.equal(state.costBasisStatus, 'partial');
        const summaries = utils.buildTickerSummaries([
            trade('buy', 1, undefined, '2026-01-01', 'UNKNOWN'),
            {...trade('buy', 2, 10, '2026-01-01', 'KNOWN'), ticker: 'OTHER'},
        ], {SAMPLE: 12, OTHER: 12}, 0, {});
        assert.equal(summaries.find((row) => row.ticker === 'SAMPLE').unrealizedPnl, null);
        assert.equal(summaries.find((row) => row.ticker === 'OTHER').unrealizedPnl, 4);
    });
});

test('a missing-price partial sale withholds realized P&L but preserves remaining known cost', () => {
    withData({}, (utils) => {
        const [summary] = utils.buildTickerSummaries([
            trade('buy', 3, 10), trade('sell', 1, undefined, '2026-01-02'),
        ], {SAMPLE: 12}, 0, {});
        assert.equal(summary.shares, 2);
        assert.equal(summary.costBasisStatus, 'known');
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.realizedPnlUnavailable, true);
        assert.equal(summary.unrealizedPnl, 4);
        assert.equal(summary.unrealizedPnlUnavailable, false);
    });
});

test('missing execution price or unknown short basis makes a buy-to-cover incomplete', () => {
    withData({}, (utils) => {
        for (const [basisStatus, price] of [['known', undefined], ['unknown', 8]]) {
            const state = utils.createPositionState('SAMPLE');
            Object.assign(state, {shares: -3, totalCost: 30, costBasisStatus: basisStatus,
                lots: [{quantity: -3, unitPrice: 10, sequence: 0}]});
            apply(utils, state, trade('buy', 1, price));
            assert.equal(state.shares, -2);
            assert.equal(state.realizedPnlStatus, 'incomplete');
            assert.equal(state.costBasisStatus, basisStatus);
        }
    });
});

test('a reversal opens unknown-cost exposure only on the new side', () => {
    withData({}, (utils) => {
        const state = utils.createPositionState('SAMPLE');
        apply(utils, state, trade('buy', 2, 10));
        apply(utils, state, trade('sell', 3));
        assert.equal(state.shares, -1);
        assert.equal(state.costBasisStatus, 'unknown');
        assert.equal(state.realizedPnlStatus, 'incomplete');
        apply(utils, state, trade('buy', 2, 8));
        assert.equal(state.shares, 1);
        assert.equal(state.costBasisStatus, 'known');
        assert.equal(state.totalCost, 8);
        assert.equal(state.realizedPnlStatus, 'incomplete');
    });
});

test('fully closing unknown inventory restores future cost without inventing historical realized P&L', () => {
    withData({}, (utils) => {
        const [summary] = utils.buildTickerSummaries([
            trade('buy', 2), trade('sell', 2, 12, '2026-01-02'),
            trade('buy', 3, 10, '2026-01-03'),
        ], {SAMPLE: 12}, 0, {});
        assert.equal(summary.shares, 3);
        assert.equal(summary.costBasisStatus, 'known');
        assert.equal(summary.totalCost, 30);
        assert.equal(summary.unrealizedPnl, 6);
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.realizedPnlUnavailable, true);
    });
});

test('explicit zero prices and grants remain known while blank prices remain unknown', () => {
    withData({}, (utils) => {
        for (const price of [0, '0']) {
            const [summary] = utils.buildTickerSummaries([trade('buy', 1, price)], {SAMPLE: 12}, 0, {});
            assert.equal(summary.costBasisStatus, 'known');
            assert.equal(summary.unrealizedPnl, 12);
        }
        for (const price of ['', '   ']) {
            const [summary] = utils.buildTickerSummaries([trade('buy', 1, price)], {SAMPLE: 12}, 0, {});
            assert.equal(summary.costBasisStatus, 'unknown');
            assert.equal(summary.unrealizedPnl, null);
        }
        const [grant] = utils.buildTickerSummaries([trade('grant', 1)], {SAMPLE: 12}, 0, {});
        assert.equal(grant.costBasisStatus, 'known');
        assert.equal(grant.unrealizedPnl, 12);
    });
});

test('a numeric unit-price override cannot create missing source price evidence', () => {
    withData({}, (utils) => {
        for (const unitPriceOverride of [0, 10]) {
            const state = utils.createPositionState('SAMPLE');
            apply(utils, state, trade('buy', 1), {unitPriceOverride});
            assert.equal(state.shares, 1);
            assert.equal(state.costBasisStatus, 'unknown');
        }
    });
});

test('only a later known authoritative cost snapshot covers a missing-price purchase', () => {
    for (const [snapshotDate, known] of [['2025-12-31', false], ['2026-01-02', true]]) {
        withData({summary: {position_snapshot_authoritative: true}, position_snapshot_as_of: snapshotDate,
            position_snapshot: {SAMPLE: {quantity: known ? '3' : '2', cost_price: '10', as_of: snapshotDate}}}, (utils) => {
            const [summary] = utils.buildTickerSummaries([trade('buy', 1)], {SAMPLE: 12}, 0, {});
            assert.equal(summary.costBasisStatus === 'known', known);
            assert.equal(summary.unrealizedPnlUnavailable, !known);
            assert.equal(summary.realizedPnl, 0);
        });
    }
});

test('existing broker-authoritative realized proof survives unknown execution price', () => {
    withData({}, (utils) => {
        const sell = {...trade('sell', 1, undefined, '2026-01-02'), broker_realized_pnl_raw: '2'};
        const [summary] = utils.buildTickerSummaries([trade('buy', 3, 10), sell], {SAMPLE: 12}, 0, {});
        assert.equal(summary.realizedPnl, 2);
        assert.equal(summary.realizedPnlUnavailable, false);
        assert.equal(summary.unrealizedPnl, 4);
    });
});
