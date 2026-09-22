/**
 * Export formatting and history-table presentation.
 *
 * Code version: v1.2.0
 * - Changed: The unresolved HSBC order reference is the sole visible `*`
 *   marker; Cash and Equity retain their explanatory titles without repeating
 *   the same provisional state on every affected history metric.
 * - Changed: A Schwab security receipt binds only an imported matching source
 *   transfer-out leg; unrelated accounts are no longer offered as sources.
 */

export function createInvestmentExportHistoryRuntime(runtime) {
function shouldPreserveSequentialBrokerBuyHistory(txn) {
        if (runtime.getNormalizedTransactionType(txn) !== 'buy') return false;
        return runtime.isUnsettledHsbcBuyTransaction(txn);
    }

function renderInvestmentBrokerCell(txn) {
        const brokerMeta = runtime.getInvestmentBrokerMeta(runtime.getTransactionBrokerCode(txn));
        const logoMarkup = brokerMeta.logoUrl
            ? `
                    <img class="ticker-input-logo investment-history-broker-logo"
                         src="${runtime.escapeHtml(brokerMeta.logoUrl)}"
                         alt="${runtime.escapeHtml(brokerMeta.logoAlt)}"
                         loading="eager"
                         decoding="async">`
            : '';
        return `
            <td class="investment-history-cell investment-history-cell-center investment-history-broker-cell">
                <span class="ticker-leading-slot investment-history-broker-slot" aria-hidden="true">
                    <span class="ticker-logo-placeholder investment-history-broker-placeholder"></span>
                    ${logoMarkup}
                </span>
                <span class="sr-only">${runtime.escapeHtml(brokerMeta.label)}</span>
            </td>
        `;
    }

function renderInvestmentStockDetailsColgroup() {
        return `
            <colgroup>
                <col style="width: var(--investment-col-broker-width);">
                <col style="width: var(--investment-col-no-width);">
                <col style="width: var(--investment-col-time-width);">
                <col style="width: var(--investment-col-type-width);">
                <col style="width: var(--investment-col-description-width);">
                <col style="width: var(--investment-col-currency-width);">
                <col style="width: var(--investment-col-amount-width);">
                <col style="width: var(--investment-col-commission-width);">
                <col style="width: var(--investment-col-market-value-width);">
                <col style="width: var(--investment-stock-col-realized-width);">
            </colgroup>
        `;
    }

function syncHoldingsChartHoverState(ticker, ledgerNo) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const normalizedLedgerNo = Number.isFinite(Number(ledgerNo)) && Number(ledgerNo) > 0
            ? Number(ledgerNo)
            : 0;
        const shouldUpdate = normalizedTicker !== runtime.state.activeHoldingsHoverTicker || normalizedLedgerNo !== runtime.state.activeHoldingsHoverLedgerNo;
        runtime.state.activeHoldingsHoverTicker = normalizedTicker;
        runtime.state.activeHoldingsHoverLedgerNo = normalizedLedgerNo;
        if (!shouldUpdate) return;
        runtime.scheduleInvestmentDummyDonutSync();
        runtime.scheduleInvestmentStockDetailsDonutSync();
        if (!runtime.state.investmentEquityChartInstance || runtime.state.investmentEquityHoverSyncFrame) return;
        runtime.state.investmentEquityHoverSyncFrame = window.requestAnimationFrame(() => {
            runtime.state.investmentEquityHoverSyncFrame = 0;
            if (!runtime.state.investmentEquityChartInstance) return;
            runtime.state.investmentEquityChartInstance.draw();
        });
    }

function easeOutCubic(t) {
        if (window.WorthwardMotion?.easing?.emphasized) {
            return window.WorthwardMotion.easing.emphasized(t);
        }
        const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const inverse = 1 - clamped;
        return 1 - (inverse * inverse * inverse);
    }

