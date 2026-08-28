/* Tests for Investment import-feedback markup. Code version: v1.9.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION,
    buildHsbcImportFeedbackMessage,
    buildIbkrImportFeedbackMessage,
    buildInvestmentImportFeedbackListHtml,
    buildSchwabImportFeedbackMessage,
    countNewInvestmentPendingTransferRows,
    getInvestmentPendingTransferSourceKeys,
    resolveInvestmentImportFeedbackSummary,
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
    assert.equal(INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION, 'v1.9.0');
});

test('pending transfer source keys include only actionable Unbound rows', () => {
    const keys = getInvestmentPendingTransferSourceKeys([
        {
            manual_internal_transfer_source_key: 'pending-a',
            manual_internal_transfer_needs_binding: true,
            manual_internal_transfer_candidate_count: 2,
        },
        {
            manual_internal_transfer_source_key: 'bound-b',
            manual_internal_transfer_needs_binding: false,
            manual_internal_transfer_candidate_count: 1,
        },
        {
            manual_internal_transfer_source_key: 'candidate-free-c',
            manual_internal_transfer_needs_binding: true,
            manual_internal_transfer_candidate_count: 0,
        },
    ]);

    assert.deepEqual([...keys], ['pending-a']);
});

test('completed import counts only newly actionable transfer rows', () => {
    const beforeSourceKeys = new Set(['stale-a', 'stale-b', 'stale-c']);
    const refreshedTransactions = [
        ...[...beforeSourceKeys].map((sourceKey) => ({
            manual_internal_transfer_source_key: sourceKey,
            manual_internal_transfer_needs_binding: true,
            manual_internal_transfer_candidate_count: 1,
        })),
        {
            manual_internal_transfer_source_key: 'new-d',
            manual_internal_transfer_needs_binding: true,
            manual_internal_transfer_candidate_count: 2,
        },
    ];

    assert.equal(countNewInvestmentPendingTransferRows({
        beforeSourceKeys,
        refreshedTransactions: refreshedTransactions.slice(0, 3),
    }), 0);
    assert.equal(countNewInvestmentPendingTransferRows({
        beforeSourceKeys,
        refreshedTransactions,
    }), 1);
});

test('feedback summary prefers the freshly reloaded merged ledger', () => {
    const refreshedSummary = { security_transfer_reconciliation: { pnl_status: 'available' } };
    const staleImportSummary = { security_transfer_reconciliation: { pnl_unavailable_tickers: ['DRAM', 'QQQI'] } };

    assert.equal(
        resolveInvestmentImportFeedbackSummary({
            refreshedSummary,
            importSummary: staleImportSummary,
        }),
        refreshedSummary,
    );
    assert.deepEqual(
        resolveInvestmentImportFeedbackSummary({ importSummary: staleImportSummary }),
        staleImportSummary,
    );
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
    assert.match(message, /Transfer review/);
    assert.match(message, /<strong>1 internal-transfer row became newly actionable and remains marked Unbound in Transaction history\.<\/strong>/);
    assert.match(message, /pre-existing and already-bound transfers require no further action/);
    assert.doesNotMatch(message, /Immediate action/);
    assert.doesNotMatch(message, /notice-floating-banner-emphasis-danger/);
});

test('IBKR feedback escapes refresh and valuation notices while pluralizing transfer review', () => {
    const message = buildIbkrImportFeedbackMessage({
        refreshNotice: '<rebuild>& retry',
        valuationNotice: '"quoted" <value>',
        pendingTransferCount: 2,
    }, {escapeHtml});

    assert.match(message, /<strong>2 internal-transfer rows became newly actionable and remain marked Unbound in Transaction history\.<\/strong>/);
    assert.match(message, /Review only those newly affected rows/);
    assert.doesNotMatch(message, /Immediate action/);
    assert.doesNotMatch(message, /notice-floating-banner-emphasis-danger/);
    assert.match(message, /&lt;rebuild&gt;&amp; retry/);
    assert.match(message, /&quot;quoted&quot; &lt;value&gt;/);
    assert.doesNotMatch(message, /<rebuild>/);
    assert.doesNotMatch(message, /"quoted" <value>/);
});

test('IBKR feedback omits transfer review when no candidates remain unbound', () => {
    const message = buildIbkrImportFeedbackMessage({
        pendingTransferCount: 0,
    }, {escapeHtml});

    assert.doesNotMatch(message, /Transfer review/);
    assert.doesNotMatch(message, /Immediate action/);
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

test('Schwab feedback omits stale unavailable warnings after all receipts reconcile', () => {
    const message = buildSchwabImportFeedbackMessage({
        importSummary: {
            schwab_positions_validation: {status: 'matched'},
            holdings_validation: {mismatch_count: 0},
            security_transfer_reconciliation: {
                aggregate_holdings_available: true,
                matched_count: 5,
                manual_match_count: 5,
                pnl_status: 'available',
                pnl_unavailable_tickers: [],
                unreconciled_inbound_count: 0,
                unreconciled_outbound_count: 0,
            },
        },
        pendingTransferCount: 0,
    }, {escapeHtml});

    assert.doesNotMatch(message, /Receipt review required/);
    assert.doesNotMatch(message, /P&amp;L unavailable/);
    assert.doesNotMatch(message, /Manual review required/);
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
                    pending_order_ids: ['P-900009'],
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

test('HSBC feedback distinguishes transferable cash from pending-sell display cash', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_pending_settlement_cash: '481.200',
            hsbc_broker_cash_estimate: '20926.170',
            holdings_validation: {mismatch_count: 3},
        },
    }, {escapeHtml});

    assert.match(message, /transferable cash remains <strong>\$20,444\.97<\/strong>/);
    assert.match(message, /show <strong>\$20,926\.17<\/strong>/);
    assert.match(message, /incomplete replay as a historical balance/);
});

test('HSBC feedback renders the signed net pending-order estimate without unposted sell fees', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_pending_settlement_cash: '1576.750',
            hsbc_broker_cash_estimate: '22685.810',
        },
    }, {escapeHtml});

    assert.match(message, /transferable cash remains <strong>\$21,109\.06<\/strong>/);
    assert.match(message, /show <strong>\$22,685\.81<\/strong>/);
    assert.match(message, /signed net unsettled buy\/sell amount <strong>\$\+1,576\.75<\/strong>/);
    assert.match(message, /Unposted sell clearing fees and other settlement adjustments are not included/);
});

test('HSBC feedback omits transferable-cash copy without a provisional marker', () => {
    const message = buildHsbcImportFeedbackMessage({
        importSummary: {
            hsbc_final_settled_execution_count: 11,
            hsbc_pending_settlement_cash: '0.00',
            hsbc_broker_cash_estimate: '21111.36',
        },
    }, {escapeHtml});

    assert.match(message, /authoritative position source/);
    assert.match(message, /<strong>11<\/strong> execution prices were finalized/);
    assert.doesNotMatch(message, /transferable cash remains/);
    assert.equal((message.match(/<li>/g) || []).length, 2);
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
