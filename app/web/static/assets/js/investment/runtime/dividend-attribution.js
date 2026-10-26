/**
 * User-confirmed HSBC dividend identities in Transaction history.
 *
 * Code version: v1.0.0
 */

export function createInvestmentDividendAttributionRuntime(runtime) {
    let attributionInFlight = false;

    function renderInvestmentDividendAttributionMarkup(txn) {
        const recordKey = String(txn?.dividend_attribution_key || '').trim();
        if (!recordKey) return '';
        const ticker = String(txn?.ticker || '').trim();
        const candidates = Array.from(new Set([
            ...(Array.isArray(txn?.dividend_attribution_candidates)
                ? txn.dividend_attribution_candidates : []),
            ticker,
        ].map((value) => String(value || '').trim()).filter(Boolean)));
        const description = runtime.escapeHtml(runtime.formatTransactionDescription(txn));
        return `
            <div class="investment-transfer-link-shell${ticker ? ' is-resolved' : ' is-unresolved'}">
                <span class="investment-transfer-link-current">${description}</span>
                <select class="investment-dividend-attribution-select trade-strategy-select form-select"
                        data-investment-dividend-attribution-key="${runtime.escapeHtml(recordKey)}"
                        data-investment-dividend-attribution-ticker="${runtime.escapeHtml(ticker)}"
                        aria-label="Match this HSBC dividend to a ticker">
                    <option value=""${ticker ? '' : ' selected'}>${ticker ? 'Clear dividend attribution' : 'Select dividend ticker...'}</option>
                    ${candidates.map((candidate) => `<option value="${runtime.escapeHtml(candidate)}"${candidate === ticker ? ' selected' : ''}>${runtime.escapeHtml(candidate)}</option>`).join('')}
                </select>
                ${!ticker && !candidates.length
                    ? '<span class="investment-transfer-link-fee-note">Import securities for this HSBC account and currency to choose a ticker.</span>'
                    : ''}
            </div>
        `;
    }

    async function rememberInvestmentDividendAttribution(recordKey, ticker) {
        if (!await runtime.ensureInvestmentImportSession()) {
            throw new Error(runtime.describeInvestmentImportSessionFailure());
        }
        const response = await fetch('/api/investment/dividend-attribution', runtime.buildInvestmentRequestOptions({
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({record_key: recordKey, ticker}),
        }));
        let result = null;
        try {
            result = await response.json();
        } catch (_error) {
        }
        if (!response.ok || result?.success !== true) {
            throw new Error(result?.error || 'The dividend attribution could not be saved.');
        }
        return result;
    }

    function bindInvestmentDividendAttributionControls(tbody) {
        if (!(tbody instanceof HTMLElement) || tbody.dataset.dividendAttributionBound === '1') return;
        tbody.dataset.dividendAttributionBound = '1';
        tbody.addEventListener('change', async (event) => {
            const select = event.target.closest?.('.investment-dividend-attribution-select');
            if (!(select instanceof HTMLSelectElement)) return;
            const recordKey = String(select.dataset.investmentDividendAttributionKey || '').trim();
            const previousTicker = String(select.dataset.investmentDividendAttributionTicker || '').trim();
            const ticker = select.value;
            if (!recordKey || ticker === previousTicker) return;
            if (attributionInFlight) {
                select.value = previousTicker;
                select.dispatchEvent(new Event('change', {bubbles: false}));
                return;
            }
            attributionInFlight = true;
            select.disabled = true;
            select.dispatchEvent(new Event('change', {bubbles: false}));
            const shell = select.closest('.investment-transfer-link-shell');
            shell?.setAttribute('aria-busy', 'true');
            const scrollContainer = runtime.getInvestmentHistoryScrollContainer();
            const scroll = scrollContainer instanceof HTMLElement
                ? {top: scrollContainer.scrollTop, left: scrollContainer.scrollLeft} : null;
            const currentPage = runtime.state.investmentHistoryCurrentPage;
            let saved = false;
            runtime.setImportFeedback('Saving the dividend attribution…', 'loading');
            try {
                const result = await rememberInvestmentDividendAttribution(recordKey, ticker);
                saved = true;
                const refreshed = await runtime.fetchInvestmentData({expectedStoreVersion: result.investment_store_version || ''});
                const readback = refreshed?.data?.transactions?.find((txn) => (
                    txn.dividend_attribution_key === recordKey
                ));
                if (!readback || String(readback.ticker || '') !== String(result.ticker || '')) {
                    throw new Error('The refreshed ledger did not confirm the saved dividend attribution.');
                }
                runtime.state.investmentHistoryCurrentPage = currentPage;
                runtime.renderInvestmentHistoryTableRows(
                    runtime.state.investmentProcessedTransactionsCache,
                    runtime.state.investmentChartPointsCache,
                    {scrollToTop: false},
                );
                runtime.setImportFeedback(
                    ticker ? `Dividend matched to ${ticker}.` : 'Dividend attribution cleared.',
                    'success',
                );
            } catch (error) {
                if (runtime.isLifecycleInterruptedFetch(error)) return;
                runtime.setImportFeedback(saved
                    ? 'Dividend attribution saved. Reload this page to read the updated ledger.'
                    : String(error?.message || 'The dividend attribution could not be saved.'),
                saved ? 'warning' : 'error');
            } finally {
                attributionInFlight = false;
                select.disabled = false;
                select.value = previousTicker;
                // Refresh the shared adapter's label when a save was rejected.
                select.dispatchEvent(new Event('change', {bubbles: false}));
                shell?.removeAttribute('aria-busy');
                if (scroll && scrollContainer instanceof HTMLElement) {
                    scrollContainer.scrollTop = scroll.top;
                    scrollContainer.scrollLeft = scroll.left;
                }
                window.repairSidebarControlBindings?.();
                const refreshedSelect = Array.from(tbody.querySelectorAll('.investment-dividend-attribution-select'))
                    .find((candidate) => candidate.dataset.investmentDividendAttributionKey === recordKey);
                const field = refreshedSelect?.closest('[data-shared-select-field]');
                (field?.querySelector('[data-shared-select-trigger]') || refreshedSelect)?.focus();
            }
        });
    }

    return {
        renderInvestmentDividendAttributionMarkup,
        rememberInvestmentDividendAttribution,
        bindInvestmentDividendAttributionControls,
    };
}