function normalizeMarkdownCellWhitespace(value, { preserveLineBreaks = false } = {}) {
        const normalized = String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .trim();
        if (!preserveLineBreaks) {
            return normalized
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return normalized
            .replace(/[ \t]*\r?\n[ \t]*/g, '\n')
            .replace(/\n{2,}/g, '\n');
    }

function extractMarkdownTableCellText(cell) {
        if (!(cell instanceof HTMLElement)) return '';
        const exportLabel = normalizeMarkdownCellWhitespace(cell.getAttribute('data-markdown-export-label') || '');
        if (cell.tagName === 'TH' && exportLabel) return exportLabel;
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('br').forEach((lineBreakNode) => {
            lineBreakNode.replaceWith('\n');
        });
        const rawText = clone.innerText || clone.textContent || '';
        const normalized = normalizeMarkdownCellWhitespace(rawText, { preserveLineBreaks: true });
        const extractedText = normalized
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join('<br/>');
        if (extractedText) return extractedText;
        return normalizeMarkdownCellWhitespace(cell.getAttribute('aria-label') || '');
    }

function escapeMarkdownTableCell(value) {
        return normalizeMarkdownCellWhitespace(value, { preserveLineBreaks: true })
            .replace(/\|/g, '\\|')
            .replace(/\n/g, '<br/>')
            .trim();
    }

function extractMarkdownTable(tableElement) {
        if (!tableElement) return '';
        const rows = Array.from(tableElement.querySelectorAll('tr'));
        if (!rows.length) return '';

        const matrix = rows
            .map((row) => Array.from(row.children).map((cell) => escapeMarkdownTableCell(extractMarkdownTableCellText(cell))))
            .filter((row) => row.some((cell) => cell.length > 0));
        if (!matrix.length) return '';

        const header = matrix[0];
        const body = matrix.slice(1);
        const alignment = header.map(() => '---');
        const tableLines = [
            `| ${header.join(' | ')} |`,
            `| ${alignment.join(' | ')} |`,
            ...body.map((row) => {
                const paddedRow = [...row];
                while (paddedRow.length < header.length) {
                    paddedRow.push('');
                }
                return `| ${paddedRow.join(' | ')} |`;
            }),
        ];
        return tableLines.join('\n');
    }

function getInvestmentDateDisplayHelpers() {
        return window.WORTHWARD_BOOTSTRAP?.dateDisplay || {};
    }

function parseInvestmentDateParts(rawValue) {
        const match = String(rawValue || '').match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return null;
        return {
            year: Number(match[1]),
            monthIndex: Number(match[2]) - 1,
            day: Number(match[3]),
            hours: match[4] ? Number(match[4]) : null,
            minutes: match[5] ? Number(match[5]) : null,
            seconds: match[6] ? Number(match[6]) : null,
        };
    }

function formatInvestmentFullDateParts(dateParts, options = {}) {
        const formatter = getInvestmentDateDisplayHelpers().formatFullDateParts;
        if (typeof formatter === 'function') return formatter(dateParts, options);
        if (!dateParts) return '';
        return `${dateParts.day}/${dateParts.monthIndex + 1}/${dateParts.year}`;
    }

function formatInvestmentFullDateLines(dateParts, options = {}) {
        const formatter = getInvestmentDateDisplayHelpers().formatFullDateLines;
        if (typeof formatter === 'function') return formatter(dateParts, options);
        if (!dateParts) return ['', ''];
        return [`${dateParts.day}/${dateParts.monthIndex + 1}`, `${dateParts.year}`];
    }

function formatInvestmentShortDateParts(dateParts) {
        const formatter = getInvestmentDateDisplayHelpers().formatShortDateParts;
        if (typeof formatter === 'function') return formatter(dateParts);
        if (!dateParts) return '';
        const month = String(dateParts.monthIndex + 1).padStart(2, '0');
        const day = String(dateParts.day).padStart(2, '0');
        return `${dateParts.year}/${month}/${day}`;
    }

function formatInvestmentExportDate(rawDate) {
        const dateParts = parseInvestmentDateParts(rawDate);
        if (!dateParts) return String(rawDate || '').trim();
        return formatInvestmentFullDateParts(dateParts);
    }

function buildExportDateRange(transactions, latestEquityDate = '') {
        const rawDates = Array.isArray(transactions)
            ? transactions
                .map((txn) => String(txn?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1).join('-') || '')
                .filter(Boolean)
            : [];
        if (!rawDates.length) {
            const today = new Date();
            const year = `${today.getFullYear()}`;
            const month = `${today.getMonth() + 1}`.padStart(2, '0');
            const day = `${today.getDate()}`.padStart(2, '0');
            const fallback = `${year}-${month}-${day}`;
            return { start: fallback, end: fallback };
        }
        const sortedDates = [...rawDates].sort();
        const normalizedLatestEquityDate = String(latestEquityDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        const transactionEndDate = sortedDates[sortedDates.length - 1];
        const exportEndDate = normalizedLatestEquityDate && normalizedLatestEquityDate >= transactionEndDate
            ? normalizedLatestEquityDate
            : transactionEndDate;
        return { start: sortedDates[0], end: exportEndDate };
    }

function getMetricCardExportValue(card) {
        const valueCopyNode = card?.querySelector('.investment-metric-tooltip-value-copy');
        if (valueCopyNode) {
            return valueCopyNode.textContent?.trim() || '';
        }

        const metricValueNode = card?.querySelector('.trade-metric-value');
        if (!metricValueNode) return '';
        const ownText = Array.from(metricValueNode.childNodes || [])
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || '')
            .join(' ')
            .trim();
        return ownText || metricValueNode.textContent?.trim() || '';
    }

function buildInvestmentMetricsMarkdown(metricsPanel) {
        const metricCards = Array.from(metricsPanel?.querySelectorAll('.trade-metric-card') || [])
            .map((card) => {
                const label = card.querySelector('.trade-metric-label')?.textContent?.trim() || '';
                const value = getMetricCardExportValue(card);
                return [label, value];
            })
            .filter(([label, value]) => label && value);

        return metricCards
            .map(([label, value]) => `**${label}:** ${value}`)
            .join('\n');
    }

function guessInvestmentExportDescription(transactions, holdingsTableMarkdown) {
        const tickerSet = new Set(
            (Array.isArray(transactions) ? transactions : [])
                .map((txn) => String(txn?.ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
        if (tickerSet.size === 1) {
            const [ticker] = Array.from(tickerSet);
            return `${ticker} Investment Holdings and Transaction History`;
        }
        if (holdingsTableMarkdown.includes('Money market')) {
            return 'Investment Holdings and Cash Transaction History';
        }
        return 'Investment Holdings and Transaction History';
    }

function downloadBlobFile(filename, blob) {
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => {
            window.URL.revokeObjectURL(objectUrl);
        }, 0);
    }

function downloadMarkdownFile(filename, content) {
        downloadBlobFile(filename, new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    }

function getVisibleTransactionsForStandardXlsxExport() {
        const processedTransactions = Array.isArray(runtime.state.investmentProcessedTransactionsCache)
            ? runtime.state.investmentProcessedTransactionsCache
            : [];
        if (runtime.state.activeInvestmentView === 'stock_details') {
            const activeTicker = runtime.normalizeInvestmentTicker(
                runtime.state.selectedInvestmentStockTicker || runtime.getInvestmentLocationTicker(),
            );
            return getVisibleInvestmentStockDetailTransactions(
                runtime.buildSafeInvestmentStockDetailRows(processedTransactions, activeTicker),
            );
        }
        return runtime.getVisibleInvestmentHistoryTransactions(
            processedTransactions,
            runtime.state.investmentChartPointsCache,
        );
    }

function getInvestmentDownloadFilename(response, fallback) {
        const disposition = String(response?.headers?.get('Content-Disposition') || '');
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match) {
            try {
                return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
            } catch (_error) {
                return fallback;
            }
        }
        const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
        return filenameMatch?.[1]?.trim() || fallback;
    }

async function exportStandardInvestmentXlsx() {
        const transactions = getVisibleTransactionsForStandardXlsxExport();
        if (!transactions.length) {
            runtime.setImportFeedback(
                'No visible transactions are available for standard XLSX export.',
                'warning',
            );
            return;
        }
        const response = await fetch(
            '/api/investment/exports/standard.xlsx',
            runtime.buildInvestmentRequestOptions({
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({transactions}),
            }),
        );
        if (!response.ok) {
            let message = 'The standard investment workbook could not be exported.';
            try {
                const payload = await response.json();
                message = payload?.error || message;
            } catch (_error) {
                // Keep the stable browser-facing fallback.
            }
            throw new Error(message);
        }
        const blob = await response.blob();
        downloadBlobFile(
            getInvestmentDownloadFilename(response, 'Standard_investment_export.xlsx'),
            blob,
        );
    }

function cloneRenderedTable(headerTable, bodyTable) {
        if (!headerTable || !bodyTable) return null;
        const headerRows = Array.from(headerTable.querySelectorAll('thead tr'));
        const bodyRows = Array.from(bodyTable.querySelectorAll('tbody tr'));
        const table = document.createElement('table');
        if (headerRows.length) {
            const thead = document.createElement('thead');
            headerRows.forEach((row) => thead.appendChild(row.cloneNode(true)));
            table.appendChild(thead);
        }
        const tbody = document.createElement('tbody');
        bodyRows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
        table.appendChild(tbody);
        return table;
    }

function renderInvestmentHistoryMetricValue(value, title = '', valueClass = '') {
        const titleMarkup = String(title || '').trim()
            ? ` title="${runtime.escapeHtml(title)}"`
            : '';
        const classMarkup = String(valueClass || '').trim()
            ? ` ${runtime.escapeHtml(String(valueClass).trim())}`
            : '';
        return `<span class="trade-metric-value investment-history-metric-value${classMarkup}"${titleMarkup}>${runtime.renderWorkspaceMetricValueContent(value)}</span>`;
    }

function formatInvestmentHistoryCashProjection(value, isProvisional = false) {
        const formatted = runtime.formatAmount(value);
        // HSBC exposes unresolved settlement once on the compact order
        // reference. Cash and Equity keep their evidence note in `title`, but
        // repeating an asterisk on every later metric misstates the number of
        // unresolved orders. Retain the argument for runtime API compatibility.
        void isProvisional;
        return formatted;
}

function formatInvestmentCurrentCash(value, isApproximate = false) {
        const numericValue = runtime.getOptionalInvestmentNumber(value);
        if (numericValue === null) return '-';
        // The pending order reference owns the single visible asterisk. The
        // current-cash projection remains numerically identical and continues
        // to expose its evidence status through the surrounding UI copy.
        void isApproximate;
        return runtime.formatHoldingsMoney(numericValue);
}

function renderInvestmentHistoryRowMarkup(txn, {includeProvisionalMarker = true} = {}) {
        const description = runtime.formatTransactionDescription(txn);
        const brokerMarketValue = runtime.getOptionalInvestmentNumber(
            txn?.broker_market_value ?? txn?.market_value,
        );
        const brokerRunningCash = Number(txn?.broker_running_cash ?? txn?.running_cash) || 0;
        const brokerPendingSettlementCash = Number(txn?.broker_pending_settlement_cash) || 0;
        const brokerDisplayCash = Number(txn?.broker_display_cash);
        const brokerTotalEquity = runtime.getOptionalInvestmentNumber(
            txn?.broker_total_equity ?? txn?.total_equity,
        );
        const historyBrokerCash = Number(txn?.history_broker_cash);
        const historyBrokerEquity = Number(txn?.history_broker_equity);
        const brokerCode = runtime.normalizeInvestmentBroker(txn?.broker || runtime.getTransactionBrokerCode(txn));
        const shouldShowPendingSettlementCash = (
            brokerCode === 'hsbc'
            && runtime.isHsbcSettlementActuallyPending(txn?.source)
            && Math.abs(brokerPendingSettlementCash) > 1e-9
        );
        const brokerCashForDisplay = Number.isFinite(brokerDisplayCash)
            ? brokerDisplayCash
            : (shouldShowPendingSettlementCash
                ? brokerRunningCash + brokerPendingSettlementCash
                : brokerRunningCash);
        const brokerCashProjection = Number.isFinite(historyBrokerCash)
            ? historyBrokerCash
            : brokerCashForDisplay;
        const brokerEquityProjection = Number.isFinite(historyBrokerEquity)
            ? historyBrokerEquity
            : (Number.isFinite(brokerTotalEquity) ? brokerTotalEquity : null);
        const cashIsProvisional = includeProvisionalMarker
            && txn?.history_cash_is_provisional === true;
        const equityIsProvisional = includeProvisionalMarker
            && txn?.history_equity_is_provisional === true;
        const balanceSourceNote = txn?.broker_balance_source === 'hsbc_authoritative_position_snapshot_pending_projection'
            ? "Current HSBC Portfolio market value; Cash is a provisional projection of the posted USD Savings Ledger balance plus the signed net of visible unsettled buy/sell orders. The bank's Available balance remains separate audit evidence and may differ. Unposted clearing-fee evidence remains unapplied until a settled cash posting confirms it."
            : '';
        const provisionalBalanceNote = String(txn?.history_balance_provisional_reason || '').trim();
        const balanceNote = [balanceSourceNote, provisionalBalanceNote].filter(Boolean).join(' ');
        const sourceKey = String(txn?.manual_internal_transfer_source_key || '').trim();
        const transferOptions = sourceKey ? (runtime.state.investmentInternalTransferSourceOptionsByKey.get(sourceKey) || []) : [];
        const isIgnoredSource = txn?.manual_internal_transfer_ignored === true;
        const selectedTargetKey = String(txn?.manual_internal_transfer_selected_target_key || '').trim();
        const resolvedDescription = runtime.getInvestmentResolvedTransferDescription(txn);
        const isSecurityTransfer = txn?.manual_internal_transfer_kind === 'security';
        const descriptionCurrentText = isSecurityTransfer
            ? description
            : (resolvedDescription || description);
        const resolvedBinding = sourceKey ? runtime.state.investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey) || null : null;
        const transferFeeNote = txn?.manual_internal_transfer_needs_binding
            ? String(txn?.manual_internal_transfer_fee_note || '').trim()
            : '';
        const resolvedBrokerLabel = resolvedBinding?.targetTxn
            ? runtime.getInvestmentBrokerMeta(runtime.getTransactionBrokerCode(resolvedBinding.targetTxn)).label
            : 'counterpart account';
        const resolvedTransferPreposition = runtime.getInvestmentInternalTransferDirection(resolvedBinding?.sourceTxn) === 'security_broker_to_broker'
            ? 'to'
            : 'from';
        const transferIsAutoMatched = txn?.manual_internal_transfer_auto_matched === true;
        const currencyDisplay = runtime.formatInvestmentHistoryCurrencyDisplay(txn);
        const receiptKey = String(
            txn?.security_transfer_receipt_key || txn?.manual_internal_transfer_key || ''
        ).trim();
        const securityTransferAttributionStatus = String(
            txn?.security_transfer_attribution_status || ''
        ).trim();
        const isSchwabSecurityReceipt = (
            brokerCode === 'schwab'
            && runtime.getNormalizedTransactionType(txn) === 'transfer_in'
            && Math.abs(Number(runtime.getTransactionQuantity(txn)) || 0) > 1e-9
            && receiptKey
        );
        const securityTransferAttribution = txn?.security_transfer_attribution;
        const rawAttributionSourceBroker = String(
            securityTransferAttribution?.source_broker || '',
        ).trim();
        const attributionSourceAccount = String(
            securityTransferAttribution?.source_account || '',
        ).trim();
        // normalizeInvestmentBroker('') falls back to IBKR; an absent
        // attribution must stay absent rather than read as a saved source.
        const attributionSourceBroker = rawAttributionSourceBroker && attributionSourceAccount
            ? runtime.normalizeInvestmentBroker(rawAttributionSourceBroker)
            : '';
        const receiptSourceOptions = isSchwabSecurityReceipt
            ? runtime.getInvestmentSecurityTransferReceiptSourceOptions(txn)
            : [];
        const isPassiveBoundSecurityReceipt = isSchwabSecurityReceipt
            && txn?.manual_internal_transfer_role === 'target'
            && txn?.manual_internal_transfer_kind === 'security'
            && String(txn?.manual_internal_transfer_pair_key || '').trim();
        const securityTransferAttributionNote = receiptSourceOptions.length
            ? ''
            : (attributionSourceBroker
                ? 'No matching source transfer-out record is imported yet. Import the source broker statement to bind this receipt.'
                : 'Awaiting the source broker transfer-out record. Import that broker statement to bind this receipt; no other account is offered.');
        let securityTransferSelectMarkup = '';
        if (receiptSourceOptions.length) {
            // Bind the exact imported source leg; this persists a manual
            // pair binding identical to the one made from the source row.
            securityTransferSelectMarkup = `
                    <select class="investment-security-transfer-receipt-bind-select trade-strategy-select form-select"
                            data-investment-security-transfer-receipt-key="${runtime.escapeHtml(receiptKey)}"
                            aria-label="Bind the source transfer-out for this Schwab security receipt">
                        <option value="">Bind source transfer-out...</option>
                        ${receiptSourceOptions.map((option) => `<option value="${runtime.escapeHtml(option.key)}">from ${runtime.escapeHtml(option.label)}</option>`).join('')}
                    </select>
                `;
        } else if (attributionSourceBroker) {
            // Keep a previously saved aggregate-only attestation reviewable and
            // removable, but never offer new unrelated accounts.
            securityTransferSelectMarkup = `
                    <select class="investment-security-transfer-attribution-select trade-strategy-select form-select"
                            data-investment-security-transfer-receipt-key="${runtime.escapeHtml(receiptKey)}"
                            aria-label="Review the saved Schwab security-transfer source attribution">
                        <option value="${runtime.escapeHtml(JSON.stringify({
                            source_broker: attributionSourceBroker,
                            source_account: attributionSourceAccount,
                        }))}" selected>${runtime.escapeHtml(`${runtime.getInvestmentBrokerMeta(attributionSourceBroker).label} · ${attributionSourceAccount}`)}</option>
                        <option value="">Clear source attribution</option>
                    </select>
                `;
        }
        const securityTransferAttributionMarkup = isSchwabSecurityReceipt
            && !isPassiveBoundSecurityReceipt
            && (
            txn?.security_transfer_requires_attribution
            || attributionSourceBroker
            || securityTransferAttributionStatus
        )
            ? `
                <div class="investment-transfer-link-shell${txn?.security_transfer_requires_attribution ? ' is-unresolved' : ' is-resolved'}">
                    <span class="investment-transfer-link-current">${runtime.escapeHtml(description)}</span>
                    ${securityTransferSelectMarkup}
                    ${securityTransferAttributionNote
                        ? `<span class="investment-transfer-link-fee-note">${runtime.escapeHtml(securityTransferAttributionNote)}</span>`
                        : ''}
                </div>
            `
            : '';
        const descriptionMarkup = securityTransferAttributionMarkup || (transferOptions.length || isIgnoredSource
            ? `
                <div class="investment-transfer-link-shell${isIgnoredSource ? ' is-ignored' : (txn?.manual_internal_transfer_needs_binding ? ' is-unresolved' : ' is-resolved')}">
                    <span class="investment-transfer-link-current">${runtime.escapeHtml(descriptionCurrentText)}</span>
                    <select class="investment-transfer-link-select trade-strategy-select form-select"
                            data-investment-transfer-source-key="${runtime.escapeHtml(sourceKey)}"
                            aria-label="Manage internal-transfer recognition">
                        ${isIgnoredSource
                            ? `<option value="${runtime.INVESTMENT_INTERNAL_TRANSFER_IGNORE_VALUE}" selected>Incorrectly identified, ignore</option><option value="${runtime.INVESTMENT_INTERNAL_TRANSFER_RESTORE_VALUE}">Restore binding review</option>`
                            : (transferIsAutoMatched
                            ? `<option value="${runtime.escapeHtml(selectedTargetKey)}" selected>${isSecurityTransfer ? '' : 'Automatically matched '}${resolvedTransferPreposition} ${runtime.escapeHtml(resolvedBrokerLabel)}</option>`
                            : (txn?.manual_internal_transfer_needs_binding
                            ? '<option value="">Bind transfer outflow...</option>'
                            : `<option value="${runtime.escapeHtml(selectedTargetKey)}" selected>${resolvedTransferPreposition} ${runtime.escapeHtml(resolvedBrokerLabel)}</option><option value="">Undo link</option><option value="${runtime.INVESTMENT_INTERNAL_TRANSFER_IGNORE_VALUE}">Incorrectly identified, ignore</option>`))}
                        ${transferIsAutoMatched ? '' : transferOptions.map((option) => `
                            <option value="${runtime.escapeHtml(option.key)}"${txn?.manual_internal_transfer_needs_binding && option.key === selectedTargetKey ? ' selected' : ''}>
                                ${runtime.escapeHtml(option.label)}
                            </option>
                        `).join('')}${isIgnoredSource || transferIsAutoMatched || txn?.manual_internal_transfer_needs_binding ? (isIgnoredSource || transferIsAutoMatched ? '' : `<option value="${runtime.INVESTMENT_INTERNAL_TRANSFER_IGNORE_VALUE}">Incorrectly identified, ignore</option>`) : ''}
                    </select>
                    ${transferFeeNote ? `<span class="investment-transfer-link-fee-note">${runtime.escapeHtml(transferFeeNote)}</span>` : ''}
                </div>
            `
            : runtime.escapeHtml(description));
        return `
            <tr id="investment_history_row_${txn.ledger_no}" data-investment-history-row="${txn.ledger_no}" data-investment-history-date="${runtime.escapeHtml(String(txn.date || '').slice(0, 10))}" data-investment-history-ticker="${runtime.escapeHtml(String(txn.ticker || '').trim().toUpperCase())}">
                ${renderInvestmentBrokerCell(txn)}
                <td class="investment-history-cell investment-history-cell-center">${txn.ledger_no}</td>
                <td class="investment-history-cell investment-history-cell-right">${runtime.formatTransactionDateDisplay(txn)}</td>
                <td class="investment-history-cell investment-history-cell-center">${runtime.formatEventType(txn.type)}</td>
                <td class="investment-history-cell investment-history-cell-left${txn?.manual_internal_transfer_needs_binding ? ' investment-history-cell-transfer-pending' : ''}">${descriptionMarkup}</td>
                <td class="investment-history-cell investment-history-cell-center">${runtime.escapeHtml(currencyDisplay)}</td>
                <td class="investment-history-cell investment-history-cell-right">${renderInvestmentHistoryMetricValue(runtime.formatAmount(txn.display_amount))}</td>
                <td class="investment-history-cell investment-history-cell-right">${renderInvestmentHistoryMetricValue(runtime.formatTransactionCommissionDisplay(txn))}</td>
                <td class="investment-history-cell investment-history-cell-right">${renderInvestmentHistoryMetricValue(runtime.formatAmount(Number.isFinite(brokerMarketValue) ? brokerMarketValue : null), balanceSourceNote)}</td>
                <td class="investment-history-cell investment-history-cell-right">${renderInvestmentHistoryMetricValue(formatInvestmentHistoryCashProjection(brokerCashProjection, cashIsProvisional), balanceNote)}</td>
                <td class="investment-history-cell investment-history-cell-right investment-history-cell-emphasis"><strong>${renderInvestmentHistoryMetricValue(formatInvestmentHistoryCashProjection(brokerEquityProjection, equityIsProvisional), balanceNote)}</strong></td>
            </tr>
        `;
    }

function bindInvestmentHistoryTransferControls(tbody) {
        if (!(tbody instanceof HTMLElement) || tbody.dataset.transferBindingBound === '1') return;
        tbody.dataset.transferBindingBound = '1';
        tbody.addEventListener('change', async (event) => {
            const attributionSelect = event.target.closest('.investment-security-transfer-attribution-select');
            if (attributionSelect instanceof HTMLSelectElement) {
                const receiptKey = String(
                    attributionSelect.dataset.investmentSecurityTransferReceiptKey || '',
                ).trim();
                if (!receiptKey) return;
                let sourceBroker = '';
                let sourceAccount = '';
                const rawSelection = String(attributionSelect.value || '').trim();
                if (rawSelection) {
                    try {
                        const selection = JSON.parse(rawSelection);
                        sourceBroker = runtime.normalizeInvestmentBroker(selection?.source_broker || '');
                        sourceAccount = String(selection?.source_account || '').trim();
                    } catch (_error) {
                        sourceBroker = '';
                        sourceAccount = '';
                    }
                    if (!sourceBroker || !sourceAccount) {
                        runtime.setImportFeedback('Select a valid source broker and account.', 'error');
                        await runtime.renderTransactionTable(
                            runtime.state.investmentRawTransactionsCache,
                            { preserveHistoryPage: true, scrollToTop: false },
                        );
                        return;
                    }
                    const sourceLabel = `${runtime.getInvestmentBrokerMeta(sourceBroker).label} · ${sourceAccount}`;
                    const confirmed = window.confirm(
                        `Confirm ${sourceLabel} as the source for this Schwab security receipt?`,
                    );
                    if (!confirmed) {
                        await runtime.renderTransactionTable(
                            runtime.state.investmentRawTransactionsCache,
                            { preserveHistoryPage: true, scrollToTop: false },
                        );
                        return;
                    }
                }
                const historyScrollContainer = runtime.getInvestmentHistoryScrollContainer();
                const historyScrollPosition = historyScrollContainer instanceof HTMLElement
                    ? { top: historyScrollContainer.scrollTop, left: historyScrollContainer.scrollLeft }
                    : null;
                runtime.showInvestmentTransferBindingModal();
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                try {
                    await runtime.rememberInvestmentSecurityTransferAttribution(
                        receiptKey,
                        sourceBroker,
                        sourceAccount,
                    );
                    await runtime.renderTransactionTable(
                        runtime.state.investmentRawTransactionsCache,
                        { preserveHistoryPage: true, scrollToTop: false },
                    );
                    runtime.setImportFeedback(
                        sourceBroker
                            ? 'Saved the source-account confirmation.'
                            : 'The source-account confirmation was not changed.',
                        sourceBroker ? 'success' : 'warning',
                    );
                    if (historyScrollPosition && historyScrollContainer instanceof HTMLElement) {
                        const restoreHistoryScrollPosition = () => {
                            historyScrollContainer.scrollTop = historyScrollPosition.top;
                            historyScrollContainer.scrollLeft = historyScrollPosition.left;
                        };
                        restoreHistoryScrollPosition();
                        window.requestAnimationFrame(restoreHistoryScrollPosition);
                    }
                } catch (error) {
                    if (runtime.isLifecycleInterruptedFetch(error)) return;
                    console.error('Failed to confirm Schwab security-transfer source:', error);
                    runtime.setImportFeedback(
                        String(error?.message || 'The Schwab source confirmation could not be saved.'),
                        'error',
                    );
                    await runtime.renderTransactionTable(
                        runtime.state.investmentRawTransactionsCache,
                        { preserveHistoryPage: true, scrollToTop: false },
                    );
                } finally {
                    runtime.hideInvestmentLoadingModal({ resetContent: true });
                }
                return;
            }
            const receiptBindSelect = event.target.closest('.investment-security-transfer-receipt-bind-select');
            const select = receiptBindSelect instanceof HTMLSelectElement
                ? receiptBindSelect
                : event.target.closest('.investment-transfer-link-select');
            if (!(select instanceof HTMLSelectElement)) return;
            const sourceKey = String(
                select === receiptBindSelect
                    ? select.value
                    : select.dataset.investmentTransferSourceKey || '',
            ).trim();
            if (!sourceKey) return;
            const targetKey = String(
                select === receiptBindSelect
                    ? select.dataset.investmentSecurityTransferReceiptKey || ''
                    : select.value,
            ).trim();
            if (select === receiptBindSelect && !targetKey) return;
            const action = targetKey === runtime.INVESTMENT_INTERNAL_TRANSFER_IGNORE_VALUE
                ? 'ignore'
                : (targetKey === runtime.INVESTMENT_INTERNAL_TRANSFER_RESTORE_VALUE ? 'restore' : 'bind');
            const persistedTargetKey = action === 'bind' ? targetKey : '';
            const historyScrollContainer = runtime.getInvestmentHistoryScrollContainer();
            const historyScrollPosition = historyScrollContainer instanceof HTMLElement
                ? { top: historyScrollContainer.scrollTop, left: historyScrollContainer.scrollLeft }
                : null;
            runtime.showInvestmentTransferBindingModal();
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            try {
                await runtime.rememberInvestmentInternalTransferBinding(
                    sourceKey,
                    persistedTargetKey,
                    action,
                );
                await runtime.renderTransactionTable(
                    runtime.state.investmentRawTransactionsCache,
                    { preserveHistoryPage: true, scrollToTop: false },
                );
                const remainingPendingTransferCount = runtime.countInvestmentPendingInternalTransferBindings();
                const feedbackMessage = action === 'ignore'
                    ? 'Marked this internal-transfer candidate as incorrectly identified and ignored. Ledger cash remains unchanged.'
                    : (action === 'restore'
                        ? 'Restored this candidate to binding review.'
                        : (targetKey
                            ? (remainingPendingTransferCount > 0
                                ? `Linked the selected internal-transfer counterpart. ${remainingPendingTransferCount.toLocaleString('en-US')} possible internal-transfer ${remainingPendingTransferCount === 1 ? 'match remains' : 'matches remain'} marked Unbound.`
                                : 'Linked the selected internal-transfer counterpart. No internal-transfer candidates remain marked Unbound; no further action is required.')
                            : 'Removed the manual internal-transfer link. The aggregate curve now shows the raw transfer path again.'));
                const feedbackVariant = action === 'ignore' || action === 'restore' || targetKey
                    ? 'success'
                    : 'warning';
                runtime.setImportFeedback(feedbackMessage, feedbackVariant);
                if (historyScrollPosition && historyScrollContainer instanceof HTMLElement) {
                    const restoreHistoryScrollPosition = () => {
                        historyScrollContainer.scrollTop = historyScrollPosition.top;
                        historyScrollContainer.scrollLeft = historyScrollPosition.left;
                    };
                    restoreHistoryScrollPosition();
                    window.requestAnimationFrame(restoreHistoryScrollPosition);
                }
            } catch (error) {
                if (runtime.isLifecycleInterruptedFetch(error)) return;
                console.error('Failed to bind internal transfer:', error);
                runtime.setImportFeedback(
                    String(error?.message || 'The internal transfer could not be bound. Please try again.').trim(),
                    'error',
                );
            } finally {
                runtime.hideInvestmentLoadingModal({ resetContent: true });
            }
        });
    }

function buildInvestmentHistoryExportTable(processedTransactions = [], chartPoints = []) {
        const headerTable = document.querySelector('#history_table_wrap table[data-table-header]');
        if (!(headerTable instanceof HTMLTableElement)) return null;
        const visibleTransactions = runtime.getInvestmentHistoryDisplayTransactions(processedTransactions, chartPoints);
        if (!visibleTransactions.length) return null;
        const table = document.createElement('table');
        const thead = headerTable.querySelector('thead');
        if (thead) {
            table.appendChild(thead.cloneNode(true));
        }
        const tbody = document.createElement('tbody');
        tbody.innerHTML = [...visibleTransactions].reverse().map((txn) => (
            renderInvestmentHistoryRowMarkup(txn, {includeProvisionalMarker: false})
        )).join('');
        table.appendChild(tbody);
        return table;
    }

function getVisibleInvestmentStockDetailTransactions(detailRows = []) {
        const availableBrokerCodes = runtime.getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = runtime.getInvestmentBrokerFilterSelectedCodes({view: 'stock_details'});
        const allBrokersSelected = runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        return (Array.isArray(detailRows) ? detailRows : []).filter((txn) => (
            (allBrokersSelected || selectedBrokerCodes.has(runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn))))
            && (window.WORTHWARD_INVESTMENT_FILTERS?.matchesSideFilter(txn, runtime.state.investmentSideFilter) ?? true)
            && runtime.matchesInvestmentCurrencyFilter(txn)
            && runtime.matchesInvestmentStockDetailsDateFilter(txn)
        ));
    }

