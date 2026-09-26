/* Investment equity-chart realized P&L timeline regressions. Code version: v1.0.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentEquityChartRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/equity-chart.js';

function createTimelineRuntime(transactions, chartDates) {
    const runtime = {
        state: {
            investmentRawTransactionsCache: transactions,
            investmentChartPointsCache: chartDates.map((date) => ({date})),
        },
        getInvestmentAggregateOnlyTransactions: (rows) => rows,
        getNormalizedTransactionType: (txn) => txn.type,
        getInvestmentCanonicalTicker: (ticker) => String(ticker || '').toUpperCase(),
        normalizeLedgerDate: (value) => String(value || '').slice(0, 10),
        normalizeInvestmentBroker: (value) => String(value || '').toLowerCase(),
        getTransactionBrokerCode: (txn) => txn.broker,
        getOptionalInvestmentNumber: (value) => (
            value === null || value === undefined || !Number.isFinite(Number(value))
                ? null
                : Number(value)
        ),
        getInvestmentCanonicalSummaryRealizedPnl: (summary) => summary.realizedPnl,
    };
    return {runtime, chart: createInvestmentEquityChartRuntime(runtime)};
}

const transactions = [
    {broker: 'ibkr', ticker: 'AAA', type: 'sell', date: '2026-03-10'},
    {broker: 'ibkr', ticker: 'AAA', type: 'sell', date: '2026-04-20'},
    {broker: 'hsbc', ticker: 'BBB', type: 'sell', date: '2026-06-05'},
    {broker: 'ibkr', ticker: 'CCC', type: 'sell', date: '2026-02-01'},
];

const summaries = [
    {
        // Broker performance baseline stamped with the artifact as-of date.
        ticker: 'AAA',
        realizedPnl: 150,
        realizedPnlAccounts: [{
            broker: 'ibkr',
            source: 'broker_performance_snapshot',
            realizedPnl: 150,
            realizedPnlLocal: 150,
            realizedPnlByDateLocal: {'2026-09-04': 100, '2026-09-10': 50},
            reconciliation: {
                baselineRealizedPnlLocal: 100,
                asOf: {performanceSnapshot: '2026-09-04'},
            },
        }],
    },
    {
        // Per-sale reconstruction dates are authoritative as-is.
        ticker: 'BBB',
        realizedPnl: 20,
        realizedPnlAccounts: [{
            broker: 'hsbc',
            source: 'account_tax_lot_reconstruction',
            realizedPnl: 20,
            realizedPnlLocal: 20,
            realizedPnlByDateLocal: {'2026-06-05': 20},
            reconciliation: {baselineRealizedPnlLocal: 0, asOf: {}},
        }],
    },
    {
        // A ticker-level remainder without account attribution.
        ticker: 'CCC',
        realizedPnl: 7,
        realizedPnlAccounts: [],
    },
];

test('historical realized P&L dates a broker baseline to its last disposal, not the artifact as-of date', () => {
    const {runtime, chart} = createTimelineRuntime(transactions, ['2026-01-02', '2026-09-22']);
    runtime.state.investmentChartRealizedPnlTimeline = chart.buildInvestmentChartRealizedPnlTimeline(summaries);
    const at = (date) => chart.getInvestmentChartTimelineRealizedPnl(date);

    assert.equal(at('2026-01-31'), 0);
    assert.equal(at('2026-02-01'), 7);
    assert.equal(at('2026-04-19'), 7);
    assert.equal(at('2026-04-20'), 107);
    assert.equal(at('2026-06-05'), 127);
    assert.equal(at('2026-09-09'), 127);
    assert.equal(at('2026-09-22'), 177);
});

test('historical realized P&L totals equal Holdings at the latest point', () => {
    const {runtime, chart} = createTimelineRuntime(transactions, ['2026-01-02', '2026-09-22']);
    runtime.state.investmentChartRealizedPnlTimeline = chart.buildInvestmentChartRealizedPnlTimeline(summaries);
    const holdingsRealizedPnl = summaries.reduce((total, summary) => total + summary.realizedPnl, 0);

    assert.equal(chart.getInvestmentChartTimelineRealizedPnl('2026-09-22'), holdingsRealizedPnl);
});

test('a remainder without any disposal enters only the latest chart date', () => {
    const {runtime, chart} = createTimelineRuntime([], ['2026-01-02', '2026-09-22']);
    runtime.state.investmentChartRealizedPnlTimeline = chart.buildInvestmentChartRealizedPnlTimeline([
        {ticker: 'DDD', realizedPnl: 12, realizedPnlAccounts: []},
    ]);

    assert.equal(chart.getInvestmentChartTimelineRealizedPnl('2026-09-21'), 0);
    assert.equal(chart.getInvestmentChartTimelineRealizedPnl('2026-09-22'), 12);
});

test('an unavailable ticker realized value leaves the timeline unavailable', () => {
    const {chart} = createTimelineRuntime(transactions, ['2026-09-22']);

    assert.equal(chart.buildInvestmentChartRealizedPnlTimeline([
        {ticker: 'AAA', realizedPnl: null, realizedPnlAccounts: []},
    ]), null);
});
