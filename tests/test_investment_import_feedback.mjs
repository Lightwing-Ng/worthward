/* Tests for Investment import-feedback markup. Code version: v1.7.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
    buildHsbcImportFeedbackMessage,
    buildIbkrImportFeedbackMessage,
    buildInvestmentImportFeedbackListHtml,
    buildSchwabImportFeedbackMessage,
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
    assert.match(message, /1 possible internal-transfer match<\/strong>/);
    assert.doesNotMatch(message, /1 possible internal-transfer matches<\/strong>/);
});

test('IBKR feedback escapes refresh and valuation notices while pluralizing transfer review', () => {
    const message = buildIbkrImportFeedbackMessage({
        refreshNotice: '<rebuild>& retry',
        valuationNotice: '"quoted" <value>',
        pendingTransferCount: 2,
    }, {escapeHtml});

    assert.match(message, /2 possible internal-transfer matches<\/strong>/);
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

test('Schwab feedback reports snapshot evidence and ambiguous in-kind transfer review', () => {
    const message = buildSchwabImportFeedbackMessage({
        importSummary: {
            incremental_import: {
                imported_record_count: 2,
                added_record_count: 2,
            },
        },
        pendingTransferCount: 1,
    }, {escapeHtml});

    assert.match(message, /Charles Schwab import complete/);
    assert.match(message, /authoritative <strong>Positions<\/strong> snapshot/);
    assert.match(message, /SHA-256-verified immutable evidence/);
    assert.match(message, /1 in-kind transfer counterpart<\/strong>/);
    assert.match(message, /Same-day ticker-and-quantity similarity never creates an automatic link/);
});

test('Schwab feedback preserves unmatched inbound receipts without inventing a source leg', () => {
    const message = buildSchwabImportFeedbackMessage({
        importSummary: {
            schwab_positions_validation: {status: 'matched'},
            holdings_validation: {mismatch_count: 0},
            security_transfer_reconciliation: {
                unreconciled_inbound_count: 2,
                aggregate_holdings_available: false,
                pnl_unavailable_tickers: ['DRAM', 'QQQI'],
            },
        },
    }, {escapeHtml});

    assert.match(message, /Positions Total<\/strong> reconciled/);
    assert.match(message, /Receipt review required/);
    assert.match(message, /Only unresolved receipt rows are excluded from All brokers Holdings and Equity/);
    assert.match(message, /no source-broker transfer-out was created or inferred/);
    assert.match(message, /P&amp;L is unavailable only for <strong class="notice-floating-banner-emphasis-danger">DRAM, QQQI<\/strong>/);
});

test('Schwab feedback explains an aggregate-only source-account overlay', () => {
    const message = buildSchwabImportFeedbackMessage({
        importSummary: {
            security_transfer_reconciliation: {
                aggregate_holdings_available: true,
                aggregate_overlay: {active_receipt_keys: ['v2:receipt']},
                pnl_unavailable_tickers: ['QQQI'],
            },
        },
    }, {escapeHtml});

    assert.match(message, /Aggregate-only confirmation/);
    assert.match(message, /user-attested net-neutral overlay/);
    assert.match(message, /automatically superseded when exact source evidence is imported/);
});

test('Schwab feedback requires the composition root HTML escaper', () => {
    assert.throws(
        () => buildSchwabImportFeedbackMessage(),
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