function getInvestmentBrokerCurrencyFilteredRowsForVisibleHistory(processedTransactions = []) {
        const index = runtime.ensureInvestmentBrokerFilterTransactionIndex(processedTransactions);
        return runtime.selectInvestmentBrokerCurrencyRows(
            index,
            runtime.getInvestmentBrokerFilterSelectedCodes(),
            runtime.state.investmentCurrencyFilter,
            runtime.formatTransactionCurrency,
        );
    }

function buildInvestmentMarkdownFilterSummary({ includeTransactionDate = false } = {}) {
        const availableBrokerCodes = runtime.getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = runtime.getInvestmentBrokerFilterSelectedCodes();
        const allBrokersSelected = runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        const selectedBrokerLabels = availableBrokerCodes
            .filter((brokerCode) => selectedBrokerCodes.has(brokerCode))
            .map((brokerCode) => runtime.getInvestmentBrokerMeta(brokerCode).label);
        const sideLabels = Array.isArray(runtime.state.investmentSideFilter)
            ? runtime.state.investmentSideFilter.map((side) => runtime.formatEventType(side)).filter(Boolean)
            : [];
        const scopeParts = [
            `Broker: ${allBrokersSelected ? 'All brokers' : (selectedBrokerLabels.join(', ') || 'No brokers')}`,
            `Type: ${runtime.state.investmentSideFilter === 'all' ? 'All types' : (sideLabels.join(', ') || 'No types')}`,
            `Currency: ${runtime.state.investmentCurrencyFilter === 'all' ? 'All currencies' : runtime.state.investmentCurrencyFilter}`,
            `Description: ${runtime.state.investmentDescriptionBindingFilter === 'unbound' ? 'Unbound internal transfers' : 'All descriptions'}`,
        ];
        if (includeTransactionDate) {
            scopeParts.push(`Transaction date: ${runtime.getInvestmentStockDetailsDateFilterLabel()}`);
        } else {
            const rangeLabel = runtime.INVESTMENT_EQUITY_RANGE_OPTIONS
                .find((option) => option.value === runtime.normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange))?.label
                || 'Max';
            scopeParts.push(`Equity range: ${rangeLabel}`);
        }
        return scopeParts.join('; ');
    }

