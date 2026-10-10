/* HSBC multicurrency Cash and Equity replay regressions. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildHsbcMulticurrencyPayload,
    inspectInvestmentReplay,
} from './hsbc_multicurrency_replay_support.mjs';

const PENDING_SETTLEMENT = 305.6;
const MARKET_VALUE = 10_400;
const SECOND_BROKER_CASH = 500;
const SECOND_BROKER_MARKET_VALUE = 505;
const USD_SAVINGS = 21_210;
// Fixture FX: 7.8 HKD and 7 CNH per USD, carried forward from the first quote.
const EXPECTED_HSBC_CASH = {
    usdBoundary: USD_SAVINGS + (2_262 / 7.8) + (490 / 7) + PENDING_SETTLEMENT,
    cnhWithdrawal: USD_SAVINGS + (2_262 / 7.8) + PENDING_SETTLEMENT,
    hkdReceipt: USD_SAVINGS + (2_804.88 / 7.8) + PENDING_SETTLEMENT,
};

function assertClose(actual, expected, label) {
    assert.ok(
        Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6,
        `${label}: expected ${expected}, received ${actual}`,
    );
}

function historyCash(txn) {
    return Number.isFinite(Number(txn?.history_broker_cash))
        ? Number(txn.history_broker_cash)
        : Number(txn?.broker_display_cash);
}

function historyEquity(txn) {
    return Number.isFinite(Number(txn?.history_broker_equity))
        ? Number(txn.history_broker_equity)
        : Number(txn?.broker_total_equity);
}

function hsbcRows(runtime, processed) {
    return processed.filter((txn) => (
        runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === 'hsbc'
    ));
}

function findRow(rows, date, currency, type) {
    const row = rows.find((txn) => (
        txn.date === date && txn.currency === currency && txn.type === type
    ));
    assert.ok(row, `${date} ${currency} ${type} row`);
    return row;
}

for (const withSecondBroker of [false, true]) {
    const label = withSecondBroker ? 'beside another broker' : 'as the only broker';

    test(`HSBC history keeps every native cash balance once ${label}`, async () => {
        await inspectInvestmentReplay(
            buildHsbcMulticurrencyPayload({withSecondBroker}),
            ({runtime, processed}) => {
                const rows = hsbcRows(runtime, processed);
                const usdBoundary = findRow(rows, '2026-03-05', 'HKD', 'deposit');
                const cnhWithdrawal = findRow(rows, '2026-03-06', 'CNH', 'withdrawal');
                const hkdReceipt = findRow(rows, '2026-03-06', 'HKD', 'deposit');
                const earlierSameDay = findRow(rows, '2026-03-05', 'CNH', 'deposit');

                assertClose(historyCash(usdBoundary), EXPECTED_HSBC_CASH.usdBoundary, 'USD boundary Cash');
                assertClose(historyCash(cnhWithdrawal), EXPECTED_HSBC_CASH.cnhWithdrawal, 'CNH withdrawal Cash');
                assertClose(historyCash(hkdReceipt), EXPECTED_HSBC_CASH.hkdReceipt, 'HKD receipt Cash');
                // Before the end-of-day USD boundary, the settlement posting owns USD.
                assertClose(
                    historyCash(earlierSameDay),
                    USD_SAVINGS + (1_950 / 7.8) + (490 / 7) + PENDING_SETTLEMENT,
                    'earlier same-day Cash',
                );
                [usdBoundary, cnhWithdrawal, hkdReceipt].forEach((txn) => {
                    assertClose(Number(txn.broker_market_value), MARKET_VALUE, `${txn.date} market value`);
                    assertClose(historyEquity(txn), historyCash(txn) + MARKET_VALUE, `${txn.date} Equity`);
                });
                // The exchange moves cash between currencies without touching holdings.
                assert.deepEqual(cnhWithdrawal.broker_holdings, usdBoundary.broker_holdings);
                assert.deepEqual(hkdReceipt.broker_holdings, {ALFA: 100, BRAV: 2});
                assertClose(
                    historyCash(hkdReceipt) - historyCash(usdBoundary),
                    (542.88 / 7.8) - (490 / 7),
                    'exchange cash effect',
                );
            },
        );
    });

    test(`HSBC Holdings Cash and the final Overview point stay continuous ${label}`, async () => {
        await inspectInvestmentReplay(
            buildHsbcMulticurrencyPayload({withSecondBroker}),
            ({runtime, processed, chartPoints}) => {
                const rows = hsbcRows(runtime, processed);
                const hkdReceipt = rows.at(-1);
                const currentCash = runtime.resolveInvestmentMetricsCurrentCash(
                    runtime.getInvestmentBrokerSummaryTransactions('hsbc'),
                    'hsbc',
                );
                assertClose(currentCash.cash, EXPECTED_HSBC_CASH.hkdReceipt, 'Holdings Cash');
                assertClose(historyCash(hkdReceipt), currentCash.cash, 'latest history Cash');

                const otherCash = withSecondBroker ? SECOND_BROKER_CASH : 0;
                const otherMarketValue = withSecondBroker ? SECOND_BROKER_MARKET_VALUE : 0;
                const point = (date) => {
                    const match = chartPoints.find((candidate) => candidate.date === date);
                    assert.ok(match, `${date} Overview point`);
                    return match;
                };
                assertClose(
                    Number(point('2026-03-05').aggregate_display_cash),
                    EXPECTED_HSBC_CASH.usdBoundary + otherCash,
                    'Overview Cash on the USD boundary',
                );
                assertClose(
                    Number(point('2026-03-05').aggregate_total_equity),
                    EXPECTED_HSBC_CASH.usdBoundary + otherCash + MARKET_VALUE + otherMarketValue,
                    'Overview Equity on the USD boundary',
                );
                assertClose(
                    Number(point('2026-03-06').aggregate_display_cash),
                    EXPECTED_HSBC_CASH.hkdReceipt + otherCash,
                    'final Overview Cash',
                );
                assertClose(
                    Number(point('2026-03-06').aggregate_total_equity),
                    EXPECTED_HSBC_CASH.hkdReceipt + otherCash + MARKET_VALUE + otherMarketValue,
                    'final Overview Equity',
                );
            },
        );
    });
}

test('a pasted USD Savings row with a legacy order marker anchors the replay balance', async () => {
    await inspectInvestmentReplay(buildHsbcMulticurrencyPayload(), ({runtime, processed}) => {
        const rows = hsbcRows(runtime, processed);
        const legacyMarkerRow = findRow(rows, '2026-03-02', 'USD', 'deposit');

        assertClose(historyCash(legacyMarkerRow), 21_500 + PENDING_SETTLEMENT, 'legacy marker Cash');
        assert.doesNotMatch(
            legacyMarkerRow.history_balance_provisional_reason,
            /incomplete or inconsistent/,
        );
        // The later settlement still accrues the buy on its trade date.
        assertClose(
            historyCash(findRow(rows, '2026-03-04', 'USD', 'buy')),
            USD_SAVINGS + (1_950 / 7.8) + (420 / 7) + PENDING_SETTLEMENT,
            'settlement owner Cash',
        );
    });
});
