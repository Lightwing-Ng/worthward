/**
 * Pure Investment import-feedback markup builders.
 *
 * Code version: v1.0.0
 */

export const INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION = 'v1.0.0';

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
            `<span class="notice-floating-banner-emphasis-danger"><u>Immediate action</u>:</span> Review and bind <strong class="notice-floating-banner-emphasis-danger">${pendingTransferCount.toLocaleString('en-US')} possible HSBC transfer ${pendingTransferCount === 1 ? 'match' : 'matches'}</strong> in Transaction history to remove duplicate-equity spikes.`
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
