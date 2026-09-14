/* Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    getInvestmentAggregatePnlCoverage,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    classifyInvestmentUsRealtimeSession,
    filterAggregateOnlyOverlayTransactions,
    isCompleteHsbcStatementPdfBundle,
    isRealtimeQuotePulseProviderEligible,
    parseInvestmentOptionalNumber,
    resolveRealtimeQuoteSource,
    LIVE_INVESTMENT_API_FIXTURE,
    createUtils,
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
    makeImportedTrade,
    makeScopedDramTrade,
    setDramTestWindow,
} from './context.mjs';

test('KOL rewards count as realized income and legacy deposits are detected', () => {
    globalThis.window = { WORTHWARD_INVESTMENT_DATA: { ticker_lineage: {}, money_market_tickers: [], fx_rate_history_by_currency: {SGD: {dates: ['2024-07-25'], values: {'2024-07-25': 1.3}}} } };
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
            summary: { performance_snapshot_authoritative: false },
            broker_summaries: {
                ibkr: {
                    broker: 'ibkr',
                    account: 'U00000001',
                    performance_snapshot_authoritative: true,
                    performance_snapshot: {
                        TQQQ: { currency: 'USD', realized_total: '7.89' },
                        SQQQ: { currency: 'USD', realized_total: '-2.22' },
                    },
                },
            },
        },
    };
    const transactions = [
        {
            ...makeImportedTrade({ type: 'buy', date: '2025-04-06', quantity: 1, price: 36 }),
            broker: 'ibkr',
            account: 'U00000001',
            currency: 'USD',
        },
        {
            ...makeImportedTrade({ type: 'sell', date: '2025-05-12', quantity: 1, price: 66 }),
            broker: 'ibkr',
            account: 'U00000001',
            currency: 'USD',
        },
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
    assert.equal(qqqi.realizedPnl, null);
    assert.equal(qqqi.pnlUnavailable, true);
    assert.equal(qqqi.pnlUnavailableReason, 'open_position_cost_basis_unknown');
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
        trade({broker: 'tigertrade', account: '1544722', ticker: 'AAPL', type: 'buy', date: '2025-01-24', quantity: 2, netAmount: -448.98}),
        trade({broker: 'tigertrade', account: '1544722', ticker: 'AAPL', type: 'sell', date: '2025-01-27', quantity: 2, netAmount: 459.01}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'MSFT', type: 'buy', date: '2023-02-16', quantity: 4, netAmount: -1062}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'MSFT', type: 'sell', date: '2023-03-22', quantity: 4, netAmount: 1091.98}),
        trade({broker: 'ibkr', account: 'U00000001', ticker: 'MSFT', type: 'dividend', date: '2026-03-12', netAmount: 13.10}),
        trade({broker: 'ibkr', account: 'U00000001', ticker: 'MSFT', type: 'dividend', date: '2026-06-11', netAmount: 4.09}),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'TSM', type: 'sell', date: '2023-02-28', quantity: 29, netAmount: 2553.45, brokerRealizedPnl: 98.74}),
        trade({broker: 'usmart_hk', account: '07723146', ticker: 'TSM', type: 'sell', date: '2023-02-18', quantity: 2, netAmount: 177.30, brokerRealizedPnl: -2.59}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'TSM', type: 'sell', date: '2023-03-22', quantity: 1, netAmount: 92.49, brokerRealizedPnl: 2.50}),
        trade({broker: 'tigertrade', account: '1544722', ticker: 'TSM', type: 'sell', date: '2024-12-23', quantity: 2, netAmount: 412.21, brokerRealizedPnl: 4.55}),
        trade({broker: 'cmbwl', account: '688-2-XXXX3-2', ticker: 'SPYM', type: 'sell', date: '2023-02-16', quantity: 1, netAmount: 1, brokerRealizedPnl: 67.21}),
        trade({broker: 'futuhk', account: 'FUTU-TEST-ACCOUNT', ticker: 'SPYM', type: 'sell', date: '2023-03-20', quantity: 1, netAmount: 1, brokerRealizedPnl: -25.48}),
        trade({broker: 'zircon_hk', account: '47601705', ticker: 'SPYM', type: 'sell', date: '2025-01-15', quantity: 1, netAmount: 1, brokerRealizedPnl: -4.23}),
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
            fx_rate_history_by_currency: {HKD: {dates: ['2023-03-02'], values: {'2023-03-02': 7.8}}},
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
            broker: 'usmart_hk', account: '07723146', type: 'sell', ticker: 'HIBS',
            date: '2023-02-18', datetime: '2023-02-18 20:00:00', currency: 'USD',
            quantity_abs: '1', price_raw: '4.5600',
            normalized: {position_quantity: '1', unit_price: '4.5600', net_amount: '2.65'},
            source: {row_number: 89},
        },
        {
            broker: 'usmart_hk', account: '07723146', type: 'buy', ticker: 'HIBS',
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

