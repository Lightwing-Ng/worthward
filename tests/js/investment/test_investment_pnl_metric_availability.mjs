/* Code version: v1.0.0
 * Funding totals retain independent realized and unrealized coverage.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber} from './data_utils/context.mjs';
import {createInvestmentRuntimeConfig} from '../../../app/web/static/assets/js/investment/runtime/config.js';
import {createInvestmentFundingMetricsRuntime} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';

const originalWindow = globalThis.window;
beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
        transactions: [], credit_card_rewards: {status: 'complete', transactions: []},
    }};
});
afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function summary(overrides = {}) {
    return {
        ticker: 'OPEN', hasOpenPosition: true, shares: 10, marketValue: 120,
        realizedPnl: 15, realizedPnlStatus: 'complete', realizedPnlUnavailable: false,
        unrealizedPnl: 20, unrealizedPnlStatus: 'complete', unrealizedPnlUnavailable: false,
        pnlUnavailable: false, ...overrides,
    };
}

function makeRuntime(summaries) {
    const runtime = {
        ...createUtils(), getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber,
        applyInvestmentAggregatePnlAvailability: (rows) => rows,
        getInvestmentCanonicalSummaryRealizedPnl: (row) => row.realizedPnl,
        normalizeInvestmentTicker: (value) => String(value || '').trim().toUpperCase(),
        formatInvestmentTickerForDisplay: (value) => String(value),
    };
    Object.assign(runtime, createInvestmentRuntimeConfig(runtime));
    Object.assign(runtime, createInvestmentFundingMetricsRuntime(runtime));
    Object.assign(runtime, createInvestmentMetricsImportRuntime(runtime));
    runtime.buildTickerSummaries = () => structuredClone(summaries);
    runtime.resolveInvestmentMetricsCurrentCash = () => ({cash: 0, cashIsApproximate: false});
    return runtime;
}

const benefits = () => ({
    couponRebateIncome: 0, cashRewardIncome: 0, kolRewardIncome: 0,
    creditCardRewardIncome: 0,
});

test('a closed account realized gap does not hide known open unrealized P&L or create a partial realized total', () => {
    const knownAccounts = [{broker: 'anonymous', realizedPnl: 15, realizedPnlLocal: 15}];
    const rows = [summary({realizedPnlAccounts: knownAccounts}), summary({
        ticker: 'CLOSED', hasOpenPosition: false, shares: 0, marketValue: 0,
        realizedPnl: null, realizedPnlUnavailable: true, realizedPnlStatus: 'unavailable',
        unrealizedPnl: null, pnlUnavailable: true,
    })];
    const before = structuredClone(rows);
    const runtime = makeRuntime(rows);
    const metrics = runtime.getHoldingsSummaryMetrics([], {}, 120, benefits());
    assert.equal(runtime.getRealizedPnlAttribution([], rows, benefits()).totalRealizedPnl, null);
    assert.ok(Number.isNaN(runtime.getInvestmentHistoricalRealizedPnl([], rows)));
    assert.equal(metrics.totalRealizedPnl, null);
    assert.equal(metrics.realizedPnlUnavailable, true);
    assert.equal(metrics.totalUnrealizedPnl, 20);
    assert.equal(metrics.unrealizedPnlUnavailable, false);
    assert.equal(metrics.unrealizedPnlCoverage.totalCount, 1);
    assert.equal(metrics.cumulativePnl, null);
    assert.equal(metrics.unrealizedPnlDetails.length, 1);
    assert.deepEqual(metrics.tickerSummaries[0].realizedPnlAccounts, knownAccounts);
    assert.deepEqual(rows, before);
});

test('an unknown current basis does not hide complete realized P&L', () => {
    const rows = [summary({
        pnlUnavailable: true, unrealizedPnl: null, unrealizedPnlUnavailable: true,
        unrealizedPnlStatus: 'unavailable', unrealizedPnlUnavailableReason: 'open_position_cost_basis_unknown',
    })];
    const runtime = makeRuntime(rows);
    const metrics = runtime.getHoldingsSummaryMetrics([], {}, 120, benefits());
    assert.equal(metrics.totalRealizedPnl, 15);
    assert.equal(metrics.realizedPnlUnavailable, false);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl([], rows), 15);
    assert.equal(metrics.totalUnrealizedPnl, null);
    assert.equal(metrics.unrealizedPnlUnavailable, true);
    assert.equal(metrics.cumulativePnl, null);
    assert.ok(metrics.realizedPnlDetails.some(({label}) => label === 'Broker-reported reconciliation'));
    assert.deepEqual(metrics.unrealizedPnlDetails, []);
});

test('missing reward FX blocks realized and cumulative totals without blocking current unrealized P&L', () => {
    const runtime = makeRuntime([summary()]);
    const metrics = runtime.getHoldingsSummaryMetrics([], {}, 120, {
        ...benefits(), creditCardRewardIncome: Number.NaN, creditCardRewardUnavailable: true,
    });
    assert.equal(metrics.totalRealizedPnl, null);
    assert.equal(metrics.realizedPnlUnavailable, true);
    assert.equal(metrics.realizedPnlCoverage.cashFlowFxUnavailable, true);
    assert.equal(metrics.totalUnrealizedPnl, 20);
    assert.equal(metrics.unrealizedPnlUnavailable, false);
    assert.equal(metrics.cumulativePnl, null);
    assert.equal(metrics.unrealizedPnlDetails.length, 1);
});

test('known zero remains numeric while a security-transfer hard block hides both components', () => {
    const runtime = makeRuntime([summary({realizedPnl: 0, unrealizedPnl: 0})]);
    const known = runtime.getHoldingsSummaryMetrics([], {}, 120, benefits());
    assert.equal(known.totalRealizedPnl, 0);
    assert.equal(known.totalUnrealizedPnl, 0);
    assert.equal(known.cumulativePnl, 0);
    assert.equal(known.pnlUnavailable, false);

    const blocked = makeRuntime([summary({
        securityTransferPnlUnavailable: true, pnlUnavailable: true,
        realizedPnlUnavailable: true, unrealizedPnlUnavailable: true,
    })]).getHoldingsSummaryMetrics([], {}, 120, benefits());
    assert.equal(blocked.totalRealizedPnl, null);
    assert.equal(blocked.totalUnrealizedPnl, null);
    assert.equal(blocked.cumulativePnl, null);
});
