/* Code version: v1.0.0
 * HSBC cashback retains signed cash and reward income without becoming external funding or KOL.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils} from './data_utils/context.mjs';
import {inspectInvestmentReplay, usdSavingsCash} from './hsbc_multicurrency_replay_support.mjs';
import {createHsbcHistoryEvidenceUtils} from '../../../app/web/static/assets/js/investment/runtime/history-evidence.js';

const originalWindow = globalThis.window;
beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
        fx_rate_history_by_currency: {
            HKD: {dates: ['2026-01-01'], values: {'2026-01-01': 8}},
            CNH: {dates: ['2026-01-01'], values: {'2026-01-01': 7}},
            CNY: {dates: ['2026-01-01'], values: {'2026-01-01': 7}},
        },
    }};
});
afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function cashback({description = 'CASH REBATE 0055', type = 'credit_interest', currency = 'USD', amount = '8.00', ...overrides} = {}) {
    const row = usdSavingsCash('2026-03-02', type, amount, amount, 1, 'a'.repeat(64));
    return {
        ...row, currency, description,
        account_type: `${currency} Savings`,
        source: {...row.source, account_type: `${currency} Savings`,
            file_kind: currency === 'USD' ? 'hsbc_usd_account_text' : 'hsbc_multi_currency_cash_account_text'},
        ...overrides,
    };
}

test('ordinary and campaign cashback use exact bank descriptions and dated suffixes', () => {
    const utils = createUtils();
    for (const currency of ['USD', 'HKD', 'CNH', 'CNY']) {
        for (const [description, category] of [
            ['CASH REBATE 0055', 'standard'],
            ['CASH REBATE 0055 (02MAR26)', 'standard'],
            ['CASH REBATE 0055 CREDIT AS ADVISED', 'standard'],
            ['CASH REBATE 0055 (2MAR26) CREDIT AS ADVISED', 'standard'],
            ['CASH REBATE 0055 DEPABC123-01', 'standard'],
            ['REFUND P HSBCPCLOTRANSIT', 'campaign'],
            ['REFUND P MEITUAN REBATE', 'campaign'],
            ['REFUND P MEITUAN REBATE (02MAR26) CREDIT AS ADVISED', 'campaign'],
        ]) {
            const row = cashback({description, currency});
            assert.equal(utils.getHsbcDebitCardCashbackCategory(row), category, `${currency}: ${description}`);
            assert.equal(utils.getNormalizedTransactionType(row), 'cash_reward');
            assert.equal(utils.isKolRewardTransaction(row), false);
        }
    }
    const reversal = cashback({description: 'CASH REBATE REV 0055 (02MAR26)', type: 'withdrawal', amount: '-0.20'});
    assert.equal(utils.getHsbcDebitCardCashbackCategory(reversal), 'standard');
    assert.equal(utils.getTransactionAmount(reversal), -0.2);
    reversal.description = 'CASH REBATE REV 0055 DEBIT AS ADVISED';
    assert.equal(utils.getHsbcDebitCardCashbackCategory(reversal), 'standard');
});

test('classification requires a coherent HSBC cash source, account type, currency, amount, and direction', () => {
    const utils = createUtils();
    const base = cashback();
    const cases = [
        {...base, broker: 'ibkr'},
        {...base, source: {...base.source, broker: 'schwab'}},
        {...base, source: {...base.source, file_kind: 'hsbc_credit_card_page'}},
        {...base, source: {...base.source, file_kind: 'hsbc_order_status_text'}},
        {...base, ticker: 'TEST'},
        {...base, account_type: 'Credit Card'},
        {...base, source: {...base.source, account_type: 'USD Current'}},
        {...base, account_type: undefined, source: {...base.source, account_type: undefined}},
        {...base, currency: 'CNH'},
        {...base, source: {...base.source, statement_currency_raw: 'HKD'}},
        {...base, currency: 'EUR'},
        {...base, amount: -8},
        cashback({description: 'CASH REBATE 0055', amount: '-8.00'}),
        cashback({description: 'CASH REBATE REV 0055', amount: '8.00'}),
        cashback({description: 'REFUND P HSBCPCLOTRANSIT', amount: '-8.00'}),
        cashback({description: 'CASH REBATE 00550'}),
        cashback({description: 'CASH REBATE 0055 UNKNOWN'}),
        cashback({description: 'CASH REBATE 0055 DEBIT AS ADVISED'}),
        cashback({description: 'CASH REBATE 0055 DEPABC123-XYZ'}),
        cashback({description: 'CASH REBATE REV 0055 CREDIT AS ADVISED', amount: '-0.20'}),
        cashback({description: 'CASH REBATE 0055 (02XYZ26)'}),
        cashback({description: 'CASH REBATE 0055(2MAR26) CREDIT AS ADVISED'}),
        cashback({description: 'REFUND P UNKNOWN MERCHANT'}),
        cashback({type: 'kol_reward'}),
        cashback({type: 'dividend'}),
        {...base, source: {...base.source, transaction_type_raw: 'KOL'}},
    ];
    for (const row of cases) assert.equal(utils.getHsbcDebitCardCashbackCategory(row), '', JSON.stringify(row));
    const aliases = cashback({currency: 'CNH'});
    aliases.source.statement_currency_raw = 'CNY';
    aliases.source.account_type = 'Foreign Currency Savings RMB';
    assert.equal(utils.getHsbcDebitCardCashbackCategory(aliases), 'standard');
    const current = cashback({currency: 'HKD', account_type: 'HKD Current'});
    current.source.account_type = 'HKD Current';
    assert.equal(utils.getHsbcDebitCardCashbackCategory(current), 'standard');
});

test('legacy types become cash_reward without mutating source rows or entering external cash-flow types', () => {
    const utils = createUtils();
    for (const type of ['deposit', 'withdrawal', 'credit_interest', 'debit_interest', 'cash_reward']) {
        const row = cashback({type});
        const before = structuredClone(row);
        assert.equal(utils.getNormalizedTransactionType(row), 'cash_reward');
        assert.deepEqual(row, before);
    }
    const explicit = {type: 'cash_reward', broker: 'hsbc', date: '2026-03-02',
        currency: 'USD', amount: '-0.20', source: {file_kind: 'manual_investment_xlsx'}};
    assert.equal(utils.getHsbcDebitCardCashbackCategory(explicit), '');
    assert.equal(utils.getNormalizedTransactionType(explicit), 'cash_reward');
    assert.equal(utils.isKolRewardTransaction(explicit), false);
    assert.equal(utils.sumCashRewardRealizedIncomeInBaseCurrency([explicit], null), -0.2);
});

test('signed cashback uses each ledger date FX and remains distinct from KOL income', () => {
    const utils = createUtils();
    const rows = [
        cashback({currency: 'HKD', amount: '8.00'}),
        cashback({currency: 'CNH', amount: '7.00', description: 'REFUND P MEITUAN REBATE'}),
        cashback({currency: 'CNH', amount: '-0.70', type: 'withdrawal', description: 'CASH REBATE REV 0055'}),
        {date: '2026-03-02', type: 'kol_reward', currency: 'USD', normalized: {net_amount: '3.00'}},
    ];
    const timeline = utils.buildInvestmentFxRateTimeline(rows);
    assert.ok(Math.abs(utils.sumCashRewardRealizedIncomeInBaseCurrency(rows, timeline) - 1.9) < 1e-9);
    assert.equal(utils.sumKolRewardRealizedIncomeInBaseCurrency(rows, timeline), 3);
    const futureOnly = {baseCurrency: 'USD', ratesByCurrency: {HKD: {dates: ['2026-03-03'], values: {'2026-03-03': 8}}}};
    assert.ok(Number.isNaN(utils.sumCashRewardRealizedIncomeInBaseCurrency([rows[0]], futureOnly)));
});

test('new cash rewards retain positive and negative immutable cash-balance evidence', () => {
    const utils = createUtils();
    const evidence = createHsbcHistoryEvidenceUtils(utils, {baseCurrency: 'USD'});
    for (const [description, amount] of [['CASH REBATE 0055', '8.00'], ['CASH REBATE REV 0055', '-0.20']]) {
        const row = cashback({description, type: 'cash_reward', amount});
        assert.equal(evidence.getHsbcCashEvidenceState(row).isConsistent, true);
        assert.equal(utils.getInvestmentCashBalanceBoundary(row)?.balance, Number(amount));
    }
});

test('cash replay preserves credit and reversal signs, displays cash_reward, and excludes external funding', async () => {
    const opening = usdSavingsCash('2026-03-01', 'deposit', '100.00', '100.00', 1, 'b'.repeat(64));
    const credit = cashback();
    const reversal = cashback({description: 'CASH REBATE REV 0055', type: 'withdrawal', amount: '-0.20'});
    reversal.date = '2026-03-03';
    reversal.datetime = '2026-03-03 20:00:00';
    reversal.source.row_number = 2;
    reversal.source.ledger_sequence = 2;
    // Explicit cash deltas also work when a legacy row has no normalized view.
    for (const row of [credit, reversal]) {
        row.amount = Number(row.net_amount_raw);
        delete row.normalized;
        delete row.source.balance_after_raw;
    }
    const payload = {broker: 'hsbc', brokers: ['hsbc'], transactions: [opening, credit, reversal],
        starting_cash: 0, base_currency: 'USD', broker_summaries: {}, summary: {}, price_history_by_ticker: {}};
    const original = structuredClone(payload.transactions);
    await inspectInvestmentReplay(payload, ({runtime, processed, chartPoints}) => {
        assert.deepEqual(processed.map((row) => row.type), ['deposit', 'cash_reward', 'cash_reward']);
        assert.ok(Math.abs(processed.at(-1).running_cash - 107.8) < 1e-9);
        assert.equal(chartPoints.reduce((sum, point) => sum + point.cash_in_amount, 0), 100);
        assert.equal(chartPoints.reduce((sum, point) => sum + point.cash_out_amount, 0), 0);
        for (const point of chartPoints.filter((point) => point.date >= credit.date)) {
            assert.equal(point.net_transfer_amount, 0);
        }
        assert.equal(runtime.isKolRewardTransaction(processed[1]), false);
        assert.equal(runtime.isKolRewardTransaction(processed[2]), false);
    });
    assert.deepEqual(payload.transactions.map((row, index) => Object.fromEntries(
        Object.keys(original[index]).map((key) => [key, row[key]]),
    )), original);
});