function buildInvestmentMarkdownExport() {
        const latestEquityDate = String(runtime.state.investmentLatestChartPoint?.date || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        if (runtime.state.activeInvestmentView === 'stock_details') {
            const activeTicker = runtime.normalizeInvestmentTicker(runtime.state.selectedInvestmentStockTicker || runtime.getInvestmentLocationTicker());
            const metricsPanel = runtime.investmentStockDetailsPanel?.querySelector('.investment-stock-details-metrics');
            const historyHeaderTable = runtime.investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table[data-table-header]');
            const historyBodyTable = runtime.investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table-scroll table');
            const historyTable = cloneRenderedTable(historyHeaderTable, historyBodyTable);
            if (!metricsPanel || !historyTable) {
                return null;
            }

            const processedTransactions = Array.isArray(runtime.state.investmentProcessedTransactionsCache)
                ? runtime.state.investmentProcessedTransactionsCache
                : [];
            const tickerTransactions = getVisibleInvestmentStockDetailTransactions(
                runtime.buildSafeInvestmentStockDetailRows(processedTransactions, activeTicker),
            );
            const dateRange = buildExportDateRange(tickerTransactions, latestEquityDate);
            if (!dateRange) {
                return null;
            }
            const exportedBody = historyTable.querySelector('tbody');
            if (exportedBody instanceof HTMLElement) {
                exportedBody.innerHTML = runtime.renderInvestmentStockDetailsTableRowsMarkup(tickerTransactions);
            }
            const historyMarkdown = extractMarkdownTable(historyTable);
            if (!historyMarkdown) {
                return null;
            }

            const metricsMarkdown = buildInvestmentMetricsMarkdown(metricsPanel);
            const companyName = runtime.investmentStockDetailsPanel?.querySelector('.ticker-identity-name')?.textContent?.trim() || '';
            const title = activeTicker
                ? `${activeTicker} Stock Details Transaction History`
                : 'Investment Stock Details Transaction History';
            const formattedRange = `${formatInvestmentExportDate(dateRange.start)} - ${formatInvestmentExportDate(dateRange.end)}`;
            const markdown = [
                `# ${title}`,
                '',
                activeTicker ? `**Ticker:** ${activeTicker}` : '',
                companyName ? `**Company:** ${companyName}` : '',
                `**Range:** ${formattedRange}`,
                `Filters: ${buildInvestmentMarkdownFilterSummary({ includeTransactionDate: true })}`,
                '',
                '## Metrics',
                '',
                metricsMarkdown,
                '',
                '## Transaction history',
                '',
                historyMarkdown,
                '',
            ].filter((line, index, lines) => (
                line !== ''
                || index === 0
                || lines[index - 1] !== ''
            )).join('\n');

            return {
                filename: `${title} ${dateRange.start} - ${dateRange.end}.md`,
                markdown,
            };
        }

        const holdingsHeaderTable = document.querySelector('#investment_holdings_panel .investment-holdings-table[data-table-header]');
        const holdingsBodyTable = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const holdingsTable = cloneRenderedTable(holdingsHeaderTable, holdingsBodyTable);
        const processedTransactions = Array.isArray(runtime.state.investmentProcessedTransactionsCache)
            ? runtime.state.investmentProcessedTransactionsCache
            : [];
        const visibleHistoryTransactions = runtime.getVisibleInvestmentHistoryTransactions(processedTransactions, runtime.state.investmentChartPointsCache);
        const historyTable = buildInvestmentHistoryExportTable(processedTransactions, runtime.state.investmentChartPointsCache);
        if (!metricsPanel || !holdingsTable || !historyTable) {
            return null;
        }

        const holdingsMarkdown = extractMarkdownTable(holdingsTable);
        const historyMarkdown = extractMarkdownTable(historyTable);
        if (!holdingsMarkdown || !historyMarkdown) {
            return null;
        }

        const dateRange = buildExportDateRange(visibleHistoryTransactions, latestEquityDate);
        if (!dateRange) {
            return null;
        }
        const title = guessInvestmentExportDescription(visibleHistoryTransactions, holdingsMarkdown);
        const metricsMarkdown = buildInvestmentMetricsMarkdown(metricsPanel);
        const formattedRange = `${formatInvestmentExportDate(dateRange.start)} - ${formatInvestmentExportDate(dateRange.end)}`;
        const markdown = [
            `# ${title}`,
            '',
            `**Range:** ${formattedRange}`,
            `Filters: ${buildInvestmentMarkdownFilterSummary()}`,
            '',
            '## Holdings',
            '',
            holdingsMarkdown,
            '',
            '## Metrics',
            '',
            metricsMarkdown,
            '',
            '## Transaction history',
            '',
            historyMarkdown,
            '',
        ].join('\n');

        return {
            filename: `${title} ${dateRange.start} - ${dateRange.end}.md`,
            markdown,
        };
    }

function buildTableAlignmentSync(tableShell, scrollContainer, scrollbarVariableName) {
        if (!(tableShell instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return null;

        if (window.WORTHWARD_TABLES?.attach) {
            // The global standard table controller owns measurement and observes
            // dynamically rendered shells. Investment keeps only its visual underlay lifecycle.
            return () => {};
        }

        const headerHeightVariableName = '--scrollable-data-table-header-height';
        let frameId = 0;
        let resizeObserver = null;
        let observedHeader = null;

        const getOverlayHeader = () => {
            const header = Array.from(tableShell.children).find((child) => (
                child instanceof HTMLTableElement
                && child.matches('[data-table-header], table[aria-hidden="true"]')
            ));
            return header instanceof HTMLElement ? header : null;
        };

        const roundUpToDevicePixel = (value) => {
            const scale = window.devicePixelRatio || 1;
            return Math.ceil(value * scale) / scale;
        };

        const getBodyColumnWidths = (bodyTable) => {
            if (!(bodyTable instanceof HTMLTableElement)) return [];
            const row = Array.from(bodyTable.rows).find((candidate) => candidate.cells.length);
            if (!row) return [];
            return Array.from(row.cells).map((cell) => cell.getBoundingClientRect().width);
        };

        const syncOverlayColumnWidths = (scrollbarWidth, overlayBorderCompensation) => {
            const overlayHeader = getOverlayHeader();
            const bodyTable = scrollContainer.querySelector('table');
            if (!(overlayHeader instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return;
            const columnWidths = getBodyColumnWidths(bodyTable);
            if (!columnWidths.length) return;
            Array.from(overlayHeader.children).forEach((child) => {
                if (child instanceof HTMLElement && child.tagName === 'COLGROUP') {
                    child.remove();
                }
            });
            const lastIndex = columnWidths.length - 1;
            columnWidths[lastIndex] = Math.max(
                1,
                columnWidths[lastIndex] + scrollbarWidth,
            );
            Array.from(overlayHeader.rows).forEach((row) => {
                Array.from(row.cells).forEach((cell, index) => {
                    if (index >= columnWidths.length) return;
                    cell.style.width = `${columnWidths[index] || 1}px`;
                });
            });
        };

        const syncHeaderHeight = () => {
            const overlayHeader = getOverlayHeader();
            if (!(overlayHeader instanceof HTMLElement)) {
                tableShell.style.removeProperty(headerHeightVariableName);
                return;
            }
            if (resizeObserver && observedHeader !== overlayHeader) {
                if (observedHeader instanceof HTMLElement) {
                    resizeObserver.unobserve(observedHeader);
                }
                resizeObserver.observe(overlayHeader);
                observedHeader = overlayHeader;
            }
            const headerHeight = overlayHeader.getBoundingClientRect().height;
            if (headerHeight > 0) {
                tableShell.style.setProperty(headerHeightVariableName, `${roundUpToDevicePixel(headerHeight)}px`);
            }
        };

        const syncAlignment = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            const overlayBorderCompensation = scrollbarWidth > 0 ? 1 : 0;
            tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
            tableShell.style.setProperty('--scrollable-data-table-scrollbar-width', `${scrollbarWidth}px`);
            tableShell.style.setProperty(
                '--scrollable-data-table-overlay-border-compensation',
                `${overlayBorderCompensation}px`
            );
            syncOverlayColumnWidths(scrollbarWidth, overlayBorderCompensation);
            syncHeaderHeight();
        };

        const scheduleAlignmentSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncAlignment);
        };

        scheduleAlignmentSync();
        window.addEventListener('resize', scheduleAlignmentSync);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                scheduleAlignmentSync();
            });
            resizeObserver.observe(tableShell);
            resizeObserver.observe(scrollContainer);
            const bodyTable = scrollContainer.querySelector('table');
            if (bodyTable instanceof HTMLElement) {
                resizeObserver.observe(bodyTable);
            }
            const overlayHeader = getOverlayHeader();
            if (overlayHeader instanceof HTMLElement) {
                resizeObserver.observe(overlayHeader);
                observedHeader = overlayHeader;
            }
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            window.removeEventListener('resize', scheduleAlignmentSync);
            resizeObserver?.disconnect();
            tableShell.style.removeProperty(scrollbarVariableName);
            tableShell.style.removeProperty('--scrollable-data-table-scrollbar-width');
            tableShell.style.removeProperty('--scrollable-data-table-overlay-border-compensation');
            tableShell.style.removeProperty(headerHeightVariableName);
        };
    }

function attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
        underlayClassName = '',
        underlayTableClassName = '',
        scrollbarVariableName = '',
    } = {}) {
        if (!(tableShell instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return null;
        const bodyTable = scrollContainer.querySelector('table');
        if (!(bodyTable instanceof HTMLTableElement)) return null;
        tableShell
            .querySelectorAll('.scrollable-data-table-frosted-underlay')
            .forEach((node) => node.remove());

        const underlay = document.createElement('div');
        underlay.className = [
            'scrollable-data-table-frosted-underlay',
            underlayClassName,
        ].filter(Boolean).join(' ');
        underlay.setAttribute('aria-hidden', 'true');
        const underlayTable = bodyTable.cloneNode(true);
        underlayTable.querySelectorAll('[id]').forEach((node) => {
            node.removeAttribute('id');
        });
        underlayTable.removeAttribute('id');
        underlayTable.classList.add('scrollable-data-table-frosted-underlay-table');
        if (underlayTableClassName) {
            underlayTable.classList.add(underlayTableClassName);
        }
        underlayTable.setAttribute('aria-hidden', 'true');
        underlay.appendChild(underlayTable);
        tableShell.insertBefore(underlay, tableShell.firstChild);

        let frameId = 0;
        let resizeObserver = null;

        const syncUnderlay = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            if (scrollbarVariableName) {
                tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
            }
            const shellRect = tableShell.getBoundingClientRect();
            const scrollRect = scrollContainer.getBoundingClientRect();
            const scrollViewportOffset = Math.max(0, scrollRect.top - shellRect.top);
            tableShell.style.setProperty(
                '--scrollable-data-table-underlay-offset-y',
                `${scrollViewportOffset - scrollContainer.scrollTop}px`
            );
            const bodyWidth = bodyTable.getBoundingClientRect().width;
            if (bodyWidth > 0) {
                underlayTable.style.width = `${bodyWidth}px`;
            }
        };

        const scheduleUnderlaySync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncUnderlay);
        };

        scheduleUnderlaySync();
        scrollContainer.addEventListener('scroll', scheduleUnderlaySync, { passive: true });
        window.addEventListener('resize', scheduleUnderlaySync);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(scheduleUnderlaySync);
            resizeObserver.observe(tableShell);
            resizeObserver.observe(scrollContainer);
            resizeObserver.observe(bodyTable);
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            scrollContainer.removeEventListener('scroll', scheduleUnderlaySync);
            window.removeEventListener('resize', scheduleUnderlaySync);
            resizeObserver?.disconnect();
            underlay.remove();
            tableShell.style.removeProperty('--scrollable-data-table-underlay-offset-y');
        };
    }

