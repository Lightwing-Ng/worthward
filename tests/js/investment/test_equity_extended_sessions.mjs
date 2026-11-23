/* Tests for high-precision equity endpoints. Code version: v1.0.0 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {createInvestmentRangeTransferRuntime} from '../../../app/web/static/assets/js/investment/runtime/range-transfer.js';
import {createInvestmentRealtimeChartRuntime} from '../../../app/web/static/assets/js/investment/runtime/realtime-chart.js';

function makeRuntime(sessionState) {
    const runtime = {
        state: {},
        investmentOverviewRealtimeLinePointsByMinute: new Map(),
        isInvestmentOverviewIntradayEquityRange: () => true,
        getOptionalInvestmentNumber: (value) => value ?? null,
        getSafeInvestmentMarketSessionState: () => sessionState,
        normalizeLedgerDate: (value) => String(value || '').slice(0, 10),
        roundInvestmentChartCurrencyValue: (value) => value,
    };
    const realtime = createInvestmentRealtimeChartRuntime(runtime);
    runtime.getInvestmentNewYorkClockParts = realtime.getInvestmentNewYorkClockParts;
    runtime.shouldShowInvestmentRealtimePulse = realtime.shouldShowInvestmentRealtimePulse;
    return Object.assign(runtime, createInvestmentRangeTransferRuntime(runtime));
}

test('evening overnight and pre-market connect one current valuation across calendar days', () => {
    const session = {
        session: 'overnight',
        session_date: '2026-07-14',
        as_of: '2026-07-13T23:55:00-04:00',
        is_realtime_allowed: true,
    };
    const runtime = makeRuntime(session);
    const regularPoints = [
        {date: '2026-07-10 15:58', equity: 70},
        {date: '2026-07-13 09:30', equity: 73},
        {date: '2026-07-13 15:58', equity: 85},
        {date: '2026-07-13 15:59', equity: null},
        {date: '2026-07-14 09:30', equity: 100},
    ];

    assert.equal(runtime.rememberInvestmentOverviewRealtimeLinePoint({is_realtime: true, total_equity: 89}), true);
    const overnight = runtime.mergeInvestmentOverviewRealtimeLinePoints(regularPoints);
    assert.deepEqual(overnight.map(({date, equity}) => [date, equity]), [
        ['2026-07-10 15:58', 70], ['2026-07-13 09:30', 73], ['2026-07-13 15:58', 85], ['2026-07-13 23:55', 89],
    ]);

    session.session = 'pre';
    session.as_of = '2026-07-14T07:00:00-04:00';
    assert.equal(runtime.rememberInvestmentOverviewRealtimeLinePoint({is_realtime: true, total_equity: 94}), true);
    const premarket = runtime.mergeInvestmentOverviewRealtimeLinePoints(regularPoints);
    assert.deepEqual(premarket.map(({date, equity}) => [date, equity]), [
        ['2026-07-10 15:58', 70], ['2026-07-13 09:30', 73], ['2026-07-13 15:58', 85], ['2026-07-14 07:00', 94],
    ]);
    assert.equal(runtime.investmentOverviewRealtimeLinePointsByMinute.size, 1);
    runtime.state.investmentEquityChartRuntimeState = {
        overviewIntradayLinePoints: premarket,
        visibleChartPoints: premarket.map(({point}) => point),
    };
    const chart = {data: {rawLabels: premarket.map(({date}) => date)}};
    assert.equal(runtime.getInvestmentEquitySegmentBorderColor({chart, p0DataIndex: 0, p1DataIndex: 1}), 'rgba(0, 85, 204, 0)');
    assert.equal(runtime.getInvestmentEquitySegmentBorderColor({chart, p0DataIndex: 2, p1DataIndex: 3}, '#123456'), '#123456');
});

test('post-market keeps observed regular values and appends no more than one live endpoint', () => {
    const session = {
        session: 'intraday',
        session_date: '2026-07-13',
        as_of: '2026-07-13T15:59:00-04:00',
        is_realtime_allowed: true,
    };
    const runtime = makeRuntime(session);
    const regularPoints = [
        {date: '2026-07-13 15:58', equity: 103},
        {date: '2026-07-13 15:59', equity: null},
        {date: '2026-07-13 16:00', equity: 105},
    ];
    runtime.rememberInvestmentOverviewRealtimeLinePoint({is_realtime: true, total_equity: 104});
    session.session = 'post';
    session.as_of = '2026-07-13T17:00:00-04:00';
    runtime.rememberInvestmentOverviewRealtimeLinePoint({is_realtime: true, total_equity: 106});
    session.as_of = '2026-07-13T17:01:00-04:00';
    runtime.rememberInvestmentOverviewRealtimeLinePoint({is_realtime: true, total_equity: 108});

    const postmarket = runtime.mergeInvestmentOverviewRealtimeLinePoints(regularPoints);
    assert.deepEqual(postmarket.map(({date, equity}) => [date, equity]), [
        ['2026-07-13 15:58', 103], ['2026-07-13 15:59', 104], ['2026-07-13 17:01', 108],
    ]);
    assert.equal(postmarket[1].point.is_realtime, false);
    assert.equal(postmarket[2].point.is_realtime, true);
});

test('historical half days reserve just the actual regular minutes', () => {
    const runtime = makeRuntime({
        session: 'off',
        session_date: '2025-11-30',
        early_close_trading_days: ['2025-11-28'],
    });
    const regularDay = runtime.buildInvestmentOverviewRegularSessionMinuteKeys('2025-11-26');
    const halfDay = runtime.buildInvestmentOverviewRegularSessionMinuteKeys('2025-11-28');
    assert.equal(regularDay.length, 390);
    assert.equal(regularDay.at(-1), '2025-11-26 15:59');
    assert.equal(halfDay.length, 210);
    assert.equal(halfDay.at(-1), '2025-11-28 12:59');
});
