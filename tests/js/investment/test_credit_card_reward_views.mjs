/* Code version: v1.0.0
 * RewardCash refreshes preserve dated P&L and investment asset evidence.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber} from './data_utils/context.mjs';
import {createInvestmentRuntimeConfig} from '../../../app/web/static/assets/js/investment/runtime/config.js';
import {createInvestmentFundingMetricsRuntime} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
import {createInvestmentWorkspaceControlsRuntime} from '../../../app/web/static/assets/js/investment/runtime/workspace-controls.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';
import {createInvestmentHoldingsWorkspaceRuntime} from '../../../app/web/static/assets/js/investment/runtime/holdings-workspace.js';
import {createInvestmentHoldingsLiveRuntime} from '../../../app/web/static/assets/js/investment/runtime/holdings-live.js';
import {createInvestmentEquityChartRuntime} from '../../../app/web/static/assets/js/investment/runtime/equity-chart.js';

const originalGlobals = Object.fromEntries(['window', 'document', 'HTMLElement', 'CSS'].map((key) => [key, globalThis[key]]));
class TestElement {
    dataset = {};
    title = '';
    classes = new Set();
    classList = {
        add: (...values) => values.forEach((value) => this.classes.add(value)),
        remove: (...values) => values.forEach((value) => this.classes.delete(value)),
        contains: (value) => this.classes.has(value),
        toggle: (value, enabled) => enabled ? this.classes.add(value) : this.classes.delete(value),
    };
    closest(selector) {
        if (selector === 'td') return this.cell ?? null;
        if (selector === '.investment-holdings-daily-pnl-badge') return this.badge ?? null;
        return null;
    }
}
beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {transactions: [], credit_card_rewards: {status: 'complete', transactions: [], fx_rate_history_by_currency: {}}}};
    globalThis.document = {querySelector: () => null, querySelectorAll: () => []};
    globalThis.HTMLElement = TestElement;
    globalThis.CSS = {escape: (value) => value};
});
afterEach(() => {
    Object.entries(originalGlobals).forEach(([key, value]) => {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
    });
});

function openSummary(overrides = {}) {
    return {
        ticker: 'OPEN', shares: 10, averagePrice: 10, lastPrice: 12, marketValue: 120,
        quoteCurrency: 'USD', hasOpenPosition: true, pnlUnavailable: false,
        realizedPnl: 15, realizedPnlStatus: 'complete',
        unrealizedPnl: 20, ...overrides,
    };
}
function makeRuntime(summaries, rewards = {}) {
    const runtime = {
        ...createUtils(), getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber,
        INVESTMENT_DAILY_PNL_DISPLAY_EPSILON: 0.005,
        INVESTMENT_LIVE_DIGIT_EPSILON: 1e-9,
        state: {
            investmentRawTransactionsCache: [{type: 'deposit', ticker: '', currency: 'USD', date: '2026-01-02', net_amount_raw: '0'}],
            investmentProcessedTransactionsCache: [{date: '2026-01-02', aggregate_display_cash: 0}],
            investmentChartPointsCache: [{date: '2026-01-02', aggregate_total_equity: 120}],
            investmentTickerClosePricesCache: {}, investmentLatestPricesCache: {},
            investmentAggregateSecurityTransferState: {blocked: false}, activeInvestmentView: 'holdings',
        },
        summaryInputs: summaries, rewardInputs: rewards,
    };
    Object.assign(runtime, createInvestmentRuntimeConfig(runtime));
    [createInvestmentWorkspaceControlsRuntime, createInvestmentFundingMetricsRuntime,
        createInvestmentMetricsImportRuntime, createInvestmentHoldingsLiveRuntime,
        createInvestmentHoldingsWorkspaceRuntime].forEach((factory) => Object.assign(runtime, factory(runtime)));
    const money = (value) => Number.isFinite(value) ? value.toFixed(2) : '-';
    Object.assign(runtime, {
        buildTickerSummaries: () => runtime.summaryInputs.map((row) => ({...row})),
        applyInvestmentAggregatePnlAvailability: (rows) => rows,
        getBrokerBenefitMetrics: () => runtime.rewardInputs,
        resolveInvestmentMetricsCurrentCash: () => ({cash: 0, cashIsApproximate: false}),
        getInvestmentAggregateOnlyTransactions: (rows) => rows,
        normalizeInvestmentBroker: (value) => value,
        normalizeInvestmentTicker: (value) => String(value || '').toUpperCase(),
        getTransactionBrokerCode: (txn) => txn.broker || 'schwab',
        getInvestmentBrokerSummarySelectedCode: () => 'all',
        getInvestmentRealtimeQuoteForTicker: () => null,
        getInvestmentQuoteMarket: () => '',
        getTodayLedgerDate: () => '2026-01-02',
        getInvestmentInterestAccrualOnDate: () => 0,
        getCashEquivalentTickerSet: () => new Set(),
        hasInvestmentHoldingLiveBadgeSession: () => false,
        shouldShowInvestmentHoldingLiveBadge: () => false,
        formatHoldingsMoney: money, formatSignedHoldingsMoney: money,
        formatHoldingsPercent: money, formatHoldingsPosition: String,
        formatInvestmentCurrentCash: money,
        formatInvestmentTickerForDisplay: String,
        renderWorkspaceMetricValueContent: String,
        escapeHtml: (value) => String(value ?? ''),
        resolveInvestmentTickerProfile: () => ({}),
        resolveInvestmentTickerCompanyName: () => '',
        resolveInvestmentLogoUrls: () => [],
        getMoneyMarketFundTokenLogoClass: () => '',
        renderInvestmentTickerIdentityNameHtml: () => '',
        buildInvestmentStockDetailsHref: () => '#',
        getNumericDisplayParts: (value) => [{className: 'number', text: value}],
        setInvestmentCurrentChartPnlMetrics: (realized, unrealized) => {
            runtime.chartMetrics = {realized, unrealized};
        },
        updateInvestmentLiveValueNode: (node, display, value) => {
            if (!node) return;
            node.textContent = display;
            node.numericValue = value;
        },
        syncInvestmentLiveTone: (nodes, value, options) => {
            (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean).forEach((node) => {
                node.signedTone = options.enableSignedTone && Number.isFinite(value);
            });
        },
    });
    return runtime;
}

test('quote refresh retains posted RewardCash in rewards and P&L while preserving asset values', () => {
    const runtime = makeRuntime([openSummary()], {kolRewardIncome: 5});
    runtime.getInvestmentInterestAccrualOnDate = () => null;
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        status: 'complete',
        transactions: [{id: 'rc-a', date: '2026-01-02', currency: 'HKD', amount: 16}],
        fx_rate_history_by_currency: {HKD: {dates: ['2026-01-01'], values: {'2026-01-01': 8}}},
    };
    const rewardNode = new TestElement();
    rewardNode.cell = new TestElement();
    const rewardClone = new TestElement();
    rewardClone.cell = new TestElement();
    const cashNode = new TestElement();
    const equityNode = new TestElement();
    document.querySelectorAll = (selector) => selector.includes('data-investment-rewards-value') ? [rewardNode, rewardClone] : [];
    document.querySelector = (selector) => {
        if (selector.includes('data-investment-rewards-value')) return rewardNode;
        if (selector.includes('summary_cash_balance')) return cashNode;
        if (selector.includes('summary_total_equity')) return equityNode;
        return null;
    };
    const originalLedger = structuredClone(runtime.state.investmentRawTransactionsCache);
    runtime.syncInvestmentHoldingsRealtimeValues();
    assert.equal(rewardNode.textContent, '7.00');
    assert.equal(rewardClone.textContent, '7.00');
    assert.deepEqual(runtime.chartMetrics, {realized: 22, unrealized: 20});
    assert.equal(cashNode.numericValue, 0);
    assert.equal(equityNode.numericValue, 120);
    assert.deepEqual(runtime.state.investmentRawTransactionsCache, originalLedger);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.fx_rate_history_by_currency = {};
    runtime.syncInvestmentHoldingsRealtimeValues();
    assert.equal(rewardNode.textContent, 'Unavailable');
    assert.equal(rewardClone.textContent, 'Unavailable');
    assert.equal(rewardNode.numericValue, null);
    assert.deepEqual(runtime.chartMetrics, {realized: null, unrealized: 20});
    assert.equal(cashNode.numericValue, 0);
    assert.equal(equityNode.numericValue, 120);
});

test('historical reward P&L uses its posting date even when current RewardCash lacks FX', () => {
    const runtime = makeRuntime([]);
    Object.assign(runtime, createInvestmentEquityChartRuntime(runtime));
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        status: 'complete',
        transactions: [{id: 'rc-a', date: '2026-01-03', currency: 'HKD', amount: 16}],
        fx_rate_history_by_currency: {},
    };
    runtime.refreshInvestmentChartPnlState({
        pnlUnavailable: true, creditCardRewardUnavailable: true, investmentPnlUnavailable: false, totalRealizedPnl: null,
        totalUnrealizedPnl: 0, tickerSummaries: [],
    });
    const before = {date: '2026-01-02', aggregate_total_equity: 120};
    const onDate = {date: '2026-01-03', aggregate_total_equity: 120};
    assert.deepEqual(runtime.buildInvestmentHistoricalChartPnlMetrics(before), {
        realizedPnl: 0, unrealizedPnl: 0, cumulativePnl: 0,
    });
    assert.deepEqual(runtime.buildInvestmentHistoricalChartPnlMetrics(onDate), {
        realizedPnl: null, unrealizedPnl: 0, cumulativePnl: null,
    });
});

test('replacing equal-total card evidence invalidates cached historical dates', () => {
    const runtime = makeRuntime([]);
    Object.assign(runtime, createInvestmentEquityChartRuntime(runtime));
    const card = {
        status: 'complete',
        transactions: [{id: 'rc-a', date: '2026-01-02', currency: 'HKD', amount: 16}],
        fx_rate_history_by_currency: {HKD: {dates: ['2026-01-01'], values: {'2026-01-01': 8}}},
    };
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = card;
    const summary = {totalRealizedPnl: 2, totalUnrealizedPnl: 0, tickerSummaries: []};
    const point = {date: '2026-01-02', aggregate_total_equity: 120};
    runtime.refreshInvestmentChartPnlState(summary);
    assert.equal(runtime.buildInvestmentHistoricalChartPnlMetrics(point).realizedPnl, 2);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        ...card, transactions: [{...card.transactions[0], date: '2026-01-03'}],
    };
    runtime.refreshInvestmentChartPnlState(summary);
    assert.equal(runtime.buildInvestmentHistoricalChartPnlMetrics(point).realizedPnl, 0);
    assert.equal(runtime.state.investmentCurrentChartPnlMetrics.realizedPnl, 2);
});

test('card refresh reuses the live valuation date without rewriting daily or live asset points', () => {
    const runtime = makeRuntime([openSummary()]);
    Object.assign(runtime, createInvestmentEquityChartRuntime(runtime));
    const daily = [{date: '2026-01-02', aggregate_total_equity: 129}];
    const live = [...daily, {date: '2026-01-03', aggregate_total_equity: 120, is_realtime: true}];
    runtime.state.investmentBaseChartPointsCache = daily;
    runtime.state.investmentChartPointsCache = live;
    runtime.getInvestmentInterestAccrualOnDate = (date) => ({amount: date === '2026-01-02' ? 9 : 0});
    const panel = new TestElement();
    document.getElementById = () => panel;
    for (const name of ['attachHoldingsTableAlignmentSync', 'bindHoldingsLogoFallbacks',
        'bindHoldingsHistoryInteractions', 'bindHoldingsStockDetailsLinks']) runtime[name] = () => {};
    let metrics;
    runtime.renderInvestmentMetricsPanel = (value) => { metrics = value; };
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        status: 'complete', transactions: [{id: 'rc-a', date: '2026-01-03', currency: 'HKD', amount: 16}],
        fx_rate_history_by_currency: {HKD: {dates: ['2026-01-01'], values: {'2026-01-01': 8}}},
    };
    const originalDaily = structuredClone(daily);
    const originalLive = structuredClone(live);
    runtime.refreshInvestmentRewardViews();
    assert.equal(metrics.totalEquity, 120);
    assert.equal(metrics.holdingsSummaryMetrics.totalRealizedPnl, 17);
    assert.match(panel.innerHTML, /data-investment-rewards-value>2.00/);
    assert.equal(runtime.state.investmentBaseChartPointsCache, daily);
    assert.equal(runtime.state.investmentChartPointsCache, live);
    assert.deepEqual(daily, originalDaily);
    assert.deepEqual(live, originalLive);
});