function teardownHoldingsTableAlignmentSync() {
        if (typeof runtime.state.investmentHoldingsTableAlignmentCleanup === 'function') {
            runtime.state.investmentHoldingsTableAlignmentCleanup();
            runtime.state.investmentHoldingsTableAlignmentCleanup = null;
        }
    }

function attachHoldingsTableAlignmentSync(holdingsPanel) {
        teardownHoldingsTableAlignmentSync();
        if (!(holdingsPanel instanceof HTMLElement)) return;
        const tableShell = holdingsPanel.querySelector('.investment-holdings-table-shell');
        const scrollContainer = holdingsPanel.querySelector('.investment-holdings-table-scroll');
        const alignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-holdings-scrollbar-width'
        );
        const underlayCleanup = attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
            underlayClassName: 'investment-holdings-frosted-underlay',
            underlayTableClassName: 'investment-holdings-frosted-underlay-table',
            scrollbarVariableName: '--investment-holdings-scrollbar-width',
        });
        runtime.state.investmentHoldingsTableAlignmentCleanup = () => {
            if (typeof alignmentCleanup === 'function') alignmentCleanup();
            if (typeof underlayCleanup === 'function') underlayCleanup();
        };
    }

function teardownHistoryTableAlignmentSync() {
        if (typeof runtime.state.investmentHistoryTableAlignmentCleanup === 'function') {
            runtime.state.investmentHistoryTableAlignmentCleanup();
            runtime.state.investmentHistoryTableAlignmentCleanup = null;
        }
    }

