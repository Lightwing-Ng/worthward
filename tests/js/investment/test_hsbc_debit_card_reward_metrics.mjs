/* Code version: v1.0.1
 * Debit-card cashback is signed bank cash income; card RewardCash remains disclosure-only.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, getInvestmentAggregatePnlCoverage, parseInvestmentOptionalNumber} from './data_utils/context.mjs';
import {createInvestmentRuntimeConfig} from '../../../app/web/static/assets/js/investment/runtime/config.js';
import {createInvestmentFundingMetricsRuntime} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';

const originalWindow = globalThis.window;
const fxHistory = {
    HKD: {dates: ['2026-02-02', '2026-02-03'], values: {'2026-02-02': 8, '2026-02-03': 10}},
    CNH: {dates: ['2026-02-02', '2026-02-03'], values: {'2026-02-02': 4, '2026-02-03': 5}},
};
const bankRow = (date, currency, amount, description, type = 'credit_interest') => ({
    broker: 'hsbc', date, currency, description, type,
    source: {
        file_kind: 'hsbc_multi_currency_cash_account_text', account_number: '000-555555-001',
        account_type: currency === 'CNH' ? 'RMB Savings' : `${currency} Savings`,
    },
    normalized: {net_amount: String(amount), cash_flow_amount: String(amount)},
});
const cashbackRows = () => [
    bankRow('2026-02-02', 'USD', 6, 'CASH REBATE 0055'),
    bankRow('2026-02-02', 'HKD', 16, 'CASH REBATE 0055 (02FEB26) CREDIT AS ADVISED'),
    bankRow('2026-02-02', 'CNH', 12, 'REFUND P HSBCPCLOTRANSIT', 'deposit'),
    bankRow('2026-02-03', 'USD', 8, 'REFUND P MEITUAN REBATE', 'cash_reward'),
    bankRow('2026-02-03', 'HKD', 30, 'REFUND P HSBCPCLOTRANSIT', 'deposit'),
    bankRow('2026-02-03', 'CNH', 20, 'CASH REBATE 0055'),
    bankRow('2026-02-03', 'USD', -1, 'CASH REBATE REV 0055', 'withdrawal'),
    bankRow('2026-02-03', 'HKD', -10, 'CASH REBATE REV 0055', 'withdrawal'),
    bankRow('2026-02-03', 'CNH', -5, 'CASH REBATE REV 0055', 'withdrawal'),
];
const transactions = () => [
    bankRow('2026-02-01', 'USD', 200, 'DEPOSIT', 'deposit'),
    bankRow('2026-02-02', 'USD', 2, 'USD CREDIT INTEREST'),
    bankRow('2026-02-02', 'USD', 3, 'KOL Rewards', 'kol_reward'),
    ...cashbackRows(),
];

beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
        transactions: transactions(), fx_rate_history_by_currency: structuredClone(fxHistory),
        credit_card_rewards: {status: 'complete', transactions: [], fx_rate_history_by_currency: {}},
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
        escapeHtml: String, renderWorkspaceMetricValueContent: String,
    };
    Object.assign(runtime, createInvestmentRuntimeConfig(runtime));
    Object.assign(runtime, createInvestmentFundingMetricsRuntime(runtime));
    Object.assign(runtime, createInvestmentMetricsImportRuntime(runtime));
    runtime.resolveInvestmentMetricsCurrentCash = () => ({cash: 227, cashIsApproximate: false});
    return runtime;
}

test('three-currency standard and campaign cashback keeps signed native totals and dated FX', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    const before = structuredClone(rows);
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    // Each reversal uses its own booking-date FX, not the original credit's FX.
    assert.equal(benefits.cashRewardIncome, 23);
    assert.equal(benefits.couponAndCashRewardIncome, 23);
    assert.equal(benefits.kolRewardIncome, 3);
    assert.equal(benefits.cashRewardUsd, 13);
    assert.equal(benefits.cashRewardHkd, 36);
    assert.deepEqual(benefits.couponAndCashRewardDetails.map(({label, value}) => [label, value]), [
        ['Debit-card cashback · CNH', 'CNH 15.00'],
        ['Debit-card cashback · HKD', 'HKD 6.00'],
        ['Debit-card cashback · USD', '5.00'],
        ['Debit-card campaign rewards · CNH', 'CNH 12.00'],
        ['Debit-card campaign rewards · HKD', 'HKD 30.00'],
        ['Debit-card campaign rewards · USD', '8.00'],
    ]);
    assert.equal(benefits.cashRewardRows.length, 9);
    assert.equal(new Set(benefits.cashRewardRows).size, 9);
    assert.equal(runtime.getBrokerRewardLedgerRows(benefits).length, 10);
    assert.deepEqual(rows, before);
});

test('cashback is income once, stays outside external deposits, and does not rename KOL or interest', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    const funding = runtime.getUsdFundingMetrics(rows);
    const attribution = runtime.getRealizedPnlAttribution(rows, [], benefits);
    const holdings = runtime.getHoldingsSummaryMetrics(rows, {}, 227, benefits, {brokerCode: 'hsbc'});
    assert.equal(funding.totalDeposits, 200);
    assert.equal(funding.directUsdDeposits, 200);
    assert.equal(runtime.getBrokerRewardRealizedIncome(benefits), 26);
    assert.equal(attribution.totalRealizedPnl, 28);
    assert.deepEqual(attribution.realizedPnlDetails.map(({label, value}) => [label, value]), [
        ['Cash rewards', '+26.00'], ['Interest credited', '+2.00'],
    ]);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(rows, []), 28);
    assert.equal(holdings.totalRealizedPnl, 28);
    assert.equal(holdings.totalUnrealizedPnl, 0);
    assert.equal(holdings.cash, 227);
    assert.equal(holdings.totalEquity, 227);
    assert.equal(holdings.pnlUnavailable, false);
    assert.equal(runtime.classifyInvestmentRealizedCashFlow(rows[1]), 'interest_credit');
    assert.equal(runtime.classifyInvestmentRealizedCashFlow(rows[3]), '');
    assert.equal(runtime.isKolRewardTransaction(rows[2]), true);
    cashbackRows().forEach((row) => assert.equal(runtime.isKolRewardTransaction(row), false));
});

test('native cashback and contributing rows remain visible when dated FX is unavailable', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    delete window.WORTHWARD_INVESTMENT_DATA.fx_rate_history_by_currency.CNH;
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    const disclosure = runtime.getMetricsRewardDisclosureMetrics(benefits, rows, {brokerCode: 'hsbc'});
    const holdings = runtime.getHoldingsSummaryMetrics(rows, {}, 227, benefits, {brokerCode: 'hsbc'});
    assert.ok(Number.isNaN(benefits.cashRewardIncome));
    assert.ok(Number.isNaN(benefits.couponAndCashRewardIncome));
    assert.ok(Number.isNaN(runtime.getBrokerRewardRealizedIncome(benefits)));
    assert.ok(Number.isNaN(runtime.getInvestmentHistoricalRealizedPnl(rows, [])));
    assert.equal(disclosure.rewardDisclosureUnavailable, true);
    assert.equal(runtime.BROKER_BENEFIT_METRIC_DEFINITIONS[0].formatValue(disclosure), 'Unavailable');
    assert.equal(benefits.kolRewardIncome, 3);
    assert.equal(benefits.cashRewardRows.length, 9);
    assert.equal(disclosure.rewardDisclosureDetails.length, 6);
    assert.ok(disclosure.rewardDisclosureDetails.some(({label, value}) => label === 'Debit-card cashback · CNH' && value === 'CNH 15.00'));
    assert.ok(disclosure.rewardDisclosureDetails.some(({label, value}) => label === 'Debit-card campaign rewards · CNH' && value === 'CNH 12.00'));
    assert.equal(holdings.totalRealizedPnl, null);
    assert.equal(holdings.pnlUnavailable, true);
});

test('a later FX observation cannot value an earlier cashback or reversal', () => {
    const runtime = makeRuntime();
    window.WORTHWARD_INVESTMENT_DATA.fx_rate_history_by_currency = {
        CNH: {dates: ['2026-02-03'], values: {'2026-02-03': 5}},
    };
    for (const [amount, description, type, nativeValue] of [
        [12, 'REFUND P HSBCPCLOTRANSIT', 'deposit', 'CNH 12.00'],
        [-4, 'CASH REBATE REV 0055', 'withdrawal', '-CNH 4.00'],
    ]) {
        const rows = [bankRow('2026-02-02', 'CNH', amount, description, type)];
        const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 0);
        assert.ok(Number.isNaN(benefits.cashRewardIncome));
        assert.ok(Number.isNaN(runtime.getInvestmentHistoricalRealizedPnl(rows, [])));
        assert.equal(benefits.couponAndCashRewardDetails[0].value, nativeValue);
    }
});

test('a standalone cashback reversal is a negative reward and negative realized income', () => {
    const runtime = makeRuntime();
    const rows = [bankRow('2026-02-03', 'USD', -4, 'CASH REBATE REV 0055', 'withdrawal')];
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    assert.equal(benefits.cashRewardIncome, -4);
    assert.equal(benefits.couponAndCashRewardIncome, -4);
    assert.equal(runtime.getBrokerRewardRealizedIncome(benefits), -4);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(rows, []), -4);
    assert.equal(runtime.getRealizedPnlAttribution(rows, [], benefits).totalRealizedPnl, -4);
    assert.equal(runtime.getHoldingsSummaryMetrics(rows, {}, 227, benefits).totalRealizedPnl, -4);
    assert.equal(benefits.couponAndCashRewardDetails[0].value, '-4.00');
});

test('unknown merchant refunds and another broker cannot acquire HSBC reward income', () => {
    const runtime = makeRuntime();
    const unknown = bankRow('2026-02-02', 'USD', 4, 'REFUND P SAMPLE RESTAURANT', 'deposit');
    const otherBroker = {...bankRow('2026-02-02', 'USD', 4, 'CASH REBATE 0055'), broker: 'ibkr'};
    for (const row of [unknown, otherBroker]) {
        assert.equal(runtime.classifyBrokerBenefitTransaction(row), '');
        assert.equal(runtime.isKolRewardTransaction(row), false);
        const benefits = runtime.getBrokerBenefitMetrics([row], {}, 0);
        assert.equal(benefits.cashRewardIncome, 0);
        assert.deepEqual(benefits.couponAndCashRewardDetails, []);
    }
});

test('new cash_reward records and legacy interest or deposit records disclose identically', () => {
    const runtime = makeRuntime();
    const legacy = cashbackRows();
    const canonical = legacy.map((row) => ({...row, type: 'cash_reward'}));
    const legacyBenefits = runtime.getBrokerBenefitMetrics(legacy, {}, 0);
    const canonicalBenefits = runtime.getBrokerBenefitMetrics(canonical, {}, 0);
    assert.equal(legacyBenefits.cashRewardIncome, 23);
    assert.equal(canonicalBenefits.cashRewardIncome, 23);
    assert.deepEqual(canonicalBenefits.couponAndCashRewardDetails, legacyBenefits.couponAndCashRewardDetails);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(legacy, []), 23);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(canonical, []), 23);
    assert.equal(runtime.getUsdFundingMetrics(legacy).totalDeposits, 0);
    assert.equal(runtime.getUsdFundingMetrics(canonical).totalDeposits, 0);
});

test('explicit cash_reward rows from standard XLSX preserve signed income without bank source metadata', () => {
    const runtime = makeRuntime();
    const rows = [
        {date: '2026-02-02', amount: 9, description: 'Imported account reward'},
        {date: '2026-02-03', amount: -2, description: 'Imported reward reversal'},
    ].map(({date, amount, description}) => ({
        broker: 'ibkr', date, description, currency: 'USD', type: 'cash_reward',
        source: {file_kind: 'manual_investment_xlsx'},
        normalized: {net_amount: String(amount), cash_flow_amount: String(amount)},
    }));
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    rows.forEach((row) => assert.equal(runtime.isKolRewardTransaction(row), false));
    assert.equal(benefits.cashRewardIncome, 7);
    assert.equal(benefits.couponAndCashRewardIncome, 7);
    assert.equal(benefits.kolRewardIncome, 0);
    assert.deepEqual(benefits.couponAndCashRewardDetails.map(({label, value}) => [label, value]), [
        ['Cash rewards · USD', '7.00'],
    ]);
    assert.equal(runtime.getUsdFundingMetrics(rows).totalDeposits, 0);
    assert.equal(runtime.getBrokerRewardRealizedIncome(benefits), 7);
    assert.equal(runtime.getInvestmentHistoricalRealizedPnl(rows, []), 7);
    assert.equal(runtime.getRealizedPnlAttribution(rows, [], benefits).totalRealizedPnl, 7);
    assert.equal(runtime.getHoldingsSummaryMetrics(rows, {}, 227, benefits, {brokerCode: 'ibkr'}).totalRealizedPnl, 7);
    assert.equal(runtime.getMetricsRewardDisclosureMetrics(benefits, rows, {brokerCode: 'ibkr'}).rewardDisclosureIncome, 7);
});

test('credit-card RewardCash changes only disclosure and broker scope excludes bank cashback', () => {
    const runtime = makeRuntime();
    const rows = transactions();
    const benefits = runtime.getBrokerBenefitMetrics(rows, {}, 227);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        status: 'complete', transactions: [{id: 'synthetic-card-credit', date: '2026-02-02', currency: 'HKD', amount: '8.00'}],
        fx_rate_history_by_currency: structuredClone(fxHistory),
    };
    for (const brokerCode of ['all', 'hsbc']) {
        const disclosure = runtime.getMetricsRewardDisclosureMetrics(benefits, rows, {brokerCode});
        assert.equal(disclosure.rewardDisclosureIncome, 24);
        assert.equal(disclosure.cashRewardIncome, 23);
        assert.equal(disclosure.kolRewardIncome, 3);
        assert.equal(runtime.getBrokerRewardRealizedIncome(disclosure), 26);
        assert.equal(runtime.getHoldingsSummaryMetrics(rows, {}, 227, disclosure).totalRealizedPnl, 28);
    }
    const unrelated = [{broker: 'ibkr', date: '2026-02-01', type: 'deposit', currency: 'USD', amount: 50}];
    const otherBenefits = runtime.getBrokerBenefitMetrics(unrelated, {}, 50);
    const otherDisclosure = runtime.getMetricsRewardDisclosureMetrics(otherBenefits, unrelated, {brokerCode: 'ibkr'});
    assert.equal(otherDisclosure.rewardDisclosureIncome, 0);
    assert.equal(otherDisclosure.kolRewardIncome, 0);
    assert.deepEqual(otherDisclosure.rewardDisclosureDetails, []);
});
