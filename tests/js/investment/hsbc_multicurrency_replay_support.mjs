/* Compact anonymized HSBC multicurrency replay fixture. Code version: v1.0.0 */
import {
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    createInvestmentDataUtils,
    filterAggregateOnlyOverlayTransactions,
    getInvestmentAggregatePnlCoverage,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    isHsbcSettlementActuallyPending,
    parseInvestmentOptionalNumber,
} from '../../../app/web/static/assets/js/investment/data-utils.js';
import {
    normalizeInvestmentBroker,
} from '../../../app/web/static/assets/js/investment/transaction-filters.js';
import {createInvestmentRuntimeConfig} from '../../../app/web/static/assets/js/investment/runtime/config.js';
import {createInvestmentRealtimeChartRuntime} from '../../../app/web/static/assets/js/investment/runtime/realtime-chart.js';
import {createInvestmentWorkspaceControlsRuntime} from '../../../app/web/static/assets/js/investment/runtime/workspace-controls.js';
import {createInvestmentRangeTransferRuntime} from '../../../app/web/static/assets/js/investment/runtime/range-transfer.js';
import {createInvestmentStockHistoryFilterRuntime} from '../../../app/web/static/assets/js/investment/runtime/stock-history-filters.js';
import {createInvestmentBindingPaginationRuntime} from '../../../app/web/static/assets/js/investment/runtime/binding-pagination.js';
import {createInvestmentImportWorkflowRuntime} from '../../../app/web/static/assets/js/investment/runtime/import-workflows.js';
import {createInvestmentExportHistoryRuntime} from '../../../app/web/static/assets/js/investment/runtime/export-history.js';
import {createInvestmentMetricsImportRuntime} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';
import {createInvestmentTransactionTableRuntime} from '../../../app/web/static/assets/js/investment/runtime/transaction-table.js';
import {createInvestmentFundingMetricsRuntime} from '../../../app/web/static/assets/js/investment/runtime/funding-metrics.js';

export const HSBC_TEST_ACCOUNT = 'HSBC-TEST-001';
const SCHWAB_TEST_ACCOUNT = 'SCHW-TEST-01';
const USD_OPENING_SHA = '1'.repeat(64);
const USD_LEGACY_MARKER_SHA = '2'.repeat(64);
const USD_SETTLEMENT_SHA = '3'.repeat(64);
const MULTICURRENCY_SHA = '4'.repeat(64);

function usdSavingsCash(date, type, amount, balance, rowNumber, sha, extraSource = {}) {
    return {
        broker: 'hsbc',
        account: HSBC_TEST_ACCOUNT,
        account_type: 'USD Savings',
        date,
        datetime: `${date} 20:00:00`,
        type,
        ticker: '',
        currency: 'USD',
        description: `TEST USD ${type.toUpperCase()} ${rowNumber}`,
        net_amount_raw: amount,
        gross_amount_raw: amount,
        commission_raw: '0',
        normalized: {net_amount: amount},
        source: {
            file_kind: 'hsbc_usd_account_text',
            broker: 'hsbc',
            account_number: HSBC_TEST_ACCOUNT,
            account_type: 'USD Savings',
            row_number: rowNumber,
            ledger_sequence: rowNumber,
            balance_after_raw: balance,
            cash_balance_scope: 'account',
            cash_balance_authoritative: true,
            source_sequence_sha256: sha,
            ...extraSource,
        },
    };
}

function foreignSavingsCash(date, type, currency, amount, balance, rowNumber, description) {
    return {
        broker: 'hsbc',
        account: HSBC_TEST_ACCOUNT,
        account_type: `${currency} Savings`,
        date,
        datetime: `${date} 20:00:00`,
        type,
        ticker: '',
        currency,
        description,
        net_amount_raw: amount,
        gross_amount_raw: amount,
        commission_raw: '0',
        normalized: {net_amount: amount},
        source: {
            file_kind: 'hsbc_multi_currency_cash_account_text',
            broker: 'hsbc',
            account_number: HSBC_TEST_ACCOUNT,
            account_type: `${currency} Savings`,
            row_number: rowNumber,
            ledger_sequence: rowNumber,
            balance_after_raw: balance,
            cash_balance_scope: 'account',
            cash_balance_authoritative: false,
            source_sequence_sha256: MULTICURRENCY_SHA,
        },
    };
}

