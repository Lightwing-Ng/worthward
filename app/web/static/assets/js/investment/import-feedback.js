/**
 * Pure Investment import-feedback markup builders.
 *
 * Code version: v1.3.0
 */

export const INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION = 'v1.3.0';

export function buildInvestmentImportFeedbackListHtml(items = []) {
    const normalizedItems = Array.isArray(items)
        ? items.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (!normalizedItems.length) return '';
    return `
        <ol class="notice-floating-banner-list investment-import-feedback-list">
            ${normalizedItems.map((item) => `<li>${item}</li>`).join('')}
        </ol>
    `.trim();
}

export function buildIbkrImportFeedbackMessage({
    importSummary = null,
    refreshNotice = '',
    valuationNotice = '',
    pendingTransferCount = 0,
} = {}, {
    escapeHtml,
} = {}) {
    if (typeof escapeHtml !== 'function') {
        throw new TypeError('IBKR import feedback requires an HTML escape function.');
    }

    const incrementalImport = importSummary && typeof importSummary === 'object'
        ? importSummary.incremental_import
        : null;
    const importedRecordCount = Number(incrementalImport?.imported_record_count);
    const addedRecordCount = Number(incrementalImport?.added_record_count);
    const duplicateRecordCount = Number(incrementalImport?.duplicate_record_count);
    const items = [
        'Matching records were merged <strong>incrementally</strong> into the local investment store <strong>without clearing older data first</strong>.',
        'Exact uploaded source files are retained locally as <strong>SHA-256-verified immutable evidence</strong>. The investment ledger retains only their verified manifests and metadata.',
    ];
    if (
        Number.isFinite(importedRecordCount)
        && Number.isFinite(addedRecordCount)
        && Number.isFinite(duplicateRecordCount)
    ) {
        items.unshift(
            `This run parsed <strong>${importedRecordCount.toLocaleString('en-US')}</strong> records, added <strong>${addedRecordCount.toLocaleString('en-US')}</strong>, and treated <strong>${duplicateRecordCount.toLocaleString('en-US')}</strong> as already present.`
        );
    }
    if (pendingTransferCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Immediate action</u>:</span> Review and bind <strong class="notice-floating-banner-emphasis-danger">${pendingTransferCount.toLocaleString('en-US')} possible internal-transfer ${pendingTransferCount === 1 ? 'match' : 'matches'}</strong> in Transaction history to remove duplicate-equity spikes.`
        );
    }
    const trimmedRefreshNotice = String(refreshNotice || '').trim();
    const trimmedValuationNotice = String(valuationNotice || '').trim();
    if (trimmedRefreshNotice) items.push(escapeHtml(trimmedRefreshNotice));
    if (trimmedValuationNotice) items.push(escapeHtml(trimmedValuationNotice));
    return `
        <p class="notice-floating-banner-heading">IBKR import complete</p>
        ${buildInvestmentImportFeedbackListHtml(items)}
    `.trim();
}

export function buildSchwabImportFeedbackMessage({
    importSummary = null,
    refreshNotice = '',
    pendingTransferCount = 0,
} = {}, {
    escapeHtml,
} = {}) {
    if (typeof escapeHtml !== 'function') {
        throw new TypeError('Schwab import feedback requires an HTML escape function.');
    }

    const incrementalImport = importSummary && typeof importSummary === 'object'
        ? importSummary.incremental_import
        : null;
    const importedRecordCount = Number(incrementalImport?.imported_record_count);
    const addedRecordCount = Number(incrementalImport?.added_record_count);
    const items = [
        'Transactions and the authoritative <strong>Positions</strong> snapshot were merged <strong>incrementally</strong> without clearing older records.',
        'Both uploaded CSV files are retained locally as <strong>SHA-256-verified immutable evidence</strong>.',
    ];
    if (Number.isFinite(importedRecordCount) && Number.isFinite(addedRecordCount)) {
        items.unshift(
            `This run parsed <strong>${importedRecordCount.toLocaleString('en-US')}</strong> records and added <strong>${addedRecordCount.toLocaleString('en-US')}</strong>.`
        );
    }
    if (pendingTransferCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Manual review required</u>:</span> Bind <strong class="notice-floating-banner-emphasis-danger">${pendingTransferCount.toLocaleString('en-US')} ambiguous in-kind transfer ${pendingTransferCount === 1 ? 'match' : 'matches'}</strong> in Transaction history. Exact same-day ticker-and-quantity pairs are linked automatically.`
        );
    }
    const trimmedRefreshNotice = String(refreshNotice || '').trim();
    if (trimmedRefreshNotice) items.push(escapeHtml(trimmedRefreshNotice));
    return `
        <p class="notice-floating-banner-heading">Charles Schwab import complete</p>
        ${buildInvestmentImportFeedbackListHtml(items)}
    `.trim();
}