function attachHistoryTableAlignmentSync(historyPanel) {
        teardownHistoryTableAlignmentSync();
        if (!(historyPanel instanceof HTMLElement)) return;
        const tableShell = historyPanel.matches('.investment-history-table-shell')
            ? historyPanel
            : historyPanel.querySelector('.investment-history-table-shell');
        const scrollContainer = historyPanel.matches('.investment-history-table-scroll')
            ? historyPanel
            : historyPanel.querySelector('.investment-history-table-scroll');
        const alignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-history-scrollbar-width'
        );
        const underlayCleanup = attachScrollableTableFrostedUnderlay(tableShell, scrollContainer, {
            underlayClassName: 'investment-history-frosted-underlay',
            underlayTableClassName: 'investment-history-frosted-underlay-table',
            scrollbarVariableName: '--investment-history-scrollbar-width',
        });
        runtime.state.investmentHistoryTableAlignmentCleanup = () => {
            if (typeof alignmentCleanup === 'function') alignmentCleanup();
            if (typeof underlayCleanup === 'function') underlayCleanup();
        };
    }

function teardownStockDetailsTableAlignmentSync() {
        if (typeof runtime.state.investmentStockDetailsTableAlignmentCleanup === 'function') {
            runtime.state.investmentStockDetailsTableAlignmentCleanup();
            runtime.state.investmentStockDetailsTableAlignmentCleanup = null;
        }
    }

