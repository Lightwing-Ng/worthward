/* Code version: v1.44.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    classifyInvestmentUsRealtimeSession,
    createInvestmentDataUtils,
    filterAggregateOnlyOverlayTransactions,
    isCompleteHsbcStatementPdfBundle,
    isRealtimeQuotePulseProviderEligible,
    resolveRealtimeQuoteSource,
} from '../app/web/static/assets/js/investment/data-utils.js';

test('stale backend payloads do not receive browser-synthesized attestations', () => {
    const payload = {
        broker_summaries: {
            hsbc: {
                account: '000-999999-999',
                tax_lot_history_verifications: {
                    GOOGL: {verified_through: '2026-07-31'},
                },
            },
        },
    };

    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(payload), []);
    const verifications = payload.broker_summaries.hsbc.tax_lot_history_verifications;
    assert.equal(verifications.GOOGL.verified_through, '2026-07-31');
    assert.equal(verifications.DRAM, undefined);
    assert.equal(verifications.EUV, undefined);
    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(payload), []);

    const unrelatedPayload = {
        broker_summaries: {hsbc: {account: 'different-account'}},
    };
    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(unrelatedPayload), []);
    assert.equal(
        unrelatedPayload.broker_summaries.hsbc.tax_lot_history_verifications,
        undefined,
    );
});

test('aggregate-only transfer filtering excludes only confirmed receipt keys without mutating evidence', () => {
    const transactions = [
        {manual_internal_transfer_key: 'source', type: 'buy'},
        {manual_internal_transfer_key: 'receipt', type: 'transfer_in'},
    ];
    const original = structuredClone(transactions);
    const filtered = filterAggregateOnlyOverlayTransactions(transactions, new Set(['receipt']));

    assert.deepEqual(filtered, [transactions[0]]);
    assert.deepEqual(transactions, original);
    assert.notEqual(filtered, transactions);
});

const SPLIT_FACTORS = [1, 1.5, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256];

test('HSBC smart statement selector accepts full monthly PDFs and compatible pairs', () => {
    const composite = {name: 'composite.pdf', type: 'application/pdf'};
    const investment = {name: 'investment.pdf', type: 'application/pdf'};
    assert.equal(isCompleteHsbcStatementPdfBundle([composite]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, investment]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, investment, composite]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([]), false);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, {name: 'notes.txt', type: 'text/plain'}]), false);
});

test('realtime quote source preserves one provider and reports mixed provenance', () => {
    assert.equal(resolveRealtimeQuoteSource([{source: 'longbridge'}]), 'longbridge');
    assert.equal(resolveRealtimeQuoteSource([{source: 'Longbridge'}, {source: 'longbridge'}]), 'longbridge');
    assert.equal(resolveRealtimeQuoteSource([{source: 'longbridge'}, {source: 'yfinance'}]), 'mixed');
    assert.equal(resolveRealtimeQuoteSource([{}, null]), 'realtime');
});

test('extended-hours Investment pulses require Longbridge while regular-session fallback remains eligible', () => {
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'overnight', source: 'longbridge',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'overnight', source: 'yfinance',
    }), false);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'post', source: 'longbridge',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'pre', source: 'yfinance',
    }), false);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'intraday', source: 'yfinance',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'HK', session: 'intraday', source: 'yfinance',
    }), true);
});

test('Investment realtime clock recognizes valid US overnight windows', () => {
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Mon', hour: 23, minute: 19,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Tue', hour: 3, minute: 59,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Sun', hour: 20, minute: 0,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Fri', hour: 20, minute: 0,
    }), 'off');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Sat', hour: 2, minute: 0,
    }), 'off');
});

function createUtils() {
    return createInvestmentDataUtils({
        noCommissionTransactionTypes: new Set(),
        investmentCommonSplitFactors: SPLIT_FACTORS,
        parseInvestmentDateParts: (value) => value,
        formatInvestmentShortDateParts: (value) => value,
        normalizeInvestmentTicker: (value) => String(value || '').trim().toUpperCase(),
        normalizeInvestmentStockDetailsRange: (value) => value || 'max',
        normalizeInvestmentEquityRange: (value) => value || 'max',
    });
}

const {
    buildDailyEquityChartPoints,
    buildDatedCashSnapshotProjection,
    buildTickerPriceIndex,
    buildInvestmentFxRateTimeline,
    computeInvestmentLiveHoldingsTotalEquity,
    buildHsbcCashSettlementBoundaryPlan,
    aggregateInvestmentScopedPositionStates,
    calculateSnapshotMarketValue,
    convertAmountToBaseCurrency,
    formatHoldingsMoney,
    formatTransactionDescription,
    formatTransactionCurrency,
    buildRenderedSplitFactorHints,
    buildTickerSummaries,
    compareInvestmentTaxLotTransactions,
    compareInvestmentTransactions,
    compareInvestmentTransactionsForReplay,
    buildValuationStatus,
    normalizePriceHistoryPayload,
    sumKolRewardRealizedIncomeInBaseCurrency,
    isKolRewardTransaction,
    addInvestmentCashScopeDelta,
    createCashLedgerFromBalances,
    createInvestmentCashScopeLedger,
    getInvestmentCashBalanceBoundary,
    getInvestmentCashBalanceScope,
    getInvestmentCashScopeBalances,
    getInvestmentBaseCurrency,
    getInvestmentCostBasisMethod,
    getInvestmentBrokerStartingCashBalances,
    getInvestmentBrokerEndingCashBalances,
    getInvestmentBrokerEndingCashInBaseCurrency,
    getInvestmentBrokerCurrentPendingSettlementCash,
    getInvestmentBrokerCurrentDisplayCash,
    getInvestmentBrokerCurrentCashSnapshot,
    getInvestmentBrokerEndingCashAsOf,
    getInvestmentBrokerEndingCashAsOfDateTime,
    getInvestmentBrokerPositionSnapshotAsOf,
    getInvestmentEndingCashBalances,
    getInvestmentEndingCashInBaseCurrency,
    getInvestmentStartingCashBalances,
    getAuthoritativePositionSnapshot,
    getAuthoritativePositionSnapshotForTransactions,
    projectAuthoritativePositionSnapshot,
    createPositionState,
    getTransactionAmount,
    getInvestmentInternalTransferAggregateBridgeAmount,
    getInvestmentInternalTransferAggregateBridgeDelta,
    getTransactionEconomicAmount,
    getTransactionRenderedSplitFactor,
    getTransactionValuationQuantity,
    getLongbridgeHkCashEquivalentSyntheticTicker,
    getCashEquivalentTickerSet,
    getMoneyMarketTickerSet,
    isLongbridgeHkCashEquivalentTransfer,
    isUsmartHkFractionalSharesTransaction,
    USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
    setInvestmentCashScopeBoundary,
} = createUtils();

test('current Holdings equity uses one cash snapshot plus open market values', () => {
    const totalEquity = computeInvestmentLiveHoldingsTotalEquity([
        {ticker: 'DRAM', hasOpenPosition: true, marketValue: 25793.9998626709},
        {ticker: 'QQQI', hasOpenPosition: true, marketValue: 18410.700302124023},
        {ticker: 'SGOV', hasOpenPosition: true, marketValue: 10156.559753417969},
        {ticker: 'EUV', hasOpenPosition: true, marketValue: 2013.7500286102295},
        {ticker: 'IBKR', hasOpenPosition: true, marketValue: 360.68186443481443},
        {ticker: 'CLOSED', hasOpenPosition: false, marketValue: 999999},
    ], 23565.66);
    assert.equal(totalEquity, 80301.35181125793);
    assert.equal(
        computeInvestmentLiveHoldingsTotalEquity([
            {ticker: 'DRAM', hasOpenPosition: true, marketValue: null},
        ], 23565.66),
        null,
    );
});

test('current broker cash converts foreign balances and applies pending once', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                hsbc: {
                    ending_cash_base_currency: '23412.54',
                    ending_cash_by_currency: {
                        HKD: '89.24',
                        USD: '23412.54',
                        CNH: '0.00',
                    },
                    hsbc_bank_available_cash: '23388.54',
                    hsbc_pending_settlement_cash_raw: '-24.600',
                    hsbc_pending_settlement_fee_adjustment: '0.000',
                    hsbc_pending_settlement_fee_unapplied: '0.000',
                    hsbc_pending_settlement_cash: '-24.600',
                    hsbc_pending_settlement_order_count: 1,
                    hsbc_broker_cash_estimate: '23387.940',
                    cash_snapshot_authoritative: true,
                    position_snapshot_as_of: '2026-08-19',
                },
                ibkr: {
                    ending_cash: '950.49',
                    cash_snapshot_authoritative: true,
                    ending_cash_as_of: '2026-08-19',
                },
                schwab: {
                    ending_cash: '0.41',
                    position_snapshot_as_of: '2026-08-13',
                },
            },
            fx_rate_history_by_currency: {
                HKD: {
                    dates: ['2026-08-19'],
                    values: {'2026-08-19': 7.842899799346924},
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerCurrentPendingSettlementCash('hsbc'), -24.6);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('hsbc'), 23387.94);
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('hsbc'), {
            HKD: 89.24,
            USD: 23412.54,
        });
        const fxTimeline = buildInvestmentFxRateTimeline([], 'USD');
        const hsbcSnapshot = getInvestmentBrokerCurrentCashSnapshot(
            'hsbc',
            '2026-08-20',
            fxTimeline,
        );
        assert.ok(hsbcSnapshot);
        assert.ok(Math.abs(
            hsbcSnapshot.runningCash - (23412.54 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.ok(Math.abs(
            hsbcSnapshot.displayCash - (23387.94 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.equal(hsbcSnapshot.isApproximate, true);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('ibkr'), 950.49);
        assert.equal(
            getInvestmentBrokerCurrentCashSnapshot('ibkr', '2026-08-20', fxTimeline)?.displayCash,
            950.49,
        );
        assert.equal(getInvestmentBrokerCurrentDisplayCash('schwab'), 0.41);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('longbridge_hk'), null);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('settled HSBC FX conversion does not mark current cash provisional', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                hsbc: {
                    ending_cash_base_currency: '23387.94',
                    ending_cash_by_currency: {
                        HKD: '89.24',
                        USD: '23387.94',
                    },
                    hsbc_pending_settlement_cash: '0.000',
                    hsbc_pending_settlement_order_count: 0,
                    cash_snapshot_authoritative: true,
                },
            },
            fx_rate_history_by_currency: {
                HKD: {
                    dates: ['2026-08-19'],
                    values: {'2026-08-19': 7.842899799346924},
                },
            },
        },
    };
    try {
        const fxTimeline = buildInvestmentFxRateTimeline([], 'USD');
        const snapshot = getInvestmentBrokerCurrentCashSnapshot(
            'hsbc',
            '2026-08-20',
            fxTimeline,
        );
        assert.ok(snapshot);
        assert.ok(Math.abs(
            snapshot.displayCash - (23387.94 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.equal(snapshot.pendingSettlementCash, 0);
        assert.equal(snapshot.isApproximate, false);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('replay comparator uses ledger booking date before execution timestamp', () => {
    const bookingDateRow = {
        date: '2023-05-11',
        datetime: '2023-05-10 00:50:40',
    };
    const laterSameDayRow = {
        date: '2023-05-10',
        datetime: '2023-05-10 00:53:48',
    };
    assert.ok(compareInvestmentTransactionsForReplay(bookingDateRow, laterSameDayRow) > 0);
    assert.ok(compareInvestmentTransactionsForReplay(laterSameDayRow, bookingDateRow) < 0);
});

test('HSBC USD Savings CSV rows keep newest-first source rows in chronological replay order', () => {
    const olderSourceRow = {
        broker: 'hsbc',
        date: '2026-06-24',
        datetime: '2026-06-24 20:00:00',
        type: 'deposit',
        currency: 'USD',
        net_amount_raw: '2200.88',
        source: {file_kind: 'hsbc_usd_savings_csv', row_number: 90, ledger_sequence: 90},
    };
    const newerSourceRow = {
        ...olderSourceRow,
        net_amount_raw: '2948.41',
        source: {file_kind: 'hsbc_usd_savings_csv', row_number: 89, ledger_sequence: 89},
    };
    assert.ok(compareInvestmentTransactionsForReplay(olderSourceRow, newerSourceRow) < 0);
    assert.ok(compareInvestmentTransactionsForReplay(newerSourceRow, olderSourceRow) > 0);
});

test('HSBC date-only orders retain source-page execution order after SEC settlement enrichment', () => {
    const purchase = {
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2026-08-07',
        datetime: '2026-08-07 20:00:00',
        type: 'buy',
        ticker: 'DRAM',
        source: {
            file_kind: 'hsbc_order_status_text',
            row_number: 3,
            order_status_source_row_number: 3,
            order_status_page_order: 'newest_first',
            statement_order_id: 'P-900006',
            cash_settlement_source_row_number: 50,
        },
    };
    const sale = {
        ...purchase,
        type: 'sell',
        source: {
            file_kind: 'hsbc_order_status_text',
            row_number: 1,
            order_status_source_row_number: 1,
            order_status_page_order: 'newest_first',
            statement_order_id: 'S-900004',
        },
    };

    assert.ok(compareInvestmentTransactions(purchase, sale) < 0);
    assert.ok(compareInvestmentTransactionsForReplay(purchase, sale) < 0);
    assert.ok(compareInvestmentTaxLotTransactions(purchase, sale) < 0);
    assert.ok(compareInvestmentTransactions(sale, purchase) > 0);
    assert.ok(compareInvestmentTransactionsForReplay(sale, purchase) > 0);
    assert.ok(compareInvestmentTaxLotTransactions(sale, purchase) > 0);
});

test('Schwab date-only trades retain explicit same-day execution sequence', () => {
    const buy = {
        broker: 'schwab',
        account: 'Individual ...001',
        date: '2026-08-24',
        datetime: '2026-08-24 20:00:00',
        type: 'buy',
        ticker: 'EUV',
        normalized: {net_amount: '-23.45'},
        source: {
            file_kind: 'schwab_csv',
            datetime_precision: 'day',
            source_has_intraday_timestamp: false,
            source_row_order: 'newest_first',
            row_number: 3,
            same_day_execution_sequence: 1,
        },
    };
    const sell = {
        ...buy,
        type: 'sell',
        normalized: {net_amount: '23.755'},
        source: {
            ...buy.source,
            row_number: 2,
            same_day_execution_sequence: 2,
        },
    };

    assert.ok(compareInvestmentTransactions(buy, sell) < 0);
    assert.ok(compareInvestmentTransactionsForReplay(buy, sell) < 0);
    assert.ok(compareInvestmentTaxLotTransactions(buy, sell) < 0);
});

test('tax-lot replay normalizes mixed source timestamp formats before sorting', () => {
    setDramTestWindow();
    const historicalBuy = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-13',
        quantity: 5, price: 50,
    });
    historicalBuy.datetime = '2026-08-13 08:18:42';
    historicalBuy.source.source_datetime_raw = '20260813081842.000[-4:EDT]';

    const currentSell = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-14',
        quantity: 5, price: 57.75,
    });
    currentSell.datetime = '2026-08-14 11:05:00';
    currentSell.source.source_datetime_raw = '2026-08-14, 11:05 PM';

    assert.ok(compareInvestmentTaxLotTransactions(historicalBuy, currentSell) < 0);
    const dram = buildTickerSummaries([currentSell, historicalBuy], {DRAM: 57.75}, 0, {})[0];
    assert.equal(dram.realizedPnlLocal, 38.75);
});

test('bound-transfer replay order outranks later timestamp and source-row fallbacks', () => {
    const transferOut = {
        date: '2026-08-03',
        datetime: '2026-08-03 20:20:00',
        type: 'transfer_out',
        ticker: 'DRAM',
        source: {row_number: 362},
    };
    const transferIn = {
        date: '2026-08-03',
        datetime: '2026-08-03 20:00:00',
        type: 'transfer_in',
        ticker: 'DRAM',
        source: {row_number: 2},
    };
    Object.defineProperty(transferOut, INVESTMENT_REPLAY_ORDER_SYMBOL, {
        value: 10,
    });
    Object.defineProperty(transferIn, INVESTMENT_REPLAY_ORDER_SYMBOL, {
        value: 11,
    });

    assert.ok(compareInvestmentTransactions(transferOut, transferIn) < 0);
    assert.ok(compareInvestmentTransactionsForReplay(transferOut, transferIn) < 0);
    assert.ok(compareInvestmentTaxLotTransactions(transferOut, transferIn) < 0);
});

test('future HSBC settlement cash becomes ordered non-transaction boundaries', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-06-22',
            type: 'buy',
            ticker: 'BOXX',
            currency: 'USD',
            source: {
                file_kind: 'hsbc_order_status_text',
                statement_order_id: 'P-1',
                cash_settlement_date: '2026-06-23',
                cash_settlement_amount_raw: '-900.00',
                cash_settlement_balance_after_raw: '10100.00',
                cash_settlement_postings: [{
                    date: '2026-06-23',
                    amount_raw: '-900.00',
                    balance_after_raw: '10100.00',
                    row_number: 42,
                    ledger_sequence: 42,
                    currency: 'USD',
                    role: 'principal',
                }],
            },
        },
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-06-22',
            type: 'buy',
            ticker: 'EUV',
            currency: 'USD',
            source: {
                file_kind: 'hsbc_order_status_text',
                statement_order_id: 'P-2',
                cash_settlement_date: '2026-06-23',
                cash_settlement_amount_raw: '-100.00',
                cash_settlement_balance_after_raw: '10000.00',
                cash_settlement_postings: [{
                    date: '2026-06-23',
                    amount_raw: '-100.00',
                    balance_after_raw: '10000.00',
                    row_number: 43,
                    ledger_sequence: 43,
                    currency: 'USD',
                    role: 'principal',
                }],
            },
        },
    ]);

    assert.deepEqual(
        boundaries.map((boundary) => [
            boundary.transactionDate,
            boundary.date,
            boundary.settlementBalanceAfter,
            boundary.settlementAmount,
            boundary.sourceRowSequence,
        ]),
        [
            ['2026-06-22', '2026-06-23', 10100, -900, 42],
            ['2026-06-22', '2026-06-23', 10000, -100, 43],
        ],
    );
    assert.ok(boundaries.every((boundary) => !('type' in boundary)));
    assert.ok(boundaries.every((boundary) => !('ticker' in boundary)));
    assert.ok(boundaries.every((boundary) => !('description' in boundary)));
    assert.ok(boundaries.every((boundary) => !('ledger_no' in boundary)));
});

test('missing broker starting boundaries remain absent instead of becoming USD zero', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {},
                hsbc: {starting_cash: null},
                longbridge_hk: {starting_cash: '0'},
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('ibkr'), {});
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('hsbc'), {});
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('longbridge_hk'), {});
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity replay accepts a settlement boundary snapshot without adding a transaction', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '12000'}};
    try {
        const canonicalTransactions = [{
            date: '2026-06-22',
            datetime: '2026-06-22 20:00:00',
            ledger_no: 1,
            aggregate_running_cash: 12000,
            aggregate_display_cash: 12000,
            aggregate_holdings: {},
        }];
        const points = buildDailyEquityChartPoints(
            canonicalTransactions,
            {},
            new Set(),
            {
                replaySnapshots: [
                    canonicalTransactions[0],
                    {
                        date: '2026-06-23',
                        datetime: '2026-06-23 23:59:00.0001',
                        replay_snapshot_order: 2,
                        aggregate_running_cash: 11600,
                        aggregate_display_cash: 11600,
                        aggregate_holdings: {},
                        aggregate_money_market_anchors: {},
                        replay_snapshot_kind: 'hsbc_cash_settlement_boundary',
                    },
                ],
            },
        );
        assert.equal(points.find((point) => point.date === '2026-06-22')?.aggregate_total_equity, 12000);
        assert.equal(points.find((point) => point.date === '2026-06-23')?.aggregate_total_equity, 11600);
        assert.deepEqual(points.find((point) => point.date === '2026-06-23')?.anchor_ledger_nos, []);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity replay sorts snapshots by ledger date before consuming the cursor', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2023-05-11',
                datetime: '2023-05-10 00:50:40',
                aggregate_holdings: {},
                aggregate_running_cash: 100,
                aggregate_display_cash: 100,
            },
            {
                date: '2023-05-10',
                datetime: '2023-05-10 00:53:48',
                aggregate_holdings: {SPYM: 400},
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
            },
        ], {
            SPYM: {'2023-05-10': 48.54},
        }, new Set());
        assert.equal(points.find((point) => point.date === '2023-05-10')?.aggregate_total_equity, 19416);
        assert.equal(points.find((point) => point.date === '2023-05-11')?.aggregate_total_equity, 100);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity keeps the current account boundary on the final chart point', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2026-08-06',
                aggregate_running_cash: 100,
                aggregate_display_cash: 100,
                aggregate_history_running_cash: 90,
                aggregate_history_display_cash: 90,
                aggregate_holdings: {},
            },
            {
                date: '2026-08-07',
                aggregate_running_cash: 130,
                aggregate_display_cash: 130,
                aggregate_history_running_cash: 160,
                aggregate_history_display_cash: 160,
                aggregate_holdings: {},
            },
        ], {}, new Set());
        assert.equal(points.find((point) => point.date === '2026-08-06')?.aggregate_total_equity, 90);
        assert.equal(points.find((point) => point.date === '2026-08-07')?.aggregate_total_equity, 130);
        assert.equal(points.find((point) => point.date === '2026-08-07')?.aggregate_current_total_equity, 130);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily price normalization rejects bad closes and deduplicates deterministically', () => {
    const firstPayload = normalizePriceHistoryPayload({
        'DIS.US': [
            {date: '2025-03-12', close: 0},
            {date: '2025-03-12', close: 101},
            {date: '2025-03-12', close: 100},
            {date: '2025-03-13', close: -1},
            {date: '2025-03-13', close: 102},
        ],
    });
    const shuffledPayload = normalizePriceHistoryPayload({
        'DIS.US': [
            {date: '2025-03-13', close: 102},
            {date: '2025-03-12', close: 100},
            {date: '2025-03-12', close: 101},
            {date: '2025-03-13', close: -1},
            {date: '2025-03-12', close: 0},
        ],
    });
    assert.deepEqual(firstPayload, shuffledPayload);
    assert.deepEqual(firstPayload, {
        DIS: {'2025-03-12': 100, '2025-03-13': 102},
        'DIS.US': {'2025-03-12': 100, '2025-03-13': 102},
    });
});

test('missing historical holdings fail closed instead of using transaction or last-known prices', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const incompleteLastKnownPoint = buildDailyEquityChartPoints([
            {
                date: '2025-03-12',
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {DIS: 10},
                aggregate_last_known_ticker_prices: {DIS: 42},
            },
        ], {}, new Set());
        assert.equal(incompleteLastKnownPoint[1]?.aggregate_total_equity, null);
        assert.equal(incompleteLastKnownPoint[1]?.valuation_complete, false);
        assert.deepEqual(incompleteLastKnownPoint[1]?.missing_price_tickers, ['DIS']);
        assert.deepEqual(incompleteLastKnownPoint[1]?.degraded_price_tickers, []);

        const incompletePoint = buildDailyEquityChartPoints([
            {
                date: '2025-03-12',
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {AMD: 10, SQQQ: 2},
            },
        ], {}, new Set());
        assert.equal(incompletePoint[1]?.aggregate_total_equity, null);
        assert.equal(incompletePoint[1]?.valuation_complete, false);
        assert.deepEqual(incompletePoint[1]?.missing_price_tickers, ['AMD', 'SQQQ']);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('historical bridge cash is cumulative and current endpoint remains unbridged', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2026-06-21', aggregate_running_cash: 100, aggregate_display_cash: 100,
                aggregate_bridge_adjustment: -100, aggregate_holdings: {},
            },
            {
                date: '2026-06-22', aggregate_running_cash: 100, aggregate_display_cash: 100,
                aggregate_bridge_adjustment: 0, aggregate_holdings: {},
            },
        ], {}, new Set());
        assert.equal(points.find((point) => point.date === '2026-06-21')?.aggregate_total_equity, 0);
        assert.equal(points.find((point) => point.date === '2026-06-22')?.aggregate_total_equity, 100);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily curve is invariant to shuffled input when transaction identities are unchanged', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '1000'}};
    try {
        const rows = [
            {date: '2025-03-12', datetime: '2025-03-12 09:00:00', source: {row_number: 1}, aggregate_running_cash: 900, aggregate_display_cash: 900, aggregate_holdings: {DIS: 1}},
            {date: '2025-03-13', datetime: '2025-03-13 09:00:00', source: {row_number: 2}, aggregate_running_cash: 950, aggregate_display_cash: 950, aggregate_holdings: {DIS: 1}},
            {date: '2025-03-14', datetime: '2025-03-14 09:00:00', source: {row_number: 3}, aggregate_running_cash: 900, aggregate_display_cash: 900, aggregate_holdings: {}},
        ];
        const prices = {DIS: {'2025-03-12': 100, '2025-03-13': 105, '2025-03-14': 106}};
        const ordered = buildDailyEquityChartPoints(rows, prices, new Set());
        const shuffled = buildDailyEquityChartPoints([rows[2], rows[0], rows[1]], prices, new Set());
        assert.deepEqual(shuffled, ordered);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('shared scoped-position aggregation keeps Holdings and chart semantics aligned', () => {
    const usdState = createPositionState('DRAM');
    usdState.shares = 10;
    usdState.totalCost = 500;
    usdState.realizedPnl = 12;
    usdState.lotScope = {currency: 'USD'};
    const hkdState = createPositionState('DRAM');
    hkdState.shares = 1;
    hkdState.totalCost = 780;
    hkdState.lotScope = {currency: 'HKD'};
    const aggregate = aggregateInvestmentScopedPositionStates(
        new Map([['usd', usdState], ['hkd', hkdState]]),
        'DRAM',
        () => 'USD',
    );
    assert.equal(aggregate.shares, 11);
    assert.equal(aggregate.totalCost, null);
    assert.equal(aggregate.averagePrice, null);
    assert.equal(aggregate.realizedPnl, 12);
    assert.deepEqual(aggregate.positionCurrencies, ['HKD', 'USD']);
    assert.equal(aggregate.hasMixedPositionCurrencies, true);
});

test('mixed-broker payloads select the authoritative broker-scoped HSBC position snapshot', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            summary: {position_snapshot_authoritative: false},
            broker_summaries: {
                hsbc: {
                    broker: 'hsbc',
                    account: '000-999999-999',
                    position_snapshot_authoritative: true,
                    position_snapshot_source: 'hsbc_portfolio_text',
                    position_snapshot: {
                        DRAM: {
                            quantity: '200',
                            cost_price: '60.9455',
                            market_value: '10980.00',
                            last_price: '54.890',
                        },
                    },
                    holdings_validation: {matched: false, mismatch_count: 1},
                },
            },
        },
    };
    try {
        const transactions = [{
            broker: 'hsbc',
            account: '000-999999-999',
            ticker: 'DRAM',
            type: 'sell',
            date: '2026-08-04',
            source: {broker: 'hsbc', account: '000-999999-999'},
        }];
        const snapshot = getAuthoritativePositionSnapshotForTransactions(transactions);
        assert.equal(snapshot.DRAM.quantity, 200);
        assert.equal(snapshot.DRAM.marketValue, 10980);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('historical summaries reject current authoritative position snapshots', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: false,
                performance_snapshot_authoritative: false,
            },
            broker_summaries: {
                ibkr: {
                    broker: 'ibkr',
                    account: 'U1',
                    position_snapshot_authoritative: true,
                    position_snapshot: {
                        QQQ: {
                            quantity: '10',
                            cost_price: '100',
                            cost_basis_status: 'known',
                            market_value: '1000',
                            last_price: '100',
                        },
                    },
                },
            },
        },
    };
    try {
        const transactions = [{
            broker: 'ibkr',
            account: 'U1',
            type: 'buy',
            ticker: 'QQQ',
            currency: 'USD',
            date: '2026-08-04',
            datetime: '2026-08-04 12:00:00',
            quantity_abs: '1',
            quantity_raw: '1',
            price_raw: '100',
            normalized: {
                position_quantity: '1',
                unit_price: '100',
                net_amount: '-100',
            },
            source: {file_kind: 'test_fixture'},
        }];
        const currentSummary = buildTickerSummaries(
            transactions,
            {QQQ: 120},
            120,
            {},
        )[0];
        const historicalSummary = buildTickerSummaries(
            transactions,
            {QQQ: 120},
            120,
            {},
            {
                useAuthoritativePositionSnapshot: false,
                useAuthoritativePerformanceSnapshot: false,
                valuationDate: '2026-08-04',
            },
        )[0];

        assert.equal(currentSummary.shares, 10);
        assert.equal(currentSummary.unrealizedPnl, 0);
        assert.equal(historicalSummary.shares, 1);
        assert.equal(historicalSummary.unrealizedPnl, 20);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Futu internal-transfer overlays preserve signed broker cash while neutralizing aggregate funding', () => {
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            internal_transfer_external_flow_excluded: true,
            normalized: {net_amount: '1271.50'},
        }),
        -1271.5,
    );
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            internal_transfer_external_flow_excluded: true,
            normalized: {net_amount: '-100.00'},
        }),
        100,
    );
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            normalized: {net_amount: '1271.50'},
        }),
        0,
    );
    const fxTimeline = {
        baseCurrency: 'USD',
        ratesByCurrency: {
            HKD: {
                dates: ['2023-02-15'],
                values: {'2023-02-15': 7.849650},
            },
        },
    };
    const hkdTransfer = {
        date: '2023-02-15',
        currency: 'HKD',
        normalized: {net_amount: '10000.00'},
        internal_transfer_external_flow_excluded: true,
    };
    assert.ok(Math.abs(
        getInvestmentInternalTransferAggregateBridgeAmount(
            10000,
            hkdTransfer,
            fxTimeline,
            'USD',
        ) - 1273.9421502869554,
    ) < 1e-9);
    assert.ok(Math.abs(
        getInvestmentInternalTransferAggregateBridgeDelta(
            hkdTransfer,
            fxTimeline,
            'USD',
        ) + 1273.9421502869554,
    ) < 1e-9);
});

test('daily equity charts omit marked Futu internal transfers from external-flow points', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2023-02-16',
                type: 'deposit',
                currency: 'USD',
                normalized: {net_amount: '1271.50'},
                internal_transfer_external_flow_excluded: true,
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {},
                aggregate_money_market_anchors: {},
            },
        ], {}, new Set());
        const point = points.find((entry) => entry.date === '2023-02-16');
        assert.ok(point);
        assert.equal(point.cash_in_amount, 0);
        assert.equal(point.net_transfer_amount, 0);
        assert.equal(point.cumulative_net_transfer_amount, 0);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('long-range daily equity charts fill calendar days and carry weekend cash changes', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0.00',
            ticker_lineage: {},
            money_market_tickers: [],
        },
    };
    try {
        const transactions = [
            {
                ledger_no: 1,
                date: '2024-01-04',
                type: 'buy',
                ticker: 'ABC',
                currency: 'USD',
                quantity: 1,
                price: 100,
                normalized: {net_amount: '-100.00'},
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {ABC: 1},
            },
            {
                ledger_no: 2,
                date: '2024-01-06',
                type: 'deposit',
                currency: 'USD',
                normalized: {net_amount: '10.00'},
                aggregate_running_cash: 10,
                aggregate_display_cash: 10,
                aggregate_holdings: {ABC: 1},
            },
            {
                ledger_no: 3,
                date: '2024-01-08',
                type: 'adjustment',
                currency: 'USD',
                normalized: {net_amount: '0.00'},
                aggregate_running_cash: 10,
                aggregate_display_cash: 10,
                aggregate_holdings: {ABC: 1},
            },
        ];
        const prices = normalizePriceHistoryPayload({
            ABC: [
                {date: '2024-01-05', close: 100},
                {date: '2024-01-08', close: 110},
            ],
        });
        const sparsePoints = buildDailyEquityChartPoints(transactions, prices, new Set());
        const calendarPoints = buildDailyEquityChartPoints(
            transactions,
            prices,
            new Set(),
            {includeCalendarDays: true},
        );
        const pointByDate = Object.fromEntries(calendarPoints.map((point) => [point.date, point]));

        assert.equal(sparsePoints.some((point) => point.date === '2024-01-07'), false);
        assert.deepEqual(
            calendarPoints.map((point) => point.date),
            ['2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08'],
        );
        assert.equal(pointByDate['2024-01-05'].is_trading_day, true);
        assert.equal(pointByDate['2024-01-06'].is_trading_day, false);
        assert.equal(pointByDate['2024-01-07'].is_trading_day, false);
        assert.equal(pointByDate['2024-01-06'].is_calendar_carry_forward, false);
        assert.equal(pointByDate['2024-01-07'].is_calendar_carry_forward, true);
        assert.equal(pointByDate['2024-01-06'].cash_in_amount, 10);
        assert.equal(pointByDate['2024-01-06'].aggregate_total_equity, 110);
        assert.equal(pointByDate['2024-01-07'].aggregate_total_equity, 110);
        assert.equal(pointByDate['2024-01-07'].previous_trading_point_index, 2);
        assert.equal(pointByDate['2024-01-08'].aggregate_total_equity, 120);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Schwab authoritative snapshots retain unknown basis and reported close prices without fabricating P&L', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: true,
                performance_snapshot_authoritative: false,
            },
            position_snapshot: {
                QQQI: {
                    quantity: '15',
                    cost_price: '',
                    cost_basis: '',
                    cost_basis_status: 'unknown',
                    last_price: '',
                    close_price: '53.89',
                    value: '808.35',
                },
                PART: {
                    quantity: '2',
                    cost_price: '50.00',
                    cost_basis_status: 'partial',
                    close_price: '55.00',
                    value: '110.00',
                },
                KNOWN: {
                    quantity: '1',
                    cost_price: '0',
                    cost_basis_status: 'known',
                    close_price: '2.00',
                    value: '2.00',
                },
            },
        },
    };
    try {
        const snapshot = getAuthoritativePositionSnapshot();
        assert.deepEqual(snapshot.QQQI, {
            quantity: 15,
            costBasisStatus: 'unknown',
            costPrice: null,
            marketValue: 808.35,
            lastPrice: 53.89,
        });
        assert.equal(snapshot.PART.costBasisStatus, 'partial');
        assert.equal(snapshot.PART.costPrice, null);
        assert.equal(snapshot.KNOWN.costBasisStatus, 'known');
        assert.equal(snapshot.KNOWN.costPrice, 0);
        assert.equal(snapshot.KNOWN.lastPrice, 2);

        const qqqiBuy = makeImportedTrade({
            type: 'buy', date: '2026-07-29', quantity: 1, price: 50,
        });
        qqqiBuy.ticker = 'QQQI';
        qqqiBuy.broker = 'ibkr';
        qqqiBuy.account = 'U00000003';
        const qqqiSell = makeImportedTrade({
            type: 'sell', date: '2026-07-30', quantity: 1, price: 60,
        });
        qqqiSell.ticker = 'QQQI';
        qqqiSell.broker = 'ibkr';
        qqqiSell.account = 'U00000003';
        const summaries = buildTickerSummaries([qqqiBuy, qqqiSell], {}, 920.35, {});
        const qqqi = summaries.find((summary) => summary.ticker === 'QQQI');
        const partial = summaries.find((summary) => summary.ticker === 'PART');
        const known = summaries.find((summary) => summary.ticker === 'KNOWN');

        for (const summary of [qqqi, partial]) {
            assert.ok(summary);
            assert.equal(summary.totalCost, null);
            assert.equal(summary.averagePrice, null);
            assert.equal(summary.realizedPnl, null);
            assert.equal(summary.realizedPnlLocal, null);
            assert.equal(summary.unrealizedPnl, null);
            assert.equal(summary.unrealizedPnlLocal, null);
            assert.equal(summary.totalPnl, null);
            assert.equal(summary.totalPnlLocal, null);
            assert.equal(summary.realizedPnlStatus, 'unavailable');
            assert.equal(summary.unrealizedPnlStatus, 'unavailable');
            assert.equal(summary.pnlUnavailable, true);
        }
        assert.equal(qqqi.lastPrice, 53.89);
        assert.equal(qqqi.marketValue, 808.35);
        assert.equal(qqqi.realizedPnlAccounts.length, 1);
        assert.equal(qqqi.realizedPnlAccounts[0].realizedPnl, null);
        assert.equal(qqqi.realizedPnlAccounts[0].realizedPnlLocal, null);
        assert.equal(qqqi.realizedPnlAccounts[0].status, 'unavailable');
        assert.equal(
            qqqi.pnlUnavailableReason,
            'authoritative_position_snapshot_cost_basis_unknown',
        );
        assert.equal(
            partial.pnlUnavailableReason,
            'authoritative_position_snapshot_cost_basis_partial',
        );
        assert.equal(known.pnlUnavailable, false);
        assert.equal(known.averagePrice, 0);
        assert.equal(known.unrealizedPnl, 2);
        assert.equal(known.totalPnl, 2);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('FIFO reconstructed transfer basis restores Holdings P&L over an unknown Schwab snapshot', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: true,
                performance_snapshot_authoritative: false,
            },
            position_snapshot: {
                QQQI: {
                    quantity: '5',
                    cost_price: '',
                    cost_basis_status: 'unknown',
                    value: '400',
                    close_price: '80',
                },
            },
            broker_summaries: {},
        },
    };
    const transactions = [
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'buy', date: '2026-07-01', datetime: '2026-07-01 12:00:00',
            quantity_raw: '3', quantity_abs: '3',
            normalized: {display_quantity: '3', net_amount: '-30.09'},
            source: {file_kind: 'ibkr_csv', row_number: 1},
        },
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'buy', date: '2026-07-10', datetime: '2026-07-10 12:00:00',
            quantity_raw: '2', quantity_abs: '2',
            normalized: {display_quantity: '2', net_amount: '-40.06'},
            source: {file_kind: 'ibkr_csv', row_number: 2},
        },
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'transfer_out', date: '2026-07-31', datetime: '2026-07-31 12:00:00',
            quantity_raw: '5', quantity_abs: '5',
            transfer_out_cost_basis_raw: '70.15',
            transfer_out_cost_basis_status: 'known',
            transfer_out_cost_basis_method_label: 'FIFO reconstructed',
            source: {file_kind: 'ibkr_csv', row_number: 3},
        },
        {
            broker: 'schwab', account: 'Individual ...001', ticker: 'QQQI', currency: 'USD',
            type: 'transfer_in', date: '2026-07-31', datetime: '2026-07-31 12:00:00',
            quantity_raw: '5', quantity_abs: '5',
            carried_cost_basis_raw: '70.15',
            carried_cost_basis_status: 'known',
            carried_cost_basis_method_label: 'FIFO reconstructed',
            source: {file_kind: 'schwab_transactions_csv', row_number: 4},
        },
    ];
    try {
        const summary = buildTickerSummaries(transactions, {QQQI: 80}, 400, {})[0];
        assert.equal(summary.shares, 5);
        assert.equal(summary.totalCost, 70.15);
        assert.ok(Math.abs(summary.averagePrice - 14.03) < 1e-9);
        assert.equal(summary.costBasisStatus, 'known');
        assert.equal(summary.costBasisMethod, 'FIFO reconstructed');
        assert.equal(summary.pnlUnavailable, false);
        assert.ok(Math.abs(summary.unrealizedPnl - 329.85) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('HSBC cash snapshots preserve USD, HKD, and CNH balances', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '99.00',
            starting_cash_by_currency: {USD: '10.00', HKD: '46.10', CNH: '12.00', ZERO: '0'},
            ending_cash: '2.00',
            ending_cash_by_currency: {USD: '2.00', HKD: '46.10', CNH: '12.00'},
            ending_cash_base_currency: '10.50',
            broker_summaries: {
                hsbc: {
                    ending_cash: '2.00',
                    ending_cash_by_currency: {USD: '2.00', HKD: '46.10', CNH: '12.00'},
                    ending_cash_base_currency: '10.50',
                    ending_cash_base_currency_as_of: '2026-08-07',
                },
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentStartingCashBalances(), {USD: 10, HKD: 46.1, CNH: 12});
        assert.deepEqual(getInvestmentEndingCashBalances(), {USD: 2, HKD: 46.1, CNH: 12});
        assert.equal(getInvestmentEndingCashInBaseCurrency(), 10.5);
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('HSBC'), {USD: 2, HKD: 46.1, CNH: 12});
        assert.equal(getInvestmentBrokerEndingCashInBaseCurrency('hsbc'), 10.5);
        assert.equal(getInvestmentBrokerEndingCashAsOf('hsbc'), '2026-08-07');
        assert.deepEqual(
            createCashLedgerFromBalances({USD: '2.00', HKD: '46.10', CNH: '12.00'}),
            {USD: 2, HKD: 46.1, CNH: 12},
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('dated cash snapshots anchor replay without erasing later IBKR trades', () => {
    const rows = [
        {
            date: '2026-08-07',
            broker_running_cash: 400,
            broker_cash_by_currency: {USD: 400},
        },
        {
            date: '2026-08-10',
            broker_running_cash: 249.65,
            broker_cash_by_currency: {USD: 249.65},
        },
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-07',
        authoritativeBaseCash: 420.38156702,
        authoritativeBalances: {USD: 420.38156702},
    });

    assert.equal(projection.applied, true);
    assert.ok(Math.abs(projection.projections[0].runningCash - 420.38156702) < 1e-9);
    assert.ok(Math.abs(projection.projections[1].runningCash - 270.03156702) < 1e-9);
    assert.ok(Math.abs(projection.projections[1].balances.USD - 270.03156702) < 1e-9);
});

test('intraday cash boundaries leave earlier same-day IBKR rows unchanged', () => {
    const rows = [
        {
            date: '2026-08-12',
            datetime: '2026-08-12 20:20:00',
            broker_running_cash: 312.45,
            broker_cash_by_currency: {USD: 312.45},
        },
        {
            date: '2026-08-12',
            datetime: '2026-08-12 21:56:00',
            broker_running_cash: 845.68250076,
            broker_cash_by_currency: {USD: 845.68250076},
        },
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-12',
        asOfDateTime: '2026-08-12 21:56:00',
        authoritativeBaseCash: 845.67,
        authoritativeBalances: {USD: 845.67},
        getRowDateTime: (row) => row.datetime,
    });

    assert.equal(projection.applied, true);
    assert.deepEqual(
        projection.projections.map(({index, runningCash}) => ({index, runningCash})),
        [{index: 1, runningCash: 845.67}],
    );
});

test('a later authoritative cash boundary supersedes an older snapshot correction', () => {
    const rows = [
        {date: '2026-08-06', broker_running_cash: 400, broker_cash_by_currency: {USD: 400}},
        {date: '2026-08-07', broker_running_cash: 300, broker_cash_by_currency: {USD: 300}},
        {date: '2026-08-08', broker_running_cash: 500, broker_cash_by_currency: {USD: 500}, boundary: true},
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-06',
        authoritativeBaseCash: 420,
        authoritativeBalances: {USD: 420},
        getBoundaryCurrencies: (row) => row.boundary ? ['USD'] : [],
    });

    assert.deepEqual(
        projection.projections.map(({runningCash}) => runningCash),
        [420, 320, 500],
    );
    assert.equal(projection.projections[2].balances.USD, 500);
});

test('authoritative negative cash remains signed through dated replay', () => {
    const projection = buildDatedCashSnapshotProjection([
        {date: '2026-08-07', broker_running_cash: 100, broker_cash_by_currency: {USD: 100}},
        {date: '2026-08-08', broker_running_cash: 90, broker_cash_by_currency: {USD: 90}},
    ], {
        asOf: '2026-08-07',
        authoritativeBaseCash: -5,
        authoritativeBalances: {USD: -5},
    });

    assert.deepEqual(
        projection.projections.map(({runningCash}) => runningCash),
        [-5, -15],
    );
    assert.equal(projection.projections[1].balances.USD, -15);
});

test('cash and position snapshots retain independent as-of dates', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {
                    ending_cash_base_currency_as_of: '2026-08-06',
                    position_snapshot_as_of: '2026-08-07',
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerEndingCashAsOf('ibkr'), '2026-08-06');
        assert.equal(getInvestmentBrokerPositionSnapshotAsOf('ibkr'), '2026-08-07');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('IBKR cash replay prefers the last transaction date over the later report date', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {
                    ending_cash_as_of: '2026-08-11',
                    ending_cash_replay_as_of: '2026-08-10',
                    ending_cash_replay_as_of_datetime: '2026-08-10 18:30:00',
                    position_snapshot_as_of: '2026-08-11',
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerEndingCashAsOf('ibkr'), '2026-08-10');
        assert.equal(
            getInvestmentBrokerEndingCashAsOfDateTime('ibkr'),
            '2026-08-10 18:30:00',
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('dated position snapshots project later buys into current holdings and cost', () => {
    const snapshot = {
        DRAM: {
            quantity: 102,
            costBasisStatus: 'known',
            costPrice: 49,
            marketValue: 5100,
            lastPrice: 50,
        },
    };
    const projected = projectAuthoritativePositionSnapshot(snapshot, [{
        broker: 'ibkr',
        account: 'U00000001',
        type: 'buy',
        ticker: 'DRAM',
        date: '2026-08-10',
        quantity_abs: '3',
        normalized: {
            position_quantity: '3',
            unit_price: '50',
            net_amount: '-150.35',
            commission: '-0.35',
        },
    }], '2026-08-07');

    assert.equal(projected.DRAM.quantity, 105);
    assert.ok(Math.abs(projected.DRAM.costPrice - ((102 * 49 + 150.35) / 105)) < 1e-9);
    assert.equal(projected.DRAM.marketValue, null);
    assert.equal(projected.DRAM.lastPrice, null);
});

test('dated position snapshots retain IBKR grants at zero cost', () => {
    const snapshot = {
        IBKR: {
            quantity: 1,
            costBasisStatus: 'known',
            costPrice: 84.25,
            marketValue: 84.25,
            lastPrice: 84.25,
        },
    };
    const projected = projectAuthoritativePositionSnapshot(snapshot, [{
        broker: 'ibkr',
        account: 'U00000001',
        type: 'grant',
        ticker: 'IBKR',
        date: '2026-01-30',
        quantity_abs: '3.25',
        price_raw: '64.25',
        normalized: {
            position_quantity: '3.25',
            unit_price: '64.25',
            net_amount: '0',
        },
    }], '2026-01-29');

    assert.equal(projected.IBKR.quantity, 4.25);
    assert.ok(Math.abs(projected.IBKR.costPrice - (84.25 / 4.25)) < 1e-9);
    assert.equal(projected.IBKR.marketValue, null);
    assert.equal(projected.IBKR.lastPrice, null);
});

test('Holdings and the daily equity endpoint share the projected post-snapshot position', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0',
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {position_snapshot_authoritative: false, performance_snapshot_authoritative: false},
            broker_summaries: {
                ibkr: {
                    broker: 'ibkr',
                    account: 'U00000001',
                    position_snapshot_authoritative: true,
                    position_snapshot_as_of: '2026-08-07',
                    position_snapshot: {
                        DRAM: {
                            quantity: '102',
                            cost_basis_status: 'known',
                            cost_price: '49',
                            market_value: '5100',
                            last_price: '50',
                        },
                    },
                },
            },
        },
    };
    const buy = {
        broker: 'ibkr',
        account: 'U00000001',
        type: 'buy',
        ticker: 'DRAM',
        currency: 'USD',
        date: '2026-08-10',
        datetime: '2026-08-10 00:57:00',
        quantity_abs: '3',
        normalized: {
            position_quantity: '3',
            unit_price: '50',
            net_amount: '-150.35',
            commission: '-0.35',
        },
    };
    try {
        const holdings = buildTickerSummaries([buy], {DRAM: 50}, 5520.03156702, {
            DRAM: {'2026-08-10': 50},
        });
        assert.equal(holdings[0].shares, 105);
        assert.equal(holdings[0].marketValue, 5250);

        const points = buildDailyEquityChartPoints([{
            ...buy,
            ledger_no: 1,
            aggregate_running_cash: 270.03156702,
            aggregate_display_cash: 270.03156702,
            aggregate_holdings: {DRAM: 105},
        }], {DRAM: {'2026-08-10': 50}}, new Set());
        const endpoint = points.find((point) => point.date === '2026-08-10');
        assert.ok(Math.abs(endpoint.aggregate_total_equity - 5520.03156702) < 1e-9);
        assert.ok(Math.abs(
            endpoint.aggregate_total_equity
            - (270.03156702 + holdings[0].marketValue),
        ) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('HSBC cash boundaries clear stale unscoped replay without merging subaccounts', () => {
    const savingsRow = {
        broker: 'hsbc',
        account: '000-999999-999',
        currency: 'HKD',
        source: {
            account_type: 'HKD Savings',
            balance_after_raw: '89.24',
            file_kind: 'hsbc_multi_currency_cash_account_text',
        },
    };
    const currentRow = {
        ...savingsRow,
        source: {
            ...savingsRow.source,
            account_type: 'HKD Current',
            balance_after_raw: '0.00',
        },
    };
    const legacyUsdRow = {
        ...savingsRow,
        currency: 'USD',
        source: {
            ...savingsRow.source,
            account_type: 'Foreign Currency Savings USD',
            balance_after_raw: '0.00',
            file_kind: 'hsbc_statement_cash',
        },
    };
    const usdSavingsRow = {
        ...legacyUsdRow,
        source: {
            ...legacyUsdRow.source,
            account_type: 'USD Savings',
            balance_after_raw: '21108.38',
            file_kind: 'hsbc_usd_account_text',
        },
    };
    assert.notEqual(
        getInvestmentCashBalanceScope(savingsRow),
        getInvestmentCashBalanceScope(currentRow),
    );
    assert.deepEqual(getInvestmentCashBalanceBoundary(savingsRow), {
        scopeKey: 'HSBC|000-999999-999|HKD SAVINGS|HKD',
        currency: 'HKD',
        balance: 89.24,
    });

    const ledger = createInvestmentCashScopeLedger({HKD: 27_462.16});
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(savingsRow));
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(currentRow));
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(legacyUsdRow));
    addInvestmentCashScopeDelta(ledger, 'USD', -24_373.75);
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(usdSavingsRow));
    addInvestmentCashScopeDelta(ledger, 'USD', 3);
    assert.deepEqual(getInvestmentCashScopeBalances(ledger), {
        USD: 21_111.38,
        HKD: 89.24,
    });
});

test('empty multi-currency snapshots fall back to the legacy base-currency scalar', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '99.00',
            starting_cash_by_currency: {},
            ending_cash: '2.00',
            ending_cash_by_currency: {},
            broker_summaries: {
                hsbc: {
                    ending_cash: '2.00',
                    ending_cash_by_currency: {},
                },
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentStartingCashBalances(), {USD: 99});
        assert.deepEqual(getInvestmentEndingCashBalances(), {USD: 2});
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('hsbc'), {USD: 2});
        assert.deepEqual(createCashLedgerFromBalances({}, '2.00'), {USD: 2});
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('ledger price fallback stays silent when valuation remains complete', () => {
    const status = buildValuationStatus({
        fallbackTickers: ['DRAM'],
        openTickers: ['DRAM'],
    });

    assert.equal(status.isDegraded, false);
    assert.equal(status.message, '');
    assert.deepEqual(status.fallbackTickers, ['DRAM']);
});

function makeForexComponent({ currency, amount, description }) {
    return {
        type: 'forex_trade_component',
        date: '2024-09-04',
        datetime: '2024-09-05 00:00:00',
        currency,
        description,
        broker: 'longbridge_sg',
        account: 'SG99999999',
        source: {
            file_kind: 'longbridge_cash_flow',
            transaction_type_raw: amount > 0
                ? 'Currency Conversion (Credit)'
                : 'Currency Conversion (Debit)',
        },
        normalized: {
            net_amount: String(amount),
            cash_flow_amount: String(amount),
        },
        amount,
    };
}

const longbridgeSgFxTransactions = [
    makeForexComponent({
        currency: 'HKD',
        amount: -600,
        description: 'FX FROM HKD TO USD @ 0.1277',
    }),
    makeForexComponent({
        currency: 'USD',
        amount: 76.62,
        description: 'FX FROM HKD TO USD @ 0.1277',
    }),
    makeForexComponent({
        currency: 'SGD',
        amount: -103.9,
        description: 'FX FROM SGD TO USD @ 0.7627',
    }),
    makeForexComponent({
        currency: 'USD',
        amount: 79.24,
        description: 'FX FROM SGD TO USD @ 0.7627',
    }),
];

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_DATA_UTILS_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('transaction descriptions reserve at-sign for prices and use multiplication for quantities', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}}};
    try {
        assert.equal(
            formatTransactionDescription({
                type: 'transfer_in',
                ticker: 'QQQI',
                quantity_abs: '5',
            }),
            'QQQI × 5',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'buy',
                ticker: 'EUV',
                quantity_abs: '5',
                price: '23',
            }),
            'EUV @ 23.00 × 5',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'grant',
                ticker: 'IBKR',
                quantity_abs: '1.2345',
                price: '64.25',
            }),
            'IBKR × 1.2345',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                ticker: 'QQQI',
                quantity_raw: '-5',
                quantity_abs: '5',
                normalized: {position_quantity: '-5'},
            }),
            'QQQI × -5',
        );
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('linked distribution descriptions show the ticker while retaining broker text', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}}};
    try {
        assert.equal(
            formatTransactionDescription({
                type: 'dividend',
                ticker: 'QQQI',
                description: 'CORP EVT PAYMENT SEC',
            }),
            'QQQI · CORP EVT PAYMENT SEC',
        );
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('HSBC trade descriptions use compact order references and mark unresolved settlement', () => {
    const pendingOrder = {
        broker: 'hsbc',
        type: 'buy',
        ticker: 'EUV',
        quantity_abs: '3',
        price: '24.50',
        source: {
            statement_order_id: 'P-590134',
            cash_settlement_reference: 'REF P344496153 SEC',
            cash_replay_pending_settlement: true,
        },
    };
    assert.equal(
        formatTransactionDescription(pendingOrder),
        'EUV @ 24.50 × 3 · P-590134*',
    );

    const settledOrder = {
        ...pendingOrder,
        source: {
            ...pendingOrder.source,
            cash_settlement_amount_raw: '-73.50',
        },
    };
    assert.equal(
        formatTransactionDescription(settledOrder),
        'EUV @ 24.50 × 3 · P-590134',
    );
});

test('cash and FX descriptions retain source evidence without legacy-equivalent ambiguity', () => {
    assert.equal(
        formatTransactionDescription({
            type: 'deposit',
            currency: 'HKD',
            description: 'Deposit',
        }),
        'Deposit',
    );
    assert.equal(
        formatTransactionDescription({
            type: 'deposit',
            currency: 'USD',
        }),
        'Deposit · USD',
    );
    assert.equal(
        formatTransactionDescription({type: 'deposit'}),
        '* Equivalent',
    );
    assert.equal(
        formatTransactionDescription({
            type: 'forex_trade_component',
            description: 'FX FROM USD TO HKD @ 7.8',
        }),
        'FX from USD to HKD @ 7.8',
    );
});

test('transaction descriptions canonicalize clause separators without changing identifiers', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}}};
    try {
        assert.equal(
            formatTransactionDescription({
                type: 'deposit',
                description: 'REF00000000000 - GOLD/EXCHANGE CREDIT',
            }),
            'REF00000000000 · GOLD/EXCHANGE CREDIT',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'kol_reward',
                description: 'WISE PAYMENTS LTD REF00000000000000 26JUL | Longbridge KOL reward',
            }),
            'KOL Rewards · WISE PAYMENTS LTD REF00000000000000 26JUL · Longbridge',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'deposit',
                description: 'EDDA Cash Deposit',
            }),
            'eDDA Cash Deposit',
        );
        assert.equal(
            formatTransactionDescription({
                broker: 'longbridge_sg',
                type: 'dividend',
                ticker: 'TQQQ.US',
                description: 'TQQQ.US Cash dividend: 0.275411 USD per share , Held:1',
            }),
            'TQQQ Cash dividend: 0.275411 USD per share, Held: 1',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                description: 'EUV @ 23.80 × 5 - P-900005',
            }),
            'EUV @ 23.80 × 5 · P-900005',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                description: 'Rev – Cash Withdrawal',
            }),
            'Rev · Cash Withdrawal',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                description: 'Fee — USD 0.02',
            }),
            'Fee · USD 0.02',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                description: 'A ·  B',
            }),
            'A · B',
        );
        assert.equal(
            formatTransactionDescription({
                type: 'adjustment',
                description: 'BRK-B',
            }),
            'BRK-B',
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('IBKR distribution descriptions normalize security identifiers and sentence case', () => {
    const sourceDescription = 'NEOS Nasdaq-100(R) High Income ETF (Us78433H6751) Cash Dividend USD 0.6346 Per Share - Us Tax';
    assert.equal(
        formatTransactionDescription({
            type: 'foreign_tax_withholding',
            ticker: 'QQQI',
            description: sourceDescription,
        }),
        'QQQI Cash dividend USD 0.6346 per share · US tax',
    );
    assert.equal(
        formatTransactionDescription({
            type: 'dividend',
            ticker: 'META',
            description: 'Meta(Us30303M1027) CASH DIVIDEND USD 0.033 PER SHARE (Ordinary Dividend)',
        }),
        'META Cash dividend USD 0.033 per share (Ordinary dividend)',
    );
    assert.equal(sourceDescription, 'NEOS Nasdaq-100(R) High Income ETF (Us78433H6751) Cash Dividend USD 0.6346 Per Share - Us Tax');
});

test('money-market transaction descriptions use canonical ISIN identities without mutating source text', () => {
    const previousWindow = globalThis.window;
    const sourceDescription = 'GaoTeng WeValue USD Money Mkt A USD Acc 489.3604 Shares';
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            money_market_tickers: [
                '005276756',
                'HK0000369196',
                'HK0000478872',
                'HK0000584737',
                'HK0000584752',
                'HK0000720752',
                'HK0001039582',
            ],
            ticker_lineage: {
                'HK0000584752.HK': ['HK0000584752'],
                'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_USD.USD': ['HK0000584737'],
                'LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD': ['HK0000720752'],
            },
            known_ticker_company_names: {
                '005276756': 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
                HK0000584737: 'GaoTeng WeValue USD Money Mkt A USD Acc',
                HK0000584752: 'GaoTeng WeValue USD Money Mkt C USD Acc',
                HK0000720752: 'Ping An Money Market P USD Acc',
            },
        },
    };
    const longbridgePlacement = {
        broker: 'longbridge_hk',
        type: 'adjustment',
        description: sourceDescription,
        currency: 'USD',
        normalized: {
            cash_equivalent_action: 'placement',
            cash_equivalent_fund_id: 'gaoteng_money_market_usd',
            cash_equivalent_transfer: true,
        },
        source: {
            cash_equivalent_fund_id: 'gaoteng_money_market_usd',
            cash_equivalent_transfer: true,
        },
    };
    try {
        assert.equal(
            formatTransactionDescription(longbridgePlacement),
            'HK0000584737 · GaoTeng WeValue USD Money Mkt A USD Acc · Subscription · 489.3604 Shares',
        );
        assert.equal(longbridgePlacement.description, sourceDescription);
        assert.equal(
            formatTransactionDescription({
                broker: 'longbridge_hk',
                type: 'adjustment',
                description: 'Redemption of HK0000720752 of Ping An Money Market P USD Acc',
                currency: 'USD',
                normalized: {
                    cash_equivalent_action: 'redemption',
                    cash_equivalent_fund_id: 'ping_an_money_market_usd',
                    cash_equivalent_transfer: true,
                },
                source: {
                    cash_equivalent_fund_id: 'ping_an_money_market_usd',
                    cash_equivalent_transfer: true,
                },
            }),
            'HK0000720752 · Ping An Money Market P USD Acc · Redemption',
        );
        assert.equal(
            formatTransactionDescription({
                broker: 'futuhk',
                type: 'withdrawal',
                description: 'Fund Subscription#GaoTeng WeValue USD Money Market Fund',
                currency: 'USD',
            }),
            'HK0000584737 · GaoTeng WeValue USD Money Mkt A USD Acc · Subscription',
        );
        assert.equal(
            formatTransactionDescription({
                broker: 'ibkr',
                type: 'dividend',
                ticker: '005276756',
                description: 'L9025R513(LU0052767562) CASH DIVIDEND USD 0.033 PER SHARE (Ordinary Dividend)',
                currency: 'USD',
            }),
            '005276756 · Franklin Templeton U.S. Dollar Short-Term Money Market Fund · Cash dividend USD 0.033 per share (Ordinary dividend)',
        );
        assert.equal(
            formatTransactionDescription({
                broker: 'ibkr',
                type: 'dividend_reinvestment',
                ticker: '005276756',
                quantity_abs: '3.43',
                description: 'Buy 3.43 FRANKLIN TEMPLETON OFFSHORE FUNDS FRANKLIN U.S. DOLLAR SHORT-TERM MONEY MARKET "A" (USD) INC (Dividend Reinvestment)',
                currency: 'USD',
            }),
            '005276756 · Franklin Templeton U.S. Dollar Short-Term Money Market Fund · Dividend reinvestment × 3.43',
        );
        assert.equal(
            formatTransactionDescription({
                broker: 'zircon_hk',
                type: 'buy',
                ticker: 'HK0000584752.HK',
                quantity_abs: '1',
                price: '78.99',
                currency: 'USD',
            }),
            'HK0000584752 @ 78.99 × 1',
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('uSMART HK symbol-less fractional shares use a synthetic valuation anchor', () => {
    const fractionalBuy = {
        broker: 'usmart_hk',
        type: 'buy',
        date: '2023-02-23',
        description: 'Fractional Shares Purchase (symbol unavailable in statement)',
        source: { statement_item_raw: '買碎股' },
        normalized: { net_amount: '-100.00' },
    };
    const valuation = calculateSnapshotMarketValue(
        {
            holdings: { [USMART_HK_FRACTIONAL_SYNTHETIC_TICKER]: 100 },
            money_market_anchors: { [USMART_HK_FRACTIONAL_SYNTHETIC_TICKER]: 1 },
        },
        '2023-02-24',
        {},
        new Set(),
        { baseCurrency: 'USD', ratesByCurrency: {} },
        'USD',
    );

    assert.equal(isUsmartHkFractionalSharesTransaction(fractionalBuy), true);
    assert.equal(valuation.marketValue, 100);
    assert.equal(valuation.holdingsMarketValues[USMART_HK_FRACTIONAL_SYNTHETIC_TICKER], 100);
});

test('legacy Tiger Trade Funds in Transit rows do not reduce equity', () => {
    const legacySubscription = {
        broker: 'tigertrade',
        type: 'adjustment',
        currency: 'USD',
        description: 'Fund Subscription',
        gross_amount_raw: '-1500.00',
        source: { statement_section: 'Funds in Transit' },
        normalized: {
            net_amount: '-1500.00',
            display_amount: '-1500.00',
            cash_flow_amount: '-1500.00',
        },
    };

    assert.equal(getTransactionAmount(legacySubscription), 0);
    assert.equal(getTransactionEconomicAmount(legacySubscription), -1500);
});

test('Longbridge HK cash equivalents expose cash deltas and synthetic valuation tickers', () => {
    const placement = {
        broker: 'longbridge_hk',
        type: 'adjustment',
        currency: 'USD',
        description: 'Subscription of HK0000720752 of Ping An Money Market P USD Acc',
        gross_amount_raw: '-1000.00',
        normalized: {
            display_amount: '-1000.00',
            net_amount: '0',
            cash_equivalent_transfer: true,
            cash_equivalent_fund_id: 'ping_an_money_market_usd',
            cash_equivalent_value_after: '1000.00',
        },
        source: {
            cash_equivalent_transfer: true,
            cash_equivalent_transfer_amount_raw: '-1000.00',
        },
    };
    const redemption = {
        broker: 'longbridge_hk',
        type: 'adjustment',
        currency: 'USD',
        description: 'Redemption of HK0000720752 of Ping An Money Market P USD Acc',
        gross_amount_raw: '1020.92',
        normalized: {
            display_amount: '1020.92',
            net_amount: '20.92',
            cash_equivalent_transfer: true,
            cash_equivalent_fund_id: 'ping_an_money_market_usd',
            cash_equivalent_value_after: '0.00',
        },
        source: {
            cash_equivalent_transfer: true,
            cash_equivalent_transfer_amount_raw: '1020.92',
        },
    };

    assert.equal(isLongbridgeHkCashEquivalentTransfer(placement), true);
    assert.equal(getTransactionAmount(placement), -1000);
    assert.equal(getTransactionAmount(redemption), 1020.92);
    assert.equal(getTransactionEconomicAmount(redemption), 1020.92);
    assert.equal(
        getLongbridgeHkCashEquivalentSyntheticTicker(placement),
        'LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD',
    );
    const valuation = calculateSnapshotMarketValue(
        {
            holdings: {
                [getLongbridgeHkCashEquivalentSyntheticTicker(placement)]: 1000,
            },
            money_market_anchors: {
                [getLongbridgeHkCashEquivalentSyntheticTicker(placement)]: 1,
            },
        },
        '2023-10-05',
        {},
        new Set(),
        { baseCurrency: 'USD', ratesByCurrency: {} },
        'USD',
    );
    assert.equal(valuation.marketValue, 1000);
});

test('Longbridge HK redeemed cash equivalents appear in Holdings realized P&L', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {
                'LONGBRIDGE_HK_CASH_EQUIVALENT.PING_AN_MONEY_MARKET_USD.USD': ['HK0000720752'],
            },
            money_market_tickers: ['HK0000720752'],
            money_market_quote_currencies: { HK0000720752: 'USD' },
            summary: { performance_snapshot_authoritative: false },
        },
    };
    const transactions = [
        {
            broker: 'longbridge_hk',
            type: 'adjustment',
            date: '2023-09-14',
            currency: 'USD',
            gross_amount_raw: '-1000.00',
            normalized: {
                cash_equivalent_transfer: true,
                cash_equivalent_fund_id: 'ping_an_money_market_usd',
                cash_equivalent_interest_amount: '0',
                cash_equivalent_value_after: '1000.00',
                cash_equivalent_cash_delta: '-1000.00',
            },
            source: { cash_equivalent_transfer: true },
        },
        {
            broker: 'longbridge_hk',
            type: 'adjustment',
            date: '2023-11-30',
            currency: 'USD',
            gross_amount_raw: '1020.92',
            normalized: {
                cash_equivalent_transfer: true,
                cash_equivalent_fund_id: 'ping_an_money_market_usd',
                cash_equivalent_interest_amount: '20.92',
                cash_equivalent_value_after: '0.00',
                cash_equivalent_cash_delta: '1020.92',
            },
            source: { cash_equivalent_transfer: true },
        },
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const summary = summaries.find((item) => item.ticker === 'HK0000720752');

    assert.ok(summary);
    assert.equal(summary.hasOpenPosition, false);
    assert.equal(summary.shares, 0);
    assert.equal(summary.quoteCurrency, 'USD');
    assert.equal(summary.realizedPnl, 20.92);
    assert.equal(summary.realizedPnlLocal, 20.92);
});

test('daily equity preserves Tiger Trade fund value without cached prices', () => {
    const ticker = 'HK0000369196.USD';
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0.00',
            ticker_lineage: {},
            money_market_tickers: [ticker],
        },
    };
    const buySnapshot = {
        type: 'buy',
        date: '2025-01-08',
        ticker,
        normalized: {
            position_quantity: '114.346',
            unit_price: '13.11800',
            net_amount: '-1499.99',
        },
        aggregate_running_cash: 35.11,
        aggregate_holdings: { [ticker]: 114.346 },
        aggregate_money_market_anchors: { [ticker]: 13.118 },
    };
    const laterSnapshot = {
        type: 'dividend',
        date: '2025-01-10',
        ticker: 'MU',
        normalized: { net_amount: '0.50' },
        aggregate_running_cash: 35.61,
        aggregate_holdings: { [ticker]: 114.346 },
        aggregate_money_market_anchors: { [ticker]: 13.118 },
    };
    const points = buildDailyEquityChartPoints(
        [buySnapshot, laterSnapshot],
        normalizePriceHistoryPayload({
            MU: [
                { date: '2025-01-08', close: 100 },
                { date: '2025-01-09', close: 101 },
                { date: '2025-01-10', close: 102 },
                { date: '2025-01-13', close: 103 },
            ],
        }),
        new Set([ticker]),
    );
    const pointByDate = Object.fromEntries(points.map((point) => [point.date, point]));

    assert.ok(Math.abs(pointByDate['2025-01-08'].aggregate_market_value - 1499.99) < 0.01);
    assert.ok(Math.abs(pointByDate['2025-01-08'].aggregate_total_equity - 1535.10) < 0.01);
    assert.ok(Math.abs(pointByDate['2025-01-13'].aggregate_market_value - 1499.99) < 0.01);
    assert.ok(Math.abs(pointByDate['2025-01-13'].aggregate_total_equity - 1535.60) < 0.01);
});

test('virtual balance resets zero CNY cash without creating a portfolio loss', () => {
    const previousWindow = globalThis.window;
    const resetAmount = 21511.90;
    const cnyPerUsd = 7.20;
    const resetAmountUsd = resetAmount / cnyPerUsd;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0.00',
            ticker_lineage: {},
            money_market_tickers: [],
            fx_rate_history_by_currency: {
                CNY: {
                    dates: ['2024-03-29', '2024-04-01'],
                    values: {'2024-03-29': cnyPerUsd, '2024-04-01': cnyPerUsd},
                },
            },
        },
    };
    try {
        const points = buildDailyEquityChartPoints([
            {
                ledger_no: 1,
                type: 'deposit',
                date: '2024-03-29',
                currency: 'CNY',
                normalized: {net_amount: String(resetAmount), cash_flow_amount: String(resetAmount)},
                aggregate_running_cash: resetAmountUsd,
                aggregate_display_cash: resetAmountUsd,
                aggregate_holdings: {},
            },
            {
                ledger_no: 2,
                type: 'virtual_balance_reset',
                date: '2024-04-01',
                currency: 'CNY',
                normalized: {net_amount: String(-resetAmount), cash_flow_amount: String(-resetAmount)},
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {},
            },
        ], {}, new Set());
        const pointByDate = Object.fromEntries(points.map((point) => [point.date, point]));
        const resetPoint = pointByDate['2024-04-01'];
        const priorPoint = pointByDate['2024-03-29'];
        const pnlAcrossReset = (
            resetPoint.aggregate_total_equity
            - priorPoint.aggregate_total_equity
            - resetPoint.net_transfer_amount
        );

        assert.ok(Math.abs(resetPoint.cash_out_amount - resetAmountUsd) < 1e-9);
        assert.ok(Math.abs(resetPoint.net_transfer_amount + resetAmountUsd) < 1e-9);
        assert.equal(resetPoint.aggregate_total_equity, 0);
        assert.ok(Math.abs(pnlAcrossReset) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('USD money-market currency overrides take precedence over a Hong Kong ticker suffix', () => {
    const previousWindow = globalThis.window;
    const sourceTicker = 'HK0000584752.HK';
    const ticker = 'HK0000584752';
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: { [sourceTicker]: [ticker] },
            money_market_tickers: [ticker],
            money_market_quote_currencies: { [ticker]: 'USD' },
            summary: { performance_snapshot_authoritative: false },
        },
    };
    try {
        const summaries = buildTickerSummaries([
            {
                broker: 'zircon_hk', account: '57812160', date: '2025-01-17', type: 'buy', ticker: sourceTicker,
                currency: 'USD', quantity_raw: '1', quantity_abs: '1', price_raw: '78.99',
                normalized: { position_quantity: '1', unit_price: '78.99', net_amount: '-78.99' },
            },
            {
                broker: 'zircon_hk', account: '57812160', date: '2025-01-20', type: 'sell', ticker: sourceTicker,
                currency: 'USD', quantity_raw: '-1', quantity_abs: '1', price_raw: '79.01',
                normalized: { position_quantity: '-1', unit_price: '79.01', net_amount: '79.01' },
            },
        ], {}, 0, {});
        const summary = summaries.find((item) => item.ticker === ticker);

        assert.ok(summary);
        assert.equal(summary.quoteCurrency, 'USD');
        assert.equal(summary.realizedPnlLocal, 0.02);
        assert.equal(summary.realizedPnl, 0.02);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('cash-equivalent securities keep named cash-flow descriptions without becoming money-market funds', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            money_market_tickers: ['005276756'],
            cash_equivalent_tickers: ['SGOV'],
            known_ticker_company_names: {
                SGOV: 'iShares 0-3 Month Treasury Bond ETF',
            },
        },
    };
    try {
        assert.equal(
            formatTransactionDescription({
                broker: 'hsbc',
                type: 'dividend',
                ticker: 'SGOV',
                amount: '27.60',
                description: 'CORP EVT PAYMENT SEC',
                currency: 'USD',
            }),
            'SGOV · iShares 0-3 Month Treasury Bond ETF · Dividend · CORP EVT PAYMENT SEC',
        );
        assert.equal(getMoneyMarketTickerSet().has('SGOV'), false);
        assert.equal(getCashEquivalentTickerSet().has('SGOV'), true);
        assert.equal(getCashEquivalentTickerSet().has('005276756'), true);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Hong Kong money-market fund ISINs stay canonical across USD and HKD classes', () => {
    const previousWindow = globalThis.window;
    const sourceTicker = 'HK0001039582.USD';
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: { [sourceTicker]: ['HK0001039582'] },
            money_market_tickers: ['005276756', 'HK0001039582', 'HK0000478872'],
            money_market_quote_currencies: { '005276756': 'USD', HK0001039582: 'USD', HK0000478872: 'HKD' },
            summary: { performance_snapshot_authoritative: false },
        },
    };
    try {
        const summaries = buildTickerSummaries([{
            broker: 'tigertrade', account: '4556114', date: '2025-01-27', type: 'buy', ticker: sourceTicker,
            currency: 'USD', quantity_raw: '8.209', quantity_abs: '8.209', price_raw: '102.301',
            normalized: { position_quantity: '8.209', unit_price: '102.301', net_amount: '-839.78' },
        }], {}, 0, {});
        const summary = summaries.find((item) => item.ticker === 'HK0001039582');

        assert.equal(getMoneyMarketTickerSet().has('HK0001039582'), true);
        assert.equal(getMoneyMarketTickerSet().has('HK0000478872'), true);
        assert.equal(getMoneyMarketTickerSet().has('005276756'), true);
        assert.equal(summary?.quoteCurrency, 'USD');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Longbridge HK GaoTeng cash equivalents resolve to their ISIN share classes', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {
                'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_USD.USD': ['HK0000584737'],
                'LONGBRIDGE_HK_CASH_EQUIVALENT.GAOTENG_MONEY_MARKET_HKD.HKD': ['HK0000478872'],
            },
            money_market_tickers: ['HK0000584737', 'HK0000478872'],
            money_market_quote_currencies: { HK0000584737: 'USD', HK0000478872: 'HKD' },
            summary: { performance_snapshot_authoritative: false },
        },
    };
    try {
        const summaries = buildTickerSummaries([
            {
                broker: 'longbridge_hk', account: 'HK-USD', date: '2025-01-02', type: 'adjustment', currency: 'USD',
                normalized: {
                    cash_equivalent_transfer: true, cash_equivalent_fund_id: 'gaoteng_money_market_usd',
                    cash_equivalent_interest_amount: '0.25', cash_equivalent_value_after: '0.00',
                },
                source: { cash_equivalent_transfer: true },
            },
            {
                broker: 'longbridge_hk', account: 'HK-HKD', date: '2025-01-03', type: 'adjustment', currency: 'HKD',
                normalized: {
                    cash_equivalent_transfer: true, cash_equivalent_fund_id: 'gaoteng_money_market_hkd',
                    cash_equivalent_interest_amount: '0.05', cash_equivalent_value_after: '0.00',
                },
                source: { cash_equivalent_transfer: true },
            },
        ], {}, 0, {});
        const usdSummary = summaries.find((item) => item.ticker === 'HK0000584737');
        const hkdSummary = summaries.find((item) => item.ticker === 'HK0000478872');

        assert.equal(usdSummary?.quoteCurrency, 'USD');
        assert.equal(usdSummary?.realizedPnlLocal, 0.25);
        assert.equal(hkdSummary?.quoteCurrency, 'HKD');
        assert.equal(hkdSummary?.realizedPnlLocal, 0.05);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('formatTransactionCurrency uses acquired quote currency for forex pairs', () => {
    assert.equal(
        formatTransactionCurrency({
            type: 'forex_trade_component',
            ticker: 'USD.CNH',
            currency: 'USD',
        }),
        'CNH',
    );
    assert.equal(
        formatTransactionCurrency({
            type: 'forex_trade_component',
            currency: 'SGD',
            description: 'FX FROM SGD TO USD @ 0.7627',
        }),
        'SGD',
    );
});

test('buildInvestmentFxRateTimeline infers Longbridge SG conversion rates', () => {
    const fxTimeline = buildInvestmentFxRateTimeline(longbridgeSgFxTransactions, 'USD');
    const hkdRate = fxTimeline.ratesByCurrency.HKD.values['2024-09-04'];
    const sgdRate = fxTimeline.ratesByCurrency.SGD.values['2024-09-04'];

    assert.ok(Number.isFinite(hkdRate) && hkdRate > 0);
    assert.ok(Number.isFinite(sgdRate) && sgdRate > 0);
    assert.ok(Math.abs(hkdRate - (600 / 76.62)) < 0.01);
    assert.ok(Math.abs(sgdRate - (103.9 / 79.24)) < 0.01);
});

test('convertAmountToBaseCurrency uses Longbridge SG FX timeline rates', () => {
    const fxTimeline = buildInvestmentFxRateTimeline(longbridgeSgFxTransactions, 'USD');
    const hkdUsd = convertAmountToBaseCurrency(600, 'HKD', '2024-09-04', fxTimeline, 'USD');
    const sgdUsd = convertAmountToBaseCurrency(103.9, 'SGD', '2024-09-04', fxTimeline, 'USD');

    assert.ok(Math.abs(hkdUsd - 76.62) < 0.05, `expected ~76.62 USD, got ${hkdUsd}`);
    assert.ok(Math.abs(sgdUsd - 79.24) < 0.05, `expected ~79.24 USD, got ${sgdUsd}`);
});

test('historical FX payload converts CNY and statement rates remain authoritative', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            fx_rate_history_by_currency: {
                CNY: {
                    dates: ['2024-01-02'],
                    values: {'2024-01-02': 7.00},
                },
            },
        },
    };
    try {
        const historicalTimeline = buildInvestmentFxRateTimeline([], 'USD');
        assert.equal(convertAmountToBaseCurrency(700, 'CNY', '2024-01-02', historicalTimeline, 'USD'), 100);
        assert.equal(convertAmountToBaseCurrency(700, 'CNH', '2024-01-02', historicalTimeline, 'USD'), 100);

        const statementTimeline = buildInvestmentFxRateTimeline([{
            broker: 'cmb_cn',
            type: 'kol_reward',
            currency: 'CNY',
            date: '2024-01-02',
            amount: 720,
            source: {statement_currency_to_base_rate_raw: '7.2'},
        }], 'USD');
        assert.equal(convertAmountToBaseCurrency(720, 'CNY', '2024-01-02', statementTimeline, 'USD'), 100);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

function makeImportedTrade({ type, date, quantity, price }) {
    return {
        type,
        date,
        datetime: `${date} 12:00:00`,
        ticker: 'TQQQ.US',
        quantity_raw: String(quantity),
        quantity_abs: String(quantity),
        price_raw: String(price),
        normalized: {
            side: type,
            position_quantity: String(quantity),
            unit_price: String(price),
            net_amount: type === 'buy' ? String(-price * quantity) : String(price * quantity),
        },
    };
}

test('KOL rewards count as realized income and legacy deposits are detected', () => {
    globalThis.window = { WORTHWARD_INVESTMENT_DATA: { ticker_lineage: {}, money_market_tickers: [] } };
    const transactions = [
        {
            type: 'kol_reward',
            date: '2024-06-25',
            currency: 'HKD',
            description: 'KOL Rewards (S/N: 202406190029)',
            normalized: { net_amount: '600.00', cash_flow_amount: '600.00' },
        },
        {
            type: 'deposit',
            date: '2024-07-25',
            currency: 'SGD',
            description: 'KOL Rewards (S/N: 202407180052)',
            source: { transaction_type_raw: 'KOL' },
            normalized: { net_amount: '86.80', cash_flow_amount: '86.80' },
        },
        {
            type: 'forex_trade_component',
            date: '2024-09-04',
            currency: 'USD',
            description: 'FX FROM HKD TO USD @ 0.1277',
            normalized: { net_amount: '76.62', cash_flow_amount: '76.62' },
        },
        {
            type: 'forex_trade_component',
            date: '2024-09-04',
            currency: 'HKD',
            description: 'FX FROM HKD TO USD @ 0.1277',
            normalized: { net_amount: '-600.00', cash_flow_amount: '-600.00' },
        },
    ];
    assert.equal(isKolRewardTransaction(transactions[0]), true);
    assert.equal(isKolRewardTransaction(transactions[1]), true);
    assert.equal(isKolRewardTransaction(transactions[2]), false);
    const fxTimeline = buildInvestmentFxRateTimeline(transactions, getInvestmentBaseCurrency());
    const kolIncome = sumKolRewardRealizedIncomeInBaseCurrency(
        transactions,
        fxTimeline,
        getInvestmentBaseCurrency(),
    );
    assert.ok(kolIncome > 140 && kolIncome < 170, `unexpected KOL income USD total: ${kolIncome}`);
});

test('buildTickerSummaries keeps flat SPYM when SPLG grant sees SPY proxy history only', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {
                'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
                SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
            },
            money_market_tickers: [],
        },
    };
    const transactions = [
        {
            type: 'grant',
            date: '2023-01-27',
            datetime: '2023-01-27 20:00:00',
            ticker: 'SPLG.US',
            quantity_raw: '1',
            quantity_abs: '1',
            price_raw: '0',
            normalized: {
                position_quantity: '1',
                display_quantity: '1',
                unit_price: '0',
                net_amount: '0',
            },
        },
        {
            type: 'buy',
            date: '2023-01-27',
            datetime: '2023-01-27 20:00:00',
            ticker: 'SPLG.US',
            quantity_raw: '24',
            quantity_abs: '24',
            price_raw: '47.4600',
            normalized: {
                position_quantity: '24',
                display_quantity: '24',
                unit_price: '47.4600',
                net_amount: '-1139.0400',
            },
        },
        {
            type: 'sell',
            date: '2023-02-16',
            datetime: '2023-02-16 20:00:00',
            ticker: 'SPLG.US',
            quantity_raw: '25',
            quantity_abs: '25',
            price_raw: '48.2500',
            normalized: {
                position_quantity: '25',
                display_quantity: '25',
                unit_price: '48.2500',
                net_amount: '1206.2500',
            },
        },
    ];
    const priceHistory = normalizePriceHistoryPayload({
        'SPLG.US': [
            { date: '2023-01-27', close: 405.68 },
            { date: '2023-02-16', close: 408.28 },
        ],
    });
    const summaries = buildTickerSummaries(transactions, {}, 0, priceHistory);
    const spym = summaries.find((summary) => summary.ticker === 'SPYM');
    assert.ok(spym, 'expected SPYM summary row');
    assert.ok(Math.abs(spym.shares) < 1e-9, `expected flat SPYM, got ${spym.shares}`);
    assert.equal(spym.hasOpenPosition, false);
});

test('buildTickerSummaries keeps flat TQQQ when chart closes are split-adjusted', () => {
    globalThis.window = { WORTHWARD_INVESTMENT_DATA: { ticker_lineage: {}, money_market_tickers: [] } };
    const transactions = [
        makeImportedTrade({ type: 'buy', date: '2025-04-06', quantity: 1, price: 36 }),
        makeImportedTrade({ type: 'sell', date: '2025-05-12', quantity: 1, price: 66 }),
    ];
    const priceHistory = normalizePriceHistoryPayload({
        'TQQQ.US': [
            { date: '2025-04-06', close: 20.545 },
            { date: '2025-05-12', close: 33.055 },
        ],
    });
    const summaries = buildTickerSummaries(transactions, {}, 0, priceHistory);
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');
    assert.ok(tqqq, 'expected TQQQ summary row');
    assert.ok(Math.abs(tqqq.shares) < 1e-9, `expected flat TQQQ, got ${tqqq.shares}`);
    assert.equal(tqqq.hasOpenPosition, false);
});

test('split-factor consensus repairs an isolated noisy TQQQ pre-split fill', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}, money_market_tickers: []}};
    try {
        const makeTrade = ({type, date, quantity, price}) => ({
            broker: 'longbridge_hk',
            account: 'H99999999',
            type,
            date,
            datetime: `${date} 12:00:00`,
            ticker: 'TQQQ',
            quantity_raw: String(quantity),
            quantity_abs: String(quantity),
            price_raw: String(price),
            normalized: {
                position_quantity: String(quantity),
                unit_price: String(price),
                net_amount: type === 'buy' ? String(-price * quantity) : String(price * quantity),
            },
        });
        const noisySell = makeTrade({type: 'sell', date: '2025-04-09', quantity: 25, price: 40});
        const transactions = [
            makeTrade({type: 'buy', date: '2025-04-07', quantity: 1, price: 40}),
            makeTrade({type: 'sell', date: '2025-04-08', quantity: 1, price: 40}),
            makeTrade({type: 'buy', date: '2025-04-08', quantity: 25, price: 40}),
            noisySell,
        ];
        const priceHistory = normalizePriceHistoryPayload({
            TQQQ: [
                {date: '2025-04-07', close: 20},
                {date: '2025-04-08', close: 20},
                {date: '2025-04-09', close: 26.305},
            ],
        });
        const tickerPriceIndex = buildTickerPriceIndex(priceHistory);
        assert.equal(getTransactionRenderedSplitFactor(noisySell, tickerPriceIndex), 1.5);
        const hints = buildRenderedSplitFactorHints(transactions, tickerPriceIndex);
        assert.equal(hints.get('TQQQ|2025-04-09'), 2);
        assert.equal(getTransactionValuationQuantity(noisySell, tickerPriceIndex, hints), 50);

        const tqqq = buildTickerSummaries(transactions, {}, 0, priceHistory)
            .find((summary) => summary.ticker === 'TQQQ');
        assert.ok(tqqq, 'expected TQQQ summary row');
        assert.ok(Math.abs(tqqq.shares) < 1e-9, `expected flat TQQQ, got ${tqqq.shares}`);
        assert.equal(tqqq.hasOpenPosition, false);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('split-adjusted TQQQ and NVDA history rescales authoritative imported quantities only when needed', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
        },
    };
    try {
        const priceHistory = normalizePriceHistoryPayload({
            TQQQ: [
                {date: '2025-11-18', close: 49.40},
                {date: '2025-11-20', close: 46.45},
            ],
            NVDA: [
                {date: '2023-04-11', close: 27.20},
                {date: '2024-06-10', close: 121.79},
            ],
        });
        const tickerPriceIndex = buildTickerPriceIndex(priceHistory);
        const makeTrade = ({ticker, date, quantity, price}) => ({
            type: 'buy',
            ticker,
            date,
            quantity_raw: String(quantity),
            quantity_abs: String(quantity),
            price_raw: String(price),
            normalized: {
                position_quantity: String(quantity),
                unit_price: String(price),
                net_amount: String(-quantity * price),
            },
        });
        const tqqqPreSplit = makeTrade({
            ticker: 'TQQQ',
            date: '2025-11-18',
            quantity: 10,
            price: 98.80,
        });
        const tqqqPostSplit = makeTrade({
            ticker: 'TQQQ',
            date: '2025-11-20',
            quantity: 10,
            price: 46.45,
        });
        const nvdaPreSplit = makeTrade({
            ticker: 'NVDA',
            date: '2023-04-11',
            quantity: 3,
            price: 272.00,
        });
        const nvdaPostSplit = makeTrade({
            ticker: 'NVDA',
            date: '2024-06-10',
            quantity: 3,
            price: 121.79,
        });

        assert.equal(getTransactionRenderedSplitFactor(tqqqPreSplit, tickerPriceIndex), 2);
        assert.equal(getTransactionValuationQuantity(tqqqPreSplit, tickerPriceIndex), 20);
        assert.equal(getTransactionValuationQuantity(tqqqPostSplit, tickerPriceIndex), 10);
        assert.equal(getTransactionRenderedSplitFactor(nvdaPreSplit, tickerPriceIndex), 10);
        assert.equal(getTransactionValuationQuantity(nvdaPreSplit, tickerPriceIndex), 30);
        assert.equal(getTransactionValuationQuantity(nvdaPostSplit, tickerPriceIndex), 3);

        const summaries = buildTickerSummaries(
            [tqqqPreSplit, nvdaPreSplit],
            {},
            0,
            priceHistory,
        );
        const tqqqSummary = summaries.find((summary) => summary.ticker === 'TQQQ');
        const nvdaSummary = summaries.find((summary) => summary.ticker === 'NVDA');
        assert.equal(tqqqSummary.shares, 20);
        assert.equal(nvdaSummary.shares, 30);
        assert.ok(Math.abs(tqqqSummary.averagePrice - 49.40) < 1e-9);
        assert.ok(Math.abs(nvdaSummary.averagePrice - 27.20) < 1e-9);

        const equityPoints = buildDailyEquityChartPoints([
            {
                date: '2025-11-18',
                aggregate_display_cash: 0,
                aggregate_holdings: {TQQQ: tqqqSummary.shares},
                aggregate_money_market_anchors: {},
            },
        ], priceHistory, new Set());
        const tqqqEquityPoint = equityPoints.find((point) => point.date === '2025-11-18');
        assert.equal(tqqqEquityPoint.aggregate_market_value, 988);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('reverse-split daily history preserves the actual SQQQ market value', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
        },
    };
    try {
        const priceHistory = normalizePriceHistoryPayload({
            SQQQ: [{date: '2024-08-22', close: 41.20}],
        });
        const tickerPriceIndex = buildTickerPriceIndex(priceHistory);
        const sqqqPreReverseSplit = {
            type: 'buy',
            ticker: 'SQQQ',
            date: '2024-08-22',
            quantity_raw: '120',
            quantity_abs: '120',
            price_raw: '8.24',
            normalized: {
                position_quantity: '120',
                unit_price: '8.24',
                net_amount: '-988.80',
            },
        };

        assert.equal(getTransactionRenderedSplitFactor(sqqqPreReverseSplit, tickerPriceIndex), 0.2);
        assert.equal(getTransactionValuationQuantity(sqqqPreReverseSplit, tickerPriceIndex), 24);

        const summaries = buildTickerSummaries([sqqqPreReverseSplit], {}, 0, priceHistory);
        const sqqq = summaries.find((summary) => summary.ticker === 'SQQQ');
        assert.ok(sqqq, 'expected SQQQ summary row');
        assert.equal(sqqq.shares, 24);

        const equityPoints = buildDailyEquityChartPoints([
            {
                date: '2024-08-22',
                aggregate_display_cash: 0,
                aggregate_holdings: {SQQQ: sqqq.shares},
                aggregate_money_market_anchors: {},
            },
        ], priceHistory, new Set());
        const equityPoint = equityPoints.find((point) => point.date === '2024-08-22');
        assert.ok(equityPoint, 'expected SQQQ equity point');
        assert.ok(Math.abs(equityPoint.aggregate_market_value - 988.8) < 1e-9);
        assert.ok(Math.abs(equityPoint.aggregate_total_equity - 988.8) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('earliest reverse-split evidence rescales SQQQ trades before local close history', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
        },
    };
    try {
        const priceHistory = normalizePriceHistoryPayload({
            SQQQ: [{date: '2024-01-19', close: 61.90}],
        });
        const tickerPriceIndex = buildTickerPriceIndex(priceHistory);
        const makeTrade = ({type, date, quantity, price}) => ({
            type,
            ticker: 'SQQQ',
            date,
            quantity_raw: String(quantity),
            quantity_abs: String(quantity),
            price_raw: String(price),
            normalized: {
                position_quantity: String(quantity),
                unit_price: String(price),
                net_amount: String((type === 'buy' ? -1 : 1) * quantity * price),
            },
        });
        const beforeHistoryPurchase = makeTrade({
            type: 'buy', date: '2023-11-03', quantity: 30, price: 19.65,
        });
        const firstObservedSale = makeTrade({
            type: 'sell', date: '2024-01-19', quantity: 30, price: 13.00,
        });
        const hints = buildRenderedSplitFactorHints(
            [beforeHistoryPurchase, firstObservedSale],
            tickerPriceIndex,
        );

        assert.equal(hints.get('SQQQ|2023-11-03'), 0.2);
        assert.equal(
            getTransactionValuationQuantity(beforeHistoryPurchase, tickerPriceIndex, hints),
            6,
        );
        assert.equal(
            getTransactionValuationQuantity(firstObservedSale, tickerPriceIndex, hints),
            6,
        );
        const sqqq = buildTickerSummaries(
            [beforeHistoryPurchase, firstObservedSale],
            {},
            0,
            priceHistory,
        ).find((summary) => summary.ticker === 'SQQQ');
        assert.ok(sqqq, 'expected SQQQ summary row');
        assert.ok(Math.abs(sqqq.shares) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('buildTickerSummaries attributes ledger-derived realized P&L to each transaction date', () => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}, money_market_tickers: []}};
    const transactions = [
        makeImportedTrade({type: 'buy', date: '2026-07-28', quantity: 2, price: 100}),
        makeImportedTrade({type: 'sell', date: '2026-07-29', quantity: 1, price: 112}),
        {
            type: 'dividend',
            date: '2026-07-29',
            ticker: 'TQQQ.US',
            currency: 'USD',
            normalized: {net_amount: '3.00'},
        },
    ];
    const summaries = buildTickerSummaries(transactions, {TQQQ: 115}, 0, {});
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');

    assert.ok(tqqq);
    assert.equal(tqqq.hasOpenPosition, true);
    assert.deepEqual(tqqq.realizedPnlByDateLocal, {'2026-07-29': 15});
    assert.deepEqual(tqqq.realizedPnlByDate, {'2026-07-29': 15});
});

test('buildTickerSummaries uses authoritative broker realized P&L for calibrated tickers', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: { performance_snapshot_authoritative: true },
            performance_snapshot: {
                TQQQ: { currency: 'USD', realized_total: '7.89' },
                SQQQ: { currency: 'USD', realized_total: '-2.22' },
            },
        },
    };
    const transactions = [
        makeImportedTrade({ type: 'buy', date: '2025-04-06', quantity: 1, price: 36 }),
        makeImportedTrade({ type: 'sell', date: '2025-05-12', quantity: 1, price: 66 }),
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');
    assert.equal(tqqq.realizedPnl, 7.89);
    assert.equal(tqqq.realizedPnlLocal, 7.89);
});

test('broker performance snapshots retain ledger-evidenced dividend income and withholding', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                ibkr: {
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        QQQI: {currency: 'USD', realized_total: '0'},
                    },
                },
            },
        },
    };
    const qqqiBuy = makeImportedTrade({type: 'buy', date: '2026-05-31', quantity: 5, price: 56.7});
    qqqiBuy.ticker = 'QQQI';
    qqqiBuy.broker = 'ibkr';
    const transactions = [
        qqqiBuy,
        {broker: 'ibkr', type: 'dividend', ticker: 'QQQI', date: '2026-06-18', normalized: {net_amount: '151.16'}},
        {broker: 'ibkr', type: 'foreign_tax_withholding', ticker: 'QQQI', date: '2026-06-18', normalized: {net_amount: '-15.12'}},
        {broker: 'ibkr', type: 'dividend', ticker: 'QQQI', date: '2026-07-24', normalized: {net_amount: '196.73'}},
        {broker: 'ibkr', type: 'foreign_tax_withholding', ticker: 'QQQI', date: '2026-07-24', normalized: {net_amount: '-19.67'}},
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const qqqi = summaries.find((summary) => summary.ticker === 'QQQI');

    assert.ok(qqqi);
    assert.ok(Math.abs(qqqi.realizedPnl - 313.1) < 1e-9);
    assert.ok(Math.abs(qqqi.realizedPnlLocal - 313.1) < 1e-9);
});

test('final broker performance calibrations do not add ticker cash adjustments twice', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                longbridge_hk: {
                    account: 'H99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        SQQQ: {
                            currency: 'USD',
                            realized_total: '-2.22',
                            realized_total_includes_nonperformance: true,
                        },
                    },
                },
            },
        },
    };
    const transactions = [
        {broker: 'longbridge_hk', account: 'H99999999', type: 'dividend', ticker: 'SQQQ', date: '2024-01-02', normalized: {net_amount: '12.60'}},
    ];
    const sqqq = buildTickerSummaries(transactions, {}, 0, {})[0];

    assert.equal(sqqq.realizedPnl, -2.22);
    assert.equal(sqqq.realizedPnlLocal, -2.22);
    assert.equal(sqqq.realizedPnlAccounts[0].source, 'broker_performance_snapshot');
});

test('aggregate ticker holdings keep in-kind transfer pairs cash-neutral', () => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_lineage: {}, money_market_tickers: []}};
    const qqqiBuy = makeImportedTrade({type: 'buy', date: '2026-07-01', quantity: 315, price: 56.7});
    qqqiBuy.ticker = 'QQQI';
    const transactions = [
        qqqiBuy,
        {broker: 'ibkr', type: 'transfer_out', ticker: 'QQQI', date: '2026-07-31', quantity: 5},
        {broker: 'schwab', type: 'transfer_in', ticker: 'QQQI', date: '2026-07-31', quantity: 5},
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const qqqi = summaries.find((summary) => summary.ticker === 'QQQI');

    assert.ok(qqqi);
    assert.equal(qqqi.shares, 315);
    assert.equal(qqqi.realizedPnl, 0);
});

test('buildTickerSummaries excludes correction cash from broker-reported ticker P&L', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: { performance_snapshot_authoritative: false },
        },
    };
    const transactions = [
        {
            type: 'dividend',
            date: '2025-01-01',
            ticker: 'TQQQ',
            normalized: { net_amount: '10.00' },
        },
        {
            type: 'adjustment',
            date: '2025-01-02',
            ticker: 'TQQQ',
            normalized: { net_amount: '2.75' },
            source: { excluded_from_broker_pnl: true },
        },
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');
    assert.equal(tqqq.realizedPnl, 10);
});

test('buildTickerSummaries keeps broker-scoped HK calibration additive with SG activity', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: { performance_snapshot_authoritative: false },
            broker_summaries: {
                longbridge_hk: {
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        TQQQ: { currency: 'USD', realized_total: '100.00' },
                    },
                },
                longbridge_sg: { account: 'SG99999999' },
            },
        },
    };
    const hkBuy = makeImportedTrade({ type: 'buy', date: '2025-01-01', quantity: 1, price: 36 });
    const hkSell = makeImportedTrade({ type: 'sell', date: '2025-01-02', quantity: 1, price: 66 });
    const sgBuy = makeImportedTrade({ type: 'buy', date: '2025-01-03', quantity: 1, price: 10 });
    const sgSell = makeImportedTrade({ type: 'sell', date: '2025-01-04', quantity: 1, price: 20 });
    hkBuy.broker = 'longbridge_hk';
    hkSell.broker = 'longbridge_hk';
    sgBuy.broker = 'longbridge_sg';
    sgSell.broker = 'longbridge_sg';
    const summaries = buildTickerSummaries([hkBuy, hkSell, sgBuy, sgSell], {}, 0, {});
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');
    assert.equal(tqqq.realizedPnl, 110);
    assert.equal(tqqq.realizedPnlLocal, 110);
});

test('buildTickerSummaries adds independent Longbridge HK and SG broker snapshots by ticker', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                longbridge_hk: {
                    account: 'H99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        NVDA: {currency: 'USD', realized_total: '-4.56', realized_total_includes_nonperformance: true},
                        TQQQ: {currency: 'USD', realized_total: '7.89', realized_total_includes_nonperformance: true},
                    },
                },
                longbridge_sg: {
                    account: 'SG99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        NVDA: {currency: 'USD', realized_total: '2.34', realized_total_includes_nonperformance: true},
                        TQQQ: {currency: 'USD', realized_total: '-1.11', realized_total_includes_nonperformance: true},
                    },
                },
            },
        },
    };

    const transactions = [
        {broker: 'longbridge_hk', account: 'H99999999', type: 'adjustment', ticker: 'NVDA', date: '2025-01-01', normalized: {net_amount: '0'}},
        {broker: 'longbridge_hk', account: 'H99999999', type: 'adjustment', ticker: 'TQQQ', date: '2025-01-01', normalized: {net_amount: '0'}},
        {broker: 'longbridge_sg', account: 'SG99999999', type: 'adjustment', ticker: 'NVDA', date: '2025-01-01', normalized: {net_amount: '0'}},
        {broker: 'longbridge_sg', account: 'SG99999999', type: 'adjustment', ticker: 'TQQQ', date: '2025-01-01', normalized: {net_amount: '0'}},
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const nvda = summaries.find((summary) => summary.ticker === 'NVDA');
    const tqqq = summaries.find((summary) => summary.ticker === 'TQQQ');

    assert.equal(nvda.realizedPnl, -2.22);
    assert.equal(tqqq.realizedPnl, 6.78);
    assert.deepEqual(
        nvda.realizedPnlAccounts.map(({broker, realizedPnlLocal}) => [broker, realizedPnlLocal]),
        [['longbridge_hk', -4.56], ['longbridge_sg', 2.34]],
    );
    assert.deepEqual(
        tqqq.realizedPnlAccounts.map(({broker, realizedPnlLocal}) => [broker, realizedPnlLocal]),
        [['longbridge_hk', 7.89], ['longbridge_sg', -1.11]],
    );
});

test('preserves the complete Longbridge HK and SG USD calibration set', () => {
    const hkCalibration = {
        TQQQ: 7.89,
        NVDA: -4.56,
        AAPL: 1.23,
    };
    const sgCalibration = {TQQQ: -1.11, NVDA: 2.34};
    const calibrationSnapshot = (values) => Object.fromEntries(
        Object.entries(values).map(([ticker, realizedTotal]) => [ticker, {
            currency: 'USD',
            realized_total: String(realizedTotal),
            realized_total_includes_nonperformance: true,
        }]),
    );
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {
                'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
                SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
            },
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                longbridge_hk: {
                    account: 'H99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: calibrationSnapshot(hkCalibration),
                },
                longbridge_sg: {
                    account: 'SG99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: calibrationSnapshot(sgCalibration),
                },
            },
        },
    };
    const anchor = (broker, account, ticker) => ({
        broker,
        account,
        ticker,
        type: 'adjustment',
        currency: 'USD',
        date: '2026-08-04',
        normalized: {net_amount: '0'},
    });
    const transactions = [
        ...Object.keys(hkCalibration).map((ticker) => anchor(
            'longbridge_hk',
            'H99999999',
            ticker,
        )),
        ...Object.keys(sgCalibration).map((ticker) => anchor(
            'longbridge_sg',
            'SG99999999',
            ticker,
        )),
    ];
    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const summaryByTicker = new Map(summaries.map((summary) => [summary.ticker, summary]));

    Object.entries(hkCalibration).forEach(([rawTicker, realizedTotal]) => {
        const ticker = rawTicker === 'SPLG' ? 'SPYM' : rawTicker;
        const summary = summaryByTicker.get(ticker);
        assert.ok(summary, `expected Longbridge HK calibration row for ${rawTicker}`);
        const hkAccount = summary.realizedPnlAccounts.find(
            (accountResult) => accountResult.broker === 'longbridge_hk',
        );
        assert.ok(hkAccount, `expected Longbridge HK account result for ${rawTicker}`);
        assert.equal(hkAccount.realizedPnlLocal, realizedTotal);
        assert.equal(hkAccount.source, 'broker_performance_snapshot');
    });
    Object.entries(sgCalibration).forEach(([ticker, realizedTotal]) => {
        const summary = summaryByTicker.get(ticker);
        const sgAccount = summary.realizedPnlAccounts.find(
            (accountResult) => accountResult.broker === 'longbridge_sg',
        );
        assert.equal(sgAccount.realizedPnlLocal, realizedTotal);
        assert.equal(sgAccount.source, 'broker_performance_snapshot');
    });
    assert.equal(summaryByTicker.get('TQQQ').realizedPnlLocal, 6.78);
    assert.equal(summaryByTicker.get('NVDA').realizedPnlLocal, -2.22);
    assert.equal(
        Number(Object.values(hkCalibration).reduce((sum, value) => sum + value, 0).toFixed(2)),
        4.56,
    );
    assert.equal(
        Number(Object.values(sgCalibration).reduce((sum, value) => sum + value, 0).toFixed(2)),
        1.23,
    );
});

test('authoritative Longbridge HK signs aggregate with independently evidenced accounts', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {
                'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
                SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
            },
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                longbridge_hk: {
                    account: 'H99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        AAPL: {currency: 'USD', realized_total: '1.23', realized_total_includes_nonperformance: true},
                        JPM: {currency: 'USD', realized_total: '-0.58', realized_total_includes_nonperformance: true},
                        MSFT: {currency: 'USD', realized_total: '-1.25', realized_total_includes_nonperformance: true},
                        QQQ: {currency: 'USD', realized_total: '2.69', realized_total_includes_nonperformance: true},
                        SPLG: {currency: 'USD', realized_total: '-0.77', realized_total_includes_nonperformance: true},
                        SQQQ: {currency: 'USD', realized_total: '-2.22', realized_total_includes_nonperformance: true},
                        TSM: {currency: 'USD', realized_total: '-4.46', realized_total_includes_nonperformance: true},
                    },
                },
                ibkr: {
                    account: 'U00000001',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        MSFT: {currency: 'USD', realized_total: '2.29074603'},
                    },
                },
            },
        },
    };
    const trade = ({broker, account, ticker, type, date, quantity, netAmount, brokerRealizedPnl}) => ({
        broker,
        account,
        ticker,
        type,
        date,
        datetime: `${date} 12:00:00`,
        currency: 'USD',
        quantity_abs: quantity === undefined ? undefined : String(quantity),
        normalized: {
            net_amount: String(netAmount),
            position_quantity: quantity === undefined ? undefined : String(quantity),
            ...(brokerRealizedPnl === undefined
                ? {}
                : {broker_realized_pnl: String(brokerRealizedPnl)}),
        },
    });
    const longbridgeAnchor = (ticker) => trade({
        broker: 'longbridge_hk', account: 'H99999999', ticker,
        type: 'adjustment', date: '2026-07-31', netAmount: 0,
    });
    const transactions = [
        ...['AAPL', 'JPM', 'MSFT', 'QQQ', 'SPLG', 'SQQQ', 'TSM'].map(longbridgeAnchor),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'AAPL', type: 'buy', date: '2023-02-07', quantity: 2, netAmount: -301.32}),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'AAPL', type: 'sell', date: '2023-03-03', quantity: 2, netAmount: 300}),
        trade({broker: 'tigertrade', account: '4556114', ticker: 'AAPL', type: 'buy', date: '2025-01-24', quantity: 2, netAmount: -448.98}),
        trade({broker: 'tigertrade', account: '4556114', ticker: 'AAPL', type: 'sell', date: '2025-01-27', quantity: 2, netAmount: 459.01}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'MSFT', type: 'buy', date: '2023-02-16', quantity: 4, netAmount: -1062}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'MSFT', type: 'sell', date: '2023-03-22', quantity: 4, netAmount: 1091.98}),
        trade({broker: 'ibkr', account: 'U00000001', ticker: 'MSFT', type: 'dividend', date: '2026-03-12', netAmount: 13.10}),
        trade({broker: 'ibkr', account: 'U00000001', ticker: 'MSFT', type: 'dividend', date: '2026-06-11', netAmount: 4.09}),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'TSM', type: 'sell', date: '2023-02-28', quantity: 29, netAmount: 2553.45, brokerRealizedPnl: 98.74}),
        trade({broker: 'usmart_hk', account: '94412536', ticker: 'TSM', type: 'sell', date: '2023-02-18', quantity: 2, netAmount: 177.30, brokerRealizedPnl: -2.59}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'TSM', type: 'sell', date: '2023-03-22', quantity: 1, netAmount: 92.49, brokerRealizedPnl: 2.50}),
        trade({broker: 'tigertrade', account: '4556114', ticker: 'TSM', type: 'sell', date: '2024-12-23', quantity: 2, netAmount: 412.21, brokerRealizedPnl: 4.55}),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'SPYM', type: 'sell', date: '2023-02-16', quantity: 1, netAmount: 1, brokerRealizedPnl: 67.21}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'SPYM', type: 'sell', date: '2023-03-20', quantity: 1, netAmount: 1, brokerRealizedPnl: -25.48}),
        trade({broker: 'zircon_hk', account: '57812160', ticker: 'SPYM', type: 'sell', date: '2025-01-15', quantity: 1, netAmount: 1, brokerRealizedPnl: -4.23}),
    ];

    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const realized = Object.fromEntries(summaries.map((summary) => [summary.ticker, summary.realizedPnl]));

    assert.equal(realized.AAPL, 9.94);
    assert.ok(Math.abs(realized.MSFT - 48.21074603) < 1e-9);
    assert.equal(realized.TSM, 98.74);
    assert.equal(realized.JPM, -0.58);
    assert.equal(realized.QQQ, 2.69);
    assert.equal(realized.SQQQ, -2.22);
    assert.equal(realized.SPYM, 36.73);
    const aapl = summaries.find((summary) => summary.ticker === 'AAPL');
    const aaplByBroker = Object.fromEntries(
        aapl.realizedPnlAccounts.map(({broker, realizedPnlLocal}) => [broker, realizedPnlLocal]),
    );
    assert.deepEqual(aaplByBroker, {
        cmbwl: -1.32,
        longbridge_hk: 1.23,
        tigertrade: 10.03,
    });
    const spym = summaries.find((summary) => summary.ticker === 'SPYM');
    const spymByBroker = Object.fromEntries(
        spym.realizedPnlAccounts.map(({broker, realizedPnlLocal}) => [broker, realizedPnlLocal]),
    );
    assert.ok(Math.abs(
        spymByBroker.cmbwl + spymByBroker.futuhk + spymByBroker.longbridge_hk - 40.96,
    ) < 1e-9);
    assert.equal(spymByBroker.zircon_hk, -4.23);
});

test('tax-lot replay uses broker execution chronology instead of same-time cash ordering', () => {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {},
        },
    };
    const transactions = [
        {
            broker: 'longbridge_hk', account: 'H99999999', type: 'sell', ticker: '8420.HK',
            date: '2023-03-02', datetime: '2023-03-02 20:00:00', currency: 'HKD',
            quantity_abs: '5000', price_raw: '0.0620',
            normalized: {position_quantity: '5000', unit_price: '0.0620', net_amount: '291.96'},
            source: {history_order_datetime: '2023-03-02 07:45:06', row_number: 6811},
        },
        {
            broker: 'longbridge_hk', account: 'H99999999', type: 'buy', ticker: '8420.HK',
            date: '2023-03-02', datetime: '2023-03-02 20:00:00', currency: 'HKD',
            quantity_abs: '5000', price_raw: '0.0690',
            normalized: {position_quantity: '5000', unit_price: '0.0690', net_amount: '-363.04'},
            source: {history_order_datetime: '2023-03-02 07:32:03', row_number: 6812},
        },
        {
            broker: 'usmart_hk', account: '94412536', type: 'sell', ticker: 'HIBS',
            date: '2023-02-18', datetime: '2023-02-18 20:00:00', currency: 'USD',
            quantity_abs: '1', price_raw: '4.5600',
            normalized: {position_quantity: '1', unit_price: '4.5600', net_amount: '2.65'},
            source: {row_number: 89},
        },
        {
            broker: 'usmart_hk', account: '94412536', type: 'buy', ticker: 'HIBS',
            date: '2023-02-18', datetime: '2023-02-18 20:00:00', currency: 'USD',
            quantity_abs: '1', price_raw: '4.5700',
            normalized: {position_quantity: '1', unit_price: '4.5700', net_amount: '-6.46'},
            source: {row_number: 74},
        },
    ];

    const summaries = buildTickerSummaries(transactions, {}, 0, {});
    const nexion = summaries.find((summary) => summary.ticker === '8420.HK');
    const hibs = summaries.find((summary) => summary.ticker === 'HIBS');

    assert.equal(nexion.realizedPnlStatus, 'complete');
    assert.equal(nexion.realizedPnlLocal, -71.08);
    assert.equal(nexion.realizedPnlAccounts[0].source, 'account_tax_lot_reconstruction');
    assert.equal(hibs.realizedPnlStatus, 'complete');
    assert.equal(hibs.realizedPnlLocal, -3.81);
    assert.equal(hibs.realizedPnlAccounts[0].source, 'account_tax_lot_reconstruction');
});

function makeGooglTrade({broker, account, type, date, quantity, price, netAmount, commission = 0}) {
    return {
        broker,
        account,
        type,
        ticker: 'GOOGL',
        currency: 'USD',
        date,
        datetime: `${date} 20:00:00`,
        quantity_abs: String(quantity),
        price_raw: String(price),
        commission_raw: String(commission),
        normalized: {
            position_quantity: String(quantity),
            unit_price: String(price),
            net_amount: String(netAmount),
            commission: String(commission),
        },
        source: {
            file_kind: broker === 'hsbc' ? 'hsbc_order_status_text' : 'test_fixture',
        },
    };
}

function setVerifiedGooglTestWindow() {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {
                hsbc: {
                    account: '000-999999-999',
                    tax_lot_history_verifications: {
                        GOOGL: {
                            currency: 'USD',
                            verified_through: '2026-07-31',
                            buy_count: 4,
                            sell_count: 2,
                            buy_quantity: '4',
                            sell_quantity: '4',
                            calculation_method: 'trade_price_and_commission',
                            verification_source: 'user_verified_complete_standard_export',
                        },
                    },
                },
                ibkr: {
                    account: 'U00000001',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        GOOGL: {currency: 'USD', realized_total: '252.68816032'},
                    },
                },
                longbridge_hk: {
                    account: 'H99999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        GOOGL: {
                            currency: 'USD',
                            realized_total: '112.71',
                            realized_total_includes_nonperformance: true,
                        },
                    },
                },
            },
        },
    };
}

const verifiedHsbcGooglTrades = [
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-06-22', quantity: 1, price: 343, netAmount: -343}),
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-06-22', quantity: 1, price: 348.5, netAmount: -348.44}),
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-06-22', quantity: 1, price: 347, netAmount: -347}),
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-06-29', quantity: 3, price: 348.8, netAmount: 1046.37, commission: -0.01}),
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-07-23', quantity: 1, price: 318.92, netAmount: -318.92}),
    makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-07-27', quantity: 1, price: 327, netAmount: 326.99, commission: -0.01}),
];

test('user-confirmed CMB round trip and verified HSBC GOOGL history aggregate to 414.81', () => {
    setVerifiedGooglTestWindow();
    const transactions = [
        makeGooglTrade({broker: 'cmbwl', account: '688-2-XXXX3-2', type: 'buy', date: '2023-01-11', quantity: 5, price: 90.15, netAmount: -450.75}),
        makeGooglTrade({broker: 'cmbwl', account: '688-2-XXXX3-2', type: 'sell', date: '2023-01-20', quantity: 5, price: 95, netAmount: 475}),
        makeGooglTrade({broker: 'longbridge_hk', account: 'H99999999', type: 'buy', date: '2023-03-01', quantity: 1, price: 90, netAmount: -90}),
        makeGooglTrade({broker: 'longbridge_hk', account: 'H99999999', type: 'sell', date: '2023-03-02', quantity: 1, price: 90, netAmount: 90}),
        {broker: 'ibkr', account: 'U00000001', type: 'dividend', ticker: 'GOOGL', currency: 'USD', date: '2026-03-16', normalized: {net_amount: '2.52'}},
        {broker: 'ibkr', account: 'U00000001', type: 'foreign_tax_withholding', ticker: 'GOOGL', currency: 'USD', date: '2026-03-16', normalized: {net_amount: '-0.25'}},
        {broker: 'ibkr', account: 'U00000001', type: 'dividend', ticker: 'GOOGL', currency: 'USD', date: '2026-06-15', normalized: {net_amount: '7.70'}},
        {broker: 'ibkr', account: 'U00000001', type: 'foreign_tax_withholding', ticker: 'GOOGL', currency: 'USD', date: '2026-06-15', normalized: {net_amount: '-0.77'}},
        ...verifiedHsbcGooglTrades,
    ];
    const googl = buildTickerSummaries(transactions, {}, 0, {})[0];
    const byBroker = Object.fromEntries(
        googl.realizedPnlAccounts.map((result) => [result.broker, result]),
    );

    assert.equal(byBroker.cmbwl.realizedPnlLocal, 24.25);
    assert.equal(byBroker.cmbwl.status, 'complete');
    assert.equal(byBroker.cmbwl.source, 'account_tax_lot_reconstruction');
    assert.equal(byBroker.longbridge_hk.realizedPnlLocal, 112.71);
    assert.equal(byBroker.longbridge_hk.status, 'complete');
    assert.equal(byBroker.longbridge_hk.source, 'broker_performance_snapshot');
    assert.equal(byBroker.ibkr.realizedPnlLocal, 261.88816032);
    assert.equal(byBroker.ibkr.status, 'complete');
    assert.equal(byBroker.ibkr.source, 'broker_performance_snapshot');
    assert.equal(byBroker.hsbc.realizedPnlLocal, 15.96);
    assert.equal(byBroker.hsbc.status, 'complete');
    assert.equal(byBroker.hsbc.source, 'account_tax_lot_reconstruction');
    assert.equal(
        byBroker.hsbc.taxLotHistoryVerification.verificationSource,
        'user_verified_complete_standard_export',
    );
    assert.ok(Math.abs(googl.realizedPnl - 414.80816032) < 1e-9);
    assert.equal(formatHoldingsMoney(googl.realizedPnl), '414.81');
});

test('verified tax-lot metadata fails closed when later trades exceed the attested scope', () => {
    setVerifiedGooglTestWindow();
    const transactions = [
        ...verifiedHsbcGooglTrades,
        makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-03', quantity: 1, price: 330, netAmount: -330}),
        makeGooglTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-04', quantity: 1, price: 331, netAmount: 331}),
    ];
    const googl = buildTickerSummaries(transactions, {}, 0, {})[0];

    assert.equal(googl.realizedPnl, null);
    assert.equal(googl.realizedPnlAccounts[0].status, 'unverified');
    assert.equal(googl.realizedPnlAccounts[0].taxLotHistoryVerification, null);
});

function makeScopedDramTrade({
    broker,
    account,
    type,
    date,
    quantity,
    price,
    brokerRealizedPnl,
    commission = 0,
    fileKind = 'test_fixture',
    ticker = 'DRAM',
}) {
    const grossAmount = quantity * price;
    const netAmount = type === 'buy'
        ? -(grossAmount + Math.abs(commission))
        : grossAmount - Math.abs(commission);
    const normalized = {
        position_quantity: String(quantity),
        unit_price: String(price),
        net_amount: String(netAmount),
        commission: String(commission),
    };
    if (brokerRealizedPnl !== undefined) {
        normalized.broker_realized_pnl = String(brokerRealizedPnl);
    }
    return {
        broker,
        account,
        type,
        ticker,
        currency: 'USD',
        date,
        datetime: `${date} 12:00:00`,
        quantity_abs: String(quantity),
        quantity_raw: String(type === 'sell' ? -quantity : quantity),
        price_raw: String(price),
        commission_raw: String(commission),
        normalized,
        source: {file_kind: fileKind},
    };
}

function setDramTestWindow() {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {},
        },
    };
}

function setCostBasisMethod(method) {
    globalThis.window.WORTHWARD_INVESTMENT_DATA.investment_cost_basis_method = method;
}

const ibkrDramClosedTrades = [
    makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-06-11', quantity: 15, price: 61, commission: -0.35107625, brokerRealizedPnl: 224.700059}),
    makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-07-21', quantity: 15, price: 57, commission: -0.34984025, brokerRealizedPnl: 84.064943}),
    makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-07-23', quantity: 5, price: 59.25, commission: -0.35035, brokerRealizedPnl: 50.718507}),
    makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-07-23', quantity: 5, price: 59, commission: -0.35032425, brokerRealizedPnl: 49.468532}),
];

test('lowest-cost lot matching is the default and keeps the remaining cost basis exact', () => {
    setDramTestWindow();
    delete globalThis.window.WORTHWARD_INVESTMENT_DATA.investment_cost_basis_method;
    assert.equal(getInvestmentCostBasisMethod(), 'lowest_cost_first');
    const transactions = [
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-01', quantity: 5, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02', quantity: 1, price: 50}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-03', quantity: 1, price: 120}),
    ];
    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 100, {})[0];
    assert.equal(dram.realizedPnlLocal, 70);
    assert.equal(dram.shares, 5);
    assert.equal(dram.totalCost, 500);
    assert.equal(dram.averagePrice, 100);
    assert.equal(dram.lotMatchingMethod, 'lowest_cost_first');
});

test('an invalid refreshed payload preserves the valid server-rendered method', () => {
    setDramTestWindow();
    globalThis.window.WORTHWARD_INVESTMENT_DATA.investment_cost_basis_method = 'FIFO reconstructed';
    globalThis.window.WORTHWARD_APP = {investmentCostBasisMethod: 'lifo'};
    assert.equal(getInvestmentCostBasisMethod(), 'lifo');

    globalThis.window.WORTHWARD_INVESTMENT_DATA.investment_cost_basis_method = 'moving_average';
    assert.equal(getInvestmentCostBasisMethod(), 'moving_average');
});

test('Settings lot-matching choices use the same replay engine', () => {
    const transactions = [
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-01', quantity: 5, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02', quantity: 1, price: 50}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-03', quantity: 1, price: 120}),
    ];
    const expected = {
        lowest_cost_first: {realized: 70, totalCost: 500, averagePrice: 100},
        fifo: {realized: 20, totalCost: 450, averagePrice: 90},
        lifo: {realized: 70, totalCost: 500, averagePrice: 100},
        moving_average: {
            realized: 120 - ((5 * 100 + 50) / 6),
            totalCost: (5 * 100 + 50) - ((5 * 100 + 50) / 6),
            averagePrice: (5 * 100 + 50) / 6,
        },
    };
    for (const [method, values] of Object.entries(expected)) {
        setDramTestWindow();
        setCostBasisMethod(method);
        const summary = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];
        assert.ok(Math.abs(summary.realizedPnlLocal - values.realized) < 1e-9, `${method} realized`);
        assert.ok(Math.abs(summary.totalCost - values.totalCost) < 1e-9, `${method} total cost`);
        assert.ok(Math.abs(summary.averagePrice - values.averagePrice) < 1e-9, `${method} average price`);
        assert.equal(summary.lotMatchingMethod, method);
    }
});

test('zero-cost grant lots remain open after FIFO sells remove paid lots', () => {
    setDramTestWindow();
    setCostBasisMethod('fifo');
    const transactions = [
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-01', quantity: 5, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'grant', date: '2026-08-02', quantity: 10, price: 0}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-03', quantity: 5, price: 120}),
    ];
    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];
    assert.equal(dram.shares, 10);
    assert.equal(dram.totalCost, 0);
    assert.equal(dram.averagePrice, 0);
    assert.equal(dram.realizedPnlLocal, 100);
    assert.equal(dram.unrealizedPnlLocal, 1200);
    assert.equal(dram.totalPnlLocal, 1300);
});

test('IBKR stock grants retain zero-cost lots while paid IBKR buys retain their cost', () => {
    setDramTestWindow();
    const ibkrGrant = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'grant', date: '2026-08-02',
        ticker: 'IBKR', quantity: 3.25, price: 64.25,
    });
    ibkrGrant.normalized.net_amount = '0';
    const transactions = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            ticker: 'IBKR', quantity: 1, price: 75.5, commission: 0.25,
        }),
        ibkrGrant,
    ];

    const ibkr = buildTickerSummaries(transactions, {IBKR: 92.19}, 0, {})[0];
    const expectedTotalCost = 75.75;

    assert.equal(ibkr.shares, 4.25);
    assert.equal(ibkr.buyCount, 1);
    assert.ok(Math.abs(ibkr.totalCost - expectedTotalCost) < 1e-9);
    assert.ok(Math.abs(ibkr.averagePrice - (expectedTotalCost / 4.25)) < 1e-9);
    assert.ok(Math.abs(ibkr.unrealizedPnlLocal - ((4.25 * 92.19) - expectedTotalCost)) < 1e-9);
});

test('unknown transfer-in preserves existing lot order for subsequent FIFO sells', () => {
    setDramTestWindow();
    setCostBasisMethod('fifo');
    const unknownTransfer = makeScopedDramTrade({
        broker: 'hsbc', account: '000-999999-999', type: 'transfer_in',
        date: '2026-08-03', quantity: 5, price: 0,
    });
    unknownTransfer.carried_cost_basis_status = 'unknown';
    const transactions = [
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-01', quantity: 5, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02', quantity: 5, price: 50}),
        unknownTransfer,
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-04', quantity: 5, price: 120}),
    ];
    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];

    assert.equal(dram.realizedPnlLocal, 100);
    assert.equal(dram.shares, 10);
    assert.equal(dram.totalCost, 250);
    assert.equal(dram.averagePrice, 25);
    assert.equal(dram.unrealizedPnlLocal, 950);
    assert.equal(dram.totalPnlLocal, 1050);
    assert.equal(dram.costBasisStatus, 'unknown');
});

test('cross-account sells consume only their account lots before ticker aggregation', () => {
    setDramTestWindow();
    setCostBasisMethod('lowest_cost_first');
    const transactions = [
        makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01', quantity: 10, price: 50}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02', quantity: 10, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-03', quantity: 5, price: 120}),
    ];
    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];
    const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');
    assert.equal(hsbc.realizedPnlLocal, 100);
    assert.equal(dram.shares, 15);
    assert.equal(dram.totalCost, 1000);
    assert.ok(Math.abs(dram.averagePrice - (1000 / 15)) < 1e-9);
    assert.equal(dram.realizedPnlLocal, 100);
    assert.ok(Math.abs(dram.unrealizedPnlLocal - 800) < 1e-9);
    assert.ok(Math.abs(dram.totalPnlLocal - 900) < 1e-9);
});

test('same-ticker positions in multiple currencies do not fabricate a combined cost basis', () => {
    setDramTestWindow();
    const transactions = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            quantity: 1, price: 50,
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02',
            quantity: 1, price: 780,
        }),
    ];
    transactions[1].currency = 'HKD';
    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 100, {})[0];

    assert.equal(dram.shares, 2);
    assert.equal(dram.positionCurrencies.join(','), 'HKD,USD');
    assert.equal(dram.hasMixedPositionCurrencies, true);
    assert.equal(dram.totalCost, null);
    assert.equal(dram.averagePrice, null);
    assert.equal(dram.marketValue, null);
    assert.equal(dram.unrealizedPnl, null);
    assert.equal(dram.totalPnl, null);
    assert.equal(dram.pnlUnavailable, true);
    assert.equal(dram.pnlUnavailableReason, 'multiple_position_currencies');
    assert.equal(dram.costBasisUnavailable, true);
    assert.equal(dram.positionWeight, null);

    const mixedWithRealized = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            quantity: 2, price: 50,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-02',
            quantity: 1, price: 60,
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-03',
            quantity: 1, price: 780,
        }),
    ];
    mixedWithRealized[2].currency = 'HKD';
    const mixedWithRealizedSummary = buildTickerSummaries(
        mixedWithRealized,
        {DRAM: 120},
        100,
        {},
    )[0];
    const ibkrRealized = mixedWithRealizedSummary.realizedPnlAccounts.find(
        (result) => result.broker === 'ibkr',
    );
    assert.equal(mixedWithRealizedSummary.pnlUnavailable, true);
    assert.equal(mixedWithRealizedSummary.realizedPnl, null);
    assert.equal(mixedWithRealizedSummary.realizedPnlBreakdownAvailable, true);
    assert.equal(ibkrRealized.realizedPnlLocal, 10);
    assert.equal(ibkrRealized.realizedPnl, 10);

    globalThis.window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        longbridge_hk: {
            account: 'H99999999',
            performance_snapshot_authoritative: true,
            performance_snapshot: {
                DRAM: {currency: 'USD', realized_total: '7.89'},
            },
        },
    };
    const calibratedTransactions = [
        makeScopedDramTrade({
            broker: 'longbridge_hk', account: 'H99999999', type: 'buy', date: '2026-08-01',
            quantity: 1, price: 50,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-02',
            quantity: 1, price: 780,
        }),
    ];
    calibratedTransactions[1].currency = 'HKD';
    const calibrated = buildTickerSummaries(calibratedTransactions, {DRAM: 120}, 0, {})[0];
    assert.equal(calibrated.realizedPnlLocal, 7.89);
    assert.equal(calibrated.realizedPnlAccounts[0].source, 'broker_performance_snapshot');
    assert.equal(calibrated.pnlUnavailable, false);
    assert.equal(calibrated.costBasisUnavailable, true);
    assert.equal(calibrated.unrealizedPnl, null);
    assert.equal(calibrated.totalPnl, null);
});

test('every sell-matching method conserves realized plus unrealized P&L', () => {
    const transactions = [
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-01', quantity: 10, price: 100}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-02', quantity: 5, price: 50}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-03', quantity: 5, price: 80}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-04', quantity: 8, price: 120}),
    ];
    const expected = {
        lowest_cost_first: [470, 280],
        fifo: [160, 590],
        lifo: [410, 340],
        moving_average: [300, 450],
    };
    for (const [method, [realized, unrealized]] of Object.entries(expected)) {
        setDramTestWindow();
        setCostBasisMethod(method);
        const dram = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];
        assert.ok(Math.abs(dram.realizedPnlLocal - realized) < 1e-9, `${method} realized`);
        assert.ok(Math.abs(dram.unrealizedPnlLocal - unrealized) < 1e-9, `${method} unrealized`);
        assert.ok(Math.abs(dram.totalPnlLocal - 750) < 1e-9, `${method} total`);
    }
});

test('IBKR DRAM closed trades sum exact broker-provided realized P&L and format to two decimals', () => {
    setDramTestWindow();
    const dram = buildTickerSummaries(ibkrDramClosedTrades, {}, 0, {})[0];
    assert.equal(dram.realizedPnl, 408.952041);
    assert.equal(dram.realizedPnlLocal, 408.952041);
    assert.equal(formatHoldingsMoney(dram.realizedPnl), '408.95');
    assert.equal(dram.realizedPnlAccounts[0].source, 'broker_closed_trades');
    assert.deepEqual(dram.realizedPnlByDateLocal, {
        '2026-06-11': 224.700059,
        '2026-07-21': 84.064943,
        '2026-07-23': 100.187039,
    });
});

test('IBKR stale realized snapshot adds later web fills from the position boundary', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        ibkr: {
            broker: 'ibkr',
            account: 'U00000001',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-12',
            position_snapshot: {
                DRAM: {
                    quantity: '100',
                    cost_price: '50.20691954',
                    cost_basis: '5020.691954',
                    cost_basis_status: 'known',
                    as_of: '2026-08-12 20:20:00',
                },
            },
            performance_snapshot_authoritative: true,
            performance_snapshot: {
                DRAM: {
                    currency: 'USD',
                    realized_total: '408.952041',
                },
            },
        },
    };
    const webSale = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-12',
        quantity: 10, price: 55.65, commission: -0.35, fileKind: 'ibkr_web_trade_notification',
    });
    webSale.datetime = '2026-08-12 21:56:00';
    webSale.normalized.net_amount = '556.15';
    const unrelatedTickerTrade = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-12',
        quantity: 1, price: 20, ticker: 'QQQI',
    });
    unrelatedTickerTrade.datetime = '2026-08-12 21:57:00';

    const fifoLots = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            quantity: 10, price: 53.033628725,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-02',
            quantity: 90, price: 49,
        }),
    ];

    const dram = buildTickerSummaries([...fifoLots, webSale, unrelatedTickerTrade], {}, 0, {})
        .find((summary) => summary.ticker === 'DRAM');
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');
    const expectedIncrementalPnl = 556.15 - (10 * 53.033628725);
    const expectedTotalPnl = 408.952041 + expectedIncrementalPnl;

    assert.ok(Math.abs(ibkr.realizedPnlLocal - expectedTotalPnl) < 1e-9);
    assert.equal(ibkr.source, 'broker_performance_snapshot_plus_boundary_replay');
    assert.equal(ibkr.reconstructedPositionCostBasisMethod, 'FIFO reconstructed');
    assert.ok(Math.abs(dram.realizedPnlLocal - expectedTotalPnl) < 1e-9);
    assert.ok(Math.abs(dram.realizedPnlByDateLocal['2026-08-12'] - expectedIncrementalPnl) < 1e-9);
});

test('IBKR stale realized snapshot replays fills after its own as-of date when positions are newer', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        ibkr: {
            broker: 'ibkr',
            account: 'U00000001',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-13',
            position_snapshot: {
                DRAM: {
                    quantity: '90',
                    cost_price: '49',
                    cost_basis: '4410',
                    cost_basis_status: 'known',
                    as_of: '2026-08-13 23:59:59',
                },
            },
            performance_snapshot_authoritative: true,
            performance_snapshot: {
                DRAM: {
                    currency: 'USD',
                    realized_total: '408.952041',
                },
            },
        },
    };
    window.WORTHWARD_INVESTMENT_DATA.broker_snapshots = {
        'ibkr:U00000001': {
            broker: 'ibkr',
            account: 'U00000001',
            performance_snapshot_authoritative: true,
            performance_snapshot_as_of: '2026-08-11',
            performance_snapshot: {
                DRAM: {
                    currency: 'USD',
                    realized_total: '408.952041',
                },
            },
        },
    };
    const laterSale = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-12',
        quantity: 10, price: 55.65, commission: -0.35, fileKind: 'ibkr_gainskeeper',
    });
    laterSale.datetime = '2026-08-12 21:56:00';
    laterSale.normalized.net_amount = '556.15';
    const fifoLots = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            quantity: 10, price: 53.033628725,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-02',
            quantity: 90, price: 49,
        }),
    ];

    const dram = buildTickerSummaries([...fifoLots, laterSale], {}, 0, {})
        .find((summary) => summary.ticker === 'DRAM');
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');
    const expectedIncrementalPnl = 556.15 - (10 * 49);
    const expectedTotalPnl = 408.952041 + expectedIncrementalPnl;

    assert.ok(Math.abs(ibkr.realizedPnlLocal - expectedTotalPnl) < 1e-9);
    assert.equal(ibkr.source, 'broker_performance_snapshot_plus_boundary_replay');
    assert.ok(Math.abs(dram.realizedPnlLocal - expectedTotalPnl) < 1e-9);
    assert.ok(Math.abs(dram.realizedPnlByDateLocal['2026-08-12'] - expectedIncrementalPnl) < 1e-9);
});

test('IBKR stale realized snapshot accepts a rounded same-day position boundary', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        ibkr: {
            broker: 'ibkr',
            account: 'U00000001',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-18',
            position_snapshot: {
                DRAM: {
                    quantity: '95',
                    cost_price: '50.26315789',
                    cost_basis_status: 'known',
                    as_of: '2026-08-18 05:00:00',
                },
            },
            performance_snapshot_authoritative: true,
            performance_snapshot_as_of: '2026-08-14',
            performance_snapshot: {
                DRAM: {
                    currency: 'USD',
                    realized_total: '0',
                },
            },
        },
    };
    const buy = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
        quantity: 100, price: 50,
    });
    const sell = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-17',
        quantity: 10, price: 60,
    });
    const sameDayBuy = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-18',
        quantity: 5, price: 55,
    });
    sameDayBuy.datetime = '2026-08-18 05:00:47';

    const dram = buildTickerSummaries([buy, sell, sameDayBuy], {}, 0, {})[0];
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');

    assert.equal(ibkr.status, 'complete');
    assert.equal(ibkr.source, 'broker_performance_snapshot_plus_boundary_replay');
    assert.equal(ibkr.reconstructedPositionShares, 95);
    assert.ok(Math.abs(ibkr.realizedPnlLocal - 100) < 1e-9);
    assert.ok(Math.abs(dram.realizedPnlLocal - 100) < 1e-9);
});

test('HSBC DRAM buys never enter the IBKR realized P&L scope', () => {
    setDramTestWindow();
    const transactions = [
        makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-05-01', quantity: 40, price: 45}),
        ...ibkrDramClosedTrades,
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-06-16', quantity: 100, price: 70}),
    ];
    const dram = buildTickerSummaries(transactions, {}, 0, {})[0];
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');
    const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');
    assert.equal(ibkr.realizedPnlLocal, 408.952041);
    assert.equal(hsbc.realizedPnlLocal, 0);
    assert.equal(dram.realizedPnlLocal, 408.952041);
});

test('two brokers with DRAM sells calculate independently before display aggregation', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.summary.performance_snapshot_authoritative = true;
    window.WORTHWARD_INVESTMENT_DATA.performance_snapshot = {
        DRAM: {currency: 'USD', realized_total: '999.99'},
    };
    const transactions = [
        makeScopedDramTrade({broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-07-21', quantity: 15, price: 57, brokerRealizedPnl: 408.952041}),
        makeScopedDramTrade({broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-07-21', quantity: 15, price: 57, brokerRealizedPnl: 12.125}),
    ];
    const dram = buildTickerSummaries(transactions, {}, 0, {})[0];
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');
    const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');
    assert.equal(ibkr.realizedPnlLocal, 408.952041);
    assert.equal(hsbc.realizedPnlLocal, 12.125);
    assert.equal(dram.realizedPnlLocal, ibkr.realizedPnlLocal + hsbc.realizedPnlLocal);
});

test('DRAM preserves the three-broker position and realized P&L scopes', () => {
    setDramTestWindow();
    const schwabTransferIn = makeScopedDramTrade({
        broker: 'schwab', account: 'Individual ...001', type: 'transfer_in',
        date: '2026-08-03', quantity: 195, price: 0,
    });
    schwabTransferIn.carried_cost_basis_raw = '10000';
    schwabTransferIn.carried_cost_basis_status = 'known';
    schwabTransferIn.carried_cost_basis_method_label = 'FIFO reconstructed';
    const transactions = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-05-01',
            quantity: 145, price: 50,
        }),
        ...ibkrDramClosedTrades,
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-06-01',
            quantity: 210, price: 50,
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-01',
            quantity: 10, price: 56.258,
        }),
        schwabTransferIn,
    ];

    const dram = buildTickerSummaries(transactions, {DRAM: 70}, 0, {})[0];
    const realizedByBroker = Object.fromEntries(
        dram.realizedPnlAccounts.map((result) => [result.broker, result]),
    );

    assert.equal(dram.shares, 500);
    assert.deepEqual(
        Object.keys(realizedByBroker).sort(),
        ['hsbc', 'ibkr', 'schwab'],
    );
    assert.equal(realizedByBroker.ibkr.accountId, 'U00000001');
    assert.equal(realizedByBroker.ibkr.realizedPnlLocal, 408.952041);
    assert.equal(realizedByBroker.hsbc.accountId, '000-999999-999');
    assert.equal(realizedByBroker.hsbc.realizedPnlLocal, 62.58);
    assert.equal(realizedByBroker.schwab.accountId, 'Individual ...001');
    assert.equal(realizedByBroker.schwab.realizedPnlLocal, 0);
    assert.equal(dram.realizedPnlLocal, 471.532041);
    assert.equal(dram.realizedPnl, 471.532041);
});

test('partial HSBC histories remain excluded from complete DRAM, BOXX, and EUV account totals', () => {
    setDramTestWindow();
    const cases = [
        ['DRAM', 408.952041],
        ['BOXX', 221.10913399],
        ['EUV', 102.5086956],
    ];

    for (const [ticker, ibkrRealizedPnl] of cases) {
        const transactions = [
            makeScopedDramTrade({
                broker: 'ibkr', account: 'U00000001', type: 'sell', ticker,
                date: '2026-07-14', quantity: 1, price: 61,
                brokerRealizedPnl: ibkrRealizedPnl,
            }),
            makeScopedDramTrade({
                broker: 'hsbc', account: '000-999999-999', type: 'buy', ticker,
                date: '2026-06-16', quantity: 1, price: 60,
                fileKind: 'hsbc_order_status_text',
            }),
            makeScopedDramTrade({
                broker: 'hsbc', account: '000-999999-999', type: 'sell', ticker,
                date: '2026-07-14', quantity: 1, price: 61,
                fileKind: 'hsbc_order_status_text',
            }),
        ];
        const summary = buildTickerSummaries(transactions, {}, 0, {})[0];
        const byBroker = Object.fromEntries(
            summary.realizedPnlAccounts.map((result) => [result.broker, result]),
        );

        assert.equal(summary.ticker, ticker);
        assert.equal(summary.realizedPnl, ibkrRealizedPnl);
        assert.equal(summary.realizedPnlStatus, 'partial');
        assert.equal(byBroker.ibkr.realizedPnlLocal, ibkrRealizedPnl);
        assert.equal(byBroker.ibkr.status, 'complete');
        assert.equal(byBroker.hsbc.realizedPnlLocal, null);
        assert.equal(byBroker.hsbc.status, 'unverified');
        assert.equal(byBroker.hsbc.source, 'unavailable');
    }
});

test('validated HSBC position snapshots attest open same-day tax-lot replay', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        hsbc: {
            broker: 'hsbc',
            account: '000-999999-999',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-07',
            position_snapshot: {
                DRAM: {
                    quantity: '3',
                    cost_basis_status: 'known',
                    cost_price: '50',
                    market_value: '180',
                    last_price: '60',
                },
            },
            hsbc_snapshot: {
                status: 'validated',
                portfolio_market_data_updated_at: {date: '2026-08-06'},
                order_status_coverage: {
                    mode: 'explicit_date_ranges',
                    windows: [{start_date: '2026-08-01', end_date: '2026-08-07'}],
                },
            },
            order_history_scope: {
                mode: 'explicit_date_ranges',
                windows: [{start_date: '2026-08-01', end_date: '2026-08-07'}],
            },
        },
    };
    const buy = makeScopedDramTrade({
        broker: 'hsbc', account: '000-999999-999', type: 'buy', date: '2026-08-06',
        quantity: 5, price: 50, fileKind: 'hsbc_order_status_text',
    });
    buy.source.email_datetime = '2026-08-06T21:00:00+08:00';
    const sell = makeScopedDramTrade({
        broker: 'hsbc', account: '000-999999-999', type: 'sell', date: '2026-08-06',
        quantity: 2, price: 60, fileKind: 'hsbc_order_status_text',
    });
    sell.source.email_datetime = '2026-08-06T22:00:00+08:00';

    const dram = buildTickerSummaries([sell, buy], {DRAM: 60}, 180, {})[0];
    const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');

    assert.equal(compareInvestmentTaxLotTransactions(buy, sell) < 0, true);
    assert.equal(hsbc.realizedPnlLocal, 20);
    assert.equal(hsbc.status, 'complete');
    assert.equal(hsbc.source, 'account_tax_lot_reconstruction');
    assert.equal(
        hsbc.taxLotHistoryVerification.verificationSource,
        'authoritative_position_snapshot_and_complete_replay',
    );
    assert.equal(dram.realizedPnlLocal, 20);
    assert.equal(dram.realizedPnlStatus, 'complete');
});

test('validated HSBC snapshots attest a fully covered flat ticker absent from open positions', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        hsbc: {
            broker: 'hsbc',
            account: '000-999999-999',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-14',
            position_snapshot: {
                DRAM: {
                    quantity: '3',
                    cost_basis_status: 'known',
                    cost_price: '50',
                    market_value: '180',
                    last_price: '60',
                },
            },
            hsbc_snapshot: {
                status: 'validated',
                portfolio_market_data_updated_at: {date: '2026-08-14'},
                order_status_coverage: {
                    mode: 'explicit_date_ranges',
                    windows: [{start_date: '2026-08-01', end_date: '2026-08-14'}],
                },
            },
            order_history_scope: {
                mode: 'explicit_date_ranges',
                windows: [{start_date: '2026-08-01', end_date: '2026-08-14'}],
            },
        },
    };
    const buy = makeScopedDramTrade({
        broker: 'hsbc', account: '000-999999-999', type: 'buy', ticker: 'QQQI',
        date: '2026-08-12', quantity: 5, price: 55.35,
        fileKind: 'hsbc_order_status_text',
    });
    const sell = makeScopedDramTrade({
        broker: 'hsbc', account: '000-999999-999', type: 'sell', ticker: 'QQQI',
        date: '2026-08-14', quantity: 5, price: 55.70,
        fileKind: 'hsbc_order_status_text',
    });

    const qqqi = buildTickerSummaries([sell, buy], {QQQI: 55.70}, 0, {})
        .find((summary) => summary.ticker === 'QQQI');
    const hsbc = qqqi.realizedPnlAccounts.find((result) => result.broker === 'hsbc');

    assert.equal(hsbc.realizedPnlLocal, 1.75);
    assert.equal(hsbc.status, 'complete');
    assert.equal(hsbc.source, 'account_tax_lot_reconstruction');
    assert.equal(hsbc.taxLotHistoryVerification.expectedShares, 0);
    assert.equal(qqqi.realizedPnlLocal, 1.75);
    assert.equal(qqqi.realizedPnlStatus, 'complete');
});

test('new HSBC position snapshots supersede stale tax-lot attestations', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        hsbc: {
            broker: 'hsbc',
            account: '000-999999-999',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-12',
            position_snapshot: {
                DRAM: {
                    quantity: '200',
                    cost_basis_status: 'known',
                    cost_price: '50',
                    market_value: '10800',
                    last_price: '54',
                },
            },
            tax_lot_history_verifications: {
                DRAM: {
                    currency: 'USD',
                    verified_through: '2026-08-07',
                    expected_shares: '200',
                    buy_count: 1,
                    sell_count: 0,
                    buy_quantity: '200',
                    sell_quantity: '0',
                    calculation_method: 'settled_net_amount_and_configured_lot_method',
                    verification_source: 'user_verified_hsbc_history_and_position_snapshot',
                },
            },
            hsbc_snapshot: {
                status: 'validated',
                portfolio_market_data_updated_at: {date: '2026-08-12'},
                order_status_coverage: {
                    mode: 'explicit_date_ranges',
                    windows: [{start_date: '2026-08-01', end_date: '2026-08-13'}],
                },
            },
            order_history_scope: {
                mode: 'explicit_date_ranges',
                windows: [{start_date: '2026-08-01', end_date: '2026-08-13'}],
            },
        },
    };
    const transactions = [
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy',
            date: '2026-08-06', quantity: 200, price: 50,
            fileKind: 'hsbc_order_status_text',
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy',
            date: '2026-08-12', quantity: 5, price: 10,
            fileKind: 'hsbc_order_status_text',
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'sell',
            date: '2026-08-12', quantity: 5, price: 12,
            fileKind: 'hsbc_order_status_text',
        }),
    ];

    const dram = buildTickerSummaries(transactions, {DRAM: 54}, 10800, {})[0];
    const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');

    assert.equal(hsbc.realizedPnlLocal, 10);
    assert.equal(hsbc.status, 'complete');
    assert.equal(hsbc.source, 'account_tax_lot_reconstruction');
    assert.equal(hsbc.taxLotHistoryVerification.verifiedThrough, '2026-08-12');
    assert.equal(hsbc.taxLotHistoryVerification.buyCount, 2);
    assert.equal(hsbc.taxLotHistoryVerification.sellCount, 1);
    assert.equal(
        hsbc.taxLotHistoryVerification.verificationSource,
        'authoritative_position_snapshot_and_complete_replay',
    );
    assert.equal(dram.realizedPnlLocal, 10);
    assert.equal(dram.realizedPnlStatus, 'complete');
});

test('explicit HSBC ending shares attest open EUV history and restore realized P&L', () => {
    setDramTestWindow();
    setCostBasisMethod('lowest_cost_first');
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        hsbc: {
            account: '000-999999-999',
            tax_lot_history_verifications: {
                EUV: {
                    currency: 'USD',
                    verified_through: '2026-08-06',
                    expected_shares: '80',
                    buy_count: 2,
                    sell_count: 1,
                    buy_quantity: '90',
                    sell_quantity: '10',
                    calculation_method: 'settled_net_amount_and_configured_lot_method',
                    verification_source: 'user_verified_hsbc_history_and_position_snapshot',
                },
            },
        },
    };
    const transactions = [
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy',
            date: '2026-06-16', quantity: 80, price: 20, ticker: 'EUV',
            fileKind: 'hsbc_order_status_text',
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'buy',
            date: '2026-07-01', quantity: 10, price: 25, ticker: 'EUV',
            fileKind: 'hsbc_order_status_text',
        }),
        makeScopedDramTrade({
            broker: 'hsbc', account: '000-999999-999', type: 'sell',
            date: '2026-08-06', quantity: 10, price: 30, commission: -0.01,
            ticker: 'EUV', fileKind: 'hsbc_order_status_text',
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'sell',
            date: '2026-06-24', quantity: 1, price: 30, ticker: 'EUV',
            brokerRealizedPnl: 102.508694,
        }),
    ];

    const euv = buildTickerSummaries(transactions, {EUV: 30}, 0, {})[0];
    const hsbc = euv.realizedPnlAccounts.find((result) => result.broker === 'hsbc');

    assert.ok(Math.abs(hsbc.realizedPnlLocal - 99.99) < 1e-9);
    assert.equal(hsbc.status, 'complete');
    assert.equal(hsbc.source, 'account_tax_lot_reconstruction');
    assert.equal(hsbc.taxLotHistoryVerification.expectedShares, 80);
    assert.ok(Math.abs(euv.realizedPnlLocal - 202.498694) < 1e-9);
    assert.equal(euv.realizedPnlStatus, 'complete');

    window.WORTHWARD_INVESTMENT_DATA.broker_summaries.hsbc
        .tax_lot_history_verifications.EUV.expected_shares = '79';
    const mismatched = buildTickerSummaries(transactions, {EUV: 30}, 0, {})[0];
    const mismatchedHsbc = mismatched.realizedPnlAccounts.find(
        (result) => result.broker === 'hsbc',
    );
    assert.equal(mismatchedHsbc.realizedPnlLocal, null);
    assert.equal(mismatchedHsbc.status, 'unverified');
});

test('broker-provided DRAM realized P&L is not charged commission a second time', () => {
    setDramTestWindow();
    const sell = makeScopedDramTrade({
        broker: 'ibkr',
        account: 'U00000001',
        type: 'sell',
        date: '2026-06-11',
        quantity: 15,
        price: 61,
        commission: -9.99,
        brokerRealizedPnl: 224.700059,
    });
    const dram = buildTickerSummaries([sell], {}, 0, {})[0];
    assert.equal(dram.realizedPnlLocal, 224.700059);
});

test('missing DRAM opening lots without broker realized P&L are unavailable', () => {
    setDramTestWindow();
    const sell = makeScopedDramTrade({
        broker: 'hsbc',
        account: '000-999999-999',
        type: 'sell',
        date: '2026-07-21',
        quantity: 15,
        price: 57,
    });
    const dram = buildTickerSummaries([sell], {}, 0, {})[0];
    assert.equal(dram.realizedPnl, null);
    assert.equal(dram.realizedPnlAccounts[0].status, 'incomplete');
    assert.equal(dram.realizedPnlAccounts[0].source, 'unavailable');
});
