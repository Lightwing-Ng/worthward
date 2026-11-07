/* Code version: v1.0.0
 * Runtime availability retains independently verified P&L components.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, getInvestmentAggregatePnlCoverage} from './data_utils/context.mjs';
import {createInvestmentRealtimeChartRuntime} from '../../../app/web/static/assets/js/investment/runtime/realtime-chart.js';
import {createInvestmentHoldingsLiveRuntime} from '../../../app/web/static/assets/js/investment/runtime/holdings-live.js';

const previousWindow = globalThis.window;
beforeEach(() => { globalThis.window = {WORTHWARD_INVESTMENT_DATA: {summary: {}}}; });
afterEach(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
});

function makeRuntime(blocked = []) {
    const runtime = {
        ...createUtils(),
        state: {investmentAggregateSecurityTransferState: {pnlUnavailableTickers: new Set(blocked)}},
        escapeHtml: String,
        renderWorkspaceMetricValueContent: String,
    };
    Object.assign(runtime, createInvestmentRealtimeChartRuntime(runtime));
    Object.assign(runtime, createInvestmentHoldingsLiveRuntime(runtime));
    return runtime;
}

test('historical realized gaps retain known current unrealized values without a transfer marker', () => {
    const runtime = makeRuntime();
    const summary = {
        ticker: 'TEST', hasOpenPosition: true, pnlUnavailable: true,
        realizedPnlUnavailable: true, realizedPnl: null,
        unrealizedPnlUnavailable: false, unrealizedPnl: 20,
    };
    const [result] = runtime.applyInvestmentAggregatePnlAvailability([summary]);
    assert.equal(result, summary);
    assert.equal(result.unrealizedPnl, 20);
    assert.equal(result.securityTransferPnlUnavailable, undefined);
    assert.equal(runtime.isInvestmentRealizedPnlUnavailable(result), true);
    assert.equal(runtime.isInvestmentUnrealizedPnlUnavailable(result), false);
});

test('an unresolved security transfer blocks both components and their reconciliation', () => {
    const runtime = makeRuntime(['TEST']);
    window.WORTHWARD_INVESTMENT_DATA.summary.security_transfer_reconciliation = {
        pnl_unavailable_reason: 'unverified_transfer_basis',
    };
    const original = {
        ticker: 'TEST', hasOpenPosition: true, realizedPnl: 7, unrealizedPnl: 20, totalPnl: 27, totalPnlLocal: 27,
        realizedPnlUnavailable: false, unrealizedPnlUnavailable: false,
        realizedPnlReconciliation: {coverageStatus: 'complete', arithmeticCheck: {valid: true}},
    };
    const [result] = runtime.applyInvestmentAggregatePnlAvailability([original]);
    assert.equal(result.securityTransferPnlUnavailable, true);
    assert.equal(result.realizedPnlUnavailable, true);
    assert.equal(result.unrealizedPnlUnavailable, true);
    assert.equal(result.realizedPnlUnavailableReason, 'unverified_transfer_basis');
    assert.equal(result.unrealizedPnlUnavailableReason, 'unverified_transfer_basis');
    assert.equal(result.realizedPnl, null);
    assert.equal(result.unrealizedPnl, null);
    assert.equal(result.totalPnl, null);
    assert.equal(result.totalPnlLocal, null);
    assert.equal(result.realizedPnlReconciliation.coverageStatus, 'unavailable');
    assert.equal(result.realizedPnlReconciliation.arithmeticCheck.valid, false);
    assert.equal(original.realizedPnl, 7);
    assert.equal(original.unrealizedPnl, 20);
});

test('flat positions have no unrealized daily badge even with unavailable historical realized P&L', () => {
    const runtime = makeRuntime();
    assert.deepEqual(runtime.resolveInvestmentHoldingDailyPnl({
        ticker: 'TEST', hasOpenPosition: false, realizedPnlUnavailable: true,
        realizedPnl: null, unrealizedPnlUnavailable: false, unrealizedPnl: null,
    }), {realized: 0, unrealized: 0});
});

test('unavailable stock metric markup never declares a numeric value', () => {
    const runtime = makeRuntime();
    const markup = runtime.renderInvestmentStockDetailsLiveMetricValueSpan({
        value: 'Unavailable', liveField: 'stock_unrealized_pnl', liveNumber: null,
    }, 'TEST');
    assert.match(markup, /data-investment-live-display="Unavailable"/);
    assert.doesNotMatch(markup, /data-investment-live-number=/);
});


test('a proven flat hard-blocked scope retains unavailable realized P&L and no unrealized exposure', () => {
    const runtime = makeRuntime(['TEST']);
    const [result] = runtime.applyInvestmentAggregatePnlAvailability([{
        ticker: 'TEST', hasOpenPosition: false, shares: 0,
        realizedPnl: 7, unrealizedPnl: null, totalPnl: 7, totalPnlLocal: 7,
    }]);
    assert.equal(result.realizedPnl, null);
    assert.equal(runtime.isInvestmentRealizedPnlUnavailable(result), true);
    assert.equal(result.unrealizedPnl, null);
    assert.equal(runtime.isInvestmentUnrealizedPnlUnavailable(result), false);
    assert.deepEqual(getInvestmentAggregatePnlCoverage([result], {metric: 'unrealized'}), {
        status: 'complete', completeCount: 0, totalCount: 0, missingTickers: [],
    });
    assert.equal(result.totalPnl, null);
    assert.equal(result.totalPnlLocal, null);
});
