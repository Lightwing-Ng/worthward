/* HSBC dividend attribution controls and browser-write boundaries.
 * Code version: v1.0.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentDividendAttributionRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/dividend-attribution.js';
import {
    createInvestmentExportHistoryRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/export-history.js';

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function createRuntime(overrides = {}) {
    const runtime = {
        escapeHtml,
        formatTransactionDescription: (txn) => txn.ticker
            ? `${txn.ticker} · ${txn.description}`
            : txn.description,
        formatInvestmentTickerForDisplay: (ticker) => ticker,
        ensureInvestmentImportSession: async () => true,
        describeInvestmentImportSessionFailure: () => 'The browser session is unavailable.',
        buildInvestmentRequestOptions: (options) => ({
            ...options,
            headers: {...options.headers, 'X-CSRF-Token': 'dividend-test-token'},
        }),
        ...overrides,
    };
    Object.assign(runtime, createInvestmentDividendAttributionRuntime(runtime));
    return runtime;
}

function dividend(overrides = {}) {
    return {
        broker: 'hsbc',
        type: 'dividend',
        ticker: '',
        description: 'CORP EVT PAYMENT SEC',
        dividend_attribution_key: 'hsbc-dividend:test-row',
        dividend_attribution_candidates: ['EUV', 'QQQI'],
        source: {dividend_attribution_status: 'unavailable_from_hsbc_cash_text'},
        ...overrides,
    };
}

function withFetch(t, fetcher) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    t.after(() => { globalThis.fetch = previousFetch; });
}

test('unresolved dividends offer an explicit empty choice without selecting a candidate', () => {
    const runtime = createRuntime();
    const txn = dividend();
    const before = structuredClone(txn);
    const markup = runtime.renderInvestmentDividendAttributionMarkup(txn);

    assert.match(markup, /CORP EVT PAYMENT SEC/);
    assert.match(markup, /Select dividend ticker\.\.\./);
    assert.match(markup, /aria-label="Match this HSBC dividend to a ticker"/);
    assert.match(markup, /data-investment-dividend-attribution-key="hsbc-dividend:test-row"/);
    assert.match(markup, /<option[^>]+value="QQQI"/);
    assert.doesNotMatch(markup, /<option[^>]+value="(?:EUV|QQQI)"[^>]*\bselected\b/);
    assert.deepEqual(txn, before);
});

test('user-confirmed attribution remains selectable and can be cleared', () => {
    const runtime = createRuntime();
    const markup = runtime.renderInvestmentDividendAttributionMarkup(dividend({
        ticker: 'QQQI',
        source: {dividend_attribution_status: 'user_confirmed'},
    }));

    assert.match(markup, /QQQI · CORP EVT PAYMENT SEC/);
    assert.match(markup, /data-investment-dividend-attribution-ticker="QQQI"/);
    assert.match(markup, /<option[^>]+value="QQQI"[^>]*\bselected\b/);
    assert.match(markup, /<option[^>]+value=""/);
});

test('only server-identified rows receive an attribution control', () => {
    const runtime = createRuntime();
    assert.equal(runtime.renderInvestmentDividendAttributionMarkup(dividend({
        dividend_attribution_key: '',
    })), '');
    assert.equal(runtime.renderInvestmentDividendAttributionMarkup({
        broker: 'schwab', type: 'dividend', ticker: 'QQQI', description: 'Cash dividend',
    }), '');
});

test('broker descriptions, evidence keys, and ticker options are escaped as text', () => {
    const runtime = createRuntime();
    const markup = runtime.renderInvestmentDividendAttributionMarkup(dividend({
        description: '<img src=x onerror=alert(1)>',
        dividend_attribution_key: 'key" onclick="alert(2)',
        dividend_attribution_candidates: ['QQQI', '<svg onload=alert(3)>'],
    }));
    assert.doesNotMatch(markup, /<img\b|<svg\b/);
    assert.match(markup, /&lt;img/);
    assert.match(markup, /key&quot; onclick=&quot;alert\(2\)/);
    assert.match(markup, /&lt;svg/);
});

test('history exports preserve the description without exposing dropdown choices', () => {
    const runtime = createRuntime({
        state: {
            investmentInternalTransferSourceOptionsByKey: new Map(),
            investmentInternalTransferResolvedBindingsBySourceKey: new Map(),
        },
        getOptionalInvestmentNumber: (value) => Number.isFinite(Number(value)) ? Number(value) : null,
        normalizeInvestmentBroker: (value) => value,
        getTransactionBrokerCode: (txn) => txn.broker,
        getNormalizedTransactionType: (txn) => txn.type,
        isHsbcSettlementActuallyPending: () => false,
        getInvestmentResolvedTransferDescription: () => '',
        getInvestmentInternalTransferDirection: () => '',
        formatInvestmentHistoryCurrencyDisplay: (txn) => txn.currency,
        getInvestmentBrokerMeta: () => ({label: 'HSBC'}),
        formatTransactionDateDisplay: (txn) => txn.date,
        formatEventType: (type) => type,
        formatAmount: (amount) => String(amount ?? ''),
        formatTransactionCommissionDisplay: () => '-',
        renderWorkspaceMetricValueContent: (value) => value,
    });
    const exports = createInvestmentExportHistoryRuntime(runtime);
    const txn = dividend({date: '2026-06-22', currency: 'USD', display_amount: 12.34});

    assert.match(exports.renderInvestmentHistoryRowMarkup(txn), /investment-dividend-attribution-select/);
    const markup = exports.renderInvestmentHistoryRowMarkup(txn, {includeAttributionControls: false});
    assert.match(markup, /CORP EVT PAYMENT SEC/);
    assert.match(markup, /12\.34/);
    assert.doesNotMatch(markup, /investment-dividend-attribution-select|Select dividend ticker|<option\b/);
});

test('saving attribution uses the browser session and exact evidence key', async (t) => {
    const requests = [];
    let sessionChecks = 0;
    withFetch(t, async (url, options) => {
        requests.push({url, options});
        return {ok: true, json: async () => ({success: true, record_key: 'evidence-key', ticker: 'QQQI'})};
    });
    const runtime = createRuntime({
        ensureInvestmentImportSession: async () => { sessionChecks += 1; return true; },
    });

    const result = await runtime.rememberInvestmentDividendAttribution('evidence-key', 'QQQI');
    assert.equal(sessionChecks, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/investment/dividend-attribution');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'dividend-test-token');
    assert.deepEqual(JSON.parse(requests[0].options.body), {record_key: 'evidence-key', ticker: 'QQQI'});
    assert.equal(result.ticker, 'QQQI');
});

test('clearing an attribution sends an explicit empty ticker', async (t) => {
    let body;
    withFetch(t, async (_url, options) => {
        body = JSON.parse(options.body);
        return {ok: true, json: async () => ({success: true, record_key: 'evidence-key', ticker: ''})};
    });
    await createRuntime().rememberInvestmentDividendAttribution('evidence-key', '');
    assert.deepEqual(body, {record_key: 'evidence-key', ticker: ''});
});

test('an unavailable session stops the write before fetch', async (t) => {
    let requests = 0;
    withFetch(t, async () => { requests += 1; throw new Error('Unexpected request'); });
    const runtime = createRuntime({ensureInvestmentImportSession: async () => false});

    await assert.rejects(runtime.rememberInvestmentDividendAttribution('evidence-key', 'QQQI'), /session is unavailable/);
    assert.equal(requests, 0);
});

test('a rejected or malformed response cannot count as saved attribution', async (t) => {
    let response = {ok: false, json: async () => ({success: false, error: 'The record changed. Reload before matching.'})};
    withFetch(t, async () => response);
    const runtime = createRuntime();
    await assert.rejects(runtime.rememberInvestmentDividendAttribution('evidence-key', 'QQQI'), /record changed/);

    response = {ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); }};
    await assert.rejects(runtime.rememberInvestmentDividendAttribution('evidence-key', 'QQQI'));
});