function hsbcOrder(date, type, ticker, quantity, price, orderId, extraSource = {}) {
    const gross = (quantity * price).toFixed(2);
    const net = type === 'buy' ? `-${gross}` : gross;
    return {
        broker: 'hsbc',
        account: HSBC_TEST_ACCOUNT,
        date,
        datetime: `${date} 20:00:00`,
        type,
        ticker,
        currency: 'USD',
        description: `${type.toUpperCase()} ${ticker}`,
        quantity_raw: String(quantity),
        quantity_abs: String(quantity),
        price_raw: price.toFixed(2),
        gross_amount_raw: net,
        commission_raw: '0',
        net_amount_raw: net,
        normalized: {
            side: type,
            position_quantity: String(quantity),
            unit_price: price.toFixed(2),
            gross_amount: net,
            commission: '0',
            net_amount: net,
        },
        source: {
            file_kind: 'hsbc_order_status_text',
            broker: 'hsbc',
            account: HSBC_TEST_ACCOUNT,
            account_number: HSBC_TEST_ACCOUNT,
            order_id: orderId,
            statement_order_id: orderId,
            order_status: 'Fully Executed',
            ...extraSource,
        },
    };
}

function closes(rows) {
    return rows.map(([date, close]) => ({date, close}));
}

export function buildHsbcMulticurrencyPayload({withSecondBroker = false} = {}) {
    const transactions = [
        usdSavingsCash('2026-02-02', 'deposit', '30000.00', '30000.00', 1, USD_OPENING_SHA),
        hsbcOrder('2026-02-10', 'buy', 'ALFA', 100, 100, 'P-1000000'),
        hsbcOrder('2026-02-16', 'buy', 'CHRL', 2, 150, 'P-1000002'),
        usdSavingsCash('2026-02-26', 'deposit', '300.00', '20000.00', 2, USD_OPENING_SHA),
        // Unsettled proceeds are the source-bounded pending projection.
        hsbcOrder('2026-02-27', 'sell', 'CHRL', 2, 152.8, 'S-1000003', {
            cash_replay_pending_settlement: true,
        }),
        // A legacy pasted row restates its producer order with the CSV marker.
        // Its balance includes an earlier credit absent from this ledger.
        usdSavingsCash('2026-03-02', 'deposit', '1000.00', '21500.00', 4, USD_LEGACY_MARKER_SHA, {
            ledger_sequence_order: 'chronological',
        }),
        foreignSavingsCash('2026-03-03', 'deposit', 'HKD', '1950.00', '1950.00', 1, 'TEST HKD CREDIT'),
        foreignSavingsCash('2026-03-03', 'deposit', 'CNH', '420.00', '420.00', 2, 'TEST CNH CREDIT'),
        hsbcOrder('2026-03-04', 'buy', 'BRAV', 2, 145, 'P-1000001', {
            cash_settlement_date: '2026-03-05',
            cash_settlement_amount_raw: '-290.00',
            cash_settlement_postings: [{
                date: '2026-03-05',
                currency: 'USD',
                amount_raw: '-290.00',
                balance_after_raw: '21210.00',
                row_number: 5,
                ledger_sequence: 5,
                source_file_kind: 'hsbc_usd_account_text',
                source_sequence_sha256: USD_SETTLEMENT_SHA,
                account_number: HSBC_TEST_ACCOUNT,
                account_type: 'USD Savings',
                reference: 'REF P1000001001 SEC',
                role: 'principal',
            }],
        }),
        foreignSavingsCash('2026-03-05', 'deposit', 'CNH', '70.00', '490.00', 3, 'TEST CNH CREDIT'),
        foreignSavingsCash('2026-03-05', 'deposit', 'HKD', '312.00', '2262.00', 4, 'TEST HKD CREDIT'),
        // One same-day exchange converts all CNH into HKD.
        foreignSavingsCash('2026-03-06', 'withdrawal', 'CNH', '-490.00', '0.00', 5, 'TEST FX 0001'),
        foreignSavingsCash('2026-03-06', 'deposit', 'HKD', '542.88', '2804.88', 6, 'TEST FX 0001'),
    ];
    const brokerSummaries = {
        hsbc: {
            broker: 'hsbc',
            account: HSBC_TEST_ACCOUNT,
            ending_cash: '21210.00',
            ending_cash_raw: '21210.00',
            // Native USD Savings cash, not all currencies valued in USD.
            ending_cash_base_currency: '21210.00',
            ending_cash_base_currency_as_of: '2026-03-05',
            ending_cash_by_currency: {HKD: '2804.88', USD: '21210.00', CNH: '0.00'},
            cash_snapshot_as_of: '2026-03-06',
            cash_ledger_balance: '21210.00',
            cash_ledger_balance_as_of: '2026-03-05',
            hsbc_ending_cash_components: {
                'HKD:SAVINGS': '2804.88',
                'HKD:CURRENT': '0.00',
                'USD:SAVINGS': '21210.00',
                'CNH:SAVINGS': '0.00',
            },
            hsbc_cash_component_post_dates: {
                'HKD:SAVINGS': '2026-03-06',
                'HKD:CURRENT': '2026-01-20',
                'USD:SAVINGS': '2026-03-05',
                'CNH:SAVINGS': '2026-03-06',
            },
            hsbc_pending_settlement_cash: '305.600',
            hsbc_pending_settlement_order_count: 1,
            hsbc_broker_cash_estimate: '21515.600',
            hsbc_bank_available_cash: '21210.00',
            cash_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-03-06',
            position_snapshot_authoritative: true,
            position_snapshot: {
                ALFA: {quantity: '100', currency: 'USD', last_price: '101.00', market_value: '10100.00'},
                BRAV: {quantity: '2', currency: 'USD', last_price: '150.00', market_value: '300.00'},
            },
        },
    };
    const brokers = ['hsbc'];
    if (withSecondBroker) {
        brokers.push('schwab');
        transactions.push(
            {
                broker: 'schwab', account: SCHWAB_TEST_ACCOUNT, date: '2026-02-02',
                datetime: '2026-02-02 10:00:00', type: 'deposit', ticker: '', currency: 'USD',
                description: 'TEST SCHWAB DEPOSIT', net_amount_raw: '1000.00',
                normalized: {net_amount: '1000.00'}, source: {file_kind: 'test_fixture'},
            },
            {
                broker: 'schwab', account: SCHWAB_TEST_ACCOUNT, date: '2026-02-10',
                datetime: '2026-02-10 10:00:00', type: 'buy', ticker: 'ALFA', currency: 'USD',
                description: 'BUY ALFA', quantity_raw: '5', quantity_abs: '5', price_raw: '100.00',
                commission_raw: '0', net_amount_raw: '-500.00',
                normalized: {
                    side: 'buy', position_quantity: '5', unit_price: '100.00',
                    commission: '0', net_amount: '-500.00',
                },
                source: {file_kind: 'test_fixture'},
            },
        );
        brokerSummaries.schwab = {
            broker: 'schwab',
            account: SCHWAB_TEST_ACCOUNT,
            ending_cash: '500.00',
            ending_cash_as_of: '2026-03-05',
            cash_snapshot_authoritative: true,
        };
    }
    return {
        transactions,
        brokers,
        broker: withSecondBroker ? '' : 'hsbc',
        broker_summaries: brokerSummaries,
        summary: {
            authoritative_current_cash_brokers: [...brokers],
            position_snapshot_authoritative: false,
        },
        fx_rate_history_by_currency: {
            HKD: {dates: ['2026-02-02'], values: {'2026-02-02': 7.8}},
            CNH: {dates: ['2026-02-02'], values: {'2026-02-02': 7}},
        },
        price_history_by_ticker: {
            ALFA: closes([
                ['2026-02-10', 100], ['2026-02-16', 100], ['2026-02-27', 100],
                ['2026-03-02', 100], ['2026-03-03', 100], ['2026-03-04', 100.5],
                ['2026-03-05', 101],
            ]),
            BRAV: closes([['2026-03-04', 145], ['2026-03-05', 150]]),
            CHRL: closes([['2026-02-16', 150], ['2026-02-27', 152.8]]),
        },
        price_history_failures: [],
        money_market_tickers: [],
        cash_equivalent_tickers: [],
        ticker_lineage: {},
        realtime_quotes: [],
    };
}

