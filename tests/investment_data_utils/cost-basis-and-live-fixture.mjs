/* Code version: v1.1.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestmentFundingMetricsRuntime} from '../../app/web/static/assets/js/investment/runtime/funding-metrics.js';
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
    getTransactionEvidencedTradeCashAmount,
    getTransactionEvidencedTradePrincipalAmount,
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

function makeHsbcSellSettlement({
    broker = 'hsbc',
    netAmount = '59.99',
    commission = '-0.01',
    principalAmount = '59.99',
    feeAmount = '-0.01',
} = {}) {
    const transaction = makeScopedDramTrade({
        broker,
        account: '000-999999-999',
        type: 'sell',
        date: '2026-08-04',
        quantity: 5,
        price: 12,
        commission: Number(commission),
    });
    transaction.net_amount_raw = String(netAmount);
    transaction.normalized.net_amount = String(netAmount);
    transaction.commission_raw = String(commission);
    transaction.normalized.commission = String(commission);
    transaction.source.cash_settlement_postings = [
        {role: 'principal', amount_raw: String(principalAmount)},
        {role: 'fee', amount_raw: String(feeAmount)},
    ];
    return transaction;
}

function setHsbcSellSettlementTestWindow(calculationMethod) {
    setDramTestWindow();
    globalThis.window.WORTHWARD_INVESTMENT_DATA.broker_summaries.hsbc = {
        account: '000-999999-999',
        tax_lot_history_verifications: {
            DRAM: {
                currency: 'USD',
                verified_through: '2026-08-04',
                buy_count: 1,
                sell_count: 1,
                buy_quantity: '5',
                sell_quantity: '5',
                expected_shares: '0',
                calculation_method: calculationMethod,
                verification_source: 'synthetic_complete_history',
            },
        },
    };
}

test('HSBC sell settlement evidence includes a separate fee exactly once', () => {
    const baseSell = makeHsbcSellSettlement();
    assert.equal(getTransactionAmount(baseSell), 59.99);
    assert.ok(Math.abs(getTransactionEvidencedTradeCashAmount(baseSell) - 59.98) < 1e-9);

    const alreadyAllIn = makeHsbcSellSettlement({netAmount: '59.98'});
    assert.equal(getTransactionEvidencedTradeCashAmount(alreadyAllIn), 59.98);

    const nonHsbc = makeHsbcSellSettlement({broker: 'ibkr'});
    assert.equal(getTransactionEvidencedTradeCashAmount(nonHsbc), 59.99);

    const noPostings = makeHsbcSellSettlement();
    delete noPostings.source.cash_settlement_postings;
    assert.equal(getTransactionEvidencedTradeCashAmount(noPostings), 59.99);

    const buyDecoy = makeHsbcSellSettlement();
    buyDecoy.type = 'buy';
    assert.equal(getTransactionEvidencedTradeCashAmount(buyDecoy), 59.99);

    const missingNormalizedCommission = makeHsbcSellSettlement();
    delete missingNormalizedCommission.normalized.commission;
    assert.equal(getTransactionEvidencedTradeCashAmount(missingNormalizedCommission), 59.99);
    assert.equal(
        getTransactionEvidencedTradePrincipalAmount(missingNormalizedCommission),
        null,
    );

    const missingRawCommission = makeHsbcSellSettlement();
    delete missingRawCommission.commission_raw;
    assert.equal(getTransactionEvidencedTradeCashAmount(missingRawCommission), 59.99);
    assert.equal(getTransactionEvidencedTradePrincipalAmount(missingRawCommission), null);

    const mismatchedCommission = makeHsbcSellSettlement({commission: '-0.02'});
    assert.equal(getTransactionEvidencedTradeCashAmount(mismatchedCommission), 59.99);

    const malformedPosting = makeHsbcSellSettlement();
    malformedPosting.source.cash_settlement_postings[1].amount_raw = 'not-a-number';
    assert.equal(getTransactionEvidencedTradeCashAmount(malformedPosting), 59.99);
});

for (const calculationMethod of [
    'settled_net_amount_and_configured_lot_method',
    'trade_price_and_commission',
]) {
    for (const netAmount of ['59.99', '59.98']) {
        test(`HSBC ${calculationMethod} replay uses evidenced ${netAmount} sell amount once`, () => {
            setHsbcSellSettlementTestWindow(calculationMethod);
            const transactions = [
                makeScopedDramTrade({
                    broker: 'hsbc',
                    account: '000-999999-999',
                    type: 'buy',
                    date: '2026-08-03',
                    quantity: 5,
                    price: 10,
                }),
                makeHsbcSellSettlement({netAmount}),
            ];
            const dram = buildTickerSummaries(transactions, {DRAM: 12}, 0, {})[0];
            const hsbc = dram.realizedPnlAccounts.find((result) => result.broker === 'hsbc');

            assert.equal(hsbc.status, 'complete');
            assert.ok(Math.abs(hsbc.realizedPnlLocal - 9.98) < 1e-9);
        });
    }
}

for (const netAmount of ['59.99', '59.98']) {
    test(`HSBC realized-P&L breakdown classifies ${netAmount} proceeds without a residual`, () => {
        setHsbcSellSettlementTestWindow('settled_net_amount_and_configured_lot_method');
        const transactions = [
            makeScopedDramTrade({
                broker: 'hsbc',
                account: '000-999999-999',
                type: 'buy',
                date: '2026-08-03',
                quantity: 5,
                price: 10,
            }),
            makeHsbcSellSettlement({netAmount}),
        ];
        const dram = buildTickerSummaries(transactions, {DRAM: 12}, 0, {})[0];
        const metricRuntime = createUtils();
        Object.assign(metricRuntime, {
            getBrokerRewardLedgerRows: () => [],
            getBrokerRewardRealizedIncome: () => 0,
            getInvestmentCanonicalSummaryRealizedPnl: (summary) => summary.realizedPnl,
        });
        const fundingRuntime = createInvestmentFundingMetricsRuntime(metricRuntime);
        const attribution = fundingRuntime.getRealizedPnlAttribution(transactions, [dram], {});
        const detailsByLabel = Object.fromEntries(
            attribution.realizedPnlDetails.map((detail) => [detail.label, detail.value]),
        );

        assert.ok(Math.abs(attribution.totalRealizedPnl - 9.98) < 1e-9);
        assert.equal(detailsByLabel['Trading spread gains'], '+9.99');
        assert.equal(detailsByLabel['Commissions / fees'], '-0.01');
        assert.equal(detailsByLabel['Broker-reported reconciliation'], undefined);
    });
}

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

    assert.equal(dram.realizedPnlLocal, null);
    assert.equal(dram.shares, 10);
    assert.equal(dram.totalCost, null);
    assert.equal(dram.averagePrice, null);
    assert.equal(dram.unrealizedPnlLocal, null);
    assert.equal(dram.totalPnlLocal, null);
    assert.equal(dram.costBasisStatus, 'unknown');
    assert.equal(dram.costBasisUnavailable, true);
    assert.equal(dram.costBasisUnavailableReason, 'open_position_cost_basis_unknown');
    assert.equal(dram.pnlUnavailable, true);
    assert.equal(dram.pnlUnavailableReason, 'open_position_cost_basis_unknown');
});

test('dividend reinvestment opens shares at the reinvestment cost basis', () => {
    setDramTestWindow();
    const reinvestment = makeScopedDramTrade({
        broker: 'schwab', account: 'SCHWAB-1', type: 'dividend_reinvestment',
        date: '2026-08-05', quantity: 2, price: 50,
    });
    reinvestment.normalized.net_amount = '-100';

    const dram = buildTickerSummaries([reinvestment], {DRAM: 50}, 0, {})[0];

    assert.equal(dram.shares, 2);
    assert.equal(dram.totalCost, 100);
    assert.equal(dram.averagePrice, 50);
    assert.equal(dram.unrealizedPnlLocal, 0);
    assert.equal(dram.totalPnlLocal, 0);
});

test('dividend reinvestment without value evidence fails cost basis and P&L closed', () => {
    setDramTestWindow();
    const reinvestment = makeScopedDramTrade({
        broker: 'schwab', account: 'SCHWAB-1', type: 'dividend_reinvestment',
        date: '2026-08-05', quantity: 2, price: 50,
    });
    delete reinvestment.price_raw;
    delete reinvestment.normalized.unit_price;
    delete reinvestment.normalized.net_amount;

    const dram = buildTickerSummaries([reinvestment], {DRAM: 50}, 0, {})[0];

    assert.equal(dram.shares, 2);
    assert.equal(dram.totalCost, null);
    assert.equal(dram.averagePrice, null);
    assert.equal(dram.costBasisStatus, 'unknown');
    assert.equal(dram.costBasisUnavailable, true);
    assert.equal(dram.realizedPnl, null);
    assert.equal(dram.unrealizedPnlLocal, null);
    assert.equal(dram.totalPnlLocal, null);
    assert.equal(dram.pnlUnavailable, true);
    assert.equal(dram.pnlUnavailableReason, 'open_position_cost_basis_unknown');
});

test('missing reinvestment basis makes a known open position partially covered', () => {
    setDramTestWindow();
    const buy = makeScopedDramTrade({
        broker: 'schwab', account: 'SCHWAB-1', type: 'buy',
        date: '2026-08-01', quantity: 2, price: 40,
    });
    const reinvestment = makeScopedDramTrade({
        broker: 'schwab', account: 'SCHWAB-1', type: 'dividend_reinvestment',
        date: '2026-08-05', quantity: 1, price: 50,
    });
    delete reinvestment.price_raw;
    delete reinvestment.normalized.unit_price;
    delete reinvestment.normalized.net_amount;

    const dram = buildTickerSummaries([buy, reinvestment], {DRAM: 50}, 0, {})[0];

    assert.equal(dram.shares, 3);
    assert.equal(dram.totalCost, null);
    assert.equal(dram.averagePrice, null);
    assert.equal(dram.costBasisStatus, 'partial');
    assert.equal(dram.pnlUnavailable, true);
    assert.equal(dram.pnlUnavailableReason, 'open_position_cost_basis_partial');
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
            performance_snapshot_as_of: '2026-08-11',
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
    const expectedIncrementalPnl = 556.15 - (10 * 49);
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

test('IBKR partial current snapshots replay a missing ticker from scoped history', () => {
    setDramTestWindow();
    window.WORTHWARD_INVESTMENT_DATA.broker_summaries = {
        ibkr: {
            broker: 'ibkr',
            account: 'U00000001',
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-08-20',
            position_snapshot: {
                QQQI: {
                    quantity: '1',
                    cost_basis_status: 'unknown',
                    as_of: '2026-08-20 12:00:00',
                },
            },
            holdings_validation: {
                matched: true,
                history_complete: false,
                status: 'snapshot_authoritative_partial_history',
                comparison_scope: 'user_confirmed_current_position_snapshot',
            },
            performance_snapshot_authoritative: true,
            performance_snapshot_as_of: '2026-08-05',
            performance_snapshot: {
                DRAM: {
                    currency: 'USD',
                    realized_total: '20',
                },
            },
        },
    };
    const transactions = [
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-01',
            quantity: 10, price: 50,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-05',
            quantity: 2, price: 60, brokerRealizedPnl: 20,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-15',
            quantity: 3, price: 70, fileKind: 'ibkr_web_trade_notification',
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-16',
            quantity: 2, price: 55,
        }),
    ];

    const dram = buildTickerSummaries(transactions, {DRAM: 70}, 0, {})
        .find((summary) => summary.ticker === 'DRAM');
    const ibkr = dram.realizedPnlAccounts.find((result) => result.broker === 'ibkr');

    assert.equal(ibkr.status, 'complete');
    assert.equal(ibkr.source, 'broker_performance_snapshot_plus_boundary_replay');
    assert.equal(ibkr.reconstructedPositionShares, 7);
    assert.equal(ibkr.realizedPnlLocal, 80);
    assert.equal(dram.realizedPnlLocal, 80);
    assert.equal(dram.realizedPnlByDateLocal['2026-08-15'], 60);
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
        assert.equal(summary.realizedPnl, null);
        assert.equal(summary.realizedPnlLocal, null);
        assert.equal(summary.realizedPnlStatus, 'partial');
        assert.equal(summary.realizedPnlReconciliation.realizedPnl, null);
        assert.equal(summary.realizedPnlReconciliation.realizedPnlLocal, null);
        assert.deepEqual(summary.realizedPnlReconciliation.realizedPnlByDate, {});
        assert.equal(summary.pnlUnavailable, true);
        assert.equal(summary.pnlUnavailableReason, 'realized_pnl_coverage_partial');
        assert.equal(summary.totalPnl, null);
        assert.equal(byBroker.ibkr.realizedPnlLocal, ibkrRealizedPnl);
        assert.equal(byBroker.ibkr.status, 'complete');
        assert.equal(byBroker.hsbc.realizedPnlLocal, null);
        assert.equal(byBroker.hsbc.status, 'unverified');
        assert.equal(byBroker.hsbc.source, 'unavailable');
    }
});

test('one incomplete sold account withholds another account open-position P&L', () => {
    setDramTestWindow();
    const unknownTransfer = makeScopedDramTrade({
        broker: 'hsbc', account: 'HSBC-1', type: 'transfer_in',
        date: '2026-08-01', quantity: 5, price: 0,
    });
    unknownTransfer.carried_cost_basis_status = 'unknown';
    const transactions = [
        unknownTransfer,
        makeScopedDramTrade({
            broker: 'hsbc', account: 'HSBC-1', type: 'sell',
            date: '2026-08-02', quantity: 5, price: 120,
        }),
        makeScopedDramTrade({
            broker: 'ibkr', account: 'IBKR-1', type: 'buy',
            date: '2026-08-03', quantity: 5, price: 100,
        }),
    ];

    const dram = buildTickerSummaries(transactions, {DRAM: 120}, 0, {})[0];
    const byBroker = Object.fromEntries(
        dram.realizedPnlAccounts.map((result) => [result.broker, result]),
    );

    assert.equal(dram.shares, 5);
    assert.equal(dram.totalCost, 500);
    assert.equal(dram.averagePrice, 100);
    assert.equal(dram.marketValue, 600);
    assert.equal(dram.realizedPnlStatus, 'partial');
    assert.equal(dram.realizedPnl, null);
    assert.equal(dram.unrealizedPnl, null);
    assert.equal(dram.totalPnl, null);
    assert.equal(dram.pnlUnavailable, true);
    assert.equal(dram.pnlUnavailableReason, 'realized_pnl_coverage_partial');
    assert.equal(byBroker.hsbc.realizedPnl, null);
    assert.equal(byBroker.hsbc.status, 'incomplete');
    assert.equal(byBroker.ibkr.realizedPnl, 0);
    assert.equal(byBroker.ibkr.status, 'complete');
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

for (const useCompleteFileHistory of [false, true]) {
test(`snapshot baseline plus increment with complete file history=${useCompleteFileHistory}`, () => {
    const previousWindow = globalThis.window;
    const fixture = structuredClone(LIVE_INVESTMENT_API_FIXTURE);
    if (useCompleteFileHistory) {
        fixture.transactions.forEach((transaction) => {
            if (transaction.broker === 'ibkr' && transaction.source?.file_kind === 'ibkr_web_trade_notification') {
                transaction.source.file_kind = 'gainskeeper';
            }
        });
    }
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: fixture};
    try {
        const expected = fixture.expected;
        const dram = buildTickerSummaries(
            fixture.transactions,
            {DRAM: 57.27},
            0,
            {},
        ).find((summary) => summary.ticker === expected.ticker);
        assert.ok(dram);

        const ibkr = dram.realizedPnlAccounts.find((account) => account.broker === 'ibkr');
        assert.ok(ibkr);
        assert.equal(ibkr.status, 'complete');
        assert.equal(ibkr.reconciliation.coverageStatus, 'complete');
        assert.equal(
            ibkr.reconciliation.asOf.performanceSnapshot,
            expected.performance_snapshot_as_of,
        );
        assert.equal(
            ibkr.reconciliation.asOf.positionSnapshot,
            expected.position_snapshot_as_of,
        );
        assert.equal(
            ibkr.reconciliation.asOf.transactionHistory,
            expected.transaction_history_through,
        );
        assert.equal(
            ibkr.reconciliation.replay.postPerformanceTransactionCount,
            expected.ibkr_post_performance_transaction_count,
        );
        assert.equal(
            ibkr.reconciliation.replay.postPerformanceSellCount,
            expected.ibkr_post_performance_sell_count,
        );
        assert.equal(
            ibkr.reconciliation.baselineRealizedPnlLocal,
            Number(expected.ibkr_snapshot_baseline_realized_pnl),
        );
        assert.ok(Math.abs(
            ibkr.reconciliation.realizedPnlLocal
            - Number(expected.ibkr_reconciled_realized_pnl),
        ) <= 1e-7);
        assert.ok(Math.abs(
            ibkr.reconciliation.baselineRealizedPnlLocal
            + ibkr.reconciliation.incrementalRealizedPnlLocal
            - ibkr.reconciliation.realizedPnlLocal,
        ) <= 1e-7);
        assert.ok(Math.abs(
            Object.values(ibkr.reconciliation.realizedPnlByDateLocal)
                .reduce((sum, value) => sum + value, 0)
            - ibkr.reconciliation.realizedPnlLocal,
        ) <= 1e-6);
        assert.equal(ibkr.reconciliation.arithmeticCheck.valid, true);
        assert.ok(Math.abs(
            dram.realizedPnl - Number(expected.total_reconciled_realized_pnl),
        ) <= 1e-7);
        assert.equal(dram.realizedPnlReconciliation.arithmeticCheck.valid, true);
        assert.ok(Math.abs(
            dram.realizedPnlReconciliation.realizedPnlLocal
            - Number(expected.total_reconciled_realized_pnl),
        ) <= 1e-7);
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

}

test('missing supplemental replay boundary cannot become complete', () => {
    const previousWindow = globalThis.window;
    const fixture = structuredClone(LIVE_INVESTMENT_API_FIXTURE);
    const ibkrSummary = fixture.broker_summaries.ibkr;
    ibkrSummary.position_snapshot = {};
    ibkrSummary.position_snapshot_authoritative = false;
    ibkrSummary.holdings_validation = {matched: false, history_complete: false};
    fixture.broker_summaries = {ibkr: ibkrSummary};
    fixture.transactions = fixture.transactions.filter((transaction) => transaction.broker === 'ibkr');
    fixture.summary = {
        position_snapshot_authoritative: false,
        performance_snapshot_authoritative: false,
    };
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: fixture};
    try {
        const dram = buildTickerSummaries(
            fixture.transactions,
            {DRAM: 57.27},
            0,
            {},
        ).find((summary) => summary.ticker === 'DRAM');
        const account = dram.realizedPnlAccounts[0];
        assert.equal(account.status, 'unavailable');
        assert.equal(account.reconciliation.coverageStatus, 'unavailable');
        assert.equal(account.reconciliation.replay.status, 'unavailable');
        assert.equal(dram.realizedPnl, null);
        assert.equal(dram.realizedPnlStatus, 'unavailable');
        assert.equal(dram.realizedPnlReconciliation.coverageStatus, 'unavailable');
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('legacy ticker performance fallback cannot override required account replay', () => {
    const previousWindow = globalThis.window;
    const fixture = structuredClone(LIVE_INVESTMENT_API_FIXTURE);
    const ibkrSummary = fixture.broker_summaries.ibkr;
    fixture.broker_summaries = {ibkr: ibkrSummary};
    fixture.broker_snapshots = {'ibkr:U00000001': ibkrSummary};
    fixture.transactions = fixture.transactions.filter((transaction) => transaction.broker === 'ibkr');
    fixture.summary = {
        performance_snapshot_authoritative: true,
        position_snapshot_authoritative: false,
    };
    fixture.performance_snapshot = {
        DRAM: {
            currency: 'USD',
            realized_total: fixture.expected.ibkr_snapshot_baseline_realized_pnl,
        },
    };
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: fixture};
    try {
        const dram = buildTickerSummaries(
            fixture.transactions,
            {DRAM: 57.27},
            0,
            {},
        ).find((summary) => summary.ticker === 'DRAM');
        assert.ok(Math.abs(
            dram.realizedPnl - Number(fixture.expected.ibkr_reconciled_realized_pnl),
        ) <= 1e-7);
        assert.notEqual(
            dram.realizedPnl,
            Number(fixture.expected.ibkr_snapshot_baseline_realized_pnl),
        );
        assert.equal(dram.realizedPnlReconciliation.replay.status, 'complete');
        assert.ok(Object.prototype.hasOwnProperty.call(
            dram.realizedPnlByDate,
            fixture.expected.performance_snapshot_as_of,
        ));
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('missing FX never becomes currency parity or zero cash and equity', () => {
    const utils = createUtils();
    const timeline = {baseCurrency: 'USD', ratesByCurrency: {}};
    for (const rate of [undefined, 0, -1, NaN]) {
        timeline.ratesByCurrency.HKD = {dates: ['2026-01-02'], values: {'2026-01-02': rate}};
        assert.ok(Number.isNaN(utils.convertAmountToBaseCurrency(1000, 'HKD', '2026-01-02', timeline)));
        assert.ok(Number.isNaN(utils.convertAmountToBaseCurrencyAtLatestRate(1000, 'HKD', timeline)));
        const cash = utils.sumCashLedgerInBaseCurrency({USD: 100, HKD: 1000}, '2026-01-02', timeline);
        assert.ok(Number.isNaN(cash));
        assert.equal(utils.computeInvestmentLiveHoldingsTotalEquity([], cash), null);
    }
    assert.equal(utils.convertAmountToBaseCurrency(0, 'HKD', '2026-01-02', timeline), 0);
    assert.equal(utils.convertAmountToBaseCurrency(1000, 'USD', '2026-01-02', timeline), 1000);
    assert.equal(utils.computeInvestmentLiveHoldingsTotalEquity([], null), null);
});

test('aggregate P&L distinguishes empty, complete, partial, and unavailable coverage', () => {
    const complete = {ticker: 'KNOWN', realizedPnl: 0, unrealizedPnl: 5, hasOpenPosition: true, realizedPnlStatus: 'complete'};
    const missing = {ticker: 'UNKNOWN', realizedPnl: null, unrealizedPnl: null, pnlUnavailable: true};
    assert.equal(getInvestmentAggregatePnlCoverage([]).status, 'complete');
    assert.equal(getInvestmentAggregatePnlCoverage([complete]).status, 'complete');
    assert.deepEqual(getInvestmentAggregatePnlCoverage([complete, missing]), {status: 'partial', completeCount: 1, totalCount: 2, missingTickers: ['UNKNOWN']});
    assert.equal(getInvestmentAggregatePnlCoverage([missing]).status, 'unavailable');
    assert.equal(getInvestmentAggregatePnlCoverage([{...complete, realizedPnlStatus: 'partial'}]).status, 'partial');
    assert.equal(getInvestmentAggregatePnlCoverage([{...complete, unrealizedPnl: null}]).status, 'unavailable');
    assert.equal(getInvestmentAggregatePnlCoverage([{...complete, hasOpenPosition: false, unrealizedPnl: null}]).status, 'complete');
});

test('missing FX invalidates an open foreign holding and historical valuation', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {}};
    try {
        const transactions = [{ticker: '5.HK', currency: 'HKD', type: 'buy', date: '2026-01-02', quantity: 10, price: 100}];
        const [summary] = buildTickerSummaries(transactions, {'5.HK': 110}, 1000, {});
        assert.equal(summary.marketValue, null);
        assert.equal(summary.pnlUnavailable, true);
        assert.equal(summary.pnlUnavailableReason, 'missing_fx_rate');
        assert.equal(summary.unrealizedPnl, null);
        assert.equal(summary.positionWeight, null);
        const valuation = calculateSnapshotMarketValue({holdings: {'5.HK': 10}}, '2026-01-02', buildTickerPriceIndex({'5.HK': {'2026-01-02': 110}}), new Set(), {baseCurrency: 'USD', ratesByCurrency: {}}, 'USD');
        assert.equal(valuation.isComplete, false);
        assert.deepEqual(valuation.missingPriceTickers, []);
        assert.ok(Number.isNaN(valuation.marketValue));
    } finally {
        globalThis.window = previousWindow;
    }
});

test('dated performance snapshots count dividend income and withholding once across the boundary', () => {
    for (const includesIncome of [false, true]) {
        for (const asOf of ['2026-07-15', '2026-08-31']) {
            const incomeInSnapshot = asOf === '2026-07-15' ? 18 : 27;
            globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
                broker_summaries: {ibkr: {
                    account: 'U999999',
                    performance_snapshot_authoritative: true,
                    performance_snapshot_as_of: asOf,
                    performance_snapshot: {QQQI: {
                        currency: 'USD', realized_total: includesIncome ? String(incomeInSnapshot) : '0',
                        realized_total_includes_nonperformance: includesIncome,
                    }},
                    position_snapshot_authoritative: true,
                    position_snapshot_as_of: '2026-08-31',
                    position_snapshot: {QQQI: {quantity: '10', cost_price: '50'}},
                }},
            }};
            const buy = {...makeImportedTrade({type: 'buy', date: '2026-06-01', quantity: 10, price: 50}),
                broker: 'ibkr', account: 'U999999', ticker: 'QQQI'};
            const income = (date, type, amount) => ({broker: 'ibkr', account: 'U999999',
                ticker: 'QQQI', currency: 'USD', date, type, normalized: {net_amount: String(amount)}});
            const transactions = [buy,
                income('2026-06-18', 'dividend', 20),
                income('2026-06-18', 'foreign_tax_withholding', -2),
                income('2026-08-21', 'payment_in_lieu', 10),
                income('2026-08-21', 'foreign_tax_withholding', -1),
            ];
            const qqqi = buildTickerSummaries(transactions, {}, 0, {})[0];
            assert.equal(qqqi.realizedPnl, 27, `${asOf}, includesIncome=${includesIncome}`);
            const account = qqqi.realizedPnlAccounts[0];
            assert.equal(account.status, 'complete');
            assert.equal(Object.values(account.realizedPnlByDateLocal).reduce((sum, n) => sum + n, 0), 27);
            assert.equal(account.reconciliation.baselineRealizedPnlLocal, incomeInSnapshot);
            assert.equal(account.reconciliation.incrementalRealizedPnlLocal, 27 - incomeInSnapshot);
        }
    }
});
