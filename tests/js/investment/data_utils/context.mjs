/* Code version: v1.1.2 */
import fs from 'node:fs';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    getInvestmentAggregatePnlCoverage,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    classifyInvestmentUsRealtimeSession,
    createInvestmentDataUtils,
    filterAggregateOnlyOverlayTransactions,
    isCompleteHsbcStatementPdfBundle,
    isRealtimeQuotePulseProviderEligible,
    parseInvestmentOptionalNumber,
    resolveRealtimeQuoteSource,
} from '../../../../app/web/static/assets/js/investment/data-utils.js';

const SPLIT_FACTORS = [1, 1.5, 2, 3, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 128, 160, 200, 256];

export const LIVE_INVESTMENT_API_FIXTURE = JSON.parse(
    fs.readFileSync(
        new URL('../../../fixtures/investment_api_payload_reconciliation.json', import.meta.url),
        'utf8',
    ),
);

export function createUtils() {
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

export {
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
};

export const {
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
    sortInvestmentTransactionsForReplay,
    sortInvestmentTaxLotTransactions,
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
    buildInvestmentPostSnapshotCashDelta,
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
    getTransactionEvidencedTradeCashAmount,
    getTransactionEvidencedTradePrincipalAmount,
    getTransactionEffectiveUnitPrice,
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

export function makeImportedTrade({ type, date, quantity, price }) {
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

export function makeScopedDramTrade({
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

export function setDramTestWindow() {
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {performance_snapshot_authoritative: false},
            broker_summaries: {},
        },
    };
}