const noop = () => {};

function fakeElement() {
    return {
        innerHTML: '',
        textContent: '',
        style: {},
        dataset: {},
        classList: {add: noop, remove: noop, toggle: noop, contains: () => false},
        setAttribute: noop,
        removeAttribute: noop,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop,
        removeEventListener: noop,
    };
}

function composeReplayRuntime(today) {
    const runtime = {
        state: {
            investmentChartPointsCache: [],
            investmentBaseChartPointsCache: [],
            investmentProcessedTransactionsCache: [],
            investmentReplaySnapshotsCache: [],
            investmentRawTransactionsCache: [],
            investmentInternalTransferSourceOptionsByKey: new Map(),
            investmentInternalTransferResolvedBindingsBySourceKey: new Map(),
            investmentSecurityTransferReceiptSourceOptionsByKey: new Map(),
            investmentAggregateSecurityTransferState: {
                blocked: false,
                reconciliationBlocked: false,
                activeReceiptKeys: new Set(),
                excludedReceiptKeys: new Set(),
                pnlUnavailableTickers: new Set(),
            },
            investmentChartPnlMetricsByPoint: new WeakMap(),
            investmentOverviewIntradayLinePointsCache: {key: '', points: [], quality: null},
            investmentOverviewIntradayRenderSerial: 0,
            selectedInvestmentEquityRange: 'max',
            investmentBrokerSummarySelectedCode: 'all',
            investmentBrokerFilterSelectedCodes: new Set(),
            investmentTickerSummariesCache: [],
        },
        INVESTMENT_REPLAY_ORDER_SYMBOL,
        applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
        filterAggregateOnlyOverlayTransactions,
        getInvestmentAggregatePnlCoverage,
        isHsbcSettlementActuallyPending,
        normalizeInvestmentBroker,
        parseInvestmentOptionalNumber,
        isLifecycleInterruptedFetch: (error) => error?.name === 'AbortError',
        investmentRealtimeQuotesByTicker: new Map(),
        investmentOverviewRealtimeLinePointsByMinute: new Map(),
    };
    Object.assign(runtime, createInvestmentRuntimeConfig(runtime));
    [
        createInvestmentRealtimeChartRuntime,
        createInvestmentWorkspaceControlsRuntime,
        createInvestmentRangeTransferRuntime,
        createInvestmentStockHistoryFilterRuntime,
        createInvestmentBindingPaginationRuntime,
        createInvestmentImportWorkflowRuntime,
        createInvestmentExportHistoryRuntime,
        createInvestmentMetricsImportRuntime,
        createInvestmentTransactionTableRuntime,
        createInvestmentFundingMetricsRuntime,
    ].forEach((createRuntime) => Object.assign(runtime, createRuntime(runtime)));
    Object.assign(runtime, createInvestmentDataUtils({
        noCommissionTransactionTypes: runtime.NO_COMMISSION_TRANSACTION_TYPES,
        investmentCommonSplitFactors: runtime.INVESTMENT_COMMON_SPLIT_FACTORS,
        parseInvestmentDateParts: runtime.parseInvestmentDateParts,
        formatInvestmentShortDateParts: runtime.formatInvestmentShortDateParts,
        normalizeInvestmentTicker: runtime.normalizeInvestmentTicker,
        normalizeInvestmentStockDetailsRange: runtime.normalizeInvestmentStockDetailsRange,
        normalizeInvestmentEquityRange: runtime.normalizeInvestmentEquityRange,
    }));
    // Only rendering, realtime, and network hooks are replaced.
    Object.assign(runtime, {
        getInvestmentHistoryTableBody: fakeElement,
        clearInvestmentHistoryHighlights: noop,
        syncInvestmentHistoryHeading: noop,
        setInvestmentExportButtonVisibility: noop,
        refreshInvestmentAvailableBrokerCodes: noop,
        loadInvestmentOverviewIntradayRows: async () => [],
        isInvestmentDailyEquityLiveRange: () => false,
        ensureInvestmentLiveSessionChartSlot: (points) => points,
        cancelInvestmentChartPnlResolution: noop,
        getInvestmentEmbeddedRealtimeQuotes: () => [],
        mergeInvestmentRealtimeQuotePayloads: () => [],
        rememberInvestmentRealtimeQuotes: noop,
        rememberInvestmentOverviewRealtimeLinePoint: noop,
        shouldApplyInvestmentRealtimePriceForHoldings: () => false,
        bootstrapInvestmentSessionRealtimeQuotes: async () => [],
        syncInvestmentStockDetailsLivePulse: noop,
        syncInvestmentHoldingsRealtimeValues: noop,
        initializeInvestmentBrokerFilterSelection: noop,
        mountInvestmentBrokerFilterHeaders: noop,
        mountInvestmentSideFilterHeaders: noop,
        mountInvestmentCurrencyFilterHeaders: noop,
        mountInvestmentDescriptionBindingFilterHeaders: noop,
        updateDashboardWithEquity: (...args) => args[4],
        renderInvestmentHistoryTableRows: noop,
        restartInvestmentRealtimeQuotePolling: noop,
        getTodayLedgerDate: () => today,
    });
    return runtime;
}

