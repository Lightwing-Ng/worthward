/* Code version: v1.1.1 */
// Broker interest accruals are a separate NAV component applied only on their
// dated statement boundary. All broker and account identifiers are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';

import {createUtils} from './investment_data_utils/context.mjs';

const {
    applyInvestmentInterestAccrualBoundaries,
    buildDailyEquityChartPoints,
    computeInvestmentCurrentHoldingsTotalEquity,
    getInvestmentInterestAccrualOnDate,
} = createUtils();

const BOUNDARY_DATE = '2026-06-26';
const CASH = 33.125945525;
const MARKET_VALUE = 35578.79;
const ACCRUAL = -6.5;
const EXPECTED_EQUITY = 35605.415945525;

function withInvestmentData(data, callback) {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0', ...data}};
    try {
        return callback();
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

function ibkrAccrualSnapshots(boundaries) {
    return {
        'ibkr:U00000001': {
            broker: 'ibkr',
            account: 'U00000001',
            interest_accrual_snapshots: boundaries.map(([asOf, amount, status = 'reported']) => ({
                as_of: asOf,
                status,
                currency: 'USD',
                amount: status === 'reported' ? String(amount) : '',
            })),
        },
    };
}

function makeRow({broker, date, cash, marketValue, aggregateCash = cash, aggregateMarketValue = marketValue}) {
    return {
        broker,
        date,
        broker_display_cash: cash,
        broker_market_value: marketValue,
        broker_total_equity: cash + marketValue,
        aggregate_display_cash: aggregateCash,
        aggregate_market_value: aggregateMarketValue,
        aggregate_total_equity: aggregateCash + aggregateMarketValue,
        total_equity: aggregateCash + aggregateMarketValue,
    };
}

function makeChartSnapshot({broker = 'ibkr', date, cash, holdings}) {
    return {
        broker,
        date,
        datetime: `${date} 20:00:00`,
        aggregate_running_cash: cash,
        aggregate_display_cash: cash,
        aggregate_holdings: holdings,
        aggregate_money_market_anchors: {},
    };
}

test('current Holdings equity applies one dated accrual and fails closed when it is unconvertible', () => {
    const summaries = [{ticker: 'SYNTH', hasOpenPosition: true, marketValue: MARKET_VALUE}];
    assert.equal(
        computeInvestmentCurrentHoldingsTotalEquity(summaries, CASH, {amount: ACCRUAL}),
        EXPECTED_EQUITY,
    );
    assert.equal(
        computeInvestmentCurrentHoldingsTotalEquity(summaries, CASH, {amount: Number.NaN}),
        null,
    );
    assert.equal(
        computeInvestmentCurrentHoldingsTotalEquity(summaries, CASH),
        CASH + MARKET_VALUE,
    );
});

test('historical IBKR row equity is cash plus market value plus the reported accrual', () => {
    withInvestmentData({broker_snapshots: ibkrAccrualSnapshots([[BOUNDARY_DATE, ACCRUAL]])}, () => {
        const row = makeRow({broker: 'ibkr', date: BOUNDARY_DATE, cash: CASH, marketValue: MARKET_VALUE});
        // The pre-fix defect: the replay omits the accrual.
        assert.equal(row.broker_total_equity, 35611.915945525);

        const applied = applyInvestmentInterestAccrualBoundaries([row]);

        assert.equal(applied.length, 1);
        assert.equal(row.broker_interest_accrual, ACCRUAL);
        assert.equal(row.broker_interest_accrual_as_of, BOUNDARY_DATE);
        assert.equal(row.broker_total_equity, EXPECTED_EQUITY);
        assert.equal(row.aggregate_total_equity, EXPECTED_EQUITY);
        assert.equal(row.total_equity, EXPECTED_EQUITY);
        // Accrued interest never enters cash or security market value.
        assert.equal(row.broker_display_cash, CASH);
        assert.equal(row.broker_market_value, MARKET_VALUE);
        assert.equal(row.aggregate_display_cash, CASH);
    });
});

test('daily equity on the statement date includes the accrual without changing cash', () => {
    withInvestmentData({broker_snapshots: ibkrAccrualSnapshots([[BOUNDARY_DATE, ACCRUAL]])}, () => {
        const points = buildDailyEquityChartPoints(
            [makeChartSnapshot({date: BOUNDARY_DATE, cash: CASH, holdings: {SYNTH: 1}})],
            {SYNTH: {[BOUNDARY_DATE]: MARKET_VALUE, '2026-06-29': MARKET_VALUE}},
            new Set(),
        );
        const boundaryPoint = points.find((point) => point.date === BOUNDARY_DATE);
        assert.equal(boundaryPoint.aggregate_market_value, MARKET_VALUE);
        assert.equal(boundaryPoint.aggregate_display_cash, CASH);
        assert.equal(boundaryPoint.aggregate_interest_accrual, ACCRUAL);
        assert.equal(boundaryPoint.aggregate_total_equity, EXPECTED_EQUITY);
        assert.equal(boundaryPoint.total_equity, EXPECTED_EQUITY);

        // No accrual movement evidence exists for the next date, so the old
        // boundary is not carried forward or interpolated.
        const laterPoint = points.find((point) => point.date === '2026-06-29');
        assert.equal(laterPoint.aggregate_interest_accrual, null);
        assert.equal(laterPoint.aggregate_total_equity, CASH + MARKET_VALUE);
    });
});

test('daily equity materializes an accrual-only statement date without carrying it forward', () => {
    const accrualDate = '2026-06-27';
    withInvestmentData({broker_snapshots: ibkrAccrualSnapshots([[accrualDate, -2]])}, () => {
        const points = buildDailyEquityChartPoints(
            [
                makeChartSnapshot({date: '2026-06-26', cash: 100, holdings: {}}),
                makeChartSnapshot({date: '2026-06-29', cash: 100, holdings: {}}),
            ],
            {},
            new Set(),
        );
        const boundaryPoint = points.find((point) => point.date === accrualDate);
        assert.ok(boundaryPoint);
        assert.equal(boundaryPoint.aggregate_interest_accrual, -2);
        assert.equal(boundaryPoint.aggregate_display_cash, 100);
        assert.equal(boundaryPoint.aggregate_market_value, 0);
        assert.equal(boundaryPoint.aggregate_total_equity, 98);

        const laterPoint = points.find((point) => point.date === '2026-06-29');
        assert.equal(laterPoint.aggregate_interest_accrual, null);
        assert.equal(laterPoint.aggregate_total_equity, 100);
    });
});

test('a positive accrual increases equity on its boundary', () => {
    withInvestmentData({broker_snapshots: ibkrAccrualSnapshots([['2026-03-31', 2.25]])}, () => {
        const row = makeRow({broker: 'ibkr', date: '2026-03-31', cash: 100, marketValue: 900});
        applyInvestmentInterestAccrualBoundaries([row]);
        assert.equal(row.broker_total_equity, 1002.25);
        assert.equal(row.broker_display_cash, 100);
    });
});

test('a later zero boundary never inherits an older accrual and the flat account stays zero', () => {
    const snapshots = ibkrAccrualSnapshots([[BOUNDARY_DATE, ACCRUAL], ['2026-09-17', 0]]);
    withInvestmentData({broker_snapshots: snapshots}, () => {
        const historicalRow = makeRow({broker: 'ibkr', date: BOUNDARY_DATE, cash: CASH, marketValue: MARKET_VALUE});
        const closingRow = makeRow({broker: 'ibkr', date: '2026-09-17', cash: 0, marketValue: 0});
        applyInvestmentInterestAccrualBoundaries([historicalRow, closingRow]);
        assert.equal(historicalRow.broker_total_equity, EXPECTED_EQUITY);
        assert.equal(closingRow.broker_interest_accrual, 0);
        assert.equal(closingRow.broker_display_cash, 0);
        assert.equal(closingRow.broker_market_value, 0);
        assert.equal(closingRow.broker_total_equity, 0);
        assert.equal(closingRow.aggregate_total_equity, 0);

        const points = buildDailyEquityChartPoints(
            [
                makeChartSnapshot({date: BOUNDARY_DATE, cash: CASH, holdings: {SYNTH: 1}}),
                makeChartSnapshot({date: '2026-09-17', cash: 0, holdings: {}}),
            ],
            {SYNTH: {[BOUNDARY_DATE]: MARKET_VALUE, '2026-07-01': MARKET_VALUE}},
            new Set(),
        );
        assert.equal(points.find((point) => point.date === BOUNDARY_DATE).aggregate_total_equity, EXPECTED_EQUITY);
        assert.equal(points.find((point) => point.date === '2026-07-01').aggregate_total_equity, CASH + MARKET_VALUE);
        const finalPoint = points[points.length - 1];
        assert.equal(finalPoint.date, '2026-09-17');
        assert.equal(finalPoint.aggregate_interest_accrual, 0);
        assert.equal(finalPoint.aggregate_total_equity, 0);
        assert.equal(finalPoint.aggregate_current_total_equity, 0);
        assert.equal(finalPoint.aggregate_display_cash, 0);
        assert.equal(finalPoint.aggregate_market_value, 0);
    });
});

test('missing or non-reported accrual evidence leaves existing equity untouched', () => {
    for (const brokerSnapshots of [
        undefined,
        {'ibkr:U00000001': {broker: 'ibkr', account: 'U00000001'}},
        ibkrAccrualSnapshots([[BOUNDARY_DATE, null, 'conflict'], [BOUNDARY_DATE, null, 'incomplete']]),
    ]) {
        withInvestmentData({broker_snapshots: brokerSnapshots}, () => {
            const row = makeRow({broker: 'ibkr', date: BOUNDARY_DATE, cash: CASH, marketValue: MARKET_VALUE});
            const before = {...row};
            assert.deepEqual(applyInvestmentInterestAccrualBoundaries([row]), []);
            assert.deepEqual(row, before);
            assert.equal(getInvestmentInterestAccrualOnDate(BOUNDARY_DATE), null);

            const [, point] = buildDailyEquityChartPoints(
                [makeChartSnapshot({date: BOUNDARY_DATE, cash: CASH, holdings: {SYNTH: 1}})],
                {SYNTH: {[BOUNDARY_DATE]: MARKET_VALUE}},
                new Set(),
            );
            // Unknown accrual is not presented as a known zero.
            assert.equal(point.aggregate_interest_accrual, null);
            assert.equal(point.aggregate_total_equity, CASH + MARKET_VALUE);
        });
    }
});

test('aggregate equity adds only the IBKR accrual, once, from its boundary row onward', () => {
    withInvestmentData({broker_snapshots: ibkrAccrualSnapshots([[BOUNDARY_DATE, ACCRUAL]])}, () => {
        const aggregateCashBefore = 500;
        const aggregateCashAfter = aggregateCashBefore + CASH;
        const earlierBankRow = makeRow({
            broker: 'hsbc', date: BOUNDARY_DATE, cash: 500, marketValue: 0,
            aggregateCash: aggregateCashBefore, aggregateMarketValue: MARKET_VALUE,
        });
        const ibkrRow = makeRow({
            broker: 'ibkr', date: BOUNDARY_DATE, cash: CASH, marketValue: MARKET_VALUE,
            aggregateCash: aggregateCashAfter, aggregateMarketValue: MARKET_VALUE,
        });
        const laterBankRow = makeRow({
            broker: 'hsbc', date: BOUNDARY_DATE, cash: 500, marketValue: 0,
            aggregateCash: aggregateCashAfter, aggregateMarketValue: MARKET_VALUE,
        });
        const nextDayBankRow = makeRow({
            broker: 'hsbc', date: '2026-06-29', cash: 500, marketValue: 0,
            aggregateCash: aggregateCashAfter, aggregateMarketValue: MARKET_VALUE,
        });
        applyInvestmentInterestAccrualBoundaries([earlierBankRow, ibkrRow, laterBankRow, nextDayBankRow]);

        assert.equal(earlierBankRow.broker_total_equity, 500);
        assert.equal(laterBankRow.broker_total_equity, 500);
        assert.equal(laterBankRow.broker_interest_accrual, undefined);
        assert.equal(ibkrRow.broker_total_equity, EXPECTED_EQUITY);
        assert.equal(earlierBankRow.aggregate_total_equity, aggregateCashBefore + MARKET_VALUE);
        assert.equal(ibkrRow.aggregate_total_equity, aggregateCashAfter + MARKET_VALUE + ACCRUAL);
        assert.equal(laterBankRow.aggregate_total_equity, aggregateCashAfter + MARKET_VALUE + ACCRUAL);
        assert.equal(nextDayBankRow.aggregate_total_equity, aggregateCashAfter + MARKET_VALUE);

        const mixedPoints = buildDailyEquityChartPoints(
            [
                makeChartSnapshot({broker: 'hsbc', date: BOUNDARY_DATE, cash: 500, holdings: {}}),
                makeChartSnapshot({broker: 'ibkr', date: BOUNDARY_DATE, cash: aggregateCashAfter, holdings: {SYNTH: 1}}),
            ],
            {SYNTH: {[BOUNDARY_DATE]: MARKET_VALUE}},
            new Set(),
        );
        assert.equal(
            mixedPoints.find((point) => point.date === BOUNDARY_DATE).aggregate_total_equity,
            aggregateCashAfter + MARKET_VALUE + ACCRUAL,
        );

        // A bank-only replay scope must not receive the IBKR accrual.
        const bankPoints = buildDailyEquityChartPoints(
            [makeChartSnapshot({broker: 'hsbc', date: BOUNDARY_DATE, cash: 500, holdings: {}})],
            {},
            new Set(),
        );
        const bankPoint = bankPoints.find((point) => point.date === BOUNDARY_DATE);
        assert.equal(bankPoint.aggregate_interest_accrual, null);
        assert.equal(bankPoint.aggregate_total_equity, 500);
        assert.equal(getInvestmentInterestAccrualOnDate(BOUNDARY_DATE, {brokerCodes: ['hsbc']}), null);
        assert.deepEqual(
            getInvestmentInterestAccrualOnDate(BOUNDARY_DATE, {brokerCodes: ['hsbc', 'ibkr']}),
            {amount: ACCRUAL, byBroker: {ibkr: ACCRUAL}},
        );
    });
});

test('a foreign-currency accrual without a dated FX rate fails closed instead of counting as zero', () => {
    const snapshots = {
        'ibkr:U00000002': {
            broker: 'ibkr',
            interest_accrual_snapshots: [{as_of: BOUNDARY_DATE, status: 'reported', currency: 'HKD', amount: '-78'}],
        },
    };
    withInvestmentData({broker_snapshots: snapshots}, () => {
        const withoutRate = makeRow({broker: 'ibkr', date: BOUNDARY_DATE, cash: 10, marketValue: 0});
        applyInvestmentInterestAccrualBoundaries([withoutRate], {fxTimeline: null});
        assert.equal(withoutRate.broker_total_equity, null);
        assert.equal(withoutRate.broker_display_cash, 10);

        const points = buildDailyEquityChartPoints(
            [makeChartSnapshot({date: BOUNDARY_DATE, cash: 10, holdings: {}})],
            {},
            new Set(),
        );
        const boundaryPoint = points.find((point) => point.date === BOUNDARY_DATE);
        assert.equal(boundaryPoint.aggregate_interest_accrual, null);
        assert.equal(boundaryPoint.aggregate_total_equity, null);
        assert.equal(boundaryPoint.valuation_complete, false);
        assert.equal(boundaryPoint.aggregate_display_cash, 10);
    });
});