export function buildHsbcImportFeedbackMessage({
    importSummary = null,
    refreshNotice = '',
} = {}, {
    escapeHtml,
} = {}) {
    if (typeof escapeHtml !== 'function') {
        throw new TypeError('HSBC import feedback requires an HTML escape function.');
    }

    const summary = importSummary && typeof importSummary === 'object' ? importSummary : {};
    const snapshot = summary.hsbc_snapshot && typeof summary.hsbc_snapshot === 'object'
        ? summary.hsbc_snapshot
        : {};
    const coverage = snapshot.order_status_coverage && typeof snapshot.order_status_coverage === 'object'
        ? snapshot.order_status_coverage
        : {};
    const items = [
        'Current holdings use the HSBC <strong>Portfolio</strong> snapshot as the authoritative position source.',
    ];
    if (coverage.mode === 'rolling_recent_window') {
        const calendarDays = escapeHtml(coverage.calendar_days || 'recent');
        items.push(
            `The copied <strong>Order Status</strong> page is a rolling recent-history window covering the last <strong>${calendarDays} calendar days</strong>; it is used to add current executed orders without replacing older history.`,
        );
    }
    if (snapshot.cash_posting_status === 'awaiting_settlement') {
        const latestCashDate = escapeHtml(snapshot.cash_latest_post_date || 'the latest visible posting date');
        items.push(
            `The current <strong>USD Savings available balance</strong> remains the cash authority; bank postings are visible through <strong>${latestCashDate}</strong> and may update after the pending order settles.`,
        );
    }
    const settledExecutionCount = Number(summary.hsbc_final_settled_execution_count);
    const reconciliation = snapshot.execution_price_reconciliation
        && typeof snapshot.execution_price_reconciliation === 'object'
        ? snapshot.execution_price_reconciliation
        : {};
    const pendingExecutionCount = Array.isArray(reconciliation.pending_order_ids)
        ? reconciliation.pending_order_ids.length
        : 0;
    if (Number.isFinite(settledExecutionCount) && settledExecutionCount > 0) {
        items.push(
            `<strong>${settledExecutionCount.toLocaleString('en-US')}</strong> execution ${settledExecutionCount === 1 ? 'price was' : 'prices were'} finalized from the settled USD Savings cash flow; the provisional Portfolio calibration and original Order Status limit price remain in source metadata.`,
        );
    } else {
        const calibratedOrderCount = Number(summary.hsbc_portfolio_calibrated_order_count);
        if (Number.isFinite(calibratedOrderCount) && calibratedOrderCount > 0) {
            items.push(
                `<strong>${calibratedOrderCount.toLocaleString('en-US')}</strong> current executed order ${calibratedOrderCount === 1 ? 'price was' : 'prices were'} calibrated from the authoritative Portfolio average purchase price; the original Order Status limit price remains in source metadata.`,
            );
        }
    }
    if (pendingExecutionCount > 0) {
        items.push(
            `<strong>${pendingExecutionCount.toLocaleString('en-US')}</strong> newer executed ${pendingExecutionCount === 1 ? 'order remains' : 'orders remain'} provisional until its matching USD Savings settlement appears in a later paste.`,
        );
    }
    const trimmedRefreshNotice = String(refreshNotice || '').trim();
    if (trimmedRefreshNotice) items.push(escapeHtml(trimmedRefreshNotice));
    return `
        <p class="notice-floating-banner-heading">HSBC sync complete</p>
        ${buildInvestmentImportFeedbackListHtml(items)}
    `.trim();
}