/**
 * Replay one payload through the production transaction-table pipeline and
 * inspect the result before the temporary browser globals are restored.
 */
export async function inspectInvestmentReplay(payload, inspect, {today = '2026-03-06'} = {}) {
    const previous = {
        window: globalThis.window,
        document: globalThis.document,
        fetch: globalThis.fetch,
    };
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: payload,
        WORTHWARD_APP: {},
        location: {pathname: '/trade/investment', search: '', hash: ''},
        setTimeout,
        clearTimeout,
        addEventListener: noop,
        removeEventListener: noop,
        matchMedia: () => ({matches: false, addEventListener: noop, removeEventListener: noop}),
    };
    globalThis.document = {
        visibilityState: 'visible',
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: fakeElement,
        addEventListener: noop,
        removeEventListener: noop,
    };
    globalThis.fetch = async (url) => {
        throw new Error(`The replay fixture must not request ${url}.`);
    };
    try {
        const runtime = composeReplayRuntime(today);
        await runtime.renderTransactionTable(payload.transactions, {scrollToTop: false});
        return await inspect({
            runtime,
            processed: runtime.state.investmentProcessedTransactionsCache,
            chartPoints: runtime.state.investmentBaseChartPointsCache,
        });
    } finally {
        Object.entries(previous).forEach(([name, value]) => {
            if (value === undefined) delete globalThis[name];
            else globalThis[name] = value;
        });
    }
}
