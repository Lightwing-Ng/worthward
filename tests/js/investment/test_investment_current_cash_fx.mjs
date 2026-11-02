/* Code version: v1.0.0
 * Current native cash requires recent market FX, separate from historical trades.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils} from './data_utils/context.mjs';
import {inspectInvestmentReplay} from './hsbc_multicurrency_replay_support.mjs';

const CURRENT_DATE = '2026-06-08';
const originalWindow = globalThis.window;

beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {}};
});

afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function marketHistory(date = '2026-06-05', rate = 8) {
    return {HKD: {dates: [date], values: {[date]: rate}}};
}

function historicalConversion(date = '2026-06-01') {
    return {
        broker: 'longbridge_hk', account: 'FX-ACCOUNT', date,
        type: 'forex_trade_component', ticker: 'USD.HKD', currency: 'USD',
        price_raw: '7.5', normalized: {unit_price: '7.5', net_amount: '1'},
    };
}

function setMarketHistory(history) {
    window.WORTHWARD_INVESTMENT_DATA.fx_rate_history_by_currency = history;
}

function setNativeCashSnapshot() {
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {hsbc: {
        broker: 'hsbc', cash_snapshot_authoritative: true,
        cash_snapshot_as_of: CURRENT_DATE,
        ending_cash_base_currency: '5.00',
        ending_cash_by_currency: {USD: '5.00', HKD: '800.00'},
        hsbc_pending_settlement_cash: '0.00',
        hsbc_pending_settlement_order_count: 0,
    }};
}

test('historical trade FX remains valid without supplying a current cash rate', () => {
    const utils = createUtils();
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    assert.equal(
        utils.convertAmountToBaseCurrency(750, 'HKD', '2026-06-01', timeline, 'USD'),
        100,
    );
    assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
        {USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD',
    )));
});

test('a same-day trade cannot override market FX for another broker current cash', () => {
    const utils = createUtils();
    setMarketHistory(marketHistory(CURRENT_DATE));
    setNativeCashSnapshot();
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion(CURRENT_DATE)], 'USD');
    assert.equal(utils.convertAmountToBaseCurrency(750, 'HKD', CURRENT_DATE, timeline, 'USD'), 100);
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD'), 105);
    const snapshot = utils.getInvestmentBrokerCurrentCashSnapshot('hsbc', CURRENT_DATE, timeline);
    assert.equal(snapshot.runningCash, 105);
    assert.equal(snapshot.displayCash, 105);
    assert.deepEqual(snapshot.runningBalances, {USD: 5, HKD: 800});
});

for (const [label, history] of [
    ['missing history', undefined],
    ['empty history', {}],
    ['empty currency history', {HKD: {dates: [], values: {}}}],
    ['future-only history', marketHistory('2026-06-09')],
    ['zero rate', marketHistory(CURRENT_DATE, 0)],
    ['negative rate', marketHistory(CURRENT_DATE, -8)],
    ['nonfinite rate', marketHistory(CURRENT_DATE, Infinity)],
    ['nonnumeric rate', marketHistory(CURRENT_DATE, 'unknown')],
]) {
    test(`current foreign cash fails closed with ${label} despite historical trade FX`, () => {
        const utils = createUtils();
        setMarketHistory(history);
        const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
        const amount = utils.sumCurrentCashLedgerInBaseCurrency(
            {USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD',
        );
        assert.ok(Number.isNaN(amount));
        assert.equal(utils.computeInvestmentLiveHoldingsTotalEquity([], amount), null);
        assert.equal(utils.convertAmountToBaseCurrency(750, 'HKD', '2026-06-01', timeline, 'USD'), 100);
    });
}

test('base currency and zero foreign balances do not require market FX', () => {
    const utils = createUtils();
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 5, HKD: 0}, CURRENT_DATE, timeline, 'USD'), 5);
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({}, CURRENT_DATE, timeline, 'USD'), 0);
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 0, HKD: 0}, CURRENT_DATE, timeline, 'USD'), 0);
});

test('Friday market FX remains usable over the weekend without using future quotes', () => {
    const utils = createUtils();
    setMarketHistory({HKD: {
        dates: ['2026-06-05', '2026-06-08'],
        values: {'2026-06-05': 8, '2026-06-08': 10},
    }});
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 5, HKD: 800}, '2026-06-07', timeline, 'USD'), 105);
});

test('current market FX expires after seven calendar days', () => {
    const utils = createUtils();
    setMarketHistory(marketHistory('2026-06-01'));
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 5, HKD: 800}, '2026-06-08', timeline, 'USD'), 105);
    assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
        {USD: 5, HKD: 800}, '2026-06-09', timeline, 'USD',
    )));
    assert.equal(utils.convertAmountToBaseCurrency(750, 'HKD', '2026-06-09', timeline, 'USD'), 100);
});

test('legacy timelines obtain current rates from API market history, never their historical map', () => {
    const utils = createUtils();
    const timeline = {baseCurrency: 'USD', ratesByCurrency: marketHistory('2026-06-01', 7.5)};
    setMarketHistory(marketHistory());
    assert.equal(utils.sumCurrentCashLedgerInBaseCurrency({USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD'), 105);
    setMarketHistory({});
    assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
        {USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD',
    )));
});

test('an explicitly empty captured market map cannot be replaced by historical rates', () => {
    const utils = createUtils();
    setMarketHistory(marketHistory());
    const timeline = {
        baseCurrency: 'USD', ratesByCurrency: marketHistory('2026-06-01', 7.5),
        marketRatesByCurrency: {},
    };
    assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
        {USD: 5, HKD: 800}, CURRENT_DATE, timeline, 'USD',
    )));
});

test('post-snapshot native cash changes use current market FX without rewriting the snapshot', () => {
    const utils = createUtils();
    setMarketHistory(marketHistory());
    setNativeCashSnapshot();
    const dataBefore = structuredClone(window.WORTHWARD_INVESTMENT_DATA);
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    const snapshot = utils.getInvestmentBrokerCurrentCashSnapshot('hsbc', CURRENT_DATE, timeline, {
        postSnapshotCashDelta: {HKD: 80},
    });
    assert.equal(snapshot.displayCash, 115);
    assert.deepEqual(snapshot.runningBalances, {USD: 5, HKD: 880});
    assert.deepEqual(window.WORTHWARD_INVESTMENT_DATA, dataBefore);
});

test('independent RewardCash evidence cannot change current cash or repair missing market FX', () => {
    const utils = createUtils();
    setMarketHistory(marketHistory());
    setNativeCashSnapshot();
    const timeline = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    const before = utils.getInvestmentBrokerCurrentCashSnapshot('hsbc', CURRENT_DATE, timeline);
    window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards = {
        status: 'complete',
        transactions: [{id: 'card-reward', date: '2026-06-05', currency: 'HKD', amount: '16.00'}],
        fx_rate_history_by_currency: marketHistory('2026-06-05', 2),
    };
    const after = utils.getInvestmentBrokerCurrentCashSnapshot('hsbc', CURRENT_DATE, timeline);
    assert.equal(before.displayCash, 105);
    assert.deepEqual(after, before);
    setMarketHistory({});
    const missingMarket = utils.buildInvestmentFxRateTimeline([historicalConversion()], 'USD');
    assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
        {USD: 5, HKD: 800}, CURRENT_DATE, missingMarket, 'USD',
    )));
    assert.equal(window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards.transactions[0].amount, '16.00');
});

for (const [label, rateDate, valuationDate] of [
    ['impossible market date', '2026-02-30', '2026-03-02'],
    ['noncanonical market date', '2026-6-5', CURRENT_DATE],
    ['impossible valuation date', '2026-02-27', '2026-02-30'],
]) {
    test(`current foreign cash rejects ${label}`, () => {
        const utils = createUtils();
        const timeline = {
            baseCurrency: 'USD', ratesByCurrency: {},
            marketRatesByCurrency: marketHistory(rateDate),
        };
        assert.ok(Number.isNaN(utils.sumCurrentCashLedgerInBaseCurrency(
            {USD: 5, HKD: 800}, valuationDate, timeline, 'USD',
        )));
    });
}

for (const hasCurrentMarket of [true, false]) {
    test(`replay-only broker current cash ${hasCurrentMarket ? 'uses daily market FX' : 'rejects old cross-broker trade FX'}`, async () => {
        const payload = {
            starting_cash: 0, brokers: ['longbridge_hk', 'hsbc'], broker_summaries: {},
            summary: {position_snapshot_authoritative: false},
            transactions: [historicalConversion(hasCurrentMarket ? CURRENT_DATE : '2026-06-01'), ...[
                ['HKD', '800'], ['USD', '5'],
            ].map(([currency, amount]) => ({
                broker: 'hsbc', account: 'CASH-ACCOUNT', date: CURRENT_DATE,
                type: 'deposit', currency, normalized: {net_amount: amount},
                source: {file_kind: 'test_fixture'},
            }))],
            fx_rate_history_by_currency: hasCurrentMarket ? marketHistory() : {},
            price_history_by_ticker: {}, credit_card_rewards: {
                status: 'complete', transactions: [], fx_rate_history_by_currency: {},
            },
        };
        await inspectInvestmentReplay(payload, ({runtime, processed}) => {
            const current = runtime.resolveInvestmentMetricsCurrentCash(
                runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc',
            );
            const brokerEquity = runtime.getInvestmentBrokerSummaryTotalEquity('hsbc');
            const aggregateCash = processed.at(-1).aggregate_display_cash;
            if (hasCurrentMarket) {
                assert.equal(current.cash, 105, 'HSBC current cash uses its native balances at daily market FX');
                assert.equal(brokerEquity, 105, 'HSBC current equity contains only its own cash without open positions');
                const otherBroker = processed.find((row) => row.broker === 'longbridge_hk');
                assert.deepEqual({...otherBroker.broker_cash_by_currency}, {HKD: 1}, 'the historical FX component acquired HKD 1');
                assert.equal(aggregateCash, 105 + 1 / 8, 'aggregate current cash also converts the other broker HKD 1 at daily market FX');
                const latestBroker = [...processed].reverse().find((row) => row.broker === 'hsbc');
                latestBroker.broker_current_total_equity = null;
                assert.ok(Number.isNaN(runtime.getInvestmentBrokerSummaryTotalEquity('hsbc')), 'explicitly unavailable current equity cannot fall back to an older numeric total');
            } else {
                assert.equal(current.cash, null, 'HSBC current cash cannot use the old cross-broker execution rate');
                assert.ok(brokerEquity === null || Number.isNaN(brokerEquity), 'HSBC current equity remains unavailable with missing current cash FX');
                assert.ok(Number.isNaN(aggregateCash), 'aggregate current cash remains unavailable for its unconverted foreign balance');
                assert.equal(runtime.computeInvestmentLiveHoldingsTotalEquity([], current.cash), null);
                const historicalCash = processed.find((row) => row.broker === 'hsbc' && row.currency === 'HKD');
                assert.ok(Math.abs(historicalCash.broker_running_cash - 800 / 7.5) < 1e-9);
            }
        }, {today: CURRENT_DATE});
    });
}

for (const hasCurrentMarket of [true, false]) {
    test(`mixed authoritative and replay-only cash ${hasCurrentMarket ? 'keeps every broker' : 'cannot drop an unconverted foreign balance'}`, async () => {
        const payload = {
            starting_cash: 0, brokers: ['hsbc', 'longbridge_hk'],
            summary: {position_snapshot_authoritative: false},
            broker_summaries: {hsbc: {
                broker: 'hsbc', cash_snapshot_authoritative: true,
                cash_snapshot_as_of: CURRENT_DATE, ending_cash_as_of: CURRENT_DATE,
                ending_cash_base_currency: '5', ending_cash_by_currency: {USD: '5'},
            }},
            transactions: [
                ['hsbc', 'USD', '5'], ['longbridge_hk', 'HKD', '800'],
            ].map(([broker, currency, amount]) => ({
                broker, account: `CASH-${broker}`, date: CURRENT_DATE,
                type: 'deposit', currency, normalized: {net_amount: amount},
                source: {file_kind: 'test_fixture'},
            })),
            fx_rate_history_by_currency: hasCurrentMarket ? marketHistory() : {},
            price_history_by_ticker: {}, credit_card_rewards: {
                status: 'complete', transactions: [], fx_rate_history_by_currency: {},
            },
        };
        await inspectInvestmentReplay(payload, ({runtime, processed}) => {
            const latest = processed.at(-1);
            const hsbcCash = runtime.resolveInvestmentMetricsCurrentCash(
                runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc',
            );
            const replayCash = runtime.resolveInvestmentMetricsCurrentCash(
                runtime.getInvestmentBrokerSummaryTransactions('longbridge_hk'), 'longbridge_hk',
            );
            assert.equal(hsbcCash.cash, 5, 'the known native USD snapshot remains available');
            assert.deepEqual({...latest.aggregate_cash_by_currency}, {USD: 5, HKD: 800}, 'current aggregation retains every native currency');
            if (hasCurrentMarket) {
                assert.equal(replayCash.cash, 100);
                assert.equal(latest.aggregate_display_cash, 105, 'current aggregate includes both authoritative and replay-only cash');
            } else {
                assert.equal(replayCash.cash, null);
                assert.ok(Number.isNaN(latest.aggregate_display_cash), 'partial authoritative cash cannot replace an unknown aggregate');
            }
        }, {today: CURRENT_DATE});
    });
}
