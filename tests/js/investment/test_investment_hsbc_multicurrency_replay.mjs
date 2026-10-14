/* HSBC multicurrency Cash and Equity replay regressions. Code version: v1.0.2 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildHsbcMulticurrencyPayload,
    buildHsbcPendingMulticurrencyPayload,
    inspectInvestmentReplay,
    usdSavingsCash,
    hsbcOrder,
    HSBC_TEST_ACCOUNT,
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

for (const side of ['buy', 'sell']) {
    for (const scenario of [
        {label: 'before the foreign anchor', pendingDate: '2026-03-02', anchorDate: '2026-03-03', foreignCash: 0},
        {label: 'on the foreign anchor', pendingDate: '2026-03-03', anchorDate: '2026-03-03', foreignCash: 360},
        {label: 'after the foreign anchor', pendingDate: '2026-03-04', anchorDate: '2026-03-03', foreignCash: 360},
        {label: 'before a future foreign anchor', pendingDate: '2026-03-04', anchorDate: '2026-03-05', foreignCash: 310},
    ]) {
        test(`pending HSBC ${side} uses a nonzero correction ${scenario.label}`, async () => {
            const payload = buildHsbcPendingMulticurrencyPayload({side, pendingDate: scenario.pendingDate});
            const summary = payload.broker_summaries.hsbc;
            summary.ending_cash_by_currency.HKD = '2340';
            summary.hsbc_ending_cash_components['HKD:SAVINGS'] = '2340';
            summary.hsbc_cash_component_post_dates['HKD:SAVINGS'] = scenario.anchorDate;
            const rawOrder = payload.transactions.find((txn) => txn.source?.cash_replay_pending_settlement);
            // Place the order after that day's direct cash rows. A same-day
            // anchor may calibrate the final row, never an earlier row.
            rawOrder.datetime = `${scenario.pendingDate} 23:00:00`;
            await inspectInvestmentReplay(payload, ({runtime, processed}) => {
                const order = processed.find((txn) => txn.source?.cash_replay_pending_settlement);
                const pendingCash = side === 'buy' ? -305.6 : 305.6;
                assertClose(
                    historyCash(order), USD_SAVINGS + scenario.foreignCash + pendingCash,
                    'row-specific foreign balance correction',
                );
                if (side === 'buy') {
                    assertClose(order.broker_running_cash, USD_SAVINGS, 'sequential USD cash remains authoritative');
                    assertClose(order.broker_pending_settlement_cash, pendingCash, 'sequential pending remains signed');
                    assert.equal(
                        Object.keys(order).includes('broker_dated_cash_balances'), false,
                        'dated display metadata is excluded from export',
                    );
                }
                // The later direct HKD receipt retires the older HKD anchor,
                // so the current cash still uses HKD 2,804.88 and CNH zero.
                assertClose(
                    runtime.resolveInvestmentMetricsCurrentCash(
                        runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc',
                    ).cash,
                    USD_SAVINGS + (2_804.88 / 7.8) + pendingCash,
                    'current Holdings cash preserves the later native balance',
                );
            });
        });
    }

    for (const pendingDate of ['2026-03-05', '2026-03-06']) {
        test(`pending HSBC ${side} retains dated foreign cash on ${pendingDate}`, async () => {
            await inspectInvestmentReplay(
                buildHsbcPendingMulticurrencyPayload({side, pendingDate}),
                ({runtime, processed, chartPoints}) => {
                    const rows = hsbcRows(runtime, processed);
                    const order = findRow(rows, pendingDate, 'USD', side);
                    const pendingCash = side === 'buy' ? -305.6 : 305.6;
                    // The early 5 Mar order precedes both foreign credits that
                    // day; 6 Mar precedes the CNH withdrawal and HKD receipt.
                    const foreignCash = pendingDate === '2026-03-05'
                        ? (1_950 / 7.8) + (420 / 7)
                        : (2_262 / 7.8) + (490 / 7);
                    const expectedCash = USD_SAVINGS + foreignCash + pendingCash;
                    assert.notEqual(order, rows.at(-1), 'the current endpoint must not mask the history row');
                    assertClose(historyCash(order), expectedCash, 'pending order Cash');
                    assertClose(Number(order.broker_pending_settlement_cash), pendingCash, 'signed pending once');
                    assertClose(
                        historyEquity(order), expectedCash + Number(order.broker_market_value),
                        'pending order Equity',
                    );
                    // The settled BRAV buy is already in USD_SAVINGS. Its USD
                    // 290 correction must not be deducted from this boundary again.
                    const currentCash = runtime.resolveInvestmentMetricsCurrentCash(
                        runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc',
                    );
                    const expectedCurrentCash = USD_SAVINGS + (2_804.88 / 7.8) + pendingCash;
                    assertClose(currentCash.cash, expectedCurrentCash, 'authoritative Holdings Cash');
                    assertClose(historyCash(rows.at(-1)), expectedCurrentCash, 'latest history Cash');
                    assertClose(
                        chartPoints.at(-1).aggregate_display_cash, expectedCurrentCash,
                        'final Overview Cash',
                    );
                },
            );
        });
    }

    test(`pending HSBC ${side} preserves USD-only cash without adding pending twice`, async () => {
        await inspectInvestmentReplay(
            buildHsbcPendingMulticurrencyPayload({side, includeForeignCash: false}),
            ({processed}) => {
                const order = findRow(processed, '2026-03-05', 'USD', side);
                assertClose(
                    historyCash(order), USD_SAVINGS + (side === 'buy' ? -305.6 : 305.6),
                    'USD-only pending Cash',
                );
            },
        );
    });

    test(`settling an HSBC ${side} transfers pending to native cash exactly once`, async () => {
        await inspectInvestmentReplay(
            buildHsbcPendingMulticurrencyPayload({side, settled: true}),
            ({runtime, processed, chartPoints}) => {
                const rows = hsbcRows(runtime, processed);
                const signedAmount = side === 'buy' ? -305.6 : 305.6;
                const expectedCurrentCash = USD_SAVINGS + signedAmount + (2_804.88 / 7.8);
                const last = rows.at(-1);
                const beforeSettlement = chartPoints.find((point) => point.date === '2026-03-05');
                assert.ok(beforeSettlement, 'the trade-day Overview point exists');
                assertClose(
                    beforeSettlement.aggregate_display_cash,
                    USD_SAVINGS + signedAmount + (2_262 / 7.8) + (490 / 7),
                    'trade-day cash includes the signed receivable or payable once',
                );
                assertClose(last.broker_pending_settlement_cash, 0, 'settled pending cleared');
                assertClose(historyCash(last), expectedCurrentCash, 'settled native Cash');
                assertClose(
                    runtime.resolveInvestmentMetricsCurrentCash(
                        runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc',
                    ).cash,
                    expectedCurrentCash, 'settled Holdings Cash',
                );
                assertClose(
                    chartPoints.at(-1).aggregate_display_cash, expectedCurrentCash,
                    'settled final Overview Cash',
                );
            },
        );
    });
}

const AUDIT_SHA = 'a'.repeat(64);
const AUDIT_OTHER_SHA = 'b'.repeat(64);
const auditCash = (date, amount, balance, row, sha = AUDIT_SHA) => usdSavingsCash(date, 'deposit', String(amount), String(balance), row, sha);
function auditSettlement(orderId, date, amount, balance, row) {
    return {cash_settlement_date: date, cash_settlement_amount_raw: String(amount), cash_settlement_postings: [{
        date, currency: 'USD', amount_raw: String(amount), balance_after_raw: String(balance),
        row_number: row, ledger_sequence: row, source_file_kind: 'hsbc_usd_account_text', source_sequence_sha256: AUDIT_SHA,
        account_number: HSBC_TEST_ACCOUNT, account_type: 'USD Savings', reference: `REF ${orderId.replace('-', '')}001 SEC`, role: 'principal',
    }]};
}
function cashAuditPayload(transactions, endingCash, endingDate, extraSummary = {}) {
    const payload = buildHsbcMulticurrencyPayload();
    payload.transactions = transactions;
    payload.broker_summaries = {hsbc: {broker: 'hsbc', account: HSBC_TEST_ACCOUNT, cash_snapshot_authoritative: true,
        ending_cash: String(endingCash), ending_cash_base_currency: String(endingCash), ending_cash_base_currency_as_of: endingDate,
        ending_cash_by_currency: {USD: String(endingCash)}, cash_snapshot_as_of: endingDate,
        hsbc_ending_cash_components: {'USD:SAVINGS': String(endingCash)}, hsbc_cash_component_post_dates: {'USD:SAVINGS': endingDate}, ...extraSummary}};
    payload.summary = {authoritative_current_cash_brokers: ['hsbc'], position_snapshot_authoritative: false};
    payload.price_history_by_ticker = Object.fromEntries([['ALFA', 100], ['BETA', 50]].map(([ticker, close]) => [ticker,
        ['02', '03', '04', '05', '06', '09'].map((day) => ({date: `2026-03-${day}`, close}))]));
    return payload;
}
const auditOpeningShares = (ticker, quantity) => hsbcOrder('2026-03-02', 'transfer_in', ticker, quantity, 0, `X-${ticker}`);
function auditCurrentCash() {
    const txn = auditCash('2026-03-02', 500, 500, 1, AUDIT_OTHER_SHA);
    txn.account_type = 'USD Current';
    Object.assign(txn.source, {account_type: 'USD Current', file_kind: 'hsbc_multi_currency_cash_account_text', cash_balance_authoritative: false});
    return txn;
}

test('overlapping settlement history does not count intervening cash twice', async () => {
    const transactions = [auditOpeningShares('ALFA', 15), auditCash('2026-03-02', 10000, 10000, 1),
        hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-04', 1000, 11000, 2)),
        hsbcOrder('2026-03-04', 'sell', 'ALFA', 5, 100, 'S-1000002', auditSettlement('S-1000002', '2026-03-05', 500, 11700, 4)),
        {...auditCash('2026-03-04', 200, 11200, 3), type: 'dividend'}, auditCash('2026-03-06', 100, 11800, 5)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 11800, '2026-03-06'), ({processed, chartPoints}) => {
        const dividend = processed.find((txn) => txn.type === 'dividend');
        assertClose(historyCash(processed.find((txn) => txn.type === 'sell' && txn.date === '2026-03-04')), 11500, 'second trade excludes the later dividend');
        assertClose(historyCash(dividend), 11700, 'settled savings plus the second pending sale');
        assertClose(chartPoints.find((point) => point.date === '2026-03-04').aggregate_display_cash, 11700, 'Overview same balance');
    });
});

test('incomparable settlement evidence retains execution-day trade accrual until direct cash', async () => {
    const transactions = [auditOpeningShares('ALFA', 10), auditCash('2026-03-02', 10000, 10000, 1),
        hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', 1000, 11000, 2)),
        auditCash('2026-03-05', 200, 11200, 1, AUDIT_OTHER_SHA)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 11200, '2026-03-05'), ({chartPoints}) => {
        for (const date of ['2026-03-03', '2026-03-04']) {
            assertClose(chartPoints.find((point) => point.date === date).aggregate_display_cash, 11000, `${date} accrual`);
        }
        assertClose(chartPoints.find((point) => point.date === '2026-03-05').aggregate_display_cash, 11200, 'direct cash retires accrual');
    });
});

test('an unresolved settlement retires its pending amount when later cash proves settlement', async () => {
    const transactions = [auditOpeningShares('ALFA', 10), auditOpeningShares('BETA', 5), auditCash('2026-03-02', 10000, 10000, 1), auditCurrentCash(),
        hsbcOrder('2026-03-03', 'buy', 'BETA', 1, 50, 'P-1000009'),
        hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', 1000, 11000, 2)),
        auditCash('2026-03-06', 100, 11050, 3), auditCash('2026-03-09', 100, 11150, 4)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 11650, '2026-03-09', {
        hsbc_ending_cash_components: {'USD:SAVINGS': '11150', 'USD:CURRENT': '500'}, hsbc_cash_component_post_dates: {'USD:SAVINGS': '2026-03-09', 'USD:CURRENT': '2026-03-02'},
    }), ({chartPoints}) => {
        assertClose(chartPoints.find((point) => point.date === '2026-03-06').aggregate_display_cash, 11550, 'settled cash only once');
        assertClose(chartPoints.find((point) => point.date === '2026-03-06').aggregate_total_equity, 11850, 'cash plus BETA holding');
    }, {today: '2026-03-09'});
});

test('same-day Savings settlement preserves the separate Current account balance', async () => {
    const transactions = [auditOpeningShares('ALFA', 10), auditCash('2026-03-02', 10000, 10000, 1), auditCurrentCash(),
        hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-03', 1000, 11000, 2)),
        auditCash('2026-03-05', 100, 11100, 3), auditCash('2026-03-09', 100, 11200, 4)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 11700, '2026-03-09', {
        hsbc_ending_cash_components: {'USD:SAVINGS': '11200', 'USD:CURRENT': '500'}, hsbc_cash_component_post_dates: {'USD:SAVINGS': '2026-03-09', 'USD:CURRENT': '2026-03-02'},
    }), ({processed, chartPoints}) => {
        assertClose(historyCash(processed.find((txn) => txn.type === 'sell')), 11500, 'history keeps both accounts');
        assertClose(chartPoints.find((point) => point.date === '2026-03-03').aggregate_display_cash, 11500, 'Overview keeps both accounts');
        assertClose(chartPoints.find((point) => point.date === '2026-03-05').aggregate_display_cash, 11600, 'next cash remains continuous');
    }, {today: '2026-03-09'});
});

for (const side of ['buy', 'sell']) {
    test(`latest pending ${side} metrics include foreign cash once`, async () => {
        const payload = buildHsbcPendingMulticurrencyPayload({side, pendingDate: '2026-03-07'});
        for (const [ticker, close] of [['ALFA', 101], ['BRAV', 150], ['CHRL', 152.8]]) {
            payload.price_history_by_ticker[ticker] ||= [];
            payload.price_history_by_ticker[ticker].push({date: '2026-03-07', close});
        }
        await inspectInvestmentReplay(payload, ({runtime, processed}) => {
            const row = processed.at(-1);
            const cash = runtime.resolveInvestmentMetricsCurrentCash(runtime.getInvestmentBrokerSummaryTransactions('hsbc'), 'hsbc').cash;
            assertClose(runtime.getInvestmentBrokerSummaryTotalEquity('hsbc'), cash + row.broker_market_value, 'metrics equity equals current cash plus positions');
        }, {today: '2026-03-07'});
    });
}

for (const side of ['buy', 'sell']) {
    test(`a later deposit is excluded from a prior ${side} row and retained once before settlement`, async () => {
        const signedAmount = side === 'buy' ? -1000 : 1000;
        const finalCash = 10600 + signedAmount;
        const transactions = [
            ...(side === 'sell' ? [auditOpeningShares('ALFA', 10)] : []),
            auditCash('2026-03-02', 10000, 10000, 1),
            hsbcOrder('2026-03-03', side, 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', signedAmount, 10500 + signedAmount, 3)),
            auditCash('2026-03-04', 500, 10500, 2), auditCash('2026-03-06', 100, finalCash, 4),
        ];
        await inspectInvestmentReplay(cashAuditPayload(transactions, finalCash, '2026-03-06'), ({processed}) => {
            assertClose(historyCash(processed.find((txn) => txn.type === side)), 10000 + signedAmount, 'trade date excludes the future deposit');
            assertClose(historyCash(processed.find((txn) => txn.date === '2026-03-04')), 10500 + signedAmount, 'deposit plus only pending trade');
        });
    });
}

for (const [firstSide, secondSide] of [['sell', 'sell'], ['buy', 'buy'], ['buy', 'sell'], ['sell', 'buy']]) {
    test(`history follows execution order when ${firstSide}/${secondSide} bank postings are reversed`, async () => {
        const firstAmount = firstSide === 'buy' ? -1000 : 1000;
        const secondAmount = secondSide === 'buy' ? -500 : 500;
        const settledCash = 10000 + firstAmount + secondAmount;
        const first = hsbcOrder('2026-03-03', firstSide, 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', firstAmount, settledCash, 3));
        const second = hsbcOrder('2026-03-03', secondSide, 'ALFA', 5, 100, 'S-1000002', auditSettlement('S-1000002', '2026-03-05', secondAmount, 10000 + secondAmount, 2));
        first.datetime = '2026-03-03 19:00:00';
        second.datetime = '2026-03-03 20:00:00';
        const transactions = [auditOpeningShares('ALFA', 15), auditCash('2026-03-02', 10000, 10000, 1), first, second,
            auditCash('2026-03-06', 100, settledCash + 100, 4)];
        const originalPostings = JSON.stringify([first.source.cash_settlement_postings, second.source.cash_settlement_postings]);
        await inspectInvestmentReplay(cashAuditPayload(transactions, settledCash + 100, '2026-03-06'), ({processed, chartPoints}) => {
            const trades = processed.filter((txn) => ['buy', 'sell'].includes(txn.type));
            assertClose(historyCash(trades[0]), 10000 + firstAmount, 'first execution includes only its own trade');
            assertClose(historyCash(trades[1]), settledCash, 'second execution includes both trades once');
            assertClose(historyEquity(trades[0]), 11500, 'first execution preserves total equity');
            assertClose(historyEquity(trades[1]), 11500, 'second execution preserves total equity');
            for (const date of ['2026-03-03', '2026-03-04', '2026-03-05']) {
                assertClose(chartPoints.find((point) => point.date === date).aggregate_display_cash, settledCash, `${date} Overview cash`);
            }
        });
        assert.equal(JSON.stringify([first.source.cash_settlement_postings, second.source.cash_settlement_postings]), originalPostings);
    });
}

test('execution-order history counts interleaved settlement principals and fees once', async () => {
    const first = hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', 1000, 11000, 2));
    const second = hsbcOrder('2026-03-03', 'sell', 'ALFA', 5, 100, 'S-1000002', auditSettlement('S-1000002', '2026-03-05', 500, 11500, 3));
    for (const [txn, fee, sequence, balance] of [[first, -3, 5, 11495], [second, -2, 4, 11498]]) {
        txn.commission_raw = String(fee);
        txn.normalized.commission = String(fee);
        txn.source.cash_settlement_postings.push({
            ...txn.source.cash_settlement_postings[0], role: 'fee', amount_raw: String(fee),
            row_number: sequence, ledger_sequence: sequence, balance_after_raw: String(balance),
        });
    }
    first.datetime = '2026-03-03 19:00:00';
    second.datetime = '2026-03-03 20:00:00';
    const transactions = [auditOpeningShares('ALFA', 15), auditCash('2026-03-02', 10000, 10000, 1), first, second,
        auditCash('2026-03-06', 100, 11595, 6)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 11595, '2026-03-06'), ({processed, chartPoints}) => {
        const trades = processed.filter((txn) => txn.type === 'sell');
        assertClose(historyCash(trades[0]), 10997, 'first trade includes its fee without the second trade');
        assertClose(historyCash(trades[1]), 11495, 'both trades include both fees once');
        assertClose(historyEquity(trades[0]), 11497, 'first fee reduces equity by three');
        assertClose(historyEquity(trades[1]), 11495, 'both fees reduce equity by five');
        for (const date of ['2026-03-03', '2026-03-04', '2026-03-05']) {
            assertClose(chartPoints.find((point) => point.date === date).aggregate_display_cash, 11495, `${date} Overview fees`);
        }
    });
});

test('reversed settlement history excludes a later deposit while an earlier sale is still pending', async () => {
    const first = hsbcOrder('2026-03-03', 'sell', 'ALFA', 10, 100, 'S-1000001', auditSettlement('S-1000001', '2026-03-05', 1000, 12000, 4));
    const second = hsbcOrder('2026-03-04', 'sell', 'ALFA', 5, 100, 'S-1000002', auditSettlement('S-1000002', '2026-03-05', 500, 11000, 3));
    second.datetime = '2026-03-04 19:00:00';
    const transactions = [auditOpeningShares('ALFA', 15), auditCash('2026-03-02', 10000, 10000, 1), first, second,
        auditCash('2026-03-04', 500, 10500, 2), auditCash('2026-03-06', 100, 12100, 5)];
    await inspectInvestmentReplay(cashAuditPayload(transactions, 12100, '2026-03-06'), ({processed}) => {
        const trades = processed.filter((txn) => txn.type === 'sell');
        assertClose(historyCash(trades[0]), 11000, 'first sale excludes the future sale and deposit');
        assertClose(historyCash(trades[1]), 11500, 'second sale excludes only the later deposit');
        assertClose(historyCash(processed.find((txn) => txn.date === '2026-03-04' && txn.type === 'deposit')), 12000, 'deposit adds once alongside both pending sales');
    });
});
