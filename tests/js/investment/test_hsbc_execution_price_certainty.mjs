/* Code version: v1.0.0
 * Keep cash settlement independent of price certainty in established history descriptions.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {createUtils, parseInvestmentOptionalNumber} from './data_utils/context.mjs';
import {isHsbcSettlementActuallyPending} from '../../../app/web/static/assets/js/investment/data-utils.js';
import {createInvestmentExportHistoryRuntime} from '../../../app/web/static/assets/js/investment/runtime/export-history.js';

const originalWindow = globalThis.window;
beforeEach(() => {
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {}};
});
afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
});

function settledSell(status = 'settled_cash_price_unconfirmed') {
    return {
        ledger_no: 1,
        broker: 'hsbc', account: 'HSBC-ANONYMOUS', ticker: 'ALFA', type: 'sell',
        date: '2026-03-02', currency: 'USD', quantity_abs: '1', display_amount: 123.45,
        normalized: {unit_price: '123.45', net_amount: '123.45', commission: '-0.02'},
        source: {
            statement_order_id: 'S-900123', cash_settlement_amount_raw: '123.45',
            execution_price_status: status,
        },
    };
}

function historyRenderer() {
    const runtime = {
        ...createUtils(),
        isHsbcSettlementActuallyPending,
        getOptionalInvestmentNumber: parseInvestmentOptionalNumber,
        normalizeInvestmentBroker: (value) => String(value || '').trim().toLowerCase(),
        getTransactionBrokerCode: (txn) => txn.broker,
        getInvestmentBrokerMeta: () => ({label: 'HSBC', logoUrl: ''}),
        getInvestmentResolvedTransferDescription: () => '',
        getInvestmentInternalTransferDirection: () => '',
        formatInvestmentHistoryCurrencyDisplay: (txn) => txn.currency,
        formatTransactionDateDisplay: (txn) => txn.date,
        formatEventType: (value) => value,
        formatAmount: (value) => String(value ?? '-'),
        formatUsd: (value) => String(value ?? '-'),
        renderWorkspaceMetricValueContent: String,
        state: {},
    };
    return createInvestmentExportHistoryRuntime(runtime);
}

test('settled cash with an unconfirmed fill retains the established description without a pending reference', () => {
    const utils = createUtils();
    const txn = settledSell();
    const before = structuredClone(txn);

    assert.equal(utils.formatTransactionDescription(txn), 'ALFA @ 123.45 × 1 · S-900123');
    assert.equal(isHsbcSettlementActuallyPending(txn.source), false);
    assert.deepEqual(txn, before);
});

test('ordinary and existing final prices retain their original description', () => {
    const utils = createUtils();
    for (const status of [undefined, 'final_settled', 'provisional_pending_settlement']) {
        const txn = settledSell(status);
        if (status === undefined) delete txn.source.execution_price_status;

        assert.equal(utils.formatTransactionDescription(txn), 'ALFA @ 123.45 × 1 · S-900123');
        assert.equal(isHsbcSettlementActuallyPending(txn.source), false);
    }
});

test('a genuinely pending cash settlement retains its order-reference marker', () => {
    const utils = createUtils();
    const txn = settledSell('provisional_pending_settlement');
    delete txn.source.cash_settlement_amount_raw;
    txn.source.cash_replay_pending_settlement = true;

    assert.equal(utils.formatTransactionDescription(txn), 'ALFA @ 123.45 × 1 · S-900123*');
    assert.equal(isHsbcSettlementActuallyPending(txn.source), true);
});

test('the export row retains the established description when cash provisional markers are disabled', () => {
    const renderer = historyRenderer();
    const html = renderer.renderInvestmentHistoryRowMarkup(settledSell(), {
        includeProvisionalMarker: false,
        includeAttributionControls: false,
    });

    assert.ok(html.includes('ALFA @ 123.45 × 1 · S-900123'));
    assert.ok(!html.includes('S-900123*'));
    assert.ok(!html.includes('(limit)'));
});

test('the export row does not label an existing final price as a limit', () => {
    const renderer = historyRenderer();
    const html = renderer.renderInvestmentHistoryRowMarkup(settledSell('final_settled'), {
        includeProvisionalMarker: false,
        includeAttributionControls: false,
    });

    assert.ok(html.includes('ALFA @ 123.45 × 1 · S-900123'));
    assert.ok(!html.includes('(limit)'));
});