function attachStockDetailsTableAlignmentSync(stockDetailsPanel) {
        teardownStockDetailsTableAlignmentSync();
        if (!(stockDetailsPanel instanceof HTMLElement)) return;
        const tableShell = stockDetailsPanel.matches('.investment-stock-details-table-shell')
            ? stockDetailsPanel
            : stockDetailsPanel.querySelector('.investment-stock-details-table-shell');
        const scrollContainer = stockDetailsPanel.matches('.investment-stock-details-table-scroll')
            ? stockDetailsPanel
            : stockDetailsPanel.querySelector('.investment-stock-details-table-scroll');
        runtime.state.investmentStockDetailsTableAlignmentCleanup = buildTableAlignmentSync(
            tableShell,
            scrollContainer,
            '--investment-stock-details-scrollbar-width'
        );
    }

function syncInvestmentShareMaskButtonState() {
        if (!(runtime.shareMaskButton instanceof HTMLButtonElement)) return;
        const label = runtime.state.investmentShareMaskEnabled ? 'Reveal Sensitive Values' : 'Mask Sensitive Values';
        runtime.shareMaskButton.setAttribute('aria-pressed', runtime.state.investmentShareMaskEnabled ? 'true' : 'false');
        runtime.shareMaskButton.setAttribute('aria-label', label);
        runtime.shareMaskButton.title = label;
    }

function syncInvestmentShareMaskState() {
        if (runtime.investmentStockDetailsPanel instanceof HTMLElement) {
            runtime.investmentStockDetailsPanel.classList.toggle('is-share-sensitive-masked', runtime.state.investmentShareMaskEnabled);
        }
        if (runtime.investmentShareActions instanceof HTMLElement) {
            runtime.investmentShareActions.classList.toggle('is-mask-active', runtime.state.investmentShareMaskEnabled);
        }
        syncInvestmentEquityChartAxisMask();
        syncInvestmentShareMaskButtonState();
    }

function syncInvestmentEquityChartAxisMask() {
        if (!runtime.state.investmentEquityChartInstance) return;
        const yScaleTicks = runtime.state.investmentEquityChartInstance.options?.scales?.y?.ticks;
        if (!yScaleTicks) return;
        yScaleTicks.color = runtime.resolveInvestmentTheme().muted;
        yScaleTicks.callback = function (value, index, ticks) {
            if (index === 0 || index === ticks.length - 1) return '';
            if (runtime.state.investmentShareMaskEnabled) return '***';
            return typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : String(value);
        };
        runtime.state.investmentEquityChartInstance.update('none');
    }

    return {
        shouldPreserveSequentialBrokerBuyHistory,
        renderInvestmentBrokerCell,
        renderInvestmentStockDetailsColgroup,
        syncHoldingsChartHoverState,
        easeOutCubic,
        normalizeMarkdownCellWhitespace,
        extractMarkdownTableCellText,
        escapeMarkdownTableCell,
        extractMarkdownTable,
        getInvestmentDateDisplayHelpers,
        parseInvestmentDateParts,
        formatInvestmentFullDateParts,
        formatInvestmentFullDateLines,
        formatInvestmentShortDateParts,
        formatInvestmentExportDate,
        buildExportDateRange,
        getMetricCardExportValue,
        buildInvestmentMetricsMarkdown,
        guessInvestmentExportDescription,
        downloadBlobFile,
        downloadMarkdownFile,
        getVisibleTransactionsForStandardXlsxExport,
        getInvestmentDownloadFilename,
        exportStandardInvestmentXlsx,
        cloneRenderedTable,
        renderInvestmentHistoryMetricValue,
        formatInvestmentHistoryCashProjection,
        formatInvestmentCurrentCash,
        renderInvestmentHistoryRowMarkup,
        bindInvestmentHistoryTransferControls,
        buildInvestmentHistoryExportTable,
        getVisibleInvestmentStockDetailTransactions,
        getInvestmentBrokerCurrencyFilteredRowsForVisibleHistory,
        buildInvestmentMarkdownFilterSummary,
        buildInvestmentMarkdownExport,
        buildTableAlignmentSync,
        attachScrollableTableFrostedUnderlay,
        teardownHoldingsTableAlignmentSync,
        attachHoldingsTableAlignmentSync,
        teardownHistoryTableAlignmentSync,
        attachHistoryTableAlignmentSync,
        teardownStockDetailsTableAlignmentSync,
        attachStockDetailsTableAlignmentSync,
        syncInvestmentShareMaskButtonState,
        syncInvestmentShareMaskState,
        syncInvestmentEquityChartAxisMask,
    };
}
