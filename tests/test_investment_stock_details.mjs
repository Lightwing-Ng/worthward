/* Tests for Investment Stock details boundaries. Code version: v1.4.2 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_STOCK_DETAILS_MODULE_VERSION,
    aggregateInvestmentStockDetailPositionStates,
    buildInvestmentIntradayDayBoundaries,
    buildInvestmentIntradayDayFallbackIndex,
    createInvestmentStockDetailsUtils,
    getInvestmentTradeSessionType,
    getInvestmentStockDetailsTransactionSessionType,
    getInvestmentStockDetailsAveragePriceLabel,
    isInvestmentStockDetailsIntradayRange,
    isInvestmentTransactionDateOnly,
    normalizeInvestmentStockDetailsIntradayRows,
    normalizeInvestmentIntradayMinuteKey,
    normalizeInvestmentRange,
    resolveInvestmentStockDetailsDailySnapshotIndex,
    resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey,
} from '../app/web/static/assets/js/investment/stock-details.js';
import {createInvestmentDataUtils} from '../app/web/static/assets/js/investment/data-utils.js';

const rangeOptions = [{value: '1w'}, {value: '3m'}, {value: 'max'}];
const normalizeDate = (value) => String(value || '').slice(0, 10);
const stockDetailDataUtils = createInvestmentDataUtils({
    noCommissionTransactionTypes: new Set(),
    investmentCommonSplitFactors: [1, 2, 4, 8, 10, 20, 50, 100],
    parseInvestmentDateParts: (value) => value,
    formatInvestmentShortDateParts: (value) => value,
    normalizeInvestmentTicker: (value) => String(value || '').trim().toUpperCase(),
    normalizeInvestmentStockDetailsRange: (value) => value || 'max',
    normalizeInvestmentEquityRange: (value) => value || 'max',
});

function createBrokerMetricsBuilder(processedTransactions) {
    const utils = createInvestmentStockDetailsUtils({
        applyInvestmentTransactionToState: stockDetailDataUtils.applyInvestmentTransactionToState,
        buildInvestmentFxRateTimeline: () => ({}),
        buildRenderedSplitFactorHints: () => ({}),
        buildTickerPriceIndex: () => ({}),
        compareInvestmentTransactions: (left, right) => String(left.date).localeCompare(String(right.date)),
        convertAmountToBaseCurrency: (value) => Number(value),
        createPositionState: stockDetailDataUtils.createPositionState,
        formatAmount: (value) => String(value),
        formatAmountWithCurrency: (value) => String(value),
        formatHoldingsMoney: (value) => Number(value).toFixed(2),
        formatHoldingsPosition: (value) => String(value),
        formatMetricLossAmount: (value) => String(value),
        formatMetricLossAmountWithCurrency: (value, currency) => `${currency} ${value}`,
        formatTransactionCommissionDisplay: () => '',
        formatTransactionCurrency: (txn) => txn.currency || 'USD',
        formatTransactionDateDisplay: () => '',
        formatTransactionDescription: () => '',
        getInvestmentBaseCurrency: () => 'USD',
        getInvestmentBrokerMeta: (broker) => ({label: broker === 'schwab' ? 'Charles Schwab' : 'IBKR'}),
        getInvestmentCanonicalTicker: (ticker) => String(ticker || '').toUpperCase(),
        getInvestmentProcessedTransactionsCache: () => processedTransactions,
        getMoneyMarketTickerSet: () => new Set(),
        getNormalizedTransactionType: (txn) => txn.type,
        getTickerQuoteCurrency: () => 'USD',
        getTransactionBrokerCode: (txn) => txn.broker,
        getTransactionBrokerRealizedPnl: (txn) => {
            const value = txn.broker_realized_pnl_raw ?? txn.normalized?.broker_realized_pnl;
            return value === undefined ? null : Number(value);
        },
        getTransactionAmount: stockDetailDataUtils.getTransactionAmount,
        getTransactionCommission: stockDetailDataUtils.getTransactionCommission,
        getTransactionEffectiveUnitPrice: stockDetailDataUtils.getTransactionEffectiveUnitPrice,
        getTransactionQuantity: stockDetailDataUtils.getTransactionQuantity,
        getTransactionLotScope: stockDetailDataUtils.getTransactionLotScope,
        getTransactionLotScopeKey: stockDetailDataUtils.getTransactionLotScopeKey,
        getTransactionValuationQuantity: stockDetailDataUtils.getTransactionQuantity,
        isFlatPosition: (value) => Math.abs(Number(value) || 0) < 1e-9,
        normalizeLedgerDate: normalizeDate,
        normalizePriceHistoryPayload: () => ({}),
    });
    return utils.buildInvestmentStockDetailBrokerMetrics;
}

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_STOCK_DETAILS_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('average-price labels stay presentation-neutral across cost methods', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {ANTIGRAVITY_INVESTMENT_DATA: {}};
    try {
        const methods = ['lowest_cost_first', 'fifo', 'lifo', 'moving_average'];
        for (const method of methods) {
            globalThis.window.ANTIGRAVITY_INVESTMENT_DATA.investment_cost_basis_method = method;
            assert.equal(getInvestmentStockDetailsAveragePriceLabel(), 'Average price', method);
        }

        globalThis.window.ANTIGRAVITY_INVESTMENT_DATA.investment_cost_basis_method = 'FIFO reconstructed';
        globalThis.window.ANTIGRAVITY_APP = {investmentCostBasisMethod: 'fifo'};
        assert.equal(getInvestmentStockDetailsAveragePriceLabel(), 'Average price');
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('average-cost aggregation preserves account-scoped replay and rejects mixed currencies', () => {
    const ibkrState = stockDetailDataUtils.createPositionState('DRAM');
    const hsbcState = stockDetailDataUtils.createPositionState('DRAM');
    const apply = (state, transaction) => {
        state.lotScope = stockDetailDataUtils.getTransactionLotScope(transaction, 'DRAM');
        stockDetailDataUtils.applyInvestmentTransactionToState(
            state,
            transaction,
            transaction.type,
            stockDetailDataUtils.getTransactionQuantity(transaction),
            stockDetailDataUtils.getTransactionAmount(transaction),
            transaction.date,
        );
    };
    apply(ibkrState, {
        broker: 'ibkr', account: 'U00000001', ticker: 'DRAM', currency: 'USD',
        type: 'buy', quantity: 10, price: 50, date: '2026-08-01',
    });
    apply(hsbcState, {
        broker: 'hsbc', account: '000-999999-999', ticker: 'DRAM', currency: 'USD',
        type: 'buy', quantity: 10, price: 100, date: '2026-08-02',
    });
    apply(hsbcState, {
        broker: 'hsbc', account: '000-999999-999', ticker: 'DRAM', currency: 'USD',
        type: 'sell', quantity: 5, price: 120, date: '2026-08-03',
    });
    const aggregate = aggregateInvestmentStockDetailPositionStates(
        new Map([['ibkr', ibkrState], ['hsbc', hsbcState]]),
        'DRAM',
        () => 'USD',
    );
    assert.equal(aggregate.shares, 15);
    assert.equal(aggregate.totalCost, 1_000);
    assert.ok(Math.abs(aggregate.averagePrice - (1_000 / 15)) < 1e-9);
    assert.equal(hsbcState.realizedPnl, 100);
    assert.deepEqual(aggregate.currencies, ['USD']);

    const mixedCurrencyState = stockDetailDataUtils.createPositionState('DRAM');
    apply(mixedCurrencyState, {
        broker: 'hsbc', account: '000-999999-999', ticker: 'DRAM', currency: 'HKD',
        type: 'buy', quantity: 1, price: 780, date: '2026-08-03',
    });
    const mixedAggregate = aggregateInvestmentStockDetailPositionStates(
        new Map([['ibkr', ibkrState], ['hsbc-usd', hsbcState], ['hsbc-hkd', mixedCurrencyState]]),
        'DRAM',
        () => 'USD',
    );
    assert.equal(mixedAggregate.shares, 16);
    assert.equal(mixedAggregate.totalCost, null);
    assert.equal(mixedAggregate.averagePrice, null);
    assert.deepEqual(mixedAggregate.currencies, ['HKD', 'USD']);
});

test('broker metrics move in-kind shares between brokers without counting a trade', () => {
    const transactions = [
        {date: '2026-07-01', broker: 'ibkr', type: 'buy', ticker: 'QQQI', quantity: 315, price: 56.7},
        {date: '2026-07-31', broker: 'ibkr', type: 'transfer_out', ticker: 'QQQI', quantity: 5},
        {date: '2026-07-31', broker: 'schwab', type: 'transfer_in', ticker: 'QQQI', quantity: 5},
    ];
    const previousWindow = globalThis.window;
    globalThis.window = {ANTIGRAVITY_INVESTMENT_DATA: {price_history_by_ticker: {}}};
    try {
        const metrics = createBrokerMetricsBuilder(transactions)(transactions, 'QQQI', 53.04);
        assert.deepEqual(
            metrics.map((metric) => ({
                broker: metric.brokerCode,
                position: metric.positionDisplay,
                trades: metric.totalTrades,
            })),
            [
                {broker: 'ibkr', position: '310', trades: 1},
                {broker: 'schwab', position: '5', trades: 0},
            ],
        );
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('DRAM broker metrics retain IBKR, Schwab transfer-in, and HSBC holdings', () => {
    const schwabTransferIn = {
        date: '2026-08-03', broker: 'schwab', account: 'Individual ...001',
        type: 'transfer_in', ticker: 'DRAM', currency: 'USD', quantity: 195,
        carried_cost_basis_raw: '10000', carried_cost_basis_status: 'known',
        carried_cost_basis_method_label: 'FIFO reconstructed',
    };
    const transactions = [
        {date: '2026-05-01', broker: 'ibkr', account: 'U00000001', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 145, price: 50},
        {date: '2026-06-11', broker: 'ibkr', account: 'U00000001', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 15, price: 61},
        {date: '2026-07-21', broker: 'ibkr', account: 'U00000001', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 15, price: 57},
        {date: '2026-07-23', broker: 'ibkr', account: 'U00000001', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 5, price: 59.25},
        {date: '2026-07-23', broker: 'ibkr', account: 'U00000001', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 5, price: 59},
        {date: '2026-06-01', broker: 'hsbc', account: '000-999999-999', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 210, price: 50},
        {date: '2026-08-01', broker: 'hsbc', account: '000-999999-999', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 56.258},
        schwabTransferIn,
    ];
    const previousWindow = globalThis.window;
    globalThis.window = {ANTIGRAVITY_INVESTMENT_DATA: {price_history_by_ticker: {}}};
    try {
        const metrics = createBrokerMetricsBuilder(transactions)(transactions, 'DRAM', 70);
        assert.deepEqual(
            metrics.map((metric) => ({
                broker: metric.brokerCode,
                account: metric.accountId,
                position: metric.positionDisplay,
                trades: metric.totalTrades,
            })).sort((left, right) => left.broker.localeCompare(right.broker)),
            [
                {broker: 'hsbc', account: '000-999999-999', position: '200', trades: 2},
                {broker: 'ibkr', account: 'U00000001', position: '105', trades: 5},
                {broker: 'schwab', account: 'Individual ...001', position: '195', trades: 0},
            ],
        );
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('broker metrics keep IBKR and other stock grants out of trade counts', () => {
    const transactions = [
        {broker: 'ibkr', account: 'U00000001', date: '2026-08-01', type: 'grant', ticker: 'DRAM', currency: 'USD', quantity: 2, price: 50},
        {broker: 'hsbc', account: '000-999999-999', date: '2026-08-01', type: 'grant', ticker: 'DRAM', currency: 'USD', quantity: 2, price: 50},
    ];
    const previousWindow = globalThis.window;
    globalThis.window = {ANTIGRAVITY_INVESTMENT_DATA: {price_history_by_ticker: {}}};
    try {
        const metrics = createBrokerMetricsBuilder(transactions)(transactions, 'DRAM', 60);
        assert.deepEqual(
            metrics.map((metric) => ({
                broker: metric.brokerCode,
                position: metric.positionDisplay,
                trades: metric.totalTrades,
            })).sort((left, right) => left.broker.localeCompare(right.broker)),
            [
                {broker: 'hsbc', position: '2', trades: 0},
                {broker: 'ibkr', position: '2', trades: 0},
            ],
        );
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('range normalization rejects stale browser values', () => {
    assert.equal(normalizeInvestmentRange(' 1W ', rangeOptions), '1w');
    assert.equal(normalizeInvestmentRange('1y', rangeOptions), 'max');
    assert.equal(isInvestmentStockDetailsIntradayRange('1W', rangeOptions), true);
});

test('intraday minute keys are normalized without seconds', () => {
    assert.equal(normalizeInvestmentIntradayMinuteKey('2026-07-21 09:31:59'), '2026-07-21 09:31');
    assert.equal(normalizeInvestmentIntradayMinuteKey('invalid'), '');
});

test('intraday OHLC normalization removes zero and malformed price bars', () => {
    assert.deepEqual(
        normalizeInvestmentStockDetailsIntradayRows([
            {date: '2026-08-06 09:30', open: 24, high: 25, low: 23, close: 24.5},
            {date: '2026-08-06 09:31', open: 0, high: 25, low: 0, close: 24.5},
            {date: '2026-08-06 09:32', open: 24, high: 23, low: 22, close: 23.5},
            {date: '2026-08-06 09:33', open: 24, high: 25, low: 23, close: 24.25},
        ]),
        [
            {date: '2026-08-06 09:30', open: 24, high: 25, low: 23, close: 24.5},
            {date: '2026-08-06 09:33', open: 24, high: 25, low: 23, close: 24.25},
        ],
    );
});

test('intraday boundaries retain first and last indexes for each trading day', () => {
    const labels = ['2026-07-20 09:30', '2026-07-20 09:31', '2026-07-21 09:30'];
    const fallback = buildInvestmentIntradayDayFallbackIndex(labels, normalizeDate);
    const boundaries = buildInvestmentIntradayDayBoundaries(labels, normalizeDate);
    assert.equal(fallback.get('2026-07-20'), 1);
    assert.deepEqual(boundaries.orderedDays[0], {
        dayKey: '2026-07-20',
        ordinal: 0,
        firstIndex: 0,
        lastIndex: 1,
    });
});

test('daily replay assigns a non-trading-day transaction to the next market close', () => {
    const labels = ['2026-05-29', '2026-06-01', '2026-06-02'];
    assert.equal(
        resolveInvestmentStockDetailsDailySnapshotIndex('2026-05-31', labels, normalizeDate),
        1,
    );
    assert.equal(
        resolveInvestmentStockDetailsDailySnapshotIndex('2026-05-28', labels, normalizeDate),
        null,
    );
    assert.equal(
        resolveInvestmentStockDetailsDailySnapshotIndex('2026-06-03', labels, normalizeDate),
        null,
    );
});

test('trade sessions use New York market boundaries', () => {
    const parse = (value) => {
        const [, hours, minutes] = String(value).match(/^(\d{2}):(\d{2})$/) || [];
        return hours === undefined ? null : {hours: Number(hours), minutes: Number(minutes)};
    };
    assert.equal(getInvestmentTradeSessionType('04:00', parse), 'pre');
    assert.equal(getInvestmentTradeSessionType('09:30', parse), 'intraday');
    assert.equal(getInvestmentTradeSessionType('16:00', parse), 'post');
    assert.equal(getInvestmentTradeSessionType('20:00', parse), 'night');
});

test('trailing off-hours markers anchor after the last visible regular session', () => {
    const lastVisibleDay = '2026-08-17';
    assert.equal(
        resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
            {date: '2026-08-18', datetime: '2026-08-18 00:20:00'},
            'night',
            lastVisibleDay,
        ),
        lastVisibleDay,
    );
    assert.equal(
        resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
            {date: '2026-08-18', datetime: '2026-08-18 05:00:00'},
            'pre',
            lastVisibleDay,
        ),
        lastVisibleDay,
    );
    assert.equal(
        resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
            {date: lastVisibleDay, datetime: `${lastVisibleDay} 22:19:00`},
            'night',
            lastVisibleDay,
        ),
        lastVisibleDay,
    );
    assert.equal(
        resolveInvestmentStockDetailsTrailingOffHoursAnchorDayKey(
            {date: lastVisibleDay, datetime: `${lastVisibleDay} 05:45:00`},
            'pre',
            lastVisibleDay,
        ),
        '',
    );
});

test('date-only HSBC order-status trades anchor to the regular-session close', () => {
    const parse = (value) => {
        const [, hours, minutes] = String(value).match(/^(?:.* )?(\d{2}):(\d{2})(?::\d{2})?$/) || [];
        return hours === undefined ? null : {hours: Number(hours), minutes: Number(minutes)};
    };
    const transaction = {
        datetime: '2026-08-03 20:00:00',
        source: {file_kind: 'hsbc_order_status_text'},
    };
    assert.equal(isInvestmentTransactionDateOnly(transaction), true);
    assert.equal(
        getInvestmentStockDetailsTransactionSessionType(
            transaction,
            transaction.datetime,
            (value) => getInvestmentTradeSessionType(value, parse),
        ),
        'intraday',
    );
    assert.equal(
        getInvestmentStockDetailsTransactionSessionType(
            {datetime: '2026-08-03 20:00:00', source: {file_kind: 'ibkr_transfers'}},
            '2026-08-03 20:00:00',
            (value) => getInvestmentTradeSessionType(value, parse),
        ),
        'night',
    );
});
