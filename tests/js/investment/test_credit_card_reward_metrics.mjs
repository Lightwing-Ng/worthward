/* Code version: v1.1.0
 * Posted RewardCash joins realized reward income outside investment cash replay.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber} from './data_utils/context.mjs';
import {createInvestmentRuntimeConfig} from '../../../app/web/static/assets/js/investment/runtime/config.js';
import {createInvestmentFundingMetricsRuntime} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';

const originalWindow = globalThis.window;
const rewardRows = [
    {id: 'card-reward-a', date: '2026-09-18', currency: 'HKD', amount: '15.00'},
    {id: 'card-reward-b', date: '2026-10-12', currency: 'HKD', amount: '25.00'},
];
const transactions = [{
    date: '2026-09-01', type: 'deposit', broker: 'hsbc', currency: 'USD',
    normalized: {net_amount: '1000.00', cash_flow_amount: '1000.00'},
}, {
    date: '2026-09-02', type: 'kol_reward', broker: 'hsbc', currency: 'USD',
    description: 'KOL Rewards', normalized: {net_amount: '10.00', cash_flow_amount: '10.00'},
}];

beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
        transactions: structuredClone(transactions),
        fx_rate_history_by_currency: {},
        credit_card_rewards: {
            status: 'complete', transactions: structuredClone(rewardRows),
            fx_rate_history_by_currency: {
                HKD: {dates: ['2026-09-01'], values: {'2026-09-01': 7.8}},
            },
        },
    }};
});
afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function makeRuntime() {
    const runtime = {
        ...createUtils(), getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber,
        applyInvestmentAggregatePnlAvailability: (rows) => rows,
        getInvestmentCanonicalSummaryRealizedPnl: (row) => row.realizedPnl,
        resolveInvestmentMetricsCurrentCash: () => ({cash: 1010, cashIsApproximate: false}),
        escapeHtml: String, renderWorkspaceMetricValueContent: String,
    };
    Object.assign(runtime, createInvestmentRuntimeConfig(runtime));
    Object.assign(runtime, createInvestmentFundingMetricsRuntime(runtime));
    Object.assign(runtime, createInvestmentMetricsImportRuntime(runtime));
    runtime.resolveInvestmentMetricsCurrentCash = () => ({cash: 1010, cashIsApproximate: false});
    return runtime;
}

test('RewardCash is converted by date and disclosed separately from KOL rewards', () => {
    const runtime = makeRuntime();
    const benefit = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    const original = structuredClone(benefit);
    const disclosure = runtime.getMetricsRewardDisclosureMetrics(benefit, transactions, {brokerCode: 'hsbc'});
    assert.ok(Math.abs(disclosure.rewardDisclosureIncome - 40 / 7.8) < 1e-10);
    assert.equal(disclosure.kolRewardIncome, 10);
    assert.equal(disclosure.cashRewardIncome, 0);
    assert.equal(disclosure.rewardDisclosureUnavailable, false);
    assert.deepEqual(disclosure.rewardDisclosureDetails.map(({label}) => label), ['RewardCash · HKD']);
    assert.match(disclosure.rewardDisclosureDetails[0].value, /40\.00/);
    assert.deepEqual(benefit, original);
    assert.deepEqual(runtime.getBrokerRewardLedgerRows(disclosure), [2]);
    assert.ok(Math.abs(runtime.getBrokerRewardRealizedIncome(disclosure) - (10 + 40 / 7.8)) < 1e-10);
    const html = runtime.renderMetricCards(runtime.BROKER_BENEFIT_METRIC_DEFINITIONS.slice(0, 1), disclosure);
    assert.match(html, />Rewards</);
    assert.match(html, /RewardCash · HKD/);
    assert.equal(runtime.BROKER_BENEFIT_METRIC_DEFINITIONS[1].label, 'KOL rewards');
    assert.doesNotMatch(html, /card-reward-a|card-reward-b|data-investment-hover-ledger/);
});

test('Card rewards enter All and HSBC Metrics and stay outside other broker scopes', () => {
    const runtime = makeRuntime();
    const benefit = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    for (const brokerCode of ['all', 'hsbc']) {
        const metrics = runtime.getMetricsRewardDisclosureMetrics(benefit, transactions, {brokerCode});
        assert.ok(metrics.rewardDisclosureIncome > 5);
    }
    for (const brokerCode of ['schwab', 'longbridge_hk', 'ibkr']) {
        const metrics = runtime.getMetricsRewardDisclosureMetrics(benefit, transactions, {brokerCode});
        assert.equal(metrics.rewardDisclosureIncome, 0);
        assert.deepEqual(metrics.rewardDisclosureDetails, []);
    }
});

test('Posted RewardCash increases realized and cumulative P&L while preserving cash, equity, and ledger rows', () => {
    const runtime = makeRuntime();
    const investmentData = structuredClone(window.WORTHWARD_INVESTMENT_DATA);
    const benefits = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    const before = runtime.getHoldingsSummaryMetrics(transactions, {}, 1010, benefits, {brokerCode: 'hsbc'});
    const historicalBefore = runtime.getInvestmentHistoricalRealizedPnl(transactions, []);
    const disclosure = runtime.getMetricsRewardDisclosureMetrics(benefits, transactions, {brokerCode: 'hsbc'});
    const after = runtime.getHoldingsSummaryMetrics(transactions, {}, 1010, disclosure, {brokerCode: 'hsbc'});
    assert.ok(Math.abs(after.totalRealizedPnl - before.totalRealizedPnl - 40 / 7.8) < 1e-10);
    assert.ok(Math.abs(after.cumulativePnl - before.cumulativePnl - 40 / 7.8) < 1e-10);
    assert.equal(after.totalUnrealizedPnl, before.totalUnrealizedPnl);
    assert.equal(after.cash, before.cash);
    assert.equal(after.totalEquity, before.totalEquity);
    assert.deepEqual(after.realizedPnlRows, before.realizedPnlRows);
    assert.deepEqual(after.tickerSummaries, before.tickerSummaries);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(transactions, []), historicalBefore);
    assert.ok(Math.abs(runtime.getInvestmentHistoricalRealizedPnl(transactions, [], {asOfDate: '2026-10-12'})
        - after.totalRealizedPnl) < 1e-10);
    assert.deepEqual(window.WORTHWARD_INVESTMENT_DATA, investmentData);
    assert.deepEqual(runtime.buildInvestmentFxRateTimeline(transactions).ratesByCurrency.HKD, undefined);
});

test('Missing dated FX or a damaged card ledger shows Unavailable and preserves native totals', () => {
    const runtime = makeRuntime();
    const benefits = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.fx_rate_history_by_currency = {
        HKD: {dates: ['2026-10-01'], values: {'2026-10-01': 7.8}},
    };
    let disclosure = runtime.getMetricsRewardDisclosureMetrics(benefits, transactions);
    assert.equal(disclosure.rewardDisclosureUnavailable, true);
    assert.ok(Number.isNaN(disclosure.rewardDisclosureIncome));
    assert.match(disclosure.rewardDisclosureDetails[0].value, /40\.00/);
    assert.equal(runtime.BROKER_BENEFIT_METRIC_DEFINITIONS[0].formatValue(disclosure), 'Unavailable');
    assert.ok(Number.isNaN(runtime.getBrokerRewardRealizedIncome(disclosure)));
    assert.equal(disclosure.creditCardRewardUnavailable, true);
    const summary = runtime.getHoldingsSummaryMetrics(transactions, {}, 1010, disclosure, {brokerCode: 'hsbc'});
    assert.equal(summary.totalRealizedPnl, null);
    assert.equal(summary.cumulativePnl, null);
    assert.equal(summary.pnlUnavailable, true);
    assert.equal(summary.creditCardRewardUnavailable, true);
    assert.equal(summary.investmentPnlUnavailable, false);
    assert.equal(summary.cash, 1010);
    assert.equal(summary.totalEquity, 1010);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {status: 'unavailable', transactions: []};
    disclosure = runtime.getMetricsRewardDisclosureMetrics(benefits, transactions);
    assert.equal(disclosure.rewardDisclosureUnavailable, true);
    assert.equal(disclosure.rewardDisclosureDetails[0].value, 'Unavailable');
    assert.ok(Number.isNaN(runtime.getBrokerRewardRealizedIncome(disclosure)));
    assert.equal(runtime.getMetricsRewardDisclosureMetrics(benefits, transactions, {brokerCode: 'schwab'}).rewardDisclosureUnavailable, false);
});

test('RewardCash duplicate IDs do not inflate the Metrics disclosure', () => {
    const runtime = makeRuntime();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions.push({...rewardRows[0]});
    const metrics = runtime.getMetricsRewardDisclosureMetrics({}, transactions);
    assert.ok(Math.abs(metrics.rewardDisclosureIncome - 40 / 7.8) < 1e-10);
});

test('Repeated aggregation and switching broker scope do not duplicate card income', () => {
    const runtime = makeRuntime();
    const benefits = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    const once = runtime.getMetricsRewardDisclosureMetrics(benefits, transactions);
    const twice = runtime.getMetricsRewardDisclosureMetrics(once, transactions);
    assert.deepEqual(twice, once);
    assert.deepEqual(runtime.getBrokerRewardLedgerRows(twice), [2]);
    const otherBroker = runtime.getMetricsRewardDisclosureMetrics(twice, transactions, {brokerCode: 'ibkr'});
    assert.equal(otherBroker.creditCardRewardIncome, 0);
    assert.equal(otherBroker.creditCardRewardUnavailable, false);
    assert.equal(runtime.getBrokerRewardRealizedIncome(otherBroker), 10);
    assert.deepEqual(otherBroker.rewardDisclosureDetails, []);
});

test('Historical RewardCash enters on each activity date using only its applicable dated FX', () => {
    const runtime = makeRuntime();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.fx_rate_history_by_currency = {
        HKD: {dates: ['2026-09-18', '2026-10-12'], values: {'2026-09-18': 7.5, '2026-10-12': 8}},
    };
    for (const [asOfDate, expected] of [
        ['2026-09-17', 10], ['2026-09-18', 12], ['2026-10-11', 12], ['2026-10-12', 15.125],
    ]) {
        assert.equal(runtime.getInvestmentHistoricalRealizedPnl(transactions, [], {asOfDate}), expected);
    }
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(transactions, [], {
        asOfDate: '2026-10-12', brokerCode: 'ibkr',
    }), 10);
    const current = runtime.getMetricsRewardDisclosureMetrics({}, transactions);
    assert.equal(current.creditCardRewardIncome, 5.125);
});

test('Missing later card FX does not invalidate dates before that reward was posted', () => {
    const runtime = makeRuntime();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions = [{...rewardRows[1]}];
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.fx_rate_history_by_currency = {};
    const earlier = runtime.getMetricsRewardDisclosureMetrics({}, transactions, {asOfDate: '2026-10-11'});
    assert.equal(earlier.creditCardRewardIncome, 0);
    assert.equal(earlier.rewardDisclosureUnavailable, false);
    assert.deepEqual(earlier.rewardDisclosureDetails, []);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(transactions, [], {asOfDate: '2026-10-11'}), 10);
    assert.ok(Number.isNaN(runtime.getInvestmentHistoricalRealizedPnl(transactions, [], {asOfDate: '2026-10-12'})));
});

test('Empty posted card rewards add zero while unavailable card data does not become zero', () => {
    const runtime = makeRuntime();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions = [];
    const empty = runtime.getMetricsRewardDisclosureMetrics({}, transactions);
    assert.equal(empty.creditCardRewardIncome, 0);
    assert.equal(empty.creditCardRewardUnavailable, false);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.status = 'unavailable';
    const unavailable = runtime.getMetricsRewardDisclosureMetrics({}, transactions);
    assert.ok(Number.isNaN(unavailable.creditCardRewardIncome));
    assert.equal(unavailable.creditCardRewardUnavailable, true);
    const otherBroker = runtime.getMetricsRewardDisclosureMetrics(unavailable, transactions, {brokerCode: 'schwab'});
    assert.equal(otherBroker.creditCardRewardIncome, 0);
    assert.equal(otherBroker.rewardDisclosureUnavailable, false);
});

test('Damaged posted reward records fail closed instead of producing partial realized income', () => {
    const runtime = makeRuntime();
    const benefits = runtime.getBrokerBenefitMetrics(transactions, {}, 1010);
    for (const damaged of [
        {...rewardRows[1], id: ''}, {...rewardRows[1], date: ''},
        {...rewardRows[1], amount: 'unknown'}, {...rewardRows[1], currency: 'USD'},
    ]) {
        window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions = [{...rewardRows[0]}, damaged];
        const metrics = runtime.getMetricsRewardDisclosureMetrics(benefits, transactions);
        assert.equal(metrics.creditCardRewardUnavailable, true);
        assert.ok(Number.isNaN(metrics.creditCardRewardIncome));
        assert.ok(Number.isNaN(runtime.getBrokerRewardRealizedIncome(metrics)));
        assert.deepEqual(runtime.getBrokerRewardLedgerRows(metrics), [2]);
    }
});
