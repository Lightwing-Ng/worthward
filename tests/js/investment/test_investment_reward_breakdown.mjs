/* Code version: v1.0.0
 * Reward disclosure keeps numeric categories, dated FX, and signed native evidence.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils} from './data_utils/context.mjs';
import {
    createInvestmentFundingMetricsRuntime,
    getBrokerRewardBreakdown,
} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';

const originalWindow = globalThis.window;
const row = (date, currency, amount, type, description, broker = 'hsbc', source = {}) => ({
    date, currency, type, description, broker, source,
    normalized: {net_amount: String(amount), cash_flow_amount: String(amount)},
});
const transactions = () => [
    row('2026-02-02', 'HKD', 16, 'deposit', 'Coupon rebate', 'longbridge_hk', {transaction_type_raw: 'KOL'}),
    row('2026-02-02', 'USD', 5, 'cash_reward', 'Cash reward'),
    row('2026-02-03', 'USD', -1, 'cash_reward', 'Cash reward reversal'),
    row('2026-02-02', 'HKD', 16, 'credit_interest', 'CASH REBATE 0055', 'hsbc', {
        file_kind: 'hsbc_multi_currency_cash_account_text', account_type: 'HKD Savings',
    }),
    row('2026-02-03', 'HKD', -10, 'withdrawal', 'CASH REBATE REV 0055', 'hsbc', {
        file_kind: 'hsbc_multi_currency_cash_account_text', account_type: 'HKD Savings',
    }),
    row('2026-02-02', 'CNH', 8, 'deposit', 'REFUND P MEITUAN REBATE', 'hsbc', {
        file_kind: 'hsbc_multi_currency_cash_account_text', account_type: 'RMB Savings',
    }),
    row('2026-02-02', 'SGD', 20, 'kol_reward', 'KOL Rewards', 'longbridge_sg'),
    row('2026-02-02', 'USD', 3, 'kol_reward', 'KOL Rewards'),
];

beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
        fx_rate_history_by_currency: {
            HKD: {dates: ['2026-02-02', '2026-02-03'], values: {'2026-02-02': 8, '2026-02-03': 10}},
            CNH: {dates: ['2026-02-02'], values: {'2026-02-02': 4}},
            SGD: {dates: ['2026-02-02'], values: {'2026-02-02': 2}},
        },
        credit_card_rewards: {status: 'complete', fx_rate_history_by_currency: {}, transactions: [
            {id: 'reward-a', date: '2026-02-02', currency: 'HKD', amount: '80'},
            {id: 'rebate-a', kind: 'rebate', date: '2026-02-03', currency: 'HKD', amount: '20'},
            {id: 'rebate-a', kind: 'rebate', date: '2026-02-03', currency: 'HKD', amount: '20'},
        ]},
    }};
});
afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function makeRuntime() {
    const runtime = {...createUtils()};
    Object.assign(runtime, createInvestmentFundingMetricsRuntime(runtime));
    Object.assign(runtime, createInvestmentMetricsImportRuntime(runtime));
    return runtime;
}

test('six reward categories sum to the aggregate once and retain signed native amounts', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    const before = structuredClone(rows);
    const metrics = runtime.getMetricsRewardDisclosureMetrics(runtime.getBrokerBenefitMetrics(rows, {}, 0), rows);
    const breakdown = runtime.getBrokerRewardBreakdown(metrics);
    assert.deepEqual(breakdown, [
        {key: 'coupons', label: 'Coupons', amount: 2, nativeTotals: [{currency: 'HKD', amount: 16}]},
        {key: 'cash_rewards', label: 'Cash rewards', amount: 4, nativeTotals: [{currency: 'USD', amount: 4}]},
        {key: 'debit_card_cashback', label: 'Debit-card rebates', amount: 3, nativeTotals: [
            {currency: 'CNH', amount: 8}, {currency: 'HKD', amount: 6},
        ]},
        {key: 'kol_rewards', label: 'KOL rewards', amount: 13, nativeTotals: [
            {currency: 'SGD', amount: 20}, {currency: 'USD', amount: 3},
        ]},
        {key: 'card_rewardcash', label: 'Credit-card RewardCash', amount: 10, nativeTotals: [{currency: 'HKD', amount: 80}]},
        {key: 'card_rebates', label: 'Credit-card rebates', amount: 2, nativeTotals: [{currency: 'HKD', amount: 20}]},
    ]);
    assert.equal(breakdown.reduce((sum, entry) => sum + entry.amount, 0), runtime.getBrokerRewardRealizedIncome(metrics));
    assert.equal(runtime.getBrokerRewardRealizedIncome(metrics), 34);
    assert.deepEqual(rows, before);
});

test('missing dated FX affects its category while native amounts and other categories survive', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    delete window.WORTHWARD_INVESTMENT_DATA.fx_rate_history_by_currency.SGD;
    const metrics = runtime.getMetricsRewardDisclosureMetrics(runtime.getBrokerBenefitMetrics(rows, {}, 0), rows);
    const breakdown = getBrokerRewardBreakdown(metrics);
    const kol = breakdown.find(({key}) => key === 'kol_rewards');
    assert.ok(Number.isNaN(kol.amount));
    assert.deepEqual(kol.nativeTotals, [{currency: 'SGD', amount: 20}, {currency: 'USD', amount: 3}]);
    assert.ok(breakdown.filter(({key}) => key !== 'kol_rewards').every(({amount}) => Number.isFinite(amount)));
    assert.ok(Number.isNaN(runtime.getBrokerRewardRealizedIncome(metrics)));
});

test('card kinds keep independent conversion availability and deduplicate before aggregation', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions[0].date = '2026-02-01';
    const metrics = runtime.getMetricsRewardDisclosureMetrics(runtime.getBrokerBenefitMetrics(rows, {}, 0), rows);
    const breakdown = getBrokerRewardBreakdown(metrics);
    assert.ok(Number.isNaN(breakdown.find(({key}) => key === 'card_rewardcash').amount));
    assert.deepEqual(breakdown.find(({key}) => key === 'card_rewardcash').nativeTotals, [{currency: 'HKD', amount: 80}]);
    assert.equal(breakdown.find(({key}) => key === 'card_rebates').amount, 2);
    assert.ok(Number.isNaN(metrics.creditCardRewardIncome));
});

test('repeated disclosure, dated cutoff, and broker changes neither duplicate nor retain card categories', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 0);
    const once = runtime.getMetricsRewardDisclosureMetrics(benefits, rows);
    const twice = runtime.getMetricsRewardDisclosureMetrics(once, rows);
    assert.deepEqual(getBrokerRewardBreakdown(twice), getBrokerRewardBreakdown(once));
    const earlier = runtime.getMetricsRewardDisclosureMetrics(benefits, rows, {asOfDate: '2026-02-02'});
    assert.equal(getBrokerRewardBreakdown(earlier).some(({key}) => key === 'card_rebates'), false);
    const otherBroker = runtime.getMetricsRewardDisclosureMetrics(twice, rows, {brokerCode: 'schwab'});
    assert.equal(getBrokerRewardBreakdown(otherBroker).some(({key}) => key.startsWith('card_')), false);
    const copied = getBrokerRewardBreakdown(once);
    copied[0].nativeTotals[0].amount = 999;
    assert.equal(getBrokerRewardBreakdown(once)[0].nativeTotals[0].amount, 16);
});

test('legacy metric mocks retain aggregate categories and unknown card income without inventing a split', () => {
    assert.deepEqual(getBrokerRewardBreakdown({
        couponRebateIncome: 2, cashRewardIncome: -3, kolRewardIncome: 4, creditCardRewardIncome: NaN,
    }), [
        {key: 'coupons', label: 'Coupons', amount: 2, nativeTotals: []},
        {key: 'cash_rewards', label: 'Cash rewards', amount: -3, nativeTotals: []},
        {key: 'kol_rewards', label: 'KOL rewards', amount: 4, nativeTotals: []},
        {key: 'card_rewards', label: 'Credit-card rewards', amount: NaN, nativeTotals: []},
    ]);
    assert.deepEqual(getBrokerRewardBreakdown({}), []);
});

test('a damaged card source retains an explicit unknown card category beside known broker income', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.status = 'unavailable';
    const metrics = runtime.getMetricsRewardDisclosureMetrics(runtime.getBrokerBenefitMetrics(rows, {}, 0), rows);
    const breakdown = getBrokerRewardBreakdown(metrics);
    assert.ok(Number.isNaN(breakdown.find(({key}) => key === 'card_rewards').amount));
    assert.equal(breakdown.find(({key}) => key === 'kol_rewards').amount, 13);
});
