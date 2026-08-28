/**
 * Pure Investment import-feedback markup builders.
 *
 * Code version: v1.9.0
 * - Fixed: Import-complete transfer review is scoped to rows that became
 *   actionable during the completed import, so pre-existing Unbound rows from
 *   an older frontend cache cannot reappear as a new import warning.
 * - Changed: HSBC cash feedback now describes the signed net amount of visible
 *   unsettled buy and sell orders, while explicitly excluding unposted sell
 *   clearing fees and other settlement adjustments.
 * - Fixed: Completed-import feedback now prefers the freshly reloaded merged
 *   ledger summary, so stale pre-merge Schwab receipt and P&L warnings cannot
 *   reappear after an idempotent import.
 * - Changed: IBKR and Schwab transfer review feedback now reports the current
 *   number of rows that remain marked `Unbound`, rather than describing the
 *   count as newly detected during the latest import.
 * - Changed: IBKR transfer feedback no longer uses an alarming immediate-action
 *   warning; it distinguishes current rows that remain marked `Unbound`, so
 *   already-bound transfers require no further action.
 * - Fixed: HSBC transferable-cash feedback is shown only when visible unsettled buy or sell orders produce the provisional `*` marker.
 * - Fixed: Schwab in-kind receipt feedback now scopes incomplete All brokers valuation to unresolved receipt rows and affected tickers.
 * - Added: HSBC feedback states the authoritative transferable cash and the net pending-order display estimate when current order rows are not yet settled.
 */

export const INVESTMENT_IMPORT_FEEDBACK_MODULE_VERSION = 'v1.9.0';

export function getInvestmentPendingTransferSourceKeys(processedTransactions = []) {
    return new Set(
        (Array.isArray(processedTransactions) ? processedTransactions : [])
            .filter((transaction) => (
                transaction?.manual_internal_transfer_needs_binding === true
                && Number(transaction?.manual_internal_transfer_candidate_count || 0) > 0
            ))
            .map((transaction) => String(
                transaction?.manual_internal_transfer_source_key
                || transaction?.manual_internal_transfer_key
                || '',
            ).trim())
            .filter(Boolean),
    );
}

export function countNewInvestmentPendingTransferRows({
    beforeSourceKeys = [],
    refreshedTransactions = [],
} = {}) {
    const previousKeys = beforeSourceKeys instanceof Set
        ? beforeSourceKeys
        : new Set(Array.isArray(beforeSourceKeys) ? beforeSourceKeys : []);
    const refreshedKeys = getInvestmentPendingTransferSourceKeys(refreshedTransactions);
    return [...refreshedKeys].filter((sourceKey) => !previousKeys.has(sourceKey)).length;
}

