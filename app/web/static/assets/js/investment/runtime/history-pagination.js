/**
 * History pagination and row rendering.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentHistoryPaginationRuntime(runtime) {
function bindInvestmentHistoryChartInteractions(historyContainer) {
        if (!historyContainer) return;
        const hoverContainer = historyContainer.closest('#history_table_wrap')
            || historyContainer.closest('.investment-history-table-shell')
            || historyContainer;
        runtime.setInvestmentHoverContainerPayload(hoverContainer, null);
        runtime.bindInvestmentHoverContainerPersistence(hoverContainer);
        historyContainer.querySelectorAll('tr[data-investment-history-row]').forEach((row) => {
            if (row.dataset.chartHoverBound === '1') return;
            row.dataset.chartHoverBound = '1';
            const activateChartMarker = () => {
                const ledgerNo = Number(row.dataset.investmentHistoryRow || 0);
                const stockDetailLedgerNo = runtime.getStockDetailLedgerNoForHistoryLedgerNo(
                    ledgerNo,
                    row.dataset.investmentHistoryTicker || '',
                );
                const hoverPayload = {
                    hoverTicker: row.dataset.investmentHistoryTicker || '',
                    hoverLedgerNo: ledgerNo,
                    historyLedgerNos: [ledgerNo],
                    stockDetailLedgerNos: stockDetailLedgerNo > 0 ? [stockDetailLedgerNo] : [],
                    interactionLedgerNo: stockDetailLedgerNo > 0 ? stockDetailLedgerNo : ledgerNo,
                    historyBehavior: 'auto',
                    historyScroll: false,
                    stockDetailBehavior: 'auto',
                    stockDetailScroll: stockDetailLedgerNo > 0,
                };
                runtime.setInvestmentHoverContainerPayload(hoverContainer, hoverPayload);
                runtime.syncInvestmentHoverLinkedViews(hoverPayload);
            };
            const clearChartMarker = () => {
                if (hoverContainer instanceof HTMLElement && hoverContainer.matches(':hover')) return;
                runtime.clearInvestmentChartLinkedHoverState();
            };
            row.addEventListener('mouseenter', activateChartMarker);
            row.addEventListener('mouseleave', clearChartMarker);
            row.addEventListener('focusin', activateChartMarker);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearChartMarker();
            });
        });
    }

function getVisibleInvestmentHistoryTransactions(processedTransactions = [], chartPoints = []) {
        return runtime.getInvestmentHistoryTransactionsForCurrentScope(
            processedTransactions,
            chartPoints,
            {includeDescriptionBindingFilter: true},
        );
    }

function getInvestmentHistoryDisplayTransactions(processedTransactions = [], chartPoints = []) {
        return getVisibleInvestmentHistoryTransactions(processedTransactions, chartPoints)
            .map((txn, index) => ({txn, index}))
            .sort((left, right) => runtime.compareInvestmentTransactions(left.txn, right.txn, left.index, right.index))
            .map(({txn}) => txn);
    }

function getInvestmentPaginationSurface() {
        if (runtime.state.activeInvestmentView === 'stock_details') {
            const stockShell = runtime.investmentStockDetailsTableHost?.querySelector(
                '.investment-stock-details-table-shell',
            );
            const stockScroll = stockShell?.querySelector('.investment-stock-details-table-scroll');
            if (stockShell instanceof HTMLElement && stockScroll instanceof HTMLElement) {
                return {
                    shell: stockShell,
                    scrollContainer: stockScroll,
                    tableBody: stockScroll.querySelector('tbody'),
                };
            }
        }
        return {
            shell: runtime.historyTable,
            scrollContainer: runtime.getInvestmentHistoryScrollContainer(),
            tableBody: runtime.getInvestmentHistoryTableBody(),
        };
    }

function mountInvestmentHistoryPagination() {
        if (!(runtime.investmentHistoryPagination instanceof HTMLElement)) return false;
        const surface = getInvestmentPaginationSurface();
        if (!(surface?.shell instanceof HTMLElement)) return false;
        if (runtime.investmentHistoryPagination.parentElement !== surface.shell) {
            surface.shell.append(runtime.investmentHistoryPagination);
        }
        if (surface.scrollContainer instanceof HTMLElement && surface.scrollContainer.id) {
            runtime.investmentHistoryPagination.dataset.paginationScrollTarget = surface.scrollContainer.id;
        }
        if (surface.tableBody instanceof HTMLElement && surface.tableBody.id) {
            runtime.investmentHistoryPagination.setAttribute('aria-controls', surface.tableBody.id);
        }
        runtime.investmentHistoryPagination.setAttribute(
            'aria-label',
            runtime.state.activeInvestmentView === 'stock_details'
                ? 'Ticker transaction pages'
                : 'Transaction history pages',
        );
        runtime.investmentHistoryPagination.dataset.paginationMounted = '1';
        return true;
    }

function setInvestmentHistoryPaginationVisibility(isVisible) {
        const shouldShow = Boolean(isVisible && mountInvestmentHistoryPagination());
        if (runtime.investmentHistoryPagination instanceof HTMLElement) {
            runtime.investmentHistoryPagination.hidden = !shouldShow;
        }
        [
            runtime.historyTable,
            runtime.investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table-shell'),
        ].forEach((surface) => {
            surface?.classList.toggle('has-floating-pagination', shouldShow && surface === getInvestmentPaginationSurface()?.shell);
        });
    }

function positionInvestmentHistoryPaginationIndicator({ immediate = false } = {}) {
        if (!(runtime.investmentHistoryPagination instanceof HTMLElement) || runtime.investmentHistoryPagination.hidden) return;
        const target = runtime.investmentHistoryPagination.querySelector('.local-store-page-button.is-active');
        if (!(target instanceof HTMLElement)) return;
        runtime.positionLocalStorePaginationIndicator(runtime.investmentHistoryPagination, target, {immediate});
    }

function renderInvestmentHistoryPagination(totalRows = 0, {force = false} = {}) {
        if (!(runtime.investmentHistoryPagination instanceof HTMLElement)) return;
        if (runtime.state.activeInvestmentView === 'stock_details' && !force) return;
        const pendingAnimation = runtime.state.investmentHistoryPendingPaginationAnimation;
        runtime.state.investmentHistoryPendingPaginationAnimation = null;
        const totalPages = runtime.getInvestmentHistoryTotalPages(totalRows);
        runtime.state.investmentHistoryCurrentPage = Math.min(totalPages, Math.max(1, runtime.state.investmentHistoryCurrentPage || 1));
        const paginationState = runtime.buildInvestmentHistoryPagination(totalPages, runtime.state.investmentHistoryCurrentPage);
        runtime.state.investmentHistoryCurrentPage = paginationState.currentPage;
        if (!paginationState.shouldRender) {
            setInvestmentHistoryPaginationVisibility(false);
            runtime.renderLocalStorePagination(runtime.investmentHistoryPagination, paginationState, {
                additionalPageTargetAttribute: 'data-investment-history-page-target',
            });
            return;
        }
        setInvestmentHistoryPaginationVisibility(true);
        runtime.renderLocalStorePagination(runtime.investmentHistoryPagination, paginationState, {
            additionalPageTargetAttribute: 'data-investment-history-page-target',
        });
        positionInvestmentHistoryPaginationIndicator({ immediate: true });
        if (pendingAnimation) {
            runtime.animateLocalStorePaginationIndicator(runtime.investmentHistoryPagination, pendingAnimation);
        }
    }

function getInvestmentHistoryPageForLedgerNos(ledgerNos = []) {
        return runtime.getInvestmentHistoryPageForLedgerNosCore(
            runtime.state.investmentHistoryVisibleTransactionsCache,
            runtime.normalizeInvestmentLedgerNos(ledgerNos),
        );
    }

function resetInvestmentHistoryScrollPosition() {
        const scrollContainer = runtime.getInvestmentHistoryScrollContainer();
        if (scrollContainer instanceof HTMLElement) {
            scrollContainer.scrollTop = 0;
        }
    }

function resetInvestmentStockDetailsScrollPosition() {
        const scrollContainer = runtime.getInvestmentStockDetailsScrollContainer();
        if (scrollContainer instanceof HTMLElement) {
            scrollContainer.scrollTop = 0;
        }
    }

function bindInvestmentHistoryPagination() {
        if (!mountInvestmentHistoryPagination()) return;
        runtime.bindLocalStorePagination(runtime.investmentHistoryPagination, (targetPage, {animationState}) => {
            if (!Number.isFinite(targetPage) || targetPage <= 0 || targetPage === runtime.state.investmentHistoryCurrentPage) return;
            runtime.state.investmentHistoryPendingPaginationAnimation = animationState;
            runtime.state.investmentHistoryCurrentPage = targetPage;
            runtime.syncInvestmentUrl({historyMode: 'push'});
            if (runtime.state.activeInvestmentView === 'stock_details') {
                runtime.refreshInvestmentStockDetailsTableRows({refreshHeaders: false, scrollToTop: true});
            } else {
                renderInvestmentHistoryTableRows(
                    runtime.state.investmentProcessedTransactionsCache,
                    runtime.state.investmentChartPointsCache,
                    {scrollToTop: true},
                );
            }
        });
        window.addEventListener('resize', () => {
            positionInvestmentHistoryPaginationIndicator({ immediate: true });
        });
    }

function renderInvestmentHistoryTableRows(processedTransactions = [], chartPoints = [], { resetPage = false, scrollToTop = false } = {}) {
        const tbody = runtime.getInvestmentHistoryTableBody();
        if (!(tbody instanceof HTMLElement)) return;
        runtime.clearInvestmentHistoryHighlights();
        const visibleTransactions = getInvestmentHistoryDisplayTransactions(processedTransactions, chartPoints);
        if (!visibleTransactions.length) {
            runtime.state.investmentHistoryVisibleTransactionsCache = [];
            runtime.state.investmentHistoryCurrentPage = 1;
            tbody.innerHTML = `
                <tr data-table-empty-row>
                    <td colspan="11" class="investment-history-empty-cell">No transactions match the selected filters.</td>
                </tr>
            `;
            renderInvestmentHistoryPagination(0);
            runtime.attachHistoryTableAlignmentSync(runtime.historyTable);
            runtime.syncInvestmentUrl({historyMode: 'replace'});
            return;
        }
        const pageState = runtime.buildInvestmentHistoryPage(
            visibleTransactions,
            runtime.state.investmentHistoryCurrentPage,
            {resetPage},
        );
        runtime.state.investmentHistoryVisibleTransactionsCache = pageState.visibleTransactions;
        runtime.state.investmentHistoryCurrentPage = pageState.currentPage;
        tbody.innerHTML = pageState.pageTransactions
            .map((txn) => runtime.renderInvestmentHistoryRowMarkup(txn))
            .join('');
        renderInvestmentHistoryPagination(runtime.state.investmentHistoryVisibleTransactionsCache.length);
        bindInvestmentHistoryChartInteractions(tbody);
        runtime.bindInvestmentHistoryTransferControls(tbody);
        runtime.attachHistoryTableAlignmentSync(runtime.historyTable);
        if (scrollToTop) {
            resetInvestmentHistoryScrollPosition();
        }
        runtime.syncInvestmentUrl({historyMode: 'replace'});
    }

    return {
        bindInvestmentHistoryChartInteractions,
        getVisibleInvestmentHistoryTransactions,
        getInvestmentHistoryDisplayTransactions,
        getInvestmentPaginationSurface,
        mountInvestmentHistoryPagination,
        setInvestmentHistoryPaginationVisibility,
        positionInvestmentHistoryPaginationIndicator,
        renderInvestmentHistoryPagination,
        getInvestmentHistoryPageForLedgerNos,
        resetInvestmentHistoryScrollPosition,
        resetInvestmentStockDetailsScrollPosition,
        bindInvestmentHistoryPagination,
        renderInvestmentHistoryTableRows,
    };
}

