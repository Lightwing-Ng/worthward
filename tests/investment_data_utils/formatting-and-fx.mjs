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
            statement_order_id: 'P-140025',
            cash_settlement_reference: 'REF P016711450 SEC',
            cash_replay_pending_settlement: true,
        },
    };
    assert.equal(
        formatTransactionDescription(pendingOrder),
        'EUV @ 24.50 × 3 · P-140025*',
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
        'EUV @ 24.50 × 3 · P-140025',
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
    assert.equal(
        formatTransactionDescription({
            type: 'forex_trade_component',
            ticker: 'USD.CNH',
            quantity_raw: '299.58',
            quantity_abs: '299.58',
            price_raw: '6.70920',
            source: {
                forex_action: 'buy_base',
                base_quantity_raw: '299.58',
                quote_amount_raw: '2009.9421360',
            },
        }),
        'Bought 299.58 USD with 2,009.94 CNH @ USD.CNH 6.70920',
    );
    assert.equal(
        formatTransactionDescription({
            type: 'forex_trade_component',
            ticker: 'USD.CNH',
            quantity_raw: '-100',
            quantity_abs: '100',
            price_raw: '7.00000',
        }),
        'Sold 100.00 USD for 700.00 CNH @ USD.CNH 7.00000',
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
                broker: 'zircon_hk', account: '47601705', date: '2025-01-17', type: 'buy', ticker: sourceTicker,
                currency: 'USD', quantity_raw: '1', quantity_abs: '1', price_raw: '78.99',
                normalized: { position_quantity: '1', unit_price: '78.99', net_amount: '-78.99' },
            },
            {
                broker: 'zircon_hk', account: '47601705', date: '2025-01-20', type: 'sell', ticker: sourceTicker,
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
            broker: 'tigertrade', account: '1544722', date: '2025-01-27', type: 'buy', ticker: sourceTicker,
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
            fx_rate_history_by_currency: {HKD: {dates: ['2025-01-03'], values: {'2025-01-03': 7.8}}},
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