export function resolveInvestmentImportFeedbackSummary({
    refreshedSummary = null,
    importSummary = null,
} = {}) {
    const preferredSummary = refreshedSummary && typeof refreshedSummary === 'object'
        ? refreshedSummary
        : importSummary;
    return preferredSummary && typeof preferredSummary === 'object'
        ? preferredSummary
        : {};
}

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
        const transferReviewState = pendingTransferCount === 1
            ? 'row became newly actionable and remains'
            : 'rows became newly actionable and remain';
        items.push(
            `<u>Transfer review</u>: <strong>${pendingTransferCount.toLocaleString('en-US')} internal-transfer ${transferReviewState} marked Unbound in Transaction history.</strong> Review only those newly affected rows; pre-existing and already-bound transfers require no further action.`
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
    const holdingsMismatchCount = Number(importSummary?.holdings_validation?.mismatch_count);
    const positionsValidation = importSummary?.schwab_positions_validation;
    const securityTransferReconciliation = (
        importSummary?.security_transfer_reconciliation
        && typeof importSummary.security_transfer_reconciliation === 'object'
    ) ? importSummary.security_transfer_reconciliation : {};
    const unreconciledInboundCount = Number(securityTransferReconciliation.unreconciled_inbound_count);
    const aggregateHoldingsAvailable = securityTransferReconciliation.aggregate_holdings_available !== false;
    const activeOverlayCount = Array.isArray(
        securityTransferReconciliation?.aggregate_overlay?.active_receipt_keys,
    ) ? securityTransferReconciliation.aggregate_overlay.active_receipt_keys.length : 0;
    const pnlUnavailableTickers = Array.isArray(securityTransferReconciliation.pnl_unavailable_tickers)
        ? securityTransferReconciliation.pnl_unavailable_tickers
            .map((ticker) => String(ticker || '').trim().toUpperCase())
            .filter(Boolean)
        : [];
    const items = [
        'Transactions and the authoritative <strong>Positions</strong> snapshot were merged <strong>incrementally</strong> without clearing older records.',
        'Both uploaded CSV files are retained locally as <strong>SHA-256-verified immutable evidence</strong>.',
    ];
    if (Number.isFinite(importedRecordCount) && Number.isFinite(addedRecordCount)) {
        items.unshift(
            `This run parsed <strong>${importedRecordCount.toLocaleString('en-US')}</strong> records and added <strong>${addedRecordCount.toLocaleString('en-US')}</strong>.`
        );
    }
    if (positionsValidation?.status === 'matched') {
        items.push('The reported <strong>Positions Total</strong> reconciled to the listed securities and cash before this import was committed.');
    }
    if (Number.isFinite(holdingsMismatchCount) && holdingsMismatchCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Review required</u>:</span> The Transactions CSV does not independently replay to <strong class="notice-floating-banner-emphasis-danger">${holdingsMismatchCount.toLocaleString('en-US')} Positions snapshot ${holdingsMismatchCount === 1 ? 'holding' : 'holdings'}</strong>. The broker snapshot remains source evidence, but the transaction-history scope is incomplete.`,
        );
    }
    if (!aggregateHoldingsAvailable) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Receipt review required</u>:</span> Confirm a concrete source broker and account for each unresolved Schwab security receipt in Transaction history. <strong class="notice-floating-banner-emphasis-danger">Only unresolved receipt rows are excluded from All brokers Holdings and Equity; unaffected holdings, chart, and Metrics remain visible, while P&amp;L stays unavailable only for affected transferred tickers.</strong> Real receipts and broker-specific records are retained unchanged; no source-broker transfer-out was created or inferred. No carried cost basis was created or inferred.`,
        );
    } else if (activeOverlayCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Aggregate-only confirmation</u>:</span> <strong class="notice-floating-banner-emphasis-danger">${activeOverlayCount.toLocaleString('en-US')} Schwab in-kind receipt ${activeOverlayCount === 1 ? 'uses' : 'use'} a user-attested net-neutral overlay</strong>. It affects only All brokers aggregation, creates no source transfer-out, and is automatically superseded when exact source evidence is imported.`,
        );
    } else if (Number.isFinite(unreconciledInboundCount) && unreconciledInboundCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Source-side evidence needed</u>:</span> <strong class="notice-floating-banner-emphasis-danger">${unreconciledInboundCount.toLocaleString('en-US')} in-kind transfer ${unreconciledInboundCount === 1 ? 'receipt has' : 'receipts have'} no confirmed source record</strong>. The real Schwab receipts were retained; no source-broker transfer-out was created or inferred.`,
        );
    }
    if (pnlUnavailableTickers.length) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>P&amp;L unavailable</u>:</span> Transferred-position cost basis is not carried in the Schwab snapshot, so P&amp;L is unavailable only for <strong class="notice-floating-banner-emphasis-danger">${pnlUnavailableTickers.join(', ')}</strong> until verified carried basis is imported.`,
        );
    }
    if (pendingTransferCount > 0) {
        items.push(
            `<span class="notice-floating-banner-emphasis-danger"><u>Manual review required</u>:</span> Bind <strong class="notice-floating-banner-emphasis-danger">${pendingTransferCount.toLocaleString('en-US')} in-kind transfer ${pendingTransferCount === 1 ? 'counterpart' : 'counterparts'}</strong> in Transaction history. Same-day ticker-and-quantity similarity never creates an automatic link.`
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
    const pendingSettlementCash = Number(summary.hsbc_pending_settlement_cash);
    const brokerCashEstimate = Number(summary.hsbc_broker_cash_estimate);
    if (
        Number.isFinite(pendingSettlementCash)
        && Math.abs(pendingSettlementCash) > 1e-9
        && Number.isFinite(brokerCashEstimate)
    ) {
        const bankAvailableCash = brokerCashEstimate - pendingSettlementCash;
        const signedPendingCash = pendingSettlementCash.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            signDisplay: 'always',
        });
        items.push(
            `HSBC transferable cash remains <strong>$${bankAvailableCash.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>; the transaction table may show <strong>$${brokerCashEstimate.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong> after applying the signed net unsettled buy/sell amount <strong>$${signedPendingCash}</strong>. Unposted sell clearing fees and other settlement adjustments are not included.`,
        );
    }
    const holdingsMismatchCount = Number(summary.holdings_validation?.mismatch_count);
    if (Number.isFinite(holdingsMismatchCount) && holdingsMismatchCount > 0) {
        items.push(
            `The visible Order Status history does not independently replay to the current Portfolio snapshot. Pending-order rows use current HSBC Portfolio market value and a cash projection, rather than presenting incomplete replay as a historical balance.`,
        );
    }
    const trimmedRefreshNotice = String(refreshNotice || '').trim();
    if (trimmedRefreshNotice) items.push(escapeHtml(trimmedRefreshNotice));
    return `
        <p class="notice-floating-banner-heading">HSBC sync complete</p>
        ${buildInvestmentImportFeedbackListHtml(items)}
    `.trim();
}
