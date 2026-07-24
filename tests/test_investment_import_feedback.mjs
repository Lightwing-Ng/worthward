/* Tests for Investment import-feedback markup. Code version: v1.2.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
    buildHsbcImportFeedbackMessage,
    buildIbkrImportFeedbackMessage,
    buildInvestmentImportFeedbackListHtml,
} from '../app/web/static/assets/js/investment/import-feedback.js';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('feedback list removes blank values without altering trusted rich markup', () => {
    const html = buildInvestmentImportFeedbackListHtml(['', '  ', '<strong>Ready</strong>']);

    assert.equal(buildInvestmentImportFeedbackListHtml([]), '');
    assert.equal(buildInvestmentImportFeedbackListHtml('not a list'), '');
    assert.match(html, /^<ol class="notice-floating-banner-list investment-import-feedback-list">/);
    assert.match(html, /<li><strong>Ready<\/strong><\/li>/);
    assert.equal((html.match(/<li>/g) || []).length, 1);
});

test('IBKR feedback preserves verified source-evidence copy and singular transfer review', () => {
    const message = buildIbkrImportFeedbackMessage({
        importSummary: {
            incremental_import: {
                imported_record_count: 12_345,
                added_record_count: 1_234,
                duplicate_record_count: 11_111,
            },
        },
        pendingTransferCount: 1,
    }, {escapeHtml});

    assert.match(message, /This run parsed <strong>12,345<\/strong> records, added <strong>1,234<\/strong>, and treated <strong>11,111<\/strong> as already present\./);
    assert.match(message, /SHA-256-verified immutable evidence/);
    assert.match(message, /1 possible HSBC transfer match<\/strong>/);
    assert.doesNotMatch(message, /1 possible HSBC transfer matches<\/strong>/);
});

test('IBKR feedback escapes refresh and valuation notices while pluralizing transfer review', () => {
    const message = buildIbkrImportFeedbackMessage({
        refreshNotice: '<rebuild>& retry',
        valuationNotice: '"quoted" <value>',
        pendingTransferCount: 2,
    }, {escapeHtml});

    assert.match(message, /2 possible HSBC transfer matches<\/strong>/);
    assert.match(message, /&lt;rebuild&gt;&amp; retry/);
    assert.match(message, /&quot;quoted&quot; &lt;value&gt;/);
    assert.doesNotMatch(message, /<rebuild>/);
    assert.doesNotMatch(message, /"quoted" <value>/);
});

test('IBKR feedback requires the composition root HTML escaper', () => {
    assert.throws(
        () => buildIbkrImportFeedbackMessage(),
        /requires an HTML escape function/,
    );
});

test('HSBC feedback requires the composition root HTML escaper', () => {
    assert.throws(
        () => buildHsbcImportFeedbackMessage(),
        /requires an HTML escape function/,
    );
});

test('HSBC feedback explains rolling order coverage and pending cash settlement', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_snapshot: {
                order_status_coverage: {
                    mode: 'rolling_recent_window',
                    calendar_days: '17',
                },
                cash_posting_status: 'awaiting_settlement',
                cash_latest_post_date: '2026-07-21',
                execution_price_reconciliation: {
                    pending_order_ids: ['P-725710'],
                },
            },
            hsbc_portfolio_calibrated_order_count: 1,
        },
    }, {escapeHtml});

    assert.match(message, /authoritative position source/);
    assert.match(message, /last <strong>17 calendar days<\/strong>/);
    assert.match(message, /available balance<\/strong>/);
    assert.match(message, /2026-07-21/);
    assert.match(message, /original Order Status limit price remains in source metadata/);
    assert.match(message, /newer executed order remains provisional/);
});

test('HSBC feedback explains when settled cash finalizes execution price', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_snapshot: {
                execution_price_reconciliation: {
                    status: 'settled',
                },
            },
            hsbc_final_settled_execution_count: 1,
            hsbc_portfolio_calibrated_order_count: 1,
        },
    }, {escapeHtml});

    assert.match(message, /finalized from the settled USD Savings cash flow/);
    assert.match(message, /provisional Portfolio calibration/);
});

test('HSBC feedback escapes dynamic dates and rolling-window values', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_snapshot: {
                order_status_coverage: {
                    mode: 'rolling_recent_window',
                    calendar_days: '<17>',
                },
                cash_posting_status: 'awaiting_settlement',
                cash_latest_post_date: '<latest>',
            },
        },
    }, {escapeHtml});

    assert.match(message, /&lt;17&gt;/);
    assert.match(message, /&lt;latest&gt;/);
    assert.doesNotMatch(message, /<17>/);
    assert.doesNotMatch(message, /<latest>/);
});
