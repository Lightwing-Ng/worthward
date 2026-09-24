/**
 * Broker import validation and paste workflows.
 *
 * Code version: v1.0.2
 * - Fixed: HSBC paste validation refreshes the browser write session first.
 * - Changed: HSBC is the import chooser fallback when a selection is absent.
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentImportWorkflowRuntime(runtime) {
function applyInvestmentDescriptionBindingFilter(nextFilter) {
        runtime.state.investmentDescriptionBindingFilter = runtime.normalizeInvestmentDescriptionBindingFilter(nextFilter);
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        runtime.closeInvestmentDescriptionBindingFilterDropdowns();
        runtime.renderInvestmentHistoryTableRows(
            runtime.state.investmentProcessedTransactionsCache,
            runtime.state.investmentChartPointsCache,
            { resetPage: true, scrollToTop: true },
        );
        mountInvestmentDescriptionBindingFilterHeaders();
    }

function openInvestmentDescriptionBindingFilterDropdown(field) {
        const trigger = field.querySelector('[data-investment-description-filter-trigger]');
        const dropdown = field.querySelector('[data-investment-description-filter-dropdown]');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;
        const options = [
            {value: 'all', label: 'All'},
            {value: 'unbound', label: 'Unbound'},
        ];
        dropdown.innerHTML = options.map(({value, label}) => {
            const selected = value === runtime.state.investmentDescriptionBindingFilter;
            const labelMarkup = value === 'unbound'
                ? '<span class="investment-unbound-filter-pill">Unbound</span>'
                : runtime.escapeHtml(label);
            return `<button type="button" class="trade-strategy-dropdown-option${selected ? ' is-selected is-active' : ''}${value === 'unbound' ? ' investment-description-filter-unbound-option' : ''}"
                            data-investment-description-filter-option="${runtime.escapeHtml(value)}" role="option" aria-selected="${selected}">
                        <span class="trade-strategy-dropdown-check" aria-hidden="true"></span>
                        <span class="trade-strategy-dropdown-copy"><span class="trade-strategy-dropdown-title">${labelMarkup}</span></span>
                    </button>`;
        }).join('');
        const rect = trigger.getBoundingClientRect();
        dropdown.dataset.filterOwner = field.dataset.filterId || '';
        document.body.appendChild(dropdown);
        Object.assign(dropdown.style, {
            position: 'fixed',
            left: `${Math.round(rect.left)}px`,
            top: `${Math.round(rect.bottom + 4)}px`,
            width: `${Math.max(132, Math.round(rect.width))}px`,
            zIndex: '10002',
        });
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        field.classList.add('is-open');
        dropdown.querySelectorAll('[data-investment-description-filter-option]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                applyInvestmentDescriptionBindingFilter(
                    option.dataset.investmentDescriptionFilterOption,
                );
            });
        });
    }

function bindInvestmentDescriptionBindingFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentDescriptionFilterBound === '1') return;
        field.dataset.investmentDescriptionFilterBound = '1';
        const trigger = field.querySelector('[data-investment-description-filter-trigger]');
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasOpen = field.classList.contains('is-open');
            runtime.closeInvestmentDescriptionBindingFilterDropdowns();
            if (!wasOpen) openInvestmentDescriptionBindingFilterDropdown(field);
        });
    }

function positionInvestmentDescriptionBindingAlertTooltip(alert, tooltip) {
        if (!(alert instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return;
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const alertRect = alert.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
        const margin = 12;
        const gap = 8;
        const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
        const left = Math.min(Math.max(margin, alertRect.left - tooltipRect.width + alertRect.width), maxLeft);
        const roomBelow = viewportHeight - alertRect.bottom - margin;
        const roomAbove = alertRect.top - margin;
        const shouldPlaceAbove = roomBelow < tooltipRect.height + gap && roomAbove >= tooltipRect.height + gap;
        const preferredTop = shouldPlaceAbove
            ? alertRect.top - tooltipRect.height - gap
            : alertRect.bottom + gap;
        const maxTop = Math.max(margin, viewportHeight - tooltipRect.height - margin);
        const top = Math.min(Math.max(margin, preferredTop), maxTop);
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
    }

function closeInvestmentDescriptionBindingAlertTooltip() {
        const activeState = runtime.state.investmentDescriptionBindingAlertTooltipState;
        if (!activeState) return;
        activeState.alert.removeAttribute('aria-describedby');
        activeState.tooltip.remove();
        window.removeEventListener('resize', activeState.reposition);
        window.removeEventListener('scroll', activeState.reposition, true);
        runtime.state.investmentDescriptionBindingAlertTooltipState = null;
    }

function openInvestmentDescriptionBindingAlertTooltip(alert) {
        if (!(alert instanceof HTMLElement)) return;
        if (runtime.state.investmentDescriptionBindingAlertTooltipState?.alert === alert) {
            runtime.state.investmentDescriptionBindingAlertTooltipState.reposition();
            return;
        }
        closeInvestmentDescriptionBindingAlertTooltip();
        const tooltip = document.createElement('div');
        tooltip.id = 'investment-description-binding-alert-tooltip';
        tooltip.className = 'investment-description-binding-alert-tooltip settings-action-package settings-callout-card-warning';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.innerHTML = `
            <span class="settings-nav-icon-shell settings-action-package-icon-shell settings-callout-icon-shell investment-description-binding-alert-tooltip-logo"
                  aria-hidden="true">
                <span class="icon icon-settings-network"></span>
            </span>
            <div class="settings-action-package-copy settings-callout-text">
                <p class="settings-service-name">Unbound internal transfer</p>
                <p class="settings-service-note">Choose the matching transfer counterpart in the Description cell to keep cash flow and aggregate equity accurate.</p>
            </div>
        `;
        document.body.appendChild(tooltip);
        const reposition = () => positionInvestmentDescriptionBindingAlertTooltip(alert, tooltip);
        runtime.state.investmentDescriptionBindingAlertTooltipState = {alert, tooltip, reposition};
        alert.setAttribute('aria-describedby', tooltip.id);
        tooltip.classList.add('is-visible');
        reposition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
    }

function bindInvestmentDescriptionBindingAlertInteractions() {
        if (runtime.state.investmentDescriptionBindingFilterDocumentListenersBound) return;
        runtime.state.investmentDescriptionBindingFilterDocumentListenersBound = true;
        document.addEventListener('click', runtime.closeInvestmentDescriptionBindingFilterDropdowns);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                runtime.closeInvestmentDescriptionBindingFilterDropdowns();
                closeInvestmentDescriptionBindingAlertTooltip();
            }
        });
        document.addEventListener('pointerover', (event) => {
            const alert = event.target instanceof Element
                ? event.target.closest('[data-investment-description-binding-alert]')
                : null;
            if (!(alert instanceof HTMLElement)) return;
            if (event.relatedTarget instanceof Node && alert.contains(event.relatedTarget)) return;
            openInvestmentDescriptionBindingAlertTooltip(alert);
        });
        document.addEventListener('pointerout', (event) => {
            const alert = event.target instanceof Element
                ? event.target.closest('[data-investment-description-binding-alert]')
                : null;
            if (!(alert instanceof HTMLElement)) return;
            if (event.relatedTarget instanceof Node && alert.contains(event.relatedTarget)) return;
            if (runtime.state.investmentDescriptionBindingAlertTooltipState?.alert === alert) {
                closeInvestmentDescriptionBindingAlertTooltip();
            }
        });
        document.addEventListener('focusin', (event) => {
            const alert = event.target instanceof Element
                ? event.target.closest('[data-investment-description-binding-alert]')
                : null;
            if (alert instanceof HTMLElement) openInvestmentDescriptionBindingAlertTooltip(alert);
        });
        document.addEventListener('focusout', (event) => {
            const alert = event.target instanceof Element
                ? event.target.closest('[data-investment-description-binding-alert]')
                : null;
            if (!(alert instanceof HTMLElement)) return;
            if (event.relatedTarget instanceof Node && alert.contains(event.relatedTarget)) return;
            if (runtime.state.investmentDescriptionBindingAlertTooltipState?.alert === alert) {
                closeInvestmentDescriptionBindingAlertTooltip();
            }
        });
    }

function mountInvestmentDescriptionBindingFilterHeaders(root = document) {
        bindInvestmentDescriptionBindingAlertInteractions();
        const hasUnboundTransactions = runtime.hasInvestmentDescriptionBindingFilterOptions();
        if (!hasUnboundTransactions) {
            runtime.state.investmentDescriptionBindingFilter = 'all';
            closeInvestmentDescriptionBindingAlertTooltip();
        }
        root.querySelectorAll?.('th[data-markdown-export-label="Description"]').forEach((th) => {
            if (!(th instanceof HTMLElement) || !th.closest('#history_table_wrap')) return;
            if (!hasUnboundTransactions) {
                th.classList.remove('scrollable-data-table-filter-header');
                th.classList.remove('investment-history-description-filter-header');
                if (th.querySelector('[data-investment-description-filter]')) {
                    th.textContent = 'Description';
                }
                return;
            }
            th.classList.add('scrollable-data-table-filter-header');
            th.classList.add('investment-history-description-filter-header');
            if (!th.querySelector('[data-investment-description-filter]')) {
                th.innerHTML = runtime.renderInvestmentDescriptionBindingFilterHeaderInnerMarkup();
            }
            bindInvestmentDescriptionBindingFilterField(
                th.querySelector('[data-investment-description-filter]'),
            );
        });
    }

function getInvestmentStockDetailsDateFilterLabel() {
        const mode = String(runtime.state.investmentStockDetailsDateFilter.mode || 'all');
        const value = String(runtime.state.investmentStockDetailsDateFilter.value || '').trim();
        if (mode === 'day' && value) {
            return runtime.formatInvestmentFullDateParts(runtime.parseInvestmentDateParts(value));
        }
        if (mode === 'month' && /^\d{4}-\d{2}$/.test(value)) {
            const [year, month] = value.split('-').map((part) => Number.parseInt(part, 10));
            return new Intl.DateTimeFormat('en-GB', {
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
            }).format(new Date(Date.UTC(year, month - 1, 1)));
        }
        return 'All dates';
    }

function matchesInvestmentStockDetailsDateFilter(txn) {
        return runtime.matchesInvestmentDateFilter(
            txn,
            runtime.state.investmentStockDetailsDateFilter,
            runtime.normalizeLedgerDate,
        );
    }

function renderInvestmentStockDetailsDatePickerField({ role, inputId, label, value }) {
        const feedbackId = `${inputId}_feedback`;
        return `
            <div class="date-picker-field investment-stock-details-date-picker-field"
                 data-date-picker
                 data-date-role="${runtime.escapeHtml(role)}"
                 data-date-picker-group="investment-stock-details-date-filter"
                 data-date-picker-unconstrained="true"
                 data-date-picker-keep-open-on-select="true"
                 data-date-picker-select-month="true"
                 data-date-picker-stable-frame="true"
                 data-date-picker-avoid-selector="[data-investment-stock-details-time-filter-trigger][aria-expanded='true'], [data-investment-stock-details-time-filter-panel]"
                 data-date-picker-guidance="single-day-or-month"
                 data-date-picker-default-feedback="Choose a day or a calendar month.">
                <input id="${runtime.escapeHtml(inputId)}" name="${runtime.escapeHtml(inputId)}" type="hidden" value="${runtime.escapeHtml(value)}">
                <div class="date-picker-trigger" data-date-trigger aria-haspopup="dialog" aria-expanded="false">
                    <span class="date-picker-trigger-value"
                          data-date-trigger-value
                          data-date-editor
                          contenteditable="plaintext-only"
                          role="textbox"
                          aria-multiline="false"
                          aria-label="${runtime.escapeHtml(label)}"
                          aria-describedby="${runtime.escapeHtml(feedbackId)}"
                          data-placeholder="Select date"
                          data-empty="1"
                          spellcheck="false"></span>
                </div>
                <div class="date-picker-popover investment-stock-details-date-picker-popover" data-date-popover hidden>
                    <p id="${runtime.escapeHtml(feedbackId)}" class="date-picker-feedback date-picker-feedback-popover" data-date-feedback aria-live="polite">Choose a day or a calendar month.</p>
                    <div class="date-picker-toolbar">
                        <button type="button" class="date-picker-nav" data-date-nav="-1" aria-label="Previous month">
                            <span class="icon icon-page-prev" aria-hidden="true"></span>
                        </button>
                        <button type="button" class="date-picker-title" data-date-title aria-label="Choose month and year">
                            <span data-date-month></span>
                        </button>
                        <button type="button" class="date-picker-nav" data-date-nav="1" aria-label="Next month">
                            <span class="icon icon-page-next" aria-hidden="true"></span>
                        </button>
                    </div>
                    <div data-date-calendar>
                        <div class="date-picker-weekdays" aria-hidden="true">
                            <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                        </div>
                        <div class="date-picker-days" data-date-grid></div>
                    </div>
                    <div class="date-picker-months" data-date-month-grid hidden aria-label="Months"></div>
                </div>
            </div>
        `;
    }

function renderInvestmentStockDetailsTimeFilterHeaderInnerMarkup() {
        const filterLabel = getInvestmentStockDetailsDateFilterLabel();
        return `
            <span class="scrollable-data-table-filter-default-label investment-time-filter-default-label" aria-hidden="true">Time</span>
            <div class="field scrollable-data-table-filter-field investment-stock-details-time-filter-field" data-investment-stock-details-time-filter>
                <button type="button"
                        class="scrollable-data-table-filter-trigger investment-stock-details-time-filter-trigger"
                        data-investment-stock-details-time-filter-trigger
                        aria-haspopup="dialog"
                        aria-expanded="false"
                        aria-label="Time filter: ${runtime.escapeHtml(filterLabel)}">
                    <span data-investment-stock-details-time-filter-label>${runtime.escapeHtml(filterLabel)}</span>
                </button>
                <div class="investment-stock-details-time-filter-panel"
                     data-investment-stock-details-time-filter-panel
                     role="dialog"
                     aria-label="Transaction date filter"
                     hidden>
                    ${renderInvestmentStockDetailsDatePickerField({
                        role: 'single',
                        inputId: 'investment_stock_details_date_start',
                        label: 'Transaction date',
                        value: runtime.state.investmentStockDetailsDateFilter.mode === 'day'
                            ? runtime.state.investmentStockDetailsDateFilter.value
                            : '',
                    })}
                    <button type="button"
                            class="investment-stock-details-time-filter-clear"
                            data-investment-stock-details-time-filter-clear>Clear date filter</button>
                </div>
            </div>
        `;
    }

function getInvestmentStockDetailsTimeFilterPanel(field) {
        if (!(field instanceof HTMLElement)) return null;
        const nestedPanel = field.querySelector('[data-investment-stock-details-time-filter-panel]');
        if (nestedPanel instanceof HTMLElement) return nestedPanel;
        const ownedPanel = document.querySelector(
            '[data-investment-stock-details-time-filter-panel][data-investment-stock-details-time-filter-owner="investment_stock_details_time_filter"]',
        );
        return ownedPanel instanceof HTMLElement ? ownedPanel : null;
    }

function closeInvestmentStockDetailsTimeFilters() {
        document.querySelectorAll('[data-investment-stock-details-time-filter]').forEach((field) => {
            const panel = getInvestmentStockDetailsTimeFilterPanel(field);
            const trigger = field.querySelector('[data-investment-stock-details-time-filter-trigger]');
            trigger?.setAttribute('aria-expanded', 'false');
            field.classList.remove('is-open');
            if (!(panel instanceof HTMLElement)) return;
            panel.hidden = true;
            panel.removeAttribute('style');
            if (panel.parentElement !== field) field.appendChild(panel);
            delete panel.dataset.investmentStockDetailsTimeFilterOwner;
        });
    }

function positionInvestmentStockDetailsTimeFilterPanel(field) {
        const trigger = field.querySelector('[data-investment-stock-details-time-filter-trigger]');
        const panel = getInvestmentStockDetailsTimeFilterPanel(field);
        if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden) return;
        const rect = trigger.getBoundingClientRect();
        const viewportPadding = 12;
        const width = Math.min(320, Math.max(272, window.innerWidth - (viewportPadding * 2)));
        const left = Math.min(
            Math.max(viewportPadding, rect.left),
            Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
        );
        panel.style.position = 'fixed';
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(rect.bottom + 6)}px`;
        panel.style.width = `${Math.round(width)}px`;
        // The date picker is portaled to the document root at the global popover layer.
        // Keep its owning panel immediately beneath it so the picker remains clickable.
        panel.style.zIndex = 'calc(var(--layer-global-popover) - 1)';
    }

function openInvestmentStockDetailsTimeFilter(field) {
        const panel = getInvestmentStockDetailsTimeFilterPanel(field);
        const trigger = field.querySelector('[data-investment-stock-details-time-filter-trigger]');
        if (!(panel instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;
        closeInvestmentStockDetailsTimeFilters();
        panel.dataset.investmentStockDetailsTimeFilterOwner = 'investment_stock_details_time_filter';
        document.body.appendChild(panel);
        panel.hidden = false;
        field.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        positionInvestmentStockDetailsTimeFilterPanel(field);
        window.requestAnimationFrame(() => {
            panel.querySelector('#investment_stock_details_date_start')
                ?.closest('[data-date-picker]')
                ?.querySelector('[data-date-trigger]')
                ?.click();
        });
    }

function syncInvestmentStockDetailsTimeFilterUi(field) {
        if (!(field instanceof HTMLElement)) return;
        const filterLabel = getInvestmentStockDetailsDateFilterLabel();
        const trigger = field.querySelector('[data-investment-stock-details-time-filter-trigger]');
        const label = field.querySelector('[data-investment-stock-details-time-filter-label]');
        if (label instanceof HTMLElement) label.textContent = filterLabel;
        trigger?.setAttribute('aria-label', `Time filter: ${filterLabel}`);
    }

function applyInvestmentStockDetailsDateFilter() {
        refreshInvestmentStockDetailsTableRows({ refreshHeaders: false });
        const field = runtime.investmentStockDetailsTableHost?.querySelector('[data-investment-stock-details-time-filter]');
        syncInvestmentStockDetailsTimeFilterUi(field);
    }

function bindInvestmentStockDetailsTimeFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentStockDetailsTimeFilterBound === '1') return;
        field.dataset.investmentStockDetailsTimeFilterBound = '1';
        const panel = getInvestmentStockDetailsTimeFilterPanel(field);
        const trigger = field.querySelector('[data-investment-stock-details-time-filter-trigger]');
        const dateInput = field.querySelector('#investment_stock_details_date_start');
        const clearButton = field.querySelector('[data-investment-stock-details-time-filter-clear]');
        if (!(panel instanceof HTMLElement) || !(dateInput instanceof HTMLInputElement)) return;
        window.WORTHWARD_DATE_PICKERS?.initialize(panel);
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasOpen = field.classList.contains('is-open');
            closeInvestmentStockDetailsTimeFilters();
            if (!wasOpen) openInvestmentStockDetailsTimeFilter(field);
        });
        dateInput.addEventListener('change', () => {
            const value = String(dateInput.value || '').trim();
            runtime.state.investmentStockDetailsDateFilter = value
                ? { mode: 'day', value }
                : { mode: 'all', value: '' };
            runtime.syncInvestmentUrl({historyMode: 'replace'});
            applyInvestmentStockDetailsDateFilter();
        });
        dateInput.addEventListener('worthward:date-picker-month-select', (event) => {
            const value = String(event.detail?.value || '').trim();
            if (!/^\d{4}-\d{2}$/.test(value)) return;
            runtime.state.investmentStockDetailsDateFilter = { mode: 'month', value };
            runtime.syncInvestmentUrl({historyMode: 'replace'});
            applyInvestmentStockDetailsDateFilter();
        });
        clearButton?.addEventListener('click', () => {
            dateInput.value = '';
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

function mountInvestmentStockDetailsTimeFilterHeaders(root = document) {
        if (!runtime.state.investmentStockDetailsTimeFilterDocumentListenersBound) {
            runtime.state.investmentStockDetailsTimeFilterDocumentListenersBound = true;
            document.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                if (target.closest('[data-investment-stock-details-time-filter]')) return;
                if (target.closest('[data-investment-stock-details-time-filter-panel]')) return;
                if (target.closest('[data-date-popover]')) return;
                closeInvestmentStockDetailsTimeFilters();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeInvestmentStockDetailsTimeFilters();
            });
            window.addEventListener('resize', () => {
                document.querySelectorAll('[data-investment-stock-details-time-filter].is-open').forEach((field) => {
                    positionInvestmentStockDetailsTimeFilterPanel(field);
                });
            });
        }
        root.querySelectorAll?.('th[aria-label="Time"]').forEach((th) => {
            if (!(th instanceof HTMLElement) || !th.closest('.investment-stock-details-table')) return;
            th.classList.add('scrollable-data-table-filter-header');
            th.classList.add('investment-history-time-filter-header');
            th.innerHTML = renderInvestmentStockDetailsTimeFilterHeaderInnerMarkup();
            bindInvestmentStockDetailsTimeFilterField(th.querySelector('[data-investment-stock-details-time-filter]'));
        });
    }

function applyInvestmentBrokerFilterChange() {
        runtime.closeInvestmentBrokerFilterDropdowns();
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        runtime.syncAllInvestmentBrokerFilterUi();
        if (runtime.state.investmentBrokerFilterApplyRaf) {
            window.cancelAnimationFrame(runtime.state.investmentBrokerFilterApplyRaf);
        }
        runtime.state.investmentBrokerFilterApplyRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentBrokerFilterApplyRaf = 0;
            runtime.renderInvestmentHistoryTableRows(
                runtime.state.investmentProcessedTransactionsCache,
                runtime.state.investmentChartPointsCache,
                { resetPage: true, scrollToTop: true },
            );
            if (runtime.state.activeInvestmentView === 'stock_details') {
                refreshInvestmentStockDetailsTableRows();
            }
            if (runtime.state.activeInvestmentView === 'metrics') {
                runtime.renderInvestmentMetricsPanel();
            }
            runtime.mountInvestmentSideFilterHeaders();
            runtime.mountInvestmentCurrencyFilterHeaders();
            mountInvestmentDescriptionBindingFilterHeaders();
        });
    }

function renderInvestmentStockDetailsTableRowsMarkup(detailRows = []) {
        const filteredDetailRows = runtime.getVisibleInvestmentStockDetailTransactions(detailRows);
        if (!filteredDetailRows.length) {
            return `
                <tr data-table-empty-row>
                    <td colspan="10" class="investment-history-empty-cell">No ticker-linked transactions match the selected filters.</td>
                </tr>
            `;
        }
        return filteredDetailRows.map((txn) => {
            const realizedPnlClass = txn.pnlUnavailable || txn.rowRealizedPnl === null
                ? ''
                : runtime.getInvestmentHoldingsRealizedToneClass(txn.rowRealizedPnl);
            return `
            <tr data-investment-stock-detail-ledger="${txn.ledger_no}">
                ${runtime.renderInvestmentBrokerCell(txn)}
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${runtime.formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${runtime.formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left">${runtime.formatTransactionDescription(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${runtime.formatTransactionCurrency(txn)}</td>
                <td class="investment-history-cell investment-history-cell-right">${runtime.renderInvestmentHistoryMetricValue(runtime.formatAmountWithCurrency(txn.display_amount ?? runtime.getTransactionEconomicAmount(txn), runtime.formatTransactionCurrency(txn), { showUsdSymbol: false }))}</td>
                <td class="investment-history-cell investment-history-cell-right">${runtime.renderInvestmentHistoryMetricValue(runtime.formatTransactionCommissionDisplay(txn))}</td>
                <td class="investment-history-cell investment-history-cell-right">${runtime.renderInvestmentHistoryMetricValue(txn.rowMarketValue === null ? '-' : runtime.formatAmountWithCurrency(txn.rowMarketValue, runtime.formatTransactionCurrency(txn), { showUsdSymbol: false }))}</td>
                <td class="investment-history-cell investment-history-cell-right${realizedPnlClass}">${runtime.renderInvestmentHistoryMetricValue(txn.pnlUnavailable ? 'Unavailable' : (txn.rowRealizedPnl === null ? '-' : runtime.formatAmountWithCurrency(txn.rowRealizedPnl, runtime.formatTransactionCurrency(txn), { showUsdSymbol: false })), '', realizedPnlClass)}</td>
            </tr>
        `;
        }).join('');
    }

function buildSafeInvestmentStockDetailRows(processedTransactions, ticker) {
        const detailRows = runtime.buildInvestmentStockDetailRows(
            runtime.getInvestmentAggregateOnlyTransactions(processedTransactions),
            ticker,
        );
        const pnlUnavailable = runtime.isInvestmentAggregateSecurityTransferPnlUnavailable(ticker)
            || runtime.state.investmentTickerSummariesCache.some((summary) => (
                runtime.normalizeInvestmentTicker(summary?.ticker) === runtime.normalizeInvestmentTicker(ticker)
                && summary?.pnlUnavailable === true
            ));
        if (!pnlUnavailable) return detailRows;
        return detailRows.map((row) => ({
            ...row,
            rowRealizedPnl: null,
            pnlUnavailable: true,
        }));
    }

function buildInvestmentStockDetailsPage(detailRows = [], {resetPage = false} = {}) {
        const visibleDetailRows = runtime.getVisibleInvestmentStockDetailTransactions(detailRows);
        const pageState = runtime.buildInvestmentHistoryPage(
            [...visibleDetailRows].reverse(),
            runtime.state.investmentHistoryCurrentPage,
            {resetPage},
        );
        runtime.state.investmentHistoryCurrentPage = pageState.currentPage;
        return pageState;
    }

function renderInvestmentStockDetailsPageRows(tbody, pageState) {
        if (!(tbody instanceof HTMLElement)) return;
        tbody.innerHTML = pageState.visibleTransactions.length
            ? renderInvestmentStockDetailsTableRowsMarkup(pageState.pageTransactions)
            : `
                <tr data-table-empty-row>
                    <td colspan="10" class="investment-history-empty-cell">No ticker-linked transactions match the selected filters.</td>
                </tr>
            `;
    }

function refreshInvestmentStockDetailsTableRows({ refreshHeaders = true, scrollToTop = false } = {}) {
        if (!(runtime.investmentStockDetailsTableHost instanceof HTMLElement)) return;
        const activeTicker = runtime.ensureSelectedInvestmentStockTicker();
        if (!activeTicker) return;
        const detailRows = buildSafeInvestmentStockDetailRows(
            runtime.state.investmentProcessedTransactionsCache,
            activeTicker,
        );
        const pageState = buildInvestmentStockDetailsPage(detailRows);
        const tbody = runtime.investmentStockDetailsTableHost.querySelector('.investment-stock-details-table-scroll tbody');
        if (!(tbody instanceof HTMLElement)) return;
        renderInvestmentStockDetailsPageRows(tbody, pageState);
        if (refreshHeaders) {
            runtime.mountInvestmentBrokerFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentSideFilterHeaders(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentCurrencyFilterHeaders(runtime.investmentStockDetailsTableHost);
        }
        runtime.bindStockDetailsHistoryInteractions(runtime.investmentStockDetailsTableHost);
        runtime.attachStockDetailsTableAlignmentSync(runtime.investmentStockDetailsTableHost);
        if (runtime.state.activeInvestmentView === 'stock_details') {
            runtime.mountInvestmentHistoryPagination();
            runtime.renderInvestmentHistoryPagination(pageState.visibleTransactions.length, {force: true});
            if (scrollToTop) runtime.resetInvestmentStockDetailsScrollPosition();
        }
    }

function getSelectedInvestmentImportBroker() {
        return runtime.normalizeInvestmentBroker(runtime.investmentImportBrokerSelect?.value || 'hsbc');
    }

function getSelectedIbkrImportMode() {
        const checkedMode = document.querySelector('input[name="ibkr_import_mode"]:checked');
        const value = checkedMode instanceof HTMLInputElement ? checkedMode.value : 'csv';
        if (value === 'gainskeeper') return 'gainskeeper';
        if (value === 'web_paste') return 'web_paste';
        return 'csv';
    }

function getSelectedHsbcImportMode() {
        const checkedMode = document.querySelector('input[name="hsbc_import_mode"]:checked');
        const value = checkedMode instanceof HTMLInputElement ? checkedMode.value : 'paste';
        return value === 'statement_pdf' ? 'statement_pdf' : 'paste';
    }

function syncIbkrImportModePanels() {
        const selectedMode = getSelectedIbkrImportMode();
        if (runtime.investmentImportIbkrMode instanceof HTMLElement) {
            runtime.investmentImportIbkrMode.dataset.active = selectedMode;
            runtime.investmentImportIbkrMode.style.setProperty('--segmented-option-count', '3');
            const activeIndex = selectedMode === 'gainskeeper'
                ? '1'
                : (selectedMode === 'web_paste' ? '2' : '0');
            runtime.investmentImportIbkrMode.style.setProperty('--segmented-active-index', activeIndex);
            runtime.scheduleIbkrImportSegmentedPillUpdate();
        }
        document.querySelectorAll('[data-ibkr-import-mode-panel]').forEach((panel) => {
            if (!(panel instanceof HTMLElement)) return;
            panel.hidden = panel.dataset.ibkrImportModePanel !== selectedMode;
        });
    }

function syncHsbcImportModePanels() {
        const selectedMode = getSelectedHsbcImportMode();
        if (runtime.investmentImportHsbcMode instanceof HTMLElement) {
            runtime.investmentImportHsbcMode.dataset.active = selectedMode;
            runtime.investmentImportHsbcMode.style.setProperty('--segmented-option-count', '2');
            runtime.investmentImportHsbcMode.style.setProperty(
                '--segmented-active-index',
                selectedMode === 'statement_pdf' ? '1' : '0',
            );
            runtime.scheduleHsbcImportSegmentedPillUpdate();
        }
        document.querySelectorAll('[data-hsbc-import-mode-panel]').forEach((panel) => {
            if (!(panel instanceof HTMLElement)) return;
            panel.hidden = panel.dataset.hsbcImportModePanel !== selectedMode;
        });
    }

function toDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

function normalizeClipboardText(rawText) {
        return String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

function countClipboardLines(text) {
        const normalized = normalizeClipboardText(text);
        return normalized ? normalized.split('\n').length : 0;
    }

function hasIbkrCompactOrderCapture(text) {
        return /^(?:Buy|Sold)\s+[\d,]+(?:\.\d+)?\s+[A-Z0-9][A-Z0-9.-]*\s+Limit\s+[\d,]+(?:\.\d+)?\s*,\s*[A-Z0-9._-]+$/im.test(text);
    }

function getIbkrTradeNotificationsReadiness(rawText) {
        const text = normalizeClipboardText(rawText);
        if (!text) {
            return {ready: false, reason: 'empty'};
        }
        const hasCompactOrder = hasIbkrCompactOrderCapture(text);
        const hasDisplayedDate = /\d{1,2}\/\d{1,2}\/20\d{2},\s+\d{1,2}:\d{2}\s+[AP]M/i.test(text);
        const hasPageDate = Boolean(String(runtime.ibkrTradeNotificationsDateInput?.value || '').trim());
        const hasTimeOnlyFill = text.split('\n').some((line) => (
            /^\d{1,2}:\d{2}\s+[AP]M$/i.test(line.trim())
        ));
        const hasTradeShape = Boolean(
            /Orders\s*&\s*Trades/i.test(text)
            && /Trade Notifications/i.test(text)
            && /\bU\d{6,12}\b/i.test(text)
            && (/(?:Bot|Bought|Sold)\s+[\d,]+(?:\.\d+)?\s+@\s+[\d,]+(?:\.\d+)?\s+on\s+[A-Z0-9._-]+/i.test(text) || hasCompactOrder)
            && /\bFilled\b/i.test(text)
            && (/Fees:\s*[\d,]+(?:\.\d+)?/i.test(text) || hasCompactOrder)
        );
        if (!hasTradeShape || (!hasDisplayedDate && !hasPageDate)) {
            return {ready: false, reason: 'invalid_format'};
        }
        if (hasTimeOnlyFill && !hasPageDate) {
            return {ready: false, reason: 'missing_page_date'};
        }
        return {ready: true, reason: 'ready'};
    }

function isLikelyIbkrTradeNotificationsText(rawText) {
        return getIbkrTradeNotificationsReadiness(rawText).ready;
    }

function getIbkrHoldingsReadiness(rawText) {
        const text = normalizeClipboardText(rawText);
        if (!text) return {ready: false, reason: 'empty', positionCount: 0};
        const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
        const holdingsIndex = lines.findIndex((line) => /^Your Holdings$/i.test(line));
        const cashIndex = lines.findIndex((line, index) => (
            index > holdingsIndex && /^Cash Holdings$/i.test(line)
        ));
        const accountCount = new Set(
            Array.from(text.matchAll(/\bU\d{6,12}\b/gi), (match) => match[0].toUpperCase()),
        ).size;
        let positionCount = 0;
        if (holdingsIndex >= 0 && cashIndex > holdingsIndex) {
            for (let index = holdingsIndex + 1; index + 2 < cashIndex; index += 1) {
                if (
                    /^[A-Z][A-Z0-9.-]{0,14}$/.test(lines[index])
                    && /[A-Z]/i.test(lines[index + 1])
                    && /^[+]?[\d,]+(?:\.\d+)?\s+[-+]?\d/.test(lines[index + 2])
                ) {
                    positionCount += 1;
                }
            }
        }
        const hasNativeCash = /(?:^|\n)\s*[A-Z]{3,6}\s+\(base currency\)\s+[+-]?[\d,]+(?:\.\d+)?(?:\s|$)/i.test(text);
        const ready = accountCount === 1
            && holdingsIndex >= 0
            && cashIndex > holdingsIndex
            && positionCount > 0
            && hasNativeCash;
        return {ready, reason: ready ? 'ready' : 'invalid_format', positionCount};
    }

function syncIbkrTradeNotificationsDisplay() {
        if (!(runtime.ibkrTradeNotificationsDisplay instanceof HTMLInputElement)) {
            return;
        }
        const text = normalizeClipboardText(runtime.ibkrTradeNotificationsTextInput?.value || '');
        if (runtime.ibkrTradeNotificationsPasteButton instanceof HTMLButtonElement) {
            const isPasted = Boolean(text);
            runtime.ibkrTradeNotificationsPasteButton.classList.toggle('is-pasted', isPasted);
            runtime.ibkrTradeNotificationsPasteButton.setAttribute(
                'aria-label',
                isPasted
                    ? 'IBKR Trade Notifications page text pasted'
                    : 'Paste IBKR Trade Notifications page text from clipboard',
            );
            runtime.ibkrTradeNotificationsPasteButton.setAttribute(
                'title',
                isPasted ? 'IBKR Trade Notifications text pasted' : 'Paste from clipboard',
            );
        }
        if (!text) {
            runtime.ibkrTradeNotificationsDisplay.value = '';
            runtime.ibkrTradeNotificationsDisplay.title = '';
            return;
        }
        const tradeCount = Array.from(
            text.matchAll(/(?:Bot|Bought|Sold)\s+[\d,]+(?:\.\d+)?\s+@\s+[\d,]+(?:\.\d+)?\s+on\s+[A-Z0-9._-]+/gi)
        ).length;
        const tradeLabel = tradeCount === 1 ? '1 filled trade' : `${tradeCount.toLocaleString('en-US')} filled trades`;
        const lineCount = countClipboardLines(text).toLocaleString('en-US');
        const charCount = text.length.toLocaleString('en-US');
        const validation = getIbkrTradeNotificationsReadiness(text);
        const readiness = validation.reason === 'missing_page_date'
            ? 'Page date required'
            : (validation.ready ? 'Ready' : 'Check format');
        runtime.ibkrTradeNotificationsDisplay.value = `IBKR Trade Notifications · ${tradeLabel} · ${lineCount} lines · ${charCount} chars · ${readiness}`;
        runtime.ibkrTradeNotificationsDisplay.title = text;
    }

function syncIbkrHoldingsDisplay() {
        if (!(runtime.ibkrHoldingsDisplay instanceof HTMLInputElement)) return;
        const text = normalizeClipboardText(runtime.ibkrHoldingsTextInput?.value || '');
        if (runtime.ibkrHoldingsPasteButton instanceof HTMLButtonElement) {
            const isPasted = Boolean(text);
            runtime.ibkrHoldingsPasteButton.classList.toggle('is-pasted', isPasted);
            runtime.ibkrHoldingsPasteButton.setAttribute(
                'aria-label',
                isPasted
                    ? 'IBKR Your Holdings page text pasted'
                    : 'Paste IBKR Your Holdings page text from clipboard',
            );
            runtime.ibkrHoldingsPasteButton.setAttribute(
                'title',
                isPasted ? 'IBKR Your Holdings text pasted' : 'Paste from clipboard',
            );
        }
        if (!text) {
            runtime.ibkrHoldingsDisplay.value = '';
            runtime.ibkrHoldingsDisplay.title = '';
            return;
        }
        const validation = getIbkrHoldingsReadiness(text);
        const positionLabel = validation.positionCount === 1
            ? '1 position'
            : `${validation.positionCount.toLocaleString('en-US')} positions`;
        const lineCount = countClipboardLines(text).toLocaleString('en-US');
        const charCount = text.length.toLocaleString('en-US');
        runtime.ibkrHoldingsDisplay.value = `IBKR Your Holdings · ${positionLabel} · ${lineCount} lines · ${charCount} chars · ${validation.ready ? 'Ready' : 'Check format'}`;
        runtime.ibkrHoldingsDisplay.title = text;
    }

async function pasteIbkrTradeNotificationsFromClipboard() {
        if (!navigator.clipboard?.readText) {
            runtime.setImportFeedback('Clipboard paste is unavailable in this browser context.', 'error');
            return;
        }
        try {
            const text = normalizeClipboardText(await navigator.clipboard.readText());
            if (!text) {
                runtime.setImportFeedback('Clipboard is empty.', 'error');
                return;
            }
            if (!(runtime.ibkrTradeNotificationsTextInput instanceof HTMLTextAreaElement)) {
                return;
            }
            runtime.ibkrTradeNotificationsTextInput.value = text;
            syncIbkrTradeNotificationsDisplay();
            runtime.syncImportValidationState();
            runtime.clearImportFeedback();
        } catch (_error) {
            runtime.setImportFeedback('Clipboard access was blocked. Allow clipboard permissions, then try again.', 'error');
        }
    }

async function pasteIbkrHoldingsFromClipboard() {
        if (!navigator.clipboard?.readText) {
            runtime.setImportFeedback('Clipboard paste is unavailable in this browser context.', 'error');
            return;
        }
        try {
            const text = normalizeClipboardText(await navigator.clipboard.readText());
            if (!text) {
                runtime.setImportFeedback('Clipboard is empty.', 'error');
                return;
            }
            if (!(runtime.ibkrHoldingsTextInput instanceof HTMLTextAreaElement)) return;
            runtime.ibkrHoldingsTextInput.value = text;
            syncIbkrHoldingsDisplay();
            runtime.syncImportValidationState();
            runtime.clearImportFeedback();
        } catch (_error) {
            runtime.setImportFeedback('Clipboard access was blocked. Allow clipboard permissions, then try again.', 'error');
        }
    }

function splitHsbcPastedTextChunks(rawText) {
        const normalized = normalizeClipboardText(rawText);
        if (!normalized) {
            return [];
        }
        const parts = normalized.split(new RegExp(`\\n+\\s*${runtime.HSBC_PASTE_CHUNK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'g'));
        const chunks = [];
        const seen = new Set();
        parts.forEach((part) => {
            const chunk = normalizeClipboardText(part);
            if (!chunk) {
                return;
            }
            const chunkKey = chunk.replace(/\s+/g, ' ').trim();
            if (!chunkKey || seen.has(chunkKey)) {
                return;
            }
            seen.add(chunkKey);
            chunks.push(chunk);
        });
        return chunks;
    }

function mergeHsbcPastedText(existingRawText, incomingRawText) {
        const incomingText = normalizeClipboardText(incomingRawText);
        if (!incomingText) {
            return { mergedText: '', addedChunkCount: 0, duplicate: false };
        }
        const chunks = splitHsbcPastedTextChunks(existingRawText);
        const existingKeys = new Set(chunks.map((chunk) => chunk.replace(/\s+/g, ' ').trim()));
        const incomingKey = incomingText.replace(/\s+/g, ' ').trim();
        if (existingKeys.has(incomingKey)) {
            return {
                mergedText: chunks.join(`\n\n${runtime.HSBC_PASTE_CHUNK_MARKER}\n\n`),
                addedChunkCount: 0,
                duplicate: true,
            };
        }
        const mergedChunks = [...chunks, incomingText];
        return {
            mergedText: mergedChunks.join(`\n\n${runtime.HSBC_PASTE_CHUNK_MARKER}\n\n`),
            addedChunkCount: 1,
            duplicate: false,
        };
    }

function summarizeHsbcPastedText(kind, rawText, validationState) {
        const normalized = normalizeClipboardText(rawText);
        if (!normalized) {
            return '';
        }
        const chunkCount = splitHsbcPastedTextChunks(normalized).length || 1;
        const lineCount = countClipboardLines(normalized);
        const charCount = normalized.length.toLocaleString('en-US');
        const label = kind === 'cash'
            ? 'HSBC cash accounts'
            : (kind === 'portfolio' ? 'Portfolio' : 'Order Status');
        const chunkLabel = chunkCount === 1 ? '1 clip' : `${chunkCount.toLocaleString('en-US')} clips`;
        const readiness = validationState === 'valid'
            ? 'Ready'
            : (validationState === 'pending' ? 'Checking…' : 'Check format');
        return `${label} clipboard pasted · ${chunkLabel} · ${lineCount} lines · ${charCount} chars · ${readiness}`;
    }

function getHsbcPasteTexts() {
        return {
            cash: String(runtime.hsbcCashAccountTextInput?.value || '').trim(),
            portfolio: String(runtime.hsbcPortfolioTextInput?.value || '').trim(),
            order_status: String(runtime.hsbcOrderStatusTextInput?.value || '').trim(),
        };
    }

function getHsbcPasteValidationSignature(texts = getHsbcPasteTexts()) {
        return [texts.cash, texts.portfolio, texts.order_status].join('\u0000');
    }

function getHsbcPasteInput(kind) {
        if (kind === 'cash') return runtime.hsbcCashAccountTextInput;
        if (kind === 'portfolio') return runtime.hsbcPortfolioTextInput;
        if (kind === 'order') return runtime.hsbcOrderStatusTextInput;
        return null;
    }

function getHsbcPasteDisplayInput(kind) {
        if (kind === 'cash') return runtime.hsbcCashAccountDisplay;
        if (kind === 'portfolio') return runtime.hsbcPortfolioTextDisplay;
        if (kind === 'order') return runtime.hsbcOrderStatusDisplay;
        return null;
    }

function getHsbcPasteClearButton(kind) {
        if (kind === 'cash') return runtime.hsbcCashAccountTextClearButton;
        if (kind === 'portfolio') return runtime.hsbcPortfolioTextClearButton;
        if (kind === 'order') return runtime.hsbcOrderStatusTextClearButton;
        return null;
    }

function getHsbcPasteValidationFieldKey(kind) {
        return kind === 'order' ? 'order_status' : kind;
    }

function getHsbcPasteFieldValidationState(kind, rawText) {
        if (!String(rawText || '').trim()) {
            return 'empty';
        }
        const texts = getHsbcPasteTexts();
        const signature = getHsbcPasteValidationSignature(texts);
        if (runtime.state.hsbcPasteValidation.signature !== signature) {
            return 'pending';
        }
        if (runtime.state.hsbcPasteValidation.state === 'pending') {
            return 'pending';
        }
        const fieldKey = getHsbcPasteValidationFieldKey(kind);
        return runtime.state.hsbcPasteValidation.state === 'valid' && runtime.state.hsbcPasteValidation.fieldStatus[fieldKey]
            ? 'valid'
            : 'invalid';
    }

function syncHsbcPasteClearButtons() {
        ['cash', 'portfolio', 'order'].forEach((kind) => {
            const input = getHsbcPasteInput(kind);
            const button = getHsbcPasteClearButton(kind);
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }
            button.classList.toggle('is-visible', Boolean(String(input?.value || '').trim()));
        });
    }

function setHsbcPasteStatusIcon(icon, validationState, title = '') {
        if (!icon) return;
        const isPending = validationState === 'pending';
        icon.classList.toggle('suggestion-loading-spinner', isPending);
        runtime.setImportStatusIcon(
            icon,
            isPending || validationState === 'valid',
            title || (isPending ? 'Checking HSBC pasted text…' : ''),
        );
    }

function cancelHsbcPasteValidation() {
        if (runtime.state.hsbcPasteValidationTimer) {
            window.clearTimeout(runtime.state.hsbcPasteValidationTimer);
            runtime.state.hsbcPasteValidationTimer = 0;
        }
        runtime.state.hsbcPasteValidationAbortController?.abort();
        runtime.state.hsbcPasteValidationAbortController = null;
    }

function isHsbcPasteValidationActive() {
        return getSelectedInvestmentImportBroker() === 'hsbc'
            && getSelectedHsbcImportMode() === 'paste';
    }

function resetHsbcPasteValidation() {
        cancelHsbcPasteValidation();
        runtime.state.hsbcPasteValidation = {
            signature: '',
            state: 'idle',
            ready: false,
            mode: '',
            fieldStatus: {
                cash: false,
                portfolio: false,
                order_status: false,
            },
            cashCurrencies: [],
        };
    }

function requestHsbcPasteValidation({ debounce = true } = {}) {
        if (!isHsbcPasteValidationActive()) {
            return;
        }
        const texts = getHsbcPasteTexts();
        const signature = getHsbcPasteValidationSignature(texts);
        cancelHsbcPasteValidation();
        if (!texts.cash && !texts.portfolio && !texts.order_status) {
            runtime.state.hsbcPasteValidation = {
                signature,
                state: 'idle',
                ready: false,
                mode: '',
                fieldStatus: {
                    cash: false,
                    portfolio: false,
                    order_status: false,
                },
                cashCurrencies: [],
            };
            syncHsbcPasteDisplaySummaries();
            runtime.syncImportValidationState();
            return;
        }

        runtime.state.hsbcPasteValidation = {
            signature,
            state: 'pending',
            ready: false,
            mode: '',
            fieldStatus: {
                cash: Boolean(texts.cash),
                portfolio: Boolean(texts.portfolio),
                order_status: Boolean(texts.order_status),
            },
            cashCurrencies: [],
        };
        syncHsbcPasteDisplaySummaries();
        runtime.syncImportValidationState();

        const validate = async () => {
            runtime.state.hsbcPasteValidationTimer = 0;
            const abortController = new AbortController();
            runtime.state.hsbcPasteValidationAbortController = abortController;
            try {
                if (!(await runtime.ensureInvestmentImportSession())) {
                    throw new Error(runtime.describeInvestmentImportSessionFailure());
                }
                const response = await fetch(
                    runtime.HSBC_PASTE_VALIDATION_ENDPOINT,
                    runtime.buildInvestmentRequestOptions({
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            cash_account_text: texts.cash,
                            portfolio_text: texts.portfolio,
                            order_status_text: texts.order_status,
                        }),
                        signal: abortController.signal,
                    }),
                );
                const result = await response.json().catch(() => ({}));
                if (
                    !isHsbcPasteValidationActive()
                    ||
                    signature !== getHsbcPasteValidationSignature()
                    || runtime.state.hsbcPasteValidationAbortController !== abortController
                ) {
                    return;
                }
                if (!response.ok || !result.success) {
                    runtime.state.hsbcPasteValidation = {
                        signature,
                        state: 'invalid',
                        ready: false,
                        mode: '',
                        fieldStatus: {
                            cash: false,
                            portfolio: false,
                            order_status: false,
                        },
                        cashCurrencies: [],
                    };
                    runtime.setImportFeedback(
                        result.error || 'The pasted HSBC text did not pass validation.',
                        'error',
                    );
                    return;
                }
                const fieldStatus = result.field_status && typeof result.field_status === 'object'
                    ? result.field_status
                    : {};
                runtime.state.hsbcPasteValidation = {
                    signature,
                    state: 'valid',
                    ready: Boolean(result.ready),
                    mode: String(result.mode || ''),
                    fieldStatus: {
                        cash: fieldStatus.cash === true,
                        portfolio: fieldStatus.portfolio === true,
                        order_status: fieldStatus.order_status === true,
                    },
                    cashCurrencies: Array.isArray(result.cash_currencies)
                        ? result.cash_currencies.map((currency) => String(currency || '').trim()).filter(Boolean)
                        : [],
                };
                runtime.clearImportFeedback();
            } catch (error) {
                if (error?.name === 'AbortError') {
                    return;
                }
                if (
                    !isHsbcPasteValidationActive()
                    || signature !== getHsbcPasteValidationSignature()
                ) {
                    return;
                }
                runtime.state.hsbcPasteValidation = {
                    signature,
                    state: 'invalid',
                    ready: false,
                    mode: '',
                    fieldStatus: {
                        cash: false,
                        portfolio: false,
                        order_status: false,
                    },
                    cashCurrencies: [],
                };
                runtime.setImportFeedback(
                    `Unable to validate the pasted HSBC text: ${error?.message || 'network request failed'}`,
                    'error',
                );
            } finally {
                if (runtime.state.hsbcPasteValidationAbortController === abortController) {
                    runtime.state.hsbcPasteValidationAbortController = null;
                }
                syncHsbcPasteDisplaySummaries();
                runtime.syncImportValidationState();
            }
        };
        if (debounce) {
            runtime.state.hsbcPasteValidationTimer = window.setTimeout(
                () => { void validate(); },
                runtime.HSBC_PASTE_VALIDATION_DEBOUNCE_MS,
            );
        } else {
            void validate();
        }
    }

function clearHsbcPastedText(kind) {
        const input = getHsbcPasteInput(kind);
        if (!(input instanceof HTMLTextAreaElement)) {
            return;
        }
        input.value = '';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        const displayInput = getHsbcPasteDisplayInput(kind);
        if (displayInput instanceof HTMLInputElement) {
            displayInput.focus();
        }
    }

function getHsbcPasteButton(kind) {
        if (kind === 'cash') return runtime.hsbcCashAccountPasteButton;
        if (kind === 'portfolio') return runtime.hsbcPortfolioTextPasteButton;
        if (kind === 'order') return runtime.hsbcOrderStatusPasteButton;
        return null;
    }

function flashHsbcPasteButton(kind) {
        const button = getHsbcPasteButton(kind);
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        const priorTimer = runtime.hsbcPasteButtonFlashTimers.get(button);
        if (priorTimer) {
            window.clearTimeout(priorTimer);
        }
        button.classList.add('is-pasted');
        const timerId = window.setTimeout(() => {
            button.classList.remove('is-pasted');
            runtime.hsbcPasteButtonFlashTimers.delete(button);
        }, 1200);
        runtime.hsbcPasteButtonFlashTimers.set(button, timerId);
    }

function updateHsbcPasteFieldDisplay(displayInput, summaryText, rawText) {
        if (!(displayInput instanceof HTMLInputElement)) {
            return;
        }
        displayInput.value = summaryText;
        displayInput.title = normalizeClipboardText(rawText);
    }

function syncHsbcPasteDisplaySummaries() {
        const cashText = String(runtime.hsbcCashAccountTextInput?.value || '');
        const portfolioText = String(runtime.hsbcPortfolioTextInput?.value || '');
        const orderText = String(runtime.hsbcOrderStatusTextInput?.value || '');
        const cashState = getHsbcPasteFieldValidationState('cash', cashText);
        const portfolioState = getHsbcPasteFieldValidationState('portfolio', portfolioText);
        const orderState = getHsbcPasteFieldValidationState('order', orderText);
        updateHsbcPasteFieldDisplay(
            runtime.hsbcCashAccountDisplay,
            summarizeHsbcPastedText('cash', cashText, cashState),
            cashText,
        );
        updateHsbcPasteFieldDisplay(
            runtime.hsbcPortfolioTextDisplay,
            summarizeHsbcPastedText('portfolio', portfolioText, portfolioState),
            portfolioText,
        );
        updateHsbcPasteFieldDisplay(
            runtime.hsbcOrderStatusDisplay,
            summarizeHsbcPastedText('order', orderText, orderState),
            orderText,
        );
        syncHsbcPasteClearButtons();
    }

async function pasteHsbcClipboardIntoField(kind) {
        if (!navigator.clipboard?.readText) {
            runtime.setImportFeedback('Clipboard paste is unavailable in this browser context.', 'error');
            return;
        }
        try {
            const rawText = await navigator.clipboard.readText();
            const normalizedText = normalizeClipboardText(rawText);
            if (!normalizedText) {
                runtime.setImportFeedback('Clipboard is empty.', 'error');
                return;
            }
            let mergeResult = null;
            if (kind === 'cash' && runtime.hsbcCashAccountTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(runtime.hsbcCashAccountTextInput.value, normalizedText);
                runtime.hsbcCashAccountTextInput.value = mergeResult.mergedText;
            } else if (kind === 'portfolio' && runtime.hsbcPortfolioTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(runtime.hsbcPortfolioTextInput.value, normalizedText);
                runtime.hsbcPortfolioTextInput.value = mergeResult.mergedText;
            } else if (kind === 'order' && runtime.hsbcOrderStatusTextInput instanceof HTMLTextAreaElement) {
                mergeResult = mergeHsbcPastedText(runtime.hsbcOrderStatusTextInput.value, normalizedText);
                runtime.hsbcOrderStatusTextInput.value = mergeResult.mergedText;
            }
            runtime.clearImportFeedback();
            syncHsbcPasteDisplaySummaries();
            runtime.syncImportValidationState();
            requestHsbcPasteValidation({debounce: false});
            flashHsbcPasteButton(kind);
        } catch (_error) {
            runtime.setImportFeedback('Clipboard access was blocked. Allow clipboard permissions, then try again.', 'error');
        }
    }

function seedLongbridgeImportDateRange() {
        if (!(runtime.longbridgeStartDateInput instanceof HTMLInputElement) || !(runtime.longbridgeEndDateInput instanceof HTMLInputElement)) {
            return;
        }
        const today = new Date();
        const defaultEnd = toDateInputValue(today);
        const defaultStartDate = new Date(today);
        defaultStartDate.setFullYear(defaultStartDate.getFullYear() - 1);
        const defaultStart = toDateInputValue(defaultStartDate);
        let didChange = false;
        if (!runtime.longbridgeEndDateInput.value) {
            runtime.longbridgeEndDateInput.value = defaultEnd;
            didChange = true;
        }
        if (!runtime.longbridgeStartDateInput.value) {
            runtime.longbridgeStartDateInput.value = defaultStart;
            didChange = true;
        }
        if (didChange) {
            runtime.longbridgeStartDateInput.dispatchEvent(new Event('change', {bubbles: true}));
            runtime.longbridgeEndDateInput.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }

function syncInvestmentImportMode() {
        const selectedBroker = getSelectedInvestmentImportBroker();
        const isIbkr = selectedBroker === 'ibkr';
        const ibkrImportMode = getSelectedIbkrImportMode();
        const hsbcImportMode = getSelectedHsbcImportMode();
        const isIbkrGainskeeper = isIbkr && ibkrImportMode === 'gainskeeper';
        const isIbkrWebPaste = isIbkr && ibkrImportMode === 'web_paste';
        const isLongbridgeHk = selectedBroker === 'longbridge_hk';
        const isLongbridgeSg = selectedBroker === 'longbridge_sg';
        const isFutuhk = selectedBroker === 'futuhk';
        const isBocHk = selectedBroker === 'boc_hk';
        const isHsbc = selectedBroker === 'hsbc';
        const isHsbcPaste = isHsbc && hsbcImportMode === 'paste';
        const isHsbcStatementPdf = isHsbc && hsbcImportMode === 'statement_pdf';
        const isSchwab = selectedBroker === 'schwab';
        const isTigertrade = selectedBroker === 'tigertrade';
        const isUsmartHk = selectedBroker === 'usmart_hk';
        const isStandardXlsx = selectedBroker === 'standard_xlsx';
        const usesStandardXlsxImport = runtime.GENERIC_XLSX_INVESTMENT_BROKERS.has(selectedBroker);
        const usesSyncAction = isLongbridgeHk
            || isIbkrWebPaste
            || (isHsbc && hsbcImportMode === 'paste');

        if (runtime.investmentImportIbkrFields instanceof HTMLElement) {
            runtime.investmentImportIbkrFields.hidden = !isIbkr;
            syncIbkrImportModePanels();
        }
        if (runtime.investmentImportLongbridgeHkFields instanceof HTMLElement) {
            runtime.investmentImportLongbridgeHkFields.hidden = !isLongbridgeHk;
        }
        if (runtime.investmentImportLongbridgeSgFields instanceof HTMLElement) {
            runtime.investmentImportLongbridgeSgFields.hidden = !isLongbridgeSg;
        }
        if (runtime.investmentImportFutuhkFields instanceof HTMLElement) {
            runtime.investmentImportFutuhkFields.hidden = !isFutuhk;
        }
        if (runtime.investmentImportBocHkFields instanceof HTMLElement) {
            runtime.investmentImportBocHkFields.hidden = !isBocHk;
        }
        if (runtime.investmentImportHsbcFields instanceof HTMLElement) {
            runtime.investmentImportHsbcFields.hidden = !isHsbc;
            syncHsbcImportModePanels();
        }
        if (runtime.investmentImportSchwabFields instanceof HTMLElement) {
            runtime.investmentImportSchwabFields.hidden = !isSchwab;
        }
        if (runtime.investmentImportTigertradeFields instanceof HTMLElement) {
            runtime.investmentImportTigertradeFields.hidden = !isTigertrade;
        }
        if (runtime.investmentImportUsmartHkFields instanceof HTMLElement) {
            runtime.investmentImportUsmartHkFields.hidden = !isUsmartHk;
        }
        if (runtime.investmentImportZirconHkFields instanceof HTMLElement) {
            runtime.investmentImportZirconHkFields.hidden = !usesStandardXlsxImport;
        }
        if (runtime.transactionsCsvInput instanceof HTMLInputElement) {
            runtime.transactionsCsvInput.required = isIbkr && ibkrImportMode === 'csv';
        }
        if (runtime.positionsCsvInput instanceof HTMLInputElement) {
            runtime.positionsCsvInput.required = isIbkr && ibkrImportMode === 'csv';
        }
        if (runtime.gainskeeperFilesInput instanceof HTMLInputElement) {
            runtime.gainskeeperFilesInput.required = isIbkrGainskeeper;
        }
        if (runtime.longbridgeSgFundDetailsInput instanceof HTMLInputElement) {
            runtime.longbridgeSgFundDetailsInput.required = isLongbridgeSg;
        }
        if (runtime.longbridgeSgHistoryOrdersInput instanceof HTMLInputElement) {
            runtime.longbridgeSgHistoryOrdersInput.required = isLongbridgeSg;
        }
        if (runtime.longbridgeHkFundDetailsInput instanceof HTMLInputElement) {
            runtime.longbridgeHkFundDetailsInput.required = isLongbridgeHk;
        }
        if (runtime.longbridgeHkHistoryOrdersInput instanceof HTMLInputElement) {
            runtime.longbridgeHkHistoryOrdersInput.required = isLongbridgeHk;
        }
        if (runtime.futuhkStatementPdfsInput instanceof HTMLInputElement) {
            runtime.futuhkStatementPdfsInput.required = isFutuhk;
        }
        if (runtime.bocHkStatementPdfsInput instanceof HTMLInputElement) {
            runtime.bocHkStatementPdfsInput.required = isBocHk;
        }
        if (runtime.schwabTransactionsCsvInput instanceof HTMLInputElement) {
            runtime.schwabTransactionsCsvInput.required = isSchwab;
        }
        if (runtime.schwabPositionsCsvInput instanceof HTMLInputElement) {
            runtime.schwabPositionsCsvInput.required = isSchwab;
        }
        if (runtime.tigertradeStatementPdfsInput instanceof HTMLInputElement) {
            runtime.tigertradeStatementPdfsInput.required = isTigertrade;
        }
        if (runtime.usmartHkStatementPdfsInput instanceof HTMLInputElement) {
            runtime.usmartHkStatementPdfsInput.required = isUsmartHk;
        }
        if (runtime.zirconHkTransactionsXlsxInput instanceof HTMLInputElement) {
            runtime.zirconHkTransactionsXlsxInput.required = usesStandardXlsxImport;
        }
        if (runtime.hsbcStatementPdfsInput instanceof HTMLInputElement) {
            runtime.hsbcStatementPdfsInput.required = isHsbc && hsbcImportMode === 'statement_pdf';
        }
        if (runtime.investmentImportNote instanceof HTMLElement) {
            runtime.investmentImportNote.innerHTML = isHsbc
                ? (hsbcImportMode === 'statement_pdf'
                    ? 'Choose one or more full HSBC monthly statement PDFs. Matching composite/investment statement pairs remain supported.'
                    : 'Paste HSBC cash-account pages here. USD Savings settlement-only cash refreshes and HKD/CNH cash-only captures can sync on their own; a full USD Portfolio and Order Status snapshot remains available when holdings also need refresh. Supplementary captures are allowed and duplicate chunks are ignored.')
                : (isLongbridgeHk
                    ? 'Imports Longbridge (HK) Fund Details + History Orders files (supports coupons/rewards) into <code>settings_store/investment.parquet</code> without clearing existing records.'
                    : (isLongbridgeSg
                        ? 'Imports Longbridge (SG) Fund Details text and History Orders spreadsheets into <code>settings_store/investment.parquet</code> without clearing existing records.'
                        : (isFutuhk
                        ? 'Imports Futu (HK) monthly statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                        : (isBocHk
                        ? 'Imports one or more BOCHK Consolidated Statement PDFs, preserving HKD Savings, HKD Current, CNH (printed CNY/RMB), and USD subaccounts in the local ledger without clearing existing records.'
                        : (isIbkrWebPaste
                            ? 'Paste the IBKR Trade Notifications page for an immediate provisional sync. Optionally paste the full Your Holdings page to capture validated cash and positions without manual entry. Matching CSV or GainsKeeper files imported later replace rounded trade values.'
                        : (isIbkrGainskeeper
                            ? 'Upload as many IBKR GainsKeeper OFX/GKX files as available. Overlapping files are allowed and matching CSV rows are upgraded.'
                            : (isTigertrade
                                ? 'Imports Tiger Trade activity statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                                : (isUsmartHk
                                    ? 'Imports uSMART (HK) monthly statement PDFs into <code>settings_store/investment.parquet</code> without clearing existing records.'
                                    : (usesStandardXlsxImport
                                        ? (isStandardXlsx
                                            ? 'Upload any Worthward standard XLSX workbook. Each row retains its own broker identity and is validated before import.'
                                            : 'Download the typed standard workbook, enter only real broker activity, then upload it for server validation before importing.')
                                    : (isSchwab
                                ? 'Upload the Charles Schwab Transactions and Positions CSV exports together. Exact same-day ticker and quantity matches are linked as in-kind transfers; ambiguous matches require manual binding.'
                                : (isIbkr
                                    ? 'Upload the IBKR Transaction History CSV and Realized Summary CSV for the same account and period.'
                                    : 'Imports into <code>settings_store/investment.parquet</code> without clearing existing records.')))))))))));
        }
        if (runtime.importSubmitButton instanceof HTMLButtonElement) {
            runtime.importSubmitButton.dataset.defaultLabel = usesSyncAction ? 'Sync now' : 'Import now';
            runtime.importSubmitButton.dataset.pendingLabel = usesSyncAction ? 'Syncing' : 'Importing';
        }
        if (isHsbcPaste) {
            const hsbcPasteTexts = getHsbcPasteTexts();
            const hsbcPasteSignature = getHsbcPasteValidationSignature(hsbcPasteTexts);
            if (
                (hsbcPasteTexts.cash || hsbcPasteTexts.portfolio || hsbcPasteTexts.order_status)
                && runtime.state.hsbcPasteValidation.signature !== hsbcPasteSignature
            ) {
                requestHsbcPasteValidation();
            }
        } else {
            resetHsbcPasteValidation();
        }
        seedLongbridgeImportDateRange();
    }

function getTransactionBrokerCode(txn) {
        return runtime.normalizeInvestmentBroker(
            txn?.broker
            || txn?.source?.broker
            || window.WORTHWARD_INVESTMENT_DATA?.broker
            || 'ibkr'
        );
    }

function isUnsettledHsbcBuyTransaction(txn) {
        return (
            runtime.normalizeInvestmentBroker(getTransactionBrokerCode(txn)) === 'hsbc'
            && runtime.getNormalizedTransactionType(txn) === 'buy'
            && runtime.isHsbcSettlementActuallyPending(txn?.source)
        );
    }

    return {
        applyInvestmentDescriptionBindingFilter,
        openInvestmentDescriptionBindingFilterDropdown,
        bindInvestmentDescriptionBindingFilterField,
        positionInvestmentDescriptionBindingAlertTooltip,
        closeInvestmentDescriptionBindingAlertTooltip,
        openInvestmentDescriptionBindingAlertTooltip,
        bindInvestmentDescriptionBindingAlertInteractions,
        mountInvestmentDescriptionBindingFilterHeaders,
        getInvestmentStockDetailsDateFilterLabel,
        matchesInvestmentStockDetailsDateFilter,
        renderInvestmentStockDetailsDatePickerField,
        renderInvestmentStockDetailsTimeFilterHeaderInnerMarkup,
        getInvestmentStockDetailsTimeFilterPanel,
        closeInvestmentStockDetailsTimeFilters,
        positionInvestmentStockDetailsTimeFilterPanel,
        openInvestmentStockDetailsTimeFilter,
        syncInvestmentStockDetailsTimeFilterUi,
        applyInvestmentStockDetailsDateFilter,
        bindInvestmentStockDetailsTimeFilterField,
        mountInvestmentStockDetailsTimeFilterHeaders,
        applyInvestmentBrokerFilterChange,
        renderInvestmentStockDetailsTableRowsMarkup,
        buildSafeInvestmentStockDetailRows,
        buildInvestmentStockDetailsPage,
        renderInvestmentStockDetailsPageRows,
        refreshInvestmentStockDetailsTableRows,
        getSelectedInvestmentImportBroker,
        getSelectedIbkrImportMode,
        getSelectedHsbcImportMode,
        syncIbkrImportModePanels,
        syncHsbcImportModePanels,
        toDateInputValue,
        normalizeClipboardText,
        countClipboardLines,
        hasIbkrCompactOrderCapture,
        getIbkrTradeNotificationsReadiness,
        isLikelyIbkrTradeNotificationsText,
        getIbkrHoldingsReadiness,
        syncIbkrTradeNotificationsDisplay,
        syncIbkrHoldingsDisplay,
        pasteIbkrTradeNotificationsFromClipboard,
        pasteIbkrHoldingsFromClipboard,
        splitHsbcPastedTextChunks,
        mergeHsbcPastedText,
        summarizeHsbcPastedText,
        getHsbcPasteTexts,
        getHsbcPasteValidationSignature,
        getHsbcPasteInput,
        getHsbcPasteDisplayInput,
        getHsbcPasteClearButton,
        getHsbcPasteValidationFieldKey,
        getHsbcPasteFieldValidationState,
        syncHsbcPasteClearButtons,
        setHsbcPasteStatusIcon,
        cancelHsbcPasteValidation,
        isHsbcPasteValidationActive,
        resetHsbcPasteValidation,
        requestHsbcPasteValidation,
        clearHsbcPastedText,
        getHsbcPasteButton,
        flashHsbcPasteButton,
        updateHsbcPasteFieldDisplay,
        syncHsbcPasteDisplaySummaries,
        pasteHsbcClipboardIntoField,
        seedLongbridgeImportDateRange,
        syncInvestmentImportMode,
        getTransactionBrokerCode,
        isUnsettledHsbcBuyTransaction,
    };
}
